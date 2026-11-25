// CẤP NGUYÊN LIỆU CHO MẺ — form của BÀN LÀM VIỆC CỦA MẺ (MES 14/11; user: "nếu có QR code thì phải quét QR code và điền số lượng").
//   • Quét tem: súng PDA / camera / gõ mã ⇒ tra tem trong KHO CỦA MẺ ⇒ nhập lượng ⇒ trừ đúng dòng tồn đó.
//   • Không có tem: CHỈ cho hàng không có tem QR (tồn gộp) — chọn mã ⇒ chọn LÔ ⇒ nhập lượng. Lô còn hàng trên tem ⇒ phải quét.
// Hai cửa CÙNG một khuôn (17/11 — "đồng bộ luôn phần không có tem … thông tin tương tự nhau, có nút expand"):
//   • bảng "Lấy ở đâu" GOM THEO DATE như "Tồn kho theo %Date" của Xuất kho (MesStockGroups) — không còn mỗi pallet một dòng;
//   • đúng / sai thứ tự luân chuyển do server chấm (cùng luật quét xuất), kho bật "bắt buộc" ⇒ lý do + quyền duyệt — cả hai cửa;
//   • hàng HẾT HẠN bị chặn, chỉ cấp khi QA duyệt cho mẻ này (user chốt 17/11) — gửi QA duyệt ngay tại form; QA đứng tại bàn duyệt luôn.
// Mở từ một dòng của bàn (`focusId`) ⇒ form biết đang cấp mã nào: tem khác mã bị từ chối, lượng điền sẵn = phần còn thiếu.
// Sheet giữ mở sau mỗi lần cấp để quét liên tục; kết quả lần vừa cấp hiện ngay trên đầu.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { QtyInput } from '@/components/shared/QtyInput'
import { QRScanDialog } from '@/components/shared/QRScanDialog'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import {
  scanCheck, useConsumeScan, useConsumeLot, useProductionStock, usePickList, useExpiryRequest, useExpiryDecide,
  type BatchDetail, type ScanEntry, type PickList, type PickGroup, type MesExpiry, type MesRotation, type ExpirySubject,
} from '@/api/productionHooks'
import { usePctBands } from '@/api/hooks'
import { pctDateCls } from '@/utils/pctDateBands'
import { ROTATION_REASONS } from '@/utils/rotation'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { hasEntry, qtyIntegerError, type MatUnits } from '@/utils/qtyUnits'
import { qtyCode, qtyNum, matUnitCode } from '@/utils/unitCode'
import { reqLineState } from '@/utils/reqTolerance'
import { Check, ChevronDown, MapPin } from 'lucide-react'
import { normalizeQR } from '@/utils/qr'
import { formatDate } from '@/utils/formatters'
import { MesStockGroups, pickSummary, pickSummaryAll } from './MesStockGroups'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const avail = (e: ScanEntry) => Number(e.cartons_remaining ?? e.cartons_imported ?? 0) - Number(e.cartons_reserved ?? 0)
/** cùng luật qa_is_hold (BE): có trạng thái QA mà không phải OK = đang giữ */
const qaHold = (e: ScanEntry) => !!(e.qa_status_id || e.qa_status) && e.qa_status?.code !== 'OK'
/** lượng điền sẵn = phần còn thiếu, không vượt `cap`; mã có đơn vị nhập (bao / thùng) phải số nguyên đơn vị gốc ⇒ làm tròn LÊN
 *  (định mức × kế hoạch hay ra số lẻ — điền số lẻ là form mở ra đã báo lỗi, nút Xác nhận tắt) */
const prefill = (need: number, cap: number, mat: MatUnits | null | undefined) =>
  need <= 0 ? 0 : Math.min(qtyIntegerError(need, mat ?? null) ? Math.ceil(need - 1e-9) : need, cap)
/** khoá LÔ ổn định khi lô đổi tình trạng (vd QA vừa duyệt lô hết hạn ⇒ nhóm đổi từ "Hết hạn" sang "cấp được") */
const lotIdOf = (g: PickGroup) => `${g.production_date ?? ''}|${g.batch_lot ?? ''}`
const NO_GROUPS: PickGroup[] = []
/** tem vừa quét trong danh sách "Lấy ở đâu" (tình trạng SỐNG: QA duyệt ở máy khác ⇒ realtime đổi ngay) */
function findTem(list: PickList, entryId: string) {
  for (const g of list.tem_groups) { const item = g.items.find(i => i.entry_id === entryId); if (item) return { group: g, item } }
  return null
}
/** kết luận luân chuyển của một LÔ đã chọn — server đã chấm `violation` cho từng nhóm (cùng hàm với cửa consume-lot) */
const rotationOfGroup = (list: PickList, g: PickGroup): MesRotation => ({
  principle: list.principle, required: list.required, source: list.source, date_label: list.date_label,
  scanned_date: g.rot_date, violation: g.violation,
  best_date: list.best?.rot_date ?? null, best_pallet_code: list.best?.pallet_code ?? null, best_location_code: list.best?.location_code ?? null,
  best_no_tem: list.best?.kind === 'LOT', best_lot: list.best?.batch_lot ?? null, best_production_date: list.best?.production_date ?? null,
})

export function ConsumeSheet({ open, onClose, batch, focusId }: {
  open: boolean; onClose: () => void; batch: BatchDetail
  /** dòng của bàn làm việc đang cấp (không có = quét tự do, tem nào app tự khớp vào dòng đó) */
  focusId?: string | null
}) {
  const [mode, setMode] = useState<'SCAN' | 'LOT'>('SCAN')
  const [code, setCode] = useState('')
  const [entry, setEntry] = useState<ScanEntry | null>(null)
  const [looking, setLooking] = useState(false)
  const [camOpen, setCamOpen] = useState(false)
  const [qty, setQty] = useState(0)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)
  // lấy khác thứ tự khi kho bật "bắt buộc" (như quét xuất): lý do trong danh sách cố định + quyền outbound.rotation_override
  const [rotReason, setRotReason] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [scanAt, setScanAt] = useState(0)
  // "Lấy ở đâu" mặc định THU GỌN mỗi lần mở form; người dùng đã mở thì giữ mở suốt lượt quét liên tục
  const [pickOpen, setPickOpen] = useState(false)
  const qc = useQueryClient()
  const perms = useAuthStore(s => s.user?.module_permissions) as ModulePermissions | null | undefined
  const canRotOverride = can(perms ?? null, 'outbound', 'rotation_override')
  const canApproveExpired = can(perms ?? null, 'production', 'approve_expired')
  const pctBands = usePctBands()
  // đường "Không có tem"
  const [matTerm, setMatTerm] = useState('')
  const [matId, setMatId] = useState('')
  const [lotSel, setLotSel] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const consumeScan = useConsumeScan()
  const consumeLot = useConsumeLot()
  const expReq = useExpiryRequest()
  const expDec = useExpiryDecide()

  const focus = focusId ? batch.board.find(r => r.material_id === focusId) ?? null : null
  const boardMat = (materialId: string | undefined) => batch.board.find(x => x.material_id === materialId) ?? null
  /** phần còn thiếu của một mã theo yêu cầu của mẻ (0 = đủ trong mức lệch / không có yêu cầu) — CÙNG luật với bàn của mẻ (reqLineState) */
  const needOf = (materialId: string | undefined) => {
    const r = batch.board.find(x => x.material_id === materialId)
    return r ? reqLineState(r).need : 0
  }

  useEffect(() => {
    if (!open) return
    reset(); setDone(null); setMatTerm(''); setLotSel(''); setPickOpen(false)
    // dòng có hàng KHÔNG tem và không còn tem nào ⇒ vào thẳng "Không có tem"; còn lại luôn bắt đầu bằng quét
    const lotFirst = !!focus && Number(focus.tem_pallets) === 0 && Number(focus.available_no_tem) > 0
    setMode(lotFirst ? 'LOT' : 'SCAN'); setMatId(lotFirst ? focus.material_id : '')
  }, [open, focusId]) // eslint-disable-line react-hooks/exhaustive-deps
  function reset() { setCode(''); setEntry(null); setQty(0); setErr(''); setRotReason('') }

  // 25/11 (F3 rà soát MES): hai lần bắn sát nhau ⇒ hai lượt tra chạy song song — lượt về SAU mà là lượt CŨ thì bỏ (lần bắn mới nhất thắng;
  // không khoá súng vì luật "thấy nhắc sai thứ tự thì bắn ngay tem đúng là thay")
  const lookSeq = useRef(0)
  async function lookup(raw: string) {
    const c = normalizeQR(raw)
    if (!c) return
    const seq = ++lookSeq.current
    setCode(c); setErr(''); setEntry(null); setRotReason(''); setLooking(true)
    try {
      const e = await scanCheck(batch.id, c)
      if (seq !== lookSeq.current) return
      if (focus && e.material_id !== focus.material_id) {
        setErr(`Tem này là mã ${e.material?.material_code ?? ''} — đang cấp ${focus.material_code}. Quét đúng tem, hoặc đóng form rồi bấm "Quét cấp NVL" ở đầu bàn để cấp mã khác.`)
        return
      }
      setEntry(e); setScanAt(Date.now())
      setQty(qaHold(e) ? 0 : prefill(needOf(e.material_id), avail(e), e.material ?? boardMat(e.material_id)))   // điền sẵn phần còn thiếu (không vượt lượng trên tem)
      // quét lại = muốn tình trạng MỚI NHẤT: tải lại "Lấy ở đâu" để bảng và tem vừa quét nói cùng một chuyện (vd QA vừa duyệt)
      void qc.invalidateQueries({ queryKey: ['prod-stock', 'pick-list', batch.id] })
    }
    catch (e) { if (seq === lookSeq.current) setErr(apiMsg(e)) }
    finally { if (seq === lookSeq.current) setLooking(false) }
  }
  // Súng PDA nghe suốt lúc ở chế độ quét, KỂ CẢ khi đang hiện một tem: thấy nhắc "sai thứ tự" thì bắn ngay tem đúng là thay.
  // Bắn trúng lúc con trỏ ở ô lượng: máy đọc trả lại số trong ô rồi mới phát mã (useWedgeScanner) — số đang nhập không bị chuỗi tem phá.
  useWedgeScanner(c => { void lookup(c) }, open && mode === 'SCAN' && !camOpen && !consumeScan.isPending, { exclusive: true })

  // "LẤY Ở ĐÂU" gom theo date — SCAN: mã của tem vừa quét / dòng đang cấp · LOT: mã đã chọn. Server gom + xếp + chấm.
  const pickMatId = mode === 'SCAN' ? (entry?.material_id ?? focus?.material_id) : (matId || undefined)
  const pick = usePickList(open ? batch.id : undefined, pickMatId)
  const list = pick.data ?? null

  // ── Quét tem ──
  // tình trạng hạn của tem vừa quét: lấy bản MỚI HƠN giữa kết quả tra tem và danh sách "Lấy ở đâu" (danh sách đổi theo realtime khi
  // QA duyệt ở máy khác; quét lại thì kết quả tra là mới nhất — bản cũ của danh sách không được đè lên nó)
  const live = entry && list ? findTem(list, entry.id) : null
  const liveExp: MesExpiry | null = live ? { expired: live.item.expired, expiry_date: live.group.expiry_date, approval: live.item.approval } : null
  const scanExp: MesExpiry | null = entry ? (liveExp && pick.dataUpdatedAt >= scanAt ? liveExp : entry.expiry ?? liveExp) : null
  const offPlan = !!entry && batch.board.some(r => r.required != null) && !batch.board.some(r => r.required != null && r.material_id === entry.material_id)

  // ── Không có tem ──
  const term = useDebouncedValue(matTerm, 250)
  const mats = useProductionStock(open && mode === 'LOT' ? batch.warehouse_id : undefined, undefined, term)
  // chỉ mã còn hàng KHÔNG tem mới chọn lô bằng tay
  const matList = (mats.data?.materials ?? []).filter(m => Number(m.available_no_tem ?? 0) > 0)
  const selMat = matList.find(m => m.material_id === matId)
  const [matMemo, setMatMemo] = useState<(MatUnits & { material_code: string; material_name: string | null }) | null>(null)
  useEffect(() => { if (selMat) setMatMemo(selMat) }, [selMat])
  const focusMat = focus && focus.material_id === matId ? focus : null
  const lotMat: (MatUnits & { material_code: string }) | null = selMat ?? focusMat ?? matMemo
  const lotGroups = mode === 'LOT' ? (list?.lot_groups ?? NO_GROUPS) : NO_GROUPS
  const lotG = lotGroups.find(g => lotIdOf(g) === lotSel && g.state !== 'QA') ?? null
  useEffect(() => { setLotSel(''); setQty(0) }, [matId])
  // chọn sẵn lô nên lấy trước (hạng nhỏ nhất) — chạy lại khi lô đang chọn hết hàng / biến mất
  useEffect(() => {
    if (mode !== 'LOT' || !lotGroups.length || lotGroups.some(g => lotIdOf(g) === lotSel && g.state !== 'QA')) return
    const first = lotGroups.find(g => g.state === 'OK')
    if (first) { setLotSel(lotIdOf(first)); setQty(prefill(needOf(matId), first.available, boardMat(matId) ?? lotMat)) }
  }, [lotGroups, lotSel, mode]) // eslint-disable-line react-hooks/exhaustive-deps
  const lotExp: MesExpiry | null = lotG ? { expired: lotG.expired, expiry_date: lotG.expiry_date, approval: lotG.approval } : null

  // ── chung hai cửa: luân chuyển (server chấm) · hạn (QA duyệt) ──
  const rot: MesRotation | null = mode === 'SCAN' ? (entry?.rotation ?? null) : (lotG && list ? rotationOfGroup(list, lotG) : null)
  const exp = mode === 'SCAN' ? scanExp : lotExp
  const expBlocked = !!exp?.expired && exp.approval?.status !== 'APPROVED'
  const rotBlocked = !!rot?.violation && rot.required && (!canRotOverride || !rotReason)
  const subject: ExpirySubject | null = mode === 'SCAN'
    ? (entry ? { entry_id: entry.id } : null)
    : (lotG && matId ? { material_id: matId, production_date: lotG.production_date, batch_lot: lotG.batch_lot } : null)

  const mat: MatUnits | null = mode === 'SCAN' ? (entry?.material ?? null) : lotMat
  const max = mode === 'SCAN' ? (entry ? avail(entry) : 0) : (lotG ? lotG.available : 0)
  const intErr = qty > 0 ? qtyIntegerError(qty, mat) : null
  const over = qty > max + 1e-9
  const saving = consumeScan.isPending || consumeLot.isPending
  const held = mode === 'SCAN' && !!entry && qaHold(entry)
  const canSave = qty > 0 && !over && !intErr && !saving && !held && !rotBlocked && !expBlocked && (mode === 'SCAN' ? !!entry : !!lotG && lotG.available > 0)
  const unitText = (n: number) => qtyCode(n, mat)
  const overrideReason = rot?.violation && rot.required && rotReason ? rotReason : undefined

  async function submit() {
    setErr('')
    try {
      if (mode === 'SCAN' && entry) {
        const r = await consumeScan.mutateAsync({ batchId: batch.id, entry_id: entry.id, qty, rotation_override_reason: overrideReason })
        const row = r.rows[0]
        setDone(`Đã cấp ${unitText(qty)} từ tem ${entry.pallet_code} — tem còn ${unitText(Number(row?.remaining ?? 0))}${row?.rotation_violation ? ' · ghi nhận lấy khác thứ tự' : ''}`)
        reset()
        setTimeout(() => inputRef.current?.focus(), 50)
      } else if (lotG && matId) {
        const r = await consumeLot.mutateAsync({ batchId: batch.id, material_id: matId, production_date: lotG.production_date, batch_lot: lotG.batch_lot, qty,
          rotation_override_reason: overrideReason })
        setDone(`Đã cấp ${unitText(qty)} ${lotMat?.material_code ?? ''} theo lô ${lotG.batch_lot ?? formatDate(lotG.production_date ?? '')} — trừ ${r.rows.length} dòng tồn${r.rows[0]?.rotation_violation ? ' · ghi nhận lấy khác thứ tự' : ''}`)
        setQty(0); setRotReason('')
      }
    } catch (e) { setErr(apiMsg(e)) }
  }
  async function requestQa() {
    if (!subject) return
    setErr('')
    try { await expReq.mutateAsync({ batchId: batch.id, subject }) } catch (e) { setErr(apiMsg(e)) }
  }
  async function decideQa(decision: 'APPROVED' | 'REJECTED', note: string) {
    if (!subject) return
    setErr('')
    try { await expDec.mutateAsync({ batchId: batch.id, subject, decision, note }) } catch (e) { setErr(apiMsg(e)) }
  }
  const focusNeed = focus ? needOf(focus.material_id) : 0
  const pickMat: MatUnits | null = (mode === 'SCAN' ? entry?.material : lotMat) ?? focus ?? null
  const temGroups = list?.tem_groups ?? NO_GROUPS
  // "Lấy ở đâu" của cửa quét tem GỘP có tem + không tem (18/11 — user: "thể hiện cả tem lô nữa … trong sx họ dùng FEFO"): đúng thứ tự
  // chung server xếp (pos) — hạng 1★ có thể là lô không tem; FE không tự so ngày
  const allGroups = useMemo(() => (list ? [...list.tem_groups, ...list.lot_groups].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)) : NO_GROUPS), [list])
  const expiryLine = exp?.expired ? (
    <ExpiryLine exp={exp} what={mode === 'SCAN' ? 'Tem này' : 'Lô này'} today={list?.today ?? null} canApprove={canApproveExpired}
      busy={expReq.isPending || expDec.isPending} onRequest={() => void requestQa()} onDecide={(d, n) => void decideQa(d, n)} />
  ) : null

  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-xl"
      title={focus ? `Cấp ${focus.material_code} cho mẻ ${batch.batch_code}` : `Cấp nguyên liệu cho mẻ ${batch.batch_code}`}
      description={`Chỉ cấp hàng đang ở kho chế biến ${batch.warehouse?.name ?? ''}, không bị QA giữ; hàng hết hạn cần QA duyệt. Hàng có tem QR phải quét tem.`}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Xong</Button>
        <Button size="sm" className="h-8" disabled={!canSave} onClick={() => void submit()}>{saving ? 'Đang ghi…' : 'Xác nhận cấp'}</Button>
      </>}>
      <div className="space-y-3 text-xs">
        {focus && (
          // ba ô số có nhãn (user 17/11 "hạn chế văn viết") — ĐVT in một lần cạnh tên
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono font-semibold shrink-0">{focus.material_code}</span>
              <span className="truncate">{focus.material_name ?? ''}</span>
              {focus.required == null && <span className="shrink-0"><StatusBadge tone="slate">Ngoài phiếu</StatusBadge></span>}
              <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-400">{matUnitCode(focus)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[10px] text-slate-500">Cần</p><p className="text-sm font-semibold tabular-nums">{focus.required != null ? qtyNum(Number(focus.required), focus) : '—'}</p></div>
              <div><p className="text-[10px] text-slate-500">Đã cấp</p><p className="text-sm font-semibold tabular-nums">{Number(focus.consumed) > 0 ? qtyNum(Number(focus.consumed), focus) : '—'}</p></div>
              <div><p className="text-[10px] text-slate-500">Thiếu</p>
                <p className={`text-sm font-semibold tabular-nums ${focus.required == null ? '' : focusNeed > 0 ? 'text-amber-700' : 'text-green-600'}`}>
                  {focus.required == null ? '—' : focusNeed > 0 ? qtyNum(focusNeed, focus) : <Check className="inline h-4 w-4" aria-label="Đủ" />}
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="flex rounded-lg border overflow-hidden">
          {([['SCAN', 'Quét tem'], ['LOT', 'Không có tem']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setMode(k); reset(); if (k === 'LOT' && focus) setMatId(focus.material_id) }}
              className={['touch-target flex-1 py-1.5 text-xs font-medium transition-colors', mode === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'].join(' ')}>{label}</button>
          ))}
        </div>
        {done && <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-green-800">{done}</div>}

        {mode === 'SCAN' && (<>
          <div>
            <Label className="text-xs">Tem pallet / bao <span className="text-red-500">*</span></Label>
            <div className="flex gap-1.5 mt-0.5">
              <Input ref={inputRef} autoFocus value={code} onChange={e => { setCode(e.target.value); if (entry) setEntry(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void lookup(code) } }}
                placeholder="Bắn súng / quét camera / gõ mã rồi Enter" className="h-9 sm:h-8 text-xs font-mono flex-1 min-w-0" />
              <Button type="button" variant="outline" size="sm" className="h-9 sm:h-8 shrink-0" onClick={() => setCamOpen(true)} title="Quét bằng camera">
                <ScanIcon className="h-4 w-4" />
              </Button>
            </div>
            {looking && <p className="text-slate-500 mt-1">Đang tra tem…</p>}
          </div>
          {entry && (
            <div className="rounded-lg border border-slate-200 p-2 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono font-semibold break-all">{entry.pallet_code}</span>
                {qaHold(entry) && <StatusBadge tone="red">QA giữ</StatusBadge>}
                {scanExp?.expired && <StatusBadge tone="red">Hết hạn</StatusBadge>}
              </div>
              <div><span className="font-mono font-semibold">{entry.material?.material_code}</span> {entry.material?.short_name ?? ''}</div>
              <div className="text-slate-600">NSX {entry.production_date ? formatDate(String(entry.production_date).slice(0, 10)) : '—'}
                {' · '}HSD {scanExp?.expiry_date ? formatDate(scanExp.expiry_date) : entry.expiry_date ? formatDate(String(entry.expiry_date).slice(0, 10)) : '—'}
                {/* ngày nhập kho — khoá của FIFO / LIFO (user 18/11: "chọn ngày nhập đi, hiển thị lên cho tôi") */}
                {entry.import_date ? <span data-testid="scan-import-date">{` · nhập ${formatDate(String(entry.import_date).slice(0, 10))}`}</span> : null}
                {entry.batch ? ` · lô ${entry.batch}` : ''}{entry.location ? ` · ô ${entry.location.location_code}` : ''}
                {entry.pct_date != null && <> · %Date <b className={`tabular-nums ${pctDateCls(entry.pct_date, pctBands)}`}>{Math.floor(entry.pct_date)}%</b></>}</div>
              <div>Trên tem còn: <span className="font-semibold tabular-nums">{unitText(avail(entry))}</span>
                {!focus && needOf(entry.material_id) > 0 && <> · mẻ còn thiếu <span className="font-semibold tabular-nums text-amber-700">{unitText(needOf(entry.material_id))}</span></>}</div>
              {offPlan && <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-amber-800">Mã này không có trong yêu cầu của mẻ — vẫn cấp được, sẽ hiện là "ngoài yêu cầu".</div>}
              {held && <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-red-700">Tem đang bị QA giữ ({entry.qa_status?.name ?? entry.qa_status?.code ?? 'chưa duyệt'}) — không cấp được. Quét tem khác, hoặc nhờ QA đổi trạng thái.</div>}
              {!held && expiryLine}
              {rot && !held && !expBlocked && <RotationLine rot={rot} what="tem" reason={rotReason} onReason={setRotReason} canOverride={canRotOverride} />}
            </div>
          )}
        </>)}

        {mode === 'LOT' && (<>
          {!focus && (
            <div>
              <Label className="text-xs">Nguyên liệu <span className="text-red-500">*</span></Label>
              <SingleSelect value={matId} onChange={setMatId} serverSearch onSearchChange={setMatTerm} loading={mats.isFetching}
                selectedLabel={(selMat ?? matMemo)?.material_code} placeholder="Tìm mã / tên — chỉ mã còn hàng KHÔNG có tem"
                options={matList.map(m => ({ value: m.material_id, label: m.material_code, sub: `${m.material_name ?? ''} · không tem còn ${qtyCode(Number(m.available_no_tem ?? 0), m)}` }))} />
              {!mats.isFetching && !matList.length && !term && <p className="mt-1 text-slate-500">Kho chế biến này không có hàng nào thiếu tem — mọi nguyên liệu đều phải quét tem.</p>}
            </div>
          )}
          {matId && (
            <div>
              <Label className="text-xs">Lô <span className="text-red-500">*</span>
                {list && lotGroups.length > 0 && <span className="font-normal text-slate-500"> · {pickSummary(list, lotGroups, 'dòng')}</span>}</Label>
              <div className="mt-0.5">
                {pick.isLoading ? <p className="text-slate-400">Đang tải…</p>
                  : lotGroups.length > 0 && list ? (
                    <MesStockGroups groups={lotGroups} dateLabel={list.date_label} mat={pickMat} bands={pctBands}
                      selectedId={lotSel} idOf={lotIdOf} onSelect={g => { setLotSel(lotIdOf(g)); setRotReason(''); setQty(prefill(needOf(matId), g.available, boardMat(matId) ?? lotMat)) }}
                      testId="lot-list" />
                  ) : <p className="text-slate-500">{temGroups.length ? 'Mã này chỉ còn hàng trên pallet / bao có tem — bấm "Quét tem" để cấp.' : 'Không còn lô nào cấp được.'}</p>}
              </div>
              {lotG && (expiryLine || rot) && (
                <div className="mt-1.5 space-y-1">
                  {expiryLine}
                  {rot && !expBlocked && <RotationLine rot={rot} what="lô" reason={rotReason} onReason={setRotReason} canOverride={canRotOverride} />}
                </div>
              )}
            </div>
          )}
        </>)}

        {(mode === 'SCAN' ? !!entry && !held : !!lotG && lotG.available > 0) && (
          // Enter ở ô lượng = Xác nhận cấp (vòng PDA: bắn tem → Enter). Enter của súng bị máy đọc chặn trước khi tới đây.
          <div onKeyDown={e => { if (e.key === 'Enter' && canSave) { e.preventDefault(); void submit() } }}>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Lượng cấp{mat && !hasEntry(mat) && mat.base_unit ? ` (${matUnitCode(mat)})` : ''} <span className="text-red-500">*</span></Label>
              {max > 0 && qty !== max && <button type="button" className="text-[11px] text-blue-600 hover:underline touch-target" onClick={() => setQty(max)}>Lấy hết ({unitText(max)})</button>}
            </div>
            <div className="mt-0.5"><QtyInput value={qty} mat={mat} onChange={setQty} autoFocus /></div>
            {over && <p className="text-red-600 mt-1">Vượt lượng cấp được ({unitText(max)})</p>}
            {intErr && <p className="text-red-600 mt-1">{intErr}</p>}
          </div>
        )}
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{err}</div>}

        {/* "LẤY Ở ĐÂU" của cửa quét tem: DƯỚI CÙNG form, mặc định THU GỌN (user 18/11: "cho xuống dưới cùng … mặc định là thu gọn
            hết, bấm vào mới hiện ra") — form chỉ còn quét → lượng → xác nhận; cần xem tồn theo date thì bấm thanh. Nhóm bên trong
            cũng đóng sẵn (▸ từng nhóm). Dòng nhắc "nên lấy hàng KHÔNG tem trước" là luật luân chuyển ⇒ không giấu trong phần thu gọn.
            Cửa "Không có tem" giữ bảng lô ở chỗ cũ: đó là ô CHỌN lô (bắt buộc, chọn sẵn hạng 1) — giấu đi thì không thấy đang trừ lô nào. */}
        {mode === 'SCAN' && list && (allGroups.length > 0 || list.best?.kind === 'LOT') && (
          <div className="space-y-1" data-testid="pick-section">
            {allGroups.length > 0 && (<>
              <button type="button" onClick={() => setPickOpen(v => !v)} aria-expanded={pickOpen} data-testid="pick-toggle"
                className="touch-target w-full flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-100">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 truncate">Lấy ở đâu <span className="font-normal text-slate-500">· {pickSummaryAll(list, allGroups)}</span></span>
                <ChevronDown className={`h-3.5 w-3.5 ml-auto shrink-0 transition-transform ${pickOpen ? 'rotate-180' : ''}`} />
              </button>
              {pickOpen && (
                <MesStockGroups groups={allGroups} dateLabel={list.date_label} mat={pickMat} bands={pctBands}
                  highlightEntryId={entry?.id ?? null} onOpenPallet={setDetailId} testId="pick-list" />
              )}
            </>)}
            {list.best?.kind === 'LOT' && (
              <p className="text-amber-700">Hàng nên lấy trước là hàng KHÔNG tem{list.best.batch_lot ? ` (lô ${list.best.batch_lot})` : ''} — cấp ở "Không có tem".</p>
            )}
          </div>
        )}
      </div>
      {detailId && <PalletDetailDialog entryId={detailId} onClose={() => setDetailId(null)} />}
      <QRScanDialog open={camOpen} onClose={() => setCamOpen(false)} warehouseId={batch.warehouse_id}
        title="Quét tem nguyên liệu" onScan={t => { setCamOpen(false); void lookup(t) }} />
    </FormSheet>
  )
}

// ── Kết quả luân chuyển của tem / lô đang chọn (server chấm — cùng luật quét xuất) ──
function RotationLine({ rot, what, reason, onReason, canOverride }: {
  rot: MesRotation; what: 'tem' | 'lô'; reason: string; onReason: (v: string) => void; canOverride: boolean
}) {
  const rule = `${rot.principle}${rot.source === 'TYPE' ? ' (theo Loại kho)' : ''}`
  if (!rot.violation) {
    return rot.best_date || rot.scanned_date
      ? <div className="rounded bg-green-50 border border-green-200 px-2 py-1 text-green-800" data-testid="rotation-ok">Đúng thứ tự {rule}{rot.scanned_date ? ` · ${rot.date_label} ${formatDate(rot.scanned_date)}` : ''}</div>
      : null
  }
  const when = `${rot.date_label} ${rot.best_date ? formatDate(rot.best_date) : '—'}`
  const where = rot.best_no_tem
    ? `Còn hàng không tem${rot.best_lot ? ` lô ${rot.best_lot}` : ''} (${when}) phải dùng trước.`
    : `Còn tem ${rot.best_pallet_code ?? ''} (${when})${rot.best_location_code ? ` ở ô ${rot.best_location_code}` : ''} phải dùng trước.`
  // cách sửa tuỳ đang ở cửa nào và hàng đúng là có tem hay không tem
  const fix = rot.best_no_tem ? (what === 'lô' ? 'Chọn lô đó là thay' : 'Cấp ở "Không có tem"') : (what === 'tem' ? 'Bắn tem đó là thay' : 'Quét tem đó ở "Quét tem"')
  if (!rot.required) {
    return <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-amber-800" data-testid="rotation-warn">Sai thứ tự {rule}: {where} {fix} — vẫn cấp {what} này được.</div>
  }
  return (
    <div className="rounded bg-red-50 border border-red-200 px-2 py-1.5 text-red-700 space-y-1.5" data-testid="rotation-block">
      <p>Kho bắt buộc lấy đúng {rule}. {where}</p>
      {canOverride ? (
        <div className="flex flex-wrap gap-1">
          {ROTATION_REASONS.map(r => (
            <button key={r.code} type="button" onClick={() => onReason(reason === r.code ? '' : r.code)} aria-pressed={reason === r.code}
              className={`touch-target rounded-md border px-2 py-1 text-[11px] ${reason === r.code ? 'border-red-500 bg-red-600 text-white' : 'border-red-300 bg-white text-red-700'}`}>{r.label}</button>
          ))}
        </div>
      ) : <p className="font-medium">Cần người có quyền duyệt lấy khác thứ tự.</p>}
    </div>
  )
}

// ── Hàng HẾT HẠN (user chốt 17/11 "chặn và cho qua khi QA duyệt"): gửi QA duyệt · QA đứng tại bàn duyệt / từ chối luôn ──
function ExpiryLine({ exp, what, today, canApprove, busy, onRequest, onDecide }: {
  exp: MesExpiry; what: string; today: string | null; canApprove: boolean; busy: boolean
  onRequest: () => void; onDecide: (d: 'APPROVED' | 'REJECTED', note: string) => void
}) {
  const [note, setNote] = useState('')
  const a = exp.approval
  const hsd = exp.expiry_date ? formatDate(exp.expiry_date) : '—'
  const over = today && exp.expiry_date ? Math.round((Date.parse(today) - Date.parse(exp.expiry_date)) / 86_400_000) : null
  if (a?.status === 'APPROVED') {
    return <div className="rounded bg-green-50 border border-green-200 px-2 py-1 text-green-800" data-testid="expiry-approved">
      Hết hạn (HSD {hsd}) — QA {a.decided_by_name ?? ''} đã duyệt cho mẻ này{a.note ? `: ${a.note}` : ''}.</div>
  }
  return (
    <div className="rounded bg-red-50 border border-red-200 px-2 py-1.5 text-red-700 space-y-1.5" data-testid="expiry-block">
      <p><b>{what} đã hết hạn</b> (HSD {hsd}{over != null && over > 0 ? `, quá ${over} ngày` : ''}) — chỉ cấp vào mẻ khi QA duyệt.</p>
      {a?.status === 'PENDING' && <p className="text-amber-800" data-testid="expiry-pending">Đã gửi QA duyệt{a.requested_by_name ? ` (${a.requested_by_name})` : ''} — chờ QA. QA duyệt xong form tự mở khoá.</p>}
      {a?.status === 'REJECTED' && <p data-testid="expiry-rejected">QA {a.decided_by_name ?? ''} từ chối{a.note ? `: ${a.note}` : ''}. Dùng tem / lô khác.</p>}
      {(!a || a.status === 'REJECTED') && (
        <button type="button" disabled={busy} onClick={onRequest} data-testid="expiry-request"
          className="touch-target rounded-md border border-red-300 bg-white px-2.5 py-1 text-[11px] font-medium text-red-700 disabled:opacity-50">{a ? 'Gửi lại QA duyệt' : 'Gửi QA duyệt'}</button>
      )}
      {canApprove && (
        <div className="pt-1 border-t border-red-200 space-y-1">
          <Input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="QA ghi căn cứ duyệt / lý do từ chối"
            className="h-8 text-xs bg-white" data-testid="expiry-note" />
          <div className="flex gap-1.5">
            <button type="button" disabled={busy || !note.trim()} onClick={() => onDecide('APPROVED', note.trim())} data-testid="expiry-approve"
              className="touch-target flex-1 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50">QA duyệt cho dùng</button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => onDecide('REJECTED', note.trim())} data-testid="expiry-reject"
              className="touch-target flex-1 rounded-md border border-red-300 bg-white px-2 py-1 text-[11px] font-medium text-red-700 disabled:opacity-50">Từ chối</button>
          </div>
        </div>
      )}
    </div>
  )
}
