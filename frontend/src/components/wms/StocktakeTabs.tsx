import { NavLink } from 'react-router-dom'
import { ClipboardCheck, BarChart2, History, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

// Trần số id vị trí nhét được vào query string của API (đo 27/07: 800 id ≈ 32KB → Vercel 414
// TRƯỚC khi request tới BE). Vượt trần → KHÔNG gọi API, hiện hướng dẫn thu hẹp (không cắt âm thầm).
// Chọn đúng bộ "cần check" thì gửi cờ `requires_only=1` — BE tự resolve, không cần id nào.
export const LOC_ID_CAP = 500

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
        <NavLink to="/wms/stocktake/history" className={linkCls}>
          <History className="h-3.5 w-3.5" /> Lịch sử kiểm
        </NavLink>
        <NavLink to="/wms/stocktake/cycle" className={linkCls}>
          <RotateCcw className="h-3.5 w-3.5" /> Luân phiên ABC
        </NavLink>
      </div>
    </div>
  )
}
