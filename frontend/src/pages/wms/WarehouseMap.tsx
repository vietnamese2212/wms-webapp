// SƠ ĐỒ KHO bản một (08/09/2026) — bản vẽ 2D nhìn từ trên xuống, 1 ô lưới = 1 chân pallet.
// User chốt sau 8 vòng brainstorm: 2D là CHÍNH (vẽ, mọi lớp phủ, PDA), 3D chỉ là góc nhìn phụ (đợt sau).
// Các TẦNG của cùng chân kệ (A12_T1..T4) dùng CHUNG một ô — bấm ô mở "cột tầng" ở pane phải.
// VỊ TRÍ KÉO DÀI THEO SỨC CHỨA (user 08/09, theo bản vẽ Excel của kho: dãy 43 pallet = vệt 43 ô, mỗi ô một dấu ×):
// khi đặt/rải, khối mặc định = max_pallets × 1 theo hướng chọn; lớp phủ Tồn tô từng ô pallet có hàng.
// Ô có vị trí chứa hàng hoặc tường = chắn; ô trống/cửa/bãi/điểm đầu dãy = lối đi ⇒ đường đi = BFS
// (utils/warehouseGrid — cùng bản với backend). Không lưu khoảng cách: bản vẽ là nguồn duy nhất.
//
// Ba lớp phủ: Tồn theo ô · Đường đi (từ một cửa tới ô đang chọn) · Không.
// Trình vẽ (quyền warehouse_map.edit, chỉ desktop): dựng khung, rải dãy bằng một vệt kéo, đặt lẻ, tô tường
// (bấm hoặc kéo vệt), chấm cửa/bãi/điểm đầu dãy, gợi ý điểm đầu dãy, gỡ, đánh Kệ/Sàn cả chân kệ.
// Chọn nhiều (Ctrl+bấm · Shift+kéo khung · Ctrl+A) · dời bằng mũi tên · Delete gỡ · Hoàn tác/Làm lại (Ctrl+Z/Y,
// 50 bước): mọi thao tác ghi máy chủ đều kèm bước ngược; gỡ cửa hoàn tác được vì BE hồi sinh dòng mềm cùng mã.
// Khung + tường là NHÁP cục bộ tới khi "Lưu khung" — chỉ reset khi bản khung đã lưu trên máy chủ đổi, KHÔNG reset
// theo mỗi lần refetch (đặt một chân kệ xong mà mất tường đang tô là bẫy bản đầu).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { Map as MapIcon, Pencil, Eye, Save, Maximize2, MousePointer2, Grid3x3, Brush, DoorOpen, Eraser, Sparkles, Trash2, X, Package, BookOpen, Undo2, Redo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import { SearchInput } from '@/components/shared/SearchInput'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { WarehouseMapGuide } from '@/components/wms/WarehouseMapGuide'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { toast } from '@/components/ui/use-toast'
import { formatDateTime } from '@/utils/formatters'
import {
  useWarehouseMap, useWarehouseMapOccupancy, useWarehouseMapFind,
  useSaveMapFrame, useAssignCells, useSetFootprintRack, useCreateMapObject, useRenameMapObject, useDeleteMapObject,
  type MapLoc, type MapKind, type MapOccupancy, type CellAssign,
} from '@/api/warehouseMap'
import {
  buildBlockedMask, bfsFrom, pathToCells, distanceToCells, footprintCells, footprintKeyOf, lineCells, naturalCompare, inFrame,
  type GridFrame, type GridCell,
} from '@/utils/warehouseGrid'

const nf = new Intl.NumberFormat('vi-VN')
function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// ─── Kiểu dữ liệu dẫn xuất ──────────────────────────────────────────────────────────────────────
// Chân kệ = nhóm vị trí dùng chung một ô lưới (các tầng). Cửa/bãi/điểm hạ = chân riêng.
interface Footprint {
  key: string
  kind: MapKind
  sub_code: string
  label: string            // mã dãy (row) — hiện trên ô
  code: string             // mã vị trí đại diện (tầng 1 hoặc dòng đầu)
  locs: MapLoc[]           // sắp theo tầng TĂNG (T1 trước)
  anchor: GridCell | null
  w: number; h: number
  is_rack: boolean
  cells: GridCell[]
}
type Tool = 'select' | 'place' | 'line' | 'wall' | 'object' | 'erase'
type Overlay = 'stock' | 'path' | 'none'
type Dir = 'R' | 'L' | 'D' | 'U'
interface Rect { x: number; y: number; w: number; h: number }
interface HistEntry { label: string; undo: () => Promise<unknown>; redo: () => Promise<unknown> }
type ClickMods = { ctrl: boolean }

const KIND_LABEL: Record<MapKind, string> = { STORAGE: 'Ô chứa hàng', DOCK_OUT: 'Cửa / bãi xuất', DOCK_IN: 'Cửa / bãi nhập', DROP: 'Điểm đầu dãy' }
const KIND_COLOR: Record<Exclude<MapKind, 'STORAGE'>, string> = { DOCK_OUT: '#22c55e', DOCK_IN: '#3b82f6', DROP: '#f59e0b' }
// Bảng màu khu (tông nhẹ, phân biệt được ~8 khu; vượt thì lặp)
const ZONE_PALETTE = ['#bae6fd', '#bbf7d0', '#fde68a', '#fecaca', '#ddd6fe', '#fbcfe8', '#a7f3d0', '#fed7aa']
const DIRS: { d: Dir; label: string; tip: string }[] = [
  { d: 'R', label: '→', tip: 'Dãy kéo dài sang phải từ ô đầu' }, { d: 'L', label: '←', tip: 'Dãy kéo dài sang trái' },
  { d: 'D', label: '↓', tip: 'Dãy kéo dài xuống dưới' }, { d: 'U', label: '↑', tip: 'Dãy kéo dài lên trên' },
]
const DIR_VEC: Record<Dir, GridCell> = { R: { x: 1, y: 0 }, L: { x: -1, y: 0 }, D: { x: 0, y: 1 }, U: { x: 0, y: -1 } }
const HIST_MAX = 50

// Tô theo % đầy (lớp Tồn theo ô khi thu nhỏ — không còn nhìn ra từng ô pallet): 0 → trắng, tăng dần tông sky
function stockColor(ratio: number): string {
  if (ratio <= 0) return '#ffffff'
  if (ratio < 0.25) return '#e0f2fe'
  if (ratio < 0.5) return '#bae6fd'
  if (ratio < 0.75) return '#7dd3fc'
  if (ratio < 1) return '#38bdf8'
  return '#0284c7'
}
function rectCells(r: Rect): GridCell[] {
  const out: GridCell[] = []
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y })
  return out
}
// Sức chứa vẽ = số pallet tối đa lớn nhất trong các tầng của chân kệ (ô kệ 1 pallet/tầng → 1 ô; sàn 43 → 43 ô)
function capLen(f: Footprint): number {
  return Math.min(100, Math.max(1, ...f.locs.map(l => (l.max_pallets > 0 ? l.max_pallets : 0))))
}
// Vệt pallet từ ô đầu theo hướng, dài tối đa `len`, dừng ở mép khung / ô không trống. null = chính ô đầu không trống.
function stripFrom(head: GridCell, len: number, dir: Dir, frame: GridFrame, isFree: (c: GridCell) => boolean): Rect | null {
  const v = DIR_VEC[dir]
  let n = 0
  for (; n < len; n++) {
    const c = { x: head.x + v.x * n, y: head.y + v.y * n }
    if (!inFrame(frame, c.x, c.y) || !isFree(c)) break
  }
  if (n === 0) return null
  const end = { x: head.x + v.x * (n - 1), y: head.y + v.y * (n - 1) }
  return { x: Math.min(head.x, end.x), y: Math.min(head.y, end.y), w: Math.abs(end.x - head.x) + 1, h: Math.abs(end.y - head.y) + 1 }
}
// Khối cố định w×h neo tại ô đầu — chỉ đặt khi trọn khối trống và nằm trong khung
function blockAt(head: GridCell, w: number, h: number, frame: GridFrame, isFree: (c: GridCell) => boolean): Rect | null {
  const r = { x: head.x, y: head.y, w, h }
  if (r.x + w > frame.width || r.y + h > frame.height) return null
  return rectCells(r).every(isFree) ? r : null
}

function useIsLg() {
  const [lg, setLg] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)')
    const on = () => setLg(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return lg
}

function groupFootprints(locs: MapLoc[]): Footprint[] {
  const map = new Map<string, MapLoc[]>()
  for (const l of locs) {
    const k = footprintKeyOf(l)
    const arr = map.get(k)
    if (arr) arr.push(l); else map.set(k, [l])
  }
  const out: Footprint[] = []
  for (const [key, arr] of map) {
    arr.sort((a, b) => (a.level_no ?? 0) - (b.level_no ?? 0) || a.location_code.localeCompare(b.location_code))
    // Neo/kích thước lấy từ dòng ĐÃ ĐẶT (tầng nào cũng chung một ô — dòng nào có toạ độ là đúng)
    const placed = arr.find(l => l.grid_x != null && l.grid_y != null)
    const first = arr[0]
    const w = placed?.grid_w ?? 1, h = placed?.grid_h ?? 1
    const anchor = placed ? { x: placed.grid_x as number, y: placed.grid_y as number } : null
    out.push({
      key, kind: first.kind, sub_code: first.sub_code ?? '', label: first.row ?? first.location_code, code: first.location_code,
      locs: arr, anchor, w, h, is_rack: arr.some(l => l.is_rack),
      cells: placed ? footprintCells({ grid_x: placed.grid_x, grid_y: placed.grid_y, grid_w: w, grid_h: h, kind: first.kind }) : [],
    })
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
export default function WarehouseMap() {
  const navigate = useNavigate()
  const isLg = useIsLg()
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canEdit = isAdmin(user) || can(perms, 'warehouse_map', 'edit')

  const { warehouseId, zones, overlay } = useWmsFilterStore(s => s.warehouseMap)
  const setWM = useWmsFilterStore(s => s.setWarehouseMap)
  const setInventory = useWmsFilterStore(s => s.setInventory)
  const { data: rawWarehouses = [] } = useScopedWarehouses(true)
  const warehouses = rawWarehouses as { id: string; name: string }[]
  const effectiveWhId = warehouseId && warehouses.some(w => w.id === warehouseId) ? warehouseId : (warehouses[0]?.id ?? '')
  useEffect(() => { if (effectiveWhId && effectiveWhId !== warehouseId) setWM({ warehouseId: effectiveWhId }) }, [effectiveWhId, warehouseId, setWM])

  const mapQ = useWarehouseMap(effectiveWhId)
  const data = mapQ.data
  const dataRef = useRef(data); dataRef.current = data
  const locsRef = useRef<MapLoc[]>([]); locsRef.current = data?.locations ?? []
  const occQ = useWarehouseMapOccupancy(effectiveWhId, !!data)
  const occByLoc = useMemo(() => new Map((occQ.data ?? []).map(o => [o.location_id, o])), [occQ.data])

  const [search, setSearch] = useState('')
  const searchDeb = useDebouncedValue(search, 300)
  const findQ = useWarehouseMapFind(effectiveWhId, searchDeb)
  const hitLocIds = useMemo(() => new Set((findQ.data ?? []).map(h => h.location_id)), [findQ.data])

  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!canEdit || !isLg) setEditing(false) }, [canEdit, isLg])
  const [tool, setTool] = useState<Tool>('select')
  const [placingKey, setPlacingKey] = useState<string | null>(null)
  const [lineZone, setLineZone] = useState<string | null>(null)
  const [byCapacity, setByCapacity] = useState(true)
  const [dir, setDir] = useState<Dir>('R')
  const [span, setSpan] = useState({ w: 1, h: 1 })
  const [err, setErr] = useState<string | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)

  // Khung NHÁP khi sửa (kích thước + tường) — lưu một lần bằng nút Lưu khung. Chỉ đồng bộ lại từ máy chủ khi
  // BẢN ĐÃ LƯU đổi (đổi kho / người khác lưu), không theo mỗi refetch do đặt vị trí.
  const [draft, setDraft] = useState<{ width: number; height: number; cell_m: number; blocked: [number, number][] } | null>(null)
  const savedKey = data ? `${data.warehouse.id}|${data.map ? JSON.stringify([data.map.width, data.map.height, Number(data.map.cell_m), data.map.blocked ?? []]) : 'none'}` : ''
  useEffect(() => {
    const d = dataRef.current
    if (!d) return
    setDraft(d.map ? { width: d.map.width, height: d.map.height, cell_m: Number(d.map.cell_m), blocked: d.map.blocked ?? [] }
                   : { width: 60, height: 40, cell_m: 1.2, blocked: [] })
  }, [savedKey])
  const frame: GridFrame | null = draft ? { width: draft.width, height: draft.height } : null
  const hasSavedFrame = !!data?.map
  const frameDirty = !!(data && draft && (!data.map || data.map.width !== draft.width || data.map.height !== draft.height
    || Number(data.map.cell_m) !== draft.cell_m || JSON.stringify(data.map.blocked ?? []) !== JSON.stringify(draft.blocked)))

  const footprints = useMemo(() => groupFootprints(data?.locations ?? []), [data])
  const fpByKey = useMemo(() => new Map(footprints.map(f => [f.key, f])), [footprints])
  const zoneList = useMemo(() => [...new Set(footprints.filter(f => f.kind === 'STORAGE').map(f => f.sub_code))].sort(naturalCompare), [footprints])
  const zoneColor = useMemo(() => new Map(zoneList.map((z, i) => [z, ZONE_PALETTE[i % ZONE_PALETTE.length]])), [zoneList])
  const placed = useMemo(() => footprints.filter(f => f.anchor), [footprints])
  const unplaced = useMemo(() => footprints.filter(f => !f.anchor && f.kind === 'STORAGE').sort((a, b) => naturalCompare(a.sub_code, b.sub_code) || naturalCompare(a.label, b.label)), [footprints])
  const objects = useMemo(() => footprints.filter(f => f.kind !== 'STORAGE'), [footprints])
  // Ô → chân kệ (tra khi bấm)
  const cellOwner = useMemo(() => {
    const m = new Map<string, Footprint>()
    for (const f of placed) for (const c of f.cells) m.set(`${c.x},${c.y}`, f)
    return m
  }, [placed])
  const blockedSet = useMemo(() => new Set((draft?.blocked ?? []).map(([x, y]) => `${x},${y}`)), [draft?.blocked])
  const mask = useMemo(() => frame ? buildBlockedMask(frame, draft?.blocked ?? [], data?.locations ?? []) : null, [frame, draft?.blocked, data?.locations])

  // Chọn (một hoặc nhiều chân kệ) + đường đi từ cửa (chỉ khi chọn đúng một)
  const [selKeys, setSelKeys] = useState<string[]>([])
  const selectedMany = useMemo(() => selKeys.map(k => fpByKey.get(k)).filter((f): f is Footprint => !!f), [selKeys, fpByKey])
  const selected = selectedMany.length === 1 ? selectedMany[0] : null
  const selKeySet = useMemo(() => new Set(selectedMany.map(f => f.key)), [selectedMany])
  const doors = useMemo(() => objects.filter(o => o.anchor && (o.kind === 'DOCK_OUT' || o.kind === 'DOCK_IN')), [objects])
  const [doorKey, setDoorKey] = useState<string>('')
  const door = (doorKey && fpByKey.get(doorKey)) || doors.find(d => d.kind === 'DOCK_OUT') || doors[0] || null
  const bfs = useMemo(() => (frame && mask && door?.anchor) ? bfsFrom(frame, mask, door.anchor) : null, [frame, mask, door])
  const path = useMemo(() => (frame && mask && bfs && selected?.anchor && overlay === 'path') ? pathToCells(frame, mask, bfs, selected.cells) : [], [frame, mask, bfs, selected, overlay])
  const selDist = (frame && mask && bfs && selected?.anchor) ? distanceToCells(frame, mask, bfs.dist, selected.cells) : -1

  // Mutations
  const saveFrame = useSaveMapFrame(effectiveWhId)
  const assign = useAssignCells(effectiveWhId)
  const setRack = useSetFootprintRack(effectiveWhId)
  const createObj = useCreateMapObject(effectiveWhId)
  const renameObj = useRenameMapObject(effectiveWhId)
  const deleteObj = useDeleteMapObject(effectiveWhId)
  const [histBusy, setHistBusy] = useState(false)
  const busy = saveFrame.isPending || assign.isPending || setRack.isPending || createObj.isPending || deleteObj.isPending || histBusy

  // ── Lịch sử Hoàn tác / Làm lại: mỗi thao tác ghi máy chủ (hoặc sửa nháp) đẩy một cặp undo/redo ──
  const undoRef = useRef<HistEntry[]>([])
  const redoRef = useRef<HistEntry[]>([])
  const [hist, setHist] = useState<{ undo: string | null; redo: string | null }>({ undo: null, redo: null })
  const bumpHist = () => setHist({ undo: undoRef.current[undoRef.current.length - 1]?.label ?? null, redo: redoRef.current[redoRef.current.length - 1]?.label ?? null })
  function pushHist(e: HistEntry) {
    undoRef.current.push(e)
    if (undoRef.current.length > HIST_MAX) undoRef.current.shift()
    redoRef.current = []
    bumpHist()
  }
  useEffect(() => { undoRef.current = []; redoRef.current = []; setHist({ undo: null, redo: null }); setSelKeys([]) }, [effectiveWhId])
  async function runHist(kind: 'undo' | 'redo') {
    const from = kind === 'undo' ? undoRef.current : redoRef.current
    const to = kind === 'undo' ? redoRef.current : undoRef.current
    const e = from.pop()
    if (!e) return
    setErr(null); setHistBusy(true)
    try {
      await (kind === 'undo' ? e.undo() : e.redo())
      to.push(e)
      toast({ title: `${kind === 'undo' ? 'Đã hoàn tác' : 'Đã làm lại'}: ${e.label}` })
    } catch (er) {
      from.push(e)
      setErr(`${kind === 'undo' ? 'Không hoàn tác được' : 'Không làm lại được'} "${e.label}": ${apiMsg(er)}`)
    } finally { setHistBusy(false); bumpHist() }
  }

  // Gán ô theo lô — ghi nhớ toạ độ CŨ của đúng các dòng bị đụng để hoàn tác
  async function runAssign(items: CellAssign[], okMsg: string, label: string) {
    setErr(null)
    const byId = new Map(locsRef.current.map(l => [l.id, l]))
    const before: CellAssign[] = items.map(i => {
      const l = byId.get(i.location_id)
      return { location_id: i.location_id, grid_x: l?.grid_x ?? null, grid_y: l?.grid_y ?? null, grid_w: l?.grid_w ?? 1, grid_h: l?.grid_h ?? 1 }
    })
    try {
      const r = await assign.mutateAsync(items)
      toast({ title: okMsg, description: `${nf.format(r.updated)} dòng vị trí đã cập nhật` })
      pushHist({ label, undo: () => assign.mutateAsync(before), redo: () => assign.mutateAsync(items) })
    } catch (e) { setErr(apiMsg(e)) }
  }
  const isFreeCell = (c: GridCell) => { const k = `${c.x},${c.y}`; return !cellOwner.has(k) && !blockedSet.has(k) }
  function placeFootprint(f: Footprint, at: GridCell) {
    if (!frame) return
    const cap = capLen(f)
    const rect = f.kind === 'STORAGE' && !byCapacity ? blockAt(at, span.w, span.h, frame, isFreeCell)
      : stripFrom(at, f.kind === 'STORAGE' ? cap : 1, dir, frame, isFreeCell)
    if (!rect) { setErr(byCapacity ? 'Ô này không trống' : `Khối ${span.w}×${span.h} tại ô này chạm mép khung hoặc ô đã có — chọn ô khác hay đổi khối`); return }
    const cut = byCapacity && f.kind === 'STORAGE' && rect.w * rect.h < cap ? ` (cắt ngắn còn ${rect.w * rect.h}/${cap} ô — chạm mép hoặc ô đã có)` : ''
    void runAssign(f.locs.map(l => ({ location_id: l.id, grid_x: rect.x, grid_y: rect.y, grid_w: rect.w, grid_h: rect.h })), `Đã đặt ${f.label}${cut}`, `Đặt ${f.label}`)
  }
  function unplaceMany(fs: Footprint[]) {
    const storage = fs.filter(f => f.kind === 'STORAGE' && f.anchor)
    const objs = fs.filter(f => f.kind !== 'STORAGE')
    if (fs.length === 1 && objs.length === 1) { deleteObject(objs[0]); return }
    if (!storage.length) { setErr('Cửa / bãi gỡ từng cái: chọn một cửa rồi bấm Gỡ, hoặc dùng công cụ Gỡ'); return }
    void runAssign(storage.flatMap(f => f.locs.map(l => ({ location_id: l.id, grid_x: null, grid_y: null }))),
      storage.length === 1 ? `Đã gỡ ${storage[0].label} khỏi bản vẽ` : `Đã gỡ ${storage.length} chân kệ khỏi bản vẽ${objs.length ? ` · ${objs.length} cửa/bãi giữ nguyên` : ''}`,
      storage.length === 1 ? `Gỡ ${storage[0].label}` : `Gỡ ${storage.length} chân kệ`)
    setSelKeys([])
  }
  // Dời cả nhóm đang chọn (mũi tên) — RPC kiểm trùng với các chân kệ NGOÀI nhóm, trong nhóm dời cùng nhau nên không tự đè nhau
  function moveSelected(dx: number, dy: number) {
    if (!frame) return
    const fs = selectedMany.filter(f => f.anchor)
    if (!fs.length) return
    for (const f of fs) {
      const a = f.anchor as GridCell
      if (a.x + dx < 0 || a.y + dy < 0 || a.x + dx + f.w > frame.width || a.y + dy + f.h > frame.height) { setErr('Chạm mép khung — không dời được nhóm này'); return }
    }
    const items = fs.flatMap(f => f.locs.map(l => ({ location_id: l.id, grid_x: (f.anchor as GridCell).x + dx, grid_y: (f.anchor as GridCell).y + dy, grid_w: f.w, grid_h: f.h })))
    void runAssign(items, `Đã dời ${fs.length === 1 ? fs[0].label : `${fs.length} ô`}`, `Dời ${fs.length === 1 ? fs[0].label : `${fs.length} ô`}`)
  }
  // Rải dãy: mỗi ô của vệt là ĐẦU một dãy; dãy kéo dài theo sức chứa, VUÔNG GÓC với vệt (vệt dọc → dãy ngang)
  function spreadLine(zone: string, a: GridCell, b: GridCell) {
    if (!frame) return
    const group = unplaced.filter(f => f.sub_code === zone)
    if (!group.length) { setErr(`Khu ${zone} không còn chân kệ nào chưa đặt`); return }
    const heads = lineCells(a, b)
    const vertical = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x)
    let d: Dir = dir
    if (byCapacity) { if (vertical && (d === 'D' || d === 'U')) d = 'R'; if (!vertical && (d === 'R' || d === 'L')) d = 'D' }
    const taken = new Set<string>()
    const isFree = (c: GridCell) => isFreeCell(c) && !taken.has(`${c.x},${c.y}`)
    const items: CellAssign[] = []
    let n = 0, cut = 0, gi = 0
    for (const head of heads) {
      if (gi >= group.length) break
      const f = group[gi]
      const cap = capLen(f)
      const rect = byCapacity ? stripFrom(head, cap, d, frame, isFree) : blockAt(head, span.w, span.h, frame, isFree)
      if (!rect) continue                       // ô đầu không trống (hoặc khối không vừa) → thử ô kế tiếp trên vệt
      if (byCapacity && rect.w * rect.h < cap) cut++
      for (const c of rectCells(rect)) taken.add(`${c.x},${c.y}`)
      for (const l of f.locs) items.push({ location_id: l.id, grid_x: rect.x, grid_y: rect.y, grid_w: rect.w, grid_h: rect.h })
      n++; gi++
    }
    if (!n) { setErr('Vệt kéo không đi qua ô trống nào'); return }
    const left = group.length - n
    void runAssign(items,
      `Đã rải ${n} chân kệ khu ${zone}${left ? ` (còn ${left} chưa đặt — kéo vệt tiếp)` : ''}${cut ? ` · ${cut} dãy bị cắt ngắn vì chạm mép/ô đã có` : ''}`,
      `Rải ${n} chân kệ khu ${zone}`)
  }
  // Tường là nháp cục bộ — vẫn có hoàn tác (đổi mảng ô chắn)
  function setBlocked(next: [number, number][], label: string) {
    const prev = draft?.blocked ?? []
    setDraft(dr => dr ? { ...dr, blocked: next } : dr)
    pushHist({ label, undo: async () => setDraft(dr => dr ? { ...dr, blocked: prev } : dr), redo: async () => setDraft(dr => dr ? { ...dr, blocked: next } : dr) })
  }
  function toggleWall(c: GridCell) {
    const cur = draft?.blocked ?? []
    const has = cur.some(([x, y]) => x === c.x && y === c.y)
    setBlocked(has ? cur.filter(([x, y]) => !(x === c.x && y === c.y)) : [...cur, [c.x, c.y]], has ? `Xoá tường ô (${c.x}, ${c.y})` : `Tô tường ô (${c.x}, ${c.y})`)
  }
  function paintWallLine(a: GridCell, b: GridCell) {
    const cur = draft?.blocked ?? []
    const has = (c: GridCell) => cur.some(([x, y]) => x === c.x && y === c.y)
    const erase = has(a)                         // bắt đầu trên tường = vệt xoá; bắt đầu ở ô trống = vệt tô
    const cells = lineCells(a, b).filter(c => !cellOwner.has(`${c.x},${c.y}`))
    if (!cells.length) { setErr('Vệt đi qua toàn ô đang có vị trí — gỡ vị trí trước khi tô tường'); return }
    const next: [number, number][] = erase
      ? cur.filter(([x, y]) => !cells.some(c => c.x === x && c.y === y))
      : [...cur, ...cells.filter(c => !has(c)).map(c => [c.x, c.y] as [number, number])]
    setBlocked(next, erase ? `Xoá tường ${cells.length} ô` : `Tô tường ${cells.length} ô`)
  }
  function toggleRack(fs: Footprint[], v: boolean) {
    const ids = fs.flatMap(f => f.kind === 'STORAGE' ? f.locs.map(l => l.id) : [])
    if (!ids.length) { setErr('Chỉ ô chứa hàng mới có Kệ / Sàn'); return }
    setErr(null)
    const who = fs.length === 1 ? fs[0].label : `${fs.length} chân kệ`
    setRack.mutateAsync({ location_ids: ids, is_rack: v }).then(() => {
      toast({ title: `${who}: đánh là ${v ? 'KỆ' : 'SÀN'}` })
      pushHist({ label: `Đánh ${v ? 'KỆ' : 'SÀN'} ${who}`, undo: () => setRack.mutateAsync({ location_ids: ids, is_rack: !v }), redo: () => setRack.mutateAsync({ location_ids: ids, is_rack: v }) })
    }).catch(e => setErr(apiMsg(e)))
  }
  function renameObject(f: Footprint, name: string) {
    const id = f.locs[0].id, old = f.label
    setErr(null)
    renameObj.mutateAsync({ id, name }).then(() => {
      toast({ title: 'Đã đổi tên' })
      pushHist({ label: `Đổi tên ${old} → ${name}`, undo: () => renameObj.mutateAsync({ id, name: old }), redo: () => renameObj.mutateAsync({ id, name }) })
    }).catch(e => setErr(apiMsg(e)))
  }
  // Gỡ cửa/bãi (mềm ở BE). Hoàn tác = tạo lại cùng tên tại cùng ô → BE hồi sinh dòng cũ.
  function deleteObject(f: Footprint) {
    const kind = f.kind
    if (kind === 'STORAGE') return
    const l = f.locs[0], a = f.anchor
    setErr(null)
    deleteObj.mutateAsync(l.id).then(() => {
      toast({ title: `Đã gỡ ${f.label}` })
      if (a) {
        const body = { kind, name: f.label, grid_x: a.x, grid_y: a.y, grid_w: f.w, grid_h: f.h }
        let curId = l.id
        pushHist({ label: `Gỡ ${f.label}`, undo: () => createObj.mutateAsync(body).then(r => { curId = r.id }), redo: () => deleteObj.mutateAsync(curId) })
      }
      setSelKeys(s => s.filter(k => k !== f.key))
    }).catch(e => setErr(apiMsg(e)))
  }
  function viewStock(fs: Footprint[]) {
    const codes = fs.flatMap(f => f.kind === 'STORAGE' ? f.locs.map(l => l.location_code) : []).slice(0, 300)
    if (!codes.length) { setErr('Chọn ô chứa hàng để xem tồn'); return }
    setInventory({ warehouseIds: [effectiveWhId], filterLocations: codes, page: 1 })
    navigate('/wms/inventory')
  }

  // ── Sheet tạo cửa/bãi/điểm hạ ──
  const [objSheet, setObjSheet] = useState<{ at: GridCell } | null>(null)
  const [objForm, setObjForm] = useState<{ kind: Exclude<MapKind, 'STORAGE'>; name: string; w: number; h: number }>({ kind: 'DOCK_OUT', name: '', w: 1, h: 1 })
  async function submitObject() {
    if (!objSheet) return
    setErr(null)
    const body = { kind: objForm.kind, name: objForm.name.trim(), grid_x: objSheet.at.x, grid_y: objSheet.at.y, grid_w: objForm.w, grid_h: objForm.h }
    try {
      const created = await createObj.mutateAsync(body)
      toast({ title: `Đã tạo ${KIND_LABEL[objForm.kind].toLowerCase()} "${body.name}"` })
      let curId = created.id
      pushHist({ label: `Tạo ${KIND_LABEL[objForm.kind].toLowerCase()} ${body.name}`, undo: () => deleteObj.mutateAsync(curId), redo: () => createObj.mutateAsync(body).then(r => { curId = r.id }) })
      setObjSheet(null); setObjForm(f => ({ ...f, name: '' }))
    } catch (e) { setErr(apiMsg(e)) }
  }

  // ── Gợi ý điểm đầu dãy: dãy = vệt ≥3 chân kệ liên tiếp theo hàng/cột; đầu dãy = ô trống kề đầu vệt
  //    gần cửa xuất hơn. Người dùng tick rồi tạo — hệ thống không tự tạo.
  const [dropSuggest, setDropSuggest] = useState<{ at: GridCell; name: string; pick: boolean }[] | null>(null)
  function suggestDrops() {
    if (!frame || !mask) return
    const occ = new Map<string, Footprint>()
    for (const f of placed) if (f.kind === 'STORAGE') for (const c of f.cells) occ.set(`${c.x},${c.y}`, f)
    const existingDrops = new Set(objects.filter(o => o.kind === 'DROP' && o.anchor).map(o => `${o.anchor!.x},${o.anchor!.y}`))
    const distFromDoor = bfs?.dist ?? null
    const runs: { cells: GridCell[]; label: string }[] = []
    const scan = (horizontal: boolean) => {
      const outer = horizontal ? frame.height : frame.width, inner = horizontal ? frame.width : frame.height
      for (let o = 0; o < outer; o++) {
        let run: GridCell[] = []
        const flush = () => { if (run.length >= 3) runs.push({ cells: run, label: occ.get(`${run[0].x},${run[0].y}`)?.label ?? '' }); run = [] }
        for (let i = 0; i <= inner; i++) {
          const c = horizontal ? { x: i, y: o } : { x: o, y: i }
          if (i < inner && occ.has(`${c.x},${c.y}`)) run.push(c); else flush()
        }
      }
    }
    scan(true); scan(false)
    const seen = new Set<string>()
    const out: { at: GridCell; name: string; pick: boolean }[] = []
    for (const r of runs) {
      const a = r.cells[0], b = r.cells[r.cells.length - 1]
      const dd = a.x === b.x ? { x: 0, y: 1 } : { x: 1, y: 0 }
      const ends = [{ x: a.x - dd.x, y: a.y - dd.y }, { x: b.x + dd.x, y: b.y + dd.y }]
        .filter(c => inFrame(frame, c.x, c.y) && !mask[c.y * frame.width + c.x])
      if (!ends.length) continue
      ends.sort((p, q) => (distFromDoor ? (distFromDoor[p.y * frame.width + p.x] ?? 1e9) - (distFromDoor[q.y * frame.width + q.x] ?? 1e9) : 0))
      const head = ends[0]
      const k = `${head.x},${head.y}`
      if (seen.has(k) || existingDrops.has(k)) continue
      seen.add(k)
      out.push({ at: head, name: `Đầu dãy ${r.label}`.slice(0, 60), pick: true })
    }
    if (!out.length) setErr('Chưa nhận ra dãy nào (cần ≥3 chân kệ liên tiếp trên một hàng hoặc một cột, có ô trống ở đầu)')
    else setDropSuggest(out)
  }
  async function createDrops() {
    const picks = (dropSuggest ?? []).filter(s => s.pick)
    if (!picks.length) return
    setErr(null)
    const results = await Promise.allSettled(picks.map(s => createObj.mutateAsync({ kind: 'DROP', name: s.name, grid_x: s.at.x, grid_y: s.at.y })))
    const okN = results.filter(r => r.status === 'fulfilled').length
    const fails = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    toast({ title: `Đã tạo ${okN}/${picks.length} điểm đầu dãy` })
    if (fails.length) setErr(`Không tạo được ${fails.length} điểm: ${apiMsg(fails[0].reason)}`)
    const made = results.flatMap((r, i) => r.status === 'fulfilled' ? [{ id: r.value.id, body: { kind: 'DROP' as const, name: picks[i].name, grid_x: picks[i].at.x, grid_y: picks[i].at.y } }] : [])
    if (made.length) {
      const ids = made.map(m => m.id)
      pushHist({ label: `Tạo ${made.length} điểm đầu dãy`,
        undo: () => Promise.all(ids.map(id => deleteObj.mutateAsync(id))),
        redo: () => Promise.all(made.map((m, i) => createObj.mutateAsync(m.body).then(r => { ids[i] = r.id }))) })
    }
    setDropSuggest(null)
  }

  async function doSaveFrame() {
    if (!draft) return
    setErr(null)
    const before = data?.map ? { width: data.map.width, height: data.map.height, cell_m: Number(data.map.cell_m), blocked: data.map.blocked ?? [] } : null
    const next = { ...draft, blocked: [...draft.blocked] }
    try {
      await saveFrame.mutateAsync(next)
      toast({ title: 'Đã lưu khung bản vẽ' })
      if (before) pushHist({ label: 'Lưu khung', undo: () => saveFrame.mutateAsync(before), redo: () => saveFrame.mutateAsync(next) })
    } catch (e) { setErr(apiMsg(e)) }
  }

  // Canvas: bấm ô theo công cụ (Ctrl+bấm = thêm/bớt vào nhóm chọn)
  const fitRef = useRef<() => void>(() => {})
  function onCellClick(c: GridCell, mods: ClickMods) {
    const owner = cellOwner.get(`${c.x},${c.y}`)
    if (!editing || tool === 'select') {
      if (mods.ctrl) { if (owner) setSelKeys(s => s.includes(owner.key) ? s.filter(k => k !== owner.key) : [...s, owner.key]) }
      else setSelKeys(owner ? [owner.key] : [])
      return
    }
    if (tool === 'place') {
      const f = placingKey ? fpByKey.get(placingKey) : null
      if (!f) { setErr('Chọn một chân kệ ở danh sách "Chưa đặt" trước'); return }
      if (owner) { setErr(`Ô này đang là ${owner.label}`); return }
      placeFootprint(f, c)
      // đặt xong tự nhảy sang chân kệ kế tiếp cùng khu (đặt lẻ liên tiếp cho nhanh)
      const next = unplaced.find(u => u.key !== f.key && u.sub_code === f.sub_code)
      setPlacingKey(next?.key ?? null)
      return
    }
    if (tool === 'wall') {
      if (owner) { setErr('Ô này đang có vị trí — gỡ vị trí trước khi tô tường'); return }
      toggleWall(c)
      return
    }
    if (tool === 'object') {
      if (owner) { setErr(`Ô này đang là ${owner.label}`); return }
      setObjSheet({ at: c })
      return
    }
    if (tool === 'erase') {
      if (owner) { unplaceMany([owner]); return }
      if (blockedSet.has(`${c.x},${c.y}`)) toggleWall(c)
    }
  }
  function onLineDrag(a: GridCell, b: GridCell) {
    if (tool === 'wall') { paintWallLine(a, b); return }
    if (!lineZone) { setErr('Chọn khu cần rải ở bảng bên trái trước'); return }
    spreadLine(lineZone, a, b)
  }
  function onMarquee(a: GridCell, b: GridCell, additive: boolean) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y)
    const keys = placed.filter(f => f.anchor && f.anchor.x <= x1 && f.anchor.x + f.w - 1 >= x0 && f.anchor.y <= y1 && f.anchor.y + f.h - 1 >= y0).map(f => f.key)
    setSelKeys(s => additive ? [...new Set([...s, ...keys])] : keys)
  }

  // Phím tắt (bỏ qua khi đang gõ trong ô nhập hoặc đang mở sheet)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    if (objSheet || dropSuggest || guideOpen) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') { e.preventDefault(); if (editing && !busy) void runHist(e.shiftKey ? 'redo' : 'undo'); return }
    if (mod && k === 'y') { e.preventDefault(); if (editing && !busy) void runHist('redo'); return }
    if (e.key === 'Escape') { setSelKeys([]); setTool('select'); setPlacingKey(null); setLineZone(null); return }
    if (mod && k === 'a' && editing) { e.preventDefault(); setSelKeys(placed.map(f => f.key)); return }
    if (!editing || busy) return
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedMany.length) { e.preventDefault(); unplaceMany(selectedMany) } return }
    const step = e.shiftKey ? 5 : 1
    const mv: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] }
    const m = mv[e.key]
    if (m && selectedMany.length) { e.preventDefault(); moveSelected(m[0], m[1]) }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Bộ lọc
  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', value: effectiveWhId, pinned: true,
      onChange: v => { setWM({ warehouseId: v, zones: [] }); setSelKeys([]) }, allLabel: '— Chọn kho',
      options: warehouses.map(w => ({ value: w.id, label: w.name })) },
    { key: 'zone', label: 'Khu', type: 'multi', selected: zones, onChange: (v: string[]) => setWM({ zones: v }),
      options: zoneList.map(z => ({ value: z, label: z })) },
    { key: 'overlay', label: 'Lớp phủ', type: 'single', value: overlay, pinned: true,
      onChange: v => setWM({ overlay: (v === 'path' || v === 'none') ? v : 'stock' }), allLabel: 'Tồn theo ô',
      options: [{ value: 'stock', label: 'Tồn theo ô' }, { value: 'path', label: 'Đường đi từ cửa' }, { value: 'none', label: 'Chỉ bản vẽ' }] },
  ]

  const nStorage = footprints.filter(f => f.kind === 'STORAGE').length
  const nPlaced = placed.filter(f => f.kind === 'STORAGE').length
  const nWithStock = useMemo(() => placed.filter(f => f.locs.some(l => (occByLoc.get(l.id)?.pallets ?? 0) > 0)).length, [placed, occByLoc])
  const tiles: BandTile[] = [
    { label: 'Chân kệ đã đặt', value: `${nf.format(nPlaced)} / ${nf.format(nStorage)}`, tip: 'Số chân kệ (ô sàn) đã có toạ độ trên bản vẽ / tổng số chân kệ của kho' },
    { label: 'Chưa đặt', value: nf.format(nStorage - nPlaced), danger: nStorage - nPlaced > 0 },
    { label: 'Cửa · bãi · đầu dãy', value: nf.format(objects.length) },
    { label: 'Ô có hàng', value: occQ.data ? nf.format(nWithStock) : '…' },
    ...(draft ? [{ label: 'Kích thước', value: `${draft.width} × ${draft.height} ô · ${draft.cell_m} m/ô` }] : []),
  ]

  const actions: ActionItem[] = []
  if (canEdit && isLg) actions.push({
    key: 'edit', icon: editing ? Eye : Pencil, label: editing ? 'Xem' : 'Chỉnh sửa', primary: true,
    tip: editing ? 'Thoát trình vẽ, về chế độ xem' : 'Mở trình vẽ: khung, rải dãy, tường, cửa/bãi',
    onClick: () => { setEditing(v => !v); setTool('select'); setPlacingKey(null); setLineZone(null) },
  })
  if (editing) {
    actions.push({ key: 'undo', icon: Undo2, label: 'Hoàn tác', tip: hist.undo ? `Hoàn tác: ${hist.undo} (Ctrl+Z)` : 'Chưa có gì để hoàn tác (Ctrl+Z)', onClick: () => void runHist('undo'), disabled: !hist.undo || busy })
    actions.push({ key: 'redo', icon: Redo2, label: 'Làm lại', tip: hist.redo ? `Làm lại: ${hist.redo} (Ctrl+Y)` : 'Chưa có gì để làm lại (Ctrl+Y)', onClick: () => void runHist('redo'), disabled: !hist.redo || busy })
    actions.push({ key: 'save', icon: Save, label: 'Lưu khung', tip: frameDirty ? 'Lưu kích thước lưới, mét/ô và tường' : 'Khung chưa thay đổi', onClick: () => void doSaveFrame(), disabled: !frameDirty, busy: saveFrame.isPending, primary: true })
    actions.push({ key: 'drops', icon: Sparkles, label: 'Gợi ý đầu dãy', tip: 'Tìm các dãy kệ đã đặt và đề xuất điểm đầu dãy phía cửa xuất', onClick: suggestDrops, disabled: !placed.length })
  }
  actions.push({ key: 'fit', icon: Maximize2, label: 'Vừa màn', tip: 'Thu bản vẽ vừa khung nhìn', onClick: () => fitRef.current() })
  actions.push({ key: 'help', icon: BookOpen, label: 'Hướng dẫn', tip: 'Cách đọc bản vẽ, dựng khung, rải dãy, chọn nhiều, phím tắt', onClick: () => setGuideOpen(true) })

  const noFrame = !!data && !data.map

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:py-2 sm:space-y-1.5 sm:rounded-t-xl">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
              <MapIcon className="h-4 w-4 text-sky-600" /> Sơ đồ kho
            </h1>
            <SearchInput value={search} onChange={setSearch} placeholder="Tìm tem pallet / mã hàng → nháy ô…" className="flex-1 min-w-[160px]" />
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <span className="sm:hidden"><FilterSheetButton defs={filterDefs} /></span>
              <ActionCluster items={actions} mobileInline />
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>
        <SummaryBand tiles={tiles} />

        {err && (
          <div className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            <span className="flex-1">{err}</span>
            <button className="text-red-500 hover:text-red-700" onClick={() => setErr(null)} aria-label="Đóng"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* Thân: [trình vẽ] · canvas · pane */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {editing && draft && (
            <EditorPanel draft={draft} setDraft={setDraft} tool={tool} setTool={setTool}
              unplaced={unplaced} placingKey={placingKey} setPlacingKey={setPlacingKey}
              lineZone={lineZone} setLineZone={setLineZone} span={span} setSpan={setSpan} zoneColor={zoneColor}
              byCapacity={byCapacity} setByCapacity={setByCapacity} dir={dir} setDir={setDir} />
          )}
          <div className="flex-1 min-h-[45vh] lg:min-h-0 relative bg-slate-100">
            {mapQ.isLoading && <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">Đang tải bản vẽ…</div>}
            {mapQ.isError && <div className="absolute inset-0 grid place-items-center text-xs text-red-600 px-4 text-center">{apiMsg(mapQ.error)}</div>}
            {noFrame && !editing && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div className="max-w-sm space-y-2">
                  <p className="text-sm font-medium text-slate-700">Kho này chưa có bản vẽ</p>
                  <p className="text-xs text-slate-500">Dựng khung lưới (kích thước kho theo ô hoặc mét), rải dãy kệ lên lưới, chấm cửa xuất và cửa nhập. Khi đó tồn kho, đường đi, tìm pallet sẽ hiện trên sơ đồ.</p>
                  {canEdit && isLg
                    ? <Button size="sm" className="h-7 text-[11px]" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5 mr-1" />Dựng bản vẽ</Button>
                    : <p className="text-[11px] text-slate-400">{canEdit ? 'Dựng bản vẽ trên máy tính (màn rộng).' : 'Liên hệ người có quyền "Sơ đồ kho → Chỉnh sửa".'}</p>}
                  <button className="block mx-auto text-[11px] text-sky-600 hover:underline" onClick={() => setGuideOpen(true)}>Xem hướng dẫn</button>
                </div>
              </div>
            )}
            {frame && mask && (data?.map || editing) && (
              <MapCanvas frame={frame} blocked={draft?.blocked ?? []} footprints={placed} zoneColor={zoneColor} zonesFilter={zones}
                overlay={overlay} occByLoc={occByLoc} hitLocIds={hitLocIds} selectedKeys={selKeySet} path={path} door={door}
                tool={editing ? tool : 'select'} onCellClick={onCellClick} onLineDrag={onLineDrag} onMarquee={onMarquee} fitRef={fitRef} />
            )}
          </div>
          <SidePane many={selectedMany} occByLoc={occByLoc} canEdit={canEdit && editing}
            door={door} doors={doors} setDoorKey={setDoorKey} selDist={selDist} cellM={draft?.cell_m ?? 1.2} overlay={overlay}
            hits={findQ.data ?? []} locByIdLabel={(id) => data?.locations.find(l => l.id === id)} onPickHit={(locId) => { const f = footprints.find(x => x.locs.some(l => l.id === locId)); if (f) setSelKeys([f.key]) }}
            busy={busy} zoneColor={zoneColor} updatedAt={data?.map?.updated_at ?? null} updatedBy={data?.map?.updated_by ?? null} hasSavedFrame={hasSavedFrame}
            onToggleRack={toggleRack}
            onResize={(f, w, h) => void runAssign(f.locs.map(l => ({ location_id: l.id, grid_x: f.anchor!.x, grid_y: f.anchor!.y, grid_w: w, grid_h: h })), `Đã đổi kích thước ${f.label}`, `Đổi khối ${f.label} → ${w}×${h}`)}
            onUnplace={unplaceMany}
            onRename={renameObject}
            onDeleteObj={deleteObject}
            onViewStock={viewStock}
          />
        </div>
      </div>

      {/* Sheet tạo cửa/bãi/điểm hạ */}
      <FormSheet open={!!objSheet} onClose={() => setObjSheet(null)} title="Thêm cửa / bãi / điểm đầu dãy"
        description={objSheet ? `Tại ô (${objSheet.at.x}, ${objSheet.at.y}). Cửa và bãi là lối đi, không phải chỗ chứa hàng.` : undefined}
        footer={<>
          <Button variant="outline" size="sm" onClick={() => setObjSheet(null)}>Huỷ</Button>
          <Button size="sm" disabled={createObj.isPending || !objForm.name.trim()} onClick={() => void submitObject()}>{createObj.isPending ? 'Đang lưu…' : 'Tạo'}</Button>
        </>}>
        <div className="space-y-3 p-1">
          <div className="space-y-1">
            <Label className="text-xs">Loại</Label>
            <SingleSelect searchable={false} value={objForm.kind} onChange={v => setObjForm(f => ({ ...f, kind: v as Exclude<MapKind, 'STORAGE'> }))}
              options={[{ value: 'DOCK_OUT', label: 'Cửa / bãi xuất' }, { value: 'DOCK_IN', label: 'Cửa / bãi nhập' }, { value: 'DROP', label: 'Điểm đầu dãy (xe hạ đặt pallet)' }]} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tên</Label>
            <Input value={objForm.name} onChange={e => setObjForm(f => ({ ...f, name: e.target.value }))} placeholder='vd "Cửa xuất 2", "Đầu dãy A"' className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs">Rộng (ô)</Label><Input type="number" min={1} max={100} value={objForm.w} onChange={e => setObjForm(f => ({ ...f, w: Math.max(1, Number(e.target.value) || 1) }))} className="h-8 text-sm" /></div>
            <div className="space-y-1"><Label className="text-xs">Cao (ô)</Label><Input type="number" min={1} max={100} value={objForm.h} onChange={e => setObjForm(f => ({ ...f, h: Math.max(1, Number(e.target.value) || 1) }))} className="h-8 text-sm" /></div>
          </div>
        </div>
      </FormSheet>

      {/* Sheet gợi ý điểm đầu dãy */}
      <FormSheet open={!!dropSuggest} onClose={() => setDropSuggest(null)} title="Gợi ý điểm đầu dãy"
        description="Mỗi dãy kệ đã đặt (≥3 chân kệ liên tiếp) được đề xuất một điểm hạ ở đầu dãy phía cửa xuất. Bỏ tick dòng không muốn, đổi tên nếu cần."
        footer={<>
          <Button variant="outline" size="sm" onClick={() => setDropSuggest(null)}>Huỷ</Button>
          <Button size="sm" disabled={createObj.isPending || !(dropSuggest ?? []).some(s => s.pick)} onClick={() => void createDrops()}>
            {createObj.isPending ? 'Đang tạo…' : `Tạo ${(dropSuggest ?? []).filter(s => s.pick).length} điểm`}
          </Button>
        </>}>
        <div className="space-y-1.5 p-1">
          {(dropSuggest ?? []).map((s, i) => (
            <div key={`${s.at.x},${s.at.y}`} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={s.pick} onChange={e => setDropSuggest(d => d ? d.map((x, j) => j === i ? { ...x, pick: e.target.checked } : x) : d)} className="h-4 w-4 accent-sky-600" />
              <Input value={s.name} onChange={e => setDropSuggest(d => d ? d.map((x, j) => j === i ? { ...x, name: e.target.value } : x) : d)} className="h-7 text-xs flex-1" />
              <span className="font-mono text-slate-400 w-16 text-right">({s.at.x}, {s.at.y})</span>
            </div>
          ))}
        </div>
      </FormSheet>

      <WarehouseMapGuide open={guideOpen} onClose={() => setGuideOpen(false)} canEdit={canEdit} />
    </div>
  )
}

// ═══ Trình vẽ (panel trái, chỉ desktop) ═════════════════════════════════════════════════════════
function EditorPanel({ draft, setDraft, tool, setTool, unplaced, placingKey, setPlacingKey, lineZone, setLineZone, span, setSpan, zoneColor, byCapacity, setByCapacity, dir, setDir }: {
  draft: { width: number; height: number; cell_m: number; blocked: [number, number][] }
  setDraft: React.Dispatch<React.SetStateAction<{ width: number; height: number; cell_m: number; blocked: [number, number][] } | null>>
  tool: Tool; setTool: (t: Tool) => void
  unplaced: Footprint[]; placingKey: string | null; setPlacingKey: (k: string | null) => void
  lineZone: string | null; setLineZone: (z: string | null) => void
  span: { w: number; h: number }; setSpan: (s: { w: number; h: number }) => void
  zoneColor: Map<string, string>
  byCapacity: boolean; setByCapacity: (v: boolean) => void
  dir: Dir; setDir: (d: Dir) => void
}) {
  const [meters, setMeters] = useState<{ w: string; h: string }>({ w: '', h: '' })
  const groups = useMemo(() => {
    const m = new Map<string, Footprint[]>()
    for (const f of unplaced) { const a = m.get(f.sub_code); if (a) a.push(f); else m.set(f.sub_code, [f]) }
    return [...m.entries()]
  }, [unplaced])
  const [openZone, setOpenZone] = useState<string | null>(null)
  const TOOLS: { t: Tool; icon: typeof MousePointer2; label: string; tip: string }[] = [
    { t: 'select', icon: MousePointer2, label: 'Chọn', tip: 'Bấm ô để xem cột tầng · Ctrl+bấm thêm/bớt · Shift+kéo chọn cả vùng' },
    { t: 'place',  icon: Grid3x3,       label: 'Đặt lẻ', tip: 'Chọn chân kệ ở danh sách rồi bấm ô đầu trên bản vẽ' },
    { t: 'line',   icon: Pencil,        label: 'Rải dãy', tip: 'Chọn khu rồi KÉO một vệt dọc lối đi: mỗi ô của vệt là đầu một dãy, dãy kéo dài theo sức chứa' },
    { t: 'wall',   icon: Brush,         label: 'Tường', tip: 'Bấm ô hoặc kéo một vệt để tô/xoá tường, cột (ô chắn) — nhớ Lưu khung' },
    { t: 'object', icon: DoorOpen,      label: 'Cửa/bãi', tip: 'Bấm ô trống để tạo cửa xuất, cửa nhập hoặc điểm đầu dãy' },
    { t: 'erase',  icon: Eraser,        label: 'Gỡ', tip: 'Bấm ô để gỡ vị trí khỏi bản vẽ / xoá tường / gỡ cửa' },
  ]
  const placingLabel = placingKey ? unplaced.find(u => u.key === placingKey) : null
  return (
    <div className="w-64 shrink-0 border-r bg-white flex flex-col min-h-0">
      <div className="p-2 border-b space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Khung lưới</div>
        <div className="grid grid-cols-3 gap-1.5">
          <div><Label className="text-[10px]">Rộng (ô)</Label><Input type="number" min={5} max={400} value={draft.width} onChange={e => setDraft(d => d ? { ...d, width: Math.min(400, Math.max(5, Number(e.target.value) || 5)) } : d)} className="h-7 text-xs" /></div>
          <div><Label className="text-[10px]">Cao (ô)</Label><Input type="number" min={5} max={400} value={draft.height} onChange={e => setDraft(d => d ? { ...d, height: Math.min(400, Math.max(5, Number(e.target.value) || 5)) } : d)} className="h-7 text-xs" /></div>
          <div><Label className="text-[10px]">m / ô</Label><Input type="number" step={0.1} min={0.5} max={10} value={draft.cell_m} onChange={e => setDraft(d => d ? { ...d, cell_m: Math.max(0.1, Number(e.target.value) || 1.2) } : d)} className="h-7 text-xs" /></div>
        </div>
        <div className="flex items-end gap-1.5">
          <div className="flex-1"><Label className="text-[10px]">Kho dài (m)</Label><Input type="number" value={meters.w} onChange={e => setMeters(m => ({ ...m, w: e.target.value }))} placeholder="vd 70" className="h-7 text-xs" /></div>
          <div className="flex-1"><Label className="text-[10px]">Kho rộng (m)</Label><Input type="number" value={meters.h} onChange={e => setMeters(m => ({ ...m, h: e.target.value }))} placeholder="vd 45" className="h-7 text-xs" /></div>
          <Button size="sm" variant="outline" className="h-7 text-[10px] px-2" disabled={!Number(meters.w) || !Number(meters.h)}
            onClick={() => setDraft(d => d ? { ...d, width: Math.min(400, Math.max(5, Math.ceil(Number(meters.w) / d.cell_m))), height: Math.min(400, Math.max(5, Math.ceil(Number(meters.h) / d.cell_m))) } : d)}>Chia ô</Button>
        </div>
        <p className="text-[10px] text-slate-400">Tường đã tô: {draft.blocked.length} ô. Đổi khung xong bấm <b>Lưu khung</b> ở toolbar.</p>
      </div>
      <div className="p-2 border-b">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Công cụ</div>
        <div className="grid grid-cols-3 gap-1">
          {TOOLS.map(({ t, icon: Icon, label, tip }) => (
            <button key={t} title={tip} onClick={() => setTool(t)}
              className={`flex flex-col items-center gap-0.5 rounded border px-1 py-1.5 text-[10px] ${tool === t ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
        {(tool === 'place' || tool === 'line') && (
          <div className="mt-2 space-y-1.5 rounded border border-slate-200 bg-slate-50 p-1.5 text-[10px] text-slate-600">
            <label className="flex items-start gap-1.5 cursor-pointer">
              <input type="checkbox" checked={byCapacity} onChange={e => setByCapacity(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-sky-600" />
              <span>Theo sức chứa <span className="text-slate-400">— 1 ô = 1 pallet (vị trí 43 pallet → vệt 43 ô)</span></span>
            </label>
            {byCapacity ? (
              <>
                <div className="flex items-center gap-1">
                  <span className="mr-0.5">Kéo dài về</span>
                  {DIRS.map(d => (
                    <button key={d.d} title={d.tip} onClick={() => setDir(d.d)}
                      className={`h-6 w-7 rounded border font-mono text-xs ${dir === d.d ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'}`}>{d.label}</button>
                  ))}
                </div>
                {tool === 'line' && <p className="text-slate-400">Vệt dọc → dãy nằm ngang (→/←) · vệt ngang → dãy nằm dọc (↓/↑).</p>}
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <span>Khối</span>
                <Input type="number" min={1} max={100} value={span.w} onChange={e => setSpan({ ...span, w: Math.max(1, Number(e.target.value) || 1) })} className="h-6 w-12 text-[10px] px-1" />
                <span>×</span>
                <Input type="number" min={1} max={100} value={span.h} onChange={e => setSpan({ ...span, h: Math.max(1, Number(e.target.value) || 1) })} className="h-6 w-12 text-[10px] px-1" />
                <span>ô (ô sàn xếp khối)</span>
              </div>
            )}
          </div>
        )}
        {tool === 'line' && <p className="mt-1.5 text-[10px] text-sky-700">Đang rải khu: <b>{lineZone ?? '— chọn khu bên dưới'}</b>. Kéo một vệt trên bản vẽ.</p>}
        {tool === 'place' && <p className="mt-1.5 text-[10px] text-sky-700">Đang đặt: <b>{placingLabel ? `${placingLabel.label}${byCapacity ? ` · ${capLen(placingLabel)} ô` : ''}` : '— chọn chân kệ bên dưới'}</b></p>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Chưa đặt lên bản vẽ · {nf.format(unplaced.length)}</div>
        {groups.length === 0 && <p className="text-[11px] text-slate-400">Mọi chân kệ đã có toạ độ.</p>}
        {groups.map(([zone, fps]) => (
          <div key={zone} className="mb-1.5 rounded border border-slate-200">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-t">
              <span className="inline-block h-3 w-3 rounded-sm border border-slate-300" style={{ background: zoneColor.get(zone) ?? '#e2e8f0' }} />
              <button className="text-[11px] font-medium text-slate-700 flex-1 text-left" onClick={() => setOpenZone(z => z === zone ? null : zone)}>{zone} <span className="text-slate-400">· {fps.length}</span></button>
              <button className={`text-[10px] px-1.5 py-0.5 rounded border ${lineZone === zone && tool === 'line' ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-300 text-slate-600 hover:bg-white'}`}
                onClick={() => { setLineZone(zone); setTool('line') }}>Rải dãy</button>
            </div>
            {openZone === zone && (
              <div className="max-h-48 overflow-auto p-1 grid grid-cols-3 gap-0.5">
                {fps.map(f => (
                  <button key={f.key} onClick={() => { setPlacingKey(f.key); setTool('place') }}
                    className={`truncate rounded px-1 py-0.5 text-[10px] font-mono border ${placingKey === f.key ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 hover:bg-slate-50'}`}
                    title={`${f.code} · ${f.locs.length} tầng · sức chứa ${capLen(f)} pallet`}>{f.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══ Pane phải: cột tầng / nhóm đang chọn / cửa / kết quả tìm / chú giải ═══════════════════════════
function SidePane(p: {
  many: Footprint[]; occByLoc: Map<string, MapOccupancy>; canEdit: boolean
  door: Footprint | null; doors: Footprint[]; setDoorKey: (k: string) => void; selDist: number; cellM: number; overlay: Overlay
  hits: { location_id: string; pallet_code: string; material_code: string | null }[]
  locByIdLabel: (id: string) => MapLoc | undefined; onPickHit: (locId: string) => void
  busy: boolean; zoneColor: Map<string, string>; updatedAt: string | null; updatedBy: string | null; hasSavedFrame: boolean
  onToggleRack: (fs: Footprint[], v: boolean) => void; onResize: (f: Footprint, w: number, h: number) => void; onUnplace: (fs: Footprint[]) => void
  onRename: (f: Footprint, name: string) => void; onDeleteObj: (f: Footprint) => void; onViewStock: (fs: Footprint[]) => void
}) {
  const f = p.many.length === 1 ? p.many[0] : null
  const many = p.many.length > 1 ? p.many : null
  const [sizeDraft, setSizeDraft] = useState<{ w: number; h: number } | null>(null)
  const [nameDraft, setNameDraft] = useState<string>('')
  useEffect(() => { setSizeDraft(f ? { w: f.w, h: f.h } : null); setNameDraft(f && f.kind !== 'STORAGE' ? f.label : '') }, [f])
  const palletsOf = (fs: Footprint[]) => fs.reduce((s, x) => s + x.locs.reduce((t, l) => t + (p.occByLoc.get(l.id)?.pallets ?? 0), 0), 0)
  const capOf = (fs: Footprint[]) => fs.reduce((s, x) => s + (x.kind === 'STORAGE' ? x.locs.reduce((t, l) => t + (l.max_pallets > 0 ? l.max_pallets : 1), 0) : 0), 0)
  const hitGroups = useMemo(() => {
    const m = new Map<string, { code: string; n: number }>()
    for (const h of p.hits) { const l = p.locByIdLabel(h.location_id); const k = h.location_id; const cur = m.get(k); if (cur) cur.n++; else m.set(k, { code: l?.location_code ?? '(ô chưa vẽ)', n: 1 }) }
    return [...m.entries()].slice(0, 50)
  }, [p.hits, p.locByIdLabel])

  return (
    <div className="lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l bg-white overflow-auto max-h-[45vh] lg:max-h-none">
      {/* Đường đi: chọn cửa xuất phát */}
      <div className="px-3 py-2 border-b flex items-center gap-2 text-[11px]">
        <span className="text-slate-500 shrink-0">Đi từ</span>
        {p.doors.length
          ? <SingleSelect searchable={false} value={p.door?.key ?? ''} onChange={p.setDoorKey} triggerClassName="h-7 text-[11px] flex-1"
              options={p.doors.map(d => ({ value: d.key, label: d.label, sub: KIND_LABEL[d.kind] }))} />
          : <span className="text-slate-400">chưa có cửa xuất / nhập trên bản vẽ</span>}
      </div>

      {!f && !many && (
        <div className="p-3 space-y-3 text-[11px]">
          {hitGroups.length > 0 && (
            <div>
              <div className="font-semibold text-slate-700 mb-1">Kết quả tìm · {nf.format(p.hits.length)} pallet</div>
              <div className="space-y-0.5 max-h-52 overflow-auto">
                {hitGroups.map(([id, g]) => (
                  <button key={id} onClick={() => p.onPickHit(id)} className="w-full flex items-center justify-between rounded px-2 py-1 hover:bg-sky-50 text-left">
                    <span className="font-mono text-slate-700 truncate">{g.code}</span><span className="text-slate-400 shrink-0 ml-2">{g.n} pallet</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="font-semibold text-slate-700 mb-1">Chú giải</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[...p.zoneColor.entries()].map(([z, c]) => <div key={z} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-slate-300" style={{ background: c }} />Khu {z}</div>)}
              <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: KIND_COLOR.DOCK_OUT }} />Cửa / bãi xuất</div>
              <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: KIND_COLOR.DOCK_IN }} />Cửa / bãi nhập</div>
              <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: KIND_COLOR.DROP }} />Điểm đầu dãy</div>
              <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-slate-400" />Tường / cột</div>
              <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2 border-red-500" />Ô khớp tìm kiếm</div>
              {p.overlay === 'stock' && <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: '#38bdf8' }} />Ô có pallet</div>}
              {p.overlay === 'stock' && <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-slate-300 bg-white text-[8px] leading-3 text-center text-slate-400">×</span>Chỗ trống</div>}
            </div>
          </div>
          <p className="text-slate-400">Bấm một ô để xem cột tầng · mỗi ô nhỏ trong vệt = một chỗ pallet · số góc ô = số tầng. {p.hasSavedFrame && p.updatedAt ? `Bản vẽ sửa lần cuối ${formatDateTime(p.updatedAt)}${p.updatedBy ? ` bởi ${p.updatedBy}` : ''}.` : ''}</p>
        </div>
      )}

      {many && (
        <div className="p-3 space-y-3 text-[11px]">
          <div>
            <div className="text-sm font-semibold text-slate-800">{nf.format(many.length)} ô đang chọn</div>
            <div className="text-slate-500">
              {nf.format(many.filter(x => x.kind === 'STORAGE').length)} chân kệ · {nf.format(many.filter(x => x.kind !== 'STORAGE').length)} cửa/bãi
              · {nf.format(palletsOf(many))} pallet / sức chứa {nf.format(capOf(many))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1 max-h-40 overflow-auto">
            {many.slice(0, 60).map(x => (
              <span key={x.key} className="rounded border border-slate-200 px-1 font-mono text-[10px] text-slate-700" style={{ background: x.kind === 'STORAGE' ? (p.zoneColor.get(x.sub_code) ?? '#f1f5f9') : KIND_COLOR[x.kind] }}>{x.label}</span>
            ))}
            {many.length > 60 && <span className="text-slate-400">+{nf.format(many.length - 60)}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => p.onViewStock(many)}><Package className="h-3.5 w-3.5 mr-1" />Tồn kho ở các ô này</Button>
            {p.canEdit && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={p.busy} onClick={() => p.onToggleRack(many, true)}>Đánh KỆ</Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={p.busy} onClick={() => p.onToggleRack(many, false)}>Đánh SÀN</Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px] text-red-600" disabled={p.busy} onClick={() => p.onUnplace(many)}><Trash2 className="h-3.5 w-3.5 mr-1" />Gỡ khỏi bản vẽ</Button>
              </>
            )}
          </div>
          {p.canEdit && <p className="text-slate-400">Mũi tên: dời 1 ô · Shift+mũi tên: dời 5 ô · Delete: gỡ · Esc: bỏ chọn · Ctrl+bấm: thêm/bớt · Shift+kéo: chọn vùng.</p>}
        </div>
      )}

      {f && (
        <div className="p-3 space-y-3 text-[11px]">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-3.5 w-3.5 rounded-sm border border-slate-300 shrink-0" style={{ background: f.kind === 'STORAGE' ? (p.zoneColor.get(f.sub_code) ?? '#e2e8f0') : KIND_COLOR[f.kind] }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800 font-mono truncate">{f.label}</div>
              <div className="text-slate-500">{KIND_LABEL[f.kind]}{f.kind === 'STORAGE' ? ` · khu ${f.sub_code} · ${f.is_rack ? 'KỆ' : 'SÀN'} · ${f.locs.length} tầng` : ''}</div>
              {f.anchor && <div className="text-slate-400 font-mono">ô ({f.anchor.x}, {f.anchor.y}) · {f.w}×{f.h} ô ≈ {(f.w * p.cellM).toFixed(1)}×{(f.h * p.cellM).toFixed(1)} m{f.kind === 'STORAGE' ? ` · sức chứa ${nf.format(capOf([f]))} pallet` : ''}</div>}
            </div>
          </div>

          {p.door && f.anchor && f.key !== p.door.key && (
            <div className={`rounded-md px-2.5 py-1.5 ${p.selDist >= 0 ? 'bg-sky-50 text-sky-800' : 'bg-amber-50 text-amber-800'}`}>
              {p.selDist >= 0
                ? <>Từ <b>{p.door.label}</b>: <b>{nf.format(p.selDist)} ô</b> ≈ {nf.format(Math.round(p.selDist * p.cellM))} m{p.overlay !== 'path' && <span className="text-sky-600"> · chọn lớp phủ "Đường đi" để vẽ</span>}</>
                : <>Không có lối đi từ <b>{p.door.label}</b> tới ô này — kiểm tra tường/kệ chắn.</>}
            </div>
          )}

          {f.kind === 'STORAGE' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-slate-700">Cột tầng</span>
                <span className="text-slate-500">{nf.format(palletsOf([f]))} pallet</span>
              </div>
              <div className="rounded border border-slate-200 divide-y">
                {[...f.locs].reverse().map(l => {
                  const o = p.occByLoc.get(l.id)
                  return (
                    <div key={l.id} className="flex items-center gap-2 px-2 py-1">
                      <span className="w-8 font-mono font-semibold text-slate-700">{l.level_no != null ? `T${l.level_no}` : '—'}</span>
                      <span className="flex-1 font-mono text-slate-500 truncate" title={l.location_code}>{l.location_code}</span>
                      <span className={`tabular-nums ${o?.pallets ? 'font-semibold text-slate-800' : 'text-slate-300'}`}>{o?.pallets ?? 0}<span className="text-slate-400 font-normal">/{l.max_pallets > 0 ? l.max_pallets : '∞'} pl</span></span>
                      <span className={`tabular-nums w-10 text-right ${o?.materials ? 'text-slate-700' : 'text-slate-300'}`}>{o?.materials ?? 0} <span className="text-slate-400">mã</span></span>
                      {!!o?.quarantine && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700">QA</span>}
                      {l.is_pick_face && <span className="text-[9px] px-1 rounded bg-violet-100 text-violet-700">nhặt lẻ</span>}
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => p.onViewStock([f])}><Package className="h-3.5 w-3.5 mr-1" />Tồn kho ở ô này</Button>
                {p.canEdit && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={p.busy} onClick={() => p.onToggleRack([f], !f.is_rack)}>
                    Đánh là {f.is_rack ? 'SÀN' : 'KỆ'}
                  </Button>
                )}
              </div>
              {p.canEdit && f.anchor && sizeDraft && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-slate-500">Khối</span>
                  <Input type="number" min={1} max={100} value={sizeDraft.w} onChange={e => setSizeDraft(s => s ? { ...s, w: Math.max(1, Number(e.target.value) || 1) } : s)} className="h-6 w-12 text-[10px] px-1" />
                  <span>×</span>
                  <Input type="number" min={1} max={100} value={sizeDraft.h} onChange={e => setSizeDraft(s => s ? { ...s, h: Math.max(1, Number(e.target.value) || 1) } : s)} className="h-6 w-12 text-[10px] px-1" />
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" disabled={p.busy || (sizeDraft.w === f.w && sizeDraft.h === f.h)} onClick={() => p.onResize(f, sizeDraft.w, sizeDraft.h)}>Áp</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-red-600 ml-auto" disabled={p.busy} onClick={() => p.onUnplace([f])}><Trash2 className="h-3 w-3 mr-1" />Gỡ khỏi bản vẽ</Button>
                </div>
              )}
              {p.canEdit && f.anchor && <p className="mt-1.5 text-slate-400">Mũi tên: dời 1 ô · Delete: gỡ · Ctrl+bấm ô khác: chọn thêm.</p>}
            </div>
          )}

          {f.kind !== 'STORAGE' && p.canEdit && (
            <div className="space-y-1.5">
              <Label className="text-[10px]">Tên</Label>
              <div className="flex gap-1.5">
                <Input value={nameDraft} onChange={e => setNameDraft(e.target.value)} className="h-7 text-xs" />
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={p.busy || !nameDraft.trim() || nameDraft.trim() === f.label} onClick={() => p.onRename(f, nameDraft.trim())}>Đổi</Button>
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-red-600" disabled={p.busy} onClick={() => p.onDeleteObj(f)}><Trash2 className="h-3.5 w-3.5 mr-1" />Gỡ {KIND_LABEL[f.kind].toLowerCase()}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══ Canvas ═══════════════════════════════════════════════════════════════════════════════════════
function MapCanvas({ frame, blocked, footprints, zoneColor, zonesFilter, overlay, occByLoc, hitLocIds, selectedKeys, path, door, tool, onCellClick, onLineDrag, onMarquee, fitRef }: {
  frame: GridFrame; blocked: [number, number][]; footprints: Footprint[]; zoneColor: Map<string, string>; zonesFilter: string[]
  overlay: Overlay; occByLoc: Map<string, MapOccupancy>; hitLocIds: Set<string>; selectedKeys: Set<string>; path: GridCell[]; door: Footprint | null
  tool: Tool; onCellClick: (c: GridCell, mods: ClickMods) => void; onLineDrag: (a: GridCell, b: GridCell) => void; onMarquee: (a: GridCell, b: GridCell, additive: boolean) => void
  fitRef: React.MutableRefObject<() => void>
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 300, h: 300 })
  const [view, setView] = useState({ scale: 12, ox: 8, oy: 8 })
  const viewRef = useRef(view); viewRef.current = view
  const ptr = useRef<{ id: number; x: number; y: number; moved: boolean; startCell: GridCell | null } | null>(null)
  const pinch = useRef<{ d: number; scale: number } | null>(null)
  const [hover, setHover] = useState<GridCell | null>(null)
  const [lineStart, setLineStart] = useState<GridCell | null>(null)       // vệt Rải dãy / Tường
  const [marqueeStart, setMarqueeStart] = useState<GridCell | null>(null) // Shift+kéo chọn vùng
  const dragsLine = tool === 'line' || tool === 'wall'

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const fit = useCallback(() => {
    const s = Math.max(2, Math.min((size.w - 16) / frame.width, (size.h - 16) / frame.height))
    setView({ scale: s, ox: (size.w - frame.width * s) / 2, oy: (size.h - frame.height * s) / 2 })
  }, [size, frame.width, frame.height])
  useEffect(() => { fitRef.current = fit }, [fit, fitRef])
  const fittedFor = useRef('')
  useEffect(() => {
    const k = `${frame.width}x${frame.height}@${size.w}x${size.h}`
    if (fittedFor.current !== k && size.w > 50) { fittedFor.current = k; fit() }
  }, [frame.width, frame.height, size, fit])

  const toCell = (clientX: number, clientY: number): GridCell | null => {
    const el = canvasRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const v = viewRef.current
    const x = Math.floor((clientX - r.left - v.ox) / v.scale), y = Math.floor((clientY - r.top - v.oy) / v.scale)
    return inFrame(frame, x, y) ? { x, y } : null
  }

  // Vẽ
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.floor(size.w * dpr); cv.height = Math.floor(size.h * dpr)
    cv.style.width = `${size.w}px`; cv.style.height = `${size.h}px`
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size.w, size.h)
    const { scale: s, ox, oy } = view
    const px = (x: number) => ox + x * s, py = (y: number) => oy + y * s
    // nền + khung
    g.fillStyle = '#f8fafc'; g.fillRect(px(0), py(0), frame.width * s, frame.height * s)
    if (s >= 7) {
      g.strokeStyle = '#e2e8f0'; g.lineWidth = 1; g.beginPath()
      for (let x = 0; x <= frame.width; x++) { g.moveTo(px(x) + 0.5, py(0)); g.lineTo(px(x) + 0.5, py(frame.height)) }
      for (let y = 0; y <= frame.height; y++) { g.moveTo(px(0), py(y) + 0.5); g.lineTo(px(frame.width), py(y) + 0.5) }
      g.stroke()
    }
    // tường
    g.fillStyle = '#94a3b8'
    for (const [x, y] of blocked) if (inFrame(frame, x, y)) g.fillRect(px(x), py(y), s, s)
    // dấu × trong một ô pallet (như bản vẽ tay của kho)
    const cross = (x0: number, y0: number, color: string) => {
      const m = s * 0.3
      g.strokeStyle = color; g.lineWidth = Math.max(1, s * 0.06)
      g.beginPath(); g.moveTo(x0 + m, y0 + m); g.lineTo(x0 + s - m, y0 + s - m); g.moveTo(x0 + s - m, y0 + m); g.lineTo(x0 + m, y0 + s - m); g.stroke()
    }
    // vạch chia ô trong một khối nhiều ô
    const innerGrid = (X: number, Y: number, w: number, h: number, color: string) => {
      if (w * h <= 1) return
      g.strokeStyle = color; g.lineWidth = 1; g.beginPath()
      for (let cx = 1; cx < w; cx++) { g.moveTo(X + cx * s + 0.5, Y); g.lineTo(X + cx * s + 0.5, Y + h * s) }
      for (let cy = 1; cy < h; cy++) { g.moveTo(X, Y + cy * s + 0.5); g.lineTo(X + w * s, Y + cy * s + 0.5) }
      g.stroke()
    }
    // chân kệ / cửa
    const dim = zonesFilter.length > 0
    for (const f of footprints) {
      if (!f.anchor) continue
      const X = px(f.anchor.x), Y = py(f.anchor.y), W = f.w * s, H = f.h * s
      const faded = dim && f.kind === 'STORAGE' && !zonesFilter.includes(f.sub_code)
      g.globalAlpha = faded ? 0.25 : 1
      let hasQA = false
      if (f.kind !== 'STORAGE') {
        g.fillStyle = KIND_COLOR[f.kind]; g.fillRect(X, Y, W, H)
        g.strokeStyle = '#ffffff'; g.lineWidth = 0.75; g.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1)
      } else {
        const zc = zoneColor.get(f.sub_code) ?? '#e2e8f0'
        let used = 0, cap = 0
        for (const l of f.locs) { const o = occByLoc.get(l.id); used += o?.pallets ?? 0; cap += l.max_pallets > 0 ? l.max_pallets : 1; if ((o?.quarantine ?? 0) > 0) hasQA = true }
        const ratio = cap ? used / cap : 0
        const cellsN = f.w * f.h
        if (overlay === 'stock') {
          if (s >= 5) {
            // Từng ô pallet: có hàng = tô sky, trống = trắng có dấu × nhạt; tô từ góc neo theo hàng
            g.fillStyle = '#ffffff'; g.fillRect(X, Y, W, H)
            const filled = used > 0 ? Math.max(1, Math.min(cellsN, Math.round(cellsN * ratio))) : 0
            let i = 0
            for (let cy = 0; cy < f.h; cy++) for (let cx = 0; cx < f.w; cx++, i++) {
              const x0 = X + cx * s, y0 = Y + cy * s
              if (i < filled) { g.fillStyle = ratio >= 1 ? '#0284c7' : '#38bdf8'; g.fillRect(x0, y0, s, s) }
              if (s >= 9) cross(x0, y0, i < filled ? 'rgba(255,255,255,0.85)' : '#cbd5e1')
            }
            innerGrid(X, Y, f.w, f.h, '#e2e8f0')
            g.strokeStyle = zc; g.lineWidth = 2; g.strokeRect(X + 1, Y + 1, W - 2, H - 2)   // viền màu khu để vẫn nhận ra khu
          } else { g.fillStyle = stockColor(ratio); g.fillRect(X, Y, W, H) }
        } else {
          g.fillStyle = zc; g.fillRect(X, Y, W, H)
          if (s >= 5) innerGrid(X, Y, f.w, f.h, 'rgba(255,255,255,0.7)')
          if (s >= 9) for (let cy = 0; cy < f.h; cy++) for (let cx = 0; cx < f.w; cx++) cross(X + cx * s, Y + cy * s, 'rgba(15,23,42,0.18)')
        }
        g.strokeStyle = f.is_rack ? '#64748b' : '#94a3b8'; g.lineWidth = f.is_rack ? 1 : 0.75
        g.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1)
        if (overlay === 'stock' && hasQA) { g.strokeStyle = '#d97706'; g.lineWidth = 2; g.strokeRect(X + 1, Y + 1, W - 2, H - 2) }
      }
      // nhãn
      if (s >= 16 || (f.kind !== 'STORAGE' && s >= 10) || (f.w * s >= 40)) {
        const fs = Math.max(8, Math.min(13, Math.min(W, H) * 0.42))
        g.fillStyle = f.kind === 'STORAGE' ? '#0f172a' : '#ffffff'; g.font = `${f.kind === 'STORAGE' ? 500 : 600} ${fs}px ui-monospace, monospace`
        g.textAlign = 'center'; g.textBaseline = 'middle'
        const maxCh = Math.max(3, Math.floor(W / (fs * 0.6)))
        const label = f.label.length > maxCh ? f.label.slice(0, maxCh) : f.label
        if (f.kind === 'STORAGE' && overlay !== 'stock' || f.kind !== 'STORAGE') g.fillText(label, X + W / 2, Y + H / 2)
        else {
          // trên nền ô pallet: nhãn có đệm trắng mờ để đọc được
          const tw = g.measureText(label).width
          g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(X + W / 2 - tw / 2 - 2, Y + H / 2 - fs / 2 - 1, tw + 4, fs + 2)
          g.fillStyle = '#0f172a'; g.fillText(label, X + W / 2, Y + H / 2)
        }
        if (f.kind === 'STORAGE' && f.locs.length > 1 && s >= 22) {
          g.font = `600 ${Math.max(7, fs * 0.7)}px ui-sans-serif, system-ui`; g.fillStyle = '#475569'; g.textAlign = 'right'; g.textBaseline = 'bottom'
          g.fillText(`${f.locs.length}`, X + W - 2, Y + H - 1)
        }
      }
      g.globalAlpha = 1
      // khớp tìm kiếm
      if (f.locs.some(l => hitLocIds.has(l.id))) { g.strokeStyle = '#ef4444'; g.lineWidth = Math.max(2, s * 0.15); g.strokeRect(X + 1, Y + 1, W - 2, H - 2) }
      if (selectedKeys.has(f.key)) { g.strokeStyle = '#0284c7'; g.lineWidth = Math.max(2.5, s * 0.2); g.strokeRect(X + 1, Y + 1, W - 2, H - 2) }
    }
    // đường đi
    if (path.length > 1) {
      g.strokeStyle = '#0284c7'; g.lineWidth = Math.max(2, s * 0.25); g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash([Math.max(3, s * 0.4), Math.max(3, s * 0.3)])
      g.beginPath()
      path.forEach((c, i) => { const cx = px(c.x) + s / 2, cy = py(c.y) + s / 2; if (i === 0) g.moveTo(cx, cy); else g.lineTo(cx, cy) })
      g.stroke(); g.setLineDash([])
      const end = path[path.length - 1]
      g.fillStyle = '#0284c7'; g.beginPath(); g.arc(px(end.x) + s / 2, py(end.y) + s / 2, Math.max(3, s * 0.25), 0, Math.PI * 2); g.fill()
    }
    if (door?.anchor && overlay === 'path') { g.fillStyle = '#16a34a'; g.beginPath(); g.arc(px(door.anchor.x) + s / 2, py(door.anchor.y) + s / 2, Math.max(3, s * 0.3), 0, Math.PI * 2); g.fill() }
    // vệt đang kéo (rải dãy / tường) · khung chọn vùng · ô đang trỏ
    if (lineStart && hover) {
      g.fillStyle = tool === 'wall' ? 'rgba(100,116,139,0.45)' : 'rgba(2,132,199,0.35)'
      for (const c of lineCells(lineStart, hover)) g.fillRect(px(c.x), py(c.y), s, s)
    } else if (marqueeStart && hover) {
      const x0 = Math.min(marqueeStart.x, hover.x), y0 = Math.min(marqueeStart.y, hover.y)
      const x1 = Math.max(marqueeStart.x, hover.x), y1 = Math.max(marqueeStart.y, hover.y)
      g.fillStyle = 'rgba(2,132,199,0.12)'; g.fillRect(px(x0), py(y0), (x1 - x0 + 1) * s, (y1 - y0 + 1) * s)
      g.strokeStyle = '#0284c7'; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.strokeRect(px(x0) + 0.5, py(y0) + 0.5, (x1 - x0 + 1) * s - 1, (y1 - y0 + 1) * s - 1); g.setLineDash([])
    } else if (hover && tool !== 'select') {
      g.strokeStyle = '#0ea5e9'; g.lineWidth = 2; g.strokeRect(px(hover.x) + 1, py(hover.y) + 1, s - 2, s - 2)
    }
  }, [size, view, frame, blocked, footprints, zoneColor, zonesFilter, overlay, occByLoc, hitLocIds, selectedKeys, path, door, hover, lineStart, marqueeStart, tool])

  // Tương tác: kéo = pan (hoặc vệt rải dãy/tường, hoặc Shift+kéo = chọn vùng), bấm = chọn ô, lăn = zoom, hai ngón = zoom
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: viewRef.current.scale }
      ptr.current = null
      return
    }
    const cell = toCell(e.clientX, e.clientY)
    ptr.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, startCell: cell }
    if (dragsLine && cell) setLineStart(cell)
    else if (tool === 'select' && e.shiftKey && cell) setMarqueeStart(cell)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const ns = Math.max(2, Math.min(80, pinch.current.scale * (d / pinch.current.d)))
      setView(v => ({ ...v, scale: ns }))
      return
    }
    setHover(toCell(e.clientX, e.clientY))
    const p = ptr.current
    if (!p || p.id !== e.pointerId || e.buttons === 0) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    if (!p.moved && Math.hypot(dx, dy) < 4) return
    p.moved = true
    if (lineStart || marqueeStart) return   // đang kéo vệt / khung chọn: không pan
    setView(v => ({ ...v, ox: v.ox + dx, oy: v.oy + dy })); p.x = e.clientX; p.y = e.clientY
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const p = ptr.current
    if (!p || p.id !== e.pointerId) return
    ptr.current = null
    const cell = toCell(e.clientX, e.clientY)
    const mods: ClickMods = { ctrl: e.ctrlKey || e.metaKey }
    if (marqueeStart) {
      onMarquee(marqueeStart, cell ?? hover ?? marqueeStart, mods.ctrl)
      setMarqueeStart(null)
      return
    }
    if (lineStart) {
      if (tool === 'wall' && !p.moved) { if (cell) onCellClick(cell, mods) }   // tường: bấm = bật/tắt một ô
      else if (cell) onLineDrag(lineStart, cell)
      setLineStart(null)
      return
    }
    if (!p.moved && cell) onCellClick(cell, mods)
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const el = canvasRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    setView(v => {
      const ns = Math.max(2, Math.min(80, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      const k = ns / v.scale
      return { scale: ns, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k }
    })
  }

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden select-none touch-none">
      <canvas ref={canvasRef} className={`block ${tool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)} onWheel={onWheel} />
      {hover && (
        <div className="pointer-events-none absolute left-2 bottom-2 rounded bg-slate-900/80 px-2 py-0.5 text-[10px] font-mono text-white">
          ô ({hover.x}, {hover.y}) · {Math.round(view.scale)} px/ô
        </div>
      )}
    </div>
  )
}
