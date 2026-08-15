import { Check, Minus } from 'lucide-react'

/**
 * Ô tick chọn dòng trong bảng (chuẩn Manhattan) — dùng chung cho mọi list page có thao tác
 * HÀNG LOẠT theo dòng: cột đầu là ô tick, header là tick chọn cả trang (indeterminate khi
 * chọn dở), thao tác nằm ở thanh action nổi dưới màn.
 *
 * Cỡ 3.5 (không dùng <input type="checkbox"> thô) để không kéo dòng bảng cao lên — nút/ô
 * có sàn touch-target 44px sẽ phá chiều cao dòng (memory touch-target-row-height-trap).
 * Tự chặn click nổi lên dòng (click dòng = chọn/mở detail).
 */
export function RowCheck({ checked, indeterminate, onClick }: {
  checked: boolean; indeterminate?: boolean; onClick: () => void
}) {
  return (
    <div
      onClick={e => { e.preventDefault(); e.stopPropagation(); onClick() }}
      className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center cursor-pointer transition-colors
        ${checked || indeterminate ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white hover:border-blue-400'}`}
    >
      {checked && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
      {!checked && indeterminate && <Minus className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
    </div>
  )
}
