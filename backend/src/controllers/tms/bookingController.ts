import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const BOOKING_SELECT = `
  *,
  ncc:TransportCompany!ncc_id(id, code, name),
  slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count)
`

// GET /api/tms/bookings?date=YYYY-MM-DD&warehouse_id=...&status=...
export async function listBookings(req: Request, res: Response) {
  try {
    const { date, warehouse_id, status } = req.query as Record<string, string>
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = (req as any).user?.ncc_id ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('DeliveryBooking') as any)
      .select(BOOKING_SELECT)
      .eq('date', date)
      .eq('warehouse_id', warehouse_id)
      .order('created_at')

    if (userNccId) {
      // ĐVVT: thấy booking của mình + PENDING chưa có ĐVVT (open for self-selection)
      q = q.or(`ncc_id.eq.${userNccId},and(ncc_id.is.null,status.eq.PENDING)`)
    }

    if (status) q = q.eq('status', status)

    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/bookings
export async function createBooking(req: Request, res: Response) {
  try {
    const { date, warehouse_id, npp_name, ncc_id, gdo_refs, notes,
            box_count, pallet_count, tonnage, warehouse_type, vehicle_type } = req.body
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('DeliveryBooking') as any)
      .insert({
        id: randomUUID(), date, warehouse_id,
        npp_name: npp_name || null,
        ncc_id: ncc_id || null,
        gdo_refs: gdo_refs || null,
        notes: notes || null,
        box_count: box_count ?? null,
        pallet_count: pallet_count ?? null,
        tonnage: tonnage ?? null,
        warehouse_type: warehouse_type || null,
        vehicle_type: vehicle_type || null,
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

// POST /api/tms/bookings/bulk
export async function bulkCreateBookings(req: Request, res: Response) {
  try {
    const { bookings } = req.body
    if (!Array.isArray(bookings) || !bookings.length) return fail(res, 'bookings phải là array không rỗng', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (bookings as any[])
      .filter(b => b.date && b.warehouse_id)
      .map(b => ({
        id: randomUUID(),
        date: b.date, warehouse_id: b.warehouse_id,
        npp_name: b.npp_name || null,
        ncc_id: b.ncc_id || null,
        gdo_refs: b.gdo_refs || null,
        notes: b.notes || null,
        box_count: b.box_count ?? null,
        pallet_count: b.pallet_count ?? null,
        tonnage: b.tonnage ?? null,
        warehouse_type: b.warehouse_type || null,
        vehicle_type: b.vehicle_type || null,
        status: 'PENDING',
        created_by: user?.emp_id || null,
        updated_by: user?.emp_id || null,
        created_at: now, updated_at: now,
      }))

    if (!rows.length) return fail(res, 'Không có dòng hợp lệ để import', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('DeliveryBooking') as any).insert(rows).select('id')
    if (error) return fail(res, error.message)
    return ok(res, { inserted: data.length, skipped: bookings.length - rows.length }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/tms/bookings/:id
export async function updateBooking(req: Request, res: Response) {
  try {
    const { id } = req.params
    const {
      slot_id, license_plate, driver_name, driver_phone,
      date, warehouse_id, npp_name, ncc_id: bodyNccId, gdo_refs, notes, status,
      box_count, pallet_count, tonnage, warehouse_type, vehicle_type,
    } = req.body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()
    const userNccId: string | null = user?.ncc_id ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from('DeliveryBooking') as any)
      .select('id, slot_id, status, ncc_id')
      .eq('id', id)
      .single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy booking', 404)

    // ĐVVT chỉ được chỉnh sửa booking của mình hoặc booking chưa có ĐVVT
    if (userNccId && existing.ncc_id && existing.ncc_id !== userNccId) {
      return fail(res, 'Bạn không có quyền chỉnh sửa booking này', 403)
    }

    const newSlotId = slot_id !== undefined ? slot_id : existing.slot_id
    const isChangingSlot = newSlotId !== existing.slot_id

    // Anti-fraud: không cho nhả slot khi đã ARRIVED hoặc DONE
    if (isChangingSlot && ['ARRIVED', 'DONE'].includes(existing.status as string)) {
      return fail(res, 'Không thể thay đổi khung giờ sau khi xe đã đến hoặc đã hoàn thành', 400)
    }

    if (isChangingSlot) {
      const nowMs = Date.now()

      if (existing.slot_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: oldSlot } = await (supabase.from('DeliverySlot') as any)
          .select('booked_count, date, time_from').eq('id', existing.slot_id).single()
        if (oldSlot) {
          // Kiểm tra giờ: không được đổi slot sau khi giờ cũ đã bắt đầu
          const slotStart = new Date(`${oldSlot.date}T${oldSlot.time_from}+07:00`).getTime()
          if (nowMs >= slotStart) {
            return fail(res, `Đã qua giờ ${String(oldSlot.time_from).slice(0, 5)}, không thể thay đổi khung giờ`, 400)
          }
          if (oldSlot.booked_count > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('DeliverySlot') as any)
              .update({ booked_count: oldSlot.booked_count - 1, updated_at: now })
              .eq('id', existing.slot_id)
          }
        }
      }

      if (newSlotId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newSlot } = await (supabase.from('DeliverySlot') as any)
          .select('booked_count, max_vehicles, date, time_from').eq('id', newSlotId).single()
        if (!newSlot) return fail(res, 'Slot không tồn tại', 404)
        // Không cho chọn slot đã qua giờ
        const newSlotStart = new Date(`${newSlot.date}T${newSlot.time_from}+07:00`).getTime()
        if (nowMs >= newSlotStart) {
          return fail(res, `Khung giờ ${String(newSlot.time_from).slice(0, 5)} đã qua, không thể đặt`, 400)
        }
        if (newSlot.booked_count >= newSlot.max_vehicles) return fail(res, 'Slot đã hết chỗ', 409)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('DeliverySlot') as any)
          .update({ booked_count: newSlot.booked_count + 1, updated_at: now })
          .eq('id', newSlotId)
      }
    }

    const updates: Record<string, unknown> = { updated_by: user?.sub || null, updated_at: now }
    if (slot_id         !== undefined) updates.slot_id         = slot_id
    if (license_plate   !== undefined) updates.license_plate   = license_plate
    if (driver_name     !== undefined) updates.driver_name     = driver_name
    if (driver_phone    !== undefined) updates.driver_phone    = driver_phone
    if (date            !== undefined) updates.date            = date
    if (warehouse_id    !== undefined) updates.warehouse_id    = warehouse_id
    if (npp_name        !== undefined) updates.npp_name        = npp_name
    if (gdo_refs        !== undefined) updates.gdo_refs        = gdo_refs
    if (notes           !== undefined) updates.notes           = notes
    if (status          !== undefined) updates.status          = status
    if (box_count       !== undefined) updates.box_count       = box_count
    if (pallet_count    !== undefined) updates.pallet_count    = pallet_count
    if (tonnage         !== undefined) updates.tonnage         = tonnage
    if (warehouse_type  !== undefined) updates.warehouse_type  = warehouse_type
    if (vehicle_type    !== undefined) updates.vehicle_type    = vehicle_type

    // Điều vận (manage_booking, không có ncc_id) được phép set/clear ncc_id (ví dụ: release → null)
    if (!userNccId && bodyNccId !== undefined) updates.ncc_id = bodyNccId || null
    // ĐVVT lần đầu fill booking chưa có ĐVVT → ghi nhận ĐVVT này
    if (userNccId && !existing.ncc_id) updates.ncc_id = userNccId

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

    if (existing.slot_id) {
      const nowStr = new Date().toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: slotRow } = await (supabase.from('DeliverySlot') as any)
        .select('booked_count').eq('id', existing.slot_id).single()
      if (slotRow && slotRow.booked_count > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('DeliverySlot') as any)
          .update({ booked_count: slotRow.booked_count - 1, updated_at: nowStr })
          .eq('id', existing.slot_id)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('DeliveryBooking') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}
