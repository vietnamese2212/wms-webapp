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

// Tạo engine: ưu tiên native (nếu hỗ trợ QR) → nếu không, nạp zxing-wasm.
export async function createScanEngine(): Promise<ScanEngine> {
  if (window.BarcodeDetector) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats()
      if (formats.includes('qr_code')) {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] })
        return {
          kind: 'native',
          detect: async v => (await det.detect(v)).map(b => ({ text: b.rawValue, points: b.cornerPoints })),
        }
      }
    } catch { /* rơi xuống wasm */ }
  }

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

const COLORS: Record<BoxKind, string> = { valid: '#22c55e', invalid: '#ef4444', pending: '#f59e0b' }

// Vẽ khung QR lên overlay. Video dùng object-contain (hiện TRỌN khung) → map pixel video → element.
export function drawBoxes(overlay: HTMLCanvasElement, video: HTMLVideoElement, wrap: HTMLElement, boxes: Box[]) {
  const rect = wrap.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr)
  if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H }
  const ctx = overlay.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, W, H)
  const vw = video.videoWidth, vh = video.videoHeight
  if (!vw || !vh) return
  const scale = Math.min(W / vw, H / vh)          // object-contain
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
