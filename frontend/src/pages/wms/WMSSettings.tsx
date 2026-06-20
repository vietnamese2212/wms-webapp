import { useState } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, Trash2, Warehouse, Tag, Settings2, MapPin, X, Clock, ShieldCheck } from 'lucide-react'
import { formatDateTime } from '@/utils/formatters'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Card }     from '@/components/ui/card'
import { Badge }    from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import {
  useWarehouses, useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse,
  useWarehouseTypes, useAddWarehouseType, useUpdateWarehouseType, useDeleteWarehouseType,
  useWarehouseZones, useCreateWarehouseZone, useUpdateWarehouseZone, useDeleteWarehouseZone,
  useImportShifts, useCreateImportShift, useUpdateImportShift,
  useQAStatuses, useCreateQAStatus, useUpdateQAStatus,
  type WarehouseZone,
} from '@/api/hooks'
import { can, type ModulePermissions } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// ─── Warehouse Dialog ─────────────────────────────────────────────────────────

interface WhRow { id: string; code: string; name: string; address: string | null; is_active: boolean; warehouse_type: string; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }

function WarehouseDialog({ wh, open, onClose }: { wh: WhRow | null; open: boolean; onClose: () => void }) {
  const isEdit = !!wh
  const [code,          setCode]          = useState(wh?.code ?? '')
  const [name,          setName]          = useState(wh?.name ?? '')
  const [address,       setAddress]       = useState(wh?.address ?? '')
  const [warehouseType, setWarehouseType] = useState<'CENTRAL' | 'NPP'>((wh?.warehouse_type as 'CENTRAL' | 'NPP') ?? 'CENTRAL')
  const [isActive,      setIsActive]      = useState(wh?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateWarehouse()
  const { mutate: update, isPending: updating } = useUpdateWarehouse()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!code.trim() || !name.trim()) { setErr('Mã và tên kho là bắt buộc'); return }
    if (isEdit) {
      update(
        { id: wh.id, name: name.trim(), address: address.trim() || undefined, is_active: isActive, warehouse_type: warehouseType },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { code: code.trim(), name: name.trim(), address: address.trim() || undefined, warehouse_type: warehouseType },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa kho' : 'Thêm kho'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">Mã kho *</Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="BV, BB, HN…" disabled={isEdit} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tên kho *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Kho Ba Vì, Kho Bàu Bàng…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Địa chỉ</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Chức năng kho *</Label>
            <Select value={warehouseType} onValueChange={v => setWarehouseType(v as 'CENTRAL' | 'NPP')}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CENTRAL">Kho tổng</SelectItem>
                <SelectItem value="NPP">Kho NPP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="wh-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="wh-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Zone Dialog ──────────────────────────────────────────────────────────────

function ZoneDialog({ zone, warehouseId, warehouses, warehouseTypes, open, onClose }: {
  zone: WarehouseZone | null; warehouseId: string; warehouses: WhRow[]
  warehouseTypes: { id: string; value: string }[]; open: boolean; onClose: () => void
}) {
  const isEdit = !!zone
  const [selectedWhId, setSelectedWhId] = useState(zone?.warehouse_id ?? warehouseId)
  const [name,     setName]     = useState(zone?.name ?? '')
  const [category, setCategory] = useState(zone?.category ?? '')
  const [isActive, setIsActive] = useState(zone?.is_active ?? true)
  const [err, setErr] = useState('')

  const { mutate: create, isPending: creating } = useCreateWarehouseZone()
  const { mutate: update, isPending: updating } = useUpdateWarehouseZone()
  const isPending = creating || updating

  function handleSubmit() {
    setErr('')
    if (!isEdit && !selectedWhId) { setErr('Chọn kho là bắt buộc'); return }
    if (!name.trim()) { setErr('Tên khu vực là bắt buộc'); return }
    if (isEdit) {
      update(
        { id: zone.id, name: name.trim(), category: category || null, is_active: isActive },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { warehouse_id: selectedWhId, name: name.trim(), category: category || undefined },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa khu vực' : 'Thêm khu vực kho'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

          {/* Kho */}
          {isEdit ? (
            <div className="space-y-1">
              <Label className="text-xs">Kho</Label>
              <p className="text-sm font-medium text-slate-700">
                {warehouses.find(w => w.id === zone.warehouse_id)?.name ?? '—'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Kho *</Label>
              <Select value={selectedWhId || '__none__'} onValueChange={v => setSelectedWhId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Chọn kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Chọn kho</SelectItem>
                  {warehouses.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Loại kho */}
          <div className="space-y-1">
            <Label className="text-xs">Loại kho</Label>
            <Select value={category || '__none__'} onValueChange={v => setCategory(v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Chưa gắn loại kho" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Chưa gắn loại kho</SelectItem>
                {warehouseTypes.map(t => (
                  <SelectItem key={t.id} value={t.value}>{t.value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tên */}
          <div className="space-y-1">
            <Label className="text-xs">Tên khu vực *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Khu Thành phẩm, Khu NVL…" />
          </div>
          {!isEdit && <p className="text-[10px] text-slate-400">Mã khu vực sẽ được hệ thống tự tạo (Z01, Z02…)</p>}

          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="zone-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="zone-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !name.trim() || (!isEdit && !selectedWhId)}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Type Dialog ─────────────────────────────────────────────────────────────

function TypeDialog({ type, open, onClose }: {
  type: { id: string; value: string } | null; open: boolean; onClose: () => void
}) {
  const isEdit = !!type
  const [value, setValue] = useState(type?.value ?? '')
  const [err, setErr] = useState('')

  const { mutate: add,    isPending: adding    } = useAddWarehouseType()
  const { mutate: update, isPending: updating  } = useUpdateWarehouseType()
  const isPending = adding || updating

  function handleSubmit() {
    setErr('')
    if (!value.trim()) { setErr('Tên loại kho là bắt buộc'); return }
    if (isEdit) {
      update({ id: type.id, value: value.trim() }, { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    } else {
      add(value.trim(), { onSuccess: onClose, onError: e => setErr(apiMsg(e)) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>{isEdit ? 'Sửa loại kho' : 'Thêm loại kho'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">Tên loại kho *</Label>
            <Input value={value} onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="Thành phẩm, NVL, POSM…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !value.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Ca nhập / Tình trạng QA (cùng shape: code/name/display_order/is_active) ────

interface MetaRow { id: string; code: string; name: string; display_order: number; is_active: boolean }

function MetaDialog({ kind, row, open, onClose }: {
  kind: 'shift' | 'qa'; row: MetaRow | null; open: boolean; onClose: () => void
}) {
  const isEdit = !!row
  const [code,     setCode]     = useState(row?.code ?? '')
  const [name,     setName]     = useState(row?.name ?? '')
  const [order,    setOrder]    = useState(String(row?.display_order ?? 0))
  const [isActive, setIsActive] = useState(row?.is_active ?? true)
  const [err, setErr] = useState('')

  const createShift = useCreateImportShift()
  const updateShift = useUpdateImportShift()
  const createQA    = useCreateQAStatus()
  const updateQA    = useUpdateQAStatus()
  const noun = kind === 'shift' ? 'ca nhập' : 'trạng thái QA'
  const isPending = kind === 'shift'
    ? createShift.isPending || updateShift.isPending
    : createQA.isPending || updateQA.isPending

  function handleSubmit() {
    setErr('')
    if (!code.trim() || !name.trim()) { setErr('Mã và tên là bắt buộc'); return }
    const display_order = Number(order) || 0
    const opts = { onSuccess: onClose, onError: (e: unknown) => setErr(apiMsg(e)) }
    if (isEdit) {
      const body = { id: row.id, code: code.trim(), name: name.trim(), display_order, is_active: isActive }
      if (kind === 'shift') updateShift.mutate(body, opts); else updateQA.mutate(body, opts)
    } else {
      const body = { code: code.trim(), name: name.trim(), display_order }
      if (kind === 'shift') createShift.mutate(body, opts); else createQA.mutate(body, opts)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? `Sửa ${noun}` : `Thêm ${noun}`}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Mã *</Label>
              <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={kind === 'shift' ? 'C1' : 'OK'} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Tên *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'shift' ? 'Ca 1, Ca hành chính…' : 'Đạt, Chờ kiểm…'} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Thứ tự hiển thị</Label>
            <Input type="number" value={order} onChange={e => setOrder(e.target.value)} className="w-24" />
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="meta-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="meta-active" className="text-sm cursor-pointer">Đang sử dụng</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MetaTab({ noun, rows, loading, canManage, onAdd, onEdit }: {
  noun: string; rows: MetaRow[]; loading: boolean; canManage: boolean
  onAdd: () => void; onEdit: (r: MetaRow) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{rows.length} {noun}</p>
        {canManage && (
          <Button size="sm" className="gap-1.5" onClick={onAdd}>
            <Plus className="h-4 w-4" /> Thêm {noun}
          </Button>
        )}
      </div>
      <Card>
        {loading ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
          rows.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">Chưa có {noun} nào</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3 py-2 text-xs">Mã</TableHead>
                    <TableHead className="px-3 py-2 text-xs">Tên</TableHead>
                    <TableHead className="px-3 py-2 text-xs">Thứ tự</TableHead>
                    <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                    {canManage && <TableHead className="px-3 py-2 w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id} className={`text-sm ${!r.is_active ? 'opacity-50' : ''}`}>
                      <TableCell className="px-3 py-2 font-mono font-semibold text-[11px] text-slate-600">{r.code}</TableCell>
                      <TableCell className="px-3 py-2 font-medium text-slate-800">{r.name}</TableCell>
                      <TableCell className="px-3 py-2 text-slate-500 text-xs tabular-nums">{r.display_order}</TableCell>
                      <TableCell className="px-3 py-2">
                        <Badge variant={r.is_active ? 'default' : 'secondary'} className="text-xs">
                          {r.is_active ? 'Hoạt động' : 'Tạm dừng'}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="px-2 py-2">
                          <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors" onClick={() => onEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        }
      </Card>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WMSSettings() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canManageGlobal = can(perms, 'wms_settings', 'manage_global')
  const canManageZone   = can(perms, 'wms_settings', 'manage_zone') || canManageGlobal

  // Kho
  const { data: allWh = [], isLoading: loadingWh } = useWarehouses(false)
  const { mutate: deleteWh, isPending: deletingWh } = useDeleteWarehouse()
  const [editingWh, setEditingWh] = useState<WhRow | null>(null)
  const [showWhDlg, setShowWhDlg] = useState(false)

  // Loại kho
  const { data: warehouseTypes = [], isLoading: loadingTypes } = useWarehouseTypes()
  const { mutate: deleteType, isPending: deletingType }  = useDeleteWarehouseType()
  const [editingType, setEditingType] = useState<{ id: string; value: string } | null>(null)
  const [showTypeDlg, setShowTypeDlg] = useState(false)

  // Detail panel state
  const [detailWh,   setDetailWh]   = useState<WhRow | null>(null)
  const [detailType, setDetailType] = useState<{ id: string; value: string; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null } | null>(null)
  const [detailZone, setDetailZone] = useState<WarehouseZone | null>(null)

  // Khu vực kho — lọc theo warehouse_scope của user
  const activeWh = (allWh as WhRow[]).filter(w => w.is_active)
  const zoneAccessWh = canManageGlobal
    ? activeWh
    : activeWh.filter(w => (user?.warehouse_ids ?? []).includes(w.id))
  const [selectedWhId, setSelectedWhId] = useState('')
  const effectiveWhId = selectedWhId || zoneAccessWh[0]?.id || ''
  const { data: zones = [], isLoading: loadingZones } = useWarehouseZones(effectiveWhId || undefined)
  const { mutate: deleteZone, isPending: deletingZone } = useDeleteWarehouseZone()
  const [editingZone, setEditingZone] = useState<WarehouseZone | null>(null)
  const [showZoneDlg, setShowZoneDlg] = useState(false)

  // Ca nhập
  const { data: shifts = [], isLoading: loadingShifts } = useImportShifts()
  const [editShift, setEditShift] = useState<MetaRow | null>(null)
  const [showShiftDlg, setShowShiftDlg] = useState(false)

  // Tình trạng QA
  const { data: qaStatuses = [], isLoading: loadingQA } = useQAStatuses()
  const [editQA, setEditQA] = useState<MetaRow | null>(null)
  const [showQADlg, setShowQADlg] = useState(false)

  function handleDeleteWh(wh: WhRow) {
    if (!confirm(`Xóa kho "${wh.name}"?\nChỉ xóa được kho chưa có vị trí nào.`)) return
    deleteWh(wh.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được kho', description: apiMsg(e) }) })
  }

  function handleDeleteZone(z: WarehouseZone) {
    if (!confirm(`Xóa khu vực "${z.code} – ${z.name}"?`)) return
    deleteZone(z.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được khu vực', description: apiMsg(e) }) })
  }

  return (
    <div className="h-full overflow-auto sm:p-3">
     <div className="max-w-5xl mx-auto bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm p-4 space-y-4">
      <div>
        <h1 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-slate-500" />
          Cài đặt WMS
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">Kho, loại kho, khu vực kho — master data dùng chung cho toàn hệ thống</p>
      </div>

      <Tabs defaultValue="warehouses">
        <TabsList className="mb-2">
          <TabsTrigger value="warehouses" className="gap-1.5"><Warehouse className="h-3.5 w-3.5" /> Kho</TabsTrigger>
          <TabsTrigger value="types"      className="gap-1.5"><Tag      className="h-3.5 w-3.5" /> Loại kho</TabsTrigger>
          <TabsTrigger value="zones"      className="gap-1.5"><MapPin     className="h-3.5 w-3.5" /> Khu vực kho</TabsTrigger>
          <TabsTrigger value="shifts"     className="gap-1.5"><Clock      className="h-3.5 w-3.5" /> Ca nhập</TabsTrigger>
          <TabsTrigger value="qa"         className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Tình trạng QA</TabsTrigger>
        </TabsList>

        {/* ── Tab: Kho ── */}
        <TabsContent value="warehouses" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{(allWh as WhRow[]).length} kho</p>
            {canManageGlobal && (
              <Button size="sm" className="gap-1.5" onClick={() => { setEditingWh(null); setShowWhDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm kho
              </Button>
            )}
          </div>
          <div className="flex gap-3 items-start">
            <Card className="flex-1 min-w-0">
              {loadingWh ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-3 py-2 text-xs">Mã</TableHead>
                        <TableHead className="px-3 py-2 text-xs">Tên kho</TableHead>
                        <TableHead className="px-3 py-2 text-xs">Chức năng</TableHead>
                        <TableHead className="px-3 py-2 text-xs">Địa chỉ</TableHead>
                        <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                        {canManageGlobal && <TableHead className="px-3 py-2 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(allWh as WhRow[]).map(wh => (
                        <TableRow key={wh.id}
                          className={`text-sm cursor-pointer ${!wh.is_active ? 'opacity-50' : ''} ${detailWh?.id === wh.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailWh(prev => prev?.id === wh.id ? null : wh)}>
                          <TableCell className="px-3 py-2 font-mono font-semibold text-[11px] text-slate-600">{wh.code}</TableCell>
                          <TableCell className="px-3 py-2 font-medium text-slate-800">{wh.name}</TableCell>
                          <TableCell className="px-3 py-2">
                            <Badge variant="outline" className={`text-[10px] ${wh.warehouse_type === 'NPP' ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-blue-400 text-blue-700 bg-blue-50'}`}>
                              {wh.warehouse_type === 'NPP' ? 'Kho NPP' : 'Kho tổng'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-slate-500 text-xs">{wh.address ?? '—'}</TableCell>
                          <TableCell className="px-3 py-2">
                            <Badge variant={wh.is_active ? 'default' : 'secondary'} className="text-xs">
                              {wh.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {canManageGlobal && (
                            <TableCell className="px-2 py-2">
                              <div className="flex items-center gap-0.5">
                                <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                  onClick={e => { e.stopPropagation(); setEditingWh(wh); setShowWhDlg(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                  disabled={deletingWh}
                                  onClick={e => { e.stopPropagation(); handleDeleteWh(wh) }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            {detailWh && (
              <Card className="w-60 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailWh.code} — {detailWh.name}</span>
                  <button onClick={() => setDetailWh(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Chức năng:</span> <span className="font-medium">{detailWh.warehouse_type === 'NPP' ? 'Kho NPP' : 'Kho tổng'}</span></div>
                <div><span className="text-slate-400">Địa chỉ:</span> <span className="font-medium">{detailWh.address ?? '—'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailWh.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailWh.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailWh.created_at ? formatDateTime(detailWh.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailWh.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailWh.updated_at ? formatDateTime(detailWh.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Loại kho ── */}
        <TabsContent value="types" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Danh sách loại kho — dùng cho phân loại vị trí, mã hàng, phân quyền nhân viên và đăng ký vận chuyển TMS.
            </p>
            {canManageGlobal && (
              <Button size="sm" className="gap-1.5 shrink-0" onClick={() => { setEditingType(null); setShowTypeDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm loại kho
              </Button>
            )}
          </div>

          <div className="flex gap-3 items-start">
            <Card className="flex-1 min-w-0">
              {loadingTypes ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
                warehouseTypes.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 space-y-2">
                    <Tag className="h-10 w-10 mx-auto opacity-30" />
                    <p className="text-sm">Chưa có loại kho nào</p>
                    {canManageGlobal && <p className="text-xs">Nhấn "Thêm loại kho" để tạo loại kho đầu tiên</p>}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-3 py-2 text-xs">Tên loại kho</TableHead>
                          {canManageGlobal && <TableHead className="px-3 py-2 w-16" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(warehouseTypes as { id: string; value: string; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }[]).map(t => (
                          <TableRow key={t.id}
                            className={`text-sm cursor-pointer ${detailType?.id === t.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                            onClick={() => setDetailType(prev => prev?.id === t.id ? null : t)}>
                            <TableCell className="px-3 py-2 font-medium text-slate-800">{t.value}</TableCell>
                            {canManageGlobal && (
                              <TableCell className="px-2 py-2">
                                <div className="flex items-center gap-0.5">
                                  <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                    onClick={e => { e.stopPropagation(); setEditingType({ id: t.id, value: t.value }); setShowTypeDlg(true) }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                    disabled={deletingType}
                                    onClick={e => { e.stopPropagation(); if (confirm(`Xóa loại kho "${t.value}"?`)) deleteType(t.id, { onSuccess: () => setDetailType(prev => prev?.id === t.id ? null : prev), onError: e2 => toast({ variant: 'destructive', title: 'Không xóa được loại kho', description: apiMsg(e2) }) }) }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )
              }
            </Card>
            {detailType && (
              <Card className="w-60 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailType.value}</span>
                  <button onClick={() => setDetailType(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailType.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailType.created_at ? formatDateTime(detailType.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailType.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailType.updated_at ? formatDateTime(detailType.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Khu vực kho ── */}
        <TabsContent value="zones" className="space-y-3">
          <p className="text-xs text-slate-500">
            Khu vực kho phân chia vị trí vật lý trong từng kho — VD: Kho BV có khu TP (Thành phẩm), NVL, POSM.
          </p>

          {/* Chọn kho */}
          <div className="flex items-center gap-2">
            <Label className="text-xs shrink-0 text-slate-500">Kho:</Label>
            <Select value={effectiveWhId} onValueChange={setSelectedWhId}>
              <SelectTrigger className="h-8 text-sm w-48">
                <SelectValue placeholder="Chọn kho" />
              </SelectTrigger>
              <SelectContent>
                {zoneAccessWh.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManageZone && (
              <Button size="sm" className="gap-1.5 ml-auto" onClick={() => { setEditingZone(null); setShowZoneDlg(true) }}>
                <Plus className="h-4 w-4" /> Thêm khu vực
              </Button>
            )}
          </div>

          <div className="flex gap-3 items-start">
            <Card className="flex-1 min-w-0">
              {!effectiveWhId ? (
                <div className="p-8 text-center text-sm text-slate-400">Chọn kho để xem khu vực</div>
              ) : loadingZones ? (
                <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
              ) : zones.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <MapPin className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-sm">Kho này chưa có khu vực nào</p>
                  {canManageZone && <p className="text-xs">Nhấn "Thêm khu vực" để tạo khu vực đầu tiên</p>}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-3 py-2 text-xs">Mã khu vực</TableHead>
                        <TableHead className="px-3 py-2 text-xs">Tên khu vực</TableHead>
                        <TableHead className="px-3 py-2 text-xs">Loại kho</TableHead>
                        <TableHead className="px-3 py-2 text-xs">Trạng thái</TableHead>
                        {canManageZone && <TableHead className="px-3 py-2 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {zones.map(z => (
                        <TableRow key={z.id}
                          className={`text-sm cursor-pointer ${!z.is_active ? 'opacity-50' : ''} ${detailZone?.id === z.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailZone(prev => prev?.id === z.id ? null : z)}>
                          <TableCell className="px-3 py-2 font-mono font-semibold text-[11px] text-slate-600">{z.code}</TableCell>
                          <TableCell className="px-3 py-2 font-medium text-slate-800">{z.name}</TableCell>
                          <TableCell className="px-3 py-2 text-xs text-slate-500">{z.category ?? <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-3 py-2">
                            <Badge variant={z.is_active ? 'default' : 'secondary'} className="text-xs">
                              {z.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {canManageZone && (
                            <TableCell className="px-2 py-2">
                              <div className="flex items-center gap-0.5">
                                <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors"
                                  onClick={e => { e.stopPropagation(); setEditingZone(z); setShowZoneDlg(true) }}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                                  disabled={deletingZone}
                                  onClick={e => { e.stopPropagation(); handleDeleteZone(z) }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
            {detailZone && (
              <Card className="w-60 shrink-0 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailZone.code} — {detailZone.name}</span>
                  <button onClick={() => setDetailZone(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Loại kho:</span> <span className="font-medium">{detailZone.category ?? '—'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailZone.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailZone.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailZone.created_at ? formatDateTime(detailZone.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailZone.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailZone.updated_at ? formatDateTime(detailZone.updated_at) : '—'}</span></div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Ca nhập ── */}
        <TabsContent value="shifts">
          <p className="text-xs text-slate-500 mb-3">Danh mục ca nhập hàng — dùng khi tạo phiếu nhập kho.</p>
          <MetaTab noun="ca nhập" rows={shifts} loading={loadingShifts} canManage={canManageGlobal}
            onAdd={() => { setEditShift(null); setShowShiftDlg(true) }}
            onEdit={r => { setEditShift(r); setShowShiftDlg(true) }} />
        </TabsContent>

        {/* ── Tab: Tình trạng QA ── */}
        <TabsContent value="qa">
          <p className="text-xs text-slate-500 mb-3">Danh mục tình trạng kiểm định chất lượng — gắn cho từng pallet tồn kho.</p>
          <MetaTab noun="trạng thái QA" rows={qaStatuses} loading={loadingQA} canManage={canManageGlobal}
            onAdd={() => { setEditQA(null); setShowQADlg(true) }}
            onEdit={r => { setEditQA(r); setShowQADlg(true) }} />
        </TabsContent>
      </Tabs>

      {showWhDlg && (
        <WarehouseDialog wh={editingWh} open={showWhDlg} onClose={() => setShowWhDlg(false)} />
      )}
      {showTypeDlg && (
        <TypeDialog type={editingType} open={showTypeDlg} onClose={() => setShowTypeDlg(false)} />
      )}
      {showZoneDlg && (
        <ZoneDialog zone={editingZone} warehouseId={effectiveWhId} warehouses={zoneAccessWh} warehouseTypes={warehouseTypes} open={showZoneDlg} onClose={() => setShowZoneDlg(false)} />
      )}
      {showShiftDlg && (
        <MetaDialog kind="shift" row={editShift} open={showShiftDlg} onClose={() => setShowShiftDlg(false)} />
      )}
      {showQADlg && (
        <MetaDialog kind="qa" row={editQA} open={showQADlg} onClose={() => setShowQADlg(false)} />
      )}
     </div>
    </div>
  )
}
