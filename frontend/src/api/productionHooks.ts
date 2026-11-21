// Hook API cho SẢN XUẤT — MES giai đoạn 1 (14/11/2026): mẻ chế biến · rút NVL · bồn · truy xuất sản xuất.
// Tách file riêng khỏi hooks.ts (cùng apiClient). Realtime: realtimeEvents map production_batch / batch_consumption /
// production_tank / tank_lot / tank_movement → các key 'prod-*' dưới đây.
import { useMemo } from 'react'
import type { RecipeImportCatalog } from '@/components/wms/production/recipeTemplate'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiClient } from './client'
import { useWarehouses, useImportShifts, useMaterials, excelUploadBody, type UploadResult, type UploadPreflight } from './hooks'
import { useAuthStore } from '@/stores/authStore'
import type { MatUnits } from '@/utils/qtyUnits'
import type { RawEvent, RawSummary, RawReq, RawFill } from '@/utils/consumptionRaw'
import type { FormBlock } from '@/config/processForms'

export interface ProdWarehouse { id: string; code: string; name: string; parent_warehouse_id: string | null; parent_name: string | null }
/** KHO CHẾ BIẾN người dùng thao tác được = kho phụ nội bộ đang hoạt động mà kho đó HOẶC kho cha của nó nằm trong phạm vi
 *  (cùng luật `inScope` của productionController). `factories` = các kho cha có ít nhất một kho chế biến — cho bộ lọc. */
export function useProductionWarehouses() {
  const user = useAuthStore(s => s.user)
  const q = useWarehouses(true)
  const data = useMemo(() => {
    const all = (q.data ?? []) as { id: string; code: string; name: string; parent_warehouse_id: string | null }[]
    const national = user?.warehouse_scope === 'NATIONAL'
    const ids = new Set(user?.warehouse_ids?.length ? user.warehouse_ids : user?.warehouse_id ? [user.warehouse_id] : [])
    const nameOf = new Map(all.map(w => [w.id, w.name]))
    const kids = all.filter(w => !!w.parent_warehouse_id && (national || ids.size === 0 || ids.has(w.id) || ids.has(w.parent_warehouse_id!)))
      .map(w => ({ id: w.id, code: w.code, name: w.name, parent_warehouse_id: w.parent_warehouse_id, parent_name: nameOf.get(w.parent_warehouse_id!) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    const parentIds = new Set(kids.map(k => k.parent_warehouse_id))
    // chỉ kho nhà máy người dùng được giao (BE inScope kho cha = kho cha phải nằm trong phạm vi) — không thì lọc theo nó ra 403
    const factories = all.filter(w => parentIds.has(w.id) && (national || ids.size === 0 || ids.has(w.id))).map(w => ({ id: w.id, code: w.code, name: w.name }))
    return { kitchens: kids as ProdWarehouse[], factories }
  }, [q.data, user?.warehouse_scope, user?.warehouse_ids, user?.warehouse_id])
  return { ...q, data }
}

/** Kho chế biến mặc định theo bối cảnh Kho toàn cục ở Header: là kho chế biến thì lấy luôn; là kho NHÀ MÁY thì lấy kho chế biến
 *  trực thuộc nó; không thì kho đầu danh sách. `strict` = chỉ trả khi xác định được một kho (form Mở mẻ: không đoán bừa). */
export function defaultKitchen(kitchens: ProdWarehouse[], globalWh: string | null | undefined, strict = false): string {
  const direct = kitchens.find(k => k.id === globalWh)
  if (direct) return direct.id
  const under = kitchens.filter(k => !!globalWh && k.parent_warehouse_id === globalWh)
  if (under.length === 1 || (!strict && under.length)) return under[0].id
  if (kitchens.length === 1 || !strict) return kitchens[0]?.id ?? ''
  return ''
}

/** Ô chọn "Mã bán thành phẩm" (Mở mẻ · Định mức · Hạn lưu bồn) — CHỈ mã đã đánh dấu "Bán thành phẩm" ở Mã hàng (C117, 16/11).
 *  Trước đây ba ô tự lọc "mã tính L / KG" ⇒ chỉ toàn nguyên liệu. Luật nằm ở server (`semi_finished=1`); BE còn chặn ở mọi cửa ghi.
 *  `none` = danh mục chưa có mã BTP nào (ô tìm trống mà không ra dòng) ⇒ màn hình chỉ lối sang Mã hàng. */
export function useSemiFinishedSearch(term: string, enabled: boolean, activeOnly = false) {
  const q = useMaterials({ search: term || undefined, limit: 50, semi_finished: 1, ...(activeOnly ? { active: true as const } : {}) }, enabled)
  const found = q.data ?? []
  return { found, isFetching: q.isFetching, none: enabled && !term && q.isSuccess && !q.isFetching && found.length === 0 }
}
export const SEMI_FINISHED_PLACEHOLDER = 'Tìm mã bán thành phẩm (mã hoặc tên dịch)'

/** (18/11) bỏ "Đóng mẻ" — mẻ chỉ còn OPEN · CANCELLED; tiến độ của mẻ đọc ở `stage` (hàm DB mes_batch_stage) */
export type BatchStatus = 'OPEN' | 'CANCELLED'
export type BatchQa = 'HOLD' | 'RELEASED' | 'REJECTED'

export interface BatchRow {
  id: string; warehouse_id: string; warehouse_name: string; batch_code: string
  material_id: string; material_code: string; material_name: string | null; base_unit: string | null
  machine_code: string | null; shift: string | null; cycle?: string | null; prod_date: string; planned_qty: number | null
  batch_no: number | null; tank_id: string | null; tank_code: string | null; lead_ok_at: string | null; qa_ok_at: string | null
  status: BatchStatus; qa_status: BatchQa; qa_at: string | null; qa_by_name: string | null
  /** tình trạng theo bước (18/11 — hàm DB mes_batch_stage): new · wait_lead · wait_qa · working · filled · released · rejected · cancelled */
  stage: string
  /** mẻ đang làm: BƯỚC ĐANG TỚI (18/11 d — mes_batch_gate.step, cùng giá trị dải bước của trang mẻ): rm · log · label · pour · fill */
  step?: string | null
  note: string | null; opened_by_name: string | null; created_at: string
  rm_lines: number; rm_materials: number; filled: number; in_tank: number
}
/** ô tổng của danh sách mẻ: số mẻ theo từng tình trạng (trong bộ lọc ngày / kho / tìm) + total theo cả lọc tình trạng */
export interface BatchSummary { total: number; new: number; wait_lead: number; wait_qa: number; working: number; filled: number; released: number; rejected: number; cancelled: number }
export interface BatchListParams { warehouse_id?: string; stage?: string; date_from?: string; date_to?: string; search?: string; page?: number; pageSize?: number }

export interface ConsumptionRow {
  id: string; batch_id: string; entry_id: string; pallet_code: string; material_id: string
  production_date: string | null; batch_lot: string | null; qty: number; source: 'SCAN' | 'LOT'
  created_by_name: string | null; created_at: string
  reversed_at: string | null; reversed_by_name: string | null; reverse_reason: string | null
  /** vết luân chuyển lúc cấp (17/11 — cùng bộ cột sổ quét xuất) */
  rotation_violation?: boolean | null; rotation_principle?: string | null; rotation_best_date?: string | null; rotation_override_reason?: string | null
  /** cấp hàng HẾT HẠN đã được QA duyệt cho mẻ (17/11) — id dòng duyệt */
  expiry_approval_id?: string | null
  /** 18/11 — %Date LÚC CẤP (chưa làm tròn, cùng hàm "Lấy ở đâu") + HSD hiệu lực của tem / lô (server tính ở GET mẻ) */
  pct_date?: number | null; expiry_date?: string | null
  material: ({ material_code: string; short_name: string | null } & MatUnits) | null
  entry: { cartons_remaining: number | null; expiry_date: string | null; location: { location_code: string } | null } | null
}
export interface TankMoveRow {
  id: string; tank_id?: string; kind: 'FILL' | 'DRAW' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUST' | 'DISCARD'
  qty: number; packing_run_id: string | null; reason: string | null; warning: string | null
  created_by_name: string | null; created_at: string
  tank?: { code: string } | null; batch?: { batch_code: string } | null
}
export interface BatchLot { id: string; tank_id: string; qty_in: number; qty_remaining: number; filled_at: string; expires_at: string | null; status: 'ACTIVE' | 'EMPTY'; tank: { code: string; unit: string } | null }
/** Một dòng của BÀN LÀM VIỆC CỦA MẺ: nguyên liệu có yêu cầu (required ≠ null) hoặc đã cấp ngoài yêu cầu (required = null). */
export interface BoardRow extends MatUnits {
  material_id: string; material_code: string; material_name: string | null
  required: number | null; note: string | null; sort_order: number
  /** ĐỊNH MỨC GỐC = công thức × kế hoạch (17/11) — null = dòng tự thêm trên mẻ · tol_pct = mức lệch cho phép (%) */
  standard: number | null; tol_pct: number | null
  /** dòng của công thức đã bị bỏ trên mẻ (required = null) · dấu sửa gần nhất · đổi mã */
  removed: boolean; change_reason: string | null; changed_by_name: string | null; changed_at: string | null
  replaces_code: string | null; replaced_by_code: string | null
  consumed: number; lines: number
  /** tồn cấp được ở kho chế biến (không QA giữ, sau giữ chỗ) · phần KHÔNG có tem · số pallet / bao CÓ tem */
  available: number; available_no_tem: number; tem_pallets: number
}
/** Phiếu theo dõi của mẻ: data = { mã_ô: giá_trị }; blocks = bản sửa riêng cho lần này (null = theo mẫu chung) */
export interface ProcessLog {
  id: string; form: string; data: Record<string, string>; blocks: FormBlock[] | null
  /** mốc giờ đã BẤM (17/11): mã ô → người bấm + lúc bấm (+ người sửa tay về sau) */
  stamps?: Record<string, { by?: string; at?: string; edited_by?: string; edited_at?: string }>
  created_by_name: string | null; updated_by_name: string | null; confirmed_at: string | null; confirmed_by_name: string | null; updated_at: string
}
/** CỔNG CỦA MẺ (hàm DB mes_batch_gate — cùng một hàm chặn nạp bồn): hai bước duyệt · tem · quét tại bồn · NVL thiếu · ô bắt buộc */
export interface BatchGate {
  flow_gate: boolean; lead_ok: boolean; qa_ok: boolean; can_consume: boolean
  label_count: number | null; label_valid: boolean; label_ver: number; scanned: number
  short: { material_code: string; name: string | null; required: number; issued: number }[]
  missing: { form: string; title: string; key: string; label: string }[]; need_log: boolean
  fill_blockers: string[]
  /** tình trạng của mẻ (18/11) — cùng hàm mes_batch_stage với danh sách */
  stage?: string
  /** BƯỚC ĐANG TỚI (18/11 d): lead · qa · rm · log · label · pour · fill · tankqa; mẻ xong / huỷ = null — dải bước + cột Tình trạng
   *  của danh sách đọc CÙNG giá trị này (không tự tính ở trình duyệt) */
  step?: string | null
  /** mẻ có phiếu nguyên liệu (dòng yêu cầu chưa bỏ) — chưa có thì bước Cấp nguyên liệu chưa xong */
  has_req?: boolean
}
export interface BatchLabel { pallet_no: number; qr: string }
/** NVL HẾT HẠN (17/11 — "chặn và cho qua khi QA duyệt"): yêu cầu / quyết định QA cho MỘT tem (entry_id) hoặc MỘT lô không tem, của MỘT mẻ */
export interface ExpiryApproval {
  id: string; entry_id: string | null; material_id: string; pallet_code?: string | null; production_date: string | null; batch_lot: string | null
  expiry_date?: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'
  requested_by_name: string | null; requested_at: string | null; decided_by_name: string | null; decided_at: string | null; note: string | null
  material?: ({ material_code: string; short_name: string | null } & MatUnits) | null
}
/** Tình trạng hạn của tem / lô với mẻ: hết hạn chưa · HSD hiệu lực · dòng QA duyệt */
export interface MesExpiry { expired: boolean; expiry_date: string | null; approval: ExpiryApproval | null }
export interface PourScan { pallet_no: number; scanned_by_name: string | null; created_at: string }
export interface BatchDetail {
  cycle: string | null; board: BoardRow[]; process_logs: ProcessLog[]
  /** phiếu bổ sung của mẻ (mã mẫu phiếu) — 17/11 */
  extra_forms: string[]
  batch_no: number | null; tank_id: string | null; tank: { id: string; code: string; name: string | null; capacity: number; unit: string } | null
  lead_ok_at: string | null; lead_ok_by_name: string | null; qa_ok_at: string | null; qa_ok_by_name: string | null
  label_count: number | null; label_ver: number; label_at: string | null; label_by_name: string | null
  gate: BatchGate | null; pour_scans: PourScan[]; labels: BatchLabel[]
  recipe_id: string | null; recipe: { id: string; name: string; base_qty: number; is_active: boolean } | null
  id: string; warehouse_id: string; batch_code: string; material_id: string; machine_code: string | null; shift: string | null
  prod_date: string; planned_qty: number | null; status: BatchStatus; qa_status: BatchQa; qa_by_name: string | null; qa_at: string | null; qa_note: string | null
  note: string | null; opened_by_name: string | null; created_at: string; closed_at: string | null; closed_by_name: string | null
  material: ({ id: string; material_code: string; short_name: string | null; category: string | null; tank_hold_hours: number | null } & MatUnits) | null
  warehouse: { id: string; code: string; name: string; parent_warehouse_id: string | null } | null
  consumption: ConsumptionRow[]; movements: TankMoveRow[]; lots: BatchLot[]
  /** NVL hết hạn: yêu cầu / quyết định QA của mẻ (17/11) */
  expiry_approvals?: ExpiryApproval[]
}
export interface ScanEntry {
  id: string; pallet_code: string; material_id: string; cartons_remaining: number | null; cartons_imported: number | null; cartons_reserved: number | null
  production_date: string | null; expiry_date: string | null; batch: string | null
  /** ngày nhập kho (18/11 — FIFO / LIFO so theo ngày này; hiện "nhập dd-mm-yyyy" trên thẻ tem vừa quét) */
  import_date?: string | null
  qa_status_id?: string | null; qa_status: { code: string; name: string } | null; location: { location_code: string } | null
  material: ({ material_code: string; short_name: string | null } & MatUnits) | null
  /** 17/11: %Date + luân chuyển của tem (như quét xuất) · hạn + QA duyệt của mẻ */
  pct_date?: number | null; rotation?: MesRotation; expiry?: MesExpiry
}
export interface StockMaterial extends MatUnits { material_id: string; material_code: string; material_name: string | null; available: number; available_no_tem?: number; lots: number }
export interface StockLot { production_date: string | null; batch_lot: string | null; expiry_date: string | null; available: number; available_no_tem?: number; tem_pallets?: number; pallets: number }
export interface TankLotView {
  id: string; tank_id: string; batch_id: string; qty_in: number; qty_remaining: number; filled_at: string; expires_at: string | null
  batch: { batch_code: string; batch_no?: number | null; cycle?: string | null; shift?: string | null; qa_status: BatchQa; material: { material_code: string; short_name: string | null } | null } | null
}
/** Mẻ đang mở ĐÃ ĐẶT bồn này mà chưa nạp đủ — phần "sắp vào" */
export interface TankIncoming {
  batch_id: string; batch_code: string; cycle: string | null; batch_no: number | null; material_code: string | null; material_name: string | null; qty: number; started: boolean
  /** 18/11 f — sơ đồ bồn: mẻ đứng trên bồn của nó kèm tình trạng + bước đang tới (cùng hàm cổng với danh sách mẻ) */
  shift?: string | null; created_at?: string; stage?: string | null; step?: string | null
}
export type TankQaState = 'EMPTY' | 'HOLD' | 'RELEASED' | 'REJECTED'
export interface TankRow {
  id: string; warehouse_id: string; code: string; name: string | null; capacity: number; unit: 'L' | 'KG'; is_active: boolean; note: string | null
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string
  warehouse: { code: string; name: string } | null
  content: number; lots: TankLotView[]; qa_pending: boolean; expired: boolean; next_expiry: string | null
  incoming: TankIncoming[]; reserved: number; qa_state: TankQaState
  /** sơ đồ 2D (18/11 g): chỗ đặt trong khu kho chế biến — null = tự xếp */
  map_x: number | null; map_y: number | null
  /** sổ đóng gói ĐANG MỞ rút từ bồn (ống ra của bồn tới máy) */
  runs?: TankRun[]
}
export interface TankRun { id: string; machine_code: string; material_code: string; start_at: string; shift: string | null }
export interface RunTank { id: string; code: string; name: string | null; unit: string; capacity: number; warehouse_id: string; warehouse: { name: string } | null }
export interface GenealogyBatch {
  id: string; batch_code: string; warehouse_id: string; warehouse_name: string; prod_date: string; machine_code: string | null; shift: string | null
  status: BatchStatus; qa_status: BatchQa; material_code: string; material_name: string | null; base_unit: string | null
  materials: { pallet_code: string; material_code: string; material_name: string | null; base_unit: string | null; production_date: string | null; batch_lot: string | null; ncc_name: string | null; qty: number; source: 'SCAN' | 'LOT'; at: string }[]
  runs: { run_id: string; run_date: string; machine_code: string; material_codes: string[]; warehouse_id: string; tank_code: string | null; qty: number; pallets: string[] }[]
}

const K = {
  batches: ['prod-batches'] as const, batch: ['prod-batch'] as const, stock: ['prod-stock'] as const,
  tanks: ['prod-tanks'] as const, moves: ['prod-tank-moves'] as const,
}

/** `enabled` = false khi form chứa nó đang đóng — tham số rỗng nghĩa là "mọi kho", không phải "đừng tải" */
export function useProductionBatches(p: BatchListParams, enabled = true) {
  return useQuery({
    queryKey: [...K.batches, p], enabled, staleTime: 15_000, placeholderData: keepPreviousData,
    queryFn: async () => (await apiClient.get('/wms/production/batches', { params: p })).data.data as { rows: BatchRow[]; summary: BatchSummary; page: number; page_size: number },
  })
}
export function useProductionBatch(id: string | undefined) {
  return useQuery({
    queryKey: [...K.batch, id], enabled: !!id, staleTime: 10_000,
    queryFn: async () => (await apiClient.get(`/wms/production/batches/${id}`)).data.data as BatchDetail,
  })
}
/** Số mẻ kế tiếp của chu kỳ + mã lô sẽ ghép (17/11: <chữ nhà máy><chu kỳ><số mẻ 4 số><mã bồn>). plant = null ⇒ kho chưa khai Mã NMSX. */
export function useNextBatchCode(p: { warehouse_id?: string; cycle?: string; tank_id?: string; batch_no?: number }, enabled = true) {
  return useQuery({
    queryKey: ['prod-next-code', p], enabled: enabled && !!p.warehouse_id, staleTime: 0,
    queryFn: async () => (await apiClient.get('/wms/production/batches/next-code', { params: p })).data.data as { plant: string | null; cycle: string; next_no: number | null; code: string | null },
  })
}
/** Tồn RÚT ĐƯỢC ở kho chế biến: không có `materialId` ⇒ danh sách mã (tìm trên server, ≤50); có ⇒ các lô của mã đó. */
export function useProductionStock(warehouseId: string | undefined, materialId?: string, search?: string) {
  return useQuery({
    queryKey: [...K.stock, warehouseId, materialId ?? '', search ?? ''], enabled: !!warehouseId, staleTime: 5_000,
    queryFn: async () => (await apiClient.get('/wms/production/stock', { params: { warehouse_id: warehouseId, material_id: materialId || undefined, search: search || undefined } })).data.data as { materials?: StockMaterial[]; lots?: StockLot[] },
  })
}
export function useProductionTanks(warehouseId?: string, includeInactive = false, enabled = true) {
  return useQuery({
    queryKey: [...K.tanks, warehouseId ?? '', includeInactive], enabled, staleTime: 10_000,
    queryFn: async () => (await apiClient.get('/wms/production/tanks', { params: { warehouse_id: warehouseId || undefined, include_inactive: includeInactive ? '1' : undefined } })).data.data as TankRow[],
  })
}
/** Lưu chỗ đặt bồn trên sơ đồ 2D (quyền manage_tank) — x / y null = về tự xếp */
export function useSaveTankLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (items: { id: string; x: number | null; y: number | null }[]) =>
      (await apiClient.put('/wms/production/tank-layout', { items })).data.data as { updated: number },
    onSettled: () => { qc.invalidateQueries({ queryKey: K.tanks }) },
  })
}
export function useTankMovements(tankId: string | null) {
  return useQuery({
    queryKey: [...K.moves, tankId], enabled: !!tankId, staleTime: 10_000,
    queryFn: async () => (await apiClient.get(`/wms/production/tanks/${tankId}/movements`)).data.data as { rows: TankMoveRow[]; total: number },
  })
}
export function useTanksForRun(warehouseId: string | undefined) {
  return useQuery({
    queryKey: ['prod-tanks-for-run', warehouseId], enabled: !!warehouseId, staleTime: 60_000,
    queryFn: async () => (await apiClient.get('/wms/production/tanks-for-run', { params: { warehouse_id: warehouseId } })).data.data as RunTank[],
  })
}
export function useGenealogy(kind: 'BATCH' | 'FG_PALLET' | 'RM_PALLET', value: string) {
  return useQuery({
    queryKey: ['prod-genealogy', kind, value], enabled: !!value.trim(), staleTime: 30_000,
    queryFn: async () => (await apiClient.get('/wms/production/genealogy', { params: { kind, value } })).data.data as { batches: GenealogyBatch[] },
  })
}
/** Tra tem quét được trong KHO CỦA MẺ — gọi tay lúc quét (không cache). */
/** Luân chuyển của MỘT tem vừa quét — server chấm bằng CÙNG luật cửa quét xuất (utils/rotation.ts + cấu hình Kho → Loại kho) */
export interface MesRotation {
  principle: 'FEFO' | 'FIFO' | 'LIFO'; required: boolean; source: 'WAREHOUSE' | 'TYPE'; date_label: string
  scanned_date: string | null; violation: boolean; best_date: string | null; best_pallet_code: string | null; best_location_code: string | null
  /** hàng nên lấy trước là hàng KHÔNG tem (chọn ở "Không có tem") — lô / NSX của nó */
  best_no_tem?: boolean; best_lot?: string | null; best_production_date?: string | null
}
/** Một tem (nhóm có tem) hoặc một dòng tồn (lô không tem) trong nhóm của "Lấy ở đâu" */
export interface PickItem {
  entry_id: string; pallet_code: string | null; batch: string | null; location_code: string | null; available: number
  import_date: string | null; expired: boolean; approval: ExpiryApproval | null
}
/** "Lấy ở đâu" GOM THEO DATE (17/11 — như "Tồn kho theo %Date" của Xuất kho): có tem gom theo (ngày · ô · tình trạng), không tem gom theo
 *  LÔ. state: OK = cấp được · EXPIRED = hết hạn chưa QA duyệt · QA = QA giữ. rank 1 = nên lấy trước (chung cả có tem lẫn không tem). */
export interface PickGroup {
  key: string; kind: 'TEM' | 'LOT'; state: 'OK' | 'EXPIRED' | 'QA'; rank: number | null
  /** vị trí trong thứ tự CHUNG của cả có tem lẫn không tem (server xếp) — gộp hai danh sách thì xếp theo số này, không tự so ngày */
  pos?: number
  rot_date: string | null; pct_date: number | null; expiry_date: string | null; production_date: string | null; batch_lot: string | null
  location_code: string | null; locations: string[]; available: number; count: number; qa_name: string | null
  /** nhóm có hàng quá HSD (đã được QA duyệt cho mẻ thì state vẫn là OK) */
  expired: boolean
  /** lấy nhóm này là SAI thứ tự luân chuyển (server chấm) */
  violation: boolean; approval: ExpiryApproval | null; items: PickItem[]
}
export interface PickList {
  principle: 'FEFO' | 'FIFO' | 'LIFO'; required: boolean; source: 'WAREHOUSE' | 'TYPE'; date_label: string; today: string; total: number; truncated: boolean
  best: { kind: 'TEM' | 'LOT'; pallet_code: string | null; location_code: string | null; rot_date: string | null; batch_lot: string | null; production_date: string | null } | null
  tem_groups: PickGroup[]; lot_groups: PickGroup[]
}
export function usePickList(batchId: string | undefined, materialId: string | undefined) {
  return useQuery({
    // dưới tiền tố prod-stock ⇒ cấp xong / realtime batch_consumption tự tải lại
    queryKey: [...K.stock, 'pick-list', batchId, materialId], enabled: !!batchId && !!materialId, staleTime: 5_000,
    queryFn: async () => (await apiClient.get(`/wms/production/batches/${batchId}/pick-list`, { params: { material_id: materialId } })).data.data as PickList,
  })
}
export async function scanCheck(batchId: string, code: string): Promise<ScanEntry> {
  return (await apiClient.get(`/wms/production/batches/${batchId}/scan-check`, { params: { code } })).data.data as ScanEntry
}

// ── Ghi: mọi mutation làm mới đủ key liên quan (mẻ · danh sách mẻ · tồn kho chế biến · bồn · sổ bồn · trang sổ) ──
function useProdMutation<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const k of [K.batches, K.batch, K.stock, K.tanks, K.moves, ['prod-recipes'], ['prod-recipe'], ['prod-shift-reports'], ['prod-shift-report'], ['prod-next-code'], ['prod-genealogy'], ['inventory-entries'], ['inventory-summary'], ['pallet-ledger'], ['packing-run'], ['packing-runs'], ['packing-run-board']])
        void qc.invalidateQueries({ queryKey: k })
    },
  })
}
const post = async <T,>(url: string, body: unknown = {}) => (await apiClient.post(url, body)).data.data as T
const patch = async <T,>(url: string, body: unknown) => (await apiClient.patch(url, body)).data.data as T

// ── Cài đặt MES (14/11 tối): công tắc rút bồn còn lô chờ QA (Kho + Loại kho) · hạn lưu bồn theo mã ──
export interface ProductionSettings {
  warehouse_id: string
  production_qa_gate: string
  /** luồng chặt (17/11): chưa duyệt đủ thì chưa cấp NVL · chưa đủ điều kiện thì chưa nạp bồn */
  mes_flow_gate: boolean
  types: { type_code: string; production_qa_gate: string | null }[]
  hold_hours: { id: string; material_code: string; short_name: string | null; category: string | null; base_unit: string | null; tank_hold_hours: number | null }[]
}
export function useProductionSettings(warehouseId: string | undefined) {
  return useQuery({
    queryKey: ['prod-settings', warehouseId], enabled: !!warehouseId, staleTime: 10_000,
    queryFn: async () => (await apiClient.get('/wms/production/settings', { params: { warehouse_id: warehouseId } })).data.data as ProductionSettings,
  })
}
export function useSaveProductionSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b: { warehouse_id: string; production_qa_gate?: string; mes_flow_gate?: boolean; types?: { type_code: string; production_qa_gate: string | null }[]; hold_hours?: { material_id: string; tank_hold_hours: number | null }[] }) =>
      (await apiClient.put('/wms/production/settings', b)).data.data as ProductionSettings,
    onSuccess: (data, v) => { qc.setQueryData(['prod-settings', v.warehouse_id], data) },
    onSettled: () => {
      for (const k of [['prod-settings'], ['materials'], ['materials-paged'], K.batch, K.tanks, ['warehouses'], ['wh-type-configs']]) void qc.invalidateQueries({ queryKey: k })
    },
  })
}

export interface BatchInput { warehouse_id: string; material_id: string; prod_date: string; cycle: string; batch_no?: number; tank_id: string; machine_code?: string; shift?: string; planned_qty?: number | null; note?: string; recipe_id?: string; extra_forms?: string[] }
export const useCreateBatch = () => useProdMutation((b: BatchInput) => post<BatchDetail>('/wms/production/batches', b))
export const useUpdateBatch = () => useProdMutation(({ id, ...b }: { id: string } & Partial<Omit<BatchInput, 'warehouse_id' | 'machine_code' | 'shift' | 'note' | 'recipe_id'>> & { machine_code?: string | null; shift?: string | null; note?: string | null }) => patch<BatchDetail & { relabel?: boolean }>(`/wms/production/batches/${id}`, b))
/** đặt phiếu bổ sung của mẻ (trưởng ca · QA) — phiếu đã ghi không bỏ được */
export const useSetBatchForms = () => useProdMutation(({ id, forms }: { id: string; forms: string[] }) => apiClient.put(`/wms/production/batches/${id}/forms`, { forms }).then(r => r.data.data as { extra_forms: string[] }))
// ── Luồng của mẻ (17/11): hai bước duyệt · tem pallet · bấm ghi giờ · đổ bồn · QA ở bồn ──
export const useApproveBatch = () => useProdMutation(({ id, step, approve }: { id: string; step: 'lead' | 'qa'; approve: boolean }) => post(`/wms/production/batches/${id}/approve-${step}`, { approve }))
export const useBatchLabels = () => useProdMutation(({ id, count }: { id: string; count: number }) =>
  post<{ batch_code: string; count: number; ver: number; reprint: boolean; labels: BatchLabel[] }>(`/wms/production/batches/${id}/labels`, { count }))
/** PHIẾU GHI TỪNG Ô (18/11 — user: "cho nút ở các input, bấm vào sẽ hiện lên yêu cầu Input, nếu thời gian thì tự lấy thời gian").
 *  value vắng + ô Giờ ⇒ giờ máy chủ; value = '' ⇒ xoá ô. Hiện NGAY (vá cache trang mẻ), tải lại trang mẻ ở nền (cổng · ô bắt buộc). */
export function useLogCell() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ batchId, form, key, value }: { batchId: string; form: string; key: string; value?: string }) =>
      post<{ key: string; value: string | null; changed: boolean }>(`/wms/production/batches/${batchId}/process-log/${form}/cell`, { key, ...(value !== undefined ? { value } : {}) }),
    onSuccess: (r, v) => {
      qc.setQueryData<BatchDetail>([...K.batch, v.batchId], old => {
        if (!old) return old
        const has = old.process_logs.some(l => l.form === v.form)
        const put = (d: Record<string, string>) => { const n = { ...d }; if (r.value == null || r.value === '') delete n[r.key]; else n[r.key] = r.value; return n }
        return { ...old, process_logs: has ? old.process_logs.map(l => (l.form === v.form ? { ...l, data: put(l.data ?? {}) } : l)) : old.process_logs }
      })
    },
    onSettled: (_r, _e, v) => { void qc.invalidateQueries({ queryKey: [...K.batch, v.batchId] }) },
  })
}
/** BẮT ĐẦU phiếu: tạo phiếu (điền sẵn máy / kế hoạch) + giờ máy chủ vào mốc giờ đầu tiên (nếu còn trống) */
export function useLogStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ batchId, form }: { batchId: string; form: string }) =>
      post<{ key: string | null; value: string | null; changed: boolean }>(`/wms/production/batches/${batchId}/process-log/${form}/start`, {}),
    onSettled: (_r, _e, v) => { void qc.invalidateQueries({ queryKey: [...K.batch, v.batchId] }) },
  })
}
export const useTankQa = () => useProdMutation(({ tankId, qa_status, note }: { tankId: string; qa_status: BatchQa; note?: string }) =>
  post<{ batches: number; batch_codes: string }>(`/wms/production/tanks/${tankId}/qa`, { qa_status, note }))
export interface PourView {
  batch: { id: string; batch_code: string; cycle: string | null; batch_no: number | null; planned_qty: number | null; label_count: number | null; label_ver: number; label_at: string | null
    tank_id: string | null; status: BatchStatus; material: { material_code: string; short_name: string | null; base_unit: string | null } | null
    tank: { id: string; code: string; capacity: number; unit: string } | null }
  scans: PourScan[]; gate: BatchGate | null; filled: number
}
/** "Check trước khi đổ bồn" mở từ trang mẻ: tình trạng quét tem của mẻ đó (18/11 — chỉ quét, không khai chu kỳ / số mẻ) — gọi tay, không cache */
export async function fetchPourStatus(batchId: string): Promise<PourView> {
  return (await apiClient.get('/wms/production/pour-status', { params: { batch_id: batchId } })).data.data as PourView
}
/** Quét một tem pallet của mẻ tại bồn. Không gửi batch_id (mở ở thẻ bồn) ⇒ server lấy mẻ từ mã lô in trong tem; sai bồn ⇒ 409 */
export const usePourScan = () => useProdMutation((b: { batch_id?: string; tank_id: string; code: string }) => post<PourView & { pallet_no: number }>('/wms/production/pour-scan', b))
// ── Bàn làm việc của mẻ: yêu cầu nguyên liệu + định mức ──
/** Sửa phiếu của mẻ (quyền edit_requirement, 17/11): có thay đổi thì BẮT BUỘC lý do · `replaces` = đổi mã (dòng mới thay cho mã cũ) */
export const useSetRequirements = () => useProdMutation(({ batchId, items, reason }: { batchId: string; items: { material_id: string; qty: number; replaces?: string }[]; reason?: string }) =>
  (async () => (await apiClient.put(`/wms/production/batches/${batchId}/requirements`, { items, reason })).data.data as { count: number; changed: number })())
/** Chép công thức vào mẻ — recipe_id trống = công thức của mẻ / mặc định; replace = bỏ hết phiếu cũ trước ("đổi công thức") */
export const useApplyRecipe = () => useProdMutation(({ batchId, replace, recipe_id }: { batchId: string; replace?: boolean; recipe_id?: string }) =>
  post<{ count: number; recipe_id?: string; recipe_name?: string }>(`/wms/production/batches/${batchId}/apply-recipe`, { replace, recipe_id }))
type RecipeMat = ({ id: string; material_code: string; short_name: string | null; category: string | null } & MatUnits) | null
/** Một CÔNG THỨC của mã bán thành phẩm (17/11: một mã có nhiều công thức, đúng một công thức mặc định) */
export interface RecipeRow {
  id: string; material_id: string; name: string; base_qty: number; note: string | null; is_active: boolean; is_default: boolean
  updated_at: string; updated_by: string | null; material: RecipeMat; line_count?: number
}
export interface RecipeLine { id: string; material_id: string; qty: number; tol_pct: number | null; sort_order: number; note: string | null; material: RecipeMat }
export interface RecipeDetail extends RecipeRow { lines: RecipeLine[] }
/** materialId = chỉ công thức của mã đó (form Mở mẻ, Đổi công thức) · activeOnly = bỏ công thức đã ngừng */
export function useRecipes(materialId?: string, activeOnly = false, enabled = true) {
  return useQuery({
    queryKey: ['prod-recipes', materialId ?? 'all', activeOnly], enabled, staleTime: 30_000,
    queryFn: async () => (await apiClient.get('/wms/production/recipes', { params: { material_id: materialId, active: activeOnly ? '1' : undefined } })).data.data as RecipeRow[],
  })
}
export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ['prod-recipe', id], enabled: !!id, staleTime: 10_000,
    queryFn: async () => (await apiClient.get(`/wms/production/recipes/${id}`)).data.data as RecipeDetail,
  })
}
export interface RecipeInput {
  id?: string; material_id: string; name: string; base_qty: number; note: string | null; is_active: boolean; is_default: boolean
  lines: { material_id: string; qty: number; tol_pct: number | null }[]
}
/** id có ⇒ sửa công thức đó; trống ⇒ tạo công thức MỚI cho mã */
export const useSaveRecipe = () => useProdMutation(({ id, material_id, ...b }: RecipeInput) =>
  (async () => (id
    ? await apiClient.put(`/wms/production/recipes/${id}`, b)
    : await apiClient.post('/wms/production/recipes', { material_id, ...b })).data.data as { id: string; lines: number; is_default: boolean })())
/** Nạp định mức từ Excel (19/11): preflight = chỉ kiểm, không ghi (khỏi nạp lại danh sách); lần ghi thật làm mới Định mức */
/** Danh sách mã cho file mẫu Nạp định mức (20/11) — gọi khi bấm Tải mẫu, không cache. */
export async function fetchRecipeImportCatalog(): Promise<RecipeImportCatalog> {
  return (await apiClient.get('/wms/production/recipes/import-catalog', { timeout: 60000 })).data.data as RecipeImportCatalog
}

export function useImportRecipes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, preflight }: { file: File; preflight: boolean }): Promise<UploadResult & Partial<UploadPreflight>> => {
      const { body, headers } = await excelUploadBody(file)
      return (await apiClient.post(`/wms/production/recipes/import${preflight ? '?preflight=1' : ''}`, body, { headers, timeout: 120000 })).data.data
    },
    onSuccess: (_d, v) => {
      if (v.preflight) return
      void qc.invalidateQueries({ queryKey: ['prod-recipes'] })
      void qc.invalidateQueries({ queryKey: ['prod-recipe'] })
    },
  })
}
/** blocks: mảng = lưu bản sửa riêng · null = về theo mẫu chung · bỏ trống = giữ nguyên */
/** data vắng = chỉ lưu cấu trúc (18/11 — giá trị ghi từng ô qua useLogCell, lưu cấu trúc không đè giá trị người khác vừa ghi) */
export const useSaveProcessLog = () => useProdMutation(({ batchId, form, data, blocks }: { batchId: string; form: string; data?: Record<string, string>; blocks?: FormBlock[] | null }) =>
  (async () => (await apiClient.put(`/wms/production/batches/${batchId}/process-log/${form}`, { ...(data !== undefined ? { data } : {}), ...(blocks !== undefined ? { blocks } : {}) })).data.data as ProcessLog)())
export const useConfirmProcessLog = () => useProdMutation(({ batchId, form, confirm }: { batchId: string; form: string; confirm: boolean }) =>
  post<ProcessLog>(`/wms/production/batches/${batchId}/process-log/${form}/confirm`, { confirm }))
// ── Mẫu phiếu theo dõi (cấu hình ở Cài đặt MES) ──
/** optional = phiếu BỔ SUNG (chỉ có ở mẻ được chọn) · material_ids = mã BTP mặc định có phiếu này (17/11) */
export interface ProcessFormDef { code: string; title: string; short: string; blocks: FormBlock[]; sort_order: number; is_active: boolean; optional: boolean; material_ids: string[]; updated_by_name: string | null; updated_at: string }
export function useProcessForms() {
  return useQuery({ queryKey: ['prod-process-forms'], staleTime: 60_000,
    queryFn: async () => (await apiClient.get('/wms/production/process-forms')).data.data as ProcessFormDef[] })
}
export function useSaveProcessForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ code, ...b }: { code: string; title: string; short: string; is_active: boolean; sort_order?: number; blocks: FormBlock[]; optional?: boolean; material_ids?: string[] }) =>
      (await apiClient.put(`/wms/production/process-forms/${code}`, b)).data.data as ProcessFormDef,
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['prod-process-forms'] }) },
  })
}
// ── Báo cáo sử dụng NVL theo ca ──
export interface ShiftReportHead {
  id: string; warehouse_id: string; report_date: string; shift: string; from_at: string; to_at: string | null; status: 'OPEN' | 'CLOSED'
  note: string | null; opened_by_name: string | null; closed_by_name: string | null; created_at: string
}
export interface ShiftRow extends MatUnits {
  material_id: string; material_code: string; material_name: string | null
  opening: number; opening_src: 'COUNT' | 'BOOK'; received: number; used: number; book: number; actual: number | null
  by_batch: Record<string, number>
}
export interface ShiftReport {
  report: ShiftReportHead
  batches: { id: string; batch_code: string; cycle: string | null; shift: string | null; machine_code: string | null; material_code: string; material_name: string | null }[]
  rows: ShiftRow[]
}
// ── BÁO CÁO NVL THEO CHU KỲ (18/11 f — chu kỳ lớn hơn ca, mẻ; báo cáo cuối tách ca · mẻ · nhân sự) ────────────────────────────────────
export interface CycleListRow {
  cycle: string; batches: number; cancelled: number; filled: number; first_at: string; last_at: string
  date_from: string | null; date_to: string | null; shifts: string[]; btp: string[]
}
export interface CycleBatch {
  id: string; batch_code: string; batch_no: number | null; shift: string | null; prod_date: string | null
  material_id: string; material_code: string; material_name: string | null; base_unit: string | null
  tank_id: string | null; tank_code: string | null; planned_qty: number | null; status: BatchStatus; qa_status: BatchQa
  stage: string; step: string | null; created_at: string; opened_by_name: string | null
  lead_ok_at: string | null; lead_ok_by_name: string | null; qa_ok_at: string | null; qa_ok_by_name: string | null
  label_at: string | null; label_by_name: string | null; label_count: number | null
  rm_first_at: string | null; rm_last_at: string | null; rm_lines: number
  /** lần cấp sai thứ tự luân chuyển · hàng hết hạn QA duyệt · dòng cấp đã huỷ */
  rm_bad: number; rm_exp: number; rm_rev: number
  filled_qty: number; filled_at: string | null; filled_by_name: string | null; tank_qa_at: string | null; tank_qa_by_name: string | null
}
/** một ô NVL × mẻ (21/11): req = phiếu đang hiệu lực (null = dòng đã bỏ / mã ngoài phiếu) · std = ĐỊNH MỨC GỐC theo công thức (null = dòng
 *  thêm tay / ngoài phiếu) · rm = dòng đã bỏ khỏi phiếu · why = lý do sửa phiếu · mức lệch % · thực cấp · số lần cấp */
export interface CycleCell { req: number | null; std: number | null; rm: boolean; why: string | null; tol: number | null; iss: number; n: number }
export interface CycleRow extends MatUnits { material_id: string; material_code: string; material_name: string | null; cells: Record<string, CycleCell> }
export interface CyclePerson {
  name: string; open: number; lead: number; qaok: number; label: number; rm: number; rm_rev: number; rm_bad: number; rm_exp: number; rm_batches: number
  pour: number; fill: number; tankqa: number; log: number; logok: number; batches: number; shifts: string[]; first_at: string | null; last_at: string | null
}
export interface CycleReport { warehouse_id: string; cycle: string; batches: CycleBatch[]; rows: CycleRow[]; people: CyclePerson[] }
export function useCycles(warehouseId: string | undefined, search = '') {
  return useQuery({
    queryKey: ['prod-cycles', warehouseId, search], enabled: !!warehouseId, staleTime: 15_000, placeholderData: keepPreviousData,
    queryFn: async () => (await apiClient.get('/wms/production/cycles', { params: { warehouse_id: warehouseId, search: search || undefined } })).data.data as CycleListRow[],
  })
}
export function useCycleReport(warehouseId: string | undefined, cycle: string | undefined) {
  return useQuery({
    queryKey: ['prod-cycle', warehouseId, cycle], enabled: !!warehouseId && !!cycle, staleTime: 10_000,
    queryFn: async () => (await apiClient.get('/wms/production/cycles/report', { params: { warehouse_id: warehouseId, cycle } })).data.data as CycleReport,
  })
}
/** DỮ LIỆU THÔ TIÊU HAO NVL (18/11 g — "để làm việc với ERP SAP"): mỗi dòng một phát sinh Cấp (+) / Huỷ cấp (−). Lọc theo ngày của phát sinh
 *  (giờ VN) hoặc theo chu kỳ. Màn hình: một trang + tổng + dải số. */
export interface RawFilter {
  warehouse_id: string; date_from?: string; date_to?: string; cycle?: string; search?: string
  event?: 'ISSUE' | 'REVERSAL'; flag?: 'rotation' | 'expiry' | 'reversed'
}
export function useConsumptionRaw(f: RawFilter & { page: number; page_size: number }, enabled = true) {
  return useQuery({
    queryKey: ['prod-consumption-raw', f], enabled: enabled && !!f.warehouse_id && (!!f.cycle || (!!f.date_from && !!f.date_to)),
    staleTime: 10_000, placeholderData: keepPreviousData,
    queryFn: async () => (await apiClient.get('/wms/production/consumption-raw', { params: f })).data.data as { rows: RawEvent[]; total: number; summary: RawSummary },
  })
}
/** File xuất (quyền export): lật trang 2.000 dòng tới hết. part = events (phát sinh) · req (định mức – thực cấp theo mẻ) · fill (nạp bồn). */
export async function fetchRawAll<P extends 'events' | 'req' | 'fill'>(f: RawFilter, part: P, onProgress?: (n: number) => void):
  Promise<P extends 'events' ? RawEvent[] : P extends 'req' ? RawReq[] : RawFill[]> {
  const size = 2000
  const out: unknown[] = []
  for (let page = 1; page <= 500; page++) {
    const rows = (await apiClient.get('/wms/production/consumption-raw/export', { params: { ...f, part, sort: 'asc', page, page_size: size } })).data.data.rows as unknown[]
    out.push(...rows)
    onProgress?.(out.length)
    if (rows.length < size) break
  }
  return out as P extends 'events' ? RawEvent[] : P extends 'req' ? RawReq[] : RawFill[]
}

export function useShiftReports(warehouseId: string | undefined) {
  return useQuery({
    queryKey: ['prod-shift-reports', warehouseId], enabled: !!warehouseId, staleTime: 15_000,
    queryFn: async () => (await apiClient.get('/wms/production/shift-reports', { params: { warehouse_id: warehouseId } })).data.data as ShiftReportHead[],
  })
}
/** Tên ca lấy từ danh mục ca dùng chung (Cài đặt WMS → Ca — cùng nguồn với Sổ đóng gói) để mẻ · báo cáo ca · trang sổ
 *  cùng một nhãn. Danh mục trống ⇒ Ca 1–3. `current` (giá trị đang lưu không có trong danh mục) được giữ làm một lựa chọn. */
export function useShiftNames(current?: string | null): string[] {
  const { data } = useImportShifts()
  return useMemo(() => {
    const names = ((data ?? []) as { name?: string | null; code?: string | null; is_active?: boolean | null }[])
      .filter(s => s.is_active !== false).map(s => (s.name || s.code || '').trim()).filter(Boolean)
    const base = names.length ? names : ['Ca 1', 'Ca 2', 'Ca 3']
    return current && !base.includes(current) ? [...base, current] : base
  }, [data, current])
}
export function useShiftReport(id: string | undefined) {
  return useQuery({
    queryKey: ['prod-shift-report', id], enabled: !!id, staleTime: 10_000,
    queryFn: async () => (await apiClient.get(`/wms/production/shift-reports/${id}`)).data.data as ShiftReport,
  })
}
export const useOpenShift = () => useProdMutation((b: { warehouse_id: string; report_date: string; shift: string }) => post<{ id: string }>('/wms/production/shift-reports', b))
export const useSaveShift = () => useProdMutation(({ id, ...b }: { id: string; items: { material_id: string; qty_actual: number | null }[]; note?: string | null; close?: boolean }) =>
  (async () => (await apiClient.put(`/wms/production/shift-reports/${id}`, b)).data.data as ShiftReport)())
export const useBatchStatus = () => useProdMutation(({ id, action }: { id: string; action: 'cancel' }) => post(`/wms/production/batches/${id}/${action}`))
export const useConsumeScan = () => useProdMutation(({ batchId, entry_id, qty, rotation_override_reason }: { batchId: string; entry_id: string; qty: number; rotation_override_reason?: string }) =>
  post<{ rows: { pallet_code: string; qty: number; remaining: number; rotation_violation?: boolean | null }[] }>(`/wms/production/batches/${batchId}/consume-scan`,
    { entry_id, qty, ...(rotation_override_reason ? { rotation_override_reason } : {}) }))
export const useConsumeLot = () => useProdMutation(({ batchId, rotation_override_reason, ...b }: { batchId: string; material_id: string; production_date: string | null; batch_lot: string | null; qty: number; rotation_override_reason?: string }) =>
  post<{ rows: { pallet_code: string; qty: number; remaining: number; rotation_violation?: boolean | null }[] }>(`/wms/production/batches/${batchId}/consume-lot`,
    { ...b, ...(rotation_override_reason ? { rotation_override_reason } : {}) }))
/** Đối tượng xin / duyệt dùng hàng HẾT HẠN: một tem, hoặc một lô không tem (mã + NSX + mã lô) */
export type ExpirySubject = { entry_id: string } | { material_id: string; production_date: string | null; batch_lot: string | null }
/** người cấp gửi QA duyệt (đã từ chối thì gửi lại) */
export const useExpiryRequest = () => useProdMutation(({ batchId, subject, note }: { batchId: string; subject: ExpirySubject; note?: string }) =>
  post<ExpiryApproval>(`/wms/production/batches/${batchId}/expiry-approvals`, { ...subject, ...(note ? { note } : {}) }))
/** QA duyệt / từ chối (kèm căn cứ) — quyền production.approve_expired */
export const useExpiryDecide = () => useProdMutation(({ batchId, subject, decision, note }: { batchId: string; subject: ExpirySubject; decision: 'APPROVED' | 'REJECTED'; note: string }) =>
  post<ExpiryApproval>(`/wms/production/batches/${batchId}/expiry-approvals/decide`, { ...subject, decision, note }))
export const useReverseConsumption = () => useProdMutation(({ id, reason }: { id: string; reason: string }) => post(`/wms/production/consumption/${id}/reverse`, { reason }))

export interface TankInput { warehouse_id: string; code: string; name?: string; capacity: number; unit: 'L' | 'KG'; note?: string }
export const useCreateTank = () => useProdMutation((t: TankInput) => post<TankRow>('/wms/production/tanks', t))
export const useUpdateTank = () => useProdMutation(({ id, ...t }: { id: string; name?: string | null; capacity?: number; unit?: 'L' | 'KG'; is_active?: boolean; note?: string | null }) => patch<TankRow>(`/wms/production/tanks/${id}`, t))
export const useTankFill = () => useProdMutation(({ tankId, batch_id, qty }: { tankId: string; batch_id: string; qty: number }) => post(`/wms/production/tanks/${tankId}/fill`, { batch_id, qty }))
export const useTankAdjust = () => useProdMutation(({ tankId, level, reason }: { tankId: string; level: number; reason: string }) => post(`/wms/production/tanks/${tankId}/adjust`, { level, reason }))
export const useTankTransfer = () => useProdMutation(({ tankId, to_tank_id, qty, reason }: { tankId: string; to_tank_id: string; qty: number; reason?: string }) => post(`/wms/production/tanks/${tankId}/transfer`, { to_tank_id, qty, reason }))
export const useTankDiscard = () => useProdMutation(({ tankId, qty, reason }: { tankId: string; qty: number; reason: string }) => post(`/wms/production/tanks/${tankId}/discard`, { qty, reason }))

export const BATCH_STATUS_VI: Record<BatchStatus, string> = { OPEN: 'Đang mở', CANCELLED: 'Đã huỷ' }
export const BATCH_QA_VI: Record<BatchQa, string> = { HOLD: 'Chờ QA', RELEASED: 'QA đạt', REJECTED: 'QA không đạt' }
export const TANK_MOVE_VI: Record<TankMoveRow['kind'], string> = { FILL: 'Nạp từ mẻ', DRAW: 'Rút đóng gói', TRANSFER_OUT: 'Chuyển đi', TRANSFER_IN: 'Chuyển đến', ADJUST: 'Điều chỉnh', DISCARD: 'Xả bỏ' }
