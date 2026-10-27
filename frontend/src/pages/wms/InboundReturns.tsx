// TRANG "HÀNG TRẢ VỀ" (26/10 tối, user: "làm sao tôi có thống kê được lượng hàng trả về — thi thoảng có các đợt trả hàng về, tôi cần
// follow theo nó"). Mỗi dòng một PHIẾU trả: phiếu RT kho lập (theo chuyến gốc / lập tay) HOẶC một chuyến NPP chuyển về (NPP dùng app
// tạo đơn xuất về kho chính ⇒ phiếu nhận chuyển kho). Lọc theo ngày · kho · dạng · lý do · ĐỢT THU HỒI; dải tổng tính bằng SQL trên
// TOÀN BỘ bộ lọc (RPC inbound_return_report). Đợt thu hồi duyệt NGOÀI app — người có quyền tạo mã đợt ở nút "Đợt thu hồi"; xem đợt
// đã thu được gì theo mã / theo khách. Số cộng nhiều mã = thùng QUY ĐỔI từng mã (luật base unit).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { Flag, FileDown, Plus, AlignJustify, Rows3 } from 'lucide-react'
import { SavedViews } from '@/components/shared/SavedViews'
import { useSavedViewsStore } from '@/stores/savedViewsStore'
import { rowText } from '@/lib/rowStatus'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter, PagerNav } from '@/components/shared/ListPager'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { FormSheet } from '@/components/shared/FormSheet'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useReturnReport, useReturnReasons, useRecalls, useSaveRecall, useRecallBreakdown, returnReasonLabel, type RecallRow } from '@/api/hooks'
import { QTY_CONVERTED_LABEL, QTY_CONVERTED_TIP, qtyLabel, type MatUnits } from '@/utils/qtyUnits'
import { formatDate, formatTimestampDate } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeRows } from '@/utils/excelSafe'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const nf = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const COLS: RtColDef[] = [
  { id: 'day', label: 'Ngày', w: 78 }, { id: 'kind', label: 'Dạng', w: 70 }, { id: 'code', label: 'Số phiếu', w: 170 },
  { id: 'trip', label: 'Chuyến gốc', w: 150 }, { id: 'party', label: 'Khách / NPP', w: 190 }, { id: 'reason', label: 'Lý do', w: 140 },
  { id: 'recall', label: 'Đợt', w: 110 }, { id: 'nmat', label: 'Số mã', w: 56, align: 'right' },
  { id: 'declared', label: 'Khai (quy đổi)', w: 96, align: 'right' }, { id: 'received', label: 'Thực nhận (quy đổi)', w: 120, align: 'right' },
  { id: 'surplus', label: 'Thừa', w: 70, align: 'right' }, { id: 'held', label: 'Giữ QA', w: 64, align: 'right' },
  { id: 'status', label: 'Trạng thái', w: 90 }, { id: 'by', label: 'Người lập', w: 130 },
]
const KIND_VI: Record<string, string> = { RT: 'RT (kho lập)', NPP: 'NPP chuyển về' }

export default function InboundReturns() {
  const navigate = useNavigate()
  const f = useWmsFilterStore(s => s.inboundReturns)
  const setF = useWmsFilterStore(s => s.setInboundReturns)
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canExport = can(perms, 'inbound', 'export')
  const { data: warehouses = [] } = useScopedWarehouses(true)
  const { data: reasons = [] } = useReturnReasons()
  const { data: recalls = [] } = useRecalls()
  const search = useDebouncedValue(f.search.trim(), 300)
  const params = useMemo(() => ({
    warehouse_id: f.warehouseId || undefined, date_from: f.dateFrom || undefined, date_to: f.dateTo || undefined,
    kind: (f.kind || undefined) as 'RT' | 'NPP' | undefined, reason: f.reason || undefined, recall_id: f.recallId || undefined, search: search || undefined,
  }), [f.warehouseId, f.dateFrom, f.dateTo, f.kind, f.reason, f.recallId, search])
  const q = useReturnReport(params)
  const rows = q.data?.rows ?? []
  const sum = q.data?.summary
  const total = q.data?.total ?? 0
  const page = f.page || 1, pageSize = f.pageSize || 100
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => { if (!q.isLoading && rows.length > 0 && page > totalPages) setF({ page: totalPages }) }, [q.isLoading, rows.length, page, totalPages, setF])
  const shown = rows.slice((page - 1) * pageSize, page * pageSize)
  const [recallOpen, setRecallOpen] = useState(false)
  const whName = (id: string | null) => (warehouses as { id: string; name: string }[]).find(w => w.id === id)?.name ?? ''
  const recallCode = (id: string | null) => recalls.find(r => r.id === id)?.code ?? ''

  const defs: FilterDef[] = [
    { key: 'date', label: 'Ngày', type: 'daterange', from: f.dateFrom, to: f.dateTo, onChange: (a, b) => setF({ dateFrom: a, dateTo: b, page: 1 }), pinned: true },
    // single: '' = tất cả (hợp đồng FilterBar)
    { key: 'wh', label: 'Kho', type: 'single', options: (warehouses as { id: string; name: string }[]).map(w => ({ value: w.id, label: w.name })), value: f.warehouseId, onChange: v => setF({ warehouseId: v, page: 1 }) },
    { key: 'kind', label: 'Dạng', type: 'single', options: [{ value: 'RT', label: KIND_VI.RT }, { value: 'NPP', label: KIND_VI.NPP }], value: f.kind, onChange: v => setF({ kind: v, page: 1 }) },
    { key: 'reason', label: 'Lý do', type: 'single', options: [...reasons.map(r => ({ value: r.value, label: r.meta?.label?.trim() || r.value })), { value: '__NONE__', label: 'Chưa gắn lý do' }], value: f.reason, onChange: v => setF({ reason: v, page: 1 }) },
    { key: 'recall', label: 'Đợt thu hồi', type: 'single', options: recalls.map(r => ({ value: r.id, label: `${r.code}${r.status === 'CLOSED' ? ' (đã đóng)' : ''}` })), value: f.recallId, onChange: v => setF({ recallId: v, page: 1 }), pinned: true },
  ]

  function exportExcel() {
    const sheet = rows.map(r => ({
      'Ngày': r.day, 'Dạng': KIND_VI[r.kind] ?? r.kind, 'Số phiếu': r.code, 'Chuyến gốc': r.trip ?? '', 'Kho': whName(r.warehouse_id), 'Khách / NPP': r.party ?? '',
      'Lý do': r.reason_code ? returnReasonLabel(reasons, r.reason_code) : '', 'Ghi chú': r.note ?? '', 'Đợt': recallCode(r.recall_id), 'Số mã': r.n_mat,
      'Khai (quy đổi)': Number(r.declared), 'Thực nhận (quy đổi)': Number(r.received), 'Thừa (quy đổi)': Number(r.surplus), 'Pallet giữ QA': Number(r.held_pallets),
      'Trạng thái': r.done ? 'Xong' : 'Đang nhận', 'Người lập': r.by_name ?? '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sanitizeRows(sheet)), 'Hàng trả về')
    void saveWorkbook(wb, `hang_tra_ve_${f.dateFrom || 'all'}_${f.dateTo || ''}.xlsx`)
  }

  const recallSel = recalls.find(r => r.id === f.recallId) ?? null
  // Views + mật độ dòng — cùng khuôn trang Nhập kho
  const viewSnapshot = { search: f.search, warehouseId: f.warehouseId, dateFrom: f.dateFrom, dateTo: f.dateTo, kind: f.kind, reason: f.reason, recallId: f.recallId }
  const savedViews = useSavedViewsStore(s => s.views['inbound_returns'] ?? [])
  const activeViewId = savedViews.find(v => JSON.stringify(v.filters) === JSON.stringify(viewSnapshot))?.id ?? null
  const [dense, setDense] = useState(() => { try { return localStorage.getItem('inbound_returns_density') !== 'comfortable' } catch { return true } })
  const toggleDensity = () => setDense(d => { try { localStorage.setItem('inbound_returns_density', d ? 'comfortable' : 'compact') } catch { /* bộ nhớ trình duyệt bị chặn */ } return !d })
  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap xl:flex-nowrap">
            <span className="hidden sm:inline text-sm font-semibold text-slate-700 shrink-0">Hàng trả về</span>
            <SearchInput value={f.search} onChange={v => setF({ search: v, page: 1 })} placeholder="Tìm số phiếu, chuyến, khách / NPP…" className="flex-1 min-w-[160px]" />
            <FilterSheetButton defs={defs} className="sm:hidden" />
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <SavedViews module="inbound_returns" currentFilters={viewSnapshot} activeId={activeViewId}
              onApply={v => setF({ ...(v as Partial<typeof f>), page: 1 })} />
            <button type="button" onClick={toggleDensity}
              className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
              title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
              {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
            </button>
            <ActionCluster className="shrink-0" mobileInline items={[
              { key: 'recall', icon: Flag, label: 'Đợt thu hồi', tip: 'Danh sách mã đợt thu hồi — tạo / đóng đợt (người có quyền), xem đợt đã thu được gì', primary: true, variant: 'default', onClick: () => setRecallOpen(true) },
              ...(canExport ? [{ key: 'xlsx', icon: FileDown, label: 'Xuất Excel', tip: `Xuất ${rows.length} phiếu đang lọc ra Excel`, onClick: exportExcel, disabled: !rows.length, mobileHidden: true } satisfies ActionItem] : []),
            ] satisfies ActionItem[]} />
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={defs} /></div>
        </div>
        {recallSel && <RecallStrip recall={recallSel} />}
        {/* RT / NPP tách theo bộ lọc "Dạng" — dải giữ 7 ô để nhãn không bị cắt ở 1280 */}
        <SummaryBand tiles={[
          { label: 'Phiếu', value: nf(sum?.phieu), tip: `${nf(sum?.rt)} phiếu RT (kho lập) · ${nf(sum?.npp)} chuyến NPP chuyển về` },
          { label: 'Khai', value: nf(sum?.declared), tip: `${QTY_CONVERTED_LABEL} — ${QTY_CONVERTED_TIP}` },
          { label: 'Thực nhận', value: nf(sum?.received), tip: `${QTY_CONVERTED_LABEL} — ${QTY_CONVERTED_TIP}` },
          { label: 'Thừa', value: nf(sum?.surplus), tip: `${QTY_CONVERTED_LABEL} — nhận vượt số tem đã xuất trên chuyến gốc; chuyến chỉ tính trả về tới số đã xuất` },
          { label: 'Giữ QA', value: nf(sum?.held_pallets), tip: 'Số pallet của phiếu trả đang giữ QA (chưa xuất được)' },
          { label: 'Đang nhận', value: nf(sum?.open) },
          { label: 'Chưa lý do', value: nf(sum?.no_reason), danger: Number(sum?.no_reason ?? 0) > 0, tip: 'Thường là hàng NPP chuyển về chưa gắn — mở phiếu để gắn lý do / đợt' },
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <ResizableTable storageKey="inbound_returns_cols_v1" cols={COLS}>
            <TableBody>
              {q.isError && <TableEmptyRow colSpan={COLS.length}><span className="text-red-600">{apiMsg(q.error)}</span></TableEmptyRow>}
              {!q.isError && q.isLoading && !rows.length && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
              {!q.isError && !q.isLoading && !rows.length && <TableEmptyRow colSpan={COLS.length}>Không có phiếu trả về nào trong khoảng đang lọc.</TableEmptyRow>}
              {shown.map(r => (
                <TableRow key={`${r.kind}-${r.id}`} className={`cursor-pointer ${rowText(r.done ? 'completed' : 'inProgress')} ${dense ? '' : '[&_td]:py-2.5'}`}
                  onClick={() => r.first_import && navigate(`/wms/inbound/${r.first_import}`)} title="Mở phiếu nhập">
                  <TableCell className={`${TD} sticky left-0 z-10 bg-white tabular-nums`}>{formatDate(r.day)}</TableCell>
                  <TableCell className={TD}><StatusBadge tone={r.kind === 'RT' ? 'slate' : 'purple'}>{r.kind === 'RT' ? 'RT' : 'NPP'}</StatusBadge></TableCell>
                  <TableCell className={`${TD} font-mono font-semibold`}>{r.code}</TableCell>
                  <TableCell className={`${TD} font-mono`}>{r.trip ?? <span className="text-slate-400 italic font-sans">lập tay</span>}</TableCell>
                  <TableCell className={`${TD} truncate`} title={r.party ?? ''}>{r.party ?? '—'}</TableCell>
                  <TableCell className={`${TD} truncate`} title={r.note ?? ''}>{r.reason_code ? returnReasonLabel(reasons, r.reason_code) : <span className="text-amber-700">chưa gắn</span>}</TableCell>
                  <TableCell className={`${TD} font-mono`}>{recallCode(r.recall_id) || <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={NUM}>{r.n_mat}</TableCell>
                  <TableCell className={NUM}>{nf(r.declared)}</TableCell>
                  <TableCell className={NUM}>{nf(r.received)}</TableCell>
                  <TableCell className={NUM}>{Number(r.surplus) > 0 ? <span className="text-amber-700">{nf(r.surplus)}</span> : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                  <TableCell className={NUM}>{Number(r.held_pallets) > 0 ? <span className="text-red-600">{nf(r.held_pallets)}</span> : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                  <TableCell className={TD}>{r.done ? <StatusBadge tone="blue">Xong</StatusBadge> : <StatusBadge tone="amber">Đang nhận</StatusBadge>}</TableCell>
                  <TableCell className={`${TD} truncate`}>{r.by_name ?? <span className="text-slate-300">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ResizableTable>
          <PagerNav page={page} totalPages={totalPages} onPage={p => setF({ page: p })} />
        </div>
        <ListFooter page={page} pageSize={pageSize} total={rows.length} unit="phiếu" onPageSize={n => setF({ pageSize: n, page: 1 })}
          right={total > rows.length ? `chỉ hiện ${rows.length} / ${total} phiếu mới nhất — thu hẹp khoảng ngày để xem hết` : undefined} />
      </div>
      <RecallSheet open={recallOpen} onClose={() => setRecallOpen(false)} onFilter={id => { setF({ recallId: id, page: 1, dateFrom: '', dateTo: '' }); setRecallOpen(false) }} />
    </div>
  )
}

/** Dải ngay trên dải tổng khi đang lọc MỘT đợt: đợt đã thu được gì theo MÃ (N thùng + M hộp) — trọn đợt, không theo ngày lọc. */
function RecallStrip({ recall }: { recall: RecallRow }) {
  const b = useRecallBreakdown(recall.id)
  const mats = b.data?.by_material ?? []
  return (
    <div className="shrink-0 border-b bg-rose-50/60 px-3 py-1 text-[10px] flex flex-wrap items-center gap-x-3 gap-y-0.5" data-recall-strip>
      <span className="font-semibold text-rose-700 inline-flex items-center gap-1"><Flag className="h-3 w-3" />Đợt {recall.code}</span>
      {recall.name && <span className="text-slate-600">{recall.name}</span>}
      <StatusBadge tone={recall.status === 'OPEN' ? 'green' : 'slate'}>{recall.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'}</StatusBadge>
      <span className="text-slate-500">Đã thu cả đợt:</span>
      {!mats.length && <span className="text-slate-400">{b.isLoading ? 'đang tính…' : 'chưa có'}</span>}
      {mats.map(m => (
        <span key={m.material_id} className="text-slate-700" title={m.short_name ?? ''}>
          <span className="font-mono font-semibold">{m.material_code}</span> {qtyLabel(Number(m.qty_base), m as MatUnits)} <span className="text-slate-400">({m.phieu} phiếu)</span>
        </span>
      ))}
    </div>
  )
}

/** Danh sách mã đợt thu hồi: tạo / đóng / mở lại (quyền inbound.recall_manage) · xem đợt đã thu theo khách + theo mã · lọc danh sách. */
function RecallSheet({ open, onClose, onFilter }: { open: boolean; onClose: () => void; onFilter: (id: string) => void }) {
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canManage = can(perms, 'inbound', 'recall_manage')
  const { data: recalls = [], isLoading } = useRecalls()
  const save = useSaveRecall()
  const [form, setForm] = useState<{ code: string; name: string; note: string } | null>(null)
  const [view, setView] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const b = useRecallBreakdown(view)
  useEffect(() => { if (open) { setForm(null); setView(null); setErr('') } }, [open])

  async function create() {
    if (!form) return
    setErr('')
    try { await save.mutateAsync({ code: form.code.trim(), name: form.name.trim() || undefined, note: form.note.trim() || undefined }); setForm(null) }
    catch (e) { setErr(apiMsg(e)) }
  }
  async function toggle(r: RecallRow) {
    setErr('')
    try { await save.mutateAsync({ id: r.id, status: r.status === 'OPEN' ? 'CLOSED' : 'OPEN' }) } catch (e) { setErr(apiMsg(e)) }
  }
  const qtyBy = new Map((b.data?.by_material ?? []).map(m => [m.material_id, m]))
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-3xl"
      title="Đợt thu hồi"
      description="Đợt duyệt ngoài app; người có quyền tạo MÃ ĐỢT ở đây. Phiếu trả chọn lý do bắt đợt (vd Thu hồi) phải chọn một đợt đang mở."
      footer={<Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>}>
      <div className="space-y-3 text-xs">
        {canManage && !form && <Button size="sm" className="h-8" onClick={() => setForm({ code: '', name: '', note: '' })}><Plus className="h-3.5 w-3.5 mr-1" />Tạo mã đợt</Button>}
        {form && (
          <div className="rounded-lg border border-slate-200 p-2 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><Label className="text-xs">Mã đợt *</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={60} placeholder="TH-SPB-1026" className="h-8 mt-0.5 font-mono text-xs" /></div>
              <div><Label className="text-xs">Tên đợt</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={200} placeholder="Thu hồi SP B hết hạn" className="h-8 mt-0.5 text-xs" /></div>
            </div>
            <div><Label className="text-xs">Ghi chú (số văn bản duyệt…)</Label><Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} maxLength={500} className="h-8 mt-0.5 text-xs" /></div>
            <div className="flex gap-1.5">
              <Button size="sm" className="h-8" disabled={!form.code.trim() || save.isPending} onClick={() => void create()}>{save.isPending ? 'Đang lưu…' : 'Tạo'}</Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => setForm(null)}>Huỷ</Button>
            </div>
          </div>
        )}
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{err}</div>}
        <div className="overflow-auto border rounded-lg">
          <table className="w-full">
            <thead><tr className="bg-slate-50 text-[9px] text-slate-500">
              <th className="px-2 py-1 text-left whitespace-nowrap">Mã đợt</th><th className="px-2 py-1 text-left whitespace-nowrap">Tên</th>
              <th className="px-2 py-1 text-left whitespace-nowrap">Trạng thái</th><th className="px-2 py-1 text-left whitespace-nowrap">Tạo</th><th className="px-2 py-1" />
            </tr></thead>
            <tbody>
              {!recalls.length && <tr><td colSpan={5} className={`${TD} text-slate-400`}>{isLoading ? 'Đang tải…' : 'Chưa có đợt nào'}</td></tr>}
              {recalls.map(r => (
                <tr key={r.id} className={`border-t border-slate-100 ${view === r.id ? 'bg-sky-50' : ''}`}>
                  <td className={`${TD} font-mono font-semibold`}>{r.code}</td>
                  <td className={`${TD} max-w-[200px] truncate`} title={`${r.name ?? ''}${r.note ? ` · ${r.note}` : ''}`}>{r.name ?? '—'}</td>
                  <td className={TD}><StatusBadge tone={r.status === 'OPEN' ? 'green' : 'slate'}>{r.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'}</StatusBadge></td>
                  <td className={`${TD} text-slate-500`}>{r.created_by_name ?? ''} · {formatTimestampDate(r.created_at, true)}</td>
                  <td className={`${TD} text-right`}>
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setView(view === r.id ? null : r.id)}>{view === r.id ? 'Ẩn' : 'Xem'}</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onFilter(r.id)}>Lọc phiếu</Button>
                      {canManage && <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={save.isPending} onClick={() => void toggle(r)}>{r.status === 'OPEN' ? 'Đóng đợt' : 'Mở lại'}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {view && (
          <div className="space-y-2" data-recall-breakdown>
            <div className="font-semibold text-slate-700">Đã thu theo mã</div>
            <div className="overflow-auto border rounded-lg"><table className="w-full">
              <thead><tr className="bg-slate-50 text-[9px] text-slate-500"><th className="px-2 py-1 text-left">Mã</th><th className="px-2 py-1 text-left">Tên hàng</th><th className="px-2 py-1 text-right">Đã thu</th><th className="px-2 py-1 text-right">Số phiếu</th></tr></thead>
              <tbody>
                {!(b.data?.by_material ?? []).length && <tr><td colSpan={4} className={`${TD} text-slate-400`}>{b.isLoading ? 'Đang tính…' : 'Chưa thu được gì'}</td></tr>}
                {(b.data?.by_material ?? []).map(m => (
                  <tr key={m.material_id} className="border-t border-slate-100"><td className={`${TD} font-mono font-semibold`}>{m.material_code}</td><td className={`${TD} max-w-[220px] truncate`}>{m.short_name ?? ''}</td>
                    <td className={NUM}>{qtyLabel(Number(m.qty_base), m as MatUnits)}</td><td className={NUM}>{m.phieu}</td></tr>
                ))}
              </tbody>
            </table></div>
            <div className="font-semibold text-slate-700">Đã thu theo khách / NPP</div>
            <div className="overflow-auto border rounded-lg"><table className="w-full">
              <thead><tr className="bg-slate-50 text-[9px] text-slate-500"><th className="px-2 py-1 text-left">Khách / NPP</th><th className="px-2 py-1 text-left">Hàng đã thu</th><th className="px-2 py-1 text-right">Số phiếu</th></tr></thead>
              <tbody>
                {!(b.data?.by_party ?? []).length && <tr><td colSpan={3} className={`${TD} text-slate-400`}>{b.isLoading ? 'Đang tính…' : 'Chưa có'}</td></tr>}
                {(b.data?.by_party ?? []).map(p => (
                  <tr key={p.party} className="border-t border-slate-100"><td className={`${TD} max-w-[220px] truncate`}>{p.party}</td>
                    <td className={`${TD} whitespace-normal`}>{(b.data?.by_party_material ?? []).filter(x => x.party === p.party).map(x => {
                      const m = qtyBy.get(x.material_id)
                      return <span key={x.material_id} className="mr-2"><span className="font-mono">{m?.material_code ?? ''}</span> {qtyLabel(Number(x.qty_base), m as MatUnits | undefined)}</span>
                    })}</td>
                    <td className={NUM}>{p.phieu}</td></tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>
    </FormSheet>
  )
}
