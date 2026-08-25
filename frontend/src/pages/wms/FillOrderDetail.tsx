// CHI TIẾT MỘT LỆNH FILL (v3 05/08) — mở từ tab "Lệnh fill".
// Mỗi dòng = 1 mã hàng + DATE yêu cầu (%Date) + số pallet phải hạ + vị trí đến.
// Multi-select dòng → action theo QUYỀN RIÊNG TỪNG NÚT (tách 05/08): Giao cho (fill.assign) ·
// Đổi vị trí đến (fill.change_dest) · Hủy dòng/lệnh (fill.cancel). Quét (fill.execute) giới hạn lệnh này.
// Bulk chạy SONG SONG per-dòng qua route PATCH/DELETE /fill/tasks/:id (chuẩn Promise.all).
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowDownToLine, UserPlus, MapPin, X } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { FillScanOverlay } from './FillScanOverlay'
import { AssigneePicker, DestPicker, FILL_STATUS_LABEL, FILL_STATUS_BADGE, fillRowText, RequiredDateBadge } from './fillShared'
import { useFillOrder, useFillDemand, useUpdateFillTask, useCancelFillTask, useCancelFillOrder, type FillTaskRow } from '@/api/hooks'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { unlockAudio } from '@/utils/audio'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { qtyLabel, QTY_CONVERTED_LABEL, QTY_CONVERTED_TIP } from '@/utils/qtyUnits'
import { qtyEntryDecimal } from '@/utils/qtyUnits'
import { formatDate, formatDateTime, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

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
  const canChangeDest = can(perms, 'fill', 'change_dest')
  const canAssign     = can(perms, 'fill', 'assign')
  const canExecute    = can(perms, 'fill', 'execute')
  const canBulk       = canAssign || canChangeDest || canCancel

  const { data, isLoading } = useFillOrder(id)
  const updateTask  = useUpdateFillTask()
  const cancelTask  = useCancelFillTask()
  const cancelOrder = useCancelFillOrder()
  const { widths: colW, startResize, totalWidth } = useColumnResize('fill_line_col_widths', LINE_COLS.map(c => c.w))

  const [sel, setSel] = useState<Set<string>>(new Set())
  const [dlg, setDlg] = useState<'assign' | 'dest' | null>(null)
  const [val, setVal] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanMounted, setScanMounted] = useState(false)
  const [pdaScan, setPdaScan] = useState<string | null>(null)

  const order = data?.order
  const lines = useMemo(() => data?.lines ?? [], [data])
  const scans = data?.scans ?? []

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
      const r = byMat.get(l.material_id)
      if (!r) { // fill_demand chỉ trả mã còn cần > 0 → vắng mặt = ngày xuất này hết nhu cầu mã đó
        m.set(l.id, 'Ngày xuất này không còn nhu cầu nhặt lẻ mã này (đơn đã giảm/hủy hoặc đổi ngày) — cân nhắc hủy dòng')
        continue
      }
      const needLeft = Math.max(0, Number(r.demand_base) - Number(r.pick_face_base))
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

  if (isLoading) return <div className="p-8 text-center text-sm text-slate-400">Đang tải lệnh fill…</div>
  if (!order) return <div className="p-8 text-center text-sm text-slate-400">Không tìm thấy lệnh fill</div>

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => navigate('/wms/fill')} title="Về danh sách"
              className="h-9 w-9 sm:h-7 sm:w-7 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className={`text-sm font-semibold flex items-center gap-1.5 shrink-0 ${fillRowText(order.status) || 'text-slate-800'}`}>
              <ArrowDownToLine className="h-4 w-4 text-sky-600" />
              Lệnh fill <span className="font-mono">{order.order_code}</span>
            </h1>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${FILL_STATUS_BADGE[order.status]}`}>
              {FILL_STATUS_LABEL[order.status]}
            </span>
            <span className="text-[11px] text-slate-500 shrink-0">
              Ngày xuất <b>{formatDate(order.target_date)}</b>
              {order.created_by && <> · tạo bởi {order.created_by}</>}
            </span>
            {/* Nút HIỆN THẲNG, không nhét vào menu ⋮ (user chốt 05/08 "đưa action lên trên
                nút ba chấm") — người cầm điện thoại phải thấy đủ thao tác ngay */}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents sm:ml-auto">
              {canExecute && order.status === 'PENDING' && (
                <Button size="sm" className="h-9 sm:h-7 text-[11px]"
                  title="Quét tem pallet đúng MÃ + đúng DATE của dòng lệnh trong lệnh này"
                  onClick={() => { setScanMounted(true); setScanOpen(true) }}>
                  <ScanIcon className="h-3.5 w-3.5 mr-1" /> Quét thực hiện
                </Button>
              )}
              {canCancel && order.status === 'PENDING' && (
                <Button size="sm" variant="outline"
                  className="h-9 sm:h-7 text-[11px] border-red-200 text-red-600 hover:bg-red-50"
                  disabled={cancelOrder.isPending}
                  title="Hủy toàn bộ dòng còn treo của lệnh này (dòng đã hạ giữ nguyên)"
                  onClick={doCancelOrder}>
                  <X className="h-3.5 w-3.5 mr-1" /> {cancelOrder.isPending ? 'Đang hủy…' : 'Hủy lệnh'}
                </Button>
              )}
            </div>
          </div>
        </div>

        <SummaryBand tiles={[
          { label: 'Dòng mã', value: nf(lines.length) },
          { label: 'Pallet đã hạ / cần', value: `${nf(tot.plDone)} / ${nf(tot.plReq)}`, accent: tot.plDone < tot.plReq },
          { label: `CẦN — ${QTY_CONVERTED_LABEL}`, value: nf(tot.req), tip: QTY_CONVERTED_TIP },
          { label: `ĐÃ HẠ — ${QTY_CONVERTED_LABEL}`, value: nf(tot.done), tip: QTY_CONVERTED_TIP },
        ]} />

        {canBulk && sel.size > 0 && (
          <div className="px-3 py-1.5 border-b bg-slate-50 flex items-center gap-2 flex-wrap shrink-0">
            <span className="text-[11px] text-slate-500">
              Đã chọn <b className="text-slate-700">{sel.size}</b> dòng ({pendingSel.length} đang treo)
            </span>
            {/* Nút THƯỜNG thay ActionCluster: cụm không có primary nên trên mobile ActionCluster
                gom HẾT vào menu ⋮ — user bắt 05/08 "chọn nhiều không đủ action như trên browser".
                Thao tác bulk phải thấy ĐỦ cả 3 nút ở mọi cỡ màn. */}
            <span className="ml-auto flex items-center gap-1.5 flex-wrap">
              {canAssign && (
                <Button size="sm" variant="outline" className="h-9 sm:h-7 text-[11px]"
                  disabled={!pendingSel.length || busy}
                  title="Giao các dòng đã chọn cho một người"
                  onClick={() => { setVal(''); setErr(''); setDlg('assign') }}>
                  <UserPlus className="h-3.5 w-3.5 mr-1" /> Giao cho
                </Button>
              )}
              {canChangeDest && (
                <Button size="sm" variant="outline" className="h-9 sm:h-7 text-[11px]"
                  disabled={!pendingSel.length || busy}
                  title="Đổi vị trí nhặt lẻ sẽ hạ về cho các dòng đã chọn (vị trí phải nhận đúng Loại kho từng mã)"
                  onClick={() => { setVal(''); setErr(''); setDlg('dest') }}>
                  <MapPin className="h-3.5 w-3.5 mr-1" /> Đổi vị trí đến
                </Button>
              )}
              {canCancel && (
                <Button size="sm" variant="outline"
                  className="h-9 sm:h-7 text-[11px] border-red-200 text-red-600 hover:bg-red-50"
                  disabled={!pendingSel.length || busy}
                  title="Hủy các dòng đã chọn (giữ lại để tra cứu)"
                  onClick={() => bulk(l => cancelTask.mutateAsync({ id: l.id }), pendingSel)}>
                  <X className="h-3.5 w-3.5 mr-1" /> {busy ? 'Đang hủy…' : 'Hủy dòng'}
                </Button>
              )}
            </span>
          </div>
        )}
        {err && <p className="mx-3 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
        {dropInfo.size > 0 && (
          <p className="mx-3 mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 shrink-0">
            <b>{dropInfo.size} dòng</b> có nhu cầu ĐÃ GIẢM so với lúc ra lệnh (đơn xuất đổi/hủy) — hạ thừa chỉ chiếm chỗ
            vị trí nhặt lẻ, cân nhắc hủy dòng (xem badge vàng từng dòng).
          </p>
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {/* MOBILE = THẺ per dòng (user chốt 05/08): VỊ TRÍ LẤY → VỀ chữ to ngay view đầu,
              tick chọn để dùng thanh action; bảng đầy đủ cột giữ cho desktop từ sm. */}
          <div className="sm:hidden divide-y divide-slate-100">
            {lines.length === 0 ? (
              <p className="text-center py-8 text-xs text-slate-400">Lệnh không có dòng nào</p>
            ) : lines.map(l => {
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
              {lines.length === 0 ? (
                <TableRow><TableCell colSpan={LINE_COLS.length} className="text-center py-8 text-xs text-slate-400">Lệnh không có dòng nào</TableCell></TableRow>
              ) : lines.map(l => {
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
                  <TableRow><TableCell colSpan={SCAN_COLS.length} className="text-center py-4 text-xs text-slate-400">Chưa quét pallet nào</TableCell></TableRow>
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
        <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">{lines.length} dòng mã · {scans.length} pallet đã quét</div>
      </div>

      {/* Bulk: giao người / đổi vị trí đến cho các dòng đã chọn */}
      <Dialog open={dlg !== null} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-1.5">
            {dlg === 'assign'
              ? <><UserPlus className="h-4 w-4 text-sky-600" /> Giao {pendingSel.length} dòng cho ai?</>
              : <><MapPin className="h-4 w-4 text-sky-600" /> Đổi vị trí đến ({pendingSel.length} dòng)</>}
          </DialogTitle></DialogHeader>
          <div className="space-y-2">
            {dlg === 'assign'
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
            <Button size="sm" disabled={busy || (dlg === 'dest' && !val)}
              onClick={() => bulk(l => updateTask.mutateAsync(dlg === 'assign'
                ? { id: l.id, assignee_id: val || null }
                : { id: l.id, to_location_id: val }), pendingSel)}>
              {busy ? 'Đang lưu…' : 'Lưu'}
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
