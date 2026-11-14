// CÀI ĐẶT MES → tab "MẪU PHIẾU THEO DÕI" (14/11 khuya — user: "những cái khác bạn cho nó là số liệu config được").
// Trái: danh sách mẫu (bấm để chọn, + Thêm mẫu phiếu). Phải: tên phiếu · tên ngắn · Đang dùng · Sửa | Xem thử · MỘT nút Lưu.
// Sửa mẫu áp cho phiếu MỚI và phiếu chưa sửa riêng; phiếu đã sửa riêng tại bàn hoặc QA đã xác nhận giữ cấu trúc của nó.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { Save, Plus, Eye, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ProcessFormEditor } from './ProcessFormEditor'
import { ProcessLogBody } from './ProcessLogSheet'
import { blockCellCount, blockKeys, blocksError, slugKey, type FormBlock } from '@/config/processForms'
import { useProcessForms, useSaveProcessForm, type ProcessFormDef } from '@/api/productionHooks'
import { formatDateTime } from '@/utils/formatters'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được — thử lại'
type Draft = { code: string; title: string; short: string; is_active: boolean; blocks: FormBlock[]; isNew: boolean }
const toDraft = (d: ProcessFormDef): Draft => ({ code: d.code, title: d.title, short: d.short, is_active: d.is_active, blocks: structuredClone(d.blocks), isNew: false })

export function ProcessFormSettings({ canConfigure }: { canConfigure: boolean }) {
  const { data: forms = [], isLoading, isError, error } = useProcessForms()
  const save = useSaveProcessForm()
  const [ask, confirmNode] = useConfirmDialog()
  const [pick, setPick] = useState<string>('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState<Record<string, string>>({})

  const server = forms.find(f => f.code === pick) ?? null
  const stamp = server ? `${server.code}|${server.updated_at}` : ''
  useEffect(() => { if (!pick && forms.length) setPick(forms[0].code) }, [forms, pick])
  useEffect(() => { if (server) { setDraft(toDraft(server)); setErr('') } }, [stamp]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!draft && (draft.isNew || !server || JSON.stringify(toDraft(server)) !== JSON.stringify({ ...draft, isNew: false }))
  const invalid = !draft ? '' : !draft.title.trim() ? 'Chưa đặt tên phiếu' : !draft.short.trim() ? 'Chưa đặt tên ngắn' : blocksError(draft.blocks)
  const lockedKeys = useMemo(() => (server ? blockKeys(server.blocks) : new Set<string>()), [server])

  async function choose(code: string) {
    if (code === pick && !draft?.isNew) return
    if (dirty && await ask({ title: 'Bỏ thay đổi chưa lưu?', body: `Mẫu "${draft?.title}" có thay đổi chưa lưu.`, confirmLabel: 'Bỏ thay đổi', danger: true }) === null) return
    setPick(code); setView('edit'); setPreview({})
    const f = forms.find(x => x.code === code)
    if (f) setDraft(toDraft(f))
  }
  async function addForm() {
    if (dirty && await ask({ title: 'Bỏ thay đổi chưa lưu?', body: `Mẫu "${draft?.title}" có thay đổi chưa lưu.`, confirmLabel: 'Bỏ thay đổi', danger: true }) === null) return
    const title = await ask({ title: 'Thêm mẫu phiếu theo dõi', input: { label: 'Tên phiếu', placeholder: 'vd Phiếu theo dõi tiệt trùng UHT', required: true }, confirmLabel: 'Tạo' })
    if (!title?.trim()) return
    const used = new Set(forms.map(f => f.code.toLowerCase()))
    const raw = slugKey(title.replace(/^phiếu (theo dõi )?/i, ''), used, 18).toUpperCase().replace(/^[^A-Z]+/, 'P')
    const code = raw.length < 2 ? `${raw}_2` : raw   // BE: chữ IN HOA đầu, 2–20 ký tự
    setPick(code); setView('edit')
    setDraft({ code, title: title.trim(), short: title.trim().replace(/^phiếu theo dõi\s*/i, '').slice(0, 30) || code, is_active: true, isNew: true,
      blocks: [{ type: 'fields', title: 'Thông số', fields: [{ key: 'o', label: '', kind: 'num' }] }] })
  }
  function onSave() {
    if (!draft || invalid) return
    setErr('')
    save.mutate({ code: draft.code, title: draft.title.trim(), short: draft.short.trim(), is_active: draft.is_active, blocks: draft.blocks,
      ...(draft.isNew ? { sort_order: (forms.reduce((m, f) => Math.max(m, f.sort_order), 0) + 10) } : {}) },
      { onSuccess: d => { setDraft(toDraft(d)); setPick(d.code) }, onError: e => setErr(apiMsg(e)) })
  }

  const list = draft?.isNew ? [...forms, { code: draft.code, title: draft.title, short: draft.short, blocks: draft.blocks, is_active: true, sort_order: 0, updated_by_name: null, updated_at: '' } as ProcessFormDef] : forms
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)] gap-3">
      {/* danh sách mẫu */}
      <div className="space-y-1.5">
        <div className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          {isLoading && <p className="text-xs text-slate-400">Đang tải…</p>}
          {list.map(f => {
            const on = f.code === pick
            return (
              <button key={f.code} type="button" onClick={() => void choose(f.code)}
                className={`touch-target shrink-0 text-left rounded-lg border px-2.5 py-1.5 min-w-[11rem] lg:min-w-0 transition-colors ${on ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-semibold truncate flex-1 min-w-0 ${on ? 'text-sky-900' : 'text-slate-800'}`}>{on && draft ? draft.short || '—' : f.short}</span>
                  {!(on && draft ? draft.is_active : f.is_active) && <StatusBadge tone="slate">Ngưng</StatusBadge>}
                </div>
                <p className="text-[10px] text-slate-500 truncate">{blockCellCount(on && draft ? draft.blocks : f.blocks)} ô{on && dirty ? ' · chưa lưu' : ''}</p>
              </button>
            )
          })}
        </div>
        {canConfigure && (
          <button type="button" onClick={() => void addForm()}
            className="touch-target w-full inline-flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-white">
            <Plus className="h-3.5 w-3.5" />Thêm mẫu phiếu
          </button>
        )}
      </div>

      {/* mẫu đang chọn */}
      <div className="min-w-0 space-y-2.5">
        {isError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{apiMsg(error)}</div>}
        {err && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
        {draft && (<>
          <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={draft.title} disabled={!canConfigure} maxLength={120} onChange={e => setDraft({ ...draft, title: e.target.value })}
                placeholder="Tên phiếu (in trên file Excel)" aria-label="Tên phiếu" className="h-8 text-xs font-semibold flex-1 min-w-[12rem]" />
              <Input value={draft.short} disabled={!canConfigure} maxLength={30} onChange={e => setDraft({ ...draft, short: e.target.value })}
                placeholder="Tên ngắn" aria-label="Tên ngắn" className="h-8 text-xs w-32" />
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 shrink-0">
                <Switch checked={draft.is_active} disabled={!canConfigure} onCheckedChange={c => setDraft({ ...draft, is_active: c })} />Đang dùng
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-8 rounded-md border border-slate-200 overflow-hidden text-[11px]">
                <button type="button" onClick={() => setView('edit')} className={`px-2.5 inline-flex items-center gap-1 ${view === 'edit' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}><Pencil className="h-3 w-3" />{canConfigure ? 'Sửa' : 'Cấu trúc'}</button>
                <button type="button" onClick={() => setView('preview')} className={`px-2.5 border-l border-slate-200 inline-flex items-center gap-1 ${view === 'preview' ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}><Eye className="h-3 w-3" />Xem thử</button>
              </div>
              <span className="text-[10px] text-slate-500 flex-1 min-w-0 truncate">
                Mã <span className="font-mono">{draft.code}</span>{server?.updated_by_name ? ` · sửa lần cuối ${server.updated_by_name}, ${formatDateTime(server.updated_at)}` : ''}
              </span>
              {canConfigure && (
                <Button className="h-8 text-xs shrink-0" disabled={!dirty || !!invalid || save.isPending} onClick={onSave}>
                  <Save className="h-3.5 w-3.5 mr-1" />{save.isPending ? 'Đang lưu…' : 'Lưu mẫu'}
                </Button>
              )}
            </div>
            {invalid && dirty && <p className="text-[11px] text-amber-700">{invalid}</p>}
            <p className="text-[10px] text-slate-500">Sửa mẫu áp cho phiếu mới và phiếu chưa sửa riêng. Phiếu đã sửa riêng tại bàn hoặc đã được QA xác nhận giữ nguyên cấu trúc của nó; giá trị đã ghi không bao giờ mất.</p>
          </div>
          {view === 'edit'
            ? <ProcessFormEditor blocks={draft.blocks} onChange={b => setDraft({ ...draft, blocks: b })} lockedKeys={lockedKeys} disabled={!canConfigure} />
            : <div className="space-y-3 rounded-lg border border-dashed border-slate-300 bg-white p-2.5">
                <p className="text-[11px] text-slate-500">Xem thử — gõ thử được, không lưu gì.</p>
                <ProcessLogBody blocks={draft.blocks} values={preview} onValue={(k, val) => setPreview(s => ({ ...s, [k]: val }))} editable />
              </div>}
        </>)}
      </div>
      {confirmNode}
    </div>
  )
}
