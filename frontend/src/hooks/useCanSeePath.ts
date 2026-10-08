import { useAuthStore } from '@/stores/authStore'
import { canSeePath } from '@/config/navigation'
import { isAdmin, type ModulePermissions } from '@/config/permissions'

/** Lối tắt tới trang module (Thao tác nhanh, "Mở chuyến", "Khách hàng →"…) chỉ hiện khi người xem mở được trang đích — CÙNG luật
 *  với menu (08/10, C66). Trang có id (`/wms/outbound/:id`) thì hỏi đường dẫn gốc của trang (`/wms/outbound`). */
export function useCanSeePath() {
  const user = useAuthStore(s => s.user)
  return (to: string) => canSeePath(to, user?.module_permissions as ModulePermissions | null ?? null, isAdmin(user))
}
