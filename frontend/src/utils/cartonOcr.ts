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

function preprocess(img: HTMLImageElement, targetW: number, mode: 'binary' | 'gray', crop?: CropFrac): HTMLCanvasElement {
  const sx = Math.round(img.width * (crop?.x ?? 0))
  const sy = Math.round(img.height * (crop?.y ?? 0))
  const sw = Math.max(1, Math.round(img.width * (crop?.w ?? 1)))
  const sh = Math.max(1, Math.round(img.height * (crop?.h ?? 1)))
  const scale = Math.max(0.2, Math.min(4, targetW / sw))
  const c = document.createElement('canvas')
  c.width = Math.round(sw * scale)
  c.height = Math.round(sh * scale)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Không tạo được canvas')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
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
const OCR_PASSES: { w: number; mode: 'binary' | 'gray'; crop?: CropFrac }[] = [
  { w: 1600, mode: 'binary' },                 // adaptive-binary toàn khung — chấm CIJ chuẩn
  { w: 2000, mode: 'binary', crop: CENTER },   // chữ nhỏ trong khung rộng → cắt giữa + phóng to
  { w: 1600, mode: 'gray' },                   // nền phức tạp — để Tesseract tự Otsu
  { w: 2000, mode: 'gray', crop: CENTER },
]

export async function readCartonPrint(dataUrl: string): Promise<CartonPrintInfo> {
  try {
    const [worker, img] = await Promise.all([getWorker(), loadImage(dataUrl)])
    let bestRaw = ''
    for (const p of OCR_PASSES) {
      const { data } = await worker.recognize(preprocess(img, p.w, p.mode, p.crop))
      const raw = (data.text ?? '').trim()
      if (raw.length > bestRaw.length) bestRaw = raw
      const { time, nsxDate } = extractPrintInfo(raw)
      if (time) return { raw, time, nsxDate, ok: true }
    }
    const { time, nsxDate } = extractPrintInfo(bestRaw)
    return { raw: bestRaw, time, nsxDate, ok: true }
  } catch {
    return { raw: '', time: null, nsxDate: null, ok: false }
  }
}
