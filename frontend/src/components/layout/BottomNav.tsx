import { NavLink } from 'react-router-dom'
import { clearReturnTo } from '@/lib/returnTo'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { canSeeNavItem } from '@/config/navigation'
import { isAdmin, type ModulePermissions } from '@/config/permissions'
import { useWorkInbox } from '@/api/hooks'
import { useMobileSurface } from '@/hooks/useMobileSurface'
import { BOTTOM_NAV_DEFAULT, BOTTOM_NAV_MAX, BOTTOM_NAV_SHORT_LABEL, MOBILE_PAGE_BY_TO } from '@/config/mobileSurface'

// Thanh dưới mobile = lối tắt VẬN HÀNH chính (menu đầy đủ ở drawer ☰).
// Thứ tự MẶC ĐỊNH (BOTTOM_NAV_DEFAULT): "Việc cần làm" đứng đầu (màn mở đầu ca của xe nâng/thủ kho, 12/09).
// Từ 21/09 superadmin CHỌN được trang nào lên thanh và thứ tự (cờ `mobile_surface.bottom_nav`) và ẨN
// trang khỏi điện thoại (`hidden`) — trước đó danh sách cứng 7 ô cắt còn 6 nên thủ kho phải đi 3 nhát
// drawer mới tới Chuyển vị trí / Kiểm kê. Thanh vẫn tối đa MAX ô cho vừa 360 px (7 ô × 52 px = tràn).
export function BottomNav() {
  const { user } = useAuthStore()
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user)
  const { cfg, isHidden } = useMobileSurface()

  const order = cfg.bottom_nav ?? BOTTOM_NAV_DEFAULT
  const tabs = order
    .map(to => MOBILE_PAGE_BY_TO.get(to))
    .filter((p): p is NonNullable<typeof p> => !!p && canSeeNavItem(p.item, perms, admin) && !isHidden(p.to))
    .slice(0, BOTTOM_NAV_MAX)
  // Badge "Việc" = số việc CỦA TÔI còn treo (hộp việc đợt C) — mở app là biết hôm nay còn bao nhiêu việc
  const canDirected = !!user && tabs.some(t => t.to === '/wms/directed')
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
            end={tab.to === '/'}
            onClick={clearReturnTo}
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
                  {tab.to === '/wms/directed' && mine > 0 && (
                    <span className="absolute -top-1 -right-1.5 h-4 min-w-4 px-0.5 text-[10px] flex items-center justify-center rounded-full bg-red-500 text-white font-semibold leading-none">
                      {mine > 99 ? '99+' : mine}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium leading-none whitespace-nowrap">{BOTTOM_NAV_SHORT_LABEL[tab.to] ?? tab.label}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
