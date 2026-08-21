// Trang TEST quét NHIỀU QR trong 1 phiên camera (kiểu Scandit MatrixScan).
// Độc lập hoàn toàn: không gọi API, không ghi DB — chỉ để đo tốc độ/độ ổn định
// trên thiết bị thật trước khi tích hợp vào luồng Xuất hàng.
// Engine: BarcodeDetector native (Android Chrome — nhanh, đa mã) → fallback
// zxing-wasm (iPhone/desktop — cũng đa mã, chạy WASM bundle nội bộ).
import { useEffect, useRef, useState } from 'react'
import { Copy, Flashlight, FlashlightOff, Pause, Play, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { unlockAudio, playBeep } from '@/utils/audio'
import { isValidTem } from '@/utils/qr'
import { registerHit, MIN_HITS_1D, type ScanEntry } from '@/utils/scanDedupe'
// Tập mã đọc được khai MỘT CHỖ ở scanEngine (QR + 1D) — trang này có engine riêng để tinh chỉnh
// độ phân giải/tryHarder, nhưng ĐỪNG khai lại danh sách format kẻo lệch với luồng thật.
import { NATIVE_FORMATS, ZXING_FORMATS, ZXING_MIN_LINE_COUNT } from '@/utils/scanEngine'

// ── BarcodeDetector chưa có trong lib.dom của TS — khai báo tối thiểu ──────────
interface DetectedBarcode {
  rawValue: string
  cornerPoints: { x: number; y: number }[]
}
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
interface BarcodeDetectorCtor {
  new (options?: { formats: string[] }): BarcodeDetectorInstance
  getSupportedFormats(): Promise<string[]>
}
declare global {
  interface Window { BarcodeDetector?: BarcodeDetectorCtor }
}

// track.getCapabilities()/applyConstraints với zoom/torch chưa có trong TS DOM types
type ExtCapabilities = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step: number }
  torch?: boolean
}
type ExtConstraintSet = MediaTrackConstraintSet & { zoom?: number; torch?: boolean }

// Validate định dạng tem (V1 `_` pallet / V2 `;` thùng) dùng CHUNG với scanner đơn: utils/qr.ts isValidTem.

// Bản ghi 1 mã trong phiên quét = ScanEntry của utils/scanDedupe (dùng chung để logic gom mã có
// thể kiểm bằng test thuần, không cần camera).
type ScannedCode = ScanEntry

interface FrameBox {
  points: { x: number; y: number }[]
  kind: 'new' | 'dup' | 'invalid' | 'pending'
}

type EngineKind = 'native' | 'wasm'
const WASM_WIDTHS = [1280, 1920, 2560, 3840] as const
// Mã ĐÚNG định dạng: nhận NGAY lần đầu (không làm chậm) — QR có mã sửa lỗi nên gần như
// không thể decode nhầm ra đúng cấu trúc 40 ký tự. Mã 1D thì ngược lại (không có mã sửa lỗi,
// bản đọc sai vẫn thoả checksum) nên phải thấy đủ MIN_HITS_1D lần mới hiện — ngưỡng khai ở
// utils/scanDedupe (một nguồn, gói QA 30 kiểm).
const INVALID_MIN_HITS = MIN_HITS_1D
// Dưới mốc này thì dòng 1D có thể là BẢN ĐỌC SAI của tem bên cạnh (mã thật trong đo thật đạt 10–86
// lần, rác chỉ 2–5) → gắn nhãn "chưa chắc" NGAY LÚC QUÉT để người quét tự soi. Cố ý BÁO cho người
// thay vì tự đoán rồi xoá: đoán theo vị trí đã làm mất mã thật 2 lần (xem đầu utils/scanDedupe).
const WEAK_HITS = 6

// ── Setup người dùng (nhớ giữa các lần quét) ──────────────────────────────────
interface ScanSettings { wasmWidth?: number; lens?: 'wide' | 'ultra'; zoom?: number; tryHarder?: boolean }
const SETTINGS_KEY = 'multi_scan_settings_v1'
function loadSettings(): ScanSettings {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') || {} } catch { return {} }
}
function saveSettings(patch: ScanSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch })) } catch {}
}

// ── Lịch sử phiên quét — lưu localStorage của máy (trang test không ghi DB) ────
interface SavedSession {
  id: string
  started_at: number
  ended_at: number
  engine: EngineKind
  video_res: string
  wasm_width: number
  decode_ms: number
  device: string
  codes: ScannedCode[]
}
const SESSIONS_KEY = 'multi_scan_sessions_v1'
const SESSIONS_MAX = 20
function loadSessions(): SavedSession[] {
  try {
    const arr = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '[]')
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}
function persistSessions(list: SavedSession[]) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(list)) } catch {}
}
// Tốc độ quét thực = số mã hợp lệ / thời gian từ mã đầu → mã cuối
function sessionSpeed(s: SavedSession): string {
  const valid = s.codes.filter(c => c.valid)
  if (valid.length < 2) return '—'
  const secs = (Math.max(...valid.map(c => c.at)) - Math.min(...valid.map(c => c.at))) / 1000
  if (secs <= 0) return '—'
  return `${(valid.length / secs).toFixed(1)} mã/s`
}

export default function MultiScanTest() {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)

  const streamRef   = useRef<MediaStream | null>(null)
  const stoppedRef  = useRef(true)
  const pausedRef   = useRef(false)
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null)
  const readBarcodesRef = useRef<((img: ImageData, opts: object) => Promise<{ text: string; position: Record<'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft', { x: number; y: number }> }[]>) | null>(null)
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const codesRef    = useRef<Map<string, ScannedCode>>(new Map())
  const engineRef   = useRef<EngineKind>('wasm')
  const wasmWidthRef = useRef<number>(3840)
  const tryHarderRef = useRef<boolean>(false)
  const decodeEmaRef = useRef(0)
  const decodeMsAtRef = useRef(0)   // lần cập nhật state decodeMs gần nhất (throttle re-render)

  const [running, setRunning]   = useState(false)
  const [paused, setPaused]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [nativeAvail, setNativeAvail] = useState(false)
  const [engine, setEngine]     = useState<EngineKind>('wasm')
  // 2560 = mặc định (khớp WASM_WIDTH của luồng quét thật). Đo 21/08 trên lưới 15 mã: 3840 KHÔNG bắt
  // thêm mã nào so với 1600/2560 mà tốn gấp ~2,4× (85ms vs 36ms) ⇒ đừng lấy 3840 làm mặc định; nút
  // 3840 vẫn còn cho ca tem NHỎ Ở XA (nơi độ phân giải mới thực sự quyết định).
  const [wasmWidth, setWasmWidth] = useState(() => loadSettings().wasmWidth ?? 2560)
  // MẶC ĐỊNH BẬT (21/08) — mã vạch 1D gần như PHẢI có "quét kỹ", QR thì không. Đo thật trên lưới
  // 15 mã (12 barcode + 3 QR) trong CÙNG một khung: tắt → 6–8/15 mã, bật → 15/15; QR bắt đủ ở cả
  // hai chế độ. Đó là lý do user thấy "barcode bắt kém hơn QR" — không phải chậm CPU mà là TRƯỢT.
  // Giá: 1600px 16→36ms · 2560px 30→56ms · 3840px 55→85ms (vẫn 12–28 khung/s).
  const [tryHarder, setTryHarder] = useState(() => loadSettings().tryHarder ?? true)
  const [torchOn, setTorchOn]   = useState(false)
  const [torchAvail, setTorchAvail] = useState(false)
  const [zoomCap, setZoomCap]   = useState<{ min: number; max: number; step: number } | null>(null)
  const [zoomVal, setZoomVal]   = useState(1)
  const [ultraId, setUltraId]   = useState<string | null>(null)   // deviceId ống kính góc siêu rộng (nếu có)
  const [lens, setLens]         = useState<'wide' | 'ultra'>('wide')
  const [videoRes, setVideoRes] = useState('')
  const [decodeMs, setDecodeMs] = useState(0)
  const [, setVersion]          = useState(0)   // bump khi codes thay đổi → re-render list
  const [sessions, setSessions] = useState<SavedSession[]>(loadSessions)
  const [openSession, setOpenSession] = useState<string | null>(null)
  const sessionStartRef = useRef(0)
  const videoResRef     = useRef('')

  engineRef.current = engine
  wasmWidthRef.current = wasmWidth
  tryHarderRef.current = tryHarder

  // ── Vòng quét ────────────────────────────────────────────────────────────────
  async function detectFrame(video: HTMLVideoElement): Promise<{ text: string; points: { x: number; y: number }[] }[]> {
    if (engineRef.current === 'native' && detectorRef.current) {
      const found = await detectorRef.current.detect(video)
      return found.map(b => ({ text: b.rawValue, points: b.cornerPoints }))
    }
    // WASM: vẽ frame vào canvas (thu về wasmWidth nếu video lớn hơn) rồi decode
    const read = readBarcodesRef.current
    if (!read) return []
    const vw = video.videoWidth, vh = video.videoHeight
    if (!vw || !vh) return []
    const scale = Math.min(1, wasmWidthRef.current / vw)
    const cw = Math.round(vw * scale), ch = Math.round(vh * scale)
    let canvas = workCanvasRef.current
    if (!canvas) { canvas = document.createElement('canvas'); workCanvasRef.current = canvas }
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    ctx.drawImage(video, 0, 0, cw, ch)
    const img = ctx.getImageData(0, 0, cw, ch)
    const results = await read(img, {
      formats: [...ZXING_FORMATS], maxNumberOfSymbols: 64,
      tryHarder: tryHarderRef.current, tryRotate: true, minLineCount: ZXING_MIN_LINE_COUNT,
    })
    // Đưa tọa độ về hệ pixel của video gốc
    const inv = 1 / scale
    return results.map(r => ({
      text: r.text,
      points: [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft]
        .map(p => ({ x: p.x * inv, y: p.y * inv })),
    }))
  }

  function processResults(found: { text: string; points: { x: number; y: number }[] }[]): FrameBox[] {
    const boxes: FrameBox[] = []
    let anyNew = false, anyInvalid = false
    const now = Date.now()
    // Gom mã: khoá chuẩn hoá (1 tem không thành 2 dòng) — CHỈ gom + đếm, KHÔNG tự xoá dòng nào
    // (đã thử đoán bản-đọc-sai theo vị trí và làm MẤT MÃ THẬT 2 lần — xem đầu utils/scanDedupe).
    // Logic thuần nằm ở utils/scanDedupe (gói QA 30 kiểm bằng chuỗi khung mô phỏng).
    const entries = found.map(f => registerHit(codesRef.current, { text: f.text, points: f.points, now }).entry)

    for (const [i, f] of found.entries()) {
      const entry = entries[i]
      const need = entry.valid ? 1 : INVALID_MIN_HITS    // hợp lệ: nhận ngay · 1D: cần MIN_HITS_1D lần
      const confirmed = entry.hits >= need
      const justConfirmed = entry.hits === need           // frame vừa chốt
      if (justConfirmed) {
        if (entry.valid) anyNew = true; else anyInvalid = true
      }
      // Sai định dạng chưa đủ hits → khung 'pending' (vàng), chưa kêu bíp, chưa tính
      const kind: FrameBox['kind'] = !confirmed
        ? 'pending'
        : entry.valid ? (justConfirmed ? 'new' : 'dup') : 'invalid'
      boxes.push({ points: f.points, kind })
    }
    if (anyNew) {
      playBeep()
      try { navigator.vibrate?.(40) } catch {}
      setVersion(v => v + 1)
    } else if (anyInvalid) {
      playBeep(280, 0.18)
      setVersion(v => v + 1)
    }
    return boxes
  }

  // Vẽ khung lên overlay — map tọa độ video → element (video dùng object-contain: hiện TRỌN khung)
  function drawOverlay(boxes: FrameBox[]) {
    const canvas = overlayRef.current, video = videoRef.current, wrap = wrapRef.current
    if (!canvas || !video || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(rect.width * dpr), H = Math.round(rect.height * dpr)
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    const vw = video.videoWidth, vh = video.videoHeight
    if (!vw || !vh) return
    const scale = Math.min(W / vw, H / vh)     // object-contain (khớp preview hiện trọn khung)
    const offX = (W - vw * scale) / 2
    const offY = (H - vh * scale) / 2
    const COLORS: Record<FrameBox['kind'], string> = {
      new: '#22c55e', dup: '#94a3b8', invalid: '#ef4444', pending: '#f59e0b',
    }
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

  async function loop() {
    const video = videoRef.current
    if (stoppedRef.current || !video) return
    if (pausedRef.current || video.readyState < 2 || document.hidden) {
      setTimeout(loop, 150)
      return
    }
    const t0 = performance.now()
    try {
      const found = await detectFrame(video)
      const ms = performance.now() - t0
      decodeEmaRef.current = decodeEmaRef.current === 0 ? ms : decodeEmaRef.current * 0.8 + ms * 0.2
      // Throttle 500ms — setState mỗi khung (native ~20fps) re-render CẢ trang mỗi khung (kèm sort
      // danh sách mã) → tốn CPU/pin vô ích; số hiển thị 2 lần/s là đủ mượt
      if (t0 - decodeMsAtRef.current > 500) {
        decodeMsAtRef.current = t0
        setDecodeMs(Math.round(decodeEmaRef.current))
      }
      drawOverlay(processResults(found))
    } catch {
      // frame lỗi lẻ (vd video chưa sẵn sàng) — bỏ qua, quét tiếp
    }
    if (!stoppedRef.current) setTimeout(loop, engineRef.current === 'native' ? 50 : 15)
  }

  // ── Mở / đóng camera ─────────────────────────────────────────────────────────
  async function start() {
    setError(null)
    unlockAudio()
    try {
      // Chọn engine: ưu tiên native nếu hỗ trợ QR
      let native = false
      if (window.BarcodeDetector) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats()
          if (supported.includes('qr_code')) {
            const formats = NATIVE_FORMATS.filter(f => supported.includes(f))
            detectorRef.current = new window.BarcodeDetector({ formats: [...formats] })
            native = true
          }
        } catch {}
      }
      setNativeAvail(native)
      if (!native) {
        await loadWasm()
        setEngine('wasm')
      } else {
        setEngine('native')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
      })
      await attachStream(stream)
      if (!sessionStartRef.current) sessionStartRef.current = Date.now()
      setLens('wide')

      // Dò ống kính góc siêu rộng (nhãn chỉ có sau khi đã cấp quyền camera)
      let ultraDevId: string | null = null
      try {
        const devs = await navigator.mediaDevices.enumerateDevices()
        const ultra = devs.find(d => d.kind === 'videoinput' && /ultra|siêu r|góc r|0\.5|wide angle/i.test(d.label))
        ultraDevId = ultra?.deviceId ?? null
        setUltraId(ultraDevId)
      } catch { /* enumerate lỗi — ẩn nút góc rộng */ }

      // Khôi phục setup lần trước (ống kính + zoom)
      const st = loadSettings()
      if (st.lens === 'ultra' && ultraDevId) await switchLens('ultra', ultraDevId)
      if (typeof st.zoom === 'number') setZoom(st.zoom)

      stoppedRef.current = false
      pausedRef.current = false
      setRunning(true)
      setPaused(false)
      loop()
    } catch {
      setError('Không thể mở camera. Kiểm tra quyền truy cập camera.')
    }
  }

  // Gắn stream vào video + đọc lại độ phân giải + khả năng torch/zoom (dùng cho start & switchLens)
  async function attachStream(stream: MediaStream) {
    streamRef.current = stream
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    await new Promise<void>(resolve => {
      if (video.readyState >= 1) { resolve(); return }
      video.onloadedmetadata = () => resolve()
    })
    await video.play()
    setVideoRes(`${video.videoWidth}×${video.videoHeight}`)
    videoResRef.current = `${video.videoWidth}×${video.videoHeight}`
    const track = stream.getVideoTracks()[0]
    const caps = (track.getCapabilities?.() ?? {}) as ExtCapabilities
    setTorchAvail(!!caps.torch)
    setTorchOn(false)
    if (caps.zoom && caps.zoom.max > caps.zoom.min) { setZoomCap(caps.zoom); setZoomVal(caps.zoom.min) }
    else setZoomCap(null)
  }

  // Đổi ống kính: 'wide' = ống chính (1×) · 'ultra' = góc siêu rộng (0.5×, bao trùm hơn nhưng QR nhỏ đi)
  async function switchLens(target: 'wide' | 'ultra', forcedUltraId?: string) {
    const uid = forcedUltraId ?? ultraId
    try {
      streamRef.current?.getTracks().forEach(t => t.stop())
      const video: MediaTrackConstraints = target === 'ultra' && uid
        ? { deviceId: { exact: uid }, width: { ideal: 3840 }, height: { ideal: 2160 } }
        : { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } }
      const stream = await navigator.mediaDevices.getUserMedia({ video })
      await attachStream(stream)
      setLens(target)
      saveSettings({ lens: target })
    } catch {
      setError('Không đổi được ống kính, thử lại.')
    }
  }

  async function loadWasm() {
    if (readBarcodesRef.current) return
    const [{ prepareZXingModule, readBarcodes }, wasmUrl] = await Promise.all([
      import('zxing-wasm/reader'),
      import('zxing-wasm/reader/zxing_reader.wasm?url').then(m => m.default),
    ])
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? wasmUrl : prefix + path,
      },
    })
    readBarcodesRef.current = readBarcodes
  }

  // Chốt phiên: lưu vào lịch sử nếu có ít nhất 1 mã (gọi khi Dừng camera / rời trang)
  function endSession() {

    const codes = Array.from(codesRef.current.values()).filter(c => c.valid || c.hits >= INVALID_MIN_HITS)
    if (!sessionStartRef.current || codes.length === 0) { sessionStartRef.current = 0; return }
    const s: SavedSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      started_at: sessionStartRef.current,
      ended_at: Date.now(),
      engine: engineRef.current,
      video_res: videoResRef.current,
      wasm_width: wasmWidthRef.current,
      decode_ms: Math.round(decodeEmaRef.current),
      device: navigator.userAgent,
      codes,
    }
    const next = [s, ...loadSessions()].slice(0, SESSIONS_MAX)
    persistSessions(next)
    setSessions(next)
    sessionStartRef.current = 0
  }
  const endSessionRef = useRef(endSession)
  endSessionRef.current = endSession

  function stop() {
    endSession()                        // Dừng = LƯU phiên vào lịch sử…
    codesRef.current.clear()            // …rồi XÓA dữ liệu lần quét này (sẵn sàng pallet kế tiếp)
    decodeEmaRef.current = 0
    setVersion(v => v + 1)
    stoppedRef.current = true
    setRunning(false)
    setPaused(false)
    setTorchOn(false)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
    const ctx = overlayRef.current?.getContext('2d')
    if (ctx && overlayRef.current) ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
  }

  useEffect(() => () => {
    endSessionRef.current()   // rời trang khi đang quét → vẫn chốt phiên
    stoppedRef.current = true
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  async function switchEngine(next: EngineKind) {
    if (next === 'wasm') await loadWasm()
    decodeEmaRef.current = 0
    setEngine(next)
  }

  function applyTrack(set: ExtConstraintSet) {
    const track = streamRef.current?.getVideoTracks()[0]
    track?.applyConstraints({ advanced: [set as MediaTrackConstraintSet] }).catch(() => {})
  }

  function toggleTorch() {
    const next = !torchOn
    setTorchOn(next)
    applyTrack({ torch: next })
  }

  function setZoom(z: number) {
    // đọc capabilities trực tiếp từ track (state zoomCap có thể chưa kịp cập nhật ngay sau đổi ống kính)
    const track = streamRef.current?.getVideoTracks()[0]
    const caps = (track?.getCapabilities?.() ?? {}) as ExtCapabilities
    if (!track || !caps.zoom) return
    const v = Math.max(caps.zoom.min, Math.min(caps.zoom.max, z))
    setZoomVal(v)
    track.applyConstraints({ advanced: [{ zoom: v } as MediaTrackConstraintSet] }).catch(() => {})
    saveSettings({ zoom: v })
  }

  // Hợp lệ hiện ngay; sai định dạng phải đủ INVALID_MIN_HITS (ẩn bóng ma hits=1)
  const codes = Array.from(codesRef.current.values()).filter(c => c.valid || c.hits >= INVALID_MIN_HITS).sort((a, b) => b.at - a.at)
  const validCount = codes.filter(c => c.valid).length
  const invalidCount = codes.length - validCount

  function removeCode(text: string) {
    codesRef.current.delete(text)
    setVersion(v => v + 1)
  }
  function clearAll() {
    codesRef.current.clear()
    setVersion(v => v + 1)
  }
  function copyAll() {
    const txt = codes.filter(c => c.valid).map(c => c.text).join('\n')
    navigator.clipboard?.writeText(txt).catch(() => {})
  }

  function deleteSession(id: string) {
    const next = loadSessions().filter(s => s.id !== id)
    persistSessions(next)
    setSessions(next)
  }
  function copySessionJson(s: SavedSession) {
    navigator.clipboard?.writeText(JSON.stringify(s, null, 2)).catch(() => {})
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl flex items-center gap-2 flex-wrap">
          <h1 className="text-sm font-semibold text-slate-800">Quét loạt QR (thử nghiệm)</h1>
          <span className="hidden sm:inline text-[10px] text-slate-400">không ghi dữ liệu — chỉ để test tốc độ trên thiết bị thật</span>
          <div className="ml-auto flex items-center gap-1.5">
            {running ? (
              <>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs !min-h-0"
                  onClick={() => {
                    const p = !paused; setPaused(p); pausedRef.current = p
                    // Tạm dừng thì tắt đèn pin — đèn sáng lúc không quét chỉ tốn pin (bật lại khi cần)
                    if (p && torchOn) { setTorchOn(false); applyTrack({ torch: false }) }
                  }}>
                  {paused ? <><Play className="h-3.5 w-3.5 mr-1" />Tiếp tục</> : <><Pause className="h-3.5 w-3.5 mr-1" />Tạm dừng</>}
                </Button>
                <Button size="sm" variant="destructive" className="h-7 px-2 text-xs !min-h-0" onClick={stop}>Dừng camera</Button>
              </>
            ) : (
              <Button size="sm" className="h-7 px-3 text-xs !min-h-0 bg-blue-600 hover:bg-blue-700" onClick={start}>
                <Play className="h-3.5 w-3.5 mr-1" />Bắt đầu quét
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <div className="flex flex-col lg:flex-row gap-3 p-2 sm:p-3">
            {/* Camera + overlay */}
            <div className="lg:w-[55%] shrink-0">
              {/* mobile: cao tối đa 48vh (khỏi chiếm hết màn) · sm+: khung 4/3 · lg: dọc 3/4 */}
              <div ref={wrapRef} className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 h-[48vh] sm:h-auto sm:aspect-[4/3] lg:aspect-[3/4]">
                <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline muted />
                <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />

                {/* Bộ đếm lớn */}
                <div className="absolute top-2 left-2 rounded-lg bg-black/60 text-white px-3 py-1.5 pointer-events-none">
                  <span className="text-2xl font-bold tabular-nums">{validCount}</span>
                  <span className="text-xs text-slate-300 ml-1">mã hợp lệ</span>
                  {invalidCount > 0 && <span className="text-xs text-red-300 ml-2">{invalidCount} sai định dạng</span>}
                </div>

                {/* Torch + zoom quang học (nếu máy hỗ trợ) */}
                {running && (
                  <div className="absolute bottom-2 right-2 flex flex-col gap-1.5 items-center">
                    {ultraId && (
                      <button onClick={() => switchLens(lens === 'wide' ? 'ultra' : 'wide')}
                        className="bg-black/40 text-white rounded-full px-2.5 py-2 text-xs font-bold hover:bg-black/60 min-w-[40px]">
                        {lens === 'wide' ? '0.5×' : '1×'}
                      </button>
                    )}
                    {torchAvail && (
                      <button onClick={toggleTorch} className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60">
                        {torchOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
                      </button>
                    )}
                    {zoomCap && (
                      <>
                        <button onClick={() => setZoom(zoomVal + (zoomCap.step || 0.5))} className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60">
                          <ZoomIn className="h-4 w-4" />
                        </button>
                        <button onClick={() => setZoom(zoomVal - (zoomCap.step || 0.5))} className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60">
                          <ZoomOut className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                )}

                {paused && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none">
                    <span className="text-white font-semibold">Đang tạm dừng</span>
                  </div>
                )}
                {!running && !error && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-slate-400 text-sm">Bấm "Bắt đầu quét" để mở camera</span>
                  </div>
                )}
                {error && (
                  <div className="absolute inset-0 bg-slate-900 flex items-center justify-center p-4">
                    <p className="text-red-300 text-xs text-center">{error}</p>
                  </div>
                )}
              </div>

              {/* Thông số đo — để so sánh giữa các máy */}
              <div className="mt-2 flex items-center gap-2 flex-wrap text-[10px] text-slate-500">
                {running && (
                  <>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">
                      Engine: <strong>{engine === 'native' ? 'Native (BarcodeDetector)' : 'WASM (zxing)'}</strong>
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">Camera: {videoRes}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">Decode: {decodeMs}ms/khung</span>
                    {nativeAvail && (
                      <button onClick={() => switchEngine(engine === 'native' ? 'wasm' : 'native')}
                        className="rounded border border-slate-300 px-1.5 py-0.5 hover:bg-slate-50">
                        Thử engine {engine === 'native' ? 'WASM' : 'Native'}
                      </button>
                    )}
                    {engine === 'wasm' && (
                      <span className="flex items-center gap-1">
                        Độ phân giải xử lý:
                        {WASM_WIDTHS.map(w => (
                          <button key={w} onClick={() => { setWasmWidth(w); saveSettings({ wasmWidth: w }); decodeEmaRef.current = 0 }}
                            className={`rounded px-1.5 py-0.5 border ${wasmWidth === w ? 'border-sky-500 bg-sky-50 text-sky-700 font-semibold' : 'border-slate-300 hover:bg-slate-50'}`}>
                            {w === 3840 ? 'Gốc' : `${w}p`}
                          </button>
                        ))}
                      </span>
                    )}
                    {engine === 'wasm' && (
                      <button onClick={() => { const v = !tryHarder; setTryHarder(v); saveSettings({ tryHarder: v }); decodeEmaRef.current = 0 }}
                        className={`rounded px-1.5 py-0.5 border ${tryHarder ? 'border-amber-500 bg-amber-50 text-amber-700 font-semibold' : 'border-slate-300 hover:bg-slate-50'}`}>
                        Quét kỹ (cần cho mã vạch){tryHarder ? ' ✓' : ''}
                      </button>
                    )}
                  </>
                )}
              </div>
              {/* mobile: chú thích ngắn gọn 1 dòng, đỡ chiếm chỗ */}
              <p className="mt-1 sm:hidden text-[10px] text-slate-400 leading-snug">
                <span className="text-green-600 font-semibold">Xanh</span>=nhận · <span className="text-red-600 font-semibold">đỏ</span>=sai định dạng · <span className="text-amber-600 font-semibold">vàng</span>=đang xác nhận. Để độ phân giải <strong>Gốc</strong> + <strong>Quét kỹ</strong> nếu tem xa/mờ.
              </p>
              <p className="mt-1 hidden sm:block text-[10px] text-slate-400 leading-snug">
                Khung <span className="text-green-600 font-semibold">xanh</span> = mã hợp lệ (nhận NGAY lần đầu) ·
                <span className="text-slate-500 font-semibold"> xám</span> = đã quét (bỏ qua) ·
                <span className="text-amber-600 font-semibold"> vàng</span> = mã lạ đang xác nhận ·
                <span className="text-red-600 font-semibold"> đỏ</span> = sai định dạng (phải thấy ≥{INVALID_MIN_HITS} lần → loại "bóng ma" giải rác 1 frame).
                <br />Mã 2cm: đưa cách ~20–60cm; để độ phân giải xử lý ở <strong>Gốc</strong> để quét xa nhất; bật <strong>Quét kỹ</strong> nếu tem xa/mờ (chậm hơn). Nút <strong>0.5×</strong> mở ống góc siêu rộng (bao trùm hơn nhưng QR nhỏ đi). Preview hiện TRỌN khung camera = đúng vùng đang quét.
              </p>
            </div>

            {/* Danh sách mã đã quét */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-xs font-semibold text-slate-700">Đã quét ({codes.length})</p>
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] !min-h-0" onClick={copyAll} disabled={validCount === 0}>
                    <Copy className="h-3 w-3 mr-1" />Copy mã hợp lệ
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] !min-h-0 text-red-600" onClick={clearAll} disabled={codes.length === 0}>
                    <Trash2 className="h-3 w-3 mr-1" />Xóa hết
                  </Button>
                </div>
              </div>
              {codes.length === 0 ? (
                <p className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg p-6 text-center">
                  Chưa có mã nào — mở camera và đưa vào vùng có QR
                </p>
              ) : (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-[40vh] sm:max-h-[60vh] overflow-auto">
                  {codes.map(c => (
                    <div key={c.text} className="flex items-center gap-2 px-2 py-1">
                      <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${c.valid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {c.valid ? '✓' : '✗'}
                      </span>
                      <span className="font-mono text-[10px] font-semibold text-slate-700 truncate">{c.text}</span>
                      {/* Dòng 1D còn ÍT lần thấy = chưa chắc (có thể là bản đọc sai chưa bị dọn) →
                          hiện vàng để soi ngay lúc quét, khỏi phải chờ tới lúc lưu mới biết. */}
                      {!c.valid && c.hits < WEAK_HITS && (
                        <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">chưa chắc</span>
                      )}
                      <span className={`ml-auto shrink-0 text-[9px] tabular-nums ${!c.valid && c.hits < WEAK_HITS ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>
                        {new Date(c.at).toLocaleTimeString('vi-VN')} · {c.hits}×
                      </span>
                      <button onClick={() => removeCode(c.text)} className="shrink-0 text-slate-400 hover:text-red-600 p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Lịch sử phiên quét — lưu trên máy này (localStorage), chốt khi Dừng camera / rời trang */}
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-700 mb-1.5">
                  Phiên đã lưu ({sessions.length})
                  <span className="ml-1 font-normal text-[10px] text-slate-400">— lưu trên máy này, giữ {SESSIONS_MAX} phiên gần nhất</span>
                </p>
                {sessions.length === 0 ? (
                  <p className="text-[10px] text-slate-400">Chưa có phiên nào — phiên được chốt khi bấm "Dừng camera" (có ít nhất 1 mã).</p>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {sessions.map(s => {
                      const valid = s.codes.filter(c => c.valid).length
                      const invalid = s.codes.length - valid
                      const durS = Math.max(1, Math.round((s.ended_at - s.started_at) / 1000))
                      const isOpen = openSession === s.id
                      return (
                        <div key={s.id}>
                          <div className="flex items-center gap-2 px-2 py-1.5 flex-wrap">
                            <button onClick={() => setOpenSession(isOpen ? null : s.id)}
                              className="text-[10px] font-semibold text-sky-700 hover:underline shrink-0">
                              {new Date(s.started_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </button>
                            <span className="text-[10px] text-slate-500">{durS}s · {s.engine === 'native' ? 'Native' : `WASM ${s.wasm_width}p`} · {s.video_res}</span>
                            <span className="text-[10px] font-semibold text-green-700 tabular-nums">{valid} ✓</span>
                            {invalid > 0 && <span className="text-[10px] font-semibold text-red-600 tabular-nums">{invalid} ✗</span>}
                            <span className="text-[10px] text-slate-500">{sessionSpeed(s)} · decode {s.decode_ms}ms</span>
                            <div className="ml-auto flex gap-1 shrink-0">
                              <Button size="sm" variant="outline" className="h-5 px-1.5 text-[9px] !min-h-0" onClick={() => copySessionJson(s)}>
                                <Copy className="h-2.5 w-2.5 mr-0.5" />JSON
                              </Button>
                              <button onClick={() => deleteSession(s.id)} className="text-slate-400 hover:text-red-600 p-0.5">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          {isOpen && (
                            <div className="px-2 pb-1.5 max-h-48 overflow-auto">
                              {[...s.codes].sort((a, b) => a.at - b.at).map(c => (
                                <div key={c.text} className="flex items-center gap-2 py-0.5">
                                  <span className={`shrink-0 text-[9px] px-1 rounded-full font-semibold ${c.valid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {c.valid ? '✓' : '✗'}
                                  </span>
                                  <span className="font-mono text-[9px] text-slate-600 truncate">{c.text}</span>
                                  <span className="ml-auto shrink-0 text-[9px] text-slate-400 tabular-nums">
                                    {new Date(c.at).toLocaleTimeString('vi-VN')} · {c.hits}×
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
