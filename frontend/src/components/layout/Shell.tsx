import { Suspense, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { PageFallback } from '@/components/shared/PageFallback'
import { Toaster } from '@/components/ui/toaster'
import { apiClient } from '@/api/client'
import { connectRealtimeEvents } from '@/api/realtimeEvents'
import { useAuthStore } from '@/stores/authStore'

export function Shell() {
  const qc = useQueryClient()
  const location = useLocation()
  const refreshUser = useAuthStore(s => s.refreshUser)

  useEffect(() => {
    // Refresh user permissions from DB on every app load so permission
    // changes made by admin take effect without requiring a re-login.
    refreshUser()

    // Warm up serverless function + DB connection on app load.
    // Cold start can take 3-5s; this ping fires early so subsequent
    // data requests (when user navigates) land on a warm runtime.
    apiClient.get('/health').catch(() => {})

    // Prefetch inbound orders immediately so navigating to /wms/inbound is instant.
    // Fires while user is still on the home/dashboard page.
    qc.prefetchQuery({
      queryKey: ['inbound-orders', {}],
      queryFn: () => apiClient.get('/wms/inbound-orders').then((r) => r.data.data),
      staleTime: 30_000,
    })

    // Connect to SSE for real-time sync (no-op if VITE_API_URL is not set)
    connectRealtimeEvents()
  }, [qc, refreshUser])

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0 bg-slate-100">
          {/* Page transition: fade + trượt nhẹ mỗi lần đổi route (key theo pathname) */}
          <div key={location.pathname} className="h-full animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out">
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      <BottomNav />
      <Toaster />
    </div>
  )
}
