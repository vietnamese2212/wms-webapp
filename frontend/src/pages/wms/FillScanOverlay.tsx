// Màn QUÉT THỰC HIỆN lệnh fill (v3 05/08) — flow CONFIRM theo skill qr-scan-flow:
// quét tem pallet → BE khớp DÒNG LỆNH theo MÃ + DATE (không ghim tem cụ thể) → card soi:
// date yêu cầu (%Date), SL trên pallet, VỊ TRÍ ĐẾN (ĐỔI ĐƯỢC ngay tại đây — user chốt 05/08)
// → "Xác nhận hạ" chạy RPC nguyên tử → beep + card xanh; camera ĐỨNG YÊN (user chốt 05/08:
// KHÔNG auto-resume — hạ xong còn chạy xe nâng), bấm "Quét tiếp" trên card mới chạy tiếp.
// Lỗi (không có lệnh / sai date / hàng block / đích đầy / lệnh của người khác) → banner đỏ;
// riêng đích đầy GIỮ NGUYÊN card để đổi vị trí đến rồi xác nhận lại (không ngõ cụt).
// Mount 1 lần, CSS hidden khi đóng; camera TẮT HẲN khi đóng (`active={open}` — user bắt 05/08:
// đèn camera vẫn sáng chạy ngầm sau khi đóng), mở lại tự bật không hỏi quyền lại.
// PDA súng quét (đồng bộ chuẩn GdoScanSheet, user nhắc 05/08): bắn 1 phát = chuyển hẳn chế độ súng
// (camera KHÔNG bật — đỡ tốn pin); bắn lại ĐÚNG tem đang chờ = Xác nhận hạ, không cần chạm màn hình.
import { useEffect, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import { QrCode, X, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QRScanner, type QRScannerHandle } from '@/components/shared/QRScanner'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { PdaGunHint } from '@/components/shared/PdaGunHint'
import { apiClient } from '@/api/client'
import { usePickFaceLocations, type FillTaskRow } from '@/api/hooks'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { playBeep } from '@/utils/audio'
import { normalizeQR } from '@/utils/qr'
import { qtyLabel } from '@/utils/qtyUnits'
import { formatDate } from '@/utils/formatters'
import { RequiredDateBadge } from './fillShared'

type ApiErr = AxiosError<{ error: { code?: string; message: string } }>
const errOf = (e: unknown) => (e as ApiErr)?.response?.data?.error
const msgOf = (e: unknown) => errOf(e)?.message ?? String(e)

type Preview = {
  preview: true
  task: FillTaskRow
  entry: { entry_id: string; pallet_code: string; avail: number; production_date: string | null; expiry_date: string | null }
  dest: { id: string; code: string | null }
  will_complete: boolean
}
type Done = { task: FillTaskRow; scanned_qty?: number; done?: boolean }

export function FillScanOverlay({ warehouseId, orderId, open, onClose, canAssign, pdaMode = false, initialScan }: {
  warehouseId: string; orderId?: string; open: boolean; onClose: () => void; canAssign: boolean
  pdaMode?: boolean          // mở bằng cò súng → KHÔNG bật camera
  initialScan?: string       // tem đã bắn ngay trước khi mở — xử lý luôn
}) {
  const qc = useQueryClient()
  const scannerRef = useRef<QRScannerHandle>(null)
  const busyRef = useRef(false)
  // Bắn 1 phát súng = chuyển hẳn chế độ súng cả lượt mở (camera unmount; listener súng độc lập)
  const [gunMode, setGunMode] = useState(false)
  const [err, setErr] = useState('')
  const [pendingQR, setPendingQR] = useState('')
  const [canTakeOver, setCanTakeOver] = useState(false)
  const [takeOver, setTakeOver] = useState(false)      // đã bấm "Nhận lệnh này" cho tem hiện tại
  const [prev, setPrev] = useState<Preview | null>(null)
  const [destSel, setDestSel] = useState('')
  const [last, setLast] = useState<Done | null>(null)
  const [count, setCount] = useState(0)
  const [saving, setSaving] = useState(false)

  // Ô "Vị trí đến" — BE lọc sẵn theo Loại kho của mã đang quét
  const { data: destLocs = [] } = usePickFaceLocations(prev ? warehouseId : undefined, prev?.task.material_id)

  useEffect(() => { setErr(''); setLast(null); setPrev(null); setCount(0) }, [warehouseId, orderId])
  // Mở lại → đặt chế độ theo CÁCH MỞ (cò súng = súng, nút = camera) + xử lý luôn tem vừa bắn (nếu có).
  // Tem bắn vào đi THẲNG preview (không qua handleScan): overlay giữ state giữa các lượt mở, card
  // treo của lượt trước sẽ làm handleScan nuốt tem mới — dọn card cũ rồi soi tem mới.
  useEffect(() => {
    if (!open) return
    setGunMode(pdaMode)
    setTimeout(() => scannerRef.current?.resume(), 50)
    if (pdaMode && initialScan) {
      setPrev(null); setErr(''); setCanTakeOver(false); setTakeOver(false)
      playBeep()
      setPendingQR(initialScan)
      preview(initialScan, false)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Súng quét PDA — chạy song song camera, chống double-read trong hook; chỉ nghe khi overlay mở
  useWedgeScanner(code => handleScan(code, 'wedge'), open)

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['fill-orders'] })
    qc.invalidateQueries({ queryKey: ['fill-order'] })
    qc.invalidateQueries({ queryKey: ['fill-demand'] })
    qc.invalidateQueries({ queryKey: ['fill-report'] })
  }

  function preview(raw: string, asTakeOver: boolean) {
    if (busyRef.current) return
    busyRef.current = true
    setErr(''); setLast(null)
    apiClient.post('/wms/fill/scan', {
      qr: raw, warehouse_id: warehouseId, order_id: orderId || undefined, take_over: asTakeOver,
    })
      .then(({ data }) => {
        const p = data.data as Preview
        setPrev(p)
        setDestSel(p.dest.id)
        setTakeOver(asTakeOver)
        setCanTakeOver(false)
      })
      .catch((e: unknown) => {
        setPrev(null)
        setErr(msgOf(e))
        setCanTakeOver(errOf(e)?.code === 'NOT_YOUR_TASK' && canAssign)
      })   // KHÔNG resume — chờ người bấm "Quét tiếp"
      .finally(() => { busyRef.current = false })
  }

  function confirm() {
    if (!prev || saving) return
    setSaving(true); setErr('')
    apiClient.post('/wms/fill/scan', {
      qr: pendingQR, warehouse_id: warehouseId, order_id: orderId || undefined,
      to_location_id: destSel || undefined, commit: true, take_over: takeOver,
    })
      .then(({ data }) => {
        setLast(data.data as Done)
        setPrev(null)
        setCount(c => c + 1)
        invalidate()
        // KHÔNG auto-resume camera (user chốt 05/08 — module này hạ pallet xong còn phải chạy xe
        // nâng, camera tự bật lại chỉ tốn pin): đứng yên ở card kết quả, bấm "Quét tiếp" mới chạy.
      })
      .catch((e: unknown) => {
        const code = errOf(e)?.code
        setErr(msgOf(e))
        // Đích đầy → GIỮ card để đổi "Vị trí đến" rồi xác nhận lại (không mất lượt quét).
        // Dòng lệnh vừa đổi trạng thái / tem đã ghi nhận → bỏ card, quét lại.
        if (code !== 'LOCATION_FULL' && code !== 'CATEGORY_MISMATCH') setPrev(null)
        invalidate()
      })
      .finally(() => setSaving(false))
  }

  function skip() {
    setPrev(null); setErr(''); setCanTakeOver(false)
    scannerRef.current?.resume()
  }

  function handleScan(raw: string, src: 'camera' | 'wedge' = 'camera') {
    if (src === 'wedge' && !gunMode) setGunMode(true)   // có phát bắn = tắt camera cả lượt (đỡ tốn pin)
    if (busyRef.current || saving) return
    if (prev) {
      // PDA: đang chờ xác nhận mà BẮN LẠI đúng tem đó = Xác nhận hạ (không cần chạm màn hình).
      // Chỉ áp cho SÚNG — camera đứng yên vẫn nhìn tem, không được tự lưu. Tem khác → bỏ qua.
      if (src === 'wedge' && normalizeQR(raw) === prev.entry.pallet_code) { playBeep(); confirm() }
      return
    }
    playBeep()
    setPendingQR(raw)
    setTakeOver(false)
    preview(raw, false)
  }

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col ${open ? '' : 'hidden'}`}>
      <div className="flex items-center gap-2 px-3 py-2 shrink-0">
        <QrCode className="h-4 w-4 text-sky-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate">
            Quét thực hiện — Fill hàng{orderId ? ' (trong lệnh đang mở)' : ''}
          </p>
          <p className="text-[10px] text-white/60">
            Quét tem pallet ĐÚNG MÃ + ĐÚNG DATE của dòng lệnh · phiên này: {count} pallet
          </p>
        </div>
        <button onClick={onClose} title="Đóng"
          className="h-9 w-9 flex items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 shrink-0">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {gunMode ? (
          <div className="h-full mx-3 rounded-xl border border-slate-700 bg-slate-900 flex flex-col items-center justify-center gap-2 p-4">
            <PdaGunHint className="h-10 w-10" />
            <p className="text-sm font-medium text-slate-200 text-center">Chế độ súng quét — bóp cò để quét tem</p>
            <p className="text-[11px] text-slate-400 text-center">Camera tắt · bắn lại đúng tem đang chờ = Xác nhận hạ</p>
          </div>
        ) : (
          <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} fill active={open} stopOnScan />
        )}
      </div>
      <div className="shrink-0 p-3 space-y-2">
        {err && (
          <div className="rounded-lg bg-red-600 text-white px-3 py-2 flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold flex-1 min-w-[140px]">{err}</p>
            {canTakeOver && (
              <Button size="sm" className="h-8 text-[11px] bg-amber-400 text-amber-950 hover:bg-amber-300 shrink-0"
                onClick={() => preview(pendingQR, true)}>
                Nhận lệnh này
              </Button>
            )}
            {!prev && (
              <Button size="sm" className="h-8 text-[11px] bg-white text-red-700 hover:bg-red-50 shrink-0"
                onClick={skip}>
                Quét tiếp
              </Button>
            )}
          </div>
        )}
        {prev && (
          <div className="rounded-lg bg-white px-3 py-2 space-y-2">
            <div className="flex items-start gap-2 flex-wrap">
              <div className="flex-1 min-w-[160px]">
                <p className="text-[11px]">
                  <span className="font-mono font-semibold">{prev.task.material_code}</span>
                  {prev.task.material_name ? ` ${prev.task.material_name}` : ''}
                </p>
                <p className="text-[11px] text-slate-600">
                  Yêu cầu: <RequiredDateBadge line={prev.task} />
                  <span className="text-slate-400"> · còn {Math.max(0, prev.task.required_pallets - prev.task.scanned_pallets)} pallet</span>
                </p>
                <p className="text-[11px] text-slate-600">
                  Pallet này: <b>{qtyLabel(Number(prev.entry.avail), prev.task)}</b>
                  {prev.entry.production_date && <> · NSX {formatDate(prev.entry.production_date)}</>}
                </p>
              </div>
              {prev.will_complete && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                  pallet cuối của dòng
                </span>
              )}
            </div>
            {/* Đổi vị trí đến ngay tại màn quét (user chốt 05/08) — lưu vào dòng lệnh khi xác nhận */}
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <label className="text-[10px] text-slate-500 flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Vị trí đến (đổi được)
                </label>
                <SingleSelect
                  value={destSel}
                  onChange={setDestSel}
                  options={destLocs.map(l => ({ value: l.id, label: `${l.location_code} (${l.max_pallets} pl)` }))}
                  placeholder={prev.dest.code ?? 'Chọn vị trí…'}
                />
              </div>
              <Button size="sm" variant="outline" className="h-9 text-[11px] shrink-0" onClick={skip} disabled={saving}>
                Bỏ qua
              </Button>
              <Button size="sm" className="h-9 text-[11px] shrink-0" onClick={confirm} disabled={saving || !destSel}>
                {saving ? 'Đang hạ…' : 'Xác nhận hạ'}
              </Button>
            </div>
          </div>
        )}
        {!err && !prev && last && (
          <div className="rounded-lg bg-green-600 text-white px-3 py-2 flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <p className="text-[11px]">
                <span className="font-mono font-semibold">{last.task.material_code}</span>
                {last.task.material_name ? ` ${last.task.material_name}` : ''}
                {' · đã hạ '}{qtyLabel(Number(last.scanned_qty ?? 0), last.task)}
              </p>
              <p className="text-base font-bold leading-tight">
                → {last.task.to_location_code ?? '—'}
                {last.done && <span className="text-[11px] font-normal text-white/90"> · dòng lệnh HOÀN THÀNH</span>}
              </p>
              <p className="text-[10px] text-white/80 mt-0.5">
                Tiến độ dòng: {last.task.scanned_pallets}/{last.task.required_pallets} pallet
              </p>
            </div>
            {/* KHÔNG auto-resume — camera đứng yên tới khi chủ động quét tiếp (súng: cứ bóp cò) */}
            {!gunMode && (
              <Button size="sm" className="h-9 text-[11px] bg-white text-green-700 hover:bg-green-50 shrink-0"
                onClick={() => { setLast(null); scannerRef.current?.resume() }}>
                Quét tiếp
              </Button>
            )}
          </div>
        )}
        {!err && !prev && !last && (
          <p className="text-[11px] text-white/60 text-center">
            Quét tem → soi date + vị trí đến → bấm "Xác nhận hạ". Không cần đúng tem chỉ định — đúng MÃ + đúng DATE là được.
          </p>
        )}
      </div>
    </div>
  )
}
