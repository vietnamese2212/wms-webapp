// PHIẾU NHẬP CHUNG (26/11 — user: "nhập nhiều mã ... cải tiến thành 1 Phiếu nhập chung, trong đó chứa các mã hàng riêng (tương tự
// phần xuất), có vậy mới cải thiện UX khi quét trên giao diện chung"). Chốt: áp cho Nhập nhiều mã + nhóm NCC; tem mã không có trong
// phiếu ⇒ CHẶN; nhập vượt theo công tắc 2 tầng (kho chế biến cho vượt, báo Thừa); số phiếu app sinh + Số chứng từ.
// Bên trong mỗi mã vẫn là một phiếu dòng (ProductionImport) — trang này là đầu phiếu + bảng mã + một nút Quét + mọi pallet.
// Khuôn trang giống InboundDetail (header gọn · SummaryBand · thanh tiêu đề bảng cố định · ActionCluster).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, XCircle, Pencil, MapPin, Calendar, Truck, Layers, FileText, Clock, User } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useInboundReceipt, useInboundOrders, type InboundReceiptLine } from '@/api/hooks'
import type { InboundOrder } from '@/types'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { WindowedRows } from '@/components/shared/WindowedRows'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Badge } from '@/components/ui/badge'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { InboundGroupScanSheet } from '@/components/wms/InboundScanSheet'
import { useReceiptGroupActions } from '@/components/wms/ReceiptGroupActions'
import { CreateOrderDialog } from '@/pages/wms/Inbound'
import { qtyLabel } from '@/utils/qtyUnits'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { unlockAudio } from '@/utils/audio'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'

// Cột hai bảng (kéo giãn được, lưu theo khoá) — bảng nghiệp vụ dùng ResizableTable như mọi trang (luật C40)
const LINE_COLS: RtColDef[] = [
  { id: 'code', label: 'Mã hàng', w: 110 }, { id: 'name', label: 'Tên hàng', w: 220 }, { id: 'type', label: 'Loại kho', w: 70 },
  { id: 'plan', label: 'Kế hoạch', w: 110, align: 'right' }, { id: 'got', label: 'Đã nhận', w: 110, align: 'right' },
  { id: 'diff', label: 'Chênh', w: 120, align: 'right' }, { id: 'pl', label: 'Pallet', w: 60, align: 'right' },
  { id: 'loc', label: 'Vị trí', w: 110 }, { id: 'st', label: 'Trạng thái', w: 90 }, { id: 'act', label: '', w: 84, stickyRight: true },
]
const PALLET_COLS: RtColDef[] = [
  { id: 'tem', label: 'Tem pallet', w: 240 }, { id: 'code', label: 'Mã hàng', w: 110 }, { id: 'qty', label: 'Số lượng', w: 120, align: 'right' },
  { id: 'loc', label: 'Vị trí', w: 110 }, { id: 'nsx', label: 'NSX', w: 90 }, { id: 'at', label: 'Nhận lúc', w: 120 },
]

type LineState = { label: string; variant: 'success' | 'info' | 'warning' | 'slate' }
function lineState(l: InboundReceiptLine): LineState {
  if (l.status === 'COMPLETED') return { label: 'Hoàn thành', variant: 'success' }
  if (l.received > 0) return { label: 'Đang nhập', variant: 'warning' }
  return { label: 'Chưa nhập', variant: 'slate' }
}

/** Chênh so kế hoạch: Thiếu (đỏ) · Thừa (xanh) · Đủ (xanh lá). Không kế hoạch ⇒ — */
function DiffCell({ l }: { l: InboundReceiptLine }) {
  if (l.planned_cartons == null || l.diff == null) return <span className="text-slate-300">—</span>
  const m = l.material
  if (Math.abs(l.diff) < 1e-9) return <span className="text-green-700 font-semibold">Đủ</span>
  if (l.diff < 0) return <span className={l.received > 0 ? 'text-red-600 font-semibold' : 'text-slate-500'}>Thiếu {qtyLabel(-l.diff, m)}</span>
  return <span className="text-blue-700 font-semibold" title={l.over_plan === 'BLOCK' ? 'Kho đặt chặn nhập vượt — phần thừa có từ trước khi đặt luật' : 'Nhận nhiều hơn kế hoạch'}>Thừa {qtyLabel(l.diff, m)}</span>
}

export default function InboundReceipt() {
  const { group } = useParams<{ group: string }>()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const { data, isLoading, error } = useInboundReceipt(group)
  // dòng mã đủ trường cho màn quét + form Sửa phiếu (cùng nguồn với danh sách)
  const { data: orders = [] } = useInboundOrders(group ? { receipt_group: group } : undefined)
  const [actError, setActError] = useState<string | null>(null)
  const [showScan, setShowScan] = useState(false)
  const [gunCode, setGunCode] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [matFilter, setMatFilter] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const acts = useReceiptGroupActions({
    onError: setActError,
    onCancelled: () => { /* phiếu còn dòng thì ở lại; hết dòng ⇒ trang tự về danh sách (effect dưới) */ },
  })

  const lines = data?.lines ?? []
  const scanable = (orders as InboundOrder[]).filter(o => o.status === 'OPEN' && o.material?.no_qr_tracking !== true)
  const openLines = lines.filter(l => l.status === 'OPEN')
  const canScan = can(perms, 'inbound', 'scan') && scanable.length > 0
  const editOpen = editing || showScan || !!acts.busy

  // Bóp cò súng ngay ở trang phiếu (như trang dòng mã) ⇒ mở màn quét đúng mã theo tem
  useWedgeScanner(code => {
    if (!canScan || showScan) return
    unlockAudio(); setGunCode(code); setShowScan(true)
  }, !editOpen)

  // ?scan=1 từ danh sách ⇒ mở màn quét ngay khi có dữ liệu
  useEffect(() => {
    if (sp.get('scan') === '1' && canScan && !showScan) {
      unlockAudio(); setGunCode(undefined); setShowScan(true)
      sp.delete('scan'); setSp(sp, { replace: true })
    }
  }, [sp, canScan]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phiếu không còn (huỷ hết dòng) ⇒ về danh sách
  useEffect(() => {
    if (!isLoading && error && (error as { response?: { status?: number } }).response?.status === 404) navigate('/wms/inbound', { replace: true })
  }, [isLoading, error, navigate])

  const matOptions = useMemo(() => [
    { value: '', label: 'Mọi mã' },
    ...lines.map(l => ({ value: l.id, label: `${l.material?.material_code ?? ''} ${l.material?.short_name ?? ''}`.trim() })),
  ], [lines])
  const entries = useMemo(() => (data?.entries ?? []).filter(e => !matFilter || e.import_order_id === matFilter), [data, matFilter])
  const lineById = useMemo(() => new Map(lines.map(l => [l.id, l])), [lines])

  if (isLoading && !data) return <div className="p-6"><TableSkeleton rows={8} cols={7} /></div>
  if (!data) {
    const msg = (error as { response?: { data?: { error?: { message?: string } } } } | null)?.response?.data?.error?.message
    return <div className="p-6 text-sm text-red-600">{msg ?? 'Không tải được phiếu nhập'}</div>
  }

  const { receipt, head } = data
  const allDone = lines.length > 0 && lines.every(l => l.status === 'COMPLETED')
  const got = lines.filter(l => l.received > 0).length
  const withPlan = lines.filter(l => (l.planned_cartons ?? 0) > 0)
  const nShort = withPlan.filter(l => l.received > 0 && (l.diff ?? 0) < -1e-9).length
  const nOver = withPlan.filter(l => (l.diff ?? 0) > 1e-9).length
  const nFull = withPlan.filter(l => Math.abs(l.diff ?? 1) < 1e-9).length
  const pallets = lines.reduce((a, l) => a + l.pallets, 0)
  const stKey = allDone ? { label: 'Hoàn thành', variant: 'success' as const } : got > 0 ? { label: 'Đang nhập', variant: 'warning' as const } : { label: 'Chưa nhập', variant: 'slate' as const }
  const overMode = lines.find(l => l.over_plan)?.over_plan ?? null

  const headerItems: ActionItem[] = []
  if (canScan) headerItems.push({
    key: 'scan', icon: Layers, label: `Quét (${scanable.length} mã)`, ops: true, primary: true,
    tip: 'Quét tem của mọi mã trong phiếu ở một màn — app tự vào đúng mã theo tem; tem mã không có trong phiếu bị chặn',
    onClick: () => { unlockAudio(); setGunCode(undefined); setShowScan(true) },
  })
  if (openLines.length > 0 && can(perms, 'inbound', 'complete')) headerItems.push({
    key: 'complete', icon: CheckCircle2, label: 'Hoàn thành phiếu', variant: 'success',
    tip: 'Hoàn thành mọi mã ĐÃ nhận hàng — xem trước mã nhận thiếu / thừa, mã giữ mở rồi mới xác nhận',
    className: 'border-green-200 text-green-700 hover:bg-green-50', busy: acts.busy === 'complete',
    onClick: () => { void acts.runComplete(group!) },
  })
  if (openLines.length > 0 && can(perms, 'inbound', 'edit')) headerItems.push({
    key: 'edit', icon: Pencil, label: 'Sửa phiếu',
    tip: 'Thêm mã · sửa số kế hoạch · đổi NCC / vị trí mặc định / số chứng từ (áp cho mã chưa quét) · bỏ mã chưa nhận',
    onClick: () => setEditing(true),
  })
  if (openLines.length > 0 && can(perms, 'inbound', 'cancel')) headerItems.push({
    key: 'cancel', icon: XCircle, label: 'Huỷ phiếu', admin: true, danger: true,
    tip: 'Huỷ mọi mã CHƯA nhận hàng — mã đã có pallet giữ lại (không hoàn tác được)',
    className: 'border-red-200 text-red-600 hover:bg-red-50', busy: acts.busy === 'cancel',
    onClick: () => { void acts.runCancel(group!) },
  })

  return (
    <>
      {acts.node}
      {showScan && (
        <InboundGroupScanSheet orders={orders as InboundOrder[]} employeeId={user?.id} initialScan={gunCode}
          label={`${receipt.receipt_code ?? 'Phiếu chung'} · ${scanable.length} mã`}
          onClose={() => { setShowScan(false); setGunCode(undefined) }} />
      )}
      <CreateOrderDialog open={editing} onClose={() => setEditing(false)} editGroup={editing ? (orders as InboundOrder[]) : null} />

      <div ref={scrollRef} className="h-full overflow-y-auto bg-slate-50" data-testid="receipt-page">
        {/* ── Header gọn ── */}
        <div className="border-b bg-white px-3 pt-2 pb-2 space-y-1 sm:px-4 sm:pt-3 sm:pb-3 sm:space-y-2">
          <div className="flex items-center justify-between gap-x-2 gap-y-1.5 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => navigate('/wms/inbound')} className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0" title="Về danh sách">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-semibold shrink-0">PHIẾU CHUNG</span>
              <span className="font-semibold font-mono text-xs sm:text-sm break-all" data-testid="receipt-code">{receipt.receipt_code ?? '—'}</span>
              <Badge variant={stKey.variant} className="px-1.5 py-0 text-[9px] font-medium shrink-0">{stKey.label}</Badge>
            </div>
            <ActionCluster mobileInline items={headerItems} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:gap-x-4 text-xs text-slate-600">
            {receipt.doc_no && <span className="flex items-center gap-1" data-testid="receipt-doc"><FileText className="h-3 w-3 text-slate-400" /><span className="text-slate-400 text-[10px]">Số CT:</span><span className="font-mono font-semibold">{receipt.doc_no}</span></span>}
            <span className="flex items-center gap-1"><span className={`text-[8px] px-1 py-0.5 rounded font-medium ${receipt.source_type === 'NCC' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-600'}`}>{receipt.source_type === 'NCC' ? 'NCC' : 'SX'}</span>{head.warehouse?.name ?? '—'}</span>
            {head.import_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3 text-slate-400" />{formatDate(head.import_date.slice(0, 10))}{head.shift ? ` · ${head.shift.name}` : ''}</span>}
            {head.ncc && <span className="flex items-center gap-1"><span className="text-slate-400 text-[10px]">NCC:</span>{head.ncc.name}</span>}
            {head.license_plate && <span className="flex items-center gap-1"><Truck className="h-3 w-3 text-slate-400" /><span className="font-mono">{head.license_plate}</span></span>}
            {head.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-slate-400" /><span className="text-slate-400 text-[10px]">Vị trí mặc định:</span><span className="font-mono font-medium">{head.location.location_code}</span></span>}
            {head.imported_by && <span className="flex items-center gap-1"><User className="h-3 w-3 text-slate-400" />{head.imported_by}</span>}
            {head.notes && <span className="text-slate-400 italic truncate max-w-[240px]">{head.notes}</span>}
          </div>
        </div>

        {actError && <div className="mx-3 sm:mx-4 mt-2 rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700" data-testid="receipt-error">{actError}</div>}

        <SummaryBand tiles={[
          { label: 'Số mã', value: lines.length },
          { label: 'Đã nhận', value: `${got}/${lines.length}`, tip: 'Số mã đã có hàng / số mã của phiếu' },
          { label: 'Đủ KH', value: nFull },
          { label: 'Thiếu', value: nShort, danger: nShort > 0, tip: 'Mã đã nhận nhưng chưa đủ kế hoạch' },
          { label: 'Thừa', value: nOver, accent: nOver > 0, tip: overMode === 'BLOCK' ? 'Kho đặt chặn nhập vượt kế hoạch' : 'Mã nhận nhiều hơn kế hoạch (kho cho vượt)' },
          { label: 'Pallet', value: pallets },
        ]} />

        {/* ── Bảng mã ── */}
        <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1.5">
            <span className="h-3.5 w-1 rounded-full bg-sky-500" /> Mã hàng
            <span className="ml-1 text-[11px] font-normal normal-case text-slate-400">{lines.length} mã · bấm dòng để mở chi tiết mã</span>
          </h2>
        </div>
        <div className="overflow-x-auto bg-white" data-testid="receipt-lines">
          <ResizableTable storageKey="inbound_receipt_lines_v1" cols={LINE_COLS}>
            <TableBody>
              {lines.map(l => {
                const st = lineState(l)
                const needManual = l.no_qr && l.status === 'OPEN' && !l.posm_entry_id && can(perms, 'inbound', 'scan')
                return (
                  <TableRow key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/wms/inbound/${l.id}`)} data-testid="receipt-line">
                    <TableCell className="px-2 py-1.5 text-[10px] font-mono whitespace-nowrap sticky left-0 z-10 bg-white">{l.material?.material_code ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1.5 text-[11px] font-medium truncate" title={l.material?.short_name ?? undefined}>
                      {l.material?.short_name ?? l.material?.material_description ?? '—'}
                      {l.no_qr && <span className="ml-1 text-[9px] text-slate-400 font-normal">(không tem)</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] whitespace-nowrap">{l.warehouse_type ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1.5 text-[11px] text-right tabular-nums whitespace-nowrap">{l.planned_cartons != null ? qtyLabel(l.planned_cartons, l.material) : '—'}</TableCell>
                    <TableCell className="px-2 py-1.5 text-[11px] text-right tabular-nums whitespace-nowrap font-semibold">{qtyLabel(l.received, l.material)}</TableCell>
                    <TableCell className="px-2 py-1.5 text-[11px] text-right whitespace-nowrap" data-testid="receipt-line-diff"><DiffCell l={l} /></TableCell>
                    <TableCell className="px-2 py-1.5 text-[11px] text-right tabular-nums">{l.pallets}</TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] font-mono whitespace-nowrap">{l.no_qr ? <span className="text-slate-300">—</span> : (l.location?.location_code ?? <span className="text-amber-600 font-sans">chọn khi quét</span>)}</TableCell>
                    <TableCell className="px-2 py-1.5 whitespace-nowrap"><Badge variant={st.variant} className="px-1.5 py-0 text-[9px] font-medium">{st.label}</Badge></TableCell>
                    <TableCell className="px-2 py-1.5 whitespace-nowrap text-right sticky right-0 bg-white">
                      {needManual && (
                        <button type="button" onClick={e => { e.stopPropagation(); navigate(`/wms/inbound/${l.id}?scan=1`) }}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 h-6 text-[10px] font-semibold text-white hover:bg-blue-700"
                          title="Mã không tem — nhập số lượng thực nhận">
                          <ScanIcon className="h-3 w-3" /> Lưu SL
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>
        </div>

        {/* ── Pallet của cả phiếu ── */}
        <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-100 border-y border-slate-200 flex items-center justify-between gap-2 flex-wrap mt-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600 flex items-center gap-1.5">
            <span className="h-3.5 w-1 rounded-full bg-sky-500" /> Pallet đã nhận
            <span className="ml-1 text-[11px] font-normal normal-case text-slate-400">{entries.length} pallet</span>
          </h2>
          <div className="w-56 max-w-full">
            <SingleSelect options={matOptions} value={matFilter} onChange={setMatFilter} placeholder="Mọi mã" triggerClassName="h-7 text-xs" />
          </div>
        </div>
        <div className="overflow-x-auto bg-white pb-20" data-testid="receipt-pallets">
          <ResizableTable storageKey="inbound_receipt_pallets_v1" cols={PALLET_COLS}>
            <TableBody>
              {entries.length === 0
                ? <TableEmptyRow colSpan={6}>Chưa có pallet nào — bấm Quét hoặc bóp cò súng</TableEmptyRow>
                : <WindowedRows scrollRef={scrollRef} count={entries.length} colSpan={6} row={i => {
                    const e = entries[i]
                    const m = lineById.get(e.import_order_id)?.material ?? null
                    return (
                      <TableRow key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/wms/inbound/${e.import_order_id}`)}>
                        <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap truncate sticky left-0 z-10 bg-white" title={e.pallet_code}>{e.pallet_code}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{e.material_code ?? '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-[11px] text-right tabular-nums whitespace-nowrap">{qtyLabel(Number(e.cartons_imported) || 0, m)}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] font-mono whitespace-nowrap">{e.location?.location_code ?? '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{e.production_date ? formatDate(e.production_date.slice(0, 10)) : '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500"><Clock className="inline h-3 w-3 mr-0.5 text-slate-300" />{formatTimestampDate(e.created_at, true)} {formatTimestampTime(e.created_at, false)}</TableCell>
                      </TableRow>
                    )
                  }} />}
            </TableBody>
          </ResizableTable>
        </div>
      </div>
    </>
  )
}
