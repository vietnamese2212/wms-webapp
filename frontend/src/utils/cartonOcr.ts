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

// Bóc giờ + ngày NSX từ text OCR — tách riêng để test được thuần túy
export function extractPrintInfo(raw: string): { time: string | null; nsxDate: string | null } {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const timeRe = /(\d{1,2})\s*[:;]\s*(\d{2})(?:\s*[:;]\s*(\d{2}))?/
  const dateRe = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/
  let time: string | null = null
  let nsxDate: string | null = null
  for (const line of lines) {
    const isHsd = /HSD/i.test(line.replace(/\s+/g, ''))
    const isNsx = /NSX/i.test(line.replace(/\s+/g, ''))
    if (!isHsd) {
      const t = timeRe.exec(line)
      if (t) {
        const hh = +t[1], mm = +t[2], ss = t[3] != null ? +t[3] : null
        if (hh <= 23 && mm <= 59 && (ss == null || ss <= 59)) {
          const val = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${ss != null ? ':' + String(ss).padStart(2, '0') : ''}`
          if (isNsx || time == null) time = val   // dòng NSX thắng giờ đứng riêng
        }
      }
    }
    if (isNsx) {
      const d = dateRe.exec(line)
      if (d) {
        const dd = +d[1], mo = +d[2]
        let yy = +d[3]
        if (yy < 100) yy += 2000
        if (dd >= 1 && dd <= 31 && mo >= 1 && mo <= 12 && yy >= 2020 && yy <= 2100)
          nsxDate = `${yy}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      }
    }
  }
  return { time, nsxDate }
}

// Tiền xử lý cho font chấm: phóng to → xám → nhị phân (ngưỡng dưới mean — mực tối hơn nền
// bìa) → GIÃN NỞ 4 hướng 1 vòng cho các chấm dính liền thành nét chữ.
async function preprocess(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Không nạp được ảnh'))
    i.src = dataUrl
  })
  const scale = Math.max(1, Math.min(3, 1000 / img.width))   // 1000px đủ cho chữ in phun, OCR nhanh hơn ~2×
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Không tạo được canvas')
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const im = ctx.getImageData(0, 0, c.width, c.height)
  const px = im.data
  const n = c.width * c.height
  const gray = new Uint8Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const g = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) | 0
    gray[i] = g
    sum += g
  }
  const thr = (sum / n) * 0.82
  const bin = new Uint8Array(n)
  for (let i = 0; i < n; i++) bin[i] = gray[i] < thr ? 1 : 0
  const W = c.width, H = c.height
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
      // Khóa bảng ký tự: chỉ những gì có trên dòng date in phun — độ chính xác font chấm nhảy vọt
      await w.setParameters({ tessedit_char_whitelist: '0123456789:/NSXHD. ' })
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

export async function readCartonPrint(dataUrl: string): Promise<CartonPrintInfo> {
  try {
    const [worker, canvas] = await Promise.all([getWorker(), preprocess(dataUrl)])
    const { data } = await worker.recognize(canvas)
    const raw = (data.text ?? '').trim()
    const { time, nsxDate } = extractPrintInfo(raw)
    return { raw, time, nsxDate, ok: true }
  } catch {
    return { raw: '', time: null, nsxDate: null, ok: false }
  }
}
