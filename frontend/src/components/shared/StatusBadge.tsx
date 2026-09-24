import React from 'react'

/**
 * StatusBadge — badge trạng thái CHUẨN DUY NHẤT toàn app (hiến pháp UI 24/08, theo mẫu
 * Manhattan yard.png: soft color, không viền, không nền đặc kiểu button).
 * Ngữ nghĩa tone (dùng đúng nghĩa, đừng chọn theo "màu đẹp"):
 *   green  = đang hoạt động / OK / đã gán
 *   blue   = hoàn thành / đã chốt
 *   amber  = đang chạy / dở dang / cần chú ý nhẹ
 *   red    = chặn / tạm dừng / lỗi / quá hạn
 *   slate  = chờ / trung tính / không hoạt động
 *   sky    = thông tin / nhấn điều hướng
 *   purple = phân loại đặc thù (nội bộ, nhóm riêng)
 *   orange = cảnh báo vận hành (storage/lưu bãi…)
 * KHÔNG tự chế `bg-*-100 text-*-700` rải rác nữa — thêm tone mới thì thêm vào bảng TONE.
 */
export type BadgeTone = 'green' | 'blue' | 'amber' | 'red' | 'slate' | 'sky' | 'purple' | 'orange'

const TONE: Record<BadgeTone, string> = {
  green:  'bg-green-100 text-green-700',
  blue:   'bg-blue-100 text-blue-700',
  amber:  'bg-amber-100 text-amber-700',
  red:    'bg-red-100 text-red-700',
  slate:  'bg-slate-100 text-slate-500',
  sky:    'bg-sky-100 text-sky-700',
  purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-700',
}

export function StatusBadge({ tone, children, className, title }: {
  tone: BadgeTone
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <span title={title}
      className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${TONE[tone]} ${className ?? ''}`}>
      {children}
    </span>
  )
}
