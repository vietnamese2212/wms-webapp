// TEM / LÔ ĐÃ CẤP của MỘT nguyên liệu — dòng MỞ RỘNG của bàn mẻ (user 18/11: "tôi ko thấy việc expand sau khi quét xong tương tự
// bên xuất"). CÙNG khuôn bảng "pallet đã quét" của Xuất kho (OutboundDetail): Mã · Lượng · %Date · Date · Date cũ nhất — mã ĐỎ và
// "⚠ Date cũ nhất" khi lấy khác thứ tự luân chuyển. %Date và HSD là LÚC CẤP (server tính ở GET mẻ, cùng hàm của "Lấy ở đâu");
// "Date cũ nhất" là ngày của hàng nên lấy trước lúc cấp (vết đã lưu trên dòng cấp). Ở đây CHỈ vẽ.
// 18/11 (user: "khi mở ra thì nhìn rõ được các tem pallet được quét thuộc mã nào — tương tự như phần xuất, hiện tại hơi rối mắt"):
// điện thoại cũng là BẢNG nhỏ như "Mã pallet" của Xuất kho — nhãn cột in một lần, mỗi tem MỘT dòng (mã · lượng · %Date · HSD); khung
// thụt vào dưới dòng nguyên liệu có vạch trái (trang mẻ tô nền dòng nguyên liệu đang mở) — thay danh sách hai dòng / tem cũ.
import { Fragment } from 'react'
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
      {/* ĐIỆN THOẠI: bảng nhỏ — một lưới chung cho nhãn + mọi dòng để cột thẳng hàng; lấy khác thứ tự ⇒ dòng "⚠ nên lấy trước" ngay dưới */}
      <div className="sm:hidden grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-2 items-baseline text-[11px]">
        <span className="pb-0.5 text-[9px] text-slate-400">Tem / lô</span>
        <span className="pb-0.5 text-[9px] text-slate-400 text-right">Lượng{uHead}</span>
        <span className="pb-0.5 text-[9px] text-slate-400">%Date</span>
        <span className="pb-0.5 text-[9px] text-slate-400">HSD</span>
        {rows.map(c => (
          <Fragment key={c.id}>
            <span data-consumption={c.id} data-violation={c.rotation_violation ? '1' : undefined} className="py-0.5 border-t border-slate-100 min-w-0 text-[10px]">{code(c)}</span>
            <span className="py-0.5 border-t border-slate-100 text-right font-semibold tabular-nums">{qtyNum(Number(c.qty), mat)}</span>
            <span className={`py-0.5 border-t border-slate-100 font-bold tabular-nums ${pctDateCls(c.pct_date, bands)}`}>{pctText(c.pct_date)}</span>
            <span className="py-0.5 border-t border-slate-100 font-mono text-[10px]">{hsd(c)}</span>
            {c.rotation_violation && <span className="col-span-4 -mt-0.5 pb-0.5 text-[10px] text-orange-600">nên lấy trước {best(c)}</span>}
          </Fragment>
        ))}
      </div>
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
