// KIỂM KÊ LUÂN PHIÊN THEO ABC (Đợt 3 roadmap 06/08) — thay kiểm kho full bằng chu kỳ:
// hạng A (nhặt nhiều, sai lệch gây hại nhất) 7 ngày/lần · B 30 ngày · C 90 ngày.
// Hạng ABC lấy từ engine Slotting (một nguồn); "kiểm gần nhất" từ StocktakeLog (append-only).
// Nút "Kiểm N mã đã chọn" KHÔNG gọi API write — chỉ PREFILL bộ lọc tab Tổng hợp KK rồi điều
// hướng (luồng kiểm sẵn có làm tiếp) → cả trang dùng quyền stocktake.view.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCcw, ClipboardCheck } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { StocktakeTabs, LOC_ID_CAP } from '@/components/wms/StocktakeTabs'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { useCycleCount, type CycleCountRow } from '@/api/hooks'
import { useScopedWarehouses, useScopedWhTypes } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatTimestampDate } from '@/utils/formatters'

const nf = (n: number) => n.toLocaleString('vi-VN')
const ABC_BADGE: Record<string, string> = {
  A: 'bg-red-100 text-red-700', B: 'bg-amber-100 text-amber-800', C: 'bg-slate-200 text-slate-600',
}

// Màu row: quá hạn/chưa kiểm = đỏ · đến hạn sát (≤2 ngày) = cam · còn hạn = xám
function cycleKey(r: CycleCountRow): RowStatusKey {
  if (r.due_in <= 0) return 'paused'
  if (r.due_in <= 2) return 'inProgress'
  return 'pending'
}
function dueLabel(r: CycleCountRow): { text: string; cls: string } {
  if (r.never_counted) return { text: 'Chưa kiểm lần nào', cls: 'bg-red-100 text-red-700' }
  if (r.due_in <= 0) return { text: `Quá hạn ${nf(-r.due_in)} ngày`, cls: 'bg-red-100 text-red-700' }
  if (r.due_in <= 2) return { text: `Còn ${nf(r.due_in)} ngày`, cls: 'bg-amber-100 text-amber-800' }
  return { text: `Còn ${nf(r.due_in)} ngày`, cls: 'bg-slate-100 text-slate-500' }
}

const COLS = [
  { id: 'sel',   label: '',                w: 36 },
  { id: 'abc',   label: 'Hạng',            w: 60 },
  { id: 'code',  label: 'Mã hàng',         w: 110 },
  { id: 'name',  label: 'Tên hàng',        w: 200 },
  { id: 'cat',   label: 'Loại kho',        w: 85 },
  { id: 'due',   label: 'Tình trạng',      w: 130 },
  { id: 'last',  label: 'Kiểm gần nhất',   w: 110 },
  { id: 'cyc',   label: 'Chu kỳ',          w: 70,  align: 'right' as const },
  { id: 'picks', label: 'Lượt nhặt (30n)', w: 100, align: 'right' as const },
  { id: 'pal',   label: 'Tồn (pallet)',    w: 90,  align: 'right' as const },
  { id: 'locs',  label: 'Vị trí đang chứa', w: 200 },
]

export default function StocktakeCycle() {
  const navigate = useNavigate()
  const f = useWmsFilterStore(s => s.stocktakeCycle)
  const setF = useWmsFilterStore(s => s.setStocktakeCycle)
  const setSummary = useWmsFilterStore(s => s.setStocktakeSummary)
  const { widths: colW, startResize, totalWidth } = useColumnResize('stocktake_cycle_col_widths', COLS.map(c => c.w))
  const { data: whs } = useScopedWarehouses(true)
  const { data: whTypes } = useScopedWhTypes()
  const [sel, setSel] = useState<Set<string>>(new Set())

  const { data, isLoading } = useCycleCount(
    f.warehouseId ? { warehouse_id: f.warehouseId, categories: f.cats.join(',') || undefined } : undefined)

  const rows = useMemo(() => {
    let all = data?.rows ?? []
    if (f.dueOnly) all = all.filter(r => r.due_in <= 0)
    if (f.abc.length) all = all.filter(r => f.abc.includes(r.abc))
    const term = f.search.trim().toLowerCase()
    if (term) all = all.filter(r => `${r.material_code} ${r.short_name ?? ''}`.toLowerCase().includes(term))
    return all
  }, [data, f.dueOnly, f.abc, f.search])

  const selRows = rows.filter(r => sel.has(r.material_id))
  const selLocIds = useMemo(() => [...new Set(selRows.flatMap(r => r.loc_ids))], [selRows])
  const allSel = rows.length > 0 && rows.every(r => sel.has(r.material_id))

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', pinned: true, allLabel: 'Chọn kho…',
      options: (whs ?? []).map(w => ({ value: (w as { id: string }).id, label: (w as { id: string; name?: string }).name ?? '' })),
      value: f.warehouseId, onChange: (v: string) => { setSel(new Set()); setF({ warehouseId: v }) } },
    { key: 'cat', label: 'Loại kho', type: 'multi', searchable: false,
      options: (whTypes ?? []).map(t => ({ value: (t as { value: string }).value, label: (t as { value: string; label?: string }).label ?? (t as { value: string }).value })),
      selected: f.cats, onChange: (v: string[]) => setF({ cats: v }) },
    { key: 'abc', label: 'Hạng', type: 'multi', searchable: false,
      options: [{ value: 'A', label: 'A — 7 ngày/lần' }, { value: 'B', label: 'B — 30 ngày' }, { value: 'C', label: 'C — 90 ngày' }],
      selected: f.abc, onChange: (v: string[]) => setF({ abc: v }) },
    { key: 'due', label: 'Phạm vi', type: 'single', pinned: true, allLabel: 'Chỉ mã ĐẾN HẠN (mặc định)',
      options: [{ value: 'all', label: 'Tất cả mã có tồn' }],
      value: f.dueOnly ? '' : 'all',
      onChange: (v: string) => setF({ dueOnly: v !== 'all' }) },
  ]

  // Prefill tab Tổng hợp KK với các vị trí đang chứa mã đã chọn (không API write — luồng kiểm sẵn có)
  function startCount() {
    if (!selLocIds.length || selLocIds.length > LOC_ID_CAP) return
    setSummary({ warehouseId: f.warehouseId, category: '', locationIds: selLocIds, requiresOnly: false, view: 'all', page: 1 })
    navigate('/wms/stocktake/summary')
  }

  const s = data?.summary
  return (
    <div className="flex flex-col h-full sm:p-3">
      <StocktakeTabs />
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
              <RotateCcw className="h-4 w-4 text-sky-600" /> Luân phiên ABC
            </h1>
            <SearchInput value={f.search} onChange={v => setF({ search: v })} placeholder="Tìm mã / tên hàng…" className="flex-1 min-w-[120px]" />
            <span className="sm:hidden"><FilterSheetButton defs={filterDefs} /></span>
            {sel.size > 0 && (
              <Button size="sm" className="h-9 sm:h-7 text-[11px]"
                disabled={!selLocIds.length || selLocIds.length > LOC_ID_CAP}
                title={selLocIds.length > LOC_ID_CAP
                  ? `Quá ${LOC_ID_CAP} vị trí — bỏ bớt mã (đang ${selLocIds.length})`
                  : 'Mở Tổng hợp KK với đúng các vị trí đang chứa những mã này'}
                onClick={startCount}>
                <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Kiểm {sel.size} mã ({selLocIds.length} vị trí)
              </Button>
            )}
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        <SummaryBand tiles={[
          { label: 'Đến hạn kiểm', value: nf(s?.due ?? 0), accent: (s?.due ?? 0) > 0 },
          { label: 'Hạng A / B / C đến hạn', value: `${nf(s?.due_a ?? 0)} / ${nf(s?.due_b ?? 0)} / ${nf(s?.due_c ?? 0)}` },
          { label: 'Chưa kiểm lần nào', value: nf(s?.never ?? 0) },
          { label: 'Tổng mã có tồn', value: nf(s?.total ?? 0) },
        ]} />

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
            style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.id === 'sel' ? (
                      <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={allSel}
                        onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.material_id)) : new Set())} />
                    ) : c.label}
                    <span onPointerDown={e => startResize(i, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!f.warehouseId ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center py-8 text-xs text-slate-400">Chọn KHO để xem đề xuất kiểm kê luân phiên</TableCell></TableRow>
              ) : isLoading ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center py-8 text-xs text-slate-400">Đang tính hạng ABC + tra lịch sử kiểm…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center py-8 text-xs text-slate-400">
                  {f.dueOnly ? 'Không có mã nào đến hạn kiểm 🎉 (bỏ lọc "Chỉ mã đến hạn" để xem tất cả)' : 'Không có mã nào khớp bộ lọc'}
                </TableCell></TableRow>
              ) : rows.map(r => {
                const picked = sel.has(r.material_id)
                const due = dueLabel(r)
                return (
                  <TableRow key={r.material_id} className={`cursor-pointer ${rowText(cycleKey(r))} ${picked ? 'bg-sky-50' : ''}`}
                    onClick={() => setSel(prev => {
                      const n = new Set(prev)
                      if (n.has(r.material_id)) n.delete(r.material_id); else n.add(r.material_id)
                      return n
                    })}>
                    <TableCell className={`px-2 py-1 sticky left-0 z-10 ${picked ? 'bg-sky-50' : 'bg-white'}`}>
                      <input type="checkbox" readOnly checked={picked} className="h-3 w-3 cursor-pointer" />
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${ABC_BADGE[r.abc]}`}>{r.abc}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{r.material_code}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.short_name ?? ''}>{r.short_name ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">{r.category ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${due.cls}`}>{due.text}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                      {r.last_counted_at
                        ? <>{formatTimestampDate(r.last_counted_at, true)} <span className="text-slate-400">({nf(r.days_since ?? 0)} ngày)</span></>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{nf(r.cycle_days)} ngày</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{nf(r.picks)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold">{nf(r.stock_pallets)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono truncate"
                      title={r.loc_codes.join(', ')}>
                      {r.loc_codes.length
                        ? <>{r.loc_codes.join(', ')}{r.loc_ids.length > r.loc_codes.length && <span className="text-slate-400"> +{r.loc_ids.length - r.loc_codes.length}</span>}</>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">
          1–{rows.length} / {data?.summary.total ?? 0} mã có tồn · hạng ABC theo lượt nhặt {data?.window_days ?? 30} ngày (engine Slotting) · chu kỳ A {data?.cycle_days.A ?? 7} / B {data?.cycle_days.B ?? 30} / C {data?.cycle_days.C ?? 90} ngày
        </div>
      </div>
    </div>
  )
}
