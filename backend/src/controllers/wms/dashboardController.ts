import type { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { scopeCategoriesOf } from '../../utils/categoryScope'

// Dashboard tổng quan tồn kho — GET hở đọc có chủ đích (auth-only như /inventory),
// dữ liệu vẫn CẮT theo scope kho + loại hàng của user trong controller.

const ok = (res: Response, data: unknown) => res.json({ success: true, data })
const fail = (res: Response, message: string, status = 500) =>
  res.status(status).json({ success: false, error: { code: 'DASHBOARD_ERROR', message } })

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

type InvRow = {
  warehouse_id: string; warehouse_name: string; inventory_mode: string | null
  category: string; pallets: number; cartons: number; materials: number
}
type TodayStats = {
  inbound_orders: number; inbound_cartons: number
  outbound_gdos: number; outbound_planned: number; outbound_scanned: number
}

function scopeWhIds(req: Request): string[] | null {
  if (req.user?.name === 'Admin' || req.user?.warehouse_scope === 'NATIONAL') return null
  const ids = req.user?.warehouse_ids ?? []
  return ids.length ? ids : null
}

type ZoneCapRow = {
  zone_id: string; warehouse_id: string; warehouse_name: string
  code: string; name: string; category: string | null
  capacity: number; used: number
}

// Sức chứa theo KHU VỰC: capacity = Σ Location.max_pallets (vị trí active trong khu),
// used = số pallet active còn tồn đang gắn vị trí (cùng thước đo used_slots của slotting/move RPC).
// Bảng nhỏ (khu vực + vị trí vật lý) — đếm pallet gom phía DB (aggregate), không kéo bảng tồn.
async function computeZoneCapacity(whIds: string[] | null, cats: string[] | null): Promise<ZoneCapRow[]> {
  const [zones, locations, warehouses] = await Promise.all([
    fetchAllRowsParallel(() => {
      let q = supabase.from('WarehouseZone')
        .select('id, warehouse_id, code, name, category, sort_order')
        .eq('is_active', true).order('id')
      if (whIds) q = q.in('warehouse_id', whIds)
      return q
    }),
    fetchAllRowsParallel(() => {
      let q = supabase.from('Location')
        .select('id, warehouse_id, sub_code, max_pallets')
        .eq('is_active', true).order('id')
      if (whIds) q = q.in('warehouse_id', whIds)
      return q
    }),
    supabase.from('Warehouse').select('id, name').then(r => r.data ?? []),
  ])

  let usedByLoc: Map<string, number>
  try {
    const usedRows = await fetchAllRowsParallel(() => {
      let q = supabase.from('InventoryEntry')
        .select('location_id, used:id.count()')
        .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE'])
        .gt('cartons_remaining', 0)
        .not('location_id', 'is', null)
        .order('location_id')
      if (whIds) q = q.in('warehouse_id', whIds)
      return q
    })
    usedByLoc = new Map(usedRows.map(u => [String(u.location_id), Number(u.used) || 0]))
  } catch {
    // Aggregate tắt (silo chưa bật pgrst.db_aggregates_enabled) → đếm JS; tồn active gắn vị trí bounded theo sức chứa vật lý
    const entries = await fetchAllRowsParallel(() => {
      let q = supabase.from('InventoryEntry').select('location_id')
        .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE'])
        .gt('cartons_remaining', 0)
        .not('location_id', 'is', null)
        .order('id')
      if (whIds) q = q.in('warehouse_id', whIds)
      return q
    })
    usedByLoc = new Map()
    for (const e of entries as { location_id: string }[])
      usedByLoc.set(String(e.location_id), (usedByLoc.get(String(e.location_id)) ?? 0) + 1)
  }

  // Gom vị trí theo (kho, khu) — sub_code của Location = code của WarehouseZone trong cùng kho
  const byZoneKey = new Map<string, { capacity: number; used: number }>()
  for (const l of locations as { id: string; warehouse_id: string; sub_code: string | null; max_pallets: number }[]) {
    if (!l.sub_code) continue
    const key = `${l.warehouse_id}|${l.sub_code}`
    const agg = byZoneKey.get(key) ?? { capacity: 0, used: 0 }
    agg.capacity += Number(l.max_pallets) || 0
    agg.used += usedByLoc.get(String(l.id)) ?? 0
    byZoneKey.set(key, agg)
  }

  const whName = new Map((warehouses as { id: string; name: string }[]).map(w => [w.id, w.name]))
  return (zones as { id: string; warehouse_id: string; code: string; name: string; category: string | null; sort_order: number | null }[])
    .filter(z => !cats || !z.category || cats.includes(z.category)) // null-inclusive theo scope Loại hàng
    .map(z => {
      const agg = byZoneKey.get(`${z.warehouse_id}|${z.code}`)
      return {
        zone_id: z.id, warehouse_id: z.warehouse_id,
        warehouse_name: whName.get(z.warehouse_id) ?? z.warehouse_id,
        code: z.code, name: z.name, category: z.category,
        capacity: agg?.capacity ?? 0, used: agg?.used ?? 0,
        sort_order: z.sort_order,
      }
    })
    .sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name)
      || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || a.code.localeCompare(b.code))
    .map(({ sort_order: _s, ...r }) => r)
}

export async function getDashboard(req: Request, res: Response) {
  try {
    const whIds = scopeWhIds(req)
    const cats = scopeCategoriesOf(req)
    const today = todayVN()

    // Sức chứa khu vực chạy song song với RPC — lỗi phần khu không được kéo sập dashboard
    const zonesPromise = computeZoneCapacity(whIds, cats).catch(() => [] as ZoneCapRow[])

    // Fast-path: RPC aggregate phía DB (migration 20260704_dashboard_stats.sql)
    const { data: rpcData, error: rpcErr } = await supabase.rpc('dashboard_stats', {
      p_warehouse_ids: whIds, p_categories: cats, p_today: today,
    })
    if (!rpcErr && rpcData) return ok(res, { ...(rpcData as object), zones: await zonesPromise, source: 'rpc' })

    // Fallback khi RPC chưa apply: tính bằng JS (phân trang, không dính cap-1000).
    // Chậm hơn RPC — chỉ là cầu nối tới khi migration được apply.
    const [entries, warehouses, materials] = await Promise.all([
      fetchAllRowsParallel(() => {
        let q = supabase.from('InventoryEntry')
          .select('warehouse_id, material_id, cartons_remaining, import_date, cartons_imported')
          .gt('cartons_remaining', 0)
          .order('id')
        if (whIds) q = q.in('warehouse_id', whIds)
        return q
      }, 1000, 3),
      supabase.from('Warehouse').select('id, name, inventory_mode').then(r => r.data ?? []),
      fetchAllRowsParallel(() => supabase.from('Material').select('id, category').order('id')),
    ])

    const whById = new Map((warehouses as { id: string; name: string; inventory_mode: string | null }[])
      .map(w => [w.id, w]))
    const catByMat = new Map((materials as { id: string; category: string | null }[])
      .map(m => [String(m.id), m.category]))

    const invMap = new Map<string, InvRow & { matSet: Set<string> }>()
    for (const e of entries as { warehouse_id: string; material_id: string; cartons_remaining: number }[]) {
      const cat = catByMat.get(String(e.material_id)) ?? null
      if (cats && cat && !cats.includes(cat)) continue // null-inclusive: không khai loại vẫn tính
      const w = whById.get(e.warehouse_id)
      if (!w) continue
      const key = `${e.warehouse_id}|${cat ?? 'Khác'}`
      let row = invMap.get(key)
      if (!row) {
        row = { warehouse_id: e.warehouse_id, warehouse_name: w.name, inventory_mode: w.inventory_mode,
                category: cat ?? 'Khác', pallets: 0, cartons: 0, materials: 0, matSet: new Set() }
        invMap.set(key, row)
      }
      row.pallets += 1
      row.cartons += Number(e.cartons_remaining) || 0
      row.matSet.add(String(e.material_id))
    }
    const inventory: InvRow[] = [...invMap.values()]
      .map(({ matSet, ...r }) => ({ ...r, materials: matSet.size }))
      .sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name) || a.category.localeCompare(b.category))

    // Hôm nay: đếm bằng count=exact (không dính aggregate), sums nhỏ theo ngày
    const dayStart = `${today}T00:00:00`
    const dayEnd = `${today}T23:59:59.999`
    let piQ = supabase.from('ProductionImport').select('id', { count: 'exact', head: true })
      .gte('import_date', dayStart).lte('import_date', dayEnd)
    if (whIds) piQ = piQ.in('warehouse_id', whIds)

    const makeGdoQ = () => {
      let q = supabase.from('GroupDeliveryOrder').select('id').neq('status', 'CANCELLED').eq('delivery_date', today).order('id')
      if (whIds) q = q.in('warehouse_id', whIds)
      return q
    }

    const [{ count: inboundOrders }, gdos, todayEntries] = await Promise.all([
      piQ,
      fetchAllRowsParallel(makeGdoQ),   // scope NATIONAL >1000 GDO/ngày: limit cứng làm outboundPlanned/Scanned thiếu âm thầm
      fetchAllRowsParallel(() => {
        let q = supabase.from('InventoryEntry').select('cartons_imported')
          .gte('import_date', dayStart).lte('import_date', dayEnd).order('id')
        if (whIds) q = q.in('warehouse_id', whIds)
        return q
      }),
    ])

    const gdoIds = (gdos ?? []).map(g => g.id as string)
    let outboundPlanned = 0, outboundScanned = 0
    if (gdoIds.length) {
      // chunk 300 id/lượt để không vượt độ dài URL PostgREST
      const chunks: string[][] = []
      for (let i = 0; i < gdoIds.length; i += 300) chunks.push(gdoIds.slice(i, i + 300))
      const doResults = await Promise.all(chunks.map(chunk =>
        fetchAllRowsParallel(() => supabase.from('OutboundDelivery').select('id, gdo_id').in('gdo_id', chunk).order('id'))
      ))
      const doIds = doResults.flat().map(d => d.id as string)
      const doChunks: string[][] = []
      for (let i = 0; i < doIds.length; i += 300) doChunks.push(doIds.slice(i, i + 300))
      const itemResults = await Promise.all(doChunks.map(chunk =>
        fetchAllRowsParallel(() => supabase.from('OutboundItem').select('cartons_ordered, cartons_scanned, do_id').in('do_id', chunk).order('id'))
      ))
      for (const it of itemResults.flat()) {
        outboundPlanned += Number(it.cartons_ordered) || 0
        outboundScanned += Number(it.cartons_scanned) || 0
      }
    }

    const todayStats: TodayStats = {
      inbound_orders: inboundOrders ?? 0,
      inbound_cartons: (todayEntries as { cartons_imported: number | null }[])
        .reduce((s, e) => s + (Number(e.cartons_imported) || 0), 0),
      outbound_gdos: gdoIds.length,
      outbound_planned: outboundPlanned,
      outbound_scanned: outboundScanned,
    }

    return ok(res, { inventory, today: todayStats, zones: await zonesPromise, source: 'fallback' })
  } catch (e) { return fail(res, String(e)) }
}
