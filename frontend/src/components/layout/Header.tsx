import { useLocation, Link } from 'react-router-dom'
import { Sun, Moon, Menu, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { NotificationBell } from './NotificationBell'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import { useUIStore } from '@/stores/uiStore'
import { useAuthStore } from '@/stores/authStore'
import { MobileNav } from './MobileNav'
import { GlobalScopePicker } from './GlobalScopePicker'
import { OfflineQueueHeaderButton } from '@/offline/OfflineQueuePanel'
import { AppUpdateButton } from '@/components/shared/AppUpdateButton'
import { navTrail } from '@/config/navigation'

// Trang KHÔNG nằm trên menu nhưng vẫn là trang đích (cài đặt cá nhân, nghỉ phép mở từ Chấm công)
const OFF_MENU: Record<string, { group: string; page: string }> = {
  '/settings': { group: 'Tài khoản', page: 'Cài đặt' },
  '/hr/leaves': { group: 'Nhân sự (HR)', page: 'Nghỉ phép' },
}

/** Đường dẫn suy từ cây menu (`navTrail`) — không còn bảng chép tay (xem chú thích ở navigation.ts). */
function Breadcrumb() {
  const { pathname } = useLocation()
  const t = navTrail(pathname) ?? (OFF_MENU[pathname] ? { ...OFF_MENU[pathname], section: undefined, to: pathname, exact: true } : null)
  if (!t) return null
  const sep = <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
  return (
    <nav className="flex items-center gap-1.5 text-sm min-w-0" aria-label="Đường dẫn">
      <span className="text-slate-400 whitespace-nowrap">{t.group}</span>
      {t.section && <>{sep}<span className="text-slate-400 whitespace-nowrap">{t.section}</span></>}
      {sep}
      {t.exact
        ? <span className="font-medium text-white truncate">{t.page}</span>
        : <Link to={t.to} className="font-medium text-white hover:text-sky-300 transition-colors truncate">{t.page}</Link>}
    </nav>
  )
}

export function Header() {
  const { theme, toggleTheme } = useUIStore()
  const { user, logout } = useAuthStore()

  const initials = user?.name
    .split(' ')
    .slice(-2)
    .map((n) => n[0])
    .join('')
    .toUpperCase() ?? 'U'

  return (
    <div className="sticky top-0 z-40">
    <header className="flex h-12 lg:h-16 items-center border-b border-white/10 bg-slate-900 text-slate-200 px-3 lg:px-4 gap-2 lg:gap-4">
      {/* Mobile menu */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden text-slate-300 hover:bg-white/10 hover:text-white">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-72">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu điều hướng</SheetTitle>
          </SheetHeader>
          <MobileNav />
        </SheetContent>
      </Sheet>

      {/* Logo (mobile only) — TÊN chỉ hiện từ sm trở lên: ở 360 px cái tên chiếm ~88 px, tự xuống
          2 DÒNG trong thanh cao 48 px và đẩy nút tài khoản ra tận x=366 (cắt mất 6 px ngoài màn,
          đo 12/09). Điện thoại giữ ô "M" là đủ nhận diện — tên app không phải thứ người trong kho
          cần đọc lại mỗi màn, còn đang ở trang nào thì thanh dưới đã nói. */}
      <Link to="/" className="flex items-center gap-2 lg:hidden shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500 text-white">
          <span className="text-xs font-bold">M</span>
        </div>
        <span className="hidden sm:inline font-bold text-sm text-white whitespace-nowrap">Mal SupplyC</span>
      </Link>

      {/* Bối cảnh Kho / Loại kho toàn cục (kiểu Infor) — áp cho filter & form toàn app */}
      <GlobalScopePicker />

      {/* Breadcrumb (desktop) */}
      <div className="hidden lg:flex flex-1">
        <Breadcrumb />
      </div>

      <div className="flex flex-1 lg:flex-none justify-end items-center gap-2">
        {/* Hàng đợi quét offline — chỉ báo lệnh chưa lên, cạnh chuông (bấm mở danh sách) */}
        <OfflineQueueHeaderButton />
        {/* Cập nhật app — cạnh chuông (user chốt 30/07): PWA giữ bản cũ trong máy, phải có nút
            ép lấy bản mới; điện thoại không có Ctrl+Shift+R. Sáng lên khi phát hiện bản mới. */}
        <AppUpdateButton />
        {/* Chuông = trung tâm thông báo thật (06/08): tab Cá nhân / Chung / Cài đặt chuông */}
        <NotificationBell />

        {/* Theme toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-slate-300 hover:bg-white/10 hover:text-white">
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2 h-9 text-slate-200 hover:bg-white/10 hover:text-white">
              <Avatar className="h-7 w-7 text-xs">
                <AvatarFallback className="bg-slate-700 text-slate-100">{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start">
                <span className="text-xs font-medium leading-none">{user?.name}</span>
                <span className="text-[10px] text-slate-400 leading-none mt-0.5">
                  {user?.job_title_name ?? ''}
                </span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings">Cài đặt tài khoản</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={logout}
            >
              Đăng xuất
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    {/* Mobile: thanh bối cảnh Kho/Loại kho FULL-WIDTH riêng 1 hàng — nhìn ra ngay đang chọn gì */}
    <GlobalScopePicker variant="bar" />
    </div>
  )
}
