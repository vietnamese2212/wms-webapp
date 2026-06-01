import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  mockInventory, mockTransactions, mockVehicles,
  mockDeliveries, mockEmployees, mockSchedules,
  mockLocations, mockOvertimeRequests,
} from '@/utils/mockData'
import { apiClient } from './client'
import { suppressTmsOrdersRealtime } from './realtimeEvents'
import type { InboundOrder, Department, JobTitle, EmployeeRecord, GDO, InventoryEntry, TmsVehicleType, SlotTemplate, TransportCompany, TmsVehicle } from '@/types'

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

export function useLocationsReal(params?: { warehouse_id?: string; sub_code?: string; category?: string }) {
  return useQuery({
    queryKey: ['locations-real', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/locations', { params })
      return data.data as any[]
    },
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

// Mutations
export function useCreateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { code: string; name: string; address?: string }) =>
      apiClient.post('/masterdata/warehouses', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  })
}

export function useUpdateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; address?: string; is_active?: boolean }) =>
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
      custom_short_name?: string; product_type?: string
      unit?: string; manufacturer_id?: string; notes?: string
    }) => apiClient.post('/masterdata/materials', body).then((r) => r.data.data),
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
  const key = lsKey('wms:io', params)
  return useQuery({
    queryKey: ['inbound-orders', params],
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // Shows last-known data instantly on refresh / cold start; always refetches in background
    initialData: () => lsGet<InboundOrder[]>(key),
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inbound-orders', { params })
      lsSet(key, data.data)
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
    }) => apiClient.post('/wms/inbound-orders', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbound-orders'] }),
  })
}

export function useUpdateInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; location_id?: string; planned_pallets?: number; notes?: string }) =>
      apiClient.patch(`/wms/inbound-orders/${id}`, body).then((r) => r.data.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['inbound-orders'] })
      qc.invalidateQueries({ queryKey: ['inbound-order', v.id] })
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
    },
  })
}

export function useCancelInboundOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/wms/inbound-orders/${id}/cancel`).then((r) => r.data.data),
    onSuccess: (_d, id) => {
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

export function useDeletePalletEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, entryId, employeeId }: { orderId: string; entryId: string; employeeId?: string }) =>
      apiClient.delete(`/wms/inbound-orders/${orderId}/entries/${entryId}`, {
        data: { employee_id: employeeId },
      }).then((r) => r.data.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['inbound-order', v.orderId] }),
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
    mutationFn: (body: { warehouse_id: string; code: string; name: string; category?: string }) =>
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
  date_pct_ranges?: string[]
}) {
  return useQuery({
    queryKey: ['inventory-entries', params],
    staleTime: 30_000,
    queryFn: async () => {
      const { warehouse_ids, categories, filter_locations, filter_material_ids, qa_status_ids, filter_cycles, filter_machines, date_pct_ranges, ...rest } = params ?? {}
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
          ...(date_pct_ranges?.length     ? { date_pct_ranges:    date_pct_ranges.join(',')     } : {}),
        },
      })
      return data.data as { entries: InventoryEntry[]; total: number; page: number; limit: number; total_cartons_remaining: number }
    },
  })
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

export function useAdjustInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, adjustment, employee_id }: { id: string; adjustment: number; employee_id?: string }) => {
      const { data } = await apiClient.patch(`/wms/inventory/${id}/adjust`, { adjustment, employee_id })
      return data.data as { entry: InventoryEntry }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory-entries'] }) },
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

export interface StocktakeSummaryItem {
  location_id:        string
  location_code:      string
  sub_code:           string
  requires_stocktake: boolean
  warehouse_name:     string
  total:              number
  checked:            number
  unchecked:          number
  flagged:            number
}

export function useStocktakeSummary(params: { warehouse_id?: string; category?: string; requires_stocktake_only?: boolean }) {
  return useQuery({
    queryKey: ['stocktake-summary', params],
    queryFn: async () => {
      const q: Record<string, string> = {}
      if (params.warehouse_id)          q.warehouse_id           = params.warehouse_id
      if (params.category)              q.category               = params.category
      if (params.requires_stocktake_only) q.requires_stocktake_only = 'true'
      const { data } = await apiClient.get('/wms/inventory/stocktake-summary', { params: q })
      return data.data as StocktakeSummaryItem[]
    },
    enabled: true,
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
      qc.invalidateQueries({ queryKey: ['stocktake-summary'] })
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
      qc.invalidateQueries({ queryKey: ['stocktake-summary'] })
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
  params: { warehouse_id?: string; category?: string; location_id?: string; view?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: ['stocktake-entries', params],
    queryFn: async () => {
      const q: Record<string, string> = {}
      if (params.warehouse_id) q.warehouse_id = params.warehouse_id
      if (params.category)     q.category     = params.category
      if (params.location_id)  q.location_id  = params.location_id
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

export function useDeliveries() {
  return useQuery({
    queryKey: ['deliveries'],
    queryFn: async () => { await delay(); return mockDeliveries },
  })
}

// HR (mock)
export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => { await delay(); return mockEmployees },
  })
}

export function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: async () => { await delay(); return mockSchedules },
  })
}

export function useOvertimeRequests() {
  return useQuery({
    queryKey: ['overtime'],
    queryFn: async () => { await delay(); return mockOvertimeRequests },
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
      name: string; department_id: string
      allowed_categories?: string[]; warehouse_scope?: string
      module_permissions?: Record<string, string[]>
    }) => apiClient.post('/masterdata/job-titles', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
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
  dvvt: string
  customer_name: string
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

export function useLoosePickingItems(params: { warehouse_id?: string; date?: string }) {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gdos'] }),
  })
}

export function useGDOs(params?: { warehouse_id?: string; status?: string; date?: string; search?: string }) {
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
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] }),
  })
}

export function useManualCompleteItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, cartons }: { gdoId: string; itemId: string; cartons?: number }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/manual-complete`, cartons != null ? { cartons } : {}).then(r => r.data.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] }),
  })
}

export function useDeleteOutboundScanEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gdoId, itemId, scanId }: { gdoId: string; itemId: string; scanId: string }) =>
      apiClient.delete(`/wms/outbound/${gdoId}/items/${itemId}/scans/${scanId}`).then(r => r.data.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] }),
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
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['gdo', v.gdoId] }),
  })
}

export function useCheckOutboundScan() {
  return useMutation({
    mutationFn: ({ gdoId, itemId, qr_code }: { gdoId: string; itemId: string; qr_code: string }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/check-scan`, { qr_code }).then(r => r.data.data as CheckOutboundScanResult),
  })
}

export function useCheckInboundScan() {
  return useMutation({
    mutationFn: ({ orderId, qr_code, location_id, stack_layer }: {
      orderId: string; qr_code: string; location_id: string; stack_layer: number
    }) =>
      apiClient.post(`/wms/inbound-orders/${orderId}/check-scan`, { qr_code, location_id, stack_layer })
        .then(r => r.data.data as { pallet_code: string; production_date: string | null; suggested_cartons: number }),
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
    }) => apiClient.patch(`/wms/outbound/${id}/transport`, body).then(r => r.data.data as GDO),
    onSuccess: (data, { id }) => {
      qc.setQueryData(['gdo', id], data)
      qc.invalidateQueries({ queryKey: ['gdos'] })
    },
  })
}

function makeUndoGDOMutation(path: string, optimisticFn?: (old: any) => any) {
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
      },
    })
  }
}
export const useUnassignGDO   = makeUndoGDOMutation('unassign',
  old => ({ ...old, assigned_at: null, assigned_by: null, status: 'PENDING' }))
export const useUnstartGDO    = makeUndoGDOMutation('unstart',
  old => ({ ...old, started_at: null, license_plate: null, container_number: null, exporter_name: null, loader_name: null, forklift_driver_id: null, forklift_driver_names: null, status: 'PENDING' }))
export const useUncompleteGDO = makeUndoGDOMutation('uncomplete',
  old => ({ ...old, status: 'IN_PROGRESS', completed_at: null }))

export function useWarehouseEmployees(warehouse_id?: string | null) {
  return useQuery({
    queryKey: ['warehouse-employees', warehouse_id],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/outbound/employees', {
        params: warehouse_id ? { warehouse_id } : undefined,
      })
      return data.data as { id: string; name: string; employee_code: string }[]
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

// ─── TMS ─────────────────────────────────────────────────────────────────────

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

export function useUpdateVehicleType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; is_active?: boolean }) =>
      apiClient.put(`/tms/vehicle-types/${id}`, body).then(r => r.data.data as TmsVehicleType),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-slot-templates'] }),
  })
}

export function useDeleteSlotTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tms/slot-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-slot-templates'] }),
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
    mutationFn: (body: { code: string; name: string; contact_name?: string; contact_phone?: string }) =>
      apiClient.post('/tms/transport-companies', body).then(r => r.data.data as TransportCompany),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-transport-companies'] }),
  })
}

export function useUpdateTransportCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; code?: string; name?: string; contact_name?: string; contact_phone?: string; is_active?: boolean }) =>
      apiClient.put(`/tms/transport-companies/${id}`, body).then(r => r.data.data as TransportCompany),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-transport-companies'] }),
  })
}

export function useTmsVehicles(params?: { ncc_id?: string; is_active?: string; unassigned?: string }) {
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

export function useTmsOrders(params?: { date?: string; warehouse_id?: string }) {
  return useQuery({
    queryKey: ['tms-orders', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/orders', { params })
      return data.data as import('@/types').TmsOrder[]
    },
    enabled: !!params?.date,
  })
}

type OrderWriteBody = {
  order_code?: string; date?: string; warehouse_id?: string
  ncc_id?: string | null; npp_name?: string | null
  vehicle_type?: string | null; direction?: string | null; warehouse_type?: string | null
  planned_boxes?: number | null; planned_pallets?: number | null; planned_tons?: number | null
  gdo_refs?: string | null; notes?: string | null; status?: string
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tms-orders'] }),
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
  date?: string; warehouse_id?: string; direction?: string; status?: string
}) {
  return useQuery({
    queryKey: ['gate-registrations', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/gate-registrations', { params })
      return data.data as any[]
    },
    enabled: !!(params?.date && params?.warehouse_id),
  })
}

// ── Inbound Materials từ kế hoạch nhập ngoài (SAP plan) ─────────────────────

export function useInboundMaterials(params?: {
  date?: string; warehouse_id?: string; gate_registration_id?: string
}) {
  return useQuery({
    queryKey: ['inbound-materials', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/tms/orders/inbound-materials', { params })
      return data.data as any[]
    },
    enabled: !!(params?.date && params?.warehouse_id),
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
