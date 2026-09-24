import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * CollapseSection — khối PHỤ của trang detail (hiến pháp UI 24/08, giảm scroll mobile).
 * - Mobile: THU GỌN mặc định thành 1 thanh tiêu đề (bấm mới xổ) → mở trang là thấy phần cốt lõi.
 * - Desktop (lg+): MỞ mặc định, vẫn bấm gọn được.
 * - KHÔNG dùng cho khối cốt lõi (band, bảng dòng hàng chính) — các khối đó luôn mở;
 *   bảng dòng hàng giữ scroll NGANG, tuyệt đối không mở/đóng từng row dọc (user chốt 24/08).
 * Thanh tiêu đề theo đúng section-band Manhattan: nền slate + vạch accent sky + chữ IN HOA.
 */
export function CollapseSection({ title, badge, children, className }: {
  title: string
  badge?: React.ReactNode   // đếm/tóm tắt hiện ngay trên thanh khi đang gọn (vd "2 phiếu")
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 bg-slate-100 border-y border-slate-200 px-2 py-1.5 text-left">
        <span className="w-1 self-stretch bg-sky-500 rounded-sm shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 flex-1 truncate">{title}</span>
        {badge != null && <span className="text-[10px] text-slate-500 shrink-0">{badge}</span>}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
      </button>
      {open && children}
    </div>
  )
}
