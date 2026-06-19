import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { AxiosError }              from 'axios'
import {
  ArrowLeft, Plus, CheckCircle2, XCircle, Trash2, Pencil,
  MapPin, Package, AlertTriangle, QrCode,
  Clock, Calendar, User, Bookmark, RotateCcw,
} from 'lucide-react'
import { format, parseISO }    from 'date-fns'
import { vi }                  from 'date-fns/locale'
import { TableSkeleton }       from '@/components/shared/TableSkeleton'
import { InboundScanSheet }    from '@/components/wms/InboundScanSheet'
import { Button }              from '@/components/ui/button'
import { Input }               from '@/components/ui/input'
import { Label }               from '@/components/ui/label'
import { Card }                from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  useInboundOrder, useInboundOrders, useCancelInboundOrder,
  useCompleteInboundOrder, useUncompleteInboundOrder,
  useScanManualPallet, useDeletePalletEntry, useDeletePalletEntries,
  useLocationsReal, useUpdateInboundOrder, useUpdatePalletEntry, useSetInboundOrderLocation,
} from '@/api/hooks'
import { useAuthStore }            from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useActiveInboundStore }  from '@/stores/activeInboundStore'
import { statusText } from '@/lib/rowStatus'
import { inboundKey } from './Inbound'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { inboundOrderStatusLabel, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { unlockAudio }             from '@/utils/audio'
import type { InboundOrder, InboundOrderStatus, PalletEntry } from '@/types'

// ─── Status badge ─────────────────────────────────────────────

const statusVariant: Record<InboundOrderStatus, string> = {
  OPEN:      'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-800',
}
function InboundStatusBadge({ status }: { status: string }) {
  const cls = statusVariant[status as InboundOrderStatus] ?? 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {inboundOrderStatusLabel[status] ?? status}
    </span>
  )
}

// ─── Pinned inbound btn — tự validate phiếu tồn tại, ẩn và unpin nếu đã bị xóa ──

function PinnedInboundBtn({ o, isCurrent, onUnpin, onNavigate }: {
  o: { id: string; import_code: string; status: string; location_code?: string; mat_code?: string }
  isCurrent: boolean
  onUnpin: (id: string) => void
  onNavigate: (id: string) => void
}) {
  const { data: ord, isLoading, isPlaceholderData } = useInboundOrder(isCurrent ? undefined : o.id)
  const isGone = !isCurrent && !isLoading && !isPlaceholderData && !ord

  useEffect(() => {
    if (isGone) onUnpin(o.id)
  }, [isGone, o.id, onUnpin])

  if (isGone) return null

  const barLabel = (o.location_code || o.mat_code)
    ? `${o.location_code ?? '—'}_${o.mat_code?.slice(-3) ?? '—'}`
    : o.import_code

  return (
    <button
      onClick={() => !isCurrent && onNavigate(o.id)}
      className={[
        'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors',
        isCurrent
          ? 'bg-amber-100 text-amber-800 border-amber-300 font-semibold cursor-default'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-amber-50 cursor-pointer',
      ].join(' ')}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
        o.status === 'OPEN'        ? 'bg-amber-500'
        : o.status === 'COMPLETED' ? 'bg-blue-500'
        : 'bg-slate-400'
      }`} />
      {barLabel}
    </button>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function InboundDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoScan = searchParams.get('scan') === '1'

  const { data: order, isLoading, isPlaceholderData } = useInboundOrder(id)
  const { data: allLocations = [] } = useLocationsReal(
    order?.warehouse_id
      ? { warehouse_id: order.warehouse_id, ...(order.warehouse_type ? { category: order.warehouse_type } : {}), ...(order.material_id ? { material_id: order.material_id } : {}) }
      : undefined
  )

  // Tab bar: tất cả phiếu OPEN của kho + ngày này (để lái xe nâng nhảy qua lại)
  const { data: openOrders = [] } = useInboundOrders(
    order?.warehouse_id && order?.import_date
      ? { warehouse_id: order.warehouse_id, date: order.import_date.slice(0, 10) }
      : undefined
  )

  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null

  const { orders: pinnedOrders, pin, unpin, isPinned, update } = useActiveInboundStore()
  useEffect(() => {
    if (order) update(order.id, order.status)
  }, [order?.id, order?.status]) // eslint-disable-line

  const { mutate: cancelOrder,     isPending: cancelling    } = useCancelInboundOrder()
  const { mutate: completeOrder,   isPending: completing    } = useCompleteInboundOrder()
  const { mutate: uncompleteOrder, isPending: uncompleting  } = useUncompleteInboundOrder()
  const { mutate: deleteEntry                                } = useDeletePalletEntry()
  const { mutate: deleteEntries                         } = useDeletePalletEntries()
  const { mutate: updateOrder                           } = useUpdateInboundOrder()
  const { mutate: setOrderLocation                      } = useSetInboundOrderLocation()
  const [locError, setLocError] = useState<string | null>(null)
  const changeLoc = (v: string) => setOrderLocation(
    { id: order!.id, location_id: v },
    { onSuccess: () => setLocError(null),
      onError: (e) => setLocError((e as AxiosError<{ error?: { message?: string } }>).response?.data?.error?.message ?? 'Không đổi được vị trí') },
  )
  const { mutate: updateEntry, isPending: saving        } = useUpdatePalletEntry()
  // Đổi vị trí phiếu = thao tác đặt pallet → quyền edit_pallet (của mình) / force_edit_pallet (bất kỳ),
  // KHÔNG dùng quyền `edit` (vốn là "Sửa nhóm phiếu NCC"). Tách riêng theo chuẩn 1 action = 1 quyền.
  const canSetLocation = can(perms, 'inbound', 'edit_pallet') || can(perms, 'inbound', 'force_edit_pallet')

  // Vị trí cho dropdown đổi vị trí: hiện (đã dùng/sức chứa) + ★ khuyến nghị (đang để dở cùng loại,
  // còn chỗ) — đồng bộ với form tạo phiếu. ★ đẩy lên đầu, còn lại giữ thứ tự.
  type LocOpt = { id: string; location_code: string; used_slots?: number; max_pallets: number; has_same_material?: boolean }
  const locFull = (l: LocOpt) => l.max_pallets > 0 && (l.used_slots ?? 0) >= l.max_pallets
  const locRec  = (l: LocOpt) => !!l.has_same_material && !locFull(l)
  const locOptions = [...(allLocations as LocOpt[])].sort((a, b) => (locRec(b) ? 1 : 0) - (locRec(a) ? 1 : 0))
  function renderLocItems() {
    return locOptions.map(l => {
      const isPartial = (l.used_slots ?? 0) > 0 && !locFull(l)
      return (
        <SelectItem key={l.id} value={l.id}>
          {locRec(l) && <span className="text-amber-500 font-bold mr-1">★</span>}
          <span className={locFull(l) ? 'text-blue-700 font-semibold' : isPartial ? 'text-amber-600' : ''}>{l.location_code}</span>
          <span className="ml-2 text-xs text-slate-400">({l.used_slots ?? 0}/{l.max_pallets}{l.has_same_material ? ' · đang để' : ''})</span>
        </SelectItem>
      )
    })
  }
  const { mutate: saveManual, isPending: savingManual   } = useScanManualPallet()

  const isManualEntry = (order?.material as any)?.no_qr_tracking === true

  const [showScan,          setShowScan]          = useState(false)
  const [showManualDialog,  setShowManualDialog]  = useState(false)
  const [manualCartons,     setManualCartons]     = useState('')
  const [manualFeedback,    setManualFeedback]    = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [editState, setEditState] = useState<{ entry: PalletEntry; cartons: number; stack: number } | null>(null)
  const [editingPlannedCartons, setEditingPlannedCartons] = useState(false)
  const [plannedCartonsInput,   setPlannedCartonsInput]   = useState('')

  // Auto-open scan khi navigate từ list với ?scan=1
  useEffect(() => {
    if (autoScan && order && order.status === 'OPEN' && (order.location_id || isManualEntry)) {
      const total = (order.inventory_entries ?? []).reduce((s, e) => s + e.cartons_imported, 0)
      if (order.source_type === 'NCC' && (order.planned_cartons ?? 0) > 0 && total >= (order.planned_cartons ?? 0)) return
      if (isManualEntry) { setShowManualDialog(true); return }
      unlockAudio()
      setShowScan(true)
    }
  }, [autoScan, order]) // eslint-disable-line

  function handleManualSave() {
    const c = Number(manualCartons)
    if (!manualCartons || isNaN(c) || c < 0) { setManualFeedback({ type: 'error', msg: 'Nhập số thùng hợp lệ' }); return }
    saveManual(
      { orderId: order!.id, cartons: c, employee_id: user?.id },
      {
        onSuccess: () => { setManualFeedback(null); setShowManualDialog(false) },
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi lưu'
          setManualFeedback({ type: 'error', msg })
        },
      }
    )
  }

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ title: string; msg: string; onOk: () => void } | null>(null)
  const [completeDlg, setCompleteDlg] = useState<'complete' | 'uncomplete' | null>(null)

  function openConfirm(title: string, msg: string, onOk: () => void) {
    setConfirm({ title, msg, onOk })
  }

  const isOpen      = order?.status === 'OPEN'
  const isCompleted = order?.status === 'COMPLETED'
  const entries     = order?.inventory_entries ?? []
  const totalScanned = entries.reduce((sum, e) => sum + e.cartons_imported, 0)
  // Mô hình "1 phiếu = 1 vị trí": header hiện vị trí HIỆN TẠI (order.location, =vị trí chọn cuối).
  // Pallet nằm ở vị trí KHÁC → CẢNH BÁO lệch (không tự dời dữ liệu).
  const curLocCode = order?.location?.location_code ?? null
  const palletLocCodes = [...new Set(entries.map(e => (e as any).location?.location_code).filter(Boolean))] as string[]
  const offLocCodes = palletLocCodes.filter(c => c !== curLocCode)
  const headerLocText = curLocCode ?? (palletLocCodes[0] ?? null)
  const headerLocMismatch = offLocCodes.length > 0
  const headerLocTitle = headerLocMismatch ? `⚠ Pallet đang ở vị trí khác: ${offLocCodes.join(', ')}` : undefined
  const locHistory = ((order as any)?.location_history ?? []) as { location_code: string; by_name: string | null; at: string; source: string }[]
  const isNccFull   = order?.source_type === 'NCC' && (order?.planned_cartons ?? 0) > 0 && totalScanned >= (order?.planned_cartons ?? 0)

  function canDeleteEntry(entry: PalletEntry): boolean {
    if (!isOpen) return false
    // Mã no-QR là pool dùng chung (có thể PARTIAL khi đã xuất 1 phần) — không chặn theo status; backend tự validate phần còn trống
    if (!isManualEntry && entry.status !== 'IN_STOCK') return false
    if (can(perms, 'inbound', 'force_delete_pallet')) return true
    if (!can(perms, 'inbound', 'delete_pallet')) return false
    if (!user?.id || entry.created_by_emp?.id !== user.id) return false
    const importDate = new Date(entry.import_date ?? entry.created_at)
    return (Date.now() - importDate.getTime()) / 86_400_000 <= 2
  }

  function canEditEntry(entry: PalletEntry): boolean {
    if (!isOpen) return false
    if (!isManualEntry && entry.status !== 'IN_STOCK') return false
    if (can(perms, 'inbound', 'force_edit_pallet')) return true
    if (!can(perms, 'inbound', 'edit_pallet')) return false
    if (!user?.id || entry.created_by_emp?.id !== user.id) return false
    const importDate = new Date(entry.import_date ?? entry.created_at)
    return (Date.now() - importDate.getTime()) / 86_400_000 <= 2
  }

  function toggleAll() {
    if (entries.length > 0 && entries.every(e => selectedIds.has(e.id)))
      setSelectedIds(new Set())
    else
      setSelectedIds(new Set(entries.filter(canDeleteEntry).map(e => e.id)))
  }

  function toggleEntry(id: string) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const allDeletableSelected = entries.filter(canDeleteEntry).length > 0 &&
    entries.filter(canDeleteEntry).every(e => selectedIds.has(e.id))

  // Auto-redirect khi phiếu không còn tồn tại (bị xóa/hủy, ghost từ cache)
  useEffect(() => {
    if (!isLoading && !isPlaceholderData && !order) {
      if (id) unpin(id)
      navigate('/wms/inbound', { replace: true })
    }
  }, [isLoading, isPlaceholderData, order, navigate, id, unpin])

  if (isLoading && !order) {
    return <div className="p-6"><TableSkeleton rows={8} cols={7} /></div>
  }

  if (!order) {
    return <div className="p-6"><TableSkeleton rows={8} cols={7} /></div>
  }

  return (
    <>
      {showScan && (
        <InboundScanSheet
          order={order}
          onClose={() => setShowScan(false)}
          employeeId={user?.id}
          allLocations={allLocations as any}
        />
      )}

      {/* ── Manual entry dialog (POSM / Loscam) ── */}
      <Dialog open={showManualDialog} onOpenChange={v => { if (!v) { setManualFeedback(null); setShowManualDialog(false) } }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle className="text-base">Xác nhận số lượng</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500">Số thùng thực nhập</p>
              <Input
                type="number" min={0}
                value={manualCartons}
                onChange={e => setManualCartons(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleManualSave()}
                className="text-center font-semibold text-lg h-11"
                autoFocus
              />
              {(order?.planned_cartons ?? 0) > 0 && (
                <p className="text-xs text-slate-400 text-center">Kế hoạch: {order.planned_cartons} thùng</p>
              )}
            </div>
            {manualFeedback && (
              <div className={`rounded-lg p-2.5 text-sm ${manualFeedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {manualFeedback.msg}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" disabled={savingManual} onClick={() => { setManualFeedback(null); setShowManualDialog(false) }}>Hủy</Button>
            <Button size="sm" disabled={savingManual} onClick={handleManualSave}>
              {savingManual ? 'Đang lưu…' : 'Xác nhận'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit pallet dialog ── */}
      {editState && (
        <Dialog open onOpenChange={(v) => { if (!v) setEditState(null) }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle className="text-sm">Sửa pallet <span className="font-mono">{editState.entry.pallet_code}</span></DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label className="text-xs">Số thùng</Label>
                <Input
                  type="number" min={1}
                  className="h-8 text-sm"
                  value={editState.cartons}
                  onChange={(e) => setEditState(s => s && ({ ...s, cartons: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tầng chồng</Label>
                <Input
                  type="number" min={1}
                  className="h-8 text-sm"
                  value={editState.stack}
                  onChange={(e) => setEditState(s => s && ({ ...s, stack: Number(e.target.value) }))}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditState(null)}>Hủy</Button>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => {
                  if (!editState) return
                  updateEntry(
                    {
                      orderId: order!.id,
                      entryId: editState.entry.id,
                      cartons_imported: editState.cartons,
                      stack_layer: editState.stack,
                      employee_id: user?.id,
                    },
                    { onSuccess: () => setEditState(null) }
                  )
                }}
              >
                {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Confirm dialog ── */}
      {completeDlg && order && (() => {
        const planned = order.planned_cartons ?? 0
        const actual  = totalScanned
        const diff    = actual - planned
        const hasPlan = planned > 0
        const statusEl = !hasPlan
          ? <span className="text-slate-400 text-xs">Không có kế hoạch số thùng</span>
          : diff === 0
            ? <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Đúng kế hoạch</span>
            : diff < 0
              ? <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Thiếu {Math.abs(diff)} thùng so với kế hoạch</span>
              : <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">Thừa {diff} thùng so với kế hoạch</span>
        const isComplete = completeDlg === 'complete'
        return (
          <Dialog open onOpenChange={(v) => { if (!v) setCompleteDlg(null) }}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{isComplete ? 'Xác nhận hoàn thành phiếu' : 'Gỡ hoàn thành phiếu'}</DialogTitle>
              </DialogHeader>
              {isComplete ? (
                <div className="py-2 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Kế hoạch</span>
                    <span className="font-medium">{hasPlan ? `${planned} thùng` : '—'}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Thực nhập</span>
                    <span className="font-semibold">{actual} thùng</span>
                  </div>
                  <div className="pt-1">{statusEl}</div>
                </div>
              ) : (
                <p className="text-sm text-slate-600 py-1">Phiếu sẽ về trạng thái <strong>Đang nhập</strong> và có thể tiếp tục quét thêm.</p>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setCompleteDlg(null)}>Hủy</Button>
                <Button
                  className={isComplete ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-slate-700 hover:bg-slate-800 text-white'}
                  disabled={completing || uncompleting}
                  onClick={() => {
                    setCompleteDlg(null)
                    if (isComplete) completeOrder(order.id)
                    else uncompleteOrder(order.id)
                  }}
                >
                  {isComplete ? 'Hoàn thành' : 'Xác nhận gỡ'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )
      })()}

      {confirm && (
        <Dialog open onOpenChange={(v) => { if (!v) setConfirm(null) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>{confirm.title}</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-600 py-1">{confirm.msg}</p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)}>Không</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => { confirm.onOk(); setConfirm(null) }}
              >
                Xác nhận
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="flex flex-col h-full sm:p-3">
       <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm overflow-hidden">

        {/* ── "Đang làm" quick-switch bar ── */}
        {pinnedOrders.length > 0 && (
          <div className="shrink-0 border-b bg-amber-50/60 px-2 py-1">
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-[9px] text-amber-600 font-medium shrink-0">Đang làm:</span>
              {pinnedOrders.map(o => (
                <PinnedInboundBtn
                  key={o.id}
                  o={o}
                  isCurrent={o.id === id}
                  onUnpin={unpin}
                  onNavigate={oid => navigate(`/wms/inbound/${oid}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Tab bar (nhảy qua lại giữa các phiếu đang mở) ── */}
        {openOrders.length > 1 && (
          <div className="flex flex-wrap shrink-0 border-b bg-slate-50 gap-0">
            {openOrders.map((o: InboundOrder) => {
              const isActive = o.id === id
              const isNCC    = (o as any).source_type === 'NCC'
              const pallets  = (o as any)._count?.inventory_entries ?? 0
              const loc       = (o as any).location?.location_code ?? '—'
              const matCode3  = o.material?.material_code?.slice(-3) ?? '—'
              const label     = `${loc}_${matCode3}`
              return (
                <button
                  key={o.id}
                  onClick={() => navigate(`/wms/inbound/${o.id}`)}
                  className={[
                    'flex items-center gap-1 px-2 py-1.5 text-[10px] border-b-2 transition-colors text-left',
                    isActive
                      ? 'border-blue-600 text-blue-700 font-semibold bg-white'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100',
                  ].join(' ')}
                >
                  {isNCC && (
                    <span className="rounded px-1 py-0.5 text-[8px] font-bold bg-green-100 text-green-700 shrink-0">NCC</span>
                  )}
                  <span>{label}</span>
                  <span className="ml-1 rounded-full bg-slate-200 text-slate-600 px-1.5 py-0.5 text-[8px] font-mono shrink-0">{pallets}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* ── Compact header (~20%) ── */}
        <div className="border-b bg-white px-4 pt-3 pb-3 shrink-0 space-y-2">

          {/* Row 1: navigation + code + status + actions */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => navigate('/wms/inbound')}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className={`font-semibold font-mono text-sm truncate ${statusText(inboundKey(order))}`}>
                {order.import_code ?? order.id.slice(0, 8)}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => isPinned(order.id)
                  ? unpin(order.id)
                  : pin({ id: order.id, import_code: order.import_code ?? order.id.slice(0, 8), status: order.status, location_code: order.location?.location_code, mat_code: order.material?.material_code })
                }
                title={isPinned(order.id) ? 'Bỏ đánh dấu đang làm' : 'Đánh dấu đang làm'}
                className="p-1 rounded hover:bg-slate-100 transition-colors"
              >
                <Bookmark className={`h-4 w-4 transition-colors ${isPinned(order.id) ? 'fill-amber-400 text-amber-500' : 'text-slate-300 hover:text-slate-500'}`} />
              </button>
              {isOpen && entries.length === 0 && can(perms, 'inbound', 'cancel') && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs px-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                  disabled={cancelling}
                  onClick={() => openConfirm(
                    'Hủy phiếu nhập',
                    `Xác nhận hủy phiếu "${order.import_code ?? order.id.slice(0, 8)}"? Thao tác này không thể hoàn tác.`,
                    () => cancelOrder(order.id, { onSuccess: () => navigate('/wms/inbound') })
                  )}
                >
                  <XCircle className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">{cancelling ? 'Đang hủy…' : 'Hủy phiếu'}</span>
                </Button>
              )}
              {isOpen && can(perms, 'inbound', 'complete') && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs px-2 text-green-700 border-green-300 hover:bg-green-50 hover:text-green-800 disabled:opacity-40"
                  disabled={completing}
                  onClick={() => setCompleteDlg('complete')}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">{completing ? 'Đang lưu…' : 'Hoàn thành'}</span>
                </Button>
              )}
              {isCompleted && can(perms, 'inbound', 'uncomplete') && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs px-2 text-slate-600 border-slate-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40"
                  disabled={uncompleting}
                  onClick={() => setCompleteDlg('uncomplete')}
                >
                  <RotateCcw className="h-3.5 w-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">{uncompleting ? 'Đang gỡ…' : 'Gỡ hoàn thành'}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Row 2: info chips */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            {((order as any).from_gdo_delivery_codes?.length ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">Số DO:</span>
                <span className="font-mono font-semibold text-blue-700">{(order as any).from_gdo_delivery_codes.join(' · ')}</span>
              </span>
            )}

            {(order as any).tms_order?.order_code && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">Mã lệnh:</span>
                <span className="font-mono font-semibold text-purple-700">{(order as any).tms_order.order_code}</span>
              </span>
            )}

            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium">{order.material?.material_code}</span>
              {order.material?.short_name && (
                <span className="text-slate-500">– {order.material.short_name}</span>
              )}
            </span>

            {!isManualEntry && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                {headerLocText ? (
                  <span className="flex items-center gap-1">
                    <span className="font-mono font-medium" title={headerLocTitle}>{headerLocText}</span>
                    {headerLocMismatch && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                    {isOpen && canSetLocation && (
                      <Select onValueChange={changeLoc}>
                        <SelectTrigger className="h-6 w-auto gap-1 rounded-md border-0 bg-sky-600 px-2 text-[10px] font-semibold text-white shadow-sm hover:bg-sky-700">
                          <Pencil className="h-3 w-3" /> Đổi vị trí
                        </SelectTrigger>
                        <SelectContent>
                          {renderLocItems()}
                        </SelectContent>
                      </Select>
                    )}
                  </span>
                ) : isOpen ? (
                  <span className="text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Chưa chọn vị trí
                    {canSetLocation && (
                      <Select onValueChange={changeLoc}>
                        <SelectTrigger className="h-6 w-auto gap-1 rounded-md border-0 bg-blue-600 px-2 text-[10px] font-semibold text-white shadow-sm hover:bg-blue-700 ml-1">
                          <MapPin className="h-3 w-3" /> <SelectValue placeholder="Chọn vị trí" />
                        </SelectTrigger>
                        <SelectContent>
                          {renderLocItems()}
                        </SelectContent>
                      </Select>
                    )}
                  </span>
                ) : (
                  <span className="text-slate-400">Chưa chọn</span>
                )}
              </span>
            )}

            {order.shift && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-slate-400 shrink-0" />
                {order.shift.name}
              </span>
            )}

            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
              {format(parseISO(order.import_date ?? order.created_at), 'dd-MM-yyyy', { locale: vi })}
            </span>

            <span className="flex items-center gap-1">
              <User className="h-3 w-3 text-slate-400 shrink-0" />
              {order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'}
            </span>

            {order.gate_registration?.license_plate && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">Xe:</span>
                <span className="font-mono font-semibold text-xs">{order.gate_registration.license_plate}</span>
              </span>
            )}

            {(order as any).source_type === 'TRANSFER' && (order as any).from_gdo && (() => {
              const gdo = (order as any).from_gdo
              const tms = (order as any).tms_order
              return (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 w-full mt-0.5 px-2 py-1 rounded bg-purple-50 border border-purple-100 text-[10px]">
                  <span className="font-semibold text-purple-700">Chuyển kho</span>
                  {gdo.warehouse?.name && <span className="text-slate-500">Từ: <span className="font-medium text-slate-700">{gdo.warehouse.name}</span></span>}
                  {tms?.order_code && <span className="text-slate-500">Lệnh: <span className="font-mono font-semibold text-purple-700">{tms.order_code}</span></span>}
                  {gdo.license_plate && <span className="text-slate-500">Xe: <span className="font-mono font-semibold">{gdo.license_plate}</span></span>}
                  {(gdo.delivery_codes?.length ?? 0) > 0 && <span className="text-slate-500">DO: <span className="font-mono">{gdo.delivery_codes.join(' · ')}</span></span>}
                </span>
              )
            })()}

            {(order.source_type === 'NCC' || order.source_type === 'TRANSFER') && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">Thực:</span>
                <span className="font-semibold font-mono tabular-nums">{totalScanned} thùng</span>
              </span>
            )}

            {(order.source_type === 'NCC' || order.source_type === 'TRANSFER') && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px]">KH:</span>
                {order.source_type === 'TRANSFER' ? (
                  <span className="font-semibold font-mono">
                    {order.planned_cartons != null ? `${order.planned_cartons} thùng` : <span className="text-slate-400 font-normal">—</span>}
                  </span>
                ) : editingPlannedCartons ? (
                  <span className="flex items-center gap-1">
                    <input
                      type="number" min={0}
                      value={plannedCartonsInput}
                      onChange={e => setPlannedCartonsInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          updateOrder({ id: order.id, planned_cartons: plannedCartonsInput === '' ? null : Number(plannedCartonsInput) })
                          setEditingPlannedCartons(false)
                        }
                        if (e.key === 'Escape') setEditingPlannedCartons(false)
                      }}
                      className="h-5 w-16 text-xs border border-slate-300 rounded px-1 font-mono"
                      autoFocus
                    />
                    <button
                      className="text-[10px] text-green-600 hover:text-green-700"
                      onClick={() => {
                        updateOrder({ id: order.id, planned_cartons: plannedCartonsInput === '' ? null : Number(plannedCartonsInput) })
                        setEditingPlannedCartons(false)
                      }}
                    >✓</button>
                    <button className="text-[10px] text-slate-400" onClick={() => setEditingPlannedCartons(false)}>✕</button>
                  </span>
                ) : (
                  <span
                    className={`font-semibold font-mono ${isOpen ? 'cursor-pointer hover:text-blue-600' : ''}`}
                    onClick={() => {
                      if (!isOpen) return
                      setPlannedCartonsInput(order.planned_cartons != null ? String(order.planned_cartons) : '')
                      setEditingPlannedCartons(true)
                    }}
                    title={isOpen ? 'Click để sửa SL dự kiến' : undefined}
                  >
                    {order.planned_cartons != null ? `${order.planned_cartons} thùng` : <span className="text-slate-400 font-normal">—</span>}
                    {isOpen && <Pencil className="inline h-2.5 w-2.5 ml-1 text-slate-400" />}
                  </span>
                )}
              </span>
            )}

            {order.notes && (
              <span className="text-slate-400 italic truncate max-w-[240px]">{order.notes}</span>
            )}
          </div>
        </div>

        {locError && (
          <div className="mx-4 mt-2 rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{locError}</div>
        )}

        {/* Lịch sử đổi vị trí (tối đa 3 vị trí khác nhau/phiếu) */}
        {locHistory.length > 0 && (
          <div className="px-4 py-1.5 border-y border-slate-200 bg-slate-50 flex items-center gap-2 text-[11px] overflow-x-auto">
            <span className="shrink-0 font-medium text-slate-500 inline-flex items-center gap-1">
              <MapPin className="h-3 w-3 text-slate-400" /> Lịch sử vị trí:
            </span>
            {locHistory.map((h, i) => (
              <span key={i} className="shrink-0 inline-flex items-center gap-1">
                {i > 0 && <span className="text-slate-300">→</span>}
                <span className="font-mono font-semibold text-slate-700">{h.location_code}</span>
                <span className="text-slate-400">({h.source === 'scan' ? 'quét' : 'sửa'}{h.by_name ? ` · ${h.by_name}` : ''} · {formatTimestampDate(h.at, true)} {formatTimestampTime(h.at, false)})</span>
              </span>
            ))}
          </div>
        )}

        {/* Dải tile tổng hợp (đồng bộ với list) */}
        <SummaryBand tiles={[
          { label: 'Pallet',    value: entries.length },
          { label: 'Thực nhập', value: `${totalScanned.toLocaleString()} thùng` },
          { label: 'Thùng KH',  value: order.planned_cartons != null ? `${order.planned_cartons}` : '—' },
        ]} />

        {/* ── Pallet table (~80%) ── */}
        <div className="flex-1 p-4 overflow-auto pb-20 lg:pb-4">

          <div className="-mx-4 -mt-4 mb-3 px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1.5">
              <span className="h-3.5 w-1 rounded-full bg-sky-500" />
              Pallet đã quét
              <span className="ml-1 text-[11px] font-normal normal-case text-slate-400">{entries.length} pallet</span>
              {selectedIds.size > 0 && (
                <span className="ml-1 text-[11px] font-normal normal-case text-blue-600">· {selectedIds.size} đã chọn</span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {isOpen && selectedIds.size > 0 && (
                <Button
                  size="sm" variant="outline"
                  className="h-8 gap-1.5 text-red-600 hover:bg-red-50 border-red-200"
                  onClick={() => openConfirm(
                    'Xóa pallet đã chọn',
                    `Xác nhận xóa ${selectedIds.size} pallet? Thao tác này không thể hoàn tác.`,
                    () => deleteEntries(
                      { orderId: order.id, entryIds: [...selectedIds], employeeId: user?.id },
                      { onSuccess: () => setSelectedIds(new Set()) }
                    )
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Xóa ({selectedIds.size})
                </Button>
              )}
              {isOpen && can(perms, 'inbound', 'scan') && (
                isManualEntry ? (
                  <Button
                    size="sm" variant="outline"
                    className="h-8 gap-1.5"
                    disabled={isNccFull || !!order.posm_entry_id}
                    onClick={() => { setManualCartons(order.planned_cartons?.toString() ?? ''); setManualFeedback(null); setShowManualDialog(true) }}
                    title={order.posm_entry_id ? 'Phiếu này đã lưu thủ công rồi' : undefined}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {order.posm_entry_id ? 'Đã lưu thủ công' : isNccFull ? 'Đủ kế hoạch' : 'Lưu thủ công'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={!order.location_id || isNccFull}
                    onClick={() => { unlockAudio(); setShowScan(true) }}
                    title={isNccFull ? `Đã nhập đủ ${order.planned_cartons} thùng theo kế hoạch` : !order.location_id ? 'Chọn vị trí trước' : undefined}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {isNccFull ? 'Đủ kế hoạch' : order.location_id ? 'Thêm pallet' : 'Chọn vị trí trước'}
                  </Button>
                )
              )}
            </div>
          </div>

          <Card>
            {isPlaceholderData ? (
              <TableSkeleton rows={5} cols={7} />
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
                <QrCode className="h-10 w-10 opacity-30" />
                <p className="text-sm">Chưa có pallet nào được quét</p>
                {isOpen && can(perms, 'inbound', 'scan') && !isNccFull && (
                  isManualEntry ? (
                    <Button
                      size="sm" variant="outline"
                      disabled={!!order.posm_entry_id}
                      onClick={() => { setManualCartons(order.planned_cartons?.toString() ?? ''); setManualFeedback(null); setShowManualDialog(true) }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> {order.posm_entry_id ? 'Đã lưu thủ công' : 'Lưu thủ công'}
                    </Button>
                  ) : (
                    <Button
                      size="sm" variant="outline"
                      disabled={!order.location_id}
                      onClick={() => { unlockAudio(); setShowScan(true) }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Thêm pallet đầu tiên
                    </Button>
                  )
                )}
              </div>
            ) : (
              <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {isOpen && (
                        <TableHead className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-slate-300 cursor-pointer accent-blue-600"
                            checked={allDeletableSelected}
                            onChange={toggleAll}
                          />
                        </TableHead>
                      )}
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">NSX</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Mã pallet</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">Thùng</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Vị trí</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Người quét</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Ngày</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Giờ</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">NMSX</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">CK</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Máy</TableHead>
                      <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">STT</TableHead>
                      {isOpen && <TableHead className="px-1 py-1.5 w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id} className={selectedIds.has(entry.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}>
                        {isOpen && (
                          <TableCell className="px-2 py-1">
                            {canDeleteEntry(entry) ? (
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 rounded border-slate-300 cursor-pointer accent-blue-600"
                                checked={selectedIds.has(entry.id)}
                                onChange={() => toggleEntry(entry.id)}
                              />
                            ) : (
                              <span className="block h-3.5 w-3.5" />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">
                          {entry.production_date
                            ? format(parseISO(entry.production_date), 'dd-MM-yy', { locale: vi })
                            : '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 font-mono font-semibold text-[10px]">
                          {entry.pallet_code}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums font-semibold">
                          {entry.cartons_imported}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] font-mono text-slate-600">
                          {entry.location?.location_code ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">
                          {entry.created_by_emp?.name ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">
                          {formatTimestampDate(entry.created_at, true)}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap tabular-nums">
                          {formatTimestampTime(entry.created_at)}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                          {entry.manufacturer?.code ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                          {entry.cycle ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                          {entry.machine_code ?? '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums text-slate-500">
                          {entry.pallet_sequence_no ?? '—'}
                        </TableCell>
                        {isOpen && (
                          <TableCell className="px-1 py-1">
                            <div className="flex items-center gap-0.5">
                              {canEditEntry(entry) && (
                                <button
                                  className="text-slate-400 hover:text-blue-500 transition-colors p-0.5"
                                  onClick={() => setEditState({ entry, cartons: entry.cartons_imported, stack: entry.stack_layer })}
                                  title="Sửa"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              )}
                              {canDeleteEntry(entry) && (
                                <button
                                  className="text-slate-400 hover:text-red-500 transition-colors p-0.5"
                                  onClick={() => openConfirm(
                                    'Xóa pallet',
                                    `Xác nhận xóa pallet "${entry.pallet_code}"?`,
                                    () => deleteEntry({ orderId: order.id, entryId: entry.id, employeeId: user?.id })
                                  )}
                                  title="Xóa"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            )}
          </Card>
        </div>
       </div>
      </div>
    </>
  )
}
