// Dòng ghi công tác giả — MỘT nguồn chữ cho mọi chỗ hiển thị (màn đăng nhập, sidebar, drawer
// mobile). Sửa tên/email ở đây là đổi hết; chép chữ ra từng file thì sớm muộn cũng lệch nhau.
//
// Chữ CHẠY (gõ từng ký tự rồi lặp lại) theo yêu cầu user 27/08 "cho nó chạy kiểu này được k, thì
// sẽ dễ nhìn và chú ý hơn". Ba điều bắt buộc kèm theo, nếu không thì hiệu ứng gây hại:
//   · KHÔNG để layout nhảy khi chữ dài ra → in sẵn một bản ĐẦY ĐỦ trong suốt làm khuôn, bản đang
//     gõ nằm đè lên;
//   · ĐỨNG YÊN khi người dùng rê chuột/chạm vào — đang định bấm email mà chữ chạy mất là ức chế;
//   · máy đang bật "giảm chuyển động" (prefers-reduced-motion) thì hiện thẳng chữ đủ, không gõ.
import { useEffect, useRef, useState } from 'react'

export const DEV_CREDIT = {
  name: 'Trần Hoàng Lãm',
  email: 'lam.tranhoang@mal.com.vn',
}
const HEAD = `Sản phẩm được phát triển bởi ${DEV_CREDIT.name}`
const MID = ' · Vui lòng liên hệ để hợp tác: '
const FULL = HEAD + MID + DEV_CREDIT.email

const TYPE_MS = 38        // tốc độ gõ 1 ký tự
const HOLD_MS = 10000     // gõ xong ĐỨNG YÊN 10s để người ta kịp đọc / bôi đen copy email (user chốt)
const START_MS = 600      // trễ đầu tiên cho trang kịp hiện

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
}

/** `tone='dark'` cho nền tối (sidebar/drawer), `'light'` cho nền sáng (màn đăng nhập). */
export function DevCredit({ tone = 'light', className = '' }: { tone?: 'light' | 'dark'; className?: string }) {
  const reduce = usePrefersReducedMotion()
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)       // đang rê chuột/chạm → dừng gõ
  const [selecting, setSelecting] = useState(false)
  const [n, setN] = useState(0)                   // số ký tự đã gõ ra
  const hold = hover || selecting

  // Đang BÔI ĐEN chữ này thì tuyệt đối không gõ lại — kéo chuột ra ngoài khối là chuyện thường khi
  // copy, chỉ bám `hover` sẽ chạy tiếp và xoá mất vùng vừa chọn.
  useEffect(() => {
    const on = () => {
      const s = document.getSelection()
      setSelecting(!!s && !s.isCollapsed && !!s.anchorNode && !!box.current?.contains(s.anchorNode))
    }
    document.addEventListener('selectionchange', on)
    return () => document.removeEventListener('selectionchange', on)
  }, [])

  useEffect(() => {
    if (reduce || hold) { setN(FULL.length); return }
    let i = 0
    let timer = window.setTimeout(function tick() {
      i = i >= FULL.length ? 0 : i + 1
      setN(i)
      timer = window.setTimeout(tick, i >= FULL.length ? HOLD_MS : i === 0 ? START_MS : TYPE_MS)
    }, START_MS)
    return () => window.clearTimeout(timer)
  }, [reduce, hold])

  const done = n >= FULL.length
  const typed = FULL.slice(0, n)
  const base = tone === 'dark' ? 'text-slate-400' : 'text-muted-foreground'
  const link = tone === 'dark' ? 'text-sky-400' : 'text-sky-600'
  // Cỡ chữ theo chỗ đặt: sidebar/drawer hẹp → 10px; màn đăng nhập → 12px, CÙNG cỡ với dòng
  // "Tài khoản do quản trị viên cấp" ngay trên nó (user 02/09: 2 dòng cạnh nhau mà 2 cỡ, nhìn như 2 font)
  const p = `text-center leading-relaxed ${tone === 'dark' ? 'text-[10px]' : 'text-xs'}`

  return (
    <div
      ref={box}
      className={`relative ${base} ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onTouchStart={() => setHover(true)}
    >
      {/* khuôn giữ chỗ: cùng chữ, cùng class ⇒ khối không co giãn khi đang gõ */}
      <p className={`${p} invisible`} aria-hidden>{FULL}</p>
      <p className={`${p} absolute inset-0 break-words`}>
        {done ? (
          <>
            {HEAD}{MID}
            {/* break-words chứ KHÔNG break-all: cột sidebar hẹp, break-all cắt email thành
                "lam.tranhoang@m / al.com.vn" — đọc/copy đều khó */}
            <a href={`mailto:${DEV_CREDIT.email}`} className={`${link} underline underline-offset-2 break-words`}>
              {DEV_CREDIT.email}
            </a>
          </>
        ) : (
          <span aria-hidden>
            {typed}
            <span className="animate-pulse">|</span>
          </span>
        )}
      </p>
    </div>
  )
}
