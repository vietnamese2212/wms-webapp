// QtyInput — ô nhập SỐ LƯỢNG chuẩn BASE UNIT (đợt 2, luật user 19/07):
// - Mã CÓ entry unit: 2 ô "Thùng + Hộp" SỐ NGUYÊN (hàng chẵn chỉ điền Thùng) → onChange trả SỐ BASE.
// - Mã KHÔNG entry: 1 ô, thập phân tự do (KG/EA/BAG…) → trả nguyên số.
// value luôn là BASE (một nguồn sự thật); component tự DIV/MOD để hiển thị 2 ô.
import { Input } from '@/components/ui/input'
import { hasEntry, qtySplit, qtyFromEntryBase, unitLabel, type MatUnits } from '@/utils/qtyUnits'

export function QtyInput({ value, mat, onChange, disabled, autoFocus, className, compact }: {
  value: number
  mat?: MatUnits | null
  onChange: (base: number) => void
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  /** compact: ô nhỏ dùng trong bảng/panel hẹp */
  compact?: boolean
}) {
  const h = compact ? 'h-8 text-sm' : 'h-10 text-lg'
  if (!hasEntry(mat)) {
    return (
      <Input
        type="number" min={0} step="any" disabled={disabled} autoFocus={autoFocus}
        className={`text-center font-semibold ${h} ${className ?? ''}`}
        value={Number.isFinite(value) && value !== 0 ? value : (value === 0 ? 0 : '')}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
      />
    )
  }
  const { entry, base } = qtySplit(value, mat)
  const eLbl = unitLabel(mat!.entry_unit)
  const bLbl = unitLabel(mat!.base_unit)
  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <div className="flex-1 min-w-0">
        <Input
          type="number" min={0} step={1} disabled={disabled} autoFocus={autoFocus}
          className={`text-center font-semibold ${h}`}
          value={entry}
          onChange={e => onChange(qtyFromEntryBase(Math.max(0, parseInt(e.target.value) || 0), base, mat))}
        />
        <p className="text-[9px] text-slate-400 text-center mt-0.5">{eLbl}</p>
      </div>
      <span className="text-slate-400 text-sm shrink-0 pb-3">+</span>
      <div className="flex-1 min-w-0">
        <Input
          type="number" min={0} step={1} disabled={disabled}
          className={`text-center font-semibold ${h}`}
          value={base}
          onChange={e => onChange(qtyFromEntryBase(entry, Math.max(0, parseInt(e.target.value) || 0), mat))}
        />
        <p className="text-[9px] text-slate-400 text-center mt-0.5">{bLbl}</p>
      </div>
    </div>
  )
}
