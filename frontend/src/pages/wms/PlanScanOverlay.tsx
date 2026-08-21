// Overlay QUÉT THỰC HIỆN lệnh kế hoạch slotting (user chốt 19/07 — scanner chuẩn single):
// instant flow theo skill qr-scan-flow — quét tem pallet → BE kiểm pallet ĐANG Ở đúng vị trí nguồn
// của lệnh → TỰ chuyển sang vị trí đích (RPC khóa sức chứa) → beep + card xanh → camera tự chạy lại
// 1.5s. Lỗi (không thuộc KH / lệch nguồn / đã ở đích / đích đầy) → banner đỏ + nút "Quét tiếp".
// Mount 1 lần, CSS hidden khi đóng; camera TẮT HẲN khi đóng (`active={open}` — cùng fix với màn quét
// Fill 05/08: camera chạy ngầm sau khi đóng), mở lại tự bật không hỏi quyền lại.
// Dùng chung: tab Kế hoạch (nút inline) + trang chi tiết kế hoạch (nút cuối ô Từ vị trí).
import { useEffect, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Button } from '@/components/ui/button'
import { QRScanner, type QRScannerHandle } from '@/components/shared/QRScanner'
import { apiClient } from '@/api/client'
import { playBeep } from '@/utils/audio'
import { useScanCodeTypes } from '@/hooks/useScanCodeTypes'

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

interface ScanMoveResult {
  pallet_code: string; material_code: string | null; material_name: string | null; date_key: string | null
  from_location_code: string | null; to_location_code: string | null; flow_note: string | null
  done: number; total: number
}

export function PlanScanOverlay({ plan, open, onClose }: {
  plan: { id: string; name: string; warehouse_id: string }; open: boolean; onClose: () => void
}) {
  const qc = useQueryClient()
  const scannerRef = useRef<QRScannerHandle>(null)
  const codeTypes = useScanCodeTypes(plan.warehouse_id)
  const busyRef = useRef(false)
  const [err, setErr] = useState('')
  const [last, setLast] = useState<ScanMoveResult | null>(null)
  const [count, setCount] = useState(0)

  // Đổi kế hoạch → xóa trạng thái phiên cũ
  useEffect(() => { setErr(''); setLast(null); setCount(0) }, [plan.id])
  // Mở lại → chạy tiếp camera
  useEffect(() => { if (open) setTimeout(() => scannerRef.current?.resume(), 50) }, [open])

  function handleScan(raw: string) {
    if (busyRef.current) return
    busyRef.current = true
    playBeep()
    setErr('')
    apiClient.post(`/wms/slotting/plans/${plan.id}/scan-move`, { qr: raw })
      .then(({ data }) => {
        setLast(data.data as ScanMoveResult)
        setCount(c => c + 1)
        qc.invalidateQueries({ queryKey: ['slotting-plans'] })
        qc.invalidateQueries({ queryKey: ['slotting-plan'] })
        setTimeout(() => scannerRef.current?.resume(), 1500)
      })
      .catch((e: unknown) => { setLast(null); setErr(apiMsg(e)) }) // KHÔNG resume — chờ "Quét tiếp"
      .finally(() => { busyRef.current = false })
  }

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col ${open ? '' : 'hidden'}`}>
      <div className="flex items-center gap-2 px-3 py-2 shrink-0">
        <ScanIcon className="h-4 w-4 text-sky-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate">Quét thực hiện — {plan.name}</p>
          <p className="text-[10px] text-white/60">Quét tem pallet ĐANG Ở vị trí nguồn của lệnh · phiên này: {count} pallet</p>
        </div>
        <button onClick={onClose} title="Đóng"
          className="h-9 w-9 flex items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 shrink-0">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <QRScanner ref={scannerRef} onScan={handleScan} onClose={onClose} fill active={open} codeTypes={codeTypes} />
      </div>
      <div className="shrink-0 p-3 space-y-2">
        {err && (
          <div className="rounded-lg bg-red-600 text-white px-3 py-2 flex items-center gap-2">
            <p className="text-xs font-semibold flex-1">{err}</p>
            <Button size="sm" className="h-8 text-[11px] bg-white text-red-700 hover:bg-red-50 shrink-0"
              onClick={() => { setErr(''); scannerRef.current?.resume() }}>
              Quét tiếp
            </Button>
          </div>
        )}
        {!err && last && (
          <div className="rounded-lg bg-green-600 text-white px-3 py-2">
            <p className="text-[11px]">
              <span className="font-mono font-semibold">{last.material_code}</span>
              {last.material_name ? ` ${last.material_name}` : ''}{last.date_key ? ` · ${last.date_key}` : ''}
            </p>
            <p className="text-base font-bold leading-tight">
              → {last.to_location_code ?? '—'} <span className="text-xs font-semibold text-white/80">({last.done}/{last.total} pallet của lệnh)</span>
            </p>
            {last.flow_note && <p className="text-[10px] text-white/80 mt-0.5">{last.flow_note}</p>}
          </div>
        )}
        {!err && !last && (
          <p className="text-[11px] text-white/60 text-center">Pallet hợp lệ sẽ TỰ chuyển sang vị trí đích — không cần bấm gì thêm</p>
        )}
      </div>
    </div>
  )
}
