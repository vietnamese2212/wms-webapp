import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import { X } from 'lucide-react'

interface QRScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

export interface QRScannerHandle {
  resume: () => void
}

export const QRScanner = forwardRef<QRScannerHandle, QRScannerProps>(
  function QRScanner({ onScan, onClose }, ref) {
    const videoRef  = useRef<HTMLVideoElement>(null)
    const scannerRef = useRef<QrScanner | null>(null)
    const pausedRef  = useRef(false)
    const [error, setError] = useState<string | null>(null)

    useImperativeHandle(ref, () => ({
      resume: () => {
        pausedRef.current = false
        scannerRef.current?.start()
      },
    }))

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
          // Full frame, process at up to 1280px (default is 400px — too small for distance)
          calculateScanRegion: (v) => {
            const w = v.videoWidth  || v.clientWidth  || 1280
            const h = v.videoHeight || v.clientHeight || 720
            const scale = Math.min(1, 1280 / Math.max(w, h))
            return {
              x: 0, y: 0, width: w, height: h,
              downScaledWidth:  Math.round(w * scale),
              downScaledHeight: Math.round(h * scale),
            }
          },
          returnDetailedScanResult: true,
        },
      )

      scannerRef.current = scanner

      scanner.start()
        .then(async () => {
          // Request highest available resolution after scanner acquires the stream
          const stream = video.srcObject as MediaStream | null
          const track  = stream?.getVideoTracks()[0]
          if (track) {
            await track.applyConstraints({
              width:  { ideal: 3840 },
              height: { ideal: 2160 },
            }).catch(() => {})
          }
        })
        .catch(() => {
          setError('Không thể mở camera. Kiểm tra quyền truy cập camera.')
        })

      return () => {
        scanner.destroy()
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
      <div className="flex flex-col gap-3">
        <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
          <video ref={videoRef} className="w-full" playsInline muted />

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

          <button
            onClick={onClose}
            className="absolute top-2 right-2 bg-black/40 text-white rounded-full p-1 hover:bg-black/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }
)
