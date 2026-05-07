import axios from 'axios'

// Dev: Vite proxy chuyển /api → localhost:4000
// Prod: VITE_API_URL trỏ đến Railway backend (VD: https://wms-backend.railway.app)
export const apiClient = axios.create({
  baseURL: (import.meta.env.VITE_API_URL ?? '') + '/api',
  timeout: 10000,
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
    if (error.response?.status === 401) {
      localStorage.removeItem('wms-auth')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
