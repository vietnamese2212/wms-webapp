// VIỆC CẦN LÀM (Directed Work đợt 1c, user chốt 10/09/2026) — 3 vai nhìn 3 bảng trên CÙNG kế hoạch:
//   Cần hạ    — lái xe nâng HẠ, TOÀN KHO, có thứ tự (xe đứng bãi chỉ chờ hạ được ưu tiên lên đầu)
//   Cần đưa ra— lái xe nâng CHUYỂN, mặc định lọc "của tôi"; thấy VỊ TRÍ HIỆN TẠI của pallet kể cả
//               đang trên kệ (user 10/09: "cần xem được vị trí hiện tại của pallet cần lấy")
//   Sắp quét  — thủ kho, theo chuyến, TỪNG pallet (quét theo tem)
//
// Hai luật hình thức user chốt, đừng đổi khi sửa sau:
//   • "không cần chỉ dẫn bằng văn xuôi, đưa vào TABLE" ⇒ mỗi việc là một DÒNG, không phải câu chữ.
//   • việc xong thì GẠCH NGANG và VẪN Ở LẠI bảng tới khi chuyến kết thúc ("phòng tình huống bị
//     quên") — có chip "Ẩn việc đã xong" cho ai muốn nhìn gọn, mặc định HIỆN.
//
// ĐỢT B (rà theo vai 12/09, plan docs/plans/DIRECTED_WORK_2_ROLE_UX_PLAN.md):
//   • PDA (< sm) = THẺ, không phải bảng: bảng 3 vai rộng 836–874 px trên máy 360 px ⇒ vuốt ngang 2,4
//     màn mới tới nút ✓. Thẻ đầu = "VIỆC KẾ TIẾP" to, nút ✓ cao 44 px ngay trên thẻ. Bảng giữ cho PC.
//   • "Nhận" việc chung (khoá mềm 10') — hai xe hạ cùng ca không cùng chạy tới một ô.
//   • Kho không xe hạ riêng: một nút "Hạ & đưa ra", tab Cần hạ ẩn.
//   • Tab Sắp quét có nút QUÉT ngay tại chỗ (thủ kho không phải sang Xuất kho → chuyến → Quét).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ListChecks, ArrowDownToLine, Truck, Check, Hand, Undo2, Inbox, ChevronRight, Boxes, CalendarClock, ExternalLink, Search } from 'lucide-react'
import { InfoTip } from '@/components/shared/InfoTip'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { SetDateRuleSheet, type DateRuleTarget } from '@/components/wms/SetDateRuleSheet'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { useDirectedBoard, useConfirmTasks, useClaimTasks, useGDO, useWorkInbox, useDirectedSupervision, usePctBands } from '@/api/hooks'
import { GdoScanSheet } from '@/components/wms/GdoScanSheet'
import { FillScanOverlay } from './FillScanOverlay'
import { MaterialStockDialog } from '@/components/wms/MaterialStockDialog'
import { TaskDetailSheet, palletPct, palletDays, rowRule, anchorDirected, tripName } from '@/components/wms/TaskDetailSheet'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampTime } from '@/utils/formatters'
import { pctDateCls, type PctBands } from '@/utils/pctDateBands'
import { qtyLabel } from '@/utils/qtyUnits'
import { unlockAudio } from '@/utils/audio'
import type { DirectedRow, WorkInbox, WorkInboxRow, DirectedSupervision, DirectedTrip } from '@/types'

const nf = (n: number) => n.toLocaleString('vi-VN')

// INBOX (đợt C, 12/09) = HỘP VIỆC theo NGƯỜI, gom mọi nguồn (chuyến · fill · slotting · chuyển kho · date · DO SAP)
// thành 3 vùng: Của tôi · Việc chung của kho · Đang chờ người khác. Ba tab vai còn lại là màn LÀM VIỆC chi tiết.
type Tab = 'INBOX' | 'LOWER' | 'MOVE' | 'SCAN'
type BoardTab = Exclude<Tab, 'INBOX'>
const TABS: { key: Tab; label: string; icon: typeof Truck; hint: string }[] = [
  { key: 'INBOX', label: 'Hộp việc',   icon: Inbox,           hint: 'Việc của tôi · việc chung của kho · đang chờ người khác — từ mọi nguồn' },
  { key: 'LOWER', label: 'Cần hạ',     icon: ArrowDownToLine, hint: 'Xe nâng hạ — toàn kho, làm từ trên xuống' },
  { key: 'MOVE',  label: 'Cần đưa ra', icon: Truck,           hint: 'Xe nâng chuyển — đưa hàng ra cửa / vị trí nhặt lẻ' },
  { key: 'SCAN',  label: 'Sắp quét',   icon: ScanIcon,        hint: 'Thủ kho — từng pallet theo thứ tự quét' },
]

// Cột theo TAB: xe hạ và xe chuyển cần thông tin khác nhau, đừng nhồi một bảng cho cả hai.
//
// Hai cột THÊM 13/09 (user: "nơi user check được các thông tin liên quan tại đó khi làm việc ở đó"):
//   • "Tem pallet" ở bảng XE NÂNG — bảng gom theo VỊ TRÍ nên trước đó chỉ nói "1 pallet mã X", trong
//     khi đo staging 13/09 thì 16/18 việc đang chờ có ô còn NHIỀU pallet cùng mã (nhiều nhất 13) và
//     8/18 ca các pallet đó khác NSX. Kế hoạch ghim đúng pallet theo luật luân chuyển + quy định
//     date, nhưng cái ghim ấy không hiện ra thì người đi lấy đương nhiên lấy pallet mặt ngoài —
//     việc thành SKIPPED 'OTHER_PALLET' và chính chỉ số "% làm đúng kế hoạch" tụt vì màn hình
//     thiếu dữ kiện, không phải vì người làm sai.
//   • "Date" — YÊU CẦU của dòng đơn đặt cạnh %DATE THẬT của pallet. Chốt quy định date xong mà
//     người thực hiện không đọc được thì mức chốt chỉ sống trong DB.
const COLS: Record<Tab, { id: string; label: string; w: number; align?: 'right' }[]> = {
  INBOX: [],
  // Tổng bề rộng giữ ≤ ~1.000 px để ở 1280 px cột thao tác ghim mép phải KHÔNG đè lên cột "Tới"
  // (đo 14/09: act 210 + qty 190 làm "Cửa cont 2" chỉ còn thấy "Cửa c"). Bỏ cột Tem pallet mới có chỗ.
  LOWER: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'trip', label: 'Chuyến · Giao cho', w: 140 },
    { id: 'loc',  label: 'Vị trí',         w: 130 },
    { id: 'lvl',  label: 'Tầng',           w: 48,  align: 'right' },
    // Cột "Tem pallet" BỎ 14/09 (user: "43 pallet chung một date thì pallet nào cũng được") — lệnh chỉ
    // là "lấy N pallet ở ô X"; tem ghim + NSX + %Date từng pallet nằm sau KÍNH LÚP (panel chi tiết).
    { id: 'date', label: 'Date',           w: 100 },
    { id: 'qty',  label: 'Hạ',             w: 170 },
    // Cột "Quãng đường" BỎ 14/09: từ 20260913c bảng không sắp theo nó nữa, con số không còn quyết định
    // gì mà chiếm chỗ của thứ cần đọc; vẫn xem được trong panel chi tiết.
    { id: 'to',   label: 'Đặt xuống',      w: 110 },
    { id: 'act',  label: '',               w: 184 },   // kính lúp + Xong + Nhận
  ],
  MOVE: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'trip', label: 'Chuyến · Giao cho', w: 140 },
    { id: 'cur',  label: 'Vị trí hiện tại', w: 130 },
    { id: 'date', label: 'Date',           w: 100 },
    { id: 'st',   label: 'Trạng thái',     w: 120 },
    { id: 'qty',  label: 'Đưa',            w: 170 },
    { id: 'to',   label: 'Tới',            w: 110 },
    { id: 'act',  label: '',               w: 184 },
  ],
  SCAN: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'cur',  label: 'Vị trí',         w: 130 },
    { id: 'date', label: 'Date',           w: 100 },
    { id: 'st',   label: 'Trạng thái',     w: 120 },
    { id: 'qty',  label: 'Lấy',            w: 170 },
    { id: 'to',   label: 'Tới',            w: 110 },
    { id: 'act',  label: '',               w: 48 },   // chỉ kính lúp
  ],
}

// Việc BỊ BỎ phải nói lý do (12/09): xe hạ đã hạ pallet xuống rồi mà việc lặng lẽ biến mất thì không
// ai biết vì sao hàng mình vừa hạ không còn được nhắc. Dòng này gạch xám, không STT, không nút.
// CHỮ "BỎ" ĐỔI 14/09: trước đó ba việc khác nhau cùng một chữ trên một màn — nút "Bỏ" (xoá dấu ✓) ·
// "Bỏ nhận" (trả việc) · "Đã bỏ" (hệ thống huỷ) — chính user hỏi "bỏ là gỡ ra hay chỉ hoàn tác?".
// Nay: "Bỏ dấu ✓" · "Trả việc" · "Hệ thống đã huỷ".
const SKIP_LABEL: Record<string, string> = {
  OTHER_PALLET: 'hệ thống đã huỷ — thủ kho đã lấy pallet khác',
  PALLET_TAKEN: 'hệ thống đã huỷ — chuyến khác đã lấy pallet này',
  DATE_RULE_CHANGED: 'hệ thống đã huỷ — quy định date đã đổi, đã sắp lại',
  PLAN_CHANGED: 'hệ thống đã huỷ — kế hoạch đổi',
}

/** Trạng thái một dòng — chữ ngắn, đọc lướt được trên PDA. */
function stateOf(r: DirectedRow, tab: BoardTab, me?: string | null): { text: string; cls: string } {
  if (r.skipped) return { text: SKIP_LABEL[r.skip_reason ?? ''] ?? `hệ thống đã huỷ — ${r.skip_reason ?? 'kế hoạch đổi'}`, cls: 'text-slate-400' }
  // Dòng fill đóng bằng QUÉT TEM, không bằng nút ✓ — nói thẳng ra để không ai đứng chờ một nút không có.
  // LỆNH ĐÃ GIAO TÊN = việc RIÊNG nằm trong rổ chung: cửa quét trả 409 NOT_YOUR_TASK cho người khác
  // (chỉ ai có `fill.assign` mới nhận lại được) ⇒ phải nói TRƯỚC, đừng để soi xong tem mới biết.
  if (r.kind === 'FILL') {
    const mine = !!r.fill_assignee_id && !!me && r.fill_assignee_id === me
    const other = !!r.fill_assignee_id && r.fill_assignee_id !== me
    const done = (r.n_done ?? 0) > 0 ? ` · đã quét ${nf(r.n_done ?? 0)}/${nf(r.n_pallets)}` : ''
    // Ô bảng hẹp ⇒ chữ trên dòng phải NGẮN, phần giải thích vào tooltip (cùng luật "băng mang con số,
    // diễn giải vào ⓘ" chốt 16/09) — câu dài ở đây bị cắt giữa chừng, đọc ra nửa nghĩa còn tệ hơn.
    if (other) return { text: `đã giao ${r.fill_assignee_name ?? 'người khác'}${done}`, cls: 'text-amber-700' }
    return {
      text: `${mine ? 'giao cho bạn — ' : ''}hạ xuống kho lẻ, quét tem${done}`,
      cls: mine ? 'text-sky-800 font-medium' : 'text-sky-700',
    }
  }
  if (r.all_scanned) return { text: `✓ quét đủ${r.last_at ? ` ${formatTimestampTime(r.last_at)}` : ''}`, cls: 'text-green-600' }
  // Sắp quét gom theo Ô (14/09): nhóm 3 pallet mới quét 1 thì nói "đã quét 1/3", không phải im
  if (tab === 'SCAN' && (r.n_done ?? 0) > 0) return { text: `đã quét ${nf(r.n_done ?? 0)}/${nf(r.n_pallets)}`, cls: 'text-sky-700' }
  if (r.stage_done) return {
    text: `✓ ${tab === 'LOWER' ? 'đã hạ' : 'đã đưa ra'}${r.last_at ? ` ${formatTimestampTime(r.last_at)}` : ''}${r.done_by_name ? ` · ${r.done_by_name}` : ''}`,
    cls: 'text-green-600',
  }
  // Bảng XE CHUYỂN: hàng còn trên kệ vẫn LÀM ĐƯỢC — một nút ghi cả hai mốc (12/09, user: "Cần hạ
  // không bắt buộc phải thao tác xác nhận đã hạ").
  if (r.combined_lower) return { text: 'còn trên kệ — hạ rồi đưa ra', cls: 'text-slate-600' }
  // Trên bảng của CHÍNH xe hạ thì "chờ xe hạ" là vô nghĩa: đó là việc của họ
  if (tab === 'LOWER') return { text: 'cần hạ xuống', cls: 'text-slate-500' }
  if (r.waiting_lower) return { text: '⏳ chờ xe hạ', cls: 'text-amber-600' }
  if (r.needs_lower) return { text: 'đã hạ — đưa ra được', cls: 'text-slate-500' }
  return { text: 'lấy trực tiếp', cls: 'text-slate-500' }
}

/** Mã hàng trên dòng việc = NÚT tra tồn kho + vị trí (user 12/09: "tương tự như bên Chuẩn bị hàng"). */
type PickedMat = { id: string; code: string; mat: DirectedRow | null }
function StockButtons({ r, onPick, big }: { r: DirectedRow; onPick: (m: PickedMat) => void; big?: boolean }) {
  const list = (r.materials ?? []).filter(m => m?.id)
  if (!list.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle no-underline">
      {list.map(m => (
        <button key={m.id} type="button"
          // Ô nhiều mã: mỗi mã một nút — đơn vị tính (thùng/hộp) của dòng là min() cross-mã nên chỉ
          // tin được khi ô chỉ có MỘT mã; nhiều mã thì để dialog tự đọc đơn vị, đừng in số sai.
          // stopPropagation: dòng/thẻ bao ngoài nay mở panel chi tiết khi bấm.
          onClick={e => { e.stopPropagation(); onPick({ id: m.id, code: m.code ?? '', mat: list.length === 1 ? r : null }) }}
          title={`Xem tồn kho và vị trí của mã ${m.code ?? ''} trong kho này`}
          className={`inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 ${
            big ? 'h-8 px-2 text-xs' : 'h-5 px-1.5 text-[9px]'}`}>
          <Boxes className={big ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
          {list.length > 1 ? (m.code ?? '') : 'Tồn kho'}
        </button>
      ))}
    </span>
  )
}

/**
 * LỆNH LẤY HÀNG = "lấy N pallet ở ô X" (user chốt 14/09: "chỉ cần chỉ định bao nhiêu pallet ở vị trí
 * nào"). Tem pallet ghim KHÔNG hiện trên bảng nữa — trong ô cùng date thì pallet nào cũng được, in tem
 * lên là biến gợi ý thành mệnh lệnh (đo Ba Vì: 14/17 việc có pallet tương đương ngay trong ô). Tem ·
 * NSX · %Date từng pallet nằm sau KÍNH LÚP (panel chi tiết). Riêng ô có NHIỀU NSX của cùng mã thì NSX
 * phải lên bảng vì lúc đó nó là phần của lệnh ("lấy 2 pallet NSX 28-07 ở ô X").
 */
/** Dòng phụ dưới "N pallet": chỉ tiến độ quét (Sắp quét). User 14/09: KHÔNG in "bất kỳ trong M cùng NSX"
 *  — lệnh chỉ cần số pallet + ô + NSX là đủ, cái "pallet nào cũng được" nằm ở luật cửa quét, không cần nói. */
function pickHint(r: DirectedRow, tab: BoardTab): string | null {
  if (tab === 'SCAN' && (r.n_done ?? 0) > 0 && !r.all_scanned) return `đã quét ${nf(r.n_done ?? 0)}`
  return null
}
/** MỘT nguồn cho cả bảng (PC) lẫn thẻ (PDA): NSX gộp · yêu cầu date · số đo date thật. */
function dateBits(r: DirectedRow) {
  const pallets = r.pallets ?? []
  const pcts = pallets.map(palletPct).filter((p): p is number => p != null)
  const dys = pallets.map(palletDays).filter((d): d is number => d != null)
  const nsxDays = [...new Set(pallets.map(p => p.production_date).filter(Boolean) as string[])].sort()
  // THƯỚC ĐO PHẢI KHỚP YÊU CẦU: dòng đòi "còn ≥ 35 ngày" mà màn in "%Date" thì người đọc KHÔNG so
  // được — đó đúng là lý do kiểu MIN_DAYS ra đời (FG02 hạn 45–60 ngày nên 35 ngày ra 77,8 % trên mã
  // này và 58,3 % trên mã kia). In sai thước là mời người ta tự quy đổi trong đầu, tức mời sai.
  const byDays = (r.date_rules ?? []).some(x =>
    x?.kind === 'MIN_DAYS' || (x?.kind === 'SPLIT' && (x.parts ?? []).some(p => p.kind === 'MIN_DAYS')))
  const span = (a: number[], unit: (lo: number, hi: number) => string) =>
    a.length ? unit(Math.min(...a), Math.max(...a)) : null
  return {
    rule: rowRule(r),
    // Màu luôn theo %Date (thang màu chung toàn app), kể cả khi CHỮ in theo ngày
    tone: pcts.length ? Math.min(...pcts) : null,
    measure: byDays
      ? span(dys, (lo, hi) => (lo === hi ? `còn ${nf(lo)} ngày` : `còn ${nf(lo)}–${nf(hi)} ngày`))
      : span(pcts, (lo, hi) => (lo === hi ? `${lo}%` : `${lo}–${hi}%`)),
    // NSX LUÔN lên bảng (user 14/09: "chỉ cần ghi là date nào là được") — đó là phần của lệnh; tem cụ thể thì không.
    nsx: nsxDays.length
      ? `${formatDate(nsxDays[0], 'dd-MM-yy')}${nsxDays.length > 1 ? ` → ${formatDate(nsxDays[nsxDays.length - 1], 'dd-MM-yy')}` : ''}`
      : null,
  }
}

/** YÊU CẦU date của dòng đơn ĐẶT CẠNH %Date thật của pallet — so bằng mắt, không phải nhớ. */
function DateCell({ r, bands, off }: { r: DirectedRow; bands: PctBands; off?: boolean }) {
  // Lệnh fill chỉ định theo DATE của lô (không ghim tem) ⇒ đó chính là yêu cầu của dòng, in thẳng.
  // Không có %Date thật để so vì chưa biết sẽ quét pallet nào — cửa quét mới chốt, và nó tự chặn sai date.
  if (r.kind === 'FILL') return (
    <div className="leading-tight">
      {r.fill_required_date
        ? <div className="text-[10px] font-semibold text-slate-700 no-underline">NSX {formatDate(r.fill_required_date, 'dd-MM-yy')}</div>
        : <div className="text-[9px] text-slate-300 no-underline">mọi date</div>}
      <div className="text-[9px] text-slate-400 no-underline">quét tem sẽ kiểm date</div>
    </div>
  )
  const { rule, measure, tone, nsx } = dateBits(r)
  return (
    <div className="leading-tight space-y-0.5">
      {rule
        ? <div className={`inline-block rounded px-1 text-[9px] font-medium no-underline ${rule.cls}`}>{rule.text}</div>
        : <div className="text-[9px] text-slate-300 no-underline">chưa khai</div>}
      {measure && (
        <div className={`text-[10px] font-bold tabular-nums no-underline ${off ? 'text-slate-400' : pctDateCls(tone, bands)}`}>
          {measure}
        </div>
      )}
      {nsx && <div className={`text-[9px] font-semibold no-underline ${(r.cell_ndates ?? 1) > 1 ? 'text-amber-800' : 'text-slate-600'}`}
        title={(r.cell_ndates ?? 1) > 1 ? 'Ô này có nhiều NSX của cùng mã — lấy đúng NSX này' : undefined}>NSX {nsx}</div>}
    </div>
  )
}

// Mọi nút của một dòng — dùng CHUNG cho bảng (PC) và thẻ (PDA) để hai màn không kể hai câu chuyện khác nhau.
type RowAction = { key: string; label: string; icon: typeof Check; primary?: boolean; muted?: boolean; onClick: () => void }
type ConfirmStage = 'LOWER' | 'MOVE' | 'BOTH'
type Fire = {
  confirm: (r: DirectedRow, stage: ConfirmStage) => void
  undo: (r: DirectedRow, stage: ConfirmStage) => void      // việc nhặt lẻ hỏi thêm một câu (hàng đưa xuống chưa?)
  claim: (r: DirectedRow, undo: boolean) => void
  scanFill: (r: DirectedRow) => void                        // dòng lệnh fill — mở màn quét của ĐÚNG lệnh đó
}
const ACTION_TIP: Record<string, string> = {
  undo: 'Bỏ dấu ✓ vừa bấm (bấm nhầm) — việc quay lại hàng chờ',
  claim: 'Đánh dấu tôi đang làm việc này để người khác khỏi cùng chạy tới (tự nhả sau 10 phút)',
  unclaim: 'Trả việc lại cho người khác',
  done: 'Xác nhận đã làm xong việc này',
}
function actionsFor(r: DirectedRow, tab: BoardTab, me: string | null, canConfirm: boolean, fire: Fire,
  canFill = false): { actions: RowAction[]; heldByOther: string | null } {
  const heldByOther = r.claim_active && r.claimed_by && r.claimed_by !== me ? (r.claimed_by_name ?? 'người khác') : null
  // DÒNG FILL: một nút QUÉT, không có ✓ Xong. Fill chuyển pallet thật + khoá sức chứa ô đích nên phải
  // đi qua cửa quét (RPC nguyên tử) — cho bấm "Xong" ở đây là mở một cửa ghi tồn không ai kiểm.
  if (r.kind === 'FILL') {
    // Giao người khác ⇒ nút MỜ (không khoá — luật 12/09: đừng lấy việc của người này làm điều kiện
    // cho nút của người kia; ai có `fill.assign` vẫn nhận lại được ngay trong màn quét).
    const other = !!r.fill_assignee_id && r.fill_assignee_id !== me
    return {
      actions: canFill ? [{
        key: 'scanfill', label: 'Quét', icon: ScanIcon, primary: true, muted: other,
        onClick: () => fire.scanFill(r),
      }] : [],
      heldByOther: null,
    }
  }
  if (tab === 'SCAN' || !canConfirm || r.skipped || r.all_scanned) return { actions: [], heldByOther }
  if (r.stage_done) {
    const stage = r.combined_lower ? 'BOTH' : tab
    return { actions: [{ key: 'undo', label: 'Bỏ dấu ✓', icon: Undo2, onClick: () => fire.undo(r, stage) }], heldByOther }
  }
  if (!r.can_confirm) return { actions: [], heldByOther }
  const actions: RowAction[] = []
  const mine = r.claim_active && r.claimed_by === me
  // MỘT NHÁT (14/09): "Xong" LUÔN là nút chính — kho một xe nâng thì "Nhận" là nhát bấm vô nghĩa lặp
  // mỗi việc. "Nhận" thành nút phụ, chỉ có ý nghĩa khi nhiều xe cùng ca; bấm Xong khi chưa nhận thì
  // máy chủ vẫn ghi đúng người bấm là người làm. Người khác đang cầm thì Xong vẫn bấm được nhưng mờ đi.
  actions.push({
    key: 'done', label: r.combined_lower ? 'Hạ & đưa ra' : 'Xong', icon: Check,
    primary: true, muted: !!heldByOther,
    onClick: () => fire.confirm(r, r.combined_lower ? 'BOTH' : tab),
  })
  if (!mine && !heldByOther) actions.push({ key: 'claim', label: 'Nhận', icon: Hand, onClick: () => fire.claim(r, false) })
  if (mine) actions.push({ key: 'unclaim', label: 'Trả việc', icon: Undo2, onClick: () => fire.claim(r, true) })
  return { actions, heldByOther }
}

// ─── HỘP VIỆC ─────────────────────────────────────────────────────────────────────────────────
const ZONE_META = {
  MINE:    { title: 'Của tôi',                 hint: 'giao đích danh cho bạn — làm trước',            tone: 'border-sky-300 bg-sky-50/60',     dot: 'bg-sky-500' },
  SHARED:  { title: 'Việc chung của kho',      hint: 'ai có quyền cũng làm được — bấm Nhận để không trùng nhau', tone: 'border-slate-200 bg-white', dot: 'bg-emerald-500' },
  WAITING: { title: 'Đang chờ người khác',     hint: 'chỉ để biết — không cần bạn làm gì lúc này',    tone: 'border-slate-200 bg-slate-50',    dot: 'bg-slate-400' },
} as const

function InboxRowView({ r, showWh }: { r: WorkInboxRow; showWh: boolean }) {
  const body = (
    <>
      <span className="shrink-0 min-w-9 h-9 px-1.5 rounded-lg bg-slate-900 text-white text-sm font-semibold tabular-nums flex items-center justify-center">{nf(r.n)}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-800 truncate">{r.title}</span>
        {r.sub && <span className="block text-[11px] text-slate-500 truncate">{r.sub}</span>}
        {showWh && r.wh_name && <span className="block text-[10px] text-slate-400 truncate">{r.wh_name}</span>}
      </span>
      {r.link && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
    </>
  )
  const cls = 'flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 min-h-12'
  // Link nội bộ trang này (?tab=…) thì không neo; sang trang khác thì neo để thanh "‹ Về Việc cần làm" hiện
  const leaves = !!r.link && !r.link.startsWith('/wms/directed')
  return r.link
    ? <Link to={r.link} onClick={leaves ? anchorDirected : undefined} className={`${cls} hover:border-sky-300 hover:bg-sky-50 active:bg-sky-100`}>{body}</Link>
    : <div className={`${cls} opacity-80`}>{body}</div>
}

function InboxZone({ zone, rows, showWh }: { zone: keyof typeof ZONE_META; rows: WorkInboxRow[]; showWh: boolean }) {
  const m = ZONE_META[zone]
  return (
    <section className={`rounded-xl border p-3 space-y-2 ${m.tone}`}>
      <header className="flex items-baseline gap-2">
        <span className={`h-2 w-2 rounded-full ${m.dot}`} />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{m.title}</h2>
        <span className="text-[11px] text-slate-500">· {m.hint}</span>
        <span className="ml-auto text-[11px] font-semibold tabular-nums text-slate-600">{nf(rows.reduce((s, r) => s + r.n, 0))}</span>
      </header>
      {rows.length === 0
        ? <p className="text-[11px] text-slate-400 px-1">
            {zone === 'MINE' ? 'Không có việc nào giao đích danh cho bạn.' : zone === 'SHARED' ? 'Kho không còn việc chung nào chờ.' : 'Không có gì đang chờ người khác.'}
          </p>
        : <div className="space-y-1.5">{rows.map(r => <InboxRowView key={r.key} r={r} showWh={showWh} />)}</div>}
    </section>
  )
}

/** Góc nhìn giám sát (quyền replan) — ai đang làm gì, chuyến nào chờ hạ lâu, % làm đúng kế hoạch. */
function SupervisionPanel({ s }: { s: DirectedSupervision }) {
  const mins = (m: number | null | undefined) => (m == null ? '—' : `${nf(m)}′`)
  const th = 'text-[9px] font-medium text-slate-500 px-2 py-1 text-left whitespace-nowrap'
  const td = 'px-2 py-1 text-[11px] whitespace-nowrap'
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
      <header className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Giám sát · {s.days} ngày</h2>
        <span className="text-[11px] text-slate-500">· hạ → đưa ra TB {mins(s.lead_time?.lower_to_move_min)} · đưa ra → quét đủ TB {mins(s.lead_time?.move_to_scan_min)} ({nf(s.lead_time?.sample ?? 0)} việc)</span>
      </header>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="overflow-x-auto">
          <div className="text-[10px] font-semibold text-slate-500 mb-1">Chuyến đang chạy — ai đang làm, chờ hạ lâu nhất</div>
          <table className="w-full"><thead><tr><th className={th}>Chuyến</th><th className={th}>Cửa</th><th className={`${th} text-right`}>Còn</th><th className={`${th} text-right`}>Chờ hạ</th><th className={`${th} text-right`}>Lâu nhất</th><th className={th}>Đang cầm</th><th className={th}>Xe chuyển</th></tr></thead>
            <tbody>
              {s.live.length === 0 && <tr><td colSpan={7} className={`${td} text-slate-400`}>Không có chuyến nào đang chạy</td></tr>}
              {s.live.map(l => (
                <tr key={l.gdo_id} className="border-t border-slate-100">
                  <td className={`${td} font-mono font-semibold`}>{tripName(l)}</td>
                  <td className={td}>{l.dock_name ?? '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{nf(l.pending)}</td>
                  <td className={`${td} text-right tabular-nums ${l.waiting_lower > 0 ? 'text-amber-700 font-semibold' : ''}`}>{nf(l.waiting_lower)}</td>
                  <td className={`${td} text-right tabular-nums ${(l.oldest_wait_min ?? 0) >= 30 ? 'text-red-600 font-semibold' : ''}`}>{mins(l.oldest_wait_min)}</td>
                  <td className={td}>{l.claimers ?? <span className="text-slate-300">—</span>}</td>
                  <td className={`${td} text-slate-500`}>{l.drivers ?? '—'}</td>
                </tr>
              ))}
            </tbody></table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="overflow-x-auto">
            <div className="text-[10px] font-semibold text-slate-500 mb-1">Theo người</div>
            <table className="w-full"><thead><tr><th className={th}>Người</th><th className={`${th} text-right`}>Hạ</th><th className={`${th} text-right`}>Đưa ra</th><th className={`${th} text-right`}>Quét</th></tr></thead>
              <tbody>
                {s.by_person.length === 0 && <tr><td colSpan={4} className={`${td} text-slate-400`}>Chưa có ai ghi việc</td></tr>}
                {s.by_person.map(p => (
                  <tr key={p.name} className="border-t border-slate-100"><td className={td}>{p.name}</td><td className={`${td} text-right tabular-nums`}>{nf(p.lowered)}</td><td className={`${td} text-right tabular-nums`}>{nf(p.moved)}</td><td className={`${td} text-right tabular-nums`}>{nf(p.done)}</td></tr>
                ))}
              </tbody></table>
          </div>
          <div className="overflow-x-auto">
            <div className="text-[10px] font-semibold text-slate-500 mb-1">Làm đúng kế hoạch theo ngày <span className="font-normal">(xong ÷ (xong + quét pallet khác))</span></div>
            <table className="w-full"><thead><tr><th className={th}>Ngày</th><th className={`${th} text-right`}>Xong</th><th className={`${th} text-right`}>Lấy khác</th><th className={`${th} text-right`}>% đúng</th></tr></thead>
              <tbody>
                {s.by_day.length === 0 && <tr><td colSpan={4} className={`${td} text-slate-400`}>Chưa có việc xong</td></tr>}
                {s.by_day.map(d => (
                  <tr key={d.day} className="border-t border-slate-100"><td className={td}>{formatDate(d.day)}</td><td className={`${td} text-right tabular-nums`}>{nf(d.done)}</td><td className={`${td} text-right tabular-nums`}>{nf(d.skipped_other)}</td>
                    <td className={`${td} text-right tabular-nums font-semibold ${d.adherence_pct != null && d.adherence_pct < 70 ? 'text-red-600' : d.adherence_pct != null && d.adherence_pct < 90 ? 'text-amber-700' : 'text-green-700'}`}>{d.adherence_pct == null ? '—' : `${nf(d.adherence_pct)} %`}</td></tr>
                ))}
              </tbody></table>
          </div>
        </div>
      </div>
    </section>
  )
}

function InboxPanel({ inbox, loading, showWh, sup }: { inbox: WorkInbox | undefined; loading: boolean; showWh: boolean; sup: DirectedSupervision | undefined }) {
  if (loading && !inbox) return <div className="py-6 text-center text-[11px] text-slate-400">Đang tải hộp việc…</div>
  return (
    <div className="p-2 sm:p-3 space-y-3">
      <InboxZone zone="MINE"    rows={inbox?.mine ?? []}    showWh={showWh} />
      <InboxZone zone="SHARED"  rows={inbox?.shared ?? []}  showWh={showWh} />
      <InboxZone zone="WAITING" rows={inbox?.waiting ?? []} showWh={showWh} />
      {sup && <SupervisionPanel s={sup} />}
    </div>
  )
}

/** Một dòng chỉ dẫn trên thẻ: NHÃN nhỏ bên trái · nội dung to bên phải. */
function Step({ label, children, big }: { label: string; children: React.ReactNode; big?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="w-16 shrink-0 text-[9px] uppercase tracking-wide text-slate-400">{label}</span>
      {/* div chứ không span: nội dung một bước nay có nhiều dòng khối (tem pallet, NSX, tên hàng) */}
      <div className={`min-w-0 break-words ${big ? 'text-base' : 'text-sm'}`}>{children}</div>
    </div>
  )
}

export default function DirectedWork() {
  const f = useWmsFilterStore(s => s.directedWork)
  const setF = useWmsFilterStore(s => s.setDirectedWork)
  const user = useAuthStore(s => s.user)
  const me = user?.id ?? null
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canConfirm = can(perms, 'directed_work', 'confirm')
  const canReplan = can(perms, 'directed_work', 'replan')     // vai giám sát → thấy khối Giám sát trong Hộp việc
  const canScan = can(perms, 'outbound', 'scan')
  // Fill kho lẻ nằm CHUNG bảng từ 16/09 — quét thực hiện vẫn là quyền của module Fill (đo: 18/18 lái
  // xe nâng đã có sẵn cả `directed_work.confirm` lẫn `fill.execute`, không phải cấp thêm cho ai)
  const canFill = can(perms, 'fill', 'execute')
  const canFillAssign = can(perms, 'fill', 'assign')   // màn quét cho "Nhận lệnh này" khi dòng của người khác
  // Băng "chưa khai quy định date" là VIỆC của người có quyền chốt — xe nâng chỉ cần biết dòng đó
  // đang chờ người khác, không cần lời hướng dẫn họ không làm được.
  const canSetDate = can(perms, 'outbound', 'set_date')
  const { data: whs } = useScopedWarehouses(true)
  // Phạm vi chỉ có MỘT kho ⇒ tự chọn, không bắt bấm "Chọn kho…" mỗi lần mở (lái xe nâng thường 1 kho)
  useEffect(() => {
    if (!f.warehouseId && whs?.length === 1) setF({ warehouseId: (whs[0] as { id: string }).id })
  }, [whs, f.warehouseId, setF])
  // Chuông "được giao xe nâng" và các dòng Hộp việc trỏ tới đây kèm ?trip= / ?tab= — mở đúng chuyến, đúng bảng.
  // ⚠ ÁP ĐÚNG MỘT LẦN CHO MỖI LƯỢT ĐIỀU HƯỚNG — khoá theo `location.key`, KHÔNG theo giá trị tham số.
  //  · khoá theo giá trị `f.tab`: bấm tab khác là bị kéo NGƯỢC về tab của đường dẫn (user báo 12/09);
  //  · khoá theo chuỗi tham số: bấm dòng Hộp việc → bấm tab "Hộp việc" → bấm LẠI chính dòng đó thì URL
  //    không đổi ⇒ effect bỏ qua ⇒ dòng đó chết cho tới khi bấm dòng khác (user báo 16/09).
  // `location.key` sinh mới ở MỌI lượt điều hướng (kể cả replace về cùng URL) và đứng yên khi bấm tab.
  const [sp] = useSearchParams()
  const navKey = useLocation().key
  const appliedNav = useRef<string | null>(null)
  useEffect(() => {
    if (appliedNav.current === navKey) return
    appliedNav.current = navKey
    const t = sp.get('tab'), trip = sp.get('trip')
    if (trip) setF({ gdoId: trip })
    if (t && ['INBOX', 'LOWER', 'MOVE', 'SCAN'].includes(t)) setF({ tab: t as Tab })
  }, [navKey, sp, setF])

  const tab = (f.tab as Tab) ?? 'INBOX'
  const boardTab: BoardTab = tab === 'INBOX' ? 'MOVE' : tab
  const { widths: colW, startResize, totalWidth } = useColumnResize(`directed_${tab.toLowerCase()}_col_widths`, COLS[tab].map(c => c.w))

  const confirmTasks = useConfirmTasks()
  const claimTasks = useClaimTasks()
  const { data, isLoading } = useDirectedBoard(f.warehouseId, boardTab, {
    // CHẠY CẢ Ở HỘP VIỆC (17/09): badge đếm trên tab "Cần hạ"/"Cần đưa ra" lấy số từ đây, mà Hộp
    // việc lại là tab MỞ ĐẦU — không nạp thì đúng lúc cần thấy số nhất lại không có số nào. Đổi lại
    // một lời gọi: bù lại, bấm sang tab vai là có dữ liệu ngay, và hàng đợi sắp-lại-theo-tồn +
    // tự-ra-lệnh-fill có thêm một cửa xả. Chưa chọn kho thì vẫn không gọi.
    enabled: !!f.warehouseId,
    gdoId: tab === 'SCAN' ? (f.gdoId || null) : null,
    // "Của tôi" chỉ có nghĩa ở bảng xe chuyển (việc gắn theo người được giao lúc Bắt đầu)
    driverId: tab === 'MOVE' && f.mine ? (me ?? null) : null,
  })
  // Hộp việc: kho bỏ trống = mọi kho trong phạm vi (người quản lý nhiều kho nhìn một lượt)
  const inbox = useWorkInbox(f.warehouseId || null, tab === 'INBOX')
  const sup = useDirectedSupervision(f.warehouseId || null, 7, tab === 'INBOX' && canReplan)
  // Kho KHÔNG có xe hạ riêng: mọi việc nằm ở bảng xe chuyển, tab Cần hạ vô nghĩa → ẩn + đổi tab
  const sepLower = data?.settings?.separate_lowering_forklift !== false
  useEffect(() => {
    if (!sepLower && tab === 'LOWER') setF({ tab: 'MOVE' })
  }, [sepLower, tab, setF])
  const tabs = TABS.filter(x => sepLower || x.key !== 'LOWER')

  // VIỆC RIÊNG TRONG RỔ CHUNG (17/09, user: "tại sao k tạo switch việc chung, việc riêng"):
  // rổ "Cần hạ" là của cả kho, nhưng trong đó có hai thứ đã có chủ — việc ai đó bấm "Nhận" (giữ mềm
  // 10 phút) và dòng lệnh fill đã giao tên (giữ cả ngày). Lọc ở CLIENT vì cả hai dấu hiệu đã nằm sẵn
  // trên dòng; gọi thêm API chỉ để lọc lại đúng thứ mình đang cầm là thừa một round-trip.
  // ⚠️ Lọc KHÔNG được đụng việc đã xong/đã bỏ: chúng ở lại bảng để đối chiếu (luật 10/09) và người
  // vừa làm xong phải còn thấy việc mình vừa ✓ dù nó không còn "của tôi" theo nghĩa đang cầm.
  const isMineRow = (r: DirectedRow) =>
    (r.claim_active && !!r.claimed_by && r.claimed_by === me) || (!!r.fill_assignee_id && r.fill_assignee_id === me)
  const isFreeRow = (r: DirectedRow) => !r.claim_active && !r.fill_assignee_id
  const rows = useMemo(() => {
    let all = data?.rows ?? []
    if (f.hideDone) all = all.filter(r => !r.stage_done && !r.skipped)
    if (tab === 'LOWER' && f.scope !== 'all') {
      all = all.filter(r => r.stage_done || r.skipped || (f.scope === 'mine' ? isMineRow(r) : isFreeRow(r)))
    }
    return all
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, f.hideDone, f.scope, tab, me])

  // STT = THỨ TỰ ĐI TRÊN BẢNG NÀY, đánh lại 1..n theo đúng trình tự dòng đang hiện.
  // KHÔNG in `seq` thô: seq đếm theo TỪNG chuyến, và một dòng bảng gom nhiều việc cùng ô (STT lấy
  // min) ⇒ bảng đọc ra 1, 2, 3, 5, 6 rồi lại 1, 2 của chuyến khác. Người đi theo thứ tự thấy số
  // nhảy cóc và lặp thì hết tin vào chính cái thứ tự đó (user nêu 10/09).
  const ordOf = useMemo(() => {
    const m = new Map<string, number>()
    let n = 0
    for (const r of rows) if (!r.stage_done && !r.skipped) m.set(r.group_key, ++n)
    return m
  }, [rows])
  // "Việc kế tiếp" của TÔI = dòng đầu chưa xong, chưa bỏ, và không có người khác đang cầm
  const nextKey = useMemo(() => rows.find(r =>
    !r.stage_done && !r.skipped && !(r.claim_active && r.claimed_by && r.claimed_by !== me))?.group_key ?? null, [rows, me])
  // "Hôm nay" phải là giá trị tính TRONG thân component (màn kho mở qua đêm giữ ngày hôm qua)
  const todayVN = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const isOldTrip = (d: string | null | undefined) => !!d && d.slice(0, 10) < todayVN

  // Chuyến để chọn ở bảng Sắp quét — lấy từ chính việc đang có, không gọi thêm API
  const { data: allTrips } = useDirectedBoard(f.warehouseId, 'MOVE', { enabled: tab === 'SCAN' })
  const tripOpts = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of allTrips?.rows ?? []) m.set(r.gdo_id, `${r.group_code ?? r.gdo_id}${r.license_plate ? ` · ${r.license_plate}` : ''}`)
    return [...m].map(([value, label]) => ({ value, label }))
  }, [allTrips])
  // Chỉ có MỘT chuyến đang chạy ⇒ tự chọn, không bắt bấm "Chọn chuyến…"
  useEffect(() => {
    if (tab === 'SCAN' && !f.gdoId && tripOpts.length === 1) setF({ gdoId: tripOpts[0].value })
  }, [tab, f.gdoId, tripOpts, setF])

  // Nút QUÉT ngay trên bảng Sắp quét — dùng lại đúng màn quét của trang chuyến (một luồng, một luật)
  const [scanOpen, setScanOpen] = useState(false)
  // …và màn quét của LỆNH FILL cho dòng fill nằm chung bảng (16/09)
  const [fillScan, setFillScan] = useState<string | null>(null)
  // Tra tồn kho + vị trí của mã ngay trên dòng việc — cùng dialog với trang Chuẩn bị hàng
  const [invMat, setInvMat] = useState<PickedMat | null>(null)
  const { data: scanGdo } = useGDO(tab === 'SCAN' && canScan && f.gdoId ? f.gdoId : undefined)

  // ── CHI TIẾT MỘT VIỆC (13/09) ────────────────────────────────────────────────────────────────
  // Bảng chỉ đủ chỗ cho câu lệnh ngắn; mọi thứ còn lại (hồ sơ chuyến · ghi chú CS · từng tem +
  // NSX + %Date · tiến độ) nằm sau một cú bấm vào dòng, không phải sau một lần rời trang.
  const pctBands = usePctBands()
  const tripOf = useMemo(() => {
    const m = new Map<string, DirectedTrip>()
    for (const t of data?.trips ?? []) m.set(t.gdo_id, t)
    return m
  }, [data])
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const detailRow = useMemo(() => rows.find(r => r.group_key === detailKey) ?? null, [rows, detailKey])
  // Hồ sơ chuyến hiện thành BĂNG riêng chỉ khi bảng đang nói về ĐÚNG MỘT chuyến (tab Sắp quét đã
  // chọn chuyến, hoặc kho chỉ có một chuyến đang chạy). Nhiều chuyến thì thông tin đó thuộc về
  // TỪNG DÒNG (cột Chuyến · Giao cho) chứ không phải một câu chung dễ đọc nhầm.
  const focusTrip = useMemo(() => {
    const list = data?.trips ?? []
    if (tab === 'SCAN' && f.gdoId) return list.find(x => x.gdo_id === f.gdoId)
    return list.length === 1 ? list[0] : undefined
  }, [data, tab, f.gdoId])
  // Trang chuyến gác bằng quyền `outbound` — xe nâng thuần không vào được, đừng mời họ bấm vào 403
  const canOpenTrip = can(perms, 'outbound', 'view')

  // Số đếm cho chính hai lựa chọn của switch — đếm trên TOÀN BỘ việc chưa xong của bảng, không đếm
  // trên `rows` (đã bị chính bộ lọc cắt) kẻo chọn "của tôi" xong là ô "chưa ai nhận" tụt về 0.
  const scopeCount = useMemo(() => {
    const open = (data?.rows ?? []).filter(r => !r.stage_done && !r.skipped)
    return { mine: open.filter(isMineRow).length, free: open.filter(isFreeRow).length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, me])

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', pinned: true, allLabel: tab === 'INBOX' ? 'Mọi kho được giao' : 'Chọn kho…',
      options: (whs ?? []).map(w => ({ value: (w as { id: string }).id, label: (w as { id: string; name?: string }).name ?? '' })),
      value: f.warehouseId, onChange: (v: string) => setF({ warehouseId: v, gdoId: '' }) },
    ...(tab === 'SCAN' ? [{
      key: 'trip', label: 'Chuyến', type: 'single' as const, pinned: true, allLabel: 'Chọn chuyến…',
      options: tripOpts, value: f.gdoId, onChange: (v: string) => setF({ gdoId: v }),
    }] : []),
    ...(tab === 'MOVE' ? [{
      key: 'mine', label: 'Phạm vi', type: 'single' as const, pinned: true, allLabel: 'Của tôi (mặc định)',
      options: [{ value: 'all', label: 'Tất cả việc trong kho' }],
      value: f.mine ? '' : 'all', onChange: (v: string) => setF({ mine: v !== 'all' }),
    }] : []),
    // ⚠ Phạm vi của bảng "Cần hạ" KHÔNG nằm trong FilterBar — nó là SWITCH hiện sẵn ngay trên bảng
    // (user chốt 17/09: "Tôi muốn switch chứ ko phải là filter"). Chip lọc phải bấm mở menu mới biết
    // có những lựa chọn nào; đây là thứ xe nâng lật qua lật lại suốt ca nên cả ba lựa chọn + số của
    // từng cái phải nhìn thấy mà không bấm nhát nào. Xem <ScopeSwitch> dưới bảng tab.
    ...(tab !== 'INBOX' ? [{
      key: 'done', label: 'Việc đã xong', type: 'single' as const, allLabel: 'Hiện (mặc định — để đối chiếu)',
      options: [{ value: 'hide', label: 'Ẩn việc đã xong' }],
      value: f.hideDone ? 'hide' : '', onChange: (v: string) => setF({ hideDone: v === 'hide' }),
    }] : []),
  ]

  const t = data?.totals ?? {}
  const unset = data?.unset_items ?? []
  // Tách chuyến CŨ còn dở ra khỏi việc hôm nay: chuyến bỏ dở từ tháng trước vẫn IN_PROGRESS nên
  // ngày nào băng vàng cũng kêu về dữ liệu cũ — cảnh báo kêu hằng ngày thì người ta thôi đọc.
  // KHÔNG giấu (việc dở vẫn là việc thật), chỉ hạ tông và nói rõ nó là chuyến ngày nào.
  const unsetNow = unset.filter(u => !isOldTrip(u.delivery_date))
  const unsetOld = unset.filter(u => isOldTrip(u.delivery_date))
  const oldestUnset = unsetOld.map(u => u.delivery_date ?? '').filter(Boolean).sort()[0] ?? null
  // Dựng câu NGOÀI JSX: dấu `>` trong biểu thức nằm giữa JSX làm trình biên dịch hiểu là thẻ
  const unsetHint = unsetNow.length
    ? ' ' + unsetNow.slice(0, 4).map(u => `${u.group_code ?? ''} · ${u.material_code ?? ''}`).join(' · ')
      + (unsetNow.length > 4 ? ` … và ${unsetNow.length - 4} dòng nữa` : '')
    : ''

  const busy = confirmTasks.isPending || claimTasks.isPending
  // BỎ DẤU ✓ TRÊN VIỆC NHẶT LẺ (14/09): ✓ của nó đã GHI TỒN (pallet chuyển về vị trí nhặt lẻ), nên bỏ
  // dấu mà không hỏi là để sổ nói một đằng hàng nằm một nẻo. Chỉ con người biết hàng đã đưa xuống
  // chưa ⇒ hỏi đúng MỘT câu, hai lối: ghi lại về ô cũ (restore) hay chỉ bỏ dấu.
  const [undoAsk, setUndoAsk] = useState<{ r: DirectedRow; stage: ConfirmStage } | null>(null)
  const [lastRestore, setLastRestore] = useState(false)
  const fire: Fire = {
    confirm: (r, stage) => { setLastRestore(false); confirmTasks.mutate({ task_ids: r.task_ids, stage }) },
    undo: (r, stage) => {
      if (r.kind === 'LOOSE_FEED') { setUndoAsk({ r, stage }); return }
      setLastRestore(false); confirmTasks.mutate({ task_ids: r.task_ids, stage, undo: true })
    },
    claim: (r, undo) => claimTasks.mutate({ task_ids: r.task_ids, undo }),
    // Mở màn quét của ĐÚNG lệnh fill chứa dòng này — không bắt rời trang đi tìm lệnh (chính là việc
    // user muốn bỏ: "phải bật Fill hàng lên"). Cùng component quét với trang lệnh, một luồng một luật.
    scanFill: r => { if (r.fill_order_id) { unlockAudio(); setFillScan(r.fill_order_id) } },
  }
  const runUndo = (restore: boolean) => {
    if (!undoAsk) return
    setLastRestore(restore)
    confirmTasks.mutate({ task_ids: undoAsk.r.task_ids, stage: undoAsk.stage, undo: true, restore })
    setUndoAsk(null)
  }
  // Việc NHẶT Lẻ ở tab Sắp quét: lối thẳng tới dòng hàng nơi thủ kho bấm "Check nhặt lẻ" (bước trừ tồn thật)
  const canLoose = can(perms, 'loosepicking', 'view')
  const looseLinkOf = (r: DirectedRow) =>
    canLoose && r.kind === 'LOOSE_FEED' && r.item_id ? `/wms/loosepicking/${r.gdo_id}/items/${r.item_id}` : null
  // "Tối ưu tuyến" (14/09, đổi tên 15/09): mở trang Nhặt lẻ của chuyến với màn đường đi + quét tại chỗ đã bật sẵn
  const routeLinkOf = (r: DirectedRow) =>
    canLoose && r.kind === 'LOOSE_FEED' && r.gdo_id ? `/wms/loosepicking/${r.gdo_id}?route=1` : null
  // "KHAI NGAY" (14/09): băng vàng từng bảo "mở chuyến rồi bấm Quy định date" — mỗi dòng chưa khai là
  // một lần rời trang. Nay mở đúng SetDateRuleSheet dùng chung với trang chuyến ngay tại đây.
  const [dateOpen, setDateOpen] = useState(false)
  const dateTargets = useMemo<DateRuleTarget[]>(() => (data?.unset_items ?? []).map(u => ({
    item_id: u.item_id, material_id: u.material_id ?? null, material_code: u.material_code,
    material_name: u.material_name ?? null, material_category: u.material_category ?? null,
    trip_label: u.group_code ?? null, remaining: Number(u.remaining ?? 0),
    units: { units_per_carton: u.units_per_carton ?? null, entry_unit: u.entry_unit ?? null, base_unit: u.base_unit ?? null },
    note: u.note ?? null, current: null, customer_name: u.customer_name ?? null,
  })), [data])
  // Số việc CỦA TÔI lên nhãn tab — mở trang là biết còn bao nhiêu, không cần vào tab
  const mineCount = inbox.data?.counts?.mine ?? 0
  // Số trên từng tab. `to_lower`/`to_move` đến từ RPC nên đếm TOÀN KHO (không phụ thuộc tab đang mở)
  // và BE đã cộng sẵn phần lệnh fill vào tab mà xe nâng nhìn để hạ.
  const tabBadge = (k: Tab): number => {
    const t = data?.totals ?? {}
    if (k === 'INBOX') return mineCount
    if (k === 'LOWER') return Number(t.to_lower ?? 0)
    if (k === 'MOVE') return Number(t.to_move ?? 0)
    return 0   // Sắp quét: theo TỪNG chuyến, một con số chung ở đây sẽ nói sai
  }
  const apiErr = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  const emptyReason = !f.warehouseId ? 'Chọn kho để xem việc cần làm'
    : (tab === 'SCAN' && !f.gdoId) ? 'Chọn chuyến để xem thứ tự quét' : null
  // …và cho chọn NGAY TẠI ĐÓ. Trước đây chỉ có câu chữ, còn ô chọn chuyến nằm trong nút "Lọc" —
  // trên điện thoại (360 px) người quét đọc "Chọn chuyến" mà không thấy chỗ nào chọn được.
  const emptyBlock = !emptyReason ? null : (
    <div className="py-6 text-center text-[11px] text-slate-400">
      <div>{emptyReason}</div>
      {tab === 'SCAN' && !!f.warehouseId && !f.gdoId && tripOpts.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-center gap-1.5 px-2">
          {tripOpts.map(o => (
            <button key={o.value} type="button" onClick={() => setF({ gdoId: o.value })}
              className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100">
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const cols = COLS[tab]
  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="hidden sm:flex text-sm font-semibold text-slate-800 items-center gap-1.5 shrink-0">
              <ListChecks className="h-4 w-4 text-sky-600" /> Việc cần làm
            </h1>
            {/* Tab = 4 VAI. Để nút to trên mobile: người bấm đang đeo găng, đứng giữa kho.
                ĐIỆN THOẠI (đo 12/09 ở 360 VÀ 390 px): 4 tab cần 351 px mà khung chỉ còn 248 px ⇒ tab
                thứ tư "Sắp quét" TRÔI RA NGOÀI MÀN và nằm DƯỚI nút Lọc — thủ kho không bấm nổi vào
                bảng của chính mình, lại còn không nhìn ra tab nào đang chọn. Đây là lần thứ tư cùng
                một khuôn "vai này bị khoá khỏi màn của vai kia", nên chữa tận gốc: mobile cho tab
                thành LƯỚI 4 CỘT chiếm trọn bề ngang (bỏ icon lấy chỗ cho chữ), nút Lọc tự xuống
                hàng dưới. Desktop giữ nguyên một hàng. */}
            <div className="grid grid-cols-4 gap-1 w-full sm:flex sm:w-auto sm:flex-1 sm:items-center sm:min-w-0">
              {tabs.map(x => (
                <button key={x.key} onClick={() => setF({ tab: x.key })} title={x.hint}
                  className={`flex items-center justify-center sm:justify-start gap-1 rounded-md px-1 sm:px-2.5 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${
                    tab === x.key ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  <x.icon className="hidden sm:block h-3.5 w-3.5" /> {x.label}
                  {/* ĐẾM SỐ TRÊN TỪNG TAB (17/09, user: "còn việc chưa hoàn thành thì có cảnh báo màu
                      đỏ dạng đếm số nhỉ?"). Đỏ khi tab đó CÒN việc mà mình đang đứng chỗ khác — tab
                      đang mở thì bảng đã nói rồi, badge hạ tông để khỏi kêu vào mặt người đang làm.
                      Số của "Cần hạ"/"Cần đưa ra" lấy từ `totals` (đếm theo VIỆC, đã gồm pallet fill)
                      nên đúng ở mọi chỗ đang đứng; tab "Sắp quét" không có số vì nó theo từng chuyến. */}
                  {tabBadge(x.key) > 0 && (
                    <span className={`ml-0.5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                      tab === x.key ? 'bg-white/25 text-white' : 'bg-red-500 text-white'}`}>{nf(tabBadge(x.key))}</span>
                  )}
                </button>
              ))}
            </div>
            {/* PC: nút Quét đứng cạnh tab. Mobile 360 px không đủ chỗ (3 tab + Quét + Lọc đè lên nhau — đo 12/09)
                ⇒ mobile đưa Quét thành thanh full bề ngang ngay trên thẻ đầu (xem dưới) */}
            {tab === 'SCAN' && canScan && f.gdoId && (
              <Button className="hidden sm:inline-flex h-7 px-3 text-[11px]" disabled={!scanGdo} onClick={() => setScanOpen(true)}
                title="Quét pallet cho chuyến đang chọn — cùng màn quét với trang chuyến">
                <ScanIcon className="h-3.5 w-3.5 mr-1" /> Quét
              </Button>
            )}
            <span className="sm:hidden ml-auto"><FilterSheetButton defs={filterDefs} /></span>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        {tab === 'INBOX' && (
          <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
            <InboxPanel inbox={inbox.data} loading={inbox.isLoading} showWh={!f.warehouseId}
              sup={canReplan && f.warehouseId ? sup.data : undefined} />
            {canReplan && !f.warehouseId && (
              <p className="px-3 pb-3 text-[11px] text-slate-400">Chọn một kho để xem khối Giám sát (ai đang làm · chờ hạ lâu nhất · % làm đúng kế hoạch).</p>
            )}
          </div>
        )}

        {/* SWITCH PHẠM VI (17/09) — rổ "Cần hạ" là của cả kho, nhưng trong đó có việc đã có chủ:
            ai đó bấm "Nhận" (giữ mềm 10 phút) · dòng lệnh fill đã giao tên (giữ cả ngày).
            Số nằm NGAY trên nút để biết bấm sang có gì mà không phải bấm thử.
            Mặc định "Tất cả" — đảo sang "của tôi" là sai: kho một hai xe nâng thì không ai bấm
            Nhận, ô đó rỗng và người vào ca tưởng mình hết việc (cùng lớp "khoá tay nhau" lặp 3 lần). */}
        {tab === 'LOWER' && (
          <div className="shrink-0 border-b bg-white px-3 py-1.5 flex items-center gap-2">
            <span className="hidden sm:inline text-[10px] uppercase tracking-wide text-slate-400 shrink-0">Phạm vi</span>
            <div className="grid grid-cols-3 gap-1 w-full sm:flex sm:w-auto">
              {([
                { k: 'all',  label: 'Tất cả',      n: scopeCount.mine + scopeCount.free, tip: 'Mọi việc hạ của kho' },
                { k: 'mine', label: 'Của tôi',     n: scopeCount.mine, tip: 'Việc bạn đã bấm Nhận + dòng lệnh fill giao cho bạn' },
                { k: 'free', label: 'Chưa ai nhận', n: scopeCount.free, tip: 'Việc chung chưa có ai cầm — cứ làm, không cần xin' },
              ] as const).map(o => (
                <button key={o.k} type="button" title={o.tip}
                  onClick={() => setF({ scope: o.k })}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-2 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${
                    f.scope === o.k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {o.label}
                  <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                    f.scope === o.k ? 'bg-white/25 text-white' : 'bg-white text-slate-500'}`}>{nf(o.n)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab !== 'INBOX' && (<>
        <SummaryBand tiles={[
          { label: 'Việc còn lại', value: nf(t.pending ?? 0), accent: (t.pending ?? 0) > 0 },
          { label: 'Chờ hạ',       value: nf(t.to_lower ?? 0) },
          { label: 'Chờ đưa ra',   value: nf(t.to_move ?? 0) },
          { label: 'Đã xong',      value: nf(t.done ?? 0) },
          { label: 'Chuyến',       value: nf(t.trips ?? 0) },
        ]} />

        {/* HỒ SƠ CHUYẾN ĐANG LÀM (13/09) — giao cho ai · mấy DO · còn bao nhiêu. Trước đó bảng chỉ
            có biển số + cửa, trong khi NPP/số DO/tiến độ đều nằm sẵn trong DB. Mobile giữ ba mẩu
            cốt lõi, phần còn lại chỉ hiện từ sm (chuẩn mật độ: dữ liệu phải xuất hiện sớm). */}
        {/* Máy vừa sắp lại việc chưa ai đụng theo tồn mới (14/09) — phải NÓI RA, kẻo xe nâng thấy thứ tự đổi mà không biết vì sao */}
        {/* Máy vừa tự đặt / thu hồi lệnh fill (15/09) — cùng luật: máy làm gì dưới tay người thì phải
            nói ra. Nhưng NÓI RA ≠ CHIẾM CHỖ: hai dải chữ riêng ăn ~48 px của màn 360 và đẩy bảng
            xuống (user 16/09: "đưa thông tin vào tooltip info đi, thấy mấy cảnh báo mất hết cả màn
            hình"). Nay một hàng chip, chi tiết + đường đi tiếp nằm trong ⓘ. */}
        {((data?.auto_replanned ?? 0) > 0 || data?.auto_fill?.created || data?.auto_fill?.recalled) ? (
          <div className="shrink-0 border-b bg-white px-3 py-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            {(data?.auto_replanned ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                Kế hoạch <b>{data?.auto_replanned}</b> chuyến vừa sắp lại
                <InfoTip className="text-amber-500 hover:text-amber-700"
                  tip={<>Tồn kho vừa đổi nên máy sắp lại các việc <b>chưa ai đụng</b> theo tồn hiện tại. Việc đã hạ /
                    đã đưa ra giữ nguyên, không ai mất phần đang làm dở.</>} />
              </span>
            )}
            {(data?.auto_fill?.created || data?.auto_fill?.recalled) ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-900">
                Lệnh fill: {(data.auto_fill.created ?? 0) > 0 && <><b>+{data.auto_fill.created}</b> dòng</>}
                {(data.auto_fill.created ?? 0) > 0 && (data.auto_fill.recalled ?? 0) > 0 ? ' · ' : ''}
                {(data.auto_fill.recalled ?? 0) > 0 && <>thu hồi <b>{data.auto_fill.recalled}</b></>}
                <InfoTip className="text-sky-400 hover:text-sky-700" tip={
                  <>
                    <div>Hệ thống tự đối chiếu nhu cầu nhặt lẻ của ngày:
                      {(data.auto_fill.created ?? 0) > 0 && <> vừa ra <b>{data.auto_fill.created} dòng</b> hạ hàng xuống kho lẻ{data.auto_fill.order_code ? <> ({data.auto_fill.order_code})</> : null} — chưa giao ai.</>}
                      {(data.auto_fill.recalled ?? 0) > 0 && <> Thu hồi <b>{data.auto_fill.recalled} dòng</b> không còn cần.</>}
                    </div>
                    <Link to="/wms/fill" onClick={anchorDirected} className="mt-1 inline-block underline font-medium text-sky-700">Mở Fill hàng ›</Link>
                  </>} />
              </span>
            ) : null}
          </div>
        ) : null}
        {focusTrip && (
          <div className="shrink-0 border-b bg-sky-50/70 px-3 py-1 text-[11px] text-slate-700 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-mono font-semibold">{tripName(focusTrip)}</span>
            {focusTrip.customers && <span className="truncate max-w-[55%] sm:max-w-none"><b>{focusTrip.customers}</b></span>}
            <span className="tabular-nums">{nf(focusTrip.lines_done)}/{nf(focusTrip.lines_total)} dòng quét đủ</span>
            <span className="hidden sm:inline text-slate-500 tabular-nums">còn {nf(focusTrip.tasks_pending)} việc</span>
            {focusTrip.dock_name && <span className="hidden sm:inline text-slate-500">{focusTrip.dock_name}</span>}
            <span className="hidden sm:inline text-slate-500 tabular-nums">{nf(focusTrip.n_do)} DO</span>
            {focusTrip.started_at && <span className="hidden sm:inline text-slate-500">bắt đầu {formatTimestampTime(focusTrip.started_at)}</span>}
            {focusTrip.lines_unset > 0 && <span className="text-amber-700 tabular-nums">{nf(focusTrip.lines_unset)} dòng chưa khai date</span>}
          </div>
        )}

        {/* Dòng CHƯA CHỐT %Date: không có việc nào — phải nói ra, không im lặng để người ta tưởng
            hàng đã được chia (user chốt: "trong nghĩ là mặc định đi làm, sau đó mới update thì sẽ là làm sai") */}
        {/* Mobile chỉ 1 dòng: chuẩn mật độ đòi dữ liệu xuất hiện sớm, cảnh báo dài đẩy bảng xuống quá sâu */}
        {unset.length > 0 && !canSetDate && (
          <div className="shrink-0 border-b px-3 py-1.5 text-[11px] bg-slate-50 text-slate-500 truncate sm:whitespace-normal">
            {unset.length} dòng hàng đang <b>chờ người khác</b> khai quy định date — chưa có việc từ các dòng đó
            {unsetOld.length ? ` (${unsetOld.length} thuộc chuyến cũ)` : ''}.
          </div>
        )}
        {unset.length > 0 && canSetDate && (
          <div className={`shrink-0 border-b px-3 py-1.5 text-[11px] flex items-center gap-2 ${
            unsetNow.length ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-500'}`}>
            <span className="min-w-0 flex-1 truncate sm:whitespace-normal">
              {unsetNow.length > 0 && (<>
                <b>{unsetNow.length} dòng hàng chưa khai quy định date</b> — chưa có việc nào được giao.
                <span className="hidden sm:inline">{unsetHint}</span>
              </>)}
              {unsetOld.length > 0 && (
                <span className={unsetNow.length ? 'text-amber-700/70' : ''}>
                  {unsetNow.length ? ' · ' : ''}{unsetOld.length} dòng thuộc <b>chuyến cũ còn dở</b>
                  {oldestUnset ? ` (từ ${formatDate(oldestUnset)})` : ''} — chốt nốt hoặc Hoàn thành/Hủy chuyến đó thì hết nhắc.
                </span>
              )}
            </span>
            {/* KHAI NGAY tại chỗ — không rời trang (14/09) */}
            <Button size="sm" className="h-8 sm:h-7 px-2.5 text-[11px] shrink-0" onClick={() => setDateOpen(true)}
              title="Mở màn khai quy định date cho các dòng này ngay tại đây">
              <CalendarClock className="h-3.5 w-3.5 mr-1" /> Khai ngay ({unset.length})
            </Button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {/* ── PDA: THẺ (không cuộn ngang; thẻ đầu to, nút ✓ ≥ 44 px) ── */}
          <div className="sm:hidden p-2 space-y-2">
            {tab === 'SCAN' && canScan && f.gdoId && !isLoading && (
              <Button className="w-full h-11 text-sm" disabled={!scanGdo} onClick={() => setScanOpen(true)}>
                <ScanIcon className="h-4 w-4 mr-1.5" /> Quét pallet chuyến này
              </Button>
            )}
            {isLoading && <div className="py-6 text-center text-[11px] text-slate-400">Đang tải…</div>}
            {!isLoading && emptyBlock}
            {!isLoading && !emptyReason && rows.length === 0 && (
              <div className="py-6 text-center text-[11px] text-slate-400">
                <div>Không có việc nào cho kho này.</div>
                <div className="mt-1 text-slate-500">Kiểm: kho bật <b>Hướng dẫn</b> chưa · chuyến đã <b>Bắt đầu</b> chưa · dòng hàng đã <b>khai quy định date</b> chưa.</div>
              </div>
            )}
            {rows.map(r => {
              const st = stateOf(r, boardTab, me)
              const first = r.group_key === nextKey
              const closed = r.stage_done || r.skipped
              const { actions, heldByOther } = actionsFor(r, boardTab, me, canConfirm, fire, canFill)
              const ord = ordOf.get(r.group_key)
              const isFill = r.kind === 'FILL'
              const dest = isFill ? r.to_code : tab === 'LOWER' ? (r.drop_name ?? r.to_name) : (r.to_name ?? r.to_code)
              const where = isFill ? r.from_code : tab === 'LOWER' ? r.from_code : r.current_code
              const { rule, measure, tone, nsx } = dateBits(r)
              const hint = pickHint(r, boardTab)
              return (
                // Bấm THẺ = mở chi tiết việc; nút bên trong tự chặn nổi bọt (panel chỉ để đọc nên
                // bấm nhầm không hỏng gì, nhưng vẫn có dòng "Chi tiết ›" để người dùng biết bấm được).
                <div key={r.group_key} onClick={() => { if (r.kind !== 'FILL') setDetailKey(r.group_key) }}
                  className={`rounded-xl border p-3 space-y-1.5 ${closed ? 'border-slate-200 bg-slate-50 text-slate-400' : first ? 'border-sky-400 bg-sky-50 shadow-sm' : heldByOther ? 'border-slate-200 bg-white opacity-70' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className={`font-semibold uppercase tracking-wide ${first ? 'text-sky-700' : closed ? 'text-slate-400' : 'text-slate-500'}`}>
                      {r.skipped ? 'Hệ thống đã huỷ' : r.stage_done ? 'Đã xong' : first ? 'Việc kế tiếp' : `#${ord ?? ''}`}
                    </span>
                    <span className="truncate text-slate-500">
                      {r.kind === 'FILL'
                        ? <span className="text-sky-700 font-semibold">Fill kho lẻ · {r.fill_order_code ?? ''}</span>
                        : tab === 'SCAN' ? null : <>{r.license_plate ?? r.group_code ?? '—'}{r.dock_name ? ` · ${r.dock_name}` : ''}</>}
                      {r.kind !== 'FILL' && isOldTrip(r.delivery_date) && <span className="text-amber-600"> · chuyến {formatDate(r.delivery_date!)}</span>}
                    </span>
                  </div>
                  {/* NƠI NHẬN · SỐ XE — người lấy hàng phải biết đang phục vụ ai, và dòng nào cũng phải
                      gắn Số xe (user 14/09 "Tuyết Trang_Số xe", rồi "bỏ chữ Giao cho và Số xe" — chỉ in
                      giá trị); biển số ở dòng trên là thứ nhìn thấy ngoài bãi, Số xe là thứ điều vận/SAP gọi */}
                  {(r.customer_name || r.group_code) && (
                    <div className="text-[11px] text-slate-500 truncate">
                      {r.customer_name}
                      {r.group_code && <>{r.customer_name ? ' · ' : ''}<span className="font-mono">{r.group_code}</span></>}
                    </div>
                  )}
                  <Step label="Date" big={first}>
                    {isFill ? (
                      r.fill_required_date
                        ? <><span className="font-semibold">NSX {formatDate(r.fill_required_date, 'dd-MM-yy')}</span>
                            <div className="text-xs text-slate-500">quét tem sẽ kiểm date</div></>
                        : <span className="text-xs text-slate-400">mọi date</span>
                    ) : (<>
                      {rule
                        ? <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${rule.cls}`}>{rule.text}</span>
                        : <span className="text-xs text-slate-400">chưa khai</span>}
                      {measure && <span className={`ml-1.5 font-bold tabular-nums ${closed ? '' : pctDateCls(tone, pctBands)}`}>{measure}</span>}
                      {nsx && <div className={`text-xs font-semibold ${(r.cell_ndates ?? 1) > 1 ? 'text-amber-800' : 'text-slate-600'}`}>NSX {nsx}</div>}
                    </>)}
                  </Step>
                  <Step label={tab === 'SCAN' ? 'Ở' : 'Đi tới'} big={first}>
                    <span className={`font-mono font-semibold ${closed ? 'line-through' : ''}`}>{where ?? <span className="text-slate-300 font-sans font-normal">chưa có trên bản vẽ</span>}</span>
                    {r.level_no != null && r.level_no > 1 && <span className="text-xs text-slate-500"> · tầng {r.level_no}</span>}
                  </Step>
                  <Step label={tab === 'LOWER' ? 'Hạ' : tab === 'MOVE' ? 'Đưa' : 'Lấy'} big={first}>
                    <span className="font-semibold tabular-nums">{nf(r.n_pallets)}</span> <span className="text-slate-500">pallet</span>
                    <span className="text-xs text-slate-500"> · {r.material_codes?.filter(Boolean).join(', ') || '—'}</span>
                    {hint && <div className="text-xs text-slate-500">{hint}</div>}
                    {r.material_name && <div className="text-xs text-slate-500">{r.material_name}</div>}
                    {tab === 'SCAN' && r.is_partial && !r.stage_done && (
                      <div className="text-xs font-semibold text-amber-700">lấy {qtyLabel(r.qty_base, r)} — một phần pallet</div>
                    )}
                    <div className="mt-1"><StockButtons r={r} onPick={setInvMat} big /></div>
                  </Step>
                  <Step label={tab === 'LOWER' || isFill ? 'Đặt xuống' : 'Tới'} big={first}>
                    <span className="font-semibold">{dest ?? <span className="text-slate-300 font-normal">—</span>}</span>
                    {r.kind === 'LOOSE_FEED' && <span className="ml-1 text-xs text-purple-600">nhặt lẻ</span>}
                    {isFill && <span className="ml-1 text-xs text-sky-600">ô nhặt lẻ</span>}
                    {tab === 'SCAN' && looseLinkOf(r) && (
                      <Link to={looseLinkOf(r)!} onClick={e => { e.stopPropagation(); anchorDirected() }}
                        className="mt-1 flex items-center gap-1 text-xs text-purple-700 underline">
                        <ExternalLink className="h-3.5 w-3.5" /> Trừ tồn nhặt lẻ ở dòng hàng
                      </Link>
                    )}
                    {tab === 'SCAN' && routeLinkOf(r) && (
                      <Link to={routeLinkOf(r)!} onClick={e => { e.stopPropagation(); anchorDirected() }}
                        className="mt-1 flex items-center gap-1 text-xs text-sky-700 underline">
                        <ScanIcon className="h-3.5 w-3.5" /> Tối ưu tuyến — đi và quét
                      </Link>
                    )}
                  </Step>
                  {/* "⏳ chờ xe hạ" là lời nói với XE CHUYỂN — trên thẻ của chính xe hạ thì đó là việc của họ, không phải chờ ai */}
                  {(closed || heldByOther || isFill || (tab === 'MOVE' && (r.waiting_lower || r.combined_lower))) && (
                    <div className={`text-xs ${st.cls}`}>
                      {closed ? st.text : heldByOther ? `${heldByOther} đang làm` : st.text}
                    </div>
                  )}
                  {actions.length > 0 && (
                    <div className="flex gap-2 pt-1">
                      {actions.map(a => (
                        <Button key={a.key} variant={a.primary ? 'default' : 'outline'} disabled={busy}
                          className={`${first ? 'h-11 text-sm' : 'h-9 text-xs'} ${a.primary ? 'flex-1' : 'px-3'} ${a.muted ? 'opacity-70' : ''}`}
                          onClick={e => { e.stopPropagation(); a.onClick() }}>
                          <a.icon className="h-4 w-4 mr-1" /> {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {/* KÍNH LÚP (user 14/09): tem pallet ghim · NSX · %Date từng pallet · hồ sơ chuyến — chỉ khi cần soi */}
                  {isFill ? (
                    <Link to={`/wms/fill/orders/${r.fill_order_id}`} onClick={e => { e.stopPropagation(); anchorDirected() }}
                      className="flex items-center justify-end gap-1 text-[11px] text-sky-700 pt-0.5">
                      <ExternalLink className="h-3.5 w-3.5" /> Mở lệnh fill
                    </Link>
                  ) : (
                  <div className="flex items-center justify-end gap-1 text-[11px] text-sky-700 pt-0.5">
                    <Search className="h-3.5 w-3.5" /> Soi chi tiết (tem pallet · NSX · %Date)
                  </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── PC / tablet: BẢNG ── */}
          <div className="hidden sm:block">
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
            style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {cols.map((c, i) => (
                  // KHÔNG đặt `relative` lên <TableHead>: tailwind-merge giữ class position CUỐI nên nó
                  // đè mất `sticky top-0` của base ⇒ header hết đứng yên khi cuộn. th sticky đã là
                  // containing block cho span absolute rồi (bẫy sticky-header-relative-trap).
                  // Cột THAO TÁC ghim mép PHẢI: bảng nay 9–10 cột nên tràn khung ở 1280 px, mà nút
                  // "Nhận / Xong" là thứ người ta vào đây để bấm — bắt kéo ngang mới thấy nút là
                  // đúng lỗi đã chữa ở Sổ đóng gói 12/08 ("khỏi kéo ngang mới thấy nút").
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''} ${c.id === 'act' ? 'sticky right-0 z-20 bg-slate-50 border-l border-slate-200' : ''}`}>
                    {c.label}
                    <span onPointerDown={e => startResize(i, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={cols.length} className="px-2 py-6 text-center text-[11px] text-slate-400">Đang tải…</TableCell></TableRow>}
              {!isLoading && emptyBlock && <TableRow><TableCell colSpan={cols.length} className="px-2 py-0">{emptyBlock}</TableCell></TableRow>}
              {!isLoading && !emptyReason && rows.length === 0 && (
                // KHÔNG khẳng định lý do (câu cũ nói thẳng "kho chạy chế độ Thủ công" — đo 10/09 thì cả ba
                // vế đều SAI: kho đang Hướng dẫn, chuyến đã Bắt đầu, dòng đã chốt %Date; việc thiếu chỉ vì
                // cờ bật SAU khi chuyến bắt đầu nên không ai sắp lại). Nêu 3 chỗ cần kiểm + đường phục hồi.
                <TableRow><TableCell colSpan={cols.length} className="px-2 py-6 text-center text-[11px] text-slate-400">
                  <div>Không có việc nào cho kho này.</div>
                  <div className="mt-1 text-slate-500">
                    Kiểm lần lượt: kho đã bật <b>Chế độ làm việc = Hướng dẫn</b> chưa · có chuyến nào đã <b>Bắt đầu</b> chưa · dòng hàng đã <b>khai quy định date</b> chưa.
                  </div>
                  <div className="text-slate-500">
                    Đủ cả ba mà vẫn trống (hay vừa bật Hướng dẫn khi chuyến đã chạy) → mở trang chuyến, bấm <b>↻ Sắp lại kế hoạch</b>.
                  </div>
                </TableCell></TableRow>
              )}
              {rows.map(r => {
                const st = stateOf(r, boardTab, me)
                // Xong = GẠCH NGANG + xám, vẫn ở lại bảng (user chốt "phòng bị quên")
                const closed = r.stage_done || r.skipped
                const dim = closed ? 'text-slate-400 line-through' : ''
                const first = r.group_key === nextKey
                const { actions, heldByOther } = actionsFor(r, boardTab, me, canConfirm, fire, canFill)
                const cell = 'px-2 py-1 text-[10px] whitespace-nowrap'
                return (
                  // Bấm DÒNG = mở chi tiết việc (hồ sơ chuyến · từng tem + NSX + %Date · ghi chú CS).
                  // Nút bên trong tự chặn nổi bọt để không vừa bấm ✓ vừa mở panel.
                  // Dòng fill không có hồ sơ chuyến / tem ghim để soi ⇒ không mở panel chi tiết (panel
                  // trống còn tệ hơn không có nút); muốn xem thì mở thẳng lệnh fill ở cột thao tác.
                  <TableRow key={r.group_key} onClick={() => { if (r.kind !== 'FILL') setDetailKey(r.group_key) }}
                    title={r.kind === 'FILL' ? 'Dòng hạ hàng của lệnh fill — bấm Quét để thực hiện' : 'Bấm để xem chi tiết việc này'}
                    className={`${r.kind === 'FILL' ? '' : 'cursor-pointer'} ${dim} ${first ? 'bg-sky-50' : ''}`}>
                    <TableCell className={`${cell} text-right font-semibold tabular-nums sticky left-0 z-10 ${first ? 'bg-sky-50' : 'bg-white'}`}>
                      {/* Việc đã xong / đã bỏ không mang số thứ tự nữa — nó không còn nằm trong đường đi */}
                      {r.skipped
                        ? <span className="text-slate-300 no-underline">—</span>
                        : (ordOf.get(r.group_key) ?? <span className="text-slate-300 no-underline">✓</span>)}
                    </TableCell>

                    {tab === 'SCAN' ? (<>
                      <TableCell className={cell}>
                        <span className="font-mono">{r.current_code ?? <span className="text-slate-300">chưa có trên bản vẽ</span>}</span>
                        {r.level_no != null && r.level_no > 1 && !r.stage_done && <span className="text-[9px] text-slate-400"> · tầng {r.level_no}</span>}
                      </TableCell>
                      <TableCell className={cell}><DateCell r={r} bands={pctBands} off={closed} /></TableCell>
                      <TableCell className={`${cell} ${r.stage_done ? '' : st.cls}`}>{st.text}</TableCell>
                    </>) : (<>
                      <TableCell className={cell}>
                        {/* Dòng fill không thuộc chuyến nào — cột này nói nó là việc gì và của lệnh nào */}
                        {r.kind === 'FILL' ? (<>
                          <div className="font-semibold text-sky-700">Fill kho lẻ</div>
                          <div className="text-[9px] text-slate-400 font-mono">
                            {r.fill_order_code ?? '—'}{r.fill_auto ? ' · máy tạo' : ''}
                          </div>
                          {/* Ai được giao thì nói ở cột "Đi tới" cùng trạng thái (khỏi in tên hai lần) */}
                        </>) : (<>
                        <div className="font-mono font-semibold">{tripName(r)}</div>
                        <div className="text-[9px] text-slate-400">
                          {r.dock_name ?? '—'}
                          {/* Chuyến của ngày khác nằm chung bảng thì phải nói rõ, kẻo tưởng việc hôm nay */}
                          {isOldTrip(r.delivery_date) && (
                            <span className="text-amber-600 no-underline"> · chuyến {formatDate(r.delivery_date!)}</span>
                          )}
                        </div>
                        {/* NƠI NHẬN: người lấy hàng phải biết mình đang phục vụ ai, không chỉ biết biển số */}
                        {r.customer_name && <div className="text-[9px] text-slate-500 truncate no-underline">{r.customer_name}</div>}
                        </>)}
                      </TableCell>
                      {tab === 'LOWER' ? (<>
                        <TableCell className={cell}>
                          <div className="font-mono">{r.from_code ?? <span className="text-slate-300">chưa có trên bản vẽ</span>}</div>
                          {/* Ai hạ, lúc mấy giờ — người sau nhìn vào phải biết việc đã xong do ai (user chốt) */}
                          {closed && <div className={`text-[9px] no-underline ${r.skipped ? 'text-slate-400' : 'text-green-600'}`}>{st.text}</div>}
                          {/* Dòng fill: nói TRƯỚC là lệnh đã giao ai (cửa quét 409 với người khác) */}
                          {r.kind === 'FILL' && (
                            <div className={`text-[9px] no-underline ${st.cls}`}
                              title={r.fill_assignee_id && r.fill_assignee_id !== me
                                ? `Dòng lệnh này đã giao cho ${r.fill_assignee_name ?? 'người khác'}. Quét được nhưng máy chủ sẽ hỏi lại — chỉ người có quyền "Giao lệnh" mới nhận lại được để làm thay.`
                                : 'Hạ pallet xuống vị trí nhặt lẻ rồi quét tem để ghi nhận (máy kiểm đúng mã + đúng date)'}>
                              {st.text}
                            </div>
                          )}
                          {heldByOther && !r.stage_done && <div className="text-[9px] text-slate-500 no-underline">{heldByOther} đang làm</div>}
                        </TableCell>
                        <TableCell className={`${cell} text-right tabular-nums`}>{r.level_no ?? '—'}</TableCell>
                        <TableCell className={cell}><DateCell r={r} bands={pctBands} off={closed} /></TableCell>
                      </>) : (<>
                        <TableCell className={cell}>
                          <span className="font-mono">{r.current_code ?? <span className="text-slate-300">chưa có trên bản vẽ</span>}</span>
                          {r.level_no != null && r.level_no > 1 && !r.stage_done && <span className="text-[9px] text-slate-400"> · tầng {r.level_no}</span>}
                        </TableCell>
                        <TableCell className={cell}><DateCell r={r} bands={pctBands} off={closed} /></TableCell>
                        <TableCell className={`${cell} ${r.stage_done ? '' : st.cls}`}>
                          {st.text}
                          {heldByOther && !r.stage_done && !r.skipped && <div className="text-[9px] text-slate-500 no-underline">{heldByOther} đang làm</div>}
                        </TableCell>
                      </>)}
                    </>)}

                    <TableCell className={cell}>
                      <span className="font-semibold tabular-nums">{nf(r.n_pallets)}</span> <span className="text-slate-400">pallet</span>
                      <span className="text-[9px] text-slate-400"> · {r.material_codes?.filter(Boolean).join(', ') || '—'}</span>
                      {pickHint(r, boardTab) && <div className="text-[9px] text-slate-500 no-underline">{pickHint(r, boardTab)}</div>}
                      {/* Tên hàng: trong kho người ta gọi hàng theo TÊN, mã 9 số chỉ khớp được trên giấy */}
                      {r.material_name && <div className="text-[9px] text-slate-500 truncate no-underline">{r.material_name}</div>}
                      {/* Pallet lấy MỘT PHẦN: thủ kho phải biết lấy bao nhiêu thùng (đọc theo THÙNG + lẻ, không in base thô) */}
                      {tab === 'SCAN' && r.is_partial && !r.stage_done && (
                        <div className="text-[9px] font-semibold text-amber-700 no-underline">
                          lấy {qtyLabel(r.qty_base, r)} — một phần pallet, phần còn lại để lại
                        </div>
                      )}
                      <div className="mt-0.5"><StockButtons r={r} onPick={setInvMat} /></div>
                    </TableCell>

                    <TableCell className={cell}>
                      {r.kind === 'FILL'
                        ? <span className="font-mono">{r.to_code ?? <span className="text-slate-300 font-sans">—</span>}</span>
                        : tab === 'LOWER'
                          ? (r.drop_name ?? r.to_name ?? <span className="text-slate-300">—</span>)
                          : (r.to_name ?? r.to_code ?? <span className="text-slate-300">—</span>)}
                      {r.kind === 'LOOSE_FEED' && <span className="ml-1 text-[9px] text-purple-600">nhặt lẻ</span>}
                      {r.kind === 'FILL' && <span className="ml-1 text-[9px] text-sky-600">ô nhặt lẻ</span>}
                      {/* Hai bước, hai người: xe nâng ✓ = pallet về vị trí nhặt lẻ; thủ kho "Check nhặt lẻ" ở dòng hàng = trừ tồn */}
                      {tab === 'SCAN' && looseLinkOf(r) && (
                        <Link to={looseLinkOf(r)!} onClick={e => { e.stopPropagation(); anchorDirected() }}
                          className="block text-[9px] text-purple-700 no-underline hover:underline">
                          Trừ tồn nhặt lẻ ›
                        </Link>
                      )}
                      {tab === 'SCAN' && routeLinkOf(r) && (
                        <Link to={routeLinkOf(r)!} onClick={e => { e.stopPropagation(); anchorDirected() }}
                          className="block text-[9px] text-sky-700 no-underline hover:underline">
                          Tối ưu tuyến ›
                        </Link>
                      )}
                    </TableCell>

                    {(
                      <TableCell className={`px-2 py-1 whitespace-nowrap sticky right-0 z-10 border-l border-slate-200 ${first ? 'bg-sky-50' : 'bg-white'}`}>
                        <div className="flex items-center gap-1">
                          {/* KÍNH LÚP — như nút "Xem tồn kho" bên Xuất: soi tem pallet ghim · NSX · %Date · hồ sơ chuyến */}
                          {r.kind === 'FILL' ? (
                            <Link to={`/wms/fill/orders/${r.fill_order_id}`} onClick={e => { e.stopPropagation(); anchorDirected() }}
                              title="Mở lệnh fill chứa dòng này (đổi vị trí đến, giao người, huỷ dòng)"
                              className="flex items-center justify-center h-7 w-7 rounded text-slate-400 hover:text-sky-600 hover:bg-sky-50 no-underline">
                              <ExternalLink className="h-4 w-4" />
                            </Link>
                          ) : (
                          <button type="button" onClick={e => { e.stopPropagation(); setDetailKey(r.group_key) }}
                            title="Soi chi tiết việc: tem pallet gợi ý, NSX, %Date từng pallet, hồ sơ chuyến"
                            className="flex items-center justify-center h-7 w-7 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 no-underline">
                            <Search className="h-4 w-4" />
                          </button>
                          )}
                          {actions.map(a => (
                            <Button key={a.key} size="sm" variant={a.primary ? 'default' : 'outline'}
                              className={`h-7 px-2 text-[10px] ${a.muted ? 'opacity-70' : ''}`} disabled={busy}
                              title={ACTION_TIP[a.key]}
                              onClick={e => { e.stopPropagation(); a.onClick() }}>
                              <a.icon className="h-3.5 w-3.5 mr-0.5" /> {a.label}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>
        </div>

        <div className="shrink-0 border-t bg-white px-3 py-1.5 text-[10px] text-slate-500 flex items-center gap-3 flex-wrap sm:rounded-b-xl">
          <span>{nf(rows.length)} dòng việc</span>
          {(t.pending ?? 0) > 0 && <span className="text-slate-400">· còn {nf(t.pending ?? 0)} việc chưa xong</span>}
          {(t.skipped ?? 0) > 0 && <span className="text-slate-400">· {nf(t.skipped ?? 0)} việc hệ thống đã huỷ (quét pallet khác / kế hoạch đổi)</span>}
          {confirmTasks.isError && <span className="text-red-600">· {apiErr(confirmTasks.error) ?? 'Không ghi được — thử lại'}</span>}
          {claimTasks.isError && <span className="text-red-600">· {apiErr(claimTasks.error) ?? 'Không nhận được — thử lại'}</span>}
          {claimTasks.data && claimTasks.data.changed === 0 && claimTasks.data.held_by && (
            <span className="text-amber-700">· {claimTasks.data.held_by} vừa nhận việc này trước bạn</span>
          )}
          {confirmTasks.data?.moved_pallets
            ? <span className="text-green-600">· {lastRestore ? `đã ghi lại ${confirmTasks.data.moved_pallets} pallet về ô cũ` : `đã chuyển ${confirmTasks.data.moved_pallets} pallet về vị trí nhặt lẻ`}</span>
            : null}
        </div>
        </>)}
      </div>

      {scanOpen && scanGdo && <GdoScanSheet gdo={scanGdo} mode="outbound" onClose={() => setScanOpen(false)} />}
      {/* Quét dòng fill NGAY TẠI ĐÂY — cùng màn quét của trang lệnh fill, không viết luồng quét thứ hai */}
      {fillScan && f.warehouseId && (
        <FillScanOverlay warehouseId={f.warehouseId} orderId={fillScan} open canAssign={canFillAssign}
          onClose={() => setFillScan(null)} />
      )}
      {detailRow && (
        <TaskDetailSheet row={detailRow} tab={boardTab} trip={tripOf.get(detailRow.gdo_id)} bands={pctBands}
          canOpenTrip={canOpenTrip} looseLink={looseLinkOf(detailRow)} busy={busy}
          actions={actionsFor(detailRow, boardTab, me, canConfirm, fire, canFill).actions}
          onStock={setInvMat} onClose={() => setDetailKey(null)} />
      )}
      {/* HỎI MỘT CÂU khi bỏ dấu ✓ của việc nhặt lẻ — dialog giữa màn chỉ để xác nhận nhỏ (chuẩn UI) */}
      <Dialog open={!!undoAsk} onOpenChange={v => { if (!v) setUndoAsk(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Bỏ dấu ✓ việc nhặt lẻ</DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Sổ tồn đang ghi {undoAsk ? nf(undoAsk.r.n_pallets) : 0} pallet
              {undoAsk?.r.pallet_codes?.filter(Boolean).length ? <> (<span className="font-mono">{undoAsk.r.pallet_codes.filter(Boolean).slice(0, 2).join(', ')}{undoAsk.r.pallet_codes.filter(Boolean).length > 2 ? '…' : ''}</span>)</> : null}
              {' '}ở <b>{undoAsk?.r.to_name ?? undoAsk?.r.to_code ?? 'vị trí nhặt lẻ'}</b>. Hàng đã được đưa xuống đó chưa?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1">
            <Button variant="outline" className="h-11 justify-start text-left whitespace-normal" disabled={busy} onClick={() => runUndo(true)}>
              <Undo2 className="h-4 w-4 mr-2 shrink-0" />
              <span><b>Chưa</b> — ghi lại pallet về ô cũ <span className="font-mono">{undoAsk?.r.from_code ?? ''}</span> và bỏ dấu</span>
            </Button>
            <Button className="h-11 justify-start text-left whitespace-normal" disabled={busy} onClick={() => runUndo(false)}>
              <Check className="h-4 w-4 mr-2 shrink-0" />
              <span><b>Rồi</b> — hàng đang nằm ở đó, chỉ bỏ dấu ✓</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Khai quy định date TẠI CHỖ — cùng màn với trang chuyến / Nhặt lẻ / Quy định date */}
      <SetDateRuleSheet open={dateOpen} onClose={() => setDateOpen(false)} targets={dateTargets} warehouseId={f.warehouseId || null} />
      {invMat && (
        <MaterialStockDialog materialId={invMat.id} materialCode={invMat.code}
          materialName={rows.find(r => r.materials?.some(m => m.id === invMat.id))?.material_name ?? ''}
          mat={invMat.mat} warehouseId={f.warehouseId || undefined} onClose={() => setInvMat(null)} />
      )}
    </div>
  )
}
