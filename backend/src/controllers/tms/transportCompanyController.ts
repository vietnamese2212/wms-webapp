import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'

// "A, B" → ['A','B'] (UPPER, bỏ trùng/rỗng)
function normAlias(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(',')
  return [...new Set(raw.map(s => String(s).toUpperCase().trim()).filter(Boolean))]
}

// Chặn 1 mã (code/alias) thuộc >1 NCC/ĐVVT (gây mơ hồ khi upload khớp theo mã). Trả mã đụng (nếu có).
async function findCodeClash(codes: string[], excludeId?: string): Promise<string | null> {
  const all = [...new Set(codes.filter(Boolean))]
  if (!all.length) return null
  // Phân trang (>1000 công ty thì kiểm trùng mã sót → cho tạo mã đụng)
  const data = await fetchAllRowsParallel(() =>
    supabase.from('TransportCompany').select('id, code, alias_codes').order('id'))
  for (const c of (data ?? []) as { id: string; code: string; alias_codes: string[] | null }[]) {
    if (excludeId && c.id === excludeId) continue
    const owned = new Set([String(c.code).toUpperCase().trim(), ...(c.alias_codes ?? []).map(s => String(s).toUpperCase().trim())])
    const hit = all.find(x => owned.has(x))
    if (hit) return hit
  }
  return null
}

export async function listTransportCompanies(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = req.user?.ncc_id ?? null
    const { is_active } = req.query as Record<string, string>
    // Phân trang né cap ~1000 (danh mục NCC/ĐVVT tăng dần)
    const data = await fetchAllRowsParallel(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = supabase.from('TransportCompany').select('*').order('name').order('id')
      // ĐVVT user: chỉ thấy công ty của mình
      if (userNccId) q = q.eq('id', userNccId)
      if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
      return q
    })
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

export async function createTransportCompany(req: Request, res: Response) {
  try {
    const { code, name, type, contact_name, contact_phone, alias_codes } = req.body as {
      code: string; name: string; type?: string; contact_name?: string; contact_phone?: string; alias_codes?: unknown
    }
    if (!code || !name) return fail(res, 'code và name là bắt buộc', 400)
    const codeU = code.toUpperCase().trim()
    const aliasArr = normAlias(alias_codes).filter(c => c !== codeU)
    const clash = await findCodeClash([codeU, ...aliasArr])
    if (clash) return fail(res, `Mã "${clash}" đã thuộc NCC/ĐVVT khác`, 409)
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actor = req.user?.name || null
    const { data, error } = await supabase.from('TransportCompany')
      .insert({
        id: randomUUID(), code: codeU, name: name.trim(),
        type: type ?? 'ĐVVT', alias_codes: aliasArr,
        contact_name: contact_name?.trim() ?? null,
        contact_phone: contact_phone?.trim() ?? null,
        is_active: true, created_at: now, updated_at: now,
        created_by: actor, updated_by: actor,
      })
      .select().single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateTransportCompany(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = req.user?.ncc_id ?? null
    const { id } = req.params
    // ĐVVT user: chỉ được sửa công ty của mình
    if (userNccId && id !== userNccId)
      return fail(res, 'Bạn không có quyền chỉnh sửa ĐVVT này', 403)
    const { name, type, contact_name, contact_phone, is_active, alias_codes } = req.body as {
      name?: string; type?: string; contact_name?: string; contact_phone?: string; is_active?: boolean; alias_codes?: unknown
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (name          !== undefined) updates.name          = name.trim()
    if (type          !== undefined) updates.type          = type
    if (contact_name  !== undefined) updates.contact_name  = contact_name?.trim() ?? null
    if (contact_phone !== undefined) updates.contact_phone = contact_phone?.trim() ?? null
    if (is_active     !== undefined) updates.is_active     = is_active
    if (alias_codes   !== undefined) {
      const { data: cur } = await supabase.from('TransportCompany').select('code').eq('id', id).maybeSingle()
      const codeU = String((cur as { code?: string } | null)?.code ?? '').toUpperCase().trim()
      const aliasArr = normAlias(alias_codes).filter(c => c !== codeU)
      const clash = await findCodeClash([codeU, ...aliasArr], id)
      if (clash) return fail(res, `Mã "${clash}" đã thuộc NCC/ĐVVT khác`, 409)
      updates.alias_codes = aliasArr
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('TransportCompany')
      .update(updates).eq('id', id).select().single()
    if (error) return fail(res, error.message)

    // Cascade is_active → tất cả xe → tất cả driver employee của ĐVVT
    if (is_active !== undefined) {
      const now = new Date().toISOString()
      // Lấy biển số xe của ĐVVT để cascade sang employee — phân trang (đội xe >1000 → cascade sót driver)
      const vehicles = await fetchAllRowsParallel(() =>
        supabase.from('Vehicle').select('license_plate').eq('ncc_id', id).order('id'))
      // Cập nhật tất cả xe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('Vehicle')
        .update({ is_active, updated_at: now }).eq('ncc_id', id)
      // Cập nhật tất cả driver employee (via plate) — chunk 300 tránh URL dài
      if (vehicles?.length) {
        const plates = (vehicles as { license_plate: string }[]).map(v => v.license_plate)
        const empUpdate = is_active
          ? { is_active: true,  deleted_at: null, updated_at: now }
          : { is_active: false, deleted_at: now,  updated_at: now }
        for (let i = 0; i < plates.length; i += 300) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await supabase.from('Employee')
            .update(empUpdate)
            .in('employee_code', plates.slice(i, i + 300))
            .eq('ncc_id', id)
            .eq('is_driver', true)
        }
      }
    }

    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteTransportCompany(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = req.user?.ncc_id ?? null
    // ĐVVT user không được xóa công ty (kể cả của mình)
    if (userNccId) return fail(res, 'Không có quyền xóa ĐVVT', 403)
    const { id } = req.params

    // Lấy tất cả xe của ĐVVT — phân trang (đội xe >1000 → xóa sót driver)
    const vehicles = await fetchAllRowsParallel(() =>
      supabase.from('Vehicle').select('license_plate').eq('ncc_id', id).order('id'))

    if (vehicles?.length) {
      const plates = (vehicles as { license_plate: string }[]).map(v => v.license_plate)
      // Hard-delete tất cả driver employee của các xe này — chunk 300 tránh URL dài
      for (let i = 0; i < plates.length; i += 300) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('Employee')
          .delete()
          .in('employee_code', plates.slice(i, i + 300))
          .eq('ncc_id', id)
          .eq('is_driver', true)
      }
      // Hard-delete tất cả xe của ĐVVT
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('Vehicle').delete().eq('ncc_id', id)
    }

    // Hard-delete ĐVVT (Postgres sẽ trả lỗi FK nếu còn record tham chiếu)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('TransportCompany').delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
