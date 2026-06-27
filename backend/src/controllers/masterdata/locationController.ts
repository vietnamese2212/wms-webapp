import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

function buildLocationCode(warehouseCode: string, subCode: string, row: string, shelf: string) {
  return [warehouseCode, subCode, row, shelf].filter(Boolean).join('_')
}

// Warehouse-scope: NATIONAL = mọi kho (null), còn lại = danh sách kho được gán.
function scopeWhIds(req: Request): string[] | null {
  return req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}
// Chặn 403 nếu vị trí (theo id) không thuộc kho trong phạm vi user. NATIONAL bỏ qua.
async function guardLocScope(req: Request, res: Response, locationId: string): Promise<boolean> {
  const scope = scopeWhIds(req)
  if (scope === null) return true
  const { data } = await supabase.from('Location').select('warehouse_id').eq('id', locationId).maybeSingle()
  const wh = (data as { warehouse_id: string | null } | null)?.warehouse_id ?? null
  if (!wh || !scope.includes(wh)) { fail(res, 403, 'FORBIDDEN', 'Vị trí không thuộc kho trong phạm vi của bạn'); return false }
  return true
}

export async function listLocations(req: Request, res: Response) {
  try {
    const { warehouse_id, sub_code, active, category, material_id } = req.query

    let query = supabase
      .from('Location')
      .select('*, warehouse:Warehouse(id, code, name), InventoryEntry(count)')
      .order('sub_code').order('row').order('shelf')

    if (warehouse_id) query = query.eq('warehouse_id', String(warehouse_id))
    if (sub_code) query = query.eq('sub_code', String(sub_code))
    if (active === 'true') query = query.eq('is_active', true)
    // category filter: match exact OR null (uncategorized locations accept all)
    if (category) query = (query as any).or(`category.eq.${String(category)},category.is.null`)

    const { data, error } = await query
    if (error) throw error

    // Add used_slots (layer 1 IN_STOCK or PARTIAL) for each location in parallel
    const withUsage = await Promise.all(
      (data ?? []).map(async (loc) => {
        const { InventoryEntry, ...rest } = loc as Record<string, unknown>
        const { count } = await supabase
          .from('InventoryEntry')
          .select('*', { count: 'exact', head: true })
          .eq('location_id', (rest as { id: string }).id)
          .eq('stack_layer', 1)
          .in('status', ['IN_STOCK', 'PARTIAL'])
        return {
          ...rest,
          _count: { inventory_entries: Array.isArray(InventoryEntry) ? ((InventoryEntry[0] as { count: number })?.count ?? 0) : 0 },
          used_slots: count ?? 0,
          has_same_material: false,
        } as Record<string, unknown>
      })
    )

    // has_same_material: vị trí đang chứa (layer-1, IN_STOCK/PARTIAL) đúng material_id này
    // → để FE gợi ý "nơi loại hàng đó đang để dở". 1 query gộp cho tất cả vị trí.
    if (material_id && withUsage.length > 0) {
      const locIds = withUsage.map(l => l.id as string)
      const { data: sameMat } = await supabase
        .from('InventoryEntry')
        .select('location_id')
        .in('location_id', locIds)
        .eq('material_id', String(material_id))
        .eq('stack_layer', 1)
        .in('status', ['IN_STOCK', 'PARTIAL'])
      const sameSet = new Set((sameMat ?? []).map((e: { location_id: string }) => e.location_id))
      for (const l of withUsage) l.has_same_material = sameSet.has(l.id as string)
    }

    ok(res, withUsage)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function listSubGroups(req: Request, res: Response) {
  try {
    const { warehouse_id } = req.query
    if (!warehouse_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id')

    const { data, error } = await supabase
      .from('Location')
      .select('sub_code, sub_name, sub_type')
      .eq('warehouse_id', String(warehouse_id))
      .eq('is_active', true)
      .order('sub_code')
    if (error) throw error

    const groupMap = new Map<string, { sub_code: string; sub_name: string | null; sub_type: string | null; location_count: number }>()
    for (const loc of data ?? []) {
      const key = loc.sub_code
      if (!groupMap.has(key)) groupMap.set(key, { sub_code: loc.sub_code, sub_name: loc.sub_name, sub_type: loc.sub_type, location_count: 0 })
      groupMap.get(key)!.location_count++
    }
    ok(res, Array.from(groupMap.values()))
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getLocation(req: Request, res: Response) {
  try {
    if (!(await guardLocScope(req, res, req.params.id))) return
    const { data: loc, error } = await supabase
      .from('Location').select('*, warehouse:Warehouse(id, code, name)').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!loc) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')

    const { data: entries, error: entErr } = await supabase
      .from('InventoryEntry')
      .select('*, material:Material(id, material_code, short_name)')
      .eq('location_id', req.params.id)
      .in('status', ['IN_STOCK', 'PARTIAL'])
      .order('stack_layer')
    if (entErr) throw entErr

    ok(res, { ...loc, inventory_entries: entries ?? [] })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createLocation(req: Request, res: Response) {
  try {
    const { warehouse_id, sub_code, sub_name, sub_type, row, shelf, max_pallets } = req.body
    if (!warehouse_id || !sub_code || !row)
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id, sub_code hoặc row')
    const scope = scopeWhIds(req)
    if (scope !== null && !scope.includes(String(warehouse_id)))
      return fail(res, 403, 'FORBIDDEN', 'Không thể tạo vị trí ở kho ngoài phạm vi của bạn')

    const { data: wh, error: whErr } = await supabase
      .from('Warehouse').select('code').eq('id', warehouse_id).maybeSingle()
    if (whErr) throw whErr
    if (!wh) return fail(res, 404, 'NOT_FOUND', 'Kho không tồn tại')

    const location_code = buildLocationCode(
      wh.code,
      String(sub_code).trim().toUpperCase(),
      String(row).trim(),
      String(shelf ?? '').trim()
    )

    const { category } = req.body

    const actor = req.user?.name || null
    const { data, error } = await supabase
      .from('Location')
      .insert({
        id:          randomUUID(),
        warehouse_id,
        sub_code: String(sub_code).trim().toUpperCase(),
        sub_name: sub_name ? String(sub_name).trim() : null,
        sub_type: sub_type ?? null,
        category: category ?? null,
        location_code,
        row: String(row).trim(),
        shelf: String(shelf ?? '').trim(),
        max_pallets: max_pallets ? Number(max_pallets) : 1,
        created_by: actor, updated_by: actor,
        updated_at: new Date().toISOString(),
      })
      .select('*, warehouse:Warehouse(id, code, name)')
      .single()

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Vị trí này đã tồn tại')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateLocation(req: Request, res: Response) {
  try {
    if (!(await guardLocScope(req, res, req.params.id))) return
    const { sub_name, sub_type, max_pallets, is_active, category, requires_stocktake } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (sub_name !== undefined)          patch.sub_name          = sub_name ? String(sub_name).trim() : null
    if (sub_type !== undefined)          patch.sub_type          = sub_type
    if (category !== undefined)          patch.category          = category || null
    if (max_pallets !== undefined)       patch.max_pallets       = Number(max_pallets)
    if (is_active !== undefined)         patch.is_active         = Boolean(is_active)
    if (requires_stocktake !== undefined) patch.requires_stocktake = Boolean(requires_stocktake)

    const { data, error } = await supabase
      .from('Location').update(patch).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteLocation(req: Request, res: Response) {
  try {
    if (!(await guardLocScope(req, res, req.params.id))) return
    // Chặn xóa vị trí đang chứa hàng → tránh tồn kho mồ côi trên location inactive
    const { count } = await supabase
      .from('InventoryEntry')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', req.params.id)
      .in('status', ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING'])
    if ((count ?? 0) > 0) return fail(res, 409, 'IN_USE', `Vị trí đang chứa ${count} pallet tồn — không thể xóa`)

    const { data, error } = await supabase
      .from('Location').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
