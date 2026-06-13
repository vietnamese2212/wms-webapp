import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { Navigation, MapPin, Package, User } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Rows3, AlignJustify } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useState, useMemo } from 'react'
import { useDeliveries } from '@/api/hooks'
import { formatDateTime, formatWeight, deliveryStatusLabel } from '@/utils/formatters'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import type { DeliveryStatus } from '@/types'

const DELIV_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'code',   label: 'Mã lệnh',                w: 110 },
  { id: 'cust',   label: 'Khách hàng / Điểm đến',  w: 190 },
  { id: 'veh',    label: 'Xe / Tài xế',            w: 150 },
  { id: 'goods',  label: 'Hàng hoá',               w: 96,  align: 'right' },
  { id: 'sched',  label: 'Lịch giao',              w: 140 },
  { id: 'status', label: 'Trạng thái',             w: 110 },
  { id: 'action', label: 'Thao tác',               w: 84,  align: 'right' },
]
const DELIV_COL_DEFAULTS = DELIV_COLS.map(c => c.w)

function deliveryKey(status: DeliveryStatus): RowStatusKey {
  if (status === 'DELIVERED')  return 'completed'
  if (status === 'IN_TRANSIT') return 'inProgress'
  if (status === 'ASSIGNED')   return 'assigned'
  if (status === 'FAILED')     return 'paused'
  return 'pending'
}

export default function Deliveries() {
  const { data: deliveries, isLoading } = useDeliveries()
  const { deliveries: df, setDeliveries } = useWmsFilterStore()
  const { widths: colW, startResize, totalWidth } = useColumnResize('deliveries_col_widths', DELIV_COL_DEFAULTS)
  const [dense, setDense] = useState(() => localStorage.getItem('deliveries_density') !== 'comfortable')
  function toggleDensity() {
    setDense(d => { localStorage.setItem('deliveries_density', d ? 'comfortable' : 'compact'); return !d })
  }
  const search       = df.search
  const statusFilter = (df.statusFilter || 'ALL') as DeliveryStatus | 'ALL'
  const setSearch       = (v: string) => setDeliveries({ search: v })

  const filtered = deliveries?.filter((d) => {
    const matchSearch =
      d.orderNo.toLowerCase().includes(search.toLowerCase()) ||
      d.customer.toLowerCase().includes(search.toLowerCase()) ||
      d.destination.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'ALL' || d.status === statusFilter
    return matchSearch && matchStatus
  }) ?? []

  const counts = {
    pending:   deliveries?.filter((d) => d.status === 'PENDING').length ?? 0,
    inTransit: deliveries?.filter((d) => d.status === 'IN_TRANSIT').length ?? 0,
    delivered: deliveries?.filter((d) => d.status === 'DELIVERED').length ?? 0,
  }

  // ─── Filter chip bar (Manhattan) ───
  const filterDefs: FilterDef[] = [
    { key: 'status', label: 'Trạng thái', type: 'single',
      options: (['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED'] as DeliveryStatus[]).map(s => ({ value: s, label: deliveryStatusLabel[s] })),
      value: statusFilter === 'ALL' ? '' : statusFilter, allLabel: 'Tất cả',
      onChange: v => setDeliveries({ statusFilter: (v || 'ALL') }) },
  ]

  const viewSnapshot = { search, statusFilter }
  const savedViews = useSavedViewsStore(s => s.views['deliveries'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Giao hàng</span>
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm mã đơn, khách hàng..." className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <SavedViews
            module="deliveries"
            currentFilters={viewSnapshot}
            activeId={activeViewId}
            onApply={(filters) => setDeliveries(filters as Partial<typeof df>)}
          />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
        </div>
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={[
        { label: 'Tổng đơn', value: filtered.length },
        { label: 'Chờ giao', value: counts.pending },
        { label: 'Đang giao', value: counts.inTransit },
        { label: 'Hoàn thành', value: counts.delivered, accent: counts.delivered > 0 },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={5} cols={6} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Navigation} title="Không có lệnh giao hàng" />
        ) : (
          <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>
              {colW.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <TableHeader>
              <TableRow>
                {DELIV_COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`relative px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.id === 'code' ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    {i > 0 && (
                      <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                        className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70"
                        title="Kéo để chỉnh độ rộng cột" />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((order) => (
                <TableRow key={order.id} className={`cursor-pointer ${rowText(deliveryKey(order.status))} ${dense ? '' : '[&_td]:py-2.5'}`}>
                  <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] sticky left-0 z-10 bg-white">{order.orderNo}</TableCell>
                  <TableCell className="px-2 py-1">
                    <p className="text-[10px] font-medium truncate max-w-[160px]">{order.customer}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1 truncate max-w-[160px]">
                      {order.destination}<MapPin className="h-2.5 w-2.5 shrink-0" />
                    </p>
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <p className="text-[10px] font-medium">{order.vehicle?.plateNumber ?? '—'}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                      {order.driver?.name ?? 'Chưa phân công'}<User className="h-2.5 w-2.5" />
                    </p>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-right">
                    <p className="text-[10px] font-medium tabular-nums">{formatWeight(order.weight)}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1 justify-end">
                      {order.items} kiện<Package className="h-2.5 w-2.5" />
                    </p>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] text-slate-500">{formatDateTime(order.scheduledAt)}</TableCell>
                  <TableCell className="px-2 py-1"><DeliveryStatusBadge status={order.status} /></TableCell>
                  <TableCell className="px-2 py-1 text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2">Chi tiết</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer đếm bản ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {filtered.length > 0 ? `1–${filtered.length} / ${filtered.length} lệnh giao` : '0 lệnh giao'}
      </div>
     </div>
    </div>
  )
}
