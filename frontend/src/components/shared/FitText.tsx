// FitText — một dòng chữ LUÔN HIỆN ĐỦ, không bao giờ cắt "…".
// User 27/11 (thẻ bồn Sơ đồ 2D "800/10.00…", "đặt BTP-SCCD…"): "ko chấp nhận dạng ...".
// Vừa bề ngang ⇒ giữ cỡ `size`; dài hơn ⇒ co cỡ chữ cho vừa (không nhỏ hơn `min`);
// co tới `min` vẫn dài ⇒ xuống dòng (ngắt được cả giữa một mã dài). Đo bằng chính DOM
// sau mỗi lần vẽ, trước khi trình duyệt sơn ⇒ không nháy. Đo theo bề rộng bố cục
// (clientWidth / scrollWidth) nên đúng cả khi nằm trong khung đang thu phóng bằng transform.
// Con bên trong muốn co theo thì để cỡ chữ tương đối (em), đừng đặt px.
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'

export function fitFontSize(size: number, min: number, have: number, need: number): { size: number; wrap: boolean } {
  if (!(have > 0) || need <= have) return { size, wrap: false }
  const f = Math.floor(size * have / need * 10) / 10
  return f >= min ? { size: f, wrap: false } : { size: min, wrap: true }
}

export function FitText({ size, min, className = '', style, title, children, testId }: {
  /** cỡ chữ chuẩn (px) */
  size: number
  /** cỡ nhỏ nhất được co tới (px) — mặc định 70% cỡ chuẩn */
  min?: number
  className?: string
  style?: CSSProperties
  title?: string
  children: ReactNode
  testId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const floor = min ?? Math.round(size * 0.7 * 10) / 10
  const fitRef = useRef<() => void>(() => {})
  fitRef.current = () => {
    const el = ref.current
    if (!el) return
    el.style.whiteSpace = 'nowrap'
    el.style.overflowWrap = ''
    el.style.fontSize = `${size}px`
    let r = fitFontSize(size, floor, el.clientWidth, el.scrollWidth)
    // chữ có phần cỡ cố định (biểu tượng, khoảng cách) thì co một lần chưa vừa ⇒ co thêm vài lượt
    for (let i = 0; i < 4 && !r.wrap && r.size < size; i++) {
      el.style.fontSize = `${r.size}px`
      if (el.scrollWidth <= el.clientWidth) break
      r = fitFontSize(r.size, floor, el.clientWidth, el.scrollWidth)
    }
    el.style.fontSize = `${r.size}px`
    if (r.wrap) {
      // xuống dòng: lấy số dòng khi ở cỡ sàn làm chuẩn, rồi chọn cỡ LỚN NHẤT vẫn gói trong chừng ấy dòng
      // (đừng để chữ bé hết cỡ khi to hơn mà vẫn cùng số dòng)
      el.style.whiteSpace = 'normal'; el.style.overflowWrap = 'anywhere'
      const lines = () => { const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(el.style.fontSize) * 1.2; return Math.round(el.offsetHeight / lh) }
      const want = lines()
      for (let k = 0; k <= 6; k++) {
        const f = Math.round((size - (size - floor) * k / 6) * 10) / 10
        el.style.fontSize = `${f}px`
        if (lines() <= want && el.scrollWidth <= el.clientWidth) { r = { size: f, wrap: true }; break }
      }
      el.style.fontSize = `${r.size}px`
    }
    el.dataset.fit = r.wrap ? 'wrap' : r.size < size ? 'shrink' : ''
  }
  useLayoutEffect(() => { fitRef.current() })
  // phông chữ web nạp xong sau lần vẽ đầu thì bề rộng chữ đổi ⇒ đo lại một lần
  useLayoutEffect(() => {
    let live = true
    document.fonts?.ready.then(() => { if (live) fitRef.current() }).catch(() => {})
    return () => { live = false }
  }, [])
  return (
    <div ref={ref} className={`min-w-0 ${className}`} style={style} title={title} data-testid={testId} data-fittext="">
      {children}
    </div>
  )
}
