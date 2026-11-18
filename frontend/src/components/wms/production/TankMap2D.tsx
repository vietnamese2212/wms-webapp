// SƠ ĐỒ BỒN 2D (MES 18/11 g — user: "bản đồ 2D làm đầy đủ lên, tham khảo các phần mềm tiên tiến về MES để học hỏi và áp dụng. Có thể zoom in
// zoom out, scroll chứ không nhất thiết nằm trong một khoang. Ở chế độ fit — bấm nút thì xem được bao quát").
// Học từ màn tổng quan nhà máy của các phần mềm MES / SCADA (Siemens Opcenter · AVEVA · Ignition — chuẩn ISA-101 màn vận hành hiệu năng cao,
// ISA-88 mẻ → thiết bị, ISA-95 khu vực):
//   • Bản vẽ LỚN, không nhồi vào một khung: thu phóng quanh con trỏ (lăn chuột · chụm hai ngón · nút + / −), kéo để rê, nút "Vừa màn" xem
//     toàn cảnh, "100%", bản đồ thu nhỏ có khung đang xem (bấm / kéo để nhảy), phóng toàn màn hình (màn TV phòng điều hành), phím + − 0 1 ←↑→↓.
//   • NHIỀU TẦNG CHI TIẾT theo tỉ lệ (ISA-101): toàn cảnh (mã bồn + mực + % + số mẻ đang tới, chữ to) · vận hành (thẻ mẻ + bước, số lượng,
//     BTP, nút Check đổ bồn / QA bồn) · chi tiết (chu kỳ · ca của mẻ, nhãn từng lớp trong bồn, hạn lưu, tên BTP).
//   • DÒNG CHẢY: mẻ (đứng trên) → ống vào → BỒN → ống ra → MÁY ĐÓNG GÓI đang rút (Sổ đóng gói đang mở). Ống sáng + chạy khi có dòng chảy thật:
//     mẻ ở bước Check đổ bồn / Nạp bồn (xanh trời), sổ đóng gói đang rút (xanh lá). Màu chỉ dùng cho tình trạng — nền xám trung tính.
//   • KHU = kho chế biến (khung có tên). Chỗ bồn: tự xếp vừa khung, hoặc người có quyền "Quản lý bồn" bấm Sắp xếp rồi KÉO bồn tới đúng chỗ
//     ngoài xưởng (lưới 20) → Lưu: mọi người thấy cùng bản vẽ (production_tank.map_x / map_y, realtime).
//   • Cảnh báo nổi (ISA-101 "tình huống bất thường"): đếm bồn quá hạn lưu / QA loại — bấm để nhảy lần lượt tới từng bồn.
// Phép toán thu phóng: utils/panZoom.ts · xếp bồn: utils/tankMapLayout.ts (có test). Realtime: dữ liệu là danh sách bồn (prod-tanks).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Minus, Maximize2, Map as MapIcon, Expand, Shrink, AlertTriangle, Info, RotateCcw, Save, X, Play } from 'lucide-react'
import type { TankRow } from '@/api/productionHooks'
import { useSaveTankLayout } from '@/api/productionHooks'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { formatTimestampTime, formatDateTime } from '@/utils/formatters'
import { zoomAt, fitView, pinchView, keepInView, centerOn, type View, type Pt } from '@/utils/panZoom'
import {
  layoutTanks, pinArea, changedItems, lodOf, snap, NODE_W, NODE_H, AREA_HEAD, type Lod, type LayoutDraft, type MapLayout, type PlacedNode,
} from '@/utils/tankMapLayout'
import { StageSymbol, stageShort, stageLabel, stageKey, stageOf, STAGE_CHIP, STAGE_LIQUID, lotStage } from './BatchStage'
import { TANK_TONE, layerFill } from './TankMimic'

const MIN = 0.08, MAX = 3
const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'

/** một mẻ trên sơ đồ: mẻ đang làm sẽ vào bồn (đứng trên bồn) hoặc mẻ đã nạp nằm trong bồn (một lớp) */
export interface BoardBatch { id: string; code: string; no: number | null; cycle: string | null; shift: string | null; stage: string; step: string | null; inTank: boolean }
export function boardBatchesOf(t: TankRow): BoardBatch[] {
  return [
    ...t.incoming.map(x => ({ id: x.batch_id, code: x.batch_code, no: x.batch_no, cycle: x.cycle, shift: x.shift ?? null, stage: x.stage ?? 'new', step: x.step ?? null, inTank: false })),
    ...t.lots.map(l => ({ id: l.batch_id, code: l.batch?.batch_code ?? '', no: l.batch?.batch_no ?? null, cycle: l.batch?.cycle ?? null, shift: l.batch?.shift ?? null,
      stage: lotStage(l.batch?.qa_status), step: null, inTank: true })),
  ]
}
/** việc chính ngay trên bồn (vận hành để ngoài): Check trước khi đổ bồn · QA bồn */
export interface TankQuick { key: string; label: string; short: string; tone: 'blue' | 'green'; icon: ComponentType<{ className?: string }>; onClick: () => void }

/** nút lọc theo thứ tự công việc (chỉ hiện nút có mẻ) */
const FILTERS: { stage: string; step?: string }[] = [
  { stage: 'new' }, { stage: 'wait_lead' }, { stage: 'wait_qa' },
  { stage: 'working', step: 'rm' }, { stage: 'working', step: 'log' }, { stage: 'working', step: 'label' }, { stage: 'working', step: 'pour' }, { stage: 'working', step: 'fill' },
  { stage: 'filled' }, { stage: 'released' }, { stage: 'rejected' },
]
const FLOW_ORDER = FILTERS.map(x => stageKey(x.stage, x.step))
const flowRank = (b: BoardBatch) => FLOW_ORDER.indexOf(stageKey(b.stage, b.step))
const isAlarm = (t: TankRow) => (t.expired && t.qa_state !== 'EMPTY') || t.qa_state === 'REJECTED'

// ── hình bồn (khung 100 × 152): thân trụ, hai đáy cong, chân ─────────────────────────────────────────────────────────────────────────────
const X0 = 8, X1 = 92, TOP = 14, BOT = 122, DISH = 8, BH = BOT - TOP
const BODY = `M${X0},${TOP} Q50,${TOP - DISH * 2} ${X1},${TOP} L${X1},${BOT} Q50,${BOT + DISH * 2} ${X0},${BOT} Z`
const VB_H = 152
/** vị trí bồn trong ô theo tầng chi tiết (điểm sơ đồ) */
const GEO: Record<Lod, { tx: number; ty: number; tw: number; laneBot: number }> = {
  1: { tx: 50, ty: 112, tw: 140, laneBot: 104 },
  2: { tx: 8, ty: 134, tw: 116, laneBot: 118 },
  3: { tx: 8, ty: 134, tw: 116, laneBot: 118 },
}
const OUT_Y = 338

function TankGlyph({ t, lod, w, selected }: { t: TankRow; lod: Lod; w: number; selected: boolean }) {
  const cap = Number(t.capacity) || 1
  const pct = Math.round(Number(t.content) * 100 / cap)
  let acc = 0
  const layers = t.lots.map((l, i) => {
    const h = Math.max(Number(l.qty_remaining), 0) / cap * BH
    const y = BOT - acc - h
    acc += h
    return { l, y, h, fill: layerFill(l.batch?.qa_status, i, t.expired) }
  })
  const inH = Math.min(Number(t.reserved) / cap * BH, Math.max(BH - acc, 0))
  const clip = `tm-clip-${t.id}`, hatch = `tm-hatch-${t.id}`
  const bad = isAlarm(t)
  const k = w / 100
  const pctFont = (lod === 1 ? 40 : lod === 2 ? 22 : 17) / k
  const labFont = 11 / k
  return (
    <svg viewBox={`0 0 100 ${VB_H}`} width={w} height={w * VB_H / 100} className="block overflow-visible" aria-hidden>
      <defs>
        <clipPath id={clip}><path d={BODY} /></clipPath>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#f1f5f9" /><line x1="0" y1="0" x2="0" y2="5" stroke="#94a3b8" strokeWidth="1.6" />
        </pattern>
      </defs>
      <path d={`M20,${BOT + 6} l-4,22 M80,${BOT + 6} l4,22 M50,${BOT + 8} l0,20`} stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
      <path d={BODY} fill="#ffffff" />
      <g clipPath={`url(#${clip})`}>
        {layers.map(x => <rect key={x.l.id} x={X0} width={X1 - X0} y={x.y} height={x.h + 0.5} fill={x.fill} style={{ transition: 'y .6s ease, height .6s ease' }} />)}
        {layers.length > 0 && <rect x={X0} width={X1 - X0} y={BOT} height={DISH * 2} fill={layers[0].fill} />}
        {layers.slice(1).map(x => <line key={`s${x.l.id}`} x1={X0} x2={X1} y1={x.y + x.h} y2={x.y + x.h} stroke="#fff" strokeWidth="0.8" opacity=".8" />)}
        {inH > 0.5 && <rect x={X0} width={X1 - X0} y={BOT - acc - inH} height={inH} fill={`url(#${hatch})`} />}
        {lod === 3 && layers.filter(x => x.h >= labFont * 1.5).map(x => (
          <text key={`t${x.l.id}`} x={50} y={x.y + x.h / 2 + labFont * 0.35} textAnchor="middle" fontSize={labFont} fontWeight={600} fill="#fff"
            style={{ paintOrder: 'stroke', stroke: 'rgba(15,23,42,.45)', strokeWidth: 1.6 / k }}>
            Mẻ {x.l.batch?.batch_no ?? '—'} · {nf(Number(x.l.qty_remaining))}
          </text>
        ))}
      </g>
      <path d={BODY} fill="none" stroke={bad ? '#dc2626' : selected ? '#0284c7' : '#64748b'} strokeWidth={bad || selected ? 3 : 2} strokeLinejoin="round"
        strokeDasharray={t.is_active ? undefined : '6 5'} />
      {(lod !== 3 || !layers.length) && (
        <text x="50" y={pct > 0 ? Math.min(BOT - acc / 2 + pctFont * 0.35, BOT - 3) : (TOP + BOT) / 2 + pctFont * 0.35} textAnchor="middle" fontSize={pctFont} fontWeight="700"
          fill={pct > 0 ? '#ffffff' : '#94a3b8'} style={pct > 0 ? { paintOrder: 'stroke', stroke: 'rgba(15,23,42,.35)', strokeWidth: 2.4 / k } : undefined}>{pct}%</text>
      )}
    </svg>
  )
}

interface NodeProps {
  t: TankRow; n: PlacedNode; lod: Lod; selected: boolean; dim: boolean; flash: boolean; filter: string; arrange: boolean; dragging: boolean
  quick: TankQuick[]; onSelect: (t: TankRow) => void; onOpenBatch: (id: string) => void
}
const TankNode = memo(function TankNode({ t, n, lod, selected, dim, flash, filter, arrange, dragging, quick, onSelect, onOpenBatch }: NodeProps) {
  const g = GEO[lod]
  const th = g.tw * VB_H / 100
  const cx = g.tx + g.tw / 2
  const bs = boardBatchesOf(t)
  const incoming = bs.filter(b => !b.inTank)
  const lead = incoming.reduce<BoardBatch | null>((m, b) => (!m || flowRank(b) > flowRank(m) ? b : m), null)
  const flowIn = incoming.some(b => b.step === 'pour' || b.step === 'fill')
  const runs = t.runs ?? []
  const bad = isAlarm(t)
  const toneKey = t.expired && t.qa_state !== 'EMPTY' ? 'REJECTED' : t.qa_state
  const tone = TANK_TONE[toneKey]
  const label = !t.is_active ? 'Ngừng dùng' : t.expired && t.qa_state !== 'EMPTY' && t.qa_state !== 'REJECTED' ? 'Quá hạn lưu' : tone.label
  const mat = t.lots[0]?.batch?.material ?? null
  const inMat = !mat ? t.incoming[0] ?? null : null
  const cap = Number(t.capacity) || 0
  // chữ theo tầng: vận hành đọc được từ tỉ lệ 60% (≈ 10 px trên màn) · chi tiết từ 110%
  const sz = lod === 2 ? { code: 26, small: 16, qty: 18, qh: 34, qf: 16, card: 17, cardS: 15 } : { code: 18, small: 12, qty: 13, qh: 28, qf: 12, card: 12, cardS: 11 }
  const shown = incoming.length > 3 ? incoming.slice(0, 2) : incoming
  const more = incoming.length - shown.length
  const select = () => { if (!arrange) onSelect(t) }
  const title = `Bồn ${t.code}${t.name ? ` · ${t.name}` : ''} — ${label} · ${nf(Number(t.content))}/${nf(cap)} ${t.unit}${incoming.length ? ` · ${incoming.length} mẻ đang tới` : ''}`
  return (
    <div data-node={t.id} data-testid={`node-${t.code}`} data-lod={lod} data-alarm={bad ? '1' : undefined} role="group" aria-label={title}
      className={`absolute rounded-xl transition-opacity ${dim ? 'opacity-25' : ''} ${arrange ? 'cursor-move' : ''}`}
      style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H, zIndex: dragging ? 5 : undefined }}>
      {/* nền ô (mặt đồng hồ của thiết bị) */}
      <div className={`absolute inset-0 rounded-xl border ${selected ? 'border-sky-500 ring-4 ring-sky-300/60' : arrange ? 'border-dashed border-amber-400' : 'border-slate-200'}
        ${flash ? 'ring-8 ring-amber-400/70 animate-pulse' : ''} ${bad ? 'bg-red-50/70' : 'bg-white/80'}`} />
      {/* ống vào / ống ra */}
      <svg className="absolute inset-0 pointer-events-none overflow-visible" width={NODE_W} height={NODE_H} aria-hidden>
        <line x1={cx} x2={cx} y1={incoming.length ? g.laneBot : g.ty - 6} y2={g.ty + 10} stroke={flowIn ? '#0ea5e9' : '#cbd5e1'} strokeWidth={lod === 1 ? 12 : 9} strokeLinecap="round" />
        {flowIn && <line className="tm-flow" x1={cx} x2={cx} y1={g.laneBot} y2={g.ty + 10} stroke="#e0f2fe" strokeWidth={lod === 1 ? 4 : 3} strokeDasharray="6 10" strokeLinecap="round" />}
        <line x1={cx} x2={cx} y1={g.ty + th * 0.86} y2={runs.length ? OUT_Y : g.ty + th + 6} stroke={runs.length ? '#22c55e' : '#cbd5e1'} strokeWidth={lod === 1 ? 12 : 9} strokeLinecap="round" />
        {runs.length > 0 && <line className="tm-flow" x1={cx} x2={cx} y1={g.ty + th * 0.86} y2={OUT_Y} stroke="#dcfce7" strokeWidth={lod === 1 ? 4 : 3} strokeDasharray="6 10" strokeLinecap="round" />}
      </svg>

      {/* TOÀN CẢNH: mã bồn chữ to + số mẻ đang tới */}
      {lod === 1 && <>
        <div className={`absolute inset-x-0 top-0 truncate text-center font-mono font-bold ${bad ? 'text-red-700' : 'text-slate-800'}`} style={{ fontSize: 36, lineHeight: '44px' }}>{t.code}</div>
        {lead && (
          <div className={`absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-2 whitespace-nowrap rounded-full border-2 px-4 font-bold ${STAGE_CHIP[stageOf(lead.stage)]}`}
            style={{ top: 48, height: 52, fontSize: 26 }} title={incoming.map(b => `${b.code} — ${stageLabel(b.stage, b.step)}`).join('\n')}>
            <StageSymbol stage={lead.stage} step={lead.step} className="h-7 w-7" />{incoming.length} mẻ
          </div>
        )}
      </>}

      {/* VẬN HÀNH / CHI TIẾT: thẻ mẻ đang làm cho bồn — đứng TRÊN bồn (bồn nằm sau khâu của mẻ) */}
      {lod !== 1 && <div className="absolute" style={{ left: 8, top: 0, width: NODE_W - 16 }}>
        {shown.map(b => {
          const k = stageKey(b.stage, b.step)
          return (
            <button key={b.id} type="button" data-batch={b.code} data-key={k} tabIndex={arrange ? -1 : 0}
              onClick={e => { e.stopPropagation(); if (!arrange) onOpenBatch(b.id) }}
              title={`${b.code}${b.cycle ? ` · chu kỳ ${b.cycle}` : ''}${b.shift ? ` · ${b.shift}` : ''} — ${stageLabel(b.stage, b.step)} (bấm để mở mẻ)`}
              className={`mb-1 flex w-full min-w-0 items-center gap-1.5 rounded-md border px-2 text-left leading-tight ${STAGE_CHIP[stageOf(b.stage)]} ${filter && filter === k ? 'ring-2 ring-sky-500' : ''}`}
              style={{ height: 36 }}>
              <StageSymbol stage={b.stage} step={b.step} className={lod === 2 ? 'h-[18px] w-[18px]' : 'h-4 w-4'} />
              {lod === 2 ? <>
                <span className="font-bold whitespace-nowrap" style={{ fontSize: sz.card }}>Mẻ {b.no ?? '—'}</span>
                <span className="ml-auto truncate font-medium" style={{ fontSize: sz.cardS }}>{stageShort(b.stage, b.step)}</span>
              </> : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold" style={{ fontSize: sz.card }}>Mẻ {b.no ?? '—'}{b.cycle ? ` · CK ${b.cycle}` : ''}{b.shift ? ` · ${b.shift}` : ''}</span>
                  <span className="block truncate" style={{ fontSize: sz.cardS }}>{stageLabel(b.stage, b.step)}</span>
                </span>
              )}
            </button>
          )
        })}
        {more > 0 && (
          <button type="button" tabIndex={arrange ? -1 : 0} onClick={e => { e.stopPropagation(); select() }} className="flex w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/90 font-semibold text-slate-600"
            style={{ height: 36, fontSize: sz.cardS }}>+{more} mẻ nữa — bấm bồn để xem</button>
        )}
      </div>}

      {/* THÂN BỒN */}
      <div role="button" tabIndex={arrange ? -1 : 0} title={title} data-testid={`tank-${t.code}`}
        onClick={e => { e.stopPropagation(); select() }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select() } }}
        className={`absolute outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded-lg ${arrange ? '' : 'cursor-pointer'}`}
        style={{ left: g.tx, top: g.ty, width: g.tw }}>
        <TankGlyph t={t} lod={lod} w={g.tw} selected={selected} />
        {bad && (
          <span className="absolute grid place-items-center rounded-full bg-red-600 text-white font-black shadow" aria-label="Cần xử lý"
            style={{ right: lod === 1 ? -14 : -8, top: lod === 1 ? -6 : -4, width: lod === 1 ? 40 : 26, height: lod === 1 ? 40 : 26, fontSize: lod === 1 ? 26 : 17 }}>!</span>
        )}
      </div>

      {/* THÔNG SỐ bên phải bồn */}
      {lod !== 1 && (
        <div className="absolute min-w-0" style={{ left: 132, top: g.ty + 2, width: NODE_W - 140 }}>
          <div className="truncate font-mono font-bold text-slate-800" style={{ fontSize: sz.code, lineHeight: 1.15 }} title={t.name ?? undefined}>{t.code}</div>
          <div className={`truncate font-semibold ${t.is_active ? tone.text : 'text-slate-400'}`} style={{ fontSize: sz.small, lineHeight: 1.35 }}>{label}</div>
          <div className="truncate tabular-nums font-semibold text-slate-900" style={{ fontSize: sz.qty, lineHeight: 1.35 }}>
            {nf(Number(t.content))}<span className="font-normal text-slate-400">/{nf(cap)} {t.unit}</span>
          </div>
          <div className="truncate font-mono text-slate-500" style={{ fontSize: sz.small, lineHeight: 1.35 }} title={mat?.short_name ?? inMat?.material_name ?? undefined}>
            {mat ? mat.material_code : inMat ? `đặt ${inMat.material_code ?? ''}` : '—'}
          </div>
          {lod === 3 && <>
            {(mat?.short_name || inMat?.material_name) && <div className="truncate text-slate-500" style={{ fontSize: 11, lineHeight: 1.35 }}>{mat?.short_name ?? inMat?.material_name}</div>}
            {t.next_expiry && <div className={`truncate tabular-nums ${t.expired ? 'font-semibold text-red-600' : 'text-slate-500'}`} style={{ fontSize: 11, lineHeight: 1.35 }}>Hạn lưu {formatDateTime(t.next_expiry).slice(0, 16)}</div>}
          </>}
        </div>
      )}
      {lod !== 1 && quick.length > 0 && (
        <div className="absolute flex flex-col" style={{ left: 132, width: NODE_W - 140, top: g.ty + th - 2 - quick.length * sz.qh - (quick.length - 1) * 6, gap: 6 }}
          onClick={e => e.stopPropagation()}>
          {quick.map(qk => (
            <button key={qk.key} type="button" data-quick={qk.key} tabIndex={arrange ? -1 : 0} title={qk.label}
              onClick={e => { e.stopPropagation(); if (!arrange) qk.onClick() }}
              className={`inline-flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-1 font-semibold ${qk.tone === 'blue' ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'}`}
              style={{ height: sz.qh, fontSize: sz.qf }}>
              <qk.icon className={lod === 2 ? 'h-4 w-4 shrink-0' : 'h-3.5 w-3.5 shrink-0'} /><span className="truncate">{lod === 2 ? qk.short : qk.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ỐNG RA → MÁY ĐÓNG GÓI đang rút (Sổ đóng gói đang mở) */}
      {runs.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 inline-flex max-w-[224px] items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-green-300 bg-green-50 px-3 font-semibold text-green-800"
          style={{ top: OUT_Y, height: lod === 1 ? 40 : 34, fontSize: lod === 1 ? 24 : lod === 2 ? 14 : 12 }}
          title={runs.map(r => `Máy ${r.machine_code} · ${r.material_code} · từ ${formatDateTime(r.start_at)}`).join('\n')} data-testid={`run-${t.code}`}>
          <Play className={lod === 1 ? 'h-6 w-6 shrink-0 fill-green-600' : 'h-3.5 w-3.5 shrink-0 fill-green-600'} />
          <span className="truncate">{lod === 1 ? runs[0].machine_code : `Máy ${runs[0].machine_code}${lod === 3 ? ` · ${runs[0].material_code} · từ ${formatTimestampTime(runs[0].start_at).slice(0, 5)}` : ''}`}</span>
          {runs.length > 1 && <span>+{runs.length - 1}</span>}
        </div>
      )}
      {/* chế độ Sắp xếp: cả ô là tay nắm kéo */}
      {arrange && <div className="absolute inset-0" />}
    </div>
  )
})

type Gesture =
  | { kind: 'pan'; id: number; x0: number; y0: number; v0: View; moved: boolean }
  | { kind: 'pinch'; v0: View; m0: Pt; d0: number }
  | { kind: 'node'; id: number; tank: string; x0: number; y0: number; lx0: number; ly0: number; base: LayoutDraft; moved: boolean }

export function TankMap2D({ tanks, selectedId, onSelect, onOpenBatch, quick, arrange, onArrangeEnd, updatedAt }: {
  tanks: TankRow[]; selectedId?: string | null
  onSelect: (t: TankRow) => void
  onOpenBatch: (batchId: string) => void
  quick?: (t: TankRow) => TankQuick[]
  /** chế độ Sắp xếp (người có quyền Quản lý bồn bật ở thanh công cụ) */
  arrange: boolean
  onArrangeEnd: () => void
  updatedAt?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ scale: 0.5, ox: 16, oy: 16 })
  const viewRef = useRef(view); viewRef.current = view
  const [filter, setFilter] = useState('')
  const [full, setFull] = useState(false)
  const [mini, setMini] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640)
  const [legend, setLegend] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640)
  const [flash, setFlash] = useState<string | null>(null)
  const [gotoId, setGotoId] = useState('')
  const [alarmIx, setAlarmIx] = useState(0)
  const [draft, setDraft] = useState<LayoutDraft>(new Map())
  const [dragId, setDragId] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const save = useSaveTankLayout()

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // khung dùng để TỰ XẾP: chốt theo khung lúc mở (đổi khi đổi kho / xoay ngang–dọc) — kéo dãn cửa sổ không làm bồn nhảy chỗ
  const names = useMemo(() => Object.fromEntries(tanks.map(t => [t.warehouse_id, t.warehouse?.name ?? ''])), [tanks])
  const areaKey = useMemo(() => [...new Set(tanks.map(t => t.warehouse_id))].join(','), [tanks])
  const orient = size.w >= size.h ? 'L' : 'P'
  const lvKey = `${areaKey}|${orient}|${full ? 'F' : 'N'}`
  const [lv, setLv] = useState({ key: '', W: 0, H: 0 })
  useEffect(() => { if (size.w > 50 && size.h > 50 && lv.key !== lvKey) setLv({ key: lvKey, W: size.w, H: size.h }) }, [lvKey, size.w, size.h, lv.key])
  const layout: MapLayout = useMemo(() => layoutTanks(tanks, names, lv.W || 1200, lv.H || 700, arrange ? draft : undefined), [tanks, names, lv.W, lv.H, arrange, draft])
  const layoutRef = useRef(layout); layoutRef.current = layout
  const sizeRef = useRef(size); sizeRef.current = size
  // khung nổi ở đáy (chú giải trái · bản đồ thu nhỏ phải) đang mở ⇒ "Vừa màn" chừa phần đáy đó
  const mmW = 168, mmH = Math.round(Math.min(Math.max(mmW * layout.height / Math.max(layout.width, 1), 56), 150))
  const padRef = useRef(0); padRef.current = Math.max(legend ? 96 : 0, mini ? mmH + 20 : 0)

  const fit = useCallback(() => {
    const L = layoutRef.current, s = sizeRef.current
    if (s.w < 50 || !L.width) return
    setView(fitView(L.width, L.height, s.w, Math.max(s.h - padRef.current, s.h * 0.6), 24, MIN, 1.2))
  }, [])
  // mở màn / đổi kho: cả sơ đồ vừa khung nếu chữ còn đọc được (tỉ lệ ≥ 0,4); nhiều bồn trên màn nhỏ ⇒ tỉ lệ đọc được từ góc trái trên,
  // kéo / thu phóng để xem tiếp — nút "Vừa màn" luôn cho toàn cảnh
  const fitKey = `${lv.key}|${tanks.length}`
  const fitted = useRef('')
  useEffect(() => {
    if (!lv.key || !tanks.length || fitted.current === fitKey) return
    fitted.current = fitKey
    const L = layoutRef.current
    const f = fitView(L.width, L.height, lv.W, Math.max(lv.H - padRef.current, lv.H * 0.6), 24, MIN, 1.2)
    setView(f.scale >= 0.4 ? f : { scale: 0.6, ox: 16, oy: 16 })
  }, [fitKey, lv.key, lv.W, lv.H, tanks.length])

  const lod = lodOf(view.scale)
  const all = useMemo(() => tanks.map(t => ({ t, bs: boardBatchesOf(t) })), [tanks])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const { bs } of all) for (const b of bs) { const k = stageKey(b.stage, b.step); m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }, [all])
  const totalBatches = [...counts.values()].reduce((s, n) => s + n, 0)
  const active = filter && counts.get(filter) ? filter : ''
  const quicks = useMemo(() => new Map(tanks.map(t => [t.id, quick?.(t) ?? []])), [tanks, quick])
  const alarms = useMemo(() => tanks.filter(isAlarm), [tanks])

  const focusTank = useCallback((id: string) => {
    const n = layoutRef.current.nodes.get(id), s = sizeRef.current
    if (!n || s.w < 50) return
    setView(centerOn(n.x + NODE_W / 2, n.y + NODE_H / 2, Math.max(viewRef.current.scale, 1), s.w, s.h))
    setFlash(id)
  }, [])
  useEffect(() => { if (!flash) return; const h = setTimeout(() => setFlash(null), 2400); return () => clearTimeout(h) }, [flash])

  // ── thu phóng / rê ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const zoomBy = (f: number) => setView(v => zoomAt(v, size.w / 2, size.h / 2, f, MIN, MAX))
  const zoom100 = () => setView(v => zoomAt(v, size.w / 2, size.h / 2, 1 / v.scale, MIN, MAX))
  // lăn = thu phóng quanh con trỏ (cùng thói quen với Sơ đồ kho). Listener native non-passive để chặn trang cuộn theo.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      setView(v => zoomAt(v, e.clientX - r.left, e.clientY - r.top, f, MIN, MAX))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const ptrs = useRef(new Map<number, Pt>())
  const gesture = useRef<Gesture | null>(null)
  const suppressUntil = useRef(0)
  const rel = (cx: number, cy: number): Pt => { const r = wrapRef.current!.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top } }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return
    const target = e.target as HTMLElement
    if (target.closest('[data-map-ui]')) return                    // nút điều khiển / bản đồ thu nhỏ nổi trên sơ đồ
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()]
      gesture.current = { kind: 'pinch', v0: viewRef.current, m0: rel((a.x + b.x) / 2, (a.y + b.y) / 2), d0: Math.hypot(a.x - b.x, a.y - b.y) }
      return
    }
    if (ptrs.current.size > 2) return
    const nodeEl = target.closest('[data-node]') as HTMLElement | null
    if (arrange && nodeEl && e.button === 0) {
      const id = nodeEl.dataset.node!
      const n = layoutRef.current.nodes.get(id)
      if (!n) return
      gesture.current = { kind: 'node', id: e.pointerId, tank: id, x0: e.clientX, y0: e.clientY, lx0: n.lx, ly0: n.ly, base: pinArea(layoutRef.current, n.area, draft), moved: false }
      return
    }
    gesture.current = { kind: 'pan', id: e.pointerId, x0: e.clientX, y0: e.clientY, v0: viewRef.current, moved: false }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!ptrs.current.has(e.pointerId)) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      if (ptrs.current.size !== 2) return
      const [a, b] = [...ptrs.current.values()]
      setView(pinchView(g.v0, g.m0, g.d0, rel((a.x + b.x) / 2, (a.y + b.y) / 2), Math.hypot(a.x - b.x, a.y - b.y), MIN, MAX))
      return
    }
    if (g.id !== e.pointerId) return
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 5) return
      g.moved = true
      wrapRef.current?.setPointerCapture(e.pointerId)
      if (g.kind === 'node') setDragId(g.tank)
    }
    if (g.kind === 'pan') {
      const L = layoutRef.current
      setView(keepInView({ ...g.v0, ox: g.v0.ox + dx, oy: g.v0.oy + dy }, L.width, L.height, size.w, size.h, 80))
    } else {
      const s = viewRef.current.scale
      const next = new Map(g.base)
      next.set(g.tank, { x: snap(g.lx0 + dx / s), y: snap(g.ly0 + dy / s) })
      setDraft(next)
    }
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    ptrs.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      if (ptrs.current.size < 2) { gesture.current = null; suppressUntil.current = Date.now() + 350 }
      return
    }
    if (g.id !== e.pointerId) return
    if (g.moved) suppressUntil.current = Date.now() + 350
    if (g.kind === 'node') setDragId(null)
    gesture.current = null
  }
  // vừa kéo / chụm xong thì cú "bấm" nhả tay không mở bồn
  const onClickCapture = (e: React.MouseEvent) => { if (Date.now() < suppressUntil.current) { e.stopPropagation(); e.preventDefault() } }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== wrapRef.current) return
    const pan = (dx: number, dy: number) => setView(v => ({ ...v, ox: v.ox + dx, oy: v.oy + dy }))
    if (e.key === '+' || e.key === '=') zoomBy(1.2)
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2)
    else if (e.key === '0') fit()
    else if (e.key === '1') zoom100()
    else if (e.key === 'ArrowLeft') pan(60, 0)
    else if (e.key === 'ArrowRight') pan(-60, 0)
    else if (e.key === 'ArrowUp') pan(0, 60)
    else if (e.key === 'ArrowDown') pan(0, -60)
    else return
    e.preventDefault()
  }

  // ── toàn màn hình (màn TV phòng điều hành): khung phủ cả cửa sổ + xin trình duyệt toàn màn (không được thì vẫn phủ cửa sổ) ──────────
  const refitAfterResize = useRef(false)
  function toggleFull() {
    refitAfterResize.current = true
    if (!full) { setFull(true); document.documentElement.requestFullscreen?.().catch(() => {}) }
    else { setFull(false); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }
  }
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(f => { if (f) refitAfterResize.current = true; return false }) }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  useEffect(() => { if (refitAfterResize.current && size.w > 50) { refitAfterResize.current = false; const h = setTimeout(fit, 60); return () => clearTimeout(h) } }, [size.w, size.h, fit])
  useEffect(() => () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }, [])

  // ── Sắp xếp: bản nháp chỗ đặt; Lưu gửi phần khác DB ────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => { if (!arrange) { setDraft(new Map()); setErr('') } }, [arrange])
  const changes = useMemo(() => (arrange ? changedItems(tanks, draft) : []), [arrange, tanks, draft])
  async function saveLayout() {
    setErr('')
    try { if (changes.length) await save.mutateAsync(changes); onArrangeEnd() } catch (e) { setErr(apiMsg(e)) }
  }

  // ── bản đồ thu nhỏ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const mmRef = useRef<SVGSVGElement>(null)
  const mmDrag = useRef(false)
  const mmGo = (cx: number, cy: number) => {
    const el = mmRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const k = Math.min(r.width / layout.width, r.height / layout.height)
    const offX = (r.width - layout.width * k) / 2, offY = (r.height - layout.height * k) / 2
    const wx = (cx - r.left - offX) / k, wy = (cy - r.top - offY) / k
    setView(v => centerOn(wx, wy, v.scale, size.w, size.h))
  }
  const vis = { x: -view.ox / view.scale, y: -view.oy / view.scale, w: size.w / view.scale, h: size.h / view.scale }
  const fillOf = (t: TankRow) => (isAlarm(t) ? '#ef4444' : t.qa_state === 'RELEASED' ? STAGE_LIQUID.released.a : t.qa_state === 'HOLD' ? STAGE_LIQUID.filled.a : '#cbd5e1')

  const ctl = 'grid h-9 w-9 sm:h-8 sm:w-8 place-items-center rounded-md border border-slate-300 bg-white/95 text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40'
  const grid = view.scale >= 0.3
  return (
    <div className={full ? 'fixed inset-0 z-[45] flex flex-col bg-white' : 'flex flex-1 min-h-0 flex-col'} data-testid="tank-map">
      <style>{'@keyframes tm-flow{to{stroke-dashoffset:-32}}.tm-flow{animation:tm-flow 1s linear infinite}@media (prefers-reduced-motion:reduce){.tm-flow{animation:none}}'}</style>
      {/* dải lọc theo bước + đến bồn */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5 shrink-0">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5 sm:flex-wrap" data-testid="board-filter" role="group" aria-label="Lọc mẻ theo tình trạng">
          {totalBatches > 0 && <>
            <button type="button" onClick={() => setFilter('')} aria-pressed={!active}
              className={`h-7 shrink-0 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-medium ${!active ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>
              Mọi mẻ <b className="tabular-nums">{totalBatches}</b>
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
          </>}
          {!totalBatches && <span className="text-[11px] text-slate-400">Chưa có mẻ nào đang tới bồn.</span>}
        </div>
        {/* cảnh báo bất thường (ISA-101: luôn ở chỗ cố định, không che bản vẽ) + trực tiếp */}
        {alarms.length > 0 && (
          <button type="button" data-testid="map-alarm" onClick={() => { const t = alarms[alarmIx % alarms.length]; setAlarmIx(i => i + 1); focusTank(t.id) }}
            title={`Bấm để nhảy lần lượt tới từng bồn:\n${alarms.map(t => `${t.code}: ${t.qa_state === 'REJECTED' ? 'QA loại' : 'quá hạn lưu'}`).join('\n')}`}
            className="inline-flex h-8 sm:h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-red-300 bg-red-50 px-2 text-[11px] font-semibold text-red-700 hover:bg-red-100">
            <AlertTriangle className="h-3.5 w-3.5" />{alarms.length}<span className="hidden sm:inline"> bồn cần xử lý</span>
          </button>
        )}
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-green-700" data-testid="map-live"
          title={`Sơ đồ tự cập nhật khi có người cấp NVL, quét đổ bồn, nạp bồn, QA, đóng gói — không cần tải lại trang${updatedAt ? ` (lần cuối ${formatTimestampTime(new Date(updatedAt).toISOString())})` : ''}`}>
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>
          <span className="hidden sm:inline">Trực tiếp{updatedAt ? ` · ${formatTimestampTime(new Date(updatedAt).toISOString()).slice(0, 5)}` : ''}</span>
        </span>
        <div className="w-24 sm:w-36 shrink-0" data-testid="map-goto">
          <SingleSelect value={gotoId} onChange={v => { setGotoId(v); focusTank(v) }} triggerClassName="h-8 sm:h-7" placeholder="Đến bồn…" searchPlaceholder="Mã bồn…"
            searchable={tanks.length > 8} options={tanks.map(t => ({ value: t.id, label: t.code, sub: t.name ?? undefined }))} />
        </div>
      </div>

      <div ref={wrapRef} tabIndex={0} aria-label="Sơ đồ bồn — lăn chuột hoặc chụm hai ngón để thu phóng, kéo để di chuyển, phím 0 để vừa màn"
        className={`relative flex-1 min-h-[55vh] lg:min-h-0 overflow-hidden bg-slate-100 outline-none select-none touch-none cursor-grab active:cursor-grabbing`}
        style={grid ? { backgroundImage: 'radial-gradient(circle, #cbd5e1 1.2px, transparent 1.4px)', backgroundSize: `${40 * view.scale}px ${40 * view.scale}px`, backgroundPosition: `${view.ox}px ${view.oy}px` } : undefined}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture} onKeyDown={onKeyDown} onContextMenu={e => e.preventDefault()} data-testid="map-viewport" data-scale={view.scale.toFixed(3)} data-lod={lod}>
        {/* BẢN VẼ */}
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: layout.width, height: layout.height, transform: `translate(${view.ox}px, ${view.oy}px) scale(${view.scale})` }}>
          {layout.areas.map(a => (
            <div key={a.id} className="absolute rounded-2xl border-2 border-slate-300 bg-white/50" style={{ left: a.x, top: a.y, width: a.w, height: a.h }} data-testid="map-area">
              <div className="flex items-baseline gap-3 truncate px-6 font-bold text-slate-700" style={{ height: AREA_HEAD, lineHeight: `${AREA_HEAD}px`, fontSize: 40 }}>
                {a.name || 'Kho chế biến'}<span className="font-medium text-slate-400" style={{ fontSize: 28 }}>{a.count} bồn</span>
              </div>
            </div>
          ))}
          {all.map(({ t, bs }) => {
            const n = layout.nodes.get(t.id)
            if (!n) return null
            return (
              <TankNode key={t.id} t={t} n={n} lod={lod} selected={selectedId === t.id} filter={active} arrange={arrange} dragging={dragId === t.id}
                dim={!!active && !bs.some(b => stageKey(b.stage, b.step) === active)} flash={flash === t.id}
                quick={quicks.get(t.id) ?? []} onSelect={onSelect} onOpenBatch={onOpenBatch} />
            )
          })}
        </div>

        {/* trên-phải: điều khiển thu phóng */}
        <div className="absolute right-2 top-2 z-20 flex flex-col items-center gap-1" data-map-ui>
          <button type="button" className={ctl} onClick={() => zoomBy(1.25)} title="Phóng to (+)" aria-label="Phóng to" data-testid="map-zoom-in"><Plus className="h-4 w-4" /></button>
          <button type="button" className={ctl} onClick={() => zoomBy(1 / 1.25)} title="Thu nhỏ (−)" aria-label="Thu nhỏ" data-testid="map-zoom-out"><Minus className="h-4 w-4" /></button>
          <button type="button" onClick={zoom100} title="Về tỉ lệ 100% (phím 1)" data-testid="map-zoom-label"
            className="h-7 w-11 rounded-md border border-slate-300 bg-white/95 text-[10px] font-semibold tabular-nums text-slate-600 shadow-sm hover:bg-slate-50">{Math.round(view.scale * 100)}%</button>
          <button type="button" className={ctl} onClick={fit} title="Vừa màn — xem toàn cảnh (phím 0)" aria-label="Vừa màn" data-testid="map-fit"><Maximize2 className="h-4 w-4" /></button>
          <button type="button" className={`${ctl} ${mini ? 'bg-sky-50 text-sky-700' : ''}`} onClick={() => setMini(m => !m)} title="Bản đồ thu nhỏ" aria-pressed={mini} data-testid="map-minimap-toggle"><MapIcon className="h-4 w-4" /></button>
          <button type="button" className={ctl} onClick={toggleFull} title={full ? 'Thoát toàn màn hình' : 'Toàn màn hình (màn TV điều hành)'} aria-label="Toàn màn hình" data-testid="map-full">{full ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}</button>
          <button type="button" className={`${ctl} ${legend ? 'bg-sky-50 text-sky-700' : ''}`} onClick={() => setLegend(l => !l)} title="Chú giải" aria-pressed={legend} data-testid="map-legend-toggle"><Info className="h-4 w-4" /></button>
        </div>

        {/* dưới-phải: bản đồ thu nhỏ — khung xanh = phần đang xem; bấm / kéo để nhảy */}
        {mini && layout.width > 0 && (
          <div className="absolute bottom-2 right-2 z-20 rounded-lg border border-slate-300 bg-white/95 p-1 shadow" data-map-ui data-testid="map-minimap">
            <svg ref={mmRef} width={mmW} height={mmH} viewBox={`0 0 ${layout.width} ${layout.height}`} className="block cursor-pointer touch-none"
              onPointerDown={e => { mmDrag.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); mmGo(e.clientX, e.clientY) }}
              onPointerMove={e => { if (mmDrag.current) mmGo(e.clientX, e.clientY) }}
              onPointerUp={() => { mmDrag.current = false }} onPointerCancel={() => { mmDrag.current = false }}>
              {layout.areas.map(a => <rect key={a.id} x={a.x} y={a.y} width={a.w} height={a.h} rx={24} fill="#f8fafc" stroke="#94a3b8" strokeWidth={Math.max(layout.width / mmW, 1) * 1.2} />)}
              {tanks.map(t => { const n = layout.nodes.get(t.id); return n ? <rect key={t.id} x={n.x + 40} y={n.y + 100} width={NODE_W - 80} height={NODE_H - 140} rx={18} fill={fillOf(t)} /> : null })}
              <rect x={vis.x} y={vis.y} width={vis.w} height={vis.h} fill="rgba(14,165,233,.12)" stroke="#0284c7" strokeWidth={Math.max(layout.width / mmW, 1) * 2} />
            </svg>
          </div>
        )}

        {/* dưới-trái: chú giải */}
        {legend && (
          <div className="absolute bottom-2 left-2 z-20 max-w-[calc(100%-1rem)] sm:max-w-[360px] rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] text-slate-600 shadow-sm" data-map-ui data-testid="board-legend">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: STAGE_LIQUID.filled.a }} />Chờ QA bồn</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: STAGE_LIQUID.released.a }} />QA đạt</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: STAGE_LIQUID.rejected.a }} />QA loại / quá hạn lưu</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm border border-slate-400" style={{ background: 'repeating-linear-gradient(45deg,#94a3b8 0 1.5px,#f1f5f9 1.5px 3px)' }} />Mẻ sắp vào</span>
              <span className="inline-flex items-center gap-1"><span className="h-1 w-4 rounded bg-sky-500" />Đang đổ vào bồn</span>
              <span className="inline-flex items-center gap-1"><span className="h-1 w-4 rounded bg-green-500" />Máy đóng gói đang rút</span>
            </div>
            <p className="mt-0.5 text-slate-400">Lăn chuột / chụm hai ngón: thu phóng · kéo: di chuyển · phóng to để xem chi tiết từng mẻ</p>
          </div>
        )}

        {/* SẮP XẾP: thanh lưu */}
        {arrange && (
          <div className="absolute left-1/2 top-12 sm:top-2 z-30 w-[min(560px,calc(100%-1rem))] -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow" data-map-ui data-testid="arrange-bar">
            <p className="font-semibold">Sắp xếp sơ đồ — kéo bồn tới đúng chỗ ngoài xưởng (bắt lưới 20 điểm).</p>
            <p className="text-[11px] text-amber-800">Lưu xong mọi người thấy cùng bản vẽ. "Xếp tự động" trả mọi bồn về lưới tự xếp vừa khung.</p>
            {err && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-red-700 border border-red-200">{err}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setDraft(new Map(tanks.map(t => [t.id, null])))} disabled={save.isPending}
                className="inline-flex h-8 sm:h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Xếp tự động</button>
              <button type="button" onClick={onArrangeEnd} disabled={save.isPending}
                className="inline-flex h-8 sm:h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><X className="h-3.5 w-3.5" />Huỷ</button>
              <button type="button" onClick={() => void saveLayout()} disabled={save.isPending || !changes.length} data-testid="arrange-save"
                className="ml-auto inline-flex h-8 sm:h-7 items-center gap-1 rounded-md bg-sky-600 px-3 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                <Save className="h-3.5 w-3.5" />{save.isPending ? 'Đang lưu…' : `Lưu chỗ đặt${changes.length ? ` (${changes.length} bồn)` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

