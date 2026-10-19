// CHUỖI TÌNH TRẠNG CỦA MỘT XE (18/10/2026, user: "tình trạng này xem được ở mọi nơi có liên quan, như nút workflow trong SAP — có số
// chứng từ để đi search, mở ra được từ đó"). Một Số xe (group_code) đi qua 8 bước, mỗi bước là MỘT sổ khác nhau:
//   Kế hoạch (dispatch_trip) → KH xuất (khvc_lines) → Khung giờ (TmsVehicleSlot) → Vào cổng (gate_registrations) → Cân (WeighTicket)
//   → Xuất kho (GroupDeliveryOrder) → Ra cổng (gate_registrations.exit_at) → Đã giao (chuyển kho: transfer_status · bán hàng: tài xế
//   xác nhận trên TmsVehicleSlot.delivered_at)
// Hàm này là NGUỒN DUY NHẤT dựng chuỗi — mọi màn (bàn ghép xe · tab Kế hoạch · Xem đơn · Kế hoạch xuất · Đặt lịch · Xuất kho ·
// Đăng ký cổng · Phiếu cân) gọi GET /tms/trip-flow?codes=… rồi vẽ cùng một component. Mỗi bước mang SỐ CHỨNG TỪ + id để mở trang đích.
// Đọc theo lô ≤ 300 mã (trần URL PostgREST), 8 câu cho cả lô — không N+1.
import { db } from '../lib/supabase'
import { fetchAllByIdChunks } from '../utils/pagination'

export type FlowKey = 'PLAN' | 'KHVC' | 'BOOKING' | 'GATE_IN' | 'WEIGH' | 'OUTBOUND' | 'GATE_OUT' | 'DELIVERED'
/** done = đã qua · active = đang ở bước này · pending = chưa tới · off = kho không bắt bước này · blocked = ngừng / huỷ / rút */
export type FlowState = 'done' | 'active' | 'pending' | 'off' | 'blocked'
export type FlowStep = {
  key: FlowKey
  state: FlowState
  label: string                 // chữ ngắn in trên chip: "Đã vào KH", "Đang xuất"…
  doc: string | null            // SỐ CHỨNG TỪ để tìm: Số xe · #đăng ký cổng · số phiếu cân · HH:mm khung giờ…
  at: string | null             // mốc thời gian của bước (ISO)
  by: string | null             // ai làm
  ref: { kind: 'plan' | 'khvc' | 'order' | 'gate' | 'weigh' | 'gdo' | 'transfer'; id: string; date?: string | null } | null   // mở trang đích (date = ngày của sổ đó để đặt bộ lọc trang)
  note: string | null           // chi tiết thêm cho tooltip
}
export type TripFlow = {
  group_code: string
  warehouse_id: string | null
  ncc_id: string | null         // ĐVVT của lệnh — tài khoản ĐVVT / tài xế chỉ thấy xe của mình
  steps: FlowStep[]
  current: FlowKey | null       // bước đang đứng (bước đầu tiên chưa done)
  delivery: { kind: 'TRANSFER' | 'SALES'; slot_id: string | null; delivered_at: string | null; delivered_by: string | null; note: string | null; ready: boolean }
}

type TripRow = { id: string; group_code: string; status: string; plan_id: string; seq: number; confirmed_at: string | null; confirmed_by: string | null; created_at: string }
type PlanRow = { id: string; plan_date: string; segment: string | null; warehouse_id: string; status: string }
type KhvcRow = { group_code: string; export_date: string | null; uploaded_by: string | null; updated_at: string | null; source: string | null }
type SlotRow = { id: string; order_id: string; slot_id: string | null; status: string; license_plate: string | null; driver_name: string | null; booked_by: string | null; updated_at: string
  gate_registration_id: string | null; delivered_at: string | null; delivered_by: string | null; delivery_note: string | null
  slot: { time_from: string; time_to: string; date: string } | null }
type OrderRow = { id: string; order_code: string; date: string | null; status: string; plan_dropped: boolean | null; export_status: string | null; warehouse_id: string | null; ncc_id: string | null; source_type: string | null; vehicle_slots: SlotRow[] }
type GdoRow = { id: string; group_code: string; status: string; started_at: string | null; completed_at: string | null; plan_dropped: boolean | null; transfer_status: string | null; gate_registration_id: string | null; license_plate: string | null; warehouse_id: string | null; updated_at: string | null }
type GateRow = { id: string; registration_number: number; status: string; date: string | null; entry_at: string | null; exit_at: string | null; registered_at: string | null; entry_by: string | null; exit_by: string | null }
type WeighRow = { id: string; ticket_no: string | null; gdo_id: string; weigh_date: string | null; is_complete: boolean; in_time: string | null; out_time: string | null }
type WhRow = { id: string; require_gate_on_start: boolean | null; require_weigh_on_start: boolean | null }
type TransferRow = { id: string; transfer_gdo_id: string; status: string; completed_at: string | null }

const uniq = <T,>(a: T[]) => [...new Set(a)]
const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : '')
const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')

export async function tripFlowOf(codes0: string[]): Promise<TripFlow[]> {
  const codes = uniq(codes0.map(c => c.trim()).filter(Boolean))
  if (!codes.length) return []
  const [trips, khvc, orders, gdos] = await Promise.all([
    fetchAllByIdChunks(codes, c => db.from('dispatch_trip').select('id, group_code, status, plan_id, seq, confirmed_at, confirmed_by, created_at').in('group_code', c).neq('status', 'DISCARDED').order('created_at', { ascending: false })) as Promise<TripRow[]>,
    fetchAllByIdChunks(codes, c => db.from('khvc_lines').select('group_code, export_date, uploaded_by, updated_at, source').in('group_code', c).neq('sync_status', 'OBSOLETE').order('updated_at', { ascending: false })) as Promise<KhvcRow[]>,
    fetchAllByIdChunks(codes, c => db.from('TmsOrder')
      .select('id, order_code, date, status, plan_dropped, export_status, warehouse_id, ncc_id, source_type, vehicle_slots:TmsVehicleSlot(id, order_id, slot_id, status, license_plate, driver_name, booked_by, updated_at, gate_registration_id, delivered_at, delivered_by, delivery_note, slot:DeliverySlot!slot_id(time_from, time_to, date))')
      .in('order_code', c).order('order_code')) as unknown as Promise<OrderRow[]>,
    fetchAllByIdChunks(codes, c => db.from('GroupDeliveryOrder').select('id, group_code, status, started_at, completed_at, plan_dropped, transfer_status, gate_registration_id, license_plate, warehouse_id, updated_at').in('group_code', c).order('updated_at', { ascending: false })) as Promise<GdoRow[]>,
  ])
  const gdoBy = new Map<string, GdoRow>(); for (const g of gdos) if (!gdoBy.has(g.group_code)) gdoBy.set(g.group_code, g)
  const orderBy = new Map<string, OrderRow>(); for (const o of orders) if (!orderBy.has(o.order_code)) orderBy.set(o.order_code, o)
  const tripBy = new Map<string, TripRow>(); for (const t of trips) if (!tripBy.has(t.group_code)) tripBy.set(t.group_code, t)
  const khvcBy = new Map<string, KhvcRow>(); for (const k of khvc) if (!khvcBy.has(k.group_code)) khvcBy.set(k.group_code, k)
  const gdoIds = [...gdoBy.values()].map(g => g.id)
  const gateIds = uniq([...[...orderBy.values()].flatMap(o => o.vehicle_slots.map(s => s.gate_registration_id)), ...[...gdoBy.values()].map(g => g.gate_registration_id)].filter((x): x is string => !!x))
  const whIds = uniq([...[...gdoBy.values()].map(g => g.warehouse_id), ...[...orderBy.values()].map(o => o.warehouse_id)].filter((x): x is string => !!x))
  const planIds = uniq([...tripBy.values()].map(t => t.plan_id))
  const [plans, gates, weighs, whs, transfers] = await Promise.all([
    planIds.length ? fetchAllByIdChunks(planIds, c => db.from('dispatch_plan').select('id, plan_date, segment, warehouse_id, status').in('id', c).order('id')) as Promise<PlanRow[]> : Promise.resolve([] as PlanRow[]),
    gateIds.length ? fetchAllByIdChunks(gateIds, c => db.from('gate_registrations').select('id, registration_number, status, date, entry_at, exit_at, registered_at, entry_by, exit_by').in('id', c).order('id')) as Promise<GateRow[]> : Promise.resolve([] as GateRow[]),
    gdoIds.length ? fetchAllByIdChunks(gdoIds, c => db.from('WeighTicket').select('id, ticket_no, gdo_id, weigh_date, is_complete, in_time, out_time').in('gdo_id', c).order('in_time', { ascending: false })) as Promise<WeighRow[]> : Promise.resolve([] as WeighRow[]),
    whIds.length ? fetchAllByIdChunks(whIds, c => db.from('Warehouse').select('id, require_gate_on_start, require_weigh_on_start').in('id', c).order('id')) as Promise<WhRow[]> : Promise.resolve([] as WhRow[]),
    gdoIds.length ? fetchAllByIdChunks(gdoIds, c => db.from('TmsOrder').select('id, transfer_gdo_id, status, completed_at').in('transfer_gdo_id', c).order('id')) as Promise<TransferRow[]> : Promise.resolve([] as TransferRow[]),
  ])
  const planBy = new Map(plans.map(p => [p.id, p]))
  const gateBy = new Map(gates.map(g => [g.id, g]))
  const whBy = new Map(whs.map(w => [w.id, w]))
  const weighBy = new Map<string, WeighRow>(); for (const w of weighs) if (!weighBy.has(w.gdo_id)) weighBy.set(w.gdo_id, w)
  const trfBy = new Map(transfers.map(t => [t.transfer_gdo_id, t]))

  return codes.map(gc => {
    const t = tripBy.get(gc), p = t ? planBy.get(t.plan_id) : undefined, k = khvcBy.get(gc), o = orderBy.get(gc), g = gdoBy.get(gc)
    // dòng xe CHÍNH của lệnh: dòng đã đặt khung (BOOKED) trước, rồi dòng mới nhất
    const slots = [...(o?.vehicle_slots ?? [])].sort((a, b) => (b.slot_id ? 1 : 0) - (a.slot_id ? 1 : 0) || b.updated_at.localeCompare(a.updated_at))
    const s = slots[0]
    const gate = (s?.gate_registration_id ? gateBy.get(s.gate_registration_id) : undefined) ?? (g?.gate_registration_id ? gateBy.get(g.gate_registration_id) : undefined)
    const wt = g ? weighBy.get(g.id) : undefined
    const wh = whBy.get(g?.warehouse_id ?? o?.warehouse_id ?? '')
    const needGate = wh?.require_gate_on_start !== false, needWeigh = wh?.require_weigh_on_start === true
    const dropped = g?.plan_dropped === true || o?.plan_dropped === true
    const trf = g ? trfBy.get(g.id) : undefined
    const isTransfer = !!g?.transfer_status || !!trf
    const steps: FlowStep[] = []

    // 1. KẾ HOẠCH (bàn ghép xe)
    steps.push(t && p
      ? { key: 'PLAN', state: t.status === 'CONFIRMED' ? 'done' : 'active', label: t.status === 'CONFIRMED' ? 'Đã chốt' : t.status === 'TENDERED' ? 'Chờ ĐVVT' : t.status === 'DECLINED' ? 'ĐVVT từ chối' : 'Nháp',
          doc: `#${t.seq} · ${dmy(p.plan_date)}`, at: t.confirmed_at ?? t.created_at, by: t.confirmed_by, ref: { kind: 'plan', id: p.id, date: p.plan_date }, note: `Kế hoạch ${p.segment === 'TRANSFER' ? 'Trung chuyển' : 'Bán hàng'} ngày ${dmy(p.plan_date)} · xe #${t.seq}` }
      : { key: 'PLAN', state: k || o || g ? 'off' : 'pending', label: k || o || g ? 'Không qua bàn' : 'Chưa lập', doc: null, at: null, by: null, ref: null, note: k || o || g ? 'Số xe nạp thẳng vào Kế hoạch xuất (Excel / tay), không qua bàn ghép xe' : null })
    // 2. KẾ HOẠCH XUẤT
    steps.push(k
      ? { key: 'KHVC', state: 'done', label: 'Đã vào KH', doc: gc, at: k.updated_at, by: k.uploaded_by, ref: { kind: 'khvc', id: gc, date: k.export_date }, note: `Ngày xuất ${dmy(k.export_date)} · nguồn ${k.source ?? '—'}` }
      : { key: 'KHVC', state: dropped ? 'blocked' : 'pending', label: dropped ? 'Đã rút' : 'Chưa vào KH', doc: gc, at: null, by: null, ref: null, note: dropped ? 'Điều vận đã rút Số xe khỏi Kế hoạch xuất — chuyến / lệnh ngừng' : null })
    // 3. KHUNG GIỜ (ĐVVT / tài xế đặt lịch)
    steps.push(!o
      ? { key: 'BOOKING', state: 'pending', label: 'Chưa có lệnh', doc: null, at: null, by: null, ref: null, note: null }
      : o.plan_dropped
        ? { key: 'BOOKING', state: 'blocked', label: 'Lệnh ngừng', doc: gc, at: null, by: null, ref: { kind: 'order', id: o.id, date: o.date }, note: 'Kế hoạch đã bỏ Số xe — khung giờ đã nhả' }
        : s?.slot_id && s.slot
          ? { key: 'BOOKING', state: 'done', label: `Khung ${hhmm(s.slot.time_from)}`, doc: [hhmm(s.slot.time_from), s.license_plate].filter(Boolean).join(' · '), at: s.updated_at, by: s.booked_by, ref: { kind: 'order', id: o.id, date: o.date }, note: `${dmy(s.slot.date)} ${hhmm(s.slot.time_from)}–${hhmm(s.slot.time_to)} · biển ${s.license_plate ?? '—'}${s.driver_name ? ` · tài xế ${s.driver_name}` : ''}` }
          : { key: 'BOOKING', state: 'active', label: 'Chưa đặt khung', doc: gc, at: null, by: null, ref: { kind: 'order', id: o.id, date: o.date }, note: 'ĐVVT / tài xế chưa đặt khung giờ cho xe này' })
    // 4. VÀO CỔNG
    steps.push(gate?.entry_at
      ? { key: 'GATE_IN', state: 'done', label: 'Đã vào cổng', doc: `#${gate.registration_number}`, at: gate.entry_at, by: gate.entry_by, ref: { kind: 'gate', id: gate.id, date: gate.date }, note: `Đăng ký cổng #${gate.registration_number}` }
      : gate
        ? { key: 'GATE_IN', state: 'active', label: gate.status === 'CALLED' ? 'Đã gọi xe' : 'Đã đăng ký', doc: `#${gate.registration_number}`, at: gate.registered_at, by: null, ref: { kind: 'gate', id: gate.id, date: gate.date }, note: 'Bảo vệ chưa xác nhận xe vào' }
        : g?.status === 'IN_PROGRESS' || g?.status === 'COMPLETED' || g?.status === 'PAUSED'
          ? { key: 'GATE_IN', state: 'off', label: 'Không ĐK cổng', doc: null, at: null, by: null, ref: null, note: needGate ? 'Chuyến đã Bắt đầu bằng duyệt bỏ qua cổng' : 'Kho không bắt đăng ký cổng' }
          : { key: 'GATE_IN', state: needGate ? 'pending' : 'off', label: needGate ? 'Chưa vào cổng' : 'Kho không bắt', doc: null, at: null, by: null, ref: null, note: null })
    // 5. CÂN BÌ
    steps.push(wt
      ? { key: 'WEIGH', state: 'done', label: wt.is_complete ? 'Cân xong' : 'Đã cân bì', doc: wt.ticket_no ?? '(không số)', at: wt.in_time, by: null, ref: { kind: 'weigh', id: wt.id, date: wt.weigh_date }, note: wt.is_complete ? 'Đã cân bì và cân hàng xong' : 'Xe đã cân bì, chờ cân lần 2 khi ra' }
      : g?.status === 'IN_PROGRESS' || g?.status === 'COMPLETED' || g?.status === 'PAUSED'
        ? { key: 'WEIGH', state: 'off', label: 'Không cân', doc: null, at: null, by: null, ref: null, note: needWeigh ? 'Bắt đầu bằng duyệt bỏ qua cân' : 'Kho không bắt cân' }
        : { key: 'WEIGH', state: needWeigh ? 'pending' : 'off', label: needWeigh ? 'Chưa cân' : 'Kho không bắt', doc: null, at: null, by: null, ref: null, note: null })
    // 6. XUẤT KHO (chuyến)
    steps.push(!g
      ? { key: 'OUTBOUND', state: 'pending', label: 'Chưa có chuyến', doc: null, at: null, by: null, ref: null, note: null }
      : g.plan_dropped
        ? { key: 'OUTBOUND', state: 'blocked', label: 'Chuyến ngừng', doc: gc, at: g.updated_at, by: null, ref: { kind: 'gdo', id: g.id }, note: 'Kế hoạch không còn Số xe này' }
        : g.status === 'COMPLETED'
          ? { key: 'OUTBOUND', state: 'done', label: 'Đã xuất', doc: gc, at: g.completed_at, by: null, ref: { kind: 'gdo', id: g.id }, note: 'Chuyến đã Hoàn thành — chứng từ đã chốt' }
          : g.status === 'IN_PROGRESS'
            ? { key: 'OUTBOUND', state: 'active', label: 'Đang xuất', doc: gc, at: g.started_at, by: null, ref: { kind: 'gdo', id: g.id }, note: 'Kho đang lấy hàng / quét' }
            : g.status === 'PAUSED'
              ? { key: 'OUTBOUND', state: 'active', label: 'Kho tạm dừng', doc: gc, at: g.started_at, by: null, ref: { kind: 'gdo', id: g.id }, note: null }
              : g.status === 'CANCELLED'
                ? { key: 'OUTBOUND', state: 'blocked', label: 'Chuyến huỷ', doc: gc, at: g.updated_at, by: null, ref: { kind: 'gdo', id: g.id }, note: null }
                : { key: 'OUTBOUND', state: 'pending', label: 'Chờ xuất', doc: gc, at: null, by: null, ref: { kind: 'gdo', id: g.id }, note: 'Thủ kho chưa Bắt đầu chuyến' })
    // 7. RA CỔNG
    steps.push(gate?.exit_at
      ? { key: 'GATE_OUT', state: 'done', label: 'Đã ra cổng', doc: `#${gate.registration_number}`, at: gate.exit_at, by: gate.exit_by, ref: { kind: 'gate', id: gate.id, date: gate.date }, note: null }
      : gate && g?.status === 'COMPLETED'
        ? { key: 'GATE_OUT', state: 'active', label: 'Chờ ra cổng', doc: `#${gate.registration_number}`, at: null, by: null, ref: { kind: 'gate', id: gate.id, date: gate.date }, note: 'Hàng đã xuất xong, bảo vệ chưa xác nhận xe ra' }
        : { key: 'GATE_OUT', state: gate || needGate ? 'pending' : 'off', label: gate || needGate ? 'Chưa ra cổng' : 'Kho không bắt', doc: gate ? `#${gate.registration_number}` : null, at: null, by: null, ref: gate ? { kind: 'gate', id: gate.id, date: gate.date } : null, note: null })
    // 8. ĐÃ GIAO — chuyển kho: kho nhận xác nhận; bán hàng: TÀI XẾ xác nhận (18/10, user chốt)
    const ready = g?.status === 'COMPLETED' && !dropped
    if (isTransfer) {
      const ts = g?.transfer_status ?? (trf?.status === 'DONE' ? 'DELIVERED' : 'IN_TRANSIT')
      steps.push(ts === 'DELIVERED' || ts === 'RECEIVED'
        ? { key: 'DELIVERED', state: 'done', label: 'Đã giao', doc: trf?.id ? gc : null, at: trf?.completed_at ?? null, by: null, ref: trf ? { kind: 'transfer', id: trf.id, date: o?.date ?? null } : null, note: 'Kho nhận đã xác nhận nhận hàng' }
        : ts === 'RECEIVING'
          ? { key: 'DELIVERED', state: 'active', label: 'Kho nhận đang nhận', doc: gc, at: null, by: null, ref: trf ? { kind: 'transfer', id: trf.id, date: o?.date ?? null } : null, note: null }
          : { key: 'DELIVERED', state: 'active', label: 'Đang đi', doc: gc, at: null, by: null, ref: trf ? { kind: 'transfer', id: trf.id, date: o?.date ?? null } : null, note: 'Chuyển kho — kho nhận xác nhận khi nhận hàng' })
    } else {
      steps.push(s?.delivered_at
        ? { key: 'DELIVERED', state: 'done', label: 'Đã giao', doc: s.license_plate, at: s.delivered_at, by: s.delivered_by, ref: o ? { kind: 'order', id: o.id, date: o.date } : null, note: s.delivery_note }
        : { key: 'DELIVERED', state: ready ? 'active' : 'pending', label: ready ? 'Chờ tài xế xác nhận' : 'Chưa giao', doc: null, at: null, by: null, ref: o ? { kind: 'order', id: o.id, date: o.date } : null, note: ready ? 'Tài xế / ĐVVT bấm "Đã giao" ở Kế hoạch VC khi giao xong' : null })
    }
    const current = steps.find(x => x.state === 'active')?.key ?? steps.find(x => x.state === 'pending')?.key ?? null
    return {
      group_code: gc, warehouse_id: g?.warehouse_id ?? o?.warehouse_id ?? p?.warehouse_id ?? null, ncc_id: o?.ncc_id ?? null, steps, current,
      delivery: { kind: isTransfer ? 'TRANSFER' : 'SALES', slot_id: s?.id ?? null, delivered_at: s?.delivered_at ?? null, delivered_by: s?.delivered_by ?? null, note: s?.delivery_note ?? null, ready: !isTransfer && ready && !!s },
    }
  })
}
