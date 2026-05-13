import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  mockInventory, mockTransactions, mockVehicles,
  mockDeliveries, mockEmployees, mockSchedules,
  mockLocations, mockOvertimeRequests,
} from '@/utils/mockData'
import { apiClient } from './client'
import type { InboundOrder, Department, JobTitle, EmployeeRecord, GDO, InventoryEntry } from '@/types'

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

// Sub-groups = kho nhỏ (TP1, TP2...) lấy từ Location (không còn bảng SubWarehouse)
export function useSubGroups(warehouseId?: string) {
  return useQuery({
    queryKey: ['sub-groups', warehouseId],
    enabled: !!warehouseId,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/locations/sub-groups', {
        params: { warehouse_id: warehouseId },
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

export function useMaterials(params?: { search?: string; manufacturer_id?: string; category?: string }) {
  return useQuery({
    queryKey: ['materials', params],
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

export function useCreateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; sub_code: string; sub_name?: string; sub_type?: string; row: string; shelf: string; max_pallets?: number }) =>
      apiClient.post('/masterdata/locations', body).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations-real'] })
      qc.invalidateQueries({ queryKey: ['sub-groups'] })
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
    }) => apiClient.patch(`/wms/inbound-orders/${orderId}/entries/${entryId}`, body).then((r) => r.data.data),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['inbound-order', v.orderId] }),
  })
}

export function useLocationSubTypes() {
  return useQuery({
    queryKey: ['location-sub-types'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/locations/sub-types')
      return data.data as { sub_type: string; label: string }[]
    },
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
    staleTime: 0,
    refetchOnWindowFocus: true,
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

export function useEmployeeRecords(params?: { department_id?: string; search?: string; is_active?: string }) {
  return useQuery({
    queryKey: ['employee-records', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/employees', { params })
      return data.data as EmployeeRecord[]
    },
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
      department_id?: string; job_title_id?: string
      action_level?: string; allowed_categories?: string[]; warehouse_scope?: string
      warehouse_ids?: string[]
    }) => apiClient.post('/masterdata/employees', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-records'] }),
  })
}

export function useUpdateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; name?: string; phone?: string; email?: string
      department_id?: string; job_title_id?: string
      action_level?: string; allowed_categories?: string[]; warehouse_scope?: string
      is_active?: boolean
    }) => apiClient.patch(`/masterdata/employees/${id}`, body).then(r => r.data.data),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['employee-records'] })
      qc.invalidateQueries({ queryKey: ['employee-record', v.id] })
    },
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

export function useCreateJobTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string; department_id: string; action_level: string
      allowed_categories?: string[]; warehouse_scope?: string
    }) => apiClient.post('/masterdata/job-titles', body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
  })
}

export function useUpdateJobTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; name?: string; action_level?: string
      allowed_categories?: string[]; warehouse_scope?: string; is_active?: boolean
    }) => apiClient.put(`/masterdata/job-titles/${id}`, body).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-titles'] }),
  })
}

// ─── Outbound (API thật) ─────────────────────────────────────────────────────

type GDOFormPayload = {
  delivery_date: string
  warehouse_id?: string
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
    mutationFn: ({ gdoId, itemId }: { gdoId: string; itemId: string }) =>
      apiClient.post(`/wms/outbound/${gdoId}/items/${itemId}/manual-complete`).then(r => r.data.data),
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
