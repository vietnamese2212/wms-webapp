// Tá»‘i Æ°u vá»‹ trÃ­ (Slotting) â€” má»¥c 6 roadmap, user chá»‘t 17/07.
// Tab PhÃ¢n tÃ­ch: ABC velocity theo LÆ¯á»¢T NHáº¶T (cá»­a sá»• 30/60/90 ngÃ y, RPC slotting_stats),
// gá»£i Ã½ á»Ÿ má»©c KHU (WarehouseZone.pick_rank: 1 = gáº§n cá»­a xuáº¥t nháº¥t, khai trong CÃ i Ä‘áº·t WMS).
// Tab Káº¿ hoáº¡ch: sinh gá»£i Ã½ dÃ²ng chuyá»ƒn pallet (tá»« vá»‹ trÃ­ â†’ vá»‹ trÃ­) â†’ lÆ°u káº¿ hoáº¡ch â†’ cÃ´ng nhÃ¢n
// chuyá»ƒn báº±ng tÃ­nh nÄƒng Ä‘á»•i vá»‹ trÃ­ sáºµn cÃ³ â†’ tiáº¿n Ä‘á»™ tá»± bÃ¡m vá»‹ trÃ­ thá»±c táº¿ (realtime InventoryEntry).
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
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
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

const nf = new Intl.NumberFormat('vi-VN')

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// ABC badge: A = nháº·t nhiá»u (Æ°u tiÃªn cao nháº¥t)
const ABC_BADGE: Record<string, string> = {
  A: 'bg-sky-600 text-white',
  B: 'bg-sky-100 text-sky-700',
  C: 'bg-slate-100 text-slate-500',
}
function AbcBadge({ abc }: { abc: string | null }) {
  if (!abc) return <span className="text-slate-300">â€”</span>
  return <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${ABC_BADGE[abc] ?? 'bg-slate-100 text-slate-500'}`}>{abc}</span>
}

// Band khu: A = gáº§n cá»­a xuáº¥t
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
  ACTIVE: 'Äang thá»±c hiá»‡n', COMPLETED: 'HoÃ n thÃ nh', CANCELLED: 'ÄÃ£ há»§y',
}

const DAYS_OPTS = [
  { value: '30', label: '30 ngÃ y' },
  { value: '60', label: '60 ngÃ y' },
  { value: '90', label: '90 ngÃ y' },
]
// NhÃ£n NGáº®N Ä‘á»ƒ chip filter gá»n (user 18/07: filter nhá» láº¡i, báº£ng chiáº¿m ~80%)
const LEVEL_OPTS = [
  { value: 'EASY',   label: 'Easy â€” gom chá»—' },
  { value: 'NORMAL', label: 'Normal â€” gom date' },
  { value: 'HARD',   label: 'Hard â€” ABC' },
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
  const admin = isAdmin(user)
  const canPlan   = admin || can(perms, 'slotting', 'plan')
  const canDelete = admin || can(perms, 'slotting', 'delete')   // xÃ³a káº¿ hoáº¡ch â€” quyá»n riÃªng (tÃ¡ch 05/08)
  const canConfigure = admin || can(perms, 'slotting', 'configure')

  const { warehouseId, categories, days, level, principle, tab, palletKind: rawPalletKind } = useWmsFilterStore(s => s.slotting)
  // ?? 'FULL': state persist cÅ© (trÆ°á»›c khi thÃªm field) khÃ´ng cÃ³ palletKind
  const palletKind = rawPalletKind ?? 'FULL'
  const setSlotting = useWmsFilterStore(s => s.setSlotting)

  const { data: rawWarehouses = [] } = useScopedWarehouses(true)
  const warehouses = rawWarehouses as { id: string; name: string }[]
  const { data: rawWhTypes = [] } = useScopedWhTypes()
  const whTypes = rawWhTypes as { id: string; value: string }[]

  // Kho máº·c Ä‘á»‹nh = kho Ä‘áº§u trong scope (slotting báº¯t buá»™c chá»n 1 kho)
  const effectiveWhId = warehouseId && warehouses.some(w => w.id === warehouseId) ? warehouseId : (warehouses[0]?.id ?? '')
  useEffect(() => {
    if (effectiveWhId && effectiveWhId !== warehouseId) setSlotting({ warehouseId: effectiveWhId })
  }, [effectiveWhId, warehouseId, setSlotting])

  const [search, setSearch] = useState('')
  const searchDeb = useDebouncedValue(search, 250)   // tÃ¬m trÃªn SERVER â†’ Ä‘á»£i 250ms má»›i gá»i
  const [matPage, setMatPage] = useState(1)
  const [matPageSize, setMatPageSize] = useState(200)
  // Äá»•i bá»™ lá»c/tá»« khÃ³a â†’ vá» trang 1 (Ä‘ang á»Ÿ trang 12 mÃ  lá»c cÃ²n 1 trang = báº£ng trá»‘ng)
  useEffect(() => { setMatPage(1) }, [searchDeb, effectiveWhId, categories, days])
  const [showPlanSheet, setShowPlanSheet] = useState(false)
  // Query phÃ¢n tÃ­ch á»Ÿ CHA Ä‘á»ƒ nÃºt "Táº¡o káº¿ hoáº¡ch" náº±m trÃªn toolbar (chuáº©n table-format: action lÃªn trÃªn);
  // chá»‰ fetch khi Ä‘ang á»Ÿ tab PhÃ¢n tÃ­ch ('' = disabled)
  // Báº£ng ABC PHÃ‚N TRANG SERVER: 2.378 mÃ£ = 902KB, danh má»¥c 10.000 mÃ£ â‰ˆ 3,8MB (tráº§n 4,5MB).
  const analysisQuery = useSlotting(
    tab === 'analysis' ? effectiveWhId : '', categories, days, matPage, matPageSize, searchDeb,
  )
  const { data: analysisData } = analysisQuery

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', value: effectiveWhId,
      onChange: v => setSlotting({ warehouseId: v }), allLabel: 'â€” Chá»n kho',
      options: warehouses.map(w => ({ value: w.id, label: w.name })) },
    // pinned: Loáº¡i kho lÃ  filter Báº®T BUá»˜C Ä‘á»ƒ táº¡o káº¿ hoáº¡ch â†’ chip luÃ´n hiá»‡n, xÃ³a giÃ¡ trá»‹ khÃ´ng biáº¿n máº¥t (user 18/07)
    { key: 'cat', label: 'Loáº¡i kho', type: 'multi', selected: categories, pinned: true,
      onChange: (v: string[]) => setSlotting({ categories: v }),
      options: whTypes.map(t => ({ value: t.value, label: t.value })) },
    { key: 'level', label: 'Má»©c Ä‘á»™', type: 'single', value: level,
      onChange: v => setSlotting({ level: (v || 'NORMAL') as SlottingLevel }), allLabel: 'Normal â€” gom date',
      options: LEVEL_OPTS },
    { key: 'principle', label: 'NguyÃªn táº¯c', type: 'single', value: principle,
      onChange: v => setSlotting({ principle: (v || 'FEFO') as SlottingPrinciple }), allLabel: 'FEFO (HSD)',
      options: PRINCIPLE_OPTS },
    // HÃ ng cháºµn/láº» (user 18/07 "háº§u háº¿t chá»‰ dá»“n hÃ ng cháºµn"): máº·c Ä‘á»‹nh = Chá»‰ hÃ ng cháºµn (pallet nguyÃªn).
    // GiÃ¡ trá»‹ TÆ¯á»œNG MINH (khÃ´ng dÃ¹ng '' = allLabel) Ä‘á»ƒ chip luÃ´n hiá»‡n "Pallet: HÃ ng cháºµn" â€” xÃ³a âœ• = vá» máº·c Ä‘á»‹nh cháºµn
    { key: 'palletKind', label: 'Pallet', type: 'single', value: palletKind,
      onChange: v => setSlotting({ palletKind: (v === 'PARTIAL' || v === 'ALL') ? v : 'FULL' }),
      allLabel: 'HÃ ng cháºµn (máº·c Ä‘á»‹nh)',
      options: [
        { value: 'FULL', label: 'HÃ ng cháºµn (pallet nguyÃªn)' },
        { value: 'PARTIAL', label: 'Chá»‰ hÃ ng láº»' },
        { value: 'ALL', label: 'Cháºµn + láº»' },
      ] },
    { key: 'days', label: 'Cá»­a sá»• ABC', type: 'single', value: String(days),
      onChange: v => setSlotting({ days: Number(v) || 30 }), allLabel: '30 ngÃ y',
      options: DAYS_OPTS },
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-1.5 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
              <Boxes className="h-4 w-4 text-sky-600" /> Tá»‘i Æ°u vá»‹ trÃ­
            </h1>
            {/* Tabs */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-medium shrink-0">
              <button className={`px-2.5 py-1 ${tab === 'analysis' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setSlotting({ tab: 'analysis' })}>PhÃ¢n tÃ­ch ABC</button>
              <button className={`px-2.5 py-1 border-l border-slate-200 ${tab === 'plans' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setSlotting({ tab: 'plans' })}>Káº¿ hoáº¡ch sáº¯p xáº¿p</button>
              {canConfigure && (
                <button className={`px-2.5 py-1 border-l border-slate-200 ${tab === 'config' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  onClick={() => setSlotting({ tab: 'config' })}>CÃ i Ä‘áº·t</button>
              )}
            </div>
            {tab === 'analysis' && (
              <SearchInput value={search} onChange={setSearch} placeholder="TÃ¬m mÃ£, tÃªn hÃ ngâ€¦" className="flex-1 min-w-[140px]" />
            )}
            {/* Action chÃ­nh trÃªn toolbar (chuáº©n table-format) */}
            {tab === 'analysis' && canPlan && (
              <Button size="sm" className="h-7 text-[11px] ml-auto shrink-0"
                disabled={!analysisData || categories.length === 0 || (level === 'HARD' && !analysisData.has_ranked_zones)}
                title={categories.length === 0 ? 'Chá»n Loáº¡i kho (filter) trÆ°á»›c â€” káº¿ hoáº¡ch Ä‘i theo tá»«ng loáº¡i hÃ ng' : undefined}
                onClick={() => setShowPlanSheet(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {categories.length === 0 ? 'Táº¡o káº¿ hoáº¡ch â€” chá»n Loáº¡i kho trÆ°á»›c' : `Táº¡o káº¿ hoáº¡ch (${LEVEL_LABEL[level]} Â· ${principle})`}
              </Button>
            )}
            <span className="sm:hidden ml-auto"><FilterSheetButton defs={filterDefs} /></span>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        {tab === 'analysis' && <AnalysisTab warehouseId={effectiveWhId} query={analysisQuery} days={days} level={level}
            page={matPage} pageSize={matPageSize} onPage={setMatPage} onPageSize={n => { setMatPageSize(n); setMatPage(1) }} />}
        {tab === 'plans' && <PlansTab warehouseId={effectiveWhId} canPlan={canPlan} canDelete={canDelete} onOpen={id => navigate(`/wms/slotting/plans/${id}`)} />}
        {tab === 'config' && (canConfigure
          ? <ConfigTab warehouseId={effectiveWhId} categories={categories} />
          : <div className="p-8 text-center text-sm text-slate-400">KhÃ´ng cÃ³ quyá»n CÃ i Ä‘áº·t</div>)}
      </div>

      {showPlanSheet && analysisData && (
        <PlanCreateSheet open={showPlanSheet} onClose={() => setShowPlanSheet(false)}
          warehouseId={effectiveWhId} categories={categories} days={days} level={level} principle={principle} palletKind={palletKind} />
      )}
    </div>
  )
}

// â”€â”€â”€ Tab PhÃ¢n tÃ­ch ABC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function AnalysisTab({ warehouseId, query, days, level, page, pageSize, onPage, onPageSize }: {
  warehouseId: string; query: ReturnType<typeof useSlotting>; days: number
  level: SlottingLevel
  page: number; pageSize: number; onPage: (p: number) => void; onPageSize: (n: number) => void
}) {
  const { data, isLoading, error, refetch } = query

  // 'SL xuáº¥t' (khÃ´ng ghi "ThÃ¹ng"): cartons_out láº¥y tá»« RPC theo base per-mÃ£ â€” mÃ£ KG/cÃ¡i khÃ´ng pháº£i thÃ¹ng
  const cols = ['MÃ£ hÃ ng', 'TÃªn hÃ ng', 'Loáº¡i', 'Háº¡ng', 'LÆ°á»£t nháº·t', 'SL xuáº¥t', '% lÅ©y káº¿', 'Pallet tá»“n', 'Khu Ä‘ang náº±m', 'Khu Ä‘á» xuáº¥t', 'Lá»‡ch chá»—']
  const { widths, startResize, totalWidth } = useColumnResize('slotting_col_widths',
    [96, 190, 84, 48, 72, 76, 66, 70, 200, 120, 76])

  const zoneByCode = useMemo(() => new Map((data?.zones ?? []).map(z => [z.code, z])), [data?.zones])

  // Trang do SERVER tráº£ (Ä‘Ã£ lá»c theo tá»« khÃ³a) â€” KHÃ”NG lá»c láº¡i á»Ÿ client: lá»c client sau khi phÃ¢n
  // trang lÃ  lá»c trÃªn Ä‘Ãºng 1 trang, sá»‘ dÃ²ng vÃ  Ã´ tá»•ng Ä‘á»u sai.
  const displayMats = data?.materials ?? []
  const matsTotal = data?.materials_total ?? 0
  const totalPages = Math.max(1, Math.ceil(matsTotal / pageSize))

  // 5 Ã´ Ä‘áº¿m láº¥y tá»« SERVER (Ä‘áº¿m trÃªn TOÃ€N Bá»˜ mÃ£ khá»›p lá»c). Äáº¿m trÃªn `data.materials` lÃ  chá»‰ Ä‘áº¿m
  // trang Ä‘ang xem â€” vÃ  háº¡ng A/B/C lÃ  % LÅ¨Y Káº¾ nÃªn Ä‘áº¿m theo trang cÃ²n sai báº£n cháº¥t.
  const tiles: BandTile[] = useMemo(() => {
    const misMats = data?.misplaced_mats ?? 0
    const misPallets = data?.misplaced_pallets ?? 0
    return [
      { label: `LÆ°á»£t nháº·t ${days} ngÃ y`, value: nf.format(data?.total_picks ?? 0), accent: true },
      { label: 'MÃ£ háº¡ng A', value: nf.format(data?.n_a ?? 0) },
      { label: 'MÃ£ háº¡ng B', value: nf.format(data?.n_b ?? 0) },
      { label: 'MÃ£ háº¡ng C', value: nf.format(data?.n_c ?? 0) },
      { label: 'MÃ£ lá»‡ch chá»—', value: nf.format(misMats), danger: misMats > 0 },
      { label: 'Pallet lá»‡ch chá»—', value: nf.format(misPallets), danger: misPallets > 0 },
    ]
  }, [data, days])

  if (!warehouseId) return <div className="p-8 text-center text-sm text-slate-400">Chá»n kho Ä‘á»ƒ phÃ¢n tÃ­ch</div>

  return (
    <>
      <SummaryBand tiles={tiles} />

      {/* Dáº£i khu + band (A = gáº§n cá»­a xuáº¥t) â€” 1 DÃ’NG cuá»™n ngang (nÃ©n Ä‘á»ƒ báº£ng chiáº¿m ~80% â€” user 18/07) */}
      <div className="border-b bg-slate-50 px-3 py-1 shrink-0 flex items-center gap-1.5 flex-nowrap overflow-x-auto">
        <span className="text-[9px] font-medium uppercase text-slate-400 shrink-0">Khu:</span>
        {(data?.zones ?? []).map(z => (
          <span key={z.id} title={`${z.name} â€” loáº¡i ${z.categories?.length ? z.categories.join(', ') : 'Ä‘a dá»¥ng'} Â· sá»©c chá»©a ${z.used_slots}/${z.capacity} pallet${z.pick_rank != null ? ` Â· háº¡ng nháº·t ${z.pick_rank}` : ' Â· chÆ°a xáº¿p háº¡ng'}`}
            className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${z.band ? BAND_CHIP[z.band] : 'border-dashed border-slate-300 text-slate-400'}`}>
            {z.code}{z.pick_rank != null ? ` #${z.pick_rank}` : ''}{z.band ? ` Â· ${z.band}` : ''}
          </span>
        ))}
        {data && !data.has_ranked_zones && level === 'HARD' && (
          <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 flex items-center gap-1 whitespace-nowrap shrink-0">
            <AlertTriangle className="h-3 w-3" /> Má»©c Hard cáº§n Háº¡ng nháº·t cá»§a khu â€”
            <Link to="/wms/slotting" className="underline font-medium">khai á»Ÿ tab CÃ i Ä‘áº·t</Link>
          </span>
        )}
      </div>

      {/* Cáº£nh bÃ¡o pallet náº±m SAI LOáº I khu (vd hÃ ng thÆ°á»ng trong khu SCA) â€” chá»‰ cáº£nh bÃ¡o,
          muá»‘n sinh lá»‡nh kÃ©o vá» thÃ¬ tick Ã´ trong sheet Táº¡o káº¿ hoáº¡ch (user chá»‘t) */}
      {(data?.warnings ?? []).length > 0 && (
        <CategoryWarnings
          warnings={data!.warnings}
          totalPallets={data!.warnings_pallets ?? data!.warnings.reduce((s, w) => s + w.pallets, 0)}
          totalCount={data!.warnings_total ?? data!.warnings.length} />
      )}

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {error ? (
          <div className="m-3 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded flex items-center gap-2">
            {apiMsg(error)}
            <Button size="sm" variant="outline" className="h-6 text-[10px] ml-auto" onClick={() => refetch()}><RefreshCw className="h-3 w-3 mr-1" />Thá»­ láº¡i</Button>
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Äang phÃ¢n tÃ­châ€¦</div>
        ) : displayMats.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">KhÃ´ng cÃ³ dá»¯ liá»‡u xuáº¥t/tá»“n trong cá»­a sá»• {days} ngÃ y</div>
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
      <PagerNav page={page} totalPages={totalPages} onPage={onPage} />
      <ListFooter
        page={page} pageSize={pageSize} total={matsTotal} unit="mÃ£"
        onPageSize={onPageSize}
        right={`xáº¿p háº¡ng theo lÆ°á»£t nháº·t ${days} ngÃ y (A = 80% lÆ°á»£t nháº·t lÅ©y káº¿, B = 15% káº¿, C = cÃ²n láº¡i)`} />
    </>
  )
}

// Cáº£nh bÃ¡o pallet náº±m SAI LOáº I khu â€” chá»‰ cáº£nh bÃ¡o; kÃ©o vá» = checkbox lÃºc táº¡o káº¿ hoáº¡ch.
// NÃ‰N 1 dÃ²ng (báº£ng chiáº¿m ~80% â€” user 18/07): chi tiáº¿t Ä‘áº§y Ä‘á»§ trong tooltip.
function CategoryWarnings({ warnings, totalPallets, totalCount }: {
  warnings: SlottingWarning[]     // chá»‰ PHáº¦N Äáº¦U (server tráº£ tá»‘i Ä‘a 50 dÃ²ng)
  totalPallets: number            // tá»•ng pallet trÃªn TOÃ€N Bá»˜ cáº£nh bÃ¡o
  totalCount: number              // tá»•ng sá»‘ dÃ²ng cáº£nh bÃ¡o
}) {
  const detail = warnings.map(w => `${w.material_code} [${w.material_category ?? 'chÆ°a khai loáº¡i'}] â€” ${w.pallets} pallet á»Ÿ ${w.zone_code} (khu ${w.zone_category})`).join('\n')
    + (totalCount > warnings.length ? `\nâ€¦ vÃ  ${nf.format(totalCount - warnings.length)} mÃ£ ná»¯a (xem cá»™t "Sai khu" trong báº£ng)` : '')
  return (
    <div className="border-b bg-amber-50/60 px-3 py-1 shrink-0 text-[10px] flex items-center gap-1 min-w-0" title={detail}>
      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-700" />
      <span className="text-amber-800 truncate">
        <b>{nf.format(totalPallets)} pallet náº±m sai loáº¡i khu</b> (rÃª chuá»™t xem chi tiáº¿t â€” muá»‘n kÃ©o vá» Ä‘Ãºng khu, tick Ã´ trong "Táº¡o káº¿ hoáº¡ch"):{' '}
        {warnings.slice(0, 6).map(w => `${w.material_code}Ã—${w.pallets}@${w.zone_code}`).join(' Â· ')}
        {totalCount > 6 ? ` â€¦ +${nf.format(totalCount - 6)}` : ''}
      </span>
    </div>
  )
}

function MatRow({ m, zoneByCode }: { m: SlottingMaterial; zoneByCode: Map<string, SlottingZone> }) {
  return (
    <TableRow>
      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap sticky left-0 z-10 bg-white">{m.code}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap"><span className="block truncate" title={m.name ?? ''}>{m.name ?? <span className="text-slate-300">â€”</span>}</span></TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{m.category ?? <span className="text-slate-300">â€”</span>}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap"><AbcBadge abc={m.abc} /></TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums whitespace-nowrap">{nf.format(m.picks)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{nf.format(m.cartons_out)}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] tabular-nums text-slate-500 whitespace-nowrap">{m.picks > 0 ? `${Math.round(m.cum_share * 100)}%` : <span className="text-slate-300">â€”</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums whitespace-nowrap">{nf.format(m.stock_pallets)}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="flex gap-1 overflow-hidden">
          {m.zones_current.length === 0 && <span className="text-slate-300 text-[10px]">â€”</span>}
          {m.zones_current.map((zc, i) => {
            const band = zc.sub_code ? zoneByCode.get(zc.sub_code)?.band : null
            const off = band != null && band !== m.abc
            return (
              <span key={i} className={`text-[9px] px-1 py-0.5 rounded border whitespace-nowrap ${off ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                title={off ? `Khu band ${band} â€” lá»‡ch vá»›i háº¡ng ${m.abc}` : undefined}>
                {zc.sub_code ?? 'ChÆ°a cÃ³ VT'}Ã—{zc.pallets}
              </span>
            )
          })}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
        {m.suggested_zones.length > 0
          ? <span className="font-medium text-green-700">{m.suggested_zones.join(', ')}</span>
          : <span className="text-slate-300">â€”</span>}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {m.misplaced_pallets > 0
          ? <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{nf.format(m.misplaced_pallets)} pallet</span>
          : <span className="text-slate-300 text-[10px]">â€”</span>}
      </TableCell>
    </TableRow>
  )
}

// â”€â”€â”€ Sheet táº¡o káº¿ hoáº¡ch (preview â†’ chá»n dÃ²ng â†’ lÆ°u) â€” dÃ²ng GOM (mÃ£ + date) â”€â”€â”€â”€â”€
const lineKey = (l: SlottingPlanLineDraft) => `${l.material_id}|${l.date_key ?? ''}|${l.from_location_id ?? ''}|${l.to_location_id}`

function PlanCreateSheet({ open, onClose, warehouseId, categories, days, level, principle, palletKind }: {
  open: boolean; onClose: () => void
  warehouseId: string; categories: string[]; days: number
  level: SlottingLevel; principle: SlottingPrinciple; palletKind: 'FULL' | 'PARTIAL' | 'ALL'
}) {
  const navigate = useNavigate()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [name, setName] = useState(`Sáº¯p xáº¿p ${categories.length > 0 ? categories.join('+') : 'kho'} ${today} (${LEVEL_LABEL[level]} Â· ${principle})`)
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
        if (r.lines.length === 0) setErr(r.message ?? 'KhÃ´ng sinh Ä‘Æ°á»£c gá»£i Ã½ nÃ o')
      },
      onError: e => setErr(apiMsg(e)),
    })
  }
  function handleSave() {
    setErr('')
    const selected = (lines ?? []).filter(l => checked.has(lineKey(l)))
    if (!name.trim()) { setErr('Nháº­p tÃªn káº¿ hoáº¡ch'); return }
    if (selected.length === 0) { setErr('Chá»n Ã­t nháº¥t 1 dÃ²ng chuyá»ƒn'); return }
    create({ warehouse_id: warehouseId, name: name.trim(), level, principle, window_days: days, lines: selected }, {
      onSuccess: r => { onClose(); navigate(`/wms/slotting/plans/${r.id}`) },
      onError: e => setErr(apiMsg(e)),
    })
  }
  const nSel = (lines ?? []).filter(l => checked.has(lineKey(l))).length
  const nPallets = (lines ?? []).filter(l => checked.has(lineKey(l))).reduce((s, l) => s + l.n_pallets, 0)

  return (
    <FormSheet open={open} onClose={onClose} title={`Táº¡o káº¿ hoáº¡ch sáº¯p xáº¿p â€” ${LEVEL_LABEL[level]} Â· ${principle}`} widthClass="sm:max-w-3xl" footer={<>
      <Button variant="outline" size="sm" onClick={onClose}>Huá»·</Button>
      <Button size="sm" onClick={handleSave} disabled={creating || nSel === 0}>
        {creating ? 'Äang lÆ°uâ€¦' : `LÆ°u káº¿ hoáº¡ch (${nSel} dÃ²ng Â· ${nPallets} pallet)`}
      </Button>
    </>}>
      <div className="space-y-3">
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
        <div className="flex gap-3 items-end flex-wrap">
          <div className="space-y-1 flex-1 min-w-[180px]">
            <Label className="text-xs">TÃªn káº¿ hoáº¡ch *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sá»‘ dÃ²ng tá»‘i Ä‘a</Label>
            <Input type="number" min={1} max={500} value={maxMoves} onChange={e => setMaxMoves(e.target.value)} className="w-24" />
          </div>
          <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewing}>
            {previewing ? 'Äang sinhâ€¦' : lines ? 'Sinh láº¡i gá»£i Ã½' : 'Sinh gá»£i Ã½'}
          </Button>
        </div>
        {/* KÃ©o pallet náº±m sai loáº¡i khu vá» Ä‘Ãºng khu (vd hÃ ng thÆ°á»ng láº¡c trong khu SCA, mÃ£ SCA láº¡c ra ngoÃ i) */}
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input type="checkbox" checked={pullWrongZone} onChange={e => setPullWrongZone(e.target.checked)} className="h-3.5 w-3.5 rounded accent-blue-600" />
          KÃ©o hÃ ng náº±m <b>sai loáº¡i khu</b> vá» Ä‘Ãºng khu (Æ°u tiÃªn cao nháº¥t â€” máº·c Ä‘á»‹nh chá»‰ cáº£nh bÃ¡o)
        </label>
        <p className="text-[10px] text-slate-400">
          {level === 'EASY' && 'Easy: gom mÃ£ Ä‘ang ráº£i nhiá»u vá»‹ trÃ­ vá» Ã­t vá»‹ trÃ­ â€” giáº£i phÃ³ng chá»— trá»‘ng, khÃ´ng quan tÃ¢m date.'}
          {level === 'NORMAL' && (principle === 'LIFO'
            ? 'Normal Â· LIFO: dá»“n hÃ ng cÃ¹ng mÃ£ date DÃ€I vÃ o vá»‹ trÃ­ Ä‘ang chá»©a date ngáº¯n.'
            : `Normal Â· ${principle}: dá»“n hÃ ng cÃ¹ng mÃ£ date NGáº®N vÃ o vá»‹ trÃ­ Ä‘ang chá»©a date dÃ i${principle === 'FEFO' ? ' (so theo HSD)' : ' (so theo NSX)'}.`)}
          {level === 'HARD' && `Hard: Ä‘áº£o khu theo ABC (${days} ngÃ y) + gom theo date ${principle} â€” cáº§n chá»— trá»‘ng Ä‘á»‡m.`}
          {' '}Vá»‹ trÃ­ "khÃ´ng Ä‘Æ°a hÃ ng vÃ o" khÃ´ng bao giá» lÃ m Ä‘Ã­ch vÃ  hÃ ng á»Ÿ Ä‘Ã³ luÃ´n bá»‹ kÃ©o Ä‘i trÆ°á»›c; vá»‹ trÃ­ "khÃ´ng láº¥y hÃ ng Ä‘i" bá»‹ loáº¡i khá»i nguá»“n (tab CÃ i Ä‘áº·t). Pallet Ä‘ang giá»¯ cho Ä‘Æ¡n xuáº¥t Ä‘Æ°á»£c bá» qua.
          {' '}<b>Pallet: {palletKind === 'FULL' ? 'chá»‰ dá»“n HÃ€NG CHáº´N (pallet Ä‘á»§ táº£i 1 pallet Ä‘áº§y = sá»‘ thÃ¹ng/pallet Ã— quy cÃ¡ch â€” pallet láº» Ä‘á»ƒ yÃªn, váº«n tÃ­nh chiáº¿m chá»—)' : palletKind === 'PARTIAL' ? 'chá»‰ dá»“n HÃ€NG Láºº (pallet chÆ°a Ä‘á»§ táº£i: nháº­p láº» hoáº·c Ä‘Ã£ bá»‘c dá»Ÿ)' : 'dá»“n cáº£ hÃ ng cháºµn + láº»'}</b> (Ä‘á»•i á»Ÿ filter "Pallet"). DÃ²ng = 1 lá»‡nh gom (MÃ£ + Date), Ä‘Ã£ kiá»ƒm sá»©c chá»©a Ä‘Ã­ch táº¡i tá»«ng thá»i Ä‘iá»ƒm.
          {' '}<b>Thá»© tá»± dÃ²ng = thá»© tá»± thá»±c hiá»‡n (lÃ m tá»« trÃªn xuá»‘ng)</b>: cÃ¹ng mÃ£ Ä‘á»©ng cáº¡nh nhau, cÃ¹ng Ä‘Ã­ch nhiá»u date thÃ¬ dÃ²ng xáº¿p vÃ o TRÆ¯á»šC náº±m trÃªn ({principle === 'LIFO' ? 'LIFO: date ngáº¯n vÃ o trÆ°á»›c, date dÃ i náº±m ngoÃ i' : `${principle}: date dÃ i vÃ o trÆ°á»›c, date ngáº¯n náº±m ngoÃ i Ä‘á»ƒ láº¥y trÆ°á»›c`}).
        </p>
        {skipped > 0 && <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{skipped} pallet bá»‹ bá» vÃ¬ vá»‹ trÃ­ Ä‘Ã­ch háº¿t chá»— trá»‘ng</p>}
        {/* KHÃ”NG cáº¯t Ã¢m tháº§m: gá»£i Ã½ sinh nhiá»u hÆ¡n tráº§n â†’ bÃ¡o rÃµ cÃ²n bao nhiÃªu dÃ²ng chÆ°a hiá»‡n */}
        {lines && totalGen > lines.length && (
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            Sinh Ä‘Æ°á»£c {nf.format(totalGen)} dÃ²ng nhÆ°ng chá»‰ hiá»‡n {nf.format(lines.length)} dÃ²ng Ä‘áº§u (Æ°u tiÃªn cao trÆ°á»›c) â€” lÃ m xong káº¿ hoáº¡ch nÃ y rá»“i "Táº¡o káº¿ hoáº¡ch" tiáº¿p Ä‘á»ƒ xá»­ pháº§n cÃ²n láº¡i, hoáº·c tÄƒng "Sá»‘ dÃ²ng tá»‘i Ä‘a" (tá»‘i Ä‘a 500/káº¿ hoáº¡ch).
          </p>
        )}

        {/* Káº¿t quáº£ ká»³ vá»ng â€” user 18/07: "biáº¿t lÃ m nhÆ°ng chÆ°a biáº¿t Ä‘Ãºng sai" â†’ phÃ¢n tÃ­ch Ä‘á»ƒ soi tá»«ng gá»£i Ã½ */}
        {impact && lines && lines.length > 0 && (
          <div className="text-[11px] bg-sky-50 border border-sky-200 rounded px-2.5 py-2 space-y-1">
            <p className="font-semibold text-sky-800">Káº¿t quáº£ ká»³ vá»ng náº¿u thá»±c hiá»‡n Ä‘á»§ {impact.lines} dÃ²ng ({nf.format(impact.moved_pallets)} pallet chuyá»ƒn):</p>
            <ul className="list-disc pl-4 space-y-0.5 text-sky-900">
              {impact.freed_locations > 0 && (
                <li><b>Giáº£i phÃ³ng hoÃ n toÃ n {impact.freed_locations} vá»‹ trÃ­</b> (trá»‘ng Ä‘á»ƒ dÃ¹ng â€” trong pháº¡m vi loáº¡i Ä‘Ã£ chá»n):{' '}
                  <span className="font-mono">{impact.freed_location_codes.join(', ')}</span>{impact.freed_locations > impact.freed_location_codes.length ? 'â€¦' : ''}</li>
              )}
              {impact.temp_cleared_pallets > 0 && <li>Dá»n sáº¡ch {nf.format(impact.temp_cleared_pallets)} pallet khá»i vá»‹ trÃ­ táº¡m (khÃ´ng Ä‘Æ°a hÃ ng vÃ o)</li>}
              {impact.wrong_zone_pallets > 0 && <li>{nf.format(impact.wrong_zone_pallets)} pallet náº±m sai loáº¡i khu Ä‘Æ°á»£c kÃ©o vá» Ä‘Ãºng khu</li>}
              {impact.abc_pallets > 0 && <li>{nf.format(impact.abc_pallets)} pallet Ä‘áº£o khu theo háº¡ng ABC (mÃ£ nháº·t nhiá»u vá» gáº§n cá»­a, nháº·t Ã­t ra xa)</li>}
              {impact.date_group_pallets > 0 && <li>{nf.format(impact.date_group_pallets)} pallet gom theo date ({principle}) â€” sau gom, má»—i vá»‹ trÃ­ chá»©a cÃ¹ng mÃ£ vá»›i dáº£i date liá»n nhau, xuáº¥t Ä‘Ãºng chiá»u {principle}</li>}
              {impact.free_group_pallets > 0 && <li>{nf.format(impact.free_group_pallets)} pallet gom mÃ£ Ä‘ang ráº£i rÃ¡c vá» Ã­t vá»‹ trÃ­</li>}
              {impact.freed_locations === 0 && impact.moved_pallets > 0 && <li>ChÆ°a giáº£i phÃ³ng trá»n vá»‹ trÃ­ nÃ o (nguá»“n cÃ²n pallet á»Ÿ láº¡i hoáº·c bá»‹ giá»¯ cho Ä‘Æ¡n xuáº¥t)</li>}
            </ul>
            <p className="text-[10px] text-sky-700">
              CÃ¡ch soi Ä‘Ãºng/sai tá»«ng dÃ²ng: nhÃ¬n cá»™t <b>"ÄÃ­ch Ä‘ang chá»©a"</b> â€” Ä‘Ã­ch há»£p lÃ½ pháº£i lÃ  vá»‹ trÃ­ trá»‘ng hoáº·c Ä‘ang chá»©a CÃ™NG MÃƒ vá»›i date Ä‘Ãºng chiá»u {principle === 'LIFO' ? 'LIFO (Ä‘Ã­ch chá»©a date ngáº¯n hÆ¡n hÃ ng chuyá»ƒn Ä‘áº¿n)' : `${principle} (Ä‘Ã­ch chá»©a date dÃ i hÆ¡n hÃ ng chuyá»ƒn Ä‘áº¿n)`}; <b>"Trá»‘ng sau"</b> = sá»‘ chá»— cÃ²n dÆ° á»Ÿ Ä‘Ã­ch sau khi thá»±c hiá»‡n (0 = vá»«a khÃ­t, khÃ´ng Ã¢m).
            </p>
            <p className="text-[10px] text-sky-700">
              Má»—i pallet chá»‰ chuyá»ƒn 1 láº§n/káº¿ hoáº¡ch â€” vÃ i pallet dáº¡ng hoÃ¡n Ä‘á»•i dÃ¢y chuyá»n (chá»— nÃ y trá»‘ng ra thÃ¬ chá»— kia má»›i dá»“n Ä‘Æ°á»£c) sáº½ hiá»‡n khi <b>Sinh gá»£i Ã½ láº§n ná»¯a SAU khi lÃ m xong</b> Ä‘á»£t nÃ y; Ä‘á»£t 2 thÆ°á»ng ráº¥t nhá» (~1â€“3%) vÃ  Ä‘á»£t 3 = 0.
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
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">MÃ£ hÃ ng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Date</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Háº¡ng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">SL pallet</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tá»« vá»‹ trÃ­</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Äáº¿n vá»‹ trÃ­</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">ÄÃ­ch Ä‘ang chá»©a</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trá»‘ng sau</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">LÃ½ do</TableHead>
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
                      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{l.date_key ?? <span className="text-slate-300">â€”</span>}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap"><AbcBadge abc={l.abc} /></TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-semibold tabular-nums whitespace-nowrap">{l.n_pallets}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{l.from_location_code ?? 'â€”'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold text-green-700 whitespace-nowrap">{l.to_location_code ?? 'â€”'}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                        {l.to_current === 'Trá»‘ng'
                          ? <span className="text-slate-400">Trá»‘ng</span>
                          : <span className="block max-w-[220px] truncate text-slate-600" title={l.to_current}>{l.to_current ?? 'â€”'}</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">
                        {l.to_free_after != null
                          ? <span className={l.to_free_after === 0 ? 'text-amber-600 font-semibold' : 'text-slate-600'}>{l.to_free_after} chá»—</span>
                          : <span className="text-slate-300">â€”</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap"><span className="block max-w-[240px] truncate" title={`${l.reason}${l.flow_note ? ` Â· ${l.flow_note}` : ''}`}>{l.reason}{l.flow_note ? ` Â· ${l.flow_note}` : ''}</span></TableCell>
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

// â”€â”€â”€ Tab CÃ i Ä‘áº·t (quyá»n slotting.configure) â€” cáº¥u hÃ¬nh slotting per KHU â”€â”€â”€â”€â”€â”€â”€
// Háº¡ng nháº·t (1 = gáº§n cá»­a xuáº¥t nháº¥t) + Luá»“ng cá»­a. Loáº¡i kho cá»§a khu/mÃ£ quáº£n á»Ÿ chá»— cÅ©
// (CÃ i Ä‘áº·t WMS / MÃ£ hÃ ng) â€” khu SCA = táº¡o Loáº¡i kho riÃªng rá»“i gÃ¡n khu + mÃ£ (user chá»‘t v3).
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
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 999)) { setErr(`Háº¡ng nháº·t khu ${z.code}: pháº£i lÃ  sá»‘ nguyÃªn 1â€“999 (hoáº·c trá»‘ng)`); return }
    setErr('')
    updateCfg({ id: z.id, pick_rank: n }, { onError: e => setErr(apiMsg(e)) })
  }
  function saveFlow(z: WarehouseZone, v: string) {
    setErr('')
    updateCfg({ id: z.id, flow_type: v || null }, { onError: e => setErr(apiMsg(e)) })
  }

  if (!warehouseId) return <div className="p-8 text-center text-sm text-slate-400">Chá»n kho Ä‘á»ƒ cÃ i Ä‘áº·t</div>
  const guide = 'Háº¡ng nháº·t: Ä‘á»™ gáº§n cá»­a xuáº¥t cá»§a khu â€” 1 = gáº§n nháº¥t; trá»‘ng = khu khÃ´ng tham gia gá»£i Ã½ ABC (má»©c Hard). Luá»“ng cá»­a: quyáº¿t Ä‘á»‹nh hÆ°á»›ng dáº«n xáº¿p trong dÃ£y in trÃªn phiáº¿u káº¿ hoáº¡ch. Khu Ä‘áº·c thÃ¹ (kho láº¡nhâ€¦): dÃ¹ng Loáº¡i kho â€” táº¡o Loáº¡i riÃªng (vd SCA) trong CÃ i Ä‘áº·t WMS â†’ Loáº¡i kho, gÃ¡n cho khu + cÃ¡c mÃ£ hÃ ng cá»§a nÃ³; slotting chá»‰ ghÃ©p mÃ£ Ä‘Ãºng Loáº¡i vá»›i khu Ä‘Ãºng Loáº¡i.'
  return (
    <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
      {/* HÆ°á»›ng dáº«n nÃ©n 1 dÃ²ng â€” rÃª chuá»™t xem Ä‘á»§ (báº£ng chiáº¿m ~80%, user 18/07) */}
      <div className="px-3 py-1 text-[10px] text-slate-500 border-b bg-slate-50 truncate" title={guide}>{guide}</div>
      {err && <p className="m-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
      <LocationConfig warehouseId={warehouseId} categories={categories} />
      {isLoading ? (
        <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div>
      ) : (
        <Table className="[&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">MÃ£ khu</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn khu</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Loáº¡i kho</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Háº¡ng nháº·t (1 = gáº§n cá»­a nháº¥t)</TableHead>
              <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Luá»“ng cá»­a</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(zones as WarehouseZone[]).filter(z => z.is_active).map(z => (
              <TableRow key={z.id}>
                <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{z.code}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{z.name}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{z.categories?.length ? z.categories.join(', ') : <span className="text-slate-300">â€” Ä‘a dá»¥ng</span>}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <Input type="number" min={1} max={999} disabled={isPending}
                    className="h-7 w-20 text-xs !min-h-0"
                    value={draftRank[z.id] ?? (z.pick_rank != null ? String(z.pick_rank) : '')}
                    onChange={e => setDraftRank(prev => ({ ...prev, [z.id]: e.target.value }))}
                    onBlur={e => saveRank(z, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    placeholder="â€”" />
                </TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <Select value={z.flow_type ?? '__none__'} onValueChange={v => saveFlow(z, v === '__none__' ? '' : v)} disabled={isPending}>
                    <SelectTrigger className="h-7 w-52 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">â€” ChÆ°a khai</SelectItem>
                      <SelectItem value="SAME_END" className="text-xs">Xuáº¥t nháº­p cÃ¹ng 1 Ä‘áº§u</SelectItem>
                      <SelectItem value="FLOW_THROUGH" className="text-xs">Nháº­p 1 Ä‘áº§u, xuáº¥t 1 Ä‘áº§u</SelectItem>
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

// Cáº¥u hÃ¬nh Vá»Š TRÃ (user 18/07): 2 danh sÃ¡ch chá»n dropdown per kho â€”
// "KHÃ”NG Ä‘Æ°a hÃ ng vÃ o" (kho táº¡m: khÃ´ng lÃ m Ä‘Ã­ch + hÃ ng á»Ÿ Ä‘Ã³ luÃ´n bá»‹ kÃ©o Ä‘i trÆ°á»›c)
// vÃ  "KHÃ”NG láº¥y hÃ ng Ä‘i" (hÃ ng káº¹t khÃ´ng bá»‘c Ä‘Æ°á»£c: loáº¡i khá»i nguá»“n tÃ­nh toÃ¡n).
function LocationConfig({ warehouseId, categories }: { warehouseId: string; categories: string[] }) {
  const { data: locations = [], isLoading } = useLocationsReal({ warehouse_id: warehouseId }, !!warehouseId)
  const { mutate: save, isPending } = useUpdateSlottingLocationConfig()
  const [noIn, setNoIn] = useState<string[]>([])
  const [noOut, setNoOut] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  type LocRow = { id: string; location_code: string; categories?: string[] | null; is_active?: boolean; slot_no_in?: boolean; slot_no_out?: boolean }
  const locs = (locations as LocRow[]).filter(l => l.is_active !== false)

  // Náº¡p tráº¡ng thÃ¡i hiá»‡n táº¡i tá»« TOÃ€N Bá»˜ vá»‹ trÃ­ cá»§a kho (khÃ´ng theo filter Loáº¡i kho) â€”
  // nÃºt LÆ°u lÃ  replace-all per kho: náº¿u chá»‰ náº¡p vá»‹ trÃ­ trong filter sáº½ XÃ“A NHáº¦M cá» cá»§a vá»‹ trÃ­ Ä‘ang bá»‹ áº©n
  useEffect(() => {
    if (dirty) return
    setNoIn(locs.filter(l => l.slot_no_in).map(l => l.id))
    setNoOut(locs.filter(l => l.slot_no_out).map(l => l.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, warehouseId])
  useEffect(() => { setDirty(false); setMsg(''); setErr('') }, [warehouseId])

  // Option theo filter Loáº¡i kho phÃ­a trÃªn (user 18/07): vá»‹ trÃ­ Ä‘Ãºng loáº¡i + vá»‹ trÃ­ CHÆ¯A khai loáº¡i;
  // vá»‹ trÃ­ ÄÃƒ chá»n luÃ´n hiá»‡n (ká»ƒ cáº£ ngoÃ i filter) Ä‘á»ƒ cÃ²n bá» chá»n Ä‘Æ°á»£c
  const optionsFor = (selectedIds: string[]) => {
    const sel = new Set(selectedIds)
    return locs
      .filter(l => categories.length === 0 || !l.categories?.length || l.categories.some(c => categories.includes(c)) || sel.has(l.id))
      .map(l => ({ value: l.id, label: l.categories?.length ? `${l.location_code} Â· ${l.categories.join(', ')}` : l.location_code }))
  }

  function handleSave() {
    setMsg(''); setErr('')
    save({ warehouse_id: warehouseId, no_in_ids: noIn, no_out_ids: noOut }, {
      onSuccess: r => { setDirty(false); setMsg(`ÄÃ£ lÆ°u: ${r.no_in} vá»‹ trÃ­ khÃ´ng Ä‘Æ°a hÃ ng vÃ o Â· ${r.no_out} vá»‹ trÃ­ khÃ´ng láº¥y hÃ ng Ä‘i`) },
      onError: e => setErr(apiMsg(e)),
    })
  }

  return (
    // NÃ‰N 1 hÃ ng (báº£ng khu chiáº¿m ~80% â€” user 18/07): nhÃ£n + dropdown + LÆ°u náº±m ngang, mÃ´ táº£ trong tooltip
    <div className="px-3 py-1.5 border-b space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-1 h-3.5 rounded bg-sky-500 shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 shrink-0">Vá»‹ trÃ­ Ä‘áº·c biá»‡t</span>
        <span className="text-[10px] text-slate-500 shrink-0" title="Kho táº¡m â€” khÃ´ng lÃ m Ä‘Ã­ch, hÃ ng náº±m Ä‘Ã³ luÃ´n bá»‹ kÃ©o Ä‘i">KhÃ´ng Ä‘Æ°a hÃ ng vÃ o:</span>
        <MultiSelectFilter label={noIn.length > 0 ? `${noIn.length} vá»‹ trÃ­` : 'Chá»n vá»‹ trÃ­â€¦'} options={optionsFor(noIn)}
          selected={noIn} onChange={v => { setNoIn(v); setDirty(true); setMsg('') }} selectedFirst />
        <span className="text-[10px] text-slate-500 shrink-0" title="HÃ ng káº¹t/khÃ´ng bá»‘c Ä‘Æ°á»£c â€” loáº¡i khá»i nguá»“n tÃ­nh toÃ¡n, váº«n tÃ­nh chiáº¿m chá»—">KhÃ´ng láº¥y hÃ ng Ä‘i:</span>
        <MultiSelectFilter label={noOut.length > 0 ? `${noOut.length} vá»‹ trÃ­` : 'Chá»n vá»‹ trÃ­â€¦'} options={optionsFor(noOut)}
          selected={noOut} onChange={v => { setNoOut(v); setDirty(true); setMsg('') }} selectedFirst />
        <Button size="sm" className="h-7 text-[11px] !min-h-0" onClick={handleSave} disabled={isPending || !dirty}>
          {isPending ? 'Äang lÆ°uâ€¦' : 'LÆ°u vá»‹ trÃ­'}
        </Button>
        {isLoading && <span className="text-[10px] text-slate-400">Äang táº£iâ€¦</span>}
      </div>
      {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</p>}
      {msg && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">{msg}</p>}
    </div>
  )
}

// â”€â”€â”€ Tab Káº¿ hoáº¡ch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// NÃºt QuÃ©t thá»±c hiá»‡n KHÃ”NG Ä‘áº·t á»Ÿ tab danh sÃ¡ch (user bá» 19/07 â€” "á»Ÿ ngoÃ i khÃ´ng cÃ³ tÃ¡c dá»¥ng gÃ¬"),
// chá»‰ náº±m trong trang chi tiáº¿t káº¿ hoáº¡ch (cuá»‘i Ã´ Tá»« vá»‹ trÃ­ tá»«ng dÃ²ng).
function PlansTab({ warehouseId, canPlan, canDelete, onOpen }: {
  warehouseId: string; canPlan: boolean; canDelete: boolean; onOpen: (id: string) => void
}) {
  const { data: plans = [], isLoading, error } = useSlottingPlans(warehouseId || undefined)
  const { mutate: deletePlan, isPending: deleting } = useDeleteSlottingPlan()
  const [delErr, setDelErr] = useState('')

  function handleDelete(p: SlottingPlanRow) {
    if (!confirm(`XÃ³a káº¿ hoáº¡ch "${p.name}" (${p.n_lines} dÃ²ng)?\nChá»‰ xÃ³a báº£n káº¿ hoáº¡ch â€” pallet Ä‘Ã£ chuyá»ƒn KHÃ”NG bá»‹ hoÃ n tÃ¡c.`)) return
    deletePlan(p.id, { onError: e => setDelErr(apiMsg(e)) })
  }

  const tiles: BandTile[] = [
    { label: 'Káº¿ hoáº¡ch', value: nf.format(plans.length) },
    { label: 'Äang thá»±c hiá»‡n', value: nf.format(plans.filter(p => p.status === 'ACTIVE').length), accent: true },
    { label: 'HoÃ n thÃ nh', value: nf.format(plans.filter(p => p.status === 'COMPLETED').length) },
  ]

  return (
    <>
      <SummaryBand tiles={tiles} />
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {delErr && <div className="m-3 p-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">{delErr}</div>}
        {error ? (
          <div className="m-3 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded">{apiMsg(error)}</div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Äang táº£iâ€¦</div>
        ) : plans.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <Boxes className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-sm">ChÆ°a cÃ³ káº¿ hoáº¡ch sáº¯p xáº¿p nÃ o</p>
            {canPlan && <p className="text-xs">Sang tab "PhÃ¢n tÃ­ch ABC" â†’ "Táº¡o káº¿ hoáº¡ch sáº¯p xáº¿p"</p>}
          </div>
        ) : (
          <Table className="[&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">TÃªn káº¿ hoáº¡ch</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tráº¡ng thÃ¡i</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tiáº¿n Ä‘á»™ (pallet)</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Sá»‘ dÃ²ng</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Má»©c Ä‘á»™</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">NguyÃªn táº¯c</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">NgÆ°á»i táº¡o</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">NgÃ y táº¡o</TableHead>
                {canDelete && <TableHead className="px-2 py-1.5 w-10 sticky right-0 z-20 bg-slate-50 border-l border-slate-200" />}
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
                      ) : <span className="text-slate-300 text-[10px]">â€”</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{p.n_lines}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{p.level ? LEVEL_LABEL[p.level] : 'â€”'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{p.principle ?? 'â€”'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{p.created_by ?? 'â€”'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{formatTimestampDate(p.created_at, true)}</TableCell>
                    {canDelete && (
                      <TableCell className="px-2 py-1 whitespace-nowrap sticky right-0 z-10 bg-white border-l border-slate-100">
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
      <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1â€“{plans.length} / {plans.length} káº¿ hoáº¡ch</div>
    </>
  )
}

