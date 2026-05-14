import { useMemo, useState } from 'react'
import { MapPin, Search, Plus, Pencil, Trash2 } from 'lucide-react'
import { TableSkeleton }  from '@/components/shared/TableSkeleton'
import { EmptyState }     from '@/components/shared/EmptyState'
import { Input }          from '@/components/ui/input'
import { Button }         from '@/components/ui/button'
import { Label }          from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useLocationsReal, useWarehouses, useCreateLocation, useUpdateLocation, useDeleteLocation } from '@/api/hooks'
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

const EMPTY_FORM = { warehouse_id: '', sub_code: '', sub_name: '', category: '', row: '', shelf: '', max_pallets: '' }

export default function Locations() {
  const user = useAuthStore(s => s.user)
  const [warehouseId, setWarehouseId] = useState(user?.warehouse_id ?? '')
  const [catFilter,   setCatFilter]   = useState('')
  const [search,      setSearch]      = useState('')

  const [dialogMode,   setDialogMode]   = useState<'add' | 'edit' | null>(null)
  const [editing,      setEditing]      = useState<RealLocation | null>(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [formError,    setFormError]    = useState('')
  const [deleteTarget, setDeleteTarget] = useState<RealLocation | null>(null)

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: raw = [], isLoading } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )
  const locations = (raw as RealLocation[]).filter(l => l.is_active)

  const createLocation = useCreateLocation()
  const updateLocation = useUpdateLocation()
  const deleteLocation = useDeleteLocation()

  const filtered = useMemo(() => {
    return locations.filter(l => {
      if (catFilter && l.category !== catFilter) return false
      if (search && !l.location_code.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [locations, catFilter, search])

  const totalSlots = filtered.reduce((s, l) => s + l.max_pallets, 0)
  const usedSlots  = filtered.reduce((s, l) => s + l.used_slots,  0)
  const fullCount  = filtered.filter(l => l.max_pallets > 0 && l.used_slots >= l.max_pallets).length

  function setField(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, warehouse_id: warehouseId })
    setFormError('')
    setDialogMode('add')
  }

  function openEdit(loc: RealLocation) {
    setEditing(loc)
    setForm({
      warehouse_id: loc.warehouse.id,
      sub_code:     loc.sub_code,
      sub_name:     loc.sub_name ?? '',
      category:     loc.category ?? '',
      row:          loc.row,
      shelf:        loc.shelf,
      max_pallets:  String(loc.max_pallets),
    })
    setFormError('')
    setDialogMode('edit')
  }

  async function handleSave() {
    setFormError('')
    try {
      if (dialogMode === 'add') {
        if (!form.warehouse_id || !form.sub_code || !form.row || !form.shelf) {
          setFormError('Kho, khu vực, hàng và cột là bắt buộc')
          return
        }
        await createLocation.mutateAsync({
          warehouse_id: form.warehouse_id,
          sub_code:     form.sub_code.trim().toUpperCase(),
          sub_name:     form.sub_name.trim() || undefined,
          category:     form.category || undefined,
          row:          form.row.trim(),
          shelf:        form.shelf.trim(),
          max_pallets:  form.max_pallets ? Number(form.max_pallets) : undefined,
        })
      } else if (editing) {
        await updateLocation.mutateAsync({
          id:          editing.id,
          sub_name:    form.sub_name.trim() || undefined,
          category:    form.category || undefined,
          max_pallets: form.max_pallets ? Number(form.max_pallets) : undefined,
        })
      }
      setDialogMode(null)
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
          <Button size="sm" onClick={openAdd} className="gap-1">
            <Plus className="h-4 w-4" /> Thêm vị trí
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={warehouseId || '__all__'} onValueChange={v => { setWarehouseId(v === '__all__' ? '' : v); setCatFilter('') }}>
            <SelectTrigger className="h-8 text-sm w-[130px]">
              <SelectValue placeholder="Tất cả kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {(warehouses as { id: string; name: string }[]).map(w => (
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
        </div>

        {/* Summary */}
        <p className="text-xs text-slate-500 -mt-1">
          <span className="font-medium text-slate-700">{filtered.length}</span> vị trí
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
                const isFull    = loc.max_pallets > 0 && loc.used_slots >= loc.max_pallets
                const isPartial = loc.used_slots > 0 && !isFull
                const rowCls = isFull
                  ? 'bg-blue-50 hover:bg-blue-100'
                  : isPartial
                  ? 'bg-amber-50 hover:bg-amber-100'
                  : 'hover:bg-slate-50'
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
                      {loc.sub_name && <span className="ml-1 text-slate-400">{loc.sub_name}</span>}
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
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                        isFull    ? 'bg-blue-100 text-blue-700'
                        : isPartial ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-500'
                      }`}>
                        {isFull ? 'Đầy' : isPartial ? 'Còn chỗ' : 'Trống'}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEdit(loc)}
                          className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-slate-700">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setDeleteTarget(loc)}
                          className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed"
                          disabled={loc.used_slots > 0}
                          title={loc.used_slots > 0 ? 'Vị trí đang có hàng, không thể xóa' : 'Xóa vị trí'}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
      <Dialog open={dialogMode !== null} onOpenChange={open => !open && setDialogMode(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'add' ? 'Thêm vị trí' : 'Sửa vị trí'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {dialogMode === 'edit' && editing && (
              <div className="bg-slate-50 rounded px-3 py-2 space-y-1">
                <p className="text-[10px] text-slate-500">Vị trí</p>
                <p className="font-mono font-semibold text-sm">{editing.location_code}</p>
                <p className="text-[10px] text-slate-500">{editing.warehouse.name}</p>
              </div>
            )}

            {dialogMode === 'add' && (
              <>
                <div>
                  <Label className="text-xs">Kho <span className="text-red-500">*</span></Label>
                  <Select value={form.warehouse_id || '__none__'} onValueChange={v => setField('warehouse_id', v === '__none__' ? '' : v)}>
                    <SelectTrigger className="h-8 text-sm mt-1">
                      <SelectValue placeholder="Chọn kho" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Chọn kho</SelectItem>
                      {(warehouses as { id: string; name: string }[]).map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">Khu vực <span className="text-red-500">*</span></Label>
                    <Input className="h-8 text-sm mt-1 uppercase" placeholder="VD: TP1"
                      value={form.sub_code} onChange={e => setField('sub_code', e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">Tên khu</Label>
                    <Input className="h-8 text-sm mt-1" placeholder="VD: Khu TP 1"
                      value={form.sub_name} onChange={e => setField('sub_name', e.target.value)} />
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">Hàng <span className="text-red-500">*</span></Label>
                    <Input className="h-8 text-sm mt-1" placeholder="VD: 01"
                      value={form.row} onChange={e => setField('row', e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">Cột <span className="text-red-500">*</span></Label>
                    <Input className="h-8 text-sm mt-1" placeholder="VD: 01"
                      value={form.shelf} onChange={e => setField('shelf', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {dialogMode === 'edit' && (
              <div>
                <Label className="text-xs">Tên khu</Label>
                <Input className="h-8 text-sm mt-1" placeholder="VD: Khu TP 1"
                  value={form.sub_name} onChange={e => setField('sub_name', e.target.value)} />
              </div>
            )}

            <div>
              <Label className="text-xs">Loại kho</Label>
              <Select value={form.category || '__none__'} onValueChange={v => setField('category', v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm mt-1">
                  <SelectValue placeholder="Chưa phân loại" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Chưa phân loại</SelectItem>
                  {CATEGORY_OPTIONS.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Sức chứa Pallet tối đa</Label>
              <Input className="h-8 text-sm mt-1" type="number" min="0" placeholder="VD: 4"
                value={form.max_pallets} onChange={e => setField('max_pallets', e.target.value)} />
            </div>

            {formError && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1.5">{formError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogMode(null)}>Hủy</Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
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
