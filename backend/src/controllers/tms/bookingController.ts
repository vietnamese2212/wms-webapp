import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const BOOKING_SELECT = `
  *,
  ncc:TransportCompany!ncc_id(id, code, name),
  slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count)
`

// GET /api/tms/bookings?date=YYYY-MM-DD&warehouse_id=...&ncc_id=...&status=...
export async function listBookings(req: Request, res: Response) {
  try {
    const { date, warehouse_id, ncc_id, status } = req.query as Record<string, string>
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('DeliveryBooking') as any)
      .select(BOOKING_SELECT)
      .eq('date', date)
      .eq('warehouse_id', warehouse_id)
      .order('created_at')

    if (ncc_id)  q = q.eq('ncc_id', ncc_id)
    if (status)  q = q.eq('status', status)

    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/bookings
// Body: { date, warehouse_id, ncc_id, gdo_refs?, notes? }
export async function createBooking(req: Request, res: Response) {
  try {
    const { date, warehouse_id, ncc_id, gdo_refs, notes } = req.body
    if (!date || !warehouse_id || !ncc_id) return fail(res, 'date, warehouse_id, ncc_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('DeliveryBooking') as any)
      .insert({
        id: randomUUID(), date, warehouse_id, ncc_id,
        gdo_refs: gdo_refs || null,
        notes: notes || null,
        status: 'PENDING',
        created_by: user?.emp_id || null,
        updated_by: user?.emp_id || null,
        created_at: now, updated_at: now,
      })
      .select(BOOKING_SELECT)
      .single()

    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/tms/bookings/:id
// ĐVVT điền: slot_id, license_plate, driver_name, driver_phone, notes
// Điều vận thay đổi: status, gdo_refs
export async function updateBooking(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { slot_id, license_plate, driver_name, driver_phone, gdo_refs, notes, status } = req.body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()

    // Lấy booking hiện tại
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from('DeliveryBooking') as any)
      .select('id, slot_id, status')
      .eq('id', id)
      .single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy booking', 404)

    // Quản lý booked_count khi slot_id thay đổi
    const newSlotId = slot_id !== undefined ? slot_id : existing.slot_id
    if (newSlotId !== existing.slot_id) {
      // Giảm booked_count slot cũ
      if (existing.slot_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: oldSlot } = await (supabase.from('DeliverySlot') as any)
          .select('booked_count').eq('id', existing.slot_id).single()
        if (oldSlot && oldSlot.booked_count > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('DeliverySlot') as any)
            .update({ booked_count: oldSlot.booked_count - 1, updated_at: now })
            .eq('id', existing.slot_id)
        }
      }
      // Tăng booked_count slot mới (kiểm tra capacity)
      if (newSlotId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newSlot } = await (supabase.from('DeliverySlot') as any)
          .select('booked_count, max_vehicles').eq('id', newSlotId).single()
        if (!newSlot) return fail(res, 'Slot không tồn tại', 404)
        if (newSlot.booked_count >= newSlot.max_vehicles) return fail(res, 'Slot đã hết chỗ', 409)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('DeliverySlot') as any)
          .update({ booked_count: newSlot.booked_count + 1, updated_at: now })
          .eq('id', newSlotId)
      }
    }

    const updates: Record<string, unknown> = { updated_by: user?.emp_id || null, updated_at: now }
    if (slot_id       !== undefined) updates.slot_id       = slot_id
    if (license_plate !== undefined) updates.license_plate = license_plate
    if (driver_name   !== undefined) updates.driver_name   = driver_name
    if (driver_phone  !== undefined) updates.driver_phone  = driver_phone
    if (gdo_refs      !== undefined) updates.gdo_refs      = gdo_refs
    if (notes         !== undefined) updates.notes         = notes
    if (status        !== undefined) updates.status        = status

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('DeliveryBooking') as any)
      .update(updates)
      .eq('id', id)
      .select(BOOKING_SELECT)
      .single()

    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/tms/bookings/:id  (chỉ PENDING)
export async function deleteBooking(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from('DeliveryBooking') as any)
      .select('id, slot_id, status').eq('id', id).single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy booking', 404)
    if (existing.status !== 'PENDING') return fail(res, 'Chỉ có thể xóa booking đang PENDING', 400)

    // Giảm booked_count nếu đã chọn slot
    if (existing.slot_id) {
      const now = new Date().toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: slotRow } = await (supabase.from('DeliverySlot') as any)
        .select('booked_count').eq('id', existing.slot_id).single()
      if (slotRow && slotRow.booked_count > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('DeliverySlot') as any)
          .update({ booked_count: slotRow.booked_count - 1, updated_at: now })
          .eq('id', existing.slot_id)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('DeliveryBooking') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}
