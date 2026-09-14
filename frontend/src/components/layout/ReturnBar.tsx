// Thanh "‹ Về <nơi vừa rời>" — hiện dưới Header ở MỌI trang khi có điểm neo (xem lib/returnTo.ts).
// Một chỗ cho mọi trang đích, kể cả trang danh sách không có mũi tên quay lại. Về đúng nơi neo thì
// tự tắt; đi bằng menu cũng tắt (Sidebar/BottomNav/MobileNav gọi clearReturnTo).
import { useEffect, useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { clearReturnTo, getReturnToRaw, subscribeReturnTo, type ReturnTo } from '@/lib/returnTo'

export function ReturnBar() {
  const raw = useSyncExternalStore(subscribeReturnTo, getReturnToRaw, () => null)
  const location = useLocation()
  const rt: ReturnTo | null = raw ? (JSON.parse(raw) as ReturnTo) : null
  const toPath = rt ? rt.to.split('?')[0] : null
  const atHome = !!toPath && location.pathname === toPath
  // Đã về tới nơi neo ⇒ tắt (trong effect, không setState lúc render)
  useEffect(() => { if (atHome) clearReturnTo() }, [atHome])
  if (!rt || atHome) return null
  return (
    <div className="shrink-0 border-b border-sky-200 bg-sky-50">
      <Link to={rt.to} onClick={clearReturnTo}
        className="flex h-9 sm:h-8 items-center gap-1 px-3 text-[12px] font-medium text-sky-800 hover:bg-sky-100 active:bg-sky-200">
        <ChevronLeft className="h-4 w-4" /> Về {rt.label}
      </Link>
    </div>
  )
}
