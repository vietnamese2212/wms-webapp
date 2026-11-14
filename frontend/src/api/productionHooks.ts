// Hook API cho SẢN XUẤT — MES giai đoạn 1 (14/11/2026): mẻ chế biến · rút NVL · bồn · truy xuất sản xuất.
// Tách file riêng khỏi hooks.ts (cùng apiClient). Realtime: realtimeEvents map production_batch / batch_consumption /
// production_tank / tank_lot / tank_movement → các key 'prod-*' dưới đây.
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiClient } from './client'
import { useWarehouses } from './hooks'
import { useAuthStore } from '@/stores/authStore'
import type { MatUnits } from '@/utils/qtyUnits'

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
    const factories = all.filter(w => parentIds.has(w.id)).map(w => ({ id: w.id, code: w.code, name: w.name }))
    return { kitchens: kids as ProdWarehouse[], factories }
  }, [q.data, user?.warehouse_scope, user?.warehouse_ids, user?.warehouse_id])
  return { ...q, data }
}

export type BatchStatus = 'OPEN' | 'CLOSED' | 'CANCELLED'
export type BatchQa = 'HOLD' | 'RELEASED' | 'REJECTED'

export interface BatchRow {
  id: string; warehouse_id: string; warehouse_name: string; batch_code: string
  material_id: string; material_code: string; material_name: string | null; base_unit: string | null
  machine_code: string | null; shift: string | null; prod_date: string; planned_qty: number | null
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
export interface BatchDetail {
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
  qa_status: { code: string; name: string } | null; location: { location_code: string } | null
  material: ({ material_code: string; short_name: string | null } & MatUnits) | null
}
export interface StockMaterial extends MatUnits { material_id: string; material_code: string; material_name: string | null; available: number; lots: number }
export interface StockLot { production_date: string | null; batch_lot: string | null; expiry_date: string | null; available: number; pallets: number }
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

export function useProductionBatches(p: BatchListParams) {
  return useQuery({
    queryKey: [...K.batches, p], staleTime: 15_000, placeholderData: keepPreviousData,
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
export function useProductionTanks(warehouseId?: string, includeInactive = false) {
  return useQuery({
    queryKey: [...K.tanks, warehouseId ?? '', includeInactive], staleTime: 10_000,
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
      for (const k of [K.batches, K.batch, K.stock, K.tanks, K.moves, ['prod-next-code'], ['prod-genealogy'], ['inventory-entries'], ['inventory-summary'], ['pallet-ledger'], ['packing-run'], ['packing-runs'], ['packing-run-board']])
        void qc.invalidateQueries({ queryKey: k })
    },
  })
}
const post = async <T,>(url: string, body: unknown = {}) => (await apiClient.post(url, body)).data.data as T
const patch = async <T,>(url: string, body: unknown) => (await apiClient.patch(url, body)).data.data as T

export interface BatchInput { warehouse_id: string; material_id: string; prod_date: string; batch_code?: string; machine_code?: string; shift?: string; planned_qty?: number | null; note?: string }
export const useCreateBatch = () => useProdMutation((b: BatchInput) => post<BatchDetail>('/wms/production/batches', b))
export const useUpdateBatch = () => useProdMutation(({ id, ...b }: { id: string } & Partial<Omit<BatchInput, 'warehouse_id'>>) => patch<BatchDetail>(`/wms/production/batches/${id}`, b))
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
