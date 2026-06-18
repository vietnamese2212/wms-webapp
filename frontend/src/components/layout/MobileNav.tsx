import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Package, PackagePlus, PackageMinus, MapPin,
  Truck, Navigation, Calendar, Settings, Settings2, BarChart3, Scissors, ScanLine,
  ClipboardCheck, BarChart2, UserCog, ClipboardList, ShieldCheck, Tag, QrCode, CalendarRange, CalendarCheck, Network,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { canAccess, canAccessAny, isAdmin, type ModuleKey, type ModulePermissions } from '@/config/permissions'

const navGroups: { label: string; items: { to: string; icon: React.ElementType; label: string; module?: ModuleKey; modules?: ModuleKey[]; adminOnly?: boolean }[] }[] = [
  {
    label: 'Tổng quan',
    items: [{ to: '/', icon: LayoutDashboard, label: 'Dashboard' }],
  },
  {
    label: 'Kho vận (WMS)',
    items: [
      { to: '/wms/inventory',         icon: Package,        label: 'Tồn kho',     module: 'inventory' },
      { to: '/wms/inbound',           icon: PackagePlus,    label: 'Nhập kho',     module: 'inbound' },
      { to: '/wms/pallet-labels',     icon: QrCode,         label: 'In tem pallet', module: 'pallet_print' as ModuleKey },
      { to: '/wms/pallet-ops',        icon: Scissors,       label: 'Dồn / Tách pallet', module: 'pallet_ops' as ModuleKey },
      { to: '/wms/outbound',          icon: PackageMinus,   label: 'Xuất kho',     module: 'outbound' },
      { to: '/wms/loosepicking',      icon: Scissors,       label: 'Nhặt lẻ',      module: 'loosepicking' },
      { to: '/wms/outbound/scan-log', icon: ScanLine,       label: 'Lịch sử quét', module: 'scanlog' },
      { to: '/wms/locations',         icon: MapPin,         label: 'Vị trí kho',   module: 'locations' },
      { to: '/wms/stocktake',         icon: ClipboardCheck, label: 'Check vị trí', module: 'stocktake' },
      { to: '/wms/stocktake/summary', icon: BarChart2,      label: 'Tổng hợp KK',  module: 'stocktake' },
    ],
  },
  {
    label: 'Vận tải (TMS)',
    items: [
      { to: '/tms/bookings',   icon: ClipboardList, label: 'Kế hoạch VC',  module: 'tms_plan' },
      { to: '/tms/gate',       icon: ShieldCheck,   label: 'Đăng ký cổng', module: 'gate_registration' },
      { to: '/tms/settings',   icon: Settings2,     label: 'Cài đặt TMS',  modules: ['tms_vehicle_types', 'tms_slots', 'tms_companies', 'tms_vehicles'] },
      { to: '/tms/deliveries', icon: Navigation,    label: 'Giao hàng',    module: 'deliveries' },
    ],
  },
  {
    label: 'Nhân sự (HR)',
    items: [
      { to: '/hr/assignments', icon: CalendarRange, label: 'Phân công',      module: 'work_assignment' },
      { to: '/hr/attendance',  icon: CalendarCheck, label: 'Chấm công',      module: 'attendance' },
      { to: '/hr/org',         icon: Network,       label: 'Sơ đồ tổ chức',  module: 'employees' },
      { to: '/hr/schedule',    icon: Calendar,      label: 'Lịch làm việc', module: 'schedule' },
    ],
  },
  {
    label: 'Quản trị',
    items: [
      { to: '/masterdata/materials', icon: Tag,     label: 'Mã hàng',            module: 'materials' as ModuleKey },
      { to: '/masterdata/users',     icon: UserCog, label: 'Quản lý người dùng', module: 'user_admin' as ModuleKey },
    ],
  },
]

export function MobileNav() {
  const { user } = useAuthStore()
  const modulePerms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user?.name)
  const initials = user?.name.split(' ').slice(-2).map((n) => n[0]).join('').toUpperCase() ?? 'U'

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500 text-white">
          <BarChart3 className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-bold text-white">WMS Pro</p>
          <p className="text-[10px] text-slate-400">Supply Chain</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-4 space-y-5">
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
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {visibleItems.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-sky-400" />}
                        <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-sky-300')} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 p-4 space-y-2">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
            )
          }
        >
          <Settings className="h-4 w-4" />
          Cài đặt
        </NavLink>
        <div className="border-t border-white/10" />
        {user && (
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar className="h-8 w-8 text-xs">
              <AvatarFallback className="bg-slate-700 text-slate-100">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{user.name}</p>
              <p className="truncate text-xs text-slate-400">{user.job_title_name ?? ''}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
