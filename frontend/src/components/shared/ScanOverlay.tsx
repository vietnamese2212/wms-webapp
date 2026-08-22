// KHUNG QUÉT CAMERA DÙNG CHUNG — user chốt 22/08 ("mở giao diện quét lên không giống bình thường").
//
// Trước đó cùng một app có 2 kiểu mở camera: overlay ĐEN TOÀN MÀN (quét tem vị trí, quét ở Nhập/Xuất)
// và một khung camera nhỏ NẰM TRONG dòng chảy trang (Chuyển vị trí, Kiểm kê) — hai kiểu này sống
// cạnh nhau ngay trên CÙNG MỘT màn hình, bấm nút nào ra kiểu nấy. Cùng lớp lỗi với "mỗi chỗ 1 icon
// quét" đã dọn hôm 21/08: một việc thì phải nhìn như nhau ở mọi chỗ.
//
// Portal ra body + `pointer-events-auto`: khung này còn được mở TRONG FormSheet/Dialog của Radix
// (modal set `pointer-events:none` lên body) — thiếu 2 thứ đó là camera hiện ra mà bấm không được
// (bẫy đã ghi ở skill table-format §17).
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'

export function ScanOverlay({ title, icon, onClose, footer, children }: {
  title: string
  /** Mặc định = symbol QUÉT dùng chung; truyền icon khác khi tiêu đề nói về loại tem cụ thể */
  icon?: ReactNode
  onClose: () => void
  /** Dải dưới đáy: trạng thái đang tra / lý do từ chối / hướng dẫn */
  footer?: ReactNode
  children: ReactNode
}) {
  return createPortal(
    <div className="fixed inset-0 z-[300] pointer-events-auto bg-black/80 flex flex-col"
      onPointerDown={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 text-white shrink-0">
        {icon ?? <ScanIcon className="h-4 w-4 text-sky-400 shrink-0" />}
        <p className="text-sm font-semibold">{title}</p>
        <button type="button" onClick={onClose}
          className="ml-auto h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 relative">{children}</div>
      {footer && <div className="shrink-0 px-3 py-2 bg-slate-900 space-y-1.5">{footer}</div>}
    </div>,
    document.body,
  )
}
