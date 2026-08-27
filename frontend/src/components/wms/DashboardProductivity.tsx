// Tab NĂNG SUẤT của Dashboard (user chốt 27/08) — tấn/công lao động, giờ tăng ca, tỷ lệ tăng ca.
//
// Vì sao là component riêng chỉ mount khi bấm tab: cụm này chạy theo KHOẢNG NGÀY người dùng tự
// chọn, khác hẳn phần còn lại của trang chủ (ảnh chụp HÔM NAY, dùng chung một dòng cache). Không
// mount thì không có request nào — ai không xem tab này không phải trả giá.
//
// TẤN = chứng từ, cộng CẢ nhập lẫn xuất (bốc hàng nhập cũng là công). CÔNG = module Chấm công.
// Mọi tỷ số lấy từ `utils/productivity.ts` (một nguồn), thiếu mẫu số thì hiện "—" chứ không hiện 0.
import { useMemo, useState } from 'react'
import { Gauge, Scale, Users, Clock3, TrendingUp, AlertTriangle, Wallet } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { useProductivity, type ProductivityRow } from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatDate } from '@/utils/formatters'
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
/** Số ngày của khoảng (tính cả 2 đầu) — cho người đọc biết mẫu số đang là bao nhiêu ngày. */
function dayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`)
  return isNaN(a) || isNaN(b) ? 0 : Math.floor((b - a) / 86400000) + 1
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

// ── XEM THEO THÁNG ────────────────────────────────────────────────────────────────────────────
// Cột = tháng, chọn được CHỈ SỐ muốn nhìn. Mỗi cột kèm ▲▼ % so THÁNG LIỀN TRƯỚC — không có mũi
// tên thì người xem phải tự trừ nhẩm, mà "lên hay xuống" mới là câu hỏi thật sự của biểu đồ này.
// `goodUp=false` cho tỷ lệ tăng ca: tăng ca tăng là chuyện XẤU, không được tô xanh.
type TrendRow = { month: string; tons: number; tons_in: number; tons_out: number; trips: number; work_days: number; work_hours: number; ot_hours: number }
const METRICS: Array<{ key: string; label: string; unit: string; goodUp: boolean; d: number; pct?: boolean; of: (m: TrendRow) => number | null }> = [
  { key: 'tons', label: 'Sản lượng (tấn)', unit: 'tấn', goodUp: true, d: 0, of: m => m.tons },
  { key: 'tpd', label: 'Tấn / công', unit: 'tấn/công', goodUp: true, d: 2, of: m => tonsPerWorkDay(m) },
  { key: 'tph', label: 'Tấn / giờ công', unit: 'tấn/giờ', goodUp: true, d: 3, of: m => tonsPerWorkHour(m) },
  { key: 'days', label: 'Số công', unit: 'công', goodUp: true, d: 0, of: m => m.work_days },
  { key: 'ot', label: 'Giờ tăng ca', unit: 'giờ', goodUp: false, d: 0, of: m => m.ot_hours },
  { key: 'otr', label: 'Tỷ lệ tăng ca', unit: '', goodUp: false, d: 1, pct: true, of: m => otRate(m) },
]

function Delta({ cur, prev, goodUp }: { cur: number | null; prev: number | null; goodUp: boolean }) {
  if (cur == null || prev == null || prev === 0) return <span className="text-[9px] text-slate-300">—</span>
  const p = (cur - prev) / Math.abs(prev)
  if (Math.abs(p) < 0.005) return <span className="text-[9px] text-slate-400">≈</span>
  const up = p > 0
  const good = up === goodUp
  return (
    <span className={`text-[9px] tabular-nums font-medium ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
      {up ? '▲' : '▼'}{fmtPct(Math.abs(p), 0)}
    </span>
  )
}

function MonthlyTrend({ rows, onPick12 }: { rows: TrendRow[]; onPick12: () => void }) {
  const [metric, setMetric] = useState(METRICS[0].key)
  const M = METRICS.find(m => m.key === metric) ?? METRICS[0]
  const vals = rows.map(M.of)
  const max = Math.max(1e-9, ...vals.map(v => v ?? 0))
  const fmt = (v: number | null) => (M.pct ? fmtPct(v, M.d) : fmtNum(v, M.d))
  const last = vals[vals.length - 1], prev = vals[vals.length - 2]

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700 flex-wrap">
        <span className="w-1 h-3.5 rounded bg-sky-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">Xem theo tháng</span>
        <span className="text-[9px] text-slate-500">{rows.length} tháng · ▲▼ so tháng liền trước</span>
        <span className="flex-1" />
        <button type="button" onClick={onPick12} className="text-[10px] text-sky-600 hover:text-sky-700">12 tháng</button>
      </div>

      <div className="px-2.5 py-1.5 flex items-center gap-1 flex-wrap border-b border-slate-100 dark:border-slate-700/60">
        {METRICS.map(m => (
          <button key={m.key} type="button" onClick={() => setMetric(m.key)}
            className={`h-6 px-2 rounded text-[10px] font-medium border transition-colors ${m.key === metric
              ? 'bg-sky-600 text-white border-sky-600'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
            {m.label}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-[10px] text-slate-500">
          Tháng cuối: <b className="text-slate-700 dark:text-slate-200">{fmt(last ?? null)}</b> <Delta cur={last ?? null} prev={prev ?? null} goodUp={M.goodUp} />
        </span>
      </div>

      <div className="p-3 overflow-x-auto">
        <div className="flex items-end gap-2 min-w-max h-40">
          {rows.map((m, i) => {
            const v = vals[i]
            const h = v == null ? 0 : Math.max(3, (v / max) * 96)
            return (
              <div key={m.month} className="flex flex-col items-center justify-end gap-1 w-16">
                <Delta cur={v} prev={i > 0 ? vals[i - 1] : null} goodUp={M.goodUp} />
                <span className="text-[9px] tabular-nums text-slate-600 dark:text-slate-300">{fmt(v)}</span>
                {v == null
                  ? <div className="w-9 border-b-2 border-dashed border-slate-300 dark:border-slate-600" title="Chưa có dữ liệu chấm công tháng này" />
                  : <div className="w-9 rounded-t bg-sky-500/80 hover:bg-sky-500" style={{ height: `${h}px` }}
                      title={`${m.month}: ${fmtNum(m.tons, 1)} tấn · ${fmtNum(m.work_days, 0)} công · ${fmtNum(m.ot_hours, 1)} giờ OT`} />}
                <span className="text-[9px] text-slate-600 dark:text-slate-300">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
              </div>
            )
          })}
        </div>
        <div className="mt-1 text-[9px] text-slate-400">
          Cột đứt nét = tháng chưa có dữ liệu để tính chỉ số này (thường là chưa chấm công).
        </div>
      </div>
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

  // Kỳ dựng sẵn = CÁCH NHẬP NHANH của chính khoảng ngày (giống filter "Tháng sản xuất" bên Sổ đóng
  // gói): chọn kỳ → set from/to, giá trị chip SUY NGƯỢC từ from/to ⇒ không đẻ state thứ hai, không
  // bao giờ mâu thuẫn kiểu "chip 3 tháng nhưng khoảng ngày là 1 tuần".
  const RANGES = [
    { value: 'this', label: 'Tháng này', from: monthStart(0), to: TODAY() },
    { value: 'prev', label: 'Tháng trước', from: monthStart(1), to: monthEnd(monthStart(1)) },
    { value: '3m', label: '3 tháng gần nhất', from: monthStart(2), to: TODAY() },
    { value: '12m', label: '12 tháng gần nhất', from: monthStart(11), to: TODAY() },
  ]
  const rangeValue = RANGES.find(r => r.from === from && r.to === to)?.value ?? ''

  // Khoảng ngày luôn HỢP LỆ: sửa 1 đầu vượt qua đầu kia thì kéo đầu kia theo (thay cho min/max của
  // ô ngày cũ) — không để lọt from > to xuống API rồi báo lỗi đỏ.
  function setRange(nf: string, nt: string) {
    if (!nf && !nt) { setDashboard({ prodFrom: '', prodTo: '' }); return }   // Xóa → về mặc định tháng này
    const f2 = nf || nt, t2 = nt || nf
    setDashboard(f2 > t2
      ? (nf !== from ? { prodFrom: f2, prodTo: f2 } : { prodFrom: t2, prodTo: t2 })
      : { prodFrom: f2, prodTo: t2 })
  }

  const filterDefs: FilterDef[] = [
    { key: 'range', label: 'Khoảng ngày', type: 'daterange', pinned: true, from, to, onChange: setRange },
    { key: 'period', label: 'Kỳ', type: 'single', pinned: true, options: RANGES,
      allLabel: 'Về mặc định (tháng này)', value: rangeValue,
      onChange: v => {
        const r = RANGES.find(x => x.value === v)
        setDashboard(r ? { prodFrom: r.from, prodTo: r.to } : { prodFrom: '', prodTo: '' })
      } },
  ]

  const t = data?.totals
  // Bảng chỉ liệt kê kho CÓ PHÁT SINH trong kỳ — danh sách kho gồm cả trăm kho NPP, để nguyên thì
  // 2 dòng có số nằm lẫn giữa 151 dòng 0 (đo thật: 153 kho, 2 kho hoạt động). Kho khai chi phí mà
  // không có hàng vẫn hiện (chi phí > 0) — ẩn đi là giấu tiền.
  const allRows = data?.rows ?? []
  const rows = useMemo(() => allRows.filter(r => r.tons > 0 || r.work_days > 0 || (r.cost ?? 0) > 0), [allRows])
  const hiddenRows = allRows.length - rows.length
  const trend = data?.by_month ?? []

  // Cảnh báo dữ liệu — số liệu THIẾU phải nói ra, đừng để người đọc tưởng năng suất kém
  const noLabor = !!t && t.work_days === 0
  const someNoLabor = !!t && t.warehouses_no_labor > 0 && !noLabor
  const noWeight = t?.lines_no_weight ?? 0

  return (
    <div className="space-y-3">
      {/* Chọn kỳ = FilterBar chuẩn (chip desktop · nút "Lọc" + sheet trên mobile), không tự chế ô lọc */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-2.5 py-1.5 flex flex-wrap items-center gap-2">
        <FilterSheetButton defs={filterDefs} className="sm:hidden" />
        <FilterBar defs={filterDefs} />
        <span className="flex-1 min-w-2" />
        <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
          {formatDate(from)} – {formatDate(to)} · {dayCount(from, to)} ngày
        </span>
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

      {/* XEM THEO THÁNG — biểu đồ có lên/xuống (user chốt 27/08) */}
      {!isLoading && (trend.length > 1 ? (
        <MonthlyTrend rows={trend} onPick12={() => setDashboard({ prodFrom: monthStart(11), prodTo: TODAY() })} />
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-3 py-2 flex items-center gap-2 flex-wrap">
          <TrendingUp className="h-3.5 w-3.5 text-sky-500 shrink-0" />
          <span className="text-[11px] text-slate-600 dark:text-slate-300">
            Kỳ đang chọn chỉ có 1 tháng nên chưa vẽ được xu hướng.
          </span>
          <button type="button" onClick={() => setDashboard({ prodFrom: monthStart(11), prodTo: TODAY() })}
            className="h-7 px-2 rounded text-[11px] font-medium bg-sky-600 text-white hover:bg-sky-700">
            Xem 12 tháng gần nhất
          </button>
        </div>
      ))}

      {/* Bảng theo kho */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700">
          <span className="w-1 h-3.5 rounded bg-sky-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">Năng suất theo kho</span>
          <span className="text-[9px] text-slate-500">
            {fmtNum(rows.length, 0)} kho có phát sinh{hiddenRows > 0 ? ` · ẩn ${fmtNum(hiddenRows, 0)} kho không phát sinh` : ''}
            {!data?.cost_hidden && (data?.cost_shared ?? 0) > 0 ? ' · cột Chi phí là tiền RIÊNG của kho (chưa gánh chi phí chung)' : ''}
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
                <tr><td colSpan={14} className="px-2 py-4 text-center text-[11px] text-slate-400">
                  {allRows.length > 0 ? 'Không kho nào phát sinh nhập/xuất, chấm công hay chi phí trong kỳ.' : 'Không có kho nào trong phạm vi.'}
                </td></tr>
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
