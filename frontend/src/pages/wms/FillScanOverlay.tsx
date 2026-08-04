// Overlay QUÉT THỰC HIỆN lệnh fill (04/08) — instant flow theo skill qr-scan-flow:
// quét tem pallet → BE tìm lệnh fill đang chờ của pallet đó → kiểm pallet ĐANG Ở đúng vị trí nguồn
// → TỰ chuyển sang vị trí đích (RPC khoá sức chứa) → beep + card xanh → camera chạy lại sau 1,5s.
// Lỗi (không có lệnh / lệch nguồn / đích đầy / lệnh của người khác) → banner đỏ + nút "Quét tiếp".
// Riêng lỗi NOT_YOUR_TASK: hiện thêm nút "Nhận lệnh này" cho người có quyền gán — KHÔNG tự cướp việc.
// Mount 1 lần, CSS hidden khi đóng (camera keep-alive, không hỏi lại quyền).
import { useEffect, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import { QrCode, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QRScanner, type QRScannerHandle } from '@/components/shared/QRScanner'
import { apiClient } from '@/api/client'
import { playBeep } from '@/utils/audio'
import { qtyLabel } from '@/utils/qtyUnits'
import type { FillTaskRow } from '@/api/hooks'

type ApiErr = AxiosError<{ error: { code?: string; message: string } }>
const errOf = (e: unknown) => (e as ApiErr)?.response?.data?.error
const msgOf = (e: unknown) => errOf(e)?.message ?? String(e)

export function FillScanOverlay({ warehouseId, open, onClose, canAssign }: {
  warehouseId: string; open: boolean; onClose: () => void; canAssign: boolean
}) {
  const qc = useQueryClient()
  const scannerRef = useRef<QRScannerHandle>(null)
  const busyRef = useRef(false)
  const [err, setErr] = useState('')
  const [pendingQR, setPendingQR] = useState('')   // mã vừa quét, giữ lại để "Nhận lệnh này"
  const [canTakeOver, setCanTakeOver] = useState(false)
  const [last, setLast] = useState<{ task: FillTaskRow; moved: boolean; message?: string } | null>(null)
  const [count, setCount] = useState(0)

  useEffect(() => { setErr(''); setLast(null); setCount(0) }, [warehouseId])
  useEffect(() => { if (open) setTimeout(() => scannerRef.current?.resume(), 50) }, [open])

  function send(raw: string, takeOver: boolean) {
    if (busyRef.current) return
    busyRef.current = true
    setErr('')
    apiClient.post('/wms/fill/scan', { qr: raw, warehouse_id: warehouseId, take_over: takeOver })
      .then(({ data }) => {
        setLast(data.data as { task: FillTaskRow; moved: boolean; message?: string })
        setCanTakeOver(false)
        setCount(c => c + 1)
        qc.invalidateQueries({ queryKey: ['fill-tasks'] })
        qc.invalidateQueries({ queryKey: ['fill-demand'] })
        qc.invalidateQueries({ queryKey: ['fill-report'] })
        setTimeout(() => scannerRef.current?.resume(), 1500)
      })
      .catch((e: unknown) => {
        setLast(null)
        setErr(msgOf(e))
        setCanTakeOver(errOf(e)?.code === 'NOT_YOUR_TASK' && canAssign)
      })   // KHÔNG resume — chờ người bấm "Quét tiếp"
      .finally(() => { busyRef.current = false })
  }

  function handleScan(raw: string) {
    playBeep()
    setPendingQR(raw)
    send(raw, false)
  }

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col ${open ? '' : 'hidden'}`}>
      <div className="flex items-center gap-2 px-3 py-2 shrink-0">
        <QrCode className="h-4 w-4 text-sky-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate">Quét thực hiện — Fill hàng</p>
          <p className="text-[10px] text-white/60">Quét tem pallet ĐANG Ở vị trí nguồn của lệnh · phiên này: {count} pallet</p>
        </div>
        <button onClick={onClose} title="Đóng"
          className="h-9 w-9 flex items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 shrink-0">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} fill />
      </div>
      <div className="shrink-0 p-3 space-y-2">
        {err && (
          <div className="rounded-lg bg-red-600 text-white px-3 py-2 flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold flex-1 min-w-[140px]">{err}</p>
            {canTakeOver && (
              <Button size="sm" className="h-8 text-[11px] bg-amber-400 text-amber-950 hover:bg-amber-300 shrink-0"
                onClick={() => send(pendingQR, true)}>
                Nhận lệnh này
              </Button>
            )}
            <Button size="sm" className="h-8 text-[11px] bg-white text-red-700 hover:bg-red-50 shrink-0"
              onClick={() => { setErr(''); setCanTakeOver(false); scannerRef.current?.resume() }}>
              Quét tiếp
            </Button>
          </div>
        )}
        {!err && last && (
          <div className="rounded-lg bg-green-600 text-white px-3 py-2">
            <p className="text-[11px]">
              <span className="font-mono font-semibold">{last.task.material_code}</span>
              {last.task.material_name ? ` ${last.task.material_name}` : ''}
              {' · '}{qtyLabel(Number(last.task.qty_base), last.task)}
            </p>
            <p className="text-base font-bold leading-tight">
              {last.task.from_location_code ?? '—'} → {last.task.to_location_code ?? '—'}
            </p>
            {last.message && <p className="text-[10px] text-white/80 mt-0.5">{last.message}</p>}
          </div>
        )}
        {!err && !last && (
          <p className="text-[11px] text-white/60 text-center">Pallet có lệnh fill sẽ TỰ chuyển sang vị trí nhặt lẻ — không cần bấm gì thêm</p>
        )}
      </div>
    </div>
  )
}
