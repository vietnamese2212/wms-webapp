// Hook API cho SẢN XUẤT — MES giai đoạn 1 (14/11/2026): mẻ chế biến · rút NVL · bồn · truy xuất sản xuất.
// Tách file riêng khỏi hooks.ts (cùng apiClient). Realtime: realtimeEvents map production_batch / batch_consumption /
// production_tank / tank_lot / tank_movement → các key 'prod-*' dưới đây.
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiClient } from './client'
import { useWarehouses, useImportShifts, useMaterials } from './hooks'
import { useAuthStore } from '@/stores/authStore'
import type { MatUnits } from '@/utils/qtyUnits'
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

export type BatchStatus = 'OPEN' | 'CLOSED' | 'CANCELLED'
export type BatchQa = 'HOLD' | 'RELEASED' | 'REJECTED'

export interface BatchRow {
  id: string; warehouse_id: string; warehouse_name: string; batch_code: string
  material_id: string; material_code: string; material_name: string | null; base_unit: string | null
  machine_code: string | null; shift: string | null; cycle?: string | null; prod_date: string; planned_qty: number | null
  status: BatchStatus; qa_status: BatchQa; qa_at: string | null; qa_by_name: string | null
  note: string | null; opened_by_name: string | null; created_at: string; closed_at: string | null
  rm_lines: number; rm_materials: number; filled: number; in_tank: number
}
export interface BatchSummary { total: number; open: number; closed: number; cancelled: number; qa_hold: number; qa_released: number; qa_rejected: number }
export interface BatchListParams { warehouse_id?: string; status?: string; qa?: string; date_from?: string; date_to?: string; search?: string; page?: number; pageSize?: number }

export interface ConsumptionRow {
  id: string; batch_id: string; entry_id: string; pallet_code: string; material_id: string
  production_date: string | null; batch_lot: string | null; qty: number; source: 'SCAN' | 'LOT'
  created_by_name: string | null; created_at: string
  reversed_at: string | null; reversed_by_name: string | null; reverse_reason: string | null
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
  consumed: number; lines: number
  /** tồn cấp được ở kho chế biến (không QA giữ, sau giữ chỗ) · phần KHÔNG có tem · số pallet / bao CÓ tem */
  available: number; available_no_tem: number; tem_pallets: number
}
/** Phiếu theo dõi của mẻ: data = { mã_ô: giá_trị }; blocks = bản sửa riêng cho lần này (null = theo mẫu chung) */
export interface ProcessLog {
  id: string; form: string; data: Record<string, string>; blocks: FormBlock[] | null
  created_by_name: string | null; updated_by_name: string | null; confirmed_at: string | null; confirmed_by_name: string | null; updated_at: string
}
export interface BatchDetail {
  cycle: string | null; board: BoardRow[]; process_logs: ProcessLog[]
  id: string; warehouse_id: string; batch_code: string; material_id: string; machine_code: string | null; shift: string | null
  prod_date: string; planned_qty: number | null; status: BatchStatus; qa_status: BatchQa; qa_by_name: string | null; qa_at: string | null; qa_note: string | null
  note: string | null; opened_by_name: string | null; created_at: string; closed_at: string | null; closed_by_name: string | null
  material: ({ id: string; material_code: string; short_name: string | null; category: string | null; tank_hold_hours: number | null } & MatUnits) | null
  warehouse: { id: string; code: string; name: string; parent_warehouse_id: string | null } | null
  consumption: ConsumptionRow[]; movements: TankMoveRow[]; lots: BatchLot[]
}
export interface ScanEntry {
  id: string; pallet_code: string; material_id: string; cartons_remaining: number | null; cartons_imported: number | null; cartons_reserved: number | null
  production_date: string | null; expiry_date: string | null; batch: string | null
  qa_status_id?: string | null; qa_status: { code: string; name: string } | null; location: { location_code: string } | null
  material: ({ material_code: string; short_name: string | null } & MatUnits) | null
}
export interface StockMaterial extends MatUnits { material_id: string; material_code: string; material_name: string | null; available: number; available_no_tem?: number; lots: number }
export interface StockLot { production_date: string | null; batch_lot: string | null; expiry_date: string | null; available: number; available_no_tem?: number; tem_pallets?: number; pallets: number }
export interface TankLotView {
  id: string; tank_id: string; batch_id: string; qty_in: number; qty_remaining: number; filled_at: string; expires_at: string | null
  batch: { batch_code: string; qa_status: BatchQa; material: { material_code: string; short_name: string | null } | null } | null
}
export interface TankRow {
  id: string; warehouse_id: string; code: string; name: string | null; capacity: number; unit: 'L' | 'KG'; is_active: boolean; note: string | null
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string
  warehouse: { code: string; name: string } | null
  content: number; lots: TankLotView[]; qa_pending: boolean; expired: boolean; next_expiry: string | null
}
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
export function useNextBatchCode(p: { warehouse_id?: string; material_id?: string; prod_date?: string; machine_code?: string }) {
  const ready = !!p.warehouse_id && !!p.material_id && !!p.prod_date
  return useQuery({
    queryKey: ['prod-next-code', p], enabled: ready, staleTime: 0,
    queryFn: async () => (await apiClient.get('/wms/production/batches/next-code', { params: p })).data.data as { code: string; stem: string },
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
    mutationFn: async (b: { warehouse_id: string; production_qa_gate?: string; types?: { type_code: string; production_qa_gate: string | null }[]; hold_hours?: { material_id: string; tank_hold_hours: number | null }[] }) =>
      (await apiClient.put('/wms/production/settings', b)).data.data as ProductionSettings,
    onSuccess: (data, v) => { qc.setQueryData(['prod-settings', v.warehouse_id], data) },
    onSettled: () => {
      for (const k of [['prod-settings'], ['materials'], ['materials-paged'], K.batch, K.tanks, ['warehouses'], ['wh-type-configs']]) void qc.invalidateQueries({ queryKey: k })
    },
  })
}

export interface BatchInput { warehouse_id: string; material_id: string; prod_date: string; batch_code?: string; machine_code?: string; shift?: string; cycle?: string; planned_qty?: number | null; note?: string }
export const useCreateBatch = () => useProdMutation((b: BatchInput) => post<BatchDetail>('/wms/production/batches', b))
export const useUpdateBatch = () => useProdMutation(({ id, ...b }: { id: string } & Partial<Omit<BatchInput, 'warehouse_id' | 'machine_code' | 'shift' | 'cycle' | 'note'>> & { machine_code?: string | null; shift?: string | null; cycle?: string | null; note?: string | null }) => patch<BatchDetail>(`/wms/production/batches/${id}`, b))
// ── Bàn làm việc của mẻ: yêu cầu nguyên liệu + định mức ──
export const useSetRequirements = () => useProdMutation(({ batchId, items }: { batchId: string; items: { material_id: string; qty: number }[] }) =>
  (async () => (await apiClient.put(`/wms/production/batches/${batchId}/requirements`, { items })).data.data as { count: number })())
export const useApplyRecipe = () => useProdMutation(({ batchId, replace }: { batchId: string; replace?: boolean }) =>
  post<{ count: number }>(`/wms/production/batches/${batchId}/apply-recipe`, { replace }))
type RecipeMat = ({ id: string; material_code: string; short_name: string | null; category: string | null } & MatUnits) | null
export interface RecipeRow { id: string; material_id: string; base_qty: number; note: string | null; is_active: boolean; updated_at: string; updated_by: string | null; material: RecipeMat }
export interface RecipeDetail extends RecipeRow { lines: { id: string; material_id: string; qty: number; sort_order: number; note: string | null; material: RecipeMat }[] }
export function useRecipes() {
  return useQuery({ queryKey: ['prod-recipes'], staleTime: 30_000, queryFn: async () => (await apiClient.get('/wms/production/recipes')).data.data as RecipeRow[] })
}
export function useRecipe(materialId: string | undefined) {
  return useQuery({
    queryKey: ['prod-recipe', materialId], enabled: !!materialId, staleTime: 10_000,
    queryFn: async () => (await apiClient.get(`/wms/production/recipes/${materialId}`)).data.data as RecipeDetail | null,
  })
}
export const useSaveRecipe = () => useProdMutation(({ materialId, ...b }: { materialId: string; base_qty: number; note: string | null; is_active: boolean; lines: { material_id: string; qty: number }[] }) =>
  (async () => (await apiClient.put(`/wms/production/recipes/${materialId}`, b)).data.data as { id: string; lines: number })())
/** blocks: mảng = lưu bản sửa riêng · null = về theo mẫu chung · bỏ trống = giữ nguyên */
export const useSaveProcessLog = () => useProdMutation(({ batchId, form, data, blocks }: { batchId: string; form: string; data: Record<string, string>; blocks?: FormBlock[] | null }) =>
  (async () => (await apiClient.put(`/wms/production/batches/${batchId}/process-log/${form}`, { data, ...(blocks !== undefined ? { blocks } : {}) })).data.data as ProcessLog)())
export const useConfirmProcessLog = () => useProdMutation(({ batchId, form, confirm }: { batchId: string; form: string; confirm: boolean }) =>
  post<ProcessLog>(`/wms/production/batches/${batchId}/process-log/${form}/confirm`, { confirm }))
// ── Mẫu phiếu theo dõi (cấu hình ở Cài đặt MES) ──
export interface ProcessFormDef { code: string; title: string; short: string; blocks: FormBlock[]; sort_order: number; is_active: boolean; updated_by_name: string | null; updated_at: string }
export function useProcessForms() {
  return useQuery({ queryKey: ['prod-process-forms'], staleTime: 60_000,
    queryFn: async () => (await apiClient.get('/wms/production/process-forms')).data.data as ProcessFormDef[] })
}
export function useSaveProcessForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ code, ...b }: { code: string; title: string; short: string; is_active: boolean; sort_order?: number; blocks: FormBlock[] }) =>
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
export const useBatchStatus = () => useProdMutation(({ id, action }: { id: string; action: 'close' | 'reopen' | 'cancel' }) => post(`/wms/production/batches/${id}/${action}`))
export const useBatchQa = () => useProdMutation(({ id, qa_status, note }: { id: string; qa_status: BatchQa; note?: string }) => post(`/wms/production/batches/${id}/qa`, { qa_status, note }))
export const useConsumeScan = () => useProdMutation(({ batchId, entry_id, qty }: { batchId: string; entry_id: string; qty: number }) =>
  post<{ rows: { pallet_code: string; qty: number; remaining: number }[] }>(`/wms/production/batches/${batchId}/consume-scan`, { entry_id, qty }))
export const useConsumeLot = () => useProdMutation(({ batchId, ...b }: { batchId: string; material_id: string; production_date: string | null; batch_lot: string | null; qty: number }) =>
  post<{ rows: { pallet_code: string; qty: number; remaining: number }[] }>(`/wms/production/batches/${batchId}/consume-lot`, b))
export const useReverseConsumption = () => useProdMutation(({ id, reason }: { id: string; reason: string }) => post(`/wms/production/consumption/${id}/reverse`, { reason }))

export interface TankInput { warehouse_id: string; code: string; name?: string; capacity: number; unit: 'L' | 'KG'; note?: string }
export const useCreateTank = () => useProdMutation((t: TankInput) => post<TankRow>('/wms/production/tanks', t))
export const useUpdateTank = () => useProdMutation(({ id, ...t }: { id: string; name?: string | null; capacity?: number; unit?: 'L' | 'KG'; is_active?: boolean; note?: string | null }) => patch<TankRow>(`/wms/production/tanks/${id}`, t))
export const useTankFill = () => useProdMutation(({ tankId, batch_id, qty }: { tankId: string; batch_id: string; qty: number }) => post(`/wms/production/tanks/${tankId}/fill`, { batch_id, qty }))
export const useTankAdjust = () => useProdMutation(({ tankId, level, reason }: { tankId: string; level: number; reason: string }) => post(`/wms/production/tanks/${tankId}/adjust`, { level, reason }))
export const useTankTransfer = () => useProdMutation(({ tankId, to_tank_id, qty, reason }: { tankId: string; to_tank_id: string; qty: number; reason?: string }) => post(`/wms/production/tanks/${tankId}/transfer`, { to_tank_id, qty, reason }))
export const useTankDiscard = () => useProdMutation(({ tankId, qty, reason }: { tankId: string; qty: number; reason: string }) => post(`/wms/production/tanks/${tankId}/discard`, { qty, reason }))

export const BATCH_STATUS_VI: Record<BatchStatus, string> = { OPEN: 'Đang mở', CLOSED: 'Đã đóng', CANCELLED: 'Đã huỷ' }
export const BATCH_QA_VI: Record<BatchQa, string> = { HOLD: 'Chờ QA', RELEASED: 'QA thả', REJECTED: 'QA loại' }
export const TANK_MOVE_VI: Record<TankMoveRow['kind'], string> = { FILL: 'Nạp từ mẻ', DRAW: 'Rút đóng gói', TRANSFER_OUT: 'Chuyển đi', TRANSFER_IN: 'Chuyển đến', ADJUST: 'Điều chỉnh', DISCARD: 'Xả bỏ' }
