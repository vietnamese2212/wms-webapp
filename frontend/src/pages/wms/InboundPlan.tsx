import React, { useState, useRef, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Plus, Upload, Trash2, FileSpreadsheet, X, Pencil } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import {
  useWarehouses, useWarehouseTypes, useVehicleTypes, useTransportCompanies,
  useMaterials, useInboundPlanLines, useBulkCreatePlanLines, useUpdatePlanLine, useDeletePlanLine,
} from '@/api/hooks'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
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

  const [formDate,      setFormDate]      = useState(date)
  const [warehouse,     setWarehouse]     = useState(warehouseId)
  const [warehouseType, setWarehouseType] = useState('')
  const [vehicleType,   setVehicleType]   = useState('')
  const [nccId,         setNccId]         = useState('')
  const [poNumber,      setPoNumber]      = useState('')
  const [rows,          setRows]          = useState<MatRow[]>([emptyRow()])
  const [err,           setErr]           = useState('')

  useEffect(() => {
    if (open) {
      setFormDate(date)
      setWarehouse(warehouseId)
      setWarehouseType('')
      setVehicleType('')
      setNccId('')
      setPoNumber('')
      setRows([emptyRow()])
      setErr('')
    }
  }, [open, date, warehouseId])

  const [activeDropdownIdx, setActiveDropdownIdx] = useState<number | null>(null)

  const matByCode = useMemo(() =>
    new Map((materials as any[]).map(m => [String(m.material_code).trim().toUpperCase(), m])),
    [materials]
  )

  function lookupAndSetRow(idx: number, code: string): MatRow {
    const found = matByCode.get(code.trim().toUpperCase())
    return {
      material_code: code,
      material_id:   found?.id        ?? '',
      mat_name:      found?.short_name ?? '',
      mat_unit:      found?.unit       ?? '',
      planned_boxes:   '',
      planned_pallets: '',
    }
  }

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

  function handleMatCodePaste(idx: number, e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text')
    const lines = text.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean)
    if (lines.length <= 1) return
    e.preventDefault()
    const newRows = lines.map(c => lookupAndSetRow(idx, c))
    setRows(prev => {
      const before = prev.slice(0, idx)
      const after  = prev.slice(idx + 1).filter(r => r.material_code !== '')
      return [...before, ...newRows, ...after]
    })
    setActiveDropdownIdx(null)
  }

  function selectMatFromDropdown(idx: number, m: any) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : {
      ...r,
      material_code: m.material_code,
      material_id:   m.id,
      mat_name:      m.short_name ?? '',
      mat_unit:      m.unit       ?? '',
    }))
    setActiveDropdownIdx(null)
  }

  function getDropdownMatches(code: string) {
    if (!code) return (materials as any[]).slice(0, 8)
    const q = code.toUpperCase()
    return (materials as any[])
      .filter(m =>
        String(m.material_code).toUpperCase().includes(q) ||
        String(m.short_name ?? '').toUpperCase().includes(q)
      )
      .slice(0, 8)
  }

  function setRowField(idx: number, field: 'planned_boxes' | 'planned_pallets', val: string) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, [field]: val }))
  }

  function handleNumberPaste(idx: number, field: 'planned_boxes' | 'planned_pallets', e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text')
    const values = text.split(/[\n\r]+/).map(s => s.trim().replace(/,/g, '')).filter(Boolean)
    if (values.length <= 1) return
    e.preventDefault()
    setRows(prev => prev.map((r, i) => {
      const vi = i - idx
      if (vi < 0 || vi >= values.length) return r
      return { ...r, [field]: values[vi] }
    }))
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
    const missingUnit = validRows.filter(r => !r.mat_unit)
    const missingQty  = validRows.filter(r => !r.planned_boxes)
    if (missingUnit.length) { setErr(`${missingUnit.length} hàng chưa có ĐVT — cần cập nhật ĐVT trong Masterdata`); return }
    if (missingQty.length)  { setErr('Vui lòng nhập Số thùng cho tất cả hàng'); return }
    try {
      await bulkCreate.mutateAsync(validRows.map(r => ({
        date: formDate, warehouse_id: warehouse,
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
          <div className="grid grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">Ngày *</Label>
              <Input
                type="date"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                className="h-8 text-xs mt-0.5"
              />
            </div>
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
          <div className="border rounded-lg">
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
                  const dropMatches = getDropdownMatches(row.material_code)
                  return (
                    <tr key={idx} className={invalid ? 'bg-red-50' : ''}>
                      <td className="px-1.5 py-1 relative">
                        <input
                          type="text"
                          value={row.material_code}
                          onChange={e => handleMatCodeChange(idx, e.target.value)}
                          onPaste={e => handleMatCodePaste(idx, e)}
                          onFocus={() => setActiveDropdownIdx(idx)}
                          onBlur={() => setTimeout(() => setActiveDropdownIdx(prev => prev === idx ? null : prev), 150)}
                          placeholder="Paste hoặc tìm mã hàng"
                          className={`w-full h-7 px-1.5 text-[10px] font-mono border rounded focus:outline-none focus:ring-1 ${
                            invalid
                              ? 'border-red-300 bg-red-50 focus:ring-red-400'
                              : 'border-slate-200 bg-white focus:ring-blue-400'
                          }`}
                        />
                        {activeDropdownIdx === idx && !row.material_id && (
                          <div className="absolute left-0 top-full z-50 w-72 mt-0.5 border rounded-md bg-white shadow-lg max-h-40 overflow-y-auto">
                            {dropMatches.length === 0
                              ? <p className="text-[10px] text-slate-400 px-2 py-2 text-center">Không tìm thấy</p>
                              : dropMatches.map((m: any) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => selectMatFromDropdown(idx, m)}
                                  className="w-full text-left px-2 py-1.5 hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0"
                                >
                                  <span className="text-[10px] font-mono text-slate-700 shrink-0">{m.material_code}</span>
                                  <span className="text-[10px] text-slate-500 truncate">{m.short_name}</span>
                                </button>
                              ))
                            }
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {row.mat_name
                          ? <span className="text-[10px] text-slate-700">{row.mat_name}</span>
                          : invalid
                            ? <span className="text-[9px] text-red-400">Không tìm thấy mã</span>
                            : <span className="text-[9px] text-slate-300">—</span>
                        }
                      </td>
                      <td className="px-2 py-1 text-center">
                        {row.mat_unit
                          ? <span className="text-[10px] text-slate-500">{row.mat_unit}</span>
                          : row.material_id
                            ? <span className="text-[9px] text-amber-500 font-medium">Chưa có</span>
                            : <span className="text-[10px] text-slate-300">—</span>}
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          type="number" min="0"
                          value={row.planned_boxes}
                          onChange={e => setRowField(idx, 'planned_boxes', e.target.value)}
                          onPaste={e => handleNumberPaste(idx, 'planned_boxes', e)}
                          className={`w-full h-7 px-1.5 text-[10px] border rounded text-right bg-white focus:outline-none focus:ring-1 ${
                            row.material_id && !row.planned_boxes
                              ? 'border-amber-300 focus:ring-amber-400'
                              : 'border-slate-200 focus:ring-blue-400'
                          }`}
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <input
                          type="number" min="0"
                          value={row.planned_pallets}
                          onChange={e => setRowField(idx, 'planned_pallets', e.target.value)}
                          onPaste={e => handleNumberPaste(idx, 'planned_pallets', e)}
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

// ─── Edit Line Dialog ─────────────────────────────────────────────────────────

function EditLineDialog({ line, onClose, onSaved }: {
  line: any; onClose: () => void; onSaved: (updated: any) => void
}) {
  const { data: materials = [] } = useMaterials()
  const updateLine = useUpdatePlanLine()

  const matByCode = useMemo(() =>
    new Map((materials as any[]).map(m => [String(m.material_code).trim().toUpperCase(), m])),
    [materials]
  )

  const [matCode,       setMatCode]       = useState(line.material?.material_code ?? '')
  const [matId,         setMatId]         = useState(line.material_id ?? '')
  const [matName,       setMatName]       = useState(line.material?.short_name ?? '')
  const [poNumber,      setPoNumber]      = useState(line.po_number ?? '')
  const [plannedBoxes,  setPlannedBoxes]  = useState(String(line.planned_boxes ?? ''))
  const [plannedPallets,setPlannedPallets]= useState(String(line.planned_pallets ?? ''))
  const [showDrop,      setShowDrop]      = useState(false)
  const [err,           setErr]           = useState('')

  function handleCodeChange(code: string) {
    const found = matByCode.get(code.trim().toUpperCase())
    setMatCode(code)
    setMatId(found?.id ?? '')
    setMatName(found?.short_name ?? '')
  }

  function selectMat(m: any) {
    setMatCode(m.material_code); setMatId(m.id); setMatName(m.short_name ?? '')
    setShowDrop(false)
  }

  const dropMatches = useMemo(() => {
    if (!matCode) return (materials as any[]).slice(0, 8)
    const q = matCode.toUpperCase()
    return (materials as any[]).filter(m =>
      String(m.material_code).toUpperCase().includes(q) ||
      String(m.short_name ?? '').toUpperCase().includes(q)
    ).slice(0, 8)
  }, [matCode, materials])

  async function handleSave() {
    setErr('')
    try {
      const updated = await updateLine.mutateAsync({
        id:              line.id,
        material_id:     matId         || undefined,
        po_number:       poNumber      || undefined,
        planned_boxes:   plannedBoxes   ? Number(plannedBoxes)   : undefined,
        planned_pallets: plannedPallets ? Number(plannedPallets) : undefined,
      })
      onSaved(updated)
    } catch (e) {
      const msg = (e as AxiosError<{error:{message:string}}>)?.response?.data?.error?.message
      setErr(msg ?? 'Lỗi lưu dữ liệu')
    }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Sửa dòng kế hoạch</DialogTitle></DialogHeader>

        {/* Context info — read-only */}
        <div className="bg-slate-50 rounded-lg px-3 py-2 text-[10px] text-slate-500 space-y-0.5">
          <div className="flex gap-2"><span className="w-20 shrink-0">Ngày</span><span className="font-medium text-slate-700">{line.date}</span></div>
          <div className="flex gap-2"><span className="w-20 shrink-0">ĐVVT</span><span className="font-medium text-slate-700">{line.ncc?.name ?? line.ncc?.code ?? '—'}</span></div>
          {line.warehouse_type && <div className="flex gap-2"><span className="w-20 shrink-0">Loại kho</span><span className="font-medium text-slate-700">{line.warehouse_type}</span></div>}
          {line.vehicle_type   && <div className="flex gap-2"><span className="w-20 shrink-0">Loại xe</span><span className="font-medium text-slate-700">{line.vehicle_type}</span></div>}
        </div>

        {/* Editable fields */}
        <div className="space-y-3">
          {/* Mã hàng */}
          <div className="relative">
            <Label className="text-xs">Mã hàng</Label>
            <input
              type="text"
              value={matCode}
              onChange={e => handleCodeChange(e.target.value)}
              onFocus={() => setShowDrop(true)}
              onBlur={() => setTimeout(() => setShowDrop(false), 150)}
              placeholder="Mã hàng"
              className={`w-full h-8 mt-0.5 px-2 text-xs font-mono border rounded focus:outline-none focus:ring-1 ${
                matCode && !matId ? 'border-red-300 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-400'
              }`}
            />
            {matName && <p className="text-[10px] text-slate-500 mt-0.5">{matName}</p>}
            {showDrop && !matId && (
              <div className="absolute left-0 top-full z-50 w-full mt-0.5 border rounded-md bg-white shadow-lg max-h-36 overflow-y-auto">
                {dropMatches.length === 0
                  ? <p className="text-[10px] text-slate-400 px-2 py-2 text-center">Không tìm thấy</p>
                  : dropMatches.map((m: any) => (
                    <button key={m.id} type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => selectMat(m)}
                      className="w-full text-left px-2 py-1.5 hover:bg-blue-50 flex items-center gap-2 border-b border-slate-50 last:border-0"
                    >
                      <span className="text-[10px] font-mono text-slate-700 shrink-0">{m.material_code}</span>
                      <span className="text-[10px] text-slate-500 truncate">{m.short_name}</span>
                    </button>
                  ))
                }
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Số thùng</Label>
              <Input type="number" min="0" value={plannedBoxes}
                onChange={e => setPlannedBoxes(e.target.value)}
                className="h-8 text-xs mt-0.5 text-right" />
            </div>
            <div>
              <Label className="text-xs">Pallet</Label>
              <Input type="number" min="0" value={plannedPallets}
                onChange={e => setPlannedPallets(e.target.value)}
                className="h-8 text-xs mt-0.5 text-right" />
            </div>
            <div>
              <Label className="text-xs">Số PO</Label>
              <Input value={poNumber} onChange={e => setPoNumber(e.target.value)}
                placeholder="PO-0001" className="h-8 text-xs mt-0.5" />
            </div>
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={handleSave} disabled={updateLine.isPending}>
            {updateLine.isPending ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Upload Excel Dialog ──────────────────────────────────────────────────────

type PreviewRow = {
  ncc_code: string; ncc_id: string
  kho_code: string; kho_id: string
  warehouse_type: string; vehicle_type: string
  material_code: string; material_id: string
  dvt_input: string; mat_unit: string
  po_number: string; planned_boxes: number | null; planned_pallets: number | null
  _valid: boolean; _error: string
}

function UploadDialog({ open, date, warehouseId, onClose }: {
  open: boolean; date: string; warehouseId: string; onClose: () => void
}) {
  const { data: transportCompanies = [] } = useTransportCompanies(true)
  const { data: materials = [] }          = useMaterials()
  const { data: warehouses = [] }         = useWarehouses(true)
  const { data: whTypesData = [] }        = useWarehouseTypes()
  const { data: vehicleTypes = [] }       = useVehicleTypes(true)
  const bulkCreate = useBulkCreatePlanLines()

  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const nccByCode = new Map((transportCompanies as any[]).map((c: any) => [String(c.code).trim().toUpperCase(), c.id]))
  const whByCode  = new Map((warehouses as any[]).map((w: any) => [String(w.code).trim().toUpperCase(), w.id]))
  const whTypeSet = new Set(whTypesData.map(t => t.value))
  const vtNameSet = new Set((vehicleTypes as any[]).map((vt: any) => String(vt.name)))
  const matByCode = new Map((materials as any[]).map((m: any) => [String(m.material_code).trim(), { id: m.id, unit: m.unit ?? '' }]))

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

        const parsed: PreviewRow[] = rows.map((row, i) => {
          const khoCode  = String(row['Mã kho'] ?? row['kho_code'] ?? '').trim().toUpperCase()
          const nccCode  = String(row['Mã NCC'] ?? row['NCC'] ?? row['ncc_code'] ?? '').trim().toUpperCase()
          const whType   = String(row['Loại kho'] ?? row['warehouse_type'] ?? '').trim()
          const vt       = String(row['Loại xe'] ?? row['vehicle_type'] ?? '').trim()
          const matCode  = String(row['Mã hàng'] ?? row['material_code'] ?? '').trim()
          const dvtInput = String(row['ĐVT'] ?? row['unit'] ?? '').trim()
          const po       = String(row['Số PO'] ?? row['PO'] ?? row['po_number'] ?? '').trim()
          const boxes    = row['Số thùng'] ?? row['planned_boxes'] ?? null
          const pallets  = row['Số pallet'] ?? row['planned_pallets'] ?? null

          const khoId   = khoCode ? (whByCode.get(khoCode) ?? '') : warehouseId
          const nccId   = nccByCode.get(nccCode) ?? ''
          const matInfo = matByCode.get(matCode)
          const matId   = matInfo?.id ?? ''
          const matUnit = matInfo?.unit ?? ''

          let error = ''
          if (!nccCode)                                    error = `Dòng ${i + 2}: thiếu Mã NCC`
          else if (!nccId)                                 error = `Dòng ${i + 2}: NCC "${nccCode}" không tìm thấy`
          else if (khoCode && !whByCode.has(khoCode))      error = `Dòng ${i + 2}: kho "${khoCode}" không tìm thấy`
          else if (whType && !whTypeSet.has(whType))       error = `Dòng ${i + 2}: Loại kho "${whType}" không hợp lệ`
          else if (vt && !vtNameSet.has(vt))               error = `Dòng ${i + 2}: Loại xe "${vt}" không hợp lệ`
          else if (!matCode)                               error = `Dòng ${i + 2}: thiếu Mã hàng`
          else if (!matId)                                 error = `Dòng ${i + 2}: hàng "${matCode}" không tìm thấy`
          else if (dvtInput && matUnit && dvtInput.toUpperCase() !== matUnit.toUpperCase())
                                                           error = `Dòng ${i + 2}: ĐVT "${dvtInput}" ≠ "${matUnit}"`

          return {
            ncc_code: nccCode, ncc_id: nccId,
            kho_code: khoCode, kho_id: khoId,
            warehouse_type: whType, vehicle_type: vt,
            material_code: matCode, material_id: matId,
            dvt_input: dvtInput, mat_unit: matUnit,
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
        date, warehouse_id: r.kho_id || warehouseId,
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
      { 'Mã kho': 'KHO1', 'Mã NCC': 'FAST', 'Loại kho': 'TP', 'Loại xe': 'PALLET', 'Mã hàng': '510000127', 'ĐVT': 'CTN', 'Số PO': 'PO-0001', 'Số thùng': 500, 'Số pallet': 10 },
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
              File Excel phải có các cột: <strong>Mã NCC</strong>, <strong>Mã hàng</strong>, Loại kho, Loại xe, ĐVT, Số PO, Số thùng, Số pallet. Tuỳ chọn: Mã kho (nếu không điền dùng kho đang chọn).
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
                    {['Kho', 'NCC', 'Loại kho', 'Loại xe', 'Mã hàng', 'ĐVT', 'Thùng', 'Trạng thái'].map(h => (
                      <th key={h} className="px-2 py-1 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className={r._valid ? 'hover:bg-slate-50' : 'bg-red-50'}>
                      <td className="px-2 py-1 font-mono text-[9px] text-slate-400">{r.kho_code || '(mặc định)'}</td>
                      <td className="px-2 py-1 font-mono">{r.ncc_code || '—'}</td>
                      <td className="px-2 py-1">{r.warehouse_type || '—'}</td>
                      <td className="px-2 py-1">{r.vehicle_type || '—'}</td>
                      <td className="px-2 py-1 font-mono">{r.material_code || '—'}</td>
                      <td className="px-2 py-1">
                        {r.dvt_input && r.mat_unit && r.dvt_input.toUpperCase() !== r.mat_unit.toUpperCase()
                          ? <span className="text-red-500">{r.dvt_input}</span>
                          : <span>{r.dvt_input || r.mat_unit || '—'}</span>}
                      </td>
                      <td className="px-2 py-1 tabular-nums text-right">{r.planned_boxes ?? '—'}</td>
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

// ─── Detail helper ───────────────────────────────────────────────────────────
function DRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <span className="font-medium text-slate-700 break-words min-w-0">
        {value ?? <span className="text-slate-300">—</span>}
      </span>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InboundPlan() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null

  const [dateFrom,    setDateFrom]    = useState(TODAY)
  const [dateTo,      setDateTo]      = useState(TODAY)
  const [warehouseId, setWarehouseId] = useState(user?.warehouse_id ?? (user?.warehouse_ids as string[] | undefined)?.[0] ?? '')
  const [addOpen,      setAddOpen]      = useState(false)
  const [uploadOpen,   setUploadOpen]   = useState(false)
  const [editLine,     setEditLine]     = useState<any | null>(null)
  const [whTypeFilter, setWhTypeFilter] = useState<string[]>([])
  const [nccFilter,    setNccFilter]    = useState<string[]>([])
  const [detailLine,   setDetailLine]   = useState<any | null>(null)

  const { data: warehouses = [] }   = useWarehouses(true)
  const { data: whTypesData = [] }  = useWarehouseTypes()
  const { data: lines = [], isLoading } = useInboundPlanLines(
    dateFrom && warehouseId ? { date_from: dateFrom, date_to: dateTo || dateFrom, warehouse_id: warehouseId } : undefined
  )
  const deleteLine = useDeletePlanLine()

  const whMap = useMemo(() =>
    new Map((warehouses as any[]).map(w => [w.id, w.code]))
  , [warehouses])

  const nccOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of lines as any[]) {
      if (l.ncc?.id) seen.set(l.ncc.id, l.ncc.name ?? l.ncc.code ?? l.ncc.id)
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [lines])

  const filteredLines = useMemo(() =>
    (lines as any[]).filter(l => {
      if (whTypeFilter.length > 0 && !whTypeFilter.includes(l.warehouse_type ?? '')) return false
      if (nccFilter.length > 0 && !nccFilter.includes(l.ncc?.id ?? '')) return false
      return true
    })
  , [lines, whTypeFilter, nccFilter])

  const totalPlanned = filteredLines.reduce((s, l) => s + (l.planned_boxes ?? 0), 0)
  const totalLines   = filteredLines.length
  const uniqueNcc    = new Set(filteredLines.map(l => l.ncc?.id).filter(Boolean)).size

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold text-slate-800">Kế hoạch nhập ngoài</h1>
          {can(perms, 'inbound_plan', 'create') && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Upload Excel
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Thêm dòng
              </Button>
            </div>
          )}
        </div>

        {/* Filters — all in one row */}
        <div className="flex flex-wrap gap-2 mt-2 items-center">
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); if (dateTo < e.target.value) setDateTo(e.target.value) }} className="h-7 text-xs w-32" />
          <span className="text-xs text-slate-400">–</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); if (dateFrom > e.target.value) setDateFrom(e.target.value) }} className="h-7 text-xs w-32" />
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger className="h-7 text-xs w-28">
              <SelectValue placeholder="Chọn kho" />
            </SelectTrigger>
            <SelectContent>
              {(warehouses as { id: string; name: string; code: string }[]).map(w => (
                <SelectItem key={w.id} value={w.id}>{w.code} – {w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MultiSelectFilter
            label="Loại kho"
            options={whTypesData.map(t => ({ value: t.value, label: t.value }))}
            selected={whTypeFilter}
            onChange={setWhTypeFilter}
          />
          <MultiSelectFilter
            label="ĐVVT"
            options={nccOptions}
            selected={nccFilter}
            onChange={setNccFilter}
            searchable
          />
        </div>

        {/* Summary */}
        <div className="flex gap-4 mt-1.5 text-xs">
          <span className="text-slate-500">Tổng dòng: <strong className="text-slate-700">{totalLines}</strong></span>
          <span className="text-slate-500">Tổng SL KH: <strong className="text-blue-700">{totalPlanned.toLocaleString()}</strong></span>
          <span className="text-slate-500">ĐVVT: <strong className="text-slate-700">{uniqueNcc}</strong></span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Ngày</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Kho</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">ĐVVT</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Tên hàng</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">ĐVT</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">SL KH</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">SL nhận</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Booking</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Loại kho</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Loại xe</TableHead>
              <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={12} className="px-3 py-6 text-center text-slate-400">Đang tải...</TableCell></TableRow>
            )}
            {!isLoading && filteredLines.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="px-3 py-10 text-center text-slate-400">
                  Chưa có kế hoạch nhập — nhấn <strong>Upload Excel</strong> hoặc <strong>Thêm dòng</strong>
                </TableCell>
              </TableRow>
            )}
            {filteredLines.map((line: any) => {
              const order = line.tms_order
              return (
                <TableRow
                  key={line.id}
                  className={`cursor-pointer ${detailLine?.id === line.id ? 'bg-blue-50 hover:bg-blue-50' : 'hover:bg-slate-50'}`}
                  onClick={() => setDetailLine((prev: any) => prev?.id === line.id ? null : line)}
                >
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-mono text-slate-500">
                    {format(new Date(line.date + 'T00:00:00'), 'dd-MM-yy')}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-mono text-slate-500">
                    {whMap.get(line.warehouse_id) ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold">
                    {line.ncc?.name ?? line.ncc?.code ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-mono font-semibold">
                    {line.material?.material_code ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] text-slate-600 max-w-[180px] truncate">
                    {line.material?.short_name ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] text-slate-500">
                    {line.material?.unit ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">
                    {line.planned_boxes != null ? line.planned_boxes.toLocaleString() : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] tabular-nums text-right text-slate-500">
                    {line.actual_boxes != null ? line.actual_boxes.toLocaleString() : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    {order
                      ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-mono">{order.status}</span>
                      : <span className="text-[9px] text-slate-300">—</span>
                    }
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] text-slate-500">
                    {line.warehouse_type ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] text-slate-500">
                    {line.vehicle_type ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {can(perms, 'inbound_plan', 'edit') && (
                        <button
                          onClick={e => { e.stopPropagation(); setEditLine(line) }}
                          className="text-slate-400 hover:text-blue-600 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {can(perms, 'inbound_plan', 'delete') && (
                        <button
                          onClick={e => { e.stopPropagation(); if (confirm('Xóa dòng này?')) deleteLine.mutate(line.id) }}
                          className="text-slate-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Dialogs */}
      <AddLineDialog  open={addOpen}    date={dateFrom} warehouseId={warehouseId} onClose={() => setAddOpen(false)} />
      <UploadDialog   open={uploadOpen} date={dateFrom} warehouseId={warehouseId} onClose={() => setUploadOpen(false)} />
      {editLine && (
        <EditLineDialog
          line={editLine}
          onClose={() => setEditLine(null)}
          onSaved={updated => { setEditLine(null); if (detailLine?.id === updated.id) setDetailLine(updated) }}
        />
      )}

      {/* Detail Sheet */}
      <Sheet open={!!detailLine} onOpenChange={open => !open && setDetailLine(null)}>
        <SheetContent side="right" className="w-80 sm:w-96 p-0 flex flex-col">
          {detailLine && (
            <>
              <SheetHeader className="px-4 py-3 border-b bg-slate-50 shrink-0">
                <div className="flex items-center gap-2 pr-6">
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-sm font-mono">{detailLine.material?.material_code ?? '—'}</SheetTitle>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{detailLine.material?.short_name ?? ''}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {can(perms, 'inbound_plan', 'edit') && (
                      <button
                        onClick={() => setEditLine(detailLine)}
                        className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-blue-600 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {can(perms, 'inbound_plan', 'delete') && (
                      <button
                        onClick={() => { if (confirm('Xóa dòng này?')) { deleteLine.mutate(detailLine.id); setDetailLine(null) } }}
                        className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                <div>
                  <p className="text-[10px] font-medium text-slate-500 mb-1.5">Kế hoạch</p>
                  <div className="space-y-0">
                    <DRow label="KH thùng"  value={detailLine.planned_boxes != null ? detailLine.planned_boxes.toLocaleString() : null} />
                    <DRow label="KH pallet" value={detailLine.planned_pallets} />
                    <DRow label="Số PO"     value={detailLine.po_number} />
                    <DRow label="Loại kho"  value={detailLine.warehouse_type} />
                    <DRow label="Loại xe"   value={detailLine.vehicle_type} />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-slate-500 mb-1.5">Hàng hóa</p>
                  <div className="space-y-0">
                    <DRow label="Mã hàng"  value={<span className="font-mono">{detailLine.material?.material_code}</span>} />
                    <DRow label="Tên hàng" value={detailLine.material?.short_name} />
                    <DRow label="ĐVT"      value={detailLine.material?.unit} />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-medium text-slate-500 mb-1.5">ĐVVT / NCC</p>
                  <div className="space-y-0">
                    <DRow label="Tên" value={detailLine.ncc?.name} />
                    <DRow label="Mã"  value={detailLine.ncc?.code} />
                  </div>
                </div>
                {detailLine.tms_order && (
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 mb-1.5">Lệnh TMS</p>
                    <div className="space-y-0">
                      <DRow label="Mã lệnh"    value={<span className="font-mono">{detailLine.tms_order.order_code}</span>} />
                      <DRow label="Trạng thái" value={detailLine.tms_order.status} />
                    </div>
                  </div>
                )}
                {(detailLine.created_at || detailLine.updated_at) && (
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 mb-1.5">Lịch sử</p>
                    <div className="space-y-0">
                      {detailLine.created_at && (
                        <DRow label="Tạo lúc" value={`${formatTimestampDate(detailLine.created_at)} ${formatTimestampTime(detailLine.created_at)}`} />
                      )}
                      {detailLine.updated_at && (
                        <DRow label="Sửa lúc" value={`${formatTimestampDate(detailLine.updated_at)} ${formatTimestampTime(detailLine.updated_at)}`} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
