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
// 11/2026 — phong cách "trung tâm điều hành" (mẫu Du lieu mau/ui kpi): khung .kpi-console (Montserrat + bộ màu riêng ở index.css),
//   hàng đầu = sức khoẻ KPI · nhóm · lệch nhiều nhất; hàng 2 = xu hướng + so sánh kho của KPI đang soi; hàng 3 = bản đồ nhiệt + sức chứa.
//   Mọi biểu đồ mới đọc đúng 2 payload đã có (/kpi + /kpi/series) — KHÔNG thêm request nào.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CircleDashed, Settings2, Maximize2, Table2, Pencil, BookOpen } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DASH_SK } from '@/components/wms/DashboardPanel'
import { GroupStack, KpiHeatmap, KpiPanel, RagDonut, TickGauge, WarehouseRank, type GroupRow, type RagKey } from '@/components/wms/KpiCharts'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { kpiGap, lastDelta } from '@/utils/kpiView'
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
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'

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
  const cls = 'h-9 rounded-[10px] text-xs min-w-0 flex-1 sm:flex-none sm:w-40 px-2'
  if (grain === 'day') return (
    <div className="flex items-center gap-1 min-w-0 w-full sm:w-auto">
      <Input type="date" value={from} onChange={e => e.target.value && onChange(e.target.value, to < e.target.value ? e.target.value : to)} className={cls} />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="date" value={to} onChange={e => e.target.value && onChange(from > e.target.value ? e.target.value : from, e.target.value)} className={cls} />
    </div>
  )
  if (grain === 'week') return (
    <div className="flex items-center gap-1 min-w-0 w-full sm:w-auto" title="Tuần ISO — thứ Hai đầu tuần">
      <Input type="week" value={toWeekInput(from)} onChange={e => { const m = /^(\d{4})-W(\d{2})$/.exec(e.target.value); if (!m) return; const f = isoWeekMonday(Number(m[1]), Number(m[2])); onChange(f, to < f ? addDays(f, 6) : to) }} className={cls} />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="week" value={toWeekInput(to)} onChange={e => { const m = /^(\d{4})-W(\d{2})$/.exec(e.target.value); if (!m) return; const t = addDays(isoWeekMonday(Number(m[1]), Number(m[2])), 6); onChange(from > t ? addDays(t, -6) : from, t) }} className={cls} />
    </div>
  )
  if (grain === 'month') return (
    <div className="flex items-center gap-1 min-w-0 w-full sm:w-auto">
      <Input type="month" value={from.slice(0, 7)} onChange={e => { if (!/^\d{4}-\d{2}$/.test(e.target.value)) return; const f = `${e.target.value}-01`; onChange(f, to < f ? monthEnd(f) : to) }} className={cls} />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="month" value={to.slice(0, 7)} onChange={e => { if (!/^\d{4}-\d{2}$/.test(e.target.value)) return; const t = monthEnd(`${e.target.value}-01`); onChange(from > t ? `${e.target.value}-01` : from, t) }} className={cls} />
    </div>
  )
  return (
    <div className="flex items-center gap-1">
      <Input type="number" min={2020} max={2100} value={from.slice(0, 4)} onChange={e => { const y = Number(e.target.value); if (y < 2000 || y > 2100) return; const f = `${y}-01-01`; onChange(f, to < f ? `${y}-12-31` : to) }} className="h-9 rounded-[10px] text-xs w-24 px-2" />
      <span className="text-slate-400 text-[11px]">→</span>
      <Input type="number" min={2020} max={2100} value={to.slice(0, 4)} onChange={e => { const y = Number(e.target.value); if (y < 2000 || y > 2100) return; const t = `${y}-12-31`; onChange(from > t ? `${y}-01-01` : from, t) }} className="h-9 rounded-[10px] text-xs w-24 px-2" />
    </div>
  )
}
function GrainPills({ value, onChange }: { value: KpiGrain; onChange: (g: KpiGrain) => void }) {
  return (
    <div className="flex shrink-0 rounded-[10px] border border-[var(--k-line)] overflow-hidden bg-[var(--k-surface)] text-xs font-semibold">
      {GRAINS.map(g => (
        <button key={g.key} type="button" onClick={() => onChange(g.key)}
          className={`px-3 h-9 ${value === g.key ? 'bg-[var(--k-brand)] text-white' : 'text-[var(--k-muted)] hover:bg-[var(--k-surface-2)]'}`}>
          {g.label}
        </button>
      ))}
    </div>
  )
}

// ── Đèn ───────────────────────────────────────────────────────────────────────────────────────
const RAG_DOT: Record<string, string> = { G: 'bg-[var(--k-ok)]', Y: 'bg-[var(--k-warn)]', R: 'bg-[var(--k-bad)]', none: 'bg-[var(--k-none)]' }
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
  if (!t) return <div className="h-2.5 my-1 rounded-full bg-[var(--k-surface-2)]" />
  const max = def.unit === '%' ? 100 : Math.max(1e-9, k.value ?? 0, ...t) * 1.15
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`
  const G = 'bg-emerald-500/25', Y = 'bg-amber-500/25', R = 'bg-red-500/20'
  const segs: Array<[number, number, string]> = def.dir === 'up' ? [[0, t[1], R], [t[1], t[0], Y], [t[0], max, G]]
    : def.dir === 'down' ? [[0, t[0], G], [t[0], t[1], Y], [t[1], max, R]]
    : [[0, t[0], Y], [t[0], t[1], G], [t[1], t[2], Y], [t[2], max, R]]
  return (
    <div className="relative h-2.5 my-1 rounded-full overflow-hidden bg-[var(--k-surface-2)]" title={targetText(def, t)}>
      {segs.map(([a, b, c], i) => b > a && <span key={i} className={`absolute top-0 bottom-0 ${c}`} style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />)}
      {k.value != null && <span className="absolute top-0 bottom-0 w-[3px] -ml-px rounded-sm bg-[var(--k-ink)]" style={{ left: pct(k.value) }} />}
    </div>
  )
}

function seriesPoints(grain: KpiGrain, buckets: KpiBucket[] | undefined, prev: KpiBucket[] | undefined, id: string): ChartPoint[] {
  return (buckets ?? []).map((b, i) => ({ key: b.key, label: bucketLabel(grain, b.key), value: b.values[id] ?? null, prev: prev ? (prev[i]?.values[id] ?? null) : undefined, from: b.from, to: b.to }))
}

// ── Thẻ KPI ───────────────────────────────────────────────────────────────────────────────────
/** So hai kỳ gần nhất có số — tô theo CHIỀU TỐT, không theo dấu (cùng luật với Delta). */
function TrendDelta({ def, points }: { def: KpiDefPublic; points: ChartPoint[] | null }) {
  const d = points ? lastDelta(points) : null
  if (!d) return <span />
  const flat = Math.abs(d.delta) < Math.pow(10, -def.decimals) / 2
  const up = d.delta > 0
  const good = flat || def.dir === 'band' ? null : (up === (def.dir === 'up'))
  const cls = good == null ? 'text-[var(--k-muted)]' : good ? 'text-[var(--k-ok)]' : 'text-[var(--k-bad)]'
  return (
    <span className="whitespace-nowrap" title={`${d.label}: ${fmtValue(def, d.curr)} · ${d.prevLabel}: ${fmtValue(def, d.prev)}`}>
      <b className={`font-semibold tabular-nums ${cls}`}>{flat ? '≈' : up ? '▲' : '▼'} {fmtNum(Math.abs(d.delta), def.decimals)}{def.unit === '%' ? ' điểm' : ''}</b>
      {' '}so {d.prevLabel}
    </span>
  )
}

function KpiCard({ def, k, points, canTarget, onExpand, onSetTarget, onEditNote }: {
  def: KpiDefPublic; k: KpiValue; points: ChartPoint[] | null; canTarget: boolean
  onExpand: () => void; onSetTarget: () => void; onEditNote?: () => void
}) {
  const r = ragKey(k.rag)
  const noData = k.value == null
  const valueText = fmtValue(def, k.value)
  return (
    <div className="k-card flex flex-col gap-1.5 px-4 pt-3.5 pb-3">
      <div className="flex items-start gap-1.5">
        <div className="flex-1 min-w-0 text-[13px] font-semibold leading-snug">
          {def.name}{def.snapshot && <span className="ml-1 text-[11px] font-medium text-[var(--k-muted)]">· hiện tại</span>}
        </div>
        <KpiInfoTip def={def} onEdit={onEditNote} />
        {!def.snapshot && (
          <button type="button" onClick={onExpand} title="Phóng to biểu đồ" aria-label={`Phóng to ${def.name}`}
            className="h-6 w-6 -mr-1 rounded-md text-[var(--k-muted)] hover:text-[var(--k-data)] hover:bg-[var(--k-surface-2)] flex items-center justify-center shrink-0">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className={`${valueText.length > 9 ? 'text-xl' : 'text-[28px]'} font-semibold leading-tight tracking-tight tabular-nums whitespace-nowrap ${noData ? 'text-[var(--k-none)]' : ''}`}>{valueText}</span>
        {!noData && def.unit !== '%' && <span className="text-xs font-medium text-[var(--k-muted)] whitespace-nowrap">{def.unit}</span>}
        {!noData && k.rag && <StatusBadge tone={RAG_TONE[r]} title={`Mục tiêu ${SRC_LABEL[k.t_source]}`} className="!rounded-md !text-[11px] !px-2 ml-auto shrink-0 self-center">{RAG_LABEL[r]}</StatusBadge>}
      </div>
      {k.sub && <div className="-mt-1 truncate text-[11px] text-[var(--k-muted)]" title={k.sub}>{k.sub}</div>}
      {/* Theo kỳ → biểu đồ đường nhỏ · ảnh chụp → thanh mục tiêu */}
      {def.snapshot
        ? <TargetBar def={def} k={k} />
        : points && points.length > 0
          ? <KpiLineChart def={def} points={points} target={k.t} compact />
          : <div className="h-[52px] rounded-lg bg-[var(--k-surface-2)]" />}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] leading-tight text-[var(--k-muted)]">
        {noData ? <span>chưa có dữ liệu trong kỳ</span> : <TrendDelta def={def} points={points} />}
        {k.t
          ? <span className="shrink-0 tabular-nums" title={`Mục tiêu ${SRC_LABEL[k.t_source]} · ${DIR_HINT[def.dir]}`}>{targetShort(def, k.t)}</span>
          : canTarget
            ? <button type="button" onClick={onSetTarget} className="shrink-0 text-[var(--k-data)] font-semibold underline-offset-2 hover:underline">Đặt mục tiêu</button>
            : <span className="shrink-0 italic">chưa đặt mục tiêu</span>}
      </div>
      {noData && (
        <div className="text-[11px] leading-snug rounded-lg bg-[var(--k-surface-2)] px-2 py-1.5">
          <b>Để có số:</b> {def.empty_hint}
        </div>
      )}
      {!noData && def.note && <div className="truncate text-[11px] leading-tight text-amber-700 dark:text-amber-400" title={def.note}>{def.note}</div>}
    </div>
  )
}

function UnavailableCard({ u }: { u: { no: number; name: string; need: string } }) {
  return (
    <div className="rounded-[14px] border border-dashed border-[var(--k-none)] px-4 py-3">
      <div className="flex items-start gap-1.5 text-[13px] font-semibold leading-snug text-[var(--k-muted)]"><CircleDashed className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {u.name}</div>
      <div className="mt-1 text-[11px] leading-snug text-[var(--k-muted)]"><b>Chưa có nguồn — cần:</b> {u.need}</div>
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
      <DialogContent onOpenAutoFocus={e => e.preventDefault()} className="kpi-console w-[96vw] max-w-[96vw] h-[92dvh] sm:w-[80vw] sm:max-w-[80vw] sm:h-[80vh] max-h-none p-0 gap-0 flex flex-col overflow-hidden">
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
              <select value={compare} onChange={e => setCompare(e.target.value)} className="h-9 rounded-[10px] border border-[var(--k-line)] bg-[var(--k-surface)] text-xs px-2">
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
                      <div key={l} className="rounded-[10px] bg-[var(--k-surface-2)] px-3 py-2">
                        <div className="text-[11px] font-medium text-[var(--k-muted)]">{l}</div>
                        <div className="text-lg font-semibold leading-tight tabular-nums">{v}</div>
                        {s && <div className="text-[11px] text-[var(--k-muted)]">{s}</div>}
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
      <div>Bấm <b>Sửa</b> rồi đổi dòng cần khác sang <b>Mục tiêu riêng</b> — ô điền sẵn mục tiêu chung để bạn chỉnh. Chọn lại mục tiêu chung là bỏ ghi đè; mục tiêu riêng để trống cả hai ô = tắt đèn KPI đó ở kho này.</div>
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
                            <option value="common">Theo mục tiêu chung ({targetText(d, commonOf(d))})</option>
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

type RagPick = '' | RagKey

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
  // Có đèn = đo được VÀ có mục tiêu. Tỷ lệ đạt chỉ tính trên nhóm này, KPI chưa có đèn không kéo số xuống.
  const lit = counts.G + counts.Y + counts.R
  const okPct = lit > 0 ? (counts.G / lit) * 100 : null
  const groupRows: GroupRow[] = useMemo(() => (d?.groups ?? []).map(g => {
    const r: GroupRow = { key: g.key, label: g.label, G: 0, Y: 0, R: 0, none: 0, unavailable: d?.unavailable.filter(u => u.group === g.key).length ?? 0 }
    for (const k of d?.kpis ?? []) if (defById.get(k.id)?.group === g.key) r[ragKey(k.rag) as RagKey]++
    return r
  }), [d, defById])
  // KPI lệch mục tiêu nhiều nhất: đỏ trước vàng, trong cùng đèn thì lệch tương đối lớn hơn đứng trước
  const worst = useMemo(() => (d?.kpis ?? [])
    .filter(k => k.rag === 'R' || k.rag === 'Y')
    .map(k => { const def = defById.get(k.id)!; return { k, def, gap: kpiGap(def.dir, k.value, k.t) } })
    .sort((a, b) => (a.k.rag === b.k.rag ? (b.gap?.rel ?? 0) - (a.gap?.rel ?? 0) : a.k.rag === 'R' ? -1 : 1)), [d, defById])
  // KPI đang soi: người dùng chọn; chưa chọn thì KPI theo kỳ lệch nhiều nhất, không có thì KPI theo kỳ đầu tiên
  const periodsWithData = (id: string) => (s.data?.buckets ?? []).filter(b => b.values[id] != null).length
  const focusDef = (f.kpiFocus ? defById.get(f.kpiFocus) : undefined)
    ?? worst.find(x => !x.def.snapshot && periodsWithData(x.def.id) >= 2)?.def
    ?? worst.find(x => !x.def.snapshot)?.def ?? d?.defs.find(x => !x.snapshot) ?? null
  const focusKpi = focusDef ? d?.kpis.find(k => k.id === focusDef.id) : undefined
  const focusPoints = focusDef && s.data ? seriesPoints(grain, s.data.buckets, undefined, focusDef.id) : []
  const focusOpts = (d?.kpis ?? []).map(k => { const x = defById.get(k.id)!; return { value: x.id, label: x.name, sub: d?.groups.find(g => g.key === x.group)?.label } })
  const kpiOf = (id: string) => d?.kpis.find(k => k.id === id)
  const zone = kpiOf('util_zone'), zoneDef = defById.get('util_zone')
  const goGroup = (key: string) => { setRagFilter(''); setTimeout(() => document.getElementById(`kpi-group-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }
  const seriesErr = (s.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  const grainWord = GRAIN_LABEL[grain]

  const toolItems: ActionItem[] = []
  if (canNote) toolItems.push({ key: 'note', icon: BookOpen, label: 'Diễn giải', tip: 'Sửa câu diễn giải của từng KPI', onClick: () => setNote({ open: true, focusId: null }) })
  if (canTarget) toolItems.push({ key: 'target', icon: Settings2, label: 'Mục tiêu', tip: 'Đặt ngưỡng đèn xanh / vàng cho từng KPI', onClick: () => setSheet({ open: true, focusId: null }) })

  return (
    <div className="kpi-console space-y-3 sm:space-y-4">
      {/* MỘT hàng bộ lọc — chu kỳ · Từ–Đến theo chu kỳ · mục tiêu (không còn chip Kỳ / So sánh — user 09/09) */}
      <div className="k-card px-3 py-2.5 flex flex-wrap xl:flex-nowrap items-center gap-2">
        <GrainPills value={grain} onChange={g => { const r = defaultRange(g); setDashboard({ kpiGrain: g, kpiFrom: r.from, kpiTo: r.to }) }} />
        <GrainRange grain={grain} from={from} to={to} onChange={(a, b) => setDashboard({ kpiFrom: a, kpiTo: b })} />
        <span className="flex-1 min-w-0 truncate text-xs font-medium tabular-nums text-[var(--k-muted)] sm:text-right" title={`${formatDate(from)} – ${formatDate(to)}`}>
          {formatDate(from)} – {formatDate(to)} · {dayCount(from, to)} ngày · {nBuckets} {grainWord}
        </span>
        {toolItems.length > 0 && <ActionCluster items={toolItems} className="w-auto shrink-0" />}
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

      {n && (n.lines_no_weight > 0 || n.loc_uncapped > 0 || n.warehouses_no_labor > 0 || n.categories_filtered) && (
        <div className="rounded-[14px] border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
          {n.warehouses_no_labor > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{n.warehouses_no_labor} kho có hàng nhưng chưa chấm công</b> — các KPI theo giờ công của kho đó để trống. Ghi công ở màn Chấm công.</span></div>}
          {n.lines_no_weight > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{fmtNum(n.lines_no_weight, 0)} dòng hàng chưa khai khối lượng thùng</b> — không vào tấn (DOH, vòng quay, tấn/giờ thấp hơn thực). Khai ở Mã hàng › KL/thùng.</span></div>}
          {n.loc_uncapped > 0 && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span><b>{fmtNum(n.loc_uncapped, 0)} vị trí</b> chưa khai sức chứa hoặc khai quá 1.000 pallet ("không giới hạn") — bị loại khỏi % sử dụng chỗ và tràn chỗ. Khai ở trang Vị trí kho.</span></div>}
          {n.categories_filtered && <div className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /><span>Bạn chỉ được xem một phần Loại hàng: KPI theo tồn/thùng đã cắt theo quyền, KPI theo giờ công thì không tách được.</span></div>}
        </div>
      )}

      {q.isLoading && !d && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className={`h-[220px] rounded-[14px] ${DASH_SK}`} />)}</div>
      )}

      {d && (
        <>
          {/* Hàng 1 — đọc ra ngay: đạt bao nhiêu, nhóm nào yếu, KPI nào lệch nhất */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)] gap-3 sm:gap-4">
            <section className="k-card overflow-hidden flex flex-col">
              <div className="bg-[var(--k-brand)] px-4 sm:px-5 py-3.5 text-white">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[15px] font-semibold">Sức khoẻ KPI</h2>
                  <span className="text-[11px] font-medium text-white/75 whitespace-nowrap">{d.kpis.length}/{d.kpis.length + d.unavailable.length} KPI đo được</span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-[34px] font-semibold leading-none tracking-tight tabular-nums">{okPct == null ? '—' : `${fmtNum(okPct, 0)}%`}</span>
                  <span className="text-xs text-white/80">{lit > 0 ? `đạt · ${counts.G}/${lit} KPI có đèn` : 'chưa KPI nào có đèn'}</span>
                </div>
                <div className="mt-2.5 h-1.5 rounded-full bg-white/25 overflow-hidden"><div className="h-full rounded-full bg-white" style={{ width: `${okPct ?? 0}%` }} /></div>
              </div>
              <div className="flex-1 flex items-center px-4 sm:px-5 py-3">
                <RagDonut counts={counts} center={d.kpis.length} sub="KPI đo được" active={ragFilter} onPick={setRagFilter} />
              </div>
            </section>

            <KpiPanel title="Đèn theo nhóm" hint="bấm để tới nhóm">
              <GroupStack rows={groupRows} onPick={goGroup} />
            </KpiPanel>

            <KpiPanel title="Lệch mục tiêu nhiều nhất" hint="bấm để soi" className="md:col-span-2 xl:col-span-1">
              {worst.length === 0
                ? <p className="px-5 py-8 text-xs text-[var(--k-muted)]">Mọi KPI có đèn đều đang đạt mục tiêu.</p>
                : (
                  <ol className="px-2 sm:px-3 py-2">
                    {worst.slice(0, 6).map((x, i) => (
                      <li key={x.k.id}>
                        <button type="button" onClick={() => setDashboard({ kpiFocus: x.def.id })} aria-pressed={focusDef?.id === x.def.id}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--k-surface-2)] ${focusDef?.id === x.def.id ? 'bg-[var(--k-surface-2)]' : ''}`}>
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${RAG_DOT[ragKey(x.k.rag)]}`}>{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold" title={x.def.name}>{x.def.name}</span>
                            <span className="block truncate text-[11px] text-[var(--k-muted)]">{targetShort(x.def, x.k.t)}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-xs font-semibold tabular-nums">{fmtValue(x.def, x.k.value)}</span>
                            {x.gap && x.gap.side && <span className={`block text-[11px] font-medium tabular-nums ${x.k.rag === 'R' ? 'text-[var(--k-bad)]' : 'text-amber-700 dark:text-amber-400'}`}>{x.gap.side === 'short' ? 'thiếu' : 'vượt'} {fmtNum(x.gap.gap, x.def.decimals)}{x.def.unit === '%' ? ' điểm' : ''}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
            </KpiPanel>
          </div>

          {/* Hàng 2 — một KPI đang soi: đường theo kỳ + so giữa các kho */}
          {focusDef && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 sm:gap-4">
              <KpiPanel title="Xu hướng" right={<>
                <SingleSelect options={focusOpts} value={focusDef.id} onChange={v => v && setDashboard({ kpiFocus: v })} triggerClassName="h-9 w-[13rem] sm:w-[20rem] max-w-full" />
                {!focusDef.snapshot && (
                  <button type="button" onClick={() => setExpanded(focusDef)} title="Phóng to: bảng số, so kỳ, chu kỳ riêng" aria-label={`Phóng to ${focusDef.name}`}
                    className="h-9 w-9 shrink-0 rounded-[10px] border border-[var(--k-line)] text-[var(--k-muted)] hover:text-[var(--k-data)] flex items-center justify-center"><Maximize2 className="h-4 w-4" /></button>
                )}
              </>}>
                <div className="px-3 sm:px-4 py-3 space-y-2">
                  <div className="flex items-baseline gap-2 flex-wrap px-1">
                    <span className="text-2xl font-semibold tracking-tight tabular-nums">{fmtValue(focusDef, focusKpi?.value)}</span>
                    {focusDef.unit !== '%' && <span className="text-xs font-medium text-[var(--k-muted)]">{focusDef.unit}</span>}
                    {focusKpi?.rag && <StatusBadge tone={RAG_TONE[focusKpi.rag]} className="!rounded-md !text-[11px] !px-2">{RAG_LABEL[focusKpi.rag]}</StatusBadge>}
                    <span className="text-xs text-[var(--k-muted)]">{focusKpi?.sub ?? ''}</span>
                    <span className="ml-auto text-xs tabular-nums text-[var(--k-muted)]">{targetShort(focusDef, focusKpi?.t ?? null)}</span>
                  </div>
                  {focusDef.snapshot
                    ? (
                      <div className="px-1 py-6">
                        {focusKpi && <TargetBar def={focusDef} k={focusKpi} />}
                        <p className="mt-2 text-xs text-[var(--k-muted)]">KPI này là ảnh chụp tồn hiện tại nên không có đường theo kỳ. {targetText(focusDef, focusKpi?.t ?? null)}.</p>
                      </div>
                    )
                    : s.isError
                      ? <p className="px-1 py-10 text-xs text-[var(--k-muted)]">Biểu đồ chưa vẽ được — {seriesErr ?? 'thu hẹp khoảng hoặc đổi chu kỳ lớn hơn'}.</p>
                      : !s.data
                        ? <Skeleton className={`h-[260px] w-full rounded-lg ${DASH_SK}`} />
                        : focusPoints.some(p => p.value != null)
                          ? (
                            <div className={s.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
                              <KpiLineChart def={focusDef} points={focusPoints} target={focusKpi?.t ?? null} height={260} grain={grain} />
                              <div className="mt-1 px-1"><KpiChartLegend hasPrev={false} /></div>
                            </div>
                          )
                          : <p className="px-1 py-10 text-xs text-[var(--k-muted)]">Chưa có số theo kỳ trong khoảng này. {focusDef.empty_hint}</p>}
                </div>
              </KpiPanel>
              <KpiPanel title="So sánh kho" hint={focusDef.short}>
                <WarehouseRank def={focusDef} rows={d.by_warehouse.map(w => ({ id: w.warehouse_id, name: w.warehouse_name, k: w.kpis.find(k => k.id === focusDef.id) }))} />
              </KpiPanel>
            </div>
          )}

          {/* Hàng 3 — mọi KPI × mọi kỳ + sức chứa hiện tại */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 sm:gap-4">
            <KpiPanel title="Bản đồ đèn theo kỳ" hint={`mỗi ô một ${grainWord} · bấm để phóng to`}>
              {s.data
                ? <div className={s.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
                    <KpiHeatmap defs={d.defs.filter(x => !x.snapshot)} buckets={s.data.buckets} targets={s.data.targets} grain={grain} onOpen={setExpanded} />
                  </div>
                : s.isError
                  ? <p className="px-5 py-8 text-xs text-[var(--k-muted)]">Bản đồ chưa vẽ được — {seriesErr ?? 'thu hẹp khoảng hoặc đổi chu kỳ lớn hơn'}.</p>
                  : <div className="p-4"><Skeleton className={`h-[260px] w-full rounded-lg ${DASH_SK}`} /></div>}
            </KpiPanel>
            {zone && zoneDef && (
              <KpiPanel title="Sức chứa" hint="hiện tại" right={zone.rag ? <StatusBadge tone={RAG_TONE[zone.rag]} className="!rounded-md !text-[11px] !px-2">{RAG_LABEL[zone.rag]}</StatusBadge> : undefined}>
                <div className="flex h-full flex-col justify-center px-4 sm:px-5 py-3">
                  <TickGauge value={zone.value} label={fmtValue(zoneDef, zone.value)} sub={zone.sub ?? zoneDef.short} marks={zone.t?.slice(0, 2) ?? []} />
                  <p className="-mt-3 text-center text-xs font-medium text-[var(--k-muted)]">{zoneDef.name} · {targetShort(zoneDef, zone.t)}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {['util_pos', 'empty_loc', 'overflow'].map(id => {
                      const x = defById.get(id), k = kpiOf(id)
                      if (!x || !k) return null
                      return (
                        <div key={id} className="min-w-0 rounded-[10px] bg-[var(--k-surface-2)] px-2.5 py-2" title={`${x.name}${k.sub ? `: ${k.sub}` : ''}`}>
                          <div className="truncate text-[11px] font-medium text-[var(--k-muted)]">{x.short}</div>
                          <div className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${RAG_DOT[ragKey(k.rag)]}`} />{fmtValue(x, k.value)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </KpiPanel>
            )}
          </div>

          {/* Từng KPI theo nhóm — thẻ nằm thẳng trên nền, tiêu đề nhóm đọc ra đèn */}
          {ragFilter && (
            <div className="text-xs font-medium text-[var(--k-muted)]">
              Đang lọc thẻ: {ragFilter === 'none' ? 'chưa có đèn' : RAG_LABEL[ragFilter].toLowerCase()} · <button type="button" className="font-semibold text-[var(--k-data)] underline underline-offset-2" onClick={() => setRagFilter('')}>bỏ lọc</button>
            </div>
          )}
          {d.groups.map(g => {
            const all = d.kpis.filter(k => defById.get(k.id)?.group === g.key)
            const ks = ragFilter ? all.filter(k => ragKey(k.rag) === ragFilter) : all
            // KPI chưa có nguồn chỉ hiện khi không lọc hoặc lọc "chưa có đèn"
            const un = (!ragFilter || ragFilter === 'none') ? d.unavailable.filter(u => u.group === g.key) : []
            if (!ks.length && !un.length) return null
            const gc = groupRows.find(r => r.key === g.key)!
            return (
              <section key={g.key} id={`kpi-group-${g.key}`} className="scroll-mt-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-2 pt-1">
                  <h2 className="text-[15px] font-semibold">{g.label}</h2>
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-medium text-[var(--k-muted)]">
                    <span>{all.length} đo được</span>
                    {gc.G > 0 && <span className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${RAG_DOT.G}`} />{gc.G} đạt</span>}
                    {gc.Y > 0 && <span className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${RAG_DOT.Y}`} />{gc.Y} chú ý</span>}
                    {gc.R > 0 && <span className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${RAG_DOT.R}`} />{gc.R} không đạt</span>}
                    {gc.none > 0 && <span className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${RAG_DOT.none}`} />{gc.none} chưa có đèn</span>}
                    {gc.unavailable > 0 && <span>· {gc.unavailable} chưa có nguồn</span>}
                  </span>
                </div>
                <div className="grid grid-cols-1 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {ks.map(k => {
                    const def = defById.get(k.id)!
                    return <KpiCard key={k.id} def={def} k={k} canTarget={canTarget}
                      points={def.snapshot ? null : (s.data ? seriesPoints(grain, s.data.buckets, s.data.compare?.buckets, def.id) : null)}
                      onExpand={() => setExpanded(def)} onSetTarget={() => setSheet({ open: true, focusId: def.id })}
                      onEditNote={canNote ? () => setNote({ open: true, focusId: def.id }) : undefined} />
                  })}
                  {un.map(u => <UnavailableCard key={u.no} u={u} />)}
                </div>
              </section>
            )
          })}

          <KpiPanel title="KPI theo kho" hint={`${d.by_warehouse.length} kho có số liệu · đèn theo mục tiêu riêng kho nếu có`} right={
            <select value={tableGroup} onChange={e => setDashboard({ kpiGroup: e.target.value })} aria-label="Nhóm KPI"
              className="h-9 rounded-[10px] border border-[var(--k-line)] bg-[var(--k-surface)] px-2 text-xs font-medium">
              {d.groups.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          }>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-[var(--k-surface)] px-4 py-2 text-xs font-medium text-[var(--k-muted)] whitespace-nowrap">Kho</th>
                    {tableDefs.map(x => <th key={x.id} className="px-3 py-2 text-right text-xs font-medium text-[var(--k-muted)] whitespace-nowrap" title={`${x.name} (${x.unit})`}>{x.short}</th>)}
                  </tr>
                  <tr className="border-t border-[var(--k-line)] bg-[var(--k-surface-2)]">
                    <th className="sticky left-0 z-10 bg-[var(--k-surface-2)] px-4 py-1.5 text-[11px] font-medium text-[var(--k-muted)] whitespace-nowrap">Mục tiêu</th>
                    {tableDefs.map(x => { const t = d.kpis.find(k => k.id === x.id)?.t ?? null
                      return <th key={x.id} className="px-3 py-1.5 text-right text-[11px] font-medium tabular-nums text-[var(--k-muted)] whitespace-nowrap" title={targetText(x, t)}>
                        {t ? (x.dir === 'band' ? `${fmtNum(t[0], 1)}–${fmtNum(t[1], 1)}` : `${x.dir === 'up' ? '≥' : '≤'} ${fmtNum(t[0], 2)}`) : '—'}</th> })}
                  </tr>
                </thead>
                <tbody>
                  {d.by_warehouse.length === 0 && <TableEmptyRow colSpan={tableDefs.length + 1}>Không kho nào có số liệu trong kỳ.</TableEmptyRow>}
                  {d.by_warehouse.map(w => {
                    const byId = new Map(w.kpis.map(k => [k.id, k]))
                    return (
                      <tr key={w.warehouse_id} className="border-t border-[var(--k-line)]">
                        <td className="sticky left-0 z-10 bg-[var(--k-surface)] px-4 py-2 text-xs font-semibold whitespace-nowrap">{w.warehouse_name}</td>
                        {tableDefs.map(x => { const k = byId.get(x.id); const r = ragKey(k?.rag ?? null)
                          return <td key={x.id} className={`px-3 py-2 text-right text-xs font-semibold tabular-nums whitespace-nowrap ${RAG_TEXT[r]}`} title={k ? `${x.name}: ${fmtValue(x, k.value)} · ${k.sub ?? ''} · ${targetText(x, k.t)}` : ''}>
                            {k?.value != null && <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${RAG_DOT[r]}`} />}{fmtValue(x, k?.value)} {k && <Delta def={x} k={k} />}</td> })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </KpiPanel>
        </>
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
