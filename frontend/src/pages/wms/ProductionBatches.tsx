// TRANG "MẺ CHẾ BIẾN" (MES giai đoạn 1, 14/11/2026 — docs/modules/production.md). Mỗi dòng một MẺ (lô bán thành phẩm):
// ngày SX · mã lô · mã BTP · kho chế biến · máy/ca · trạng thái · QA · số dòng NVL đã rút · đã nạp bồn · còn trong bồn.
// Phân trang SERVER: dòng + tổng + ô band trong MỘT lời gọi (RPC mes_batch_page). Lọc theo kho nhà máy ⇒ gồm kho chế biến trực thuộc.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { Plus, FileDown, AlignJustify, Rows3, Container } from 'lucide-react'
import { SavedViews } from '@/components/shared/SavedViews'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter, PagerNav } from '@/components/shared/ListPager'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { BatchFormSheet } from '@/components/wms/production/BatchFormSheet'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useProductionBatches, useProductionWarehouses, BATCH_STATUS_VI, BATCH_QA_VI, type BatchRow, type BatchQa, type BatchStatus } from '@/api/productionHooks'
import { unitCode } from '@/utils/unitCode'
import { formatDate } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeRows } from '@/utils/excelSafe'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const nf = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const COLS: RtColDef[] = [
  { id: 'code', label: 'Mã lô', w: 150 }, { id: 'day', label: 'Ngày SX', w: 78 }, { id: 'mat', label: 'Bán thành phẩm', w: 200 },
  { id: 'status', label: 'Trạng thái', w: 80 }, { id: 'qa', label: 'QA', w: 74 },
  { id: 'rm', label: 'NVL đã rút', w: 88, align: 'right' }, { id: 'filled', label: 'Đã nạp bồn', w: 96, align: 'right' },
  { id: 'intank', label: 'Còn trong bồn', w: 100, align: 'right' }, { id: 'plan', label: 'Kế hoạch', w: 86, align: 'right' },
  { id: 'wh', label: 'Kho chế biến', w: 150 }, { id: 'machine', label: 'Máy · Ca', w: 100 }, { id: 'by', label: 'Người mở', w: 130 },
]
export const BATCH_STATUS_TONE: Record<BatchStatus, BadgeTone> = { OPEN: 'amber', CLOSED: 'blue', CANCELLED: 'slate' }
export const BATCH_QA_TONE: Record<BatchQa, BadgeTone> = { HOLD: 'amber', RELEASED: 'green', REJECTED: 'red' }
export const batchRowKey = (b: { status: BatchStatus }): RowStatusKey => (b.status === 'OPEN' ? 'inProgress' : b.status === 'CLOSED' ? 'full' : 'completed')

export default function ProductionBatches() {
  const navigate = useNavigate()
  const canSeePath = useCanSeePath()
  const f = useWmsFilterStore(s => s.production)
  const setF = useWmsFilterStore(s => s.setProduction)
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canOpen = can(perms, 'production', 'open_batch')
  const canExport = can(perms, 'production', 'export')
  const { data: { kitchens, factories } } = useProductionWarehouses()
  const search = useDebouncedValue(f.search.trim(), 300)
  const page = f.page || 1, pageSize = f.pageSize || 100
  const q = useProductionBatches({
    warehouse_id: f.warehouseId || undefined, status: f.status || undefined, qa: f.qa || undefined,
    date_from: f.dateFrom || undefined, date_to: f.dateTo || undefined, search: search || undefined, page, pageSize,
  })
  const rows = q.data?.rows ?? []
  const sum = q.data?.summary
  const total = Number(sum?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => { if (!q.isLoading && total > 0 && page > totalPages) setF({ page: totalPages }) }, [q.isLoading, total, page, totalPages, setF])
  const [formOpen, setFormOpen] = useState(false)

  const whOpts = [...factories.map(w => ({ value: w.id, label: `${w.name} (nhà máy)` })), ...kitchens.map(k => ({ value: k.id, label: k.name }))]
  const defs: FilterDef[] = [
    { key: 'date', label: 'Ngày SX', type: 'daterange', from: f.dateFrom, to: f.dateTo, onChange: (a, b) => setF({ dateFrom: a, dateTo: b, page: 1 }), pinned: true },
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId, onChange: v => setF({ warehouseId: v, page: 1 }) },
    { key: 'status', label: 'Trạng thái', type: 'single', options: (['OPEN', 'CLOSED', 'CANCELLED'] as const).map(s => ({ value: s, label: BATCH_STATUS_VI[s] })), value: f.status, onChange: v => setF({ status: v, page: 1 }) },
    { key: 'qa', label: 'QA', type: 'single', options: (['HOLD', 'RELEASED', 'REJECTED'] as const).map(s => ({ value: s, label: BATCH_QA_VI[s] })), value: f.qa, onChange: v => setF({ qa: v, page: 1 }) },
  ]

  function exportExcel() {
    const sheet = rows.map((r: BatchRow) => ({
      'Mã lô': r.batch_code, 'Ngày SX': r.prod_date, 'Mã BTP': r.material_code, 'Tên BTP': r.material_name ?? '', 'Đơn vị': unitCode(r.base_unit),
      'Trạng thái': BATCH_STATUS_VI[r.status], 'QA': BATCH_QA_VI[r.qa_status], 'Dòng NVL đã rút': r.rm_lines, 'Số mã NVL': r.rm_materials,
      'Đã nạp bồn': Number(r.filled), 'Còn trong bồn': Number(r.in_tank), 'Kế hoạch': r.planned_qty ?? '', 'Kho chế biến': r.warehouse_name,
      'Máy': r.machine_code ?? '', 'Ca': r.shift ?? '', 'Người mở': r.opened_by_name ?? '', 'Ghi chú': r.note ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sanitizeRows(sheet)), 'Mẻ chế biến')
    void saveWorkbook(wb, `me_che_bien_${f.dateFrom || 'all'}_${f.dateTo || ''}_trang${page}.xlsx`)
  }

  const viewSnapshot = { search: f.search, warehouseId: f.warehouseId, dateFrom: f.dateFrom, dateTo: f.dateTo, status: f.status, qa: f.qa }
  const savedViews = useSavedViewsStore(s => s.views['production'] ?? [])
  const activeViewId = savedViews.find(v => JSON.stringify(v.filters) === JSON.stringify(viewSnapshot))?.id ?? null
  const [dense, setDense] = useState(() => { try { return localStorage.getItem('production_density') !== 'comfortable' } catch { return true } })
  const toggleDensity = () => setDense(d => { try { localStorage.setItem('production_density', d ? 'comfortable' : 'compact') } catch { /* bộ nhớ trình duyệt bị chặn */ } return !d })

  const actions: ActionItem[] = []
  if (canOpen) actions.push({ key: 'open', icon: Plus, label: 'Mở mẻ', tip: 'Mở mẻ chế biến mới ở kho chế biến', primary: true, variant: 'default', onClick: () => setFormOpen(true) })
  if (canSeePath('/wms/production/tanks')) actions.push({ key: 'tanks', icon: Container, label: 'Bồn', tip: 'Xem bồn và tồn bán thành phẩm trong bồn', onClick: () => navigate('/wms/production/tanks') })
  if (canExport) actions.push({ key: 'xlsx', icon: FileDown, label: 'Xuất Excel', tip: `Xuất ${rows.length} mẻ của trang đang xem ra Excel`, onClick: exportExcel, disabled: !rows.length, mobileHidden: true })

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap xl:flex-nowrap">
            <span className="hidden sm:inline text-sm font-semibold text-slate-700 shrink-0">Mẻ chế biến</span>
            <SearchInput value={f.search} onChange={v => setF({ search: v, page: 1 })} placeholder="Tìm mã lô, mã / tên bán thành phẩm…" className="flex-1 min-w-[160px]" />
            <FilterSheetButton defs={defs} className="sm:hidden" />
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <SavedViews module="production" currentFilters={viewSnapshot} activeId={activeViewId}
                onApply={v => setF({ ...(v as Partial<typeof f>), page: 1 })} />
              <button type="button" onClick={toggleDensity}
                className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
                title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
                {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
              </button>
              <ActionCluster className="shrink-0" mobileInline items={actions} />
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={defs} /></div>
        </div>
        <SummaryBand tiles={[
          { label: 'Mẻ', value: nf(total), tip: 'Số mẻ khớp bộ lọc (cả trạng thái + QA)' },
          { label: 'Đang mở', value: nf(sum?.open) },
          { label: 'Đã đóng', value: nf(sum?.closed) },
          { label: 'Chờ QA', value: nf(sum?.qa_hold), accent: Number(sum?.qa_hold ?? 0) > 0, tip: 'Lô bán thành phẩm chưa được QA thả (không tính mẻ đã huỷ)' },
          { label: 'QA thả', value: nf(sum?.qa_released) },
          { label: 'QA loại', value: nf(sum?.qa_rejected), danger: Number(sum?.qa_rejected ?? 0) > 0 },
          ...(totalPages > 1 ? [{ label: 'Trang', value: `${page}/${totalPages}` }] : []),
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <ResizableTable storageKey="production_batches_cols_v1" cols={COLS}>
            <TableBody>
              {q.isError && <TableEmptyRow colSpan={COLS.length}><span className="text-red-600">{apiMsg(q.error)}</span></TableEmptyRow>}
              {!q.isError && q.isLoading && !rows.length && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
              {!q.isError && !q.isLoading && !rows.length && <TableEmptyRow colSpan={COLS.length}>{kitchens.length ? 'Không có mẻ nào trong khoảng đang lọc.' : 'Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.'}</TableEmptyRow>}
              {rows.map(r => {
                const u = unitCode(r.base_unit)
                return (
                  <TableRow key={r.id} className={`cursor-pointer ${rowText(batchRowKey(r))} ${dense ? '' : '[&_td]:py-2.5'}`}
                    onClick={() => navigate(`/wms/production/${r.id}`)} title="Mở mẻ">
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono font-semibold`}>{r.batch_code}</TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{formatDate(r.prod_date)}</TableCell>
                    <TableCell className={`${TD} truncate`} title={r.material_name ?? ''}><span className="font-mono font-semibold">{r.material_code}</span> {r.material_name ?? ''}</TableCell>
                    <TableCell className={TD}><StatusBadge tone={BATCH_STATUS_TONE[r.status]}>{BATCH_STATUS_VI[r.status]}</StatusBadge></TableCell>
                    <TableCell className={TD}><StatusBadge tone={BATCH_QA_TONE[r.qa_status]}>{BATCH_QA_VI[r.qa_status]}</StatusBadge></TableCell>
                    <TableCell className={NUM} title={`${r.rm_lines} dòng rút · ${r.rm_materials} mã nguyên liệu`}>{r.rm_lines ? <>{r.rm_lines} <span className="text-slate-400 font-normal">dòng</span></> : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                    <TableCell className={NUM}>{Number(r.filled) ? <>{nf(r.filled)} <span className="text-slate-400 font-normal">{u}</span></> : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                    <TableCell className={NUM}>{Number(r.in_tank) ? <>{nf(r.in_tank)} <span className="text-slate-400 font-normal">{u}</span></> : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                    <TableCell className={NUM}>{r.planned_qty != null ? <>{nf(r.planned_qty)} <span className="text-slate-400 font-normal">{u}</span></> : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                    <TableCell className={`${TD} truncate`}>{r.warehouse_name}</TableCell>
                    <TableCell className={TD}>{[r.machine_code, r.shift].filter(Boolean).join(' · ') || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`${TD} truncate`}>{r.opened_by_name ?? <span className="text-slate-300">—</span>}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>
          <PagerNav page={page} totalPages={totalPages} onPage={p => setF({ page: p })} />
        </div>
        <ListFooter page={page} pageSize={pageSize} total={total} unit="mẻ" onPageSize={n => setF({ pageSize: n, page: 1 })} />
      </div>
      <BatchFormSheet open={formOpen} onClose={() => setFormOpen(false)} onSaved={id => navigate(`/wms/production/${id}`, { state: { consume: true } })} />
    </div>
  )
}
