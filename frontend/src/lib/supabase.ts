import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabaseClient = url && anonKey
  ? createClient(url, anonKey)
  : null

// Gắn "vé realtime" (JWT role=authenticated do backend cấp) cho kết nối Realtime → dưới
// RLS đóng-hẳn, chỉ client đã đăng nhập nhận được dữ liệu; khách vãng lai (anon) bị chặn.
// token null (backend chưa cấu hình SUPABASE_JWT_SECRET) → dùng anon key mặc định (hành
// vi cũ, không vỡ gì trước khi bật RLS).
export function setRealtimeAuth(token: string | null): void {
  if (!supabaseClient) return
  supabaseClient.realtime.setAuth(token ?? anonKey)
}
