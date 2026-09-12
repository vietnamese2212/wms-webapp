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
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ListChecks, ArrowDownToLine, Truck, Check, Hand, Undo2 } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { useDirectedBoard, useConfirmTasks, useClaimTasks, useGDO } from '@/api/hooks'
import { GdoScanSheet } from '@/components/wms/GdoScanSheet'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampTime } from '@/utils/formatters'
import { qtyLabel } from '@/utils/qtyUnits'
import type { DirectedRow } from '@/types'

const nf = (n: number) => n.toLocaleString('vi-VN')

type Tab = 'LOWER' | 'MOVE' | 'SCAN'
const TABS: { key: Tab; label: string; icon: typeof Truck; hint: string }[] = [
  { key: 'LOWER', label: 'Cần hạ',     icon: ArrowDownToLine, hint: 'Xe nâng hạ — toàn kho, làm từ trên xuống' },
  { key: 'MOVE',  label: 'Cần đưa ra', icon: Truck,           hint: 'Xe nâng chuyển — đưa hàng ra cửa / vị trí nhặt lẻ' },
  { key: 'SCAN',  label: 'Sắp quét',   icon: ScanIcon,        hint: 'Thủ kho — từng pallet theo thứ tự quét' },
]

// Cột theo TAB: xe hạ và xe chuyển cần thông tin khác nhau, đừng nhồi một bảng cho cả hai
const COLS: Record<Tab, { id: string; label: string; w: number; align?: 'right' }[]> = {
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
function stateOf(r: DirectedRow, tab: Tab): { text: string; cls: string } {
  if (r.skipped) return { text: SKIP_LABEL[r.skip_reason ?? ''] ?? `bỏ — ${r.skip_reason ?? 'kế hoạch đổi'}`, cls: 'text-slate-400' }
  if (r.all_scanned) return { text: `✓ quét đủ${r.last_at ? ` ${formatTimestampTime(r.last_at)}` : ''}`, cls: 'text-green-600' }
  if (r.stage_done) return {
    text: `✓ ${tab === 'LOWER' ? 'đã hạ' : 'đã đưa ra'}${r.last_at ? ` ${formatTimestampTime(r.last_at)}` : ''}${r.done_by_name ? ` · ${r.done_by_name}` : ''}`,
    cls: 'text-green-600',
  }
  if (r.combined_lower) return { text: 'trên kệ — hạ rồi đưa ra', cls: 'text-slate-600' }
  if (r.waiting_lower) return { text: '⏳ chờ xe hạ', cls: 'text-amber-600' }
  if (r.needs_lower) return { text: 'cần hạ xuống', cls: 'text-slate-500' }
  return { text: 'lấy trực tiếp', cls: 'text-slate-500' }
}

// Mọi nút của một dòng — dùng CHUNG cho bảng (PC) và thẻ (PDA) để hai màn không kể hai câu chuyện khác nhau.
type RowAction = { key: string; label: string; icon: typeof Check; primary?: boolean; muted?: boolean; onClick: () => void }
function actionsFor(
  r: DirectedRow, tab: Tab, me: string | null, canConfirm: boolean,
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
  const canScan = can(perms, 'outbound', 'scan')
  // Băng "chưa khai quy định date" là VIỆC của người có quyền chốt — xe nâng chỉ cần biết dòng đó
  // đang chờ người khác, không cần lời hướng dẫn họ không làm được.
  const canSetDate = can(perms, 'outbound', 'set_date')
  const { data: whs } = useScopedWarehouses(true)
  // Phạm vi chỉ có MỘT kho ⇒ tự chọn, không bắt bấm "Chọn kho…" mỗi lần mở (lái xe nâng thường 1 kho)
  useEffect(() => {
    if (!f.warehouseId && whs?.length === 1) setF({ warehouseId: (whs[0] as { id: string }).id })
  }, [whs, f.warehouseId, setF])
  // Chuông "được giao xe nâng" trỏ tới đây kèm ?trip= — mở đúng chuyến ở bảng Sắp quét
  const [sp] = useSearchParams()
  useEffect(() => {
    const trip = sp.get('trip')
    if (trip && trip !== f.gdoId) setF({ gdoId: trip })
  }, [sp, f.gdoId, setF])

  const tab = f.tab as Tab
  const { widths: colW, startResize, totalWidth } = useColumnResize(`directed_${tab.toLowerCase()}_col_widths`, COLS[tab].map(c => c.w))

  const confirmTasks = useConfirmTasks()
  const claimTasks = useClaimTasks()
  const { data, isLoading } = useDirectedBoard(f.warehouseId, tab, {
    gdoId: tab === 'SCAN' ? (f.gdoId || null) : null,
    // "Của tôi" chỉ có nghĩa ở bảng xe chuyển (việc gắn theo người được giao lúc Bắt đầu)
    driverId: tab === 'MOVE' && f.mine ? (me ?? null) : null,
  })
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
  const { data: scanGdo } = useGDO(tab === 'SCAN' && canScan && f.gdoId ? f.gdoId : undefined)

  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', pinned: true, allLabel: 'Chọn kho…',
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
    { key: 'done', label: 'Việc đã xong', type: 'single', allLabel: 'Hiện (mặc định — để đối chiếu)',
      options: [{ value: 'hide', label: 'Ẩn việc đã xong' }],
      value: f.hideDone ? 'hide' : '', onChange: (v: string) => setF({ hideDone: v === 'hide' }) },
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
            {/* Tab = 3 VAI. Để nút to trên mobile: người bấm đang đeo găng, đứng giữa kho */}
            <div className="flex items-center gap-1 flex-1 min-w-0">
              {tabs.map(x => (
                <button key={x.key} onClick={() => setF({ tab: x.key })} title={x.hint}
                  className={`flex items-center gap-1 rounded-md px-2.5 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${
                    tab === x.key ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  <x.icon className="h-3.5 w-3.5" /> {x.label}
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
            <span className="sm:hidden"><FilterSheetButton defs={filterDefs} /></span>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

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
              const st = stateOf(r, tab)
              const first = r.group_key === nextKey
              const closed = r.stage_done || r.skipped
              const { actions, heldByOther } = actionsFor(r, tab, me, canConfirm, fire)
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
                const st = stateOf(r, tab)
                // Xong = GẠCH NGANG + xám, vẫn ở lại bảng (user chốt "phòng bị quên")
                const dim = (r.stage_done || r.skipped) ? 'text-slate-400 line-through' : ''
                const first = r.group_key === nextKey
                const { actions, heldByOther } = actionsFor(r, tab, me, canConfirm, fire)
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
      </div>

      {scanOpen && scanGdo && <GdoScanSheet gdo={scanGdo} mode="outbound" onClose={() => setScanOpen(false)} />}
    </div>
  )
}
