// Nút action CHUẨN toàn app (hybrid kiểu AppSheet — user chốt 10/07):
// - Desktop: cao h-7 đồng bộ; nút CHÍNH (primary) hiện icon + nhãn ngắn, nút phụ chỉ icon + tooltip.
// - Mobile (tooltip vô dụng): nút CHÍNH = icon + CHỮ luôn hiện; nút phụ GOM vào menu ⋮
//   (mỗi dòng icon + nhãn đầy đủ, kèm lý do khi bị khóa) → footprint cố định, không phình theo công đoạn.
// Dùng <ActionCluster items={...}/> cho cả cụm; <ActionBtn> là viên gạch desktop bên trong.
// PHÂN LOẠI (18/11 — user: "cái nào liên quan tới VẬN HÀNH đưa ra ngoài theo tuần tự công việc, cái nào liên quan tới QUẢN TRỊ (sửa,
// đóng, duplicate…) thì để trong 3 chấm — áp nguyên tắc này cho các tình huống tương tự"):
//   ops   = bước công việc / nút xem phục vụ việc đang làm ⇒ luôn NGOÀI ⋮ ở mọi cỡ màn, có chữ; thứ tự trong mảng = thứ tự công việc
//   admin = sửa · đóng · nhân bản · huỷ · gỡ / bỏ duyệt ⇒ luôn TRONG ⋮ ở mọi cỡ màn (máy tính cũng có ⋮)
//   không gắn = như cũ (máy tính nút icon, điện thoại vào ⋮) — trang chưa phân loại không đổi.
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
  /** VẬN HÀNH: luôn ngoài ⋮ (cả điện thoại), có chữ — xếp theo thứ tự công việc */
  ops?: boolean
  /** QUẢN TRỊ: luôn trong ⋮ (cả máy tính) */
  admin?: boolean
}

/** Menu ⋮ — một khuôn cho máy tính (h-7) và điện thoại (h-9): dòng = icon + nhãn đầy đủ, dòng khoá kèm lý do */
function MoreMenu({ items, desktop }: { items: ActionItem[]; desktop?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* text-foreground TƯỜNG MINH: cụm đặt trong pill tối (thanh bulk Tồn kho `text-white`) kế thừa
            màu chữ trắng ⇒ icon ⋮ trắng trên nền trắng = ô trống không ai bấm (đo 390 px, 21/09) */}
        <Button variant="outline" size="sm" aria-label="Thao tác khác" title={desktop ? 'Thao tác khác: sửa · huỷ · …' : undefined}
          className={cn('!min-h-0 !min-w-0 p-0 rounded-md shrink-0 ml-auto text-foreground', desktop ? 'h-7 w-7' : 'h-9 w-9')}>
          <MoreVertical className={desktop ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {items.map(i => (
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
  )
}

export function ActionCluster({ items, className, mobileInline }: { items: ActionItem[]; className?: string; mobileInline?: boolean }) {
  const mobileItems = items.filter(i => !i.mobileHidden)
  // ngoài ⋮ ở điện thoại: nút chính + nút vận hành, GIỮ thứ tự mảng (= thứ tự công việc); quản trị luôn vào ⋮
  const primaries = mobileItems.filter(i => (i.primary || i.ops) && !i.admin)
  const secondaries = mobileItems.filter(i => !(i.primary || i.ops) || i.admin)
  const hasOps = primaries.some(i => i.ops)
  const deskAdmin = items.filter(i => i.admin)
  return (
    <>
      {/* Desktop: inline — nút chính / vận hành có chữ, nút phụ icon-only + tooltip; quản trị gom vào ⋮ cuối cụm */}
      <div className={cn('hidden sm:flex items-center gap-1 flex-wrap justify-end', className)}>
        {items.filter(i => !i.admin).map(({ key, danger: _d, mobileHidden: _m, ops, admin: _a, primary, ...i }) => <ActionBtn key={key} {...i} primary={primary || ops} />)}
        {deskAdmin.length > 0 && <MoreMenu items={deskAdmin} desktop />}
      </div>
      {/* Mobile: nút chính icon + CHỮ bên trái; menu ⋮ GHIM CỐ ĐỊNH mép phải (ml-auto)
          — vị trí ⋮ không xê dịch theo số nút chính của từng công đoạn.
          Mặc định w-full = cụm chiếm 1 hàng riêng (header detail…). mobileInline (toolbar list PDA):
          flex-1 basis-0 + min-w-fit → CHIA SẺ hàng với SavedViews khi vừa, tự wrap nguyên cụm khi chật
          (không bao giờ tràn ra ngoài màn) — tiết kiệm 1 hàng chrome trên màn nhỏ (Zebra TC27).
          Cụm toàn nút mobileHidden → không render (tránh div rỗng chiếm 1 dòng wrap).
          Có nút VẬN HÀNH (ops) ⇒ cụm chiếm hàng riêng và TỰ XUỐNG DÒNG (nhiều bước có chữ không vừa một hàng 360 px — không tràn ngang) */}
      {mobileItems.length > 0 && (
      <div className={cn('flex sm:hidden items-center gap-1.5', hasOps ? 'w-full flex-wrap' : mobileInline ? 'flex-1 basis-0 min-w-fit' : 'w-full', className)}>
        {primaries.map(i => (
          <Button key={i.key} variant={i.variant ?? 'outline'} size="sm"
            disabled={i.disabled || i.busy} onClick={i.onClick}
            className={cn('!min-h-0 !min-w-0 h-9 gap-1.5 rounded-md px-3 text-xs shrink-0', i.className)}>
            <i.icon className={cn('h-4 w-4 shrink-0', i.busy && 'animate-pulse')} />
            {i.busy ? 'Đang xử lý…' : i.label}
          </Button>
        ))}
        {secondaries.length > 0 && <MoreMenu items={secondaries} />}
      </div>
      )}
    </>
  )
}
