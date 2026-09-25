// DẢI CHỈ SỐ SỐNG của kế hoạch điều vận (user chốt 25/09: "quá trình chỉnh sửa kế hoạch thì các chỉ số cần phải hiện
// lên — tỷ lệ các vận tải, số tiền, số chuyến, số chuyến các loại xe"). Đọc thẳng `plan.summary` mà server tính lại sau
// MỖI lần thả OD / đổi xe / đổi ĐVVT, nên ba tab của trang Điều vận cùng một con số.
// Hàng 1 = SummaryBand chuẩn app (Chuyến · OD · Pallet · Tải TB · Σ cước · cước/pallet · Non tải · Vượt tải · Khung chờ),
// mỗi ô có Δ so với lúc MÁY lập để người sửa biết mình làm tốt hơn hay tệ hơn đề xuất.
// Hàng 2 = số chuyến theo dòng xe + tỷ trọng từng ĐVVT so với mục tiêu (thanh + vạch mục tiêu).
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import type { DispatchPlan } from '@/api/hooks'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const money = (n: number | null | undefined) => {
  if (n == null) return '—'
  const a = Math.abs(n)
  return a >= 1e9 ? `${nf(n / 1e9, 2)} tỷ` : a >= 1e6 ? `${nf(n / 1e6, 1)} tr` : `${nf(n)} ₫`
}
const delta = (now: number, base: number | undefined, unit: (n: number) => string, lowerIsBetter = true) => {
  if (base == null || now === base) return null
  const d = now - base
  const good = lowerIsBetter ? d < 0 : d > 0
  return <span className={`ml-1 text-[10px] font-medium ${good ? 'text-green-300' : 'text-amber-200'}`}>{d > 0 ? '+' : '−'}{unit(Math.abs(d))}</span>
}

export function DispatchKpiBar({ plan }: { plan: DispatchPlan }) {
  const s = plan.summary
  const b = s.baseline ?? null
  const tiles: BandTile[] = [
    { label: 'Chuyến', value: <>{nf(s.trips)}{delta(s.trips, b?.trips, n => nf(n))}</>, tip: b ? `Máy lập ${nf(b.trips)} chuyến` : undefined },
    { label: 'OD trên xe', value: nf(s.ods), tip: `${nf(s.pool_ods ?? 0)} OD còn ở khung chờ · ${nf(plan.unplanned.length)} OD không lên xe` },
    { label: 'Pallet', value: nf(s.pallets, 1) },
    { label: 'Tải TB', value: s.avg_load_pct == null ? '—' : `${nf(s.avg_load_pct, 1)}%`, tip: 'Trung bình % tải các xe có dòng xe' },
    { label: 'Σ cước', value: <>{money(s.freight_total)}{delta(s.freight_total, b?.freight_total, n => money(n))}</>, tip: `${nf(s.freight_total)} ₫${s.unpriced ? ` · ${s.unpriced} xe chưa có cước (không cộng vào)` : ''}${b ? ` · máy lập ${nf(b.freight_total)} ₫` : ''}` },
    { label: 'Cước / pallet', value: s.freight_per_pallet == null ? '—' : money(s.freight_per_pallet), tip: 'Σ cước ÷ pallet của các xe CÓ cước' },
    { label: 'Non tải', value: <>{nf(s.underload)}{delta(s.underload, b?.underload, n => nf(n))}</>, accent: s.underload > 0 },
    { label: 'Vượt tải', value: nf(s.overload ?? 0), danger: (s.overload ?? 0) > 0, tip: 'Xe vượt sức chứa dòng xe — vẫn xác nhận được, nhưng phải chắc xe chở nổi' },
    { label: 'Khung chờ', value: `${nf(s.pool_ods ?? 0)} OD`, accent: (s.pool_ods ?? 0) > 0, tip: `${nf(s.pool_pallets ?? 0, 1)} pallet chưa lên xe nào — OD ở khung chờ KHÔNG đi khi Xác nhận${s.late_ods ? ` · ${s.late_ods} OD tồn đọng (ngày giao trước)` : ''}` },
    ...(plan.status !== 'DRAFT' ? [
      { label: 'Chờ ĐVVT', value: nf(s.tendered ?? 0), accent: (s.tendered ?? 0) > 0, tip: 'Xe đã chào, ĐVVT chưa trả lời — ghi "ĐVVT nhận / từ chối" trong panel xe' },
      { label: 'ĐVVT từ chối', value: nf(s.declined ?? 0), accent: (s.declined ?? 0) > 0, tip: 'Đổi ĐVVT trong panel xe rồi "Chốt xe này"' },
      { label: 'Đã vào KH xuất', value: nf(s.confirmed ?? 0) },
    ] : []),
  ]
  const byModel = s.by_model ?? []
  const shares = s.shares ?? []
  return (
    <div className="shrink-0">
      <SummaryBand tiles={tiles} />
      {(byModel.length > 0 || shares.length > 0) && (
        <div className="border-b bg-sky-50/60 px-3 py-1 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-slate-600">
          {byModel.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Dòng xe</span>
              {byModel.map(m => (
                <span key={m.key} className={`inline-flex items-center gap-1 rounded bg-white border px-1.5 py-0.5 whitespace-nowrap ${m.key === '—' ? 'border-red-200 text-red-700' : 'border-slate-200'}`}
                  title={`${m.sap_code ?? ''} ${m.name}${m.parent ? ` · cha ${m.parent}` : ''} · ${nf(m.pallets, 1)} pallet`}>
                  <span className="truncate max-w-[140px]">{m.name}</span><b className="tabular-nums">×{m.trips}</b>
                </span>
              ))}
            </div>
          )}
          {shares.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Tỷ trọng ĐVVT (tháng)</span>
              {shares.map(sh => {
                const pct = sh.pct ?? 0
                const under = sh.target_pct != null && pct < sh.target_pct
                const over = sh.target_pct != null && pct > sh.target_pct + 5
                return (
                  <span key={sh.transport_company_id} className="inline-flex items-center gap-1 whitespace-nowrap"
                    title={`${sh.name}: ${sh.trips} chuyến · ${nf(sh.pallets, 1)} pallet trong tháng (kể cả chuyến đã chạy + kế hoạch này)${sh.target_pct != null ? ` · mục tiêu ${sh.target_pct}% theo ${sh.basis === 'TRIPS' ? 'số chuyến' : sh.basis === 'PALLETS' ? 'pallet' : 'tấn'}` : ' · chưa khai mục tiêu'}`}>
                    <b className="font-mono">{sh.code}</b>
                    <span className="relative inline-block h-2 w-16 rounded-full bg-slate-200 overflow-hidden">
                      <span className={`absolute inset-y-0 left-0 ${under ? 'bg-amber-500' : over ? 'bg-sky-700' : 'bg-green-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      {sh.target_pct != null && <span className="absolute inset-y-0 w-0.5 bg-slate-800" style={{ left: `${Math.min(100, sh.target_pct)}%` }} />}
                    </span>
                    <span className={`tabular-nums ${under ? 'text-amber-700 font-semibold' : ''}`}>{sh.pct == null ? '—' : `${nf(sh.pct, 1)}%`}{sh.target_pct != null && <span className="text-slate-400">/{sh.target_pct}</span>}</span>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
