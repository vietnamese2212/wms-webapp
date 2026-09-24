// Đọc cờ `mobile_surface` (superadmin cấu hình module/tab hiện trên điện thoại — 21/09) và áp cho
// bottom-nav / drawer / dải tab từng trang. Chỉ có hiệu lực dưới `lg` (1024 px — cùng mốc Sidebar↔MobileNav);
// desktop không đổi gì. Đây là lớp AND thêm vào sau quyền: quyền quyết "được vào không", cờ quyết
// "trên điện thoại có bày ra không". Không chặn route.
import { useEffect, useMemo, useState } from 'react'
import { useSystemSettings } from '@/api/hooks'
import { parseMobileSurface, tabKey, MOBILE_SURFACE_DEFAULT, type MobileSurface } from '@/config/mobileSurface'

function useIsLg(): boolean {
  const [lg, setLg] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const fn = (e: MediaQueryListEvent) => setLg(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return lg
}

export function useMobileSurface(): { cfg: MobileSurface; isLg: boolean; isHidden: (key: string) => boolean } {
  const { data } = useSystemSettings()
  const raw = data?.find(s => s.key === 'mobile_surface')?.value
  const cfg = useMemo(() => (raw === undefined ? MOBILE_SURFACE_DEFAULT : parseMobileSurface(raw)), [raw])
  const hidden = useMemo(() => new Set(cfg.hidden), [cfg])
  const isLg = useIsLg()
  // Desktop: không ẩn gì (cờ chỉ nói về điện thoại)
  const isHidden = (key: string) => !isLg && hidden.has(key)
  return { cfg, isLg, isHidden }
}

/**
 * Lọc dải tab của MỘT trang theo cờ điện thoại. `tabs` truyền vào là danh sách ĐÃ lọc theo quyền.
 * Nếu tab đang đứng bị ẩn → tự nhảy về tab đầu còn hiện (gom 5 biến thể fallback rải ở các trang về một chỗ).
 * Không bao giờ trả rỗng: superadmin ẩn hết thì giữ nguyên danh sách (ẩn hết = cấu hình vô nghĩa, đừng làm trang trắng).
 */
export function useMobileTabs<T extends { key: string }>(
  to: string, tabs: readonly T[], current: string | null | undefined, setCurrent?: (key: T['key']) => void,
): T[] {
  const { isHidden } = useMobileSurface()
  const visible = useMemo(() => {
    const v = tabs.filter(t => !isHidden(tabKey(to, t.key)))
    return v.length ? v : [...tabs]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, to, isHidden])
  useEffect(() => {
    if (!setCurrent || !visible.length) return
    if (current != null && !visible.some(t => t.key === current)) setCurrent(visible[0].key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, current])
  return visible
}
