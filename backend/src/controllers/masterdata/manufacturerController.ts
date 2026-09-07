import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'

/**
 * Ô tên rỗng → NULL, không phải chuỗi "null".
 * `String(null)` cho ra đúng bốn chữ cái "null" và nó được lưu thẳng vào cột tên (đo 07/09, gói
 * QA 49 phép [9]): người dùng xoá trắng ô Tên rồi lưu, màn hình hiện nhà máy tên "null".
 */
const nameOrNull = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

function extractCount(arr: unknown): number {
  if (Array.isArray(arr) && arr.length > 0) return (arr[0] as { count: number }).count ?? 0
  return 0
}

export async function listManufacturers(req: Request, res: Response) {
  try {
    const onlyActive = req.query.active === 'true'
    let query = supabase.from('Manufacturer').select('*, Material(count)').order('code')
    if (onlyActive) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw error

    const result = (data ?? []).map((m) => {
      const { Material, ...rest } = m as Record<string, unknown>
      return { ...rest, _count: { materials: extractCount(Material) } }
    })
    ok(res, result)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getManufacturer(req: Request, res: Response) {
  try {
    // Materials phân trang (cap ~1000/response) — 1 nhà máy >1000 mã active sẽ bị cắt danh sách
    const [{ data: mfr, error: mErr }, mats] = await Promise.all([
      supabase.from('Manufacturer').select('*').eq('id', req.params.id).maybeSingle(),
      fetchAllRowsParallel(() => supabase.from('Material').select('*')
        .eq('manufacturer_id', req.params.id).eq('is_active', true).order('material_code').order('id')),
    ])
    if (mErr) throw mErr
    if (!mfr) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    ok(res, { ...mfr, materials: mats ?? [] })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createManufacturer(req: Request, res: Response) {
  try {
    const { code, name } = req.body
    // Kiểm SAU KHI trim: chuỗi toàn khoảng trắng là truthy nên bản cũ tạo được nhà máy MÃ RỖNG —
    // dòng đó không chọn được, không tìm được, chỉ nằm chắn trong danh mục (đo 07/09, phép [10]).
    const codeTrim = code == null ? '' : String(code).trim()
    if (!codeTrim) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu mã nhà máy')

    const { data, error } = await supabase
      .from('Manufacturer')
      .insert({ id: randomUUID(), code: codeTrim, name: nameOrNull(name), updated_at: new Date().toISOString() })
      .select().single()

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã nhà máy đã tồn tại')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateManufacturer(req: Request, res: Response) {
  try {
    const { name, is_active } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) patch.name = nameOrNull(name)
    if (is_active !== undefined) patch.is_active = Boolean(is_active)

    const { data, error } = await supabase
      .from('Manufacturer').update(patch).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteManufacturer(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Manufacturer').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
