import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

// Đếm số TmsVehicleSlot khác đơn có cùng (slot_id, license_plate) — dùng để tránh double-count booked_count
// khi 1 xe vật lý chạy nhiều ĐƠN KHÁC NHAU trong cùng khung giờ (consolidation).
// Xe phụ cùng đơn (excludeOrderId) KHÔNG bị loại — mỗi xe phụ luôn tính là 1 slot riêng.
async function countSameBooking(slotId: string, licensePlate: string, excludeId: string, excludeOrderId?: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('TmsVehicleSlot') as any)
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slotId)
    .eq('license_plate', licensePlate)
    .neq('id', excludeId)
  if (excludeOrderId) q = q.neq('order_id', excludeOrderId)
  const { count } = await q
  return count ?? 0
}

// POST /api/tms/orders/:orderId/vehicle-slots  — thêm xe cho đơn (split delivery)
export async function addVehicleSlot(req: Request, res: Response) {
  try {
    const { orderId } = req.params
    const now = new Date().toISOString()

    // Kiểm tra order tồn tại
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order, error: ordErr } = await (supabase.from('TmsOrder') as any)
      .select('id').eq('id', orderId).single()
    if (ordErr || !order) return fail(res, 'Không tìm thấy đơn hàng', 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('TmsVehicleSlot') as any)
      .insert({ id: randomUUID(), order_id: orderId, status: 'PENDING', created_at: now, updated_at: now })
      .select('*, slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count)')
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/tms/vehicle-slots/:id  — ĐVVT book slot, điền biển số, SĐT
export async function updateVehicleSlot(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { slot_id, license_plate, driver_name, driver_phone, status } = req.body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from('TmsVehicleSlot') as any)
      .select('id, slot_id, status, order_id, license_plate').eq('id', id).single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy vehicle slot', 404)

    // Không cho thay đổi slot sau ARRIVED/DONE
    if (['ARRIVED','DONE'].includes(existing.status as string) && slot_id !== undefined) {
      return fail(res, 'Không thể thay đổi khung giờ sau khi xe đã đến hoặc hoàn thành', 400)
    }

    const newSlotId = slot_id !== undefined ? slot_id : existing.slot_id
    const isChangingSlot = newSlotId !== existing.slot_id

    if (isChangingSlot) {
      const nowMs = Date.now()

      // Giải phóng slot cũ
      if (existing.slot_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: oldSlot } = await (supabase.from('DeliverySlot') as any)
          .select('date, time_from').eq('id', existing.slot_id).single()
        if (oldSlot) {
          const slotStart = new Date(`${oldSlot.date}T${oldSlot.time_from}+07:00`).getTime()
          if (nowMs >= slotStart) {
            return fail(res, `Đã qua giờ ${String(oldSlot.time_from).slice(0, 5)}, không thể thay đổi khung giờ`, 400)
          }
          // Chỉ decrement nếu không còn booking nào khác cùng (slot, biển số) — tránh giảm oan khi 1 xe nhiều đơn
          const oldPlate = existing.license_plate as string | null
          const othersInOldSlot = oldPlate ? await countSameBooking(existing.slot_id, oldPlate, id, existing.order_id as string) : 0
          if (!oldPlate || othersInOldSlot === 0) {
            await supabase.rpc('try_book_slot', { p_slot_id: existing.slot_id, p_delta: -1 })
          }
        }
      }

      // Chiếm slot mới
      if (newSlotId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newSlot } = await (supabase.from('DeliverySlot') as any)
          .select('date, time_from').eq('id', newSlotId).single()
        if (!newSlot) return fail(res, 'Slot không tồn tại', 404)
        const newSlotStart = new Date(`${newSlot.date}T${newSlot.time_from}+07:00`).getTime()
        if (nowMs >= newSlotStart) {
          return fail(res, `Khung giờ ${String(newSlot.time_from).slice(0, 5)} đã qua, không thể đặt`, 400)
        }
        // Biển số sẽ được set sau update — dùng giá trị incoming (nếu có) hoặc existing
        const newPlate = license_plate !== undefined ? (license_plate || null) : (existing.license_plate as string | null)
        const othersInNewSlot = newPlate ? await countSameBooking(newSlotId, newPlate, id, existing.order_id as string) : 0
        // Chỉ increment nếu xe này chưa được đếm trong slot (tránh double-count khi 1 xe nhiều đơn)
        if (!newPlate || othersInNewSlot === 0) {
          const { data: booked } = await supabase.rpc('try_book_slot', { p_slot_id: newSlotId, p_delta: 1 })
          if (!booked) return fail(res, 'Slot đã hết chỗ', 409)
        }
      }
    }

    const updates: Record<string, unknown> = { booked_by: user?.emp_id || null, updated_at: now }
    if (slot_id       !== undefined) updates.slot_id       = slot_id
    if (license_plate !== undefined) updates.license_plate = license_plate || null
    if (driver_name   !== undefined) updates.driver_name   = driver_name || null
    if (driver_phone  !== undefined) updates.driver_phone  = driver_phone || null
    if (status        !== undefined) updates.status        = status
    else if (isChangingSlot) {
      updates.status = newSlotId && license_plate !== undefined
        ? (license_plate ? 'BOOKED' : 'PENDING')
        : (newSlotId ? 'BOOKED' : 'PENDING')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('TmsVehicleSlot') as any)
      .update(updates).eq('id', id)
      .select('*, slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count)')
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/tms/vehicle-slots/:id  — xoá xe khỏi đơn (chỉ khi PENDING)
export async function deleteVehicleSlot(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from('TmsVehicleSlot') as any)
      .select('id, slot_id, status, order_id').eq('id', id).single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy vehicle slot', 404)
    if (existing.status !== 'PENDING') return fail(res, 'Chỉ xoá được xe chưa đặt khung giờ', 400)

    // Không cho xoá slot duy nhất của đơn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: siblings } = await (supabase.from('TmsVehicleSlot') as any)
      .select('id').eq('order_id', existing.order_id)
    if ((siblings ?? []).length <= 1) return fail(res, 'Không thể xoá xe duy nhất của đơn hàng', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('TmsVehicleSlot') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/tms/vehicle-slots/:id/release — trả lại: xoá slot+biển số+sdt, giữ ĐVVT
export async function releaseVehicleSlot(req: Request, res: Response) {
  try {
    const { id } = req.params
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from('TmsVehicleSlot') as any)
      .select('id, slot_id, status, order_id, license_plate').eq('id', id).single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy vehicle slot', 404)

    if (existing.slot_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: oldSlot } = await (supabase.from('DeliverySlot') as any)
        .select('date, time_from').eq('id', existing.slot_id).single()
      if (oldSlot) {
        const slotStart = new Date(`${oldSlot.date}T${oldSlot.time_from}+07:00`).getTime()
        if (Date.now() >= slotStart) {
          return fail(res, 'Đã qua giờ, không thể trả lại khung giờ', 400)
        }
        // Chỉ decrement nếu không còn đơn khác cùng (slot, biển số) — tránh giảm oan khi 1 xe nhiều đơn
        const plate = existing.license_plate as string | null
        const othersInSlot = plate ? await countSameBooking(existing.slot_id, plate, id, existing.order_id as string) : 0
        if (!plate || othersInSlot === 0) {
          await supabase.rpc('try_book_slot', { p_slot_id: existing.slot_id, p_delta: -1 })
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('TmsVehicleSlot') as any)
      .update({ slot_id: null, license_plate: null, driver_phone: null, status: 'PENDING', updated_at: now })
      .eq('id', id)
      .select('*, slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count)')
      .single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}
