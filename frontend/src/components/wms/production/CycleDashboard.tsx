// TỔNG QUAN của Báo cáo NVL theo chu kỳ (21/11 — user: "báo cáo đã có dữ liệu thô rồi, vậy cần xem được dashboard ở đây — cái người ta
// quan tâm là ĐỊNH MỨC và SỰ CHÊNH LỆCH của từng ca, từng mẻ"). User chốt: so với ĐỊNH MỨC GỐC theo công thức, lệch tách SỬA PHIẾU / CẤP
// LỆCH; lệch của mẻ / ca = KG cộng dồn + số NVL lệch; ca = ca của một ngày. Mọi số đọc từ utils/cycleReport.ts (devAgg · materialDevs ·
// cellDev) — cùng hàm với dải số và Excel "Lệch theo ca · mẻ".
//   • Biểu đồ "Lệch so định mức theo mẻ": mỗi mẻ một cột (lệch KG %, trên 0 = cấp nhiều hơn định mức), xếp theo ca; đỏ = mẻ có NVL lệch
//     ngoài mức cho phép, xám = mọi NVL trong mức; mẻ chưa nạp bồn vẽ nhạt. Rê / chạm xem chi tiết; bấm ⇒ mở mẻ đó ở bảng dưới.
//   • "NVL lệch nhiều nhất": bấm ⇒ sang NVL × ca, mở sẵn dòng đó.
//   • Bảng "Theo ca · mẻ": dòng ca (tổng ca) → từng mẻ; bấm mẻ ⇒ từng NVL của mẻ (định mức · phiếu · thực cấp · lệch · lý do sửa).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import type { CycleBatch, CycleRow } from '@/api/productionHooks'
import { StageSymbol, StageBadge } from './BatchStage'
import { MobileNumHead, MobileNumRow, type NumCol } from './MobileNumGrid'
import { devAgg, devLines, materialDevs, cellDev, cellState, isFilled, isDevState, devPctOf, LINE_STATE_LABEL, type DevAgg, type ShiftGroup } from '@/utils/cycleReport'
import { devLabel } from '@/utils/reqTolerance'
import { qtyNum, matUnitCode } from '@/utils/unitCode'
import { useElementWidth } from '@/hooks/useElementWidth'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
/** số có dấu: +1.234 · −56 · 0 */
export const sgn = (n: number) => (n > 0 ? `+${nf(n)}` : n < 0 ? `−${nf(Math.abs(n))}` : '0')
const dash = <span className="text-slate-300 font-normal">—</span>
/** màu số lệch: chỉ tô khi nhóm có NVL lệch ngoài mức cho phép (lệch nhỏ trong mức không phải báo động) */
export const devTone = (total: number, a: Pick<DevAgg, 'over' | 'under' | 'extra'>) =>
  devLines(a) === 0 || total === 0 ? 'text-slate-700' : total > 0 ? 'text-red-600' : 'text-amber-700'
const lineTone = (s: string | null) => (s === 'over' || s === 'extra' ? 'text-red-600' : s === 'under' ? 'text-amber-700' : s === 'ok' ? 'text-slate-900' : 'text-slate-400')
const devTip = (a: DevAgg) => `Vượt ${a.over} · dưới định mức ${a.under} · ngoài định mức ${a.extra}`
const BAR_DEV = '#dc4448', BAR_OK = '#94a3b8'

interface Props {
  rows: CycleRow[]
  live: CycleBatch[]
  groups: ShiftGroup<CycleBatch>[]
  /** sang NVL × ca, mở sẵn dòng NVL này */
  onOpenNvl: (materialId: string) => void
}

export function CycleDashboard({ rows, live, groups, onOpenNvl }: Props) {
  const navigate = useNavigate()
  const per = useMemo(() => new Map(live.map(b => [b.id, devAgg(rows, [b])])), [rows, live])
  const perGroup = useMemo(() => groups.map(g => devAgg(rows, g.batches)), [rows, groups])
  const all = useMemo(() => devAgg(rows, live), [rows, live])
  const mats = useMemo(() => materialDevs(rows, live).slice(0, 6), [rows, live])
  const [open, setOpen] = useState<string | null>(null)
  const [jump, setJump] = useState<string | null>(null)
  // bấm cột của biểu đồ ⇒ mở mẻ đó trong bảng và cuộn tới
  useEffect(() => {
    if (!jump) return
    const el = document.querySelector(`[data-dash-batch="${jump}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setJump(null)
  }, [jump])
  const pick = (id: string) => { setOpen(id); setJump(id) }

  if (!live.length) return <p className="p-3 text-xs text-slate-500">Chu kỳ này chưa có mẻ.</p>

  return (
    <div className="p-2 sm:p-3 space-y-2 sm:space-y-3" data-testid="cycle-dash">
      <div className="grid gap-2 sm:gap-3 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-lg border border-slate-200 bg-white p-2 sm:p-3 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
            <h3 className="text-xs font-semibold text-slate-800">Lệch so định mức theo mẻ</h3>
            <span className="text-[10px] text-slate-500">% theo KG · trên 0 = cấp nhiều hơn định mức</span>
            <span className="ml-auto flex items-center gap-3 text-[10px] text-slate-600">
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAR_DEV }} />Có NVL lệch</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: BAR_OK }} />Trong mức</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm opacity-40" style={{ background: BAR_OK }} />Chưa nạp bồn</span>
            </span>
          </div>
          <DevBarChart groups={groups} per={per} onPick={pick} />
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-2 sm:p-3 min-w-0" data-testid="dash-top-nvl">
          <h3 className="text-xs font-semibold text-slate-800 mb-1">NVL lệch nhiều nhất</h3>
          {!mats.length && <p className="text-[11px] text-slate-400 py-2">Chưa có NVL nào lệch định mức.</p>}
          <div className="divide-y divide-slate-100">
            {mats.map(m => {
              const r = rows[m.row]
              return (
                <button key={r.material_id} type="button" onClick={() => onOpenNvl(r.material_id)} data-top-mat={r.material_code}
                  className="w-full text-left py-1.5 hover:bg-slate-50 rounded" title="Xem từng mẻ của NVL này (NVL × ca)">
                  <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                    <span className="font-mono font-semibold shrink-0">{r.material_code}</span>
                    <span className="truncate text-slate-600">{r.material_name ?? ''}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-red-600 font-semibold">{m.devBatches}/{m.batches} mẻ</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] tabular-nums text-slate-500">
                    <span>Định mức {qtyNum(m.std, r)} {matUnitCode(r)}</span>
                    <span className={`ml-auto font-semibold ${m.total > 0 ? 'text-red-600' : m.total < 0 ? 'text-amber-700' : 'text-slate-700'}`}>
                      {sgn(m.total)} {matUnitCode(r)}{m.pct != null ? ` · ${devLabel(m.pct)}` : ''}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      {/* THEO CA · MẺ — máy tính: bảng; điện thoại: lưới số */}
      <section className="rounded-lg border border-slate-200 bg-white min-w-0 overflow-hidden">
        <h3 className="px-2 sm:px-3 pt-2 pb-1 text-xs font-semibold text-slate-800">Theo ca · mẻ <span className="font-normal text-slate-500">— KG, dòng NVL đã cấp xong</span></h3>
        <div className="hidden sm:block">
          <DashTable rows={rows} groups={groups} per={per} perGroup={perGroup} all={all} open={open} setOpen={setOpen} onOpenBatch={id => navigate(`/wms/production/${id}`)} />
        </div>
        <div className="sm:hidden">
          <DashMobile rows={rows} groups={groups} per={per} perGroup={perGroup} all={all} open={open} setOpen={setOpen} onOpenBatch={id => navigate(`/wms/production/${id}`)} />
        </div>
      </section>
    </div>
  )
}

// ── Biểu đồ cột lệch % theo mẻ (SVG tự vẽ — cùng cách KpiLineChart) ─────────────────────────────────────────────────────────────────────
function niceStep(span: number, n = 3): number {
  if (!(span > 0)) return 1
  const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

function DevBarChart({ groups, per, onPick }: { groups: ShiftGroup<CycleBatch>[]; per: Map<string, DevAgg>; onPick: (id: string) => void }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const items = useMemo(() => groups.flatMap((g, gi) => g.batches.map(b => ({ g, gi, b, a: per.get(b.id)! }))), [groups, per])
  const H = width < 500 ? 150 : 180, padL = 40, padR = 6, padT = 8, padB = 30, GAP = 10
  const vals = items.map(x => x.a.kg.pct).filter((v): v is number => v != null)
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
  if (lo === hi) { lo = -1; hi = 1 }
  const step = niceStep(hi - lo)
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step
  const innerW = Math.max(width - padL - padR - GAP * (groups.length - 1), 10)
  const band = items.length ? innerW / items.length : 0
  const bw = Math.max(Math.min(band * 0.62, 28), 3)
  const y = (v: number) => padT + (hi - v) / (hi - lo) * (H - padT - padB)
  const xOf = (i: number) => padL + i * band + items[i].gi * GAP
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100)
  const h = hover != null ? items[hover] : null
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height: H }} onPointerLeave={() => setHover(null)} data-testid="dash-chart">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Lệch so định mức theo mẻ">
          {ticks.map(v => (
            <g key={v}>
              <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth={1} />
              <text x={padL - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#64748b">{v === 0 ? '0' : devLabel(v)}</text>
            </g>
          ))}
          {/* tên ca dưới mỗi nhóm mẻ + vạch ngăn ca */}
          {groups.map((g, gi) => {
            const first = items.findIndex(x => x.gi === gi)
            const last = first + g.batches.length - 1
            if (first < 0) return null
            const x0 = xOf(first), x1 = xOf(last) + band
            return (
              <g key={g.shift}>
                <text x={(x0 + x1) / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="#334155" fontWeight={600}>{g.shift}</text>
                {gi > 0 && <line x1={x0 - GAP / 2} x2={x0 - GAP / 2} y1={padT} y2={H - padB + 4} stroke="#e2e8f0" strokeDasharray="2 3" />}
              </g>
            )
          })}
          {items.map((x, i) => {
            const v = x.a.kg.pct
            const cx = xOf(i) + band / 2
            const dev = devLines(x.a) > 0
            const filled = isFilled(x.b)
            const y0 = y(0)
            const yv = v == null ? y0 : y(v)
            const top = Math.min(y0, yv), hgt = Math.max(Math.abs(yv - y0), v != null && v !== 0 ? 2 : 0)
            return (
              <g key={x.b.id} data-bar={x.b.batch_code}>
                {v == null
                  ? <line x1={cx - bw / 2} x2={cx + bw / 2} y1={y0} y2={y0} stroke="#cbd5e1" strokeWidth={2} strokeDasharray="2 2" />
                  : <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(hgt, 2)} rx={Math.min(2, bw / 2)}
                      fill={dev ? BAR_DEV : BAR_OK} opacity={filled ? 1 : 0.4} stroke={hover === i ? '#0f172a' : 'none'} strokeWidth={hover === i ? 1.5 : 0} />}
                {band >= 14 && <text x={cx} y={H - padB + 11} textAnchor="middle" fontSize={8} fill="#94a3b8">{x.b.batch_no ?? ''}</text>}
                {/* vùng bấm rộng hơn cột */}
                <rect x={xOf(i)} y={padT} width={band} height={H - padT - padB + 14} fill="transparent" style={{ cursor: 'pointer' }}
                  onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onClick={() => onPick(x.b.id)} />
              </g>
            )
          })}
        </svg>
      )}
      {h && (
        <div className="pointer-events-none absolute z-20 w-56 rounded-md border border-slate-200 bg-white/95 px-2 py-1.5 text-[10px] shadow-md"
          style={{ left: Math.min(Math.max(xOf(hover!) + band / 2 - 112, 0), Math.max(width - 224, 0)), top: 0 }}>
          <div className="flex items-center gap-1 font-semibold text-slate-800"><StageSymbol stage={h.b.stage} step={h.b.step} className="h-3 w-3" />{h.g.shift} · Mẻ {h.b.batch_no ?? '—'} <span className="font-mono font-normal text-slate-500">{h.b.batch_code}</span></div>
          {h.a.kg.std > 0 || h.a.kg.iss > 0 ? (
            <div className="mt-0.5 space-y-0.5 tabular-nums text-slate-600">
              <div>Định mức {nf(h.a.kg.std)} · thực cấp {nf(h.a.kg.iss)} KG</div>
              <div className={`font-semibold ${devTone(h.a.kg.total, h.a)}`}>Lệch {sgn(h.a.kg.total)} KG{h.a.kg.pct != null ? ` (${devLabel(h.a.kg.pct)})` : ''}</div>
              <div>Sửa phiếu {sgn(h.a.kg.edit)} · cấp lệch {sgn(h.a.kg.exec)}</div>
            </div>
          ) : <div className="text-slate-400 mt-0.5">Chưa có dòng NVL nào cấp xong</div>}
          <div className={devLines(h.a) ? 'text-red-600' : 'text-slate-500'}>NVL lệch {devLines(h.a)}{devLines(h.a) ? ` (${devTip(h.a).toLowerCase()})` : ''}</div>
          {h.a.pending > 0 && <div className="text-slate-400">{h.a.pending} dòng chưa cấp xong — chưa tính</div>}
        </div>
      )}
    </div>
  )
}

// ── Bảng Theo ca · mẻ (máy tính) ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface TableProps {
  rows: CycleRow[]; groups: ShiftGroup<CycleBatch>[]; per: Map<string, DevAgg>; perGroup: DevAgg[]; all: DevAgg
  open: string | null; setOpen: (id: string | null) => void; onOpenBatch: (id: string) => void
}
const KG = (label: string, tip: string) => <span className="block leading-tight text-right" title={tip}>{label}<span className="block font-normal text-slate-400">KG</span></span>
const DASH_COLS: RtColDef[] = [
  { id: 'cm', label: 'Ca · Mẻ', w: 170 }, { id: 'btp', label: 'BTP', w: 96 }, { id: 'st', label: 'Tình trạng', w: 110 },
  { id: 'std', label: 'Định mức', w: 84, align: 'right', head: KG('Định mức', 'Định mức gốc theo công thức × kế hoạch mẻ') },
  { id: 'iss', label: 'Thực cấp', w: 84, align: 'right', head: KG('Thực cấp', 'Lần cấp còn hiệu lực') },
  { id: 'dev', label: 'Lệch', w: 80, align: 'right', head: KG('Lệch', 'Thực cấp − định mức') },
  { id: 'pct', label: 'Lệch %', w: 60, align: 'right' },
  { id: 'edit', label: 'Sửa phiếu', w: 80, align: 'right', head: KG('Sửa phiếu', 'Phiếu của mẻ − định mức: trưởng ca sửa / thêm / bỏ dòng (có lý do)') },
  { id: 'exec', label: 'Cấp lệch', w: 80, align: 'right', head: KG('Cấp lệch', 'Thực cấp − phiếu của mẻ') },
  { id: 'nvl', label: 'NVL lệch', w: 64, align: 'right', head: <span title="Số dòng NVL lệch định mức ngoài mức cho phép: vượt · dưới · ngoài định mức (mọi đơn vị, kể cả mã nhỏ)">NVL lệch</span> },
  { id: 'pend', label: 'Chưa xong', w: 66, align: 'right', head: <span title="Dòng NVL đang cấp dở / chưa cấp — chưa tính vào số lệch">Chưa xong</span> },
]

function aggCells(a: DevAgg, strong = false) {
  const w = strong ? '' : 'font-normal text-slate-600'
  return <>
    <TableCell className={`${NUM} ${w}`}>{a.kg.std ? nf(a.kg.std) : dash}</TableCell>
    <TableCell className={`${NUM} ${w}`}>{a.kg.iss ? nf(a.kg.iss) : dash}</TableCell>
    <TableCell className={`${NUM} ${devTone(a.kg.total, a)}`}>{a.kg.std || a.kg.iss ? sgn(a.kg.total) : dash}</TableCell>
    <TableCell className={`${NUM} ${devTone(a.kg.total, a)}`}>{a.kg.pct != null ? devLabel(a.kg.pct) : dash}</TableCell>
    <TableCell className={`${NUM} ${a.kg.edit ? 'text-slate-800' : 'font-normal text-slate-300'}`}>{a.kg.edit ? sgn(a.kg.edit) : '0'}</TableCell>
    <TableCell className={`${NUM} ${a.kg.exec ? 'text-slate-800' : 'font-normal text-slate-300'}`}>{a.kg.exec ? sgn(a.kg.exec) : '0'}</TableCell>
    <TableCell className={`${NUM} ${devLines(a) ? 'text-red-600' : 'font-normal text-slate-300'}`} title={devTip(a)}>{devLines(a)}</TableCell>
    <TableCell className={`${NUM} ${a.pending ? 'text-slate-500' : 'font-normal text-slate-300'}`}>{a.pending}</TableCell>
  </>
}

function DashTable({ rows, groups, per, perGroup, all, open, setOpen, onOpenBatch }: TableProps) {
  return (
    <ResizableTable storageKey="production_cycle_dash_v1" cols={DASH_COLS}>
      <TableBody>
        {!groups.length && <TableEmptyRow colSpan={DASH_COLS.length}>Chu kỳ này chưa có mẻ.</TableEmptyRow>}
        {groups.map((g, gi) => {
          const ga = perGroup[gi]
          return (
            <Fragment key={g.shift}>
              <TableRow className="bg-slate-100 hover:bg-slate-100" data-dash-shift={g.shift}>
                <TableCell colSpan={3} className={`${TD} sticky left-0 z-10 bg-slate-100 text-[11px] font-semibold text-slate-800`}>
                  {g.shift} <span className="font-normal text-slate-500">· {ga.batches} mẻ · đã nạp {ga.filled}</span>
                </TableCell>
                {aggCells(ga, true)}
              </TableRow>
              {g.batches.map(b => {
                const a = per.get(b.id)!
                const isOpen = open === b.id
                return (
                  <Fragment key={b.id}>
                    <TableRow data-dash-batch={b.id} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.id)} className={`cursor-pointer hover:bg-sky-50 ${isOpen ? 'bg-sky-50/60' : ''}`}>
                      <TableCell className={`${TD} sticky left-0 z-10 ${isOpen ? 'bg-sky-50' : 'bg-white'}`}>
                        <span className="inline-flex items-center gap-1 max-w-full">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                          <StageSymbol stage={b.stage} step={b.step} className="h-3 w-3" />
                          <span>Mẻ {b.batch_no ?? '—'}</span><span className="font-mono text-slate-500 truncate">{b.batch_code}</span>
                        </span>
                      </TableCell>
                      <TableCell className={`${TD} font-mono truncate`} title={b.material_name ?? ''}>{b.material_code}</TableCell>
                      <TableCell className={TD}><StageBadge stage={b.stage} step={b.step} /></TableCell>
                      {aggCells(a)}
                    </TableRow>
                    {isOpen && <BatchLines rows={rows} b={b} onOpenBatch={onOpenBatch} />}
                  </Fragment>
                )
              })}
            </Fragment>
          )
        })}
        {groups.length > 0 && (
          <TableRow className="bg-sky-50 hover:bg-sky-50 border-t-2 border-t-sky-300" data-dash-shift="__all">
            <TableCell colSpan={3} className={`${TD} sticky left-0 z-10 bg-sky-50 text-[11px] font-semibold text-slate-900`}>
              Cả chu kỳ <span className="font-normal text-slate-500">· {all.batches} mẻ · đã nạp {all.filled}</span>
            </TableCell>
            {aggCells(all, true)}
          </TableRow>
        )}
      </TableBody>
    </ResizableTable>
  )
}

/** từng NVL của một mẻ: định mức (± mức lệch) · phiếu (+ lý do sửa) · thực cấp · lệch · lệch % · sửa phiếu · cấp lệch · tình trạng */
function BatchLines({ rows, b, onOpenBatch }: { rows: CycleRow[]; b: CycleBatch; onOpenBatch: (id: string) => void }) {
  const lines = rows.filter(r => r.cells[b.id])
  return <>
    {lines.map(r => {
      const c = r.cells[b.id]
      const st = cellState(c, isFilled(b))
      const d = cellDev(c)
      const settled = st !== 'progress' && st !== 'none'
      const pct = devPctOf(d.total, d.std)
      const tone = lineTone(st)
      return (
        <TableRow key={r.material_id} className="bg-slate-50/70 hover:bg-slate-50" data-dash-line={`${b.batch_code}:${r.material_code}`}>
          <TableCell colSpan={2} className={`${TD} sticky left-0 z-10 bg-slate-50 pl-8`} title={r.material_name ?? ''}>
            <span className="inline-flex items-center gap-1 max-w-full">
              <span className="font-mono font-semibold">{r.material_code}</span><span className="truncate text-slate-600">{r.material_name ?? ''}</span>
              <span className="shrink-0 font-mono text-[9px] text-slate-400">{matUnitCode(r)}</span>
            </span>
          </TableCell>
          <TableCell className={`${TD} ${tone}`}>{st ? LINE_STATE_LABEL[st] : ''}</TableCell>
          <TableCell className={`${NUM} font-normal text-slate-600`}>
            {c.std == null ? <span className="text-slate-400">—</span> : qtyNum(d.std, r)}{c.tol != null && c.std != null && <span className="ml-1 text-[9px] text-slate-400">±{c.tol}%</span>}
          </TableCell>
          <TableCell className={`${NUM} ${tone}`}>{qtyNum(d.iss, r)}</TableCell>
          <TableCell className={`${NUM} ${settled ? tone : 'text-slate-400 font-normal'}`}>{sgn(d.total)}</TableCell>
          <TableCell className={`${NUM} ${settled ? tone : 'text-slate-400 font-normal'}`}>{pct != null ? devLabel(pct) : dash}</TableCell>
          <TableCell className={`${NUM} ${d.edit ? 'text-slate-800' : 'font-normal text-slate-300'}`}
            title={d.edit ? `Phiếu của mẻ ${qtyNum(d.sheet, r)} ${matUnitCode(r)}${c.rm ? ' (đã bỏ khỏi phiếu)' : c.std == null ? ' (thêm vào phiếu)' : ''}${c.why ? ` — lý do: ${c.why}` : ''}` : 'Phiếu đúng định mức'}>
            {d.edit ? sgn(d.edit) : '0'}{c.why && <span className="ml-0.5 text-sky-600">ⓘ</span>}
          </TableCell>
          <TableCell className={`${NUM} ${d.exec ? 'text-slate-800' : 'font-normal text-slate-300'}`}>{d.exec ? sgn(d.exec) : '0'}</TableCell>
          <TableCell colSpan={2} className={`${TD} text-slate-500 truncate`} title={c.why ?? ''}>{c.rm ? 'Bỏ khỏi phiếu' : c.why ?? ''}</TableCell>
        </TableRow>
      )
    })}
    <TableRow className="bg-slate-50/70 hover:bg-slate-50">
      <TableCell colSpan={DASH_COLS.length} className={`${TD} pl-8`}>
        <button type="button" onClick={() => onOpenBatch(b.id)} className="text-sky-700 hover:underline">Mở mẻ {b.batch_code} ›</button>
        <span className="ml-3 text-slate-400">NVL khác đơn vị KG (BAG…) không cộng vào cột KG của mẻ — xem từng dòng ở đây</span>
      </TableCell>
    </TableRow>
  </>
}

// ── Theo ca · mẻ (điện thoại) ────────────────────────────────────────────────────────────────────────────────────────────────────────
const M_COLS: NumCol[] = [{ label: 'Định mức', title: 'KG — định mức gốc' }, { label: 'Thực cấp', title: 'KG' }, { label: 'Lệch', title: 'KG · %' }]
function DashMobile({ rows, groups, per, perGroup, all, open, setOpen, onOpenBatch }: TableProps) {
  const num = (a: DevAgg) => [
    <span className="font-normal">{a.kg.std ? nf(a.kg.std) : '—'}</span>,
    a.kg.iss ? nf(a.kg.iss) : '—',
    <span className={devTone(a.kg.total, a)}>{a.kg.pct != null ? devLabel(a.kg.pct) : a.kg.total ? sgn(a.kg.total) : '—'}</span>,
  ]
  const badge = (a: DevAgg) => devLines(a) > 0
    ? <span className="ml-auto shrink-0 text-[10px] font-semibold text-red-600" title={devTip(a)}>{devLines(a)} NVL lệch</span>
    : <span className="ml-auto shrink-0 text-[10px] text-slate-400">{a.pending ? `${a.pending} chưa xong` : 'trong mức'}</span>
  return (
    <div>
      <MobileNumHead cols={M_COLS} />
      {groups.map((g, gi) => (
        <div key={g.shift} data-dash-shift={g.shift}>
          <MobileNumRow className="bg-slate-100" head={<><b className="text-slate-800">{g.shift}</b><span className="text-[10px] text-slate-500">{perGroup[gi].batches} mẻ</span>{badge(perGroup[gi])}</>} cells={num(perGroup[gi])} />
          <div className="divide-y divide-slate-100">
            {g.batches.map(b => {
              const a = per.get(b.id)!
              const isOpen = open === b.id
              return (
                <div key={b.id} data-dash-batch={b.id}>
                  <button type="button" className="w-full text-left" onClick={() => setOpen(isOpen ? null : b.id)} aria-expanded={isOpen}>
                    <MobileNumRow head={<>
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                      <StageSymbol stage={b.stage} step={b.step} className="h-3 w-3" />
                      <span className="shrink-0">Mẻ {b.batch_no ?? '—'}</span><span className="font-mono text-[10px] text-slate-500 truncate">{b.batch_code}</span>
                      {badge(a)}
                    </>} cells={num(a)} />
                  </button>
                  {isOpen && (
                    <div className="bg-slate-50 px-3 py-1.5 space-y-1">
                      {rows.filter(r => r.cells[b.id]).map(r => {
                        const c = r.cells[b.id]
                        const st = cellState(c, isFilled(b))
                        const d = cellDev(c)
                        const pct = devPctOf(d.total, d.std)
                        return (
                          <div key={r.material_id} className="text-[11px]">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="font-mono font-semibold shrink-0">{r.material_code}</span>
                              <span className="truncate text-slate-600">{r.material_name ?? ''}</span>
                              <span className={`ml-auto shrink-0 text-[10px] ${lineTone(st)}`}>{st ? LINE_STATE_LABEL[st] : ''}</span>
                            </div>
                            <div className="flex gap-2 tabular-nums text-[10px] text-slate-500">
                              <span>ĐM {c.std == null ? '—' : qtyNum(d.std, r)}</span><span>cấp {qtyNum(d.iss, r)} {matUnitCode(r)}</span>
                              <span className={`ml-auto font-semibold ${isDevState(st) ? lineTone(st) : 'text-slate-600'}`}>{sgn(d.total)}{pct != null ? ` · ${devLabel(pct)}` : ''}</span>
                            </div>
                            {(d.edit !== 0 || c.why) && <div className="text-[10px] text-slate-500">Sửa phiếu {sgn(d.edit)}{c.why ? ` — ${c.why}` : ''}</div>}
                          </div>
                        )
                      })}
                      <button type="button" onClick={() => onOpenBatch(b.id)} className="text-[11px] text-sky-700 py-1">Mở mẻ {b.batch_code} ›</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <MobileNumRow className="bg-sky-50 border-t-2 border-sky-300" head={<><b className="text-slate-900">Cả chu kỳ</b><span className="text-[10px] text-slate-500">{all.batches} mẻ</span>{badge(all)}</>} cells={num(all)} />
    </div>
  )
}
