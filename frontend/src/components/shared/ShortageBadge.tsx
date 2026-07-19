import type { OutboundShortage } from '@/api/hooks'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'

// Badge cảnh báo thiếu tồn (đặt cuối cột Mã hàng — Xuất kho / Nhặt lẻ / Chuẩn bị hàng).
// Cấp 1 (vàng): tồn thiếu nhưng tồn + KH nhập về đủ → push hàng về đúng kế hoạch.
// Cấp 2 (đỏ): tồn + KH nhập vẫn thiếu.
// demand/available/planned từ RPC = số BASE → quy đổi "N thùng + M hộp" qua qtyLabel(mat).
export function ShortageBadge({ s, mat }: { s: OutboundShortage | undefined; mat?: MatUnits | null }) {
  if (!s) return null
  const title = `Cần ${qtyLabel(s.demand, mat)} (cả ngày) · Tồn ${qtyLabel(s.available, mat)} · KH nhập về ${qtyLabel(s.planned, mat)}`
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
