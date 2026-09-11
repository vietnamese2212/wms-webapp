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
  type Customer, type CustomerCandidate, type CustomerPatch, type UploadPreflight,
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
  { id: 'rule',  label: '%Date riêng',      w: 130 },
  { id: 'wh',    label: 'Kho nhận',         w: 170 },
  { id: 'src',   label: 'Nguồn',            w: 86 },
  { id: 'act',   label: 'Trạng thái',       w: 90 },
  { id: 'upd',   label: 'Sửa',              w: 110 },
]

/** Ô chọn quy tắc %Date của master — CHỈ FEFO | ≥ n % (chỉ định NSX/chia phần là việc của TỪNG DÒNG). */
function MasterRulePicker({ value, onChange, inheritLabel }: {
  value: DateRule | null
  onChange: (r: DateRule | null) => void
  inheritLabel: string
}) {
  const kind = value?.kind === 'MIN_PCT' ? 'MIN_PCT' : value?.kind === 'FEFO' ? 'FEFO' : ''
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {([
          { k: '',        label: inheritLabel },
          { k: 'FEFO',    label: 'FEFO (hạn ngắn nhất trước)' },
          { k: 'MIN_PCT', label: '≥ n % hạn dùng' },
        ] as const).map(o => (
          <button key={o.k} type="button"
            onClick={() => onChange(o.k === '' ? null : o.k === 'FEFO' ? { kind: 'FEFO' } : { kind: 'MIN_PCT', value: Number(value?.value) || 60 })}
            className={`rounded border px-2 py-1 text-xs transition-colors ${
              kind === o.k ? 'border-sky-500 bg-sky-50 text-sky-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {kind === 'MIN_PCT' && (
        <div className="flex items-center gap-2">
          <Input type="number" min={1} max={100} className="h-8 w-24 text-sm"
            value={String(value?.value ?? '')}
            onChange={e => onChange({ kind: 'MIN_PCT', value: Number(e.target.value) || 0 })} />
          <span className="text-xs text-slate-500">% hạn dùng còn lại trở lên</span>
        </div>
      )}
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
  const [chanEdit, setChanEdit] = useState<{ id: string; label: string; date_rule: DateRule | null } | null>(null)
  const [err, setErr] = useState('')

  const { data, isLoading } = useCustomers({
    search: f.search, channel: f.channel, hasChannel: f.hasChannel,
    warehouseId: f.warehouseId, active: f.active, page: f.page, pageSize: f.pageSize,
  })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const total = data?.total ?? 0
  const sum = data?.summary ?? { total: 0, no_channel: 0, with_warehouse: 0, auto_created: 0, inactive: 0 }
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize))

  const save = useSaveCustomer()
  const deact = useDeactivateCustomer()
  const bulkSave = useBulkUpdateCustomers()

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
  })

  async function runBulk(patch: CustomerPatch) {
    setErr('')
    try {
      await bulkSave.mutateAsync(allFiltered ? { filter: filterPayload(), patch } : { ids: [...picked], patch })
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
  ]

  const toolbarItems: ActionItem[] = [
    ...(canEdit ? [{
      key: 'add', icon: Plus, label: 'Thêm', tip: 'Thêm khách hàng / nơi nhận mới', primary: true,
      onClick: () => setForm({ row: null }),
    } satisfies ActionItem] : []),
    ...(canImport ? [{
      key: 'seed', icon: DownloadCloud, label: 'Nạp từ SAP', mobileHidden: true,
      tip: 'Nạp mã ship-to đã thấy trong VL06O / trên chuyến vào danh mục (khách mới để trống kênh)',
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
                <FilterSheetButton defs={filterDefs} />
                <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
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
              { label: 'Chưa phân kênh', value: nf(sum.no_channel), tip: 'Chưa phân kênh thì KHÔNG được cấp %Date tự động' },
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
                      Chưa có khách hàng nào khớp bộ lọc. Bấm "Nạp từ SAP" để đưa mã ship-to đã dùng vào danh mục.
                    </TableCell></TableRow>
                  )}
                  {rows.map(r => {
                    const b = masterRuleLabel(r.date_rule)
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
                          {b
                            ? <span className={`text-[9px] font-semibold rounded px-1 py-0.5 ${b.cls}`}>{b.text}</span>
                            : <span className="text-[9px] text-slate-400">theo kênh</span>}
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
          saving={save.isPending || deact.isPending}
          onClose={() => setForm(null)}
          onSave={async patch => {
            setErr('')
            try { await save.mutateAsync({ id: form.row?.id, ...patch }); setForm(null) }
            catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được'); throw e }
          }}
        />
      )}

      {bulk && (
        <BulkDialog
          kind={bulk} count={pickCount} byFilter={allFiltered}
          channels={(channels ?? []).map(c => ({ value: c.value, label: c.label }))}
          warehouses={(whs ?? []) as { id: string; name: string; code?: string }[]}
          saving={bulkSave.isPending}
          onClose={() => setBulk(null)}
          onApply={runBulk}
        />
      )}

      {seedOpen && <SeedDialog onClose={() => setSeedOpen(false)} />}

      {chanEdit && (
        <ChannelForm row={chanEdit} onClose={() => setChanEdit(null)} />
      )}
    </div>
  )
}

// ─── Form Thêm / Sửa khách hàng ────────────────────────────────────────────────────────────────
function CustomerForm({ row, channels, warehouses, saving, onClose, onSave }: {
  row: Customer | null
  channels: { value: string; label: string }[]
  warehouses: { id: string; name: string; code?: string }[]
  saving: boolean
  onClose: () => void
  onSave: (p: CustomerPatch) => Promise<void>
}) {
  const [code, setCode] = useState(row?.ship_to_code ?? '')
  const [name, setName] = useState(row?.name ?? '')
  const [channel, setChannel] = useState(row?.channel ?? '')
  const [rule, setRule] = useState<DateRule | null>(row?.date_rule ?? null)
  const [whId, setWhId] = useState(row?.warehouse_id ?? '')
  const [active, setActive] = useState(row?.is_active ?? true)
  const [note, setNote] = useState(row?.note ?? '')

  const submit = async () => {
    await onSave({
      ...(row ? {} : { ship_to_code: code.toUpperCase().trim() }),
      name: name.trim(), channel: channel || null, date_rule: rule,
      warehouse_id: whId || null, is_active: active, note: note.trim() || null,
    })
  }

  return (
    <FormSheet open onClose={onClose}
      title={row ? `Sửa khách hàng · ${row.ship_to_code}` : 'Thêm khách hàng / nơi nhận'}
      description="Mã ship-to của SAP là khoá — %Date tự động và luật Chuyển kho đều tra theo mã này."
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Huỷ</Button>
        <Button onClick={submit} disabled={saving || !name.trim() || (!row && !code.trim())}>
          {saving ? 'Đang lưu…' : 'Lưu'}
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
          <label className="mb-1 block text-xs font-medium text-slate-600">%Date riêng của khách</label>
          <MasterRulePicker value={rule} onChange={setRule} inheritLabel="Theo kênh" />
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
function BulkDialog({ kind, count, byFilter, channels, warehouses, saving, onClose, onApply }: {
  kind: 'channel' | 'date_rule' | 'warehouse'
  count: number
  byFilter: boolean
  channels: { value: string; label: string }[]
  warehouses: { id: string; name: string; code?: string }[]
  saving: boolean
  onClose: () => void
  onApply: (p: CustomerPatch) => void
}) {
  const [channel, setChannel] = useState('')
  const [rule, setRule] = useState<DateRule | null>(null)
  const [whId, setWhId] = useState('')
  const title = kind === 'channel' ? 'Phân kênh hàng loạt' : kind === 'date_rule' ? 'Đặt %Date riêng hàng loạt' : 'Trỏ kho nhận hàng loạt'

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
          {kind === 'date_rule' && <MasterRulePicker value={rule} onChange={setRule} inheritLabel="Theo kênh (xoá %Date riêng)" />}
          {kind === 'warehouse' && (
            <WarehouseSingleSelect warehouses={warehouses} value={whId} onChange={setWhId}
              allLabel="— Khách ngoài (bỏ trỏ kho) —" />
          )}
          <p className="text-[11px] text-amber-700">
            Chỉ áp cho ĐƠN SINH SAU. Đơn đang mở dùng nút "Áp lại theo master" ở trang Chốt %Date.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Huỷ</Button>
          <Button disabled={saving} onClick={() => onApply(
            kind === 'channel' ? { channel: channel || null }
              : kind === 'date_rule' ? { date_rule: rule }
              : { warehouse_id: whId || null })}>
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
function ChannelsTab({ canEdit, onEdit }: {
  canEdit: boolean
  onEdit: (r: { id: string; label: string; date_rule: DateRule | null }) => void
}) {
  const { data, isLoading } = useCustomerChannels()
  const rows = data ?? []
  return (
    <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
      <p className="px-3 py-2 text-[11px] text-slate-500">
        %Date mặc định của kênh áp cho ĐƠN SINH SAU khi lưu. Đơn đang mở dùng nút "Áp lại theo master"
        ở trang Chốt %Date — master không tự lan ngược để một ô cấu hình không làm nghìn dòng đổi âm thầm.
      </p>
      <Table className="min-w-full">
        <TableHeader>
          <TableRow>
            {['Mã kênh', 'Tên kênh', '%Date mặc định', 'Số khách', ''].map((h, i) => (
              <TableHead key={i} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={5} className="px-2 py-6 text-center text-[11px] text-slate-400">Đang tải…</TableCell></TableRow>}
          {rows.map(c => {
            const b = masterRuleLabel(c.date_rule)
            return (
              <TableRow key={c.id}>
                <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{c.value}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{c.label}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  {b ? <span className={`text-[9px] font-semibold rounded px-1 py-0.5 ${b.cls}`}>{b.text}</span>
                     : <span className="text-[9px] text-slate-400">Chưa khai — không áp gì</span>}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums whitespace-nowrap">{nf(c.customers)}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  {canEdit && (
                    <button onClick={() => onEdit({ id: c.id, label: c.label, date_rule: c.date_rule })}
                      className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700" title="Sửa kênh">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ChannelForm({ row, onClose }: {
  row: { id: string; label: string; date_rule: DateRule | null }
  onClose: () => void
}) {
  const [label, setLabel] = useState(row.label)
  const [rule, setRule] = useState<DateRule | null>(row.date_rule)
  const [err, setErr] = useState('')
  const save = useUpdateCustomerChannel()
  return (
    <FormSheet open onClose={onClose} title={`Kênh · ${row.label}`}
      description="%Date mặc định của kênh — khách không khai %Date riêng thì dùng mức này."
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
        <Button disabled={save.isPending || !label.trim()} onClick={async () => {
          setErr('')
          try { await save.mutateAsync({ id: row.id, label: label.trim(), date_rule: rule }); onClose() }
          catch (e) { setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không lưu được') }
        }}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-4">
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tên kênh *</label>
          <Input value={label} onChange={e => setLabel(e.target.value)} className="h-9" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">%Date mặc định</label>
          <MasterRulePicker value={rule} onChange={setRule} inheritLabel="Chưa khai (không áp gì)" />
        </div>
      </div>
    </FormSheet>
  )
}
