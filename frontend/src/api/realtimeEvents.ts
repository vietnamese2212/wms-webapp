import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/supabase'
import { queryClient } from './queryClient'
import type { DeliverySlot } from '@/types'

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

// Patch DeliverySlot cache trực tiếp từ realtime payload — không cần round-trip backend.
// Kết quả: booked_count cập nhật ngay lập tức (<100ms) thay vì đợi refetch (~500ms).
function patchSlotCache(payload: RealtimePostgresChangesPayload<Record<string, unknown>>) {
  if (payload.eventType !== 'UPDATE') return
  const updated = payload.new
  if (!updated?.id) return
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
        // DeliverySlot: patch cache ngay lập tức, sau đó invalidate để đảm bảo eventual consistency
        if (payload.table === 'DeliverySlot') {
          patchSlotCache(payload)
        }

        const keys = TABLE_QUERY_MAP[payload.table]
        if (keys) {
          keys.forEach((k) => queryClient.invalidateQueries({ queryKey: k }))
        } else {
          // Unknown / new table — invalidate everything to stay in sync
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
