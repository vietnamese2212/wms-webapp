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
import { qtyEntryDecimal, type MatUnits } from '../utils/qtyUnits'

const now = () => new Date().toISOString()

type GdoRow = {
  id: string; group_code: string; status: string; delivery_date: string | null
  warehouse_id: string | null; warehouse_type: string | null; dvvt: string | null
  plan_dropped: boolean | null; awaiting_sap: boolean | null
}
type KLine = { group_code: string; npp: string | null; veh_type: string | null; dvvt: string | null; note: string | null; booking_category: string | null }
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
    .select('group_code, npp, veh_type, dvvt, note, booking_category').in('group_code', chunk)
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
        .select('do_id, material_id, cartons_ordered, pallets_estimated').in('do_id', chunk).order('id')) as
        { do_id: string; material_id: string | null; cartons_ordered: number | null; pallets_estimated: number | null }[]
      // BASE UNIT: `cartons_ordered` là số BASE (hộp/chai/KG). Cột "Thùng" của lệnh vận chuyển là
      // ĐƠN VỊ NHẬP (thùng) ⇒ phải quy đổi PER-MÃ rồi mới cộng — cộng base thô rồi gắn nhãn "thùng"
      // là thổi số (luật cốt tử CLAUDE.md; đo 03/08: 55 base hiện thành "55 thùng").
      const matIds = [...new Set((items ?? []).map(i => i.material_id).filter(Boolean) as string[])]
      const matById = new Map<string, MatUnits>()
      if (matIds.length) {
        const mats = await fetchAllByIdChunks(matIds, chunk => supabase.from('Material')
          .select('id, base_unit, entry_unit, units_per_carton').in('id', chunk).order('id')) as ({ id: string } & MatUnits)[]
        for (const m of (mats ?? [])) matById.set(m.id, m)
      }
      for (const it of (items ?? [])) {
        const gid = gdoByDo.get(it.do_id); if (!gid) continue
        const mat = it.material_id ? matById.get(it.material_id) ?? null : null
        palletsByGdo.set(gid, (palletsByGdo.get(gid) ?? 0) + Number(it.pallets_estimated ?? 0))
        boxesByGdo.set(gid, (boxesByGdo.get(gid) ?? 0) + qtyEntryDecimal(Number(it.cartons_ordered ?? 0), mat))
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
  const dropList: { orderId: string; gc: string; gdoId: string }[] = []
  // Ghi theo LÔ: vòng lặp cũ ghi 1-2 request/xe NỐI TIẾP — nạp kế hoạch 300 xe là ~600 round-trip,
  // mỗi cái chiếm 1 khe pool PostgREST + 3 câu SQL ⇒ chạm trần 60s của Vercel và chết giữa chừng
  // (đúng lớp lỗi đã đo ở nhánh "bỏ kế hoạch hàng loạt" 03/08, nay tái sinh ở nhánh TẠO/CẬP NHẬT).
  const orderInserts: Record<string, unknown>[] = []
  const vslotInserts: Record<string, unknown>[] = []
  const orderUpdates: { id: string; fields: Record<string, unknown> }[] = []

  for (const gc of gcs) {
    const g = gdoByGc.get(gc)
    if (!g || !g.warehouse_id || !g.delivery_date) continue
    const kl = linesByGc.get(gc) ?? []
    const npp = [...new Set(kl.map(l => (l.npp ?? '').trim()).filter(Boolean))].join(' · ') || null
    const vehType = kl.map(l => (l.veh_type ?? '').trim()).find(Boolean) ?? null
    // CỬA đặt lịch: 1 Số xe chỉ 1 giá trị (trigger DB gác) nên lấy dòng đầu có giá trị là đủ.
    // Đây là giá trị ĐƠN, KHÁC warehouse_type (chuỗi ghép các loại xe CHỞ, dùng cho quyền + lọc).
    const bookingCat = kl.map(l => (l.booking_category ?? '').trim()).find(Boolean) ?? null
    const existing = orderByCode.get(gc)

    // Trường DẪN XUẤT (luôn ghi đè) — KHÔNG đụng gì thuộc về booking (slot/biển số/tài xế)
    const derived = {
      date: String(g.delivery_date).slice(0, 10),
      warehouse_id: g.warehouse_id,
      warehouse_type: g.warehouse_type,
      booking_category: bookingCat,
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

    // ── Xe bị bỏ khỏi kế hoạch → ngừng hiệu lực + NHẢ khung giờ (gom xử theo LÔ ở dưới) ──
    if (g.plan_dropped) {
      if (!existing || existing.plan_dropped) continue        // chưa có lệnh / đã xử lượt trước
      dropList.push({ orderId: existing.id, gc, gdoId: g.id })
      continue
    }

    // ── Xe còn trong kế hoạch ── (GOM để ghi theo LÔ ở dưới — xem chú thích khối "GHI THEO LÔ")
    if (!existing) {
      const orderId = randomUUID()
      orderInserts.push({
        id: orderId, order_code: gc, ...derived,
        status: 'PENDING', plan_dropped: false, created_by: actor, created_at: t,
      })
      vslotInserts.push({ id: randomUUID(), order_id: orderId, status: 'PENDING', created_at: t, updated_at: t })
      out.created++
      events.push({
        group_code: gc, gdo_id: g.id, event_type: 'TMS_PLAN_CREATED', source: 'PLAN', actor,
        detail: 'Tự sinh lệnh vận chuyển từ Kế hoạch xuất (sẵn sàng đặt khung giờ)',
      })
      continue
    }

    const wasDropped = existing.plan_dropped === true
    orderUpdates.push({
      id: existing.id,
      fields: { ...derived, ...(wasDropped ? { plan_dropped: false, plan_dropped_at: null } : {}) },
    })
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

  // ── GHI THEO LÔ: tạo lệnh + dòng xe, rồi cập nhật ──────────────────────────
  // INSERT gom chunk 500. Lô hỏng → fallback TỪNG DÒNG để chỉ mất đúng xe hỏng (chuẩn upload của dự
  // án), và 23505 vẫn nuốt như cũ: lượt khác vừa tạo cùng Số xe thì lượt sau tự cập nhật.
  {
    const okOrderIds = new Set<string>()
    for (let i = 0; i < orderInserts.length; i += 500) {
      const chunk = orderInserts.slice(i, i + 500)
      const { error } = await supabase.from('TmsOrder').insert(chunk)
      if (!error) { for (const r of chunk) okOrderIds.add(String(r.id)); continue }
      for (const r of chunk) {
        const { error: e1 } = await supabase.from('TmsOrder').insert(r)
        if (!e1) okOrderIds.add(String(r.id))
        else if (e1.code !== '23505') console.error('[tmsPlanSync] tạo lệnh:', e1.message)
      }
    }
    // 1 lệnh luôn có sẵn 1 dòng xe để đặt khung giờ — CHỈ cho lệnh đã tạo được (tránh dòng xe mồ côi)
    const vslots = vslotInserts.filter(v => okOrderIds.has(String(v.order_id)))
    for (let i = 0; i < vslots.length; i += 500) {
      const { error } = await supabase.from('TmsVehicleSlot').insert(vslots.slice(i, i + 500))
      if (error) console.error('[tmsPlanSync] tạo dòng xe:', error.message)
    }
    out.created -= orderInserts.length - okOrderIds.size

    // UPDATE: mỗi xe một bộ giá trị riêng nên không gộp được thành 1 câu — chạy SONG SONG có trần 8
    // (pool PostgREST ~10 khe; bắn hết cùng lúc là tự xếp hàng chặn chính mình).
    for (let i = 0; i < orderUpdates.length; i += 8) {
      await Promise.all(orderUpdates.slice(i, i + 8).map(async u => {
        const { error } = await supabase.from('TmsOrder').update(u.fields).eq('id', u.id)
        if (error) console.error('[tmsPlanSync] cập nhật lệnh:', error.message)
      }))
    }
  }

  // ── LÔ: bỏ hàng loạt (điều vận bỏ cả ngày) ──────────────────────────────────
  // Nhả khung giờ vẫn phải đi TỪNG dòng xe qua RPC nguyên tử (đếm chỗ không được ghi tay), nhưng
  // chạy song song có TRẦN — pool PostgREST ~10 khe, bắn hết cùng lúc là tự chặn chính mình.
  if (dropList.length) {
    const orderIds = dropList.map(d => d.orderId)
    const slotRows: SlotRow[] = []
    for (let i = 0; i < orderIds.length; i += 300) {
      const { data } = await supabase.from('TmsVehicleSlot')
        .select('id, order_id, slot_id, status, license_plate').in('order_id', orderIds.slice(i, i + 300))
      slotRows.push(...((data ?? []) as SlotRow[]))
    }
    const booked = slotRows.filter(s => s.slot_id)
    const releasedByOrder = new Map<string, number>()
    for (let i = 0; i < booked.length; i += 8) {
      const batch = booked.slice(i, i + 8)
      const oks = await Promise.all(batch.map(async s => {
        const { error } = await supabase.rpc('book_vehicle_slot', {
          p_vslot_id: s.id, p_new_slot_id: null, p_plate: null, p_status: 'PENDING', p_actor: actor,
        })
        if (error) { console.error('[tmsPlanSync] nhả khung giờ:', error.message); return null }
        return s.order_id
      }))
      for (const oid of oks) if (oid) releasedByOrder.set(oid, (releasedByOrder.get(oid) ?? 0) + 1)
    }
    out.slots_released = [...releasedByOrder.values()].reduce((a, b) => a + b, 0)
    for (let i = 0; i < orderIds.length; i += 300) {
      await supabase.from('TmsOrder')
        .update({ plan_dropped: true, plan_dropped_at: t, origin: 'KHVC', updated_by: actor, updated_at: t })
        .in('id', orderIds.slice(i, i + 300))
    }
    out.dropped = dropList.length
    for (const d of dropList) {
      const n = releasedByOrder.get(d.orderId) ?? 0
      events.push({
        group_code: d.gc, gdo_id: d.gdoId, event_type: 'TMS_PLAN_DROPPED', source: 'PLAN', actor,
        detail: n > 0
          ? `Kế hoạch bỏ Số xe này — lệnh vận chuyển ngừng hiệu lực và ĐÃ NHẢ ${n} khung giờ cho xe khác`
          : 'Kế hoạch bỏ Số xe này — lệnh vận chuyển ngừng hiệu lực (chưa đặt khung giờ nào)',
      })
    }
  }

  await logOutboundEvents(events)
  return out
}
