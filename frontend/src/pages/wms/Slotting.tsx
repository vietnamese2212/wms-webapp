// Tối ưu vị trí (Slotting) — mục 6 roadmap, user chốt 17/07.
// Tab Phân tích: ABC velocity theo LƯỢT NHẶT (cửa sổ 30/60/90 ngày, RPC slotting_stats),
// gợi ý ở mức KHU (WarehouseZone.pick_rank: 1 = gần cửa xuất nhất, khai trong Cài đặt WMS).
// Tab Kế hoạch: sinh gợi ý dòng chuyển pallet (từ vị trí → vị trí) → lưu kế hoạch → công nhân
// chuyển bằng tính năng đổi vị trí sẵn có → tiến độ tự bám vị trí thực tế (realtime InventoryEntry).
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { Boxes, Plus, Trash2, RefreshCw, AlertTriangle, QrCode } from 'lucide-react'
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
  useWarehouseZones, useUpdateSlottingZoneConfig, useLocationsReal, useUpdateSlottingLocationConfig,
  type WarehouseZone,
  type SlottingMaterial, type SlottingZone, type SlottingPlanRow, type SlottingPlanLineDraft,
  type SlottingLevel, type SlottingPrinciple, type SlottingWarning, type SlottingImpact,
} from '@/api/hooks'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useScopedWarehouses, useScopedWhTypes } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate } from '@/utils/formatters'
import { unlockAudio } from '@/utils/audio'
import { PlanScanOverlay } from './PlanScanOverlay'

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
// Nhãn NGẮN để chip filter gọn (user 18/07: filter nhỏ lại, bảng chiếm ~80%)
const LEVEL_OPTS = [
  { value: 'EASY',   label: 'Easy — gom chỗ' },
  { value: 'NORMAL', label: 'Normal — gom date' },
  { value: 'HARD',   label: 'Hard — ABC' },
]
const PRINCIPLE_OPTS = [
  { value: 'FEFO', label: 'FEFO (HSD)' },
  { value: 'FIFO', label: 'FIFO (NSX)' },
  { value: 'LIFO', label: 'LIFO' },
]
const LEVEL_LABEL: Record<string, string> = { EASY: 'Easy', NORMAL: 'Normal', HARD: 'Hard' }

export default function Slotting() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const admin = isAdmin(user?.name)
  const canPlan = admin || can(perms, 'slotting', 'plan')
  const canConfigure = admin || can(perms, 'slotting', 'configure')
  // Quét thực hiện lệnh = thao tác Chuyển vị trí pallet → đúng quyền inventory.move_location (cross-module)
  const canScanMove = admin || can(perms, 'inventory', 'move_location')

  const { warehouseId, categories, days, level, principle, tab, palletKind: rawPalletKind } = useWmsFilterStore(s => s.slotting)
  // ?? 'FULL': state persist cũ (trước khi thêm field) không có palletKind
  const palletKind = rawPalletKind ?? 'FULL'
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
  const [showPlanSheet, setShowPlanSheet] = useState(false)
  // Query phân tích ở CHA để nút "Tạo kế hoạch" nằm trên toolbar (chuẩn table-format: action lên trên);
  // chỉ fetch khi đang ở tab Phân tích ('' = disabled)
  const analysisQuery = useSlotting(tab === 'analysis' ? effectiveWhId : '', categories, days)
  const { data: analysisData } = analysisQuery

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', value: effectiveWhId,
      onChange: v => setSlotting({ warehouseId: v }), allLabel: '— Chọn kho',
      options: warehouses.map(w => ({ value: w.id, label: w.name })) },
    // pinned: Loại kho là filter BẮT BUỘC để tạo kế hoạch → chip luôn hiện, xóa giá trị không biến mất (user 18/07)
    { key: 'cat', label: 'Loại kho', type: 'multi', selected: categories, pinned: true,
      onChange: (v: string[]) => setSlotting({ categories: v }),
      options: whTypes.map(t => ({ value: t.value, label: t.value })) },
    { key: 'level', label: 'Mức độ', type: 'single', value: level,
      onChange: v => setSlotting({ level: (v || 'NORMAL') as SlottingLevel }), allLabel: 'Normal — gom date',
      options: LEVEL_OPTS },
    { key: 'principle', label: 'Nguyên tắc', type: 'single', value: principle,
      onChange: v => setSlotting({ principle: (v || 'FEFO') as SlottingPrinciple }), allLabel: 'FEFO (HSD)',
      options: PRINCIPLE_OPTS },
    // Hàng chẵn/lẻ (user 18/07 "hầu hết chỉ dồn hàng chẵn"): mặc định = Chỉ hàng chẵn (pallet nguyên).
    // Giá trị TƯỜNG MINH (không dùng '' = allLabel) để chip luôn hiện "Pallet: Hàng chẵn" — xóa ✕ = về mặc định chẵn
    { key: 'palletKind', label: 'Pallet', type: 'single', value: palletKind,
      onChange: v => setSlotting({ palletKind: (v === 'PARTIAL' || v === 'ALL') ? v : 'FULL' }),
      allLabel: 'Hàng chẵn (mặc định)',
      options: [
        { value: 'FULL', label: 'Hàng chẵn (pallet nguyên)' },
        { value: 'PARTIAL', label: 'Chỉ hàng lẻ' },
        { value: 'ALL', label: 'Chẵn + lẻ' },
      ] },
    { key: 'days', label: 'Cửa sổ ABC', type: 'single', value: String(days),
      onChange: v => setSlotting({ days: Number(v) || 30 }), allLabel: '30 ngày',
      options: DAYS_OPTS },
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-1.5 shrink-0 sm:rounded-t-xl space-y-1">
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
              {canConfigure && (
                <button className={`px-2.5 py-1 border-l border-slate-200 ${tab === 'config' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  onClick={() => setSlotting({ tab: 'config' })}>Cài đặt</button>
              )}
            </div>
            {tab === 'analysis' && (
              <SearchInput value={search} onChange={setSearch} placeholder="Tìm mã, tên hàng…" className="flex-1 min-w-[140px]" />
            )}
            {/* Action chính trên toolbar (chuẩn table-format) */}
            {tab === 'analysis' && canPlan && (
              <Button size="sm" className="h-7 text-[11px] ml-auto shrink-0"
                disabled={!analysisData || categories.length === 0 || (level === 'HARD' && !analysisData.has_ranked_zones)}
                title={categories.length === 0 ? 'Chọn Loại kho (filter) trước — kế hoạch đi theo từng loại hàng' : undefined}
                onClick={() => setShowPlanSheet(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {categories.length === 0 ? 'Tạo kế hoạch — chọn Loại kho trước' : `Tạo kế hoạch (${LEVEL_LABEL[level]} · ${principle})`}
              </Button>
            )}
            <span className="sm:hidden ml-auto"><FilterSheetButton defs={filterDefs} /></span>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        {tab === 'analysis' && <AnalysisTab warehouseId={effectiveWhId} query={analysisQuery} days={days} level={level} search={search} />}
        {tab === 'plans' && <PlansTab warehouseId={effectiveWhId} canPlan={canPlan} canScan={canScanMove} onOpen={id => navigate(`/wms/slotting/plans/${id}`)} />}
        {tab === 'config' && (canConfigure
          ? <ConfigTab warehouseId={effectiveWhId} categories={categories} />
          : <div className="p-8 text-center text-sm text-slate-400">Không có quyền Cài đặt</div>)}
      </div>

      {showPlanSheet && analysisData && (
        <PlanCreateSheet open={showPlanSheet} onClose={() => setShowPlanSheet(false)}
          warehouseId={effectiveWhId} categories={categories} days={days} level={level} principle={principle} palletKind={palletKind} />
      )}
    </div>
  )
}

// ─── Tab Phân tích ABC ─────────────────────────────────────────────────────────
function AnalysisTab({ warehouseId, query, days, level, search }: {
  warehouseId: string; query: ReturnType<typeof useSlotting>; days: number
  level: SlottingLevel; search: string
}) {
  const { data, isLoading, error, refetch } = query

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

      {/* Dải khu + band (A = gần cửa xuất) — 1 DÒNG cuộn ngang (nén để bảng chiếm ~80% — user 18/07) */}
      <div className="border-b bg-slate-50 px-3 py-1 shrink-0 flex items-center gap-1.5 flex-nowrap overflow-x-auto">
        <span className="text-[9px] font-medium uppercase text-slate-400 shrink-0">Khu:</span>
        {(data?.zones ?? []).map(z => (
          <span key={z.id} title={`${z.name} — loại ${z.category ?? 'đa dụng'} · sức chứa ${z.used_slots}/${z.capacity} pallet${z.pick_rank != null ? ` · hạng nhặt ${z.pick_rank}` : ' · chưa xếp hạng'}`}
            className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${z.band ? BAND_CHIP[z.band] : 'border-dashed border-slate-300 text-slate-400'}`}>
            {z.code}{z.pick_rank != null ? ` #${z.pick_rank}` : ''}{z.band ? ` · ${z.band}` : ''}
          </span>
        ))}
        {data && !data.has_ranked_zones && level === 'HARD' && (
          <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 flex items-center gap-1 whitespace-nowrap shrink-0">
            <AlertTriangle className="h-3 w-3" /> Mức Hard cần Hạng nhặt của khu —
            <Link to="/wms/slotting" className="underline font-medium">khai ở tab Cài đặt</Link>
          </span>
        )}
      </div>

      {/* Cảnh báo pallet nằm SAI LOẠI khu (vd hàng thường trong khu SCA) — chỉ cảnh báo,
          muốn sinh lệnh kéo về thì tick ô trong sheet Tạo kế hoạch (user chốt) */}
      {(data?.warnings ?? []).length > 0 && <CategoryWarnings warnings={data!.warnings} />}

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
    </>
  )
}

// Cảnh báo pallet nằm SAI LOẠI khu — chỉ cảnh báo; kéo về = checkbox lúc tạo kế hoạch.
// NÉN 1 dòng (bảng chiếm ~80% — user 18/07): chi tiết đầy đủ trong tooltip.
function CategoryWarnings({ warnings }: { warnings: SlottingWarning[] }) {
  const total = warnings.reduce((s, w) => s + w.pallets, 0)
  const detail = warnings.map(w => `${w.material_code} [${w.material_category ?? 'chưa khai loại'}] — ${w.pallets} pallet ở ${w.zone_code} (khu ${w.zone_category})`).join('\n')
  return (
    <div className="border-b bg-amber-50/60 px-3 py-1 shrink-0 text-[10px] flex items-center gap-1 min-w-0" title={detail}>
      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-700" />
      <span className="text-amber-800 truncate">
        <b>{nf.format(total)} pallet nằm sai loại khu</b> (rê chuột xem chi tiết — muốn kéo về đúng khu, tick ô trong "Tạo kế hoạch"):{' '}
        {warnings.slice(0, 6).map(w => `${w.material_code}×${w.pallets}@${w.zone_code}`).join(' · ')}
        {warnings.length > 6 ? ` … +${warnings.length - 6}` : ''}
      </span>
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

function PlanCreateSheet({ open, onClose, warehouseId, categories, days, level, principle, palletKind }: {
  open: boolean; onClose: () => void
  warehouseId: string; categories: string[]; days: number
  level: SlottingLevel; principle: SlottingPrinciple; palletKind: 'FULL' | 'PARTIAL' | 'ALL'
}) {
  const navigate = useNavigate()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [name, setName] = useState(`Sắp xếp ${categories.length > 0 ? categories.join('+') : 'kho'} ${today} (${LEVEL_LABEL[level]} · ${principle})`)
  const [maxMoves, setMaxMoves] = useState('300')
  const [pullWrongZone, setPullWrongZone] = useState(false)
  const [err, setErr] = useState('')
  const [lines, setLines] = useState<SlottingPlanLineDraft[] | null>(null)
  const [impact, setImpact] = useState<SlottingImpact | null>(null)
  const [totalGen, setTotalGen] = useState(0)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState(0)

  const { mutate: preview, isPending: previewing } = useSlottingPreview()
  const { mutate: create, isPending: creating } = useCreateSlottingPlan()

  function handlePreview() {
    setErr('')
    const mm = Math.min(500, Math.max(1, Number(maxMoves) || 300))
    preview({ warehouse_id: warehouseId, level, principle, days, max_moves: mm, pull_wrong_zone: pullWrongZone, pallet_kind: palletKind, categories: categories.length > 0 ? categories : undefined }, {
      onSuccess: r => {
        setLines(r.lines)
        setImpact(r.impact ?? null)
        setTotalGen(r.total_generated ?? r.lines.length)
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
            <Input type="number" min={1} max={500} value={maxMoves} onChange={e => setMaxMoves(e.target.value)} className="w-24" />
          </div>
          <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewing}>
            {previewing ? 'Đang sinh…' : lines ? 'Sinh lại gợi ý' : 'Sinh gợi ý'}
          </Button>
        </div>
        {/* Kéo pallet nằm sai loại khu về đúng khu (vd hàng thường lạc trong khu SCA, mã SCA lạc ra ngoài) */}
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input type="checkbox" checked={pullWrongZone} onChange={e => setPullWrongZone(e.target.checked)} className="h-3.5 w-3.5 rounded accent-blue-600" />
          Kéo hàng nằm <b>sai loại khu</b> về đúng khu (ưu tiên cao nhất — mặc định chỉ cảnh báo)
        </label>
        <p className="text-[10px] text-slate-400">
          {level === 'EASY' && 'Easy: gom mã đang rải nhiều vị trí về ít vị trí — giải phóng chỗ trống, không quan tâm date.'}
          {level === 'NORMAL' && (principle === 'LIFO'
            ? 'Normal · LIFO: dồn hàng cùng mã date DÀI vào vị trí đang chứa date ngắn.'
            : `Normal · ${principle}: dồn hàng cùng mã date NGẮN vào vị trí đang chứa date dài${principle === 'FEFO' ? ' (so theo HSD)' : ' (so theo NSX)'}.`)}
          {level === 'HARD' && `Hard: đảo khu theo ABC (${days} ngày) + gom theo date ${principle} — cần chỗ trống đệm.`}
          {' '}Vị trí "không đưa hàng vào" không bao giờ làm đích và hàng ở đó luôn bị kéo đi trước; vị trí "không lấy hàng đi" bị loại khỏi nguồn (tab Cài đặt). Pallet đang giữ cho đơn xuất được bỏ qua.
          {' '}<b>Pallet: {palletKind === 'FULL' ? 'chỉ dồn HÀNG CHẴN (pallet nguyên như nhập — pallet lẻ để yên, vẫn tính chiếm chỗ)' : palletKind === 'PARTIAL' ? 'chỉ dồn HÀNG LẺ (pallet đã bốc dở)' : 'dồn cả hàng chẵn + lẻ'}</b> (đổi ở filter "Pallet"). Dòng = 1 lệnh gom (Mã + Date), đã kiểm sức chứa đích tại từng thời điểm.
          {' '}<b>Thứ tự dòng = thứ tự thực hiện (làm từ trên xuống)</b>: cùng mã đứng cạnh nhau, cùng đích nhiều date thì dòng xếp vào TRƯỚC nằm trên ({principle === 'LIFO' ? 'LIFO: date ngắn vào trước, date dài nằm ngoài' : `${principle}: date dài vào trước, date ngắn nằm ngoài để lấy trước`}).
        </p>
        {skipped > 0 && <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{skipped} pallet bị bỏ vì vị trí đích hết chỗ trống</p>}
        {/* KHÔNG cắt âm thầm: gợi ý sinh nhiều hơn trần → báo rõ còn bao nhiêu dòng chưa hiện */}
        {lines && totalGen > lines.length && (
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            Sinh được {nf.format(totalGen)} dòng nhưng chỉ hiện {nf.format(lines.length)} dòng đầu (ưu tiên cao trước) — làm xong kế hoạch này rồi "Tạo kế hoạch" tiếp để xử phần còn lại, hoặc tăng "Số dòng tối đa" (tối đa 500/kế hoạch).
          </p>
        )}

        {/* Kết quả kỳ vọng — user 18/07: "biết làm nhưng chưa biết đúng sai" → phân tích để soi từng gợi ý */}
        {impact && lines && lines.length > 0 && (
          <div className="text-[11px] bg-sky-50 border border-sky-200 rounded px-2.5 py-2 space-y-1">
            <p className="font-semibold text-sky-800">Kết quả kỳ vọng nếu thực hiện đủ {impact.lines} dòng ({nf.format(impact.moved_pallets)} pallet chuyển):</p>
            <ul className="list-disc pl-4 space-y-0.5 text-sky-900">
              {impact.freed_locations > 0 && (
                <li><b>Giải phóng hoàn toàn {impact.freed_locations} vị trí</b> (trống để dùng — trong phạm vi loại đã chọn):{' '}
                  <span className="font-mono">{impact.freed_location_codes.join(', ')}</span>{impact.freed_locations > impact.freed_location_codes.length ? '…' : ''}</li>
              )}
              {impact.temp_cleared_pallets > 0 && <li>Dọn sạch {nf.format(impact.temp_cleared_pallets)} pallet khỏi vị trí tạm (không đưa hàng vào)</li>}
              {impact.wrong_zone_pallets > 0 && <li>{nf.format(impact.wrong_zone_pallets)} pallet nằm sai loại khu được kéo về đúng khu</li>}
              {impact.abc_pallets > 0 && <li>{nf.format(impact.abc_pallets)} pallet đảo khu theo hạng ABC (mã nhặt nhiều về gần cửa, nhặt ít ra xa)</li>}
              {impact.date_group_pallets > 0 && <li>{nf.format(impact.date_group_pallets)} pallet gom theo date ({principle}) — sau gom, mỗi vị trí chứa cùng mã với dải date liền nhau, xuất đúng chiều {principle}</li>}
              {impact.free_group_pallets > 0 && <li>{nf.format(impact.free_group_pallets)} pallet gom mã đang rải rác về ít vị trí</li>}
              {impact.freed_locations === 0 && impact.moved_pallets > 0 && <li>Chưa giải phóng trọn vị trí nào (nguồn còn pallet ở lại hoặc bị giữ cho đơn xuất)</li>}
            </ul>
            <p className="text-[10px] text-sky-700">
              Cách soi đúng/sai từng dòng: nhìn cột <b>"Đích đang chứa"</b> — đích hợp lý phải là vị trí trống hoặc đang chứa CÙNG MÃ với date đúng chiều {principle === 'LIFO' ? 'LIFO (đích chứa date ngắn hơn hàng chuyển đến)' : `${principle} (đích chứa date dài hơn hàng chuyển đến)`}; <b>"Trống sau"</b> = số chỗ còn dư ở đích sau khi thực hiện (0 = vừa khít, không âm).
            </p>
            <p className="text-[10px] text-sky-700">
              Mỗi pallet chỉ chuyển 1 lần/kế hoạch — vài pallet dạng hoán đổi dây chuyền (chỗ này trống ra thì chỗ kia mới dồn được) sẽ hiện khi <b>Sinh gợi ý lần nữa SAU khi làm xong</b> đợt này; đợt 2 thường rất nhỏ (~1–3%) và đợt 3 = 0.
            </p>
          </div>
        )}

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
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Đích đang chứa</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trống sau</TableHead>
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
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                        {l.to_current === 'Trống'
                          ? <span className="text-slate-400">Trống</span>
                          : <span className="block max-w-[220px] truncate text-slate-600" title={l.to_current}>{l.to_current ?? '—'}</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">
                        {l.to_free_after != null
                          ? <span className={l.to_free_after === 0 ? 'text-amber-600 font-semibold' : 'text-slate-600'}>{l.to_free_after} chỗ</span>
                          : <span className="text-slate-300">—</span>}
                      </TableCell>
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

// ─── Tab Cài đặt (quyền slotting.configure) — cấu hình slotting per KHU ───────
// Hạng nhặt (1 = gần cửa xuất nhất) + Luồng cửa. Loại kho của khu/mã quản ở chỗ cũ
// (Cài đặt WMS / Mã hàng) — khu SCA = tạo Loại kho riêng rồi gán khu + mã (user chốt v3).
function ConfigTab({ warehouseId, categories }: { warehouseId: string; categories: string[] }) {
  const { data: zones = [], isLoading } = useWarehouseZones(warehouseId || undefined)
  const { mutate: updateCfg, isPending } = useUpdateSlottingZoneConfig()
  const [err, setErr] = useState('')
  const [draftRank, setDraftRank] = useState<Record<string, string>>({})

  function saveRank(z: WarehouseZone, raw: string) {
    const trimmed = raw.trim()
    const current = z.pick_rank != null ? String(z.pick_rank) : ''
    if (trimmed === current) return
    const n = trimmed === '' ? null : Number(trimmed)
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 999)) { setErr(`Hạng nhặt khu ${z.code}: phải là số nguyên 1–999 (hoặc trống)`); return }
    setErr('')
    updateCfg({ id: z.id, pick_rank: n }, { onError: e => setErr(apiMsg(e)) })
  }
  function saveFlow(z: WarehouseZone, v: string) {
    setErr('')
    updateCfg({ id: z.id, flow_type: v || null }, { onError: e => setErr(apiMsg(e)) })
  }

  if (!warehouseId) return <div className="p-8 text-center text-sm text-slate-400">Chọn kho để cài đặt</div>
  const guide = 'Hạng nhặt: độ gần cửa xuất của khu — 1 = gần nhất; trống = khu không tham gia gợi ý ABC (mức Hard). Luồng cửa: quyết định hướng dẫn xếp trong dãy in trên phiếu kế hoạch. Khu đặc thù (kho lạnh…): dùng Loại kho — tạo Loại riêng (vd SCA) trong Cài đặt WMS → Loại kho, gán cho khu + các mã hàng của nó; slotting chỉ ghép mã đúng Loại với khu đúng Loại.'
  return (
    <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
      {/* Hướng dẫn nén 1 dòng — rê chuột xem đủ (bảng chiếm ~80%, user 18/07) */}
      <div className="px-3 py-1 text-[10px] text-slate-500 border-b bg-slate-50 truncate" title={guide}>{guide}</div>
      {err && <p className="m-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
      <LocationConfig warehouseId={warehouseId} categories={categories} />
      {isLoading ? (
        <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
      ) : (
        <Table className="[&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã khu</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên khu</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Loại kho</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Hạng nhặt (1 = gần cửa nhất)</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Luồng cửa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(zones as WarehouseZone[]).filter(z => z.is_active).map(z => (
              <TableRow key={z.id}>
                <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{z.code}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{z.name}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{z.category ?? <span className="text-slate-300">— đa dụng</span>}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <Input type="number" min={1} max={999} disabled={isPending}
                    className="h-7 w-20 text-xs !min-h-0"
                    value={draftRank[z.id] ?? (z.pick_rank != null ? String(z.pick_rank) : '')}
                    onChange={e => setDraftRank(prev => ({ ...prev, [z.id]: e.target.value }))}
                    onBlur={e => saveRank(z, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    placeholder="—" />
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <Select value={z.flow_type ?? '__none__'} onValueChange={v => saveFlow(z, v === '__none__' ? '' : v)} disabled={isPending}>
                    <SelectTrigger className="h-7 w-52 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">— Chưa khai</SelectItem>
                      <SelectItem value="SAME_END" className="text-xs">Xuất nhập cùng 1 đầu</SelectItem>
                      <SelectItem value="FLOW_THROUGH" className="text-xs">Nhập 1 đầu, xuất 1 đầu</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

// Cấu hình VỊ TRÍ (user 18/07): 2 danh sách chọn dropdown per kho —
// "KHÔNG đưa hàng vào" (kho tạm: không làm đích + hàng ở đó luôn bị kéo đi trước)
// và "KHÔNG lấy hàng đi" (hàng kẹt không bốc được: loại khỏi nguồn tính toán).
function LocationConfig({ warehouseId, categories }: { warehouseId: string; categories: string[] }) {
  const { data: locations = [], isLoading } = useLocationsReal({ warehouse_id: warehouseId }, !!warehouseId)
  const { mutate: save, isPending } = useUpdateSlottingLocationConfig()
  const [noIn, setNoIn] = useState<string[]>([])
  const [noOut, setNoOut] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  type LocRow = { id: string; location_code: string; category?: string | null; is_active?: boolean; slot_no_in?: boolean; slot_no_out?: boolean }
  const locs = (locations as LocRow[]).filter(l => l.is_active !== false)

  // Nạp trạng thái hiện tại từ TOÀN BỘ vị trí của kho (không theo filter Loại kho) —
  // nút Lưu là replace-all per kho: nếu chỉ nạp vị trí trong filter sẽ XÓA NHẦM cờ của vị trí đang bị ẩn
  useEffect(() => {
    if (dirty) return
    setNoIn(locs.filter(l => l.slot_no_in).map(l => l.id))
    setNoOut(locs.filter(l => l.slot_no_out).map(l => l.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, warehouseId])
  useEffect(() => { setDirty(false); setMsg(''); setErr('') }, [warehouseId])

  // Option theo filter Loại kho phía trên (user 18/07): vị trí đúng loại + vị trí CHƯA khai loại;
  // vị trí ĐÃ chọn luôn hiện (kể cả ngoài filter) để còn bỏ chọn được
  const optionsFor = (selectedIds: string[]) => {
    const sel = new Set(selectedIds)
    return locs
      .filter(l => categories.length === 0 || !l.category || categories.includes(l.category) || sel.has(l.id))
      .map(l => ({ value: l.id, label: l.category ? `${l.location_code} · ${l.category}` : l.location_code }))
  }

  function handleSave() {
    setMsg(''); setErr('')
    save({ warehouse_id: warehouseId, no_in_ids: noIn, no_out_ids: noOut }, {
      onSuccess: r => { setDirty(false); setMsg(`Đã lưu: ${r.no_in} vị trí không đưa hàng vào · ${r.no_out} vị trí không lấy hàng đi`) },
      onError: e => setErr(apiMsg(e)),
    })
  }

  return (
    // NÉN 1 hàng (bảng khu chiếm ~80% — user 18/07): nhãn + dropdown + Lưu nằm ngang, mô tả trong tooltip
    <div className="px-3 py-1.5 border-b space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-1 h-3.5 rounded bg-sky-500 shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 shrink-0">Vị trí đặc biệt</span>
        <span className="text-[10px] text-slate-500 shrink-0" title="Kho tạm — không làm đích, hàng nằm đó luôn bị kéo đi">Không đưa hàng vào:</span>
        <MultiSelectFilter label={noIn.length > 0 ? `${noIn.length} vị trí` : 'Chọn vị trí…'} options={optionsFor(noIn)}
          selected={noIn} onChange={v => { setNoIn(v); setDirty(true); setMsg('') }} selectedFirst />
        <span className="text-[10px] text-slate-500 shrink-0" title="Hàng kẹt/không bốc được — loại khỏi nguồn tính toán, vẫn tính chiếm chỗ">Không lấy hàng đi:</span>
        <MultiSelectFilter label={noOut.length > 0 ? `${noOut.length} vị trí` : 'Chọn vị trí…'} options={optionsFor(noOut)}
          selected={noOut} onChange={v => { setNoOut(v); setDirty(true); setMsg('') }} selectedFirst />
        <Button size="sm" className="h-7 text-[11px] !min-h-0" onClick={handleSave} disabled={isPending || !dirty}>
          {isPending ? 'Đang lưu…' : 'Lưu vị trí'}
        </Button>
        {isLoading && <span className="text-[10px] text-slate-400">Đang tải…</span>}
      </div>
      {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</p>}
      {msg && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">{msg}</p>}
    </div>
  )
}

// ─── Tab Kế hoạch ──────────────────────────────────────────────────────────────
function PlansTab({ warehouseId, canPlan, canScan, onOpen }: {
  warehouseId: string; canPlan: boolean; canScan: boolean; onOpen: (id: string) => void
}) {
  const { data: plans = [], isLoading, error } = useSlottingPlans(warehouseId || undefined)
  const { mutate: deletePlan, isPending: deleting } = useDeleteSlottingPlan()
  const [delErr, setDelErr] = useState('')
  // Overlay quét thực hiện: mount 1 lần giữ camera sống (CSS hidden khi đóng — chuẩn qr-scan-flow)
  const [scanPlan, setScanPlan] = useState<{ id: string; name: string } | null>(null)
  const [scanOpen, setScanOpen] = useState(false)

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
      {scanPlan && <PlanScanOverlay plan={scanPlan} open={scanOpen} onClose={() => setScanOpen(false)} />}
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
          <Table className="[&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
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
                {(canPlan || canScan) && <TableHead className="px-2 py-1.5 w-16 sticky right-0 z-20 bg-slate-50 border-l border-slate-200" />}
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
                    {(canPlan || canScan) && (
                      <TableCell className="px-2 py-1 whitespace-nowrap sticky right-0 z-10 bg-white border-l border-slate-100">
                        {canScan && p.status === 'ACTIVE' && (
                          <button className="text-sky-600 hover:text-sky-800 px-1.5 py-1 rounded transition-colors"
                            title="Quét thực hiện — quét tem pallet đang ở vị trí nguồn, tự chuyển sang vị trí đích"
                            onClick={e => { e.stopPropagation(); unlockAudio(); setScanPlan({ id: p.id, name: p.name }); setScanOpen(true) }}>
                            <QrCode className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canPlan && (
                          <button className="text-slate-400 hover:text-red-500 p-1 transition-colors" disabled={deleting}
                            onClick={e => { e.stopPropagation(); handleDelete(p) }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
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

