// PHIẾU NHẬP CHUNG (26/11 — user: "nhập nhiều mã ... cải tiến thành 1 Phiếu nhập chung, trong đó chứa các mã hàng riêng (tương tự
// phần xuất), có vậy mới cải thiện UX khi quét trên giao diện chung"). Chốt: áp cho Nhập nhiều mã + nhóm NCC; tem mã không có trong
// phiếu ⇒ CHẶN; nhập vượt theo công tắc 2 tầng (kho chế biến cho vượt, báo Thừa); số phiếu app sinh + Số chứng từ.
// Bên trong mỗi mã vẫn là một phiếu dòng (ProductionImport) — trang này là đầu phiếu + bảng mã + một nút Quét + mọi pallet.
// Khuôn trang giống InboundDetail (header gọn · SummaryBand · thanh tiêu đề bảng cố định · ActionCluster).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, XCircle, Pencil, MapPin, Calendar, Truck, Layers, FileText, User } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useInboundReceipt, useInboundOrders, type InboundReceiptLine, type InboundReceiptMat } from '@/api/hooks'
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
// Trạng thái · màu chữ · tiến độ: CÙNG khuôn với phiếu thường ở danh sách / trang dòng mã (user 26/11: "các format khi hàng đủ,
// thiếu, xong… tương tự như khi xem ở 1 phiếu bình thường") — xong = chữ xanh gạch ngang, đang nhập = cam, KH đỏ khi thiếu, % + thanh
import { CreateOrderDialog, inboundKey, INBOUND_BADGE, InboundProgress } from '@/pages/wms/Inbound'
import { inboundProgressOf } from '@/utils/inboundProgress'
import { rowText, statusText, type RowStatusKey } from '@/lib/rowStatus'
// ĐVT in bằng MÃ của app ("50 KG") — user 17/11 "hạn chế văn viết, dùng đơn vị tính của app"; mã có thùng vẫn "N thùng + M hộp"
import { qtyCode, unitCode } from '@/utils/unitCode'
import { qtyEntryText, qtyUnitLabel, hasEntry } from '@/utils/qtyUnits'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { unlockAudio } from '@/utils/audio'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'

// Cột hai bảng (kéo giãn được, lưu theo khoá) — bảng nghiệp vụ dùng ResizableTable như mọi trang (luật C40)
const LINE_COLS: RtColDef[] = [
  // Tiến độ + Chênh ngay sau Tên hàng: điện thoại 390 px thấy đủ / thiếu / thừa luôn mà không cần kéo ngang
  { id: 'code', label: 'Mã hàng', w: 76 }, { id: 'name', label: 'Tên hàng', w: 116 },
  { id: 'prog', label: 'Tiến độ', w: 58, align: 'right' }, { id: 'diff', label: 'Chênh', w: 124, align: 'right' },
  { id: 'got', label: 'Thực nhập', w: 100, align: 'right' }, { id: 'plan', label: 'Kế hoạch', w: 100, align: 'right' },
  { id: 'pl', label: 'Pallet', w: 60, align: 'right' }, { id: 'type', label: 'Loại kho', w: 70 },
  { id: 'loc', label: 'Vị trí', w: 100 }, { id: 'st', label: 'Trạng thái', w: 92 }, { id: 'act', label: '', w: 84 },   // KHÔNG ghim phải: cột trống phần lớn dòng mà nền trắng che cột Chênh trên điện thoại
]
// Bảng pallet cùng cột với bảng pallet của phiếu thường (NSX · Mã pallet · SL · Vị trí · Người quét · Ngày · Giờ) + cột Mã hàng
const PALLET_COLS: RtColDef[] = [
  { id: 'nsx', label: 'NSX', w: 70 }, { id: 'tem', label: 'Mã pallet', w: 220 }, { id: 'code', label: 'Mã hàng', w: 100 },
  { id: 'qty', label: 'Số lượng', w: 110, align: 'right' }, { id: 'loc', label: 'Vị trí', w: 90 },
  { id: 'by', label: 'Người quét', w: 110 }, { id: 'day', label: 'Ngày', w: 72 }, { id: 'time', label: 'Giờ', w: 56 },
]

/** Số + ĐVT nhỏ màu xám như ô Thực nhập / KH của danh sách; mã không quy cách thùng in MÃ ĐVT (KG) */
function Qty({ q, m, className = '' }: { q: number; m: InboundReceiptMat | null; className?: string }) {
  return (
    <>
      <span className={`font-semibold tabular-nums ${className}`}>{qtyEntryText(q, m)}</span>
      <span className="text-[9px] text-slate-400 ml-0.5">{hasEntry(m) ? qtyUnitLabel(m) : unitCode(m?.base_unit)}</span>
    </>
  )
}

/** Chênh so kế hoạch — nhãn như hộp Hoàn thành của phiếu thường: Đủ (xanh lá) · Thiếu (cam) · Thừa (xanh). Chưa nhận ⇒ chữ xám */
function DiffCell({ l }: { l: InboundReceiptLine }) {
  if (l.planned_cartons == null || l.diff == null) return <span className="text-slate-300">—</span>
  const m = l.material
  const pill = 'rounded-full px-1.5 py-0.5 font-medium'
  if (Math.abs(l.diff) < 1e-9) return <span className={`${pill} bg-green-50 text-green-700`}>Đủ</span>
  if (l.diff < 0) return l.received > 0
    ? <span className={`${pill} bg-amber-50 text-amber-700`}>Thiếu {qtyCode(-l.diff, m)}</span>
    : <span className="text-slate-400">Thiếu {qtyCode(-l.diff, m)}</span>
  return <span className={`${pill} bg-blue-50 text-blue-700`} title={l.over_plan === 'BLOCK' ? 'Kho đặt chặn nhập vượt — phần thừa có từ trước khi đặt luật' : 'Nhận nhiều hơn kế hoạch'}>Thừa {qtyCode(l.diff, m)}</span>
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
  const orderById = useMemo(() => new Map((orders as InboundOrder[]).map(o => [o.id, o])), [orders])
  // Trạng thái dòng mã = đúng hàm của danh sách (inboundKey: Hoàn thành · Đầy vị trí · Đang nhập · Chưa nhập); dòng chưa về kịp ⇒ suy từ số nhận
  const keyOf = (l: InboundReceiptLine): RowStatusKey => {
    const o = orderById.get(l.id)
    if (o) return inboundKey(o)
    return l.status === 'COMPLETED' ? 'completed' : (l.pallets > 0 || l.received > 0) ? 'inProgress' : 'pending'
  }

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
  // Phiếu chung: cùng luật với dòng phiếu chung ở danh sách (ReceiptRow)
  const rKey: RowStatusKey = allDone ? 'completed' : got > 0 ? 'inProgress' : 'pending'
  const stKey = INBOUND_BADGE[rKey]
  const overMode = lines.find(l => l.over_plan)?.over_plan ?? null

  const headerItems: ActionItem[] = []
  if (canScan) headerItems.push({
    key: 'scan', icon: Layers, label: `Quét (${scanable.length} mã)`, ops: true, primary: true,
    tip: 'Quét tem của mọi mã trong phiếu ở một màn — app tự vào đúng mã theo tem; tem mã không có trong phiếu bị chặn',
    onClick: () => { unlockAudio(); setGunCode(undefined); setShowScan(true) },
  })
  if (openLines.length > 0 && can(perms, 'inbound', 'complete')) headerItems.push({
    key: 'complete', icon: CheckCircle2, label: 'Hoàn thành phiếu', variant: 'success', primary: true,
    tip: 'Hoàn thành mọi mã ĐÃ nhận hàng — xem trước mã nhận thiếu / thừa, mã giữ mở rồi mới xác nhận',
    busy: acts.busy === 'complete',
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
              <span className={`font-semibold font-mono text-xs sm:text-sm break-all ${statusText(rKey)}`} data-testid="receipt-code">{receipt.receipt_code ?? '—'}</span>
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
          <ResizableTable storageKey="inbound_receipt_lines_v4" cols={LINE_COLS}>
            <TableBody>
              {lines.map(l => {
                const key = keyOf(l)
                const st = INBOUND_BADGE[key]
                const needManual = l.no_qr && l.status === 'OPEN' && !l.posm_entry_id && can(perms, 'inbound', 'scan')
                return (
                  <TableRow key={l.id} className={`cursor-pointer ${rowText(key)}`} onClick={() => navigate(`/wms/inbound/${l.id}`)} data-testid="receipt-line" data-status={key}>
                    <TableCell className="px-2 py-1.5 text-[10px] font-mono text-slate-500 whitespace-nowrap sticky left-0 z-10 bg-white">{l.material?.material_code ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1.5 text-[11px] font-medium truncate" title={l.material?.short_name ?? undefined}>
                      {l.material?.short_name ?? l.material?.material_description ?? '—'}
                      {l.no_qr && <span className="ml-1 text-[9px] text-slate-400 font-normal">(không tem)</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 whitespace-nowrap text-right"><InboundProgress p={inboundProgressOf(l.received, l.planned_cartons)} /></TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] text-right whitespace-nowrap" data-testid="receipt-line-diff"><DiffCell l={l} /></TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] text-right whitespace-nowrap"><Qty q={l.received} m={l.material} /></TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] text-right whitespace-nowrap">
                      {l.planned_cartons != null ? <Qty q={l.planned_cartons} m={l.material} className={l.received < l.planned_cartons - 1e-9 ? 'text-red-600' : ''} /> : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-right whitespace-nowrap"><span className="text-[10px] font-semibold tabular-nums">{l.pallets}</span><span className="text-[9px] text-slate-400 ml-0.5">pl</span></TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] whitespace-nowrap">{l.warehouse_type ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] font-mono font-semibold whitespace-nowrap">{l.no_qr ? <span className="text-slate-300">—</span> : (l.location?.location_code ?? <span className="text-amber-600 font-sans font-normal">chọn khi quét</span>)}</TableCell>
                    <TableCell className="px-2 py-1.5 whitespace-nowrap"><Badge variant={st.variant} className="px-1.5 py-0 text-[9px] font-medium">{st.label}</Badge></TableCell>
                    <TableCell className="px-2 py-1.5 whitespace-nowrap text-right">
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
          <ResizableTable storageKey="inbound_receipt_pallets_v2" cols={PALLET_COLS}>
            <TableBody>
              {entries.length === 0
                ? <TableEmptyRow colSpan={8}>Chưa có pallet nào — bấm Quét hoặc bóp cò súng</TableEmptyRow>
                : <WindowedRows scrollRef={scrollRef} count={entries.length} colSpan={8} row={i => {
                    const e = entries[i]
                    const m = lineById.get(e.import_order_id)?.material ?? null
                    return (
                      <TableRow key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/wms/inbound/${e.import_order_id}`)}>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-slate-500">{e.production_date ? format(parseISO(e.production_date), 'dd-MM-yy', { locale: vi }) : '—'}</TableCell>
                        {/* whitespace-pre: tem V2 có đệm SPACE trong mã (như bảng pallet của phiếu thường) */}
                        <TableCell className="px-2 py-1 text-[10px] font-mono font-semibold whitespace-pre truncate" title={e.pallet_code}>{e.pallet_code}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] font-mono text-slate-500 whitespace-nowrap">{e.material_code ?? '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-right whitespace-nowrap"><Qty q={Number(e.cartons_imported) || 0} m={m} /></TableCell>
                        <TableCell className="px-2 py-1 text-[10px] font-mono text-slate-600 whitespace-nowrap">{e.location?.location_code ?? '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap truncate">{e.created_by_emp?.name ?? '—'}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">{formatTimestampDate(e.created_at, true)}</TableCell>
                        <TableCell className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap tabular-nums">{formatTimestampTime(e.created_at)}</TableCell>
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
