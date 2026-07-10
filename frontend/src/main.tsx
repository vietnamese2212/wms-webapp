import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TooltipProvider } from '@/components/ui/tooltip'
import App from './App'
import { queryClient } from './api/queryClient'
import { initTheme } from './stores/uiStore'
import './stores/scopedPersist' // scope filter/saved-views theo user (side-effect)
import './index.css'

initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Tooltip cho ActionBtn toàn app — delay ngắn để nút icon-only tự giải thích nhanh */}
      <TooltipProvider delayDuration={250}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
)
