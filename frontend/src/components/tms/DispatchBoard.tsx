// BÀN GHÉP XE — kéo thả OD vào xe (user chốt 25/09: "ngồi xử lý ở table rất mất thời gian và không trực quan").
//
// Khuôn lấy từ các TMS đã có người dùng thật (nghiên cứu 25/09): SAP TM Transportation Cockpit (hai khung: đơn chưa xếp ·
// xe), Oracle OTM Workbench (thả là kiểm lại sức chứa), Routific / OptimoRoute (khoá tuyến rồi "tối ưu lại phần chưa khoá").
// Onwheel không công bố màn kéo thả — chỉ có "% tải" trên từng xe, cũng là thứ đầu tiên thẻ xe ở đây nói.
//   • Trái = KHUNG CHỜ: OD trong kế hoạch chưa lên xe nào, gom theo PHƯỜNG (khoá cước — nhìn một cụm là biết đi chung được
//     không) / vùng / khách. OD mới về ZSD02 (lũy tiến) TỰ vào đây, nhãn "Mới" (28/09 — trang Điều vận tự nạp).
//   • Phải = LƯỚI THẺ XE: % tải tô màu (Non tải hổ phách · đạt xanh · vượt đỏ), điểm giao, cước, cờ vấn đề.
//   • Thả = server tính lại cước/tải/điều kiện bảo quản NGAY rồi trả nguyên kế hoạch (dải chỉ số đổi theo).
//   • Rê qua một xe = XEM TRƯỚC (pallet · % tải · điểm · cước mới) — biết kết quả trước khi thả.
//   • Vượt tải CHO THẢ, đánh dấu đỏ (user chốt) — không chặn như máy; Xác nhận nhắc lại.
//   • Hoàn tác / Làm lại (Ctrl+Z / Ctrl+Y), khoá xe, bỏ xe trống, "Chuyển tới xe…" cho người không kéo được (điện thoại,
//     hoặc 80 thẻ xe không kéo chính xác nổi).
//   • BƯỚC 1 = XEM ĐƠN nằm ở BẢNG riêng (DispatchReviewTable, 27/09 tối); chưa có xe nào thì tab này cũng mở bảng đó. Khung chờ
//     = OD trạng thái ĐIỀU (đơn mới về mặc định là Điều); đơn không đi chuyển sang "Không điều ngày này" / "Không điều".
//     SAP sửa OD (SL / dòng hàng / ghi chú) ⇒ cờ "SAP đã sửa" + nút "Cập nhật theo SAP"; Xác nhận kế hoạch bị chặn tới khi xử lý.
// ⚠ Kéo thả chỉ bật từ lg (chuột). Điện thoại: tick OD → thanh nổi "Chuyển tới xe…" — cùng một cửa ghi.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { Lock, Unlock, X, Plus, Undo2, Redo2, Sparkles, Inbox, AlertTriangle, Replace, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsDownUp, ChevronsUpDown, Truck, CalendarClock, StickyNote, Ban, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SearchInput } from '@/components/shared/SearchInput'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FloatingActionBar, FLOATING_BTN, FLOATING_BTN_DANGER } from '@/components/shared/FloatingActionBar'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import {
  useVehicleTypes, useMoveDispatchOds, previewDispatchMove, useUpdateDispatchTrip, useDeleteDispatchTrip, useReplaceDispatchOd, useReoptimizeDispatchPlan,
  useHoldDispatchOds, useUnholdDispatchOds, useResyncDispatchOd,
  type DispatchPlan, type DispatchTrip, type DispatchTripOd, type DispatchOdFlag, type DispatchMoveTo, type DispatchMovePreview,
} from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'
import { whTypeBadgeCls } from '@/utils/cargoCategory'
import { DispatchCarrierPicker } from './DispatchCarrierPicker'
import { DispatchCustomerVehiclesSheet } from './DispatchCustomerVehiclesSheet'
import { DispatchLoadBandDialog, DispatchLoadBandChip, useLoadBandParents, fullBands, type LoadBandDraft } from './DispatchLoadBandDialog'
import { NewOdChip } from './DispatchReviewTable'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { EDITABLE, tripStatus, issuesOf, needsWork, ISSUE_ORDER, ISSUE_SHORT, TODO_KEYS, FLAG_VI, type IssueKey } from './dispatchIssues'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const money = (n: number | string | null | undefined) => {
  if (n == null) return '—'
  const v = Number(n), a = Math.abs(v)
  return a >= 1e6 ? `${nf(v / 1e6, 2)} tr` : `${nf(v)} ₫`
}
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'
const DRAG_MIME = 'application/x-dispatch-ods'
const uniqStr = (a: string[]) => [...new Set(a)]
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
  g === 'region' ? (o.region_name || o.region_code || 'Chưa có vùng') : g === 'customer' ? (o.ship_to_name || o.ship_to_code || '—') : (o.ward_code || 'Chưa có phường')
const matches = (o: DispatchTripOd, q: string) =>
  !q || [o.od_number, o.ship_to_code, o.ship_to_name, o.ward_code, o.region_code, o.region_name, o.note].some(v => (v ?? '').toLowerCase().includes(q))

export function DispatchBoard({ plan, editable, flags, onOpenTrip }: {
  plan: DispatchPlan; editable: boolean; flags: Map<string, DispatchOdFlag>; onOpenTrip: (id: string) => void
}) {
  const f = useWmsFilterStore(s => s.dispatch)
  const setF = useWmsFilterStore(s => s.setDispatch)
  const desktop = useIsDesktop()
  const canDrag = editable && desktop
  const poolRail = f.poolHidden && desktop
  const { data: vtypes = [] } = useVehicleTypes()
  const whMeta = useWhTypeMetaMap()
  const q = f.search.trim().toLowerCase()
  const ctx = useMemo(() => ({ flags }), [flags])
  const pool = useMemo(() => plan.pool ?? [], [plan.pool])
  const trips = plan.trips.filter(t => tripStatus(t) !== 'DISCARDED')
  const tripOf = useMemo(() => new Map([...plan.trips.flatMap(t => t.ods.map(o => [o.id, t.id] as const)), ...pool.map(o => [o.id, null] as const)]), [plan.trips, pool])
  const rowBy = useMemo(() => new Map([...plan.trips.flatMap(t => t.ods), ...pool].map(o => [o.id, o])), [plan.trips, pool])
  const editableTrip = (t: DispatchTrip) => editable && EDITABLE.includes(tripStatus(t))

  const move = useMoveDispatchOds(), patchTrip = useUpdateDispatchTrip(), delTrip = useDeleteDispatchTrip()
  const replace = useReplaceDispatchOd(), reopt = useReoptimizeDispatchPlan()
  const fresh = useMemo(() => new Set(plan.params.fresh_ods ?? []), [plan.params.fresh_ods])
  const hold = useHoldDispatchOds(), unhold = useUnholdDispatchOds(), resync = useResyncDispatchOd()
  const perms = (useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null) ?? null
  // sửa "Dòng xe được vào" của khách từ bàn (27/09) — quyền riêng của điều vận, hoặc quyền sửa Khách hàng
  const canCustVeh = can(perms, 'dispatch', 'customer_vehicles') || can(perms, 'customers', 'edit')
  const [custSheet, setCustSheet] = useState<string | null>(null)
  // HOÃN / KHÔNG ĐIỀU (27/09): OD rời kế hoạch, dấu giữ qua mọi lần nạp — khác "Bỏ khỏi kế hoạch" chỉ là tạm
  const [holdDlg, setHoldDlg] = useState(false)
  const [holdMode, setHoldMode] = useState<'date' | 'never'>('date')
  const [holdUntil, setHoldUntil] = useState('')
  const [holdReason, setHoldReason] = useState('')
  const [notesOnly, setNotesOnly] = useState(false)
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
  // xe VỪA nhận OD — bàn sắp lại sau mỗi lần thả nên xe đó có thể đổi chỗ: tô viền + cuộn tới để không mất dấu
  const [justHit, setJustHit] = useState<string | null>(null)
  useEffect(() => {
    if (!justHit) return
    document.querySelector(`[data-trip-card="${justHit}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const h = window.setTimeout(() => setJustHit(null), 2500)
    return () => window.clearTimeout(h)
  }, [justHit])
  const pvCache = useRef(new Map<string, DispatchMovePreview>())
  useEffect(() => { setSel(new Set()); setUndo([]); setRedo([]); pvCache.current.clear() }, [plan.id])
  useEffect(() => { pvCache.current.clear() }, [plan.updated_at, plan.trips])   // bật/tắt switch ghép loại không đổi updated_at của kế hoạch
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
      setJustHit(to === 'trip' ? to_trip_id ?? null : created ?? null)
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
  const poolNotes = pool.filter(o => !!o.note).length
  const poolShown = pool.filter(o => matches(o, q) && (!notesOnly || !!o.note))
  const groups = useMemo(() => {
    const m = new Map<string, DispatchTripOd[]>()
    for (const o of poolShown) { const k = groupKeyOf(o, f.boardGroup); m.set(k, [...(m.get(k) ?? []), o]) }
    return [...m.entries()].map(([k, rs]) => ({ k, rows: rs, pallets: rs.reduce((s, o) => s + Number(o.pallets ?? 0), 0) }))
      .sort((a, b) => b.pallets - a.pallets || a.k.localeCompare(b.k))
  }, [poolShown, f.boardGroup])

  // ── Thẻ xe: cùng bộ lọc "Soát" với bảng Danh sách xe ──
  // KHÁCH CHÍNH của xe = khách chiếm nhiều pallet nhất — khoá sắp xếp để xe cùng khách ĐỨNG CẠNH NHAU (user 30/09: "sort đơn
  // của chung 1 khách hàng gần nhau là bắt buộc — máy tách 17 pallet một xe, 0,5 pallet một xe thì tôi cần nhìn gần nhau để quyết")
  const mainCustOf = (t: DispatchTrip) => {
    const by = new Map<string, number>()
    for (const o of t.ods) { const k = o.ship_to_name || o.ship_to_code || ''; by.set(k, (by.get(k) ?? 0) + Number(o.pallets ?? 0)) }
    return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
  }
  const shownTrips = useMemo(() => {
    let l = trips.filter(t => !q || t.group_code.toLowerCase().includes(q) || t.ods.some(o => matches(o, q)))
    if (f.issue === 'todo') l = l.filter(t => needsWork(t, ctx))
    else if (f.issue) l = l.filter(t => issuesOf(t, ctx).includes(f.issue as IssueKey))
    // SẮP LẠI SAU MỖI LẦN THẢ (user 25/09: "kéo thả xong thì không sort nữa") — sort ổn định, hoà thì theo số xe
    const regionOf = (t: DispatchTrip) => `${t.ods[0]?.region_code ?? '~'}|${t.wards[0] ?? '~'}|${mainCustOf(t)}`
    const by: Record<string, (a: DispatchTrip, b: DispatchTrip) => number> = {
      region: (a, b) => regionOf(a).localeCompare(regionOf(b)),
      todo: (a, b) => Number(needsWork(b, ctx)) - Number(needsWork(a, ctx)),
      load: (a, b) => (a.load_pct == null ? 1e9 : Number(a.load_pct)) - (b.load_pct == null ? 1e9 : Number(b.load_pct)),
      freight: (a, b) => Number(b.freight_estimated ?? -1) - Number(a.freight_estimated ?? -1),
      seq: () => 0,
    }
    const cmp = by[f.boardSort] ?? by.region
    return [...l].sort((a, b) => cmp(a, b) || a.seq - b.seq)
  }, [trips, q, f.issue, f.boardSort, ctx])

  const selIds = [...sel].filter(id => rowBy.has(id))
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleMany = (ids: string[]) => setSel(p => { const all = ids.every(id => p.has(id)); const n = new Set(p); for (const id of ids) all ? n.delete(id) : n.add(id); return n })

  const doReplace = (od: string) => replace.mutateAsync({ plan_id: plan.id, od_number: od })
    .then(r => toast({ title: `Đã thay ${r.replaced.from} bằng ${r.replaced.to}`, description: 'Tải + cước của xe đã tính lại theo OD mới.' }))
    .catch(e => err(e, 'Không thay được OD'))
  // TỐI ƯU LẠI — hộp thoại DẢI % TẢI theo dòng xe cha (01/10) đứng trước lượt ghép; dải chọn ở đây ghi vào kế hoạch + nhớ cho kho
  const bandParents = useLoadBandParents()
  const [reoptDlg, setReoptDlg] = useState(false)
  const lockedN = trips.filter(t => t.locked).length
  const doReopt = () => setReoptDlg(true)
  const doReoptWith = (d: LoadBandDraft) =>
    reopt.mutateAsync({ id: plan.id, load_bands: d.bands, load_bypass: d.bypass }).then(r => { setReoptDlg(false); setUndo([]); setRedo([]); toast({ title: `Đã ghép lại thành ${r.reoptimized.trips} xe`, description: `${r.reoptimized.kept} xe giữ nguyên${r.reoptimized.left_in_pool ? ` · ${r.reoptimized.left_in_pool} OD vẫn ở khung chờ (không xếp được / đã đổi ở SAP)` : ''}` }) })
      .catch(e => err(e, 'Không tối ưu lại được'))
  const openHold = (mode: 'date' | 'never') => {
    const d = new Date(`${plan.plan_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)
    setHoldMode(mode); setHoldUntil(d.toISOString().slice(0, 10)); setHoldReason('')
    setHoldDlg(true)
  }
  // nút trên thẻ (30/09): chọn đúng các dòng OD đó rồi mở hộp Không điều — cùng cửa ghi với thanh nổi
  const openHoldFor = (ids: string[]) => { setSel(new Set(ids)); openHold('date') }
  const doHold = () => {
    const ods = uniqStr(selIds.map(id => rowBy.get(id)?.od_number ?? '').filter(Boolean))
    hold.mutateAsync({ plan_id: plan.id, ids: selIds, until: holdMode === 'date' ? holdUntil : null, reason: holdReason.trim() || undefined })
      .then(r => { setHoldDlg(false); setSel(new Set()); setUndo([]); setRedo([]); toast({ title: `${r.held.ods} OD → ${holdMode === 'date' ? `Không điều ngày này (điều lại từ ${holdUntil})` : 'Không điều'}`, description: `${ods.slice(0, 4).join(', ')}${ods.length > 4 ? '…' : ''} — xem / chuyển lại ở tab Xem đơn.` }) })
      .catch(e => err(e, 'Không chuyển được trạng thái'))
  }
  const doUnhold = (od: string) => unhold.mutateAsync({ plan_id: plan.id, od_numbers: [od] })
    .then(r => toast({ title: `${od} → Điều`, description: r.unheld.back_to_pool ? 'OD đã về khung chờ của kế hoạch này.' : 'OD không quay lại khung chờ (đã được lo ở chỗ khác hoặc không còn trong ZSD02).' }))
    .catch(e => err(e, 'Không chuyển được trạng thái'))
  // ghép RIÊNG các OD đã chọn ở khung chờ; xe đang có giữ nguyên
  const poolSel = selIds.filter(id => tripOf.get(id) === null)
  const doReoptSel = () => reopt.mutateAsync({ id: plan.id, ids: poolSel })
    .then(r => { setSel(new Set()); setUndo([]); setRedo([]); toast({ title: `Đã ghép ${poolSel.length} dòng OD thành ${r.reoptimized.trips} xe`, description: r.reoptimized.left_in_pool ? `${r.reoptimized.left_in_pool} OD không xếp được — vẫn ở khung chờ.` : 'Các xe đang có giữ nguyên.' }) })
    .catch(e => err(e, 'Không ghép được'))
  const doResync = (od: string) => resync.mutateAsync({ plan_id: plan.id, od_number: od })
    .then(r => toast({ title: `Đã cập nhật ${od} theo SAP`, description: `${nf(r.resynced.pallets_before, 1)} → ${nf(r.resynced.pallets_after, 1)} pallet · ${nf(r.resynced.tons_before, 1)} → ${nf(r.resynced.tons_after, 1)} tấn — tải + cước của xe đã tính lại.` }))
    .catch(e => err(e, 'Không cập nhật được OD'))

  const actions: ActionItem[] = []
  if (editable) {
    actions.push({ key: 'undo', icon: Undo2, label: 'Hoàn tác', tip: `Hoàn tác lần chuyển OD gần nhất (Ctrl+Z)${undoStack.length ? ` — còn ${undoStack.length} bước` : ''}`, onClick: () => void undo(), disabled: !undoStack.length || busy })
    actions.push({ key: 'redo', icon: Redo2, label: 'Làm lại', tip: 'Làm lại (Ctrl+Y)', onClick: () => void redo(), disabled: !redoStack.length || busy })
    actions.push({ key: 'reopt', icon: Sparkles, label: 'Tối ưu lại', tip: 'Máy ghép lại các OD ở khung chờ + các xe chưa khoá; xe đã khoá giữ nguyên', onClick: doReopt, disabled: reopt.isPending || busy, busy: reopt.isPending })  }

  const targets = trips.filter(editableTrip).map(t => ({ value: t.id, label: `#${t.seq} · ${t.detail.vehicle_model?.name ?? 'chưa chọn xe'}`, sub: `${nf(t.pallets, 1)} pl · ${t.load_pct == null ? '—' : `${nf(t.load_pct, 0)}%`} · ${t.stops} điểm · ${t.wards.slice(0, 2).join(', ')}` }))
  const excluded = plan.params.excluded ?? []
  const exBy = excluded.reduce<Record<string, number>>((m, x) => { m[x.kind] = (m[x.kind] ?? 0) + 1; return m }, {})
  const EX_VI: Record<string, string> = { IN_PLAN: 'đã có trong Kế hoạch xuất', OTHER_DRAFT: 'nằm ở nháp ngày khác', SAP_ASSIGNED: 'SAP đã điều', SHIPPED: 'đã xuất kho', HELD: 'không điều', REDO_DISPATCHED: 'DO tạo lại – đã điều' }

  // (29/09: chip Pallet / Xá của OD bỏ — kiểu đi không còn là cấu hình; dòng xe khách được vào quyết tất cả)

  // Chip LOẠI KHO cùng màu badge của WMS (Cài đặt WMS → Loại kho, user 27/09: "khớp màu trong wms") — xe chở loại nào nhìn là biết.
  // Loại "đi kèm đơn" (POSM) in viền đứt: nó ké theo đơn, không quyết loại của xe. Thứ tự = loại chiếm tải lớn nhất trước.
  const follow = useMemo(() => new Set(plan.params.follow_categories ?? []), [plan.params.follow_categories])
  const catsByLoad = (loads: (Record<string, number> | null | undefined)[]) => {
    const by = new Map<string, number>()
    for (const m of loads) for (const [k, v] of Object.entries(m ?? {})) by.set(k, (by.get(k) ?? 0) + (Number(v) || 0))
    return [...by.entries()].sort((a, b) => (Number(follow.has(a[0])) - Number(follow.has(b[0]))) || (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([k]) => k)
  }
  const catChips = (cats: string[]) => cats.map(c => (
    <span key={c} className={`rounded px-1 text-[9px] font-semibold ${whTypeBadgeCls(c, whMeta)} ${follow.has(c) ? 'border border-dashed border-current opacity-75' : ''}`}
      title={follow.has(c) ? `${c} — đi kèm đơn, không quyết Loại kho của xe` : `Loại kho ${c}`}>{c}</span>
  ))

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
            {!o.trip_id && fresh.has(o.od_number) && <NewOdChip />}
            {(o.late_days ?? 0) > 0 && <span className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800" title={`Ngày giao ${o.delivery_date ?? '?'} — chưa điều, chưa đi`}>trễ {o.late_days} ngày</span>}
            {fl && <span className="rounded bg-red-100 px-1 text-[9px] font-medium text-red-700" title={fl.info ?? undefined}>{FLAG_VI[fl.kind]}</span>}
            {catChips(catsByLoad([o.cat_load]))}
            <span className="ml-auto tabular-nums text-slate-600 whitespace-nowrap">{nf(o.pallets, 1)} pl · {nf(o.tons, 1)} t</span>
          </div>
          {/* KHÔNG cắt "…" (user 25/09 tối: "nội dung trong thẻ đơn hàng bị che bằng dấu …") — tên khách xuống dòng */}
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1 break-words text-slate-500 leading-snug">{o.ship_to_name ?? o.ship_to_code}{!compact && o.ward_code ? <span className="text-slate-400"> · {o.ward_code}</span> : null}
              {/* 28/09: mọi OD giờ đều mang danh sách (theo kênh / khách) — chỉ nói khi RỖNG: máy không chọn xe cho khách này */}
              {o.allowed_models && !o.allowed_models.length && <span className="ml-1 rounded bg-red-100 px-1 text-[9px] font-medium text-red-700" title="Khách và kênh của khách chưa khai Dòng xe được vào — máy không chọn xe (Khách hàng → Dòng xe được vào)">Chưa khai xe</span>}
              {/* OD chỉ có hàng đi kèm (POSM) ở khung chờ: máy KHÔNG cho đi xe riêng (user 30/09) — chờ đơn chính cùng cụm hoặc người kéo lên xe của khách */}
              {!o.trip_id && o.cat_load && Object.keys(o.cat_load).length > 0 && Object.keys(o.cat_load).every(c => follow.has(c)) && <span className="ml-1 rounded bg-violet-100 px-1 text-[9px] font-medium text-violet-800" title="Chỉ có hàng đi kèm đơn (POSM) — máy không xếp xe riêng; sẽ ké khi có đơn hàng chính của khách, hoặc kéo tay lên xe của khách">Chờ đơn chính</span>}
            </div>
            {/* dòng xe được vào của KHÁCH — mở/sửa ngay tại bàn (user 27/09); đổi kênh vẫn ở trang Khách hàng */}
            {o.ship_to_code && (
              <button type="button" className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-sky-700" title={`Dòng xe được vào của khách ${o.ship_to_name ?? o.ship_to_code}${canCustVeh ? ' — xem / sửa' : ' — xem'}`}
                onClick={e => { e.stopPropagation(); setCustSheet(o.ship_to_code) }}><Truck className="h-3.5 w-3.5" /></button>
            )}
            {/* KHÔNG ĐIỀU từng OD ngay trên dòng (user 30/09) — hiện khi rê chuột, luôn hiện trên màn cảm ứng */}
            {editable && (!tr || editableTrip(tr)) && (
              <button type="button" className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-red-50 hover:text-red-600 [@media(pointer:coarse)]:text-slate-400 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100" title="Không điều OD này (chọn ngày điều lại hoặc không điều)" disabled={busy}
                onClick={e => { e.stopPropagation(); openHoldFor([o.id]) }}><Ban className="h-3.5 w-3.5" /></button>
            )}
          </div>
          {/* ghi chú giao hàng SAP (27/09) — người review đọc: "GIAO 10/9", "NPP không nhận CN"… máy KHÔNG đọc */}
          {o.note && <div className="mt-0.5 flex items-start gap-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-900 leading-snug break-words"><StickyNote className="h-3 w-3 shrink-0 mt-px" />{o.note}</div>}
          {fl?.kind === 'CHANGED' && (
            <div className="mt-0.5 text-[10px] text-red-700 leading-snug break-words">{fl.info}
              {editable && (!tr || editableTrip(tr) || tripStatus(tr) === 'TENDERED') && <button type="button" className="ml-1 inline-flex items-center gap-1 font-medium text-sky-700 hover:underline" disabled={resync.isPending}
                onClick={e => { e.stopPropagation(); void doResync(o.od_number) }}><RotateCw className="h-3 w-3" /> Cập nhật theo SAP</button>}
            </div>
          )}
          {fl?.kind === 'REPLACED' && fl.replaced_by && editable && (!tr || editableTrip(tr) || tripStatus(tr) === 'TENDERED') && (
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
    if (pct == null) return <div className="text-[10px] text-slate-500 py-1 tabular-nums">{nf(t.pallets, 1)} pl · {nf(t.tons, 1)} t <span className="text-slate-400">— chưa có dòng xe để đo % tải</span></div>
    // 01/10: "vượt" = quá TRẦN dải tải của dòng xe cha (vd 105 %); 100 < pct ≤ trần là dung sai cho phép, không đỏ
    const mx = l.max_pct ?? 100
    const color = pct > mx ? 'bg-red-500' : t.underload ? 'bg-amber-500' : 'bg-green-500'
    return (
      <div className="space-y-0.5" title={`${nf(l.used, 1)} / ${nf(l.cap, 1)} ${l.basis === 'TON' ? 'tấn' : 'pallet'} · dải ${l.underload_pct}–${mx}%`}>
        <div className="relative h-2 rounded-full bg-slate-200 overflow-hidden">
          <div className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
          <div className="absolute inset-y-0 w-px bg-slate-500/60" style={{ left: `${l.underload_pct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] tabular-nums">
          {/* đo theo chiều của dòng xe (pallet hoặc tấn), chiều kia hiện kèm để người xếp thấy đủ hai số */}
          <span className="text-slate-500">{l.basis === 'TON'
            ? <>{nf(l.used, 1)}/{nf(l.cap, 1)} t · {nf(t.pallets, 1)} pl</>
            : <>{nf(l.used, 1)}/{nf(l.cap, 1)} pl · {nf(t.tons, 1)} t</>}</span>
          <span className={pct > mx ? 'text-red-600 font-semibold' : t.underload ? 'text-amber-700 font-medium' : 'text-slate-600'}>{nf(pct, 1)}%{t.underload ? ' · Non tải' : pct > mx ? ' · vượt' : pct > 100 ? ' · dung sai' : ''}</span>
        </div>
      </div>
    )
  }

  const preview = (p: { data: DispatchMovePreview | null; loading: boolean }) => (
    <div className="absolute inset-x-1 bottom-1 rounded bg-slate-900/90 px-2 py-1 text-[10px] text-white pointer-events-none">
      {p.loading ? 'Đang tính…' : p.data?.blocked ? (
        <div className="text-red-300 font-semibold whitespace-normal">⛔ Xe không nhận — {p.data.blocked}</div>
      ) : p.data ? (
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

  // ── Nhóm thẻ xe: theo VÙNG (mặc định 30/09 — người điều nghĩ theo tuyến, và xe cùng khách phải nằm cùng nhóm) hoặc theo
  //    dòng xe CHA (thứ tự danh mục Loại xe ở Cài đặt TMS). Không còn tiêu đề phụ theo dòng xe con — tên dòng xe đã ở tiêu đề thẻ. ──
  const NO_MODEL = '__none__'
  const byVtype = f.boardTripGroup === 'vtype'
  const parentRank = useMemo(() => new Map(vtypes.map((v, i) => [v.name, i])), [vtypes])
  const tripGroups = useMemo(() => {
    const by = new Map<string, DispatchTrip[]>()
    const keyOf = (t: DispatchTrip) => byVtype ? (t.detail.vehicle_model?.parent_type_name ?? NO_MODEL) : (t.ods[0]?.region_name || t.ods[0]?.region_code || 'Chưa có vùng')
    for (const t of shownTrips) { const k = keyOf(t); by.set(k, [...(by.get(k) ?? []), t]) }
    return [...by.entries()].map(([k, ts]) => ({
      k, label: k === NO_MODEL ? 'Chưa chọn dòng xe' : k, trips: ts,
      pallets: ts.reduce((s, t) => s + Number(t.pallets ?? 0), 0), tons: ts.reduce((s, t) => s + Number(t.tons ?? 0), 0),
      freight: ts.reduce((s, t) => s + Number(t.freight_estimated ?? 0), 0),
      todo: ts.filter(t => needsWork(t, ctx)).length, over: ts.filter(t => t.oversize).length,
    })).sort((a, b) => byVtype
      ? (Number(a.k !== NO_MODEL) - Number(b.k !== NO_MODEL)) || ((parentRank.get(a.k) ?? 999) - (parentRank.get(b.k) ?? 999)) || a.label.localeCompare(b.label)
      : a.label.localeCompare(b.label))
  }, [shownTrips, parentRank, ctx, byVtype])
  const openSet = new Set(f.boardOpen)
  // đang tìm ⇒ mở hết để thấy kết quả. Lọc Soát: MỞ HẾT MỘT LẦN khi đổi chip nhưng vẫn đóng/mở được (user 30/09: "vào các tab
  // thì không đóng mở được dòng loại xe nữa" — bản cũ khoá nút toggle suốt lúc đang lọc)
  const forceOpen = !!q || tripGroups.length === 1
  const allOpen = tripGroups.every(g => openSet.has(g.k))
  const toggleGroup = (k: string) => { if (forceOpen) return; setF({ boardOpen: openSet.has(k) ? f.boardOpen.filter(x => x !== k) : [...f.boardOpen, k] }) }
  const issueRef = useRef(f.issue)
  useEffect(() => {
    if (issueRef.current === f.issue) return
    issueRef.current = f.issue
    if (f.issue) setF({ boardOpen: uniqStr([...f.boardOpen, ...tripGroups.map(g => g.k)]) })
  }, [f.issue]) // eslint-disable-line react-hooks/exhaustive-deps
  // rê OD qua đầu nhóm đang đóng ~0,5 s ⇒ nhóm tự mở để thả vào xe bên trong
  const armRef = useRef<{ k: string; h: number } | null>(null)
  const armOpen = (k: string) => {
    if (armRef.current?.k === k) return
    if (armRef.current) window.clearTimeout(armRef.current.h)
    armRef.current = { k, h: window.setTimeout(() => { armRef.current = null; if (!useWmsFilterStore.getState().dispatch.boardOpen.includes(k)) setF({ boardOpen: [...useWmsFilterStore.getState().dispatch.boardOpen, k] }) }, 500) }
  }
  // xe vừa nhận OD nằm trong nhóm đang đóng ⇒ mở nhóm đó, kẻo thả xong không thấy xe đâu
  useEffect(() => {
    if (!justHit || forceOpen) return
    const g = tripGroups.find(x => x.trips.some(t => t.id === justHit))
    if (g && !f.boardOpen.includes(g.k)) setF({ boardOpen: [...f.boardOpen, g.k] })
  }, [justHit]) // eslint-disable-line react-hooks/exhaustive-deps

  // (29/09: switch Pallet | Xá trên thẻ xe bỏ — đổi xe = "Đổi dòng xe" trong panel xe)

  // SWITCH "Ghép Loại kho khác" trên TỪNG thẻ xe (user 27/09: "TẮT = chặn thả"): mặc định theo tham số kế hoạch (kho);
  // tắt thì thả OD khác Loại kho chính vào xe bị từ chối kèm lý do, bật thì cho ghép không cảnh báo
  const mixOn = (t: DispatchTrip) => (t.allow_mix_categories ?? plan.params.allow_mix_categories) !== false
  const mixSwitch = (t: DispatchTrip) => {
    const on = mixOn(t)
    const can = editableTrip(t)
    const cats = (t.detail.categories ?? []).filter(c => !(plan.params.follow_categories ?? []).includes(c))
    return (
      <label className={`flex items-center gap-1.5 px-2 pt-1 text-[10px] ${can ? 'cursor-pointer' : 'opacity-60'}`}
        title={on ? 'Đang cho thả OD khác Loại kho vào xe này — tắt để chặn' : `Đang chặn thả OD khác Loại kho${cats.length ? ` (xe chở ${cats.join(', ')})` : ''} — bật để cho ghép`}>
        <Switch checked={on} disabled={!can || patchTrip.isPending} aria-label="Ghép Loại kho khác"
          onCheckedChange={v => { patchTrip.mutateAsync({ id: t.id, allow_mix_categories: v }).then(() => setJustHit(t.id)).catch(e => err(e, 'Không đổi được switch ghép loại')) }} />
        <span className={on ? 'text-slate-700' : 'text-slate-500'}>Ghép Loại kho khác{t.allow_mix_categories == null ? <span className="text-slate-400"> · theo kho</span> : null}</span>
      </label>
    )
  }

  const tripCard = (t: DispatchTrip) => {
    const st = tripStatus(t)
    const ed = editableTrip(t)
    const iss = ISSUE_ORDER.filter(k => issuesOf(t, ctx).includes(k))
    const isHover = hover?.target === t.id
    const border = !ed ? 'border-slate-200 opacity-80' : t.oversize ? 'border-red-400' : iss.some(k => TODO_KEYS.has(k)) ? 'border-amber-300' : 'border-slate-200'
    // trần điểm giao của KHO (dòng xe / kênh / khách khắt khe hơn thì xe báo qua cảnh báo "Vượt số khách cùng xe"); null = không giới hạn
    const lim = plan.params.max_drops ?? null
    return (
      <div key={t.id} data-trip-card={t.id} {...(ed ? dropProps('trip', t.id, t.id) : {})}
        className={`relative rounded-lg border bg-white shadow-sm flex flex-col transition-shadow ${border} ${isHover ? 'ring-2 ring-sky-400' : justHit === t.id ? 'ring-2 ring-green-400' : ''} ${t.locked ? 'bg-slate-50' : ''}`}>
        {/* TIÊU ĐỀ THẺ = thanh khung màu trung tính (user 30/09): "#số · dòng xe" + cảnh báo cần xử lý ngay trong thanh; nút xe bên phải */}
        <div className="flex items-start gap-1.5 rounded-t-lg border-b border-slate-200 bg-slate-100 px-2 py-1">
          <button type="button" className="min-w-0 flex-1 text-left leading-snug hover:text-sky-700" onClick={() => onOpenTrip(t.id)} title={`Số xe ${t.group_code} — mở chi tiết xe: đổi dòng xe, chuyển từng OD`}>
            <span className="font-mono text-xs font-bold text-slate-800">#{t.seq}</span>
            <span className="mx-1 text-slate-400">·</span>
            <span className="text-[11px] font-semibold text-slate-800 break-words">
              {(t.detail.vehicles?.length ?? 0) > 1
                ? <><span className="mr-1 rounded bg-sky-600 px-1 text-[9px] font-bold text-white align-middle">{t.detail.vehicles!.length} XE</span>{t.detail.vehicles!.map(v => v.name).join(' + ')}</>
                : t.detail.vehicle_model?.name ?? <span className="text-red-600">Chưa chọn dòng xe</span>}
            </span>
            {iss.length > 0 && (
              <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                {iss.map(k => <span key={k} className={`rounded px-1 text-[9px] font-medium ${k === 'declined' || k === 'over' || k === 'sapflag' ? 'bg-red-100 text-red-700' : TODO_KEYS.has(k) ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-500 border border-slate-200'}`}>{ISSUE_SHORT[k]}</span>)}
              </span>
            )}
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            {st !== 'DRAFT' && <StatusBadge tone={st === 'CONFIRMED' ? 'green' : st === 'DECLINED' ? 'red' : 'blue'}>{st === 'CONFIRMED' ? 'Đã vào KH' : st === 'DECLINED' ? 'Từ chối' : st === 'TENDERED' ? 'Chờ ĐVVT' : st}</StatusBadge>}
            {/* KHÔNG ĐIỀU cả xe — một nhát bấm chuyển mọi OD của xe (user 30/09: "trên thẻ cần nút chuyển thẳng trạng thái về không ghép của cả xe") */}
            {ed && t.ods.length > 0 && (
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600" title="Không điều cả xe — mọi OD của xe rời kế hoạch (chọn ngày điều lại hoặc không điều)" disabled={busy}
                onClick={() => openHoldFor(t.ods.map(o => o.id))}><Ban className="h-3.5 w-3.5" /></button>
            )}
            {ed && (
              <button type="button" className={`rounded p-1 ${t.locked ? 'text-slate-800' : 'text-slate-400 hover:bg-white hover:text-slate-700'}`} disabled={patchTrip.isPending}
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
        {/* thẻ NHIỀU XE (luật 11, 27/09): phần tải + cước của từng xe — một Số xe, ĐVVT booking đủ số xe */}
        {(t.detail.vehicles?.length ?? 0) > 1 && (
          <div className="mx-2 mt-0.5 rounded border border-sky-100 bg-sky-50/60 px-1.5 py-0.5 space-y-0.5">
            {t.detail.vehicles!.map((v, i) => (
              <div key={`${v.id}-${i}`} className="flex items-baseline gap-1 text-[10px] text-slate-700">
                <span className="min-w-0 flex-1 break-words">{v.name}</span>
                <span className="tabular-nums text-slate-500 whitespace-nowrap">{nf(v.pallets, 1)} pl · {nf(v.tons, 1)} t</span>
                <span className="tabular-nums font-medium whitespace-nowrap">{v.freight == null ? '—' : money(v.freight)}</span>
              </div>
            ))}
          </div>
        )}
        {t.ods.length > 0 && <div className="px-2 pt-0.5 flex flex-wrap gap-1">{catChips(catsByLoad(t.ods.map(o => o.cat_load)))}</div>}
        <div className="px-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <DispatchCarrierPicker trip={t} editable={ed} busy={patchTrip.isPending}
              onPick={id => patchTrip.mutateAsync({ id: t.id, transport_company_id: id }).then(() => setJustHit(t.id)).catch(e => err(e, 'Không đổi được ĐVVT'))} />
          </div>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums" title={t.detail.freight.reason ?? undefined}>{t.freight_estimated == null ? <span className="font-normal text-amber-700">chưa có cước</span> : money(t.freight_estimated)}</span>
        </div>
        <div className="px-2 pt-1">{loadBar(t)}</div>
        {/* gợi ý gộp của máy cho xe Non tải (30/09: trước chỉ có ở Danh sách xe, bàn ghép không thấy) */}
        {t.underload && t.detail.merge_hint && <div className="mx-2 mt-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900 leading-snug break-words">{t.detail.merge_hint}</div>}
        {mixSwitch(t)}
        {t.ods.length > 0 && (
          <div className="px-2 pt-0.5 text-[10px] text-slate-600 leading-snug">
            <span className={lim != null && t.stops > lim ? 'text-red-600 font-semibold' : ''}>{t.stops}{lim != null ? `/${lim}` : ''} điểm</span>
            <span className="text-slate-300"> · </span>
            <span className="break-words">{t.wards.join(', ') || '—'}</span>
          </div>
        )}
        <div className="px-1 pt-1 pb-1.5 space-y-0.5 flex-1">
          {t.ods.map(o => odRow(o, true))}
        </div>
        {isHover && hover && preview(hover)}
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-0 h-full">
      {/* ── KHUNG CHỜ ── */}
      {/* KHUNG CHỜ THU GỌN được thành một rãnh 36 px (desktop) để bàn thẻ xe rộng hết màn — vẫn là ô thả "về khung chờ" */}
      {poolRail ? (
        <aside data-dispatch-pool {...dropProps('pool', 'pool')}
          className={`hidden lg:flex w-9 shrink-0 border-r flex-col items-center gap-2 py-2 ${hover?.target === 'pool' ? 'bg-sky-50 ring-2 ring-inset ring-sky-400' : 'bg-slate-50'}`}>
          <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-200" title="Mở khung chờ" onClick={() => setF({ poolHidden: false })}><ChevronsRight className="h-4 w-4" /></button>
          <Inbox className="h-4 w-4 text-slate-500" />
          <span className="text-[10px] font-semibold text-slate-600 [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">Khung chờ · {nf(plan.summary.pool_ods ?? pool.length)} OD</span>
        </aside>
      ) : (
      <aside data-dispatch-pool {...dropProps('pool', 'pool')}
        className={`lg:w-[300px] shrink-0 border-b lg:border-b-0 lg:border-r flex flex-col min-h-0 ${hover?.target === 'pool' ? 'bg-sky-50 ring-2 ring-inset ring-sky-400' : 'bg-slate-50/60'}`}>
        <div className="px-3 py-1.5 border-b bg-white space-y-1 shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="text-xs font-semibold text-slate-700">Khung chờ</span>
            <span className="text-[11px] text-slate-500 tabular-nums">{nf(plan.summary.pool_ods ?? pool.length)} OD · {nf(plan.summary.pool_pallets ?? 0, 1)} pl</span>
            <button type="button" className="ml-auto hidden lg:inline-flex rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Thu gọn khung chờ — bàn thẻ xe rộng hơn" onClick={() => setF({ poolHidden: true })}><ChevronsLeft className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-400">Gom theo</span>
            {([['ward', 'Phường'], ['region', 'Vùng'], ['customer', 'Khách']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setF({ boardGroup: k })}
                className={`rounded px-1.5 py-0.5 ${f.boardGroup === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>
            ))}
            {poolShown.length > 0 && editable && (
              <button type="button" className="ml-auto text-[10px] text-sky-700 hover:underline whitespace-nowrap" onClick={() => toggleMany(poolShown.map(o => o.id))}>
                {poolShown.every(o => sel.has(o.id)) ? 'Bỏ chọn' : 'Chọn hết'}
              </button>
            )}
          </div>
          {poolNotes > 0 && (
            <button type="button" onClick={() => setNotesOnly(v => !v)} aria-pressed={notesOnly}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${notesOnly ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-900 hover:bg-amber-100'}`}
              title="OD có ghi chú giao hàng từ SAP — đọc trước khi ghép (hẹn ngày khác, không nhận Chủ nhật, ghép xe riêng…)">
              <StickyNote className="h-3 w-3" /> {notesOnly ? 'Đang xem' : 'Chỉ'} {poolNotes} OD có ghi chú
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
                  <span className="text-[11px] font-semibold text-slate-700 break-words flex-1 min-w-0">{g.k}</span>
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
                  {showSide === 'excluded' && <ul className="px-2 pb-1.5 space-y-0.5 max-h-48 overflow-auto">{excluded.map(x => (
                    <li key={x.od_number} className="flex items-start gap-1">
                      <span className="min-w-0 flex-1 break-words"><span className="font-mono">{x.od_number}</span> — {x.kind === 'HELD' ? (x.info ?? EX_VI.HELD) : <>{EX_VI[x.kind] ?? x.kind}{x.info ? ` (${x.info})` : ''}</>}</span>
                      {x.kind === 'HELD' && editable && <button type="button" className="shrink-0 text-[10px] font-medium text-sky-700 hover:underline" disabled={unhold.isPending} onClick={() => void doUnhold(x.od_number)}>Chuyển lại Điều</button>}
                    </li>
                  ))}</ul>}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
      )}

      {/* ── LƯỚI THẺ XE — nhóm theo DÒNG XE CHA, đóng mặc định (user 25/09 tối: "sắp xếp group theo thứ tự CHA, mở thì
          mới ra — mục tiêu để tập trung xem khi cần"); trong nhóm là các dòng xe CON ── */}
      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="px-3 py-1.5 border-b bg-white flex items-center gap-2 flex-wrap shrink-0">
          <SearchInput value={f.search} onChange={v => setF({ search: v })} placeholder="Tìm Số xe, OD, khách, phường…" className="flex-1 min-w-[140px]" />
          {/* NHÓM thẻ xe: Vùng (mặc định — xe cùng khách nằm cạnh nhau) | Loại xe */}
          <div className="flex items-center gap-1 text-[10px] shrink-0" title="Nhóm thẻ xe theo vùng (xe cùng khách nằm cạnh nhau) hay theo loại xe">
            <span className="text-slate-400">Nhóm</span>
            {([['region', 'Vùng'], ['vtype', 'Loại xe']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setF({ boardTripGroup: k, boardOpen: [] })}
                className={`rounded px-1.5 py-0.5 ${(f.boardTripGroup || 'region') === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>
            ))}
          </div>
          {/* DẢI % TẢI đang áp (01/10, user: "config chọn xong hiện lên trên bàn") — bấm để đổi ngay trên kế hoạch */}
          <DispatchLoadBandChip plan={plan} editable={editable} />
          <div className="w-36 shrink-0" title="Sắp xếp thẻ xe trong nhóm — sắp lại ngay sau mỗi lần thả; xe vừa nhận OD được tô viền xanh">
            <SingleSelect value={f.boardSort} onChange={v => setF({ boardSort: v || 'region' })} searchable={false}
              options={[
                { value: 'region', label: 'Phường → khách' },
                { value: 'todo', label: 'Cần xử lý trước' },
                { value: 'load', label: 'Tải thấp trước' },
                { value: 'freight', label: 'Cước cao trước' },
                { value: 'seq', label: 'Số xe' },
              ]} />
          </div>
          {tripGroups.length > 1 && !forceOpen && (
            <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 h-9 sm:h-7 text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200 whitespace-nowrap"
              onClick={() => setF({ boardOpen: allOpen ? [] : tripGroups.map(g => g.k) })}>
              {allOpen ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}{allOpen ? 'Thu hết' : 'Mở hết'}
            </button>
          )}
          {/* ô thả "xe mới" là một dải nhỏ trên thanh công cụ, không chiếm một ô thẻ trong lưới */}
          {canDrag && (
            <div {...dropProps('new', 'new')} title="Thả OD vào đây — máy chọn dòng xe + ĐVVT theo luật ghép"
              className={`inline-flex items-center gap-1 rounded-md border-2 border-dashed px-2 h-7 text-[11px] font-medium whitespace-nowrap ${hover?.target === 'new' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-300 text-slate-500'}`}>
              <Plus className="h-3.5 w-3.5" /> Xe mới
            </div>
          )}
          {shownTrips.length !== trips.length && <span className="text-[11px] text-slate-500 whitespace-nowrap">{shownTrips.length}/{trips.length} xe</span>}
          <ActionCluster items={actions} mobileInline />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 pb-24 lg:pb-3 space-y-2">
          {tripGroups.map(g => {
            const open = forceOpen || openSet.has(g.k)
            return (
              <div key={g.k} className="rounded-lg border border-slate-200 bg-slate-50/70">
                <button type="button" onClick={() => toggleGroup(g.k)} aria-expanded={open}
                  onDragOver={canDrag && !open ? e => { if (e.dataTransfer.types.includes(DRAG_MIME)) armOpen(g.k) } : undefined}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left ${open ? 'border-b border-slate-200' : ''} hover:bg-slate-100 rounded-t-lg`}>
                  {open ? <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />}
                  <span className={`text-xs font-semibold uppercase tracking-wide ${g.k === NO_MODEL ? 'text-red-700' : 'text-slate-700'}`}>{g.label}</span>
                  <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{g.trips.length} xe · {nf(g.pallets, 1)} pl · {nf(g.tons, 1)} t</span>
                  {g.todo > 0 && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800 whitespace-nowrap">{g.todo} cần xử lý</span>}
                  {g.over > 0 && <span className="rounded bg-red-100 px-1.5 text-[10px] font-medium text-red-700 whitespace-nowrap">{g.over} vượt tải</span>}
                  <span className="ml-auto text-[11px] font-semibold tabular-nums text-slate-700 whitespace-nowrap">{money(g.freight)}</span>
                </button>
                {open && (
                  <div className="p-2 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                    {g.trips.map(t => tripCard(t))}
                  </div>
                )}
              </div>
            )
          })}
          {!shownTrips.length && trips.length > 0 && (
            <p className="py-8 text-center text-xs text-slate-400">Không xe nào khớp bộ lọc. <button type="button" className="text-sky-700 underline" onClick={() => setF({ issue: '', search: '' })}>Xem tất cả {trips.length} xe</button></p>
          )}
        </div>
      </section>

      <FloatingActionBar count={selIds.length} unit="OD đã chọn">
        <Button size="sm" variant="outline" className={FLOATING_BTN} onClick={() => { setMoveTarget(''); setMoveDlg(true) }}>Chuyển tới xe…</Button>
        {poolSel.length > 0 && poolSel.length === selIds.length && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={reopt.isPending || busy} onClick={() => void doReoptSel()}><Sparkles className="h-3.5 w-3.5 mr-1" />{reopt.isPending ? 'Đang ghép…' : 'Ghép phần đã chọn'}</Button>}
        {selIds.some(id => tripOf.get(id)) && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => void run(selIds.filter(id => tripOf.get(id)), 'pool')}>Về khung chờ</Button>}
        {/* "Bỏ khỏi kế hoạch" (tạm, không nằm ở tab nào) đã bỏ 27/09 tối — đơn không đi là "Không điều ngày này" */}
        <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => openHold('date')}><CalendarClock className="h-3.5 w-3.5 mr-1" />Không điều ngày này</Button>
        <Button size="sm" variant="outline" className={FLOATING_BTN_DANGER} disabled={busy} onClick={() => openHold('never')}><Ban className="h-3.5 w-3.5 mr-1" />Không điều</Button>
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
      <Dialog open={holdDlg} onOpenChange={o => { if (!o && !hold.isPending) setHoldDlg(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">{holdMode === 'date' ? 'Không điều ngày này' : 'Không điều'} — {uniqStr(selIds.map(id => rowBy.get(id)?.od_number ?? '')).length} OD</DialogTitle></DialogHeader>
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-1 rounded border border-slate-200 p-0.5">
              {([['date', 'Không điều ngày này'], ['never', 'Không điều']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setHoldMode(k)} aria-pressed={holdMode === k}
                  className={`rounded px-2 py-1.5 ${holdMode === k ? 'bg-sky-100 text-sky-800 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
              ))}
            </div>
            {holdMode === 'date'
              ? <label className="block">Điều lại từ ngày <input type="date" className="ml-2 h-8 rounded border border-slate-300 px-2" value={holdUntil} min={(() => { const d = new Date(`${plan.plan_date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()} onChange={e => setHoldUntil(e.target.value)} /></label>
              : <p className="text-slate-500">OD không vào đợt ghép nào — kể cả các ngày sau — tới khi có người chuyển lại Điều (tab Xem đơn).</p>}
            <label className="block">
              <span className="text-slate-600">Lý do (tuỳ chọn)</span>
              <textarea className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" rows={2} maxLength={500} value={holdReason} onChange={e => setHoldReason(e.target.value)} placeholder="vd NPP hẹn giao 10/9 · trả hoá đơn, hàng không đi" />
            </label>
            <p className="text-[11px] text-slate-500">OD rời kế hoạch này (mọi phần nếu đang tách) và KHÔNG quay lại khi ZSD02 nạp lại / lập lại.</p>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8" disabled={hold.isPending} onClick={() => setHoldDlg(false)}>Huỷ</Button>
            <Button size="sm" className="h-8" disabled={hold.isPending || (holdMode === 'date' && !holdUntil)} onClick={doHold}>{hold.isPending ? 'Đang lưu…' : 'Chuyển'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DispatchLoadBandDialog open={reoptDlg} onClose={() => setReoptDlg(false)} title="Tối ưu lại phần chưa khoá" confirmLabel="Tối ưu lại"
        intro={`Máy ghép lại các OD ở khung chờ (${nf(plan.summary.pool_ods ?? 0)} OD) + mọi xe CHƯA KHOÁ còn sửa được theo dải % tải dưới đây.\n${lockedN ? `${lockedN} xe đã khoá giữ nguyên.` : 'Chưa khoá xe nào — khoá (🔒) những xe đã ưng trước khi bấm để máy không đụng vào.'}\nThao tác này KHÔNG hoàn tác được bằng Ctrl+Z.`}
        parents={bandParents} initial={{ bands: fullBands(bandParents, plan.params.load_bands, plan.params.underload_pct), bypass: plan.params.load_bypass === true }} busy={reopt.isPending}
        onConfirm={doReoptWith} />
      <DispatchCustomerVehiclesSheet planId={plan.id} shipTo={custSheet} canEdit={canCustVeh && editable} onClose={() => setCustSheet(null)} />
      {confirmNode}
    </div>
  )
}
