import { Request, Response } from 'express'
import { maskServerMessage } from '../../utils/response'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { scopeCategoriesOf, categoriesAllAllowed, categoriesOrScopeFilter, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'

function fail(res: Response, message: string, status = 400) {
  // 5xx KHÔNG trả nguyên văn message (lộ tên bảng/cột PostgREST) — xem utils/response.ts
  return res.status(status).json({ success: false, error: { message: maskServerMessage(message, status) } })
}

const ZONE_COLS = 'id, warehouse_id, code, name, categories, sort_order, pick_rank, flow_type, max_pallets, is_active, created_at, updated_at, created_by, updated_by'

// Loại kho của khu = MẢNG, BẮT BUỘC ≥1 (user chốt 27/07: "cho chọn multi, KHÔNG cho để trống").
// Trả về mảng đã trim/dedupe, hoặc lỗi chuỗi. Validate tồn tại trong danh mục Loại kho ở caller.
function parseCategories(v: unknown): { ok: true; value: string[] } | { ok: false; msg: string } {
  const raw = Array.isArray(v) ? v : []
  const out = [...new Set(raw.map(x => String(x ?? '').trim()).filter(Boolean))]
  if (out.length === 0) return { ok: false, msg: 'Khu vực phải chọn ít nhất 1 Loại kho' }
  return { ok: true, value: out }
}

async function unknownCategories(cats: string[]): Promise<string[]> {
  const { data } = await supabase.from('LookupValue').select('value').eq('type', 'warehouse_type')
  const known = new Set(((data ?? []) as { value: string }[]).map(r => String(r.value)))
  return cats.filter(c => !known.has(c))
}

// Khu là CHUẨN loại của vị trí → đổi loại khu phải cascade xuống mọi vị trí (kho, sub_code) của khu.
// (Trước 27/07 sửa loại khu KHÔNG cascade — vị trí giữ loại cũ âm thầm.)
async function cascadeCategoriesToLocations(warehouseId: string, zoneCode: string, categories: string[], actor: string | null) {
  const { error } = await supabase.from('Location')
    .update({ categories, updated_at: new Date().toISOString(), updated_by: actor })
    .eq('warehouse_id', warehouseId).eq('sub_code', zoneCode)
  if (error) console.error('[zone cascade categories]', error.message)
}

export async function listZones(req: Request, res: Response) {
  const { warehouse_id } = req.query as { warehouse_id?: string }

  let query = supabase
    .from('WarehouseZone')
    .select(ZONE_COLS)
    .order('sort_order')
    .order('created_at')

  // Cắt theo scope Kho + Loại kho của user (giao ≥1 loại là thấy; null-inclusive cho di sản)
  if (req.user?.warehouse_scope === 'ASSIGNED') {
    const allowedWh: string[] = req.user.warehouse_ids ?? []
    if (warehouse_id && !allowedWh.includes(warehouse_id)) return res.json({ success: true, data: [] })
    if (!warehouse_id && allowedWh.length > 0) query = query.in('warehouse_id', allowedWh)
  }
  const scopeCats = scopeCategoriesOf(req)
  if (scopeCats) query = query.or(categoriesOrScopeFilter('categories', scopeCats))

  if (warehouse_id) query = query.eq('warehouse_id', warehouse_id)

  const { data, error } = await query
  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

// Pallet tối đa khai tay tại khu (Dashboard so tồn vs sức chứa): null = chưa khai; số nguyên ≥ 0
function parseMaxPallets(v: unknown): { ok: true; value: number | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: Math.round(n) }
}

export async function createZone(req: Request, res: Response) {
  const { warehouse_id, name, categories, code, max_pallets } = req.body as { warehouse_id?: string; name?: string; categories?: unknown; code?: string; max_pallets?: number | string | null }
  if (!warehouse_id || !name?.trim()) return fail(res, 'warehouse_id và name là bắt buộc')
  const mp = parseMaxPallets(max_pallets)
  if (!mp.ok) return fail(res, 'Pallet tối đa phải là số ≥ 0')
  const pc = parseCategories(categories)
  if (!pc.ok) return fail(res, pc.msg)
  const unknown = await unknownCategories(pc.value)
  if (unknown.length) return fail(res, `Loại kho không có trong danh mục: ${unknown.join(', ')}`)

  const reqUser = req.user
  if (reqUser?.warehouse_scope === 'ASSIGNED') {
    const allowed: string[] = reqUser.warehouse_ids ?? []
    if (!allowed.includes(warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
  }
  if (!categoriesAllAllowed(req, pc.value)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

  const t = new Date().toISOString()

  // Lấy tất cả code hiện có để tìm số thứ tự tiếp theo
  const { data: existing } = await supabase
    .from('WarehouseZone')
    .select('code, sort_order')
    .eq('warehouse_id', warehouse_id)
    .order('sort_order', { ascending: false })

  const nextSort = existing?.length ? (Number((existing[0] as any).sort_order ?? 0) + 1) : 1

  const usedCodes = new Set((existing ?? []).map((z: any) => String(z.code).toUpperCase()))

  // Mã do người dùng nhập (ưu tiên) — chuẩn hoá UPPER, bỏ khoảng trắng. Để trống → tự sinh Z01, Z02…
  // Trùng trong CÙNG kho → chặn (DB cũng có unique (warehouse_id, code)). Khác kho trùng nhau OK.
  const manualCode = String(code ?? '').toUpperCase().trim().replace(/\s+/g, '')
  let finalCode: string
  if (manualCode) {
    if (usedCodes.has(manualCode)) return fail(res, `Mã khu vực "${manualCode}" đã tồn tại trong kho này`, 409)
    finalCode = manualCode
  } else {
    let seq = nextSort
    let autoCode = `Z${String(seq).padStart(2, '0')}`
    while (usedCodes.has(autoCode)) {
      seq++
      autoCode = `Z${String(seq).padStart(2, '0')}`
    }
    finalCode = autoCode
  }

  const actorName = reqUser?.name || null
  const { data, error } = await supabase
    .from('WarehouseZone')
    .insert({
      id:           randomUUID(),
      warehouse_id,
      code:         finalCode,
      name:         name.trim(),
      categories:   pc.value,
      sort_order:   nextSort,
      max_pallets:  mp.value,
      created_by:   actorName,
      updated_by:   actorName,
      updated_at:   t,
    })
    .select(ZONE_COLS)
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') return fail(res, `Mã khu vực "${finalCode}" đã tồn tại trong kho này`, 409)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function updateZone(req: Request, res: Response) {
  const { id } = req.params
  // pick_rank/flow_type KHÔNG sửa ở đây — cấu hình slotting đi route riêng
  // PATCH /wms/slotting/zone-config/:id (quyền slotting.configure), tab Cài đặt trang Tối ưu vị trí
  const { name, categories, is_active, max_pallets } = req.body as { name?: string; categories?: unknown; is_active?: boolean; max_pallets?: number | string | null }

  const actor = req.user
  const { data: targetRaw } = await supabase.from('WarehouseZone').select('warehouse_id, code, categories').eq('id', id).single()
  if (!targetRaw) return fail(res, 'Không tìm thấy khu vực', 404)
  const target = targetRaw as { warehouse_id: string; code: string; categories: string[] | null }
  if (actor?.warehouse_scope === 'ASSIGNED') {
    const allowed: string[] = actor.warehouse_ids ?? []
    if (!allowed.includes(target.warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
  }
  // Khu đang gắn loại ngoài scope → không được sửa (thao tác chạm cả loại không được cấp)
  if (!categoriesAllAllowed(req, target.categories)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor?.name || null }
  if (name !== undefined) updates.name = name.trim()
  let newCategories: string[] | null = null
  if (categories !== undefined) {
    const pc = parseCategories(categories)
    if (!pc.ok) return fail(res, pc.msg)
    const unknown = await unknownCategories(pc.value)
    if (unknown.length) return fail(res, `Loại kho không có trong danh mục: ${unknown.join(', ')}`)
    if (!categoriesAllAllowed(req, pc.value)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)
    updates.categories = pc.value
    newCategories = pc.value
  }
  if (is_active !== undefined) updates.is_active = is_active
  if (max_pallets !== undefined) {
    const mp = parseMaxPallets(max_pallets)
    if (!mp.ok) return fail(res, 'Pallet tối đa phải là số ≥ 0')
    updates.max_pallets = mp.value
  }

  const { data, error } = await supabase
    .from('WarehouseZone')
    .update(updates)
    .eq('id', id)
    .select(ZONE_COLS)
    .single()

  if (error) return fail(res, error.message, 500)

  // Đổi loại khu → cascade xuống vị trí của khu (khu là chuẩn)
  if (newCategories && JSON.stringify(newCategories) !== JSON.stringify(target.categories ?? [])) {
    await cascadeCategoriesToLocations(target.warehouse_id, target.code, newCategories, actor?.name || null)
  }
  res.json({ success: true, data })
}

export async function deleteZone(req: Request, res: Response) {
  const { id } = req.params

  const { data: zone } = await supabase
    .from('WarehouseZone')
    .select('code, warehouse_id, categories')
    .eq('id', id)
    .single()

  if (zone) {
    const deleteActor = req.user
    if (deleteActor?.warehouse_scope === 'ASSIGNED') {
      const allowed: string[] = deleteActor.warehouse_ids ?? []
      if (!allowed.includes((zone as any).warehouse_id)) return fail(res, 'Không có quyền thao tác trên kho này', 403)
    }
    if (!categoriesAllAllowed(req, (zone as any).categories)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

    const { count } = await supabase
      .from('Location')
      .select('id', { count: 'exact', head: true })
      .eq('warehouse_id', (zone as any).warehouse_id)
      .eq('sub_code', (zone as any).code)

    if (count && count > 0) {
      return fail(res, `Khu vực này có ${count} vị trí, không thể xóa. Xóa hoặc chuyển vị trí trước.`)
    }
  }

  const { error } = await supabase.from('WarehouseZone').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  res.json({ success: true })
}
