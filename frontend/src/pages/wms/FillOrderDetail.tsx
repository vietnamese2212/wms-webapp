// CHI TIẾT MỘT LỆNH FILL (v3 05/08) — mở từ tab "Lệnh fill".
// Mỗi dòng = 1 mã hàng + DATE yêu cầu (%Date) + số pallet phải hạ + vị trí đến.
// Multi-select dòng → action theo QUYỀN RIÊNG TỪNG NÚT (tách 05/08): Giao cho (fill.assign) ·
// Đổi vị trí đến (fill.change_dest) · Hủy dòng/lệnh (fill.cancel). Quét (fill.execute) giới hạn lệnh này.
// Bulk chạy SONG SONG per-dòng qua route PATCH/DELETE /fill/tasks/:id (chuẩn Promise.all).
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowDownToLine, UserPlus, MapPin, X, Bot, Lock, Eye, EyeOff } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { backTarget } from '@/lib/returnTo'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FloatingActionBar, FLOATING_BTN, FLOATING_BTN_DANGER } from '@/components/shared/FloatingActionBar'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { FillScanOverlay } from './FillScanOverlay'
import { AssigneePicker, DestPicker, FILL_STATUS_LABEL, FILL_ORDER_STATUS_LABEL, FILL_STATUS_BADGE, fillRowText, RequiredDateBadge } from './fillShared'
import { useFillOrder, useFillDemand, useUpdateFillTask, useCancelFillTask, useCancelFillOrder,
  useAssignFillOrder, useCloseFillOrder, type FillTaskRow } from '@/api/hooks'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { unlockAudio } from '@/utils/audio'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { qtyLabel, QTY_CONVERTED_LABEL, QTY_CONVERTED_TIP } from '@/utils/qtyUnits'
import { qtyEntryDecimal } from '@/utils/qtyUnits'
import { formatDate, formatDateTime, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'

const nf = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })

const LINE_COLS = [
  { id: 'sel',    label: '',                     w: 36 },
  { id: 'status', label: 'Trạng thái',           w: 90 },
  { id: 'code',   label: 'Mã hàng',              w: 110 },
  { id: 'name',   label: 'Tên hàng',             w: 190 },
  { id: 'date',   label: 'Date yêu cầu (%Date)', w: 140 },
  { id: 'qty',    label: 'SL cần hạ',            w: 130, align: 'right' as const },
  { id: 'pl',     label: 'Pallet',               w: 80,  align: 'right' as const },
  { id: 'done',   label: 'Đã hạ',                w: 130, align: 'right' as const },
  { id: 'src',    label: 'Lấy tại (gợi ý)',      w: 150 },
  { id: 'dest',   label: 'Về vị trí',            w: 110 },
  { id: 'who',    label: 'Giao cho',             w: 130 },
  { id: 'fin',    label: 'Hoàn thành',           w: 140 },
]
const SCAN_COLS = [
  { id: 'time',   label: 'Lúc',        w: 120 },
  { id: 'pallet', label: 'Tem pallet', w: 200 },
  { id: 'nsx',    label: 'NSX',        w: 80 },
  { id: 'qty',    label: 'SL',         w: 110, align: 'right' as const },
  { id: 'move',   label: 'Từ → Về',    w: 180 },
  { id: 'who',    label: 'Người quét', w: 140 },
]

export default function FillOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  // Mỗi nút 1 quyền riêng (user chốt 05/08 — không gộp "plan" cho cả 3 nút)
  const canCancel     = can(perms, 'fill', 'cancel')
  const canPlan       = can(perms, 'fill', 'plan')      // chốt ngày = hành vi kế hoạch, cùng quyền ra lệnh
  const canChangeDest = can(perms, 'fill', 'change_dest')
  const canAssign     = can(perms, 'fill', 'assign')
  const canExecute    = can(perms, 'fill', 'execute')
  const canBulk       = canAssign || canChangeDest || canCancel

  const { data, isLoading } = useFillOrder(id)
  const updateTask  = useUpdateFillTask()
  const cancelTask  = useCancelFillTask()
  const cancelOrder = useCancelFillOrder()
  const assignOrder = useAssignFillOrder()
  const closeOrder  = useCloseFillOrder()
  const { widths: colW, startResize, totalWidth } = useColumnResize('fill_line_col_widths', LINE_COLS.map(c => c.w))

  const [sel, setSel] = useState<Set<string>>(new Set())
  const [dlg, setDlg] = useState<'assign' | 'dest' | 'assign-order' | null>(null)
  const [val, setVal] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanMounted, setScanMounted] = useState(false)
  const [pdaScan, setPdaScan] = useState<string | null>(null)

  const order = data?.order
  const lines = useMemo(() => data?.lines ?? [], [data])
  const scans = data?.scans ?? []

  // VIỆC XONG THÌ LÙI RA SAU (user chốt 16/09: "cái nào xong rồi thì mặc định ẩn đi để tập trung cái khác").
  // Lệnh của NGÀY sống suốt ca nên dòng đã hạ + dòng máy thu hồi/người bác dồn lại rất nhanh — đo F260916-01:
  // 7 dòng mà chỉ 2 còn làm được, 5 dòng kia là nhiễu che đúng thứ người đi hạ cần nhìn.
  // Ẩn chứ KHÔNG bỏ: chip nói rõ còn bao nhiêu và mở lại được (lý do huỷ là thứ phải tra cứu được).
  // Lệnh đã chốt/huỷ thì không còn dòng nào "còn làm" ⇒ hiện tất cả, kẻo mở ra thấy bảng trắng.
  const [showDone, setShowDone] = useState(false)
  const nPending = lines.filter(l => l.status === 'PENDING').length
  const hideMode = !showDone && nPending > 0
  const shown = hideMode ? lines.filter(l => l.status === 'PENDING') : lines
  const nHidden = lines.length - shown.length

  // Badge "Cần đã giảm" (user chốt 06/08): đơn xuất giảm/hủy KHÔNG tự hủy lệnh treo (chủ đích)
  // → đối chiếu nhu cầu SỐNG (RPC fill_demand — MỘT nguồn công thức, không chép lại) với phần
  // đang treo để chỉ ra dòng nên cân nhắc hủy; quyết định thuộc người có fill.cancel.
  const demand = useFillDemand(order && order.status === 'PENDING'
    ? { warehouse_id: order.warehouse_id, date: (order.target_date ?? '').slice(0, 10) }
    : undefined).data
  const dropInfo = useMemo(() => {
    const m = new Map<string, string>()
    if (!order || order.status !== 'PENDING') return m
    // Demand lỗi / kho chưa khai vị trí nhặt lẻ → KHÔNG kết luận (tránh báo "hết cần" oan)
    if (!demand || demand.error || !(demand.pick_face_locations > 0)) return m
    const byMat = new Map(demand.rows.map(r => [r.material_id, r]))
    for (const l of lines) {
      if (l.status !== 'PENDING') continue
      // Dòng do MÁY đặt thì bộ đối chiếu tự hạ/thu hồi ở lượt chạy kế — giục người hủy tay là đẩy họ
      // làm việc máy đang làm, và hủy xong máy lại đặt lại. Chỉ nhắc với dòng NGƯỜI đặt (máy không đụng).
      if ((l.created_by ?? '') === 'Hệ thống') continue
      const r = byMat.get(l.material_id)
      if (!r) { // fill_demand chỉ trả mã còn cần > 0 → vắng mặt = ngày xuất này hết nhu cầu mã đó
        m.set(l.id, 'Ngày xuất này không còn nhu cầu nhặt lẻ mã này (đơn đã giảm/hủy hoặc đổi ngày) — cân nhắc hủy dòng')
        continue
      }
      // 15/09 — ĐO CÙNG MỘT THƯỚC VỚI MÁY. Bản cũ trừ `pick_face_base` (mọi thứ đang ở ô lẻ) trong
      // khi bộ đối chiếu trừ `pick_face_ok_base` (chỉ phần ĐÚNG LÔ) ⇒ dải vàng giục hủy đúng những
      // dòng máy cố ý giữ, hủy xong 10 phút sau máy đặt lại — vòng luẩn quẩn không ai thắng.
      const needLeft = Math.max(0, Number(r.demand_base)
        - Number(r.pick_face_ok_base ?? r.pick_face_base) - Number(r.feed_pending_base ?? 0))
      if (Number(r.pending_base) > needLeft) {
        m.set(l.id, `Cần đã giảm — tổng đang treo (mọi lệnh) ${qtyLabel(Number(r.pending_base), l)}, chỉ còn thiếu ${qtyLabel(needLeft, l)} — cân nhắc hủy bớt`)
      }
    }
    return m
  }, [demand, lines, order])
  const selLines = lines.filter(l => sel.has(l.id))
  const pendingSel = selLines.filter(l => l.status === 'PENDING')
  const selectable = lines.filter(l => l.status === 'PENDING')
  const allSel = selectable.length > 0 && selectable.every(l => sel.has(l.id))

  // PDA: bóp cò NGAY TẠI TRANG chi tiết → mở màn quét chế độ SÚNG (không bật camera) + xử lý
  // luôn tem vừa bắn — quét giới hạn trong lệnh này (đồng bộ chuẩn Outbound, user nhắc 05/08)
  // Dialog đang mở → TẮT HẲN máy đọc (enabled=false), không chỉ bỏ qua mã: máy đọc bắt chuỗi
  // phím nhanh/IME ở mọi ô nhập rồi trả lại giá trị cũ (bug xe vãng lai 25/08).
  useWedgeScanner(code => {
    if (scanOpen || !canExecute || !order || order.status !== 'PENDING') return
    if (busy) return
    unlockAudio()
    setPdaScan(code)
    setScanMounted(true)
    setScanOpen(true)
  }, !dlg)

  const tot = useMemo(() => {
    let req = 0, done = 0, plReq = 0, plDone = 0
    for (const l of lines) {
      if (l.status !== 'CANCELLED') { req += qtyEntryDecimal(Number(l.qty_base), l); plReq += l.required_pallets }
      done += qtyEntryDecimal(Number(l.qty_done_base), l)
      plDone += l.scanned_pallets
    }
    return { req, done, plReq, plDone }
  }, [lines])

  // Bulk = SONG SONG per-dòng; dòng hỏng gom lại báo rõ (không nuốt lỗi, không dừng cả mẻ)
  async function bulk(fn: (l: FillTaskRow) => Promise<unknown>, targets: FillTaskRow[]) {
    setBusy(true); setErr('')
    const fails: string[] = []
    await Promise.all(targets.map(l => fn(l).catch((e: unknown) => {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      fails.push(`${l.material_code ?? l.id}: ${msg ?? 'lỗi'}`)
    })))
    setBusy(false)
    if (fails.length) setErr(`${fails.length} dòng không cập nhật được — ${fails.slice(0, 3).join(' · ')}${fails.length > 3 ? ' …' : ''}`)
    else { setSel(new Set()); setDlg(null) }
  }

  async function doCancelOrder() {
    if (!order) return
    setErr('')
    try { await cancelOrder.mutateAsync({ id: order.id }) }
    catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không hủy được lệnh')
    }
  }

  // CHỐT NGÀY = đóng sổ, không hoàn tác được ⇒ hỏi một câu và NÓI TRƯỚC số dòng sẽ bị hủy theo.
  async function doCloseOrder() {
    if (!order) return
    const left = lines.filter(l => l.status === 'PENDING').length
    if (!window.confirm(left
      ? `Chốt lệnh ${order.order_code}? ${left} dòng chưa thực hiện sẽ bị hủy kèm lý do "Chốt ngày".`
      : `Chốt lệnh ${order.order_code}?`)) return
    setErr('')
    try { await closeOrder.mutateAsync({ id: order.id }) }
    catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không chốt được lệnh')
    }
  }

  if (isLoading) return <div className="p-8 text-center text-sm text-slate-400">Đang tải lệnh fill…</div>
  // Lệnh đã hủy/dọn hoặc link cũ: phải nói RÕ lý do + có LỐI VỀ. Bản cũ chỉ in "Không tìm thấy
  // lệnh fill" giữa màn trắng, không đường nào đi tiếp — người dùng kẹt, phải bấm Back trình duyệt
  // (đo 06/09: 6/8 trang chi tiết đã theo mẫu này, riêng đây bị bỏ sót).
  if (!order) return (
    <div className="p-6 text-center space-y-2">
      <p className="text-sm text-red-600">Không tìm thấy lệnh fill — có thể đã bị hủy hoặc đường link đã cũ</p>
      <Link to="/wms/fill" className="text-xs text-sky-600 underline">← Về Fill hàng</Link>
    </div>
  )

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => navigate(backTarget('/wms/fill'))} title="Về danh sách"
              className="h-9 w-9 sm:h-7 sm:w-7 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className={`text-sm font-semibold flex items-center gap-1.5 shrink-0 ${fillRowText(order.status) || 'text-slate-800'}`}>
              <ArrowDownToLine className="h-4 w-4 text-sky-600" />
              Lệnh fill <span className="font-mono">{order.order_code}</span>
            </h1>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${FILL_STATUS_BADGE[order.status]}`}>
              {FILL_ORDER_STATUS_LABEL[order.status]}
            </span>
            {/* LỆNH CỦA NGÀY (15/09): khoá là (kho, ngày, LOẠI KHO) — nói ra để người mở không đi
                tìm "lệnh còn lại" của cùng ngày; và nói AI đang giữ kế hoạch cả ngày này. */}
            {order.warehouse_type && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                Loại {order.warehouse_type}
              </span>
            )}
            {order.auto_created && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 shrink-0 flex items-center gap-1"
                title="Lệnh do hệ thống tự mở theo nhu cầu nhặt lẻ trong ngày">
                <Bot className="h-3 w-3" /> Máy tạo
              </span>
            )}
            <span className="text-[11px] text-slate-500 shrink-0">
              Ngày xuất <b>{formatDate(order.target_date)}</b>
              {order.created_by && <> · tạo bởi {order.created_by}</>}
              {' · '}
              {order.assignee_name
                ? <>giao <b className="text-slate-700">{order.assignee_name}</b> (cả ngày)</>
                : <span className="text-amber-700">chưa giao ai</span>}
              {order.closed_at && <> · chốt {formatDateTime(order.closed_at)}</>}
            </span>
            {/* Cụm action = ActionCluster như header Xuất kho/Nhập kho (user 16/09: "header chiếm hết rồi còn đâu —
                tỷ lệ table 80 / header 20"): desktop nút h-7 một hàng; mobile hai nút chính (Quét · Giao) hiện
                thẳng, Chốt ngày / Hủy lệnh vào ⋮ — bốn nút h-9 xếp hai hàng như bản 05/08 là header ăn nửa màn. */}
            {order.status === 'PENDING' && (
              <div className="flex items-center gap-1.5 shrink-0 max-sm:w-full">
                <ActionCluster items={[
                  ...(canExecute ? [{
                    key: 'scan', icon: ScanIcon, label: 'Quét thực hiện', primary: true, variant: 'default',
                    tip: 'Quét tem pallet đúng MÃ + đúng DATE của dòng lệnh trong lệnh này',
                    onClick: () => { setScanMounted(true); setScanOpen(true) },
                  } satisfies ActionItem] : []),
                  ...(canAssign ? [{
                    key: 'assign-order', icon: UserPlus, label: 'Giao cả ngày', primary: true, busy: assignOrder.isPending,
                    tip: 'Giao kế hoạch fill CẢ NGÀY này cho một người — dòng hệ thống thêm vào sau cũng thuộc về họ',
                    onClick: () => { setVal(order.assignee_id ?? ''); setErr(''); setDlg('assign-order') },
                  } satisfies ActionItem] : []),
                  ...(canPlan ? [{
                    key: 'close', icon: Lock, label: 'Chốt ngày', busy: closeOrder.isPending,
                    tip: 'Đóng sổ lệnh của ngày: dòng chưa thực hiện sẽ bị hủy kèm lý do (giữ vết để báo cáo)',
                    onClick: doCloseOrder,
                  } satisfies ActionItem] : []),
                  ...(canCancel ? [{
                    key: 'cancel', icon: X, label: 'Hủy lệnh', danger: true, busy: cancelOrder.isPending,
                    className: 'border-red-200 text-red-600 hover:bg-red-50',
                    tip: 'Hủy toàn bộ dòng còn treo của lệnh này (dòng đã hạ giữ nguyên)',
                    onClick: doCancelOrder,
                  } satisfies ActionItem] : []),
                ]} />
              </div>
            )}
          </div>
        </div>

        <SummaryBand tiles={[
          { label: 'Dòng còn làm / tổng', value: `${nf(nPending)} / ${nf(lines.length)}` },
          { label: 'Pallet đã hạ / cần', value: `${nf(tot.plDone)} / ${nf(tot.plReq)}`, accent: tot.plDone < tot.plReq },
          { label: `CẦN — ${QTY_CONVERTED_LABEL}`, value: nf(tot.req), tip: QTY_CONVERTED_TIP },
          { label: `ĐÃ HẠ — ${QTY_CONVERTED_LABEL}`, value: nf(tot.done), tip: QTY_CONVERTED_TIP },
        ]} />

        {/* Thanh thao tác chọn-nhiều = PILL NỔI giữa đáy (như Tồn kho), KHÔNG chèn hàng vào giữa band và bảng —
            user 16/09: "tick multi là hiện action lên, table không được resize". Nút THƯỚNG thay ActionCluster
            (cụm không có primary nên mobile gom hết vào ⋮ — user bắt 05/08): phải thấy đủ 3 nút ở mọi cỡ màn. */}
        {canBulk && (
          <FloatingActionBar count={sel.size} unit={`dòng · ${pendingSel.length} đang treo`}>
            {canAssign && (
              <Button size="sm" variant="outline" className={FLOATING_BTN}
                disabled={!pendingSel.length || busy}
                title="Giao các dòng đã chọn cho một người"
                onClick={() => { setVal(''); setErr(''); setDlg('assign') }}>
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Giao cho
              </Button>
            )}
            {canChangeDest && (
              <Button size="sm" variant="outline" className={FLOATING_BTN}
                disabled={!pendingSel.length || busy}
                title="Đổi vị trí nhặt lẻ sẽ hạ về cho các dòng đã chọn (vị trí phải nhận đúng Loại kho từng mã)"
                onClick={() => { setVal(''); setErr(''); setDlg('dest') }}>
                <MapPin className="h-3.5 w-3.5 mr-1" /> Đổi vị trí đến
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="outline" className={FLOATING_BTN_DANGER}
                disabled={!pendingSel.length || busy}
                title="Hủy các dòng đã chọn (giữ lại để tra cứu)"
                onClick={() => bulk(l => cancelTask.mutateAsync({ id: l.id }), pendingSel)}>
                <X className="h-3.5 w-3.5 mr-1" /> {busy ? 'Đang hủy…' : 'Hủy dòng'}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 text-[11px] text-slate-300 hover:text-white hover:bg-slate-700"
              title="Bỏ chọn" onClick={() => setSel(new Set())}>Bỏ chọn</Button>
          </FloatingActionBar>
        )}
        {err &&<p className="mx-3 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
        {dropInfo.size > 0 && (
          <p className="mx-3 mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 shrink-0">
            <b>{dropInfo.size} dòng</b> có nhu cầu ĐÃ GIẢM so với lúc ra lệnh (đơn xuất đổi/hủy) — hạ thừa chỉ chiếm chỗ
            vị trí nhặt lẻ, cân nhắc hủy dòng (xem badge vàng từng dòng).
          </p>
        )}

        {(nHidden > 0 || (showDone && nPending > 0)) && (
          <div className="px-3 pt-2 shrink-0">
            <button type="button" onClick={() => setShowDone(s => !s)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100">
              {hideMode ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {hideMode
                ? `Hiện ${nf(nHidden)} dòng đã xong / đã hủy`
                : `Ẩn dòng đã xong / đã hủy — chỉ xem ${nf(nPending)} dòng còn làm`}
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {/* MOBILE = THẺ per dòng (user chốt 05/08): VỊ TRÍ LẤY → VỀ chữ to ngay view đầu,
              tick chọn để dùng thanh action; bảng đầy đủ cột giữ cho desktop từ sm. */}
          <div className="sm:hidden divide-y divide-slate-100">
            {shown.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-400">Lệnh không có dòng nào</p>
            ) : shown.map(l => {
              const picked = sel.has(l.id)
              return (
                <div key={l.id} className={`px-3 py-2.5 ${picked ? 'bg-sky-50' : ''}`}
                  onClick={() => {
                    if (!(canBulk) || l.status !== 'PENDING') return
                    setSel(prev => {
                      const n = new Set(prev)
                      if (n.has(l.id)) n.delete(l.id); else n.add(l.id)
                      return n
                    })
                  }}>
                  <div className="flex items-center gap-2">
                    {(canBulk) && l.status === 'PENDING' && (
                      <input type="checkbox" readOnly checked={picked} className="h-4 w-4 shrink-0" />
                    )}
                    <span className={`font-mono text-xs font-bold ${fillRowText(l.status) || 'text-slate-800'}`}>{l.material_code}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${FILL_STATUS_BADGE[l.status]}`}>{FILL_STATUS_LABEL[l.status]}</span>
                    {dropInfo.has(l.id) && (
                      <span title={dropInfo.get(l.id)}
                        className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Cần đã giảm</span>
                    )}
                    <span className="ml-auto"><RequiredDateBadge line={l} /></span>
                  </div>
                  <p className="text-[10px] text-slate-500 truncate mt-0.5" title={l.material_name ?? ''}>{l.material_name ?? '—'}</p>
                  {l.status !== 'CANCELLED' && (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-[13px] font-mono font-semibold text-slate-800 break-all leading-tight" title={l.from_location_code ?? ''}>
                        <span className="font-sans text-[10px] font-normal text-slate-400 mr-1">LẤY</span>
                        {l.from_location_code ?? '—'}
                      </p>
                      <p className="text-[13px] font-mono font-semibold text-sky-700 break-all leading-tight" title={l.to_location_code ?? ''}>
                        <span className="font-sans text-[10px] font-normal text-slate-400 mr-1">VỀ</span>
                        {l.to_location_code ?? '—'}
                      </p>
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span className="font-semibold tabular-nums">{qtyLabel(Number(l.qty_base), l)}</span>
                    <span className="text-slate-400">·</span>
                    <span className="tabular-nums">{l.scanned_pallets}/{l.required_pallets} pl</span>
                    <span className="ml-auto text-[10px] text-slate-500 truncate max-w-[40%]" title={l.assignee_name ?? ''}>
                      {l.done_at ? `✓ ${l.done_by_name ?? ''}` : (l.assignee_name ?? 'chưa giao')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="hidden sm:block">
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
            style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {LINE_COLS.map((c, i) => (
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.id === 'sel' && (canBulk) ? (
                      <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={allSel}
                        onChange={e => setSel(e.target.checked ? new Set(selectable.map(l => l.id)) : new Set())} />
                    ) : c.label}
                    <span onPointerDown={e => startResize(i, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableEmptyRow colSpan={LINE_COLS.length}>Lệnh không có dòng nào</TableEmptyRow>
              ) : shown.map(l => {
                const picked = sel.has(l.id)
                return (
                  <TableRow key={l.id} className={fillRowText(l.status)}>
                    <TableCell className={`px-2 py-1 sticky left-0 z-10 ${picked ? 'bg-sky-50' : 'bg-white'}`}>
                      {(canBulk) && l.status === 'PENDING' && (
                        <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={picked}
                          onChange={e => setSel(prev => {
                            const n = new Set(prev)
                            if (e.target.checked) n.add(l.id); else n.delete(l.id)
                            return n
                          })} />
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${FILL_STATUS_BADGE[l.status]}`}>{FILL_STATUS_LABEL[l.status]}</span>
                      {dropInfo.has(l.id) && (
                        <span title={dropInfo.get(l.id)}
                          className="mt-0.5 block w-fit text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 cursor-help">Cần đã giảm</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{l.material_code ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={l.material_name ?? ''}>{l.material_name ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap"><RequiredDateBadge line={l} /></TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold">{qtyLabel(Number(l.qty_base), l)}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{l.required_pallets}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                      {l.scanned_pallets > 0
                        ? <><b>{l.scanned_pallets}</b> pl · {qtyLabel(Number(l.qty_done_base), l)}</>
                        : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono truncate" title={l.from_location_code ?? ''}>
                      {l.from_location_code ?? <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{l.to_location_code ?? '—'}</TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={l.assignee_name ?? ''}>
                      {l.assignee_name ?? <span className="text-slate-300">chưa giao</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {l.done_at
                        ? <div className="leading-tight">
                            <div className="text-slate-600 truncate">{l.done_by_name ?? '—'}</div>
                            <div className="text-[9px] text-slate-400">{formatDateTime(l.done_at)}</div>
                          </div>
                        : l.status === 'CANCELLED' && l.cancel_reason
                          ? <span className="text-[9px] text-slate-400 truncate" title={l.cancel_reason}>{l.cancel_reason}</span>
                          : <span className="text-slate-300">—</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>

          {/* Vết quét — pallet nào đã thật sự hạ, ai quét, lúc nào */}
          <div className="mt-3">
            <div className="flex items-center gap-2 bg-slate-100 border-y border-slate-200 px-3 py-1.5">
              <span className="w-1 h-3.5 bg-sky-500 rounded-full" />
              <p className="text-[10px] font-semibold text-slate-600 uppercase">Vết quét ({scans.length} pallet)</p>
            </div>
            <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
              <TableHeader>
                <TableRow>
                  {SCAN_COLS.map(c => (
                    <TableHead key={c.id} className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}
                      style={{ width: c.w }}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.length === 0 ? (
                  <TableEmptyRow colSpan={SCAN_COLS.length}>Chưa quét pallet nào</TableEmptyRow>
                ) : scans.map(s => {
                  const line = lines.find(l => l.id === s.task_id)
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                        {formatTimestampDate(s.created_at, true)} <span className="text-slate-400">{formatTimestampTime(s.created_at)}</span>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono truncate" title={s.pallet_code}>{s.pallet_code}</TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                        {s.production_date ? formatTimestampDate(s.production_date, true) : <span className="text-slate-300">—</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold">
                        {line ? qtyLabel(Number(s.qty_base), line) : nf(Number(s.qty_base))}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono">
                        {s.from_location_code ?? '—'} → {s.to_location_code ?? '—'}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={s.scanned_by_name ?? ''}>
                        {s.scanned_by_name ?? '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">
          Đang xem {shown.length} / {lines.length} dòng mã{nHidden > 0 && ` (ẩn ${nHidden} dòng đã xong/đã hủy)`} · {scans.length} pallet đã quét
        </div>
      </div>

      {/* Bulk: giao người / đổi vị trí đến cho các dòng đã chọn */}
      <Dialog open={dlg !== null} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-1.5">
            {dlg === 'assign-order'
              ? <><UserPlus className="h-4 w-4 text-sky-600" /> Giao kế hoạch CẢ NGÀY cho ai?</>
              : dlg === 'assign'
              ? <><UserPlus className="h-4 w-4 text-sky-600" /> Giao {pendingSel.length} dòng cho ai?</>
              : <><MapPin className="h-4 w-4 text-sky-600" /> Đổi vị trí đến ({pendingSel.length} dòng)</>}
          </DialogTitle></DialogHeader>
          <div className="space-y-2">
            {dlg === 'assign-order' && (
              <p className="text-[11px] text-slate-500">
                Người này nhận toàn bộ kế hoạch fill ngày <b>{formatDate(order.target_date)}</b>
                {order.warehouse_type && <> · loại <b>{order.warehouse_type}</b></>} — kể cả dòng hệ thống
                thêm vào trong ngày. Để trống = bỏ giao.
              </p>
            )}
            {dlg === 'assign' || dlg === 'assign-order'
              ? <AssigneePicker warehouseId={order.warehouse_id} value={val} onChange={setVal} />
              : <DestPicker warehouseId={order.warehouse_id}
                  materialId={[...new Set(pendingSel.map(l => l.material_id))].length === 1 ? pendingSel[0]?.material_id : undefined}
                  value={val} onChange={setVal} label="Vị trí nhặt lẻ đến" />}
            {dlg === 'dest' && [...new Set(pendingSel.map(l => l.material_id))].length > 1 && (
              <p className="text-[10px] text-amber-700">
                Các dòng thuộc NHIỀU mã — vị trí phải nhận đúng Loại kho của từng mã, dòng không khớp sẽ báo lỗi riêng.
              </p>
            )}
            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDlg(null)} disabled={busy}>Hủy</Button>
            <Button size="sm" disabled={busy || assignOrder.isPending || (dlg === 'dest' && !val)}
              onClick={async () => {
                if (dlg === 'assign-order') {
                  setErr('')
                  try { await assignOrder.mutateAsync({ id: order.id, assignee_id: val || null }); setDlg(null) }
                  catch (e: unknown) {
                    setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không giao được kế hoạch')
                  }
                  return
                }
                await bulk(l => updateTask.mutateAsync(dlg === 'assign'
                  ? { id: l.id, assignee_id: val || null }
                  : { id: l.id, to_location_id: val }), pendingSel)
              }}>
              {busy || assignOrder.isPending ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {scanMounted && (
        <FillScanOverlay warehouseId={order.warehouse_id} orderId={order.id} open={scanOpen}
          canAssign={canAssign} pdaMode={!!pdaScan} initialScan={pdaScan ?? undefined}
          onClose={() => { setScanOpen(false); setPdaScan(null) }} />
      )}
    </div>
  )
}
