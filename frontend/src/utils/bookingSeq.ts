// Tra STT booking cho 1 chuyến xuất (GDO) — dùng chung list Xuất kho + board Chuẩn bị hàng.
// 1 Số xe có thể có NHIỀU xe vật lý đặt lịch (add_vehicle) → ưu tiên dòng khớp BIỂN SỐ
// (so trên dạng CHUẨN normalizeLicensePlate, không so chuỗi thô); không khớp thì lấy STT nhỏ nhất.
import type { BookingSeqRow } from '@/api/hooks'
import { normalizeLicensePlate } from '@/utils/formatters'

export function bookingSeqOf(
  rows: BookingSeqRow[],
  gdo: { group_code: string; delivery_date: string; warehouse_id?: string | null; license_plate?: string | null },
): BookingSeqRow | null {
  const cands = rows.filter(r =>
    r.direction === 'OUTBOUND'
    && r.order_code === gdo.group_code
    && r.date === gdo.delivery_date
    && (!gdo.warehouse_id || r.warehouse_id === gdo.warehouse_id))
  if (!cands.length) return null
  const plate = gdo.license_plate ? normalizeLicensePlate(gdo.license_plate) : ''
  if (plate) {
    const hit = cands.find(r => r.license_plate && normalizeLicensePlate(r.license_plate) === plate)
    if (hit) return hit
  }
  return cands.reduce((a, b) => (a.stt <= b.stt ? a : b))
}

// Nhãn ngắn hiển thị khung giờ: "07:00–08:00"
export function seqTimeLabel(r: BookingSeqRow): string {
  return `${r.time_from}–${r.time_to}`
}
