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

apiClient.interceptors.request.use((config) => {
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
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
