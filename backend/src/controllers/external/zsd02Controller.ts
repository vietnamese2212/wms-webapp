// Cửa nạp ZSD02 (báo cáo SAP mức dòng SO/OD, 79 cột) — THAY VL06O làm nguồn DO (đợt 0 TMS điều vận, 22/09;
// plan docs/plans/TMS_DISPATCH_PLAN.md). Cùng khuôn với uploadVl06o: preflight 2 pha → nạp CÓ SO SÁNH (giữ id,
// NO-OP dòng y hệt, OBSOLETE dòng SAP đã bỏ) → reconcile → kích hoạt chuyến chờ. Khác ở chỗ: (1) tách hai sổ —
// dòng CÓ OD vào `erp_outbound_orders`, MỌI dòng vào sổ SO `erp_so_lines` (dòng chưa OD chỉ sống ở đó);
// (2) nuôi luôn `sap_route` + địa lý `Customer`. Bộ đọc là hàm thuần ở services/zsd02Parse (test trên file mẫu).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllByIdChunks, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { safeFilterValue } from '../../utils/search'
import { isDay } from '../../utils/dates'
import { parseListParam } from '../../utils/httpQuery'
import { isPreflight, buildPreflight, type PreflightExtra } from '../../utils/uploadPreflight'
import { expandMergedCells, readWorkbookSafe, parseSheetByHeader, BAD_EXCEL_MSG } from '../../utils/excelHeader'
import { getSapDoSource } from '../../utils/settings'
import { reconcileFromSap, type OdKey } from '../../services/outboundReconcile'
import { sapScopeCheck, activateAwaitingForDos } from '../wms/outboundController'
import { loadSapFlowMap, makeDvvtResolver } from '../../services/sapFlow'
import { upsertCustomerGeo } from '../../services/customerGeo'
import { parseZsd02, bizHash, isFlow, ZSD02_FIELDS, ZSD02_BIZ, SO_BIZ, LOADABLE_FLOWS, RAW_VERSION, type Zsd02Mat, type OdRecord } from '../../services/zsd02Parse'
import { allowedPlants, plantOrFilter } from './erpOrderController'

const now = () => new Date().toISOString()
const CHUNK = 500
const SO_STATUSES = ['OPEN', 'HAS_OD', 'CANCELLED'] as const
type SoStatus = typeof SO_STATUSES[number]

// POST /external/do-sap/upload-zsd02 (?preflight=1) — quyền: outbound.import | external_do_sap.create
export async function uploadZsd02(req: Request, res: Response) {
  try {
    // Công tắc nguồn: đang đặt VL06O = đường lui, cửa này đóng (hai nguồn ghi cùng sổ theo khoá (od, item)).
    if ((await getSapDoSource()) === 'VL06O') return fail(res, 409, 'SOURCE_DISABLED',
      'Nguồn DO SAP đang đặt là VL06O — đổi cờ "Nguồn DO SAP" ở Cài đặt WMS → Hệ thống sang BOTH hoặc ZSD02 để nạp ZSD02.')
    if (!req.file) return fail(res, 'Không có file upload', 400)
    const wb = readWorkbookSafe(req.file.buffer)
    if (!wb) return fail(res, BAD_EXCEL_MSG, 400)
    const ws = wb.Sheets[wb.SheetNames[0]]   // SHEET ĐẦU TIÊN (chốt user)
    const mergedFilled = expandMergedCells(ws)
    const parsed = parseSheetByHeader(ws, ZSD02_FIELDS)
    if (parsed.missingRequired.length) return fail(res,
      `File thiếu cột bắt buộc: ${parsed.missingRequired.join(', ')} — kiểm tra đúng file ZSD02 (sheet đầu tiên, dòng tiêu đề nguyên bản của SAP)`, 400)
    if (!parsed.rows.length) return fail(res, 'File ZSD02 trống hoặc không đúng định dạng', 400)

    // Master theo ĐÚNG mã có trong file (luật catalogue-payload), map flow, bộ tra ĐVVT
    const codes = [...new Set(parsed.rows.map(r => String(r.material ?? '').trim()).filter(Boolean))]
    const matRows = await fetchAllByIdChunks(codes, chunk => db.from('Material')
      .select('material_code, short_name, base_unit, entry_unit, units_per_carton, cartons_per_pallet, warehouse_pallet_overrides, weight_kg, is_pallet_carrier, is_non_stock')
      .in('material_code', chunk).order('id')) as Zsd02Mat[]
    const mats = new Map(matRows.map(m => [String(m.material_code).trim(), m]))
    const [flowMap, dvvtResolve] = await Promise.all([loadSapFlowMap(), makeDvvtResolver()])
    const actor = req.user?.name || null
    const t = now()
    const out = parseZsd02(parsed.rows, { mats, flowMap, dvvtResolve, actor, now: t })
    if (!out.od.length && !out.so.length) return fail(res, 'Không có dòng hợp lệ (thiếu SO/Item)', 400)

    // Scope kho (all-or-nothing) — kiểm trên CẢ hai sổ vì sổ SO cũng lộ dữ liệu kho khác
    const scope = await sapScopeCheck(req, [...out.od, ...out.so])
    if (scope.outside.length) return fail(res,
      `Ngoài phạm vi kho — file ZSD02 chứa dòng của: ${scope.outside.join(', ')}. Chỉ upload file của kho được giao.`, 403)

    const st = out.stats
    // đếm THẲNG dòng chưa OD — `so_rows − od_rows` lệch khi một SO item tách nhiều OD (4 dòng trong file mẫu)
    const soWithoutOd = out.so.filter(r => !r.od_number).length
    const unitErrors = [...out.unitErrs.values()].map(u => `Mã ${u.material_code} (${u.material_name}) — ${u.kind} trong file "${u.file_value}" ≠ hệ thống "${u.system_value}"`)
    const warnings = [...out.warnings]
    if (st.unknown_dvvt.length) warnings.push(`ĐVVT không khớp danh mục (khai vào Cài đặt TMS → ĐVVT hoặc thêm mã tương ứng ở ô "Mã khác"): ${st.unknown_dvvt.join(' · ')}`)
    if (st.unknown_flow_codes.length) warnings.push(`Mã SAP chưa có trong bảng phân loại (Cài đặt WMS → Hệ thống → Phân loại dòng SAP), dòng sẽ mang flow UNKNOWN và KHÔNG lên xe: ${st.unknown_flow_codes.join(' · ')}`)
    if (st.weight_mismatch_mats.length) warnings.push(`${st.weight_mismatch_mats.length} mã lệch khối lượng master ↔ SAP > 5 % (kiểm Material.weight_kg): ${st.weight_mismatch_mats.slice(0, 20).join(', ')}${st.weight_mismatch_mats.length > 20 ? '…' : ''}`)
    if (scope.unmapped > 0) warnings.push(`${scope.unmapped} dòng không xác định được kho từ Plant/Sloc SAP — khai "Plant SAP" cho kho ở Cài đặt WMS → tab Kho để chặn được file của kho khác.`)
    if (st.so_unresolved > 0) warnings.push(`${st.so_unresolved} dòng SO chưa có OD không quy đổi được đơn vị gốc (mã chưa có trong danh mục hoặc thiếu quy cách Thùng) — sổ SO để trống số base cho các dòng đó.`)

    // ── SO SÁNH VỚI SỔ ĐANG CÓ — làm TRƯỚC kiểm-trước (kiểm lại 22/09: nạp lại đúng file đã nạp mà bảng kiểm-trước
    // in "Sẽ thêm 3.050 · Sẽ cập nhật 0" trong khi ghi thật là NO-OP toàn bộ — ô đếm phải nói đúng thêm / cập nhật /
    // không đổi / SAP đã bỏ, cùng một phép so mà đường ghi dùng; chỉ ĐỌC, chưa ghi gì) ──
    // SỔ OD: giữ id · NO-OP theo bizHash · OBSOLETE dòng SAP bỏ trong DO có mặt
    const odNumbers = [...new Set(out.od.map(r => String(r.od_number)))]
    // `raw_v` = raw->>'_v': dòng NO-OP mà hình dạng `raw` cũ (thiếu 26 cột chỉ sống trong raw, 24/09) thì ghi lại
    // RIÊNG raw GIỮ updated_at — không tính "cập nhật", không kích reconcile (nghiệp vụ không đổi).
    type PriorRow = Record<string, unknown> & { id: string; sync_status: string | null; updated_at: string | null; raw_v: string | null }
    const rawStale = (p: PriorRow) => String(p.raw_v ?? '') !== String(RAW_VERSION)
    const priorOd = await fetchAllByIdChunks(odNumbers, chunk => db.from('erp_outbound_orders')
      .select('id, od_number, od_item, sync_status, updated_at, raw_v:raw->>_v, ' + ZSD02_BIZ.join(', '))
      .in('od_number', chunk).order('id')) as unknown as (PriorRow & { od_number: string; od_item: string })[]
    const priorByKey = new Map(priorOd.map(p => [`${p.od_number}__${p.od_item}`, { id: p.id, hash: bizHash(p, ZSD02_BIZ), updated_at: p.updated_at, stale: rawStale(p) }]))
    let odInserted = 0, odUpdated = 0, odNoop = 0, rawRefreshed = 0
    const odWrite: (OdRecord & { id: string })[] = []
    const updatedKeys: OdKey[] = []
    for (const rec of out.od) {
      const prior = priorByKey.get(`${rec.od_number}__${rec.od_item}`)
      if (!prior) { odWrite.push({ id: randomUUID(), ...rec }); odInserted++; continue }
      if (prior.hash === bizHash(rec as Record<string, unknown>, ZSD02_BIZ)) {
        odNoop++
        if (prior.stale && !isPreflight(req)) { odWrite.push({ id: prior.id, ...rec, updated_at: prior.updated_at ?? rec.updated_at }); rawRefreshed++ }
        continue
      }
      odWrite.push({ id: prior.id, ...rec, manual_edited_at: null }); odUpdated++
      updatedKeys.push({ od_number: String(rec.od_number), od_item: String(rec.od_item) })
    }
    const fileKeys = new Set(out.od.map(r => `${r.od_number}__${r.od_item}`))
    const fileDos = new Set(odNumbers)
    const removedKeys: OdKey[] = []
    for (const p of priorOd) {
      const k = `${p.od_number}__${p.od_item}`
      if (fileDos.has(String(p.od_number)) && !fileKeys.has(k) && p.sync_status !== 'OBSOLETE')
        removedKeys.push({ od_number: String(p.od_number), od_item: String(p.od_item) })
    }
    // SỔ SO: cùng khuôn theo khoá (so_number, so_item)
    const soNumbers = [...new Set(out.so.map(r => String(r.so_number)))]
    const priorSo = await fetchAllByIdChunks(soNumbers, chunk => db.from('erp_so_lines')
      .select('id, so_number, so_item, sync_status, updated_at, raw_v:raw->>_v, ' + SO_BIZ.join(', '))
      .in('so_number', chunk).order('id')) as unknown as (PriorRow & { so_number: string; so_item: string; sync_status: string })[]
    const priorSoByKey = new Map(priorSo.map(p => [`${p.so_number}__${p.so_item}`, { id: p.id, hash: bizHash(p, SO_BIZ), updated_at: p.updated_at, stale: rawStale(p) }]))
    let soInserted = 0, soUpdated = 0, soNoop = 0
    const soWrite: (typeof out.so[number] & { id: string })[] = []
    for (const rec of out.so) {
      const prior = priorSoByKey.get(`${rec.so_number}__${rec.so_item}`)
      if (!prior) { soWrite.push({ id: randomUUID(), ...rec }); soInserted++; continue }
      if (prior.hash === bizHash(rec as Record<string, unknown>, SO_BIZ)) {
        soNoop++
        if (prior.stale && !isPreflight(req)) { soWrite.push({ id: prior.id, ...rec, updated_at: prior.updated_at ?? rec.updated_at }); rawRefreshed++ }
        continue
      }
      soWrite.push({ id: prior.id, ...rec }); soUpdated++
    }
    const soFileKeys = new Set(out.so.map(r => `${r.so_number}__${r.so_item}`))
    const soObsoleteIds = priorSo.filter(p => !soFileKeys.has(`${p.so_number}__${p.so_item}`) && p.sync_status !== 'OBSOLETE').map(p => p.id)

    // ── PREFLIGHT: kiểm + báo cáo, KHÔNG ghi ──
    if (isPreflight(req)) {
      const dos = [...new Set(out.od.map(r => String(r.od_number)))]
      // DO đã lên chuyến / đang xuất (cùng cách đo với VL06O)
      const found: { gdo_id: string; delivery_code: string | null }[] = []
      for (let i = 0; i < dos.length; i += 40) {
        const orExpr = dos.slice(i, i + 40).map(d => `delivery_code.ilike.%${safeFilterValue(d)}%`).join(',')
        const { data } = await db.from('OutboundDelivery').select('gdo_id, delivery_code').or(orExpr)
        for (const d of (data ?? [])) found.push(d)
      }
      const dosSet = new Set(dos), dosOnTrips = new Set<string>(), relevantGdos = new Set<string>()
      for (const d of found) {
        const toks = String(d.delivery_code ?? '').split(/,\s*/).map(x => x.trim()).filter(x => dosSet.has(x))
        if (toks.length) { toks.forEach(x => dosOnTrips.add(x)); relevantGdos.add(d.gdo_id) }
      }
      let tripsInProgress = 0
      if (relevantGdos.size) {
        const { data: gs } = await db.from('GroupDeliveryOrder').select('id, status').in('id', [...relevantGdos].slice(0, 300))
        tripsInProgress = (gs ?? []).filter(g => g.status === 'IN_PROGRESS' || g.status === 'PAUSED').length
      }
      const extra: PreflightExtra[] = [
        { label: 'Dòng CÓ OD → sổ OD', value: st.od_rows },
        { label: 'Số OD trong file', value: st.od_numbers },
        { label: 'Dòng CHƯA OD → chỉ sổ SO', value: soWithoutOd },
        { label: 'Số SO trong file', value: st.so_numbers },
        ...(st.cancelled ? [{ label: 'Dòng SAP đã huỷ', value: st.cancelled }] : []),
        ...(st.not_loadable ? [{ label: 'Dòng KHÔNG lên xe (trả về · chiết khấu · chưa phân loại)', value: st.not_loadable, warn: true }] : []),
        ...(st.so_unresolved ? [{ label: 'Dòng SO không quy đổi được đơn vị', value: st.so_unresolved, warn: true }] : []),
        ...(st.unknown_dvvt.length ? [{ label: 'ĐVVT lạ', value: st.unknown_dvvt.length, warn: true }] : []),
        ...(st.unknown_flow_codes.length ? [{ label: 'Mã SAP chưa phân loại', value: st.unknown_flow_codes.length, warn: true }] : []),
        ...(st.weight_mismatch_mats.length ? [{ label: 'Mã lệch khối lượng > 5 %', value: st.weight_mismatch_mats.length, warn: true }] : []),
        ...(mergedFilled ? [{ label: 'Ô GỘP đã trải ra', value: mergedFilled }] : []),
        ...(scope.unmapped ? [{ label: 'Dòng không map được kho SAP', value: scope.unmapped, warn: true }] : []),
        ...(dosOnTrips.size ? [{ label: 'DO đã lên chuyến', value: dosOnTrips.size, warn: true }] : []),
        ...(tripsInProgress ? [{ label: 'Chuyến ĐANG XUẤT bị ảnh hưởng', value: tripsInProgress, warn: true }] : []),
        // so với sổ đang có — để "nạp lại file cũ" hiện 0 thêm / 0 cập nhật / N không đổi thay vì "Sẽ thêm N"
        ...(odNoop + soNoop ? [{ label: 'Không đổi (đã có y hệt)', value: odNoop + soNoop }] : []),
        ...(removedKeys.length + soObsoleteIds.length ? [{ label: 'Dòng SAP đã bỏ → OBSOLETE', value: removedKeys.length + soObsoleteIds.length, warn: true }] : []),
        { label: 'Phân loại', value: Object.entries(st.flows).map(([k, v]) => `${k} ${v}`).join(' · ') },
      ]
      return ok(res, buildPreflight({ unit: 'dòng', total: st.rows, toInsert: odInserted + soInserted, toUpdate: odUpdated + soUpdated, skipped: st.skipped, errors: unitErrors, warnings, extra }))
    }

    if (out.unitErrs.size) {
      return res.status(400).json({
        success: false,
        error: { code: 'UNIT_MISMATCH', message: `${out.unitErrs.size} mã có đơn vị không khớp hệ thống — sửa Đơn vị ở trang Mã hàng (hoặc bổ sung nhãn ở utils/sapUnits) rồi up lại.` },
        unit_errors: [...out.unitErrs.values()],
      })
    }

    // ── GHI SỔ OD (đã phân loại ở trên) — chunk 500, OBSOLETE dòng SAP bỏ ──
    for (let i = 0; i < odWrite.length; i += CHUNK) {
      const { error } = await db.from('erp_outbound_orders').upsert(odWrite.slice(i, i + CHUNK), { onConflict: 'od_number,od_item' })
      if (error) throw new Error(error.message)
    }
    if (removedKeys.length) {
      await Promise.all(removedKeys.map(k => db.from('erp_outbound_orders')
        .update({ sync_status: 'OBSOLETE', updated_at: t }).eq('od_number', k.od_number).eq('od_item', k.od_item)))
    }

    // ── GHI SỔ SO ──
    for (let i = 0; i < soWrite.length; i += CHUNK) {
      const { error } = await db.from('erp_so_lines').upsert(soWrite.slice(i, i + CHUNK), { onConflict: 'so_number,so_item' })
      if (error) throw new Error(error.message)
    }
    const soObsoleted = soObsoleteIds.length
    for (let i = 0; i < soObsoleteIds.length; i += 300) {
      const { error } = await db.from('erp_so_lines').update({ sync_status: 'OBSOLETE', updated_at: t }).in('id', soObsoleteIds.slice(i, i + 300))
      if (error) throw new Error(error.message)
    }

    // ── Tuyến SAP + địa lý khách hàng (AUGMENT — lỗi không làm hỏng upload cốt lõi) ──
    let routesWritten = 0
    let customers: Awaited<ReturnType<typeof upsertCustomerGeo>> | null = null
    try {
      const routeRows = [...out.routes.values()].map(r => ({ ...r, updated_at: t }))
      for (let i = 0; i < routeRows.length; i += CHUNK) {
        const { error } = await db.from('sap_route').upsert(routeRows.slice(i, i + CHUNK), { onConflict: 'route_code' })
        if (error) throw new Error(error.message)
        routesWritten += routeRows.slice(i, i + CHUNK).length
      }
      customers = await upsertCustomerGeo([...out.customers.values()], actor)
    } catch (e) { console.error('[uploadZsd02] route/customer geo:', e) }

    // ── Reconcile + kích hoạt chuyến chờ — đúng hai hàm VL06O đang gọi ──
    let reconcile: Awaited<ReturnType<typeof reconcileFromSap>> | null = null
    let reconcile_error: string | null = null
    const changedKeys = [...updatedKeys, ...removedKeys]
    if (changedKeys.length) {
      try { reconcile = await reconcileFromSap(changedKeys, { actor: actor || 'SAP-UPLOAD' }) }
      catch (e) { reconcile_error = String(e); console.error('[reconcileFromSap] uploadZsd02:', e) }
    }
    const activated = await activateAwaitingForDos(req, fileDos, 'uploadZsd02')

    return ok(res, {
      rows: st.rows, skipped_no_key: st.skipped,
      od: { rows: st.od_rows, deliveries: st.od_numbers, inserted: odInserted, updated: odUpdated, noop: odNoop, obsoleted: removedKeys.length },
      raw_refreshed: rawRefreshed,
      so: { rows: st.so_rows, orders: st.so_numbers, without_od: soWithoutOd, inserted: soInserted, updated: soUpdated, noop: soNoop, obsoleted: soObsoleted, unresolved: st.so_unresolved, cancelled: st.cancelled },
      flows: st.flows, not_loadable: st.not_loadable,
      routes: routesWritten, customers,
      sap_unmapped: scope.unmapped,
      reconcile, reconcile_error, ...(activated ? { activated } : {}),
      warning_count: warnings.length, warnings: warnings.slice(0, 50),
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// GET /external/so-lines — sổ SO (tab "Chưa có OD"): phân trang + lọc theo Ngày giao / plant / trạng thái / flow / tìm.
// Mặc định chỉ dòng OPEN (chưa có OD, chưa huỷ). Ô tổng = RPC erp_so_lines_summary (cộng trong SQL, cùng WHERE).
export async function listSoLines(req: Request, res: Response) {
  try {
    const { q, date_from, date_to, plant, status, flow } = req.query as Record<string, string>
    // Ngày lọc phải là ngày CÓ THẬT trên lịch (isDay) — lưới app.ts gác dạng, đây gác nốt ca gõ tay rác → 400 thay 500
    for (const [k, v] of [['date_from', date_from], ['date_to', date_to]] as const)
      if (v && !isDay(v)) return fail(res, `${k} không phải ngày hợp lệ (YYYY-MM-DD)`, 400)
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.page_size) || 50))
    // Vắng `status` → mặc định OPEN; `?status=` rỗng → KHÔNG dòng nào (luật parseListParam — đừng bỏ lọc âm thầm)
    // Whitelist cả hai (giá trị cố định) rồi ghép `col.in.(…)` — không có ký tự lạ nào lọt vào filter PostgREST
    const statuses = (parseListParam(status) ?? ['OPEN']).filter((v): v is SoStatus => (SO_STATUSES as readonly string[]).includes(v))
    const flows = parseListParam(flow)?.filter(isFlow) ?? null
    const plants = await allowedPlants(req)
    const s = q && q.trim() ? safeFilterValue(q.trim()) : ''
    const empty = { rows: 0, open: 0, has_od: 0, cancelled: 0, unresolved: 0, not_loadable: 0, so_numbers: 0, ship_tos: 0, sap_pallets: 0, kg: 0 }
    if (!statuses.length || (flows && !flows.length)) return ok(res, { items: [], total: 0, page, page_size: pageSize, summary: empty })

    let query = db.from('erp_so_lines').select('*', { count: 'exact' }).eq('sync_status', 'ACTIVE')
    if (date_from) query = query.gte('delivery_date', date_from)
    if (date_to)   query = query.lte('delivery_date', date_to)
    if (plant)     query = query.eq('plant', plant)
    query = query.or(`status.in.(${statuses.join(',')})`)
    if (flows?.length) query = query.or(`flow.in.(${flows.join(',')})`)
    if (s) query = query.or([`so_number.ilike.%${s}%`, `material_code.ilike.%${s}%`, `material_name.ilike.%${s}%`, `ship_to_name.ilike.%${s}%`, `ship_to_code.ilike.%${s}%`].join(','))
    if (plants) query = query.or(plantOrFilter(plants))
    query = query.order('delivery_date', { ascending: true }).order('so_number', { ascending: true }).order('so_item', { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1)
    const [{ data, count, error }, sum] = await Promise.all([
      query,
      db.rpc('erp_so_lines_summary', {
        p_from: date_from || null, p_to: date_to || null,
        p_plants: plant ? [plant] : plants, p_status: statuses, p_flows: flows?.length ? flows : null, p_q: s || null,
      }),
    ])
    if (error) throw new Error(error.message)
    if (sum.error) throw new Error(sum.error.message)
    // Cờ "được lên xe" tính tại chỗ từ flow (một nguồn LOADABLE_FLOWS) để FE không chép danh sách
    const items = (data ?? []).map(r => ({ ...r, loadable: LOADABLE_FLOWS.has(String(r.flow)) }))
    return ok(res, { items, total: count ?? 0, page, page_size: pageSize, summary: sum.data })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}
