// Bấm cò lượt BẢO TRÌ DỮ LIỆU (20/10): lưu trữ sổ lớn quá hạn ra Storage + gỡ bản chép SAP quá hạn theo cờ retention_days (Cài đặt WMS ›
// Hệ thống). Việc nền không ké GET của người xem ⇒ Header (luôn mount) gọi 30 s sau khi app hiện, tối đa 1 lần/giờ mỗi trình duyệt;
// máy chủ còn giãn 30 phút giữa hai lượt + ổ khoá chống chạy chồng. Chỉ người có quyền chạy (quản trị hệ thống / xác nhận điều vận).
import { useEffect, useRef } from 'react'
import { useRunDataArchive } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const KEY = 'wms_data_archive_tick'
const EVERY_MS = 3_600_000

export function DataArchiveTick() {
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const allowed = can(perms, 'wms_settings', 'manage_system') || can(perms, 'dispatch', 'confirm')
  const run = useRunDataArchive()
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!allowed) return
    const fire = () => {
      let last = 0
      try { last = Number(localStorage.getItem(KEY) ?? 0) } catch { /* trình duyệt chặn bộ nhớ — vẫn chạy, máy chủ tự giãn */ }
      if (Date.now() - last < EVERY_MS) return
      try { localStorage.setItem(KEY, String(Date.now())) } catch { /* như trên */ }
      runRef.current.mutate()
    }
    const t0 = setTimeout(fire, 30_000)
    const t = setInterval(fire, EVERY_MS)
    return () => { clearTimeout(t0); clearInterval(t) }
  }, [allowed])
  return null
}
