import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Package, PackagePlus, UserCog, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/wms/inventory', icon: Package, label: 'Tồn kho', end: false },
  { to: '/wms/inbound', icon: PackagePlus, label: 'Nhập kho', end: false },
  { to: '/masterdata/users', icon: UserCog, label: 'Người dùng', end: false },
  { to: '/settings', icon: Settings, label: 'Cài đặt', end: false },
]

export function BottomNav() {
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
                'flex flex-col items-center gap-0.5 px-4 py-2 rounded-lg transition-colors min-w-[60px]',
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
