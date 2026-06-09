import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const ORDER_SELECT = `
  *,
  ncc:TransportCompany!ncc_id(id, code, name),
  warehouse:Warehouse!warehouse_id(id, code, name),
  vehicle_slots:TmsVehicleSlot(
    id, order_id, slot_id,
    slot:DeliverySlot!slot_id(id, date, time_from, time_to, direction, cargo_type, max_vehicles, booked_count),
    license_plate, driver_name, driver_phone, status, booked_by,
    consolidation_group_id, is_consolidation_primary,
    gate_export_status, gate_registered_at, gate_entry_at, gate_exit_at,
    gate_registration_id,
    created_at, updated_at
  )
`

// GET /api/tms/orders?date=YYYY-MM-DD&warehouse_id=...&source_type=TRANSFER&destination_warehouse_id=
export async function listOrders(req: Request, res: Response) {
  try {
    const { date, warehouse_id, source_type, destination_warehouse_id } = req.query as Record<string, string>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = (req as any).user?.ncc_id ?? null

    // TRANSFER orders: không cần date
    if (source_type === 'TRANSFER') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase.from('TmsOrder') as any)
        .select(`${ORDER_SELECT}, transfer_gdo:GroupDeliveryOrder!transfer_gdo_id(id, group_code, shipto_party, transfer_status, delivery_date, dvvt, license_plate, warehouse:Warehouse!warehouse_id(id, code, name))`)
        .eq('source_type', 'TRANSFER')
        .order('created_at', { ascending: false })
      if (destination_warehouse_id) q = q.eq('destination_warehouse_id', destination_warehouse_id)
      const { data, error } = await q
      if (error) return fail(res, error.message)

      // Gắn delivery_codes từ OutboundDelivery cho mỗi order
      const gdoIds = [...new Set((data ?? []).map((o: any) => o.transfer_gdo_id).filter(Boolean))] as string[]
      if (gdoIds.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: dos } = await (supabase.from('OutboundDelivery') as any)
          .select('gdo_id, delivery_code').in('gdo_id', gdoIds)
        const codesByGdo = new Map<string, string[]>()
        for (const d of (dos ?? [])) {
          if (!d.delivery_code) continue
          const list = codesByGdo.get(d.gdo_id) ?? []
          list.push(d.delivery_code)
          codesByGdo.set(d.gdo_id, list)
        }
        return ok(res, (data ?? []).map((o: any) => ({
          ...o,
          transfer_gdo: o.transfer_gdo
            ? { ...o.transfer_gdo, delivery_codes: codesByGdo.get(o.transfer_gdo_id) ?? [] }
            : o.transfer_gdo,
        })))
      }
      return ok(res, data)
    }

    if (!date) return fail(res, 'date là bắt buộc', 400)
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
      created_by: user?.name || null, updated_by: user?.name || null,
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
        created_by: user?.name || null, updated_by: user?.name || null,
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
      gdo_refs, notes, status, priority, eta,
    } = req.body

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await (supabase.from('TmsOrder') as any)
      .select('id').eq('id', id).single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy đơn hàng', 404)

    const updates: Record<string, unknown> = { updated_by: user?.name || null, updated_at: now }
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
    if (eta             !== undefined) updates.eta             = eta || null

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
      .update({ date, updated_by: user?.name || null, updated_at: now })
      .in('id', ids)
    if (error) return fail(res, error.message)
    return ok(res, { updated: ids.length })
  } catch (e) { return fail(res, String(e)) }
}

// GET /api/tms/orders/:orderId/plan-vs-actual
// So sánh kế hoạch (InboundPlanLine) vs thực tế (InventoryEntry quét) theo từng mã hàng
export async function getPlanVsActual(req: Request, res: Response) {
  try {
    const { orderId } = req.params

    // Plan lines (kế hoạch)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: planLines, error: planErr } = await (supabase.from('inbound_plan_lines') as any)
      .select('material_id, planned_boxes, planned_pallets, material:Material!material_id(material_code, short_name, material_description)')
      .eq('tms_order_id', orderId)
      .neq('status', 'CANCELLED')
    if (planErr) return fail(res, planErr.message)

    // ProductionImport records cho order này
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actualOrders, error: actErr } = await (supabase.from('ProductionImport') as any)
      .select('id, material_id, material:Material!material_id(material_code, short_name, material_description)')
      .eq('tms_order_id', orderId)
      .neq('status', 'CANCELLED')
    if (actErr) return fail(res, actErr.message)

    // Lấy số thùng thực tế từ InventoryEntry (cartons_imported) thay vì planned_cartons
    const importIds = ((actualOrders ?? []) as any[]).map((o: any) => o.id as string)
    const actualBoxMap = new Map<string, number>() // material_id → tổng cartons_imported
    if (importIds.length > 0) {
      const importMaterialMap = new Map<string, string>() // import_id → material_id
      for (const o of (actualOrders ?? []) as any[]) {
        importMaterialMap.set(o.id as string, o.material_id as string)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: entries, error: entErr } = await (supabase.from('InventoryEntry') as any)
        .select('import_order_id, cartons_imported')
        .in('import_order_id', importIds)
      if (entErr) return fail(res, entErr.message)
      for (const e of (entries ?? []) as any[]) {
        const mid = importMaterialMap.get(e.import_order_id as string)
        if (!mid) continue
        actualBoxMap.set(mid, (actualBoxMap.get(mid) ?? 0) + ((e.cartons_imported ?? 0) as number))
      }
    }

    type PVARow = {
      material_code: string; material_name: string
      planned_boxes: number; planned_pallets: number
      actual_boxes: number; actual_pallets: number
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byMaterial: Record<string, PVARow> = {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const line of (planLines ?? []) as any[]) {
      const mid = line.material_id as string
      if (!mid) continue
      if (!byMaterial[mid]) byMaterial[mid] = {
        material_code: line.material?.material_code ?? '',
        material_name: line.material?.short_name ?? line.material?.material_description ?? '',
        planned_boxes: 0, planned_pallets: 0, actual_boxes: 0, actual_pallets: 0,
      }
      byMaterial[mid].planned_boxes   += (line.planned_boxes   ?? 0) as number
      byMaterial[mid].planned_pallets += (line.planned_pallets ?? 0) as number
    }

    // Thêm material chưa có trong plan (phát sinh) + điền actual_boxes từ InventoryEntry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const order of (actualOrders ?? []) as any[]) {
      const mid = order.material_id as string
      if (!mid) continue
      if (!byMaterial[mid]) byMaterial[mid] = {
        material_code: order.material?.material_code ?? '',
        material_name: order.material?.short_name ?? order.material?.material_description ?? '',
        planned_boxes: 0, planned_pallets: 0, actual_boxes: 0, actual_pallets: 0,
      }
    }
    for (const [mid, boxes] of actualBoxMap.entries()) {
      if (byMaterial[mid]) byMaterial[mid].actual_boxes = boxes
    }

    return ok(res, Object.values(byMaterial))
  } catch (e) { return fail(res, String(e)) }
}

// GET /api/tms/reports/inbound?date_from=&date_to=&warehouse_id=
// Báo cáo nhập hàng: kế hoạch (inbound_plan_lines) vs thực tế (ProductionImport)
export async function getInboundReport(req: Request, res: Response) {
  try {
    const { date_from, date_to, warehouse_id } = req.query as Record<string, string>
    if (!date_from || !date_to) return fail(res, 'date_from và date_to là bắt buộc', 400)

    // 1. Fetch plan lines với join material, ncc, warehouse
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('inbound_plan_lines') as any)
      .select(`
        id, date, warehouse_id, ncc_id, material_id, po_number,
        planned_boxes, tms_order_id, status,
        material:Material!material_id(material_code, short_name, unit, category),
        ncc:TransportCompany!ncc_id(code, name),
        warehouse:Warehouse!warehouse_id(code, name)
      `)
      .gte('date', date_from)
      .lte('date', date_to)
      .neq('status', 'CANCELLED')
      .order('date')
      .order('ncc_id')

    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)

    const { data: planLines, error: planErr } = await q
    if (planErr) return fail(res, planErr.message)

    // 2. Collect distinct tms_order_ids từ plan lines
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderIds = [...new Set(((planLines ?? []) as any[]).map((l: any) => l.tms_order_id).filter(Boolean))]

    // 3. Fetch ProductionImports từ 2 nguồn:
    //    a) Theo tms_order_id có trong plan lines
    //    b) Theo import_date trong range (bắt orders không có plan line nào)
    const actualMap = new Map<string, number>() // key: `${tms_order_id}/${material_id}` → boxes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allImports: any[] = []
    const IMPORT_SELECT = 'id, tms_order_id, material_id, planned_cartons, import_date, material:Material!material_id(material_code, short_name, unit, category), warehouse:Warehouse!warehouse_id(name)'

    if (orderIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: planImports, error: impErr } = await (supabase.from('ProductionImport') as any)
        .select(IMPORT_SELECT)
        .in('tms_order_id', orderIds)
        .neq('status', 'CANCELLED')
      if (impErr) return fail(res, impErr.message)
      allImports = (planImports ?? []) as any[]
    }

    // Thêm imports theo date range (bắt phát sinh thuần — không nằm trong plan nào)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dateQ = (supabase.from('ProductionImport') as any)
      .select(IMPORT_SELECT)
      .gte('import_date', date_from)
      .lte('import_date', date_to)
      .neq('status', 'CANCELLED')
    if (warehouse_id) dateQ = dateQ.eq('warehouse_id', warehouse_id)
    const { data: dateImports, error: dateImpErr } = await dateQ
    if (dateImpErr) return fail(res, dateImpErr.message)

    // Merge + dedup by id
    const seenImportIds = new Set<string>(allImports.map((i: any) => i.id as string))
    for (const imp of (dateImports ?? []) as any[]) {
      if (!seenImportIds.has(imp.id)) {
        seenImportIds.add(imp.id)
        allImports.push(imp)
      }
    }

    // Fetch InventoryEntry cho tất cả imports
    const importIds = allImports.map((i: any) => i.id as string)
    const importMeta = new Map<string, { tms_order_id: string; material_id: string }>()
    for (const i of allImports) {
      importMeta.set(i.id, { tms_order_id: i.tms_order_id, material_id: i.material_id })
    }

    if (importIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: entries, error: entErr } = await (supabase.from('InventoryEntry') as any)
        .select('import_order_id, cartons_imported')
        .in('import_order_id', importIds)
      if (entErr) return fail(res, entErr.message)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const e of (entries ?? []) as any[]) {
        const meta = importMeta.get(e.import_order_id)
        if (!meta) continue
        const key = `${meta.tms_order_id}/${meta.material_id}`
        actualMap.set(key, (actualMap.get(key) ?? 0) + ((e.cartons_imported ?? 0) as number))
      }
    }

    // 4. Build TmsOrder context map từ plan lines (để dùng cho phát sinh rows)
    const orderInfoMap = new Map<string, { date: string; warehouse_name: string; ncc_code: string; ncc_name: string }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const line of (planLines ?? []) as any[]) {
      if (line.tms_order_id && !orderInfoMap.has(line.tms_order_id)) {
        orderInfoMap.set(line.tms_order_id, {
          date: line.date as string,
          warehouse_name: (line.warehouse?.name ?? line.warehouse_id) as string,
          ncc_code: (line.ncc?.code ?? '') as string,
          ncc_name: (line.ncc?.name ?? '') as string,
        })
      }
    }
    // Bổ sung orderInfoMap cho orders không có plan line (lấy từ import_date và warehouse)
    for (const imp of allImports) {
      if (!imp.tms_order_id || orderInfoMap.has(imp.tms_order_id)) continue
      orderInfoMap.set(imp.tms_order_id, {
        date: (imp.import_date ?? '') as string,
        warehouse_name: (imp.warehouse?.name ?? '') as string,
        ncc_code: '',
        ncc_name: '',
      })
    }

    // 5. Build report rows từ plan lines (kế hoạch)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planLineKeys = new Set<string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = ((planLines ?? []) as any[]).map((line: any) => {
      const actualKey = line.tms_order_id && line.material_id
        ? `${line.tms_order_id}/${line.material_id}` : null
      if (actualKey) planLineKeys.add(actualKey)
      const actual_boxes = actualKey ? (actualMap.get(actualKey) ?? 0) : 0
      const planned = (line.planned_boxes ?? 0) as number
      return {
        plan_line_id: line.id as string,
        date: line.date as string,
        warehouse_name: (line.warehouse?.name ?? line.warehouse_id) as string,
        po_number: (line.po_number ?? '') as string,
        ncc_code: (line.ncc?.code ?? '') as string,
        ncc_name: (line.ncc?.name ?? '') as string,
        material_code: (line.material?.material_code ?? '') as string,
        material_name: (line.material?.short_name ?? '') as string,
        unit: (line.material?.unit ?? '') as string,
        material_category: (line.material?.category ?? '') as string,
        planned_boxes: planned,
        actual_boxes,
        pct: planned > 0 ? Math.round((actual_boxes / planned) * 100) : null,
        note: null as string | null,
      }
    })

    // 6. Phát sinh: ProductionImport không có trong plan lines (kể cả chưa quét — planned_cartons > 0)
    const phatSinhSeen = new Set<string>()
    for (const imp of allImports) {
      if (!imp.tms_order_id || !imp.material_id) continue
      const key = `${imp.tms_order_id}/${imp.material_id}`
      if (planLineKeys.has(key) || phatSinhSeen.has(key)) continue
      const actual_boxes = actualMap.get(key) ?? 0
      const planned_cartons = (imp.planned_cartons ?? 0) as number
      if (actual_boxes === 0 && planned_cartons === 0) continue
      phatSinhSeen.add(key)
      const info = orderInfoMap.get(imp.tms_order_id) ?? { date: '', warehouse_name: '', ncc_code: '', ncc_name: '' }
      rows.push({
        plan_line_id: '',
        date: info.date,
        warehouse_name: info.warehouse_name,
        po_number: '',
        ncc_code: info.ncc_code,
        ncc_name: info.ncc_name,
        material_code: (imp.material?.material_code ?? '') as string,
        material_name: (imp.material?.short_name ?? '') as string,
        unit: (imp.material?.unit ?? '') as string,
        material_category: (imp.material?.category ?? '') as string,
        planned_boxes: planned_cartons,
        actual_boxes,
        pct: planned_cartons > 0 && actual_boxes > 0 ? Math.round(actual_boxes / planned_cartons * 100) : null,
        note: 'Phát sinh',
      })
    }

    return ok(res, rows)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders/from-gdo  — tạo TmsOrder TRANSFER từ GDO đã hoàn thành
export async function createTransferOrder(req: Request, res: Response) {
  try {
    const { gdo_id, ncc_id, notes } = req.body as { gdo_id: string; ncc_id?: string; notes?: string }
    if (!gdo_id) return fail(res, 'gdo_id là bắt buộc', 400)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (req as any).user
    const nowTs = new Date().toISOString()
    const vnToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

    // Fetch GDO + OutboundItems
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: gdo, error: gdoErr } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('id, group_code, status, shipto_party, transfer_status, license_plate, warehouse:Warehouse!warehouse_id(code)')
      .eq('id', gdo_id).single()
    if (gdoErr || !gdo) return fail(res, 'Không tìm thấy GDO', 404)
    if (gdo.status !== 'COMPLETED') return fail(res, 'GDO chưa hoàn thành xuất kho', 400)
    if (!gdo.shipto_party) return fail(res, 'GDO không có kho đích (shipto_party) — chọn kho NPP khi tạo đơn xuất', 400)
    if (gdo.transfer_status === 'IN_TRANSIT' || gdo.transfer_status === 'DELIVERED')
      return fail(res, 'GDO này đã có lệnh chuyển kho', 409)

    // Tìm kho đích theo warehouse code
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: destWh } = await (supabase.from('Warehouse') as any)
      .select('id, code, name').eq('code', gdo.shipto_party).maybeSingle()
    if (!destWh) return fail(res, `Không tìm thấy kho đích với mã: ${gdo.shipto_party}`, 404)

    // Lấy tất cả OutboundItems qua OutboundDelivery
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dos } = await (supabase.from('OutboundDelivery') as any)
      .select('id').eq('gdo_id', gdo_id)
    const doIds: string[] = (dos ?? []).map((d: { id: string }) => d.id)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items } = doIds.length
      ? await (supabase.from('OutboundItem') as any)
          .select('material_id, cartons_ordered, material_type, material:Material(category)')
          .in('do_id', doIds)
      : { data: [] }

    // Gom theo material_id, bỏ POSM và Pallet Loscam
    const matMap = new Map<string, { material_id: string; planned_boxes: number; category: string | null }>()
    for (const item of (items ?? []) as { material_id: string; cartons_ordered: number; material_type: string; material: { category: string } | null }[]) {
      if (!item.material_id) continue
      if (item.material_type === 'POSM' || item.material_type === 'Pallet Loscam') continue
      if (!matMap.has(item.material_id)) {
        matMap.set(item.material_id, { material_id: item.material_id, planned_boxes: 0, category: item.material?.category ?? null })
      }
      matMap.get(item.material_id)!.planned_boxes += item.cartons_ordered || 0
    }
    if (matMap.size === 0) return fail(res, 'GDO không có mặt hàng hợp lệ để chuyển', 400)

    // Tạo TmsOrder TRANSFER
    const orderId = randomUUID()
    const orderCode = `TRF_${destWh.code}_${gdo.group_code}`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: ordErr } = await (supabase.from('TmsOrder') as any).insert({
      id: orderId, order_code: orderCode,
      date: vnToday,
      warehouse_id: destWh.id,
      destination_warehouse_id: destWh.id,
      direction: 'INBOUND',
      source_type: 'TRANSFER',
      transfer_gdo_id: gdo_id,
      ncc_id: ncc_id || null,
      notes: notes || null,
      planned_boxes: 0, planned_pallets: 0,
      status: 'PENDING',
      created_by: user?.name || null, updated_by: user?.name || null,
      created_at: nowTs, updated_at: nowTs,
    })
    if (ordErr) return fail(res, ordErr.message)

    // Tạo plan_lines từ GDO items
    const lineRows = [...matMap.values()].map(m => ({
      id: randomUUID(),
      tms_order_id: orderId,
      date: vnToday,
      warehouse_id: destWh.id,
      warehouse_type: m.category || null,
      material_id: m.material_id,
      planned_boxes: m.planned_boxes,
      planned_pallets: null,
      status: 'ACTIVE',
      created_by: user?.name || null, updated_by: user?.name || null,
      created_at: nowTs, updated_at: nowTs,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('inbound_plan_lines') as any).insert(lineRows)

    // Recalc TmsOrder totals
    const totalBoxes = lineRows.reduce((s, r) => s + r.planned_boxes, 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('TmsOrder') as any).update({ planned_boxes: totalBoxes, updated_at: nowTs }).eq('id', orderId)

    // Tạo TmsVehicleSlot mặc định — copy biển số từ GDO nếu có
    const plateFromGDO: string | null = gdo.license_plate || null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('TmsVehicleSlot') as any).insert({
      id: randomUUID(), order_id: orderId,
      license_plate: plateFromGDO,
      status: plateFromGDO ? 'BOOKED' : 'PENDING',
      created_at: nowTs, updated_at: nowTs,
    })

    // Cập nhật GDO.transfer_status → IN_TRANSIT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('GroupDeliveryOrder') as any)
      .update({ transfer_status: 'IN_TRANSIT', updated_at: nowTs })
      .eq('id', gdo_id)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created } = await (supabase.from('TmsOrder') as any)
      .select(`${ORDER_SELECT}, transfer_gdo:GroupDeliveryOrder!transfer_gdo_id(id, group_code, shipto_party, transfer_status)`)
      .eq('id', orderId).single()
    return ok(res, created, 201)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders/:id/confirm-receipt  — NPP xác nhận nhận hàng → tạo ProductionImport
export async function confirmTransferReceipt(req: Request, res: Response) {
  try {
    const { id } = req.params
    const t = new Date().toISOString()

    const { data: tmsOrder } = await (supabase.from('TmsOrder') as any)
      .select('id, destination_warehouse_id, transfer_gdo_id, warehouse:Warehouse!destination_warehouse_id(id, code, name)')
      .eq('id', id).single()
    if (!tmsOrder) return fail(res, 'Không tìm thấy lệnh chuyển kho', 404)
    if (!tmsOrder.transfer_gdo_id) return fail(res, 'Lệnh này không phải lệnh chuyển kho', 400)
    if (!tmsOrder.destination_warehouse_id) return fail(res, 'Lệnh chưa có kho nhận', 400)

    const gdoId = tmsOrder.transfer_gdo_id as string
    const nppWh = tmsOrder.warehouse as { id: string; code: string; name: string }

    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('id, transfer_status').eq('id', gdoId).single()
    if (!gdo) return fail(res, 'Không tìm thấy GDO', 404)
    if (gdo.transfer_status === 'DELIVERED') return fail(res, 'GDO này đã được xác nhận giao', 409)
    if (gdo.transfer_status !== 'IN_TRANSIT') return fail(res, 'GDO phải ở trạng thái Đang giao trước khi xác nhận', 400)

    const { count: existing } = await (supabase.from('ProductionImport') as any)
      .select('id', { count: 'exact', head: true }).eq('from_gdo_id', gdoId).neq('status', 'CANCELLED')
    if (existing && existing > 0) return fail(res, 'Đã tạo phiếu nhập cho lô hàng này rồi', 409)

    const { data: dos } = await (supabase.from('OutboundDelivery') as any)
      .select('id').eq('gdo_id', gdoId)
    const doIds: string[] = (dos ?? []).map((d: { id: string }) => d.id)
    if (!doIds.length) return fail(res, 'GDO không có đơn giao hàng', 400)

    const { data: items } = await (supabase.from('OutboundItem') as any)
      .select('material_id, cartons_ordered, material_type, material:Material(category)').in('do_id', doIds)

    const matMap = new Map<string, { material_id: string; cartons: number; category: string | null }>()
    for (const item of (items ?? []) as any[]) {
      if (!item.material_id || item.material_type === 'POSM' || item.material_type === 'Pallet Loscam') continue
      if (!matMap.has(item.material_id))
        matMap.set(item.material_id, { material_id: item.material_id, cartons: 0, category: item.material?.category ?? null })
      matMap.get(item.material_id)!.cartons += item.cartons_ordered || 0
    }
    if (!matMap.size) return fail(res, 'GDO không có mặt hàng hợp lệ', 400)

    const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const [vy, vm, vd] = vnDate.split('-')
    const ddmmyy = `${vd}${vm}${vy.slice(2)}`
    const importPrefix = `${nppWh.code}_N_${ddmmyy}_`
    const { data: existingCodes } = await (supabase.from('ProductionImport') as any)
      .select('import_code').ilike('import_code', `${importPrefix}%`)
    const maxSeq = (existingCodes ?? []).reduce((max: number, r: { import_code: string }) => {
      const n = parseInt(r.import_code.slice(importPrefix.length), 10)
      return isNaN(n) ? max : Math.max(max, n)
    }, 0)

    const toInsert = [...matMap.values()].map((m, idx) => ({
      id: randomUUID(),
      import_code: `${importPrefix}${String(maxSeq + idx + 1).padStart(2, '0')}`,
      warehouse_id: tmsOrder.destination_warehouse_id,
      material_id: m.material_id,
      planned_cartons: m.cartons,
      planned_pallets: 0,
      status: 'OPEN',
      source_type: 'TRANSFER',
      warehouse_type: m.category ?? null,
      import_date: vnDate,
      from_gdo_id: gdoId,
      tms_order_id: id,
      updated_at: t,
    }))
    const { error: insertError } = await (supabase.from('ProductionImport') as any).insert(toInsert)
    if (insertError) return fail(res, `Lỗi tạo phiếu nhập: ${insertError.message}`, 500)

    await (supabase.from('GroupDeliveryOrder') as any)
      .update({ transfer_status: 'RECEIVING', updated_at: t }).eq('id', gdoId)

    return ok(res, { created: toInsert.length })
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders/:id/cancel-receipt
export async function cancelTransferReceipt(req: Request, res: Response) {
  try {
    const { id } = req.params
    const t = new Date().toISOString()

    const { data: tmsOrder } = await (supabase.from('TmsOrder') as any)
      .select('id, transfer_gdo_id').eq('id', id).single()
    if (!tmsOrder) return fail(res, 'Không tìm thấy lệnh chuyển kho', 404)
    if (!tmsOrder.transfer_gdo_id) return fail(res, 'Lệnh này không phải lệnh chuyển kho', 400)

    const gdoId = tmsOrder.transfer_gdo_id as string

    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('id, transfer_status').eq('id', gdoId).single()
    if (!gdo) return fail(res, 'Không tìm thấy GDO', 404)
    if (gdo.transfer_status !== 'RECEIVING') return fail(res, 'Lệnh không ở trạng thái Đang nhận', 400)

    // Không cho phép hủy nếu còn phiếu nhập đang hoạt động (OPEN hoặc COMPLETED)
    // NPP phải tự hủy/hoàn thành từng phiếu qua module Nhập kho trước
    const { count: activeCount } = await (supabase.from('ProductionImport') as any)
      .select('id', { count: 'exact', head: true })
      .eq('from_gdo_id', gdoId).neq('status', 'CANCELLED')
    if (activeCount && activeCount > 0)
      return fail(res, `Còn ${activeCount} phiếu nhập đang hoạt động — hủy từng phiếu ở module Nhập kho trước`, 409)

    // Reset GDO về IN_TRANSIT
    await (supabase.from('GroupDeliveryOrder') as any)
      .update({ transfer_status: 'IN_TRANSIT', updated_at: t }).eq('id', gdoId)

    return ok(res, { cancelled: true })
  } catch (e) { return fail(res, String(e)) }
}

// GET /api/tms/orders/:id/transfer-goods
export async function getTransferGoods(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: planLines } = await (supabase.from('inbound_plan_lines') as any)
      .select('material_id, planned_boxes, material:Material(id, material_code, short_name, unit)')
      .eq('tms_order_id', id)
      .neq('status', 'CANCELLED')

    if (!(planLines ?? []).length) return fail(res, 'Không tìm thấy lệnh', 404)

    // Lấy ProductionImport tại kho nhận (source_type = TRANSFER, tms_order_id = id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: importOrders } = await (supabase.from('ProductionImport') as any)
      .select('id')
      .eq('tms_order_id', id)
      .eq('source_type', 'TRANSFER')

    const importIds: string[] = (importOrders ?? []).map((o: any) => o.id)

    // Lấy InventoryEntry (pallet đã nhập tại kho nhận) — cartons_imported là số thực nhận
    const { data: entries } = importIds.length
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await (supabase.from('InventoryEntry') as any)
          .select('material_id, pallet_code, cartons_imported, created_at')
          .in('import_order_id', importIds)
      : { data: [] as { material_id: string; pallet_code: string; cartons_imported: number; created_at: string }[] }

    // Gom pallet theo material_id
    type PalletInfo = { pallet_code: string; cartons_scanned: number; scanned_at: string | null }
    const palletsByMat = new Map<string, Map<string, PalletInfo>>()
    for (const entry of entries ?? []) {
      if (!entry.material_id || !entry.pallet_code) continue
      if (!palletsByMat.has(entry.material_id)) palletsByMat.set(entry.material_id, new Map())
      const byCode = palletsByMat.get(entry.material_id)!
      if (!byCode.has(entry.pallet_code)) {
        byCode.set(entry.pallet_code, { pallet_code: entry.pallet_code, cartons_scanned: 0, scanned_at: entry.created_at ?? null })
      }
      byCode.get(entry.pallet_code)!.cartons_scanned += (entry.cartons_imported ?? 0)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ok(res, (planLines ?? []).map((l: any) => ({
      material_id: l.material_id,
      material_code: l.material?.material_code ?? null,
      material_name: l.material?.short_name ?? null,
      unit: l.material?.unit ?? null,
      planned_boxes: l.planned_boxes,
      pallets: [...(palletsByMat.get(l.material_id)?.values() ?? [])],
    })))
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/tms/orders/:id  — chỉ xoá khi chưa có slot nào BOOKED+
export async function deleteOrder(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order } = await (supabase.from('TmsOrder') as any)
      .select('id, source_type, transfer_gdo_id').eq('id', id).single()
    if (!order) return fail(res, 'Không tìm thấy lệnh', 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: slots } = await (supabase.from('TmsVehicleSlot') as any)
      .select('id, status').eq('order_id', id)
    const hasBooked = (slots ?? []).some((s: { status: string }) =>
      ['BOOKED','ARRIVED','DONE'].includes(s.status)
    )
    if (hasBooked) return fail(res, 'Không thể xoá đơn đã có xe đặt khung giờ', 400)

    if (order.source_type === 'TRANSFER')
      return fail(res, 400, 'TRANSFER_ORDER', 'Lệnh chuyển kho được tạo tự động — gỡ hoàn thành ở Outbound để hủy')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('TmsOrder') as any).delete().eq('id', id)
    if (error) return fail(res, error.message)

    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}
