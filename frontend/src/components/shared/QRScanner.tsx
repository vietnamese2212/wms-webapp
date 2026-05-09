import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode'
import { X } from 'lucide-react'

interface QRScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

export interface QRScannerHandle {
  resume: () => void
}

const SCANNER_ID = 'qr-scanner-container'

export const QRScanner = forwardRef<QRScannerHandle, QRScannerProps>(
  function QRScanner({ onScan, onClose }, ref) {
    const scannerRef = useRef<Html5Qrcode | null>(null)
    const [error, setError] = useState<string | null>(null)

    function handleResume() {
      const s = scannerRef.current
      if (s && s.getState() === Html5QrcodeScannerState.PAUSED) {
        s.resume()
      }
    }

    useImperativeHandle(ref, () => ({ resume: handleResume }))

    useEffect(() => {
      const scanner = new Html5Qrcode(SCANNER_ID)
      scannerRef.current = scanner

      const onDecode = (decodedText: string) => {
        if (scanner.getState() === Html5QrcodeScannerState.SCANNING) {
          scanner.pause(true)
        }
        onScan(decodedText)
      }

      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          onDecode,
          () => {},
        )
        .catch((err) => {
          if (String(err).includes('NotFoundError') || String(err).includes('OverconstrainedError')) {
            scanner
              .start(
                { facingMode: 'user' },
                { fps: 10, qrbox: { width: 260, height: 260 } },
                onDecode,
                () => {},
              )
              .catch(() => setError('Không thể mở camera. Kiểm tra quyền truy cập camera.'))
          } else {
            setError('Không thể mở camera. Kiểm tra quyền truy cập camera.')
          }
        })

      return () => {
        scanner.stop().catch(() => {}).finally(() => scanner.clear())
      }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <div className="flex flex-col gap-3">
        <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
          <div id={SCANNER_ID} className="w-full" />

          {/* Scanning overlay */}
          {!error && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-64 h-64 border-2 border-blue-400 rounded-lg animate-pulse" />
            </div>
          )}

          {/* Error overlay */}
          {error && (
            <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-2 p-4">
              <p className="text-slate-300 text-xs text-center">{error}</p>
            </div>
          )}

          {/* Close button */}
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
