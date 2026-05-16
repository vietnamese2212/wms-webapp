import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Package, PackagePlus, PackageMinus, MapPin,
  Truck, Navigation, Users, Calendar, Settings, ChevronLeft, ChevronRight,
  BarChart3, ClipboardList, UserCog, Scissors, ScanLine, ClipboardCheck, BarChart2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { roleLabel } from '@/utils/formatters'

interface NavItem {
  to: string
  icon: React.ElementType
  label: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: 'Tổng quan',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Kho vận (WMS)',
    items: [
      { to: '/wms/inventory', icon: Package, label: 'Tồn kho' },
      { to: '/wms/inbound', icon: PackagePlus, label: 'Nhập kho' },
      { to: '/wms/outbound', icon: PackageMinus, label: 'Xuất kho' },
      { to: '/wms/outbound/scan-log', icon: ScanLine, label: 'Lịch sử quét' },
      { to: '/wms/loosepicking', icon: Scissors, label: 'Nhặt lẻ' },
      { to: '/wms/locations',         icon: MapPin,          label: 'Vị trí kho' },
      { to: '/wms/stocktake',         icon: ClipboardCheck,  label: 'Check vị trí' },
      { to: '/wms/stocktake/summary', icon: BarChart2,        label: 'Tổng hợp KK' },
    ],
  },
  {
    label: 'Vận tải (TMS)',
    items: [
      { to: '/tms/vehicles', icon: Truck, label: 'Xe & Tài xế' },
      { to: '/tms/deliveries', icon: Navigation, label: 'Giao hàng' },
    ],
  },
  {
    label: 'Nhân sự (HR)',
    items: [
      { to: '/hr/employees', icon: Users, label: 'Nhân viên' },
      { to: '/hr/schedule', icon: Calendar, label: 'Lịch làm việc' },
    ],
  },
  {
    label: 'Quản trị',
    items: [
      { to: '/masterdata/users', icon: UserCog, label: 'Quản lý người dùng' },
    ],
  },
]

function NavItemComponent({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const allItems = navGroups.flatMap(g => g.items)
  const isActive = item.to === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(item.to) &&
      !allItems.some(
        other => other.to !== item.to &&
          other.to.startsWith(item.to + '/') &&
          location.pathname.startsWith(other.to)
      )
  const Icon = item.icon

  const linkContent = (
    <NavLink
      to={item.to}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
        'hover:bg-accent hover:text-accent-foreground',
        isActive
          ? 'bg-primary/10 text-primary dark:bg-primary/20'
          : 'text-muted-foreground',
        collapsed && 'justify-center px-2'
      )}
    >
      <Icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-4 w-4')} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && isActive && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </NavLink>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    )
  }

  return linkContent
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { user } = useAuthStore()

  const initials = user?.name
    .split(' ')
    .slice(-2)
    .map((n) => n[0])
    .join('')
    .toUpperCase() ?? 'U'

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'hidden lg:flex flex-col border-r bg-background transition-all duration-300 ease-in-out',
          sidebarCollapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Header */}
        <div className={cn('flex h-16 items-center border-b px-4', sidebarCollapsed && 'justify-center px-2')}>
          {!sidebarCollapsed ? (
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold leading-none text-foreground">WMS Pro</p>
                <p className="text-[10px] text-muted-foreground">Supply Chain</p>
              </div>
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BarChart3 className="h-4 w-4" />
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-6 px-2">
            {navGroups.map((group) => (
              <div key={group.label}>
                {!sidebarCollapsed && (
                  <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                    {group.label}
                  </p>
                )}
                {sidebarCollapsed && <Separator className="mb-2" />}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavItemComponent key={item.to} item={item} collapsed={sidebarCollapsed} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t p-2">
          {!sidebarCollapsed && (
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all hover:bg-accent',
                  isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
                )
              }
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span>Cài đặt</span>
            </NavLink>
          )}

          {!sidebarCollapsed && user && (
            <div className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2">
              <Avatar className="h-7 w-7 text-xs">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{user.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">{roleLabel[user.role]}</p>
              </div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={toggleSidebar}
            className={cn(
              'mt-1 flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
