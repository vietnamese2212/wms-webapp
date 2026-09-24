// Biểu đồ ĐƯỜNG cho KPI (08/09/2026 — user chốt "1 line target, 1 line thực tế"): thực tế theo kỳ, đường
// mục tiêu (ngưỡng đạt) + vùng đạt tô nhạt, đường kỳ so (mờ, đứt). Hai chế độ: compact (sparkline trên
// thẻ, không trục) và full (dialog 80%: trục, lưới hairline, crosshair + tooltip mọi series, nhãn cuối).
// Theo skill dataviz: đường 2px bo tròn · điểm ≥8px có viền 2px màu nền · lưới 1px liền, lùi ra sau ·
// chữ luôn dùng màu chữ (không màu series) · đèn G/Y/R = màu trạng thái, chỉ tô ĐIỂM (không tô chữ).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KpiDefPublic, KpiGrain } from '@/api/hooks'
import { fmtNum } from '@/utils/productivity'

export type Rag = 'G' | 'Y' | 'R' | null
export const RAG_HEX: Record<string, string> = { G: '#10b981', Y: '#f59e0b', R: '#ef4444', none: '#94a3b8' }

export function ragOf(def: Pick<KpiDefPublic, 'dir'>, v: number | null, t: number[] | null): Rag {
  if (v == null || !t) return null
  if (def.dir === 'up') return v >= t[0] ? 'G' : v >= t[1] ? 'Y' : 'R'
  if (def.dir === 'down') return v <= t[0] ? 'G' : v <= t[1] ? 'Y' : 'R'
  return v >= t[0] && v <= t[1] ? 'G' : v <= t[2] ? 'Y' : 'R'
}
export function fmtValue(def: Pick<KpiDefPublic, 'unit' | 'decimals'>, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = fmtNum(v, def.decimals)
  return def.unit === '%' ? `${s}%` : s
}

/** Nhãn kỳ theo chu kỳ: ngày dd/MM · tuần T36 · tháng MM/yy · năm yyyy */
export function bucketLabel(grain: KpiGrain, key: string, withYear = false): string {
  if (grain === 'day') { const [y, m, d] = key.split('-'); return withYear ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}` }
  if (grain === 'week') { const [y, w] = key.split('-W'); return withYear ? `T${w}/${y}` : `T${w}` }
  if (grain === 'month') { const [y, m] = key.split('-'); return `${m}/${y.slice(2)}` }
  return key
}

export type ChartPoint = { key: string; label: string; value: number | null; prev?: number | null; from?: string; to?: string }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(es => { for (const e of es) setW(e.contentRect.width) })
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Bước lưới "tròn" (1 / 2 / 5 × 10^k) cho ~4 vạch */
function niceStep(span: number, n = 4): number {
  if (!(span > 0)) return 1
  const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

export function KpiLineChart({ def, points, target, compact = false, height, prevLabel = 'Kỳ so', grain }: {
  def: KpiDefPublic; points: ChartPoint[]; target: number[] | null
  compact?: boolean; height?: number; prevLabel?: string; grain?: KpiGrain
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const H = height ?? (compact ? 44 : 320)
  const pad = compact ? { l: 2, r: 2, t: 4, b: 4 } : { l: 48, r: 16, t: 12, b: 28 }
  const [hover, setHover] = useState<number | null>(null)

  const vals = points.map(p => p.value).filter((v): v is number => v != null && Number.isFinite(v))
  const prevs = points.map(p => p.prev ?? null).filter((v): v is number => v != null && Number.isFinite(v))
  const hasPrev = prevs.length > 0
  // Miền y: gồm giá trị, kỳ so và NGƯỜNG (đường mục tiêu phải luôn thấy) — % thì kẹp 0..100
  const dom = useMemo(() => {
    const all = [...vals, ...prevs, ...(target ?? [])]
    if (!all.length) return { lo: 0, hi: 1 }
    let lo = Math.min(...all), hi = Math.max(...all)
    if (hi === lo) { hi = lo + (lo === 0 ? 1 : Math.abs(lo) * 0.2); lo = lo - (lo === 0 ? 0 : Math.abs(lo) * 0.2) }
    const padV = (hi - lo) * 0.12
    lo -= padV; hi += padV
    if (def.unit === '%') { lo = Math.max(0, lo); hi = Math.min(100, hi) }
    else lo = Math.max(0, lo)
    if (hi <= lo) hi = lo + 1
    return { lo, hi }
  }, [vals, prevs, target, def.unit])

  const W = Math.max(0, width)
  const iw = Math.max(1, W - pad.l - pad.r), ih = Math.max(1, H - pad.t - pad.b)
  const n = points.length
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const y = (v: number) => pad.t + ih - ((v - dom.lo) / (dom.hi - dom.lo)) * ih
  const clampY = (v: number) => Math.max(pad.t, Math.min(pad.t + ih, y(v)))

  // Đường thực tế: ngắt tại kỳ không có số (không nối liền qua lỗ hổng dữ liệu)
  const pathOf = (get: (p: ChartPoint) => number | null | undefined) => {
    let d = '', pen = false
    points.forEach((p, i) => {
      const v = get(p)
      if (v == null || !Number.isFinite(v)) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; pen = true
    })
    return d
  }
  const actualPath = pathOf(p => p.value)
  const prevPath = hasPrev ? pathOf(p => p.prev) : ''

  // Vùng ĐẠT (xanh nhạt) theo chiều tốt
  const goodBand = target ? (def.dir === 'up' ? [target[0], dom.hi] : def.dir === 'down' ? [dom.lo, target[0]] : [target[0], target[1]]) : null

  // Lưới + vạch trục y (full)
  const ticks = useMemo(() => {
    if (compact) return [] as number[]
    const step = niceStep(dom.hi - dom.lo)
    const out: number[] = []
    for (let v = Math.ceil(dom.lo / step) * step; v <= dom.hi + 1e-9; v += step) out.push(Number(v.toFixed(6)))
    return out
  }, [dom, compact])
  // Nhãn x: tối đa ~8 nhãn, luôn có đầu và cuối
  const labelEvery = Math.max(1, Math.ceil(n / (compact ? 1 : Math.max(2, Math.floor(iw / 72)))))

  const lastIdx = (() => { for (let i = n - 1; i >= 0; i--) if (points[i].value != null) return i; return -1 })()

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (compact || n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = n <= 1 ? 0 : Math.round(((px - pad.l) / iw) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const hp = hover != null ? points[hover] : null
  const targetText = target
    ? (def.dir === 'band' ? `${fmtNum(target[0], 2)}–${fmtValue(def, target[1])}` : `${def.dir === 'up' ? '≥' : '≤'} ${fmtValue(def, target[0])}`)
    : 'chưa đặt'

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height: H }}>
      {W > 0 && (
        <svg width={W} height={H} className="block" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
          aria-label={`${def.name}: ${n} kỳ, mục tiêu ${targetText}`}>
          {/* vùng đạt */}
          {goodBand && goodBand[1] > goodBand[0] && (
            <rect x={pad.l} width={iw} y={clampY(goodBand[1])} height={Math.max(0, clampY(goodBand[0]) - clampY(goodBand[1]))} fill="#10b981" opacity={0.10} />
          )}
          {/* lưới hairline liền, lùi ra sau */}
          {!compact && ticks.map(t => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">{fmtValue(def, t)}</text>
            </g>
          ))}
          {/* đường mục tiêu (đạt) + ngưỡng chú ý */}
          {target && (
            <>
              <line x1={pad.l} x2={pad.l + iw} y1={y(target[0])} y2={y(target[0])} stroke="#475569" strokeWidth={compact ? 1 : 1.5} strokeDasharray="6 4" />
              {def.dir === 'band' && <line x1={pad.l} x2={pad.l + iw} y1={y(target[1])} y2={y(target[1])} stroke="#475569" strokeWidth={compact ? 1 : 1.5} strokeDasharray="6 4" />}
              {!compact && (
                <line x1={pad.l} x2={pad.l + iw} y1={y(target[def.dir === 'band' ? 2 : 1])} y2={y(target[def.dir === 'band' ? 2 : 1])} stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 4" />
              )}
              {!compact && <text x={pad.l + iw} y={y(target[0]) - 4} textAnchor="end" className="fill-slate-600 dark:fill-slate-300 text-[10px]">Mục tiêu {targetText}</text>}
            </>
          )}
          {/* kỳ so */}
          {hasPrev && <path d={prevPath} fill="none" stroke="#94a3b8" strokeWidth={compact ? 1 : 1.5} strokeDasharray="3 3" strokeLinejoin="round" strokeLinecap="round" />}
          {/* thực tế */}
          <path d={actualPath} fill="none" stroke="#0284c7" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* điểm: tô theo đèn, viền 2px màu nền */}
          {points.map((p, i) => p.value != null && (
            <circle key={p.key} cx={x(i)} cy={y(p.value)} r={compact ? 2.5 : 4} fill={RAG_HEX[ragOf(def, p.value, target) ?? 'none']}
              stroke="white" strokeWidth={compact ? 1 : 2} className="dark:stroke-slate-800" />
          ))}
          {/* nhãn điểm cuối (một nhãn trực tiếp, không rải mọi điểm) */}
          {!compact && lastIdx >= 0 && (
            <text x={Math.min(x(lastIdx) + 6, pad.l + iw)} y={y(points[lastIdx].value as number) - 8} textAnchor={lastIdx === n - 1 ? 'end' : 'start'}
              className="fill-slate-800 dark:fill-slate-100 text-[11px] font-semibold tabular-nums">{fmtValue(def, points[lastIdx].value)}</text>
          )}
          {/* nhãn trục x */}
          {!compact && points.map((p, i) => (i % labelEvery === 0 || i === n - 1) && (
            <text key={p.key} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">{p.label}</text>
          ))}
          {/* crosshair */}
          {!compact && hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#0f172a" strokeWidth={1} opacity={0.35} />
          )}
        </svg>
      )}
      {/* tooltip: mọi series tại một X, giá trị đứng trước nhãn */}
      {!compact && hp && (
        <div className="pointer-events-none absolute top-1 z-10 rounded border border-slate-200 dark:border-slate-600 bg-white/95 dark:bg-slate-800/95 px-2 py-1.5 text-[11px] shadow"
          style={{ left: Math.min(Math.max(0, x(hover!) + 10), Math.max(0, W - 190)) }}>
          <div className="font-medium text-slate-700 dark:text-slate-200 mb-0.5">
            {grain ? bucketLabel(grain, hp.key, true) : hp.label}{hp.from && hp.to && hp.from !== hp.to ? <span className="text-slate-400"> · {hp.from} → {hp.to}</span> : null}
          </div>
          <div className="flex items-center gap-1.5"><span className="inline-block w-3 border-t-2 border-sky-600" /><b className="tabular-nums text-slate-900 dark:text-white">{fmtValue(def, hp.value)}</b><span className="text-slate-500">Thực tế</span>
            {hp.value != null && <span className="inline-block h-2 w-2 rounded-full" style={{ background: RAG_HEX[ragOf(def, hp.value, target) ?? 'none'] }} />}</div>
          <div className="flex items-center gap-1.5"><span className="inline-block w-3 border-t-2 border-dashed border-slate-500" /><b className="tabular-nums text-slate-700 dark:text-slate-200">{targetText}</b><span className="text-slate-500">Mục tiêu</span></div>
          {hasPrev && <div className="flex items-center gap-1.5"><span className="inline-block w-3 border-t-2 border-dotted border-slate-400" /><b className="tabular-nums text-slate-700 dark:text-slate-200">{fmtValue(def, hp.prev ?? null)}</b><span className="text-slate-500">{prevLabel}</span></div>}
        </div>
      )}
    </div>
  )
}

/** Chú giải cho ≥2 series (thực tế · mục tiêu · kỳ so) — luôn hiện ở chế độ full */
export function KpiChartLegend({ hasPrev, prevLabel = 'Kỳ so' }: { hasPrev: boolean; prevLabel?: string }) {
  return (
    <div className="flex items-center gap-4 text-[11px] text-slate-600 dark:text-slate-300">
      <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-sky-600" /> Thực tế</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-dashed border-slate-500" /> Mục tiêu (đạt)</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t border-dashed border-amber-500" /> Ngưỡng chú ý</span>
      {hasPrev && <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-dotted border-slate-400" /> {prevLabel}</span>}
      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /><span className="inline-block h-2 w-2 rounded-full bg-amber-500" /><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> điểm tô theo đèn</span>
    </div>
  )
}
