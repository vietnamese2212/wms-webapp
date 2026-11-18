// SƠ ĐỒ BỒN GỌN + MẺ TRÊN SƠ ĐỒ (MES 18/11 f — user: "vẽ cho tôi bồn, dự kiến 20–30 cái bồn. Hãy tiết kiệm vị trí. Bồn nằm sau khâu của
// mẻ, vậy mẻ cũng hiện lên trên sơ đồ. Liên kết sơ đồ này với tình trạng để xem real time").
//   • Mỗi bồn MỘT ô nhỏ (~100 px, lưới tự co): trên đầu ô là các MẺ đang làm cho bồn đó (mẻ gắn bồn từ lúc mở) — ký hiệu + màu + bước
//     đang tới y như cột Tình trạng của danh sách mẻ (StageSymbol / mes_batch_gate.step); mũi tên xuống; rồi thân bồn: mực theo sức chứa,
//     mỗi mẻ đã nạp một lớp tô theo tình trạng của chính mẻ đó (Chờ QA bồn xanh dương · QA đạt xanh lá · QA loại / quá hạn lưu đỏ),
//     phần gạch chéo = mẻ đang làm sẽ vào. 30 bồn ≈ 3 hàng trên màn 1280.
//   • Dải tình trạng phía trên đếm mẻ theo BƯỚC (Chờ duyệt · Cấp NVL · Ghi phiếu · In tem · Check đổ bồn · Nạp bồn · Chờ QA bồn …) — bấm
//     một bước ⇒ chỉ sáng bồn có mẻ ở bước đó.
//   • Bấm ô bồn ⇒ khung chi tiết (thẻ bồn đầy đủ + thao tác) — trang cha lo; bấm thẻ mẻ ⇒ mở mẻ.
// Realtime: dữ liệu là danh sách bồn (`prod-tanks`), mọi sổ đổi bước của mẻ (cấp NVL · phiếu · tem · quét đổ bồn · nạp) đều làm mới nó.
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import type { TankRow } from '@/api/productionHooks'
import { StageSymbol, stageShort, stageLabel, stageKey, stageOf, STAGE_CHIP, lotStage } from './BatchStage'
import { TANK_TONE, layerFill } from './TankMimic'

const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })

/** một mẻ trên sơ đồ: mẻ đang làm sẽ vào bồn (trên đầu ô) hoặc mẻ đã nạp nằm trong bồn (một lớp) */
export interface BoardBatch { id: string; code: string; no: number | null; cycle: string | null; stage: string; step: string | null; inTank: boolean }
export function boardBatchesOf(t: TankRow): BoardBatch[] {
  return [
    ...t.incoming.map(x => ({ id: x.batch_id, code: x.batch_code, no: x.batch_no, cycle: x.cycle, stage: x.stage ?? 'new', step: x.step ?? null, inTank: false })),
    ...t.lots.map(l => ({ id: l.batch_id, code: l.batch?.batch_code ?? '', no: l.batch?.batch_no ?? null, cycle: l.batch?.cycle ?? null,
      stage: lotStage(l.batch?.qa_status), step: null, inTank: true })),
  ]
}

/** nút lọc theo thứ tự công việc (chỉ hiện nút có mẻ) */
const FILTERS: { stage: string; step?: string }[] = [
  { stage: 'new' }, { stage: 'wait_lead' }, { stage: 'wait_qa' },
  { stage: 'working', step: 'rm' }, { stage: 'working', step: 'log' }, { stage: 'working', step: 'label' }, { stage: 'working', step: 'pour' }, { stage: 'working', step: 'fill' },
  { stage: 'filled' }, { stage: 'released' }, { stage: 'rejected' },
]

// thân bồn nhỏ: khung 60 × 84 (trụ đứng, hai đáy cong, hai chân)
const X0 = 8, X1 = 52, TOP = 11, BOT = 70, DISH = 5
const BODY = `M${X0},${TOP} Q30,${TOP - DISH * 2} ${X1},${TOP} L${X1},${BOT} Q30,${BOT + DISH * 2} ${X0},${BOT} Z`
const H = BOT - TOP

function MiniTank({ t }: { t: TankRow }) {
  const cap = Number(t.capacity) || 1
  const pct = Math.round(Number(t.content) * 100 / cap)
  let acc = 0
  const layers = t.lots.map((l, i) => {
    const h = Math.max(Number(l.qty_remaining), 0) / cap * H
    const y = BOT - acc - h
    acc += h
    return { key: l.id, y, h, fill: layerFill(l.batch?.qa_status, i, t.expired) }
  })
  const inH = Math.min(Number(t.reserved) / cap * H, Math.max(H - acc, 0))
  const clip = `mini-clip-${t.id}`, hatch = `mini-hatch-${t.id}`
  const bad = t.expired || t.qa_state === 'REJECTED'
  return (
    <svg viewBox="0 0 60 84" className="mx-auto block h-[74px] w-[53px]" role="img" aria-label={`${pct}% — ${nf(Number(t.content))} / ${nf(cap)} ${t.unit}`}>
      <defs>
        <clipPath id={clip}><path d={BODY} /></clipPath>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#f1f5f9" /><line x1="0" y1="0" x2="0" y2="5" stroke="#94a3b8" strokeWidth="1.6" />
        </pattern>
      </defs>
      <path d={`M${X0 + 6},${BOT + 4} l-3,9 M${X1 - 6},${BOT + 4} l3,9`} stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      <path d={BODY} fill="#f8fafc" />
      <g clipPath={`url(#${clip})`}>
        {layers.map(l => <rect key={l.key} x={X0} width={X1 - X0} y={l.y} height={l.h + 0.5} fill={l.fill} style={{ transition: 'y .6s ease, height .6s ease' }} />)}
        {layers.length > 0 && <rect x={X0} width={X1 - X0} y={BOT} height={DISH * 2} fill={layers[0].fill} />}
        {layers.slice(1).map(l => <line key={`s${l.key}`} x1={X0} x2={X1} y1={l.y + l.h} y2={l.y + l.h} stroke="#fff" strokeWidth="0.8" opacity=".75" />)}
        {inH > 0.5 && <rect x={X0} width={X1 - X0} y={BOT - acc - inH} height={inH} fill={`url(#${hatch})`} />}
      </g>
      <path d={BODY} fill="none" stroke={bad ? '#dc2626' : '#64748b'} strokeWidth="1.8" strokeLinejoin="round" />
      <text x="30" y={pct > 0 ? Math.min(BOT - acc / 2 + 4, BOT - 2) : (TOP + BOT) / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="700"
        fill={pct > 0 ? '#ffffff' : '#94a3b8'} style={pct > 0 ? { paintOrder: 'stroke', stroke: 'rgba(15,23,42,.35)', strokeWidth: 2 } : undefined}>{pct}%</text>
    </svg>
  )
}

function TankTile({ t, bs, filter, dim, selected, onSelect, onOpenBatch, quick }: {
  t: TankRow; bs: BoardBatch[]; filter: string; dim: boolean; selected: boolean
  onSelect: (t: TankRow) => void; onOpenBatch: (id: string) => void; quick?: ReactNode
}) {
  const incoming = bs.filter(b => !b.inTank)
  const shown = incoming.slice(0, 2)
  const more = incoming.length - shown.length
  const tone = TANK_TONE[t.expired && t.qa_state !== 'EMPTY' ? 'REJECTED' : t.qa_state]
  const label = !t.is_active ? 'Ngừng dùng' : t.expired && t.qa_state !== 'EMPTY' && t.qa_state !== 'REJECTED' ? 'Quá hạn lưu' : tone.label
  const mat = t.lots[0]?.batch?.material ?? null
  const inMat = !mat ? t.incoming[0] ?? null : null
  return (
    <div role="button" tabIndex={0} aria-label={`Bồn ${t.code} — ${label}`} data-testid={`tile-${t.code}`}
      onClick={() => onSelect(t)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(t) } }}
      className={`flex min-w-0 cursor-pointer flex-col rounded-lg border bg-white p-1.5 outline-none transition-opacity hover:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-400
        ${selected ? 'border-sky-500 ring-2 ring-sky-200' : t.is_active ? 'border-slate-200' : 'border-dashed border-slate-300'} ${dim ? 'opacity-30' : ''}`}>
      {/* MẺ đang làm cho bồn này — đứng TRÊN bồn (bồn nằm sau khâu của mẻ) */}
      {shown.map(b => {
        const k = stageKey(b.stage, b.step)
        return (
          <button key={b.id} type="button" data-batch={b.code} data-key={k}
            onClick={e => { e.stopPropagation(); onOpenBatch(b.id) }}
            title={`${b.code}${b.cycle ? ` · chu kỳ ${b.cycle}` : ''} — ${stageLabel(b.stage, b.step)} (bấm để mở mẻ)`}
            className={`mb-0.5 w-full min-w-0 rounded border px-1 py-0.5 text-left leading-tight ${STAGE_CHIP[stageOf(b.stage)]} ${filter && filter === k ? 'ring-2 ring-sky-500' : ''}`}>
            <span className="flex min-w-0 items-center gap-1 text-[10px] font-semibold">
              <StageSymbol stage={b.stage} step={b.step} className="h-3 w-3" /><span className="truncate">Mẻ {b.no ?? '—'}</span>
            </span>
            <span className="block truncate text-[9px]">{stageShort(b.stage, b.step)}</span>
          </button>
        )
      })}
      {more > 0 && <span className="text-center text-[9px] text-slate-500">+{more} mẻ</span>}
      {incoming.length > 0 && <ArrowDown className="mx-auto h-3 w-3 shrink-0 text-slate-400" aria-hidden />}
      <div className="mt-auto min-w-0">
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="truncate font-mono text-[12px] font-bold text-slate-800" title={t.name ?? undefined}>{t.code}</span>
          <span className={`ml-auto truncate text-[9px] font-semibold ${t.is_active ? tone.text : 'text-slate-400'}`} title={label}>{label}</span>
        </div>
        <MiniTank t={t} />
        <p className="text-center text-[10px] leading-tight tabular-nums"><b className="text-slate-900">{nf(Number(t.content))}</b><span className="text-slate-400">/{nf(Number(t.capacity))}</span></p>
        <p className="truncate text-center text-[9px] text-slate-500" title={mat?.short_name ?? inMat?.material_name ?? undefined}>
          {t.unit}{mat ? ` · ${mat.material_code}` : inMat ? ` · đặt ${inMat.material_code ?? ''}` : ''}
        </p>
        {quick}
      </div>
    </div>
  )
}

export function TankBoard({ tanks, selectedId, onSelect, onOpenBatch, quick }: {
  tanks: TankRow[]; selectedId?: string | null
  onSelect: (t: TankRow) => void
  onOpenBatch: (batchId: string) => void
  /** nút việc chính ngay trên ô (vận hành để ngoài): Check trước khi đổ bồn · QA bồn */
  quick?: (t: TankRow) => ReactNode
}) {
  const [filter, setFilter] = useState('')
  const all = useMemo(() => tanks.map(t => ({ t, bs: boardBatchesOf(t) })), [tanks])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const { bs } of all) for (const b of bs) { const k = stageKey(b.stage, b.step); m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }, [all])
  const total = [...counts.values()].reduce((s, n) => s + n, 0)
  const active = filter && counts.get(filter) ? filter : ''
  return (
    <div className="space-y-2">
      {total > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 sm:flex-wrap" data-testid="board-filter" role="group" aria-label="Lọc mẻ theo tình trạng">
          <button type="button" onClick={() => setFilter('')} aria-pressed={!active}
            className={`h-7 shrink-0 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium ${!active ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
            Mọi mẻ <b className="tabular-nums">{total}</b>
          </button>
          {FILTERS.map(x => {
            const k = stageKey(x.stage, x.step)
            const n = counts.get(k)
            if (!n) return null
            return (
              <button key={k} type="button" data-filter={k} aria-pressed={active === k} title={stageLabel(x.stage, x.step)}
                onClick={() => setFilter(f => (f === k ? '' : k))}
                className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] ${STAGE_CHIP[stageOf(x.stage)]} ${active === k ? 'ring-2 ring-sky-500' : ''}`}>
                <StageSymbol stage={x.stage} step={x.step} className="h-3.5 w-3.5" />{stageShort(x.stage, x.step)} <b className="tabular-nums">{n}</b>
              </button>
            )
          })}
        </div>
      )}
      <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))' }} data-testid="tank-board">
        {all.map(({ t, bs }) => (
          <TankTile key={t.id} t={t} bs={bs} filter={active} selected={selectedId === t.id}
            dim={!!active && !bs.some(b => stageKey(b.stage, b.step) === active)}
            onSelect={onSelect} onOpenBatch={onOpenBatch} quick={quick?.(t)} />
        ))}
      </div>
    </div>
  )
}
