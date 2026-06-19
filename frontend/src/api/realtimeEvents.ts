import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/supabase'
import { queryClient } from './queryClient'
import type { DeliverySlot, TmsOrder } from '@/types'

// Maps table name → query keys to invalidate (fallback refetch).
const TABLE_QUERY_MAP: Record<string, string[][]> = {
  ProductionImport:    [['inbound-orders'], ['inbound-order'], ['inbound-report'], ['transfer-goods'], ['inbound-by-gdo'], ['tms-orders-transfer']],
  InventoryEntry:      [['inbound-order'], ['inventory-entries'], ['inventory-summary'], ['inventory-facets'], ['locations-real'], ['plan-vs-actual'], ['inbound-report'], ['manual-item-stock'], ['transfer-goods'], ['inbound-by-gdo'], ['stocktake-summary'], ['stocktake-entries']],
  Location:            [['locations-real'], ['sub-groups']],
  Material:            [['materials']],
  Manufacturer:        [['manufacturers']],
  PalletLabelPrint:    [['pallet-prints']],
  PalletOperation:     [['pallet-ops-log']],
  Warehouse:           [['warehouses']],
  WarehouseZone:       [['warehouse-zones']],
  LookupValue:         [['lookup']],            // prefix khớp ['lookup','warehouse_type'] & ['lookup',type]
  ImportShift:         [['import-shifts']],
  QAStatus:            [['qa-statuses']],
  TmsOrder:            [['tms-orders'], ['tms-orders-transfer']],
  TmsVehicleSlot:      [['tms-orders'], ['gate-registrations'], ['gate-suggest']],
  DeliverySlot:        [['tms-delivery-slots']],
  gate_registrations:  [['gate-registrations']],
  inbound_plan_lines:  [['inbound-plan-lines-by-order'], ['plan-vs-actual'], ['inbound-plan-lines'], ['inbound-report']],
  GroupDeliveryOrder:  [['gdos'], ['gdo'], ['tms-orders-transfer'], ['loosepicking']],
  OutboundDelivery:    [['gdo']],
  OutboundItem:        [['gdo'], ['loosepicking']],
  OutboundScanEntry:   [['gdo'], ['loosepicking']],
  Skill:                [['hr-skills'], ['hr-emp-skills']],
  EmployeeSkill:        [['hr-emp-skills']],
  LeaveRequest:         [['hr-leaves']],
  WorkAssignmentSheet:  [['hr-sheets'], ['hr-sheet']],
  WorkAssignmentDemand: [['hr-sheet']],
  WorkAssignment:       [['hr-sheet']],
  WorkLayout:           [['hr-layouts'], ['hr-layout']],
  WorkLayoutSkill:      [['hr-layout']],
  WorkLayoutJobTitle:   [['hr-layout']],
  ShiftRestRule:        [['hr-shift-rules']],
  Attendance:           [['hr-attendance'], ['hr-att-report']],
}

type Payload = RealtimePostgresChangesPayload<Record<string, unknown>>

// Patch DeliverySlot cache trực tiếp — cập nhật booked_count trong slot list VÀ trong
// slot object embedded trong TmsOrder.vehicle_slots[].slot
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

  // 2. Patch slot embedded trong TmsOrder.vehicle_slots[].slot
  queryClient.setQueriesData<TmsOrder[]>(
    { queryKey: ['tms-orders'] },
    (old) => {
      if (!Array.isArray(old)) return old
      return old.map(o => ({
        ...o,
        vehicle_slots: o.vehicle_slots.map(vs =>
          vs.slot_id === updated.id && vs.slot
            ? { ...vs, slot: { ...vs.slot, booked_count: updated.booked_count as number } }
            : vs
        ),
      }))
    }
  )
}

let channel: RealtimeChannel | null = null

// Time-based cooldown to block late Realtime events that arrive after a mutation
// settles but before all backend DB writes have propagated. isMutating() drops to 0
// the moment the HTTP response lands, but Supabase Realtime events can arrive 100-800ms
// later — creating a window where intermediate state triggers a premature refetch.
// Mutations call suppressTmsOrdersRealtime() on start (5s) and again on settle (2.5s).
let suppressTmsOrdersUntil = 0

export function suppressTmsOrdersRealtime(ms: number): void {
  suppressTmsOrdersUntil = Date.now() + ms
}

export function connectRealtimeEvents(): void {
  if (!supabaseClient || channel) return

  channel = supabaseClient
    .channel('wms-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: '*' },
      (payload) => {
        if (payload.table === 'DeliverySlot') patchSlotCache(payload)

        // Khi ProductionImport thay đổi (kể cả SQL-level delete), xóa localStorage
        // list cache để tránh ghost record flash khi component mount lại.
        if (payload.table === 'ProductionImport') {
          try {
            Object.keys(localStorage)
              .filter(k => k.startsWith('wms:io:'))
              .forEach(k => localStorage.removeItem(k))
            if (payload.eventType === 'DELETE') {
              const deletedId = (payload.old as Record<string, unknown>)?.id as string | undefined
              if (deletedId) localStorage.removeItem(`wms:io-detail:${deletedId}`)
            }
          } catch {}
        }

        // Invalidate để eventual consistency (background refetch sau patch)
        const keys = TABLE_QUERY_MAP[payload.table]
        if (!keys) return

        // Trong window suppressTmsOrdersUntil (set bởi booking mutations), bỏ qua
        // invalidation tms-orders — tránh intermediate state từ sequential DB writes.
        // isMutating() bị loại khỏi check vì nó block cả gate mutations (same SPA).
        const suppress = Date.now() < suppressTmsOrdersUntil
        keys.forEach((k) => {
          if (suppress && k[0] === 'tms-orders') return
          queryClient.invalidateQueries({ queryKey: k })
        })
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
