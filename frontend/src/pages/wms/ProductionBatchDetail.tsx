// CHI TIẾT MẺ CHẾ BIẾN (MES giai đoạn 1, 14/11/2026). Header: mã lô + TÌNH TRẠNG theo bước (18/11 — hàm DB mes_batch_stage) + nút.
// 17/11 — LUỒNG CỦA MẺ: dải bước dưới header; kho bật "chặn theo từng bước" thì NÚT CHÍNH là đúng bước đang tới (bước trước xong mới tới bước sau).
// Khối NGUYÊN LIỆU ĐÃ RÚT (sổ tiêu hao: tem · NSX · lượng · cách ghi · huỷ dòng hoàn tồn) · khối RA BỒN (lô của mẻ trong từng bồn +
// sổ nạp / rút). Số lượng NVL in CON SỐ TRẦN + cột ĐVT bằng mã danh mục (utils/unitCode — user 17/11 "hạn chế văn viết"), số bồn in theo đơn vị bồn.
import { Fragment, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { ArrowLeft, Plus, Pencil, XCircle, ShieldCheck, Container, Undo2, Copy, AlertTriangle, ListChecks, Check, Printer, Play, FileText, ArrowDownToLine, RotateCcw, Search, ChevronDown, ChevronRight, Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MesStockDialog } from '@/components/wms/production/MesStockGroups'
import { ConsumedTems, consumedNoun } from '@/components/wms/production/ConsumedTems'
import { PinnedTabsBar, PinnedTab } from '@/components/shared/PinnedTabs'
import { useActiveBatchesStore, batchTabDot } from '@/stores/activeBatchesStore'
import { usePctBands } from '@/api/hooks'
import type { ConsumptionRow } from '@/api/productionHooks'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { CollapseSection } from '@/components/shared/CollapseSection'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { BatchFormSheet } from '@/components/wms/production/BatchFormSheet'
import { ConsumeSheet } from '@/components/wms/production/ConsumeSheet'
import { RequirementSheet } from '@/components/wms/production/RequirementSheet'
import { ProcessLogSheet } from '@/components/wms/production/ProcessLogSheet'
import { formProgress, formsOfBatch } from '@/config/processForms'
import { FlowStrip, BatchLabelSheet, PourSheet, type FlowStep } from '@/components/wms/production/BatchFlow'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { BatchFillSheet, nfQty } from '@/components/wms/production/TankSheets'
import { MobileNumHead, MobileNumRow, type NumCol } from '@/components/wms/production/MobileNumGrid'
import { useAuthStore } from '@/stores/authStore'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { can, type ModulePermissions } from '@/config/permissions'
import { rowText } from '@/lib/rowStatus'
import {
  useProductionBatch, useBatchStatus, useApproveBatch, useLogStart, useReverseConsumption, TANK_MOVE_VI,
  useProcessForms, useSetBatchForms, useExpiryDecide, type BatchDetail, type ExpiryApproval,
} from '@/api/productionHooks'
import { StageBadge, BATCH_STAGE, stageOf, stageText, stageTabMark } from '@/components/wms/production/BatchStage'
import { qtyNum, qtyCode, matUnitCode, unitCode } from '@/utils/unitCode'
import { formatDate, formatDateTime } from '@/utils/formatters'
import { reqLineState, devLabel, type ReqLineResult } from '@/utils/reqTolerance'
import { rotationReasonLabel } from '@/utils/rotation'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
// BÀN LÀM VIỆC: mỗi nguyên liệu của mẻ một dòng — cần · đã cấp · còn thiếu · tồn ở kho chế biến · cách cấp.
// Ô số in CON SỐ TRẦN, ĐVT in một lần ở cột ĐVT bằng mã của danh mục (user 17/11: "hạn chế văn viết, dùng đơn vị tính của app").
const BOARD_COLS: RtColDef[] = [
  { id: 'mat', label: 'Nguyên liệu', w: 220 }, { id: 'unit', label: 'ĐVT', w: 56 }, { id: 'req', label: 'Cần', w: 110, align: 'right' },
  { id: 'done', label: 'Đã cấp', w: 100, align: 'right' }, { id: 'need', label: 'Thiếu', w: 100, align: 'right' },
  { id: 'stock', label: 'Tồn kho', w: 100, align: 'right' }, { id: 'how', label: 'Cách cấp', w: 100 }, { id: 'st', label: 'Tình trạng', w: 100 },
  { id: 'act', label: '', w: 76, stickyRight: true },
]
// điện thoại: cùng bốn cột số, nhãn in một lần ở đầu danh sách
// cột "Cần" rộng hơn: số + "gốc …" CÙNG HÀNG (user 18/11: "các số cùng 1 hàng — gốc không cho xuống hàng")
const MOBILE_BOARD_TPL = 'minmax(0, 1.6fr) repeat(3, minmax(0, 1fr))'
const MOBILE_BOARD_COLS: NumCol[] = [
  { label: 'Cần' }, { label: 'Đã cấp' }, { label: 'Thiếu', title: 'Còn thiếu · ✓ = đủ · +x% = cấp vượt mức lệch cho phép' }, { label: 'Tồn kho', title: 'Tồn ở kho chế biến' },
]
const RM_COLS: RtColDef[] = [
  { id: 'mat', label: 'Nguyên liệu', w: 170 }, { id: 'qty', label: 'Lượng rút', w: 100, align: 'right' }, { id: 'unit', label: 'ĐVT', w: 56 }, { id: 'pallet', label: 'Tem', w: 210 },
  { id: 'nsx', label: 'NSX', w: 78 }, { id: 'lot', label: 'Mã lô', w: 110 }, { id: 'src', label: 'Cách ghi', w: 86 },
  { id: 'at', label: 'Lúc', w: 120 }, { id: 'by', label: 'Người rút', w: 130 }, { id: 'act', label: '', w: 60, stickyRight: true },
]
const LOT_COLS: RtColDef[] = [
  { id: 'tank', label: 'Bồn', w: 90 }, { id: 'in', label: 'Đã nạp', w: 100, align: 'right' }, { id: 'rem', label: 'Còn trong bồn', w: 110, align: 'right' },
  { id: 'filled', label: 'Nạp lúc', w: 120 }, { id: 'exp', label: 'Hạn lưu bồn', w: 120 }, { id: 'st', label: 'Trạng thái', w: 90 },
]
const MOVE_COLS: RtColDef[] = [
  { id: 'at', label: 'Lúc', w: 120 }, { id: 'kind', label: 'Việc', w: 110 }, { id: 'tank', label: 'Bồn', w: 80 },
  { id: 'qty', label: 'Lượng', w: 100, align: 'right' }, { id: 'by', label: 'Người', w: 130 }, { id: 'note', label: 'Lý do / cảnh báo', w: 260 },
]

/** Gắn key theo id: "Mở mẻ giống" chuyển từ mẻ này sang mẻ mới trên CÙNG route — không dựng lại thì form Rút NVL không tự mở
 *  và trạng thái (lỗi, dòng đang cấp) của mẻ cũ dính sang mẻ mới. */
export default function ProductionBatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  return <ProductionBatchDetail key={id} />
}

function ProductionBatchDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const q = useProductionBatch(id)
  const b = q.data
  const setStatus = useBatchStatus()
  const approve = useApproveBatch()
  const logStart = useLogStart()
  const setForms = useSetBatchForms()
  const reverse = useReverseConsumption()
  const [ask, confirmNode] = useConfirmDialog()
  const canSeeTanks = useCanSeePath()('/wms/production/tanks')
  // mở mẻ xong KHÔNG tự bật form cấp NVL (user 18/11: "mở mẻ xong đừng tự động vào scan") — bước kế theo luồng là duyệt phiếu
  const [consumeOpen, setConsumeOpen] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  // bàn không nghe sổ tồn của cả app (quá nhiều sự kiện) ⇒ dòng "kho hết" vẫn bấm được: tải lại bàn rồi mở form — form tra tồn sống
  const openConsume = (materialId: string, stale: boolean) => { if (stale) void q.refetch(); setFocusId(materialId); setConsumeOpen(true) }
  const [reqOpen, setReqOpen] = useState(false)
  const [logForm, setLogForm] = useState<string | null>(null)
  const { data: processForms = [] } = useProcessForms()
  const [fillOpen, setFillOpen] = useState(false)
  const [labelOpen, setLabelOpen] = useState(false)
  const [pourOpen, setPourOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  // kính lúp cột Tồn kho (như cột Kho của Xuất kho): tồn của một mã trong kho chế biến gom theo %Date
  const [stockMat, setStockMat] = useState<string | null>(null)
  // dòng của bàn đang MỞ RỘNG (xem từng tem / lô đã cấp — như "pallet đã quét" của Xuất kho, user 18/11)
  const [openMats, setOpenMats] = useState<Set<string>>(new Set())
  const toggleMat = (m: string) => setOpenMats(prev => { const n = new Set(prev); if (n.has(m)) n.delete(m); else n.add(m); return n })
  const bands = usePctBands()
  // MẺ ĐANG LÀM (🔖 + dải tab "Đang làm:" như Xuất kho — user 18/11: "cho lựa chọn tab để làm nhiều mẻ 1 lúc")
  const { batches: pinnedBatches, pin: pinBatch, unpin: unpinBatch, isPinned: isBatchPinned } = useActiveBatchesStore()
  // mẻ đang đánh dấu: ghi lại mã lô + tình trạng mới nhất (mã lô đổi khi đổi bồn / chu kỳ / số mẻ)
  useEffect(() => {
    if (b && isBatchPinned(b.id)) pinBatch({ id: b.id, code: b.batch_code, stage: b.gate?.stage ?? '' })
  }, [b?.id, b?.batch_code, b?.gate?.stage]) // eslint-disable-line react-hooks/exhaustive-deps
  // mẻ không còn (404) ⇒ gỡ khỏi dải
  useEffect(() => {
    if (q.isError && (q.error as AxiosError | null)?.response?.status === 404 && id) unpinBatch(id)
  }, [q.isError]) // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState('')

  if (q.isLoading) return <div className="p-6 text-sm text-slate-500">Đang tải mẻ…</div>
  if (q.isError || !b) return (
    <div className="p-6 text-sm space-y-2">
      <p className="text-red-600">{q.isError ? apiMsg(q.error) : 'Không tìm thấy mẻ'}</p>
      <button type="button" onClick={() => navigate('/wms/production')} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" />Về danh sách mẻ
      </button>
    </div>
  )

  const u = unitCode(b.material?.base_unit)
  const open = b.status === 'OPEN'
  const live = b.consumption.filter(c => !c.reversed_at)
  const filled = b.movements.filter(m => m.kind === 'FILL').reduce((s, m) => s + Number(m.qty), 0)
  const inTank = b.lots.filter(l => l.status === 'ACTIVE').reduce((s, l) => s + Number(l.qty_remaining), 0)
  // 0 − tổng (không phải −tổng): chưa rút lần nào thì tổng = 0 và −0 in ra "-0"
  const drawn = 0 - b.movements.filter(m => m.kind === 'DRAW').reduce((s, m) => s + Number(m.qty), 0)
  const rmMats = new Set(live.map(c => c.material_id)).size
  // tem / lô đã cấp (dòng còn hiệu lực) theo nguyên liệu — nuôi dòng mở rộng của bàn
  const consByMat = new Map<string, ConsumptionRow[]>()
  for (const c of live) { const a = consByMat.get(c.material_id); if (a) a.push(c); else consByMat.set(c.material_id, [c]) }
  const board = b.board ?? []
  const reqRows = board.filter(r => !r.removed && r.required != null)
  // trạng thái một dòng theo MỨC LỆCH cho phép (17/11) — một luật cho bảng máy tính, danh sách điện thoại và ô "NVL đã đủ"
  // mẻ đã nạp BTP vào bồn = xong phần sản xuất ⇒ phần còn thiếu là thiếu thật, tô đỏ (18/11 — thay cho "mẻ đã đóng")
  const stOf = (r: (typeof board)[number]): ReqLineResult => reqLineState(r, filled > 0)
  const reqDone = reqRows.filter(r => ['ok', 'over'].includes(stOf(r).state)).length
  const offTol = reqRows.filter(r => stOf(r).outOfTol).length
  const nfq = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
  // ô Yêu cầu: số đang hiệu lực + dấu sửa (gốc / thêm / thay cho) — tooltip ghi lý do, người, giờ
  const changeTip = (r: (typeof board)[number]) => r.changed_at ? `${r.change_reason ?? ''} — ${r.changed_by_name ?? ''} · ${formatDateTime(r.changed_at)}` : undefined
  const statusBadge = (r: (typeof board)[number]) => {
    const st = stOf(r)
    if (st.state === 'removed') return <StatusBadge tone="slate" title={changeTip(r)}>Đã bỏ{r.replaced_by_code ? ` → ${r.replaced_by_code}` : ''}</StatusBadge>
    if (st.state === 'extra') return <StatusBadge tone="slate">Ngoài phiếu</StatusBadge>
    if (st.state === 'over') return <StatusBadge tone="red" title={r.tol_pct != null ? `Mức lệch cho phép ±${nfq(r.tol_pct)}%` : undefined}>{r.tol_pct != null ? `Lệch ${devLabel(st.devPct)}` : 'Vượt yêu cầu'}</StatusBadge>
    if (st.state === 'under') return <StatusBadge tone="red">Thiếu {devLabel(st.devPct) || 'chưa cấp'}</StatusBadge>
    if (st.state === 'ok') return <StatusBadge tone="green" title={st.devPct ? `Lệch ${devLabel(st.devPct)} — trong mức cho phép` : undefined}>Đủ</StatusBadge>
    if (st.state === 'progress') return <StatusBadge tone="amber">Đang cấp</StatusBadge>
    return <StatusBadge tone="slate">Chưa cấp</StatusBadge>
  }
  const reqNote = (r: (typeof board)[number]) => r.removed
    ? <span className="text-slate-400 font-normal">gốc {r.standard != null ? nfq(r.standard) : '—'}</span>
    : r.standard == null ? <span className="ml-1 text-[9px] font-normal text-blue-700" title={changeTip(r)}>{r.replaces_code ? `thay ${r.replaces_code}` : 'thêm'}</span>
    : Math.abs(Number(r.required) - Number(r.standard)) > 0.0005 ? <span className="ml-1 text-[9px] font-normal text-amber-700" title={changeTip(r)}>gốc {nfq(r.standard)}</span> : null

  async function run(fn: () => Promise<unknown>) { setErr(''); try { await fn() } catch (e) { setErr(apiMsg(e)) } }
  async function doApprove(step: 'lead' | 'qa', ok: boolean) {
    if (!ok) {
      const c = await ask({ title: step === 'qa' ? 'QA bỏ duyệt phiếu?' : 'Trưởng ca bỏ duyệt phiếu?', body: 'Bỏ duyệt để sửa phiếu của mẻ. Chưa duyệt lại thì chưa cấp tiếp nguyên liệu được.' })
      if (c === null) return
    }
    await run(() => approve.mutateAsync({ id: b!.id, step, approve: ok }))
  }
  // PHIẾU BỔ SUNG của mẻ (17/11): trưởng ca / QA thêm, bớt — phiếu đã ghi không bỏ được (BE chặn)
  const doForms = (forms: string[]) => run(() => setForms.mutateAsync({ id: b!.id, forms }))
  async function dropForm(code: string, title: string) {
    if (await ask({ title: `Bỏ phiếu "${title}" khỏi mẻ?`, body: 'Phiếu chưa ghi gì. Thêm lại được khi cần.', confirmLabel: 'Bỏ phiếu', danger: true }) === null) return
    await doForms((b!.extra_forms ?? []).filter(c => c !== code))
  }
  // PHIẾU THEO DÕI — MỘT nút (user 18/11): phiếu chưa ghi ⇒ "Bắt đầu" = ghi giờ bắt đầu (giờ máy chủ, mốc giờ đầu của phiếu) rồi mở phiếu;
  // phiếu đã ghi ⇒ mở phiếu. Trong phiếu mỗi ô là một nút (ô giờ bấm là ghi giờ, ô khác hiện khung nhập).
  async function openLog(form: string, start: boolean) {
    if (start) {
      setErr('')
      try { await logStart.mutateAsync({ batchId: b!.id, form }); await q.refetch() } catch (e) { setErr(apiMsg(e)); return }
    }
    setLogForm(form)
  }
  async function doCancel() {
    const ok = await ask({ title: `Huỷ mẻ ${b!.batch_code}?`, danger: true, body: 'Chỉ huỷ được mẻ chưa rút nguyên liệu và chưa nạp bồn.' })
    if (ok === null) return
    await run(() => setStatus.mutateAsync({ id: b!.id, action: 'cancel' }))
  }
  async function doReverse(cid: string, label: string) {
    const reason = await ask({ title: `Huỷ dòng rút ${label}?`, body: 'Lượng đã rút được hoàn lại đúng tem / dòng tồn đó. Dòng huỷ vẫn giữ trong sổ để truy vết.', danger: true,
      input: { label: 'Lý do huỷ', required: true, placeholder: 'Quét nhầm tem · nhập sai số…' } })
    if (!reason) return
    await run(() => reverse.mutateAsync({ id: cid, reason }))
  }

  const busy = setStatus.isPending || approve.isPending
  const P = (a: string) => can(perms, 'production', a)
  // CỔNG CỦA MẺ (hàm DB mes_batch_gate — cũng là hàm chặn nạp bồn): kho bật "chặn theo từng bước" ⇒ strict
  const g = b.gate
  const strict = !!g?.flow_gate
  const hasFill = filled > 0
  const labelsOk = !!g?.label_valid && !!g?.label_count
  const scannedAll = labelsOk && (g?.scanned ?? 0) >= (g?.label_count ?? 0)
  const rmOk = reqRows.length > 0 && (g?.short.length ?? 0) === 0
  const logOk = !!g && !g.need_log && g.missing.length === 0
  const no4 = b.batch_no ? String(b.batch_no).padStart(4, '0') : '—'
  const stepDefs = [
    { key: 'lead', label: 'Trưởng ca duyệt', done: !!b.lead_ok_at },
    { key: 'qa', label: 'QA duyệt', done: !!b.qa_ok_at },
    { key: 'rm', label: 'Cấp nguyên liệu', done: rmOk, detail: reqRows.length ? `${reqDone}/${reqRows.length}` : undefined },
    { key: 'log', label: 'Ghi phiếu', done: logOk, detail: g?.missing.length ? `còn ${g.missing.length} ô` : undefined },
    { key: 'label', label: 'In tem pallet', done: labelsOk, detail: labelsOk ? `${g?.label_count} tem` : undefined },
    { key: 'pour', label: 'Check trước khi đổ bồn', done: scannedAll, detail: labelsOk ? `${g?.scanned}/${g?.label_count}` : undefined },
    { key: 'fill', label: 'Nạp BTP vào bồn', done: hasFill },
    { key: 'tankqa', label: 'QA bồn', done: hasFill && b.qa_status === 'RELEASED', bad: b.qa_status === 'REJECTED' },
  ]
  const cur = stepDefs.findIndex(s => !s.done)
  const curKey = cur >= 0 ? stepDefs[cur].key : null
  // bước nào là VIỆC CỦA NGƯỜI ĐANG XEM (quyền của chức danh — cùng quyền gác nút của bước đó): bước đang tới không phải việc của mình
  // ⇒ dải in "chờ" (user 18/11 "các user tương tác theo quyền hạn của nó … có nên cho họ thấy không")
  const mineOf: Record<string, boolean> = {
    lead: P('approve_lead'), qa: P('approve_qa'), rm: P('consume'), log: P('process_log'),
    label: P('print_label'), pour: P('pour') || P('tank_ops'), fill: P('tank_ops'), tankqa: P('qa_release'),
  }
  const steps: FlowStep[] = stepDefs.map((s, i) => ({ key: s.key, label: s.label, detail: s.detail, mine: mineOf[s.key], state: s.bad ? 'bad' : s.done ? 'done' : i === cur ? 'now' : 'todo' }))
  // luồng chặt: chỉ BƯỚC ĐANG TỚI là nút chính (bước trước xong mới tới bước sau); không chặt: như trước (Cấp NVL + Nạp bồn)
  const prim = (k: string) => (strict ? curKey === k : k === 'rm' || k === 'fill')
  // mẻ đã nạp BTP vào bồn ⇒ sổ nguyên liệu KHOÁ (user 18/11 "ok" khoá cấp / huỷ sau khi nạp — BE: mes_open_batch_wh, 409 MES_BATCH_FILLED)
  const canConsume = open && !hasFill && P('consume') && (g?.can_consume ?? true)
  const canFill = b.status !== 'CANCELLED' && b.qa_status !== 'REJECTED' && P('tank_ops')
  const canEditTank = open && P('open_batch') && !b.movements.length
  const logged = (b.process_logs ?? []).map(l => l.form)
  const batchForms = formsOfBatch(processForms, b.extra_forms ?? [], logged)
  const canEditForms = open && (P('open_batch') || P('approve_lead') || P('approve_qa'))
  const addableForms = processForms.filter(d => d.optional && d.is_active && !(b.extra_forms ?? []).includes(d.code) && !logged.includes(d.code))
  const firstForm = g?.missing[0]?.form ?? batchForms.find(d => !logged.includes(d.code))?.code ?? batchForms[0]?.code ?? null
  // ── NÚT CỦA MẺ (18/11 — user: "cái nào liên quan tới VẬN HÀNH đưa ra ngoài theo tuần tự công việc, cái nào liên quan tới QUẢN TRỊ
  //    (sửa, đóng, duplicate…) thì để trong 3 chấm"). Vận hành (`ops`) xếp ĐÚNG thứ tự dải bước, luôn ngoài ⋮ kể cả điện thoại, có chữ;
  //    nút nền xanh = bước đang tới (luồng chặt) / Cấp NVL + Nạp bồn (không chặt). Quản trị (`admin`) luôn trong ⋮, kể cả máy tính.
  const opsOf = (k: string) => ({ ops: true, primary: prim(k), variant: prim(k) ? 'default' as const : undefined })
  const actions: ActionItem[] = []
  if (open && !b.lead_ok_at && P('approve_lead'))
    actions.push({ key: 'ok-lead', icon: ShieldCheck, label: 'Duyệt phiếu', tip: 'Trưởng ca duyệt phiếu nguyên liệu của mẻ (duyệt 1)', ...opsOf('lead'), onClick: () => void doApprove('lead', true), disabled: busy })
  if (open && !!b.lead_ok_at && !b.qa_ok_at && P('approve_qa'))
    actions.push({ key: 'ok-qa', icon: ShieldCheck, label: 'QA duyệt', tip: 'QA duyệt phiếu của mẻ (duyệt 2) — duyệt xong phiếu khoá, mới cấp nguyên liệu', ...opsOf('qa'), onClick: () => void doApprove('qa', true), disabled: busy })
  if (canConsume)
    actions.push({ key: 'consume', icon: ScanIcon, label: 'Quét cấp NVL', tip: 'Quét tem nguyên liệu để cấp cho mẻ — app tự khớp vào đúng dòng của bàn và điền sẵn lượng còn thiếu', ...opsOf('rm'), onClick: () => { setFocusId(null); setConsumeOpen(true) } })
  // phiếu theo dõi: mở phiếu cần ghi trước (còn ô bắt buộc / chưa ghi); phiếu đó chưa ghi gì ⇒ "Bắt đầu phiếu" (ghi giờ bắt đầu)
  if (open && firstForm && P('process_log')) {
    const startLog = !logged.includes(firstForm)
    const short = processForms.find(d => d.code === firstForm)?.short ?? firstForm
    actions.push({ key: 'log', icon: startLog ? Play : FileText, label: startLog ? 'Bắt đầu phiếu' : 'Phiếu theo dõi',
      tip: startLog ? `Bắt đầu phiếu ${short}: ghi giờ bắt đầu (giờ máy chủ) rồi mở phiếu để ghi từng ô` : `Mở phiếu ${short} — bấm từng ô để ghi`,
      ...opsOf('log'), busy: logStart.isPending, onClick: () => void openLog(firstForm, startLog) })
  }
  if (open && !!b.tank_id && P('print_label') && (!strict || !!b.qa_ok_at))
    actions.push({ key: 'label', icon: Printer, label: labelsOk ? 'In lại tem' : 'In tem pallet', tip: 'In tem pallet của mẻ (QR 1/n … n/n) để dán lên pallet nguyên liệu đã cấp', ...opsOf('label'), onClick: () => setLabelOpen(true) })
  if (open && labelsOk && !hasFill && (P('pour') || P('tank_ops')))
    actions.push({ key: 'pour', icon: ArrowDownToLine, label: 'Check trước khi đổ bồn', tip: `Đứng ở bồn ${b.tank?.code ?? ''}, quét từng tem pallet của mẻ — đúng mẻ, đúng bồn mới đổ`, ...opsOf('pour'), onClick: () => setPourOpen(true) })
  // Nạp BTP vào bồn: cổng của mẻ chưa cho nạp (mes_batch_gate.fill_blockers — chỉ có ở luồng chặt) ⇒ nút KHOÁ kèm lý do và KHÔNG chiếm
  // chỗ ngoài ⋮ (điện thoại xem lý do ở dòng menu; máy tính rê chuột) — tới bước thì ra ngoài như bước khác
  const fillBlock = g?.fill_blockers ?? []
  if (canFill)
    actions.push({ key: 'fill', icon: Container, label: 'Nạp BTP vào bồn', tip: fillBlock.length ? `Chưa nạp được: ${fillBlock.join(' · ')}` : 'Nạp bán thành phẩm của mẻ vào bồn đã chọn',
      ...(fillBlock.length ? {} : opsOf('fill')), disabled: fillBlock.length > 0, onClick: () => setFillOpen(true) })
  // QA kết luận ở Bồn — nút chỉ cho người có quyền QA bồn (qa_release); người khác thấy bước "QA bồn · chờ" trên dải
  if (strict && curKey === 'tankqa' && canSeeTanks && P('qa_release'))
    actions.push({ key: 'tankqa', icon: ShieldCheck, label: `Tới bồn ${b.tank?.code ?? ''}`, tip: 'QA kết luận đạt / không đạt ở trang Bồn (áp cho mọi mẻ đang trong bồn)', ops: true, primary: true, onClick: () => navigate('/wms/production/tanks') })
  // ── QUẢN TRỊ (⋮) ──
  if (can(perms, 'production', 'open_batch') && b.status !== 'CANCELLED')
    actions.push({ key: 'edit', icon: Pencil, label: 'Sửa / đổi bồn', tip: 'Sửa ngày / máy / ca / kế hoạch; đổi chu kỳ · số mẻ · bồn khi chưa nạp bồn (mã lô đổi theo)', admin: true, onClick: () => setEditOpen(true) })
  if (open && !b.qa_ok_at && can(perms, 'production', 'edit_requirement'))
    actions.push({ key: 'req', icon: ListChecks, label: 'Sửa định mức', tip: 'Sửa định mức của riêng mẻ này: sửa số · thêm · bỏ · đổi mã · đổi công thức (bắt buộc lý do, giữ định mức gốc)', admin: true, onClick: () => setReqOpen(true) })
  if (open && !!b.lead_ok_at && !b.qa_ok_at && P('approve_lead'))
    actions.push({ key: 'no-lead', icon: RotateCcw, label: 'Bỏ duyệt', tip: 'Trưởng ca bỏ duyệt để sửa phiếu của mẻ', admin: true, onClick: () => void doApprove('lead', false), disabled: busy })
  if (open && !!b.qa_ok_at && !hasFill && P('approve_qa'))
    actions.push({ key: 'no-qa', icon: RotateCcw, label: 'Bỏ duyệt QA', tip: 'QA bỏ duyệt để sửa phiếu của mẻ — chưa duyệt lại thì chưa làm tiếp được', admin: true, onClick: () => void doApprove('qa', false), disabled: busy })
  if (can(perms, 'production', 'open_batch')) {
    actions.push({ key: 'clone', icon: Copy, label: 'Mở mẻ giống', tip: 'Mở mẻ mới cùng kho · mã bán thành phẩm · chu kỳ · bồn · máy · ca · kế hoạch (số mẻ kế tiếp)', admin: true, onClick: () => setCloneOpen(true) })
    if (b.status !== 'CANCELLED') actions.push({ key: 'cancel', icon: XCircle, label: 'Huỷ mẻ', tip: 'Huỷ mẻ mở nhầm (chưa rút, chưa nạp)', admin: true, danger: true, onClick: () => void doCancel(), disabled: busy })
  }
  // XEM TEM ĐÃ CẤP của CẢ MẺ — nút ở thanh "Nguyên liệu của mẻ", không nằm trong ⋮ (user 18/11: "cho nút mở rộng này ra khỏi ba chấm")
  const anyOpen = [...openMats].some(m => consByMat.has(m))
  const temTotal = consumedNoun(live)
  const canReverse = open && !hasFill && can(perms, 'production', 'reverse')

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 pt-2 pb-2 space-y-1 sm:px-4 sm:pt-3 sm:pb-3 sm:space-y-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center justify-between gap-x-2 gap-y-1.5 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <button type="button" onClick={() => navigate('/wms/production')} className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors" title="Về danh sách mẻ">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span data-stage={stageOf(g?.stage)} className={`font-semibold font-mono text-xs sm:text-sm leading-tight break-all whitespace-normal sm:truncate min-w-0 ${stageText(g?.stage)}`}>{b.batch_code}</span>
              <StageBadge stage={g?.stage} title={stageOf(g?.stage) === 'rejected' && b.qa_note ? `QA loại: ${b.qa_note}` : undefined} />
              <button type="button" onClick={() => isBatchPinned(b.id) ? unpinBatch(b.id) : pinBatch({ id: b.id, code: b.batch_code, stage: g?.stage ?? '' })}
                className={`p-1 rounded transition-colors shrink-0 ${isBatchPinned(b.id) ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
                title={isBatchPinned(b.id) ? 'Bỏ đánh dấu đang làm' : 'Đánh dấu đang làm mẻ này — hiện thành tab để chuyển nhanh giữa các mẻ'}
                aria-label={isBatchPinned(b.id) ? 'Bỏ đánh dấu đang làm' : 'Đánh dấu đang làm'} aria-pressed={isBatchPinned(b.id)}>
                <Bookmark className="h-3.5 w-3.5" fill={isBatchPinned(b.id) ? 'currentColor' : 'none'} />
              </button>
            </div>
            <ActionCluster mobileInline items={actions} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:gap-x-4 text-xs text-slate-600">
            <span><span className="text-slate-400 text-[10px]">Bán thành phẩm:</span> <span className="font-mono font-semibold">{b.material?.material_code}</span> {b.material?.short_name ?? ''}</span>
            {b.recipe && <span><span className="text-slate-400 text-[10px]">Công thức:</span> <span className="font-semibold">{b.recipe.name}</span></span>}
            <span><span className="text-slate-400 text-[10px]">Ngày SX:</span> {formatDate(b.prod_date)}</span>
            <span><span className="text-slate-400 text-[10px]">Kho:</span> {b.warehouse?.name ?? '—'}</span>
            <span><span className="text-slate-400 text-[10px]">Chu kỳ · Mẻ:</span> <span className="font-mono font-semibold">{b.cycle ?? '—'} · {no4}</span></span>
            <span><span className="text-slate-400 text-[10px]">Bồn:</span> {canEditTank
              ? <button type="button" className="font-mono font-semibold text-blue-700 underline decoration-dotted underline-offset-2" title="Đổi bồn (mã lô đổi theo)" onClick={() => setEditOpen(true)}>{b.tank?.code ?? 'chọn bồn'}</button>
              : <span className="font-mono font-semibold">{b.tank?.code ?? '—'}</span>}</span>
            {(b.machine_code || b.shift) && <span><span className="text-slate-400 text-[10px]">Máy · Ca:</span> {[b.machine_code, b.shift].filter(Boolean).join(' · ')}</span>}
            {b.material?.tank_hold_hours && <span><span className="text-slate-400 text-[10px]">Hạn lưu bồn:</span> {b.material.tank_hold_hours} giờ</span>}
            <span className="hidden sm:inline"><span className="text-slate-400 text-[10px]">Mở:</span> {b.opened_by_name ?? '—'} · {formatDateTime(b.created_at)}</span>
            {b.lead_ok_at && <span className="hidden sm:inline"><span className="text-slate-400 text-[10px]">Trưởng ca duyệt:</span> {b.lead_ok_by_name ?? '—'} · {formatDateTime(b.lead_ok_at)}</span>}
            {b.qa_ok_at && <span className="hidden sm:inline"><span className="text-slate-400 text-[10px]">QA duyệt:</span> {b.qa_ok_by_name ?? '—'} · {formatDateTime(b.qa_ok_at)}</span>}
            {b.qa_at && <span className="hidden sm:inline"><span className="text-slate-400 text-[10px]">QA bồn:</span> {b.qa_by_name ?? '—'} · {formatDateTime(b.qa_at)}{b.qa_note ? ` · ${b.qa_note}` : ''}</span>}
            {b.note && <span className="hidden sm:inline text-slate-500">{b.note}</span>}
          </div>
          {strict && b.status !== 'CANCELLED' && <FlowStrip steps={steps} />}
          {strict && open && !hasFill && !g?.can_consume && <p className="text-[11px] text-amber-700">Phiếu chưa đủ hai bước duyệt (trưởng ca → QA) — chưa cấp nguyên liệu được.</p>}
          {open && hasFill && (P('consume') || P('reverse')) && <p className="text-[11px] text-slate-500" data-testid="nvl-locked">Mẻ đã nạp BTP vào bồn — sổ nguyên liệu đã khoá: không cấp thêm, không huỷ dòng cấp.</p>}
          {open && b.label_ver > 0 && !b.label_at && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800 flex items-center gap-1.5 flex-wrap">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>Mã lô đã đổi — tem pallet in trước đó mất hiệu lực.</span>
              {P('print_label') && <button type="button" className="underline font-semibold" onClick={() => setLabelOpen(true)}>In lại tem</button>}
            </div>
          )}
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{err}</div>}
          {b.qa_status === 'REJECTED' && inTank > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700 flex items-center gap-1.5 flex-wrap">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Lô bị QA loại còn <b className="tabular-nums">{nfQty(inTank)} {u}</b> trong bồn — bồn đó không rút cho đóng gói được cho tới khi xả bỏ.</span>
              {canSeeTanks && <button type="button" className="underline font-semibold" onClick={() => navigate('/wms/production/tanks')}>Mở màn Bồn</button>}
            </div>
          )}
        </div>
        {pinnedBatches.length > 0 && (
          <PinnedTabsBar>
            {pinnedBatches.map(pb => (
              <PinnedTab key={pb.id} label={pb.code} dot={batchTabDot(pb.stage)} mark={stageTabMark(pb.stage)} current={pb.id === b.id}
                title={`${pb.code} · ${BATCH_STAGE[stageOf(pb.stage)].label}`}
                onClick={() => { if (pb.id !== b.id) navigate(`/wms/production/${pb.id}`) }} onClose={() => unpinBatch(pb.id)} />
            ))}
          </PinnedTabsBar>
        )}
        <SummaryBand tiles={[
          { label: 'NVL đã đủ', value: reqRows.length ? `${reqDone}/${reqRows.length}` : '—', accent: reqRows.length > 0 && reqDone < reqRows.length,
            tip: reqRows.length ? 'Số nguyên liệu đã cấp đủ (trong mức lệch cho phép) / tổng số nguyên liệu trên phiếu của mẻ' : 'Mẻ chưa có phiếu nguyên liệu (mã bán thành phẩm chưa có công thức)' },
          ...(offTol ? [{ label: 'Lệch mức', value: offTol.toLocaleString('vi-VN'), accent: true, tip: 'Số nguyên liệu cấp ngoài mức lệch cho phép (tô đỏ — vẫn cho cấp)' }] : []),
          { label: 'Lần cấp', value: live.length.toLocaleString('vi-VN'), tip: `${rmMats} mã nguyên liệu đã cấp vào mẻ (không tính dòng đã huỷ)` },
          { label: `Kế hoạch (${u})`, value: b.planned_qty != null ? nfQty(b.planned_qty) : '—' },
          { label: `Đã nạp (${u})`, value: nfQty(filled) },
          { label: `Còn bồn (${u})`, value: nfQty(inTank) },
          { label: `Đã đóng gói (${u})`, value: nfQty(drawn), tip: 'Phần của mẻ đã rút khỏi bồn cho các trang Sổ đóng gói (bồn nhiều mẻ ⇒ chia theo tỷ lệ)' },
        ]} mobilePairs />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <div className={`px-3 sm:px-4 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5 ${consByMat.size ? 'py-1' : 'py-1.5 sm:py-2'}`}>
            <span className="h-3.5 w-1 rounded-full bg-sky-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Nguyên liệu của mẻ</h2>
            {/* như "Xem pallet" của Xuất kho: mở / thu MỌI dòng đã cấp — nút ở ngay thanh của khối, không nằm trong ⋮ (user 18/11) */}
            {consByMat.size > 0 && (
              <button type="button" onClick={() => setOpenMats(anyOpen ? new Set() : new Set(consByMat.keys()))} aria-expanded={anyOpen} data-testid="expand-all"
                title={anyOpen ? 'Thu gọn danh sách tem / lô đã cấp' : 'Mở danh sách tem / lô đã cấp của mọi nguyên liệu'}
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${anyOpen ? 'rotate-180' : ''}`} />{anyOpen ? 'Thu gọn' : `Xem tem đã cấp · ${temTotal}`}
              </button>
            )}
          </div>
          <ExpiryApprovalsBlock b={b} canDecide={open && !hasFill && can(perms, 'production', 'approve_expired')} />
          {/* ĐIỆN THOẠI: bảng thu nhỏ — nhãn cột in một lần, mỗi dòng mã · tên · ĐVT rồi chỉ CON SỐ (user 17/11 "hạn chế văn viết");
              nút Cấp thấy ngay, không phải cuộn ngang. Trạng thái bằng màu số: thiếu cam · đủ ✓ xanh · ngoài mức lệch đỏ. */}
          <div className="sm:hidden">
            {!board.length && <p className="px-3 py-3 text-xs text-slate-400">{open ? <>Mẻ chưa có phiếu nguyên liệu — mã {b.material?.material_code} chưa có công thức. Bấm ⋮ → "Sửa định mức" để thêm, hoặc "Quét cấp NVL" để cấp luôn.</> : 'Mẻ không có nguyên liệu nào.'}</p>}
            {board.length > 0 && <MobileNumHead cols={MOBILE_BOARD_COLS} template={MOBILE_BOARD_TPL} asideClass={canConsume ? 'w-16' : undefined} />}
            <div className="divide-y divide-slate-100">
              {board.map(r => {
                const st = stOf(r)
                const outside = st.state === 'extra' || st.state === 'removed'
                const done = st.state === 'ok' || st.state === 'over'
                const noStock = Number(r.available) <= 0
                const short = !outside && !done && st.need > Number(r.available)
                const byScan = Number(r.tem_pallets) > 0
                const dash = <span className="font-normal text-slate-300">—</span>
                const changed = !outside && r.standard != null && Math.abs(Number(r.required) - Number(r.standard)) > 0.0005
                const consRows = consByMat.get(r.material_id) ?? []
                const exp = openMats.has(r.material_id) && consRows.length > 0
                return (
                  <div key={r.material_id} data-board-row={r.material_id}>
                  <MobileNumRow className={`${r.removed ? 'opacity-60' : ''} ${exp ? 'bg-sky-50' : ''}`} template={MOBILE_BOARD_TPL} asideClass={canConsume ? 'w-16' : undefined}
                    head={<>
                      <span className={`font-mono font-semibold shrink-0 ${r.removed ? 'line-through' : ''}`}>{r.material_code}</span>
                      <span className={`truncate text-slate-600 ${r.removed ? 'line-through' : ''}`} title={r.change_reason ?? undefined}>{r.material_name ?? ''}</span>
                      {r.removed && <span className="shrink-0"><StatusBadge tone="slate" title={changeTip(r)}>Đã bỏ{r.replaced_by_code ? ` → ${r.replaced_by_code}` : ''}</StatusBadge></span>}
                      {st.state === 'extra' && <span className="shrink-0"><StatusBadge tone="slate">Ngoài phiếu</StatusBadge></span>}
                      {!outside && r.standard == null && <span className="shrink-0 text-[9px] text-blue-700" title={changeTip(r)}>{r.replaces_code ? `thay ${r.replaces_code}` : 'thêm'}</span>}
                      {consRows.length > 0 && (
                        <button type="button" onClick={() => toggleMat(r.material_id)} aria-expanded={exp} aria-label={`${exp ? 'Thu gọn' : 'Xem'} tem đã cấp ${r.material_code}`}
                          className="shrink-0 inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1 min-h-[1.5rem] text-[10px] text-slate-600">
                          {exp ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{consumedNoun(consRows)}
                        </button>
                      )}
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-400">{matUnitCode(r)}</span>
                    </>}
                    cells={[
                      r.removed ? <s className="font-normal text-slate-400">{r.standard != null ? qtyNum(Number(r.standard), r) : '—'}</s>
                        : st.state === 'extra' ? dash
                        : <>{qtyNum(Number(r.required), r)}{changed && <span className="ml-1 text-[9px] font-normal text-amber-700" title={changeTip(r)}>gốc {qtyNum(Number(r.standard), r)}</span>}</>,
                      Number(r.consumed) > 0 ? <span className={st.outOfTol ? 'text-red-600' : done ? 'text-green-700' : ''}>{qtyNum(Number(r.consumed), r)}</span> : dash,
                      outside ? dash
                        : st.state === 'ok' ? <Check className="inline h-3.5 w-3.5 text-green-600" aria-label="Đủ" />
                        : st.state === 'over' ? <span className="text-red-600" title={r.tol_pct != null ? `Mức lệch cho phép ±${nfq(r.tol_pct)}%` : 'Vượt yêu cầu'}>{r.tol_pct != null ? devLabel(st.devPct) : `+${qtyNum(Number(r.consumed) - Number(r.required), r)}`}</span>
                        : <span className={st.outOfTol ? 'text-red-600' : 'text-amber-700'}>{qtyNum(st.need, r)}</span>,
                      r.removed ? dash : <button type="button" onClick={() => setStockMat(r.material_id)} aria-label={`Xem tồn ${r.material_code} theo %Date`}
                        className={`underline decoration-dotted underline-offset-2 ${short ? 'text-red-600' : 'font-normal text-slate-500'}`} title={short ? 'Tồn ở kho chế biến không đủ phần còn thiếu — bấm xem tồn theo %Date' : 'Xem tồn theo %Date'}>{qtyNum(Math.max(Number(r.available), 0), r)}</button>,
                    ]}
                    aside={canConsume && !r.removed ? (
                      <button type="button" onClick={() => openConsume(r.material_id, noStock)} aria-label={`Cấp ${r.material_code}`}
                        className={`touch-target inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 ${noStock ? 'opacity-60' : ''}`}>
                        {byScan ? <ScanIcon className="h-4 w-4" /> : <Plus className="h-4 w-4" />}Cấp
                      </button>
                    ) : null} />
                  {exp && <div className="ml-4 mr-3 mt-1 mb-2 pl-2.5 border-l-2 border-sky-300" data-board-expand={r.material_id}><ConsumedTems rows={consRows} mat={r} bands={bands} /></div>}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="hidden sm:block">
          <ResizableTable storageKey="production_batch_board_cols_v2" cols={BOARD_COLS}>
            <TableBody>
              {!board.length && (
                <TableEmptyRow colSpan={BOARD_COLS.length}>
                  {open ? <>Mẻ chưa có phiếu nguyên liệu — mã {b.material?.material_code} chưa có công thức. Bấm "Sửa định mức" để thêm nguyên liệu, hoặc "Quét cấp NVL" để cấp luôn.</> : 'Mẻ không có nguyên liệu nào.'}
                </TableEmptyRow>
              )}
              {board.map(r => {
                const st = stOf(r)
                const need = st.need
                const extra = st.state === 'extra' || st.state === 'removed'
                const done = st.state === 'ok' || st.state === 'over'
                const started = Number(r.consumed) > 0
                const noStock = Number(r.available) <= 0
                const byScan = Number(r.tem_pallets) > 0
                const consRows = consByMat.get(r.material_id) ?? []
                const exp = openMats.has(r.material_id) && consRows.length > 0
                return (
                  <Fragment key={r.material_id}>
                  <TableRow data-board-row={r.material_id} className={`${r.removed ? 'text-slate-400' : done ? rowText('full') : started ? rowText('inProgress') : ''} ${exp ? 'bg-sky-50 hover:bg-sky-50' : ''}`}>
                    <TableCell className={`${TD} sticky left-0 z-10 ${exp ? 'bg-sky-50' : 'bg-white'} truncate ${r.removed ? 'line-through' : ''}`} title={[r.material_name, r.note, r.replaces_code ? `thay cho ${r.replaces_code}` : null].filter(Boolean).join(' · ')}>
                      <div className="truncate"><span className="font-mono font-semibold">{r.material_code}</span> {r.material_name ?? ''}</div>
                      {consRows.length > 0 && (
                        <button type="button" onClick={() => toggleMat(r.material_id)} aria-expanded={exp} aria-label={`${exp ? 'Thu gọn' : 'Xem'} tem đã cấp ${r.material_code}`}
                          className="mt-0.5 inline-flex items-center gap-0.5 rounded px-0.5 -ml-0.5 text-[9px] text-slate-500 hover:bg-blue-50 hover:text-blue-700">
                          {exp ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{consumedNoun(consRows)}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className={`${TD} font-mono text-slate-500`}>{matUnitCode(r)}</TableCell>
                    <TableCell className={NUM} title={changeTip(r)}>{r.removed ? reqNote(r) : extra ? <span className="text-slate-300 font-normal">—</span> : <>{qtyNum(Number(r.required), r)}{reqNote(r)}</>}</TableCell>
                    <TableCell className={`${NUM} ${st.outOfTol ? 'text-red-600' : ''}`}>{started ? qtyNum(Number(r.consumed), r) : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                    <TableCell className={`${NUM} ${need > 0 ? 'text-amber-700' : ''}`}>{need > 0 ? qtyNum(need, r) : <span className="text-slate-300 font-normal">—</span>}</TableCell>
                    <TableCell className={`${NUM} ${!done && need > Number(r.available) ? 'text-red-600' : ''}`} title={!done && need > Number(r.available) ? 'Tồn ở kho chế biến không đủ phần còn thiếu — chuyển thêm hàng sang kho chế biến' : undefined}>
                      <button type="button" onClick={() => setStockMat(r.material_id)} aria-label={`Xem tồn ${r.material_code} theo %Date`} title="Xem tồn theo %Date — vị trí, HSD, từng tem"
                        className="inline-flex items-center gap-1 rounded px-1 -mr-1 hover:bg-blue-50 hover:text-blue-700">
                        <Search className="h-3 w-3 text-slate-400" />{qtyNum(Math.max(Number(r.available), 0), r)}
                      </button>
                    </TableCell>
                    <TableCell className={TD}>{noStock ? <span className="text-slate-300">—</span> : byScan ? <StatusBadge tone="sky">Quét tem</StatusBadge> : <StatusBadge tone="purple">Chọn lô</StatusBadge>}</TableCell>
                    <TableCell className={TD}>{statusBadge(r)}</TableCell>
                    <TableCell className={`${TD} sticky right-0 z-10 ${exp ? 'bg-sky-50' : 'bg-white'} text-right`}>
                      {canConsume && !r.removed && (
                        <button type="button" onClick={() => openConsume(r.material_id, noStock)}
                          className={`touch-target inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700 hover:bg-blue-100 ${noStock ? 'opacity-60' : ''}`}
                          title={noStock ? 'Lần tải trước kho chế biến hết mã này — bấm để kiểm lại (hàng vừa chuyển sang vẫn cấp được)' : byScan ? 'Quét tem để cấp nguyên liệu này' : 'Chọn lô để cấp nguyên liệu này (hàng không có tem)'}>
                          {byScan ? <ScanIcon className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}Cấp
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                  {exp && (
                    <TableRow className="hover:bg-transparent" data-board-expand={r.material_id}>
                      <TableCell colSpan={BOARD_COLS.length} className="p-0 border-b border-slate-100">
                        <div className="sticky left-0 w-fit ml-4 my-1 pl-3 pr-3 py-1 border-l-2 border-sky-300"><ConsumedTems rows={consRows} mat={r} bands={bands} /></div>
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                )
              })}
            </TableBody>
          </ResizableTable>
          </div>

          {/* PHIẾU THEO DÕI — thay phiếu giấy; danh sách = mẫu đang dùng (Cài đặt MES) + mẫu đã ngưng mà mẻ này đã có phiếu */}
          <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-100 border-y border-slate-200 flex items-center gap-1.5 mt-3">
            <span className="h-3.5 w-1 rounded-full bg-sky-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Phiếu theo dõi</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
            {!processForms.length && <p className="text-[11px] text-slate-400">Chưa có mẫu phiếu — khai ở Cài đặt MES → Mẫu phiếu theo dõi.</p>}
            {batchForms.map(d => {
              const k = d.code
              const lg = (b.process_logs ?? []).find(l => l.form === k)
              const pr = formProgress(lg?.blocks ?? d.blocks, lg?.data)
              const confirmed = !!lg?.confirmed_at
              const canWriteLog = open && P('process_log') && !confirmed
              const doneActs = pr.actions.filter(f => String(lg?.data?.[f.key] ?? '').trim())
              return (
                <div key={k} data-form={k} data-state={confirmed ? 'confirmed' : pr.state}
                  className={`rounded-lg border px-3 py-2 space-y-1.5 ${confirmed || pr.state === 'done' ? 'border-green-200 bg-green-50/40' : pr.state === 'progress' ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setLogForm(k)} className="text-xs font-semibold text-slate-800 flex-1 min-w-0 truncate text-left hover:underline">{d.title}</button>
                    {confirmed ? <StatusBadge tone="green">QA đã xác nhận</StatusBadge> : pr.state === 'done' ? <StatusBadge tone="green">Đã ghi đủ</StatusBadge>
                      : pr.state === 'progress' ? <StatusBadge tone="amber">Đang ghi</StatusBadge> : <StatusBadge tone="slate">Chưa ghi</StatusBadge>}
                  </div>
                  {doneActs.length > 0 && (
                    <p className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500">
                      {doneActs.slice(-4).map(f => {
                        const st = lg?.stamps?.[f.key]
                        return <span key={f.key} className="inline-flex items-center gap-0.5 max-w-full" title={st ? `${st.by ?? ''}${st.edited_by ? ` · sửa bởi ${st.edited_by}` : ''}` : undefined}>
                          <Check className="h-3 w-3 text-green-600 shrink-0" /><span className="truncate max-w-[9rem]">{f.label}</span> <b className="tabular-nums text-slate-700">{lg?.data?.[f.key]}</b></span>
                      })}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {/* MỘT nút (user 18/11): chưa ghi ⇒ "Bắt đầu" ghi giờ bắt đầu (giờ máy chủ) rồi mở phiếu; đã ghi ⇒ mở phiếu, trong phiếu bấm từng ô */}
                    {!lg && canWriteLog
                      ? <button type="button" disabled={logStart.isPending} onClick={() => void openLog(k, true)} data-start-form={k}
                          title={pr.actions[0] ? `Ghi "${pr.actions[0].label}" = giờ hiện tại rồi mở phiếu` : 'Mở phiếu để ghi'}
                          className="touch-target inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 shrink-0">
                          <Play className="h-3.5 w-3.5" />Bắt đầu
                        </button>
                      : <button type="button" onClick={() => setLogForm(k)} data-open-form={k}
                          className={`touch-target inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs shrink-0 ${canWriteLog ? 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                          <FileText className="h-3.5 w-3.5" />{canWriteLog ? 'Mở phiếu' : 'Xem phiếu'}
                        </button>}
                    {d.optional && !lg && canEditForms && (
                      <button type="button" disabled={setForms.isPending} onClick={() => void dropForm(k, d.short)} title="Bỏ phiếu bổ sung này khỏi mẻ"
                        className="touch-target inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600 shrink-0 disabled:opacity-60">
                        <XCircle className="h-3.5 w-3.5" />Bỏ
                      </button>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-slate-400 tabular-nums">{d.optional ? 'bổ sung · ' : ''}{pr.actions.length ? `${pr.done}/${pr.actions.length} mốc` : ''}{pr.requiredMissing.length ? ` · còn ${pr.requiredMissing.length} ô bắt buộc` : ''}{lg?.blocks ? ' · sửa riêng' : ''}</span>
                  </div>
                </div>
              )
            })}
            {canEditForms && addableForms.map(d => (
              <button key={d.code} type="button" disabled={setForms.isPending} onClick={() => void doForms([...(b.extra_forms ?? []), d.code])} data-add-form={d.code}
                title={`Thêm phiếu bổ sung "${d.title}" cho mẻ này`}
                className="touch-target rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-60">
                <Plus className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Thêm phiếu {d.short}</span>
              </button>
            ))}
          </div>

          <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-100 border-y border-slate-200 flex items-center gap-1.5">
            <span className="h-3.5 w-1 rounded-full bg-sky-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Nhật ký cấp nguyên liệu</h2>
            <span className="text-[11px] text-slate-400">{live.length} dòng{b.consumption.length > live.length ? ` · ${b.consumption.length - live.length} dòng đã huỷ` : ''}</span>
          </div>
          <ResizableTable storageKey="production_batch_rm_cols_v3" cols={RM_COLS}>
            <TableBody>
              {!b.consumption.length && <TableEmptyRow colSpan={RM_COLS.length}>{open ? 'Chưa cấp nguyên liệu nào.' : 'Mẻ không có lần cấp nguyên liệu nào.'}</TableEmptyRow>}
              {b.consumption.map(c => {
                const gone = !!c.reversed_at
                return (
                  <TableRow key={c.id} className={gone ? `${rowText('completed')} opacity-70` : ''} title={gone ? `Huỷ: ${c.reversed_by_name ?? ''} · ${c.reverse_reason ?? ''}` : undefined}>
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white truncate`} title={c.material?.short_name ?? ''}><span className="font-mono font-semibold">{c.material?.material_code}</span> {c.material?.short_name ?? ''}</TableCell>
                    <TableCell className={NUM}>{qtyNum(Number(c.qty), c.material)}</TableCell>
                    <TableCell className={`${TD} font-mono text-slate-500`}>{matUnitCode(c.material)}</TableCell>
                    <TableCell className={`${TD} font-mono truncate`} title={c.pallet_code}>{c.pallet_code}</TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{c.production_date ? formatDate(c.production_date) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`${TD} font-mono`}>{c.batch_lot ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={TD}>{gone ? <StatusBadge tone="slate">Đã huỷ</StatusBadge> : <StatusBadge tone={c.source === 'SCAN' ? 'sky' : 'purple'}>{c.source === 'SCAN' ? 'Quét tem' : 'Theo lô'}</StatusBadge>}
                      {/* lấy khác thứ tự luân chuyển (17/11) — như cột "Thứ tự lấy" của Lịch sử quét xuất */}
                      {!gone && c.expiry_approval_id && <span className="ml-1"><StatusBadge tone="red" title="Nguyên liệu quá HSD — QA đã duyệt cho dùng vào mẻ này (xem mục NVL hết hạn)">Hết hạn · QA duyệt</StatusBadge></span>}
                      {!gone && c.rotation_violation && <span className="ml-1"><StatusBadge tone="amber" title={`Còn ${c.rotation_principle ?? ''} ${c.rotation_best_date ? formatDate(c.rotation_best_date) : ''} phải dùng trước${c.rotation_override_reason ? ` · lý do: ${rotationReasonLabel(c.rotation_override_reason)}` : ''}`}>Sai thứ tự</StatusBadge></span>}
                    </TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{formatDateTime(c.created_at)}</TableCell>
                    <TableCell className={`${TD} truncate`}>{c.created_by_name ?? '—'}</TableCell>
                    <TableCell className={`${TD} sticky right-0 z-10 bg-white text-right`}>
                      {canReverse && !gone && (
                        <button type="button" onClick={e => { e.stopPropagation(); void doReverse(c.id, `${c.pallet_code} (${qtyCode(Number(c.qty), c.material)})`) }}
                          className="touch-target px-1.5 py-1 rounded text-slate-500 hover:text-red-600 hover:bg-red-50" title="Huỷ dòng rút ghi nhầm (hoàn tồn)">
                          <Undo2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>

          <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-100 border-y border-slate-200 flex items-center gap-1.5 mt-3">
            <span className="h-3.5 w-1 rounded-full bg-sky-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Ra bồn</h2>
            <span className="text-[11px] text-slate-400">{b.lots.length} lần vào bồn</span>
          </div>
          <ResizableTable storageKey="production_batch_lot_cols_v1" cols={LOT_COLS}>
            <TableBody>
              {!b.lots.length && <TableEmptyRow colSpan={LOT_COLS.length}>Chưa nạp bồn nào.</TableEmptyRow>}
              {b.lots.map(l => {
                const expired = !!l.expires_at && Date.parse(l.expires_at) < Date.now() && l.status === 'ACTIVE'
                return (
                  <TableRow key={l.id} className={l.status === 'EMPTY' ? rowText('full') : ''}>
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono font-semibold`}>{l.tank?.code ?? '—'}</TableCell>
                    <TableCell className={NUM}>{nfQty(l.qty_in)} <span className="text-slate-400 font-normal">{l.tank?.unit}</span></TableCell>
                    <TableCell className={NUM}>{nfQty(l.qty_remaining)} <span className="text-slate-400 font-normal">{l.tank?.unit}</span></TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{formatDateTime(l.filled_at)}</TableCell>
                    <TableCell className={`${TD} tabular-nums ${expired ? 'text-red-600 font-semibold' : ''}`}>{l.expires_at ? formatDateTime(l.expires_at) : <span className="text-slate-300">không giới hạn</span>}</TableCell>
                    <TableCell className={TD}>{l.status === 'ACTIVE' ? (expired ? <StatusBadge tone="red">Quá hạn lưu</StatusBadge> : <StatusBadge tone="green">Trong bồn</StatusBadge>) : <StatusBadge tone="slate">Đã hết</StatusBadge>}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>

          <div className="mt-3">
            <CollapseSection title={`Sổ nạp / rút của mẻ (${b.movements.length})`}>
              <ResizableTable storageKey="production_batch_move_cols_v1" cols={MOVE_COLS}>
                <TableBody>
                  {!b.movements.length && <TableEmptyRow colSpan={MOVE_COLS.length}>Chưa có thao tác bồn nào.</TableEmptyRow>}
                  {b.movements.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className={`${TD} sticky left-0 z-10 bg-white tabular-nums`}>{formatDateTime(m.created_at)}</TableCell>
                      <TableCell className={TD}>{TANK_MOVE_VI[m.kind]}</TableCell>
                      <TableCell className={`${TD} font-mono`}>{m.tank?.code ?? '—'}</TableCell>
                      <TableCell className={NUM}>{m.qty > 0 ? '+' : ''}{nfQty(m.qty)}</TableCell>
                      <TableCell className={`${TD} truncate`}>{m.created_by_name ?? '—'}</TableCell>
                      <TableCell className={`${TD} truncate`} title={[m.reason, m.warning].filter(Boolean).join(' · ')}>
                        {m.reason ?? ''}{m.warning && <span className="text-amber-700">{m.reason ? ' · ' : ''}{m.warning}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ResizableTable>
            </CollapseSection>
          </div>
        </div>
      </div>
      {open && <ConsumeSheet open={consumeOpen} onClose={() => setConsumeOpen(false)} batch={b} focusId={focusId} />}
      {stockMat && (() => {
        const r = board.find(x => x.material_id === stockMat)
        return <MesStockDialog batchId={b.id} materialId={stockMat} mat={r ?? null}
          title={`${r?.material_code ?? ''} · ${r?.material_name ?? ''}`} onClose={() => setStockMat(null)} />
      })()}
      {open && <RequirementSheet open={reqOpen} onClose={() => setReqOpen(false)} batch={b} />}
      {logForm && processForms.some(d => d.code === logForm) && <ProcessLogSheet open onClose={() => setLogForm(null)} batch={b} def={processForms.find(d => d.code === logForm)!}
        canWrite={can(perms, 'production', 'process_log')} canConfirm={can(perms, 'production', 'qa_release')} canExport={can(perms, 'production', 'export')} />}
      <BatchFillSheet open={fillOpen} onClose={() => setFillOpen(false)} batchId={b.id} batchCode={b.batch_code} warehouseId={b.warehouse_id} unit={b.material?.base_unit ?? null}
        materialCode={b.material?.material_code ?? null} suggestQty={b.planned_qty != null ? Math.round((Number(b.planned_qty) - filled) * 1000) / 1000 : null}
        fixedTankId={b.tank_id} blockers={g?.fill_blockers ?? []} />
      <BatchLabelSheet open={labelOpen} onClose={() => setLabelOpen(false)} batch={b} />
      <PourSheet open={pourOpen} onClose={() => setPourOpen(false)} warehouseId={b.warehouse_id} preset={{ tankId: b.tank_id, cycle: b.cycle, batchNo: b.batch_no }}
        canScan={P('pour')} canFill={canFill} />
      <BatchFormSheet open={editOpen} onClose={() => setEditOpen(false)} batch={b} />
      <BatchFormSheet open={cloneOpen} onClose={() => setCloneOpen(false)} template={b}
        onSaved={nid => navigate(`/wms/production/${nid}`)} />
      {confirmNode}
    </div>
  )
}

// ── NVL HẾT HẠN của mẻ (user chốt 17/11 "chặn và cho qua khi QA duyệt"): yêu cầu người cấp gửi + quyết định của QA ──
// QA (quyền production.approve_expired) duyệt / từ chối kèm căn cứ ngay tại đây; người cấp thấy kết quả tức thì trong form cấp (realtime).
function ExpiryApprovalsBlock({ b, canDecide }: { b: BatchDetail; canDecide: boolean }) {
  const decide = useExpiryDecide()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const list = [...(b.expiry_approvals ?? [])].sort((x, y) => Number(y.status === 'PENDING') - Number(x.status === 'PENDING'))
  if (!list.length) return null
  const pending = list.filter(a => a.status === 'PENDING').length
  async function go(a: ExpiryApproval, decision: 'APPROVED' | 'REJECTED') {
    setErr('')
    const subject = a.entry_id ? { entry_id: a.entry_id } : { material_id: a.material_id, production_date: a.production_date, batch_lot: a.batch_lot }
    try { await decide.mutateAsync({ batchId: b.id, subject, decision, note: (notes[a.id] ?? '').trim() }) } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <div className="mx-3 my-2 sm:mx-4 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 space-y-1.5 text-xs" data-testid="expiry-approvals">
      <p className="font-semibold text-red-800">NVL hết hạn — QA duyệt cho mẻ này{pending ? <span className="font-normal"> · {pending} chờ duyệt</span> : null}</p>
      {list.map(a => {
        const note = (notes[a.id] ?? '').trim()
        return (
          <div key={a.id} className="rounded bg-white border border-red-100 px-2 py-1.5 space-y-1" data-approval={a.id} data-status={a.status}>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <StatusBadge tone={a.status === 'APPROVED' ? 'green' : a.status === 'PENDING' ? 'amber' : 'red'}>{a.status === 'APPROVED' ? 'Đã duyệt' : a.status === 'PENDING' ? 'Chờ QA' : 'Từ chối'}</StatusBadge>
              <span className="font-mono font-semibold">{a.material?.material_code ?? ''}</span>
              <span className="font-mono break-all">{a.pallet_code ?? `lô ${a.batch_lot ?? '—'}${a.production_date ? ` · NSX ${formatDate(a.production_date)}` : ''}`}</span>
              <span className="text-red-700 whitespace-nowrap">HSD {a.expiry_date ? formatDate(a.expiry_date) : '—'}</span>
            </div>
            <div className="text-[10px] text-slate-500">
              {a.requested_by_name ? `Gửi: ${a.requested_by_name}${a.requested_at ? ` · ${formatDateTime(a.requested_at)}` : ''}` : ''}
              {a.decided_by_name ? ` · QA: ${a.decided_by_name}${a.note ? ` — ${a.note}` : ''}` : ''}
            </div>
            {canDecide && a.status === 'PENDING' && (
              <div className="flex flex-wrap gap-1.5">
                <Input className="h-8 text-xs flex-1 min-w-[10rem] bg-white" maxLength={500} placeholder="Căn cứ duyệt / lý do từ chối" value={notes[a.id] ?? ''}
                  onChange={e => setNotes(n => ({ ...n, [a.id]: e.target.value }))} data-testid="expiry-decide-note" />
                <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700" disabled={!note || decide.isPending} onClick={() => void go(a, 'APPROVED')}>Duyệt cho dùng</Button>
                <Button size="sm" variant="outline" className="h-8 border-red-300 text-red-700" disabled={!note || decide.isPending} onClick={() => void go(a, 'REJECTED')}>Từ chối</Button>
              </div>
            )}
          </div>
        )
      })}
      {err && <div className="rounded bg-red-100 border border-red-200 px-2 py-1 text-red-700">{err}</div>}
    </div>
  )
}
