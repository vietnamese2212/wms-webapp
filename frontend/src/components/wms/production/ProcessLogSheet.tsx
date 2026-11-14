// PHIẾU THEO DÕI của mẻ — form nhập thay phiếu giấy (phối trộn · dịch thạch). Các ô khai ở config/processForms.ts.
// Ô giờ có nút "Bây giờ" (bấm một lần là xong, khỏi gõ); ô số vượt ngưỡng tiêu chuẩn tô đỏ nhưng VẪN lưu được — phiếu ghi đúng thực tế.
// QA xác nhận ⇒ phiếu khoá sửa; QA bỏ xác nhận thì sửa lại được.
import { useEffect, useState } from 'react'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { Clock, ShieldCheck, FileDown } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PROCESS_FORMS, gridKey, type ProcessForm, type ProcessField, type ProcessSection } from '@/config/processForms'
import { useSaveProcessLog, useConfirmProcessLog, type BatchDetail } from '@/api/productionHooks'
import { parseVnNumber } from '@/utils/vnNumber'
import { formatDate, formatDateTime } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeAoa } from '@/utils/excelSafe'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })
const outOfRange = (f: ProcessField, v: string) => {
  if (f.kind !== 'num' || !v.trim()) return false
  const n = parseVnNumber(v)
  return n != null && ((f.max != null && n > f.max) || (f.min != null && n < f.min))
}
const badNumber = (v: string) => !!v.trim() && parseVnNumber(v) == null

export function ProcessLogSheet({ open, onClose, batch, form, canWrite, canConfirm, canExport }: {
  open: boolean; onClose: () => void; batch: BatchDetail; form: ProcessForm
  canWrite: boolean; canConfirm: boolean; canExport: boolean
}) {
  const def = PROCESS_FORMS[form]
  const log = batch.process_logs.find(l => l.form === form) ?? null
  const locked = !!log?.confirmed_at
  const editable = canWrite && !locked && batch.status !== 'CANCELLED'
  const [v, setV] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const save = useSaveProcessLog()
  const confirm = useConfirmProcessLog()
  const stamp = `${log?.id ?? ''}|${log?.updated_at ?? ''}`
  useEffect(() => {
    if (!open) return
    const base: Record<string, string> = { ...(log?.data ?? {}) }
    // phiếu mới: điền sẵn những gì mẻ đã biết
    if (!log && form === 'MIX') { if (batch.machine_code) base.mix_tank = batch.machine_code; if (batch.planned_qty != null) base.mix_qty = String(batch.planned_qty).replace('.', ',') }
    setV(base); setErr('')
  }, [open, form, stamp]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, val: string) => setV(s => ({ ...s, [k]: val }))
  const dirty = JSON.stringify(Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== ''))) !== JSON.stringify(log?.data ?? {})
  const busy = save.isPending || confirm.isPending
  async function doSave() {
    setErr('')
    try { await save.mutateAsync({ batchId: batch.id, form, data: v }) } catch (e) { setErr(apiMsg(e)); throw e }
  }
  async function doConfirm(next: boolean) {
    setErr('')
    try {
      if (next && dirty && editable) await doSave()
      await confirm.mutateAsync({ batchId: batch.id, form, confirm: next })
    } catch (e) { setErr(apiMsg(e)) }
  }
  function exportExcel() {
    const all = [...def.sections, ...(def.tail ?? [])]
    const aoa: unknown[][] = [
      [def.title.toUpperCase()],
      [`Mẻ: ${batch.batch_code}`, `Sản phẩm: ${batch.material?.material_code ?? ''} ${batch.material?.short_name ?? ''}`, `Chu kỳ: ${batch.cycle ?? ''}`, `Ca: ${batch.shift ?? ''}`, `Ngày: ${formatDate(batch.prod_date)}`],
      [],
      ...all.flatMap(s => [[s.title], ...s.fields.map(f => [f.label, v[f.key] ?? '', f.unit ?? ''])]),
    ]
    if (def.grid) {
      aoa.push([], [def.grid.title], ['Lần', ...def.grid.cols.flatMap(c => def.grid!.cells.map(x => `${c.label} — ${x.label}`))])
      for (let r = 1; r <= def.grid.rows; r++) aoa.push([r, ...def.grid.cols.flatMap(c => def.grid!.cells.map(x => v[gridKey(r, c.key, x.key)] ?? ''))])
    }
    aoa.push([], [`Người ghi: ${log?.updated_by_name ?? ''}`, `QA xác nhận: ${log?.confirmed_by_name ?? ''}${log?.confirmed_at ? ` (${formatDateTime(log.confirmed_at)})` : ''}`])
    const ws = XLSX.utils.aoa_to_sheet(sanitizeAoa(aoa))
    ws['!cols'] = [{ wch: 44 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, def.short)
    void saveWorkbook(wb, `phieu_${form === 'MIX' ? 'phoi_tron' : 'dich_thach'}_${batch.batch_code}.xlsx`)
  }

  const field = (f: ProcessField) => {
    const val = v[f.key] ?? ''
    const red = outOfRange(f, val) || (f.kind === 'num' && badNumber(val))
    return (
      <div key={f.key} className={f.wide ? 'col-span-2' : ''}>
        <Label className="text-[11px] text-slate-600 leading-tight">{f.label}{f.unit ? ` (${f.unit})` : ''}</Label>
        <div className="flex gap-1 mt-0.5">
          <Input value={val} disabled={!editable} onChange={e => set(f.key, e.target.value)}
            type={f.kind === 'time' ? 'time' : 'text'} inputMode={f.kind === 'num' ? 'decimal' : undefined} maxLength={300}
            className={`h-9 sm:h-8 text-xs flex-1 min-w-0 ${f.kind !== 'text' ? 'tabular-nums' : ''} ${red ? 'border-red-400 text-red-700' : ''}`} />
          {f.kind === 'time' && editable && (
            <button type="button" title="Điền giờ hiện tại" onClick={() => set(f.key, nowHHMM())}
              className="touch-target shrink-0 inline-flex items-center justify-center rounded-md border border-slate-200 px-2 text-slate-500 hover:bg-slate-50"><Clock className="h-3.5 w-3.5" /></button>
          )}
        </div>
        {outOfRange(f, val) && <p className="text-[10px] text-red-600 mt-0.5">Ngoài tiêu chuẩn{f.max != null ? ` (≤ ${String(f.max).replace('.', ',')})` : ''}{f.min != null ? ` (≥ ${String(f.min).replace('.', ',')})` : ''}</p>}
        {f.kind === 'num' && badNumber(val) && <p className="text-[10px] text-red-600 mt-0.5">Không phải số</p>}
      </div>
    )
  }
  const section = (s: ProcessSection) => (
    <div key={s.title} className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t-lg">
        <span className="h-3 w-1 rounded-full bg-sky-500 shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-sky-900">{s.title}</span>
        {s.hint && <span className="text-[10px] text-slate-500 truncate">{s.hint}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-2 p-2.5">{s.fields.map(field)}</div>
    </div>
  )

  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-2xl" title={`${def.short} — mẻ ${batch.batch_code}`}
      description={`${def.title}. ${batch.material?.material_code ?? ''} ${batch.material?.short_name ?? ''}${batch.cycle ? ` · chu kỳ ${batch.cycle}` : ''}${batch.shift ? ` · ${batch.shift}` : ''} · ${formatDate(batch.prod_date)}`}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>
        {canExport && log && <Button variant="outline" size="sm" className="h-8 hidden sm:inline-flex" onClick={exportExcel}><FileDown className="h-3.5 w-3.5 mr-1" />Excel</Button>}
        {canConfirm && log && (locked
          ? <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => void doConfirm(false)}>Bỏ xác nhận</Button>
          : <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => void doConfirm(true)}><ShieldCheck className="h-3.5 w-3.5 mr-1" />QA xác nhận</Button>)}
        {editable && <Button size="sm" className="h-8" disabled={!dirty || busy} onClick={() => { void doSave().catch(() => {}) }}>{save.isPending ? 'Đang lưu…' : 'Lưu phiếu'}</Button>}
      </>}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
          {locked ? <StatusBadge tone="green">QA đã xác nhận</StatusBadge> : log ? <StatusBadge tone="amber">Chưa xác nhận</StatusBadge> : <StatusBadge tone="slate">Chưa ghi</StatusBadge>}
          {log?.updated_by_name && <span>Ghi: {log.updated_by_name} · {formatDateTime(log.updated_at)}</span>}
          {log?.confirmed_at && <span>QA: {log.confirmed_by_name ?? '—'} · {formatDateTime(log.confirmed_at)}</span>}
          {locked && canWrite && <span className="text-amber-700">Phiếu đã khoá — QA bỏ xác nhận mới sửa được.</span>}
        </div>
        {def.sections.map(section)}
        {def.grid && (
          <div className="rounded-lg border border-slate-200">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t-lg">
              <span className="h-3 w-1 rounded-full bg-sky-500 shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-sky-900">{def.grid.title}</span>
              <span className="text-[10px] text-slate-500">giờ / nhiệt độ / pH mỗi lần kiểm</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-max w-full">
                <thead><tr className="bg-slate-50 text-[9px] text-slate-500">
                  <th className="px-2 py-1 text-left whitespace-nowrap sticky left-0 bg-slate-50">Lần</th>
                  {def.grid.cols.map(c => <th key={c.key} colSpan={def.grid!.cells.length} className="px-2 py-1 text-center whitespace-nowrap border-l border-slate-200">{c.label}</th>)}
                </tr></thead>
                <tbody>
                  {Array.from({ length: def.grid.rows }, (_, i) => i + 1).map(r => (
                    <tr key={r} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-[11px] text-slate-500 tabular-nums sticky left-0 bg-white">{r}</td>
                      {def.grid!.cols.map(c => def.grid!.cells.map((x, xi) => {
                        const k = gridKey(r, c.key, x.key)
                        const val = v[k] ?? ''
                        return (
                          <td key={k} className={`px-0.5 py-1 ${xi === 0 ? 'border-l border-slate-200 pl-1.5' : ''}`}>
                            <Input value={val} disabled={!editable} onChange={e => set(k, e.target.value)} type={x.kind === 'time' ? 'time' : 'text'} inputMode={x.kind === 'num' ? 'decimal' : undefined}
                              placeholder={x.label} aria-label={`${def.grid!.title} lần ${r} ${c.label} ${x.label}`}
                              className={`h-9 sm:h-8 text-[11px] tabular-nums px-1.5 ${x.kind === 'time' ? 'w-[5.5rem]' : 'w-14'} ${x.kind === 'num' && badNumber(val) ? 'border-red-400' : ''}`} />
                          </td>
                        )
                      }))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {(def.tail ?? []).map(section)}
      </div>
    </FormSheet>
  )
}
