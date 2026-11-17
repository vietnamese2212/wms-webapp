// SƠ ĐỒ BỒN 2D (MES 17/11 — user: "vẽ 1 dạng 2D của bồn, thể hiện bồn nào dung tích bao nhiêu, đang chứa gì một cách realtime").
// Theo lối màn hình điều khiển nhà máy (HMI kiểu ISA-101): thân bồn trung tính, mực chất lỏng tỷ lệ đúng với sức chứa, MÀU chỉ dùng
// để nói tình trạng (đạt = xanh · chờ QA = vàng · không đạt / quá hạn lưu = đỏ), con số luôn in cạnh hình.
//   • mỗi MẺ trong bồn là một lớp (lớp nạp trước nằm dưới) — bồn nhiều mẻ nhìn ra ngay;
//   • phần GẠCH CHÉO phía trên mực = mẻ đã đặt bồn này mà chưa nạp (sắp vào) — thấy luôn bồn còn nhận được bao nhiêu;
//   • thang chia 25 / 50 / 75 / 100 % ở mép phải, số theo đơn vị bồn.
// Dữ liệu = danh sách bồn đang sống (`useProductionTanks`, realtime qua production_tank / production_batch) — không gọi thêm API.
import type { ReactNode } from 'react'
import type { TankRow, TankQaState } from '@/api/productionHooks'

const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 1 })
// hai sắc xen kẽ cho các lớp mẻ của cùng một tình trạng
const TONE: Record<TankQaState, { a: string; b: string; text: string; label: string }> = {
  EMPTY:    { a: '#e2e8f0', b: '#e2e8f0', text: 'text-slate-400', label: 'Trống' },
  RELEASED: { a: '#0ea5e9', b: '#38bdf8', text: 'text-sky-700',   label: 'QA đạt' },
  HOLD:     { a: '#f59e0b', b: '#fbbf24', text: 'text-amber-700', label: 'Chờ QA' },
  REJECTED: { a: '#ef4444', b: '#f87171', text: 'text-red-700',   label: 'Không đạt' },
}
// hình bồn: thân trụ đứng, hai đáy cong, bốn chân — toạ độ trong khung 120 × 150
const X0 = 14, X1 = 86, TOP = 16, BOT = 126, DISH = 9
const BODY = `M${X0},${TOP} Q${(X0 + X1) / 2},${TOP - DISH * 2} ${X1},${TOP} L${X1},${BOT} Q${(X0 + X1) / 2},${BOT + DISH * 2} ${X0},${BOT} Z`
const H = BOT - TOP

export function hoursLeft(iso: string | null): string | null {
  if (!iso) return null
  const h = (Date.parse(iso) - Date.now()) / 3_600_000
  if (h < 0) return `quá ${nf(-h)} giờ`
  return h < 1 ? `còn ${Math.max(Math.round(h * 60), 1)} phút` : `còn ${nf(h)} giờ`
}

export function TankMimic({ tank, onOpenBatch, menu, footer }: {
  tank: TankRow; onOpenBatch?: (batchId: string) => void
  /** nút ⋮ thao tác (góc phải đầu thẻ) · nút việc chính dưới thẻ */
  menu?: ReactNode; footer?: ReactNode
}) {
  const cap = Number(tank.capacity) || 1
  const tone = TONE[tank.expired && tank.qa_state !== 'EMPTY' ? 'REJECTED' : tank.qa_state]
  const label = tank.expired && tank.qa_state !== 'EMPTY' && tank.qa_state !== 'REJECTED' ? 'Quá hạn lưu' : TONE[tank.qa_state].label
  const pct = Math.round(Number(tank.content) * 100 / cap)
  const clip = `tank-clip-${tank.id}`
  const hatch = `tank-hatch-${tank.id}`
  // các lớp: từ đáy lên — mỗi mẻ một lớp, rồi phần sắp vào
  let acc = 0
  const layers = tank.lots.map((l, i) => {
    const h = Math.max(Number(l.qty_remaining), 0) / cap * H
    const y = BOT - acc - h
    acc += h
    return { key: l.id, y, h, fill: i % 2 ? tone.b : tone.a, title: `${l.batch?.batch_code ?? ''}: ${nf(Number(l.qty_remaining))} ${tank.unit}` }
  })
  const level = acc
  const inH = Math.min(Number(tank.reserved) / cap * H, Math.max(H - level, 0))
  const mat = tank.lots[0]?.batch?.material ?? null
  const inMat = !mat && tank.incoming[0] ? tank.incoming[0] : null
  const left = hoursLeft(tank.next_expiry)
  return (
    <div className={`rounded-xl border bg-white p-2.5 flex flex-col gap-1.5 min-w-0 ${tank.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-60'}`} data-testid={`tank-${tank.code}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-sm font-bold text-slate-800 truncate" title={tank.name ?? undefined}>{tank.code}</span>
        <span className={`text-[10px] font-semibold ${tone.text}`}>{tank.is_active ? label : 'Ngừng dùng'}</span>
        <span className="ml-auto shrink-0">{menu}</span>
      </div>
      <div className="flex items-stretch gap-2 min-w-0">
        <svg viewBox="0 0 120 150" className="w-[104px] h-[130px] shrink-0" role="img"
          aria-label={`Bồn ${tank.code}: ${nf(Number(tank.content))} / ${nf(cap)} ${tank.unit} (${pct}%)`}>
          <defs>
            <clipPath id={clip}><path d={BODY} /></clipPath>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#f1f5f9" /><line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" strokeWidth="2" />
            </pattern>
          </defs>
          {/* chân bồn */}
          <path d={`M${X0 + 8},${BOT + 6} l-4,16 M${X1 - 8},${BOT + 6} l4,16`} stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
          <path d={BODY} fill="#f8fafc" />
          <g clipPath={`url(#${clip})`}>
            {layers.map(l => (
              <rect key={l.key} x={X0} width={X1 - X0} y={l.y} height={l.h + 0.5} fill={l.fill} style={{ transition: 'y .6s ease, height .6s ease' }}><title>{l.title}</title></rect>
            ))}
            {/* đáy cong nằm dưới vạch 0 — tô cùng màu lớp dưới cùng để mực không "hở đáy" */}
            {layers.length > 0 && <rect x={X0} width={X1 - X0} y={BOT} height={DISH * 2} fill={layers[0].fill} />}
            {layers.slice(1).map(l => <line key={`s${l.key}`} x1={X0} x2={X1} y1={l.y + l.h} y2={l.y + l.h} stroke="#ffffff" strokeWidth="1" opacity=".7" />)}
            {inH > 0.5 && <rect x={X0} width={X1 - X0} y={BOT - level - inH} height={inH} fill={`url(#${hatch})`} style={{ transition: 'y .6s ease, height .6s ease' }}>
              <title>{`Sắp vào: ${tank.incoming.map(x => `${x.batch_code} ${nf(x.qty)}`).join(' · ')}`}</title></rect>}
            {level > 0.5 && <line x1={X0} x2={X1} y1={BOT - level} y2={BOT - level} stroke="#0f172a" strokeWidth="1" opacity=".35" />}
          </g>
          <path d={BODY} fill="none" stroke={tank.expired || tank.qa_state === 'REJECTED' ? '#dc2626' : '#64748b'} strokeWidth="2" strokeLinejoin="round" />
          {/* thang chia */}
          {[0.25, 0.5, 0.75, 1].map(p => (
            <g key={p}>
              <line x1={X1} x2={X1 + 4} y1={BOT - p * H} y2={BOT - p * H} stroke="#94a3b8" strokeWidth="1" />
              <text x={X1 + 6} y={BOT - p * H + 3} fontSize="7.5" fill="#64748b">{nf(cap * p)}</text>
            </g>
          ))}
          {pct > 0 && <text x={(X0 + X1) / 2} y={Math.min(BOT - level / 2 + 4, BOT - 2)} textAnchor="middle" fontSize="13" fontWeight="700" fill="#ffffff"
            style={{ paintOrder: 'stroke', stroke: 'rgba(15,23,42,.35)', strokeWidth: 2 }}>{pct}%</text>}
        </svg>
        <div className="flex-1 min-w-0 text-[11px] leading-snug">
          <p className="tabular-nums"><span className="text-base font-bold text-slate-900">{nf(Number(tank.content))}</span><span className="text-slate-400"> / {nf(cap)} {tank.unit}</span></p>
          <p className="truncate text-slate-600" title={mat?.short_name ?? inMat?.material_name ?? undefined}>
            {mat ? <><span className="font-mono font-semibold">{mat.material_code}</span> {mat.short_name ?? ''}</>
              : inMat ? <span className="text-slate-500">đặt cho <span className="font-mono font-semibold">{inMat.material_code}</span></span>
              : <span className="text-slate-300">Chưa chứa gì</span>}
          </p>
          <div className="mt-1 space-y-0.5">
            {tank.lots.map((l, i) => (
              <p key={l.id} className="flex items-center gap-1 min-w-0">
                <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: i % 2 ? tone.b : tone.a }} />
                <button type="button" className="font-mono truncate hover:underline text-left" onClick={() => onOpenBatch?.(l.batch_id)}>{l.batch?.batch_code}</button>
                <span className="ml-auto shrink-0 tabular-nums text-slate-500">{nf(Number(l.qty_remaining))}</span>
              </p>
            ))}
            {tank.incoming.map(x => (
              <p key={x.batch_id} className="flex items-center gap-1 min-w-0 text-slate-500" title="Mẻ đã đặt bồn này, chưa nạp">
                <span className="h-2 w-2 rounded-sm shrink-0 border border-slate-400" style={{ background: 'repeating-linear-gradient(45deg,#94a3b8 0 1.5px,#f1f5f9 1.5px 3px)' }} />
                <button type="button" className="font-mono truncate hover:underline text-left" onClick={() => onOpenBatch?.(x.batch_id)}>{x.batch_code}</button>
                <span className="ml-auto shrink-0 tabular-nums">+{nf(x.qty)}</span>
              </p>
            ))}
          </div>
          {left && <p className={`mt-1 tabular-nums ${tank.expired ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>Hạn lưu: {left}</p>}
        </div>
      </div>
      {footer}
    </div>
  )
}
