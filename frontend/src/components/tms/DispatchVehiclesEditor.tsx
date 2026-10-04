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

const nf = (n: number) => n.toLocaleString('vi-VN')
const capText = (m: VehicleModel) =>
  [m.max_pallets ? `${nf(Number(m.max_pallets))} pallet` : '', m.max_tons ? `${nf(Number(m.max_tons))} tấn` : ''].filter(Boolean).join(' · ') || 'chưa khai sức chứa'

/** Dòng xe máy CÒN DÙNG được (đang hoạt động + đã gán cha) trong một danh sách đã lưu — phần còn lại là mã đã ngừng /
 *  chưa gán cha / không còn trong danh mục. 29/09 (user: "tích có 4 cái nhưng lại đọc thành 5"): kênh Trung chuyển lưu 5 mã,
 *  1 đã ngừng ⇒ bảng tick hiện 4 mà số đếm in 5; MT/KA/BHX lưu 33 mã từ lúc "Chọn tất cả", 21 đã ngừng sau đó. Máy chỉ đọc
 *  dòng xe đang hoạt động nên xếp xe không sai — chỉ SỐ ĐẾM sai; mọi chỗ đếm/in tên đi qua hàm này. */
export function splitVehicleIds(ids: string[], models: VehicleModel[]): { live: string[]; dead: string[] } {
  const ok = new Set(models.filter(m => m.is_active && m.parent).map(m => m.id))
  return { live: ids.filter(id => ok.has(id)), dead: ids.filter(id => !ok.has(id)) }
}
/** Tóm tắt một danh sách để in trên bảng / dòng "theo kênh" — đếm dòng xe CÒN DÙNG, nêu số mã đã ngừng nếu có. */
export function vehicleListText(ids: string[] | undefined, models: VehicleModel[]): string {
  if (!ids) return ''
  if (!ids.length) return 'không xe nào'
  const byId = new Map(models.map(m => [m.id, m]))
  const { live, dead } = splitVehicleIds(ids, models)
  const names = live.map(id => byId.get(id)?.name).filter((x): x is string => !!x)
  const head = !names.length ? 'không dòng xe nào còn hoạt động' : names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
  return dead.length ? `${head} (+${dead.length} mã đã ngừng, máy không dùng)` : head
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
      {(() => {
        const { live, dead } = splitVehicleIds(value, models)
        return (
          <div className="border-t bg-slate-50 px-2 py-1 text-[10px] text-slate-500 flex flex-wrap items-center gap-x-2">
            <span>Đã chọn {nf(live.length)} dòng xe</span>
            {dead.length > 0 && (
              <span className="text-amber-700">
                · còn {nf(dead.length)} mã đã ngừng / không còn trong danh mục (máy không dùng)
                <button type="button" className="ml-1 underline" onClick={() => onChange(live)}>gỡ</button>
              </span>
            )}
          </div>
        )
      })()}
    </div>
  )
}
// 04/10: bảng chọn theo Loại kho chuyển sang `DispatchFleetTable` (gộp với cột Khách/xe); file này giữ cây tick + helper đếm.
