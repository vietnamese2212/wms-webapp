// Nút action CHUẨN toàn app (hybrid kiểu AppSheet — user chốt 10/07):
// - Desktop: cao h-7 đồng bộ; nút CHÍNH (primary) hiện icon + nhãn ngắn, nút phụ chỉ icon + tooltip.
// - Mobile (tooltip vô dụng): nút CHÍNH = icon + CHỮ luôn hiện; nút phụ GOM vào menu ⋮
//   (mỗi dòng icon + nhãn đầy đủ, kèm lý do khi bị khóa) → footprint cố định, không phình theo công đoạn.
// Dùng <ActionCluster items={...}/> cho cả cụm; <ActionBtn> là viên gạch desktop bên trong.
// Ghi đè sàn touch-target 44px của Button bằng !min-h-0/!min-w-0 để size đồng nhất.
import { forwardRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { MoreVertical } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
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
              '!min-h-0 !min-w-0 gap-1 rounded-md text-xs shrink-0 h-7',
              primary ? 'w-auto px-2' : 'w-7 p-0',
              className,
            )}
            {...props}
          >
            <Icon className={cn('h-3.5 w-3.5 shrink-0', busy && 'animate-pulse')} />
            {primary && <span>{busy ? 'Đang xử lý…' : label}</span>}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] text-center text-xs">
        {tip ?? label}
      </TooltipContent>
    </Tooltip>
  )
})

// ── ActionCluster — cụm action chuẩn (AppSheet style) ────────────────────────
export interface ActionItem {
  key: string
  icon: LucideIcon
  label: string
  /** Mô tả đầy đủ: tooltip desktop; trên mobile hiện làm dòng phụ khi nút bị khóa (nêu lý do) */
  tip?: string
  onClick: () => void
  /** Hành động chính khu vực (1-2 nút): desktop + mobile đều hiện icon + chữ */
  primary?: boolean
  variant?: ButtonProps['variant']
  /** Styling thêm cho nút desktop (viền/màu chữ) */
  className?: string
  disabled?: boolean
  busy?: boolean
  /** Dòng menu mobile tô đỏ (hành động phá hủy: Xóa, Tạm dừng…) */
  danger?: boolean
  /** Ẩn hẳn trên mobile (vd Upload Excel không dùng trên điện thoại) */
  mobileHidden?: boolean
}

export function ActionCluster({ items, className }: { items: ActionItem[]; className?: string }) {
  const mobileItems = items.filter(i => !i.mobileHidden)
  const primaries = mobileItems.filter(i => i.primary)
  const secondaries = mobileItems.filter(i => !i.primary)
  return (
    <>
      {/* Desktop: tất cả inline, nút phụ icon-only + tooltip */}
      <div className={cn('hidden sm:flex items-center gap-1 flex-wrap justify-end', className)}>
        {items.map(({ key, danger: _d, mobileHidden: _m, ...i }) => <ActionBtn key={key} {...i} />)}
      </div>
      {/* Mobile: nút chính icon + CHỮ bên trái; menu ⋮ GHIM CỐ ĐỊNH mép phải (w-full + ml-auto)
          — vị trí ⋮ không xê dịch theo số nút chính của từng công đoạn */}
      <div className={cn('flex sm:hidden items-center gap-1.5 w-full', className)}>
        {primaries.map(i => (
          <Button key={i.key} variant={i.variant ?? 'outline'} size="sm"
            disabled={i.disabled || i.busy} onClick={i.onClick}
            className={cn('!min-h-0 !min-w-0 h-9 gap-1.5 rounded-md px-3 text-xs shrink-0', i.className)}>
            <i.icon className={cn('h-4 w-4 shrink-0', i.busy && 'animate-pulse')} />
            {i.busy ? 'Đang xử lý…' : i.label}
          </Button>
        ))}
        {secondaries.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Thao tác khác"
                className="!min-h-0 !min-w-0 h-9 w-9 p-0 rounded-md shrink-0 ml-auto">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {secondaries.map(i => (
                <DropdownMenuItem key={i.key} disabled={i.disabled || i.busy}
                  onSelect={() => i.onClick()}
                  className={cn('gap-2 py-2', i.danger && 'text-red-600 focus:text-red-600')}>
                  <i.icon className={cn('h-4 w-4 shrink-0', i.busy && 'animate-pulse')} />
                  <span className="min-w-0">
                    <span className="block text-sm leading-tight">{i.busy ? 'Đang xử lý…' : i.label}</span>
                    {i.disabled && i.tip && (
                      <span className="block text-[11px] leading-snug text-slate-400 whitespace-normal">{i.tip}</span>
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </>
  )
}
