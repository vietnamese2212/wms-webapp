// TOÀN CẢNH MẺ (27/11 — user: "thêm 1 nút mở rộng, ở nơi đó chỉ xem được thông số cơ bản của mẻ, còn lại là Mã và số lượng đã cấp.
// Mục đích để user có cái nhìn toàn cảnh nhất — so sánh được với phiếu chế biến cầm trên tay"). Chỉ đọc: thông số mẻ ở đầu, rồi MỖI MÃ
// MỘT DÒNG: mã · tên · đã cấp (+ dòng gợi ý bao với mã cân / đong) — chữ to hơn bàn làm việc, không nút, không cột phụ.
import type { ReactNode } from 'react'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { MesQty } from './MesQty'
import { matUnitCode, unitCode } from '@/utils/unitCode'
import { qtyTotalsByUnit, qtyTotalsText } from '@/utils/qtyUnits'
import { formatDate } from '@/utils/formatters'
import { nfQty } from './TankSheets'
import type { BatchDetail, BoardRow } from '@/api/productionHooks'

export function BatchOverviewSheet({ open, onClose, b, rows }: { open: boolean; onClose: () => void; b: BatchDetail; rows: BoardRow[] }) {
  const u = unitCode(b.material?.base_unit)
  const nn = !!b.no_norm
  const shown = rows.filter(r => !r.removed)
  const issued = shown.filter(r => Number(r.consumed) > 0)
  const total = qtyTotalsText(qtyTotalsByUnit(issued.map(r => ({ qty: Number(r.consumed), mat: r }))))
  const no4 = b.batch_no ? String(b.batch_no).padStart(4, '0') : '—'
  const facts: [string, ReactNode][] = [
    ['Bán thành phẩm', <><span className="font-mono font-semibold">{b.material?.material_code}</span> {b.material?.short_name ?? ''}</>],
    ...(b.recipe ? [['Công thức', b.recipe.name] as [string, ReactNode]] : []),
    ['Ngày SX', formatDate(b.prod_date)],
    ['Chu kỳ · Mẻ', <span className="font-mono font-semibold">{b.cycle ?? '—'} · {no4}</span>],
    ['Bồn', <span className="font-mono font-semibold">{b.tank?.code ?? '—'}</span>],
    ...((b.machine_code || b.shift) ? [['Máy · Ca', [b.machine_code, b.shift].filter(Boolean).join(' · ')] as [string, ReactNode]] : []),
    [`${nn ? 'Lượng mẻ' : 'Kế hoạch'} (${u})`, b.planned_qty != null ? <span className="font-semibold tabular-nums">{nfQty(b.planned_qty)}</span> : '—'],
  ]
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-2xl" title={`Toàn cảnh mẻ ${b.batch_code}`}
      description="Toàn cảnh mẻ — đối chiếu với phiếu chế biến giấy"
      footer={<Button variant="outline" size="sm" className="h-9 sm:h-8" onClick={onClose}>Đóng</Button>}>
      <div className="space-y-3" data-testid="batch-overview">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10px] text-slate-400 leading-tight">{k}</dt>
              <dd className="text-slate-800 leading-snug break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {!shown.length && <p className="text-xs text-slate-400">Mẻ chưa có nguyên liệu nào.</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] text-slate-500">
              <th className="py-1.5 pr-2 text-left font-medium">Mã</th>
              <th className="py-1.5 pr-2 text-left font-medium">Tên</th>
              <th className="py-1.5 pr-1 text-right font-medium">Đã cấp</th>
              <th className="py-1.5 pl-1 text-left font-medium w-10">ĐVT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map(r => {
              const c = Number(r.consumed)
              return (
                <tr key={r.material_id} data-overview-row={r.material_code}>
                  <td className="py-1.5 pr-2 align-top font-mono font-semibold whitespace-nowrap">{r.material_code}</td>
                  <td className="py-1.5 pr-2 align-top text-slate-700 break-words">{r.material_name ?? ''}</td>
                  <td className={`py-1.5 pr-1 align-top text-right tabular-nums font-semibold whitespace-nowrap ${c > 0 ? 'text-slate-900' : 'text-slate-300'}`}>
                    {c > 0 ? <MesQty qty={c} mat={r} /> : '—'}
                  </td>
                  <td className="py-1.5 pl-1 align-top font-mono text-[11px] text-slate-500 whitespace-nowrap">{matUnitCode(r)}</td>
                </tr>
              )
            })}
          </tbody>
          {issued.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <td colSpan={2} className="py-1.5 pr-2 text-xs text-slate-500">Tổng đã cấp · {issued.length}/{shown.length} mã</td>
                <td colSpan={2} className="py-1.5 text-right tabular-nums font-semibold" data-testid="overview-total">{total}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </FormSheet>
  )
}
