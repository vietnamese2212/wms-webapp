import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { uuidList } from '../../utils/ids'
import { fetchUpTo, LIST_TOO_LARGE_MSG, rowCapForBytes, fetchAllByIdChunks, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { parseListParam } from '../../utils/httpQuery'

function apiErr(res: Response, code: string, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } })
}

// Phạm vi kho của user: null = NATIONAL (toàn bộ); mảng = chỉ các kho được gán
function scopeWhIds(req: Request): string[] | null {
  return req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}
// Gác theo id: bản ghi phải thuộc kho trong phạm vi user (NATIONAL bỏ qua). Trả false + đã gửi 403 nếu chặn.
async function guardGateScope(req: Request, res: Response, id: string): Promise<boolean> {
  const scope = scopeWhIds(req)
  if (scope === null) return true
  const { data } = await supabase.from('gate_registrations').select('warehouse_id').eq('id', id).maybeSingle()
  const whId = (data as { warehouse_id: string | null } | null)?.warehouse_id ?? null
  if (!whId || !scope.includes(whId)) {
    apiErr(res, 'FORBIDDEN', 'Ngoài phạm vi kho được giao — không thể thao tác đăng ký cổng của kho này', 403)
    return false
  }
  return true
}

// Xe "kết hợp": lấy trạng thái chân đối ứng (khác chiều) theo visit_group_id
async function combinedPartnerStatus(visitGroupId: string, partnerDirection: 'INBOUND' | 'OUTBOUND'): Promise<string | null> {
  const { data } = await supabase
    .from('gate_registrations')
    .select('status')
    .eq('visit_group_id', visitGroupId)
    .eq('direction', partnerDirection)
    .maybeSingle()
  return (data as { status: string } | null)?.status ?? null
}

export async function listGateRegistrations(req: Request, res: Response) {
  const {
    date, date_from, date_to,
    warehouse_id, warehouse_type, vehicle_type,
    company_id, direction, status,
  } = req.query as Record<string, string | undefined>

  const scopeWhs = req.user?.warehouse_scope !== 'NATIONAL'
    ? (req.user?.warehouse_ids ?? [])
    : []
  const scopeCats = scopeCategoriesOf(req)
  // Rebuild mỗi trang — phân trang vượt cap ~1000 dòng/response (cổng đông/khoảng ngày rộng → mất bản ghi)
  const buildQuery = () => {
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
    if (scopeWhs.length > 0) q = q.in('warehouse_id', scopeWhs)
    // Cắt theo Loại hàng được phép — đăng ký không khai loại hoặc 'Khác' vẫn hiện
    if (scopeCats) q = q.or(`warehouse_type.is.null,warehouse_type.eq.Khác,warehouse_type.in.(${scopeCats.map(c => `"${c}"`).join(',')})`)
    if (warehouse_id)   q = q.eq('warehouse_id', warehouse_id)
    if (warehouse_type) q = q.eq('warehouse_type', warehouse_type)
    if (vehicle_type)   q = q.eq('vehicle_type', vehicle_type)
    if (company_id)     q = q.eq('company_id', company_id)
    if (direction)      q = q.eq('direction', direction)
    if (status)         q = q.eq('status', status)
    return q
  }
  // Trần dòng: FE render toàn bộ lượt đăng ký ở client → vượt trần thì BÁO RÕ để user thu hẹp,
  // KHÔNG cắt âm thầm (luật CLAUDE.md).
  // Trần tính theo BYTE: đo 28/07 dòng đăng ký cổng ≈ 1.044 B ⇒ trần cũ 10.000 dòng ≈ 10MB,
  // gấp hơn 2 lần trần 4,5MB của Vercel (hàng rào đếm sai đơn vị thì không kịp chặn).
  // (Trang Đăng ký cổng đã dùng cây LAZY `gate_leaves_page`; endpoint phẳng này còn phục vụ
  // picker ở Nhập kho / chi tiết Xuất kho — luôn kèm 1 ngày + 1 kho nên rất nhẹ.)
  const CAP = rowCapForBytes(1044)
  const { rows: data, truncated } = await fetchUpTo(buildQuery, CAP)
  if (truncated) return apiErr(res, 'RANGE_TOO_WIDE', LIST_TOO_LARGE_MSG(CAP), 400)
  return res.json({ success: true, data })
}

// ─── CÂY LƯỜI (user chốt 28/07) ─────────────────────────────────────────────────────────────────
// Trang Đăng ký cổng là cây gập/mở 3 cấp, không phải list phẳng → thay vì tải hết rồi dựng cây ở
// máy: (1) /tree lấy thống kê từng nhóm + tổng, (2) /leaves lấy dòng chi tiết theo đúng thứ tự cây,
// cuộn tới đâu lấy tới đó. Bộ lọc parse 1 CHỖ để 2 endpoint không lệch nhau.
type GateFilterCtx = {
  from: string; to: string
  warehouseId: string | null; warehouseType: string | null
  vehicleTypes: string[] | null; companyId: string | null
  direction: string | null; status: string | null
  scopeWh: string[] | null; categories: string[] | null
  badFilter: boolean       // id gửi lên không phải uuid → không khớp gì (KHÔNG để Postgres 22P02 → 500)
}
// Nhận cả CSV lẫn MẢNG (`?x[]=a&x[]=b`) — tên loại kho/loại xe có thể chứa dấu phẩy nên FE gửi
// mảng; nhận CSV để tương thích link cũ. Sai kiểu ở đây là 500 (đã dính khi test).
const gateCsv = (v?: string | string[]): string[] | null => {
  const a = parseListParam(v) ?? []
  return a.length ? a : null
}
function getGateCtx(req: Request): GateFilterCtx {
  const q = req.query as Record<string, string | string[] | undefined>
  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '')
  const from = str(q.date_from) || str(q.date) || ''
  const to   = str(q.date_to)   || str(q.date) || from
  const scope = scopeWhIds(req)
  const rawCompany = str(q.company_id) || null
  const companyId = rawCompany && uuidList([rawCompany]).length ? rawCompany : null
  return {
    from, to,
    warehouseId: str(q.warehouse_id) || null,
    warehouseType: str(q.warehouse_type) || null,
    vehicleTypes: gateCsv(q.vehicle_types as string | string[] | undefined),
    companyId,
    badFilter: !!rawCompany && !companyId,
    direction: str(q.direction) || null,
    status: str(q.status) || null,
    scopeWh: scope && scope.length ? scope : (scope ? [] : null),
    categories: scopeCategoriesOf(req),
  }
}
const gateRpcParams = (c: GateFilterCtx) => ({
  p_date_from: c.from, p_date_to: c.to,
  p_warehouse_id: c.warehouseId, p_warehouse_type: c.warehouseType,
  p_vehicle_types: c.vehicleTypes, p_company_id: c.companyId,
  p_direction: c.direction, p_status: c.status,
  p_scope_wh: c.scopeWh, p_categories: c.categories,
})

// GET /api/tms/gate-registrations/tree — thống kê từng nhóm (Kho × Loại kho × Loại xe) + tổng
export async function getGateTree(req: Request, res: Response) {
  try {
    const ctx = getGateCtx(req)
    if (!ctx.from) return apiErr(res, 'BAD_REQUEST', 'date hoặc date_from là bắt buộc', 400)
    if (ctx.badFilter || (ctx.scopeWh && ctx.scopeWh.length === 0)) {
      return res.json({ success: true, data: { nodes: [], totals: { total: 0, done: 0, inside: 0, waiting: 0 } } })
    }
    const { data, error } = await supabase.rpc('gate_tree', gateRpcParams(ctx))
    if (error) throw new Error(error.message)
    return res.json({ success: true, data })
  } catch (e) {
    if (isQueryTimeout(e)) return apiErr(res, 'RANGE_TOO_WIDE', QUERY_TIMEOUT_MSG, 400)
    return apiErr(res, 'INTERNAL', String(e), 500)
  }
}

// GET /api/tms/gate-registrations/leaves?offset&limit&order_wh&order_wt&order_vt&collapsed_*
// Thứ tự nhóm do FE gửi xuống (kho theo tên, loại kho/loại xe theo Cài đặt) — SQL không tự đoán.
export async function getGateLeaves(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | string[] | undefined>
    const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '')
    const arr = (v: string | string[] | undefined) => gateCsv(v as string | string[] | undefined)
    const ctx = getGateCtx(req)
    if (!ctx.from) return apiErr(res, 'BAD_REQUEST', 'date hoặc date_from là bắt buộc', 400)
    if (ctx.badFilter || (ctx.scopeWh && ctx.scopeWh.length === 0)) return res.json({ success: true, data: { rows: [], total: 0 } })
    const offset = Math.max(0, Number(one(q.offset)) || 0)
    const limit  = Math.min(500, Math.max(1, Number(one(q.limit)) || 200))
    const { data, error } = await supabase.rpc('gate_leaves_page', {
      p_offset: offset, p_limit: limit, ...gateRpcParams(ctx),
      p_wh_order: arr(q.order_wh), p_wt_order: arr(q.order_wt), p_vt_order: arr(q.order_vt),
      p_collapsed_wh: arr(q.collapsed_wh), p_collapsed_wt: arr(q.collapsed_wt),
      p_collapsed_vt: arr(q.collapsed_vt),
      // Nhãn nhóm rỗng do FE quy định — dùng chung 1 khoá cho thứ tự / gập / hiển thị
      p_wt_null: one(q.wt_null) || '∅', p_vt_null: one(q.vt_null) || '∅',
    })
    if (error) throw new Error(error.message)
    const p = (data ?? {}) as { ids?: string[]; total?: number }
    const ids = p.ids ?? []
    const rows = ids.length
      ? await fetchAllByIdChunks(ids, chunk => supabase.from('gate_registrations').select('*').in('id', chunk).order('id'))
      : []
    // PostgREST `.in()` không giữ thứ tự → sắp lại đúng thứ tự cây mà RPC đã quyết
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any>((rows as any[]).map(r => [r.id as string, r]))
    return res.json({ success: true, data: { rows: ids.map(id => byId.get(id)).filter(Boolean), total: p.total ?? 0 } })
  } catch (e) {
    if (isQueryTimeout(e)) return apiErr(res, 'RANGE_TOO_WIDE', QUERY_TIMEOUT_MSG, 400)
    return apiErr(res, 'INTERNAL', String(e), 500)
  }
}

// NCC KHÔNG booking: fallback tìm đơn KH nhập PENDING (chưa book khung giờ) khớp tiêu chí gate
// (ngày · kho · NCC · loại kho · loại xe) → gate vẫn link được kế hoạch để phiếu nhập "Nạp từ kế hoạch".
// Nhiều xe cùng NCC không booking → cùng link 1 đơn KH (hợp lệ — nhiều phiếu nhập chung 1 tms_order_id).
async function findPlanOrderFallback(
  date: string, warehouse_id: string, direction: string | null,
  warehouse_type: string | null, vehicle_type: string | null, company_id: string | null,
): Promise<{ id: string; order_code: string; planned_boxes: number | null; planned_pallets: number | null; priority: boolean } | null> {
  if (direction !== 'INBOUND' || !company_id) return null
  let q = supabase.from('TmsOrder')
    .select('id, order_code, planned_boxes, planned_pallets, priority')
    .eq('date', date).eq('warehouse_id', warehouse_id)
    .eq('direction', 'INBOUND').eq('ncc_id', company_id)
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(1)
  if (warehouse_type) q = q.eq('warehouse_type', warehouse_type)
  if (vehicle_type)   q = q.eq('vehicle_type', vehicle_type)
  const { data } = await q
  return (data ?? [])[0] ?? null
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

  // 2. Tìm TmsVehicleSlot theo biển số + NGÀY (INNER JOIN — không chặn ngày thì 1 biển tích lũy
  // nhiều năm sẽ vượt cap ~1000 → gợi ý sót; JS filter date bên dưới vẫn giữ nguyên)
  const { data: vslots, error } = await supabase
    .from('TmsVehicleSlot')
    .select(`
      id, order_id, slot_id, license_plate, is_consolidation_primary,
      order:TmsOrder!order_id!inner (
        id, order_code, date, warehouse_id, warehouse_type, vehicle_type, direction,
        planned_boxes, planned_pallets, planned_tons, gdo_refs, npp_name, priority, ncc_id
      ),
      slot:DeliverySlot!slot_id (time_from, time_to)
    `)
    .eq('license_plate', license_plate)
    .eq('order.date', date)

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
  if (!group) {
    // Không có booking khớp → gợi ý theo KẾ HOẠCH nhập của NCC (chưa booking)
    const plan = await findPlanOrderFallback(
      date, warehouse_id, direction ?? null, warehouse_type ?? null, vehicle_type ?? null, company_id ?? null)
    if (!plan) return res.json({ success: true, data: [] })
    return res.json({ success: true, data: [{
      tms_order_id:        plan.id,
      tms_vehicle_slot_id: null,
      order_code:          plan.order_code,
      booking_slot_from:   null,
      booking_slot_to:     null,
      planned_boxes:       plan.planned_boxes != null ? String(plan.planned_boxes) : null,
      planned_pallets:     plan.planned_pallets != null ? String(plan.planned_pallets) : null,
      gdo_refs:            null,
      npp_names:           null,
      priority:            plan.priority ?? false,
      from_plan:           true,
    }] })
  }

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

// Cấp registration_number (max+1 theo ngày) + insert NGUYÊN TỬ chống đua:
// unique (date, registration_number) bảo đảm KHÔNG trùng; khi nhiều xe đăng ký cùng lúc,
// 2 user có thể cùng lấy 1 số → 1 insert dính 23505 → đọc lại max+1 và thử lại (tối đa 25 lần).
async function insertGateWithNumber(
  basePayload: Record<string, unknown>, date: string,
): Promise<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }> {
  let lastErr: { code?: string; message: string } | null = null
  for (let attempt = 0; attempt < 25; attempt++) {
    const { data: maxRow } = await supabase
      .from('gate_registrations')
      .select('registration_number')
      .eq('date', date)
      .order('registration_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    const registration_number = ((maxRow as { registration_number: number } | null)?.registration_number ?? 0) + 1
    const ins = await supabase
      .from('gate_registrations')
      .insert({ ...basePayload, registration_number })
      .select()
      .single()
    if (!ins.error) return { data: ins.data as Record<string, unknown>, error: null }
    lastErr = ins.error
    if (ins.error.code !== '23505') break   // lỗi khác (không phải trùng số) → dừng ngay
    // Trùng số do đua: chờ ngẫu nhiên (jitter tăng dần) để PHÁ thundering herd rồi đọc lại max+1.
    await new Promise(r => setTimeout(r, 15 + Math.floor(Math.random() * (40 + attempt * 25))))
  }
  return { data: null, error: lastErr ?? { message: 'Hệ thống đang bận cấp số đăng ký, thử lại' } }
}

type GateLeg = {
  direction: string
  vehicle_type?: string | null; company_id?: string | null; company_name_raw?: string | null
  content?: string | null; return_pallet?: boolean | null; seal_number?: string | null; notes?: string | null
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
    combined, legs,
  } = req.body as Record<string, unknown> & { combined?: boolean; legs?: GateLeg[] }

  if (!date || !warehouse_id) {
    return apiErr(res, 'MISSING_FIELDS', 'date và warehouse_id là bắt buộc')
  }

  // Phạm vi kho: non-NATIONAL chỉ được tạo đăng ký cho kho được giao
  const cScope = scopeWhIds(req)
  if (cScope !== null && !cScope.includes(warehouse_id as string)) {
    return apiErr(res, 'FORBIDDEN', 'Ngoài phạm vi kho được giao — không thể tạo đăng ký cổng cho kho này', 403)
  }
  // Phạm vi Loại hàng ('Khác'/không khai → không chặn)
  const cCats = scopeCategoriesOf(req)
  if (cCats && warehouse_type && warehouse_type !== 'Khác' && !cCats.includes(warehouse_type as string)) {
    return apiErr(res, 'FORBIDDEN', 'Ngoài phạm vi Loại hàng được phép — không thể tạo đăng ký loại kho này', 403)
  }

  const now = new Date().toISOString()
  // Trường DÙNG CHUNG cho cả 1 record lẫn 2 chân kết hợp (cùng xe/biển/kho/Loại kho)
  const shared = {
    date,
    driver_name:        driver_name ?? null,
    phone:              phone ?? null,
    vehicle_id:         vehicle_id ?? null,
    license_plate:      license_plate ?? null,
    warehouse_id,
    warehouse_type:     warehouse_type ?? null,
    status:             'REGISTERED',
    priority:           false,
    registered_at:      now,
    registered_by:      userName,
    created_by:         userName,
    updated_by:         userName,
    updated_at:         now,
  }

  // ── Xe "kết hợp" (vừa Nhập vừa Xuất cùng Loại kho): tạo 2 record 1 CHIỀU riêng, chung visit_group_id.
  // Mỗi record là 1 chiều bình thường → match booking theo cơ chế cũ, KHÔNG đụng relink → không lỗi TMS.
  if (combined && Array.isArray(legs) && legs.length >= 2) {
    const visitId = randomUUID()
    const created: Record<string, unknown>[] = []
    for (const leg of legs) {
      if (!leg?.direction) return apiErr(res, 'MISSING_FIELDS', 'Mỗi chân kết hợp phải có hướng (Nhập/Xuất)')
      const payload = {
        ...shared,
        id: randomUUID(),
        visit_group_id:   visitId,
        direction:        leg.direction,
        vehicle_type:     leg.vehicle_type ?? null,
        company_id:       leg.company_id ?? null,
        company_name_raw: leg.company_name_raw ?? null,
        content:          leg.content ?? null,
        return_pallet:    leg.return_pallet ?? false,
        seal_number:      leg.seal_number ?? null,
        notes:            leg.notes ?? null,
      }
      const { data, error } = await insertGateWithNumber(payload, date as string)
      if (error || !data) return apiErr(res, 'DB_ERROR', error?.message ?? 'Lỗi tạo đăng ký kết hợp', 500)
      created.push(data)
    }
    // Relink booking cho TỪNG chân (mỗi chân 1 chiều → đúng cơ chế hiện tại)
    const plate = (created[0] as { license_plate: string | null }).license_plate
    if (plate) {
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i]
        await relinkAfterDelete(
          plate, date as string, warehouse_id as string,
          leg.direction,
          (warehouse_type ?? null) as string | null,
          (leg.vehicle_type ?? null) as string | null,
          (leg.company_id ?? null) as string | null,
        )
      }
    }
    return res.status(201).json({ success: true, data: created })
  }

  // ── Đăng ký 1 chiều bình thường
  const basePayload = {
    ...shared,
    id: randomUUID(),
    direction:          direction ?? null,
    company_id:         company_id ?? null,
    company_name_raw:   company_name_raw ?? null,
    vehicle_type:       vehicle_type ?? null,
    content:            content ?? null,
    return_pallet:      return_pallet ?? false,
    seal_number:        seal_number ?? null,
    notes:              notes ?? null,
  }

  const { data, error } = await insertGateWithNumber(basePayload, date as string)
  if (error || !data) return apiErr(res, 'DB_ERROR', error?.message ?? 'Hệ thống đang bận cấp số đăng ký, thử lại', 500)

  // Tính lại vị trí booking cho tất cả gate trong nhóm
  const plate = (data as { license_plate: string | null }).license_plate
  if (plate) {
    await relinkAfterDelete(
      plate, date as string, warehouse_id as string,
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

  // Phạm vi kho: bản ghi hiện tại phải thuộc kho được giao; KHÔNG cho chuyển sang kho ngoài phạm vi
  const uScope = scopeWhIds(req)
  if (uScope !== null) {
    const curWh = before?.warehouse_id ?? null
    if (!curWh || !uScope.includes(curWh))
      return apiErr(res, 'FORBIDDEN', 'Ngoài phạm vi kho được giao — không thể sửa đăng ký cổng của kho này', 403)
    if (warehouse_id !== undefined && warehouse_id && !uScope.includes(warehouse_id))
      return apiErr(res, 'FORBIDDEN', 'Không thể chuyển đăng ký sang kho ngoài phạm vi được giao', 403)
  }
  const uCats = scopeCategoriesOf(req)
  // Loại HIỆN TẠI của bản ghi phải trong phạm vi (chống IDOR-loại: sửa đăng ký loại ngoài scope cùng kho)
  if (uCats && before?.warehouse_type && before.warehouse_type !== 'Khác' && !uCats.includes(before.warehouse_type))
    return apiErr(res, 'FORBIDDEN', 'Ngoài phạm vi Loại hàng được phép — không thể sửa đăng ký cổng loại kho này', 403)
  if (uCats && warehouse_type !== undefined && warehouse_type && warehouse_type !== 'Khác' && !uCats.includes(warehouse_type))
    return apiErr(res, 'FORBIDDEN', 'Ngoài phạm vi Loại hàng được phép — không thể đổi sang loại kho này', 403)

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

  // Khi đổi ngày → cấp registration_number mới (max+1) cho ngày đích. Đua với xe khác cùng
  // tạo/đổi sang ngày đó → unique(date, registration_number) 23505 → đọc lại max+1 + jitter rồi
  // thử lại (mirror insertGateWithNumber) — không trả DB_ERROR thô bắt user thao tác lại.
  const renumber = date !== undefined && before && date !== before.date
  let data: unknown = null
  let error: { code?: string; message: string } | null = null
  for (let attempt = 0; attempt < 25; attempt++) {
    if (renumber) {
      const { data: maxRow } = await supabase
        .from('gate_registrations')
        .select('registration_number')
        .eq('date', date)
        .order('registration_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      patch.registration_number = ((maxRow as { registration_number: number } | null)?.registration_number ?? 0) + 1
    }
    const r = await supabase
      .from('gate_registrations')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    data = r.data; error = r.error
    if (!error) break
    if (!renumber || error.code !== '23505') break
    await new Promise(rs => setTimeout(rs, 15 + Math.floor(Math.random() * (40 + attempt * 25))))
  }

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
  if (!(await guardGateScope(req, res, id))) return
  const user = (req as Request & { user?: { name?: string } }).user
  const { custom_time } = req.body
  const now = new Date().toISOString()
  const ts = custom_time ? new Date(custom_time).toISOString() : now

  // Xe kết hợp: chân Xuất chỉ được "Gọi xe" khi chân Nhập đã "Ra" (COMPLETED) — tránh thao tác sớm
  const { data: regCall } = await supabase
    .from('gate_registrations')
    .select('direction, visit_group_id')
    .eq('id', id).maybeSingle()
  const rCall = regCall as { direction: string | null; visit_group_id: string | null } | null
  if (rCall?.visit_group_id && rCall.direction === 'OUTBOUND') {
    const inStatus = await combinedPartnerStatus(rCall.visit_group_id, 'INBOUND')
    if (inStatus && inStatus !== 'COMPLETED') {
      return apiErr(res, 'SEQUENCE', 'Xe Nhập chưa ra — chân Xuất chưa thể gọi xe (xe kết hợp)', 409)
    }
  }

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
  if (!(await guardGateScope(req, res, id))) return
  const user = (req as Request & { user?: { name?: string } }).user
  const { custom_time } = req.body
  const now = new Date().toISOString()
  const ts = custom_time ? new Date(custom_time).toISOString() : now

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id, tms_order_ids, tms_vehicle_slot_id, direction, visit_group_id')
    .eq('id', id).single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  // Xe kết hợp: chân Xuất chỉ được "Vào" khi chân Nhập đã "Ra" (COMPLETED) — tránh bấm nhầm
  const rEntry = reg as { direction: string | null; visit_group_id: string | null }
  if (rEntry.visit_group_id && rEntry.direction === 'OUTBOUND') {
    const inStatus = await combinedPartnerStatus(rEntry.visit_group_id, 'INBOUND')
    if (inStatus && inStatus !== 'COMPLETED') {
      return apiErr(res, 'SEQUENCE', 'Xe Nhập chưa ra — chân Xuất chưa thể vào (xe kết hợp)', 409)
    }
  }

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
  if (!(await guardGateScope(req, res, id))) return
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
  if (!(await guardGateScope(req, res, id))) return
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
  if (!(await guardGateScope(req, res, id))) return
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
  if (!(await guardGateScope(req, res, id))) return
  const user = (req as Request & { user?: { name?: string } }).user
  const now = new Date().toISOString()

  const { data: reg, error: fetchErr } = await supabase
    .from('gate_registrations')
    .select('tms_order_id, tms_order_ids, tms_vehicle_slot_id, direction, visit_group_id')
    .eq('id', id).single()
  if (fetchErr) return apiErr(res, 'DB_ERROR', fetchErr.message, 500)

  // Xe kết hợp: gỡ "Đã ra" của chân Nhập chỉ khi chân Xuất đã lùi hẳn về "Chưa gọi" (gỡ Gọi xe + Đã vào trước)
  const rRevExit = reg as { direction: string | null; visit_group_id: string | null }
  if (rRevExit.visit_group_id && rRevExit.direction === 'INBOUND') {
    const outStatus = await combinedPartnerStatus(rRevExit.visit_group_id, 'OUTBOUND')
    if (outStatus && outStatus !== 'REGISTERED') {
      return apiErr(res, 'SEQUENCE', 'Phải hoàn tác thao tác của chân Xuất trước (gỡ Gọi xe / Đã vào) rồi mới gỡ "Đã ra" của chân Nhập', 409)
    }
  }

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
  // Chặn theo NGÀY bằng INNER JOIN (không chặn thì 1 biển tích lũy nhiều năm vượt cap ~1000 → relink sót)
  const { data: vslots } = await supabase
    .from('TmsVehicleSlot')
    .select(`id, order_id, slot_id, is_consolidation_primary, order:TmsOrder!order_id!inner(order_code, date, warehouse_id, warehouse_type, vehicle_type, direction, priority, ncc_id, npp_name, gdo_refs, planned_boxes, planned_pallets), slot:DeliverySlot!slot_id(time_from, time_to)`)
    .eq('license_plate', license_plate)
    .eq('order.date', date)

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

  // NCC không booking: tìm 1 lần đơn KH PENDING khớp tiêu chí nhóm — gate không có booking sẽ link đơn này
  // (tính lại mỗi lần relink nên link luôn deterministic, không bị relink xóa mất)
  const planFallback = await findPlanOrderFallback(date, warehouse_id, direction, warehouse_type, vehicle_type, company_id)

  await Promise.all(gates.map((gate, i) => {
    const group = sortedGroups[i]
    const oldOrderIds = getAllOrderIds(gate)
    const ops: Promise<unknown>[] = []
    const patch: Record<string, unknown> = { updated_at: now }

    if (!group && planFallback) {
      // Không có booking nhưng NCC có KẾ HOẠCH nhập PENDING → link đơn KH (không có slot)
      Object.assign(patch, {
        tms_order_id: planFallback.id, tms_vehicle_slot_id: null, tms_order_ids: null,
        booking_order_code: planFallback.order_code,
        booking_slot_from: null, booking_slot_to: null,
        booking_npp_names: null, booking_gdo_refs: null,
        booking_planned_boxes: planFallback.planned_boxes != null ? String(planFallback.planned_boxes) : null,
        booking_planned_pallets: planFallback.planned_pallets != null ? String(planFallback.planned_pallets) : null,
        priority: planFallback.priority ?? false,
      })
      const exportStatus =
        gate.status === 'IN'        ? 'Đang xuất' :
        gate.status === 'COMPLETED' ? 'Đã xuất'   : 'Đăng ký'
      if (!oldOrderIds.includes(planFallback.id)) {
        ops.push(supabase.from('TmsOrder').update({ export_status: exportStatus, updated_at: now }).eq('id', planFallback.id) as unknown as Promise<unknown>)
      }
      for (const oldId of oldOrderIds) {
        if (oldId !== planFallback.id) ordersToRecalculate.add(oldId)
      }
      if (gate.tms_vehicle_slot_id) {
        ops.push(updateVSlotGateStatus(gate.tms_vehicle_slot_id, { gate_export_status: null, gate_registered_at: null, gate_entry_at: null, gate_exit_at: null, updated_at: now }))
      }
    } else if (!group) {
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
  if (!(await guardGateScope(req, res, id))) return

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

  // Các bước hậu-xóa (re-link booking, tính lại export_status, clear vslot cũ) là BEST-EFFORT: gate ĐÃ
  // xóa xong (thao tác chính thành công). Hàm này KHÔNG có error-middleware bọc → nếu 1 bước ở đây ném
  // lỗi sẽ treo/500 dù xóa đã xong. Bọc try/catch: lỗi chỉ log, vẫn trả success; realtime/lần thao tác
  // kế sẽ hội tụ lại (relink + export_status tự tính lại).
  try {
    // Re-link gate_regs còn lại vào đúng vị trí booking
    if (reg?.license_plate && reg?.date && reg?.warehouse_id) {
      await relinkAfterDelete(
        reg.license_plate, reg.date, reg.warehouse_id,
        reg.direction, reg.warehouse_type, reg.vehicle_type, reg.company_id ?? null,
      )
    }

  // Tính lại export_status cho từng order dựa trên trạng thái cao nhất của các gate còn lại.
  // BEST-EFFORT (allSettled): gate ĐÃ xóa xong ở trên — 1 lỗi cập nhật export_status KHÔNG được ném ra
  // làm cả request 500 (client tưởng xóa thất bại + retry oan). Lỗi chỉ log; export_status stale sẽ tự
  // tính lại ở lần đổi gate kế/realtime.
  if (deletedOrderIds.length > 0) {
    const now = new Date().toISOString()
    const results = await Promise.allSettled(deletedOrderIds.map(async (orderId) => {
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
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length) console.error(`[deleteGate] tính lại export_status lỗi ${failed.length}/${deletedOrderIds.length}:`, (failed[0] as PromiseRejectedResult).reason)
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
  } catch (e) {
    console.error('[deleteGate] bước hậu-xóa (relink/export_status/clear vslot) lỗi — gate đã xóa, bỏ qua:', (e as Error).message)
  }

  return res.json({ success: true })
}
