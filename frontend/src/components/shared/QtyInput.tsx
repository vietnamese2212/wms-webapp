// QtyInput — ô nhập SỐ LƯỢNG chuẩn BASE UNIT (đợt 2, luật user 19/07):
// - Mã CÓ entry unit: 2 ô "Thùng + Hộp" SỐ NGUYÊN (hàng chẵn chỉ điền Thùng) → onChange trả SỐ BASE.
// - Mã KHÔNG entry: 1 ô, thập phân tự do (KG/EA/BAG…) → trả nguyên số.
// value luôn là BASE (một nguồn sự thật); component tự DIV/MOD để hiển thị 2 ô.
//
// part (chỉ đổi GIAO DIỆN, nguyên lý y hệt): render 1 ô lẻ để đặt ở 2 CỘT bảng riêng (Entry | Base).
// - part='entry': chỉ ô Thùng (mã không entry → "—" vì không có thùng).
// - part='base' : chỉ ô Hộp lẻ (mã có entry) HOẶC ô base thập phân (mã không entry: KG/EA).
// Cả 2 part đọc cùng `value` + gọi cùng `onChange(base)` → tách cột không đổi tính toán.
import { Input } from '@/components/ui/input'
import { hasEntry, qtySplit, qtyFromEntryBase, unitLabel, type MatUnits } from '@/utils/qtyUnits'

export function QtyInput({ value, mat, onChange, disabled, autoFocus, className, compact, part }: {
  value: number
  mat?: MatUnits | null
  onChange: (base: number) => void
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  /** compact: ô nhỏ dùng trong bảng/panel hẹp */
  compact?: boolean
  /** part: render 1 ô lẻ cho layout 2 cột (Entry | Base). Bỏ trống = 2 ô gộp như cũ. */
  part?: 'entry' | 'base'
}) {
  const h = compact ? 'h-8 text-sm' : 'h-10 text-lg'
  // Ô hẹp (compact): giảm padding ngang để số 3–4 chữ số không bị CẮT (mặc định Input là px-3 = 24px).
  const pad = compact ? 'px-1' : ''
  const noEntry = !hasEntry(mat)

  // ── Chế độ 1 CỘT (part) — chỉ khác cách bày, quy đổi giữ nguyên ──
  if (part) {
    if (part === 'entry') {
      // Mã không entry → không có "Thùng" → gạch ngang (base nằm ở cột kia)
      if (noEntry) return <div className={`text-center text-slate-300 text-xs ${className ?? ''}`}>—</div>
      const { entry, base } = qtySplit(value, mat)
      return (
        <div className={className ?? ''}>
          <Input
            type="number" min={0} step={1} disabled={disabled} autoFocus={autoFocus}
            className={`text-center font-semibold ${h} ${pad}`}
            value={entry}
            onChange={e => onChange(qtyFromEntryBase(Math.max(0, parseInt(e.target.value) || 0), base, mat))}
          />
          <p className="text-[9px] text-slate-400 text-center mt-0.5">{unitLabel(mat!.entry_unit)}</p>
        </div>
      )
    }
    // part === 'base'
    if (noEntry) {
      // Chỉ hiện nhãn khi mã CÓ base_unit thật (KG/EA/BAG…). Chưa chọn mã → không nhãn (unitLabel mặc định 'thùng' gây hiểu lầm).
      const bLbl = mat?.base_unit ? unitLabel(mat.base_unit) : ''
      return (
        <div className={className ?? ''}>
          <Input
            type="number" min={0} step="any" disabled={disabled} autoFocus={autoFocus}
            className={`text-center font-semibold ${h} ${pad}`}
            value={Number.isFinite(value) && value !== 0 ? value : (value === 0 ? 0 : '')}
            onChange={e => onChange(parseFloat(e.target.value) || 0)}
          />
          {bLbl && <p className="text-[9px] text-slate-400 text-center mt-0.5">{bLbl}</p>}
        </div>
      )
    }
    const { entry, base } = qtySplit(value, mat)
    return (
      <div className={className ?? ''}>
        <Input
          type="number" min={0} step={1} disabled={disabled}
          className={`text-center font-semibold ${h} ${pad}`}
          value={base}
          onChange={e => onChange(qtyFromEntryBase(entry, Math.max(0, parseInt(e.target.value) || 0), mat))}
        />
        <p className="text-[9px] text-slate-400 text-center mt-0.5">{unitLabel(mat!.base_unit)}</p>
      </div>
    )
  }

  // ── Chế độ 2 ô GỘP (mặc định) ──
  if (noEntry) {
    return (
      <Input
        type="number" min={0} step="any" disabled={disabled} autoFocus={autoFocus}
        className={`text-center font-semibold ${h} ${pad} ${className ?? ''}`}
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
          className={`text-center font-semibold ${h} ${pad}`}
          value={entry}
          onChange={e => onChange(qtyFromEntryBase(Math.max(0, parseInt(e.target.value) || 0), base, mat))}
        />
        <p className="text-[9px] text-slate-400 text-center mt-0.5">{eLbl}</p>
      </div>
      <span className="text-slate-400 text-sm shrink-0 pb-3">+</span>
      <div className="flex-1 min-w-0">
        <Input
          type="number" min={0} step={1} disabled={disabled}
          className={`text-center font-semibold ${h} ${pad}`}
          value={base}
          onChange={e => onChange(qtyFromEntryBase(entry, Math.max(0, parseInt(e.target.value) || 0), mat))}
        />
        <p className="text-[9px] text-slate-400 text-center mt-0.5">{bLbl}</p>
      </div>
    </div>
  )
}
