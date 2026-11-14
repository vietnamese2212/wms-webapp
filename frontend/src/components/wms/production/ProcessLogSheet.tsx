// PHIẾU THEO DÕI của mẻ — form nhập thay phiếu giấy. Ô lấy theo MẪU PHIẾU (Cài đặt MES); tại bàn người ghi được SỬA RIÊNG cho lần
// này (user: "cho phép sửa theo từng lần nếu muốn tại bàn"): "+ Thêm lần" ở bảng, "+ Thêm ô" ở nhóm — bấm là có ngay; đổi sâu hơn thì
// "Sửa cấu trúc". Bản sửa riêng lưu cùng phiếu (batch_process_log.blocks), mẫu chung không đổi; "Về theo mẫu chung" bỏ bản sửa riêng.
// Ô giờ có nút điền giờ hiện tại; ô số vượt ngưỡng tô đỏ nhưng VẪN lưu được — phiếu ghi đúng thực tế.
// QA xác nhận ⇒ phiếu khoá (và chụp mẫu đang áp vào phiếu); QA bỏ xác nhận thì sửa lại được.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { Clock, ShieldCheck, FileDown, Plus, Wrench, Undo2, Check, X } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  gridKey, blockKeys, blockCellCount, blocksError, slugKey, usedKeys,
  type FormBlock, type FieldsBlock, type GridBlock, type ProcessField, type FieldKind,
} from '@/config/processForms'
import { ProcessFormEditor, KindSeg } from './ProcessFormEditor'
import { useSaveProcessLog, useConfirmProcessLog, type BatchDetail, type ProcessFormDef } from '@/api/productionHooks'
import { parseVnNumber } from '@/utils/vnNumber'
import { formatDate, formatDateTime } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeAoa } from '@/utils/excelSafe'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
const fmt = (n: number) => String(n).replace('.', ',')
const outOfRange = (f: ProcessField, v: string) => {
  if (f.kind !== 'num' || !v.trim()) return false
  const n = parseVnNumber(v)
  return n != null && ((f.max != null && n > f.max) || (f.min != null && n < f.min))
}
const badNumber = (v: string) => !!v.trim() && parseVnNumber(v) == null
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

/** THÂN PHIẾU — vẽ các khối ô; dùng cho form của mẻ và cho "Xem thử" ở Cài đặt MES */
export function ProcessLogBody({ blocks, values, onValue, editable, onAddRow, onAddField }: {
  blocks: FormBlock[]; values: Record<string, string>; onValue?: (k: string, v: string) => void; editable: boolean
  onAddRow?: (bi: number) => void; onAddField?: (bi: number, label: string, kind: FieldKind) => void
}) {
  const field = (f: ProcessField) => {
    const val = values[f.key] ?? ''
    const red = outOfRange(f, val) || (f.kind === 'num' && badNumber(val))
    const std = [f.min != null ? `≥ ${fmt(f.min)}` : '', f.max != null ? `≤ ${fmt(f.max)}` : ''].filter(Boolean).join(' · ')
    return (
      <div key={f.key} className={f.wide ? 'col-span-2' : 'min-w-0'}>
        <Label className="text-[11px] text-slate-600 leading-tight">
          {f.label}{f.unit ? ` (${f.unit})` : ''}{std && <span className="ml-1 text-[10px] text-slate-400">TC {std}</span>}
        </Label>
        <div className="flex gap-1 mt-0.5">
          <Input value={val} disabled={!editable} onChange={e => onValue?.(f.key, e.target.value)}
            type={f.kind === 'time' ? 'time' : 'text'} inputMode={f.kind === 'num' ? 'decimal' : undefined} maxLength={300}
            className={`h-9 sm:h-8 text-xs flex-1 min-w-0 ${f.kind !== 'text' ? 'tabular-nums' : ''} ${red ? 'border-red-400 text-red-700' : ''}`} />
          {f.kind === 'time' && editable && (
            <button type="button" title="Điền giờ hiện tại" onClick={() => onValue?.(f.key, nowHHMM())}
              className="touch-target shrink-0 inline-flex items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-slate-50"><Clock className="h-3.5 w-3.5" /></button>
          )}
        </div>
        {outOfRange(f, val) && <p className="text-[10px] text-red-600 mt-0.5">Ngoài tiêu chuẩn ({std})</p>}
        {f.kind === 'num' && badNumber(val) && <p className="text-[10px] text-red-600 mt-0.5">Không phải số</p>}
      </div>
    )
  }
  const fieldsBlock = (b: FieldsBlock, bi: number) => (
    <div key={bi} className="rounded-lg border border-slate-200">
      {bandHead(b.title, b.hint)}
      <div className="grid grid-cols-2 gap-x-2 gap-y-2 p-2.5">
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
          </tr></thead>
          <tbody>
            {Array.from({ length: g.rows }, (_, i) => i + 1).map(r => (
              <tr key={r} className="border-t border-slate-100">
                <td className="px-2 py-1 text-[11px] text-slate-500 tabular-nums sticky left-0 bg-white">{r}</td>
                {g.cols.map(c => g.cells.map((x, xi) => {
                  const k = gridKey(g.key, r, c.key, x.key)
                  const val = values[k] ?? ''
                  return (
                    <td key={k} className={`px-0.5 py-1 ${xi === 0 ? 'border-l border-slate-200 pl-1.5' : ''}`}>
                      <Input value={val} disabled={!editable} onChange={e => onValue?.(k, e.target.value)} type={x.kind === 'time' ? 'time' : 'text'} inputMode={x.kind === 'num' ? 'decimal' : undefined}
                        placeholder={x.label} aria-label={`${g.title} lần ${r} ${c.label} ${x.label}`}
                        className={`h-9 sm:h-8 text-[11px] tabular-nums px-1.5 ${x.kind === 'time' ? 'w-[5.5rem]' : x.kind === 'text' ? 'w-24' : 'w-14'} ${x.kind === 'num' && badNumber(val) ? 'border-red-400' : ''}`} />
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
  const [v, setV] = useState<Record<string, string>>({})
  /** bản nháp cấu trúc: undefined = chưa đụng · null = về theo mẫu chung · mảng = bản sửa riêng */
  const [draft, setDraft] = useState<FormBlock[] | null | undefined>(undefined)
  const [mode, setMode] = useState<'fill' | 'structure'>('fill')
  const [err, setErr] = useState('')
  const [ask, confirmNode] = useConfirmDialog()
  const save = useSaveProcessLog()
  const confirm = useConfirmProcessLog()
  const stamp = `${log?.id ?? ''}|${log?.updated_at ?? ''}`
  const savedBlocks = log?.blocks ?? null
  const blocks: FormBlock[] = draft === undefined ? (savedBlocks ?? def.blocks) : (draft ?? def.blocks)
  const custom = draft === undefined ? !!savedBlocks : !!draft
  const lockedKeys = useMemo(() => new Set([...blockKeys(savedBlocks ?? def.blocks), ...Object.keys(log?.data ?? {})]), [savedBlocks, def.blocks, log?.data])

  useEffect(() => {
    if (!open) return
    const base: Record<string, string> = { ...(log?.data ?? {}) }
    if (!log) {   // phiếu mới: điền sẵn những gì mẻ đã biết (ô khai "điền sẵn" ở mẫu)
      for (const b of def.blocks) if (b.type === 'fields') for (const f of b.fields) {
        if (f.prefill === 'machine_code' && batch.machine_code) base[f.key] = batch.machine_code
        if (f.prefill === 'planned_qty' && batch.planned_qty != null) base[f.key] = fmt(batch.planned_qty)
      }
    }
    setV(base); setDraft(undefined); setMode('fill'); setErr('')
  }, [open, form, stamp]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, val: string) => setV(s => ({ ...s, [k]: val }))
  const editBlocks = (fn: (b: FormBlock[]) => FormBlock[]) => setDraft(fn(structuredClone(blocks)))
  const addRow = (bi: number) => editBlocks(bs => { const g = bs[bi] as GridBlock; g.rows = Math.min(30, g.rows + 1); return bs })
  const addField = (bi: number, label: string, kind: FieldKind) => editBlocks(bs => {
    (bs[bi] as FieldsBlock).fields.push({ key: slugKey(label, usedKeys(bs)), label, kind }); return bs
  })

  const cleaned = useMemo(() => Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== '')), [v])
  const dataDirty = JSON.stringify(cleaned) !== JSON.stringify(log?.data ?? {})
  const structDirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(savedBlocks)
  const dirty = dataDirty || structDirty
  const structErr = blocksError(blocks)
  const busy = save.isPending || confirm.isPending

  // giá trị đã ghi mà cấu trúc hiện tại không còn ô — vẫn nằm trong phiếu, hiện để QA thấy
  const orphans = useMemo(() => {
    const keys = blockKeys(blocks)
    const labelOf = new Map<string, string>()
    for (const b of [...(savedBlocks ?? []), ...def.blocks]) if (b.type === 'fields') for (const f of b.fields) labelOf.set(f.key, f.label)
    return Object.entries(cleaned).filter(([k]) => !keys.has(k)).map(([k, val]) => ({ k, label: labelOf.get(k) ?? k, val }))
  }, [blocks, cleaned, savedBlocks, def.blocks])

  async function doSave() {
    setErr('')
    if (structErr) { setErr(structErr); throw new Error(structErr) }
    try {
      await save.mutateAsync({ batchId: batch.id, form, data: v, ...(structDirty ? { blocks: draft ?? null } : {}) })
      setMode('fill')
    } catch (e) { setErr(apiMsg(e)); throw e }
  }
  async function doConfirm(next: boolean) {
    setErr('')
    try {
      if (next && dirty && editable) await doSave()
      await confirm.mutateAsync({ batchId: batch.id, form, confirm: next })
    } catch (e) { setErr(apiMsg(e)) }
  }
  async function resetToTemplate() {
    if (await ask({ title: 'Về theo mẫu chung?', body: 'Bỏ các ô / lần đã thêm riêng cho mẻ này. Giá trị đã ghi ở ô bị bỏ vẫn nằm trong phiếu (hiện ở khối "Ô không còn trong mẫu").', confirmLabel: 'Về mẫu chung' }) === null) return
    setDraft(null); setMode('fill')
  }
  function exportExcel() {
    const aoa: unknown[][] = [
      [def.title.toUpperCase()],
      [`Mẻ: ${batch.batch_code}`, `Sản phẩm: ${batch.material?.material_code ?? ''} ${batch.material?.short_name ?? ''}`, `Chu kỳ: ${batch.cycle ?? ''}`, `Ca: ${batch.shift ?? ''}`, `Ngày: ${formatDate(batch.prod_date)}`],
    ]
    for (const b of blocks) {
      aoa.push([], [b.title])
      if (b.type === 'fields') { for (const f of b.fields) aoa.push([f.label, v[f.key] ?? '', f.unit ?? '']); continue }
      aoa.push(['Lần', ...b.cols.flatMap(c => b.cells.map(x => `${c.label} — ${x.label}`))])
      for (let r = 1; r <= b.rows; r++) aoa.push([r, ...b.cols.flatMap(c => b.cells.map(x => v[gridKey(b.key, r, c.key, x.key)] ?? ''))])
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
        {editable && mode === 'structure' && <Button variant="outline" size="sm" className="h-8" onClick={() => setMode('fill')}>Về ghi phiếu</Button>}
        {editable && <Button size="sm" className="h-8" disabled={!dirty || busy || !!structErr} onClick={() => { void doSave().catch(() => {}) }}>{save.isPending ? 'Đang lưu…' : 'Lưu phiếu'}</Button>}
      </>}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
          {locked ? <StatusBadge tone="green">QA đã xác nhận</StatusBadge> : log ? <StatusBadge tone="amber">Chưa xác nhận</StatusBadge> : <StatusBadge tone="slate">Chưa ghi</StatusBadge>}
          {log?.updated_by_name && <span>Ghi: {log.updated_by_name} · {formatDateTime(log.updated_at)}</span>}
          {log?.confirmed_at && <span>QA: {log.confirmed_by_name ?? '—'} · {formatDateTime(log.confirmed_at)}</span>}
          {locked && canWrite && <span className="text-amber-700">Phiếu đã khoá — QA bỏ xác nhận mới sửa được.</span>}
        </div>
        {/* thanh cấu trúc: mẫu chung hay đã sửa riêng; vào / ra chế độ sửa cấu trúc */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
          <span className="text-[11px] text-slate-600 flex-1 min-w-0">
            {custom
              ? <><b className="text-sky-800">Đã sửa riêng cho mẻ này</b>{structDirty && <span className="text-amber-700"> · chưa lưu</span>}</>
              : <>Theo mẫu chung <span className="text-slate-400">({blockCellCount(blocks)} ô)</span>{structDirty && <span className="text-amber-700"> · chưa lưu</span>}</>}
          </span>
          {editable && mode === 'fill' && (
            <button type="button" onClick={() => setMode('structure')}
              className="touch-target inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white">
              <Wrench className="h-3.5 w-3.5" />Sửa cấu trúc
            </button>
          )}
          {editable && custom && (
            <button type="button" onClick={() => void resetToTemplate()}
              className="touch-target inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white">
              <Undo2 className="h-3.5 w-3.5" />Về theo mẫu chung
            </button>
          )}
        </div>
        {structErr && <p className="text-[11px] text-amber-700">{structErr}</p>}
        {mode === 'structure'
          ? <ProcessFormEditor blocks={blocks} onChange={b => setDraft(b)} lockedKeys={lockedKeys} />
          : <ProcessLogBody blocks={blocks} values={v} onValue={set} editable={editable} onAddRow={addRow} onAddField={addField} />}
        {mode === 'fill' && orphans.length > 0 && (
          <div className="rounded-lg border border-amber-200">
            {bandHead('Ô không còn trong mẫu', 'giá trị đã ghi trước khi mẫu đổi — vẫn lưu trong phiếu')}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-2.5 text-[11px]">
              {orphans.map(o => <div key={o.k} className="min-w-0 truncate"><span className="text-slate-500">{o.label}:</span> <b className="text-slate-800">{o.val}</b></div>)}
            </div>
          </div>
        )}
      </div>
      {confirmNode}
    </FormSheet>
  )
}
