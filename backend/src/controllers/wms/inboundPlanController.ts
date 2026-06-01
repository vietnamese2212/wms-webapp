import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const LINE_SELECT = `
  *,
  ncc:TransportCompany!ncc_id(id, code, name),
  material:Material!material_id(id, material_code, short_name),
  tms_order:TmsOrder!tms_order_id(id, order_code, status, planned_boxes, planned_pallets)
`

// ─── Helper: tìm hoặc tạo TmsOrder INBOUND cho nhóm ─────────────────────────
async function findOrCreateTmsOrder(
  group: { date: string; warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; ncc_id: string | null },
  user: { name?: string } | null,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('TmsOrder') as any)
    .select('id')
    .eq('date', group.date)
    .eq('warehouse_id', group.warehouse_id)
    .eq('direction', 'INBOUND')

  if (group.warehouse_type) q = q.eq('warehouse_type', group.warehouse_type)
  else q = q.is('warehouse_type', null)

  if (group.vehicle_type) q = q.eq('vehicle_type', group.vehicle_type)
  else q = q.is('vehicle_type', null)

  if (group.ncc_id) q = q.eq('ncc_id', group.ncc_id)
  else q = q.is('ncc_id', null)

  const { data: existing } = await q.maybeSingle()
  if (existing) return existing.id

  // Tạo mới TmsOrder
  const now = new Date().toISOString()
  const orderId = randomUUID()

  let nccCode = 'NCC'
  if (group.ncc_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ncc } = await (supabase.from('TransportCompany') as any)
      .select('code').eq('id', group.ncc_id).single()
    if (ncc) nccCode = String(ncc.code).slice(0, 6).toUpperCase()
  }

  const datePart = group.date.replace(/-/g, '').slice(2) // YYMMDD
  const vtPart   = group.vehicle_type ? `_${group.vehicle_type.slice(0, 3)}` : ''
  // Thêm suffix ngẫu nhiên để tránh trùng khi tạo đồng thời
  const suffix   = randomUUID().slice(0, 4)
  const orderCode = `INB${datePart}_${nccCode}${vtPart}_${suffix}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('TmsOrder') as any).insert({
    id: orderId, order_code: orderCode,
    date: group.date, warehouse_id: group.warehouse_id,
    direction: 'INBOUND',
    warehouse_type: group.warehouse_type || null,
    vehicle_type:   group.vehicle_type   || null,
    ncc_id:         group.ncc_id         || null,
    planned_boxes: 0, planned_pallets: 0,
    status: 'PENDING',
    created_by: user?.name || null, updated_by: user?.name || null,
    created_at: now, updated_at: now,
  })

  // Tạo 1 TmsVehicleSlot mặc định
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('TmsVehicleSlot') as any).insert({
    id: randomUUID(), order_id: orderId,
    status: 'PENDING', created_at: now, updated_at: now,
  })

  return orderId
}

// ─── Helper: tính lại tổng TmsOrder từ plan lines ───────────────────────────
async function recalcTmsOrder(tmsOrderId: string): Promise<void> {
  const { data: lines } = await supabase
    .from('inbound_plan_lines')
    .select('planned_boxes, planned_pallets')
    .eq('tms_order_id', tmsOrderId)

  const totalBoxes   = (lines ?? []).reduce((s, l) => s + ((l as { planned_boxes: number | null }).planned_boxes   ?? 0), 0)
  const totalPallets = (lines ?? []).reduce((s, l) => s + ((l as { planned_pallets: number | null }).planned_pallets ?? 0), 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('TmsOrder') as any).update({
    planned_boxes:   totalBoxes   || null,
    planned_pallets: totalPallets || null,
    updated_at: new Date().toISOString(),
  }).eq('id', tmsOrderId)
}

// GET /api/wms/inbound-plan?date=&warehouse_id=[&tms_order_id=]
export async function listPlanLines(req: Request, res: Response) {
  try {
    const { date, warehouse_id, tms_order_id } = req.query as Record<string, string>
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('inbound_plan_lines') as any)
      .select(LINE_SELECT)
      .eq('date', date)
      .eq('warehouse_id', warehouse_id)
      .order('created_at')

    if (tms_order_id) q = q.eq('tms_order_id', tms_order_id)

    const { data, error } = await q

    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/wms/inbound-plan  (single line)
export async function createPlanLine(req: Request, res: Response) {
  try {
    const {
      date, warehouse_id, warehouse_type, vehicle_type,
      ncc_id, material_id, po_number, planned_boxes, planned_pallets,
    } = req.body
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now  = new Date().toISOString()
    const id   = randomUUID()

    const tmsOrderId = await findOrCreateTmsOrder(
      { date, warehouse_id, warehouse_type: warehouse_type || null, vehicle_type: vehicle_type || null, ncc_id: ncc_id || null },
      user,
    )

    const { error } = await supabase.from('inbound_plan_lines').insert({
      id, date, warehouse_id,
      warehouse_type:  warehouse_type  || null,
      vehicle_type:    vehicle_type    || null,
      ncc_id:          ncc_id          || null,
      material_id:     material_id     || null,
      po_number:       po_number       || null,
      planned_boxes:   planned_boxes   ?? null,
      planned_pallets: planned_pallets ?? null,
      tms_order_id: tmsOrderId,
      created_by: user?.name || null, updated_by: user?.name || null,
      created_at: now, updated_at: now,
    })
    if (error) return fail(res, error.message)

    await recalcTmsOrder(tmsOrderId)

    const { data, error: fe } = await supabase
      .from('inbound_plan_lines').select(LINE_SELECT).eq('id', id).single()
    if (fe) return fail(res, fe.message)
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/wms/inbound-plan/bulk
export async function bulkCreatePlanLines(req: Request, res: Response) {
  try {
    const { lines } = req.body as { lines: Record<string, unknown>[] }
    if (!Array.isArray(lines) || !lines.length) return fail(res, 'lines phải là array không rỗng', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now  = new Date().toISOString()

    // Thu thập các nhóm unique → find/create TmsOrder
    type GroupKey = string
    const groupMap = new Map<GroupKey, string>() // key → tmsOrderId

    const makeKey = (date: string, wh: string, whType: string | null, vt: string | null, ncc: string | null) =>
      `${date}||${wh}||${whType ?? ''}||${vt ?? ''}||${ncc ?? ''}`

    // Xác định TmsOrder cho từng nhóm trước
    const uniqueGroups = new Map<GroupKey, { date: string; warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; ncc_id: string | null }>()
    for (const line of lines) {
      const key = makeKey(
        String(line.date ?? ''), String(line.warehouse_id ?? ''),
        (line.warehouse_type as string | null) ?? null,
        (line.vehicle_type  as string | null) ?? null,
        (line.ncc_id        as string | null) ?? null,
      )
      if (!uniqueGroups.has(key)) {
        uniqueGroups.set(key, {
          date:          String(line.date ?? ''),
          warehouse_id:  String(line.warehouse_id ?? ''),
          warehouse_type: (line.warehouse_type as string | null) ?? null,
          vehicle_type:   (line.vehicle_type  as string | null) ?? null,
          ncc_id:         (line.ncc_id        as string | null) ?? null,
        })
      }
    }

    for (const [key, group] of uniqueGroups) {
      const orderId = await findOrCreateTmsOrder(group, user)
      groupMap.set(key, orderId)
    }

    // Insert tất cả lines
    const rows = lines.map(line => {
      const key = makeKey(
        String(line.date ?? ''), String(line.warehouse_id ?? ''),
        (line.warehouse_type as string | null) ?? null,
        (line.vehicle_type  as string | null) ?? null,
        (line.ncc_id        as string | null) ?? null,
      )
      return {
        id: randomUUID(),
        date:            String(line.date ?? ''),
        warehouse_id:    String(line.warehouse_id ?? ''),
        warehouse_type:  (line.warehouse_type  as string | null) ?? null,
        vehicle_type:    (line.vehicle_type    as string | null) ?? null,
        ncc_id:          (line.ncc_id          as string | null) ?? null,
        material_id:     (line.material_id     as string | null) ?? null,
        po_number:       (line.po_number       as string | null) ?? null,
        planned_boxes:   (line.planned_boxes   as number | null) ?? null,
        planned_pallets: (line.planned_pallets as number | null) ?? null,
        tms_order_id:    groupMap.get(key) ?? null,
        created_by: user?.name || null, updated_by: user?.name || null,
        created_at: now, updated_at: now,
      }
    })

    const { error } = await supabase.from('inbound_plan_lines').insert(rows)
    if (error) return fail(res, error.message)

    // Recalc tất cả TmsOrders bị ảnh hưởng
    const affectedOrderIds = [...new Set(rows.map(r => r.tms_order_id).filter(Boolean))] as string[]
    await Promise.all(affectedOrderIds.map(recalcTmsOrder))

    return ok(res, { inserted: rows.length }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/wms/inbound-plan/:id
export async function updatePlanLine(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { material_id, po_number, planned_boxes, planned_pallets } = req.body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now  = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from('inbound_plan_lines') as any)
      .select('id, tms_order_id').eq('id', id).single()
    if (!existing) return fail(res, 'Không tìm thấy dòng kế hoạch', 404)

    const updates: Record<string, unknown> = { updated_by: user?.name || null, updated_at: now }
    if (material_id     !== undefined) updates.material_id     = material_id     || null
    if (po_number       !== undefined) updates.po_number       = po_number       || null
    if (planned_boxes   !== undefined) updates.planned_boxes   = planned_boxes   ?? null
    if (planned_pallets !== undefined) updates.planned_pallets = planned_pallets ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('inbound_plan_lines') as any).update(updates).eq('id', id)
    if (error) return fail(res, error.message)

    if (existing.tms_order_id) await recalcTmsOrder(existing.tms_order_id)

    const { data, error: fe } = await supabase
      .from('inbound_plan_lines').select(LINE_SELECT).eq('id', id).single()
    if (fe) return fail(res, fe.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/wms/inbound-plan/:id
export async function deletePlanLine(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from('inbound_plan_lines') as any)
      .select('id, tms_order_id').eq('id', id).single()
    if (!existing) return fail(res, 'Không tìm thấy dòng kế hoạch', 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('inbound_plan_lines') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)

    if (existing.tms_order_id) await recalcTmsOrder(existing.tms_order_id)

    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}
