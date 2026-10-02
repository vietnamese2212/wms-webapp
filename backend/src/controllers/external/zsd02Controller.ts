// Cửa nạp ZSD02 (báo cáo SAP mức dòng SO/OD, 79 cột) — THAY VL06O làm nguồn DO (đợt 0 TMS điều vận, 22/09;
// plan docs/plans/TMS_DISPATCH_PLAN.md). Cùng khuôn với uploadVl06o: preflight 2 pha → nạp CÓ SO SÁNH (giữ id,
// NO-OP dòng y hệt, OBSOLETE dòng SAP đã bỏ) → reconcile → kích hoạt chuyến chờ. Khác ở chỗ: (1) tách hai sổ —
// dòng CÓ OD vào `erp_outbound_orders`, MỌI dòng vào sổ SO `erp_so_lines` (dòng chưa OD chỉ sống ở đó);
// (2) nuôi luôn `sap_route` + địa lý `Customer`. Bộ đọc là hàm thuần ở services/zsd02Parse (test trên file mẫu).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllByIdChunks, fetchAllRowsParallel, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { safeFilterValue } from '../../utils/search'
import { isDay, vnDayOf } from '../../utils/dates'
import { parseListParam } from '../../utils/httpQuery'
import { isPreflight, buildPreflight, type PreflightExtra } from '../../utils/uploadPreflight'
import { expandMergedCells, readWorkbookSafe, parseSheetByHeader, BAD_EXCEL_MSG } from '../../utils/excelHeader'
import { getSapDoSource, getZsd02CoverageMode } from '../../utils/settings'
import { reconcileFromSap, type OdKey } from '../../services/outboundReconcile'
import { sapScopeCheck, activateAwaitingForDos } from '../wms/outboundController'
import { loadSapFlowMap, makeDvvtResolver } from '../../services/sapFlow'
import { upsertCustomerGeo } from '../../services/customerGeo'
import { autoApplyAfterConfigChange, warehousesWithPolicyOn } from '../../services/dateRuleApply'
import { parseZsd02, bizHash, isFlow, ZSD02_FIELDS, ZSD02_BIZ, SO_BIZ, LOADABLE_FLOWS, RAW_VERSION, type Zsd02Mat, type OdRecord } from '../../services/zsd02Parse'
import { allowedPlants, plantOrFilter } from './erpOrderController'
import { findReplacedOds, holdsToCarry, type ReplaceCandidate, type HoldRow } from '../../services/dispatchPool'

const now = () => new Date().toISOString()
const CHUNK = 500
// 29/09: file thật 23.867 dòng ⇒ 46 lô OD + 12 lô SO ghi NỐI TIẾP mất > 60 s (lô 500 dòng × 79 cột ~1,6 s trên staging NANO) —
// Vercel cắt ở 60 s, người dùng bấm Xác nhận nhiều lần mà sổ SO chưa bao giờ được ghi (đo: 18.000/22.943 OD, 0 SO).
// Ghi 4 lô CÙNG LÚC (pool PostgREST ~10 khe, để chỗ cho người khác) + maxDuration 300 ở vercel.json.
const WRITE_PARALLEL = 4
async function upsertChunksParallel<T extends object>(table: 'erp_outbound_orders' | 'erp_so_lines', rows: T[], onConflict: string) {
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK))
  for (let i = 0; i < chunks.length; i += WRITE_PARALLEL) {
    const rs = await Promise.all(chunks.slice(i, i + WRITE_PARALLEL).map(c => db.from(table).upsert(c as never, { onConflict })))
    const bad = rs.find(r => r.error)
    if (bad?.error) throw new Error(bad.error.message)
  }
}
const SO_STATUSES = ['OPEN', 'HAS_OD', 'CANCELLED'] as const
type SoStatus = typeof SO_STATUSES[number]

// ── KHOẢNG PHỦ NGÀY TẠO của file (03/10 tối) ──
// SAP chỉ đổ ZSD02 theo NGÀY TẠO (không có "ngày sửa cuối"), nên app chỉ được kết luận "SAP đã xoá / đã thay" cho OD có ngày tạo
// NẰM TRONG khoảng file phủ. Khoảng = người khai khi nạp (`created_from/created_to`, điền sẵn = min/max ngày tạo OD thật trong
// file); không khai thì lấy khoảng thật của file. Đơn CHƯA ĐI (lịch sử app) có ngày tạo ngoài khoảng ⇒ thiếu phủ: REQUIRE từ chối,
// REMIND cảnh báo (công tắc `zsd02_coverage_mode`).
type CoverageDay = { date: string; ods: number }
type CoverageRpc = { pending_ods: number; sap_posted_ods: number; no_created_date: number; by_od_created: CoverageDay[]; by_so_created: CoverageDay[]; sap_max_od_created: string | null }
export type PlantCoverage = { plant: string; pending_ods: number; required: CoverageDay[]; missing: CoverageDay[]; suggest: { from: string; to: string } | null; sap_max_od_created: string | null }
const dmyOf = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
async function coverageOfPlant(plant: string): Promise<CoverageRpc> {
  const { data, error } = await db.rpc('zsd02_coverage', { p_plant: plant } as never)
  if (error) throw new Error(error.message)
  return (data ?? { pending_ods: 0, sap_posted_ods: 0, no_created_date: 0, by_od_created: [], by_so_created: [], sap_max_od_created: null }) as unknown as CoverageRpc
}
/** Ngày tạo của đơn chưa đi KHÔNG nằm trong khoảng khai. */
function missingCoverage(required: CoverageDay[], declared: { from: string; to: string } | null): CoverageDay[] {
  if (!declared) return required
  return required.filter(d => d.date < declared.from || d.date > declared.to)
}
/** Mỗi lần nạp quá nhiều OD "biến mất" so với đơn chưa đi của plant ⇒ nhiều khả năng KHAI SAI khoảng (file nhỏ hơn khoảng khai) chứ
 *  không phải SAP xoá hàng loạt — đòi người xác nhận tường minh (`confirm_gone=1`) thay vì đánh bỏ cả sổ. */
const GONE_SUSPECT = (pending: number) => Math.max(20, Math.ceil(pending * 0.1))

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
    const coverageErrors: string[] = []

    // ── KHOẢNG PHỦ NGÀY TẠO + đơn chưa đi phải nằm trong khoảng (03/10 tối) ──
    const body = (req.body ?? {}) as Record<string, unknown>
    const bodyDay = (k: string) => (isDay(body[k]) ? String(body[k]) : null)
    const fileCreated = out.od.map(r => r.od_created_at).filter((x): x is string => typeof x === 'string' && x.length === 10).sort()
    const fileRange = fileCreated.length ? { from: fileCreated[0], to: fileCreated[fileCreated.length - 1] } : null
    const declared = (() => {
      const from = bodyDay('created_from') ?? fileRange?.from ?? null, to = bodyDay('created_to') ?? fileRange?.to ?? null
      return from && to && from <= to ? { from, to } : null
    })()
    const coverageMode = await getZsd02CoverageMode()
    const plantsInFile = [...new Set(out.od.map(r => r.plant).filter((x): x is string => !!x))]
    const plantCoverage: PlantCoverage[] = []
    const pendingByPlant = new Map<string, number>()
    for (const plant of plantsInFile) {
      const cov = await coverageOfPlant(plant)
      pendingByPlant.set(plant, Number(cov.pending_ods) || 0)
      const required = cov.by_od_created
      const missing = missingCoverage(required, declared)
      const suggest = required.length ? { from: required[0].date, to: required[required.length - 1].date } : null
      plantCoverage.push({ plant, pending_ods: Number(cov.pending_ods) || 0, required, missing, suggest, sap_max_od_created: cov.sap_max_od_created })
      if (missing.length) {
        const msg = `Plant ${plant} — file chưa phủ ngày tạo của ${missing.reduce((a, d) => a + d.ods, 0)} đơn chưa đi: ${missing.slice(0, 8).map(d => `${dmyOf(d.date)} (${d.ods} OD)`).join(', ')}${missing.length > 8 ? ` … +${missing.length - 8} ngày` : ''}. Đổ lại ZSD02 với Ngày tạo từ ${suggest ? dmyOf(suggest.from) : '?'} đến ${suggest ? dmyOf(suggest.to) : '?'}${declared ? ` (file này khai ${dmyOf(declared.from)} → ${dmyOf(declared.to)})` : ''}.`
        if (coverageMode === 'REQUIRE') coverageErrors.push(`Phủ ngày tạo — ${msg}`); else warnings.push(`Phủ ngày tạo: ${msg}`)
      }
      // E15 — file CŨ hơn sổ: khoảng khai kết thúc trước ngày tạo OD mới nhất sổ đã có ⇒ nạp lại file cũ sẽ "xoá" oan OD mới hơn
      if (declared && cov.sap_max_od_created && declared.to < cov.sap_max_od_created) {
        const msg = `Plant ${plant} — file kết thúc ở ngày tạo ${dmyOf(declared.to)} nhưng sổ đã có OD tạo tới ${dmyOf(cov.sap_max_od_created)}: đây là file CŨ hơn sổ. Nạp file cũ không xoá OD mới hơn, nhưng mọi "SAP đã sửa/bỏ" trong khoảng ${dmyOf(declared.from)} → ${dmyOf(declared.to)} sẽ được coi là thật.`
        if (body.allow_old === '1' || coverageMode !== 'REQUIRE') warnings.push(`File cũ: ${msg}`); else coverageErrors.push(`File cũ — ${msg} Tick "Đúng là tôi muốn nạp file cũ hơn" để nạp.`)
      }
    }
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
    // SO SỬA ⇒ OD MỚI (25/09): OD cũ VẮNG file bị cửa trên để nguyên ("vắng cả OD" là mơ hồ) ⇒ OD cũ vẫn ACTIVE và
    // Điều vận có thể xếp CẢ OD cũ lẫn OD mới — một đơn đi hai lần. Có bằng chứng thì kết luận: cùng (SO, item) mang OD
    // mới trong file, ngày giao OD cũ nằm trong khoảng ngày của file. Luật thuần ở services/dispatchPool (có test).
    const fileSos = [...new Set(out.od.map(r => String(r.so_number ?? '')).filter(Boolean))]
    const priorBySo = await fetchAllByIdChunks(fileSos, chunk => db.from('erp_outbound_orders')
      .select('od_number, od_item, so_number, so_item, delivery_date, mat_doc, qty_issued_base, od_created_at')
      .in('so_number', chunk).eq('sync_status', 'ACTIVE').order('id')) as ReplaceCandidate[]
    // 03/10 tối: kết luận "thay" chỉ trong KHOẢNG PHỦ ngày tạo đã khai; OD cũ ngoài khoảng ⇒ tín hiệu `uncertain` cho người quyết
    const rep = findReplacedOds(out.od.map(r => ({ od_number: String(r.od_number), so_number: r.so_number ?? null, so_item: r.so_item ?? null, delivery_date: r.delivery_date ?? null })), priorBySo, declared)
    const replacedOds = [...new Set(rep.replaced.map(r => r.od_number))]
    const repPairs = [...new Map(rep.replaced.map(r => [r.od_number, r.by])).entries()]
    const splitN = rep.edges.filter(e => e.kind === 'SPLIT').length, mergeN = rep.edges.filter(e => e.kind === 'MERGE').length
    if (repPairs.length) warnings.push(`${repPairs.length} OD cũ đã được SAP THAY bằng OD mới (sửa SO${splitN ? ` · ${splitN} cặp là TÁCH 1→nhiều` : ''}${mergeN ? ` · ${mergeN} cặp là GỘP nhiều→1` : ''}) — OD cũ sẽ bị bỏ, xe nào đang chở OD cũ sẽ được báo; phả hệ ghi vào od_lineage: ${repPairs.slice(0, 15).map(([a, b]) => `${a} → ${b}`).join(' · ')}${repPairs.length > 15 ? '…' : ''}`)
    if (rep.shipped_conflicts.length) warnings.push(`${rep.shipped_conflicts.length} dòng SO có OD MỚI trong khi OD cũ ĐÃ POST ở SAP — app không tự bỏ OD đã post; OD mới mang cờ đỏ "họ hàng đã đi" và rào DB không cho đi ngày khác: ${rep.shipped_conflicts.slice(0, 15).map(x => `${x.so}: ${x.od_number} (đã post) + ${x.by}`).join(' · ')}`)
    if (rep.uncertain.length) warnings.push(`${rep.uncertain.length} dòng SO có OD MỚI trong khi OD cũ (tạo NGOÀI khoảng ngày tạo của file) không có mặt — thay thế hay giao thêm? App KHÔNG kết luận; OD cũ giữ nguyên, kiểm ở Điều vận → Xem đơn: ${rep.uncertain.slice(0, 15).map(x => `${x.so}: ${x.od_number} ? ${x.by}`).join(' · ')}`)
    // E4 — OD BIẾN MẤT khỏi file dù ngày tạo nằm trong khoảng phủ, không có OD thay cùng SO Item ⇒ SAP đã xoá (bản cũ chỉ bắt được
    // Item mất trong DO còn hiện diện). OD đã post thì không bỏ (chỉ cảnh báo). Quá nhiều ⇒ nghi khai sai khoảng, đòi xác nhận.
    const goneKeys: OdKey[] = []
    const goneOds: string[] = []
    let goneBlocked = false
    if (declared) {
      const fileDoSet = new Set(odNumbers)
      const handled = new Set([...replacedOds, ...rep.shipped_conflicts.map(x => x.od_number), ...rep.uncertain.map(x => x.od_number)])
      const posted: string[] = []
      for (const plant of plantsInFile) {
        const rows = (await fetchAllRowsParallel(() => db.from('erp_outbound_orders')
          .select('od_number, od_item, mat_doc, qty_issued_base')
          .eq('plant', plant).eq('sync_status', 'ACTIVE').not('od_number', 'is', null)
          .gte('od_created_at', declared.from).lte('od_created_at', declared.to).order('id'))) as { od_number: string; od_item: string; mat_doc: string | null; qty_issued_base: number | string | null }[]
        const byOd = new Map<string, typeof rows>()
        for (const r of rows) { if (fileDoSet.has(r.od_number) || handled.has(r.od_number)) continue; const l = byOd.get(r.od_number) ?? []; l.push(r); byOd.set(r.od_number, l) }
        for (const [od, rs] of byOd) {
          if (rs.some(r => (r.mat_doc && String(r.mat_doc).trim()) || Number(r.qty_issued_base ?? 0) > 0)) { posted.push(od); continue }
          goneOds.push(od); for (const r of rs) goneKeys.push({ od_number: od, od_item: r.od_item })
        }
      }
      const pendingTotal = [...pendingByPlant.values()].reduce((a, b) => a + b, 0)
      if (goneOds.length) {
        if (goneOds.length > GONE_SUSPECT(pendingTotal) && body.confirm_gone !== '1') {
          goneBlocked = true
          coverageErrors.push(`SAP xoá hàng loạt? — ${goneOds.length} OD có ngày tạo trong khoảng ${dmyOf(declared.from)} → ${dmyOf(declared.to)} không còn trong file (vd ${goneOds.slice(0, 6).join(', ')}). Nhiều hơn mức thường (${GONE_SUSPECT(pendingTotal)}) nên nghi khoảng khai rộng hơn file thật. Kiểm lại khoảng Ngày tạo đã khai; nếu đúng là SAP xoá, tick "Đúng là SAP đã xoá các OD này" rồi nạp lại.`)
        } else warnings.push(`${goneOds.length} OD không còn trong file dù ngày tạo nằm trong khoảng phủ ⇒ SAP đã XOÁ, app đánh dấu "SAP đã bỏ" (xe đang chở sẽ được báo): ${goneOds.slice(0, 15).join(', ')}${goneOds.length > 15 ? '…' : ''}`)
      }
      if (posted.length) warnings.push(`${posted.length} OD đã post không còn trong file (trong khoảng phủ) — giữ nguyên, chỉ ghi nhận: ${posted.slice(0, 10).join(', ')}${posted.length > 10 ? '…' : ''}`)
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
        ...(replacedOds.length ? [{ label: 'OD cũ bị thay bằng OD mới (SO sửa)', value: replacedOds.length, warn: true }] : []),
        ...(rep.shipped_conflicts.length ? [{ label: 'SO có OD mới mà OD cũ đã post', value: rep.shipped_conflicts.length, warn: true }] : []),
        ...(rep.uncertain.length ? [{ label: 'SO có OD mới, OD cũ ngoài khoảng file (chưa kết luận)', value: rep.uncertain.length, warn: true }] : []),
        ...(goneOds.length ? [{ label: 'OD biến mất trong khoảng phủ → SAP đã xoá', value: goneOds.length, warn: true }] : []),
        { label: 'Khoảng ngày tạo khai', value: declared ? `${dmyOf(declared.from)} → ${dmyOf(declared.to)}` : '—' },
        ...plantCoverage.map(p => ({ label: `Đơn chưa đi plant ${p.plant}`, value: p.missing.length ? `${p.pending_ods} · thiếu ${p.missing.length} ngày` : `${p.pending_ods} · phủ đủ`, warn: p.missing.length > 0 })),
        { label: 'Phân loại', value: Object.entries(st.flows).map(([k, v]) => `${k} ${v}`).join(' · ') },
      ]
      return ok(res, { ...buildPreflight({ unit: 'dòng', total: st.rows, toInsert: odInserted + soInserted, toUpdate: odUpdated + soUpdated, skipped: st.skipped, errors: [...unitErrors, ...coverageErrors], warnings, extra }),
        coverage: { mode: coverageMode, declared, file_range: fileRange, plants: plantCoverage, gone_blocked: goneBlocked, uncertain: rep.uncertain.slice(0, 50) } })
    }

    // Lỗi phủ ngày tạo / file cũ / nghi xoá hàng loạt chặn ở cả cửa ghi (kiểm-trước và ghi là CÙNG một đoạn kiểm — luật uploadPreflight)
    if (coverageErrors.length) {
      return res.status(422).json({ success: false, error: { code: goneBlocked ? 'COVERAGE_SUSPECT' : 'COVERAGE_MISSING', message: coverageErrors.join('\n') },
        coverage: { mode: coverageMode, declared, file_range: fileRange, plants: plantCoverage, gone_blocked: goneBlocked } })
    }

    if (out.unitErrs.size) {
      return res.status(400).json({
        success: false,
        error: { code: 'UNIT_MISMATCH', message: `${out.unitErrs.size} mã có đơn vị không khớp hệ thống — sửa Đơn vị ở trang Mã hàng (hoặc bổ sung nhãn ở utils/sapUnits) rồi up lại.` },
        unit_errors: [...out.unitErrs.values()],
      })
    }

    // ── GHI SỔ OD (đã phân loại ở trên) — chunk 500 ghi song song, OBSOLETE dòng SAP bỏ ──
    await upsertChunksParallel('erp_outbound_orders', odWrite, 'od_number,od_item')
    if (removedKeys.length) {
      await Promise.all(removedKeys.map(k => db.from('erp_outbound_orders')
        .update({ sync_status: 'OBSOLETE', updated_at: t }).eq('od_number', k.od_number).eq('od_item', k.od_item)))
    }
    // OD cũ bị thay: OBSOLETE + ghi OD thay thế (bàn ghép xe đọc cột này để hiện nút "Thay bằng OD mới")
    for (const [old, by] of repPairs) {
      const { error } = await db.from('erp_outbound_orders').update({ sync_status: 'OBSOLETE', replaced_by_od: by, replaced_at: t, updated_at: t })
        .eq('od_number', old).eq('sync_status', 'ACTIVE')
      if (error) throw new Error(error.message)
    }
    // E4 — OD SAP đã xoá (trong khoảng phủ): OBSOLETE, không có OD thay ⇒ bàn ghép xe hiện cờ "SAP đã bỏ OD này"
    for (let i = 0; i < goneOds.length; i += 200) {
      const { error } = await db.from('erp_outbound_orders').update({ sync_status: 'OBSOLETE', updated_at: t })
        .in('od_number', goneOds.slice(i, i + 200)).eq('sync_status', 'ACTIVE')
      if (error) throw new Error(error.message)
    }
    // PHẢ HỆ DO (03/10 tối): mọi cặp cũ → mới (thay · tách · gộp · tạo lại sau post) — rào DB "một đơn một ngày xuất" kiểm trên cả họ
    if (rep.edges.length) {
      const rows = rep.edges.map(e => ({ id: randomUUID(), so_number: e.so_number, so_item: e.so_item, old_od: e.old_od, new_od: e.new_od, kind: e.kind, detected_at: t, source: 'ZSD02', updated_at: t }))
      for (let i = 0; i < rows.length; i += 300) {
        const { error } = await db.from('od_lineage').upsert(rows.slice(i, i + 300), { onConflict: 'old_od,new_od', ignoreDuplicates: true })
        if (error) throw new Error(error.message)
      }
    }
    // OD đang "Không điều" / "Không điều ngày này" mà SAP thay bằng OD mới ⇒ dấu CHUYỂN sang OD mới (user chốt 27/09 khuya) —
    // không chuyển thì OD mới vào lại tab Điều như đơn chưa ai quyết, người đã bảo "không điều" phải quyết lại lần nữa
    if (repPairs.length) {
      const oldHolds = (await fetchAllByIdChunks(repPairs.map(([a]) => a), c => db.from('dispatch_od_hold')
        .select('warehouse_id, od_number, hold_until, reason, created_by').in('od_number', c).order('od_number'))) as HoldRow[]
      if (oldHolds.length) {
        const have = (await fetchAllByIdChunks(repPairs.map(([, b]) => b), c => db.from('dispatch_od_hold').select('warehouse_id, od_number').in('od_number', c).order('od_number'))) as { warehouse_id: string; od_number: string }[]
        const ins = holdsToCarry(oldHolds, repPairs, have, vnDayOf(new Date()) ?? '').map(h => ({ ...h, id: randomUUID(), updated_at: t }))
        if (ins.length) {
          const { error } = await db.from('dispatch_od_hold').insert(ins)
          if (error) throw new Error(error.message)
          warnings.push(`${ins.length} OD mới thay cho OD đang "Không điều" — giữ nguyên dấu Không điều trên OD mới.`)
        }
      }
    }

    // ── GHI SỔ SO ──
    await upsertChunksParallel('erp_so_lines', soWrite, 'so_number,so_item')
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
      // khách vừa có kênh (theo kênh SAP) ⇒ %Date mặc định của kênh áp NGAY cho đơn đang mở — cùng đường sửa kênh ở trang Khách hàng
      if (customers.channel_filled) {
        const whs = await warehousesWithPolicyOn()
        if (whs.length) await autoApplyAfterConfigChange({ scopeWh: whs, actor })
      }
    } catch (e) { console.error('[uploadZsd02] route/customer geo:', e) }

    // ── Reconcile + kích hoạt chuyến chờ — đúng hai hàm VL06O đang gọi ──
    let reconcile: Awaited<ReturnType<typeof reconcileFromSap>> | null = null
    let reconcile_error: string | null = null
    const changedKeys = [...updatedKeys, ...removedKeys, ...goneKeys, ...rep.replaced.map(r => ({ od_number: r.od_number, od_item: r.od_item }))]
    if (changedKeys.length) {
      try { reconcile = await reconcileFromSap(changedKeys, { actor: actor || 'SAP-UPLOAD' }) }
      catch (e) { reconcile_error = String(e); console.error('[reconcileFromSap] uploadZsd02:', e) }
    }
    const activated = await activateAwaitingForDos(req, fileDos, 'uploadZsd02')
    // Khoảng Ngày giao của file — tab "Chưa có OD" lọc theo Ngày giao (không có Ngày nạp) nên FE đặt bộ lọc theo đây
    // để dòng vừa nạp hiện ngay (user 29/09: "tab nào lấy dữ liệu ZSD02 thì làm tương tự")
    const days = out.so.map(r => r.delivery_date).filter((d): d is string => typeof d === 'string' && d.length === 10).sort()
    const delivery_range = days.length ? { from: days[0], to: days[days.length - 1] } : null

    return ok(res, {
      rows: st.rows, skipped_no_key: st.skipped, delivery_range,
      od: { rows: st.od_rows, deliveries: st.od_numbers, inserted: odInserted, updated: odUpdated, noop: odNoop, obsoleted: removedKeys.length, replaced: repPairs.map(([od_number, by]) => ({ od_number, by })), gone: goneOds.length, lineage_edges: rep.edges.length, uncertain: rep.uncertain.length },
      coverage: { mode: coverageMode, declared, file_range: fileRange, plants: plantCoverage },
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
