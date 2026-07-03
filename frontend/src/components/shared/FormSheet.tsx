import { type ComponentProps, type ReactNode } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

interface FormSheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  /** Nút thao tác dưới đáy (Huỷ / Lưu…). Dính đáy, luôn thấy được trên cả PC & mobile. */
  footer?: ReactNode
  /** Bề rộng panel trên desktop. Mặc định max-w-lg (giống dialog cũ). */
  widthClass?: string
  /** Chặn đóng khi bấm ra ngoài (vd click vào combobox portal). Truyền thẳng cho SheetContent. */
  onPointerDownOutside?: ComponentProps<typeof SheetContent>['onPointerDownOutside']
}

/**
 * CHUẨN form Thêm/Sửa toàn app — panel trượt từ lề PHẢI, cao full màn hình,
 * chia 3 vùng: header cố định · thân cuộn · footer dính đáy (nút luôn thấy).
 * Mobile: full width. Dropdown bên trong phải render qua portal (usePopoverAnchor /
 * Radix Select) để KHÔNG bị `overflow` của thân cuộn cắt mất.
 */
export function FormSheet({
  open, onClose, title, description, children, footer,
  widthClass = 'sm:max-w-lg', onPointerDownOutside,
}: FormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent side="right" className={`w-full ${widthClass} p-0 gap-0 flex flex-col`} onPointerDownOutside={onPointerDownOutside}>
        <div className="border-b border-slate-200 px-4 py-3 shrink-0 pr-10">
          <SheetTitle className="text-base font-semibold text-slate-800">{title}</SheetTitle>
          {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {children}
        </div>

        {footer && (
          <div className="border-t border-slate-200 bg-white px-4 py-3 shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
