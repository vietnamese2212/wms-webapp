import { Suspense, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { BottomNav } from './BottomNav'
import { PageFallback } from '@/components/shared/PageFallback'
import { PageErrorBoundary } from '@/components/shared/PageErrorBoundary'
import { Toaster } from '@/components/ui/toaster'
import { apiClient } from '@/api/client'
import { inboundPagedQueryOptions, inboundListParamsOf } from '@/api/hooks'
import { connectRealtimeEvents, setSessionRevokedHandler } from '@/api/realtimeEvents'
import { waitSelfPasswordChangeIdle } from '@/lib/selfPasswordChange'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { setRealtimeAuth } from '@/lib/supabase'
import { setUnitLabels, setPackHints } from '@/utils/qtyUnits'
import { OfflineBanner } from '@/offline/OfflineBanner'
import { ReturnBar } from './ReturnBar'
import { AppUpdateBanner } from '@/components/shared/AppUpdateButton'
import { OfflineQueuePanel } from '@/offline/OfflineQueuePanel'
import { initScanQueue } from '@/offline/scanQueue'

export function Shell() {
  const qc = useQueryClient()
  const location = useLocation()
  // Quy cách GỢI Ý của mã cân / đong (27/11 — đường 1 bao = 20 kg): vài mã, nạp một lần cho dòng "50 bao" ở mọi màn số lượng.
  // Là query (không phải gọi một lần) để sửa Mã hàng — ở máy này hay máy khác (realtime bảng Material) — thì gợi ý theo kịp.
  const { data: packHints } = useQuery({
    queryKey: ['material-pack-hints'],
    queryFn: () => apiClient.get('/masterdata/materials/pack-hints').then(r => (r.data?.data ?? []) as Parameters<typeof setPackHints>[0]),
    staleTime: 10 * 60_000,
  })
  useEffect(() => { if (packHints) setPackHints(packHints) }, [packHints])
  const refreshUser = useAuthStore(s => s.refreshUser)

  useEffect(() => {
    // Refresh user permissions from DB on every app load so permission
    // changes made by admin take effect without requiring a re-login.
    let lastMe = Date.now()
    const doRefresh = () => { lastMe = Date.now(); return refreshUser() }
    void refreshUser()
    // Quyền nhúng trong JWT → tab SPA mở suốt sẽ giữ quyền cũ (kể cả quyền ĐÃ GỠ) vô hạn.
    // Refresh định kỳ: /me trả token mới → cấp/gỡ quyền có hiệu lực trong ≤5 phút không cần reload.
    const permSync = setInterval(doRefresh, 5 * 60_000)
    // (19/11) ĐỔI MẬT KHẨU ⇒ ĐÁ NGAY: tín hiệu realtime cá nhân ⇒ kiểm lại phiên; token phát trước lần đổi ⇒ /me 401
    // PASSWORD_CHANGED ⇒ về trang đăng nhập. Chờ 2,5 giây + chờ máy đang TỰ đổi lưu xong token mới (tab khác cùng trình duyệt
    // đọc chung localStorage nên cũng dùng token mới).
    setSessionRevokedHandler(() => { setTimeout(() => { void waitSelfPasswordChangeIdle().then(doRefresh) }, 2500) })
    // Máy ngủ / mất mạng đúng lúc có tín hiệu (Broadcast không phát lại) ⇒ mở lại app sau ≥ 1 phút thì kiểm lại phiên ngay
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastMe > 60_000) void doRefresh() }
    document.addEventListener('visibilitychange', onVisible)

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
    // Mở 2 kênh Broadcast riêng tư (chung + cá nhân theo employee id) — xem realtimeEvents.ts
    connectRealtimeEvents(useAuthStore.getState().user?.id)

    // Hàng đợi quét offline: hydrate từ IndexedDB + tự replay khi mạng về
    initScanQueue()

    // Mạng về sau khi đứt → realtime event trong lúc offline đã MẤT VĨNH VIỄN
    // (Supabase không replay) → invalidate toàn bộ để xóa stale, list tự refetch.
    const onBackOnline = () => qc.invalidateQueries()
    window.addEventListener('online', onBackOnline)
    return () => {
      clearInterval(permSync)
      setSessionRevokedHandler(null)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onBackOnline)
    }
  }, [qc, refreshUser])

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Header />
        <OfflineBanner />
        {/* "‹ Về Việc cần làm" — điểm neo cho trang giao việc, hiện ở mọi trang đích (14/09) */}
        <ReturnBar />
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
