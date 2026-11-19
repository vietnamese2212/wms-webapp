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

/** Token đang lưu (localStorage dùng chung MỌI tab cùng trình duyệt) — mỗi request đọc lại nên tab nào lưu token mới thì tab khác dùng ngay. */
export function storedToken(): string | null {
  try { return (JSON.parse(localStorage.getItem('wms-auth') ?? 'null') as { state?: { token?: string | null } } | null)?.state?.token ?? null } catch { return null }
}
/** Request bị 401 có gửi token KHÁC token đang lưu ⇒ tab khác cùng trình duyệt vừa nhận token mới (vd vừa tự đổi mật khẩu):
 *  không phải phiên hết hạn — KHÔNG được xoá phiên (xoá là đá luôn tab kia). 19/11. */
export function rejectedStaleToken(config: { headers?: Record<string, unknown> } | undefined): boolean {
  const sent = String(config?.headers?.Authorization ?? '').replace(/^Bearer /, '')
  const cur = storedToken()
  return !!sent && !!cur && sent !== cur
}

apiClient.interceptors.request.use((config) => {
  // Trình duyệt biết chắc offline + request GHI → chặn ngay (GET để React Query tự xử:
  // query đang cache vẫn hiển thị, không cần bắn request chết).
  const method = (config.method ?? 'get').toLowerCase()
  if (method !== 'get' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.reject(new OfflineError())
  }
  // BASE UNIT (đợt 2): đánh dấu MỌI body write "số lượng theo đơn vị gốc" — BE chặn 409
  // payload thiếu cờ (bundle cũ gửi thùng thập phân). Chỉ gắn vào object JSON thường.
  if (method !== 'get' && config.data && typeof config.data === 'object'
      && !(config.data instanceof FormData) && !Array.isArray(config.data)
      && (config.data as Record<string, unknown>).qty_semantics === undefined) {
    ;(config.data as Record<string, unknown>).qty_semantics = 'base'
  }
  const tok = storedToken()
  if (tok) config.headers.Authorization = `Bearer ${tok}`
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // CHỈ đăng xuất khi request CÓ gửi token mà vẫn bị 401 (token thật sự hết hạn/sai).
    // Nếu 401 đến từ request bắn TRƯỚC lúc token kịp gắn (race khi tải lại trang nặng),
    // token trong localStorage vẫn hợp lệ → KHÔNG được xóa, để React Query thử lại.
    const hadToken = !!(error.config?.headers?.Authorization)
    if (error.response?.status === 401 && hadToken && rejectedStaleToken(error.config)) {
      // tab khác đã lưu token mới ⇒ tab này nhận lại phiên từ bộ nhớ chung thay vì đăng xuất (import động: tránh vòng phụ thuộc)
      import('@/stores/authStore').then(m => m.useAuthStore.persist.rehydrate()).catch(() => {})
    } else if (error.response?.status === 401 && hadToken) {
      localStorage.removeItem('wms-auth')
      // Dọn cache + hàng đợi quét khỏi IndexedDB khi phiên hết hạn (máy dùng chung).
      // import động để tránh phụ thuộc vòng ở tầng client thấp.
      import('@/offline/persist').then(m => m.clearOfflineData()).catch(() => {})
      // 19/11: phiên bị đá vì mật khẩu vừa đổi ⇒ trang đăng nhập nói rõ lý do (không thì người dùng tưởng app lỗi)
      const code = (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code
      window.location.href = code === 'PASSWORD_CHANGED' ? '/login?reason=password_changed' : '/login'
    }
    return Promise.reject(error)
  }
)
