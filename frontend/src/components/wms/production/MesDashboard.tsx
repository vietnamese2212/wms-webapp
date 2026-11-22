// TỔNG QUAN — DASHBOARD BÁO CÁO NVL THEO THỜI GIAN (22/11). User: "báo cáo như thế này chưa chuyên nghiệp, cần học hỏi các phần mềm MES hiện đại"
// · "1 ngày có 36 mẻ, vận hành nhiều tháng, nhiều năm thì sao, lên dashboard nó thế nào?" · "từ dashboard click vào thì ra dữ liệu xem được".
// User chốt: khuôn "trung tâm điều hành" (.kpi-console như Dashboard Tổng quan / Giám sát vận hành) · kỳ 1 ngày / 7 ngày / 1 tháng / 3 tháng /
// 1 năm / 3 năm / tự chọn · KHÔNG thẻ giá trị ₫ (chưa có giá chuẩn) · KHÔNG hiệu suất thu hồi (chưa ghi nước) · mục tiêu = Cài đặt MES.
//   • Mọi số gom sẵn ở DB (mes_dashboard — MỘT lời gọi; mẻ đã nạp bồn đọc sổ tổng hợp, mẻ chưa nạp tính trực tiếp) ⇒ 3 năm vẫn chỉ ~40 điểm /
//     biểu đồ. Cách gom tự chọn theo độ dài kỳ: 1 ngày = từng mẻ · ≤ 3 tháng = ngày · ≤ 1 năm = tuần · dài hơn = tháng.
//   • Luật như màn Theo chu kỳ: so ĐỊNH MỨC GỐC, lệch = Sửa phiếu + Cấp lệch, KG chỉ NVL tính KG và chỉ dòng đã cấp xong, NVL lệch đếm mọi đơn vị.
//   • BẤM ĐỂ XEM DỮ LIỆU: thẻ số / cột đếm / ô bản đồ nhiệt / NVL / ca / BTP ⇒ hộp "Dữ liệu" (mes_dashboard_detail: từng mẻ hoặc từng NVL lệch,
//     tối đa 500 dòng kèm tổng) · bấm một kỳ trên đường xu hướng ⇒ ĐI SÂU vào kỳ đó (nút ‹ quay lại) · bấm một mẻ ⇒ trang của mẻ.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { ChevronLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { StatCard, type StatTone } from '@/components/wms/DashboardPanel'
import { KpiPanel } from '@/components/wms/KpiCharts'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import {
  useProductionWarehouses, useMesDashboard, useMesDashboardDetail, defaultKitchen,
  type MesDashboard as Dash, type DashGrain, type DashBucket, type DashDetailQuery, type DashOnly, type DashBatchRow, type DashLineRow,
} from '@/api/productionHooks'
import { useElementWidth } from '@/hooks/useElementWidth'
import { formatTimestampTime } from '@/utils/formatters'
import { devLabel } from '@/utils/reqTolerance'
import { durLabel } from '@/utils/cycleReport'
import { unitCode } from '@/utils/unitCode'
import { addDays, daysOf, grainOf, bucketRange, withAllBuckets as fillBuckets } from '@/utils/mesDash'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không tải được số liệu'
const nf = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const sgn = (n: number, d = 1) => (n > 0 ? `+${nf(n, d)}` : n < 0 ? `−${nf(Math.abs(n), d)}` : '0')
const pctOf = (total: number, std: number): number | null => (Number(std) > 0 ? Math.round((Number(total) / Number(std)) * 1000) / 10 : null)
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const TONE_VAR: Record<StatTone, string> = { ok: 'var(--k-ok)', warn: 'var(--k-warn)', bad: 'var(--k-bad)' }
const NO_SHIFT = 'Chưa ghi ca'
const shiftName = (s: string | null) => s ?? NO_SHIFT

export const DASH_RANGES = [
  { key: '1d', label: '1 ngày', days: 1 }, { key: '7d', label: '7 ngày', days: 7 }, { key: '1m', label: '1 tháng', days: 30 },
  { key: '3m', label: '3 tháng', days: 90 }, { key: '1y', label: '1 năm', days: 365 }, { key: '3y', label: '3 năm', days: 1095 },
  { key: 'custom', label: 'Tự chọn', days: 0 },
] as const
type RangeKey = typeof DASH_RANGES[number]['key']
const MAX_DAYS = 1100
const GRAIN_TEXT: Record<DashGrain, string> = { batch: 'từng mẻ', day: 'theo ngày', week: 'theo tuần', month: 'theo tháng' }
const bucketLabel = (g: DashGrain, k: string) => (g === 'month' ? `${k.slice(5, 7)}/${k.slice(2, 4)}` : g === 'week' ? `T ${ddmm(k)}` : ddmm(k))
/** trục thời gian đủ MỌI kỳ của khoảng (DB chỉ trả kỳ có mẻ) — kỳ trống: đứt đường, ô nhiệt viền đứt */
function withAllBuckets(d: Dash): Dash {
  return { ...d, buckets: fillBuckets(d.grain, d.date_from, d.date_to, d.buckets, k => ({ k, batches: 0, filled: 0, pass: 0, dev_batches: 0, dev_lines: 0, std_kg: 0, total_kg: 0, edit_kg: 0, exec_kg: 0 })) }
}
/** lệch % so mục tiêu: trong mức xanh · tới 2 lần mục tiêu vàng · hơn nữa đỏ */
const devTone = (p: number | null, target: number): StatTone | undefined => (p == null ? undefined : Math.abs(p) <= target ? 'ok' : Math.abs(p) <= 2 * target ? 'warn' : 'bad')
const passTone = (p: number | null, target: number): StatTone | undefined => (p == null ? undefined : p >= target ? 'ok' : p >= target - 5 ? 'warn' : 'bad')
const toneColor = (t: StatTone | undefined) => (t ? TONE_VAR[t] : undefined)

type DetailReq = { title: string; q: Omit<DashDetailQuery, 'warehouse_id'> }

export function MesDashboard({ tabBar }: { tabBar: ReactNode }) {
  const navigate = useNavigate()
  const f = useWmsFilterStore(s => s.productionReport)
  const setF = useWmsFilterStore(s => s.setProductionReport)
  const { data: { kitchens } } = useProductionWarehouses()
  const wh = kitchens.some(k => k.id === f.warehouseId) ? f.warehouseId : defaultKitchen(kitchens, f.warehouseId || useGlobalScopeStore.getState().warehouseId)
  const today = todayVN()
  const range = (f.dRange ?? '7d') as RangeKey
  const base = useMemo(() => {
    if (range === 'custom') {
      const from = f.dFrom || addDays(today, -6), to = f.dTo || today
      return { from, to }
    }
    const days = DASH_RANGES.find(r => r.key === range)?.days ?? 7
    return { from: addDays(today, -(days - 1)), to: today }
  }, [range, f.dFrom, f.dTo, today])
  // ĐI SÂU: bấm một kỳ trên đường xu hướng ⇒ xem riêng kỳ đó; ‹ quay lại kỳ trước
  const [stack, setStack] = useState<{ from: string; to: string; label: string }[]>([])
  useEffect(() => { setStack([]) }, [range, base.from, base.to, wh])
  const cur = stack.length ? stack[stack.length - 1] : base
  const days = daysOf(cur.from, cur.to)
  const badRange = !(days >= 1) || days > MAX_DAYS
  const grain = grainOf(days)
  const q = useMesDashboard(wh && !badRange ? { warehouse_id: wh, date_from: cur.from, date_to: cur.to, grain } : null)
  // chỉ dùng số của ĐÚNG kho + kỳ đang chọn (giữ số cũ khi đang tải kỳ mới thì được, nhưng không trộn kho)
  const d = useMemo(() => (q.data && q.data.warehouse_id === wh ? withAllBuckets(q.data) : undefined), [q.data, wh])
  const fresh = !!d && d.date_from === cur.from && d.date_to === cur.to
  const [detail, setDetail] = useState<DetailReq | null>(null)
  const open = (title: string, dq: Omit<DashDetailQuery, 'warehouse_id' | 'date_from' | 'date_to'> & { date_from?: string; date_to?: string }) =>
    setDetail({ title, q: { date_from: dq.date_from ?? cur.from, date_to: dq.date_to ?? cur.to, ...dq } as Omit<DashDetailQuery, 'warehouse_id'> })
  const drill = (b: DashBucket) => {
    if (!d || !b.batches) return
    const r = bucketRange(d.grain, b.k, cur.from, cur.to)
    if (r.from === cur.from && r.to === cur.to) return
    setStack(s => [...s, { ...r, label: r.from === r.to ? dmy(r.from) : `${ddmm(r.from)} → ${ddmm(r.to)}` }])
  }
  const rangeText = cur.from === cur.to ? dmy(cur.from) : `${dmy(cur.from)} → ${dmy(cur.to)}`

  return (
    <div className="kpi-console flex flex-col h-full bg-slate-100 dark:bg-slate-900" data-testid="mes-dash">
      <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 shrink-0 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {tabBar}
          {kitchens.length > 1 && (
            <div className="w-40 sm:w-48 min-w-0 shrink">
              <SingleSelect value={wh} onChange={v => setF({ warehouseId: v, cycle: '' })} triggerClassName="h-9 sm:h-7" placeholder="Kho chế biến" options={kitchens.map(k => ({ value: k.id, label: k.name }))} />
            </div>
          )}
          {kitchens.length === 1 && <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{kitchens[0].name}</span>}
          <span className="flex-1" />
          {d?.computed_at && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap" title="Số tự cập nhật khi có người cấp NVL, sửa phiếu, nạp bồn — không cần tải lại trang">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>
              Trực tiếp · {formatTimestampTime(d.computed_at).slice(0, 5)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap gap-1 text-xs font-semibold sm:flex-nowrap sm:gap-0 sm:rounded-[10px] sm:border sm:border-slate-200 sm:dark:border-slate-700 sm:overflow-hidden" role="group" aria-label="Kỳ xem">
            {DASH_RANGES.map(r => (
              <button key={r.key} type="button" onClick={() => setF({ dRange: r.key, ...(r.key === 'custom' && !f.dFrom ? { dFrom: base.from, dTo: base.to } : {}) })}
                aria-pressed={range === r.key} data-range={r.key}
                className={`whitespace-nowrap rounded-md border border-slate-200 dark:border-slate-700 px-3 h-8 sm:h-7 transition-colors sm:rounded-none sm:border-0 sm:border-l sm:first:border-l-0 ${
                  range === r.key ? 'bg-[var(--k-brand)] text-white' : 'bg-white dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                {r.label}
              </button>
            ))}
          </div>
          {range === 'custom' && (
            <div className="flex items-center gap-1 text-xs">
              <input type="date" aria-label="Từ ngày" value={f.dFrom || base.from} max={today} onChange={e => setF({ dFrom: e.target.value })}
                className="h-8 sm:h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 text-xs" />
              <span className="text-slate-400">→</span>
              <input type="date" aria-label="Đến ngày" value={f.dTo || base.to} max={today} onChange={e => setF({ dTo: e.target.value })}
                className="h-8 sm:h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 text-xs" />
            </div>
          )}
          {stack.length > 0 && (
            <button type="button" onClick={() => setStack(s => s.slice(0, -1))} data-testid="dash-back"
              className="inline-flex items-center gap-0.5 h-8 sm:h-7 rounded-md border border-[var(--k-brand)] px-2 text-xs font-semibold text-[var(--k-brand)] dark:text-sky-300 hover:bg-white dark:hover:bg-white/5">
              <ChevronLeft className="h-3.5 w-3.5" />Quay lại {stack.length > 1 ? stack[stack.length - 2].label : DASH_RANGES.find(r => r.key === range)?.label}
            </button>
          )}
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Ngày SX <b className="tabular-nums text-slate-700 dark:text-slate-200">{rangeText}</b> · {GRAIN_TEXT[grain]}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4 pb-20 lg:pb-4 space-y-3 sm:space-y-4">
        {badRange && <div className="rounded-[14px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">Khoảng ngày không hợp lệ — Đến ngày phải sau Từ ngày, tối đa 3 năm.</div>}
        {q.isError && <div className="rounded-[14px] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{apiMsg(q.error)}</div>}
        {!kitchens.length && <p className="text-xs text-amber-700">Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.</p>}
        {!d && q.isLoading && <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[112px] rounded-[14px] bg-slate-200 dark:bg-slate-700/50 animate-pulse" />)}</div>}
        {d && <DashBody d={d} stale={!fresh} onOpen={open} onDrill={drill} onBatch={id => navigate(`/wms/production/${id}`)} />}
      </div>
      {wh && detail && <DetailDialog wh={wh} req={detail} onClose={() => setDetail(null)} onBatch={id => { setDetail(null); navigate(`/wms/production/${id}`) }} />}
    </div>
  )
}

type OpenFn = (title: string, q: Omit<DashDetailQuery, 'warehouse_id' | 'date_from' | 'date_to'> & { date_from?: string; date_to?: string }) => void

function DashBody({ d, stale, onOpen, onDrill, onBatch }: { d: Dash; stale: boolean; onOpen: OpenFn; onDrill: (b: DashBucket) => void; onBatch: (id: string) => void }) {
  const t = d.totals, p = d.prev, tg = d.targets
  const pct = pctOf(t.total_kg, t.std_kg), prevPct = pctOf(p.total_kg, p.std_kg)
  const pass = t.filled ? (t.pass / t.filled) * 100 : null, prevPass = p.filled ? (p.pass / p.filled) * 100 : null
  const qaN = t.qa_released + t.qa_rejected, qa = qaN ? (t.qa_released / qaN) * 100 : null
  const prevQaN = p.qa_released + p.qa_rejected, prevQa = prevQaN ? (p.qa_released / prevQaN) * 100 : null
  const devLines = t.over + t.under + t.extra
  const days = daysOf(d.date_from, d.date_to)
  /** so kỳ trước: ▲▼ + màu theo hướng tốt */
  const cmp = (cur: number | null, old: number | null, unit: string, better: 'up' | 'down', dec = 1): ReactNode => {
    if (cur == null || old == null) return <span>chưa có số kỳ trước để so</span>
    const v = cur - old
    if (Math.abs(v) < 10 ** -dec / 2) return <span>bằng kỳ trước</span>
    const good = better === 'up' ? v > 0 : v < 0
    return <span style={{ color: good ? 'var(--k-ok)' : 'var(--k-bad)' }}>{v > 0 ? '▲' : '▼'} {nf(Math.abs(v), dec)}{unit} so kỳ trước</span>
  }
  if (!t.batches) return <p className="text-sm text-[var(--k-muted)] py-6 text-center">Không có mẻ nào có ngày SX trong kỳ này.</p>
  return (
    <div className={`space-y-3 sm:space-y-4 transition-opacity ${stale ? 'opacity-60' : ''}`}>
      {/* THẺ SỐ — bấm để xem dữ liệu */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4" data-testid="dash-cards">
        <CardBtn onClick={() => onOpen('Mẻ đã nạp bồn', { kind: 'batches', only: 'filled' })} id="filled">
          <StatCard twoLines label="Mẻ hoàn thành" value={nf(t.filled, 0)} unit={`/ ${nf(t.batches, 0)} mẻ`}
            sub={<>{nf(t.filled / days, 1)} mẻ / ngày{t.batches - t.filled > 0 ? ` · ${t.batches - t.filled} đang làm` : ''}</>} />
        </CardBtn>
        <CardBtn onClick={() => onOpen('Mẻ không đạt định mức', { kind: 'batches', only: 'fail' })} id="pass">
          <StatCard twoLines label="Mẻ đạt định mức" value={pass == null ? '—' : `${nf(pass, 1)}%`} pct={pass} tone={passTone(pass, tg.pass_pct)}
            unit={`mục tiêu ≥ ${nf(tg.pass_pct, 1)}%`} sub={cmp(pass, prevPass, ' điểm', 'up')} />
        </CardBtn>
        <CardBtn onClick={() => onOpen('NVL lệch định mức', { kind: 'lines' })} id="dev">
          <StatCard twoLines label="Lệch NVL (KG)" value={sgn(t.total_kg, Math.abs(t.total_kg) < 100 ? 1 : 0)} tone={devTone(pct, tg.dev_pct)}
            unit={pct == null ? 'KG' : `KG · ${devLabel(pct)}`} sub={<>mục tiêu ±{nf(tg.dev_pct, 2)}% · {cmp(pct == null ? null : Math.abs(pct), prevPct == null ? null : Math.abs(prevPct), ' điểm', 'down', 2)}</>} />
        </CardBtn>
        <CardBtn onClick={() => onOpen('NVL lệch định mức', { kind: 'lines' })} id="lines">
          <StatCard twoLines label="Dòng NVL lệch" value={nf(devLines, 0)} unit="dòng" tone={devLines ? 'bad' : 'ok'}
            sub={<>vượt {t.over} · dưới {t.under} · ngoài định mức {t.extra}{t.pending ? ` · ${t.pending} chưa xong` : ''}</>} />
        </CardBtn>
        <CardBtn onClick={() => onOpen('Mẻ đã nạp bồn', { kind: 'batches', only: 'filled' })} id="time">
          <StatCard twoLines label="Thời gian mẻ TB" value={t.avg_min == null ? '—' : durLabel(t.avg_min)} unit="mở → nạp bồn"
            sub={cmp(t.avg_min, p.avg_min, ' phút', 'down', 0)} />
        </CardBtn>
        <CardBtn onClick={() => onOpen('Mẻ QA bồn loại', { kind: 'batches', only: 'qa_rejected' })} id="qa">
          <StatCard twoLines label="QA bồn đạt" value={qa == null ? '—' : `${nf(qa, 1)}%`} pct={qa} tone={qa == null ? undefined : qa >= 99 ? 'ok' : qa >= 95 ? 'warn' : 'bad'}
            unit={qaN ? `${t.qa_released}/${qaN} mẻ` : 'chưa có kết luận'} sub={t.qa_rejected ? `${t.qa_rejected} mẻ QA loại` : cmp(qa, prevQa, ' điểm', 'up')} />
        </CardBtn>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <KpiPanel className="lg:col-span-2" title={d.grain === 'batch' ? 'Lệch so định mức — từng mẻ' : 'Xu hướng lệch so định mức'}
          hint={d.grain === 'batch' ? '% theo KG · bấm một mẻ để mở' : `% theo KG · ${GRAIN_TEXT[d.grain]} · bấm một kỳ để đi sâu`}
          right={<span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--k-muted)]"><i className="inline-block h-2.5 w-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--k-ok) 22%, transparent)' }} />mục tiêu ±{nf(tg.dev_pct, 2)}%</span>}>
          {d.grain === 'batch'
            ? <BatchBars d={d} onBatch={onBatch} />
            : <TrendChart d={d} onDrill={onDrill} onCount={b => { const r = bucketRange(d.grain, b.k, d.date_from, d.date_to); onOpen(`Mẻ có NVL lệch · ${bucketLabel(d.grain, b.k)}`, { kind: 'batches', only: 'dev', ...r }) }} />}
        </KpiPanel>
        <KpiPanel title="Lệch đến từ đâu" hint="KG cả kỳ">
          <Composition d={d} onOpen={onOpen} />
        </KpiPanel>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <KpiPanel className="lg:col-span-2" title={d.grain === 'batch' ? 'Theo ca' : `Bản đồ nhiệt: ca × ${d.grain === 'day' ? 'ngày' : d.grain === 'week' ? 'tuần' : 'tháng'}`}
          hint={d.grain === 'batch' ? 'bấm một ca để xem từng mẻ' : 'mỗi ô = lệch % một ca · bấm ô để xem từng mẻ'}>
          {d.grain !== 'batch' && <ShiftHeat d={d} onOpen={onOpen} />}
          <GroupTable kind="shift" d={d} onOpen={onOpen} />
        </KpiPanel>
        <KpiPanel title="NVL gây lệch nhiều nhất" hint="số lần lệch · lũy kế">
          <Pareto d={d} onOpen={onOpen} />
        </KpiPanel>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <KpiPanel className="lg:col-span-2" title="Biểu đồ kiểm soát — từng mẻ" hint={`${d.spc.length} mẻ gần nhất có số · trung bình ± 3σ · bấm một mẻ để mở`}>
          <SpcChart d={d} onBatch={onBatch} />
        </KpiPanel>
        <KpiPanel title="Theo bán thành phẩm" hint="bấm để xem từng mẻ">
          <GroupTable kind="btp" d={d} onOpen={onOpen} />
        </KpiPanel>
      </div>

      <KpiPanel title="Mẻ cần xem" hint="lệch nhiều nhất trong kỳ · bấm một dòng để mở mẻ">
        <ExcTable d={d} onBatch={onBatch} />
      </KpiPanel>
    </div>
  )
}

/** thẻ số bấm được — mở bảng dữ liệu đứng sau con số */
function CardBtn({ onClick, id, children }: { onClick: () => void; id: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} data-card={id} title="Bấm để xem dữ liệu"
      className="text-left rounded-[14px] transition-shadow hover:shadow-md hover:ring-1 hover:ring-[var(--k-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--k-brand)] [&>div]:h-full">
      {children}
    </button>
  )
}

// ── Xu hướng: đường lệch % theo kỳ + dải mục tiêu; dải dưới: số mẻ có NVL lệch (trục riêng) ──────────────────────────────────────────────
function niceStep(span: number, n = 4): number {
  if (!(span > 0)) return 1
  const raw = span / n, pw = Math.pow(10, Math.floor(Math.log10(raw)))
  const fr = raw / pw
  return (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 5 ? 5 : 10) * pw
}
function TrendChart({ d, onDrill, onCount }: { d: Dash; onDrill: (b: DashBucket) => void; onCount: (b: DashBucket) => void }) {
  const [ref, w] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const tg = d.targets.dev_pct
  const pts = d.buckets.map(b => ({ b, p: pctOf(b.total_kg, b.std_kg) }))
  const vals = pts.map(x => x.p).filter((v): v is number => v != null)
  let lo = Math.min(-2 * tg, ...vals), hi = Math.max(2 * tg, ...vals)
  const step = niceStep(hi - lo)
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step
  const H = 190, padL = 46, padR = 8, padT = 10, padB = 8
  const n = Math.max(pts.length, 1), band = Math.max(w - padL - padR, 10) / n
  const x = (i: number) => padL + (i + 0.5) * band
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB)
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000)
  let path = '', area = '', run: string[] = []
  const flush = () => { if (run.length > 1) { path += `M${run.join(' L')} `; area += `M${run[0].split(',')[0]},${y(0)} L${run.join(' L')} L${run[run.length - 1].split(',')[0]},${y(0)} Z ` } run = [] }
  pts.forEach((pt, i) => { if (pt.p == null) flush(); else run.push(`${x(i).toFixed(1)},${y(pt.p).toFixed(1)}`) })
  flush()
  const cntMax = Math.max(1, ...d.buckets.map(b => b.dev_batches))
  const SH = 56
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))))
  const h = hover != null ? pts[hover] : null
  return (
    <div ref={ref} className="relative px-2 sm:px-3 pt-2 pb-3 select-none" onMouseLeave={() => setHover(null)} data-testid="dash-trend">
      {w > 0 && (
        <>
          <svg width={w} height={H} role="img" aria-label="Xu hướng lệch so định mức">
            <rect x={padL} width={Math.max(w - padL - padR, 0)} y={y(tg)} height={Math.max(y(-tg) - y(tg), 0)} style={{ fill: 'color-mix(in srgb, var(--k-ok) 14%, transparent)' }} />
            {ticks.map(v => (
              <g key={v}>
                <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} style={{ stroke: v === 0 ? 'var(--k-muted)' : 'var(--k-line)', strokeWidth: 1 }} />
                <text x={padL - 5} y={y(v) + 3} textAnchor="end" style={{ fill: 'var(--k-muted)', fontSize: 10 }}>{v === 0 ? '0' : devLabel(v)}</text>
              </g>
            ))}
            <path d={area} style={{ fill: 'color-mix(in srgb, var(--k-data) 14%, transparent)' }} />
            <path d={path} style={{ fill: 'none', stroke: 'var(--k-data)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
            {pts.map((pt, i) => pt.p != null && (Math.abs(pt.p) > tg || pts.length <= 31) && (
              <circle key={pt.b.k} cx={x(i)} cy={y(pt.p)} r={Math.abs(pt.p) > tg ? 4 : 2.5}
                style={{ fill: Math.abs(pt.p) > tg ? 'var(--k-bad)' : 'var(--k-data)', stroke: 'var(--k-surface)', strokeWidth: 1.5 }} />
            ))}
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} style={{ stroke: 'var(--k-muted)', strokeDasharray: '3 3' }} />}
            {pts.map((pt, i) => (
              <rect key={pt.b.k} x={padL + i * band} y={0} width={band} height={H} style={{ fill: 'transparent', cursor: 'pointer' }} data-bucket={pt.b.k}
                onMouseEnter={() => setHover(i)} onClick={() => onDrill(pt.b)}><title>{`${bucketLabel(d.grain, pt.b.k)} — bấm để đi sâu`}</title></rect>
            ))}
          </svg>
          <div className="text-[10px] text-[var(--k-muted)]" style={{ marginLeft: padL }}>Số mẻ có NVL lệch · bấm cột để xem</div>
          <svg width={w} height={SH + 16} role="img" aria-label="Số mẻ có nguyên liệu lệch">
            <line x1={padL} x2={w - padR} y1={SH} y2={SH} style={{ stroke: 'var(--k-line)' }} />
            <text x={padL - 5} y={10} textAnchor="end" style={{ fill: 'var(--k-muted)', fontSize: 10 }}>{cntMax}</text>
            <text x={padL - 5} y={SH + 3} textAnchor="end" style={{ fill: 'var(--k-muted)', fontSize: 10 }}>0</text>
            {pts.map((pt, i) => {
              const bh = (pt.b.dev_batches / cntMax) * (SH - 6), bw = Math.max(Math.min(band * 0.6, 22), 2)
              return (
                <g key={pt.b.k}>
                  <rect x={x(i) - bw / 2} y={SH - bh} width={bw} height={Math.max(bh, pt.b.dev_batches ? 2 : 0)} rx={Math.min(2, bw / 2)} style={{ fill: 'var(--k-bad)', opacity: 0.8 }} />
                  <rect x={padL + i * band} y={0} width={band} height={SH} style={{ fill: 'transparent', cursor: pt.b.dev_batches ? 'pointer' : 'default' }}
                    onMouseEnter={() => setHover(i)} onClick={() => pt.b.dev_batches && onCount(pt.b)} data-count={pt.b.k}><title>{`${bucketLabel(d.grain, pt.b.k)}: ${pt.b.dev_batches}/${pt.b.batches} mẻ có NVL lệch`}</title></rect>
                </g>
              )
            })}
            {pts.map((pt, i) => i % every === 0 && <text key={pt.b.k} x={x(i)} y={SH + 13} textAnchor="middle" style={{ fill: 'var(--k-muted)', fontSize: 10 }}>{bucketLabel(d.grain, pt.b.k)}</text>)}
          </svg>
        </>
      )}
      {h && (
        <div className="pointer-events-none absolute top-1 z-20 w-56 rounded-lg border border-[var(--k-line)] bg-[var(--k-surface)] px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{ left: Math.min(Math.max(x(hover!) - 112, 0), Math.max(w - 224, 0)) }}>
          <div className="font-semibold">{bucketLabel(d.grain, h.b.k)} · {h.b.batches} mẻ</div>
          <div className="tabular-nums">Lệch <b style={{ color: toneColor(devTone(h.p, d.targets.dev_pct)) }}>{h.p == null ? '—' : devLabel(h.p)}</b> · {sgn(h.b.total_kg, 1)} KG</div>
          <div className="tabular-nums text-[var(--k-muted)]">Sửa phiếu {sgn(h.b.edit_kg, 1)} · cấp lệch {sgn(h.b.exec_kg, 1)} KG</div>
          <div className="text-[var(--k-muted)]">{h.b.dev_batches} mẻ có NVL lệch · {h.b.filled ? `${nf((h.b.pass / h.b.filled) * 100, 1)}% mẻ đạt` : 'chưa mẻ nào nạp bồn'}</div>
        </div>
      )}
    </div>
  )
}

/** 1 ngày: mỗi mẻ một cột (lệch % KG), nhóm theo ca; đỏ = có NVL lệch; nhạt = chưa nạp bồn */
function BatchBars({ d, onBatch }: { d: Dash; onBatch: (id: string) => void }) {
  const [ref, w] = useElementWidth<HTMLDivElement>()
  const pts = d.points ?? []
  const tg = d.targets.dev_pct
  const vals = pts.map(x => x.pct).filter((v): v is number => v != null)
  let lo = Math.min(-2 * tg, ...vals), hi = Math.max(2 * tg, ...vals)
  const step = niceStep(hi - lo); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step
  const H = 210, padL = 46, padR = 8, padT = 10, padB = 26
  const band = Math.max(w - padL - padR, 10) / Math.max(pts.length, 1)
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB)
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000)
  if (!pts.length) return <p className="px-5 py-8 text-xs text-[var(--k-muted)]">Chưa có mẻ nào.</p>
  return (
    <div ref={ref} className="px-2 sm:px-3 pt-2 pb-3" data-testid="dash-batchbars">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Lệch so định mức từng mẻ">
          <rect x={padL} width={Math.max(w - padL - padR, 0)} y={y(tg)} height={Math.max(y(-tg) - y(tg), 0)} style={{ fill: 'color-mix(in srgb, var(--k-ok) 14%, transparent)' }} />
          {ticks.map(v => (
            <g key={v}>
              <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} style={{ stroke: v === 0 ? 'var(--k-muted)' : 'var(--k-line)' }} />
              <text x={padL - 5} y={y(v) + 3} textAnchor="end" style={{ fill: 'var(--k-muted)', fontSize: 10 }}>{v === 0 ? '0' : devLabel(v)}</text>
            </g>
          ))}
          {pts.map((pt, i) => {
            const cx = padL + (i + 0.5) * band, bw = Math.max(Math.min(band * 0.62, 28), 3)
            const v = pt.pct, top = v == null ? y(0) : Math.min(y(0), y(v)), bh = v == null ? 0 : Math.abs(y(v) - y(0))
            return (
              <g key={pt.id} data-bar={pt.code} style={{ cursor: 'pointer' }} onClick={() => onBatch(pt.id)}>
                <rect x={padL + i * band} y={0} width={band} height={H} style={{ fill: 'transparent' }} />
                {v == null
                  ? <line x1={cx - bw / 2} x2={cx + bw / 2} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--k-none)', strokeWidth: 2, strokeDasharray: '2 2' }} />
                  : <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(bh, 2)} rx={Math.min(2, bw / 2)} style={{ fill: pt.dev ? 'var(--k-bad)' : 'var(--k-data)', opacity: pt.filled ? 1 : 0.45 }} />}
                {band >= 16 && <text x={cx} y={H - 12} textAnchor="middle" style={{ fill: 'var(--k-muted)', fontSize: 9 }}>{pt.no ?? ''}</text>}
                <title>{`${shiftName(pt.shift)} · Mẻ ${pt.no ?? '—'} ${pt.code} — ${v == null ? 'chưa có dòng cấp xong' : `lệch ${devLabel(v)} (${sgn(pt.total_kg, 1)} KG)`} · ${pt.dev} NVL lệch${pt.filled ? '' : ' · chưa nạp bồn'}`}</title>
              </g>
            )
          })}
        </svg>
      )}
      <div className="flex flex-wrap gap-3 px-1 text-[11px] text-[var(--k-muted)]">
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--k-bad)' }} />Có NVL lệch</span>
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--k-data)' }} />Trong mức</span>
        <span>Nhạt = chưa nạp bồn · số dưới cột = số mẻ</span>
      </div>
    </div>
  )
}

// ── Lệch đến từ đâu: KG sửa phiếu / cấp lệch + số dòng vượt · dưới · ngoài định mức ──────────────────────────────────────────────────────
function Composition({ d, onOpen }: { d: Dash; onOpen: OpenFn }) {
  const t = d.totals
  const pct = pctOf(t.total_kg, t.std_kg)
  const mx = Math.max(Math.abs(t.edit_kg), Math.abs(t.exec_kg), 1e-9)
  const row = (label: string, v: number, note: string, color: string, only: DashOnly, id: string) => {
    const wPct = (Math.abs(v) / mx) * 50
    return (
      <button type="button" onClick={() => onOpen(label === 'Sửa phiếu' ? 'Dòng NVL có sửa phiếu' : 'Dòng NVL cấp khác phiếu', { kind: 'lines', only })} data-comp={id}
        className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-[var(--k-surface-2)]">
        <div className="flex items-baseline justify-between gap-2 text-xs"><b>{label}</b><b className="tabular-nums" style={{ color }}>{sgn(v, 1)} KG</b></div>
        <div className="relative mt-1 h-2 rounded-full bg-[var(--k-surface-2)]">
          <span className="absolute inset-y-[-2px] left-1/2 w-px bg-[var(--k-muted)]" />
          <span className="absolute inset-y-0 rounded-full" style={{ background: color, width: `${Math.max(wPct, 0.8)}%`, left: v >= 0 ? '50%' : `${50 - Math.max(wPct, 0.8)}%` }} />
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--k-muted)]">{note}</div>
      </button>
    )
  }
  const chip = (label: string, n: number, only: DashOnly, color: string) => (
    <button type="button" disabled={!n} onClick={() => onOpen(`Dòng NVL ${label.toLowerCase()}`, { kind: 'lines', only })} data-chip={only}
      className="flex-1 min-w-0 rounded-lg border border-[var(--k-line)] px-2 py-1.5 text-left enabled:hover:bg-[var(--k-surface-2)] disabled:opacity-60">
      <div className="text-[11px] leading-tight text-[var(--k-muted)]">{label}</div>
      <div className="text-lg font-semibold tabular-nums leading-tight" style={{ color: n ? color : undefined }}>{nf(n, 0)}</div>
    </button>
  )
  return (
    <div className="px-3 sm:px-4 py-3 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[26px] font-semibold tabular-nums leading-none" style={{ color: toneColor(devTone(pct, d.targets.dev_pct)) }}>{sgn(t.total_kg, 1)}</span>
        <span className="text-xs text-[var(--k-muted)]">KG{pct != null ? ` · ${devLabel(pct)}` : ''} = sửa phiếu + cấp lệch</span>
      </div>
      {row('Sửa phiếu', t.edit_kg, 'Trưởng ca sửa / thêm / bỏ dòng định mức của mẻ (có lý do)', 'var(--k-data)', 'edited', 'edit')}
      {row('Cấp lệch', t.exec_kg, 'Thực cấp khác phiếu của mẻ', 'var(--k-warn)', 'exec', 'exec')}
      <div className="flex gap-2 pt-1">
        {chip('Vượt định mức', t.over, 'over', 'var(--k-bad)')}
        {chip('Dưới định mức', t.under, 'under', 'var(--k-warn)')}
        {chip('Ngoài định mức', t.extra, 'extra', 'var(--k-bad)')}
      </div>
      <p className="text-[11px] text-[var(--k-muted)]">KG chỉ cộng NVL tính KG và dòng đã cấp xong{t.pending ? ` · ${t.pending} dòng chưa xong chưa tính` : ''}. Số dòng đếm mọi đơn vị.</p>
    </div>
  )
}

// ── Bản đồ nhiệt ca × kỳ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function heatFill(p: number | null, tg: number): string {
  if (p == null) return 'var(--k-surface-2)'
  const f = Math.max(-1, Math.min(1, p / (2 * tg)))
  const pctMix = Math.round(Math.abs(f) * 80) + (Math.abs(p) > tg ? 10 : 0)
  return `color-mix(in srgb, ${f < 0 ? 'var(--k-data)' : 'var(--k-warn)'} ${Math.min(pctMix, 90)}%, var(--k-surface-2))`
}
function ShiftHeat({ d, onOpen }: { d: Dash; onOpen: OpenFn }) {
  const ks = d.buckets.map(b => b.k)
  const shifts = [...new Set(d.heat.map(h => h.shift))].sort((a, b) => (a == null ? 1 : b == null ? -1 : a.localeCompare(b, 'vi')))
  const cell = new Map(d.heat.map(h => [`${h.shift ?? ''}|${h.k}`, h]))
  const n = ks.length
  const colMin = n > 60 ? '6px' : n > 31 ? '10px' : '1.6rem'
  const every = Math.max(1, Math.ceil(n / 10))
  const tg = d.targets.dev_pct
  return (
    <div className="px-3 sm:px-4 pt-3">
      <div className="overflow-x-auto">
        <div className="grid gap-[2px] min-w-max sm:min-w-0" style={{ gridTemplateColumns: `minmax(4.5rem, 6.5rem) repeat(${n}, minmax(${colMin}, 1fr))` }} data-testid="dash-heat">
          {shifts.map(s => (
            <div key={s ?? '_'} className="contents">
              <span className="sticky left-0 z-[1] bg-[var(--k-surface)] pr-2 text-[11px] font-semibold truncate self-center">{shiftName(s)}</span>
              {ks.map(k => {
                const h = cell.get(`${s ?? ''}|${k}`)
                const p = h ? pctOf(h.total_kg, h.std_kg) : null
                const r = bucketRange(d.grain, k, d.date_from, d.date_to)
                return (
                  <button key={k} type="button" disabled={!h} data-heat={`${shiftName(s)}|${k}`}
                    onClick={() => h && onOpen(`${shiftName(s)} · ${bucketLabel(d.grain, k)}`, { kind: 'batches', shift: s ?? '__none', ...r })}
                    title={h ? `${shiftName(s)} · ${bucketLabel(d.grain, k)} — lệch ${p == null ? '—' : devLabel(p)} · ${h.batches} mẻ · ${h.dev_batches} có NVL lệch` : `${shiftName(s)} · ${bucketLabel(d.grain, k)} — không có mẻ`}
                    className="h-7 rounded-[3px] text-[9px] font-medium tabular-nums enabled:hover:ring-1 enabled:hover:ring-[var(--k-ink)]"
                    style={{ background: h ? heatFill(p, tg) : 'transparent', border: h ? undefined : '1px dashed var(--k-line)' }}>
                    {n <= 16 && p != null ? devLabel(p) : ''}
                  </button>
                )
              })}
            </div>
          ))}
          <span />
          {ks.map((k, i) => <span key={k} className="pt-0.5 text-center text-[9px] text-[var(--k-muted)] whitespace-nowrap">{i % every === 0 ? bucketLabel(d.grain, k) : ''}</span>)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--k-muted)]">
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: heatFill(-2 * tg, tg) }} />cấp ít hơn định mức</span>
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: heatFill(0, tg) }} />đúng định mức</span>
        <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: heatFill(2 * tg, tg) }} />cấp nhiều hơn</span>
        <span>· đậm nhất = lệch ≥ {nf(2 * tg, 2)}%</span>
      </div>
    </div>
  )
}

/** bảng gọn theo ca / theo BTP: mẻ · đạt · lệch % · NVL lệch — số có màu, không vẽ thanh (memory: % trên dòng là con số có màu) */
function GroupTable({ kind, d, onOpen }: { kind: 'shift' | 'btp'; d: Dash; onOpen: OpenFn }) {
  const rows = kind === 'shift'
    ? d.shifts.map(s => ({ key: s.shift ?? '__none', label: shiftName(s.shift), sub: '', g: s, q: { kind: 'batches' as const, shift: s.shift ?? '__none' } }))
    : d.btp.map(b => ({ key: b.btp_id, label: b.code, sub: b.name ?? '', g: b, q: { kind: 'batches' as const, btp_id: b.btp_id } }))
  return (
    <div className="px-3 sm:px-4 py-2 overflow-x-auto">
      <table className="w-full text-xs" data-testid={`dash-${kind}`}>
        <thead><tr className="text-[10px] uppercase tracking-wide text-[var(--k-muted)]">
          <th className="py-1 text-left font-semibold">{kind === 'shift' ? 'Ca' : 'Bán thành phẩm'}</th><th className="py-1 text-right font-semibold">Mẻ</th>
          <th className="py-1 pl-2 text-right font-semibold">Đạt</th><th className="py-1 pl-2 text-right font-semibold">Lệch</th><th className="py-1 pl-2 text-right font-semibold whitespace-nowrap">NVL lệch</th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const p = pctOf(r.g.total_kg, r.g.std_kg), ps = r.g.filled ? (r.g.pass / r.g.filled) * 100 : null
            return (
              <tr key={r.key} onClick={() => onOpen(kind === 'shift' ? r.label : `${r.label} ${r.sub}`, r.q)} data-row={r.key}
                className="cursor-pointer border-t border-[var(--k-line)] hover:bg-[var(--k-surface-2)]">
                <td className="py-1.5 pr-2 max-w-[9rem]" title={r.sub}><b className="block truncate">{r.label}</b>{r.sub && <span className="block truncate text-[10px] text-[var(--k-muted)]">{r.sub}</span>}</td>
                <td className="py-1.5 text-right tabular-nums">{nf(r.g.batches, 0)}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums" style={{ color: toneColor(passTone(ps, d.targets.pass_pct)) }}>{ps == null ? '—' : `${nf(ps, 1)}%`}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums" style={{ color: toneColor(devTone(p, d.targets.dev_pct)) }}>{p == null ? '—' : devLabel(p)}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums" style={{ color: r.g.dev_lines ? 'var(--k-bad)' : 'var(--k-muted)' }}>{nf(r.g.dev_lines, 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Pareto({ d, onOpen }: { d: Dash; onOpen: OpenFn }) {
  if (!d.pareto.length) return <p className="px-5 py-8 text-xs text-[var(--k-muted)]">Chưa NVL nào lệch định mức trong kỳ.</p>
  const tot = d.pareto_total || 1, mx = d.pareto[0].n || 1
  let cum = 0
  return (
    <div className="px-3 sm:px-4 py-2 space-y-1" data-testid="dash-pareto">
      {d.pareto.map(m => {
        const before = cum; cum += m.n
        const lead = before / tot < 0.8
        return (
          <button key={m.material_id} type="button" onClick={() => onOpen(`${m.code} ${m.name ?? ''} — các lần lệch`, { kind: 'lines', material_id: m.material_id })} data-pareto={m.code}
            title={`Vượt ${m.over} · dưới ${m.under} · ngoài định mức ${m.extra} · ${m.batches} mẻ`}
            className="w-full text-left rounded-lg px-2 py-1 hover:bg-[var(--k-surface-2)]">
            <div className="flex items-baseline gap-2 text-xs min-w-0">
              <b className="font-mono shrink-0">{m.code}</b><span className="truncate text-[var(--k-muted)]">{m.name ?? ''}</span>
              <span className="ml-auto shrink-0 font-semibold tabular-nums">{nf(m.n, 0)} <span className="font-normal text-[var(--k-muted)]">· {nf((cum / tot) * 100, 0)}%</span></span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-[var(--k-surface-2)]">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max((m.n / mx) * 100, 2)}%`, background: lead ? 'var(--k-data)' : 'color-mix(in srgb, var(--k-data) 40%, var(--k-surface-2))' }} />
            </div>
          </button>
        )
      })}
      <p className="pt-1 text-[11px] text-[var(--k-muted)]">Đậm: nhóm NVL chiếm 80% số lần lệch — xử lý các mã này trước. Tổng {nf(d.pareto_total, 0)} lần lệch.</p>
    </div>
  )
}

// ── Biểu đồ kiểm soát (SPC): lệch % từng mẻ, trung bình ± 3σ ⇒ tách mẻ bất thường khỏi dao động thường ngày ─────────────────────────────
function SpcChart({ d, onBatch }: { d: Dash; onBatch: (id: string) => void }) {
  const [ref, w] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pts = d.spc
  const vals = pts.map(p => Number(p.pct))
  const n = vals.length
  const mean = n ? vals.reduce((a, b) => a + b, 0) / n : 0
  const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0
  const limits = n >= 10
  const ucl = mean + 3 * sd, lcl = mean - 3 * sd
  let lo = Math.min(...vals, limits ? lcl : 0, -d.targets.dev_pct), hi = Math.max(...vals, limits ? ucl : 0, d.targets.dev_pct)
  const step = niceStep(hi - lo); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step
  const H = 200, padL = 46, padR = 8, padT = 10, padB = 10
  const x = (i: number) => padL + (n <= 1 ? (w - padL - padR) / 2 : (i / (n - 1)) * (w - padL - padR))
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB)
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000)
  const out = limits ? vals.filter(v => v > ucl || v < lcl).length : 0
  if (!n) return <p className="px-5 py-8 text-xs text-[var(--k-muted)]">Chưa mẻ nào có dòng NVL tính KG đã cấp xong.</p>
  const h = hover != null ? pts[hover] : null
  return (
    <div ref={ref} className="relative px-2 sm:px-3 pt-2 pb-3 select-none" onMouseLeave={() => setHover(null)} data-testid="dash-spc">
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Biểu đồ kiểm soát lệch từng mẻ">
          {ticks.map(v => (
            <g key={v}>
              <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--k-line)' }} />
              <text x={padL - 5} y={y(v) + 3} textAnchor="end" style={{ fill: 'var(--k-muted)', fontSize: 10 }}>{v === 0 ? '0' : devLabel(v)}</text>
            </g>
          ))}
          {limits && <>
            <line x1={padL} x2={w - padR} y1={y(ucl)} y2={y(ucl)} style={{ stroke: 'var(--k-bad)', strokeWidth: 1.5, strokeDasharray: '6 4' }} />
            <line x1={padL} x2={w - padR} y1={y(lcl)} y2={y(lcl)} style={{ stroke: 'var(--k-bad)', strokeWidth: 1.5, strokeDasharray: '6 4' }} />
            <text x={w - padR - 2} y={y(ucl) - 4} textAnchor="end" style={{ fill: 'var(--k-bad)', fontSize: 10, fontWeight: 600 }}>giới hạn trên {devLabel(Math.round(ucl * 100) / 100)}</text>
            <text x={w - padR - 2} y={y(lcl) + 12} textAnchor="end" style={{ fill: 'var(--k-bad)', fontSize: 10, fontWeight: 600 }}>giới hạn dưới {devLabel(Math.round(lcl * 100) / 100)}</text>
          </>}
          <line x1={padL} x2={w - padR} y1={y(mean)} y2={y(mean)} style={{ stroke: 'var(--k-ok)', strokeWidth: 1.5 }} />
          <path d={pts.map((_, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ')} style={{ fill: 'none', stroke: 'color-mix(in srgb, var(--k-data) 35%, transparent)', strokeWidth: 1 }} />
          {pts.map((pt, i) => {
            const o = limits && (vals[i] > ucl || vals[i] < lcl)
            return (
              <g key={pt.id} style={{ cursor: 'pointer' }} onClick={() => onBatch(pt.id)} onMouseEnter={() => setHover(i)} data-spc={pt.code}>
                <circle cx={x(i)} cy={y(vals[i])} r={8} style={{ fill: 'transparent' }} />
                <circle cx={x(i)} cy={y(vals[i])} r={o ? 4.5 : hover === i ? 3.5 : 2.4} style={{ fill: o ? 'var(--k-bad)' : 'var(--k-data)', opacity: pt.filled ? 1 : 0.5 }} />
              </g>
            )
          })}
        </svg>
      )}
      <p className="px-1 text-[11px] text-[var(--k-muted)]">
        Trung bình <b style={{ color: 'var(--k-ok)' }}>{devLabel(Math.round(mean * 100) / 100)}</b>
        {limits ? <> · <b style={{ color: out ? 'var(--k-bad)' : undefined }}>{out} / {n} mẻ</b> ngoài giới hạn — mẻ bất thường cần xem nguyên nhân, không phải dao động thường ngày.</> : ' · cần từ 10 mẻ để vẽ giới hạn.'}
      </p>
      {h && (
        <div className="pointer-events-none absolute top-1 z-20 w-52 rounded-lg border border-[var(--k-line)] bg-[var(--k-surface)] px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{ left: Math.min(Math.max(x(hover!) - 104, 0), Math.max(w - 208, 0)) }}>
          <div className="font-semibold">{ddmm(h.d)} · {shiftName(h.shift)} · Mẻ {h.no ?? '—'}</div>
          <div className="font-mono text-[var(--k-muted)]">{h.code}</div>
          <div>Lệch <b>{devLabel(Number(h.pct))}</b> · {h.dev} NVL lệch{h.filled ? '' : ' · chưa nạp bồn'}</div>
        </div>
      )}
    </div>
  )
}

function ExcTable({ d, onBatch }: { d: Dash; onBatch: (id: string) => void }) {
  if (!d.exc.length) return <p className="px-5 py-6 text-xs text-[var(--k-muted)]">Không có mẻ nào lệch ngoài mức trong kỳ.</p>
  const cause = (e: Dash['exc'][number]) => Math.abs(e.edit_kg) >= Math.abs(e.exec_kg) && e.edit_kg !== 0 ? ['Sửa phiếu', 'var(--k-data)'] : e.exec_kg !== 0 ? ['Cấp lệch', 'var(--k-warn)'] : ['Ngoài định mức', 'var(--k-bad)']
  return (
    <div className="overflow-x-auto px-3 sm:px-4 py-2">
      <table className="w-full min-w-[760px] text-xs [&_th]:pr-3 [&_td]:pr-3" data-testid="dash-exc">
        <thead><tr className="text-[10px] uppercase tracking-wide text-[var(--k-muted)] text-left">
          <th className="py-1 font-semibold">Ngày</th><th className="py-1 font-semibold">Ca</th><th className="py-1 font-semibold">Mẻ · mã lô</th><th className="py-1 font-semibold">BTP</th>
          <th className="py-1 font-semibold text-right">Định mức KG</th><th className="py-1 font-semibold text-right">Lệch KG</th><th className="py-1 font-semibold text-right">Lệch %</th>
          <th className="py-1 font-semibold">NVL lệch chính</th><th className="py-1 font-semibold">Nguyên nhân</th>
        </tr></thead>
        <tbody>
          {d.exc.map(e => {
            const [cz, cc] = cause(e)
            return (
              <tr key={e.id} onClick={() => onBatch(e.id)} className="cursor-pointer border-t border-[var(--k-line)] hover:bg-[var(--k-surface-2)]" data-exc={e.code}>
                <td className="py-1.5 tabular-nums">{ddmm(e.d)}</td><td className="py-1.5">{shiftName(e.shift)}</td>
                <td className="py-1.5"><b>Mẻ {e.no ?? '—'}</b> <span className="font-mono text-[var(--k-muted)]">{e.code}</span>{!e.filled && <span className="ml-1 text-[10px] text-[var(--k-muted)]">(đang làm)</span>}</td>
                <td className="py-1.5 font-mono">{e.btp}</td>
                <td className="py-1.5 text-right tabular-nums">{nf(e.std_kg, 1)}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums" style={{ color: toneColor(devTone(e.pct, d.targets.dev_pct)) }}>{sgn(e.total_kg, 1)}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums" style={{ color: toneColor(devTone(e.pct, d.targets.dev_pct)) }}>{devLabel(Number(e.pct))}</td>
                <td className="py-1.5 max-w-[14rem] truncate">{e.mat ? <><b className="font-mono">{e.mat.code}</b> <span className="text-[var(--k-muted)]">{e.mat.name ?? ''}</span> <span className="tabular-nums">{sgn(Number(e.mat.diff), 3)} {unitCode(e.mat.unit)}</span></> : '—'}</td>
                <td className="py-1.5"><span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: cc, background: `color-mix(in srgb, ${cc} 14%, transparent)` }}>{cz}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── HỘP DỮ LIỆU khi bấm vào dashboard: từng mẻ hoặc từng NVL lệch (tối đa 500 dòng + tổng); bấm một dòng ⇒ trang của mẻ ──────────────────
const STATE_TEXT: Record<string, [string, string]> = { over: ['Vượt định mức', 'var(--k-bad)'], under: ['Dưới định mức', 'var(--k-warn)'], extra: ['Ngoài định mức', 'var(--k-bad)'] }
function DetailDialog({ wh, req, onClose, onBatch }: { wh: string; req: DetailReq; onClose: () => void; onBatch: (id: string) => void }) {
  const q = useMesDashboardDetail({ warehouse_id: wh, ...req.q })
  const r = q.data
  const range = req.q.date_from === req.q.date_to ? dmy(req.q.date_from) : `${dmy(req.q.date_from)} → ${dmy(req.q.date_to)}`
  const TH = 'sticky top-0 z-[1] bg-[var(--k-surface-2)] px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--k-muted)] whitespace-nowrap'
  const TD = 'px-1.5 py-1.5 whitespace-nowrap'
  const NUM = `${TD} text-right tabular-nums`
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent onOpenAutoFocus={e => e.preventDefault()} data-testid="dash-detail"
        className="kpi-console w-[96vw] max-w-[96vw] h-[92dvh] sm:w-[92vw] sm:max-w-[1400px] sm:h-[82vh] max-h-none p-0 gap-0 flex flex-col overflow-hidden bg-[var(--k-surface)]">
        <div className="px-4 py-3 border-b border-[var(--k-line)] pr-12">
          <DialogTitle className="text-base font-semibold">{req.title}</DialogTitle>
          <div className="text-xs text-[var(--k-muted)] mt-0.5">Ngày SX {range}{r ? ` · ${nf(r.total, 0)} ${r.kind === 'batches' ? 'mẻ' : 'dòng'}${r.total > r.rows.length ? ` · hiện ${r.rows.length} dòng mới nhất — thu hẹp kỳ để xem hết` : ''}` : ''} · bấm một dòng để mở mẻ</div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {q.isError && <div className="m-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{apiMsg(q.error)}</div>}
          {q.isLoading && <p className="p-4 text-xs text-[var(--k-muted)]">Đang tải…</p>}
          {r && !r.rows.length && <p className="p-4 text-xs text-[var(--k-muted)]">Không có dòng nào.</p>}
          {r?.kind === 'batches' && r.rows.length > 0 && (
            <table className="w-full min-w-[980px] text-xs" data-testid="dash-detail-batches">
              <thead><tr>
                {['Ngày SX', 'Ca', 'Mẻ · mã lô', 'BTP', 'Tình trạng', 'Định mức KG', 'Thực cấp KG', 'Lệch KG', 'Lệch %', 'Sửa phiếu', 'Cấp lệch', 'NVL lệch', 'Chưa xong', 'Mở → nạp'].map((h, i) => <th key={h} className={`${TH} ${i >= 5 ? 'text-right' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(r.rows as DashBatchRow[]).map(x => (
                  <tr key={x.id} onClick={() => onBatch(x.id)} className="cursor-pointer border-t border-[var(--k-line)] hover:bg-[var(--k-surface-2)]" data-detail={x.code}>
                    <td className={`${TD} tabular-nums`}>{ddmm(x.d)}</td><td className={TD}>{shiftName(x.shift)}</td>
                    <td className={TD}><b>Mẻ {x.no ?? '—'}</b> <span className="font-mono text-[var(--k-muted)]">{x.code}</span></td>
                    <td className={`${TD} font-mono`} title={x.btp_name ?? ''}>{x.btp}</td>
                    <td className={TD}>{x.qa_status === 'REJECTED' ? <span style={{ color: 'var(--k-bad)' }}>QA loại</span> : x.filled ? 'Đã nạp bồn' : 'Đang làm'}</td>
                    <td className={NUM}>{nf(x.std_kg, 1)}</td><td className={NUM}>{nf(x.iss_kg, 1)}</td>
                    <td className={`${NUM} font-semibold`} style={{ color: x.over + x.under + x.extra ? (x.total_kg > 0 ? 'var(--k-bad)' : 'var(--k-warn)') : undefined }}>{sgn(x.total_kg, 1)}</td>
                    <td className={NUM}>{x.pct == null ? '—' : devLabel(Number(x.pct))}</td>
                    <td className={NUM}>{x.edit_kg ? sgn(x.edit_kg, 1) : '0'}</td><td className={NUM}>{x.exec_kg ? sgn(x.exec_kg, 1) : '0'}</td>
                    <td className={`${NUM} font-semibold`} style={{ color: x.over + x.under + x.extra ? 'var(--k-bad)' : 'var(--k-muted)' }} title={`vượt ${x.over} · dưới ${x.under} · ngoài định mức ${x.extra}`}>{x.over + x.under + x.extra}</td>
                    <td className={NUM}>{x.pending || '—'}</td>
                    <td className={NUM}>{x.open_min == null ? '—' : durLabel(x.open_min)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r?.kind === 'lines' && r.rows.length > 0 && (
            <table className="w-full min-w-[1040px] text-xs" data-testid="dash-detail-lines">
              <thead><tr>
                {['Ngày SX', 'Ca', 'Mẻ · mã lô', 'Nguyên liệu', 'ĐVT', 'Tình trạng', 'Định mức', 'Phiếu', 'Thực cấp', 'Lệch', 'Lệch %', 'Sửa phiếu', 'Cấp lệch', 'Lý do sửa'].map((h, i) => <th key={h} className={`${TH} ${i >= 6 && i <= 12 ? 'text-right' : ''}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(r.rows as DashLineRow[]).map(x => {
                  const [st, sc] = STATE_TEXT[x.state] ?? [x.state, '']
                  return (
                    <tr key={`${x.batch_id}|${x.mat_id}`} onClick={() => onBatch(x.batch_id)} className="cursor-pointer border-t border-[var(--k-line)] hover:bg-[var(--k-surface-2)]" data-detail={`${x.code}:${x.mat_code}`}>
                      <td className={`${TD} tabular-nums`}>{ddmm(x.d)}</td><td className={TD}>{shiftName(x.shift)}</td>
                      <td className={TD}><b>Mẻ {x.no ?? '—'}</b> <span className="font-mono text-[var(--k-muted)]">{x.code}</span></td>
                      <td className={`${TD} max-w-[13rem] truncate`} title={x.mat_name ?? ''}><b className="font-mono">{x.mat_code}</b> {x.mat_name ?? ''}</td>
                      <td className={`${TD} font-mono text-[var(--k-muted)]`}>{unitCode(x.unit)}</td>
                      <td className={TD} style={{ color: sc }}>{st}</td>
                      <td className={NUM}>{x.state === 'extra' && !Number(x.std) ? '—' : nf(x.std, 3)}</td><td className={NUM}>{nf(x.sheet, 3)}</td><td className={NUM}>{nf(x.iss, 3)}</td>
                      <td className={`${NUM} font-semibold`} style={{ color: sc }}>{sgn(Number(x.diff), 3)}</td>
                      <td className={NUM}>{x.pct == null ? '—' : devLabel(Number(x.pct))}</td>
                      <td className={NUM}>{Number(x.edit) ? sgn(Number(x.edit), 3) : '0'}</td><td className={NUM}>{Number(x.exec) ? sgn(Number(x.exec), 3) : '0'}</td>
                      <td className={`${TD} max-w-[12rem] truncate text-[var(--k-muted)]`} title={x.why ?? ''}>{x.why ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
