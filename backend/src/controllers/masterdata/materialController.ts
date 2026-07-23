import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { scopeCategoriesOf, categoryAllowed } from '../../utils/categoryScope'
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
      category, product_type, manufacturer_id, notes, no_qr_tracking,
      weight_kg, cartons_per_pallet, cartons_per_pallet_mn,
      units_per_carton, pallet_per_ea, shelf_life_days, storage_category, old_code, image_url,
      warehouse_pallet_overrides, supplier_shelf_life_overrides, batch_prefix,
      carton_length_mm, carton_width_mm, carton_height_mm, max_stack_layers, stack_on_top,
      base_unit, entry_unit, is_non_stock, is_pallet_carrier,
    } = req.body
    if (!material_code || !material_description)
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu material_code hoặc material_description')
    // Entry unit đòi hệ số 1 Entry = N Base (dùng lại units_per_carton)
    if (entry_unit && !(Number(units_per_carton) > 0))
      return fail(res, 400, 'VALIDATION_ERROR', 'Có Đơn vị nhập liệu (entry) thì hệ số "1 Entry = N Base" (ô Hộp/thùng) phải > 0')
    // Entry PHẢI KHÁC Base — nếu bằng nhau thì nhân EA/thùng sẽ sai (vd Base=HOP không được Entry=HOP)
    if (entry_unit && base_unit && String(entry_unit).trim().toUpperCase() === String(base_unit).trim().toUpperCase())
      return fail(res, 400, 'VALIDATION_ERROR', 'Entry Unit phải KHÁC Base Unit (vd Base=HOP thì Entry không được HOP)')

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
        weight_kg: weight_kg != null ? weight_kg : null,
        cartons_per_pallet: cartons_per_pallet != null ? Number(cartons_per_pallet) : null,
        cartons_per_pallet_mn: cartons_per_pallet_mn != null ? Number(cartons_per_pallet_mn) : null,
        units_per_carton: units_per_carton != null ? Number(units_per_carton) : null,
        pallet_per_ea: pallet_per_ea != null ? Number(pallet_per_ea) : null,
        shelf_life_days: shelf_life_days != null ? Number(shelf_life_days) : null,
        carton_length_mm: carton_length_mm != null ? Number(carton_length_mm) : null,
        carton_width_mm:  carton_width_mm  != null ? Number(carton_width_mm)  : null,
        carton_height_mm: carton_height_mm != null ? Number(carton_height_mm) : null,
        max_stack_layers: max_stack_layers != null ? Number(max_stack_layers) : null,
        stack_on_top:     Boolean(stack_on_top),
        base_unit: base_unit ? String(base_unit).trim().toUpperCase() : null,
        entry_unit: entry_unit ? String(entry_unit).trim().toUpperCase() : null,
        is_non_stock: Boolean(is_non_stock),
        is_pallet_carrier: Boolean(is_pallet_carrier),   // mã PALLET mang hàng (Loscam) — loại khỏi đếm Pallet chuyến
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
      material_description, custom_short_name, category, product_type,
      manufacturer_id, notes, is_active, no_qr_tracking,
      weight_kg, cartons_per_pallet, cartons_per_pallet_mn,
      units_per_carton, pallet_per_ea, shelf_life_days, storage_category, old_code, image_url,
      warehouse_pallet_overrides, supplier_shelf_life_overrides, batch_prefix,
      carton_length_mm, carton_width_mm, carton_height_mm, max_stack_layers, stack_on_top,
      base_unit, entry_unit, is_non_stock, is_pallet_carrier,
    } = req.body

    // Entry unit đòi hệ số 1 Entry = N Base + Entry PHẢI KHÁC Base — kiểm theo GIÁ TRỊ HIỆU LỰC sau patch
    if (entry_unit !== undefined || units_per_carton !== undefined || base_unit !== undefined) {
      const { data: cur } = await supabase.from('Material')
        .select('entry_unit, units_per_carton, base_unit').eq('id', req.params.id).maybeSingle()
      const effEntry = entry_unit !== undefined ? (entry_unit ? String(entry_unit).trim().toUpperCase() : null) : cur?.entry_unit ?? null
      const effUpc   = units_per_carton !== undefined ? (units_per_carton != null ? Number(units_per_carton) : null) : cur?.units_per_carton ?? null
      const effBase  = base_unit !== undefined ? (base_unit ? String(base_unit).trim().toUpperCase() : null) : cur?.base_unit ?? null
      if (effEntry && !(Number(effUpc) > 0))
        return fail(res, 400, 'VALIDATION_ERROR', 'Có Đơn vị nhập liệu (entry) thì hệ số "1 Entry = N Base" (ô EA/thùng) phải > 0')
      if (effEntry && effBase && effEntry === effBase)
        return fail(res, 400, 'VALIDATION_ERROR', 'Entry Unit phải KHÁC Base Unit (vd Base=HOP thì Entry không được HOP)')
    }

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
    if (weight_kg !== undefined) patch.weight_kg = weight_kg
    if (cartons_per_pallet !== undefined) patch.cartons_per_pallet = cartons_per_pallet != null ? Number(cartons_per_pallet) : null
    if (cartons_per_pallet_mn !== undefined) patch.cartons_per_pallet_mn = cartons_per_pallet_mn != null ? Number(cartons_per_pallet_mn) : null
    if (units_per_carton !== undefined) patch.units_per_carton = units_per_carton != null ? Number(units_per_carton) : null
    if (pallet_per_ea !== undefined) patch.pallet_per_ea = pallet_per_ea != null ? Number(pallet_per_ea) : null
    if (shelf_life_days !== undefined) patch.shelf_life_days = shelf_life_days != null ? Number(shelf_life_days) : null
    if (carton_length_mm !== undefined) patch.carton_length_mm = carton_length_mm != null ? Number(carton_length_mm) : null
    if (carton_width_mm  !== undefined) patch.carton_width_mm  = carton_width_mm  != null ? Number(carton_width_mm)  : null
    if (carton_height_mm !== undefined) patch.carton_height_mm = carton_height_mm != null ? Number(carton_height_mm) : null
    if (max_stack_layers !== undefined) patch.max_stack_layers = max_stack_layers != null ? Number(max_stack_layers) : null
    if (stack_on_top     !== undefined) patch.stack_on_top     = Boolean(stack_on_top)
    if (base_unit !== undefined)  patch.base_unit  = base_unit ? String(base_unit).trim().toUpperCase() : null
    if (entry_unit !== undefined) patch.entry_unit = entry_unit ? String(entry_unit).trim().toUpperCase() : null
    if (is_non_stock !== undefined) patch.is_non_stock = Boolean(is_non_stock)
    if (is_pallet_carrier !== undefined) patch.is_pallet_carrier = Boolean(is_pallet_carrier)
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
// Cột index 3 ('unit' = ĐVT cũ) GIỮ LÀM FILLER VỊ TRÍ để file Excel cũ không lệch cột — KHÔNG còn persist
// vào DB (cột Material.unit đã bỏ). Đơn vị mã hàng nay = base_unit + entry_unit (cuối mảng).
const M_KEYS = ['material_code', 'material_description', 'category', 'unit', 'cartons_per_pallet',
  'units_per_carton', 'pallet_per_ea', 'weight_kg', 'shelf_life_days', 'product_type', 'custom_short_name', 'notes', 'batch_prefix',
  'carton_length_mm', 'carton_width_mm', 'carton_height_mm',
  'max_stack_layers', 'stack_on_top',
  'base_unit', 'entry_unit'] as const   // ĐVT base/entry (chiến dịch Base Unit) THÊM Ở CUỐI — file cũ ngắn hơn → giữ nguyên

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
      custom_short_name: string | null; category: string | null; product_type: string | null
      weight_kg: number | null; cartons_per_pallet: number | null; units_per_carton: number | null
      pallet_per_ea: number | null; shelf_life_days: number | null; notes: string | null
      base_unit: string | null; entry_unit: string | null
    }
    const existing = await fetchAllRowsParallel(() => supabase.from('Material').select(
      'id, material_code, material_description, short_name, custom_short_name, category, product_type, weight_kg, cartons_per_pallet, units_per_carton, pallet_per_ea, shelf_life_days, notes, base_unit, entry_unit'
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
      const weight_kg    = mNum(row.weight_kg)
      const cpp          = mInt(row.cartons_per_pallet)
      const upc          = mInt(row.units_per_carton)
      const ppe          = mNum(row.pallet_per_ea)
      const sld          = mInt(row.shelf_life_days)
      const notes        = mStr(row.notes)
      const batchPrefix  = (() => { const s = mStr(row.batch_prefix); return s ? s.toUpperCase() : null })()  // ĐV2: mã tắt mã lô
      const cLen         = mNum(row.carton_length_mm)
      const cWid         = mNum(row.carton_width_mm)
      const cHei         = mNum(row.carton_height_mm)
      const maxLayers    = mInt(row.max_stack_layers)
      // Xếp trên hàng khác: 1/x/có/yes → true; 0/không/no → false; ô trống → giữ nguyên
      const onTopRaw     = mStr(row.stack_on_top)?.toLowerCase() ?? null
      const onTop        = onTopRaw == null ? null : ['1', 'x', 'true', 'có', 'co', 'yes'].includes(onTopRaw)
      const baseUnit     = (() => { const s = mStr(row.base_unit);  return s ? s.toUpperCase() : null })()
      const entryUnit    = (() => { const s = mStr(row.entry_unit); return s ? s.toUpperCase() : null })()
      const shortOf = (d: string) => `${d} [${material_code.slice(-3)}]`
      // Đắp ô CÓ GIÁ TRỊ lên base (ô trống → giữ nguyên base)
      const apply = (base: Record<string, unknown>) => {
        if (description  != null) { base.material_description = description; base.short_name = shortOf(description) }
        if (customShort  != null) base.custom_short_name = customShort
        if (category     != null) base.category = category
        if (product_type != null) base.product_type = product_type
        if (weight_kg    != null) base.weight_kg = weight_kg
        if (cpp          != null) base.cartons_per_pallet = cpp
        if (upc          != null) base.units_per_carton = upc
        if (ppe          != null) base.pallet_per_ea = ppe
        if (sld          != null) base.shelf_life_days = sld
        if (notes        != null) base.notes = notes
        if (batchPrefix  != null) base.batch_prefix = batchPrefix
        if (cLen         != null) base.carton_length_mm = cLen
        if (cWid         != null) base.carton_width_mm  = cWid
        if (cHei         != null) base.carton_height_mm = cHei
        if (maxLayers    != null) base.max_stack_layers = maxLayers
        if (onTop        != null) base.stack_on_top = onTop
        if (baseUnit     != null) base.base_unit = baseUnit
        if (entryUnit    != null) base.entry_unit = entryUnit
        base.updated_at = now
        return base
      }

      const dbRow = existingByCode.get(material_code)
      // Scope Loại hàng: bỏ qua (báo lỗi) mã thuộc loại ngoài phạm vi user (mã mới chưa gán loại vẫn cho)
      const effCat = category ?? dbRow?.category ?? null
      if (!categoryAllowed(req, effCat)) { errors.push(`${material_code} — Loại hàng "${effCat ?? ''}" ngoài phạm vi của bạn`); continue }
      // BASE UNIT: validate cặp đơn vị theo GIÁ TRỊ HIỆU LỰC sau merge (file đắp lên DB) — cùng luật
      // với form tạo/sửa mã (createMaterial): entry đòi hệ số > 0, entry ≠ base. Thiếu guard này
      // upload từng cho tạo mã khai entry mà không hệ số → app coi như không entry (phát hiện smoke 23/07).
      {
        // Mã lặp nhiều dòng trong file: dòng trước đã đắp giá trị → tính vào hiệu lực (acc trước dbRow)
        const acc = (upsertByCode.get(material_code) ?? insertByCode.get(material_code)) as Record<string, unknown> | undefined
        const effEntry = entryUnit ?? (acc?.entry_unit as string | null | undefined) ?? dbRow?.entry_unit ?? null
        const effBase  = baseUnit ?? (acc?.base_unit as string | null | undefined) ?? dbRow?.base_unit ?? null
        const effUpc   = upc ?? (acc?.units_per_carton as number | null | undefined) ?? dbRow?.units_per_carton ?? null
        if (effEntry && !(Number(effUpc) > 0)) {
          errors.push(`${material_code} — Entry unit "${effEntry}" cần hệ số quy đổi (cột Hộp/thùng) > 0`); continue
        }
        if (effEntry && effBase && effEntry === effBase) {
          errors.push(`${material_code} — Entry unit phải KHÁC Base unit (đang cùng "${effEntry}")`); continue
        }
      }
      if (dbRow || upsertByCode.has(material_code)) {
        // Mã đã có (hoặc đã gặp ở dòng trước) → merge full record để UPSERT (giữ created_at/is_active vì không đưa vào payload)
        const base = upsertByCode.get(material_code) ?? {
          id: dbRow!.id, material_code,
          material_description: dbRow!.material_description, short_name: dbRow!.short_name,
          custom_short_name: dbRow!.custom_short_name, category: dbRow!.category, product_type: dbRow!.product_type,
          weight_kg: dbRow!.weight_kg, cartons_per_pallet: dbRow!.cartons_per_pallet,
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
          custom_short_name: customShort, category, product_type, weight_kg,
          cartons_per_pallet: cpp, units_per_carton: upc, pallet_per_ea: ppe,
          shelf_life_days: sld, notes, batch_prefix: batchPrefix,
          carton_length_mm: cLen, carton_width_mm: cWid, carton_height_mm: cHei,
          max_stack_layers: maxLayers, stack_on_top: onTop ?? false,
          base_unit: baseUnit, entry_unit: entryUnit,
          is_active: true, created_at: now, updated_at: now,
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
