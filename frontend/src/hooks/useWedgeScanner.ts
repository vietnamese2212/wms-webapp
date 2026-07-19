// Súng quét PDA / máy quét Bluetooth (keyboard-wedge HID) — user 19/07: BỔ SUNG cạnh camera,
// KHÔNG thay đổi flow quét camera. Nguyên lý: súng "gõ" chuỗi ký tự rất nhanh (~10–30ms/ký tự)
// rồi kết thúc bằng Enter/Tab → gom buffer theo nhịp phím, chuỗi đủ dài + bắn nhanh = 1 lượt quét.
//
// Chống DOUBLE-READ (súng nhận diện đúp / bóp cò dính 2 phát): cùng một mã trong DEDUPE_MS
// chỉ nhận 1 lượt — lượt sau bỏ qua im lặng. Mã KHÁC nhau thì nhận bình thường.
//
// Chống nhiễu gõ tay: ký tự cách nhau > GAP_MS coi là người gõ → reset buffer.
// Bắn khi đang focus Ô NHẬP (vd ô Số thùng): chuỗi súng bị trình duyệt gõ thẳng vào ô →
// hook TRẢ LẠI giá trị ô như trước lượt bắn (native setter + event input để React đồng bộ)
// rồi vẫn xử lý lượt quét — số lượng không bao giờ bị chuỗi tem phá hỏng.
import { useEffect, useRef } from 'react'

const GAP_MS    = 100   // nhịp giữa 2 ký tự của súng (người gõ nhanh nhất cũng ~150ms+)
const DEDUPE_MS = 1500  // double-read: cùng mã trong 1.5s chỉ tính 1
const MIN_LEN   = 6     // tem pallet ngắn nhất cũng dài hơn mốc này

function isEditable(t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

// Trả lại giá trị ô nhập như TRƯỚC lượt bắn — dùng native setter để React (controlled input) nhận đổi
function restoreInput(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }
}

export function useWedgeScanner(onScan: (code: string) => void, enabled: boolean) {
  const cb = useRef(onScan)
  cb.current = onScan

  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let lastKeyAt = 0
    let lastCode = ''
    let lastCodeAt = 0
    // Ô nhập đang focus lúc BẮT ĐẦU lượt bắn + giá trị gốc của nó (để trả lại khi commit)
    let inputSnap: { el: HTMLInputElement | HTMLTextAreaElement; value: string } | null = null

    function onKey(e: KeyboardEvent) {
      const now = Date.now()
      const typing = isEditable(e.target)

      if (e.key === 'Enter' || e.key === 'Tab') {
        const isBurst = buf.length >= MIN_LEN && now - lastKeyAt <= GAP_MS
        const code = buf
        const snap = inputSnap
        buf = ''
        inputSnap = null
        if (!isBurst) return
        // Súng bắn khi đang focus ô nhập → dọn chuỗi tem đã lọt vào ô (trả về giá trị cũ)
        if (typing) {
          if (snap && snap.el === e.target) restoreInput(snap.el, snap.value)
          else return   // burst trong ô khác nguồn theo dõi — không chắc chắn, bỏ qua cho an toàn
        }
        e.preventDefault()
        e.stopPropagation()
        if (code === lastCode && now - lastCodeAt < DEDUPE_MS) return   // double-read → nuốt
        lastCode = code
        lastCodeAt = now
        cb.current(code)
        return
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
      if (now - lastKeyAt > GAP_MS) { buf = ''; inputSnap = null }   // nhịp chậm = người gõ → làm lại
      if (buf === '' && typing) inputSnap = { el: e.target as HTMLInputElement, value: (e.target as HTMLInputElement).value }
      buf += e.key
      lastKeyAt = now
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
}
