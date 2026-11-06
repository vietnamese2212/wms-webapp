// Biểu đồ của tab KPI theo phong cách "trung tâm điều hành" (11/2026, mẫu Du lieu mau/ui kpi): donut đèn,
// thanh chồng theo nhóm, xếp hạng kho, bản đồ nhiệt KPI × kỳ, đồng hồ sức chứa. SVG/CSS thuần như KpiLineChart,
// không thêm thư viện. Chỉ VẼ số BE trả — không tự tính KPI. Màu đỏ/vàng/xanh luôn đi kèm chữ (đèn không chỉ bằng màu).
import { useState, type ReactNode } from 'react'
import type { KpiBucket, KpiDefPublic, KpiGrain, KpiValue } from '@/api/hooks'
import { useEdgeFade } from '@/hooks/useEdgeFade'
import { fmtNum } from '@/utils/productivity'
import { kpiGap, squarify } from '@/utils/kpiView'
import { bucketLabel, fmtValue, ragOf } from '@/components/wms/KpiLineChart'

export type RagKey = 'G' | 'Y' | 'R' | 'none'
export const RAG_VAR: Record<RagKey, string> = { G: 'var(--k-ok)', Y: 'var(--k-warn)', R: 'var(--k-bad)', none: 'var(--k-none)' }
const RAG_WORD: Record<RagKey, string> = { G: 'Đạt', Y: 'Cần chú ý', R: 'Không đạt', none: 'Chưa có đèn' }
// Nền ô nhiệt: mã màu kèm độ trong suốt để hoà vào nền thẻ ở cả sáng lẫn tối
const RAG_TINT: Record<RagKey, string> = { G: '#17946a40', Y: '#e39a2550', R: '#dc444845', none: '#8a96ab2e' }

/** Khung thẻ: tiêu đề + chú thích / điều khiển bên phải. */
export function KpiPanel({ title, hint, right, children, className = '' }: {
  title: ReactNode; hint?: ReactNode; right?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`k-card flex flex-col ${className}`}>
      <header className="flex items-center gap-x-3 gap-y-1.5 flex-wrap px-4 sm:px-5 py-3 border-b border-[var(--k-line)]">
        <h2 className="text-[15px] font-semibold leading-tight min-w-0">{title}</h2>
        {hint && <span className="text-xs font-medium text-[var(--k-muted)] min-w-0">{hint}</span>}
        {right && <div className="ml-auto flex items-center gap-2 min-w-0">{right}</div>}
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  )
}

// ── Donut đèn + chú giải bấm để lọc ──────────────────────────────────────────────────────────────
export function RagDonut({ counts, center, sub, active, onPick }: {
  counts: Record<RagKey, number>; center: ReactNode; sub: string; active: RagKey | ''; onPick: (k: RagKey | '') => void
}) {
  const R = 44, C = 2 * Math.PI * R, GAP = 2.5
  const order: RagKey[] = ['G', 'Y', 'R', 'none']
  const total = order.reduce((a, k) => a + counts[k], 0)
  let off = 0
  return (
    <div className="flex items-center gap-4 min-w-0">
      <div className="relative h-[116px] w-[116px] shrink-0">
        <svg viewBox="0 0 116 116" className="h-full w-full -rotate-90" role="img"
          aria-label={order.map(k => `${counts[k]} ${RAG_WORD[k]}`).join(', ')}>
          <circle cx="58" cy="58" r={R} fill="none" stroke="var(--k-line)" strokeWidth="15" />
          {total > 0 && order.map(k => {
            const len = (counts[k] / total) * C
            const start = off
            off += len
            if (len <= 0) return null
            return (
              <circle key={k} cx="58" cy="58" r={R} fill="none" stroke={RAG_VAR[k]} strokeWidth="15"
                strokeDasharray={`${Math.max(0.5, len - GAP)} ${C}`} strokeDashoffset={-start}
                opacity={active && active !== k ? 0.3 : 1} className="cursor-pointer" onClick={() => onPick(active === k ? '' : k)}>
                <title>{counts[k]} {RAG_WORD[k]}</title>
              </circle>
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-xl font-semibold leading-none tabular-nums">{center}</div>
          <div className="mt-1 text-[10px] leading-tight text-[var(--k-muted)]">{sub}</div>
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        {order.map(k => (
          <button key={k} type="button" onClick={() => onPick(active === k ? '' : k)} aria-pressed={active === k}
            title={active === k ? 'Bấm lại để bỏ lọc' : 'Bấm để chỉ hiện các KPI này'}
            className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-[var(--k-surface-2)] ${active === k ? 'bg-[var(--k-surface-2)] font-semibold' : ''} ${active && active !== k ? 'opacity-50' : ''}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RAG_VAR[k] }} />
            <span className="min-w-0 flex-1 whitespace-nowrap">{RAG_WORD[k]}</span>
            <span className="font-semibold tabular-nums">{counts[k]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Thanh chồng theo nhóm KPI ────────────────────────────────────────────────────────────────────
export type GroupRow = { key: string; label: string; G: number; Y: number; R: number; none: number; unavailable: number }
const HATCH = 'repeating-linear-gradient(135deg, var(--k-none) 0 3px, transparent 3px 6px)'

export function GroupStack({ rows, onPick }: { rows: GroupRow[]; onPick: (key: string) => void }) {
  const max = Math.max(1, ...rows.map(r => r.G + r.Y + r.R + r.none + r.unavailable))
  const seg = (r: GroupRow, k: RagKey) => {
    const n = r[k]
    if (!n) return null
    return (
      <span key={k} title={`${n} ${RAG_WORD[k]}`} style={{ width: `${(n / max) * 100}%`, background: RAG_VAR[k] }}
        className={`flex h-full min-w-[14px] items-center justify-center rounded-[4px] text-[10px] font-semibold tabular-nums ${k === 'G' || k === 'R' ? 'text-white' : 'text-[var(--k-ink)]'}`}>{n}</span>
    )
  }
  return (
    <div className="px-4 sm:px-5 py-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--k-muted)]">
        {(['G', 'Y', 'R', 'none'] as RagKey[]).map(k => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: RAG_VAR[k] }} />{RAG_WORD[k]}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: HATCH }} />Chưa có nguồn</span>
      </div>
      <div className="space-y-1">
        {rows.map(r => (
          <button key={r.key} type="button" onClick={() => onPick(r.key)} title="Bấm để tới nhóm này"
            className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-[var(--k-surface-2)] sm:grid-cols-[7.5rem_minmax(0,1fr)_2.5rem]">
            <span className="truncate text-xs font-medium" title={r.label}>{r.label}</span>
            <span className="flex h-[18px] gap-[2px] overflow-hidden">
              {seg(r, 'G')}{seg(r, 'Y')}{seg(r, 'R')}{seg(r, 'none')}
              {r.unavailable > 0 && (
                <span title={`${r.unavailable} chưa có nguồn`} className="h-full min-w-[8px] rounded-[4px]"
                  style={{ width: `${(r.unavailable / max) * 100}%`, background: HATCH }} />
              )}
            </span>
            <span className="text-right text-[11px] tabular-nums text-[var(--k-muted)]"><b className="text-[var(--k-ink)]">{r.G}</b>/{r.G + r.Y + r.R + r.none}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Xếp hạng kho theo một KPI: kho lệch mục tiêu nhiều nhất đứng đầu ─────────────────────────────
export function WarehouseRank({ def, rows }: {
  def: KpiDefPublic; rows: Array<{ id: string; name: string; k: KpiValue | undefined }>
}) {
  const has = rows.filter((r): r is { id: string; name: string; k: KpiValue } => r.k?.value != null)
  if (has.length === 0) return <p className="px-5 py-8 text-xs text-[var(--k-muted)]">Không kho nào có số của KPI này trong khoảng đã chọn. {def.empty_hint}</p>
  const sorted = [...has].sort((a, b) => {
    const ga = kpiGap(def.dir, a.k.value, a.k.t)?.rel ?? -1, gb = kpiGap(def.dir, b.k.value, b.k.t)?.rel ?? -1
    if (ga !== gb) return gb - ga
    return def.dir === 'down' ? (b.k.value as number) - (a.k.value as number) : (a.k.value as number) - (b.k.value as number)
  })
  const max = def.unit === '%' ? 100 : Math.max(1e-9, ...has.flatMap(r => [r.k.value as number, ...(r.k.t?.slice(0, def.dir === 'band' ? 2 : 1) ?? [])])) * 1.08
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <div className="px-4 sm:px-5 py-3">
      {/* Trăm kho NPP vẫn thấy đủ: cuộn trong thẻ, không cắt bớt */}
      <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
        {sorted.map(r => {
          const rag = (r.k.rag ?? 'none') as RagKey
          return (
            <div key={r.id} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs" title={`${r.name}: ${fmtValue(def, r.k.value)}${r.k.sub ? ` · ${r.k.sub}` : ''} · ${RAG_WORD[rag]}`}>
              <span className="truncate text-[var(--k-muted)]">{r.name}</span>
              <span className="relative h-4 rounded-[5px] bg-[var(--k-surface-2)]">
                <span className="absolute inset-y-0 left-0 rounded-[5px]" style={{ width: pct(r.k.value as number), background: r.k.rag ? RAG_VAR[rag] : 'var(--k-data)' }} />
                {r.k.t && r.k.t.slice(0, def.dir === 'band' ? 2 : 1).map(t => (
                  <span key={t} className="absolute -inset-y-0.5 w-0.5 rounded-full bg-[var(--k-ink)]" style={{ left: pct(t) }} />
                ))}
              </span>
              <span className="min-w-[3.25rem] text-right font-semibold tabular-nums">{fmtValue(def, r.k.value)}</span>
            </div>
          )
        })}
      </div>
      {has.length < 2
        ? <p className="mt-2.5 text-[11px] text-[var(--k-muted)]">{rows.length < 2 ? 'Đang xem một kho — chọn "Tất cả kho" ở đầu trang để so sánh giữa các kho.' : `Chỉ ${has.length}/${rows.length} kho có số của KPI này trong khoảng đã chọn.`}</p>
        : <p className="mt-2.5 text-[11px] text-[var(--k-muted)]">Lệch mục tiêu nhiều nhất đứng đầu · vạch đứng = mục tiêu đạt của kho đó{def.unit !== '%' ? ` · đơn vị ${def.unit}` : ''}</p>}
    </div>
  )
}

// ── Bản đồ nhiệt: mỗi dòng một KPI, mỗi cột một kỳ, màu = đèn ────────────────────────────────────
type HeatHover = { def: KpiDefPublic; bucket: KpiBucket; x: number; y: number }

export function KpiHeatmap({ defs, buckets, targets, grain, onOpen }: {
  defs: KpiDefPublic[]; buckets: KpiBucket[]; targets: Record<string, number[] | null>; grain: KpiGrain; onOpen: (d: KpiDefPublic) => void
}) {
  const fade = useEdgeFade(buckets.length)
  const [hover, setHover] = useState<HeatHover | null>(null)
  const rows = defs.filter(d => buckets.some(b => b.values[d.id] != null))
  const empty = defs.length - rows.length
  // Quá 16 kỳ thì ô hẹp: bỏ số trong ô (vẫn đọc được qua tooltip và bảng số trong hộp phóng to)
  const withText = buckets.length <= 16
  const cols = `minmax(6rem, 8rem) repeat(${buckets.length}, minmax(${withText ? '2.35rem' : '1.1rem'}, 1fr))`
  if (rows.length === 0) return <p className="px-5 py-8 text-xs text-[var(--k-muted)]">Chưa KPI nào có số trong khoảng đã chọn.</p>
  const t = hover ? (targets[hover.def.id] ?? null) : null
  const hv = hover ? (hover.bucket.values[hover.def.id] ?? null) : null
  return (
    <div className="relative px-4 sm:px-5 py-3" onMouseLeave={() => setHover(null)}>
      <div ref={fade.ref} style={fade.style} onWheel={fade.onWheel} className="overflow-x-auto no-scrollbar">
        <div className="grid w-full min-w-max gap-[3px] sm:min-w-0" style={{ gridTemplateColumns: cols }}>
          {rows.map(d => (
            <div key={d.id} className="contents">
              <button type="button" onClick={() => onOpen(d)} title={`${d.name} (${d.unit}) — bấm để phóng to`}
                className="sticky left-0 z-[1] flex min-w-0 items-center gap-1 bg-[var(--k-surface)] pr-2 text-left text-[11px] font-medium hover:underline">
                <span className="truncate">{d.short}</span><span className="shrink-0 font-normal text-[var(--k-muted)]">{d.unit === '%' ? '%' : ''}</span>
              </button>
              {buckets.map(b => {
                const v = b.values[d.id] ?? null
                const tg = targets[d.id] ?? null
                const rag = ragOf(d, v, tg)
                return (
                  <button key={b.key} type="button" onClick={() => onOpen(d)} aria-label={`${d.short} ${bucketLabel(grain, b.key, true)}: ${fmtValue(d, v)}`}
                    onMouseEnter={e => {
                      const host = e.currentTarget.closest('.relative') as HTMLElement
                      const a = e.currentTarget.getBoundingClientRect(), h = host.getBoundingClientRect()
                      setHover({ def: d, bucket: b, x: a.left - h.left + a.width / 2, y: a.top - h.top })
                    }}
                    style={{ background: v == null ? 'var(--k-surface-2)' : RAG_TINT[rag ?? 'none'] }}
                    className="h-7 rounded-[4px] text-[10px] font-medium tabular-nums transition-transform hover:scale-105">
                    {withText && v != null ? fmtNum(v, Math.abs(v) >= 100 ? 0 : 1) : ''}
                  </button>
                )
              })}
            </div>
          ))}
          <div />
          {buckets.map((b, i) => (
            <div key={b.key} className="pt-1 text-center text-[10px] leading-tight text-[var(--k-muted)]">
              {withText || i % Math.ceil(buckets.length / 8) === 0 ? bucketLabel(grain, b.key) : ''}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--k-muted)]">
        {(['G', 'Y', 'R', 'none'] as RagKey[]).map(k => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: RAG_TINT[k] }} />{k === 'none' ? 'Có số, chưa đặt mục tiêu' : RAG_WORD[k]}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-[var(--k-line)] bg-[var(--k-surface-2)]" />Không có số</span>
        {empty > 0 && <span>· ẩn {empty} KPI chưa có số theo kỳ</span>}
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-20 w-max max-w-[15rem] -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--k-line)] bg-[var(--k-surface)] px-2.5 py-1.5 text-[11px] shadow-lg"
          style={{ left: Math.max(90, hover.x), top: hover.y - 6 }}>
          <div className="font-semibold">{hover.def.name}</div>
          <div className="text-[var(--k-muted)]">{bucketLabel(grain, hover.bucket.key, true)}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <b className="tabular-nums">{fmtValue(hover.def, hv)}{hv != null && hover.def.unit !== '%' ? ` ${hover.def.unit}` : ''}</b>
            {hv != null && <span className="text-[var(--k-muted)]">· {RAG_WORD[ragOf(hover.def, hv, t) ?? 'none']}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Đồng hồ vạch cho KPI % ảnh chụp ─────────────────────────────────────────────────────────────
export function TickGauge({ value, marks, label, sub }: { value: number | null; marks: number[]; label: string; sub?: string }) {
  const N = 41, START = 195, SWEEP = 210, CX = 130, CY = 124
  const polar = (a: number, r: number) => { const rad = (a * Math.PI) / 180; return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)] }
  const angle = (p: number) => START - (p / 100) * SWEEP
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <svg viewBox="0 0 260 170" className="mx-auto block w-full max-w-[300px]" role="img" aria-label={`${label}${sub ? `, ${sub}` : ''}`}>
      {Array.from({ length: N }).map((_, i) => {
        const p = (i / (N - 1)) * 100
        const [x1, y1] = polar(angle(p), 92), [x2, y2] = polar(angle(p), 116)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={5} strokeLinecap="round"
          stroke={value != null && p <= v ? 'var(--k-data)' : 'var(--k-line)'} opacity={value != null && p <= v ? 0.45 + 0.55 * (p / Math.max(v, 1)) : 1} />
      })}
      {marks.map(m => {
        const [x1, y1] = polar(angle(m), 86), [x2, y2] = polar(angle(m), 122)
        return <line key={m} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--k-ink)" strokeWidth={2} strokeLinecap="round" />
      })}
      <text x={CX} y={CY - 8} textAnchor="middle" className="fill-[var(--k-ink)] text-[32px] font-semibold tabular-nums">{label}</text>
      {sub && <text x={CX} y={CY + 14} textAnchor="middle" className="fill-[var(--k-muted)] text-[11px]">{sub}</text>}
    </svg>
  )
}

// ── Dùng chung cho các tab Tổng quan và Giám sát vận hành (11/2026) ──────────────────────────────
/** Vòng % — một giá trị, tâm in số. Trên khối xanh đậm truyền color trắng + track trắng mờ. */
export function RingMeter({ pct, size = 64, stroke = 8, color = 'var(--k-data)', track = 'var(--k-line)', center, label }: {
  pct: number | null; size?: number; stroke?: number; color?: string; track?: string; center?: ReactNode; label: string
}) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {p > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(p / 100) * C} ${C}`} />}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums leading-none" style={{ fontSize: Math.round(size * 0.24) }}>
        {center ?? (pct == null ? '—' : `${Math.round(p)}%`)}
      </div>
    </div>
  )
}

/** Thanh xếp hạng: bên gọi tự sắp thứ tự. Nhiều dòng thì cuộn trong thẻ, không cắt bớt. */
export type RankRow = { key: string; label: string; value: number | null; text: string; color?: string; title?: string }
export function RankBars({ rows, max, empty, note }: { rows: RankRow[]; max?: number; empty: string; note?: ReactNode }) {
  if (rows.length === 0) return <p className="px-4 sm:px-5 py-8 text-xs text-[var(--k-muted)]">{empty}</p>
  const top = max ?? Math.max(1e-9, ...rows.map(r => r.value ?? 0))
  return (
    <div className="px-4 sm:px-5 py-3">
      <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
        {rows.map(r => (
          <div key={r.key} title={r.title ?? `${r.label}: ${r.text}`} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto]">
            <span className="truncate text-[var(--k-muted)]">{r.label}</span>
            <span className="relative h-4 rounded-[5px] bg-[var(--k-surface-2)]">
              {r.value != null && r.value > 0 && <span className="absolute inset-y-0 left-0 min-w-[3px] rounded-[5px]" style={{ width: `${Math.min(100, (r.value / top) * 100)}%`, background: r.color ?? 'var(--k-data)' }} />}
            </span>
            <span className="min-w-[3.25rem] text-right font-semibold tabular-nums">{r.text}</span>
          </div>
        ))}
      </div>
      {note && <p className="mt-2.5 text-[11px] text-[var(--k-muted)]">{note}</p>}
    </div>
  )
}

/** Treemap một sắc: ô to = nhiều, đậm nhạt theo tỷ trọng. Tên + số in trực tiếp trên ô (bảng màu nhiều sắc của mẫu không qua được
 *  validate_palette); ô quá nhỏ không đủ chỗ in thì đọc qua tooltip. Quá 8 nhóm thì gom phần nhỏ thành "Khác". */
export function Treemap({ items, unit, height = 280 }: { items: Array<{ key: string; label: string; value: number }>; unit: string; height?: number }) {
  const W = 150, H = 100
  const sorted = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value)
  const rest = sorted.slice(8)
  const shown = rest.length > 1
    ? [...sorted.slice(0, 8), { key: '__other', label: `Khác (${rest.length})`, value: rest.reduce((s, i) => s + i.value, 0) }]
    : sorted
  const total = shown.reduce((s, i) => s + i.value, 0)
  if (total <= 0) return <p className="px-5 py-8 text-xs text-[var(--k-muted)]">Chưa có tồn trong phạm vi đang xem.</p>
  const biggest = shown[0].value
  return (
    <div className="p-3 sm:px-4">
    <div className="relative" style={{ height }}>
      {squarify(shown, W, H).map(t => {
        const share = t.value / total
        const alpha = 0.22 + 0.78 * Math.sqrt(t.value / biggest)
        return (
          <div key={t.key} className="absolute p-[1.5px]" style={{ left: `${(t.x / W) * 100}%`, top: `${(t.y / H) * 100}%`, width: `${(t.w / W) * 100}%`, height: `${(t.h / H) * 100}%` }}
            title={`${t.label}: ${fmtNum(t.value, 0)} ${unit} · ${fmtNum(share * 100, 1)}%`}>
            <div className="relative h-full overflow-hidden rounded-[6px]">
              <div className="absolute inset-0 bg-[var(--k-data)]" style={{ opacity: alpha }} />
              {t.w / W >= 0.12 && t.h / H >= 0.14 && (
                <div className={`relative flex h-full flex-col items-center justify-center px-1 text-center ${alpha > 0.6 ? 'text-white' : ''}`}>
                  <div className="max-w-full truncate text-xs font-medium">{t.label}</div>
                  <div className="text-[15px] font-semibold tabular-nums leading-tight">{fmtNum(t.value, 0)}</div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--k-muted)]">
      {shown.map(t => <span key={t.key} className="whitespace-nowrap">{t.label} <b className="font-semibold tabular-nums text-[var(--k-ink)]">{fmtNum(t.value, 0)}</b></span>)}
    </div>
    </div>
  )
}

/** Khối nổi bật nền xanh đậm + các số bên dưới — mẫu "Luồng nhập xuất". */
export function HeroPanel({ title, hint, top, children }: { title: ReactNode; hint?: ReactNode; top: ReactNode; children?: ReactNode }) {
  return (
    <section className="k-card flex flex-col overflow-hidden">
      <div className="bg-[var(--k-brand)] px-4 py-3.5 text-white sm:px-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {hint && <span className="whitespace-nowrap text-[11px] font-medium text-white/75">{hint}</span>}
        </div>
        {top}
      </div>
      {children && <div className="grid flex-1 grid-cols-2 content-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">{children}</div>}
    </section>
  )
}
export function HeroStat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-xs text-[var(--k-muted)]">{label}</div>
      <div className="text-xl font-semibold tabular-nums leading-tight">{value}</div>
    </div>
  )
}

/** Hai cột mỗi kỳ trên nền xanh đậm (CÙNG đơn vị, một trục). Nhiều kỳ thì thưa nhãn, số đọc qua tooltip. */
export function FlowBars({ rows, aLabel, bLabel }: { rows: Array<{ key: string; label: string; a: number; b: number; title: string }>; aLabel: string; bLabel: string }) {
  const max = Math.max(1e-9, ...rows.flatMap(r => [r.a, r.b]))
  const every = Math.ceil(rows.length / 8)
  return (
    <div className="mt-3">
      <div className="flex h-[104px] items-end gap-1.5">
        {rows.map(r => (
          <div key={r.key} title={r.title} className="flex h-full min-w-0 flex-1 items-end justify-center gap-[3px]">
            <span className="w-full max-w-[9px] rounded-t-[3px] bg-white" style={{ height: `${(r.a / max) * 100}%`, minHeight: r.a > 0 ? 2 : 0 }} />
            <span className="w-full max-w-[9px] rounded-t-[3px] bg-white/55" style={{ height: `${(r.b / max) * 100}%`, minHeight: r.b > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-[10px] tabular-nums text-white/75">
        {rows.map((r, i) => <span key={r.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{i % every === 0 ? r.label : ''}</span>)}
      </div>
      <div className="mt-1.5 flex gap-3 text-[11px] text-white/85">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-white" />{aLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-white/55" />{bLabel}</span>
      </div>
    </div>
  )
}
