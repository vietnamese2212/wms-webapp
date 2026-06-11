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

// Gợi ý booking phù hợp với xe — nhóm theo slot_id để hỗ trợ nhiều đơn/xe
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
      id, order_id, slot_id, license_plate, is_consolidation_primary,
      order:TmsOrder!order_id (
        id, order_code, date, warehouse_id, warehouse_type, vehicle_type, direction,
        planned_boxes, planned_pallets, planned_tons, gdo_refs, npp_name, priority, ncc_id
      ),
      slot:DeliverySlot!slot_id (time_from, time_to)
    `)
    .eq('license_plate', license_plate)

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  type VSlotRow = {
    id: string; order_id: string; slot_id: string | null; license_plate: string | null
    is_consolidation_primary: boolean
    order: {
      id: string; order_code: string; date: string
      warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; direction: string | null
      planned_boxes: number | null; planned_pallets: number | null; planned_tons: number | null
      gdo_refs: string | null; npp_name: string | null; priority: boolean; ncc_id: string | null
    } | null
    slot: { time_from: string; time_to: string } | null
  }

  // Filter theo criteria của gate → xác định slot_id hợp lệ
  const allVslots = vslots as unknown as VSlotRow[]
  const filtered = allVslots.filter(vs => {
    if (!vs.order || !vs.slot) return false
    if (vs.order.date !== date) return false
    if (vs.order.warehouse_id !== warehouse_id) return false
    if (direction && vs.order.direction !== direction) return false
    if (warehouse_type && vs.order.warehouse_type !== warehouse_type) return false
    if (vehicle_type && vs.order.vehicle_type !== vehicle_type) return false
    if (company_id !== null && company_id !== undefined && vs.order.ncc_id !== company_id) return false
    return true
  })

  // Tập hợp slot_id từ matched VSlots → dùng để expand group (gom đủ đơn ghép cùng chuyến)
  const matchedSlotIds = new Set<string>(
    filtered.map(vs => vs.slot_id).filter((x): x is string => !!x)
  )

  // Nhóm theo slot_id — gom ALL VSlot cùng slot (kể cả đơn có vehicle_type khác nhau)
  const slotGroups = new Map<string, VSlotRow[]>()
  for (const vs of allVslots) {
    if (!vs.slot_id || !matchedSlotIds.has(vs.slot_id) || !vs.order || !vs.slot) continue
    if (!slotGroups.has(vs.slot_id)) slotGroups.set(vs.slot_id, [])
    slotGroups.get(vs.slot_id)!.push(vs)
  }

  // Sort groups theo time_from của group
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
  const sortedGroups = [...slotGroups.values()]
    .filter(g => g[0].slot)
    .sort((a, b) => toMin(a[0].slot!.time_from) - toMin(b[0].slot!.time_from))

  // Lấy group tại đúng vị trí
  const group = sortedGroups[position]
  if (!group) return res.json({ success: true, data: [] })

  // Đơn chính = is_consolidation_primary=true, fallback = group[0]
  const primaryVSlot = group.find(vs => vs.is_consolidation_primary) ?? group[0]

  // Aggregate thông tin của group — dùng '\n' để frontend có thể split theo từng đơn
  const orderCodes   = group.map(vs => vs.order?.order_code ?? '').filter(Boolean).join('\n')
  const nppNames     = group.map(vs => vs.order?.npp_name ?? '').join('\n')
  const gdoRefs      = group.map(vs => vs.order?.gdo_refs ?? '').join('\n')
  const plannedBoxes = group.map(vs => vs.order?.planned_boxes).filter(x => x != null).join(', ')
  const plannedPals  = group.map(vs => vs.order?.planned_pallets).filter(x => x != null).join(', ')

  return res.json({ success: true, data: [{
    tms_order_id:        primaryVSlot.order_id,
    tms_vehicle_slot_id: primaryVSlot.id,
    order_code:          orderCodes,
    booking_slot_from:   group[0].slot?.time_from ?? null,
    booking_slot_to:     group[0].slot?.time_to ?? null,
    planned_boxes:       plannedBoxes || null,
    planned_pallets:     plannedPals || null,
    gdo_refs:            gdoRefs || null,
    npp_names:           nppNames || null,
    priority:            group.some(vs => vs.order?.priority ?? false),
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

  // Tính lại vị trí booking cho tất cả gate trong nhóm
  const plate = (data as { license_plate: string | null }).license_plate
  if (plate) {
    await relinkAfterDelete(
      plate, date, warehouse_id,
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

  // Đọc trạng thái cũ TRƯỚC khi update để biết biển số cũ (cần relink nếu biển đổi)
  type GateRow = { license_plate: string | null; date: string; warehouse_id: string; direction: string | null; warehouse_type: string | null; vehicle_type: string | null; company_id: string | null }
  const { data: before } = await supabase
    .from('gate_registrations')
    .select('license_plate, date, warehouse_id, direction, warehouse_type, vehicle_type, company_id')
    .eq('id', id)
    .single() as { data: GateRow | null }

  const patch: Record<string, unknown> = {
    updated_by: userName,
    updated_at: new Date().toISOString(),
  }

  if (date !== undefined)             patch.date = date

  // Khi đổi ngày → cấp registration_number mới cho ngày đích (tránh duplicate key)
  if (date !== undefined && before && date !== before.date) {
    const { data: maxRow } = await supabase
      .from('gate_registrations')
      .select('registration_number')
      .eq('date', date)
      .order('registration_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    patch.registration_number = ((maxRow as { registration_number: number } | null)?.registration_number ?? 0) + 1
  }
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

  const g = data as GateRow

  // Relink biển mới
  if (g.license_plate && g.date && g.warehouse_id) {
    await relinkAfterDelete(g.license_plate, g.date, g.warehouse_id, g.direction, g.warehouse_type, g.vehicle_type, g.company_id)
  }

  // Nếu biển số thay đổi → relink thêm biển cũ để recalculate export_status cho các order còn gắn với biển cũ
  const plateChanged = before && license_plate !== undefined && before.license_plate !== g.license_plate
  if (plateChanged && before!.license_plate && before!.date && before!.warehouse_id) {
    await relinkAfterDelete(before!.license_plate, before!.date, before!.warehouse_id, before!.direction, before!.warehouse_type, before!.vehicle_type, before!.company_id)
  }

  return res.json({ success: true, data })
}

// ── Action handlers: Gọi xe, Xe vào, Xe ra, Revert

export async function doCall(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const { custom_time } = req.body
  const now = new Date().toISOString()
  const ts = custom_time ? new Date(custom_time).toISOString() : now

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({ status: 'CALLED', called_at: ts, called_by: user?.name ?? null, updated_by: user?.name ?? null, updated_at: now })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)
  return res.json({ success: true, data })
}

export async function doEntry(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const { custom_time } = req.body
  const now = new Date().toISOString()
  const ts = custom_time ? new Date(custom_time).toISOString() : now

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id, tms_order_ids, tms_vehicle_slot_id')
    .eq('id', id).single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({ status: 'IN', entry_at: ts, entry_by: user?.name ?? null, updated_by: user?.name ?? null, updated_at: now })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  const r = reg as { tms_order_id: string | null; tms_order_ids: string | null; tms_vehicle_slot_id: string | null }
  const allOrderIds = getAllOrderIds(r)
  await Promise.all([
    ...allOrderIds.map(oid => supabase.from('TmsOrder').update({ export_status: 'Đang xuất', updated_at: now }).eq('id', oid)),
    ...(r.tms_vehicle_slot_id ? [updateVSlotGateStatus(r.tms_vehicle_slot_id, { gate_export_status: 'Đang xuất', gate_entry_at: ts, updated_at: now })] : []),
  ])

  return res.json({ success: true, data })
}

export async function doExit(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const { load_capacity, custom_time } = req.body
  const now = new Date().toISOString()
  const ts = custom_time ? new Date(custom_time).toISOString() : now

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id, tms_order_ids, tms_vehicle_slot_id')
    .eq('id', id).single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  const patch: Record<string, unknown> = {
    status: 'COMPLETED', exit_at: ts, exit_by: user?.name ?? null,
    updated_by: user?.name ?? null, updated_at: now,
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

  const r = reg as { tms_order_id: string | null; tms_order_ids: string | null; tms_vehicle_slot_id: string | null }
  const allOrderIds = getAllOrderIds(r)
  await Promise.all([
    ...allOrderIds.map(oid => supabase.from('TmsOrder').update({ export_status: 'Đã xuất', updated_at: now }).eq('id', oid)),
    ...(r.tms_vehicle_slot_id ? [updateVSlotGateStatus(r.tms_vehicle_slot_id, { gate_export_status: 'Đã xuất', gate_exit_at: ts, updated_at: now })] : []),
  ])

  return res.json({ success: true, data })
}

export async function doRevertCall(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({ status: 'REGISTERED', called_at: null, called_by: null, updated_by: user?.name ?? null, updated_at: now })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)
  return res.json({ success: true, data })
}

export async function doRevertEntry(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const now = new Date().toISOString()

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id, tms_order_ids, tms_vehicle_slot_id, called_at')
    .eq('id', id).single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  const targetStatus = (reg as { called_at: string | null }).called_at ? 'CALLED' : 'REGISTERED'

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({ status: targetStatus, entry_at: null, entry_by: null, updated_by: user?.name ?? null, updated_at: now })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  const r = reg as { tms_order_id: string | null; tms_order_ids: string | null; tms_vehicle_slot_id: string | null }
  const allOrderIds = getAllOrderIds(r)
  await Promise.all([
    ...allOrderIds.map(oid => supabase.from('TmsOrder').update({ export_status: 'Đăng ký', updated_at: now }).eq('id', oid)),
    ...(r.tms_vehicle_slot_id ? [updateVSlotGateStatus(r.tms_vehicle_slot_id, { gate_export_status: 'Đăng ký', gate_entry_at: null, updated_at: now })] : []),
  ])

  return res.json({ success: true, data })
}

export async function doRevertExit(req: Request, res: Response) {
  const { id } = req.params
  const user = (req as Request & { user?: { name?: string } }).user
  const now = new Date().toISOString()

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id, tms_order_ids, tms_vehicle_slot_id')
    .eq('id', id).single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  const { data, error } = await supabase
    .from('gate_registrations')
    .update({ status: 'IN', exit_at: null, exit_by: null, load_capacity: null, updated_by: user?.name ?? null, updated_at: now })
    .eq('id', id)
    .select()
    .single()

  if (error) return apiErr(res, 'DB_ERROR', error.message, 500)

  const r = reg as { tms_order_id: string | null; tms_order_ids: string | null; tms_vehicle_slot_id: string | null }
  const allOrderIds = getAllOrderIds(r)
  await Promise.all([
    ...allOrderIds.map(oid => supabase.from('TmsOrder').update({ export_status: 'Đang xuất', updated_at: now }).eq('id', oid)),
    ...(r.tms_vehicle_slot_id ? [updateVSlotGateStatus(r.tms_vehicle_slot_id, { gate_export_status: 'Đang xuất', gate_exit_at: null, updated_at: now })] : []),
  ])

  return res.json({ success: true, data })
}

// Helper: lấy tất cả order IDs từ gate reg (hỗ trợ cả multi-order mới và single-order cũ)
function getAllOrderIds(reg: { tms_order_id: string | null; tms_order_ids: string | null }): string[] {
  if (reg.tms_order_ids) return reg.tms_order_ids.split(', ').filter(Boolean)
  if (reg.tms_order_id) return [reg.tms_order_id]
  return []
}

// Helper: update gate status trên primary slot VÀ toàn bộ secondary slots cùng consolidation_group
// Cần thiết vì gate_registrations chỉ lưu primary slot ID, nhưng group chia sẻ gate timestamps
async function updateVSlotGateStatus(vslotId: string, patch: Record<string, unknown>): Promise<void> {
  const { data: slot } = await supabase
    .from('TmsVehicleSlot')
    .select('consolidation_group_id')
    .eq('id', vslotId)
    .maybeSingle()
  if (slot?.consolidation_group_id) {
    await supabase.from('TmsVehicleSlot').update(patch).eq('consolidation_group_id', slot.consolidation_group_id)
  } else {
    await supabase.from('TmsVehicleSlot').update(patch).eq('id', vslotId)
  }
}

// Helper: tái liên kết booking cho tất cả gate_reg theo position
// Nhóm TmsVehicleSlot theo slot_id → 1 slot group = 1 chuyến xe (có thể nhiều TmsOrder)
export async function relinkAfterDelete(
  license_plate: string, date: string, warehouse_id: string,
  direction: string | null, warehouse_type: string | null, vehicle_type: string | null,
  company_id: string | null = null
) {
  const now = new Date().toISOString()

  // Gate regs còn lại, sort theo registered_at
  let gateQ = supabase
    .from('gate_registrations')
    .select('id, status, tms_order_id, tms_order_ids, tms_vehicle_slot_id, registered_at, entry_at, exit_at')
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

  const { data: gates } = await gateQ as { data: { id: string; status: string; tms_order_id: string | null; tms_order_ids: string | null; tms_vehicle_slot_id: string | null; registered_at: string | null; entry_at: string | null; exit_at: string | null }[] | null }
  if (!gates || gates.length === 0) return

  // Booking slots matching
  type RelinkSlot = {
    id: string; order_id: string; slot_id: string | null
    is_consolidation_primary: boolean
    order: {
      order_code: string; date: string; warehouse_id: string
      warehouse_type: string | null; vehicle_type: string | null; direction: string | null
      priority: boolean; ncc_id: string | null
      npp_name: string | null; gdo_refs: string | null
      planned_boxes: number | null; planned_pallets: number | null
    } | null
    slot: { time_from: string; time_to: string } | null
  }
  const { data: vslots } = await supabase
    .from('TmsVehicleSlot')
    .select(`id, order_id, slot_id, is_consolidation_primary, order:TmsOrder!order_id(order_code, date, warehouse_id, warehouse_type, vehicle_type, direction, priority, ncc_id, npp_name, gdo_refs, planned_boxes, planned_pallets), slot:DeliverySlot!slot_id(time_from, time_to)`)
    .eq('license_plate', license_plate)

  const allRelinkVslots = ((vslots ?? []) as unknown as RelinkSlot[])
  const filtered = allRelinkVslots.filter(vs => {
    if (!vs.order || !vs.slot) return false
    if (vs.order.date !== date || vs.order.warehouse_id !== warehouse_id) return false
    if (direction !== null && vs.order.direction !== direction) return false
    if (warehouse_type !== null && vs.order.warehouse_type !== warehouse_type) return false
    if (vehicle_type !== null && vs.order.vehicle_type !== vehicle_type) return false
    if (company_id !== null && vs.order.ncc_id !== company_id) return false
    return true
  })

  // Tập hợp slot_id từ matched → expand group để gom đủ đơn ghép cùng chuyến
  const matchedRelinkSlotIds = new Set<string>(
    filtered.map(vs => vs.slot_id).filter((x): x is string => !!x)
  )

  // Nhóm VSlots theo slot_id — gom ALL VSlot cùng slot (kể cả đơn vehicle_type khác)
  const slotGroups = new Map<string, RelinkSlot[]>()
  for (const vs of allRelinkVslots) {
    if (!vs.slot_id || !matchedRelinkSlotIds.has(vs.slot_id) || !vs.order || !vs.slot) continue
    if (!slotGroups.has(vs.slot_id)) slotGroups.set(vs.slot_id, [])
    slotGroups.get(vs.slot_id)!.push(vs)
  }

  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
  const sortedGroups = [...slotGroups.values()]
    .filter(g => g[0].slot)
    .sort((a, b) => toMin(a[0].slot!.time_from) - toMin(b[0].slot!.time_from))

  // Tập hợp tất cả order IDs mới (để phát hiện order cũ bị mất gate)
  const newOrderIdSet = new Set(
    sortedGroups.slice(0, gates.length).flatMap(g => g.map(vs => vs.order_id))
  )

  // Collect orders bị de-link để recalculate sau (không clear ngay — order có thể còn gate khác)
  const ordersToRecalculate = new Set<string>()

  await Promise.all(gates.map((gate, i) => {
    const group = sortedGroups[i]
    const oldOrderIds = getAllOrderIds(gate)
    const ops: Promise<unknown>[] = []
    const patch: Record<string, unknown> = { updated_at: now }

    if (!group) {
      // Không có booking tại vị trí này → clear
      Object.assign(patch, {
        tms_order_id: null, tms_vehicle_slot_id: null, tms_order_ids: null,
        booking_order_code: null, booking_slot_from: null, booking_slot_to: null,
        booking_npp_names: null, booking_gdo_refs: null,
        booking_planned_boxes: null, booking_planned_pallets: null,
        priority: false,
      })
      // Đánh dấu recalculate thay vì clear ngay — order có thể còn gate khác
      for (const oldId of oldOrderIds) {
        ordersToRecalculate.add(oldId)
      }
      // Clear gate_export_status và timestamps trên VSlot cũ (và toàn bộ group nếu có)
      if (gate.tms_vehicle_slot_id) {
        ops.push(updateVSlotGateStatus(gate.tms_vehicle_slot_id, { gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null, updated_at: now }))
      }
    } else {
      // Đơn chính = is_consolidation_primary=true, fallback = group[0]
      const primaryVSlot = group.find(vs => vs.is_consolidation_primary) ?? group[0]

      // Aggregate thông tin của group — dùng '\n' để frontend có thể split theo từng đơn
      const orderCodes   = group.map(vs => vs.order?.order_code ?? '').filter(Boolean).join('\n')
      const orderIds     = group.map(vs => vs.order_id).join(', ')
      const nppNames     = group.map(vs => vs.order?.npp_name ?? '').join('\n')
      const gdoRefs      = group.map(vs => vs.order?.gdo_refs ?? '').join('\n')
      const plannedBoxes = group.map(vs => vs.order?.planned_boxes).filter(x => x != null).join(', ')
      const plannedPals  = group.map(vs => vs.order?.planned_pallets).filter(x => x != null).join(', ')
      const hasPriority  = group.some(vs => vs.order?.priority ?? false)

      Object.assign(patch, {
        tms_order_id:            primaryVSlot.order_id,
        tms_vehicle_slot_id:     primaryVSlot.id,
        tms_order_ids:           orderIds,
        booking_order_code:      orderCodes,
        booking_slot_from:       primaryVSlot.slot?.time_from ?? null,
        booking_slot_to:         primaryVSlot.slot?.time_to ?? null,
        booking_npp_names:       nppNames || null,
        booking_gdo_refs:        gdoRefs || null,
        booking_planned_boxes:   plannedBoxes || null,
        booking_planned_pallets: plannedPals || null,
        priority:                hasPriority,
      })

      const newGroupOrderIds = new Set(group.map(vs => vs.order_id))
      const exportStatus =
        gate.status === 'IN'        ? 'Đang xuất' :
        gate.status === 'COMPLETED' ? 'Đã xuất'   : 'Đăng ký'

      // Update export_status của order mới được link vào group này
      for (const vs of group) {
        if (!oldOrderIds.includes(vs.order_id)) {
          ops.push(supabase.from('TmsOrder').update({ export_status: exportStatus, updated_at: now }).eq('id', vs.order_id) as unknown as Promise<unknown>)
        }
      }
      // Đánh dấu recalculate cho order cũ bị de-link
      for (const oldId of oldOrderIds) {
        if (!newOrderIdSet.has(oldId) && !newGroupOrderIds.has(oldId)) {
          ordersToRecalculate.add(oldId)
        }
      }

      // Cập nhật gate_export_status và timestamps trên từng TmsVehicleSlot trong group
      const gateTimestamps = {
        gate_registered_at: gate.registered_at ?? null,
        gate_entry_at: (gate.status === 'IN' || gate.status === 'COMPLETED') ? (gate.entry_at ?? null) : null,
        gate_exit_at: gate.status === 'COMPLETED' ? (gate.exit_at ?? null) : null,
      }
      for (const vs of group) {
        ops.push(supabase.from('TmsVehicleSlot').update({ gate_export_status: exportStatus, ...gateTimestamps, updated_at: now }).eq('id', vs.id) as unknown as Promise<unknown>)
      }
      // Safety net: propagate sang secondary slots bị lọc ra khỏi group (ví dụ: ncc_id hoặc
      // vehicle_type khác primary) — tìm qua consolidation_group_id thay vì filter slot_id
      ops.push(updateVSlotGateStatus(primaryVSlot.id, { gate_export_status: exportStatus, ...gateTimestamps, updated_at: now }))
      // Nếu gate chuyển sang slot mới → xóa gate_export_status và timestamps của slot cũ (và group cũ)
      if (gate.tms_vehicle_slot_id && gate.tms_vehicle_slot_id !== primaryVSlot.id) {
        ops.push(updateVSlotGateStatus(gate.tms_vehicle_slot_id, { gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null, updated_at: now }))
      }
    }

    ops.unshift(supabase.from('gate_registrations').update(patch).eq('id', gate.id) as unknown as Promise<unknown>)
    return Promise.all(ops)
  }))

  // Recalculate export_status cho các order bị de-link dựa trên TẤT CẢ gate còn lại của order đó
  // (xe đơn lẻ / đơn chính / đơn phụ đều được xử lý giống nhau)
  if (ordersToRecalculate.size > 0) {
    await Promise.all([...ordersToRecalculate].map(async (orderId) => {
      const { data: remaining } = await supabase
        .from('gate_registrations')
        .select('status')
        .or(`tms_order_id.eq.${orderId},tms_order_ids.like.%${orderId}%`)
      const statuses = (remaining ?? []).map(g => (g as { status: string }).status)
      const exportStatus = statuses.length === 0       ? null
        : statuses.some(s => s === 'COMPLETED')        ? 'Đã xuất'
        : statuses.some(s => s === 'IN')               ? 'Đang xuất'
        :                                                'Đăng ký'
      await supabase.from('TmsOrder').update({ export_status: exportStatus, updated_at: now }).eq('id', orderId)
    }))
  }
}

export async function deleteGateRegistration(req: Request, res: Response) {
  const { id } = req.params

  // Lấy thông tin trước khi xóa để re-link sau
  const { data: reg } = await supabase
    .from('gate_registrations')
    .select('license_plate, date, warehouse_id, direction, warehouse_type, vehicle_type, company_id, tms_order_id, tms_order_ids, tms_vehicle_slot_id')
    .eq('id', id)
    .maybeSingle() as { data: {
      license_plate: string | null; date: string; warehouse_id: string
      direction: string | null; warehouse_type: string | null; vehicle_type: string | null
      company_id: string | null; tms_order_id: string | null; tms_order_ids: string | null
      tms_vehicle_slot_id: string | null
    } | null }

  const deletedOrderIds = getAllOrderIds({
    tms_order_id:  reg?.tms_order_id  ?? null,
    tms_order_ids: reg?.tms_order_ids ?? null,
  })

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

  // Tính lại export_status cho từng order dựa trên trạng thái cao nhất của các gate còn lại
  if (deletedOrderIds.length > 0) {
    const now = new Date().toISOString()
    await Promise.all(deletedOrderIds.map(async (orderId) => {
      const { data: remaining } = await supabase
        .from('gate_registrations')
        .select('status')
        .or(`tms_order_id.eq.${orderId},tms_order_ids.like.%${orderId}%`)
      const statuses = (remaining ?? []).map(g => (g as { status: string }).status)
      const exportStatus = statuses.length === 0       ? null
        : statuses.some(s => s === 'COMPLETED')        ? 'Đã xuất'
        : statuses.some(s => s === 'IN')               ? 'Đang xuất'
        :                                                'Đăng ký'
      await supabase.from('TmsOrder').update({ export_status: exportStatus, updated_at: now }).eq('id', orderId)
    }))
  }

  // Clear gate_export_status trên VSlot cũ nếu không còn gate nào linked vào slot đó
  // (relinkAfterDelete trả về sớm khi không còn gate → không tự clear được)
  const deletedVSlotId = reg?.tms_vehicle_slot_id
  if (deletedVSlotId) {
    const now = new Date().toISOString()
    const { data: stillLinked } = await supabase
      .from('gate_registrations')
      .select('id')
      .eq('tms_vehicle_slot_id', deletedVSlotId)
      .limit(1)
    if (!stillLinked || stillLinked.length === 0) {
      await updateVSlotGateStatus(deletedVSlotId, { gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null, updated_at: now })
    }
  }

  return res.json({ success: true })
}
