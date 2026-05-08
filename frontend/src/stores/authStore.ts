import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  token: string | null
  login: (user: User, token: string) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: {
        id: '1',
        name: 'Nguyễn Văn Quản Lý',
        email: 'admin@wms.vn',
        role: 'WAREHOUSE_MANAGER',
        department: 'Kho vận',
        warehouse_name: 'Kho Ba Vì',
      },
      isAuthenticated: true,
      token: 'mock-jwt-token',
      login: (user, token) => set({ user, isAuthenticated: true, token }),
      logout: () => set({ user: null, isAuthenticated: false, token: null }),
      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),
    }),
    { name: 'wms-auth' }
  )
)
