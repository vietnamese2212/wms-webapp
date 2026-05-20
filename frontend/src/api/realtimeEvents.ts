import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/supabase'
import { queryClient } from './queryClient'

// Maps table name → query keys to invalidate.
// Add entries here when new modules with real API queries are built.
const TABLE_QUERY_MAP: Record<string, string[][]> = {
  ProductionImport: [['inbound-orders'], ['inbound-order']],
  InventoryEntry:   [['inbound-order'], ['inventory-entries'], ['inventory-facets'], ['locations-real']],
  Location:         [['locations-real'], ['sub-groups']],
  Material:         [['materials']],
  Manufacturer:     [['manufacturers']],
  Warehouse:        [['warehouses']],
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
