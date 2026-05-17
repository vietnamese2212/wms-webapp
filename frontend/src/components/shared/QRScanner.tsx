import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import { Minus, Plus, X } from 'lucide-react'

interface QRScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

export interface QRScannerHandle {
  resume: () => void
}

const MIN_ZOOM  = 1
const MAX_ZOOM  = 4
const SCAN_FPS  = 15
const ZOOM_KEY  = 'qr_scanner_zoom'

function loadZoom(): number {
  try {
    const v = parseFloat(sessionStorage.getItem(ZOOM_KEY) ?? '')
    if (isFinite(v) && v >= MIN_ZOOM) return Math.min(MAX_ZOOM, v)
  } catch {}
  return 1
}

export const QRScanner = forwardRef<QRScannerHandle, QRScannerProps>(
  function QRScanner({ onScan, onClose }, ref) {
    const videoRef     = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const rafRef       = useRef<number | null>(null)
    const scanBusyRef  = useRef(false)
    const pausedRef    = useRef(false)
    const zoomRef      = useRef(loadZoom())
    const lastScanRef  = useRef(0)
    const [zoom, setZoom]   = useState(loadZoom)
    const [error, setError] = useState<string | null>(null)

    const pinchStartDist = useRef<number | null>(null)
    const pinchStartZoom = useRef(1)

    useImperativeHandle(ref, () => ({
      resume: () => { pausedRef.current = false },
    }))

    function updateZoom(raw: number) {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(raw * 10) / 10))
      zoomRef.current = z
      setZoom(z)
      try { sessionStorage.setItem(ZOOM_KEY, String(z)) } catch {}
    }

    // Block native page-scroll while pinching inside the scanner box
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      const block = (e: TouchEvent) => { if (e.touches.length >= 2) e.preventDefault() }
      el.addEventListener('touchmove', block, { passive: false })
      return () => el.removeEventListener('touchmove', block)
    }, [])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      // Off-screen canvas: each frame we draw a cropped+upscaled center region.
      // This gives the QR decoder more pixels on the QR code — same as iPhone digital zoom.
      const canvas = document.createElement('canvas')
      const ctx    = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      const interval = 1000 / SCAN_FPS
      let stream: MediaStream | null = null

      async function setup() {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
          })
          video.srcObject = stream

          await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => resolve()
            video.onerror = reject
          })

          await video.play()

          canvas.width  = video.videoWidth  || 1280
          canvas.height = video.videoHeight || 960
          rafRef.current = requestAnimationFrame(loop)
        } catch {
          setError('Không thể mở camera. Kiểm tra quyền truy cập camera.')
        }
      }

      function loop(now: number) {
        rafRef.current = requestAnimationFrame(loop)

        if (pausedRef.current) return
        if (scanBusyRef.current) return
        if (now - lastScanRef.current < interval) return
        if (video.readyState < 2) return

        lastScanRef.current = now

        // Crop center (1/zoom) of the video frame, then draw it upscaled to full canvas.
        // At zoom 2×: QR code occupies 2× more pixels → decoder can read it at longer range.
        const z  = zoomRef.current
        const vw = video.videoWidth
        const vh = video.videoHeight
        const sw = vw / z
        const sh = vh / z
        ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, vw, vh)

        scanBusyRef.current = true
        QrScanner.scanImage(canvas, { returnDetailedScanResult: true })
          .then(result => {
            if (!pausedRef.current) {
              pausedRef.current = true
              onScan(result.data)
            }
          })
          .catch(() => {})
          .finally(() => { scanBusyRef.current = false })
      }

      setup()

      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        stream?.getTracks().forEach(t => t.stop())
        video.srcObject = null
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function handleTouchStart(e: React.TouchEvent) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        pinchStartDist.current = Math.sqrt(dx * dx + dy * dy)
        pinchStartZoom.current = zoomRef.current
      }
    }

    function handleTouchMove(e: React.TouchEvent) {
      if (e.touches.length !== 2 || pinchStartDist.current === null) return
      const dx   = e.touches[0].clientX - e.touches[1].clientX
      const dy   = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      updateZoom(pinchStartZoom.current * (dist / pinchStartDist.current))
    }

    function handleTouchEnd(e: React.TouchEvent) {
      if (e.touches.length < 2) pinchStartDist.current = null
    }

    return (
      <div className="flex flex-col gap-3">
        <div
          ref={containerRef}
          className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 aspect-[4/3]"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Video shows full FOV; CSS scale gives visual zoom feedback */}
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            playsInline
            muted
          />

          {!error && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-[85%] aspect-square border-2 border-blue-400 rounded-lg animate-pulse" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-2 p-4">
              <p className="text-slate-300 text-xs text-center">{error}</p>
            </div>
          )}

          {zoom > 1 && (
            <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] font-semibold rounded px-1.5 py-0.5 pointer-events-none">
              {zoom.toFixed(1)}×
            </div>
          )}

          <button
            onClick={onClose}
            className="absolute top-2 right-2 bg-black/40 text-white rounded-full p-1 hover:bg-black/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="absolute bottom-2 right-2 flex flex-col gap-1">
            <button
              onClick={() => updateZoom(zoom + 0.5)}
              disabled={zoom >= MAX_ZOOM}
              className="bg-black/40 text-white rounded-full p-1.5 hover:bg-black/60 disabled:opacity-30 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => updateZoom(zoom - 0.5)}
              disabled={zoom <= MIN_ZOOM}
              className="bg-black/40 text-white rounded-full p-1.5 hover:bg-black/60 disabled:opacity-30 transition-colors"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    )
  }
)
