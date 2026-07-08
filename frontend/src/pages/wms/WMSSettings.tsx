import { useState, useEffect } from 'react'
import type { AxiosError } from 'axios'
import { Plus, Pencil, Trash2, Warehouse, Tag, Settings2, MapPin, X, Clock, ShieldCheck, GripVertical, SlidersHorizontal, Check } from 'lucide-react'
import { formatDateTime } from '@/utils/formatters'
import { Button }   from '@/components/ui/button'
import { Input }    from '@/components/ui/input'
import { Label }    from '@/components/ui/label'
import { Badge }    from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/use-toast'
import { FormSheet } from '@/components/shared/FormSheet'
import { FilterBar, type FilterDef } from '@/components/shared/FilterBar'
import { SearchInput } from '@/components/shared/SearchInput'
import { SingleSelect } from '@/components/shared/SingleSelect'
import {
  useWarehouses, useCreateWarehouse, useUpdateWarehouse, useDeleteWarehouse,
  useWarehouseTypes, useAddWarehouseType, useUpdateWarehouseType, useDeleteWarehouseType, useReorderWarehouseTypes,
  useWarehouseZones, useCreateWarehouseZone, useUpdateWarehouseZone, useDeleteWarehouseZone,
  useImportShifts, useCreateImportShift, useUpdateImportShift,
  useQAStatuses, useCreateQAStatus, useUpdateQAStatus,
  useSystemSettings, useUpdateSystemSetting,
  type WarehouseZone,
} from '@/api/hooks'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWhTypes } from '@/hooks/useUserScope'

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

// ─── Tab Hệ thống (SystemSetting — cờ hành vi per-DB, multi-tenant silo) ─────
// Cờ theo KHÁC BIỆT giữa các đơn vị, không theo tên đơn vị. Sổ cờ: backend systemSettingController.

const LABEL_FORMAT_OPTS = [
  { value: 'underscore', label: 'Tem gạch dưới ( _ )', sub: 'ddmmyy_Mã_ChuKỳ_Máy_STT_NMSX — vd 070526_510000127_C05_M1_001_B' },
  { value: 'semicolon',  label: 'Tem chấm phẩy ( ; )', sub: 'Mã hàng;QA;Mã lô;NSX;HSD;Giờ SX — vd 50033;1;TA260705A045;05/07/2026;05/03/2027;1;05:26' },
]

// Cờ xác nhận giao hàng — quyết định xuất kho có tạo booking TMS (Chuyển kho) không + theo hình thức kho nhận nào.
const DC_MODE_OPTS = [
  { value: 'QR',    label: 'Kho QR — tồn kho QR (nhận & quét như hiện tại)' },
  { value: 'QTY',   label: 'Kho QTY — tồn số lượng (nhận & quét như hiện tại)' },
  { value: 'NONE',  label: 'Kho NONE — không quản tồn (tài xế tự Hoàn thành)' },
  { value: 'OTHER', label: 'Khác — khách không có trong DB (tài xế tự Hoàn thành)' },
]
type DeliveryConf = { enabled: boolean; modes: string[] }
function parseDc(v: unknown): DeliveryConf {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as { enabled?: unknown; modes?: unknown }
    return {
      enabled: o.enabled === true,
      modes: Array.isArray(o.modes) ? o.modes.filter((m): m is string => typeof m === 'string') : [],
    }
  }
  return { enabled: true, modes: ['QR', 'QTY'] }   // mặc định = hành vi đơn vị 1
}

// Dòng lựa chọn full-width — radio (1-chọn) hoặc checkbox (nhiều-chọn). Mỗi option = 1 dòng.
function OptionRow({ selected, disabled, checkbox, title, sub, onClick }: {
  selected: boolean; disabled?: boolean; checkbox?: boolean; title: string; sub?: string; onClick: () => void
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
        selected ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500' : 'border-slate-200 bg-white hover:border-slate-300'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`mt-0.5 h-4 w-4 shrink-0 flex items-center justify-center border ${checkbox ? 'rounded' : 'rounded-full'} ${
        selected ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white'
      }`}>
        {selected && (checkbox ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />)}
      </span>
      <span className="min-w-0">
        <span className={`text-sm font-medium ${selected ? 'text-sky-800' : 'text-slate-700'}`}>{title}</span>
        {sub && <p className="text-[11px] text-slate-500 mt-0.5 break-words leading-snug">{sub}</p>}
      </span>
    </button>
  )
}

function SystemTab({ canManage }: { canManage: boolean }) {
  const { data: settings = [], isLoading } = useSystemSettings()
  const { mutateAsync: save, isPending } = useUpdateSystemSetting()
  const [err, setErr] = useState('')

  const labelRow = settings.find(s => s.key === 'label_format')
  const dcRow    = settings.find(s => s.key === 'delivery_confirmation')
  const srvLabel = typeof labelRow?.value === 'string' ? labelRow.value : 'underscore'
  const srvDc    = parseDc(dcRow?.value)

  // Draft (nháp) — thay đổi được STAGE tại chỗ, chỉ bấm "Lưu thay đổi" mới áp dụng.
  const [draftLabel, setDraftLabel] = useState(srvLabel)
  const [draftDc,    setDraftDc]    = useState<DeliveryConf>(srvDc)
  const srvKey = JSON.stringify([srvLabel, srvDc])
  const [baseKey, setBaseKey] = useState(srvKey)
  useEffect(() => {
    if (srvKey !== baseKey) { setDraftLabel(srvLabel); setDraftDc(srvDc); setBaseKey(srvKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srvKey])

  const labelDirty = draftLabel !== srvLabel
  const dcDirty    = JSON.stringify(draftDc) !== JSON.stringify(srvDc)
  const dirty      = labelDirty || dcDirty

  async function applyChanges() {
    setErr('')
    try {
      if (labelDirty) await save({ key: 'label_format', value: draftLabel })
      if (dcDirty)    await save({ key: 'delivery_confirmation', value: draftDc })
      toast({ title: 'Đã lưu cấu hình hệ thống' })
    } catch (e) { setErr(apiMsg(e)) }
  }
  const resetDraft = () => { setDraftLabel(srvLabel); setDraftDc(srvDc); setErr('') }
  const toggleMode = (v: string) => setDraftDc(d => ({
    enabled: true, modes: d.modes.includes(v) ? d.modes.filter(m => m !== v) : [...d.modes, v],
  }))

  if (isLoading) return <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-6">
        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

        {/* 1. Định dạng tem pallet */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-800">1. Định dạng tem pallet</h3>
            {labelRow?.updated_by && <span className="text-[10px] text-slate-400">Cập nhật: {labelRow.updated_by} · {formatDateTime(labelRow.updated_at)}</span>}
          </div>
          <p className="text-[11px] text-slate-500">Chỉ áp cho chiều IN tem từ app. Chiều quét nhận theo định dạng của đơn vị.</p>
          <div className="space-y-2">
            {LABEL_FORMAT_OPTS.map(o => (
              <OptionRow key={o.value} selected={draftLabel === o.value} disabled={!canManage}
                title={o.label} sub={o.sub} onClick={() => setDraftLabel(o.value)} />
            ))}
          </div>
        </div>

        <div className="border-t border-slate-200" />

        {/* 2. Xác nhận giao hàng */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-800">2. Xác nhận giao hàng</h3>
            {dcRow?.updated_by && <span className="text-[10px] text-slate-400">Cập nhật: {dcRow.updated_by} · {formatDateTime(dcRow.updated_at)}</span>}
          </div>
          <p className="text-[11px] text-slate-500">Khi xuất kho: "Không" → không tạo booking Chuyển kho. "Có" → tạo booking theo hình thức kho nhận chọn dưới.</p>
          <div className="space-y-2">
            <OptionRow selected={draftDc.enabled} disabled={!canManage}
              title="Có xác nhận giao hàng" sub="Xuất kho tạo booking TMS (Chuyển kho) theo hình thức kho nhận."
              onClick={() => setDraftDc(d => ({ ...d, enabled: true }))} />
            <OptionRow selected={!draftDc.enabled} disabled={!canManage}
              title="Không xác nhận giao hàng" sub="Xuất kho KHÔNG tạo booking Chuyển kho."
              onClick={() => setDraftDc(d => ({ ...d, enabled: false }))} />
          </div>
          {draftDc.enabled && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] font-medium text-slate-600">Hình thức kho nhận sẽ tạo booking:</p>
              {DC_MODE_OPTS.map(opt => (
                <OptionRow key={opt.value} checkbox selected={draftDc.modes.includes(opt.value)} disabled={!canManage}
                  title={opt.label} onClick={() => toggleMode(opt.value)} />
              ))}
              {draftDc.modes.length === 0 && (
                <p className="text-[11px] text-amber-600">Chưa chọn hình thức nào → xuất kho sẽ không tạo booking cho loại nào.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Thanh Lưu dính đáy — stage rồi mới áp dụng */}
      {canManage && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-2.5 flex items-center gap-3">
          <span className={`text-[11px] ${dirty ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
            {dirty ? '● Có thay đổi chưa lưu' : 'Đã lưu'}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" disabled={!dirty || isPending} onClick={resetDraft}>Hoàn tác</Button>
            <Button size="sm" disabled={!dirty || isPending} onClick={applyChanges}>
              {isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Warehouse Dialog ─────────────────────────────────────────────────────────

interface WhRow { id: string; code: string; name: string; address: string | null; is_active: boolean; warehouse_type: string; inventory_mode: string; shipto_codes?: string[] | null; nmsx_code?: string | null; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }

// Chế độ quản tồn — độc lập với warehouse_type (CENTRAL/NPP). Xem migration 20260626_warehouse_inventory_mode.sql
type InvMode = 'QR' | 'QTY' | 'NONE'
const INV_MODE_META: Record<InvMode, { label: string; desc: string; badge: string }> = {
  QR:   { label: 'Tồn kho QR',     desc: 'Theo dõi tồn đầy đủ qua QR (pallet/vị trí/quét)', badge: 'border-green-400 text-green-700 bg-green-50' },
  QTY:  { label: 'Tồn kho số lượng', desc: 'Theo dõi tồn dạng số lượng, không pallet/QR',     badge: 'border-sky-400 text-sky-700 bg-sky-50' },
  NONE: { label: 'Không quản tồn',  desc: 'Không theo dõi tồn (điểm trung chuyển/giao nhận)', badge: 'border-slate-300 text-slate-500 bg-slate-50' },
}
const invModeMeta = (m: string) => INV_MODE_META[(m as InvMode)] ?? INV_MODE_META.QR

function WarehouseDialog({ wh, open, onClose }: { wh: WhRow | null; open: boolean; onClose: () => void }) {
  const isEdit = !!wh
  const [code,          setCode]          = useState(wh?.code ?? '')
  const [name,          setName]          = useState(wh?.name ?? '')
  const [address,       setAddress]       = useState(wh?.address ?? '')
  const [warehouseType, setWarehouseType] = useState<'CENTRAL' | 'NPP'>((wh?.warehouse_type as 'CENTRAL' | 'NPP') ?? 'CENTRAL')
  const [invMode,       setInvMode]       = useState<InvMode>((wh?.inventory_mode as InvMode) ?? 'QR')
  const [shiptoCodes,   setShiptoCodes]   = useState((wh?.shipto_codes ?? []).join(', '))
  const [nmsxCode,      setNmsxCode]      = useState(wh?.nmsx_code ?? '')
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
        { id: wh.id, name: name.trim(), address: address.trim() || undefined, is_active: isActive, warehouse_type: warehouseType, inventory_mode: invMode, shipto_codes: shiptoCodes, nmsx_code: nmsxCode },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    } else {
      create(
        { code: code.trim(), name: name.trim(), address: address.trim() || undefined, warehouse_type: warehouseType, inventory_mode: invMode, shipto_codes: shiptoCodes, nmsx_code: nmsxCode },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sửa kho' : 'Thêm kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
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
          <div className="space-y-1">
            <Label className="text-xs">Chế độ quản tồn *</Label>
            <Select value={invMode} onValueChange={v => setInvMode(v as InvMode)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(INV_MODE_META) as InvMode[]).map(m => (
                  <SelectItem key={m} value={m}>{INV_MODE_META[m].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400">{INV_MODE_META[invMode].desc}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mã ship-to phụ</Label>
            <Input value={shiptoCodes} onChange={e => setShiptoCodes(e.target.value.toUpperCase())} placeholder="vd: 20000018, 20000019" />
            <p className="text-[10px] text-slate-400">Ngoài mã kho chính. Nhiều mã cách nhau dấu phẩy. Chuyển kho về các mã này đều tự nhận về kho này.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mã NMSX (kho tổng)</Label>
            <Input value={nmsxCode} onChange={e => setNmsxCode(e.target.value.toUpperCase())} placeholder="vd: B, D…" maxLength={8} />
            <p className="text-[10px] text-slate-400">Đoạn thứ 6 của QR pallet + tiền tố mã vị trí. Để trống nếu kho không có NMSX (vị trí sẽ dùng mã kho). Không trùng giữa các kho.</p>
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="wh-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="wh-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
    </FormSheet>
  )
}

// ─── Zone Dialog ──────────────────────────────────────────────────────────────

function ZoneDialog({ zone, warehouseId, warehouses, warehouseTypes, open, onClose }: {
  zone: WarehouseZone | null; warehouseId: string; warehouses: WhRow[]
  warehouseTypes: { id: string; value: string }[]; open: boolean; onClose: () => void
}) {
  const isEdit = !!zone
  const [selectedWhId, setSelectedWhId] = useState(zone?.warehouse_id ?? warehouseId)
  const [code,     setCode]     = useState(zone?.code ?? '')
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
        { warehouse_id: selectedWhId, name: name.trim(), category: category || undefined, code: code.trim() || undefined },
        { onSuccess: onClose, onError: e => setErr(apiMsg(e)) }
      )
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sửa khu vực' : 'Thêm khu vực kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !name.trim() || (!isEdit && !selectedWhId)}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
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

          {/* Mã khu vực */}
          <div className="space-y-1">
            <Label className="text-xs">Mã khu vực{!isEdit && <span className="text-slate-400"> (tùy chọn)</span>}</Label>
            {isEdit ? (
              <p className="text-sm font-mono font-semibold text-slate-700">{zone.code}</p>
            ) : (
              <>
                <Input value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="vd: TP1, K4RAW…" />
                <p className="text-[10px] text-slate-400">Là phần giữa mã vị trí (B_<b>TP1</b>_1_T1). Để trống = tự tạo Z01, Z02… Không trùng trong cùng kho (khác kho trùng nhau OK).</p>
              </>
            )}
          </div>

          {/* Tên */}
          <div className="space-y-1">
            <Label className="text-xs">Tên khu vực *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Khu Thành phẩm, Khu NVL…" />
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input id="zone-active" type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
              <Label htmlFor="zone-active" className="text-sm cursor-pointer">Đang hoạt động</Label>
            </div>
          )}
        </div>
    </FormSheet>
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
    <FormSheet open={open} onClose={onClose} title={isEdit ? 'Sửa loại kho' : 'Thêm loại kho'} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !value.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          <div className="space-y-1">
            <Label className="text-xs">Tên loại kho *</Label>
            <Input value={value} onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="Thành phẩm, NVL, POSM…" />
          </div>
        </div>
    </FormSheet>
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
    <FormSheet open={open} onClose={onClose} title={isEdit ? `Sửa ${noun}` : `Thêm ${noun}`} widthClass="sm:max-w-lg" footer={<>
          <Button variant="outline" size="sm" onClick={onClose}>Huỷ</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !code.trim() || !name.trim()}>
            {isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>}>
        <div className="space-y-3">
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
    </FormSheet>
  )
}

function MetaTab({ noun, rows, loading, canManage, onAdd, onEdit }: {
  noun: string; rows: MetaRow[]; loading: boolean; canManage: boolean
  onAdd: () => void; onEdit: (r: MetaRow) => void
}) {
  return (
    <>
      <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2">
        <p className="text-xs text-slate-500 flex-1">{rows.length} {noun}</p>
        {canManage && (
          <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" /> Thêm {noun}
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {loading ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
          rows.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">Chưa có {noun} nào</div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Thứ tự</TableHead>
                    <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                    {canManage && <TableHead className="px-2 py-1.5 w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id} className={`${!r.is_active ? 'opacity-50' : ''}`}>
                      <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{r.code}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800 whitespace-nowrap">{r.name}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-500 tabular-nums whitespace-nowrap">{r.display_order}</TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <Badge variant={r.is_active ? 'default' : 'secondary'} className="text-xs">
                          {r.is_active ? 'Hoạt động' : 'Tạm dừng'}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <button className="text-slate-400 hover:text-blue-500 p-1 transition-colors" onClick={() => onEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          )
        }
      </div>
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WMSSettings() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const admin = isAdmin(user?.name)
  // Mỗi tab = 1 quyền riêng (ẩn tab nếu không có quyền). Admin thấy hết.
  const canManageWarehouse = admin || can(perms, 'wms_settings', 'manage_warehouse')
  const canManageType      = admin || can(perms, 'wms_settings', 'manage_type')
  const canManageZone      = admin || can(perms, 'wms_settings', 'manage_zone')
  const canManageShift     = admin || can(perms, 'wms_settings', 'manage_shift')
  const canManageQA        = admin || can(perms, 'wms_settings', 'manage_qa')
  const canManageSystem    = admin || can(perms, 'wms_settings', 'manage_system')
  const visibleTabs = [
    canManageWarehouse && 'warehouses',
    canManageType      && 'types',
    canManageZone      && 'zones',
    canManageShift     && 'shifts',
    canManageQA        && 'qa',
    canManageSystem    && 'system',
  ].filter(Boolean) as string[]
  const defaultTab = visibleTabs[0]

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

  // Kéo-thả sắp thứ tự loại kho (kiểu AppSheet: grip + chỉ báo trên/dưới theo nửa dòng)
  type TypeRow = { id: string; value: string; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null }
  const reorderTypes = useReorderWarehouseTypes()
  const [orderedTypes, setOrderedTypes] = useState<TypeRow[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overType, setOverType] = useState<{ idx: number; below: boolean } | null>(null)
  // Đồng bộ từ server khi KHÔNG đang kéo (sau reorder, refetch sẽ cập nhật đúng thứ tự).
  // Dep = chuỗi id ổn định (KHÔNG dùng ref mảng — fallback [] đổi ref mỗi render → loop vô hạn).
  const typesKey = (warehouseTypes as TypeRow[]).map(t => t.id).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (dragIdx === null) setOrderedTypes(warehouseTypes as TypeRow[]) }, [typesKey, dragIdx])
  function dropType() {
    const from = dragIdx, ov = overType
    setDragIdx(null); setOverType(null)
    if (from === null || !ov) return
    let toIdx = ov.below ? ov.idx + 1 : ov.idx
    if (from < toIdx) toIdx--               // bù lại do đã splice phần tử kéo
    if (toIdx === from) return
    const next = [...orderedTypes]
    const [moved] = next.splice(from, 1)
    next.splice(toIdx, 0, moved)
    setOrderedTypes(next)
    reorderTypes.mutate(next.map(t => t.id), {
      onError: e => { toast({ variant: 'destructive', title: 'Không lưu được thứ tự', description: apiMsg(e) }); setOrderedTypes(warehouseTypes as TypeRow[]) },
    })
  }

  // Detail panel state
  const [detailWh,   setDetailWh]   = useState<WhRow | null>(null)
  const [detailType, setDetailType] = useState<{ id: string; value: string; created_at?: string; updated_at?: string; created_by?: string | null; updated_by?: string | null } | null>(null)
  const [detailZone, setDetailZone] = useState<WarehouseZone | null>(null)

  // Khu vực kho — lọc theo warehouse_scope của user
  // Loại kho trong form/filter Khu vực cắt theo allowed_categories (tab Loại kho vẫn full — quản trị taxonomy)
  const { data: scopedWhTypes = [] } = useScopedWhTypes()
  const activeWh = (allWh as WhRow[]).filter(w => w.is_active)
  // Scope kho cho tab Khu vực: ASSIGNED → chỉ kho được gán (khớp gác BE zoneController); còn lại → tất cả.
  const zoneAccessWh = (admin || user?.warehouse_scope !== 'ASSIGNED')
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

  // ── Filter: Kho ──
  const [whSearch, setWhSearch] = useState('')
  const [whFunc,   setWhFunc]   = useState('')   // '' | CENTRAL | NPP
  const [whInv,    setWhInv]    = useState('')   // '' | QR | QTY | NONE
  const [whStatus, setWhStatus] = useState('')   // '' | active | inactive
  const whRank = (t: string) => (t === 'CENTRAL' ? 0 : t === 'NPP' ? 1 : 2)
  const filteredWh = (allWh as WhRow[]).filter(w => {
    if (whFunc && w.warehouse_type !== whFunc) return false
    if (whInv && w.inventory_mode !== whInv) return false
    if (whStatus && (whStatus === 'active') !== w.is_active) return false
    const q = whSearch.trim().toLowerCase()
    if (q && !`${w.code} ${w.name} ${w.address ?? ''}`.toLowerCase().includes(q)) return false
    return true
  }).sort((a, b) => {
    // Kho tổng (CENTRAL) trước, rồi NPP; trong cùng nhóm sắp theo địa chỉ
    if (whRank(a.warehouse_type) !== whRank(b.warehouse_type)) return whRank(a.warehouse_type) - whRank(b.warehouse_type)
    return (a.address ?? '').localeCompare(b.address ?? '', 'vi')
  })
  const whFilterDefs: FilterDef[] = [
    { key: 'func', label: 'Chức năng', type: 'single', value: whFunc, onChange: setWhFunc, allLabel: 'Tất cả',
      options: [{ value: 'CENTRAL', label: 'Kho tổng' }, { value: 'NPP', label: 'Kho NPP' }] },
    { key: 'inv', label: 'Quản tồn', type: 'single', value: whInv, onChange: setWhInv, allLabel: 'Tất cả',
      options: (Object.keys(INV_MODE_META) as InvMode[]).map(m => ({ value: m, label: INV_MODE_META[m].label })) },
    { key: 'wst', label: 'Trạng thái', type: 'single', value: whStatus, onChange: setWhStatus, allLabel: 'Tất cả',
      options: [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Tạm dừng' }] },
  ]

  // ── Filter: Khu vực kho ──
  const [zoneSearch, setZoneSearch] = useState('')
  const [zoneCat,    setZoneCat]    = useState('')
  const [zoneStatus, setZoneStatus] = useState('')
  const filteredZones = (zones as WarehouseZone[]).filter(z => {
    if (zoneCat && (z.category ?? '') !== zoneCat) return false
    if (zoneStatus && (zoneStatus === 'active') !== z.is_active) return false
    const q = zoneSearch.trim().toLowerCase()
    if (q && !`${z.code} ${z.name}`.toLowerCase().includes(q)) return false
    return true
  })
  const zoneFilterDefs: FilterDef[] = [
    { key: 'zcat', label: 'Loại kho', type: 'single', value: zoneCat, onChange: setZoneCat, allLabel: 'Tất cả',
      options: (scopedWhTypes as { id: string; value: string }[]).map(t => ({ value: t.value, label: t.value })) },
    { key: 'zst', label: 'Trạng thái', type: 'single', value: zoneStatus, onChange: setZoneStatus, allLabel: 'Tất cả',
      options: [{ value: 'active', label: 'Hoạt động' }, { value: 'inactive', label: 'Tạm dừng' }] },
  ]

  function handleDeleteWh(wh: WhRow) {
    if (!confirm(`Xóa kho "${wh.name}"?\nChỉ xóa được kho chưa có vị trí nào.`)) return
    deleteWh(wh.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được kho', description: apiMsg(e) }) })
  }

  function handleDeleteZone(z: WarehouseZone) {
    if (!confirm(`Xóa khu vực "${z.code} – ${z.name}"?`)) return
    deleteZone(z.id, { onError: e => toast({ variant: 'destructive', title: 'Không xóa được khu vực', description: apiMsg(e) }) })
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {!defaultTab ? (
        <div className="p-12 text-center text-slate-400 text-sm">
          Bạn chưa được cấp quyền quản lý mục nào trong Cài đặt WMS.
        </div>
      ) : (
      <Tabs defaultValue={defaultTab} className="flex flex-col flex-1 min-h-0">
        {/* Phần trên gọn 1 hàng (tiêu đề + tab) — bảng chiếm toàn bộ phần còn lại */}
        <div className="border-b bg-white px-3 py-2 shrink-0 flex items-center gap-2 flex-wrap sm:rounded-t-xl">
          <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
            <Settings2 className="h-4 w-4 text-slate-500" /> Cài đặt WMS
          </span>
          <TabsList className="h-8 max-w-full overflow-x-auto">
            {canManageWarehouse && <TabsTrigger value="warehouses" className="gap-1.5 text-xs"><Warehouse className="h-3.5 w-3.5" /> Kho</TabsTrigger>}
            {canManageType      && <TabsTrigger value="types"      className="gap-1.5 text-xs"><Tag      className="h-3.5 w-3.5" /> Loại kho</TabsTrigger>}
            {canManageZone      && <TabsTrigger value="zones"      className="gap-1.5 text-xs"><MapPin     className="h-3.5 w-3.5" /> Khu vực</TabsTrigger>}
            {canManageShift     && <TabsTrigger value="shifts"     className="gap-1.5 text-xs"><Clock      className="h-3.5 w-3.5" /> Ca nhập</TabsTrigger>}
            {canManageQA        && <TabsTrigger value="qa"         className="gap-1.5 text-xs"><ShieldCheck className="h-3.5 w-3.5" /> QA</TabsTrigger>}
            {canManageSystem    && <TabsTrigger value="system"     className="gap-1.5 text-xs"><SlidersHorizontal className="h-3.5 w-3.5" /> Hệ thống</TabsTrigger>}
          </TabsList>
        </div>

        {/* ── Tab: Kho ── */}
        <TabsContent value="warehouses" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <SearchInput value={whSearch} onChange={setWhSearch} placeholder="Tìm mã, tên, địa chỉ kho…" className="flex-1 min-w-[160px]" />
            <FilterBar defs={whFilterDefs} />
            {canManageWarehouse && (
              <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={() => { setEditingWh(null); setShowWhDlg(true) }}>
                <Plus className="h-3.5 w-3.5" /> Thêm kho
              </Button>
            )}
          </div>
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              {loadingWh ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
                filteredWh.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 text-sm">Không có kho khớp bộ lọc</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">NMSX</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Ship-to phụ</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên kho</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Chức năng</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Quản tồn</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Địa chỉ</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                        {canManageWarehouse && <TableHead className="px-2 py-1.5 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWh.map(wh => (
                        <TableRow key={wh.id}
                          className={`cursor-pointer ${!wh.is_active ? 'opacity-50' : ''} ${detailWh?.id === wh.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailWh(prev => prev?.id === wh.id ? null : wh)}>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{wh.code}</TableCell>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{wh.nmsx_code || <span className="text-slate-300 font-sans font-normal">—</span>}</TableCell>
                          <TableCell className="px-2 py-1 font-mono text-[10px] text-slate-500 whitespace-nowrap">{wh.shipto_codes?.length ? wh.shipto_codes.join(', ') : <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800 whitespace-nowrap">{wh.name}</TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant="outline" className={`text-[10px] ${wh.warehouse_type === 'NPP' ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-blue-400 text-blue-700 bg-blue-50'}`}>
                              {wh.warehouse_type === 'NPP' ? 'Kho NPP' : 'Kho tổng'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant="outline" className={`text-[10px] ${invModeMeta(wh.inventory_mode).badge}`}>
                              {invModeMeta(wh.inventory_mode).label}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{wh.address ?? '—'}</TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant={wh.is_active ? 'default' : 'secondary'} className="text-xs">
                              {wh.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {canManageWarehouse && (
                            <TableCell className="px-2 py-1 whitespace-nowrap">
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
              )}
            </div>
            {detailWh && (
              <aside className="hidden lg:block w-60 shrink-0 border-l p-3 space-y-2 text-xs overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">{detailWh.code} — {detailWh.name}</span>
                  <button onClick={() => setDetailWh(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
                <div><span className="text-slate-400">Chức năng:</span> <span className="font-medium">{detailWh.warehouse_type === 'NPP' ? 'Kho NPP' : 'Kho tổng'}</span></div>
                <div><span className="text-slate-400">Quản tồn:</span> <span className="font-medium">{invModeMeta(detailWh.inventory_mode).label}</span></div>
                <div><span className="text-slate-400">NMSX:</span> <span className="font-mono font-medium">{detailWh.nmsx_code || '—'}</span></div>
                <div><span className="text-slate-400">Ship-to phụ:</span> <span className="font-mono font-medium">{detailWh.shipto_codes?.length ? detailWh.shipto_codes.join(', ') : '—'}</span></div>
                <div><span className="text-slate-400">Địa chỉ:</span> <span className="font-medium">{detailWh.address ?? '—'}</span></div>
                <div><span className="text-slate-400">Trạng thái:</span> <span className="font-medium">{detailWh.is_active ? 'Hoạt động' : 'Tạm dừng'}</span></div>
                <div className="border-t pt-2 space-y-1.5">
                  <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">Tạo / Sửa</p>
                  <div><span className="text-slate-400">Người tạo:</span> <span className="font-medium">{detailWh.created_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ tạo:</span> <span className="font-medium">{detailWh.created_at ? formatDateTime(detailWh.created_at) : '—'}</span></div>
                  <div><span className="text-slate-400">Người sửa:</span> <span className="font-medium">{detailWh.updated_by ?? '—'}</span></div>
                  <div><span className="text-slate-400">Ngày giờ sửa:</span> <span className="font-medium">{detailWh.updated_at ? formatDateTime(detailWh.updated_at) : '—'}</span></div>
                </div>
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1–{filteredWh.length} / {(allWh as WhRow[]).length} kho</div>
        </TabsContent>

        {/* ── Tab: Loại kho ── */}
        <TabsContent value="types" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <p className="text-xs text-slate-500 flex-1 min-w-[160px] truncate">
              {canManageType ? <>Kéo <GripVertical className="inline h-3 w-3 -mt-0.5" /> để đổi thứ tự (áp cho cây Đăng ký cổng)</> : 'Danh mục loại kho'}
            </p>
            {canManageType && (
              <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={() => { setEditingType(null); setShowTypeDlg(true) }}>
                <Plus className="h-3.5 w-3.5" /> Thêm loại kho
              </Button>
            )}
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
              {loadingTypes ? <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div> :
                warehouseTypes.length === 0 ? (
                  <div className="p-12 text-center text-slate-400 space-y-2">
                    <Tag className="h-10 w-10 mx-auto opacity-30" />
                    <p className="text-sm">Chưa có loại kho nào</p>
                    {canManageType && <p className="text-xs">Nhấn "Thêm loại kho" để tạo loại kho đầu tiên</p>}
                  </div>
                ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {canManageType && <TableHead className="px-2 py-1.5 w-8" />}
                          <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên loại kho</TableHead>
                          {canManageType && <TableHead className="px-2 py-1.5 w-16" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderedTypes.map((t, idx) => {
                          const isOver = overType?.idx === idx && dragIdx !== null && dragIdx !== idx
                          return (
                          <TableRow key={t.id}
                            draggable={canManageType}
                            onDragStart={() => setDragIdx(idx)}
                            onDragOver={canManageType ? (e => {
                              e.preventDefault()
                              const r = e.currentTarget.getBoundingClientRect()
                              const below = (e.clientY - r.top) > r.height / 2
                              if (overType?.idx !== idx || overType?.below !== below) setOverType({ idx, below })
                            }) : undefined}
                            onDrop={canManageType ? (e => { e.preventDefault(); dropType() }) : undefined}
                            onDragEnd={() => { setDragIdx(null); setOverType(null) }}
                            className={`cursor-pointer ${detailType?.id === t.id ? 'bg-slate-100' : 'hover:bg-slate-50'} ${dragIdx === idx ? 'opacity-40' : ''} ${isOver && !overType?.below ? '[&>td]:border-t-2 [&>td]:border-t-sky-500' : ''} ${isOver && overType?.below ? '[&>td]:border-b-2 [&>td]:border-b-sky-500' : ''}`}
                            onClick={() => setDetailType(prev => prev?.id === t.id ? null : t)}>
                            {canManageType && (
                              <TableCell className="px-2 py-1 w-8 text-slate-300 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()} title="Kéo để đổi thứ tự">
                                <GripVertical className="h-4 w-4" />
                              </TableCell>
                            )}
                            <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800 whitespace-nowrap">{t.value}</TableCell>
                            {canManageType && (
                              <TableCell className="px-2 py-1 whitespace-nowrap">
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
                          )
                        })}
                      </TableBody>
                    </Table>
                )
              }
            </div>
            {detailType && (
              <aside className="hidden lg:block w-60 shrink-0 border-l p-3 space-y-2 text-xs overflow-y-auto">
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
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1–{orderedTypes.length} / {orderedTypes.length} loại kho</div>
        </TabsContent>

        {/* ── Tab: Khu vực kho ── */}
        <TabsContent value="zones" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <div className="border-b px-3 py-1.5 shrink-0 flex items-center gap-2 flex-wrap">
            <SingleSelect
              options={zoneAccessWh.map(w => ({ value: w.id, label: w.name, sub: w.code }))}
              value={effectiveWhId}
              onChange={setSelectedWhId}
              placeholder="Chọn kho"
              searchPlaceholder="Tìm kho…"
              triggerClassName="h-8 w-44 text-xs shrink-0"
            />
            {effectiveWhId && (
              <>
                <SearchInput value={zoneSearch} onChange={setZoneSearch} placeholder="Tìm mã, tên khu vực…" className="flex-1 min-w-[140px]" />
                <FilterBar defs={zoneFilterDefs} />
              </>
            )}
            {canManageZone && (
              <Button size="sm" className="h-7 text-xs gap-1 ml-auto shrink-0" onClick={() => { setEditingZone(null); setShowZoneDlg(true) }}>
                <Plus className="h-3.5 w-3.5" /> Thêm khu vực
              </Button>
            )}
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-auto pb-20 lg:pb-4">
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
              ) : filteredZones.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-sm">Không có khu vực khớp bộ lọc</div>
              ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã khu vực</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tên khu vực</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Loại kho</TableHead>
                        <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                        {canManageZone && <TableHead className="px-2 py-1.5 w-16" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredZones.map(z => (
                        <TableRow key={z.id}
                          className={`cursor-pointer ${!z.is_active ? 'opacity-50' : ''} ${detailZone?.id === z.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                          onClick={() => setDetailZone(prev => prev?.id === z.id ? null : z)}>
                          <TableCell className="px-2 py-1 font-mono font-semibold text-[10px] text-slate-600 whitespace-nowrap">{z.code}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] font-medium text-slate-800 whitespace-nowrap">{z.name}</TableCell>
                          <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{z.category ?? <span className="text-slate-300">—</span>}</TableCell>
                          <TableCell className="px-2 py-1 whitespace-nowrap">
                            <Badge variant={z.is_active ? 'default' : 'secondary'} className="text-xs">
                              {z.is_active ? 'Hoạt động' : 'Tạm dừng'}
                            </Badge>
                          </TableCell>
                          {canManageZone && (
                            <TableCell className="px-2 py-1 whitespace-nowrap">
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
              )}
            </div>
            {detailZone && (
              <aside className="hidden lg:block w-60 shrink-0 border-l p-3 space-y-2 text-xs overflow-y-auto">
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
              </aside>
            )}
          </div>
          <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0">1–{filteredZones.length} / {(zones as WarehouseZone[]).length} khu vực</div>
        </TabsContent>

        {/* ── Tab: Ca nhập ── */}
        <TabsContent value="shifts" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <MetaTab noun="ca nhập" rows={shifts} loading={loadingShifts} canManage={canManageShift}
            onAdd={() => { setEditShift(null); setShowShiftDlg(true) }}
            onEdit={r => { setEditShift(r); setShowShiftDlg(true) }} />
        </TabsContent>

        {/* ── Tab: Tình trạng QA ── */}
        <TabsContent value="qa" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <MetaTab noun="trạng thái QA" rows={qaStatuses} loading={loadingQA} canManage={canManageQA}
            onAdd={() => { setEditQA(null); setShowQADlg(true) }}
            onEdit={r => { setEditQA(r); setShowQADlg(true) }} />
        </TabsContent>

        {/* ── Tab: Hệ thống (cờ SystemSetting) ── */}
        <TabsContent value="system" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
          <SystemTab canManage={canManageSystem} />
        </TabsContent>
      </Tabs>
      )}

      {showWhDlg && (
        <WarehouseDialog wh={editingWh} open={showWhDlg} onClose={() => setShowWhDlg(false)} />
      )}
      {showTypeDlg && (
        <TypeDialog type={editingType} open={showTypeDlg} onClose={() => setShowTypeDlg(false)} />
      )}
      {showZoneDlg && (
        <ZoneDialog zone={editingZone} warehouseId={effectiveWhId} warehouses={zoneAccessWh} warehouseTypes={scopedWhTypes} open={showZoneDlg} onClose={() => setShowZoneDlg(false)} />
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
