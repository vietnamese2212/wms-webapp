import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    // PWA: precache app shell (index.html + toàn bộ chunk) → mất mạng vẫn mở được app,
    // F5 không chết, điều hướng sang trang CHƯA từng mở vẫn vào được (kho sóng chập chờn).
    // Bonus: hết lỗi "deploy xong chunk hash cũ 404" (chunk cũ còn trong precache).
    VitePWA({
      registerType: 'autoUpdate',   // deploy mới → SW tự cập nhật nền, không hỏi user
      manifest: {
        name: 'WMS Supply Chain',
        short_name: 'WMS',
        description: 'Hệ thống quản lý kho vận Supply Chain',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // SPA fallback khi offline — nhưng TUYỆT ĐỐI không nuốt /api (serverless cùng origin)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // Google Fonts (index.html load từ CDN) — cache để offline không vỡ font
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-woff',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  // ID build — buster cho persist cache React Query (xem vite-env.d.ts)
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // CHỈ tách các vendor luôn-cần & ổn định (react/router/query/radix) thành chunk
        // riêng để cache lâu qua các lần deploy. KHÔNG gom catch-all — để Vite tự tách
        // phần còn lại, giữ các lib chỉ-1-trang (vd xlsx) ở dạng lazy theo chunk trang đó.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react-vendor'
          if (id.includes('@tanstack')) return 'query'
          if (id.includes('@radix-ui')) return 'radix'
        },
      },
    },
  },
})
