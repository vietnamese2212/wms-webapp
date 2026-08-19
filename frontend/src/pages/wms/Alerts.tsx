// TRUNG TÂM CẢNH BÁO / THÔNG BÁO — 2 tab GIỐNG NÚT CHUÔNG (user chốt 06/08 "chuông và cảnh báo
// chung nhau"): Cá nhân (feed việc đích danh của MÌNH — mọi user vào được) · Thông báo chung
// (cảnh báo vận hành 5 rule quét sống — cần quyền alerts.view; tự đóng khi điều kiện hết,
// Ack = "tôi biết rồi"). Layout theo skill table-format.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { BellRing, Check, Undo2, RefreshCw, CheckCheck, User, SlidersHorizontal, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { SETTINGS_GRID, SettingGroup, SettingLabel, SettingNum, SettingSaveBar } from '@/components/shared/SettingsForm'
import { rowText, type RowStatusKey } from '@/lib/rowStatus'
import { useAlerts, useAckAlert, useNotifyFeed, useMarkFeedRead, useSystemSettings, useUpdateSystemSetting, type AlertRow } from '@/api/hooks'
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
  PACKING_UNRECEIVED: 'Sổ đóng gói — kho chưa nhận',
}
const RULE_BADGE: Record<string, string> = {
  EXPIRY:     'bg-amber-100 text-amber-800',
  GATE_DWELL: 'bg-sky-100 text-sky-700',
  TRIP_LATE:  'bg-violet-100 text-violet-700',
  WEIGH_DIFF: 'bg-rose-100 text-rose-700',
  BE_ERRORS:  'bg-slate-200 text-slate-700',
  PACKING_UNRECEIVED: 'bg-teal-100 text-teal-700',
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

// ─── Shell: 2 tab khớp nút chuông — Cá nhân (mọi user) · Thông báo chung (alerts.view) ───────
export default function Alerts() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canAlerts = can(perms, 'alerts', 'view')
  const canTh = can(perms, 'wms_settings', 'manage_system')   // ngưỡng = cấu hình TOÀN hệ thống
  const f = useWmsFilterStore(s => s.alerts)
  const setF = useWmsFilterStore(s => s.setAlerts)
  // ?tab=personal — deep-link từ nút chuông; thiếu quyền tab nào → ép về Cá nhân
  const [urlTab] = useState(() => new URLSearchParams(window.location.search).get('tab'))
  const wanted = urlTab === 'personal' || urlTab === 'general' ? urlTab : f.tab
  const tab: 'personal' | 'general' | 'thresholds' =
    (wanted === 'general' && !canAlerts) || (wanted === 'thresholds' && !canTh) ? 'personal' : wanted

  const tabBar = (
    <div className="flex items-center gap-1 border-b bg-white px-3 pt-2 shrink-0 sm:rounded-t-xl">
      <BellRing className="h-4 w-4 text-sky-600 shrink-0 mb-1.5 mr-0.5" />
      {([['personal', 'Cá nhân', true], ['general', 'Thông báo chung', canAlerts], ['thresholds', 'Cài đặt ngưỡng', canTh]] as const).map(([k, label, show]) => show && (
        <button key={k} type="button"
          onClick={() => { window.history.replaceState(null, '', '/wms/alerts'); setF({ tab: k }) }}
          className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors ${
            tab === k ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}>
          {label}
        </button>
      ))}
    </div>
  )
  if (tab === 'personal') return <PersonalTab tabBar={tabBar} />
  if (tab === 'thresholds') return <ThresholdsTab tabBar={tabBar} />
  return <GeneralTab tabBar={tabBar} />
}

// ─── Tab CÁ NHÂN — bản đầy đủ của feed trên chuông (50 thông báo gần nhất, 30 ngày) ─────────
function PersonalTab({ tabBar }: { tabBar: ReactNode }) {
  const navigate = useNavigate()
  const { data, isLoading } = useNotifyFeed()
  const markRead = useMarkFeedRead()
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const term = search.trim().toLowerCase()
    if (!term) return all
    return all.filter(n => `${n.title} ${n.body ?? ''}`.toLowerCase().includes(term))
  }, [data, search])
  const unread = data?.unread ?? 0

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {tabBar}
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
              <User className="h-4 w-4 text-sky-600" /> Thông báo của tôi
            </h1>
            <SearchInput value={search} onChange={setSearch} placeholder="Tìm nội dung…" className="flex-1 min-w-[120px]" />
            {unread > 0 && (
              <Button size="sm" variant="outline" className="h-9 sm:h-7 text-[11px]"
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(undefined)}>
                <CheckCheck className="h-3.5 w-3.5 mr-1" /> Đã đọc tất cả
              </Button>
            )}
          </div>
        </div>

        <SummaryBand tiles={[
          { label: 'Chưa đọc', value: unread.toLocaleString('vi-VN'), accent: unread > 0 },
          { label: 'Gần đây (giữ 3 ngày)', value: (data?.rows?.length ?? 0).toLocaleString('vi-VN') },
        ]} />

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
            <TableHeader>
              <TableRow>
                {[['st', '', 40], ['title', 'Nội dung', 300], ['body', 'Chi tiết', 380], ['time', 'Lúc', 130], ['act', '', 110]].map(([id, label, w]) => (
                  <TableHead key={id as string} style={{ width: w as number }}
                    className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{label as string}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-xs text-slate-400">Chưa có thông báo nào cho bạn</TableCell></TableRow>
              ) : rows.map(n => (
                <TableRow key={n.id} className={`${n.url ? 'cursor-pointer' : ''} ${n.read_at ? 'text-slate-400' : 'text-slate-800'} hover:bg-slate-50`}
                  onClick={() => { if (!n.read_at) markRead.mutate([n.id]); if (n.url) navigate(n.url) }}>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    {!n.read_at && <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap truncate ${n.read_at ? '' : 'font-semibold'}`} title={n.title}>{n.title}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={n.body ?? ''}>{n.body ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                    {formatTimestampDate(n.created_at, true)} <span className="text-slate-400">{formatTimestampTime(n.created_at)}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    {!n.read_at && (
                      <button type="button" title="Đánh dấu đã đọc" disabled={markRead.isPending}
                        onClick={e => { e.stopPropagation(); markRead.mutate([n.id]) }}
                        className="px-1.5 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 inline-flex items-center gap-1 text-[10px]">
                        <Check className="h-3.5 w-3.5" /> Đã đọc
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">
          1–{rows.length} thông báo · giữ 3 ngày gần nhất · bật/tắt chuông per trường hợp ở nút chuông góc phải màn hình
        </div>
      </div>
    </div>
  )
}

// ─── Tab THÔNG BÁO CHUNG — cảnh báo vận hành (cần alerts.view) ───────────────────────────────
function GeneralTab({ tabBar }: { tabBar: ReactNode }) {
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

  // Tổng cảnh báo MỞ toàn scope (KHÔNG theo bộ lọc trang) — trùng query key với chuông Header
  // nên không tốn thêm request. Lệch với số đang hiện = có cảnh báo bị bộ lọc CHE: user 19/08
  // "ack hàng loạt rồi mà chuông vẫn còn số" — thực ra số đó nằm ngoài bộ lọc đang áp.
  const allOpen = useAlerts({ status: 'open' })
  const hiddenOpen = f.status === 'open'
    ? Math.max(0, (allOpen.data?.total ?? 0) - (data?.total ?? 0))
    : 0

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
        {tabBar}
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 shrink-0">Cảnh báo vận hành</h1>
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

        {hiddenOpen > 0 && (
          <div className="shrink-0 mx-3 mt-1.5 flex items-center gap-2 flex-wrap rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Còn <b>{hiddenOpen.toLocaleString('vi-VN')}</b> cảnh báo đang mở nằm <b>ngoài bộ lọc</b> đang áp (kho / loại / mức độ khác) — chuông Header vẫn đếm số này.</span>
            <button type="button" onClick={() => setF({ warehouseId: '', rules: [], severity: [], search: '' })}
              className="ml-auto shrink-0 rounded border border-amber-400 px-2 py-0.5 font-medium hover:bg-amber-100">
              Xóa bộ lọc để xem
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
            style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
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

// ─── Tab CÀI ĐẶT NGƯỠNG — cấu hình TOÀN hệ thống (wms_settings.manage_system) ────────────────
// MIRROR mặc định BE (alertScanner.THRESHOLDS) — đổi mặc định phải đổi cả hai.
const TH_DEFAULT = {
  PCT_WARN: 20, PCT_CRIT: 10,
  GATE_WARN_MIN: 90, GATE_CRIT_MIN: 180,
  TRIP_STUCK_HOURS: 6, TRIP_LATE_DAYS: 14,
  WEIGH_WARN_PCT: 5, WEIGH_CRIT_PCT: 15,
  PACKING_UNRECV_WARN_H: 12, PACKING_UNRECV_CRIT_H: 24,
}
type ThKey = keyof typeof TH_DEFAULT
const toStrings = (t: Record<ThKey, number>) =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)])) as Record<ThKey, string>

function ThresholdsTab({ tabBar }: { tabBar: ReactNode }) {
  const settingsQ = useSystemSettings()
  const upd = useUpdateSystemSetting()
  const thRow = (settingsQ.data ?? []).find(s => s.key === 'alert_thresholds')
  const saved = useMemo(() => {
    const v = thRow?.value as Partial<Record<ThKey, number>> | undefined
    return { ...TH_DEFAULT, ...(v ?? {}) }
  }, [thRow])
  // Cờ boolean tách khỏi map số: xe ĐÃ RA thì cảnh báo tự ẩn (mặc định) hay giữ lại chờ "Đã biết"
  const savedKeep = (thRow?.value as { GATE_KEEP_AFTER_EXIT?: unknown } | undefined)?.GATE_KEEP_AFTER_EXIT === true
  const [vals, setVals] = useState<Record<ThKey, string>>(() => toStrings(TH_DEFAULT))
  const [keepExit, setKeepExit] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  useEffect(() => { setVals(toStrings(saved)); setKeepExit(savedKeep) }, [saved, savedKeep])
  const dirty = JSON.stringify(vals) !== JSON.stringify(toStrings(saved)) || keepExit !== savedKeep
  const set = (k: ThKey) => (v: string) => setVals(s => ({ ...s, [k]: v }))

  function save() {
    setErr(''); setOkMsg('')
    const t = {} as Record<ThKey, number>
    for (const k of Object.keys(TH_DEFAULT) as ThKey[]) {
      const n = Number(vals[k])
      if (!Number.isFinite(n) || n <= 0) { setErr('Mọi ngưỡng phải là số dương.'); return }
      t[k] = n
    }
    // Ràng buộc chéo — mirror validator BE (systemSettingController.isAlertThresholds)
    if (t.PCT_CRIT > t.PCT_WARN) return setErr('%Date: ngưỡng Nghiêm trọng phải ≤ ngưỡng Cảnh báo (%Date càng thấp càng nguy).')
    if (t.PCT_WARN > 90) return setErr('%Date: ngưỡng Cảnh báo tối đa 90%.')
    if (t.GATE_WARN_MIN < 15 || t.GATE_WARN_MIN > t.GATE_CRIT_MIN || t.GATE_CRIT_MIN > 2880) return setErr('Xe trong cổng: 15 phút ≤ Cảnh báo ≤ Nghiêm trọng ≤ 2880 phút.')
    if (t.TRIP_STUCK_HOURS < 1 || t.TRIP_STUCK_HOURS > 72) return setErr('Chuyến bắt đầu chưa xong: 1–72 giờ.')
    if (!Number.isInteger(t.TRIP_LATE_DAYS) || t.TRIP_LATE_DAYS < 1 || t.TRIP_LATE_DAYS > 180) return setErr('Chuyến trễ: cửa sổ soi ngược 1–180 ngày (số nguyên).')
    if (t.WEIGH_WARN_PCT > t.WEIGH_CRIT_PCT || t.WEIGH_CRIT_PCT > 100) return setErr('Lệch cân: Cảnh báo ≤ Nghiêm trọng ≤ 100%.')
    if (t.PACKING_UNRECV_WARN_H < 1 || t.PACKING_UNRECV_WARN_H > t.PACKING_UNRECV_CRIT_H || t.PACKING_UNRECV_CRIT_H > 168)
      return setErr('Sổ đóng gói — kho chưa nhận: 1 giờ ≤ Cảnh báo ≤ Nghiêm trọng ≤ 168 giờ.')
    upd.mutate({ key: 'alert_thresholds', value: { ...t, GATE_KEEP_AFTER_EXIT: keepExit } }, {
      onSuccess: () => setOkMsg('Đã lưu — áp dụng từ lượt quét tiếp theo (tự quét ~10 phút/lần, hoặc bấm Quét lại ở tab Thông báo chung).'),
      onError: (e) => setErr((e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lưu thất bại — thử lại.'),
    })
  }

  // Cùng khuôn với Cài đặt WMS ▸ Hệ thống (components/shared/SettingsForm): cụm band + nhãn trên ô
  // + diễn giải trong tooltip ⓘ + thanh Lưu dính đáy. 6 cụm → 3 cột × 2 hàng trên desktop.
  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {tabBar}
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <p className="text-[11px] text-slate-500 flex items-start gap-1.5 mb-2">
            <SlidersHorizontal className="h-3.5 w-3.5 mt-0.5 shrink-0 text-sky-600" />
            Ngưỡng kích hoạt cảnh báo — áp cho <b>toàn hệ thống</b> (mọi kho, mọi người). Bật/tắt chuông
            của riêng bạn nằm ở nút chuông góc phải màn hình.
          </p>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">{err}</p>}
          {okMsg && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-2">{okMsg}</p>}

          <div className={SETTINGS_GRID}>
            <SettingGroup title="Tồn cận date (%Date)" meta={thRow}>
              <SettingLabel text="Ngưỡng %Date còn lại" tip="%Date = phần hạn dùng còn lại. Càng thấp càng nguy, nên Nghiêm trọng phải ≤ Cảnh báo. Tối đa 90%." />
              <div className="grid grid-cols-2 gap-1.5">
                <SettingNum label="Cảnh báo khi ≤" unit="%" value={vals.PCT_WARN} onChange={set('PCT_WARN')} />
                <SettingNum label="Nghiêm trọng khi ≤" unit="%" value={vals.PCT_CRIT} onChange={set('PCT_CRIT')} />
              </div>
            </SettingGroup>

            <SettingGroup title="Xe trong cổng lâu" meta={thRow}>
              <SettingLabel text="Thời gian xe đã vào chưa ra" tip="Tính từ lúc ghi nhận VÀO cổng. Cảnh báo ≤ Nghiêm trọng; khoảng cho phép 15–2880 phút." />
              <div className="grid grid-cols-2 gap-1.5">
                <SettingNum label="Cảnh báo khi ≥" unit="phút" value={vals.GATE_WARN_MIN} onChange={set('GATE_WARN_MIN')} />
                <SettingNum label="Nghiêm trọng khi ≥" unit="phút" value={vals.GATE_CRIT_MIN} onChange={set('GATE_CRIT_MIN')} />
              </div>
              <SettingLabel text="Khi xe đã ra khỏi cổng" tip="Tự ẩn: xe ra là cảnh báo tự đóng ở lượt quét kế (hành vi gốc). Giữ lại: cảnh báo còn nguyên để truy cứu vì sao xe nằm lâu — tự bấm ‘Đã biết’ mới ẩn." />
              <div className="flex flex-col gap-1">
                {([[false, 'Tự ẩn cảnh báo (mặc định)'], [true, 'Giữ lại — bấm "Đã biết" mới ẩn']] as const).map(([v, label]) => (
                  <label key={String(v)} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="radio" name="gate-keep-exit" className="h-3 w-3 accent-sky-600"
                      checked={keepExit === v} onChange={() => setKeepExit(v)} />
                    {label}
                  </label>
                ))}
              </div>
            </SettingGroup>

            <SettingGroup title="Chuyến trễ / kẹt" meta={thRow}>
              <SettingLabel text="Chuyến kẹt & cửa sổ soi trễ" tip={'Chuyến trễ ngày xuất: cứ quá ngày là báo; ô "ngày gần nhất" chỉ giới hạn soi ngược bao xa (chứng từ cũ hơn coi như đã xử lý ngoài hệ thống). Chuyến kẹt: đã Bắt đầu quá số giờ này mà chưa Hoàn thành (1–72 giờ).'} />
              <div className="grid grid-cols-2 gap-1.5">
                <SettingNum label="Bắt đầu quá … chưa xong" unit="giờ" value={vals.TRIP_STUCK_HOURS} onChange={set('TRIP_STUCK_HOURS')} />
                <SettingNum label="Chỉ soi trễ trong" unit="ngày" value={vals.TRIP_LATE_DAYS} onChange={set('TRIP_LATE_DAYS')} />
              </div>
            </SettingGroup>

            <SettingGroup title="Lệch cân" meta={thRow}>
              <SettingLabel text="Lệch |cân − KL tính|" tip="KL tính = Σ số lượng ÷ đơn vị/thùng × khối lượng mã. Cảnh báo ≤ Nghiêm trọng ≤ 100%." />
              <div className="grid grid-cols-2 gap-1.5">
                <SettingNum label="Cảnh báo khi >" unit="%" value={vals.WEIGH_WARN_PCT} onChange={set('WEIGH_WARN_PCT')} />
                <SettingNum label="Nghiêm trọng khi >" unit="%" value={vals.WEIGH_CRIT_PCT} onChange={set('WEIGH_CRIT_PCT')} />
              </div>
            </SettingGroup>

            <SettingGroup title="Sổ đóng gói — kho chưa nhận" meta={thRow}>
              <SettingLabel text="Pallet ghi sổ mà kho chưa quét nhập" tip="Tính từ lúc SX ghi pallet vào Sổ đóng gói. Chiều ngược lại (pallet nhập kho mà không có trong sổ) KHÔNG cảnh báo — hàng NCC/trung chuyển/return đều hợp lệ. Cảnh báo ≤ Nghiêm trọng ≤ 168 giờ." />
              <div className="grid grid-cols-2 gap-1.5">
                <SettingNum label="Cảnh báo khi quá" unit="giờ" value={vals.PACKING_UNRECV_WARN_H} onChange={set('PACKING_UNRECV_WARN_H')} />
                <SettingNum label="Nghiêm trọng khi quá" unit="giờ" value={vals.PACKING_UNRECV_CRIT_H} onChange={set('PACKING_UNRECV_CRIT_H')} />
              </div>
            </SettingGroup>

            <SettingGroup title="Lỗi hệ thống">
              <SettingLabel text="Lỗi backend 5xx trong 24h" tip="Cửa sổ soi 24h là ràng buộc kỹ thuật của bảng error_logs, không phải chính sách nên không mở ra chỉnh." />
              <p className="text-[10px] text-slate-500">Có lỗi là báo — không có ngưỡng chỉnh.</p>
            </SettingGroup>
          </div>
        </div>

        <SettingSaveBar dirty={dirty} saving={upd.isPending || settingsQ.isLoading} onSave={save}
          onReset={() => { setVals(toStrings(saved)); setErr(''); setOkMsg('') }}
          extra={
            <Button size="sm" variant="outline" disabled={upd.isPending}
              title="Điền lại bộ mặc định (vẫn phải bấm Lưu)"
              onClick={() => { setVals(toStrings(TH_DEFAULT)); setErr(''); setOkMsg('') }}>
              Về mặc định
            </Button>
          } />
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">
          Ngưỡng lưu per đơn vị (SystemSetting) · hiệu lực ≤ 30 giây sau khi lưu, thấy rõ ở lượt quét kế tiếp
        </div>
      </div>
    </div>
  )
}
