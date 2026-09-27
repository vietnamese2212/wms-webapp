// BẢNG XEM ĐƠN của Điều vận (27/09 tối, user: "đưa về dạng table ở danh mục xem đơn — chỉ đơn chưa điều động mới có mặt
// ở đây; điều vận xác định đơn nào loại khỏi kế hoạch không điều cho hôm đó và các ngày sau, đơn nào loại khỏi kế hoạch của hôm
// đó. Đã điều · Không điều ngày đó · Không điều · Điều nằm ở các tab và chuyển trạng thái được. Kế hoạch chỉ lấy ở mục Điều"
// + "ZSD02 là dữ liệu cập nhật thêm — dữ liệu mới không có trong Đã điều thì mặc định là Điều").
//   • ĐIỀU — OD của đợt ghép: khung chờ + xe nháp. Máy ghép xe CHỈ từ tab này.
//   • KHÔNG ĐIỀU NGÀY NÀY — hoãn có ngày (mặc định ngày kế tiếp): tới ngày đó OD tự quay lại Điều.
//   • KHÔNG ĐIỀU — hoãn không ngày: không vào đợt ghép nào tới khi có người chuyển lại Điều.
//   • ĐÃ ĐIỀU — chỉ xem: xe đã xác nhận / đang chờ ĐVVT · đã có trong Kế hoạch xuất · SAP đã điều · đã xuất kho · nháp ngày khác.
// Dữ liệu là của CHÍNH kế hoạch (dòng OD) + `params.excluded` (OD bị bỏ ra, có kèm thông tin để in dòng) — không gọi thêm gì.
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
import { FloatingActionBar, FLOATING_BTN } from '@/components/shared/FloatingActionBar'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import { useHoldDispatchOds, useUnholdDispatchOds, useReoptimizeDispatchPlan, useDispatchPlanReview, type DispatchPlan, type DispatchOdFlag } from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'
import { whTypeBadgeCls } from '@/utils/cargoCategory'
import { QTY_CONVERTED_LABEL } from '@/utils/qtyUnits'
import { EDITABLE, tripStatus, FLAG_VI } from './dispatchIssues'
import { DispatchOdDetailSheet } from './DispatchOdDetailSheet'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')
const nextDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }

type St = 'GO' | 'DAY' | 'NEVER' | 'DONE'
type Tone = 'green' | 'amber' | 'slate' | 'red' | 'blue'
type Row = {
  key: string; od: string; ids: string[]; held: boolean; selectable: boolean
  where: string; tone: Tone; cust: string; ward: string; region: string
  pallets: number | null; tons: number | null; date: string; late: number; note: string; flag: string; until: string | null; reason: string
}
const EX_VI: Record<string, string> = { IN_PLAN: 'Đã có trong KH xuất', OTHER_DRAFT: 'Nằm ở nháp ngày khác', SAP_ASSIGNED: 'SAP đã điều', SHIPPED: 'Đã xuất kho' }
const TABS: { k: St; label: string; tip: string }[] = [
  { k: 'GO', label: 'Điều', tip: 'Đơn đi trong đợt ghép này — máy ghép xe CHỈ từ tab này. Đơn mới về ZSD02 mặc định nằm ở đây.' },
  { k: 'DAY', label: 'Không điều ngày này', tip: 'Loại khỏi kế hoạch của ngày này — tới ngày điều lại, đơn tự quay về Điều.' },
  { k: 'NEVER', label: 'Không điều', tip: 'Không điều cho ngày này và các ngày sau — tới khi có người chuyển lại Điều.' },
  { k: 'DONE', label: 'Đã điều', tip: 'Đơn đã được lo: xe đã xác nhận / chờ ĐVVT, đã có trong Kế hoạch xuất, SAP đã điều, đã xuất kho. Chỉ xem.' },
]

export function DispatchReviewTable({ plan, editable, flags, onGrouped }: {
  plan: DispatchPlan; editable: boolean; flags: Map<string, DispatchOdFlag>; onGrouped: () => void
}) {
  const f = useWmsFilterStore(s => s.dispatch)
  const setF = useWmsFilterStore(s => s.setDispatch)
  const st: St = (['GO', 'DAY', 'NEVER', 'DONE'] as const).find(x => x === f.reviewTab) ?? 'GO'
  const hold = useHoldDispatchOds(), unhold = useUnholdDispatchOds(), reopt = useReoptimizeDispatchPlan()
  const [ask, confirmNode] = useConfirmDialog()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [notesOnly, setNotesOnly] = useState(false)
  const [dlg, setDlg] = useState<null | 'DAY' | 'NEVER'>(null)
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  // thông tin SAP từng OD (SO · người tạo · ghi chú · SL quy đổi · Loại kho · OD bị thay · lần Không điều trước) — gọi riêng
  const review = useDispatchPlanReview(plan.id, plan.updated_at)
  const info = review.data?.ods ?? {}
  const whMeta = useWhTypeMetaMap()
  const [detail, setDetail] = useState<string | null>(null)   // key dòng đang mở panel chi tiết
  const busy = hold.isPending || unhold.isPending || reopt.isPending
  const err = (e: unknown, title: string) => toast({ variant: 'destructive', title, description: apiMsg(e) })

  const byTab = useMemo(() => {
    const out: Record<St, Row[]> = { GO: [], DAY: [], NEVER: [], DONE: [] }
    const agg = new Map<string, Row>()
    const add = (tab: St, key: string, r: Omit<Row, 'key'>) => {
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
    for (const o of plan.pool ?? []) add('GO', `GO|${o.od_number}`, {
      od: o.od_number, ids: [o.id], held: false, selectable: editable, where: 'Khung chờ', tone: 'amber',
      cust: o.ship_to_name ?? o.ship_to_code ?? '', ward: o.ward_code ?? '', region: o.region_name ?? o.region_code ?? '',
      pallets: o.pallets == null ? null : Number(o.pallets), tons: o.tons == null ? null : Number(o.tons), date: o.delivery_date ?? '', late: o.late_days ?? 0,
      note: o.note ?? '', flag: flagOf(o.od_number), until: null, reason: '',
    })
    // OD máy không đo được tải / không lên xe (hàng trả về, chiết khấu…) — nằm ở Điều để người thấy, nhưng không chọn được
    for (const u of plan.unplanned) if (!agg.has(`GO|${u.od_number}`)) add('GO', `GO|${u.od_number}`, {
      od: u.od_number, ids: [], held: false, selectable: false, where: 'Không lên xe', tone: 'red', cust: u.ship_to_code ?? '', ward: '', region: '',
      pallets: null, tons: null, date: '', late: 0, note: '', flag: u.reason, until: null, reason: '',
    })
    for (const x of plan.params.excluded ?? []) {
      const d = x.d
      const base = {
        od: x.od_number, ids: [], cust: d?.ship_to_name ?? d?.ship_to_code ?? '', ward: d?.ward_code ?? '', region: d?.region_name ?? d?.region_code ?? '',
        pallets: d?.pallets ?? null, tons: d?.tons ?? null, date: d?.delivery_date ?? '', late: 0, note: d?.note ?? '',
      }
      if (x.kind === 'HELD') {
        // bản cũ (trước 27/09 tối) không có `until` — đọc lại từ câu "hoãn tới …"
        const u = x.until !== undefined ? x.until : (x.info?.match(/hoãn tới (\d{4}-\d{2}-\d{2})/)?.[1] ?? null)
        const tab: St = u ? 'DAY' : 'NEVER'
        add(tab, `${tab}|${x.od_number}`, { ...base, held: true, selectable: editable, where: u ? `Điều lại từ ${dmy(u)}` : 'Không điều', tone: 'slate', flag: '', until: u, reason: x.reason ?? x.info ?? '' })
      } else {
        add('DONE', `DONE|${x.od_number}`, { ...base, held: false, selectable: false, where: EX_VI[x.kind] ?? x.kind, tone: 'green', flag: x.info ?? '', until: null, reason: '' })
      }
    }
    const cmp = (a: Row, b: Row) => Number(!a.ids.length && !a.held) - Number(!b.ids.length && !b.held) || a.region.localeCompare(b.region) || a.ward.localeCompare(b.ward) || a.cust.localeCompare(b.cust) || a.od.localeCompare(b.od)
    for (const k of Object.keys(out) as St[]) out[k].sort(cmp)
    return out
  }, [plan, flags, editable])

  const q = f.search.trim().toLowerCase()
  const extra = (od: string) => { const i = info[od]; return i ? [...i.so, ...i.created_by, i.note_invoice ?? '', i.route_name ?? '', ...i.categories] : [] }
  const rows = byTab[st].filter(r => (!notesOnly || !!r.note) && (!q || [r.od, r.cust, r.ward, r.region, r.where, r.note, r.flag, r.reason, ...extra(r.od)].some(v => v.toLowerCase().includes(q))))
  const detailRow = detail ? byTab[st].find(r => r.key === detail) ?? null : null
  const notesN = byTab[st].filter(r => !!r.note).length
  const pick = rows.filter(r => r.selectable)
  const selRows = byTab[st].filter(r => sel.has(r.key))
  const setTab = (k: St) => { setSel(new Set()); setNotesOnly(false); setF({ reviewTab: k }) }
  const toggle = (k: string) => setSel(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  const goOds = byTab.GO.filter(r => r.ids.length)
  const hasTrips = plan.trips.some(t => tripStatus(t) !== 'DISCARDED' && t.ods.length > 0)
  const poolIds = (plan.pool ?? []).map(o => o.id)
  const poolOds = new Set((plan.pool ?? []).map(o => o.od_number)).size

  // ── chuyển trạng thái ──
  const openDlg = (k: 'DAY' | 'NEVER') => { setUntil(nextDay(plan.plan_date)); setReason(''); setDlg(k) }
  // cửa ghi nhận ≤ 300 phần tử — "chọn cả tab" vài trăm đơn thì gửi theo lô (tuần tự: mỗi lượt giữ thuê kế hoạch)
  const lots = <T,>(a: T[]) => Array.from({ length: Math.ceil(a.length / 100) }, (_, i) => a.slice(i * 100, i * 100 + 100))
  const doHold = async () => {
    const u = dlg === 'DAY' ? until : null
    let n = 0
    try {
      for (const part of lots(selRows)) {
        const r = await hold.mutateAsync({ plan_id: plan.id, ids: part.filter(x => !x.held).flatMap(x => x.ids), od_numbers: part.filter(x => x.held).map(x => x.od), until: u, reason: reason.trim() || undefined })
        n += r.held.ods
      }
      setDlg(null); setSel(new Set())
      toast({ title: `${n} OD → ${u ? `Không điều ngày này (điều lại từ ${dmy(u)})` : 'Không điều'}`, description: 'Lần nạp OD mới / lập lại không đưa lại các OD này.' })
    } catch (e) { err(e, n ? `Đã chuyển ${n} OD, phần còn lại chưa chuyển được` : 'Không chuyển được trạng thái') }
  }
  const doGo = async () => {
    let n = 0, back = 0
    try {
      for (const part of lots(selRows)) {
        const r = await unhold.mutateAsync({ plan_id: plan.id, od_numbers: part.map(x => x.od) })
        n += r.unheld.ods; back += r.unheld.back_to_pool
      }
      setSel(new Set())
      toast({ title: `${n} OD → Điều`, description: back === n ? 'Đơn đã về khung chờ — máy ghép khi bấm Ghép xe.' : `${n - back} OD không quay lại (đã được lo ở chỗ khác hoặc không còn trong ZSD02).` })
    } catch (e) { err(e, n ? `Đã chuyển ${n} OD, phần còn lại chưa chuyển được` : 'Không chuyển được trạng thái') }
  }
  // ── ghép xe từ tab Điều ──
  const doGroup = async () => {
    const all = !hasTrips
    const n = all ? new Set(goOds.map(r => r.od)).size : poolOds
    if (await ask({ title: all ? `Ghép xe cho ${n} đơn Điều?` : `Ghép ${n} đơn đang ở khung chờ?`, confirmLabel: 'Ghép xe',
      body: all
        ? `Máy ghép xe cho MỌI đơn ở tab Điều (${nf(n)} OD). Đơn không đi: chuyển sang "Không điều ngày này" / "Không điều" TRƯỚC khi bấm — sau khi ghép vẫn chuyển được.`
        : `Máy dựng xe mới cho ${nf(n)} OD đang ở khung chờ. Các xe đang có giữ nguyên.` }) === null) return
    reopt.mutateAsync(all ? { id: plan.id, review_all: true } : { id: plan.id, ids: poolIds })
      .then(r => { toast({ title: `Đã ghép thành ${r.reoptimized.trips} xe`, description: r.reoptimized.left_in_pool ? `${r.reoptimized.left_in_pool} OD không xếp được — vẫn ở khung chờ.` : 'Soát thẻ xe ở Bàn ghép xe, rồi Xác nhận kế hoạch.' }); onGrouped() })
      .catch(e => err(e, 'Không ghép được'))
  }

  const cols: RtColDef[] = [
    ...(editable && st !== 'DONE' ? [{ id: 'sel', label: '', w: 34, align: 'center' as const }] : []),
    { id: 'od', label: 'OD', w: 104 },
    { id: 'where', label: st === 'GO' ? 'Đang ở' : st === 'DONE' ? 'Đã điều ở đâu' : 'Trạng thái', w: 150 },
    { id: 'so', label: 'SO / PO SAP', w: 110 },
    { id: 'cust', label: 'Khách', w: 220 },
    { id: 'ward', label: 'Phường', w: 140 },
    { id: 'region', label: 'Vùng', w: 110 },
    { id: 'cat', label: 'Loại kho', w: 96 },
    { id: 'conv', label: QTY_CONVERTED_LABEL, w: 84, align: 'right' },
    { id: 'pal', label: 'Pallet', w: 64, align: 'right' },
    { id: 'ton', label: 'Tấn', w: 64, align: 'right' },
    { id: 'date', label: 'Ngày giao', w: 96 },
    { id: 'by', label: 'Người tạo', w: 100 },
    { id: 'note', label: 'Ghi chú giao hàng SAP', w: 280 },
    { id: 'warn', label: 'Lưu ý', w: 220 },
    { id: 'info', label: st === 'DAY' || st === 'NEVER' ? 'Lý do' : 'Tình trạng SAP', w: 220 },
  ]
  // Lưu ý = thứ người xếp phải biết mà không nằm ở cột nào: OD này THAY OD cũ (sửa SO — OD cũ có thể đã điều ở xe khác) ·
  // đơn vừa hết "Không điều ngày này" quay lại
  const warnOf = (od: string) => {
    const i = info[od]
    if (!i) return ''
    return [
      ...i.replaces.map(r => r.group_code ? `Thay OD ${r.od} — OD cũ ĐÃ ĐIỀU ở xe ${r.group_code}` : `Thay OD ${r.od} (SAP sửa SO)`),
      ...(i.held_before && st === 'GO' ? [`Đã không điều tới ${dmy(i.held_before.until)} — ${i.held_before.reason}`] : []),
    ].join(' · ')
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="shrink-0 border-b bg-white px-3 py-1.5 space-y-1.5">
        {/* SWITCH trạng thái — cả lựa chọn lẫn SỐ của từng tab thấy ngay, không phải bấm thử (khuôn switch 17/09) */}
        {/* điện thoại: dải switch cuộn ngang riêng một hàng, nút Ghép xe xuống hàng dưới rộng hết màn (nút chính phải THẤY NGAY) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
        <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap min-w-0 [&>*]:shrink-0">
          {TABS.map(t => (
            <button key={t.k} type="button" title={t.tip} onClick={() => setTab(t.k)} aria-pressed={st === t.k}
              className={`flex items-center gap-1.5 rounded-md px-2.5 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${st === t.k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t.label}
              {/* Điều đếm ĐƠN ĐIỀU ĐƯỢC — OD "Không lên xe" (hàng trả về / chiết khấu) vẫn hiện cuối tab nhưng không cộng vào số */}
              <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${st === t.k ? 'bg-white/25 text-white' : 'bg-white text-slate-500'}`}>{nf(new Set((t.k === 'GO' ? goOds : byTab[t.k]).map(r => r.od)).size)}</span>
            </button>
          ))}
        </div>
          {editable && goOds.length > 0 && (!hasTrips || poolIds.length > 0) && (
            <Button size="sm" className="sm:ml-auto w-full sm:w-auto shrink-0 h-9 sm:h-7 text-[11px]" disabled={busy} onClick={() => void doGroup()}>
              {hasTrips ? <Sparkles className="h-3.5 w-3.5 mr-1" /> : <ListChecks className="h-3.5 w-3.5 mr-1" />}
              {reopt.isPending ? 'Đang ghép…' : hasTrips ? `Ghép ${nf(poolOds)} đơn ở khung chờ` : `Ghép xe ${nf(new Set(goOds.map(r => r.od)).size)} đơn Điều`}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <SearchInput value={f.search} onChange={v => setF({ search: v })} placeholder="Tìm OD, khách, phường, vùng, ghi chú…" className="flex-1 min-w-[160px] sm:max-w-sm" />
          {notesN > 0 && (
            <button type="button" onClick={() => setNotesOnly(v => !v)} aria-pressed={notesOnly}
              className={`inline-flex items-center gap-1 rounded-md px-2 h-9 sm:h-7 text-[11px] ${notesOnly ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-900 hover:bg-amber-100'}`}
              title="OD có ghi chú giao hàng từ SAP — đọc trước khi quyết (hẹn ngày khác, không nhận Chủ nhật, ghép xe riêng…)">
              <StickyNote className="h-3.5 w-3.5" /> {notesOnly ? 'Đang xem' : 'Chỉ'} {notesN} OD có ghi chú
            </button>
          )}
          {editable && pick.length > 0 && (
            <button type="button" className="text-[11px] text-sky-700 hover:underline whitespace-nowrap" title="Chỉ tick các đơn ĐANG HIỆN theo tìm kiếm / bộ lọc"
              onClick={() => setSel(pick.every(r => sel.has(r.key)) ? new Set() : new Set(pick.map(r => r.key)))}>
              {pick.every(r => sel.has(r.key)) ? 'Bỏ chọn' : `Chọn ${pick.length} đơn đang hiện`}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <ResizableTable key={`${st}|${editable}`} storageKey={`dispatch_review_cols_${st}_v2`} cols={cols}>
          <TableBody>
            {!rows.length && <TableEmptyRow colSpan={cols.length}>{q || notesOnly
              ? <>Không đơn nào khớp bộ lọc. <button type="button" className="underline text-sky-700" onClick={() => { setNotesOnly(false); setF({ search: '' }) }}>Xem cả {byTab[st].length} đơn</button></>
              : st === 'GO' ? 'Không còn đơn nào để điều cho ngày này.' : st === 'DONE' ? 'Chưa có đơn nào được điều.' : 'Không có đơn nào ở trạng thái này.'}</TableEmptyRow>}
            {rows.map(r => { const i = info[r.od]; const warn = warnOf(r.od); return (
              // bấm dòng = mở CHI TIẾT OD (user 27/09 khuya); chọn để chuyển trạng thái bằng ô tick
              <TableRow key={r.key} className={`cursor-pointer hover:bg-slate-50 ${sel.has(r.key) ? 'bg-sky-50' : ''}`} onClick={() => setDetail(r.key)}>
                {editable && st !== 'DONE' && (
                  <TableCell className={`${TD} sticky left-0 z-10 text-center ${sel.has(r.key) ? 'bg-sky-50' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
                    {r.selectable && <input type="checkbox" className="h-3.5 w-3.5 accent-sky-600" checked={sel.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Chọn ${r.od}`} />}
                  </TableCell>
                )}
                <TableCell className={`${TD} font-mono font-semibold ${editable && st !== 'DONE' ? '' : `sticky left-0 z-10 ${sel.has(r.key) ? 'bg-sky-50' : 'bg-white'}`}`}>{r.od}</TableCell>
                <TableCell className={TD}><StatusBadge tone={r.tone}>{r.where}</StatusBadge></TableCell>
                <TableCell className={`${TD} truncate font-mono`} title={i ? [i.so.join(', '), ...i.so_types].filter(Boolean).join(' · ') : ''}>{i?.so.length ? i.so.join(', ') : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate`} title={r.cust}>{r.cust || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate`} title={r.ward}>{r.ward || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate`} title={r.region}>{r.region || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={TD}>{i?.categories.length ? <span className="inline-flex gap-0.5">{i.categories.map(c => <span key={c} className={`rounded px-1 text-[9px] font-semibold ${whTypeBadgeCls(c, whMeta)}`}>{c}</span>)}</span> : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`} title={i ? `${i.lines} dòng · ${i.materials} mã — quy về thùng từng mã rồi cộng` : ''}>{i ? nf(i.qty_conv, 1) : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{nf(r.pallets, 1)}</TableCell>
                <TableCell className={`${TD} text-right tabular-nums`}>{nf(r.tons, 2)}</TableCell>
                <TableCell className={TD}>{r.date ? `${dmy(r.date)}/${r.date.slice(2, 4)}` : <span className="text-slate-300">—</span>}{r.late > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800">trễ {r.late}n</span>}</TableCell>
                <TableCell className={`${TD} truncate`} title={i?.created_by.join(', ')}>{i?.created_by.length ? i.created_by.join(', ') : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate ${r.note ? 'text-amber-900' : ''}`} title={[r.note, i?.note_invoice ? `Hoá đơn: ${i.note_invoice}` : ''].filter(Boolean).join('\n')}>
                  {r.note || <span className="text-slate-300">—</span>}{i?.note_invoice && <span className="ml-1 text-slate-500">· HĐ: {i.note_invoice}</span>}
                </TableCell>
                <TableCell className={`${TD} truncate ${i?.replaces.some(x => x.group_code) ? 'text-red-600 font-medium' : 'text-amber-800'}`} title={warn}>{warn || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className={`${TD} truncate ${r.flag && st === 'GO' ? 'text-red-600' : 'text-slate-500'}`} title={st === 'DAY' || st === 'NEVER' ? r.reason : r.flag}>
                  {(st === 'DAY' || st === 'NEVER' ? r.reason : r.flag) || <span className="text-slate-300">—</span>}
                </TableCell>
              </TableRow>
            ) })}
          </TableBody>
        </ResizableTable>
      </div>
      <ListFooter page={1} pageSize={Math.max(1, rows.length)} total={rows.length} unit="đơn" onPageSize={() => { }} options={[]}
        right={st === 'GO' ? 'Kế hoạch ghép xe chỉ lấy đơn ở tab Điều' : st === 'DONE' ? 'Chỉ xem — đã điều thì sửa ở tab Kế hoạch xuất / Mở lại kế hoạch' : 'Tick đơn rồi chuyển trạng thái ở thanh dưới'} />

      <FloatingActionBar count={selRows.length} unit="đơn đã chọn">
        {st !== 'GO' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={doGo}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />{unhold.isPending ? 'Đang chuyển…' : 'Điều'}</Button>}
        {st !== 'DAY' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => openDlg('DAY')}><CalendarClock className="h-3.5 w-3.5 mr-1" />Không điều ngày này</Button>}
        {st === 'DAY' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => openDlg('DAY')}><CalendarClock className="h-3.5 w-3.5 mr-1" />Đổi ngày điều lại</Button>}
        {st !== 'NEVER' && <Button size="sm" variant="outline" className={FLOATING_BTN} disabled={busy} onClick={() => openDlg('NEVER')}><Ban className="h-3.5 w-3.5 mr-1" />Không điều</Button>}
        <Button size="sm" variant="outline" className={FLOATING_BTN} onClick={() => setSel(new Set())}>Bỏ chọn</Button>
      </FloatingActionBar>

      <Dialog open={!!dlg} onOpenChange={o => { if (!o && !hold.isPending) setDlg(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">{dlg === 'DAY' ? 'Không điều ngày này' : 'Không điều'} — {selRows.length} đơn</DialogTitle></DialogHeader>
          <div className="space-y-2 text-xs">
            {dlg === 'DAY'
              ? <label className="block">Điều lại từ ngày <input type="date" className="ml-2 h-8 rounded border border-slate-300 px-2" value={until} min={nextDay(plan.plan_date)} onChange={e => setUntil(e.target.value)} /></label>
              : <p className="text-slate-500">Đơn không vào đợt ghép nào — kể cả các ngày sau — tới khi có người chuyển lại <b>Điều</b>.</p>}
            <label className="block">
              <span className="text-slate-600">Lý do (tuỳ chọn)</span>
              <textarea className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" rows={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="vd NPP hẹn giao 10/9 · hàng không đi" />
            </label>
            {selRows.some(r => !r.held && r.where.startsWith('Xe')) && <p className="text-[11px] text-amber-700">Có đơn đang nằm trên xe nháp — đơn rời xe, tải + cước của xe tính lại.</p>}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8" disabled={hold.isPending} onClick={() => setDlg(null)}>Huỷ</Button>
            <Button size="sm" className="h-8" disabled={hold.isPending || (dlg === 'DAY' && !until)} onClick={doHold}>{hold.isPending ? 'Đang lưu…' : 'Chuyển'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DispatchOdDetailSheet planId={plan.id} info={detailRow ? info[detailRow.od] : undefined} onClose={() => setDetail(null)}
        sum={detailRow ? { od: detailRow.od, where: detailRow.where, tone: detailRow.tone, cust: detailRow.cust, ward: detailRow.ward, region: detailRow.region, date: detailRow.date, late: detailRow.late, flag: detailRow.flag, reason: detailRow.reason } : null} />
      {confirmNode}
    </div>
  )
}
