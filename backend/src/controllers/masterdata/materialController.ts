import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { safeSearch } from '../../utils/search'

function buildShortName(description: string, code: string, custom?: string | null) {
  const suffix = code.slice(-3)
  const base = custom ?? description
  return `${base} [${suffix}]`
}

export async function listMaterials(req: Request, res: Response) {
  try {
    const { active, search, manufacturer_id, storage_category, category } = req.query
    // Scope Loại hàng: chỉ thấy mã hàng thuộc loại được phân quyền (mã chưa gán loại vẫn hiện)
    const scopeCats = scopeCategoriesOf(req)

    // Rebuild mỗi trang — phân trang vượt cap ~1000 dòng/response của PostgREST.
    // Đã >1000 mã hàng active → không phân trang thì 4+ mã biến mất khỏi mọi list + dropdown chọn mã (Inbound/Outbound/TMS...).
    const buildQuery = () => {
      let query = supabase
        .from('Material')
        .select('*, manufacturer:Manufacturer(id, code, name)')
        .order('material_code')
      if (active === 'true') query = query.eq('is_active', true)
      if (manufacturer_id) query = query.eq('manufacturer_id', String(manufacturer_id))
      if (storage_category) query = query.eq('storage_category', String(storage_category))
      if (category) query = query.eq('category', String(category))
      if (scopeCats) query = query.or(`category.is.null,category.in.(${scopeCats.map(c => `"${c}"`).join(',')})`)
      if (search) {
        const s = safeSearch(search)
        query = query.or(
          `material_code.ilike.%${s}%,material_description.ilike.%${s}%,short_name.ilike.%${s}%,old_code.ilike.%${s}%`
        )
      }
      return query
    }
    // Phân trang SONG SONG (helper) — >1000 mã cần 2+ round-trip, chạy đồng thời giảm độ trễ
    // (trước ~3.5s do 2 lượt nối tiếp). Giữ yêu cầu trả HẾT (dropdown chọn mã cần đầy đủ).
    const out = await fetchAllRowsParallel(buildQuery)
    ok(res, out)
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
      category, product_type, unit, manufacturer_id, notes, no_qr_tracking,
      weight_kg, cartons_per_pallet, cartons_per_pallet_mn,
      units_per_carton, pallet_per_ea, shelf_life_days, storage_category, old_code, image_url,
      warehouse_pallet_overrides, supplier_shelf_life_overrides, batch_prefix,
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
        pallet_per_ea: pallet_per_ea != null ? Number(pallet_per_ea) : null,
        shelf_life_days: shelf_life_days != null ? Number(shelf_life_days) : null,
        storage_category: storage_category ?? null,
        old_code: old_code ? String(old_code).trim() : null,
        batch_prefix: batch_prefix ? String(batch_prefix).trim().toUpperCase() : null,
        image_url: image_url ?? null,
        manufacturer_id: manufacturer_id ?? null,
        notes: notes ?? null,
        no_qr_tracking: Boolean(no_qr_tracking),
        warehouse_pallet_overrides: Array.isArray(warehouse_pallet_overrides) ? warehouse_pallet_overrides : [],
        supplier_shelf_life_overrides: Array.isArray(supplier_shelf_life_overrides) ? supplier_shelf_life_overrides : [],
        created_by: req.user?.name || null,
        updated_by: req.user?.name || null,
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
      units_per_carton, pallet_per_ea, shelf_life_days, storage_category, old_code, image_url,
      warehouse_pallet_overrides, supplier_shelf_life_overrides, batch_prefix,
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
    if (pallet_per_ea !== undefined) patch.pallet_per_ea = pallet_per_ea != null ? Number(pallet_per_ea) : null
    if (shelf_life_days !== undefined) patch.shelf_life_days = shelf_life_days != null ? Number(shelf_life_days) : null
    if (storage_category !== undefined) patch.storage_category = storage_category
    if (old_code !== undefined) patch.old_code = old_code ? String(old_code).trim() : null
    if (batch_prefix !== undefined) patch.batch_prefix = batch_prefix ? String(batch_prefix).trim().toUpperCase() : null
    if (image_url !== undefined) patch.image_url = image_url
    if (manufacturer_id !== undefined) patch.manufacturer_id = manufacturer_id || null
    if (notes !== undefined) patch.notes = notes
    if (is_active !== undefined) patch.is_active = Boolean(is_active)
    if (no_qr_tracking !== undefined) patch.no_qr_tracking = Boolean(no_qr_tracking)
    if (warehouse_pallet_overrides !== undefined) patch.warehouse_pallet_overrides = Array.isArray(warehouse_pallet_overrides) ? warehouse_pallet_overrides : []
    if (supplier_shelf_life_overrides !== undefined) patch.supplier_shelf_life_overrides = Array.isArray(supplier_shelf_life_overrides) ? supplier_shelf_life_overrides : []
    patch.updated_by = req.user?.name || null

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

export async function listCategories(_req: Request, res: Response) {
  try {
    // Phân trang để không sót category chỉ xuất hiện ở mã hàng thứ >1000 (cap PostgREST)
    const PAGE = 1000
    const rows: { category: string | null }[] = []
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from('Material').select('category').eq('is_active', true).not('category', 'is', null)
        .range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      const arr = (data ?? []) as { category: string | null }[]
      rows.push(...arr)
      if (arr.length < PAGE) break
    }
    const cats = [...new Set(rows.map(m => m.category).filter(Boolean))].sort()
    ok(res, cats)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Upload Excel: UPSERT Material theo material_code ────────────────────────
// Mirror scripts/import_materials.js: mã MỚI → thêm (Tên hàng bắt buộc); mã ĐÃ CÓ → cập nhật
// chỉ ô CÓ GIÁ TRỊ trong file (ô trống = giữ nguyên). short_name tự sinh khi đổi Tên hàng.
// batch_prefix (ĐV2 tem `;`) THÊM Ở CUỐI để không xê dịch cột cũ. File ĐV1 KHÔNG có cột này (12 cột) →
// r[12] undefined → giữ nguyên (không đụng). File ĐV2 thêm cột thứ 13 = mã tắt mã lô.
const M_KEYS = ['material_code', 'material_description', 'category', 'unit', 'cartons_per_pallet',
  'units_per_carton', 'pallet_per_ea', 'weight_kg', 'shelf_life_days', 'product_type', 'custom_short_name', 'notes', 'batch_prefix'] as const

const mStr = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
// Trường số lượng/quy cách: chỉ nhận số HỮU HẠN, KHÔNG âm (âm/Infinity → null = coi như ô trống, giữ giá trị cũ khi merge)
const mNum = (v: unknown): number | null => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return (!Number.isFinite(n) || n < 0) ? null : n }
const mInt = (v: unknown): number | null => { if (v == null || v === '') return null; const n = parseInt(String(v), 10); return (!Number.isFinite(n) || n < 0) ? null : n }

export async function uploadExcel(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 'Không có file upload', 400)
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { defval: '', header: 1 })
    if (raw.length < 2) return fail(res, 'File Excel trống hoặc không đúng định dạng', 400)

    // Map theo VỊ TRÍ cột (đúng thứ tự M_KEYS) — chịu được khi mất dòng key/nhãn.
    const norm = (a: unknown[]) => (a || []).map(x => String(x ?? '').trim())
    // Dòng key nhận diện qua 2 ô đầu cố định (KHÔNG so đủ mọi cột) → file ĐV1 12 cột vẫn khớp
    // khi M_KEYS thêm batch_prefix ở cuối; tránh hiểu nhầm dòng key thành dữ liệu.
    const isKeyRow = (r: unknown[]) => norm(r)[0] === 'material_code' && norm(r)[1] === 'material_description'
    const start = isKeyRow(raw[1] as unknown[]) ? 2 : 1   // có dòng key → data từ dòng 3; không → bỏ dòng nhãn
    const rows = raw.slice(start)
      .map(r => Object.fromEntries(M_KEYS.map((k, i) => [k, (r as unknown[])[i]])) as Record<string, unknown>)
      .filter(r => Object.values(r).some(v => String(v ?? '').trim()))

    if (!rows.length) return fail(res, 'Không có dòng dữ liệu nào', 400)

    // Nạp TẤT CẢ mã đã có (đủ cột để MERGE: ô trống trong file giữ giá trị cũ) — phân trang né cap-1000
    type ExistingMat = {
      id: string; material_code: string; material_description: string | null; short_name: string | null
      custom_short_name: string | null; category: string | null; product_type: string | null; unit: string | null
      weight_kg: number | null; cartons_per_pallet: number | null; units_per_carton: number | null
      pallet_per_ea: number | null; shelf_life_days: number | null; notes: string | null
    }
    const existing = await fetchAllRowsParallel(() => supabase.from('Material').select(
      'id, material_code, material_description, short_name, custom_short_name, category, product_type, unit, weight_kg, cartons_per_pallet, units_per_carton, pallet_per_ea, shelf_life_days, notes'
    )) as ExistingMat[]
    const existingByCode = new Map<string, ExistingMat>()
    for (const m of existing) existingByCode.set(String(m.material_code).trim(), m)

    const now = new Date().toISOString()
    let skipped = 0
    const errors: string[] = []

    // Gom record (không ghi DB trong vòng lặp) → mã đã có = UPSERT lô, mã mới = INSERT lô (nhanh như upload Tồn kho)
    const upsertByCode = new Map<string, Record<string, unknown>>()
    const insertByCode = new Map<string, Record<string, unknown>>()

    for (const row of rows) {
      const material_code = mStr(row.material_code)
      if (!material_code) { skipped++; continue }

      const description  = mStr(row.material_description)
      const customShort  = mStr(row.custom_short_name)
      const category     = mStr(row.category)
      const product_type = mStr(row.product_type)
      const unit         = mStr(row.unit)
      const weight_kg    = mNum(row.weight_kg)
      const cpp          = mInt(row.cartons_per_pallet)
      const upc          = mInt(row.units_per_carton)
      const ppe          = mNum(row.pallet_per_ea)
      const sld          = mInt(row.shelf_life_days)
      const notes        = mStr(row.notes)
      const batchPrefix  = (() => { const s = mStr(row.batch_prefix); return s ? s.toUpperCase() : null })()  // ĐV2: mã tắt mã lô
      const shortOf = (d: string) => `${d} [${material_code.slice(-3)}]`
      // Đắp ô CÓ GIÁ TRỊ lên base (ô trống → giữ nguyên base)
      const apply = (base: Record<string, unknown>) => {
        if (description  != null) { base.material_description = description; base.short_name = shortOf(description) }
        if (customShort  != null) base.custom_short_name = customShort
        if (category     != null) base.category = category
        if (product_type != null) base.product_type = product_type
        if (unit         != null) base.unit = unit
        if (weight_kg    != null) base.weight_kg = weight_kg
        if (cpp          != null) base.cartons_per_pallet = cpp
        if (upc          != null) base.units_per_carton = upc
        if (ppe          != null) base.pallet_per_ea = ppe
        if (sld          != null) base.shelf_life_days = sld
        if (notes        != null) base.notes = notes
        if (batchPrefix  != null) base.batch_prefix = batchPrefix
        base.updated_at = now
        return base
      }

      const dbRow = existingByCode.get(material_code)
      if (dbRow || upsertByCode.has(material_code)) {
        // Mã đã có (hoặc đã gặp ở dòng trước) → merge full record để UPSERT (giữ created_at/is_active vì không đưa vào payload)
        const base = upsertByCode.get(material_code) ?? {
          id: dbRow!.id, material_code,
          material_description: dbRow!.material_description, short_name: dbRow!.short_name,
          custom_short_name: dbRow!.custom_short_name, category: dbRow!.category, product_type: dbRow!.product_type,
          unit: dbRow!.unit, weight_kg: dbRow!.weight_kg, cartons_per_pallet: dbRow!.cartons_per_pallet,
          units_per_carton: dbRow!.units_per_carton, pallet_per_ea: dbRow!.pallet_per_ea,
          shelf_life_days: dbRow!.shelf_life_days, notes: dbRow!.notes,
        }
        upsertByCode.set(material_code, apply(base))
      } else if (insertByCode.has(material_code)) {
        apply(insertByCode.get(material_code)!)   // mã mới lặp lại trong cùng file → merge tiếp
      } else {
        if (!description) { errors.push(`${material_code} — thiếu Tên hàng (mã mới)`); continue }
        insertByCode.set(material_code, {
          id: randomUUID(), material_code, material_description: description, short_name: shortOf(description),
          custom_short_name: customShort, category, product_type, unit, weight_kg,
          cartons_per_pallet: cpp, units_per_carton: upc, pallet_per_ea: ppe,
          shelf_life_days: sld, notes, batch_prefix: batchPrefix, is_active: true, created_at: now, updated_at: now,
        })
      }
    }

    let inserted = 0, updated = 0
    const insertRecords = [...insertByCode.values()]
    const upsertRecords = [...upsertByCode.values()]

    // INSERT mã mới theo lô 500 (lỗi lô → từng dòng để chỉ đúng mã hỏng)
    for (let i = 0; i < insertRecords.length; i += 500) {
      const chunk = insertRecords.slice(i, i + 500)
      const { error } = await supabase.from('Material').insert(chunk)
      if (!error) { inserted += chunk.length; continue }
      for (const rec of chunk) {
        const { error: e1 } = await supabase.from('Material').insert(rec)
        if (e1) errors.push(`${rec.material_code} — lỗi thêm: ${e1.message}`)
        else inserted++
      }
    }

    // UPSERT mã đã có theo lô 500 (onConflict id) — thay 1800 update lẻ bằng ~4 roundtrip
    for (let i = 0; i < upsertRecords.length; i += 500) {
      const chunk = upsertRecords.slice(i, i + 500)
      const { error } = await supabase.from('Material').upsert(chunk, { onConflict: 'id' })
      if (!error) { updated += chunk.length; continue }
      for (const rec of chunk) {
        const { error: e1 } = await supabase.from('Material').upsert(rec, { onConflict: 'id' })
        if (e1) errors.push(`${rec.material_code} — lỗi cập nhật: ${e1.message}`)
        else updated++
      }
    }

    ok(res, { inserted, updated, skipped, errors })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
