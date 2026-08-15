// GÁC "XE ĐANG GIỮ KHUNG GIỜ" — dùng chung cho MỌI cửa ghi có thể làm khung giờ đang giữ hoá SAI.
//
// Vì sao gom về một chỗ (probe 04/08): cùng một luật ("không để xe giữ khung giờ mâu thuẫn với kế
// hoạch của chính nó") trước đây chỉ được cài ở ĐÚNG MỘT cửa — đổi CỬA qua `updateKhvc`. Các cửa
// còn lại cho qua im lặng và đẻ ra trạng thái cấm, đo thật trên staging:
//   • Đổi NGÀY xuất (bulk-date / sửa lẻ) khi xe đang giữ khung giờ ⇒ xe chạy ngày 06 mà vẫn chiếm
//     chỗ khung ngày 05: khung ngày 05 mất 1 chỗ oan, còn ngày 06 thì xe KHÔNG có khung nào — mà
//     màn hình vẫn hiện "đã đặt lịch". (Bên TMS luật này đã có từ trước: lệnh đang giữ booking thì
//     không cho tick đổi ngày — nhưng lệnh tự sinh từ Kế hoạch xuất bị 422 ở cửa TMS nên cửa KHVC
//     là cửa DUY NHẤT, và cửa đó lại thiếu gác ⇒ luật cũ bị mất hiệu lực trên thực tế.)
//   • Kế hoạch khai CỬA cho Số xe mà lệnh tạo tay của xe đó đang giữ khung của cửa khác (đường
//     "nhận nuôi") ⇒ lệnh cửa FG02 đậu khung cửa FG01.
//
// Ngữ nghĩa THỐNG NHẤT ở mọi cửa = CHẶN + bắt nhả khung trước, KHÔNG tự nhả hộ (mất chỗ âm thầm
// còn tệ hơn — chỗ đã nhả có thể bị xe khác lấy mất ngay, không lấy lại được).
import { supabase } from '../lib/supabase'

export type HeldSlot = {
  group_code: string
  cargo_type: string | null
  date: string | null
  time_from: string | null
  time_to: string | null
}

const label = (s: HeldSlot) =>
  `${s.date ?? ''} ${String(s.time_from ?? '').slice(0, 5)}–${String(s.time_to ?? '').slice(0, 5)}`.trim()

/** Khung giờ ĐANG GIỮ theo id lệnh vận chuyển. Chunk 300 theo luật danh sách id trên URL. */
export async function heldSlotsByOrderId(orderIds: string[], codeById?: Map<string, string>): Promise<Map<string, HeldSlot[]>> {
  const out = new Map<string, HeldSlot[]>()
  const ids = [...new Set(orderIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('TmsVehicleSlot')
      .select('order_id, slot:DeliverySlot!slot_id(cargo_type, date, time_from, time_to)')
      .in('order_id', ids.slice(i, i + 300)).not('slot_id', 'is', null)
    for (const v of ((data ?? []) as unknown as {
      order_id: string; slot?: { cargo_type?: string | null; date?: string | null; time_from?: string | null; time_to?: string | null } | null
    }[])) {
      if (!v.slot) continue
      const a = out.get(v.order_id) ?? []
      a.push({ group_code: codeById?.get(v.order_id) ?? v.order_id, cargo_type: v.slot.cargo_type ?? null,
               date: v.slot.date ?? null, time_from: v.slot.time_from ?? null, time_to: v.slot.time_to ?? null })
      out.set(v.order_id, a)
    }
  }
  return out
}

/** Khung giờ ĐANG GIỮ của từng Số xe (qua TmsOrder.order_code = group_code). */
export async function heldSlotsByVehicle(groupCodes: string[]): Promise<Map<string, HeldSlot[]>> {
  const out = new Map<string, HeldSlot[]>()
  const gcs = [...new Set(groupCodes.map(g => String(g ?? '').trim()).filter(Boolean))]
  if (!gcs.length) return out

  const codeById = new Map<string, string>()
  for (let i = 0; i < gcs.length; i += 300) {
    const { data } = await supabase.from('TmsOrder')
      .select('id, order_code').in('order_code', gcs.slice(i, i + 300))
    for (const o of ((data ?? []) as { id: string; order_code: string }[])) codeById.set(o.id, o.order_code)
  }
  for (const [orderId, held] of await heldSlotsByOrderId([...codeById.keys()], codeById)) {
    const gc = codeById.get(orderId); if (!gc) continue
    out.set(gc, [...(out.get(gc) ?? []), ...held])
  }
  return out
}

/**
 * XOÁ dòng xe của các lệnh + ĐẾM LẠI chỗ của mọi khung giờ bị ảnh hưởng.
 *
 * Vì sao bắt buộc (đo thật 04/08): `booked_count` chỉ là CACHE, và DB **không có trigger nào** trên
 * TmsVehicleSlot/DeliverySlot — `recount_slot` chỉ chạy khi code GỌI TAY. FK
 * `TmsVehicleSlot.order_id` lại là **ON DELETE CASCADE**, nên xoá lệnh là dòng xe bay theo ÂM THẦM.
 * Xoá một dòng xe ĐANG GIỮ CHỖ mà không đếm lại ⇒ khung giờ kẹt số cũ: đo được cache=2/2 trong khi
 * thực tế chỉ còn 1 xe. Hậu quả nặng ở GIAO DIỆN: picker khoá nút và ghi "Đầy" theo `booked_count`,
 * nên **không ai đặt được vào chỗ trống đó nữa** — và không lượt nào tự sửa (cache chỉ tự khớp lại
 * khi có người đặt THÀNH CÔNG, mà họ bị chính cái khoá đó chặn). RPC đếm SỐNG nên DB vẫn nhận:
 * lệch này là lệch HIỂN THỊ nhưng khoá mất tài nguyên thật.
 */
export async function deleteVehicleSlotsAndRecount(orderIds: string[]): Promise<number> {
  const ids = [...new Set(orderIds.filter(Boolean))]
  if (!ids.length) return 0
  const slotIds = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('TmsVehicleSlot')
      .select('slot_id').in('order_id', ids.slice(i, i + 300)).not('slot_id', 'is', null)
    for (const v of ((data ?? []) as { slot_id: string | null }[])) if (v.slot_id) slotIds.add(v.slot_id)
  }
  for (let i = 0; i < ids.length; i += 300)
    await supabase.from('TmsVehicleSlot').delete().in('order_id', ids.slice(i, i + 300))
  for (const s of slotIds) {
    const { error } = await supabase.rpc('recount_slot', { p_slot_id: s })
    if (error) console.error('[bookingGuards] recount_slot:', error.message)
  }
  return slotIds.size
}

/** Đổi CỬA đặt lịch: khung đang giữ thuộc cửa khác (khung 'ALL' thì mọi cửa đều đậu được → bỏ qua). */
export function slotHeldBlockingCategory(held: HeldSlot[] | undefined, newCat: string): string | null {
  for (const s of held ?? []) {
    if (!s.cargo_type || s.cargo_type === 'ALL' || s.cargo_type === newCat) continue
    return `Xe đang giữ khung giờ ${label(s)} của cửa ${s.cargo_type}`
      + ` — nhả khung giờ trước khi đổi Loại kho booking sang ${newCat}.`
  }
  return null
}

/** Đổi NGÀY xuất: khung đang giữ nằm ở ngày KHÁC ngày mới ⇒ đặt lịch của xe này thành vô nghĩa. */
export function slotHeldBlockingDate(held: HeldSlot[] | undefined, newDate: string): string | null {
  for (const s of held ?? []) {
    if (!s.date || String(s.date).slice(0, 10) === String(newDate).slice(0, 10)) continue
    return `Xe đang giữ khung giờ ${label(s)} (ngày ${String(s.date).slice(0, 10)})`
      + ` — nhả khung giờ trước khi đổi Ngày xuất sang ${newDate}, rồi đặt lại khung của ngày mới.`
  }
  return null
}
