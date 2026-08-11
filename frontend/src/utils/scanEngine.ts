// Engine quét QR cho QUÉT ĐƠN (components/shared/QRScanner) — bắt nhanh + vẽ khung màu lên đúng vị trí QR:
//   BarcodeDetector native (Android Chrome — nhanh nhất, đa mã) → fallback zxing-wasm (iPhone/desktop).
// (Trang test QUÉT LOẠT MultiScanTest có bản engine RIÊNG với nút tinh chỉnh độ phân giải/engine; validator
//  tem dùng CHUNG qua utils/qr.ts `isValidTem` để BE↔FE luôn khớp. Đây là engine "chuẩn" cho luồng thật.)

export interface ScanHit { text: string; points: { x: number; y: number }[] }
export type BoxKind = 'valid' | 'invalid' | 'pending'
export interface Box { points: { x: number; y: number }[]; kind: BoxKind }

// BarcodeDetector chưa có trong lib.dom của TS — khai báo tối thiểu
interface DetectedBarcode { rawValue: string; cornerPoints: { x: number; y: number }[] }
interface BarcodeDetectorInstance { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor {
  new (options?: { formats: string[] }): BarcodeDetectorInstance
  getSupportedFormats(): Promise<string[]>
}
declare global { interface Window { BarcodeDetector?: BarcodeDetectorCtor } }

// getCapabilities()/applyConstraints với zoom/torch chưa có trong TS DOM types
export type ExtCapabilities = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step: number }
  torch?: boolean
}

export interface ScanEngine {
  kind: 'native' | 'wasm'
  detect(video: HTMLVideoElement): Promise<ScanHit[]>
}

const WASM_WIDTH = 2560   // giải ở ~2560px — cân bằng tốc độ/độ xa cho tem nhỏ trên iPhone/desktop

async function createNative(): Promise<ScanEngine | null> {
  if (!window.BarcodeDetector) return null
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats()
    if (!formats.includes('qr_code')) return null
    const det = new window.BarcodeDetector({ formats: ['qr_code'] })
    return {
      kind: 'native',
      detect: async v => (await det.detect(v)).map(b => ({ text: b.rawValue, points: b.cornerPoints })),
    }
  } catch { return null }
}

async function createWasm(): Promise<ScanEngine> {
  const [{ prepareZXingModule, readBarcodes }, wasmUrl] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url').then(m => m.default),
  ])
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? wasmUrl : prefix + path },
  })
  const work = document.createElement('canvas')
  return {
    kind: 'wasm',
    detect: async video => {
      const vw = video.videoWidth, vh = video.videoHeight
      if (!vw || !vh) return []
      const scale = Math.min(1, WASM_WIDTH / vw)
      const cw = Math.round(vw * scale), ch = Math.round(vh * scale)
      if (work.width !== cw || work.height !== ch) { work.width = cw; work.height = ch }
      const ctx = work.getContext('2d', { willReadFrequently: true })
      if (!ctx) return []
      ctx.drawImage(video, 0, 0, cw, ch)
      const img = ctx.getImageData(0, 0, cw, ch)
      const results = await readBarcodes(img, { formats: ['QRCode'], maxNumberOfSymbols: 8, tryHarder: true, tryRotate: true })
      const inv = 1 / scale   // tọa độ về hệ pixel video gốc
      return results.map(r => ({
        text: r.text,
        points: [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft]
          .map(p => ({ x: p.x * inv, y: p.y * inv })),
      }))
    },
  }
}

// Tạo engine: native (nhanh, rẻ pin) + LƯỚI ZXING khi native bắt trượt (11/08 — user so với
// Zalo: quét QR hiển thị trên MÀN HÌNH laptop, app "rất tồi" trong khi Zalo bắt ngay).
// Nguyên nhân: BarcodeDetector của Chrome Android đi qua API barcode ĐỜI CŨ của Play Services,
// kém hơn hẳn ML Kit đầy đủ (Zalo) với QR trên màn hình/tem xấu; trong khi zxing-wasm
// tryHarder@2560 ĐO THẬT giải được cả khung nhiễm lưới pixel màn hình. Cách chữa: native chạy
// mỗi khung như cũ; trượt liên tục ~12 khung (~0,6s) → nạp lười zxing rồi cứ 3 khung trượt
// chen 1 nhịp wasm — bắt được là reset. iPhone/desktop không có native → thuần wasm như cũ.
export async function createScanEngine(): Promise<ScanEngine> {
  const native = await createNative()
  if (!native) return createWasm()

  let wasm: ScanEngine | null = null
  let wasmLoading = false
  let misses = 0
  return {
    kind: 'native',
    detect: async (video) => {
      const hits = await native.detect(video)
      if (hits.length) { misses = 0; return hits }
      misses++
      if (misses >= 12 && !wasm && !wasmLoading) {
        wasmLoading = true
        createWasm().then(w => { wasm = w }).catch(() => { wasmLoading = false })   // lỗi nạp → thử lại lượt sau
      }
      if (wasm && misses % 3 === 0) {
        const rescue = await wasm.detect(video)
        if (rescue.length) misses = 0
        return rescue
      }
      return []
    },
  }
}

const COLORS: Record<BoxKind, string> = { valid: '#22c55e', invalid: '#ef4444', pending: '#f59e0b' }

// Vẽ khung QR lên overlay. `fit` PHẢI khớp CSS object-fit của <video> để khung nằm đúng vị trí QR:
//   'contain' (trang quét loạt) = hiện trọn khung · 'cover' (quét đơn) = lấp đầy border, cắt bớt mép.
export function drawBoxes(overlay: HTMLCanvasElement, video: HTMLVideoElement, wrap: HTMLElement, boxes: Box[], fit: 'contain' | 'cover' = 'contain') {
  const rect = wrap.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr)
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H }
  const ctx = overlay.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, W, H)
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return
  const scale = fit === 'cover' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh)
  const offX = (W - vw * scale) / 2, offY = (H - vh * scale) / 2
  for (const b of boxes) {
    if (b.points.length < 4) continue
    ctx.strokeStyle = COLORS[b.kind]
    ctx.lineWidth = 3 * dpr
    ctx.beginPath()
    b.points.forEach((p, i) => {
      const x = p.x * scale + offX, y = p.y * scale + offY
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.stroke()
  }
}
