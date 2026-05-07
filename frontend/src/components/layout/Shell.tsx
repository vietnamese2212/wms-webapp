import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { Toaster } from '@/components/ui/toaster'

export function Shell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          <div className="h-full">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
      <Toaster />
    </div>
  )
}
