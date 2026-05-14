import { useMemo, useState } from 'react'
import { MapPin, Search, Plus, Pencil, Trash2, Building2 } from 'lucide-react'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { TableSkeleton }  from '@/components/shared/TableSkeleton'
import { EmptyState }     from '@/components/shared/EmptyState'
import { Input }          from '@/components/ui/input'
import { Button }         from '@/components/ui/button'
import { Label }          from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useLocationsReal, useWarehouses,
  useCreateLocation, useUpdateLocation, useDeleteLocation,
  useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'

const CATEGORY_OPTIONS = ['Thành phẩm', 'NVL', 'POSM']

interface RealLocation {
  id:           string
  location_code:string
  sub_code:     string
  sub_name:     string | null
  sub_type:     string | null
  category:     string | null
  row:          string
  shelf:        string
  max_pallets:  number
  used_slots:   number
  is_active:    boolean
  warehouse:    { id: string; code: string; name: string }
}

interface WhWithCount {
  id:        string
  code:      string
  name:      string
  is_active: boolean
  _count:    { locations: number }
}

const EMPTY_FORM    = { warehouse_id: '', category: '', sub_code: '', sub_name: '', row: '', shelf: '', max_pallets: '' }
const EMPTY_WH_FORM = { code: '', name: '', address: '' }

export default function Locations() {
  const user = useAuthStore(s => s.user)
  const [warehouseId,  setWarehouseId]  = useState(user?.warehouse_id ?? '')
  const [catFilter,    setCatFilter]    = useState('')
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>([])

  // Location add/edit dialog
  const [dialogMode,    setDialogMode]    = useState<'add' | 'edit' | null>(null)
  const [editing,       setEditing]       = useState<RealLocation | null>(null)
  const [form,          setForm]          = useState(EMPTY_FORM)
  const [editIsActive,  setEditIsActive]  = useState(true)
  const [isNewSubCode,  setIsNewSubCode]  = useState(false)
  const [isNewCategory, setIsNewCategory] = useState(false)
  const [formError,     setFormError]     = useState('')
  const [deleteTarget,  setDeleteTarget]  = useState<RealLocation | null>(null)

  // Warehouse management dialog
  const [whDialogOpen,      setWhDialogOpen]      = useState(false)
  const [whForm,            setWhForm]            = useState(EMPTY_WH_FORM)
  const [whError,           setWhError]           = useState('')
  const [whDeleteTarget,    setWhDeleteTarget]    = useState<WhWithCount | null>(null)
  const [whReactivateTarget, setWhReactivateTarget] = useState<WhWithCount | null>(null)

  // Data
  const { data: activeWhRaw = [] }      = useWarehouses(true)
  const { data: allWhRaw = [] }         = useWarehouses(false)
  const { data: allRaw = [] }           = useLocationsReal()
  const { data: raw = [], isLoading }   = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )

  const warehouses   = activeWhRaw as WhWithCount[]
  const allWh        = allWhRaw    as WhWithCount[]
  const allLocations = (allRaw as RealLocation[]).filter(l => l.is_active)
  const showInactive = statusFilter.includes('inactive')
  const locations    = showInactive
    ? (raw as RealLocation[])
    : (raw as RealLocation[]).filter(l => l.is_active)

  // Mutations
  const createLocation  = useCreateLocation()
  const updateLocation  = useUpdateLocation()
  const deleteLocation  = useDeleteLocation()
  const createWarehouse = useCreateWarehouse()
  const updateWarehouse = useUpdateWarehouse()
  const deleteWarehouse = useDeleteWarehouse()

  // ── Table filter ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    return locations.filter(l => {
      if (catFilter && l.category !== catFilter) return false
      if (search && !l.location_code.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [locations, catFilter, search])

  const activeFiltered = filtered.filter(l => l.is_active)
  const totalSlots = activeFiltered.reduce((s, l) => s + l.max_pallets, 0)
  const usedSlots  = activeFiltered.reduce((s, l) => s + l.used_slots,  0)
  const fullCount  = activeFiltered.filter(l => l.max_pallets > 0 && l.used_slots >= l.max_pallets).length

  // ── Form cascaded options ────────────────────────────────────
  const formWhlocs = useMemo(() =>
    allLocations.filter(l => l.warehouse.id === form.warehouse_id),
    [allLocations, form.warehouse_id]
  )
  const formCatOpts = useMemo(() => {
    const cats = formWhlocs.map(l => l.category).filter(Boolean) as string[]
    return [...new Set([...new Set(cats), ...CATEGORY_OPTIONS])]
  }, [formWhlocs])
  const formSubCodeOpts = useMemo(() => {
    const locs = form.category
      ? formWhlocs.filter(l => l.category === form.category)
      : formWhlocs
    return [...new Set(locs.map(l => l.sub_code))]
  }, [formWhlocs, form.category])

  // ── Location code preview ────────────────────────────────────
  const selectedWh = warehouses.find(w => w.id === form.warehouse_id)
  const locationPreview = selectedWh && form.sub_code && form.row
    ? [selectedWh.code, form.sub_code, form.row, form.shelf].filter(Boolean).join('_')
    : null

  // ── Handlers: location ───────────────────────────────────────
  function setField(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, warehouse_id: warehouseId, category: catFilter })
    setEditIsActive(true)
    setIsNewSubCode(false)
    setIsNewCategory(false)
    setFormError('')
    setDialogMode('add')
  }

  function openEdit(loc: RealLocation) {
    setEditing(loc)
    setForm({
      warehouse_id: loc.warehouse.id,
      category:     loc.category ?? '',
      sub_code:     loc.sub_code,
      sub_name:     loc.sub_name ?? '',
      row:          loc.row,
      shelf:        loc.shelf,
      max_pallets:  String(loc.max_pallets),
    })
    setEditIsActive(loc.is_active)
    setIsNewSubCode(false)
    setIsNewCategory(false)
    setFormError('')
    setDialogMode('edit')
  }

  function closeDialog() {
    setDialogMode(null)
    setIsNewSubCode(false)
    setIsNewCategory(false)
  }

  async function handleSave() {
    setFormError('')
    try {
      if (dialogMode === 'add') {
        if (!form.warehouse_id || !form.sub_code || !form.row) {
          setFormError('Kho, khu vực và vị trí là bắt buộc')
          return
        }
        await createLocation.mutateAsync({
          warehouse_id: form.warehouse_id,
          sub_code:     form.sub_code.trim().toUpperCase(),
          sub_name:     form.sub_name.trim() || undefined,
          category:     form.category || undefined,
          row:          form.row.trim(),
          shelf:        form.shelf.trim() || undefined,
          max_pallets:  form.max_pallets ? Number(form.max_pallets) : undefined,
        })
      } else if (editing) {
        await updateLocation.mutateAsync({
          id:          editing.id,
          sub_name:    form.sub_name.trim() || undefined,
          category:    form.category || undefined,
          max_pallets: form.max_pallets ? Number(form.max_pallets) : undefined,
          is_active:   editIsActive,
        })
      }
      closeDialog()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setFormError(msg ?? 'Có lỗi xảy ra')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteLocation.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      setDeleteTarget(null)
    }
  }

  // ── Handlers: warehouse ──────────────────────────────────────
  function openWhDialog() {
    setWhForm(EMPTY_WH_FORM)
    setWhError('')
    setWhDeleteTarget(null)
    setWhDialogOpen(true)
  }

  async function handleCreateWarehouse() {
    setWhError('')
    if (!whForm.code.trim() || !whForm.name.trim()) {
      setWhError('Mã kho và tên kho là bắt buộc')
      return
    }
    try {
      const wh = await createWarehouse.mutateAsync({
        code:    whForm.code.trim().toUpperCase(),
        name:    whForm.name.trim(),
        address: whForm.address.trim() || undefined,
      })
      if (dialogMode === 'add') {
        setField('warehouse_id', (wh as { id: string }).id)
        setField('category', '')
        setField('sub_code', '')
        setIsNewSubCode(false)
        setIsNewCategory(false)
      }
      setWhForm(EMPTY_WH_FORM)
      setWhDialogOpen(false)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setWhError(msg ?? 'Có lỗi xảy ra')
    }
  }

  async function handleDeleteWarehouse() {
    if (!whDeleteTarget) return
    setWhError('')
    try {
      await deleteWarehouse.mutateAsync(whDeleteTarget.id)
      setWhDeleteTarget(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setWhError(msg ?? 'Có lỗi xảy ra')
    }
  }

  async function handleReactivateWarehouse() {
    if (!whReactivateTarget) return
    setWhError('')
    try {
      await updateWarehouse.mutateAsync({ id: whReactivateTarget.id, is_active: true })
      setWhReactivateTarget(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setWhError(msg ?? 'Có lỗi xảy ra')
    }
  }

  const isSaving = createLocation.isPending || updateLocation.isPending

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MapPin className="h-5 w-5 text-slate-500" />
            Vị trí kho
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={openWhDialog} className="gap-1">
              <Building2 className="h-4 w-4" /> Quản lý Kho
            </Button>
            <Button size="sm" onClick={openAdd} className="gap-1">
              <Plus className="h-4 w-4" /> Thêm vị trí
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={warehouseId || '__all__'} onValueChange={v => { setWarehouseId(v === '__all__' ? '' : v); setCatFilter('') }}>
            <SelectTrigger className="h-8 text-sm w-[130px]">
              <SelectValue placeholder="Tất cả kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {warehouses.map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={catFilter || '__all__'} onValueChange={v => setCatFilter(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-8 text-sm w-[130px]">
              <SelectValue placeholder="Loại kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả loại</SelectItem>
              {CATEGORY_OPTIONS.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[120px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm mã vị trí…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <MultiSelectFilter
            label="Trạng thái"
            options={[{ value: 'inactive', label: 'Đã xóa' }]}
            selected={statusFilter}
            onChange={setStatusFilter}
            searchable={false}
          />
        </div>

        {/* Summary */}
        <p className="text-xs text-slate-500 -mt-1">
          <span className="font-medium text-slate-700">{activeFiltered.length}</span> vị trí
          {' '}·{' '}
          <span className="font-medium text-slate-700">{usedSlots}</span>
          <span className="text-slate-400">/{totalSlots}</span> pallet đang dùng
          {fullCount > 0 && (
            <span className="ml-2 text-blue-600 font-medium">· {fullCount} đầy</span>
          )}
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={8} cols={8} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={MapPin} title="Không tìm thấy vị trí" />
        ) : (
          <Table className="min-w-full">
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Kho</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Loại kho</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Khu vực kho</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Vị trí</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">Sức chứa tối đa</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">Đang dùng</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(loc => {
                const isFull    = loc.is_active && loc.max_pallets > 0 && loc.used_slots >= loc.max_pallets
                const isPartial = loc.is_active && loc.used_slots > 0 && !isFull
                const rowCls = !loc.is_active
                  ? 'opacity-50 hover:opacity-80 bg-slate-50'
                  : isFull    ? 'bg-blue-50 hover:bg-blue-100'
                  : isPartial ? 'bg-amber-50 hover:bg-amber-100'
                  : 'hover:bg-slate-50'
                const showSubName = loc.sub_name && loc.sub_name !== loc.sub_code
                return (
                  <TableRow key={loc.id} className={rowCls}>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-600">
                      {loc.warehouse?.name ?? '—'}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-slate-600">
                      {loc.category ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      <span className="font-semibold">{loc.sub_code}</span>
                      {showSubName && <span className="ml-1 text-slate-400">{loc.sub_name}</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <span className="font-mono font-semibold text-[10px]">{loc.location_code}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums font-semibold">
                      {loc.max_pallets} <span className="text-slate-400 font-normal">pl</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums">
                      <span className={isFull ? 'text-blue-600 font-semibold' : isPartial ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                        {loc.used_slots}
                      </span>
                      <span className="text-slate-400">/{loc.max_pallets}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      {!loc.is_active ? (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">
                          Đã xóa
                        </span>
                      ) : (
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                          isFull    ? 'bg-blue-100 text-blue-700'
                          : isPartial ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-500'
                        }`}>
                          {isFull ? 'Đầy' : isPartial ? 'Còn chỗ' : 'Trống'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEdit(loc)}
                          className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-slate-700"
                          title={loc.is_active ? 'Sửa' : 'Kích hoạt lại'}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {loc.is_active && (
                          <button onClick={() => setDeleteTarget(loc)}
                            className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                            disabled={loc.used_slots > 0}
                            title={loc.used_slots > 0 ? 'Vị trí đang có hàng, không thể xóa' : 'Xóa vị trí'}>
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
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={open => !open && closeDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'add' ? 'Thêm vị trí' : 'Sửa vị trí'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* ── Edit: thông tin read-only ── */}
            {dialogMode === 'edit' && editing && (
              <div className="bg-slate-50 rounded px-3 py-2 space-y-0.5">
                <p className="text-[10px] text-slate-500">Vị trí · {editing.warehouse.name}</p>
                <p className="font-mono font-semibold text-sm">{editing.location_code}</p>
              </div>
            )}

            {/* ── Kho (chỉ add) ── */}
            {dialogMode === 'add' && (
              <div>
                <Label className="text-xs">Kho <span className="text-red-500">*</span></Label>
                <Select value={form.warehouse_id || '__none__'}
                  onValueChange={v => {
                    setField('warehouse_id', v === '__none__' ? '' : v)
                    setField('category', '')
                    setField('sub_code', '')
                    setIsNewSubCode(false)
                    setIsNewCategory(false)
                  }}>
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue placeholder="Chọn kho" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Chọn kho</SelectItem>
                    {warehouses.map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* ── Loại kho ── */}
            <div>
              <Label className="text-xs">Loại kho</Label>
              {!isNewCategory ? (
                <Select value={form.category || '__none__'}
                  onValueChange={v => {
                    if (v === '__new_cat__') {
                      setIsNewCategory(true); setField('category', '')
                    } else {
                      setField('category', v === '__none__' ? '' : v)
                      if (dialogMode === 'add') { setField('sub_code', ''); setIsNewSubCode(false) }
                    }
                  }}>
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue placeholder="Chưa phân loại" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Chưa phân loại</SelectItem>
                    {formCatOpts.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                    <SelectItem value="__new_cat__">+ Thêm loại kho mới</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex gap-1.5 mt-1">
                  <Input className="h-8 text-sm flex-1" placeholder="VD: Bao bì"
                    autoFocus value={form.category}
                    onChange={e => setField('category', e.target.value)} />
                  <button onClick={() => { setIsNewCategory(false); setField('category', '') }}
                    className="text-xs text-slate-400 hover:text-slate-700 px-2 whitespace-nowrap">
                    ← Chọn có sẵn
                  </button>
                </div>
              )}
            </div>

            {/* ── Khu vực kho (chỉ add) ── */}
            {dialogMode === 'add' && (
              <div>
                <Label className="text-xs">Khu vực kho <span className="text-red-500">*</span></Label>
                {!isNewSubCode ? (
                  <Select value={form.sub_code || '__none__'}
                    onValueChange={v => {
                      if (v === '__new__') { setIsNewSubCode(true); setField('sub_code', '') }
                      else setField('sub_code', v === '__none__' ? '' : v)
                    }}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue placeholder="Chọn khu vực" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Chọn khu vực</SelectItem>
                      {formSubCodeOpts.map(sc => (
                        <SelectItem key={sc} value={sc}>{sc}</SelectItem>
                      ))}
                      <SelectItem value="__new__">+ Tạo khu vực mới</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex gap-1.5 mt-1">
                    <Input className="h-8 text-sm flex-1 uppercase" placeholder="VD: NVL2"
                      autoFocus value={form.sub_code}
                      onChange={e => setField('sub_code', e.target.value)} />
                    <button onClick={() => { setIsNewSubCode(false); setField('sub_code', '') }}
                      className="text-xs text-slate-400 hover:text-slate-700 px-2 whitespace-nowrap">
                      ← Chọn có sẵn
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Tên khu vực (edit) ── */}
            {dialogMode === 'edit' && (
              <div>
                <Label className="text-xs">Tên khu vực <span className="text-slate-400">(tuỳ chọn)</span></Label>
                <Input className="h-8 text-sm mt-1" placeholder="VD: Nguyên liệu 1"
                  value={form.sub_name} onChange={e => setField('sub_name', e.target.value)} />
                <p className="text-[10px] text-slate-400 mt-0.5">Tên hiển thị — không thay đổi mã vị trí</p>
              </div>
            )}

            {/* ── Vị trí + Tầng (chỉ add) ── */}
            {dialogMode === 'add' && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Vị trí <span className="text-red-500">*</span></Label>
                  <Input className="h-8 text-sm mt-1" placeholder="VD: 01"
                    value={form.row} onChange={e => setField('row', e.target.value)} />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Tầng <span className="text-slate-400">(tuỳ chọn)</span></Label>
                  <Input className="h-8 text-sm mt-1" placeholder="VD: T1"
                    value={form.shelf} onChange={e => setField('shelf', e.target.value)} />
                </div>
              </div>
            )}

            {/* ── Preview mã vị trí ── */}
            {dialogMode === 'add' && locationPreview && (
              <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2">
                <p className="text-[10px] text-blue-500 mb-0.5">Mã vị trí sẽ là</p>
                <p className="font-mono font-semibold text-sm text-blue-700">{locationPreview}</p>
              </div>
            )}

            {/* ── Sức chứa tối đa ── */}
            <div>
              <Label className="text-xs">Sức chứa Pallet tối đa</Label>
              <Input className="h-8 text-sm mt-1" type="number" min="0" placeholder="VD: 4"
                value={form.max_pallets} onChange={e => setField('max_pallets', e.target.value)} />
            </div>

            {/* ── Trạng thái (chỉ edit) ── */}
            {dialogMode === 'edit' && (
              <div className="flex items-center justify-between pt-1 border-t">
                <Label className="text-xs">Trạng thái vị trí</Label>
                <button
                  type="button"
                  onClick={() => setEditIsActive(v => !v)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    editIsActive
                      ? 'bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-600'
                      : 'bg-slate-100 text-slate-500 hover:bg-green-50 hover:text-green-600'
                  }`}>
                  {editIsActive ? 'Đang hoạt động — nhấn để vô hiệu hoá' : 'Đã vô hiệu hoá — nhấn để kích hoạt lại'}
                </button>
              </div>
            )}

            {formError && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1.5">{formError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog}>Hủy</Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Warehouse Management Dialog */}
      <Dialog open={whDialogOpen} onOpenChange={open => { if (!open) { setWhDialogOpen(false); setWhDeleteTarget(null); setWhReactivateTarget(null) } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Quản lý Kho</DialogTitle>
          </DialogHeader>

          {/* Danh sách kho hiện tại */}
          <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
            {allWh.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-3">Chưa có kho nào</p>
            )}
            {allWh.map(w => (
              <div key={w.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded ${w.is_active ? 'bg-slate-50' : 'bg-slate-100 opacity-60'}`}>
                <span className="font-mono text-[10px] font-semibold text-slate-400 w-8 shrink-0">{w.code}</span>
                <span className="flex-1 text-sm">{w.name}</span>
                <span className="text-[10px] text-slate-400 shrink-0">{w._count.locations} vị trí</span>
                {!w.is_active && (
                  whReactivateTarget?.id === w.id ? (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={handleReactivateWarehouse} disabled={updateWarehouse.isPending}
                        className="text-[10px] text-green-600 hover:text-green-700 font-medium px-1.5">
                        {updateWarehouse.isPending ? '…' : 'Lưu'}
                      </button>
                      <button onClick={() => setWhReactivateTarget(null)}
                        className="text-[10px] text-slate-400 hover:text-slate-600 px-1">Hủy</button>
                    </div>
                  ) : (
                    <button onClick={() => { setWhError(''); setWhDeleteTarget(null); setWhReactivateTarget(w) }}
                      className="text-[10px] text-slate-400 hover:text-green-600 underline underline-offset-2 shrink-0 whitespace-nowrap">
                      Kích hoạt lại
                    </button>
                  )
                )}
                {w.is_active && (
                  whDeleteTarget?.id === w.id ? (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={handleDeleteWarehouse} disabled={deleteWarehouse.isPending}
                        className="text-[10px] text-red-600 hover:text-red-700 font-medium px-1.5">
                        {deleteWarehouse.isPending ? '…' : w._count.locations > 0 ? 'Vô hiệu hoá' : 'Xóa'}
                      </button>
                      <button onClick={() => setWhDeleteTarget(null)}
                        className="text-[10px] text-slate-400 hover:text-slate-600 px-1">Hủy</button>
                    </div>
                  ) : (
                    <button onClick={() => { setWhError(''); setWhDeleteTarget(w) }}
                      className="p-1 text-slate-300 hover:text-red-400 shrink-0"
                      title={w._count.locations > 0 ? 'Vô hiệu hoá kho' : 'Xóa kho'}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )
                )}
              </div>
            ))}
          </div>

          {/* Cảnh báo confirm */}
          {whDeleteTarget && (
            <div className={`text-[11px] rounded px-2.5 py-2 border ${
              whDeleteTarget._count.locations > 0
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {whDeleteTarget._count.locations > 0
                ? `Kho "${whDeleteTarget.name}" có ${whDeleteTarget._count.locations} vị trí → sẽ bị vô hiệu hoá, dữ liệu vẫn giữ nguyên.`
                : `Kho "${whDeleteTarget.name}" chưa có vị trí → sẽ bị xóa vĩnh viễn.`}
            </div>
          )}
          {whReactivateTarget && (
            <div className="text-[11px] rounded px-2.5 py-2 border bg-green-50 border-green-200 text-green-800">
              Kích hoạt lại kho "{whReactivateTarget.name}"? Kho sẽ hoạt động trở lại.
            </div>
          )}

          {whError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1.5">{whError}</p>
          )}

          {/* Form thêm kho mới */}
          <div className="border-t pt-3 space-y-2.5">
            <p className="text-xs font-medium text-slate-600">Thêm kho mới</p>
            <div className="flex gap-2">
              <div className="w-20 shrink-0">
                <Label className="text-xs">Mã kho <span className="text-red-500">*</span></Label>
                <Input className="h-8 text-sm mt-1 uppercase" placeholder="BV"
                  value={whForm.code} onChange={e => setWhForm(f => ({ ...f, code: e.target.value }))} />
              </div>
              <div className="flex-1">
                <Label className="text-xs">Tên kho <span className="text-red-500">*</span></Label>
                <Input className="h-8 text-sm mt-1" placeholder="Kho Ba Vì"
                  value={whForm.name} onChange={e => setWhForm(f => ({ ...f, name: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Địa chỉ <span className="text-slate-400">(tuỳ chọn)</span></Label>
              <Input className="h-8 text-sm mt-1" placeholder="Ba Vì, Hà Nội"
                value={whForm.address} onChange={e => setWhForm(f => ({ ...f, address: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setWhDialogOpen(false); setWhDeleteTarget(null) }}>Đóng</Button>
            <Button size="sm" onClick={handleCreateWarehouse} disabled={createWarehouse.isPending}>
              {createWarehouse.isPending ? 'Đang lưu…' : 'Tạo kho'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Location Confirmation */}
      <Dialog open={deleteTarget !== null} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Xóa vị trí?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Xóa vị trí{' '}
            <span className="font-mono font-semibold">{deleteTarget?.location_code}</span>?
            Vị trí sẽ bị ẩn khỏi danh sách.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Hủy</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteLocation.isPending}>
              {deleteLocation.isPending ? 'Đang xóa…' : 'Xóa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
