// BẢNG "NGUYÊN LIỆU + SỐ LƯỢNG" dùng chung cho ĐỊNH MỨC của mã bán thành phẩm và YÊU CẦU của một mẻ (MES 14/11):
// mỗi dòng một nguyên liệu, gõ số lượng theo đơn vị gốc của mã đó; thêm mã bằng ô tìm trên server; bỏ dòng bằng nút ✕.
import { useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { useMaterials } from '@/api/hooks'
import { unitLabel } from '@/utils/qtyUnits'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'

export interface MatLine { material_id: string; material_code: string; material_name: string | null; base_unit: string | null; qty: string }
export const toMatLine = (m: { material_id: string; material_code: string; material_name: string | null; base_unit?: string | null }, qty: number | null | undefined): MatLine =>
  ({ material_id: m.material_id, material_code: m.material_code, material_name: m.material_name, base_unit: m.base_unit ?? null, qty: vnNumberInput(qty ?? null) })
/** Lỗi của một dòng (rỗng = hợp lệ). */
export const matLineError = (l: MatLine): string => {
  const n = l.qty.trim() ? parseVnNumber(l.qty) : null
  return n == null || n <= 0 ? 'Nhập số lượng lớn hơn 0' : ''
}
export const matLinesPayload = (lines: MatLine[]) => lines.map(l => ({ material_id: l.material_id, qty: parseVnNumber(l.qty) as number }))

export function MatLinesEditor({ lines, onChange, excludeId, disabled, emptyText }: {
  lines: MatLine[]; onChange: (l: MatLine[]) => void
  /** mã không được chọn (chính mã bán thành phẩm) */
  excludeId?: string
  disabled?: boolean
  emptyText?: string
}) {
  const [term, setTerm] = useState('')
  const { data: found = [], isFetching } = useMaterials({ search: term || undefined, limit: 50 }, !disabled)
  const have = new Set(lines.map(l => l.material_id))
  const opts = found.filter(m => !have.has(m.id) && m.id !== excludeId)
    .map(m => ({ value: m.id, label: m.material_code, sub: `${m.short_name ?? m.material_description ?? ''} · ${unitLabel(m.base_unit)}` }))
  function add(id: string) {
    const m = found.find(x => x.id === id)
    if (!m) return
    onChange([...lines, { material_id: m.id, material_code: m.material_code, material_name: m.short_name ?? m.material_description ?? null, base_unit: m.base_unit ?? null, qty: '' }])
  }
  return (
    <div className="space-y-1.5">
      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
        {!lines.length && <p className="px-2.5 py-2 text-[11px] text-slate-400">{emptyText ?? 'Chưa có nguyên liệu nào.'}</p>}
        {lines.map((l, i) => {
          const e = l.qty.trim() ? matLineError(l) : ''
          return (
            <div key={l.material_id} className="flex items-center gap-2 px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate" title={l.material_name ?? ''}><span className="font-mono font-semibold">{l.material_code}</span> <span className="text-slate-600">{l.material_name ?? ''}</span></p>
                {e && <p className="text-[10px] text-red-600">{e}</p>}
              </div>
              <Input value={l.qty} disabled={disabled} inputMode="decimal" placeholder="0" aria-label={`Số lượng ${l.material_code}`}
                onChange={ev => onChange(lines.map((x, j) => (j === i ? { ...x, qty: ev.target.value } : x)))}
                className={`h-9 sm:h-8 w-24 text-xs text-right tabular-nums shrink-0 ${e ? 'border-red-400' : ''}`} />
              <span className="min-w-[1.5rem] text-[11px] text-slate-500 shrink-0">{unitLabel(l.base_unit)}</span>
              {!disabled && (
                <button type="button" className="touch-target inline-flex items-center justify-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 shrink-0"
                  title={`Bỏ ${l.material_code}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
          )
        })}
      </div>
      {!disabled && (
        <SingleSelect value="" onChange={add} serverSearch onSearchChange={setTerm} loading={isFetching} selectedLabel={undefined}
          placeholder="+ Thêm nguyên liệu — tìm mã hoặc tên" options={opts} />
      )}
    </div>
  )
}
