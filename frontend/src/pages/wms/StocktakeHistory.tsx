import { useEffect } from 'react'
import { useWarehouses, useLocationsReal, useStocktakeLog, type StocktakeLogRow } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeRows } from '@/utils/excelSafe'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { SearchInput } from '@/components/shared/SearchInput'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { History, Download, Flag, Rows3, AlignJustify } from 'lucide-react'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { qtyEntryText, qtyEntryDecimal, type MatUnits } from '@/utils/qtyUnits'
import { rowText } from '@/lib/rowStatus'
import { StocktakeTabs } from '@/components/wms/StocktakeTabs'

const LOG_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'at',     label: 'Thời gian kiểm', w: 140 },
  { id: 'pallet', label: 'Mã pallet',      w: 150 },
  { id: 'loc',    label: 'Vị trí',         w: 120 },
  { id: 'mat',    label: 'Tên hàng',       w: 170 },
  { id: 'app',    label: 'Tồn App',        w: 80,  align: 'right' },
  { id: 'real',   label: 'Thực tế',        w: 90,  align: 'right' },
  { id: 'diff',   label: 'Chênh lệch',     w: 90,  align: 'right' },
  { id: 'by',     label: 'Người kiểm',     w: 130 },
  { id: 'status', label: 'Kết quả',        w: 100 },
]
const LOG_COL_DEFAULTS = LOG_COLS.map(c => c.w)

const mu = (r: StocktakeLogRow): MatUnits => ({ base_unit: r.base_unit, entry_unit: r.entry_unit, units_per_carton: r.units_per_carton })

export default function StocktakeHistory() {
  const user = useAuthStore(s => s.user)

  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null

  const { warehouseId, category, locationIds, dateFrom, dateTo, search } = useWmsFilterStore(s => s.stocktakeHistory)
  const setF = useWmsFilterStore(s => s.setStocktakeHistory)
  const [dense, setDense] = useState(() => localStorage.getItem('stocktake_history_density') === '1')
  const toggleDense = () => setDense(d => { localStorage.setItem('stocktake_history_density', d ? '0' : '1'); return !d })
  const { widths: colW, startResize, totalWidth } = useColumnResize('stocktake_history_col_widths', LOG_COL_DEFAULTS)
  const viewSnapshot = { warehouseId, category, locationIds, dateFrom, dateTo, search }
  const savedViews = useSavedViewsStore(s => s.views['stocktake_history'] ?? [])
  const activeViewId = savedViews.find(v => JSON.stringify(v.filters) === JSON.stringify(viewSnapshot))?.id ?? null

  // Mặc định kho = kho đầu tiên của user (nếu store chưa có)
  useEffect(() => {
    if (!warehouseId) {
      const def = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (def) setF({ warehouseId: def })
    }
  }, [warehouseId, user, setF])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes    = [] } = useScopedWhTypes()
  const categories = whTypes.map(t => t.value)
  const { data: locations  = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId, category: category || undefined } : undefined
  )

  const { data, isFetching } = useStocktakeLog({
    warehouse_id: warehouseId || undefined,
    category: category || undefined,
    location_ids: locationIds.length ? locationIds.join(',') : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    search: search || undefined,
  })

  const rows  = data?.rows ?? []
  const total = data?.total ?? 0
  const flaggedN = rows.filter(r => r.is_flagged).length
  const countedN = rows.filter(r => r.physical_qty != null).length
  const matchedN = Math.max(0, countedN - flaggedN)

  const defs: FilterDef[] = [
    { key: 'daterange', label: 'Ngày kiểm', type: 'daterange', pinned: true, from: dateFrom, to: dateTo,
      onChange: (from, to) => setF({ dateFrom: from, dateTo: to }) },
    { key: 'warehouse', label: 'Kho', type: 'single', value: warehouseId, allLabel: 'Tất cả kho',
      onChange: v => setF({ warehouseId: v, locationIds: [] }),
      options: (warehouses as { id: string; name: string }[]).filter(w => !allowedWhIds || allowedWhIds.has(w.id)).map(w => ({ value: w.id, label: w.name })) },
    { key: 'category', label: 'Loại hàng', type: 'single', value: category, allLabel: 'Tất cả loại',
      onChange: v => setF({ category: v, locationIds: [] }),
      options: (categories as string[]).map(c => ({ value: c, label: c })) },
    { key: 'location', label: 'Vị trí', type: 'multi', selected: locationIds,
      onChange: ids => setF({ locationIds: ids }),
      options: (locations as { id: string; location_code: string }[]).map(l => ({ value: l.id, label: l.location_code })) },
  ]

  function exportExcel() {
    const sheet = rows.map(r => ({
      'Thời gian kiểm': `${formatTimestampDate(r.counted_at, true)} ${formatTimestampTime(r.counted_at)}`,
      'Mã pallet': r.pallet_code, 'Vị trí': r.location_code ?? '',
      'Tên hàng': r.short_name ?? r.material_code ?? '',
      'Tồn App': qtyEntryDecimal(Number(r.app_qty ?? 0), mu(r)),
      'Thực tế': r.physical_qty != null ? qtyEntryDecimal(Number(r.physical_qty), mu(r)) : '',
      'Chênh lệch': r.diff != null ? qtyEntryDecimal(Number(r.diff), mu(r)) : '',
      'Người kiểm': r.counted_by_name ?? '',
      'Kết quả': r.is_flagged ? 'Chênh lệch' : (r.physical_qty != null ? 'Khớp' : 'Đã kiểm'),
    }))
    const ws = XLSX.utils.json_to_sheet(sanitizeRows(sheet))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Lịch sử kiểm')
    saveWorkbook(wb, `lich_su_kiem_${dateFrom}_${dateTo}.xlsx`)
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <StocktakeTabs />
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-1.5 shrink-0 space-y-1 sm:space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 shrink-0">
            <History className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-xs font-semibold text-slate-700">Lịch sử kiểm</span>
          </div>
          <SearchInput value={search} onChange={v => setF({ search: v })} placeholder="Tìm mã pallet…" className="flex-1 min-w-[130px]" />
          <FilterSheetButton defs={defs} className="sm:hidden" />
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <SavedViews module="stocktake_history" currentFilters={viewSnapshot} activeId={activeViewId}
              onApply={(fl) => setF(fl as Partial<typeof viewSnapshot>)} />
            <button type="button" onClick={toggleDense}
              className="hidden sm:inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0"
              title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
              {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
            </button>
            <ActionCluster className="shrink-0" mobileInline items={[{
              key: 'export', icon: Download, label: 'Excel', tip: 'Xuất Excel lịch sử kiểm đang hiển thị',
              mobileHidden: true, disabled: !rows.length, onClick: exportExcel,
            } satisfies ActionItem]} />
          </div>
          <FilterBar defs={defs} className="hidden sm:flex" />
        </div>
      </div>

      <SummaryBand tiles={[
        { label: 'Lượt kiểm', value: total },
        { label: 'Đã đếm số', value: countedN },
        { label: 'Khớp', value: matchedN },
        { label: 'Chênh lệch', value: flaggedN, accent: flaggedN > 0 },
      ]} />

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {data?.truncated && (
          <div className="mx-3 mt-2 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            Đang hiển thị {rows.length.toLocaleString('vi-VN')} / {total.toLocaleString('vi-VN')} lượt — thu hẹp khoảng ngày hoặc vị trí để xem đủ.
          </div>
        )}
        <Table className={`table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 ${dense ? '[&_td]:!py-0.5' : '[&_td]:!py-1.5'}`} style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow className="bg-slate-50">
              {LOG_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
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
            {isFetching && rows.length === 0 ? (
              <TableRow><TableCell colSpan={LOG_COLS.length} className="text-center text-xs text-slate-400 py-8">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={LOG_COLS.length} className="text-center text-xs text-slate-400 py-8">Chưa có lượt kiểm nào trong khoảng ngày này</TableCell></TableRow>
            ) : rows.map(r => {
              const stickyBg = 'bg-white'
              return (
                <TableRow key={r.id} className={rowText(r.is_flagged ? 'paused' : 'completed')}>
                  <TableCell className={`px-2 py-1 whitespace-nowrap sticky left-0 z-10 ${stickyBg}`}>
                    <span className="text-[10px] text-slate-500">{formatTimestampDate(r.counted_at, true)} {formatTimestampTime(r.counted_at)}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <span className="font-mono text-[10px] font-semibold block truncate" title={r.pallet_code}>{r.pallet_code}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <span className="font-mono text-[10px] block truncate" title={r.location_code ?? ''}>{r.location_code ?? <span className="text-slate-300">—</span>}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <span className="text-[10px] block truncate" title={r.short_name ?? r.material_code ?? ''}>{r.short_name ?? r.material_code ?? '—'}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                    <span className="text-[10px] tabular-nums">{qtyEntryText(Number(r.app_qty ?? 0), mu(r))}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                    {r.physical_qty != null
                      ? <span className="text-[10px] font-semibold tabular-nums">{qtyEntryText(Number(r.physical_qty), mu(r))}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-right">
                    {r.diff != null && Number(r.diff) !== 0
                      ? <span className={`text-[10px] font-semibold tabular-nums ${Number(r.diff) < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                          {Number(r.diff) > 0 ? '+' : ''}{qtyEntryText(Number(r.diff), mu(r))}
                        </span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <span className="text-[10px] text-slate-500">{r.counted_by_name ?? '—'}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    {r.is_flagged
                      ? <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5"><Flag className="h-2.5 w-2.5" /> Chênh lệch</span>
                      : r.physical_qty != null
                        ? <span className="text-[9px] font-semibold text-green-600 bg-green-100 rounded-full px-1.5 py-0.5">Khớp</span>
                        : <span className="text-[9px] text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5">Đã kiểm</span>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {rows.length > 0 ? `${rows.length} / ${total} lượt kiểm` : '0 lượt kiểm'}
      </div>
     </div>
    </div>
  )
}
