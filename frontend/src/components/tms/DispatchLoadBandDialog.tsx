// DẢI TẢI THEO DÒNG XE CHA (01/10, user: "đưa vào rank theo %, chỉnh sửa ở trên bàn làm việc ngay tại thời điểm Ghép xe hoặc
// Làm lại — container SCA 60–100 %, xe pallet 16–17 90–105 %; config chọn xong hiện lên trên bàn; có nút tích bỏ qua %").
//   • min = dưới mức này xe là Non tải (thay ngưỡng kho / dòng xe cho cha đó) · max = máy được xếp tới mức này (105 = cho vượt 5 %).
//   • Hộp thoại này đứng trước MỌI lần máy chạy (Lập kế hoạch · Lập lại · Ghép xe · Tối ưu lại) và là chỗ khai duy nhất — lần chọn
//     gần nhất được kho nhớ (Warehouse.dispatch_load_bands) để lần sau mở ra đúng số.
//   • Chip trên bàn in dải đang áp; bấm chip = đổi ngay trên kế hoạch đang mở (xe nháp tính lại, không ghép lại).
//   • "Bỏ qua dải %" = xếp theo sức chứa danh định 100 %, không báo Non tải — người bật là người chịu (máy sẽ chọn xe rẻ nhất
//     kể cả xe to cho đơn nhỏ, đúng cảnh 77/77 Xe 34 Pallet đo 07/09).
import { useEffect, useMemo, useState } from 'react'
import { Gauge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { useVehicleModels, useVehicleTypes, useUpdateDispatchPlanParams, type DispatchLoadBands, type DispatchPlan } from '@/api/hooks'
import type { AxiosError } from 'axios'

export type LoadBandDraft = { bands: DispatchLoadBands; bypass: boolean }
export const DEFAULT_BAND = { min: 70, max: 100 }
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'

/** Dòng xe CHA có ít nhất một dòng xe con đang hoạt động — thứ tự theo danh mục Loại xe (Cài đặt TMS).
 *  `warehouseId` (03/10): đang dùng TẠI KHO đó (dòng xe theo kho); thiếu ⇒ bản Chung. */
export function useLoadBandParents(warehouseId?: string | null) {
  const { data: modelsRes } = useVehicleModels({ is_active: true, warehouse_id: warehouseId || undefined })
  const { data: vtypes = [] } = useVehicleTypes()
  return useMemo(() => {
    const rank = new Map(vtypes.map((v, i) => [v.id, i]))
    const by = new Map<string, string>()
    for (const m of modelsRes?.items ?? []) if (m.parent_type_id && m.parent) by.set(m.parent_type_id, m.parent.name)
    return [...by.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => ((rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999)) || a.name.localeCompare(b.name))
  }, [modelsRes, vtypes])
}
/** Dải đầy đủ cho mọi cha: đã khai thì lấy, chưa thì min = ngưỡng Non tải của kho (hoặc 70) · max = 100. */
export function fullBands(parents: { id: string }[], known: DispatchLoadBands | null | undefined, fallbackMin: number | null | undefined): DispatchLoadBands {
  const out: DispatchLoadBands = {}
  const min = fallbackMin != null && Number.isFinite(Number(fallbackMin)) && Number(fallbackMin) > 0 ? Number(fallbackMin) : DEFAULT_BAND.min
  for (const p of parents) { const k = known?.[p.id]; out[p.id] = k && Number.isFinite(Number(k.min)) && Number.isFinite(Number(k.max)) ? { min: Number(k.min), max: Number(k.max) } : { min, max: DEFAULT_BAND.max } }
  return out
}
/** Câu tóm tắt in trên bàn: "XE PALLET 90–105 % · XE SCA 60–100 %" — cha nào còn mặc định thì gom lại cho gọn. */
export function bandSummary(parents: { id: string; name: string }[], bands: DispatchLoadBands | null | undefined, bypass: boolean | undefined, fallbackMin: number | null | undefined): string {
  if (bypass) return 'Bỏ qua dải % — xếp theo sức chứa 100 %, không báo Non tải'
  const full = fullBands(parents, bands, fallbackMin)
  const dflt = fullBands(parents, null, fallbackMin)
  const custom = parents.filter(p => full[p.id].min !== dflt[p.id].min || full[p.id].max !== dflt[p.id].max)
  if (!custom.length) { const d = Object.values(dflt)[0] ?? DEFAULT_BAND; return `Mọi dòng xe ${d.min}–${d.max} %` }
  const rest = parents.length - custom.length
  return custom.map(p => `${p.name} ${full[p.id].min}–${full[p.id].max} %`).join(' · ') + (rest > 0 ? ` · còn lại ${Object.values(dflt)[0]?.min ?? DEFAULT_BAND.min}–100 %` : '')
}

export function DispatchLoadBandDialog({ open, onClose, title, confirmLabel, intro, parents, initial, busy, onConfirm }: {
  open: boolean; onClose: () => void; title: string; confirmLabel: string; intro?: React.ReactNode
  parents: { id: string; name: string }[]; initial: LoadBandDraft; busy?: boolean
  onConfirm: (d: LoadBandDraft) => unknown
}) {
  const [bands, setBands] = useState<Record<string, { min: string; max: string }>>({})
  const [bypass, setBypass] = useState(false)
  useEffect(() => {
    if (!open) return
    setBypass(initial.bypass)
    setBands(Object.fromEntries(parents.map(p => [p.id, { min: String(initial.bands[p.id]?.min ?? DEFAULT_BAND.min), max: String(initial.bands[p.id]?.max ?? DEFAULT_BAND.max) }])))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => {
    const out: DispatchLoadBands = {}
    const errs: string[] = []
    for (const p of parents) {
      const r = bands[p.id]; if (!r) continue
      const min = Number(r.min), max = Number(r.max)
      if (!Number.isFinite(min) || min < 0 || min > 100) errs.push(`${p.name}: tối thiểu phải từ 0 đến 100`)
      else if (!Number.isFinite(max) || max < 50 || max > 130) errs.push(`${p.name}: tối đa phải từ 50 đến 130`)
      else if (min > max) errs.push(`${p.name}: tối thiểu đang lớn hơn tối đa`)
      else out[p.id] = { min, max }
    }
    return { out, errs }
  }, [bands, parents])
  const set = (id: string, k: 'min' | 'max', v: string) => setBands(b => ({ ...b, [id]: { ...(b[id] ?? { min: '', max: '' }), [k]: v } }))
  const ok = bypass || parsed.errs.length === 0
  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-sm flex items-center gap-1.5"><Gauge className="h-4 w-4 text-sky-600" /> {title}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-xs">
          {intro && <div className="text-slate-600 whitespace-pre-line">{intro}</div>}
          <div className="rounded-md border border-slate-200">
            <div className="grid grid-cols-[1fr_84px_84px] gap-1 border-b bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Dải % tải theo dòng xe cha</span><span className="text-right">Tối thiểu %</span><span className="text-right">Tối đa %</span>
            </div>
            {!parents.length && <div className="px-2 py-2 text-slate-400">Chưa có dòng xe nào đang hoạt động gán Loại xe cha.</div>}
            {parents.map(p => (
              <div key={p.id} className={`grid grid-cols-[1fr_84px_84px] items-center gap-1 px-2 py-1 border-b last:border-0 ${bypass ? 'opacity-50' : ''}`}>
                <span className="min-w-0 break-words font-medium text-slate-700">{p.name}</span>
                <input type="number" inputMode="decimal" min={0} max={100} step={1} value={bands[p.id]?.min ?? ''} disabled={bypass || busy} onChange={e => set(p.id, 'min', e.target.value)}
                  className="h-8 w-full rounded border border-slate-300 px-2 text-right tabular-nums" aria-label={`${p.name} tối thiểu %`} />
                <input type="number" inputMode="decimal" min={50} max={130} step={1} value={bands[p.id]?.max ?? ''} disabled={bypass || busy} onChange={e => set(p.id, 'max', e.target.value)}
                  className="h-8 w-full rounded border border-slate-300 px-2 text-right tabular-nums" aria-label={`${p.name} tối đa %`} />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">Dưới <b>tối thiểu</b> xe báo Non tải · máy được xếp tới <b>tối đa</b> (105 = cho vượt 5 % sức chứa danh định, % tải vẫn in theo danh định). Dải vừa chọn được nhớ làm mặc định cho kho.</p>
          <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 cursor-pointer">
            <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-amber-600" checked={bypass} disabled={busy} onChange={e => setBypass(e.target.checked)} />
            <span className="text-amber-900"><b>Bỏ qua dải %</b> — xếp theo sức chứa danh định (100 %), không báo Non tải. Máy sẽ chọn xe rẻ nhất kể cả xe to cho đơn nhỏ.</span>
          </label>
          {!bypass && parsed.errs.length > 0 && <ul className="list-disc pl-4 text-red-600">{parsed.errs.slice(0, 4).map(e => <li key={e}>{e}</li>)}</ul>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={onClose}>Huỷ</Button>
          <Button size="sm" className="h-8" disabled={busy || !ok} onClick={() => void onConfirm({ bands: bypass ? fullBands(parents, initial.bands, null) : parsed.out, bypass })}>{busy ? 'Đang chạy…' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Chip trên bàn ghép xe: dải đang áp cho kế hoạch — bấm để đổi ngay (xe nháp tính lại, không ghép lại). */
export function DispatchLoadBandChip({ plan, editable }: { plan: DispatchPlan; editable: boolean }) {
  const parents = useLoadBandParents(plan.warehouse_id)
  const [open, setOpen] = useState(false)
  const update = useUpdateDispatchPlanParams()
  const text = bandSummary(parents, plan.params.load_bands, plan.params.load_bypass, plan.params.underload_pct)
  return (
    <>
      <button type="button" onClick={() => editable && setOpen(true)} disabled={!editable}
        title={editable ? `Dải % tải đang áp: ${text} — bấm để đổi (xe nháp tính lại Non tải / vượt theo dải mới)` : `Dải % tải đang áp: ${text}`}
        className={`inline-flex items-center gap-1 rounded-md px-2 h-9 sm:h-7 text-[11px] max-w-[320px] ${plan.params.load_bypass ? 'bg-amber-100 text-amber-900' : 'bg-sky-50 text-sky-800'} ${editable ? 'hover:bg-sky-100' : ''}`}>
        <Gauge className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{text}</span>
      </button>
      <DispatchLoadBandDialog open={open} onClose={() => setOpen(false)} title="Dải % tải theo dòng xe cha" confirmLabel="Áp cho kế hoạch này"
        intro="Đổi dải cho kế hoạch đang mở: mọi xe nháp tính lại Non tải / vượt theo dải mới, máy KHÔNG ghép lại (bấm Tối ưu lại nếu muốn máy xếp lại theo dải)."
        parents={parents} initial={{ bands: fullBands(parents, plan.params.load_bands, plan.params.underload_pct), bypass: plan.params.load_bypass === true }} busy={update.isPending}
        onConfirm={d => update.mutateAsync({ plan_id: plan.id, load_bands: d.bands, load_bypass: d.bypass })
          .then(p => { setOpen(false); toast({ title: 'Đã áp dải % tải', description: `${p.summary.underload ?? 0} xe Non tải · ${p.summary.oversize ?? 0} xe vượt theo dải mới.` }) })
          .catch(e => toast({ variant: 'destructive', title: 'Không áp được dải tải', description: apiMsg(e) }))} />
    </>
  )
}
