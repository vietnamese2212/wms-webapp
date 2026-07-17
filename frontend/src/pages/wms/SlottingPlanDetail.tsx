// Chi tiết kế hoạch sắp xếp kho (Slotting) — trạng thái từng dòng SUY SỐNG từ vị trí
// hiện tại của pallet trên tồn kho: DONE = đã về đúng vị trí đích; MOVED_OTHER = đã rời
// vị trí cũ nhưng sang chỗ khác; GONE = pallet hết tồn/đã xuất; PENDING = chưa chuyển.
// Công nhân chuyển pallet bằng tính năng "Chuyển vị trí" ở trang Tồn kho — trang này tự nhảy tick (realtime).
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { ArrowLeft, Boxes, CheckCircle2, RotateCcw, Trash2, XCircle, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SummaryBand, type BandTile } from '@/components/shared/SummaryBand'
import { SearchInput } from '@/components/shared/SearchInput'
import { useSlottingPlan, useUpdateSlottingPlan, useDeleteSlottingPlan, type SlottingPlanLineRow } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, isAdmin, type ModulePermissions } from '@/config/permissions'
import { formatDateTime } from '@/utils/formatters'

const nf = new Intl.NumberFormat('vi-VN')

function apiMsg(err: unknown) {
  return (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? String(err)
}

const LINE_BADGE: Record<string, string> = {
  PENDING:     'bg-slate-100 text-slate-500',
  DONE:        'bg-green-100 text-green-700',
  MOVED_OTHER: 'bg-amber-100 text-amber-700',
  GONE:        'bg-slate-100 text-slate-400 line-through',
}
const LINE_LABEL: Record<string, string> = {
  PENDING: 'Chưa chuyển', DONE: 'Đã về đúng chỗ', MOVED_OTHER: 'Khác vị trí đề xuất', GONE: 'Hết tồn',
}
const PLAN_BADGE: Record<string, string> = {
  ACTIVE: 'bg-sky-100 text-sky-700', COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-slate-100 text-slate-500',
}
const PLAN_LABEL: Record<string, string> = { ACTIVE: 'Đang thực hiện', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' }

type LineFilter = '' | 'PENDING' | 'DONE' | 'MOVED_OTHER' | 'GONE'

export default function SlottingPlanDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const admin = isAdmin(user?.name)
  const canPlan = admin || can(perms, 'slotting', 'plan')
  const canComplete = admin || can(perms, 'slotting', 'complete')

  const { data: plan, isLoading, error } = useSlottingPlan(id)
  const { mutate: updatePlan, isPending: updating } = useUpdateSlottingPlan()
  const { mutate: deletePlan, isPending: deleting } = useDeleteSlottingPlan()
  const [actErr, setActErr] = useState('')
  const [search, setSearch] = useState('')
  const [lineFilter, setLineFilter] = useState<LineFilter>('')

  const lines = useMemo(() => {
    let list = plan?.lines ?? []
    if (lineFilter) list = list.filter(l => l.status === lineFilter)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(l => `${l.pallet_code} ${l.material_code ?? ''} ${l.material_name ?? ''} ${l.from_location_code ?? ''} ${l.to_location_code ?? ''}`.toLowerCase().includes(q))
    return list
  }, [plan?.lines, search, lineFilter])

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
  const resolved = s.done + s.gone
  const pct = s.total > 0 ? Math.round(((s.done + s.moved_other + s.gone) / s.total) * 100) : 0
  const tiles: BandTile[] = [
    { label: 'Tổng dòng', value: nf.format(s.total) },
    { label: 'Đã về đúng chỗ', value: nf.format(s.done), accent: s.done > 0 },
    { label: 'Khác vị trí đề xuất', value: nf.format(s.moved_other), danger: s.moved_other > 0 },
    { label: 'Hết tồn', value: nf.format(s.gone) },
    { label: 'Chưa chuyển', value: nf.format(s.pending) },
    { label: 'Tiến độ', value: `${pct}%`, accent: true },
  ]

  const statusChips: { key: LineFilter; label: string; n: number }[] = [
    { key: '', label: 'Tất cả', n: s.total },
    { key: 'PENDING', label: LINE_LABEL.PENDING, n: s.pending },
    { key: 'DONE', label: LINE_LABEL.DONE, n: s.done },
    { key: 'MOVED_OTHER', label: LINE_LABEL.MOVED_OTHER, n: s.moved_other },
    { key: 'GONE', label: LINE_LABEL.GONE, n: s.gone },
  ]

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Header */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl space-y-1.5 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/wms/slotting" className="text-slate-400 hover:text-slate-600 shrink-0"><ArrowLeft className="h-4 w-4" /></Link>
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <Boxes className="h-4 w-4 text-sky-600" /> {plan.name}
            </h1>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${PLAN_BADGE[plan.status]}`}>{PLAN_LABEL[plan.status]}</span>
            <span className="text-[10px] text-slate-400">
              {plan.created_by ?? '—'} · {formatDateTime(plan.created_at)}
              {plan.window_days ? ` · cửa sổ ${plan.window_days} ngày` : ''}
              {plan.completed_at ? ` · đóng ${formatDateTime(plan.completed_at)} (${plan.completed_by ?? '—'})` : ''}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5 mr-1" /> In
              </Button>
              {canComplete && plan.status === 'ACTIVE' && (
                <>
                  <Button size="sm" className="h-7 text-[11px] bg-green-600 hover:bg-green-700" disabled={updating}
                    onClick={() => setStatus('COMPLETED', `Hoàn thành kế hoạch "${plan.name}"?\n${resolved}/${s.total} dòng đã xử lý${s.pending > 0 ? ` — CÒN ${s.pending} dòng chưa chuyển` : ''}.`)}>
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

        {/* Lọc trạng thái + tìm */}
        <div className="border-b bg-slate-50 px-3 py-1.5 shrink-0 flex items-center gap-1.5 flex-wrap print:hidden">
          {statusChips.map(c => (
            <button key={c.key || 'all'}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${lineFilter === c.key ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              onClick={() => setLineFilter(c.key)}>
              {c.label} ({nf.format(c.n)})
            </button>
          ))}
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm pallet, mã, vị trí…" className="flex-1 min-w-[140px] max-w-xs ml-auto" />
        </div>

        {/* Bảng dòng chuyển */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {lines.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">Không có dòng khớp bộ lọc</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap sticky left-0 z-20 bg-slate-50">Pallet</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Mã hàng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Hạng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Từ vị trí</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Đến vị trí</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Trạng thái</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Vị trí hiện tại</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Người chuyển</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Lúc</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] whitespace-nowrap">Lý do</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => <LineRow key={l.id} l={l} />)}
              </TableBody>
            </Table>
          )}
        </div>
        <div className="border-t px-3 py-1 text-[10px] text-slate-500 shrink-0 print:hidden">
          1–{lines.length} / {plan.lines.length} dòng · pallet chuyển bằng nút "Chuyển vị trí" ở trang Tồn kho — tick tự nhảy khi pallet về đúng vị trí đích
        </div>
      </div>
    </div>
  )
}

function LineRow({ l }: { l: SlottingPlanLineRow }) {
  const abcCls = l.abc === 'A' ? 'bg-sky-600 text-white' : l.abc === 'B' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
  return (
    <TableRow className={l.status === 'GONE' ? 'opacity-50' : undefined}>
      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap sticky left-0 z-10 bg-white">
        <span className="block max-w-[170px] truncate" title={l.pallet_code}>{l.pallet_code}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
        <span className="font-mono font-semibold">{l.material_code ?? '—'}</span>
        {l.material_name && <span className="text-slate-400 ml-1">{l.material_name}</span>}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        {l.abc ? <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${abcCls}`}>{l.abc}</span> : <span className="text-slate-300">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{l.from_location_code ?? <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold text-green-700 whitespace-nowrap">{l.to_location_code ?? '—'}</TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${LINE_BADGE[l.status]}`}>{LINE_LABEL[l.status]}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">
        {l.status === 'MOVED_OTHER'
          ? <span className="text-amber-700 font-semibold">{l.current_location_code ?? '—'}</span>
          : <span className="text-slate-400">{l.current_location_code ?? '—'}</span>}
      </TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">{l.moved_by_name ?? <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{l.moved_at ? formatDateTime(l.moved_at) : <span className="text-slate-300">—</span>}</TableCell>
      <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">
        <span className="block max-w-[240px] truncate" title={l.reason ?? ''}>{l.reason ?? '—'}</span>
      </TableCell>
    </TableRow>
  )
}
