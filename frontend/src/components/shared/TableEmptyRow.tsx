import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Dòng "trống" cho bảng RỘNG (table-fixed cuộn ngang) — đo 19/09 bằng vai thủ kho trên 360 px:
 * `<td colSpan>` trải theo bề rộng BẢNG (Fill hàng 1.646 px · Lịch sử chuyển vị trí 1.170 px) nên câu
 * "Không mã nào thiếu…" căn giữa nằm ở x ≈ 820 — ngoài màn hình, người dùng nhìn vào một bảng TRẮNG
 * và không biết là hết dữ liệu hay đang tải hỏng. Trang Xuất kho không dính vì đặt câu rỗng NGOÀI bảng.
 *
 * Cách chữa: câu chữ là khối `sticky left-0` rộng vừa nội dung, tối đa bằng khung nhìn — bảng cuộn tới
 * đâu nó vẫn đứng ở mép trái vùng nhìn. Không căn giữa theo td (căn giữa là thứ đẩy nó ra ngoài màn).
 * Ratchet `empty_row_centered_in_wide_td` gác dòng trống viết tay kiểu cũ.
 */
export function TableEmptyRow({ colSpan, children, className }: { colSpan: number; children: ReactNode; className?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div className={cn('sticky left-0 w-fit max-w-[calc(100vw-2rem)] px-4 py-8 text-xs text-slate-400', className)}>{children}</div>
      </td>
    </tr>
  )
}
