import { useMemo, useState } from 'react'
import { MapPin, Plus, Pencil, Trash2, Flag, X, Rows3, AlignJustify } from 'lucide-react'
import { formatDateTime } from '@/utils/formatters'
import { omniMatch } from '@/utils/omniSearch'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { TableSkeleton }  from '@/components/shared/TableSkeleton'
import { EmptyState }     from '@/components/shared/EmptyState'
import { Input }          from '@/components/ui/input'
import { Button }         from '@/components/ui/button'
import { Label }          from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useLocationsReal, useWarehouses, useWarehouseTypes, useWarehouseZones,
  useCreateLocation, useUpdateLocation, useDeleteLocation,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'


interface RealLocation {
  id:           string
  location_code:string
  sub_code:     string
  sub_name:     string | null
  sub_type:     string | null
  category:     string | null
  row:          string
  shelf:        string
  max_pallets:        number
  used_slots:         number
  is_active:          boolean
  requires_stocktake: boolean
  warehouse:          { id: string; code: string; name: string }
  created_at?:        string
  updated_at?:        string
  created_by?:        string | null
  updated_by?:        string | null
}

interface WhWithCount {
  id:        string
  code:      string
  name:      string
  is_active: boolean
  _count:    { locations: number }
}

const EMPTY_FORM = { warehouse_id: '', category: '', sub_code: '', sub_name: '', row: '', shelf: '', max_pallets: '' }

const LOC_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'wh',      label: 'Kho',             w: 160 },
  { id: 'cat',     label: 'Loại kho',        w: 120 },
  { id: 'zone',    label: 'Khu vực kho',     w: 150 },
  { id: 'loc',     label: 'Vị trí',          w: 160 },
  { id: 'max',     label: 'Sức chứa tối đa', w: 110, align: 'right' },
  { id: 'used',    label: 'Đang dùng',       w: 100, align: 'right' },
  { id: 'status',  label: 'Trạng thái',      w: 100 },
  { id: 'actions', label: '',                w: 64 },
]
const LOC_COL_DEFAULTS = LOC_COLS.map(c => c.w)

export default function Locations() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const [warehouseId,  setWarehouseId]  = useState(user?.warehouse_id ?? user?.warehouse_ids?.[0] ?? '')
  const [catFilter,    setCatFilter]    = useState('')
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [flagFilter,   setFlagFilter]   = useState(false)
  const { widths: colW, startResize, totalWidth } = useColumnResize('locations_col_widths', LOC_COL_DEFAULTS)
  const [dense, setDense] = useState(() => localStorage.getItem('locations_density') !== 'comfortable')
  function toggleDensity() {
    setDense(d => { localStorage.setItem('locations_density', d ? 'comfortable' : 'compact'); return !d })
  }

  // Location add/edit dialog
  const [dialogMode,    setDialogMode]    = useState<'add' | 'edit' | null>(null)
  const [editing,       setEditing]       = useState<RealLocation | null>(null)
  const [form,          setForm]          = useState(EMPTY_FORM)
  const [editIsActive,         setEditIsActive]         = useState(true)
  const [editRequiresStocktake, setEditRequiresStocktake] = useState(false)
  const [formError,     setFormError]     = useState('')
  const [deleteTarget,  setDeleteTarget]  = useState<RealLocation | null>(null)
  const [selectedLoc,   setSelectedLoc]   = useState<RealLocation | null>(null)

  // Data
  const { data: whTypes = [] }          = useWarehouseTypes()
  const categoryOptions                  = whTypes.map(t => t.value)
  const { data: formZones = [] }        = useWarehouseZones(form.warehouse_id || undefined)
  const { data: activeWhRaw = [] }      = useWarehouses(true)
  const { data: allRaw = [] }           = useLocationsReal()
  const { data: raw = [], isLoading }   = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )

  const allowedLocWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids)
    : null
  const warehouses   = (activeWhRaw as WhWithCount[]).filter(w => !allowedLocWhIds || allowedLocWhIds.has(w.id))
  const allLocations = (allRaw as RealLocation[]).filter(l => l.is_active)
  const showInactive = statusFilter.includes('inactive')
  const locations    = showInactive
    ? (raw as RealLocation[])
    : (raw as RealLocation[]).filter(l => l.is_active)

  // Mutations
  const createLocation  = useCreateLocation()
  const updateLocation  = useUpdateLocation()
  const deleteLocation  = useDeleteLocation()

  // ── Table filter ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    return locations.filter(l => {
      if (catFilter && l.category !== catFilter) return false
      if (!omniMatch([l.location_code, l.sub_code, l.sub_name, l.sub_type, l.category, l.row, l.shelf, l.warehouse?.code, l.warehouse?.name], search)) return false
      if (flagFilter && !l.requires_stocktake) return false
      return true
    })
  }, [locations, catFilter, search, flagFilter])

  const activeFiltered = filtered.filter(l => l.is_active)
  const totalSlots = activeFiltered.reduce((s, l) => s + l.max_pallets, 0)
  const usedSlots  = activeFiltered.reduce((s, l) => s + l.used_slots,  0)
  const fullCount  = activeFiltered.filter(l => l.max_pallets > 0 && l.used_slots >= l.max_pallets).length

  // ── Form cascaded options ────────────────────────────────────
  const formCatOpts = categoryOptions
  const filteredZones = useMemo(() =>
    formZones.filter(z => z.is_active),
    [formZones]
  )

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
    setEditRequiresStocktake(loc.requires_stocktake ?? false)
    setFormError('')
    setDialogMode('edit')
  }

  function closeDialog() {
    setDialogMode(null)
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
          id:                 editing.id,
          sub_name:           form.sub_name.trim() || undefined,
          category:           form.category || undefined,
          max_pallets:        form.max_pallets ? Number(form.max_pallets) : undefined,
          is_active:          editIsActive,
          requires_stocktake: editRequiresStocktake,
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

  const isSaving = createLocation.isPending || updateLocation.isPending

  // ─── Filter chip bar (Manhattan) ───
  const filterDefs: FilterDef[] = [
    { key: 'warehouse', label: 'Kho', type: 'single', options: warehouses.map(w => ({ value: w.id, label: w.name })), value: warehouseId || '', allLabel: 'Tất cả kho',
      onChange: v => { setWarehouseId(v); setCatFilter('') } },
    { key: 'category', label: 'Loại kho', type: 'single', options: categoryOptions.map((c: string) => ({ value: c, label: c })), value: catFilter, allLabel: 'Tất cả loại',
      onChange: v => setCatFilter(v) },
    { key: 'status', label: 'Trạng thái', type: 'multi', options: [{ value: 'inactive', label: 'Đã xóa' }], selected: statusFilter, searchable: false,
      onChange: setStatusFilter },
    { key: 'flag', label: 'Cần check hàng ngày', type: 'multi', options: [{ value: 'flag', label: 'Cần check hàng ngày' }], selected: flagFilter ? ['flag'] : [], searchable: false,
      onChange: v => setFlagFilter(v.includes('flag')) },
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-slate-500" /> Vị trí kho
          </span>
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm vị trí, kho, loại, hàng/kệ…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {can(perms, 'locations', 'create') && (
            <Button size="sm" onClick={openAdd} className="h-7 text-xs gap-1">
              <Plus className="h-3.5 w-3.5" /> Thêm vị trí
            </Button>
          )}
        </div>

        {/* Filter chip bar (desktop) */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
        </div>
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={[
        { label: 'Vị trí', value: activeFiltered.length },
        { label: 'Pallet đang dùng', value: usedSlots },
        { label: 'Sức chứa', value: totalSlots },
        { label: 'Đầy', value: fullCount, accent: fullCount > 0 },
      ]} />

      {/* Table + Detail panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto pb-20 lg:pb-4">
          {isLoading ? (
            <div className="p-4"><TableSkeleton rows={8} cols={8} /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={MapPin} title="Không tìm thấy vị trí" />
          ) : (
            <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
              <colgroup>
                {colW.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  {LOC_COLS.map((c, i) => (
                    <TableHead key={c.id}
                      className={`relative px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                      {c.label}
                      {i > 0 && c.id !== 'actions' && (
                        <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                          className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70"
                          title="Kéo để chỉnh độ rộng cột" />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(loc => {
                  const isFull    = loc.is_active && loc.max_pallets > 0 && loc.used_slots >= loc.max_pallets
                  const isPartial = loc.is_active && loc.used_slots > 0 && !isFull
                  const isSelected = selectedLoc?.id === loc.id
                  const rowCls = !loc.is_active
                    ? 'opacity-50 hover:opacity-80 bg-slate-50 cursor-pointer'
                    : isFull    ? `bg-blue-50 hover:bg-blue-100 cursor-pointer${isSelected ? ' ring-1 ring-inset ring-blue-400' : ''}`
                    : isPartial ? `bg-amber-50 hover:bg-amber-100 cursor-pointer${isSelected ? ' ring-1 ring-inset ring-amber-400' : ''}`
                    : `hover:bg-slate-50 cursor-pointer${isSelected ? ' bg-slate-100' : ''}`
                  const showSubName = loc.sub_name && loc.sub_name !== loc.sub_code
                  return (
                    <TableRow key={loc.id} className={`${rowCls} ${dense ? '' : '[&_td]:py-2.5'}`} onClick={() => setSelectedLoc(prev => prev?.id === loc.id ? null : loc)}>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-600 sticky left-0 z-10 bg-inherit">
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
                        {loc.requires_stocktake && (
                          <Flag className="inline-block ml-1 h-3 w-3 text-red-500 shrink-0" style={{ verticalAlign: 'middle' }} />
                        )}
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
                          {can(perms, 'locations', 'edit') && (
                            <button onClick={e => { e.stopPropagation(); openEdit(loc) }}
                              className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-slate-700"
                              title={loc.is_active ? 'Sửa' : 'Kích hoạt lại'}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {loc.is_active && can(perms, 'locations', 'delete') && (
                            <button onClick={e => { e.stopPropagation(); setDeleteTarget(loc) }}
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

        {/* Detail panel */}
        {selectedLoc && (
          <div className="w-64 shrink-0 border-l bg-white overflow-y-auto pb-20 lg:pb-4">
            <div className="sticky top-0 bg-white border-b px-3 py-2 flex items-center justify-between z-10">
              <span className="text-xs font-semibold text-slate-700 truncate">{selectedLoc.location_code}</span>
              <button onClick={() => setSelectedLoc(null)} className="text-slate-400 hover:text-slate-600 p-0.5 shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-3 py-3 space-y-2 text-xs">
              <div><span className="text-slate-400">Kho:</span> <span className="font-medium">{selectedLoc.warehouse?.name ?? '—'}</span></div>
              <div><span className="text-slate-400">Loại kho:</span> <span className="font-medium">{selectedLoc.category ?? '—'}</span></div>
              <div><span className="text-slate-400">Khu vực:</span> <span className="font-medium">{selectedLoc.sub_code}{selectedLoc.sub_name && selectedLoc.sub_name !== selectedLoc.sub_code ? ` — ${selectedLoc.sub_name}` : ''}</span></div>
              <div><span className="text-slate-400">Loại vị trí:</span> <span className="font-medium">{selectedLoc.sub_type ?? '—'}</span></div>
              <div><span className="text-slate-400">Hàng / Tầng:</span> <span className="font-mono font-semibold">{selectedLoc.row}{selectedLoc.shelf ? ` / ${selectedLoc.shelf}` : ''}</span></div>
              <div><span className="text-slate-400">Sức chứa:</span> <span className="font-semibold">{selectedLoc.max_pallets} pallet</span></div>
              <div><span className="text-slate-400">Đang dùng:</span> <span className="font-semibold">{selectedLoc.used_slots} pallet</span></div>
              <div><span className="text-slate-400">Cần check hàng ngày:</span> <span className="font-medium">{selectedLoc.requires_stocktake ? 'Có' : 'Không'}</span></div>
              <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{selectedLoc.is_active ? 'Hoạt động' : 'Đã xóa'}</span></div>
              <div className="border-t pt-2 mt-2 space-y-1.5">
                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Thông tin tạo/sửa</p>
                <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{selectedLoc.created_by ?? '—'}</span></div>
                <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{selectedLoc.created_at ? formatDateTime(selectedLoc.created_at) : '—'}</span></div>
                <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{selectedLoc.updated_by ?? '—'}</span></div>
                <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{selectedLoc.updated_at ? formatDateTime(selectedLoc.updated_at) : '—'}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer đếm bản ghi */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {filtered.length > 0 ? `1–${filtered.length} / ${filtered.length} vị trí` : '0 vị trí'}
      </div>
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
                <WarehouseSingleSelect
                  warehouses={warehouses}
                  value={form.warehouse_id}
                  onChange={v => { setField('warehouse_id', v); setField('category', ''); setField('sub_code', '') }}
                  placeholder="Chọn kho"
                  triggerClassName="h-8 mt-1"
                />
              </div>
            )}

            {/* ── Loại kho ── */}
            <div>
              <Label className="text-xs">Loại kho</Label>
              <Select value={form.category || '__none__'}
                onValueChange={v => {
                  setField('category', v === '__none__' ? '' : v)
                  if (dialogMode === 'add') setField('sub_code', '')
                }}>
                <SelectTrigger className="h-8 text-sm mt-1">
                  <SelectValue placeholder="Chưa phân loại" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Chưa phân loại</SelectItem>
                  {formCatOpts.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dialogMode === 'add' && (
                <p className="text-[10px] text-slate-400 mt-0.5">Quản lý loại kho tại Cài đặt WMS → Loại kho</p>
              )}
            </div>

            {/* ── Khu vực kho (chỉ add) ── */}
            {dialogMode === 'add' && (
              <div>
                <Label className="text-xs">Khu vực kho <span className="text-red-500">*</span></Label>
                <Select value={form.sub_code || '__none__'}
                  onValueChange={v => {
                    if (v === '__none__') { setField('sub_code', ''); setField('sub_name', '') }
                    else {
                      const z = filteredZones.find(z => z.code === v)
                      setField('sub_code', v)
                      setField('sub_name', z?.name ?? '')
                      if (z?.category) setField('category', z.category)
                    }
                  }}>
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue placeholder="Chọn khu vực" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Chọn khu vực</SelectItem>
                    {filteredZones.map(z => (
                      <SelectItem key={z.code} value={z.code}>{z.code} — {z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.warehouse_id && filteredZones.length === 0 && (
                  <p className="text-[10px] text-amber-600 mt-0.5">Kho này chưa có khu vực. Tạo tại Cài đặt WMS → Khu vực kho.</p>
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

            {/* ── Trạng thái + Kiểm kê hàng ngày (chỉ edit) ── */}
            {dialogMode === 'edit' && (
              <div className="space-y-2 pt-1 border-t">
                <div className="flex items-center justify-between">
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
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editRequiresStocktake}
                    onChange={e => setEditRequiresStocktake(e.target.checked)}
                    className="h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className="text-xs text-slate-600">Cần kiểm kê hàng ngày</span>
                </label>
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
