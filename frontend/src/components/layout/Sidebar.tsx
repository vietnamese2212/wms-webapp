import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Package, PackagePlus, PackageMinus, MapPin,
  Truck, Navigation, Calendar, Settings, Settings2, ChevronLeft, ChevronRight,
  BarChart3, ClipboardList, UserCog, Scissors, ScanLine, ClipboardCheck, BarChart2, ShieldCheck, Tag, QrCode, CalendarRange, CalendarCheck, Network,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { canAccess, canAccessAny, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'

interface NavItem {
  to: string
  icon: React.ElementType
  label: string
  module?: ModuleKey
  modules?: ModuleKey[]   // hiện nếu bất kỳ module nào trong list có view access
  adminOnly?: boolean
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
      { to: '/wms/inventory',         icon: Package,        label: 'Tồn kho',       module: 'inventory' },
      { to: '/wms/inbound',           icon: PackagePlus,    label: 'Nhập kho',       module: 'inbound' },
      { to: '/wms/pallet-labels',     icon: QrCode,         label: 'In tem pallet',  module: 'pallet_print' as ModuleKey },
      { to: '/wms/pallet-ops',        icon: Scissors,       label: 'Dồn / Tách pallet', module: 'pallet_ops' as ModuleKey },
      { to: '/wms/outbound',          icon: PackageMinus,   label: 'Xuất kho',       module: 'outbound' },
      { to: '/wms/outbound/scan-log', icon: ScanLine,       label: 'Lịch sử quét',   module: 'scanlog' },
      { to: '/wms/loosepicking',      icon: Scissors,       label: 'Nhặt lẻ',        module: 'loosepicking' },
      { to: '/wms/locations',         icon: MapPin,         label: 'Vị trí kho',     module: 'locations' },
      { to: '/wms/stocktake',         icon: ClipboardCheck, label: 'Check vị trí',   module: 'stocktake' },
      { to: '/wms/stocktake/summary', icon: BarChart2,      label: 'Tổng hợp KK',    module: 'stocktake' },
      { to: '/wms/settings',          icon: Settings2,      label: 'Cài đặt WMS',    module: 'wms_settings' as ModuleKey },
    ],
  },
  {
    label: 'Vận tải (TMS)',
    items: [
      { to: '/tms/bookings',   icon: ClipboardList, label: 'Kế hoạch VC',    module: 'tms_plan' },
      { to: '/tms/reports',    icon: BarChart2,     label: 'Báo cáo nhập',   module: 'tms_plan' },
      { to: '/tms/gate',       icon: ShieldCheck,   label: 'Đăng ký cổng',  module: 'gate_registration' },
      { to: '/tms/settings',   icon: Settings2,     label: 'Cài đặt TMS',   modules: ['tms_vehicle_types', 'tms_slots', 'tms_companies', 'tms_vehicles'] },
      { to: '/tms/deliveries', icon: Navigation,    label: 'Giao hàng',     module: 'deliveries' },
    ],
  },
  {
    label: 'Nhân sự (HR)',
    items: [
      { to: '/hr/assignments', icon: CalendarRange, label: 'Phân công',     module: 'work_assignment' as ModuleKey },
      { to: '/hr/attendance',  icon: CalendarCheck, label: 'Chấm công',     module: 'attendance' as ModuleKey },
      { to: '/hr/org',         icon: Network,     label: 'Sơ đồ tổ chức',  module: 'employees' as ModuleKey },
      { to: '/hr/schedule',    icon: Calendar,    label: 'Lịch làm việc',  module: 'schedule' },
    ],
  },
  {
    label: 'Quản trị',
    items: [
      { to: '/masterdata/materials', icon: Tag,     label: 'Mã hàng',            module: 'materials' as ModuleKey },
      { to: '/masterdata/users',     icon: UserCog, label: 'Quản lý người dùng', module: 'employees' as ModuleKey },
    ],
  },
]

function NavItemComponent({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const allItems = navGroups.flatMap(g => g.items)
  const isActive = item.to === '/'
    ? location.pathname === '/'
    : (location.pathname === item.to || location.pathname.startsWith(item.to + '/')) &&
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
        'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-white/10 text-white'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
        collapsed && 'justify-center px-2'
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-sky-400" />
      )}
      <Icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : 'h-4 w-4', isActive && 'text-sky-300')} />
      {!collapsed && <span className="truncate">{item.label}</span>}
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
  const modulePerms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user?.name)

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
          'hidden lg:flex flex-col bg-slate-900 text-slate-200 transition-all duration-300 ease-in-out',
          sidebarCollapsed ? 'w-16' : 'w-60'
        )}
      >
        {/* Header */}
        <div className={cn('flex h-16 items-center border-b border-white/10 px-4', sidebarCollapsed && 'justify-center px-2')}>
          {!sidebarCollapsed ? (
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500 text-white">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-bold leading-none text-white">WMS Pro</p>
                <p className="text-[10px] text-slate-400">Supply Chain</p>
              </div>
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500 text-white">
              <BarChart3 className="h-4 w-4" />
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-4">
          <nav className="space-y-5 px-2">
            {navGroups.map((group) => {
              const visibleItems = group.items.filter(item => {
                if (item.adminOnly) return admin
                if (item.modules) return admin || canAccessAny(modulePerms, ...item.modules)
                if (!item.module) return true
                return admin || canAccess(modulePerms, item.module)
              })
              if (visibleItems.length === 0) return null
              return (
              <div key={group.label}>
                {!sidebarCollapsed && (
                  <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    {group.label}
                  </p>
                )}
                {sidebarCollapsed && <div className="mb-2 mx-2 border-t border-white/10" />}
                <div className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <NavItemComponent key={item.to} item={item} collapsed={sidebarCollapsed} />
                  ))}
                </div>
              </div>
              )
            })}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-white/10 p-2">
          {!sidebarCollapsed && (
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                )
              }
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span>Cài đặt</span>
            </NavLink>
          )}

          {!sidebarCollapsed && user && (
            <div className="mt-2 flex items-center gap-3 rounded-md px-3 py-2">
              <Avatar className="h-7 w-7 text-xs">
                <AvatarFallback className="bg-slate-700 text-slate-100">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-100">{user.name}</p>
                <p className="truncate text-[10px] text-slate-400">{user.job_title_name ?? ''}</p>
              </div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={toggleSidebar}
            className="mt-1 flex w-full items-center justify-center rounded-md p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
