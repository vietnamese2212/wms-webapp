import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

function buildShortName(description: string, code: string, custom?: string | null) {
  const suffix = code.slice(-3)
  const base = custom ?? description
  return `${base} [${suffix}]`
}

export async function listMaterials(req: Request, res: Response) {
  try {
    const { active, search, manufacturer_id, storage_category, category } = req.query

    let query = supabase
      .from('Material')
      .select('*, manufacturer:Manufacturer(id, code, name)')
      .order('material_code')

    if (active === 'true') query = query.eq('is_active', true)
    if (manufacturer_id) query = query.eq('manufacturer_id', String(manufacturer_id))
    if (storage_category) query = query.eq('storage_category', String(storage_category))
    if (category) query = query.eq('category', String(category))
    if (search) {
      const s = String(search)
      query = query.or(
        `material_code.ilike.%${s}%,material_description.ilike.%${s}%,short_name.ilike.%${s}%,old_code.ilike.%${s}%`
      )
    }

    const { data, error } = await query
    if (error) throw error
    ok(res, data ?? [])
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getMaterial(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Material')
      .select('*, manufacturer:Manufacturer(id, code, name)')
      .eq('id', req.params.id)
      .maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createMaterial(req: Request, res: Response) {
  try {
    const {
      material_code, material_description, custom_short_name,
      category, product_type, unit, manufacturer_id, notes,
      weight_kg, cartons_per_pallet, cartons_per_pallet_mn,
      units_per_carton, ea_per_pallet, shelf_life_days, storage_category, old_code, image_url,
      warehouse_pallet_overrides, supplier_shelf_life_overrides,
    } = req.body
    if (!material_code || !material_description)
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu material_code hoặc material_description')

    const short_name = buildShortName(material_description, material_code, custom_short_name)

    const { data, error } = await supabase
      .from('Material')
      .insert({
        id:            randomUUID(),
        material_code: String(material_code).trim(),
        material_description: String(material_description).trim(),
        short_name,
        custom_short_name: custom_short_name ? String(custom_short_name).trim() : null,
        category: category ?? null,
        product_type: product_type ?? null,
        unit: unit ?? null,
        weight_kg: weight_kg != null ? weight_kg : null,
        cartons_per_pallet: cartons_per_pallet != null ? Number(cartons_per_pallet) : null,
        cartons_per_pallet_mn: cartons_per_pallet_mn != null ? Number(cartons_per_pallet_mn) : null,
        units_per_carton: units_per_carton != null ? Number(units_per_carton) : null,
        ea_per_pallet: ea_per_pallet != null ? Number(ea_per_pallet) : null,
        shelf_life_days: shelf_life_days != null ? Number(shelf_life_days) : null,
        storage_category: storage_category ?? null,
        old_code: old_code ? String(old_code).trim() : null,
        image_url: image_url ?? null,
        manufacturer_id: manufacturer_id ?? null,
        notes: notes ?? null,
        warehouse_pallet_overrides: Array.isArray(warehouse_pallet_overrides) ? warehouse_pallet_overrides : [],
        supplier_shelf_life_overrides: Array.isArray(supplier_shelf_life_overrides) ? supplier_shelf_life_overrides : [],
        created_by: (req as any).user?.name || null,
        updated_by: (req as any).user?.name || null,
        updated_at: new Date().toISOString(),
      })
      .select('*, manufacturer:Manufacturer(id, code, name)')
      .single()

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã hàng đã tồn tại')
      if (error.code === '23503') return fail(res, 404, 'NOT_FOUND', 'Nhà máy không tồn tại')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateMaterial(req: Request, res: Response) {
  try {
    const {
      material_description, custom_short_name, category, product_type, unit,
      manufacturer_id, notes, is_active, no_qr_tracking,
      weight_kg, cartons_per_pallet, cartons_per_pallet_mn,
      units_per_carton, ea_per_pallet, shelf_life_days, storage_category, old_code, image_url,
      warehouse_pallet_overrides, supplier_shelf_life_overrides,
    } = req.body

    let short_name: string | undefined
    if (material_description !== undefined || custom_short_name !== undefined) {
      const { data: current } = await supabase
        .from('Material').select('material_code, material_description, custom_short_name').eq('id', req.params.id).maybeSingle()
      if (!current) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')
      short_name = buildShortName(
        material_description ?? current.material_description,
        current.material_code,
        custom_short_name !== undefined ? custom_short_name : current.custom_short_name
      )
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (material_description !== undefined) patch.material_description = String(material_description).trim()
    if (custom_short_name !== undefined) patch.custom_short_name = custom_short_name ? String(custom_short_name).trim() : null
    if (short_name !== undefined) patch.short_name = short_name
    if (category !== undefined) patch.category = category
    if (product_type !== undefined) patch.product_type = product_type
    if (unit !== undefined) patch.unit = unit
    if (weight_kg !== undefined) patch.weight_kg = weight_kg
    if (cartons_per_pallet !== undefined) patch.cartons_per_pallet = cartons_per_pallet != null ? Number(cartons_per_pallet) : null
    if (cartons_per_pallet_mn !== undefined) patch.cartons_per_pallet_mn = cartons_per_pallet_mn != null ? Number(cartons_per_pallet_mn) : null
    if (units_per_carton !== undefined) patch.units_per_carton = units_per_carton != null ? Number(units_per_carton) : null
    if (ea_per_pallet !== undefined) patch.ea_per_pallet = ea_per_pallet != null ? Number(ea_per_pallet) : null
    if (shelf_life_days !== undefined) patch.shelf_life_days = shelf_life_days != null ? Number(shelf_life_days) : null
    if (storage_category !== undefined) patch.storage_category = storage_category
    if (old_code !== undefined) patch.old_code = old_code ? String(old_code).trim() : null
    if (image_url !== undefined) patch.image_url = image_url
    if (manufacturer_id !== undefined) patch.manufacturer_id = manufacturer_id || null
    if (notes !== undefined) patch.notes = notes
    if (is_active !== undefined) patch.is_active = Boolean(is_active)
    if (no_qr_tracking !== undefined) patch.no_qr_tracking = Boolean(no_qr_tracking)
    if (warehouse_pallet_overrides !== undefined) patch.warehouse_pallet_overrides = Array.isArray(warehouse_pallet_overrides) ? warehouse_pallet_overrides : []
    if (supplier_shelf_life_overrides !== undefined) patch.supplier_shelf_life_overrides = Array.isArray(supplier_shelf_life_overrides) ? supplier_shelf_life_overrides : []
    patch.updated_by = (req as any).user?.name || null

    const { data, error } = await supabase
      .from('Material')
      .update(patch)
      .eq('id', req.params.id)
      .select('*, manufacturer:Manufacturer(id, code, name)')
      .maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteMaterial(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Material').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function listCategories(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Material').select('category').eq('is_active', true).not('category', 'is', null)
    if (error) throw error
    const cats = [...new Set((data ?? []).map((m: any) => m.category).filter(Boolean))].sort()
    ok(res, cats)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
