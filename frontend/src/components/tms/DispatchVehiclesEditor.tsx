// DÒNG XE ĐƯỢC VÀO (điều vận, user chốt 27/09: "khách hàng nào vào được dòng xe nào — dạng multi check box theo chuẩn;
// mặc định theo kênh, khách đặc biệt config riêng"). Map {"*": [id…], "<Loại kho>": [id…]} — "*" = mọi Loại kho.
// Thứ tự máy áp (backend `resolveAllowedModels`): Khách × Loại kho → Khách → Kênh × Loại kho → Kênh → KHÔNG xe nào
// (28/09, user: "dòng xe chọn theo khai báo của khách, không khai thì không chọn" — trước đó rơi về "mọi xe").
//
// Danh sách chọn là DÒNG XE CON (mã SAP — đủ để nói "chỉ xe nhỏ"), gom dưới LOẠI XE CHA cho dễ tick cả họ.
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { VehicleModel } from '@/api/hooks'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'

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
  const allIds = groups.flatMap(g => g.ms.map(m => m.id))
  const allOn = allIds.length > 0 && allIds.every(id => sel.has(id))
  return (
    <div className="rounded-md border border-slate-200">
      <div className="flex items-center gap-1.5 border-b bg-slate-50 p-1.5">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm dòng xe / mã SAP…" className="h-8 text-xs flex-1 min-w-0" />
        {/* "mọi xe" cho một kênh = tick hết (28/09: không khai không còn nghĩa là mọi xe) */}
        <button type="button" className="shrink-0 rounded border border-slate-300 bg-white px-2 h-8 text-[11px] text-slate-700 hover:bg-slate-100" onClick={() => setMany(allIds, !allOn)}>
          {allOn ? 'Bỏ chọn hết' : 'Chọn tất cả'}
        </button>
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
                  <span className="min-w-0 flex-1 text-xs text-slate-700">{m.name}</span>
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
 * "Theo kênh" (khách) hoặc "Chưa khai" (kênh) = không khai khoá đó; "Chọn dòng xe" = khai danh sách.
 */
export function DispatchVehiclesEditor({ value, onChange, cats, models, inherit }: {
  value: Record<string, string[]>
  onChange: (next: Record<string, string[]>) => void
  cats: { value: string; label: string }[]
  models: VehicleModel[]
  /** Khách: map của kênh để in "theo kênh: …". Kênh: undefined (không khai = không xe nào). */
  inherit?: { label: string; map: Record<string, string[]> } | null
}) {
  const [editing, setEditing] = useState<string | null>(null)
  // Loại kho "đi kèm đơn" (POSM — cờ ở Cài đặt WMS → Loại kho): máy chọn xe theo Loại kho CHÍNH của đơn, không hỏi dòng này
  // (29/09, user: "PM01, RM01, PK01 nếu đi theo đơn thì chọn ở đâu?") ⇒ dòng in ghi chú thay vì ô chọn, khỏi khai vào chỗ máy không đọc
  const whMeta = useWhTypeMetaMap()
  const isFollow = (key: string) => key !== '*' && whMeta.get(key)?.dispatch_follow === true
  const rows = [{ key: '*', label: 'Mọi Loại kho' }, ...cats.map(c => ({ key: c.value, label: c.label !== c.value ? `${c.value} — ${c.label}` : c.value }))]
  const offWord = inherit !== undefined ? 'Theo kênh' : 'Chưa khai'
  /** Máy sẽ áp gì cho khoá này nếu KHÔNG khai (để người khai thấy mình đang đè cái gì). Không bậc nào khai ⇒ máy không chọn xe. */
  const fallback = (key: string): { text: string; none: boolean } => {
    if (key !== '*' && value['*']) return { text: `theo "Mọi Loại kho": ${vehicleListText(value['*'], models)}`, none: !value['*'].length }
    if (inherit) {
      const l = inherit.map[key] ?? inherit.map['*']
      return l ? { text: `theo kênh ${inherit.label}: ${vehicleListText(l, models)}`, none: !l.length }
        : { text: inherit.label ? `kênh ${inherit.label} chưa khai — máy KHÔNG chọn xe` : 'chưa phân kênh — máy KHÔNG chọn xe', none: true }
    }
    return { text: 'chưa khai — máy KHÔNG chọn xe', none: true }
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
        const fb = on ? null : fallback(r.key)
        if (isFollow(r.key)) return (
          <div key={r.key} className="px-2 py-1.5 flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-xs font-medium text-slate-700">{r.label}</span>
            <span className="rounded border border-dashed border-slate-300 px-2 py-1 text-[11px] text-slate-500"
              title='Loại kho này bật "Đi kèm đơn khi điều vận" (Cài đặt WMS → Loại kho): đi cùng xe của hàng chính trên đơn, máy không hỏi dòng xe riêng cho nó. Đơn CHỈ có hàng loại này thì theo "Mọi Loại kho".'>
              Đi kèm đơn — theo xe của hàng chính{on ? <button type="button" className="ml-2 text-sky-700 underline" onClick={() => set(r.key, null)}>bỏ khai riêng</button> : null}
            </span>
          </div>
        )
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
            <p className={`text-[11px] ${on ? (value[r.key].length ? 'text-slate-600' : 'text-red-600') : fb?.none ? 'text-amber-700' : 'text-slate-400'}`}>
              {on
                ? (value[r.key].length ? `${nf(value[r.key].length)} dòng xe: ${vehicleListText(value[r.key], models)}` : 'Chưa tick dòng xe nào — máy sẽ không xếp được hàng loại này')
                : fb?.text}
              {on && editing !== r.key && <button type="button" className="ml-2 text-sky-700 underline" onClick={() => setEditing(r.key)}>Sửa</button>}
            </p>
            {on && editing === r.key && (
              <div className="space-y-1">
                <VehicleModelChecklist models={models} value={value[r.key]} onChange={ids => set(r.key, ids)} />
                {/* 29/09 (user: "sửa xong phải có nút lưu nhỏ để làm tiếp"): thu gọn bảng tick để đi tiếp các ô khác — dữ liệu đã
                    nằm trong form, ghi thật khi bấm Lưu của form (một form một nút Lưu) */}
                <div className="flex items-center justify-end gap-2">
                  <span className="text-[10px] text-slate-400">Ghi khi bấm Lưu của form</span>
                  <button type="button" onClick={() => setEditing(null)}
                    className="h-7 rounded border border-sky-600 bg-sky-600 px-2.5 text-[11px] font-medium text-white hover:bg-sky-700">
                    ✓ Xong{value[r.key].length ? ` (${nf(value[r.key].length)} dòng xe)` : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
