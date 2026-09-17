// SỔ PALLET — "tem này ai đã tác động vào, lúc nào" (17/09).
//
// User 17/09 hỏi có thứ gì "na ná MB51 của SAP cho pallet ID" không. App không có sổ hợp nhất: mỗi
// nghiệp vụ ghi một bảng riêng (nhập · chuyển ô · kiểm kê · điều chỉnh · dồn/tách · fill · xuất ·
// nhật ký việc). RPC `pallet_ledger` ghép chúng lại ở máy chủ; màn này chỉ trình bày.
//
// HAI NHÓM, KHÔNG TRỘN — đo thật: một pallet ở Ba Vì có 105 dòng nhật ký VIỆC (máy lập kế hoạch
// rồi huỷ qua nhiều chuyến) mà chỉ 2 dòng hàng thật sự bị động vào. Đổ chung một danh sách thì thứ
// người ta cần đọc chìm nghỉm ⇒ mặc định chỉ hiện nhóm HÀNG, nhật ký việc nằm sau một cú bấm.
// Cũng đúng cách SAP chia: MB51 là chứng từ vật tư, lệnh kho nằm ở LT23/LT24 riêng.
import { useState } from 'react'
import { Boxes, ClipboardList, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { usePalletLedger, type PalletLedgerEvent, type PalletLedgerEntry } from '@/api/hooks'
import { formatTimestampDate, formatTimestampTime, formatDate } from '@/utils/formatters'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'

const nf = (n: number) => n.toLocaleString('vi-VN')

/** Nhãn + màu cho từng loại tác động. Chữ nói việc NGƯỜI làm, không nói tên bảng. */
const KIND: Record<string, { label: string; cls: string }> = {
  PACKED:    { label: 'Ghi sổ đóng gói (SX)',  cls: 'bg-slate-100 text-slate-700' },
  RECEIVED:  { label: 'Vào sổ tồn',            cls: 'bg-emerald-100 text-emerald-700' },
  MOVED:     { label: 'Chuyển vị trí',         cls: 'bg-sky-100 text-sky-700' },
  COUNTED:   { label: 'Kiểm kê',               cls: 'bg-indigo-100 text-indigo-700' },
  ADJUSTED:  { label: 'Điều chỉnh tồn',        cls: 'bg-amber-100 text-amber-800' },
  MERGED:    { label: 'Dồn pallet',            cls: 'bg-purple-100 text-purple-700' },
  SPLIT:     { label: 'Tách pallet',           cls: 'bg-purple-100 text-purple-700' },
  UNGROUPED: { label: 'Gỡ nhóm',               cls: 'bg-purple-100 text-purple-700' },
  UNDONE:    { label: 'Hoàn tác thao tác',     cls: 'bg-slate-200 text-slate-600' },
  FILLED:    { label: 'Hạ xuống kho lẻ',       cls: 'bg-teal-100 text-teal-700' },
  PICKED:    { label: 'Xuất hàng',             cls: 'bg-red-100 text-red-700' },
  TASK_PLANNED:   { label: 'Máy giao việc',    cls: 'bg-slate-100 text-slate-500' },
  TASK_CLAIMED:   { label: 'Nhận việc',        cls: 'bg-sky-50 text-sky-700' },
  TASK_UNCLAIMED: { label: 'Trả việc',         cls: 'bg-slate-100 text-slate-500' },
  TASK_LOWERED:   { label: 'Bấm ✓ đã hạ',      cls: 'bg-sky-50 text-sky-700' },
  TASK_MOVED:     { label: 'Bấm ✓ đã đưa ra',  cls: 'bg-sky-50 text-sky-700' },
  TASK_DONE:      { label: 'Quét đủ — việc xong', cls: 'bg-green-50 text-green-700' },
  TASK_SKIPPED:   { label: 'Hệ thống huỷ việc', cls: 'bg-slate-100 text-slate-500' },
  TASK_CANCELLED: { label: 'Việc bị bỏ',       cls: 'bg-slate-100 text-slate-500' },
  TASK_REPLANNED: { label: 'Sắp lại kế hoạch', cls: 'bg-slate-100 text-slate-500' },
}
const kindOf = (k: string) => KIND[k] ?? { label: k, cls: 'bg-slate-100 text-slate-600' }

/** Số lượng của dòng — base thì qua `qtyLabel` (luật một nguồn), sổ đóng gói ghi thùng thì nói "thùng". */
function qtyOf(e: PalletLedgerEvent, units: MatUnits | null): string | null {
  if (e.qty_cartons != null) return `${nf(Number(e.qty_cartons))} thùng`
  if (e.qty_base == null) return null
  const n = Number(e.qty_base)
  const s = qtyLabel(Math.abs(n), units ?? {})
  return e.kind === 'ADJUSTED' ? `${n > 0 ? '+' : '−'}${s}` : s
}

function EventRow({ e, units }: { e: PalletLedgerEvent; units: MatUnits | null }) {
  const k = kindOf(e.kind)
  const qty = qtyOf(e, units)
  return (
    <div className="flex gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <div className="w-[68px] shrink-0 text-[10px] leading-tight text-slate-500 tabular-nums">
        <div>{formatTimestampDate(e.at, true)}</div>
        <div className="text-slate-400">{formatTimestampTime(e.at)}</div>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${k.cls}`}>{k.label}</span>
          {qty && <span className="text-[11px] font-semibold tabular-nums text-slate-700">{qty}</span>}
          {/* AI làm — thứ user hỏi đầu tiên. Không có thì nói thẳng là không có, đừng để trống lửng lơ. */}
          <span className={`text-[11px] ${e.actor ? 'text-slate-700' : 'text-slate-400 italic'}`}>
            · {e.actor ?? 'không ghi người'}
          </span>
        </div>
        {(e.from_code || e.to_code) && (
          <div className="text-[10px] font-mono text-slate-500">
            {e.from_code ?? '—'} <span className="text-slate-300">→</span> {e.to_code ?? '—'}
          </div>
        )}
        {(e.ref || e.note) && (
          <div className="text-[10px] text-slate-500">
            {e.ref && <span className="font-mono">{e.ref}</span>}
            {e.ref && e.note && <span className="text-slate-300"> · </span>}
            {e.note && <span className="italic">{e.note}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function EntryCard({ en }: { en: PalletLedgerEntry }) {
  const units: MatUnits = en
  const remain = Number(en.cartons_remaining ?? 0)
  return (
    <div className="rounded border bg-slate-50 px-2 py-1.5 text-[11px] space-y-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-mono font-semibold">{en.material_code ?? '—'}</span>
        <span className="truncate text-slate-600">{en.material_name ?? ''}</span>
      </div>
      <div className="text-slate-600">
        {en.warehouse_name ?? '—'} · <span className="font-mono">{en.location_code ?? 'chưa có vị trí'}</span>
        {en.status && <span className="text-slate-400"> · {en.status}</span>}
      </div>
      <div className="text-slate-600">
        Còn <span className="font-semibold tabular-nums">{qtyLabel(remain, units)}</span>
        <span className="text-slate-400"> / nhập {qtyLabel(Number(en.cartons_imported ?? 0), units)}</span>
        {en.production_date && <span className="text-slate-400"> · NSX {formatDate(en.production_date)}</span>}
      </div>
    </div>
  )
}

export function PalletLedgerDialog({ palletCode, onClose }: { palletCode: string; onClose: () => void }) {
  const { data, isLoading } = usePalletLedger(palletCode)
  const [showTasks, setShowTasks] = useState(false)

  const events = data?.events ?? []
  const stock = events.filter(e => e.grp === 'STOCK')
  const tasks = events.filter(e => e.grp === 'TASK')
  // Đơn vị tính lấy từ chính bản ghi tồn của tem (mọi dòng cùng một mã hàng)
  const units: MatUnits | null = (data?.entries ?? [])[0] ?? null
  const shown = showTasks ? events : stock

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg p-0 gap-0">
        <DialogHeader className="px-3 py-2 border-b bg-slate-50 text-left">
          <DialogTitle className="text-xs font-semibold text-slate-700">
            Lịch sử pallet
            {/* Tem V2 mang đệm SPACE — giữ nguyên (whitespace-pre-wrap), đừng để HTML gộp lại */}
            <div className="mt-0.5 font-mono text-[11px] font-normal whitespace-pre-wrap [overflow-wrap:anywhere]">
              {palletCode}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-auto p-3 space-y-3" style={{ maxHeight: '72vh' }}>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-5 animate-pulse rounded bg-slate-100" />)}</div>
          ) : (
            <>
              {(data?.entries ?? []).map(en => <EntryCard key={en.entry_id} en={en} />)}

              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Tác động lên hàng ({nf(stock.length)})
                </span>
                {tasks.length > 0 && (
                  <button type="button" onClick={() => setShowTasks(v => !v)}
                    title="Nhật ký việc: máy giao việc, người nhận / trả, bấm ✓ — không phải lần nào cũng làm hàng đổi chỗ"
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50">
                    <ClipboardList className="h-3 w-3" />
                    {showTasks ? 'Ẩn' : 'Hiện'} nhật ký việc ({nf(tasks.length)})
                  </button>
                )}
              </div>

              {shown.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-slate-400">
                  Chưa có tác động nào được ghi cho tem này.
                </p>
              ) : (
                <div className="rounded border px-2">
                  {shown.map((e, i) => <EventRow key={`${e.at}-${e.kind}-${i}`} e={e} units={units} />)}
                </div>
              )}

              <p className="text-[10px] leading-snug text-slate-400">
                <Boxes className="mr-1 inline h-3 w-3" />
                Sổ gộp từ các đường đang ghi sẵn: đóng gói · vào sổ tồn · chuyển vị trí · kiểm kê ·
                điều chỉnh · dồn/tách · fill kho lẻ · xuất hàng. Dòng “không ghi người” là bản ghi vào
                bằng upload/script — đường thao tác trong app đều có tên.
              </p>
            </>
          )}
        </div>

        <button onClick={onClose} className="absolute right-2 top-2 text-slate-400 hover:text-slate-700" aria-label="Đóng">
          <X className="h-4 w-4" />
        </button>
      </DialogContent>
    </Dialog>
  )
}
