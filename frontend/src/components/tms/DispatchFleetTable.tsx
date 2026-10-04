// BẢNG GHÉP XE THEO LOẠI KHO — một bảng cho cả "Dòng xe được vào" lẫn "Số khách tối đa cùng xe" (04/10, user: "trong form chung
// thì Dòng xe được vào và cái này thể hiện UI dễ nhìn hơn, hiện tại đang khá là rối mắt — đưa vào dạng table").
//
//   Loại kho        | Dòng xe được vào                         | Khách/xe
//   Chung           | 5 dòng xe: Xe 15P, Xe 34P +3   Sửa · Về… | [ 3 ]
//   FG01 — Hàng khô | theo Chung: 5 dòng xe          Khai riêng| [ 1 ]  (placeholder in giá trị đang hiệu lực — luật C47)
//   PM01 — POSM     | Đi kèm đơn — theo xe của hàng chính      | —
//
// Thứ tự máy áp (backend `resolveAllowedModels` / `resolveMaxCustomers`): Khách × Loại kho → Khách chung → Kênh × Loại kho → Kênh chung.
// Dòng xe: không bậc nào khai = KHÔNG xe nào (28/09). Số khách: không bậc nào khai = 1 (02/10). Cùng một component cho form Khách
// (inherit = kênh), form Kênh (inherit undefined) và tấm "Dòng xe được vào" trên bàn ghép (không cột Khách/xe).
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import type { VehicleModel } from '@/api/hooks'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'
import { VehicleModelChecklist, splitVehicleIds, vehicleListText } from './DispatchVehiclesEditor'

const nf = (n: number) => n.toLocaleString('vi-VN')
/** Ô "Số khách tối đa cùng xe" theo khoá: '*' = Chung, còn lại = Loại kho; giá trị là CHUỖI đang gõ ('' = không khai) */
export type MaxCustDraft = Record<string, string>

/** Chuỗi ô nhập → số 1–50 | null (trống) | 'bad' (sai) — một chỗ cho cả form Khách lẫn Kênh */
export const maxCustOf = (s: string | undefined): number | null | 'bad' => {
  const t = (s ?? '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 'bad'
}
/** Bản nháp → body API: Chung (`max_customers_per_trip`) + bảng theo Loại kho; 'bad' = có ô sai (người sửa trước khi lưu) */
export function maxCustPayload(d: MaxCustDraft): { max_customers_per_trip: number | null; max_customers_by_category: Record<string, number> } | 'bad' {
  const g = maxCustOf(d['*'])
  if (g === 'bad') return 'bad'
  const by: Record<string, number> = {}
  for (const [k, v] of Object.entries(d)) {
    if (k === '*') continue
    const n = maxCustOf(v)
    if (n === 'bad') return 'bad'
    if (n != null) by[k] = n
  }
  return { max_customers_per_trip: g, max_customers_by_category: by }
}
/** Dữ liệu đã lưu → bản nháp của bảng */
export const maxCustDraft = (general: number | null | undefined, byCat: Record<string, number> | undefined): MaxCustDraft =>
  ({ '*': general == null ? '' : String(general), ...Object.fromEntries(Object.entries(byCat ?? {}).map(([k, v]) => [k, String(v)])) })

export function DispatchFleetTable({ vehicles, onVehicles, maxCust, onMaxCust, cats, models, inherit, readOnly }: {
  vehicles: Record<string, string[]>
  onVehicles: (next: Record<string, string[]>) => void
  /** Không truyền = ẩn cột Khách/xe (tấm trên bàn ghép chỉ sửa dòng xe) */
  maxCust?: MaxCustDraft
  onMaxCust?: (next: MaxCustDraft) => void
  cats: { value: string; label: string }[]
  models: VehicleModel[]
  /** Form KHÁCH: cấu hình của kênh đang chọn để in "theo kênh: …". Form KÊNH: undefined (không khai = không xe nào / = 1). */
  inherit?: { label: string; vehicles: Record<string, string[]>; maxCust?: Record<string, number | null | undefined> } | null
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  // Loại kho "đi kèm đơn" (POSM): máy chọn xe theo Loại kho CHÍNH của đơn, không hỏi dòng này (29/09)
  const whMeta = useWhTypeMetaMap()
  const isFollow = (key: string) => key !== '*' && whMeta.get(key)?.dispatch_follow === true
  const rows = [{ key: '*', code: 'Chung', label: 'mọi Loại kho chưa khai riêng' }, ...cats.map(c => ({ key: c.value, code: c.value, label: c.label !== c.value ? c.label : '' }))]
  const withMax = !!maxCust && !!onMaxCust
  const chanWord = inherit ? (inherit.label ? `kênh ${inherit.label}` : 'kênh') : ''

  /** Dòng xe máy sẽ áp cho khoá này nếu KHÔNG khai riêng ở đây */
  const vehFallback = (key: string): { text: string; none: boolean } => {
    if (key !== '*' && vehicles['*']) return { text: `theo Chung: ${vehicleListText(vehicles['*'], models)}`, none: !vehicles['*'].length }
    if (inherit) {
      const l = inherit.vehicles[key] ?? inherit.vehicles['*']
      if (l) return { text: `theo ${chanWord}: ${vehicleListText(l, models)}`, none: !l.length }
      return { text: inherit.label ? `${chanWord} chưa khai — máy KHÔNG chọn xe` : 'chưa phân kênh — máy KHÔNG chọn xe', none: true }
    }
    return { text: 'chưa khai — máy KHÔNG chọn xe', none: true }
  }
  /** Số khách máy sẽ áp nếu ô này trống (in làm placeholder — ô "theo cha" phải in giá trị đang hiệu lực) */
  const maxFallback = (key: string): string => {
    const g = maxCustOf(maxCust?.['*'])
    if (key !== '*' && typeof g === 'number') return `Chung: ${g}`
    if (inherit) {
      const v = (key !== '*' ? inherit.maxCust?.[key] : undefined) ?? inherit.maxCust?.['*']
      if (typeof v === 'number') return `Kênh: ${v}`
    }
    return '1 (chưa khai)'
  }
  const backWord = (key: string) => (key !== '*' && vehicles['*'] ? 'Về theo Chung' : inherit !== undefined ? 'Về theo kênh' : 'Bỏ khai')
  const setVeh = (key: string, ids: string[] | null) => {
    const n = { ...vehicles }
    if (ids === null) delete n[key]; else n[key] = ids
    onVehicles(n)
  }
  const link = 'text-[10px] text-sky-700 underline underline-offset-2 disabled:text-slate-300 disabled:no-underline'

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <table className="w-full table-fixed text-[11px]">
        <colgroup>
          <col className="w-[96px] sm:w-[128px]" />
          <col />
          {withMax && <col className="w-[84px] sm:w-[96px]" />}
        </colgroup>
        <thead>
          <tr className="border-b bg-slate-50 text-left text-[9px] font-medium text-slate-500">
            <th className="px-2 py-1.5">Loại kho</th>
            <th className="px-2 py-1.5">Dòng xe được vào</th>
            {withMax && <th className="px-2 py-1.5 text-right" title="Số khách tối đa cùng xe — xe chở nhiều khách lấy số nhỏ nhất trong các khách trên xe; trống = theo bậc trên (giá trị in mờ trong ô)">Khách/xe</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(r => {
            const on = Array.isArray(vehicles[r.key])
            const fb = on ? null : vehFallback(r.key)
            const follow = isFollow(r.key)
            const live = on ? splitVehicleIds(vehicles[r.key], models).live.length : 0
            const mx = maxCust?.[r.key] ?? ''
            const bad = maxCustOf(mx) === 'bad'
            return (
              <FragmentRow key={r.key}>
                <tr className="align-top">
                  <td className="px-2 py-1.5">
                    <div className="font-semibold text-slate-700 truncate">{r.code}</div>
                    {r.label && <div className="text-[9px] text-slate-400 leading-tight">{r.label}</div>}
                  </td>
                  <td className="px-2 py-1.5 min-w-0">
                    {follow ? (
                      <span className="text-slate-500" title='Loại kho này bật "Đi kèm đơn khi điều vận" (Cài đặt WMS → Loại kho): đi cùng xe của hàng chính trên đơn, máy không hỏi dòng xe riêng. Đơn CHỈ có hàng loại này thì theo "Chung".'>
                        Đi kèm đơn — theo xe của hàng chính{on && !readOnly && <button type="button" className={`ml-2 ${link}`} onClick={() => setVeh(r.key, null)}>bỏ khai riêng</button>}
                      </span>
                    ) : (
                      <>
                        <div className={`truncate ${on ? (live ? 'text-slate-700' : 'text-red-600') : fb?.none ? 'text-amber-700' : 'text-slate-400'}`}
                          title={on ? (live ? vehicleListText(vehicles[r.key], models) : undefined) : fb?.text}>
                          {on ? (live ? <><b>{nf(live)} dòng xe</b>: {vehicleListText(vehicles[r.key], models)}</> : 'Chưa tick dòng xe nào — máy không xếp được hàng loại này') : fb?.text}
                        </div>
                        {!readOnly && (
                          <div className="mt-0.5 flex flex-wrap gap-x-2">
                            {on ? (
                              <>
                                <button type="button" className={link} onClick={() => setEditing(editing === r.key ? null : r.key)}>{editing === r.key ? 'Thu gọn' : 'Sửa'}</button>
                                <button type="button" className={link} onClick={() => { setVeh(r.key, null); if (editing === r.key) setEditing(null) }}>{backWord(r.key)}</button>
                              </>
                            ) : (
                              <button type="button" className={link} onClick={() => { setVeh(r.key, []); setEditing(r.key) }}>Khai riêng</button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  {withMax && (
                    <td className="px-2 py-1">
                      {follow ? <span className="block text-right text-slate-300">—</span> : (
                        <Input value={mx} inputMode="numeric" disabled={readOnly} aria-label={`Số khách tối đa cùng xe — ${r.code}`}
                          onChange={e => onMaxCust!({ ...maxCust!, [r.key]: e.target.value })}
                          placeholder={maxFallback(r.key)} title={mx.trim() ? undefined : `Trống = ${maxFallback(r.key)}`}
                          className={`h-7 w-full px-1.5 text-right text-[11px] placeholder:text-[10px] ${bad ? 'border-red-400 text-red-600' : ''}`} />
                      )}
                    </td>
                  )}
                </tr>
                {on && editing === r.key && !follow && (
                  <tr className="bg-slate-50/60">
                    <td colSpan={withMax ? 3 : 2} className="px-2 py-1.5">
                      <VehicleModelChecklist models={models} value={vehicles[r.key]} onChange={ids => setVeh(r.key, ids)} />
                      {/* 29/09 (user: "sửa xong phải có nút lưu nhỏ để làm tiếp"): thu gọn bảng tick; ghi thật khi bấm Lưu của form */}
                      <div className="mt-1 flex items-center justify-end gap-2">
                        <span className="text-[10px] text-slate-400">Ghi khi bấm Lưu của form</span>
                        <button type="button" onClick={() => setEditing(null)}
                          className="h-7 rounded border border-sky-600 bg-sky-600 px-2.5 text-[11px] font-medium text-white hover:bg-sky-700">
                          ✓ Xong{live ? ` (${nf(live)} dòng xe)` : ''}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </FragmentRow>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
/** Hai <tr> cho một dòng (dòng + bảng tick mở rộng) — Fragment có key */
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</> }
