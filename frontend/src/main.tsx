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
import './stores/scopedPersist' // scope filter/saved-views theo user (side-effect)
import './index.css'

initTheme()

// Service worker PWA: precache app shell → mở app/điều hướng được khi offline.
// autoUpdate: deploy mới tự cập nhật nền (không dialog hỏi user).
registerSW({ immediate: true })

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
