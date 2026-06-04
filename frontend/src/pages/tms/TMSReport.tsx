import React, { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWarehouses, useInboundReport, type InboundReportRow } from '@/api/hooks'
import { formatDate } from '@/utils/formatters'

export default function TMSReport() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const defaultFrom = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  }, [])

  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo]     = useState(today)
  const [warehouseId, setWarehouseId] = useState('')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: rows = [], isLoading } = useInboundReport(
    dateFrom && dateTo
      ? { date_from: dateFrom, date_to: dateTo, ...(warehouseId ? { warehouse_id: warehouseId } : {}) }
      : undefined
  )

  const summary = useMemo(() => ({
    totalPlan:   rows.reduce((s, r) => s + r.planned_boxes, 0),
    totalActual: rows.reduce((s, r) => s + r.actual_boxes, 0),
  }), [rows])

  const overallPct = summary.totalPlan > 0
    ? Math.round(summary.totalActual / summary.totalPlan * 100) : 0

  function exportExcel() {
    const data = rows.map(r => ({
      'Ngày':             r.date,
      'Kho':              r.warehouse_name,
      'PO':               r.po_number,
      'NCC':              r.ncc_code ? `${r.ncc_code} — ${r.ncc_name}` : r.ncc_name,
      'Mã hàng':          r.material_code,
      'Tên hàng':         r.material_name,
      'ĐVT':              r.unit,
      'KH (thùng)':       r.planned_boxes,
      'Thực tế (thùng)':  r.actual_boxes,
      '% TT/KH':          r.pct != null ? r.pct / 100 : null,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    // Format cột % thành percent
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    for (let R = 1; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: 9 })]
      if (cell) cell.z = '0%'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BC Nhập hàng')
    XLSX.writeFile(wb, `bao_cao_nhap_${dateFrom}_${dateTo}.xlsx`)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="shrink-0 border-b bg-white px-4 py-2 flex items-center gap-3 flex-wrap">
        <h1 className="text-sm font-semibold text-slate-700 shrink-0">Báo cáo nhập hàng</h1>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-slate-500 shrink-0">Từ</Label>
          <Input
            type="date" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="h-7 text-xs w-32"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-slate-500 shrink-0">Đến</Label>
          <Input
            type="date" value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="h-7 text-xs w-32"
          />
        </div>
        <Select value={warehouseId || '__all__'} onValueChange={v => setWarehouseId(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Tất cả kho" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tất cả kho</SelectItem>
            {(warehouses as { id: string; name: string }[]).map(w => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-3">
          {rows.length > 0 && (
            <span className="text-[10px] text-slate-500">
              {rows.length} dòng
              &nbsp;·&nbsp;KH: <span className="font-semibold tabular-nums">{summary.totalPlan.toLocaleString()}</span> thùng
              &nbsp;·&nbsp;Thực: <span className="font-semibold tabular-nums">{summary.totalActual.toLocaleString()}</span> thùng
              &nbsp;·&nbsp;
              <span className={overallPct >= 100 ? 'text-green-600 font-semibold' : overallPct >= 50 ? 'text-amber-600 font-semibold' : 'text-red-600 font-semibold'}>
                {overallPct}%
              </span>
            </span>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportExcel} disabled={rows.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" />Excel
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <div className="overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                {['#','Ngày','Kho','PO','NCC','Mã hàng','Tên hàng','ĐVT','KH (thùng)','Thực tế (thùng)','% TT/KH'].map(h => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-xs text-slate-400 py-10">Đang tải...</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-xs text-slate-400 py-10">
                    {dateFrom && dateTo ? 'Không có dữ liệu' : 'Chọn khoảng ngày để xem báo cáo'}
                  </TableCell>
                </TableRow>
              ) : (rows as InboundReportRow[]).map((row, i) => {
                const pct = row.pct ?? 0
                const rowCls =
                  row.actual_boxes === 0 && row.planned_boxes > 0 ? 'bg-red-50 hover:bg-red-100'
                  : pct >= 100                                     ? 'bg-green-50 hover:bg-green-100'
                  : pct > 0                                        ? 'bg-amber-50 hover:bg-amber-100'
                  :                                                  'hover:bg-slate-50'
                const pctCls =
                  row.pct == null ? 'text-slate-300'
                  : pct >= 100   ? 'text-green-700'
                  : pct >= 50    ? 'text-amber-700'
                  :                'text-red-600'
                return (
                  <TableRow key={i} className={rowCls}>
                    <TableCell className="text-[10px] text-slate-400 tabular-nums">{i + 1}</TableCell>
                    <TableCell className="text-[10px] font-mono whitespace-nowrap">{formatDate(row.date)}</TableCell>
                    <TableCell className="text-[10px] whitespace-nowrap">{row.warehouse_name}</TableCell>
                    <TableCell className="text-[10px] font-mono">{row.po_number || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="text-[10px] whitespace-nowrap">
                      {row.ncc_code
                        ? <><span className="font-mono font-semibold">{row.ncc_code}</span><span className="text-slate-400 ml-1">{row.ncc_name}</span></>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="text-[10px] font-mono font-semibold whitespace-nowrap">{row.material_code}</TableCell>
                    <TableCell className="text-[10px] max-w-[180px] truncate">{row.material_name}</TableCell>
                    <TableCell className="text-[10px] text-slate-500">{row.unit || '—'}</TableCell>
                    <TableCell className="text-[10px] tabular-nums font-semibold text-right">{row.planned_boxes.toLocaleString()}</TableCell>
                    <TableCell className="text-[10px] tabular-nums font-semibold text-right">
                      {row.actual_boxes > 0
                        ? row.actual_boxes.toLocaleString()
                        : <span className="text-slate-300">0</span>}
                    </TableCell>
                    <TableCell className={`text-[10px] tabular-nums font-semibold text-right ${pctCls}`}>
                      {row.pct != null ? `${pct}%` : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
