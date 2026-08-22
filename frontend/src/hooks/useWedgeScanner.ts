// Súng quét PDA / máy quét Bluetooth (keyboard-wedge HID) — user 19/07: BỔ SUNG cạnh camera,
// KHÔNG thay đổi flow quét camera. Nguyên lý: súng "gõ" chuỗi ký tự rất nhanh (~10–30ms/ký tự).
//
// ⚠️ MỘT MÁY ĐỌC DUY NHẤT cho cả app (đổi 22/08). Trước đó MỖI lần gọi hook là một listener +
// một bộ đệm + một bản chụp ô nhập RIÊNG. Hai màn cùng bật (trang Chuyển vị trí giữ cò tem pallet,
// nút quét tem vị trí giữ cò tem ô) là hai bộ cùng xử một phát bắn, và mỗi bộ "trả lại giá trị ô"
// theo bản chụp của MÌNH — bộ mount SAU chưa từng thấy ô lúc focus nên tưởng ô vốn rỗng và XOÁ
// TRẮNG mã pallet (user báo 22/08: "sau khi quét xong thì ô tem pallet bỏ trống"). Đây là lỗi thứ
// HAI cùng gốc (lỗi thứ nhất: 2 handler cùng ăn 1 phát bắn, vá tạm bằng bộ đếm exclusiveCount).
// ⇒ Nay: listener + bộ đệm + bản chụp nằm ở MODULE, hook chỉ ĐĂNG KÝ nhận mã. Thêm màn quét mới
// không đẻ thêm máy đọc.
//
// CHỐT LƯỢT theo 2 cách (dù DataWedge cấu hình kiểu nào cũng ăn):
//   1) Enter/Tab là PHÍM THẬT → chốt ngay.
//   2) IDLE — hết chuỗi bắn im lặng > IDLE_MS mà không có Enter thật → tự chốt.
//      Cần vì Zebra TC27 có thể gửi Enter "as string"/IME (không phải keydown 'Enter') → cách 1 không bao giờ kích hoạt.
//
// ĐỌC CHỮ theo 2 đường (22/08 — bẫy đã trả giá thật ở màn Chuyển vị trí):
//   a) `keydown` có ký tự in được — DataWedge bật "Send Characters as Events".
//   b) `input` (IME) — DataWedge TẮT tuỳ chọn đó thì Zebra chèn chữ kiểu bàn phím mềm: keydown ra
//      `key='Unidentified'` (keyCode 229) nên đường (a) KHÔNG thấy gì. Triệu chứng user báo: "bắn
//      súng phải bấm Enter mới ra kết quả" — chữ vẫn vào ô (Enter của form submit hộ) nhưng màn
//      quét coi như không có phát bắn nào; màn KHÔNG có ô nhập (overlay quét tem vị trí) thì chết
//      hẳn. Tái hiện được trên Preview bằng cách bắn keydown 229 + input event.
//      Chỉ dựa vào một checkbox trên TỪNG máy PDA là luật văn xuôi — nên app tự đọc luôn đường này.
//
// Chống DOUBLE-READ (súng nhận diện đúp / cò dính 2 phát): cùng một mã trong DEDUPE_MS chỉ nhận 1 lượt.
// Chống nhiễu gõ tay: ký tự cách nhau > GAP_MS coi là người gõ → reset buffer.
// Bắn khi đang focus Ô NHẬP (vd ô Số thùng): chuỗi súng lọt vào ô → máy đọc TRẢ LẠI giá trị ô như
//   trước lượt bắn (native setter + event input để React đồng bộ) rồi mới phát mã — số lượng/mã
//   pallet đang hiển thị không bị chuỗi tem phá hỏng.
import { useEffect, useRef } from 'react'

const GAP_MS    = 120   // nhịp giữa 2 ký tự của súng (người gõ nhanh nhất cũng ~150ms+)
const IDLE_MS   = 90    // hết chuỗi bắn không có Enter thật > mốc này → tự chốt lượt
const DEDUPE_MS = 1500  // double-read: cùng mã trong 1.5s chỉ tính 1
const MIN_LEN   = 6     // tem pallet ngắn nhất cũng dài hơn mốc này (mã vị trí ngắn nhất đang có: 7)

// Lượt đến từ đường IME phải CÓ ít nhất 1 ký tự không phải chữ cái (số, `_`, `;`, `.`, `-`).
// Bàn phím mềm Android chèn chữ CÙNG kiểu IME, và gợi ý từ có thể vào nguyên cụm trong 1 sự kiện —
// gợi ý tiếng Việt là chữ THUẦN nên bị loại ở đây, còn mã tem (pallet/vị trí) thì luôn có số hoặc
// dấu phân tách. Đường keydown KHÔNG bị luật này (giữ nguyên hành vi máy đang chạy được).
const IME_CODE_RE = /[^\p{L}]/u

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

// ─── Máy đọc (module-level, MỘT bộ cho cả app) ───────────────────────────────

type Sub = { fn: (code: string) => void; exclusive: boolean }
const subs = new Set<Sub>()

let buf = ''
let lastCharAt = 0        // ký tự cuối của lượt bắn (keydown hay IME) — nhịp gom buffer
let lastKeyAt = 0         // keydown ký tự in được cuối cùng — để biết đường (a) đang lo lượt này
let lastCode = ''
let lastCodeAt = 0
let viaIme = false        // lượt đang gom đến từ đường IME
let inputSnap: { el: HTMLInputElement | HTMLTextAreaElement; value: string } | null = null
let idleTimer = 0
// Giá trị lần cuối biết của từng ô — để tính phần VỪA chèn khi sự kiện `input` không mang `data`
const seen = new WeakMap<HTMLElement, string>()

function reset() {
  buf = ''
  inputSnap = null
  viaIme = false
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0 }
}

// Màn nào khai `exclusive` (overlay quét tem vị trí đang mở, hoặc màn đang chờ ĐÚNG một loại tem)
// thì CHỈ nó nhận — nếu không, một phát bắn chạy cả hai việc (pallet vừa nhảy ô vừa bị tra lại).
function dispatch(code: string) {
  const now = Date.now()
  if (code === lastCode && now - lastCodeAt < DEDUPE_MS) return   // double-read → nuốt
  lastCode = code
  lastCodeAt = now
  const all = [...subs]
  const ex = all.filter(s => s.exclusive)
  for (const s of (ex.length ? ex : all)) s.fn(code)
}

// Chốt 1 lượt bắn. target = phần tử của sự kiện Enter (nếu chốt qua phím thật); null = chốt qua idle.
function commit(target: EventTarget | null) {
  const code = buf.replace(/[\r\n\t]+$/, '').trim()   // bỏ Enter/Tab thừa dính cuối
  const snap = inputSnap
  const ime = viaIme
  reset()
  if (code.length < MIN_LEN) return
  // Đường IME: chuỗi chữ THUẦN = người gõ / gợi ý bàn phím mềm, KHÔNG phải mã tem. Bỏ qua ở đây,
  // TRƯỚC bước trả lại ô nhập — kết luận "không phải phát bắn" thì tuyệt đối không được đụng vào
  // chữ người ta đang gõ.
  if (ime && !IME_CODE_RE.test(code)) return
  if (snap && (!target || snap.el === target)) restoreInput(snap.el, snap.value)
  dispatch(code)
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
    const isBurst = buf.length >= MIN_LEN && now - lastCharAt <= GAP_MS
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
  if (now - lastCharAt > GAP_MS) reset()                                 // nhịp chậm = người gõ → làm lại
  if (buf === '' && typing) inputSnap = { el: e.target as HTMLInputElement, value: (e.target as HTMLInputElement).value }
  buf += e.key
  lastCharAt = now
  lastKeyAt  = now
  scheduleIdle()   // chốt bằng idle nếu không có Enter thật (Zebra gửi Enter kiểu string/IME)
}

// Đường (b): súng ở chế độ IME → chữ chỉ xuất hiện qua sự kiện `input`, không có keydown ký tự.
function onFocusIn(e: FocusEvent) {
  if (isEditable(e.target)) seen.set(e.target, e.target.value)
}

function onInput(e: Event) {
  const el = e.target
  if (!isEditable(el)) return
  const before = seen.get(el) ?? ''
  seen.set(el, el.value)
  const now = Date.now()
  if (now - lastKeyAt <= GAP_MS) return   // đường keydown đang lo lượt này → đừng đếm hai lần
  const ie = e as InputEvent
  // Chỉ nhận CHÈN CHỮ. Loại `insertFromPaste` (dán tay) + `insertReplacementText` (tự điền) +
  // mọi kiểu xoá — nếu không, dán một mã vào ô tìm kiếm cũng thành một phát bắn.
  if (ie.inputType && ie.inputType !== 'insertText' && ie.inputType !== 'insertCompositionText') return
  const added = typeof ie.data === 'string' && ie.data
    ? ie.data
    : (el.value.length > before.length && el.value.startsWith(before) ? el.value.slice(before.length) : '')
  if (!added) return
  if (now - lastCharAt > GAP_MS) { reset(); inputSnap = { el, value: before } }
  viaIme = true
  buf += added
  lastCharAt = now
  scheduleIdle()
}

function start() {
  // Ô đang focus lúc máy đọc bật (vd nút quét vị trí mount SAU khi ô mã pallet đã focus): phải mồi
  // giá trị hiện tại, không thì lượt bắn đầu tiên sẽ "trả lại" ô về rỗng và xoá mất mã đang hiển thị.
  const act = document.activeElement
  if (isEditable(act)) seen.set(act, act.value)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('input', onInput, true)
  window.addEventListener('focusin', onFocusIn, true)
}

function stop() {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('input', onInput, true)
  window.removeEventListener('focusin', onFocusIn, true)
  reset()
  lastCode = ''
  lastCodeAt = 0
}

// ─── Hook: chỉ ĐĂNG KÝ nhận mã, không tự dựng máy đọc ────────────────────────

export function useWedgeScanner(
  onScan: (code: string) => void,
  enabled: boolean,
  opts?: { exclusive?: boolean },
) {
  const cb = useRef(onScan)
  cb.current = onScan
  const exclusive = !!opts?.exclusive

  useEffect(() => {
    if (!enabled) return
    const sub: Sub = { fn: code => cb.current(code), exclusive }
    subs.add(sub)
    if (subs.size === 1) start()
    return () => {
      subs.delete(sub)
      if (subs.size === 0) stop()
    }
  }, [enabled, exclusive])
}
