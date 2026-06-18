import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Download, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useWarehouses, useInboundReport, useUpdatePlanLine, type InboundReportRow } from '@/api/hooks'
import { formatDate } from '@/utils/formatters'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import type { AxiosError } from 'axios'

const TH = 'text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'

export default function TMSReport() {
  const { inboundReport, setInboundReport } = useWmsFilterStore()
  const { dateFrom, dateTo, warehouseId, selCategories } = inboundReport

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: rows = [], isLoading } = useInboundReport(
    dateFrom && dateTo
      ? { date_from: dateFrom, date_to: dateTo, ...(warehouseId ? { warehouse_id: warehouseId } : {}) }
      : undefined
  )
  const { mutateAsync: updatePlanLine } = useUpdatePlanLine()

  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canEditPoPerm = isAdmin(user?.name) || can(perms, 'inbound_plan', 'edit')

  const [editingPoId, setEditingPoId] = useState<string | null>(null)
  const [editingPoValue, setEditingPoValue] = useState('')
  const [poSaving, setPoSaving] = useState(false)
  const [poError, setPoError] = useState<string | null>(null)

  async function savePo(planLineId: string) {
    setPoSaving(true)
    setPoError(null)
    try {
      await updatePlanLine({ id: planLineId, po_number: editingPoValue })
      setEditingPoId(null)
    } catch (e) {
      const err = e as AxiosError<{ error?: { message?: string } }>
      setPoError(err.response?.data?.error?.message || 'Không lưu được số PO')
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

  // ─── Filter chip bar (Manhattan) ───
  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Khoảng ngày', type: 'daterange', from: dateFrom, to: dateTo,
      onChange: (from, to) => setInboundReport({ dateFrom: from, dateTo: to }) },
    { key: 'warehouse', label: 'Kho', type: 'single', options: (warehouses as { id: string; name: string }[]).map(w => ({ value: w.id, label: w.name })), value: warehouseId, allLabel: 'Tất cả kho',
      onChange: v => setInboundReport({ warehouseId: v }) },
    { key: 'category', label: 'Loại hàng', type: 'multi', options: categoryOptions, selected: selCategories, searchable: false,
      onChange: v => setInboundReport({ selCategories: v }) },
  ]

  function exportExcel() {
    const data = filteredRows.map(r => ({
      'Ngày':             r.date,
      'Kho':              r.warehouse_name,
      'PO':               r.po_number,
      'NCC':              r.ncc_code ? `${r.ncc_code} — ${r.ncc_name}` : r.ncc_name,
      'Loại hàng':        r.material_category || '',
      'Mã hàng':          r.material_code,
      'Tên hàng':         r.material_name,
      'ĐVT':              r.unit,
      'KH (thùng)':       r.planned_boxes,
      'Thực tế (thùng)':  r.actual_boxes,
      '% TT/KH':          r.pct != null ? r.pct / 100 : null,
      'Ghi chú':          r.note || '',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    for (let R = 1; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: 10 })]
      if (cell) cell.z = '0%'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BC Nhập hàng')
    XLSX.writeFile(wb, `bao_cao_nhap_${dateFrom}_${dateTo}.xlsx`)
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Toolbar */}
      <div className="shrink-0 border-b bg-white px-3 py-2 space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Báo cáo nhập hàng</span>
          <div className="flex-1" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportExcel} disabled={filteredRows.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" />Excel
          </Button>
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
        { label: 'Dòng', value: filteredRows.length },
        { label: 'KH (thùng)', value: summary.totalPlan.toLocaleString('vi-VN') },
        { label: 'Thực (thùng)', value: summary.totalActual.toLocaleString('vi-VN') },
        { label: '% TT/KH', value: `${overallPct}%`, accent: overallPct >= 100 },
      ]} />

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow>
              <TableHead className={TH}>#</TableHead>
              <TableHead className={TH}>Ngày</TableHead>
              <TableHead className={TH}>Kho</TableHead>
              <TableHead className={TH}>PO</TableHead>
              <TableHead className={TH}>NCC</TableHead>
              <TableHead className={TH}>Loại hàng</TableHead>
              <TableHead className={TH}>Mã hàng</TableHead>
              <TableHead className={TH}>Tên hàng</TableHead>
              <TableHead className={TH}>ĐVT</TableHead>
              <TableHead className={`${TH} text-right`}>KH (thùng)</TableHead>
              <TableHead className={`${TH} text-right`}>Thực tế (thùng)</TableHead>
              <TableHead className={`${TH} text-right`}>% TT/KH</TableHead>
              <TableHead className={TH}>Ghi chú</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-xs text-slate-400 py-10">Đang tải...</TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-xs text-slate-400 py-10">
                  {dateFrom && dateTo ? 'Không có dữ liệu' : 'Chọn khoảng ngày để xem báo cáo'}
                </TableCell>
              </TableRow>
            ) : filteredRows.map((row, i) => {
              const isPhatSinh = row.note === 'Phát sinh'
              const pct = row.pct ?? 0
              const rowCls = isPhatSinh
                ? 'bg-amber-50 hover:bg-amber-100'
                : row.actual_boxes === 0 && row.planned_boxes > 0 ? 'bg-red-50 hover:bg-red-100'
                : pct >= 100                                       ? 'bg-green-50 hover:bg-green-100'
                : pct > 0                                          ? 'bg-amber-50 hover:bg-amber-100'
                :                                                    'hover:bg-slate-50'
              const pctCls =
                row.pct == null ? 'text-slate-300'
                : pct >= 100   ? 'text-green-700'
                : pct >= 50    ? 'text-amber-700'
                :                'text-red-600'
              const canEditPo = !!row.plan_line_id && canEditPoPerm
              return (
                <TableRow key={i} className={rowCls}>
                  <TableCell className={`${TD} text-slate-400 tabular-nums`}>{i + 1}</TableCell>
                  <TableCell className={`${TD} font-mono`}>{formatDate(row.date)}</TableCell>
                  <TableCell className={TD}>{row.warehouse_name}</TableCell>
                  {/* PO — click to edit inline (chỉ với plan line rows) */}
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
                        {row.po_number || <span className="text-slate-300">—</span>}
                      </button>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className={TD}>
                    {row.ncc_code
                      ? <><span className="font-mono font-semibold">{row.ncc_code}</span><span className="text-slate-400 ml-1">{row.ncc_name}</span></>
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className={TD}>
                    {row.material_category || <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className={`${TD} font-mono font-semibold`}>{row.material_code}</TableCell>
                  <TableCell className={`${TD} max-w-[180px] truncate`}>{row.material_name}</TableCell>
                  <TableCell className={`${TD} text-slate-500`}>{row.unit || '—'}</TableCell>
                  <TableCell className={`${TD} tabular-nums font-semibold text-right`}>
                    {row.planned_boxes > 0 ? row.planned_boxes.toLocaleString() : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className={`${TD} tabular-nums font-semibold text-right`}>
                    {row.actual_boxes > 0
                      ? row.actual_boxes.toLocaleString()
                      : <span className="text-slate-300">0</span>}
                  </TableCell>
                  <TableCell className={`${TD} tabular-nums font-semibold text-right ${pctCls}`}>
                    {row.pct != null ? `${pct}%` : '—'}
                  </TableCell>
                  <TableCell className={TD}>
                    {isPhatSinh
                      ? <span className="text-amber-700 font-semibold">Phát sinh</span>
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Footer đếm bản ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {filteredRows.length > 0 ? `1–${filteredRows.length} / ${filteredRows.length} dòng` : (dateFrom && dateTo ? '0 dòng' : 'Chọn khoảng ngày để xem báo cáo')}
      </div>
     </div>
    </div>
  )
}
