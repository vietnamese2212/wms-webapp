import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { effectiveNoQr } from '../../lib/inventoryMode'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'

// Ngày hôm nay theo giờ VN (YYYY-MM-DD) — chặn nghiệp vụ ngày quá khứ. So sánh chuỗi ISO date là an toàn.
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// Phân trang TUẦN TỰ cho 1 query bất kỳ — né cap ~1000 dòng/response của PostgREST.
// `makeQuery`: hàm trả về query MỚI mỗi lần (đã .select + filter + .order ổn định), CHƯA .range. Throw nếu lỗi.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPaged(makeQuery: () => any, pageSize = 1000): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await makeQuery().range(p * pageSize, p * pageSize + pageSize - 1)
    if (error) throw new Error(error.message)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batch = (data ?? []) as any[]
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}

// Chia danh sách id thành lô (né giới hạn độ dài URL của `.in(...)`), mỗi lô vẫn phân trang né cap-1000.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllByIdChunks(ids: string[], makeQuery: (chunk: string[]) => any, chunkSize = 100): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    out.push(...await fetchAllPaged(() => makeQuery(ids.slice(i, i + chunkSize))))
  }
  return out
}

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

// ── Scope-write: user ASSIGNED chỉ thao tác lệnh thuộc kho mình (nguồn HOẶC đích).
// NATIONAL → null (toàn quyền). ĐVVT (ncc_id) → null vì scope theo CÔNG TY, không theo kho (mirror listOrders).
function scopeWhIds(req: Request): string[] | null {
  if (req.user?.warehouse_scope === 'NATIONAL') return null
  if (req.user?.ncc_id) return null
  return req.user?.warehouse_ids ?? []
}
function whInScope(scope: string[], ...whs: (string | null | undefined)[]): boolean {
  return (whs.filter(Boolean) as string[]).some(w => scope.includes(w))
}
// Gác theo id: lệnh phải dính kho trong phạm vi (nguồn hoặc đích). Trả false + đã gửi lỗi nếu chặn.
async function guardOrderScope(req: Request, res: Response, id: string): Promise<boolean> {
  const scope = scopeWhIds(req)
  if (scope === null) return true
  const { data } = await supabase.from('TmsOrder')
    .select('warehouse_id, destination_warehouse_id').eq('id', id).maybeSingle()
  if (!data) { fail(res, 'Không tìm thấy lệnh', 404); return false }
  const o = data as { warehouse_id: string | null; destination_warehouse_id: string | null }
  if (!whInScope(scope, o.warehouse_id, o.destination_warehouse_id)) {
    fail(res, 'Ngoài phạm vi kho được giao — không thể thao tác lệnh của kho này', 403); return false
  }
  return true
}
// Gác tạo/đổi sang 1 kho cụ thể.
function guardWhCreate(req: Request, res: Response, whId: string | null | undefined): boolean {
  const scope = scopeWhIds(req)
  if (scope === null) return true
  if (!whId || !scope.includes(whId)) {
    fail(res, 'Ngoài phạm vi kho — không thể tạo/đổi lệnh sang kho này', 403); return false
  }
  return true
}

// GET /api/tms/orders?date=YYYY-MM-DD&warehouse_id=...&source_type=TRANSFER&destination_warehouse_id=
export async function listOrders(req: Request, res: Response) {
  try {
    const { date, date_from, date_to, warehouse_id, source_type, destination_warehouse_id } = req.query as Record<string, string>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = req.user?.ncc_id ?? null

    // TRANSFER orders: không bắt buộc date, nhưng NHẬN date_from/date_to — lệnh tích lũy vô hạn
    // (mỗi đơn xuất hoàn thành = 1 lệnh), kéo ALL sẽ chết theo thời gian; FE Bookings mặc định ~30 ngày.
    if (source_type === 'TRANSFER') {
      const tCats = scopeCategoriesOf(req)
      // Phân trang né cap-1000: lệnh chuyển kho tích lũy không giới hạn ngày → 1 response sẽ cắt mất lệnh
      const orders = await fetchAllPaged(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = supabase.from('TmsOrder')
          .select(`${ORDER_SELECT}, transfer_gdo:GroupDeliveryOrder!transfer_gdo_id(id, group_code, status, shipto_party, transfer_status, delivery_date, dvvt, license_plate, warehouse:Warehouse!warehouse_id(id, code, name))`)
          .eq('source_type', 'TRANSFER')
          .order('created_at', { ascending: false })
          .order('id')
        if (destination_warehouse_id) q = q.eq('destination_warehouse_id', destination_warehouse_id)
        if (date_from) q = q.gte('date', date_from)
        if (date_to)   q = q.lte('date', date_to)
        if (tCats) q = q.or(`warehouse_type.is.null,warehouse_type.in.(${tCats.map(c => `"${c}"`).join(',')})`)
        return q
      })
      const orderIds = orders.map((o: any) => o.id as string)

      // Gắn delivery_codes + tên khách (customer_label — hiển thị "Kho nhận" cho lệnh OTHER không có kho đích)
      const gdoIds = [...new Set(orders.map((o: any) => o.transfer_gdo_id).filter(Boolean))] as string[]
      const codesByGdo = new Map<string, string[]>()
      const custByGdo  = new Map<string, string>()
      if (gdoIds.length) {
        // Chunk + phân trang né cap-1000 (nhiều GDO → nhiều delivery)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dos = await fetchAllByIdChunks(gdoIds, chunk => supabase.from('OutboundDelivery')
          .select('gdo_id, delivery_code, distributor_name').in('gdo_id', chunk).order('id'))
        for (const d of (dos ?? [])) {
          if (d.distributor_name?.trim() && !custByGdo.has(d.gdo_id)) custByGdo.set(d.gdo_id, d.distributor_name.trim())
          if (!d.delivery_code) continue
          const list = codesByGdo.get(d.gdo_id) ?? []
          list.push(d.delivery_code)
          codesByGdo.set(d.gdo_id, list)
        }
      }

      // Tính receiving_started_at và actual_received từ phiếu nhập tại kho nhận
      const receivingStartedAt = new Map<string, string>()   // tms_order_id → ISO
      const importToOrder = new Map<string, string>()         // import_id → tms_order_id
      const actualReceivedByOrder = new Map<string, number>() // tms_order_id → total cartons

      if (orderIds.length) {
        // Chunk + phân trang né cap-1000 (nhiều lệnh → nhiều phiếu nhập)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const importOrders = await fetchAllByIdChunks(orderIds, chunk => supabase.from('ProductionImport')
          .select('id, tms_order_id, created_at, posm_cartons, material:Material!material_id(no_qr_tracking), warehouse:Warehouse!warehouse_id(inventory_mode)')
          .in('tms_order_id', chunk)
          .eq('source_type', 'TRANSFER')
          .neq('status', 'CANCELLED')
          .order('id'))

        const qrImportIds: string[] = []
        for (const imp of (importOrders ?? []) as any[]) {
          importToOrder.set(imp.id, imp.tms_order_id)
          const existing = receivingStartedAt.get(imp.tms_order_id)
          if (!existing || imp.created_at < existing) receivingStartedAt.set(imp.tms_order_id, imp.created_at)
          if (effectiveNoQr(imp.material?.no_qr_tracking, imp.warehouse?.inventory_mode)) {
            // No-QR: nhận vào pool dùng chung (import_order_id ≠ phiếu) → cộng theo posm_cartons
            if (imp.posm_cartons != null)
              actualReceivedByOrder.set(imp.tms_order_id, (actualReceivedByOrder.get(imp.tms_order_id) ?? 0) + Number(imp.posm_cartons))
          } else {
            qrImportIds.push(imp.id)
          }
        }

        if (qrImportIds.length) {
          // Phân trang né cap-1000: tổng entry qua TẤT CẢ chuyến trong list dễ vượt 1000
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const entries = await fetchAllPaged(() => supabase.from('InventoryEntry')
            .select('import_order_id, cartons_imported').in('import_order_id', qrImportIds)
            .order('import_order_id', { ascending: true }))
          for (const entry of entries as any[]) {
            const ordId = importToOrder.get(entry.import_order_id)
            if (!ordId) continue
            actualReceivedByOrder.set(ordId, (actualReceivedByOrder.get(ordId) ?? 0) + (entry.cartons_imported ?? 0))
          }
        }
      }

      return ok(res, orders.map((o: any) => ({
        ...o,
        transfer_gdo: o.transfer_gdo
          ? { ...o.transfer_gdo, delivery_codes: codesByGdo.get(o.transfer_gdo_id) ?? [], customer_label: custByGdo.get(o.transfer_gdo_id) ?? null }
          : o.transfer_gdo,
        receiving_started_at: receivingStartedAt.get(o.id) ?? null,
        actual_received: actualReceivedByOrder.get(o.id) ?? 0,
      })))
    }

    // Lọc theo khoảng ngày (date_from/date_to) — fallback `date` đơn cho tương thích cũ
    const from = date_from || date
    const to   = date_to || date
    if (!from) return fail(res, 'date_from là bắt buộc', 400)
    if (!warehouse_id && !userNccId) return fail(res, 'warehouse_id là bắt buộc', 400)

    // Scope kho + Loại hàng: ASSIGNED không xem được kho ngoài phạm vi / loại ngoài allowed_categories
    const listScope = scopeWhIds(req)
    if (listScope !== null && warehouse_id && !listScope.includes(warehouse_id)) return ok(res, [])
    const listCats = scopeCategoriesOf(req)

    // Phân trang né cap-1000 của PostgREST: >1000 đơn/ngày/kho sẽ bị mất nếu không page.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await fetchAllPaged(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = supabase.from('TmsOrder')
        .select(ORDER_SELECT)
        .gte('date', from)
        .lte('date', to || from)
        .neq('source_type', 'TRANSFER')
        .order('date', { ascending: false })
        .order('created_at')
      if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
      if (userNccId)    q = q.eq('ncc_id', userNccId)
      if (listCats)     q = q.or(`warehouse_type.is.null,warehouse_type.in.(${listCats.map(c => `"${c}"`).join(',')})`)
      return q
    })
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders
export async function createOrder(req: Request, res: Response) {
  try {
    const {
      order_code: rawOrderCode, date, warehouse_id, ncc_id, npp_name,
      vehicle_type, direction, warehouse_type,
      planned_boxes, planned_pallets, planned_tons,
      gdo_refs, notes, priority,
    } = req.body
    if (!date || !warehouse_id) return fail(res, 'date và warehouse_id là bắt buộc', 400)
    if (!direction)  return fail(res, 'direction là bắt buộc', 400)
    if (!ncc_id)     return fail(res, 'ĐVVT là bắt buộc', 400)
    if (date < todayVN()) return fail(res, 'Không thể tạo đơn cho ngày quá khứ', 400)
    if (!guardWhCreate(req, res, warehouse_id)) return
    if (!categoryAllowed(req, warehouse_type)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now = new Date().toISOString()
    const orderId = randomUUID()

    const autoGenerate = !rawOrderCode
    let order_code = rawOrderCode as string
    let codePrefix = ''

    if (autoGenerate) {
      // Tự sinh mã: X/N_MãKho_ddmmyy_STT
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: wh } = await supabase.from('Warehouse')
        .select('code').eq('id', warehouse_id).maybeSingle()
      const whCode = (wh?.code ?? 'KHO') as string
      const dirPrefix = direction === 'OUTBOUND' ? 'X' : 'N'
      const d = new Date(date)
      const ddmmyy = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`
      codePrefix = `${whCode}_${dirPrefix}_${ddmmyy}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await supabase.from('TmsOrder')
        .select('id', { count: 'exact', head: true })
        .like('order_code', `${codePrefix}_%`)
      order_code = `${codePrefix}_${(count ?? 0) + 1}`
    }

    const row = {
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
    }

    // Retry tối đa 5 lần nếu trùng mã tự sinh (race condition)
    let ordErr: { code?: string; message: string } | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res2 = await supabase.from('TmsOrder').insert({ ...row, order_code })
      ordErr = res2.error
      if (!ordErr) break
      if (ordErr.code !== '23505') break
      if (!autoGenerate) break // mã nhập tay → không retry
      // Lấy số thứ tự hiện tại cao nhất rồi +1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await supabase.from('TmsOrder')
        .select('order_code')
        .like('order_code', `${codePrefix}_%`)
        .order('order_code', { ascending: false })
        .limit(1)
      const lastCode = (existing?.[0]?.order_code ?? '') as string
      const lastSeq = parseInt(lastCode.split('_').pop() ?? '0') || 0
      order_code = `${codePrefix}_${lastSeq + 1}`
      // Jitter phá thundering herd — retry ngay lập tức thì các request đua lại cùng tranh max+1 → 409 oan
      await new Promise(r => setTimeout(r, 15 + Math.floor(Math.random() * (40 + attempt * 25))))
    }
    if (ordErr) {
      if (ordErr.code === '23505') return fail(res, `Mã đơn "${order_code}" đã tồn tại`, 409)
      return fail(res, ordErr.message)
    }

    // Tạo 1 TmsVehicleSlot mặc định
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('TmsVehicleSlot').insert({
      id: randomUUID(), order_id: orderId,
      status: 'PENDING', created_at: now, updated_at: now,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('TmsOrder')
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
    const user = req.user
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputList = orders as any[]

    // Chặn ngày quá khứ với user thường; superadmin được back-date (nhập bù dữ liệu cũ).
    if (user?.name !== 'Admin') {
      const today = todayVN()
      const pastDated = inputList.filter(o => o.date && o.date < today).map(o => o.order_code || o.date)
      if (pastDated.length) return fail(res, `Không thể upload đơn ngày quá khứ: ${pastDated.join(', ')}`, 400)
    }

    // Check trùng order_code trong DB → 409 (upload là TẠO MỚI, không cập nhật đơn đã có)
    // Chunk 300 code/lượt: file vài nghìn dòng mà .in() một phát → URL quá dài, PostgREST từ chối.
    const incomingCodes = inputList.map(o => o.order_code).filter(Boolean) as string[]
    if (incomingCodes.length) {
      const codeChunks: string[][] = []
      for (let i = 0; i < incomingCodes.length; i += 300) codeChunks.push(incomingCodes.slice(i, i + 300))
      const dupResults = await Promise.all(codeChunks.map(chunk =>
        supabase.from('TmsOrder').select('order_code, date, warehouse:Warehouse(name)').in('order_code', chunk)
      ))
      const existing = dupResults.flatMap(r => (r.data ?? []) as unknown as { order_code: string; date: string; warehouse: { name: string } | null }[])
      if (existing.length) {
        // Chỉ rõ đơn trùng đang nằm Ở ĐÂU (kho + ngày) — tab Kế hoạch lọc theo 1 kho + khoảng ngày,
        // không ghi vị trí thì user không tìm thấy để xóa (đã dính thật: file 2 kho, xóa 1 kho vẫn sót kho kia).
        const fmtD = (d: string) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}` }
        const dupes = existing.map(r => `${r.order_code} (${r.warehouse?.name ?? 'kho ?'} — ngày ${fmtD(r.date)})`).join(', ')
        return fail(res, `Mã đơn đã tồn tại: ${dupes}. Mở đúng kho + ngày ghi trong ngoặc để tìm và xóa đơn cũ, rồi upload lại.`, 409)
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

    // Scope-write: chặn upload lệnh cho kho ngoài phạm vi (ASSIGNED). NATIONAL/ĐVVT → scope null.
    const scope = scopeWhIds(req)
    if (scope !== null && orderRows.some(r => !scope.includes(r.warehouse_id as string)))
      return fail(res, 'Ngoài phạm vi kho — file chứa lệnh của kho ngoài phạm vi được giao', 403)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await supabase.from('TmsOrder').insert(orderRows)
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
    await supabase.from('TmsVehicleSlot').insert(slotRows)

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
    const user = req.user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: fetchErr } = await supabase.from('TmsOrder')
      .select('id, date, status').eq('id', id).single()
    if (fetchErr || !existing) return fail(res, 'Không tìm thấy đơn hàng', 404)

    // Scope-write: lệnh phải thuộc kho trong phạm vi; nếu chuyển sang kho mới thì kho đó cũng phải trong phạm vi.
    if (!(await guardOrderScope(req, res, id))) return
    if (warehouse_id !== undefined && !guardWhCreate(req, res, warehouse_id)) return
    if (warehouse_type !== undefined && !categoryAllowed(req, warehouse_type)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)

    // ĐỔI NGÀY chỉ cho đơn PENDING (mirror bulkUpdateOrderDate): đơn đã BOOKED/ARRIVED có TmsVehicleSlot
    // gắn DeliverySlot theo ngày cũ — đổi TmsOrder.date ở đây KHÔNG recount slot → booked_count lệch (xe ma).
    // Muốn đổi ngày đơn đã đặt lịch → huỷ đặt lịch (revoke) rồi đặt lại, hoặc dùng luồng đổi lịch chuyên dụng.
    if (date !== undefined && date !== existing.date) {
      if (existing.status !== 'PENDING')
        return fail(res, 'Đơn đã đặt lịch/đã đến — không đổi được ngày ở đây (huỷ đặt lịch trước rồi đặt lại)', 400)
      if (date < todayVN())
        return fail(res, 'Không thể chuyển sang ngày quá khứ', 400)
    }
    if (eta && String(eta).slice(0, 10) < todayVN())
      return fail(res, 'Dự kiến giao không thể là ngày quá khứ', 400)

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
    const { data, error } = await supabase.from('TmsOrder')
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
    if (date < todayVN()) return fail(res, 'Không thể chuyển sang ngày quá khứ', 400)

    // Scope-write: mọi lệnh trong lô phải thuộc kho trong phạm vi (ASSIGNED). NATIONAL/ĐVVT → bỏ qua.
    const scope = scopeWhIds(req)
    if (scope !== null) {
      // Chunk ids (500/lượt) + phân trang — ids >1000 mà không chunk thì cap-1000 làm LỌT lệnh khỏi kiểm scope
      const ords = await fetchAllByIdChunks(ids, chunk => supabase.from('TmsOrder')
        .select('warehouse_id, destination_warehouse_id').in('id', chunk).order('id'), 500)
      const bad = (ords ?? []).some((o: { warehouse_id: string | null; destination_warehouse_id: string | null }) =>
        !whInScope(scope, o.warehouse_id, o.destination_warehouse_id))
      if (bad) return fail(res, 'Ngoài phạm vi kho — có lệnh thuộc kho ngoài phạm vi được giao', 403)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = req.user
    const now = new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // Chỉ đổi ngày đơn PENDING (đơn đã BOOKED/ARRIVED không được đổi → tránh lệch slot booked_count)
    const { data, error } = await supabase.from('TmsOrder')
      .update({ date, updated_by: user?.name || null, updated_at: now })
      .in('id', ids)
      .eq('status', 'PENDING')
      .select('id')
    if (error) return fail(res, error.message)

    // Đơn NHẬP: dòng KH (inbound_plan_lines) mang date riêng — đổi theo, không thì lệch ngày đơn vs dòng
    // (báo cáo nhập theo ngày + khóa gộp upload đều bám date của dòng). Đơn xuất không có lines → no-op.
    const updatedIds = (data ?? []).map((o: { id: string }) => o.id)
    for (let i = 0; i < updatedIds.length; i += 300) {
      const { error: lineErr } = await supabase.from('inbound_plan_lines')
        .update({ date, updated_by: user?.name || null, updated_at: now })
        .in('tms_order_id', updatedIds.slice(i, i + 300))
      if (lineErr) return fail(res, lineErr.message)
    }
    return ok(res, { updated: updatedIds.length })
  } catch (e) { return fail(res, String(e)) }
}

// GET /api/tms/orders/:orderId/plan-vs-actual
// So sánh kế hoạch (InboundPlanLine) vs thực tế (InventoryEntry quét) theo từng mã hàng
export async function getPlanVsActual(req: Request, res: Response) {
  try {
    const { orderId } = req.params

    // Plan lines (kế hoạch)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: planLines, error: planErr } = await supabase.from('inbound_plan_lines')
      .select('material_id, planned_boxes, planned_pallets, material:Material!material_id(material_code, short_name, material_description)')
      .eq('tms_order_id', orderId)
      .neq('status', 'CANCELLED')
    if (planErr) return fail(res, planErr.message)

    // ProductionImport records cho order này (kèm no_qr + mode kho nhận để tính "no-QR hiệu lực")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actualOrders, error: actErr } = await supabase.from('ProductionImport')
      .select('id, material_id, posm_cartons, material:Material!material_id(material_code, short_name, material_description, no_qr_tracking), warehouse:Warehouse!warehouse_id(inventory_mode)')
      .eq('tms_order_id', orderId)
      .neq('status', 'CANCELLED')
    if (actErr) return fail(res, actErr.message)

    // Thực nhận theo material: mã no-QR hiệu lực (mã no_qr_tracking HOẶC kho nhận QTY) → posm_cartons
    // (pool dùng chung, import_order_id ≠ phiếu nên không khớp InventoryEntry theo phiếu); còn lại → cartons_imported.
    const actualBoxMap = new Map<string, number>() // material_id → tổng thực nhận
    const qrImportIds: string[] = []
    const importMaterialMap = new Map<string, string>() // import_id → material_id
    for (const o of (actualOrders ?? []) as any[]) {
      if (!o.material_id) continue
      importMaterialMap.set(o.id as string, o.material_id as string)
      if (effectiveNoQr(o.material?.no_qr_tracking, o.warehouse?.inventory_mode)) {
        if (o.posm_cartons != null)
          actualBoxMap.set(o.material_id, (actualBoxMap.get(o.material_id) ?? 0) + Number(o.posm_cartons))
      } else {
        qrImportIds.push(o.id as string)
      }
    }
    if (qrImportIds.length > 0) {
      // Phân trang: 1 chuyến chuyển kho có thể >1000 pallet → cap-1000 sẽ cụt tổng thực nhận
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = await fetchAllPaged(() => supabase.from('InventoryEntry')
        .select('import_order_id, cartons_imported')
        .in('import_order_id', qrImportIds)
        .order('import_order_id', { ascending: true }))
      for (const e of entries as any[]) {
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

// POST /api/tms/orders/material-summary  body: { order_ids: string[] }
// Tổng hợp theo MÃ HÀNG across nhiều đơn (band tra cứu ở danh sách): kế hoạch (inbound_plan_lines)
// vs thực nhận (ProductionImport → InventoryEntry; mã no-QR dùng posm_cartons). Khớp với actual_received của list.
export async function getMaterialSummary(req: Request, res: Response) {
  try {
    const { order_ids } = req.body as { order_ids?: string[] }
    if (!Array.isArray(order_ids) || order_ids.length === 0) return ok(res, [])

    type Row = { material_id: string; material_code: string; material_name: string; unit: string; planned_boxes: number; actual_boxes: number }
    const byMat: Record<string, Row> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ensure = (mid: string, m: any): Row => {
      if (!byMat[mid]) byMat[mid] = {
        material_id: mid,
        material_code: m?.material_code ?? '',
        material_name: m?.short_name ?? m?.material_description ?? '',
        unit: m?.unit ?? '',
        planned_boxes: 0, actual_boxes: 0,
      }
      return byMat[mid]
    }

    // 1) Kế hoạch từ inbound_plan_lines
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planLines = await fetchAllByIdChunks(order_ids, (chunk) => supabase.from('inbound_plan_lines')
      .select('material_id, planned_boxes, material:Material!material_id(material_code, short_name, material_description, unit)')
      .in('tms_order_id', chunk).neq('status', 'CANCELLED').order('material_id', { ascending: true }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const l of planLines as any[]) {
      if (!l.material_id) continue
      ensure(l.material_id, l.material).planned_boxes += (l.planned_boxes ?? 0) as number
    }

    // 2) Thực nhận từ ProductionImport (+ InventoryEntry cho mã QR, posm_cartons cho mã no-QR)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imports = await fetchAllByIdChunks(order_ids, (chunk) => supabase.from('ProductionImport')
      .select('id, material_id, posm_cartons, material:Material!material_id(material_code, short_name, material_description, unit, no_qr_tracking), warehouse:Warehouse!warehouse_id(inventory_mode)')
      .in('tms_order_id', chunk).neq('status', 'CANCELLED').order('id', { ascending: true }))
    const qrImportIds: string[] = []
    const importToMat = new Map<string, string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const imp of imports as any[]) {
      if (!imp.material_id) continue
      const row = ensure(imp.material_id, imp.material)
      importToMat.set(imp.id, imp.material_id)
      if (effectiveNoQr(imp.material?.no_qr_tracking, imp.warehouse?.inventory_mode)) {
        if (imp.posm_cartons != null) row.actual_boxes += Number(imp.posm_cartons)
      } else {
        qrImportIds.push(imp.id)
      }
    }
    if (qrImportIds.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = await fetchAllByIdChunks(qrImportIds, (chunk) => supabase.from('InventoryEntry')
        .select('import_order_id, cartons_imported').in('import_order_id', chunk).order('import_order_id', { ascending: true }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const e of entries as any[]) {
        const mid = importToMat.get(e.import_order_id as string)
        if (!mid) continue
        byMat[mid].actual_boxes += (e.cartons_imported ?? 0) as number
      }
    }

    const rows = Object.values(byMat)
      .map(r => ({ ...r, diff: r.actual_boxes - r.planned_boxes }))
      .sort((a, b) => b.planned_boxes - a.planned_boxes)
    return ok(res, rows)
  } catch (e) { return fail(res, String(e)) }
}

// GET /api/tms/reports/inbound?date_from=&date_to=&warehouse_id=
// Báo cáo nhập hàng: kế hoạch (inbound_plan_lines) vs thực tế (ProductionImport)
export async function getInboundReport(req: Request, res: Response) {
  try {
    const { date_from, date_to, warehouse_id } = req.query as Record<string, string>
    if (!date_from || !date_to) return fail(res, 'date_from và date_to là bắt buộc', 400)

    // Scope kho + loại hàng (RULE user): chọn "Tất cả" vẫn CHỈ thấy kho/loại được gán —
    // trước đây không cắt gì → non-admin bỏ trống filter là xem được toàn bộ báo cáo nhập.
    const whScope = scopeWhIds(req)
    if (whScope !== null && warehouse_id && !whScope.includes(warehouse_id))
      return fail(res, 'Ngoài phạm vi kho được giao', 403)
    const whIds: string[] | null = warehouse_id ? [warehouse_id] : whScope   // null = không giới hạn
    if (whIds !== null && whIds.length === 0) return ok(res, [])

    // 1. Fetch plan lines với join material, ncc, warehouse — PHÂN TRANG (cap ~1000/response):
    // khoảng ngày rộng có thể vài nghìn dòng KH, không phân trang = báo cáo cắt cụt âm thầm.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let planLines: any[]
    try {
      planLines = await fetchAllPaged(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = supabase.from('inbound_plan_lines')
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
          .order('id')
        if (whIds) q = whIds.length === 1 ? q.eq('warehouse_id', whIds[0]) : q.in('warehouse_id', whIds)
        return q
      })
    } catch (e) { return fail(res, (e as Error).message) }
    // Cắt theo Loại hàng của user (null-inclusive: dòng không khai loại vẫn hiện)
    planLines = planLines.filter((l: any) => categoryAllowed(req, l.material?.category))

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
      // Chunk orderIds (URL 414 khi hàng trăm/nghìn lệnh) + phân trang mỗi lô (cap ~1000)
      try {
        allImports = await fetchAllByIdChunks(orderIds, chunk => supabase.from('ProductionImport')
          .select(IMPORT_SELECT)
          .in('tms_order_id', chunk)
          .neq('status', 'CANCELLED')
          .order('id'))
      } catch (e) { return fail(res, (e as Error).message) }
    }

    // Thêm imports theo date range (bắt phát sinh thuần — không nằm trong plan nào) — phân trang
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dateImports: any[]
    try {
      dateImports = await fetchAllPaged(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let dateQ = supabase.from('ProductionImport')
          .select(IMPORT_SELECT)
          .gte('import_date', date_from)
          .lte('import_date', date_to)
          .neq('status', 'CANCELLED')
          .order('id')
        if (whIds) dateQ = whIds.length === 1 ? dateQ.eq('warehouse_id', whIds[0]) : dateQ.in('warehouse_id', whIds)
        return dateQ
      })
    } catch (e) { return fail(res, (e as Error).message) }

    // Merge + dedup by id
    const seenImportIds = new Set<string>(allImports.map((i: any) => i.id as string))
    for (const imp of (dateImports ?? []) as any[]) {
      if (!seenImportIds.has(imp.id)) {
        seenImportIds.add(imp.id)
        allImports.push(imp)
      }
    }
    // Cắt phiếu nhập theo Loại hàng của user (null-inclusive)
    allImports = allImports.filter((i: any) => categoryAllowed(req, i.material?.category))

    // Fetch InventoryEntry cho tất cả imports
    const importIds = allImports.map((i: any) => i.id as string)
    const importMeta = new Map<string, { tms_order_id: string; material_id: string }>()
    for (const i of allImports) {
      importMeta.set(i.id, { tms_order_id: i.tms_order_id, material_id: i.material_id })
    }

    if (importIds.length > 0) {
      // Phân trang né cap-1000 (báo cáo nhập gộp nhiều chuyến → có thể >1000 entry)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = await fetchAllPaged(() => supabase.from('InventoryEntry')
        .select('import_order_id, cartons_imported')
        .in('import_order_id', importIds)
        .order('import_order_id', { ascending: true }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const e of entries as any[]) {
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

// POST /api/tms/orders/:id/confirm-receipt  — NPP xác nhận nhận hàng → tạo ProductionImport
// NSX breakdown từ tem đã quét xuất ở kho nguồn: material_id → các dòng (NSX, Σ thùng, số pallet).
// Kho nhận QTY_DATE dùng để tách 1 phiếu nhập / (mã × NSX) — người nhận không phải nhìn tem gõ NSX,
// và 1 lần 1 mã nhận được NHIỀU date. Hàng no-QR (tem không có / production_date null) → dòng nsx=null.
type TransferNsxLine = { nsx: string | null; cartons: number; pallets: number }
async function transferNsxBreakdown(
  items: { id: string; material_id: string | null }[],
  materialCodeById: Map<string, string | null>,
): Promise<Map<string, TransferNsxLine[]>> {
  const itemMat = new Map(items.map(i => [i.id, i.material_id]))
  const scans = await fetchAllByIdChunks(items.map(i => i.id), chunk => supabase.from('OutboundScanEntry')
    .select('item_id, pallet_code, cartons_scanned, production_date').in('item_id', chunk).order('id'))
  const byKey = new Map<string, { material_id: string; nsx: string | null; cartons: number; palletCodes: Set<string> }>()
  for (const s of (scans ?? []) as { item_id: string; pallet_code: string | null; cartons_scanned: number | null; production_date: string | null }[]) {
    const mid = itemMat.get(s.item_id)
    if (!mid) continue
    const nsx = s.production_date ? String(s.production_date).slice(0, 10) : null
    const key = `${mid}|${nsx ?? ''}`
    const cur = byKey.get(key) ?? { material_id: mid, nsx, cartons: 0, palletCodes: new Set<string>() }
    cur.cartons += Number(s.cartons_scanned) || 0
    // Đếm pallet thật để đối chiếu tem khi nhận (hàng no-QR ghi pallet_code = mã hàng → không phải tem)
    if (s.pallet_code && s.pallet_code !== materialCodeById.get(mid)) cur.palletCodes.add(s.pallet_code)
    byKey.set(key, cur)
  }
  const out = new Map<string, TransferNsxLine[]>()
  for (const g of byKey.values()) {
    if (g.cartons <= 0) continue
    const list = out.get(g.material_id) ?? []
    list.push({ nsx: g.nsx, cartons: g.cartons, pallets: g.palletCodes.size })
    out.set(g.material_id, list)
  }
  for (const list of out.values()) list.sort((a, b) => ((a.nsx ?? '9999-99-99') < (b.nsx ?? '9999-99-99') ? -1 : 1))
  return out
}

export async function confirmTransferReceipt(req: Request, res: Response) {
  try {
    const { id } = req.params
    const t = new Date().toISOString()
    if (!(await guardOrderScope(req, res, id))) return

    const { data: tmsOrder } = await supabase.from('TmsOrder')
      .select('id, eta, destination_warehouse_id, transfer_gdo_id, warehouse:Warehouse!destination_warehouse_id(id, code, name, parent_warehouse_id, inventory_mode)')
      .eq('id', id).single()
    if (!tmsOrder) return fail(res, 'Không tìm thấy lệnh chuyển kho', 404)
    if (!tmsOrder.transfer_gdo_id) return fail(res, 'Lệnh này không phải lệnh chuyển kho', 400)
    if (!tmsOrder.destination_warehouse_id) return fail(res, 'Lệnh chưa có kho nhận', 400)

    const gdoId = tmsOrder.transfer_gdo_id as string
    const nppWh = tmsOrder.warehouse as unknown as { id: string; code: string; name: string; parent_warehouse_id: string | null; inventory_mode: string | null }

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('id, status, transfer_status, warehouse_id').eq('id', gdoId).single()
    if (!gdo) return fail(res, 'Không tìm thấy GDO', 404)
    if (gdo.transfer_status === 'DELIVERED') return fail(res, 'GDO này đã được xác nhận giao', 409)
    if (gdo.transfer_status !== 'IN_TRANSIT') return fail(res, 'GDO phải ở trạng thái Đang giao trước khi xác nhận', 400)
    // Kho xuất đang gỡ hoàn thành để sửa (lệnh giữ lại để không mất booking) → chờ chốt lại mới cho nhận
    if (gdo.status !== 'COMPLETED')
      return fail(res, 'Kho xuất đang sửa đơn (đã bỏ hoàn thành) — chờ kho xuất hoàn thành lại rồi mới nhận hàng', 409)

    // Gác ĐVVT booking: phải đủ Biển số + SĐT lái xe + Giờ xe tới (ETA) mới cho NPP nhận hàng.
    // MIỄN gác khi kho nhận là KHO PHỤ NỘI BỘ của chính kho xuất (cùng site — xe nâng/đẩy tay, không có xe tải).
    const isInternalDest = !!nppWh.parent_warehouse_id && nppWh.parent_warehouse_id === (gdo as { warehouse_id?: string | null }).warehouse_id
    if (!isInternalDest) {
      const { data: bkSlots } = await supabase.from('TmsVehicleSlot')
        .select('license_plate, driver_phone').eq('order_id', id)
      const bk = ((bkSlots ?? []) as { license_plate: string | null; driver_phone: string | null }[])[0]
      if (!bk?.license_plate?.trim() || !bk?.driver_phone?.trim() || !tmsOrder.eta)
        return fail(res, 'Cần ĐVVT booking (đủ Biển số, SĐT lái xe, Giờ xe tới) trước khi nhận hàng', 400)
    }

    const { count: existing } = await supabase.from('ProductionImport')
      .select('id', { count: 'exact', head: true }).eq('from_gdo_id', gdoId).neq('status', 'CANCELLED')
    if (existing && existing > 0) return fail(res, 'Đã tạo phiếu nhập cho lô hàng này rồi', 409)

    // CHỐT NHẬN NGUYÊN TỬ: nhiều người cùng bấm Nhận → chỉ 1 request thắng CAS IN_TRANSIT→RECEIVING
    // (check-then-act ở trên không đủ — 5 request đồng thời từng tạo 3 bộ phiếu trùng).
    const { data: claimed } = await supabase.from('GroupDeliveryOrder')
      .update({ transfer_status: 'RECEIVING', updated_at: t })
      .eq('id', gdoId).eq('transfer_status', 'IN_TRANSIT').select('id')
    if (!claimed?.length) return fail(res, 'Đã có người khác bắt đầu nhận lô hàng này', 409)

    const dos = await fetchAllPaged(() => supabase.from('OutboundDelivery')
      .select('id').eq('gdo_id', gdoId).order('id'))
    const doIds: string[] = (dos ?? []).map((d: { id: string }) => d.id)
    if (!doIds.length) return fail(res, 'GDO không có đơn giao hàng', 400)

    // Phiếu nhập tách từ list này — thiếu item (cap-1000) = có mã KHÔNG được tạo phiếu nhận → chunk + phân trang
    const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
      .select('id, material_id, cartons_ordered, material_type, material:Material(category, material_code)')
      .in('do_id', chunk).order('id'))

    const matMap = new Map<string, { material_id: string; cartons: number; category: string | null; material_code: string | null }>()
    for (const item of (items ?? []) as any[]) {
      if (!item.material_id) continue
      if (!matMap.has(item.material_id))
        matMap.set(item.material_id, { material_id: item.material_id, cartons: 0, category: item.material?.category ?? null, material_code: item.material?.material_code ?? null })
      matMap.get(item.material_id)!.cartons += item.cartons_ordered || 0
    }
    if (!matMap.size) return fail(res, 'GDO không có mặt hàng hợp lệ', 400)

    // Kho nhận QTY_DATE: tách phiếu theo (mã × NSX) kế thừa từ tem quét xuất — Σ thùng theo THỰC QUÉT
    // từng NSX; mã không có tem quét (GDO cũ) → giữ 1 phiếu theo KH, NSX gõ tay lúc nhận.
    type ImportLine = { material_id: string; cartons: number; pallets: number; category: string | null; nsx: string | null }
    let importLines: ImportLine[] = [...matMap.values()]
      .map(m => ({ material_id: m.material_id, cartons: m.cartons, pallets: 0, category: m.category, nsx: null }))
    if (nppWh.inventory_mode === 'QTY_DATE') {
      const matCodeById = new Map([...matMap.values()].map(m => [m.material_id, m.material_code]))
      const nsxByMat = await transferNsxBreakdown(
        ((items ?? []) as { id: string; material_id: string | null }[]).map(i => ({ id: i.id, material_id: i.material_id })),
        matCodeById)
      importLines = [...matMap.values()].flatMap(m => {
        const lines = nsxByMat.get(m.material_id)
        if (!lines?.length)
          return [{ material_id: m.material_id, cartons: m.cartons, pallets: 0, category: m.category, nsx: null as string | null }]
        return lines.map(l => ({ material_id: m.material_id, cartons: l.cartons, pallets: l.pallets, category: m.category, nsx: l.nsx }))
      })
    }

    const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const [vy, vm, vd] = vnDate.split('-')
    const ddmmyy = `${vd}${vm}${vy.slice(2)}`
    const importPrefix = `${nppWh.code}_N_${ddmmyy}_`
    // Đánh số phiếu: retry+jitter khi trùng số với lệnh KHÁC nhận cùng kho cùng lúc (23505)
    let created = 0
    let lastErr: string | null = null
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: existingCodes } = await supabase.from('ProductionImport')
        .select('import_code').ilike('import_code', `${importPrefix}%`)
      const maxSeq = (existingCodes ?? []).reduce((max: number, r: { import_code: string }) => {
        const n = parseInt(r.import_code.slice(importPrefix.length), 10)
        return isNaN(n) ? max : Math.max(max, n)
      }, 0)

      const toInsert = importLines.map((m, idx) => ({
        id: randomUUID(),
        import_code: `${importPrefix}${String(maxSeq + idx + 1).padStart(2, '0')}`,
        warehouse_id: tmsOrder.destination_warehouse_id,
        material_id: m.material_id,
        planned_cartons: m.cartons,
        planned_pallets: m.pallets,
        status: 'OPEN',
        source_type: 'TRANSFER',
        warehouse_type: m.category ?? null,
        import_date: vnDate,
        from_gdo_id: gdoId,
        tms_order_id: id,
        transfer_production_date: m.nsx,
        updated_at: t,
      }))
      const { error: insertError } = await supabase.from('ProductionImport').insert(toInsert)
      if (!insertError) { created = toInsert.length; lastErr = null; break }
      lastErr = insertError.message
      if (insertError.code !== '23505') break
      await new Promise(r => setTimeout(r, 15 + Math.floor(Math.random() * (40 + attempt * 25))))
    }
    if (lastErr) {
      // Không tạo được phiếu → NHẢ chốt nhận (trả IN_TRANSIT) để người khác/lần sau nhận lại được
      await supabase.from('GroupDeliveryOrder')
        .update({ transfer_status: 'IN_TRANSIT', updated_at: new Date().toISOString() })
        .eq('id', gdoId).eq('transfer_status', 'RECEIVING')
      return fail(res, `Lỗi tạo phiếu nhập: ${lastErr}`, 500)
    }

    return ok(res, { created })
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders/:id/create-one-inbound — tạo phiếu nhập cho 1 mã hàng bị thiếu
export async function createOneInbound(req: Request, res: Response) {
  try {
    const { id } = req.params
    // production_date + planned_cartons (tùy chọn): THÊM 1 dòng NSX mới cho mã ở kho QTY_DATE
    // (hàng về có NSX ngoài dữ liệu quét xuất) — trùng (mã × NSX) mới chặn, khác NSX vẫn thêm được.
    const { material_id, production_date, planned_cartons } = req.body as { material_id: string; production_date?: string | null; planned_cartons?: number | null }
    if (!material_id) return fail(res, 'Thiếu material_id', 400)
    const manualNsx = /^\d{4}-\d{2}-\d{2}$/.test(String(production_date ?? '')) ? String(production_date).slice(0, 10) : null
    if (!(await guardOrderScope(req, res, id))) return

    const t = new Date().toISOString()
    const { data: tmsOrder } = await supabase.from('TmsOrder')
      .select('id, destination_warehouse_id, transfer_gdo_id, warehouse:Warehouse!destination_warehouse_id(id, code, inventory_mode)')
      .eq('id', id).single()
    if (!tmsOrder) return fail(res, 'Không tìm thấy lệnh chuyển kho', 404)
    if (!tmsOrder.transfer_gdo_id) return fail(res, 'Lệnh không phải chuyển kho', 400)
    if (!tmsOrder.destination_warehouse_id) return fail(res, 'Lệnh chưa có kho nhận', 400)

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('id, transfer_status').eq('id', tmsOrder.transfer_gdo_id).single()
    if (!gdo || gdo.transfer_status !== 'RECEIVING')
      return fail(res, 'GDO phải đang ở trạng thái Đang nhận', 400)

    // Kiểm tra trùng: thêm dòng NSX cụ thể → chặn theo (mã × NSX); tạo lại phiếu mã thiếu → chặn theo mã
    let dupQ = supabase.from('ProductionImport')
      .select('id').eq('tms_order_id', id).eq('material_id', material_id)
    if (manualNsx) dupQ = dupQ.eq('transfer_production_date', manualNsx)
    const { data: existing } = await dupQ
    if ((existing ?? []).length > 0)
      return fail(res, manualNsx ? `Đã có dòng nhận NSX ${manualNsx} cho mã hàng này` : 'Đã có phiếu nhập cho mã hàng này', 409)

    // Lấy planned_cartons từ GDO outbound items
    const { data: dos } = await supabase.from('OutboundDelivery')
      .select('id').eq('gdo_id', tmsOrder.transfer_gdo_id)
    const doIds = (dos ?? []).map((d: { id: string }) => d.id)
    let plannedCartons = 0
    let matItems: { id: string; material_id: string | null }[] = []
    if (doIds.length > 0) {
      const { data: items } = await supabase.from('OutboundItem')
        .select('id, cartons_ordered').in('do_id', doIds).eq('material_id', material_id)
      plannedCartons = (items ?? []).reduce((s: number, i: { cartons_ordered: number }) => s + (i.cartons_ordered || 0), 0)
      matItems = ((items ?? []) as { id: string }[]).map(i => ({ id: i.id, material_id }))
    }

    // Lấy category của material
    const { data: mat } = await supabase.from('Material')
      .select('category, material_code').eq('id', material_id).maybeSingle()

    // Thêm dòng NSX cụ thể (gõ tay) → 1 phiếu đúng NSX đó; còn lại: kho QTY_DATE tách theo tem quét xuất
    const destMode = (tmsOrder.warehouse as unknown as { inventory_mode?: string | null })?.inventory_mode ?? null
    let lines: TransferNsxLine[] = [{ nsx: null, cartons: plannedCartons, pallets: 0 }]
    if (manualNsx) {
      lines = [{ nsx: manualNsx, cartons: Math.max(0, Number(planned_cartons) || 0), pallets: 0 }]
    } else if (destMode === 'QTY_DATE' && matItems.length) {
      const nsxByMat = await transferNsxBreakdown(matItems, new Map([[material_id, (mat as any)?.material_code ?? null]]))
      const found = nsxByMat.get(material_id)
      if (found?.length) lines = found
    }

    // Generate import_code
    const vnDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    const [vy, vm, vd] = vnDate.split('-')
    const ddmmyy = `${vd}${vm}${vy.slice(2)}`
    const whCode = (tmsOrder.warehouse as unknown as { code: string })?.code ?? 'XX'
    const prefix = `${whCode}_N_${ddmmyy}_`
    const { data: existingCodes } = await supabase.from('ProductionImport')
      .select('import_code').ilike('import_code', `${prefix}%`)
    const maxSeq = (existingCodes ?? []).reduce((max: number, r: { import_code: string }) => {
      const n = parseInt(r.import_code.slice(prefix.length), 10)
      return isNaN(n) ? max : Math.max(max, n)
    }, 0)

    const { data: created, error } = await supabase.from('ProductionImport').insert(lines.map((l, idx) => ({
      id:              randomUUID(),
      import_code:     `${prefix}${String(maxSeq + idx + 1).padStart(2, '0')}`,
      warehouse_id:    tmsOrder.destination_warehouse_id,
      material_id,
      planned_cartons: l.cartons || null,
      planned_pallets: l.pallets,
      status:          'OPEN',
      source_type:     'TRANSFER',
      warehouse_type:  (mat as any)?.category ?? null,
      import_date:     vnDate,
      from_gdo_id:     tmsOrder.transfer_gdo_id,
      tms_order_id:    id,
      transfer_production_date: l.nsx,
      updated_at:      t,
    }))).select('id, import_code, status, material_id')
    if (error) throw error

    return ok(res, created, 201)
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders/:id/cancel-receipt
export async function cancelTransferReceipt(req: Request, res: Response) {
  try {
    const { id } = req.params
    const t = new Date().toISOString()
    if (!(await guardOrderScope(req, res, id))) return

    const { data: tmsOrder } = await supabase.from('TmsOrder')
      .select('id, transfer_gdo_id').eq('id', id).single()
    if (!tmsOrder) return fail(res, 'Không tìm thấy lệnh chuyển kho', 404)
    if (!tmsOrder.transfer_gdo_id) return fail(res, 'Lệnh này không phải lệnh chuyển kho', 400)

    const gdoId = tmsOrder.transfer_gdo_id as string

    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('id, transfer_status').eq('id', gdoId).single()
    if (!gdo) return fail(res, 'Không tìm thấy GDO', 404)
    if (gdo.transfer_status !== 'RECEIVING') return fail(res, 'Lệnh không ở trạng thái Đang nhận', 400)

    // Không cho phép hủy nếu còn phiếu nhập đang hoạt động (OPEN hoặc COMPLETED)
    // NPP phải tự hủy/hoàn thành từng phiếu qua module Nhập kho trước
    const { count: activeCount } = await supabase.from('ProductionImport')
      .select('id', { count: 'exact', head: true })
      .eq('from_gdo_id', gdoId).neq('status', 'CANCELLED')
    if (activeCount && activeCount > 0)
      return fail(res, `Còn ${activeCount} phiếu nhập đang hoạt động — hủy từng phiếu ở module Nhập kho trước`, 409)

    // Reset GDO về IN_TRANSIT
    await supabase.from('GroupDeliveryOrder')
      .update({ transfer_status: 'IN_TRANSIT', updated_at: t }).eq('id', gdoId)

    return ok(res, { cancelled: true })
  } catch (e) { return fail(res, String(e)) }
}

// POST /api/tms/orders/:id/self-complete — booking SELF (kho nhận NONE / khách ngoài OTHER): tài xế TỰ HOÀN THÀNH.
// KHÔNG nhận-quét, KHÔNG tạo tồn/ProductionImport — chỉ đánh dấu đã giao: GDO.transfer_status=DELIVERED + TmsOrder.status=DONE.
export async function selfCompleteTransfer(req: Request, res: Response) {
  try {
    const { id } = req.params
    const t = new Date().toISOString()
    if (!(await guardOrderScope(req, res, id))) return

    const { data: tmsOrder } = await supabase.from('TmsOrder')
      .select('id, eta, delivery_mode, transfer_gdo_id').eq('id', id).single()
    if (!tmsOrder) return fail(res, 'Không tìm thấy lệnh chuyển kho', 404)
    if (!tmsOrder.transfer_gdo_id) return fail(res, 'Lệnh này không phải lệnh chuyển kho', 400)
    if (tmsOrder.delivery_mode !== 'SELF') return fail(res, 'Lệnh này cần nhận-quét, không thể tự hoàn thành', 400)

    const gdoId = tmsOrder.transfer_gdo_id as string
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('id, status, transfer_status').eq('id', gdoId).single()
    if (!gdo) return fail(res, 'Không tìm thấy GDO', 404)
    if (gdo.transfer_status === 'DELIVERED') return fail(res, 'Đã hoàn thành giao hàng', 409)
    if (gdo.transfer_status !== 'IN_TRANSIT') return fail(res, 'GDO phải ở trạng thái Đang giao', 400)
    // Kho xuất đang gỡ hoàn thành để sửa → chờ chốt lại mới cho tài xế tự hoàn thành
    if (gdo.status !== 'COMPLETED')
      return fail(res, 'Kho xuất đang sửa đơn (đã bỏ hoàn thành) — chờ kho xuất hoàn thành lại rồi mới hoàn thành giao', 409)

    // Gác ĐVVT booking: đủ Biển số + SĐT lái xe + Giờ xe tới (giờ giao) mới cho Hoàn thành.
    const { data: bkSlots } = await supabase.from('TmsVehicleSlot')
      .select('license_plate, driver_phone').eq('order_id', id)
    const bk = ((bkSlots ?? []) as { license_plate: string | null; driver_phone: string | null }[])[0]
    if (!bk?.license_plate?.trim() || !bk?.driver_phone?.trim() || !tmsOrder.eta)
      return fail(res, 'Cần ĐVVT booking (đủ Biển số, SĐT lái xe, Giờ xe tới) trước khi hoàn thành', 400)

    await supabase.from('TmsOrder').update({ status: 'DONE', completed_at: t, updated_at: t }).eq('id', id)
    await supabase.from('GroupDeliveryOrder').update({ transfer_status: 'DELIVERED', updated_at: t }).eq('id', gdoId)
    return ok(res, { completed: true })
  } catch (e) { return fail(res, String(e)) }
}

// GET /api/tms/orders/:id/transfer-goods
export async function getTransferGoods(req: Request, res: Response) {
  try {
    const { id } = req.params

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tmsOrder } = await supabase.from('TmsOrder')
      .select('id, transfer_gdo_id').eq('id', id).maybeSingle()
    if (!tmsOrder) return fail(res, 'Không tìm thấy lệnh', 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: planLines } = await supabase.from('inbound_plan_lines')
      .select('material_id, planned_boxes, material:Material(id, material_code, short_name, unit)')
      .eq('tms_order_id', id)
      .neq('status', 'CANCELLED')

    if (!(planLines ?? []).length) return ok(res, [])

    // Pallet xuất từ kho nguồn: GDO → OutboundDelivery → OutboundItem → OutboundScanEntry
    type OutPallet = { pallet_code: string; cartons_outbound: number }
    const outPalletsByMat = new Map<string, Map<string, OutPallet>>()

    if (tmsOrder.transfer_gdo_id) {
      const dos = await fetchAllPaged(() => supabase.from('OutboundDelivery')
        .select('id').eq('gdo_id', tmsOrder.transfer_gdo_id).order('id'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doIds = (dos ?? []).map((d: any) => d.id as string)

      if (doIds.length) {
        // Bảng đối chiếu pallet xuất↔nhận — thiếu item (cap-1000) = scan không map được mã → chunk + phân trang
        const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
          .select('id, material_id').in('do_id', chunk).order('id'))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const itemIds = (items ?? []).map((i: any) => i.id as string)
        const itemMatMap = new Map<string, string>()
        for (const item of items ?? []) itemMatMap.set(item.id, item.material_id)

        if (itemIds.length) {
          // Chunk + phân trang né cap-1000: 1 chuyến chuyển kho có thể >1000 pallet quét
          const scans = await fetchAllByIdChunks(itemIds, chunk => supabase.from('OutboundScanEntry')
            .select('item_id, pallet_code, cartons_scanned')
            .in('item_id', chunk).order('id'))

          for (const scan of scans ?? []) {
            if (!scan.pallet_code) continue
            const matId = itemMatMap.get(scan.item_id)
            if (!matId) continue
            if (!outPalletsByMat.has(matId)) outPalletsByMat.set(matId, new Map())
            const byCode = outPalletsByMat.get(matId)!
            if (!byCode.has(scan.pallet_code)) {
              byCode.set(scan.pallet_code, { pallet_code: scan.pallet_code, cartons_outbound: 0 })
            }
            byCode.get(scan.pallet_code)!.cartons_outbound += (scan.cartons_scanned ?? 0)
          }
        }
      }
    }

    // Pallet đã nhận tại kho nhận: ProductionImport → InventoryEntry
    // Lấy mọi phiếu non-cancelled (kể cả OPEN) để "Thùng thực" cập nhật live khi đang nhận.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: importOrders } = await supabase.from('ProductionImport')
      .select('id, material_id, posm_cartons, material:Material!material_id(no_qr_tracking), warehouse:Warehouse!warehouse_id(inventory_mode)')
      .eq('tms_order_id', id).eq('source_type', 'TRANSFER').neq('status', 'CANCELLED')
    const importIds: string[] = (importOrders ?? []).map((o: any) => o.id)

    // Mã no-QR (Loscam/POSM): nhận vào pool dùng chung (import_order_id ≠ phiếu) nên không khớp
    // InventoryEntry theo phiếu → actual lấy theo posm_cartons (đóng góp thực của phiếu transfer).
    const posmByMaterial = new Map<string, number>()
    const noQrMat = new Set<string>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const o of (importOrders ?? []) as any[]) {
      if (effectiveNoQr(o.material?.no_qr_tracking, o.warehouse?.inventory_mode) && o.material_id) {
        noQrMat.add(o.material_id)
        if (o.posm_cartons != null)
          posmByMaterial.set(o.material_id, (posmByMaterial.get(o.material_id) ?? 0) + Number(o.posm_cartons))
      }
    }

    type InboundPallet = { cartons_inbound: number; inbound_at: string | null }
    const inboundByPalletCode = new Map<string, InboundPallet>()
    // Fallback cho Loscam/POSM: không có OutboundScanEntry, lookup theo material_id
    const inboundByMaterialId = new Map<string, InboundPallet & { pallet_code: string }>()

    if (importIds.length) {
      // Phân trang né cap-1000: 1 chuyến chuyển kho có thể >1000 pallet → bảng hàng/chênh lệch sẽ cụt
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = await fetchAllPaged(() => supabase.from('InventoryEntry')
        .select('material_id, pallet_code, cartons_imported, created_at')
        .in('import_order_id', importIds)
        .order('import_order_id', { ascending: true }))

      for (const entry of entries) {
        if (!entry.pallet_code) continue
        const existing = inboundByPalletCode.get(entry.pallet_code)
        inboundByPalletCode.set(entry.pallet_code, {
          cartons_inbound: (existing?.cartons_inbound ?? 0) + (entry.cartons_imported ?? 0),
          inbound_at: existing?.inbound_at ?? entry.created_at ?? null,
        })
        if (entry.material_id) {
          const existingM = inboundByMaterialId.get(entry.material_id)
          inboundByMaterialId.set(entry.material_id, {
            cartons_inbound: (existingM?.cartons_inbound ?? 0) + (entry.cartons_imported ?? 0),
            inbound_at: existingM?.inbound_at ?? entry.created_at ?? null,
            pallet_code: existingM?.pallet_code ?? entry.pallet_code,
          })
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ok(res, (planLines ?? []).map((l: any) => {
      const outPallets = [...(outPalletsByMat.get(l.material_id)?.values() ?? [])]
      let pallets: { pallet_code: string; cartons_outbound: number; cartons_inbound: number; inbound_at: string | null }[]

      if (outPallets.length > 0) {
        // Regular pallets: khớp inbound theo pallet_code
        pallets = outPallets.map(op => {
          const inb = inboundByPalletCode.get(op.pallet_code)
          return {
            pallet_code: op.pallet_code,
            cartons_outbound: op.cartons_outbound,
            cartons_inbound: inb?.cartons_inbound ?? 0,
            inbound_at: inb?.inbound_at ?? null,
          }
        })
      } else {
        // Loscam/POSM: không có OutboundScanEntry — fallback sang inbound by material_id
        const inbM = inboundByMaterialId.get(l.material_id)
        pallets = inbM
          ? [{ pallet_code: inbM.pallet_code, cartons_outbound: 0, cartons_inbound: inbM.cartons_inbound, inbound_at: inbM.inbound_at }]
          : []
      }

      // Thùng thực: no-QR lấy theo posm_cartons (pool dùng chung); còn lại tổng inbound theo mã hàng
      const isNoQr = noQrMat.has(l.material_id)
      const actual_boxes = isNoQr
        ? (posmByMaterial.get(l.material_id) ?? 0)
        : (inboundByMaterialId.get(l.material_id)?.cartons_inbound ?? 0)
      return {
        material_id: l.material_id,
        material_code: l.material?.material_code ?? null,
        material_name: l.material?.short_name ?? null,
        unit: l.material?.unit ?? null,
        planned_boxes: l.planned_boxes,
        actual_boxes,
        no_qr_tracking: isNoQr,
        pallets,
      }
    }))
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /api/tms/orders/:id  — chỉ xoá khi chưa có slot nào BOOKED+
export async function deleteOrder(req: Request, res: Response) {
  try {
    const { id } = req.params
    if (!(await guardOrderScope(req, res, id))) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: order } = await supabase.from('TmsOrder')
      .select('id, source_type, transfer_gdo_id').eq('id', id).single()
    if (!order) return fail(res, 'Không tìm thấy lệnh', 404)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: slots } = await supabase.from('TmsVehicleSlot')
      .select('id, status').eq('order_id', id)
    const hasBooked = (slots ?? []).some((s: { status: string }) =>
      ['BOOKED','ARRIVED','DONE'].includes(s.status)
    )
    if (hasBooked) return fail(res, 'Không thể xoá đơn đã có xe đặt khung giờ', 400)

    if (order.source_type === 'TRANSFER')
      return fail(res, 400, 'TRANSFER_ORDER', 'Lệnh chuyển kho được tạo tự động — gỡ hoàn thành ở Outbound để hủy')

    // Dọn dòng kế hoạch nhập trước (FK inbound_plan_lines→TmsOrder là ON DELETE SET NULL → nếu không xóa,
    // dòng sẽ mồ côi mà vẫn hiện trong Báo cáo nhập theo ngày/kho). Đơn Xuất không có plan-lines → no-op.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('inbound_plan_lines').delete().eq('tms_order_id', id)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('TmsOrder').delete().eq('id', id)
    if (error) return fail(res, error.message)

    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}
