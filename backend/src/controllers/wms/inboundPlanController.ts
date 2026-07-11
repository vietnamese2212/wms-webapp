import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'

const LINE_SELECT = `
  *,
  ncc:TransportCompany!ncc_id(id, code, name),
  material:Material!material_id(id, material_code, short_name),
  tms_order:TmsOrder!tms_order_id(id, order_code, status, planned_boxes, planned_pallets)
`

// ─── Helper: tìm hoặc tạo TmsOrder INBOUND cho nhóm ─────────────────────────
async function findOrCreateTmsOrder(
  group: { date: string; warehouse_id: string; warehouse_type: string | null; vehicle_type: string | null; ncc_id: string | null },
  user: { name?: string } | null | undefined,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = supabase.from('TmsOrder')
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
    const { data: ncc } = await supabase.from('TransportCompany')
      .select('code').eq('id', group.ncc_id).single()
    if (ncc) nccCode = String(ncc.code).slice(0, 6).toUpperCase()
  }

  const datePart = group.date.replace(/-/g, '').slice(2) // YYMMDD
  const vtPart   = group.vehicle_type ? `_${group.vehicle_type.slice(0, 3)}` : ''
  // Thêm suffix ngẫu nhiên để tránh trùng khi tạo đồng thời
  const suffix   = randomUUID().slice(0, 4)
  const orderCode = `INB${datePart}_${nccCode}${vtPart}_${suffix}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('TmsOrder').insert({
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
  await supabase.from('TmsVehicleSlot').insert({
    id: randomUUID(), order_id: orderId,
    status: 'PENDING', created_at: now, updated_at: now,
  })

  return orderId
}

// ─── Helper: tính lại tổng TmsOrder từ plan lines (chỉ tính ACTIVE) ─────────
async function recalcTmsOrder(tmsOrderId: string): Promise<void> {
  // Chỉ đếm ACTIVE lines — CANCELLED lines không tính vào kế hoạch
  const { data: activeLines } = await supabase
    .from('inbound_plan_lines')
    .select('planned_boxes, planned_pallets')
    .eq('tms_order_id', tmsOrderId)
    .neq('status', 'CANCELLED')

  const totalBoxes   = (activeLines ?? []).reduce((s, l) => s + ((l as { planned_boxes: number | null }).planned_boxes   ?? 0), 0)
  const totalPallets = (activeLines ?? []).reduce((s, l) => s + ((l as { planned_pallets: number | null }).planned_pallets ?? 0), 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('TmsOrder').update({
    planned_boxes:   totalBoxes   || null,
    planned_pallets: totalPallets || null,
    updated_at: new Date().toISOString(),
  }).eq('id', tmsOrderId)

  // Nếu không còn ACTIVE lines → tự động hủy TmsOrder PENDING
  if ((activeLines ?? []).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order } = await supabase.from('TmsOrder')
      .select('status').eq('id', tmsOrderId).single()
    if (order?.status === 'PENDING') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('TmsOrder')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', tmsOrderId)
    }
  }
}

// GET /api/wms/inbound-plan?date_from=&date_to=&warehouse_id=[&tms_order_id=]
// (cũng nhận date= để backward-compat với UploadDialog)
export async function listPlanLines(req: Request, res: Response) {
  try {
    const { date, date_from, date_to, warehouse_id, tms_order_id } = req.query as Record<string, string>
    const from = date_from ?? date
    const to   = date_to   ?? date
    if (!tms_order_id && (!from || !warehouse_id)) return fail(res, 'date_from và warehouse_id là bắt buộc', 400)

    // Phân trang né cap ~1000 (khoảng ngày rộng × nhiều NCC → KH nhập dễ vượt)
    const data = await fetchAllRowsParallel(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = supabase.from('inbound_plan_lines').select(LINE_SELECT)
      if (tms_order_id && !from) {
        q = q.eq('tms_order_id', tms_order_id)
      } else {
        q = q.gte('date', from).lte('date', to).eq('warehouse_id', warehouse_id)
        if (tms_order_id) q = q.eq('tms_order_id', tms_order_id)
      }
      return q.order('date').order('created_at').order('id')
    })
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
    const user = req.user
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
    const user = req.user
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

    // Ghi theo LÔ 500 — file KH vài nghìn dòng insert 1 phát dễ quá payload/timeout serverless
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('inbound_plan_lines').insert(rows.slice(i, i + 500))
      if (error) return fail(res, error.message)
    }

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
    const {
      material_id, po_number, planned_boxes, planned_pallets,
      date, warehouse_type, vehicle_type, ncc_id,
    } = req.body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now  = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await supabase.from('inbound_plan_lines')
      .select('id, date, warehouse_id, warehouse_type, vehicle_type, ncc_id, tms_order_id')
      .eq('id', id).single()
    if (!existing) return fail(res, 'Không tìm thấy dòng kế hoạch', 404)

    const updates: Record<string, unknown> = { updated_by: user?.name || null, updated_at: now }
    if (material_id     !== undefined) updates.material_id     = material_id     || null
    if (po_number       !== undefined) updates.po_number       = po_number       || null
    if (planned_boxes   !== undefined) updates.planned_boxes   = planned_boxes   ?? null
    if (planned_pallets !== undefined) updates.planned_pallets = planned_pallets ?? null

    // Grouping fields — chỉ cho phép khi TmsOrder còn PENDING
    const groupingChanged = date !== undefined || warehouse_type !== undefined ||
                            vehicle_type !== undefined || ncc_id !== undefined
    let newTmsOrderId = existing.tms_order_id

    if (groupingChanged) {
      if (existing.tms_order_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: order } = await supabase.from('TmsOrder')
          .select('status').eq('id', existing.tms_order_id).single()
        if (order && order.status !== 'PENDING') {
          return fail(res, 'Lệnh TMS đã được xử lý, không thể sửa nhóm vận chuyển', 400)
        }
      }

      const newGroup = {
        date:           date           ?? existing.date,
        warehouse_id:   existing.warehouse_id,
        warehouse_type: warehouse_type !== undefined ? (warehouse_type || null) : existing.warehouse_type,
        vehicle_type:   vehicle_type   !== undefined ? (vehicle_type   || null) : existing.vehicle_type,
        ncc_id:         ncc_id         !== undefined ? (ncc_id         || null) : existing.ncc_id,
      }

      newTmsOrderId = await findOrCreateTmsOrder(newGroup, user)

      updates.tms_order_id   = newTmsOrderId
      if (date           !== undefined) updates.date           = date
      if (warehouse_type !== undefined) updates.warehouse_type = warehouse_type || null
      if (vehicle_type   !== undefined) updates.vehicle_type   = vehicle_type   || null
      if (ncc_id         !== undefined) updates.ncc_id         = ncc_id         || null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('inbound_plan_lines').update(updates).eq('id', id)
    if (error) return fail(res, error.message)

    // Recalc cả 2 TmsOrder nếu có thay đổi nhóm
    if (existing.tms_order_id && existing.tms_order_id !== newTmsOrderId) {
      await recalcTmsOrder(existing.tms_order_id)
    }
    if (newTmsOrderId) await recalcTmsOrder(newTmsOrderId)

    const { data, error: fe } = await supabase
      .from('inbound_plan_lines').select(LINE_SELECT).eq('id', id).single()
    if (fe) return fail(res, fe.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/wms/inbound-plan/:id  — chỉ dùng khi nhập nhầm, TmsOrder phải PENDING
export async function deletePlanLine(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await supabase.from('inbound_plan_lines')
      .select('id, tms_order_id').eq('id', id).single()
    if (!existing) return fail(res, 'Không tìm thấy dòng kế hoạch', 404)

    // Chặn xóa nếu TmsOrder đã được xử lý (chỉ cho phép khi còn PENDING)
    if (existing.tms_order_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: order } = await supabase.from('TmsOrder')
        .select('status').eq('id', existing.tms_order_id).single()
      if (order && order.status !== 'PENDING' && order.status !== 'CANCELLED') {
        return fail(res, 'Kế hoạch đã được xử lý — dùng "Hủy kế hoạch" thay vì Xóa', 400)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('inbound_plan_lines').delete().eq('id', id)
    if (error) return fail(res, error.message)

    if (existing.tms_order_id) {
      await recalcTmsOrder(existing.tms_order_id)

      // Nếu TmsOrder không còn line nào (kể cả cancelled) → xóa hẳn (nhập nhầm, dọn sạch)
      const { count } = await supabase
        .from('inbound_plan_lines')
        .select('*', { count: 'exact', head: true })
        .eq('tms_order_id', existing.tms_order_id)

      if (!count) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsVehicleSlot').delete().eq('order_id', existing.tms_order_id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('TmsOrder').delete().eq('id', existing.tms_order_id)
      }
    }

    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /api/wms/inbound-plan/:id/cancel  — soft cancel, giữ lịch sử báo cáo
export async function cancelPlanLine(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { cancel_reason } = req.body
    if (!cancel_reason?.trim()) return fail(res, 'Lý do hủy là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now  = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await supabase.from('inbound_plan_lines')
      .select('id, status, tms_order_id').eq('id', id).single()
    if (!existing) return fail(res, 'Không tìm thấy dòng kế hoạch', 404)
    if (existing.status === 'CANCELLED') return fail(res, 'Dòng kế hoạch đã được hủy rồi', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('inbound_plan_lines').update({
      status: 'CANCELLED',
      cancel_reason: cancel_reason.trim(),
      updated_by: user?.name || null,
      updated_at: now,
    }).eq('id', id)
    if (error) return fail(res, error.message)

    // Recalc TmsOrder (loại line vừa hủy khỏi tổng); nếu 0 ACTIVE lines → TmsOrder CANCELLED
    if (existing.tms_order_id) await recalcTmsOrder(existing.tms_order_id)

    const { data, error: fe } = await supabase
      .from('inbound_plan_lines').select(LINE_SELECT).eq('id', id).single()
    if (fe) return fail(res, fe.message)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/wms/inbound-plan/bulk-for-order
// Tạo plan lines trực tiếp cho 1 TmsOrder đã có (upload từ booking detail)
export async function bulkCreateForOrder(req: Request, res: Response) {
  try {
    const { tms_order_id, lines } = req.body as {
      tms_order_id: string
      lines: { material_id: string; planned_boxes: number; planned_pallets?: number }[]
    }
    if (!tms_order_id) return fail(res, 'tms_order_id là bắt buộc', 400)
    if (!Array.isArray(lines) || !lines.length) return fail(res, 'lines phải là array không rỗng', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tmsOrder, error: orderErr } = await supabase.from('TmsOrder')
      .select('id, date, warehouse_id, warehouse_type, vehicle_type, ncc_id, direction')
      .eq('id', tms_order_id)
      .single()
    if (orderErr || !tmsOrder) return fail(res, 'Không tìm thấy TmsOrder', 404)
    if (tmsOrder.direction !== 'INBOUND') return fail(res, 'Chỉ tạo kế hoạch cho đơn hàng hướng nhập (INBOUND)', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now = new Date().toISOString()

    const lineRows = lines
      .filter(l => l.material_id && (l.planned_boxes ?? 0) > 0)
      .map(l => ({
        id: randomUUID(),
        tms_order_id,
        date: tmsOrder.date,
        warehouse_id: tmsOrder.warehouse_id,
        warehouse_type: tmsOrder.warehouse_type ?? null,
        vehicle_type: tmsOrder.vehicle_type ?? null,
        ncc_id: tmsOrder.ncc_id ?? null,
        material_id: l.material_id,
        planned_boxes: l.planned_boxes,
        planned_pallets: l.planned_pallets ?? null,
        status: 'ACTIVE',
        created_by: user?.name ?? null,
        updated_by: user?.name ?? null,
        created_at: now,
        updated_at: now,
      }))

    if (!lineRows.length) return fail(res, 'Không có dòng hợp lệ (material_id + planned_boxes > 0)', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await supabase.from('inbound_plan_lines').insert(lineRows)
    if (insErr) return fail(res, insErr.message)

    await recalcTmsOrder(tms_order_id)

    return ok(res, { inserted: lineRows.length }, 201)
  } catch (e) { return fail(res, String(e)) }
}
