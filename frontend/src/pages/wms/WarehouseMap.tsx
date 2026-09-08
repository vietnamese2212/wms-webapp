// SƠ ĐỒ KHO bản một (08/09/2026) — bản vẽ 2D nhìn từ trên xuống, 1 ô lưới ≈ 1 chân pallet.
// User chốt sau 8 vòng brainstorm: 2D là CHÍNH (vẽ, mọi lớp phủ, PDA), 3D chỉ là góc nhìn phụ (đợt sau).
// Các TẦNG của cùng chân kệ (A12_T1..T4) dùng CHUNG một ô — bấm ô mở "cột tầng" ở pane phải.
// Ô có vị trí chứa hàng hoặc tường = chắn; ô trống/cửa/bãi/điểm đầu dãy = lối đi ⇒ đường đi = BFS
// (utils/warehouseGrid — cùng bản với backend). Không lưu khoảng cách: bản vẽ là nguồn duy nhất.
//
// Ba lớp phủ: Tồn theo ô (tô màu theo % đầy) · Đường đi (từ một cửa tới ô đang chọn) · Không.
// Trình vẽ (quyền warehouse_map.edit, chỉ desktop): dựng khung, rải dãy bằng một vệt kéo, đặt lẻ,
// tô tường, chấm cửa/bãi/điểm đầu dãy, gợi ý điểm đầu dãy, gỡ khỏi bản vẽ, đánh Kệ/Sàn cả chân kệ.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { Map as MapIcon, Pencil, Eye, Save, Maximize2, MousePointer2, Grid3x3, Brush, DoorOpen, Eraser, Sparkles, Trash2, X, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import { SearchInput } from '@/components/shared/SearchInput'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
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

const KIND_LABEL: Record<MapKind, string> = { STORAGE: 'Ô chứa hàng', DOCK_OUT: 'Cửa / bãi xuất', DOCK_IN: 'Cửa / bãi nhập', DROP: 'Điểm đầu dãy' }
const KIND_COLOR: Record<Exclude<MapKind, 'STORAGE'>, string> = { DOCK_OUT: '#22c55e', DOCK_IN: '#3b82f6', DROP: '#f59e0b' }
// Bảng màu khu (tông nhẹ, phân biệt được ~8 khu; vượt thì lặp)
const ZONE_PALETTE = ['#bae6fd', '#bbf7d0', '#fde68a', '#fecaca', '#ddd6fe', '#fbcfe8', '#a7f3d0', '#fed7aa']
// Tô theo % đầy (lớp Tồn theo ô): 0 → trắng, tăng dần tông sky
function stockColor(ratio: number): string {
  if (ratio <= 0) return '#ffffff'
  if (ratio < 0.25) return '#e0f2fe'
  if (ratio < 0.5) return '#bae6fd'
  if (ratio < 0.75) return '#7dd3fc'
  if (ratio < 1) return '#38bdf8'
  return '#0284c7'
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
  const [span, setSpan] = useState({ w: 1, h: 1 })
  const [err, setErr] = useState<string | null>(null)

  // Khung NHÁP khi sửa (kích thước + tường) — lưu một lần bằng nút Lưu khung
  const [draft, setDraft] = useState<{ width: number; height: number; cell_m: number; blocked: [number, number][] } | null>(null)
  useEffect(() => {
    if (!data) return
    setDraft(data.map ? { width: data.map.width, height: data.map.height, cell_m: data.map.cell_m, blocked: data.map.blocked ?? [] }
                      : { width: 60, height: 40, cell_m: 1.2, blocked: [] })
  }, [data])
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
  const mask = useMemo(() => frame ? buildBlockedMask(frame, draft?.blocked ?? [], data?.locations ?? []) : null, [frame, draft?.blocked, data?.locations])

  // Chọn chân kệ + đường đi từ cửa
  const [selKey, setSelKey] = useState<string | null>(null)
  const selected = selKey ? fpByKey.get(selKey) ?? null : null
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
  const busy = saveFrame.isPending || assign.isPending || setRack.isPending || createObj.isPending || deleteObj.isPending

  async function runAssign(items: CellAssign[], okMsg: string) {
    setErr(null)
    try {
      const r = await assign.mutateAsync(items)
      toast({ title: okMsg, description: `${nf.format(r.updated)} dòng vị trí đã cập nhật` })
    } catch (e) { setErr(apiMsg(e)) }
  }
  function placeFootprint(f: Footprint, at: GridCell) {
    const w = f.kind === 'STORAGE' ? span.w : 1, h = f.kind === 'STORAGE' ? span.h : 1
    void runAssign(f.locs.map(l => ({ location_id: l.id, grid_x: at.x, grid_y: at.y, grid_w: w, grid_h: h })), `Đã đặt ${f.label}`)
  }
  function unplaceFootprint(f: Footprint) {
    void runAssign(f.locs.map(l => ({ location_id: l.id, grid_x: null, grid_y: null })), `Đã gỡ ${f.label} khỏi bản vẽ`)
  }
  function spreadLine(zone: string, a: GridCell, b: GridCell) {
    const cells = lineCells(a, b).filter(c => !cellOwner.has(`${c.x},${c.y}`) && !(draft?.blocked ?? []).some(([x, y]) => x === c.x && y === c.y))
    const group = unplaced.filter(f => f.sub_code === zone)
    if (!group.length) { setErr(`Khu ${zone} không còn chân kệ nào chưa đặt`); return }
    if (!cells.length) { setErr('Vệt kéo không đi qua ô trống nào'); return }
    const n = Math.min(cells.length, group.length)
    const items: CellAssign[] = []
    for (let i = 0; i < n; i++) for (const l of group[i].locs) items.push({ location_id: l.id, grid_x: cells[i].x, grid_y: cells[i].y, grid_w: 1, grid_h: 1 })
    void runAssign(items, `Đã rải ${n} chân kệ khu ${zone}${group.length > n ? ` (còn ${group.length - n} chưa đặt — kéo vệt tiếp)` : ''}`)
  }

  // ── Sheet tạo cửa/bãi/điểm hạ ──
  const [objSheet, setObjSheet] = useState<{ at: GridCell } | null>(null)
  const [objForm, setObjForm] = useState<{ kind: Exclude<MapKind, 'STORAGE'>; name: string; w: number; h: number }>({ kind: 'DOCK_OUT', name: '', w: 1, h: 1 })
  async function submitObject() {
    if (!objSheet) return
    setErr(null)
    try {
      await createObj.mutateAsync({ kind: objForm.kind, name: objForm.name.trim(), grid_x: objSheet.at.x, grid_y: objSheet.at.y, grid_w: objForm.w, grid_h: objForm.h })
      toast({ title: `Đã tạo ${KIND_LABEL[objForm.kind].toLowerCase()} "${objForm.name.trim()}"` })
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
      const dir = a.x === b.x ? { x: 0, y: 1 } : { x: 1, y: 0 }
      const ends = [{ x: a.x - dir.x, y: a.y - dir.y }, { x: b.x + dir.x, y: b.y + dir.y }]
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
    setDropSuggest(null)
  }

  async function doSaveFrame() {
    if (!draft) return
    setErr(null)
    try { await saveFrame.mutateAsync(draft); toast({ title: 'Đã lưu khung bản vẽ' }) } catch (e) { setErr(apiMsg(e)) }
  }

  // Canvas click theo công cụ
  const fitRef = useRef<() => void>(() => {})
  function onCellClick(c: GridCell) {
    const owner = cellOwner.get(`${c.x},${c.y}`)
    if (!editing || tool === 'select') { setSelKey(owner?.key ?? null); return }
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
      setDraft(d => {
        if (!d) return d
        const has = d.blocked.some(([x, y]) => x === c.x && y === c.y)
        return { ...d, blocked: has ? d.blocked.filter(([x, y]) => !(x === c.x && y === c.y)) : [...d.blocked, [c.x, c.y]] }
      })
      return
    }
    if (tool === 'object') {
      if (owner) { setErr(`Ô này đang là ${owner.label}`); return }
      setObjSheet({ at: c })
      return
    }
    if (tool === 'erase') {
      if (owner) {
        if (owner.kind === 'STORAGE') unplaceFootprint(owner)
        else void deleteObj.mutateAsync(owner.locs[0].id).then(() => toast({ title: `Đã gỡ ${owner.label}` })).catch(e => setErr(apiMsg(e)))
        if (selKey === owner.key) setSelKey(null)
        return
      }
      setDraft(d => d ? { ...d, blocked: d.blocked.filter(([x, y]) => !(x === c.x && y === c.y)) } : d)
    }
  }
  function onLineDrag(a: GridCell, b: GridCell) {
    if (!lineZone) { setErr('Chọn khu cần rải ở bảng bên trái trước'); return }
    spreadLine(lineZone, a, b)
  }

  // Bộ lọc
  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', value: effectiveWhId, pinned: true,
      onChange: v => { setWM({ warehouseId: v, zones: [] }); setSelKey(null) }, allLabel: '— Chọn kho',
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
    actions.push({ key: 'save', icon: Save, label: 'Lưu khung', tip: frameDirty ? 'Lưu kích thước lưới, mét/ô và tường' : 'Khung chưa thay đổi', onClick: () => void doSaveFrame(), disabled: !frameDirty, busy: saveFrame.isPending, primary: true })
    actions.push({ key: 'drops', icon: Sparkles, label: 'Gợi ý đầu dãy', tip: 'Tìm các dãy kệ đã đặt và đề xuất điểm đầu dãy phía cửa xuất', onClick: suggestDrops, disabled: !placed.length })
  }
  actions.push({ key: 'fit', icon: Maximize2, label: 'Vừa màn', tip: 'Thu bản vẽ vừa khung nhìn', onClick: () => fitRef.current() })

  const locationOfSelected = selected?.locs ?? []
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
              lineZone={lineZone} setLineZone={setLineZone} span={span} setSpan={setSpan} zoneColor={zoneColor} />
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
                </div>
              </div>
            )}
            {frame && mask && (data?.map || editing) && (
              <MapCanvas frame={frame} blocked={draft?.blocked ?? []} footprints={placed} zoneColor={zoneColor} zonesFilter={zones}
                overlay={overlay} occByLoc={occByLoc} hitLocIds={hitLocIds} selectedKey={selKey} path={path} door={door}
                tool={editing ? tool : 'select'} onCellClick={onCellClick} onLineDrag={onLineDrag} fitRef={fitRef} />
            )}
          </div>
          <SidePane selected={selected} locs={locationOfSelected} occByLoc={occByLoc} canEdit={canEdit && editing}
            door={door} doors={doors} setDoorKey={setDoorKey} selDist={selDist} cellM={draft?.cell_m ?? 1.2} overlay={overlay}
            hits={findQ.data ?? []} locByIdLabel={(id) => data?.locations.find(l => l.id === id)} onPickHit={(locId) => { const f = footprints.find(x => x.locs.some(l => l.id === locId)); if (f) setSelKey(f.key) }}
            busy={busy} zoneColor={zoneColor} updatedAt={data?.map?.updated_at ?? null} updatedBy={data?.map?.updated_by ?? null} hasSavedFrame={hasSavedFrame}
            onToggleRack={(f, v) => { setErr(null); setRack.mutateAsync({ location_ids: f.locs.map(l => l.id), is_rack: v }).then(() => toast({ title: v ? `${f.label}: đánh là KỆ` : `${f.label}: đánh là SÀN` })).catch(e => setErr(apiMsg(e))) }}
            onResize={(f, w, h) => void runAssign(f.locs.map(l => ({ location_id: l.id, grid_x: f.anchor!.x, grid_y: f.anchor!.y, grid_w: w, grid_h: h })), `Đã đổi kích thước ${f.label}`)}
            onUnplace={(f) => { unplaceFootprint(f); setSelKey(null) }}
            onRename={(f, name) => renameObj.mutateAsync({ id: f.locs[0].id, name }).then(() => toast({ title: 'Đã đổi tên' })).catch(e => setErr(apiMsg(e)))}
            onDeleteObj={(f) => deleteObj.mutateAsync(f.locs[0].id).then(() => { toast({ title: `Đã gỡ ${f.label}` }); setSelKey(null) }).catch(e => setErr(apiMsg(e)))}
            onViewStock={(f) => { setInventory({ warehouseIds: [effectiveWhId], filterLocations: f.locs.map(l => l.location_code), page: 1 }); navigate('/wms/inventory') }}
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
    </div>
  )
}

// ═══ Trình vẽ (panel trái, chỉ desktop) ═════════════════════════════════════════════════════════
function EditorPanel({ draft, setDraft, tool, setTool, unplaced, placingKey, setPlacingKey, lineZone, setLineZone, span, setSpan, zoneColor }: {
  draft: { width: number; height: number; cell_m: number; blocked: [number, number][] }
  setDraft: React.Dispatch<React.SetStateAction<{ width: number; height: number; cell_m: number; blocked: [number, number][] } | null>>
  tool: Tool; setTool: (t: Tool) => void
  unplaced: Footprint[]; placingKey: string | null; setPlacingKey: (k: string | null) => void
  lineZone: string | null; setLineZone: (z: string | null) => void
  span: { w: number; h: number }; setSpan: (s: { w: number; h: number }) => void
  zoneColor: Map<string, string>
}) {
  const [meters, setMeters] = useState<{ w: string; h: string }>({ w: '', h: '' })
  const groups = useMemo(() => {
    const m = new Map<string, Footprint[]>()
    for (const f of unplaced) { const a = m.get(f.sub_code); if (a) a.push(f); else m.set(f.sub_code, [f]) }
    return [...m.entries()]
  }, [unplaced])
  const [openZone, setOpenZone] = useState<string | null>(null)
  const TOOLS: { t: Tool; icon: typeof MousePointer2; label: string; tip: string }[] = [
    { t: 'select', icon: MousePointer2, label: 'Chọn', tip: 'Bấm ô để xem cột tầng' },
    { t: 'place',  icon: Grid3x3,       label: 'Đặt lẻ', tip: 'Chọn chân kệ ở danh sách rồi bấm ô trống' },
    { t: 'line',   icon: Pencil,        label: 'Rải dãy', tip: 'Chọn khu rồi KÉO một vệt: rải lần lượt các chân kệ chưa đặt của khu theo vệt' },
    { t: 'wall',   icon: Brush,         label: 'Tường', tip: 'Bấm ô để tô/xoá tường, cột (ô chắn) — nhớ Lưu khung' },
    { t: 'object', icon: DoorOpen,      label: 'Cửa/bãi', tip: 'Bấm ô trống để tạo cửa xuất, cửa nhập hoặc điểm đầu dãy' },
    { t: 'erase',  icon: Eraser,        label: 'Gỡ', tip: 'Bấm ô để gỡ vị trí khỏi bản vẽ / xoá tường / gỡ cửa' },
  ]
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
        {(tool === 'place') && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-600">
            <span>Khối</span>
            <Input type="number" min={1} max={100} value={span.w} onChange={e => setSpan({ ...span, w: Math.max(1, Number(e.target.value) || 1) })} className="h-6 w-12 text-[10px] px-1" />
            <span>×</span>
            <Input type="number" min={1} max={100} value={span.h} onChange={e => setSpan({ ...span, h: Math.max(1, Number(e.target.value) || 1) })} className="h-6 w-12 text-[10px] px-1" />
            <span>ô (ô sàn lớn)</span>
          </div>
        )}
        {tool === 'line' && <p className="mt-1.5 text-[10px] text-sky-700">Đang rải khu: <b>{lineZone ?? '— chọn khu bên dưới'}</b>. Kéo một vệt trên bản vẽ.</p>}
        {tool === 'place' && <p className="mt-1.5 text-[10px] text-sky-700">Đang đặt: <b>{placingKey ? unplaced.find(u => u.key === placingKey)?.label ?? '—' : '— chọn chân kệ bên dưới'}</b></p>}
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
                    title={`${f.code} · ${f.locs.length} tầng`}>{f.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══ Pane phải: cột tầng / cửa / kết quả tìm / chú giải ═══════════════════════════════════════════
function SidePane(p: {
  selected: Footprint | null; locs: MapLoc[]; occByLoc: Map<string, MapOccupancy>; canEdit: boolean
  door: Footprint | null; doors: Footprint[]; setDoorKey: (k: string) => void; selDist: number; cellM: number; overlay: Overlay
  hits: { location_id: string; pallet_code: string; material_code: string | null }[]
  locByIdLabel: (id: string) => MapLoc | undefined; onPickHit: (locId: string) => void
  busy: boolean; zoneColor: Map<string, string>; updatedAt: string | null; updatedBy: string | null; hasSavedFrame: boolean
  onToggleRack: (f: Footprint, v: boolean) => void; onResize: (f: Footprint, w: number, h: number) => void; onUnplace: (f: Footprint) => void
  onRename: (f: Footprint, name: string) => void; onDeleteObj: (f: Footprint) => void; onViewStock: (f: Footprint) => void
}) {
  const { selected: f } = p
  const [sizeDraft, setSizeDraft] = useState<{ w: number; h: number } | null>(null)
  const [nameDraft, setNameDraft] = useState<string>('')
  useEffect(() => { setSizeDraft(f ? { w: f.w, h: f.h } : null); setNameDraft(f && f.kind !== 'STORAGE' ? f.label : '') }, [f])
  const totalPallets = p.locs.reduce((s, l) => s + (p.occByLoc.get(l.id)?.pallets ?? 0), 0)
  const totalMats = new Set<string>()
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

      {!f && (
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
              {p.overlay === 'stock' && <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: stockColor(0.8) }} />Đậm = đầy hơn</div>}
            </div>
          </div>
          <p className="text-slate-400">Bấm một ô để xem cột tầng. Số nhỏ góc ô = số tầng. {p.hasSavedFrame && p.updatedAt ? `Bản vẽ sửa lần cuối ${formatDateTime(p.updatedAt)}${p.updatedBy ? ` bởi ${p.updatedBy}` : ''}.` : ''}</p>
        </div>
      )}

      {f && (
        <div className="p-3 space-y-3 text-[11px]">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-3.5 w-3.5 rounded-sm border border-slate-300 shrink-0" style={{ background: f.kind === 'STORAGE' ? (p.zoneColor.get(f.sub_code) ?? '#e2e8f0') : KIND_COLOR[f.kind] }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800 font-mono truncate">{f.label}</div>
              <div className="text-slate-500">{KIND_LABEL[f.kind]}{f.kind === 'STORAGE' ? ` · khu ${f.sub_code} · ${f.is_rack ? 'KỆ' : 'SÀN'} · ${f.locs.length} tầng` : ''}</div>
              {f.anchor && <div className="text-slate-400 font-mono">ô ({f.anchor.x}, {f.anchor.y}) · {f.w}×{f.h} ô ≈ {(f.w * p.cellM).toFixed(1)}×{(f.h * p.cellM).toFixed(1)} m</div>}
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
                <span className="text-slate-500">{nf.format(totalPallets)} pallet</span>
              </div>
              <div className="rounded border border-slate-200 divide-y">
                {[...f.locs].reverse().map(l => {
                  const o = p.occByLoc.get(l.id)
                  if (o) for (let i = 0; i < o.materials; i++) totalMats.add(`${l.id}-${i}`)
                  return (
                    <div key={l.id} className="flex items-center gap-2 px-2 py-1">
                      <span className="w-8 font-mono font-semibold text-slate-700">{l.level_no != null ? `T${l.level_no}` : '—'}</span>
                      <span className="flex-1 font-mono text-slate-500 truncate" title={l.location_code}>{l.location_code}</span>
                      <span className={`tabular-nums ${o?.pallets ? 'font-semibold text-slate-800' : 'text-slate-300'}`}>{o?.pallets ?? 0} <span className="text-slate-400 font-normal">pl</span></span>
                      <span className={`tabular-nums w-10 text-right ${o?.materials ? 'text-slate-700' : 'text-slate-300'}`}>{o?.materials ?? 0} <span className="text-slate-400">mã</span></span>
                      {!!o?.quarantine && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700">QA</span>}
                      {l.is_pick_face && <span className="text-[9px] px-1 rounded bg-violet-100 text-violet-700">nhặt lẻ</span>}
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => p.onViewStock(f)}><Package className="h-3.5 w-3.5 mr-1" />Tồn kho ở ô này</Button>
                {p.canEdit && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={p.busy} onClick={() => p.onToggleRack(f, !f.is_rack)}>
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
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 text-red-600 ml-auto" disabled={p.busy} onClick={() => p.onUnplace(f)}><Trash2 className="h-3 w-3 mr-1" />Gỡ khỏi bản vẽ</Button>
                </div>
              )}
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
function MapCanvas({ frame, blocked, footprints, zoneColor, zonesFilter, overlay, occByLoc, hitLocIds, selectedKey, path, door, tool, onCellClick, onLineDrag, fitRef }: {
  frame: GridFrame; blocked: [number, number][]; footprints: Footprint[]; zoneColor: Map<string, string>; zonesFilter: string[]
  overlay: Overlay; occByLoc: Map<string, MapOccupancy>; hitLocIds: Set<string>; selectedKey: string | null; path: GridCell[]; door: Footprint | null
  tool: Tool; onCellClick: (c: GridCell) => void; onLineDrag: (a: GridCell, b: GridCell) => void
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
  const [lineStart, setLineStart] = useState<GridCell | null>(null)

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
    // chân kệ / cửa
    const dim = zonesFilter.length > 0
    for (const f of footprints) {
      if (!f.anchor) continue
      const X = px(f.anchor.x), Y = py(f.anchor.y), W = f.w * s, H = f.h * s
      let fill: string
      if (f.kind !== 'STORAGE') fill = KIND_COLOR[f.kind]
      else if (overlay === 'stock') {
        let used = 0, cap = 0
        for (const l of f.locs) { used += occByLoc.get(l.id)?.pallets ?? 0; cap += l.max_pallets > 0 ? l.max_pallets : 1 }
        fill = stockColor(cap ? used / cap : 0)
      } else fill = zoneColor.get(f.sub_code) ?? '#e2e8f0'
      const faded = dim && f.kind === 'STORAGE' && !zonesFilter.includes(f.sub_code)
      g.globalAlpha = faded ? 0.25 : 1
      g.fillStyle = fill; g.fillRect(X, Y, W, H)
      g.strokeStyle = f.kind === 'STORAGE' ? (f.is_rack ? '#64748b' : '#94a3b8') : '#ffffff'; g.lineWidth = f.kind === 'STORAGE' && f.is_rack ? 1 : 0.75
      g.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1)
      if (f.kind === 'STORAGE' && overlay === 'stock' && f.locs.some(l => (occByLoc.get(l.id)?.quarantine ?? 0) > 0)) { g.strokeStyle = '#d97706'; g.lineWidth = 2; g.strokeRect(X + 1, Y + 1, W - 2, H - 2) }
      // nhãn
      if (s >= 16 || (f.kind !== 'STORAGE' && s >= 10) || (f.w * s >= 40)) {
        const fs = Math.max(8, Math.min(13, Math.min(W, H) * 0.42))
        g.fillStyle = f.kind === 'STORAGE' ? '#0f172a' : '#ffffff'; g.font = `${f.kind === 'STORAGE' ? 500 : 600} ${fs}px ui-monospace, monospace`
        g.textAlign = 'center'; g.textBaseline = 'middle'
        const label = f.label.length > Math.max(3, Math.floor(W / (fs * 0.6))) ? f.label.slice(0, Math.max(3, Math.floor(W / (fs * 0.6)))) : f.label
        g.fillText(label, X + W / 2, Y + H / 2)
        if (f.kind === 'STORAGE' && f.locs.length > 1 && s >= 22) {
          g.font = `600 ${Math.max(7, fs * 0.7)}px ui-sans-serif, system-ui`; g.fillStyle = '#475569'; g.textAlign = 'right'; g.textBaseline = 'bottom'
          g.fillText(`${f.locs.length}`, X + W - 2, Y + H - 1)
        }
      }
      g.globalAlpha = 1
      // khớp tìm kiếm
      if (f.locs.some(l => hitLocIds.has(l.id))) { g.strokeStyle = '#ef4444'; g.lineWidth = Math.max(2, s * 0.15); g.strokeRect(X + 1, Y + 1, W - 2, H - 2) }
      if (f.key === selectedKey) { g.strokeStyle = '#0284c7'; g.lineWidth = Math.max(2.5, s * 0.2); g.strokeRect(X + 1, Y + 1, W - 2, H - 2) }
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
    // vệt rải dãy đang kéo
    if (lineStart && hover) {
      g.fillStyle = 'rgba(2,132,199,0.35)'
      for (const c of lineCells(lineStart, hover)) g.fillRect(px(c.x), py(c.y), s, s)
    } else if (hover && tool !== 'select') {
      g.strokeStyle = '#0ea5e9'; g.lineWidth = 2; g.strokeRect(px(hover.x) + 1, py(hover.y) + 1, s - 2, s - 2)
    }
  }, [size, view, frame, blocked, footprints, zoneColor, zonesFilter, overlay, occByLoc, hitLocIds, selectedKey, path, door, hover, lineStart, tool])

  // Tương tác: kéo = pan (hoặc vệt rải dãy), bấm = chọn ô, lăn = zoom, hai ngón = zoom
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
    if (tool === 'line' && cell) setLineStart(cell)
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
    if (tool === 'line' && lineStart) return   // đang kéo vệt: không pan
    setView(v => ({ ...v, ox: v.ox + dx, oy: v.oy + dy })); p.x = e.clientX; p.y = e.clientY
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const p = ptr.current
    if (!p || p.id !== e.pointerId) return
    ptr.current = null
    const cell = toCell(e.clientX, e.clientY)
    if (tool === 'line' && lineStart) {
      if (cell) onLineDrag(lineStart, cell)
      setLineStart(null)
      return
    }
    if (!p.moved && cell) onCellClick(cell)
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
