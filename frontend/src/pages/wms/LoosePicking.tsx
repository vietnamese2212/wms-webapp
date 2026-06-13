import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Scissors, Bookmark, Rows3, AlignJustify } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLoosePickingItems, useWarehouses, type LoosePickingItem } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { useActiveLoosePickingStore } from '@/stores/activeLoosePickingStore'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// ─── GDO-level summary ────────────────────────────────────────

type GDOSummary = {
  gdo: LoosePickingItem['gdo']
  items: LoosePickingItem[]
  totalLoose: number
  totalLooseDone: number
  pendingCount: number
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
  function toggleDensity() {
    setDense(d => { localStorage.setItem('loosePicking_density', d ? 'comfortable' : 'compact'); return !d })
  }

  const { data: warehouses = [] } = useWarehouses(true)

  useEffect(() => {
    if (!f.warehouseId) {
      const defaultId = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (defaultId) setLoosePicking({ warehouseId: defaultId })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const looseAllowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  const { data: items = [], isLoading } = useLoosePickingItems({
    warehouse_id: f.warehouseId || undefined,
    date_from:    f.dateFrom    || undefined,
    date_to:      f.dateTo      || undefined,
  })

  const grouped = useMemo((): GDOSummary[] => {
    const map = new Map<string, { gdo: LoosePickingItem['gdo']; items: LoosePickingItem[] }>()
    for (const item of items) {
      const key = item.gdo?.id ?? '__unknown__'
      if (!map.has(key)) map.set(key, { gdo: item.gdo, items: [] })
      map.get(key)!.items.push(item)
    }
    return [...map.values()]
      .map(({ gdo, items: gdoItems }) => {
        const totalLoose    = gdoItems.reduce((s, i) => s + itemLooseStats(i).effective, 0)
        const totalLooseDone = gdoItems.reduce((s, i) => s + itemLooseStats(i).done, 0)
        const pendingCount  = gdoItems.filter(i => itemLooseStats(i).remaining > 0).length
        return { gdo, items: gdoItems, totalLoose, totalLooseDone, pendingCount }
      })
      .sort((a, b) => {
        const da = a.gdo?.delivery_date ?? '', db = b.gdo?.delivery_date ?? ''
        if (da !== db) return da.localeCompare(db)
        return (a.gdo?.group_code ?? '').localeCompare(b.gdo?.group_code ?? '')
      })
  }, [items])

  const filterWarehouseTypes = f.filterWarehouseTypes ?? []
  const filterTypes          = f.filterTypes          ?? []
  const filterDvvts          = f.filterDvvts          ?? []
  const filterNpps           = f.filterNpps           ?? []

  const filtered = useMemo(() => {
    return grouped.filter(s => {
      if (filterWarehouseTypes.length > 0 && !filterWarehouseTypes.includes(s.gdo?.warehouse_type ?? '')) return false
      if (filterTypes.length          > 0 && !filterTypes.includes(s.gdo?.export_type ?? ''))             return false
      if (filterDvvts.length          > 0 && !filterDvvts.includes(s.gdo?.dvvt ?? ''))                   return false
      if (filterNpps.length           > 0 && !(s.gdo?.distributor_names ?? []).some(n => filterNpps.includes(n))) return false
      if (f.search.trim()) {
        const q = f.search.trim().toLowerCase()
        if (
          !s.gdo?.group_code?.toLowerCase().includes(q) &&
          !s.gdo?.distributor_names?.some(n => n.toLowerCase().includes(q)) &&
          !s.items.some(i =>
            (i.material?.material_code ?? i.material_code_raw ?? '').toLowerCase().includes(q) ||
            (i.material?.short_name ?? '').toLowerCase().includes(q)
          )
        ) return false
      }
      return true
    })
  }, [grouped, f.search, filterDvvts, filterNpps, filterWarehouseTypes, filterTypes])

  const dvvtOptions         = useMemo(() => [...new Set(grouped.map(s => s.gdo?.dvvt).filter(Boolean))] as string[], [grouped])
  const nppOptions          = useMemo(() => [...new Set(grouped.flatMap(s => s.gdo?.distributor_names ?? []).filter(Boolean))], [grouped])
  const warehouseTypeOpts   = useMemo(() => [...new Set(grouped.map(s => s.gdo?.warehouse_type).filter(Boolean))] as string[], [grouped])
  const typeOptions         = useMemo(() => [...new Set(grouped.map(s => s.gdo?.export_type).filter(Boolean))] as string[], [grouped])

  const totalPending = items.filter(i => itemLooseStats(i).remaining > 0).length

  const summary = useMemo(() => ({
    count:      filtered.length,
    items:      filtered.reduce((s, g) => s + g.items.length, 0),
    looseDone:  filtered.reduce((s, g) => s + g.totalLooseDone, 0),
    looseTotal: filtered.reduce((s, g) => s + g.totalLoose, 0),
  }), [filtered])

  const isToday = f.dateFrom === TODAY && f.dateTo === TODAY

  // ─── Filter chip bar (Manhattan) ───
  const warehouseOptions = (warehouses as any[])
    .filter((w: any) => !looseAllowedWhIds || looseAllowedWhIds.has(w.id))
    .map((w: any) => ({ value: w.id, label: w.name }))

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày xuất', type: 'daterange', from: f.dateFrom, to: f.dateTo,
      onChange: (from, to) => setLoosePicking({ dateFrom: from, dateTo: to }) },
    { key: 'warehouse', label: 'Kho xuất', type: 'single', options: warehouseOptions, value: f.warehouseId || '', allLabel: 'Tất cả kho',
      onChange: v => setLoosePicking({ warehouseId: v }) },
    { key: 'whType', label: 'Loại kho', type: 'multi', options: warehouseTypeOpts.map(t => ({ value: t, label: t })), selected: filterWarehouseTypes,
      onChange: v => setLoosePicking({ filterWarehouseTypes: v }) },
    { key: 'exportType', label: 'Loại xuất', type: 'multi', options: typeOptions.map(t => ({ value: t, label: t })), selected: filterTypes,
      onChange: v => setLoosePicking({ filterTypes: v }) },
    { key: 'dvvt', label: 'ĐVVT', type: 'multi', options: dvvtOptions.map(d => ({ value: d, label: d })), selected: filterDvvts,
      onChange: v => setLoosePicking({ filterDvvts: v }) },
    { key: 'npp', label: 'NPP', type: 'multi', options: nppOptions.map(n => ({ value: n, label: n })), selected: filterNpps, searchable: true,
      onChange: v => setLoosePicking({ filterNpps: v }) },
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
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Nhặt lẻ</span>
          {totalPending > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">
              {totalPending} chưa xong
            </span>
          )}
          <SearchInput value={f.search} onChange={v => setLoosePicking({ search: v })} placeholder="Tìm số xe, NPP, mã hàng…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
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
        </div>

        {/* Filter chip bar (desktop) */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
          {!isToday && (
            <button className="inline-flex h-7 px-2 text-[11px] text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
              onClick={() => setLoosePicking({ dateFrom: TODAY, dateTo: TODAY })}>
              Hôm nay
            </button>
          )}
        </div>
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={[
        { label: 'Chuyến xe', value: summary.count },
        { label: 'Mặt hàng', value: summary.items },
        { label: 'Nhặt lẻ', value: `${summary.looseDone}/${summary.looseTotal}` },
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
          <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-8 px-1 py-1.5" />
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Ngày xuất</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Số xe</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">NPP</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">ĐVVT</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Kho xuất</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 text-right whitespace-nowrap px-2 py-1.5">Mặt hàng</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 text-right whitespace-nowrap px-2 py-1.5">Nhặt lẻ</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5 min-w-[80px]">Tiến độ</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">T.T. đơn</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">T.T. nhặt lẻ</TableHead>
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
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] font-medium tabular-nums">{dateStr}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] font-mono font-semibold">{s.gdo?.group_code ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 max-w-[140px]">
                      <span className="text-[10px] text-slate-600 line-clamp-2 leading-tight">{npp || '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] text-slate-600">{s.gdo?.dvvt ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] text-slate-700">{s.gdo?.warehouse?.name ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[10px] font-semibold tabular-nums">{s.items.length}</span>
                      <span className="text-[9px] text-slate-400 ml-0.5">mặt hàng</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[10px] font-semibold tabular-nums">{s.totalLooseDone}</span>
                      <span className="text-[9px] text-slate-400">/{s.totalLoose}</span>
                      <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
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
          </div>
        )}
      </div>

      {/* Footer đếm bản ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {filtered.length > 0 ? `1–${filtered.length} / ${filtered.length} chuyến xe` : '0 chuyến xe'}
      </div>
     </div>
    </div>
  )
}
