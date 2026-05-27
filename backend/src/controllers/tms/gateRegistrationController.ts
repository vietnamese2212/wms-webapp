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
    .select('*')
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

// Gợi ý booking phù hợp với xe (theo biển số + kho + loại xe + ngày)
export async function suggestBooking(req: Request, res: Response) {
  const { date, license_plate, warehouse_id, warehouse_type, vehicle_type, exclude_gate_id } =
    req.query as Record<string, string | undefined>

  if (!date || !license_plate || !warehouse_id) {
    return res.json({ success: true, data: [] })
  }

  // Slot IDs đã được link bởi gate registration khác (tránh double-link)
  let linkedQ = supabase
    .from('gate_registrations')
    .select('tms_vehicle_slot_id')
    .not('tms_vehicle_slot_id', 'is', null)
  if (exclude_gate_id) linkedQ = linkedQ.neq('id', exclude_gate_id)

  const { data: linkedRows } = await linkedQ
  const linkedSlotIds = (linkedRows ?? [])
    .map((r: { tms_vehicle_slot_id: string | null }) => r.tms_vehicle_slot_id)
    .filter(Boolean) as string[]

  // Tìm TmsVehicleSlot theo biển số
  const { data: vslots, error } = await supabase
    .from('TmsVehicleSlot')
    .select(`
      id,
      order_id,
      slot_id,
      license_plate,
      order:TmsOrder!order_id (
        id, order_code, date, warehouse_id, warehouse_type, vehicle_type,
        planned_boxes, planned_pallets, planned_tons, gdo_refs, priority
      ),
      slot:DeliverySlot!slot_id (time_from, time_to)
    `)
    .eq('license_plate', license_plate)

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  type VSlotRow = {
    id: string
    order_id: string
    slot_id: string | null
    license_plate: string | null
    order: {
      id: string; order_code: string; date: string
      warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null
      planned_boxes: number | null; planned_pallets: number | null; planned_tons: number | null
      gdo_refs: string | null; priority: boolean
    } | null
    slot: { time_from: string; time_to: string } | null
  }

  const suggestions = (vslots as unknown as VSlotRow[] ?? [])
    .filter(vs => {
      if (!vs.order) return false
      // Cho phép xe đến muộn tối đa 1 ngày (booking ngày hôm trước vẫn match)
      const diffDays = (new Date(date).getTime() - new Date(vs.order.date).getTime()) / 86400000
      if (diffDays < 0 || diffDays > 1) return false
      if (vs.order.warehouse_id !== warehouse_id) return false
      if (warehouse_type && vs.order.warehouse_type !== warehouse_type) return false
      if (vehicle_type && vs.order.vehicle_type !== vehicle_type) return false
      if (linkedSlotIds.includes(vs.id)) return false
      return true
    })
    .sort((a, b) => {
      const ta = a.slot?.time_from ?? '99:99'
      const tb = b.slot?.time_from ?? '99:99'
      return ta.localeCompare(tb)
    })
    .map(vs => ({
      tms_order_id:        vs.order_id,
      tms_vehicle_slot_id: vs.id,
      order_code:          vs.order?.order_code ?? '',
      booking_slot_from:   vs.slot?.time_from ?? null,
      booking_slot_to:     vs.slot?.time_to ?? null,
      planned_boxes:       vs.order?.planned_boxes ?? null,
      planned_pallets:     vs.order?.planned_pallets ?? null,
      gdo_refs:            vs.order?.gdo_refs ?? null,
      priority:            vs.order?.priority ?? false,
    }))

  return res.json({ success: true, data: suggestions })
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
    priority,
    tms_order_id, tms_vehicle_slot_id,
    booking_order_code, booking_slot_from, booking_slot_to,
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
      priority:           priority ?? false,
      registered_at:      now,
      registered_by:      userName,
      tms_order_id:       tms_order_id ?? null,
      tms_vehicle_slot_id: tms_vehicle_slot_id ?? null,
      booking_order_code: booking_order_code ?? null,
      booking_slot_from:  booking_slot_from ?? null,
      booking_slot_to:    booking_slot_to ?? null,
      created_by:         userName,
      updated_by:         userName,
      updated_at:         now,
    })
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  // Cập nhật export_status của TmsOrder khi gate được tạo và có link booking
  if (tms_order_id) {
    await supabase
      .from('TmsOrder')
      .update({ export_status: 'Đăng ký', updated_at: now })
      .eq('id', tms_order_id)
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
    priority,
    tms_order_id, tms_vehicle_slot_id,
    booking_order_code, booking_slot_from, booking_slot_to,
  } = req.body

  const patch: Record<string, unknown> = {
    updated_by: userName,
    updated_at: new Date().toISOString(),
  }

  if (date !== undefined)                patch.date = date
  if (driver_name !== undefined)         patch.driver_name = driver_name
  if (phone !== undefined)               patch.phone = phone
  if (company_id !== undefined)          patch.company_id = company_id
  if (company_name_raw !== undefined)    patch.company_name_raw = company_name_raw
  if (vehicle_id !== undefined)          patch.vehicle_id = vehicle_id
  if (license_plate !== undefined)       patch.license_plate = license_plate
  if (direction !== undefined)           patch.direction = direction
  if (warehouse_id !== undefined)        patch.warehouse_id = warehouse_id
  if (warehouse_type !== undefined)      patch.warehouse_type = warehouse_type
  if (vehicle_type !== undefined)        patch.vehicle_type = vehicle_type
  if (content !== undefined)             patch.content = content
  if (return_pallet !== undefined)       patch.return_pallet = return_pallet
  if (seal_number !== undefined)         patch.seal_number = seal_number
  if (notes !== undefined)               patch.notes = notes
  if (priority !== undefined)            patch.priority = priority
  if (tms_order_id !== undefined)        patch.tms_order_id = tms_order_id
  if (tms_vehicle_slot_id !== undefined) patch.tms_vehicle_slot_id = tms_vehicle_slot_id
  if (booking_order_code !== undefined)  patch.booking_order_code = booking_order_code
  if (booking_slot_from !== undefined)   patch.booking_slot_from = booking_slot_from
  if (booking_slot_to !== undefined)     patch.booking_slot_to = booking_slot_to

  const { data, error } = await supabase
    .from('gate_registrations')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)
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

export async function deleteGateRegistration(req: Request, res: Response) {
  const { id } = req.params

  const { error } = await supabase
    .from('gate_registrations')
    .delete()
    .eq('id', id)

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)
  return res.json({ success: true })
}
