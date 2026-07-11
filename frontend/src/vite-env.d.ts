/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// ID mỗi lần build (define trong vite.config.ts) — làm buster cho cache React Query
// persist: deploy mới → cache offline cũ bị bỏ (tránh lệch shape dữ liệu giữa version).
declare const __BUILD_ID__: string
