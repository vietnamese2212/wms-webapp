import { Suspense, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { PageFallback } from '@/components/shared/PageFallback'
import { PageErrorBoundary } from '@/components/shared/PageErrorBoundary'
import { Toaster } from '@/components/ui/toaster'
import { apiClient } from '@/api/client'
import { inboundPagedQueryOptions, inboundListParamsOf } from '@/api/hooks'
import { connectRealtimeEvents } from '@/api/realtimeEvents'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { setRealtimeAuth } from '@/lib/supabase'
import { setUnitLabels } from '@/utils/qtyUnits'
import { OfflineBanner } from '@/offline/OfflineBanner'
import { AppUpdateBanner } from '@/components/shared/AppUpdateButton'
import { OfflineQueuePanel } from '@/offline/OfflineQueuePanel'
import { initScanQueue } from '@/offline/scanQueue'

export function Shell() {
  const qc = useQueryClient()
  const location = useLocation()
  const refreshUser = useAuthStore(s => s.refreshUser)

  useEffect(() => {
    // Refresh user permissions from DB on every app load so permission
    // changes made by admin take effect without requiring a re-login.
    refreshUser()
    // Quyền nhúng trong JWT → tab SPA mở suốt sẽ giữ quyền cũ (kể cả quyền ĐÃ GỠ) vô hạn.
    // Refresh định kỳ: /me trả token mới → cấp/gỡ quyền có hiệu lực trong ≤5 phút không cần reload.
    const permSync = setInterval(refreshUser, 5 * 60_000)

    // Nạp NHÃN đơn vị tính từ danh mục (LookupValue unit_of_measure) cho formatter số lượng —
    // ĐVT do người dùng tự thêm (SET/ROL/M2…) trước đây hiện ra mã thô vì helper chỉ biết 6 mã cứng.
    // Lỗi mạng → bỏ qua, helper vẫn có lưới đỡ mặc định.
    apiClient.get('/wms/lookup', { params: { type: 'unit_of_measure' } })
      .then(r => setUnitLabels(((r.data?.data ?? []) as { value: string; meta?: { label?: string } | null }[])
        .map(u => ({ value: u.value, label: u.meta?.label }))))
      .catch(() => {})

    // Warm up serverless function + DB connection on app load.
    // Cold start can take 3-5s; this ping fires early so subsequent
    // data requests (when user navigates) land on a warm runtime.
    apiClient.get('/health').catch(() => {})

    // Prefetch inbound orders immediately so navigating to /wms/inbound is instant.
    // Fires while user is still on the home/dashboard page.
    // Phải prefetch ĐÚNG key + ĐÚNG bộ lọc trang sẽ dùng (bản cũ gọi list KHÔNG tham số =
    // kéo cả bảng rồi vứt vì key ['inbound-orders', {}] không khớp key nào).
    {
      const f = useWmsFilterStore.getState().inbound
      const user = useAuthStore.getState().user
      qc.prefetchQuery({
        ...inboundPagedQueryOptions({
          ...inboundListParamsOf(f, user?.warehouse_id),
          page: f.page || 1, limit: f.pageSize || 500,
        }),
        staleTime: 30_000,
      })
    }

    // Gắn vé realtime đã persist (nếu có) TRƯỚC khi mở kênh → reload app vẫn kết nối
    // realtime dưới RLS đóng-hẳn. refreshUser() ở trên sẽ tái cấp vé mới khi /me trả về.
    setRealtimeAuth(useAuthStore.getState().realtimeToken)
    // Connect to SSE for real-time sync (no-op if VITE_API_URL is not set)
    connectRealtimeEvents()

    // Hàng đợi quét offline: hydrate từ IndexedDB + tự replay khi mạng về
    initScanQueue()

    // Mạng về sau khi đứt → realtime event trong lúc offline đã MẤT VĨNH VIỄN
    // (Supabase không replay) → invalidate toàn bộ để xóa stale, list tự refetch.
    const onBackOnline = () => qc.invalidateQueries()
    window.addEventListener('online', onBackOnline)
    return () => {
      clearInterval(permSync)
      window.removeEventListener('online', onBackOnline)
    }
  }, [qc, refreshUser])

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Header />
        <OfflineBanner />
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0 bg-slate-100">
          {/* Page transition: fade + trượt nhẹ mỗi lần đổi route (key theo pathname) */}
          <div key={location.pathname} className="h-full animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out">
            <PageErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<PageFallback />}>
                <Outlet />
              </Suspense>
            </PageErrorBoundary>
          </div>
        </main>
      </div>
      <BottomNav />
      <OfflineQueuePanel />
      <AppUpdateBanner />
      <Toaster />
    </div>
  )
}
