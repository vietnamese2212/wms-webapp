// TRANG "MẺ CHẾ BIẾN" (MES giai đoạn 1, 14/11/2026 — docs/modules/production.md). Mỗi dòng một MẺ (lô bán thành phẩm):
// ngày SX · mã lô · mã BTP · kho chế biến · máy/ca · TÌNH TRẠNG (18/11 — theo bước, màu theo bước) · số dòng NVL đã rút · đã nạp bồn · còn trong bồn.
// Phân trang SERVER: dòng + tổng + ô band trong MỘT lời gọi (RPC mes_batch_page). Lọc theo kho nhà máy ⇒ gồm kho chế biến trực thuộc.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { Plus, FileDown, AlignJustify, Rows3, Container, Bookmark } from 'lucide-react'
import { useActiveBatchesStore } from '@/stores/activeBatchesStore'
import { SavedViews } from '@/components/shared/SavedViews'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter, PagerNav } from '@/components/shared/ListPager'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { BatchFormSheet } from '@/components/wms/production/BatchFormSheet'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useProductionBatches, useProductionWarehouses, type BatchRow } from '@/api/productionHooks'
import { StageBadge, BATCH_STAGE, BATCH_STAGES, stageOf, stageRowText } from '@/components/wms/production/BatchStage'
import { unitCode } from '@/utils/unitCode'
import { formatDate } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeRows } from '@/utils/excelSafe'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const nf = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const COLS: RtColDef[] = [
  { id: 'code', label: 'Mã lô', w: 150 }, { id: 'cyc', label: 'Chu kỳ · Mẻ', w: 86 }, { id: 'tank', label: 'Bồn', w: 70 }, { id: 'day', label: 'Ngày SX', w: 88 }, { id: 'mat', label: 'Bán thành phẩm', w: 200 },
  { id: 'stage', label: 'Tình trạng', w: 96 },
  { id: 'rm', label: 'NVL đã rút', w: 88, align: 'right' }, { id: 'filled', label: 'Đã nạp bồn', w: 96, align: 'right' },
  { id: 'intank', label: 'Còn trong bồn', w: 100, align: 'right' }, { id: 'plan', label: 'Kế hoạch', w: 86, align: 'right' },
  { id: 'wh', label: 'Kho chế biến', w: 150 }, { id: 'machine', label: 'Máy · Ca', w: 100 }, { id: 'by', label: 'Người mở', w: 130 },
]

export default function ProductionBatches() {
  const navigate = useNavigate()
  const { pin: pinBatch, unpin: unpinBatch, isPinned: isBatchPinned } = useActiveBatchesStore()
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
    warehouse_id: f.warehouseId || undefined, stage: f.stage || undefined,
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
    { key: 'stage', label: 'Tình trạng', type: 'single', options: BATCH_STAGES.map(s => ({ value: s, label: BATCH_STAGE[s].label })), value: f.stage, onChange: v => setF({ stage: v, page: 1 }) },
  ]

  function exportExcel() {
    const sheet = rows.map((r: BatchRow) => ({
      'Mã lô': r.batch_code, 'Ngày SX': r.prod_date, 'Mã BTP': r.material_code, 'Tên BTP': r.material_name ?? '', 'Đơn vị': unitCode(r.base_unit),
      'Tình trạng': BATCH_STAGE[stageOf(r.stage)].label, 'Dòng NVL đã rút': r.rm_lines, 'Số mã NVL': r.rm_materials,
      'Đã nạp bồn': Number(r.filled), 'Còn trong bồn': Number(r.in_tank), 'Kế hoạch': r.planned_qty ?? '', 'Kho chế biến': r.warehouse_name,
      'Máy': r.machine_code ?? '', 'Ca': r.shift ?? '', 'Người mở': r.opened_by_name ?? '', 'Ghi chú': r.note ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sanitizeRows(sheet)), 'Mẻ chế biến')
    void saveWorkbook(wb, `me_che_bien_${f.dateFrom || 'all'}_${f.dateTo || ''}_trang${page}.xlsx`)
  }

  const viewSnapshot = { search: f.search, warehouseId: f.warehouseId, dateFrom: f.dateFrom, dateTo: f.dateTo, stage: f.stage }
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
          // số mẻ theo TÌNH TRẠNG (18/11) — cùng hàm DB với cột Tình trạng; "Mẻ" theo cả lọc tình trạng
          { label: 'Mẻ', value: nf(total), tip: 'Số mẻ khớp bộ lọc (cả lọc tình trạng)' },
          ...(Number(sum?.new ?? 0) > 0 ? [{ label: 'Mới mở', value: nf(sum?.new), tip: BATCH_STAGE.new.tip }] : []),
          { label: 'Chờ duyệt', value: nf(sum?.wait_lead), tip: BATCH_STAGE.wait_lead.tip },
          { label: 'Chờ QA duyệt', value: nf(sum?.wait_qa), accent: Number(sum?.wait_qa ?? 0) > 0, tip: BATCH_STAGE.wait_qa.tip },
          { label: 'Đang làm', value: nf(sum?.working), tip: BATCH_STAGE.working.tip },
          { label: 'Chờ QA bồn', value: nf(sum?.filled), tip: BATCH_STAGE.filled.tip },
          { label: 'QA đạt', value: nf(sum?.released) },
          { label: 'QA loại', value: nf(sum?.rejected), danger: Number(sum?.rejected ?? 0) > 0, tip: BATCH_STAGE.rejected.tip },
          ...(totalPages > 1 ? [{ label: 'Trang', value: `${page}/${totalPages}` }] : []),
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <ResizableTable storageKey="production_batches_cols_v3" cols={COLS}>
            <TableBody>
              {q.isError && <TableEmptyRow colSpan={COLS.length}><span className="text-red-600">{apiMsg(q.error)}</span></TableEmptyRow>}
              {!q.isError && q.isLoading && !rows.length && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
              {!q.isError && !q.isLoading && !rows.length && <TableEmptyRow colSpan={COLS.length}>{kitchens.length ? 'Không có mẻ nào trong khoảng đang lọc.' : 'Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.'}</TableEmptyRow>}
              {rows.map(r => {
                const u = unitCode(r.base_unit)
                const pinned = isBatchPinned(r.id)
                return (
                  <TableRow key={r.id} data-stage={stageOf(r.stage)} className={`cursor-pointer ${stageRowText(r.stage)} ${dense ? '' : '[&_td]:py-2.5'}`}
                    onClick={() => navigate(`/wms/production/${r.id}`)} title="Mở mẻ">
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono font-semibold`}>
                      {/* 🔖 = đánh dấu ĐANG LÀM ⇒ tab "Đang làm:" trên trang mẻ (như danh sách Xuất kho) */}
                      <button type="button" onClick={e => { e.stopPropagation(); if (pinned) unpinBatch(r.id); else pinBatch({ id: r.id, code: r.batch_code, stage: r.stage }) }}
                        className={`p-1 -my-1 -ml-1 mr-0.5 rounded align-middle transition-colors ${pinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
                        title={pinned ? 'Bỏ đánh dấu đang làm' : 'Đánh dấu đang làm'} aria-label={`${pinned ? 'Bỏ đánh dấu' : 'Đánh dấu'} đang làm ${r.batch_code}`} aria-pressed={pinned}>
                        <Bookmark className="h-3 w-3" fill={pinned ? 'currentColor' : 'none'} />
                      </button>
                      {r.batch_code}
                    </TableCell>
                    <TableCell className={`${TD} font-mono`}>{r.cycle || r.batch_no ? `${r.cycle ?? '—'} · ${r.batch_no ? String(r.batch_no).padStart(4, '0') : '—'}` : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`${TD} font-mono font-semibold`}>{r.tank_code ?? <span className="text-slate-300 font-normal">—</span>}</TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{formatDate(r.prod_date)}</TableCell>
                    <TableCell className={`${TD} truncate`} title={r.material_name ?? ''}><span className="font-mono font-semibold">{r.material_code}</span> {r.material_name ?? ''}</TableCell>
                    <TableCell className={TD}><StageBadge stage={r.stage} /></TableCell>
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
      {/* mở mẻ xong vào trang mẻ, KHÔNG tự bật quét (user 18/11: "mở mẻ xong đừng tự động vào scan") — bước kế thường là duyệt phiếu */}
      <BatchFormSheet open={formOpen} onClose={() => setFormOpen(false)} onSaved={id => navigate(`/wms/production/${id}`)} />
    </div>
  )
}
