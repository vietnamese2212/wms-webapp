import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const ORDER_SELECT = `
  *,
  ncc:TransportCompany!ncc_id(id, code, name),
  vehicle_slots:TmsVehicleSlot(
    id, order_id, slot_id,
    slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count),
    license_plate, driver_name, driver_phone, status, booked_by,
    consolidation_group_id, is_consolidation_primary,
    created_at, updated_at
  )
`

// GET /api/tms/orders?date=YYYY-MM-DD&warehouse_id=...
export async function listOrders(req: Request, res: Response) {
  try {
    const { date, warehouse_id } = req.query as Record<string, string>
    if (!date) return fail(res, 'date là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = (req as any).user?.ncc_id ?? null
    if (!warehouse_id && !userNccId) return fail(res, 'warehouse_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('TmsOrder') as any)
      .select(ORDER_SELECT)
      .eq('date', date)
      .order('created_at')

    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
    if (userNccId)    q = q.eq('ncc_id', userNccId)

    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders
export async function createOrder(req: Request, res: Response) {
  try {
    const {
      order_code, date, warehouse_id, ncc_id, npp_name,
      vehicle_type, direction, warehouse_type,
      planned_boxes, planned_pallets, planned_tons,
      gdo_refs, notes, priority,
    } = req.body
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)
    if (!order_code) return fail(res, 'order_code là bắt buộc', 400)
    if (!direction)  return fail(res, 'direction là bắt buộc', 400)
    if (!ncc_id)     return fail(res, 'ĐVVT là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()
    const orderId = randomUUID()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: ordErr } = await (supabase.from('TmsOrder') as any).insert({
      id: orderId, order_code, date, warehouse_id,
      ncc_id: ncc_id || null, npp_name: npp_name || null,
      vehicle_type: vehicle_type || null, direction: direction || null,
      warehouse_type: warehouse_type || null,
      planned_boxes: planned_boxes ?? null, planned_pallets: planned_pallets ?? null,
      planned_tons: planned_tons ?? null,
      gdo_refs: gdo_refs || null, notes: notes || null,
      priority: priority === true || priority === 'true',
      status: 'PENDING',
      created_by: user?.emp_id || null, updated_by: user?.emp_id || null,
      created_at: now, updated_at: now,
    })
    if (ordErr) {
      if (ordErr.code === '23505') return fail(res, `Mã đơn "${order_code}" đã tồn tại`, 409)
      return fail(res, ordErr.message)
    }

    // Tạo 1 TmsVehicleSlot mặc định
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('TmsVehicleSlot') as any).insert({
      id: randomUUID(), order_id: orderId,
      status: 'PENDING', created_at: now, updated_at: now,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('TmsOrder') as any)
      .select(ORDER_SELECT).eq('id', orderId).single()
    if (error) return fail(res, error.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders/bulk
export async function bulkCreateOrders(req: Request, res: Response) {
  try {
    const { orders } = req.body
    if (!Array.isArray(orders) || !orders.length) return fail(res, 'orders phải là array không rỗng', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputList = orders as any[]

    // Check trùng order_code trong DB
    const incomingCodes = inputList.map(o => o.order_code).filter(Boolean) as string[]
    if (incomingCodes.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase.from('TmsOrder') as any)
        .select('order_code').in('order_code', incomingCodes)
      if (existing?.length) {
        const dupes = (existing as { order_code: string }[]).map(r => r.order_code).join(', ')
        return fail(res, `Mã đơn đã tồn tại: ${dupes}`)
      }
    }

    const orderRows = inputList
      .filter(o => o.date && o.warehouse_id && o.order_code)
      .map(o => ({
        id: randomUUID(),
        order_code: o.order_code,
        date: o.date, warehouse_id: o.warehouse_id,
        ncc_id: o.ncc_id || null, npp_name: o.npp_name || null,
        vehicle_type: o.vehicle_type || null, direction: o.direction || null,
        warehouse_type: o.warehouse_type || null,
        planned_boxes: o.planned_boxes ?? null, planned_pallets: o.planned_pallets ?? null,
        planned_tons: o.planned_tons ?? null,
        gdo_refs: o.gdo_refs || null, notes: o.notes || null,
        priority: o.priority === true || o.priority === 'true',
        status: 'PENDING',
        created_by: user?.emp_id || null, updated_by: user?.emp_id || null,
        created_at: now, updated_at: now,
      }))

    if (!orderRows.length) return fail(res, 'Không có dòng hợp lệ để import', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabase.from('TmsOrder') as any).insert(orderRows)
    if (insErr) {
      if (insErr.code === '23505') return fail(res, 'Mã đơn bị trùng, vui lòng kiểm tra lại file')
      return fail(res, insErr.message)
    }

    // Tạo 1 TmsVehicleSlot mặc định cho mỗi order
    const slotRows = orderRows.map(o => ({
      id: randomUUID(), order_id: o.id,
      status: 'PENDING', created_at: now, updated_at: now,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('TmsVehicleSlot') as any).insert(slotRows)

    return ok(res, { inserted: orderRows.length }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/tms/orders/:id  — điều vận sửa thông tin đơn
export async function updateOrder(req: Request, res: Response) {
  try {
    const { id } = req.params
    const {
      date, warehouse_id, ncc_id, npp_name,
      vehicle_type, direction, warehouse_type,
      planned_boxes, planned_pallets, planned_tons,
      gdo_refs, notes, status, priority,
    } = req.body

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from('TmsOrder') as any)
      .select('id').eq('id', id).single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy đơn hàng', 404)

    const updates: Record<string, unknown> = { updated_by: user?.emp_id || null, updated_at: now }
    if (date            !== undefined) updates.date            = date
    if (warehouse_id    !== undefined) updates.warehouse_id    = warehouse_id
    if (ncc_id          !== undefined) updates.ncc_id          = ncc_id || null
    if (npp_name        !== undefined) updates.npp_name        = npp_name || null
    if (vehicle_type    !== undefined) updates.vehicle_type    = vehicle_type || null
    if (direction       !== undefined) updates.direction       = direction || null
    if (warehouse_type  !== undefined) updates.warehouse_type  = warehouse_type || null
    if (planned_boxes   !== undefined) updates.planned_boxes   = planned_boxes ?? null
    if (planned_pallets !== undefined) updates.planned_pallets = planned_pallets ?? null
    if (planned_tons    !== undefined) updates.planned_tons    = planned_tons ?? null
    if (gdo_refs        !== undefined) updates.gdo_refs        = gdo_refs || null
    if (notes           !== undefined) updates.notes           = notes || null
    if (status          !== undefined) updates.status          = status
    if (priority        !== undefined) updates.priority        = priority === true || priority === 'true'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('TmsOrder') as any)
      .update(updates).eq('id', id).select(ORDER_SELECT).single()
    if (error) return fail(res, error.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/tms/orders/bulk-date  — đổi ngày hàng loạt (chỉ PENDING orders)
export async function bulkUpdateOrderDate(req: Request, res: Response) {
  try {
    const { ids, date } = req.body as { ids: string[]; date: string }
    if (!Array.isArray(ids) || !ids.length) return fail(res, 'ids phải là array không rỗng', 400)
    if (!date) return fail(res, 'date là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('TmsOrder') as any)
      .update({ date, updated_by: user?.emp_id || null, updated_at: now })
      .in('id', ids)
    if (error) return fail(res, error.message)
    return ok(res, { updated: ids.length })
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/tms/orders/:id  — chỉ xoá khi chưa có slot nào BOOKED+
export async function deleteOrder(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: slots } = await (supabase.from('TmsVehicleSlot') as any)
      .select('id, status').eq('order_id', id)
    const hasBooked = (slots ?? []).some((s: { status: string }) =>
      ['BOOKED','ARRIVED','DONE'].includes(s.status)
    )
    if (hasBooked) return fail(res, 'Không thể xoá đơn đã có xe đặt khung giờ', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('TmsOrder') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}
