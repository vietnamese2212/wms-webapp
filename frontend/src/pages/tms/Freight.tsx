// CƯỚC VẬN CHUYỂN — đợt 1 TMS điều vận (user chốt 23/09/2026; plan docs/plans/TMS_DISPATCH_PLAN.md 6.0–6.4).
//
// Ba tab trên cùng bộ lọc (kho xuất · ĐVVT · dòng xe):
//   • Bảng cước   — (kho xuất × ĐVVT × dòng xe CON × phường) → đơn giá; xe pallet = đơn giá × pallet làm tròn LÊN.
//   • Phụ phí     — rớt điểm (theo THỰC TẾ chuyến: 1 điểm không có, ≥2 điểm mỗi điểm một khoản), bốc xếp, chờ, khác.
//   • Phân tuyến  — ưu tiên ĐVVT theo khu vực + tỷ trọng %/tháng: engine chọn ĐVVT theo thứ tự này rồi mới tới rẻ nhất.
// Vì sao khoá theo KHO XUẤT ở mọi bảng: "bảng cước mỗi ĐVVT ở mỗi kho có sự khác nhau, bao gồm cả rớt điểm, một số còn có bốc xếp".
import { useMemo, useState } from 'react'
import { Plus, Upload, Pencil, Trash2, Banknote, MapPinned, Percent } from 'lucide-react'
import type { AxiosError } from 'axios'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { UploadExcelDialog } from '@/components/shared/UploadExcelDialog'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { InfoTip } from '@/components/shared/InfoTip'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import {
  useTransportCompanies, useVehicleModels,
  useFreightTariffs, useSaveFreightTariff, useDeleteFreightTariff, useUploadFreightTariffs,
  useFreightSurcharges, useSaveFreightSurcharge, useDeleteFreightSurcharge,
  useCarrierAllocations, useSaveCarrierAllocation, useDeleteCarrierAllocation, useSaveCarrierShare, useDeleteCarrierShare,
  type FreightTariff, type FreightSurcharge, type CarrierAllocation, type CarrierShare, type SurchargeKind, type SurchargePer, type VehicleModel,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useMobileTabs } from '@/hooks/useMobileSurface'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampDate } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'

const nf = (n: number) => n.toLocaleString('vi-VN')
const vnd = (n: number | null | undefined) => (n == null ? '—' : `${nf(Math.round(n))} ₫`)
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được'
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// key khớp PAGE_TABS['/tms/freight'] (config/mobileSurface.ts)
const PAGE_TAB_DEFS = [
  { key: 'tariffs', label: 'Bảng cước', icon: Banknote },
  { key: 'surcharges', label: 'Phụ phí', icon: Percent },
  { key: 'allocation', label: 'Phân tuyến ĐVVT', icon: MapPinned },
] as const
type TabKey = typeof PAGE_TAB_DEFS[number]['key']

const PER_LABEL: Record<SurchargePer, string> = { PER_STOP: 'mỗi điểm giao', PER_TRIP: 'mỗi chuyến', PER_PALLET: 'mỗi pallet', PER_TON: 'mỗi tấn' }
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const TD0 = `${TD} sticky left-0 z-10 bg-white`     // cột đầu ghim trái (ResizableTable ghim tiêu đề cột đầu)
const TDR = `${TD} sticky right-0 z-10 bg-white`    // cột thao tác ghim phải
// Bảng nghiệp vụ = ResizableTable (skill table-format mục 7): kéo giãn cột + cột đầu sticky — bản 23/09 dùng
// <Table> tự do nên 3.363 dòng cước không kéo cột được và cột Kho trôi mất khi cuộn ngang trên điện thoại.
const TARIFF_COLS: RtColDef[] = [
  { id: 'wh', label: 'Kho xuất', w: 110 }, { id: 'co', label: 'ĐVVT', w: 120 }, { id: 'vm', label: 'Dòng xe (SAP)', w: 190 },
  { id: 'ward', label: 'Phường / Xã', w: 150 }, { id: 'prov', label: 'Tỉnh (mới)', w: 110 }, { id: 'km', label: 'Km', w: 50, align: 'right' },
  { id: 'price', label: 'Đơn giá', w: 100, align: 'right' }, { id: 'unit', label: 'Tính', w: 150 }, { id: 'eff', label: 'Hiệu lực', w: 140 },
  { id: 'st', label: 'Trạng thái', w: 90 }, { id: 'upd', label: 'Sửa', w: 130 },
]
const SUR_COLS: RtColDef[] = [
  { id: 'wh', label: 'Kho xuất', w: 110 }, { id: 'co', label: 'ĐVVT', w: 120 }, { id: 'vm', label: 'Dòng xe', w: 170 },
  { id: 'kind', label: 'Loại', w: 100 }, { id: 'amt', label: 'Số tiền', w: 100, align: 'right' }, { id: 'per', label: 'Tính theo', w: 240 },
  { id: 'eff', label: 'Hiệu lực', w: 140 }, { id: 'st', label: 'Trạng thái', w: 90 }, { id: 'note', label: 'Ghi chú', w: 200 },
]
const ALLOC_COLS: RtColDef[] = [
  { id: 'wh', label: 'Kho xuất', w: 110 }, { id: 'kind', label: 'Cấp', w: 90 }, { id: 'area', label: 'Khu vực', w: 150 },
  { id: 'co', label: 'ĐVVT', w: 140 }, { id: 'pri', label: 'Ưu tiên', w: 70, align: 'center' }, { id: 'eff', label: 'Hiệu lực', w: 140 }, { id: 'st', label: 'Trạng thái', w: 110 },
]
const SHARE_COLS: RtColDef[] = [
  { id: 'wh', label: 'Kho xuất', w: 110 }, { id: 'co', label: 'ĐVVT', w: 140 }, { id: 'pct', label: 'Tỷ trọng', w: 90, align: 'right' },
  { id: 'basis', label: 'Đo bằng', w: 120 }, { id: 'eff', label: 'Hiệu lực', w: 140 }, { id: 'st', label: 'Trạng thái', w: 110 },
]
const withAct = (cols: RtColDef[], on: boolean): RtColDef[] => (on ? [...cols, { id: 'act', label: '', w: 64, stickyRight: true }] : cols)
const effText = (r: { effective_from: string; effective_to: string | null }) => `${formatDate(r.effective_from)} → ${r.effective_to ? formatDate(r.effective_to) : '∞'}`
const modelLabel = (m: VehicleModel) => `${m.sap_code} · ${m.name}${m.parent ? '' : ' (chưa gán cha)'}`

/** Mẫu upload = đúng cột file bảng cước thật + 2 cột thêm (Kho xuất · Hiệu lực từ). */
async function downloadTariffTemplate() {
  const XLSX = await import('xlsx')
  const rows = [{
    'Tỉnh/TP (Cũ)': 'Hà Nội', 'Quận/Huyện (Cũ)': 'Long Biên', 'Tỉnh/TP (Mới)': 'Thành phố Hà Nội', 'Phường/Xã (Mới)': 'HN-Phúc Lợi',
    'Cự ly (Km)': 35, 'DVVT': 'Đông Á', 'Loại xe': 'Xe 16 Pallet', 'Cước (VND)': 250000, 'Mã xe SAP': '910000030',
    'Kho xuất': '20000016', 'Hiệu lực từ': todayVN(),
  }]
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Cuoc')
  await saveWorkbook(wb, 'mau_bang_cuoc.xlsx')
}

// ─── FORM: dòng cước ─────────────────────────────────────────────────────────────────────────────
function TariffForm({ row, whs, companies, models, defaultWh, onClose }: {
  row: FreightTariff | null
  whs: { id: string; code?: string; name: string }[]
  companies: { value: string; label: string }[]
  models: VehicleModel[]
  defaultWh: string
  onClose: () => void
}) {
  const save = useSaveFreightTariff()
  const [wh, setWh] = useState(row?.from_warehouse_id ?? defaultWh)
  const [co, setCo] = useState(row?.transport_company_id ?? '')
  const [vm, setVm] = useState(row?.vehicle_model_id ?? '')
  const [ward, setWard] = useState(row?.ward_code ?? '')
  const [province, setProvince] = useState(row?.province_new ?? '')
  const [price, setPrice] = useState(row ? String(row.price) : '')
  const [km, setKm] = useState(row?.distance_km == null ? '' : String(row.distance_km))
  const [from, setFrom] = useState(row?.effective_from ?? todayVN())
  const [to, setTo] = useState(row?.effective_to ?? '')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [note, setNote] = useState(row?.note ?? '')
  const [err, setErr] = useState('')
  const model = models.find(m => m.id === vm)
  const canSave = !!wh && !!co && !!vm && ward.trim() && Number.isFinite(Number(price)) && Number(price) >= 0 && !!from
  const submit = async () => {
    setErr('')
    try {
      await save.mutateAsync({
        id: row?.id, ...(row ? {} : { from_warehouse_id: wh, transport_company_id: co, vehicle_model_id: vm }),
        ward_code: ward.trim(), price: Number(price), distance_km: km === '' ? null : Number(km), province_new: province.trim() || null,
        effective_from: from, effective_to: to || null, is_active: active, note: note.trim() || null,
      })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open onClose={onClose} title={row ? 'Sửa dòng cước' : 'Thêm dòng cước'}
      description="Cước khoá theo kho xuất × ĐVVT × dòng xe con × phường (Tên Phường của SAP). Xe pallet: đơn giá × số pallet làm tròn lên."
      footer={<>
        {err && <span className="text-[11px] text-red-600 flex-1 truncate">{err}</span>}
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
        <Button onClick={submit} disabled={save.isPending || !canSave}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-3">
        <div><Label className="text-xs">Kho xuất *</Label>
          <WarehouseSingleSelect warehouses={whs} value={wh} onChange={setWh} placeholder="Chọn kho…" disabled={!!row} /></div>
        <div><Label className="text-xs">ĐVVT *</Label>
          <SingleSelect options={companies} value={co} onChange={setCo} placeholder="Chọn ĐVVT…" disabled={!!row} /></div>
        <div><Label className="text-xs">Dòng xe (mã SAP) *</Label>
          <SingleSelect options={models.map(m => ({ value: m.id, label: modelLabel(m) }))} value={vm} onChange={setVm} placeholder="Chọn dòng xe…" disabled={!!row} />
          {model && <p className="mt-1 text-[11px] text-slate-500">Tính cước: <b>{model.tariff_unit === 'PER_PALLET' ? 'theo pallet (làm tròn lên)' : 'trọn chuyến'}</b>{model.parent ? ` · dòng xe cha: ${model.parent.name}` : ' · CHƯA GÁN CHA — điều vận chưa dùng được dòng này'}</p>}</div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Phường/Xã (mới) *</Label><Input value={ward} onChange={e => setWard(e.target.value)} placeholder="HN-Phúc Lợi" className="h-9" />
            <p className="mt-1 text-[10px] text-slate-400">Ghi đúng "Tên Phường" của SAP (Tỉnh-Phường) để khớp khách hàng.</p></div>
          <div><Label className="text-xs">Tỉnh/TP (mới)</Label><Input value={province} onChange={e => setProvince(e.target.value)} className="h-9" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">{model?.tariff_unit === 'PER_PALLET' ? 'Đơn giá / pallet (VND) *' : 'Cước trọn chuyến (VND) *'}</Label>
            <Input type="number" inputMode="numeric" min={0} value={price} onChange={e => setPrice(e.target.value)} className="h-9 tabular-nums" /></div>
          <div><Label className="text-xs">Cự ly (km)</Label><Input type="number" inputMode="decimal" min={0} value={km} onChange={e => setKm(e.target.value)} className="h-9 tabular-nums" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Hiệu lực từ *</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">Hiệu lực đến</Label><Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="h-9" />
            <p className="mt-1 text-[10px] text-slate-400">Để trống = còn hiệu lực. Muốn ngừng một dòng cước thì đặt ngày kết thúc thay vì xoá.</p></div>
        </div>
        {row && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-4 w-4 accent-sky-600" />Đang hoạt động</label>}
        <div><Label className="text-xs">Ghi chú</Label><Input value={note} onChange={e => setNote(e.target.value)} className="h-9" /></div>
      </div>
    </FormSheet>
  )
}

// ─── FORM: phụ phí ───────────────────────────────────────────────────────────────────────────────
function SurchargeForm({ row, whs, companies, models, kinds, defaultWh, onClose }: {
  row: FreightSurcharge | null
  whs: { id: string; code?: string; name: string }[]
  companies: { value: string; label: string }[]
  models: VehicleModel[]
  kinds: SurchargeKind[]
  defaultWh: string
  onClose: () => void
}) {
  const save = useSaveFreightSurcharge()
  const [wh, setWh] = useState(row?.from_warehouse_id ?? defaultWh)
  const [co, setCo] = useState(row?.transport_company_id ?? '')
  const [vm, setVm] = useState(row?.vehicle_model_id ?? '')
  const [kind, setKind] = useState(row?.kind ?? (kinds[0]?.value ?? 'DROP_POINT'))
  const [per, setPer] = useState<SurchargePer>(row?.per ?? (kinds[0]?.default_per ?? 'PER_STOP'))
  const [amount, setAmount] = useState(row ? String(row.amount) : '')
  const [countMode, setCountMode] = useState<'ALL_STOPS' | 'EXTRA_STOPS'>(row?.count_mode ?? 'ALL_STOPS')
  const [minStops, setMinStops] = useState(String(row?.min_stops ?? 2))
  const [from, setFrom] = useState(row?.effective_from ?? todayVN())
  const [to, setTo] = useState(row?.effective_to ?? '')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [note, setNote] = useState(row?.note ?? '')
  const [err, setErr] = useState('')
  const canSave = !!wh && !!co && !!kind && Number(amount) >= 0 && amount !== '' && !!from
  const submit = async () => {
    setErr('')
    try {
      await save.mutateAsync({
        id: row?.id, ...(row ? {} : { from_warehouse_id: wh, transport_company_id: co }),
        vehicle_model_id: vm || null, kind, amount: Number(amount), per, count_mode: countMode, min_stops: Number(minStops) || 2,
        effective_from: from, effective_to: to || null, is_active: active, note: note.trim() || null,
      })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open onClose={onClose} title={row ? 'Sửa phụ phí' : 'Thêm phụ phí'}
      description="Mỗi ĐVVT ở mỗi kho một hợp đồng — rớt điểm, bốc xếp, chờ… khai riêng theo kho × ĐVVT; để trống dòng xe = áp cho mọi dòng xe của ĐVVT đó."
      footer={<>
        {err && <span className="text-[11px] text-red-600 flex-1 truncate">{err}</span>}
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
        <Button onClick={submit} disabled={save.isPending || !canSave}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-3">
        <div><Label className="text-xs">Kho xuất *</Label><WarehouseSingleSelect warehouses={whs} value={wh} onChange={setWh} placeholder="Chọn kho…" disabled={!!row} /></div>
        <div><Label className="text-xs">ĐVVT *</Label><SingleSelect options={companies} value={co} onChange={setCo} placeholder="Chọn ĐVVT…" disabled={!!row} /></div>
        <div><Label className="text-xs">Dòng xe</Label>
          <SingleSelect options={[{ value: '', label: '— Mọi dòng xe của ĐVVT —' }, ...models.map(m => ({ value: m.id, label: modelLabel(m) }))]} value={vm} onChange={setVm} placeholder="Mọi dòng xe" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Loại phụ phí *</Label>
            <SingleSelect options={kinds.map(k => ({ value: k.value, label: k.label }))} value={kind} searchable={false}
              onChange={v => { setKind(v); const k = kinds.find(x => x.value === v); if (k && !row) setPer(k.default_per) }} /></div>
          <div><Label className="text-xs">Tính theo *</Label>
            <SingleSelect options={(Object.keys(PER_LABEL) as SurchargePer[]).map(p => ({ value: p, label: PER_LABEL[p] }))} value={per} onChange={v => setPer(v as SurchargePer)} searchable={false} /></div>
        </div>
        <div><Label className="text-xs">Số tiền (VND) *</Label><Input type="number" inputMode="numeric" min={0} value={amount} onChange={e => setAmount(e.target.value)} className="h-9 tabular-nums" /></div>
        {per === 'PER_STOP' && (
          <div className="rounded border border-slate-200 bg-slate-50 p-2.5 space-y-2">
            <p className="text-[11px] text-slate-600">Rớt điểm theo THỰC TẾ chuyến: giao dưới <b>{minStops || 2}</b> điểm thì không tính.</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Từ mấy điểm mới tính</Label><Input type="number" min={1} max={50} value={minStops} onChange={e => setMinStops(e.target.value)} className="h-9 tabular-nums" /></div>
              <div><Label className="text-xs">Đếm điểm</Label>
                <SingleSelect searchable={false} value={countMode} onChange={v => setCountMode(v as 'ALL_STOPS' | 'EXTRA_STOPS')}
                  options={[{ value: 'ALL_STOPS', label: 'Mọi điểm (2 điểm = 2 khoản)' }, { value: 'EXTRA_STOPS', label: 'Chỉ điểm thêm (2 điểm = 1 khoản)' }]} /></div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Hiệu lực từ *</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">Hiệu lực đến</Label><Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="h-9" /></div>
        </div>
        {row && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-4 w-4 accent-sky-600" />Đang hoạt động</label>}
        <div><Label className="text-xs">Ghi chú</Label><Input value={note} onChange={e => setNote(e.target.value)} className="h-9" /></div>
      </div>
    </FormSheet>
  )
}

// ─── FORM: ưu tiên khu vực / tỷ trọng ────────────────────────────────────────────────────────────
function AllocationForm({ row, whs, companies, defaultWh, onClose }: {
  row: CarrierAllocation | null
  whs: { id: string; code?: string; name: string }[]
  companies: { value: string; label: string }[]
  defaultWh: string
  onClose: () => void
}) {
  const save = useSaveCarrierAllocation()
  const [wh, setWh] = useState(row?.from_warehouse_id ?? defaultWh)
  const [kind, setKind] = useState<'WARD' | 'REGION'>(row?.area_kind ?? 'WARD')
  const [area, setArea] = useState(row?.area_code ?? '')
  const [co, setCo] = useState(row?.transport_company_id ?? '')
  const [prio, setPrio] = useState(String(row?.priority ?? 1))
  const [from, setFrom] = useState(row?.effective_from ?? todayVN())
  const [to, setTo] = useState(row?.effective_to ?? '')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [err, setErr] = useState('')
  const submit = async () => {
    setErr('')
    try {
      await save.mutateAsync({ id: row?.id, ...(row ? {} : { from_warehouse_id: wh, area_kind: kind, area_code: area.trim(), transport_company_id: co }), priority: Number(prio) || 1, effective_from: from, effective_to: to || null, is_active: active })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open onClose={onClose} title={row ? 'Sửa ưu tiên khu vực' : 'Thêm ưu tiên ĐVVT theo khu vực'}
      description="Khu vực A ưu tiên ĐVVT này, khu vực B ưu tiên ĐVVT kia. Nhiều ĐVVT cho một khu vực = thứ tự dự phòng theo số ưu tiên."
      footer={<>
        {err && <span className="text-[11px] text-red-600 flex-1 truncate">{err}</span>}
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
        <Button onClick={submit} disabled={save.isPending || !wh || !co || !area.trim() || !from}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-3">
        <div><Label className="text-xs">Kho xuất *</Label><WarehouseSingleSelect warehouses={whs} value={wh} onChange={setWh} placeholder="Chọn kho…" disabled={!!row} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Cấp khu vực *</Label>
            <SingleSelect searchable={false} disabled={!!row} value={kind} onChange={v => setKind(v as 'WARD' | 'REGION')}
              options={[{ value: 'WARD', label: 'Phường (Tên Phường SAP)' }, { value: 'REGION', label: 'Tỉnh / vùng (mã Region SAP)' }]} /></div>
          <div><Label className="text-xs">Mã khu vực *</Label><Input value={area} disabled={!!row} onChange={e => setArea(e.target.value)} placeholder={kind === 'WARD' ? 'HN-Phúc Lợi' : '100'} className="h-9" /></div>
        </div>
        <div><Label className="text-xs">ĐVVT *</Label><SingleSelect options={companies} value={co} onChange={setCo} placeholder="Chọn ĐVVT…" disabled={!!row} /></div>
        <div><Label className="text-xs">Ưu tiên (1 = cao nhất)</Label><Input type="number" min={1} max={99} value={prio} onChange={e => setPrio(e.target.value)} className="h-9 w-28 tabular-nums" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Hiệu lực từ *</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">Hiệu lực đến</Label><Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="h-9" /></div>
        </div>
        {row && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-4 w-4 accent-sky-600" />Đang hoạt động</label>}
      </div>
    </FormSheet>
  )
}
function ShareForm({ row, whs, companies, defaultWh, onClose }: {
  row: CarrierShare | null
  whs: { id: string; code?: string; name: string }[]
  companies: { value: string; label: string }[]
  defaultWh: string
  onClose: () => void
}) {
  const save = useSaveCarrierShare()
  const [wh, setWh] = useState(row?.from_warehouse_id ?? defaultWh)
  const [co, setCo] = useState(row?.transport_company_id ?? '')
  const [pct, setPct] = useState(row ? String(row.share_pct) : '')
  const [basis, setBasis] = useState<'TRIPS' | 'PALLETS' | 'TONS'>(row?.basis ?? 'TRIPS')
  const [from, setFrom] = useState(row?.effective_from ?? todayVN())
  const [to, setTo] = useState(row?.effective_to ?? '')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [err, setErr] = useState('')
  const submit = async () => {
    setErr('')
    try {
      await save.mutateAsync({ id: row?.id, ...(row ? {} : { from_warehouse_id: wh, transport_company_id: co }), share_pct: Number(pct), basis, effective_from: from, effective_to: to || null, is_active: active })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open onClose={onClose} title={row ? 'Sửa tỷ trọng ĐVVT' : 'Thêm tỷ trọng ĐVVT'}
      description="Tỷ trọng cố định trước cho ĐVVT trên tổng của kho trong tháng (vd ĐVVT 1 = 30 %, ĐVVT 2 = 25 %). Tổng ≤ 100 %; phần còn lại là tự do chọn theo cước."
      footer={<>
        {err && <span className="text-[11px] text-red-600 flex-1 truncate">{err}</span>}
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
        <Button onClick={submit} disabled={save.isPending || !wh || !co || !(Number(pct) > 0 && Number(pct) <= 100) || !from}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-3">
        <div><Label className="text-xs">Kho xuất *</Label><WarehouseSingleSelect warehouses={whs} value={wh} onChange={setWh} placeholder="Chọn kho…" disabled={!!row} /></div>
        <div><Label className="text-xs">ĐVVT *</Label><SingleSelect options={companies} value={co} onChange={setCo} placeholder="Chọn ĐVVT…" disabled={!!row} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Tỷ trọng (%) *</Label><Input type="number" inputMode="decimal" min={0.1} max={100} step={0.5} value={pct} onChange={e => setPct(e.target.value)} className="h-9 tabular-nums" /></div>
          <div><Label className="text-xs">Đo bằng</Label>
            <SingleSelect searchable={false} value={basis} onChange={v => setBasis(v as 'TRIPS' | 'PALLETS' | 'TONS')}
              options={[{ value: 'TRIPS', label: 'Số chuyến' }, { value: 'PALLETS', label: 'Pallet' }, { value: 'TONS', label: 'Tấn' }]} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Hiệu lực từ *</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">Hiệu lực đến</Label><Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="h-9" /></div>
        </div>
        {row && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-4 w-4 accent-sky-600" />Đang hoạt động</label>}
      </div>
    </FormSheet>
  )
}

/** Cặp nút Sửa / Xoá cuối dòng — mức module để không remount theo state của trang. */
function ActBtns({ onEdit, onDel }: { onEdit: () => void; onDel: () => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <button className="text-slate-400 hover:text-blue-500 p-1" onClick={e => { e.stopPropagation(); onEdit() }} title="Sửa"><Pencil className="h-3.5 w-3.5" /></button>
      <button className="text-slate-400 hover:text-red-500 p-1" onClick={e => { e.stopPropagation(); onDel() }} title="Xoá"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  )
}

// ─── TRANG ───────────────────────────────────────────────────────────────────────────────────────
export default function Freight() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canManage = can(perms, 'freight', 'manage')

  const f = useWmsFilterStore(s => s.freight)
  const setF = useWmsFilterStore(s => s.setFreight)
  const permTabs = useMemo(() => PAGE_TAB_DEFS.map(t => ({ key: t.key, label: t.label, icon: t.icon })), [])
  const tabs = useMobileTabs('/tms/freight', permTabs, f.tab, (t: string) => setF({ tab: t as TabKey, page: 1 }))

  const { data: warehouses = [] } = useScopedWarehouses(true)
  const whs = warehouses as { id: string; code?: string; name: string }[]
  const { data: companiesRaw = [] } = useTransportCompanies(true, 'ĐVVT')
  const companies = useMemo(() => companiesRaw.map(c => ({ value: c.id, label: `${c.code} · ${c.name}` })), [companiesRaw])
  const { data: modelsRes } = useVehicleModels({ is_active: true })
  const models = modelsRes?.items ?? []

  const listParams = { warehouse_id: f.warehouseId || undefined, company_id: f.companyId || undefined, model_id: f.modelId || undefined }
  const tariffs = useFreightTariffs({ ...listParams, q: f.search || undefined, page: f.page, pageSize: f.pageSize }, f.tab === 'tariffs')
  const surcharges = useFreightSurcharges(listParams, f.tab === 'surcharges')
  const alloc = useCarrierAllocations({ warehouse_id: f.warehouseId || undefined }, f.tab === 'allocation')

  const delTariff = useDeleteFreightTariff(), delSur = useDeleteFreightSurcharge(), delAlloc = useDeleteCarrierAllocation(), delShare = useDeleteCarrierShare()
  const upload = useUploadFreightTariffs()

  const [form, setForm] = useState<
    | { kind: 'tariff'; row: FreightTariff | null } | { kind: 'surcharge'; row: FreightSurcharge | null }
    | { kind: 'alloc'; row: CarrierAllocation | null } | { kind: 'share'; row: CarrierShare | null } | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho xuất', type: 'single', value: f.warehouseId, onChange: v => setF({ warehouseId: v, page: 1 }), options: whs.map(w => ({ value: w.id, label: w.code ? `${w.code} · ${w.name}` : w.name })), pinned: true },
    { key: 'co', label: 'ĐVVT', type: 'single', value: f.companyId, onChange: v => setF({ companyId: v, page: 1 }), options: companies },
    ...(f.tab === 'allocation' ? [] : [{ key: 'vm', label: 'Dòng xe', type: 'single' as const, value: f.modelId, onChange: (v: string) => setF({ modelId: v, page: 1 }), options: models.map(m => ({ value: m.id, label: modelLabel(m) })) }]),
  ]
  const [ask, confirmNode] = useConfirmDialog()
  const confirmDel = async (msg: string, run: () => Promise<unknown>) => {
    if (await ask({ title: msg, danger: true, confirmLabel: 'Xoá' }) === null) return
    run().catch(e => toast({ variant: 'destructive', title: 'Không xoá được', description: apiMsg(e) }))
  }

  const actionItems: ActionItem[] = []
  if (canManage && f.tab === 'tariffs') {
    actionItems.push({ key: 'upload', icon: Upload, label: 'Upload cước', tip: 'Upload bảng cước Excel đúng cột file thật (kiểm trước, chưa ghi)', onClick: () => setShowUpload(true), mobileHidden: true })
    actionItems.push({ key: 'add', icon: Plus, label: 'Thêm dòng cước', tip: 'Thêm một dòng cước', primary: true, variant: 'default', onClick: () => setForm({ kind: 'tariff', row: null }) })
  }
  if (canManage && f.tab === 'surcharges') actionItems.push({ key: 'add', icon: Plus, label: 'Thêm phụ phí', tip: 'Thêm phụ phí (rớt điểm, bốc xếp…)', primary: true, variant: 'default', onClick: () => setForm({ kind: 'surcharge', row: null }) })
  if (canManage && f.tab === 'allocation') {
    actionItems.push({ key: 'add-a', icon: MapPinned, label: 'Thêm ưu tiên', tip: 'Ưu tiên ĐVVT theo khu vực', primary: true, variant: 'default', onClick: () => setForm({ kind: 'alloc', row: null }) })
    actionItems.push({ key: 'add-s', icon: Percent, label: 'Thêm tỷ trọng', tip: 'Tỷ trọng ĐVVT theo tháng', primary: true, variant: 'default', onClick: () => setForm({ kind: 'share', row: null }) })
  }

  const tRows = tariffs.data?.items ?? [], tTotal = tariffs.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(tTotal / f.pageSize))
  const sRows = surcharges.data?.items ?? [], kinds = surcharges.data?.kinds ?? []
  const kindLabel = (k: string) => kinds.find(x => x.value === k)?.label ?? k
  const aRows = alloc.data?.allocations ?? [], shRows = alloc.data?.shares ?? []
  const shareSum = shRows.filter(s => s.effective_now).reduce((a, s) => a + Number(s.share_pct), 0)
  const unassigned = modelsRes?.unassigned ?? 0

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Tiêu đề + TAB cùng hàng đầu (khuôn Cài đặt TMS / Cài đặt WMS / Khách hàng) — bản 23/09 để tab
            xuống DƯỚI thanh lọc, trang duy nhất trong app đặt tab ở hàng thứ ba */}
        <Tabs value={f.tab} onValueChange={v => setF({ tab: v as TabKey, page: 1 })}>
          <div className="border-b bg-white px-3 py-2 shrink-0 flex items-center gap-2 flex-wrap sm:rounded-t-xl">
            <span className="text-sm font-semibold text-slate-700 shrink-0 hidden sm:flex items-center gap-1.5"><Banknote className="h-4 w-4 text-slate-500" /> Cước vận chuyển</span>
            <TabsList className="h-8 max-w-full overflow-x-auto">
              {tabs.map(t => <TabsTrigger key={t.key} value={t.key} className="gap-1.5 text-xs"><t.icon className="h-3.5 w-3.5" /> {t.label}</TabsTrigger>)}
            </TabsList>
          </div>
          <TabsContent value="tariffs" className="hidden" /><TabsContent value="surcharges" className="hidden" /><TabsContent value="allocation" className="hidden" />
        </Tabs>
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:space-y-1.5 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {f.tab === 'tariffs' && <SearchInput value={f.search} onChange={v => setF({ search: v, page: 1 })} placeholder="Tìm phường, tỉnh…" className="flex-1 min-w-[160px]" />}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <FilterSheetButton defs={filterDefs} className="sm:hidden" />
              {f.tab !== 'tariffs' && <div className="hidden sm:block flex-1" />}
              <ActionCluster items={actionItems} mobileInline />
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        {unassigned > 0 && canManage && (
          <div className="px-3 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200">
            <b>{nf(unassigned)}</b> dòng xe con chưa gán dòng xe cha — điều vận chưa ghép được vào các dòng đó. Gán ở Cài đặt TMS → Mã dòng xe.
          </div>
        )}

        {/* ── BẢNG CƯỚC ── */}
        {f.tab === 'tariffs' && (<>
          <SummaryBand tiles={[
            { label: 'Dòng cước', value: nf(tTotal), tip: 'Tổng dòng cước theo bộ lọc (đếm trên máy chủ)' },
            { label: 'Kho xuất', value: f.warehouseId ? (whs.find(w => w.id === f.warehouseId)?.name ?? '1') : 'Mọi kho trong phạm vi' },
            ...(totalPages > 1 ? [{ label: 'Trang', value: `${f.page}/${totalPages}` }] : []),
          ]} />
          <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
            <ResizableTable storageKey="freight_tariff_cols_v1" cols={withAct(TARIFF_COLS, canManage)}>
              <TableBody>
                {tariffs.isLoading && <TableEmptyRow colSpan={12}>Đang tải…</TableEmptyRow>}
                {!tariffs.isLoading && !tRows.length && <TableEmptyRow colSpan={12}>{f.warehouseId || f.companyId || f.modelId || f.search ? 'Không có dòng cước khớp bộ lọc.' : 'Chưa có dòng cước nào — bấm "Upload cước" để nạp bảng cước theo cột file thật, hoặc "Thêm dòng cước".'}</TableEmptyRow>}
                {tRows.map(r => (
                  <TableRow key={r.id} className={r.is_active ? '' : 'text-slate-400'}>
                    <TableCell className={TD0}>{r.warehouse?.name ?? r.from_warehouse_id}</TableCell>
                    <TableCell className={TD}><span className="font-mono font-semibold">{r.company?.code ?? '?'}</span> <span className="text-slate-500">{r.company?.name}</span></TableCell>
                    <TableCell className={TD}><span className="font-mono">{r.model?.sap_code}</span> <span className="text-slate-600">{r.model?.name}</span></TableCell>
                    <TableCell className={TD}><div className="font-medium">{r.ward_code}</div>{r.ward_raw && r.ward_raw !== r.ward_code && <div className="text-[9px] text-slate-400">file: {r.ward_raw}</div>}</TableCell>
                    <TableCell className={TD}>{r.province_new ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`${TD} text-right tabular-nums`}>{r.distance_km ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`${TD} text-right tabular-nums font-semibold`}>{vnd(r.price)}</TableCell>
                    <TableCell className={TD}>{r.model?.tariff_unit === 'PER_PALLET' ? '/ pallet (làm tròn lên)' : '/ chuyến'}</TableCell>
                    <TableCell className={TD}>{effText(r)}</TableCell>
                    <TableCell className={TD}><StatusBadge tone={r.is_active ? 'green' : 'slate'}>{r.is_active ? 'Hoạt động' : 'Tạm dừng'}</StatusBadge></TableCell>
                    <TableCell className={TD}><div className="leading-tight"><div className="text-slate-600">{r.updated_by ?? <span className="text-slate-300">—</span>}</div><div className="text-[9px] text-slate-400">{formatTimestampDate(r.updated_at, true)}</div></div></TableCell>
                    {canManage && <TableCell className={TDR}><ActBtns onEdit={() => setForm({ kind: 'tariff', row: r })} onDel={() => confirmDel(`Xoá dòng cước ${r.ward_code} (${r.company?.code})?`, () => delTariff.mutateAsync(r.id))} /></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </ResizableTable>
            <PagerNav page={f.page} totalPages={totalPages} onPage={p => setF({ page: p })} />
          </div>
          <ListFooter page={f.page} pageSize={f.pageSize} total={tTotal} unit="dòng cước" onPageSize={n => setF({ pageSize: n, page: 1 })}
            right="Xe pallet: đơn giá × số pallet làm tròn LÊN · xe khác: trọn chuyến" />
        </>)}

        {/* ── PHỤ PHÍ ── */}
        {f.tab === 'surcharges' && (<>
          <SummaryBand tiles={[
            { label: 'Phụ phí', value: nf(sRows.length) },
            { label: 'Rớt điểm', value: nf(sRows.filter(s => s.kind === 'DROP_POINT' && s.is_active).length), tip: 'Giao 1 điểm không tính; từ 2 điểm mỗi điểm một khoản theo hợp đồng ĐVVT' },
            { label: 'ĐVVT có phụ phí', value: nf(new Set(sRows.map(s => s.transport_company_id)).size) },
          ]} />
          <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
            <ResizableTable storageKey="freight_surcharge_cols_v1" cols={withAct(SUR_COLS, canManage)}>
              <TableBody>
                {surcharges.isLoading && <TableEmptyRow colSpan={10}>Đang tải…</TableEmptyRow>}
                {!surcharges.isLoading && !sRows.length && <TableEmptyRow colSpan={10}>Chưa có phụ phí nào theo bộ lọc — mỗi ĐVVT ở mỗi kho khai riêng rớt điểm / bốc xếp theo hợp đồng.</TableEmptyRow>}
                {sRows.map(r => (
                  <TableRow key={r.id} className={r.is_active ? '' : 'text-slate-400'}>
                    <TableCell className={TD0}>{r.warehouse?.name ?? r.from_warehouse_id}</TableCell>
                    <TableCell className={TD}><span className="font-mono font-semibold">{r.company?.code ?? '?'}</span> <span className="text-slate-500">{r.company?.name}</span></TableCell>
                    <TableCell className={TD}>{r.model ? <><span className="font-mono">{r.model.sap_code}</span> {r.model.name}</> : <span className="text-slate-500">Mọi dòng xe</span>}</TableCell>
                    <TableCell className={TD}><StatusBadge tone={r.kind === 'DROP_POINT' ? 'amber' : 'slate'}>{kindLabel(r.kind)}</StatusBadge></TableCell>
                    <TableCell className={`${TD} text-right tabular-nums font-semibold`}>{vnd(r.amount)}</TableCell>
                    <TableCell className={TD}>{PER_LABEL[r.per]}{r.per === 'PER_STOP' && <span className="text-slate-500"> · từ {r.min_stops} điểm · {r.count_mode === 'ALL_STOPS' ? 'đếm mọi điểm' : 'chỉ điểm thêm'}</span>}</TableCell>
                    <TableCell className={TD}>{effText(r)}</TableCell>
                    <TableCell className={TD}><StatusBadge tone={r.is_active ? 'green' : 'slate'}>{r.is_active ? 'Hoạt động' : 'Tạm dừng'}</StatusBadge></TableCell>
                    <TableCell className={`${TD} truncate`} title={r.note ?? undefined}>{r.note ?? <span className="text-slate-300">—</span>}</TableCell>
                    {canManage && <TableCell className={TDR}><ActBtns onEdit={() => setForm({ kind: 'surcharge', row: r })} onDel={() => confirmDel(`Xoá phụ phí ${kindLabel(r.kind)} của ${r.company?.code}?`, () => delSur.mutateAsync(r.id))} /></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </ResizableTable>
          </div>
          <ListFooter page={1} pageSize={Math.max(1, sRows.length)} total={sRows.length} unit="phụ phí" onPageSize={() => { }} options={[]} />
        </>)}

        {/* ── PHÂN TUYẾN ĐVVT ── */}
        {f.tab === 'allocation' && (<>
          <SummaryBand tiles={[
            { label: 'Ưu tiên khu vực', value: nf(aRows.filter(a => a.effective_now).length), tip: 'Số dòng ưu tiên đang hiệu lực' },
            { label: 'ĐVVT có tỷ trọng', value: nf(shRows.filter(s => s.effective_now).length) },
            { label: 'Σ tỷ trọng', value: f.warehouseId ? `${shareSum.toLocaleString('vi-VN')} %` : 'chọn kho', tip: 'Tổng tỷ trọng đang hiệu lực của kho đang chọn; phần còn lại tới 100 % là tự do chọn theo cước' },
          ]} />
          <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
            <div className="flex items-center gap-2 bg-slate-100 border-b px-3 py-1.5">
              <span className="h-4 w-1 rounded bg-sky-500" /><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Ưu tiên ĐVVT theo khu vực</span>
              <InfoTip tip="Engine chọn ĐVVT cho một chuyến: (1) ĐVVT được ưu tiên ở khu vực của điểm đến xa nhất — phường trước, tỉnh/vùng sau; (2) trong số đó, ĐVVT đang dưới tỷ trọng tháng lên trước; (3) hoà thì cước thấp nhất. Không khai gì = chọn rẻ nhất." />
            </div>
            <ResizableTable storageKey="freight_alloc_cols_v1" cols={withAct(ALLOC_COLS, canManage)}>
              <TableBody>
                {alloc.isLoading && <TableEmptyRow colSpan={8}>Đang tải…</TableEmptyRow>}
                {!alloc.isLoading && !aRows.length && <TableEmptyRow colSpan={8}>Chưa khai ưu tiên khu vực nào — engine sẽ chọn ĐVVT rẻ nhất.</TableEmptyRow>}
                {aRows.map(r => (
                  <TableRow key={r.id} className={r.is_active && r.effective_now ? '' : 'text-slate-400'}>
                    <TableCell className={TD0}>{r.warehouse?.name ?? r.from_warehouse_id}</TableCell>
                    <TableCell className={TD}>{r.area_kind === 'WARD' ? 'Phường' : 'Tỉnh / vùng'}</TableCell>
                    <TableCell className={`${TD} font-medium`}>{r.area_code}</TableCell>
                    <TableCell className={TD}><span className="font-mono font-semibold">{r.company?.code ?? '?'}</span> <span className="text-slate-500">{r.company?.name}</span></TableCell>
                    <TableCell className={`${TD} text-center tabular-nums`}>{r.priority}</TableCell>
                    <TableCell className={TD}>{effText(r)}</TableCell>
                    <TableCell className={TD}><StatusBadge tone={r.is_active && r.effective_now ? 'green' : 'slate'}>{!r.is_active ? 'Tạm dừng' : r.effective_now ? 'Hiệu lực' : 'Ngoài hiệu lực'}</StatusBadge></TableCell>
                    {canManage && <TableCell className={TDR}><ActBtns onEdit={() => setForm({ kind: 'alloc', row: r })} onDel={() => confirmDel(`Xoá ưu tiên ${r.area_code} → ${r.company?.code}?`, () => delAlloc.mutateAsync(r.id))} /></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </ResizableTable>
            <div className="flex items-center gap-2 bg-slate-100 border-y px-3 py-1.5 mt-3">
              <span className="h-4 w-1 rounded bg-sky-500" /><span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Tỷ trọng ĐVVT theo tháng</span>
              <InfoTip tip="Tỷ trọng cố định trước (vd ĐVVT 1 = 30 %, ĐVVT 2 = 25 % số chuyến của kho trong tháng). ĐVVT đang dưới tỷ trọng được ưu tiên nhận chuyến kế. Tổng của một kho không quá 100 %." />
            </div>
            <ResizableTable storageKey="freight_share_cols_v1" cols={withAct(SHARE_COLS, canManage)}>
              <TableBody>
                {!alloc.isLoading && !shRows.length && <TableEmptyRow colSpan={7}>Chưa khai tỷ trọng — mọi ĐVVT tự do theo cước.</TableEmptyRow>}
                {shRows.map(r => (
                  <TableRow key={r.id} className={r.is_active && r.effective_now ? '' : 'text-slate-400'}>
                    <TableCell className={TD0}>{r.warehouse?.name ?? r.from_warehouse_id}</TableCell>
                    <TableCell className={TD}><span className="font-mono font-semibold">{r.company?.code ?? '?'}</span> <span className="text-slate-500">{r.company?.name}</span></TableCell>
                    <TableCell className={`${TD} text-right tabular-nums font-semibold`}>{Number(r.share_pct).toLocaleString('vi-VN')} %</TableCell>
                    <TableCell className={TD}>{r.basis === 'TRIPS' ? 'Số chuyến' : r.basis === 'PALLETS' ? 'Pallet' : 'Tấn'} / tháng</TableCell>
                    <TableCell className={TD}>{effText(r)}</TableCell>
                    <TableCell className={TD}><StatusBadge tone={r.is_active && r.effective_now ? 'green' : 'slate'}>{!r.is_active ? 'Tạm dừng' : r.effective_now ? 'Hiệu lực' : 'Ngoài hiệu lực'}</StatusBadge></TableCell>
                    {canManage && <TableCell className={TDR}><ActBtns onEdit={() => setForm({ kind: 'share', row: r })} onDel={() => confirmDel(`Xoá tỷ trọng ${r.company?.code} ${r.share_pct} %?`, () => delShare.mutateAsync(r.id))} /></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </ResizableTable>
          </div>
          <ListFooter page={1} pageSize={Math.max(1, aRows.length)} total={aRows.length} unit="ưu tiên" onPageSize={() => { }} options={[]} right={`${shRows.length} tỷ trọng`} />
        </>)}
      </div>

      {form?.kind === 'tariff' && <TariffForm row={form.row} whs={whs} companies={companies} models={models} defaultWh={f.warehouseId} onClose={() => setForm(null)} />}
      {form?.kind === 'surcharge' && <SurchargeForm row={form.row} whs={whs} companies={companies} models={models} kinds={kinds} defaultWh={f.warehouseId} onClose={() => setForm(null)} />}
      {form?.kind === 'alloc' && <AllocationForm row={form.row} whs={whs} companies={companies} defaultWh={f.warehouseId} onClose={() => setForm(null)} />}
      {form?.kind === 'share' && <ShareForm row={form.row} whs={whs} companies={companies} defaultWh={f.warehouseId} onClose={() => setForm(null)} />}
      {showUpload && (
        <UploadExcelDialog
          title="Upload bảng cước"
          hint={`Cột như file bảng cước thật: Tỉnh/TP (Cũ) · Quận/Huyện (Cũ) · Tỉnh/TP (Mới) · Phường/Xã (Mới) · Cự ly (Km) · DVVT · Loại xe · Cước (VND) · Mã xe SAP; thêm "Kho xuất" nếu file gồm nhiều kho${f.warehouseId ? ` (không có cột này thì lấy kho đang lọc: ${whs.find(w => w.id === f.warehouseId)?.name ?? ''})` : ' — hoặc chọn Kho xuất ở bộ lọc trước khi upload'}. Còn 1 dòng lỗi (ĐVVT lạ, mã xe SAP không có, cước không phải số) là KHÔNG ghi gì. Dòng trùng khoá = đè giá.`}
          onClose={() => setShowUpload(false)}
          onDownloadTemplate={downloadTariffTemplate}
          onUpload={(file, preflight) => upload.mutateAsync({ file, preflight, warehouse_id: f.warehouseId || undefined })}
        />
      )}
      {confirmNode}
    </div>
  )
}
