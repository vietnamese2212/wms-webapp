// TÌNH TRẠNG MẺ (18/11 — user: "xem lại màu sắc của Mẻ thay đổi theo tình trạng — Duyệt 1 một màu, Chờ QA duyệt một màu, QA block
// thì có symbol, đang làm, đã làm xong"). Tình trạng do DB tính — hàm mes_batch_stage (dòng danh sách `stage`, trang mẻ `gate.stage`),
// một luật cho dòng · ô tổng · lọc · trang mẻ; ở đây CHỈ vẽ: nhãn + màu nhãn · màu chữ của dòng / mã lô · chấm tab "Đang làm".
// Thứ tự = thứ tự công việc: chờ duyệt → chờ QA duyệt → đang làm → chờ QA bồn (đã nạp — xong phần sản xuất) → chờ đóng phiếu → QA đạt / QA loại.
// 26/11 (user chốt): phiếu theo dõi MỞ trước khi cấp NVL (giờ bắt đầu), ĐÓNG sau QA bồn ⇒ QA bồn đạt mà phiếu chưa đóng = "Chờ đóng phiếu".
import { ShieldX, ShieldCheck, ShieldQuestion, UserCheck, FileText, FileCheck, Printer, ArrowDownToLine, Container, FlaskConical, Ban, CircleDashed, type LucideIcon } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { rowText, statusText, type RowStatusKey } from '@/lib/rowStatus'

export type BatchStage = 'new' | 'wait_lead' | 'wait_qa' | 'working' | 'filled' | 'closing' | 'released' | 'rejected' | 'cancelled'
export const BATCH_STAGES: BatchStage[] = ['new', 'wait_lead', 'wait_qa', 'working', 'filled', 'closing', 'released', 'rejected', 'cancelled']
export const BATCH_STAGE: Record<BatchStage, { label: string; tone: BadgeTone; row: RowStatusKey; dot: string; tip: string }> = {
  new:       { label: 'Mới mở',       tone: 'slate',  row: 'pending',    dot: 'bg-slate-400',  tip: 'Chưa cấp nguyên liệu' },
  wait_lead: { label: 'Chờ duyệt',    tone: 'slate',  row: 'pending',    dot: 'bg-slate-400',  tip: 'Chờ trưởng ca duyệt phiếu (duyệt 1)' },
  wait_qa:   { label: 'Chờ QA duyệt', tone: 'purple', row: 'review',     dot: 'bg-purple-500', tip: 'Trưởng ca đã duyệt (duyệt 1) — chờ QA duyệt phiếu (duyệt 2)' },
  working:   { label: 'Đang làm',     tone: 'amber',  row: 'inProgress', dot: 'bg-amber-500',  tip: 'Đang làm: mở phiếu → cấp nguyên liệu → in tem pallet → check trước khi đổ bồn → nạp BTP vào bồn (cột Tình trạng ghi bước đang tới)' },
  filled:    { label: 'Chờ QA bồn',   tone: 'blue',   row: 'full',       dot: 'bg-blue-500',   tip: 'Đã nạp BTP vào bồn (xong phần sản xuất) — chờ QA kết luận ở bồn' },
  closing:   { label: 'Chờ đóng phiếu', tone: 'pink', row: 'scanDone',   dot: 'bg-pink-500',   tip: 'QA bồn đạt — chờ đóng phiếu theo dõi (ghi đủ ô bắt buộc, QA đóng phiếu) để xong mẻ' },
  released:  { label: 'QA đạt',       tone: 'green',  row: 'assigned',   dot: 'bg-green-500',  tip: 'Đã nạp bồn, QA bồn đạt, phiếu đã đóng — mẻ xong' },
  rejected:  { label: 'QA loại',      tone: 'red',    row: 'paused',     dot: 'bg-red-500',    tip: 'QA bồn không đạt — bồn chặn đóng gói tới khi xả bỏ' },
  cancelled: { label: 'Đã huỷ',       tone: 'slate',  row: 'cancelled',  dot: 'bg-slate-300',  tip: 'Mẻ đã huỷ' },
}
/** chuỗi từ API / bộ nhớ tab (bản cũ chưa có tình trạng) ⇒ khoá hợp lệ */
export const stageOf = (s: string | null | undefined): BatchStage => (s && s in BATCH_STAGE ? (s as BatchStage) : 'new')

// BƯỚC CỦA MẺ (18/11 d — user: "Tình trạng: thể hiện chính xác đang ở bước nào"): MỘT bộ tên cho dải bước của trang mẻ và cho cột
// Tình trạng của danh sách. Bước đang tới do DB tính (mes_batch_gate.step) — ở đây chỉ có tên.
// 26/11: thứ tự lead → qa → log (MỞ phiếu — ghi giờ bắt đầu, trước khi cấp NVL) → rm → label → pour → fill → tankqa → close (ĐÓNG phiếu)
export type BatchStep = 'lead' | 'qa' | 'log' | 'rm' | 'label' | 'pour' | 'fill' | 'tankqa' | 'close'
export const BATCH_STEP_LABEL: Record<BatchStep, string> = {
  lead: 'Trưởng ca duyệt', qa: 'QA duyệt', log: 'Mở phiếu', rm: 'Cấp nguyên liệu', label: 'In tem pallet',
  pour: 'Check trước khi đổ bồn', fill: 'Nạp BTP vào bồn', tankqa: 'QA bồn', close: 'Đóng phiếu',
}
const stepOf = (s: string | null | undefined): BatchStep | null => (s && s in BATCH_STEP_LABEL ? (s as BatchStep) : null)
/** tên NGẮN của bước — ô nhỏ trên sơ đồ bồn (18/11 f); chữ đầy đủ ở title */
export const BATCH_STEP_SHORT: Record<BatchStep, string> = {
  lead: 'Chờ duyệt', qa: 'Chờ QA duyệt', log: 'Mở phiếu', rm: 'Cấp NVL', label: 'In tem', pour: 'Check đổ bồn', fill: 'Nạp bồn', tankqa: 'QA bồn', close: 'Đóng phiếu',
}
/** nhãn ngắn của tình trạng (mẻ đang làm: bước ngắn) */
export function stageShort(stage: string | null | undefined, step?: string | null): string {
  const k = stageOf(stage), st = stepOf(step)
  return k === 'working' && st ? BATCH_STEP_SHORT[st] : BATCH_STAGE[k].label
}
/** khoá lọc của sơ đồ: mẻ đang làm lọc theo BƯỚC, còn lại theo tình trạng */
export const stageKey = (stage: string | null | undefined, step?: string | null): string => {
  const k = stageOf(stage), st = stepOf(step)
  return k === 'working' && st ? `step:${st}` : k
}
/** khung + nền thẻ mẻ trên sơ đồ bồn — cùng màu tình trạng với danh sách mẻ */
export const STAGE_CHIP: Record<BatchStage, string> = {
  new:       'border-slate-300 bg-white text-slate-700',
  wait_lead: 'border-slate-300 bg-slate-50 text-slate-700',
  wait_qa:   'border-purple-300 bg-purple-50 text-purple-800',
  working:   'border-amber-300 bg-amber-50 text-amber-900',
  filled:    'border-blue-300 bg-blue-50 text-blue-800',
  closing:   'border-pink-300 bg-pink-50 text-pink-800',
  released:  'border-green-300 bg-green-50 text-green-800',
  rejected:  'border-red-300 bg-red-50 text-red-800',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-400',
}
/** màu chất lỏng trong bồn theo tình trạng của mẻ đã nạp (hai sắc xen kẽ cho các lớp) — Chờ QA bồn xanh dương · QA đạt xanh lá · QA loại đỏ */
export const STAGE_LIQUID: Record<'filled' | 'released' | 'rejected', { a: string; b: string }> = {
  filled:   { a: '#3b82f6', b: '#60a5fa' },
  released: { a: '#22c55e', b: '#4ade80' },
  rejected: { a: '#ef4444', b: '#f87171' },
}
/** tình trạng của một lô trong bồn (mẻ đã nạp) — theo QA bồn */
export const lotStage = (qa: string | null | undefined): 'filled' | 'released' | 'rejected' =>
  qa === 'RELEASED' ? 'released' : qa === 'REJECTED' ? 'rejected' : 'filled'
/** Chữ của tình trạng: mẻ đang làm ghi BƯỚC đang tới ("Check trước khi đổ bồn"), còn lại như cũ ("Chờ duyệt" · "Chờ QA bồn"…) */
export function stageLabel(stage: string | null | undefined, step?: string | null): string {
  const k = stageOf(stage), st = stepOf(step)
  return k === 'working' && st ? BATCH_STEP_LABEL[st] : BATCH_STAGE[k].label
}
/** class cho <TableRow> (màu chữ + hover) và cho mã lô ở đầu trang mẻ */
export const stageRowText = (s: string | null | undefined) => rowText(BATCH_STAGE[stageOf(s)].row)
export const stageText = (s: string | null | undefined) => statusText(BATCH_STAGE[stageOf(s)].row)

/** Nhãn tình trạng; QA loại mang khiên đỏ (user: "QA block thì có symbol"). Mẻ đang làm ghi bước đang tới (`step`), màu vẫn của "Đang làm". */
export function StageBadge({ stage, step, title }: { stage: string | null | undefined; step?: string | null; title?: string }) {
  const k = stageOf(stage)
  const s = BATCH_STAGE[k]
  const label = stageLabel(stage, step)
  return (
    <StatusBadge tone={s.tone} title={title ?? (k === 'working' && label !== s.label ? `Đang làm — bước đang tới: ${label}` : s.tip)}>
      {k === 'rejected' && <ShieldX className="inline h-2.5 w-2.5 -mt-px mr-0.5" aria-hidden />}{label}
    </StatusBadge>
  )
}
// KÝ HIỆU TÌNH TRẠNG (18/11 — user: "cho các ký tự Symbol sau Chu kỳ - mẻ (trong cái ô) kết hợp với chuyển màu sắc … Symbol bạn tự
// chọn"): một biểu tượng cho mỗi tình trạng / bước, cùng biểu tượng với NÚT của bước đó ở trang mẻ (Quét cấp NVL · Phiếu theo dõi ·
// In tem · Check trước khi đổ bồn · Nạp BTP vào bồn) để nhìn ký hiệu là biết việc nào; màu theo màu tình trạng. Điện thoại thấy ngay
// ở cột thứ hai, không phải vuốt sang cột Tình trạng.
type SymbolIcon = LucideIcon
const STAGE_SYMBOL: Record<BatchStage, { icon: SymbolIcon; cls: string }> = {
  new:       { icon: CircleDashed,   cls: 'text-slate-400' },
  wait_lead: { icon: UserCheck,      cls: 'text-slate-500' },
  wait_qa:   { icon: ShieldQuestion, cls: 'text-purple-600' },
  working:   { icon: ScanIcon,       cls: 'text-amber-600' },
  filled:    { icon: FlaskConical,   cls: 'text-blue-600' },
  closing:   { icon: FileCheck,      cls: 'text-pink-600' },
  released:  { icon: ShieldCheck,    cls: 'text-green-600' },
  rejected:  { icon: ShieldX,        cls: 'text-red-600' },
  cancelled: { icon: Ban,            cls: 'text-slate-400' },
}
const STEP_SYMBOL: Partial<Record<BatchStep, SymbolIcon>> = {
  rm: ScanIcon, log: FileText, label: Printer, pour: ArrowDownToLine, fill: Container,
}
/** Ký hiệu tình trạng (mẻ đang làm: ký hiệu của BƯỚC đang tới) — rê chuột / đọc màn hình ra chữ đầy đủ */
export function StageSymbol({ stage, step, className = 'h-3.5 w-3.5' }: { stage: string | null | undefined; step?: string | null; className?: string }) {
  const k = stageOf(stage)
  const st = stepOf(step)
  const Icon = (k === 'working' && st ? STEP_SYMBOL[st] : undefined) ?? STAGE_SYMBOL[k].icon
  const label = stageLabel(stage, step)
  return (
    <span className={`inline-flex shrink-0 ${STAGE_SYMBOL[k].cls}`} title={label} aria-label={label} role="img" data-symbol={k === 'working' && st ? st : k}>
      <Icon className={className} />
    </span>
  )
}

/** Chú giải ký hiệu (ⓘ ở tiêu đề cột) — vẽ từ CÙNG bảng ký hiệu, theo thứ tự công việc */
export function StageLegend() {
  const items: { stage: BatchStage; step?: BatchStep }[] = [
    { stage: 'wait_lead' }, { stage: 'wait_qa' },
    { stage: 'working', step: 'log' }, { stage: 'working', step: 'rm' }, { stage: 'working', step: 'label' }, { stage: 'working', step: 'pour' }, { stage: 'working', step: 'fill' },
    { stage: 'filled' }, { stage: 'closing' }, { stage: 'released' }, { stage: 'rejected' }, { stage: 'cancelled' }, { stage: 'new' },
  ]
  return (
    <div className="space-y-1 text-xs" data-testid="stage-legend">
      <p className="font-semibold">Ký hiệu tình trạng</p>
      {items.map(it => (
        <div key={`${it.stage}-${it.step ?? ''}`} className="flex items-center gap-2">
          <StageSymbol stage={it.stage} step={it.step} />
          <span>{stageLabel(it.stage, it.step)}{it.stage === 'new' ? ' (kho không chặn theo bước)' : ''}</span>
        </div>
      ))}
    </div>
  )
}

/** dấu của tab "Đang làm": QA loại = khiên đỏ thay chấm */
export const stageTabMark = (s: string | null | undefined) =>
  stageOf(s) === 'rejected' ? <ShieldX className="h-3 w-3 shrink-0 mr-0.5 text-red-600" aria-label="QA loại" /> : undefined
