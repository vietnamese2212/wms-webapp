import { useMemo, useState } from 'react'
import { Tag, Plus, Pencil, Trash2, X, Search, Check, Minus, PlusCircle } from 'lucide-react'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import {
  useMaterials, useWarehouses, useWarehouseTypes, useTransportCompanies,
  useCreateMaterial, useUpdateMaterial, useDeleteMaterial,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { Material, WarehousePalletOverride, SupplierShelfLifeOverride } from '@/types'

type WhRow = { id: string; code: string; name: string }

// ── Shared mini checkbox ─────────────────────────────────────────────────────
function RowCheck({ checked, indeterminate, onClick }: {
  checked: boolean; indeterminate?: boolean; onClick: () => void
}) {
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

function CatBadge({ cat }: { cat: string | null }) {
  if (!cat) return <span className="text-slate-300">—</span>
  const colors: Record<string, string> = {
    'POSM':       'bg-purple-100 text-purple-700',
    'Thành phẩm': 'bg-blue-100 text-blue-700',
    'NVL':        'bg-green-100 text-green-700',
    'Bao bì':     'bg-amber-100 text-amber-700',
    'Raw':        'bg-orange-100 text-orange-700',
  }
  const cls = colors[cat] ?? 'bg-slate-100 text-slate-600'
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>{cat}</span>
}

// ── Detail field row ────────────────────────────────────────────────────────
function DRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <span className="font-medium text-slate-700 break-words min-w-0">{value ?? <span className="text-slate-300">—</span>}</span>
    </div>
  )
}

// ── Form state ───────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  material_code: '',
  material_description: '',
  custom_short_name: '',
  category: '',
  unit: '',
  cartons_per_pallet: '',
  units_per_carton: '',
  weight_kg: '',
  shelf_life_days: '',
  old_code: '',
}

const SHELF_LIFE_CATS = ['Thành phẩm', 'NVL']

// ── Main component ───────────────────────────────────────────────────────────
export default function Materials() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canEdit = can(perms, 'materials', 'edit')
  const canDel  = can(perms, 'materials', 'delete')

  // Filters
  const [search,       setSearch]       = useState('')
  const [catFilter,    setCatFilter]    = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<string[]>(['active'])

  // Detail sheet
  const [detailMat, setDetailMat] = useState<Material | null>(null)

  // Add/Edit dialog
  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | null>(null)
  const [editing,    setEditing]    = useState<Material | null>(null)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [editActive,       setEditActive]       = useState(true)
  const [overrides,        setOverrides]        = useState<{ warehouse_id: string; cartons_per_pallet: string }[]>([])
  const [supplierOverrides,setSupplierOverrides] = useState<{ transport_company_id: string; shelf_life_days: string }[]>([])
  const [formError,        setFormError]        = useState('')

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null)
  const [deleting,     setDeleting]     = useState(false)

  // Multi-select
  const [selected,       setSelected]       = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting,   setBulkDeleting]   = useState(false)

  // Data
  const { data: raw = [], isLoading }    = useMaterials(undefined)
  const { data: warehouseTypes = [] }    = useWarehouseTypes()
  const { data: warehousesRaw = [] }     = useWarehouses(true)
  const { data: allCompanies = [] }      = useTransportCompanies(true)
  const warehouses = warehousesRaw as WhRow[]
  const nccList = allCompanies.filter(c => c.type === 'NCC')

  const whMap = useMemo(() =>
    Object.fromEntries(warehouses.map(w => [w.id, w])),
    [warehouses]
  )
  const categories = useMemo(() =>
    warehouseTypes.map(t => t.value).sort(),
    [warehouseTypes]
  )

  // Mutations
  const createMaterial = useCreateMaterial()
  const updateMaterial = useUpdateMaterial()
  const deleteMaterial = useDeleteMaterial()

  // Filtered list
  const filtered = useMemo(() => {
    const showActive   = statusFilter.includes('active')   || statusFilter.length === 0
    const showInactive = statusFilter.includes('inactive') || statusFilter.length === 0
    return (raw as Material[]).filter(m => {
      if (m.is_active  && !showActive)   return false
      if (!m.is_active && !showInactive) return false
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
  }, [raw, catFilter, search, statusFilter])

  const allSelected  = filtered.length > 0 && filtered.every(m => selected.has(m.id))
  const someSelected = selected.size > 0 && !allSelected

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setField(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function validate(): string | null {
    if (dialogMode === 'add' && !form.material_code.trim()) return 'Mã hàng là bắt buộc'
    if (!form.material_description.trim()) return 'Mô tả là bắt buộc'
    if (!form.category) return 'Loại hàng là bắt buộc'
    if (!form.unit) return 'ĐVT là bắt buộc (CAR hoặc EA)'
    if (!form.cartons_per_pallet) return 'Thùng/pallet là bắt buộc'
    if (!form.weight_kg) return 'Khối lượng (KG) là bắt buộc'
    if (SHELF_LIFE_CATS.includes(form.category) && !form.shelf_life_days)
      return `HSD (ngày) là bắt buộc cho ${form.category}`
    for (const ov of overrides) {
      if (!ov.warehouse_id || !ov.cartons_per_pallet) return 'Điền đủ kho và số thùng cho mọi ngoại lệ'
    }
    return null
  }

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOverrides([])
    setSupplierOverrides([])
    setEditActive(true)
    setFormError('')
    setDialogMode('add')
  }

  function openEdit(mat: Material) {
    setEditing(mat)
    setForm({
      material_code:        mat.material_code,
      material_description: mat.material_description,
      custom_short_name:    mat.custom_short_name ?? '',
      category:             mat.category ?? '',
      unit:                 mat.unit ?? '',
      cartons_per_pallet:   mat.cartons_per_pallet != null ? String(mat.cartons_per_pallet) : '',
      units_per_carton:     mat.units_per_carton   != null ? String(mat.units_per_carton)   : '',
      weight_kg:            mat.weight_kg           != null ? String(mat.weight_kg)           : '',
      shelf_life_days:      mat.shelf_life_days     != null ? String(mat.shelf_life_days)     : '',
      old_code:             mat.old_code ?? '',
    })
    setOverrides(
      (mat.warehouse_pallet_overrides ?? []).map(o => ({
        warehouse_id: o.warehouse_id,
        cartons_per_pallet: String(o.cartons_per_pallet),
      }))
    )
    setSupplierOverrides(
      (mat.supplier_shelf_life_overrides ?? []).map(o => ({
        transport_company_id: o.transport_company_id,
        shelf_life_days: String(o.shelf_life_days),
      }))
    )
    setEditActive(mat.is_active)
    setFormError('')
    setDialogMode('edit')
  }

  async function handleSave() {
    const err = validate()
    if (err) { setFormError(err); return }
    setFormError('')
    try {
      const palletOverrides: WarehousePalletOverride[] = overrides
        .filter(o => o.warehouse_id && o.cartons_per_pallet)
        .map(o => ({ warehouse_id: o.warehouse_id, cartons_per_pallet: Number(o.cartons_per_pallet) }))

      const supplierHsdOverrides: SupplierShelfLifeOverride[] = supplierOverrides
        .filter(o => o.transport_company_id && o.shelf_life_days)
        .map(o => ({ transport_company_id: o.transport_company_id, shelf_life_days: Number(o.shelf_life_days) }))

      const payload = {
        material_description:          form.material_description.trim(),
        custom_short_name:             form.custom_short_name.trim() || undefined,
        category:                      form.category || undefined,
        unit:                          form.unit || undefined,
        cartons_per_pallet:            Number(form.cartons_per_pallet),
        units_per_carton:              form.units_per_carton ? Number(form.units_per_carton) : undefined,
        weight_kg:                     Number(form.weight_kg),
        shelf_life_days:               form.shelf_life_days ? Number(form.shelf_life_days) : undefined,
        old_code:                      form.old_code.trim() || undefined,
        warehouse_pallet_overrides:    palletOverrides,
        supplier_shelf_life_overrides: supplierHsdOverrides,
      }
      if (dialogMode === 'add') {
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
      if (detailMat?.id === deleteTarget.id) setDetailMat(null)
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

  // Override helpers
  function addOverride() {
    setOverrides(v => [...v, { warehouse_id: '', cartons_per_pallet: '' }])
  }
  function removeOverride(i: number) {
    setOverrides(v => v.filter((_, idx) => idx !== i))
  }
  function setOverrideField(i: number, k: 'warehouse_id' | 'cartons_per_pallet', v: string) {
    setOverrides(prev => prev.map((o, idx) => idx === i ? { ...o, [k]: v } : o))
  }

  // Already-selected warehouse_ids to prevent duplicate
  const usedWhIds = new Set(overrides.map(o => o.warehouse_id).filter(Boolean))

  // Supplier HSD override helpers
  function addSupplierOverride() {
    setSupplierOverrides(v => [...v, { transport_company_id: '', shelf_life_days: '' }])
  }
  function removeSupplierOverride(i: number) {
    setSupplierOverrides(v => v.filter((_, idx) => idx !== i))
  }
  function setSupplierOverrideField(i: number, k: 'transport_company_id' | 'shelf_life_days', v: string) {
    setSupplierOverrides(prev => prev.map((o, idx) => idx === i ? { ...o, [k]: v } : o))
  }
  const usedNccIds = new Set(supplierOverrides.map(o => o.transport_company_id).filter(Boolean))

  const saving = createMaterial.isPending || updateMaterial.isPending

  const shortNamePreview = (() => {
    const base = form.custom_short_name.trim() || form.material_description.trim() || '(mô tả)'
    const sfx  = form.material_code.trim().slice(-3) || '…'
    return `${base} [${sfx}]`
  })()

  const colCount = (canDel ? 1 : 0) + 9 + 2 + (canEdit || canDel ? 1 : 0)

  return (
    <div className="flex flex-col h-full">
      {/* ── Header + Filters ──────────────────────────────────────────── */}
      <div className="border-b bg-white px-3 py-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-blue-600" />
            <span className="text-xl font-semibold">Mã hàng</span>
            <span className="text-xs text-slate-400">{filtered.length}/{(raw as Material[]).length}</span>
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
            <Input className="pl-7 h-7 text-xs w-44" placeholder="Tìm mã, tên…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <MultiSelectFilter
            label="Loại hàng"
            options={categories.map(c => ({ value: c, label: c }))}
            selected={catFilter}
            onChange={setCatFilter}
            searchable
          />
          <MultiSelectFilter
            label="Trạng thái"
            options={[
              { value: 'active',   label: 'Đang dùng' },
              { value: 'inactive', label: 'Đã ẩn'     },
            ]}
            selected={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
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
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">EA/T</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap text-right">KG</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">TT</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Tạo</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Sửa</TableHead>
                {(canEdit || canDel) && (
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap w-14" />
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton cols={colCount} rows={12} />
              ) : filtered.length === 0 ? (
                <tr><td colSpan={colCount}><EmptyState title="Không có mã hàng" /></td></tr>
              ) : filtered.map(mat => {
                const hasOverrides = (mat.warehouse_pallet_overrides?.length ?? 0) > 0
                return (
                  <TableRow
                    key={mat.id}
                    className={`${!mat.is_active ? 'opacity-50' : ''} hover:bg-slate-50 cursor-pointer ${detailMat?.id === mat.id ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
                    onClick={() => setDetailMat(detailMat?.id === mat.id ? null : mat)}
                  >
                    {canDel && (
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <RowCheck checked={selected.has(mat.id)} onClick={() => toggleSelect(mat.id)} />
                      </TableCell>
                    )}
                    <TableCell className="px-2 py-1 whitespace-nowrap font-mono font-semibold text-[10px]">{mat.material_code}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] max-w-[160px] truncate">
                      {mat.short_name ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] text-slate-500 max-w-[200px] truncate">
                      {mat.material_description}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap"><CatBadge cat={mat.category} /></TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px]">{mat.unit ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">
                      {mat.cartons_per_pallet ?? <span className="text-slate-300">—</span>}
                      {hasOverrides && <span className="text-[8px] text-blue-500 ml-0.5">*</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">
                      {mat.units_per_carton ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">
                      {mat.weight_kg ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${mat.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {mat.is_active ? 'Đang dùng' : 'Ẩn'}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {mat.created_at ? (
                        <div className="leading-tight">
                          <div className="text-[10px] text-slate-600">{mat.created_by ?? <span className="text-slate-300">—</span>}</div>
                          <div className="text-[9px] text-slate-400">{formatTimestampDate(mat.created_at, true)}</div>
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {mat.updated_at ? (
                        <div className="leading-tight">
                          <div className="text-[10px] text-slate-600">{mat.updated_by ?? <span className="text-slate-300">—</span>}</div>
                          <div className="text-[9px] text-slate-400">{formatTimestampDate(mat.updated_at, true)}</div>
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    {(canEdit || canDel) && (
                      <TableCell className="px-2 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-0.5">
                          {canEdit && (
                            <button onClick={e => { e.stopPropagation(); openEdit(mat) }} className="p-1 text-slate-400 hover:text-blue-600">
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          {canDel && (
                            <button onClick={e => { e.stopPropagation(); setDeleteTarget(mat) }} className="p-1 text-slate-400 hover:text-red-600">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
      </div>

      {/* ── Bulk action bar ────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white rounded-xl px-4 py-2.5 flex items-center gap-4 shadow-2xl">
          <span className="text-xs text-slate-300">{selected.size} mã đã chọn</span>
          {canDel && (
            <button onClick={() => setBulkDeleteOpen(true)} className="flex items-center gap-1 text-xs text-red-300 hover:text-red-200 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />Ẩn tất cả
            </button>
          )}
          <button onClick={() => setSelected(new Set())} className="text-slate-400 hover:text-white ml-1">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Detail Sheet ───────────────────────────────────────────────── */}
      <Sheet open={!!detailMat} onOpenChange={open => !open && setDetailMat(null)}>
        <SheetContent side="right" className="w-80 sm:w-96 p-0 flex flex-col">
          {detailMat && (
            <>
              <SheetHeader className="px-4 py-3 border-b bg-slate-50 shrink-0">
                <div className="flex items-start justify-between gap-2 pr-6">
                  <div>
                    <SheetTitle className="text-sm font-mono">{detailMat.material_code}</SheetTitle>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{detailMat.material_description}</p>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${detailMat.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {detailMat.is_active ? 'Đang dùng' : 'Ẩn'}
                  </span>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {/* Tên */}
                {detailMat.short_name && (
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 mb-1">Tên rút gọn</p>
                    <p className="text-xs text-slate-700">{detailMat.short_name}</p>
                    {detailMat.custom_short_name && (
                      <p className="text-[10px] text-slate-400 mt-0.5">tùy chỉnh: {detailMat.custom_short_name}</p>
                    )}
                  </div>
                )}

                {/* Phân loại */}
                <div>
                  <p className="text-[10px] font-medium text-slate-500 mb-1.5">Phân loại</p>
                  <div className="space-y-0">
                    <DRow label="Loại hàng"  value={<CatBadge cat={detailMat.category} />} />
                    <DRow label="ĐVT"        value={detailMat.unit} />
                  </div>
                </div>

                {/* Quy cách */}
                <div>
                  <p className="text-[10px] font-medium text-slate-500 mb-1.5">Quy cách</p>
                  <div className="space-y-0">
                    <DRow label="Thùng/pallet (PL)" value={detailMat.cartons_per_pallet != null ? `${detailMat.cartons_per_pallet} thùng` : null} />
                    <DRow label="EA/thùng"           value={detailMat.units_per_carton  != null ? `${detailMat.units_per_carton} EA`     : null} />
                    <DRow label="Khối lượng"         value={detailMat.weight_kg         != null ? `${detailMat.weight_kg} kg`            : null} />
                    <DRow label="HSD"                value={detailMat.shelf_life_days   != null ? `${detailMat.shelf_life_days} ngày`     : null} />
                  </div>
                </div>

                {/* Ngoại lệ theo kho */}
                {(detailMat.warehouse_pallet_overrides?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 mb-1.5">Thùng/pallet theo kho</p>
                    <div className="space-y-1">
                      {(detailMat.warehouse_pallet_overrides ?? []).map((ov, i) => (
                        <div key={i} className="flex justify-between text-xs py-0.5 border-b border-slate-100">
                          <span className="text-slate-500">{whMap[ov.warehouse_id]?.code ?? ov.warehouse_id}</span>
                          <span className="font-semibold tabular-nums">{ov.cartons_per_pallet} thùng</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* HSD ngoại lệ NCC */}
                {(detailMat.supplier_shelf_life_overrides?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-slate-500 mb-1.5">HSD theo NCC</p>
                    <div className="space-y-1">
                      {(detailMat.supplier_shelf_life_overrides ?? []).map((ov, i) => {
                        const co = allCompanies.find(c => c.id === ov.transport_company_id)
                        return (
                          <div key={i} className="flex justify-between text-xs py-0.5 border-b border-slate-100">
                            <span className="text-slate-500">{co ? `${co.code} – ${co.name}` : ov.transport_company_id}</span>
                            <span className="font-semibold tabular-nums">{ov.shelf_life_days} ngày</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Khác */}
                <div>
                  <p className="text-[10px] font-medium text-slate-500 mb-1.5">Thông tin khác</p>
                  <div className="space-y-0">
                    <DRow label="Mã cũ" value={detailMat.old_code} />
                    {detailMat.manufacturer && (
                      <DRow label="Nhà SX" value={`${detailMat.manufacturer.code}${detailMat.manufacturer.name ? ` – ${detailMat.manufacturer.name}` : ''}`} />
                    )}
                  </div>
                </div>

                {/* Audit */}
                <div>
                  <p className="text-[10px] font-medium text-slate-500 mb-1.5">Lịch sử</p>
                  <div className="space-y-0">
                    <DRow label="Người tạo"  value={detailMat.created_by} />
                    <DRow label="Giờ tạo"
                      value={detailMat.created_at
                        ? `${formatTimestampDate(detailMat.created_at)} ${formatTimestampTime(detailMat.created_at)}`
                        : null}
                    />
                    <DRow label="Người sửa"  value={detailMat.updated_by} />
                    <DRow label="Giờ sửa"
                      value={detailMat.updated_at
                        ? `${formatTimestampDate(detailMat.updated_at)} ${formatTimestampTime(detailMat.updated_at)}`
                        : null}
                    />
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              {(canEdit || canDel) && (
                <div className="shrink-0 border-t px-4 py-3 flex gap-2">
                  {canEdit && (
                    <Button size="sm" variant="outline" className="flex-1 text-xs h-7 gap-1" onClick={() => { openEdit(detailMat); setDetailMat(null) }}>
                      <Pencil className="h-3 w-3" />Sửa
                    </Button>
                  )}
                  {canDel && (
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300" onClick={() => { setDeleteTarget(detailMat); setDetailMat(null) }}>
                      <Trash2 className="h-3 w-3" />{detailMat.is_active ? 'Ẩn' : 'Xóa'}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Add / Edit Dialog ──────────────────────────────────────────── */}
      <Dialog open={dialogMode !== null} onOpenChange={open => !open && setDialogMode(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{dialogMode === 'add' ? 'Thêm mã hàng' : `Sửa: ${editing?.material_code}`}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 py-1 max-h-[68vh] overflow-y-auto pr-1">
            {/* Mã hàng */}
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

            {/* Mô tả */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Mô tả *</Label>
              <Input
                className="col-span-2 h-7 text-xs"
                value={form.material_description}
                onChange={e => setField('material_description', e.target.value)}
                placeholder="Tên đầy đủ của hàng hóa"
              />
            </div>

            {/* Tên rút gọn */}
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

            {/* Loại hàng — từ WMS Settings */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Loại hàng *</Label>
              <Select value={form.category || '__none__'} onValueChange={v => setField('category', v === '__none__' ? '' : v)}>
                <SelectTrigger className="col-span-2 h-7 text-xs">
                  <SelectValue placeholder="Chọn loại hàng" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-slate-400">— Chọn loại hàng —</SelectItem>
                  {categories.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* ĐVT */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">ĐVT *</Label>
              <Select value={form.unit || '__none__'} onValueChange={v => setField('unit', v === '__none__' ? '' : v)}>
                <SelectTrigger className="col-span-2 h-7 text-xs">
                  <SelectValue placeholder="Chọn ĐVT" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-xs text-slate-400">— Chọn ĐVT —</SelectItem>
                  <SelectItem value="CAR" className="text-xs font-mono">CAR – Carton (thùng)</SelectItem>
                  <SelectItem value="EA"  className="text-xs font-mono">EA – Each (cái)</SelectItem>
                  <SelectItem value="KG"  className="text-xs font-mono">KG – Kilogram</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Thùng/pallet mặc định */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Thùng/pallet *</Label>
              <Input type="number" min={1} className="col-span-2 h-7 text-xs" value={form.cartons_per_pallet} onChange={e => setField('cartons_per_pallet', e.target.value)} placeholder="Mặc định cho mọi kho" />
            </div>

            {/* Ngoại lệ theo kho */}
            <div className="grid grid-cols-3 items-start gap-2">
              <Label className="text-xs text-right pt-1.5">Ngoại lệ kho</Label>
              <div className="col-span-2 space-y-1.5">
                {overrides.map((ov, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <Select value={ov.warehouse_id || '__none__'} onValueChange={v => setOverrideField(i, 'warehouse_id', v === '__none__' ? '' : v)}>
                      <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                        <SelectValue placeholder="Kho" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs text-slate-400">— Chọn kho —</SelectItem>
                        {warehouses
                          .filter(w => !usedWhIds.has(w.id) || w.id === ov.warehouse_id)
                          .map(w => (
                            <SelectItem key={w.id} value={w.id} className="text-xs">{w.code}</SelectItem>
                          ))
                        }
                      </SelectContent>
                    </Select>
                    <Input type="number" min={1} className="w-16 h-7 text-xs" value={ov.cartons_per_pallet} onChange={e => setOverrideField(i, 'cartons_per_pallet', e.target.value)} placeholder="Số T" />
                    <button onClick={() => removeOverride(i)} className="text-slate-400 hover:text-red-500 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {overrides.length < warehouses.length && (
                  <button onClick={addOverride} className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700">
                    <PlusCircle className="h-3 w-3" />Thêm ngoại lệ kho
                  </button>
                )}
                {overrides.length === 0 && (
                  <p className="text-[10px] text-slate-400">Áp dụng số mặc định cho mọi kho</p>
                )}
              </div>
            </div>

            {/* EA/thùng */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">EA/thùng</Label>
              <Input type="number" min={1} className="col-span-2 h-7 text-xs" value={form.units_per_carton} onChange={e => setField('units_per_carton', e.target.value)} placeholder="Số đơn vị/thùng" />
            </div>

            {/* KG */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">KG *</Label>
              <Input type="number" min={0} step="0.01" className="col-span-2 h-7 text-xs" value={form.weight_kg} onChange={e => setField('weight_kg', e.target.value)} placeholder="Khối lượng (kg/thùng)" />
            </div>

            {/* HSD */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">
                HSD (ngày){SHELF_LIFE_CATS.includes(form.category) && ' *'}
              </Label>
              <Input type="number" min={0} className="col-span-2 h-7 text-xs" value={form.shelf_life_days} onChange={e => setField('shelf_life_days', e.target.value)} placeholder="Số ngày hạn sử dụng" />
            </div>

            {/* HSD ngoại lệ theo NCC */}
            <div className="grid grid-cols-3 items-start gap-2">
              <Label className="text-xs text-right pt-1.5">HSD theo NCC</Label>
              <div className="col-span-2 space-y-1.5">
                {supplierOverrides.map((ov, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <Select value={ov.transport_company_id || '__none__'} onValueChange={v => setSupplierOverrideField(i, 'transport_company_id', v === '__none__' ? '' : v)}>
                      <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                        <SelectValue placeholder="NCC" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs text-slate-400">— Chọn NCC —</SelectItem>
                        {nccList
                          .filter(c => !usedNccIds.has(c.id) || c.id === ov.transport_company_id)
                          .map(c => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">{c.code} – {c.name}</SelectItem>
                          ))
                        }
                      </SelectContent>
                    </Select>
                    <Input type="number" min={1} className="w-20 h-7 text-xs" value={ov.shelf_life_days} onChange={e => setSupplierOverrideField(i, 'shelf_life_days', e.target.value)} placeholder="Ngày" />
                    <button onClick={() => removeSupplierOverride(i)} className="text-slate-400 hover:text-red-500 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {nccList.length > 0 && supplierOverrides.length < nccList.length && (
                  <button onClick={addSupplierOverride} className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700">
                    <PlusCircle className="h-3 w-3" />Thêm NCC đặc biệt
                  </button>
                )}
                {nccList.length === 0 && (
                  <p className="text-[10px] text-slate-400">Chưa có NCC nào trong TMS Settings</p>
                )}
                {supplierOverrides.length === 0 && nccList.length > 0 && (
                  <p className="text-[10px] text-slate-400">Áp dụng HSD mặc định cho mọi NCC</p>
                )}
              </div>
            </div>

            {/* Mã cũ */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Mã cũ</Label>
              <Input className="col-span-2 h-7 text-xs font-mono" value={form.old_code} onChange={e => setField('old_code', e.target.value)} placeholder="Mã trước đây (nếu có)" />
            </div>

            {/* Trạng thái (edit only) */}
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

      {/* ── Single delete confirm ──────────────────────────────────────── */}
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

      {/* ── Bulk delete confirm ────────────────────────────────────────── */}
      <Dialog open={bulkDeleteOpen} onOpenChange={open => !open && setBulkDeleteOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Ẩn {selected.size} mã hàng</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">{selected.size} mã hàng đã chọn sẽ bị ẩn. Tiếp tục?</p>
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
