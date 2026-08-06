// TRUNG TÂM CẢNH BÁO (Đợt 2 roadmap 06/08) — màn "việc phải xử" gom từ 5 rule quét sống:
// tồn cận %Date · xe trong cổng lâu · chuyến trễ/kẹt · lệch cân >5% · lỗi hệ thống BE.
// Cảnh báo TỰ ĐÓNG khi điều kiện hết; Ack = "tôi biết rồi" (ẩn khỏi list mặc định).
// Layout theo skill table-format: card + toolbar + FilterBar + SummaryBand + bảng resize cột.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, Check, Undo2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { useAlerts, useAckAlert, type AlertRow } from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

const RULE_LABEL: Record<string, string> = {
  EXPIRY:     'Tồn cận date',
  GATE_DWELL: 'Xe trong cổng lâu',
  TRIP_LATE:  'Chuyến trễ / kẹt',
  WEIGH_DIFF: 'Lệch cân',
  BE_ERRORS:  'Lỗi hệ thống',
}
const RULE_BADGE: Record<string, string> = {
  EXPIRY:     'bg-amber-100 text-amber-800',
  GATE_DWELL: 'bg-sky-100 text-sky-700',
  TRIP_LATE:  'bg-violet-100 text-violet-700',
  WEIGH_DIFF: 'bg-rose-100 text-rose-700',
  BE_ERRORS:  'bg-slate-200 text-slate-700',
}
const SEV_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  WARNING:  'bg-amber-100 text-amber-800',
}
const SEV_LABEL: Record<string, string> = { CRITICAL: 'Nghiêm trọng', WARNING: 'Cảnh báo' }

// Màu row theo trạng thái (chữ, không fill — chuẩn rowStatus)
function alertKey(a: AlertRow): RowStatusKey {
  if (a.resolved_at) return 'completed'
  if (a.ack_at) return 'pending'
  return a.severity === 'CRITICAL' ? 'paused' : 'inProgress'
}

const COLS = [
  { id: 'sel',    label: '',           w: 36 },
  { id: 'sev',    label: 'Mức độ',     w: 95 },
  { id: 'rule',   label: 'Loại',       w: 115 },
  { id: 'wh',     label: 'Kho',        w: 110 },
  { id: 'title',  label: 'Nội dung',   w: 320 },
  { id: 'detail', label: 'Chi tiết',   w: 360 },
  { id: 'cat',    label: 'Loại kho',   w: 90 },
  { id: 'first',  label: 'Xuất hiện',  w: 115 },
  { id: 'last',   label: 'Lần cuối',   w: 115 },
  { id: 'ack',    label: 'Đã biết',    w: 120 },
  { id: 'act',    label: '',           w: 90 },
]

export default function Alerts() {
  const navigate = useNavigate()
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canAck = can(perms, 'alerts', 'ack')

  const f = useWmsFilterStore(s => s.alerts)
  const setF = useWmsFilterStore(s => s.setAlerts)
  const { widths: colW, startResize, totalWidth } = useColumnResize('alerts_col_widths', COLS.map(c => c.w))
  const { data: whs } = useScopedWarehouses(true)
  const whName = useMemo(() => new Map((whs ?? []).map(w => [(w as { id: string }).id, (w as { id: string; name?: string }).name ?? ''])), [whs])

  const { data, isLoading, refetch, isFetching } = useAlerts({
    status: f.status,
    rule: f.rules.join(',') || undefined,
    severity: f.severity.join(',') || undefined,
    warehouse_id: f.warehouseId || undefined,
  })
  const ackMut = useAckAlert()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // Search client-side: list đã cap 1000 dòng server (cảnh báo mở là danh sách VIỆC, không phải kho lưu trữ)
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const term = f.search.trim().toLowerCase()
    if (!term) return all
    return all.filter(a => `${a.title} ${a.detail ?? ''} ${a.warehouse_name ?? whName.get(a.warehouse_id ?? '') ?? ''}`.toLowerCase().includes(term))
  }, [data, f.search, whName])

  // Bulk "Đã biết" (user chốt 06/08 "chọn multi và kích hoạt action hàng loạt") — song song chuẩn
  const selectable = rows.filter(a => !a.resolved_at && !a.ack_at)
  const allSel = selectable.length > 0 && selectable.every(a => sel.has(a.id))
  const pickedOpen = selectable.filter(a => sel.has(a.id))
  async function bulkAck() {
    setBusy(true)
    await Promise.all(pickedOpen.map(a => ackMut.mutateAsync({ id: a.id, ack: true }).catch(() => undefined)))
    setBusy(false); setSel(new Set())
  }

  const nCrit = rows.filter(a => a.severity === 'CRITICAL' && !a.resolved_at && !a.ack_at).length
  const nWarn = rows.filter(a => a.severity === 'WARNING' && !a.resolved_at && !a.ack_at).length
  const nAck  = rows.filter(a => a.ack_at && !a.resolved_at).length

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single',
      options: (whs ?? []).map(w => ({ value: (w as { id: string }).id, label: (w as { id: string; name?: string }).name ?? '' })),
      value: f.warehouseId,
      onChange: (v: string) => setF({ warehouseId: v }) },
    { key: 'rule', label: 'Loại cảnh báo', type: 'multi', searchable: false,
      options: Object.entries(RULE_LABEL).map(([value, label]) => ({ value, label })),
      selected: f.rules, onChange: (v: string[]) => setF({ rules: v }) },
    { key: 'sev', label: 'Mức độ', type: 'multi', searchable: false,
      options: [{ value: 'CRITICAL', label: 'Nghiêm trọng' }, { value: 'WARNING', label: 'Cảnh báo' }],
      selected: f.severity, onChange: (v: string[]) => setF({ severity: v }) },
    { key: 'status', label: 'Trạng thái', type: 'single', pinned: true, allLabel: 'Đang mở (mặc định)',
      options: [
        { value: 'open',     label: 'Đang mở' },
        { value: 'acked',    label: 'Đã biết (ack)' },
        { value: 'resolved', label: 'Đã tự đóng (7 ngày)' },
        { value: 'all',      label: 'Tất cả' },
      ],
      value: f.status === 'open' ? '' : f.status,   // '' = mặc định "Đang mở" (chip không active)
      onChange: (v: string) => setF({ status: v || 'open' }) },
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
              <BellRing className="h-4 w-4 text-sky-600" /> Cảnh báo
            </h1>
            <SearchInput value={f.search} onChange={v => setF({ search: v })} placeholder="Tìm nội dung / kho…" className="flex-1 min-w-[120px]" />
            <span className="sm:hidden"><FilterSheetButton defs={filterDefs} /></span>
            {canAck && pickedOpen.length > 0 && (
              <Button size="sm" variant="outline" className="h-9 sm:h-7 text-[11px]" disabled={busy}
                title="Đánh dấu đã biết các cảnh báo đã chọn (ẩn khỏi danh sách mặc định)"
                onClick={bulkAck}>
                <Check className="h-3.5 w-3.5 mr-1" /> {busy ? 'Đang lưu…' : `Đã biết (${pickedOpen.length})`}
              </Button>
            )}
            <button type="button" title="Quét lại ngay (bình thường tự quét ~10 phút/lần)"
              onClick={() => refetch()}
              className="h-9 sm:h-7 px-2 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 inline-flex items-center gap-1 text-[11px] shrink-0">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Quét lại</span>
            </button>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        <SummaryBand tiles={[
          { label: 'Nghiêm trọng', value: nCrit.toLocaleString('vi-VN'), accent: nCrit > 0 },
          { label: 'Cảnh báo', value: nWarn.toLocaleString('vi-VN') },
          { label: 'Đã biết (ack)', value: nAck.toLocaleString('vi-VN') },
          { label: 'Đang hiện / tổng', value: `${rows.length.toLocaleString('vi-VN')} / ${(data?.total ?? rows.length).toLocaleString('vi-VN')}` },
        ]} />

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
            style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`relative text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.id === 'sel' && canAck ? (
                      <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={allSel}
                        onChange={e => setSel(e.target.checked ? new Set(selectable.map(a => a.id)) : new Set())} />
                    ) : c.label}
                    <span onPointerDown={e => startResize(i, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center py-8 text-xs text-slate-400">Đang quét cảnh báo…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={COLS.length} className="text-center py-8 text-xs text-slate-400">
                  {f.status === 'open' ? 'Không có cảnh báo nào đang mở 🎉' : 'Không có cảnh báo khớp bộ lọc'}
                </TableCell></TableRow>
              ) : rows.map(a => {
                const acked = !!a.ack_at && !a.resolved_at
                const picked = sel.has(a.id)
                return (
                  <TableRow key={a.id}
                    className={`${a.object_url ? 'cursor-pointer' : ''} ${rowText(alertKey(a))} ${picked ? 'bg-sky-50' : ''}`}
                    onClick={() => { if (a.object_url) navigate(a.object_url) }}>
                    <TableCell className={`px-2 py-1 sticky left-0 z-10 ${picked ? 'bg-sky-50' : 'bg-white'}`}>
                      {canAck && !a.resolved_at && !a.ack_at && (
                        <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={picked}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setSel(prev => {
                            const n = new Set(prev)
                            if (e.target.checked) n.add(a.id); else n.delete(a.id)
                            return n
                          })} />
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${SEV_BADGE[a.severity]}`}>{SEV_LABEL[a.severity]}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${RULE_BADGE[a.rule] ?? 'bg-slate-100 text-slate-600'}`}>{RULE_LABEL[a.rule] ?? a.rule}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-semibold truncate"
                      title={a.warehouse_name ?? ''}>
                      {a.warehouse_name ?? whName.get(a.warehouse_id ?? '') ?? (a.warehouse_id ? '—' : <span className="text-slate-400 font-normal">Toàn hệ thống</span>)}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-semibold truncate" title={a.title}>{a.title}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={a.detail ?? ''}>
                      {a.detail ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">{a.category ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                      {formatTimestampDate(a.first_seen, true)} <span className="text-slate-400">{formatTimestampTime(a.first_seen)}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                      {formatTimestampDate(a.last_seen, true)} <span className="text-slate-400">{formatTimestampTime(a.last_seen)}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={a.ack_by ?? ''}>
                      {a.ack_at ? `${a.ack_by ?? ''} · ${formatTimestampDate(a.ack_at, true)}` : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {canAck && !a.resolved_at && (
                        <button type="button"
                          title={acked ? 'Bỏ đánh dấu đã biết (hiện lại trong danh sách mặc định)' : 'Đã biết — ẩn khỏi danh sách mặc định (điều kiện hết sẽ tự đóng)'}
                          disabled={ackMut.isPending}
                          onClick={e => { e.stopPropagation(); ackMut.mutate({ id: a.id, ack: !acked }) }}
                          className="px-1.5 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 inline-flex items-center gap-1 text-[10px]">
                          {acked ? <Undo2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                          {acked ? 'Bỏ' : 'Đã biết'}
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">
          1–{rows.length} / {data?.total ?? rows.length} cảnh báo · tự quét ~10 phút/lần, realtime khi có cảnh báo mới
        </div>
      </div>
    </div>
  )
}
