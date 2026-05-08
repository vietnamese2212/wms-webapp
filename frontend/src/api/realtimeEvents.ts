import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/supabase'
import { queryClient } from './queryClient'

let channel: RealtimeChannel | null = null

export function connectRealtimeEvents(): void {
  if (!supabaseClient || channel) return

  channel = supabaseClient
    .channel('wms-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ProductionImport' }, () => {
      queryClient.invalidateQueries({ queryKey: ['inbound-orders'] })
      queryClient.invalidateQueries({ queryKey: ['inbound-order'] })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'InventoryEntry' }, () => {
      queryClient.invalidateQueries({ queryKey: ['inbound-order'] })
      queryClient.invalidateQueries({ queryKey: ['locations-real'] })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Location' }, () => {
      queryClient.invalidateQueries({ queryKey: ['locations-real'] })
      queryClient.invalidateQueries({ queryKey: ['sub-groups'] })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Material' }, () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Manufacturer' }, () => {
      queryClient.invalidateQueries({ queryKey: ['manufacturers'] })
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'Warehouse' }, () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses'] })
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.info('[realtime] connected — live updates active')
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[realtime] subscription error, will retry:', status)
      }
    })
}

export function disconnectRealtimeEvents(): void {
  if (channel && supabaseClient) {
    supabaseClient.removeChannel(channel)
    channel = null
  }
}
