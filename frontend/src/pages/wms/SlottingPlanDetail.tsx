// Chi tiết kế hoạch sắp xếp kho (Slotting v2) — dòng GOM theo (Mã + Date): "N pallet:
// vị trí 1 → vị trí 2". Tiến độ x/N SUY SỐNG từ vị trí hiện tại của các pallet trong dòng
// (công nhân chuyển bằng "Chuyển vị trí" ở Tồn kho — trang này tự nhảy tick realtime).
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { ArrowLeft, Boxes, CheckCircle2, QrCode, RotateCcw, Trash2, XCircle, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import { SearchInput } from '@/components/shared/SearchInput'
import { useSlottingPlan, useUpdateSlottingPlan, useDeleteSlottingPlan, type SlottingPlanLineRow } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { formatDateTime } from '@/utils/formatters'
import { printSlottingPlan, computeFreesSet } from './printSlottingPlan'
import { PlanScanOverlay } from './PlanScanOverlay'
import { unlockAudio } from '@/utils/audio'

const nf = new Intl.NumberFormat('vi-VN')

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

const LINE_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  PARTIAL: 'bg-amber-100 text-amber-700',
  DONE:    'bg-green-100 text-green-700',
  GONE:    'bg-slate-100 text-slate-400 line-through',
}
const LINE_LABEL: Record<string, string> = {
  PENDING: 'Chưa chuyển', PARTIAL: 'Đang chuyển', DONE: 'Xong', GONE: 'Hết tồn',
}
const PLAN_BADGE: Record<string, string> = {
  ACTIVE: 'bg-sky-100 text-sky-700', COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-slate-100 text-slate-500',
}
const PLAN_LABEL: Record<string, string> = { ACTIVE: 'Đang thực hiện', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' }
const LEVEL_LABEL: Record<string, string> = { EASY: 'Easy', NORMAL: 'Normal', HARD: 'Hard' }

type LineFilter = '' | 'PENDING' | 'PARTIAL' | 'DONE' | 'GONE'
type BracketPos = 'first' | 'mid' | 'last' | 'only'

export default function SlottingPlanDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const admin = isAdmin(user?.name)
  const canPlan = admin || can(perms, 'slotting', 'plan')
  const canComplete = admin || can(perms, 'slotting', 'complete')
  // Quét thực hiện lệnh = thao tác Chuyển vị trí pallet → đúng quyền inventory.move_location (cross-module)
  const canScanMove = admin || can(perms, 'inventory', 'move_location')
  const [scanOpen, setScanOpen] = useState(false)
  const [scanEverOpened, setScanEverOpened] = useState(false)

  const { data: plan, isLoading, error } = useSlottingPlan(id)
  const { mutate: updatePlan, isPending: updating } = useUpdateSlottingPlan()
  const { mutate: deletePlan, isPending: deleting } = useDeleteSlottingPlan()
  const [actErr, setActErr] = useState('')
  const [search, setSearch] = useState('')
  const [lineFilter, setLineFilter] = useState<LineFilter>('')

  // Dòng nào làm xong TRỐNG được vị trí nguồn — tính trên TOÀN kế hoạch (không theo bộ lọc)
  const freesSet = useMemo(() => computeFreesSet(plan?.lines ?? []), [plan?.lines])

  const lines = useMemo(() => {
    let list = plan?.lines ?? []
    if (lineFilter) list = list.filter(l => l.status === lineFilter)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(l => `${l.material_code ?? ''} ${l.material_name ?? ''} ${l.date_key ?? ''} ${l.from_location_code ?? ''} ${l.to_location_code ?? ''}`.toLowerCase().includes(q))
    // Gom TRỌN theo vị trí đích (thứ tự xuất hiện đầu) + nhóm GIẢI PHÓNG vị trí nguồn lên đầu
    // (user 18/07: việc dễ + hiệu quả ở trên — chuyển xong là có ô trống ngay cho các lệnh sau)
    const groups = new Map<string, SlottingPlanLineRow[]>()
    for (const l of list) {
      const g = groups.get(l.to_location_id)
      if (g) g.push(l)
      else groups.set(l.to_location_id, [l])
    }
    return [...groups.values()]
      .sort((a, b) => Number(b.some(l => freesSet.has(l.id))) - Number(a.some(l => freesSet.has(l.id))))
      .flat()
  }, [plan?.lines, search, lineFilter, freesSet])

  // Bracket nối các dòng LIỀN NHAU cùng vị trí đích (gom đích — như bảng Nhập nối theo chuyến)
  const bracketPositions = useMemo(() => {
    const map = new Map<string, BracketPos>()
    const n = lines.length
    lines.forEach((l, i) => {
      const key = l.to_location_id
      const prevOk = i > 0 && lines[i - 1].to_location_id === key
      const nextOk = i < n - 1 && lines[i + 1].to_location_id === key
      map.set(l.id, prevOk && nextOk ? 'mid' : prevOk ? 'last' : nextOk ? 'first' : 'only')
    })
    return map
  }, [lines])

  function setStatus(status: 'COMPLETED' | 'CANCELLED' | 'ACTIVE', confirmMsg: string) {
    if (!plan) return
    if (!confirm(confirmMsg)) return
    setActErr('')
    updatePlan({ id: plan.id, status }, { onError: e => setActErr(apiMsg(e)) })
  }
  function handleDelete() {
    if (!plan) return
    if (!confirm(`Xóa kế hoạch "${plan.name}" (${plan.n_lines} dòng)?\nChỉ xóa bản kế hoạch — pallet đã chuyển KHÔNG bị hoàn tác.`)) return
    deletePlan(plan.id, {
      onSuccess: () => navigate('/wms/slotting'),
      onError: e => setActErr(apiMsg(e)),
    })
  }

  if (isLoading) return <div className="p-8 text-center text-sm text-slate-400">Đang tải…</div>
  if (error || !plan) return (
    <div className="p-8 text-center space-y-2">
      <p className="text-sm text-red-600">{error ? apiMsg(error) : 'Không tìm thấy kế hoạch'}</p>
      <Link to="/wms/slotting" className="text-xs text-sky-600 underline">← Về Tối ưu vị trí</Link>
    </div>
  )

  const s = plan.summary
  const pct = s.total_pallets > 0 ? Math.round(((s.done_pallets + s.gone_pallets) / s.total_pallets) * 100) : 0
  const tiles: BandTile[] = [
    { label: 'Dòng chuyển', value: nf.format(s.total_lines) },
    { label: 'Pallet phải chuyển', value: nf.format(s.total_pallets) },
    { label: 'Đã về đúng chỗ', value: nf.format(s.done_pallets), accent: s.done_pallets > 0 },
    { label: 'Khác vị trí đề xuất', value: nf.format(s.moved_other_pallets), danger: s.moved_other_pallets > 0 },
    { label: 'Hết tồn', value: nf.format(s.gone_pallets) },
    { label: 'Chưa chuyển', value: nf.format(s.pending_pallets) },
    { label: 'Tiến độ', value: `${pct}%`, accent: true },
  ]

  const statusChips: { key: LineFilter; label: string; n: number }[] = [
    { key: '', label: 'Tất cả', n: s.total_lines },
    { key: 'PENDING', label: LINE_LABEL.PENDING, n: s.pending_lines },
    { key: 'PARTIAL', label: LINE_LABEL.PARTIAL, n: s.partial_lines },
    { key: 'DONE', label: LINE_LABEL.DONE, n: s.done_lines },
  ]

  const openScan = () => { unlockAudio(); setScanEverOpened(true); setScanOpen(true) }

  return (
    <div className="flex flex-col h-full sm:p-3">
      {scanEverOpened && (
        <PlanScanOverlay plan={{ id: plan.id, name: plan.name }} open={scanOpen} onClose={() => setScanOpen(false)} />
      )}
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Header */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl space-y-1.5 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/wms/slotting" className="text-slate-400 hover:text-slate-600 shrink-0"><ArrowLeft className="h-4 w-4" /></Link>
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <Boxes className="h-4 w-4 text-sky-600" /> {plan.name}
            </h1>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${PLAN_BADGE[plan.status]}`}>{PLAN_LABEL[plan.status]}</span>
            {plan.level && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{LEVEL_LABEL[plan.level]} · {plan.principle ?? '—'}</span>}
            <span className="text-[10px] text-slate-400">
              {plan.created_by ?? '—'} · {formatDateTime(plan.created_at)}
              {plan.completed_at ? ` · đóng ${formatDateTime(plan.completed_at)} (${plan.completed_by ?? '—'})` : ''}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[11px]"
                title="In phiếu A4 gom theo vị trí đích — in đúng danh sách đang lọc trên màn"
                onClick={() => {
                  if (!printSlottingPlan(plan, lines, user?.name)) setActErr('Trình duyệt chặn cửa sổ in — cho phép popup rồi bấm In lại')
                }}>
                <Printer className="h-3.5 w-3.5 mr-1" /> In
              </Button>
              {canComplete && plan.status === 'ACTIVE' && (
                <>
                  <Button size="sm" className="h-7 text-[11px] bg-green-600 hover:bg-green-700" disabled={updating}
                    onClick={() => setStatus('COMPLETED', `Hoàn thành kế hoạch "${plan.name}"?\n${s.done_pallets + s.gone_pallets}/${s.total_pallets} pallet đã xử lý${s.pending_pallets > 0 ? ` — CÒN ${s.pending_pallets} pallet chưa chuyển` : ''}.`)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Hoàn thành
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[11px] text-red-600 border-red-200 hover:bg-red-50" disabled={updating}
                    onClick={() => setStatus('CANCELLED', `Hủy kế hoạch "${plan.name}"? Pallet đã chuyển không bị hoàn tác.`)}>
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Hủy
                  </Button>
                </>
              )}
              {canComplete && plan.status !== 'ACTIVE' && (
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={updating}
                  onClick={() => setStatus('ACTIVE', `Mở lại kế hoạch "${plan.name}"?`)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Mở lại
                </Button>
              )}
              {canPlan && (
                <Button size="sm" variant="outline" className="h-7 text-[11px] text-red-600 border-red-200 hover:bg-red-50" disabled={deleting} onClick={handleDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Xóa
                </Button>
              )}
            </span>
          </div>
          {actErr && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{actErr}</p>}
        </div>

        <SummaryBand tiles={tiles} />

        {/* Lọc trạng thái dòng + tìm */}
        <div className="border-b bg-slate-50 px-3 py-1.5 shrink-0 flex items-center gap-1.5 flex-wrap print:hidden">
          {statusChips.map(c => (
            <button key={c.key || 'all'}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${lineFilter === c.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              onClick={() => setLineFilter(c.key)}>
              {c.label} ({nf.format(c.n)})
            </button>
          ))}
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm mã, date, vị trí…" className="flex-1 min-w-[140px] max-w-xs ml-auto" />
        </div>

        {/* Bảng dòng gom (Mã + Date) */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {lines.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">Không có dòng khớp bộ lọc</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap sticky left-0 z-20 bg-slate-50">Mã hàng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Date</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Hạng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Từ vị trí</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap" title="Số pallet HIỆN đang nằm ở vị trí đi">PL nơi đi</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Đến vị trí</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap" title="Số pallet HIỆN đang nằm ở vị trí đích">PL đích</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Tiến độ</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Người chuyển cuối</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Lúc</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Lý do · HD xếp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => (
                  <LineRow key={l.id} l={l} bracketPos={bracketPositions.get(l.id) ?? 'only'} frees={freesSet.has(l.id)}
                    onScan={canScanMove && plan.status === 'ACTIVE' && (l.status === 'PENDING' || l.status === 'PARTIAL') ? openScan : undefined} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0 print:hidden">
          1–{lines.length} / {plan.lines.length} dòng · 1 dòng = 1 lệnh gom (Mã + Date); pallet chuyển bằng nút "Chuyển vị trí" ở Tồn kho — tiến độ tự nhảy khi pallet về đúng vị trí đích
        </div>
      </div>
    </div>
  )
}

function LineRow({ l, bracketPos = 'only', frees = false, onScan }: {
  l: SlottingPlanLineRow; bracketPos?: BracketPos; frees?: boolean; onScan?: () => void
}) {
  const abcCls = l.abc === 'A' ? 'bg-sky-600 text-white' : l.abc === 'B' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
  const resolved = l.done + l.gone
  const pctLine = l.n_pallets > 0 ? Math.round((resolved / l.n_pallets) * 100) : 0
  // Nhóm cùng vị trí đích: bracket [ ở mép trái + đóng khung cụm (như bảng Nhập nối theo chuyến)
  const grouped = bracketPos !== 'only'
  const repeatTo = bracketPos === 'mid' || bracketPos === 'last' // đích lặp lại trong nhóm → mờ đi
  return (
    <TableRow className={`${l.status === 'GONE' ? 'opacity-50' : ''} ${grouped ? 'bg-slate-50' : ''} ${grouped && bracketPos === 'first' ? '[&_td]:border-t [&_td]:!border-t-slate-300' : ''} ${grouped && bracketPos === 'last' ? '[&_td]:!border-b-slate-300' : ''}`}>
      <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 ${grouped ? 'bg-slate-50 pl-4' : 'bg-white'}`}>
        {grouped && (
          <span aria-hidden className="absolute" style={{
            left: 3, width: 6,
            top: bracketPos === 'first' ? '50%' : 0,
            bottom: bracketPos === 'last' ? '50%' : 0,
            borderLeft: '2px solid #0f172a',
            ...(bracketPos === 'first' ? { borderTop: '2px solid #0f172a', borderTopLeftRadius: 3 } : {}),
            ...(bracketPos === 'last' ? { borderBottom: '2px solid #0f172a', borderBottomLeftRadius: 3 } : {}),
          }} />
        )}
        <span className="font-mono font-semibold">{l.material_code ?? '—'}</span>
        {/* Tên dài phải cắt — cột này FREEZE, để nguyên sẽ rộng gần hết màn phone che các cột sau (user 19/07) */}
        {l.material_name && (
          <span className="text-slate-400 ml-1 inline-block align-bottom truncate max-w-[96px] sm:max-w-[260px]" title={l.material_name}>
            {l.material_name}
          </span>
        )}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">{l.date_key ?? <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {l.abc ? <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${abcCls}`}>{l.abc}</span> : <span className="text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">
        {/* flex + ml-auto: nút QR GHIM mép phải cột — mọi dòng thẳng hàng nhau (user 19/07) */}
        <span className="flex items-center gap-1.5 min-w-[150px]">
          <span>{l.from_location_code ?? <span className="text-slate-300">—</span>}</span>
          {onScan && (
            <button className="ml-auto shrink-0 text-sky-600 hover:text-sky-800 px-1.5 py-1 rounded !min-h-0 !min-w-0"
              title="Quét thực hiện — quét tem pallet đang ở vị trí nguồn, tự chuyển sang vị trí đích"
              onClick={e => { e.stopPropagation(); onScan() }}>
              <QrCode className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] tabular-nums whitespace-nowrap">
        {l.from_pallets_now != null ? l.from_pallets_now : <span className="text-slate-300">—</span>}
        {frees && <span className="ml-1 text-[9px] font-semibold text-green-700" title="Chuyển xong là TRỐNG được vị trí nguồn — nên làm trước để có chỗ trống cho các lệnh sau">→trống</span>}
      </TableCell>
      <TableCell className={`px-2 py-1 text-[10px] font-mono font-semibold text-green-700 whitespace-nowrap ${repeatTo ? 'opacity-40' : ''}`}>{l.to_location_code ?? '—'}</TableCell>
      <TableCell className={`px-2 py-1 text-[10px] tabular-nums whitespace-nowrap ${repeatTo ? 'opacity-40' : ''}`}>{l.to_pallets_now != null ? l.to_pallets_now : <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="flex items-center gap-1.5">
          <span className="w-14 h-1.5 rounded bg-slate-200 overflow-hidden inline-block">
            <span className={`block h-1.5 ${resolved >= l.n_pallets ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${pctLine}%` }} />
          </span>
          <span className="text-[10px] tabular-nums font-semibold">{l.done}/{l.n_pallets}</span>
          {l.moved_other > 0 && <span className="text-[9px] text-amber-600 font-semibold" title="Pallet đã rời vị trí cũ nhưng sang chỗ khác đề xuất">⚠{l.moved_other}</span>}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${LINE_BADGE[l.status]}`}>{LINE_LABEL[l.status]}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{l.moved_by_name ?? <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{l.moved_at ? formatDateTime(l.moved_at) : <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">
        <span className="block max-w-[280px] truncate" title={`${l.reason ?? ''}${l.flow_note ? ` · ${l.flow_note}` : ''}`}>{l.reason ?? '—'}{l.flow_note ? ` · ${l.flow_note}` : ''}</span>
      </TableCell>
    </TableRow>
  )
}
