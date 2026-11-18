// PHIẾU THEO DÕI của mẻ — thay phiếu giấy. Ô lấy theo MẪU PHIẾU (Cài đặt MES); tại bàn người ghi được SỬA RIÊNG cho lần này
// (user: "cho phép sửa theo từng lần nếu muốn tại bàn"): "+ Thêm lần" ở bảng, "+ Thêm ô" ở nhóm — bấm là lưu ngay; đổi sâu hơn thì
// "Sửa cấu trúc". Bản sửa riêng lưu cùng phiếu (batch_process_log.blocks), mẫu chung không đổi; "Về theo mẫu chung" bỏ bản sửa riêng.
// 18/11 — GHI TỪNG Ô (user: "cho nút ở các input, bấm vào sẽ hiện lên yêu cầu Input, nếu thời gian thì tự lấy thời gian"): mỗi ô là MỘT
// NÚT — ô Giờ còn trống bấm là ghi GIỜ MÁY CHỦ; ô khác (hoặc ô giờ muốn sửa) bấm hiện khung nhập. Mỗi lần ghi lưu NGAY một ô (hàm DB
// mes_log_cell) ⇒ không còn nút "Lưu phiếu", nhiều người ghi các ô khác nhau không đè nhau. Ô số vượt ngưỡng tô đỏ nhưng VẪN lưu.
// QA xác nhận ⇒ phiếu khoá (và chụp mẫu đang áp vào phiếu); QA bỏ xác nhận thì sửa lại được.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { Clock, ShieldCheck, FileDown, Plus, Wrench, Undo2, Check, X, Pencil } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  gridKey, blockKeys, blockCellCount, blocksError, slugKey, usedKeys,
  type FormBlock, type FieldsBlock, type GridBlock, type FieldKind,
} from '@/config/processForms'
import { ProcessFormEditor, KindSeg } from './ProcessFormEditor'
import { useSaveProcessLog, useConfirmProcessLog, useLogCell, type BatchDetail, type ProcessFormDef, type ProcessLog } from '@/api/productionHooks'
import { parseVnNumber } from '@/utils/vnNumber'
import { formatDate, formatDateTime } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeAoa } from '@/utils/excelSafe'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
const fmt = (n: number) => String(n).replace('.', ',')
/** Một ô cần ghi: ô của nhóm ô hoặc ô của bảng theo dõi (label đã gồm tên bảng + lần + cột) */
export interface CellReq { key: string; label: string; kind: FieldKind; unit?: string; min?: number; max?: number; wide?: boolean }
type Stamp = NonNullable<ProcessLog['stamps']>[string]
const stdOf = (c: { min?: number; max?: number }) => [c.min != null ? `≥ ${fmt(c.min)}` : '', c.max != null ? `≤ ${fmt(c.max)}` : ''].filter(Boolean).join(' · ')
const outOfRange = (c: { kind: FieldKind; min?: number; max?: number }, v: string) => {
  if (c.kind !== 'num' || !v.trim()) return false
  const n = parseVnNumber(v)
  return n != null && ((c.max != null && n > c.max) || (c.min != null && n < c.min))
}
const badNumber = (v: string) => !!v.trim() && parseVnNumber(v) == null
const stampTip = (s?: Stamp) => s ? [s.by ? `Ghi: ${s.by}${s.at ? ` · ${formatDateTime(s.at)}` : ''}` : '', s.edited_by ? `Sửa: ${s.edited_by}${s.edited_at ? ` · ${formatDateTime(s.edited_at)}` : ''}` : ''].filter(Boolean).join(' — ') : undefined
const bandHead = (title: string, hint?: string) => (
  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t-lg">
    <span className="h-3 w-1 rounded-full bg-sky-500 shrink-0" />
    <span className="text-[11px] font-bold uppercase tracking-wide text-sky-900 shrink-0">{title}</span>
    {hint && <span className="text-[10px] text-slate-500 truncate">{hint}</span>}
  </div>
)

/** Ô "+ Thêm ô" ngay trong nhóm: gõ tên, chọn kiểu, Enter là xong */
function QuickAddField({ onAdd }: { onAdd: (label: string, kind: FieldKind) => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<FieldKind>('num')
  const done = () => { if (!label.trim()) return; onAdd(label.trim(), kind); setLabel(''); setOpen(false) }
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)}
      className="touch-target col-span-2 justify-self-start inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50">
      <Plus className="h-3.5 w-3.5" />Thêm ô cho mẻ này
    </button>
  )
  return (
    <div className="col-span-2 flex flex-wrap items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50/50 p-1.5">
      <Input autoFocus value={label} onChange={e => setLabel(e.target.value)} maxLength={120} placeholder="Tên ô (vd Đổ xong lần 4)"
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); done() } if (e.key === 'Escape') setOpen(false) }}
        className="h-8 text-xs flex-1 min-w-[9rem] bg-white" />
      <KindSeg value={kind} onChange={setKind} />
      <Button size="sm" className="h-8" disabled={!label.trim()} onClick={done} title="Thêm ô"><Check className="h-3.5 w-3.5" /></Button>
      <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(false)} title="Huỷ"><X className="h-3.5 w-3.5" /></Button>
    </div>
  )
}

/** KHUNG NHẬP MỘT Ô (bấm ô số / chữ, hoặc ô giờ đã có giờ muốn sửa). Ô giờ có "Giờ hiện tại"; ô số sai dạng chặn lưu, vượt ngưỡng
 *  tô đỏ nhưng vẫn lưu được (phiếu ghi đúng thực tế); ô đang có giá trị thì có "Xoá ô". */
export function CellPrompt({ cell, value, stamp, busy, err, onSave, onClose }: {
  cell: CellReq | null; value: string; stamp?: Stamp; busy?: boolean; err?: string
  onSave: (v: string) => void; onClose: () => void
}) {
  const [v, setV] = useState('')
  useEffect(() => { if (cell) setV(value) }, [cell?.key]) // eslint-disable-line react-hooks/exhaustive-deps -- nạp giá trị khi mở ô khác
  if (!cell) return null
  const std = stdOf(cell)
  const bad = cell.kind === 'num' && badNumber(v)
  const out = outOfRange(cell, v)
  const same = v.trim() === value.trim()
  const save = () => { if (!busy && !bad && !same && (v.trim() || value)) onSave(v.trim()) }
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm" data-testid="cell-prompt">
        <DialogHeader><DialogTitle className="text-sm pr-6">{cell.label}{cell.unit ? ` (${cell.unit})` : ''}</DialogTitle></DialogHeader>
        {std && <p className="text-[11px] text-slate-500 -mt-1">Tiêu chuẩn {std}</p>}
        <div className="flex gap-1.5">
          {cell.kind === 'text' && cell.wide
            ? <textarea autoFocus rows={3} value={v} maxLength={300} onChange={e => setV(e.target.value)} aria-label={cell.label}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            : <Input autoFocus value={v} onChange={e => setV(e.target.value)} maxLength={300} aria-label={cell.label}
                type={cell.kind === 'time' ? 'time' : 'text'} inputMode={cell.kind === 'num' ? 'decimal' : undefined}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
                className={`h-10 text-base flex-1 min-w-0 ${cell.kind !== 'text' ? 'tabular-nums' : ''} ${bad || out ? 'border-red-400 text-red-700' : ''}`} />}
          {cell.kind === 'time' && (
            <Button type="button" variant="outline" className="h-10 gap-1 shrink-0" onClick={() => setV(nowHHMM())}><Clock className="h-4 w-4" />Giờ hiện tại</Button>
          )}
        </div>
        {bad && <p className="text-[11px] text-red-600">Không phải số</p>}
        {out && <p className="text-[11px] text-red-600">Ngoài tiêu chuẩn ({std}) — vẫn lưu được</p>}
        {stamp && <p className="text-[10px] text-slate-400">{stampTip(stamp)}</p>}
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <DialogFooter className="gap-2 flex-row justify-end">
          {!!value && <Button type="button" variant="outline" size="sm" className="h-9 sm:h-8 mr-auto text-red-600 border-red-200" disabled={busy} onClick={() => onSave('')}>Xoá ô</Button>}
          <Button type="button" variant="outline" size="sm" className="h-9 sm:h-8" onClick={onClose}>Huỷ</Button>
          <Button type="button" size="sm" className="h-9 sm:h-8" disabled={busy || bad || same || (!v.trim() && !value)} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** THÂN PHIẾU — mỗi ô là MỘT NÚT (bấm ⇒ onTap). Dùng cho phiếu của mẻ và cho "Xem thử" ở Cài đặt MES. */
export function ProcessLogBody({ blocks, values, stamps, onTap, editable, onAddRow, onAddField }: {
  blocks: FormBlock[]; values: Record<string, string>; stamps?: ProcessLog['stamps']; onTap?: (c: CellReq) => void; editable: boolean
  onAddRow?: (bi: number) => void; onAddField?: (bi: number, label: string, kind: FieldKind) => void
}) {
  const live = editable && !!onTap
  const field = (f: CellReq & { required?: boolean }) => {
    const val = (values[f.key] ?? '').trim()
    const red = outOfRange(f, val) || (f.kind === 'num' && badNumber(val))
    const std = stdOf(f)
    return (
      <button key={f.key} type="button" disabled={!live} onClick={() => onTap?.(f)} title={stampTip(stamps?.[f.key])}
        data-cell={f.key} data-kind={f.kind} data-filled={val ? '1' : '0'}
        className={`${f.wide ? 'col-span-2' : ''} min-w-0 text-left rounded-md border px-2 py-1.5 transition-colors
          ${val ? (red ? 'border-red-300 bg-red-50/60' : 'border-slate-200 bg-white') : 'border-dashed border-slate-300 bg-slate-50/70'}
          enabled:hover:border-sky-400 enabled:hover:bg-sky-50 enabled:active:bg-sky-100 disabled:cursor-default`}>
        <span className="flex items-baseline gap-1 text-[10px] text-slate-500 leading-tight min-w-0">
          <span className="truncate">{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
          {f.required && <span className="text-red-500 shrink-0" title="Bắt buộc ghi trước khi nạp bồn">*</span>}
          {std && <span className="ml-auto shrink-0 text-[9px] text-slate-400">TC {std}</span>}
        </span>
        <span className="flex items-center gap-1 mt-0.5 min-h-[1.25rem] min-w-0">
          {val ? <b className={`text-sm tabular-nums truncate ${red ? 'text-red-700' : 'text-slate-900'}`}>{val}</b>
            : live ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700">
                {f.kind === 'time' ? <><Clock className="h-3.5 w-3.5" />Bấm ghi giờ</> : <><Pencil className="h-3 w-3" />Bấm nhập</>}</span>
            : <span className="text-slate-300">—</span>}
        </span>
      </button>
    )
  }
  const fieldsBlock = (b: FieldsBlock, bi: number) => (
    <div key={bi} className="rounded-lg border border-slate-200">
      {bandHead(b.title, b.hint)}
      <div className="grid grid-cols-2 gap-1.5 p-2">
        {b.fields.map(field)}
        {editable && onAddField && <QuickAddField onAdd={(l, k) => onAddField(bi, l, k)} />}
      </div>
    </div>
  )
  const gridBlock = (g: GridBlock, bi: number) => (
    <div key={bi} className="rounded-lg border border-slate-200">
      {bandHead(g.title, g.hint)}
      <div className="overflow-x-auto">
        <table className="min-w-max w-full">
          <thead><tr className="bg-slate-50 text-[9px] text-slate-500">
            <th className="px-2 py-1 text-left whitespace-nowrap sticky left-0 bg-slate-50">Lần</th>
            {g.cols.map(c => <th key={c.key} colSpan={g.cells.length} className="px-2 py-1 text-center whitespace-nowrap border-l border-slate-200">{c.label}</th>)}
          </tr>
          <tr className="bg-slate-50 text-[9px] text-slate-400">
            <th className="sticky left-0 bg-slate-50" />
            {g.cols.map(c => g.cells.map((x, xi) => <th key={`${c.key}_${x.key}`} className={`px-1 pb-1 font-normal whitespace-nowrap ${xi === 0 ? 'border-l border-slate-200' : ''}`}>{x.label}</th>))}
          </tr></thead>
          <tbody>
            {Array.from({ length: g.rows }, (_, i) => i + 1).map(r => (
              <tr key={r} className="border-t border-slate-100">
                <td className="px-2 py-1 text-[11px] text-slate-500 tabular-nums sticky left-0 bg-white">{r}</td>
                {g.cols.map(c => g.cells.map((x, xi) => {
                  const k = gridKey(g.key, r, c.key, x.key)
                  const val = (values[k] ?? '').trim()
                  return (
                    <td key={k} className={`px-0.5 py-1 ${xi === 0 ? 'border-l border-slate-200 pl-1.5' : ''}`}>
                      <button type="button" disabled={!live} title={stampTip(stamps?.[k])} data-cell={k} data-kind={x.kind} data-filled={val ? '1' : '0'}
                        aria-label={`${g.title} lần ${r} ${c.label} ${x.label}`}
                        onClick={() => onTap?.({ key: k, label: `${g.title} — lần ${r} · ${c.label} · ${x.label}`, kind: x.kind })}
                        className={`h-9 sm:h-8 rounded border px-1.5 text-[11px] tabular-nums transition-colors ${x.kind === 'time' ? 'w-[4.25rem]' : x.kind === 'text' ? 'w-24' : 'w-14'}
                          ${val ? `border-slate-200 bg-white font-semibold ${x.kind === 'num' && badNumber(val) ? 'text-red-700 border-red-300' : 'text-slate-900'}` : 'border-dashed border-slate-300 bg-slate-50/70 text-sky-700'}
                          enabled:hover:border-sky-400 enabled:hover:bg-sky-50 disabled:cursor-default truncate`}>
                        {val || (live ? (x.kind === 'time' ? <Clock className="inline h-3.5 w-3.5" /> : '+') : <span className="text-slate-300">—</span>)}
                      </button>
                    </td>
                  )
                }))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && onAddRow && g.rows < 30 && (
        <button type="button" onClick={() => onAddRow(bi)}
          className="touch-target m-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50">
          <Plus className="h-3.5 w-3.5" />Thêm lần {g.rows + 1}
        </button>
      )}
    </div>
  )
  return <>{blocks.map((b, bi) => (b.type === 'grid' ? gridBlock(b, bi) : fieldsBlock(b, bi)))}</>
}

export function ProcessLogSheet({ open, onClose, batch, def, canWrite, canConfirm, canExport }: {
  open: boolean; onClose: () => void; batch: BatchDetail; def: ProcessFormDef
  canWrite: boolean; canConfirm: boolean; canExport: boolean
}) {
  const form = def.code
  const log = batch.process_logs.find(l => l.form === form) ?? null
  const locked = !!log?.confirmed_at
  const editable = canWrite && !locked && batch.status !== 'CANCELLED'
  const values = useMemo(() => log?.data ?? {}, [log?.data])
  /** bản nháp cấu trúc (chế độ "Sửa cấu trúc"): undefined = chưa đụng · null = về theo mẫu chung · mảng = bản sửa riêng */
  const [draft, setDraft] = useState<FormBlock[] | null | undefined>(undefined)
  const [mode, setMode] = useState<'fill' | 'structure'>('fill')
  const [err, setErr] = useState('')
  const [cell, setCell] = useState<CellReq | null>(null)
  const [cellErr, setCellErr] = useState('')
  const [ask, confirmNode] = useConfirmDialog()
  const save = useSaveProcessLog()
  const confirm = useConfirmProcessLog()
  const write = useLogCell()
  const savedBlocks = log?.blocks ?? null
  const blocks: FormBlock[] = mode === 'structure' && draft !== undefined ? (draft ?? def.blocks) : (savedBlocks ?? def.blocks)
  const custom = mode === 'structure' && draft !== undefined ? !!draft : !!savedBlocks
  const lockedKeys = useMemo(() => new Set([...blockKeys(savedBlocks ?? def.blocks), ...Object.keys(log?.data ?? {})]), [savedBlocks, def.blocks, log?.data])
  useEffect(() => { if (open) { setDraft(undefined); setMode('fill'); setErr(''); setCell(null) } }, [open, form])

  const structDirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(savedBlocks)
  const structErr = mode === 'structure' ? blocksError(blocks) : ''
  const busy = save.isPending || confirm.isPending

  // giá trị đã ghi mà cấu trúc hiện tại không còn ô — vẫn nằm trong phiếu, hiện để QA thấy
  const orphans = useMemo(() => {
    const keys = blockKeys(blocks)
    const labelOf = new Map<string, string>()
    for (const b of [...(savedBlocks ?? []), ...def.blocks]) if (b.type === 'fields') for (const f of b.fields) labelOf.set(f.key, f.label)
    return Object.entries(values).filter(([k, val]) => !keys.has(k) && String(val).trim()).map(([k, val]) => ({ k, label: labelOf.get(k) ?? k, val }))
  }, [blocks, values, savedBlocks, def.blocks])

  /** bấm một ô: ô GIỜ còn trống ⇒ ghi giờ máy chủ ngay; còn lại ⇒ khung nhập */
  async function tap(c: CellReq) {
    setErr('')
    if (c.kind === 'time' && !(values[c.key] ?? '').trim()) {
      try { await write.mutateAsync({ batchId: batch.id, form, key: c.key }) } catch (e) { setErr(apiMsg(e)) }
      return
    }
    setCellErr(''); setCell(c)
  }
  async function saveCell(v: string) {
    if (!cell) return
    setCellErr('')
    try { await write.mutateAsync({ batchId: batch.id, form, key: cell.key, value: v }); setCell(null) } catch (e) { setCellErr(apiMsg(e)) }
  }
  // sửa cấu trúc nhanh (thêm lần / thêm ô / về mẫu chung) lưu NGAY — chỉ cấu trúc, không gửi giá trị (không đè ô người khác vừa ghi)
  async function saveBlocks(next: FormBlock[] | null) {
    setErr('')
    if (next) { const bad = blocksError(next); if (bad) { setErr(bad); return false } }
    try { await save.mutateAsync({ batchId: batch.id, form, blocks: next }); return true } catch (e) { setErr(apiMsg(e)); return false }
  }
  const cur = () => structuredClone(savedBlocks ?? def.blocks)
  const addRow = (bi: number) => { const bs = cur(); const g = bs[bi] as GridBlock; g.rows = Math.min(30, g.rows + 1); void saveBlocks(bs) }
  const addField = (bi: number, label: string, kind: FieldKind) => {
    const bs = cur(); (bs[bi] as FieldsBlock).fields.push({ key: slugKey(label, usedKeys(bs)), label, kind }); void saveBlocks(bs)
  }
  async function saveStructure() { if (await saveBlocks(draft ?? null)) { setDraft(undefined); setMode('fill') } }
  async function doConfirm(next: boolean) {
    setErr('')
    try { await confirm.mutateAsync({ batchId: batch.id, form, confirm: next }) } catch (e) { setErr(apiMsg(e)) }
  }
  async function resetToTemplate() {
    if (await ask({ title: 'Về theo mẫu chung?', body: 'Bỏ các ô / lần đã thêm riêng cho mẻ này. Giá trị đã ghi ở ô bị bỏ vẫn nằm trong phiếu (hiện ở khối "Ô không còn trong mẫu").', confirmLabel: 'Về mẫu chung' }) === null) return
    if (await saveBlocks(null)) { setDraft(undefined); setMode('fill') }
  }
  function exportExcel() {
    const aoa: unknown[][] = [
      [def.title.toUpperCase()],
      [`Mẻ: ${batch.batch_code}`, `Sản phẩm: ${batch.material?.material_code ?? ''} ${batch.material?.short_name ?? ''}`, `Chu kỳ: ${batch.cycle ?? ''}`, `Ca: ${batch.shift ?? ''}`, `Ngày: ${formatDate(batch.prod_date)}`],
    ]
    for (const b of blocks) {
      aoa.push([], [b.title])
      if (b.type === 'fields') { for (const f of b.fields) aoa.push([f.label, values[f.key] ?? '', f.unit ?? '']); continue }
      aoa.push(['Lần', ...b.cols.flatMap(c => b.cells.map(x => `${c.label} — ${x.label}`))])
      for (let r = 1; r <= b.rows; r++) aoa.push([r, ...b.cols.flatMap(c => b.cells.map(x => values[gridKey(b.key, r, c.key, x.key)] ?? ''))])
    }
    if (orphans.length) { aoa.push([], ['Ô không còn trong mẫu']); for (const o of orphans) aoa.push([o.label, o.val]) }
    aoa.push([], [`Người ghi: ${log?.updated_by_name ?? ''}`, `QA xác nhận: ${log?.confirmed_by_name ?? ''}${log?.confirmed_at ? ` (${formatDateTime(log.confirmed_at)})` : ''}`])
    const ws = XLSX.utils.aoa_to_sheet(sanitizeAoa(aoa))
    ws['!cols'] = [{ wch: 44 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, def.short.slice(0, 31))
    void saveWorkbook(wb, `phieu_${form.toLowerCase()}_${batch.batch_code}.xlsx`)
  }

  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-2xl" title={`${def.short} — mẻ ${batch.batch_code}`}
      description={`${def.title}. ${batch.material?.material_code ?? ''} ${batch.material?.short_name ?? ''}${batch.cycle ? ` · chu kỳ ${batch.cycle}` : ''}${batch.shift ? ` · ${batch.shift}` : ''} · ${formatDate(batch.prod_date)}`}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>
        {canExport && log && mode === 'fill' && <Button variant="outline" size="sm" className="h-8 hidden sm:inline-flex" onClick={exportExcel}><FileDown className="h-3.5 w-3.5 mr-1" />Excel</Button>}
        {canConfirm && log && mode === 'fill' && (locked
          ? <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => void doConfirm(false)}>Bỏ xác nhận</Button>
          : <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => void doConfirm(true)}><ShieldCheck className="h-3.5 w-3.5 mr-1" />QA xác nhận</Button>)}
        {editable && mode === 'structure' && <Button variant="outline" size="sm" className="h-8" onClick={() => { setDraft(undefined); setMode('fill') }}>Huỷ sửa</Button>}
        {editable && mode === 'structure' && <Button size="sm" className="h-8" disabled={!structDirty || busy || !!structErr} onClick={() => void saveStructure()}>{save.isPending ? 'Đang lưu…' : 'Lưu cấu trúc'}</Button>}
      </>}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
          {locked ? <StatusBadge tone="green">QA đã xác nhận</StatusBadge> : log ? <StatusBadge tone="amber">Đang ghi</StatusBadge> : <StatusBadge tone="slate">Chưa ghi</StatusBadge>}
          {log?.updated_by_name && <span>Ghi: {log.updated_by_name} · {formatDateTime(log.updated_at)}</span>}
          {log?.confirmed_at && <span>QA: {log.confirmed_by_name ?? '—'} · {formatDateTime(log.confirmed_at)}</span>}
          {locked && canWrite && <span className="text-amber-700">Phiếu đã khoá — QA bỏ xác nhận mới sửa được.</span>}
          {editable && mode === 'fill' && <span className="text-sky-800">Bấm vào từng ô để ghi — ô giờ tự lấy giờ hiện tại, ghi xong lưu ngay.</span>}
        </div>
        {/* thanh cấu trúc: mẫu chung hay đã sửa riêng; vào / ra chế độ sửa cấu trúc */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
          <span className="text-[11px] text-slate-600 flex-1 min-w-0">
            {custom
              ? <><b className="text-sky-800">Đã sửa riêng cho mẻ này</b>{structDirty && <span className="text-amber-700"> · chưa lưu</span>}</>
              : <>Theo mẫu chung <span className="text-slate-400">({blockCellCount(blocks)} ô)</span>{structDirty && <span className="text-amber-700"> · chưa lưu</span>}</>}
          </span>
          {editable && mode === 'fill' && (
            <button type="button" onClick={() => { setDraft(savedBlocks ?? null); setMode('structure') }}
              className="touch-target inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white">
              <Wrench className="h-3.5 w-3.5" />Sửa cấu trúc
            </button>
          )}
          {editable && mode === 'fill' && !!savedBlocks && (
            <button type="button" disabled={busy} onClick={() => void resetToTemplate()}
              className="touch-target inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white disabled:opacity-60">
              <Undo2 className="h-3.5 w-3.5" />Về theo mẫu chung
            </button>
          )}
        </div>
        {structErr && <p className="text-[11px] text-amber-700">{structErr}</p>}
        {mode === 'structure'
          ? <ProcessFormEditor blocks={blocks} onChange={b => setDraft(b)} lockedKeys={lockedKeys} />
          : <ProcessLogBody blocks={blocks} values={values} stamps={log?.stamps} onTap={c => void tap(c)} editable={editable}
              onAddRow={busy ? undefined : addRow} onAddField={busy ? undefined : addField} />}
        {mode === 'fill' && orphans.length > 0 && (
          <div className="rounded-lg border border-amber-200">
            {bandHead('Ô không còn trong mẫu', 'giá trị đã ghi trước khi mẫu đổi — vẫn lưu trong phiếu')}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-2.5 text-[11px]">
              {orphans.map(o => <div key={o.k} className="min-w-0 truncate"><span className="text-slate-500">{o.label}:</span> <b className="text-slate-800">{o.val}</b></div>)}
            </div>
          </div>
        )}
      </div>
      <CellPrompt cell={cell} value={cell ? (values[cell.key] ?? '') : ''} stamp={cell ? log?.stamps?.[cell.key] : undefined}
        busy={write.isPending} err={cellErr} onSave={v => void saveCell(v)} onClose={() => setCell(null)} />
      {confirmNode}
    </FormSheet>
  )
}
