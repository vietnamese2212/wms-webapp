import axios from 'axios'

// Dev: Vite proxy chuyển /api → localhost:4000
// Prod: VITE_API_URL trỏ đến Railway backend (VD: https://wms-backend.railway.app)
export const apiClient = axios.create({
  baseURL: (import.meta.env.VITE_API_URL ?? '') + '/api',
  // 30s: backend serverless (Vercel) lúc cold-start / truy vấn nặng có thể >10s;
  // timeout quá ngắn → axios hủy request (ERR_ABORTED) → login/ì ạch bị "thất bại" oan.
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Lỗi ném ra khi thao tác GHI lúc trình duyệt chắc chắn offline — từ chối tức thì
// thay vì để request treo tới timeout. Đợt B (offline scan queue) bắt đúng lỗi này
// (code OFFLINE) để xếp hàng quét thay vì báo lỗi.
export class OfflineError extends Error {
  code = 'OFFLINE'
  constructor() {
    super('Mất kết nối mạng — thao tác chưa được thực hiện, thử lại khi có mạng')
  }
}

apiClient.interceptors.request.use((config) => {
  // Trình duyệt biết chắc offline + request GHI → chặn ngay (GET để React Query tự xử:
  // query đang cache vẫn hiển thị, không cần bắn request chết).
  const method = (config.method ?? 'get').toLowerCase()
  if (method !== 'get' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.reject(new OfflineError())
  }
  const stored = localStorage.getItem('wms-auth')
  if (stored) {
    try {
      const { state } = JSON.parse(stored)
      if (state?.token) {
        config.headers.Authorization = `Bearer ${state.token}`
      }
    } catch {}
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // CHỈ đăng xuất khi request CÓ gửi token mà vẫn bị 401 (token thật sự hết hạn/sai).
    // Nếu 401 đến từ request bắn TRƯỚC lúc token kịp gắn (race khi tải lại trang nặng),
    // token trong localStorage vẫn hợp lệ → KHÔNG được xóa, để React Query thử lại.
    const hadToken = !!(error.config?.headers?.Authorization)
    if (error.response?.status === 401 && hadToken) {
      localStorage.removeItem('wms-auth')
      // Dọn cache + hàng đợi quét khỏi IndexedDB khi phiên hết hạn (máy dùng chung).
      // import động để tránh phụ thuộc vòng ở tầng client thấp.
      import('@/offline/persist').then(m => m.clearOfflineData()).catch(() => {})
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
