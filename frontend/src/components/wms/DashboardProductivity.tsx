// Tab NĂNG SUẤT của Dashboard (user chốt 27/08) — tấn/công lao động, giờ tăng ca, tỷ lệ tăng ca.
//
// Vì sao là component riêng chỉ mount khi bấm tab: cụm này chạy theo KHOẢNG NGÀY người dùng tự
// chọn, khác hẳn phần còn lại của trang chủ (ảnh chụp HÔM NAY, dùng chung một dòng cache). Không
// mount thì không có request nào — ai không xem tab này không phải trả giá.
//
// TẤN = chứng từ, cộng CẢ nhập lẫn xuất (bốc hàng nhập cũng là công). CÔNG = module Chấm công.
// Mọi tỷ số lấy từ `utils/productivity.ts` (một nguồn), thiếu mẫu số thì hiện "—" chứ không hiện 0.
import { useMemo } from 'react'
import { Gauge, Scale, Users, Clock3, TrendingUp, AlertTriangle, Wallet } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useProductivity, type ProductivityRow } from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { tonsPerWorkDay, tonsPerWorkHour, otRate, costPerTon, fmtNum, fmtPct } from '@/utils/productivity'

// "Hôm nay" phải là HÀM (màn kho mở qua đêm sẽ giữ ngày hôm qua — ratchet today_frozen_at_import)
const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const MONTH_START = () => `${TODAY().slice(0, 7)}-01`
/** Đầu tháng lùi `back` tháng so với tháng hiện tại (0 = tháng này). */
function monthStart(back: number): string {
  const [y, m] = TODAY().split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - back, 1))
  return d.toISOString().slice(0, 10)
}
/** Ngày cuối của tháng chứa `ymd`. */
function monthEnd(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const sk = 'bg-slate-200 dark:bg-slate-700/50'

function Tile({ icon: Icon, tone, label, value, sub, danger }: {
  icon: typeof Gauge; tone: string; label: string; value: string; sub?: string; danger?: boolean
}) {
  return (
    <div className="rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1">
        <Icon className={`h-3 w-3 ${tone}`} /> {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums leading-tight ${danger ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-slate-500">{sub}</div>}
    </div>
  )
}

export function DashboardProductivity({ warehouseId }: { warehouseId: string }) {
  const prodFrom = useWmsFilterStore(s => s.dashboard.prodFrom)
  const prodTo = useWmsFilterStore(s => s.dashboard.prodTo)
  const setDashboard = useWmsFilterStore(s => s.setDashboard)
  // Chưa chọn gì = THÁNG NÀY (không lưu sẵn ngày cứng để app mở sang tháng mới không hiện tháng cũ)
  const from = prodFrom || MONTH_START()
  const to = prodTo || TODAY()

  const { data, isLoading, isError, error } = useProductivity({ warehouseId, from, to }, true)

  const RANGES = [
    { key: 'this', label: 'Tháng này', from: monthStart(0), to: TODAY() },
    { key: 'prev', label: 'Tháng trước', from: monthStart(1), to: monthEnd(monthStart(1)) },
    { key: '3m', label: '3 tháng', from: monthStart(2), to: TODAY() },
    { key: '12m', label: '12 tháng', from: monthStart(11), to: TODAY() },
  ]

  const t = data?.totals
  const rows = data?.rows ?? []
  const trend = data?.by_month ?? []
  const maxTrend = useMemo(() => Math.max(1, ...trend.map(m => m.tons)), [trend])

  // Cảnh báo dữ liệu — số liệu THIẾU phải nói ra, đừng để người đọc tưởng năng suất kém
  const noLabor = !!t && t.work_days === 0
  const someNoLabor = !!t && t.warehouses_no_labor > 0 && !noLabor
  const noWeight = t?.lines_no_weight ?? 0

  return (
    <div className="space-y-3">
      {/* Khoảng ngày — chip nhanh + 2 ô ngày */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-2.5 py-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-0.5">Khoảng ngày</span>
        {RANGES.map(r => {
          const active = from === r.from && to === r.to
          return (
            <button key={r.key} type="button"
              onClick={() => setDashboard({ prodFrom: r.from, prodTo: r.to })}
              className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${active
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
              {r.label}
            </button>
          )
        })}
        <span className="flex-1 min-w-2" />
        <input type="date" value={from} max={to}
          onChange={e => setDashboard({ prodFrom: e.target.value, prodTo: to })}
          className="h-7 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-200" />
        <span className="text-[11px] text-slate-400">→</span>
        <input type="date" value={to} min={from}
          onChange={e => setDashboard({ prodFrom: from, prodTo: e.target.value })}
          className="h-7 px-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-200" />
      </div>

      {isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
          Không tải được số liệu năng suất
          {(() => {
            const m = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
            return m ? ` — ${m}` : ' — thử lại hoặc thu hẹp khoảng ngày.'
          })()}
        </div>
      )}

      {/* Ô chỉ số */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className={`h-[72px] rounded-lg ${sk}`} />)
          : (
            <>
              <Tile icon={Scale} tone="text-sky-600 dark:text-sky-400" label="Sản lượng (tấn)"
                value={fmtNum(t?.tons, 1)}
                sub={`nhập ${fmtNum(t?.tons_in, 0)} + xuất ${fmtNum(t?.tons_out, 0)}`} />
              <Tile icon={Gauge} tone="text-indigo-500" label="Tấn / công"
                value={fmtNum(t ? tonsPerWorkDay(t) : null, 2)}
                sub={`1 công = ${fmtNum(data?.std_hours, 1)} giờ chuẩn`} />
              <Tile icon={Gauge} tone="text-violet-500" label="Tấn / giờ công"
                value={fmtNum(t ? tonsPerWorkHour(t) : null, 3)}
                sub="mẫu số có cả giờ tăng ca" />
              <Tile icon={Users} tone="text-emerald-500" label="Số công lao động"
                value={fmtNum(t?.work_days, 0)}
                sub={`${fmtNum(t?.headcount, 0)} người · ${fmtNum(t?.work_hours, 0)} giờ`} />
              <Tile icon={Clock3} tone="text-amber-500" label="Giờ tăng ca"
                value={fmtNum(t?.ot_hours, 1)}
                sub={`nghỉ phép ${fmtNum(t?.leave_days, 0)} công`} />
              <Tile icon={TrendingUp} tone="text-amber-500" label="Tỷ lệ tăng ca"
                value={fmtPct(t ? otRate(t) : null, 1)} danger={!!t && (otRate(t) ?? 0) > 0.15}
                sub="giờ OT / tổng giờ công" />
            </>
          )}
      </div>

      {/* Ô TIỀN — chỉ hiện khi có quyền warehouse_cost.view (BE đã cắt khoá tiền khỏi payload) */}
      {!isLoading && !data?.cost_hidden && t && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Tile icon={Wallet} tone="text-rose-500" label="Chi phí kho (kỳ)"
            value={fmtNum(t.cost, 0)}
            sub={data?.cost_shared ? `gồm ${fmtNum(data.cost_shared, 0)} chi phí chung` : 'đồng'} />
          <Tile icon={Wallet} tone="text-rose-500" label="Chi phí / tấn"
            value={fmtNum(costPerTon(t.cost ?? 0, t.tons), 0)}
            sub={data?.cost_shared ? 'đồng / tấn · gồm chi phí chung' : 'đồng / tấn'} />
          <Tile icon={Wallet} tone="text-emerald-600" label="Chi phí nhân công / tấn"
            value={fmtNum(costPerTon(t.cost_labor ?? 0, t.tons), 0)} sub="đồng / tấn" />
          <Tile icon={Wallet} tone="text-slate-500" label="Chi phí / công"
            value={fmtNum(t.work_days > 0 ? (t.cost ?? 0) / t.work_days : null, 0)} sub="đồng / ngày công" />
        </div>
      )}

      {/* Nói thẳng chỗ dữ liệu còn thiếu — không để người đọc tưởng năng suất kém */}
      {!isLoading && (noLabor || someNoLabor || noWeight > 0 || data?.categories_filtered
        || (!data?.cost_hidden && ((t?.warehouses_no_cost ?? 0) > 0 || data?.cost_prorated))) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
          {noLabor && (
            <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span><b>Kỳ này chưa có dữ liệu chấm công</b> — mọi chỉ số theo công đang để trống. Ghi công hằng ngày ở màn Chấm công thì các ô "tấn/công", "giờ tăng ca" mới có số.</span></div>
          )}
          {someNoLabor && (
            <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span><b>{t!.warehouses_no_labor} kho có phát sinh hàng nhưng chưa chấm công</b> — tấn/công của các kho đó để trống, tổng toàn công ty vì thế cao hơn thực tế.</span></div>
          )}
          {noWeight > 0 && (
            <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span><b>{fmtNum(noWeight, 0)} dòng hàng chưa khai khối lượng thùng</b> — phần này KHÔNG được tính vào tấn. Khai ở Mã hàng → KL/thùng để số tấn đủ.</span></div>
          )}
          {!data?.cost_hidden && (t?.warehouses_no_cost ?? 0) > 0 && (
            <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span><b>{t!.warehouses_no_cost} kho có phát sinh hàng nhưng chưa khai chi phí</b> — chi phí/tấn đang thấp hơn thực tế. Khai ở <b>Tổng quan → Chi phí kho</b>.</span></div>
          )}
          {!data?.cost_hidden && data?.cost_prorated && (
            <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>Khoảng ngày không tròn tháng: chi phí đang là số <b>PHÂN BỔ THEO NGÀY</b> (kế toán chốt theo tháng). Chọn trọn tháng để xem số chi phí thật.</span></div>
          )}
          {data?.categories_filtered && (
            <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>Bạn chỉ được xem một phần <b>Loại hàng</b>: số tấn đã bị cắt theo quyền, còn số công thì không tách được theo loại hàng ⇒ tấn/công thấp hơn thực tế.</span></div>
          )}
        </div>
      )}

      {/* Xu hướng theo tháng — chỉ có nghĩa khi khoảng ngày trải nhiều tháng */}
      {!isLoading && trend.length > 1 && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700">
            <span className="w-1 h-3.5 rounded bg-sky-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">Xu hướng theo tháng</span>
            <span className="text-[9px] text-slate-500">tấn · tấn/công</span>
          </div>
          <div className="p-3 overflow-x-auto">
            <div className="flex items-end gap-2 min-w-max h-32">
              {trend.map(m => {
                const perDay = tonsPerWorkDay({ tons: m.tons, work_days: m.work_days, work_hours: m.work_hours, ot_hours: m.ot_hours })
                return (
                  <div key={m.month} className="flex flex-col items-center justify-end gap-1 w-14">
                    <span className="text-[9px] tabular-nums text-slate-500">{fmtNum(m.tons, 0)}</span>
                    <div className="w-8 rounded-t bg-sky-500/80" style={{ height: `${Math.max(3, (m.tons / maxTrend) * 88)}px` }}
                      title={`${m.month}: ${fmtNum(m.tons, 1)} tấn · ${fmtNum(m.work_days, 0)} công · ${fmtNum(perDay, 2)} tấn/công`} />
                    <span className="text-[9px] text-slate-600 dark:text-slate-300">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
                    <span className="text-[9px] tabular-nums text-indigo-500">{fmtNum(perDay, 2)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bảng theo kho */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700">
          <span className="w-1 h-3.5 rounded bg-sky-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">Năng suất theo kho</span>
          <span className="text-[9px] text-slate-500">
            {fmtNum(rows.length, 0)} kho{!data?.cost_hidden && (data?.cost_shared ?? 0) > 0 ? ' · cột Chi phí là tiền RIÊNG của kho (chưa gánh chi phí chung)' : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800">
                {['Kho', 'Tấn nhập', 'Tấn xuất', 'Tổng tấn', 'Chuyến', 'Công', 'Giờ công', 'Tấn/công', 'Tấn/giờ', 'Giờ OT', '% OT', 'Người',
                  ...(data?.cost_hidden ? [] : ['Chi phí', 'Chi phí/tấn'])]
                  .map((h, i) => (
                    <th key={h} className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${i === 0 ? 'sticky left-0 z-10 bg-slate-50 dark:bg-slate-800' : 'text-right'}`}>{h}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={14} className="px-2 py-1"><Skeleton className={`h-5 rounded ${sk}`} /></td></tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={14} className="px-2 py-4 text-center text-[11px] text-slate-400">Không có kho nào trong phạm vi.</td></tr>
              )}
              {!isLoading && rows.map((r: ProductivityRow) => {
                const rate = otRate(r)
                return (
                  <tr key={r.warehouse_id} className="border-t border-slate-100 dark:border-slate-700/60">
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-slate-800/60 font-medium text-slate-700 dark:text-slate-200">{r.warehouse_name}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.tons_in, 1)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.tons_out, 1)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{fmtNum(r.tons, 1)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.trips, 0)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.work_days, 0)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.work_hours, 0)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold text-indigo-600 dark:text-indigo-400">{fmtNum(tonsPerWorkDay(r), 2)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-violet-600 dark:text-violet-400">{fmtNum(tonsPerWorkHour(r), 3)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.ot_hours, 1)}</td>
                    <td className={`px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-medium ${rate != null && rate > 0.15 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>{fmtPct(rate, 1)}</td>
                    <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.headcount, 0)}</td>
                    {!data?.cost_hidden && <>
                      <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtNum(r.cost, 0)}</td>
                      <td className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold text-rose-600 dark:text-rose-400">{fmtNum(costPerTon(r.cost ?? 0, r.tons), 0)}</td>
                    </>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
