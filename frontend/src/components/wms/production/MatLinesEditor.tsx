// BẢNG "NGUYÊN LIỆU + SỐ LƯỢNG" dùng chung cho CÔNG THỨC của mã bán thành phẩm và PHIẾU (định mức) của một mẻ (MES 14/11 → 17/11).
// Dạng BẢNG theo chuẩn bảng của app (user 17/11: "định mức, công thức làm dạng bảng — đồng bộ UI/UX của app"), giống phiếu chế biến
// giấy: STT · Mã · Nguyên liệu · (Gốc) · Số lượng · ĐVT · (± %) · thao tác — ResizableTable (luật C40) trong khung `overflow-x-auto`
// (điện thoại cuộn ngang, không ẩn cột). Thêm mã bằng ô tìm trên server dưới bảng.
//   • withTol (công thức): cột "± %" = mức lệch cho phép của dòng (trống = không kiểm).
//   • allowSwap (phiếu của mẻ): cột "Gốc" (định mức gốc theo công thức) + nút ⇄ "Đổi mã" — giữ số lượng, đổi sang mã khác, ghi "thay cho".
import { useState } from 'react'
import { X, ArrowLeftRight } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { Input } from '@/components/ui/input'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { useMaterials } from '@/api/hooks'
import { unitCode } from '@/utils/unitCode'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'

export interface MatLine {
  material_id: string; material_code: string; material_name: string | null; base_unit: string | null; qty: string
  /** mức lệch cho phép, % (chỉ ở công thức) — chuỗi trống = không kiểm */
  tol?: string
  /** định mức gốc trên phiếu của mẻ (chỉ để hiện) — null = dòng ngoài công thức */
  standard?: number | null
  /** đổi mã: dòng này thay cho mã nào của phiếu */
  replaces?: string; replacesCode?: string
}
export const toMatLine = (m: { material_id: string; material_code: string; material_name: string | null; base_unit?: string | null }, qty: number | null | undefined,
  extra: Partial<MatLine> = {}): MatLine =>
  ({ material_id: m.material_id, material_code: m.material_code, material_name: m.material_name, base_unit: m.base_unit ?? null, qty: vnNumberInput(qty ?? null), ...extra })
const tolOf = (l: MatLine): number | null => (l.tol?.trim() ? parseVnNumber(l.tol) : null)
/** Lỗi của một dòng (rỗng = hợp lệ). */
export const matLineError = (l: MatLine): string => {
  const n = l.qty.trim() ? parseVnNumber(l.qty) : null
  if (n == null || n <= 0) return 'Nhập số lượng lớn hơn 0'
  if (l.tol?.trim()) { const t = tolOf(l); if (t == null || t < 0 || t > 100) return 'Mức lệch từ 0 tới 100 %' }
  return ''
}
/** Phiếu của mẻ: số lượng + đổi mã */
export const matLinesPayload = (lines: MatLine[]) =>
  lines.map(l => ({ material_id: l.material_id, qty: parseVnNumber(l.qty) as number, ...(l.replaces ? { replaces: l.replaces } : {}) }))
/** Công thức: số lượng + mức lệch */
export const recipeLinesPayload = (lines: MatLine[]) => lines.map(l => ({ material_id: l.material_id, qty: parseVnNumber(l.qty) as number, tol_pct: tolOf(l) }))
const nf = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 })

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap align-middle'
const INP = 'h-8 sm:h-7 text-[11px] text-right tabular-nums'

export function MatLinesEditor({ lines, onChange, excludeId, disabled, emptyText, withTol, allowSwap }: {
  lines: MatLine[]; onChange: (l: MatLine[]) => void
  /** mã không được chọn (chính mã bán thành phẩm) */
  excludeId?: string
  disabled?: boolean
  emptyText?: string
  withTol?: boolean
  allowSwap?: boolean
}) {
  const [term, setTerm] = useState('')
  const [swapIdx, setSwapIdx] = useState<number | null>(null)
  const { data: found = [], isFetching } = useMaterials({ search: term || undefined, limit: 50 }, !disabled)
  const have = new Set(lines.map(l => l.material_id))
  const opts = found.filter(m => !have.has(m.id) && m.id !== excludeId)
    .map(m => ({ value: m.id, label: m.material_code, sub: `${m.short_name ?? m.material_description ?? ''} · ${unitCode(m.base_unit)}` }))
  const pick = (id: string) => {
    const m = found.find(x => x.id === id)
    return m ? { material_id: m.id, material_code: m.material_code, material_name: m.short_name ?? m.material_description ?? null, base_unit: m.base_unit ?? null } : null
  }
  function add(id: string) {
    const m = pick(id)
    if (m) onChange([...lines, { ...m, qty: '', ...(withTol ? { tol: '' } : {}), ...(allowSwap ? { standard: null } : {}) }])
  }
  function swap(i: number, id: string) {
    const m = pick(id)
    if (!m) return
    // đổi lần hai vẫn ghi "thay cho" mã GỐC của phiếu, không phải mã vừa đổi
    onChange(lines.map((x, j) => (j === i ? { ...x, ...m, standard: null, replaces: x.replaces ?? x.material_id, replacesCode: x.replacesCode ?? x.material_code } : x)))
    setSwapIdx(null)
  }
  const set = (i: number, patch: Partial<MatLine>) => onChange(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const errs = lines.map((l, i) => ({ i, e: l.qty.trim() || l.tol?.trim() ? matLineError(l) : '' })).filter(x => x.e)
  // bộ cột theo chế độ (công thức: ± % · phiếu của mẻ: Gốc) — mỗi bộ một khoá lưu độ rộng
  const cols: RtColDef[] = [
    { id: 'stt', label: 'STT', w: 44, align: 'right' }, { id: 'code', label: 'Mã', w: 104 }, { id: 'name', label: 'Nguyên liệu', w: 220 },
    ...(allowSwap ? [{ id: 'std', label: 'Gốc', w: 84, align: 'right' as const }] : []),
    { id: 'qty', label: 'Số lượng', w: 112, align: 'right' }, { id: 'unit', label: 'ĐVT', w: 64 },
    ...(withTol ? [{ id: 'tol', label: '± %', w: 72, align: 'right' as const }] : []),
    ...(disabled ? [] : [{ id: 'act', label: '', w: allowSwap ? 76 : 48, stickyRight: true }]),
  ]
  const sig = cols.map(c => c.id).join('-')

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <ResizableTable key={sig} storageKey={`production_matlines_cols_${sig}`} cols={cols}>
          <TableBody>
            {!lines.length && <TableEmptyRow colSpan={cols.length}>{emptyText ?? 'Chưa có nguyên liệu nào.'}</TableEmptyRow>}
            {lines.map((l, i) => {
              const e = l.qty.trim() || l.tol?.trim() ? matLineError(l) : ''
              const q = l.qty.trim() ? parseVnNumber(l.qty) : null
              const off = l.standard != null && q != null && Math.abs(q - Number(l.standard)) > 0.0005
              return (
                <TableRow key={`${l.material_id}-${i}`}>
                  <TableCell className={`${TD} sticky left-0 z-10 bg-white text-right tabular-nums text-slate-400`}>{i + 1}</TableCell>
                  {swapIdx === i ? (
                    <TableCell colSpan={2} className={TD}>
                      <div className="flex items-center gap-1 min-w-[240px]">
                        <div className="flex-1 min-w-0">
                          <SingleSelect value="" onChange={id => swap(i, id)} serverSearch onSearchChange={setTerm} loading={isFetching} selectedLabel={undefined}
                            triggerClassName="h-8 sm:h-7 text-[11px]" placeholder={`Đổi ${l.material_code} sang mã…`} options={opts} />
                        </div>
                        <button type="button" className="touch-target text-[11px] text-slate-500 hover:underline shrink-0" onClick={() => setSwapIdx(null)}>Thôi</button>
                      </div>
                    </TableCell>
                  ) : (<>
                    <TableCell className={`${TD} font-mono font-semibold`}>{l.material_code}</TableCell>
                    <TableCell className={`${TD} truncate`} title={l.material_name ?? ''}>
                      {l.material_name ?? ''}
                      {l.replacesCode && <span className="ml-1 text-[9px] text-blue-700">thay cho {l.replacesCode}</span>}
                    </TableCell>
                  </>)}
                  {allowSwap && (
                    <TableCell className={`${TD} text-right tabular-nums ${off ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
                      {l.standard != null ? nf(Number(l.standard)) : <span className="text-[9px] text-slate-400">ngoài CT</span>}
                    </TableCell>
                  )}
                  <TableCell className={`${TD} text-right`}>
                    <Input value={l.qty} disabled={disabled} inputMode="decimal" placeholder="0" aria-label={`Số lượng ${l.material_code}`} title={e || undefined}
                      onChange={ev => set(i, { qty: ev.target.value })}
                      className={`${INP} w-full ${e ? 'border-red-400' : off ? 'border-amber-400' : ''}`} />
                  </TableCell>
                  <TableCell className={`${TD} font-mono text-slate-500`}>{unitCode(l.base_unit)}</TableCell>
                  {withTol && (
                    <TableCell className={`${TD} text-right`}>
                      <Input value={l.tol ?? ''} disabled={disabled} inputMode="decimal" placeholder="—" aria-label={`Mức lệch cho phép ${l.material_code} (%)`}
                        onChange={ev => set(i, { tol: ev.target.value })} className={`${INP} w-full`} />
                    </TableCell>
                  )}
                  {!disabled && (
                    <TableCell className={`${TD} sticky right-0 z-10 bg-white text-right`}>
                      <div className="inline-flex items-center gap-0.5">
                        {allowSwap && swapIdx !== i && (
                          <button type="button" className="touch-target inline-flex items-center justify-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
                            title={`Đổi ${l.material_code} sang mã khác (giữ số lượng)`} aria-label={`Đổi mã ${l.material_code}`} onClick={() => setSwapIdx(i)}><ArrowLeftRight className="h-3.5 w-3.5" /></button>
                        )}
                        <button type="button" className="touch-target inline-flex items-center justify-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                          title={`Bỏ ${l.material_code}`} aria-label={`Bỏ ${l.material_code}`} onClick={() => { onChange(lines.filter((_, j) => j !== i)); setSwapIdx(null) }}><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </ResizableTable>
      </div>
      {errs.length > 0 && <p className="text-[11px] text-red-600">{errs.map(x => `Dòng ${x.i + 1}: ${x.e}`).join(' · ')}</p>}
      {!disabled && (
        <SingleSelect value="" onChange={add} serverSearch onSearchChange={setTerm} loading={isFetching} selectedLabel={undefined}
          placeholder="+ Thêm nguyên liệu — tìm mã hoặc tên" options={opts} />
      )}
    </div>
  )
}
