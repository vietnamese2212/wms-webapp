import { NavLink } from 'react-router-dom'
import { ClipboardCheck, BarChart2, History, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobileTabs } from '@/hooks/useMobileSurface'

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

// key = khoá cấu hình điện thoại (config/mobileSurface.ts '/wms/stocktake#<key>') — superadmin ẩn được từng tab
const TABS = [
  { key: 'check',   to: '/wms/stocktake',         end: true,  icon: ClipboardCheck, label: 'Check vị trí' },
  { key: 'summary', to: '/wms/stocktake/summary', end: false, icon: BarChart2,      label: 'Tổng hợp KK' },
  { key: 'history', to: '/wms/stocktake/history', end: false, icon: History,        label: 'Lịch sử kiểm' },
  { key: 'cycle',   to: '/wms/stocktake/cycle',   end: false, icon: RotateCcw,      label: 'Luân phiên ABC' },
] as const

export function StocktakeTabs() {
  // Tab là ROUTE CON nên không có state để "nhảy về tab đầu" — chỉ lọc nút; deep-link vẫn mở được (luật: ẨN, không chặn).
  const tabs = useMobileTabs('/wms/stocktake', TABS, null)
  return (
    // Rà 21/09: 4 tab cần ~455 px, khung 336 px ở 360/390 ⇒ "Luân phiên ABC" nằm ngoài màn, không bấm được.
    // Dải cuộn ngang + ẩn thanh cuộn (cùng cách TabsList) thay vì inline-flex cứng.
    <div className="shrink-0 px-3 pt-3 pb-2 sm:px-0 sm:pt-0 overflow-x-auto no-scrollbar">
      <div className="inline-flex h-8 items-center rounded-md bg-slate-100 p-1">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <NavLink key={t.key} to={t.to} end={t.end} className={linkCls}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}
