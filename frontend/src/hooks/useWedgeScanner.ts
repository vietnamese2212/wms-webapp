// Súng quét PDA / máy quét Bluetooth (keyboard-wedge HID) — user 19/07: BỔ SUNG cạnh camera,
// KHÔNG thay đổi flow quét camera. Nguyên lý: súng "gõ" chuỗi ký tự rất nhanh (~10–30ms/ký tự)
// rồi kết thúc bằng Enter/Tab → gom buffer theo nhịp phím, chuỗi đủ dài + bắn nhanh = 1 lượt quét.
//
// Chống DOUBLE-READ (súng nhận diện đúp / bóp cò dính 2 phát): cùng một mã trong DEDUPE_MS
// chỉ nhận 1 lượt — lượt sau bỏ qua im lặng. Mã KHÁC nhau thì nhận bình thường.
//
// Chống nhiễu gõ tay: ký tự cách nhau > GAP_MS coi là người gõ → reset buffer; đang focus
// trong input/textarea (người đang nhập số) thì KHÔNG bắt (tránh nuốt Enter của form).
import { useEffect, useRef } from 'react'

const GAP_MS    = 100   // nhịp giữa 2 ký tự của súng (người gõ nhanh nhất cũng ~150ms+)
const DEDUPE_MS = 1500  // double-read: cùng mã trong 1.5s chỉ tính 1
const MIN_LEN   = 6     // tem pallet ngắn nhất cũng dài hơn mốc này

export function useWedgeScanner(onScan: (code: string) => void, enabled: boolean) {
  const cb = useRef(onScan)
  cb.current = onScan

  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let lastKeyAt = 0
    let lastCode = ''
    let lastCodeAt = 0

    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      const now = Date.now()

      if (e.key === 'Enter' || e.key === 'Tab') {
        const isBurst = buf.length >= MIN_LEN && now - lastKeyAt <= GAP_MS
        const code = buf
        buf = ''
        if (!isBurst || typing) return
        e.preventDefault()
        e.stopPropagation()
        if (code === lastCode && now - lastCodeAt < DEDUPE_MS) return   // double-read → nuốt
        lastCode = code
        lastCodeAt = now
        cb.current(code)
        return
      }
      if (typing) return
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
      if (now - lastKeyAt > GAP_MS) buf = ''   // nhịp chậm = người gõ → làm lại từ đầu
      buf += e.key
      lastKeyAt = now
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
}
