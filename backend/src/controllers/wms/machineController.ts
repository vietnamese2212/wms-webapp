import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

// DANH MỤC MÁY THEO KHO (user 13/08): Sổ đóng gói + In tem validate máy ở đây.
// Kho có setup máy → phải chọn trong danh mục; kho chưa setup → điền tự do.
// GET hở đọc cho user đăng nhập (form trang sổ / sinh tem cần) — write gate wms_settings.manage_machine.

const SEL = 'id, warehouse_id, code, note, is_active, created_at'

export async function listMachines(req: Request, res: Response) {
  try {
    let q = supabase.from('warehouse_machines').select(SEL).order('code')
    const wh = String(req.query.warehouse_id ?? '')
    if (wh) q = q.eq('warehouse_id', wh)
    const { data, error } = await q.limit(1000)
    if (error) throw error
    ok(res, data ?? [])
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createMachine(req: Request, res: Response) {
  try {
    const { warehouse_id, code, note } = req.body as Record<string, unknown>
    if (typeof warehouse_id !== 'string' || !warehouse_id.trim()) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu kho')
    if (typeof code !== 'string' || !code.trim()) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu tên máy')
    const { data, error } = await supabase.from('warehouse_machines')
      .insert({
        id: randomUUID(), warehouse_id: warehouse_id.trim(),
        code: code.trim().toUpperCase().slice(0, 10),
        note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : null,
        updated_at: new Date().toISOString(),
      })
      .select(SEL).single()
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Kho này đã có máy trùng tên')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateMachine(req: Request, res: Response) {
  try {
    const { code, note, is_active } = req.body as Record<string, unknown>
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (code !== undefined) {
      if (typeof code !== 'string' || !code.trim()) return fail(res, 400, 'VALIDATION_ERROR', 'Tên máy không được trống')
      patch.code = code.trim().toUpperCase().slice(0, 10)
    }
    if (note !== undefined) patch.note = typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : null
    if (is_active !== undefined) patch.is_active = !!is_active
    const { data, error } = await supabase.from('warehouse_machines')
      .update(patch).eq('id', req.params.id).select(SEL).maybeSingle()
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Kho này đã có máy trùng tên')
      throw error
    }
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy máy')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteMachine(req: Request, res: Response) {
  try {
    const { error, count } = await supabase.from('warehouse_machines')
      .delete({ count: 'exact' }).eq('id', req.params.id)
    if (error) throw error
    if (!count) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy máy')
    ok(res, { deleted: true })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// Helper cho validate (Sổ đóng gói): danh sách mã máy ACTIVE của kho — [] = kho chưa setup (điền tự do)
export async function activeMachineCodes(warehouseId: string): Promise<string[]> {
  const { data } = await supabase.from('warehouse_machines')
    .select('code').eq('warehouse_id', warehouseId).eq('is_active', true).limit(1000)
  return (data ?? []).map(m => String(m.code).toUpperCase())
}
