import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  ArrowLeft, CheckCircle2,
  Truck, Package, ClipboardList, Play, ChevronRight,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { Card }    from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useGDO, useAssignGDO, useStartGDO, useWarehouseEmployees,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import type { OutboundItem, OutboundDelivery, OutboundStatus, GDO } from '@/types'

// ─── Status badge ──────────────────────────────────────────────

const statusCls: Record<OutboundStatus, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED:   'bg-green-100 text-green-800',
  CANCELLED:   'bg-red-100 text-red-600',
}
const statusLabel: Record<OutboundStatus, string> = {
  PENDING: 'Chờ xuất', IN_PROGRESS: 'Đang xuất', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy',
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

function ProgressBar({ scanned, ordered }: { scanned: number; ordered: number }) {
  const pct = ordered > 0 ? Math.min(100, (scanned / ordered) * 100) : 0
  const cls = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-lg tabular-nums font-medium ${pct >= 100 ? 'text-green-700 font-semibold' : 'text-slate-600'}`}>
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

// ─── Row color by scan status ──────────────────────────────────

function itemTextCls(item: OutboundItem): string {
  if (item.material_type === 'POSM') return 'text-green-700'
  if (item.cartons_ordered === 0) return ''
  if (item.cartons_scanned >= item.cartons_ordered) return 'text-blue-700'
  if (item.cartons_scanned > 0) return 'text-amber-700'
  return 'text-slate-400'
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
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead className="text-xs text-slate-500 px-3 py-2 whitespace-nowrap">Mã hàng</TableHead>
          <TableHead className="text-xs text-slate-500 px-3 py-2">Tên hàng</TableHead>
          <TableHead className="text-xs text-slate-500 px-3 py-2 text-right whitespace-nowrap">Thùng</TableHead>
          {hasBoxes         && <TableHead className="text-xs text-slate-500 px-3 py-2 text-right whitespace-nowrap">Hộp</TableHead>}
          {hasHeaderText    && <TableHead className="text-xs text-slate-500 px-3 py-2 whitespace-nowrap hidden md:table-cell">Header text</TableHead>}
          {hasBatchRequired && <TableHead className="text-xs text-slate-500 px-3 py-2 whitespace-nowrap hidden md:table-cell">Batch req.</TableHead>}
          {hasDateRequired  && <TableHead className="text-xs text-slate-500 px-3 py-2 whitespace-nowrap hidden md:table-cell">Date req.</TableHead>}
          <TableHead className="text-xs text-slate-500 px-3 py-2 w-[80px]">TT</TableHead>
          <TableHead className="w-6 px-2 py-2" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {allItems.map(item => {
          const textCls = itemTextCls(item)
          const matCode = item.material?.material_code ?? item.material_code_raw ?? '—'
          const matName = item.material?.custom_short_name ?? item.material?.short_name ?? item.material_code_raw ?? '—'

          return (
            <TableRow
              key={item.id}
              className="cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => navigate(`/wms/outbound/${gdoId}/items/${item.id}`)}
            >
              <TableCell className={`px-3 py-2 align-top ${textCls}`}>
                <div className="text-xs text-slate-400 tabular-nums">{item.delivery_code}</div>
                <div className={`text-lg font-mono font-semibold mt-0.5 ${textCls}`}>{matCode}</div>
              </TableCell>
              <TableCell className={`px-3 py-2 align-top ${textCls}`}>
                <div className={`text-lg font-medium leading-tight ${textCls}`}>{matName}</div>
                {item.material_type !== 'POSM' && (
                  <ProgressBar scanned={item.cartons_scanned} ordered={item.cartons_ordered} />
                )}
                {(item.scan_entries?.length ?? 0) > 0 && (
                  <div className="text-[11px] text-slate-400 mt-0.5">{item.scan_entries.length} pallet</div>
                )}
              </TableCell>
              <TableCell className={`px-3 py-2 align-top text-right ${textCls}`}>
                <span className={`text-lg font-semibold tabular-nums ${textCls}`}>{item.cartons_ordered}</span>
              </TableCell>
              {hasBoxes && (
                <TableCell className={`px-3 py-2 align-top text-right ${textCls}`}>
                  {item.boxes_display > 0
                    ? <span className={`text-lg tabular-nums ${textCls}`}>{item.boxes_display}</span>
                    : <span className="text-slate-300">—</span>}
                </TableCell>
              )}
              {hasHeaderText && (
                <TableCell className="px-3 py-2 align-top hidden md:table-cell">
                  {item.header_text
                    ? <span className="text-lg text-slate-600">{item.header_text}</span>
                    : <span className="text-slate-300 text-lg">—</span>}
                </TableCell>
              )}
              {hasBatchRequired && (
                <TableCell className="px-3 py-2 align-top hidden md:table-cell">
                  {item.batch_required
                    ? <span className="text-lg text-slate-600">{item.batch_required}</span>
                    : <span className="text-slate-300 text-lg">—</span>}
                </TableCell>
              )}
              {hasDateRequired && (
                <TableCell className="px-3 py-2 align-top hidden md:table-cell">
                  {item.date_required
                    ? <span className="text-lg text-slate-600">{format(parseISO(item.date_required), 'dd/MM/yy', { locale: vi })}</span>
                    : <span className="text-slate-300 text-lg">—</span>}
                </TableCell>
              )}
              <TableCell className="px-3 py-2 align-top">
                {item.status === 'COMPLETED'
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                  : <Badge status={item.status} />}
              </TableCell>
              <TableCell className="px-2 py-2 align-top">
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function OutboundDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)

  const { data: gdo, isLoading } = useGDO(id)
  const { mutate: assignGDO, isPending: assigning } = useAssignGDO()

  const [showStart, setShowStart] = useState(false)

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

        {/* ── Header ── */}
        <div className="border-b bg-white px-4 pt-3 pb-3 shrink-0 space-y-2">

          {/* Row 1: back + code + status + workflow */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => navigate('/wms/outbound')}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-mono font-semibold text-lg">{gdo.group_code}</span>
              <Badge status={gdo.status} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Giao đơn: always visible until assigned */}
              {!gdo.assigned_at && (
                <Button size="sm" variant="outline" className="h-8 text-sm gap-1" disabled={assigning}
                  onClick={() => assignGDO({ id: gdo.id, assigned_by: user?.name ?? undefined })}>
                  <ClipboardList className="h-3.5 w-3.5" />
                  {assigning ? '…' : 'Giao đơn'}
                </Button>
              )}
              {/* Bắt đầu: only after Giao đơn */}
              {canStart && (
                <Button size="sm" className="h-8 text-sm gap-1" onClick={() => setShowStart(true)}>
                  <Play className="h-3.5 w-3.5" />Bắt đầu
                </Button>
              )}
              {/* Tooltip when assigned but not started not possible anymore (canStart handles it) */}
              {!gdo.assigned_at && !gdo.started_at && (
                <span className="text-xs text-slate-400 italic hidden sm:inline">Giao đơn trước để bắt đầu</span>
              )}
            </div>
          </div>

          {/* Row 2: GDO info */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-lg text-slate-600">
            <span className="flex items-center gap-1.5">
              <Truck className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="font-medium">
                {format(parseISO(gdo.delivery_date), 'dd/MM/yyyy', { locale: vi })}
              </span>
              {gdo.delivery_date !== gdo.planned_date && (
                <span className="text-amber-600 text-sm ml-1">
                  (KH: {format(parseISO(gdo.planned_date), 'dd/MM')})
                </span>
              )}
            </span>
            {gdo.dvvt && <span>{gdo.dvvt}</span>}
            {npp && <span className="text-slate-500">{npp}</span>}
            <span className="flex items-center gap-1.5">
              <Package className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="font-medium">{totalScanned}/{totalOrdered}</span> thùng
            </span>
          </div>

          {/* Start info */}
          {gdo.started_at && (
            <Card className="px-3 py-2 bg-blue-50 border-blue-200 text-lg">
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-700">
                <span><strong>Biển số:</strong> {gdo.license_plate}</span>
                {gdo.container_number && <span><strong>Cont:</strong> {gdo.container_number}</span>}
                {gdo.exporter_name    && <span><strong>Người xuất:</strong> {gdo.exporter_name}</span>}
                {gdo.loader_name      && <span><strong>Bốc xếp:</strong> {gdo.loader_name}</span>}
                <span className="text-slate-500 text-lg">
                  Bắt đầu: {format(parseISO(gdo.started_at), 'HH:mm dd/MM', { locale: vi })}
                </span>
              </div>
            </Card>
          )}

          {gdo.assigned_at && !gdo.started_at && (
            <div className="text-lg text-slate-500">
              Giao đơn: <span className="font-medium">{gdo.assigned_by ?? '—'}</span>
              <span className="text-lg text-slate-400 ml-1">lúc {format(parseISO(gdo.assigned_at), 'HH:mm dd/MM', { locale: vi })}</span>
            </div>
          )}

          <ProgressBar scanned={totalScanned} ordered={totalOrdered} />
        </div>

        {/* ── Items table ── */}
        <div className="flex-1 overflow-auto pb-20 lg:pb-4">
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
