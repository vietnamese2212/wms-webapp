// TEM / LÔ ĐÃ CẤP của MỘT nguyên liệu — dòng MỞ RỘNG của bàn mẻ (user 18/11: "tôi ko thấy việc expand sau khi quét xong tương tự
// bên xuất"). CÙNG khuôn bảng "pallet đã quét" của Xuất kho (OutboundDetail): Mã · Lượng · %Date · Date · Date cũ nhất — mã ĐỎ và
// "⚠ Date cũ nhất" khi lấy khác thứ tự luân chuyển. %Date và HSD là LÚC CẤP (server tính ở GET mẻ, cùng hàm của "Lấy ở đâu");
// "Date cũ nhất" là ngày của hàng nên lấy trước lúc cấp (vết đã lưu trên dòng cấp). Ở đây CHỈ vẽ.
import { AlertTriangle } from 'lucide-react'
import type { ConsumptionRow } from '@/api/productionHooks'
import { formatDate } from '@/utils/formatters'
import { pctDateCls, type PctBands } from '@/utils/pctDateBands'
import { qtyNum, matUnitCode } from '@/utils/unitCode'
import { hasEntry, type MatUnits } from '@/utils/qtyUnits'
import { rotationReasonLabel } from '@/utils/rotation'

const pctText = (p: number | null | undefined) => (p == null ? '—' : `${Math.floor(p)}%`)
/** dd-mm-yyyy; điện thoại dd-mm-yy */
function Day({ d }: { d: string | null | undefined }) {
  if (!d) return <span className="text-slate-300">—</span>
  return <><span className="sm:hidden">{`${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(2, 4)}`}</span><span className="hidden sm:inline">{formatDate(d)}</span></>
}
const lotKey = (c: ConsumptionRow) => `${c.production_date ?? ''}|${c.batch_lot ?? ''}`

/** "3 tem" · "1 lô" · "2 tem · 1 lô" — đếm TEM / LÔ khác nhau (một tem cấp hai lần vẫn là một tem) */
export function consumedNoun(rows: ConsumptionRow[]): string {
  const tems = new Set(rows.filter(c => c.source === 'SCAN').map(c => c.pallet_code)).size
  const lots = new Set(rows.filter(c => c.source !== 'SCAN').map(lotKey)).size
  return [tems ? `${tems} tem` : '', lots ? `${lots} lô` : ''].filter(Boolean).join(' · ')
}

function rotTip(c: ConsumptionRow): string | undefined {
  if (!c.rotation_best_date) return undefined
  const head = c.rotation_violation
    ? `Lấy khác thứ tự ${c.rotation_principle ?? ''}: còn hàng ${formatDate(c.rotation_best_date)} phải dùng trước`
    : `Đúng thứ tự ${c.rotation_principle ?? ''} — hàng nên lấy trước lúc cấp: ${formatDate(c.rotation_best_date)}`
  return c.rotation_override_reason ? `${head} · lý do: ${rotationReasonLabel(c.rotation_override_reason)}` : head
}

export function ConsumedTems({ rows, mat, bands }: { rows: ConsumptionRow[]; mat: MatUnits | null; bands: PctBands }) {
  const uHead = mat && !hasEntry(mat) && mat.base_unit ? ` (${matUnitCode(mat)})` : ''
  const code = (c: ConsumptionRow) => c.source === 'SCAN'
    ? <span className={`font-mono font-semibold break-all ${c.rotation_violation ? 'text-red-600' : 'text-slate-600'}`}>{c.pallet_code}</span>
    : <span className={`font-semibold ${c.rotation_violation ? 'text-red-600' : 'text-slate-600'}`}>lô <span className="font-mono">{c.batch_lot ?? '—'}</span></span>
  const hsd = (c: ConsumptionRow) => (
    <span className={c.expiry_approval_id ? 'text-red-600 font-semibold' : 'text-slate-500'} title={c.expiry_approval_id ? 'Quá HSD — QA đã duyệt cho dùng vào mẻ này' : undefined}>
      <Day d={c.expiry_date} />{c.expiry_approval_id && <span className="ml-1 text-[9px] font-normal">QA duyệt</span>}
    </span>
  )
  const best = (c: ConsumptionRow) => c.rotation_best_date
    ? <span className={`font-mono ${c.rotation_violation ? 'text-orange-600 font-semibold' : 'text-slate-300'}`} title={rotTip(c)}>
        {c.rotation_violation && <AlertTriangle className="inline h-3 w-3 -mt-0.5 mr-0.5" />}<Day d={c.rotation_best_date} />
      </span>
    : <span className="text-slate-300">—</span>
  return (
    <div data-testid="consumed-tems">
      {/* ĐIỆN THOẠI: mỗi tem hai dòng — mã + lượng · %Date + HSD (+ ⚠ hàng nên lấy trước) */}
      <ul className="sm:hidden divide-y divide-slate-100 rounded-md border border-slate-200 bg-slate-50/60">
        {rows.map(c => (
          <li key={c.id} data-consumption={c.id} data-violation={c.rotation_violation ? '1' : undefined} className="px-2 py-1 text-[11px]">
            <div className="flex items-start gap-2"><span className="min-w-0 flex-1">{code(c)}</span>
              <span className="shrink-0 font-semibold tabular-nums">{qtyNum(Number(c.qty), mat)}</span></div>
            <div className="flex flex-wrap gap-x-2 text-[10px] text-slate-500">
              <span>%Date <b className={`tabular-nums ${pctDateCls(c.pct_date, bands)}`}>{pctText(c.pct_date)}</b></span>
              <span>HSD {hsd(c)}</span>
              {c.rotation_violation && <span>nên lấy trước {best(c)}</span>}
            </div>
          </li>
        ))}
      </ul>
      {/* MÁY TÍNH: bảng nhỏ như "pallet đã quét" của Xuất kho */}
      <table className="hidden sm:table border-collapse">
        <thead><tr className="text-[9px] text-slate-400">
          <th className="text-left font-medium pb-0.5 pr-4">Tem / lô</th>
          <th className="text-right font-medium pb-0.5 pr-4">Lượng{uHead}</th>
          <th className="text-left font-medium pb-0.5 pr-4">%Date</th>
          <th className="text-left font-medium pb-0.5 pr-4">NSX</th>
          <th className="text-left font-medium pb-0.5 pr-4">HSD</th>
          <th className="text-left font-medium pb-0.5" title="Ngày của hàng nên lấy trước lúc cấp (theo nguyên tắc luân chuyển của kho) — ⚠ khi tem / lô vừa cấp lấy khác thứ tự">Date cũ nhất</th>
        </tr></thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.id} data-consumption={c.id} data-violation={c.rotation_violation ? '1' : undefined} className="text-[10px]">
              <td className="pr-4 py-0.5 whitespace-nowrap">{code(c)}</td>
              <td className="pr-4 py-0.5 text-right tabular-nums text-slate-600 whitespace-nowrap">{qtyNum(Number(c.qty), mat)}</td>
              <td className={`pr-4 py-0.5 font-bold tabular-nums whitespace-nowrap ${pctDateCls(c.pct_date, bands)}`}>{pctText(c.pct_date)}</td>
              <td className="pr-4 py-0.5 font-mono text-slate-400 whitespace-nowrap"><Day d={c.production_date} /></td>
              <td className="pr-4 py-0.5 font-mono whitespace-nowrap">{hsd(c)}</td>
              <td className="py-0.5 whitespace-nowrap">{best(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
