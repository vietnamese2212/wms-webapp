// HÀNG CHỜ "CẦN XỬ LÝ" CỦA ĐIỀU VẬN — đợt 2 vòng đời OD (03/10; thiết kế docs/plans/DISPATCH_OD_LIFECYCLE_2026-10-03.md mục 6).
// Đợt 1 cắm cờ trên bàn + rào ở DB + cổng SAP ở kho; chỗ thiếu là MỘT bảng gom mọi việc người điều vận phải quyết sau khi ZSD02 đổi,
// cho đơn ĐÃ VÀO Kế hoạch xuất (cờ trên bàn chỉ nói về đơn còn trên nháp). Theo KHO, không theo ngày kế hoạch — SAP đổi đơn của ngày
// mai thì hôm nay phải thấy. Mỗi dòng: DO cũ · việc · chuyến bị ảnh hưởng (tiến độ kho) · DO mới · nút đúng ô ma trận:
//   • chưa bắt đầu (B): SAP bỏ → Gỡ khỏi kế hoạch · SAP thay → Đổi số DO (khi DO mới còn trống) / Gỡ khỏi kế hoạch
//   • kho đang xuất (C): không có nút "giữ và chạy tiếp" (user chốt (c)) — in đường gỡ: xoá QR đã quét → Bỏ bắt đầu → gỡ Số xe → ghép lại
//   • đã đi (D): DO mới = hàng đã đi dưới số cũ → Ngoài app; họ hàng đã đi (KIN) → Xác nhận đơn bổ sung / Ngoài app (user chốt (b))
//   • SAP đổi số lượng sau khi kho quét (QTY): việc của kho ở Dữ liệu bên ngoài → Cần xử lý — chỉ dẫn link, không nhân đôi nút.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { ListFooter } from '@/components/shared/ListPager'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import { useDispatchDecisions, useRemoveKhvcOd, useRenumberKhvcOd, useOutsideDispatchOds, useConfirmSupplementDispatchOds, type DispatchDecision } from '@/api/hooks'
import { formatDateTime } from '@/utils/formatters'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'
const TD = 'px-2 py-1 text-[10px] align-top'
const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '—')

const KIND_VI: Record<DispatchDecision['kind'], { label: string; tone: BadgeTone; tip: string }> = {
  GONE:     { label: 'SAP đã bỏ DO',      tone: 'red',    tip: 'Mọi dòng ZSD02 của DO này đã OBSOLETE và không có DO nào thay — đơn vẫn nằm trong Kế hoạch xuất.' },
  REPLACED: { label: 'SAP thay DO',       tone: 'red',    tip: 'SAP bỏ DO này và sinh DO mới cho cùng dòng SO (sửa SO / tách / gộp) — Kế hoạch xuất còn cầm số cũ.' },
  KIN:      { label: 'Họ hàng đã đi',     tone: 'amber',  tip: 'DO mới cùng dòng SO với DO đã đi (SAP post lại). Giao thêm thì "Xác nhận đơn bổ sung"; hàng đã đi dưới số cũ thì "Ngoài app".' },
  QTY:      { label: 'SAP đổi SL sau khi quét', tone: 'orange', tip: 'Số lượng / dòng hàng đổi sau khi kho đã quét — kho quyết ở Dữ liệu bên ngoài → Cần xử lý (Áp SAP / Giữ WMS / Đã xử lý tay).' },
}
/** Trạng thái chuyến bên Xuất kho = cột của ma trận: B chưa bắt đầu · C đang xuất · D đã đi */
export function gdoStage(status: string | null | undefined): { col: 'B' | 'C' | 'D'; label: string; tone: BadgeTone } {
  if (status === 'COMPLETED') return { col: 'D', label: 'Đã đi', tone: 'blue' }
  if (status === 'IN_PROGRESS' || status === 'PAUSED') return { col: 'C', label: status === 'PAUSED' ? 'Kho tạm dừng' : 'Kho đang xuất', tone: 'amber' }
  if (status === 'CANCELLED') return { col: 'B', label: 'Chuyến đã huỷ', tone: 'slate' }
  return { col: 'B', label: status ? 'Chờ xuất' : 'Chưa có chuyến', tone: 'slate' }
}

export function DispatchDecisionQueue({ warehouseId, planId, canAct, canPlan }: {
  warehouseId: string; planId: string | null
  canAct: boolean    // dispatch.confirm hoặc external_khvc.delete/edit — gỡ / đổi số trên sổ Kế hoạch xuất
  canPlan: boolean   // dispatch.plan — Ngoài app / Xác nhận đơn bổ sung (đi qua kế hoạch đang mở)
}) {
  const q = useDispatchDecisions(warehouseId)
  const remove = useRemoveKhvcOd(), renumber = useRenumberKhvcOd(), outside = useOutsideDispatchOds(), sup = useConfirmSupplementDispatchOds()
  const [ask, confirmNode] = useConfirmDialog()
  const [dlg, setDlg] = useState<DispatchDecision | null>(null)   // hộp "Gỡ khỏi kế hoạch" — lý do
  const [reason, setReason] = useState('')
  const busy = remove.isPending || renumber.isPending || outside.isPending || sup.isPending
  const err = (e: unknown, title: string) => toast({ variant: 'destructive', title, description: apiMsg(e) })
  const rows = q.data?.rows ?? []

  const doRemove = async () => {
    if (!dlg) return
    try {
      const r = await remove.mutateAsync({ warehouse_id: warehouseId, od_number: dlg.od_number, group_code: dlg.group_code, reason: reason.trim() || undefined })
      setDlg(null)
      toast({ title: `Đã gỡ DO ${dlg.od_number} khỏi Số xe ${dlg.group_code}`, description: r.replan_error ? `Chuyến bên Xuất chưa dựng lại được: ${r.replan_error}` : 'Chuyến bên Xuất dựng lại theo kế hoạch còn lại (hết dòng thì ngừng hoạt động). DO mới (nếu có) đã về tab Điều.' })
    } catch (e) { err(e, 'Không gỡ được') }
  }
  const doRenumber = async (r: DispatchDecision) => {
    const to = r.new_ods.map(n => n.od)
    if (await ask({ title: `Đổi số DO ${r.od_number} → ${to.join(', ')} trên Số xe ${r.group_code}?`, confirmLabel: 'Đổi số DO',
      body: `${r.same_content ? 'Cùng khách, cùng tổng số lượng.' : 'Khách hoặc số lượng KHÁC bản cũ — chuyến bên Xuất dựng lại theo DO mới, tải xe đổi.'}${to.length > 1 ? ` DO tách ${to.length} phần đều lên cùng xe này.` : ''} Phả hệ ghi ai đổi lúc nào.` }) === null) return
    try {
      const res = await renumber.mutateAsync({ warehouse_id: warehouseId, od_number: r.od_number, group_code: r.group_code, new_ods: to })
      toast({ title: `Đã đổi ${res.from} → ${res.to.join(', ')}`, description: res.replan_error ? `Chuyến bên Xuất chưa dựng lại được: ${res.replan_error}` : 'Kế hoạch xuất, chuyến và bàn điều vận cùng mang số DO mới.' })
    } catch (e) { err(e, 'Không đổi số được') }
  }
  const doOutside = async (r: DispatchDecision, ods: string[]) => {
    if (!planId) return
    const why = r.kind === 'KIN' ? `Cùng dòng SO với DO ${r.od_number} đã đi — hàng đã đi, không giao thêm` : r.kind === 'GONE' ? `SAP xoá DO ${r.od_number} sau khi đã đi — đã báo SAP` : `Hàng đã đi dưới DO ${r.od_number} (SAP thay số sau khi đi)`
    if (await ask({ title: `Ngoài app: ${ods.join(', ')}`, confirmLabel: 'Ngoài app', body: `${why}. Đơn rời tab Điều, không tính vào "ngày tạo cần phủ"; phả hệ ghi đã giải quyết. Bỏ dấu ở tab Ngoài app.` }) === null) return
    try { await outside.mutateAsync({ plan_id: planId, od_numbers: ods, reason: why }); toast({ title: `${ods.length} OD → Ngoài app` }) } catch (e) { err(e, 'Không đánh dấu được') }
  }
  const doSupplement = async (r: DispatchDecision) => {
    if (!planId) return
    const ods = r.new_ods.map(n => n.od)
    if (await ask({ title: `Xác nhận ${ods.join(', ')} là đơn bổ sung?`, confirmLabel: 'Xác nhận đơn bổ sung', body: `Giao THÊM cho cùng dòng SO với DO ${r.od_number} đã đi (không phải giao lại hàng đã đi). Rào "một đơn một ngày" thôi giữ, đơn mới điều như đơn thường.` }) === null) return
    try { const res = await sup.mutateAsync({ plan_id: planId, od_numbers: ods }); toast({ title: `${res.supplement.ods} OD xác nhận là đơn bổ sung` }) } catch (e) { err(e, 'Không xác nhận được') }
  }

  const cols: RtColDef[] = [
    { id: 'od', label: 'DO', w: 104 },
    { id: 'kind', label: 'Việc', w: 160 },
    { id: 'trip', label: 'Chuyến bên Xuất', w: 220 },
    { id: 'date', label: 'Ngày xuất', w: 84 },
    { id: 'cust', label: 'Khách', w: 200 },
    { id: 'new', label: 'DO mới', w: 260 },
    { id: 'at', label: 'Phát hiện', w: 120 },
    { id: 'act', label: 'Xử lý', w: 360 },
  ]
  const path = 'xoá các QR đã quét (hoàn tồn) → Bỏ bắt đầu → rồi gỡ Số xe ở đây → ghép DO mới trên bàn'

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="shrink-0 border-b bg-white px-3 py-1.5 text-[11px] text-slate-600 flex flex-wrap items-center gap-2">
        <span>Việc phải quyết cho đơn <b>đã vào Kế hoạch xuất</b> của kho này (mọi ngày) sau khi ZSD02 đổi — dòng tự hết khi xử xong.</span>
        {q.isError && <button type="button" className="rounded bg-amber-100 px-2 h-7 text-amber-900" onClick={() => void q.refetch()} disabled={q.isFetching}>{q.isFetching ? 'Đang tải…' : 'Chưa tải được (hệ thống bận) · Thử lại'}</button>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-4">
        <ResizableTable storageKey="dispatch_decisions_cols_v1" cols={cols}>
          <TableBody>
            {!rows.length && <TableEmptyRow colSpan={cols.length}>{q.isLoading ? 'Đang tải…' : 'Không có việc nào cần xử lý — mọi đơn đã vào Kế hoạch xuất vẫn khớp ZSD02.'}</TableEmptyRow>}
            {rows.map(r => {
              const k = KIND_VI[r.kind]; const st = gdoStage(r.gdo_status)
              const freeNew = r.new_ods.filter(n => n.active && !n.in_khvc && !n.on_vehicle && !n.outside).map(n => n.od)
              const key = `${r.kind}|${r.od_number}|${r.group_code}|${r.task_id ?? ''}`
              return (
                <TableRow key={key} className="hover:bg-slate-50">
                  <TableCell className={`${TD} font-mono font-semibold sticky left-0 z-10 bg-white`}>{r.od_number}</TableCell>
                  <TableCell className={TD}><StatusBadge tone={k.tone} title={k.tip}>{k.label}</StatusBadge>{r.kind === 'QTY' && r.detail && <div className="mt-0.5 text-slate-600 whitespace-normal">{r.detail}</div>}</TableCell>
                  <TableCell className={TD}>
                    <div className="font-mono">{r.group_code}</div>
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    {r.gdo_id && <Link to={`/wms/outbound/${r.gdo_id}`} className="ml-1.5 text-sky-700 hover:underline">Mở chuyến</Link>}
                  </TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{dmy(r.export_date)}</TableCell>
                  <TableCell className={`${TD} whitespace-normal`}>{r.ship_to_name ?? r.ship_to_code ?? <span className="text-slate-300">—</span>}{r.sap_pallets != null && Number(r.sap_pallets) > 0 && <span className="ml-1 text-slate-500">· {nf(r.sap_pallets, 1)} pallet</span>}</TableCell>
                  <TableCell className={`${TD} whitespace-normal`}>
                    {r.new_ods.length ? r.new_ods.map(n => (
                      <div key={n.od} className="flex flex-wrap items-center gap-1">
                        <span className="font-mono font-medium">{n.od}</span>
                        {n.kind && <span className="text-slate-500">{n.kind === 'SPLIT' ? 'tách' : n.kind === 'MERGE' ? 'gộp' : n.kind === 'PARTIAL' ? 'tách một phần' : n.kind === 'AFTER_POST' ? 'sau khi post' : 'thay'}</span>}
                        {n.delivery_date && <span className="text-slate-500">· giao {dmy(n.delivery_date)}</span>}
                        {!n.same_customer && <StatusBadge tone="red">khác khách</StatusBadge>}
                        {!n.active && <StatusBadge tone="slate">không còn ACTIVE</StatusBadge>}
                        {n.in_khvc && <StatusBadge tone="green">đã vào KH xuất</StatusBadge>}
                        {n.on_vehicle && <StatusBadge tone="purple">đang trên xe nháp</StatusBadge>}
                        {n.outside && <StatusBadge tone="slate">Ngoài app</StatusBadge>}
                      </div>
                    )) : <span className="text-slate-300">—</span>}
                    {r.kind === 'REPLACED' && r.same_content && <div className="text-green-700">cùng khách · cùng tổng SL</div>}
                  </TableCell>
                  <TableCell className={`${TD} tabular-nums whitespace-normal`}>{r.detected_at ? formatDateTime(r.detected_at) : '—'}</TableCell>
                  <TableCell className={`${TD} whitespace-normal`}>
                    {r.kind === 'QTY' && <Link to="/external?tab=reconcile" className="text-sky-700 hover:underline">Mở Dữ liệu bên ngoài → Cần xử lý</Link>}
                    {r.kind !== 'QTY' && st.col === 'C' && (
                      <span className="text-amber-800">Chuyến đang xuất — không có "giữ và chạy tiếp": {path}.</span>
                    )}
                    {(r.kind === 'GONE' || r.kind === 'REPLACED') && st.col === 'B' && (
                      <div className="flex flex-wrap gap-1.5">
                        {r.kind === 'REPLACED' && canAct && (
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy || !r.all_free || r.any_merge} onClick={() => void doRenumber(r)}
                            title={r.any_merge ? 'SAP gộp nhiều DO cũ thành một — gỡ từng DO cũ rồi điều DO mới' : !r.all_free ? 'DO mới không còn trống (đã vào KH xuất / đang trên xe nháp / Ngoài app / không ACTIVE)' : 'Kế hoạch xuất, chuyến và bàn cùng đổi sang số DO mới; chuyến dựng lại'}>
                            Đổi số DO{r.new_ods.length > 1 ? ` (${r.new_ods.length} phần)` : ''}
                          </Button>
                        )}
                        {canAct && <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => { setReason(r.kind === 'GONE' ? 'SAP đã bỏ DO' : `SAP thay bằng ${r.new_ods.map(n => n.od).join(', ')} — điều lại DO mới trên bàn`); setDlg(r) }}
                          title="Gỡ DO khỏi Số xe trong Kế hoạch xuất (có lý do, nhật ký chuyến). DO mới (nếu có) về tab Điều để ghép lại.">Gỡ khỏi kế hoạch</Button>}
                        {!canAct && <span className="text-slate-500">Cần quyền Xác nhận điều vận hoặc sửa Kế hoạch xuất.</span>}
                      </div>
                    )}
                    {(r.kind === 'GONE' || r.kind === 'REPLACED') && st.col === 'D' && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-slate-600">{r.kind === 'GONE' ? 'SAP xoá DO đã đi — sai bên SAP, báo kế toán/SAP.' : 'Hàng đã đi dưới số DO cũ.'}</span>
                        {canPlan && planId && (r.kind === 'GONE' ? <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => void doOutside(r, [r.od_number])}>Đã ghi nhận (báo SAP)</Button>
                          : freeNew.length > 0 && <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => void doOutside(r, freeNew)}>Ngoài app DO mới</Button>)}
                      </div>
                    )}
                    {r.kind === 'KIN' && (
                      <div className="flex flex-wrap gap-1.5">
                        {canPlan && planId ? <>
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => void doSupplement(r)} title="Giao thêm cho cùng dòng SO — rào thôi giữ, đơn mới điều như đơn thường">Xác nhận đơn bổ sung</Button>
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => void doOutside(r, r.new_ods.map(n => n.od))} title="Hàng đã đi dưới số DO cũ — đơn mới không giao">Ngoài app</Button>
                        </> : <span className="text-slate-500">{planId ? 'Cần quyền Lập kế hoạch.' : 'Mở một kế hoạch của kho rồi quyết ở đây.'}</span>}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </ResizableTable>
      </div>
      <ListFooter page={1} pageSize={Math.max(1, rows.length)} total={rows.length} unit="việc" onPageSize={() => { }} options={[]}
        right={`Chưa bắt đầu: gỡ / đổi số tại đây · Đang xuất: huỷ rồi điều lại (kho làm) · Đã đi: Ngoài app / đơn bổ sung · Số lượng đổi sau khi quét: Dữ liệu bên ngoài → Cần xử lý`} />
      <Dialog open={!!dlg} onOpenChange={o => { if (!o && !remove.isPending) setDlg(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Gỡ DO {dlg?.od_number} khỏi Số xe {dlg?.group_code}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-xs">
            <p className="text-slate-500">Dòng rời Kế hoạch xuất; chuyến bên Xuất dựng lại theo phần còn lại (hết dòng thì chuyến ngừng hoạt động, khung giờ / cổng nhả). Ghi vào nhật ký chuyến kèm lý do.</p>
            <label className="block"><span className="text-slate-600">Lý do</span>
              <textarea className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
            </label>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8" disabled={remove.isPending} onClick={() => setDlg(null)}>Huỷ</Button>
            <Button size="sm" className="h-8" disabled={remove.isPending} onClick={() => void doRemove()}>{remove.isPending ? 'Đang gỡ…' : 'Gỡ khỏi kế hoạch'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmNode}
    </div>
  )
}
