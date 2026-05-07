import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  mockInventory, mockTransactions, mockVehicles,
  mockDeliveries, mockEmployees, mockSchedules,
  mockLocations, mockOvertimeRequests,
} from '@/utils/mockData'
import { apiClient } from './client'

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

export function useSubWarehouses(warehouseId?: string) {
  return useQuery({
    queryKey: ['sub-warehouses', warehouseId],
    queryFn: async () => {
      const { data } = await apiClient.get('/masterdata/sub-warehouses', {
        params: warehouseId ? { warehouse_id: warehouseId } : {},
      })
      return data.data as any[]
    },
  })
}

export function useLocationsReal(params?: { sub_warehouse_id?: string; warehouse_id?: string }) {
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

export function useCreateSubWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { warehouse_id: string; code: string; name: string; type?: string }) =>
      apiClient.post('/masterdata/sub-warehouses', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sub-warehouses'] }),
  })
}

export function useCreateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { sub_warehouse_id: string; row: string; shelf: string; max_pallets?: number }) =>
      apiClient.post('/masterdata/locations', body).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations-real'] }),
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
