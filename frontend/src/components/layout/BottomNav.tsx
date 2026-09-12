import { NavLink } from 'react-router-dom'
import { LayoutDashboard, PackagePlus, PackageMinus, Scissors, ClipboardList, ShieldCheck, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { canAccess, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'
import { useWorkInbox } from '@/api/hooks'

// Thanh dưới mobile = lối tắt VẬN HÀNH chính (menu đầy đủ ở drawer ☰).
// Thứ tự = ưu tiên: "Việc cần làm" đứng đầu (màn mở đầu ca của xe nâng/thủ kho, 12/09). Thanh chỉ chứa
// tối đa MAX_TABS ô cho vừa 360 px (7 ô × 52 px = tràn) — người có đủ mọi quyền (quản lý, làm việc trên
// PC) mất ô Dashboard ở cuối, vẫn vào được qua drawer ☰.
const MAX_TABS = 6
const ALL_TABS: { to: string; icon: React.ElementType; label: string; end?: boolean; module?: ModuleKey }[] = [
  { to: '/wms/directed',     icon: ListChecks,      label: 'Việc',      module: 'directed_work' },
  { to: '/wms/inbound',      icon: PackagePlus,     label: 'Nhập kho',  module: 'inbound' },
  { to: '/wms/outbound',     icon: PackageMinus,    label: 'Xuất kho',  module: 'outbound' },
  { to: '/wms/loosepicking', icon: Scissors,        label: 'Nhặt lẻ',  module: 'loosepicking' },
  { to: '/tms/bookings',     icon: ClipboardList,   label: 'Kế hoạch',  module: 'tms_plan' },
  { to: '/tms/gate',         icon: ShieldCheck,     label: 'Đăng ký',  module: 'gate_registration' },
  { to: '/',                 icon: LayoutDashboard, label: 'Dashboard', module: 'dashboard', end: true },
]

export function BottomNav() {
  const { user } = useAuthStore()
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user)

  const tabs = ALL_TABS.filter(tab => {
    if (!tab.module) return true
    return admin || canAccess(perms, tab.module)
  }).slice(0, MAX_TABS)
  // Badge "Việc" = số việc CỦA TÔI còn treo (hộp việc đợt C) — mở app là biết hôm nay còn bao nhiêu việc
  const canDirected = !!user && (admin || canAccess(perms, 'directed_work'))
  const inbox = useWorkInbox(null, canDirected)
  const mine = inbox.data?.counts?.mine ?? 0

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:hidden safe-area-inset-bottom">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors min-w-[52px]',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <div className={cn('relative p-1 rounded-lg transition-colors', isActive && 'bg-primary/10')}>
                  <Icon className="h-5 w-5" />
                  {tab.module === 'directed_work' && mine > 0 && (
                    <span className="absolute -top-1 -right-1.5 h-4 min-w-4 px-0.5 text-[10px] flex items-center justify-center rounded-full bg-red-500 text-white font-semibold leading-none">
                      {mine > 99 ? '99+' : mine}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
