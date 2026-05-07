import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  mockInventory, mockTransactions, mockVehicles,
  mockDeliveries, mockEmployees, mockSchedules,
  mockLocations, mockOvertimeRequests,
} from '@/utils/mockData'

const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms))

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
