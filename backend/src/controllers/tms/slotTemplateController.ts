import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

// Ngày hôm nay theo giờ VN (YYYY-MM-DD) — mốc "ngày ≥ hôm nay" cho reapply/apply-info.
function vnToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
}

/**
 * Áp lại khung giờ cho các NGÀY tương lai (≥ hôm nay) của 1 (kho, loại xe):
 *  - Ngày có ≥1 xe đã booking → GIỮ NGUYÊN (user phải tự gỡ booking trước).
 *  - Ngày chưa ai booking → xóa hết slot ngày đó (của loại xe này) rồi sinh lại từ template ĐANG hoạt động.
 *  - Ngày chưa từng sinh slot → không đụng (sẽ lazy-sinh theo template mới khi mở lịch).
 * Gọi sau MỌI thay đổi template (batch / sửa lẻ / xóa). Ném lỗi để caller trả fail.
 */
async function reapplyFutureSlots(warehouse_id: string, vehicle_type_id: string): Promise<void> {
  const today = vnToday()
  const { data: slots, error: sErr } = await supabase.from('DeliverySlot')
    .select('date, booked_count')
    .eq('warehouse_id', warehouse_id)
    .eq('vehicle_type_id', vehicle_type_id)
    .gte('date', today)
  if (sErr) throw new Error(sErr.message)
  if (!slots?.length) return

  const bookedByDate = new Map<string, number>()
  for (const s of slots as { date: string; booked_count: number }[])
    bookedByDate.set(s.date, (bookedByDate.get(s.date) ?? 0) + (s.booked_count ?? 0))
  const unbookedDates = [...bookedByDate.entries()].filter(([, b]) => b === 0).map(([d]) => d)
  if (!unbookedDates.length) return

  // Xóa slot của các ngày chưa booking (chỉ loại xe này)
  const { error: delErr } = await supabase.from('DeliverySlot').delete()
    .eq('warehouse_id', warehouse_id).eq('vehicle_type_id', vehicle_type_id).in('date', unbookedDates)
  if (delErr) throw new Error(delErr.message)

  // Sinh lại từ template đang hoạt động
  const { data: templates, error: tErr } = await supabase.from('SlotTemplate')
    .select('id, cargo_type, day_of_week, time_from, time_to, max_vehicles')
    .eq('is_active', true).eq('warehouse_id', warehouse_id).eq('vehicle_type_id', vehicle_type_id)
  if (tErr) throw new Error(tErr.message)
  if (!templates?.length) return

  const now = new Date().toISOString()
  const rows: object[] = []
  for (const dateStr of unbookedDates) {
    const [y, m, d] = dateStr.split('-').map(Number)
    const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay()   // 0=CN…6=T7 (CN chỉ sinh nếu có template CN)
    for (const t of templates as { id: string; cargo_type: string; day_of_week: number; time_from: string; time_to: string; max_vehicles: number }[]) {
      if (t.day_of_week !== jsDay) continue
      rows.push({
        id: randomUUID(), template_id: t.id, warehouse_id, vehicle_type_id,
        cargo_type: t.cargo_type, date: dateStr, time_from: t.time_from, time_to: t.time_to,
        max_vehicles: t.max_vehicles, booked_count: 0, status: 'OPEN',
        created_at: now, updated_at: now,
      })
    }
  }
  if (rows.length) { const { error } = await supabase.from('DeliverySlot').insert(rows); if (error) throw new Error(error.message) }
}

export async function listSlotTemplates(req: Request, res: Response) {
  try {
    const { warehouse_id, vehicle_type_id } = req.query as Record<string, string>
    if (!warehouse_id) return fail(res, 'warehouse_id là bắt buộc', 400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = supabase.from('SlotTemplate')
      .select('*, vehicle_type:VehicleType(id, code, name)')
      .eq('warehouse_id', warehouse_id)
      .order('vehicle_type_id').order('day_of_week').order('time_from')
    if (vehicle_type_id) q = q.eq('vehicle_type_id', vehicle_type_id)
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

export async function createSlotTemplate(req: Request, res: Response) {
  try {
    const { warehouse_id, vehicle_type_id, cargo_type = 'ALL', days_of_week, time_from, time_to, max_vehicles } = req.body as {
      warehouse_id: string; vehicle_type_id: string; cargo_type?: string
      days_of_week: number[]; time_from: string; time_to: string; max_vehicles: number
    }
    if (!warehouse_id || !vehicle_type_id || !days_of_week?.length || !time_from || !time_to || !max_vehicles)
      return fail(res, 'Thiếu thông tin bắt buộc', 400)
    const now = new Date().toISOString()
    const actor = req.user?.name || null
    const rows = days_of_week.map(dow => ({
      id: randomUUID(), warehouse_id, vehicle_type_id, cargo_type,
      day_of_week: dow, time_from, time_to, max_vehicles: Number(max_vehicles),
      is_active: true, created_at: now, updated_at: now,
      created_by: actor, updated_by: actor,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('SlotTemplate')
      .insert(rows).select('*, vehicle_type:VehicleType(id, code, name)')
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateSlotTemplate(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { time_from, time_to, max_vehicles, cargo_type, is_active } = req.body as {
      time_from?: string; time_to?: string; max_vehicles?: number
      cargo_type?: string; is_active?: boolean
    }
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (time_from    !== undefined) updates.time_from    = time_from
    if (time_to      !== undefined) updates.time_to      = time_to
    if (max_vehicles !== undefined) updates.max_vehicles = Number(max_vehicles)
    if (cargo_type   !== undefined) updates.cargo_type   = cargo_type
    if (is_active    !== undefined) updates.is_active    = is_active
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('SlotTemplate')
      .update(updates).eq('id', id).select('*, vehicle_type:VehicleType(id, code, name)').single()
    if (error) return fail(res, error.message)
    // Áp thay đổi (giờ/số xe/bật-tắt) xuống các ngày tương lai chưa booking
    if (data?.warehouse_id && data?.vehicle_type_id) await reapplyFutureSlots(data.warehouse_id, data.vehicle_type_id)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteSlotTemplate(req: Request, res: Response) {
  try {
    const { id } = req.params
    // Lấy kho + loại xe trước khi xóa (để reapply)
    const { data: tmpl, error: fErr } = await supabase.from('SlotTemplate')
      .select('id, warehouse_id, vehicle_type_id').eq('id', id).single()
    if (fErr || !tmpl) return fail(res, fErr?.message || 'Không tìm thấy khung giờ', 404)
    const now = new Date().toISOString()
    // Tắt trước để reapply không sinh lại khung giờ này
    const { error: offErr } = await supabase.from('SlotTemplate')
      .update({ is_active: false, updated_at: now, updated_by: req.user?.name || null }).eq('id', id)
    if (offErr) return fail(res, offErr.message)
    // Gỡ slot ngày tương lai chưa booking + sinh lại từ template còn hoạt động
    await reapplyFutureSlots(tmpl.warehouse_id, tmpl.vehicle_type_id)
    // Xóa hẳn nếu không còn slot nào tham chiếu (slot quá khứ / đã booking thì giữ template ở trạng thái tắt)
    const { data: refd } = await supabase.from('DeliverySlot').select('id').eq('template_id', id).limit(1)
    if (!refd?.length) { const { error } = await supabase.from('SlotTemplate').delete().eq('id', id); if (error) return fail(res, error.message) }
    return ok(res, { message: 'Đã xóa' })
  } catch (e) { return fail(res, String(e)) }
}

/**
 * Lưu CẢ CỤM khung giờ của 1 (kho, loại xe, loại hàng) = lưới (thứ × khung giờ).
 * Body: { warehouse_id, vehicle_type_id, cargo_type?, days_of_week:number[], time_slots:[{time_from,time_to,max_vehicles}] }
 * - Trùng (thứ+giờ) đã có → cập nhật max + bật lại. Mới → insert. Bỏ khỏi lưới → tắt (còn slot) hoặc xóa (chưa slot).
 * - Sau đó reapply xuống các ngày tương lai chưa booking.
 */
export async function batchUpsertSlotTemplates(req: Request, res: Response) {
  try {
    const { warehouse_id, vehicle_type_id, cargo_type = 'ALL', days_of_week, time_slots } = req.body as {
      warehouse_id: string; vehicle_type_id: string; cargo_type?: string
      days_of_week: number[]; time_slots: { time_from: string; time_to: string; max_vehicles: number }[]
    }
    if (!warehouse_id || !vehicle_type_id || !days_of_week?.length || !time_slots?.length)
      return fail(res, 'Thiếu thông tin bắt buộc (kho, loại xe, thứ, khung giờ)', 400)

    const hhmm = (s: string) => (s || '').slice(0, 5)
    const seen = new Set<string>()
    for (const ts of time_slots) {
      const f = hhmm(ts.time_from), t = hhmm(ts.time_to)
      if (!f || !t || !ts.max_vehicles || Number(ts.max_vehicles) < 1)
        return fail(res, 'Khung giờ không hợp lệ: cần giờ bắt đầu, kết thúc và số xe tối đa ≥ 1', 400)
      if (f >= t) return fail(res, `Giờ kết thúc phải sau giờ bắt đầu (${f}–${t})`, 400)
      if (seen.has(`${f}-${t}`)) return fail(res, `Khung giờ ${f}–${t} bị lặp trong biểu mẫu`, 400)
      seen.add(`${f}-${t}`)
    }

    const now = new Date().toISOString()
    const actor = req.user?.name || null
    const key = (d: number, f: string, t: string) => `${d}|${hhmm(f)}|${hhmm(t)}`

    const { data: existing, error: exErr } = await supabase.from('SlotTemplate')
      .select('id, day_of_week, time_from, time_to')
      .eq('warehouse_id', warehouse_id).eq('vehicle_type_id', vehicle_type_id).eq('cargo_type', cargo_type)
    if (exErr) return fail(res, exErr.message)
    const existMap = new Map((existing ?? []).map((e: { id: string; day_of_week: number; time_from: string; time_to: string }) => [key(e.day_of_week, e.time_from, e.time_to), e.id]))

    const desired = new Set<string>()
    const maxByKey = new Map<string, number>()
    const toInsert: object[] = []
    for (const dow of days_of_week) for (const ts of time_slots) {
      const k = key(dow, ts.time_from, ts.time_to)
      if (desired.has(k)) continue
      desired.add(k); maxByKey.set(k, Number(ts.max_vehicles))
      if (!existMap.has(k)) toInsert.push({
        id: randomUUID(), warehouse_id, vehicle_type_id, cargo_type,
        day_of_week: dow, time_from: hhmm(ts.time_from), time_to: hhmm(ts.time_to),
        max_vehicles: Number(ts.max_vehicles), is_active: true,
        created_at: now, updated_at: now, created_by: actor, updated_by: actor,
      })
    }

    if (toInsert.length) { const { error } = await supabase.from('SlotTemplate').insert(toInsert); if (error) return fail(res, error.message) }

    // Cập nhật max + bật lại cho các dòng đã có nằm trong lưới
    let updated = 0
    for (const [k, exId] of existMap) {
      if (!desired.has(k)) continue
      updated++
      const { error } = await supabase.from('SlotTemplate')
        .update({ max_vehicles: maxByKey.get(k), is_active: true, updated_at: now, updated_by: actor }).eq('id', exId)
      if (error) return fail(res, error.message)
    }

    // Bỏ khỏi lưới → tắt trước (reapply không sinh lại)
    const removedIds = [...existMap.entries()].filter(([k]) => !desired.has(k)).map(([, id]) => id)
    if (removedIds.length) {
      const { error } = await supabase.from('SlotTemplate')
        .update({ is_active: false, updated_at: now, updated_by: actor }).in('id', removedIds)
      if (error) return fail(res, error.message)
    }

    // Áp lưới mới xuống ngày tương lai chưa booking
    await reapplyFutureSlots(warehouse_id, vehicle_type_id)

    // Xóa hẳn các template đã bỏ mà không còn slot nào tham chiếu
    if (removedIds.length) {
      const { data: refd } = await supabase.from('DeliverySlot').select('template_id').in('template_id', removedIds)
      const refSet = new Set((refd ?? []).map((r: { template_id: string }) => r.template_id))
      const del = removedIds.filter(id => !refSet.has(id))
      if (del.length) { const { error } = await supabase.from('SlotTemplate').delete().in('id', del); if (error) return fail(res, error.message) }
    }

    return ok(res, { inserted: toInsert.length, updated, removed: removedIds.length })
  } catch (e) { return fail(res, String(e)) }
}

/**
 * Xóa CẢ CỤM khung giờ của 1 (kho, loại xe, loại hàng) = xóa "rule".
 * Tắt hết template trong cụm → reapply (gỡ slot ngày tương lai chưa booking; ngày đã booking giữ)
 * → xóa hẳn template nào không còn slot tham chiếu. Sau đó các ngày tương lai KHÔNG sinh lại cụm này.
 */
export async function deleteSlotTemplateCluster(req: Request, res: Response) {
  try {
    const { warehouse_id, vehicle_type_id, cargo_type = 'ALL' } = req.query as Record<string, string>
    if (!warehouse_id || !vehicle_type_id) return fail(res, 'warehouse_id và vehicle_type_id là bắt buộc', 400)

    const { data: rows, error: exErr } = await supabase.from('SlotTemplate')
      .select('id')
      .eq('warehouse_id', warehouse_id).eq('vehicle_type_id', vehicle_type_id).eq('cargo_type', cargo_type)
    if (exErr) return fail(res, exErr.message)
    const ids = (rows ?? []).map((r: { id: string }) => r.id)
    if (!ids.length) return ok(res, { deleted: 0, deactivated: 0 })

    // Tắt trước để reapply không sinh lại
    const now = new Date().toISOString()
    const { error: offErr } = await supabase.from('SlotTemplate')
      .update({ is_active: false, updated_at: now, updated_by: req.user?.name || null }).in('id', ids)
    if (offErr) return fail(res, offErr.message)

    // Gỡ slot ngày tương lai chưa booking (ngày đã booking giữ nguyên)
    await reapplyFutureSlots(warehouse_id, vehicle_type_id)

    // Xóa hẳn template không còn slot tham chiếu
    const { data: refd } = await supabase.from('DeliverySlot').select('template_id').in('template_id', ids)
    const refSet = new Set((refd ?? []).map((r: { template_id: string }) => r.template_id))
    const del = ids.filter(id => !refSet.has(id))
    if (del.length) { const { error } = await supabase.from('SlotTemplate').delete().in('id', del); if (error) return fail(res, error.message) }

    return ok(res, { deleted: del.length, deactivated: ids.length - del.length })
  } catch (e) { return fail(res, String(e)) }
}

/**
 * Thông tin áp dụng khi sửa cụm khung giờ của 1 (kho, loại xe):
 *  - applicable_from: ngày gần nhất ≥ hôm nay mà thay đổi sẽ áp được (không bị booking chặn, không phải CN).
 *  - nearest_blocked: ngày gần nhất còn dữ liệu cũ đã có booking { date, booked } — user phải gỡ booking để sửa ngày đó.
 */
export async function getSlotApplyInfo(req: Request, res: Response) {
  try {
    const { warehouse_id, vehicle_type_id } = req.query as Record<string, string>
    if (!warehouse_id || !vehicle_type_id) return fail(res, 'warehouse_id và vehicle_type_id là bắt buộc', 400)
    const today = vnToday()
    const { data: slots, error } = await supabase.from('DeliverySlot')
      .select('date, booked_count')
      .eq('warehouse_id', warehouse_id).eq('vehicle_type_id', vehicle_type_id).gte('date', today)
    if (error) return fail(res, error.message)

    const bookedByDate = new Map<string, number>()
    for (const s of (slots ?? []) as { date: string; booked_count: number }[])
      bookedByDate.set(s.date, (bookedByDate.get(s.date) ?? 0) + (s.booked_count ?? 0))
    const blocked = [...bookedByDate.entries()].filter(([, b]) => b > 0)
      .map(([date, booked]) => ({ date, booked })).sort((a, b) => (a.date < b.date ? -1 : 1))
    const blockedSet = new Set(blocked.map(x => x.date))

    // Ngày áp được = ngày ≥ hôm nay đầu tiên không bị booking chặn
    let applicable: string | null = null
    const [y, m, d] = today.split('-').map(Number)
    const cur = new Date(Date.UTC(y, m - 1, d))
    for (let i = 0; i < 400; i++) {
      const ds = cur.toISOString().slice(0, 10)
      if (!blockedSet.has(ds)) { applicable = ds; break }
      cur.setUTCDate(cur.getUTCDate() + 1)
    }

    return ok(res, { today, applicable_from: applicable, nearest_blocked: blocked[0] ?? null })
  } catch (e) { return fail(res, String(e)) }
}

// Trả về danh sách loại xe duy nhất từ slot templates của kho, lọc theo cargo_type nếu có
export async function getVehicleTypesByWarehouse(req: Request, res: Response) {
  try {
    const { warehouse_id, cargo_type } = req.query as Record<string, string>
    if (!warehouse_id) return fail(res, 'warehouse_id là bắt buộc', 400)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = supabase.from('SlotTemplate')
      .select('vehicle_type:VehicleType(id, code, name)')
      .eq('warehouse_id', warehouse_id)
      .eq('is_active', true)
    if (cargo_type) q = q.in('cargo_type', [cargo_type, 'ALL'])
    const { data, error } = await q
    if (error) return fail(res, error.message)
    const seen = new Set<string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unique = (data ?? []).map((r: any) => r.vehicle_type).filter((vt: any) => vt && !seen.has(vt.id) && seen.add(vt.id))
    return ok(res, unique)
  } catch (e) { return fail(res, String(e)) }
}
