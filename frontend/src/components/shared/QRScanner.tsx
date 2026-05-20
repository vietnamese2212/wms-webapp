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

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const SCAN_FPS = 15
const ZOOM_KEY = 'qr_scanner_zoom'
// Cap canvas at 1080p — QR decode doesn't need 4K, and 4K costs 4× the GPU work
const CANVAS_MAX_W = 1920
const CANVAS_MAX_H = 1080

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
    const loopFnRef    = useRef<((now: number) => void) | null>(null)
    const scanBusyRef  = useRef(false)
    const pausedRef    = useRef(false)
    const zoomRef      = useRef(loadZoom())
    const lastScanRef  = useRef(0)
    const [zoom, setZoom]   = useState(loadZoom)
    const [error, setError] = useState<string | null>(null)

    const pinchStartDist = useRef<number | null>(null)
    const pinchStartZoom = useRef(1)

    // resume() restarts RAF only if loop is defined and not already running
    useImperativeHandle(ref, () => ({
      resume: () => {
        pausedRef.current = false
        if (loopFnRef.current && !rafRef.current) {
          rafRef.current = requestAnimationFrame(loopFnRef.current)
        }
      },
    }))

    function updateZoom(raw: number) {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(raw * 10) / 10))
      zoomRef.current = z
      setZoom(z)
      try { sessionStorage.setItem(ZOOM_KEY, String(z)) } catch {}
    }

    // Block native page-scroll while pinching
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      const block = (e: TouchEvent) => { if (e.touches.length >= 2) e.preventDefault() }
      el.addEventListener('touchmove', block, { passive: false })
      return () => el.removeEventListener('touchmove', block)
    }, [])

    // Pause RAF when tab/app goes to background; resume when visible again
    useEffect(() => {
      const onVisibility = () => {
        if (document.hidden) {
          if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
        } else if (!pausedRef.current && loopFnRef.current && !rafRef.current) {
          rafRef.current = requestAnimationFrame(loopFnRef.current)
        }
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => document.removeEventListener('visibilitychange', onVisibility)
    }, [])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      const canvas = document.createElement('canvas')
      const ctx    = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return

      const interval = 1000 / SCAN_FPS
      let stream: MediaStream | null = null
      let engine: Awaited<ReturnType<typeof QrScanner.createQrEngine>> | null = null
      let destroyed = false

      async function setup() {
        if (!video) return
        try {
          engine = await QrScanner.createQrEngine()
          if (destroyed) { if (engine instanceof Worker) engine.terminate(); return }

          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'environment',
              width:  { ideal: 3840 },
              height: { ideal: 2160 },
            },
          })
          if (destroyed) { stream.getTracks().forEach(t => t.stop()); return }
          video.srcObject = stream

          await new Promise<void>(resolve => {
            if (video!.readyState >= 1) { resolve(); return }
            video!.onloadedmetadata = () => resolve()
          })

          await video.play()

          // Cap canvas at 1080p regardless of camera resolution
          const vw = video.videoWidth  || 1280
          const vh = video.videoHeight || 960
          const scale = Math.min(1, CANVAS_MAX_W / vw, CANVAS_MAX_H / vh)
          canvas.width  = Math.round(vw * scale)
          canvas.height = Math.round(vh * scale)

          loopFnRef.current = loop
          rafRef.current = requestAnimationFrame(loop)
        } catch {
          setError('Không thể mở camera. Kiểm tra quyền truy cập camera.')
        }
      }

      function loop(now: number) {
        // Clear ref first — will be re-set below only if we should keep running
        rafRef.current = null

        if (!video || !ctx || !engine) return
        // Stop RAF completely when paused — resume() will restart it
        if (pausedRef.current) return

        rafRef.current = requestAnimationFrame(loop)

        if (scanBusyRef.current) return
        if (now - lastScanRef.current < interval) return
        if (video.readyState < 2) return

        lastScanRef.current = now

        // Crop center 1/zoom of video, upscale to canvas → more pixels on QR at range
        const z  = zoomRef.current
        const cw = canvas.width
        const ch = canvas.height
        const sw = cw / z
        const sh = ch / z
        // Source from video scaled to canvas coords
        const scaleX = video.videoWidth  / cw
        const scaleY = video.videoHeight / ch
        ctx.drawImage(
          video,
          (video.videoWidth  - sw * scaleX) / 2,
          (video.videoHeight - sh * scaleY) / 2,
          sw * scaleX, sh * scaleY,
          0, 0, cw, ch,
        )

        scanBusyRef.current = true
        QrScanner.scanImage(canvas, { qrEngine: engine, returnDetailedScanResult: true })
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
        destroyed = true
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
        loopFnRef.current = null
        stream?.getTracks().forEach(t => t.stop())
        video.srcObject = null
        if (engine instanceof Worker) engine.terminate()
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
