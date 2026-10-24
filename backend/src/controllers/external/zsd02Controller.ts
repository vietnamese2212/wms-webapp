// Cửa nạp ZSD02 (báo cáo SAP mức dòng SO/OD, 79 cột) — THAY VL06O làm nguồn DO (đợt 0 TMS điều vận, 22/09;
// plan docs/plans/TMS_DISPATCH_PLAN.md). Cùng khuôn với uploadVl06o: preflight 2 pha → nạp CÓ SO SÁNH (giữ id,
// NO-OP dòng y hệt, OBSOLETE dòng SAP đã bỏ) → reconcile → kích hoạt chuyến chờ. Khác ở chỗ: (1) tách hai sổ —
// dòng CÓ OD vào `erp_outbound_orders`, MỌI dòng vào sổ SO `erp_so_lines` (dòng chưa OD chỉ sống ở đó);
// (2) nuôi luôn `sap_route` + địa lý `Customer`. Bộ đọc là hàm thuần ở services/zsd02Parse (test trên file mẫu).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { z, zText } from '../../middlewares/validate'
import { ok, fail, failAny } from '../../utils/response'
import { fetchAllByIdChunks, fetchAllRowsParallel, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { safeFilterValue } from '../../utils/search'
import { isDay, vnDayOf } from '../../utils/dates'
import { parseListParam } from '../../utils/httpQuery'
import { isPreflight, buildPreflight, type PreflightExtra } from '../../utils/uploadPreflight'
import { expandMergedCells, readWorkbookSafe, parseSheetByHeader, BAD_EXCEL_MSG } from '../../utils/excelHeader'
import { getSapDoSource } from '../../utils/settings'
import { reconcileFromSap, type OdKey } from '../../services/outboundReconcile'
import { sapScopeCheck, activateAwaitingForDos, replanKhvcGroups } from '../wms/outboundController'
import { syncTmsPlanFromKhvc } from '../../services/tmsPlanSync'
import { loadSapFlowMap, makeDvvtResolver } from '../../services/sapFlow'
import { upsertCustomerGeo } from '../../services/customerGeo'
import { autoApplyAfterConfigChange, warehousesWithPolicyOn } from '../../services/dateRuleApply'
import { parseZsd02, bizHash, isFlow, ZSD02_FIELDS, ZSD02_BIZ, SO_BIZ, LOADABLE_FLOWS, rawNeedsRefresh, type Zsd02Mat, type OdRecord } from '../../services/zsd02Parse'
import { allowedPlants, plantOrFilter, plantAllowed } from './erpOrderController'
import { soScopedChanges, holdsToCarry, type PriorLine, type HoldRow } from '../../services/dispatchPool'

const uniqStr = (a: string[]) => [...new Set(a.filter(Boolean))]

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

// ── HAI KIỂU NẠP (24/10, user chốt — thay "khoảng phủ ngày tạo OD" + công tắc Nhắc / Bắt buộc của 03/10) ──
// MỌI tính toán với ZSD02 dùng NGÀY TẠO SO (file SAP lọc theo cột này). SO có trong file = BẢN CUỐI của SO đó (services/dispatchPool
// `soScopedChanges`); đơn ĐÃ XUẤT chỉ tính theo app (chuyến Xuất kho hoàn thành) và không bao giờ bị xoá mềm.
//   • LẺ (`PARTIAL`): chỉ các SO trong file — SO vắng file không nói lên gì.
//   • BAO PHỦ (`COVER`): người khai khoảng NGÀY TẠO SO đã lọc ở SAP. File phải chứa ngày tạo SO của MỌI đơn CHƯA XUẤT của plant (thiếu ⇒
//     từ chối cả file) và không có dòng nào ngoài khoảng khai; SO chưa xuất tạo trong khoảng mà vắng file ⇒ SAP đã xoá ⇒ xoá mềm.
// File cũ đè dữ liệu mới (người nạp file xuất từ sáng sau người khác) là QUY ƯỚC ngoài app (user chốt 24/10) — sổ các lần nạp
// (`zsd02_upload_log`) hiện ở hộp upload để người nạp biết.
type CoverageDay = { date: string; ods: number }
type CoverageRpc = { pending_ods: number; no_so_date: number; no_so_date_ods: string[]; by_so_created: CoverageDay[]; oldest: { od_number: string; so_number: string; so_created: string }[] | null }
export type PlantCoverage = { plant: string; pending_ods: number; required: CoverageDay[]; missing: CoverageDay[]; suggest: { from: string; to: string } | null; no_so_date: number }
export type UploadKind = 'COVER' | 'PARTIAL'
const dmyOf = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
async function coverageOfPlant(plant: string): Promise<CoverageRpc> {
  const { data, error } = await db.rpc('zsd02_coverage', { p_plant: plant })
  if (error) throw error   // giữ đối tượng lỗi để fail() dịch statement timeout → 503 QUERY_TIMEOUT
  const d = (data ?? {}) as Partial<CoverageRpc>
  return { pending_ods: Number(d.pending_ods) || 0, no_so_date: Number(d.no_so_date) || 0, no_so_date_ods: d.no_so_date_ods ?? [], by_so_created: d.by_so_created ?? [], oldest: d.oldest ?? null }
}
/** Ngày tạo SO của đơn chưa xuất KHÔNG nằm trong khoảng khai. */
function missingCoverage(required: CoverageDay[], declared: { from: string; to: string }): CoverageDay[] {
  return required.filter(d => d.date < declared.from || d.date > declared.to)
}
/** Nạp bao phủ mà quá nhiều SO "biến mất" so với đơn chưa xuất của plant ⇒ nhiều khả năng file lọc thêm điều kiện khác / khai sai khoảng
 *  chứ không phải SAP xoá hàng loạt — đòi người xác nhận tường minh (`confirm_gone=1`) thay vì xoá mềm cả loạt. */
const GONE_SUSPECT = (pending: number) => Math.max(20, Math.ceil(pending * 0.1))
/** DO ĐÃ XUẤT theo app (Số xe trên Kế hoạch xuất mà chuyến Xuất kho hoàn thành) — một lời gọi, danh sách đi POST body. */
async function shippedInApp(ods: string[]): Promise<Set<string>> {
  if (!ods.length) return new Set()
  const { data, error } = await db.rpc('ods_shipped_in_app', { p_ods: ods })
  if (error) throw error
  return new Set((data ?? []) as string[])
}
const soCreatedOfRaw = (raw: unknown): string | null => {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).so_created : null
  return isDay(v) ? String(v) : null
}

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

    // ── KIỂU NẠP + KHOẢNG NGÀY TẠO SO (24/10) ──
    const body = (req.body ?? {}) as Record<string, unknown>
    const bodyDay = (k: string) => (isDay(body[k]) ? String(body[k]) : null)
    const kind: UploadKind = body.kind === 'COVER' ? 'COVER' : 'PARTIAL'
    // ngày tạo SO của MỌI dòng file — dòng SO chưa có DO chỉ mang ngày này trong raw (sổ SO không có cột riêng)
    const fileSoDates = [...out.od.map(r => r.so_created_at), ...out.so.map(r => soCreatedOfRaw(r.raw))]
      .filter((x): x is string => typeof x === 'string' && isDay(x)).sort()
    const fileRange = fileSoDates.length ? { from: fileSoDates[0], to: fileSoDates[fileSoDates.length - 1] } : null
    const declared = (() => {
      if (kind !== 'COVER') return null
      const from = bodyDay('created_from') ?? fileRange?.from ?? null, to = bodyDay('created_to') ?? fileRange?.to ?? null
      return from && to && from <= to ? { from, to } : null
    })()
    const plantsInFile = uniqStr([...out.od.map(r => String(r.plant ?? '')), ...out.so.map(r => String(r.plant ?? ''))])
    const plantCoverage: PlantCoverage[] = []
    let pendingTotal = 0
    if (kind === 'COVER') {
      if (!declared) coverageErrors.push('Nạp bao phủ — chưa khai khoảng Ngày tạo SO (Từ ≤ Đến) và file không có cột "Thời gian tạo SO" để tự lấy.')
      else {
        const outside = fileSoDates.filter(d => d < declared.from || d > declared.to)
        if (outside.length) coverageErrors.push(`Nạp bao phủ — file có ${outside.length} dòng ngày tạo SO NGOÀI khoảng đã khai ${dmyOf(declared.from)} → ${dmyOf(declared.to)} (vd ${uniqStr(outside).slice(0, 5).map(dmyOf).join(', ')}). Khai đúng khoảng đã lọc ở SAP.`)
        for (const plant of plantsInFile) {
          const cov = await coverageOfPlant(plant)
          pendingTotal += cov.pending_ods
          const required = cov.by_so_created
          const missing = missingCoverage(required, declared)
          const suggest = required.length ? { from: required[0].date, to: required[required.length - 1].date } : null
          plantCoverage.push({ plant, pending_ods: cov.pending_ods, required, missing, suggest, no_so_date: cov.no_so_date })
          if (missing.length) coverageErrors.push(`Phủ ngày tạo SO — Plant ${plant}: file chưa phủ ngày tạo SO của ${missing.reduce((a, d) => a + d.ods, 0)} đơn chưa xuất: ${missing.slice(0, 8).map(d => `${dmyOf(d.date)} (${d.ods} OD)`).join(', ')}${missing.length > 8 ? ` … +${missing.length - 8} ngày` : ''}. Đổ lại ZSD02 với Ngày tạo SO từ ${suggest ? dmyOf(suggest.from) : '?'} đến ${suggest ? dmyOf(suggest.to) : '?'} (file này ${bodyDay('created_from') && bodyDay('created_to') ? 'khai' : 'chỉ có ngày tạo SO'} ${dmyOf(declared.from)} → ${dmyOf(declared.to)}), hoặc nạp kiểu Lẻ.${bodyDay('created_from') && bodyDay('created_to') ? '' : ' Nếu file ĐÃ lọc SAP đúng khoảng đó (ngày thiếu là do SAP xoá hết SO ngày ấy) thì chỉ cần điền khoảng vào ô "Ngày tạo SO từ … đến …" rồi kiểm lại.'}`)
          if (cov.no_so_date) warnings.push(`Plant ${plant}: ${cov.no_so_date} đơn chưa xuất không có ngày tạo SO (${cov.no_so_date_ods.slice(0, 8).join(', ')}${cov.no_so_date > 8 ? '…' : ''}) — bao phủ không kiểm được, app không tự xoá các đơn này. Nạp lẻ SO của chúng để có ngày.`)
        }
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
    // RIÊNG raw GIỮ updated_at — không tính "cập nhật", không kích reconcile (nghiệp vụ không đổi). Raw đã dọn theo hạn giữ (_v 0, 20/10)
    // thì KHÔNG dựng lại.
    type PriorRow = Record<string, unknown> & { id: string; sync_status: string | null; updated_at: string | null; raw_v: string | null }
    const rawStale = (p: PriorRow) => rawNeedsRefresh(p.raw_v)
    const priorOd = await fetchAllByIdChunks(odNumbers, chunk => db.from('erp_outbound_orders')
      .select('id, od_number, od_item, sync_status, updated_at, raw_v:raw->>_v, ' + ZSD02_BIZ.join(', '))
      .in('od_number', chunk).order('id')) as unknown as (PriorRow & { od_number: string; od_item: string })[]
    const priorByKey = new Map(priorOd.map(p => [`${p.od_number}__${p.od_item}`, { id: p.id, hash: bizHash(p, ZSD02_BIZ), updated_at: p.updated_at, stale: rawStale(p), dead: p.sync_status !== 'ACTIVE' }]))
    let odInserted = 0, odUpdated = 0, odNoop = 0, rawRefreshed = 0
    const odWrite: (OdRecord & { id: string })[] = []
    const updatedKeys: OdKey[] = []
    // 24/10 (rà chuỗi điều vận): dòng hàng MỚI của một OD ĐÃ CÓ (SAP thêm mã vào DO cũ) đi đường thêm mới ⇒ không vào danh sách "đổi" nên
    // chuyến Xuất kho của OD đó không bao giờ nhận dòng này. Ghi riêng để dội lại chuyến (cuối hàm).
    const priorDos = new Set(priorOd.map(p => String(p.od_number)))
    const addedLineOds = new Set<string>()
    for (const rec of out.od) {
      const prior = priorByKey.get(`${rec.od_number}__${rec.od_item}`)
      if (!prior) { odWrite.push({ id: randomUUID(), ...rec }); odInserted++; if (priorDos.has(String(rec.od_number))) addedLineOds.add(String(rec.od_number)); continue }
      // 24/10: dòng đã XOÁ MỀM mà file lại có ⇒ SO trong file là bản cuối ⇒ SỐNG LẠI (kể cả y hệt nội dung cũ — trước đây rơi vào NO-OP nên
      // DO nằm OBSOLETE mãi, SO trong file không còn DO nào sống)
      if (!prior.dead && prior.hash === bizHash(rec as Record<string, unknown>, ZSD02_BIZ)) {
        odNoop++
        if (prior.stale && !isPreflight(req)) { odWrite.push({ id: prior.id, ...rec, updated_at: prior.updated_at ?? rec.updated_at }); rawRefreshed++ }
        continue
      }
      odWrite.push({ id: prior.id, ...rec, manual_edited_at: null, ...(prior.dead ? { replaced_by_od: null, replaced_at: null } : {}) }); odUpdated++
      updatedKeys.push({ od_number: String(rec.od_number), od_item: String(rec.od_item) })
    }
    const fileKeys = new Set(out.od.map(r => `${r.od_number}__${r.od_item}`))
    const fileDos = new Set(odNumbers)
    // ── SO TRONG FILE = BẢN CUỐI CỦA SO ĐÓ (24/10) — dòng DO của các SO này vắng file ⇒ xoá mềm, trừ DO ĐÃ XUẤT theo app. Luật thuần ở
    // services/dispatchPool `soScopedChanges` (có test). Thay hai đường cũ: "dòng vắng trong DO có mặt" + "OD vắng trong khoảng phủ ngày tạo
    // OD" (đường cũ để cả A lẫn B + C cùng sống khi A tạo ngoài khoảng khai). ──
    const fileSos = uniqStr([...out.od.map(r => String(r.so_number ?? '')), ...out.so.map(r => String(r.so_number ?? ''))])
    const priorBySo = await fetchAllByIdChunks(fileSos, chunk => db.from('erp_outbound_orders')
      .select('id, od_number, od_item, so_number, so_item')
      .in('so_number', chunk).eq('sync_status', 'ACTIVE').not('od_number', 'is', null).order('id')) as PriorLine[]
    const shipped = await shippedInApp(uniqStr(priorBySo.filter(p => !fileKeys.has(`${p.od_number}__${p.od_item}`)).map(p => p.od_number)))
    const sc = soScopedChanges(
      out.od.map(r => ({ od_number: String(r.od_number), od_item: String(r.od_item), so_number: r.so_number ?? null, so_item: r.so_item ?? null })),
      fileSos, priorBySo, shipped)
    const repPairs = sc.replaced
    const lineDrops = sc.obsolete.filter(o => fileDos.has(o.od_number))   // DO còn trong file, chỉ mất dòng
    const splitN = sc.edges.filter(e => e.kind === 'SPLIT').length, mergeN = sc.edges.filter(e => e.kind === 'MERGE').length
    if (repPairs.length) warnings.push(`${repPairs.length} DO cũ được SAP THAY bằng DO mới cùng dòng SO${splitN ? ` (${splitN} cặp là TÁCH 1→nhiều)` : ''}${mergeN ? ` (${mergeN} cặp là GỘP nhiều→1)` : ''} — DO cũ xoá mềm (giữ lịch sử), xe nào đang chở DO cũ sẽ được báo: ${repPairs.slice(0, 15).map(([a, b]) => `${a} → ${b}`).join(' · ')}${repPairs.length > 15 ? '…' : ''}`)
    if (sc.gone.length) warnings.push(`${sc.gone.length} DO không còn trong SO của file ⇒ SAP đã BỎ, xoá mềm (xe đang chở sẽ được báo): ${sc.gone.slice(0, 15).join(', ')}${sc.gone.length > 15 ? '…' : ''}`)
    if (lineDrops.length) warnings.push(`${lineDrops.length} dòng hàng SAP đã bỏ khỏi DO còn trong file ⇒ xoá mềm dòng đó: ${lineDrops.slice(0, 10).map(o => `${o.od_number}/${o.od_item}`).join(', ')}${lineDrops.length > 10 ? '…' : ''}`)
    if (sc.kept_shipped.length) warnings.push(`${sc.kept_shipped.length} DO ĐÃ XUẤT (chuyến Xuất kho hoàn thành) không còn trong file — GIỮ NGUYÊN, không xoá: ${sc.kept_shipped.slice(0, 10).join(', ')}${sc.kept_shipped.length > 10 ? '…' : ''}${sc.edges.some(e => e.kind === 'AFTER_POST') ? '. DO mới cùng dòng SO với đơn đã đi ⇒ Điều vận → Cần xử lý: chọn "Phần đã đi" hoặc "Giao thêm".' : ''}`)
    // ── NẠP BAO PHỦ: SO chưa xuất tạo trong khoảng khai, thuộc plant của file, mà vắng file ⇒ SAP đã xoá cả SO ──
    let coverGone: { id: string; od_number: string; od_item: string; so_number: string }[] = []
    let coverKeptShipped = 0
    let goneBlocked = false
    if (kind === 'COVER' && declared && !coverageErrors.length) {
      const { data, error } = await db.rpc('zsd02_cover_gone', { p_plants: plantsInFile, p_from: declared.from, p_to: declared.to, p_file_sos: fileSos })
      if (error) throw error
      const r = (data ?? {}) as { lines?: typeof coverGone; kept_shipped?: number }
      coverGone = r.lines ?? []
      coverKeptShipped = Number(r.kept_shipped) || 0
      const goneSos = uniqStr(coverGone.map(x => x.so_number))
      if (goneSos.length) {
        if (goneSos.length > GONE_SUSPECT(pendingTotal) && body.confirm_gone !== '1') {
          goneBlocked = true
          coverageErrors.push(`SAP xoá hàng loạt? — ${goneSos.length} SO chưa xuất có ngày tạo trong khoảng ${dmyOf(declared.from)} → ${dmyOf(declared.to)} không còn trong file (vd ${goneSos.slice(0, 6).join(', ')}). Nhiều hơn mức thường (${GONE_SUSPECT(pendingTotal)}) nên nghi file lọc thêm điều kiện khác (Sloc, kênh…) hoặc khai sai khoảng. Kiểm lại; nếu đúng là SAP xoá, tick "Đúng là SAP đã xoá các SO này" rồi nạp lại.`)
        } else warnings.push(`${goneSos.length} SO chưa xuất (${uniqStr(coverGone.map(x => x.od_number)).length} DO) có ngày tạo trong khoảng phủ mà không còn trong file ⇒ SAP đã XOÁ, xoá mềm (xe đang chở sẽ được báo): ${goneSos.slice(0, 15).join(', ')}${goneSos.length > 15 ? '…' : ''}`)
      }
      if (coverKeptShipped) warnings.push(`${coverKeptShipped} DO ĐÃ XUẤT thuộc SO vắng file — giữ nguyên.`)
    }
    const coverGoneOds = uniqStr(coverGone.map(x => x.od_number))
    // SỔ SO: cùng khuôn theo khoá (so_number, so_item)
    const soNumbers = [...new Set(out.so.map(r => String(r.so_number)))]
    const priorSo = await fetchAllByIdChunks(soNumbers, chunk => db.from('erp_so_lines')
      .select('id, so_number, so_item, sync_status, updated_at, raw_v:raw->>_v, ' + SO_BIZ.join(', '))
      .in('so_number', chunk).order('id')) as unknown as (PriorRow & { so_number: string; so_item: string; sync_status: string })[]
    const priorSoByKey = new Map(priorSo.map(p => [`${p.so_number}__${p.so_item}`, { id: p.id, hash: bizHash(p, SO_BIZ), updated_at: p.updated_at, stale: rawStale(p), sync_status: p.sync_status }]))
    let soInserted = 0, soUpdated = 0, soNoop = 0
    const soWrite: (typeof out.so[number] & { id: string })[] = []
    for (const rec of out.so) {
      const prior = priorSoByKey.get(`${rec.so_number}__${rec.so_item}`)
      if (!prior) { soWrite.push({ id: randomUUID(), ...rec }); soInserted++; continue }
      if (prior.sync_status !== 'OBSOLETE' && prior.hash === bizHash(rec as Record<string, unknown>, SO_BIZ)) {   // xoá mềm mà file lại có ⇒ sống lại
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
        { label: 'Kiểu nạp', value: kind === 'COVER' ? 'Bao phủ' : 'Lẻ (chỉ SO trong file)' },
        ...(lineDrops.length + soObsoleteIds.length ? [{ label: 'Dòng SAP đã bỏ → xoá mềm', value: lineDrops.length + soObsoleteIds.length, warn: true }] : []),
        ...(repPairs.length ? [{ label: 'DO cũ bị SAP thay bằng DO mới (xoá mềm)', value: repPairs.length, warn: true }] : []),
        ...(sc.gone.length ? [{ label: 'DO SAP đã bỏ khỏi SO (xoá mềm)', value: sc.gone.length, warn: true }] : []),
        ...(sc.kept_shipped.length + coverKeptShipped ? [{ label: 'DO đã xuất vắng file → giữ nguyên', value: sc.kept_shipped.length + coverKeptShipped, warn: true }] : []),
        ...(coverGoneOds.length ? [{ label: 'SO SAP đã xoá (bao phủ) → xoá mềm DO', value: `${uniqStr(coverGone.map(x => x.so_number)).length} SO · ${coverGoneOds.length} DO`, warn: true }] : []),
        ...(declared ? [{ label: 'Khoảng ngày tạo SO khai', value: `${dmyOf(declared.from)} → ${dmyOf(declared.to)}` }] : []),
        ...plantCoverage.map(p => ({ label: `Đơn chưa xuất plant ${p.plant}`, value: p.missing.length ? `${p.pending_ods} · thiếu ${p.missing.length} ngày tạo SO` : `${p.pending_ods} · phủ đủ`, warn: p.missing.length > 0 })),
        { label: 'Phân loại', value: Object.entries(st.flows).map(([k, v]) => `${k} ${v}`).join(' · ') },
      ]
      return ok(res, { ...buildPreflight({ unit: 'dòng', total: st.rows, toInsert: odInserted + soInserted, toUpdate: odUpdated + soUpdated, skipped: st.skipped, errors: [...unitErrors, ...coverageErrors], warnings, extra }),
        coverage: { kind, declared, file_range: fileRange, plants: plantCoverage, gone_blocked: goneBlocked } })
    }

    // Lỗi phủ ngày tạo SO / dòng ngoài khoảng / nghi xoá hàng loạt chặn ở cả cửa ghi (kiểm-trước và ghi là CÙNG một đoạn kiểm — luật uploadPreflight)
    if (coverageErrors.length) {
      return res.status(422).json({ success: false, error: { code: goneBlocked ? 'COVERAGE_SUSPECT' : 'COVERAGE_MISSING', message: coverageErrors.join('\n') },
        coverage: { kind, declared, file_range: fileRange, plants: plantCoverage, gone_blocked: goneBlocked } })
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
    // XOÁ MỀM theo id (dòng còn giữ — trigger chép bản cũ vào erp_od_versions). Dòng có DO thay mang replaced_by_od (bàn ghép xe đọc cột
    // này để hiện "SAP thay bằng …"); gom theo DO thay để mỗi nhóm một câu, chunk 300 id. Lỗi từng câu ném (24/10: bản cũ nuốt lỗi).
    const softDrop = new Map<string, string[]>()   // DO thay ('' = không có) → id dòng
    for (const o of [...sc.obsolete, ...coverGone.map(x => ({ id: x.id, by: null }))]) { const k = o.by ?? ''; const l = softDrop.get(k) ?? []; l.push(o.id); softDrop.set(k, l) }
    for (const [by, ids] of softDrop) {
      const patch = by ? { sync_status: 'OBSOLETE', replaced_by_od: by, replaced_at: t, updated_at: t } : { sync_status: 'OBSOLETE', updated_at: t }
      for (let i = 0; i < ids.length; i += 300) {
        const { error } = await db.from('erp_outbound_orders').update(patch).in('id', ids.slice(i, i + 300)).eq('sync_status', 'ACTIVE')
        if (error) throw error
      }
    }
    // SO SAP đã xoá (bao phủ): dòng sổ SO của các SO đó cũng hết hiệu lực
    const coverGoneSos = uniqStr(coverGone.map(x => x.so_number))
    for (let i = 0; i < coverGoneSos.length; i += 300) {
      const { error } = await db.from('erp_so_lines').update({ sync_status: 'OBSOLETE', updated_at: t }).in('so_number', coverGoneSos.slice(i, i + 300)).eq('sync_status', 'ACTIVE')
      if (error) throw error
    }
    // PHẢ HỆ DO (03/10 tối): mọi cặp cũ → mới (thay · tách · gộp · DO mới cùng dòng SO với DO đã xuất) — rào DB "một đơn một ngày xuất"
    // kiểm trên cả họ
    if (sc.edges.length) {
      const rows = sc.edges.map(e => ({ id: randomUUID(), so_number: e.so_number, so_item: e.so_item, old_od: e.old_od, new_od: e.new_od, kind: e.kind, detected_at: t, source: 'ZSD02', updated_at: t }))
      for (let i = 0; i < rows.length; i += 300) {
        const { error } = await db.from('od_lineage').upsert(rows.slice(i, i + 300), { onConflict: 'old_od,new_od', ignoreDuplicates: true })
        if (error) throw error
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
          if (error) throw error
          warnings.push(`${ins.length} OD mới thay cho OD đang "Không điều" — giữ nguyên dấu Không điều trên OD mới.`)
        }
      }
    }

    // ── GHI SỔ SO ──
    await upsertChunksParallel('erp_so_lines', soWrite, 'so_number,so_item')
    const soObsoleted = soObsoleteIds.length
    for (let i = 0; i < soObsoleteIds.length; i += 300) {
      const { error } = await db.from('erp_so_lines').update({ sync_status: 'OBSOLETE', updated_at: t }).in('id', soObsoleteIds.slice(i, i + 300))
      if (error) throw error
    }

    // ── Tuyến SAP + địa lý khách hàng (AUGMENT — lỗi không làm hỏng upload cốt lõi) ──
    let routesWritten = 0
    let customers: Awaited<ReturnType<typeof upsertCustomerGeo>> | null = null
    try {
      const routeRows = [...out.routes.values()].map(r => ({ ...r, updated_at: t }))
      for (let i = 0; i < routeRows.length; i += CHUNK) {
        const { error } = await db.from('sap_route').upsert(routeRows.slice(i, i + CHUNK), { onConflict: 'route_code' })
        if (error) throw error
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
    const changedKeys: OdKey[] = [...updatedKeys, ...sc.obsolete.map(o => ({ od_number: o.od_number, od_item: o.od_item })), ...coverGone.map(o => ({ od_number: o.od_number, od_item: o.od_item }))]
    if (changedKeys.length) {
      try { reconcile = await reconcileFromSap(changedKeys, { actor: actor || 'SAP-UPLOAD' }) }
      catch (e) { reconcile_error = String(e); console.error('[reconcileFromSap] uploadZsd02:', e) }
    }
    const activated = await activateAwaitingForDos(req, fileDos, 'uploadZsd02')
    // 24/10 (rà chuỗi điều vận): SAP sửa số lượng / thêm dòng cho OD đã nằm trên xe ⇒ reconcile chỉ vá dòng hàng ĐÃ CÓ của chuyến; dòng mới
    // không vào, lệnh VC giữ pallet / tấn cũ. Dội lại các Số xe chưa bắt đầu / tạm dừng chứa các OD đó (dựng lại dòng hàng theo ZSD02 hiện tại,
    // giữ phần kho đã làm — luật gộp 23/10); chuyến đang xuất / đã xong không dội (kho đang cầm — reconcile + Cần xử lý lo) nhưng lệnh VC
    // cập nhật số. Lỗi không làm hỏng lượt nạp: trả `chain_error` để màn báo.
    let chain: { replanned: number; tms_updated: number } | null = null
    let chain_error: string | null = null
    {
      const touchedOds = uniqStr([...updatedKeys.map(k => k.od_number), ...addedLineOds])
      if (touchedOds.length && !isPreflight(req)) {
        try {
          const kl = (await fetchAllByIdChunks(touchedOds, c => db.from('khvc_lines').select('group_code').in('do_no', c).neq('sync_status', 'OBSOLETE').order('group_code'))) as { group_code: string }[]
          const gcs = uniqStr(kl.map(k => k.group_code))
          if (gcs.length) {
            const gd = (await fetchAllByIdChunks(gcs, c => db.from('GroupDeliveryOrder').select('group_code, status, plan_dropped').in('group_code', c).order('group_code'))) as { group_code: string; status: string; plan_dropped: boolean | null }[]
            const open = gd.filter(g => !g.plan_dropped && (g.status === 'PENDING' || g.status === 'PAUSED')).map(g => g.group_code)
            const rest = gd.filter(g => !g.plan_dropped && !open.includes(g.group_code)).map(g => g.group_code)
            const CAP = 150   // ~0,2 s / xe — nạp quá đông xe một lượt thì phần dư người bấm Thử lại ở Điều vận
            const rp = open.length ? await replanKhvcGroups(req, open.slice(0, CAP)) : null
            const tms = rest.length ? await syncTmsPlanFromKhvc(req, rest) : null
            const errs = [...(((rp?.errors as string[] | undefined) ?? [])), ...(tms?.errors ?? [])]
            if (open.length > CAP) errs.push(`${open.length - CAP} Số xe chưa dội (vượt ${CAP} xe một lượt) — vào Điều vận bấm Thử lại / mở kế hoạch ngày đó`)
            chain = { replanned: Math.min(open.length, CAP), tms_updated: tms?.updated ?? 0 }
            if (errs.length) chain_error = errs.join(' · ')
          }
        } catch (e) { chain_error = e instanceof Error ? e.message : String(e); console.error('[uploadZsd02] dội chuyến theo SAP đổi:', e) }
      }
      if (chain_error) warnings.push(`Chưa dội xong chuyến Xuất kho / lệnh VC theo đơn SAP đổi: ${chain_error}`)
    }
    // Khoảng Ngày giao của file — tab "Chưa có OD" lọc theo Ngày giao (không có Ngày nạp) nên FE đặt bộ lọc theo đây
    // để dòng vừa nạp hiện ngay (user 29/09: "tab nào lấy dữ liệu ZSD02 thì làm tương tự")
    const days = out.so.map(r => r.delivery_date).filter((d): d is string => typeof d === 'string' && d.length === 10).sort()
    const delivery_range = days.length ? { from: days[0], to: days[days.length - 1] } : null

    const odSummary = { rows: st.od_rows, deliveries: st.od_numbers, inserted: odInserted, updated: odUpdated, noop: odNoop, obsoleted: lineDrops.length,
      replaced: repPairs.map(([od_number, by]) => ({ od_number, by })), gone: sc.gone.length + coverGoneOds.length, cover_gone_sos: coverGoneSos.length,
      kept_shipped: sc.kept_shipped.length + coverKeptShipped, lineage_edges: sc.edges.length }
    // SỔ CÁC LẦN NẠP — hộp upload hiện để người nạp biết đã nạp gì (user 24/10). Lỗi ghi sổ không làm hỏng lượt nạp đã ghi xong.
    {
      const fileName = typeof body.file_name === 'string' && body.file_name.trim() ? body.file_name.trim().slice(0, 200) : (req.file?.originalname ?? null)
      const range = declared ?? fileRange
      const { error } = await db.from('zsd02_upload_log').insert({
        id: randomUUID(), uploaded_at: t, uploaded_by: actor, file_name: fileName, kind, plants: plantsInFile, so_from: range?.from ?? null, so_to: range?.to ?? null,
        so_count: fileSos.length, od_count: st.od_numbers, row_count: st.rows,
        summary: { od: odSummary, so: { inserted: soInserted, updated: soUpdated, obsoleted: soObsoleted }, warnings: warnings.length }, updated_at: t,
      })
      if (error) { console.error('[uploadZsd02] sổ lần nạp:', error); warnings.push(`Chưa ghi được sổ các lần nạp: ${error.message}`) }
    }

    return ok(res, {
      rows: st.rows, skipped_no_key: st.skipped, delivery_range,
      od: odSummary,
      coverage: { kind, declared, file_range: fileRange, plants: plantCoverage },
      raw_refreshed: rawRefreshed,
      so: { rows: st.so_rows, orders: st.so_numbers, without_od: soWithoutOd, inserted: soInserted, updated: soUpdated, noop: soNoop, obsoleted: soObsoleted, unresolved: st.so_unresolved, cancelled: st.cancelled },
      flows: st.flows, not_loadable: st.not_loadable,
      routes: routesWritten, customers,
      sap_unmapped: scope.unmapped,
      reconcile, reconcile_error, ...(activated ? { activated } : {}), ...(chain ? { chain } : {}), ...(chain_error ? { chain_error } : {}),
      warning_count: warnings.length, warnings: warnings.slice(0, 50),
    })
  } catch (e) { return failAny(res, e) }
}

// GET /external/do-sap/upload-log?plant=&limit= — SỔ CÁC LẦN NẠP ZSD02 (24/10, user: "trong bảng up file hãy cho lịch sử để người ta biết mà
// up"). Cắt theo plant trong phạm vi; lần nạp nhiều plant hiện nếu giao ≥ 1 plant được phép. Mới nhất trước.
export const zUploadLogQuery = z.object({ plant: zText(1, 20).optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
export async function zsd02UploadLog(req: Request, res: Response) {
  try {
    const q = req.query as unknown as z.infer<typeof zUploadLogQuery>
    const plants = await allowedPlants(req)
    if (q.plant && plants && !plantAllowed(plants, q.plant)) return fail(res, 'Nhà máy (plant) ngoài phạm vi kho được phân quyền', 403)
    let query = db.from('zsd02_upload_log').select('id, uploaded_at, uploaded_by, file_name, kind, plants, so_from, so_to, so_count, od_count, row_count, summary')
      .order('uploaded_at', { ascending: false }).limit(q.limit ?? 30)
    if (q.plant) query = query.contains('plants', [q.plant])
    else if (plants) { if (!plants.length) return ok(res, { items: [] }); query = query.overlaps('plants', plants) }
    const { data, error } = await query
    if (error) throw error
    return ok(res, { items: data ?? [] })
  } catch (e) { return failAny(res, e) }
}

// GET /external/do-sap/versions?od_number= — LỊCH SỬ PHIÊN BẢN một DO (24/10: SAP sửa / xoá thì app xoá mềm + chép bản cũ, "khi cần vẫn
// truy vết được"). Bản hiện tại + các bản cũ (trigger erp_od_version_capture), mới nhất trước. Cắt theo plant như danh sách DO SAP.
export const zVersionsQuery = z.object({ od_number: zText(1, 50) })
export async function doSapVersions(req: Request, res: Response) {
  try {
    const { od_number } = req.query as unknown as z.infer<typeof zVersionsQuery>
    const plants = await allowedPlants(req)
    const [{ data: cur, error: cErr }, { data: vers, error: vErr }] = await Promise.all([
      db.from('erp_outbound_orders').select('od_number, od_item, so_number, so_item, plant, material_code, qty_sales, sales_unit, qty_base, ship_to_code, ship_to_name, delivery_date, sync_status, replaced_by_od, replaced_at, updated_at')
        .eq('od_number', od_number).order('od_item').limit(200),
      db.from('erp_od_versions').select('id, od_item, changed_at, new_status, old_row').eq('od_number', od_number).order('changed_at', { ascending: false }).limit(200),
    ])
    if (cErr) throw cErr
    if (vErr) throw vErr
    if (plants && (cur ?? []).some(r => !plantAllowed(plants, r.plant))) return fail(res, 'DO ngoài phạm vi kho được phân quyền', 403)
    return ok(res, { od_number, current: cur ?? [], versions: vers ?? [] })
  } catch (e) { return failAny(res, e) }
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
    if (error) throw error
    if (sum.error) throw new Error(sum.error.message)
    // Cờ "được lên xe" tính tại chỗ từ flow (một nguồn LOADABLE_FLOWS) để FE không chép danh sách
    const items = (data ?? []).map(r => ({ ...r, loadable: LOADABLE_FLOWS.has(String(r.flow)) }))
    return ok(res, { items, total: count ?? 0, page, page_size: pageSize, summary: sum.data })
  } catch (e) { return failAny(res, e) }
}
