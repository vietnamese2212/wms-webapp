import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode'
import { Camera, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface QRScannerProps {
  onScan: (value: string) => void
  onClose: () => void
}

const SCANNER_ID = 'qr-scanner-container'

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ID)
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        (decodedText) => {
          // Pause immediately after first scan to prevent double-fire
          if (scanner.getState() === Html5QrcodeScannerState.SCANNING) {
            scanner.pause(true)
            setPaused(true)
          }
          onScan(decodedText)
        },
        () => { /* ignore per-frame decode errors */ },
      )
      .catch((err) => {
        // Fallback: try with front camera if rear not available
        if (String(err).includes('NotFoundError') || String(err).includes('OverconstrainedError')) {
          scanner
            .start(
              { facingMode: 'user' },
              { fps: 10, qrbox: { width: 260, height: 260 } },
              (decodedText) => {
                if (scanner.getState() === Html5QrcodeScannerState.SCANNING) {
                  scanner.pause(true)
                  setPaused(true)
                }
                onScan(decodedText)
              },
              () => {},
            )
            .catch(() => setError('Không thể mở camera. Dùng nút upload ảnh phía dưới.'))
        } else {
          setError('Không thể mở camera. Dùng nút upload ảnh phía dưới.')
        }
      })

    return () => {
      scanner
        .stop()
        .catch(() => {})
        .finally(() => scanner.clear())
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  function handleResume() {
    const s = scannerRef.current
    if (s && s.getState() === Html5QrcodeScannerState.PAUSED) {
      s.resume()
      setPaused(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const scanner = new Html5Qrcode('qr-file-scanner')
      const result = await scanner.scanFile(file, false)
      scanner.clear()
      onScan(result)
    } catch {
      setError('Không đọc được QR từ ảnh. Thử ảnh khác.')
    }
    e.target.value = ''
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Scanner viewport */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
        <div id={SCANNER_ID} className="w-full" />

        {/* Scanning overlay */}
        {!error && !paused && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-64 h-64 border-2 border-blue-400 rounded-lg animate-pulse" />
          </div>
        )}

        {/* Paused overlay */}
        {paused && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-3">
            <p className="text-white text-sm font-medium">Đã dừng sau khi quét</p>
            <Button size="sm" onClick={handleResume} className="gap-2">
              <Camera className="h-4 w-4" /> Quét tiếp
            </Button>
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

      {/* Hidden div for file scanning (html5-qrcode requires a DOM element) */}
      <div id="qr-file-scanner" className="hidden" />

      {/* File upload fallback */}
      <label className="cursor-pointer">
        <input type="file" accept="image/*" className="sr-only" onChange={handleFileUpload} />
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-500 transition-colors">
          <Upload className="h-4 w-4" />
          Upload ảnh QR (không có camera)
        </div>
      </label>
    </div>
  )
}
