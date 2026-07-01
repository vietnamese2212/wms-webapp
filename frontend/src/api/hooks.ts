import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  mockInventory, mockTransactions, mockVehicles,
  mockEmployees,
  mockLocations,
} from '@/utils/mockData'
import { apiClient } from './client'
import { suppressTmsOrdersRealtime } from './realtimeEvents'
import { useActiveInboundStore } from '@/stores/activeInboundStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import type { InboundOrder, PalletEntry, Department, JobTitle, EmployeeRecord, GDO, InventoryEntry, TmsVehicleType, SlotTemplate, TransportCompany, TmsVehicle } from '@/types'

const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms))

// ─── MASTERDATA (gọi API thật) ────────────────────────────────

export function useWarehouses(onlyActive = false) {
  return useQuery({
    queryKey: ['warehouses', onlyActive],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/warehouses', {
        params: onlyActive ? { active: 'true' } : {},
      })
      return data.data as any[]
    },
  })
}

export function useLocationsReal(params?: { warehouse_id?: string; sub_code?: string; category?: string; material_id?: string }, enabled = true) {
  return useQuery({
    queryKey: ['locations-real', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/locations', { params })
      return data.data as any[]
    },
  })
}

// ─── Pallet label prints (truy vết in tem) ───────────────────
export type PalletPrintRow = {
  id: string; batch_id: string | null; qr_code: string; material_code: string | null; category: string | null
  cycle: string | null; machine: string | null; seq: string | null; nmsx: string | null
  qty: number | null; mode: string; printed_by_name: string | null; created_at: string
}
export function useLogPalletPrints() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { mode: 'GENERATE' | 'REPRINT'; labels: Record<string, unknown>[] }) =>
      apiClient.post('/wms/pallet-prints', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pallet-prints'] }),
  })
}
export function usePalletPrints(params: { qr_code?: string; qr_codes?: string; search?: string; date_from?: string; date_to?: string; categories?: string; cycles?: string; machines?: string; nmsx?: string; material_codes?: string }, enabled = true) {
  return useQuery({
    queryKey: ['pallet-prints', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/pallet-prints', { params })
      return data.data as PalletPrintRow[]
    },
  })
}

// ── Dồn / Tách pallet ──
function useInvalidateInventory() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['inventory-entries'] })
    qc.invalidateQueries({ queryKey: ['inventory-facets'] })
    qc.invalidateQueries({ queryKey: ['inventory'] })
  }
}
export function useMergePallets() {
  const inv = useInvalidateInventory()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { target_pallet_code: string; child_pallet_codes: string[]; warehouse_id?: string }) =>
      apiClient.post('/wms/pallet-ops/merge', body).then(r => r.data.data),
    onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ['pallet-ops-log'] }) },
  })
}
export function useUngroupPallets() {
  const inv = useInvalidateInventory()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { pallet_codes: string[]; warehouse_id?: string }) =>
      apiClient.post('/wms/pallet-ops/ungroup', body).then(r => r.data.data),
    onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ['pallet-ops-log'] }) },
  })
}
export function useSplitPallet() {
  const inv = useInvalidateInventory()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { source_pallet_code: string; children: { qty: number }[]; warehouse_id?: string; location_id?: string }) =>
      apiClient.post('/wms/pallet-ops/split', body).then(r => r.data.data as { source: string; source_remaining: number; children: InventoryEntry[] }),
    onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ['pallet-ops-log'] }) },
  })
}

export type PalletOpRow = {
  id: string; type: string; source_codes: string[]; target_codes: string[]
  detail: any; operated_by_name: string | null; created_at: string
  undone_at: string | null; undone_by_name: string | null
}
export function usePalletOps(params: { search?: string; type?: string; warehouse_id?: string; date_from?: string; date_to?: string }, enabled = true) {
  return useQuery({
    queryKey: ['pallet-ops-log', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/pallet-ops', { params })
      return data.data as PalletOpRow[]
    },
  })
}
export function useUndoPalletOp() {
  const inv = useInvalidateInventory()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/pallet-ops/${id}/undo`).then(r => r.data.data),
    onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: ['pallet-ops-log'] }) },
  })
}

export function useManufacturers() {
  return useQuery({
    queryKey: ['manufacturers'],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/manufacturers')
      return data.data as any[]
    },
  })
}

export function useMaterials(params?: { search?: string; manufacturer_id?: string; category?: string }, enabled = true) {
  return useQuery({
    queryKey: ['materials', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/materials', { params })
      return data.data as import('@/types').Material[]
    },
  })
}

export function useImportShifts() {
  return useQuery({
    queryKey: ['import-shifts'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/import-shifts')
      return data.data as import('@/types').ImportShift[]
    },
  })
}

export function useQAStatuses() {
  return useQuery({
    queryKey: ['qa-statuses'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/qa-statuses')
      return data.data as import('@/types').QAStatus[]
    },
  })
}

// Ca nhập — tạo/sửa (gate wms_settings.manage_global ở BE)
export function useCreateImportShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; display_order?: number }) =>
      apiClient.post('/masterdata/import-shifts', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-shifts'] }),
  })
}
export function useUpdateImportShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; display_order?: number; is_active?: boolean }) =>
      apiClient.put(`/masterdata/import-shifts/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-shifts'] }),
  })
}

// Tình trạng QA — tạo/sửa (gate wms_settings.manage_global ở BE)
export function useCreateQAStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; display_order?: number }) =>
      apiClient.post('/masterdata/qa-statuses', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qa-statuses'] }),
  })
}
export function useUpdateQAStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; display_order?: number; is_active?: boolean }) =>
      apiClient.put(`/masterdata/qa-statuses/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['qa-statuses'] }),
  })
}

// Mutations
export function useCreateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; address?: string; warehouse_type: string; inventory_mode?: string; shipto_codes?: string; nmsx_code?: string }) =>
      apiClient.post('/masterdata/warehouses', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })
}

export function useUpdateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; address?: string; is_active?: boolean; warehouse_type?: string; inventory_mode?: string; shipto_codes?: string; nmsx_code?: string }) =>
      apiClient.put(`/masterdata/warehouses/${id}`, body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })
}

export function useDeleteWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/masterdata/warehouses/${id}`).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })
}

export function useCreateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; sub_code: string; sub_name?: string; category?: string; row: string; shelf?: string; max_pallets?: number }) =>
      apiClient.post('/masterdata/locations', body).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
    },
  })
}

export function useUpdateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; sub_name?: string; category?: string; max_pallets?: number; is_active?: boolean; requires_stocktake?: boolean }) =>
      apiClient.put(`/masterdata/locations/${id}`, body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations-real'] }),
  })
}

export function useDeleteLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/masterdata/locations/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
    },
  })
}

export function useCreateMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      material_code: string; material_description: string
      custom_short_name?: string; category?: string; product_type?: string
      unit?: string; manufacturer_id?: string; notes?: string; old_code?: string
      weight_kg?: number | null; cartons_per_pallet?: number | null
      units_per_carton?: number | null; shelf_life_days?: number | null; no_qr_tracking?: boolean
      pallet_per_ea?: number | null
      warehouse_pallet_overrides?: import('@/types').WarehousePalletOverride[]
      supplier_shelf_life_overrides?: import('@/types').SupplierShelfLifeOverride[]
    }) => apiClient.post('/masterdata/materials', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  })
}

export function useUpdateMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; material_description?: string; custom_short_name?: string
      category?: string; product_type?: string; unit?: string
      manufacturer_id?: string; notes?: string; old_code?: string
      weight_kg?: number | null; cartons_per_pallet?: number | null
      units_per_carton?: number | null; shelf_life_days?: number | null
      is_active?: boolean; no_qr_tracking?: boolean; pallet_per_ea?: number | null
      warehouse_pallet_overrides?: import('@/types').WarehousePalletOverride[]
      supplier_shelf_life_overrides?: import('@/types').SupplierShelfLifeOverride[]
    }) => apiClient.put(`/masterdata/materials/${id}`, body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  })
}

export function useDeleteMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/masterdata/materials/${id}`).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materials'] }),
  })
}

export function useCreateManufacturer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name?: string }) =>
      apiClient.post('/masterdata/manufacturers', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manufacturers'] }),
  })
}

// ─── WMS – Inbound Orders (API thật) ────────────────────────

// Helpers: persist query results to localStorage so data shows instantly on refresh/cold start
function lsGet<T>(key: string): T | undefined {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : undefined }
  catch { return undefined }
}
function lsSet(key: string, val: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}
function lsKey(prefix: string, params?: Record<string, string | undefined>): string {
  const clean = Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined))
  return `${prefix}:${JSON.stringify(clean)}`
}

export function useInboundOrders(params?: { warehouse_id?: string; status?: string; search?: string; date?: string; date_from?: string; date_to?: string; shift_id?: string; material_category?: string }) {
  return useQuery({
    queryKey: ['inbound-orders', params],
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-orders', { params })
      return data.data as InboundOrder[]
    },
  })
}

export function useInboundOrder(id?: string) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['inbound-order', id],
    enabled: !!id,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // 1) list cache (instant navigate from list), 2) localStorage (direct URL / refresh)
    placeholderData: () => {
      const caches = qc.getQueriesData<InboundOrder[]>({ queryKey: ['inbound-orders'] })
      for (const [, list] of caches) {
        const found = list?.find((o) => o.id === id)
        if (found) return found
      }
      return lsGet<InboundOrder>(`wms:io-detail:${id}`)
    },
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inbound-orders/${id}`)
      lsSet(`wms:io-detail:${id}`, data.data)
      return data.data as InboundOrder
    },
  })
}

export function useInboundLocationSuggestions(orderId?: string) {
  return useQuery({
    queryKey: ['inbound-location-suggestions', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inbound-orders/${orderId}/location-suggestions`)
      return data.data as import('@/types').LocationSuggestion[]
    },
  })
}

export function useCreateInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      warehouse_id: string
      material_id: string
      location_id?: string
      shift_id?: string
      import_date?: string
      notes?: string
      imported_by?: string
      source_type?: string
      warehouse_type?: string
      gate_registration_id?: string
      tms_order_id?: string
      planned_cartons?: number
      ncc_id?: string
    }) => apiClient.post('/wms/inbound-orders', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-orders'] }),
  })
}

export function useUpdateInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; location_id?: string; planned_pallets?: number; planned_cartons?: number | null; shift_id?: string; import_date?: string; notes?: string }) =>
      apiClient.patch(`/wms/inbound-orders/${id}`, body).then((r) => r.data.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', v.id] })
    },
  })
}

// Đổi vị trí phiếu — endpoint riêng (gate edit_pallet/force_edit_pallet, KHÔNG dùng quyền edit).
// Optimistic: cập nhật ngay cache detail (vị trí mới hiện tức thì) + dùng order PATCH trả về để
// merge cache, KHÔNG refetch getOrder chặn UI. Realtime sẽ reconcile nền. `location_code` truyền
// từ component để hiện code mới ngay; thiếu cũng không sao (chỉ chậm hiện code tới khi PATCH về).
type InboundOrderCache = {
  location_id: string | null
  location: { id: string; location_code: string } | null
  [k: string]: unknown
}
export function useSetInboundOrderLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, location_id }: { id: string; location_id: string; location_code?: string }) =>
      apiClient.patch(`/wms/inbound-orders/${id}/location`, { location_id }).then((r) => r.data.data),
    onMutate: async ({ id, location_id, location_code }) => {
      await qc.cancelQueries({ queryKey: ['inbound-order', id] })
      const prev = qc.getQueryData<InboundOrderCache>(['inbound-order', id])
      if (prev) {
        qc.setQueryData<InboundOrderCache>(['inbound-order', id], {
          ...prev,
          location_id,
          location: location_code ? { id: location_id, location_code } : prev.location,
        })
      }
      return { prev, id }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['inbound-order', ctx.id], ctx.prev)
    },
    onSuccess: (data: Partial<InboundOrderCache>, v) => {
      // PATCH trả về order đầy đủ (ORDER_SELECT + count) → merge, GIỮ inventory_entries hiện có.
      qc.setQueryData<InboundOrderCache>(['inbound-order', v.id], (old) =>
        old ? { ...old, ...data } : old)
    },
    onSettled: () => {
      // Chỉ invalidate list ở nền (cho trang DS nếu đang mở). Detail đã cập nhật qua cache +
      // realtime tự reconcile → tránh refetch getOrder chặn.
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
    },
  })
}

export function useCompleteInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/inbound-orders/${id}/complete`).then((r) => r.data.data),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', id] })
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['transfer-goods'] })
    },
  })
}

export function useUncompleteInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/inbound-orders/${id}/uncomplete`).then((r) => r.data.data),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', id] })
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['transfer-goods'] })
    },
  })
}

export function useCancelInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/inbound-orders/${id}/cancel`).then((r) => r.data.data),
    onSuccess: (_d, id) => {
      useActiveInboundStore.getState().unpin(id)
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', id] })
    },
  })
}

export function useScanPallet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, ...body }: {
      orderId: string
      qr_code: string
      location_id: string
      stack_layer?: number
      cartons_override?: number
      qa_status_id?: string
      employee_id?: string
      ncc_id?: string
      shelf_life_days?: number
    }) => apiClient.post(`/wms/inbound-orders/${orderId}/scan`, body).then((r) => r.data.data),

    // Optimistic: add entry to table immediately, before API responds
    onMutate: async ({ orderId, qr_code, location_id }) => {
      await qc.cancelQueries({ queryKey: ['inbound-order', orderId] })
      const previous = qc.getQueryData<InboundOrder>(['inbound-order', orderId])

      const parts = qr_code.split('_')
      const tempEntry = {
        id: `_temp_${Date.now()}`,
        pallet_code: qr_code,
        location: previous?.location ?? { id: location_id, location_code: '…', sub_code: '' },
        material: previous?.material ?? { id: '', material_code: '', short_name: null },
        manufacturer: null,
        cycle:              parts[2] ?? null,
        machine_code:       parts[3] ?? null,
        pallet_sequence_no: null,
        qa_status_id:       null,
        qa_status:          null,
        stack_layer:        1,
        cartons_imported:   previous?.material?.cartons_per_pallet ?? 0,
        production_date:    null,
        status:             'IN_STOCK',
        created_by_emp:     null,
        updated_by_emp:     null,
        import_date:        new Date().toISOString(),
        update_date:        new Date().toISOString(),
        created_at:         new Date().toISOString(),
        updated_at:         new Date().toISOString(),
      }

      qc.setQueryData<InboundOrder>(['inbound-order', orderId], (old) => {
        if (!old) return old
        return {
          ...old,
          inventory_entries: [...(old.inventory_entries ?? []), tempEntry],
          _count: { inventory_entries: old._count.inventory_entries + 1 },
        }
      })

      return { previous, orderId }
    },

    // Rollback on error
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['inbound-order', ctx.orderId], ctx.previous)
    },

    // Always sync real data after settle
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ['inbound-order', v.orderId] }),
  })
}

export function useScanManualPallet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, ...body }: {
      orderId: string
      pallet_code?: string
      cartons: number
      location_id?: string
      employee_id?: string
    }) => apiClient.post(`/wms/inbound-orders/${orderId}/scan-manual`, body).then((r) => r.data.data),

    onMutate: async ({ orderId, cartons }) => {
      await qc.cancelQueries({ queryKey: ['inbound-order', orderId] })
      const previous = qc.getQueryData<InboundOrder>(['inbound-order', orderId])
      const tempEntry = {
        id: `_temp_${Date.now()}`,
        pallet_code: `MNL-${Date.now()}`,
        location: { id: '', location_code: '—', sub_code: '' },
        material: previous?.material ?? null,
        manufacturer: null,
        cycle: null, machine_code: null, pallet_sequence_no: null,
        qa_status_id: null, qa_status: null, stack_layer: 1,
        cartons_imported: cartons, cartons_remaining: cartons,
        production_date: null, status: 'IN_STOCK',
        created_by_emp: null, updated_by_emp: null,
        import_date: new Date().toISOString(),
        update_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as PalletEntry
      qc.setQueryData<InboundOrder>(['inbound-order', orderId], (old) => {
        if (!old) return old
        return {
          ...old,
          inventory_entries: [...(old.inventory_entries ?? []), tempEntry],
          _count: { inventory_entries: old._count.inventory_entries + 1 },
        }
      })
      return { previous, orderId }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(['inbound-order', ctx.orderId], ctx.previous)
    },
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ['inbound-order', v.orderId] }),
  })
}

export function useDeletePalletEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, entryId, employeeId }: { orderId: string; entryId: string; employeeId?: string }) =>
      apiClient.delete(`/wms/inbound-orders/${orderId}/entries/${entryId}`, {
        data: { employee_id: employeeId },
      }).then((r) => r.data.data),
    onMutate: async ({ orderId, entryId }) => {
      await qc.cancelQueries({ queryKey: ['inbound-order', orderId] })
      const prev = qc.getQueryData<InboundOrder>(['inbound-order', orderId])
      qc.setQueryData<InboundOrder>(['inbound-order', orderId], (old) => {
        if (!old) return old
        return {
          ...old,
          inventory_entries: (old.inventory_entries ?? []).filter((e: PalletEntry) => e.id !== entryId),
          _count: { inventory_entries: Math.max(0, (old._count?.inventory_entries ?? 1) - 1) },
        }
      })
      return { prev, orderId }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['inbound-order', ctx.orderId], ctx.prev)
    },
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ['inbound-order', v.orderId] }),
  })
}

export function useDeletePalletEntries() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, entryIds, employeeId }: { orderId: string; entryIds: string[]; employeeId?: string }) =>
      apiClient.delete(`/wms/inbound-orders/${orderId}/entries`, {
        data: { entry_ids: entryIds, employee_id: employeeId },
      }).then((r) => r.data.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['inbound-order', v.orderId] }),
  })
}

export function useUpdatePalletEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, entryId, ...body }: {
      orderId: string
      entryId: string
      cartons_imported?: number
      stack_layer?: number
      employee_id?: string
    }) => apiClient.patch(`/wms/inbound-orders/${orderId}/entries/${entryId}`, body).then((r) => r.data.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['inbound-order', v.orderId] }),
  })
}

export function useMaterialCategories() {
  return useQuery({
    queryKey: ['material-categories'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/materials/categories')
      return data.data as string[]
    },
  })
}

export function useWarehouseTypes() {
  return useQuery({
    queryKey: ['lookup', 'warehouse_type'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/lookup', { params: { type: 'warehouse_type' } })
      return data.data as { id: string; value: string; sort_order: number }[]
    },
  })
}

export function useAddWarehouseType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (value: string) =>
      apiClient.post('/wms/lookup', { type: 'warehouse_type', value }).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'warehouse_type'] }),
  })
}

export function useUpdateWarehouseType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      apiClient.put(`/wms/lookup/${id}`, { value }).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'warehouse_type'] }),
  })
}

export function useDeleteWarehouseType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/lookup/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'warehouse_type'] }),
  })
}

// Kéo-thả sắp thứ tự loại kho (sort_order) — ids theo thứ tự mới
export function useReorderWarehouseTypes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.put('/wms/lookup/reorder', { type: 'warehouse_type', ids }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lookup', 'warehouse_type'] }),
  })
}

export type WarehouseZone = { id: string; warehouse_id: string; code: string; name: string; category: string | null; sort_order: number; is_active: boolean; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }

export function useWarehouseZones(warehouseId?: string) {
  return useQuery({
    queryKey: ['warehouse-zones', warehouseId ?? 'all'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/zones', {
        params: warehouseId ? { warehouse_id: warehouseId } : undefined,
      })
      return data.data as WarehouseZone[]
    },
  })
}

export function useCreateWarehouseZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; name: string; category?: string; code?: string }) =>
      apiClient.post('/wms/zones', body).then(r => r.data.data as WarehouseZone),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-zones'] }),
  })
}

export function useUpdateWarehouseZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; category?: string | null; is_active?: boolean }) =>
      apiClient.put(`/wms/zones/${id}`, body).then(r => r.data.data as WarehouseZone),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-zones'] }),
  })
}

export function useDeleteWarehouseZone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/zones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse-zones'] }),
  })
}

// WMS – Inventory (API thật)
export function useInventoryEntries(params?: {
  warehouse_ids?: string[]
  categories?: string[]
  filter_locations?: string[]
  filter_material_ids?: string[]
  material_search?: string
  qa_status_ids?: string[]
  status?: string
  search?: string
  page?: number
  limit?: number
  manufacturer_id?: string
  filter_cycles?: string[]
  filter_machines?: string[]
  filter_nmsx?: string[]
  ncc_ids?: string[]
  date_pct_ranges?: string[]
}, enabled = true) {
  return useQuery({
    queryKey: ['inventory-entries', params],
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData, // đổi trang/lọc: giữ dữ liệu cũ, không trắng bảng (cảm giác tức thì)
    queryFn: async () => {
      const { warehouse_ids, categories, filter_locations, filter_material_ids, qa_status_ids, filter_cycles, filter_machines, filter_nmsx, ncc_ids, date_pct_ranges, ...rest } = params ?? {}
      const { data } = await apiClient.get('/wms/inventory', {
        params: {
          ...rest,
          ...(warehouse_ids?.length       ? { warehouse_ids:      warehouse_ids.join(',')       } : {}),
          ...(categories?.length          ? { categories:         categories.join(',')          } : {}),
          ...(filter_locations?.length    ? { filter_locations:   filter_locations.join(',')    } : {}),
          ...(filter_material_ids?.length ? { filter_material_ids:filter_material_ids.join(',') } : {}),
          ...(qa_status_ids?.length       ? { qa_status_ids:      qa_status_ids.join(',')       } : {}),
          ...(filter_cycles?.length       ? { filter_cycles:      filter_cycles.join(',')       } : {}),
          ...(filter_machines?.length     ? { filter_machines:    filter_machines.join(',')     } : {}),
          ...(filter_nmsx?.length         ? { filter_nmsx:        filter_nmsx.join(',')         } : {}),
          ...(ncc_ids?.length             ? { ncc_ids:            ncc_ids.join(',')             } : {}),
          ...(date_pct_ranges?.length     ? { date_pct_ranges:    date_pct_ranges.join(',')     } : {}),
        },
      })
      return data.data as { entries: InventoryEntry[]; total: number; page: number; limit: number; total_cartons_remaining: number }
    },
  })
}

export interface InventorySummaryGroup {
  warehouse_id: string | null
  warehouse_name: string
  material_id: string
  material_code: string | null
  short_name: string | null
  category: string | null
  production_date: string | null
  date_pct: number | null
  ncc_name: string | null
  cartons_imported: number
  cartons_remaining: number
  cartons_exported: number
  pallet_count: number
}

// View tổng hợp tồn kho theo Kho × Mã hàng × Ngày SX. Dùng CHUNG params filter với useInventoryEntries.
export function useInventorySummary(params?: Parameters<typeof useInventoryEntries>[0], enabled = true) {
  return useQuery({
    queryKey: ['inventory-summary', params],
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { warehouse_ids, categories, filter_locations, filter_material_ids, qa_status_ids, filter_cycles, filter_machines, filter_nmsx, ncc_ids, date_pct_ranges, page, limit, ...rest } = params ?? {}
      void page; void limit // tổng hợp trả tất cả nhóm, phân trang client-side
      const { data } = await apiClient.get('/wms/inventory/summary', {
        params: {
          ...rest,
          ...(warehouse_ids?.length       ? { warehouse_ids:      warehouse_ids.join(',')       } : {}),
          ...(categories?.length          ? { categories:         categories.join(',')          } : {}),
          ...(filter_locations?.length    ? { filter_locations:   filter_locations.join(',')    } : {}),
          ...(filter_material_ids?.length ? { filter_material_ids:filter_material_ids.join(',') } : {}),
          ...(qa_status_ids?.length       ? { qa_status_ids:      qa_status_ids.join(',')       } : {}),
          ...(filter_cycles?.length       ? { filter_cycles:      filter_cycles.join(',')       } : {}),
          ...(filter_machines?.length     ? { filter_machines:    filter_machines.join(',')     } : {}),
          ...(filter_nmsx?.length         ? { filter_nmsx:        filter_nmsx.join(',')         } : {}),
          ...(ncc_ids?.length             ? { ncc_ids:            ncc_ids.join(',')             } : {}),
          ...(date_pct_ranges?.length     ? { date_pct_ranges:    date_pct_ranges.join(',')     } : {}),
        },
      })
      return data.data as { groups: InventorySummaryGroup[]; total: number; total_cartons_remaining: number }
    },
  })
}

// Lấy TOÀN BỘ entry khớp filter để export Excel (BE phân trang nội bộ). On-demand, không phải useQuery.
export async function fetchInventoryExport(params?: Parameters<typeof useInventoryEntries>[0]): Promise<InventoryEntry[]> {
  const { warehouse_ids, categories, filter_locations, filter_material_ids, qa_status_ids, filter_cycles, filter_machines, filter_nmsx, ncc_ids, date_pct_ranges, page, limit, ...rest } = params ?? {}
  void page; void limit
  const { data } = await apiClient.get('/wms/inventory/export', {
    params: {
      ...rest,
      ...(warehouse_ids?.length       ? { warehouse_ids:      warehouse_ids.join(',')       } : {}),
      ...(categories?.length          ? { categories:         categories.join(',')          } : {}),
      ...(filter_locations?.length    ? { filter_locations:   filter_locations.join(',')    } : {}),
      ...(filter_material_ids?.length ? { filter_material_ids:filter_material_ids.join(',') } : {}),
      ...(qa_status_ids?.length       ? { qa_status_ids:      qa_status_ids.join(',')       } : {}),
      ...(filter_cycles?.length       ? { filter_cycles:      filter_cycles.join(',')       } : {}),
      ...(filter_machines?.length     ? { filter_machines:    filter_machines.join(',')     } : {}),
      ...(filter_nmsx?.length         ? { filter_nmsx:        filter_nmsx.join(',')         } : {}),
      ...(ncc_ids?.length             ? { ncc_ids:            ncc_ids.join(',')             } : {}),
      ...(date_pct_ranges?.length     ? { date_pct_ranges:    date_pct_ranges.join(',')     } : {}),
    },
  })
  return (data.data?.entries ?? []) as InventoryEntry[]
}

export function useInventoryFacets(params?: { warehouse_ids?: string[]; categories?: string[] }) {
  return useQuery({
    queryKey: ['inventory-facets', params],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { warehouse_ids, categories } = params ?? {}
      const { data } = await apiClient.get('/wms/inventory/facets', {
        params: {
          ...(warehouse_ids?.length ? { warehouse_ids: warehouse_ids.join(',') } : {}),
          ...(categories?.length    ? { categories:    categories.join(',')    } : {}),
        },
      })
      return data.data as {
        cycles:    string[]
        machines:  string[]
        locations: { id: string; code: string }[]
        materials: { id: string; code: string; name: string | null }[]
      }
    },
  })
}

export interface AdjustmentLog {
  id: string
  delta: number
  cartons_before: number
  cartons_after: number
  note: string | null
  actor_name: string | null
  actor_id: string | null
  adjusted_at: string
}

export function useAdjustInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, adjustment, employee_id, note, actor_name }: {
      id: string; adjustment: number; employee_id?: string; note?: string; actor_name?: string
    }) => {
      const { data } = await apiClient.patch(`/wms/inventory/${id}/adjust`, { adjustment, employee_id, note, actor_name })
      return data.data as { entry: InventoryEntry }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['adjustment-log', vars.id] })
    },
  })
}

export function useAdjustmentLog(entryId: string) {
  return useQuery({
    queryKey: ['adjustment-log', entryId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inventory/${entryId}/adjustment-log`)
      return data.data as AdjustmentLog[]
    },
    enabled: !!entryId,
  })
}

export function useBulkUpdateInventoryQA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, qa_status_id, employee_id }: { ids: string[]; qa_status_id: string | null; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-qa', { ids, qa_status_id, employee_id })
      return data.data as { updated: number }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
  })
}

export function useBulkUpdateInventoryNcc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, ncc_id, shelf_life_days, employee_id }: { ids: string[]; ncc_id: string | null; shelf_life_days?: number | null; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-ncc', { ids, ncc_id, shelf_life_days, employee_id })
      return data.data as { updated: number }
    },
    // NCC đổi → %Date tính lại ở cả list & tổng hợp
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
    },
  })
}

export function useBulkTransferLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, location_id, employee_id }: { ids: string[]; location_id: string; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-location', { ids, location_id, employee_id })
      return data.data as { updated: number; location_code: string }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
  })
}

export function useBulkTransferMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, material_id, employee_id }: { ids: string[]; material_id: string; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-material', { ids, material_id, employee_id })
      return data.data as { updated: number; material_code: string }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
  })
}

export function useBulkUpdateProductionDate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, production_date, employee_id }: { ids: string[]; production_date: string; employee_id?: string }) => {
      const { data } = await apiClient.patch('/wms/inventory/bulk-production-date', { ids, production_date, employee_id })
      return data.data as { updated: number }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
  })
}

export function useStocktakeEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; employee_id?: string; new_location_id?: string; physical_count?: number }) => {
      const { data } = await apiClient.post(`/wms/inventory/${id}/stocktake`, body)
      return data.data as { ok: boolean }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['stocktake-entries'] })
    },
  })
}

export function useUnflagEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.patch(`/wms/inventory/${id}/unflag`)
      return data.data as { ok: boolean }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['stocktake-entries'] })
    },
  })
}

export interface StocktakeEntryRow {
  id:                  string
  pallet_code:         string
  cartons_remaining:   number
  import_date:         string
  stocktake_flagged:   boolean
  stocktake_flag_note: string | null
  stocktake_at:        string | null
  location:            { id: string; location_code: string } | null
  material:            { material_code: string; short_name: string | null } | null
  stocktake_by_emp:    { id: string; name: string } | null
}

export interface StocktakeEntriesResult {
  stats:   { total: number; checked: number; unchecked: number; flagged: number }
  entries: StocktakeEntryRow[]
}

export function useStocktakeEntries(
  params: { warehouse_id?: string; category?: string; location_ids?: string; view?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: ['stocktake-entries', params],
    queryFn: async () => {
      const q: Record<string, string> = {}
      if (params.warehouse_id) q.warehouse_id = params.warehouse_id
      if (params.category)     q.category     = params.category
      if (params.location_ids) q.location_ids = params.location_ids
      if (params.view)         q.view         = params.view
      const { data } = await apiClient.get('/wms/inventory/stocktake-entries', { params: q })
      return data.data as StocktakeEntriesResult
    },
    enabled,
  })
}

// WMS (mock — legacy, không dùng nữa)
export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: async () => { await delay(); return mockInventory },
  })
}

export function useTransactions(limit?: number) {
  return useQuery({
    queryKey: ['transactions', limit],
    queryFn: async () => {
      await delay()
      return limit ? mockTransactions.slice(0, limit) : mockTransactions
    },
  })
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async () => { await delay(); return mockLocations },
  })
}

// TMS
export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => { await delay(); return mockVehicles },
  })
}

// HR (mock)
export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => { await delay(); return mockEmployees },
  })
}

// ─── Permission masterdata (API thật) ────────────────────────────────────────

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/departments')
      return data.data as Department[]
    },
  })
}

export function useJobTitles(departmentId?: string) {
  return useQuery({
    queryKey: ['job-titles', departmentId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/job-titles', {
        params: departmentId ? { department_id: departmentId } : {},
      })
      return data.data as JobTitle[]
    },
  })
}

export function useEmployeeRecords(params?: { department_id?: string; search?: string; is_active?: string; include_deleted?: boolean }) {
  return useQuery({
    queryKey: ['employee-records', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/employees', { params })
      return data.data as EmployeeRecord[]
    },
    staleTime: 0,
  })
}

export function useEmployeeRecord(id?: string) {
  return useQuery({
    queryKey: ['employee-record', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/masterdata/employees/${id}`)
      return data.data as EmployeeRecord
    },
  })
}

export function useCreateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string; employee_code: string; email?: string; phone?: string
      department_id?: string | null; job_title_id?: string | null
      allowed_categories?: string[]; warehouse_scope?: string
      warehouse_ids?: string[]
      ncc_id?: string | null; is_driver?: boolean
    }) => apiClient.post('/masterdata/employees', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-records'] }),
  })
}

export function useUpdateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; name?: string; phone?: string; email?: string
      department_id?: string | null; job_title_id?: string | null
      allowed_categories?: string[]; warehouse_scope?: string
      is_active?: boolean; warehouse_ids?: string[]
      ncc_id?: string | null; is_driver?: boolean
    }) => apiClient.patch(`/masterdata/employees/${id}`, body).then(r => r.data.data),
    onSuccess: (updated: EmployeeRecord, v) => {
      // Cập nhật cache ngay lập tức thay vì refetch toàn bộ
      qc.setQueriesData<EmployeeRecord[]>(
        { queryKey: ['employee-records'] },
        old => old?.map(e => e.id === v.id ? updated : e)
      )
    },
  })
}

export function useSetManager() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, manager_id }: { id: string; manager_id: string | null }) =>
      apiClient.patch(`/masterdata/employees/${id}/manager`, { manager_id }).then(r => r.data.data as EmployeeRecord),
    onSuccess: (updated, v) => {
      qc.setQueriesData<EmployeeRecord[]>({ queryKey: ['employee-records'] }, old => old?.map(e => e.id === v.id ? updated : e))
    },
  })
}

export function useDeleteEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/masterdata/employees/${id}`).then(r => r.data.data as { message: string; deleted: 'hard' | 'soft' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-records'] }),
  })
}

export function useRestoreEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/masterdata/employees/${id}/restore`).then(r => r.data.data as EmployeeRecord),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-records'] }),
  })
}

export function useSetEmployeeWarehouses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, warehouse_ids }: { id: string; warehouse_ids: string[] }) =>
      apiClient.put(`/masterdata/employees/${id}/warehouses`, { warehouse_ids }).then(r => r.data.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['employee-records'] })
      qc.invalidateQueries({ queryKey: ['employee-record', v.id] })
    },
  })
}

export function useCreateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; code: string; allowed_modules?: string[] }) =>
      apiClient.post('/masterdata/departments', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  })
}

export function useUpdateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; code?: string; is_active?: boolean }) =>
      apiClient.put(`/masterdata/departments/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  })
}

export function useCreateJobTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string; department_id: string; parent_id?: string | null; in_chart?: boolean
      allowed_categories?: string[]; warehouse_scope?: string
      module_permissions?: Record<string, string[]>
    }) => apiClient.post('/masterdata/job-titles', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
  })
}

export function useSetJobTitleParent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, parent_id, in_chart }: { id: string; parent_id: string | null; in_chart?: boolean }) =>
      apiClient.patch(`/masterdata/job-titles/${id}/parent`, { parent_id, in_chart }).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
  })
}

export function useUpdateJobTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; name?: string
      allowed_categories?: string[]; warehouse_scope?: string; is_active?: boolean
      module_permissions?: Record<string, string[]>
    }) => apiClient.put(`/masterdata/job-titles/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
  })
}

// ─── Outbound (API thật) ─────────────────────────────────────────────────────

type GDOFormPayload = {
  delivery_date: string
  warehouse_id?: string
  warehouse_type?: string
  shipto_party?: string
  dvvt: string
  customer_name: string
  delivery_code?: string
  export_type: string
  items?: Array<{ db_id?: string; material_code: string; cartons_ordered: number; loose_picking?: number; header_text?: string }>
}

export type LookupItem = { id: string; value: string }

export function useLookup(type: string) {
  return useQuery({
    queryKey: ['lookup', type],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/lookup', { params: { type } })
      return data.data as LookupItem[]
    },
  })
}

export function useAddLookup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ type, value }: { type: string; value: string }) => {
      const { data } = await apiClient.post('/wms/lookup', { type, value })
      return data.data as LookupItem
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['lookup', vars.type] }),
  })
}

export function useDeleteLookup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ type, id }: { type: string; id: string }) => {
      await apiClient.delete(`/wms/lookup/${id}`)
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['lookup', vars.type] }),
  })
}

// ─── Loose picking (nhặt lẻ) ─────────────────────────────────

export type LoosePickingItem = {
  id: string
  do_id: string
  material_id: string | null
  material_code_raw: string | null
  material: { id: string; material_code: string; short_name: string } | null
  cartons_ordered: number
  loose_picking: number
  cartons_scanned: number
  loose_scanned: number
  status: string
  header_text: string | null
  batch_required: string | null
  date_required: number | null
  gdo: {
    id: string
    group_code: string
    delivery_date: string | null
    planned_date: string | null
    status: string
    started_at: string | null
    dvvt: string | null
    warehouse_type: string | null
    export_type: string | null
    distributor_names: string[]
    warehouse: { id: string; code: string; name: string }
  } | null
}

export function useLoosePickingItems(params: { warehouse_id?: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ['loosepicking', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/loosepicking', { params })
      return data.data as LoosePickingItem[]
    },
  })
}

export function useScanLoosePickingItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, ...body }: {
      gdoId: string; itemId: string; qr_code: string; cartons_override?: number
    }) => apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/scan`, {
      ...body, loose_picking_mode: true,
    }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loosepicking'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo'] })
      // quét nhặt lẻ reserve tồn → làm mới tồn kho & gợi ý FEFO
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export function useCreateGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: GDOFormPayload) => {
      const { data } = await apiClient.post('/wms/outbound', body)
      return data.data as GDO
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gdos'] }),
  })
}

export function useUpdateGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: GDOFormPayload & { id: string }) =>
      apiClient.put(`/wms/outbound/${id}`, body).then(r => r.data.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}

export function useDeleteGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/outbound/${id}`).then(r => r.data.data),
    onSuccess: (_d, id) => {
      useActiveVehiclesStore.getState().unpin(id)
      qc.invalidateQueries({ queryKey: ['gdos'] })
    },
  })
}

export function useGDOs(params?: { warehouse_id?: string; status?: string; transfer_status?: string; date?: string; date_from?: string; date_to?: string; search?: string }) {
  return useQuery({
    queryKey: ['gdos', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound', { params })
      return data.data as GDO[]
    },
  })
}

export function useGDO(id?: string) {
  return useQuery({
    queryKey: ['gdo', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/outbound/${id}`)
      return data.data as GDO
    },
  })
}

export function usePatchGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; delivery_date?: string; status?: string }) =>
      apiClient.patch(`/wms/outbound/${id}`, body).then(r => r.data.data),
    onMutate: async ({ id, status }) => {
      if (!status) return
      await qc.cancelQueries({ queryKey: ['gdo', id] })
      const prev = qc.getQueryData(['gdo', id])
      qc.setQueryData(['gdo', id], (old: any) => old ? { ...old, status } : old)
      return { prev, id }
    },
    onError: (_, __, ctx: any) => ctx && qc.setQueryData(['gdo', ctx.id], ctx.prev),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
    },
  })
}

export function useUploadGDOExcel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, warehouse_id }: { file: File; warehouse_id?: string }) => {
      const form = new FormData()
      form.append('file', file)
      if (warehouse_id) form.append('warehouse_id', warehouse_id)
      return apiClient.post('/wms/outbound/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      }).then(r => r.data.data)
    },
    onSuccess: () => qc.refetchQueries({ queryKey: ['gdos'] }),
  })
}

export function useScanOutboundItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, ...body }: {
      gdoId: string; itemId: string; qr_code: string; employee_id?: string; cartons_override?: number
    }) => apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/scan`, body).then(r => r.data.data),
    onSuccess: (data: { scan_entry: { id: string; pallet_code: string; cartons_scanned: number }; item: { cartons_scanned: number; status: string } }, v) => {
      qc.setQueryData(['gdo', v.gdoId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          delivery_orders: old.delivery_orders?.map((d: any) => ({
            ...d,
            items: d.items?.map((item: any) => {
              if (item.id !== v.itemId) return item
              return {
                ...item,
                cartons_scanned: data.item.cartons_scanned,
                status:          data.item.status,
                scan_entries:    [...(item.scan_entries ?? []), {
                  ...data.scan_entry,
                  is_loose_picking: false, loose_confirmed: false, loose_confirmed_at: null,
                  scanned_by: null, scanned_at: new Date().toISOString(),
                  pct_date: null, production_date: null, best_available_date: null,
                }],
              }
            }),
          })),
        }
      })
      qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] })
      // quét xuất trừ tồn InventoryEntry → làm mới tồn kho & gợi ý FEFO
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export function useManualCompleteItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, cartons }: { gdoId: string; itemId: string; cartons?: number }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/manual-complete`, cartons != null ? { cartons } : {}).then(r => r.data.data),
    onMutate: async ({ gdoId, itemId, cartons }) => {
      await qc.cancelQueries({ queryKey: ['gdo', gdoId] })
      const prev = qc.getQueryData(['gdo', gdoId])
      qc.setQueryData(['gdo', gdoId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          delivery_orders: old.delivery_orders?.map((d: any) => ({
            ...d,
            items: d.items?.map((item: any) =>
              item.id === itemId
                ? { ...item, status: 'COMPLETED', cartons_scanned: cartons ?? item.cartons_ordered }
                : item
            ),
          })),
        }
      })
      return { prev }
    },
    onError: (_e, { gdoId }, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['gdo', gdoId], ctx.prev)
    },
    onSettled: (_d, _e, { gdoId, itemId }) => {
      qc.invalidateQueries({ queryKey: ['gdo', gdoId] })
      qc.invalidateQueries({ queryKey: ['manual-item-stock', gdoId, itemId] })
      // manual-complete có thể trừ tồn → làm mới tồn kho & gợi ý FEFO
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export function useDeleteOutboundScanEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, scanId }: { gdoId: string; itemId: string; scanId: string }) =>
      apiClient.delete(`/wms/outbound/${gdoId}/items/${itemId}/scans/${scanId}`).then(r => r.data.data),
    onMutate: async ({ gdoId, itemId, scanId }) => {
      await qc.cancelQueries({ queryKey: ['gdo', gdoId] })
      const prev = qc.getQueryData(['gdo', gdoId])
      qc.setQueryData(['gdo', gdoId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          delivery_orders: old.delivery_orders?.map((d: any) => ({
            ...d,
            items: d.items?.map((item: any) => {
              if (item.id !== itemId) return item
              const entry = (item.scan_entries ?? []).find((e: any) => e.id === scanId)
              const removed = Number(entry?.cartons_scanned ?? 0)
              const newScanned = Math.max(0, Number(item.cartons_scanned) - removed)
              return {
                ...item,
                cartons_scanned: newScanned,
                status: newScanned === 0 ? 'PENDING' : newScanned < Number(item.cartons_ordered) ? 'IN_PROGRESS' : item.status,
                scan_entries: (item.scan_entries ?? []).filter((e: any) => e.id !== scanId),
              }
            }),
          })),
        }
      })
      return { prev, gdoId }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['gdo', ctx.gdoId], ctx.prev)
    },
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] })
      qc.invalidateQueries({ queryKey: ['manual-item-stock', v.gdoId, v.itemId] })
      // xóa scan hoàn tồn kho lại → làm mới tồn kho & gợi ý FEFO
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['inventory-summary'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export type ItemInventoryEntry = {
  id:                string
  pallet_code:       string
  cartons_remaining: number
  cartons_imported:  number
  location_code:     string | null
  production_date:   string | null
  import_date:       string | null
  pct_date:          number | null
  available:         number
  qa_status:         { id: string; code: string; name: string } | null
}

export type CheckOutboundScanResult = {
  pallet_code:       string
  production_date:   string | null
  best_available_date: string | null
  available_cartons: number
  suggested_cartons: number
}

export function useConfirmLoosePickingItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, employee_id }: { gdoId: string; itemId: string; employee_id?: string }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/confirm-loose`, { employee_id }).then(r => r.data.data),
    onSuccess: (_d, v) => {
      // confirm-loose giảm tồn InventoryEntry → làm mới cả tồn kho & list nhặt lẻ
      qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] })
      qc.invalidateQueries({ queryKey: ['inventory-entries'] })
      qc.invalidateQueries({ queryKey: ['loosepicking'] })
      qc.invalidateQueries({ queryKey: ['item-inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-by-material'] })
    },
  })
}

export function useCheckOutboundScan() {
  return useMutation({
    mutationFn: ({ gdoId, itemId, qr_code }: { gdoId: string; itemId: string; qr_code: string }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/check-scan`, { qr_code }).then(r => r.data.data as CheckOutboundScanResult),
  })
}

export interface CheckScanResult {
  pallet_code: string
  production_date: string | null
  suggested_cartons: number
  outbound_cartons?: number | null
  will_merge?: boolean
  cartons_existing?: number
  existing_entry_id?: string
  merge_warning?: string
}

export function useCheckInboundScan() {
  return useMutation({
    mutationFn: ({ orderId, qr_code, location_id, stack_layer }: {
      orderId: string; qr_code: string; location_id: string; stack_layer: number
    }) =>
      apiClient.post(`/wms/inbound-orders/${orderId}/check-scan`, { qr_code, location_id, stack_layer })
        .then(r => r.data.data as CheckScanResult),
  })
}

export function useItemInventory(gdoId: string | undefined, itemId: string | undefined) {
  return useQuery({
    queryKey: ['item-inventory', gdoId, itemId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/outbound/${gdoId}/items/${itemId}/inventory`)
      return data.data as ItemInventoryEntry[]
    },
    enabled: !!gdoId && !!itemId,
    staleTime: 30_000,
  })
}

// Gợi ý vị trí lấy hàng FEFO (chỉ dùng ở Bảng chuẩn bị hàng).
export type PickSuggestion = { location_code: string | null; pct_date: number | null; available: number }

// Bảng chuẩn bị hàng — gom nhiều GDO. queryKey bắt đầu 'gdo' → OutboundItem/ScanEntry đổi
// tự invalidate (realtime trừ dần pallet cần chuẩn bị khi quét).
export type PrepareRow = {
  material_id: string | null; material_code: string; material_name: string | null
  cartons_ordered: number; cartons_scanned: number; cartons_remaining: number
  cartons_per_pallet: number; pallets_remaining: number; no_qr_tracking: boolean
  suggestions: PickSuggestion[]
}
export type PrepareBoard = { rows: PrepareRow[]; total_cartons: number; total_pallets: number }

// Tồn kho theo mã hàng + kho (nút search tồn kho ở bảng chuẩn bị)
export function useInventoryByMaterial(materialId: string | null, warehouseId: string | undefined) {
  return useQuery({
    queryKey: ['inventory-by-material', materialId, warehouseId],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/inventory-by-material', {
        params: { material_id: materialId, warehouse_id: warehouseId || undefined },
      })
      return data.data as ItemInventoryEntry[]
    },
    enabled: !!materialId,
    staleTime: 15_000,
  })
}

export function usePrepareBoard(gdoIds: string[]) {
  const key = [...gdoIds].sort().join(',')
  return useQuery({
    queryKey: ['gdo', 'prepare', key],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/prepare', { params: { gdo_ids: key } })
      return data.data as PrepareBoard
    },
    enabled: gdoIds.length > 0,
    staleTime: 10_000,
  })
}

export function useManualItemStock(gdoId: string | undefined, itemId: string | undefined) {
  return useQuery({
    queryKey: ['manual-item-stock', gdoId, itemId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/outbound/${gdoId}/items/${itemId}/manual-stock`)
      return data.data as { cartons_imported: number; cartons_remaining: number; cartons_ordered: number; cartons_scanned: number }
    },
    enabled: !!gdoId && !!itemId,
    staleTime: 0,
  })
}

export function useInventoryEntry(id?: string | null) {
  return useQuery({
    queryKey: ['inventory-entry', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inventory/${id}`)
      return data.data as InventoryEntry
    },
    staleTime: 60_000,
  })
}

export function useAssignGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, assigned_by }: { id: string; assigned_by?: string }) =>
      apiClient.post(`/wms/outbound/${id}/assign`, { assigned_by }).then(r => r.data.data),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['gdo', id] })
      const prev = qc.getQueryData(['gdo', id])
      qc.setQueryData(['gdo', id], (old: any) => old ? { ...old, assigned_at: new Date().toISOString() } : old)
      return { prev, id }
    },
    onError: (_, __, ctx: any) => ctx && qc.setQueryData(['gdo', ctx.id], ctx.prev),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}

export function useStartGDO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; license_plate: string; container_number?: string
      exporter_name?: string; loader_name?: string
      forklift_driver_id?: string; forklift_driver_names?: string
      gate_registration_id?: string | null; allow_shared_gate?: boolean
    }) => apiClient.post(`/wms/outbound/${id}/start`, body).then(r => r.data.data),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['gdo', id] })
      const prev = qc.getQueryData(['gdo', id])
      qc.setQueryData(['gdo', id], (old: any) => old ? { ...old, started_at: new Date().toISOString(), status: 'IN_PROGRESS' } : old)
      return { prev, id }
    },
    onError: (_, __, ctx: any) => ctx && qc.setQueryData(['gdo', ctx.id], ctx.prev),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['gdo', id] })
    },
  })
}

export function useUpdateTransport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; license_plate: string; container_number?: string
      exporter_name?: string; loader_name?: string
      forklift_driver_id?: string; forklift_driver_names?: string
      gate_registration_id?: string | null; allow_shared_gate?: boolean
    }) => apiClient.patch(`/wms/outbound/${id}/transport`, body).then(r => r.data.data as GDO),
    onSuccess: (data, { id }) => {
      qc.setQueryData(['gdo', id], data)
      qc.invalidateQueries({ queryKey: ['gdos'] })
    },
  })
}

function makeUndoGDOMutation(path: string, optimisticFn?: (old: any) => any, extraInvalidate?: string[][]) {
  return function() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: (id: string) => apiClient.post(`/wms/outbound/${id}/${path}`).then(r => r.data.data),
      onMutate: async (id: string) => {
        if (!optimisticFn) return
        await qc.cancelQueries({ queryKey: ['gdo', id] })
        const prev = qc.getQueryData(['gdo', id])
        qc.setQueryData(['gdo', id], (old: any) => old ? optimisticFn(old) : old)
        return { prev, id }
      },
      onError: (_, _id, ctx: any) => ctx?.prev && qc.setQueryData(['gdo', ctx.id], ctx.prev),
      onSettled: (_d, _e, id) => {
        qc.invalidateQueries({ queryKey: ['gdos'] })
        qc.invalidateQueries({ queryKey: ['gdo', id] })
        extraInvalidate?.forEach(key => qc.invalidateQueries({ queryKey: key }))
      },
    })
  }
}
export const useUnassignGDO   = makeUndoGDOMutation('unassign',
  old => ({ ...old, assigned_at: null, assigned_by: null, status: 'PENDING' }))
export const useUnstartGDO    = makeUndoGDOMutation('unstart',
  old => ({ ...old, started_at: null, license_plate: null, container_number: null, exporter_name: null, loader_name: null, forklift_driver_id: null, forklift_driver_names: null, status: 'PENDING' }))
export const useUncompleteGDO = makeUndoGDOMutation('uncomplete',
  old => ({ ...old, status: 'IN_PROGRESS', completed_at: null, scan_completed_at: null }),
  [['tms-orders'], ['tms-orders-transfer']])

export function useWarehouseEmployees(warehouse_id?: string | null) {
  return useQuery({
    queryKey: ['warehouse-employees', warehouse_id],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/employees', {
        params: warehouse_id ? { warehouse_id } : undefined,
      })
      return data.data as { id: string; name: string; employee_code: string; job_title?: string | null }[]
    },
  })
}

// ─── Outbound scan log (lịch sử quét xuất kho) ──────────────────────────────

export type OutboundScanLogEntry = {
  id: string
  pallet_code: string
  cartons_scanned: number
  production_date: string | null
  best_available_date: string | null
  scanned_at: string
  is_loose_picking: boolean
  loose_confirmed_at: string | null
  loose_confirmed_by_name: string | null
  group_code: string
  delivery_date: string | null
  license_plate: string | null
  container_number: string | null
  forklift_driver_names: string | null
  loader_name: string | null
  assigned_at: string | null
  started_at: string | null
  last_scanned_at: string | null
  completed_at: string | null
  warehouse_name: string
  delivery_code: string | null
  distributor_name: string | null
  header_text: string | null
  material_code_raw: string | null
  material_code: string | null
  material_name: string | null
  material_category: string | null
  shelf_life_days: number | null
  cycle: string | null
  machine_code: string | null
  nmsx: string | null
  import_date: string | null
  location_code: string | null
  scanner_name: string | null
  total_count: number
}

export type ScanLogParams = {
  from_date?: string
  to_date?: string
  warehouse_ids?: string       // comma-separated
  material_category?: string
  group_code?: string
  distributor?: string
  delivery_code?: string
  pallet_code?: string
  material?: string
  machine_codes?: string       // comma-separated
  cycles?: string              // comma-separated
  scanner_name?: string
  nmsx?: string                // comma-separated
  page?: number
  limit?: number
}

export function useOutboundScanLog(params: ScanLogParams, enabled = true) {
  return useQuery({
    queryKey: ['outbound-scan-log', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/scan-log', { params })
      return data.data as { rows: OutboundScanLogEntry[]; total: number; page: number; limit: number }
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData, // đổi trang/lọc: giữ dữ liệu cũ, không trắng bảng
  })
}

export function useOutboundScanLogFacets(materialCategory?: string) {
  return useQuery({
    queryKey: ['scan-log-facets', materialCategory],
    enabled: !!materialCategory,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/scan-log/facets', {
        params: { material_category: materialCategory },
      })
      return data.data as { machines: string[]; cycles: string[] }
    },
  })
}

// Export ScanLog: loop phân trang (BE cap limit=1000) gom toàn bộ dòng khớp filter đã áp.
export async function fetchScanLogExport(applied: ScanLogParams): Promise<OutboundScanLogEntry[]> {
  const LIMIT = 1000
  const all: OutboundScanLogEntry[] = []
  let page = 1
  for (;;) {
    const { data } = await apiClient.get('/wms/outbound/scan-log', { params: { ...applied, page, limit: LIMIT } })
    const d = data.data as { rows: OutboundScanLogEntry[]; total: number }
    all.push(...d.rows)
    if (d.rows.length === 0 || all.length >= d.total) break
    page++
  }
  return all
}

// ─── TMS ─────────────────────────────────────────────────────────────────────

export function useVehicleTypesByWarehouse(warehouseId: string | null, cargoType?: string) {
  return useQuery<TmsVehicleType[]>({
    queryKey: ['tms-vehicle-types-by-warehouse', warehouseId, cargoType ?? null],
    enabled: !!warehouseId,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const params: Record<string, string> = { warehouse_id: warehouseId! }
      if (cargoType) params.cargo_type = cargoType
      const { data } = await apiClient.get('/tms/slot-templates/vehicle-types', { params })
      return data.data as TmsVehicleType[]
    },
  })
}

export function useVehicleTypes(onlyActive = false) {
  return useQuery({
    queryKey: ['tms-vehicle-types', onlyActive],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/vehicle-types', {
        params: onlyActive ? { is_active: 'true' } : {},
      })
      return data.data as TmsVehicleType[]
    },
  })
}

export function useCreateVehicleType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string }) =>
      apiClient.post('/tms/vehicle-types', body).then(r => r.data.data as TmsVehicleType),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicle-types'] }),
  })
}

// Kéo-thả sắp thứ tự loại xe (sort_order) — ids theo thứ tự mới
export function useReorderVehicleTypes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.put('/tms/vehicle-types/reorder', { ids }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicle-types'] }),
  })
}

export function useUpdateVehicleType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; is_active?: boolean }) =>
      apiClient.put(`/tms/vehicle-types/${id}`, body).then(r => r.data.data as TmsVehicleType),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicle-types'] }),
  })
}

export function useDeleteVehicleType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/vehicle-types/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicle-types'] }),
  })
}

export function useSlotTemplates(params?: { warehouse_id?: string; vehicle_type_id?: string }) {
  return useQuery({
    queryKey: ['tms-slot-templates', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/slot-templates', { params })
      return data.data as SlotTemplate[]
    },
    enabled: !!params?.warehouse_id,
  })
}

export function useCreateSlotTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      warehouse_id: string; vehicle_type_id: string; cargo_type?: string
      days_of_week: number[]; time_from: string; time_to: string; max_vehicles: number
    }) => apiClient.post('/tms/slot-templates', body).then(r => r.data.data as SlotTemplate[]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-slot-templates'] }),
  })
}

export function useUpdateSlotTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; time_from?: string; time_to?: string; max_vehicles?: number; cargo_type?: string; is_active?: boolean }) =>
      apiClient.put(`/tms/slot-templates/${id}`, body).then(r => r.data.data as SlotTemplate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-slot-templates'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })   // reapply đổi slot ngày tương lai
    },
  })
}

export function useDeleteSlotTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/slot-templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-slot-templates'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

// Lưu cả cụm khung giờ (lưới thứ × khung giờ) của 1 loại xe
export function useBatchSlotTemplates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      warehouse_id: string; vehicle_type_id: string; cargo_type: string
      days_of_week: number[]; time_slots: { time_from: string; time_to: string; max_vehicles: number }[]
    }) => apiClient.post('/tms/slot-templates/batch', body).then(r => r.data.data as { inserted: number; updated: number; removed: number }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-slot-templates'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicle-types-by-warehouse'] })
    },
  })
}

// Xóa cả cụm khung giờ (rule) của 1 loại xe + loại kho
export function useDeleteSlotTemplateCluster() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: { warehouse_id: string; vehicle_type_id: string; cargo_type: string }) =>
      apiClient.delete('/tms/slot-templates/cluster', { params }).then(r => r.data.data as { deleted: number; deactivated: number }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-slot-templates'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicle-types-by-warehouse'] })
    },
  })
}

export interface SlotApplyInfo {
  today: string
  applicable_from: string | null
  nearest_blocked: { date: string; booked: number } | null
}
export function useSlotApplyInfo(params: { warehouse_id?: string; vehicle_type_id?: string }) {
  return useQuery({
    queryKey: ['tms-slot-apply-info', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/slot-templates/apply-info', { params })
      return data.data as SlotApplyInfo
    },
    enabled: !!params.warehouse_id && !!params.vehicle_type_id,
  })
}

export function useTransportCompanies(onlyActive = false) {
  return useQuery({
    queryKey: ['tms-transport-companies', onlyActive],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/transport-companies', {
        params: onlyActive ? { is_active: 'true' } : {},
      })
      return data.data as TransportCompany[]
    },
  })
}

export function useCreateTransportCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; type?: 'ĐVVT' | 'NCC'; contact_name?: string; contact_phone?: string; alias_codes?: string }) =>
      apiClient.post('/tms/transport-companies', body).then(r => r.data.data as TransportCompany),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-transport-companies'] }),
  })
}

export function useUpdateTransportCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; type?: 'ĐVVT' | 'NCC'; contact_name?: string; contact_phone?: string; is_active?: boolean; alias_codes?: string }) =>
      apiClient.put(`/tms/transport-companies/${id}`, body).then(r => r.data.data as TransportCompany),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-transport-companies'] }),
  })
}

export function useTmsVehicles(params?: { ncc_id?: string; is_active?: string; unassigned?: string; pool_branches?: string }) {
  return useQuery({
    queryKey: ['tms-vehicles', params],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/vehicles', { params })
      return data.data as TmsVehicle[]
    },
  })
}

export function useCreateTmsVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { ncc_id: string; license_plate: string; vehicle_type_id: string }) =>
      apiClient.post('/tms/vehicles', body).then(r => r.data.data as TmsVehicle),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicles'] }),
  })
}

export function useUpdateTmsVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; ncc_id?: string; license_plate?: string; vehicle_type_id?: string; is_active?: boolean }) =>
      apiClient.put(`/tms/vehicles/${id}`, body).then(r => r.data.data as TmsVehicle),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-vehicles'] }),
  })
}

export function useDeleteTmsVehicle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/vehicles/${id}`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-vehicles'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
    },
  })
}

export function useDeleteTransportCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/transport-companies/${id}`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-transport-companies'] })
      qc.invalidateQueries({ queryKey: ['tms-vehicles'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
    },
  })
}

// ── TMS Delivery Slots ────────────────────────────────────────────────────────

export function useDeliverySlots(params?: { date?: string; warehouse_id?: string; direction?: string }) {
  return useQuery({
    queryKey: ['tms-delivery-slots', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/slots', { params })
      return data.data as import('@/types').DeliverySlot[]
    },
    enabled: !!params?.date && !!params?.warehouse_id,
  })
}

export function useGenerateSlots() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; dates: string[] }) =>
      apiClient.post('/tms/slots/generate', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] }),
  })
}

// ── TMS Orders ───────────────────────────────────────────────────────────────

export function useTmsOrders(params?: { date_from?: string; date_to?: string; warehouse_id?: string }) {
  return useQuery({
    queryKey: ['tms-orders', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/orders', { params })
      return data.data as import('@/types').TmsOrder[]
    },
    enabled: !!params?.date_from,
  })
}

export type TransferGDO = {
  id: string; group_code: string; shipto_party: string | null; transfer_status: string | null
  delivery_date?: string | null
  dvvt?: string | null
  license_plate?: string | null
  warehouse?: { id: string; code: string; name: string } | null
  delivery_codes?: string[]
}
export type TransferOrder = import('@/types').TmsOrder & {
  transfer_gdo?: TransferGDO | null
  receiving_started_at?: string | null
  actual_received?: number
}

// destination_warehouse_id: nếu truyền, lọc theo kho nhận (dùng ở Inbound để hiển thị đúng kho)
// Nếu không truyền: hiển thị tất cả lệnh TRANSFER (dùng ở TMS Bookings)
export function useTransferOrders(destination_warehouse_id?: string) {
  return useQuery({
    queryKey: ['tms-orders-transfer', destination_warehouse_id ?? 'all'],
    queryFn: async () => {
      const params: Record<string, string> = { source_type: 'TRANSFER' }
      if (destination_warehouse_id) params.destination_warehouse_id = destination_warehouse_id
      const { data } = await apiClient.get('/tms/orders', { params })
      return data.data as TransferOrder[]
    },
  })
}

export type TransferGoodsRow = {
  material_id: string
  material_code: string | null
  material_name: string | null
  unit: string | null
  planned_boxes: number
  actual_boxes: number
  no_qr_tracking?: boolean
  pallets: { pallet_code: string; cartons_outbound: number; cartons_inbound: number; inbound_at: string | null }[]
}

export function useTransferGoods(orderId?: string | null) {
  return useQuery({
    queryKey: ['transfer-goods', orderId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/tms/orders/${orderId}/transfer-goods`)
      return data.data as TransferGoodsRow[]
    },
    enabled: !!orderId,
    staleTime: 0,
  })
}

export type MaterialSummaryRow = {
  material_id: string
  material_code: string
  material_name: string
  unit: string
  planned_boxes: number
  actual_boxes: number
  diff: number
}

// Tổng hợp theo mã hàng across danh sách đơn (band tra cứu). order_ids = các đơn ĐÃ lọc trên UI → band khớp list.
export function useMaterialSummary(orderIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['tms-material-summary', [...orderIds].sort().join(',')],
    queryFn: async () => {
      const { data } = await apiClient.post('/tms/orders/material-summary', { order_ids: orderIds })
      return data.data as MaterialSummaryRow[]
    },
    enabled: enabled && orderIds.length > 0,
    staleTime: 15_000,
  })
}

export function useConfirmTransferReceipt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient.post(`/tms/orders/${orderId}/confirm-receipt`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
    },
  })
}

export function useCancelTransferReceipt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient.post(`/tms/orders/${orderId}/cancel-receipt`).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['gdos'] })
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-by-gdo'] })
    },
  })
}

export function useCreateOneInbound() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tmsOrderId, material_id }: { tmsOrderId: string; material_id: string }) =>
      apiClient.post(`/tms/orders/${tmsOrderId}/create-one-inbound`, { material_id }).then(r => r.data.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['inbound-by-gdo'] })
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['transfer-goods', v.tmsOrderId] })
    },
  })
}

export function useActiveImportsByGdo(gdoId?: string | null) {
  return useQuery({
    queryKey: ['inbound-by-gdo', gdoId],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-orders', { params: { from_gdo_id: gdoId } })
      return data.data as {
        material_id: string; status: string; id: string; import_code: string
        planned_cartons: number | null; total_cartons?: number
        posm_entry_id?: string | null
        material?: { no_qr_tracking?: boolean | null } | null
      }[]
    },
    enabled: !!gdoId,
    staleTime: 15_000,
  })
}

type OrderWriteBody = {
  order_code?: string; date?: string; warehouse_id?: string
  ncc_id?: string | null; npp_name?: string | null
  vehicle_type?: string | null; direction?: string | null; warehouse_type?: string | null
  planned_boxes?: number | null; planned_pallets?: number | null; planned_tons?: number | null
  gdo_refs?: string | null; notes?: string | null; status?: string
  eta?: string | null
}

export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: OrderWriteBody) =>
      apiClient.post('/tms/orders', body).then(r => r.data.data as import('@/types').TmsOrder),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-orders'] }),
  })
}

export function useUpdateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: OrderWriteBody & { id: string }) =>
      apiClient.patch(`/tms/orders/${id}`, body).then(r => r.data.data as import('@/types').TmsOrder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
    },
  })
}

export function useDeleteOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/orders/${id}`).then(() => id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-orders'] }),
  })
}

export function useBulkCreateOrders() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orders: OrderWriteBody[]) =>
      apiClient.post('/tms/orders/bulk', { orders }).then(r => r.data.data as { inserted: number }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-orders'] }),
  })
}

export function useBulkUpdateOrderDate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, date }: { ids: string[]; date: string }) =>
      apiClient.patch('/tms/orders/bulk-date', { ids, date }).then(r => r.data.data as { updated: number }),
    onMutate: async ({ ids }) => {
      await qc.cancelQueries({ queryKey: ['tms-orders'] })
      const snapshots = qc.getQueriesData<import('@/types').TmsOrder[]>({ queryKey: ['tms-orders'] })
      const idSet = new Set(ids)
      qc.setQueriesData<import('@/types').TmsOrder[]>(
        { queryKey: ['tms-orders'] },
        old => old?.filter(o => !idSet.has(o.id)) ?? old,
      )
      return { snapshots }
    },
    onError: (_e, _v, ctx: { snapshots: [unknown, unknown][] } | undefined) =>
      ctx?.snapshots.forEach(([k, d]) => qc.setQueryData(k as Parameters<typeof qc.setQueryData>[0], d)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tms-orders'] }),
  })
}

// ── TMS Vehicle Slots ─────────────────────────────────────────────────────────

type VehicleSlotWriteBody = {
  slot_id?: string | null; license_plate?: string | null
  driver_name?: string | null; driver_phone?: string | null; status?: string
  consolidation_order_ids?: string[]
}

export function useAddVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient.post(`/tms/orders/${orderId}/vehicle-slots`).then(r => r.data.data as import('@/types').TmsVehicleSlot),
    onMutate: async (orderId: string) => {
      await qc.cancelQueries({ queryKey: ['tms-orders'] })
      const snapshots = qc.getQueriesData<import('@/types').TmsOrder[]>({ queryKey: ['tms-orders'] })
      const tempSlot: import('@/types').TmsVehicleSlot = {
        id: `_temp_${Date.now()}`, order_id: orderId,
        slot_id: null, slot: null, license_plate: null,
        driver_name: null, driver_phone: null, status: 'PENDING', booked_by: null,
        consolidation_group_id: null, is_consolidation_primary: false,
        gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      qc.setQueriesData<import('@/types').TmsOrder[]>(
        { queryKey: ['tms-orders'] },
        old => old?.map(o => o.id === orderId ? { ...o, vehicle_slots: [...o.vehicle_slots, tempSlot] } : o)
      )
      return { snapshots }
    },
    onSuccess: (newSlot) => {
      // Thay thế temp slot bằng real UUID ngay khi server trả về — tránh action button dùng _temp_ id
      qc.setQueriesData<import('@/types').TmsOrder[]>(
        { queryKey: ['tms-orders'] },
        old => old?.map(o => o.id === newSlot.order_id
          ? { ...o, vehicle_slots: o.vehicle_slots.map(vs => vs.id.startsWith('_temp_') && vs.order_id === newSlot.order_id ? newSlot : vs) }
          : o
        )
      )
    },
    onError: (_e, _v, ctx: any) => ctx?.snapshots.forEach(([k, d]: any) => qc.setQueryData(k, d)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tms-orders'] }),
  })
}

export function useUpdateVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: VehicleSlotWriteBody & { id: string }) =>
      apiClient.patch(`/tms/vehicle-slots/${id}`, body).then(r => r.data.data as import('@/types').TmsVehicleSlot),
    onSuccess: (updated) => {
      // Patch booked_count trực tiếp từ server response — không chờ Realtime/refetch
      if (updated.slot_id && updated.slot) {
        qc.setQueriesData<import('@/types').DeliverySlot[]>(
          { queryKey: ['tms-delivery-slots'] },
          old => old?.map(s => s.id === updated.slot_id ? { ...s, booked_count: (updated.slot as import('@/types').DeliverySlot).booked_count } : s)
        )
      }
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['tms-orders-transfer'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

export function useReleaseVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/tms/vehicle-slots/${id}/release`).then(r => r.data.data as import('@/types').TmsVehicleSlot),
    onMutate: async (id: string) => {
      suppressTmsOrdersRealtime(5000)
      await qc.cancelQueries({ queryKey: ['tms-orders'] })
      const snapshots = qc.getQueriesData<import('@/types').TmsOrder[]>({ queryKey: ['tms-orders'] })
      qc.setQueriesData<import('@/types').TmsOrder[]>(
        { queryKey: ['tms-orders'] },
        old => old?.map(o => ({
          ...o,
          vehicle_slots: o.vehicle_slots.map(vs => vs.id === id
            ? { ...vs, slot_id: null, slot: null, license_plate: null, driver_phone: null, status: 'PENDING', consolidation_group_id: null, is_consolidation_primary: false, gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null }
            : vs
          ),
        }))
      )
      return { snapshots }
    },
    onError: (_e, _v, ctx: any) => ctx?.snapshots.forEach(([k, d]: any) => qc.setQueryData(k, d)),
    onSettled: () => {
      suppressTmsOrdersRealtime(2500)
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

export function useRevokeVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/tms/vehicle-slots/${id}/revoke`).then(r => r.data.data as import('@/types').TmsVehicleSlot),
    onMutate: async (id: string) => {
      suppressTmsOrdersRealtime(5000)
      await qc.cancelQueries({ queryKey: ['tms-orders'] })
      const snapshots = qc.getQueriesData<import('@/types').TmsOrder[]>({ queryKey: ['tms-orders'] })
      qc.setQueriesData<import('@/types').TmsOrder[]>(
        { queryKey: ['tms-orders'] },
        old => old?.map(o => ({
          ...o,
          vehicle_slots: o.vehicle_slots.map(vs => vs.id === id
            ? { ...vs, slot_id: null, slot: null, license_plate: null, driver_phone: null, status: 'PENDING', consolidation_group_id: null, is_consolidation_primary: false, gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null }
            : vs
          ),
        }))
      )
      return { snapshots }
    },
    onError: (_e, _v, ctx: any) => ctx?.snapshots.forEach(([k, d]: any) => qc.setQueryData(k, d)),
    onSettled: () => {
      suppressTmsOrdersRealtime(2500)
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

// ── Gate Registrations (cho Inbound NCC picker) ──────────────────────────────

export function useActiveGateRegistrations(params?: {
  date?: string; date_from?: string; date_to?: string
  warehouse_id?: string; warehouse_type?: string; direction?: string; status?: string
}) {
  return useQuery({
    queryKey: ['gate-registrations', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/gate-registrations', { params })
      return data.data as any[]
    },
    enabled: !!((params?.date || params?.date_from) && params?.warehouse_id),
  })
}

// ── Inbound Plan Lines (kế hoạch nhập ngoài NCC) ─────────────────────────────

export function useInboundPlanLines(params?: {
  date?: string; date_from?: string; date_to?: string; warehouse_id?: string; tms_order_id?: string
}) {
  return useQuery({
    queryKey: ['inbound-plan-lines', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-plan', { params })
      return data.data as any[]
    },
    enabled: !!(params?.tms_order_id || ((params?.date || params?.date_from) && params?.warehouse_id)),
  })
}

export function useCreatePlanLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      date: string; warehouse_id: string; warehouse_type?: string; vehicle_type?: string
      ncc_id?: string; material_id?: string; po_number?: string
      planned_boxes?: number; planned_pallets?: number
    }) => apiClient.post('/wms/inbound-plan', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] }),
  })
}

export function useBulkCreatePlanLines() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lines: Record<string, unknown>[]) =>
      apiClient.post('/wms/inbound-plan/bulk', { lines }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
    },
  })
}

export function useUpdatePlanLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string
      material_id?: string; po_number?: string; planned_boxes?: number; planned_pallets?: number
      date?: string; warehouse_type?: string | null; vehicle_type?: string | null; ncc_id?: string | null
    }) =>
      apiClient.patch(`/wms/inbound-plan/${id}`, body).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-report'] })
    },
  })
}

export function useDeletePlanLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/wms/inbound-plan/${id}`).then(() => id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
    },
  })
}

export function useCancelPlanLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, cancel_reason }: { id: string; cancel_reason: string }) =>
      apiClient.patch(`/wms/inbound-plan/${id}/cancel`, { cancel_reason }).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
    },
  })
}

// Fetch plan lines cho 1 TmsOrder (dùng trong booking detail)
export function usePlanLinesByOrder(orderId: string | null) {
  return useQuery({
    queryKey: ['inbound-plan-lines-by-order', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-plan', { params: { tms_order_id: orderId } })
      return data.data as any[]
    },
  })
}

// Fetch bảng so sánh kế hoạch vs thực tế cho 1 TmsOrder
export function usePlanVsActual(orderId: string | null) {
  return useQuery({
    queryKey: ['plan-vs-actual', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data } = await apiClient.get(`/tms/orders/${orderId}/plan-vs-actual`)
      return data.data as any[]
    },
  })
}

// Upload plan lines trực tiếp vào 1 TmsOrder đã có
export function useBulkCreatePlanLinesForOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tms_order_id, lines }: { tms_order_id: string; lines: Record<string, unknown>[] }) =>
      apiClient.post('/wms/inbound-plan/bulk-for-order', { tms_order_id, lines }).then(r => r.data.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines-by-order', vars.tms_order_id] })
      qc.invalidateQueries({ queryKey: ['plan-vs-actual', vars.tms_order_id] })
      qc.invalidateQueries({ queryKey: ['inbound-plan-lines'] })
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
    },
  })
}

export function useDeleteVehicleSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/vehicle-slots/${id}`).then(() => id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['tms-orders'] })
      const snapshots = qc.getQueriesData<import('@/types').TmsOrder[]>({ queryKey: ['tms-orders'] })
      qc.setQueriesData<import('@/types').TmsOrder[]>(
        { queryKey: ['tms-orders'] },
        old => old?.map(o => ({ ...o, vehicle_slots: o.vehicle_slots.filter(vs => vs.id !== id) }))
      )
      return { snapshots }
    },
    onError: (_e, _v, ctx: any) => ctx?.snapshots.forEach(([k, d]: any) => qc.setQueryData(k, d)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tms-orders'] })
      qc.invalidateQueries({ queryKey: ['tms-delivery-slots'] })
    },
  })
}

// Báo cáo nhập hàng: KH vs thực tế theo date range
export type InboundReportRow = {
  date: string; warehouse_name: string; po_number: string
  ncc_code: string; ncc_name: string
  material_code: string; material_name: string; unit: string; material_category: string
  planned_boxes: number; actual_boxes: number; pct: number | null
  plan_line_id?: string
  note?: string | null
}

export function useInboundReport(params?: { date_from: string; date_to: string; warehouse_id?: string }) {
  return useQuery({
    queryKey: ['inbound-report', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/reports/inbound', { params })
      return data.data as InboundReportRow[]
    },
    enabled: !!(params?.date_from && params?.date_to),
  })
}

// ═══ HR — Lịch làm việc & Chấm công ═══════════════════════════════════════════

export type SkillRow = {
  id: string; job_title_id: string | null; job_title: string | null
  name: string; shift_tag: string | null; sort_order: number; is_active: boolean
}

// Danh mục skill — theo chức danh (job_title_id), phòng (department_id), hoặc tất cả (all)
export function useSkills(params: { job_title_id?: string; job_title_ids?: string; department_id?: string; all?: boolean; include_inactive?: boolean; with_descendants?: boolean }, enabled = true) {
  const { all, ...rest } = params
  return useQuery({
    queryKey: ['hr-skills', params],
    enabled: enabled && !!(params.job_title_id || params.job_title_ids || params.department_id || all),
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/skills', { params: rest })
      return data.data as SkillRow[]
    },
  })
}

export function useCreateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { job_title_id: string; name: string; shift_tag?: string | null; sort_order?: number }) =>
      apiClient.post('/hr/skills', body).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['hr-skills'] }); qc.invalidateQueries({ queryKey: ['hr-emp-skills'] }) },
  })
}
export function useUpdateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; shift_tag?: string | null; sort_order?: number; is_active?: boolean }) =>
      apiClient.put(`/hr/skills/${id}`, body).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['hr-skills'] }); qc.invalidateQueries({ queryKey: ['hr-emp-skills'] }) },
  })
}
export function useDeleteSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/skills/${id}`).then(r => r.data.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['hr-skills'] }); qc.invalidateQueries({ queryKey: ['hr-emp-skills'] }) },
  })
}

// Skill của 1 nhân viên (theo chức danh) + ưu tiên hiện có
export type EmpSkillsResp = {
  job_title_id: string | null
  skills: { id: string; name: string; shift_tag: string | null; sort_order: number; priority: number; job_title_id: string | null; job_title: string | null }[]
}
export function useEmployeeSkills(employeeId?: string, enabled = true) {
  return useQuery({
    queryKey: ['hr-emp-skills', employeeId],
    enabled: enabled && !!employeeId,
    queryFn: async () => {
      const { data } = await apiClient.get(`/hr/employees/${employeeId}/skills`)
      return data.data as EmpSkillsResp
    },
  })
}
export function useSetEmployeeSkills() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ employee_id, skills }: { employee_id: string; skills: { skill_id: string; priority: number }[] }) =>
      apiClient.put(`/hr/employees/${employee_id}/skills`, { skills }).then(r => r.data.data),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ['hr-emp-skills', v.employee_id] }),
  })
}

// ── Nghỉ phép ──
export type LeaveRow = {
  id: string; employee_id: string; warehouse_id: string | null
  date_from: string; date_to: string; leave_type: string; reason: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; approved_by: string | null; approved_at: string | null
  created_at: string
  employee: { id: string; name: string; employee_code: string; department_id: string | null; job_title: string | null } | null
}
export function useLeaves(params: { warehouse_id?: string; department_id?: string; employee_id?: string; status?: string; date_from?: string; date_to?: string; to_approve?: boolean; direct?: boolean }, enabled = true) {
  return useQuery({
    queryKey: ['hr-leaves', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/leaves', { params })
      return data.data as LeaveRow[]
    },
  })
}
export function useCreateLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { employee_id?: string; warehouse_id?: string; date_from: string; date_to: string; leave_type?: string; reason?: string }) =>
      apiClient.post('/hr/leaves', body).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
  })
}
export type DecideLeaveResult = LeaveRow & { conflicts: { work_date: string; prev_kind: string }[] }
export function useDecideLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      apiClient.patch(`/hr/leaves/${id}/decide`, { status }).then(r => r.data.data as DecideLeaveResult),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['hr-leaves'] })
      qc.invalidateQueries({ queryKey: ['hr-attendance'] })
      qc.invalidateQueries({ queryKey: ['hr-att-report'] })
    },
  })
}
export function useDeleteLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/leaves/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
  })
}

// ── Layout (mẫu gom skill theo Kho) ──
export type LayoutRow = { id: string; warehouse_id: string; name: string; note: string | null; is_active: boolean; positions: number; people: number }
export type LayoutSkillRow = { id: string; skill_id: string; required_count: number; sort_order: number; name: string; shift_tag: string | null; job_title: string | null; note: string | null }
export type LayoutDetail = { id: string; warehouse_id: string; name: string; note: string | null; is_active: boolean; skills: LayoutSkillRow[]; job_title_ids: string[] }

export function useLayouts(warehouse_id?: string, enabled = true) {
  return useQuery({
    queryKey: ['hr-layouts', warehouse_id],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/layouts', { params: { warehouse_id } })
      return data.data as LayoutRow[]
    },
  })
}
export function useLayout(id?: string) {
  return useQuery({
    queryKey: ['hr-layout', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/hr/layouts/${id}`)
      return data.data as LayoutDetail
    },
  })
}
export function useCreateLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; name: string; note?: string }) => apiClient.post('/hr/layouts', body).then(r => r.data.data as LayoutRow),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-layouts'] }),
  })
}
export function useUpdateLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; note?: string; is_active?: boolean }) => apiClient.put(`/hr/layouts/${id}`, body).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-layouts'] }); qc.invalidateQueries({ queryKey: ['hr-layout', v.id] }) },
  })
}
export function useDeleteLayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/layouts/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-layouts'] }),
  })
}
export function useSetLayoutSkills() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ layout_id, skills }: { layout_id: string; skills: { skill_id: string; required_count: number; sort_order?: number; note?: string }[] }) =>
      apiClient.put(`/hr/layouts/${layout_id}/skills`, { skills }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-layout', v.layout_id] }); qc.invalidateQueries({ queryKey: ['hr-layouts'] }) },
  })
}
export function useSetLayoutJobTitles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ layout_id, job_title_ids }: { layout_id: string; job_title_ids: string[] }) =>
      apiClient.put(`/hr/layouts/${layout_id}/job-titles`, { job_title_ids }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-layout', v.layout_id] }); qc.invalidateQueries({ queryKey: ['hr-layouts'] }) },
  })
}

// ── Phân công lịch làm việc (theo layout) ──
export type SheetRow = {
  id: string; work_date: string; warehouse_id: string; layout_id: string | null; layout_name: string | null
  warehouse_name: string | null
  status: 'DRAFT' | 'PUBLISHED'; note: string | null; published_at: string | null
  created_at: string | null; updated_at: string | null; created_by: string | null; updated_by: string | null
  total_required: number; total_assigned: number; total_on_leave: number
}
export type SheetDetail = {
  id: string; work_date: string; warehouse_id: string; layout_id: string | null; layout_name: string | null
  status: 'DRAFT' | 'PUBLISHED'; note: string | null; published_at: string | null
  created_at: string | null; updated_at: string | null; created_by: string | null; updated_by: string | null
  skills: { id: string; name: string; shift_tag: string | null; sort_order: number; job_title: string | null }[]
  demands: { id: string; skill_id: string; required_count: number; note: string | null }[]
  assignments: {
    id: string; employee_id: string; skill_id: string | null
    status: 'ASSIGNED' | 'LEAVE' | 'UNASSIGNED'; is_manual: boolean; note: string | null
    employee: { id: string; name: string; employee_code: string; job_title: string | null } | null
  }[]
}
export function useSheets(params: { warehouse_id?: string; layout_id?: string; date_from?: string; date_to?: string; status?: string }, enabled = true) {
  return useQuery({
    queryKey: ['hr-sheets', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/sheets', { params })
      return data.data as SheetRow[]
    },
  })
}
export function useSheet(id?: string) {
  return useQuery({
    queryKey: ['hr-sheet', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await apiClient.get(`/hr/sheets/${id}`)
      return data.data as SheetDetail
    },
  })
}
export function useUpsertSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { layout_id: string; work_date: string; note?: string; create_only?: boolean; demands?: { skill_id: string; required_count: number; note?: string }[] }) =>
      apiClient.post('/hr/sheets', body).then(r => r.data.data as { id: string }),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['hr-sheets'] }); qc.invalidateQueries({ queryKey: ['hr-sheet'] }) },
  })
}
export function useAutoAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sheetId, demands }: { sheetId: string; demands?: { skill_id: string; required_count: number; note?: string }[] }) =>
      apiClient.post(`/hr/sheets/${sheetId}/auto-assign`, { demands }).then(r => r.data.data as { assigned: number; on_leave: number; shortfalls: { skill_id: string; required: number; short: number }[] }),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-sheet', v.sheetId] }); qc.invalidateQueries({ queryKey: ['hr-sheets'] }) },
  })
}
export function useAssignOne() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sheet_id, employee_id, skill_id }: { sheet_id: string; employee_id: string; skill_id: string | null }) =>
      apiClient.post(`/hr/sheets/${sheet_id}/assign-one`, { employee_id, skill_id }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-sheet', v.sheet_id] }); qc.invalidateQueries({ queryKey: ['hr-sheets'] }) },
  })
}
// đặt danh sách vị trí cho 1 NV (1 người làm nhiều vị trí)
export function useSetPositions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sheet_id, employee_id, skill_ids }: { sheet_id: string; employee_id: string; skill_ids: string[] }) =>
      apiClient.post(`/hr/sheets/${sheet_id}/assign-positions`, { employee_id, skill_ids }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-sheet', v.sheet_id] }); qc.invalidateQueries({ queryKey: ['hr-sheets'] }) },
  })
}
export function usePublishSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) =>
      apiClient.post(`/hr/sheets/${id}/publish`, { publish }).then(r => r.data.data),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: ['hr-sheet', v.id] }); qc.invalidateQueries({ queryKey: ['hr-sheets'] }) },
  })
}
// ── Quy tắc nghỉ giữa ca ──
export type ShiftRuleRow = { id: string; from_shift: string; to_shift: string }
export function useShiftRules(enabled = true) {
  return useQuery({
    queryKey: ['hr-shift-rules'], enabled,
    queryFn: async () => { const { data } = await apiClient.get('/hr/shift-rules'); return data.data as ShiftRuleRow[] },
  })
}
export function useCreateShiftRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { from_shift: string; to_shift: string }) => apiClient.post('/hr/shift-rules', b).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-shift-rules'] }),
  })
}
export function useDeleteShiftRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/shift-rules/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-shift-rules'] }),
  })
}

export function useDeleteSheet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/sheets/${id}`).then(r => r.data.data),
    // xóa lạc quan: bỏ phiếu khỏi mọi cache danh sách ngay, không chờ refetch
    onMutate: (id) => { qc.setQueriesData<SheetRow[]>({ queryKey: ['hr-sheets'] }, old => Array.isArray(old) ? old.filter(s => s.id !== id) : old) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-sheets'] }),
  })
}

// ── Chấm công ──
export type AttendanceRow = {
  id: string; employee_id: string; warehouse_id: string | null; work_date: string
  kind: 'CA1' | 'CA2' | 'CA3' | 'HC' | 'LEAVE'; ot_hours: number; early_leave_hours: number; note: string | null
  employee: { id: string; name: string; employee_code: string; department_id: string | null; job_title: string | null } | null
}
export function useAttendance(params: { warehouse_id?: string; department_id?: string; employee_id?: string; date_from?: string; date_to?: string }, enabled = true) {
  return useQuery({
    queryKey: ['hr-attendance', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/attendance', { params })
      return data.data as AttendanceRow[]
    },
  })
}
export function useUpsertAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { employee_id?: string; warehouse_id?: string; work_date: string; kind: string; ot_hours?: number; early_leave_hours?: number; note?: string }) =>
      apiClient.post('/hr/attendance', body).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-attendance'] }),
  })
}
export function useDeleteAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hr/attendance/${id}`).then(r => r.data.data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['hr-attendance'] }),
  })
}
export type AttReportRow = {
  employee_id: string; ca1: number; ca2: number; ca3: number; hc: number; leave: number
  ot_hours: number; early_hours: number; work_days: number; total_hours: number
  employee: { id: string; name: string; employee_code: string; department_id: string | null; job_title: string | null } | null
}
export function useAttendanceReport(params: { warehouse_id?: string; department_id?: string; date_from: string; date_to: string }, enabled = true) {
  return useQuery({
    queryKey: ['hr-att-report', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get('/hr/attendance/report', { params })
      return data.data as AttReportRow[]
    },
  })
}
