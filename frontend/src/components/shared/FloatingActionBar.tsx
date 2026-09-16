import type { ReactNode } from 'react'

/**
 * Thanh thao tác NỔI khi chọn nhiều dòng — cùng kiểu pill tối giữa đáy màn của trang Tồn kho.
 *
 * Vì sao nổi chứ không chèn một hàng vào giữa band và bảng (user chốt 16/09: "tick multi là hiện action
 * lên, table không được resize"): hàng chèn vào làm vùng bảng co lại đúng lúc người dùng đang tick ⇒ dòng
 * nhảy dưới con trỏ, tick tiếp là trúng dòng khác. Pill nổi không chiếm chỗ trong luồng, bảng đứng yên.
 * `bottom-16` chừa thanh điều hướng dưới của điện thoại; nút bên trong dùng nút THƯỞNG (không ActionCluster)
 * để mobile vẫn thấy đủ mọi thao tác.
 */
export function FloatingActionBar({ count, unit, children }: { count: number; unit: string; children: ReactNode }) {
  if (count <= 0) return null
  return (
    <div className="fixed bottom-16 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-16px)]
      bg-slate-800 text-white rounded-2xl sm:rounded-full shadow-2xl px-3 sm:px-4 py-2
      flex items-center justify-center gap-2 sm:gap-3 flex-wrap text-sm">
      <span className="text-slate-300 text-xs font-medium whitespace-nowrap">{count} {unit}</span>
      <div className="hidden sm:block w-px h-4 bg-slate-600" />
      {children}
    </div>
  )
}

/** Lớp màu cho nút đặt trong pill tối — dùng chung để mọi thanh nổi trông như nhau */
export const FLOATING_BTN = 'h-8 text-[11px] border-slate-600 bg-slate-700 text-slate-100 hover:bg-slate-600 hover:text-white'
export const FLOATING_BTN_DANGER = 'h-8 text-[11px] border-red-400/60 bg-slate-700 text-red-200 hover:bg-red-900/60 hover:text-white'
