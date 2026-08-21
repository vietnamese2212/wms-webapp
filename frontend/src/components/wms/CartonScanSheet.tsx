// Panel MULTISCAN tem THÙNG đính kèm 1 pallet khi Xuất (truy vết, KHÔNG tính tồn theo thùng).
// Chỉ mở khi Kho/Loại kho bật cờ quét-tới-thùng, SAU khi đã quét pallet (neo vào scan_entry).
// Engine dùng CHUNG createScanEngine + drawBoxes (native BarcodeDetector → zxing-wasm) như quét đơn.
// Đối chiếu 2 tầng: định dạng tem (V1/V2) + MÃ HÀNG khớp pallet → 3 màu:
//   🟩 khớp mã hàng · 🟧 tem hợp lệ nhưng LẠ mã hàng · 🟥 sai định dạng.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Flashlight, FlashlightOff, ZoomIn, ZoomOut, Trash2, Check, ScanBarcode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createScanEngine, drawBoxes, type ScanEngine, type Box, type ExtCapabilities, type ScanCodeTypes } from '@/utils/scanEngine'
import { unlockAudio, playBeep } from '@/utils/audio'
import { isValidTem, materialCodeOf } from '@/utils/qr'

export interface CartonScan { code: string; match: boolean; at: number }

interface Props {
  open: boolean
  palletCode: string
  expectedMaterialCode: string
  initial?: CartonScan[]           // mã thùng đã lưu trước đó (mở lại pallet cũ)
  saving?: boolean
  onSave: (cartons: CartonScan[]) => void
  onSkip: () => void               // đóng, KHÔNG lưu (bỏ qua quét thùng)
  // Loại mã camera giải, theo cấu hình KHO (như QRScanner) — BẮT BUỘC khai để màn mới không lọt
  codeTypes: ScanCodeTypes
}

interface Entry { code: string; valid: boolean; match: boolean; at: number; hits: number }
const INVALID_MIN_HITS = 2

export function CartonScanSheet({ open, palletCode, expectedMaterialCode, initial, saving, onSave, onSkip, codeTypes }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const engineRef  = useRef<ScanEngine | null>(null)
  const stoppedRef = useRef(true)
  const codesRef   = useRef<Map<string, Entry>>(new Map())

  const [, setVersion] = useState(0)
  const [error, setError]     = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvail, setTorchAvail] = useState(false)
  const [zoomCap, setZoomCap] = useState<{ min: number; max: number; step: number } | null>(null)
  const [zoomVal, setZoomVal] = useState(1)

  // Nạp mã đã lưu trước (nếu mở lại) — tính là đã quét, không quét lại
  useEffect(() => {
    if (!open) return
    const m = new Map<string, Entry>()
    for (const c of (initial ?? [])) m.set(c.code, { code: c.code, valid: true, match: c.match, at: c.at, hits: 99 })
    codesRef.current = m
    setVersion(v => v + 1)
    start()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function start() {
    setError(null)
    unlockAudio()
    try {
      engineRef.current = await createScanEngine(codeTypes)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await new Promise<void>(r => { if (video.readyState >= 1) r(); else video.onloadedmetadata = () => r() })
      await video.play()
      const track = stream.getVideoTracks()[0]
      const caps = (track.getCapabilities?.() ?? {}) as ExtCapabilities
      setTorchAvail(!!caps.torch); setTorchOn(false)
      if (caps.zoom && caps.zoom.max > caps.zoom.min) { setZoomCap(caps.zoom); setZoomVal(caps.zoom.min) }
      else setZoomCap(null)
      stoppedRef.current = false
      loop()
    } catch {
      setError('Không mở được camera. Kiểm tra quyền truy cập camera.')
    }
  }

  function stop() {
    stoppedRef.current = true
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
  }

  async function loop() {
    const video = videoRef.current, engine = engineRef.current
    if (stoppedRef.current || !video || !engine) return
    if (video.readyState < 2 || document.hidden) { setTimeout(loop, 150); return }
    try {
      const hits = await engine.detect(video)
      const boxes: Box[] = []
      let anyNew = false, anyBad = false
      for (const h of hits) {
        let e = codesRef.current.get(h.text)
        if (!e) {
          const valid = isValidTem(h.text)
          const match = valid && materialCodeOf(h.text) === expectedMaterialCode
          e = { code: h.text, valid, match, at: Date.now(), hits: 0 }
          codesRef.current.set(h.text, e)
        }
        e.hits++
        const need = e.valid ? 1 : INVALID_MIN_HITS
        const confirmed = e.hits >= need
        const justConfirmed = e.hits === need
        if (justConfirmed) { if (e.valid && e.match) anyNew = true; else anyBad = true }
        boxes.push({
          points: h.points,
          kind: !confirmed ? 'pending' : e.match ? 'valid' : e.valid ? 'pending' : 'invalid',
        })
      }
      if (anyNew) { playBeep(); try { navigator.vibrate?.(40) } catch { /* no vibrate */ } setVersion(v => v + 1) }
      else if (anyBad) { playBeep(280, 0.18); setVersion(v => v + 1) }
      const wrap = wrapRef.current, overlay = overlayRef.current
      if (wrap && overlay) drawBoxes(overlay, video, wrap, boxes, 'contain')
    } catch { /* frame lỗi lẻ — bỏ qua */ }
    if (!stoppedRef.current) setTimeout(loop, engineRef.current?.kind === 'native' ? 50 : 15)
  }

  function applyTrack(set: Record<string, unknown>) {
    streamRef.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [set as MediaTrackConstraintSet] }).catch(() => {})
  }
  function toggleTorch() { const n = !torchOn; setTorchOn(n); applyTrack({ torch: n }) }
  function setZoom(z: number) {
    const track = streamRef.current?.getVideoTracks()[0]
    const caps = (track?.getCapabilities?.() ?? {}) as ExtCapabilities
    if (!track || !caps.zoom) return
    const v = Math.max(caps.zoom.min, Math.min(caps.zoom.max, z))
    setZoomVal(v); applyTrack({ zoom: v })
  }

  const entries = Array.from(codesRef.current.values()).filter(e => e.valid || e.hits >= INVALID_MIN_HITS).sort((a, b) => b.at - a.at)
  const matched = entries.filter(e => e.match).length
  const oddMat  = entries.filter(e => e.valid && !e.match).length
  const invalid = entries.filter(e => !e.valid).length

  function removeCode(code: string) { codesRef.current.delete(code); setVersion(v => v + 1) }
  function handleSave() {
    // Lưu mọi tem HỢP LỆ định dạng (kể cả lạ mã hàng — giữ vết); loại tem sai định dạng
    const list: CartonScan[] = entries.filter(e => e.valid).map(e => ({ code: e.code, match: e.match, at: e.at }))
    onSave(list)
  }

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      {/* Header */}
      <div className="shrink-0 border-b px-3 py-2 flex items-center gap-2">
        <ScanBarcode className="h-4 w-4 text-sky-600 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 leading-tight">Quét tem thùng của pallet</p>
          <p className="text-[11px] text-slate-500 truncate">Mã hàng <b>{expectedMaterialCode || '—'}</b> · pallet <span className="font-mono">{palletCode}</span></p>
        </div>
        <button onClick={onSkip} className="ml-auto h-9 w-9 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="Đóng">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Camera */}
        <div className="lg:w-[55%] p-2 shrink-0">
          <div ref={wrapRef} className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 h-[46vh] lg:h-full">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" playsInline muted />
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            <div className="absolute top-2 left-2 rounded-lg bg-black/60 text-white px-3 py-1.5 pointer-events-none">
              <span className="text-2xl font-bold tabular-nums">{matched}</span>
              <span className="text-xs text-slate-300 ml-1">thùng khớp</span>
              {oddMat > 0 && <span className="text-xs text-amber-300 ml-2">{oddMat} lạ mã hàng</span>}
              {invalid > 0 && <span className="text-xs text-red-300 ml-2">{invalid} sai định dạng</span>}
            </div>
            <div className="absolute bottom-2 right-2 flex flex-col gap-1.5 items-center">
              {torchAvail && (
                <button onClick={toggleTorch} className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60">
                  {torchOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
                </button>
              )}
              {zoomCap && (
                <>
                  <button onClick={() => setZoom(zoomVal + (zoomCap.step || 0.5))} className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60"><ZoomIn className="h-4 w-4" /></button>
                  <button onClick={() => setZoom(zoomVal - (zoomCap.step || 0.5))} className="bg-black/40 text-white rounded-full p-2 hover:bg-black/60"><ZoomOut className="h-4 w-4" /></button>
                </>
              )}
            </div>
            {error && <div className="absolute inset-0 bg-slate-900 flex items-center justify-center p-4"><p className="text-red-300 text-xs text-center">{error}</p></div>}
          </div>
          <p className="mt-1 text-[10px] text-slate-400 leading-snug">
            🟩 khớp mã hàng · 🟧 tem hợp lệ nhưng <b>lạ mã hàng</b> (vẫn lưu để truy vết) · 🟥 sai định dạng. Tem nhỏ: đưa gần + bật đèn/zoom.
          </p>
        </div>

        {/* Danh sách */}
        <div className="flex-1 min-w-0 flex flex-col p-2 min-h-0">
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-xs font-semibold text-slate-700">Đã quét ({entries.length})</p>
            <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-[10px] !min-h-0 text-red-600" onClick={() => { codesRef.current.clear(); setVersion(v => v + 1) }} disabled={entries.length === 0}>
              <Trash2 className="h-3 w-3 mr-1" />Xóa hết
            </Button>
          </div>
          {entries.length === 0 ? (
            <p className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg p-6 text-center">Chưa có mã thùng — đưa camera vào các tem thùng trên pallet</p>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {entries.map(e => (
                <div key={e.code} className="flex items-center gap-2 px-2 py-1">
                  <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${e.match ? 'bg-green-100 text-green-700' : e.valid ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {e.match ? '✓' : e.valid ? 'lạ' : '✗'}
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-slate-700 truncate">{e.code}</span>
                  <button onClick={() => removeCode(e.code)} className="ml-auto shrink-0 text-slate-400 hover:text-red-600 p-0.5"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t px-3 py-2 flex items-center gap-2">
        <span className="text-[11px] text-slate-500">Sẽ lưu <b>{matched + oddMat}</b> mã thùng vào pallet này{oddMat > 0 && ` (gồm ${oddMat} lạ mã hàng)`}.</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={onSkip} disabled={saving}>Bỏ qua</Button>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleSave} disabled={saving || entries.filter(e => e.valid).length === 0}>
          {saving ? 'Đang lưu…' : <><Check className="h-4 w-4 mr-1" />Lưu {matched + oddMat} thùng</>}
        </Button>
      </div>
    </div>,
    document.body,
  )
}
