import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, ChevronDown, BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { prefetchPage } from '@/routes/lazyPages'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { isAdmin, type ModulePermissions } from '@/config/permissions'
import { NAV_GROUPS, ALL_NAV_ITEMS, isSection, visibleEntries, type NavItem, type NavSection } from '@/config/navigation'
import { DevCredit } from '@/components/shared/DevCredit'

/** Trang đang mở? (mục có đường dẫn là TIỀN TỐ của mục khác thì nhường mục sâu hơn) */
function useIsActive(to: string): boolean {
  const location = useLocation()
  if (to === '/') return location.pathname === '/'
  return (location.pathname === to || location.pathname.startsWith(to + '/')) &&
    !ALL_NAV_ITEMS.some(o => o.to !== to && o.to.startsWith(to + '/') && location.pathname.startsWith(o.to))
}

function NavItemComponent({ item, collapsed, nested = false }: { item: NavItem; collapsed: boolean; nested?: boolean }) {
  const isActive = useIsActive(item.to)
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
        nested && !collapsed && 'py-1.5 pl-8 text-[13px]',
        collapsed && 'justify-center px-2'
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-sky-400" />
      )}
      <Icon className={cn('shrink-0', collapsed ? 'h-5 w-5' : nested ? 'h-3.5 w-3.5' : 'h-4 w-4', isActive && 'text-sky-300')} />
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

/** Nhóm chức năng (cấp 2) — mở sẵn khi đang đứng trong nhóm, gập/mở nhớ theo phiên làm việc. */
function NavSectionComponent({ section, collapsed }: { section: NavSection; collapsed: boolean }) {
  const location = useLocation()
  const hasActive = section.items.some(i =>
    location.pathname === i.to || location.pathname.startsWith(i.to + '/'))
  const [open, setOpen] = useState(hasActive)
  const Icon = section.icon
  // Rail thu gọn chỉ vừa ICON: hiện thẳng các trang, đừng bắt mở một cấp không nhìn thấy nhãn
  if (collapsed) return <>{section.items.map(i => <NavItemComponent key={i.to} item={i} collapsed />)}</>
  const show = open || hasActive
  return (
    <div>
      <button
        onClick={() => setOpen(!show)}
        className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          hasActive ? 'text-slate-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100')}
      >
        <Icon className={cn('h-4 w-4 shrink-0', hasActive && 'text-sky-300')} />
        <span className="truncate flex-1 text-left">{section.label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !show && '-rotate-90')} />
      </button>
      {show && (
        <div className="space-y-0.5">
          {section.items.map(i => <NavItemComponent key={i.to} item={i} collapsed={false} nested />)}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { user } = useAuthStore()
  const modulePerms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user)

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
                <p className="text-sm font-bold leading-none text-white">Mal SupplyC</p>
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
              const entries = visibleEntries(group.items, modulePerms, admin)
              if (entries.length === 0) return null
              return (
              <div key={group.label}>
                {!sidebarCollapsed && (
                  <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    {group.label}
                  </p>
                )}
                {sidebarCollapsed && <div className="mb-2 mx-2 border-t border-white/10" />}
                <div className="space-y-0.5">
                  {entries.map(e => isSection(e)
                    ? <NavSectionComponent key={e.label} section={e} collapsed={sidebarCollapsed} />
                    : <NavItemComponent key={e.to} item={e} collapsed={sidebarCollapsed} />)}
                </div>
              </div>
              )
            })}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-white/10 p-2">
          {/* Ghi công tác giả — ẩn khi thu gọn rail (chỗ đó chỉ vừa icon) */}
          {!sidebarCollapsed && <DevCredit tone="dark" className="px-1 pb-1" />}
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
