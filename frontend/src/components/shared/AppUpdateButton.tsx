import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { APP_BUILD_SHA, hasNewVersion, forceUpdateApp, isLocalBuild, clearDeepUpdateFlag } from '@/lib/appUpdate'

/**
 * Nút "lấy bản mới nhất" — đứng CẠNH CHUÔNG trên thanh trên cùng (user chốt 30/07).
 *
 * Vì sao cần: app là PWA, service worker giữ bản đã tải để mở được khi mất mạng ⇒ deploy mới
 * thì TAB ĐANG MỞ vẫn chạy bản cũ cho tới khi tải lại. Sự cố 30/07: giao diện cũ (chưa có ô
 * chọn vị trí hàng dư) gặp backend mới (đã đòi) → người quét bị kẹt, không tự biết vì sao.
 * Nay app TỰ SO phiên bản với server; điện thoại cũng không có Ctrl+Shift+R nên phải có nút.
 *
 * Hành vi: LUÔN bấm được (ép tải bản mới bất cứ lúc nào). Khi phát hiện có bản mới thì nút
 * đổi sang màu nổi + chấm báo, để người dùng thấy mà không cần ai nhắc.
 * KHÔNG tự tải lại: đang giữa ca quét mà app tự reload là mất thao tác đang làm.
 */
// Hook dò bản mới — dùng chung cho nút header VÀ banner tự bật (12/08: user 3 lần liền
// test trên bản cũ mà không biết — icon nhỏ trên header không đủ đập vào mắt công nhân)
function useAppOutdated(): boolean {
  const [outdated, setOutdated] = useState(false)
  useEffect(() => {
    if (isLocalBuild()) return
    let alive = true
    const check = async () => {
      if (!alive || document.hidden) return
      const stale = await hasNewVersion()
      // Đã đúng bản mới ⇒ lần bấm tới lại bắt đầu từ đường nhanh (xem forceUpdateApp)
      if (!stale) clearDeepUpdateFlag()
      if (alive) setOutdated(stale)
    }
    void check()
    const timer = setInterval(check, 10 * 60_000)          // đang mở app suốt ca vẫn biết có bản mới
    const onFocus = () => void check()                      // đi kho về mở lại máy → kiểm ngay
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [])
  return outdated
}

// Banner TỰ BẬT khi có bản mới — nổi trên mọi trang, không chờ ai để ý icon.
// Đóng được (X) cho ca đang dở tay; KHÔNG tự reload (mất thao tác đang làm).
export function AppUpdateBanner() {
  const outdated = useAppOutdated()
  const [updating, setUpdating] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  if (!outdated || dismissed) return null
  return (
    <div className="fixed bottom-20 lg:bottom-4 left-1/2 -translate-x-1/2 z-[55] flex items-center gap-2 rounded-full bg-sky-600 text-white shadow-lg pl-4 pr-1.5 py-1.5 text-xs font-medium">
      <span>Đã có bản mới của ứng dụng</span>
      <button type="button" disabled={updating}
        onClick={() => { setUpdating(true); void forceUpdateApp() }}
        className="rounded-full bg-white text-sky-700 font-semibold px-3 py-1 hover:bg-sky-50 disabled:opacity-70 inline-flex items-center gap-1">
        <RefreshCw className={`h-3.5 w-3.5 ${updating ? 'animate-spin' : ''}`} />
        {updating ? 'Đang tải…' : 'Cập nhật ngay'}
      </button>
      <button type="button" aria-label="Để sau" onClick={() => setDismissed(true)}
        className="p-1 rounded-full hover:bg-white/15">✕</button>
    </div>
  )
}

export function AppUpdateButton() {
  const outdated = useAppOutdated()
  const [updating, setUpdating] = useState(false)

  const run = async () => { setUpdating(true); await forceUpdateApp() }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost" size="icon" onClick={run} disabled={updating}
          aria-label="Cập nhật ứng dụng"
          className={`relative ${outdated
            ? 'text-white bg-sky-600 hover:bg-sky-500'
            : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
        >
          <RefreshCw className={`h-5 w-5 ${updating ? 'animate-spin' : ''}`} />
          {outdated && !updating && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {updating
          ? 'Đang tải bản mới…'
          : outdated
            ? 'ĐÃ CÓ BẢN MỚI — bấm để cập nhật ngay'
            : `Đang dùng bản mới nhất (${APP_BUILD_SHA}) — bấm để tải lại`}
      </TooltipContent>
    </Tooltip>
  )
}
