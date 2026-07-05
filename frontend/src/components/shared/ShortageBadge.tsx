import type { OutboundShortage } from '@/api/hooks'

// Badge cảnh báo thiếu tồn (đặt cuối cột Mã hàng — Xuất kho / Nhặt lẻ / Chuẩn bị hàng).
// Cấp 1 (vàng): tồn thiếu nhưng tồn + KH nhập về đủ → push hàng về đúng kế hoạch.
// Cấp 2 (đỏ): tồn + KH nhập vẫn thiếu.
export function ShortageBadge({ s }: { s: OutboundShortage | undefined }) {
  if (!s) return null
  const fmt = (n: number) => n.toLocaleString('vi-VN')
  const title = `Cần ${fmt(s.demand)} thùng (cả ngày) · Tồn ${fmt(s.available)} · KH nhập về ${fmt(s.planned)}`
  return (
    <span
      title={title}
      className={`ml-1 shrink-0 align-middle text-[8px] font-semibold px-1 py-px rounded-full whitespace-nowrap ${
        s.level === 1 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {s.level === 1 ? 'Chờ về' : 'Thiếu'}
    </span>
  )
}
