// BẢNG XEM ĐƠN của Điều vận (27/09 tối, user: "đưa về dạng table ở danh mục xem đơn — chỉ đơn chưa điều động mới có mặt
// ở đây; điều vận xác định đơn nào loại khỏi kế hoạch không điều cho hôm đó và các ngày sau, đơn nào loại khỏi kế hoạch của hôm
// đó. Đã điều · Không điều ngày đó · Không điều · Điều nằm ở các tab và chuyển trạng thái được. Kế hoạch chỉ lấy ở mục Điều"
// + "ZSD02 là dữ liệu cập nhật thêm — dữ liệu mới không có trong Đã điều thì mặc định là Điều").
//   • ĐIỀU — OD của đợt ghép: khung chờ + xe nháp. Máy ghép xe CHỈ từ tab này.
//   • KHÔNG ĐIỀU NGÀY NÀY — hoãn có ngày (mặc định ngày kế tiếp): tới ngày đó OD tự quay lại Điều.
//   • KHÔNG ĐIỀU — hoãn không ngày: không vào đợt ghép nào tới khi có người chuyển lại Điều.
//   • ĐÃ ĐIỀU — chỉ xem: xe đã xác nhận / đang chờ ĐVVT · đã có trong Kế hoạch xuất · SAP đã điều · đã xuất kho · nháp ngày khác.
// Dữ liệu là của CHÍNH kế hoạch (dòng OD) + `params.excluded` (OD bị bỏ ra, có kèm thông tin để in dòng). Ba tab DẤU TAY (Không điều
// ngày này · Không điều · Ngoài app) đọc THẲNG sổ dấu của kho qua GET /marks (05/10 — không chép vào kế hoạch nữa: Ngoài app / Không
// điều không bao giờ vào Kế hoạch xuất nên mỗi kế hoạch về sau mang theo mọi đơn từng đánh dấu).
import { useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { CalendarClock, Ban, CheckCircle2, ListChecks, StickyNote, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ListFooter } from '@/components/shared/ListPager'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { FloatingActionBar, FLOATING_BTN } from '@/components/shared/FloatingActionBar'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import { useCustomerChannels, useHoldDispatchOds, useUnholdDispatchOds, useReoptimizeDispatchPlan, useDispatchPlanReview, useDispatchPlanBacklog, useDispatchPlanMarks, useOutsideDispatchOds, useUnoutsideDispatchOds, usePullDispatchOd, useConfirmSupplementDispatchOds, useDispatchDecisions, useRemoveKhvcOd, useTakeDispatchSegment, useHideDispatchOds, SEGMENT_VI, type DispatchSegment, type DispatchPlan, type DispatchOdFlag, type DispatchOtherDraftRef, type DispatchMarkKind, type DispatchReviewInfo } from '@/api/hooks'
import { DispatchDecisionQueue, gdoStage } from './DispatchDecisionQueue'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { whTypeBadgeCls } from '@/utils/cargoCategory'
import { QTY_CONVERTED_LABEL } from '@/utils/qtyUnits'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { EDITABLE, tripStatus, FLAG_VI } from './dispatchIssues'
import { DispatchOdDetailSheet } from './DispatchOdDetailSheet'
import { DispatchLoadBandDialog, useLoadBandParents, fullBands, type LoadBandDraft } from './DispatchLoadBandDialog'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const uniq = <T,>(a: T[]) => [...new Set(a)]
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')
const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }

// 03/10 tối (user: tab "Đã điều" ghi 283 đơn "nằm ở nháp ngày khác" là sai nghĩa; không biết nháp nào, của ai; phải thấy nút xoá):
//   • ELSEWHERE "Đang xếp nơi khác" = đơn đang trên XE của một nháp khác (nháp nào · ai · xe số mấy) — Mở nháp đó / Kéo về đây.
//   • OUTSIDE "Ngoài app" = dấu tay: đơn đã xử lý ngoài bàn (SAP tự gắn xe · điều tay · trước khi dùng app). Cờ SAP post / gắn xe KHÔNG
//     còn tự đưa đơn sang Đã điều — chúng là cờ vàng ở tab Điều, người bấm "Ngoài app" (hàng loạt) nếu đúng là đã đi.
//   • (05/10) KHÔNG có cửa sổ ngày: đơn cũ chưa đi nằm ở Điều kèm "trễ N ngày" — băng "quá N ngày chưa quyết" (03/10) đã bỏ.
//   • ISSUE "Cần xử lý" (03/10 đợt 2) = hàng chờ quyết định theo KHO: đơn ĐÃ VÀO Kế hoạch xuất mà SAP bỏ / thay, họ hàng đã đi, SL đổi
//     sau khi kho quét — bảng riêng (DispatchDecisionQueue), không phải dòng OD của kế hoạch này.
//   • GO nay là HAI tab theo MẢNG (03/10 tối): "Trung chuyển" | "Bán hàng" — mỗi mảng một kế hoạch riêng cùng kho × ngày; tab của mảng
//     kia chỉ chuyển kế hoạch đang xem. Tick đơn → "Lấy sang <mảng kia>" (dấu theo kho × OD, đơn rời bên này, vào khung chờ bên kia).
//   • HIDDEN "Không liên quan" = dấu RIÊNG của người xem trên kế hoạch này: đơn vẫn trong kế hoạch, người khác thấy như thường, máy ghép
//     của người này bỏ qua (Ghép xe gửi ids loại trừ).
type St = 'GO' | 'ELSEWHERE' | 'DAY' | 'NEVER' | 'OUTSIDE' | 'DONE' | 'ISSUE' | 'HIDDEN'
type Tone = 'green' | 'amber' | 'slate' | 'red' | 'blue' | 'purple'
type Row = {
  key: string; od: string; ids: string[]; held: boolean; selectable: boolean
  where: string; tone: Tone; cust: string; ward: string; region: string
  pallets: number | null; tons: number | null; date: string; late: number; note: string; flag: string; until: string | null; reason: string
  fresh?: boolean
  noVeh?: boolean   // khách + kênh chưa khai Dòng xe được vào (28/09) — máy không chọn xe
  outside?: boolean   // mang dấu Ngoài app (tab OUTSIDE) — tick để Điều lại
  ref?: DispatchOtherDraftRef   // ELSEWHERE: nháp đang xếp đơn này
  by?: string; at?: string | null   // tab dấu tay: người đặt / sửa dấu gần nhất · lúc nào (05/10)
}
/** Mốc "ai đưa vào" (05/10, user: "tab Chung phải có dấu vết ai đưa vào") — giờ VN, gọn cho ô hẹp */
const when = (at: string | null | undefined) => (at ? `${formatTimestampDate(at, true)} ${formatTimestampTime(at, false)}` : '')
const KHVC_SRC_VI: Record<string, string> = { DISPATCH: 'xác nhận điều vận', EXCEL: 'upload Kế hoạch xuất', MANUAL: 'nhập / sửa tay' }
const noVehOf = (o: { allowed_models?: string[] | null }) => Array.isArray(o.allowed_models) && !o.allowed_models.length
const EX_VI: Record<string, string> = { IN_PLAN: 'Đã có trong KH xuất', OTHER_DRAFT: 'Đang xếp ở nháp khác', SAP_ASSIGNED: 'SAP đã gắn xe', SHIPPED: 'SAP đã post', REDO_DISPATCHED: 'DO tạo lại – đã điều', NO_MATERIAL: 'Mã chưa khai trong Mã hàng', OUTSIDE_APP: 'Ngoài app' }
/** Cờ SAP chỉ THAM CHIẾU (03/10 tối) — vàng, không đỏ: SAP nói đã post / đã gắn xe, app vẫn điều vì chưa ai đánh dấu Ngoài app */
const SOFT_FLAG = new Set<DispatchOdFlag['kind']>(['SHIPPED', 'SAP_ASSIGNED'])
/** Nhãn OD về ZSD02 SAU khi lập kế hoạch, còn ở khung chờ (user chốt 28/09) — dùng chung bảng Xem đơn + bàn ghép xe. */
export function NewOdChip() {
  return <span className="rounded bg-sky-100 px-1 text-[9px] font-semibold text-sky-800" title="OD mới về ZSD02 sau khi lập kế hoạch — tự vào tab Điều, chưa lên xe">Mới</span>
}
/** Tuổi dữ liệu SAP của OD (03/10 tối): lần ZSD02 cuối chạm OD này quá 1 ngày ⇒ chip, vì "mới nhất" chỉ đúng tại thời điểm nạp. */
function SapAgeChip({ at }: { at: string | null | undefined }) {
  if (!at) return null
  const days = Math.floor((Date.now() - Date.parse(at)) / 86_400_000)
  if (days < 1) return null
  return <span className={`ml-1 rounded px-1 text-[9px] font-medium ${days >= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`} title={`Dữ liệu SAP của OD này nạp lần cuối ${days} ngày trước — đổ ZSD02 phủ ngày tạo của nó để chắc là mới nhất`}>SAP {days}n</span>
}
const TABS: { k: St; seg?: DispatchSegment; label: string; tip: string }[] = [
  { k: 'GO', seg: 'TRANSFER', label: 'Trung chuyển', tip: 'Đơn của khách tick "Trung chuyển" (Khách hàng) + đơn người lấy sang — kế hoạch RIÊNG của mảng Trung chuyển. Máy ghép xe của mảng này chỉ lấy từ đây. Cờ vàng "SAP đã post / đã gắn xe" chỉ là tham chiếu.' },
  { k: 'GO', seg: 'SALES', label: 'Bán hàng', tip: 'Đơn còn lại (NPP, KA, MT… kể cả STO của NPP) — kế hoạch RIÊNG của mảng Bán hàng. Máy ghép xe của mảng này chỉ lấy từ đây. Tick đơn rồi "Lấy sang Trung chuyển" nếu muốn bên kia điều.' },
  { k: 'HIDDEN', label: 'Không liên quan', tip: 'Đơn BẠN đã loại khỏi lần điều này — chỉ bạn thấy ở đây, người khác vẫn thấy ở Điều và vẫn ghép được. Máy ghép của bạn bỏ qua các đơn này. Tick → "Điều lại" để đưa về.' },
  { k: 'ELSEWHERE', label: 'Đang xếp nơi khác', tip: 'Đơn đang nằm TRÊN XE của một bản nháp khác (ghi rõ nháp ngày nào, ai lập, xe số mấy). Mở nháp đó để xử, hoặc Kéo về đây — bên kia tính lại xe.' },
  { k: 'DAY', label: 'Không điều ngày này', tip: 'Loại khỏi kế hoạch của ngày này — tới ngày điều lại, đơn tự quay về Điều.' },
  { k: 'NEVER', label: 'Không điều', tip: 'Không điều cho ngày này và các ngày sau — tới khi có người chuyển lại Điều.' },
  { k: 'OUTSIDE', label: 'Ngoài app', tip: 'Đơn người đã xác nhận là xử lý ngoài bàn này (SAP tự gắn xe · điều tay · trước khi dùng app). Không tính vào "ngày tạo cần phủ" khi nạp ZSD02. Bỏ dấu bằng nút Điều lại.' },
  { k: 'DONE', label: 'Đã điều', tip: 'Đơn đã được lo THEO LỊCH SỬ APP: xe đã xác nhận / chờ ĐVVT, đã có trong Kế hoạch xuất (kèm tiến độ kho), DO tạo lại thay cho OD đã lên xe. Đơn chưa bắt đầu xuất gỡ được khỏi Kế hoạch xuất tại đây (có lý do).' },
  { k: 'ISSUE', label: 'Cần xử lý', tip: 'Việc phải quyết cho đơn ĐÃ VÀO Kế hoạch xuất của kho (mọi ngày) sau khi ZSD02 đổi: SAP bỏ / thay DO · họ hàng của DO đã đi · số lượng đổi sau khi kho quét. Dòng tự hết khi xử xong.' },
]

export function DispatchReviewTable({ plan, editable, flags, onGrouped, canAct = false, hidden = new Set<string>(), otherPlanId = null, otherPoolCount = null, onSwitchSegment }: {
  plan: DispatchPlan; editable: boolean; flags: Map<string, DispatchOdFlag>; onGrouped: () => void
  canAct?: boolean   // dispatch.confirm hoặc external_khvc.delete — gỡ / đổi số DO trên sổ Kế hoạch xuất (03/10 đợt 2)
  hidden?: Set<string>                 // "Không liên quan" của người xem (03/10 tối)
  otherPlanId?: string | null          // kế hoạch của MẢNG KIA cùng kho × ngày (đích của "Lấy sang"); null = bên kia chưa lập
  otherPoolCount?: number | null       // số đơn khung chờ bên kia — in trên tab mảng kia
  onSwitchSegment?: (s: DispatchSegment) => void
}) {
  const f = useWmsFilterStore(s => s.dispatch)
  const setF = useWmsFilterStore(s => s.setDispatch)
  const st: St = (['GO', 'ELSEWHERE', 'DAY', 'NEVER', 'OUTSIDE', 'DONE', 'ISSUE', 'HIDDEN'] as const).find(x => x === f.reviewTab) ?? 'GO'
  const hold = useHoldDispatchOds(), unhold = useUnholdDispatchOds(), reopt = useReoptimizeDispatchPlan()
  const outside = useOutsideDispatchOds(), unoutside = useUnoutsideDispatchOds(), pull = usePullDispatchOd(), sup = useConfirmSupplementDispatchOds()
  const removeKhvc = useRemoveKhvcOd()
  const take = useTakeDispatchSegment(), hide = useHideDispatchOds()
  const seg: DispatchSegment = plan.segment ?? 'SALES', otherSeg: DispatchSegment = seg === 'TRANSFER' ? 'SALES' : 'TRANSFER'
  const decisions = useDispatchDecisions(plan.warehouse_id)   // số trên tab "Cần xử lý" — tập nhỏ, poll 120 s
  const [ask, confirmNode] = useConfirmDialog()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [notesOnly, setNotesOnly] = useState(false)
  // 04/10 (đo dữ liệu thật Ba Vì: 1.162 đơn tồn đọng SAP đã post + 141 SAP đã gắn xe ngay lúc lập): ngày đầu dùng thật phải lọc được
  // đúng các đơn mang cờ SAP để "Chọn N đơn đang hiện" → Ngoài app hàng loạt, không ngồi tick 1.162 dòng
  const [softOnly, setSoftOnly] = useState(false)
  const [dlg, setDlg] = useState<null | 'DAY' | 'NEVER' | 'OUTSIDE'>(null)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  // tiến độ chuyển trạng thái theo lô "300/945" (04/10, giả lập hai ngày: dời 945 đơn chạy 10 lô ~17 s mà chỉ hiện "Đang lưu…")
  const [prog, setProg] = useState<string | null>(null)
  // thông tin SAP từng OD (SO · người tạo · ghi chú · SL quy đổi · Loại kho · OD bị thay · lần Không điều trước) — gọi riêng
  const review = useDispatchPlanReview(plan.id, plan.updated_at)
  // 05/10: ba tab dấu tay đọc thẳng sổ dấu — số đếm luôn hỏi, dòng (kèm thông tin SAP) chỉ khi đang mở tab đó. Dấu tăng theo LỊCH SỬ
  // (giả lập 6 ngày: Ngoài app 2.794 đơn = 3,2 MB, vẽ 20,6 s) ⇒ server trả `limit` dấu gần nhất; tab bị cắt thì ô tìm tra TOÀN BỘ sổ
  const markKind: DispatchMarkKind | null = st === 'DAY' || st === 'NEVER' || st === 'OUTSIDE' ? st : null
  const markCounts = useDispatchPlanMarks(plan.id, null)
  const mc = markCounts.data?.counts ?? null
  const markTotal = markKind && mc ? mc[markKind] : 0
  const marksCut = markTotal > (markCounts.data?.limit ?? Infinity)
  const searchDeb = useDebouncedValue(f.search.trim(), 300)
  const markQ = markKind && marksCut ? searchDeb : ''
  const marks = useDispatchPlanMarks(plan.id, markKind, markQ)
  const info = { ...(review.data?.ods ?? {}), ...(marks.data?.info ?? {}) }
  const whMeta = useWhTypeMetaMap()
  const [detail, setDetail] = useState<string | null>(null)   // key dòng đang mở panel chi tiết
  // `prog` giữ nút khoá cả khoảng hở giữa hai lô (isPending tắt một nhịp giữa hai lần gọi)
  const busy = !!prog || hold.isPending || unhold.isPending || reopt.isPending || outside.isPending || unoutside.isPending || pull.isPending || sup.isPending || take.isPending || hide.isPending
  const err = (e: unknown, title: string) => toast({ variant: 'destructive', title, description: apiMsg(e) })

  const byTab = useMemo(() => {
    const out: Record<St, Row[]> = { GO: [], ELSEWHERE: [], DAY: [], NEVER: [], OUTSIDE: [], DONE: [], ISSUE: [], HIDDEN: [] }
    const agg = new Map<string, Row>()
    const add = (tab0: St, key0: string, r: Omit<Row, 'key'>) => {
      // "Không liên quan" của người xem (03/10 tối): dòng Điều của OD đã đánh dấu sang tab riêng — người khác vẫn thấy nó ở Điều
      const hid = tab0 === 'GO' && hidden.has(r.od)
      const tab: St = hid ? 'HIDDEN' : tab0, key = hid ? `HIDDEN|${r.od}` : key0
      if (hid) r = { ...r, where: `${r.where} · chỉ bạn thấy là đã loại`, tone: 'slate', selectable: editable }
      const cur = agg.get(key)
      if (cur) {   // OD máy tách nhiều phần: một dòng, gộp số + nơi đang ở
        cur.ids.push(...r.ids); cur.pallets = (cur.pallets ?? 0) + (r.pallets ?? 0); cur.tons = (cur.tons ?? 0) + (r.tons ?? 0)
        if (!cur.where.split(' · ').includes(r.where)) cur.where = `${cur.where} · ${r.where}`
        cur.selectable = cur.selectable && r.selectable
        return
      }
      const row = { key, ...r }; agg.set(key, row); out[tab].push(row)
    }
    const flagOf = (od: string) => { const fl = flags.get(od); return fl ? `${FLAG_VI[fl.kind]}${fl.info ? ` — ${fl.info}` : ''}` : '' }
    const trips = plan.trips.filter(t => tripStatus(t) !== 'DISCARDED')
    for (const t of trips) {
      const s = tripStatus(t), draft = EDITABLE.includes(s)
      for (const o of t.ods) add(draft ? 'GO' : 'DONE', `${draft ? 'GO' : 'DONE'}|${o.od_number}`, {
        od: o.od_number, ids: [o.id], held: false, selectable: draft && editable,
        where: draft ? `Xe #${t.seq}` : `Xe #${t.seq} · ${s === 'CONFIRMED' ? 'đã xác nhận' : 'chờ ĐVVT'}`, tone: draft ? 'blue' : 'green',
        cust: o.ship_to_name ?? o.ship_to_code ?? '', ward: o.ward_code ?? '', region: o.region_name ?? o.region_code ?? '',
        pallets: o.pallets == null ? null : Number(o.pallets), tons: o.tons == null ? null : Number(o.tons), date: o.delivery_date ?? '', late: o.late_days ?? 0,
        note: o.note ?? '', flag: flagOf(o.od_number), until: null, reason: '',
      })
    }
    const fresh = new Set(plan.params.fresh_ods ?? [])
    for (const o of plan.pool ?? []) add('GO', `GO|${o.od_number}`, {
      od: o.od_number, ids: [o.id], held: false, selectable: editable, where: 'Khung chờ', tone: 'amber',
      cust: o.ship_to_name ?? o.ship_to_code ?? '', ward: o.ward_code ?? '', region: o.region_name ?? o.region_code ?? '',
      pallets: o.pallets == null ? null : Number(o.pallets), tons: o.tons == null ? null : Number(o.tons), date: o.delivery_date ?? '', late: o.late_days ?? 0,
      note: o.note ?? '', flag: flagOf(o.od_number), until: null, reason: '', fresh: fresh.has(o.od_number), noVeh: noVehOf(o),
    })
    // OD máy không đo được tải / không lên xe (hàng trả về, chiết khấu…) — nằm ở Điều để người thấy, nhưng không chọn được
    for (const u of plan.unplanned) if (!agg.has(`GO|${u.od_number}`)) add('GO', `GO|${u.od_number}`, {
      od: u.od_number, ids: [], held: false, selectable: false, where: 'Không lên xe', tone: 'red', cust: u.ship_to_code ?? '', ward: '', region: '',
      pallets: null, tons: null, date: '', late: 0, note: '', flag: u.reason, until: null, reason: '',
    })
    for (const x of plan.params.excluded ?? []) {
      // 05/10: dấu tay đọc thẳng sổ dấu (vòng `marks` bên dưới) — dòng HELD / OUTSIDE_APP của kế hoạch lập trước đó là bản chụp cũ, bỏ qua
      if (x.kind === 'HELD' || x.kind === 'OUTSIDE_APP') continue
      const d = x.d
      const base = {
        od: x.od_number, ids: [], cust: d?.ship_to_name ?? d?.ship_to_code ?? '', ward: d?.ward_code ?? '', region: d?.region_name ?? d?.region_code ?? '',
        pallets: d?.pallets ?? null, tons: d?.tons ?? null, date: d?.delivery_date ?? '', late: 0, note: d?.note ?? '',
      }
      if (x.kind === 'NO_MATERIAL') {
        // 03/10: mã chưa khai trong Mã hàng ⇒ máy không ghép — nằm ở Điều để người thấy việc phải làm (khai mã), không chọn được
        if (!agg.has(`GO|${x.od_number}`)) add('GO', `GO|${x.od_number}`, { ...base, held: false, selectable: false, where: 'Không lên xe', tone: 'red', flag: x.info ?? EX_VI.NO_MATERIAL, until: null, reason: '' })
      } else if (x.kind === 'OTHER_DRAFT') {
        // 03/10 tối: đang XẾP trên xe nháp khác — tab riêng, ghi nháp nào · ai · xe số mấy; nút Mở nháp / Kéo về đây ở cột Đang ở
        const r = x.ref
        add('ELSEWHERE', `ELSEWHERE|${x.od_number}`, { ...base, held: false, selectable: false, ref: r,
          where: r ? `Nháp ${dmy(r.plan_date)} · xe #${r.seq ?? '?'} · ${r.created_by ?? '?'}` : (x.info ?? EX_VI.OTHER_DRAFT), tone: 'purple', flag: x.info ?? '', until: null, reason: '' })
      } else if (x.kind === 'SHIPPED' || x.kind === 'SAP_ASSIGNED') {
        // bản ghi cũ (params.excluded trước 03/10 tối còn hai loại này) — nay chúng là cờ tham chiếu ở Điều, không phải "đã điều"
        if (!agg.has(`GO|${x.od_number}`)) add('GO', `GO|${x.od_number}`, { ...base, held: false, selectable: false, where: 'Khung chờ (bản cũ)', tone: 'amber', flag: `${EX_VI[x.kind]}${x.info ? ` — ${x.info}` : ''} · Lập lại để nạp đúng`, until: null, reason: '' })
      } else {
        // DO tạo lại thay OD đã lên xe: tô hổ phách — hàng đã đi dưới số OD cũ, người điều cần biết để sửa số DO trên chuyến
        add('DONE', `DONE|${x.od_number}`, { ...base, held: false, selectable: false, where: EX_VI[x.kind] ?? x.kind, tone: x.kind === 'REDO_DISPATCHED' ? 'amber' : 'green', flag: x.info ?? '', until: null, reason: '' })
      }
    }
    // tab dấu tay đang mở: dòng đọc thẳng sổ dấu (Không điều ngày này · Không điều = dấu hoãn; Ngoài app = dấu Ngoài app)
    for (const m of marks.data?.rows ?? []) add(m.kind, `${m.kind}|${m.od_number}`, {
      od: m.od_number, ids: [], cust: m.ship_to_name ?? m.ship_to_code ?? '', ward: m.ward_code ?? '', region: m.region_name ?? m.region_code ?? '',
      pallets: m.pallets == null ? null : Number(m.pallets), tons: m.tons == null ? null : Number(m.tons), date: m.delivery_date ?? '', late: 0, note: m.note ?? '',
      held: m.kind !== 'OUTSIDE', outside: m.kind === 'OUTSIDE', selectable: editable, tone: 'slate', flag: '', until: m.hold_until, reason: m.reason ?? '',
      by: m.marked_by ?? '', at: m.marked_at,
      where: m.kind === 'DAY' ? `Điều lại từ ${dmy(m.hold_until)}` : m.kind === 'NEVER' ? 'Không điều' : 'Ngoài app',
    })
    const cmp =(a: Row, b: Row) => Number(!a.ids.length && !a.held) - Number(!b.ids.length && !b.held) || a.region.localeCompare(b.region) || a.ward.localeCompare(b.ward) || a.cust.localeCompare(b.cust) || a.od.localeCompare(b.od)
    for (const k of Object.keys(out) as St[]) out[k].sort(cmp)
    return out
  }, [plan, flags, editable, hidden, marks.data])

  // TỒN ĐỌNG ĐÃ ĐI (30/09, user: "170 đơn đi đâu mất, sao không nằm trong Đã điều"): máy loại đúng nhưng không nằm trong kế hoạch
  // (ở kho lớn là hơn 2.000 dòng lịch sử) — tab Đã điều tải theo yêu cầu, hiện kèm ngày giao để người thấy nó đi đâu
  const [showBacklog, setShowBacklog] = useState(false)
  const backlog = useDispatchPlanBacklog(plan.id, showBacklog && st === 'DONE')
  const daysLate = (d: string) => Math.max(0, Math.round((Date.parse(`${plan.plan_date}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000))
  const backlogRows = useMemo<Row[]>(() => (showBacklog && st === 'DONE' ? (backlog.data?.excluded ?? []) : []).map(x => ({
    key: `BL|${x.od_number}`, od: x.od_number, ids: [], held: false, selectable: false, where: EX_VI[x.kind] ?? x.kind, tone: 'slate',
    cust: x.d?.ship_to_name ?? x.d?.ship_to_code ?? '', ward: x.d?.ward_code ?? '', region: x.d?.region_name ?? x.d?.region_code ?? '',
    pallets: x.d?.pallets ?? null, tons: x.d?.tons ?? null, date: x.d?.delivery_date ?? '', late: x.d?.delivery_date ? daysLate(x.d.delivery_date) : 0,
    note: x.d?.note ?? '', flag: `Tồn đọng · ${EX_VI[x.kind] ?? x.kind}${x.info ? ` — ${x.info}` : ''}`, until: null, reason: '',
    by: x.by ?? '', at: x.at ?? null,
  })), [showBacklog, st, backlog.data, plan.plan_date]) // eslint-disable-line react-hooks/exhaustive-deps
  // 05/10: KHÔNG còn băng "quá hạn chưa quyết" — bỏ cửa sổ 14 ngày, đơn cũ chưa đi nằm thẳng ở tab Điều kèm "trễ N ngày" (user chốt:
  // trạng thái chỉ là các tab — Đã đi · chưa đi Trung chuyển / Bán hàng · Không liên quan · Không điều…)
  const tabRows = [...byTab[st], ...backlogRows]
  const q = f.search.trim().toLowerCase()
  const extra = (od: string) => { const i = info[od]; return i ? [...i.so, ...i.created_by, i.note_invoice ?? '', i.route_name ?? '', ...i.categories] : [] }
  // Khoảng NGÀY TẠO OD (ZSD02 "Thời gian tạo OD", user 03/10) — lọc tại chỗ trên thông tin SAP đã nạp; chờ nạp xong mới lọc
  // (lọc lúc info còn trống thì cả bảng biến mất một nhịp). OD không có ngày tạo (nhập tay / VL06O) không khớp khoảng.
  const cFrom = f.createdFrom ?? '', cTo = f.createdTo ?? '', sFrom = f.soCreatedFrom ?? '', sTo = f.soCreatedTo ?? ''
  const createdOn = !!(cFrom || cTo || sFrom || sTo) && !!review.data
  const inRange = (d: string | null | undefined, from: string, to: string) => (!from && !to) || (!!d && (!from || d >= from) && (!to || d <= to))
  const inCreated = (od: string) => inRange(info[od]?.od_created_at, cFrom, cTo) && inRange(info[od]?.so_created_at, sFrom, sTo)
  // NGÀY GIAO · KÊNH · VÙNG (04/10, giả lập hai ngày: muốn dời "một nửa" sang ngày sau phải tick tay từng đơn) — lọc tại chỗ, rồi
  // "Chọn N đơn đang hiện". Kênh = kênh khách trong Khách hàng (đọc từ thông tin SAP đã nạp — chưa nạp xong thì chưa lọc theo kênh).
  const dFrom = f.deliveryFrom ?? '', dTo = f.deliveryTo ?? '', fChan = f.channels ?? [], fReg = f.regions ?? []
  const chanList = useCustomerChannels()
  const chanLabel = new Map((chanList.data ?? []).map(c => [c.value, c.label]))
  const NONE = '__none'
  const chanOf = (od: string) => info[od]?.channel || NONE
  // lựa chọn = giá trị có trong tab đang xem + giá trị đang chọn (đổi tab không làm chip mất nhãn)
  const optsOf = (vals: string[], label: (v: string) => string) => uniq(vals).map(v => ({ value: v, label: label(v) })).sort((a, b) => a.label.localeCompare(b.label, 'vi'))
  const chanOpts = optsOf([...tabRows.map(r => chanOf(r.od)), ...fChan], v => (v === NONE ? 'Chưa có kênh' : chanLabel.get(v) ?? v))
  const regOpts = optsOf([...tabRows.map(r => r.region || NONE), ...fReg], v => (v === NONE ? 'Chưa có vùng' : v))
  const chanOn = fChan.length > 0 && !!review.data
  const filterDefs: FilterDef[] = [
    { key: 'delivery', label: 'Ngày giao', type: 'daterange', from: dFrom, to: dTo, onChange: (from, to) => setF({ deliveryFrom: from, deliveryTo: to }) },
    { key: 'channel', label: 'Kênh', type: 'multi', options: chanOpts, selected: fChan, onChange: v => setF({ channels: v }) },
    { key: 'region', label: 'Vùng', type: 'multi', options: regOpts, selected: fReg, onChange: v => setF({ regions: v }) },
    { key: 'created', label: 'Ngày tạo OD', type: 'daterange', from: cFrom, to: cTo, onChange: (from, to) => setF({ createdFrom: from, createdTo: to }) },
    { key: 'soCreated', label: 'Ngày tạo SO', type: 'daterange', from: sFrom, to: sTo, onChange: (from, to) => setF({ soCreatedFrom: from, soCreatedTo: to }) },
  ]
  const filtersOn = !!(dFrom || dTo || fChan.length || fReg.length) || createdOn
  const clearFilters = () => setF({ search: '', createdFrom: '', createdTo: '', soCreatedFrom: '', soCreatedTo: '', deliveryFrom: '', deliveryTo: '', channels: [], regions: [] })
  const isSoft = (od: string) => { const k = flags.get(od)?.kind; return !!k && SOFT_FLAG.has(k) }
  const rows = tabRows.filter(r => (!notesOnly || !!r.note) && (!softOnly || isSoft(r.od)) && (!createdOn || inCreated(r.od))
    && inRange(r.date || null, dFrom, dTo) && (!chanOn || fChan.includes(chanOf(r.od))) && (!fReg.length || fReg.includes(r.region || NONE))
    && (!q || [r.od, r.cust, r.ward, r.region, r.where, r.note, r.flag, r.reason, r.by ?? '', ...extra(r.od)].some(v => v.toLowerCase().includes(q))))
  const detailRow = detail ? tabRows.find(r => r.key === detail) ?? null : null
  const notesN = tabRows.filter(r => !!r.note).length
  const softN = st === 'GO' ? tabRows.filter(r => r.ids.length && isSoft(r.od)).length : 0
  const pick = rows.filter(r => r.selectable)
  const selRows = tabRows.filter(r => sel.has(r.key))
  const setTab = (k: St) => { setSel(new Set()); setNotesOnly(false); setSoftOnly(false); setF({ reviewTab: k }) }
  const toggle = (k: string) => setSel(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  const goOds = byTab.GO.filter(r => r.ids.length)
  const hasTrips = plan.trips.some(t => tripStatus(t) !== 'DISCARDED' && t.ods.length > 0)
  // khung chờ TRỪ đơn người xem đã "Không liên quan" — máy ghép của người này không đụng chúng
  const poolVisible = (plan.pool ?? []).filter(o => !hidden.has(o.od_number))
  const poolIds = poolVisible.map(o => o.id)
  const poolOds = new Set(poolVisible.map(o => o.od_number)).size
  // số OD cờ SAP post trong các dòng đang chọn — gợi ý lý do Ngoài app
  const selPosted = selRows.filter(r => { const fl = flags.get(r.od); return fl && SOFT_FLAG.has(fl.kind) }).length

  // ── chuyển trạng thái ──
  // dòng không có `ids` (đang hoãn · Ngoài app) thao tác theo SỐ OD; dòng trên kế hoạch theo id
  const idsOf = (part: Row[]) => part.filter(x => x.ids.length).flatMap(x => x.ids)
  const odsOf = (part: Row[]) => part.filter(x => !x.ids.length).map(x => x.od)
  const openDlg = (k: 'DAY' | 'NEVER' | 'OUTSIDE') => {
    setUntil(nextDay(plan.plan_date))
    setReason(k === 'OUTSIDE' ? (selPosted && selPosted === selRows.length ? 'SAP đã post Mat Doc — hàng đã đi ngoài app' : selPosted ? 'SAP đã post / điều tay ngoài app' : 'Điều tay ngoài app') : '')
    setDlg(k)
  }
  // cửa ghi nhận ≤ 300 phần tử — "chọn cả tab" vài trăm đơn thì gửi theo lô (tuần tự: mỗi lượt giữ thuê kế hoạch)
  const lots = <T,>(a: T[]) => Array.from({ length: Math.ceil(a.length / 100) }, (_, i) => a.slice(i * 100, i * 100 + 100))
  /** chạy từng lô, cập nhật "đã xong / tổng" sau mỗi lô — tiến độ tự tắt khi xong hoặc lỗi */
  const eachLot = async <T,>(items: T[], fn: (part: T[]) => Promise<void>) => {
    let done = 0
    setProg(`0/${nf(items.length)}`)
    try { for (const part of lots(items)) { await fn(part); done += part.length; setProg(`${nf(done)}/${nf(items.length)}`) } }
    finally { setProg(null) }
  }
  const doHold = async () => {
    const u = dlg === 'DAY' ? until : null
    let n = 0
    try {
      await eachLot(selRows, async part => {
        const r = await hold.mutateAsync({ plan_id: plan.id, ids: idsOf(part), od_numbers: odsOf(part), until: u, reason: reason.trim() || undefined })
        n += r.held.ods
      })
      setDlg(null); setSel(new Set())
      toast({ title: `${n} OD → ${u ? `Không điều ngày này (điều lại từ ${dmy(u)})` : 'Không điều'}`, description: 'Lần nạp OD mới / lập lại không đưa lại các OD này.' })
    } catch (e) { err(e, n ? `Đã chuyển ${n} OD, phần còn lại chưa chuyển được` : 'Không chuyển được trạng thái') }
  }
  const doOutside = async () => {
    if (!reason.trim()) return
    let n = 0
    try {
      await eachLot(selRows, async part => {
        const r = await outside.mutateAsync({ plan_id: plan.id, ids: idsOf(part), od_numbers: odsOf(part), reason: reason.trim() })
        n += r.outside.ods
      })
      setDlg(null); setSel(new Set())
      toast({ title: `${n} OD → Ngoài app`, description: 'Đơn rời tab Điều, không tính vào ngày tạo cần phủ khi nạp ZSD02. Bỏ dấu ở tab Ngoài app → Điều lại.' })
    } catch (e) { err(e, n ? `Đã đánh dấu ${n} OD, phần còn lại chưa được` : 'Không đánh dấu được') }
  }
  // mọi lần chuyển trạng thái đều hỏi lại (user 05/10: "chọn multi sau đó action đổi trạng thái — nhớ có xác nhận"); ba cửa có hộp
  // thoại riêng (Không điều ngày này · Không điều · Ngoài app) thì hộp thoại đó là bước xác nhận
  const doGo = async () => {
    if (await ask({ title: `Điều lại ${nf(selRows.length)} đơn?`, confirmLabel: 'Điều lại',
      body: `Bỏ dấu ${st === 'OUTSIDE' ? 'Ngoài app' : st === 'DAY' ? 'Không điều ngày này' : 'Không điều'} — đơn về khung chờ của tab Điều để ghép xe. Đơn đã được lo ở chỗ khác (nháp khác, Kế hoạch xuất) hoặc SAP đã bỏ thì không quay lại.` }) === null) return
    let n = 0, back = 0
    try {
      await eachLot(selRows, async part => {
        const held = part.filter(x => x.held).map(x => x.od), out = part.filter(x => x.outside).map(x => x.od)
        if (held.length) { const r = await unhold.mutateAsync({ plan_id: plan.id, od_numbers: held }); n += r.unheld.ods; back += r.unheld.back_to_pool }
        if (out.length) { const r = await unoutside.mutateAsync({ plan_id: plan.id, od_numbers: out }); n += r.unoutside.ods; back += r.unoutside.back_to_pool }
      })
      setSel(new Set())
      toast({ title: `${n} OD → Điều`, description: back === n ? 'Đơn đã về khung chờ — máy ghép khi bấm Ghép xe.' : `${n - back} OD không quay lại (đã được lo ở chỗ khác, ngoài cửa sổ ngày, hoặc không còn trong ZSD02).` })
    } catch (e) { err(e, n ? `Đã chuyển ${n} OD, phần còn lại chưa chuyển được` : 'Không chuyển được trạng thái') }
  }
  // "Họ hàng đã đi" (03/10, user chốt (b)): OD cùng dòng SO với OD cũ đã đi — người xác nhận là GIAO THÊM thì rào DB mới cho đi
  const selKin = selRows.filter(r => flags.get(r.od)?.kind === 'KIN_SHIPPED').map(r => r.od)
  const doSupplement = async () => {
    if (await ask({ title: `Xác nhận ${nf(selKin.length)} đơn là đơn bổ sung?`, confirmLabel: 'Xác nhận đơn bổ sung',
      body: 'Các đơn này cùng dòng SO với đơn cũ ĐÃ ĐI. Xác nhận là GIAO THÊM (không phải giao lại hàng đã đi) thì đơn được điều ngày khác; ghi vào phả hệ DO (ai · lúc nào).' }) === null) return
    try {
      const r = await sup.mutateAsync({ plan_id: plan.id, od_numbers: selKin })
      setSel(new Set())
      toast({ title: `${r.supplement.ods} OD xác nhận là đơn bổ sung`, description: 'Ghi vào phả hệ DO (ai · lúc nào). Cờ "Họ hàng đã đi" tắt, xác nhận kế hoạch đi tiếp.' })
    } catch (e) { err(e, 'Không xác nhận được đơn bổ sung') }
  }
  const doPull = async (r: Row) => {
    if (!r.ref) return
    if (await ask({ title: `Kéo OD ${r.od} về kế hoạch này?`, confirmLabel: 'Kéo về đây',
      body: `OD đang trên xe #${r.ref.seq ?? '?'} của nháp ${dmy(r.ref.plan_date)} (${r.ref.created_by ?? '?'} lập). Kéo về: xe bên đó tính lại tải và cước (xe rỗng tự bỏ), OD vào khung chờ ở đây; cả hai kế hoạch ghi vết ai kéo lúc nào.` }) === null) return
    pull.mutateAsync({ plan_id: plan.id, od_number: r.od })
      .then(p => toast({ title: `Đã kéo ${r.od} về khung chờ`, description: `Từ nháp ${dmy(p.pulled.from_plan_date)} của ${p.pulled.from_by ?? '?'}${p.pulled.trips_removed_there ? ` · bên đó bỏ ${p.pulled.trips_removed_there} xe rỗng` : ''}.` }))
      .catch(e => err(e, 'Không kéo được'))
  }
  const openOther = (r: Row) => { if (r.ref) setF({ planDate: r.ref.plan_date, planId: r.ref.plan_id, tab: 'review', reviewTab: 'GO' }) }
  // LẤY ĐƠN SANG MẢNG KIA (03/10 tối): dấu theo kho × OD (thắng ô tick của khách, giữ qua mọi lần nạp); đơn rời khung chờ / xe nháp bên này,
  // vào khung chờ kế hoạch bên kia nếu bên kia đang mở; xe đã chốt bên này ⇒ BE 409 (Mở lại trước)
  const doTake = async () => {
    const ods = uniq(selRows.map(r => r.od))
    if (!ods.length) return
    if (await ask({ title: `Lấy ${ods.length} đơn sang mảng ${SEGMENT_VI[otherSeg]}?`, confirmLabel: `Lấy sang ${SEGMENT_VI[otherSeg]}`,
      body: `Đơn rời kế hoạch ${SEGMENT_VI[seg]} này (xe đang chở tính lại tải, xe rỗng tự bỏ) và ${otherPlanId ? `vào khung chờ kế hoạch ${SEGMENT_VI[otherSeg]} của ngày này` : `chờ bên ${SEGMENT_VI[otherSeg]} lập kế hoạch`}. Dấu giữ cho mọi lần nạp ZSD02 / lập lại — muốn trả về thì bên kia lấy lại.` }) === null) return
    try {
      const r = await take.mutateAsync({ warehouse_id: plan.warehouse_id, od_numbers: ods, segment: otherSeg, plan_id: otherPlanId ?? undefined })
      setSel(new Set())
      toast({ title: `${r.taken} đơn → ${SEGMENT_VI[otherSeg]}`, description: r.added_to_plan ? `Đã vào khung chờ bên ${SEGMENT_VI[otherSeg]}.` : `Bên ${SEGMENT_VI[otherSeg]} chưa lập kế hoạch ngày này — lập là thấy.` })
    } catch (e) { err(e, 'Không lấy sang được') }
  }
  // KHÔNG LIÊN QUAN theo từng người (03/10 tối): dấu riêng, không đổi kế hoạch
  const doHide = async (undo: boolean) => {
    const ods = uniq(selRows.map(r => r.od))
    if (!ods.length) return
    if (await ask(undo
      ? { title: `Điều lại ${nf(ods.length)} đơn?`, confirmLabel: 'Điều lại', body: 'Đơn về tab Điều và lại nằm trong đợt ghép của bạn.' }
      : { title: `Chuyển ${nf(ods.length)} đơn sang Không liên quan?`, confirmLabel: 'Không liên quan', body: 'Chỉ bạn thấy là đã loại — người khác vẫn thấy ở Điều và ghép được; máy ghép của bạn bỏ qua các đơn này.' }) === null) return
    try {
      await hide.mutateAsync({ plan_id: plan.id, od_numbers: ods, undo })
      setSel(new Set())
      toast({ title: undo ? `${ods.length} đơn → Điều` : `${ods.length} đơn → Không liên quan`, description: undo ? 'Đơn lại nằm trong đợt ghép của bạn.' : 'Chỉ bạn thấy là đã loại — người khác vẫn thấy ở Điều; máy ghép của bạn bỏ qua các đơn này.' })
    } catch (e) { err(e, 'Không đánh dấu được') }
  }
  // GỠ CHỦ ĐỘNG bậc "Đã xác nhận" (03/10 đợt 2, thiết kế mục 7): đơn đã vào Kế hoạch xuất mà chuyến CHƯA bắt đầu — gỡ ngay tại tab Đã điều,
  // bắt lý do, ghi nhật ký chuyến; chuyến bên Xuất dựng lại (hết dòng ⇒ ngừng, nhả khung giờ). Đang xuất / đã đi ⇒ BE 409, không có nút.
  const doRemoveKhvc = async (od: string, gc: string) => {
    const why = await ask({ title: `Gỡ DO ${od} khỏi Số xe ${gc}?`, confirmLabel: 'Gỡ khỏi Kế hoạch xuất', danger: true,
      body: 'Dòng rời Kế hoạch xuất; chuyến bên Xuất dựng lại theo phần còn lại (hết dòng thì ngừng hoạt động, khung giờ / cổng nhả). Đơn về tab Điều để ghép lại.',
      input: { label: 'Lý do (ghi vào nhật ký chuyến)', placeholder: 'vd khách hẹn ngày khác · đổi xe · SAP sửa đơn', required: true } })
    if (why === null) return
    try {
      const r = await removeKhvc.mutateAsync({ warehouse_id: plan.warehouse_id, od_number: od, group_code: gc, reason: why })
      toast({ title: `Đã gỡ ${od} khỏi ${gc}`, description: r.replan_error ? `Chuyến bên Xuất chưa dựng lại được: ${r.replan_error}` : 'Đơn về tab Điều (nạp OD mới / lập lại sẽ thấy).' })
    } catch (e) { err(e, 'Không gỡ được') }
  }
  // ── ghép xe từ tab Điều — hộp thoại DẢI % TẢI theo dòng xe cha (01/10) đứng trước lượt ghép ──
  const bandParents = useLoadBandParents(plan.warehouse_id)
  const [bandDlg, setBandDlg] = useState(false)
  const groupAll = !hasTrips
  const groupN = groupAll ? new Set(goOds.map(r => r.od)).size : poolOds
  const doGroup = () => setBandDlg(true)
  // có đơn "Không liên quan" của người này ⇒ KHÔNG gửi review_all (máy sẽ ghép cả chúng) mà gửi đúng danh sách dòng khung chờ còn lại
  const doGroupWith = (d: LoadBandDraft) =>
    reopt.mutateAsync({ id: plan.id, ...(groupAll && !hidden.size ? { review_all: true } : { ids: poolIds }), load_bands: d.bands, load_bypass: d.bypass })
      .then(r => { setBandDlg(false); toast({ title: `Đã ghép thành ${r.reoptimized.trips} xe`, description: r.reoptimized.left_in_pool ? `${r.reoptimized.left_in_pool} OD không xếp được — vẫn ở khung chờ.` : 'Soát thẻ xe ở Bàn ghép xe, rồi Xác nhận kế hoạch.' }); onGrouped() })
      .catch(e => err(e, 'Không ghép được'))

  const selectableTab = editable && st !== 'DONE' && st !== 'ELSEWHERE' && st !== 'ISSUE'
  // tab CHUNG có người đưa đơn vào bằng tay (05/10, user: "phải có dấu vết ai là người đưa vào Chung để nắm được"): Không điều ngày này ·
  // Không điều · Ngoài app (dấu tay) · Đã điều (dòng Kế hoạch xuất). "Đang xếp nơi khác" đã in người lập nháp; Không liên quan là dấu riêng.
  const showBy = st === 'DAY' || st === 'NEVER' || st === 'OUTSIDE' || st === 'DONE'
  const byOf = (r: Row, i: DispatchReviewInfo | undefined): { who: string; at: string | null | undefined; how: string } =>
    st === 'DONE' && !r.by ? { who: i?.khvc?.by ?? '', at: i?.khvc?.at, how: KHVC_SRC_VI[i?.khvc?.source ?? ''] ?? i?.khvc?.source ?? '' }
      : { who: r.by ?? '', at: r.at, how: st === 'DONE' ? 'ghi vào Kế hoạch xuất' : 'đặt / sửa dấu gần nhất' }
  const cols: RtColDef[] = [
    ...(selectableTab ? [{ id: 'sel', label: '', w: 34, align: 'center' as const }] : []),
    { id: 'od', label: 'OD', w: 104 },
    { id: 'where', label: st === 'GO' ? 'Đang ở' : st === 'DONE' ? 'Đã điều ở đâu' : st === 'ELSEWHERE' ? 'Đang xếp ở' : 'Trạng thái', w: st === 'ELSEWHERE' ? 300 : 150 },
    ...(showBy ? [{ id: 'by', label: 'Ai đưa vào', w: 170 }] : []),
    { id: 'so', label: 'SO / PO SAP', w: 110 },
    { id: 'cust', label: 'Khách', w: 220 },
    { id: 'ward', label: 'Phường', w: 140 },
    { id: 'region', label: 'Vùng', w: 110 },
    { id: 'cat', label: 'Loại kho', w: 96 },
    { id: 'conv', label: QTY_CONVERTED_LABEL, w: 84, align: 'right' },
    { id: 'pal', label: 'Pallet', w: 64, align: 'right' },
    { id: 'ton', label: 'Tấn', w: 64, align: 'right' },
    { id: 'date', label: 'Ngày giao', w: 96 },
    { id: 'created', label: 'Ngày tạo OD', w: 90 },
    { id: 'by', label: 'Người tạo', w: 100 },
    { id: 'note', label: 'Ghi chú giao hàng SAP', w: 280 },
    { id: 'warn', label: 'Lưu ý', w: 220 },
    { id: 'info', label: st === 'DAY' || st === 'NEVER' || st === 'OUTSIDE' ? 'Lý do' : 'Tình trạng SAP', w: 220 },
    // 03/10 (user: "sao không có Ngày tạo SO và các dữ liệu khác ở phía sau table"): phần còn lại của ZSD02, thứ tự cột cũ giữ nguyên
    { id: 'so_created', label: 'Ngày tạo SO', w: 90 },
    { id: 'so_type', label: 'Loại SO', w: 120 },
    { id: 'sold_to', label: 'Sold-to', w: 90 },
    { id: 'route', label: 'Tuyến SAP', w: 150 },
    { id: 'cref', label: 'Tham chiếu KH', w: 120 },
    { id: 'district', label: 'Khu vực bán', w: 120 },
    { id: 'dchan', label: 'Kênh PP', w: 110 },
    { id: 'dvvt', label: 'ĐVVT SAP', w: 110 },
    { id: 'driver', label: 'Lái xe SAP', w: 110 },
    { id: 'plate', label: 'Biển số SAP', w: 96 },
    { id: 'sap_pal', label: 'Pallet SAP', w: 80, align: 'right' },
    { id: 'm3', label: 'm³ SAP', w: 72, align: 'right' },
    { id: 'issued', label: 'SL đã xuất', w: 90, align: 'right' },
    { id: 'matdoc', label: 'Mat.doc', w: 110 },
    { id: 'billing', label: 'Hoá đơn', w: 110 },
    { id: 'approval', label: 'Duyệt', w: 100 },
  ]
  const dmyY = (d: string | null | undefined) => (d ? `${dmy(d)}/${d.slice(2, 4)}` : '')
  const dash = <span className="text-slate-300">—</span>
  // Lưu ý = thứ người xếp phải biết mà không nằm ở cột nào: OD này THAY OD cũ (sửa SO — OD cũ có thể đã điều ở xe khác) ·
  // đơn vừa hết "Không điều ngày này" quay lại
  const warnOf = (od: string, noVeh?: boolean) => {
    const i = info[od]
    const veh = noVeh ? ['Khách chưa khai Dòng xe được vào — máy không chọn xe'] : []
    if (!i) return veh.join(' · ')
    return [
      ...veh,
      ...i.replaces.map(r => r.group_code ? `Thay OD ${r.od} — OD cũ ĐÃ ĐIỀU ở xe ${r.group_code}` : `Thay OD ${r.od} (SAP sửa SO)`),
      ...(i.held_before && st === 'GO' ? [`Đã không điều tới ${dmy(i.held_before.until)} — ${i.held_before.reason}`] : []),
      // 05/10: đơn có người "Lấy sang" mảng này (dấu chung theo kho × OD) — ai, lúc nào
      ...(i.taken && st === 'GO' && i.taken.segment === seg ? [`${i.taken.by ?? '?'} lấy sang ${SEGMENT_VI[i.taken.segment]}${i.taken.at ? ` lúc ${when(i.taken.at)}` : ''}`] : []),
    ].join(' · ')
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="shrink-0 border-b bg-white px-3 py-1.5 space-y-1.5">
        {/* SWITCH trạng thái — cả lựa chọn lẫn SỐ của từng tab thấy ngay, không phải bấm thử (khuôn switch 17/09) */}
        {/* điện thoại: dải switch cuộn ngang riêng một hàng, nút Ghép xe xuống hàng dưới rộng hết màn (nút chính phải THẤY NGAY) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap min-w-0 [&>*]:shrink-0">
          {TABS.map(t => {
            const other = !!t.seg && t.seg !== seg
            const active = st === t.k && !other
            const n = t.k === 'ISSUE' ? nf(decisions.data?.count ?? 0) : other ? (otherPoolCount == null ? '—' : nf(otherPoolCount))
              : t.k === 'DAY' || t.k === 'NEVER' || t.k === 'OUTSIDE' ? (mc ? nf(mc[t.k]) : '—')
              : nf(new Set((t.k === 'GO' ? goOds : byTab[t.k]).map(r => r.od)).size)
            return (
            <button key={`${t.k}|${t.seg ?? ''}`} type="button" title={other ? `${t.tip} Bấm để chuyển sang kế hoạch ${t.label} của ngày này.` : t.tip} aria-pressed={active}
              onClick={() => (other ? onSwitchSegment?.(t.seg!) : setTab(t.k))}
              className={`flex items-center gap-1.5 rounded-md px-2.5 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${active ? 'bg-slate-800 text-white' : other ? 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t.label}
              {/* Điều đếm ĐƠN ĐIỀU ĐƯỢC — OD "Không lên xe" (hàng trả về / chiết khấu) vẫn hiện cuối tab nhưng không cộng vào số; tab mảng kia in số khung chờ bên đó */}
              <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${active ? 'bg-white/25 text-white' : t.k === 'ISSUE' && (decisions.data?.count ?? 0) > 0 ? 'bg-red-600 text-white' : 'bg-white text-slate-500'}`}>{n}</span>
            </button>
          ) })}
        </div>
          {editable && goOds.length > 0 && (!hasTrips || poolIds.length > 0) && (
            <Button size="sm" className="sm:ml-auto w-full sm:w-auto shrink-0 h-9 sm:h-7 text-[11px]" disabled={busy} onClick={doGroup}>
              {hasTrips ? <Sparkles className="h-3.5 w-3.5 mr-1" /> : <ListChecks className="h-3.5 w-3.5 mr-1" />}
              {reopt.isPending ? 'Đang ghép…' : hasTrips ? `Ghép ${nf(poolOds)} đơn ở khung chờ` : `Ghép xe ${nf(new Set(goOds.map(r => r.od)).size)} đơn Điều`}
            </Button>
          )}
        </div>
        {st !== 'ISSUE' && <div className="flex items-center gap-1.5 flex-wrap">
          <SearchInput value={f.search} onChange={v => setF({ search: v })} placeholder="Tìm OD, khách, phường, vùng, ghi chú…" className="flex-1 min-w-[160px] sm:max-w-sm" />
          <FilterBar defs={filterDefs} />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          {notesN > 0 && (
            <button type="button" onClick={() => setNotesOnly(v => !v)} aria-pressed={notesOnly}
              className={`inline-flex items-center gap-1 rounded-md px-2 h-9 sm:h-7 text-[11px] ${notesOnly ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-900 hover:bg-amber-100'}`}
              title="OD có ghi chú giao hàng từ SAP — đọc trước khi quyết (hẹn ngày khác, không nhận Chủ nhật, ghép xe riêng…)">
              <StickyNote className="h-3.5 w-3.5" /> {notesOnly ? 'Đang xem' : 'Chỉ'} {notesN} OD có ghi chú
            </button>
          )}
          {softN > 0 && (
            <button type="button" onClick={() => setSoftOnly(v => !v)} aria-pressed={softOnly}
              className={`inline-flex items-center gap-1 rounded-md px-2 h-9 sm:h-7 text-[11px] ${softOnly ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-900 hover:bg-amber-100'}`}
              title="Đơn SAP báo ĐÃ POST (Mat Doc) hoặc ĐÃ GẮN XE — chỉ là tham chiếu. Đúng là đã đi thì lọc, bấm 'Chọn N đơn đang hiện' rồi 'Ngoài app' một lần.">
              {softOnly ? 'Đang xem' : 'Chỉ'} {nf(softN)} đơn SAP đã post / gắn xe
            </button>
          )}
          {st === 'DONE' && (
            <button type="button" onClick={() => setShowBacklog(v => !v)} aria-pressed={showBacklog}
              className={`inline-flex items-center gap-1 rounded-md px-2 h-9 sm:h-7 text-[11px] ${showBacklog ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              title="Đơn ngày giao TRƯỚC ngày lập đã có trong Kế hoạch xuất (hoặc DO tạo lại thay cho đơn đã điều) — không nằm trong kế hoạch này, tải khi bấm (1.000 đơn gần nhất)">
              {showBacklog
                ? (backlog.isLoading ? 'Đang tải đơn tồn đọng đã điều…' : `Đang xem ${nf(backlogRows.length)}${(backlog.data?.total ?? 0) > backlogRows.length ? ` / ${nf(backlog.data?.total)}` : ''} đơn tồn đọng đã điều · ẩn`)
                : 'Xem cả đơn tồn đọng đã điều'}
            </button>
          )}
          {/* tab dấu tay dài hơn trần: nói rõ đang xem phần nào — ô tìm lúc này tra TOÀN BỘ sổ dấu trên server */}
          {marksCut && (
            <span className="text-[11px] text-slate-600" role="status"
              title="Dấu tay tích luỹ theo lịch sử — bảng hiện các đơn đánh dấu GẦN NHẤT; gõ số OD, khách, phường, vùng, ghi chú, lý do hoặc người đánh dấu để tìm trong toàn bộ.">
              {markQ
                ? (marks.isFetching ? `Đang tìm trong ${nf(markTotal)} đơn…` : `Tìm trong ${nf(markTotal)} đơn: ${nf(marks.data?.total ?? 0)} khớp${(marks.data?.total ?? 0) > (marks.data?.rows.length ?? 0) ? ` · hiện ${nf(marks.data?.rows.length)} gần nhất` : ''}`)
                : `Đang xem ${nf(marks.data?.rows.length ?? markCounts.data?.limit)} đơn đánh dấu gần nhất / ${nf(markTotal)} — gõ ô tìm để tra toàn bộ`}
            </span>
          )}
          {editable && pick.length > 0 && (
            <button type="button" className="text-[11px] text-sky-700 hover:underline whitespace-nowrap" title="Chỉ tick các đơn ĐANG HIỆN theo tìm kiếm / bộ lọc"
              onClick={() => setSel(pick.every(r => sel.has(r.key)) ? new Set() : new Set(pick.map(r => r.key)))}>
              {pick.every(r => sel.has(r.key)) ? 'Bỏ chọn' : `Chọn ${pick.length} đơn đang hiện`}
            </button>
          )}
        </div>}
      </div>

      {st === 'ISSUE' ? <DispatchDecisionQueue warehouseId={plan.warehouse_id} planId={editable ? plan.id : null} canAct={canAct} canPlan={editable} /> : <>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <ResizableTable key={`${st}|${editable}`} storageKey={`dispatch_review_cols_${st}_v${showBy ? 5 : 4}`} cols={cols}>
          <TableBody>
            {!rows.length && <TableEmptyRow colSpan={cols.length}>{markKind && marks.isError ? <span className="text-red-600">Không tải được danh sách: {apiMsg(marks.error)}</span>
              : markKind && marks.isLoading ? 'Đang tải danh sách…'
              : q || notesOnly || softOnly || filtersOn
              ? <>Không đơn nào khớp bộ lọc. <button type="button" className="underline text-sky-700" onClick={() => { setNotesOnly(false); setSoftOnly(false); clearFilters() }}>Xem cả {nf(markKind ? markTotal : tabRows.length)} đơn</button></>
              : st === 'GO' ? 'Không còn đơn nào để điều cho ngày này.' : st === 'DONE' ? 'Chưa có đơn nào được điều.' : st === 'ELSEWHERE' ? 'Không có đơn nào đang xếp ở nháp khác.' : 'Không có đơn nào ở trạng thái này.'}</TableEmptyRow>}
            {rows.map(r => { const i = info[r.od]; const warn = warnOf(r.od, r.noVeh); const fl = flags.get(r.od); const soft = !!fl && SOFT_FLAG.has(fl.kind); return (
              // bấm dòng = mở CHI TIẾT OD (user 27/09 khuya); chọn để chuyển trạng thái bằng ô tick
              <TableRow key={r.key} className={`cursor-pointer hover:bg-slate-50 ${sel.has(r.key) ? 'bg-sky-50' : ''}`} onClick={() => setDetail(r.key)}>
                {selectableTab && (
                  <TableCell className={`${TD} sticky left-0 z-10 text-center ${sel.has(r.key) ? 'bg-sky-50' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
                    {r.selectable && <input type="checkbox" className="h-3.5 w-3.5 accent-sky-600" checked={sel.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Chọn ${r.od}`} />}
                  </TableCell>
                )}
                <TableCell className={`${TD} font-mono font-semibold ${selectableTab ? '' : `sticky left-0 z-10 ${sel.has(r.key) ? 'bg-sky-50' : 'bg-white'}`}`}>{r.od}{r.fresh && <span className="ml-1"><NewOdChip /></span>}<SapAgeChip at={i?.last_synced_at} /></TableCell>
                <TableCell className={TD} onClick={e => { if (r.ref || (st === 'DONE' && i?.khvc)) e.stopPropagation() }}>
                  <StatusBadge tone={r.tone}>{r.where}</StatusBadge>
                  {/* TIẾN ĐỘ KHO (03/10 đợt 2): đơn đã vào Kế hoạch xuất — chuyến bên Xuất đang ở đâu; chưa bắt đầu thì gỡ được ngay tại đây */}
                  {st === 'DONE' && i?.khvc && (() => { const g = gdoStage(i.khvc.plan_dropped ? 'CANCELLED' : i.khvc.gdo_status); return (
                    <span className="ml-1.5 inline-flex items-center gap-1.5">
                      <StatusBadge tone={g.tone} title={`Số xe ${i.khvc.group_code} · ngày xuất ${i.khvc.export_date ? dmy(i.khvc.export_date) : '—'}`}>{i.khvc.plan_dropped ? 'Chuyến ngừng' : g.label}</StatusBadge>
                      {i.khvc.gdo_id && <a href={`/wms/outbound/${i.khvc.gdo_id}`} className="text-[10px] font-medium text-sky-700 hover:underline">Mở chuyến</a>}
                      {canAct && g.col === 'B' && !i.khvc.plan_dropped && <button type="button" className="text-[10px] font-medium text-red-700 hover:underline" disabled={removeKhvc.isPending} onClick={() => void doRemoveKhvc(r.od, i.khvc!.group_code)}>Gỡ khỏi KH xuất</button>}
                    </span>) })()}
                  {r.ref && (
                    <span className="ml-1.5 inline-flex gap-1.5">
                      <button type="button" className="text-[10px] font-medium text-sky-700 hover:underline" onClick={() => openOther(r)}>Mở nháp đó</button>
                      {editable && <button type="button" className="text-[10px] font-medium text-sky-700 hover:underline" disabled={pull.isPending} onClick={() => void doPull(r)}>Kéo về đây</button>}
                    </span>
                  )}
                </TableCell>
                {showBy && (() => { const b = byOf(r, i); return (
                  <TableCell className={`${TD} truncate`} title={b.who ? `${b.who} · ${when(b.at)}${b.how ? ` — ${b.how}` : ''}` : ''}>
                    {b.who ? <><span className="font-medium text-slate-700">{b.who}</span>{b.at && <span className="ml-1 text-slate-500 tabular-nums">{when(b.at)}</span>}</> : dash}
                  </TableCell>) })()}
                <TableCell className={`${TD} truncate font-mono`} title={i ? [i.so.join(', '), ...i.so_types].filter(Boolean).join(' · ') : ''}>{i?.so.length ? i.so.join(', ') : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate`} title={r.cust}>{r.cust || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate`} title={r.ward}>{r.ward || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate`} title={r.region}>{r.region || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={TD}>{i?.categories.length ? <span className="inline-flex gap-0.5">{i.categories.map(c => <span key={c} className={`rounded px-1 text-[9px] font-semibold ${whTypeBadgeCls(c, whMeta)}`}>{c}</span>)}</span> : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`} title={i ? `${i.lines} dòng · ${i.materials} mã — quy về thùng từng mã rồi cộng` : ''}>{i ? nf(i.qty_conv, 1) : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{nf(r.pallets, 1)}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{nf(r.tons, 2)}</TableCell>
                <TableCell className={TD}>{r.date ? `${dmy(r.date)}/${r.date.slice(2, 4)}` : <span className="text-slate-300">—</span>}{r.late > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800">trễ {r.late}n</span>}</TableCell>
                <TableCell className={TD} title={i?.od_created_at ?? ''}>{i?.od_created_at ? `${dmy(i.od_created_at)}/${i.od_created_at.slice(2, 4)}` : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.created_by.join(', ')}>{i?.created_by.length ? i.created_by.join(', ') : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate ${r.note ? 'text-amber-900' : ''}`} title={[r.note, i?.note_invoice ? `Hoá đơn: ${i.note_invoice}` : ''].filter(Boolean).join('\n')}>
                  {r.note || <span className="text-slate-300">—</span>}{i?.note_invoice && <span className="ml-1 text-slate-500">· HĐ: {i.note_invoice}</span>}
                </TableCell>
                <TableCell className={`${TD} truncate ${r.noVeh || i?.replaces.some(x => x.group_code) ? 'text-red-600 font-medium' : 'text-amber-800'}`} title={warn}>{warn || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate ${r.flag && st === 'GO' ? (soft ? 'text-amber-800' : 'text-red-600') : 'text-slate-500'}`} title={st === 'DAY' || st === 'NEVER' || st === 'OUTSIDE' ? r.reason : r.flag}>
                  {(st === 'DAY' || st === 'NEVER' || st === 'OUTSIDE' ? r.reason : r.flag) || <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell className={TD} title={i?.so_created_at ?? ''}>{i?.so_created_at ? dmyY(i.so_created_at) : dash}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.so_types.join(' · ')}>{i?.so_types.length ? i.so_types.join(' · ') : dash}</TableCell>
                <TableCell className={`${TD} font-mono`}>{i?.sold_to || dash}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.route_name ?? ''}>{i?.route_name || dash}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.customer_ref ?? ''}>{i?.customer_ref || dash}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.sales_district ?? ''}>{i?.sales_district || dash}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.dist_channel ?? ''}>{i?.dist_channel || dash}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.dvvt_raw ?? ''}>{i?.dvvt_raw || dash}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.driver_name ?? ''}>{i?.driver_name || dash}</TableCell>
                <TableCell className={`${TD} font-mono`}>{i?.license_plate || dash}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{i?.sap_pallets != null ? nf(i.sap_pallets, 2) : dash}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{i?.sap_m3 != null ? nf(i.sap_m3, 2) : dash}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`} title="Số lượng đã xuất theo SAP, đơn vị gốc (cộng các dòng của OD)">{i?.qty_issued_base != null ? nf(i.qty_issued_base) : dash}</TableCell>
                <TableCell className={`${TD} font-mono truncate`} title={i?.mat_doc ?? ''}>{i?.mat_doc || dash}</TableCell>
                <TableCell className={`${TD} font-mono truncate`} title={i?.billing_no ?? ''}>{i?.billing_no || dash}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.approval_status ?? ''}>{i?.approval_status || dash}</TableCell>
              </TableRow>
            ) })}
          </TableBody>
        </ResizableTable>
      </div>
      {/* ĐỐI CHIẾU CHỐNG THIẾU (03/10 tối): mọi đơn ZSD02 trong cửa sổ phải đứng ở đúng MỘT tab — tổng in ra để lệch là thấy */}
      <ListFooter page={1} pageSize={Math.max(1, rows.length)} total={rows.length} unit="đơn" onPageSize={() => { }} options={[]}
        right={`Đối chiếu (${SEGMENT_VI[seg]}): Điều ${nf(new Set(goOds.map(r => r.od)).size)}${byTab.HIDDEN.length ? ` · Không liên quan (bạn) ${nf(byTab.HIDDEN.length)}` : ''} · Đang xếp nơi khác ${nf(byTab.ELSEWHERE.length)} · Không điều ${mc ? nf(mc.DAY + mc.NEVER) : '—'} · Ngoài app ${mc ? nf(mc.OUTSIDE) : '—'} · Đã điều ${nf(byTab.DONE.length)}${(decisions.data?.count ?? 0) > 0 ? ` · Cần xử lý ${nf(decisions.data?.count)}` : ''}${st === 'GO' ? ' — kế hoạch ghép xe chỉ lấy đơn ở tab Điều' : st === 'DONE' ? ' — chuyến chưa bắt đầu gỡ được khỏi Kế hoạch xuất tại cột Đã điều ở đâu' : ' — tick đơn rồi chuyển trạng thái ở thanh dưới'}`} />

      <FloatingActionBar count={selRows.length} unit="đơn đã chọn">
        {prog && <span className="self-center whitespace-nowrap text-[11px] tabular-nums text-white/80" role="status">Đang chuyển {prog} đơn…</span>}
        {(st === 'DAY' || st === 'NEVER' || st === 'OUTSIDE') && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={doGo}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />{unhold.isPending || unoutside.isPending ? 'Đang chuyển…' : 'Điều lại'}</Button>}
        {st === 'HIDDEN' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => void doHide(true)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />{hide.isPending ? 'Đang chuyển…' : 'Điều lại'}</Button>}
        {st === 'GO' && selRows.some(r => r.ids.length) && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => void doHide(false)} title="Loại khỏi lần điều này CHỈ với bạn — người khác vẫn thấy và ghép được; máy ghép của bạn bỏ qua"><Ban className="h-3.5 w-3.5 mr-1" />Không liên quan</Button>}
        {st === 'GO' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => void doTake()} title={`Chuyển đơn sang mảng ${SEGMENT_VI[otherSeg]} (dấu theo kho × OD, giữ qua mọi lần nạp ZSD02)`}>{take.isPending ? 'Đang chuyển…' : `Lấy sang ${SEGMENT_VI[otherSeg]}`}</Button>}
        {st === 'GO' && selKin.length > 0 && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={doSupplement} title="OD cùng dòng SO với OD cũ ĐÃ ĐI — xác nhận đây là giao thêm (không phải giao lại hàng đã đi) thì rào mới cho đi ngày khác; ghi vào phả hệ DO"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />{sup.isPending ? 'Đang ghi…' : `Xác nhận đơn bổ sung (${selKin.length})`}</Button>}
        {st !== 'DAY' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => openDlg('DAY')}><CalendarClock className="h-3.5 w-3.5 mr-1" />Không điều ngày này</Button>}
        {st === 'DAY' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => openDlg('DAY')}><CalendarClock className="h-3.5 w-3.5 mr-1" />Đổi ngày điều lại</Button>}
        {st !== 'NEVER' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => openDlg('NEVER')}><Ban className="h-3.5 w-3.5 mr-1" />Không điều</Button>}
        {st !== 'OUTSIDE' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => openDlg('OUTSIDE')} title="Đơn đã xử lý ngoài app (SAP tự gắn xe · điều tay · trước khi dùng app) — rời tab Điều, không tính vào ngày tạo cần phủ"><Ban className="h-3.5 w-3.5 mr-1" />Ngoài app{selPosted ? ` (${selPosted} SAP đã post)` : ''}</Button>}
        <Button size="sm" variant="outline" className={FLOATING_BTN} onClick={() => setSel(new Set())}>Bỏ chọn</Button>
      </FloatingActionBar>
      </>}

      <Dialog open={!!dlg} onOpenChange={o => { if (!o && !prog && !hold.isPending && !outside.isPending) setDlg(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">{dlg === 'DAY' ? 'Không điều ngày này' : dlg === 'OUTSIDE' ? 'Ngoài app' : 'Không điều'} — {selRows.length} đơn</DialogTitle></DialogHeader>
          <div className="space-y-2 text-xs">
            {dlg === 'DAY'
              ? <label className="block">Điều lại từ ngày <input type="date" className="ml-2 h-8 rounded border border-slate-300 px-2" value={until} min={nextDay(plan.plan_date)} onChange={e => setUntil(e.target.value)} /></label>
              : dlg === 'OUTSIDE'
                ? <p className="text-slate-500">Xác nhận đơn đã được xử lý <b>ngoài app</b> (SAP tự gắn xe · điều tay · trước khi dùng app). Đơn rời tab Điều, không tính vào "ngày tạo cần phủ" khi nạp ZSD02. Bỏ dấu ở tab Ngoài app → Điều lại.{selPosted ? ` ${selPosted}/${selRows.length} đơn đang chọn SAP đã post.` : ''}</p>
                : <p className="text-slate-500">Đơn không vào đợt ghép nào — kể cả các ngày sau — tới khi có người chuyển lại <b>Điều</b>.</p>}
            <label className="block">
              <span className="text-slate-600">Lý do{dlg === 'OUTSIDE' ? ' (bắt buộc — ghi vào nhật ký)' : ' (tuỳ chọn)'}</span>
              <textarea className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder={dlg === 'OUTSIDE' ? 'vd SAP đã post Mat Doc · điều tay qua Zalo · hàng đi trước khi dùng app' : 'vd NPP hẹn giao 10/9 · hàng không đi'} />
            </label>
            {selRows.some(r => !r.held && !r.outside && r.where.startsWith('Xe')) && <p className="text-[11px] text-amber-700">Có đơn đang nằm trên xe nháp — đơn rời xe, tải + cước của xe tính lại.</p>}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8" disabled={!!prog || hold.isPending || outside.isPending} onClick={() => setDlg(null)}>Huỷ</Button>
            <Button size="sm" className="h-8" disabled={!!prog || hold.isPending || outside.isPending || (dlg === 'DAY' && !until) || (dlg === 'OUTSIDE' && !reason.trim())} onClick={dlg === 'OUTSIDE' ? doOutside : doHold}>{prog ? `Đang lưu ${prog} đơn…` : hold.isPending || outside.isPending ? 'Đang lưu…' : 'Chuyển'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DispatchLoadBandDialog open={bandDlg} onClose={() => setBandDlg(false)} title={groupAll ? `Ghép xe cho ${nf(groupN)} đơn Điều` : `Ghép ${nf(groupN)} đơn đang ở khung chờ`} confirmLabel="Ghép xe"
        intro={groupAll
          ? `Máy ghép xe cho MỌI đơn ở tab Điều (${nf(groupN)} OD). Đơn không đi: chuyển sang "Không điều ngày này" / "Không điều" TRƯỚC khi bấm — sau khi ghép vẫn chuyển được.`
          : `Máy dựng xe mới cho ${nf(groupN)} OD đang ở khung chờ. Các xe đang có giữ nguyên (tính lại Non tải / vượt theo dải mới).`}
        parents={bandParents} initial={{ bands: fullBands(bandParents, plan.params.load_bands, plan.params.underload_pct), bypass: plan.params.load_bypass === true }} busy={reopt.isPending}
        onConfirm={doGroupWith} />
      <DispatchOdDetailSheet planId={plan.id} info={detailRow ? info[detailRow.od] : undefined} onClose={() => setDetail(null)}
        sum={detailRow ? { od: detailRow.od, where: detailRow.where, tone: detailRow.tone, cust: detailRow.cust, ward: detailRow.ward, region: detailRow.region, date: detailRow.date, late: detailRow.late, flag: detailRow.flag, reason: detailRow.reason } : null} />
      {confirmNode}
    </div>
  )
}
