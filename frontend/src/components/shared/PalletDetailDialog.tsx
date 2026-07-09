import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useInventoryEntry } from '@/api/hooks'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { computePctDate } from '@/utils/shelfLife'

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'Còn hàng', PARTIAL: 'Xuất 1 phần', EXPORTED: 'Đã xuất',
  TRANSFERRED: 'Đã chuyển', QUARANTINE: 'Cách ly', CANCELLED: 'Đã hủy',
}
const STATUS_CLS: Record<string, string> = {
  IN_STOCK: 'bg-green-100 text-green-700', PARTIAL: 'bg-amber-100 text-amber-700',
  EXPORTED: 'bg-blue-100 text-blue-700', TRANSFERRED: 'bg-slate-100 text-slate-600',
  QUARANTINE: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500',
}

function datePctCls(pct: number): string {
  if (pct >= 70) return 'text-green-600 font-semibold'
  if (pct >= 40) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ label, value, mono, bold, cls, wrap }: {
  label: string; value: string; mono?: boolean; bold?: boolean; cls?: string; wrap?: boolean
}) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-slate-400 shrink-0 text-[11px]">{label}</span>
      <span className={`text-right text-[11px] ${wrap ? 'break-words min-w-0' : 'truncate'} ${mono ? 'font-mono' : ''} ${bold ? 'font-semibold' : ''} ${cls ?? 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  )
}

export function PalletDetailDialog({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { data: entry, isLoading } = useInventoryEntry(entryId)

  const remaining = entry ? (entry.cartons_remaining ?? entry.cartons_imported) : 0
  const exported  = entry ? Math.max(0, Number(entry.cartons_imported) - Number(remaining)) : 0
  const pct       = entry ? computePctDate(entry, entry.material) : null

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-xs p-0">
        <DialogHeader className="px-3 py-2 border-b bg-slate-50">
          {/* whitespace-pre (thay nowrap của truncate): tem V2 có đệm SPACE trong mã — HTML gộp space làm user tưởng lưu sai */}
          <DialogTitle className="text-xs font-mono font-semibold overflow-hidden text-ellipsis whitespace-pre">
            {isLoading ? '…' : (entry?.pallet_code ?? '—')}
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-auto p-3 space-y-3" style={{ maxHeight: '70vh' }}>
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : !entry ? (
            <p className="text-slate-400 text-center py-4 text-xs">Không tìm thấy pallet</p>
          ) : (
            <>
              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[entry.status] ?? 'bg-gray-100 text-gray-500'}`}>
                {STATUS_LABEL[entry.status] ?? entry.status}
              </span>

              <Section title="Thông tin hàng">
                <Row label="Kho"      value={entry.location?.warehouse?.name ?? '—'} />
                <Row label="Vị trí"   value={entry.location?.location_code ?? '—'} mono />
                <Row label="Mã hàng"  value={entry.material?.material_code ?? '—'} mono />
                <Row label="Tên hàng" value={entry.material?.short_name ?? '—'} wrap />
                {entry.qa_status && (
                  <Row label="QA" value={`${entry.qa_status.code} – ${entry.qa_status.name}`} />
                )}
                {entry.batch && <Row label="Mã lô" value={entry.batch} mono />}
              </Section>

              <Section title="Số lượng">
                <Row label="Nhập" value={`${entry.cartons_imported} thùng`} />
                {exported > 0 && <Row label="Xuất" value={`${exported} thùng`} />}
                <Row label="Tồn"  value={`${remaining} thùng`} bold />
                {entry.adjustment_qty != null && Number(entry.adjustment_qty) !== 0 && (
                  <Row label="Điều chỉnh"
                    value={`${Number(entry.adjustment_qty) > 0 ? '+' : ''}${entry.adjustment_qty}`}
                    cls={Number(entry.adjustment_qty) > 0 ? 'text-green-600' : 'text-red-600'} />
                )}
              </Section>

              <Section title="Ngày / Hạn dùng">
                <Row label="NSX"
                  value={entry.production_date ? formatTimestampDate(entry.production_date, false) : '—'} />
                {entry.expiry_date
                  ? <Row label="HSD" value={formatTimestampDate(entry.expiry_date, false)} bold />
                  : entry.material?.shelf_life_days != null && (
                    <Row label="HSD" value={`${entry.material.shelf_life_days} ngày`} />
                  )}
                {pct !== null && (
                  <Row label="%Date" value={`${pct}%`} cls={datePctCls(pct)} bold />
                )}
              </Section>

              {(entry.manufacturer || entry.cycle || entry.machine_code) && (
                <Section title="Sản xuất">
                  {entry.manufacturer && <Row label="NMSX"    value={entry.manufacturer.code} mono />}
                  {entry.cycle        && <Row label="Chu kỳ"  value={entry.cycle} mono />}
                  {entry.machine_code && <Row label="Máy"     value={entry.machine_code} mono />}
                </Section>
              )}

              <Section title="Nhập kho">
                <Row label="Ngày nhập"  value={entry.import_date ? formatTimestampDate(entry.import_date) : '—'} />
                <Row label="Giờ nhập"   value={entry.created_at ? formatTimestampTime(entry.created_at) : '—'} />
                <Row label="Người nhập" value={entry.created_by_emp?.name ?? '—'} />
              </Section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
