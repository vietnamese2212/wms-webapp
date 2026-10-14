// DẢI CHỈ SỐ SỐNG của kế hoạch điều vận (user chốt 25/09: "quá trình chỉnh sửa kế hoạch thì các chỉ số cần phải hiện
// lên — tỷ lệ các vận tải, số tiền, số chuyến, số chuyến các loại xe"). Đọc thẳng `plan.summary` mà server tính lại sau
// MỖI lần thả OD / đổi xe / đổi ĐVVT, nên ba tab của trang Điều vận cùng một con số.
// Ô số = SummaryBand (Chuyến · OD · Pallet · Tải TB · Σ cước · cước/pallet · Non tải · Vượt tải · Khung chờ), mỗi ô có Δ so
// với lúc MÁY lập để người sửa biết mình làm tốt hơn hay tệ hơn đề xuất.
// 14/10 (user, ảnh bàn 1580 px: "phần trên còn dư rất nhiều chỗ — để Dải chỉ số hiện lên, không ẩn nữa"): dải LUÔN hiện, đứng cạnh cụm
// Xác nhận ở hàng hai của đầu trang (bỏ nút "Chỉ số" bật / tắt và bản gọn 4 con số).
// 14/10 tối (user, màn 24": "hiển thị khác — phải đồng bộ với các loại màn hình"; "tỷ trọng ĐVVT thì bấm vào để xem (dạng detail),
// cuộn như thế này không hợp lý"): các ô CHIA ĐỀU bề rộng hàng — màn nào cũng thấy đủ mọi ô, màn rộng thì ô rộng; tỷ trọng ĐVVT + số
// xe theo dòng xe (kho thật ~27 dòng xe) không còn trải ngang phải cuộn — gom vào MỘT ô cuối "ĐVVT · Dòng xe", bấm mở bảng chi tiết.
import { ChevronDown } from 'lucide-react'
import { useEdgeFade } from '@/hooks/useEdgeFade'
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu'
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

export function DispatchKpiBar({ plan, className }: { plan: DispatchPlan; className?: string }) {
  const s = plan.summary
  const b = s.baseline ?? null
  const tiles: BandTile[] = [
    { label: 'Chuyến', value: <>{nf(s.trips)}{delta(s.trips, b?.trips, n => nf(n))}</>, tip: b ? `Máy lập ${nf(b.trips)} chuyến` : undefined },
    { label: 'OD trên xe', value: nf(s.ods), tip: `${nf(s.pool_ods ?? 0)} OD còn ở khung chờ · ${nf(plan.unplanned.length)} OD không lên xe` },
    { label: 'Pallet', value: nf(s.pallets, 1) },
    { label: 'Tấn', value: nf(s.tons, 1), tip: 'Tổng tải trọng hàng trên các xe (tấn) — xe xá đo % tải theo tấn' },
    { label: 'Tải TB', value: s.avg_load_pct == null ? '—' : `${nf(s.avg_load_pct, 1)}%`, tip: 'Trung bình % tải các xe có dòng xe' },
    { label: 'Σ cước', value: <>{money(s.freight_total)}{delta(s.freight_total, b?.freight_total, n => money(n))}</>, tip: `${nf(s.freight_total)} ₫${s.unpriced ? ` · ${s.unpriced} xe chưa có cước (không cộng vào)` : ''}${b ? ` · máy lập ${nf(b.freight_total)} ₫` : ''}` },
    { label: 'Cước/pallet', value: s.freight_per_pallet == null ? '—' : money(s.freight_per_pallet), tip: 'Σ cước ÷ pallet của các xe CÓ cước' },
    { label: 'Non tải', value: <>{nf(s.underload)}{delta(s.underload, b?.underload, n => nf(n))}</>, accent: s.underload > 0 },
    { label: 'Vượt tải', value: nf(s.overload ?? 0), danger: (s.overload ?? 0) > 0, tip: 'Xe vượt sức chứa dòng xe — vẫn xác nhận được, nhưng phải chắc xe chở nổi' },
    { label: 'Khung chờ', value: `${nf(s.pool_ods ?? 0)} OD`, accent: (s.pool_ods ?? 0) > 0, tip: `${nf(s.pool_pallets ?? 0, 1)} pallet chưa lên xe nào — OD ở khung chờ KHÔNG đi khi Xác nhận` },
    ...(plan.status !== 'DRAFT' ? [
      { label: 'Chờ ĐVVT', value: nf(s.tendered ?? 0), accent: (s.tendered ?? 0) > 0, tip: 'Xe đã chào, ĐVVT chưa trả lời — ghi "ĐVVT nhận / từ chối" trong panel xe' },
      { label: 'ĐVVT từ chối', value: nf(s.declined ?? 0), accent: (s.declined ?? 0) > 0, tip: 'Đổi ĐVVT trong panel xe rồi "Chốt xe này"' },
      { label: 'Đã vào KH xuất', value: nf(s.confirmed ?? 0) },
    ] : []),
  ]
  const byModel = s.by_model ?? []
  const shares = s.shares ?? []
  const under = shares.filter(sh => sh.target_pct != null && (sh.pct ?? 0) < sh.target_pct).length

  // Khung ô số chỉ cuộn khi con số của mọi ô cộng lại vẫn rộng hơn hàng (điện thoại; máy tính hẹp mà hàng còn ô chọn kế hoạch) —
  // mép còn nội dung khuất MỜ DẦN, lăn chuột dọc = cuộn ngang (`useEdgeFade`)
  const fade = useEdgeFade(s)

  return (
    <div aria-label="Chỉ số kế hoạch" className={`flex items-stretch min-w-0 ${className ?? ''}`}>
      <div ref={fade.ref} style={fade.style} onWheel={fade.onWheel} className="flex-1 min-w-0 overflow-x-auto no-scrollbar rounded-l-md">
        <SummaryBand tiles={tiles} inline className="min-w-full w-max rounded-r-none" />
      </div>
      {(shares.length > 0 || byModel.length > 0) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="Tỷ trọng từng ĐVVT so với mục tiêu tháng + số xe theo từng dòng xe — bấm để xem"
              className="shrink-0 rounded-r-md border-l border-white/15 bg-sky-800 px-2 py-0.5 text-center text-white hover:bg-sky-700 data-[state=open]:bg-sky-700 flex flex-col justify-between">
              <span className="text-[9px] font-medium uppercase tracking-wider text-sky-200/90 leading-tight whitespace-nowrap inline-flex items-center justify-center gap-0.5">
                ĐVVT · Dòng xe <ChevronDown className="h-3 w-3" />
              </span>
              <span className={`text-xs font-semibold leading-tight tabular-nums whitespace-nowrap ${under ? 'text-amber-300' : ''}`}>
                {under ? `${under} dưới MT` : `${shares.length} ĐVVT`} · {byModel.length} dòng
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[min(92vw,440px)] max-h-[70vh] overflow-y-auto p-3 space-y-3 text-[11px] text-slate-700">
            {shares.length > 0 && (
              <section>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tỷ trọng ĐVVT trong tháng</div>
                <table className="w-full">
                  <tbody>
                    {shares.map(sh => {
                      const pct = sh.pct ?? 0
                      const low = sh.target_pct != null && pct < sh.target_pct
                      const over = sh.target_pct != null && pct > sh.target_pct + 5
                      return (
                        <tr key={sh.transport_company_id} className="border-b border-slate-100 last:border-0">
                          <td className="py-1 pr-2 whitespace-nowrap"><b className="font-mono">{sh.code}</b> <span className="text-slate-500 truncate">{sh.name}</span></td>
                          <td className="py-1 pr-2 w-24">
                            <span className="relative block h-2 w-24 rounded-full bg-slate-200 overflow-hidden">
                              <span className={`absolute inset-y-0 left-0 ${low ? 'bg-amber-500' : over ? 'bg-sky-700' : 'bg-green-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                              {sh.target_pct != null && <span className="absolute inset-y-0 w-0.5 bg-slate-800" style={{ left: `${Math.min(100, sh.target_pct)}%` }} />}
                            </span>
                          </td>
                          <td className={`py-1 text-right whitespace-nowrap tabular-nums ${low ? 'text-amber-700 font-semibold' : ''}`}>
                            {sh.pct == null ? '—' : `${nf(sh.pct, 1)}%`}<span className="text-slate-400"> / {sh.target_pct == null ? 'chưa khai' : `MT ${sh.target_pct}%`}</span>
                          </td>
                          <td className="py-1 pl-2 text-right whitespace-nowrap tabular-nums text-slate-500" title={`theo ${sh.basis === 'TRIPS' ? 'số chuyến' : sh.basis === 'PALLETS' ? 'pallet' : 'tấn'} — kể cả chuyến đã chạy trong tháng + kế hoạch này`}>
                            {nf(sh.trips)} xe · {nf(sh.pallets, 1)} pl
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            )}
            {byModel.length > 0 && (
              <section>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Số xe theo dòng xe (kế hoạch này)</div>
                <table className="w-full">
                  <tbody>
                    {byModel.map(m => (
                      <tr key={m.key} className={`border-b border-slate-100 last:border-0 ${m.key === '—' ? 'text-red-700' : ''}`}>
                        <td className="py-1 pr-2" title={`${m.sap_code ?? ''} ${m.name}${m.parent ? ` · cha ${m.parent}` : ''}`}>{m.name}{m.parent && <span className="text-slate-400"> · {m.parent}</span>}</td>
                        <td className="py-1 pr-2 text-right whitespace-nowrap tabular-nums font-semibold">{m.trips} xe</td>
                        <td className="py-1 text-right whitespace-nowrap tabular-nums text-slate-500">{nf(m.pallets, 1)} pl</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
