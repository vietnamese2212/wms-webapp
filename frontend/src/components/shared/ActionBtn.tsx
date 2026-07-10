// Nút action CHUẨN toàn app (hybrid — user chốt 10/07):
// - Desktop: cao h-7 đồng bộ; nút CHÍNH (primary) hiện icon + nhãn ngắn, nút phụ chỉ icon.
// - Mobile: icon-only 40×40 (dễ bấm) — nhãn dồn vào tooltip/aria.
// - Tooltip luôn có (desktop hover); nút disabled vẫn hiện tooltip (bọc span).
// Ghi đè sàn touch-target 44px của Button bằng !min-h-0/!min-w-0 để size đồng nhất.
import { forwardRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface ActionBtnProps extends Omit<ButtonProps, 'size'> {
  icon: LucideIcon
  /** Nhãn ngắn — hiện cạnh icon khi primary (desktop), luôn là aria-label */
  label: string
  /** Tooltip mô tả đầy đủ (mặc định = label) */
  tip?: string
  /** Hành động chính của khu vực (tối đa 1-2 nút): desktop hiện icon + nhãn */
  primary?: boolean
  /** Đang gọi API: disable + icon nhấp nháy + nhãn "Đang xử lý…" */
  busy?: boolean
}

export const ActionBtn = forwardRef<HTMLButtonElement, ActionBtnProps>(function ActionBtn(
  { icon: Icon, label, tip, primary = false, busy = false, className, variant = 'outline', disabled, ...props },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span để tooltip vẫn nổi khi nút disabled (nút disabled không nhận pointer event) */}
        <span className="inline-flex shrink-0">
          <Button
            ref={ref}
            variant={variant}
            size="sm"
            aria-label={label}
            disabled={disabled || busy}
            className={cn(
              '!min-h-0 !min-w-0 gap-1 rounded-md text-xs shrink-0',
              'h-10 sm:h-7',
              primary ? 'w-10 p-0 sm:w-auto sm:px-2' : 'w-10 p-0 sm:w-7',
              className,
            )}
            {...props}
          >
            <Icon className={cn('h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5', busy && 'animate-pulse')} />
            {primary && <span className="hidden sm:inline">{busy ? 'Đang xử lý…' : label}</span>}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] text-center text-xs">
        {tip ?? label}
      </TooltipContent>
    </Tooltip>
  )
})
