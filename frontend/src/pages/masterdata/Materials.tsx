import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Tag, Plus, Upload, Pencil, Trash2, X, Check, Minus, PlusCircle, QrCode, Rows3, AlignJustify, Boxes } from 'lucide-react'
import { UploadExcelDialog } from '@/components/shared/UploadExcelDialog'
import { SearchInput } from '@/components/shared/SearchInput'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SavedViews } from '@/components/shared/SavedViews'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { FormSheet } from '@/components/shared/FormSheet'
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
import { omniMatch } from '@/utils/omniSearch'
import {
  useMaterials, useWarehouses, useTransportCompanies,
  useCreateMaterial, useUpdateMaterial, useDeleteMaterial, useUploadMaterialsExcel,
  useSystemSettings, useUnits,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'
import { needsShelfLife, needsPalletPerEa, whTypeBadgeCls, type WhTypeMetaMap } from '@/utils/cargoCategory'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
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

function CatBadge({ cat, metaMap }: { cat: string | null; metaMap?: WhTypeMetaMap }) {
  if (!cat) return <span className="text-slate-300">—</span>
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${whTypeBadgeCls(cat, metaMap)}`}>{cat}</span>
}

// Khối lượng (kg) thường là float dẫn xuất nhiều chữ số thập phân (vd 0.001658333) → tràn cột hẹp.
// Làm tròn 3 số lẻ + cắt số 0 thừa cho gọn; giá trị gốc đầy đủ vẫn xem qua title khi hover.
function fmtWeight(n: number | null | undefined): string | null {
  if (n == null) return null
  return String(Math.round(n * 1000) / 1000)
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
  product_type: '',
  cartons_per_pallet: '',
  units_per_carton: '',
  pallet_per_ea: '',
  base_unit: '',
  entry_unit: '',
  weight_kg: '',
  shelf_life_days: '',
  carton_length_mm: '',
  carton_width_mm: '',
  carton_height_mm: '',
  max_stack_layers: '',
  old_code: '',
  batch_prefix: '',
  notes: '',
}

// Luật HSD / Pallet/EA bắt buộc đi theo CỜ per-Loại kho (LookupValue.meta, chỉnh trong tab Loại kho) —
// needsShelfLife / needsPalletPerEa import từ utils/cargoCategory, truyền metaMap của useWhTypeMetaMap().

// Mã hàng THIẾU dữ liệu bắt buộc → trả danh sách field thiếu (để tô đỏ + tooltip trong danh sách). Khớp luật form.
function missingRequiredFields(m: Material, metaMap: WhTypeMetaMap): string[] {
  const miss: string[] = []
  if (!m.category) miss.push('Loại hàng')
  if (!m.base_unit) miss.push('Base Unit')
  if (m.cartons_per_pallet == null || Number(m.cartons_per_pallet) <= 0) miss.push('Thùng/pallet')
  if (needsShelfLife(m.category, metaMap) && m.shelf_life_days == null) miss.push('HSD')
  if (needsPalletPerEa(m.category, metaMap) && m.pallet_per_ea == null) miss.push('Pallet/EA')
  return miss
}

// ── Main component ───────────────────────────────────────────────────────────
export default function Materials() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canEdit = can(perms, 'materials', 'edit')
  const canDel  = can(perms, 'materials', 'delete')

  // Cờ định dạng tem của ĐƠN VỊ — ĐV2 (tem `;`) mới cần Mã tắt (mã lô); ĐV1 ẩn ô này cho gọn.
  const { data: sysSettings = [] } = useSystemSettings()
  const isV2Format = (sysSettings.find(s => s.key === 'label_format')?.value as string) === 'semicolon'

  // Filters (persisted via wmsFilterStore)
  const { materials: mf, setMaterials } = useWmsFilterStore()
  const search       = mf.search
  const catFilter    = mf.catFilter
  const statusFilter = mf.statusFilter
  const qrFilter     = mf.qrFilter ?? []
  const dqFilter     = mf.dqFilter ?? []
  const setSearch       = (v: string)   => setMaterials({ search: v })
  const setCatFilter    = (v: string[]) => setMaterials({ catFilter: v })
  const setStatusFilter = (v: string[]) => setMaterials({ statusFilter: v })
  const setQrFilter     = (v: string[]) => setMaterials({ qrFilter: v })
  const setDqFilter     = (v: string[]) => setMaterials({ dqFilter: v })

  // Density
  const [dense, setDense] = useState(() => localStorage.getItem('materials_density') !== 'comfortable')
  function toggleDensity() {
    setDense(d => { localStorage.setItem('materials_density', d ? 'comfortable' : 'compact'); return !d })
  }

  // Detail sheet
  const [detailMat, setDetailMat] = useState<Material | null>(null)

  // Add/Edit dialog
  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | null>(null)
  const [editing,    setEditing]    = useState<Material | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [editActive,       setEditActive]       = useState(true)
  const [noQr,             setNoQr]             = useState(false)
  const [stackOnTop,       setStackOnTop]       = useState(false)   // hàng nhẹ — được xếp trên mã hàng khác (xếp xe 3D)
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
  const [bulkQrOpen,     setBulkQrOpen]     = useState(false)
  const [bulkQrSaving,   setBulkQrSaving]   = useState(false)
  // Bulk sửa quy cách xếp xe (D×R×C + số lớp tối đa + hàng nhẹ) — ô trống = giữ nguyên
  const [bulkPackOpen,   setBulkPackOpen]   = useState(false)
  const [bulkPackSaving, setBulkPackSaving] = useState(false)
  const [bulkPack, setBulkPack] = useState({ l: '', w: '', h: '', layers: '', onTop: '' })   // onTop: ''=giữ nguyên · '1' · '0'

  // Data
  const { data: raw = [], isLoading }    = useMaterials(undefined)
  const { data: warehouseTypes = [] }    = useScopedWhTypes()
  const whTypeMeta = useWhTypeMetaMap()   // cờ hành vi per-Loại kho (HSD/Pallet-EA bắt buộc, màu badge)
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

  // Danh mục Đơn vị tính (Cài đặt WMS → tab Đơn vị tính). Base selector = role base/both; Entry = role entry/both.
  const { data: unitCatalog = [] } = useUnits()
  const unitOpt = (u: { value: string; meta?: { label?: string } | null }) => ({ value: u.value, label: u.meta?.label ? `${u.value} — ${u.meta.label}` : u.value })
  const baseUnitOpts  = useMemo(() => unitCatalog.filter(u => (u.meta?.role ?? 'both') !== 'entry').map(unitOpt), [unitCatalog])
  const entryUnitOpts = useMemo(() => unitCatalog.filter(u => (u.meta?.role ?? 'both') !== 'base').map(unitOpt),  [unitCatalog])
  // Giữ giá trị hiện tại của mã nếu mã đơn vị không (còn) trong danh mục — để SingleSelect vẫn hiển thị đúng
  const withCurrent = (opts: { value: string; label: string }[], cur: string) =>
    cur && !opts.some(o => o.value === cur) ? [{ value: cur, label: `${cur} (ngoài danh mục)` }, ...opts] : opts

  // Mutations
  const createMaterial = useCreateMaterial()
  const uploadMaterials = useUploadMaterialsExcel()
  const updateMaterial = useUpdateMaterial()
  const deleteMaterial = useDeleteMaterial()

  // Tên hàng (material_description) bị TRÙNG: tính trên TOÀN BỘ mã (raw), không theo filter.
  const dupNames = useMemo(() => {
    const cnt = new Map<string, number>()
    for (const m of raw as Material[]) {
      const k = (m.material_description ?? '').trim().toLowerCase()
      if (k) cnt.set(k, (cnt.get(k) ?? 0) + 1)
    }
    return new Set([...cnt.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }, [raw])
  const isDupName = (m: Material) => dupNames.has((m.material_description ?? '').trim().toLowerCase())

  // Filtered list
  const filtered = useMemo(() => {
    const showActive   = statusFilter.includes('active')   || statusFilter.length === 0
    const showInactive = statusFilter.includes('inactive') || statusFilter.length === 0
    const showQr   = qrFilter.includes('has_qr')  || qrFilter.length === 0
    const showNoQr = qrFilter.includes('no_qr')   || qrFilter.length === 0
    return (raw as Material[]).filter(m => {
      if (m.is_active  && !showActive)   return false
      if (!m.is_active && !showInactive) return false
      if (m.no_qr_tracking  && !showNoQr) return false
      if (!m.no_qr_tracking && !showQr)  return false
      if (catFilter.length > 0 && !catFilter.includes(m.category ?? '')) return false
      // Lọc chất lượng dữ liệu (OR giữa các tuỳ chọn đã chọn)
      if (dqFilter.length > 0) {
        const okIncomplete = dqFilter.includes('incomplete') && missingRequiredFields(m, whTypeMeta).length > 0
        const okDup        = dqFilter.includes('dup')        && isDupName(m)
        if (!okIncomplete && !okDup) return false
      }
      if (!omniMatch([m.material_code, m.material_description, m.short_name, m.old_code, m.category, m.base_unit, m.entry_unit], search)) return false
      return true
    })
  }, [raw, catFilter, search, statusFilter, qrFilter, dqFilter, dupNames, whTypeMeta])

  const allSelected  = filtered.length > 0 && filtered.every(m => selected.has(m.id))
  const someSelected = selected.size > 0 && !allSelected

  // Phân trang client 200/trang — ~1800 mã render hết một lượt = hàng chục nghìn DOM node,
  // chậm rõ trên tablet/phone. Data đã có đủ ở client (BE cố ý trả hết cho dropdown) → chỉ cắt lúc render.
  const PAGE_SIZE = 200
  const [page, setPage] = useState(0)
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1)
  const curPage = Math.min(page, maxPage)   // filter thu hẹp → tự kéo về trang cuối còn dữ liệu
  const pageItems = useMemo(
    () => filtered.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE),
    [filtered, curPage]
  )

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setField(k: keyof typeof EMPTY_FORM, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function validate(): string | null {
    if (dialogMode === 'add' && !form.material_code.trim()) return 'Mã hàng là bắt buộc'
    if (!form.material_description.trim()) return 'Mô tả là bắt buộc'
    if (!form.category) return 'Loại hàng là bắt buộc'
    if (!form.base_unit.trim()) return 'Base Unit là bắt buộc'
    if (!form.cartons_per_pallet) return 'Thùng/pallet là bắt buộc'
    if (needsShelfLife(form.category, whTypeMeta) && !form.shelf_life_days)
      return `HSD (ngày) là bắt buộc cho loại "${form.category}" (chỉnh luật này trong Cài đặt WMS → Loại kho)`
    if (needsPalletPerEa(form.category, whTypeMeta) && !form.pallet_per_ea)
      return `Pallet/EA là bắt buộc cho loại "${form.category}" (để quy đổi tồn EA → pallet)`
    if (form.entry_unit.trim() && !(Number(form.units_per_carton) > 0))
      return 'Có Entry Unit thì hệ số EA/thùng (1 Entry = N Base) phải > 0'
    if (form.entry_unit.trim() && form.entry_unit.trim().toUpperCase() === form.base_unit.trim().toUpperCase())
      return 'Entry Unit phải KHÁC Base Unit (vd Base=HOP thì Entry không được HOP) — nếu bằng nhau, nhân EA/thùng sẽ sai'
    for (const ov of overrides) {
      if (!ov.warehouse_id || !ov.cartons_per_pallet) return 'Điền đủ kho và số thùng cho mọi ngoại lệ'
    }
    return null
  }

  // Mẫu Excel Mã hàng — cột KHỚP thứ tự M_KEYS backend (dòng 1 nhãn, dòng 2 key, dòng 3 ví dụ).
  // ĐV tem `;` (isV2Format): mẫu tự thêm cột 13 batch_prefix (Mã tắt mã lô); ĐV tem `_` giữ 12 cột như cũ.
  function downloadMaterialTemplate() {
    // Cột 4 ('(bỏ trống)') = filler VỊ TRÍ của ĐVT cũ (đã bỏ) — giữ để file cũ không lệch cột. Đơn vị nay = Base/Entry Unit (2 cột cuối).
    const labels = ['Mã hàng *', 'Tên hàng *', 'Loại hàng *', '(bỏ trống)', 'Thùng/Pallet *', 'Đv/Thùng', 'Pallet/EA', 'KL (kg) *', 'HSD (ngày)', 'Loại SP', 'Tên rút gọn', 'Ghi chú']
    const keys = ['material_code', 'material_description', 'category', 'unit', 'cartons_per_pallet', 'units_per_carton', 'pallet_per_ea', 'weight_kg', 'shelf_life_days', 'product_type', 'custom_short_name', 'notes']
    const ex = ['210000262', 'Sữa tươi tiệt trùng 180ml', 'Thành phẩm', '', 80, 48, '', 9.6, 180, 'UHT', '', '']
    if (isV2Format) { labels.push('Mã tắt (mã lô)'); keys.push('batch_prefix'); ex.push('TA') }
    else { labels.push('(bỏ trống)'); keys.push('batch_prefix'); ex.push('') }   // giữ VỊ TRÍ cột khớp M_KEYS BE — dims nằm SAU batch_prefix
    labels.push('Thùng dài (mm)', 'Thùng rộng (mm)', 'Thùng cao (mm)', 'Số lớp tối đa', 'Xếp trên hàng khác (1/0)')
    keys.push('carton_length_mm', 'carton_width_mm', 'carton_height_mm', 'max_stack_layers', 'stack_on_top')
    ex.push(380, 285, 240, 8, 0)
    labels.push('Base Unit *', 'Entry Unit')
    keys.push('base_unit', 'entry_unit')
    ex.push('HOP', 'CAR')
    const ws = XLSX.utils.aoa_to_sheet([labels, keys, ex])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'MaHang')
    XLSX.writeFile(wb, 'mau_ma_hang.xlsx')
  }

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOverrides([])
    setSupplierOverrides([])
    setEditActive(true)
    setNoQr(false)
    setStackOnTop(false)
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
      product_type:         mat.product_type ?? '',
      cartons_per_pallet:   mat.cartons_per_pallet != null ? String(mat.cartons_per_pallet) : '',
      units_per_carton:     mat.units_per_carton   != null ? String(mat.units_per_carton)   : '',
      pallet_per_ea:        mat.pallet_per_ea      != null ? String(mat.pallet_per_ea)      : '',
      base_unit:            mat.base_unit  ?? '',
      entry_unit:           mat.entry_unit ?? '',
      weight_kg:            mat.weight_kg           != null ? String(mat.weight_kg)           : '',
      shelf_life_days:      mat.shelf_life_days     != null ? String(mat.shelf_life_days)     : '',
      carton_length_mm:     mat.carton_length_mm    != null ? String(mat.carton_length_mm)    : '',
      carton_width_mm:      mat.carton_width_mm     != null ? String(mat.carton_width_mm)     : '',
      carton_height_mm:     mat.carton_height_mm    != null ? String(mat.carton_height_mm)    : '',
      max_stack_layers:     mat.max_stack_layers    != null ? String(mat.max_stack_layers)    : '',
      old_code:             mat.old_code ?? '',
      batch_prefix:         mat.batch_prefix ?? '',
      notes:                mat.notes ?? '',
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
    setNoQr(mat.no_qr_tracking ?? false)
    setStackOnTop(mat.stack_on_top ?? false)
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
        product_type:                  form.product_type.trim() || undefined,
        cartons_per_pallet:            Number(form.cartons_per_pallet),
        units_per_carton:              form.units_per_carton ? Number(form.units_per_carton) : undefined,
        pallet_per_ea:                 form.pallet_per_ea ? Number(form.pallet_per_ea) : undefined,
        base_unit:                     form.base_unit.trim().toUpperCase() || null,
        entry_unit:                    form.entry_unit.trim().toUpperCase() || null,
        weight_kg:                     Number(form.weight_kg),
        shelf_life_days:               form.shelf_life_days ? Number(form.shelf_life_days) : undefined,
        carton_length_mm:              form.carton_length_mm ? Number(form.carton_length_mm) : null,
        carton_width_mm:               form.carton_width_mm  ? Number(form.carton_width_mm)  : null,
        carton_height_mm:              form.carton_height_mm ? Number(form.carton_height_mm) : null,
        max_stack_layers:              form.max_stack_layers ? Number(form.max_stack_layers) : null,
        stack_on_top:                  stackOnTop,
        old_code:                      form.old_code.trim() || undefined,
        batch_prefix:                  form.batch_prefix.trim().toUpperCase() || undefined,
        notes:                         form.notes.trim() || undefined,
        no_qr_tracking:                noQr,
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

  async function handleBulkNoQr() {
    setBulkQrSaving(true)
    try {
      await Promise.all([...selected].map(id => updateMaterial.mutateAsync({ id, no_qr_tracking: true })))
      setSelected(new Set())
      setBulkQrOpen(false)
    } finally {
      setBulkQrSaving(false)
    }
  }

  const bulkPackHasChange = !!(bulkPack.l || bulkPack.w || bulkPack.h || bulkPack.layers || bulkPack.onTop)

  async function handleBulkPack() {
    // Chỉ đắp field CÓ GIÁ TRỊ — ô trống giữ nguyên giá trị từng mã
    const patch: Record<string, number | boolean> = {}
    if (bulkPack.l)      patch.carton_length_mm = Number(bulkPack.l)
    if (bulkPack.w)      patch.carton_width_mm  = Number(bulkPack.w)
    if (bulkPack.h)      patch.carton_height_mm = Number(bulkPack.h)
    if (bulkPack.layers) patch.max_stack_layers = Number(bulkPack.layers)
    if (bulkPack.onTop)  patch.stack_on_top     = bulkPack.onTop === '1'
    setBulkPackSaving(true)
    try {
      await Promise.all([...selected].map(id => updateMaterial.mutateAsync({ id, ...patch })))
      setSelected(new Set())
      setBulkPackOpen(false)
      setBulkPack({ l: '', w: '', h: '', layers: '', onTop: '' })
    } finally {
      setBulkPackSaving(false)
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
  const saving = createMaterial.isPending || updateMaterial.isPending

  const shortNamePreview = (() => {
    const base = form.custom_short_name.trim() || form.material_description.trim() || '(mô tả)'
    const sfx  = form.material_code.trim().slice(-3) || '…'
    return `${base} [${sfx}]`
  })()

  const colCount = (canDel ? 1 : 0) + 10 + 2 + (canEdit || canDel ? 1 : 0)

  // Cột bảng — số phần tử khớp số <TableCell> mỗi dòng (tùy quyền canDel/canEdit)
  const MAT_COLS = useMemo(() => {
    const cols: { id: string; label: string; w: number; align?: 'right' }[] = []
    if (canDel) cols.push({ id: 'check', label: '', w: 32 })
    cols.push(
      { id: 'code',    label: 'Mã hàng',      w: 120 },
      { id: 'short',   label: 'Tên rút gọn',  w: 160 },
      { id: 'desc',    label: 'Mô tả đầy đủ', w: 200 },
      { id: 'cat',     label: 'Loại',         w: 90 },
      { id: 'unit',    label: 'Đơn vị',       w: 74 },
      { id: 'pl',      label: 'PL',           w: 60, align: 'right' },
      { id: 'ea',      label: 'EA/T',         w: 64, align: 'right' },
      { id: 'kg',      label: 'KG',           w: 64, align: 'right' },
      { id: 'tt',      label: 'Trạng thái',   w: 96 },
      { id: 'qr',      label: 'QR',           w: 80 },
      { id: 'created', label: 'Tạo',          w: 120 },
      { id: 'updated', label: 'Sửa',          w: 120 },
    )
    if (canEdit || canDel) cols.push({ id: 'actions', label: '', w: 64 })
    return cols
  }, [canDel, canEdit])
  const { widths: colW, startResize, totalWidth } = useColumnResize('materials_col_widths', MAT_COLS.map(c => c.w))

  // ─── Filter chip bar (Manhattan) ───
  const filterDefs: FilterDef[] = [
    { key: 'cat', label: 'Loại hàng', type: 'multi', options: categories.map(c => ({ value: c, label: c })), selected: catFilter, searchable: true,
      onChange: setCatFilter },
    { key: 'status', label: 'Trạng thái', type: 'multi',
      options: [{ value: 'active', label: 'Đang dùng' }, { value: 'inactive', label: 'Đã ẩn' }], selected: statusFilter,
      onChange: setStatusFilter },
    { key: 'qr', label: 'QR', type: 'multi',
      options: [{ value: 'has_qr', label: 'Có QR' }, { value: 'no_qr', label: 'Không QR' }], selected: qrFilter,
      onChange: setQrFilter },
    { key: 'dq', label: 'Dữ liệu', type: 'multi',
      options: [{ value: 'incomplete', label: 'Thiếu thông tin' }, { value: 'dup', label: 'Trùng tên' }], selected: dqFilter,
      onChange: setDqFilter },
  ]

  const viewSnapshot = { search, catFilter, statusFilter, qrFilter, dqFilter }
  const savedViews = useSavedViewsStore(s => s.views['materials'] ?? [])
  const activeViewId = useMemo(() => {
    const cur = JSON.stringify(viewSnapshot)
    return savedViews.find(v => JSON.stringify(v.filters) === cur)?.id ?? null
  }, [savedViews, viewSnapshot])

  const summary = useMemo(() => ({
    total:      filtered.length,
    active:     filtered.filter(m => m.is_active).length,
    inactive:   filtered.filter(m => !m.is_active).length,
    noQr:       filtered.filter(m => m.no_qr_tracking).length,
    incomplete: filtered.filter(m => missingRequiredFields(m, whTypeMeta).length > 0).length,
    dup:        filtered.filter(m => isDupName(m)).length,
  }), [filtered, dupNames, whTypeMeta])

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
            <Tag className="h-4 w-4 text-slate-500" /> Mã hàng
          </span>
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm mã, tên…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <SavedViews
            module="materials"
            currentFilters={viewSnapshot}
            activeId={activeViewId}
            onApply={(filters) => setMaterials(filters as Partial<typeof mf>)}
          />
          <button type="button" onClick={toggleDensity}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          <ActionCluster className="shrink-0" items={[
            ...(can(perms, 'materials', 'import') ? [{
              key: 'upload', icon: Upload, label: 'Upload Excel', tip: 'Upload mã hàng từ file Excel (mã mới thêm, mã đã có cập nhật)',
              mobileHidden: true, // upload Excel không dùng trên điện thoại (giữ hành vi cũ hidden sm:inline-flex)
              onClick: () => setShowUpload(true),
            } satisfies ActionItem] : []),
            ...(can(perms, 'materials', 'create') ? [{
              key: 'add', icon: Plus, label: 'Thêm mã hàng', tip: 'Thêm mã hàng mới',
              primary: true, variant: 'default',
              onClick: openAdd,
            } satisfies ActionItem] : []),
          ]} />
        </div>

        {/* Filter chip bar (desktop) */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          <FilterBar defs={filterDefs} />
        </div>
      </div>

      {/* Summary band (Manhattan) */}
      <SummaryBand tiles={[
        { label: 'Tổng mã', value: summary.total },
        { label: 'Đang dùng', value: summary.active },
        { label: 'Đã ẩn', value: summary.inactive },
        { label: 'Không QR', value: summary.noQr, accent: summary.noQr > 0 },
        { label: 'Thiếu DL', value: summary.incomplete, danger: summary.incomplete > 0 },
        { label: 'Trùng tên', value: summary.dup, accent: summary.dup > 0 },
      ]} />

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {MAT_COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.id === 'code' ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.id === 'check'
                      ? <RowCheck checked={allSelected} indeterminate={someSelected} onClick={toggleAll} />
                      : c.label}
                    {i > 0 && c.id !== 'actions' && (
                      <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                        className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <tr><td colSpan={colCount} className="p-0"><TableSkeleton cols={colCount} rows={12} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={colCount}><EmptyState title="Không có mã hàng" /></td></tr>
              ) : pageItems.map(mat => {
                const hasOverrides = (mat.warehouse_pallet_overrides?.length ?? 0) > 0
                const miss = missingRequiredFields(mat, whTypeMeta)
                const dup  = isDupName(mat)
                const tip = [miss.length ? `Thiếu: ${miss.join(', ')}` : '', dup ? 'Trùng Tên hàng với mã khác' : ''].filter(Boolean).join(' · ')
                return (
                  <TableRow
                    key={mat.id}
                    title={tip || undefined}
                    className={`${!mat.is_active ? 'opacity-50' : ''} hover:bg-slate-50 cursor-pointer ${detailMat?.id === mat.id ? 'bg-blue-50 hover:bg-blue-50' : ''} ${miss.length ? '[&_td]:text-red-600' : dup ? '[&_td]:text-amber-600' : ''} ${dense ? '' : '[&_td]:py-2.5'}`}
                    onClick={() => setDetailMat(detailMat?.id === mat.id ? null : mat)}
                  >
                    {canDel && (
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <RowCheck checked={selected.has(mat.id)} onClick={() => toggleSelect(mat.id)} />
                      </TableCell>
                    )}
                    <TableCell className="px-2 py-1 whitespace-nowrap font-mono font-semibold text-[10px] sticky left-0 z-10 bg-inherit">{mat.material_code}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] max-w-[160px] truncate">
                      {mat.short_name ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] text-slate-500 max-w-[200px] truncate">
                      {mat.material_description}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap"><CatBadge cat={mat.category} metaMap={whTypeMeta} /></TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-mono">
                      {mat.base_unit
                        ? <>{mat.base_unit}{mat.entry_unit && <span className="text-slate-400">/{mat.entry_unit}</span>}</>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">
                      {mat.cartons_per_pallet ?? <span className="text-slate-300">—</span>}
                      {hasOverrides && <span className="text-[8px] text-blue-500 ml-0.5">*</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right">
                      {mat.units_per_carton ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-right"
                      title={mat.weight_kg != null ? String(mat.weight_kg) : undefined}>
                      {fmtWeight(mat.weight_kg) ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${mat.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {mat.is_active ? 'Đang dùng' : 'Ẩn'}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {mat.no_qr_tracking
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap bg-amber-100 text-amber-700">Không QR</span>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap bg-green-100 text-green-700">QR</span>}
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

      {/* Footer đếm bản ghi + chuyển trang */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl flex items-center gap-2">
        <span>
          {filtered.length > 0
            ? `${curPage * PAGE_SIZE + 1}–${Math.min((curPage + 1) * PAGE_SIZE, filtered.length)} / ${filtered.length} mã hàng`
            : '0 mã hàng'}
          {(raw as Material[]).length !== filtered.length && <span className="text-slate-400"> (tổng {(raw as Material[]).length})</span>}
        </span>
        {selected.size > 0 && <span className="text-green-600 font-medium">· {selected.size} đang chọn</span>}
        {maxPage > 0 && (
          <span className="ml-auto flex items-center gap-1">
            <button onClick={() => setPage(Math.max(0, curPage - 1))} disabled={curPage === 0}
              className="px-2 py-0.5 rounded border border-slate-300 bg-white disabled:opacity-30 hover:bg-slate-100">‹</button>
            <span className="tabular-nums">{curPage + 1}/{maxPage + 1}</span>
            <button onClick={() => setPage(Math.min(maxPage, curPage + 1))} disabled={curPage >= maxPage}
              className="px-2 py-0.5 rounded border border-slate-300 bg-white disabled:opacity-30 hover:bg-slate-100">›</button>
          </span>
        )}
      </div>
     </div>

      {/* ── Bulk action bar ────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white rounded-xl px-4 py-2.5 flex items-center gap-4 shadow-2xl">
          <span className="text-xs text-slate-300">{selected.size} mã đã chọn</span>
          {canEdit && (
            <button onClick={() => setBulkPackOpen(true)} className="flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200 transition-colors">
              <Boxes className="h-3.5 w-3.5" />Quy cách xếp xe
            </button>
          )}
          {canEdit && (
            <button onClick={() => setBulkQrOpen(true)} className="flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 transition-colors">
              <QrCode className="h-3.5 w-3.5" />Không theo dõi QR
            </button>
          )}
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
                    <DRow label="Loại hàng"  value={<CatBadge cat={detailMat.category} metaMap={whTypeMeta} />} />
                    <DRow label="Loại SP"    value={detailMat.product_type} />
                    <DRow label="Quản tồn"   value={detailMat.no_qr_tracking ? 'Không QR (theo số lượng)' : 'Theo QR từng pallet'} />
                  </div>
                </div>

                {/* Quy cách */}
                <div>
                  <p className="text-[10px] font-medium text-slate-500 mb-1.5">Quy cách</p>
                  <div className="space-y-0">
                    <DRow label="Thùng/pallet (PL)" value={detailMat.cartons_per_pallet != null ? `${detailMat.cartons_per_pallet} thùng` : null} />
                    <DRow label="EA/thùng"           value={detailMat.units_per_carton  != null ? `${detailMat.units_per_carton} EA`     : null} />
                    <DRow label="Pallet/EA"          value={detailMat.pallet_per_ea     != null ? `${detailMat.pallet_per_ea}`          : null} />
                    <DRow label="Base Unit"          value={detailMat.base_unit} />
                    <DRow label="Entry Unit"         value={detailMat.entry_unit
                      ? `${detailMat.entry_unit} (1 ${detailMat.entry_unit} = ${detailMat.units_per_carton ?? '?'} ${detailMat.base_unit ?? 'base'})`
                      : <span className="text-slate-300">— (không có)</span>} />
                    <DRow label="Khối lượng"         value={detailMat.weight_kg         != null ? `${detailMat.weight_kg} kg`            : null} />
                    <DRow label="HSD"                value={detailMat.shelf_life_days   != null ? `${detailMat.shelf_life_days} ngày`     : null} />
                    <DRow label="Thùng D×R×C"        value={(detailMat.carton_length_mm != null || detailMat.carton_width_mm != null || detailMat.carton_height_mm != null)
                      ? `${detailMat.carton_length_mm ?? '?'} × ${detailMat.carton_width_mm ?? '?'} × ${detailMat.carton_height_mm ?? '?'} mm` : null} />
                    <DRow label="Số lớp xếp tối đa"  value={detailMat.max_stack_layers != null ? `${detailMat.max_stack_layers} lớp` : <span className="text-slate-400">∞ (theo trần xe)</span>} />
                    <DRow label="Xếp trên hàng khác" value={detailMat.stack_on_top ? 'Có (hàng nhẹ được lên nóc)' : 'Không'} />
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
                    {detailMat.batch_prefix && <DRow label="Mã tắt (mã lô)" value={detailMat.batch_prefix} />}
                    {detailMat.manufacturer && (
                      <DRow label="Nhà SX" value={`${detailMat.manufacturer.code}${detailMat.manufacturer.name ? ` – ${detailMat.manufacturer.name}` : ''}`} />
                    )}
                    <DRow label="Ghi chú" value={detailMat.notes} />
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

              {/* Action buttons — cụm action chuẩn ActionCluster */}
              {(canEdit || canDel) && (
                <div className="shrink-0 border-t px-4 py-3">
                  <ActionCluster items={[
                    ...(canEdit ? [{
                      key: 'edit', icon: Pencil, label: 'Sửa', tip: 'Sửa thông tin mã hàng',
                      primary: true,
                      onClick: () => { openEdit(detailMat); setDetailMat(null) },
                    } satisfies ActionItem] : []),
                    ...(canDel ? [{
                      key: 'delete', icon: Trash2, label: detailMat.is_active ? 'Ẩn' : 'Xóa',
                      tip: detailMat.is_active
                        ? 'Ẩn mã hàng (đánh dấu ẩn, không xóa khỏi hệ thống)'
                        : 'Xóa mã hàng đã ẩn',
                      danger: true, className: 'border-red-200 text-red-600 hover:bg-red-50',
                      onClick: () => { setDeleteTarget(detailMat); setDetailMat(null) },
                    } satisfies ActionItem] : []),
                  ]} />
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Add / Edit Dialog ──────────────────────────────────────────── */}
      <FormSheet
        open={dialogMode !== null}
        onClose={() => setDialogMode(null)}
        title={dialogMode === 'add' ? 'Thêm mã hàng' : `Sửa: ${editing?.material_code}`}
        widthClass="sm:max-w-lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDialogMode(null)} className="text-xs h-7">Hủy</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="text-xs h-7">
              {saving ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </>
        }
      >
          <div className="grid gap-3">
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

            {/* Loại hàng — từ WMS Settings (SingleSelect chuẩn: có ô tìm) */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Loại hàng *</Label>
              <div className="col-span-2">
                <SingleSelect
                  options={categories.map(c => ({ value: c, label: c }))}
                  value={form.category}
                  onChange={v => setField('category', v)}
                  placeholder="Chọn loại hàng"
                  searchPlaceholder="Tìm loại hàng…"
                  triggerClassName="h-7 w-full text-xs"
                />
              </div>
            </div>

            {/* Loại SP (product_type) */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Loại SP</Label>
              <Input className="col-span-2 h-7 text-xs" value={form.product_type} onChange={e => setField('product_type', e.target.value)} placeholder="Vd: UHT, SCA, POSM (tùy chọn)" />
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
                    <WarehouseSingleSelect
                      warehouses={warehouses
                        .filter(w => !usedWhIds.has(w.id) || w.id === ov.warehouse_id)
                        .map(w => ({ id: w.id, name: w.code ?? w.name }))}
                      value={ov.warehouse_id}
                      onChange={v => setOverrideField(i, 'warehouse_id', v)}
                      placeholder="Kho"
                      triggerClassName="flex-1 min-w-0"
                    />
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

            {/* Base Unit — đơn vị GỐC lưu trữ/tính toán (bắt buộc). Danh mục: Cài đặt WMS → Đơn vị tính. */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Base Unit *</Label>
              <div className="col-span-2">
                <SingleSelect
                  options={withCurrent(baseUnitOpts, form.base_unit)}
                  value={form.base_unit}
                  onChange={v => setField('base_unit', v)}
                  placeholder="Chọn Base Unit (HOP/BT/KG/EA…)"
                  searchPlaceholder="Tìm đơn vị…"
                  triggerClassName="h-7 w-full text-xs"
                />
              </div>
            </div>

            {/* Entry Unit — đơn vị nhập/thùng (tùy chọn). Phải KHÁC Base Unit. */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Entry Unit</Label>
              <div className="col-span-2">
                <SingleSelect
                  options={[{ value: '', label: '— Không có (mã lẻ theo Base) —' }, ...withCurrent(entryUnitOpts, form.entry_unit)]}
                  value={form.entry_unit}
                  onChange={v => setField('entry_unit', v)}
                  placeholder="— Không có —"
                  searchPlaceholder="Tìm đơn vị…"
                  triggerClassName="h-7 w-full text-xs"
                />
              </div>
            </div>

            {/* EA/thùng — hệ số 1 Entry = N Base (chỉ cần khi có Entry Unit) */}
            {form.entry_unit.trim() && (
              <div className="grid grid-cols-3 items-center gap-2">
                <Label className="text-xs text-right">EA/thùng *</Label>
                <Input type="number" min={1} className="col-span-2 h-7 text-xs" value={form.units_per_carton} onChange={e => setField('units_per_carton', e.target.value)} placeholder="Số Base trong 1 Entry" />
              </div>
            )}

            {/* Dòng quy đổi — 1 Entry Unit = EA/thùng × Base Unit */}
            {form.entry_unit.trim() && Number(form.units_per_carton) > 0 && form.base_unit.trim() && (
              <div className="grid grid-cols-3 items-center gap-2">
                <div />
                <p className="col-span-2 text-[11px] text-slate-500">
                  1 <b className="font-mono">{form.entry_unit.trim()}</b> = <b className="tabular-nums">{form.units_per_carton}</b> <b className="font-mono">{form.base_unit.trim()}</b>
                </p>
              </div>
            )}

            {/* Pallet/EA — quy đổi tồn EA → pallet (bắt buộc theo cờ Loại kho) */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Pallet/EA{needsPalletPerEa(form.category, whTypeMeta) && ' *'}</Label>
              <Input type="number" min={0} step="any" className="col-span-2 h-7 text-xs" value={form.pallet_per_ea} onChange={e => setField('pallet_per_ea', e.target.value)} placeholder="1 EA = ? pallet (vd 0.00005)" />
            </div>

            {/* KG */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">KG</Label>
              <Input type="number" min={0} step="0.01" className="col-span-2 h-7 text-xs" value={form.weight_kg} onChange={e => setField('weight_kg', e.target.value)} placeholder="Khối lượng (kg/thùng)" />
            </div>

            {/* Kích thước thùng carton (mm) — phục vụ sơ đồ xếp xe 3D */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Thùng D×R×C (mm)</Label>
              <div className="col-span-2 flex items-center gap-1.5">
                <Input type="number" min={0} step="0.1" className="h-7 text-xs" value={form.carton_length_mm} onChange={e => setField('carton_length_mm', e.target.value)} placeholder="Dài" />
                <span className="text-slate-400 text-xs">×</span>
                <Input type="number" min={0} step="0.1" className="h-7 text-xs" value={form.carton_width_mm} onChange={e => setField('carton_width_mm', e.target.value)} placeholder="Rộng" />
                <span className="text-slate-400 text-xs">×</span>
                <Input type="number" min={0} step="0.1" className="h-7 text-xs" value={form.carton_height_mm} onChange={e => setField('carton_height_mm', e.target.value)} placeholder="Cao" />
              </div>
            </div>

            {/* Luật xếp chồng (xếp xe 3D): số lớp tối đa + hàng nhẹ được lên nóc hàng khác */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Số lớp xếp tối đa</Label>
              <div className="col-span-2 flex items-center gap-3">
                <Input type="number" min={1} className="h-7 text-xs w-24" value={form.max_stack_layers} onChange={e => setField('max_stack_layers', e.target.value)} placeholder="∞" />
                <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                  <input type="checkbox" checked={stackOnTop} onChange={e => setStackOnTop(e.target.checked)} className="h-3.5 w-3.5 rounded accent-blue-600" />
                  Xếp trên hàng khác (hàng nhẹ)
                </label>
              </div>
            </div>

            {/* HSD */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">
                HSD (ngày){needsShelfLife(form.category, whTypeMeta) && ' *'}
              </Label>
              <Input type="number" min={0} className="col-span-2 h-7 text-xs" value={form.shelf_life_days} onChange={e => setField('shelf_life_days', e.target.value)} placeholder="Số ngày hạn sử dụng" />
            </div>

            {/* Mã tắt (mã lô) — chỉ ĐV2 tem `;`: 2 ký tự đầu mã lô để sinh tem (vd TA → TA260705A018) */}
            {isV2Format && (
              <div className="grid grid-cols-3 items-center gap-2">
                <Label className="text-xs text-right">Mã tắt (mã lô)</Label>
                <div className="col-span-2">
                  <Input maxLength={2} className="h-7 text-xs uppercase w-24" value={form.batch_prefix}
                    onChange={e => setField('batch_prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="TA" />
                  <p className="text-[10px] text-slate-400 mt-0.5">2 ký tự đầu mã lô khi sinh tem (;) — khớp mã lô kế toán, vd <b>TA</b> → TA260705A018.</p>
                </div>
              </div>
            )}

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
                        {/* Cho phép TRÙNG NCC: 1 NCC khai nhiều shelflife (vd 100 & 200 ngày) */}
                        {nccList.map(c => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">{c.code} – {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input type="number" min={1} className="w-20 h-7 text-xs" value={ov.shelf_life_days} onChange={e => setSupplierOverrideField(i, 'shelf_life_days', e.target.value)} placeholder="Ngày" />
                    <button onClick={() => removeSupplierOverride(i)} className="text-slate-400 hover:text-red-500 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {nccList.length > 0 && (
                  <button onClick={addSupplierOverride} className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700">
                    <PlusCircle className="h-3 w-3" />Thêm Ngoại lệ NCC
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

            {/* Ghi chú */}
            <div className="grid grid-cols-3 items-start gap-2">
              <Label className="text-xs text-right pt-1.5">Ghi chú</Label>
              <Input className="col-span-2 h-7 text-xs" value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Ghi chú thêm (tùy chọn)" />
            </div>

            {/* Quản tồn — chọn cách theo dõi tồn (SingleSelect cho rõ) */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-xs text-right">Quản tồn</Label>
              <div className="col-span-2">
                <SingleSelect
                  options={[
                    { value: 'qr',  label: 'Quản theo QR từng pallet' },
                    { value: 'qty', label: 'Không quản QR (theo số lượng)' },
                  ]}
                  value={noQr ? 'qty' : 'qr'}
                  onChange={v => setNoQr(v === 'qty')}
                  searchable={false}
                  triggerClassName="h-7 w-full text-xs"
                />
              </div>
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
      </FormSheet>

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

      {/* ── Bulk no-QR confirm ────────────────────────────────────────── */}
      <Dialog open={bulkQrOpen} onOpenChange={open => !open && setBulkQrOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Không theo dõi QR — {selected.size} mã hàng</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-1">{selected.size} mã hàng sẽ được đánh dấu "Không theo dõi QR code". Tiếp tục?</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkQrOpen(false)} className="text-xs h-7">Hủy</Button>
            <Button size="sm" onClick={handleBulkNoQr} disabled={bulkQrSaving} className="text-xs h-7 bg-amber-500 hover:bg-amber-600 text-white">
              {bulkQrSaving ? 'Đang lưu…' : `Xác nhận ${selected.size} mã`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk sửa quy cách xếp xe (D×R×C + số lớp + hàng nhẹ) ─────────── */}
      <Dialog open={bulkPackOpen} onOpenChange={open => !open && !bulkPackSaving && setBulkPackOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Quy cách xếp xe — {selected.size} mã hàng</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-slate-500">Chỉ ô CÓ GIÁ TRỊ được áp cho {selected.size} mã đã chọn — ô bỏ trống giữ nguyên từng mã.</p>
            <div className="space-y-1">
              <Label className="text-xs">Thùng D×R×C (mm)</Label>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={0} step="0.1" className="h-8 text-xs" value={bulkPack.l} onChange={e => setBulkPack(p => ({ ...p, l: e.target.value }))} placeholder="Dài" />
                <span className="text-slate-400 text-xs">×</span>
                <Input type="number" min={0} step="0.1" className="h-8 text-xs" value={bulkPack.w} onChange={e => setBulkPack(p => ({ ...p, w: e.target.value }))} placeholder="Rộng" />
                <span className="text-slate-400 text-xs">×</span>
                <Input type="number" min={0} step="0.1" className="h-8 text-xs" value={bulkPack.h} onChange={e => setBulkPack(p => ({ ...p, h: e.target.value }))} placeholder="Cao" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Số lớp xếp tối đa</Label>
                <Input type="number" min={1} className="h-8 text-xs" value={bulkPack.layers} onChange={e => setBulkPack(p => ({ ...p, layers: e.target.value }))} placeholder="Giữ nguyên" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hàng nhẹ (xếp trên hàng khác)</Label>
                <select value={bulkPack.onTop} onChange={e => setBulkPack(p => ({ ...p, onTop: e.target.value }))}
                  className="w-full h-8 text-xs border border-input rounded-md px-2 bg-white">
                  <option value="">Giữ nguyên</option>
                  <option value="1">Bật — được xếp lên nóc</option>
                  <option value="0">Tắt</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBulkPackOpen(false)} disabled={bulkPackSaving} className="text-xs h-7">Hủy</Button>
            <Button size="sm" onClick={handleBulkPack} disabled={bulkPackSaving || !bulkPackHasChange} className="text-xs h-7">
              {bulkPackSaving ? 'Đang lưu…' : `Áp cho ${selected.size} mã`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showUpload && (
        <UploadExcelDialog
          title="Upload Mã hàng từ Excel"
          hint="Mã mới → thêm (Tên hàng bắt buộc). Mã đã có → cập nhật ô có giá trị (ô trống = giữ nguyên)."
          onClose={() => setShowUpload(false)}
          onDownloadTemplate={downloadMaterialTemplate}
          onUpload={file => uploadMaterials.mutateAsync({ file })}
        />
      )}
    </div>
  )
}
