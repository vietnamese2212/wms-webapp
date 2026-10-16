// TÌNH TRẠNG SAP của một OD trên bàn ghép xe = MỘT BIỂU TƯỢNG có màu + tooltip (16/10, user: "tình trạng SAP thể hiện qua biểu tượng, có màu
// và tooltip — không ghi ra tốn không gian như hiện tại"). Hổ phách = cờ THAM CHIẾU (SAP đã post / đã gắn xe — không chặn gì, user chốt 03/10);
// đỏ = cờ CỨNG phải xử lý (SAP thay / bỏ / sửa · đã vào KH xuất · họ hàng đã đi). Chữ đầy đủ + chi tiết nằm ở tooltip và cột "Lưu ý".
import { PackageCheck, Link2, Replace, XCircle, PencilLine, CalendarCheck, GitBranch, type LucideIcon } from 'lucide-react'
import type { DispatchOdFlag } from '@/api/hooks'
import { FLAG_VI, SOFT_FLAG_KINDS } from './dispatchIssues'

const ICON: Record<DispatchOdFlag['kind'], LucideIcon> = {
  SHIPPED: PackageCheck, SAP_ASSIGNED: Link2, REPLACED: Replace, GONE: XCircle, CHANGED: PencilLine, IN_PLAN: CalendarCheck, KIN_SHIPPED: GitBranch,
}

export function SapFlagIcon({ flag }: { flag: DispatchOdFlag }) {
  const Icon = ICON[flag.kind]
  const soft = SOFT_FLAG_KINDS.has(flag.kind)
  const tip = `${FLAG_VI[flag.kind]}${flag.info ? ` — ${flag.info}` : ''}${soft ? ' (tham chiếu — không chặn)' : ''}`
  return (
    <span role="img" aria-label={tip} title={tip}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${soft ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
      <Icon className="h-3 w-3" />
    </span>
  )
}
