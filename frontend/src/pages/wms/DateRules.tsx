// QUY ĐỊNH DATE (tên cũ "Chốt %Date", đổi 11/09) — màn của nhân viên SAP TRƯỚC GIỜ XUẤT
// (user chốt 10/09 vòng 8):
//   "trước lúc xuất hàng, nv SAP vào kiểm tra TẤT CẢ các đơn hàng sau đó input dữ liệu vào …
//    cần nhìn hết đơn hàng (dạng filter được) và thấy tất cả các dòng sau đó input.
//    Việc input này nên làm theo checkbox ở các dòng, có checkbox tất cả và checkbox chỗ nào cần"
//
// Khác trang Xuất kho: đơn vị hiển thị là DÒNG HÀNG, không phải chuyến — vì thứ phải quyết là
// "quy định date của từng mã", và một mã có ghi chú CS riêng thì phải nhìn thấy ngay cạnh nhau.
// Khai xong thì mở dialog dùng CHUNG với trang chuyến (SetDateRuleSheet) — một luật, một chỗ sửa.
//
// MÀN NÀY CHỈ XỬ LÝ THỨ CÓ ĐÒI DATE (user chốt 11/09): dòng có mã KHÔNG khai hạn dùng đã được hệ
// thống tự đặt "không đòi mốc" nên không hiện ở đây — RPC lọc sẵn, và ô band "Không có hạn dùng"
// giữ lại con số để không ai tưởng đơn bị thiếu dòng. Chúng VẪN có việc ở "Việc cần làm": không có
// date để so thì thứ tự lấy rơi xuống QUÃNG ĐƯỜNG tới cửa.
import { useMemo, useState } from 'react'
import { CalendarClock, AlertTriangle, RefreshCw } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { ActionCluster } from '@/components/shared/ActionBtn'
import { SetDateRuleSheet, dateRuleLabel, dateRuleCols, type DateRuleTarget } from '@/components/wms/SetDateRuleSheet'
import {
  useDateRuleLines, useApplyDateRuleMaster, useDateRuleCategories, useCustomerChannels,
  type DateRuleLine, type ApplyMasterResult,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate } from '@/utils/formatters'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'

const nf = (n: number) => n.toLocaleString('vi-VN')

/** Quy cách của mã trên dòng — để mọi số lượng hiện theo THÙNG chứ không phải số base thô. */
const unitsOf = (r: DateRuleLine): MatUnits =>
  ({ base_unit: r.base_unit, entry_unit: r.entry_unit, units_per_carton: r.units_per_carton })

const COLS = [
  { id: 'pick', label: '',              w: 36 },
  { id: 'date', label: 'Ngày xuất',     w: 84 },
  { id: 'trip', label: 'Số xe · Biển',  w: 168 },
  { id: 'npp',  label: 'NPP · Số DO',   w: 168 },
  // Khách hàng / Kênh (11/09): %Date tự động chạy theo hai thứ này, nên người chốt phải thấy ngay
  // vì sao dòng của mình có (hoặc không có) mức sẵn.
  { id: 'cust', label: 'Khách · Kênh',  w: 170 },
  { id: 'mat',  label: 'Mã hàng',       w: 92 },
  { id: 'name', label: 'Tên hàng',      w: 190 },
  { id: 'qty',  label: 'Còn lấy',       w: 118, align: 'right' as const },
  { id: 'note', label: 'Ghi chú của CS', w: 190 },
  // HAI CỘT RIÊNG (user chốt 11/09): "đã yêu cầu % thì thôi yêu cầu ngày" — mỗi dòng điền đúng một
  // cột, cột kia gạch ngang. Cột Nguồn giữ phần không phải con số (không đòi mốc / chỉ định / chia
  // phần) cùng với ai đặt và cờ cần xem.
  { id: 'pct',  label: '% date yêu cầu', w: 120, align: 'right' as const },
  { id: 'days', label: 'Ngày date còn yêu cầu', w: 140, align: 'right' as const },
  { id: 'src',  label: 'Nguồn',          w: 150 },
]

// Nhãn nguồn trên bộ lọc — UNSET/REVIEW là hai LÁT CẮT, không phải giá trị của cột nguồn.
const SOURCE_OPTS = [
  { value: 'UNSET',    label: 'Chưa khai' },
  { value: 'MANUAL',   label: 'Khai tay' },
  { value: 'CUSTOMER', label: 'Theo khách' },
  { value: 'CHANNEL',  label: 'Theo kênh' },
  { value: 'SYSTEM',   label: 'Hệ thống đặt' },
  { value: 'SAP',      label: 'Từ VL06O' },
  { value: 'REVIEW',   label: 'Cần xem' },
]

const KIND_OPTS = [
  { value: 'MIN_PCT',  label: '≥ % hạn dùng' },
  { value: 'MIN_DAYS', label: '≥ số ngày còn lại' },
  { value: 'FEFO',     label: 'Không đòi mốc' },
  { value: 'EXACT',    label: 'Chỉ định' },
  { value: 'SPLIT',    label: 'Chia phần theo SL' },
]

export default function DateRules() {
  const f = useWmsFilterStore(s => s.dateRules)
  const setF = useWmsFilterStore(s => s.setDateRules)
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canSet = can(perms, 'outbound', 'set_date')
  const { data: whs } = useScopedWarehouses(true)
  const { widths: colW, startResize, totalWidth } = useColumnResize('date_rules_col_widths', COLS.map(c => c.w))

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [sheet, setSheet] = useState<DateRuleTarget[] | null>(null)
  const [applyOpen, setApply] = useState(false)

  const { data: cats } = useDateRuleCategories()
  // NHÃN KÊNH LẤY TỪ DANH MỤC, không in mã thô (user bắt 12/09: "Kênh không lấy mã mà lấy theo tên
  // chứ?"). Bảng in thẳng `r.channel` = KHO_TONG / NPP / BHX trong khi danh mục có sẵn "Kho tổng" /
  // "Nhà phân phối" / "Bách hoá xanh" — và chính cái field nhận giá trị đó còn tên là `channel_label`.
  // Đổi tên kênh trong Cấu hình → màn này phải đổi theo, không được đóng băng mã.
  const { data: channels } = useCustomerChannels()
  const channelLabel = (v: string | null | undefined) =>
    (channels ?? []).find(c => c.value === v)?.label ?? v ?? ''
  const { data, isLoading } = useDateRuleLines({
    from: f.from, to: f.to, warehouseId: f.warehouseId, state: f.state, search: f.search,
    source: f.source, matCategory: f.matCategory, kind: f.kind, page: f.page, pageSize: f.pageSize,
  })
  const rows = data?.rows ?? []
  const sum = data?.summary ?? { lines: 0, set: 0, unset: 0, with_note: 0, trips: 0, review: 0, no_channel: 0, no_shelf_life: 0 }
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize))

  // CÔNG TẮC THEO KHO — khai mức ở Khách hàng / Kênh xong mà kho vẫn TẮT thì máy không áp gì, và
  // trước 12/09 màn này không nói một lời nào (user hỏi thẳng "tại sao Quy định date không chạy dù
  // đã khai Khách hàng, kênh rồi?" — đo staging: 0/153 kho bật). Cấu hình im lặng = người dùng đi
  // tìm lỗi ở chỗ không có lỗi.
  const offWhs = useMemo(() => {
    const list = (whs ?? []) as { id: string; name?: string; date_rule_policy?: string | null }[]
    const inScope = f.warehouseId ? list.filter(w => w.id === f.warehouseId) : list
    return inScope.filter(w => String(w.date_rule_policy ?? 'OFF').toUpperCase() === 'OFF')
  }, [whs, f.warehouseId])
  const allOff = offWhs.length > 0 && offWhs.length === (f.warehouseId ? 1 : (whs ?? []).length)

  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.item_id))
  const toggleAll = () => setPicked(s => {
    const n = new Set(s)
    if (allPicked) rows.forEach(r => n.delete(r.item_id))
    else rows.forEach(r => n.add(r.item_id))
    return n
  })
  const toggleOne = (id: string) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Chỉ chốt được các dòng CÙNG MỘT KHO một lần (tra tồn theo kho); khác kho thì nhắc chọn lại.
  const pickedRows = useMemo(() => rows.filter(r => picked.has(r.item_id)), [rows, picked])
  const pickedWhs = useMemo(() => new Set(pickedRows.map(r => r.warehouse_id ?? '')), [pickedRows])

  const toTargets = (list: DateRuleLine[]): DateRuleTarget[] => list.map(r => ({
    item_id: r.item_id,
    material_id: r.material_id,
    material_code: r.material_code,
    material_name: r.material_name,
    material_category: r.material_category ?? null,
    trip_label: `${r.group_code ?? ''}${r.delivery_code ? ` · ${r.delivery_code}` : ''}`,
    remaining: r.remaining,
    units: unitsOf(r),
    note: r.header_text,
    // Khách hàng + kênh: người khai phải nhìn thấy mới quyết được mức (user 11/09)
    customer_name: r.customer_name ?? r.shipto_party ?? null,
    channel_label: r.customer_has_channel ? channelLabel(r.channel) : null,
    customer_known: r.customer_known,
    warehouse_name: r.warehouse_name ?? null,
    delivery_date: r.delivery_date ?? null,
    // Mức KẾ THỪA từ VL06O (`date_required`): bộ sinh việc ĐÃ chia hàng theo nó, nên mở dialog phải
    // thấy sẵn mức đó — bấm Lưu là biến nó thành chốt tay tường minh, chứ không phải ô trống.
    current: r.date_rule ?? (Number(r.date_required) > 0 ? { kind: 'MIN_PCT', value: Number(r.date_required) } : null),
  }))

  const filterDefs: FilterDef[] = [
    { key: 'range', label: 'Ngày xuất', type: 'daterange', pinned: true,
      from: f.from, to: f.to, onChange: (from: string, to: string) => setF({ from, to, page: 1 }) },
    { key: 'wh', label: 'Kho', type: 'single', pinned: true,
      options: (whs ?? []).map(w => ({ value: (w as { id: string }).id, label: (w as { id: string; name?: string }).name ?? '' })),
      value: f.warehouseId, onChange: (v: string) => setF({ warehouseId: v, page: 1 }) },
    { key: 'state', label: 'Trạng thái khai', type: 'single', pinned: true,
      options: [{ value: 'UNSET', label: 'Chưa khai' }, { value: 'SET', label: 'Đã khai' }],
      value: f.state, onChange: (v: string) => setF({ state: v as '' | 'SET' | 'UNSET', page: 1 }) },
    { key: 'source', label: 'Nguồn', type: 'multi', pinned: true,
      options: SOURCE_OPTS, selected: f.source,
      onChange: (v: string[]) => setF({ source: v, page: 1 }) },
    // Loại hàng của MÃ (khác Loại kho mà chuyến chở) — mức khai theo cặp khách × loại hàng nên
    // người khai cần xem riêng từng loại.
    { key: 'mcat', label: 'Loại hàng', type: 'multi',
      options: (cats ?? []).map(c => ({ value: c.value, label: c.label })),
      selected: f.matCategory, onChange: (v: string[]) => setF({ matCategory: v, page: 1 }) },
    { key: 'kind', label: 'Kiểu quy định', type: 'multi',
      options: KIND_OPTS, selected: f.kind,
      onChange: (v: string[]) => setF({ kind: v, page: 1 }) },
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap w-full min-w-0">
            <h1 className="hidden sm:flex text-sm font-semibold text-slate-800 items-center gap-1.5 shrink-0">
              <CalendarClock className="h-4 w-4 text-sky-600" /> Quy định date
            </h1>
            <SearchInput value={f.search} onChange={v => setF({ search: v, page: 1 })}
              placeholder="Số xe · biển số · NPP · khách · số DO · mã hàng · ghi chú CS" className="flex-1 min-w-[140px]" />
            <FilterSheetButton defs={filterDefs} />
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <ActionCluster mobileInline items={[
                { key: 'set', icon: CalendarClock, label: `Quy định date (${picked.size})`, primary: true,
                  tip: pickedWhs.size > 1 ? 'Đang chọn dòng của nhiều kho — tồn tra theo kho, hãy lọc về một kho'
                    : 'Khai mức quy định date cho các dòng đang tick',
                  disabled: !canSet || picked.size === 0 || pickedWhs.size > 1,
                  onClick: () => setSheet(toTargets(pickedRows)) },
                { key: 'master', icon: RefreshCw, label: 'Áp lại theo master',
                  tip: 'Áp mức của Khách hàng / Kênh cho đơn đang mở trong khoảng ngày đang lọc — KHÔNG đụng dòng đã khai tay',
                  disabled: !canSet, onClick: () => setApply(true) },
              ]} />
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
          {pickedWhs.size > 1 && (
            <p className="text-[11px] text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Đang chọn dòng của {pickedWhs.size} kho khác nhau — tồn tra theo kho, hãy lọc về một kho rồi chốt.
            </p>
          )}
        </div>

        <SummaryBand tiles={[
          { label: 'Dòng hàng', value: nf(sum.lines) },
          { label: 'Chuyến', value: nf(sum.trips) },
          { label: 'Chưa khai', value: nf(sum.unset) },
          { label: 'Đã khai', value: nf(sum.set) },
          { label: 'Có ghi chú CS', value: nf(sum.with_note) },
          // Máy đã áp mức nhưng lúc áp kho KHÔNG còn pallet nào đạt — không chặn, nhưng giấu đi thì
          // chuyến vào ca sinh 0 việc mà không ai biết vì sao.
          { label: 'Cần xem', value: nf(sum.review), tip: 'Máy đã áp mức nhưng kho không còn pallet nào đạt — hoặc mức của VL06O thấp hơn mức khách đã khai' },
          { label: 'Khách chưa khai mức', value: nf(sum.no_channel), tip: 'Dòng chưa khai của khách chưa có mức nào (khách lẫn kênh) — khai ở trang Khách hàng' },
          // Dòng có mã KHÔNG đo được date đã bị ẩn khỏi bảng (hệ thống tự đặt "không đòi mốc") —
          // nhưng con số phải còn trong sổ sách, nếu không người ta tưởng đơn bị thiếu dòng.
          { label: 'Không có hạn dùng', value: nf(sum.no_shelf_life ?? 0), tip: 'Mã không khai hạn dùng — hệ thống tự đặt "không đòi mốc", không hiện ở bảng này vì không có gì để khai' },
          ...(totalPages > 1 ? [{ label: 'Trang', value: `${f.page}/${totalPages}` }] : []),
        ]} />

        {allOff && (
          <div className="shrink-0 border-b bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
            <b>{f.warehouseId ? `Kho ${offWhs[0]?.name ?? ''} đang TẮT` : 'Mọi kho trong phạm vi của bạn đang TẮT'} áp %Date tự động</b> — mức khai
            ở trang Khách hàng / Kênh sẽ không tự vào dòng hàng nào, mọi dòng vẫn phải khai tay.
            <span className="hidden sm:inline"> Bật ở <b>Cài đặt WMS → Kho → sửa kho → Áp %Date tự động</b>. Bật xong chỉ áp cho đơn sinh SAU đó; đơn đang mở dùng nút “Áp lại theo master”.</span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
            style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{COLS.map((c, i) => <col key={c.id} style={{ width: colW[i] }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>
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
                  Không có dòng hàng nào trong khoảng ngày này.
                </TableCell></TableRow>
              )}
              {rows.map(r => {
                const u = unitsOf(r)
                const b = dateRuleLabel(r.date_rule, u, r.date_required)
                const cols = dateRuleCols(r.date_rule, r.date_required)
                // Kiểu ĐÃ nằm ở hai cột số thì không lặp lại badge ở cột Nguồn
                const numeric = (cols.pct != null || cols.days != null)
                  && (r.date_rule == null || r.date_rule.kind === 'MIN_PCT' || r.date_rule.kind === 'MIN_DAYS')
                return (
                  <TableRow key={r.item_id} className={picked.has(r.item_id) ? 'bg-sky-50' : ''}>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <input type="checkbox" checked={picked.has(r.item_id)} onChange={() => toggleOne(r.item_id)} className="h-4 w-4 accent-sky-600" />
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{formatDate(r.delivery_date)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      <div className="font-mono font-semibold truncate">{r.group_code ?? '—'}</div>
                      <div className="text-[9px] text-slate-400">{r.license_plate ?? '—'}</div>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      <div className="truncate">{r.distributor_name ?? '—'}</div>
                      <div className="text-[9px] text-slate-400 font-mono">{r.delivery_code ?? '—'}</div>
                    </TableCell>
                    {/* Khách hàng của chuyến (khoá = mã ship-to SAP) + kênh — nguồn của %Date tự động */}
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      <div className="truncate">{r.customer_name ?? (r.shipto_party ? <span className="font-mono">{r.shipto_party}</span> : <span className="text-slate-300">—</span>)}</div>
                      {r.customer_has_channel
                        ? <div className="text-[9px] text-slate-400 truncate">{channelLabel(r.channel)}</div>
                        : <div className="text-[9px] text-amber-600">{r.customer_known ? 'chưa phân kênh' : 'chưa có trong danh mục'}</div>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{r.material_code ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">{r.material_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    {/* SL theo THÙNG (+ lẻ) — số base thô (13.440 hộp) không phải đơn vị kho dùng để nói chuyện */}
                    <TableCell className="px-2 py-1 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap">{qtyLabel(r.remaining, u)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {r.header_text
                        ? <span className="text-red-600 whitespace-pre-wrap break-words">{r.header_text}</span>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    {/* Hai cột con số — mỗi dòng chỉ điền MỘT */}
                    <TableCell className="px-2 py-1 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap text-sky-700">
                      {cols.pct ?? <span className="text-slate-300 font-normal">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap text-teal-700">
                      {cols.days ?? <span className="text-slate-300 font-normal">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {/* Chỉ hiện badge cho kiểu KHÔNG phải con số (không đòi mốc · chỉ định · chia
                          phần · chưa khai) — MIN_PCT/MIN_DAYS đã nằm ở hai cột bên trái rồi. */}
                      {!numeric && (
                        <span className={`text-[9px] font-semibold rounded px-1 py-0.5 ${b.cls} ${b.review ? 'ring-1 ring-red-400' : ''}`}>
                          {b.text}
                        </span>
                      )}
                      {b.source && <span className={`text-[9px] text-slate-400 ${numeric ? '' : 'ml-1'}`}>{numeric ? '' : '· '}{b.source}</span>}
                      {b.review && (
                        <span className="ml-1 text-[9px] font-semibold text-red-600"
                          title={r.date_rule?.review === 'BELOW_MASTER'
                            ? 'Mức của VL06O quy ra ngày còn thấp hơn mức khách đã khai'
                            : 'Kho không còn pallet nào đạt mức này — đổi mức hoặc để dòng chưa khai'}>
                          · cần xem
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <PagerNav page={f.page} totalPages={totalPages} onPage={p => setF({ page: p })} />
        </div>

        <ListFooter page={f.page} pageSize={f.pageSize} total={total} unit="dòng"
          onPageSize={n => setF({ pageSize: n, page: 1 })}
          right={picked.size > 0 ? `${nf(picked.size)} dòng đang chọn` : undefined} />
      </div>

      {sheet && (
        <SetDateRuleSheet open onClose={() => { setSheet(null); setPicked(new Set()) }}
          targets={sheet} warehouseId={pickedRows[0]?.warehouse_id ?? null} />
      )}

      {applyOpen && (
        <ApplyMasterDialog from={f.from} to={f.to} warehouseId={f.warehouseId}
          warehouseName={(whs ?? []).find(w => (w as { id: string }).id === f.warehouseId) ? ((whs ?? []).find(w => (w as { id: string }).id === f.warehouseId) as { name?: string }).name ?? '' : ''}
          onClose={() => setApply(false)} />
      )}
    </div>
  )
}

/**
 * ÁP LẠI %DATE THEO MASTER — 2 pha (kiểm trước → xác nhận).
 * Master KHÔNG tự lan ngược cho đơn đang mở: sửa một ô cấu hình mà làm nghìn dòng đổi âm thầm là
 * lỗi không ai lần ra được. Đây là đường duy nhất áp cho đơn cũ, và phải nói rõ sẽ đụng bao nhiêu.
 */
function ApplyMasterDialog({ from, to, warehouseId, warehouseName, onClose }: {
  from: string; to: string; warehouseId: string; warehouseName: string; onClose: () => void
}) {
  const apply = useApplyDateRuleMaster()
  const [pre, setPre] = useState<{ applied: number; cleared: number; kept: number; scanned: number } | null>(null)
  const [done, setDone] = useState<ApplyMasterResult | null>(null)
  const [err, setErr] = useState('')

  const run = async (preflight: boolean) => {
    setErr('')
    try {
      const res = await apply.mutateAsync({ from, to, warehouse_id: warehouseId || undefined, preflight })
      if (preflight) {
        const ex = (res.extra ?? []) as { label: string; value: number }[]
        const get = (k: string) => Number(ex.find(e => e.label.startsWith(k))?.value ?? 0)
        setPre({ applied: get('Sẽ áp'), cleared: get('Sẽ XOÁ'), kept: get('Giữ nguyên'), scanned: res.total ?? 0 })
      } else setDone(res)
    } catch (e) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không áp được')
    }
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Áp lại %Date theo master</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            Khoảng ngày <b>{formatDate(from)} – {formatDate(to)}</b>
            {warehouseName ? <> · kho <b>{warehouseName}</b></> : <> · <b>mọi kho trong phạm vi của bạn</b></>}.
          </p>
          <p className="text-[11px] text-slate-500">
            Chỉ đụng dòng CHƯA CHỐT hoặc dòng do máy áp trước đó. Dòng người đã <b>chốt tay</b> không bao giờ bị đè.
          </p>
          {err && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {err}</p>}
          {pre && !done && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[12px] space-y-0.5">
              <div>Xét <b>{nf(pre.scanned)}</b> dòng.</div>
              <div className="text-green-700">Sẽ áp %Date: <b>{nf(pre.applied)}</b> dòng</div>
              {pre.cleared > 0 && <div className="text-amber-700">Sẽ XOÁ mức máy đã áp: <b>{nf(pre.cleared)}</b> dòng (kho đổi chính sách hoặc dòng có ghi chú CS)</div>}
              <div className="text-slate-500">Giữ nguyên vì đã chốt tay: {nf(pre.kept)} dòng</div>
            </div>
          )}
          {done && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-2 text-[12px] space-y-0.5">
              <div className="font-medium text-green-800">Đã áp {nf(done.applied)} dòng.</div>
              {done.cleared > 0 && <div className="text-amber-700">Xoá mức máy cũ: {nf(done.cleared)} dòng</div>}
              <div className="text-slate-600">Giữ chốt tay: {nf(done.kept_manual)} dòng · sắp lại kế hoạch {nf(done.trips_replanned)} chuyến đang xuất</div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>{done ? 'Đóng' : 'Huỷ'}</Button>
          {!done && !pre && (
            <Button disabled={apply.isPending} onClick={() => run(true)}>
              {apply.isPending ? 'Đang kiểm…' : 'Kiểm trước'}
            </Button>
          )}
          {!done && pre && (
            <Button disabled={apply.isPending || (pre.applied + pre.cleared === 0)} onClick={() => run(false)}>
              {apply.isPending ? 'Đang áp…' : `Xác nhận áp ${nf(pre.applied + pre.cleared)} dòng`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
