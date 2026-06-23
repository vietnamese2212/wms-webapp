import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AxiosError } from 'axios'
import { apiClient } from '@/api/client'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  token: string | null
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

      login: async (email: string, password: string) => {
        const res = await apiClient.post('/auth/login', { email, password })
        const { token, user } = res.data.data as { token: string; user: User }
        set({ user, isAuthenticated: true, token })
      },

      logout: () => set({ user: null, isAuthenticated: false, token: null }),

      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),

      refreshUser: async () => {
        try {
          const res = await apiClient.get('/auth/me')
          const { user, token } = res.data.data as { user: User; token: string }
          set({ user, token })
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
