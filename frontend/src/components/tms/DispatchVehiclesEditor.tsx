// DÒNG XE ĐƯỢC VÀO (điều vận, user chốt 27/09: "khách hàng nào vào được dòng xe nào — dạng multi check box theo chuẩn;
// mặc định theo kênh, khách đặc biệt config riêng"). Map {"*": [id…], "<Loại kho>": [id…]} — "*" = mọi Loại kho.
// Thứ tự máy áp (backend `resolveAllowedModels`): Khách × Loại kho → Khách → Kênh × Loại kho → Kênh → mọi xe.
//
// Danh sách chọn là DÒNG XE CON (mã SAP — đủ để nói "chỉ xe nhỏ"), gom dưới LOẠI XE CHA cho dễ tick cả họ.
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { VehicleModel } from '@/api/hooks'

const nf = (n: number) => n.toLocaleString('vi-VN')
const capText = (m: VehicleModel) =>
  [m.max_pallets ? `${nf(Number(m.max_pallets))} pallet` : '', m.max_tons ? `${nf(Number(m.max_tons))} tấn` : ''].filter(Boolean).join(' · ') || 'chưa khai sức chứa'

/** Tóm tắt một danh sách để in trên bảng / dòng "theo kênh". */
export function vehicleListText(ids: string[] | undefined, models: VehicleModel[]): string {
  if (!ids) return ''
  if (!ids.length) return 'không xe nào'
  const byId = new Map(models.map(m => [m.id, m]))
  const names = ids.map(id => byId.get(id)?.name).filter((x): x is string => !!x)
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

/** Checkbox cha có trạng thái "một phần" — đặt qua ref vì HTML không có thuộc tính indeterminate. */
function TriCheck({ checked, partial, onChange }: { checked: boolean; partial: boolean; onChange: () => void }) {
  return <input type="checkbox" checked={checked} onChange={onChange} ref={el => { if (el) el.indeterminate = partial && !checked }} className="h-4 w-4 accent-sky-600" />
}

/** Cây tick Loại xe cha → dòng xe con. Chỉ dòng xe ĐANG HOẠT ĐỘNG và đã gán cha (máy chỉ dùng những dòng đó). */
export function VehicleModelChecklist({ models, value, onChange }: { models: VehicleModel[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('')
  const sel = new Set(value)
  const groups = useMemo(() => {
    const by = new Map<string, VehicleModel[]>()
    for (const m of models.filter(x => x.is_active && x.parent)) {
      const k = m.parent!.name
      by.set(k, [...(by.get(k) ?? []), m])
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, ms]) => ({ name, ms: ms.sort((a, b) => (Number(a.max_tons ?? 0) - Number(b.max_tons ?? 0)) || (Number(a.max_pallets ?? 0) - Number(b.max_pallets ?? 0)) || a.name.localeCompare(b.name)) }))
  }, [models])
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter(g => g.ms.some(m => sel.has(m.id))).map(g => g.name)))
  const term = q.trim().toLowerCase()
  const match = (m: VehicleModel) => !term || m.name.toLowerCase().includes(term) || m.sap_code.toLowerCase().includes(term)
  const setMany = (ids: string[], on: boolean) => {
    const n = new Set(sel)
    ids.forEach(id => (on ? n.add(id) : n.delete(id)))
    onChange([...n].sort())
  }
  return (
    <div className="rounded-md border border-slate-200">
      <div className="border-b bg-slate-50 p-1.5">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm dòng xe / mã SAP…" className="h-8 text-xs" />
      </div>
      <div className="max-h-64 overflow-y-auto divide-y">
        {groups.map(g => {
          const shown = g.ms.filter(match)
          if (!shown.length) return null
          const n = g.ms.filter(m => sel.has(m.id)).length
          const isOpen = open.has(g.name) || !!term
          return (
            <div key={g.name}>
              <div className="flex items-center gap-2 px-2 py-1.5 bg-white">
                <TriCheck checked={n === g.ms.length} partial={n > 0} onChange={() => setMany(g.ms.map(m => m.id), n < g.ms.length)} />
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-slate-700"
                  onClick={() => setOpen(s => { const x = new Set(s); x.has(g.name) ? x.delete(g.name) : x.add(g.name); return x })}>
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{g.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-normal text-slate-400">{n}/{g.ms.length}</span>
                </button>
              </div>
              {isOpen && shown.map(m => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 py-1 pl-8 pr-2 hover:bg-slate-50">
                  <input type="checkbox" checked={sel.has(m.id)} onChange={() => setMany([m.id], !sel.has(m.id))} className="h-4 w-4 accent-sky-600" />
                  <span className="min-w-0 flex-1 text-xs text-slate-700">{m.name}{m.dispatch_use === 'TRANSFER' && <span className="ml-1 text-[10px] text-amber-600">(mặc định chỉ trung chuyển)</span>}</span>
                  <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{capText(m)}</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>
      <div className="border-t bg-slate-50 px-2 py-1 text-[10px] text-slate-500">Đã chọn {nf(value.length)} dòng xe</div>
    </div>
  )
}

/**
 * Bảng "Dòng xe được vào" theo Loại kho cho MỘT khách hoặc MỘT kênh. Mỗi dòng: Mọi Loại kho / từng Loại kho —
 * "Theo kênh" (khách) hoặc "Mọi xe" (kênh) = không khai khoá đó; "Chọn dòng xe" = khai danh sách.
 */
export function DispatchVehiclesEditor({ value, onChange, cats, models, inherit }: {
  value: Record<string, string[]>
  onChange: (next: Record<string, string[]>) => void
  cats: { value: string; label: string }[]
  models: VehicleModel[]
  /** Khách: map của kênh để in "theo kênh: …". Kênh: undefined (không khai = mọi xe). */
  inherit?: { label: string; map: Record<string, string[]> } | null
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const rows = [{ key: '*', label: 'Mọi Loại kho' }, ...cats.map(c => ({ key: c.value, label: c.label !== c.value ? `${c.value} — ${c.label}` : c.value }))]
  const offWord = inherit !== undefined ? 'Theo kênh' : 'Mọi xe'
  /** Máy sẽ áp gì cho khoá này nếu KHÔNG khai (để người khai thấy mình đang đè cái gì). */
  const fallback = (key: string): string => {
    if (key !== '*' && value['*']) return `theo "Mọi Loại kho": ${vehicleListText(value['*'], models)}`
    if (inherit) {
      const l = inherit.map[key] ?? inherit.map['*']
      return l ? `theo kênh ${inherit.label}: ${vehicleListText(l, models)}` : inherit.label ? `kênh ${inherit.label} chưa khai — mọi xe` : 'chưa phân kênh — mọi xe'
    }
    return 'mọi dòng xe'
  }
  const set = (key: string, ids: string[] | null) => {
    const n = { ...value }
    if (ids === null) delete n[key]; else n[key] = ids
    onChange(n)
  }
  return (
    <div className="rounded-md border border-slate-200 divide-y">
      {rows.map(r => {
        const on = Array.isArray(value[r.key])
        return (
          <div key={r.key} className="px-2 py-1.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-xs font-medium text-slate-700">{r.label}</span>
              <div className="grid grid-cols-2 gap-0.5 rounded border border-slate-200 p-0.5">
                <button type="button" onClick={() => { set(r.key, null); if (editing === r.key) setEditing(null) }}
                  className={`rounded px-2 py-1 text-[11px] ${!on ? 'bg-sky-100 text-sky-800 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>{offWord}</button>
                <button type="button" onClick={() => { if (!on) set(r.key, []); setEditing(r.key) }}
                  className={`rounded px-2 py-1 text-[11px] ${on ? 'bg-sky-100 text-sky-800 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>Chọn dòng xe</button>
              </div>
            </div>
            <p className={`text-[11px] ${on ? (value[r.key].length ? 'text-slate-600' : 'text-red-600') : 'text-slate-400'}`}>
              {on
                ? (value[r.key].length ? `${nf(value[r.key].length)} dòng xe: ${vehicleListText(value[r.key], models)}` : 'Chưa tick dòng xe nào — máy sẽ không xếp được hàng loại này')
                : fallback(r.key)}
              {on && editing !== r.key && <button type="button" className="ml-2 text-sky-700 underline" onClick={() => setEditing(r.key)}>Sửa</button>}
            </p>
            {on && editing === r.key && <VehicleModelChecklist models={models} value={value[r.key]} onChange={ids => set(r.key, ids)} />}
          </div>
        )
      })}
    </div>
  )
}
