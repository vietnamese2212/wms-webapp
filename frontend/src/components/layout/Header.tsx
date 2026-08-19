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

const breadcrumbMap: Record<string, { label: string; parent?: string; parentPath?: string }> = {
  '/': { label: 'Dashboard' },
  '/wms/inventory': { label: 'Tồn kho', parent: 'Kho', parentPath: '/wms/inventory' },
  '/wms/inbound': { label: 'Nhập kho', parent: 'Kho', parentPath: '/wms/inbound' },
  '/wms/outbound': { label: 'Xuất kho', parent: 'Kho', parentPath: '/wms/outbound' },
  '/wms/locations': { label: 'Vị trí kho', parent: 'Kho', parentPath: '/wms/locations' },
  '/tms/bookings':  { label: 'Kế hoạch VC',  parent: 'Điều vận', parentPath: '/tms/bookings' },
  '/tms/settings':  { label: 'Cài đặt TMS', parent: 'Điều vận', parentPath: '/tms/settings' },
  '/hr/leaves':   { label: 'Nghỉ phép', parent: 'Nhân sự', parentPath: '/hr/leaves' },
  '/hr/assignments': { label: 'Phân công', parent: 'Nhân sự', parentPath: '/hr/assignments' },
  '/hr/attendance': { label: 'Chấm công', parent: 'Nhân sự', parentPath: '/hr/attendance' },
  '/hr/org': { label: 'Sơ đồ tổ chức', parent: 'Nhân sự', parentPath: '/hr/org' },
  '/settings': { label: 'Cài đặt' },
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const crumb = breadcrumbMap[pathname]
  if (!crumb) return null

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      <Link to="/" className="text-slate-400 hover:text-white transition-colors">
        WMS
      </Link>
      {crumb.parent && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
          <span className="text-slate-400">{crumb.parent}</span>
        </>
      )}
      <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
      <span className="font-medium text-white">{crumb.label}</span>
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
    <header className="sticky top-0 z-40 flex h-12 lg:h-16 items-center border-b border-white/10 bg-slate-900 text-slate-200 px-3 lg:px-4 gap-2 lg:gap-4">
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

      {/* Logo (mobile only) */}
      <Link to="/" className="flex items-center gap-2 lg:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500 text-white">
          <span className="text-xs font-bold">M</span>
        </div>
        {/* Ẩn chữ trên màn rất hẹp — nhường chỗ cho nút Bối cảnh Kho (≤360px không tràn) */}
        <span className="font-bold text-sm text-white hidden min-[400px]:inline">MAL SC</span>
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
  )
}
