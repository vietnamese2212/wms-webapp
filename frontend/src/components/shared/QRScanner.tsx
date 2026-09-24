import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Flashlight, FlashlightOff, Minus, Plus } from 'lucide-react'
import { isValidTem } from '@/utils/qr'
import { createScanEngine, drawBoxes, type Box, type ScanEngine, type ScanHit, type ExtCapabilities, type ScanCodeTypes } from '@/utils/scanEngine'

interface QRScannerProps {
  onScan: (value: string) => void
  onClose: () => void
  // fill=true: camera lấp đầy chiều cao parent (dùng trong sheet quét 1-màn flex, không cuộn).
  // fill=false (mặc định): khung aspect-4/3 độc lập (dialog/khối inline như Stocktake, SearchInput…).
  fill?: boolean
  // active=false: TẮT HẲN stream camera (đèn camera tắt) — bắt buộc truyền `active={open}` khi parent
  // giữ scanner mount + ẩn bằng CSS (overlay keep-mounted); không thì camera chạy ngầm sau khi user đóng
  // (user bắt 05/08 ở màn quét Fill). Mở lại KHÔNG hỏi quyền lại — trình duyệt đã nhớ quyền.
  active?: boolean
  // stopOnScan=true: bắt được mã → chụp khung hình cuối làm ảnh đóng băng rồi TẮT HẲN camera
  // (đèn tắt, 0 pin) — cho flow KHÔNG auto-resume (Fill: hạ pallet xong còn chạy xe nâng).
  // resume() tự bật lại camera (~0,5s). Flow auto-resume 1,5s (Xuất/Nhập) ĐỪNG bật cờ này —
  // tắt/bật mỗi lượt quét liên tục chỉ thêm trễ.
  stopOnScan?: boolean
  // Loại mã camera được giải, theo cấu hình KHO của nghiệp vụ đang quét (hook useScanCodeTypes).
  // BẮT BUỘC khai (không có giá trị mặc định) — màn quét mới mà quên thì phải là LỖI BIÊN DỊCH,
  // chứ không âm thầm giải cả mã vạch ở kho chỉ dùng tem QR (đúng kiểu lọt của bug 21/08).
  codeTypes: ScanCodeTypes
}

export interface QRScannerHandle {
  resume: () => void
}

// Bắt QR bằng BarcodeDetector native → fallback zxing-wasm (utils/scanEngine) + vẽ khung màu lên đúng QR:
//   XANH = tem hợp lệ (nhận NGAY) · VÀNG = mã lạ đang xác nhận · ĐỎ = không phải tem (đã xác nhận, vẫn nhận).
// Giữ nguyên interface (onScan/onClose/resume) → mọi màn quét đơn dùng chung không phải sửa.
// Confirm-flow (Nhập): quét → onScan → parent hiện preview, gọi resume() cho lần kế. Instant-flow (Xuất): onScan → API.
// KHÔNG phát bíp ở đây — parent tự bíp trong onScan (tránh bíp đôi).
export const QRScanner = forwardRef<QRScannerHandle, QRScannerProps>(
  function QRScanner({ onScan, fill, active = true, stopOnScan = false, codeTypes }, ref) {
    const videoRef   = useRef<HTMLVideoElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)
    const freezeRef  = useRef<HTMLCanvasElement>(null)   // ảnh chụp khung cuối khi stopOnScan tắt camera
    const wrapRef    = useRef<HTMLDivElement>(null)

    const streamRef  = useRef<MediaStream | null>(null)
    const engineRef  = useRef<ScanEngine | null>(null)
    const stoppedRef = useRef(false)
    const pausedRef  = useRef(false)
    const busyRef    = useRef(false)
    const codeTypesRef = useRef(codeTypes)
    codeTypesRef.current = codeTypes                 // vòng quét đọc giá trị mới nhất
    const settingUpRef = useRef(false)                   // đang getUserMedia — resume() đừng bump epoch trùng
    const pendingRef = useRef<{ text: string; hits: number } | null>(null)   // mã lạ: cần thấy 2 lần mới nhận (lọc "bóng ma")
    const [epoch, setEpoch] = useState(0)                // bump = mở lại camera sau khi stopOnScan đã tắt

    const [error, setError]         = useState<string | null>(null)
    const [torchOn, setTorchOn]     = useState(false)
    const [torchAvail, setTorchAvail] = useState(false)
    const [zoomCap, setZoomCap]     = useState<{ min: number; max: number; step: number } | null>(null)
    const [zoomVal, setZoomVal]     = useState(1)

    const pinchStartDist = useRef<number | null>(null)
    const pinchStartZoom = useRef(1)

    // resume(): xóa trạng thái xác nhận + phát lại video (bỏ đóng băng) + chạy tiếp vòng quét.
    // stopOnScan đã tắt camera → bump epoch để effect mở lại stream (không hỏi quyền lại).
    useImperativeHandle(ref, () => ({
      resume: () => {
        pendingRef.current = null
        pausedRef.current = false
        const fz = freezeRef.current
        if (fz) fz.style.display = 'none'
        if (!streamRef.current && !settingUpRef.current) { setEpoch(e => e + 1); return }
        videoRef.current?.play().catch(() => {})
      },
    }))

    // Nhận 1 mã → ĐÓNG BĂNG khung hình (video.pause) + tạm dừng loop (parent gọi resume() cho lần kế).
    // Đóng băng để thấy rõ "đã lấy tem này" + đỡ tốn pin (camera chạy tiếp lúc này vô ích). Không bíp (parent tự bíp).
    // stopOnScan: chụp khung cuối ra canvas rồi TẮT HẲN track (đèn camera tắt, 0 pin) — vẫn giữ
    // srcObject để drawBoxes vẽ được khung xanh của chính khung hình này (videoWidth còn nguyên).
    function handoff(text: string) {
      if (pausedRef.current) return
      pausedRef.current = true
      videoRef.current?.pause()
      if (stopOnScan) {
        const v = videoRef.current, fz = freezeRef.current
        if (v && fz && v.videoWidth) {
          fz.width = v.videoWidth; fz.height = v.videoHeight
          fz.getContext('2d')?.drawImage(v, 0, 0)
          fz.style.display = 'block'   // ảnh tĩnh thế chỗ — video có thể đen trên iOS khi track dừng
        }
        stoppedRef.current = true      // vòng quét không tự lên lịch lại — resume() dựng phiên mới
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        setTorchOn(false)
      }
      onScan(text)
    }

    // Xử lý kết quả 1 khung → khung màu + quyết định nhận. Tem hợp lệ: nhận NGAY. Mã lạ: phải thấy 2 lần (vàng→đỏ).
    // Khi ĐÃ nhận (handoff) → chỉ trả ĐÚNG 1 khung của tem được lấy → đóng băng đúng vị trí đó (không vẽ tem khác).
    function process(hits: ScanHit[]): Box[] {
      const valid = hits.find(h => isValidTem(h.text))
      if (valid) {
        pendingRef.current = null
        handoff(valid.text)
        return [{ points: valid.points, kind: 'valid' }]
      }
      const boxes: Box[] = []
      let taken: ScanHit | null = null
      for (const h of hits) {
        const pend = pendingRef.current
        const next = (pend && pend.text === h.text) ? { text: h.text, hits: pend.hits + 1 } : { text: h.text, hits: 1 }
        pendingRef.current = next
        const confirmed = next.hits >= 2
        boxes.push({ points: h.points, kind: confirmed ? 'invalid' : 'pending' })
        if (confirmed && !taken) taken = h
      }
      if (taken) { handoff(taken.text); return [{ points: taken.points, kind: 'invalid' }] }   // "vẫn nhận" — parent/API báo lỗi
      return boxes   // chưa bắt: hiện vàng cho các mã đang xác nhận
    }

    // Chặn cuộn trang khi pinch-zoom
    useEffect(() => {
      const el = wrapRef.current
      if (!el) return
      const block = (e: TouchEvent) => { if (e.touches.length >= 2) e.preventDefault() }
      el.addEventListener('touchmove', block, { passive: false })
      return () => el.removeEventListener('touchmove', block)
    }, [])

    useEffect(() => {
      if (!active) return          // đóng overlay → cleanup của lần active trước đã dừng track, không mở lại
      let destroyed = false

      async function loop() {
        const video = videoRef.current, engine = engineRef.current
        if (stoppedRef.current || !video || !engine) return
        // Pause / chưa sẵn sàng / tab ẩn → idle-poll 100ms (giữ khung cũ đóng băng, resume() bắt được ngay)
        if (pausedRef.current || video.readyState < 2 || document.hidden) { window.setTimeout(loop, 100); return }
        if (!busyRef.current) {
          busyRef.current = true
          try {
            const hits = await engine.detect(video)
            const boxes = process(hits)   // process() có thể set paused=true (vừa bắt được) — vẫn PHẢI vẽ khung của khung hình này
            const ov = overlayRef.current, wr = wrapRef.current
            if (ov && wr) drawBoxes(ov, video, wr, boxes, 'cover')   // 'cover' khớp video object-cover; bắt hợp lệ → vẽ khung xanh rồi ĐÓNG BĂNG
          } catch { /* khung lỗi lẻ (video chưa sẵn sàng) — bỏ qua */ }
          finally { busyRef.current = false }
        }
        if (!stoppedRef.current) window.setTimeout(loop, engine.kind === 'native' ? 50 : 15)
      }

      async function setup() {
        const video = videoRef.current
        if (!video) return
        settingUpRef.current = true
        try {
          const engine = await createScanEngine(codeTypesRef.current)
          if (destroyed) return
          engineRef.current = engine

          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
          })
          if (destroyed) { stream.getTracks().forEach(t => t.stop()); return }
          streamRef.current = stream
          video.srcObject = stream
          await new Promise<void>(resolve => {
            if (video.readyState >= 1) { resolve(); return }
            video.onloadedmetadata = () => resolve()
          })
          await video.play()

          const track = stream.getVideoTracks()[0]
          const caps = (track.getCapabilities?.() ?? {}) as ExtCapabilities
          setTorchAvail(!!caps.torch)
          if (caps.zoom && caps.zoom.max > caps.zoom.min) { setZoomCap(caps.zoom); setZoomVal(caps.zoom.min) }

          stoppedRef.current = false
          pausedRef.current = false
          const fz = freezeRef.current
          if (fz) fz.style.display = 'none'
          loop()
        } catch {
          setError('Không thể mở camera. Kiểm tra quyền truy cập camera.')
        } finally {
          settingUpRef.current = false
        }
      }

      setup()
      return () => {
        destroyed = true
        stoppedRef.current = true
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        const v = videoRef.current
        if (v) v.srcObject = null
        setTorchOn(false)          // track mới luôn mở với đèn pin tắt — icon phải khớp
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, epoch, codeTypes])

    function applyZoom(raw: number) {
      const track = streamRef.current?.getVideoTracks()[0]
      const caps = (track?.getCapabilities?.() ?? {}) as ExtCapabilities
      if (!track || !caps.zoom) return
      const v = Math.max(caps.zoom.min, Math.min(caps.zoom.max, Math.round(raw * 10) / 10))
      setZoomVal(v)
      track.applyConstraints({ advanced: [{ zoom: v } as MediaTrackConstraintSet] }).catch(() => {})
    }

    function toggleTorch() {
      const track = streamRef.current?.getVideoTracks()[0]
      if (!track) return
      const next = !torchOn
      setTorchOn(next)
      track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }).catch(() => {})
    }

    const zoomStep = zoomCap?.step || 0.5

    function handleTouchStart(e: React.TouchEvent) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        pinchStartDist.current = Math.sqrt(dx * dx + dy * dy)
        pinchStartZoom.current = zoomVal
      }
    }
    function handleTouchMove(e: React.TouchEvent) {
      if (e.touches.length !== 2 || pinchStartDist.current === null) return
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      applyZoom(pinchStartZoom.current * (dist / pinchStartDist.current))
    }
    function handleTouchEnd(e: React.TouchEvent) {
      if (e.touches.length < 2) pinchStartDist.current = null
    }

    return (
      <div className={fill ? 'flex flex-col h-full min-h-0' : 'flex flex-col gap-3'}>
        <div
          ref={wrapRef}
          className={`relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 ${fill ? 'flex-1 min-h-0' : 'aspect-[4/3]'}`}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
          {/* Ảnh khung cuối khi stopOnScan tắt camera — cùng object-cover nên trùng khít với video */}
          <canvas ref={freezeRef} className="absolute inset-0 w-full h-full object-cover" style={{ display: 'none' }} />
          <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />

          {error && (
            <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-2 p-4">
              <p className="text-slate-300 text-xs text-center">{error}</p>
            </div>
          )}

          {zoomCap && zoomVal > zoomCap.min && (
            <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] font-semibold rounded px-1.5 py-0.5 pointer-events-none">
              {zoomVal.toFixed(1)}×
            </div>
          )}

          <div className="absolute bottom-2 right-2 flex flex-col gap-1.5 items-center">
            {torchAvail && (
              <button onClick={toggleTorch} className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60">
                {torchOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
              </button>
            )}
            {zoomCap && (
              <>
                <button onClick={() => applyZoom(zoomVal + zoomStep)} disabled={zoomVal >= zoomCap.max}
                  className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60 disabled:opacity-30">
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => applyZoom(zoomVal - zoomStep)} disabled={zoomVal <= zoomCap.min}
                  className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60 disabled:opacity-30">
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }
)
