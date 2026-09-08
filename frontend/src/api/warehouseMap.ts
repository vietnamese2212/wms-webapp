// Hook API cho SƠ ĐỒ KHO (08/09/2026). Tách file riêng khỏi hooks.ts (đã 4.500+ dòng) — cùng apiClient,
// cùng quy ước queryKey (realtimeEvents map: Location/warehouse_maps → ['warehouse-map'], InventoryEntry → ['warehouse-map-occupancy']).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from './client'
import type { GridKind } from '@/utils/warehouseGrid'

export type MapKind = GridKind
export interface MapLoc {
  id: string; location_code: string
  sub_code: string | null; sub_name: string | null; row: string | null; shelf: string | null
  kind: MapKind; is_rack: boolean; level_no: number | null
  grid_x: number | null; grid_y: number | null; grid_w: number; grid_h: number
  max_pallets: number; categories: string[] | null
  is_pick_face: boolean | null; slot_no_in: boolean | null; slot_no_out: boolean | null; is_active: boolean
}
export interface MapFrame {
  width: number; height: number; cell_m: number
  blocked: [number, number][]
  notes?: string | null; updated_at?: string | null; updated_by?: string | null
}
export interface WarehouseMapData {
  warehouse: { id: string; code: string; name: string }
  map: MapFrame | null
  locations: MapLoc[]
}
export interface MapOccupancy { location_id: string; pallets: number; materials: number; qty_base: number; quarantine: number }
export interface MapFindHit { location_id: string; pallet_code: string; material_code: string | null }

const keyMap = (whId: string) => ['warehouse-map', whId] as const

export function useWarehouseMap(whId: string) {
  return useQuery({
    queryKey: keyMap(whId),
    enabled: !!whId,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/warehouse-map/${encodeURIComponent(whId)}`)
      return data.data as WarehouseMapData
    },
    staleTime: 60_000,
  })
}

export function useWarehouseMapOccupancy(whId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['warehouse-map-occupancy', whId],
    enabled: !!whId && enabled,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/warehouse-map/${encodeURIComponent(whId)}/occupancy`)
      return data.data as MapOccupancy[]
    },
    staleTime: 30_000,
  })
}

export function useWarehouseMapFind(whId: string, q: string) {
  const term = q.trim()
  return useQuery({
    queryKey: ['warehouse-map-find', whId, term],
    enabled: !!whId && term.length >= 2,
    queryFn: async () => {
      const { data } = await apiClient.get(`/wms/warehouse-map/${encodeURIComponent(whId)}/find`, { params: { q: term } })
      return (data.data as { hits: MapFindHit[] }).hits
    },
    staleTime: 15_000,
  })
}

function useInvalidateMap(whId: string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: keyMap(whId) })
    qc.invalidateQueries({ queryKey: ['locations-real'] })
  }
}

export function useSaveMapFrame(whId: string) {
  const inv = useInvalidateMap(whId)
  return useMutation({
    mutationFn: async (body: { width: number; height: number; cell_m: number; blocked: [number, number][]; notes?: string | null }) => {
      const { data } = await apiClient.put(`/wms/warehouse-map/${encodeURIComponent(whId)}`, body)
      return data.data as MapFrame
    },
    onSettled: inv,
  })
}

export type CellAssign = { location_id: string; grid_x: number | null; grid_y: number | null; grid_w?: number; grid_h?: number }
export function useAssignCells(whId: string) {
  const inv = useInvalidateMap(whId)
  return useMutation({
    mutationFn: async (items: CellAssign[]) => {
      const { data } = await apiClient.patch(`/wms/warehouse-map/${encodeURIComponent(whId)}/cells`, { items })
      return data.data as { updated: number }
    },
    onSettled: inv,
  })
}

export function useSetFootprintRack(whId: string) {
  const inv = useInvalidateMap(whId)
  return useMutation({
    mutationFn: async (body: { location_ids: string[]; is_rack: boolean }) => {
      const { data } = await apiClient.patch(`/wms/warehouse-map/${encodeURIComponent(whId)}/footprint`, body)
      return data.data as { updated: number }
    },
    onSettled: inv,
  })
}

export function useCreateMapObject(whId: string) {
  const inv = useInvalidateMap(whId)
  return useMutation({
    mutationFn: async (body: { kind: Exclude<MapKind, 'STORAGE'>; name: string; grid_x: number; grid_y: number; grid_w?: number; grid_h?: number }) => {
      const { data } = await apiClient.post(`/wms/warehouse-map/${encodeURIComponent(whId)}/objects`, body)
      return data.data as MapLoc
    },
    onSettled: inv,
  })
}

export function useRenameMapObject(whId: string) {
  const inv = useInvalidateMap(whId)
  return useMutation({
    mutationFn: async (body: { id: string; name: string }) => {
      const { data } = await apiClient.patch(`/wms/warehouse-map/${encodeURIComponent(whId)}/objects/${encodeURIComponent(body.id)}`, { name: body.name })
      return data.data as { id: string; name: string }
    },
    onSettled: inv,
  })
}

export function useDeleteMapObject(whId: string) {
  const inv = useInvalidateMap(whId)
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete(`/wms/warehouse-map/${encodeURIComponent(whId)}/objects/${encodeURIComponent(id)}`)
      return data.data as { id: string }
    },
    onSettled: inv,
  })
}
