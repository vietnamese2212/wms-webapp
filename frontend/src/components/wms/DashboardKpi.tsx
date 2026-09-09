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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Target, Warehouse, AlertTriangle, CircleDashed, Settings2, Maximize2, Table2, Pencil, BookOpen } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DashPanel, DASH_SK } from '@/components/wms/DashboardPanel'
import { FormSheet } from '@/components/shared/FormSheet'
import { InfoTip } from '@/components/shared/InfoTip'
import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import {
  useWarehouseKpi, useWarehouseKpiSeries, useKpiTargets, useSaveKpiTargets, useKpiMeanings, useSaveKpiMeanings,
  type KpiDefPublic, type KpiValue, type KpiTargetMap, type KpiGrain, type KpiBucket,
} from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'
import { fmtNum } from '@/utils/productivity'
import { KpiLineChart, KpiChartLegend, bucketLabel, fmtValue, ragOf, RAG_HEX, type ChartPoint } from '@/components/wms/KpiLineChart'

// ── Ngày / tuần / tháng / năm — helper ở utils/kpiPeriods.ts (dùng chung với hook tách đoạn) ──
import {
  addDays, monthEnd, isoWeekMonday, toWeekInput, defaultRange, bucketStarts, dayCount, MAX_BUCKETS, GRAIN_LABEL,
} from '@/utils/kpiPeriods'
const GRAINS: Array<{ key: KpiGrain; label: string }> = [
  { key: 'day', label: 'Ngày' }, { key: 'week', label: 'Tuần' }, { key: 'month', label: 'Tháng' }, { key: 'year', label: 'Năm' },
]
const asGrain = (s: string): KpiGrain => (['day', 'week', 'month', 'year'].includes(s) ? s as KpiGrain : 'month')

/** Ô Từ–Đến đổi kiểu theo chu kỳ (date / week / month / year) — luôn quy về ngày đầu và ngày cuối kỳ.
 *  Bề rộng ĐỦ cho nhãn dài của trình duyệt ("tháng 10 năm 2025", "Tuần 36, 2026") — user 09/09 báo ô tháng bị cắt. */
function GrainRange({ grain, from, to, onChange }: { grain: KpiGrain; from: string; to: string; onChange: (f: string, t: string) => void }) {
  const cls = 'h-7 text-[11px] w-40 min-w-[9.5rem] px-1.5'
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
      <Input type="number" min={2020} max={2100} value={from.slice(0, 4)} onChange={e => { const y = Number(e.target.value); if (y < 2000 || y > 2100) return; const f = `${y}-01-01`; onChange(f, to < f ? `${y}-12-31` : to) }} className="h-7 text-[11px] w-24 px-1.5" />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="number" min={2020} max={2100} value={to.slice(0, 4)} onChange={e => { const y = Number(e.target.value); if (y < 2000 || y > 2100) return; const t = `${y}-12-31`; onChange(from > t ? `${y}-01-01` : from, t) }} className="h-7 text-[11px] w-24 px-1.5" />
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
// Nguồn mục tiêu: "chung" (đặt ở tab Mục tiêu dùng chung; chưa ai đặt thì là giá trị khởi tạo của bộ KPI) hoặc "riêng kho"
const SRC_LABEL: Record<string, string> = { warehouse: 'riêng kho', global: 'chung', default: 'chung' }

/** Nút ⓘ trên thẻ: ý nghĩa + cách tính + chiều tốt + ghi chú đo một phần (user 09/09 "để người xem hiểu").
 *  Câu ý nghĩa SỬA ĐƯỢC trong app (cờ `kpi_meanings`) — có quyền thì tooltip có luôn nút "Sửa diễn giải".
 *  "Cách tính" thì không cho sửa: nó mô tả đúng phép tính RPC đang chạy. */
function KpiInfoTip({ def, onEdit }: { def: KpiDefPublic; onEdit?: () => void }) {
  return (
    <InfoTip side="bottom" className="mt-px" tip={close => (
      <div className="space-y-1 text-left">
        <div className="font-semibold">#{def.no} · {def.name}</div>
        {def.meaning && <div>{def.meaning}</div>}
        <div><b>Cách tính:</b> {def.formula}</div>
        <div><b>Đọc số:</b> {DIR_HINT[def.dir]}{def.unit ? ` · đơn vị ${def.unit}` : ''}{def.snapshot ? ' · ảnh chụp tồn HIỆN TẠI, không theo kỳ' : ' · số lớn = cả khoảng đã chọn, đường = theo từng kỳ'}</div>
        {def.note && <div className="text-amber-700 dark:text-amber-400"><b>Lưu ý:</b> {def.note}</div>}
        {onEdit && (
          <button type="button" onClick={() => { close(); onEdit() }}
            className="mt-0.5 inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 font-medium hover:underline underline-offset-2">
            <Pencil className="h-3 w-3" /> Sửa diễn giải
          </button>
        )}
      </div>
    )} />
  )
}

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
function KpiCard({ def, k, points, canTarget, onExpand, onSetTarget, onEditNote }: {
  def: KpiDefPublic; k: KpiValue; points: ChartPoint[] | null; canTarget: boolean
  onExpand: () => void; onSetTarget: () => void; onEditNote?: () => void
}) {
  const r = ragKey(k.rag)
  const noData = k.value == null
  return (
    <div className="relative rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 pl-3.5 pr-2 py-2 overflow-hidden flex flex-col">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${RAG_STRIPE[r]}`} />
      <div className="flex items-start gap-1">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 leading-tight flex-1 min-w-0">
          {def.name}{def.snapshot && <span className="ml-1 normal-case tracking-normal text-slate-400">· hiện tại</span>}
        </div>
        <KpiInfoTip def={def} onEdit={onEditNote} />
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
function KpiChartDialog({ def, warehouseId, init, onClose, onEditNote }: {
  def: KpiDefPublic | null; warehouseId: string
  init: { grain: KpiGrain; from: string; to: string; compare: string }; onClose: () => void; onEditNote?: () => void
}) {
  const [grain, setGrain] = useState<KpiGrain>(init.grain)
  const [range, setRange] = useState({ from: init.from, to: init.to })
  const [compare, setCompare] = useState(init.compare)
  const [showTable, setShowTable] = useState(false)
  useEffect(() => { setGrain(init.grain); setRange({ from: init.from, to: init.to }); setCompare(init.compare) }, [init.grain, init.from, init.to, init.compare, def?.id])
  const nB = bucketStarts(grain, range.from, range.to).length
  const tooMany = nB > MAX_BUCKETS[grain]
  const q = useWarehouseKpiSeries({ warehouseId, grain, from: range.from, to: range.to, compare }, !!def && !tooMany)
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
              <DialogTitle className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">{def.name} <span className="text-slate-400 font-normal text-sm">· {def.unit} · {DIR_HINT[def.dir]}</span> <KpiInfoTip def={def} onEdit={onEditNote} /></DialogTitle>
              <p className="text-xs text-slate-500 mt-0.5">{def.meaning || def.formula}{def.note ? ` · ${def.note}` : ''}</p>
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
              {tooMany && <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">Khoảng đang chọn là {nB} {GRAIN_LABEL[grain]} — tối đa {MAX_BUCKETS[grain]} {GRAIN_LABEL[grain]} trên một biểu đồ{grain === 'day' ? ' (dài hơn 3 tháng hãy đổi sang Tuần / Tháng)' : ' (tròn 2 năm)'}.</div>}
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

// ── Form MỤC TIÊU — 2 tab, mặc định CHỈ XEM số đang có, mỗi tab MỘT nút "Sửa"
//   (user chốt 09/09 vòng 2: "dữ liệu hiện có đã có, bấm vào tab nào thì có nút sửa và khi đó mới sửa và lưu";
//    "đồng bộ thẳng hàng các giá trị chứ mỗi ô lại nằm 1 chỗ rất xấu"):
//   · "Mục tiêu dùng chung": bảng Đạt / Cần chú ý cho cả bộ KPI + 2 tham số chậm / không luân chuyển.
//   · "Chi tiết các kho": chọn kho mới hiện; cột "Áp dụng" nói dòng đó theo mục tiêu chung hay riêng kho.
//   THẲNG CỘT = lưới cột CỐ ĐỊNH dùng chung cho tiêu đề và mọi dòng (GRID_COMMON / GRID_WH), số căn phải;
//   đơn vị nằm ở dòng phụ dưới tên KPI, KHÔNG lặp sau từng ô (chính chỗ làm các ô lệch nhau ở bản trước).
type SheetTab = 'common' | 'wh'
type WhRowMode = 'common' | 'own'
const needOf = (d: KpiDefPublic) => (d.dir === 'band' ? 3 : 2)
const emptyVals = (d: KpiDefPublic) => Array<string>(needOf(d)).fill('')
const OP: Record<string, string> = { up: '≥', down: '≤', band: '≤' }
const numText = (x: number) => x.toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const GRID_COMMON = 'sm:grid sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] sm:items-center sm:gap-3'
const GRID_WH = 'sm:grid sm:grid-cols-[minmax(0,1fr)_9.5rem_7rem_7rem] sm:items-center sm:gap-3'

/** Chuỗi nhập → ngưỡng: trống cả = null (không đặt); điền một phần / không phải số = lỗi. */
function parseVals(d: KpiDefPublic, v: string[]): { t: number[] | null } | { error: string } {
  const filled = v.filter(x => String(x).trim() !== '')
  if (filled.length === 0) return { t: null }
  if (filled.length !== needOf(d)) return { error: `${d.name}: nhập đủ ${needOf(d)} số hoặc để trống cả để không đặt mục tiêu` }
  const nums = v.map(x => Number(String(x).replace(',', '.')))
  if (nums.some(n => !Number.isFinite(n))) return { error: `${d.name}: ngưỡng phải là số` }
  return { t: nums }
}

/** Tiêu đề cột — cùng lưới với dòng dữ liệu nên nhãn luôn đứng ngay trên đúng ô. */
function TargetHead({ grid, scope }: { grid: string; scope?: boolean }) {
  return (
    <div className={`hidden ${grid} px-3 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t text-[10px] font-medium uppercase tracking-wide text-slate-500`}>
      <div>KPI</div>
      {scope && <div>Áp dụng</div>}
      <div className="text-right">Đạt</div>
      <div className="text-right">Cần chú ý</div>
    </div>
  )
}

/** HAI ô giá trị (Đạt · Cần chú ý) — xem hay sửa đều nằm ĐÚNG hai cột đó. */
function TargetCells({ d, t, v, onChange, muted }: {
  d: KpiDefPublic; t?: number[] | null
  v?: string[]; onChange?: (i: number, val: string) => void; muted?: boolean
}) {
  const box = 'flex items-center gap-1 justify-start sm:justify-end min-w-0'
  const lab = (s: string) => <div className="text-[10px] text-slate-400 sm:hidden mb-0.5">{s}</div>
  const op = <span className="text-slate-400 text-[11px] w-2.5 text-right shrink-0">{OP[d.dir]}</span>
  if (v && onChange) {
    const inp = (i: number, w: string) => (
      <Input type="number" step="any" value={v[i] ?? ''} onChange={e => onChange(i, e.target.value)}
        className={`h-7 ${w} text-xs px-1.5 text-right tabular-nums`} />
    )
    return (
      <>
        <div className="min-w-0">{lab('Đạt')}<div className={box}>
          {d.dir === 'band'
            ? <>{inp(0, 'w-full sm:w-[3rem]')}<span className="text-slate-400 text-[11px] shrink-0">–</span>{inp(1, 'w-full sm:w-[3rem]')}</>
            : <>{op}{inp(0, 'w-full sm:w-[4.5rem]')}</>}
        </div></div>
        <div className="min-w-0">{lab('Cần chú ý')}<div className={box}>{op}{inp(d.dir === 'band' ? 2 : 1, 'w-full sm:w-[4.5rem]')}</div></div>
      </>
    )
  }
  const cls = `text-xs tabular-nums whitespace-nowrap ${muted ? 'text-slate-400' : 'text-slate-700 font-medium'}`
  const cell = (label: string, txt: string | null) => (
    <div className="min-w-0">{lab(label)}<div className={box}>{txt ? <span className={cls}>{txt}</span> : <span className="text-slate-300 text-xs">—</span>}</div></div>
  )
  return (
    <>
      {cell('Đạt', !t ? null : d.dir === 'band' ? `${numText(t[0])} – ${numText(t[1])}` : `${OP[d.dir]} ${numText(t[0])}`)}
      {cell('Cần chú ý', !t ? null : `${OP[d.dir]} ${numText(d.dir === 'band' ? t[2] : t[1])}`)}
    </>
  )
}

function KpiTargetSheet({ open, onClose, warehouseId, warehouses, canGlobal, focusId }: {
  open: boolean; onClose: () => void; warehouseId: string
  warehouses: { id: string; code?: string; name: string }[]; canGlobal: boolean; focusId?: string | null
}) {
  const q = useKpiTargets(open)
  const save = useSaveKpiTargets()
  const [tab, setTab] = useState<SheetTab>('common')
  const [wh, setWh] = useState('')
  const [editing, setEditing] = useState(false)
  const [common, setCommon] = useState<Record<string, string[]>>({})
  const [own, setOwn] = useState<Record<string, { mode: WhRowMode; v: string[] }>>({})
  const [slow, setSlow] = useState('90'); const [dead, setDead] = useState('180')
  const [err, setErr] = useState<string | null>(null)
  const [group, setGroup] = useState<string>('')
  const focusRef = useRef<HTMLDivElement>(null)

  const data = q.data
  const defs = data?.defs ?? []
  const groups = data?.groups ?? []
  const shown = defs.filter(d => !group || d.group === group)
  /** Mục tiêu chung ĐANG CÓ HIỆU LỰC: bản đã lưu; chưa ai lưu thì là giá trị khởi tạo của bộ KPI. */
  const commonOf = (d: KpiDefPublic): number[] | null => (data && d.id in data.default) ? data.default[d.id] : d.defaults
  /** Ghi đè của kho đang chọn (undefined = dòng đó theo mục tiêu chung). */
  const ownOf = (d: KpiDefPublic): number[] | null | undefined => (wh && data?.by_warehouse[wh] && d.id in data.by_warehouse[wh]) ? data.by_warehouse[wh][d.id] : undefined

  // Nạp lại giá trị từ máy chủ — dùng cả lúc mở form lẫn lúc bấm Huỷ giữa chừng
  const loadCommon = useCallback(() => {
    if (!data) return
    const c: Record<string, string[]> = {}
    for (const d of data.defs) { const t = (d.id in data.default) ? data.default[d.id] : d.defaults; c[d.id] = t ? t.map(String) : emptyVals(d) }
    setCommon(c); setSlow(String(data.params.slow_days)); setDead(String(data.params.dead_days))
  }, [data])
  const loadOwn = useCallback(() => {
    if (!data) return
    const m: KpiTargetMap = wh ? (data.by_warehouse[wh] ?? {}) : {}
    const o: Record<string, { mode: WhRowMode; v: string[] }> = {}
    for (const d of data.defs) o[d.id] = d.id in m ? { mode: 'own', v: m[d.id] ? (m[d.id] as number[]).map(String) : emptyVals(d) } : { mode: 'common', v: [] }
    setOwn(o)
  }, [data, wh])
  useEffect(() => { loadCommon() }, [loadCommon])
  useEffect(() => { loadOwn() }, [loadOwn])

  // Mở form: về tab hợp quyền. Mở từ nút "Đặt mục tiêu" trên thẻ = vào thẳng chế độ sửa đúng nhóm KPI đó.
  useEffect(() => {
    if (!open) return
    const t: SheetTab = canGlobal ? 'common' : 'wh'
    setTab(t); setWh(canGlobal ? '' : warehouseId); setErr(null); setGroup('')
    setEditing(!!focusId && (t === 'common' ? canGlobal : !!warehouseId))
  }, [open, canGlobal, warehouseId, focusId])
  useEffect(() => { if (open && focusId && data) setGroup(data.defs.find(x => x.id === focusId)?.group ?? '') }, [open, focusId, data])
  useEffect(() => { if (open && focusId) setTimeout(() => focusRef.current?.scrollIntoView({ block: 'center' }), 250) }, [open, focusId, data, tab, wh])

  const setCommonVal = (id: string, i: number, val: string) => setCommon(c => { const v = [...(c[id] ?? [])]; v[i] = val; return { ...c, [id]: v } })
  const setOwnMode = (d: KpiDefPublic, mode: WhRowMode) => setOwn(o => ({ ...o, [d.id]: { mode, v: mode === 'own' ? (commonOf(d) ?? emptyVals(d)).map(String) : [] } }))
  const setOwnVal = (id: string, i: number, val: string) => setOwn(o => { const v = [...(o[id]?.v ?? [])]; v[i] = val; return { ...o, [id]: { mode: 'own', v } } })

  const canEditTab = tab === 'common' ? canGlobal : !!wh
  function goTab(k: SheetTab) { setTab(k); setEditing(false); setErr(null); loadCommon(); loadOwn() }
  function cancelEdit() { setEditing(false); setErr(null); loadCommon(); loadOwn() }

  async function onSave() {
    setErr(null)
    const targets: KpiTargetMap = {}
    let body: { warehouse_id: string | null; targets: KpiTargetMap; params?: { slow_days: number; dead_days: number } }
    if (tab === 'common') {
      if (!canGlobal) return
      for (const d of defs) {
        const p = parseVals(d, common[d.id] ?? emptyVals(d))
        if ('error' in p) { setErr(p.error); return }
        targets[d.id] = p.t
      }
      const s = Number(slow), dd = Number(dead)
      if (!Number.isInteger(s) || !Number.isInteger(dd)) { setErr('Ngưỡng chậm / không luân chuyển phải là số ngày nguyên'); return }
      body = { warehouse_id: null, targets, params: { slow_days: s, dead_days: dd } }
    } else {
      if (!wh) { setErr('Chọn kho trước khi lưu'); return }
      for (const d of defs) {
        const r = own[d.id]; if (!r || r.mode !== 'own') continue
        const p = parseVals(d, r.v)
        if ('error' in p) { setErr(p.error); return }
        targets[d.id] = p.t
      }
      body = { warehouse_id: wh, targets }
    }
    // Lưu xong ở lại form và về chế độ xem để thấy ngay số vừa lưu
    try { await save.mutateAsync(body); setEditing(false) }
    catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được mục tiêu — thử lại.') }
  }

  const tabBtn = (k: SheetTab, label: string) => (
    <button type="button" onClick={() => goTab(k)}
      className={`h-8 px-3 text-xs font-medium border-b-2 -mb-px ${tab === k ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
  )
  const commonTip = (
    <div className="space-y-1 text-left">
      <div><b>Mục tiêu dùng chung</b> áp cho mọi kho và mọi chu kỳ (ngày · tuần · tháng · năm). Kho nào có mục tiêu riêng (tab Chi tiết các kho) thì dùng mục tiêu riêng.</div>
      <div>KPI "cao hơn là tốt": <i>Đạt ≥ … · Chú ý ≥ …</i>, dưới nữa là Không đạt. "Thấp hơn là tốt": <i>Đạt ≤ … · Chú ý ≤ …</i>. KPI dải (sức chứa, DOH): <i>Từ – Đến (đạt) · Tối đa (chú ý)</i>.</div>
      <div>Bấm <b>Sửa</b> để đổi; để trống cả hai ô = KPI đó không có mục tiêu, không sáng đèn.</div>
    </div>
  )
  const whTip = (
    <div className="space-y-1 text-left">
      <div>Chọn kho để xem mục tiêu đang áp cho kho đó. Cột <b>Áp dụng</b> nói dòng đó theo mục tiêu chung hay riêng kho.</div>
      <div>Bấm <b>Sửa</b> rồi đổi dòng cần khác sang <b>Mục tiêu riêng</b> — ô điền sẵn mục tiêu chung để bạn chỉnh. Về "Theo mục tiêu chung" là bỏ ghi đè; mục tiêu riêng để trống cả hai ô = tắt đèn KPI đó ở kho này.</div>
    </div>
  )
  const paramsTip = 'Pallet nhập kho quá N ngày mà mã không xuất quá N ngày = hàng CHẬM luân chuyển; ngưỡng dài hơn = KHÔNG luân chuyển. Tham số chung cho mọi kho, nuôi 2 KPI Hàng chậm / Hàng không luân chuyển.'

  return (
    <FormSheet open={open} onClose={onClose} title="Mục tiêu KPI" widthClass="sm:max-w-2xl"
      description="Ngưỡng đèn xanh / vàng cho từng KPI. Mục tiêu dùng chung áp mọi kho; kho nào cần khác thì đặt riêng."
      footer={editing ? (<>
        <Button variant="outline" onClick={cancelEdit} disabled={save.isPending}>Huỷ</Button>
        <Button onClick={onSave} disabled={save.isPending || q.isLoading}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>) : <Button variant="outline" onClick={onClose}>Đóng</Button>}>
      <div className="space-y-3">
        <div className="flex items-center gap-1 border-b border-slate-200">
          {tabBtn('common', 'Mục tiêu dùng chung')}
          {tabBtn('wh', 'Chi tiết các kho')}
          <span className="flex-1" />
          {!editing && canEditTab && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mb-1" onClick={() => { setErr(null); setEditing(true) }}>
              <Pencil className="h-3.5 w-3.5" /> Sửa
            </Button>
          )}
          <InfoTip tip={tab === 'common' ? commonTip : whTip} className="ml-1 mr-1" />
        </div>

        {tab === 'common' && (
          <>
            {!canGlobal && <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Chỉ người có phạm vi toàn công ty mới sửa mục tiêu chung. Bạn đặt riêng cho kho của mình ở tab <b>Chi tiết các kho</b>.</div>}
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 grid grid-cols-2 gap-3">
              <div className="text-xs text-slate-700">
                <div className="flex items-center gap-1 text-slate-600">Ngưỡng hàng CHẬM luân chuyển <InfoTip tip={paramsTip} /></div>
                {editing ? <Input type="number" min={7} max={730} value={slow} onChange={e => setSlow(e.target.value)} className="h-8 mt-1" />
                  : <div className="mt-0.5 font-medium tabular-nums">{slow} ngày</div>}
              </div>
              <div className="text-xs text-slate-700">
                <div className="text-slate-600">Ngưỡng KHÔNG luân chuyển</div>
                {editing ? <Input type="number" min={7} max={1460} value={dead} onChange={e => setDead(e.target.value)} className="h-8 mt-1" />
                  : <div className="mt-0.5 font-medium tabular-nums">{dead} ngày</div>}
              </div>
            </div>
          </>
        )}
        {tab === 'wh' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-600 shrink-0">Kho</span>
            <WarehouseSingleSelect warehouses={warehouses} value={wh} onChange={id => { setWh(id); setEditing(false); setErr(null) }} placeholder="Chọn kho…" triggerClassName="h-8 w-60" />
            {!wh && <span className="text-[11px] text-slate-500">Chọn kho để xem mục tiêu của kho đó.</span>}
          </div>
        )}

        {(tab === 'common' || wh) && (
          <div className="flex items-center gap-1 flex-wrap">
            <button type="button" onClick={() => setGroup('')} className={`h-6 px-2 rounded text-[10px] font-medium border ${!group ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>Tất cả</button>
            {groups.map(g => <button key={g.key} type="button" onClick={() => setGroup(g.key)} className={`h-6 px-2 rounded text-[10px] font-medium border ${group === g.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>{g.label}</button>)}
          </div>
        )}
        {err && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</div>}
        {q.isLoading && <Skeleton className="h-40 w-full bg-slate-200" />}

        {tab === 'common' && !q.isLoading && (
          <div className="border border-slate-200 rounded">
            <TargetHead grid={GRID_COMMON} />
            <div className="divide-y divide-slate-100">
              {shown.map(d => (
                <div key={d.id} ref={d.id === focusId ? focusRef : undefined}
                  className={`px-3 py-2 ${GRID_COMMON} ${d.id === focusId ? 'bg-sky-50 ring-1 ring-inset ring-sky-300' : ''}`}>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-800 flex items-center gap-1"><span className="truncate">{d.name}</span> <KpiInfoTip def={d} /></div>
                    <div className="text-[10px] text-slate-500">{d.unit} · {DIR_HINT[d.dir]}</div>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-3 sm:mt-0 sm:contents">
                    {editing
                      ? <TargetCells d={d} v={common[d.id] ?? emptyVals(d)} onChange={(i, val) => setCommonVal(d.id, i, val)} />
                      : <TargetCells d={d} t={commonOf(d)} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'wh' && wh && !q.isLoading && (
          <div className="border border-slate-200 rounded">
            <TargetHead grid={GRID_WH} scope />
            <div className="divide-y divide-slate-100">
              {shown.map(d => {
                const r = own[d.id] ?? { mode: 'common' as WhRowMode, v: [] }
                const isOwn = editing ? r.mode === 'own' : ownOf(d) !== undefined
                return (
                  <div key={d.id} ref={d.id === focusId ? focusRef : undefined}
                    className={`px-3 py-2 ${GRID_WH} ${d.id === focusId ? 'bg-sky-50 ring-1 ring-inset ring-sky-300' : isOwn ? 'bg-amber-50/40' : ''}`}>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-800 flex items-center gap-1"><span className="truncate">{d.name}</span> <KpiInfoTip def={d} /></div>
                      <div className="text-[10px] text-slate-500 truncate">{isOwn ? `Chung: ${targetText(d, commonOf(d))}` : `${d.unit} · ${DIR_HINT[d.dir]}`}</div>
                    </div>
                    <div className="mt-1.5 sm:mt-0">
                      {editing
                        ? <select value={r.mode} onChange={e => setOwnMode(d, e.target.value as WhRowMode)} className="h-7 w-full rounded border border-slate-200 bg-white text-[11px] px-1.5">
                            <option value="common">Theo mục tiêu chung</option>
                            <option value="own">Mục tiêu riêng</option>
                          </select>
                        : <StatusBadge tone={isOwn ? 'amber' : 'slate'} className="!text-[9px] !px-1.5">{isOwn ? 'Riêng kho' : 'Theo chung'}</StatusBadge>}
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-3 sm:mt-0 sm:contents">
                      {editing && r.mode === 'own'
                        ? <TargetCells d={d} v={r.v} onChange={(i, val) => setOwnVal(d.id, i, val)} />
                        : <TargetCells d={d} t={isOwn ? (ownOf(d) ?? null) : commonOf(d)} muted={!isOwn} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </FormSheet>
  )
}

// ── Form DIỄN GIẢI KPI — câu ý nghĩa trong nút ⓘ, SỬA ĐƯỢC TRONG APP (user chốt 09/09:
//   "phần diễn giải info này cần được sửa trên app khi cần"). Cùng nếp với form Mục tiêu:
//   mặc định chỉ xem, một nút "Sửa", Huỷ nạp lại từ máy chủ, Lưu xong về chế độ xem.
//   Xoá trắng một ô = KPI đó quay lại câu gốc trong sổ (không lưu chuỗi rỗng).
function KpiMeaningSheet({ open, onClose, canEdit, focusId }: {
  open: boolean; onClose: () => void; canEdit: boolean; focusId?: string | null
}) {
  const q = useKpiMeanings(open)
  const save = useSaveKpiMeanings()
  const [editing, setEditing] = useState(false)
  const [txt, setTxt] = useState<Record<string, string>>({})
  const [group, setGroup] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const focusRef = useRef<HTMLDivElement>(null)

  const rows = q.data?.defs ?? []
  const groups = q.data?.groups ?? []
  const shown = rows.filter(d => !group || d.group === group)

  const load = useCallback(() => {
    if (!q.data) return
    setTxt(Object.fromEntries(q.data.defs.map(d => [d.id, d.meaning])))
  }, [q.data])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (open) { setEditing(!!focusId && canEdit); setErr(null); setGroup('') } }, [open, focusId, canEdit])
  useEffect(() => { if (open && focusId) setTimeout(() => focusRef.current?.scrollIntoView({ block: 'center' }), 250) }, [open, focusId, q.data])

  async function onSave() {
    setErr(null)
    const body: Record<string, string> = {}
    for (const d of rows) {
      const v = (txt[d.id] ?? '').trim()
      if (!v || v === d.meaning_default) continue   // giống câu gốc → không lưu ghi đè
      if (v.length > 600) { setErr(`${d.name}: diễn giải tối đa 600 ký tự`); return }
      body[d.id] = v
    }
    try { await save.mutateAsync(body); setEditing(false) }
    catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được diễn giải — thử lại.') }
  }

  return (
    <FormSheet open={open} onClose={onClose} title="Diễn giải KPI" widthClass="sm:max-w-2xl"
      description="Câu ý nghĩa hiện trong nút ⓘ trên từng ô KPI. Sửa cho hợp cách gọi của đơn vị mình."
      footer={editing ? (<>
        <Button variant="outline" onClick={() => { load(); setEditing(false); setErr(null) }} disabled={save.isPending}>Huỷ</Button>
        <Button onClick={onSave} disabled={save.isPending || q.isLoading}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>) : <Button variant="outline" onClick={onClose}>Đóng</Button>}>
      <div className="space-y-3">
        <div className="flex items-center gap-1 flex-wrap">
          <button type="button" onClick={() => setGroup('')} className={`h-6 px-2 rounded text-[10px] font-medium border ${!group ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>Tất cả</button>
          {groups.map(g => <button key={g.key} type="button" onClick={() => setGroup(g.key)} className={`h-6 px-2 rounded text-[10px] font-medium border ${group === g.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>{g.label}</button>)}
          <span className="flex-1" />
          {!editing && canEdit && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setErr(null); setEditing(true) }}>
              <Pencil className="h-3.5 w-3.5" /> Sửa
            </Button>
          )}
          <InfoTip className="ml-1" tip={
            <div className="space-y-1 text-left">
              <div>Câu này chỉ để NGƯỜI ĐỌC hiểu KPI, không đụng tới phép tính. Dòng "Cách tính" bên dưới mỗi ô là do hệ thống sinh từ công thức đang chạy nên không sửa được.</div>
              <div>Xoá trắng một ô rồi Lưu = KPI đó quay lại câu gốc của hệ thống.</div>
            </div>
          } />
        </div>
        {!canEdit && <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Bạn không có quyền sửa diễn giải KPI (cần quyền <b>Sửa diễn giải KPI</b> ở Dashboard).</div>}
        {err && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</div>}
        {q.isLoading && <Skeleton className="h-40 w-full bg-slate-200" />}
        <div className="divide-y divide-slate-100 border border-slate-200 rounded">
          {shown.map(d => {
            const cur = (txt[d.id] ?? '').trim()
            const changed = editing ? cur !== d.meaning_default : d.custom
            return (
              <div key={d.id} ref={d.id === focusId ? focusRef : undefined}
                className={`px-3 py-2 space-y-1 ${d.id === focusId ? 'bg-sky-50 ring-1 ring-inset ring-sky-300' : ''}`}>
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium text-slate-800 flex-1 min-w-0 truncate">#{d.no} · {d.name}</div>
                  {changed && <StatusBadge tone="amber" className="!text-[9px] !px-1.5 shrink-0">đã sửa</StatusBadge>}
                  {editing && changed && (
                    <button type="button" onClick={() => setTxt(t => ({ ...t, [d.id]: d.meaning_default }))}
                      className="text-[10px] text-sky-600 hover:underline underline-offset-2 shrink-0">Về câu gốc</button>
                  )}
                </div>
                {editing
                  ? <textarea value={txt[d.id] ?? ''} onChange={e => setTxt(t => ({ ...t, [d.id]: e.target.value }))} rows={2} maxLength={600}
                      placeholder={d.meaning_default || 'Nhập diễn giải…'}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] leading-snug text-slate-700 outline-none focus:border-sky-400 resize-y" />
                  : <div className="text-[11px] leading-snug text-slate-600">{d.meaning || <span className="text-slate-300">chưa có diễn giải</span>}</div>}
                <div className="text-[10px] text-slate-400 leading-snug"><b>Cách tính:</b> {d.formula}</div>
              </div>
            )
          })}
        </div>
      </div>
    </FormSheet>
  )
}

// ── Đèn tổng bấm được = bộ lọc thẻ theo đèn (09/09) — khai ở module để không remount (ratchet component_defined_inside_component) ──
type RagPick = '' | 'G' | 'Y' | 'R' | 'none'
function RagPill({ k, tone, label, cur, onPick }: { k: RagPick; tone: BadgeTone; label: string; cur: RagPick; onPick: (v: RagPick) => void }) {
  const active = cur === k
  return (
    <button type="button" onClick={() => onPick(active ? '' : k)} aria-pressed={active}
      title={active ? 'Bấm lại để bỏ lọc' : 'Bấm để chỉ hiện các KPI này'}
      className={`rounded-full transition-shadow ${active ? 'ring-2 ring-sky-500 ring-offset-1' : cur ? 'opacity-50 hover:opacity-100' : 'hover:ring-1 hover:ring-slate-300'}`}>
      <StatusBadge tone={tone}>{label}</StatusBadge>
    </button>
  )
}

// ── Tab chính ─────────────────────────────────────────────────────────────────────────────────
export function DashboardKpi({ warehouseId }: { warehouseId: string }) {
  const f = useWmsFilterStore(s => s.dashboard)
  const setDashboard = useWmsFilterStore(s => s.setDashboard)
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canTarget = can(perms, 'dashboard', 'kpi_target')
  const canNote = can(perms, 'dashboard', 'kpi_note')
  const canGlobal = isAdmin(user) || user?.warehouse_scope === 'NATIONAL'
  const { data: scopedWhs = [] } = useScopedWarehouses(true)

  const grain = asGrain(f.kpiGrain)
  const dflt = defaultRange(grain)
  const from = f.kpiFrom || dflt.from
  const to = f.kpiTo || dflt.to
  // Trần số kỳ theo chu kỳ (2 năm tròn theo tuần/tháng/năm; theo NGÀY chỉ 3 tháng — đọc 700 điểm không ai đọc được)
  const nBuckets = bucketStarts(grain, from, to).length
  const tooMany = nBuckets > MAX_BUCKETS[grain]
  // 09/09 user: đã có Ngày–Tháng–Năm thì không cần chip Kỳ/So sánh trên thanh lọc — so kỳ chỉ còn trong dialog phóng to
  const q = useWarehouseKpi({ warehouseId, from, to, compare: '' }, !tooMany)
  const s = useWarehouseKpiSeries({ warehouseId, grain, from, to, compare: '' }, !tooMany)
  const d = q.data
  const [sheet, setSheet] = useState<{ open: boolean; focusId: string | null }>({ open: false, focusId: null })
  const [note, setNote] = useState<{ open: boolean; focusId: string | null }>({ open: false, focusId: null })
  const [expanded, setExpanded] = useState<KpiDefPublic | null>(null)
  // Bấm thẳng vào đèn tổng để LỌC thẻ (09/09): '' = tất cả · G/Y/R · 'none' = chưa có dữ liệu / chưa mục tiêu
  const [ragFilter, setRagFilter] = useState<RagPick>('')

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
  const grainWord = GRAIN_LABEL[grain]

  return (
    <div className="space-y-3">
      {/* MỘT hàng bộ lọc — chu kỳ · Từ–Đến theo chu kỳ · mục tiêu (không còn chip Kỳ / So sánh — user 09/09) */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 px-2.5 py-1.5 flex flex-wrap items-center gap-2">
        <GrainPills value={grain} onChange={g => { const r = defaultRange(g); setDashboard({ kpiGrain: g, kpiFrom: r.from, kpiTo: r.to }) }} />
        <GrainRange grain={grain} from={from} to={to} onChange={(a, b) => setDashboard({ kpiFrom: a, kpiTo: b })} />
        <span className="flex-1 min-w-2" />
        <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
          {formatDate(from)} – {formatDate(to)} · {dayCount(from, to)} ngày · {nBuckets} {grainWord}
        </span>
        {canNote && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setNote({ open: true, focusId: null })}>
            <BookOpen className="h-3.5 w-3.5" /> Diễn giải
          </Button>
        )}
        {canTarget && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setSheet({ open: true, focusId: null })}>
            <Settings2 className="h-3.5 w-3.5" /> Mục tiêu
          </Button>
        )}
      </div>
      {tooMany && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Khoảng đang chọn là <b>{nBuckets} {grainWord}</b> — tối đa <b>{MAX_BUCKETS[grain]} {grainWord}</b> trên một biểu đồ{grain === 'day' ? ' (xem dài hơn 3 tháng hãy đổi sang Tuần hoặc Tháng)' : ' (tròn 2 năm)'}.</span>
          <button type="button" className="text-sky-700 font-medium underline-offset-2 hover:underline"
            onClick={() => { const r = defaultRange(grain); setDashboard({ kpiFrom: r.from, kpiTo: r.to }) }}>Về khoảng mặc định</button>
        </div>
      )}

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
          <button type="button" onClick={() => setRagFilter('')} className={`text-slate-600 dark:text-slate-300 ${ragFilter ? 'underline underline-offset-2 hover:text-sky-700' : ''}`}
            title={ragFilter ? 'Bấm để hiện lại tất cả' : ''}>
            <b>{d.kpis.length}</b>/{d.kpis.length + d.unavailable.length} KPI đo được
          </button>
          <RagPill k="G" tone="green" label={`${counts.G} đạt`} cur={ragFilter} onPick={setRagFilter} />
          <RagPill k="Y" tone="amber" label={`${counts.Y} cần chú ý`} cur={ragFilter} onPick={setRagFilter} />
          <RagPill k="R" tone="red" label={`${counts.R} không đạt`} cur={ragFilter} onPick={setRagFilter} />
          <RagPill k="none" tone="slate" label={`${counts.none} chưa có dữ liệu / chưa đặt mục tiêu`} cur={ragFilter} onPick={setRagFilter} />
          {ragFilter
            ? <span className="text-sky-700 dark:text-sky-400 font-medium">Đang lọc: {ragFilter === 'none' ? 'chưa có dữ liệu / chưa đặt mục tiêu' : RAG_LABEL[ragFilter].toLowerCase()} · <button type="button" className="underline underline-offset-2" onClick={() => setRagFilter('')}>bỏ lọc</button></span>
            : <span className="text-slate-500">· bấm vào đèn để lọc · số lớn = cả khoảng đã chọn · đường = theo từng {grainWord}</span>}
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
        const all = d.kpis.filter(k => defById.get(k.id)?.group === g.key)
        const ks = ragFilter ? all.filter(k => ragKey(k.rag) === ragFilter) : all
        // KPI chưa có nguồn chỉ hiện khi không lọc hoặc lọc "chưa có dữ liệu"
        const un = (!ragFilter || ragFilter === 'none') ? d.unavailable.filter(u => u.group === g.key) : []
        if (!ks.length && !un.length) return null
        const gc = { G: 0, Y: 0, R: 0, none: 0 }
        for (const k of all) gc[ragKey(k.rag) as keyof typeof gc]++
        return (
          <DashPanel key={g.key} title={g.label} icon={Target} extra={<>
            {/* Tiêu đề nhóm phải đọc ra ngay: bao nhiêu đo được, đèn ra sao, bao nhiêu chưa có nguồn (user 09/09) */}
            <span className="ml-1 flex items-center gap-1.5 flex-wrap">
              <StatusBadge tone="sky" className="!text-[10px] font-semibold">{all.length} đo được</StatusBadge>
              {gc.G > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"><span className="h-2 w-2 rounded-full bg-emerald-500" />{gc.G} đạt</span>}
              {gc.Y > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400"><span className="h-2 w-2 rounded-full bg-amber-500" />{gc.Y} chú ý</span>}
              {gc.R > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 dark:text-red-400"><span className="h-2 w-2 rounded-full bg-red-500" />{gc.R} không đạt</span>}
              {gc.none > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500"><span className="h-2 w-2 rounded-full bg-slate-300" />{gc.none} chưa có số</span>}
              {d.unavailable.filter(u => u.group === g.key).length > 0 && (
                <StatusBadge tone="slate" className="!text-[10px] font-semibold border border-dashed border-slate-300">{d.unavailable.filter(u => u.group === g.key).length} chưa có nguồn</StatusBadge>
              )}
            </span>
          </>}>
            <div className={`p-2 grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 ${s.isFetching && s.data ? 'opacity-90' : ''}`}>
              {ks.map(k => {
                const def = defById.get(k.id)!
                return <KpiCard key={k.id} def={def} k={k} canTarget={canTarget}
                  points={def.snapshot ? null : (s.data ? seriesPoints(grain, s.data.buckets, s.data.compare?.buckets, def.id) : null)}
                  onExpand={() => setExpanded(def)} onSetTarget={() => setSheet({ open: true, focusId: def.id })}
                  onEditNote={canNote ? () => setNote({ open: true, focusId: def.id }) : undefined} />
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

      <KpiChartDialog def={expanded} warehouseId={warehouseId} init={{ grain, from, to, compare: '' }} onClose={() => setExpanded(null)}
        onEditNote={canNote && expanded ? () => setNote({ open: true, focusId: expanded.id }) : undefined} />
      {canTarget && (
        <KpiTargetSheet open={sheet.open} focusId={sheet.focusId} onClose={() => setSheet({ open: false, focusId: null })} warehouseId={warehouseId}
          warehouses={scopedWhs as { id: string; code?: string; name: string }[]} canGlobal={canGlobal} />
      )}
      <KpiMeaningSheet open={note.open} focusId={note.focusId} canEdit={canNote} onClose={() => setNote({ open: false, focusId: null })} />
    </div>
  )
}
