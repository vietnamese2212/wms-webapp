// VIỆC CẦN LÀM (Directed Work đợt 1c, user chốt 10/09/2026) — 3 vai nhìn 3 bảng trên CÙNG kế hoạch:
//   Cần hạ    — lái xe nâng HẠ, TOÀN KHO, có thứ tự (xe đứng bãi chỉ chờ hạ được ưu tiên lên đầu)
//   Cần đưa ra— lái xe nâng CHUYỂN, mặc định lọc "của tôi"; thấy VỊ TRÍ HIỆN TẠI của pallet kể cả
//               đang trên kệ (user 10/09: "cần xem được vị trí hiện tại của pallet cần lấy")
//   Sắp quét  — thủ kho, theo chuyến, TỪNG pallet (quét theo tem)
//
// Hai luật hình thức user chốt, đừng đổi khi sửa sau:
//   • "không cần chỉ dẫn bằng văn xuôi, đưa vào TABLE" ⇒ mỗi việc là một DÒNG, không phải câu chữ.
//   • việc xong thì GẠCH NGANG và VẪN Ở LẠI bảng tới khi chuyến kết thúc ("phòng tình huống bị
//     quên") — có chip "Ẩn việc đã xong" cho ai muốn nhìn gọn, mặc định HIỆN.
import { useMemo } from 'react'
import { ListChecks, ArrowDownToLine, Truck, ScanLine, Check } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { useDirectedBoard, useConfirmTasks } from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampTime } from '@/utils/formatters'
import type { DirectedRow } from '@/types'

const nf = (n: number) => n.toLocaleString('vi-VN')

type Tab = 'LOWER' | 'MOVE' | 'SCAN'
const TABS: { key: Tab; label: string; icon: typeof Truck; hint: string }[] = [
  { key: 'LOWER', label: 'Cần hạ',     icon: ArrowDownToLine, hint: 'Xe nâng hạ — toàn kho, làm từ trên xuống' },
  { key: 'MOVE',  label: 'Cần đưa ra', icon: Truck,           hint: 'Xe nâng chuyển — đưa hàng ra cửa / vị trí nhặt lẻ' },
  { key: 'SCAN',  label: 'Sắp quét',   icon: ScanLine,        hint: 'Thủ kho — từng pallet theo thứ tự quét' },
]

// Cột theo TAB: xe hạ và xe chuyển cần thông tin khác nhau, đừng nhồi một bảng cho cả hai
const COLS: Record<Tab, { id: string; label: string; w: number; align?: 'right' }[]> = {
  LOWER: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'trip', label: 'Chuyến · Cửa',   w: 150 },
    { id: 'loc',  label: 'Vị trí',         w: 150 },
    { id: 'lvl',  label: 'Tầng',           w: 52,  align: 'right' },
    { id: 'qty',  label: 'Hạ',             w: 150 },
    { id: 'dist', label: 'Quãng đường',    w: 90,  align: 'right' },
    { id: 'to',   label: 'Đặt xuống',      w: 140 },
    { id: 'act',  label: '',               w: 96 },
  ],
  MOVE: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'trip', label: 'Chuyến · Cửa',   w: 150 },
    { id: 'cur',  label: 'Vị trí hiện tại', w: 160 },
    { id: 'st',   label: 'Trạng thái',     w: 130 },
    { id: 'qty',  label: 'Đưa',            w: 150 },
    { id: 'to',   label: 'Tới',            w: 140 },
    { id: 'act',  label: '',               w: 96 },
  ],
  SCAN: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'pal',  label: 'Tem pallet',     w: 190 },
    { id: 'cur',  label: 'Vị trí hiện tại', w: 160 },
    { id: 'st',   label: 'Trạng thái',     w: 150 },
    { id: 'qty',  label: 'Lấy',            w: 150 },
    { id: 'to',   label: 'Tới',            w: 140 },
  ],
}

/** Trạng thái một dòng — chữ ngắn, đọc lướt được trên PDA. */
function stateOf(r: DirectedRow, tab: Tab): { text: string; cls: string } {
  if (r.all_scanned) return { text: `✓ quét đủ${r.last_at ? ` ${formatTimestampTime(r.last_at)}` : ''}`, cls: 'text-green-600' }
  if (r.stage_done) return {
    text: `✓ ${tab === 'LOWER' ? 'đã hạ' : 'đã đưa ra'}${r.last_at ? ` ${formatTimestampTime(r.last_at)}` : ''}${r.done_by_name ? ` · ${r.done_by_name}` : ''}`,
    cls: 'text-green-600',
  }
  if (r.waiting_lower) return { text: '⏳ chờ xe hạ', cls: 'text-amber-600' }
  if (r.needs_lower) return { text: 'cần hạ xuống', cls: 'text-slate-500' }
  return { text: 'lấy trực tiếp', cls: 'text-slate-500' }
}

export default function DirectedWork() {
  const f = useWmsFilterStore(s => s.directedWork)
  const setF = useWmsFilterStore(s => s.setDirectedWork)
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canConfirm = can(perms, 'directed_work', 'confirm')
  const { data: whs } = useScopedWarehouses(true)
  const tab = f.tab as Tab
  const { widths: colW, startResize, totalWidth } = useColumnResize(`directed_${tab.toLowerCase()}_col_widths`, COLS[tab].map(c => c.w))

  const confirmTasks = useConfirmTasks()
  const { data, isLoading } = useDirectedBoard(f.warehouseId, tab, {
    gdoId: tab === 'SCAN' ? (f.gdoId || null) : null,
    // "Của tôi" chỉ có nghĩa ở bảng xe chuyển (việc gắn theo người được giao lúc Bắt đầu)
    driverId: tab === 'MOVE' && f.mine ? (user?.id ?? null) : null,
  })

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    return f.hideDone ? all.filter(r => !r.stage_done) : all
  }, [data, f.hideDone])

  // Chuyến để chọn ở bảng Sắp quét — lấy từ chính việc đang có, không gọi thêm API
  const { data: allTrips } = useDirectedBoard(f.warehouseId, 'MOVE', { enabled: tab === 'SCAN' })
  const tripOpts = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of allTrips?.rows ?? []) m.set(r.gdo_id, `${r.group_code ?? r.gdo_id}${r.license_plate ? ` · ${r.license_plate}` : ''}`)
    return [...m].map(([value, label]) => ({ value, label }))
  }, [allTrips])

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', pinned: true, allLabel: 'Chọn kho…',
      options: (whs ?? []).map(w => ({ value: (w as { id: string }).id, label: (w as { id: string; name?: string }).name ?? '' })),
      value: f.warehouseId, onChange: (v: string) => setF({ warehouseId: v, gdoId: '' }) },
    ...(tab === 'SCAN' ? [{
      key: 'trip', label: 'Chuyến', type: 'single' as const, pinned: true, allLabel: 'Chọn chuyến…',
      options: tripOpts, value: f.gdoId, onChange: (v: string) => setF({ gdoId: v }),
    }] : []),
    ...(tab === 'MOVE' ? [{
      key: 'mine', label: 'Phạm vi', type: 'single' as const, pinned: true, allLabel: 'Của tôi (mặc định)',
      options: [{ value: 'all', label: 'Tất cả việc trong kho' }],
      value: f.mine ? '' : 'all', onChange: (v: string) => setF({ mine: v !== 'all' }),
    }] : []),
    { key: 'done', label: 'Việc đã xong', type: 'single', allLabel: 'Hiện (mặc định — để đối chiếu)',
      options: [{ value: 'hide', label: 'Ẩn việc đã xong' }],
      value: f.hideDone ? 'hide' : '', onChange: (v: string) => setF({ hideDone: v === 'hide' }) },
  ]

  const t = data?.totals ?? {}
  const unset = data?.unset_items ?? []

  function doConfirm(r: DirectedRow, undo: boolean) {
    if (tab === 'SCAN') return
    confirmTasks.mutate({ task_ids: r.task_ids, stage: tab, undo })
  }

  const cols = COLS[tab]
  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="hidden sm:flex text-sm font-semibold text-slate-800 items-center gap-1.5 shrink-0">
              <ListChecks className="h-4 w-4 text-sky-600" /> Việc cần làm
            </h1>
            {/* Tab = 3 VAI. Để nút to trên mobile: người bấm đang đeo găng, đứng giữa kho */}
            <div className="flex items-center gap-1 flex-1 min-w-0">
              {TABS.map(x => (
                <button key={x.key} onClick={() => setF({ tab: x.key })} title={x.hint}
                  className={`flex items-center gap-1 rounded-md px-2.5 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${
                    tab === x.key ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  <x.icon className="h-3.5 w-3.5" /> {x.label}
                </button>
              ))}
            </div>
            <span className="sm:hidden"><FilterSheetButton defs={filterDefs} /></span>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        <SummaryBand tiles={[
          { label: 'Việc còn lại', value: nf(t.pending ?? 0), accent: (t.pending ?? 0) > 0 },
          { label: 'Chờ hạ',       value: nf(t.to_lower ?? 0) },
          { label: 'Chờ đưa ra',   value: nf(t.to_move ?? 0) },
          { label: 'Đã xong',      value: nf(t.done ?? 0) },
          { label: 'Chuyến',       value: nf(t.trips ?? 0) },
        ]} />

        {/* Dòng CHƯA CHỐT %Date: không có việc nào — phải nói ra, không im lặng để người ta tưởng
            hàng đã được chia (user chốt: "trong nghĩ là mặc định đi làm, sau đó mới update thì sẽ là làm sai") */}
        {unset.length > 0 && (
          <div className="shrink-0 border-b bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
            <b>{unset.length} dòng hàng chưa chốt %Date</b> — chưa có việc nào được giao. Mở chuyến rồi bấm
            “Chốt %Date” để hệ thống chia hàng: {unset.slice(0, 4).map(u => `${u.group_code ?? ''} · ${u.material_code ?? ''}`).join(' · ')}
            {unset.length > 4 ? ` … và ${unset.length - 4} dòng nữa` : ''}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
            style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {cols.map((c, i) => (
                  <TableHead key={c.id}
                    className={`relative text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    <span onPointerDown={e => startResize(i, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={cols.length} className="px-2 py-6 text-center text-[11px] text-slate-400">Đang tải…</TableCell></TableRow>}
              {!isLoading && !f.warehouseId && <TableRow><TableCell colSpan={cols.length} className="px-2 py-6 text-center text-[11px] text-slate-400">Chọn kho để xem việc cần làm</TableCell></TableRow>}
              {!isLoading && f.warehouseId && tab === 'SCAN' && !f.gdoId && <TableRow><TableCell colSpan={cols.length} className="px-2 py-6 text-center text-[11px] text-slate-400">Chọn chuyến để xem thứ tự quét</TableCell></TableRow>}
              {!isLoading && f.warehouseId && rows.length === 0 && (tab !== 'SCAN' || f.gdoId) && (
                <TableRow><TableCell colSpan={cols.length} className="px-2 py-6 text-center text-[11px] text-slate-400">
                  Không có việc nào — kho chạy chế độ Thủ công, hoặc chưa chuyến nào Bắt đầu, hoặc dòng hàng chưa chốt %Date
                </TableCell></TableRow>
              )}
              {rows.map((r, idx) => {
                const st = stateOf(r, tab)
                // Xong = GẠCH NGANG + xám, vẫn ở lại bảng (user chốt "phòng bị quên")
                const dim = r.stage_done ? 'text-slate-400 line-through' : ''
                const first = idx === 0 && !r.stage_done
                return (
                  <TableRow key={r.group_key} className={`${dim} ${first ? 'bg-sky-50' : ''}`}>
                    <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums sticky left-0 z-10 ${first ? 'bg-sky-50' : 'bg-white'}`}>
                      {r.seq}
                    </TableCell>

                    {tab !== 'SCAN' && (
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                        <div className="font-mono font-semibold">{r.license_plate ?? r.group_code ?? '—'}</div>
                        <div className="text-[9px] text-slate-400">{r.dock_name ?? '—'}</div>
                      </TableCell>
                    )}
                    {tab === 'SCAN' && (
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">
                        {r.pallet_codes?.[0] ?? '—'}
                      </TableCell>
                    )}

                    {tab === 'LOWER' ? (
                      <>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono">{r.from_code ?? <span className="text-slate-300">chưa có trên bản vẽ</span>}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{r.level_no ?? '—'}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                          <span className="font-mono">{r.current_code ?? <span className="text-slate-300">chưa có trên bản vẽ</span>}</span>
                          {r.level_no != null && r.level_no > 1 && !r.stage_done && <span className="text-[9px] text-slate-400"> · tầng {r.level_no}</span>}
                        </TableCell>
                        <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap ${r.stage_done ? '' : st.cls}`}>{st.text}</TableCell>
                      </>
                    )}

                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      <span className="font-semibold tabular-nums">{nf(r.n_pallets)}</span> <span className="text-slate-400">pallet</span>
                      <span className="text-[9px] text-slate-400"> · {r.material_codes?.filter(Boolean).join(', ') || '—'}</span>
                    </TableCell>

                    {tab === 'LOWER' && (
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                        {r.dist_cells != null ? `${nf(r.dist_cells)} ô` : <span className="text-slate-300">—</span>}
                      </TableCell>
                    )}

                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {tab === 'LOWER'
                        ? (r.drop_name ?? r.to_name ?? <span className="text-slate-300">—</span>)
                        : (r.to_name ?? r.to_code ?? <span className="text-slate-300">—</span>)}
                      {r.kind === 'LOOSE_FEED' && <span className="ml-1 text-[9px] text-purple-600">nhặt lẻ</span>}
                    </TableCell>

                    {tab !== 'SCAN' && (
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        {canConfirm && (r.can_confirm || r.stage_done) && !r.all_scanned && (
                          <Button size="sm" variant={r.stage_done ? 'outline' : 'default'}
                            className="h-7 px-2 text-[10px]"
                            disabled={confirmTasks.isPending}
                            title={r.stage_done ? 'Bấm lại để bỏ đánh dấu (bấm nhầm)' : 'Xác nhận đã làm xong việc này'}
                            onClick={() => doConfirm(r, r.stage_done)}>
                            <Check className="h-3.5 w-3.5 mr-0.5" /> {r.stage_done ? 'Bỏ' : 'Xong'}
                          </Button>
                        )}
                        {!canConfirm && !r.stage_done && <span className="text-[9px] text-slate-300">—</span>}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        <div className="shrink-0 border-t bg-white px-3 py-1.5 text-[10px] text-slate-500 flex items-center gap-3 sm:rounded-b-xl">
          <span>{nf(rows.length)} dòng việc</span>
          {(t.pending ?? 0) > 0 && <span className="text-slate-400">· còn {nf(t.pending ?? 0)} việc chưa xong</span>}
          {confirmTasks.isError && <span className="text-red-600">· {(confirmTasks.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không ghi được — thử lại'}</span>}
          {confirmTasks.data?.moved_pallets ? <span className="text-green-600">· đã chuyển {confirmTasks.data.moved_pallets} pallet về vị trí nhặt lẻ</span> : null}
        </div>
      </div>
    </div>
  )
}
