// TAB "MÃ DÒNG XE" — dòng xe CON mang mã SAP, Cài đặt TMS (user chốt 23/09: "cho dòng xe con mở 1 tab là Mã dòng xe").
//
// "Các dòng xe hiện tại trở thành CHA, dưới cha có nhiều dòng CON — ở đó mới có mã SAP, tên dòng xe. Kho chỉ quan
//  tâm dòng cha để booking, đăng ký xe; điều vận mới quan tâm dòng con để làm shipment, ghép chuyến."
// Chuẩn list page (skill table-format): toolbar + FilterBar + SummaryBand + bảng cột kéo giãn, cột đầu ghim, footer đếm.
//
// 02–03/10 (user): HAI CHẾ ĐỘ bằng dải chọn đầu tab — "Chung" = master data (thêm dòng xe CHỈ ở đây; mã SAP · tên · cha · điều kiện
// bảo quản · thước đo · cách tính cước là MỘT bản cho mọi kho) · "Kho …" = cấu hình riêng của kho đó: dùng / không + sức chứa +
// điểm giao. Kho đã cấu hình riêng thì KHÔNG theo Chung nữa (bản chụp) cho tới khi bấm "Về theo chung". Ô "Non tải dưới %" và
// "m³ tối đa" đã bỏ (bàn điều vận có dải tải theo cha của kho; m³ không luật nào đọc). Cha + điều kiện bảo quản + sức chứa theo
// thước đo là BẮT BUỘC khi tạo.
import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Link2, Thermometer, PauseCircle, PlayCircle, Undo2 } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { FloatingActionBar, FLOATING_BTN } from '@/components/shared/FloatingActionBar'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { formatTimestampDate } from '@/utils/formatters'
import {
  useVehicleTypes, useVehicleModels, useCreateVehicleModel, useUpdateVehicleModel, useAssignVehicleModelParent, useDeleteVehicleModel,
  useStorageConditions, useAssignVehicleModelConditions, conditionLabel, useSetWarehouseVehicleModel, useClearWarehouseVehicleModel,
  type VehicleModel, type VehicleModelPatch, type StorageConditionRow,
} from '@/api/hooks'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được'
const nf = (n: number) => n.toLocaleString('vi-VN')
const NONE = '__none__'
const TH = 'text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'

// Cột: NGHIỆP VỤ đứng trước, cột phụ (điểm giao, sửa) ra sau — phone thấy phần chính không phải kéo ngang.
// Chế độ KHO thêm cột "Cấu hình" (Riêng / Theo chung) ngay cạnh sức chứa — người xem biết số đang in là của kho hay của Chung.
const COLS_SHARED = [
  { id: 'pick',   label: '',                 w: 36 },
  { id: 'sap',    label: 'Mã SAP',           w: 100 },
  { id: 'name',   label: 'Tên dòng xe',      w: 230 },
  { id: 'parent', label: 'Dòng xe cha',      w: 190 },
  { id: 'cond',   label: 'Điều kiện bảo quản', w: 200 },
  { id: 'cap',    label: 'Sức chứa',         w: 130 },
  { id: 'unit',   label: 'Tính cước',        w: 150 },
  { id: 'drops',  label: 'Điểm giao tối đa', w: 110 },
  { id: 'act',    label: 'Trạng thái',       w: 90 },
  { id: 'upd',    label: 'Sửa',              w: 110 },
  { id: 'ops',    label: '',                 w: 64 },
]
const COLS_WH = [
  { id: 'pick',   label: '',                 w: 36 },
  { id: 'sap',    label: 'Mã SAP',           w: 100 },
  { id: 'name',   label: 'Tên dòng xe',      w: 230 },
  { id: 'parent', label: 'Dòng xe cha',      w: 190 },
  { id: 'cond',   label: 'Điều kiện bảo quản', w: 200 },
  { id: 'cap',    label: 'Sức chứa tại kho', w: 130 },
  { id: 'drops',  label: 'Điểm giao tối đa', w: 110 },
  { id: 'act',    label: 'Dùng ở kho',       w: 90 },
  { id: 'cfg',    label: 'Cấu hình',         w: 110 },
  { id: 'unit',   label: 'Tính cước',        w: 150 },
  { id: 'ops',    label: '',                 w: 64 },
]

/** Sức chứa theo MỘT thước đo (02/10): in số của thước đo đã chọn; số kia (nếu khai) chỉ là ghi chú trong tooltip. */
const capText = (m: Pick<VehicleModel, 'capacity_mode' | 'max_pallets' | 'max_tons'>) =>
  m.capacity_mode === 'PALLET' ? (m.max_pallets ? `${nf(m.max_pallets)} pallet` : null) : (m.max_tons ? `${Number(m.max_tons).toLocaleString('vi-VN')} tấn` : null)
const capNote = (m: Pick<VehicleModel, 'capacity_mode' | 'max_pallets' | 'max_tons'>) =>
  m.capacity_mode === 'PALLET' ? (m.max_tons ? `Ghi chú: ${Number(m.max_tons).toLocaleString('vi-VN')} tấn (không dùng để xếp)` : undefined) : (m.max_pallets ? `Ghi chú: ${nf(m.max_pallets)} pallet (không dùng để xếp)` : undefined)

/** Chọn NHIỀU điều kiện bảo quản bằng chip bấm — không dùng dropdown vì form này là panel Radix (dropdown phải portal),
 *  và ngón tay bấm chip dễ hơn mở menu. 02/10: BẮT BUỘC ≥ 1 (nói thẳng dưới ô). */
function ConditionPicker({ all, value, onChange }: { all: StorageConditionRow[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code])
  if (!all.length) return <p className="text-[11px] text-amber-700">Chưa có danh mục điều kiện bảo quản — khai ở Cài đặt WMS → Điều kiện bảo quản.</p>
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {all.map(c => {
          const on = value.includes(c.value)
          return (
            <button key={c.id} type="button" onClick={() => toggle(c.value)} aria-pressed={on}
              className={`h-11 sm:h-9 px-2.5 rounded border text-xs font-medium transition-colors ${on ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {conditionLabel(c)}
            </button>
          )
        })}
      </div>
      <p className={`text-[10px] mt-1 ${value.length ? 'text-slate-500' : 'text-amber-700'}`}>{value.length ? 'Chỉ hàng thuộc các mức đã chọn mới được ghép lên dòng xe này.' : 'Bắt buộc chọn ít nhất một mức.'}</p>
    </>
  )
}

/** Form bản CHUNG (master data) — thêm dòng xe chỉ ở đây. */
function ModelForm({ row, parents, conditions, onClose }: { row: VehicleModel | null; parents: { value: string; label: string }[]; conditions: StorageConditionRow[]; onClose: () => void }) {
  const create = useCreateVehicleModel(), update = useUpdateVehicleModel()
  const [sap, setSap] = useState(row?.sap_code ?? '')
  const [name, setName] = useState(row?.name ?? '')
  const [parent, setParent] = useState(row?.parent_type_id ?? '')
  const [conds, setConds] = useState<string[]>(row?.storage_conditions ?? [])
  const [capMode, setCapMode] = useState<'PALLET' | 'TON'>(row?.capacity_mode ?? 'TON')
  const [pallets, setPallets] = useState(row?.max_pallets == null ? '' : String(row.max_pallets))
  const [tons, setTons] = useState(row?.max_tons == null ? '' : String(row.max_tons))
  const [drops, setDrops] = useState(row?.max_drops == null ? '' : String(row.max_drops))
  const [unit, setUnit] = useState<'PER_PALLET' | 'PER_TRIP'>(row?.tariff_unit ?? 'PER_TRIP')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [err, setErr] = useState('')
  const pending = create.isPending || update.isPending
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))
  const capOk = capMode === 'PALLET' ? Number(pallets) > 0 : Number(tons) > 0
  const ready = !!name.trim() && !!parent && conds.length > 0 && capOk && (!!row || !!sap.trim())
  const submit = async () => {
    setErr('')
    const body: VehicleModelPatch = {
      name: name.trim(), parent_type_id: parent, storage_conditions: conds, capacity_mode: capMode,
      max_pallets: numOrNull(pallets), max_tons: numOrNull(tons), max_drops: numOrNull(drops),
      tariff_unit: unit, is_active: active,
    }
    try {
      if (row) await update.mutateAsync({ id: row.id, ...body })
      else await create.mutateAsync({ ...body, sap_code: sap.trim(), name: name.trim() })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  const capField = (mode: 'PALLET' | 'TON') => {
    const main = mode === capMode
    const lbl = mode === 'PALLET' ? 'Pallet tối đa' : 'Tấn tối đa'
    return (
      <div>
        <Label className="text-xs">{lbl}{main ? ' *' : <span className="text-slate-400 font-normal"> (ghi chú)</span>}</Label>
        {mode === 'PALLET'
          ? <Input type="number" min={1} value={pallets} onChange={e => setPallets(e.target.value)} className="h-9 tabular-nums" />
          : <Input type="number" min={0.1} step={0.1} value={tons} onChange={e => setTons(e.target.value)} className="h-9 tabular-nums" />}
      </div>
    )
  }
  return (
    <FormSheet open onClose={onClose} title={row ? `Sửa dòng xe · ${row.sap_code}` : 'Thêm dòng xe con'}
      description="Bản CHUNG cho mọi kho: mã SAP, tên, cha, điều kiện bảo quản, thước đo và cách tính cước. Kho chỉ chỉnh riêng dùng/không, sức chứa, điểm giao (chọn kho ở đầu tab)."
      footer={<>
        {err && <span className="text-[11px] text-red-600 flex-1 truncate">{err}</span>}
        <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>Huỷ</Button>
        <Button size="sm" onClick={submit} disabled={pending || !ready}>{pending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Mã SAP *</Label><Input value={sap} disabled={!!row} onChange={e => setSap(e.target.value)} placeholder="910000030" className="h-9 font-mono" /></div>
          <div><Label className="text-xs">Dòng xe cha *</Label><SingleSelect options={parents} value={parent} onChange={setParent} placeholder="Chọn dòng xe cha…" />
            {!parent && <p className="text-[10px] text-amber-700 mt-0.5">Bắt buộc — kho booking khung giờ / cổng theo cha; chưa gán thì máy điều vận bỏ qua dòng xe.</p>}</div>
        </div>
        <div><Label className="text-xs">Tên *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Xe 16 Pallet" className="h-9" /></div>
        <div><Label className="text-xs">Đo tải bằng *</Label>
          <SingleSelect searchable={false} value={capMode} onChange={v => { const cm = v as 'PALLET' | 'TON'; setCapMode(cm); setUnit(cm === 'PALLET' ? 'PER_PALLET' : 'PER_TRIP') }}
            options={[{ value: 'PALLET', label: 'Pallet (xe pallet)' }, { value: 'TON', label: 'Tấn (xe xá / cont)' }]} />
          <p className="text-[10px] text-slate-500 mt-0.5">Máy chỉ so tải theo MỘT thước đo này; ô kia nếu khai chỉ là ghi chú.</p></div>
        <div><Label className="text-xs">Điều kiện bảo quản xe chở được *</Label>
          <ConditionPicker all={conditions} value={conds} onChange={setConds} /></div>
        <div className="grid grid-cols-3 gap-2">
          {capField('PALLET')}
          {capField('TON')}
          <div><Label className="text-xs">Điểm giao tối đa</Label><Input type="number" min={1} value={drops} onChange={e => setDrops(e.target.value)} className="h-9 tabular-nums" placeholder="Trống = 1" /></div>
        </div>
        <div><Label className="text-xs">Tính cước</Label>
          <SingleSelect searchable={false} value={unit} onChange={v => setUnit(v as 'PER_PALLET' | 'PER_TRIP')}
            options={[{ value: 'PER_PALLET', label: 'Theo pallet (làm tròn lên)' }, { value: 'PER_TRIP', label: 'Trọn chuyến' }]} /></div>
        {row && <div className="flex items-center gap-2"><Switch id="vm-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="vm-active" className="text-sm cursor-pointer">Đang hoạt động</Label></div>}
        <p className="text-[10px] text-slate-500">Điểm giao tối đa trống = chưa khai = mỗi khách một xe (chip "Khai thiếu" ở Điều vận nêu tên). Số khách tối đa cùng xe khai ở Cấu hình → Khách hàng (kênh / khách). Tắt "Đang hoạt động" ⇒ máy điều vận không xếp hàng lên dòng xe này ở kho chưa cấu hình riêng (cước và lịch sử giữ nguyên).</p>
      </div>
    </FormSheet>
  )
}

/** Form cấu hình RIÊNG của một kho cho một dòng xe (03/10). Ô trống ở sức chứa = lấy theo Chung (placeholder in giá trị Chung — luật C47);
 *  điểm giao trống = chưa khai (1 khách), là lựa chọn chủ ý nên không rơi về Chung. */
function WarehouseModelForm({ row, whId, whName, onClose }: { row: VehicleModel; whId: string; whName: string; onClose: () => void }) {
  const set = useSetWarehouseVehicleModel(), clear = useClearWarehouseVehicleModel()
  const [ask, confirmNode] = useConfirmDialog()
  const shared = row.shared ?? { is_active: row.is_active, max_pallets: row.max_pallets, max_tons: row.max_tons, max_drops: row.max_drops }
  const [active, setActive] = useState(row.is_active)
  const [pallets, setPallets] = useState(row.max_pallets == null ? '' : String(row.max_pallets))
  const [tons, setTons] = useState(row.max_tons == null ? '' : String(row.max_tons))
  const [drops, setDrops] = useState(row.max_drops == null ? '' : String(row.max_drops))
  const [err, setErr] = useState('')
  const pending = set.isPending || clear.isPending
  const byPallet = row.capacity_mode === 'PALLET'
  const sharedCap = byPallet ? shared.max_pallets : shared.max_tons
  const submit = async () => {
    setErr('')
    try {
      await set.mutateAsync({
        id: row.id, warehouse_id: whId, is_active: active,
        // sức chứa trống ⇒ không gửi ⇒ BE lấy theo dòng kho đang có rồi theo Chung; điểm giao trống ⇒ gửi null (chưa khai)
        ...(byPallet ? (pallets.trim() ? { max_pallets: Number(pallets) } : {}) : (tons.trim() ? { max_tons: Number(tons) } : {})),
        max_drops: drops.trim() ? Number(drops) : null,
      })
      toast({ title: `Đã lưu cấu hình riêng tại ${whName}`, description: `${row.sap_code} · ${row.name} — kho này không theo bản Chung nữa` })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  const reset = async () => {
    if (await ask({ title: `Về theo chung tại ${whName}?`, body: `Bỏ cấu hình riêng của kho cho "${row.sap_code} · ${row.name}". Kho sẽ dùng số của bản Chung: ${shared.is_active ? 'đang hoạt động' : 'tạm dừng'} · ${capText({ ...row, ...shared }) ?? 'chưa khai sức chứa'} · điểm giao ${shared.max_drops ?? 'chưa khai (1)'}.`, confirmLabel: 'Về theo chung' }) === null) return
    try { await clear.mutateAsync({ id: row.id, warehouse_id: whId }); toast({ title: `${row.sap_code} tại ${whName} đã về theo chung` }); onClose() }
    catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open onClose={onClose} title={`${row.sap_code} · ${row.name} — tại ${whName}`}
      description="Cấu hình riêng của kho: dùng hay không, sức chứa, điểm giao. Đã lưu riêng thì đổi số ở bản Chung không lan sang kho này."
      footer={<>
        {err && <span className="text-[11px] text-red-600 flex-1 truncate">{err}</span>}
        {row.wh_override && <Button variant="outline" size="sm" className="gap-1" onClick={reset} disabled={pending}><Undo2 className="h-3.5 w-3.5" />Về theo chung</Button>}
        <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>Huỷ</Button>
        <Button size="sm" onClick={submit} disabled={pending}>{pending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="text-[11px] text-slate-600 rounded border bg-slate-50 px-2 py-1.5">
          Bản Chung: {shared.is_active ? 'đang hoạt động' : 'tạm dừng'} · {capText({ ...row, ...shared }) ?? 'chưa khai sức chứa'} · điểm giao {shared.max_drops ?? 'chưa khai (1 khách)'} · đo bằng {byPallet ? 'pallet' : 'tấn'} · {row.parent?.name ?? 'chưa gán cha'}
          {row.wh_override ? <span className="ml-1 text-sky-700 font-medium">· kho đang cấu hình RIÊNG</span> : <span className="ml-1 text-slate-400">· kho đang theo Chung</span>}
        </div>
        <div className="flex items-center gap-2"><Switch id="wvm-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="wvm-active" className="text-sm cursor-pointer">Dùng ở kho này</Label></div>
        <div className="grid grid-cols-2 gap-2">
          {byPallet
            ? <div><Label className="text-xs">Pallet tối đa tại kho</Label><Input type="number" min={1} value={pallets} onChange={e => setPallets(e.target.value)} className="h-9 tabular-nums" placeholder={`Theo chung: ${sharedCap ?? '—'}`} /></div>
            : <div><Label className="text-xs">Tấn tối đa tại kho</Label><Input type="number" min={0.1} step={0.1} value={tons} onChange={e => setTons(e.target.value)} className="h-9 tabular-nums" placeholder={`Theo chung: ${sharedCap ?? '—'}`} /></div>}
          <div><Label className="text-xs">Điểm giao tối đa tại kho</Label><Input type="number" min={1} value={drops} onChange={e => setDrops(e.target.value)} className="h-9 tabular-nums" placeholder="Trống = chưa khai (1 khách)" /></div>
        </div>
        <p className="text-[10px] text-slate-500">Mã SAP, tên, cha, điều kiện bảo quản, thước đo, cách tính cước là của bản Chung — sửa ở chế độ "Chung".</p>
      </div>
      {confirmNode}
    </FormSheet>
  )
}

export function VehicleModelsPanel({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const { data: parentsRaw = [] } = useVehicleTypes()
  const parents = useMemo(() => parentsRaw.filter(p => p.is_active).map(p => ({ value: p.id, label: p.name })), [parentsRaw])
  const parentOpts = useMemo(() => [{ value: NONE, label: 'Chưa gán cha' }, ...parentsRaw.map(p => ({ value: p.id, label: p.name }))], [parentsRaw])
  const f = useWmsFilterStore(s => s.vehicleModels)
  const setF = useWmsFilterStore(s => s.setVehicleModels)
  const { data: warehouses = [] } = useScopedWarehouses(true)
  const whs = warehouses as { id: string; code?: string; name: string }[]
  // kho đã chọn mà không còn trong phạm vi (đổi tài khoản / kho ngừng) ⇒ về Chung, không treo ở một kho vô hình
  const whId = whs.some(w => w.id === f.whId) ? f.whId : ''
  const wh = whs.find(w => w.id === whId) ?? null
  const whName = wh ? (wh.code ? `${wh.code} · ${wh.name}` : wh.name) : ''
  const { data, isLoading } = useVehicleModels(whId ? { warehouse_id: whId } : undefined)
  const items = data?.items ?? []
  const assign = useAssignVehicleModelParent(), del = useDeleteVehicleModel()
  const { data: conditions = [] } = useStorageConditions()
  const condBy = useMemo(() => new Map(conditions.map(c => [c.value, c])), [conditions])
  const assignCond = useAssignVehicleModelConditions()
  const update = useUpdateVehicleModel()
  const setWh = useSetWarehouseVehicleModel()
  const [activating, setActivating] = useState(false)
  const COLS = whId ? COLS_WH : COLS_SHARED
  // _v5: bỏ cột Non tải (02/10); chế độ kho có bộ cột riêng
  const { widths: colW, startResize, totalWidth } = useColumnResize(whId ? 'vehicle_models_col_widths_v5_wh' : 'vehicle_models_col_widths_v5', COLS.map(c => c.w))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<{ row: VehicleModel | null } | null>(null)
  const [whForm, setWhForm] = useState<VehicleModel | null>(null)
  const [ask, confirmNode] = useConfirmDialog()
  const [assignDlg, setAssignDlg] = useState(false)
  const [assignTo, setAssignTo] = useState('')
  const [condDlg, setCondDlg] = useState(false)
  const [condPick, setCondPick] = useState<string[]>([])

  // Lọc client (danh mục 60 dòng, cố định) — chưa gán cha lên đầu (việc phải làm), rồi theo cha, rồi thứ tự seed
  const rows = useMemo(() => {
    const q = f.search.trim().toLowerCase()
    const list = items.filter(m =>
      (!q || m.sap_code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      && (!f.parents.length || f.parents.includes(m.parent_type_id ?? NONE))
      && (!f.status || (f.status === 'active') === m.is_active)
      && (!f.capMode || m.capacity_mode === f.capMode))
    return [...list].sort((a, b) => Number(!!a.parent_type_id) - Number(!!b.parent_type_id) || (a.parent?.code ?? '').localeCompare(b.parent?.code ?? '') || a.sort_order - b.sort_order)
  }, [items, f])
  const filtering = !!(f.search || f.parents.length || f.status || f.capMode)
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id))
  const doAssign = async () => {
    try {
      const r = await assign.mutateAsync({ ids: [...picked], parent_type_id: assignTo })
      toast({ title: `Đã gán cha cho ${r.updated} dòng xe` })
      setPicked(new Set()); setAssignDlg(false); setAssignTo('')
    } catch (e) { toast({ variant: 'destructive', title: 'Không gán được', description: apiMsg(e) }) }
  }
  const doAssignCond = async () => {
    try {
      const r = await assignCond.mutateAsync({ ids: [...picked], storage_conditions: condPick })
      toast({ title: `Đã khai điều kiện bảo quản cho ${r.updated} dòng xe`, description: condPick.map(c => conditionLabel(condBy.get(c), c)).join(' · ') })
      setPicked(new Set()); setCondDlg(false); setCondPick([])
    } catch (e) { toast({ variant: 'destructive', title: 'Không khai được', description: apiMsg(e) }) }
  }

  // Tạm dừng / hoạt động lại HÀNG LOẠT (user 25/09: "thực tế chỉ dùng xe 4, 6, 16, 17 pallet") — song song qua cửa sửa lẻ.
  // Chế độ KHO: ghi vào cấu hình riêng của kho (dùng / không dùng ở kho này), bản Chung không đổi.
  const doSetActive = async (on: boolean) => {
    const ids = [...picked].filter(id => items.find(m => m.id === id)?.is_active !== on)
    if (!ids.length) { toast({ title: on ? 'Các dòng đã chọn đều đang hoạt động' : 'Các dòng đã chọn đều đang tạm dừng' }); return }
    const where = whId ? ` tại ${whName}` : ''
    if (!on && await ask({ title: `Tạm dừng ${ids.length} dòng xe${where}?`, body: `Máy điều vận sẽ không xếp hàng lên các dòng xe này${whId ? ' ở kho này (các kho khác không đổi)' : ' ở mọi kho chưa cấu hình riêng'}. Cước và lịch sử giữ nguyên, bật lại được bất cứ lúc nào. Nháp điều vận đang mở chỉ đổi khi bấm "Tối ưu lại".`, confirmLabel: 'Tạm dừng' }) === null) return
    setActivating(true)
    const res = await Promise.allSettled(ids.map(id => whId ? setWh.mutateAsync({ id, warehouse_id: whId, is_active: on }) : update.mutateAsync({ id, is_active: on })))
    setActivating(false)
    const bad = res.filter(r => r.status === 'rejected').length
    if (bad) toast({ variant: 'destructive', title: `${ids.length - bad}/${ids.length} dòng đã ${on ? 'bật lại' : 'tạm dừng'}`, description: `${bad} dòng không lưu được — thử lại` })
    else { toast({ title: `Đã ${on ? 'bật lại' : 'tạm dừng'} ${ids.length} dòng xe${where}` }); setPicked(new Set()) }
  }

  const filterDefs: FilterDef[] = [
    { key: 'parent', label: 'Dòng xe cha', type: 'multi', selected: f.parents, onChange: v => setF({ parents: v }), options: parentOpts },
    { key: 'cap', label: 'Đo tải', type: 'single', value: f.capMode, onChange: v => setF({ capMode: v }), options: [{ value: 'PALLET', label: 'Pallet' }, { value: 'TON', label: 'Tấn' }] },
    { key: 'status', label: whId ? 'Dùng ở kho' : 'Trạng thái', type: 'single', value: f.status, onChange: v => setF({ status: v }), options: [{ value: 'active', label: whId ? 'Đang dùng' : 'Hoạt động' }, { value: 'inactive', label: whId ? 'Không dùng' : 'Tạm dừng' }] },
  ]
  const unassigned = items.filter(m => !m.parent_type_id && m.is_active).length
  const unconditioned = data?.unconditioned ?? items.filter(m => m.is_active && !(m.storage_conditions ?? []).length).length
  const tiles = whId
    ? [
      { label: 'Dòng xe', value: filtering ? `${nf(rows.length)} / ${nf(items.length)}` : nf(items.length) },
      { label: 'Đang dùng ở kho', value: nf(items.filter(m => m.is_active).length), tip: 'Máy điều vận của kho này chỉ xếp lên các dòng xe đang dùng' },
      { label: 'Cấu hình riêng', value: nf(items.filter(m => m.wh_override).length), tip: 'Dòng xe kho đã chỉnh riêng — không theo bản Chung nữa cho tới khi "Về theo chung"' },
      { label: 'Chưa khai điểm giao', value: nf(items.filter(m => m.is_active && m.max_drops == null).length), danger: items.some(m => m.is_active && m.max_drops == null), tip: 'Đang dùng mà chưa khai điểm giao tối đa = mỗi khách một xe' },
      { label: 'Không dùng', value: nf(items.filter(m => !m.is_active).length) },
    ]
    : [
      { label: 'Dòng xe con', value: filtering ? `${nf(rows.length)} / ${nf(items.length)}` : nf(items.length) },
      { label: 'Chưa gán cha', value: nf(unassigned), danger: unassigned > 0, tip: 'Dòng chưa gán cha thì điều vận không ghép chuyến vào — kho không biết booking khung giờ loại nào' },
      { label: 'Chưa khai ĐK bảo quản', value: nf(unconditioned), danger: unconditioned > 0, tip: 'Dòng cũ chưa khai đang được coi là chở được MỌI điều kiện — hàng lạnh có thể lên xe thường mà máy không cản' },
      { label: 'Xe pallet', value: nf(items.filter(m => m.capacity_mode === 'PALLET' && m.is_active).length), tip: 'Đo tải bằng pallet, cước theo pallet làm tròn lên' },
      { label: 'Xe tấn / cont', value: nf(items.filter(m => m.capacity_mode === 'TON' && m.is_active).length), tip: 'Đo tải bằng tấn, cước trọn chuyến' },
      { label: 'Tạm dừng', value: nf(items.filter(m => !m.is_active).length) },
    ]
  // Thêm dòng xe CHỈ ở bản Chung (user 02/10: "không cho master data dòng xe khác nhau ở các kho")
  const actions: ActionItem[] = canCreate && !whId
    ? [{ key: 'add', icon: Plus, label: 'Thêm dòng con', tip: 'Thêm dòng xe con mang mã SAP (bản Chung cho mọi kho)', primary: true, variant: 'default', onClick: () => setForm({ row: null }) }]
    : []

  const cell = (m: VehicleModel, id: string) => {
    switch (id) {
      case 'pick':   return canEdit ? <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} className="h-3.5 w-3.5 accent-sky-600" /> : null
      case 'sap':    return <span className="font-mono font-semibold">{m.sap_code}</span>
      case 'name':   return <span className="font-medium">{m.name}</span>
      // Chỉ TÊN cha (mã để tooltip) — in cả "CONTSCA XE CONTAINER SCA" là lặp một ý hai lần (user 23/09: "kỳ cục quá")
      case 'parent': return m.parent ? <span title={m.parent.code}>{m.parent.name}</span> : <StatusBadge tone="amber">Chưa gán</StatusBadge>
      case 'cond':   return (m.storage_conditions ?? []).length
        ? <span title={m.storage_conditions.map(c => conditionLabel(condBy.get(c), c)).join(' · ')}>{m.storage_conditions.map(c => conditionLabel(condBy.get(c), c)).join(' · ')}</span>
        : <span className="text-amber-600" title="Chưa khai = xe được coi là chở được mọi điều kiện">Mọi điều kiện</span>
      case 'cap':    return <span title={capNote(m)}>{capText(m) ?? <span className="text-amber-600">chưa khai</span>}</span>
      case 'unit':   return m.tariff_unit === 'PER_PALLET' ? 'Pallet (làm tròn lên)' : 'Trọn chuyến'
      case 'drops':  return m.max_drops ?? <span className="text-amber-600" title="Chưa khai = mỗi khách một xe">— (1)</span>
      case 'act':    return whId
        ? <StatusBadge tone={m.is_active ? 'green' : 'slate'}>{m.is_active ? 'Đang dùng' : 'Không dùng'}</StatusBadge>
        : <StatusBadge tone={m.is_active ? 'green' : 'slate'}>{m.is_active ? 'Hoạt động' : 'Tạm dừng'}</StatusBadge>
      case 'cfg':    return m.wh_override
        ? <StatusBadge tone="sky">Riêng</StatusBadge>
        // luật C47: ô "theo cha" in GIÁ TRỊ cha đang áp, không ghi trần "Theo chung"
        : <span className="text-slate-400" title={`Đang lấy từ bản Chung: ${m.shared?.is_active ? 'hoạt động' : 'tạm dừng'} · ${capText({ ...m, ...(m.shared ?? {}) }) ?? 'chưa khai'} · điểm giao ${m.shared?.max_drops ?? '— (1)'}`}>{`Theo chung: ${capText({ ...m, ...(m.shared ?? {}) }) ?? 'chưa khai'} · ${m.shared?.max_drops ?? 1} điểm`}</span>
      case 'upd':    return <div className="leading-tight"><div className="text-slate-600 truncate max-w-[100px]">{m.updated_by ?? <span className="text-slate-300">—</span>}</div><div className="text-[9px] text-slate-400">{formatTimestampDate(m.updated_at, true)}</div></div>
      case 'ops':    return (canEdit || canDelete) ? (
        <div className="flex items-center gap-0.5">
          {canEdit && <button className="text-slate-400 hover:text-blue-500 p-1" title={whId ? `Cấu hình riêng tại ${whName}` : 'Sửa'} onClick={e => { e.stopPropagation(); if (whId) setWhForm(m); else setForm({ row: m }) }}><Pencil className="h-3.5 w-3.5" /></button>}
          {canDelete && !whId && <button className="text-slate-400 hover:text-red-500 p-1" title="Xoá" onClick={async e => { e.stopPropagation(); if (await ask({ title: `Xoá dòng xe "${m.sap_code} · ${m.name}"?`, body: 'Cấu hình riêng của các kho cho dòng xe này cũng mất theo.', danger: true, confirmLabel: 'Xoá' }) !== null) del.mutate(m.id, { onError: er => toast({ variant: 'destructive', title: 'Không xoá được', description: apiMsg(er) }) }) }}><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>) : null
      default: return null
    }
  }
  // Cột ghim trái: tick + Mã SAP (giữ ngữ cảnh khi cuộn ngang trên phone)
  const stickyLeft = (i: number) => (i === 0 ? 'sticky left-0 z-10' : i === 1 ? `sticky z-10` : '')
  const stickyStyle = (i: number) => (i === 1 ? { left: colW[0] } : undefined)
  const scopeBtn = (id: string, label: string) => (
    <button key={id || '__shared'} type="button" onClick={() => { setF({ whId: id }); setPicked(new Set()) }} aria-pressed={whId === id}
      className={`h-9 sm:h-7 px-2.5 rounded-full border text-[11px] font-medium whitespace-nowrap transition-colors ${whId === id ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
      {label}
    </button>
  )

  return (
    <>
      <div className="border-b px-3 py-1.5 space-y-1 sm:space-y-1.5 shrink-0">
        {/* Dải chọn phạm vi (03/10): "Chung" = master data · "Kho …" = cấu hình riêng của kho. Hàng cuộn ngang khi nhiều kho (360 px). */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mb-0.5">
          {scopeBtn('', 'Chung')}
          {whs.map(w => scopeBtn(w.id, w.code ? `${w.code} · ${w.name}` : w.name))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={f.search} onChange={v => setF({ search: v })} placeholder="Tìm mã SAP, tên dòng xe…" className="flex-1 min-w-[160px]" />
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <FilterSheetButton defs={filterDefs} className="sm:hidden" />
            <ActionCluster items={actions} mobileInline />
          </div>
        </div>
        <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
      </div>
      <SummaryBand tiles={tiles} />
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{COLS.map((c, i) => <col key={c.id} style={{ width: colW[i] }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {COLS.map((c, i) => (
                <TableHead key={c.id} className={`${TH} ${stickyLeft(i)} bg-slate-50 ${i <= 1 ? 'z-20' : ''}`} style={stickyStyle(i)}>
                  {c.id === 'pick'
                    ? (canEdit && <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.id)))} className="h-3.5 w-3.5 accent-sky-600" />)
                    : c.label}
                  <span onPointerDown={e => startResize(i, e)} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
            {!isLoading && !rows.length && (
              <TableEmptyRow colSpan={COLS.length}>{filtering ? 'Không có dòng xe khớp bộ lọc.' : 'Chưa có dòng xe con nào.'}</TableEmptyRow>
            )}
            {rows.map(m => (
              <TableRow key={m.id} className={`${m.is_active ? '' : 'text-slate-400 line-through'} ${picked.has(m.id) ? 'bg-sky-50' : ''}`}>
                {COLS.map((c, i) => (
                  <TableCell key={c.id} className={`${TD} ${stickyLeft(i)} ${i <= 1 ? (picked.has(m.id) ? 'bg-sky-50' : 'bg-white') : ''}`} style={stickyStyle(i)}>
                    {cell(m, c.id)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0 flex items-center gap-2 flex-wrap">
        <span className="whitespace-nowrap">1–{rows.length} / {items.length} dòng xe con{whId ? ` · ${whName}` : ' · bản Chung'}</span>
        <span className="flex-1 min-w-0 truncate text-slate-400">{whId
          ? 'Số in ở đây là số ĐANG HIỆU LỰC tại kho: Riêng = kho đã chỉnh · còn lại đang lấy từ bản Chung. Bấm bút chì để chỉnh riêng hoặc về theo chung.'
          : 'Bản Chung cho mọi kho. Chọn một kho ở dải trên để bật/tắt dòng xe và chỉnh sức chứa, điểm giao riêng cho kho đó.'}</span>
      </div>

      {canEdit && picked.size > 0 && (
        <FloatingActionBar count={picked.size} unit="dòng xe">
          {!whId && <Button size="sm" variant="outline" className={`${FLOATING_BTN} gap-1`} onClick={() => setAssignDlg(true)}><Link2 className="h-3.5 w-3.5" />Gán cha</Button>}
          {!whId && <Button size="sm" variant="outline" className={`${FLOATING_BTN} gap-1`} onClick={() => { setCondPick([]); setCondDlg(true) }}><Thermometer className="h-3.5 w-3.5" />Điều kiện bảo quản</Button>}
          <Button size="sm" variant="outline" className={`${FLOATING_BTN} gap-1`} disabled={activating} onClick={() => doSetActive(false)}><PauseCircle className="h-3.5 w-3.5" />{activating ? 'Đang lưu…' : whId ? 'Không dùng ở kho' : 'Tạm dừng'}</Button>
          <Button size="sm" variant="outline" className={`${FLOATING_BTN} gap-1`} disabled={activating} onClick={() => doSetActive(true)}><PlayCircle className="h-3.5 w-3.5" />{whId ? 'Dùng ở kho' : 'Hoạt động lại'}</Button>
          <Button size="sm" variant="outline" className={FLOATING_BTN} onClick={() => setPicked(new Set())}>Bỏ chọn</Button>
        </FloatingActionBar>
      )}
      {condDlg && (
        <Dialog open onOpenChange={v => { if (!v) setCondDlg(false) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="text-base">Điều kiện bảo quản cho {picked.size} dòng xe</DialogTitle></DialogHeader>
            <ConditionPicker all={conditions} value={condPick} onChange={setCondPick} />
            <p className="text-[11px] text-slate-500">Ghi ĐÈ danh sách hiện có của các dòng xe đã chọn.</p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setCondDlg(false)}>Huỷ</Button>
              <Button size="sm" onClick={doAssignCond} disabled={assignCond.isPending || !condPick.length}>{assignCond.isPending ? 'Đang lưu…' : 'Khai'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {assignDlg && (
        <Dialog open onOpenChange={v => { if (!v) setAssignDlg(false) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="text-base">Gán dòng xe cha cho {picked.size} dòng con</DialogTitle></DialogHeader>
            <SingleSelect options={parents} value={assignTo} onChange={setAssignTo} placeholder="Chọn dòng xe cha…" searchable={false} />
            <p className="text-[11px] text-slate-500">Kho sẽ booking khung giờ / đăng ký cổng theo dòng cha này khi điều vận chọn dòng con.</p>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setAssignDlg(false)} disabled={assign.isPending}>Huỷ</Button>
              <Button size="sm" onClick={doAssign} disabled={assign.isPending || !assignTo}>{assign.isPending ? 'Đang gán…' : 'Gán'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {form && <ModelForm row={form.row} parents={parents} conditions={conditions} onClose={() => setForm(null)} />}
      {whForm && whId && <WarehouseModelForm row={whForm} whId={whId} whName={whName} onClose={() => setWhForm(null)} />}
      {confirmNode}
    </>
  )
}
