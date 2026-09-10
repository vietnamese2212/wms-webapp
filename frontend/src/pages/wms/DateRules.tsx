// CHỐT %DATE — màn của nhân viên SAP TRƯỚC GIỜ XUẤT (user chốt 10/09 vòng 8):
//   "trước lúc xuất hàng, nv SAP vào kiểm tra TẤT CẢ các đơn hàng sau đó input dữ liệu vào …
//    cần nhìn hết đơn hàng (dạng filter được) và thấy tất cả các dòng sau đó input.
//    Việc input này nên làm theo checkbox ở các dòng, có checkbox tất cả và checkbox chỗ nào cần"
//
// Khác trang Xuất kho: đơn vị hiển thị là DÒNG HÀNG, không phải chuyến — vì thứ phải quyết là
// "%Date của từng mã", và một mã có ghi chú CS riêng thì phải nhìn thấy ngay cạnh nhau.
// Chốt xong thì mở dialog dùng CHUNG với trang chuyến (SetDateRuleSheet) — một luật, một chỗ sửa.
import { useMemo, useState } from 'react'
import { CalendarClock, AlertTriangle } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { SetDateRuleSheet, dateRuleLabel, type DateRuleTarget } from '@/components/wms/SetDateRuleSheet'
import { useDateRuleLines, type DateRuleLine } from '@/api/hooks'
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
  { id: 'mat',  label: 'Mã hàng',       w: 92 },
  { id: 'name', label: 'Tên hàng',      w: 190 },
  { id: 'qty',  label: 'Còn lấy',       w: 118, align: 'right' as const },
  { id: 'note', label: 'Ghi chú của CS', w: 200 },
  { id: 'rule', label: '%Date lấy hàng', w: 170 },
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

  const { data, isLoading } = useDateRuleLines({
    from: f.from, to: f.to, warehouseId: f.warehouseId, state: f.state, search: f.search,
    page: f.page, pageSize: f.pageSize,
  })
  const rows = data?.rows ?? []
  const sum = data?.summary ?? { lines: 0, set: 0, unset: 0, with_note: 0, trips: 0 }
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize))

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
    trip_label: `${r.group_code ?? ''}${r.delivery_code ? ` · ${r.delivery_code}` : ''}`,
    remaining: r.remaining,
    units: unitsOf(r),
    note: r.header_text,
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
    { key: 'state', label: 'Trạng thái chốt', type: 'single', pinned: true,
      options: [{ value: 'UNSET', label: 'Chưa chốt' }, { value: 'SET', label: 'Đã chốt' }],
      value: f.state, onChange: (v: string) => setF({ state: v as '' | 'SET' | 'UNSET', page: 1 }) },
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap w-full min-w-0">
            <h1 className="hidden sm:flex text-sm font-semibold text-slate-800 items-center gap-1.5 shrink-0">
              <CalendarClock className="h-4 w-4 text-sky-600" /> Chốt %Date
            </h1>
            <SearchInput value={f.search} onChange={v => setF({ search: v, page: 1 })}
              placeholder="Số xe · biển số · NPP · số DO · mã hàng · ghi chú CS" className="flex-1 min-w-[140px]" />
            <FilterSheetButton defs={filterDefs} />
            <Button size="sm" className="h-9 sm:h-7" disabled={!canSet || picked.size === 0 || pickedWhs.size > 1}
              onClick={() => setSheet(toTargets(pickedRows))}>
              Chốt %Date ({picked.size})
            </Button>
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
          { label: 'Chưa chốt', value: nf(sum.unset) },
          { label: 'Đã chốt', value: nf(sum.set) },
          { label: 'Có ghi chú CS', value: nf(sum.with_note) },
          ...(totalPages > 1 ? [{ label: 'Trang', value: `${f.page}/${totalPages}` }] : []),
        ]} />

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
                    <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap">{r.material_code ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">{r.material_name ?? <span className="text-slate-300">—</span>}</TableCell>
                    {/* SL theo THÙNG (+ lẻ) — số base thô (13.440 hộp) không phải đơn vị kho dùng để nói chuyện */}
                    <TableCell className="px-2 py-1 text-[10px] text-right font-semibold tabular-nums whitespace-nowrap">{qtyLabel(r.remaining, u)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px]">
                      {r.header_text
                        ? <span className="text-red-600 whitespace-pre-wrap break-words">{r.header_text}</span>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] font-semibold rounded px-1 py-0.5 ${b.cls}`}>{b.text}</span>
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
    </div>
  )
}
