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

// ─── TẬP MÃ ĐỌC ĐƯỢC — khai MỘT CHỖ cho cả 2 engine + trang quét loạt (user 21/08: "có thời điểm
// tôi quét barcode, có thời điểm quét QR code"). Trước đó chỉ khai QR nên mã vạch 1D bị BỎ QUA
// hoàn toàn (không lỗi, không báo gì — camera cứ như không thấy).
// QR vẫn là mã CHÍNH (tem pallet); 1D là các họ in trên thùng/chứng từ. Không mở DataMatrix/PDF417
// vì chưa có nhu cầu mà mỗi format thêm đều tốn CPU mỗi khung.
// Tên format khác nhau giữa 2 engine: BarcodeDetector dùng snake_case, zxing-wasm dùng tên riêng.
// KHÔNG mở UPC-E: máy đọc trả về bản MỞ RỘNG (`01234565` → `0012345000065`) nên chuỗi quét ra khác
// hẳn số in trên thùng ⇒ tra cứu không khớp mà người quét không hiểu vì sao. UPC-A thì giữ, chỉ lưu ý
// nó được trả dưới dạng EAN-13 (thêm một số 0 ở đầu) — đó là chuẩn, không phải lỗi.
export const NATIVE_FORMATS = [
  'qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'itf',
] as const
// ⚠️ Tên zxing-wasm là ĐỊNH DANH KHÔNG DẤU GẠCH (`EAN13`, không phải `EAN-13` — chuỗi có gạch là
// nhãn hiển thị "EAN-13"). Khai sai tên thì format đó âm thầm không được bật.
export const ZXING_FORMATS = [
  'QRCode', 'Code128', 'Code39', 'EAN13', 'EAN8', 'UPCA', 'ITF',
] as const

// Số DÒNG QUÉT phải cho ra CÙNG một kết quả mới nhận (zxing mặc định 2).
// Mã vạch 1D không có mã sửa lỗi như QR nên vạch mờ/nghiêng ĐỌC RA SỐ KHÔNG CÓ THẬT — đo 21/08 trên
// khung mờ 1,6px: mặc định sinh mã rác `0944707820120`, đặt 3 thì rác về 0 mà KHÔNG mất mã thật nào
// (11/15 cả hai bên), và gần như không tốn thêm thời gian (35ms → 35ms ở 1600px, 58→61ms ở 2560px).
export const ZXING_MIN_LINE_COUNT = 3

// ─── LOẠI MÃ ĐỌC THEO TỪNG KHO (`Warehouse.scan_code_types`, migration 20260821e) ─────────────
// User chốt 21/08: "kho nào chỉ bắt QR, kho nào chỉ bắt barcode, kho nào bắt cả 2".
// Đây là cách chặn TẬN GỐC lớp lỗi đọc-sai của mã vạch 1D: 1D không có mã sửa lỗi nên vạch mờ đọc
// ra số không có thật mà vẫn thoả checksum — kho chỉ dùng tem QR thì ĐỪNG GIẢI 1D, không giải thì
// không thể đọc sai (và đỡ CPU/pin mỗi khung). Mặc định 'BOTH' = hành vi đang chạy.
export type ScanCodeTypes = 'QR' | 'BARCODE' | 'BOTH'
const QR_NATIVE = 'qr_code'
const QR_ZXING = 'QRCode'
type NativeFormat = (typeof NATIVE_FORMATS)[number]
type ZxingFormat = (typeof ZXING_FORMATS)[number]
/** Format cho BarcodeDetector theo cấu hình kho (chưa lọc theo máy — createNative lọc tiếp). */
export function nativeFormatsFor(t: ScanCodeTypes = 'BOTH'): NativeFormat[] {
  if (t === 'QR') return [QR_NATIVE]
  if (t === 'BARCODE') return NATIVE_FORMATS.filter(f => f !== QR_NATIVE)
  return [...NATIVE_FORMATS]
}
/** Format cho zxing-wasm theo cấu hình kho. */
export function zxingFormatsFor(t: ScanCodeTypes = 'BOTH'): ZxingFormat[] {
  if (t === 'QR') return [QR_ZXING]
  if (t === 'BARCODE') return ZXING_FORMATS.filter(f => f !== QR_ZXING)
  return [...ZXING_FORMATS]
}

async function createNative(codeTypes: ScanCodeTypes): Promise<ScanEngine | null> {
  if (!window.BarcodeDetector) return null
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats()
    // Chỉ khai những format MÁY NÀY hỗ trợ — khai format lạ thì constructor NÉM, mất luôn engine
    // native (rơi hết về wasm, chậm và tốn pin) chỉ vì một họ mã vạch không quan trọng.
    const formats = nativeFormatsFor(codeTypes).filter(f => supported.includes(f))
    if (!formats.length) return null   // máy không đọc nổi loại mã kho này cần → nhường hết cho wasm
    const det = new window.BarcodeDetector({ formats: [...formats] })
    return {
      kind: 'native',
      detect: async v => (await det.detect(v)).map(b => ({ text: b.rawValue, points: b.cornerPoints })),
    }
  } catch { return null }
}

async function createWasm(codeTypes: ScanCodeTypes): Promise<ScanEngine> {
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
      const results = await readBarcodes(img, {
        formats: zxingFormatsFor(codeTypes), maxNumberOfSymbols: 8,
        tryHarder: true, tryRotate: true, minLineCount: ZXING_MIN_LINE_COUNT,
      })
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
// mỗi khung như cũ; trượt là chen nhịp wasm — bắt được là reset. iPhone/desktop không có
// native → thuần wasm như cũ.
// 12/08 tối (user so Nhập kho vs ô search + Sổ đóng gói): lưới zxing nạp NGAY khi tạo engine,
// KHÔNG chờ trượt 6 khung mới bắt đầu tải — các màn quét mount LẠNH mỗi lần mở (dialog search,
// overlay Packing stopOnScan) từng phải chịu 0,3s + thời gian tải wasm trước khi lưới cứu chạy
// được, trong khi Nhập kho camera sống liên tục nên lưới luôn ấm sẵn → "Nhập bắt tốt hơn".
// Asset wasm nằm trong precache PWA nên nạp trước gần như miễn phí; native vẫn là đường chính.
export async function createScanEngine(codeTypes: ScanCodeTypes = 'BOTH'): Promise<ScanEngine> {
  const native = await createNative(codeTypes)
  if (!native) return createWasm(codeTypes)

  let wasm: ScanEngine | null = null
  let wasmLoading = false
  const loadWasm = () => {
    if (wasm || wasmLoading) return
    wasmLoading = true
    createWasm(codeTypes).then(w => { wasm = w }).catch(() => { wasmLoading = false })   // lỗi nạp (mất mạng thoáng) → thử lại lượt sau
  }
  loadWasm()
  let misses = 0
  return {
    kind: 'native',
    detect: async (video) => {
      const hits = await native.detect(video)
      if (hits.length) { misses = 0; return hits }
      misses++
      if (!wasm) loadWasm()
      // lưới đã ấm sẵn → chen từ khung trượt thứ 2 (~0,1s), mỗi 2 khung 1 nhịp (đo thật 12/08:
      // zxing giải được cả khung nghiêng+nhăn+moiré mà native trượt)
      if (wasm && misses >= 2 && misses % 2 === 0) {
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
