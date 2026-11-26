import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AxiosError } from 'axios'
import { replaceEqualDeep } from '@tanstack/react-query'
import { apiClient, rejectedStaleToken } from '@/api/client'
import { clearOfflineData } from '@/offline/persist'
import { setRealtimeAuth } from '@/lib/supabase'
import { disconnectRealtimeEvents } from '@/api/realtimeEvents'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  token: string | null
  realtimeToken: string | null   // vé Supabase Realtime (role authenticated) cho RLS đóng-hẳn
  login: (email: string, password: string) => Promise<void>
  /** Nhận phiên server vừa phát (đăng nhập · tự đổi mật khẩu — 19/11: đổi mật khẩu làm phiên cũ hết hiệu lực, phiên đang dùng nhận token mới) */
  applySession: (s: { token: string; user: User; realtime_token: string | null }) => void
  logout: () => void
  updateUser: (partial: Partial<User>) => void
  refreshUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      token: null,
      realtimeToken: null,

      login: async (email: string, password: string) => {
        const res = await apiClient.post('/auth/login', { email, password })
        useAuthStore.getState().applySession(res.data.data as { token: string; user: User; realtime_token: string | null })
      },

      applySession: ({ token, user, realtime_token }) => {
        set({ user, isAuthenticated: true, token, realtimeToken: realtime_token ?? null })
        setRealtimeAuth(realtime_token ?? null)
      },

      logout: () => {
        set({ user: null, isAuthenticated: false, token: null, realtimeToken: null })
        disconnectRealtimeEvents() // đóng 2 kênh Broadcast riêng tư (kênh cá nhân gắn với người vừa thoát)
        setRealtimeAuth(null)      // trả kết nối realtime về anon
        void clearOfflineData()   // dọn cache + hàng đợi quét khỏi IndexedDB (máy dùng chung)
        try { sessionStorage.removeItem('wms-landing-done') } catch { /* không đọc được bộ nhớ phiên — lần sau coi như đã chuyển */ }   // người kế tiếp vẫn vào trang mở đầu của chức danh mình
      },

      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),

      refreshUser: async () => {
        try {
          const res = await apiClient.get('/auth/me')
          const { user, token, realtime_token } = res.data.data as { user: User; token: string; realtime_token: string | null }
          // GIỮ NGUYÊN tham chiếu phần không đổi (C139): /me chạy mỗi 5' + mỗi lần quay lại cửa sổ — trả object MỚI dù
          // nội dung y hệt ⇒ mọi effect / memo phụ thuộc `user.warehouse_ids`… chạy lại; form Tạo phiếu nhập từng tự xoá
          // về tab đầu + mất mọi dòng đang khai. replaceEqualDeep trả lại object cũ khi bằng nhau, chỉ thay nhánh thật sự đổi.
          set({ user: replaceEqualDeep(get().user, user), token, realtimeToken: realtime_token ?? null })
          setRealtimeAuth(realtime_token ?? null)   // tái cấp vé realtime (định kỳ 5' qua Shell)
        } catch (err) {
          // CHỈ đăng xuất khi token thực sự hết hạn/sai (401). Lỗi TẠM THỜI
          // (cold-start timeout, mất mạng, 5xx, DB bận lúc đông) KHÔNG được xóa
          // phiên — giữ user/token đã persist để user vẫn dùng được, lần load
          // sau tự refresh lại. Trước đây catch-all xóa sạch → refresh là "văng".
          if ((err as AxiosError)?.response?.status === 401) {
            // token gửi đi đã cũ hơn token đang lưu (tab khác cùng trình duyệt vừa nhận token mới) ⇒ nhận lại phiên, KHÔNG xoá (19/11)
            if (rejectedStaleToken((err as AxiosError).config as { headers?: Record<string, unknown> } | undefined)) { await useAuthStore.persist.rehydrate(); return }
            set({ user: null, isAuthenticated: false, token: null })
          }
        }
      },
    }),
    { name: 'wms-auth' }
  )
)
