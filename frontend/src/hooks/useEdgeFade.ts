// MÉP MỜ CHO HÀNG CUỘN NGANG (14/10) — cùng khuôn dải tab `TabsList` (12/09: "cuộn được mà KHÔNG AI BIẾT thì cũng như không"):
// mép nào còn nội dung khuất thì mờ dần; không tràn thì không mờ gì. Kèm lăn chuột DỌC = cuộn ngang (chuột thường không có lăn ngang,
// hàng ẩn thanh cuộn thì người dùng máy tính không có cách nào khác để kéo). Dùng cho hàng MỘT DÒNG cố định trên máy tính
// (luật 14/10: bố cục giống nhau ở mọi cỡ màn ≥ 1280 — chật thì co / cuộn, không xuống dòng).
//   const fade = useEdgeFade(dep)   →   <div ref={fade.ref} style={fade.style} onWheel={fade.onWheel} className="overflow-x-auto no-scrollbar">
// `dep`: đổi khi NỘI DUNG đổi bề rộng mà khung thì không (khung flex-1 ⇒ ResizeObserver không thấy).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type WheelEvent } from 'react'

export function useEdgeFade(dep?: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState<'none' | 'left' | 'right' | 'both'>('none')
  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return
    const hidden = el.scrollWidth - el.clientWidth
    if (hidden <= 2) { setEdge('none'); return }
    const l = el.scrollLeft > 2, r = el.scrollLeft < hidden - 2
    setEdge(l && r ? 'both' : l ? 'left' : 'right')
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    el.addEventListener('scroll', sync, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', sync) }
  }, [sync])
  useEffect(sync, [dep, sync])
  const mask = edge === 'none' ? null
    : edge === 'both' ? 'linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)'
    : edge === 'left' ? 'linear-gradient(to right, transparent 0, #000 24px)'
    : 'linear-gradient(to right, #000 calc(100% - 24px), transparent 100%)'
  const style: CSSProperties | undefined = mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined
  const onWheel = useCallback((e: WheelEvent<HTMLElement>) => {
    const el = e.currentTarget
    if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY
  }, [])
  return { ref, style, onWheel }
}
