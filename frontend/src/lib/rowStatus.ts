/**
 * Chuẩn highlight trạng thái dùng chung (kiểu Outbound / Manhattan Active WMS).
 * KHÔNG fill nền dòng — chỉ tô MÀU CHỮ theo trạng thái + gạch ngang khi hoàn thành.
 * Dùng cho cả <TableRow> ở list lẫn header của trang detail để đồng nhất màu.
 */

export type RowStatusKey =
  | 'completed'   // hoàn thành — xanh dương + gạch ngang
  | 'full'        // đầy / xong (không gạch) — xanh dương
  | 'scanDone'    // quét xong — hồng
  | 'inProgress'  // đang xử lý — cam
  | 'assigned'    // đã giao đơn — xanh lá
  | 'paused'      // tạm dừng — đỏ
  | 'pending'     // chưa xử lý — xám (chữ thường)
  | 'review'      // chờ duyệt / chờ kiểm (vd mẻ chờ QA duyệt — 18/11) — tím
  | 'cancelled'   // đã huỷ — xám nhạt + gạch ngang

const TEXT: Record<RowStatusKey, string> = {
  completed:  'text-[#4A90D9] line-through',
  full:       'text-[#4A90D9]',
  scanDone:   'text-pink-600',
  inProgress: 'text-[#D8891C]',
  assigned:   'text-green-600',
  paused:     'text-red-500',
  pending:    'text-slate-700',
  review:     'text-purple-600',
  cancelled:  'text-slate-400 line-through',
}

/** Màu chữ thuần theo trạng thái (cho header detail, cell, badge text…). */
export function statusText(key: RowStatusKey): string {
  return TEXT[key]
}

/** Class cho <TableRow>: màu chữ theo trạng thái + hover nền nhạt (không fill nền). */
export function rowText(key: RowStatusKey): string {
  return `${TEXT[key]} hover:bg-slate-50`
}
