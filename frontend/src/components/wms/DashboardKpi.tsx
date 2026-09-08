// Tab KPI của Dashboard (08/09/2026) — 40 KPI của "Warehouse KPI Master List": 27 đo được hiện đèn
// G/Y/R theo mục tiêu cấu hình, 13 chưa có nguồn hiện ô trống kèm "cần bổ sung gì".
//
// Mọi định nghĩa (tên, đơn vị, chiều tốt, công thức, ghi chú đo một phần, chú thích thiếu dữ liệu) và
// đèn đều do BE trả — file này CHỈ VẼ. Bố cục (user chốt 08/09 chiều):
//   · MỘT hàng bộ lọc trên cùng: CHU KỲ Ngày/Tuần/Tháng/Năm + Từ–Đến theo chu kỳ (ngày / tuần ISO / tháng /
//     năm) + Kỳ dựng sẵn + So sánh (kỳ liền trước / cùng kỳ năm trước) — mọi ô, bảng, biểu đồ đọc cùng lát cắt.
//   · Mỗi KPI THEO KỲ = thẻ số + BIỂU ĐỒ ĐƯỜNG nhỏ (thực tế ↔ mục tiêu) + nút phóng to (dialog 80% màn hình:
//     trục, tooltip, bảng số, chu kỳ riêng). KPI ẢNH CHỤP TỒN (không có "theo kỳ") = thanh mục tiêu.
//   · Thiếu dữ liệu → nói rõ cần cài đặt / thao tác gì (empty_hint). Chưa có mục tiêu → nút "Đặt mục tiêu" ngay trên thẻ.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Target, Warehouse, AlertTriangle, Info, CircleDashed, Settings2, Maximize2, Table2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DashPanel, DASH_SK } from '@/components/wms/DashboardPanel'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { FormSheet } from '@/components/shared/FormSheet'
import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useWarehouseKpi, useWarehouseKpiSeries, useKpiTargets, useSaveKpiTargets,
  type KpiDefPublic, type KpiValue, type KpiTargetMap, type KpiGrain, type KpiBucket,
} from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'
import { fmtNum } from '@/utils/productivity'
import { KpiLineChart, KpiChartLegend, bucketLabel, fmtValue, ragOf, RAG_HEX, type ChartPoint } from '@/components/wms/KpiLineChart'

// ── Ngày / tuần / tháng / năm ─────────────────────────────────────────────────────────────────
// "Hôm nay" phải là HÀM (ratchet today_frozen_at_import)
const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const pad2 = (n: number) => String(n).padStart(2, '0')
function addDays(ymd: string, n: number): string { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function monthStart(back: number): string {
  const [y, m] = TODAY().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10)
}
function monthEnd(ymd: string): string { const [y, m] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
const yearStart = (back = 0) => `${Number(TODAY().slice(0, 4)) - back}-01-01`
/** Tuần ISO (thứ Hai đầu tuần, tuần 1 chứa ngày 4/1) */
function isoWeekOf(ymd: string): { y: number; w: number } {
  const d = new Date(`${ymd}T00:00:00Z`); const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { y: d.getUTCFullYear(), w: Math.ceil(((d.getTime() - y0.getTime()) / 86400000 + 1) / 7) }
}
function isoWeekMonday(y: number, w: number): string {
  const jan4 = new Date(Date.UTC(y, 0, 4)); const day = jan4.getUTCDay() || 7
  const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - (day - 1) + (w - 1) * 7)
  return mon.toISOString().slice(0, 10)
}
const toWeekInput = (ymd: string) => { const { y, w } = isoWeekOf(ymd); return `${y}-W${pad2(w)}` }
const GRAINS: Array<{ key: KpiGrain; label: string }> = [
  { key: 'day', label: 'Ngày' }, { key: 'week', label: 'Tuần' }, { key: 'month', label: 'Tháng' }, { key: 'year', label: 'Năm' },
]
/** Khoảng mặc định khi đổi chu kỳ: 30 ngày · 12 tuần · 12 tháng · 3 năm (đều ≤ 60 kỳ) */
function defaultRange(g: KpiGrain): { from: string; to: string } {
  const t = TODAY()
  if (g === 'day') return { from: addDays(t, -29), to: t }
  if (g === 'week') { const { y, w } = isoWeekOf(t); return { from: addDays(isoWeekMonday(y, w), -7 * 11), to: t } }
  if (g === 'month') return { from: monthStart(11), to: t }
  return { from: yearStart(2), to: t }
}
const asGrain = (s: string): KpiGrain => (['day', 'week', 'month', 'year'].includes(s) ? s as KpiGrain : 'month')

/** Ô Từ–Đến đổi kiểu theo chu kỳ (date / week / month / year) — luôn quy về ngày đầu và ngày cuối kỳ */
function GrainRange({ grain, from, to, onChange, compact }: { grain: KpiGrain; from: string; to: string; onChange: (f: string, t: string) => void; compact?: boolean }) {
  const cls = `h-7 text-[11px] ${compact ? 'w-[7.5rem]' : 'w-36'} px-1.5`
  if (grain === 'day') return (
    <div className="flex items-center gap-1">
      <Input type="date" value={from} onChange={e => e.target.value && onChange(e.target.value, to < e.target.value ? e.target.value : to)} className={cls} />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="date" value={to} onChange={e => e.target.value && onChange(from > e.target.value ? e.target.value : from, e.target.value)} className={cls} />
    </div>
  )
  if (grain === 'week') return (
    <div className="flex items-center gap-1" title="Tuần ISO — thứ Hai đầu tuần">
      <Input type="week" value={toWeekInput(from)} onChange={e => { const m = /^(\d{4})-W(\d{2})$/.exec(e.target.value); if (!m) return; const f = isoWeekMonday(Number(m[1]), Number(m[2])); onChange(f, to < f ? addDays(f, 6) : to) }} className={cls} />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="week" value={toWeekInput(to)} onChange={e => { const m = /^(\d{4})-W(\d{2})$/.exec(e.target.value); if (!m) return; const t = addDays(isoWeekMonday(Number(m[1]), Number(m[2])), 6); onChange(from > t ? addDays(t, -6) : from, t) }} className={cls} />
    </div>
  )
  if (grain === 'month') return (
    <div className="flex items-center gap-1">
      <Input type="month" value={from.slice(0, 7)} onChange={e => { if (!/^\d{4}-\d{2}$/.test(e.target.value)) return; const f = `${e.target.value}-01`; onChange(f, to < f ? monthEnd(f) : to) }} className={cls} />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="month" value={to.slice(0, 7)} onChange={e => { if (!/^\d{4}-\d{2}$/.test(e.target.value)) return; const t = monthEnd(`${e.target.value}-01`); onChange(from > t ? `${e.target.value}-01` : from, t) }} className={cls} />
    </div>
  )
  return (
    <div className="flex items-center gap-1">
      <Input type="number" min={2020} max={2100} value={from.slice(0, 4)} onChange={e => { const y = Number(e.target.value); if (y < 2000 || y > 2100) return; const f = `${y}-01-01`; onChange(f, to < f ? `${y}-12-31` : to) }} className={`h-7 text-[11px] w-20 px-1.5`} />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="number" min={2020} max={2100} value={to.slice(0, 4)} onChange={e => { const y = Number(e.target.value); if (y < 2000 || y > 2100) return; const t = `${y}-12-31`; onChange(from > t ? `${y}-01-01` : from, t) }} className={`h-7 text-[11px] w-20 px-1.5`} />
    </div>
  )
}
function GrainPills({ value, onChange }: { value: KpiGrain; onChange: (g: KpiGrain) => void }) {
  return (
    <div className="flex rounded border border-slate-200 dark:border-slate-700 overflow-hidden text-[11px] font-medium">
      {GRAINS.map(g => (
        <button key={g.key} type="button" onClick={() => onChange(g.key)}
          className={`px-2 h-7 border-l first:border-l-0 border-slate-200 dark:border-slate-700 ${value === g.key ? 'bg-sky-600 text-white' : 'bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-slate-50'}`}>
          {g.label}
        </button>
      ))}
    </div>
  )
}

// ── Đèn ───────────────────────────────────────────────────────────────────────────────────────
const RAG_STRIPE: Record<string, string> = { G: 'bg-emerald-500', Y: 'bg-amber-500', R: 'bg-red-500', none: 'bg-slate-300 dark:bg-slate-600' }
const RAG_TEXT: Record<string, string> = { G: 'text-emerald-600 dark:text-emerald-400', Y: 'text-amber-600 dark:text-amber-400', R: 'text-red-600 dark:text-red-400', none: 'text-slate-500' }
const RAG_TONE: Record<string, BadgeTone> = { G: 'green', Y: 'amber', R: 'red', none: 'slate' }
const RAG_LABEL: Record<string, string> = { G: 'Đạt', Y: 'Cần chú ý', R: 'Không đạt', none: '—' }
const ragKey = (r: string | null) => r ?? 'none'
const fmtThreshold = (def: KpiDefPublic, x: number) => def.unit === '%' ? `${fmtNum(x, 2)}%` : `${fmtNum(x, 3)} ${def.unit}`
function targetText(def: KpiDefPublic, t: number[] | null): string {
  if (!t) return 'chưa đặt mục tiêu'
  if (def.dir === 'up')   return `≥ ${fmtThreshold(def, t[0])} đạt · ≥ ${fmtThreshold(def, t[1])} chú ý`
  if (def.dir === 'down') return `≤ ${fmtThreshold(def, t[0])} đạt · ≤ ${fmtThreshold(def, t[1])} chú ý`
  return `${fmtNum(t[0], 2)}–${fmtThreshold(def, t[1])} đạt · ≤ ${fmtThreshold(def, t[2])} chú ý`
}
const targetShort = (def: KpiDefPublic, t: number[] | null) => !t ? 'chưa đặt mục tiêu'
  : `Mục tiêu ${def.dir === 'band' ? `${fmtNum(t[0], 2)}–${fmtThreshold(def, t[1])}` : `${def.dir === 'up' ? '≥' : '≤'} ${fmtThreshold(def, t[0])}`}`
const DIR_HINT: Record<string, string> = { up: 'cao hơn là tốt', down: 'thấp hơn là tốt', band: 'nằm trong dải là tốt' }
const SRC_LABEL: Record<string, string> = { warehouse: 'riêng kho', global: 'công ty', default: 'mặc định' }

/** ▲▼ so kỳ: tô theo CHIỀU TỐT của KPI, không theo dấu. Dải (band) không có chiều → trung tính. */
function Delta({ def, k }: { def: KpiDefPublic; k: KpiValue }) {
  if (k.delta == null || k.prev == null) return null
  if (Math.abs(k.delta) < Math.pow(10, -def.decimals) / 2) return <span className="text-[10px] text-slate-400">≈ kỳ so</span>
  const up = k.delta > 0
  const good = def.dir === 'band' ? null : (up === (def.dir === 'up'))
  const cls = good == null ? 'text-slate-500' : good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
  return (
    <span className={`text-[10px] tabular-nums font-medium ${cls}`} title={`Kỳ so: ${fmtValue(def, k.prev)}`}>
      {up ? '▲' : '▼'} {fmtNum(Math.abs(k.delta), def.decimals)}{def.unit === '%' ? ' điểm' : ''}
    </span>
  )
}

/** Thanh mục tiêu cho KPI ẢNH CHỤP (không có chuỗi theo kỳ): vùng đạt/chú ý/không đạt trên một trục + vạch giá trị */
function TargetBar({ def, k }: { def: KpiDefPublic; k: KpiValue }) {
  const t = k.t
  if (!t) return <div className="h-2 mt-1.5 mb-0.5 rounded-sm bg-slate-100 dark:bg-slate-700/60" />
  const max = def.unit === '%' ? 100 : Math.max(1e-9, k.value ?? 0, ...t) * 1.15
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`
  const G = 'bg-emerald-500/25', Y = 'bg-amber-500/25', R = 'bg-red-500/20'
  const segs: Array<[number, number, string]> = def.dir === 'up' ? [[0, t[1], R], [t[1], t[0], Y], [t[0], max, G]]
    : def.dir === 'down' ? [[0, t[0], G], [t[0], t[1], Y], [t[1], max, R]]
    : [[0, t[0], Y], [t[0], t[1], G], [t[1], t[2], Y], [t[2], max, R]]
  return (
    <div className="relative h-2 mt-1.5 mb-0.5 rounded-sm overflow-hidden bg-slate-100 dark:bg-slate-700/60" title={targetText(def, t)}>
      {segs.map(([a, b, c], i) => b > a && <span key={i} className={`absolute top-0 bottom-0 ${c}`} style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />)}
      {k.value != null && <span className="absolute top-0 bottom-0 w-[3px] -ml-px rounded-sm bg-slate-900 dark:bg-white shadow" style={{ left: pct(k.value) }} />}
    </div>
  )
}

function seriesPoints(grain: KpiGrain, buckets: KpiBucket[] | undefined, prev: KpiBucket[] | undefined, id: string): ChartPoint[] {
  return (buckets ?? []).map((b, i) => ({ key: b.key, label: bucketLabel(grain, b.key), value: b.values[id] ?? null, prev: prev ? (prev[i]?.values[id] ?? null) : undefined, from: b.from, to: b.to }))
}

// ── Thẻ KPI ───────────────────────────────────────────────────────────────────────────────────
function KpiCard({ def, k, points, canTarget, onExpand, onSetTarget }: {
  def: KpiDefPublic; k: KpiValue; points: ChartPoint[] | null; canTarget: boolean
  onExpand: () => void; onSetTarget: () => void
}) {
  const r = ragKey(k.rag)
  const noData = k.value == null
  return (
    <div className="relative rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 pl-3.5 pr-2 py-2 overflow-hidden flex flex-col">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${RAG_STRIPE[r]}`} />
      <div className="flex items-start gap-1">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 leading-tight flex-1 min-w-0" title={`#${def.no} · ${def.formula}`}>
          {def.name}{def.snapshot && <span className="ml-1 normal-case tracking-normal text-slate-400">· hiện tại</span>}
        </div>
        {def.note && <Info className="h-3 w-3 text-amber-500 shrink-0 mt-px" aria-label={def.note} />}
        {!def.snapshot && (
          <button type="button" onClick={onExpand} title="Phóng to biểu đồ" aria-label={`Phóng to ${def.name}`}
            className="h-5 w-5 -mt-0.5 -mr-1 rounded text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-white/5 flex items-center justify-center shrink-0">
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-2xl font-semibold leading-tight ${noData ? 'text-slate-400' : 'text-slate-900 dark:text-white'}`}>{fmtValue(def, k.value)}</span>
        {!noData && def.unit !== '%' && <span className="text-[10px] text-slate-500">{def.unit}</span>}
        <Delta def={def} k={k} />
        <span className="flex-1" />
        {!noData && <StatusBadge tone={RAG_TONE[r]} title={`Mục tiêu ${SRC_LABEL[k.t_source]}`} className="!text-[9px] !px-1.5 shrink-0">{RAG_LABEL[r]}</StatusBadge>}
      </div>
      {/* Theo kỳ → biểu đồ đường nhỏ · ảnh chụp → thanh mục tiêu */}
      {def.snapshot
        ? <TargetBar def={def} k={k} />
        : <div className="mt-1 -mx-1">{points && points.length > 0
            ? <KpiLineChart def={def} points={points} target={k.t} compact />
            : <div className="h-11 rounded bg-slate-50 dark:bg-slate-700/40" />}</div>}
      <div className="flex items-center justify-between gap-2 text-[9px] leading-tight mt-0.5">
        <span className="text-slate-500 truncate">{noData ? 'chưa có dữ liệu trong kỳ' : (k.sub ?? '')}</span>
        {k.t
          ? <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300" title={`Mục tiêu ${SRC_LABEL[k.t_source]} · ${DIR_HINT[def.dir]}`}>{targetShort(def, k.t)}</span>
          : canTarget
            ? <button type="button" onClick={onSetTarget} className="shrink-0 text-sky-600 hover:text-sky-700 font-medium underline-offset-2 hover:underline">Đặt mục tiêu</button>
            : <span className="shrink-0 text-slate-400 italic">chưa đặt mục tiêu</span>}
      </div>
      {noData && (
        <div className="mt-1 text-[9px] leading-tight text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/40 rounded px-1.5 py-1">
          <b>Để có số:</b> {def.empty_hint}
        </div>
      )}
      {!noData && def.note && <div className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5 leading-tight">{def.note}</div>}
    </div>
  )
}

function UnavailableCard({ u }: { u: { no: number; name: string; need: string } }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-2 bg-slate-50/60 dark:bg-slate-800/30">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 flex items-center gap-1"><CircleDashed className="h-3 w-3" /> {u.name}</div>
      <div className="text-lg font-semibold text-slate-300 dark:text-slate-600 leading-tight">—</div>
      <div className="text-[9px] text-slate-500 leading-tight"><b>Chưa có nguồn — cần:</b> {u.need}</div>
    </div>
  )
}

// ── Dialog phóng to 80% ───────────────────────────────────────────────────────────────────────
function KpiChartDialog({ def, warehouseId, init, onClose }: {
  def: KpiDefPublic | null; warehouseId: string
  init: { grain: KpiGrain; from: string; to: string; compare: string }; onClose: () => void
}) {
  const [grain, setGrain] = useState<KpiGrain>(init.grain)
  const [range, setRange] = useState({ from: init.from, to: init.to })
  const [compare, setCompare] = useState(init.compare)
  const [showTable, setShowTable] = useState(false)
  useEffect(() => { setGrain(init.grain); setRange({ from: init.from, to: init.to }); setCompare(init.compare) }, [init.grain, init.from, init.to, init.compare, def?.id])
  const q = useWarehouseKpiSeries({ warehouseId, grain, from: range.from, to: range.to, compare }, !!def)
  const d = q.data
  const t = def ? (d?.targets?.[def.id] ?? null) : null
  const points = def && d ? seriesPoints(grain, d.buckets, d.compare?.buckets, def.id) : []
  const vals = points.map(p => p.value).filter((v): v is number => v != null)
  const rags = points.map(p => ragOf(def!, p.value, t))
  const nOk = rags.filter(x => x === 'G').length, nMeasured = rags.filter(x => x != null).length
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  const prevLabel = compare === 'yoy' ? 'Cùng kỳ năm trước' : 'Kỳ liền trước'
  const errMsg = (q.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return (
    <Dialog open={!!def} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="w-[96vw] max-w-[96vw] h-[92dvh] sm:w-[80vw] sm:max-w-[80vw] sm:h-[80vh] max-h-none p-0 gap-0 flex flex-col overflow-hidden">
        {def && (
          <>
            <div className="border-b border-slate-200 dark:border-slate-700 px-4 py-3 pr-10 shrink-0">
              <DialogTitle className="text-base font-semibold text-slate-800 dark:text-slate-100">{def.name} <span className="text-slate-400 font-normal text-sm">· {def.unit} · {DIR_HINT[def.dir]}</span></DialogTitle>
              <p className="text-xs text-slate-500 mt-0.5">{def.formula}{def.note ? ` · ${def.note}` : ''}</p>
            </div>
            {/* Bộ lọc của biểu đồ — một hàng trên biểu đồ */}
            <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-700/60 shrink-0">
              <GrainPills value={grain} onChange={g => { setGrain(g); setRange(defaultRange(g)) }} />
              <GrainRange grain={grain} from={range.from} to={range.to} onChange={(f, tt) => setRange({ from: f, to: tt })} />
              <select value={compare} onChange={e => setCompare(e.target.value)} className="h-7 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] px-1.5">
                <option value="">Không so sánh</option>
                <option value="prev">So kỳ liền trước</option>
                <option value="yoy">So cùng kỳ năm trước</option>
              </select>
              <span className="flex-1" />
              <span className="text-[10px] text-slate-500 tabular-nums">{formatDate(range.from)} – {formatDate(range.to)} · {points.length} kỳ</span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
              {q.isError && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{errMsg ?? 'Không tải được chuỗi KPI — thu hẹp khoảng hoặc đổi chu kỳ.'}</div>}
              {!q.data && q.isLoading && <Skeleton className={`h-64 w-full ${DASH_SK}`} />}
              {d && (
                <>
                  <div className={q.isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                    <KpiLineChart def={def} points={points} target={t} height={Math.max(220, Math.min(420, Math.round(window.innerHeight * 0.36)))} prevLabel={prevLabel} grain={grain} />
                  </div>
                  <KpiChartLegend hasPrev={!!d.compare} prevLabel={prevLabel} />
                  {/* Số liệu tóm tắt của chuỗi */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[
                      ['Kỳ đạt', nMeasured ? `${nOk}/${nMeasured}` : '—', nMeasured ? `${Math.round(100 * nOk / nMeasured)}% số kỳ` : 'chưa đặt mục tiêu / chưa có số'],
                      ['Trung bình', fmtValue(def, avg), 'TB các kỳ có số'],
                      ['Thấp nhất', fmtValue(def, vals.length ? Math.min(...vals) : null), ''],
                      ['Cao nhất', fmtValue(def, vals.length ? Math.max(...vals) : null), ''],
                      ['Kỳ mới nhất', fmtValue(def, [...points].reverse().find(p => p.value != null)?.value ?? null), targetShort(def, t)],
                    ].map(([l, v, s]) => (
                      <div key={l} className="rounded border border-slate-200 dark:border-slate-700 px-2.5 py-1.5">
                        <div className="text-[9px] uppercase tracking-wide text-slate-500">{l}</div>
                        <div className="text-lg font-semibold text-slate-900 dark:text-white leading-tight">{v}</div>
                        {s && <div className="text-[9px] text-slate-500">{s}</div>}
                      </div>
                    ))}
                  </div>
                  {vals.length === 0 && (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /><b>Chưa có dữ liệu trong khoảng này.</b> {def.empty_hint}
                    </div>
                  )}
                  {/* Bảng số — mọi giá trị trên biểu đồ đều đọc được không cần rê chuột */}
                  <button type="button" onClick={() => setShowTable(s => !s)} className="text-[11px] text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1">
                    <Table2 className="h-3.5 w-3.5" /> {showTable ? 'Ẩn bảng số liệu' : 'Xem bảng số liệu'}
                  </button>
                  {showTable && (
                    <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
                      <table className="min-w-full text-left">
                        <thead><tr className="bg-slate-50 dark:bg-slate-800">
                          {['Kỳ', 'Từ', 'Đến', 'Thực tế', 'Đèn', ...(d.compare ? [prevLabel] : [])].map(h => <th key={h} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{h}</th>)}
                        </tr></thead>
                        <tbody>{points.map((p, i) => (
                          <tr key={p.key} className="border-t border-slate-100 dark:border-slate-700/60">
                            <td className="px-2 py-1 text-[10px] font-medium">{bucketLabel(grain, p.key, true)}</td>
                            <td className="px-2 py-1 text-[10px] text-slate-500">{formatDate(p.from ?? '')}</td>
                            <td className="px-2 py-1 text-[10px] text-slate-500">{formatDate(p.to ?? '')}</td>
                            <td className={`px-2 py-1 text-[10px] tabular-nums font-semibold ${RAG_TEXT[ragKey(rags[i])]}`}>{fmtValue(def, p.value)}</td>
                            <td className="px-2 py-1 text-[10px]">{rags[i] ? <span className="inline-block h-2 w-2 rounded-full" style={{ background: RAG_HEX[rags[i]!] }} /> : '—'}</td>
                            {d.compare && <td className="px-2 py-1 text-[10px] tabular-nums text-slate-600">{fmtValue(def, p.prev ?? null)}</td>}
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Form ĐẶT MỤC TIÊU — mặc định toàn công ty hoặc riêng 1 kho ────────────────────────────────
type RowMode = 'inherit' | 'none' | 'set'
type RowState = { mode: RowMode; v: string[] }
function KpiTargetSheet({ open, onClose, warehouseId, warehouses, canGlobal, focusId }: {
  open: boolean; onClose: () => void; warehouseId: string
  warehouses: { id: string; code?: string; name: string }[]; canGlobal: boolean; focusId?: string | null
}) {
  const q = useKpiTargets(open)
  const save = useSaveKpiTargets()
  const [scope, setScope] = useState<string>(canGlobal ? '' : warehouseId)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [slow, setSlow] = useState('90'); const [dead, setDead] = useState('180')
  const [err, setErr] = useState<string | null>(null)
  const [group, setGroup] = useState<string>('')
  const focusRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) setScope(canGlobal ? (warehouseId || '') : warehouseId) }, [open, warehouseId, canGlobal])
  useEffect(() => {
    if (!q.data) return
    const m: KpiTargetMap = scope ? (q.data.by_warehouse[scope] ?? {}) : q.data.default
    const next: Record<string, RowState> = {}
    for (const d of q.data.defs) {
      if (d.id in m) next[d.id] = m[d.id] === null ? { mode: 'none', v: [] } : { mode: 'set', v: (m[d.id] as number[]).map(String) }
      else next[d.id] = { mode: 'inherit', v: [] }
    }
    // Mở từ nút "Đặt mục tiêu" trên thẻ: nhảy tới đúng KPI và mở sẵn ô nhập
    if (focusId && next[focusId] && next[focusId].mode !== 'set') {
      const d = q.data.defs.find(x => x.id === focusId)
      if (d) next[focusId] = { mode: 'set', v: (d.defaults ?? Array(d.dir === 'band' ? 3 : 2).fill(0)).map(String) }
      if (d) setGroup(d.group)
    }
    setRows(next); setErr(null)
    setSlow(String(q.data.params.slow_days)); setDead(String(q.data.params.dead_days))
  }, [q.data, scope, focusId])
  useEffect(() => { if (open && focusId) setTimeout(() => focusRef.current?.scrollIntoView({ block: 'center' }), 200) }, [open, focusId, q.data])

  const defs = q.data?.defs ?? []
  const groups = q.data?.groups ?? []
  const shown = defs.filter(d => !group || d.group === group)
  const need = (d: KpiDefPublic) => (d.dir === 'band' ? 3 : 2)
  const labels = (d: KpiDefPublic) => d.dir === 'band' ? ['Từ (đạt)', 'Đến (đạt)', 'Tối đa (chú ý)'] : ['Đạt', 'Chú ý']
  const inheritText = (d: KpiDefPublic) => {
    if (scope) {
      const g = q.data?.default?.[d.id]
      if (g === null) return 'Theo công ty: không đặt'
      if (g) return `Theo công ty: ${targetText(d, g)}`
    }
    return d.defaults ? `Mặc định: ${targetText(d, d.defaults)}` : 'Chưa có mục tiêu — bộ KPI ghi "theo policy/baseline", hãy đặt riêng'
  }
  const setMode = (id: string, mode: RowMode, d: KpiDefPublic) => setRows(r => ({
    ...r, [id]: { mode, v: mode === 'set' && r[id].v.length !== need(d) ? (d.defaults ?? Array(need(d)).fill(0)).map(String) : r[id].v },
  }))
  const setVal = (id: string, i: number, val: string) => setRows(r => { const v = [...r[id].v]; v[i] = val; return { ...r, [id]: { ...r[id], v } } })

  async function onSave() {
    setErr(null)
    const targets: KpiTargetMap = {}
    for (const d of defs) {
      const r = rows[d.id]; if (!r || r.mode === 'inherit') continue
      if (r.mode === 'none') { targets[d.id] = null; continue }
      const nums = r.v.map(x => Number(String(x).replace(',', '.')))
      if (nums.length !== need(d) || nums.some(n => !Number.isFinite(n))) { setErr(`${d.name}: nhập đủ ${need(d)} số`); return }
      targets[d.id] = nums
    }
    const body: { warehouse_id: string | null; targets: KpiTargetMap; params?: { slow_days: number; dead_days: number } } = { warehouse_id: scope || null, targets }
    if (!scope) {
      const s = Number(slow), dd = Number(dead)
      if (!Number.isInteger(s) || !Number.isInteger(dd)) { setErr('Ngưỡng chậm / không luân chuyển phải là số ngày nguyên'); return }
      body.params = { slow_days: s, dead_days: dd }
    }
    try { await save.mutateAsync(body); onClose() }
    catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được mục tiêu — thử lại.') }
  }

  return (
    <FormSheet open={open} onClose={onClose} title="Mục tiêu KPI" widthClass="sm:max-w-2xl"
      description="Ngưỡng đèn xanh / vàng cho từng KPI, áp cho mọi chu kỳ (ngày · tuần · tháng · năm). Kho không đặt riêng thì dùng mục tiêu công ty; công ty không đặt thì dùng mặc định của bộ KPI."
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
        <Button onClick={onSave} disabled={save.isPending || q.isLoading}>{save.isPending ? 'Đang lưu…' : 'Lưu mục tiêu'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600 shrink-0">Phạm vi</span>
          {canGlobal && (
            <button type="button" onClick={() => setScope('')}
              className={`h-8 px-3 rounded border text-xs font-medium ${!scope ? 'bg-sky-600 text-white border-sky-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Mặc định toàn công ty</button>
          )}
          <WarehouseSingleSelect warehouses={warehouses} value={scope} onChange={id => setScope(id || (canGlobal ? '' : warehouseId))} placeholder="Riêng kho…" triggerClassName="h-8 w-52" />
          {scope && <span className="text-[11px] text-slate-500">Đang sửa mục tiêu RIÊNG của kho — "Theo công ty" = không ghi đè.</span>}
        </div>
        {!scope && (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-700">Ngưỡng hàng CHẬM luân chuyển (ngày)<Input type="number" min={7} max={730} value={slow} onChange={e => setSlow(e.target.value)} className="h-8 mt-1" /></label>
            <label className="text-xs text-slate-700">Ngưỡng KHÔNG luân chuyển (ngày)<Input type="number" min={7} max={1460} value={dead} onChange={e => setDead(e.target.value)} className="h-8 mt-1" /></label>
            <div className="col-span-2 text-[10px] text-slate-500">Tham số chung cho mọi kho (pallet nhập quá N ngày và mã không xuất quá N ngày).</div>
          </div>
        )}
        <div className="flex items-center gap-1 flex-wrap">
          <button type="button" onClick={() => setGroup('')} className={`h-6 px-2 rounded text-[10px] font-medium border ${!group ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>Tất cả</button>
          {groups.map(g => <button key={g.key} type="button" onClick={() => setGroup(g.key)} className={`h-6 px-2 rounded text-[10px] font-medium border ${group === g.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>{g.label}</button>)}
        </div>
        {err && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</div>}
        {q.isLoading && <Skeleton className="h-40 w-full bg-slate-200" />}
        <div className="divide-y divide-slate-100 border border-slate-200 rounded">
          {shown.map(d => {
            const r = rows[d.id] ?? { mode: 'inherit', v: [] }
            const noDefault = !d.defaults && r.mode !== 'set'
            return (
              <div key={d.id} ref={d.id === focusId ? focusRef : undefined}
                className={`px-3 py-2 space-y-1.5 ${d.id === focusId ? 'bg-sky-50 ring-1 ring-inset ring-sky-300' : noDefault ? 'bg-amber-50/60' : ''}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-800">{d.name} <span className="text-slate-400 font-normal">· {d.unit} · {DIR_HINT[d.dir]}</span></div>
                    <div className={`text-[10px] truncate ${noDefault ? 'text-amber-700' : 'text-slate-500'}`} title={d.formula}>{inheritText(d)}</div>
                  </div>
                  <select value={r.mode} onChange={e => setMode(d.id, e.target.value as RowMode, d)} className="h-7 rounded border border-slate-200 bg-white text-[11px] px-1.5 shrink-0">
                    <option value="inherit">{scope ? 'Theo công ty' : 'Theo mặc định'}</option>
                    <option value="set">Đặt riêng</option>
                    <option value="none">Không đặt mục tiêu</option>
                  </select>
                </div>
                {r.mode === 'set' && (
                  <div className="flex flex-wrap gap-2">
                    {labels(d).map((lb, i) => (
                      <label key={lb} className="text-[10px] text-slate-600 flex items-center gap-1">{lb}
                        <Input type="number" step="any" value={r.v[i] ?? ''} onChange={e => setVal(d.id, i, e.target.value)} className="h-7 w-24 text-xs" />
                        <span className="text-slate-400">{d.unit}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </FormSheet>
  )
}

// ── Tab chính ─────────────────────────────────────────────────────────────────────────────────
export function DashboardKpi({ warehouseId }: { warehouseId: string }) {
  const f = useWmsFilterStore(s => s.dashboard)
  const setDashboard = useWmsFilterStore(s => s.setDashboard)
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canTarget = can(perms, 'dashboard', 'kpi_target')
  const canGlobal = isAdmin(user) || user?.warehouse_scope === 'NATIONAL'
  const { data: scopedWhs = [] } = useScopedWarehouses(true)

  const grain = asGrain(f.kpiGrain)
  const dflt = defaultRange(grain)
  const from = f.kpiFrom || dflt.from
  const to = f.kpiTo || dflt.to
  const compare = f.kpiCompare === 'prev' || f.kpiCompare === 'yoy' ? f.kpiCompare : ''
  const q = useWarehouseKpi({ warehouseId, from, to, compare }, true)
  const s = useWarehouseKpiSeries({ warehouseId, grain, from, to, compare }, true)
  const d = q.data
  const [sheet, setSheet] = useState<{ open: boolean; focusId: string | null }>({ open: false, focusId: null })
  const [expanded, setExpanded] = useState<KpiDefPublic | null>(null)

  const RANGES = [
    { value: 'this', label: 'Tháng này', from: monthStart(0), to: TODAY() },
    { value: 'prev', label: 'Tháng trước', from: monthStart(1), to: monthEnd(monthStart(1)) },
    { value: '3m', label: '3 tháng gần nhất', from: monthStart(2), to: TODAY() },
    { value: 'ytd', label: 'Năm nay', from: yearStart(), to: TODAY() },
    { value: '12m', label: '12 tháng gần nhất', from: monthStart(11), to: TODAY() },
  ]
  const rangeValue = (f.kpiFrom || f.kpiTo) ? RANGES.find(r => r.from === from && r.to === to)?.value ?? '' : ''
  const filterDefs: FilterDef[] = [
    { key: 'period', label: 'Kỳ', type: 'single', pinned: true, options: RANGES, allLabel: 'Về mặc định theo chu kỳ', value: rangeValue,
      onChange: v => { const r = RANGES.find(x => x.value === v); setDashboard(r ? { kpiFrom: r.from, kpiTo: r.to } : { kpiFrom: '', kpiTo: '' }) } },
    { key: 'compare', label: 'So sánh', type: 'single', pinned: true, value: compare, allLabel: 'Không so sánh',
      options: [{ value: 'prev', label: 'Kỳ liền trước' }, { value: 'yoy', label: 'Cùng kỳ năm trước' }],
      onChange: v => setDashboard({ kpiCompare: v }) },
  ]

  const defById = useMemo(() => new Map((d?.defs ?? []).map(x => [x.id, x])), [d])
  const counts = useMemo(() => {
    const c = { G: 0, Y: 0, R: 0, none: 0 }
    for (const k of d?.kpis ?? []) c[ragKey(k.rag) as keyof typeof c]++
    return c
  }, [d])
  const tableGroup = f.kpiGroup || d?.groups?.[0]?.key || 'delivery'
  const tableDefs = (d?.defs ?? []).filter(x => x.group === tableGroup)
  const n = d?.notes
  const seriesErr = (s.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message

  return (
    <div className="space-y-3">
      {/* MỘT hàng bộ lọc — chu kỳ · từ–đến theo chu kỳ · kỳ dựng sẵn · so sánh · mục tiêu */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-2.5 py-1.5 flex flex-wrap items-center gap-2">
        <GrainPills value={grain} onChange={g => { const r = defaultRange(g); setDashboard({ kpiGrain: g, kpiFrom: r.from, kpiTo: r.to }) }} />
        <GrainRange grain={grain} from={from} to={to} onChange={(a, b) => setDashboard({ kpiFrom: a, kpiTo: b })} compact />
        <FilterSheetButton defs={filterDefs} className="sm:hidden" />
        <div className="hidden sm:block"><FilterBar defs={filterDefs} /></div>
        <span className="flex-1 min-w-2" />
        <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
          {formatDate(from)} – {formatDate(to)} · {d?.days ?? ''} ngày · {s.data?.buckets.length ?? '…'} {GRAINS.find(g => g.key === grain)?.label.toLowerCase()}
          {d?.compare && <> · so {formatDate(d.compare.from)} – {formatDate(d.compare.to)}</>}
        </span>
        {canTarget && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setSheet({ open: true, focusId: null })}>
            <Settings2 className="h-3.5 w-3.5" /> Mục tiêu
          </Button>
        )}
      </div>

      {q.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
          Không tải được KPI{(() => { const m = (q.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message; return m ? ` — ${m}` : ' — thử lại hoặc thu hẹp khoảng ngày.' })()}
        </div>
      )}
      {s.isError && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />Biểu đồ đường chưa vẽ được — {seriesErr ?? 'thu hẹp khoảng hoặc đổi chu kỳ lớn hơn'}.
        </div>
      )}

      {d && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Target className="h-3.5 w-3.5 text-sky-500" />
          <span className="text-slate-600 dark:text-slate-300"><b>{d.kpis.length}</b>/{d.kpis.length + d.unavailable.length} KPI đo được</span>
          <StatusBadge tone="green">{counts.G} đạt</StatusBadge>
          <StatusBadge tone="amber">{counts.Y} cần chú ý</StatusBadge>
          <StatusBadge tone="red">{counts.R} không đạt</StatusBadge>
          <StatusBadge tone="slate">{counts.none} chưa có dữ liệu / chưa đặt mục tiêu</StatusBadge>
          <span className="text-slate-500">· số lớn = cả khoảng đã chọn · đường = theo từng {GRAINS.find(g => g.key === grain)?.label.toLowerCase()}</span>
        </div>
      )}

      {n && (n.lines_no_weight > 0 || n.loc_uncapped > 0 || n.warehouses_no_labor > 0 || n.categories_filtered) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
          {n.warehouses_no_labor > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{n.warehouses_no_labor} kho có hàng nhưng chưa chấm công</b> — các KPI theo giờ công của kho đó để trống. Ghi công ở màn Chấm công.</span></div>}
          {n.lines_no_weight > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{fmtNum(n.lines_no_weight, 0)} dòng hàng chưa khai khối lượng thùng</b> — không vào tấn (DOH, vòng quay, tấn/giờ thấp hơn thực). Khai ở Mã hàng › KL/thùng.</span></div>}
          {n.loc_uncapped > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{fmtNum(n.loc_uncapped, 0)} vị trí</b> chưa khai sức chứa hoặc khai quá 1.000 pallet ("không giới hạn") — bị loại khỏi % sử dụng chỗ và tràn chỗ. Khai ở trang Vị trí kho.</span></div>}
          {n.categories_filtered && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span>Bạn chỉ được xem một phần Loại hàng: KPI theo tồn/thùng đã cắt theo quyền, KPI theo giờ công thì không tách được.</span></div>}
        </div>
      )}

      {q.isLoading && !d && (
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className={`h-[132px] rounded-lg ${DASH_SK}`} />)}</div>
      )}
      {d && d.groups.map(g => {
        const ks = d.kpis.filter(k => defById.get(k.id)?.group === g.key)
        const un = d.unavailable.filter(u => u.group === g.key)
        if (!ks.length && !un.length) return null
        return (
          <DashPanel key={g.key} title={g.label} icon={Target} extra={<span className="text-[9px] text-slate-500">{ks.length} đo được{un.length ? ` · ${un.length} chưa có nguồn` : ''}</span>}>
            <div className={`p-2 grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 ${s.isFetching && s.data ? 'opacity-90' : ''}`}>
              {ks.map(k => {
                const def = defById.get(k.id)!
                return <KpiCard key={k.id} def={def} k={k} canTarget={canTarget}
                  points={def.snapshot ? null : (s.data ? seriesPoints(grain, s.data.buckets, s.data.compare?.buckets, def.id) : null)}
                  onExpand={() => setExpanded(def)} onSetTarget={() => setSheet({ open: true, focusId: def.id })} />
              })}
              {un.map(u => <UnavailableCard key={u.no} u={u} />)}
            </div>
          </DashPanel>
        )
      })}

      {d && (
        <DashPanel title="KPI theo kho" icon={Warehouse} extra={<>
          <span className="text-[9px] text-slate-500">{d.by_warehouse.length} kho có số liệu · cả khoảng đã chọn · đèn theo mục tiêu riêng kho nếu có</span>
          <span className="flex-1" />
          <div className="flex items-center gap-1 flex-wrap">
            {d.groups.map(g => (
              <button key={g.key} type="button" onClick={() => setDashboard({ kpiGroup: g.key })}
                className={`h-6 px-2 rounded text-[10px] font-medium border transition-colors ${tableGroup === g.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'}`}>{g.label}</button>
            ))}
          </div>
        </>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800">
                  <th className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap sticky left-0 z-10 bg-slate-50 dark:bg-slate-800">Kho</th>
                  {tableDefs.map(x => <th key={x.id} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right" title={`${x.name} (${x.unit})`}>{x.short}</th>)}
                </tr>
                <tr className="bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700/60">
                  <th className="text-[9px] font-normal text-slate-400 px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-slate-50 dark:bg-slate-800">Mục tiêu</th>
                  {tableDefs.map(x => { const t = d.kpis.find(k => k.id === x.id)?.t ?? null
                    return <th key={x.id} className="text-[9px] font-normal text-slate-400 px-2 py-1 whitespace-nowrap text-right tabular-nums" title={targetText(x, t)}>
                      {t ? (x.dir === 'band' ? `${fmtNum(t[0], 1)}–${fmtNum(t[1], 1)}` : `${x.dir === 'up' ? '≥' : '≤'} ${fmtNum(t[0], 2)}`) : '—'}</th> })}
                </tr>
              </thead>
              <tbody>
                {d.by_warehouse.length === 0 && <tr><td colSpan={tableDefs.length + 1} className="px-2 py-4 text-center text-[11px] text-slate-400">Không kho nào có số liệu trong kỳ.</td></tr>}
                {d.by_warehouse.map(w => {
                  const byId = new Map(w.kpis.map(k => [k.id, k]))
                  return (
                    <tr key={w.warehouse_id} className="border-t border-slate-100 dark:border-slate-700/60">
                      <td className="px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white dark:bg-slate-800/60 font-medium text-slate-700 dark:text-slate-200">{w.warehouse_name}</td>
                      {tableDefs.map(x => { const k = byId.get(x.id); const r = ragKey(k?.rag ?? null)
                        return <td key={x.id} className={`px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold ${RAG_TEXT[r]}`} title={k ? `${x.name}: ${fmtValue(x, k.value)} · ${k.sub ?? ''} · ${targetText(x, k.t)}` : ''}>
                          {k?.value != null && <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1 align-middle ${RAG_STRIPE[r]}`} />}{fmtValue(x, k?.value)} {k && <Delta def={x} k={k} />}</td> })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DashPanel>
      )}

      <KpiChartDialog def={expanded} warehouseId={warehouseId} init={{ grain, from, to, compare }} onClose={() => setExpanded(null)} />
      {canTarget && (
        <KpiTargetSheet open={sheet.open} focusId={sheet.focusId} onClose={() => setSheet({ open: false, focusId: null })} warehouseId={warehouseId}
          warehouses={scopedWhs as { id: string; code?: string; name: string }[]} canGlobal={canGlobal} />
      )}
    </div>
  )
}
