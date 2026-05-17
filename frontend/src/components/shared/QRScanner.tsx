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

export const QRScanner = forwardRef<QRScannerHandle, QRScannerProps>(
  function QRScanner({ onScan, onClose }, ref) {
    const videoRef     = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const scannerRef   = useRef<QrScanner | null>(null)
    const pausedRef    = useRef(false)
    const zoomRef      = useRef(1)
    const [zoom, setZoom]   = useState(1)
    const [error, setError] = useState<string | null>(null)

    // Pinch tracking
    const pinchStartDist = useRef<number | null>(null)
    const pinchStartZoom = useRef(1)

    useImperativeHandle(ref, () => ({
      resume: () => {
        pausedRef.current = false
        scannerRef.current?.start()
      },
    }))

    function updateZoom(raw: number) {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(raw * 10) / 10))
      zoomRef.current = z
      setZoom(z)
    }

    // Prevent native page-scroll while pinching inside scanner
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

      const scanner = new QrScanner(
        video,
        (result) => {
          if (pausedRef.current) return
          pausedRef.current = true
          scanner.pause()
          onScan(result.data)
        },
        {
          preferredCamera:      'environment',
          maxScansPerSecond:    15,
          highlightScanRegion:  false,
          highlightCodeOutline: false,
          // Scan the center 1/zoom fraction of the frame to match visual zoom
          calculateScanRegion: (v) => {
            const z  = zoomRef.current
            const vw = v.videoWidth  || v.clientWidth
            const vh = v.videoHeight || v.clientHeight
            const w  = Math.round(vw / z)
            const h  = Math.round(vh / z)
            return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), width: w, height: h }
          },
          returnDetailedScanResult: true,
        },
      )

      scannerRef.current = scanner
      scanner.start().catch(() => {
        setError('Không thể mở camera. Kiểm tra quyền truy cập camera.')
      })

      return () => { scanner.destroy() }
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
      const dx    = e.touches[0].clientX - e.touches[1].clientX
      const dy    = e.touches[0].clientY - e.touches[1].clientY
      const dist  = Math.sqrt(dx * dx + dy * dy)
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

          {/* Zoom level badge */}
          {zoom > 1 && (
            <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] font-semibold rounded px-1.5 py-0.5 pointer-events-none">
              {zoom.toFixed(1)}×
            </div>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 bg-black/40 text-white rounded-full p-1 hover:bg-black/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Zoom +/- buttons */}
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
