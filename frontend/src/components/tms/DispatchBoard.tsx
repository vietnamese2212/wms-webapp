// BÀN GHÉP XE — kéo thả OD vào xe (user chốt 25/09: "ngồi xử lý ở table rất mất thời gian và không trực quan").
//
// Khuôn lấy từ các TMS đã có người dùng thật (nghiên cứu 25/09): SAP TM Transportation Cockpit (hai khung: đơn chưa xếp ·
// xe), Oracle OTM Workbench (thả là kiểm lại sức chứa), Routific / OptimoRoute (khoá tuyến rồi "tối ưu lại phần chưa khoá").
// Onwheel không công bố màn kéo thả — chỉ có "% tải" trên từng xe, cũng là thứ đầu tiên thẻ xe ở đây nói.
//   • Trái = KHUNG CHỜ: OD trong kế hoạch chưa lên xe nào, gom theo PHƯỜNG (khoá cước — nhìn một cụm là biết đi chung được
//     không) / vùng / khách. OD mới về ZSD02 (lũy tiến) vào đây bằng nút "Nạp OD mới".
//   • Phải = LƯỚI THẺ XE: % tải tô màu (Non tải hổ phách · đạt xanh · vượt đỏ), điểm giao, cước, cờ vấn đề.
//   • Thả = server tính lại cước/tải/điều kiện bảo quản NGAY rồi trả nguyên kế hoạch (dải chỉ số đổi theo).
//   • Rê qua một xe = XEM TRƯỚC (pallet · % tải · điểm · cước mới) — biết kết quả trước khi thả.
//   • Vượt tải CHO THẢ, đánh dấu đỏ (user chốt) — không chặn như máy; Xác nhận nhắc lại.
//   • Hoàn tác / Làm lại (Ctrl+Z / Ctrl+Y), khoá xe, bỏ xe trống, "Chuyển tới xe…" cho người không kéo được (điện thoại,
//     hoặc 80 thẻ xe không kéo chính xác nổi).
// ⚠ Kéo thả chỉ bật từ lg (chuột). Điện thoại: tick OD → thanh nổi "Chuyển tới xe…" — cùng một cửa ghi.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { Lock, Unlock, X, Plus, Undo2, Redo2, Sparkles, Inbox, AlertTriangle, RefreshCw, Replace, ChevronDown, ChevronRight, Truck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SearchInput } from '@/components/shared/SearchInput'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FloatingActionBar, FLOATING_BTN, FLOATING_BTN_DANGER } from '@/components/shared/FloatingActionBar'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import {
  useMoveDispatchOds, previewDispatchMove, useUpdateDispatchTrip, useDeleteDispatchTrip, useReplaceDispatchOd, useReoptimizeDispatchPlan, useRefreshDispatchPool,
  type DispatchPlan, type DispatchTrip, type DispatchTripOd, type DispatchOdFlag, type DispatchMoveTo, type DispatchMovePreview,
} from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { EDITABLE, tripStatus, issuesOf, needsWork, ISSUE_ORDER, ISSUE_SHORT, TODO_KEYS, FLAG_VI, type IssueKey } from './dispatchIssues'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const money = (n: number | string | null | undefined) => {
  if (n == null) return '—'
  const v = Number(n), a = Math.abs(v)
  return a >= 1e6 ? `${nf(v / 1e6, 2)} tr` : `${nf(v)} ₫`
}
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'
const DRAG_MIME = 'application/x-dispatch-ods'
type Op = { ids: string[]; to: DispatchMoveTo; to_trip_id?: string; prev: Map<string, string | null>; created?: string }

function useIsDesktop() {
  const [d, setD] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const h = () => setD(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return d
}

const groupKeyOf = (o: DispatchTripOd, g: string) =>
  g === 'region' ? (o.region_code || 'Chưa có vùng') : g === 'customer' ? (o.ship_to_name || o.ship_to_code || '—') : (o.ward_code || 'Chưa có phường')
const matches = (o: DispatchTripOd, q: string) =>
  !q || [o.od_number, o.ship_to_code, o.ship_to_name, o.ward_code, o.region_code].some(v => (v ?? '').toLowerCase().includes(q))

export function DispatchBoard({ plan, editable, flags, newOds, onOpenTrip }: {
  plan: DispatchPlan; editable: boolean; flags: Map<string, DispatchOdFlag>; newOds: number; onOpenTrip: (id: string) => void
}) {
  const f = useWmsFilterStore(s => s.dispatch)
  const setF = useWmsFilterStore(s => s.setDispatch)
  const desktop = useIsDesktop()
  const canDrag = editable && desktop
  const q = f.search.trim().toLowerCase()
  const ctx = useMemo(() => ({ flags }), [flags])
  const pool = useMemo(() => plan.pool ?? [], [plan.pool])
  const trips = plan.trips.filter(t => tripStatus(t) !== 'DISCARDED')
  const tripOf = useMemo(() => new Map([...plan.trips.flatMap(t => t.ods.map(o => [o.id, t.id] as const)), ...pool.map(o => [o.id, null] as const)]), [plan.trips, pool])
  const rowBy = useMemo(() => new Map([...plan.trips.flatMap(t => t.ods), ...pool].map(o => [o.id, o])), [plan.trips, pool])
  const editableTrip = (t: DispatchTrip) => editable && EDITABLE.includes(tripStatus(t))

  const move = useMoveDispatchOds(), patchTrip = useUpdateDispatchTrip(), delTrip = useDeleteDispatchTrip()
  const replace = useReplaceDispatchOd(), reopt = useReoptimizeDispatchPlan(), refresh = useRefreshDispatchPool()
  const [ask, confirmNode] = useConfirmDialog()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [undoStack, setUndo] = useState<Op[]>([])
  const [redoStack, setRedo] = useState<Op[]>([])
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showSide, setShowSide] = useState<'' | 'unplanned' | 'excluded'>('')
  const [moveDlg, setMoveDlg] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const dragIds = useRef<string[]>([])
  const [hover, setHover] = useState<{ target: string; data: DispatchMovePreview | null; loading: boolean } | null>(null)
  const hoverRef = useRef<string | null>(null)
  const pvCache = useRef(new Map<string, DispatchMovePreview>())
  useEffect(() => { setSel(new Set()); setUndo([]); setRedo([]); pvCache.current.clear() }, [plan.id])
  useEffect(() => { pvCache.current.clear() }, [plan.updated_at])
  // dòng đã chọn mà không còn (người khác vừa chuyển / bỏ) thì bỏ khỏi lựa chọn
  useEffect(() => { setSel(p => { const n = new Set([...p].filter(id => rowBy.has(id))); return n.size === p.size ? p : n }) }, [rowBy])

  const err = (e: unknown, title: string) => toast({ variant: 'destructive', title, description: apiMsg(e) })

  // ── MỘT cửa ghi cho mọi lần thả / chuyển (kể cả Hoàn tác) ──
  const run = useCallback(async (ids: string[], to: DispatchMoveTo, to_trip_id?: string, record = true) => {
    if (!ids.length) return null
    const prev = new Map(ids.map(id => [id, tripOf.get(id) ?? null]))
    setBusy(true)
    try {
      const p = await move.mutateAsync({ plan_id: plan.id, ids, to, to_trip_id })
      const created = to === 'new' ? p.trips.find(t => t.ods.some(o => o.id === ids[0]))?.id : undefined
      if (record) { setUndo(s => [...s.slice(-49), { ids, to, to_trip_id, prev, created }]); setRedo([]) }
      setSel(new Set())
      return p
    } catch (e) { err(e, 'Không chuyển được OD'); return null } finally { setBusy(false) }
  }, [move, plan.id, tripOf])

  const undo = useCallback(async () => {
    const op = undoStack[undoStack.length - 1]
    if (!op || busy) return
    setUndo(s => s.slice(0, -1))
    const byPrev = new Map<string | null, string[]>()
    for (const id of op.ids) { if (!rowBy.has(id)) continue; const k = op.prev.get(id) ?? null; byPrev.set(k, [...(byPrev.get(k) ?? []), id]) }
    let last: DispatchPlan | null = null
    for (const [tid, ids] of byPrev) {
      const exists = tid ? plan.trips.some(t => t.id === tid) : false
      last = await run(ids, tid ? (exists ? 'trip' : 'new') : 'pool', exists ? tid ?? undefined : undefined, false) ?? last
    }
    // xe mới do thao tác đó sinh ra mà giờ trống ⇒ bỏ luôn, Hoàn tác trả bàn về đúng như trước
    if (op.created && last?.trips.some(t => t.id === op.created && !t.ods.length)) await delTrip.mutateAsync(op.created).catch(() => undefined)
    setRedo(s => [...s, op])
  }, [undoStack, busy, rowBy, plan.trips, run, delTrip])
  const redo = useCallback(async () => {
    const op = redoStack[redoStack.length - 1]
    if (!op || busy) return
    setRedo(s => s.slice(0, -1))
    const ids = op.ids.filter(id => rowBy.has(id))
    const tgtExists = op.to_trip_id ? plan.trips.some(t => t.id === op.to_trip_id) : true
    const p = await run(ids, op.to === 'trip' && !tgtExists ? 'new' : op.to, tgtExists ? op.to_trip_id : undefined, false)
    if (p) setUndo(s => [...s, { ...op, created: op.to === 'new' ? p.trips.find(t => t.ods.some(o => o.id === ids[0]))?.id : op.created }])
  }, [redoStack, busy, rowBy, plan.trips, run])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); void undo() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); void redo() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo, redo])

  // ── KÉO THẢ ──
  const idsFor = (o: DispatchTripOd) => (sel.has(o.id) ? [...sel] : [o.id])
  const onDragStart = (e: React.DragEvent, o: DispatchTripOd) => {
    const ids = idsFor(o)
    dragIds.current = ids
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids))
    e.dataTransfer.setData('text/plain', ids.map(id => rowBy.get(id)?.od_number).join(', '))
  }
  const onDragEnd = () => { dragIds.current = []; hoverRef.current = null; setHover(null) }
  const readIds = (e: React.DragEvent): string[] => {
    try { const v = JSON.parse(e.dataTransfer.getData(DRAG_MIME) || '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
  }
  const enterTarget = (target: string) => {
    if (hoverRef.current === target) return
    hoverRef.current = target
    const ids = dragIds.current
    if (target === 'pool' || target === 'new' || !ids.length || ids.every(id => tripOf.get(id) === target)) { setHover({ target, data: null, loading: false }); return }
    const key = `${target}|${[...ids].sort().join(',')}`
    const hit = pvCache.current.get(key)
    if (hit) { setHover({ target, data: hit, loading: false }); return }
    setHover({ target, data: null, loading: true })
    // rê qua nhiều xe liên tiếp: chỉ hỏi server cho xe người DỪNG lại ≥ 250 ms
    window.setTimeout(() => {
      if (hoverRef.current !== target) return
      previewDispatchMove(plan.id, ids, target).then(d => { pvCache.current.set(key, d); if (hoverRef.current === target) setHover({ target, data: d, loading: false }) })
        .catch(() => { if (hoverRef.current === target) setHover({ target, data: null, loading: false }) })
    }, 250)
  }
  const leaveTarget = (e: React.DragEvent, target: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    if (hoverRef.current === target) { hoverRef.current = null; setHover(null) }
  }
  const dropOn = (e: React.DragEvent, to: DispatchMoveTo, tripId?: string) => {
    e.preventDefault()
    const ids = readIds(e).filter(id => rowBy.has(id) && (to !== 'trip' || tripOf.get(id) !== tripId) && (to !== 'pool' || tripOf.get(id) !== null))
    onDragEnd()
    if (ids.length) void run(ids, to, tripId)
  }
  const dropProps = (to: DispatchMoveTo, target: string, tripId?: string) => canDrag ? {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } },
    onDragEnter: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_MIME)) enterTarget(target) },
    onDragLeave: (e: React.DragEvent) => leaveTarget(e, target),
    onDrop: (e: React.DragEvent) => dropOn(e, to, tripId),
  } : {}

  // ── Khung chờ ──
  const poolShown = pool.filter(o => matches(o, q))
  const groups = useMemo(() => {
    const m = new Map<string, DispatchTripOd[]>()
    for (const o of poolShown) { const k = groupKeyOf(o, f.boardGroup); m.set(k, [...(m.get(k) ?? []), o]) }
    return [...m.entries()].map(([k, rows]) => ({ k, rows, pallets: rows.reduce((s, o) => s + Number(o.pallets ?? 0), 0) }))
      .sort((a, b) => b.pallets - a.pallets || a.k.localeCompare(b.k))
  }, [poolShown, f.boardGroup])

  // ── Thẻ xe: cùng bộ lọc "Soát" với bảng Danh sách xe ──
  const shownTrips = useMemo(() => {
    let l = trips.filter(t => !q || t.group_code.toLowerCase().includes(q) || t.ods.some(o => matches(o, q)))
    if (f.issue === 'todo') l = l.filter(t => needsWork(t, ctx))
    else if (f.issue) l = l.filter(t => issuesOf(t, ctx).includes(f.issue as IssueKey))
    return f.todoFirst ? [...l].sort((a, b) => Number(needsWork(b, ctx)) - Number(needsWork(a, ctx))) : l
  }, [trips, q, f.issue, f.todoFirst, ctx])

  const selIds = [...sel].filter(id => rowBy.has(id))
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleMany = (ids: string[]) => setSel(p => { const all = ids.every(id => p.has(id)); const n = new Set(p); for (const id of ids) all ? n.delete(id) : n.add(id); return n })

  const doReplace = (od: string) => replace.mutateAsync({ plan_id: plan.id, od_number: od })
    .then(r => toast({ title: `Đã thay ${r.replaced.from} bằng ${r.replaced.to}`, description: 'Tải + cước của xe đã tính lại theo OD mới.' }))
    .catch(e => err(e, 'Không thay được OD'))
  const doReopt = async () => {
    const lockedN = trips.filter(t => t.locked).length
    if (await ask({ title: 'Tối ưu lại phần chưa khoá?', confirmLabel: 'Tối ưu lại',
      body: `Máy ghép lại khung chờ (${nf(plan.summary.pool_ods ?? 0)} OD) + mọi xe CHƯA KHOÁ còn sửa được.\n${lockedN ? `${lockedN} xe đã khoá giữ nguyên.` : 'Chưa khoá xe nào — khoá (🔒) những xe đã ưng trước khi bấm để máy không đụng vào.'}\nThao tác này KHÔNG hoàn tác được bằng Ctrl+Z.` }) === null) return
    reopt.mutateAsync(plan.id).then(r => { setUndo([]); setRedo([]); toast({ title: `Đã ghép lại thành ${r.reoptimized.trips} xe`, description: `${r.reoptimized.kept} xe giữ nguyên${r.reoptimized.left_in_pool ? ` · ${r.reoptimized.left_in_pool} OD vẫn ở khung chờ (không xếp được / đã đổi ở SAP)` : ''}` }) })
      .catch(e => err(e, 'Không tối ưu lại được'))
  }
  const doRefresh = () => refresh.mutateAsync(plan.id)
    .then(r => toast({ title: r.refreshed.added ? `Đã nạp ${r.refreshed.added} OD mới vào khung chờ` : 'Không có OD mới nào', description: r.refreshed.skipped_not_loadable ? `${r.refreshed.skipped_not_loadable} OD không lên xe (trả về / chiết khấu / không đo được tải) — bỏ qua.` : 'Kéo OD từ khung chờ vào xe, hoặc bấm "Tối ưu lại phần chưa khoá".' }))
    .catch(e => err(e, 'Không nạp được OD mới'))
  const doRemove = async (ids: string[]) => {
    const ods = [...new Set(ids.map(id => rowBy.get(id)?.od_number).filter(Boolean))]
    if (await ask({ title: `Bỏ ${ods.length} OD khỏi kế hoạch này?`, danger: true, confirmLabel: 'Bỏ khỏi kế hoạch',
      body: `${ods.slice(0, 8).join(', ')}${ods.length > 8 ? '…' : ''}\nOD không bị xoá ở SAP — lần "Nạp OD mới" sau sẽ đưa lại nếu nó vẫn chưa được điều. Không hoàn tác được bằng Ctrl+Z.` }) === null) return
    await run(ids, 'remove', undefined, false)
  }

  const actions: ActionItem[] = []
  if (editable) {
    actions.push({ key: 'undo', icon: Undo2, label: 'Hoàn tác', tip: `Hoàn tác lần chuyển OD gần nhất (Ctrl+Z)${undoStack.length ? ` — còn ${undoStack.length} bước` : ''}`, onClick: () => void undo(), disabled: !undoStack.length || busy })
    actions.push({ key: 'redo', icon: Redo2, label: 'Làm lại', tip: 'Làm lại (Ctrl+Y)', onClick: () => void redo(), disabled: !redoStack.length || busy })
    actions.push({ key: 'reopt', icon: Sparkles, label: 'Tối ưu lại', tip: 'Máy ghép lại khung chờ + các xe chưa khoá; xe đã khoá giữ nguyên', onClick: () => void doReopt(), disabled: reopt.isPending || busy, busy: reopt.isPending })
    actions.push({ key: 'refresh', icon: RefreshCw, label: newOds ? `Nạp ${newOds} OD mới` : 'Nạp OD mới', tip: 'Đưa OD mới về từ ZSD02 (chưa điều, chưa đi, chưa nằm kế hoạch nào) vào khung chờ', onClick: () => void doRefresh(), disabled: refresh.isPending, busy: refresh.isPending, className: newOds ? 'border-amber-300 text-amber-800' : undefined })
  }

  const targets = trips.filter(editableTrip).map(t => ({ value: t.id, label: `#${t.seq} · ${t.detail.vehicle_model?.name ?? 'chưa chọn xe'}`, sub: `${nf(t.pallets, 1)} pl · ${t.load_pct == null ? '—' : `${nf(t.load_pct, 0)}%`} · ${t.stops} điểm · ${t.wards.slice(0, 2).join(', ')}` }))
  const excluded = plan.params.excluded ?? []
  const exBy = excluded.reduce<Record<string, number>>((m, x) => { m[x.kind] = (m[x.kind] ?? 0) + 1; return m }, {})
  const EX_VI: Record<string, string> = { IN_PLAN: 'đã có trong Kế hoạch xuất', OTHER_DRAFT: 'nằm ở nháp ngày khác', SAP_ASSIGNED: 'SAP đã điều', SHIPPED: 'đã xuất kho' }

  const odRow = (o: DispatchTripOd, compact?: boolean) => {
    const fl = flags.get(o.od_number)
    const tr = o.trip_id ? plan.trips.find(t => t.id === o.trip_id) : null
    const dragOk = canDrag && (!tr || editableTrip(tr))
    return (
      <div key={o.id} draggable={dragOk} onDragStart={dragOk ? e => onDragStart(e, o) : undefined} onDragEnd={dragOk ? onDragEnd : undefined}
        className={`group flex items-start gap-1.5 rounded px-1.5 py-1 text-[11px] ${sel.has(o.id) ? 'bg-sky-100' : 'hover:bg-slate-50'} ${dragOk ? 'cursor-grab active:cursor-grabbing' : ''} ${fl ? 'ring-1 ring-red-200' : ''}`}>
        {editable && (!tr || editableTrip(tr)) && (
          <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-sky-600" checked={sel.has(o.id)} onChange={() => toggle(o.id)} onClick={e => e.stopPropagation()} title="Chọn để chuyển / kéo nhiều OD một lượt" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="font-mono font-semibold">{o.od_number}</span>
            {o.part_of ? <span className="text-[9px] text-amber-700">phần {o.part_index}/{o.part_of}</span> : null}
            {(o.late_days ?? 0) > 0 && <span className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800" title={`Ngày giao ${o.delivery_date ?? '?'} — chưa điều, chưa đi`}>trễ {o.late_days} ngày</span>}
            {fl && <span className="rounded bg-red-100 px-1 text-[9px] font-medium text-red-700" title={fl.info ?? undefined}>{FLAG_VI[fl.kind]}</span>}
            <span className="ml-auto tabular-nums text-slate-600 whitespace-nowrap">{nf(o.pallets, 1)} pl</span>
          </div>
          {!compact && <div className="truncate text-slate-500">{o.ship_to_name ?? o.ship_to_code}{o.ward_code ? <span className="text-slate-400"> · {o.ward_code}</span> : null}</div>}
          {compact && <div className="truncate text-slate-500">{o.ship_to_name ?? o.ship_to_code}</div>}
          {fl?.kind === 'REPLACED' && fl.replaced_by && editable && (!tr || editableTrip(tr)) && (
            <button type="button" className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 hover:underline" disabled={replace.isPending}
              onClick={e => { e.stopPropagation(); void doReplace(o.od_number) }}><Replace className="h-3 w-3" /> Thay bằng OD mới {fl.replaced_by}</button>
          )}
        </div>
      </div>
    )
  }

  const loadBar = (t: DispatchTrip) => {
    if (!t.ods.length) return <div className="text-[10px] text-slate-400 py-1">Xe trống — thả OD vào đây{editableTrip(t) ? ', hoặc bỏ xe (✕)' : ''}</div>
    const l = t.detail.load
    const pct = t.load_pct == null ? l.pct : Number(t.load_pct)
    if (pct == null) return <div className="text-[10px] text-slate-400 py-1">Không đo được tải</div>
    const color = pct > 100 ? 'bg-red-500' : t.underload ? 'bg-amber-500' : 'bg-green-500'
    return (
      <div className="space-y-0.5" title={`${nf(l.used, 1)} / ${nf(l.cap, 1)} ${l.basis === 'TON' ? 'tấn' : 'pallet'} · ngưỡng Non tải ${l.underload_pct}%`}>
        <div className="relative h-2 rounded-full bg-slate-200 overflow-hidden">
          <div className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
          <div className="absolute inset-y-0 w-px bg-slate-500/60" style={{ left: `${l.underload_pct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] tabular-nums">
          <span className="text-slate-500">{nf(l.used, 1)}/{nf(l.cap, 1)} {l.basis === 'TON' ? 't' : 'pl'}</span>
          <span className={pct > 100 ? 'text-red-600 font-semibold' : t.underload ? 'text-amber-700 font-medium' : 'text-slate-600'}>{nf(pct, 1)}%{t.underload ? ' · Non tải' : pct > 100 ? ' · vượt' : ''}</span>
        </div>
      </div>
    )
  }

  const preview = (p: { data: DispatchMovePreview | null; loading: boolean }) => (
    <div className="absolute inset-x-1 bottom-1 rounded bg-slate-900/90 px-2 py-1 text-[10px] text-white pointer-events-none">
      {p.loading ? 'Đang tính…' : p.data ? (
        <>
          <div className={p.data.oversize ? 'text-red-300 font-semibold' : p.data.underload ? 'text-amber-200' : 'text-green-300'}>
            → {nf(p.data.pallets, 1)} pl · {p.data.load_pct == null ? '—' : `${nf(p.data.load_pct, 1)}%`} · {p.data.stops} điểm
          </div>
          <div>cước {money(p.data.freight_estimated)}{p.data.freight_before != null && p.data.freight_estimated != null ? ` (${Number(p.data.freight_estimated) >= Number(p.data.freight_before) ? '+' : '−'}${money(Math.abs(Number(p.data.freight_estimated) - Number(p.data.freight_before)))})` : ''}</div>
          {p.data.warnings[0] && <div className="text-amber-200 truncate">⚠ {p.data.warnings[0]}</div>}
        </>
      ) : 'Thả để chuyển'}
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row min-h-0 h-full">
      {/* ── KHUNG CHỜ ── */}
      <aside {...dropProps('pool', 'pool')}
        className={`lg:w-[300px] shrink-0 border-b lg:border-b-0 lg:border-r flex flex-col min-h-0 ${hover?.target === 'pool' ? 'bg-sky-50 ring-2 ring-inset ring-sky-400' : 'bg-slate-50/60'}`}>
        <div className="px-3 py-2 border-b bg-white space-y-1.5 shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="text-xs font-semibold text-slate-700">Khung chờ</span>
            <span className="text-[11px] text-slate-500 tabular-nums">{nf(plan.summary.pool_ods ?? pool.length)} OD · {nf(plan.summary.pool_pallets ?? 0, 1)} pl</span>
            {poolShown.length > 0 && editable && (
              <button type="button" className="ml-auto text-[10px] text-sky-700 hover:underline whitespace-nowrap" onClick={() => toggleMany(poolShown.map(o => o.id))}>
                {poolShown.every(o => sel.has(o.id)) ? 'Bỏ chọn' : 'Chọn hết'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-400">Gom theo</span>
            {([['ward', 'Phường'], ['region', 'Vùng'], ['customer', 'Khách']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setF({ boardGroup: k })}
                className={`rounded px-1.5 py-0.5 ${f.boardGroup === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>
            ))}
          </div>
          {newOds > 0 && editable && (
            <button type="button" onClick={() => void doRefresh()} disabled={refresh.isPending}
              className="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-left text-[11px] text-amber-900 hover:bg-amber-100">
              <RefreshCw className="inline h-3 w-3 mr-1" /><b>{newOds} OD mới</b> từ ZSD02 chưa có trong kế hoạch — bấm để nạp vào khung chờ
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto max-h-[40vh] lg:max-h-none px-2 py-1.5 space-y-1.5">
          {!pool.length && <p className="px-1 py-3 text-center text-[11px] text-slate-400">{canDrag ? 'Kéo OD từ xe về đây để bỏ khỏi xe — OD ở khung chờ KHÔNG đi khi Xác nhận.' : 'Không có OD nào chờ xếp xe.'}</p>}
          {pool.length > 0 && !poolShown.length && <p className="px-1 py-3 text-center text-[11px] text-slate-400">Không OD nào khớp "{f.search}"</p>}
          {groups.map(g => {
            const open = !collapsed.has(g.k)
            return (
              <div key={g.k} className="rounded border border-slate-200 bg-white">
                <div className="flex items-center gap-1.5 px-1.5 py-1 border-b border-slate-100">
                  <button type="button" className="text-slate-400" onClick={() => setCollapsed(p => { const n = new Set(p); n.has(g.k) ? n.delete(g.k) : n.add(g.k); return n })}>
                    {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <span className="text-[11px] font-semibold text-slate-700 truncate flex-1 min-w-0" title={g.k}>{g.k}</span>
                  <span className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap">{g.rows.length} OD · {nf(g.pallets, 1)} pl</span>
                  {editable && <input type="checkbox" className="h-3.5 w-3.5 accent-sky-600" checked={g.rows.every(o => sel.has(o.id))} onChange={() => toggleMany(g.rows.map(o => o.id))} title="Chọn cả nhóm để kéo một lượt" />}
                </div>
                {open && <div className="p-0.5">{g.rows.map(o => odRow(o))}</div>}
              </div>
            )
          })}
          {(plan.unplanned.length > 0 || excluded.length > 0) && (
            <div className="space-y-1 pt-1">
              {plan.unplanned.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 text-[11px]">
                  <button type="button" className="w-full flex items-center gap-1 px-2 py-1 text-amber-900" onClick={() => setShowSide(s => s === 'unplanned' ? '' : 'unplanned')}>
                    {showSide === 'unplanned' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <AlertTriangle className="h-3.5 w-3.5" /> {plan.unplanned.length} OD không lên xe
                  </button>
                  {showSide === 'unplanned' && <ul className="px-2 pb-1.5 space-y-0.5 max-h-48 overflow-auto">{plan.unplanned.map(u => <li key={u.od_number}><span className="font-mono">{u.od_number}</span> — {u.reason}</li>)}</ul>}
                </div>
              )}
              {excluded.length > 0 && (
                <div className="rounded border border-slate-200 bg-white text-[11px]">
                  <button type="button" className="w-full flex items-center gap-1 px-2 py-1 text-slate-700" onClick={() => setShowSide(s => s === 'excluded' ? '' : 'excluded')}
                    title="OD ngày giao này mà máy KHÔNG đưa vào đợt ghép vì đã được lo ở chỗ khác (lũy tiến)">
                    {showSide === 'excluded' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {excluded.length} OD đã bỏ ra: {Object.entries(exBy).map(([k, n]) => `${n} ${EX_VI[k] ?? k}`).join(' · ')}
                  </button>
                  {showSide === 'excluded' && <ul className="px-2 pb-1.5 space-y-0.5 max-h-48 overflow-auto">{excluded.map(x => <li key={x.od_number}><span className="font-mono">{x.od_number}</span> — {EX_VI[x.kind] ?? x.kind}{x.info ? ` (${x.info})` : ''}</li>)}</ul>}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── LƯỚI THẺ XE ── */}
      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="px-3 py-1.5 border-b bg-white flex items-center gap-2 flex-wrap shrink-0">
          <SearchInput value={f.search} onChange={v => setF({ search: v })} placeholder="Tìm Số xe, OD, khách, phường…" className="flex-1 min-w-[180px]" />
          <span className="text-[11px] text-slate-500 whitespace-nowrap">{shownTrips.length}/{trips.length} xe</span>
          <ActionCluster items={actions} mobileInline />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 pb-24 lg:pb-3">
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {editable && (
              <div {...dropProps('new', 'new')}
                className={`rounded-lg border-2 border-dashed p-3 flex flex-col items-center justify-center gap-1 text-center min-h-[120px] ${hover?.target === 'new' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-300 text-slate-400'}`}>
                <Plus className="h-5 w-5" />
                <span className="text-xs font-medium">Xe mới</span>
                <span className="text-[10px]">{canDrag ? 'Thả OD vào đây — máy chọn dòng xe + ĐVVT theo luật ghép' : 'Chọn OD rồi "Chuyển tới xe…" → Xe mới'}</span>
              </div>
            )}
            {shownTrips.map(t => {
              const st = tripStatus(t)
              const ed = editableTrip(t)
              const iss = ISSUE_ORDER.filter(k => issuesOf(t, ctx).includes(k))
              const isHover = hover?.target === t.id
              const border = !ed ? 'border-slate-200 opacity-80' : t.oversize ? 'border-red-400' : iss.some(k => TODO_KEYS.has(k)) ? 'border-amber-300' : 'border-slate-200'
              return (
                <div key={t.id} {...(ed ? dropProps('trip', t.id, t.id) : {})}
                  className={`relative rounded-lg border bg-white shadow-sm flex flex-col ${border} ${isHover ? 'ring-2 ring-sky-400' : ''} ${t.locked ? 'bg-slate-50' : ''}`}>
                  <div className="flex items-start gap-1.5 px-2 pt-1.5">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenTrip(t.id)} title={`${t.group_code} — bấm để đổi dòng xe / ĐVVT`}>
                      <div className="flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="font-mono text-xs font-semibold">#{t.seq}</span>
                        <span className="truncate text-[10px] text-slate-400">{t.group_code}</span>
                      </div>
                      <div className="truncate text-[11px] text-slate-700">{t.detail.vehicle_model?.name ?? <span className="text-red-600">Chưa chọn dòng xe</span>}</div>
                      <div className="truncate text-[10px] text-slate-500">{t.detail.carrier ? <><b className="font-mono">{t.detail.carrier.code}</b> {t.detail.carrier.name}</> : <span className="text-red-600">Chưa có ĐVVT</span>}</div>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {st !== 'DRAFT' && <StatusBadge tone={st === 'CONFIRMED' ? 'green' : st === 'DECLINED' ? 'red' : 'blue'}>{st === 'CONFIRMED' ? 'Đã vào KH' : st === 'DECLINED' ? 'Từ chối' : st === 'TENDERED' ? 'Chờ ĐVVT' : st}</StatusBadge>}
                      {ed && (
                        <button type="button" className={`rounded p-1 ${t.locked ? 'text-slate-800' : 'text-slate-300 hover:text-slate-600'}`} disabled={patchTrip.isPending}
                          title={t.locked ? 'Đang khoá — "Tối ưu lại" không đụng vào xe này. Bấm để mở khoá' : 'Khoá xe để "Tối ưu lại" giữ nguyên'}
                          onClick={() => patchTrip.mutateAsync({ id: t.id, locked: !t.locked }).catch(e => err(e, 'Không đổi được khoá'))}>
                          {t.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {ed && !t.ods.length && (
                        <button type="button" className="rounded p-1 text-slate-400 hover:text-red-600" title="Bỏ xe trống" disabled={delTrip.isPending}
                          onClick={() => delTrip.mutateAsync(t.id).catch(e => err(e, 'Không bỏ được xe'))}><X className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  </div>
                  <div className="px-2 pt-1">{loadBar(t)}</div>
                  {t.ods.length > 0 && (
                    <div className="px-2 pt-0.5 flex items-center gap-1.5 text-[10px] text-slate-600 flex-wrap">
                      <span className={t.stops > (plan.params.max_drops ?? 3) ? 'text-red-600 font-semibold' : ''}>{t.stops}/{plan.params.max_drops ?? 3} điểm</span>
                      <span className="text-slate-300">·</span>
                      <span className="truncate max-w-[110px]" title={t.wards.join(', ')}>{t.wards.slice(0, 2).join(', ') || '—'}{t.wards.length > 2 ? ` +${t.wards.length - 2}` : ''}</span>
                      <span className="ml-auto font-semibold tabular-nums whitespace-nowrap" title={t.detail.freight.reason ?? undefined}>{t.freight_estimated == null ? <span className="font-normal text-amber-700">chưa có cước</span> : money(t.freight_estimated)}</span>
                    </div>
                  )}
                  {iss.length > 0 && (
                    <div className="px-2 pt-1 flex flex-wrap gap-1">
                      {iss.map(k => <span key={k} className={`rounded px-1 text-[9px] font-medium ${k === 'declined' || k === 'over' || k === 'sapflag' ? 'bg-red-100 text-red-700' : TODO_KEYS.has(k) ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{ISSUE_SHORT[k]}</span>)}
                    </div>
                  )}
                  <div className="px-1 pt-1 pb-1.5 space-y-0.5 flex-1">
                    {t.ods.map(o => odRow(o, true))}
                  </div>
                  {isHover && hover && preview(hover)}
                </div>
              )
            })}
          </div>
          {!shownTrips.length && trips.length > 0 && (
            <p className="py-8 text-center text-xs text-slate-400">Không xe nào khớp bộ lọc. <button type="button" className="text-sky-700 underline" onClick={() => setF({ issue: '', search: '' })}>Xem tất cả {trips.length} xe</button></p>
          )}
        </div>
      </section>

      <FloatingActionBar count={selIds.length} unit="OD đã chọn">
        <Button size="sm" variant="outline" className={FLOATING_BTN} onClick={() => { setMoveTarget(''); setMoveDlg(true) }}>Chuyển tới xe…</Button>
        {selIds.some(id => tripOf.get(id)) && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => void run(selIds.filter(id => tripOf.get(id)), 'pool')}>Về khung chờ</Button>}
        <Button size="sm" variant="outline" className={FLOATING_BTN_DANGER} disabled={busy} onClick={() => void doRemove(selIds)}><Trash2 className="h-3.5 w-3.5 mr-1" />Bỏ khỏi kế hoạch</Button>
        <Button size="sm" variant="outline" className={FLOATING_BTN} onClick={() => setSel(new Set())}>Bỏ chọn</Button>
      </FloatingActionBar>

      <Dialog open={moveDlg} onOpenChange={o => { if (!o && !busy) setMoveDlg(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Chuyển {selIds.length} dòng OD tới…</DialogTitle></DialogHeader>
          <SingleSelect value={moveTarget} onChange={setMoveTarget} placeholder="Chọn xe…"
            options={[{ value: '__new__', label: '＋ Xe mới (máy chọn dòng xe + ĐVVT)' }, { value: '__pool__', label: 'Khung chờ (bỏ khỏi xe)' }, ...targets]} />
          <p className="text-[11px] text-slate-500">Cước + % tải của xe cũ và xe mới tính lại ngay. Vượt tải vẫn chuyển được — xe sẽ báo đỏ.</p>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => setMoveDlg(false)}>Huỷ</Button>
            <Button size="sm" className="h-8" disabled={!moveTarget || busy} onClick={() => {
              const to: DispatchMoveTo = moveTarget === '__new__' ? 'new' : moveTarget === '__pool__' ? 'pool' : 'trip'
              void run(selIds, to, to === 'trip' ? moveTarget : undefined).then(() => setMoveDlg(false))
            }}>{busy ? 'Đang chuyển…' : 'Chuyển'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmNode}
    </div>
  )
}
