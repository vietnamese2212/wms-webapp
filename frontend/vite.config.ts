import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
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
