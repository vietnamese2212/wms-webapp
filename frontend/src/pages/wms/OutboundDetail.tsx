import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  ArrowLeft, CheckCircle2,
  Truck, Package, ClipboardList, Play, Pause, ChevronRight, Bookmark,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { Card }    from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useGDO, useAssignGDO, useStartGDO, useWarehouseEmployees, usePatchGDO,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import type { OutboundItem, OutboundDelivery, OutboundStatus, GDO } from '@/types'

// ─── Status badge ──────────────────────────────────────────────

const statusCls: Record<OutboundStatus, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED:   'bg-green-100 text-green-800',
  CANCELLED:   'bg-red-100 text-red-600',
  PAUSED:      'bg-red-100 text-red-700',
}
const statusLabel: Record<OutboundStatus, string> = {
  PENDING: 'Chờ xuất', IN_PROGRESS: 'Đang xuất', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy', PAUSED: 'Tạm dừng',
}
function Badge({ status }: { status: string }) {
  const s = status as OutboundStatus
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {statusLabel[s] ?? status}
    </span>
  )
}

// ─── Progress bar ──────────────────────────────────────────────

function ProgressBar({ scanned, ordered, compact = false }: { scanned: number; ordered: number; compact?: boolean }) {
  const pct = ordered > 0 ? Math.min(100, (scanned / ordered) * 100) : 0
  const cls = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`${compact ? 'text-xs' : 'text-lg'} tabular-nums font-medium ${pct >= 100 ? 'text-green-700 font-semibold' : 'text-slate-600'}`}>
        {scanned}/{ordered}
      </span>
    </div>
  )
}

// ─── Bắt đầu dialog ───────────────────────────────────────────

function StartDialog({ open, gdo, onClose }: { open: boolean; gdo: GDO; onClose: () => void }) {
  const user = useAuthStore(s => s.user)
  const { data: employees = [] } = useWarehouseEmployees(gdo.warehouse_id)
  const { mutate: startGDO, isPending } = useStartGDO()
  const [err, setErr] = useState<string | null>(null)

  const allItems    = (gdo.delivery_orders ?? []).flatMap(d => d.items)
  const isContainer = allItems.some(i => i.export_type?.toLowerCase().includes('cont'))

  const [form, setForm] = useState({
    license_plate:      '',
    container_number:   '',
    exporter_name:      user?.name ?? '',
    loader_name:        '',
    forklift_driver_id: '',
  })

  function handleSubmit() {
    if (!form.license_plate.trim()) { setErr('Vui lòng nhập biển số xe'); return }
    setErr(null)
    startGDO(
      { id: gdo.id, ...form, forklift_driver_id: form.forklift_driver_id || undefined },
      {
        onSuccess: onClose,
        onError: (e) => {
          const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setErr(msg)
        },
      }
    )
  }

  function set(field: keyof typeof form, val: string) {
    setForm(f => ({ ...f, [field]: val }))
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">Bắt đầu xuất kho</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Biển số xe *</Label>
            <Input className="text-lg h-10" placeholder="VD: 30A-12345"
              value={form.license_plate} onChange={e => set('license_plate', e.target.value.toUpperCase())} />
          </div>
          {isContainer && (
            <div className="space-y-1">
              <Label className="text-xs">Số container</Label>
              <Input className="text-lg h-10" placeholder="VD: ABCD1234567"
                value={form.container_number} onChange={e => set('container_number', e.target.value.toUpperCase())} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Người xuất</Label>
            <Input className="text-sm h-9" value={form.exporter_name}
              onChange={e => set('exporter_name', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bốc xếp</Label>
            <Input className="text-sm h-9" placeholder="Tên bốc xếp"
              value={form.loader_name} onChange={e => set('loader_name', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lái xe nâng</Label>
            <Select value={form.forklift_driver_id} onValueChange={v => set('forklift_driver_id', v)}>
              <SelectTrigger className="text-sm h-9">
                <SelectValue placeholder="Chọn lái xe nâng…" />
              </SelectTrigger>
              <SelectContent>
                {employees.map(emp => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name} {emp.employee_code ? `(${emp.employee_code})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {err && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Hủy</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu…' : 'Bắt đầu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Row color by item status ──────────────────────────────────

function itemTextCls(item: OutboundItem): string {
  if (item.material_type === 'POSM') return 'text-green-700'
  if (item.cartons_ordered === 0) return ''
  if (item.cartons_scanned >= item.cartons_ordered) return 'text-blue-700'
  if (item.cartons_scanned > 0) return 'text-amber-700'
  return 'text-slate-400'
}

function itemRowBg(item: OutboundItem): string {
  if (item.status === 'COMPLETED')   return 'bg-blue-50 hover:bg-blue-100'
  if (item.status === 'IN_PROGRESS') return 'bg-amber-50 hover:bg-amber-100'
  return 'hover:bg-slate-50'
}

// ─── Items table ───────────────────────────────────────────────

function ItemsTable({ doRecords, gdoId }: {
  doRecords: OutboundDelivery[]
  gdoId: string
}) {
  const navigate = useNavigate()
  const allItems = doRecords.flatMap(d =>
    d.items.map(i => ({ ...i, delivery_code: d.delivery_code, distributor_name: d.distributor_name }))
  )

  // Determine which optional columns have data
  const hasHeaderText    = allItems.some(i => i.header_text)
  const hasBatchRequired = allItems.some(i => i.batch_required)
  const hasDateRequired  = allItems.some(i => i.date_required)
  const hasBoxes         = allItems.some(i => i.boxes_display > 0)

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-full">
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
            <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên hàng</TableHead>
            <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Thùng</TableHead>
            {hasBoxes         && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Hộp</TableHead>}
            {hasHeaderText    && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Header</TableHead>}
            {hasBatchRequired && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Batch</TableHead>}
            {hasDateRequired  && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Date req.</TableHead>}
            <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Số DO</TableHead>
            <TableHead className="w-5 px-1 py-1.5" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {allItems.map(item => {
            const textCls = itemTextCls(item)
            const rowBg   = itemRowBg(item)
            const matCode = item.material?.material_code ?? item.material_code_raw ?? '—'
            const matName = item.material?.short_name ?? item.material_code_raw ?? '—'

            return (
              <TableRow
                key={item.id}
                className={`cursor-pointer transition-colors ${rowBg}`}
                onClick={() => navigate(`/wms/outbound/${gdoId}/items/${item.id}`)}
              >
                <TableCell className={`px-2 py-1 align-top whitespace-nowrap`}>
                  <div className={`text-[10px] font-mono font-semibold ${textCls}`}>{matCode}</div>
                </TableCell>
                <TableCell className={`px-2 py-1 align-top`}>
                  <div className={`text-[10px] font-medium leading-tight ${textCls}`}>{matName}</div>
                  {item.material_type !== 'POSM' && (
                    <ProgressBar compact scanned={item.cartons_scanned} ordered={item.cartons_ordered} />
                  )}
                  {(item.scan_entries?.length ?? 0) > 0 && (
                    <div className="text-[9px] text-slate-400 mt-0.5">{item.scan_entries.length} pallet</div>
                  )}
                </TableCell>
                <TableCell className={`px-2 py-1 align-top text-right whitespace-nowrap`}>
                  <span className={`text-[10px] font-semibold tabular-nums ${textCls}`}>{item.cartons_ordered}</span>
                </TableCell>
                {hasBoxes && (
                  <TableCell className={`px-2 py-1 align-top text-right`}>
                    {item.boxes_display > 0
                      ? <span className={`text-[10px] tabular-nums ${textCls}`}>{item.boxes_display}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                {hasHeaderText && (
                  <TableCell className="px-2 py-1 align-top">
                    {item.header_text
                      ? <span className="text-[10px] text-slate-600">{item.header_text}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                {hasBatchRequired && (
                  <TableCell className="px-2 py-1 align-top">
                    {item.batch_required
                      ? <span className="text-[10px] text-slate-600">{item.batch_required}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                {hasDateRequired && (
                  <TableCell className="px-2 py-1 align-top">
                    {item.date_required
                      ? <span className="text-[10px] text-slate-600">{format(parseISO(item.date_required), 'dd/MM/yy', { locale: vi })}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                <TableCell className="px-2 py-1 align-top whitespace-nowrap">
                  <span className="text-[10px] text-slate-500 font-mono">{item.delivery_code}</span>
                </TableCell>
                <TableCell className="px-1 py-1 align-top">
                  <ChevronRight className="h-3 w-3 text-slate-300" />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function OutboundDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)

  const { data: gdo, isLoading } = useGDO(id)
  const { mutate: assignGDO, isPending: assigning } = useAssignGDO()
  const { mutate: patchGDO,  isPending: patching  } = usePatchGDO()
  const { vehicles, pin, unpin, isPinned, update } = useActiveVehiclesStore()
  const pinned = isPinned(id ?? '')

  const canManagePause = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_MANAGER'

  const [showStart, setShowStart] = useState(false)

  useEffect(() => {
    if (gdo) update(gdo.id, gdo.status)
  }, [gdo?.status, gdo?.id])

  if (isLoading || !gdo) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>
    )
  }

  const allDOs    = gdo.delivery_orders ?? []
  const allItems  = allDOs.flatMap(d => d.items)
  const countable = allItems.filter(i =>
    i.material_type !== 'POSM' && i.material_type !== 'Pallet Loscam' && !(i.material_code_raw ?? '').includes('810000')
  )
  const totalOrdered = countable.reduce((s, i) => s + i.cartons_ordered, 0)
  const totalScanned = countable.reduce((s, i) => s + i.cartons_scanned, 0)

  const npp = [...new Set(allDOs.map(d => d.distributor_name).filter(Boolean))].join(', ')

  // Workflow state
  const canStart = !!gdo.assigned_at && !gdo.started_at

  return (
    <>
      {showStart && (
        <StartDialog open={showStart} gdo={gdo} onClose={() => setShowStart(false)} />
      )}

      <div className="flex flex-col h-full min-h-0">

        {/* ── Header: ~20% ── */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '22vh' }}>

          {/* Row 1: back + code + status + buttons */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <button onClick={() => navigate('/wms/outbound')}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-mono font-semibold text-sm">{gdo.group_code}</span>
              <Badge status={gdo.status} />
              <button
                onClick={() => pinned
                  ? unpin(gdo.id)
                  : pin({ id: gdo.id, group_code: gdo.group_code, status: gdo.status })
                }
                className={`p-1 rounded transition-colors shrink-0 ${pinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
                title={pinned ? 'Bỏ đánh dấu đang làm' : 'Đánh dấu đang làm xe này'}
              >
                <Bookmark className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} />
              </button>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!gdo.assigned_at && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-2" disabled={assigning}
                  onClick={() => assignGDO({ id: gdo.id, assigned_by: user?.name ?? undefined })}>
                  <ClipboardList className="h-3 w-3" />
                  {assigning ? '…' : 'Giao đơn'}
                </Button>
              )}
              {canStart && (
                <Button size="sm" className="h-7 text-xs gap-1 px-2" onClick={() => setShowStart(true)}>
                  <Play className="h-3 w-3" />Bắt đầu
                </Button>
              )}
              {canManagePause && gdo.status === 'IN_PROGRESS' && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1 px-2 border-red-200 text-red-600 hover:bg-red-50"
                  disabled={patching}
                  onClick={() => patchGDO({ id: gdo.id, status: 'PAUSED' })}>
                  <Pause className="h-3 w-3" />
                  {patching ? '…' : 'Tạm dừng'}
                </Button>
              )}
              {canManagePause && gdo.status === 'PAUSED' && (
                <Button size="sm" className="h-7 text-xs gap-1 px-2 bg-green-600 hover:bg-green-700"
                  disabled={patching}
                  onClick={() => patchGDO({ id: gdo.id, status: 'IN_PROGRESS' })}>
                  <Play className="h-3 w-3" />
                  {patching ? '…' : 'Tiếp tục'}
                </Button>
              )}
            </div>
          </div>

          {/* Row 2: GDO info compact */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium">{format(parseISO(gdo.delivery_date), 'dd/MM/yy', { locale: vi })}</span>
              {gdo.delivery_date !== gdo.planned_date && (
                <span className="text-amber-600 ml-0.5">(KH {format(parseISO(gdo.planned_date), 'dd/MM')})</span>
              )}
            </span>
            {gdo.dvvt && <span>{gdo.dvvt}</span>}
            {npp && <span className="text-slate-500 truncate max-w-[160px]">{npp}</span>}
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium">{totalScanned}/{totalOrdered}</span> thùng
            </span>
          </div>

          {/* Start info */}
          {gdo.started_at && (
            <Card className="px-2 py-1 bg-blue-50 border-blue-200">
              <div className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-slate-700">
                <span><strong>Biển số:</strong> {gdo.license_plate}</span>
                {gdo.container_number && <span><strong>Cont:</strong> {gdo.container_number}</span>}
                {gdo.exporter_name    && <span><strong>Xuất:</strong> {gdo.exporter_name}</span>}
                {gdo.loader_name      && <span><strong>Bốc:</strong> {gdo.loader_name}</span>}
                <span className="text-slate-400">{format(parseISO(gdo.started_at), 'dd/MM/yyyy HH:mm:ss', { locale: vi })}</span>
              </div>
            </Card>
          )}

          {gdo.assigned_at && !gdo.started_at && (
            <div className="text-xs text-slate-500">
              Giao đơn: <span className="font-medium">{gdo.assigned_by ?? '—'}</span>
              <span className="text-slate-400 ml-1">{format(parseISO(gdo.assigned_at), 'dd/MM/yyyy HH:mm:ss', { locale: vi })}</span>
            </div>
          )}

          <ProgressBar scanned={totalScanned} ordered={totalOrdered} />
        </div>

        {/* Quick-switch bar — nằm ngoài header để không gây scroll */}
        {vehicles.length > 0 && (
          <div className="border-b bg-white px-3 py-1.5 shrink-0 flex flex-wrap items-center gap-1">
            <span className="text-[9px] text-slate-400 shrink-0">Đang làm:</span>
            {vehicles.map(v => (
              <button
                key={v.id}
                onClick={() => navigate(`/wms/outbound/${v.id}`)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap border transition-colors ${
                  v.id === id
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  v.status === 'IN_PROGRESS' ? 'bg-amber-500'
                  : v.status === 'COMPLETED'  ? 'bg-green-500'
                  : v.status === 'PAUSED'     ? 'bg-red-500'
                  : 'bg-slate-300'
                }`} />
                {v.group_code}
              </button>
            ))}
          </div>
        )}

        {/* ── Items table: ~80% ── */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {allDOs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">Chưa có DO nào</p>
            </div>
          ) : (
            <ItemsTable doRecords={allDOs} gdoId={id!} />
          )}
        </div>
      </div>
    </>
  )
}
