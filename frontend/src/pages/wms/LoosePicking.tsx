import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Scissors, Bookmark, Rows3, AlignJustify, RefreshCcw } from 'lucide-react'
import type { AxiosError } from 'axios'
import { SearchInput } from '@/components/shared/SearchInput'
import { ActionCluster } from '@/components/shared/ActionBtn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { can, type ModulePermissions } from '@/config/permissions'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLoosePickingItems, useLoosePickingFacets, useWarehouses, useBookingSequence, useRecalcLoosePicking, type LoosePickingItem, type BookingSeqRow, type RecalcLooseResult } from '@/api/hooks'
import { bookingSeqOf, seqTimeLabel } from '@/utils/bookingSeq'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { qtyEntryDecimal, qtyUnitLabel, QTY_CONVERTED_TIP } from '@/utils/qtyUnits'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { useActiveLoosePickingStore } from '@/stores/activeLoosePickingStore'

const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

const LOOSE_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'pin',        label: '',             w: 34 },
  { id: 'date',       label: 'Ngày xuất',    w: 90 },
  { id: 'code',       label: 'Số xe',        w: 132 },
  { id: 'stt',        label: 'STT booking',  w: 100 },   // thứ tự soạn theo khung giờ đặt lịch — nhặt lẻ soạn trước cho xe tới sớm
  { id: 'npp',        label: 'NPP',          w: 160 },
  { id: 'dvvt',       label: 'ĐVVT',         w: 90 },
  { id: 'wh',         label: 'Kho xuất',     w: 140 },
  { id: 'items',      label: 'Mặt hàng',     w: 110, align: 'right' },
  { id: 'loose',      label: 'Nhặt lẻ',      w: 120, align: 'right' },
  { id: 'progress',   label: 'Tiến độ',      w: 96 },
  { id: 'gdoStatus',  label: 'T.T. đơn',     w: 96 },
  { id: 'pickStatus', label: 'T.T. nhặt lẻ', w: 110 },
]
const LOOSE_COL_DEFAULTS = LOOSE_COLS.map(c => c.w)

// ─── GDO-level summary ────────────────────────────────────────

type GDOSummary = {
  gdo: LoosePickingItem['gdo']
  items: LoosePickingItem[]
  totalLoose: number
  totalLooseDone: number
  pendingCount: number
  // Nhãn đơn vị của tổng: mọi mã cùng 1 đơn vị → in đúng đơn vị đó; trộn (POSM CÁI + FG thùng)
  // → 'SL quy đổi' (từ vựng chốt 26/07 — đừng in "thùng" lên con số có CÁI/KG bên trong)
  unitLabel: string | null
}

function itemLooseStats(i: LoosePickingItem) {
  const ov       = Math.max(0, (i.cartons_scanned - i.loose_scanned) - (i.cartons_ordered - i.loose_picking))
  const effective = Math.max(0, i.loose_picking - ov)
  const done      = Math.min(i.loose_scanned, effective)
  return { effective, done, remaining: Math.max(0, effective - done) }
}

function rowText(s: GDOSummary): string {
  if (s.totalLoose > 0 && s.totalLooseDone >= s.totalLoose) return 'text-[#4A90D9] line-through hover:bg-slate-50'
  if (s.totalLooseDone > 0)                                  return 'text-[#D8891C] hover:bg-slate-50'
  return 'hover:bg-slate-50'
}

function gdoStatusInfo(gdo: LoosePickingItem['gdo']): { label: string; cls: string } {
  if (!gdo) return { label: '—', cls: 'bg-slate-100 text-slate-400' }
  if (gdo.status === 'COMPLETED')   return { label: 'Hoàn thành', cls: 'bg-blue-100 text-blue-700'   }
  if (gdo.status === 'IN_PROGRESS') return { label: 'Đang xuất',  cls: 'bg-amber-100 text-amber-700' }
  if (gdo.status === 'PAUSED')      return { label: 'Tạm dừng',   cls: 'bg-red-100 text-red-700'     }
  if (gdo.started_at)               return { label: 'Đang xuất',  cls: 'bg-amber-100 text-amber-700' }
  return                                   { label: 'Chờ xe',     cls: 'bg-slate-100 text-slate-500' }
}

function pickingStatusInfo(s: GDOSummary): { label: string; cls: string } {
  if (s.totalLoose === 0)                           return { label: '—',              cls: 'bg-slate-100 text-slate-400' }
  if (s.totalLooseDone >= s.totalLoose)             return { label: 'Xong',           cls: 'bg-blue-100 text-blue-700'   }
  if (s.totalLooseDone > 0)                         return { label: 'Đang chuẩn bị', cls: 'bg-amber-100 text-amber-700' }
  return                                                   { label: 'Chưa chuẩn bị', cls: 'bg-slate-100 text-slate-500' }
}

// ─── Main page ─────────────────────────────────────────────────

export default function LoosePicking() {
  const user     = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const { pin, unpin, isPinned } = useActiveLoosePickingStore()
  const { loosePicking: f, setLoosePicking } = useWmsFilterStore()
  const [dense, setDense] = useState(() => localStorage.getItem('loosePicking_density') !== 'comfortable')
  const { widths: colW, startResize, totalWidth } = useColumnResize('loosePicking_col_widths', LOOSE_COL_DEFAULTS)
  function toggleDensity() {
    setDense(d => { localStorage.setItem('loosePicking_density', d ? 'comfortable' : 'compact'); return !d })
  }

  const { data: warehouses = [] } = useWarehouses(true)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null

  // "Tính lại nhặt lẻ" — setting không hồi tố đơn đã tạo; nút này áp lại cho chuyến CHƯA bắt đầu
  const [recalcOpen,   setRecalcOpen]   = useState(false)
  const [recalcResult, setRecalcResult] = useState<RecalcLooseResult | null>(null)
  const [recalcError,  setRecalcError]  = useState('')
  const { mutate: recalcLoose, isPending: recalcSaving } = useRecalcLoosePicking()

  useEffect(() => {
    if (!f.warehouseId) {
      const defaultId = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (defaultId) setLoosePicking({ warehouseId: defaultId })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const looseAllowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  const filterWarehouseTypes = f.filterWarehouseTypes ?? []
  const filterTypes          = f.filterTypes          ?? []
  const filterDvvts          = f.filterDvvts          ?? []
  const filterNpps           = f.filterNpps           ?? []

  // Mọi bộ lọc chạy trên SERVER: lọc sau khi phân trang = lọc trong 1 trang (ra thiếu, không báo).
  // Trang cắt theo CHUYẾN nên 1 chuyến không bị xẻ đôi.
  const { data, isLoading } = useLoosePickingItems({
    warehouse_id: f.warehouseId || undefined,
    date_from:    f.dateFrom    || undefined,
    date_to:      f.dateTo      || undefined,
    wh_types:     filterWarehouseTypes.join(',') || undefined,
    export_types: filterTypes.join(',')          || undefined,
    dvvts:        filterDvvts.join(',')          || undefined,
    npps:         filterNpps.join(',')           || undefined,
    search:       f.search || undefined,
    page:         f.page,
    page_size:    f.pageSize,
  })
  const items      = data?.items ?? []
  const totalTrips = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalTrips / f.pageSize))
  // Ô chọn bộ lọc tính trên phạm vi NGÀY + KHO trong DB (không phải trên trang đang xem)
  const { data: facets } = useLoosePickingFacets({
    warehouse_id: f.warehouseId || undefined,
    date_from:    f.dateFrom    || undefined,
    date_to:      f.dateTo      || undefined,
  })

  // STT theo booking khung giờ — nhặt lẻ soạn TRƯỚC khi xe tới nên thứ tự xe tới = thứ tự soạn
  const seqRange = useMemo(() => {
    const ds = items.map(i => i.gdo?.delivery_date).filter(Boolean) as string[]
    if (!ds.length) return null
    let min = ds[0], max = ds[0]
    for (const d of ds) { if (d < min) min = d; if (d > max) max = d }
    // BE chặn khoảng >190 ngày (chống fuzz) — trang trải quá rộng thì thôi không tra STT
    const span = (new Date(`${max}T00:00:00Z`).getTime() - new Date(`${min}T00:00:00Z`).getTime()) / 86_400_000
    return span > 190 ? null : { min, max }
  }, [items])
  const { data: seqRows = [] } = useBookingSequence(f.warehouseId || undefined, seqRange?.min, seqRange?.max)
  const seqOfGdo = (g: LoosePickingItem['gdo']): BookingSeqRow | null =>
    g?.delivery_date ? bookingSeqOf(seqRows, { group_code: g.group_code, delivery_date: g.delivery_date, warehouse_id: g.warehouse?.id }) : null

  const grouped = useMemo((): GDOSummary[] => {
    const map = new Map<string, { gdo: LoosePickingItem['gdo']; items: LoosePickingItem[] }>()
    for (const item of items) {
      const key = item.gdo?.id ?? '__unknown__'
      if (!map.has(key)) map.set(key, { gdo: item.gdo, items: [] })
      map.get(key)!.items.push(item)
    }
    return [...map.values()]
      .map(({ gdo, items: gdoItems }) => {
        // BASE UNIT: quy đổi THÙNG per-mã trước khi cộng cross-mã (loose_picking lưu base)
        const totalLoose    = gdoItems.reduce((s, i) => s + qtyEntryDecimal(itemLooseStats(i).effective, i.material), 0)
        const totalLooseDone = gdoItems.reduce((s, i) => s + qtyEntryDecimal(itemLooseStats(i).done, i.material), 0)
        const pendingCount  = gdoItems.filter(i => itemLooseStats(i).remaining > 0).length
        const units = new Set(gdoItems.map(i => qtyUnitLabel(i.material)))
        return { gdo, items: gdoItems, totalLoose, totalLooseDone, pendingCount,
          unitLabel: units.size === 1 ? [...units][0] : null }
      })
      .sort((a, b) => {
        const da = a.gdo?.delivery_date ?? '', db = b.gdo?.delivery_date ?? ''
        if (da !== db) return da.localeCompare(db)
        // Trong cùng ngày: xe đặt khung giờ sớm soạn trước, xe chưa đặt lịch xuống cuối
        const sa = seqOfGdo(a.gdo)?.stt ?? Infinity, sb = seqOfGdo(b.gdo)?.stt ?? Infinity
        if (sa !== sb) return sa - sb
        return (a.gdo?.group_code ?? '').localeCompare(b.gdo?.group_code ?? '')
      })
  }, [items, seqRows])   // eslint-disable-line react-hooks/exhaustive-deps

  // Server đã lọc → `grouped` CHÍNH LÀ danh sách hiển thị (đừng lọc lại: lọc lần hai trên trang
  // đang xem chỉ có thể làm mất dòng, không thể tìm thêm dòng ở trang khác).
  const filtered = grouped

  const dvvtOptions       = facets?.dvvts        ?? []
  const nppOptions        = facets?.npps         ?? []
  const warehouseTypeOpts = facets?.wh_types     ?? []
  const typeOptions       = facets?.export_types ?? []

  // 4 ô SummaryBand tính trên TOÀN BỘ bộ lọc (server), không phải trang đang xem
  const totalPending = data?.pending_n ?? 0
  const summary = {
    count:      totalTrips,
    items:      data?.items_n ?? 0,
    looseDone:  data?.loose_done ?? 0,
    looseTotal: data?.loose_total ?? 0,
  }

  const isToday = f.dateFrom === TODAY() && f.dateTo === TODAY()

  // ─── Filter chip bar (Manhattan) ───
  const warehouseOptions = (warehouses as any[])
    .filter((w: any) => !looseAllowedWhIds || looseAllowedWhIds.has(w.id))
    .map((w: any) => ({ value: w.id, label: w.name }))

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày xuất', type: 'daterange', from: f.dateFrom, to: f.dateTo,
      onChange: (from, to) => setLoosePicking({ dateFrom: from, dateTo: to, page: 1 }) },
    { key: 'warehouse', label: 'Kho xuất', type: 'single', options: warehouseOptions, value: f.warehouseId || '', allLabel: 'Tất cả kho',
      onChange: v => setLoosePicking({ warehouseId: v, page: 1 }) },
    { key: 'whType', label: 'Loại kho', type: 'multi', options: warehouseTypeOpts.map((t: string) => ({ value: t, label: t })), selected: filterWarehouseTypes,
      onChange: v => setLoosePicking({ filterWarehouseTypes: v, page: 1 }) },
    { key: 'exportType', label: 'Loại xuất', type: 'multi', options: typeOptions.map((t: string) => ({ value: t, label: t })), selected: filterTypes,
      onChange: v => setLoosePicking({ filterTypes: v, page: 1 }) },
    { key: 'dvvt', label: 'ĐVVT', type: 'multi', options: dvvtOptions.map((d: string) => ({ value: d, label: d })), selected: filterDvvts,
      onChange: v => setLoosePicking({ filterDvvts: v, page: 1 }) },
    { key: 'npp', label: 'NPP', type: 'multi', options: nppOptions.map((n: string) => ({ value: n, label: n })), selected: filterNpps, searchable: true,
      onChange: v => setLoosePicking({ filterNpps: v, page: 1 }) },
  ]

  const viewSnapshot = {
    search: f.search, dateFrom: f.dateFrom, dateTo: f.dateTo, warehouseId: f.warehouseId,
    filterWarehouseTypes, filterTypes, filterDvvts, filterNpps,
  }
  const savedViews = useSavedViewsStore(s => s.views['loosePicking'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">

      {/* ── Toolbar ── */}
      <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:py-2 sm:space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Nhặt lẻ</span>
          {totalPending > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">
              {totalPending} chưa xong
            </span>
          )}
          <SearchInput value={f.search} onChange={v => setLoosePicking({ search: v, page: 1 })} placeholder="Tìm số xe, NPP, mã hàng…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          {/* Mobile: SavedViews + action GOM 1 hàng (PDA); desktop sm:contents → như cũ */}
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
          <SavedViews
            module="loosePicking"
            currentFilters={viewSnapshot}
            activeId={activeViewId}
            onApply={(filters) => setLoosePicking(filters as Partial<typeof f>)}
          />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {can(perms, 'loosepicking', 'recalc') && (
            <ActionCluster mobileInline items={[{
              key: 'recalc', icon: RefreshCcw, label: 'Tính lại',
              tip: f.warehouseId
                ? 'Tính lại số nhặt lẻ theo setting hiện tại của kho (chuyến chưa bắt đầu)'
                : 'Chọn Kho xuất trước — setting nhặt lẻ đặt theo từng kho',
              disabled: !f.warehouseId,
              onClick: () => { setRecalcResult(null); setRecalcError(''); setRecalcOpen(true) },
            }]} />
          )}
          </div>
        </div>

        {/* Filter chip bar (desktop) */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
          {!isToday && (
            <button className="inline-flex h-7 px-2 text-[11px] text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
              onClick={() => setLoosePicking({ dateFrom: TODAY(), dateTo: TODAY() })}>
              Hôm nay
            </button>
          )}
        </div>
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={[
        { label: 'Chuyến xe', value: summary.count },
        { label: 'Mặt hàng', value: summary.items },
        { label: 'Nhặt lẻ (quy đổi)', value: `${summary.looseDone.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}/${summary.looseTotal.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}`, tip: QTY_CONVERTED_TIP },
        { label: 'Chưa xong', value: totalPending, accent: totalPending > 0 },
      ]} />

      {/* ── Table ── */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <Scissors className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {f.search
                ? 'Không tìm thấy chuyến xe'
                : (f.dateFrom || f.dateTo)
                ? 'Không có nhặt lẻ trong khoảng ngày đã chọn'
                : 'Không có nhặt lẻ'}
            </p>
          </div>
        ) : (
          <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow className="bg-slate-50">
                {LOOSE_COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5 ${c.align === 'right' ? 'text-right' : ''} ${i === 1 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    {i > 0 && (
                      <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                        className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => {
                const { label: gLabel, cls: gCls } = gdoStatusInfo(s.gdo)
                const { label: pLabel, cls: pCls } = pickingStatusInfo(s)
                const pct      = s.totalLoose > 0 ? Math.min(100, (s.totalLooseDone / s.totalLoose) * 100) : 0
                const dateStr  = s.gdo?.delivery_date
                  ? format(parseISO(s.gdo.delivery_date), 'dd-MM-yy', { locale: vi })
                  : '—'
                const gdoId  = s.gdo?.id ?? ''
                const pinned = isPinned(gdoId)
                const npp    = s.gdo?.distributor_names?.join(', ') ?? ''
                const seq    = seqOfGdo(s.gdo)

                return (
                  <TableRow
                    key={gdoId || '__unknown__'}
                    className={`cursor-pointer ${rowText(s)} ${dense ? '' : '[&_td]:py-2.5'}`}
                    onClick={() => gdoId && navigate(`/wms/loosepicking/${gdoId}`)}
                  >
                    <TableCell className="px-1 py-1">
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          if (!s.gdo) return
                          pinned
                            ? unpin(s.gdo.id)
                            : pin({ id: s.gdo.id, group_code: s.gdo.group_code, status: s.gdo.status })
                        }}
                        className={`p-1 rounded transition-colors ${pinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
                        title={pinned ? 'Bỏ đánh dấu đang làm' : 'Đánh dấu đang làm'}
                      >
                        <Bookmark className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} />
                      </button>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-white">
                      <span className="text-[10px] font-medium tabular-nums">{dateStr}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] font-mono font-semibold truncate block" title={s.gdo?.group_code ?? ''}>{s.gdo?.group_code ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {seq ? (
                        <span title={`Thứ tự soạn theo booking — khung giờ ${seqTimeLabel(seq)}`}>
                          <span className="text-[11px] font-bold tabular-nums text-sky-700">#{seq.stt}</span>
                          <span className="text-[9px] text-slate-400 ml-1 tabular-nums">{seqTimeLabel(seq)}</span>
                        </span>
                      ) : <span className="text-slate-300" title="Xe chưa đặt lịch khung giờ">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 max-w-[140px]">
                      <span className="text-[10px] text-slate-600 line-clamp-2 leading-tight" title={npp}>{npp || '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] text-slate-600 truncate block" title={s.gdo?.dvvt ?? ''}>{s.gdo?.dvvt ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] text-slate-700 truncate block" title={s.gdo?.warehouse?.name ?? ''}>{s.gdo?.warehouse?.name ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[10px] font-semibold tabular-nums">{s.items.length}</span>
                      <span className="text-[9px] text-slate-400 ml-0.5">mặt hàng</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[10px] font-semibold tabular-nums">{s.totalLooseDone.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</span>
                      <span className="text-[9px] text-slate-400">/{s.totalLoose.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</span>
                      <span className="text-[9px] text-slate-400 ml-0.5" title={s.unitLabel ? undefined : QTY_CONVERTED_TIP}>{s.unitLabel ?? 'SL quy đổi'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[40px]">
                          <div
                            className={`h-full rounded-full transition-all ${
                              pct >= 100 ? 'bg-blue-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[9px] tabular-nums text-slate-500 shrink-0">{Math.round(pct)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${gCls}`}>{gLabel}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${pCls}`}>{pLabel}</span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        <PagerNav page={f.page} totalPages={totalPages} onPage={p => setLoosePicking({ page: p })} />
      </div>

      <ListFooter page={f.page} pageSize={f.pageSize} total={totalTrips} unit="chuyến xe"
        onPageSize={n => setLoosePicking({ pageSize: n, page: 1 })} />
     </div>

      {/* Dialog "Tính lại nhặt lẻ" — có GIẢI THÍCH rõ phạm vi (user chốt 24/08: setting không hồi tố) */}
      <Dialog open={recalcOpen} onOpenChange={o => { if (!recalcSaving) setRecalcOpen(o) }}>
        <DialogContent className="max-w-[94vw] sm:max-w-md p-4 gap-3">
          <DialogHeader><DialogTitle className="text-sm font-semibold">Tính lại nhặt lẻ theo setting</DialogTitle></DialogHeader>
          <div className="text-xs text-slate-600 space-y-1.5">
            <p>
              Setting nhặt lẻ (Cài đặt WMS › Kho / Loại kho) <b>không tự áp cho đơn đã tạo trước đó</b>.
              Nút này tính lại số nhặt lẻ theo setting hiện tại cho các <b>chuyến CHƯA BẮT ĐẦU</b> của kho đang lọc
              {(f.dateFrom || f.dateTo) ? ' (trong khoảng Ngày xuất đang lọc)' : ''}.
            </p>
            <ul className="list-disc pl-4 space-y-0.5 text-slate-500">
              <li>Chuyến đã bắt đầu / hoàn thành: giữ nguyên.</li>
              <li>Dòng đã soạn NHIỀU HƠN số mới: giữ nguyên (muốn hạ thì gỡ soạn rồi tính lại).</li>
              <li>Số nhặt lẻ nhập tay từ file Excel cũ: giữ nguyên — trừ khi setting là "Không nhặt lẻ" (về 0).</li>
            </ul>
          </div>
          {recalcResult && (
            <div className="text-xs bg-green-50 border border-green-200 text-green-700 rounded px-2 py-1.5">
              Đã cập nhật <b>{recalcResult.updated}</b> dòng / {recalcResult.items_checked} dòng của {recalcResult.gdos} chuyến chưa bắt đầu
              {recalcResult.kept_scanned > 0 ? <> · <b>{recalcResult.kept_scanned}</b> dòng giữ nguyên vì đã soạn nhiều hơn số mới</> : null}
              {recalcResult.kept_manual > 0 ? <> · <b>{recalcResult.kept_manual}</b> dòng giữ số nhập tay</> : null}.
            </div>
          )}
          {recalcError && <div className="text-xs bg-red-50 border border-red-200 text-red-600 rounded px-2 py-1.5">{recalcError}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setRecalcOpen(false)} disabled={recalcSaving}>{recalcResult ? 'Đóng' : 'Hủy'}</Button>
            {!recalcResult && (
              <Button size="sm" disabled={recalcSaving || !f.warehouseId} onClick={() => {
                setRecalcError('')
                recalcLoose(
                  { warehouse_id: f.warehouseId, date_from: f.dateFrom || undefined, date_to: f.dateTo || undefined },
                  {
                    onSuccess: r => setRecalcResult(r),
                    onError: err => setRecalcError(
                      (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi tính lại nhặt lẻ'),
                  },
                )
              }}>{recalcSaving ? 'Đang tính…' : 'Tính lại'}</Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
