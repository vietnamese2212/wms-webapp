// ĐỢT B (user chốt 03/08): Kế hoạch VC (lệnh booking bên TMS) là KẾT QUẢ DẪN XUẤT của Kế hoạch xuất.
// Điều vận nạp kế hoạch 1 lần → lệnh vận chuyển tự có để đặt khung giờ, khỏi upload 2 nơi.
//
// KHÓA = SỐ XE (khvc_lines.group_code = GroupDeliveryOrder.group_code = TmsOrder.order_code):
//   • sửa/thêm/bớt DO trong xe → lệnh + KHUNG GIỜ ĐÃ ĐẶT giữ nguyên, chỉ cập nhật số liệu
//   • CẢ XE biến mất khỏi kế hoạch → đánh dấu "kế hoạch đã bỏ" + TỰ NHẢ khung giờ cho xe khác
//   • xe xuất hiện lại → lệnh sống lại NHƯNG KHÔNG kèm khung giờ (phải booking lại — user chốt)
// Số xe đã có lệnh up tay từ trước → NHẬN NUÔI (cập nhật + đóng dấu KHVC), KHÔNG tạo lệnh trùng
// (order_code UNIQUE — tạo trùng sẽ 23505 và làm hỏng cả lượt upload).
//
// Đồng bộ là AUGMENT: hỏng đồng bộ KHÔNG được làm hỏng việc nạp kế hoạch (caller bọc try/catch).
import { randomUUID } from 'crypto'
import type { Request } from 'express'
import { supabase } from '../lib/supabase'
import { fetchAllByIdChunks } from '../utils/pagination'
import { logOutboundEvents, actorOf } from './outboundEvents'

const now = () => new Date().toISOString()

type GdoRow = {
  id: string; group_code: string; status: string; delivery_date: string | null
  warehouse_id: string | null; warehouse_type: string | null; dvvt: string | null
  plan_dropped: boolean | null; awaiting_sap: boolean | null
}
type KLine = { group_code: string; npp: string | null; veh_type: string | null; dvvt: string | null; note: string | null }
type OrderRow = { id: string; order_code: string; origin: string | null; plan_dropped: boolean | null }
type SlotRow = { id: string; order_id: string; slot_id: string | null; status: string; license_plate: string | null }

export type TmsPlanSyncResult = { created: number; updated: number; dropped: number; reopened: number; slots_released: number }

export async function syncTmsPlanFromKhvc(req: Request, groupCodes: string[]): Promise<TmsPlanSyncResult> {
  const out: TmsPlanSyncResult = { created: 0, updated: 0, dropped: 0, reopened: 0, slots_released: 0 }
  const gcs = [...new Set(groupCodes.map(g => String(g ?? '').trim()).filter(Boolean))]
  if (!gcs.length) return out
  const actor = actorOf(req, 'KHVC-SYNC')
  const t = now()

  // 1) Chuyến (nguồn của ngày/kho/loại kho) — xe chưa dựng được chuyến thì chưa có gì để đặt lịch
  const gdos = await fetchAllByIdChunks(gcs, chunk => supabase.from('GroupDeliveryOrder')
    .select('id, group_code, status, delivery_date, warehouse_id, warehouse_type, dvvt, plan_dropped, awaiting_sap')
    .in('group_code', chunk).order('id')) as GdoRow[]
  if (!gdos.length) return out
  const gdoByGc = new Map(gdos.map(g => [g.group_code, g]))

  // 2) Dòng kế hoạch (nguồn của NPP + Loại xe — điều vận khai, không suy từ chuyến)
  const lines = await fetchAllByIdChunks(gcs, chunk => supabase.from('khvc_lines')
    .select('group_code, npp, veh_type, dvvt, note').in('group_code', chunk)
    .neq('sync_status', 'OBSOLETE').order('group_code')) as KLine[]
  const linesByGc = new Map<string, KLine[]>()
  for (const l of (lines ?? [])) { const a = linesByGc.get(l.group_code) ?? []; a.push(l); linesByGc.set(l.group_code, a) }

  // 3) Số liệu để đặt lịch (pallet/tấn) — chỉ có SAU khi VL06O về; chuyến đang chờ thì để trống,
  //    lượt đồng bộ kế tiếp (lúc kích hoạt) sẽ điền. Pallet lấy từ dòng hàng, KL lấy RPC dùng chung
  //    với trang Phiếu cân (đừng tính lại công thức thứ hai).
  const liveGdoIds = gdos.filter(g => !g.plan_dropped).map(g => g.id)
  const palletsByGdo = new Map<string, number>()
  const boxesByGdo = new Map<string, number>()
  if (liveGdoIds.length) {
    const dos = await fetchAllByIdChunks(liveGdoIds, chunk => supabase.from('OutboundDelivery')
      .select('id, gdo_id').in('gdo_id', chunk).order('id')) as { id: string; gdo_id: string }[]
    const gdoByDo = new Map((dos ?? []).map(d => [d.id, d.gdo_id]))
    const doIds = (dos ?? []).map(d => d.id)
    if (doIds.length) {
      const items = await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
        .select('do_id, cartons_ordered, pallets_estimated').in('do_id', chunk).order('id')) as
        { do_id: string; cartons_ordered: number | null; pallets_estimated: number | null }[]
      for (const it of (items ?? [])) {
        const gid = gdoByDo.get(it.do_id); if (!gid) continue
        palletsByGdo.set(gid, (palletsByGdo.get(gid) ?? 0) + Number(it.pallets_estimated ?? 0))
        boxesByGdo.set(gid, (boxesByGdo.get(gid) ?? 0) + Number(it.cartons_ordered ?? 0))
      }
    }
  }
  const tonsByGdo = new Map<string, number>()
  if (liveGdoIds.length) {
    try {
      for (let i = 0; i < liveGdoIds.length; i += 300) {
        const { data } = await supabase.rpc('gdo_weight_estimates', { p_gdo_ids: liveGdoIds.slice(i, i + 300) })
        for (const w of ((data ?? []) as { gdo_id: string; kg_planned: number | null }[]))
          if (w.kg_planned != null) tonsByGdo.set(w.gdo_id, Number(w.kg_planned) / 1000)
      }
    } catch (e) { console.error('[tmsPlanSync] KL ước tính:', e) }
  }

  // 4) ĐVVT → TransportCompany.id (cột ncc_id của lệnh) — tra 1 lượt theo tên có mặt
  const dvvtNames = [...new Set(gdos.map(g => (g.dvvt ?? '').trim()).filter(Boolean))]
  const nccByName = new Map<string, string>()
  if (dvvtNames.length) {
    const { data } = await supabase.from('TransportCompany').select('id, name').in('name', dvvtNames)
    for (const c of ((data ?? []) as { id: string; name: string }[])) nccByName.set(c.name.trim().toLowerCase(), c.id)
  }

  // 5) Lệnh hiện có theo Số xe
  const orders = await fetchAllByIdChunks(gcs, chunk => supabase.from('TmsOrder')
    .select('id, order_code, origin, plan_dropped').in('order_code', chunk).order('id')) as OrderRow[]
  const orderByCode = new Map((orders ?? []).map(o => [o.order_code, o]))

  const events: Parameters<typeof logOutboundEvents>[0] = []

  for (const gc of gcs) {
    const g = gdoByGc.get(gc)
    if (!g || !g.warehouse_id || !g.delivery_date) continue
    const kl = linesByGc.get(gc) ?? []
    const npp = [...new Set(kl.map(l => (l.npp ?? '').trim()).filter(Boolean))].join(' · ') || null
    const vehType = kl.map(l => (l.veh_type ?? '').trim()).find(Boolean) ?? null
    const existing = orderByCode.get(gc)

    // Trường DẪN XUẤT (luôn ghi đè) — KHÔNG đụng gì thuộc về booking (slot/biển số/tài xế)
    const derived = {
      date: String(g.delivery_date).slice(0, 10),
      warehouse_id: g.warehouse_id,
      warehouse_type: g.warehouse_type,
      npp_name: npp,
      vehicle_type: vehType,
      ncc_id: nccByName.get((g.dvvt ?? '').trim().toLowerCase()) ?? null,
      direction: 'OUTBOUND',
      gdo_refs: gc,
      planned_pallets: palletsByGdo.get(g.id) ? Math.round(palletsByGdo.get(g.id)!) : null,
      planned_boxes: boxesByGdo.get(g.id) ? Math.round(boxesByGdo.get(g.id)!) : null,
      planned_tons: tonsByGdo.get(g.id) ? Number(tonsByGdo.get(g.id)!.toFixed(3)) : null,
      origin: 'KHVC',
      updated_by: actor, updated_at: t,
    }

    // ── Xe bị bỏ khỏi kế hoạch → ngừng hiệu lực + NHẢ khung giờ ──
    if (g.plan_dropped) {
      if (!existing) continue
      if (existing.plan_dropped) continue                    // đã xử lý lượt trước
      const released = await releaseSlotsOf(existing.id, actor)
      out.slots_released += released
      await supabase.from('TmsOrder')
        .update({ plan_dropped: true, plan_dropped_at: t, origin: 'KHVC', updated_by: actor, updated_at: t })
        .eq('id', existing.id)
      out.dropped++
      events.push({
        group_code: gc, gdo_id: g.id, event_type: 'TMS_PLAN_DROPPED', source: 'PLAN', actor,
        detail: released > 0
          ? `Kế hoạch bỏ Số xe này — lệnh vận chuyển ngừng hiệu lực và ĐÃ NHẢ ${released} khung giờ cho xe khác`
          : 'Kế hoạch bỏ Số xe này — lệnh vận chuyển ngừng hiệu lực (chưa đặt khung giờ nào)',
      })
      continue
    }

    // ── Xe còn trong kế hoạch ──
    if (!existing) {
      const orderId = randomUUID()
      const { error } = await supabase.from('TmsOrder').insert({
        id: orderId, order_code: gc, ...derived,
        status: 'PENDING', plan_dropped: false, created_by: actor, created_at: t,
      })
      if (error) {
        // 23505 = có người/lượt khác vừa tạo cùng Số xe → lượt sau tự cập nhật, không phá upload
        if (error.code !== '23505') console.error('[tmsPlanSync] tạo lệnh:', error.message)
        continue
      }
      // 1 lệnh luôn có sẵn 1 dòng xe để đặt khung giờ (giống upload KH xuất bên TMS)
      await supabase.from('TmsVehicleSlot').insert({
        id: randomUUID(), order_id: orderId, status: 'PENDING', created_at: t, updated_at: t,
      })
      out.created++
      events.push({
        group_code: gc, gdo_id: g.id, event_type: 'TMS_PLAN_CREATED', source: 'PLAN', actor,
        detail: 'Tự sinh lệnh vận chuyển từ Kế hoạch xuất (sẵn sàng đặt khung giờ)',
      })
      continue
    }

    const wasDropped = existing.plan_dropped === true
    await supabase.from('TmsOrder')
      .update({ ...derived, ...(wasDropped ? { plan_dropped: false, plan_dropped_at: null } : {}) })
      .eq('id', existing.id)
    out.updated++
    if (wasDropped) {
      out.reopened++
      events.push({
        group_code: gc, gdo_id: g.id, event_type: 'TMS_PLAN_REOPENED', source: 'PLAN', actor,
        detail: 'Kế hoạch có lại Số xe này — lệnh vận chuyển hoạt động trở lại, PHẢI đặt khung giờ lại (khung cũ đã nhả)',
      })
    } else if (!existing.origin) {
      events.push({
        group_code: gc, gdo_id: g.id, event_type: 'TMS_PLAN_ADOPTED', source: 'PLAN', actor,
        detail: 'Số xe đã có lệnh vận chuyển tạo tay — cập nhật theo Kế hoạch xuất thay vì tạo lệnh trùng',
      })
    }
  }

  await logOutboundEvents(events)
  return out
}

// Nhả MỌI khung giờ đã đặt của lệnh — đi ĐÚNG đường nguyên tử `book_vehicle_slot(new_slot=NULL)`
// như nút "Trả lại" của người dùng, để `booked_count` của khung giờ không lệch (bài học
// tms-slot-booking-atomic: ghi tay slot_id=null làm bộ đếm chỗ trôi dần).
async function releaseSlotsOf(orderId: string, actor: string): Promise<number> {
  const { data } = await supabase.from('TmsVehicleSlot')
    .select('id, order_id, slot_id, status, license_plate').eq('order_id', orderId)
  const slots = ((data ?? []) as SlotRow[]).filter(s => s.slot_id)
  let n = 0
  for (const s of slots) {
    const { error } = await supabase.rpc('book_vehicle_slot', {
      p_vslot_id: s.id, p_new_slot_id: null, p_plate: null, p_status: 'PENDING', p_actor: actor,
    })
    if (error) { console.error('[tmsPlanSync] nhả khung giờ:', error.message); continue }
    n++
  }
  return n
}
