import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AxiosError } from 'axios'
import { apiClient } from '@/api/client'
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
  logout: () => void
  updateUser: (partial: Partial<User>) => void
  refreshUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      token: null,
      realtimeToken: null,

      login: async (email: string, password: string) => {
        const res = await apiClient.post('/auth/login', { email, password })
        const { token, user, realtime_token } = res.data.data as { token: string; user: User; realtime_token: string | null }
        set({ user, isAuthenticated: true, token, realtimeToken: realtime_token ?? null })
        setRealtimeAuth(realtime_token ?? null)
      },

      logout: () => {
        set({ user: null, isAuthenticated: false, token: null, realtimeToken: null })
        disconnectRealtimeEvents() // đóng 2 kênh Broadcast riêng tư (kênh cá nhân gắn với người vừa thoát)
        setRealtimeAuth(null)      // trả kết nối realtime về anon
        void clearOfflineData()   // dọn cache + hàng đợi quét khỏi IndexedDB (máy dùng chung)
      },

      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),

      refreshUser: async () => {
        try {
          const res = await apiClient.get('/auth/me')
          const { user, token, realtime_token } = res.data.data as { user: User; token: string; realtime_token: string | null }
          set({ user, token, realtimeToken: realtime_token ?? null })
          setRealtimeAuth(realtime_token ?? null)   // tái cấp vé realtime (định kỳ 5' qua Shell)
        } catch (err) {
          // CHỈ đăng xuất khi token thực sự hết hạn/sai (401). Lỗi TẠM THỜI
          // (cold-start timeout, mất mạng, 5xx, DB bận lúc đông) KHÔNG được xóa
          // phiên — giữ user/token đã persist để user vẫn dùng được, lần load
          // sau tự refresh lại. Trước đây catch-all xóa sạch → refresh là "văng".
          if ((err as AxiosError)?.response?.status === 401) {
            set({ user: null, isAuthenticated: false, token: null })
          }
        }
      },
    }),
    { name: 'wms-auth' }
  )
)
