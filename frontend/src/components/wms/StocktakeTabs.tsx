import { NavLink } from 'react-router-dom'
import { ClipboardCheck, BarChart2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Thanh tab dùng chung cho công cụ Kiểm kê: Check vị trí + Tổng hợp KK.
// Điều hướng route (giữ 2 trang/2 route riêng — deep-link cũ vẫn chạy).
// Trông giống TabsTrigger (shadcn) để đồng bộ với các trang có tab khác.
const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all',
    isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
  )

export function StocktakeTabs() {
  return (
    <div className="shrink-0 px-3 pt-3 pb-2 sm:px-0 sm:pt-0">
      <div className="inline-flex h-8 items-center rounded-md bg-slate-100 p-1">
        <NavLink to="/wms/stocktake" end className={linkCls}>
          <ClipboardCheck className="h-3.5 w-3.5" /> Check vị trí
        </NavLink>
        <NavLink to="/wms/stocktake/summary" className={linkCls}>
          <BarChart2 className="h-3.5 w-3.5" /> Tổng hợp KK
        </NavLink>
      </div>
    </div>
  )
}
