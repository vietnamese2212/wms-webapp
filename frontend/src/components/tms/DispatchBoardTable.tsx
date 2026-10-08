// BÀN GHÉP XE DẠNG BẢNG (06/10, user: "ghép đơn dạng thẻ hơi khó nhìn — nên ghép dạng table kéo thả ở table, dễ nhìn hơn, đồng bộ
// từ trên xuống"; "tham khảo Manhattan, Blue Yonder… mục tiêu user có đầy đủ thông tin, dễ thao tác, dễ check").
//
// Khuôn workbench của các TMS lớn: Oracle OTM (bảng đơn chưa xếp ⇄ bảng chuyến — tick dòng đơn, kéo thả lên dòng chuyến), SAP TM
// Transportation Cockpit (bảng PHÂN CẤP chuyến → hàng, màn chia vùng), Blue Yonder SmartBench (bảng + bản đồ, kéo đơn từ xe A sang xe B):
//   • Trái = KHUNG CHỜ (bảng, gom phường / vùng / khách) · vách ngăn kéo đổi độ rộng · thu thành rãnh như bản thẻ.
//   • Phải = BẢNG CÂY: nhóm (vùng | loại xe) → dòng XE (tổng: tải · pallet · tấn · điểm · cước · ĐVVT · cờ) → dòng ĐƠN của xe.
//     Dòng xe và dòng đơn chung MỘT bộ cột nên đọc thẳng từ trên xuống; ô Tải của dòng đơn = phần sức chứa xe đơn đó chiếm.
//   • Cột SỐ (Tải · Pallet · Tấn) đứng ngay sau Xe · OD — khung chờ mở rộng cỡ nào vẫn thấy số của xe.
//   • Kéo dòng đơn (hoặc mọi dòng đã tick) thả lên BẤT KỲ dòng nào của xe đích · kéo DÒNG XE = gộp cả xe vào xe kia · kéo
//     dòng nhóm của khung chờ = cả cụm. Rê qua xe = các ô Tải · Pallet · Tấn · Khách · Cước · Lưu ý của dòng xe đổi sang số SAU
//     khi thả (cùng lời xem trước của bản thẻ) — biết kết quả trước khi thả.
//   • Bảng chuẩn ResizableTable (kéo giãn cột, đầu bảng + cột đầu dính, cột thao tác ghim phải trên PC) — cùng khuôn bảng Xem đơn.
// Cửa ghi · Hoàn tác · xem trước · hộp thoại · thanh chọn-nhiều dùng CHUNG với bản thẻ (DispatchBoard) — file này chỉ VẼ.
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Lock, Unlock, X, Ban, Truck, StickyNote, RotateCw, Replace } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter } from '@/components/shared/ListPager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import type { DispatchPlan, DispatchTrip, DispatchTripOd, DispatchOdFlag, DispatchMoveTo, DispatchMovePreview } from '@/api/hooks'
import { DispatchCarrierPicker } from './DispatchCarrierPicker'
import { NewOdChip } from './DispatchReviewTable'
import { tripStatus, issuesOf, ISSUE_ORDER, ISSUE_SHORT, TODO_KEYS, FLAG_VI, SOFT_FLAG_KINDS } from './dispatchIssues'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const money = (n: number | string | null | undefined) => {
  if (n == null) return '—'
  const v = Number(n), a = Math.abs(v)
  return a >= 1e6 ? `${nf(v / 1e6, 2)} tr` : `${nf(v)} ₫`
}
const uniq = <T,>(a: T[]) => [...new Set(a)]
/** 08/10 — điểm giao thứ mấy của khách trên xe (theo `detail.route`: kho → điểm gần trước); null = xe chưa đo được thứ tự */
const stopNoOf = (t: DispatchTrip | null, shipTo: string | null) => { const i = t?.detail.route?.order.indexOf(shipTo ?? '') ?? -1; return i >= 0 ? i + 1 : null }
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
// 1280 px có menu trái: khung chờ 400 ⇒ bảng xe ~610 px vẫn thấy Xe · Tải · Pallet · Tấn (đo 06/10 — 460 thì mất cột Tấn)
const POOL_W = 400, POOL_MIN = 300

export type BoardHover = { target: string; data: DispatchMovePreview | null; loading: boolean } | null
export type BoardDropAttrs = {
  'data-drop'?: string
  onDragOver?: (e: React.DragEvent) => void
  onDragEnter?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}
export interface BoardTripGroup { k: string; label: string; trips: DispatchTrip[]; pallets: number; tons: number; freight: number; todo: number; over: number }
export interface BoardPoolGroup { k: string; rows: DispatchTripOd[]; pallets: number }
/** Mọi thứ bảng cần từ DispatchBoard — cửa ghi / trạng thái kéo thả / bộ lọc là MỘT với bản thẻ. */
export interface BoardOps {
  plan: DispatchPlan; editable: boolean; canDrag: boolean; desktop: boolean; q: string
  flags: Map<string, DispatchOdFlag>; fresh: Set<string>; follow: Set<string>
  sel: Set<string>; toggle: (id: string) => void; toggleMany: (ids: string[]) => void
  editableTrip: (t: DispatchTrip) => boolean
  matches: (o: DispatchTripOd) => boolean
  idsFor: (o: DispatchTripOd) => string[]
  startDrag: (e: React.DragEvent, ids: string[], ghost?: boolean) => void
  endDrag: () => void
  dropProps: (to: DispatchMoveTo, target: string, tripId?: string) => BoardDropAttrs
  /** đang kéo đúng các đơn của chính xe này — không tô / không xem trước */
  ownDrop: (tripId: string) => boolean
  hover: BoardHover; justHit: string | null; busy: boolean
  poolGroups: BoardPoolGroup[]; poolGroupOpen: (k: string) => boolean; togglePoolGroup: (k: string) => void; poolEmpty: ReactNode
  tripGroups: BoardTripGroup[]; groupOpen: (k: string) => boolean; toggleGroup: (k: string) => void; armOpen: (k: string) => void
  regionBands: boolean; noModelKey: string; tripsShown: number; tripsTotal: number; clearFilter: () => void
  onOpenTrip: (id: string) => void; onOpenOd: (o: DispatchTripOd) => void
  openHoldFor: (ids: string[]) => void; openCustVehicles: (shipTo: string) => void; canCustVeh: boolean
  resync: (od: string) => void; replace: (od: string) => void; sapBusy: boolean
  toggleLock: (t: DispatchTrip) => void; removeTrip: (t: DispatchTrip) => void
  mixOn: (t: DispatchTrip) => boolean; setMix: (t: DispatchTrip, on: boolean) => void
  setCarrier: (t: DispatchTrip, carrierId: string) => void; tripBusy: boolean
  catChips: (cats: string[]) => ReactNode
  catsByLoad: (loads: (Record<string, number> | null | undefined)[]) => string[]
}

// Hai bảng chung MỘT bộ cột (khung chờ bỏ ba cột chỉ xe mới có: Tải · Cước · ĐVVT). Điện thoại: cột đầu hẹp hơn, cột thao tác không
// ghim (ghim hai mép ở 360 px chỉ còn ~50 px cho phần cuộn) — khoá lưu độ rộng riêng cho từng cỡ.
const tripCols = (desktop: boolean): RtColDef[] => [
  { id: 'x', label: 'Xe · OD', w: desktop ? 210 : 170 },
  { id: 'load', label: 'Tải', w: 104 },
  { id: 'pal', label: 'Pallet', w: 64, align: 'right' },
  { id: 'ton', label: 'Tấn', w: 64, align: 'right' },
  { id: 'cust', label: 'Khách', w: 210 },
  { id: 'ward', label: 'Phường', w: 140 },
  { id: 'freight', label: 'Cước', w: 92, align: 'right' },
  { id: 'carrier', label: 'ĐVVT', w: 170 },
  { id: 'cat', label: 'Loại kho', w: 130 },
  { id: 'region', label: 'Vùng', w: 120 },
  { id: 'note', label: 'Ghi chú giao hàng SAP', w: 240 },
  { id: 'warn', label: 'Lưu ý', w: 300 },
  { id: 'act', label: '', w: 84, align: 'right', stickyRight: desktop },
]
const poolCols = (desktop: boolean): RtColDef[] => [
  { id: 'x', label: 'OD', w: desktop ? 160 : 150 },
  { id: 'pal', label: 'Pallet', w: 60, align: 'right' },
  { id: 'ton', label: 'Tấn', w: 60, align: 'right' },
  { id: 'cust', label: 'Khách', w: 180 },
  { id: 'ward', label: 'Phường', w: 120 },
  { id: 'region', label: 'Vùng', w: 110 },
  { id: 'cat', label: 'Loại kho', w: 100 },
  { id: 'note', label: 'Ghi chú giao hàng SAP', w: 220 },
  { id: 'warn', label: 'Lưu ý', w: 220 },
  { id: 'act', label: '', w: 60, align: 'right', stickyRight: desktop },
]

type Cell = { node?: ReactNode; cls?: string; title?: string; stop?: boolean }
type Cells = Partial<Record<string, Cell>>

/** Một dòng = các ô theo đúng bộ cột; cột đầu (và cột thao tác nếu ghim) mang nền ĐẶC của dòng để phần cuộn không lộ qua. */
function RowCells({ cols, cells, bg }: { cols: RtColDef[]; cells: Cells; bg: string }) {
  return <>{cols.map((c, i) => {
    const s = cells[c.id]
    const pin = i === 0 ? `sticky left-0 z-10 ${bg}` : c.stickyRight ? `sticky right-0 z-10 ${bg}` : ''
    return (
      <TableCell key={c.id} title={s?.title} onClick={s?.stop ? e => e.stopPropagation() : undefined}
        className={`${TD} ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${pin} ${s?.cls ?? ''}`}>{s?.node}</TableCell>
    )
  })}</>
}

function IconBtn({ title, onClick, disabled, danger, children }: { title: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={`rounded p-0.5 text-slate-400 hover:bg-white disabled:opacity-40 ${danger ? 'hover:text-red-600' : 'hover:text-slate-700'}`}>{children}</button>
  )
}

/** Thanh % tải gọn trong ô — đang rê đơn qua xe thì vẽ số SAU khi thả (xanh trời, có mũi tên) */
function LoadMini({ t, pv, loading }: { t: DispatchTrip; pv: DispatchMovePreview | null; loading: boolean }) {
  const l = t.detail.load
  const mx = l.max_pct ?? 100
  if (loading) return <span className="text-sky-700">Đang tính…</span>
  if (pv?.blocked) return <span className="font-semibold text-red-600">⛔ Xe không nhận</span>
  if (!t.ods.length && !pv) return <span className="text-slate-400">—</span>
  const p = pv ? pv.load_pct : (t.load_pct == null ? l.pct : Number(t.load_pct))
  if (p == null) return <span className="text-slate-400">— chưa đo được</span>
  const over = pv ? pv.oversize : p > mx
  const under = pv ? pv.underload : t.underload
  const color = over ? 'bg-red-500' : under ? 'bg-amber-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative h-1.5 min-w-[36px] flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${Math.min(100, p)}%` }} />
        <div className="absolute inset-y-0 w-px bg-slate-500/60" style={{ left: `${l.underload_pct}%` }} />
      </div>
      <span className={`w-12 shrink-0 text-right tabular-nums ${pv ? 'font-semibold text-sky-700' : over ? 'font-semibold text-red-600' : under ? 'font-medium text-amber-700' : 'text-slate-700'}`}>
        {pv ? '→ ' : ''}{nf(p, 0)}%
      </span>
    </div>
  )
}

/** Phần sức chứa xe mà một đơn chiếm — đo theo thước của dòng xe (pallet hoặc tấn) */
const shareOf = (o: DispatchTripOd, t: DispatchTrip): number | null => {
  const l = t.detail.load
  if (!l.cap) return null
  const used = l.basis === 'TON' ? Number(o.tons ?? 0) : Number(o.pallets ?? 0)
  return (used / Number(l.cap)) * 100
}

/** Vạch mép trái của CẢ khối xe (dòng xe + các dòng đơn của nó): đỏ = vượt tải / ĐVVT từ chối / OD đổi ở SAP · hổ phách = còn việc
 *  người phải quyết · xám = bình thường. 06/10 (user: "phân biệt rõ hơn giữa các xe, dòng nào là chung 1 xe — đang nhìn hơi rối"):
 *  trước đó vạch chỉ có ở dòng xe nên các dòng đơn trắng nối liền dòng xe kế tiếp, không biết khối nào của xe nào. */
const tripRail = (t: DispatchTrip, flags: Map<string, DispatchOdFlag>): string => {
  const iss = issuesOf(t, { flags })
  return t.oversize || iss.some(k => k === 'declined' || k === 'sapflag') ? 'bg-red-500' : iss.some(k => TODO_KEYS.has(k)) ? 'bg-amber-400' : 'bg-slate-300'
}
/** Nhánh cây ở cột dính của dòng đơn dưới xe: vạch khối + đường dọc nối về mũi tên mở của dòng xe (dừng ở giữa dòng đơn CUỐI) +
 *  nhánh ngang tới ô tick. Vẽ tuyệt đối trong ô dính (ô dính là khối chứa) nên đường dọc liền qua các dòng. */
function TreeBranch({ rail, last }: { rail: string; last: boolean }) {
  return (
    <>
      <span className={`absolute inset-y-0 left-0 w-1 ${rail}`} />
      <span className={`absolute left-[17px] top-0 border-l border-slate-300 ${last ? 'h-1/2' : 'bottom-0'}`} />
      <span className="absolute left-[17px] top-1/2 w-2 border-t border-slate-300" />
    </>
  )
}

/** Ô của một dòng ĐƠN — dùng chung cho khung chờ và đơn dưới xe (`tree` = đơn dưới xe: vạch khối + nhánh cây) */
function odCells(ops: BoardOps, o: DispatchTripOd, t: DispatchTrip | null, tree?: { rail: string; last: boolean }): Cells {
  const fl = ops.flags.get(o.od_number)
  const soft = !!fl && SOFT_FLAG_KINDS.has(fl.kind)   // cờ tham chiếu — vàng như bảng Xem đơn; còn lại đỏ
  const can = ops.editable && (!t || ops.editableTrip(t))
  const canSap = ops.editable && (!t || ops.editableTrip(t) || tripStatus(t) === 'TENDERED')
  const noVeh = Array.isArray(o.allowed_models) && !o.allowed_models.length
  // OD chỉ có hàng đi kèm đơn (POSM) ở khung chờ: máy không cho đi xe riêng (user 30/09)
  const followOnly = !t && !!o.cat_load && Object.keys(o.cat_load).length > 0 && Object.keys(o.cat_load).every(c => ops.follow.has(c))
  // CẬN DƯỚI BẮT BUỘC (07/10): máy không tạo xe dưới Tối thiểu % — đơn ở khung chờ chờ người quyết (kéo lên xe · Trả về Chờ điều)
  const um = t ? undefined : ops.plan.params.under_min?.[o.od_number]
  const tb = t ? undefined : ops.plan.params.too_big?.[o.od_number]   // 07/10: lớn hơn xe, loại xe không ghép nhiều xe
  const share = t ? shareOf(o, t) : null
  const warnText = [fl ? `${FLAG_VI[fl.kind]}${fl.info ? ` — ${fl.info}` : ''}` : '', noVeh ? 'Khách và kênh chưa khai Dòng xe được vào — máy không chọn xe' : '',
    followOnly ? 'Chỉ có hàng đi kèm đơn — chờ đơn chính của khách, hoặc kéo tay lên xe của khách' : '',
    um ? `Máy không tạo xe: lô ${um.ods} OD trên ${um.vehicle} chỉ ${nf(um.pct, 1)} % < tối thiểu ${um.min} % — kéo lên xe / Xe mới, hoặc tick rồi "Trả về Chờ điều"; muốn máy vẫn tạo: Tối ưu lại, tick "Bỏ qua dải %"` : '',
    tb ? `Máy không tạo xe: đơn lớn hơn ${tb.vehicle} (${nf(tb.pct, 1)} % > trần ${tb.max} %) và loại xe này không ghép nhiều xe trên một thẻ — nới trần dải, đổi dòng xe được vào, bật "Ghép nhiều xe" cho loại xe, hoặc tách DO bên SAP` : ''].filter(Boolean).join(' · ')
  return {
    x: {
      title: `${o.od_number}${o.part_of ? ` — phần ${o.part_index}/${o.part_of} (OD bị tách, gom về một xe trước khi xác nhận)` : ''} · bấm dòng để xem chi tiết đơn`,
      node: (
        <div className={`flex min-w-0 items-center gap-1 ${t ? 'pl-5' : ''}`}>
          {tree && <TreeBranch rail={tree.rail} last={tree.last} />}
          {can
            ? <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-sky-600" checked={ops.sel.has(o.id)} onChange={() => ops.toggle(o.id)} onClick={e => e.stopPropagation()} aria-label={`Chọn ${o.od_number}`} />
            : <span className="w-3.5 shrink-0" />}
          <span className="font-mono font-semibold">{o.od_number}</span>
          {o.part_of ? <span className="text-[9px] text-amber-700">phần {o.part_index}/{o.part_of}</span> : null}
          {!t && ops.fresh.has(o.od_number) && <NewOdChip />}
          {fl && <span className={`rounded px-1 text-[9px] font-medium ${soft ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>{FLAG_VI[fl.kind]}</span>}
          {/* đơn dưới xe: tên khách ngay ở cột dính — khung chờ mở thì cột Khách nằm ngoài màn (đo 1280 px 06/10) */}
          {t && (t.detail.route?.order.length ?? 0) > 1 && stopNoOf(t, o.ship_to_code) != null && (
            <span className="shrink-0 rounded bg-sky-700 px-1 text-[9px] font-bold text-white" title="Điểm giao thứ mấy của xe (kho → điểm gần trước) — in lên Kế hoạch xuất / chuyến Xuất kho">Đ{stopNoOf(t, o.ship_to_code)}</span>
          )}
          {t && <span className="min-w-0 truncate text-slate-500">{o.ship_to_name ?? o.ship_to_code}</span>}
        </div>
      ),
    },
    load: share == null ? {} : { title: 'Phần sức chứa xe mà đơn này chiếm', node: <span className="text-slate-400">{share > 0 && share < 1 ? '<1' : nf(share, 0)}%</span> },
    pal: { node: nf(o.pallets, 1) },
    ton: { node: nf(o.tons, 2) },
    cust: { cls: 'truncate', title: [o.ship_to_name, o.ship_to_code].filter(Boolean).join(' · '), node: o.ship_to_name ?? o.ship_to_code ?? <span className="text-slate-300">—</span> },
    ward: { cls: 'truncate', title: o.ward_code ?? '', node: o.ward_code ?? <span className="text-slate-300">—</span> },
    region: { cls: 'truncate', title: o.region_name ?? o.region_code ?? '', node: o.region_name ?? o.region_code ?? <span className="text-slate-300">—</span> },
    cat: { node: <span className="inline-flex gap-0.5">{ops.catChips(ops.catsByLoad([o.cat_load]))}</span> },
    // ghi chú giao hàng SAP — người đọc trước khi ghép ("GIAO 10/9", "NPP không nhận CN"…), máy KHÔNG đọc
    note: { cls: `truncate ${o.note ? 'text-amber-900' : ''}`, title: o.note ?? '', node: o.note || <span className="text-slate-300">—</span> },
    warn: {
      cls: 'truncate', title: warnText, stop: !!fl && (fl.kind === 'CHANGED' || fl.kind === 'REPLACED') && canSap,
      node: warnText ? (
        <span className="inline-flex items-center gap-1.5">
          {fl && <span className={soft ? 'text-amber-800' : 'text-red-600'}>{FLAG_VI[fl.kind]}{fl.info ? ` — ${fl.info}` : ''}</span>}
          {fl?.kind === 'CHANGED' && canSap && <button type="button" className="inline-flex items-center gap-0.5 font-medium text-sky-700 hover:underline" disabled={ops.sapBusy}
            onClick={() => ops.resync(o.od_number)}><RotateCw className="h-3 w-3" />Cập nhật theo SAP</button>}
          {fl?.kind === 'REPLACED' && fl.replaced_by && canSap && <button type="button" className="inline-flex items-center gap-0.5 font-medium text-sky-700 hover:underline" disabled={ops.sapBusy}
            onClick={() => ops.replace(o.od_number)}><Replace className="h-3 w-3" />Thay bằng OD mới {fl.replaced_by}</button>}
          {noVeh && <span className="rounded bg-red-100 px-1 text-[9px] font-medium text-red-700">Chưa khai xe</span>}
          {followOnly && <span className="rounded bg-violet-100 px-1 text-[9px] font-medium text-violet-800">Chờ đơn chính</span>}
          {um && <span className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-900">Dưới tối thiểu · {um.vehicle} {nf(um.pct, 1)} %</span>}
          {tb && <span className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-900">Lớn hơn xe · {tb.vehicle} {nf(tb.pct, 1)} %</span>}
        </span>
      ) : <span className="text-slate-300">—</span>,
    },
    act: {
      stop: true,
      node: (
        <span className="inline-flex items-center gap-0.5">
          {/* dòng xe được vào của KHÁCH — xem / sửa ngay tại bàn (27/09); đổi kênh vẫn ở trang Khách hàng */}
          {o.ship_to_code && <IconBtn title={`Dòng xe được vào của khách ${o.ship_to_name ?? o.ship_to_code}${ops.canCustVeh ? ' — xem / sửa' : ' — xem'}`} onClick={() => ops.openCustVehicles(o.ship_to_code!)}><Truck className="h-3.5 w-3.5" /></IconBtn>}
          {can && <IconBtn danger title="Không điều OD này (chọn ngày điều lại hoặc không điều)" disabled={ops.busy} onClick={() => ops.openHoldFor([o.id])}><Ban className="h-3.5 w-3.5" /></IconBtn>}
        </span>
      ),
    },
  }
}

/** Ô của một dòng XE — đang rê đơn qua xe thì các ô số in kết quả SAU khi thả */
function tripCells(ops: BoardOps, t: DispatchTrip, hv: BoardHover, open: boolean, onToggle: () => void): Cells {
  const st = tripStatus(t)
  const ed = ops.editableTrip(t)
  const pv = hv?.data ?? null
  const ids = t.ods.map(o => o.id)
  const nSel = ids.filter(id => ops.sel.has(id)).length
  const iss = ISSUE_ORDER.filter(k => issuesOf(t, { flags: ops.flags }).includes(k))
  const sev = tripRail(t, ops.flags)
  const multi = (t.detail.vehicles?.length ?? 0) > 1
  // khách theo pallet giảm dần — người đọc thấy khách CHÍNH của xe trước
  const byCust = new Map<string, number>()
  for (const o of t.ods) { const k = o.ship_to_name || o.ship_to_code || '—'; byCust.set(k, (byCust.get(k) ?? 0) + Number(o.pallets ?? 0)) }
  const custs = [...byCust.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k)
  // 08/10 — vùng theo THỨ TỰ GIAO khi xe đo được tuyến (xe tuyến liên tỉnh: "Hưng Yên → Hải Phòng · 230 km")
  const route = t.detail.route ?? null
  const regOfShip = (s: string) => { const o = t.ods.find(x => x.ship_to_code === s); return o?.region_name || o?.region_code || '' }
  const regions = uniq((route?.order.length ? route.order.map(regOfShip) : t.ods.map(o => o.region_name || o.region_code || '')).filter(Boolean))
  const routeTip = route && route.order.length > 1
    ? `Thứ tự giao (kho → điểm gần trước): ${route.order.map((s, i) => `${i + 1}. ${t.ods.find(x => x.ship_to_code === s)?.ship_to_name ?? s}`).join(' → ')} · ${nf(route.km, 0)} km (thẳng tới điểm xa nhất ${nf(route.direct_km, 0)} km, vòng ${nf(route.detour_pct, 1)} %)`
    : ''
  const notes = t.ods.filter(o => !!o.note)
  const l = t.detail.load
  const fr = t.detail.freight
  const freightTip = [fr.reason ?? '', multi ? t.detail.vehicles!.map(v => `${v.name}: ${v.freight == null ? '—' : money(v.freight)}`).join(' · ') : '',
    fr.base != null ? `Cước tuyến ${money(fr.base)}${fr.surcharges.length ? ` + phụ phí ${fr.surcharges.map(x => `${x.kind} ${money(x.total)}`).join(', ')}` : ''}` : ''].filter(Boolean).join('\n')
  const warnTip = [...iss.map(k => ISSUE_SHORT[k]), ...t.detail.warnings, t.detail.merge_hint ?? ''].filter(Boolean).join('\n')
  const preview = (now: ReactNode, next: ReactNode) => (pv ? <span className="font-semibold text-sky-700">→ {next}</span> : now)
  return {
    x: {
      title: `Số xe ${t.group_code}${multi ? ` · ${t.detail.vehicles!.map(v => v.name).join(' + ')}` : ''} — bấm dòng để mở chi tiết xe (đổi dòng xe, xe phụ, chuyển từng OD)${ops.canDrag && ed && ids.length ? ' · kéo dòng xe thả vào xe khác = gộp cả xe' : ''}`,
      node: (
        <div className="flex min-w-0 items-center gap-1">
          {/* vạch mép trái của khối xe (chạy tiếp xuống các dòng đơn — `tripRail`) */}
          <span className={`absolute inset-y-0 left-0 w-1 ${sev}`} />
          <button type="button" onClick={e => { e.stopPropagation(); onToggle() }} aria-expanded={open} title={open ? 'Thu các đơn của xe' : 'Mở các đơn của xe'}
            className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
          {ed && ids.length > 0
            ? <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-sky-600" checked={nSel === ids.length} ref={el => { if (el) el.indeterminate = nSel > 0 && nSel < ids.length }}
                onChange={() => ops.toggleMany(ids)} onClick={e => e.stopPropagation()} aria-label={`Chọn mọi đơn của xe #${t.seq}`} />
            : <span className="w-3.5 shrink-0" />}
          <span className="font-mono text-[11px] font-bold text-slate-800">#{t.seq}</span>
          <span className="min-w-0 truncate text-[11px] font-semibold text-slate-800">
            {multi
              ? <><span className="mr-1 rounded bg-sky-600 px-1 text-[9px] font-bold text-white">{t.detail.vehicles!.length} XE</span>{t.detail.vehicles!.map(v => v.name).join(' + ')}</>
              : t.detail.vehicle_model?.name ?? <span className="text-red-600">Chưa chọn dòng xe</span>}
          </span>
          {st !== 'DRAFT' && <StatusBadge tone={st === 'CONFIRMED' ? 'green' : st === 'DECLINED' ? 'red' : 'blue'}>{st === 'CONFIRMED' ? 'Đã vào KH' : st === 'DECLINED' ? 'Từ chối' : st === 'TENDERED' ? 'Chờ ĐVVT' : st}</StatusBadge>}
          {t.locked && <span title="Đang khoá — Tối ưu lại không đụng vào xe này"><Lock className="h-3 w-3 shrink-0 text-slate-500" /></span>}
        </div>
      ),
    },
    load: { title: l.pct == null ? 'Chưa có dòng xe để đo % tải' : `${nf(l.used, 1)} / ${nf(l.cap, 1)} ${l.basis === 'TON' ? 'tấn' : 'pallet'} · dải ${l.underload_pct}–${l.max_pct ?? 100}%`, node: <LoadMini t={t} pv={pv} loading={!!hv?.loading} /> },
    pal: { cls: 'font-semibold', node: preview(nf(t.pallets, 1), nf(pv?.pallets, 1)) },
    ton: { cls: 'font-semibold', node: preview(nf(t.tons, 2), nf(pv?.tons, 2)) },
    cust: {
      cls: 'truncate', title: custs.join(', '),
      node: !t.ods.length && !pv
        ? <span className="text-slate-400">Xe trống — thả OD vào đây{ed ? ', hoặc bỏ xe (✕)' : ''}</span>
        : <>{preview(<span className="font-medium text-slate-700">{t.stops} điểm</span>, `${pv?.stops} điểm`)}<span className="text-slate-500"> · {new Set(t.ods.map(o => o.od_number)).size} OD · {custs.join(', ')}</span></>,
    },
    ward: { cls: 'truncate', title: t.wards.join(', '), node: t.wards.join(', ') || <span className="text-slate-300">—</span> },
    freight: {
      cls: 'font-semibold', title: freightTip,
      node: pv
        ? <span className="text-sky-700">→ {money(pv.freight_estimated)}{pv.freight_before != null && pv.freight_estimated != null && Number(pv.freight_estimated) !== Number(pv.freight_before)
            ? <span className="ml-0.5 font-normal">({Number(pv.freight_estimated) > Number(pv.freight_before) ? '+' : '−'}{money(Math.abs(Number(pv.freight_estimated) - Number(pv.freight_before)))})</span> : null}</span>
        : t.freight_estimated == null ? (t.ods.length ? <span className="font-normal text-amber-700">chưa có cước</span> : <span className="text-slate-300">—</span>) : money(t.freight_estimated),
    },
    carrier: {
      stop: true,
      node: <DispatchCarrierPicker trip={t} editable={ed} busy={ops.tripBusy} onPick={id => ops.setCarrier(t, id)} />,
    },
    cat: {
      stop: true,
      node: t.ods.length ? (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex gap-0.5">{ops.catChips(ops.catsByLoad(t.ods.map(o => o.cat_load)))}</span>
          {/* SWITCH "Ghép Loại kho khác" của xe (user 27/09: "TẮT = chặn thả") — theo kế hoạch khi chưa đặt riêng */}
          <label className={`inline-flex items-center gap-0.5 ${ed ? 'cursor-pointer' : 'opacity-60'}`}
            title={ops.mixOn(t) ? 'Đang cho thả OD khác Loại kho vào xe này — tắt để chặn' : 'Đang chặn thả OD khác Loại kho — bật để cho ghép'}>
            <Switch checked={ops.mixOn(t)} disabled={!ed || ops.tripBusy} aria-label="Ghép Loại kho khác" onCheckedChange={v => ops.setMix(t, v)} />
            <span className="text-[9px] text-slate-500">ghép{t.allow_mix_categories == null ? '·kho' : ''}</span>
          </label>
        </span>
      ) : <span className="text-slate-300">—</span>,
    },
    region: {
      cls: 'truncate', title: routeTip || regions.join(', '),
      node: regions.length > 1 && route
        ? <span className="inline-flex items-center gap-1"><span className="rounded bg-sky-700 px-1 text-[9px] font-bold text-white">Tuyến</span>{regions.join(' → ')}<span className="text-slate-400"> · {nf(route.km, 0)} km</span></span>
        : regions.join(', ') || <span className="text-slate-300">—</span>,
    },
    note: notes.length
      ? { cls: 'truncate text-amber-900', title: notes.map(o => `${o.od_number}: ${o.note}`).join('\n'), node: <span className="inline-flex items-center gap-1"><StickyNote className="h-3 w-3 shrink-0" />{notes.length} OD có ghi chú{!open ? ' — mở xe để đọc' : ''}</span> }
      : { node: <span className="text-slate-300">—</span> },
    warn: {
      cls: 'truncate', title: pv ? [pv.blocked ?? '', ...pv.warnings].filter(Boolean).join('\n') || warnTip : warnTip,
      node: pv?.blocked ? <span className="font-semibold text-red-600">⛔ Xe không nhận — {pv.blocked}</span>
        : pv?.warnings[0] ? <span className="text-amber-700">⚠ {pv.warnings[0]}</span>
        : iss.length || t.detail.merge_hint || t.detail.warnings.length ? (
          <span className="inline-flex items-center gap-1">
            {iss.map(k => <span key={k} className={`rounded px-1 text-[9px] font-medium ${k === 'declined' || k === 'over' || k === 'sapflag' ? 'bg-red-100 text-red-700' : TODO_KEYS.has(k) ? 'bg-amber-100 text-amber-800' : 'border border-slate-200 bg-white text-slate-500'}`}>{ISSUE_SHORT[k]}</span>)}
            {/* gợi ý gộp của máy cho xe Non tải / cảnh báo đầu tiên — đủ câu ở tooltip + panel xe */}
            <span className={t.detail.warnings.length ? 'text-red-600' : 'text-amber-800'}>{t.detail.warnings[0] ?? (t.underload ? t.detail.merge_hint : '') ?? ''}</span>
          </span>
        ) : <span className="text-slate-300">—</span>,
    },
    act: {
      stop: true,
      node: (
        <span className="inline-flex items-center gap-0.5">
          {/* KHÔNG ĐIỀU cả xe — một nhát chuyển mọi OD của xe (user 30/09) */}
          {ed && t.ods.length > 0 && <IconBtn danger title="Không điều cả xe — mọi OD của xe rời kế hoạch (chọn ngày điều lại hoặc không điều)" disabled={ops.busy} onClick={() => ops.openHoldFor(ids)}><Ban className="h-3.5 w-3.5" /></IconBtn>}
          {ed && <IconBtn title={t.locked ? 'Đang khoá — "Tối ưu lại" không đụng vào xe này. Bấm để mở khoá' : 'Khoá xe để "Tối ưu lại" giữ nguyên'} disabled={ops.tripBusy} onClick={() => ops.toggleLock(t)}>
            {t.locked ? <Lock className="h-3.5 w-3.5 text-slate-700" /> : <Unlock className="h-3.5 w-3.5" />}</IconBtn>}
          {ed && !t.ods.length && <IconBtn danger title="Bỏ xe trống" disabled={ops.tripBusy} onClick={() => ops.removeTrip(t)}><X className="h-3.5 w-3.5" /></IconBtn>}
        </span>
      ),
    },
  }
}

/** Dòng xe + các dòng đơn của xe. Mọi dòng của xe là MỘT ô thả (thả lên dòng đơn nào cũng là thả vào xe đó).
 *  VẼ LẠI CHỈ KHI XE ĐÓ ĐỔI (`sameTripRows`): đo 06/10 Bàu Bàng 709 xe / 3.194 dòng — mỗi lần rê sang xe khác cả bảng vẽ lại, viền
 *  xe đích hiện sau 567 ms. Dữ liệu vẽ đọc từ props (đổi là vẽ lại); thao tác lúc bấm / kéo đọc `live.current` (bản MỚI NHẤT) — vd kéo
 *  đơn đã tick phải mang cả các đơn tick ở xe khác dù xe này không vẽ lại. */
type TripRowsProps = {
  ops: BoardOps; live: React.MutableRefObject<BoardOps>; t: DispatchTrip; open: boolean; onToggle: (id: string) => void; cols: RtColDef[]
  hv: BoardHover; hit: boolean; selKey: string; sig: string; flags: Map<string, DispatchOdFlag>
}
const sameTripRows = (a: TripRowsProps, b: TripRowsProps) =>
  a.t === b.t && a.open === b.open && a.hv === b.hv && a.hit === b.hit && a.selKey === b.selKey && a.sig === b.sig && a.cols === b.cols && a.flags === b.flags
const TripRows = memo(function TripRows({ ops, live, t, open, onToggle, cols, hv, hit }: TripRowsProps) {
  const ed = ops.editableTrip(t)
  const drop = ed ? ops.dropProps('trip', t.id, t.id) : {}
  const dragTrip = ops.canDrag && ed && t.ods.length > 0
  // dòng xe = ĐẦU KHỐI (nền xám đậm hơn đơn trắng); khoá xe nhận biết bằng ổ khoá trên dòng
  const bg = hv ? 'bg-sky-100' : hit ? 'bg-green-50' : 'bg-slate-100'
  const rail = tripRail(t, ops.flags)
  const shown = open ? t.ods : []
  return (
    <>
      <TableRow data-trip-card={t.id} {...drop}
        draggable={dragTrip} onDragStart={dragTrip ? e => live.current.startDrag(e, t.ods.map(o => o.id), true) : undefined} onDragEnd={dragTrip ? () => live.current.endDrag() : undefined}
        className={`cursor-pointer border-t border-slate-300 ${bg} hover:bg-slate-200/70 ${hv ? 'outline outline-2 -outline-offset-2 outline-sky-400' : hit ? 'outline outline-2 -outline-offset-2 outline-green-400' : ''} ${dragTrip ? 'active:cursor-grabbing' : ''}`}
        onClick={() => live.current.onOpenTrip(t.id)}>
        <RowCells cols={cols} cells={tripCells(ops, t, hv, open, () => onToggle(t.id))} bg={bg} />
      </TableRow>
      {shown.map((o, i) => {
        const dragOk = ops.canDrag && ed
        const s = ops.sel.has(o.id)
        const rbg = s || hv ? 'bg-sky-50' : ops.q && ops.matches(o) ? 'bg-yellow-50' : 'bg-white'
        const last = i === shown.length - 1
        return (
          <TableRow key={o.id} {...drop} draggable={dragOk}
            onDragStart={dragOk ? e => live.current.startDrag(e, live.current.idsFor(o), true) : undefined} onDragEnd={dragOk ? () => live.current.endDrag() : undefined}
            className={`cursor-pointer ${rbg} hover:bg-slate-50 ${last ? 'border-slate-300' : ''} ${dragOk ? 'active:cursor-grabbing' : ''}`} onClick={() => live.current.onOpenOd(o)}>
            <RowCells cols={cols} cells={odCells(ops, o, t, { rail, last })} bg={rbg} />
          </TableRow>
        )
      })}
      {/* khoảng trống sau khối xe đang mở — xe kế tiếp bắt đầu khối mới (chuẩn nhóm dòng, skill table-format mục 10) */}
      {shown.length > 0 && <tr aria-hidden="true"><td colSpan={cols.length} className="h-2.5 border-0 bg-white p-0" /></tr>}
    </>
  )
}, sameTripRows)

/** Kéo gần mép trên / dưới của vùng cuộn thì vùng tự cuộn — xe đích nằm ngoài màn vẫn thả tới được. Dải mép HẸP + chậm (~5 px mỗi
 *  nhịp dragover): dải rộng / nhanh thì xe đích nằm sát mép bị cuộn trôi khỏi con trỏ trước khi kịp thả (đo 06/10). */
function edgeScroll(e: React.DragEvent<HTMLElement>) {
  const el = e.currentTarget, r = el.getBoundingClientRect(), edge = 36
  if (e.clientY < r.top + edge) el.scrollTop -= Math.ceil((r.top + edge - e.clientY) / 6)
  else if (e.clientY > r.bottom - edge) el.scrollTop += Math.ceil((e.clientY - (r.bottom - edge)) / 6)
}

export function DispatchBoardTable({ ops, toolbar, rail, poolHeader, poolExtras }: {
  ops: BoardOps; toolbar: ReactNode; rail: ReactNode; poolHeader: ReactNode; poolExtras: ReactNode
}) {
  const f = useWmsFilterStore(s => s.dispatch)
  const setF = useWmsFilterStore(s => s.setDispatch)
  const { desktop } = ops
  const tcols = useMemo(() => tripCols(desktop), [desktop]), pcols = useMemo(() => poolCols(desktop), [desktop])
  // bản ops MỚI NHẤT cho thao tác lúc bấm / kéo trong các dòng xe không vẽ lại (TripRows memo)
  const live = useRef(ops)
  live.current = ops
  // những thứ CHUNG làm đổi cách vẽ mọi dòng xe — đổi là vẽ lại cả bảng
  const sig = `${ops.editable}|${ops.canDrag}|${ops.busy}|${ops.tripBusy}|${ops.sapBusy}|${ops.canCustVeh}|${ops.q}`

  // VÁCH NGĂN: kéo đổi độ rộng khung chờ — giữ cục bộ khi kéo, ghi vào bộ lọc (nhớ theo người) lúc nhả chuột
  const box = useRef<HTMLDivElement>(null)
  const [poolW, setPoolW] = useState(() => f.boardPoolW || POOL_W)
  const wRef = useRef(poolW)
  wRef.current = poolW
  const split = useRef<{ x: number; w: number } | null>(null)
  useEffect(() => {
    const mv = (e: PointerEvent) => {
      const d = split.current
      if (!d) return
      const max = Math.max(POOL_MIN, (box.current?.clientWidth ?? 1200) * 0.65)
      setPoolW(Math.round(Math.min(max, Math.max(POOL_MIN, d.w + e.clientX - d.x))))
    }
    const up = () => {
      if (!split.current) return
      split.current = null
      document.body.style.cursor = ''; document.body.style.userSelect = ''
      setF({ boardPoolW: wRef.current })
    }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
  }, [setF])

  // XE MỞ / THU: mặc định theo công tắc "Ẩn đơn trên xe" của thanh công cụ; mũi tên của từng xe lật riêng xe đó. Đang tìm ⇒ mở hết
  const [flip, setFlip] = useState<Set<string>>(new Set())
  useEffect(() => { setFlip(new Set()) }, [f.boardOdsHidden, ops.plan.id])
  const tripOpen = (id: string) => !!ops.q || (f.boardOdsHidden ? flip.has(id) : !flip.has(id))
  const flipTrip = useCallback((id: string) => setFlip(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }), [])

  const regionLabel = (x: DispatchTrip) => x.ods[0]?.region_name || x.ods[0]?.region_code || 'Chưa có vùng'
  const poolHover = ops.hover?.target === 'pool'
  const odsOnTrips = ops.tripGroups.reduce((s, g) => s + g.trips.reduce((a, t) => a + new Set(t.ods.map(o => o.od_number)).size, 0), 0)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {toolbar}
      <div ref={box} className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {rail ?? (
          // ── KHUNG CHỜ ── cả khối là ô thả "về khung chờ"
          <section data-dispatch-pool {...(ops.canDrag ? ops.dropProps('pool', 'pool') : {})} style={desktop ? { width: poolW } : undefined}
            className={`flex min-h-0 shrink-0 flex-col border-b lg:border-b-0 ${poolHover ? 'bg-sky-50 ring-2 ring-inset ring-sky-400' : 'bg-white'}`}>
            {poolHeader}
            <div className="max-h-[40vh] min-h-0 flex-1 overflow-auto lg:max-h-none" onDragOver={ops.canDrag ? edgeScroll : undefined}>
              <ResizableTable storageKey={`dispatch_board_pool_v1${desktop ? '' : '_m'}`} cols={pcols}>
                <TableBody>
                  {ops.poolEmpty && <TableEmptyRow colSpan={pcols.length}>{ops.poolEmpty}</TableEmptyRow>}
                  {ops.poolGroups.map(g => {
                    const open = ops.poolGroupOpen(g.k)
                    const ids = g.rows.map(o => o.id)
                    const nSel = ids.filter(id => ops.sel.has(id)).length
                    const dragG = ops.canDrag && ops.editable
                    return (
                      <Fragment key={g.k}>
                        <TableRow className="cursor-pointer bg-slate-100 hover:bg-slate-200" onClick={() => ops.togglePoolGroup(g.k)}
                          draggable={dragG} onDragStart={dragG ? e => ops.startDrag(e, ids, true) : undefined} onDragEnd={dragG ? ops.endDrag : undefined}>
                          <RowCells cols={pcols} bg="bg-slate-100" cells={{
                            x: {
                              title: `${g.k} — bấm để ${open ? 'thu' : 'mở'}${dragG ? ' · kéo dòng này = kéo cả cụm' : ''}`,
                              node: (
                                <div className="flex min-w-0 items-center gap-1">
                                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
                                  {ops.editable
                                    ? <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-sky-600" checked={nSel === ids.length} ref={el => { if (el) el.indeterminate = nSel > 0 && nSel < ids.length }}
                                        onChange={() => ops.toggleMany(ids)} onClick={e => e.stopPropagation()} aria-label={`Chọn cả nhóm ${g.k}`} />
                                    : null}
                                  <span className="min-w-0 truncate text-[11px] font-semibold text-slate-700">{g.k}</span>
                                </div>
                              ),
                            },
                            pal: { cls: 'font-semibold', node: nf(g.pallets, 1) },
                            ton: { cls: 'font-semibold', node: nf(g.rows.reduce((s, o) => s + Number(o.tons ?? 0), 0), 2) },
                            cust: { cls: 'text-slate-500', node: `${new Set(g.rows.map(o => o.od_number)).size} OD` },
                          }} />
                        </TableRow>
                        {open && g.rows.map(o => {
                          const dragOk = ops.canDrag && ops.editable
                          const rbg = ops.sel.has(o.id) ? 'bg-sky-50' : ops.q && ops.matches(o) ? 'bg-yellow-50' : 'bg-white'
                          return (
                            <TableRow key={o.id} draggable={dragOk} onDragStart={dragOk ? e => ops.startDrag(e, ops.idsFor(o), true) : undefined} onDragEnd={dragOk ? ops.endDrag : undefined}
                              className={`cursor-pointer ${rbg} hover:bg-slate-50 ${dragOk ? 'active:cursor-grabbing' : ''}`} onClick={() => ops.onOpenOd(o)}>
                              <RowCells cols={pcols} cells={odCells(ops, o, null)} bg={rbg} />
                            </TableRow>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </ResizableTable>
              {poolExtras && <div className="px-2 py-1.5">{poolExtras}</div>}
            </div>
          </section>
        )}
        {!rail && desktop && (
          <div role="separator" aria-orientation="vertical" title="Kéo để đổi độ rộng khung chờ"
            onPointerDown={e => { e.preventDefault(); split.current = { x: e.clientX, w: poolW }; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }}
            className="w-1.5 shrink-0 cursor-col-resize border-x border-slate-200 bg-slate-100 hover:bg-sky-300 active:bg-sky-400" />
        )}

        {/* ── BẢNG XE ── nhóm (vùng | loại xe) → xe → đơn */}
        {/* điện thoại: bảng xe có chiều cao RIÊNG (trang cuộn tới nó) — flex-1 dưới đầu trang + thanh công cụ nhiều hàng + khung chờ
            40 % thì còn 0 px, bảng nằm đó mà không thấy, không bấm được (đo 390 px 06/10) */}
        <section className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          <div className="h-[75vh] overflow-auto lg:h-auto lg:min-h-0 lg:flex-1" onDragOver={ops.canDrag ? edgeScroll : undefined}>
            <ResizableTable storageKey={`dispatch_board_trips_v1${desktop ? '' : '_m'}`} cols={tcols}>
              <TableBody>
                {!ops.tripGroups.length && <TableEmptyRow colSpan={tcols.length}>{ops.tripsTotal
                  ? <>Không xe nào khớp bộ lọc. <button type="button" className="text-sky-700 underline" onClick={ops.clearFilter}>Xem tất cả {ops.tripsTotal} xe</button></>
                  : 'Chưa có xe nào — kéo OD từ khung chờ thả vào "Xe mới" trên thanh công cụ, hoặc bấm Tối ưu lại.'}</TableEmptyRow>}
                {ops.tripGroups.map(g => {
                  const open = ops.groupOpen(g.k)
                  return (
                    <Fragment key={g.k}>
                      <TableRow className="cursor-pointer bg-slate-200 hover:bg-slate-300" onClick={() => ops.toggleGroup(g.k)} aria-expanded={open}
                        onDragOver={ops.canDrag && !open ? () => ops.armOpen(g.k) : undefined}>
                        <RowCells cols={tcols} bg="bg-slate-200" cells={{
                          x: {
                            title: `${g.label} — bấm để ${open ? 'thu' : 'mở'}`,
                            node: (
                              <span className="flex min-w-0 items-center gap-1">
                                {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-600" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />}
                                <span className={`min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide ${g.k === ops.noModelKey ? 'text-red-700' : 'text-slate-700'}`}>{g.label}</span>
                              </span>
                            ),
                          },
                          pal: { cls: 'font-semibold', node: nf(g.pallets, 1) },
                          ton: { cls: 'font-semibold', node: nf(g.tons, 2) },
                          cust: {
                            node: (
                              <span className="inline-flex items-center gap-1">
                                <span className="font-medium text-slate-700">{g.trips.length} xe</span>
                                {g.todo > 0 && <span className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800">{g.todo} cần xử lý</span>}
                                {g.over > 0 && <span className="rounded bg-red-100 px-1 text-[9px] font-medium text-red-700">{g.over} vượt tải</span>}
                              </span>
                            ),
                          },
                          freight: { cls: 'font-semibold', node: money(g.freight) },
                        }} />
                      </TableRow>
                      {open && g.trips.map((t, i) => {
                        // nhóm Loại xe + sắp theo vùng: dải tên vùng trước mỗi cụm xe (01/10, cùng luật bản thẻ)
                        const band = ops.regionBands && (i === 0 || regionLabel(g.trips[i - 1]) !== regionLabel(t))
                        let run: DispatchTrip[] = []
                        if (band) { let n = 0; while (i + n < g.trips.length && regionLabel(g.trips[i + n]) === regionLabel(t)) n++; run = g.trips.slice(i, i + n) }
                        return (
                          <Fragment key={t.id}>
                            {band && (
                              <TableRow className="bg-slate-50">
                                <RowCells cols={tcols} bg="bg-slate-50" cells={{
                                  x: { node: <span className="pl-5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{regionLabel(t)}</span>, title: regionLabel(t) },
                                  pal: { node: nf(run.reduce((s, x) => s + Number(x.pallets ?? 0), 0), 1) },
                                  cust: { cls: 'text-slate-500', node: `${run.length} xe` },
                                }} />
                              </TableRow>
                            )}
                            <TripRows ops={ops} live={live} t={t} open={tripOpen(t.id)} onToggle={flipTrip} cols={tcols} flags={ops.flags} sig={sig}
                              hv={ops.hover?.target === t.id && !ops.ownDrop(t.id) ? ops.hover : null} hit={ops.justHit === t.id}
                              selKey={ops.sel.size ? t.ods.filter(o => ops.sel.has(o.id)).map(o => o.id).join(',') : ''} />
                          </Fragment>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </TableBody>
            </ResizableTable>
          </div>
          <ListFooter page={1} pageSize={Math.max(1, ops.tripsShown)} total={ops.tripsShown} unit="xe" onPageSize={() => { }} options={[]}
            right={`${ops.tripsShown !== ops.tripsTotal ? `lọc ${nf(ops.tripsShown)}/${nf(ops.tripsTotal)} xe · ` : ''}${nf(odsOnTrips)} OD trên xe${ops.canDrag ? ' — kéo dòng đơn (hoặc các dòng đã tick) thả lên dòng của xe khác; kéo dòng xe = gộp cả xe; rê qua xe để xem tải / cước sau khi thả' : ' — tick đơn rồi "Chuyển tới xe…" ở thanh dưới'}`} />
        </section>
      </div>
    </div>
  )
}
