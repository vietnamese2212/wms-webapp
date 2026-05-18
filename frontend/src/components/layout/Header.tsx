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

const breadcrumbMap: Record<string, { label: string; parent?: string; parentPath?: string }> = {
  '/': { label: 'Dashboard' },
  '/wms/inventory': { label: 'Tồn kho', parent: 'Kho vận', parentPath: '/wms/inventory' },
  '/wms/inbound': { label: 'Nhập kho', parent: 'Kho vận', parentPath: '/wms/inbound' },
  '/wms/outbound': { label: 'Xuất kho', parent: 'Kho vận', parentPath: '/wms/outbound' },
  '/wms/locations': { label: 'Vị trí kho', parent: 'Kho vận', parentPath: '/wms/locations' },
  '/tms/vehicles': { label: 'Xe & Tài xế', parent: 'Vận tải', parentPath: '/tms/vehicles' },
  '/tms/deliveries': { label: 'Giao hàng', parent: 'Vận tải', parentPath: '/tms/deliveries' },
  '/hr/schedule': { label: 'Lịch làm việc', parent: 'Nhân sự', parentPath: '/hr/schedule' },
  '/settings': { label: 'Cài đặt' },
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const crumb = breadcrumbMap[pathname]
  if (!crumb) return null

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
        WMS
      </Link>
      {crumb.parent && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="text-muted-foreground">{crumb.parent}</span>
        </>
      )}
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
      <span className="font-medium text-foreground">{crumb.label}</span>
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
    <header className="sticky top-0 z-40 flex h-16 items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 gap-4">
      {/* Mobile menu */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden">
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
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <span className="text-xs font-bold">W</span>
        </div>
        <span className="font-bold text-sm">WMS Pro</span>
      </Link>

      {/* Breadcrumb (desktop) */}
      <div className="hidden lg:flex flex-1">
        <Breadcrumb />
      </div>

      <div className="flex flex-1 lg:flex-none justify-end items-center gap-2">
        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          <Badge
            variant="danger"
            className="absolute -top-0.5 -right-0.5 h-4 w-4 p-0 text-[10px] flex items-center justify-center rounded-full"
          >
            3
          </Badge>
        </Button>

        {/* Theme toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2 h-9">
              <Avatar className="h-7 w-7 text-xs">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start">
                <span className="text-xs font-medium leading-none">{user?.name}</span>
                <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
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
