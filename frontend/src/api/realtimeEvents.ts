import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/supabase'
import { queryClient } from './queryClient'
import type { DeliveryBooking, DeliverySlot } from '@/types'

// Maps table name → query keys to invalidate (fallback refetch).
const TABLE_QUERY_MAP: Record<string, string[][]> = {
  ProductionImport: [['inbound-orders'], ['inbound-order']],
  InventoryEntry:   [['inbound-order'], ['inventory-entries'], ['inventory-facets'], ['locations-real']],
  Location:         [['locations-real'], ['sub-groups']],
  Material:         [['materials']],
  Manufacturer:     [['manufacturers']],
  Warehouse:        [['warehouses']],
  DeliveryBooking:  [['tms-bookings']],
  DeliverySlot:     [['tms-delivery-slots']],
}

type Payload = RealtimePostgresChangesPayload<Record<string, unknown>>

// Patch DeliverySlot cache trực tiếp — cập nhật booked_count trong slot list VÀ trong
// slot object embedded trong booking list (DeliveryBooking.slot.booked_count).
function patchSlotCache(payload: Payload) {
  if (payload.eventType !== 'UPDATE') return
  const updated = payload.new
  if (!updated?.id) return

  // 1. Patch tms-delivery-slots cache
  queryClient.setQueriesData<DeliverySlot[]>(
    { queryKey: ['tms-delivery-slots'] },
    (old) => {
      if (!Array.isArray(old)) return old
      return old.map(s =>
        s.id === updated.id
          ? { ...s, booked_count: updated.booked_count as number }
          : s
      )
    }
  )

  // 2. Patch slot embedded trong tms-bookings
  queryClient.setQueriesData<DeliveryBooking[]>(
    { queryKey: ['tms-bookings'] },
    (old) => {
      if (!Array.isArray(old)) return old
      return old.map(b =>
        b.slot_id === updated.id && b.slot
          ? { ...b, slot: { ...b.slot, booked_count: updated.booked_count as number } }
          : b
      )
    }
  )
}

// Patch DeliveryBooking cache trực tiếp — cập nhật status/license_plate/slot_id/v.v.
// không cần round-trip backend (~300-5000ms tùy cold start Vercel).
function patchBookingsCache(payload: Payload) {
  if (payload.eventType === 'INSERT') return  // INSERT cần join relations → để invalidate xử lý

  queryClient.setQueriesData<DeliveryBooking[]>(
    { queryKey: ['tms-bookings'] },
    (old) => {
      if (!Array.isArray(old)) return old

      if (payload.eventType === 'DELETE') {
        const deletedId = payload.old?.id as string | undefined
        return deletedId ? old.filter(b => b.id !== deletedId) : old
      }

      // UPDATE
      const u = payload.new
      if (!u?.id) return old
      return old.map(b => {
        if (b.id !== u.id) return b
        const slotChanged = u.slot_id !== b.slot_id
        const nccChanged  = u.ncc_id  !== b.ncc_id
        return {
          ...b,
          status:         u.status         as DeliveryBooking['status'],
          slot_id:        u.slot_id        as string | null,
          ncc_id:         u.ncc_id         as string | null,
          license_plate:  u.license_plate  as string | null,
          driver_name:    u.driver_name    as string | null,
          driver_phone:   u.driver_phone   as string | null,
          npp_name:       u.npp_name       as string | null,
          gdo_refs:       u.gdo_refs       as string | null,
          notes:          u.notes          as string | null,
          box_count:      u.box_count      as number | null,
          pallet_count:   u.pallet_count   as number | null,
          tonnage:        u.tonnage        as number | null,
          warehouse_type: u.warehouse_type as string | null,
          vehicle_type:   u.vehicle_type   as string | null,
          // Giữ nguyên joined objects nếu ID không đổi; xóa nếu đổi (background refetch sẽ fill lại)
          slot: slotChanged ? null : b.slot,
          ncc:  nccChanged  ? null : b.ncc,
        }
      })
    }
  )
}

let channel: RealtimeChannel | null = null

export function connectRealtimeEvents(): void {
  if (!supabaseClient || channel) return

  channel = supabaseClient
    .channel('wms-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: '*' },
      (payload) => {
        // Direct cache patch — near-instant (<150ms), không cần round-trip backend
        if (payload.table === 'DeliverySlot')    patchSlotCache(payload)
        if (payload.table === 'DeliveryBooking') patchBookingsCache(payload)

        // Invalidate để eventual consistency (background refetch sau patch)
        const keys = TABLE_QUERY_MAP[payload.table]
        if (keys) {
          keys.forEach((k) => queryClient.invalidateQueries({ queryKey: k }))
        } else {
          queryClient.invalidateQueries()
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.info('[realtime] connected — all tables live')
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[realtime] error, retrying:', status)
      }
    })
}

export function disconnectRealtimeEvents(): void {
  if (channel && supabaseClient) {
    supabaseClient.removeChannel(channel)
    channel = null
  }
}
