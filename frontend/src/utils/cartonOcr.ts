// ĐỌC CHỮ IN PHUN TRÊN THÙNG (bậc 0 — user chốt 11/08: Tesseract MIỄN PHÍ chạy tại máy,
// đọc trượt thì điền tay; ảnh luôn lưu làm bằng chứng nên OCR chỉ là tiện ích điền sẵn).
// Font in phun CIJ là CHỮ CHẤM RỜI → 2 mẹo bắt buộc: (1) tiền xử lý GIÃN NỞ chấm mực cho
// dính thành nét; (2) khóa bảng ký tự về đúng tập cần đọc (số, :, /, N S X H D).
// 2 format thật đã thấy (ảnh user 11/08):
//   "HSD:030327 D/E02" + "09:08:47  587"        → giờ đứng riêng, dòng HSD không có giờ
//   "NSX: 08/06/26 19:37" + "HSD: 08/02/27 B/Ak32" → giờ nằm trên dòng NSX (ưu tiên)
// tesseract.js nạp ĐỘNG (worker/wasm/langdata từ CDN lần đầu, ~vài MB) — chỉ tải khi
// người dùng thật sự chụp ảnh ở trang Sổ đóng gói.

export interface CartonPrintInfo {
  raw: string            // nguyên văn OCR (lưu DB — giữ cả số đếm 587/B\Ak32 khai thác sau)
  time: string | null    // 'HH:MM' | 'HH:MM:SS'
  nsxDate: string | null // 'YYYY-MM-DD' nếu dòng NSX có ngày
  ok: boolean            // false = OCR lỗi/không chạy được (điền tay)
}

// Bóc giờ + ngày NSX từ text OCR — tách riêng để test được thuần túy.
// CHỐNG BẮT NHẦM (user báo 11/08 tối "bắt tùm lum"): (1) NGÀY bị OCR đọc `/`→`:` sẽ
// giống hệt giờ ("NSX:11:02:26" đọc thành 11:02:26) → dò ngày bằng dấu phân cách
// KHOAN DUNG [/:;.] rồi LOẠI mọi ứng viên giờ TRÙNG VÙNG với ngày; (2) 1 dòng nhiều
// ứng viên → lấy ứng viên CUỐI (máy in phun in ngày trước, giờ sau).
export function extractPrintInfo(raw: string): { time: string | null; nsxDate: string | null } {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const timeRe = /(\d{1,2})\s*[:;]\s*(\d{2})(?:\s*[:;]\s*(\d{2}))?/g
  const dateRe = /(\d{1,2})\s*[/:;.]\s*(\d{1,2})\s*[/:;.]\s*(\d{2,4})/g
  let time: string | null = null
  let timeStrong = false          // giờ từ dòng NSX hoặc có giây = đáng tin hơn giờ trôi nổi
  let nsxDate: string | null = null

  for (const line of lines) {
    const compact = line.replace(/\s+/g, '')
    const isHsd = /HSD/i.test(compact)
    const isNsx = /NSX/i.test(compact)

    // Vùng NGÀY trên dòng — khoan dung kể cả khi `/` bị đọc thành `:`, NHƯNG chuỗi
    // toàn dấu `:` chỉ được coi là ngày khi đứng NGAY SAU nhãn NSX/HSD (nếu không sẽ
    // nuốt nhầm giờ có giây "09:08:47" đứng riêng).
    const dateSpans: [number, number][] = []
    dateRe.lastIndex = 0
    for (let d = dateRe.exec(line); d; d = dateRe.exec(line)) {
      const dd = +d[1], mo = +d[2]
      let yy = +d[3]
      if (yy < 100) yy += 2000
      if (!(dd >= 1 && dd <= 31 && mo >= 1 && mo <= 12 && yy >= 2020 && yy <= 2100)) continue
      const hasSlash = d[0].includes('/') || d[0].includes('.')
      const afterLabel = /(?:NSX|HSD)[\s:;.]*$/i.test(line.slice(0, d.index))
      if (!hasSlash && !afterLabel) continue
      dateSpans.push([d.index, d.index + d[0].length])
      if (isNsx && !nsxDate)
        nsxDate = `${yy}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    }

    if (isHsd) continue   // dòng HSD: không lấy giờ (giờ trên đó là hạn dùng, không phải giờ SX)

    // Ứng viên giờ = mọi match KHÔNG chồng lên vùng ngày; lấy ứng viên CUỐI của dòng
    let cand: { val: string; hasSec: boolean } | null = null
    timeRe.lastIndex = 0
    for (let t = timeRe.exec(line); t; t = timeRe.exec(line)) {
      const start = t.index, end = t.index + t[0].length
      if (dateSpans.some(([s, e]) => start < e && end > s)) continue
      const hh = +t[1], mm = +t[2], ss = t[3] != null ? +t[3] : null
      if (hh > 23 || mm > 59 || (ss != null && ss > 59)) continue
      cand = {
        val: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${ss != null ? ':' + String(ss).padStart(2, '0') : ''}`,
        hasSec: ss != null,
      }
    }
    if (cand) {
      const strong = isNsx || cand.hasSec
      if (time == null || (strong && !timeStrong)) { time = cand.val; timeStrong = strong }
    }
  }
  return { time, nsxDate }
}

// Tiền xử lý: phóng to → xám → (mode 'binary') nhị phân theo ngưỡng dưới mean + GIÃN NỞ
// 4 hướng cho chấm mực dính thành nét; (mode 'gray') chỉ xám — để Tesseract tự Otsu, cứu
// các ảnh nền màu (thùng cam/đỏ) mà ngưỡng toàn cục làm nát chữ (ảnh user 11/08 chiều:
// tấm NSX:11/02/26 17:44 rất rõ vẫn trượt).
async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Không nạp được ảnh'))
    i.src = dataUrl
  })
}

// crop = phần khung hình lấy vào (tỷ lệ 0..1) — chữ date thường ở GIỮA khung khi user nhắm
type CropFrac = { x: number; y: number; w: number; h: number }

// ── TỰ DÒ DẢI MỰC IN (12/08 — 2 ảnh thật của user trượt: chữ trên GIẤY KRAFT NÂU, chiếm
// mảnh nhỏ của khung, hơi nghiêng). Thu nhỏ 640px → xám → nhị phân thích nghi → tìm DẢI
// hàng nhiều nét đứt (chữ in; loại logo dải cao + bóng mép ít nét đứt); mỗi dải trả kèm
// GÓC NGHIÊNG (hồi quy tâm mực theo cột — ảnh chụp tay hay nghiêng, Tesseract chịu kém)
// và CHIỀU CAO DÒNG ước lượng (để scale về cỡ chữ ~38px Tesseract đọc tốt nhất).
type InkBand = { crop: { x0: number; y0: number; w: number; h: number }; angle: number; lineH: number }

function bradley(gray: Uint8Array, W: number, H: number, k: number, half: number): Uint8Array {
  const integ = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let rs = 0
    for (let x = 0; x < W; x++) {
      rs += gray[y * W + x]
      integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + rs
    }
  }
  const bin = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const y1 = Math.max(0, y - half), y2 = Math.min(H - 1, y + half)
    for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - half), x2 = Math.min(W - 1, x + half)
      const area = (x2 - x1 + 1) * (y2 - y1 + 1)
      const s = integ[(y2 + 1) * (W + 1) + (x2 + 1)] - integ[y1 * (W + 1) + (x2 + 1)] - integ[(y2 + 1) * (W + 1) + x1] + integ[y1 * (W + 1) + x1]
      bin[y * W + x] = gray[y * W + x] < (s / area) * k ? 1 : 0
    }
  }
  return bin
}

function detectInkBands(img: HTMLImageElement): InkBand[] {
  const W = 640
  const scale = W / img.width
  const H = Math.max(1, Math.round(img.height * scale))
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, W, H)
  const px = ctx.getImageData(0, 0, W, H).data
  const n = W * H
  const gray = new Uint8Array(n)
  for (let i = 0; i < n; i++) gray[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) | 0
  const bin = bradley(gray, W, H, 0.82, 20)
  const rowInk = new Float64Array(H)
  const rowTrans = new Float64Array(H)
  for (let y = 0; y < H; y++) {
    let ink = 0, trans = 0, prev = 0
    for (let x = 0; x < W; x++) {
      const v = bin[y * W + x]
      ink += v
      if (v !== prev) trans++
      prev = v
    }
    rowInk[y] = ink / W
    rowTrans[y] = trans
  }
  const isTextRow = (y: number) => rowInk[y] > 0.005 && rowInk[y] < 0.25 && rowTrans[y] >= 12
  const bands: { y0: number; y1: number; score: number }[] = []
  let y0 = -1, gap = 0
  const maxGap = Math.max(2, Math.round(H * 0.015))
  for (let y = 0; y <= H; y++) {
    if (y < H && isTextRow(y)) { if (y0 < 0) y0 = y; gap = 0 }
    else if (y0 >= 0 && (++gap > maxGap || y === H)) {
      const y1 = y - gap
      const bh = y1 - y0 + 1
      if (bh >= H * 0.008 && bh <= H * 0.16) {   // 2 dòng chữ in ≈ 2–8%H; logo/khối lớn bị loại
        let score = 0
        for (let yy = y0; yy <= y1; yy++) score += rowTrans[yy]
        bands.push({ y0, y1, score })
      }
      y0 = -1; gap = 0
    }
  }
  bands.sort((a, b) => b.score - a.score)
  const inv = img.width / W
  return bands.slice(0, 2).map(b => {
    let x0 = W, x1 = 0
    for (let yy = b.y0; yy <= b.y1; yy++)
      for (let x = 0; x < W; x++)
        if (bin[yy * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x }
    if (x1 <= x0) { x0 = 0; x1 = W - 1 }
    // góc nghiêng: hồi quy tuyến tính tâm mực theo cột
    const xs: number[] = [], ys: number[] = []
    for (let x = x0; x <= x1; x++) {
      let sum = 0, cnt = 0
      for (let yy = Math.max(0, b.y0 - 3); yy <= Math.min(H - 1, b.y1 + 3); yy++)
        if (bin[yy * W + x]) { sum += yy; cnt++ }
      if (cnt > 0) { xs.push(x); ys.push(sum / cnt) }
    }
    let angle = 0
    if (xs.length > 20) {
      const mx = xs.reduce((a, v) => a + v, 0) / xs.length
      const my = ys.reduce((a, v) => a + v, 0) / ys.length
      let num = 0, den = 0
      for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
      if (den > 0) angle = Math.atan(num / den) * 180 / Math.PI
      if (Math.abs(angle) > 15) angle = 0
    }
    const bh = b.y1 - b.y0 + 1
    const padX = (x1 - x0 + 1) * 0.15 + 10
    const padY = bh * 0.8 + 6
    const crop = {
      x0: Math.max(0, Math.round((x0 - padX) * inv)),
      y0: Math.max(0, Math.round((b.y0 - padY) * inv)),
      w: Math.round((x1 - x0 + 1 + padX * 2) * inv),
      h: Math.round((bh + padY * 2) * inv),
    }
    crop.w = Math.min(crop.w, img.width - crop.x0)
    crop.h = Math.min(crop.h, img.height - crop.y0)
    return { crop, angle, lineH: (bh * inv) / 2.2 }
  })
}

// Lượt DẢI MỰC: cắt đúng vùng chữ, scale về cỡ chữ ~38px, xoay bù góc đo được;
// 'binary' = LÀM MỜ 3×3 nối chấm mực TRƯỚC nhị phân (dilation nhị phân khuếch đại vân giấy kraft).
function prepBand(img: HTMLImageElement, band: InkBand, mode: 'binary' | 'gray', rotateDeg: number): HTMLCanvasElement {
  const { x0, y0, w, h } = band.crop
  const scale = Math.max(0.6, Math.min(3, 38 / Math.max(8, band.lineH)))
  const outW = Math.max(8, Math.round(w * scale))
  const outH = Math.max(8, Math.round(h * scale))
  const p = document.createElement('canvas')
  p.width = outW; p.height = outH
  const pc = p.getContext('2d')
  if (!pc) throw new Error('Không tạo được canvas')
  pc.imageSmoothingEnabled = true
  pc.fillStyle = '#fff'
  pc.fillRect(0, 0, outW, outH)
  pc.translate(outW / 2, outH / 2)
  if (rotateDeg) pc.rotate(rotateDeg * Math.PI / 180)
  pc.drawImage(img, x0, y0, w, h, -outW / 2, -outH / 2, outW, outH)
  pc.setTransform(1, 0, 0, 1, 0, 0)
  const im = pc.getImageData(0, 0, outW, outH)
  const px = im.data
  const n = outW * outH
  let gray = new Uint8Array(n)
  for (let i = 0; i < n; i++) gray[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) | 0
  if (mode === 'gray') {
    for (let i = 0; i < n; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = gray[i]; px[i * 4 + 3] = 255 }
  } else {
    const blurred = new Uint8Array(n)   // box blur 3×3
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        let s = 0, cnt = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx
          if (yy >= 0 && yy < outH && xx >= 0 && xx < outW) { s += gray[yy * outW + xx]; cnt++ }
        }
        blurred[y * outW + x] = (s / cnt) | 0
      }
    }
    gray = blurred
    const bin = bradley(gray, outW, outH, 0.9, Math.max(8, (outW / 32) | 0))
    for (let i = 0; i < n; i++) { const v = bin[i] ? 0 : 255; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255 }
  }
  pc.putImageData(im, 0, 0)
  return p
}

function preprocess(img: HTMLImageElement, targetW: number, mode: 'binary' | 'gray', crop?: CropFrac, rotateDeg = 0): HTMLCanvasElement {
  const sx = Math.round(img.width * (crop?.x ?? 0))
  const sy = Math.round(img.height * (crop?.y ?? 0))
  const sw = Math.max(1, Math.round(img.width * (crop?.w ?? 1)))
  const sh = Math.max(1, Math.round(img.height * (crop?.h ?? 1)))
  const scale = Math.max(0.2, Math.min(6, targetW / sw))
  const c = document.createElement('canvas')
  c.width = Math.round(sw * scale)
  c.height = Math.round(sh * scale)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Không tạo được canvas')
  ctx.imageSmoothingEnabled = true
  if (rotateDeg) {   // ảnh chụp tay hay NGHIÊNG vài độ — Tesseract chịu kém, xoay bù thử lại
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.translate(c.width / 2, c.height / 2)
    ctx.rotate(rotateDeg * Math.PI / 180)
    ctx.translate(-c.width / 2, -c.height / 2)
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const im = ctx.getImageData(0, 0, c.width, c.height)
  const px = im.data
  const W = c.width, H = c.height
  const n = W * H
  const gray = new Uint8Array(n)
  for (let i = 0; i < n; i++) gray[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) | 0
  if (mode === 'gray') {
    for (let i = 0; i < n; i++) {
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = gray[i]
      px[i * 4 + 3] = 255
    }
    ctx.putImageData(im, 0, 0)
    return c
  }
  // NHỊ PHÂN THÍCH NGHI (Bradley, cửa sổ ~W/16) thay ngưỡng toàn cục — thùng nền màu +
  // màng bọc bóng loáng làm mean toàn ảnh vô nghĩa (ảnh user 11/08: rất nét vẫn trượt).
  // Integral image → mean cục bộ O(1) per pixel.
  const integ = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let rowSum = 0
    for (let x = 0; x < W; x++) {
      rowSum += gray[y * W + x]
      integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + rowSum
    }
  }
  const half = Math.max(8, (W / 32) | 0)
  const bin = new Uint8Array(n)
  for (let y = 0; y < H; y++) {
    const y1 = Math.max(0, y - half), y2 = Math.min(H - 1, y + half)
    for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - half), x2 = Math.min(W - 1, x + half)
      const area = (x2 - x1 + 1) * (y2 - y1 + 1)
      const s = integ[(y2 + 1) * (W + 1) + (x2 + 1)] - integ[y1 * (W + 1) + (x2 + 1)]
        - integ[(y2 + 1) * (W + 1) + x1] + integ[y1 * (W + 1) + x1]
      bin[y * W + x] = gray[y * W + x] < (s / area) * 0.88 ? 1 : 0
    }
  }
  // GIÃN NỞ 4 hướng 1 vòng — chấm mực CIJ dính thành nét chữ
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const on = bin[i]
        || (x > 0 && bin[i - 1]) || (x < W - 1 && bin[i + 1])
        || (y > 0 && bin[i - W]) || (y < H - 1 && bin[i + W])
      const v = on ? 0 : 255
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v
      px[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(im, 0, 0)
  return c
}

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>
let _worker: Promise<TesseractWorker> | null = null
function getWorker(): Promise<TesseractWorker> {
  if (!_worker) {
    _worker = (async () => {
      const { createWorker } = await import('tesseract.js')
      const w = await createWorker('eng')
      // Khóa bảng ký tự về đúng tập trên dòng date in phun + PSM 6 (khối chữ đồng nhất —
      // mặc định PSM 3 dò bố cục TRANG, rất tệ với 2 dòng chữ chấm rời) + khai DPI.
      await w.setParameters({
        tessedit_char_whitelist: '0123456789:/NSXHD. ',
        tessedit_pageseg_mode: '6' as import('tesseract.js').PSM,   // PSM.SINGLE_BLOCK
        user_defined_dpi: '300',
      })
      return w
    })()
    _worker.catch(() => { _worker = null })   // lỗi nạp (mất mạng CDN) → lần sau thử lại
  }
  return _worker
}

// Gọi khi MỞ TRANG sổ đóng gói: tải trước worker/wasm/langdata (vài MB từ CDN) trong lúc
// công nhân chưa chụp — lần chụp đầu không phải chờ tải (user báo 11/08 "chụp và lưu rất lâu").
export function warmOcr(): void {
  void getWorker().catch(() => { /* mất mạng → lần chụp sẽ thử lại */ })
}

// ĐA LƯỢT (11/08 chiều — tấm rất rõ vẫn trượt vì 1 lượt binary duy nhất): chạy tối đa 3
// biến thể ảnh, DỪNG NGAY khi bóc được giờ. GỌI VỚI ẢNH GỐC full-res (đừng đưa ảnh đã nén
// 1024px — chữ in phun bị nghiền nát trước khi OCR nhìn thấy; đó là bug gốc).
const CENTER: CropFrac = { x: 0.12, y: 0.22, w: 0.76, h: 0.56 }   // vùng giữa khung — chỗ user nhắm chữ

export async function readCartonPrint(dataUrl: string): Promise<CartonPrintInfo> {
  try {
    const [worker, img] = await Promise.all([getWorker(), loadImage(dataUrl)])
    let bestRaw = ''
    const tryCanvas = async (canvas: HTMLCanvasElement): Promise<CartonPrintInfo | null> => {
      const { data } = await worker.recognize(canvas)
      const raw = (data.text ?? '').trim()
      if (raw.length > bestRaw.length) bestRaw = raw
      const { time, nsxDate } = extractPrintInfo(raw)
      return time ? { raw, time, nsxDate, ok: true } : null
    }
    // Lượt ưu tiên: các DẢI MỰC IN tự dò — cắt trúng chữ, scale về cỡ đọc tốt, xoay bù
    // góc nghiêng ĐO ĐƯỢC (đo 12/08: ảnh thẳng/gần thẳng ăn ngay lượt đầu).
    for (const b of detectInkBands(img)) {
      for (const [mode, rot] of [['binary', -b.angle], ['gray', -b.angle], ['binary', 0], ['gray', 0]] as ['binary' | 'gray', number][]) {
        const hit = await tryCanvas(prepBand(img, b, mode, rot))
        if (hit) return hit
      }
    }
    // Lượt toàn khung / cắt giữa (giữ từ bản trước — cứu khi dò dải trượt)
    const fallbacks: { w: number; mode: 'binary' | 'gray'; crop?: CropFrac }[] = [
      { w: 1600, mode: 'binary' },
      { w: 2000, mode: 'binary', crop: CENTER },
      { w: 1600, mode: 'gray' },
    ]
    for (const p of fallbacks) {
      const hit = await tryCanvas(preprocess(img, p.w, p.mode, p.crop))
      if (hit) return hit
    }
    const { time, nsxDate } = extractPrintInfo(bestRaw)
    return { raw: bestRaw, time, nsxDate, ok: true }
  } catch {
    return { raw: '', time: null, nsxDate: null, ok: false }
  }
}
