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
  Power, Pencil, AlertTriangle,
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
import { StatusBadge } from '@/components/shared/StatusBadge'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { UploadPreflightPanel } from '@/components/shared/UploadPreflightPanel'
import { masterRuleLabel } from '@/components/wms/SetDateRuleSheet'
import {
  useCustomers, useCustomerChannels, useCustomerSeedCandidates, useSaveCustomer,
  useDeactivateCustomer, useBulkUpdateCustomers, useSeedCustomers, useUpdateCustomerChannel,
  useSaveDateRules, useBulkSetDateRule, useDateRuleCategories,
  type Customer, type CustomerCandidate, type CustomerPatch, type UploadPreflight,
  type MasterRuleRow, type DateRuleCategory,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate } from '@/utils/formatters'
import type { DateRule } from '@/types'

const nf = (n: number) => n.toLocaleString('vi-VN')

const COLS = [
  { id: 'pick',  label: '',                 w: 36 },
  { id: 'code',  label: 'Mã ship-to',       w: 96 },
  { id: 'name',  label: 'Tên khách hàng',   w: 240 },
  { id: 'chan',  label: 'Kênh',             w: 120 },
  { id: 'rule',  label: 'Quy định date',    w: 210 },
  { id: 'wh',    label: 'Kho nhận',         w: 170 },
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
              <tr><td colSpan={4} className="px-2 py-3 text-center text-[11px] text-slate-400">
                Chưa khai mức nào{inheritNote ? ` — ${inheritNote}` : ''}
              </td></tr>
            )}
            {drafts.map((d, i) => (
              <tr key={i} className="border-b last:border-0 align-top">
                <td className="px-2 py-1.5">
                  <select value={d.category ?? ''}
                    onChange={e => patch(i, { category: e.target.value || null })}
                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-1.5 text-[11px]">
                    <option value="">
                      {rest.length ? `${hasGeneral && d.category === null ? 'Các loại còn lại' : 'Mọi loại hàng'} (${rest.join(', ')})` : 'Mọi loại hàng'}
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
                    <option value="FEFO">Không đòi mốc</option>
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

  const { data: whs } = useScopedWarehouses(true)
  const { data: channels } = useCustomerChannels()
  const { widths: colW, startResize, totalWidth } = useColumnResize('customers_col_widths', COLS.map(c => c.w))

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [allFiltered, setAllFiltered] = useState(false)   // "chọn cả N dòng theo bộ lọc"
  const [form, setForm] = useState<{ row: Customer | null } | null>(null)
  const [bulk, setBulk] = useState<'channel' | 'date_rule' | 'warehouse' | null>(null)
  const [seedOpen, setSeedOpen] = useState(false)
  const [chanEdit, setChanEdit] = useState<ChannelEdit | null>(null)
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

  async function runBulk(patch: CustomerPatch) {
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
  ]

  const bulkItems: ActionItem[] = canEdit && pickCount > 0 ? [
    { key: 'bchan', icon: Layers, label: `Phân kênh (${nf(pickCount)})`, primary: true,
      tip: 'Gán kênh cho các khách đang chọn — %Date mặc định của kênh áp cho đơn SINH SAU', onClick: () => setBulk('channel') },
    { key: 'brule', icon: CalendarClock, label: `%Date riêng (${nf(pickCount)})`,
      tip: 'Đặt %Date riêng, ghi đè mức của kênh', onClick: () => setBulk('date_rule') },
    { key: 'bwh', icon: WarehouseIcon, label: `Trỏ kho (${nf(pickCount)})`,
      tip: 'Khai "nơi nhận này là kho của mình" — kho nhận sẽ xác nhận hàng trong app khi chuyển kho', onClick: () => setBulk('warehouse') },
    { key: 'boff', icon: Power, label: `Ngừng (${nf(pickCount)})`, danger: true,
      tip: 'Ngừng các khách đang chọn (giữ lịch sử, không còn áp %Date)',
      onClick: () => runBulk({ is_active: false }) },
  ] : []

  const listTab = f.tab !== 'channels'

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
              {([['list', 'Khách hàng'], ['channels', 'Kênh']] as const).map(([k, lb]) => (
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
                  <ActionCluster items={[...bulkItems, ...toolbarItems]} mobileInline />
                </div>
              </>
            )}
          </div>
          {listTab && <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>}
          {/* Chọn-tất-cả 2 mức: trang đang xem → cả bộ lọc. Mobile không có hàng tiêu đề nên ô
              chọn-tất-cả đứng ở đây (cùng luật trang Chốt %Date). */}
          {listTab && picked.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-600">
              <label className="flex items-center gap-1.5 sm:hidden">
                <input type="checkbox" checked={allPicked} onChange={toggleAll} className="h-4 w-4 accent-sky-600" />
                Chọn cả trang
              </label>
              {allFiltered
                ? <span className="text-sky-700 font-medium">Đang chọn cả {nf(total)} khách theo bộ lọc hiện tại.
                    <button className="ml-1 underline" onClick={clearPick}>Bỏ chọn</button></span>
                : <span>Đã chọn {nf(picked.size)} dòng trên trang.
                    {total > rows.length && allPicked && (
                      <button className="ml-1 text-sky-700 underline" onClick={() => setAllFiltered(true)}>
                        Chọn cả {nf(total)} dòng theo bộ lọc
                      </button>
                    )}
                    <button className="ml-2 underline" onClick={clearPick}>Bỏ chọn</button>
                  </span>}
            </div>
          )}
          {err && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {err}</p>}
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
                  {isLoading && <TableRow><TableCell colSpan={COLS.length} className="px-2 py-6 text-center text-[11px] text-slate-400">Đang tải…</TableCell></TableRow>}
                  {!isLoading && !rows.length && (
                    <TableRow><TableCell colSpan={COLS.length} className="px-2 py-6 text-center text-[11px] text-slate-400">
                      Chưa có khách hàng nào khớp bộ lọc.
                      {canImport && <> Bấm <b>Nạp từ SAP</b> để đưa mã ship-to đã dùng thật vào danh mục.</>}
                    </TableCell></TableRow>
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
          <ChannelsTab canEdit={canChannel} onEdit={setChanEdit} />
        )}
      </div>

      {form && (
        <CustomerForm
          row={form.row}
          channels={(channels ?? []).map(c => ({ value: c.value, label: c.label }))}
          warehouses={(whs ?? []) as { id: string; name: string; code?: string }[]}
          cats={cats}
          saving={save.isPending || deact.isPending}
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
          saving={bulkSave.isPending || bulkRule.isPending}
          onClose={() => setBulk(null)}
          onApply={runBulk}
          onApplyRule={runBulkRule}
        />
      )}

      {seedOpen && <SeedDialog onClose={() => setSeedOpen(false)} />}

      {chanEdit && (
        <ChannelForm row={chanEdit} cats={cats} onClose={() => setChanEdit(null)} />
      )}
    </div>
  )
}

// ─── Form Thêm / Sửa khách hàng ────────────────────────────────────────────────────────────────
function CustomerForm({ row, channels, warehouses, cats, saving, onClose, onSave }: {
  row: Customer | null
  channels: { value: string; label: string }[]
  warehouses: { id: string; name: string; code?: string }[]
  cats: DateRuleCategory[] | undefined
  saving: boolean
  onClose: () => void
  onSave: (p: CustomerPatch) => Promise<Customer | undefined>
}) {
  const [code, setCode] = useState(row?.ship_to_code ?? '')
  const [name, setName] = useState(row?.name ?? '')
  const [channel, setChannel] = useState(row?.channel ?? '')
  const [drafts, setDrafts] = useState<RuleDraft[]>(draftsOf(row?.rules))
  const [whId, setWhId] = useState(row?.warehouse_id ?? '')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [note, setNote] = useState(row?.note ?? '')
  const saveRules = useSaveDateRules()
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    try {
      // Mức nằm ở bảng RIÊNG nên phải ghi bằng lời gọi thứ hai. Ghi HỒ SƠ TRƯỚC: khách mới chưa có
      // id thì không có gì để gắn mức vào.
      const saved = await onSave({
        ...(row ? {} : { ship_to_code: code.toUpperCase().trim() }),
        name: name.trim(), channel: channel || null,
        warehouse_id: whId || null, is_active: active, note: note.trim() || null,
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
      description="Mã ship-to của SAP là khoá — %Date tự động và luật Chuyển kho đều tra theo mã này."
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
            Chưa phân kênh thì dòng hàng của khách này KHÔNG được cấp %Date tự động — thủ kho vẫn phải chốt tay.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Quy định date</label>
          <RuleTable drafts={drafts} onChange={setDrafts} cats={cats ?? []}
            inheritNote={channel ? 'khách này đang theo mức của kênh' : 'chưa phân kênh nên KHÔNG được cấp tự động'} />
          {/* Mức của KÊNH mà khách đang thừa hưởng — để không khai lại y hệt cái đã có */}
          {!!(row?.channel_rules ?? []).length && !drafts.length && (
            <p className="mt-1 text-[11px] text-slate-500">
              Đang theo kênh: {(row?.channel_rules ?? []).map(x => `${x.category ? `${x.category} ` : ''}${masterRuleLabel(x.rule)?.text ?? ''}`).join(' · ')}
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Kho nhận</label>
          <WarehouseSingleSelect warehouses={warehouses} value={whId} onChange={setWhId}
            allLabel="— Khách ngoài (không phải kho của mình) —" />
          <p className="mt-1 text-[11px] text-slate-400">
            Trỏ kho = kho nhận vào app xác nhận hàng khi chuyển kho. Khách ngoài = tài xế tự xác nhận.
          </p>
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
function BulkDialog({ kind, count, byFilter, channels, warehouses, cats, saving, onClose, onApply, onApplyRule }: {
  kind: 'channel' | 'date_rule' | 'warehouse'
  count: number
  byFilter: boolean
  channels: { value: string; label: string }[]
  warehouses: { id: string; name: string; code?: string }[]
  cats: DateRuleCategory[] | undefined
  saving: boolean
  onClose: () => void
  onApply: (p: CustomerPatch) => void
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
  const title = kind === 'channel' ? 'Phân kênh hàng loạt' : kind === 'date_rule' ? 'Đặt quy định date hàng loạt' : 'Trỏ kho nhận hàng loạt'

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
                    <option value="FEFO">Không đòi mốc</option>
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
          <p className="text-[11px] text-amber-700">
            Chỉ áp cho ĐƠN SINH SAU. Đơn đang mở dùng nút "Áp lại theo master" ở trang Quy định date.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Huỷ</Button>
          <Button disabled={saving} onClick={() => {
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
  const [pre, setPre] = useState<UploadPreflight | null>(null)
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null)
  const [err, setErr] = useState('')

  const rows = data?.rows ?? []
  const newRows = useMemo(() => rows.filter(r => !r.exists_already), [rows])
  const sel = picked ?? new Set(newRows.map(r => r.ship_to_code))
  const chosen = useMemo(() => rows.filter(r => sel.has(r.ship_to_code)), [rows, sel])
  const toggle = (code: string) => setPicked(() => {
    const n = new Set(sel); n.has(code) ? n.delete(code) : n.add(code); return n
  })

  const run = async (preflight: boolean) => {
    setErr('')
    try {
      const res = await seed.mutateAsync({ rows: chosen.map(r => ({ ship_to_code: r.ship_to_code, name: r.name })), preflight })
      if (preflight) setPre(res as UploadPreflight)
      else { setDone({ created: res.created ?? 0, skipped: res.skipped ?? 0 }); setPre(null) }
    } catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không nạp được') }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="w-[95vw] max-w-3xl h-[90dvh] sm:h-[80vh] flex flex-col">
        <DialogHeader><DialogTitle className="text-base">Nạp khách hàng từ dữ liệu SAP</DialogTitle></DialogHeader>
        <p className="text-xs text-slate-500">
          Mã ship-to đã thấy trong VL06O hoặc trên chuyến. Khách nạp vào để TRỐNG kênh — phải phân kênh
          thì %Date mới được cấp tự động.
        </p>
        {err && <p className="text-[11px] text-red-600">{err}</p>}
        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm">
            <p className="font-medium text-green-700">Đã nạp {nf(done.created)} khách hàng mới.</p>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={7} className="px-2 py-6 text-center text-[11px] text-slate-400">Đang tải…</TableCell></TableRow>}
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
type ChannelEdit = { id: string; value: string; label: string; rules: MasterRuleRow[] }

function ChannelsTab({ canEdit, onEdit }: {
  canEdit: boolean
  onEdit: (r: ChannelEdit) => void
}) {
  const { data, isLoading } = useCustomerChannels()
  const rows = data ?? []
  return (
    <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
      <p className="px-3 py-2 text-[11px] text-slate-500">
        Mức mặc định của kênh áp cho ĐƠN SINH SAU khi lưu. Đơn đang mở dùng nút "Áp lại theo master"
        ở trang Quy định date — master không tự lan ngược để một ô cấu hình không làm nghìn dòng đổi âm thầm.
      </p>
      <Table className="min-w-full">
        <TableHeader>
          <TableRow>
            {['Mã kênh', 'Tên kênh', 'Quy định date mặc định', 'Số khách', ''].map((h, i) => (
              <TableHead key={i} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={5} className="px-2 py-6 text-center text-[11px] text-slate-400">Đang tải…</TableCell></TableRow>}
          {rows.map(c => (
            <TableRow key={c.id}>
              <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{c.value}</TableCell>
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
              <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums whitespace-nowrap">{nf(c.customers)}</TableCell>
              <TableCell className="px-2 py-1 whitespace-nowrap">
                {canEdit && (
                  <button onClick={() => onEdit({ id: c.id, value: c.value, label: c.label, rules: c.rules ?? [] })}
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

function ChannelForm({ row, cats, onClose }: {
  row: ChannelEdit
  cats: DateRuleCategory[] | undefined
  onClose: () => void
}) {
  const [label, setLabel] = useState(row.label)
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
            await save.mutateAsync({ id: row.id, label: label.trim() })
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
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Quy định date mặc định</label>
          <RuleTable drafts={drafts} onChange={setDrafts} cats={cats ?? []} inheritNote="kênh này không áp gì" />
        </div>
      </div>
    </FormSheet>
  )
}
