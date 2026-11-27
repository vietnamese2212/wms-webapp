// QtyInput — ô nhập SỐ LƯỢNG chuẩn BASE UNIT (đợt 2, luật user 19/07):
// - Mã CÓ entry unit: 2 ô "Thùng + Hộp" SỐ NGUYÊN (hàng chẵn chỉ điền Thùng) → onChange trả SỐ BASE.
//   Mã CÂN / ĐONG có quy cách (KG / L — vd đường 1 bao = 20 kg, 27/11): MỘT ô kg thập phân + dòng gợi ý "= 5 bao + 10 kg".
// - Mã KHÔNG entry: 1 ô, thập phân tự do (KG/EA/BAG…) → trả nguyên số.
// value luôn là BASE (một nguồn sự thật); component tự DIV/MOD để hiển thị 2 ô.
//
// part (chỉ đổi GIAO DIỆN, nguyên lý y hệt): render 1 ô lẻ để đặt ở 2 CỘT bảng riêng (Entry | Base).
// - part='entry': chỉ ô Thùng (mã không entry → "—" vì không có thùng).
// - part='base' : chỉ ô Hộp lẻ (mã có entry) HOẶC ô base thập phân (mã không entry: KG/EA).
// Cả 2 part đọc cùng `value` + gọi cùng `onChange(base)` → tách cột không đổi tính toán.
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { hasEntry, isPackHintMaterial, qtyPackHint, qtySplit, qtyFromEntryBase, unitLabel, type MatUnits } from '@/utils/qtyUnits'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'

// 25/11 (F2 rà soát MES, user đồng ý sửa ở ô DÙNG CHUNG): ô số THẬP PHÂN (mã không có đơn vị nhập — KG / L / BAG…) trước dùng
// <input type="number"> + parseFloat ⇒ máy để ngôn ngữ không nhận dấu phẩy thì gõ "12,5" ra 0 / số sai. Nay là ô chữ
// inputMode="decimal" + parseVnNumber (cùng luật mọi ô số khác của app — phẩy = thập phân), giữ chuỗi đang gõ ("12,") không bị đè.
function DecimalQty({ value, onChange, disabled, autoFocus, className }: {
  value: number; onChange: (n: number) => void; disabled?: boolean; autoFocus?: boolean; className: string
}) {
  const shown = (v: number) => (Number.isFinite(v) ? (v === 0 ? '0' : vnNumberInput(v)) : '')
  const [draft, setDraft] = useState(() => shown(value))
  // số đổi từ ngoài (điền sẵn, đặt lại form) ⇒ hiện số mới; số đổi do chính mình gõ ⇒ giữ nguyên chuỗi đang gõ
  useEffect(() => {
    const cur = draft.trim() === '' ? 0 : parseVnNumber(draft)
    if (cur !== value) setDraft(shown(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Input
      type="text" inputMode="decimal" disabled={disabled} autoFocus={autoFocus} className={className}
      value={draft}
      onChange={e => { const raw = e.target.value; setDraft(raw); onChange(Math.max(0, parseVnNumber(raw) ?? 0)) }}
    />
  )
}

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
  // Ô nhập số trên điện thoại cao 44 px (chuẩn chạm, rà 21/09); desktop giữ 40. compact (trong bảng) không đổi.
  const h = compact ? 'h-8 text-sm' : 'h-11 sm:h-10 text-lg'
  // Ô hẹp (compact): giảm padding ngang để số 3–4 chữ số không bị CẮT (mặc định Input là px-3 = 24px).
  const pad = compact ? 'px-1' : ''
  const noEntry = !hasEntry(mat)
  // Mã cân / đong có quy cách (đường: KG + 1 bao = 20 kg — 27/11): nhập MỘT ô kg như mã không quy cách,
  // quy cách chỉ hiện GỢI Ý ("= 5 bao + 10 kg") — user: "110 kg có gợi ý là 5 bao 10 kg"
  const packHint = isPackHintMaterial(mat)
  const hintText = packHint ? qtyPackHint(value, mat) : null

  // ── Chế độ 1 CỘT (part) — chỉ khác cách bày, quy đổi giữ nguyên ──
  if (part) {
    if (part === 'entry') {
      // mã cân / đong: cột quy cách chỉ hiện gợi ý (số nhập ở cột đơn vị gốc) — xét TRƯỚC noEntry vì mã này không có entry unit
      if (packHint) return <div className={`text-center text-[11px] text-slate-500 tabular-nums ${className ?? ''}`} data-testid="qty-pack-hint">{hintText ?? '—'}</div>
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
    if (noEntry || packHint) {
      // Chỉ hiện nhãn khi mã CÓ base_unit thật (KG/EA/BAG…). Chưa chọn mã → không nhãn (unitLabel mặc định 'thùng' gây hiểu lầm).
      const bLbl = mat?.base_unit ? unitLabel(mat.base_unit) : ''
      return (
        <div className={className ?? ''}>
          <DecimalQty value={value} onChange={onChange} disabled={disabled} autoFocus={autoFocus} className={`text-center font-semibold ${h} ${pad}`} />
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
  // mã cân / đong có quy cách gợi ý — xét TRƯỚC noEntry (mã này không có entry unit; 27/11)
  if (packHint) {
    return (
      <div className={className ?? ''}>
        <DecimalQty value={value} onChange={onChange} disabled={disabled} autoFocus={autoFocus} className={`text-center font-semibold ${h} ${pad}`} />
        {hintText && <p className="text-[10px] text-slate-500 text-center mt-0.5 tabular-nums" data-testid="qty-pack-hint">= {hintText}</p>}
      </div>
    )
  }
  if (noEntry) {
    return (
      <DecimalQty value={value} onChange={onChange} disabled={disabled} autoFocus={autoFocus} className={`text-center font-semibold ${h} ${pad} ${className ?? ''}`} />
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
