// Súng quét PDA / máy quét Bluetooth (keyboard-wedge HID) — user 19/07: BỔ SUNG cạnh camera,
// KHÔNG thay đổi flow quét camera. Nguyên lý: súng "gõ" chuỗi ký tự rất nhanh (~10–30ms/ký tự).
//
// CHỐT LƯỢT theo 2 cách (dù DataWedge cấu hình kiểu nào cũng ăn):
//   1) Enter/Tab là PHÍM THẬT → chốt ngay.
//   2) IDLE — hết chuỗi bắn im lặng > IDLE_MS mà không có Enter thật → tự chốt.
//      Cần vì Zebra TC27 có thể gửi Enter "as string"/IME (không phải keydown 'Enter') → cách 1 không bao giờ kích hoạt.
//
// Chống DOUBLE-READ (súng nhận diện đúp / cò dính 2 phát): cùng một mã trong DEDUPE_MS chỉ nhận 1 lượt.
// Chống nhiễu gõ tay: ký tự cách nhau > GAP_MS coi là người gõ → reset buffer.
// Bắn khi đang focus Ô NHẬP (vd ô Số thùng): chuỗi súng lọt vào ô → hook TRẢ LẠI giá trị ô như trước lượt bắn
//   (native setter + event input để React đồng bộ) rồi vẫn xử lý lượt quét — số lượng không bị chuỗi tem phá hỏng.
import { useEffect, useRef } from 'react'

const GAP_MS    = 120   // nhịp giữa 2 ký tự của súng (người gõ nhanh nhất cũng ~150ms+)
const IDLE_MS   = 90    // hết chuỗi bắn không có Enter thật > mốc này → tự chốt lượt
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

// ĐỘC QUYỀN PHÁT BẮN — mỗi lần gọi hook là MỘT listener trên window, nên 2 hook cùng bật thì cùng
// một phát súng chạy CẢ HAI việc (21/08: màn quét tem VỊ TRÍ sống cạnh cò súng tra tem PALLET —
// nếu cả hai ăn thì pallet vừa nhảy ô vừa bị tra lại, không ai thấy sai ở đâu).
// Instance khai `exclusive` (overlay quét tem vị trí đang mở) giành quyền: khi còn ≥1 instance như
// vậy, các instance thường NUỐT lượt bắn. Khoá nằm ở ĐÂY, không bắt từng màn tự nhớ nhường —
// luật văn xuôi thì màn thứ 14 sẽ quên.
let exclusiveCount = 0

export function useWedgeScanner(
  onScan: (code: string) => void,
  enabled: boolean,
  opts?: { exclusive?: boolean },
) {
  const cb = useRef(onScan)
  cb.current = onScan
  const exclusive = !!opts?.exclusive

  useEffect(() => {
    if (!enabled || !exclusive) return
    exclusiveCount++
    return () => { exclusiveCount-- }
  }, [enabled, exclusive])

  useEffect(() => {
    if (!enabled) return
    let buf = ''
    let lastKeyAt = 0
    let lastCode = ''
    let lastCodeAt = 0
    // Ô nhập đang focus lúc BẮT ĐẦU lượt bắn + giá trị gốc của nó (để trả lại khi commit)
    let inputSnap: { el: HTMLInputElement | HTMLTextAreaElement; value: string } | null = null
    let idleTimer = 0

    function reset() {
      buf = ''
      inputSnap = null
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0 }
    }

    // Chốt 1 lượt bắn. target = phần tử của sự kiện Enter (nếu chốt qua phím thật); null = chốt qua idle.
    function commit(target: EventTarget | null) {
      const code = buf.replace(/[\r\n\t]+$/, '').trim()   // bỏ Enter/Tab thừa dính cuối
      const snap = inputSnap
      reset()
      if (code.length < MIN_LEN) return
      // Nếu chuỗi tem đã lọt vào ô nhập → trả ô về giá trị cũ (kể cả khi chốt qua idle, target = null).
      // Phải làm TRƯỚC cả bước nhường độc quyền: nhường việc xử lý thì vẫn phải dọn ô nhập, không
      // thì màn nhường lại là màn bị chuỗi tem nằm lại trong ô Số thùng.
      if (snap && (!target || snap.el === target)) restoreInput(snap.el, snap.value)
      if (!exclusive && exclusiveCount > 0) return         // đang có màn giữ độc quyền → nhường
      const now = Date.now()
      if (code === lastCode && now - lastCodeAt < DEDUPE_MS) return   // double-read → nuốt
      lastCode = code
      lastCodeAt = now
      cb.current(code)
    }

    function scheduleIdle() {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => { idleTimer = 0; commit(null) }, IDLE_MS)
    }

    function onKey(e: KeyboardEvent) {
      const now = Date.now()
      const typing = isEditable(e.target)

      // Enter/Tab là PHÍM THẬT → chốt ngay (nhanh hơn idle)
      if (e.key === 'Enter' || e.key === 'Tab') {
        const isBurst = buf.length >= MIN_LEN && now - lastKeyAt <= GAP_MS
        if (isBurst) {
          // Súng bắn khi đang focus ô nhập → chặn Enter khỏi submit form + xử lý lượt quét
          if (!typing || (inputSnap && inputSnap.el === e.target)) {
            e.preventDefault()
            e.stopPropagation()
            commit(e.target)
            return
          }
        }
        reset()
        return
      }

      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return   // bỏ phím điều khiển / IME 'Unidentified'
      if (now - lastKeyAt > GAP_MS) reset()                                  // nhịp chậm = người gõ → làm lại
      if (buf === '' && typing) inputSnap = { el: e.target as HTMLInputElement, value: (e.target as HTMLInputElement).value }
      buf += e.key
      lastKeyAt = now
      scheduleIdle()   // chốt bằng idle nếu không có Enter thật (Zebra gửi Enter kiểu string/IME)
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (idleTimer) clearTimeout(idleTimer)
    }
  }, [enabled])
}
