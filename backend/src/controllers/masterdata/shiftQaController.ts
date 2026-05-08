import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

// ─── ImportShift (Ca nhập) ────────────────────────────────────

export async function listImportShifts(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('ImportShift')
      .select('id, code, name, display_order, is_active')
      .order('display_order')
    if (error) throw error
    ok(res, data ?? [])
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createImportShift(req: Request, res: Response) {
  try {
    const { code, name, display_order } = req.body
    if (!code) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code')
    if (!name) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu name')
    const { data, error } = await supabase
      .from('ImportShift')
      .insert({ id: randomUUID(), code, name, display_order: display_order ?? 0, updated_at: new Date().toISOString() })
      .select('id, code, name, display_order, is_active')
      .single()
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã ca đã tồn tại')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateImportShift(req: Request, res: Response) {
  try {
    const { code, name, display_order, is_active } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (code          !== undefined) patch.code = code
    if (name          !== undefined) patch.name = name
    if (display_order !== undefined) patch.display_order = display_order
    if (is_active     !== undefined) patch.is_active = is_active
    const { data, error } = await supabase
      .from('ImportShift').update(patch).eq('id', req.params.id)
      .select('id, code, name, display_order, is_active').maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy ca nhập')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── QAStatus (Tình trạng QA) ─────────────────────────────────

export async function listQAStatuses(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('QAStatus')
      .select('id, code, name, display_order, is_active')
      .order('display_order')
    if (error) throw error
    ok(res, data ?? [])
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createQAStatus(req: Request, res: Response) {
  try {
    const { code, name, display_order } = req.body
    if (!code) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code')
    if (!name) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu name')
    const { data, error } = await supabase
      .from('QAStatus')
      .insert({ id: randomUUID(), code, name, display_order: display_order ?? 0, updated_at: new Date().toISOString() })
      .select('id, code, name, display_order, is_active')
      .single()
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã QA đã tồn tại')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateQAStatus(req: Request, res: Response) {
  try {
    const { code, name, display_order, is_active } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (code          !== undefined) patch.code = code
    if (name          !== undefined) patch.name = name
    if (display_order !== undefined) patch.display_order = display_order
    if (is_active     !== undefined) patch.is_active = is_active
    const { data, error } = await supabase
      .from('QAStatus').update(patch).eq('id', req.params.id)
      .select('id, code, name, display_order, is_active').maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy trạng thái QA')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
