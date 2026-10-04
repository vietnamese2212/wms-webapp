// KHÁCH HÀNG / NƠI NHẬN — danh mục nuôi %Date tự động + luật Chuyển kho (user chốt 11/09).
//
// Vì sao là trang riêng chứ không phải một tab trong Cài đặt Kho: khoá của danh mục này là MÃ
// SHIP-TO của SAP, và nó quyết định hai thứ khác nhau — (1) %Date lấy hàng mặc định của khách,
// (2) ai xác nhận hàng khi chuyển kho. Kho là nơi HÀNG NẰM; khách là nơi HÀNG ĐẾN.
//
// Hai tab: Khách hàng (list chuẩn + thao tác hàng loạt) · Kênh (Kho tổng / NPP / BHX / KA / MT…).
import { useMemo, useState } from 'react'
import {
  Store, Plus, DownloadCloud, Layers, CalendarClock, Warehouse as WarehouseIcon,
  Power, Pencil, AlertTriangle, Truck, MapPin,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FloatingActionBar, FLOATING_BTN, FLOATING_BTN_DANGER } from '@/components/shared/FloatingActionBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { UploadPreflightPanel } from '@/components/shared/UploadPreflightPanel'
import { masterRuleLabel } from '@/components/wms/SetDateRuleSheet'
import { DispatchVehiclesEditor, VehicleModelChecklist, vehicleListText, splitVehicleIds } from '@/components/tms/DispatchVehiclesEditor'
import {
  useCustomers, useCustomerChannels, useCustomerSeedCandidates, useSaveCustomer,
  useDeactivateCustomer, useBulkUpdateCustomers, useSeedCustomers, useUpdateCustomerChannel, useCreateCustomerChannel,
  useSaveDateRules, useBulkSetDateRule, useDateRuleCategories, useVehicleModels,
  useCustomerGeoStatus, useSetCustomerLocation, useGeocodeCustomers, GEO_SOURCE_VI,
  type Customer, type CustomerCandidate, type CustomerPatch, type CustomerBulkPatch, type UploadPreflight,
  type MasterRuleRow, type DateRuleCategory, type VehicleModel,
} from '@/api/hooks'
import { GeoPicker } from '@/components/shared/GeoPicker'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useMobileTabs } from '@/hooks/useMobileSurface'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate } from '@/utils/formatters'
import type { DateRule } from '@/types'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'

const nf = (n: number) => n.toLocaleString('vi-VN')

// 2 tab cấp trang — key khớp PAGE_TABS['/masterdata/customers'] (config/mobileSurface.ts)
const PAGE_TAB_DEFS = [{ key: 'list', label: 'Khách hàng' }, { key: 'channels', label: 'Kênh' }] as const

const COLS = [
  { id: 'pick',  label: '',                 w: 36 },
  { id: 'code',  label: 'Mã ship-to',       w: 96 },
  { id: 'name',  label: 'Tên khách hàng',   w: 240 },
  { id: 'chan',  label: 'Kênh',             w: 120 },
  { id: 'mode',  label: 'Dòng xe',          w: 110 },
  { id: 'rule',  label: 'Quy định date',    w: 210 },
  { id: 'wh',    label: 'Kho nhận',         w: 170 },
  { id: 'geo',   label: 'Định vị',          w: 96 },
  { id: 'src',   label: 'Nguồn',            w: 86 },
  { id: 'act',   label: 'Trạng thái',       w: 90 },
  { id: 'upd',   label: 'Sửa',              w: 110 },
]

/** Một dòng đang soạn trong bảng mức. `kind: ''` = dòng trống (bỏ qua lúc lưu). */
type RuleDraft = { category: string | null; kind: '' | 'FEFO' | 'MIN_PCT' | 'MIN_DAYS'; value: string }

const draftsOf = (rows: MasterRuleRow[] | undefined): RuleDraft[] =>
  (rows ?? []).map(r => ({
    category: r.category,
    kind: (r.rule?.kind === 'MIN_PCT' || r.rule?.kind === 'MIN_DAYS' || r.rule?.kind === 'FEFO') ? r.rule.kind : '',
    value: r.rule?.value == null ? '' : String(r.rule.value),
  }))

const toPayload = (ds: RuleDraft[]) =>
  ds.filter(d => d.kind !== '')
    .map(d => ({ category: d.category, kind: d.kind, value: d.kind === 'FEFO' ? null : Number(d.value) || 0 }))

/**
 * BẢNG MỨC QUY ĐỊNH DATE của một khách / một kênh — mỗi dòng: Loại hàng · Kiểu · Giá trị.
 *
 * Vì sao là BẢNG chứ không phải một ô chọn: mức thuộc về cặp (khách × loại hàng) — cùng một khách
 * đòi FG01 ≥ 70 % nhưng FG02 ≥ 35 ngày, và "35 ngày" KHÔNG quy được thành một con số % dùng chung
 * (FG02 hạn 45–60 ngày ⇒ 35 ngày ra 77,8 % ở mã này, 58,3 % ở mã kia).
 *
 * Hai thứ giữ cho người khai không đi vào bẫy:
 *   • Nhãn dòng "mọi loại hàng" LIỆT KÊ đúng những loại chưa khai riêng, trừ dần khi thêm dòng.
 *   • Câu QUY ĐỔI sống: gõ ≥ 60 % cho FG02 thì hiện ngay "≈ còn 27–36 ngày" — chính chỗ mức chung
 *     nuốt mất yêu cầu 35 ngày mà không ai thấy gì sai.
 */
function RuleTable({ drafts, onChange, cats, inheritNote }: {
  drafts: RuleDraft[]
  onChange: (next: RuleDraft[]) => void
  cats: DateRuleCategory[]
  inheritNote?: string
}) {
  const used = new Set(drafts.map(d => d.category).filter((c): c is string => !!c))
  const measurable = cats.filter(c => c.measurable)
  const rest = measurable.filter(c => !used.has(c.value)).map(c => c.value)
  const hasGeneral = drafts.some(d => d.category === null)
  // "Các loại CÒN LẠI" chỉ đúng khi đã có dòng khai riêng để mà "còn lại"; chưa khai riêng loại nào
  // thì dòng chung phủ TẤT CẢ và phải nói đúng như vậy.
  const generalWord = used.size ? 'Các loại còn lại' : 'Mọi loại hàng'
  const patch = (i: number, up: Partial<RuleDraft>) => onChange(drafts.map((d, j) => (j === i ? { ...d, ...up } : d)))

  /** Quy đổi sống: mức đang gõ ra khoảng NGÀY (hoặc %) theo hạn dùng thật của loại hàng đó. */
  const convert = (d: RuleDraft): string | null => {
    if (d.kind !== 'MIN_PCT' && d.kind !== 'MIN_DAYS') return null
    const n = Number(d.value)
    if (!Number.isFinite(n) || n <= 0) return null
    const c = d.category ? cats.find(x => x.value === d.category) : null
    if (!c || c.min_shelf_life == null || c.max_shelf_life == null) return null
    const lo = c.min_shelf_life, hi = c.max_shelf_life
    if (d.kind === 'MIN_PCT')
      return `≈ còn ${Math.round(lo * n / 100)}–${Math.round(hi * n / 100)} ngày (mã ${d.category} hạn ${lo}–${hi} ngày)`
    return `≈ ${Math.round(n / hi * 100)}–${Math.round(n / lo * 100)} % tuỳ mã (${d.category} hạn ${lo}–${hi} ngày)`
  }

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[420px]">
          <thead>
            <tr className="bg-slate-50 border-b">
              {['Loại hàng', 'Kiểu', 'Giá trị', ''].map(h => (
                <th key={h} className="text-left text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!drafts.length && (
              <TableEmptyRow colSpan={4}>
                Chưa khai mức nào{inheritNote ? ` — ${inheritNote}` : ''}
</TableEmptyRow>
            )}
            {drafts.map((d, i) => (
              <tr key={i} className="border-b last:border-0 align-top">
                <td className="px-2 py-1.5">
                  <select value={d.category ?? ''}
                    onChange={e => patch(i, { category: e.target.value || null })}
                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-1.5 text-[11px]">
                    <option value="">
                      {rest.length ? `${generalWord} (${rest.join(', ')})` : generalWord}
                    </option>
                    {measurable.map(c => (
                      <option key={c.value} value={c.value} disabled={used.has(c.value) && d.category !== c.value}>
                        {c.value} — {c.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select value={d.kind}
                    onChange={e => {
                      const k = e.target.value as RuleDraft['kind']
                      patch(i, { kind: k, value: k === 'MIN_PCT' ? '60' : k === 'MIN_DAYS' ? '35' : '' })
                    }}
                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-1.5 text-[11px]">
                    <option value="">— chưa khai —</option>
                    <option value="MIN_PCT">≥ % hạn dùng</option>
                    <option value="MIN_DAYS">≥ số ngày còn lại</option>
                    <option value="FEFO">Theo quy định date của kho</option>
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  {d.kind === 'MIN_PCT' || d.kind === 'MIN_DAYS' ? (
                    <div className="relative w-[110px]">
                      <Input value={d.value} inputMode="numeric" onChange={e => patch(i, { value: e.target.value })}
                        className="h-8 pr-10 text-[11px] text-right" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pointer-events-none">
                        {d.kind === 'MIN_PCT' ? '%' : 'ngày'}
                      </span>
                    </div>
                  ) : <span className="text-[11px] text-slate-400">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" className="text-[11px] text-slate-400 hover:text-red-600 px-1"
                    title="Bỏ dòng này" onClick={() => onChange(drafts.filter((_, j) => j !== i))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Câu quy đổi sống — đứng dưới bảng để không làm hàng bảng cao lên */}
      {drafts.map((d, i) => {
        const c = convert(d)
        return c ? <p key={i} className="text-[11px] text-slate-500">· {c}</p> : null
      })}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
          disabled={drafts.length >= 20 || (hasGeneral && rest.length === 0)}
          onClick={() => onChange([...drafts, { category: hasGeneral ? (rest[0] ?? null) : null, kind: 'MIN_PCT', value: '60' }])}>
          + Thêm dòng
        </Button>
        {cats.some(c => !c.measurable) && (
          <span className="text-[11px] text-slate-400">
            {cats.filter(c => !c.measurable).map(c => c.value).join(', ')} — không khai hạn dùng, quy định date không áp
          </span>
        )}
      </div>
    </div>
  )
}

export default function Customers() {
  const f = useWmsFilterStore(s => s.customers)
  const setF = useWmsFilterStore(s => s.setCustomers)
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canEdit = can(perms, 'customers', 'edit')
  const canImport = can(perms, 'customers', 'import')
  const canChannel = can(perms, 'customers', 'manage_channel')
  const canCreateChannel = can(perms, 'customers', 'create_channel')
  // Toạ độ điểm giao (01/10): locate = chấm tay / GPS trong form · geocode = máy định vị hàng loạt (nút trên thanh công cụ)
  const canLocate = can(perms, 'customers', 'locate')
  const canGeocode = can(perms, 'customers', 'geocode')
  const geoStatus = useCustomerGeoStatus(canGeocode)
  const geocode = useGeocodeCustomers()
  const setLoc = useSetCustomerLocation()
  const [geoMsg, setGeoMsg] = useState('')
  const runGeocode = async () => {
    setErr(''); setGeoMsg('')
    try {
      const r = await geocode.mutateAsync({})
      setGeoMsg(`Định vị được ${nf(r.done.length)} khách${r.precision === 'ward' ? ' (tâm phường/xã theo địa chỉ)' : ''}${r.failed.length ? ` · ${nf(r.failed.length)} không tìm thấy (${r.failed.slice(0, 3).map(x => x.ship_to_code).join(', ')}${r.failed.length > 3 ? '…' : ''})` : ''}${r.untried ? ` · còn ${nf(r.untried)} khách chưa thử — bấm lại để tiếp` : r.remaining ? ` · ${nf(r.remaining)} khách máy không tìm được — mở form, tìm địa chỉ hoặc chấm trên bản đồ` : ' · xong'}`)
    } catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không định vị được') }
  }

  const { data: whs } = useScopedWarehouses(true)
  const { data: channels } = useCustomerChannels()
  const { widths: colW, startResize, totalWidth } = useColumnResize('customers_col_widths', COLS.map(c => c.w))

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [allFiltered, setAllFiltered] = useState(false)   // "chọn cả N dòng theo bộ lọc"
  const [form, setForm] = useState<{ row: Customer | null } | null>(null)
  const [bulk, setBulk] = useState<'channel' | 'date_rule' | 'warehouse' | 'vehicles' | 'dispatch' | null>(null)
  const [seedOpen, setSeedOpen] = useState(false)
  const [chanEdit, setChanEdit] = useState<ChannelEdit | null>(null)
  const [chanNew, setChanNew] = useState(false)
  const [err, setErr] = useState('')

  const { data, isLoading } = useCustomers({
    search: f.search, channel: f.channel, hasChannel: f.hasChannel,
    warehouseId: f.warehouseId, active: f.active, hasRule: f.hasRule,
    page: f.page, pageSize: f.pageSize,
  })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const total = data?.total ?? 0
  const sum = data?.summary ?? { total: 0, no_channel: 0, with_warehouse: 0, auto_created: 0, inactive: 0, no_rule: 0 }
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize))

  const { data: cats } = useDateRuleCategories()
  const save = useSaveCustomer()
  const deact = useDeactivateCustomer()
  const bulkSave = useBulkUpdateCustomers()
  const bulkRule = useBulkSetDateRule()
  // danh mục dòng xe cho ô "Dòng xe được vào" (27/09) — route đọc mở cho quyền Khách hàng
  const { data: vmData } = useVehicleModels({ is_active: true })
  const models = useMemo(() => vmData?.items ?? [], [vmData])
  const chanVeh = useMemo(() => new Map((channels ?? []).map(c => [c.value, c.dispatch_vehicles ?? {}])), [channels])
  // 29/09 (user: "theo mức của kênh là bao nhiêu ghi rõ — khỏi phải quay sang bên kênh để xem"): mức + số khách của
  // từng kênh đưa vào form để ô "theo kênh" in GIÁ TRỊ đang hiệu lực, không chỉ chữ "theo kênh".
  const chanRules = useMemo(() => new Map((channels ?? []).map(c => [c.value, c.rules ?? []])), [channels])
  const chanMax = useMemo(() => new Map((channels ?? []).map(c => [c.value, c.max_customers_per_trip ?? null])), [channels])

  const whName = useMemo(() => new Map((whs ?? []).map(w => [(w as { id: string }).id, (w as { name?: string }).name ?? ''])), [whs])
  const chanLabel = useMemo(() => new Map((channels ?? []).map(c => [c.value, c.label])), [channels])

  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id))
  const toggleAll = () => {
    setAllFiltered(false)
    setPicked(s => {
      const n = new Set(s)
      if (allPicked) rows.forEach(r => n.delete(r.id)); else rows.forEach(r => n.add(r.id))
      return n
    })
  }
  const toggleOne = (id: string) => {
    setAllFiltered(false)
    setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const clearPick = () => { setPicked(new Set()); setAllFiltered(false) }
  // Phạm vi THẬT của thao tác hàng loạt — hiện nguyên văn trong hộp xác nhận, không áp mù.
  const pickCount = allFiltered ? total : picked.size
  const filterPayload = () => ({
    search: f.search || undefined,
    channel: f.channel.length ? f.channel.join(',') : undefined,
    has_channel: f.hasChannel || undefined,
    warehouse_id: f.warehouseId || undefined,
    active: f.active || undefined,
    has_rule: f.hasRule || undefined,
  })

  async function runBulk(patch: CustomerBulkPatch) {
    setErr('')
    try {
      await bulkSave.mutateAsync(allFiltered ? { filter: filterPayload(), patch } : { ids: [...picked], patch })
      setBulk(null); clearPick()
    } catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được') }
  }

  /** Đặt MỘT mức (một loại hàng) cho cả nhóm — đường khai chính cho lần đầu 100+ khách. */
  async function runBulkRule(p: { category: string | null; kind: string | null; value: string }) {
    setErr('')
    try {
      const body = {
        category: p.category,
        kind: p.kind || null,
        value: p.kind === 'FEFO' || !p.kind ? null : Number(p.value) || 0,
      }
      await bulkRule.mutateAsync(allFiltered ? { filter: filterPayload(), ...body } : { ids: [...picked], ...body })
      setBulk(null); clearPick()
    } catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được') }
  }

  const filterDefs: FilterDef[] = [
    { key: 'chan', label: 'Kênh', type: 'multi', pinned: true,
      options: [...(channels ?? []).map(c => ({ value: c.value, label: c.label }))],
      selected: f.channel, onChange: (v: string[]) => setF({ channel: v, page: 1 }) },
    { key: 'hasc', label: 'Phân kênh', type: 'single', pinned: true,
      options: [{ value: '0', label: 'Chưa phân kênh' }, { value: '1', label: 'Đã phân kênh' }],
      value: f.hasChannel, onChange: (v: string) => setF({ hasChannel: v as '' | '1' | '0', page: 1 }) },
    { key: 'wh', label: 'Kho nhận', type: 'single',
      options: (whs ?? []).map(w => ({ value: (w as { id: string }).id, label: (w as { name?: string }).name ?? '' })),
      value: f.warehouseId, onChange: (v: string) => setF({ warehouseId: v, page: 1 }) },
    { key: 'act', label: 'Trạng thái', type: 'single',
      options: [{ value: '1', label: 'Đang hoạt động' }, { value: '0', label: 'Đã ngừng' }],
      value: f.active, onChange: (v: string) => setF({ active: v as '' | '1' | '0', page: 1 }) },
    { key: 'hasr', label: 'Khai mức', type: 'single', pinned: true,
      options: [{ value: '0', label: 'Chưa khai mức' }, { value: '1', label: 'Đã khai mức' }],
      value: f.hasRule, onChange: (v: string) => setF({ hasRule: v as '' | '1' | '0', page: 1 }) },
  ]

  const toolbarItems: ActionItem[] = [
    ...(canEdit ? [{
      key: 'add', icon: Plus, label: 'Thêm', tip: 'Thêm khách hàng / nơi nhận mới', primary: true,
      onClick: () => setForm({ row: null }),
    } satisfies ActionItem] : []),
    // DANH MỤC RỖNG THÌ ĐÂY LÀ VIỆC DUY NHẤT PHẢI LÀM (user bắt 11/09: mở trang thấy trống trơn,
    // mà lối vào lại là một icon không nhãn trong cụm phụ, còn trên điện thoại thì ẩn hẳn = ngõ cụt).
    // Rỗng ⇒ nút CHÍNH, hiện cả trên điện thoại. Có dữ liệu rồi ⇒ lùi về nút phụ như cũ.
    ...(canImport ? [{
      key: 'seed', icon: DownloadCloud, label: 'Nạp từ SAP',
      primary: total === 0, mobileHidden: total > 0,
      tip: 'Nạp mã ship-to đã thấy trong VL06O / trên chuyến vào danh mục (khách mới chưa có mức nào)',
      onClick: () => setSeedOpen(true),
    } satisfies ActionItem] : []),
    // Máy định vị từ địa chỉ (01/10) — nói thẳng số còn trống + lý do chưa sẵn sàng (chưa có khoá / đang tắt) thay vì bấm rồi lỗi
    ...(canGeocode ? [{
      // đếm khách máy CHƯA THỬ — khách máy đã thử mà không ra thì bấm nữa cũng vậy, phải mở form tìm địa chỉ / chấm tay
      key: 'geocode', icon: MapPin, label: `Định vị tự động${geoStatus.data ? ` (${nf(geoStatus.data.untried)})` : ''}`,
      mobileHidden: true, busy: geocode.isPending,
      disabled: geocode.isPending || !geoStatus.data?.provider.ready || !geoStatus.data?.untried,
      tip: geoStatus.data?.provider.ready
        ? `Máy định vị các khách chưa thử từ địa chỉ SAP${geoStatus.data?.provider.provider === 'osm' ? ' — OpenStreetMap miễn phí, ghim đặt ở TÂM PHƯỜNG/XÃ; kéo ghim trong form khi cần chính xác hơn' : ''} — ${nf(geoStatus.data?.located ?? 0)}/${nf(geoStatus.data?.total_active ?? 0)} khách đã có ghim${geoStatus.data && geoStatus.data.remaining > geoStatus.data.untried ? ` · ${nf(geoStatus.data.remaining - geoStatus.data.untried)} khách máy không tìm được (chấm tay trong form)` : ''}`
        : (geoStatus.data?.provider.reason ?? 'Đang kiểm tra máy định vị…'),
      onClick: () => void runGeocode(),
    } satisfies ActionItem] : []),
  ]

  const bulkItems: ActionItem[] = canEdit && pickCount > 0 ? [
    { key: 'bchan', icon: Layers, label: `Phân kênh (${nf(pickCount)})`, primary: true,
      tip: 'Gán kênh cho các khách đang chọn — %Date mặc định của kênh áp cho đơn SINH SAU', onClick: () => setBulk('channel') },
    { key: 'brule', icon: CalendarClock, label: `%Date riêng (${nf(pickCount)})`,
      tip: 'Đặt %Date riêng, ghi đè mức của kênh', onClick: () => setBulk('date_rule') },
    { key: 'bwh', icon: WarehouseIcon, label: `Trỏ kho (${nf(pickCount)})`,
      tip: 'Khai "nơi nhận này là kho của mình" — kho nhận sẽ xác nhận hàng trong app khi chuyển kho', onClick: () => setBulk('warehouse') },
    { key: 'bveh', icon: Truck, label: `Dòng xe được vào (${nf(pickCount)})`,
      tip: 'Khai dòng xe các khách này được vào (theo Loại kho) — thay / thêm / bớt, hoặc về theo kênh', onClick: () => setBulk('vehicles') },
    { key: 'bdisp', icon: Truck, label: `Ghép xe (${nf(pickCount)})`,
      tip: 'Mảng Trung chuyển / Bán hàng · đi xe riêng bật/tắt · số khách tối đa cùng xe — áp cho lần lập kế hoạch điều vận sau', onClick: () => setBulk('dispatch') },
    { key: 'boff', icon: Power, label: `Ngừng (${nf(pickCount)})`, danger: true,
      tip: 'Ngừng các khách đang chọn (giữ lịch sử, không còn áp %Date)',
      onClick: () => runBulk({ is_active: false }) },
  ] : []

  const listTab = f.tab !== 'channels'
  // Lớp thứ hai sau quyền: superadmin ẩn tab khỏi điện thoại (cờ mobile_surface, 21/09)
  const pageTabs = useMobileTabs('/masterdata/customers', PAGE_TAB_DEFS, f.tab, k => setF({ tab: k }))

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap w-full min-w-0">
            <h1 className="hidden sm:flex text-sm font-semibold text-slate-800 items-center gap-1.5 shrink-0">
              <Store className="h-4 w-4 text-sky-600" /> Khách hàng
            </h1>
            {/* 2 tab: danh sách khách · danh mục kênh */}
            <div className="flex rounded-md border border-slate-200 p-0.5 shrink-0">
              {pageTabs.map(({ key: k, label: lb }) => (
                <button key={k} onClick={() => setF({ tab: k })}
                  className={`rounded px-2 py-1 text-xs transition-colors ${f.tab === k ? 'bg-sky-100 text-sky-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
                  {lb}
                </button>
              ))}
            </div>
            {listTab && (
              <>
                <SearchInput value={f.search} onChange={v => { setF({ search: v, page: 1 }); clearPick() }}
                  placeholder="Mã ship-to · tên khách hàng" className="flex-1 min-w-[140px]" />
                {/* Mobile: nút Lọc đi CÙNG HÀNG với cụm thao tác (2 tab đã ăn hết hàng trên) —
                    giữ toolbar ≤ 2 hàng để dòng dữ liệu đầu tiên không bị đẩy xuống quá sâu. */}
                <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
                  <FilterSheetButton defs={filterDefs} />
                  {/* 29/09 (user: "chọn multi hiện action lại không đồng bộ — phải như Tồn kho, action hiện ở giữa"): thao tác
                      hàng loạt KHÔNG còn nằm trên header, chúng ở trong pill nổi giữa đáy bên dưới */}
                  <ActionCluster items={toolbarItems} mobileInline />
                </div>
              </>
            )}
          </div>
          {listTab && <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>}
          {/* Chọn-tất-cả 2 mức: trang đang xem → cả bộ lọc. Mobile không có hàng tiêu đề nên ô
              chọn-tất-cả đứng ở đây (cùng luật trang Chốt %Date). */}
          {/* Pill NỔI thay hàng chèn vào toolbar — hàng chèn làm bảng co khi vừa tick (user 16/09). */}
          {listTab && (
            <FloatingActionBar count={allFiltered ? total : picked.size}
              unit={allFiltered ? 'khách theo bộ lọc hiện tại' : 'dòng trên trang'}>
              <ActionCluster className="w-auto shrink-0" items={bulkItems.map(i => ({ ...i, primary: false, className: i.danger ? FLOATING_BTN_DANGER : FLOATING_BTN }))} />
              <label className="flex items-center gap-1.5 sm:hidden text-[11px] text-slate-200">
                <input type="checkbox" checked={allPicked} onChange={toggleAll} className="h-4 w-4 accent-sky-400" />
                Chọn cả trang
              </label>
              {!allFiltered && total > rows.length && allPicked && (
                <button type="button" className="text-[11px] text-sky-300 underline" onClick={() => setAllFiltered(true)}>
                  Chọn cả {nf(total)} dòng theo bộ lọc
                </button>
              )}
              <button type="button" className="text-[11px] text-slate-300 hover:text-white underline" onClick={clearPick}>Bỏ chọn</button>
            </FloatingActionBar>
          )}
          {err && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {err}</p>}
          {geoMsg && <p className="text-[11px] text-slate-600 flex items-center gap-1"><MapPin className="h-3 w-3 text-sky-600" /> {geoMsg}</p>}
        </div>

        {listTab ? (
          <>
            <SummaryBand tiles={[
              { label: 'Khách hàng', value: nf(sum.total) },
              { label: 'Chưa khai mức', value: nf(sum.no_rule ?? 0), tip: 'Khách lẫn kênh đều chưa khai mức — dòng hàng của họ KHÔNG được cấp quy định date tự động' },
              { label: 'Chưa phân kênh', value: nf(sum.no_channel) },
              { label: 'Trỏ kho của mình', value: nf(sum.with_warehouse) },
              { label: 'Tự tạo từ đơn', value: nf(sum.auto_created) },
              { label: 'Đã ngừng', value: nf(sum.inactive) },
              ...(totalPages > 1 ? [{ label: 'Trang', value: `${f.page}/${totalPages}` }] : []),
            ]} />

            <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
              <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
                style={{ width: totalWidth, minWidth: '100%' }}>
                <colgroup>{COLS.map((c, i) => <col key={c.id} style={{ width: colW[i] }} />)}</colgroup>
                <TableHeader>
                  <TableRow>
                    {COLS.map((c, i) => (
                      <TableHead key={c.id} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">
                        {c.id === 'pick'
                          ? <input type="checkbox" checked={allPicked} onChange={toggleAll} className="h-4 w-4 accent-sky-600" />
                          : c.label}
                        <span onPointerDown={e => startResize(i, e)}
                          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
                  {!isLoading && !rows.length && (
                    <TableEmptyRow colSpan={COLS.length}>
                      Chưa có khách hàng nào khớp bộ lọc.
                      {canImport && <> Bấm <b>Nạp từ SAP</b> để đưa mã ship-to đã dùng thật vào danh mục.</>}
</TableEmptyRow>
                  )}
                  {rows.map(r => {
                    // Mức của CHÍNH khách; không có dòng nào thì hiện mức THỪA HƯỞNG từ kênh (mờ hơn)
                    const own = r.rules ?? []
                    const inherited = own.length ? [] : (r.channel_rules ?? [])
                    return (
                      <TableRow key={r.id}
                        className={`cursor-pointer ${picked.has(r.id) || allFiltered ? 'bg-sky-50' : ''} ${r.is_active ? '' : 'text-slate-400'}`}
                        onClick={() => canEdit && setForm({ row: r })}>
                        <TableCell className="px-2 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={picked.has(r.id) || allFiltered} onChange={() => toggleOne(r.id)} className="h-4 w-4 accent-sky-600" />
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{r.ship_to_code}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">{r.name}</TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {r.channel
                            ? <StatusBadge tone="purple">{chanLabel.get(r.channel) ?? r.channel}</StatusBadge>
                            : <StatusBadge tone="amber" title="Chưa phân kênh — dòng hàng của khách này KHÔNG được cấp %Date tự động">Chưa phân kênh</StatusBadge>}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <span className="flex flex-wrap items-center gap-1">
                          {/* 29/09: cột không còn Pallet / Xá — chỉ còn dòng xe được vào (khai riêng, hoặc mờ theo kênh) */}
                          {/* dòng xe được vào khai RIÊNG cho khách (27/09) — không khai thì in mờ danh sách THEO KÊNH đang hiệu lực (29/09) */}
                          {Object.entries(r.dispatch_vehicles ?? {}).sort(([a], [b]) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b))).map(([c, ids]) => (
                            <span key={c} className="text-[9px] font-semibold rounded px-1 py-0.5 bg-amber-50 text-amber-700"
                              title={`Dòng xe được vào${c === '*' ? '' : ` cho hàng ${c}`}: ${vehicleListText(ids, models) || '—'}`}>
                              Xe{c === '*' ? '' : ` ${c}`}: {splitVehicleIds(ids, models).live.length}
                            </span>
                          ))}
                          {!Object.keys(r.dispatch_vehicles ?? {}).length && r.channel && Object.entries(chanVeh.get(r.channel) ?? {}).sort(([a], [b]) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b))).map(([c, ids]) => (
                            <span key={`ch-${c}`} className="text-[9px] rounded px-1 py-0.5 bg-slate-50 text-slate-400"
                              title={`Theo kênh ${chanLabel.get(r.channel!) ?? r.channel}${c === '*' ? '' : ` cho hàng ${c}`}: ${vehicleListText(ids, models) || '—'}`}>
                              Xe{c === '*' ? '' : ` ${c}`} theo kênh: {splitVehicleIds(ids, models).live.length}
                            </span>
                          ))}
                          </span>
                        </TableCell>
                        {/* Mức theo LOẠI HÀNG — một khách có thể mang nhiều dòng (FG01 ≥ 70 %,
                            FG02 ≥ 35 ngày). Chưa khai dòng nào thì hiện mức thừa hưởng của kênh. */}
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {own.length > 0 ? (
                            <span className="flex flex-wrap gap-1">
                              {own.map(x => {
                                const b = masterRuleLabel(x.rule)
                                return b && (
                                  <span key={x.category ?? ''} className={`text-[9px] font-semibold rounded px-1 py-0.5 ${b.cls}`}>
                                    {x.category ? `${x.category}: ` : ''}{b.text}
                                  </span>
                                )
                              })}
                            </span>
                          ) : inherited.length > 0 ? (
                            <span className="text-[9px] text-slate-400">
                              theo kênh · {inherited.map(x => `${x.category ? `${x.category} ` : ''}${masterRuleLabel(x.rule)?.text ?? ''}`).join(' · ')}
                            </span>
                          ) : (
                            <span className="text-[9px] text-amber-600" title="Khách lẫn kênh đều chưa khai mức — dòng hàng của khách này KHÔNG được cấp tự động">
                              chưa khai mức
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">
                          {r.warehouse_id
                            ? (whName.get(r.warehouse_id) ?? r.warehouse_id)
                            : <span className="text-slate-400">Khách ngoài</span>}
                        </TableCell>
                        {/* Toạ độ điểm giao (01/10): nguồn người (GPS / chấm tay) đậm hơn máy; chưa có = vàng để đi định vị */}
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {r.geo_lat != null && r.geo_source
                            ? <StatusBadge tone={r.geo_source === 'GPS' ? 'green' : r.geo_source === 'MANUAL' ? 'sky' : 'slate'}
                                title={`${r.geo_lat}, ${r.geo_lng}${r.geo_accuracy_m != null ? ` ±${Math.round(r.geo_accuracy_m).toLocaleString('vi-VN')} m` : ''}${r.geo_source === 'OSM' ? ' · tâm phường/xã theo địa chỉ — kéo ghim trong form nếu cần chính xác hơn' : ''}${r.geo_by ? ` · ${r.geo_by}` : ''}`}>
                                {GEO_SOURCE_VI[r.geo_source]}
                              </StatusBadge>
                            : <StatusBadge tone="amber" title="Chưa có toạ độ — chấm trên bản đồ / GPS trong form, hoặc nút Định vị tự động">Chưa định vị</StatusBadge>}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {r.auto_created
                            ? <StatusBadge tone="slate" title="Sinh tự động khi upload kế hoạch gặp mã ship-to lạ">Tự tạo</StatusBadge>
                            : <span className="text-[9px] text-slate-400">Nhập tay</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <StatusBadge tone={r.is_active ? 'green' : 'slate'}>{r.is_active ? 'Hoạt động' : 'Đã ngừng'}</StatusBadge>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <div className="leading-tight">
                            <div className="text-[10px] text-slate-600 truncate">{r.updated_by ?? <span className="text-slate-300">—</span>}</div>
                            <div className="text-[9px] text-slate-400">{formatTimestampDate(r.updated_at, true)}</div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <PagerNav page={f.page} totalPages={totalPages} onPage={p => { setF({ page: p }); setAllFiltered(false) }} />
            </div>

            <ListFooter page={f.page} pageSize={f.pageSize} total={total} unit="khách hàng"
              onPageSize={n => setF({ pageSize: n, page: 1 })}
              right={pickCount > 0 ? `${nf(pickCount)} đang chọn` : undefined} />
          </>
        ) : (
          <ChannelsTab canEdit={canChannel} canCreate={canCreateChannel} onEdit={setChanEdit} onCreate={() => setChanNew(true)} models={models} />
        )}
      </div>

      {form && (
        <CustomerForm
          row={form.row ? (rows.find(r => r.id === form.row!.id) ?? form.row) : null}   // dòng SỐNG: lưu vị trí xong ghim trong form đổi theo
          channels={(channels ?? []).map(c => ({ value: c.value, label: c.label, dispatch_transfer: c.dispatch_transfer === true }))}
          warehouses={(whs ?? []) as { id: string; name: string; code?: string }[]}
          cats={cats}
          models={models}
          chanVeh={chanVeh}
          chanRules={chanRules}
          chanMax={chanMax}
          saving={save.isPending || deact.isPending}
          canLocate={canLocate}
          locSaving={setLoc.isPending}
          onSaveLocation={form.row ? (async p => {
            setErr('')
            try { await setLoc.mutateAsync(p ? { id: form.row!.id, ...p } : { id: form.row!.id, lat: null, lng: null }) }
            catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được vị trí'); throw e }
          }) : undefined}
          onClose={() => setForm(null)}
          onSave={async patch => {
            setErr('')
            try { return await save.mutateAsync({ id: form.row?.id, ...patch }) }
            catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được'); throw e }
          }}
        />
      )}

      {bulk && (
        <BulkDialog
          kind={bulk} count={pickCount} byFilter={allFiltered}
          channels={(channels ?? []).map(c => ({ value: c.value, label: c.label }))}
          warehouses={(whs ?? []) as { id: string; name: string; code?: string }[]}
          cats={cats}
          models={models}
          saving={bulkSave.isPending || bulkRule.isPending}
          onClose={() => setBulk(null)}
          onApply={runBulk}
          onApplyRule={runBulkRule}
        />
      )}

      {seedOpen && <SeedDialog onClose={() => setSeedOpen(false)} />}

      {chanNew && <ChannelCreateForm onClose={() => setChanNew(false)} />}
      {chanEdit && (
        <ChannelForm row={chanEdit} cats={cats} models={models} onClose={() => setChanEdit(null)} />
      )}
    </div>
  )
}

// ─── Form Thêm / Sửa khách hàng ────────────────────────────────────────────────────────────────
function CustomerForm({ row, channels, warehouses, cats, models, chanVeh, chanRules, chanMax, saving, canLocate, locSaving, onSaveLocation, onClose, onSave }: {
  row: Customer | null
  channels: { value: string; label: string; dispatch_transfer?: boolean }[]
  warehouses: { id: string; name: string; code?: string }[]
  cats: DateRuleCategory[] | undefined
  models: VehicleModel[]
  chanVeh: Map<string, Record<string, string[]>>
  chanRules: Map<string, MasterRuleRow[]>
  chanMax: Map<string, number | null>
  saving: boolean
  /** Toạ độ điểm giao (01/10) — cửa ghi RIÊNG (customers.locate), chỉ có khi sửa khách đã tồn tại */
  canLocate: boolean
  locSaving: boolean
  onSaveLocation?: (p: { lat: number; lng: number; source: 'MANUAL' | 'GPS'; accuracy_m: number | null } | null) => Promise<unknown>
  onClose: () => void
  onSave: (p: CustomerPatch) => Promise<Customer | undefined>
}) {
  const [code, setCode] = useState(row?.ship_to_code ?? '')
  const [name, setName] = useState(row?.name ?? '')
  const [channel, setChannel] = useState(row?.channel ?? '')
  const [drafts, setDrafts] = useState<RuleDraft[]>(draftsOf(row?.rules))
  const [whId, setWhId] = useState(row?.warehouse_id ?? '')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [vehicles, setVehicles] = useState<Record<string, string[]>>(row?.dispatch_vehicles ?? {})
  // 28/09 (user: "không tự ép gì cả, config hết"): đi xe riêng (mặc định tắt) · số khách tối đa cùng xe (trống = không giới hạn, theo kênh)
  const [sep, setSep] = useState(row?.dispatch_separate === true)
  const [transfer, setTransfer] = useState(row?.dispatch_transfer === true)   // 03/10 tối: mảng Trung chuyển trên bàn điều vận
  const [maxCust, setMaxCust] = useState(row?.max_customers_per_trip == null ? '' : String(row.max_customers_per_trip))
  const [note, setNote] = useState(row?.note ?? '')
  const saveRules = useSaveDateRules()
  const [err, setErr] = useState('')
  // Giá trị KÊNH ĐANG CHỌN trong form (không phải kênh đã lưu của dòng) — đổi kênh là câu "theo kênh" đổi theo.
  const chanName = channel ? (channels.find(c => c.value === channel)?.label ?? channel) : ''
  const chanRuleText = (chanRules.get(channel) ?? []).map(x => `${x.category ? `${x.category} ` : ''}${masterRuleLabel(x.rule)?.text ?? ''}`).join(' · ')
  const ruleInheritNote = !channel ? 'chưa phân kênh nên KHÔNG được cấp tự động'
    : chanRuleText ? `theo kênh ${chanName}: ${chanRuleText}` : `kênh ${chanName} cũng chưa khai mức ⇒ KHÔNG được cấp tự động`
  const chanMaxN = channel ? chanMax.get(channel) ?? null : null
  const maxCustPlaceholder = !channel ? 'Không giới hạn (chưa phân kênh)' : chanMaxN ? `Theo kênh ${chanName}: ${chanMaxN}` : `Theo kênh ${chanName}: không giới hạn`

  const submit = async () => {
    setErr('')
    try {
      // Mức nằm ở bảng RIÊNG nên phải ghi bằng lời gọi thứ hai. Ghi HỒ SƠ TRƯỚC: khách mới chưa có
      // id thì không có gì để gắn mức vào.
      const saved = await onSave({
        ...(row ? {} : { ship_to_code: code.toUpperCase().trim() }),
        name: name.trim(), channel: channel || null,
        warehouse_id: whId || null, is_active: active, note: note.trim() || null,
        dispatch_vehicles: vehicles,
        dispatch_separate: sep, max_customers_per_trip: maxCust.trim() === '' ? null : (Number(maxCust) || null),
        dispatch_transfer: transfer,
      })
      const id = row?.id ?? saved?.id
      if (id) await saveRules.mutateAsync({ scope: 'CUSTOMER', key: id, rules: toPayload(drafts) })
      onClose()
    } catch (e) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được')
    }
  }

  return (
    <FormSheet open onClose={onClose}
      title={row ? `Sửa khách hàng · ${row.ship_to_code}` : 'Thêm khách hàng / nơi nhận'}
      description="Mã ship-to của SAP là khoá — quy định date tự động và luật Chuyển kho đều tra theo mã này."
      footer={<>
        {err && <span className="text-[11px] text-red-600 flex-1 truncate">{err}</span>}
        <Button variant="outline" onClick={onClose} disabled={saving || saveRules.isPending}>Huỷ</Button>
        <Button onClick={submit} disabled={saving || saveRules.isPending || !name.trim() || (!row && !code.trim())}>
          {saving || saveRules.isPending ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </>}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Mã ship-to (SAP) *</label>
          <Input value={code} disabled={!!row} onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="30000344" className="h-9 font-mono" />
          {row && <p className="mt-1 text-[11px] text-slate-400">Mã là khoá của khách — không sửa được sau khi tạo.</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tên khách hàng *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="THU PHƯƠNG" className="h-9" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Kênh</label>
          <SingleSelect options={[{ value: '', label: '— Chưa phân kênh —' }, ...channels]}
            value={channel} onChange={setChannel} placeholder="Chọn kênh…" />
          <p className="mt-1 text-[11px] text-slate-400">
            Chưa phân kênh thì dòng hàng của khách này KHÔNG được cấp quy định date tự động — thủ kho vẫn phải khai tay.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Quy định date</label>
          <RuleTable drafts={drafts} onChange={setDrafts} cats={cats ?? []} inheritNote={ruleInheritNote} />
          {/* Đã khai riêng thì vẫn in mức kênh để biết mình đang đè cái gì */}
          {!!drafts.length && !!channel && (
            <p className="mt-1 text-[11px] text-slate-500">Mức của kênh {chanName}: {chanRuleText || 'chưa khai'} — khách khai riêng thì thắng.</p>
          )}
        </div>
        {/* ĐIỂM GIAO TRÊN BẢN ĐỒ (01/10): lưu bằng nút riêng trong ô (cửa customers.locate), không đi chung nút Lưu hồ sơ.
            Khách mới chưa có id ⇒ lưu hồ sơ trước rồi mở lại để chấm. */}
        {row && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Điểm giao trên bản đồ</label>
            <GeoPicker
              value={row.geo_lat != null && row.geo_lng != null ? { lat: Number(row.geo_lat), lng: Number(row.geo_lng) } : null}
              meta={{ source: row.geo_source ?? null, accuracy_m: row.geo_accuracy_m == null ? null : Number(row.geo_accuracy_m), at: row.geo_at ?? null, by: row.geo_by ?? null }}
              address={row.address}
              canEdit={canLocate && !!onSaveLocation}
              saving={locSaving}
              onSave={p => onSaveLocation ? onSaveLocation(p) : Promise.resolve()} />
            <p className="mt-1 text-[11px] text-slate-400">Toạ độ do người ghi (chấm tay, GPS) thắng máy định vị — máy chỉ điền ô còn trống. Điều vận dùng ghim này để vẽ bản đồ và (đợt 2) ghép tuyến theo đường đi.</p>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Kho nhận</label>
          <WarehouseSingleSelect warehouses={warehouses} value={whId} onChange={setWhId}
            allLabel="— Khách ngoài (không phải kho của mình) —" />
          <p className="mt-1 text-[11px] text-slate-400">
            Trỏ kho = kho nhận vào app xác nhận hàng khi chuyển kho. Khách ngoài = tài xế tự xác nhận.
          </p>
        </div>
        {/* 29/09 (user: "dòng xe là đơn vị thấp hơn của loại xe — bỏ loại xe, chọn dòng xe luôn"): ô "Đi hàng Pallet / Xá" và
            "Kiểu đi theo Loại kho" BỎ — dòng xe được vào (dưới) là nguồn duy nhất; xe pallet chỉ một khách = max_drops của dòng xe */}
        {/* GHÉP XE (28/09): trước đây máy TỰ tách khách trỏ kho đi xe riêng — nay là hai ô cấu hình, mặc định không ép gì */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Ghép xe (điều vận)</label>
          {/* 03/10 tối (user: "Bàu Bàng, Đà Nẵng, Ba Vì là trung chuyển, user tự setting trong khách hàng; STO của NPP đi chung NPP") */}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={transfer} onChange={e => setTransfer(e.target.checked)} className="h-4 w-4 accent-sky-600" />
            Trung chuyển — đơn của khách này vào mảng <b>Trung chuyển</b> trên bàn điều vận
            {/* luật C47: ô "theo cha" in giá trị đang hiệu lực của kênh ĐANG CHỌN */}
            {!transfer && <span className="text-[11px] text-slate-400">{channel && channels.find(c => c.value === channel)?.dispatch_transfer ? `(không tick vẫn là Trung chuyển — theo kênh ${chanName})` : `(không tick = Bán hàng${channel ? ` — kênh ${chanName} không phải kênh Trung chuyển` : ''})`}</span>}
          </label>
          <label className="mt-1.5 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={sep} onChange={e => setSep(e.target.checked)} className="h-4 w-4 accent-sky-600" />
            Đi xe riêng — không ghép khách khác lên cùng xe
          </label>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-600">Số khách tối đa cùng xe</span>
            <Input value={maxCust} inputMode="numeric" onChange={e => setMaxCust(e.target.value)} placeholder={maxCustPlaceholder} className="h-8 w-56 text-sm text-right" />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Trống = theo kênh (giá trị đang hiệu lực in mờ trong ô); kênh cũng trống = không giới hạn. Xe chở nhiều khách lấy số nhỏ nhất trong các khách trên xe. Trỏ kho nhận KHÔNG còn tự ép xe riêng.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Dòng xe được vào (điều vận)</label>
          <DispatchVehiclesEditor value={vehicles} onChange={setVehicles} cats={(cats ?? []).map(c => ({ value: c.value, label: c.label }))} models={models}
            inherit={{ label: channel ? (channels.find(c => c.value === channel)?.label ?? channel) : '', map: channel ? (chanVeh.get(channel) ?? {}) : {} }} />
          <p className="mt-1 text-[11px] text-slate-400">Khách đặc biệt (đường nhỏ, cấm tải, xuất khẩu đi container…) khai riêng ở đây; còn lại theo kênh. Máy chỉ xếp khách lên dòng xe được tick — ghép với khách khác thì chỉ dòng xe CẢ HAI được vào. Khách và kênh đều chưa khai ⇒ máy KHÔNG chọn xe cho khách này.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-4 w-4 accent-sky-600" />
          Đang hoạt động
        </label>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Ghi chú</label>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-9" />
        </div>
      </div>
    </FormSheet>
  )
}

// ─── Hộp xác nhận thao tác hàng loạt ───────────────────────────────────────────────────────────
// Dialog GIỮA màn chỉ để XÁC NHẬN (chuẩn: form thêm/sửa mới dùng FormSheet). Câu đầu tiên phải
// nói rõ PHẠM VI — "áp cho 312 khách theo bộ lọc hiện tại" — chứ không phải áp mù cả bảng.
function BulkDialog({ kind, count, byFilter, channels, warehouses, cats, models, saving, onClose, onApply, onApplyRule }: {
  kind: 'channel' | 'date_rule' | 'warehouse' | 'vehicles' | 'dispatch'
  count: number
  byFilter: boolean
  channels: { value: string; label: string }[]
  warehouses: { id: string; name: string; code?: string }[]
  cats: DateRuleCategory[] | undefined
  models: VehicleModel[]
  saving: boolean
  onClose: () => void
  onApply: (p: CustomerBulkPatch) => void
  onApplyRule: (p: { category: string | null; kind: string | null; value: string }) => void
}) {
  const [channel, setChannel] = useState('')
  const [whId, setWhId] = useState('')
  // Mỗi lượt áp ĐÚNG MỘT loại hàng: trộn nhiều loại thì hộp xác nhận không nói nổi "bạn sắp đổi
  // cái gì của bao nhiêu khách".
  const [rCat, setRCat] = useState('')
  const [rKind, setRKind] = useState<'MIN_PCT' | 'MIN_DAYS' | 'FEFO' | ''>('MIN_PCT')
  const [rVal, setRVal] = useState('60')
  const measurable = (cats ?? []).filter(c => c.measurable)
  // Dòng xe được vào cho MỘT khoá Loại kho (27/09) — Thay / Thêm / Bớt / Về theo kênh
  const [vCat, setVCat] = useState('')
  const [vMode, setVMode] = useState<'SET' | 'ADD' | 'REMOVE' | 'CLEAR'>('SET')
  const [vIds, setVIds] = useState<string[]>([])
  const vBad = (vMode === 'ADD' || vMode === 'REMOVE') && !vIds.length
  // Ghép xe (28/09): mỗi ô "không đổi" là bỏ qua ô đó — chỉ ghi trường người thật sự chọn
  const [dSep, setDSep] = useState<'' | 'ON' | 'OFF'>('')
  const [dTransfer, setDTransfer] = useState<'' | 'ON' | 'OFF'>('')   // 03/10 tối: mảng Trung chuyển
  const [dMax, setDMax] = useState<'' | 'UNLIMITED' | 'N'>('')
  const [dMaxN, setDMaxN] = useState('2')
  const dPatch: CustomerBulkPatch = {
    ...(dTransfer ? { dispatch_transfer: dTransfer === 'ON' } : {}),
    ...(dSep ? { dispatch_separate: dSep === 'ON' } : {}),
    ...(dMax === 'UNLIMITED' ? { max_customers_per_trip: null } : dMax === 'N' ? { max_customers_per_trip: Number(dMaxN) || 1 } : {}),
  }
  const dBad = !Object.keys(dPatch).length
  const title = kind === 'channel' ? 'Phân kênh hàng loạt' : kind === 'date_rule' ? 'Đặt quy định date hàng loạt'
    : kind === 'vehicles' ? 'Dòng xe được vào — hàng loạt'
    : kind === 'dispatch' ? 'Ghép xe — hàng loạt' : 'Trỏ kho nhận hàng loạt'

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Áp cho <b>{nf(count)} khách hàng</b> {byFilter ? 'theo bộ lọc hiện tại' : 'đang chọn'}.
          </p>
          {kind === 'channel' && (
            <SingleSelect options={[{ value: '', label: '— Bỏ phân kênh —' }, ...channels]}
              value={channel} onChange={setChannel} placeholder="Chọn kênh…" searchable={false} />
          )}
          {kind === 'date_rule' && (
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Loại hàng</label>
                <select value={rCat} onChange={e => setRCat(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                  <option value="">Mọi loại hàng (dòng chung)</option>
                  {measurable.map(c => <option key={c.value} value={c.value}>{c.value} — {c.label}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Kiểu</label>
                  <select value={rKind}
                    onChange={e => {
                      const k = e.target.value as typeof rKind
                      setRKind(k); setRVal(k === 'MIN_PCT' ? '60' : k === 'MIN_DAYS' ? '35' : '')
                    }}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                    <option value="MIN_PCT">≥ % hạn dùng</option>
                    <option value="MIN_DAYS">≥ số ngày còn lại</option>
                    <option value="FEFO">Theo quy định date của kho</option>
                    <option value="">— Xoá mức của loại này —</option>
                  </select>
                </div>
                {(rKind === 'MIN_PCT' || rKind === 'MIN_DAYS') && (
                  <div className="relative w-28">
                    <Input value={rVal} inputMode="numeric" onChange={e => setRVal(e.target.value)}
                      className="h-9 pr-10 text-right text-sm" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">
                      {rKind === 'MIN_PCT' ? '%' : 'ngày'}
                    </span>
                  </div>
                )}
              </div>
              {/* Quy đổi sống — chính chỗ mức chung 60 % nuốt mất yêu cầu 35 ngày của FG02 */}
              {(() => {
                const c = rCat ? measurable.find(x => x.value === rCat) : null
                const n = Number(rVal)
                if (!c || c.min_shelf_life == null || c.max_shelf_life == null || !Number.isFinite(n) || n <= 0) return null
                return (
                  <p className="text-[11px] text-slate-500">
                    {rKind === 'MIN_PCT'
                      ? `≈ còn ${Math.round(c.min_shelf_life * n / 100)}–${Math.round(c.max_shelf_life * n / 100)} ngày (mã ${c.value} hạn ${c.min_shelf_life}–${c.max_shelf_life} ngày)`
                      : rKind === 'MIN_DAYS'
                        ? `≈ ${Math.round(n / c.max_shelf_life * 100)}–${Math.round(n / c.min_shelf_life * 100)} % tuỳ mã (${c.value} hạn ${c.min_shelf_life}–${c.max_shelf_life} ngày)`
                        : null}
                  </p>
                )
              })()}
            </div>
          )}
          {kind === 'warehouse' && (
            <WarehouseSingleSelect warehouses={warehouses} value={whId} onChange={setWhId}
              allLabel="— Khách ngoài (bỏ trỏ kho) —" />
          )}
          {kind === 'vehicles' && (
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Loại kho</label>
                <SingleSelect options={[{ value: '', label: 'Mọi Loại kho' }, ...(cats ?? []).map(c => ({ value: c.value, label: `${c.value} — ${c.label}` }))]}
                  value={vCat} onChange={setVCat} placeholder="Mọi Loại kho" searchable={false} />
              </div>
              <div className="grid grid-cols-4 gap-1 rounded-md border border-slate-200 p-0.5">
                {([['SET', 'Thay bằng'], ['ADD', 'Thêm'], ['REMOVE', 'Bớt'], ['CLEAR', 'Về theo kênh']] as const).map(([v, lb]) => (
                  <button key={v} type="button" onClick={() => setVMode(v)}
                    className={`rounded px-1 py-1.5 text-xs ${vMode === v ? 'bg-sky-100 text-sky-800 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>{lb}</button>
                ))}
              </div>
              {vMode !== 'CLEAR' && <VehicleModelChecklist models={models} value={vIds} onChange={setVIds} />}
              <p className="text-[11px] text-slate-500">
                {vMode === 'SET' ? 'Danh sách của Loại kho đã chọn trên từng khách được THAY bằng các dòng xe đang tick (tick 0 dòng = cố ý không xe nào).'
                  : vMode === 'ADD' ? 'Thêm các dòng xe đang tick vào danh sách sẵn có của từng khách.'
                  : vMode === 'REMOVE' ? 'Bỏ các dòng xe đang tick khỏi danh sách của từng khách.'
                  : 'Gỡ khai riêng của Loại kho đã chọn — các khách quay về theo kênh.'} Loại kho khác của từng khách giữ nguyên. Áp cho lần lập kế hoạch điều vận sau.
              </p>
            </div>
          )}
          {kind === 'dispatch' && (
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Trung chuyển (mảng trên bàn điều vận)</label>
                <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 p-0.5">
                  {([['', 'Không đổi'], ['ON', 'Trung chuyển'], ['OFF', 'Bán hàng']] as const).map(([v, lb]) => (
                    <button key={v} type="button" onClick={() => setDTransfer(v)}
                      className={`rounded px-2 py-1.5 text-xs ${dTransfer === v ? 'bg-sky-100 text-sky-800 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>{lb}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Đi xe riêng</label>
                <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 p-0.5">
                  {([['', 'Không đổi'], ['ON', 'Bật'], ['OFF', 'Tắt']] as const).map(([v, lb]) => (
                    <button key={v} type="button" onClick={() => setDSep(v)}
                      className={`rounded px-2 py-1.5 text-xs ${dSep === v ? 'bg-sky-100 text-sky-800 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>{lb}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Số khách tối đa cùng xe</label>
                <div className="flex items-center gap-1">
                  <div className="grid flex-1 grid-cols-3 gap-1 rounded-md border border-slate-200 p-0.5">
                    {([['', 'Không đổi'], ['UNLIMITED', 'Không giới hạn'], ['N', 'Số']] as const).map(([v, lb]) => (
                      <button key={v} type="button" onClick={() => setDMax(v)}
                        className={`rounded px-1 py-1.5 text-xs ${dMax === v ? 'bg-sky-100 text-sky-800 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>{lb}</button>
                    ))}
                  </div>
                  {dMax === 'N' && <Input value={dMaxN} inputMode="numeric" onChange={e => setDMaxN(e.target.value)} className="h-9 w-16 text-right text-sm" />}
                </div>
              </div>
              <p className="text-[11px] text-slate-500">Trỏ kho nhận không còn tự ép xe riêng — muốn khách nào đi riêng thì bật ở đây. Áp cho lần lập kế hoạch điều vận sau.</p>
            </div>
          )}
          {(kind === 'channel' || kind === 'date_rule') && (
            <p className="text-[11px] text-amber-700">
              Lưu xong áp NGAY cho cả đơn đang mở của kho đã bật "Áp %Date tự động" — dòng đã chốt tay giữ nguyên.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Huỷ</Button>
          <Button disabled={saving || (kind === 'vehicles' && vBad) || (kind === 'dispatch' && dBad)} onClick={() => {
            if (kind === 'dispatch') return onApply(dPatch)
            if (kind === 'vehicles') return onApply({ dispatch_vehicles: { category: vCat || null, mode: vMode, vehicle_model_ids: vMode === 'CLEAR' ? [] : vIds } })
            if (kind === 'date_rule') return onApplyRule({ category: rCat || null, kind: rKind || null, value: rVal })
            onApply(kind === 'channel' ? { channel: channel || null } : { warehouse_id: whId || null })
          }}>
            {saving ? 'Đang áp…' : `Áp cho ${nf(count)} khách`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Nạp danh mục từ dữ liệu SAP (2 pha) ───────────────────────────────────────────────────────
function SeedDialog({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useCustomerSeedCandidates(true)
  const seed = useSeedCustomers()
  const [picked, setPicked] = useState<Set<string> | null>(null)   // null = chưa đụng → mặc định chọn hết dòng MỚI
  // TRỎ KHO: mã nào được nối về kho trong danh mục Kho. Mặc định nhận HẾT gợi ý — vì đó đúng là
  // hiện trạng (44/102 mã ship-to chính là kho nhà), còn dòng nào sai thì bỏ tick ngay tại đây.
  const [linked, setLinked] = useState<Set<string> | null>(null)
  const [pre, setPre] = useState<UploadPreflight | null>(null)
  const [done, setDone] = useState<{ created: number; skipped: number; linked: number } | null>(null)
  const [err, setErr] = useState('')

  const rows = data?.rows ?? []
  const newRows = useMemo(() => rows.filter(r => !r.exists_already), [rows])
  const sel = picked ?? new Set(newRows.map(r => r.ship_to_code))
  const chosen = useMemo(() => rows.filter(r => sel.has(r.ship_to_code)), [rows, sel])
  const toggle = (code: string) => setPicked(() => {
    const n = new Set(sel); n.has(code) ? n.delete(code) : n.add(code); return n
  })

  const suggested = useMemo(() => newRows.filter(r => r.wh_id), [newRows])
  const link = linked ?? new Set(suggested.map(r => r.ship_to_code))
  const toggleLink = (code: string) => setLinked(() => {
    const n = new Set(link); n.has(code) ? n.delete(code) : n.add(code); return n
  })
  const allLinked = suggested.length > 0 && suggested.every(r => link.has(r.ship_to_code))
  const toggleAllLinks = () => setLinked(allLinked ? new Set() : new Set(suggested.map(r => r.ship_to_code)))
  const nByName = useMemo(() => suggested.filter(r => r.match_by === 'NAME').length, [suggested])

  const run = async (preflight: boolean) => {
    setErr('')
    try {
      const res = await seed.mutateAsync({
        rows: chosen.map(r => ({
          ship_to_code: r.ship_to_code, name: r.name,
          warehouse_id: link.has(r.ship_to_code) ? r.wh_id : null,
        })),
        preflight,
      })
      if (preflight) setPre(res as UploadPreflight)
      else { setDone({ created: res.created ?? 0, skipped: res.skipped ?? 0, linked: res.linked ?? 0 }); setPre(null) }
    } catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không nạp được') }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      {/* Rộng hơn bản trước: thêm cột "Trỏ về kho" (tên kho + nhãn khớp bằng gì) vào bảng 7 cột cũ */}
      <DialogContent className="w-[95vw] max-w-5xl h-[90dvh] sm:h-[80vh] flex flex-col">
        <DialogHeader><DialogTitle className="text-base">Nạp khách hàng từ dữ liệu SAP</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500">
          Mã ship-to đã thấy trong VL06O hoặc trên chuyến. Khách nạp vào để TRỐNG kênh — phải phân kênh
          thì %Date mới được cấp tự động.
        </p>
        {/* Gợi ý trỏ kho — nói rõ có bao nhiêu mã khớp và khớp bằng gì, để người nạp biết chỗ nào
            đáng liếc lại. Khớp TÊN là suy đoán yếu hơn khớp mã nên tách số ra, không gộp làm một. */}
        {suggested.length > 0 && (
          <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-md px-2 py-1.5">
            <b>{nf(suggested.length)}</b> mã ship-to khớp kho đã có trong danh mục Kho
            {nByName > 0 && <> (trong đó <b>{nf(nByName)}</b> khớp theo TÊN — nên liếc lại)</>} — đã tick sẵn
            ở cột “Trỏ về kho”. Khách trỏ kho là <b>nơi nhận nội bộ</b>: chuyến tới đó thành chuyển kho,
            và nếu kho đó có quản tồn thì kho nhận phải xác nhận trong app.
          </p>
        )}
        {err && <p className="text-[11px] text-red-600">{err}</p>}
        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm">
            <p className="font-medium text-green-700">Đã nạp {nf(done.created)} khách hàng mới.</p>
            {done.linked > 0 && <p className="text-slate-600">{nf(done.linked)} khách được trỏ về kho trong danh mục.</p>}
            <p className="text-slate-500">{nf(done.skipped)} khách đã có trong danh mục — giữ nguyên.</p>
          </div>
        ) : pre ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <UploadPreflightPanel report={pre} busy={seed.isPending}
              onCancel={() => setPre(null)} onConfirm={() => run(false)} />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto border rounded-lg">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  {['', 'Mã ship-to', 'Tên', 'Dòng VL06O', 'Chuyến', 'Gần nhất', 'Trạng thái'].map((h, i) => (
                    <TableHead key={i} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{h}</TableHead>
                  ))}
                  <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      {suggested.length > 0 && (
                        <input type="checkbox" checked={allLinked} onChange={toggleAllLinks}
                          className="h-3.5 w-3.5 accent-sky-600" title="Tick/bỏ tick mọi gợi ý trỏ kho" />
                      )}
                      Trỏ về kho
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableEmptyRow colSpan={8}>Đang tải…</TableEmptyRow>}
                {rows.map((r: CustomerCandidate) => (
                  <TableRow key={r.ship_to_code} className={r.exists_already ? 'text-slate-400' : ''}>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <input type="checkbox" disabled={r.exists_already} checked={sel.has(r.ship_to_code)}
                        onChange={() => toggle(r.ship_to_code)} className="h-4 w-4 accent-sky-600" />
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{r.ship_to_code}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate max-w-[240px]">{r.name}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums whitespace-nowrap">{nf(r.erp_lines)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums whitespace-nowrap">{nf(r.trips)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.last_date ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {r.exists_already
                        ? <StatusBadge tone="slate">Đã có</StatusBadge>
                        : <StatusBadge tone="green">Mới</StatusBadge>}
                    </TableCell>
                    {/* TRỎ VỀ KHO — gợi ý của máy, người tick mới ghi. Dòng "Đã có" không đụng tới
                        (tên/kênh/kho của người khai luôn thắng dữ liệu nạp) nên chỉ hiện kho đang
                        trỏ, muốn đổi thì dùng thao tác hàng loạt "Trỏ kho" ngoài danh mục. */}
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {r.exists_already ? (
                        <span className="text-[10px] text-slate-400">
                          {r.current_warehouse_id ? 'đã trỏ kho' : '—'}
                        </span>
                      ) : r.wh_id ? (
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={link.has(r.ship_to_code)} disabled={!sel.has(r.ship_to_code)}
                            onChange={() => toggleLink(r.ship_to_code)} className="h-4 w-4 accent-sky-600" />
                          <span className="text-[10px] max-w-[150px] truncate">{r.wh_name}</span>
                          <StatusBadge tone={r.match_by === 'NAME' ? 'amber' : 'blue'}>
                            {r.match_by === 'CODE' ? 'trùng mã' : r.match_by === 'SHIPTO' ? 'ship-to phụ' : 'trùng tên'}
                          </StatusBadge>
                        </label>
                      ) : <span className="text-slate-300 text-[10px]">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {/* Bảng kiểm-trước tự mang nút Huỷ / Xác nhận của nó (chuẩn upload 2 pha) */}
        {!pre && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>{done ? 'Đóng' : 'Huỷ'}</Button>
            {!done && (
              <Button disabled={seed.isPending || !chosen.length} onClick={() => run(true)}>
                {seed.isPending ? 'Đang kiểm…' : `Kiểm trước (${nf(chosen.length)})`}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Tab KÊNH ──────────────────────────────────────────────────────────────────────────────────
type ChannelEdit = { id: string; value: string; label: string; rules: MasterRuleRow[]; dispatch_vehicles?: Record<string, string[]>; sap_dist_channel?: string | null; max_customers_per_trip?: number | null; dispatch_transfer?: boolean }

function ChannelsTab({ canEdit, canCreate, onEdit, onCreate, models }: {
  canEdit: boolean
  canCreate: boolean
  onEdit: (r: ChannelEdit) => void
  onCreate: () => void
  models: VehicleModel[]
}) {
  const { data, isLoading } = useCustomerChannels()
  const rows = data ?? []
  return (
    <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
      <div className="flex flex-wrap items-start gap-2 px-3 py-2">
        <p className="flex-1 min-w-[200px] text-[11px] text-slate-500">
          Mức mặc định của kênh. Lưu xong áp NGAY cho đơn đang mở của mọi kho đã bật "Áp %Date tự động";
          dòng đã chốt tay không bao giờ bị đè, và mỗi dòng đổi đều có vết trong sổ chuyến.
          Kênh có <b>mã SAP</b> được tự điền cho khách chưa có kênh lúc nạp ZSD02; kênh không có mã (vd Bách hoá xanh) thì gán tay.
        </p>
        {canCreate && <Button size="sm" className="h-9 sm:h-7 text-xs shrink-0" onClick={onCreate}><Plus className="h-3.5 w-3.5 mr-1" />Thêm kênh</Button>}
      </div>
      <Table className="min-w-full">
        <TableHeader>
          <TableRow>
            {['Mã kênh', 'Mã SAP', 'Tên kênh', 'Quy định date mặc định', 'Dòng xe mặc định', 'Số khách', ''].map((h, i) => (
              <TableHead key={i} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableEmptyRow colSpan={7}>Đang tải…</TableEmptyRow>}
          {rows.map(c => (
            <TableRow key={c.id}>
              <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{c.value}</TableCell>
              <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap" title={c.sap_dist_channel ? 'Khách chưa có kênh mà ZSD02 ghi kênh SAP này ⇒ tự điền kênh này' : 'Không có mã SAP — gán tay ở tab Khách hàng'}>
                {c.sap_dist_channel ?? <span className="text-slate-300">gán tay</span>}
              </TableCell>
              <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{c.label}</TableCell>
              <TableCell className="px-2 py-1">
                {(c.rules ?? []).length ? (
                  <span className="flex flex-wrap gap-1">
                    {c.rules.map(x => {
                      const b = masterRuleLabel(x.rule)
                      return b && (
                        <span key={x.category ?? ''} className={`text-[9px] font-semibold rounded px-1 py-0.5 ${b.cls}`}>
                          {x.category ? `${x.category}: ` : ''}{b.text}
                        </span>
                      )
                    })}
                  </span>
                ) : <span className="text-[9px] text-slate-400">Chưa khai — không áp gì</span>}
              </TableCell>
              <TableCell className="px-2 py-1">
                {Object.keys(c.dispatch_vehicles ?? {}).length ? (
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(c.dispatch_vehicles ?? {}).sort(([a], [b]) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b))).map(([k, ids]) => (
                      <span key={k} className="text-[9px] font-semibold rounded px-1 py-0.5 bg-amber-50 text-amber-700" title={vehicleListText(ids, models)}>
                        {k === '*' ? 'Mọi loại' : k}: {splitVehicleIds(ids, models).live.length} dòng xe
                      </span>
                    ))}
                  </span>
                ) : <span className="text-[9px] text-amber-700">Chưa khai — không chọn xe</span>}
              </TableCell>
              <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums whitespace-nowrap">{nf(c.customers)}</TableCell>
              <TableCell className="px-2 py-1 whitespace-nowrap">
                {canEdit && (
                  <button onClick={() => onEdit({ id: c.id, value: c.value, label: c.label, rules: c.rules ?? [], dispatch_vehicles: c.dispatch_vehicles ?? {}, sap_dist_channel: c.sap_dist_channel ?? null, max_customers_per_trip: c.max_customers_per_trip ?? null, dispatch_transfer: c.dispatch_transfer === true })}
                    className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700" title="Sửa kênh">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Ô "Mã kênh SAP" dùng chung form thêm + sửa kênh. */
function SapChannelField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">Mã kênh SAP (tuỳ chọn)</label>
      <Input value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="vd 10" className="h-9 font-mono" />
      <p className="mt-1 text-[11px] text-slate-400">Mã đầu cột Distribution Channel của SAP: 10 General Trade · 20 Modern Trade · 30 Key Account · 40 Export · 80 Internal · 99 Others. Khách CHƯA có kênh mà ZSD02 ghi kênh SAP này ⇒ tự điền kênh này lúc nạp. Để trống = kênh gán tay (khách đã có kênh không bao giờ bị đè).</p>
    </div>
  )
}

/** Thêm kênh (28/09) — mã + tên + mã SAP; %Date và dòng xe mặc định khai sau ở form sửa kênh. */
function ChannelCreateForm({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [sap, setSap] = useState('')
  const [err, setErr] = useState('')
  const create = useCreateCustomerChannel()
  const okCode = /^[A-Z0-9_]{2,20}$/.test(value)
  return (
    <FormSheet open onClose={onClose} title="Thêm kênh" description="Kênh là nơi khai mức %Date + dòng xe mặc định cho nhóm khách — có thể là kênh SAP hoặc kênh riêng (vd Bách hoá xanh)."
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={create.isPending}>Huỷ</Button>
        <Button disabled={create.isPending || !okCode || !label.trim()} onClick={async () => {
          setErr('')
          try { await create.mutateAsync({ value, label: label.trim(), sap_dist_channel: sap.trim() || null }); onClose() }
          catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không thêm được') }
        }}>{create.isPending ? 'Đang lưu…' : 'Thêm kênh'}</Button>
      </>}>
      <div className="space-y-4">
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Mã kênh *</label>
          <Input value={value} onChange={e => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20))} placeholder="vd BHX" className="h-9 font-mono" />
          <p className="mt-1 text-[11px] text-slate-400">2–20 ký tự: chữ HOA, số, gạch dưới. Không đổi được sau khi tạo.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tên kênh *</label>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="vd Bách hoá xanh" className="h-9" />
        </div>
        <SapChannelField value={sap} onChange={setSap} />
      </div>
    </FormSheet>
  )
}

function ChannelForm({ row, cats, models, onClose }: {
  row: ChannelEdit
  cats: DateRuleCategory[] | undefined
  models: VehicleModel[]
  onClose: () => void
}) {
  const [label, setLabel] = useState(row.label)
  const [sap, setSap] = useState(row.sap_dist_channel ?? '')
  const [vehicles, setVehicles] = useState<Record<string, string[]>>(row.dispatch_vehicles ?? {})
  const [maxCust, setMaxCust] = useState(row.max_customers_per_trip == null ? '' : String(row.max_customers_per_trip))   // 28/09: trống = không giới hạn
  const [transfer, setTransfer] = useState(row.dispatch_transfer === true)   // 04/10: kênh Trung chuyển (mảng điều vận)
  const [drafts, setDrafts] = useState<RuleDraft[]>(draftsOf(row.rules))
  const [err, setErr] = useState('')
  const save = useUpdateCustomerChannel()
  const saveRules = useSaveDateRules()
  const busy = save.isPending || saveRules.isPending
  return (
    <FormSheet open onClose={onClose} title={`Kênh · ${row.label}`}
      description="Mức mặc định của kênh — khách chưa khai mức riêng thì dùng mức này."
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={busy}>Huỷ</Button>
        <Button disabled={busy || !label.trim()} onClick={async () => {
          setErr('')
          try {
            await save.mutateAsync({ id: row.id, label: label.trim(), dispatch_vehicles: vehicles, sap_dist_channel: sap.trim() || null,
              max_customers_per_trip: maxCust.trim() === '' ? null : (Number(maxCust) || null), dispatch_transfer: transfer })
            // Mức đi bằng khoá NGHIỆP VỤ của kênh (`value`), không phải id dòng LookupValue
            await saveRules.mutateAsync({ scope: 'CHANNEL', key: row.value, rules: toPayload(drafts) })
            onClose()
          } catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được') }
        }}>{busy ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-4">
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tên kênh *</label>
          <Input value={label} onChange={e => setLabel(e.target.value)} className="h-9" />
        </div>
        <SapChannelField value={sap} onChange={setSap} />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Quy định date mặc định</label>
          <RuleTable drafts={drafts} onChange={setDrafts} cats={cats ?? []} inheritNote="kênh này không áp gì" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Dòng xe mặc định (điều vận)</label>
          <DispatchVehiclesEditor value={vehicles} onChange={setVehicles} cats={(cats ?? []).map(c => ({ value: c.value, label: c.label }))} models={models} />
          <p className="mt-1 text-[11px] text-slate-400">Khách thuộc kênh này mà không khai riêng thì máy chỉ xếp lên các dòng xe tick ở đây (vd NPP không đi container, BHX chỉ xe nhỏ). Để "Chưa khai" ⇒ máy KHÔNG chọn xe cho khách của kênh (trừ khách khai riêng) — muốn mọi xe thì "Chọn dòng xe" → "Chọn tất cả".</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Mảng điều vận</label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={transfer} onChange={e => setTransfer(e.target.checked)} className="h-4 w-4 accent-sky-600" />
            Kênh Trung chuyển — đơn của mọi khách trong kênh vào mảng <b>Trung chuyển</b> trên bàn điều vận
          </label>
          <p className="mt-1 text-[11px] text-slate-400">Không tick = Bán hàng. Khách lẻ vẫn tick "Trung chuyển" riêng ở hồ sơ khách; người điều vận lấy từng đơn sang mảng kia được trên bàn.</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Số khách tối đa cùng xe (điều vận)</label>
          <Input value={maxCust} inputMode="numeric" onChange={e => setMaxCust(e.target.value)} placeholder="Không giới hạn" className="h-9 w-40 text-right" />
          <p className="mt-1 text-[11px] text-slate-400">Mặc định cho khách của kênh (khách khai riêng thì thắng). Trống = không giới hạn. Xe chở nhiều khách lấy số nhỏ nhất trong các khách trên xe; trần của kho ở Cài đặt WMS → Kho vẫn áp ngoài.</p>
        </div>
      </div>
    </FormSheet>
  )
}
