import { NavLink } from 'react-router-dom'
import { LayoutDashboard, PackagePlus, PackageMinus, Scissors, ClipboardList, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { canAccess, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'

// Thanh dưới mobile = lối tắt VẬN HÀNH chính (menu đầy đủ ở drawer ☰)
const ALL_TABS: { to: string; icon: React.ElementType; label: string; end?: boolean; module?: ModuleKey }[] = [
  { to: '/wms/inbound',      icon: PackagePlus,     label: 'Nhập kho',  module: 'inbound' },
  { to: '/wms/outbound',     icon: PackageMinus,    label: 'Xuất kho',  module: 'outbound' },
  { to: '/wms/loosepicking', icon: Scissors,        label: 'Nhặt lẻ',  module: 'loosepicking' },
  { to: '/tms/bookings',     icon: ClipboardList,   label: 'Kế hoạch',  module: 'tms_plan' },
  { to: '/tms/gate',         icon: ShieldCheck,     label: 'Đăng ký',  module: 'gate_registration' },
  { to: '/',                 icon: LayoutDashboard, label: 'Dashboard', end: true },
]

export function BottomNav() {
  const { user } = useAuthStore()
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user)

  const tabs = ALL_TABS.filter(tab => {
    if (!tab.module) return true
    return admin || canAccess(perms, tab.module)
  })

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
                <div className={cn('p-1 rounded-lg transition-colors', isActive && 'bg-primary/10')}>
                  <Icon className="h-5 w-5" />
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
