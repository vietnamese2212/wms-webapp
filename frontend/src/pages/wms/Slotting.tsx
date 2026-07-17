// Tối ưu vị trí (Slotting) — mục 6 roadmap, user chốt 17/07.
// Tab Phân tích: ABC velocity theo LƯỢT NHẶT (cửa sổ 30/60/90 ngày, RPC slotting_stats),
// gợi ý ở mức KHU (WarehouseZone.pick_rank: 1 = gần cửa xuất nhất, khai trong Cài đặt WMS).
// Tab Kế hoạch: sinh gợi ý dòng chuyển pallet (từ vị trí → vị trí) → lưu kế hoạch → công nhân
// chuyển bằng tính năng đổi vị trí sẵn có → tiến độ tự bám vị trí thực tế (realtime InventoryEntry).
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { Boxes, Plus, Trash2, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import { SearchInput } from '@/components/shared/SearchInput'
import { FormSheet } from '@/components/shared/FormSheet'
import { useColumnResize } from '@/components/shared/useColumnResize'
import {
  useSlotting, useSlottingPlans, useSlottingPreview, useCreateSlottingPlan, useDeleteSlottingPlan,
  type SlottingMaterial, type SlottingZone, type SlottingPlanRow, type SlottingPlanLineDraft,
  type SlottingLevel, type SlottingPrinciple, type SlottingWarning,
} from '@/api/hooks'
import { useScopedWarehouses, useScopedWhTypes } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate } from '@/utils/formatters'

const nf = new Intl.NumberFormat('vi-VN')

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// ABC badge: A = nhặt nhiều (ưu tiên cao nhất)
const ABC_BADGE: Record<string, string> = {
  A: 'bg-sky-600 text-white',
  B: 'bg-sky-100 text-sky-700',
  C: 'bg-slate-100 text-slate-500',
}
function AbcBadge({ abc }: { abc: string | null }) {
  if (!abc) return <span className="text-slate-300">—</span>
  return <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${ABC_BADGE[abc] ?? 'bg-slate-100 text-slate-500'}`}>{abc}</span>
}

// Band khu: A = gần cửa xuất
const BAND_CHIP: Record<string, string> = {
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-sky-50 text-sky-700 border-sky-200',
  C: 'bg-slate-100 text-slate-500 border-slate-200',
}

const PLAN_STATUS_BADGE: Record<string, string> = {
  ACTIVE:    'bg-sky-100 text-sky-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
}
const PLAN_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Đang thực hiện', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy',
}

const DAYS_OPTS = [
  { value: '30', label: '30 ngày' },
  { value: '60', label: '60 ngày' },
  { value: '90', label: '90 ngày' },
]
const LEVEL_OPTS = [
  { value: 'EASY',   label: 'Easy — Gom giải phóng chỗ' },
  { value: 'NORMAL', label: 'Normal — Gom theo date' },
  { value: 'HARD',   label: 'Hard — Tối ưu toàn diện (ABC)' },
]
const PRINCIPLE_OPTS = [
  { value: 'FEFO', label: 'FEFO — theo HSD' },
  { value: 'FIFO', label: 'FIFO — theo NSX' },
  { value: 'LIFO', label: 'LIFO — hàng mới trước' },
]
const LEVEL_LABEL: Record<string, string> = { EASY: 'Easy', NORMAL: 'Normal', HARD: 'Hard' }

export default function Slotting() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const admin = isAdmin(user?.name)
  const canPlan = admin || can(perms, 'slotting', 'plan')

  const { warehouseId, categories, days, level, principle, tab } = useWmsFilterStore(s => s.slotting)
  const setSlotting = useWmsFilterStore(s => s.setSlotting)

  const { data: rawWarehouses = [] } = useScopedWarehouses(true)
  const warehouses = rawWarehouses as { id: string; name: string }[]
  const { data: rawWhTypes = [] } = useScopedWhTypes()
  const whTypes = rawWhTypes as { id: string; value: string }[]

  // Kho mặc định = kho đầu trong scope (slotting bắt buộc chọn 1 kho)
  const effectiveWhId = warehouseId && warehouses.some(w => w.id === warehouseId) ? warehouseId : (warehouses[0]?.id ?? '')
  useEffect(() => {
    if (effectiveWhId && effectiveWhId !== warehouseId) setSlotting({ warehouseId: effectiveWhId })
  }, [effectiveWhId, warehouseId, setSlotting])

  const [search, setSearch] = useState('')

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', value: effectiveWhId,
      onChange: v => setSlotting({ warehouseId: v }), allLabel: '— Chọn kho',
      options: warehouses.map(w => ({ value: w.id, label: w.name })) },
    { key: 'cat', label: 'Loại kho', type: 'multi', selected: categories,
      onChange: (v: string[]) => setSlotting({ categories: v }),
      options: whTypes.map(t => ({ value: t.value, label: t.value })) },
    { key: 'level', label: 'Mức độ', type: 'single', value: level,
      onChange: v => setSlotting({ level: (v || 'NORMAL') as SlottingLevel }), allLabel: 'Normal — Gom theo date',
      options: LEVEL_OPTS },
    { key: 'principle', label: 'Nguyên tắc', type: 'single', value: principle,
      onChange: v => setSlotting({ principle: (v || 'FEFO') as SlottingPrinciple }), allLabel: 'FEFO — theo HSD',
      options: PRINCIPLE_OPTS },
    { key: 'days', label: 'Cửa sổ ABC', type: 'single', value: String(days),
      onChange: v => setSlotting({ days: Number(v) || 30 }), allLabel: '30 ngày',
      options: DAYS_OPTS },
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
              <Boxes className="h-4 w-4 text-sky-600" /> Tối ưu vị trí
            </h1>
            {/* Tabs */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-medium shrink-0">
              <button className={`px-2.5 py-1 ${tab === 'analysis' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setSlotting({ tab: 'analysis' })}>Phân tích ABC</button>
              <button className={`px-2.5 py-1 border-l border-slate-200 ${tab === 'plans' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setSlotting({ tab: 'plans' })}>Kế hoạch sắp xếp</button>
            </div>
            {tab === 'analysis' && (
              <SearchInput value={search} onChange={setSearch} placeholder="Tìm mã, tên hàng…" className="flex-1 min-w-[140px]" />
            )}
            <span className="sm:hidden ml-auto"><FilterSheetButton defs={filterDefs} /></span>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        {tab === 'analysis'
          ? <AnalysisTab warehouseId={effectiveWhId} categories={categories} days={days} level={level} principle={principle} search={search} canPlan={canPlan} />
          : <PlansTab warehouseId={effectiveWhId} canPlan={canPlan} onOpen={id => navigate(`/wms/slotting/plans/${id}`)} />}
      </div>
    </div>
  )
}

// ─── Tab Phân tích ABC ─────────────────────────────────────────────────────────
function AnalysisTab({ warehouseId, categories, days, level, principle, search, canPlan }: {
  warehouseId: string; categories: string[]; days: number
  level: SlottingLevel; principle: SlottingPrinciple; search: string; canPlan: boolean
}) {
  const { data, isLoading, error, refetch } = useSlotting(warehouseId, categories, days)
  const [showPlanSheet, setShowPlanSheet] = useState(false)

  const cols = ['Mã hàng', 'Tên hàng', 'Loại', 'Hạng', 'Lượt nhặt', 'Thùng xuất', '% lũy kế', 'Pallet tồn', 'Khu đang nằm', 'Khu đề xuất', 'Lệch chỗ']
  const { widths, startResize, totalWidth } = useColumnResize('slotting_col_widths',
    [96, 190, 84, 48, 72, 76, 66, 70, 200, 120, 76])

  const zoneByCode = useMemo(() => new Map((data?.zones ?? []).map(z => [z.code, z])), [data?.zones])

  const displayMats = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = data?.materials ?? []
    if (!q) return list
    return list.filter(m => `${m.code} ${m.name ?? ''}`.toLowerCase().includes(q))
  }, [data?.materials, search])

  const tiles: BandTile[] = useMemo(() => {
    const mats = data?.materials ?? []
    const nA = mats.filter(m => m.abc === 'A').length
    const nB = mats.filter(m => m.abc === 'B').length
    const nC = mats.filter(m => m.abc === 'C').length
    const misplacedMats = mats.filter(m => m.misplaced_pallets > 0)
    const misplacedPallets = mats.reduce((s, m) => s + m.misplaced_pallets, 0)
    return [
      { label: `Lượt nhặt ${days} ngày`, value: nf.format(data?.total_picks ?? 0), accent: true },
      { label: 'Mã hạng A', value: nf.format(nA) },
      { label: 'Mã hạng B', value: nf.format(nB) },
      { label: 'Mã hạng C', value: nf.format(nC) },
      { label: 'Mã lệch chỗ', value: nf.format(misplacedMats.length), danger: misplacedMats.length > 0 },
      { label: 'Pallet lệch chỗ', value: nf.format(misplacedPallets), danger: misplacedPallets > 0 },
    ]
  }, [data, days])

  if (!warehouseId) return <div className="p-8 text-center text-sm text-slate-400">Chọn kho để phân tích</div>

  return (
    <>
      <SummaryBand tiles={tiles} />

      {/* Dải khu + band (A = gần cửa xuất) + nút tạo kế hoạch */}
      <div className="border-b bg-slate-50 px-3 py-1.5 shrink-0 flex items-center gap-1.5 flex-wrap">
        <span className="text-[9px] font-medium uppercase text-slate-400 shrink-0">Khu (hạng nhặt):</span>
        {(data?.zones ?? []).map(z => (
          <span key={z.id} title={`${z.name} — sức chứa ${z.used_slots}/${z.capacity} pallet${z.pick_rank != null ? ` · hạng nhặt ${z.pick_rank}` : ' · chưa xếp hạng'}${z.slot_group ? ` · khu riêng ${z.slot_group}` : ''}`}
            className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${z.slot_group ? 'bg-purple-50 text-purple-700 border-purple-200' : z.band ? BAND_CHIP[z.band] : 'border-dashed border-slate-300 text-slate-400'}`}>
            {z.code}{z.pick_rank != null ? ` #${z.pick_rank}` : ''}{z.band ? ` · ${z.band}` : ''}{z.slot_group ? ` · 🔒${z.slot_group}` : ''}
          </span>
        ))}
        {data && !data.has_ranked_zones && level === 'HARD' && (
          <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Mức Hard cần Hạng nhặt của khu —
            <Link to="/wms/settings" className="underline font-medium">khai trong Cài đặt WMS → Khu vực</Link>
          </span>
        )}
        {canPlan && (
          <Button size="sm" className="ml-auto h-7 text-[11px]" disabled={!data || (level === 'HARD' && !data.has_ranked_zones)}
            onClick={() => setShowPlanSheet(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Tạo kế hoạch sắp xếp ({LEVEL_LABEL[level]} · {principle})
          </Button>
        )}
      </div>

      {/* Cảnh báo nhóm riêng (SCA…) — hàng lạ trong khu riêng KHÔNG tự sinh lệnh (user chốt) */}
      {(data?.warnings ?? []).length > 0 && <GroupWarnings warnings={data!.warnings} />}

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {error ? (
          <div className="m-3 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded flex items-center gap-2">
            {apiMsg(error)}
            <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto" onClick={() => refetch()}><RefreshCw className="h-3 w-3 mr-1" />Thử lại</Button>
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Đang phân tích…</div>
        ) : displayMats.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">Không có dữ liệu xuất/tồn trong cửa sổ {days} ngày</div>
        ) : (
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
            style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {cols.map((c, i) => (
                  <TableHead key={c} className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    <span className="relative block pr-1.5">
                      {c}
                      <span onPointerDown={e => startResize(i, e)} className="absolute top-0 -right-2 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayMats.map(m => <MatRow key={m.material_id} m={m} zoneByCode={zoneByCode} />)}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">
        1–{displayMats.length} / {(data?.materials ?? []).length} mã · xếp hạng theo lượt nhặt {days} ngày (A = 80% lượt nhặt lũy kế, B = 15% kế, C = còn lại)
      </div>

      {showPlanSheet && data && (
        <PlanCreateSheet open={showPlanSheet} onClose={() => setShowPlanSheet(false)}
          warehouseId={warehouseId} categories={categories} days={days} level={level} principle={principle} />
      )}
    </>
  )
}

// Cảnh báo nhóm riêng: GROUP_OUTSIDE = sẽ được kéo về khi tạo KH; FOREIGN_IN_GROUP = chỉ cảnh báo
function GroupWarnings({ warnings }: { warnings: SlottingWarning[] }) {
  const foreign = warnings.filter(w => w.type === 'FOREIGN_IN_GROUP')
  const outside = warnings.filter(w => w.type === 'GROUP_OUTSIDE')
  return (
    <div className="border-b bg-amber-50/60 px-3 py-1.5 shrink-0 space-y-0.5 text-[10px]">
      {foreign.length > 0 && (
        <p className="text-amber-800 flex items-start gap-1 flex-wrap">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span><b>Hàng lạ trong khu riêng</b> (chỉ cảnh báo — không tự sinh lệnh):{' '}
            {foreign.slice(0, 6).map(w => `${w.material_code} (${w.pallets} pallet ở ${w.zone_code}·${w.group})`).join(' · ')}
            {foreign.length > 6 ? ` … +${foreign.length - 6} mục` : ''}</span>
        </p>
      )}
      {outside.length > 0 && (
        <p className="text-purple-800 flex items-start gap-1 flex-wrap">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span><b>Mã thuộc khu riêng đang nằm ngoài</b> (tạo kế hoạch sẽ kéo về, ưu tiên cao nhất):{' '}
            {outside.slice(0, 6).map(w => `${w.material_code} (${w.pallets} pallet ở ${w.zone_code} → về khu ${w.group})`).join(' · ')}
            {outside.length > 6 ? ` … +${outside.length - 6} mục` : ''}</span>
        </p>
      )}
    </div>
  )
}

function MatRow({ m, zoneByCode }: { m: SlottingMaterial; zoneByCode: Map<string, SlottingZone> }) {
  return (
    <TableRow>
      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap sticky left-0 z-10 bg-white">{m.code}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap"><span className="block truncate" title={m.name ?? ''}>{m.name ?? <span className="text-slate-300">—</span>}</span></TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{m.category ?? <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap"><AbcBadge abc={m.abc} /></TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums whitespace-nowrap">{nf.format(m.picks)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{nf.format(m.cartons_out)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] tabular-nums text-slate-500 whitespace-nowrap">{m.picks > 0 ? `${Math.round(m.cum_share * 100)}%` : <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums whitespace-nowrap">{nf.format(m.stock_pallets)}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="flex gap-1 overflow-hidden">
          {m.zones_current.length === 0 && <span className="text-slate-300 text-[10px]">—</span>}
          {m.zones_current.map((zc, i) => {
            const band = zc.sub_code ? zoneByCode.get(zc.sub_code)?.band : null
            const off = band != null && band !== m.abc
            return (
              <span key={i} className={`text-[9px] px-1 py-0.5 rounded border whitespace-nowrap ${off ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                title={off ? `Khu band ${band} — lệch với hạng ${m.abc}` : undefined}>
                {zc.sub_code ?? 'Chưa có VT'}×{zc.pallets}
              </span>
            )
          })}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
        {m.suggested_zones.length > 0
          ? <span className="font-medium text-green-700">{m.suggested_zones.join(', ')}</span>
          : <span className="text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {m.misplaced_pallets > 0
          ? <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{nf.format(m.misplaced_pallets)} pallet</span>
          : <span className="text-slate-300 text-[10px]">—</span>}
      </TableCell>
    </TableRow>
  )
}

// ─── Sheet tạo kế hoạch (preview → chọn dòng → lưu) — dòng GOM (mã + date) ─────
const lineKey = (l: SlottingPlanLineDraft) => `${l.material_id}|${l.date_key ?? ''}|${l.from_location_id ?? ''}|${l.to_location_id}`

function PlanCreateSheet({ open, onClose, warehouseId, categories, days, level, principle }: {
  open: boolean; onClose: () => void
  warehouseId: string; categories: string[]; days: number
  level: SlottingLevel; principle: SlottingPrinciple
}) {
  const navigate = useNavigate()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [name, setName] = useState(`Sắp xếp kho ${today} (${LEVEL_LABEL[level]} · ${principle})`)
  const [maxMoves, setMaxMoves] = useState('100')
  const [err, setErr] = useState('')
  const [lines, setLines] = useState<SlottingPlanLineDraft[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState(0)

  const { mutate: preview, isPending: previewing } = useSlottingPreview()
  const { mutate: create, isPending: creating } = useCreateSlottingPlan()

  function handlePreview() {
    setErr('')
    const mm = Math.min(300, Math.max(1, Number(maxMoves) || 100))
    preview({ warehouse_id: warehouseId, level, principle, days, max_moves: mm, categories: categories.length > 0 ? categories : undefined }, {
      onSuccess: r => {
        setLines(r.lines)
        setChecked(new Set(r.lines.map(lineKey)))
        setSkipped(r.skipped_no_capacity)
        if (r.lines.length === 0) setErr(r.message ?? 'Không sinh được gợi ý nào')
      },
      onError: e => setErr(apiMsg(e)),
    })
  }
  function handleSave() {
    setErr('')
    const selected = (lines ?? []).filter(l => checked.has(lineKey(l)))
    if (!name.trim()) { setErr('Nhập tên kế hoạch'); return }
    if (selected.length === 0) { setErr('Chọn ít nhất 1 dòng chuyển'); return }
    create({ warehouse_id: warehouseId, name: name.trim(), level, principle, window_days: days, lines: selected }, {
      onSuccess: r => { onClose(); navigate(`/wms/slotting/plans/${r.id}`) },
      onError: e => setErr(apiMsg(e)),
    })
  }
  const nSel = (lines ?? []).filter(l => checked.has(lineKey(l))).length
  const nPallets = (lines ?? []).filter(l => checked.has(lineKey(l))).reduce((s, l) => s + l.n_pallets, 0)

  return (
    <FormSheet open={open} onClose={onClose} title={`Tạo kế hoạch sắp xếp — ${LEVEL_LABEL[level]} · ${principle}`} widthClass="sm:max-w-3xl" footer={<>
      <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
      <Button size="sm" onClick={handleSave} disabled={creating || nSel === 0}>
        {creating ? 'Đang lưu…' : `Lưu kế hoạch (${nSel} dòng · ${nPallets} pallet)`}
      </Button>
    </>}>
      <div className="space-y-3">
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
        <div className="flex gap-3 items-end flex-wrap">
          <div className="space-y-1 flex-1 min-w-[180px]">
            <Label className="text-xs">Tên kế hoạch *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Số dòng tối đa</Label>
            <Input type="number" min={1} max={300} value={maxMoves} onChange={e => setMaxMoves(e.target.value)} className="w-24" />
          </div>
          <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewing}>
            {previewing ? 'Đang sinh…' : lines ? 'Sinh lại gợi ý' : 'Sinh gợi ý'}
          </Button>
        </div>
        <p className="text-[10px] text-slate-400">
          {level === 'EASY' && 'Easy: gom mã đang rải nhiều vị trí về ít vị trí — giải phóng chỗ trống, không quan tâm date.'}
          {level === 'NORMAL' && (principle === 'LIFO'
            ? 'Normal · LIFO: dồn hàng cùng mã date DÀI vào vị trí đang chứa date ngắn.'
            : `Normal · ${principle}: dồn hàng cùng mã date NGẮN vào vị trí đang chứa date dài${principle === 'FEFO' ? ' (so theo HSD)' : ' (so theo NSX)'}.`)}
          {level === 'HARD' && `Hard: đảo khu theo ABC (${days} ngày) + gom theo date ${principle} — cần chỗ trống đệm.`}
          {' '}Mã thuộc khu riêng nằm ngoài luôn được kéo về trước tiên. Pallet đang giữ cho đơn xuất được bỏ qua. Dòng = 1 lệnh gom (Mã + Date), đã kiểm sức chứa vị trí đích.
        </p>
        {skipped > 0 && <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{skipped} pallet bị bỏ vì vị trí đích hết chỗ trống</p>}

        {lines && lines.length > 0 && (
          <div className="border rounded-lg overflow-x-auto">
            <Table className="min-w-max">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-1.5 w-8">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600"
                      checked={nSel === lines.length}
                      onChange={e => setChecked(e.target.checked ? new Set(lines.map(lineKey)) : new Set())} />
                  </TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã hàng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Date</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Hạng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">SL pallet</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Từ vị trí</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Đến vị trí</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Lý do</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => {
                  const k = lineKey(l)
                  return (
                    <TableRow key={k} className="cursor-pointer"
                      onClick={() => setChecked(prev => {
                        const next = new Set(prev)
                        if (next.has(k)) next.delete(k)
                        else next.add(k)
                        return next
                      })}>
                      <TableCell className="px-2 py-1">
                        <input type="checkbox" readOnly className="h-3.5 w-3.5 accent-blue-600 pointer-events-none" checked={checked.has(k)} />
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap"><span className="font-mono font-semibold">{l.material_code}</span><span className="text-slate-400 ml-1">{l.material_name}</span></TableCell>
                      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{l.date_key ?? <span className="text-slate-300">—</span>}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap"><AbcBadge abc={l.abc} /></TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums whitespace-nowrap">{l.n_pallets}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{l.from_location_code ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold text-green-700 whitespace-nowrap">{l.to_location_code ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap"><span className="block max-w-[240px] truncate" title={`${l.reason}${l.flow_note ? ` · ${l.flow_note}` : ''}`}>{l.reason}{l.flow_note ? ` · ${l.flow_note}` : ''}</span></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </FormSheet>
  )
}

// ─── Tab Kế hoạch ──────────────────────────────────────────────────────────────
function PlansTab({ warehouseId, canPlan, onOpen }: {
  warehouseId: string; canPlan: boolean; onOpen: (id: string) => void
}) {
  const { data: plans = [], isLoading, error } = useSlottingPlans(warehouseId || undefined)
  const { mutate: deletePlan, isPending: deleting } = useDeleteSlottingPlan()
  const [delErr, setDelErr] = useState('')

  function handleDelete(p: SlottingPlanRow) {
    if (!confirm(`Xóa kế hoạch "${p.name}" (${p.n_lines} dòng)?\nChỉ xóa bản kế hoạch — pallet đã chuyển KHÔNG bị hoàn tác.`)) return
    deletePlan(p.id, { onError: e => setDelErr(apiMsg(e)) })
  }

  const tiles: BandTile[] = [
    { label: 'Kế hoạch', value: nf.format(plans.length) },
    { label: 'Đang thực hiện', value: nf.format(plans.filter(p => p.status === 'ACTIVE').length), accent: true },
    { label: 'Hoàn thành', value: nf.format(plans.filter(p => p.status === 'COMPLETED').length) },
  ]

  return (
    <>
      <SummaryBand tiles={tiles} />
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {delErr && <div className="m-3 p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">{delErr}</div>}
        {error ? (
          <div className="m-3 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded">{apiMsg(error)}</div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
        ) : plans.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Boxes className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">Chưa có kế hoạch sắp xếp nào</p>
            {canPlan && <p className="text-xs">Sang tab "Phân tích ABC" → "Tạo kế hoạch sắp xếp"</p>}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên kế hoạch</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tiến độ (pallet)</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Số dòng</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mức độ</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Nguyên tắc</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Người tạo</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ngày tạo</TableHead>
                {canPlan && <TableHead className="px-2 py-1.5 w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map(p => {
                const pct = p.progress && p.progress.total_pallets > 0 ? Math.round((p.progress.done_pallets / p.progress.total_pallets) * 100) : null
                return (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(p.id)}>
                    <TableCell className="px-2 py-1 text-[10px] font-medium whitespace-nowrap">{p.name}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${PLAN_STATUS_BADGE[p.status]}`}>{PLAN_STATUS_LABEL[p.status]}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {p.status === 'ACTIVE' && p.progress ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-20 h-1.5 rounded bg-slate-200 overflow-hidden inline-block">
                            <span className="block h-1.5 bg-sky-500" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="text-[10px] tabular-nums font-semibold">{p.progress.done_pallets}/{p.progress.total_pallets}</span>
                        </span>
                      ) : <span className="text-slate-300 text-[10px]">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{p.n_lines}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{p.level ? LEVEL_LABEL[p.level] : '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{p.principle ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{p.created_by ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{formatTimestampDate(p.created_at, true)}</TableCell>
                    {canPlan && (
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <button className="text-slate-400 hover:text-red-500 p-1 transition-colors" disabled={deleting}
                          onClick={e => { e.stopPropagation(); handleDelete(p) }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1–{plans.length} / {plans.length} kế hoạch</div>
    </>
  )
}
