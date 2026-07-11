import { useLocation, Link } from 'react-router-dom'
import { Sun, Moon, Bell, Menu, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { Badge } from '@/components/ui/badge'
import { OfflineQueueHeaderButton } from '@/offline/OfflineQueuePanel'

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
    <header className="sticky top-0 z-40 flex h-16 items-center border-b border-white/10 bg-slate-900 text-slate-200 px-4 gap-4">
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
        <span className="font-bold text-sm text-white">MAL SC</span>
      </Link>

      {/* Breadcrumb (desktop) */}
      <div className="hidden lg:flex flex-1">
        <Breadcrumb />
      </div>

      <div className="flex flex-1 lg:flex-none justify-end items-center gap-2">
        {/* Hàng đợi quét offline — chỉ báo lệnh chưa lên, cạnh chuông (bấm mở danh sách) */}
        <OfflineQueueHeaderButton />
        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative text-slate-300 hover:bg-white/10 hover:text-white">
          <Bell className="h-5 w-5" />
          <Badge
            variant="danger"
            className="absolute -top-0.5 -right-0.5 h-4 w-4 p-0 text-[10px] flex items-center justify-center rounded-full"
          >
            3
          </Badge>
        </Button>

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
