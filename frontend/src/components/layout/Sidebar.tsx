import { NavLink, useLocation } from 'react-router-dom'
import {
  Settings, ChevronLeft, ChevronRight, BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { prefetchPage } from '@/routes/lazyPages'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { canAccess, canAccessAny, isAdmin, type ModulePermissions } from '@/config/permissions'
import { NAV_GROUPS, type NavItem } from '@/config/navigation'

function NavItemComponent({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const allItems = NAV_GROUPS.flatMap(g => g.items)
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
      onMouseEnter={() => prefetchPage(item.to)}
      onFocus={() => prefetchPage(item.to)}
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
                <p className="text-sm font-bold leading-none text-white">MAL SC</p>
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
            {NAV_GROUPS.map((group) => {
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
