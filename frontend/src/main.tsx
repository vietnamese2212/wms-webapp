import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { registerSW } from 'virtual:pwa-register'
import { TooltipProvider } from '@/components/ui/tooltip'
import App from './App'
import { queryClient } from './api/queryClient'
import { persistOptions } from './offline/persist'
import { initTheme } from './stores/uiStore'
import { installClientErrorReport } from './lib/clientErrorReport'
import './stores/scopedPersist' // scope filter/saved-views theo user (side-effect)
import './index.css'

initTheme()
installClientErrorReport()   // lỗi JS của user thật tự báo về error_logs (digest hằng ngày)

// Service worker PWA: precache app shell → mở app/điều hướng được khi offline.
// autoUpdate: deploy mới tự cập nhật nền (không dialog hỏi user).
//
// ⚠️ BẪY THẬT (user 30/07): app CÀI RA MÀN HÌNH CHÍNH mở suốt ngày thì trình duyệt chỉ dò
// service worker mới lúc KHỞI ĐỘNG — kéo-xuống-làm-mới KHÔNG dò, SW cũ cứ trả lại bản cũ đã
// lưu ⇒ máy kẹt ở bản cũ vô hạn (giao diện cũ cãi nhau với backend mới, không tự thoát được).
// Nay chủ động gọi r.update() định kỳ + khi quay lại app → có bản mới là SW tự nạp.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, r) {
    if (!r) return
    const check = () => { if (!document.hidden) r.update().catch(() => {}) }
    setInterval(check, 15 * 60_000)                       // mở suốt ca vẫn dò được bản mới
    document.addEventListener('visibilitychange', check)  // mở lại app từ màn hình chính → dò ngay
    window.addEventListener('online', check)              // vào lại vùng có sóng → dò ngay
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* PersistQueryClientProvider = QueryClientProvider + khôi phục cache từ IndexedDB
        khi mở app (offline vẫn xem lại dữ liệu đã tải — xem offline/persist.ts) */}
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {/* Tooltip cho ActionBtn toàn app — delay ngắn để nút icon-only tự giải thích nhanh */}
      <TooltipProvider delayDuration={250}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </PersistQueryClientProvider>
  </React.StrictMode>
)
