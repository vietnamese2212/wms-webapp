import { useState, useRef, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Plus, Upload, Trash2, FileSpreadsheet, X } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import {
  useWarehouses, useWarehouseTypes, useVehicleTypes, useTransportCompanies,
  useMaterials, useInboundPlanLines, useBulkCreatePlanLines, useDeletePlanLine,
} from '@/api/hooks'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AxiosError } from 'axios'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// ─── Form thêm dòng ─────────────────────────────────────────────────────────

type MatRow = {
  material_code:   string
  material_id:     string
  mat_name:        string
  mat_unit:        string
  planned_boxes:   string
  planned_pallets: string
}
const emptyRow = (): MatRow => ({
  material_code: '', material_id: '', mat_name: '', mat_unit: '',
  planned_boxes: '', planned_pallets: '',
})

function AddLineDialog({ open, date, warehouseId, onClose }: {
  open: boolean; date: string; warehouseId: string; onClose: () => void
}) {
  const { data: warehouses = [] }          = useWarehouses(true)
  const { data: whTypesData = [] }         = useWarehouseTypes()
  const { data: vehicleTypes = [] }        = useVehicleTypes(true)
  const { data: transportCompanies = [] }  = useTransportCompanies(true)
  const { data: materials = [] }           = useMaterials()

  const bulkCreate = useBulkCreatePlanLines()

  const [warehouse,     setWarehouse]     = useState(warehouseId)
  const [warehouseType, setWarehouseType] = useState('')
  const [vehicleType,   setVehicleType]   = useState('')
  const [nccId,         setNccId]         = useState('')
  const [poNumber,      setPoNumber]      = useState('')
  const [rows,          setRows]          = useState<MatRow[]>([emptyRow()])
  const [err,           setErr]           = useState('')

  useEffect(() => {
    if (open) {
      setWarehouse(warehouseId)
      setWarehouseType('')
      setVehicleType('')
      setNccId('')
      setPoNumber('')
      setRows([emptyRow()])
      setErr('')
    }
  }, [open, warehouseId])

  const matByCode = useMemo(() =>
    new Map((materials as any[]).map(m => [String(m.material_code).trim().toUpperCase(), m])),
    [materials]
  )

  function handleMatCodeChange(idx: number, code: string) {
    const found = matByCode.get(code.trim().toUpperCase())
    setRows(prev => prev.map((r, i) => i !== idx ? r : {
      ...r,
      material_code: code,
      material_id:   found?.id        ?? '',
      mat_name:      found?.short_name ?? '',
      mat_unit:      found?.unit       ?? '',
    }))
  }

  function setRowField(idx: number, field: 'planned_boxes' | 'planned_pallets', val: string) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: val }))
  }

  function addRow() { setRows(prev => [...prev, emptyRow()]) }

  function removeRow(idx: number) {
    setRows(prev => prev.length === 1 ? [emptyRow()] : prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!warehouse)    { setErr('Vui lòng chọn Kho'); return }
    if (!nccId)        { setErr('Vui lòng chọn ĐVVT / NCC'); return }
    const validRows = rows.filter(r => r.material_id)
    if (!validRows.length) { setErr('Vui lòng nhập ít nhất 1 mã hàng hợp lệ'); return }
    try {
      await bulkCreate.mutateAsync(validRows.map(r => ({
        date, warehouse_id: warehouse,
        warehouse_type:  warehouseType || undefined,
        vehicle_type:    vehicleType   || undefined,
        ncc_id:          nccId         || undefined,
        material_id:     r.material_id,
        po_number:       poNumber      || undefined,
        planned_boxes:   r.planned_boxes   ? Number(r.planned_boxes)   : undefined,
        planned_pallets: r.planned_pallets ? Number(r.planned_pallets) : undefined,
      })))
      onClose()
    } catch (e) {
      const msg = (e as AxiosError<{error:{message:string}}>)?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi lưu dữ liệu')
    }
  }

  const validCount = rows.filter(r => r.material_id).length

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Thêm dòng kế hoạch</DialogTitle></DialogHeader>

        {/* Section 1: Thông tin chung */}
        <div className="border rounded-lg bg-slate-50 px-3 py-2.5 space-y-2">
          <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Thông tin chung</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Kho *</Label>
              <Select value={warehouse || '__none__'} onValueChange={v => setWarehouse(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                <SelectContent>
                  {(warehouses as any[]).map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.code} – {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Loại kho</Label>
              <Select value={warehouseType || '__none__'} onValueChange={v => setWarehouseType(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Chọn loại kho" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không chọn —</SelectItem>
                  {whTypesData.map(t => <SelectItem key={t.id} value={t.value}>{t.value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Loại xe</Label>
              <Select value={vehicleType || '__none__'} onValueChange={v => setVehicleType(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Chọn loại xe" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Không chọn —</SelectItem>
                  {(vehicleTypes as any[]).map(vt => (
                    <SelectItem key={vt.id} value={vt.name}>{vt.code} — {vt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">ĐVVT / NCC *</Label>
              <Select value={nccId || '__none__'} onValueChange={v => setNccId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Chọn ĐVVT / NCC" /></SelectTrigger>
                <SelectContent>
                  {(transportCompanies as any[]).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Số PO</Label>
              <Input
                value={poNumber}
                onChange={e => setPoNumber(e.target.value)}
                placeholder="PO-0001"
                className="h-8 text-xs mt-0.5"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Bảng mã hàng */}
        <div className="space-y-1.5">
          <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Danh sách hàng hóa</p>
          <div className="border rounded-lg overflow-hidden">
            <table className="min-w-full text-[10px]">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 w-32">Mã hàng</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500">Tên hàng</th>
                  <th className="px-2 py-1.5 text-center text-[9px] font-medium text-slate-500 w-14">ĐVT</th>
                  <th className="px-2 py-1.5 text-right text-[9px] font-medium text-slate-500 w-20">Số thùng</th>
                  <th className="px-2 py-1.5 text-right text-[9px] font-medium text-slate-500 w-20">Pallet</th>
                  <th className="w-7"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, idx) => {
                  const invalid = row.material_code !== '' && !row.material_id
                  return (
                    <tr key={idx} className={invalid ? 'bg-red-50' : ''}>
                      <td className="px-1.5 py-1">
                        <input
                          type="text"
                          value={row.material_code}
                          onChange={e => handleMatCodeChange(idx, e.target.value)}
                          placeholder="Paste mã hàng"
                          className={`w-full h-7 px-1.5 text-[10px] font-mono border rounded focus:outline-none focus:ring-1 ${
                            invalid
                              ? 'border-red-300 bg-red-50 focus:ring-red-400'
                              : 'border-slate-200 bg-white focus:ring-blue-400'
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        {row.mat_name
                          ? <span className="text-[10px] text-slate-700">{row.mat_name}</span>
                          : invalid
                            ? <span className="text-[9px] text-red-400">Không tìm thấy mã</span>
                            : <span className="text-[9px] text-slate-300">—</span>
                        }
                      </td>
                      <td className="px-2 py-1 text-center text-slate-500">{row.mat_unit || '—'}</td>
                      <td className="px-1.5 py-1">
                        <input
                          type="number" min="0"
                          value={row.planned_boxes}
                          onChange={e => setRowField(idx, 'planned_boxes', e.target.value)}
                          className="w-full h-7 px-1.5 text-[10px] border border-slate-200 rounded text-right bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          type="number" min="0"
                          value={row.planned_pallets}
                          onChange={e => setRowField(idx, 'planned_pallets', e.target.value)}
                          className="w-full h-7 px-1.5 text-[10px] border border-slate-200 rounded text-right bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
          >
            <Plus className="h-3 w-3" /> Thêm dòng hàng
          </button>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={handleSave} disabled={bulkCreate.isPending || validCount === 0}>
            {bulkCreate.isPending ? 'Đang lưu...' : validCount > 0 ? `Lưu ${validCount} dòng` : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Upload Excel Dialog ──────────────────────────────────────────────────────

type PreviewRow = {
  ncc_code: string; ncc_id: string
  warehouse_type: string; vehicle_type: string
  material_code: string; material_id: string
  po_number: string; planned_boxes: number | null; planned_pallets: number | null
  _valid: boolean; _error: string
}

function UploadDialog({ open, date, warehouseId, onClose }: {
  open: boolean; date: string; warehouseId: string; onClose: () => void
}) {
  const { data: transportCompanies = [] } = useTransportCompanies(true)
  const { data: materials = [] }          = useMaterials()
  const bulkCreate = useBulkCreatePlanLines()

  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const nccByCode = new Map((transportCompanies as any[]).map((c: any) => [String(c.code).trim().toUpperCase(), c.id]))
  const matByCode = new Map((materials as any[]).map((m: any) => [String(m.material_code).trim(), m.id]))

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

        const parsed: PreviewRow[] = rows.map((row, i) => {
          const nccCode     = String(row['Mã NCC'] ?? row['NCC'] ?? row['ncc_code'] ?? '').trim().toUpperCase()
          const whType      = String(row['Loại kho'] ?? row['warehouse_type'] ?? '').trim()
          const vt          = String(row['Loại xe'] ?? row['vehicle_type'] ?? '').trim()
          const matCode     = String(row['Mã hàng'] ?? row['material_code'] ?? '').trim()
          const po          = String(row['Số PO'] ?? row['PO'] ?? row['po_number'] ?? '').trim()
          const boxes       = row['Số thùng'] ?? row['planned_boxes'] ?? null
          const pallets     = row['Số pallet'] ?? row['planned_pallets'] ?? null

          const nccId  = nccByCode.get(nccCode)  ?? ''
          const matId  = matByCode.get(matCode)  ?? ''

          let error = ''
          if (!nccCode)  error = `Dòng ${i + 2}: thiếu Mã NCC`
          else if (!nccId)  error = `Dòng ${i + 2}: không tìm thấy NCC "${nccCode}"`
          else if (!matCode) error = `Dòng ${i + 2}: thiếu Mã hàng`
          else if (!matId)   error = `Dòng ${i + 2}: không tìm thấy mã hàng "${matCode}"`

          return {
            ncc_code: nccCode, ncc_id: nccId,
            warehouse_type: whType, vehicle_type: vt,
            material_code: matCode, material_id: matId,
            po_number: po,
            planned_boxes:   boxes   != null && boxes   !== '' ? Number(boxes)   : null,
            planned_pallets: pallets != null && pallets !== '' ? Number(pallets) : null,
            _valid: !error, _error: error,
          }
        }).filter(r => r.ncc_code || r.material_code)

        setPreview(parsed)
        setErr('')
      } catch {
        setErr('Không đọc được file Excel')
      }
    }
    reader.readAsBinaryString(file)
  }

  async function handleConfirm() {
    if (!preview) return
    const valid = preview.filter(r => r._valid)
    if (!valid.length) { setErr('Không có dòng hợp lệ nào'); return }
    try {
      const lines = valid.map(r => ({
        date, warehouse_id: warehouseId,
        warehouse_type:  r.warehouse_type  || null,
        vehicle_type:    r.vehicle_type    || null,
        ncc_id:          r.ncc_id          || null,
        material_id:     r.material_id     || null,
        po_number:       r.po_number       || null,
        planned_boxes:   r.planned_boxes,
        planned_pallets: r.planned_pallets,
      }))
      await bulkCreate.mutateAsync(lines)
      setPreview(null); setFileName(''); onClose()
    } catch (e) {
      const msg = (e as AxiosError<{error:{message:string}}>)?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi upload')
    }
  }

  function downloadTemplate() {
    const data = [
      { 'Mã NCC': 'FAST', 'Loại kho': 'TP', 'Loại xe': 'PALLET', 'Mã hàng': '510000127', 'Số PO': 'PO-0001', 'Số thùng': 500, 'Số pallet': 10 },
    ]
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'KH Nhập ngoài')
    XLSX.writeFile(wb, 'template_ke_hoach_nhap.xlsx')
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setPreview(null); setFileName(''); setErr(''); onClose() } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Upload kế hoạch Excel
          </DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-3 py-2">
            <p className="text-xs text-slate-500">
              File Excel phải có các cột: <strong>Mã NCC</strong>, <strong>Mã hàng</strong>, Loại kho, Loại xe, Số PO, Số thùng, Số pallet.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> Tải template
              </Button>
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Chọn file
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) { setFileName(f.name); parseFile(f) }
                }}
              />
            </div>
            {fileName && <p className="text-xs text-slate-500">File: {fileName}</p>}
            {err && <p className="text-xs text-red-500">{err}</p>}
          </div>
        ) : (
          <div className="space-y-2 py-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {preview.filter(r => r._valid).length}/{preview.length} dòng hợp lệ
              </p>
              <Button variant="ghost" size="sm" onClick={() => { setPreview(null); setFileName('') }}>
                <X className="h-3.5 w-3.5 mr-1" /> Chọn lại
              </Button>
            </div>
            <div className="max-h-64 overflow-auto border rounded-md">
              <table className="min-w-full text-[10px]">
                <thead className="sticky top-0 bg-slate-50 border-b">
                  <tr>
                    {['NCC', 'Loại kho', 'Loại xe', 'Mã hàng', 'PO', 'Thùng', 'Pallet', 'Trạng thái'].map(h => (
                      <th key={h} className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className={r._valid ? 'hover:bg-slate-50' : 'bg-red-50'}>
                      <td className="px-2 py-1 font-mono">{r.ncc_code || '—'}</td>
                      <td className="px-2 py-1">{r.warehouse_type || '—'}</td>
                      <td className="px-2 py-1">{r.vehicle_type || '—'}</td>
                      <td className="px-2 py-1 font-mono">{r.material_code || '—'}</td>
                      <td className="px-2 py-1">{r.po_number || '—'}</td>
                      <td className="px-2 py-1 tabular-nums text-right">{r.planned_boxes ?? '—'}</td>
                      <td className="px-2 py-1 tabular-nums text-right">{r.planned_pallets ?? '—'}</td>
                      <td className="px-2 py-1">
                        {r._valid
                          ? <span className="text-green-600">✓</span>
                          : <span className="text-red-500 text-[9px]">{r._error}</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {err && <p className="text-xs text-red-500">{err}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { setPreview(null); setFileName(''); setErr(''); onClose() }}>Hủy</Button>
          {preview && (
            <Button size="sm" onClick={handleConfirm} disabled={bulkCreate.isPending || preview.filter(r => r._valid).length === 0}>
              {bulkCreate.isPending ? 'Đang lưu...' : `Lưu ${preview.filter(r => r._valid).length} dòng`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InboundPlan() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null

  const [date,        setDate]        = useState(TODAY)
  const [warehouseId, setWarehouseId] = useState(user?.warehouse_id ?? (user?.warehouse_ids as string[] | undefined)?.[0] ?? '')
  const [addOpen,     setAddOpen]     = useState(false)
  const [uploadOpen,  setUploadOpen]  = useState(false)

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: lines = [], isLoading } = useInboundPlanLines(
    date && warehouseId ? { date, warehouse_id: warehouseId } : undefined
  )
  const deleteLine = useDeletePlanLine()

  // Group by tms_order_id để hiển thị header nhóm
  const groups = new Map<string, { order: any; lines: any[] }>()
  for (const line of lines as any[]) {
    const key = line.tms_order_id ?? '__no_order__'
    if (!groups.has(key)) groups.set(key, { order: line.tms_order, lines: [] })
    groups.get(key)!.lines.push(line)
  }

  const totalPlanned = (lines as any[]).reduce((s, l) => s + (l.planned_boxes ?? 0), 0)
  const totalLines   = (lines as any[]).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-base font-semibold text-slate-800">Kế hoạch nhập ngoài</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {format(new Date(date + 'T00:00:00'), 'EEEE, dd-MM-yyyy', { locale: vi })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm w-36" />
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="h-8 text-sm w-32">
                <SelectValue placeholder="Chọn kho" />
              </SelectTrigger>
              <SelectContent>
                {(warehouses as { id: string; name: string; code: string }[]).map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.code} – {w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {can(perms, 'inbound_plan', 'create') && (
              <>
                <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Upload Excel
                </Button>
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Thêm dòng
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="flex gap-4 mt-2 text-xs">
          <span className="text-slate-500">Tổng dòng: <strong className="text-slate-700">{totalLines}</strong></span>
          <span className="text-slate-500">Tổng thùng KH: <strong className="text-blue-700">{totalPlanned.toLocaleString()}</strong></span>
          <span className="text-slate-500">Nhóm xe: <strong className="text-slate-700">{groups.size}</strong></span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        <div className="overflow-x-auto">
          <Table className="min-w-full text-[10px]">
            <TableHeader>
              <TableRow>
                {['ĐVVT', 'Loại xe', 'Loại kho', 'Mã hàng', 'Tên hàng', 'Số PO', 'KH thùng', 'KH pallet', 'Booking', ''].map(h => (
                  <TableHead key={h} className="text-[9px] px-2 py-1.5 whitespace-nowrap">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={10} className="px-3 py-6 text-center text-slate-400">Đang tải...</TableCell></TableRow>
              )}
              {!isLoading && groups.size === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="px-3 py-10 text-center text-slate-400">
                    Chưa có kế hoạch nhập — nhấn <strong>Upload Excel</strong> hoặc <strong>Thêm dòng</strong>
                  </TableCell>
                </TableRow>
              )}
              {[...groups.entries()].map(([key, group]) => {
                const order = group.order
                const groupBoxes   = group.lines.reduce((s, l) => s + (l.planned_boxes ?? 0), 0)
                return group.lines.map((line: any, li: number) => {
                  const isFirst = li === 0
                  return (
                    <TableRow key={line.id} className={isFirst ? 'border-t-2 border-slate-200' : ''}>
                      {isFirst ? (
                        <>
                          <TableCell rowSpan={group.lines.length} className="px-2 py-1 font-semibold align-top border-r border-slate-100">
                            {line.ncc?.name ?? line.ncc?.code ?? '—'}
                            {order && (
                              <div className="text-[9px] text-slate-400 font-mono mt-0.5">{order.order_code}</div>
                            )}
                          </TableCell>
                          <TableCell rowSpan={group.lines.length} className="px-2 py-1 text-slate-500 align-top border-r border-slate-100">
                            {line.vehicle_type || '—'}
                            {groupBoxes > 0 && (
                              <div className="text-[9px] text-blue-600 font-semibold mt-0.5">{groupBoxes.toLocaleString()} thùng</div>
                            )}
                          </TableCell>
                          <TableCell rowSpan={group.lines.length} className="px-2 py-1 text-slate-500 align-top border-r border-slate-100">
                            {line.warehouse_type || '—'}
                          </TableCell>
                        </>
                      ) : null}
                      <TableCell className="px-2 py-1 font-mono">{line.material?.material_code ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-slate-600">{line.material?.short_name ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 text-blue-600 font-mono">{line.po_number || '—'}</TableCell>
                      <TableCell className="px-2 py-1 tabular-nums font-semibold text-right">{line.planned_boxes?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1 tabular-nums text-right text-slate-500">{line.planned_pallets ?? '—'}</TableCell>
                      <TableCell className="px-2 py-1">
                        {order
                          ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-mono">{order.status}</span>
                          : <span className="text-[9px] text-slate-400">Chưa tạo</span>
                        }
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        {can(perms, 'inbound_plan', 'delete') && (
                          <button
                            onClick={() => { if (confirm('Xóa dòng này?')) deleteLine.mutate(line.id) }}
                            className="text-red-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Dialogs */}
      <AddLineDialog  open={addOpen}    date={date} warehouseId={warehouseId} onClose={() => setAddOpen(false)} />
      <UploadDialog   open={uploadOpen} date={date} warehouseId={warehouseId} onClose={() => setUploadOpen(false)} />
    </div>
  )
}
