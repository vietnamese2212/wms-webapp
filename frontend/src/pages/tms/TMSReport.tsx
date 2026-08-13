import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeRows } from '@/utils/excelSafe'
import { Download, Check, X, Rows3, AlignJustify } from 'lucide-react'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { SavedViews } from '@/components/shared/SavedViews'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { useInboundReport, useUpdatePlanLine, type InboundReportRow } from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { formatDate } from '@/utils/formatters'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { useAuthStore } from '@/stores/authStore'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import type { AxiosError } from 'axios'

const TH = 'text-[9px] font-medium text-slate-500 py-1.5 whitespace-nowrap'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'

// Cá»™t kÃ©o giÃ£n Ä‘Æ°á»£c (Manhattan) â€” id khá»›p render bÃªn dÆ°á»›i
const COLS: { id: string; label: string; align?: 'right' }[] = [
  { id: 'idx',   label: '#' },
  { id: 'date',  label: 'NgÃ y' },
  { id: 'wh',    label: 'Kho' },
  { id: 'po',    label: 'PO' },
  { id: 'ncc',   label: 'NCC' },
  { id: 'cat',   label: 'Loáº¡i hÃ ng' },
  { id: 'mcode', label: 'MÃ£ hÃ ng' },
  { id: 'mname', label: 'TÃªn hÃ ng' },
  { id: 'unit',  label: 'ÄVT' },
  // DÃ²ng = 1 MÃƒ, sá»‘ theo ÄVT cá»§a mÃ£ Ä‘Ã³ (cá»™t ÄVT bÃªn cáº¡nh) â€” mÃ£ tÃ­nh KG/cÃ¡i KHÃ”NG pháº£i "thÃ¹ng"
  { id: 'plan',  label: 'KH',      align: 'right' },
  { id: 'act',   label: 'Thá»±c táº¿', align: 'right' },
  { id: 'pct',   label: '% TT/KH',        align: 'right' },
  { id: 'note',  label: 'Ghi chÃº' },
]
const COL_DEFAULTS = [44, 92, 120, 100, 160, 96, 104, 190, 60, 92, 104, 80, 96]

/** Tráº¡ng thÃ¡i dÃ²ng bÃ¡o cÃ¡o â†’ mÃ u chá»¯ (KHÃ”NG fill ná»n). */
function reportKey(row: InboundReportRow): RowStatusKey {
  if (row.note === 'PhÃ¡t sinh') return 'inProgress'           // cam
  const pct = row.pct ?? 0
  if (row.actual_boxes === 0 && row.planned_boxes > 0) return 'paused'  // Ä‘á» â€” chÆ°a nháº­p
  if (pct >= 100) return 'assigned'                            // xanh lÃ¡ â€” Ä‘áº¡t
  if (pct > 0) return 'inProgress'                             // cam â€” má»™t pháº§n
  return 'pending'                                             // xÃ¡m
}

export default function TMSReport() {
  const { inboundReport, setInboundReport } = useWmsFilterStore()
  const { dateFrom, dateTo, warehouseId, selCategories } = inboundReport

  const { data: warehouses = [] } = useScopedWarehouses(true)
  const { data: rows = [], isLoading } = useInboundReport(
    dateFrom && dateTo
      ? { date_from: dateFrom, date_to: dateTo, ...(warehouseId ? { warehouse_id: warehouseId } : {}) }
      : undefined
  )
  const { mutateAsync: updatePlanLine } = useUpdatePlanLine()

  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canEditPoPerm = isAdmin(user) || can(perms, 'inbound_plan', 'edit')

  const [editingPoId, setEditingPoId] = useState<string | null>(null)
  const [editingPoValue, setEditingPoValue] = useState('')
  const [poSaving, setPoSaving] = useState(false)
  const [poError, setPoError] = useState<string | null>(null)

  const [dense, setDense] = useState(() => localStorage.getItem('tms_report_density') !== 'comfortable')
  function toggleDensity() {
    setDense(d => { localStorage.setItem('tms_report_density', d ? 'comfortable' : 'compact'); return !d })
  }
  const { widths: colW, startResize, totalWidth } = useColumnResize('tms_report_col_widths', COL_DEFAULTS)

  async function savePo(planLineId: string) {
    setPoSaving(true)
    setPoError(null)
    try {
      await updatePlanLine({ id: planLineId, po_number: editingPoValue })
      setEditingPoId(null)
    } catch (e) {
      const err = e as AxiosError<{ error?: { message?: string } }>
      setPoError(err.response?.data?.error?.message || 'KhÃ´ng lÆ°u Ä‘Æ°á»£c sá»‘ PO')
    } finally {
      setPoSaving(false)
    }
  }

  const categoryOptions = useMemo(() => {
    const cats = [...new Set((rows as InboundReportRow[]).map(r => r.material_category).filter(Boolean))]
    return cats.sort().map(c => ({ value: c, label: c }))
  }, [rows])

  const filteredRows = useMemo(() => {
    if (selCategories.length === 0) return rows as InboundReportRow[]
    return (rows as InboundReportRow[]).filter(r => selCategories.includes(r.material_category))
  }, [rows, selCategories])

  const summary = useMemo(() => ({
    totalPlan:   filteredRows.filter(r => !r.note).reduce((s, r) => s + r.planned_boxes, 0),
    totalActual: filteredRows.reduce((s, r) => s + r.actual_boxes, 0),
  }), [filteredRows])

  const overallPct = summary.totalPlan > 0
    ? Math.round(summary.totalActual / summary.totalPlan * 100) : 0

  // â”€â”€â”€ Filter chip bar (Manhattan) â”€â”€â”€
  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Khoáº£ng ngÃ y', type: 'daterange', from: dateFrom, to: dateTo,
      onChange: (from, to) => setInboundReport({ dateFrom: from, dateTo: to }) },
    { key: 'warehouse', label: 'Kho', type: 'single', options: (warehouses as { id: string; name: string }[]).map(w => ({ value: w.id, label: w.name })), value: warehouseId, allLabel: 'Táº¥t cáº£ kho',
      onChange: v => setInboundReport({ warehouseId: v }) },
    { key: 'category', label: 'Loáº¡i hÃ ng', type: 'multi', options: categoryOptions, selected: selCategories, searchable: false,
      onChange: v => setInboundReport({ selCategories: v }) },
  ]

  // â”€â”€â”€ Saved views â”€â”€â”€
  const viewSnapshot = useMemo(() => ({ dateFrom, dateTo, warehouseId, selCategories }), [dateFrom, dateTo, warehouseId, selCategories])
  const savedViews = useSavedViewsStore(s => s.views['tms_report'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  function exportExcel() {
    const data = filteredRows.map(r => ({
      'NgÃ y':             r.date,
      'Kho':              r.warehouse_name,
      'PO':               r.po_number,
      'NCC':              r.ncc_code ? `${r.ncc_code} â€” ${r.ncc_name}` : r.ncc_name,
      'Loáº¡i hÃ ng':        r.material_category || '',
      'MÃ£ hÃ ng':          r.material_code,
      'TÃªn hÃ ng':         r.material_name,
      'ÄVT':              r.unit,
      'KH (theo ÄVT)':      r.planned_boxes,
      'Thá»±c táº¿ (theo ÄVT)': r.actual_boxes,
      '% TT/KH':          r.pct != null ? r.pct / 100 : null,
      'Ghi chÃº':          r.note || '',
    }))
    const ws = XLSX.utils.json_to_sheet(sanitizeRows(data))
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    for (let R = 1; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: 10 })]
      if (cell) cell.z = '0%'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BC Nháº­p hÃ ng')
    saveWorkbook(wb, `bao_cao_nhap_${dateFrom}_${dateTo}.xlsx`)
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Toolbar */}
      <div className="shrink-0 border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">BÃ¡o cÃ¡o nháº­p hÃ ng</span>
          <div className="flex-1" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          {/* Mobile: SavedViews + action GOM 1 hÃ ng (PDA); desktop sm:contents â†’ nhÆ° cÅ© */}
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
          <SavedViews
            module="tms_report"
            currentFilters={viewSnapshot}
            activeId={activeViewId}
            onApply={(filters) => setInboundReport(filters as Partial<typeof inboundReport>)}
          />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Äang: dÃ y Â· báº¥m Ä‘á»ƒ thoÃ¡ng' : 'Äang: thoÃ¡ng Â· báº¥m Ä‘á»ƒ dÃ y'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          <ActionCluster className="shrink-0" mobileInline items={[
            // Xuáº¥t file = mang dá»¯ liá»‡u ra ngoÃ i â†’ quyá»n RIÃŠNG tms_plan.export
            ...(can(perms, 'tms_plan', 'export') ? [{
              key: 'export-excel', icon: Download, label: 'Excel', tip: 'Xuáº¥t bÃ¡o cÃ¡o Ä‘ang lá»c ra file Excel',
              primary: true, disabled: filteredRows.length === 0,
              mobileHidden: true, // export Excel khÃ´ng dÃ¹ng trÃªn Ä‘iá»‡n thoáº¡i
              onClick: exportExcel,
            } satisfies ActionItem] : []),
          ]} />
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
        </div>
        {poError && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700">
            {poError}
          </div>
        )}
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={[
        { label: 'DÃ²ng', value: filteredRows.length },
        // Ã” Tá»”NG gá»™p má»i mÃ£ (thÃ¹ng + KG/cÃ¡i) â†’ nhÃ£n quy Ä‘á»•i (luáº­t 1b CLAUDE.md)
        { label: 'KH (quy Ä‘á»•i)', value: summary.totalPlan.toLocaleString('vi-VN') },
        { label: 'Thá»±c (quy Ä‘á»•i)', value: summary.totalActual.toLocaleString('vi-VN') },
        { label: '% TT/KH', value: `${overallPct}%`, accent: overallPct >= 100 },
      ]} />

      {/* Table â€” cá»™t kÃ©o giÃ£n Ä‘Æ°á»£c (colgroup + table-fixed), scroll ngang á»Ÿ Ä‘Ã¡y */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>
            {colW.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <TableHeader>
            <TableRow>
              {COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`${TH} ${i === 0 ? 'px-0 text-center sticky left-0 z-20 bg-slate-50' : 'px-2'} ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.label}
                  {i > 0 && (
                    <span
                      onPointerDown={e => startResize(i, e)}
                      onClick={e => e.stopPropagation()}
                      className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70"
                      title="KÃ©o Ä‘á»ƒ chá»‰nh Ä‘á»™ rá»™ng cá»™t"
                    />
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className={dense ? '' : '[&_td]:!py-2.5'}>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={COLS.length} className="text-center text-xs text-slate-400 py-10">Äang táº£i...</TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLS.length} className="text-center text-xs text-slate-400 py-10">
                  {dateFrom && dateTo ? 'KhÃ´ng cÃ³ dá»¯ liá»‡u' : 'Chá»n khoáº£ng ngÃ y Ä‘á»ƒ xem bÃ¡o cÃ¡o'}
                </TableCell>
              </TableRow>
            ) : filteredRows.map((row, i) => {
              const canEditPo = !!row.plan_line_id && canEditPoPerm
              return (
                <TableRow key={i} className={rowText(reportKey(row))}>
                  <TableCell className={`${TD} px-0 text-center text-slate-400 tabular-nums sticky left-0 z-10 bg-white`}>{i + 1}</TableCell>
                  <TableCell className={`${TD} font-mono`}>{formatDate(row.date)}</TableCell>
                  <TableCell className={`${TD} truncate`}>{row.warehouse_name}</TableCell>
                  {/* PO â€” click to edit inline (chá»‰ vá»›i plan line rows) */}
                  <TableCell className={`${TD} font-mono`}>
                    {editingPoId === row.plan_line_id && canEditPo ? (
                      <div className="flex items-center gap-0.5">
                        <input
                          autoFocus
                          className="border border-blue-300 rounded px-1 text-[10px] font-mono w-24 h-5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          value={editingPoValue}
                          onChange={e => setEditingPoValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') savePo(row.plan_line_id!)
                            if (e.key === 'Escape') setEditingPoId(null)
                          }}
                        />
                        <button disabled={poSaving} onClick={() => savePo(row.plan_line_id!)} className="text-green-600 hover:text-green-700">
                          <Check className="h-3 w-3" />
                        </button>
                        <button onClick={() => setEditingPoId(null)} className="text-slate-400 hover:text-slate-600">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : canEditPo ? (
                      <button
                        className="text-left hover:text-blue-600 underline-offset-2 hover:underline"
                        onClick={() => { setEditingPoId(row.plan_line_id!); setEditingPoValue(row.po_number || '') }}
                      >
                        {row.po_number || <span className="text-slate-300">â€”</span>}
                      </button>
                    ) : (
                      <span className="text-slate-300">{row.po_number || 'â€”'}</span>
                    )}
                  </TableCell>
                  <TableCell className={`${TD} truncate`} title={row.ncc_code ? `${row.ncc_code} ${row.ncc_name}` : row.ncc_name || ''}>
                    {row.ncc_code
                      ? <><span className="font-mono font-semibold">{row.ncc_code}</span><span className="text-slate-400 ml-1">{row.ncc_name}</span></>
                      : <span className="text-slate-300">â€”</span>}
                  </TableCell>
                  <TableCell className={TD}>
                    {row.material_category || <span className="text-slate-300">â€”</span>}
                  </TableCell>
                  <TableCell className={`${TD} font-mono font-semibold`}>{row.material_code}</TableCell>
                  <TableCell className={`${TD} truncate`} title={row.material_name}>{row.material_name}</TableCell>
                  <TableCell className={`${TD} text-slate-400`}>{row.unit || 'â€”'}</TableCell>
                  <TableCell className={`${TD} tabular-nums font-semibold text-right`}>
                    {row.planned_boxes > 0 ? row.planned_boxes.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : <span className="text-slate-300">â€”</span>}
                  </TableCell>
                  <TableCell className={`${TD} tabular-nums font-semibold text-right`}>
                    {row.actual_boxes > 0 ? row.actual_boxes.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : <span className="text-slate-300">0</span>}
                  </TableCell>
                  <TableCell className={`${TD} tabular-nums font-semibold text-right`}>
                    {row.pct != null ? `${row.pct}%` : <span className="text-slate-300">â€”</span>}
                  </TableCell>
                  <TableCell className={TD}>
                    {row.note === 'PhÃ¡t sinh'
                      ? <span className="font-semibold">PhÃ¡t sinh</span>
                      : <span className="text-slate-300">â€”</span>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Footer Ä‘áº¿m báº£n ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {filteredRows.length > 0 ? `1â€“${filteredRows.length} / ${filteredRows.length} dÃ²ng` : (dateFrom && dateTo ? '0 dÃ²ng' : 'Chá»n khoáº£ng ngÃ y Ä‘á»ƒ xem bÃ¡o cÃ¡o')}
      </div>
     </div>
    </div>
  )
}
