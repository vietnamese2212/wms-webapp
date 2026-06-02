import { useMemo, useState } from 'react'
import { Tag, Plus, Pencil, Trash2, X, Search, Check, Minus } from 'lucide-react'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useMaterials, useManufacturers, useCreateMaterial, useUpdateMaterial, useDeleteMaterial } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { Material } from '@/types'

type MfRow = { id: string; code: string; name: string | null }

const EMPTY_FORM = {
  material_code: '',
  material_description: '',
  custom_short_name: '',
  category: '',
  unit: '',
  manufacturer_id: '',
  cartons_per_pallet: '',
  cartons_per_pallet_mn: '',
  units_per_carton: '',
  shelf_life_days: '',
  old_code: '',
}

const CAT_COLORS: Record<string, string> = {
  'POSM':       'bg-purple-100 text-purple-700',
  'Thành phẩm': 'bg-blue-100 text-blue-700',
  'NVL':        'bg-green-100 text-green-700',
  'Bao bì':     'bg-amber-100 text-amber-700',
  'Raw':        'bg-orange-100 text-orange-700',
}

function CatBadge({ cat }: { cat: string | null }) {
  if (!cat) return <span className="text-slate-300">—</span>
  const cls = CAT_COLORS[cat] ?? 'bg-slate-100 text-slate-600'
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>{cat}</span>
}

function RowCheck({ checked, indeterminate, onClick }: { checked: boolean; indeterminate?: boolean; onClick: () => void }) {
  return (
    <div
      onClick={e => { e.preventDefault(); e.stopPropagation(); onClick() }}
      className={`w-3.5 h-3.5 border rounded shrink-0 flex items-center justify-center cursor-pointer transition-colors
        ${checked || indeterminate ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white hover:border-blue-400'}`}
    >
      {checked && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
      {!checked && indeterminate && <Minus className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
    </div>
  )
}

export default function Materials() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null

  const [search,       setSearch]       = useState('')
  const [catFilter,    setCatFilter]    = useState<string[]>([])
  const [showInactive, setShowInactive] = useState(false)

  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | null>(null)
  const [editing,    setEditing]    = useState<Material | null>(null)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [editActive, setEditActive] = useState(true)
  const [formError,  setFormError]  = useState('')

  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null)
  const [deleting,     setDeleting]     = useState(false)

  const [selected,       setSelected]       = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting,   setBulkDeleting]   = useState(false)

  const { data: raw = [], isLoading } = useMaterials(undefined)
  const { data: manufacturers = [] }   = useManufacturers()
  const mfMap = useMemo(() =>
    Object.fromEntries((manufacturers as MfRow[]).map(m => [m.id, m])),
    [manufacturers]
  )

  const categories = useMemo(() => {
    const set = new Set<string>()
    ;(raw as Material[]).forEach(m => { if (m.category) set.add(m.category) })
    return [...set].sort()
  }, [raw])

  const createMaterial = useCreateMaterial()
  const updateMaterial = useUpdateMaterial()
  const deleteMaterial = useDeleteMaterial()

  const filtered = useMemo(() => {
    const list = showInactive ? (raw as Material[]) : (raw as Material[]).filter(m => m.is_active)
    return list.filter(m => {
      if (catFilter.length > 0 && !catFilter.includes(m.category ?? '')) return false
      if (search) {
        const s = search.toLowerCase()
        if (
          !m.material_code.toLowerCase().includes(s) &&
          !m.material_description.toLowerCase().includes(s) &&
          !(m.short_name ?? '').toLowerCase().includes(s) &&
          !(m.old_code ?? '').toLowerCase().includes(s)
        ) return false
      }
      return true
    })
  }, [raw, catFilter, search, showInactive])

  const allSelected  = filtered.length > 0 && filtered.every(m => selected.has(m.id))
  const someSelected = selected.size > 0 && !allSelected

  function setField(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setEditActive(true)
    setFormError('')
    setDialogMode('add')
  }

  function openEdit(mat: Material) {
    setEditing(mat)
    setForm({
      material_code:         mat.material_code,
      material_description:  mat.material_description,
      custom_short_name:     mat.custom_short_name ?? '',
      category:              mat.category ?? '',
      unit:                  mat.unit ?? '',
      manufacturer_id:       mat.manufacturer_id ?? '',
      cartons_per_pallet:    mat.cartons_per_pallet != null ? String(mat.cartons_per_pallet) : '',
      cartons_per_pallet_mn: mat.cartons_per_pallet_mn != null ? String(mat.cartons_per_pallet_mn) : '',
      units_per_carton:      mat.units_per_carton != null ? String(mat.units_per_carton) : '',
      shelf_life_days:       mat.shelf_life_days != null ? String(mat.shelf_life_days) : '',
      old_code:              mat.old_code ?? '',
    })
    setEditActive(mat.is_active)
    setFormError('')
    setDialogMode('edit')
  }

  async function handleSave() {
    setFormError('')
    try {
      const payload = {
        material_description:  form.material_description.trim(),
        custom_short_name:     form.custom_short_name.trim() || undefined,
        category:              form.category || undefined,
        unit:                  form.unit || undefined,
        manufacturer_id:       form.manufacturer_id || undefined,
        cartons_per_pallet:    form.cartons_per_pallet    ? Number(form.cartons_per_pallet)    : undefined,
        cartons_per_pallet_mn: form.cartons_per_pallet_mn ? Number(form.cartons_per_pallet_mn) : undefined,
        units_per_carton:      form.units_per_carton      ? Number(form.units_per_carton)      : undefined,
        shelf_life_days:       form.shelf_life_days       ? Number(form.shelf_life_days)       : undefined,
        old_code:              form.old_code.trim() || undefined,
      }
      if (dialogMode === 'add') {
        if (!form.material_code.trim() || !form.material_description.trim()) {
          setFormError('Mã hàng và mô tả là bắt buộc')
          return
        }
        await createMaterial.mutateAsync({ material_code: form.material_code.trim().toUpperCase(), ...payload })
      } else if (editing) {
        await updateMaterial.mutateAsync({ id: editing.id, ...payload, is_active: editActive })
      }
      setDialogMode(null)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setFormError(msg ?? 'Có lỗi xảy ra')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteMaterial.mutateAsync(deleteTarget.id)
      setSelected(s => { const n = new Set(s); n.delete(deleteTarget.id); return n })
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    try {
      await Promise.all([...selected].map(id => deleteMaterial.mutateAsync(id)))
      setSelected(new Set())
      setBulkDeleteOpen(false)
    } finally {
      setBulkDeleting(false)
    }
  }

  function toggleSelect(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map(m => m.id)))
  }

  const saving  = createMaterial.isPending || updateMaterial.isPending
  const canEdit = can(perms, 'materials', 'edit')
  const canDel  = can(perms, 'materials', 'delete')

  const shortNamePreview = (() => {
    const base = form.custom_short_name.trim() || form.material_description.trim() || '(mô tả)'
    const sfx  = form.material_code.trim().slice(-3) || '…'
    return `${base} [${sfx}]`
  })()

  return (
    <div className="flex flex-col h-full">
      {/* Header + filters */}
      <div className="border-b bg-white px-3 py-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-blue-600" />
            <span className="text-xl font-semibold">Mã hàng</span>
            <span className="text-xs text-slate-400 ml-1">{filtered.length}/{(raw as Material[]).length}</span>
          </div>
          {can(perms, 'materials', 'create') && (
            <Button size="sm" onClick={openAdd} className="h-7 text-xs gap-1">
              <Plus className="h-3.5 w-3.5" />Thêm
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-2 items-center">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <Input
              className="pl-7 h-7 text-xs w-44"
              placeholder="Tìm mã, tên…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <MultiSelectFilter
            label="Loại hàng"
            options={categories.map(c => ({ value: c, label: c }))}
            selected={catFilter}
            onChange={setCatFilter}
            searchable
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <div
              onClick={() => setShowInactive(v => !v)}
              className={`w-3.5 h-3.5 border rounded flex items-center justify-center cursor-pointer transition-colors
                ${showInactive ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white hover:border-blue-400'}`}
            >
              {showInactive && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
            </div>
            Hiện đã ẩn
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <div className="overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                {canDel && (
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-8 whitespace-nowrap">
                    <RowCheck checked={allSelected} indeterminate={someSelected} onClick={toggleAll} />
                  </TableHead>
                )}
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Tên rút gọn</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mô tả đầy đủ</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Loại</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">ĐVT</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">PL</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">MN</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">EA/T</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Nhà SX</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">TT</TableHead>
                {(canEdit || canDel) && (
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap w-14" />
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton cols={canDel ? 12 : 11} rows={12} />
              ) : filtered.length === 0 ? (
                <tr><td colSpan={canDel ? 12 : 11}><EmptyState title="Không có mã hàng" /></td></tr>
              ) : filtered.map(mat => (
                <TableRow key={mat.id} className={`${!mat.is_active ? 'opacity-50' : ''} hover:bg-slate-50`}>
                  {canDel && (
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <RowCheck checked={selected.has(mat.id)} onClick={() => toggleSelect(mat.id)} />
                    </TableCell>
                  )}
                  <TableCell className="px-2 py-1 whitespace-nowrap font-mono font-semibold text-[10px]">{mat.material_code}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] max-w-[160px] truncate">{mat.short_name ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] text-slate-500 max-w-[200px] truncate">{mat.material_description}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap"><CatBadge cat={mat.category} /></TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px]">{mat.unit ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">{mat.cartons_per_pallet ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">{mat.cartons_per_pallet_mn ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">{mat.units_per_carton ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap text-[10px]">
                    {mfMap[mat.manufacturer_id ?? '']?.code ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${mat.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {mat.is_active ? 'Đang dùng' : 'Ẩn'}
                    </span>
                  </TableCell>
                  {(canEdit || canDel) && (
                    <TableCell className="px-2 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-0.5">
                        {canEdit && (
                          <button onClick={() => openEdit(mat)} className="p-1 text-slate-400 hover:text-blue-600">
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        {canDel && (
                          <button onClick={() => setDeleteTarget(mat)} className="p-1 text-slate-400 hover:text-red-600">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white rounded-xl px-4 py-2.5 flex items-center gap-4 shadow-2xl">
          <span className="text-xs text-slate-300">{selected.size} mã đã chọn</span>
          {canDel && (
            <button
              onClick={() => setBulkDeleteOpen(true)}
              className="flex items-center gap-1 text-xs text-red-300 hover:text-red-200 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />Xóa tất cả
            </button>
          )}
          <button onClick={() => setSelected(new Set())} className="text-slate-400 hover:text-white ml-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={open => !open && setDialogMode(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{dialogMode === 'add' ? 'Thêm mã hàng' : 'Sửa mã hàng'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1 max-h-[68vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Mã hàng *</Label>
              <Input
                className="col-span-2 h-7 text-xs font-mono"
                value={form.material_code}
                onChange={e => setField('material_code', e.target.value)}
                disabled={dialogMode === 'edit'}
                placeholder="Vd: 220000270"
              />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Mô tả *</Label>
              <Input
                className="col-span-2 h-7 text-xs"
                value={form.material_description}
                onChange={e => setField('material_description', e.target.value)}
                placeholder="Tên đầy đủ của hàng hóa"
              />
            </div>
            <div className="grid grid-cols-3 items-start gap-2">
              <Label className="text-xs text-right pt-1.5">Tên rút gọn</Label>
              <div className="col-span-2">
                <Input
                  className="h-7 text-xs"
                  value={form.custom_short_name}
                  onChange={e => setField('custom_short_name', e.target.value)}
                  placeholder="Để trống = tự tạo từ mô tả"
                />
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">→ {shortNamePreview}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Loại hàng</Label>
              <Select value={form.category || '__none__'} onValueChange={v => setField('category', v === '__none__' ? '' : v)}>
                <SelectTrigger className="col-span-2 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-slate-400">— Chưa phân loại —</SelectItem>
                  {categories.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">ĐVT</Label>
              <Input className="col-span-2 h-7 text-xs" value={form.unit} onChange={e => setField('unit', e.target.value)} placeholder="Thùng, Cái, Kg…" />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Nhà SX</Label>
              <Select value={form.manufacturer_id || '__none__'} onValueChange={v => setField('manufacturer_id', v === '__none__' ? '' : v)}>
                <SelectTrigger className="col-span-2 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-slate-400">— Không chọn —</SelectItem>
                  {(manufacturers as MfRow[]).map(m => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">{m.code}{m.name ? ` – ${m.name}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Thùng/pallet (PL)</Label>
              <Input type="number" min={0} className="col-span-2 h-7 text-xs" value={form.cartons_per_pallet} onChange={e => setField('cartons_per_pallet', e.target.value)} placeholder="Số thùng/pallet" />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Thùng/pallet (MN)</Label>
              <Input type="number" min={0} className="col-span-2 h-7 text-xs" value={form.cartons_per_pallet_mn} onChange={e => setField('cartons_per_pallet_mn', e.target.value)} placeholder="Số thùng/pallet MN" />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">EA/thùng</Label>
              <Input type="number" min={0} className="col-span-2 h-7 text-xs" value={form.units_per_carton} onChange={e => setField('units_per_carton', e.target.value)} placeholder="Số đơn vị/thùng" />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">HSD (ngày)</Label>
              <Input type="number" min={0} className="col-span-2 h-7 text-xs" value={form.shelf_life_days} onChange={e => setField('shelf_life_days', e.target.value)} placeholder="Số ngày hạn sử dụng" />
            </div>
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Mã cũ</Label>
              <Input className="col-span-2 h-7 text-xs font-mono" value={form.old_code} onChange={e => setField('old_code', e.target.value)} placeholder="Mã trước đây (nếu có)" />
            </div>
            {dialogMode === 'edit' && (
              <div className="grid grid-cols-3 items-center gap-2">
                <Label className="text-xs text-right">Trạng thái</Label>
                <label className="col-span-2 flex items-center gap-2 text-xs cursor-pointer">
                  <div
                    onClick={() => setEditActive(v => !v)}
                    className={`w-3.5 h-3.5 border rounded flex items-center justify-center cursor-pointer transition-colors
                      ${editActive ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white hover:border-blue-400'}`}
                  >
                    {editActive && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                  </div>
                  <span>{editActive ? 'Đang dùng' : 'Ẩn'}</span>
                </label>
              </div>
            )}
            {formError && (
              <p className="text-xs text-red-500 text-center bg-red-50 rounded p-2">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogMode(null)} className="text-xs h-7">Hủy</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="text-xs h-7">
              {saving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Xác nhận ẩn mã hàng</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">
            Ẩn mã hàng <span className="font-mono font-semibold">{deleteTarget?.material_code}</span>?<br />
            <span className="text-xs text-slate-400">Hàng hóa sẽ bị đánh dấu ẩn, không xóa khỏi hệ thống.</span>
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} className="text-xs h-7">Hủy</Button>
            <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting} className="text-xs h-7">
              {deleting ? 'Đang ẩn…' : 'Ẩn'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirm */}
      <Dialog open={bulkDeleteOpen} onOpenChange={open => !open && setBulkDeleteOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Ẩn {selected.size} mã hàng</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">
            {selected.size} mã hàng đã chọn sẽ bị ẩn. Tiếp tục?
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkDeleteOpen(false)} className="text-xs h-7">Hủy</Button>
            <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={bulkDeleting} className="text-xs h-7">
              {bulkDeleting ? 'Đang ẩn…' : `Ẩn ${selected.size} mã`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
