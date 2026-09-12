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
import { Link, useSearchParams } from 'react-router-dom'
import { ListChecks, ArrowDownToLine, Truck, Check, Hand, Undo2, Inbox, ChevronRight, Boxes } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { useDirectedBoard, useConfirmTasks, useClaimTasks, useGDO, useWorkInbox, useDirectedSupervision } from '@/api/hooks'
import { GdoScanSheet } from '@/components/wms/GdoScanSheet'
import { MaterialStockDialog } from '@/components/wms/MaterialStockDialog'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampTime } from '@/utils/formatters'
import { qtyLabel } from '@/utils/qtyUnits'
import type { DirectedRow, WorkInbox, WorkInboxRow, DirectedSupervision } from '@/types'

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

// Cột theo TAB: xe hạ và xe chuyển cần thông tin khác nhau, đừng nhồi một bảng cho cả hai
const COLS: Record<Tab, { id: string; label: string; w: number; align?: 'right' }[]> = {
  INBOX: [],
  LOWER: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'trip', label: 'Chuyến · Cửa',   w: 150 },
    { id: 'loc',  label: 'Vị trí',         w: 150 },
    { id: 'lvl',  label: 'Tầng',           w: 52,  align: 'right' },
    { id: 'qty',  label: 'Hạ',             w: 150 },
    { id: 'dist', label: 'Quãng đường',    w: 90,  align: 'right' },
    { id: 'to',   label: 'Đặt xuống',      w: 140 },
    { id: 'act',  label: '',               w: 190 },   // Nhận + Xong (+ Bỏ nhận) đứng cạnh nhau
  ],
  MOVE: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'trip', label: 'Chuyến · Cửa',   w: 150 },
    { id: 'cur',  label: 'Vị trí hiện tại', w: 160 },
    { id: 'st',   label: 'Trạng thái',     w: 130 },
    { id: 'qty',  label: 'Đưa',            w: 150 },
    { id: 'to',   label: 'Tới',            w: 140 },
    { id: 'act',  label: '',               w: 190 },
  ],
  SCAN: [
    { id: 'seq',  label: 'STT',            w: 46,  align: 'right' },
    { id: 'pal',  label: 'Tem pallet',     w: 190 },
    { id: 'cur',  label: 'Vị trí hiện tại', w: 160 },
    { id: 'st',   label: 'Trạng thái',     w: 150 },
    { id: 'qty',  label: 'Lấy',            w: 150 },
    { id: 'to',   label: 'Tới',            w: 140 },
  ],
}

// Việc BỊ BỎ phải nói lý do (12/09): xe hạ đã hạ pallet xuống rồi mà việc lặng lẽ biến mất thì không
// ai biết vì sao hàng mình vừa hạ không còn được nhắc. Dòng này gạch xám, không STT, không nút.
const SKIP_LABEL: Record<string, string> = {
  OTHER_PALLET: 'bỏ — thủ kho đã lấy pallet khác',
  PALLET_TAKEN: 'bỏ — chuyến khác đã lấy pallet này',
  DATE_RULE_CHANGED: 'bỏ — quy định date đã đổi, đã sắp lại',
  PLAN_CHANGED: 'bỏ — kế hoạch đổi',
}

/** Trạng thái một dòng — chữ ngắn, đọc lướt được trên PDA. */
function stateOf(r: DirectedRow, tab: BoardTab): { text: string; cls: string } {
  if (r.skipped) return { text: SKIP_LABEL[r.skip_reason ?? ''] ?? `bỏ — ${r.skip_reason ?? 'kế hoạch đổi'}`, cls: 'text-slate-400' }
  if (r.all_scanned) return { text: `✓ quét đủ${r.last_at ? ` ${formatTimestampTime(r.last_at)}` : ''}`, cls: 'text-green-600' }
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
          onClick={() => onPick({ id: m.id, code: m.code ?? '', mat: list.length === 1 ? r : null })}
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

// Mọi nút của một dòng — dùng CHUNG cho bảng (PC) và thẻ (PDA) để hai màn không kể hai câu chuyện khác nhau.
type RowAction = { key: string; label: string; icon: typeof Check; primary?: boolean; muted?: boolean; onClick: () => void }
function actionsFor(
  r: DirectedRow, tab: BoardTab, me: string | null, canConfirm: boolean,
  fire: { confirm: (r: DirectedRow, stage: 'LOWER' | 'MOVE' | 'BOTH', undo: boolean) => void; claim: (r: DirectedRow, undo: boolean) => void },
): { actions: RowAction[]; heldByOther: string | null } {
  const heldByOther = r.claim_active && r.claimed_by && r.claimed_by !== me ? (r.claimed_by_name ?? 'người khác') : null
  if (tab === 'SCAN' || !canConfirm || r.skipped || r.all_scanned) return { actions: [], heldByOther }
  if (r.stage_done) {
    const stage = r.combined_lower ? 'BOTH' : tab
    return { actions: [{ key: 'undo', label: 'Bỏ', icon: Undo2, onClick: () => fire.confirm(r, stage, true) }], heldByOther }
  }
  if (!r.can_confirm) return { actions: [], heldByOther }
  const actions: RowAction[] = []
  const mine = r.claim_active && r.claimed_by === me
  // Việc CHUNG: nhận trước rồi làm. Người khác đang cầm thì vẫn cho ✓ Xong (chỉ đường, không phải rào) nhưng lùi xuống.
  if (!mine && !heldByOther) actions.push({ key: 'claim', label: 'Nhận', icon: Hand, primary: true, onClick: () => fire.claim(r, false) })
  actions.push({
    key: 'done', label: r.combined_lower ? 'Hạ & đưa ra' : 'Xong', icon: Check,
    primary: mine || !!heldByOther, muted: !!heldByOther,
    onClick: () => fire.confirm(r, r.combined_lower ? 'BOTH' : tab, false),
  })
  if (mine) actions.push({ key: 'unclaim', label: 'Bỏ nhận', icon: Undo2, onClick: () => fire.claim(r, true) })
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
  return r.link
    ? <Link to={r.link} className={`${cls} hover:border-sky-300 hover:bg-sky-50 active:bg-sky-100`}>{body}</Link>
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
                  <td className={`${td} font-mono font-semibold`}>{l.license_plate ?? l.group_code}</td>
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
      <span className={`min-w-0 break-words ${big ? 'text-base' : 'text-sm'}`}>{children}</span>
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
  // Băng "chưa khai quy định date" là VIỆC của người có quyền chốt — xe nâng chỉ cần biết dòng đó
  // đang chờ người khác, không cần lời hướng dẫn họ không làm được.
  const canSetDate = can(perms, 'outbound', 'set_date')
  const { data: whs } = useScopedWarehouses(true)
  // Phạm vi chỉ có MỘT kho ⇒ tự chọn, không bắt bấm "Chọn kho…" mỗi lần mở (lái xe nâng thường 1 kho)
  useEffect(() => {
    if (!f.warehouseId && whs?.length === 1) setF({ warehouseId: (whs[0] as { id: string }).id })
  }, [whs, f.warehouseId, setF])
  // Chuông "được giao xe nâng" và các dòng Hộp việc trỏ tới đây kèm ?trip= / ?tab= — mở đúng chuyến, đúng bảng.
  // ⚠ ÁP ĐÚNG MỘT LẦN CHO MỖI ĐƯỜNG DẪN. Bản đầu so `t !== f.tab` rồi ghi đè: vào trang bằng link có
  // `?tab=` thì mỗi lần người dùng bấm tab khác, f.tab đổi ⇒ effect chạy lại ⇒ kéo NGƯỢC về tab của
  // đường dẫn ⇒ "bấm một tab rồi tab khác không chọn được nữa" (user báo 12/09). Nhớ giá trị tham số
  // ĐÃ ÁP: đổi link mới áp lại, còn bấm tab là quyền của người dùng.
  const [sp] = useSearchParams()
  const appliedLink = useRef<string | null>(null)
  useEffect(() => {
    const t = sp.get('tab'), trip = sp.get('trip')
    const key = `${t ?? ''}|${trip ?? ''}`
    if (appliedLink.current === key) return
    appliedLink.current = key
    if (trip) setF({ gdoId: trip })
    if (t && ['INBOX', 'LOWER', 'MOVE', 'SCAN'].includes(t)) setF({ tab: t as Tab })
  }, [sp, setF])

  const tab = (f.tab as Tab) ?? 'INBOX'
  const boardTab: BoardTab = tab === 'INBOX' ? 'MOVE' : tab
  const { widths: colW, startResize, totalWidth } = useColumnResize(`directed_${tab.toLowerCase()}_col_widths`, COLS[tab].map(c => c.w))

  const confirmTasks = useConfirmTasks()
  const claimTasks = useClaimTasks()
  const { data, isLoading } = useDirectedBoard(f.warehouseId, boardTab, {
    enabled: tab !== 'INBOX',
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

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    return f.hideDone ? all.filter(r => !r.stage_done && !r.skipped) : all
  }, [data, f.hideDone])

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
  // Tra tồn kho + vị trí của mã ngay trên dòng việc — cùng dialog với trang Chuẩn bị hàng
  const [invMat, setInvMat] = useState<PickedMat | null>(null)
  const { data: scanGdo } = useGDO(tab === 'SCAN' && canScan && f.gdoId ? f.gdoId : undefined)

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
    ? ` Mở chuyến rồi bấm “Quy định date” để hệ thống chia hàng: `
      + unsetNow.slice(0, 4).map(u => `${u.group_code ?? ''} · ${u.material_code ?? ''}`).join(' · ')
      + (unsetNow.length > 4 ? ` … và ${unsetNow.length - 4} dòng nữa` : '')
    : ''

  const busy = confirmTasks.isPending || claimTasks.isPending
  const fire = {
    confirm: (r: DirectedRow, stage: 'LOWER' | 'MOVE' | 'BOTH', undo: boolean) => confirmTasks.mutate({ task_ids: r.task_ids, stage, undo }),
    claim:   (r: DirectedRow, undo: boolean) => claimTasks.mutate({ task_ids: r.task_ids, undo }),
  }
  // Số việc CỦA TÔI lên nhãn tab — mở trang là biết còn bao nhiêu, không cần vào tab
  const mineCount = inbox.data?.counts?.mine ?? 0
  const apiErr = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  const emptyReason = !f.warehouseId ? 'Chọn kho để xem việc cần làm'
    : (tab === 'SCAN' && !f.gdoId) ? 'Chọn chuyến để xem thứ tự quét' : null

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
                  {x.key === 'INBOX' && mineCount > 0 && (
                    <span className={`ml-0.5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${tab === 'INBOX' ? 'bg-white/25 text-white' : 'bg-red-500 text-white'}`}>{mineCount}</span>
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

        {tab !== 'INBOX' && (<>
        <SummaryBand tiles={[
          { label: 'Việc còn lại', value: nf(t.pending ?? 0), accent: (t.pending ?? 0) > 0 },
          { label: 'Chờ hạ',       value: nf(t.to_lower ?? 0) },
          { label: 'Chờ đưa ra',   value: nf(t.to_move ?? 0) },
          { label: 'Đã xong',      value: nf(t.done ?? 0) },
          { label: 'Chuyến',       value: nf(t.trips ?? 0) },
        ]} />

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
          <div className={`shrink-0 border-b px-3 py-1.5 text-[11px] truncate sm:whitespace-normal ${
            unsetNow.length ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-500'}`}>
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
            {!isLoading && emptyReason && <div className="py-6 text-center text-[11px] text-slate-400">{emptyReason}</div>}
            {!isLoading && !emptyReason && rows.length === 0 && (
              <div className="py-6 text-center text-[11px] text-slate-400">
                <div>Không có việc nào cho kho này.</div>
                <div className="mt-1 text-slate-500">Kiểm: kho bật <b>Hướng dẫn</b> chưa · chuyến đã <b>Bắt đầu</b> chưa · dòng hàng đã <b>khai quy định date</b> chưa.</div>
              </div>
            )}
            {rows.map(r => {
              const st = stateOf(r, boardTab)
              const first = r.group_key === nextKey
              const closed = r.stage_done || r.skipped
              const { actions, heldByOther } = actionsFor(r, boardTab, me, canConfirm, fire)
              const ord = ordOf.get(r.group_key)
              const dest = tab === 'LOWER' ? (r.drop_name ?? r.to_name) : (r.to_name ?? r.to_code)
              const where = tab === 'LOWER' ? r.from_code : r.current_code
              return (
                <div key={r.group_key}
                  className={`rounded-xl border p-3 space-y-1.5 ${closed ? 'border-slate-200 bg-slate-50 text-slate-400' : first ? 'border-sky-400 bg-sky-50 shadow-sm' : heldByOther ? 'border-slate-200 bg-white opacity-70' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className={`font-semibold uppercase tracking-wide ${first ? 'text-sky-700' : closed ? 'text-slate-400' : 'text-slate-500'}`}>
                      {r.skipped ? 'Đã bỏ' : r.stage_done ? 'Đã xong' : first ? 'Việc kế tiếp' : `#${ord ?? ''}`}
                    </span>
                    <span className="truncate text-slate-500">
                      {tab === 'SCAN' ? null : <>{r.license_plate ?? r.group_code ?? '—'}{r.dock_name ? ` · ${r.dock_name}` : ''}</>}
                      {isOldTrip(r.delivery_date) && <span className="text-amber-600"> · chuyến {formatDate(r.delivery_date!)}</span>}
                    </span>
                  </div>
                  {tab === 'SCAN' && (
                    <Step label="Tem" big={first}><span className={`font-mono font-semibold ${closed ? 'line-through' : ''}`}>{r.pallet_codes?.[0] ?? '—'}</span></Step>
                  )}
                  <Step label={tab === 'SCAN' ? 'Ở' : 'Đi tới'} big={first}>
                    <span className={`font-mono font-semibold ${closed ? 'line-through' : ''}`}>{where ?? <span className="text-slate-300 font-sans font-normal">chưa có trên bản vẽ</span>}</span>
                    {r.level_no != null && r.level_no > 1 && <span className="text-xs text-slate-500"> · tầng {r.level_no}</span>}
                    {tab === 'LOWER' && r.dist_cells != null && <span className="text-xs text-slate-400"> · {nf(r.dist_cells)} ô</span>}
                  </Step>
                  <Step label={tab === 'LOWER' ? 'Hạ' : tab === 'MOVE' ? 'Đưa' : 'Lấy'} big={first}>
                    <span className="font-semibold tabular-nums">{nf(r.n_pallets)}</span> <span className="text-slate-500">pallet</span>
                    <span className="text-xs text-slate-500"> · {r.material_codes?.filter(Boolean).join(', ') || '—'}</span>
                    {tab === 'SCAN' && r.is_partial && !r.stage_done && (
                      <div className="text-xs font-semibold text-amber-700">lấy {qtyLabel(r.qty_base, r)} — một phần pallet</div>
                    )}
                    <div className="mt-1"><StockButtons r={r} onPick={setInvMat} big /></div>
                  </Step>
                  <Step label={tab === 'LOWER' ? 'Đặt xuống' : 'Tới'} big={first}>
                    <span className="font-semibold">{dest ?? <span className="text-slate-300 font-normal">—</span>}</span>
                    {r.kind === 'LOOSE_FEED' && <span className="ml-1 text-xs text-purple-600">nhặt lẻ</span>}
                  </Step>
                  {/* "⏳ chờ xe hạ" là lời nói với XE CHUYỂN — trên thẻ của chính xe hạ thì đó là việc của họ, không phải chờ ai */}
                  {(closed || heldByOther || (tab === 'MOVE' && (r.waiting_lower || r.combined_lower))) && (
                    <div className={`text-xs ${st.cls}`}>
                      {closed ? st.text : heldByOther ? `${heldByOther} đang làm` : st.text}
                    </div>
                  )}
                  {actions.length > 0 && (
                    <div className="flex gap-2 pt-1">
                      {actions.map(a => (
                        <Button key={a.key} variant={a.primary ? 'default' : 'outline'} disabled={busy}
                          className={`${first ? 'h-11 text-sm' : 'h-9 text-xs'} ${a.primary ? 'flex-1' : 'px-3'} ${a.muted ? 'opacity-70' : ''}`}
                          onClick={a.onClick}>
                          <a.icon className="h-4 w-4 mr-1" /> {a.label}
                        </Button>
                      ))}
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
                  <TableHead key={c.id}
                    className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    <span onPointerDown={e => startResize(i, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={cols.length} className="px-2 py-6 text-center text-[11px] text-slate-400">Đang tải…</TableCell></TableRow>}
              {!isLoading && emptyReason && <TableRow><TableCell colSpan={cols.length} className="px-2 py-6 text-center text-[11px] text-slate-400">{emptyReason}</TableCell></TableRow>}
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
                const st = stateOf(r, boardTab)
                // Xong = GẠCH NGANG + xám, vẫn ở lại bảng (user chốt "phòng bị quên")
                const dim = (r.stage_done || r.skipped) ? 'text-slate-400 line-through' : ''
                const first = r.group_key === nextKey
                const { actions, heldByOther } = actionsFor(r, boardTab, me, canConfirm, fire)
                return (
                  <TableRow key={r.group_key} className={`${dim} ${first ? 'bg-sky-50' : ''}`}>
                    <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums sticky left-0 z-10 ${first ? 'bg-sky-50' : 'bg-white'}`}>
                      {/* Việc đã xong / đã bỏ không mang số thứ tự nữa — nó không còn nằm trong đường đi */}
                      {r.skipped
                        ? <span className="text-slate-300 no-underline">—</span>
                        : (ordOf.get(r.group_key) ?? <span className="text-slate-300 no-underline">✓</span>)}
                    </TableCell>

                    {tab !== 'SCAN' && (
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                        <div className="font-mono font-semibold">{r.license_plate ?? r.group_code ?? '—'}</div>
                        <div className="text-[9px] text-slate-400">
                          {r.dock_name ?? '—'}
                          {/* Chuyến của ngày khác nằm chung bảng thì phải nói rõ, kẻo tưởng việc hôm nay */}
                          {isOldTrip(r.delivery_date) && (
                            <span className="text-amber-600 no-underline"> · chuyến {formatDate(r.delivery_date!)}</span>
                          )}
                        </div>
                      </TableCell>
                    )}
                    {tab === 'SCAN' && (
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">
                        {r.pallet_codes?.[0] ?? '—'}
                      </TableCell>
                    )}

                    {tab === 'LOWER' ? (
                      <>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                          <div className="font-mono">{r.from_code ?? <span className="text-slate-300">chưa có trên bản vẽ</span>}</div>
                          {/* Ai hạ, lúc mấy giờ — người sau nhìn vào phải biết việc đã xong do ai (user chốt) */}
                          {(r.stage_done || r.skipped) && <div className={`text-[9px] no-underline ${r.skipped ? 'text-slate-400' : 'text-green-600'}`}>{st.text}</div>}
                          {heldByOther && !r.stage_done && <div className="text-[9px] text-slate-500 no-underline">{heldByOther} đang làm</div>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{r.level_no ?? '—'}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                          <span className="font-mono">{r.current_code ?? <span className="text-slate-300">chưa có trên bản vẽ</span>}</span>
                          {r.level_no != null && r.level_no > 1 && !r.stage_done && <span className="text-[9px] text-slate-400"> · tầng {r.level_no}</span>}
                        </TableCell>
                        <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap ${r.stage_done ? '' : st.cls}`}>
                          {st.text}
                          {heldByOther && !r.stage_done && !r.skipped && <div className="text-[9px] text-slate-500 no-underline">{heldByOther} đang làm</div>}
                        </TableCell>
                      </>
                    )}

                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      <span className="font-semibold tabular-nums">{nf(r.n_pallets)}</span> <span className="text-slate-400">pallet</span>
                      <span className="text-[9px] text-slate-400"> · {r.material_codes?.filter(Boolean).join(', ') || '—'}</span>
                      {/* Pallet lấy MỘT PHẦN: thủ kho phải biết lấy bao nhiêu thùng (đọc theo THÙNG + lẻ, không in base thô) */}
                      {tab === 'SCAN' && r.is_partial && !r.stage_done && (
                        <div className="text-[9px] font-semibold text-amber-700 no-underline">
                          lấy {qtyLabel(r.qty_base, r)} — một phần pallet, phần còn lại để lại
                        </div>
                      )}
                      <div className="mt-0.5"><StockButtons r={r} onPick={setInvMat} /></div>
                    </TableCell>

                    {tab === 'LOWER' && (
                      <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                        {r.dist_cells != null ? `${nf(r.dist_cells)} ô` : <span className="text-slate-300">—</span>}
                      </TableCell>
                    )}

                    <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                      {tab === 'LOWER'
                        ? (r.drop_name ?? r.to_name ?? <span className="text-slate-300">—</span>)
                        : (r.to_name ?? r.to_code ?? <span className="text-slate-300">—</span>)}
                      {r.kind === 'LOOSE_FEED' && <span className="ml-1 text-[9px] text-purple-600">nhặt lẻ</span>}
                    </TableCell>

                    {tab !== 'SCAN' && (
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {actions.map(a => (
                            <Button key={a.key} size="sm" variant={a.primary ? 'default' : 'outline'}
                              className={`h-7 px-2 text-[10px] ${a.muted ? 'opacity-70' : ''}`} disabled={busy}
                              title={a.key === 'undo' ? 'Bấm lại để bỏ đánh dấu (bấm nhầm)' : a.key === 'claim' ? 'Đánh dấu tôi đang làm việc này (tự nhả sau 10 phút)' : a.key === 'unclaim' ? 'Trả việc lại cho người khác' : 'Xác nhận đã làm xong việc này'}
                              onClick={a.onClick}>
                              <a.icon className="h-3.5 w-3.5 mr-0.5" /> {a.label}
                            </Button>
                          ))}
                          {actions.length === 0 && !r.stage_done && <span className="text-[9px] text-slate-300">—</span>}
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
          {(t.skipped ?? 0) > 0 && <span className="text-slate-400">· {nf(t.skipped ?? 0)} việc đã bỏ (quét pallet khác / kế hoạch đổi)</span>}
          {confirmTasks.isError && <span className="text-red-600">· {apiErr(confirmTasks.error) ?? 'Không ghi được — thử lại'}</span>}
          {claimTasks.isError && <span className="text-red-600">· {apiErr(claimTasks.error) ?? 'Không nhận được — thử lại'}</span>}
          {claimTasks.data && claimTasks.data.changed === 0 && claimTasks.data.held_by && (
            <span className="text-amber-700">· {claimTasks.data.held_by} vừa nhận việc này trước bạn</span>
          )}
          {confirmTasks.data?.moved_pallets ? <span className="text-green-600">· đã chuyển {confirmTasks.data.moved_pallets} pallet về vị trí nhặt lẻ</span> : null}
        </div>
        </>)}
      </div>

      {scanOpen && scanGdo && <GdoScanSheet gdo={scanGdo} mode="outbound" onClose={() => setScanOpen(false)} />}
      {invMat && (
        <MaterialStockDialog materialId={invMat.id} materialCode={invMat.code}
          materialName={rows.find(r => r.materials?.some(m => m.id === invMat.id))?.material_name ?? ''}
          mat={invMat.mat} warehouseId={f.warehouseId || undefined} onClose={() => setInvMat(null)} />
      )}
    </div>
  )
}
