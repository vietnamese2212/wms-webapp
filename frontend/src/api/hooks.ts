import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  mockInventory, mockTransactions, mockVehicles,
  mockDeliveries, mockEmployees, mockSchedules,
  mockLocations, mockOvertimeRequests,
} from '@/utils/mockData'
import { apiClient } from './client'
import type { InboundOrder } from '@/types'

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

export function useLocationsReal(params?: { warehouse_id?: string; sub_code?: string }) {
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

export function useMaterials(params?: { search?: string; manufacturer_id?: string }) {
  return useQuery({
    queryKey: ['materials', params],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/materials', { params })
      return data.data as any[]
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

export function useInboundOrders(params?: { warehouse_id?: string; status?: string; search?: string }) {
  return useQuery({
    queryKey: ['inbound-orders', params],
    staleTime: 0,
    refetchInterval: 8_000,
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
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    // Show data from list cache immediately while detail loads
    placeholderData: () => {
      const caches = qc.getQueriesData<InboundOrder[]>({ queryKey: ['inbound-orders'] })
      for (const [, list] of caches) {
        const found = list?.find((o) => o.id === id)
        if (found) return found
      }
    },
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/inbound-orders/${id}`)
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
      planned_pallets?: number
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
        cycle:        parts[2] ?? null,
        machine_code: parts[3] ?? null,
        stack_layer:  1,
        cartons_imported: previous?.material?.cartons_per_pallet ?? 0,
        production_date: null,
        status:       'IN_STOCK',
        created_by_emp: null,
        updated_by_emp: null,
        created_at:   new Date().toISOString(),
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
    mutationFn: ({ orderId, entryId }: { orderId: string; entryId: string }) =>
      apiClient.delete(`/wms/inbound-orders/${orderId}/entries/${entryId}`).then((r) => r.data.data),
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

// WMS
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

// HR
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
