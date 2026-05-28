import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'

function apiErr(res: Response, code: string, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } })
}

export async function listGateRegistrations(req: Request, res: Response) {
  const {
    date, date_from, date_to,
    warehouse_id, warehouse_type, vehicle_type,
    company_id, direction, status,
  } = req.query as Record<string, string | undefined>

  let q = supabase
    .from('gate_registrations')
    .select('*, booking_tms_order:TmsOrder!tms_order_id(npp_name, gdo_refs, planned_boxes, planned_pallets)')
    .order('date', { ascending: false })
    .order('registration_number', { ascending: true })

  if (date) {
    q = q.eq('date', date)
  } else {
    if (date_from) q = q.gte('date', date_from)
    if (date_to)   q = q.lte('date', date_to)
  }
  // Phân quyền kho
  const scopeWhs = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []
  if (scopeWhs.length > 0) q = q.in('warehouse_id', scopeWhs)

  if (warehouse_id)   q = q.eq('warehouse_id', warehouse_id)
  if (warehouse_type) q = q.eq('warehouse_type', warehouse_type)
  if (vehicle_type)   q = q.eq('vehicle_type', vehicle_type)
  if (company_id)     q = q.eq('company_id', company_id)
  if (direction)      q = q.eq('direction', direction)
  if (status)         q = q.eq('status', status)

  const { data, error } = await q
  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)
  return res.json({ success: true, data })
}

// Gợi ý booking phù hợp với xe (theo biển số + kho + loại xe + ngày + ĐVVT)
export async function suggestBooking(req: Request, res: Response) {
  const { date, license_plate, warehouse_id, warehouse_type, vehicle_type, direction, company_id, exclude_gate_id } =
    req.query as Record<string, string | undefined>

  if (!date || !license_plate || !warehouse_id) {
    return res.json({ success: true, data: [] })
  }

  // 1. Đếm gate_reg cùng filter để xác định vị trí (sort theo registered_at)
  let gateQ = supabase
    .from('gate_registrations')
    .select('id, registered_at')
    .eq('license_plate', license_plate)
    .eq('date', date)
    .eq('warehouse_id', warehouse_id)
    .order('registered_at', { ascending: true })
  if (direction)      gateQ = gateQ.eq('direction', direction)
  if (warehouse_type) gateQ = gateQ.eq('warehouse_type', warehouse_type)
  if (vehicle_type)   gateQ = gateQ.eq('vehicle_type', vehicle_type)
  if (company_id)     gateQ = gateQ.eq('company_id', company_id)

  const { data: existingGates } = await gateQ as { data: { id: string }[] | null }

  // Vị trí: tạo mới = count hiện có; edit = index của exclude_gate_id trong danh sách
  let position: number
  if (exclude_gate_id) {
    position = (existingGates ?? []).findIndex(g => g.id === exclude_gate_id)
    if (position === -1) position = (existingGates ?? []).length
  } else {
    position = (existingGates ?? []).length
  }

  // 2. Tìm TmsVehicleSlot theo biển số
  const { data: vslots, error } = await supabase
    .from('TmsVehicleSlot')
    .select(`
      id, order_id, slot_id, license_plate,
      order:TmsOrder!order_id (
        id, order_code, date, warehouse_id, warehouse_type, vehicle_type, direction,
        planned_boxes, planned_pallets, planned_tons, gdo_refs, priority, ncc_id
      ),
      slot:DeliverySlot!slot_id (time_from, time_to)
    `)
    .eq('license_plate', license_plate)

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  type VSlotRow = {
    id: string; order_id: string; slot_id: string | null; license_plate: string | null
    order: {
      id: string; order_code: string; date: string
      warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; direction: string | null
      planned_boxes: number | null; planned_pallets: number | null; planned_tons: number | null
      gdo_refs: string | null; priority: boolean; ncc_id: string | null
    } | null
    slot: { time_from: string; time_to: string } | null
  }

  // Filter rồi sort theo khung giờ booking (nhỏ → lớn)
  const filtered = (vslots as unknown as VSlotRow[])
    .filter(vs => {
      if (!vs.order || !vs.slot) return false   // bỏ booking chưa có slot
      if (vs.order.date !== date) return false
      if (vs.order.warehouse_id !== warehouse_id) return false
      if (direction && vs.order.direction !== direction) return false
      if (warehouse_type && vs.order.warehouse_type !== warehouse_type) return false
      if (vehicle_type && vs.order.vehicle_type !== vehicle_type) return false
      if (company_id && vs.order.ncc_id !== company_id) return false
      return true
    })
    .sort((a, b) => {
      const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
      return toMin(a.slot!.time_from) - toMin(b.slot!.time_from)
    })

  // Trả về đúng 1 booking tại vị trí tương ứng
  const match = filtered[position]
  if (!match) return res.json({ success: true, data: [] })

  return res.json({ success: true, data: [{
    tms_order_id:        match.order_id,
    tms_vehicle_slot_id: match.id,
    order_code:          match.order?.order_code ?? '',
    booking_slot_from:   match.slot?.time_from ?? null,
    booking_slot_to:     match.slot?.time_to ?? null,
    planned_boxes:       match.order?.planned_boxes ?? null,
    planned_pallets:     match.order?.planned_pallets ?? null,
    gdo_refs:            match.order?.gdo_refs ?? null,
    priority:            match.order?.priority ?? false,
  }] })
}

export async function createGateRegistration(req: Request, res: Response) {
  const user = (req as Request & { user?: { name?: string } }).user
  const userName = user?.name ?? null

  const {
    date, driver_name, phone,
    company_id, company_name_raw,
    vehicle_id, license_plate,
    direction, warehouse_id, warehouse_type, vehicle_type,
    content, return_pallet, seal_number, notes,
  } = req.body

  if (!date || !warehouse_id) {
    return apiErr(res, 'MISSING_FIELDS', 'date và warehouse_id là bắt buộc')
  }

  // Auto-increment registration_number cho ngày
  const { data: maxRow } = await supabase
    .from('gate_registrations')
    .select('registration_number')
    .eq('date', date)
    .order('registration_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const registration_number = ((maxRow as { registration_number: number } | null)?.registration_number ?? 0) + 1
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('gate_registrations')
    .insert({
      id: randomUUID(),
      date,
      registration_number,
      driver_name:        driver_name ?? null,
      phone:              phone ?? null,
      company_id:         company_id ?? null,
      company_name_raw:   company_name_raw ?? null,
      vehicle_id:         vehicle_id ?? null,
      license_plate:      license_plate ?? null,
      direction:          direction ?? null,
      warehouse_id,
      warehouse_type:     warehouse_type ?? null,
      vehicle_type:       vehicle_type ?? null,
      content:            content ?? null,
      return_pallet:      return_pallet ?? false,
      seal_number:        seal_number ?? null,
      notes:              notes ?? null,
      status:             'REGISTERED',
      priority:           false,
      registered_at:      now,
      registered_by:      userName,
      created_by:         userName,
      updated_by:         userName,
      updated_at:         now,
    })
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  // Tính lại vị trí booking cho tất cả gate trong nhóm (position-based assignment)
  const plate = (data as { license_plate: string | null }).license_plate
  if (plate) {
    await relinkAfterDelete(
      plate,
      date,
      warehouse_id,
      (direction ?? null) as string | null,
      (warehouse_type ?? null) as string | null,
      (vehicle_type ?? null) as string | null,
      (company_id ?? null) as string | null,
    )
  }

  return res.status(201).json({ success: true, data })
}

export async function updateGateRegistration(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const userName = user?.name ?? null

  const {
    date, driver_name, phone,
    company_id, company_name_raw,
    vehicle_id, license_plate,
    direction, warehouse_id, warehouse_type, vehicle_type,
    content, return_pallet, seal_number, notes,
  } = req.body

  const patch: Record<string, unknown> = {
    updated_by: userName,
    updated_at: new Date().toISOString(),
  }

  if (date !== undefined)             patch.date = date
  if (driver_name !== undefined)      patch.driver_name = driver_name
  if (phone !== undefined)            patch.phone = phone
  if (company_id !== undefined)       patch.company_id = company_id
  if (company_name_raw !== undefined) patch.company_name_raw = company_name_raw
  if (vehicle_id !== undefined)       patch.vehicle_id = vehicle_id
  if (license_plate !== undefined)    patch.license_plate = license_plate
  if (direction !== undefined)        patch.direction = direction
  if (warehouse_id !== undefined)     patch.warehouse_id = warehouse_id
  if (warehouse_type !== undefined)   patch.warehouse_type = warehouse_type
  if (vehicle_type !== undefined)     patch.vehicle_type = vehicle_type
  if (content !== undefined)          patch.content = content
  if (return_pallet !== undefined)    patch.return_pallet = return_pallet
  if (seal_number !== undefined)      patch.seal_number = seal_number
  if (notes !== undefined)            patch.notes = notes

  const { data, error } = await supabase
    .from('gate_registrations')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  // Tính lại vị trí booking sau khi sửa gate
  type GateRow = { license_plate: string | null; date: string; warehouse_id: string; direction: string | null; warehouse_type: string | null; vehicle_type: string | null; company_id: string | null }
  const g = data as GateRow
  if (g.license_plate && g.date && g.warehouse_id) {
    await relinkAfterDelete(g.license_plate, g.date, g.warehouse_id, g.direction, g.warehouse_type, g.vehicle_type, g.company_id)
  }

  return res.json({ success: true, data })
}

// Action: Gọi xe (NV Kho bấm)
export async function doCall(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const { custom_time } = req.body
  const now = new Date().toISOString()
  const ts = custom_time ? new Date(custom_time).toISOString() : now

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({
      status:     'CALLED',
      called_at:  ts,
      called_by:  user?.name ?? null,
      updated_by: user?.name ?? null,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)
  return res.json({ success: true, data })
}

// Action: Xác nhận xe vào (Bảo vệ bấm)
export async function doEntry(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const { custom_time } = req.body
  const now = new Date().toISOString()
  const ts = custom_time ? new Date(custom_time).toISOString() : now

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id')
    .eq('id', id)
    .single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({
      status:     'IN',
      entry_at:   ts,
      entry_by:   user?.name ?? null,
      updated_by: user?.name ?? null,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  if ((reg as { tms_order_id: string | null }).tms_order_id) {
    await supabase
      .from('TmsOrder')
      .update({ export_status: 'Đang xuất', updated_at: now })
      .eq('id', (reg as { tms_order_id: string }).tms_order_id)
  }

  return res.json({ success: true, data })
}

// Action: Xác nhận xe ra (Bảo vệ bấm) — kèm tải trọng tuỳ chọn
export async function doExit(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const { load_capacity, custom_time } = req.body
  const now = new Date().toISOString()
  const ts = custom_time ? new Date(custom_time).toISOString() : now

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id')
    .eq('id', id)
    .single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  const patch: Record<string, unknown> = {
    status:     'COMPLETED',
    exit_at:    ts,
    exit_by:    user?.name ?? null,
    updated_by: user?.name ?? null,
    updated_at: now,
  }
  if (load_capacity !== undefined && load_capacity !== null && load_capacity !== '') {
    patch.load_capacity = Number(load_capacity)
  }

  const { data, error } = await supabase
    .from('gate_registrations')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  if ((reg as { tms_order_id: string | null }).tms_order_id) {
    await supabase
      .from('TmsOrder')
      .update({ export_status: 'Đã xuất', updated_at: now })
      .eq('id', (reg as { tms_order_id: string }).tms_order_id)
  }

  return res.json({ success: true, data })
}

// Revert: Huỷ gọi xe → về REGISTERED
export async function doRevertCall(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({
      status:     'REGISTERED',
      called_at:  null,
      called_by:  null,
      updated_by: user?.name ?? null,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)
  return res.json({ success: true, data })
}

// Revert: Huỷ xác nhận vào → về CALLED (nếu đã gọi) hoặc REGISTERED
export async function doRevertEntry(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const now = new Date().toISOString()

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id, called_at')
    .eq('id', id)
    .single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  const targetStatus = (reg as { called_at: string | null }).called_at ? 'CALLED' : 'REGISTERED'

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({
      status:     targetStatus,
      entry_at:   null,
      entry_by:   null,
      updated_by: user?.name ?? null,
      updated_at: now,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  if ((reg as { tms_order_id: string | null }).tms_order_id) {
    await supabase
      .from('TmsOrder')
      .update({ export_status: 'Đăng ký', updated_at: now })
      .eq('id', (reg as { tms_order_id: string }).tms_order_id)
  }

  return res.json({ success: true, data })
}

// Revert: Huỷ xác nhận ra → về IN
export async function doRevertExit(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const now = new Date().toISOString()

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id')
    .eq('id', id)
    .single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({
      status:        'IN',
      exit_at:       null,
      exit_by:       null,
      load_capacity: null,
      updated_by:    user?.name ?? null,
      updated_at:    now,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  if ((reg as { tms_order_id: string | null }).tms_order_id) {
    await supabase
      .from('TmsOrder')
      .update({ export_status: 'Đang xuất', updated_at: now })
      .eq('id', (reg as { tms_order_id: string }).tms_order_id)
  }

  return res.json({ success: true, data })
}

// Helper: tái liên kết booking cho tất cả gate_reg theo position (gọi khi xóa gate hoặc booking thay đổi)
export async function relinkAfterDelete(
  license_plate: string, date: string, warehouse_id: string,
  direction: string | null, warehouse_type: string | null, vehicle_type: string | null,
  company_id: string | null = null
) {
  const now = new Date().toISOString()

  // Gate regs còn lại, sort theo registered_at
  let gateQ = supabase
    .from('gate_registrations')
    .select('id, status, tms_order_id')
    .eq('license_plate', license_plate)
    .eq('date', date)
    .eq('warehouse_id', warehouse_id)
    .order('registered_at', { ascending: true })
  if (direction !== null)      gateQ = gateQ.eq('direction', direction)
  else                         gateQ = gateQ.is('direction', null)
  if (warehouse_type !== null) gateQ = gateQ.eq('warehouse_type', warehouse_type)
  else                         gateQ = gateQ.is('warehouse_type', null)
  if (vehicle_type !== null)   gateQ = gateQ.eq('vehicle_type', vehicle_type)
  else                         gateQ = gateQ.is('vehicle_type', null)
  if (company_id !== null)     gateQ = gateQ.eq('company_id', company_id)
  else                         gateQ = gateQ.is('company_id', null)

  const { data: gates } = await gateQ as { data: { id: string; status: string; tms_order_id: string | null }[] | null }
  if (!gates || gates.length === 0) return

  // Booking slots matching, sort theo time_from
  type RelinkSlot = {
    id: string; order_id: string
    order: { order_code: string; date: string; warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; direction: string | null; priority: boolean; ncc_id: string | null } | null
    slot: { time_from: string; time_to: string } | null
  }
  const { data: vslots } = await supabase
    .from('TmsVehicleSlot')
    .select(`id, order_id, order:TmsOrder!order_id(order_code, date, warehouse_id, warehouse_type, vehicle_type, direction, priority, ncc_id), slot:DeliverySlot!slot_id(time_from, time_to)`)
    .eq('license_plate', license_plate)

  const filtered = ((vslots ?? []) as unknown as RelinkSlot[])
    .filter(vs => {
      if (!vs.order || !vs.slot) return false   // bỏ booking chưa có slot
      if (vs.order.date !== date || vs.order.warehouse_id !== warehouse_id) return false
      if (direction !== null && vs.order.direction !== direction) return false
      if (warehouse_type !== null && vs.order.warehouse_type !== warehouse_type) return false
      if (vehicle_type !== null && vs.order.vehicle_type !== vehicle_type) return false
      if (company_id !== null && vs.order.ncc_id !== company_id) return false
      return true
    })
    .sort((a, b) => {
      const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
      return toMin(a.slot!.time_from) - toMin(b.slot!.time_from)
    })

  // Tập hợp order_id mới sau khi relink (để phát hiện order cũ bị mất gate)
  const newOrderIds = new Set(filtered.slice(0, gates.length).map(s => s?.order_id).filter(Boolean))

  await Promise.all(gates.map((gate, i) => {
    const match = filtered[i]
    const patch = match ? {
      tms_order_id:        match.order_id,
      tms_vehicle_slot_id: match.id,
      booking_order_code:  match.order?.order_code ?? null,
      booking_slot_from:   match.slot?.time_from ?? null,
      booking_slot_to:     match.slot?.time_to ?? null,
      priority:            match.order?.priority ?? false,
      updated_at:          now,
    } : {
      tms_order_id: null, tms_vehicle_slot_id: null,
      booking_order_code: null, booking_slot_from: null, booking_slot_to: null,
      priority: false, updated_at: now,
    }
    const ops: Promise<unknown>[] = [
      supabase.from('gate_registrations').update(patch).eq('id', gate.id),
    ]
    // Cập nhật export_status của TmsOrder mới được link
    if (match && match.order_id !== gate.tms_order_id) {
      const exportStatus =
        gate.status === 'IN'        ? 'Đang xuất' :
        gate.status === 'COMPLETED' ? 'Đã xuất'   : 'Đăng ký'
      ops.push(
        supabase.from('TmsOrder')
          .update({ export_status: exportStatus, updated_at: now })
          .eq('id', match.order_id)
      )
    }
    // Xóa export_status của TmsOrder cũ nếu không còn gate nào trong nhóm này link đến nó
    if (gate.tms_order_id && !newOrderIds.has(gate.tms_order_id)) {
      ops.push(
        supabase.from('TmsOrder')
          .update({ export_status: null, updated_at: now })
          .eq('id', gate.tms_order_id)
      )
    }
    return Promise.all(ops)
  }))
}

export async function deleteGateRegistration(req: Request, res: Response) {
  const { id } = req.params

  // Lấy thông tin trước khi xóa để re-link sau
  const { data: reg } = await supabase
    .from('gate_registrations')
    .select('license_plate, date, warehouse_id, direction, warehouse_type, vehicle_type, company_id, tms_order_id')
    .eq('id', id)
    .maybeSingle() as { data: { license_plate: string | null; date: string; warehouse_id: string; direction: string | null; warehouse_type: string | null; vehicle_type: string | null; company_id: string | null; tms_order_id: string | null } | null }

  const deletedOrderId = reg?.tms_order_id ?? null

  const { error } = await supabase
    .from('gate_registrations')
    .delete()
    .eq('id', id)

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  // Re-link gate_regs còn lại vào đúng vị trí booking
  if (reg?.license_plate && reg?.date && reg?.warehouse_id) {
    await relinkAfterDelete(
      reg.license_plate, reg.date, reg.warehouse_id,
      reg.direction, reg.warehouse_type, reg.vehicle_type, reg.company_id ?? null,
    )
  }

  // Nếu gate bị xóa là gate cuối cùng link tới đơn đó → clear export_status
  if (deletedOrderId) {
    const now = new Date().toISOString()
    const countResult = await supabase
      .from('gate_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tms_order_id', deletedOrderId)
    const remaining = (countResult as unknown as { count: number | null }).count
    if ((remaining ?? 0) === 0) {
      await supabase.from('TmsOrder')
        .update({ export_status: null, updated_at: now })
        .eq('id', deletedOrderId)
    }
  }

  return res.json({ success: true })
}
