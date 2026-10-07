// ĐIỀU VẬN — kế hoạch ghép chuyến NHÁP (đợt 2 TMS điều vận; user chốt 24/09/2026 "làm tiếp module 2"; plan mục 7).
//
// Một kho × một ngày giao: bấm "Lập kế hoạch" → máy ghép OD ZSD02 chưa xếp xe thành chuyến nháp (dòng xe con · ĐVVT theo
// phân tuyến/tỷ trọng · cước · % tải). Người sửa nháp ngay trên trang: đổi dòng xe / ĐVVT (cước tính lại sống), chuyển OD
// sang xe khác hoặc tách ra xe mới. "Xác nhận" = ghi vào Kế hoạch xuất y như upload tay → chuyến + lệnh VC tự sinh.
// MÁY ĐỀ XUẤT, NGƯỜI XÁC NHẬN. Bảng chuyến theo skill table-format; chi tiết một chuyến mở panel trượt phải (PC + điện thoại).
// VÒNG ĐỜI XE (24/09 chiều, user chốt "config: vận tải cần phản hồi hoặc không"): ĐVVT có cờ "Cần phản hồi khi chào chuyến"
// (form ĐVVT, Cài đặt TMS) ⇒ sau Xác nhận xe đứng CHỜ ĐVVT; điều vận ghi "ĐVVT nhận" / "ĐVVT từ chối" ngay trong panel xe;
// từ chối ⇒ đổi ĐVVT rồi "Chốt xe này". ĐVVT không cần phản hồi ⇒ vào Kế hoạch xuất ngay, đổi tay ở tab Kế hoạch xuất.
// 25/09 (user: "ghép xe cần một giao diện khác, rawdata nằm ở một tab, kéo thả OD cho trực quan" + "chỉ số phải hiện lên khi sửa"):
// Tab cạnh tiêu đề: Xem đơn · Bàn ghép xe · Bản đồ. 06/10: "Danh sách xe" GỘP vào Bàn ghép xe dạng bảng (dòng xe mang đủ cột; tick
// dòng xe ⇒ Gán ĐVVT · Đổi dòng xe trên thanh nổi của bàn). Dải chỉ số `DispatchKpiBar` + dải Soát đứng chung trên bàn.
// 07/10 (user: "Ở tab Xem đơn, nút là Xem đơn, tức là load lấy các đơn. Có nút tạo kế hoạch. Tab bàn ghép xe hiện kế hoạch để xem, sửa"):
// "Xem đơn" nạp đơn chưa đi vào CHỜ ĐIỀU (không dải tải, không ghép); tick đơn → "Tạo kế hoạch" (bảng Xem đơn) = chỉ đơn đã tick vào
// kế hoạch; bàn ghép xe chỉ vẽ phần THUỘC kế hoạch (`boardPlanOf`). "Lập lại" BỎ — nút xoá sạch xe dễ nhầm với "Tạo kế hoạch";
// làm lại từ đầu = Bỏ nháp rồi Xem đơn.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Trash2, Download, Waypoints, ArrowRightLeft, AlertTriangle, ThumbsUp, ThumbsDown, Send, LayoutGrid, ListChecks, RotateCcw, BarChart3, ChevronDown, ChevronUp, Map as MapIcon } from 'lucide-react'
import { DispatchMap } from '@/components/tms/DispatchMap'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { DispatchBoard } from '@/components/tms/DispatchBoard'
import { DispatchKpiBar, DispatchKpiInline } from '@/components/tms/DispatchKpiBar'
import { DispatchReviewTable } from '@/components/tms/DispatchReviewTable'
import { EDITABLE, tripStatus, ISSUES, issuesOf, needsWork, SOFT_FLAG_KINDS, boardPlanOf, planHoldsOrders, type IssueKey } from '@/components/tms/dispatchIssues'
import { useMobileTabs } from '@/hooks/useMobileSurface'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { InfoTip } from '@/components/shared/InfoTip'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import {
  useDispatchPlans, useDispatchPlan, useCreateDispatchPlan, useUpdateDispatchTrip, useMoveDispatchOd, useConfirmDispatchPlan, useDiscardDispatchPlan, useReopenDispatchPlan,
  useSettleDispatchTrip, useRespondDispatchTrip, useDispatchPlanSync, useRefreshDispatchPool,
  useVehicleModels, useTransportCompanies, useStorageConditions, conditionLabel,
  type DispatchPlan, type DispatchTrip, type DispatchTripStatus, type StorageConditionRow, type DispatchSegment, SEGMENT_VI,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampDate } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const vnd = (n: number | string | null | undefined) => (n == null ? '—' : `${Number(n).toLocaleString('vi-VN')} ₫`)
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'
const tomorrowVN = () => new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
type Tone = 'amber' | 'green' | 'slate' | 'blue' | 'red'
const STATUS_VI: Record<DispatchPlan['status'], { label: string; tone: Tone }> = {
  DRAFT: { label: 'Bản nháp', tone: 'amber' }, TENDERED: { label: 'Chờ ĐVVT phản hồi', tone: 'blue' }, CONFIRMED: { label: 'Đã xác nhận', tone: 'green' }, DISCARDED: { label: 'Đã bỏ', tone: 'slate' },
}
const TRIP_STATUS_VI: Record<DispatchTripStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Nháp', tone: 'amber' }, TENDERED: { label: 'Chờ ĐVVT', tone: 'blue' }, DECLINED: { label: 'ĐVVT từ chối', tone: 'red' },
  CONFIRMED: { label: 'Đã vào KH xuất', tone: 'green' }, DISCARDED: { label: 'Đã bỏ', tone: 'slate' },
}
// Luật "xe cần xử lý" nằm ở components/tms/dispatchIssues (dùng chung với bàn ghép xe — hai góc nhìn phải đếm như nhau)

function LoadCell({ t }: { t: DispatchTrip }) {
  const l = t.detail.load
  if (l.pct == null) return <span className="text-slate-300" title={t.detail.freight.reason ?? 'Không đo được tải'}>—</span>
  // 01/10: "vượt" = quá TRẦN dải tải của dòng xe cha (vd 105 %), không phải quá 100 %
  const mx = l.max_pct ?? 100
  const cls = t.oversize || l.pct > mx ? 'text-red-600 font-semibold' : t.underload ? 'text-red-600' : 'text-slate-700'
  return <span className={`tabular-nums ${cls}`} title={`${nf(l.used, 1)} / ${nf(l.cap, 1)} ${l.basis === 'TON' ? 'tấn' : 'pallet'} · dải ${l.underload_pct}–${mx}%`}>{nf(l.pct, 1)}%{t.underload && <span className="ml-1 text-[9px]">Non tải</span>}{!t.underload && l.pct > 100 && l.pct <= mx && <span className="ml-1 text-[9px] text-slate-500">dung sai</span>}</span>
}

export default function Dispatch() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canPlan = can(perms, 'dispatch', 'plan'), canConfirm = can(perms, 'dispatch', 'confirm'), canExport = can(perms, 'dispatch', 'export')
  // 03/10 đợt 2: gỡ / đổi số DO trên sổ Kế hoạch xuất từ bàn điều vận — người chốt kế hoạch hoặc người quản sổ KH xuất (BE requireAnyPerm cùng cặp)
  const canActKhvc = canConfirm || can(perms, 'external_khvc', 'delete')
  const f = useWmsFilterStore(s => s.dispatch)
  const setF = useWmsFilterStore(s => s.setDispatch)
  const day = f.planDate || tomorrowVN()

  const { data: warehouses = [] } = useScopedWarehouses(true)
  const whs = warehouses as { id: string; code?: string; name: string; dispatch_underload_pct?: number | string | null; dispatch_load_bands?: Record<string, { min: number; max: number }> | null }[]
  // 1 kho trong phạm vi → tự chọn
  useEffect(() => { if (!f.warehouseId && whs.length === 1) setF({ warehouseId: whs[0].id }) }, [whs, f.warehouseId, setF])

  // MẢNG (03/10 tối, user: "một kế hoạch tổng, mỗi người lo một mảng — Trung chuyển và Bán hàng, lên kế hoạch riêng cho hai mảng"):
  // cùng kho × ngày có hai kế hoạch; bàn làm việc theo mảng đang chọn (nhớ theo người), Xem đơn có tab Trung chuyển | Bán hàng
  const seg: DispatchSegment = f.segment === 'TRANSFER' ? 'TRANSFER' : 'SALES'
  const otherSeg: DispatchSegment = seg === 'TRANSFER' ? 'SALES' : 'TRANSFER'
  const plans = useDispatchPlans({ warehouse_id: f.warehouseId || undefined, date_from: day, date_to: day }, !!f.warehouseId)
  const planListAll = plans.data?.items ?? []
  const planList = planListAll.filter(p => (p.segment ?? 'SALES') === seg)
  const otherPlan = planListAll.filter(p => (p.segment ?? 'SALES') === otherSeg).find(p => p.status === 'DRAFT') ?? planListAll.find(p => (p.segment ?? 'SALES') === otherSeg && p.status !== 'DISCARDED') ?? null
  // NHÁP QUÁ NGÀY chưa xác nhận (03/10 tối — user: 283 đơn bị nháp 30/09 "giữ" mà không ai biết nháp của ai, cũng không thấy nút xoá):
  // băng cảnh báo trên mọi ngày của kho, kèm Mở / Bỏ nháp. Không tự huỷ.
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const oldPlansQ = useDispatchPlans({ warehouse_id: f.warehouseId || undefined, date_to: yesterday }, !!f.warehouseId)
  // 07/10: chỉ nháp còn GIỮ đơn (xe có đơn · khung chờ của kế hoạch) — bấm Xem đơn rồi không tạo kế hoạch thì nháp chỉ chứa Chờ điều,
  // không giữ đơn nào, không phải việc bị bỏ quên
  const stalePlans = (oldPlansQ.data?.items ?? []).filter(p => (p.status === 'DRAFT' || p.status === 'TENDERED') && p.plan_date < day && planHoldsOrders(p.summary))
  // kế hoạch đang mở: người chọn → bản nháp mới nhất → bản mới nhất CHƯA BỎ. 06/10 (user: "bên Trung chuyển không có multi select"):
  // nháp Trung chuyển đã Bỏ nháp mà trang vẫn lấy làm kế hoạch đang làm — nháp đã bỏ chỉ để xem nên mọi ô tick / nút Ghép xe biến mất.
  // Nay mảng chỉ còn nháp đã bỏ ⇒ "Chưa có kế hoạch" + Lập kế hoạch; muốn xem lại nháp đã bỏ thì bấm "Xem nháp đã bỏ".
  // 07/10 (C63): lúc "Xem đơn" đang chạy, server tạo dòng kế hoạch TRƯỚC rồi mới ghi đơn theo lô — realtime đưa nháp mới vào danh sách,
  // tự chọn nó là tải giữa chừng (Bàu Bàng: 1.500 / 2.457 đơn) và lần làm mới sau đó bị gộp vào lượt tải ấy. Đang nạp ⇒ giữ kế hoạch cũ;
  // nạp xong `loadOrders` đặt planId.
  const create = useCreateDispatchPlan()
  const lastPlanId = useRef<string | null>(null)
  const planId = useMemo(() => {
    if (create.isPending) return lastPlanId.current
    if (f.planId && planList.some(p => p.id === f.planId)) return f.planId
    return (planList.find(p => p.status === 'DRAFT') ?? planList.find(p => p.status !== 'DISCARDED'))?.id ?? null
  }, [f.planId, planList, create.isPending])
  useEffect(() => { lastPlanId.current = planId }, [planId])
  const lastDiscarded = planList.find(p => p.status === 'DISCARDED') ?? null
  const planQ = useDispatchPlan(planId)
  const plan = planQ.data ?? null
  // "Không liên quan" của CHÍNH người xem (03/10 tối): bảng Xem đơn gom các đơn Chờ điều đó vào tab riêng
  const hidden = useMemo(() => new Set(plan?.hidden ?? []), [plan?.hidden])
  // kế hoạch như bàn ghép xe thấy (07/10): khung chờ chỉ còn đơn THUỘC kế hoạch — đơn Chờ điều ở bảng Xem đơn
  const planView = useMemo(() => (plan ? boardPlanOf(plan) : null), [plan])
  const isDraft = plan?.status === 'DRAFT'
  const isOpen = plan?.status === 'DRAFT' || plan?.status === 'TENDERED'
  // Cờ SỐNG so với ZSD02 hiện tại (lũy tiến): OD bị SAP thay / bỏ / đã xuất / đã điều sau khi lập + số OD mới về
  const syncQ = useDispatchPlanSync(planId, !!isOpen)
  const flags = useMemo(() => new Map((syncQ.data?.flags ?? []).map(x => [x.od_number, x])), [syncQ.data])
  // OD MỚI về ZSD02 TỰ vào tab Điều, nhãn "Mới" (user chốt 28/09 — thay nút "Nạp OD mới"). Sync báo có OD mới (realtime khi
  // ZSD02 nạp) ⇒ người có quyền lập nạp ngay; mỗi tập OD thử một lần, lỗi (vd PLAN_BUSY khi người khác đang ghép) thì 15 s sau thử lại.
  const refresh = useRefreshDispatchPool()
  const tried = useRef('')
  const freshKey = syncQ.data?.new_ods ? `${planId}|${(syncQ.data.new_od_numbers ?? []).join(',')}|${syncQ.data.new_ods}` : ''
  useEffect(() => {
    if (!planId || !isOpen || !canPlan || !freshKey || tried.current === freshKey || refresh.isPending) return
    tried.current = freshKey
    refresh.mutateAsync(planId)
      .then(r => { if (r.refreshed.added) toast({ title: `${r.refreshed.added} OD mới vào Chờ điều`, description: 'Nhãn "Mới" ở tab Bán hàng / Trung chuyển của Xem đơn — tick rồi "Thêm vào kế hoạch" nếu cần đi ngày này.' }) })
      .catch(() => { setTimeout(() => { if (tried.current === freshKey) tried.current = '' }, 15_000) })
  }, [planId, isOpen, canPlan, freshKey, refresh])
  const ictx = useMemo(() => ({ flags }), [flags])
  const permTabs = useMemo(() => [
    // Xem đơn đứng ĐẦU (27/09 tối): bảng theo trạng thái Điều · Không điều ngày này · Không điều · Đã điều — thay tab "Dữ liệu OD"
    { key: 'review', label: 'Xem đơn', icon: ListChecks }, { key: 'board', label: 'Bàn ghép xe', icon: LayoutGrid },
    // Bản đồ (01/10, đợt 1 chỉ xem): ghim khách tô màu theo xe — toạ độ từ danh mục Khách hàng
    // 06/10: tab "Danh sách xe" GỘP vào Bàn ghép xe dạng bảng (user: "nếu phù hợp bạn làm") — dòng xe của bảng đã mang đủ cột của danh
    // sách; chọn nhiều xe (tick ô dòng xe) ⇒ "Gán ĐVVT · Đổi dòng xe" trên thanh nổi của bàn
    { key: 'map', label: 'Bản đồ', icon: MapIcon },
  ], [])
  const tabs = useMobileTabs('/tms/dispatch', permTabs, f.tab || 'review', (t: string) => setF({ tab: t }))
  const tab = tabs.some(t => t.key === f.tab) ? f.tab : (tabs[0]?.key ?? 'review')

  // 03/10: dòng xe ĐANG DÙNG TẠI KHO đang điều vận (kho cấu hình riêng thì bật/tắt + sức chứa theo kho)
  const { data: modelsRes } = useVehicleModels({ is_active: true, warehouse_id: f.warehouseId || undefined })
  const models = (modelsRes?.items ?? []).filter(m => m.parent)
  const { data: companiesRaw = [] } = useTransportCompanies(true, 'ĐVVT')
  const { data: conditions = [] } = useStorageConditions()
  const condBy = useMemo(() => new Map(conditions.map(c => [c.value, c])), [conditions])
  // cờ "cần phản hồi" đọc từ danh mục HIỆN TẠI (bản chụp trong detail lúc lập có thể cũ)
  const tenderBy = useMemo(() => new Map(companiesRaw.map(c => [c.id, c.tender_required === true])), [companiesRaw])
  const needsTender = (t: DispatchTrip) => t.transport_company_id ? (tenderBy.get(t.transport_company_id) ?? t.detail.carrier?.tender_required === true) : false

  const patchTrip = useUpdateDispatchTrip(), moveOd = useMoveDispatchOd(), confirm = useConfirmDispatchPlan(), discard = useDiscardDispatchPlan()
  const settle = useSettleDispatchTrip(), respond = useRespondDispatchTrip(), reopen = useReopenDispatchPlan()
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  // xe vừa tạo ở Xem đơn ("Tạo kế hoạch") — bàn ghép xe mở nhóm của chúng một lần rồi trả về [] (07/10)
  const [focusTrips, setFocusTrips] = useState<string[]>([])
  const openTrip = plan?.trips.find(t => t.id === openTripId) ?? null
  const [ask, confirmNode] = useConfirmDialog()

  const err =(e: unknown, title: string) => toast({ variant: 'destructive', title, description: apiMsg(e) })
  // XEM ĐƠN (07/10, user: "nút là Xem đơn, tức là load lấy các đơn"): nạp đơn chưa đi của kho × ngày × mảng vào CHỜ ĐIỀU — không hỏi dải
  // tải (hộp thoại dải đứng trước "Tạo kế hoạch"), không ghép xe nào. Đã có kế hoạch đang mở thì server trả lại đúng kế hoạch đó (`reuse`)
  // — xem đơn không bao giờ thay nháp người khác đang làm.
  const loadOrders = () => {
    if (!f.warehouseId) return
    create.mutateAsync({ warehouse_id: f.warehouseId, plan_date: day, segment: seg, reuse: true }).then(p => {
      setF({ planId: p.id, tab: 'review', reviewTab: 'GO' })
      toast({
        title: p.reused ? `Kế hoạch ${SEGMENT_VI[seg]} ngày ${formatDate(day)} đang mở — đã mở lại` : `${nf(p.summary.unreviewed_ods ?? p.summary.pool_ods ?? 0)} đơn chờ điều`,
        description: 'Tick đơn cần đi ngày này rồi bấm "Tạo kế hoạch" — đơn không tick ở lại Chờ điều.',
      })
    }).catch(e => err(e, 'Không nạp được đơn'))
  }
  const noTripYet = !!plan && !plan.trips.some(t => tripStatus(t) !== 'DISCARDED' && t.ods.length > 0)
  // kế hoạch chưa giữ đơn nào (chưa xe, khung chờ của kế hoạch trống) — bàn ghép xe nói "vào Xem đơn tick đơn", không vẽ bàn trống
  const planEmpty = noTripYet && !planView?.pool?.length
  const showReview = !!plan && tab === 'review'
  const tenderCount = plan ? plan.trips.filter(t => tripStatus(t) === 'DRAFT' && needsTender(t)).length : 0
  const doConfirm = async () => {
    if (!plan) return
    const n = plan.trips.filter(t => tripStatus(t) === 'DRAFT' && t.ods.length).length
    // NÓI RA việc chưa xử lý TRƯỚC khi ghi — xác nhận là bước không quay lại được (chuyến + lệnh VC
    // tự sinh ngay), mà xe thiếu ĐVVT / thiếu cước vẫn ghi được. Im lặng ở đây là để người bấm xong
    // mới phát hiện, lúc đó phải đi sửa ở tab Kế hoạch xuất.
    const open = plan.trips.filter(t => tripStatus(t) === 'DRAFT')
    const noCarrier = open.filter(t => !t.transport_company_id).length
    const noFreight = open.filter(t => t.freight_estimated == null).length
    // OD nằm ở HAI xe thì cửa Xác nhận trả 422 OD_SPLIT_ACROSS_TRIPS — nói TRƯỚC, đừng để bấm rồi
    // mới biết. Đo 24/09: engine tách OD vượt tải theo dòng hàng nên ca này xảy ra ở CẢ hai kho
    // (Ba Vì 1 OD, Bàu Bàng 4 OD) — tức gần như mọi kế hoạch đều vướng ngay lần xác nhận đầu.
    const odTrips = new Map<string, string[]>()
    for (const t of open) for (const od of new Set(t.ods.map(o => o.od_number))) odTrips.set(od, [...(odTrips.get(od) ?? []), t.group_code])
    const split = [...odTrips].filter(([, g]) => g.length > 1)
    const over = open.filter(t => t.ods.length && t.oversize).length
    // chỉ khung chờ CỦA kế hoạch (07/10) — đơn Chờ điều chưa từng vào kế hoạch, không phải "bị bỏ lại"
    const poolN = planView?.summary.pool_ods ?? 0
    // 03/10 tối: cờ "SAP đã post" / "SAP đã gắn xe" chỉ THAM CHIẾU — hỏi lại một lần, không chặn (người không đánh dấu Ngoài app là đã quyết điều)
    const hard = (od: string) => { const k = flags.get(od)?.kind; return !!k && !SOFT_FLAG_KINDS.has(k) }
    const flagged = open.filter(t => t.ods.some(o => hard(o.od_number)))
    const softOds = new Set(open.flatMap(t => t.ods.map(o => o.od_number)).filter(od => { const k = flags.get(od)?.kind; return !!k && SOFT_FLAG_KINDS.has(k) }))
    const warn = [noCarrier ? `${noCarrier} xe CHƯA CÓ ĐVVT` : '', noFreight ? `${noFreight} xe CHƯA CÓ CƯỚC` : '', over ? `${over} xe VƯỢT TẢI` : '', poolN ? `${poolN} OD trong kế hoạch còn ở KHUNG CHỜ, chưa lên xe (sẽ KHÔNG đi)` : '',
      softOds.size ? `${softOds.size} OD SAP báo ĐÃ POST / ĐÃ GẮN XE mà vẫn trên xe (đúng là đã đi thì về Xem đơn bấm "Ngoài app" trước)` : '']
      .filter(Boolean).join(' · ')
    // OD đã đổi ở SAP sau khi lập (thay / bỏ / sửa / đã vào KH xuất) ⇒ cửa Xác nhận trả 409 — nói TRƯỚC
    if (flagged.length) {
      await ask({
        title: `Chưa xác nhận được: ${flagged.length} xe có OD đã đổi ở SAP`, danger: true, cancelLabel: null,
        body: flagged.slice(0, 6).map(t => `• #${t.seq} ${t.group_code}: ${t.ods.filter(o => hard(o.od_number)).map(o => `${o.od_number} — ${flags.get(o.od_number)?.info ?? ''}`).join('; ')}`).join('\n') +
          `\n\nTrên Bàn ghép xe: OD "SAP đã sửa" có nút "Cập nhật theo SAP"; OD "SAP đã thay" có nút "Thay bằng OD mới"; OD SAP đã bỏ / đã vào KH xuất thì kéo về khung chờ hoặc bỏ khỏi kế hoạch.`,
      })
      return
    }
    if (split.length) {
      await ask({
        title: `Không xác nhận được: ${split.length} OD đang nằm ở hai xe`, danger: true, cancelLabel: null,
        body: split.slice(0, 5).map(([od, g]) => `• ${od}: ${g.join(' + ')}`).join('\n') +
          (split.length > 5 ? `\n… và ${split.length - 5} OD nữa` : '') +
          `\n\nApp chưa tách một DO ra hai xe. Máy tách vì OD vượt sức chứa xe lớn nhất.\n` +
          `Cách xử lý: trên Bàn ghép xe kéo phần OD ở xe này thả sang xe kia để gom về MỘT xe ` +
          `(xe sẽ báo Vượt tải — vẫn xác nhận được), hoặc tách DO ở SAP trước.`,
      })
      return
    }
    const ok = await ask({
      title: `Xác nhận ${n} xe vào Kế hoạch xuất ngày ${formatDate(plan.plan_date)}?`,
      confirmLabel: 'Xác nhận',
      danger: !!warn,
      body: [
        tenderCount
          ? `${n - tenderCount} xe vào Kế hoạch xuất ngay, ${tenderCount} xe CHỜ ĐVVT phản hồi (ĐVVT có cờ "cần phản hồi").`
          : 'Sau bước này chuyến + lệnh VC tự sinh, sửa tiếp ở tab Kế hoạch xuất.',
        warn ? `\n⚠ Còn ${warn} — vẫn ghi được, nhưng phải sửa ở tab Kế hoạch xuất sau. Bấm Huỷ để quay lại xử lý (dải "Soát" ở đầu bảng).` : '',
      ].filter(Boolean).join('\n'),
    })
    if (ok === null) return
    confirm.mutateAsync(plan.id).then(r => {
      toast({
        // ⚠️ KHÔNG khẳng định "chuyến đã sinh" khi chưa đo được. Đường dội xuống có thể TỪ CHỐI TRỌN GÓI
        // mà không ném lỗi (derive_failed) — trước 24/09 câu này vẫn in "đã sinh" trong khi thực tế 0/50.
        title: r.derive_failed
          ? `Đã ghi ${r.lines} dòng Kế hoạch xuất — nhưng CHƯA sinh được chuyến nào`
          : r.tendered ? `Đã ghi ${r.trips} xe vào Kế hoạch xuất · ${r.tendered} xe chờ ĐVVT phản hồi` : `Đã ghi ${r.lines} dòng Kế hoạch xuất cho ${r.trips} xe`,
        description: r.derive_failed
          ? `${r.derive_message ?? 'đường sinh chuyến từ chối kế hoạch'} — kế hoạch nằm ở tab Kế hoạch xuất, sửa chỗ bị từ chối rồi chuyến sẽ tự dội xuống.`
          : r.replan_error ? `Kế hoạch đã lưu nhưng chuyến chưa dội xuống: ${r.replan_error}` : r.tendered ? `Xe chờ: ${r.tendered_group_codes.join(', ')} — ghi "ĐVVT nhận / từ chối" trong panel từng xe.` : 'Chuyến bên Xuất kho + lệnh VC bên Kế hoạch VC đã sinh.',
        variant: r.replan_error || r.derive_failed ? 'destructive' : undefined,
      })
    }).catch(e => err(e, 'Không xác nhận được'))
  }
  const doDiscard = async () => {
    if (!plan) return
    const tendered = plan.status === 'TENDERED'
    if (await ask({
      title: tendered ? 'Bỏ các xe CHƯA vào Kế hoạch xuất?' : 'Bỏ bản nháp này?', danger: true, confirmLabel: tendered ? 'Bỏ xe chưa chốt' : 'Bỏ nháp',
      body: tendered ? 'Gồm xe đang chờ / bị từ chối / nháp. Xe đã vào Kế hoạch xuất giữ nguyên; OD của xe bị bỏ về lại pool.' : 'OD sẽ về lại pool để lập lại.',
    }) === null) return
    discard.mutateAsync(plan.id).then(r => { if (r.status === 'DISCARDED') setF({ planId: '' }); toast({ title: `Đã bỏ ${r.discarded_trips} xe` }) }).catch(e => err(e, 'Không bỏ được nháp'))
  }
  // MỞ LẠI (user chốt 25/09 "lưu rồi có sửa lại được không"): kéo xe đã vào Kế hoạch xuất về nháp — chỉ xe mà chuyến
  // bên Xuất CHƯA bắt đầu; chuyến đang xuất / đã xong / đang giữ hàng nhặt lẻ giữ nguyên và được liệt kê lý do.
  const confirmedN = plan ? plan.trips.filter(t => tripStatus(t) === 'CONFIRMED').length : 0
  const doReopen = async () => {
    if (!plan) return
    if (await ask({
      title: `Mở lại ${confirmedN} xe đã vào Kế hoạch xuất để sửa?`, confirmLabel: 'Mở lại',
      body: 'Xe về NHÁP trên Bàn ghép xe; chuyến bên Xuất kho tạm NGỪNG và lệnh VC NHẢ khung giờ đã đặt. Sửa xong bấm Xác nhận — cùng Số xe sống lại, khung giờ phải đặt lại.\nXe mà chuyến đang xuất / đã hoàn thành / đang giữ hàng nhặt lẻ KHÔNG mở lại được (giữ nguyên).',
    }) === null) return
    reopen.mutateAsync({ plan_id: plan.id }).then(r => toast({
      title: r.reopened.trips ? `Đã mở lại ${r.reopened.trips} xe — sửa trên Bàn ghép xe rồi Xác nhận lại` : 'Không mở lại được xe nào',
      description: r.reopened.blocked.length ? `${r.reopened.blocked.length} xe giữ nguyên: ${r.reopened.blocked.slice(0, 3).map(b => `${b.group_code} (${b.reason})`).join('; ')}` : (r.reopened.replan_error ?? undefined),
      variant: r.reopened.replan_error ? 'destructive' : undefined,
    })).catch(e => err(e, 'Không mở lại được'))
  }
  const doSettle = async (t: DispatchTrip) => {
    const tender = needsTender(t)
    if (await ask(tender
      ? { title: `Chào xe ${t.group_code} cho ${t.detail.carrier?.name ?? 'ĐVVT'}?`, body: 'Xe sẽ CHỜ ĐVVT phản hồi.', confirmLabel: 'Chào xe' }
      : { title: `Chốt xe ${t.group_code} vào Kế hoạch xuất ngay?`, body: 'ĐVVT không cần phản hồi.', confirmLabel: 'Chốt xe' }) === null) return
    settle.mutateAsync(t.id).then(r => toast({
      title: r.derive_failed ? `Xe ${r.group_code}: đã ghi kế hoạch nhưng CHƯA sinh được chuyến` : r.trip_status === 'TENDERED' ? `Xe ${r.group_code} đang chờ ĐVVT phản hồi` : `Xe ${r.group_code} đã vào Kế hoạch xuất`,
      description: r.derive_failed ? (r.derive_message ?? undefined) : (r.replan_error ?? undefined),
      variant: r.replan_error || r.derive_failed ? 'destructive' : undefined,
    })).catch(e => err(e, 'Không chốt được xe'))
  }
  const doRespond = async (t: DispatchTrip, accept: boolean) => {
    let note: string | undefined
    if (!accept) {
      const v = await ask({ title: `ĐVVT ${t.detail.carrier?.name ?? ''} từ chối xe ${t.group_code}`, danger: true, confirmLabel: 'Ghi từ chối', input: { label: 'Lý do (ghi lại để đối chiếu)', placeholder: 'vd: hết xe ngày này' } })
      if (v === null) return
      note = v || undefined
    } else if (await ask({ title: `Ghi nhận ĐVVT ${t.detail.carrier?.name ?? ''} ĐÃ NHẬN xe ${t.group_code}?`, body: 'Xe vào Kế hoạch xuất ngay.', confirmLabel: 'ĐVVT đã nhận' }) === null) return
    respond.mutateAsync({ tripId: t.id, accept, note }).then(r => toast({ title: accept ? `Xe ${r.group_code} đã vào Kế hoạch xuất` : `Đã ghi ĐVVT từ chối xe ${r.group_code}`, description: accept ? (r.replan_error ?? undefined) : 'Đổi ĐVVT trong panel xe rồi bấm "Chốt xe này".', variant: r.replan_error ? 'destructive' : undefined })).catch(e => err(e, 'Không ghi được phản hồi'))
  }
  const doExport = async () => {
    if (!plan) return
    const XLSX = await import('xlsx')
    const rows = plan.trips.flatMap(t => t.ods.map(o => ({
      'Số xe': t.group_code, 'DO': o.od_number, 'NPP': o.ship_to_name ?? '', 'Ship-to': o.ship_to_code ?? '', 'Phường': o.ward_code ?? '',
      'Loại xe': t.detail.vehicle_model?.parent_type_name ?? '', 'Mã xe SAP': t.detail.vehicle_model?.sap_code ?? '', 'Dòng xe': (t.detail.vehicles?.length ?? 0) > 1 ? t.detail.vehicles!.map(v => v.name).join(' + ') : t.detail.vehicle_model?.name ?? '',
      'ĐVVT': t.detail.carrier?.name ?? '', 'Trạng thái xe': TRIP_STATUS_VI[tripStatus(t)].label, 'Ngày xuất': plan.plan_date, 'Loại kho booking': t.detail.booking_category ?? '',
      'Pallet OD': o.pallets == null ? '' : Number(o.pallets), 'Tấn OD': o.tons == null ? '' : Number(o.tons),
      'Pallet xe': t.pallets == null ? '' : Number(t.pallets), 'Tải %': t.load_pct == null ? '' : Number(t.load_pct), 'Cước dự tính': t.freight_estimated == null ? '' : Number(t.freight_estimated),
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'KH dieu van')
    saveWorkbook(wb, `dieu-van-${plan.warehouse?.code ?? ''}-${plan.plan_date}.xlsx`)
  }

  // MỘT nút chính mỗi cụm (skill table-format 17c): đang có nháp thì việc kế tiếp là XÁC NHẬN; chưa có kế hoạch đang mở thì
  // "Xem đơn" là nút chính. Không tô màu riêng (bản 24/09 để nút xanh lá cạnh nút xanh dương — màn duy nhất của app có hai nút
  // chính hai màu). Kế hoạch vừa "Mở lại" một phần (xe khác vẫn trong Kế hoạch xuất) vẫn Xác nhận được các xe nháp.
  const confirmIsNext = canConfirm && (isDraft || (plan?.status === 'TENDERED' && plan.trips.some(t => tripStatus(t) === 'DRAFT' && t.ods.length > 0)))
  const actionItems: ActionItem[] = []
  // chưa xe nào ⇒ nút Xác nhận kế hoạch KHOÁ kèm lý do
  if (confirmIsNext) actionItems.push({ key: 'confirm', icon: CheckCircle2, label: 'Xác nhận', tip: noTripYet ? 'Chưa có xe nào — tab Xem đơn: tick đơn rồi bấm "Tạo kế hoạch"; soát xe ở Bàn ghép xe rồi mới xác nhận' : tenderCount ? `Ghi các xe vào Kế hoạch xuất; ${tenderCount} xe của ĐVVT "cần phản hồi" sẽ chờ ĐVVT nhận` : 'Ghi các chuyến vào Kế hoạch xuất — chuyến + lệnh VC tự sinh', primary: true, variant: 'default', onClick: doConfirm, disabled: confirm.isPending || noTripYet, busy: confirm.isPending })
  // "Xem đơn" chỉ khi CHƯA có kế hoạch đang mở (kế hoạch đang mở thì danh sách đã nằm sẵn ở tab Xem đơn, đơn mới tự vào Chờ điều)
  if (canPlan && !isOpen) actionItems.push({ key: 'load', icon: ListChecks, label: 'Xem đơn', tip: 'Nạp các đơn chưa đi của kho × ngày × mảng này vào Chờ điều — chưa ghép xe nào; tick đơn rồi bấm "Tạo kế hoạch"', primary: !confirmIsNext, variant: confirmIsNext ? undefined : 'default', onClick: loadOrders, disabled: !f.warehouseId || create.isPending, busy: create.isPending })
  if (canConfirm && confirmedN > 0) actionItems.push({ key: 'reopen', icon: RotateCcw, label: 'Mở lại', tip: `Kéo ${confirmedN} xe đã vào Kế hoạch xuất về nháp để sửa trên Bàn ghép xe (chỉ xe mà chuyến chưa bắt đầu)`, onClick: () => void doReopen(), disabled: reopen.isPending, busy: reopen.isPending })
  if (canExport && plan) actionItems.push({ key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất kế hoạch theo cột file KH điều vận', onClick: doExport, mobileHidden: true })
  // 03/10 tối (user: "tôi thậm chí còn không thấy thao tác xoá nó ở đâu cả"): nút Bỏ nháp có CHỮ, không chỉ icon thùng rác
  if (canPlan && isOpen) actionItems.push({ key: 'discard', icon: Trash2, label: isDraft ? 'Bỏ nháp' : 'Bỏ xe chưa chốt', tip: isDraft ? 'Bỏ bản nháp — OD về lại pool' : 'Bỏ các xe chưa vào Kế hoạch xuất (chờ / từ chối / nháp) — xe đã vào giữ nguyên', danger: true, primary: true, variant: 'outline', className: 'text-red-600 border-red-200 hover:bg-red-50', onClick: doDiscard, disabled: discard.isPending })

  const all = plan?.trips ?? []
  const todoN = useMemo(() => all.filter(t => needsWork(t, ictx)).length, [all, ictx])
  const issueN = useMemo(() => {
    const m = {} as Record<IssueKey, number>
    for (const i of ISSUES) m[i.key] = 0
    for (const t of all) for (const k of issuesOf(t, ictx)) m[k]++
    return m
  }, [all, ictx])
  const sum = plan?.summary
  const s = plan ? STATUS_VI[plan.status] : null

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 hidden sm:inline-flex items-center gap-1.5"><Waypoints className="h-4 w-4 text-sky-600" /> Điều vận</h1>
            {/* Tab CẠNH tiêu đề (khuôn app — skill table-format 22); điện thoại chiếm trọn hàng đầu */}
            <Tabs value={tab} onValueChange={v => setF({ tab: v })} className="w-full sm:w-auto order-first sm:order-none">
              <TabsList className="h-8 max-w-full overflow-x-auto">
                {tabs.map(t => <TabsTrigger key={t.key} value={t.key} className="gap-1.5 text-xs"><t.icon className="h-3.5 w-3.5" /> {t.label}</TabsTrigger>)}
              </TabsList>
              {tabs.map(t => <TabsContent key={t.key} value={t.key} className="hidden" />)}
            </Tabs>
            {/* Kho + Ngày CHUNG một hàng trên điện thoại (bản cũ Kho chiếm trọn một hàng riêng) */}
            {/* min-w: không có thì flex-1 co ô Kho về ~20 px khi hàng còn chỗ cho ô ngày (đo 390 px, 25/09) */}
            <div className="flex-1 min-w-[150px] sm:flex-none sm:w-56"><WarehouseSingleSelect warehouses={whs} value={f.warehouseId} onChange={v => setF({ warehouseId: v, planId: '' })} /></div>
            <Input type="date" value={day} onChange={e => setF({ planDate: e.target.value, planId: '' })} className="h-9 sm:h-7 w-[140px] text-xs shrink-0" title="Ngày giao (ngày xe chạy)" />
            {/* MẢNG (03/10 tối): hai kế hoạch riêng cùng kho × ngày — switch nhỏ, nhớ theo người; ở Xem đơn còn có tab Trung chuyển | Bán hàng */}
            <div className="inline-flex shrink-0 rounded-md border border-slate-200 p-0.5" title="Mảng điều vận — mỗi mảng một kế hoạch riêng cùng kho × ngày. Khách tick 'Trung chuyển' ở Khách hàng thì đơn vào Trung chuyển, còn lại Bán hàng; lấy đơn sang mảng mình ở tab Xem đơn.">
              {(['SALES', 'TRANSFER'] as const).map(s => (
                <button key={s} type="button" onClick={() => setF({ segment: s, planId: '' })} aria-pressed={seg === s}
                  className={`rounded px-2 h-8 sm:h-6 text-[11px] font-medium ${seg === s ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{SEGMENT_VI[s]}</button>
              ))}
            </div>
            {/* Điện thoại: ô Kế hoạch CHUNG hàng với nút thao tác (desktop sm:contents → như cũ) */}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              {planList.length > 1 && (
                <div className="flex-1 min-w-[140px] sm:flex-none sm:w-48"><SingleSelect searchable={false} value={planId ?? ''} onChange={v => setF({ planId: v })}
                  options={planList.map(p => ({ value: p.id, label: `${STATUS_VI[p.status].label} · ${formatTimestampDate(p.created_at)}`, sub: p.created_by ?? undefined }))} placeholder="Kế hoạch" /></div>
              )}
              {/* Trạng thái + tham số lập GỌN vào ⓘ (user 25/09 tối: "bàn làm việc rộng rãi nhất có thể") — bản cũ là một
                  hàng meta riêng dưới thanh công cụ */}
              {plan && s && (
                <span className="inline-flex items-center gap-1 shrink-0">
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  <InfoTip tip={<div className="space-y-0.5 text-xs">
                    <div><b>{plan.warehouse?.name}</b> · giao {formatDate(plan.plan_date)}</div>
                    <div>Lập {formatTimestampDate(plan.created_at)}{plan.created_by ? ` bởi ${plan.created_by}` : ''}</div>
                    <div>Số khách cùng xe = nhỏ nhất trong (dòng xe · kênh / khách) — chưa khai = một khách một xe · {plan.params.allow_mix_channels ? 'cho trộn kênh khách' : 'không trộn kênh khách'}</div>
                    <div>{plan.params.allow_mix_categories === false ? 'Không ghép nhiều Loại kho trên một chuyến' : 'Cho ghép nhiều Loại kho trên một chuyến'}{plan.params.follow_categories?.length ? ` · đi kèm đơn: ${plan.params.follow_categories.join(', ')}` : ''}</div>
                    <div>Pool {nf(plan.params.pool_ods)} OD · {nf(plan.params.in_plan)} OD đã có trong Kế hoạch xuất</div>
                    <div className="text-slate-500">Tham số theo kho: Cài đặt WMS → Kho → "XUẤT — Điều vận".</div>
                  </div>} />
                </span>
              )}
              {/* KHAI THIẾU (26/09, user: "không khai báo đúng thì FG02 có thể dùng container mất") — máy xếp sai mà không lỗi
                  nào nổ, nên phải nói ra; gọn thành MỘT chip, chi tiết trong ⓘ để bàn ghép xe vẫn rộng */}
              {plan && tab !== 'map' && (() => {
                const g = plan.params.config_gaps
                const nCond = g?.no_condition.reduce((a, x) => a + x.ods, 0) ?? 0
                const nCat = g?.no_category.ods ?? 0
                // đếm SỐNG từ dòng OD (không từ params — "Ghép" / sửa dòng xe khách trên bàn không cập nhật params)
                const noVeh = [...(plan.pool ?? []), ...plan.trips.flatMap(t => t.ods)].filter(o => Array.isArray(o.allowed_models) && !o.allowed_models.length)
                const nVeh = new Set(noVeh.map(o => o.od_number)).size, nVehCust = new Set(noVeh.map(o => o.ship_to_code ?? o.od_number)).size
                // 02/10 (user: "khách và dòng xe muốn được ghép phải khai, không khai thì cảnh báo"): chưa khai = máy xếp mỗi khách một xe
                const nd = g?.no_drops
                const nDrops = (nd?.models.length ?? 0) + (nd?.channels.length ?? 0) + (nd?.no_channel_ods ?? 0)
                // 03/10 (user: "mã chưa có thì phải xử lý trước khi ghép đơn"): OD có mã lạ bị loại khỏi đợt ghép — việc phải làm là khai mã
                const nMat = g?.no_material?.ods ?? 0
                if (!nCond && !nCat && !nVeh && !nDrops && !nMat) return null
                return (
                  <span className="inline-flex items-center gap-0.5 shrink-0 rounded-md bg-amber-100 px-2 h-9 sm:h-7 text-[11px] font-medium text-amber-800">
                    <AlertTriangle className="h-3 w-3" />Khai thiếu
                    <InfoTip tip={<div className="space-y-1.5 text-xs">
                      {nMat > 0 && <div>
                        <b>{nf(nMat)} OD có mã hàng CHƯA KHAI trong Mã hàng — máy KHÔNG ghép các OD này</b> (tab Điều, dòng "Không lên xe", không đo được tải / điều kiện bảo quản):
                        <div className="font-mono text-[10px] text-slate-500 break-all">{g!.no_material!.materials.slice(0, 12).join(', ')}{g!.no_material!.materials.length > 12 ? '…' : ''}</div>
                        Khai ở Cấu hình → Mã hàng (đủ đơn vị gốc · hộp/thùng · thùng/pallet · khối lượng · Loại kho). Khai xong OD tự vào khung chờ ở lần đồng bộ kế tiếp.
                      </div>}
                      {/* 28/09 (user: "dòng xe chọn theo khai báo của khách, không khai thì không chọn") */}
                      {nVeh > 0 && <div>
                        <b>{nf(nVeh)} OD của {nf(nVehCust)} khách chưa có dòng xe nào được vào</b> — máy KHÔNG chọn xe cho các OD này, chúng nằm ở khung chờ.
                        Khai ở Cấu hình → Khách hàng → Dòng xe được vào (khai theo KÊNH cho số đông, khai riêng khách khi cần), rồi bấm Tạo kế hoạch / Tối ưu lại.
                      </div>}
                      {nDrops > 0 && <div>
                        <b>Chưa khai số điểm giao — máy xếp mỗi khách MỘT xe:</b>
                        <ul className="list-disc pl-4">
                          {!!nd?.models.length && <li>Dòng xe chưa khai "Điểm giao tối đa" (Cài đặt TMS → Mã dòng xe): {nd.models.join(', ')}</li>}
                          {!!nd?.channels.length && <li>Kênh chưa khai "Số khách tối đa cùng xe" (Cấu hình → Khách hàng → Kênh): {nd.channels.join(', ')}</li>}
                          {!!nd?.no_channel_ods && <li>{nf(nd.no_channel_ods)} OD của khách chưa có kênh và chưa khai riêng</li>}
                        </ul>
                        Khách nào phải đi riêng thì tick "Đi xe riêng" hoặc khai "Số khách tối đa cùng xe" = 1 ở chính khách đó.
                      </div>}
                      {!!g?.no_condition.length && <div>
                        <b>Loại kho chưa khai điều kiện bảo quản</b> — máy coi hàng loại này đi <b>xe nào cũng được</b> (kể cả xe lạnh):
                        <ul className="list-disc pl-4">{g.no_condition.map(x => <li key={x.category}>{x.category}: {nf(x.ods)} OD</li>)}</ul>
                        Khai ở Cài đặt WMS → Loại kho → Điều kiện bảo quản; POSM đi theo đơn thì bật "Đi kèm đơn khi điều vận".
                      </div>}
                      {nCat > 0 && <div>
                        <b>{nf(nCat)} OD có mã hàng chưa khai Loại kho</b> — không biết điều kiện bảo quản, không tách được theo loại:
                        <div className="font-mono text-[10px] text-slate-500 break-all">{g!.no_category.materials.slice(0, 12).join(', ')}{g!.no_category.materials.length > 12 ? '…' : ''}</div>
                        Khai ở Cấu hình → Mã hàng.
                      </div>}
                      <div className="text-slate-500">Khai xong: đơn đã trong kế hoạch bấm "Tối ưu lại" trên Bàn ghép xe; đơn Chờ điều đọc cấu hình mới lúc "Tạo kế hoạch".</div>
                    </div>} />
                  </span>
                )
              })()}
              {/* Tab Bản đồ chỉ để XEM (user 02/10: "action không liên quan tới tab bản đồ thì bỏ") — Xác nhận / Lập lại / Excel / Bỏ nháp,
                  chip Khai thiếu, dải Soát và dải Chỉ số đều thuộc bàn ghép xe; ở đây chỉ còn Kho · Ngày · Kế hoạch · trạng thái */}
              {tab !== 'map' && <ActionCluster items={actionItems} mobileInline />}
            </div>
          </div>
        </div>

        {/* NHÁP QUÁ NGÀY chưa xác nhận (03/10 tối): nêu nháp ngày nào · ai lập · lúc nào · còn bao nhiêu đơn; Mở để xử, Bỏ nháp để nhả đơn */}
        {stalePlans.length > 0 && tab !== 'map' && (
          <div className="shrink-0 border-b bg-amber-50 px-3 py-1.5 space-y-1">
            {stalePlans.slice(0, 3).map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Nháp <b>{SEGMENT_VI[p.segment ?? 'SALES']}</b> ngày <b>{formatDate(p.plan_date)}</b>{p.created_by ? ` của ${p.created_by}` : ''} (lập {formatTimestampDate(p.created_at)}) đã quá ngày mà chưa xác nhận — còn {nf(p.summary?.ods ?? 0)} đơn trên xe, {nf(Math.max(0, (p.summary?.pool_ods ?? 0) - (p.summary?.unreviewed_ods ?? 0)))} đơn khung chờ của kế hoạch.</span>
                <button type="button" className="font-medium text-sky-700 hover:underline" onClick={() => setF({ planDate: p.plan_date, planId: p.id, segment: p.segment ?? 'SALES', tab: 'board' })}>Mở nháp</button>
                {canPlan && <button type="button" className="font-medium text-red-700 hover:underline" disabled={discard.isPending}
                  onClick={async () => { if (await ask({ title: `Bỏ nháp ngày ${formatDate(p.plan_date)}?`, danger: true, confirmLabel: 'Bỏ nháp', body: 'Đơn trên xe của nháp này được nhả ra — kế hoạch ngày khác lấy được ngay (khung chờ vốn đã tự do).' }) === null) return
                    discard.mutateAsync(p.id).then(r => toast({ title: `Đã bỏ nháp ${formatDate(p.plan_date)} — ${r.discarded_trips} xe` })).catch(e => err(e, 'Không bỏ được nháp')) }}>Bỏ nháp</button>}
              </div>
            ))}
            {stalePlans.length > 3 && <div className="text-[11px] text-amber-800">… và {stalePlans.length - 3} nháp quá ngày nữa</div>}
          </div>
        )}
        {/* DẢI VIỆC — trả lời "còn bao nhiêu việc" và đưa người tới đó bằng MỘT nhát bấm.
            Dùng SWITCH hiện sẵn chứ không phải chip trong menu: cả lựa chọn LẪN số của từng lựa chọn
            phải nhìn thấy mà không bấm gì (cùng lý do user chốt 17/09 cho bảng Việc cần làm). Loại
            vấn đề nào KHÔNG có xe nào thì không hiện — menu đầy lựa chọn ra bảng trắng là vô ích. */}
        {/* đang XEM nháp đã bỏ (người chủ động mở) — nói rõ là chỉ xem, đường về kế hoạch đang làm một nhát */}
        {plan?.status === 'DISCARDED' && (
          <div className="shrink-0 border-b bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
            Đang xem nháp <b>đã bỏ</b> lúc {formatTimestampDate(plan.updated_at)} — chỉ xem, không chọn / ghép / chuyển được.{' '}
            <button type="button" className="font-medium text-sky-700 hover:underline" onClick={() => setF({ planId: '' })}>Về kế hoạch đang làm</button>
          </div>
        )}
        {plan && !showReview && !planEmpty && tab !== 'map' && (
          // Điện thoại: MỘT hàng cuộn ngang (bản cũ wrap thành 3 hàng, đẩy dòng xe đầu tiên xuống ~640 px)
          <div className="shrink-0 border-b bg-white px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto sm:flex-wrap [&>*]:shrink-0">
            <span className="hidden sm:inline text-[10px] uppercase tracking-wide text-slate-400 shrink-0">Soát</span>
            {([{ k: '', label: 'Tất cả', n: all.length, tip: 'Mọi xe trong kế hoạch' },
               { k: 'todo', label: 'Cần xử lý', n: todoN, tip: 'Xe người CÒN ĐÓNG ĐƯỢC (thiếu ĐVVT / dòng xe / vượt tải / Non tải / bị từ chối). "Chưa có cước" không tính vào đây vì thường là bảng cước chưa có tuyến đó — xem riêng bằng chip bên cạnh.' },
               ...ISSUES.filter(i => issueN[i.key] > 0).map(i => ({ k: i.key as string, label: i.label, n: issueN[i.key], tip: i.tip })),
              ]).map(o => (
              <button key={o.k || 'all'} type="button" title={o.tip} onClick={() => setF({ issue: o.k })}
                className={`flex items-center gap-1.5 rounded-md px-2 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${
                  f.issue === o.k ? 'bg-slate-800 text-white'
                  : o.k === 'todo' && o.n > 0 ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {o.label}
                <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${f.issue === o.k ? 'bg-white/25 text-white' : 'bg-white text-slate-500'}`}>{nf(o.n)}</span>
              </button>
            ))}
            {todoN === 0 && <span className="text-[11px] text-green-700 font-medium">✓ Không còn xe nào chờ người quyết{issueN.nofreight ? ` — còn ${issueN.nofreight} xe chưa có cước (bảng cước thiếu tuyến, không sửa ở đây được)` : ''}</span>}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {sum && planView && <span className="hidden md:inline"><DispatchKpiInline plan={planView} /></span>}
              {sum && (
                <button type="button" onClick={() => setF({ kpiOpen: !f.kpiOpen })} aria-expanded={f.kpiOpen}
                  title="Dải chỉ số đầy đủ: OD · pallet · tấn · cước/pallet · Non tải · tỷ trọng ĐVVT · số chuyến theo dòng xe"
                  className={`inline-flex items-center gap-1 rounded-md px-2 h-9 sm:h-7 text-[11px] font-medium ${f.kpiOpen ? 'bg-sky-700 text-white' : 'bg-sky-50 text-sky-800 hover:bg-sky-100'}`}>
                  <BarChart3 className="h-3.5 w-3.5" /> Chỉ số {f.kpiOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
            </div>
          </div>
        )}

        {planView && sum && f.kpiOpen && tab !== 'map' && <DispatchKpiBar plan={planView} />}

        <div className={plan ? 'flex-1 min-h-0' : 'flex-1 min-h-0 overflow-auto pb-20 lg:pb-4'}>
          {!f.warehouseId ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
              <Waypoints className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium text-slate-500">Chọn <b>kho xuất</b> và <b>ngày giao</b> để xem / lập kế hoạch ghép chuyến</p>
              <p className="text-xs">Pool = OD ZSD02 của kho (theo Plant SAP) có ngày giao đó và chưa nằm trong Kế hoạch xuất.</p>
            </div>
          ) : plans.isLoading || planQ.isLoading ? (
            <div className="p-6 text-center text-xs text-slate-400">Đang tải…</div>
          ) : !plan ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
              <Waypoints className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium text-slate-500">Chưa có kế hoạch <b>{SEGMENT_VI[seg]}</b> cho kho này ngày {formatDate(day)}{otherPlan ? ` — mảng ${SEGMENT_VI[otherSeg]} đã có nháp` : ''}</p>
              {canPlan ? <>
                <Button size="sm" className="mt-2 h-8 bg-blue-600 hover:bg-blue-700" onClick={loadOrders} disabled={create.isPending}><ListChecks className="h-3.5 w-3.5 mr-1" /> {create.isPending ? 'Đang nạp đơn…' : 'Xem đơn'}</Button>
                <p className="text-xs">Nạp các đơn chưa đi vào Chờ điều — tick đơn cần đi ngày này rồi bấm "Tạo kế hoạch".</p>
              </> : <p className="text-xs">Bạn chỉ có quyền xem — người có quyền “Lập kế hoạch” sẽ nạp đơn và tạo kế hoạch.</p>}
              {lastDiscarded && (
                <p className="text-xs">Nháp trước{lastDiscarded.created_by ? ` (${lastDiscarded.created_by} lập)` : ''} đã bỏ lúc {formatTimestampDate(lastDiscarded.updated_at)} — <button type="button" className="text-sky-700 underline" onClick={() => setF({ planId: lastDiscarded.id })}>Xem nháp đã bỏ</button> (chỉ xem)</p>
              )}
            </div>
          ) : showReview ? (
            <DispatchReviewTable plan={plan} editable={!!isOpen && canPlan} flags={flags} onGrouped={ids => { setFocusTrips(ids); setF({ tab: 'board' }) }} canAct={canActKhvc}
              hidden={hidden} otherPlanId={otherPlan?.id ?? null} otherPoolCount={otherPlan?.summary ? (otherPlan.summary.unreviewed_ods ?? otherPlan.summary.pool_ods ?? null) : null} onSwitchSegment={s => setF({ segment: s, planId: '', reviewTab: 'GO' })} />
          ) : tab === 'board' && planEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
              <LayoutGrid className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium text-slate-500">Kế hoạch <b>{SEGMENT_VI[seg]}</b> ngày {formatDate(plan.plan_date)} chưa có đơn nào</p>
              <p className="text-xs">Vào Xem đơn, tick các đơn cần đi ngày này rồi bấm "Tạo kế hoạch" — máy ghép thành xe, bàn này hiện để soát / sửa.</p>
              <Button size="sm" variant="outline" className="mt-2 h-8" onClick={() => setF({ tab: 'review', reviewTab: 'GO' })}><ListChecks className="h-3.5 w-3.5 mr-1" /> Mở Xem đơn</Button>
            </div>
          ) : tab === 'board' ? (
            <DispatchBoard plan={planView ?? plan} editable={!!isOpen && canPlan} flags={flags} onOpenTrip={setOpenTripId} focusTripIds={focusTrips} onFocused={() => setFocusTrips([])} />
          ) : (
            <div className="h-full min-h-0 overflow-y-auto lg:overflow-hidden pb-20 lg:pb-0"><DispatchMap plan={planView ?? plan} warehouseId={f.warehouseId} canPlan={canPlan} onOpenTrip={setOpenTripId} /></div>
          )}
        </div>
      </div>

      <Sheet open={!!openTrip} onOpenChange={o => !o && setOpenTripId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
          {openTrip && plan && (
            <TripPane trip={openTrip} plan={plan} editable={!!isOpen && canPlan && EDITABLE.includes(tripStatus(openTrip))} canConfirm={canConfirm} needsTender={needsTender(openTrip)} condBy={condBy}
              models={models.map(m => ({ value: m.id, label: `${m.sap_code} · ${m.name}`, sub: m.capacity_mode === 'TON' ? `${m.max_tons ?? '?'} t` : `${m.max_pallets ?? '?'} pl` }))}
              companies={companiesRaw.map(c => ({ value: c.id, label: `${c.code} · ${c.name}`, sub: c.tender_required ? 'cần phản hồi' : undefined }))}
              onModel={v => patchTrip.mutateAsync({ id: openTrip.id, vehicle_model_id: v || null }).catch(e => err(e, 'Không đổi được dòng xe'))}
              onModels={ids => patchTrip.mutateAsync({ id: openTrip.id, vehicle_model_ids: ids }).catch(e => err(e, 'Không đổi được các xe của thẻ'))}
              onCarrier={v => patchTrip.mutateAsync({ id: openTrip.id, transport_company_id: v || null }).catch(e => err(e, 'Không đổi được ĐVVT'))}
              onMove={(od, to) => moveOd.mutateAsync({ trip_id: openTrip.id, od_number: od, to_trip_id: to || undefined }).then(p => { if (!p.trips.some(t => t.id === openTrip.id)) setOpenTripId(null) }).catch(e => err(e, 'Không chuyển được OD'))}
              onSettle={() => doSettle(openTrip)} onRespond={a => doRespond(openTrip, a)}
              busy={patchTrip.isPending || moveOd.isPending || settle.isPending || respond.isPending} />
          )}
        </SheetContent>
      </Sheet>
      {confirmNode}
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex gap-2 text-xs py-1 border-b border-slate-100 last:border-0"><span className="w-32 shrink-0 text-slate-400">{k}</span><span className="min-w-0 font-medium text-slate-700 break-words">{v}</span></div>
}

function TripPane({ trip: t, plan, editable, canConfirm, needsTender, condBy, models, companies, onModel, onModels, onCarrier, onMove, onSettle, onRespond, busy }: {
  trip: DispatchTrip; plan: DispatchPlan; editable: boolean; canConfirm: boolean; needsTender: boolean
  condBy: Map<string, StorageConditionRow>
  models: { value: string; label: string; sub?: string }[]; companies: { value: string; label: string; sub?: string }[]
  onModel: (v: string) => void; onModels: (ids: string[]) => void; onCarrier: (v: string) => void; onMove: (od: string, toTripId: string) => void
  onSettle: () => void; onRespond: (accept: boolean) => void; busy: boolean
}) {
  const d = t.detail
  const extras = t.extra_vehicle_model_ids ?? []
  const st = tripStatus(t)
  const sv = TRIP_STATUS_VI[st]
  const planOpen = plan.status === 'DRAFT' || plan.status === 'TENDERED'
  // chỉ chốt lẻ khi kế hoạch ĐÃ qua bước Xác nhận (TENDERED) — kế hoạch còn nháp thì dùng nút Xác nhận chung
  const canSettle = canConfirm && plan.status === 'TENDERED' && EDITABLE.includes(st) && t.ods.length > 0
  const canRespond = canConfirm && planOpen && st === 'TENDERED'
  const others = plan.trips.filter(o => o.id !== t.id && EDITABLE.includes(tripStatus(o))).map(o => ({ value: o.id, label: `${o.group_code} · ${o.detail.vehicle_model?.name ?? 'chưa chọn xe'}`, sub: `${nf(o.pallets, 1)} pl · ${o.stops} điểm` }))
  const odNos = [...new Set(t.ods.map(o => o.od_number))]
  return (
    <>
      <SheetHeader className="px-4 py-3 border-b bg-slate-50 shrink-0">
        <div className="flex items-start justify-between gap-2 pr-6">
          <div className="min-w-0">
            <SheetTitle className="text-sm font-mono break-all">{t.group_code} <StatusBadge tone={sv.tone} className="align-middle font-sans">{sv.label}</StatusBadge></SheetTitle>
            <p className="text-xs text-slate-500 mt-0.5">{odNos.length} OD · {t.stops} điểm giao · {nf(t.pallets, 1)} pallet · {nf(t.tons, 2)} tấn · giao {formatDate(plan.plan_date)}</p>
          </div>
          <LoadCell t={t} />
        </div>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {(canRespond || canSettle || st === 'DECLINED' || st === 'TENDERED' || st === 'CONFIRMED') && (
          <div className={`rounded-md border p-2.5 space-y-2 text-xs ${st === 'DECLINED' ? 'border-red-200 bg-red-50' : st === 'TENDERED' ? 'border-sky-200 bg-sky-50' : st === 'CONFIRMED' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            {st === 'TENDERED' && <p>Đã chào cho <b>{d.carrier?.name ?? 'ĐVVT'}</b>{t.tendered_at ? ` lúc ${formatTimestampDate(t.tendered_at)}` : ''} — chờ ĐVVT nhận / từ chối. Gọi hoặc Zalo cho ĐVVT rồi ghi lại câu trả lời ở đây.</p>}
            {st === 'DECLINED' && <p><b>{d.carrier?.name ?? 'ĐVVT'}</b> từ chối{t.responded_at ? ` lúc ${formatTimestampDate(t.responded_at)}` : ''}{t.response_by ? ` (ghi bởi ${t.response_by})` : ''}{t.response_note ? `: “${t.response_note}”` : '.'} Đổi ĐVVT bên dưới rồi bấm <b>Chốt xe này</b>.</p>}
            {st === 'CONFIRMED' && <p>Đã vào Kế hoạch xuất{t.confirmed_at ? ` lúc ${formatTimestampDate(t.confirmed_at)}` : ''}{t.response_note ? ` · ghi chú ĐVVT: “${t.response_note}”` : ''}. Sửa tiếp ở tab Kế hoạch xuất.</p>}
            {st === 'DRAFT' && canSettle && <p>Xe còn nháp trong kế hoạch đã xác nhận một phần{needsTender ? ` — ĐVVT ${d.carrier?.name ?? ''} cần phản hồi, chốt sẽ chuyển sang chờ.` : ' — chốt là vào Kế hoạch xuất ngay.'}</p>}
            <div className="flex flex-wrap gap-1.5">
              {canRespond && <>
                <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700" disabled={busy} onClick={() => onRespond(true)}><ThumbsUp className="h-3.5 w-3.5 mr-1" /> ĐVVT nhận</Button>
                <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-700 hover:bg-red-50" disabled={busy} onClick={() => onRespond(false)}><ThumbsDown className="h-3.5 w-3.5 mr-1" /> ĐVVT từ chối</Button>
              </>}
              {canSettle && <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700" disabled={busy} onClick={onSettle}><Send className="h-3.5 w-3.5 mr-1" /> {needsTender ? 'Chào xe này' : 'Chốt xe này'}</Button>}
            </div>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Xe · ĐVVT · cước</p>
          <div className="space-y-2">
            <div>
              <div className="text-[10px] text-slate-400 mb-0.5">Dòng xe con (mã SAP)</div>
              {editable ? <SingleSelect options={models} value={t.vehicle_model_id ?? ''} onChange={onModel} placeholder="Chọn dòng xe con…" disabled={busy} />
                : <div className="text-xs font-medium">{d.vehicle_model ? `${d.vehicle_model.sap_code} · ${d.vehicle_model.name}` : '—'}</div>}
            </div>
            {/* THẺ NHIỀU XE (luật 11, 27/09): xe phụ cùng Số xe — máy chia tải xe lớn trước, cước = Σ từng xe cùng ĐVVT */}
            {(extras.length > 0 || (editable && t.vehicle_model_id)) && (
              <div className="rounded border border-slate-200 p-2 space-y-1.5">
                <div className="text-[10px] text-slate-400 flex items-center gap-1">Xe phụ trên thẻ ({extras.length})
                  <InfoTip tip="Một Số xe có thể đi nhiều xe (vd 8 tấn + 2 tấn thay cho 15 tấn). Máy tự so tổ hợp khi lập; ở đây người thêm / bớt tay. Bước Xuất kho vẫn là MỘT chuyến một biển số — Kế hoạch xuất ghi đủ các xe để ĐVVT booking." /></div>
                {extras.map((id, i) => (
                  <div key={`${id}-${i}`} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">{editable
                      ? <SingleSelect options={models} value={id} onChange={v => onModels([t.vehicle_model_id!, ...extras.map((x, j) => (j === i ? v : x)).filter(Boolean)])} disabled={busy} />
                      : <div className="text-xs">{models.find(m => m.value === id)?.label ?? id}</div>}</div>
                    {editable && <Button size="sm" variant="outline" className="h-8 px-2" disabled={busy} title="Bỏ xe này khỏi thẻ" onClick={() => onModels([t.vehicle_model_id!, ...extras.filter((_, j) => j !== i)])}>✕</Button>}
                  </div>
                ))}
                {editable && extras.length < 4 && (
                  <div className="w-full"><SingleSelect options={models} value="" placeholder="＋ Thêm xe vào thẻ…" disabled={busy} onChange={v => { if (v) onModels([t.vehicle_model_id!, ...extras, v]) }} /></div>
                )}
                {(d.vehicles?.length ?? 0) > 1 && d.vehicles!.map((v, i) => (
                  <div key={`p-${v.id}-${i}`} className="flex gap-2 text-[11px] text-slate-600"><span className="min-w-0 flex-1 break-words">{v.name}</span><span className="tabular-nums">{nf(v.pallets, 1)} pl · {nf(v.tons, 1)} t</span><span className="tabular-nums font-medium">{v.freight == null ? '—' : vnd(v.freight)}</span></div>
                ))}
              </div>
            )}
            <div>
              <div className="text-[10px] text-slate-400 mb-0.5 flex items-center gap-1">ĐVVT {d.carrier_reasons.length > 0 && <InfoTip tip={<ul className="list-disc pl-4 space-y-0.5">{d.carrier_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>} />}</div>
              {editable ? <SingleSelect options={companies} value={t.transport_company_id ?? ''} onChange={onCarrier} placeholder="Chọn ĐVVT…" disabled={busy} />
                : <div className="text-xs font-medium">{d.carrier ? `${d.carrier.code} · ${d.carrier.name}` : '—'}</div>}
              {d.carrier && <p className="text-[10px] text-slate-500 mt-0.5">{needsTender ? <><Send className="inline h-3 w-3 mr-0.5 text-sky-600" />ĐVVT này <b>cần phản hồi</b> — sau Xác nhận xe chờ ĐVVT nhận.</> : 'ĐVVT không cần phản hồi — Xác nhận là vào Kế hoạch xuất ngay; đổi ĐVVT sau đó ở tab Kế hoạch xuất.'}</p>}
            </div>
            <Row k="Cước dự tính" v={t.freight_estimated != null ? <span className="tabular-nums font-semibold">{vnd(t.freight_estimated)}</span> : <span className="text-amber-700">{d.freight.reason ?? 'Chưa có cước'}</span>} />
            {d.freight.base != null && <Row k="Cước tuyến" v={<>{vnd(d.freight.base)}{d.freight.unit === 'PER_PALLET' && d.freight.billed_pallets != null ? <span className="text-slate-500 font-normal"> · {d.freight.billed_pallets} pallet (làm tròn lên)</span> : <span className="text-slate-500 font-normal"> · trọn chuyến</span>}</>} />}
            {d.freight.surcharges.map((x, i) => <Row key={i} k={`Phụ phí ${x.kind}`} v={`${vnd(x.unit_amount)} × ${x.qty} = ${vnd(x.total)}`} />)}
            {d.freight.ward && <Row k="Phường tính cước" v={d.freight.ward} />}
            {d.booking_category && <Row k="Loại kho booking" v={<>{d.booking_category}{d.categories.length > 1 && <span className="text-slate-500 font-normal"> · chở lẫn {d.categories.join('+')}</span>}</>} />}
            {!!d.conditions?.length && <Row k="Điều kiện bảo quản" v={<>{d.conditions.map(c => conditionLabel(condBy.get(c), c)).join(' + ')}<span className="text-slate-500 font-normal"> · dòng xe phải phục vụ đủ các mức này</span></>} />}
            {d.warnings.map((w, i) => <div key={i} className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1"><AlertTriangle className="inline h-3 w-3 mr-1" />{w}</div>)}
            {d.merge_hint && <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{d.merge_hint}</div>}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">OD trên xe ({odNos.length})</p>
          <div className="space-y-2">
            {odNos.map(od => {
              const parts = t.ods.filter(o => o.od_number === od)
              const o = parts[0]
              return (
                <div key={od} className="rounded border border-slate-200 p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-semibold">{od}{o.part_of ? <span className="ml-1 text-[9px] text-amber-700 font-sans">phần {o.part_index}/{o.part_of} — OD bị tách, gom về một xe trước khi xác nhận</span> : null}</div>
                      <div className="text-slate-600 truncate">{o.ship_to_name ?? o.ship_to_code}{o.ward_code ? <span className="text-slate-400"> · {o.ward_code}</span> : null}</div>
                      <div className="text-slate-500 tabular-nums">{nf(parts.reduce((s, p) => s + Number(p.pallets ?? 0), 0), 2)} pallet · {nf(parts.reduce((s, p) => s + Number(p.tons ?? 0), 0), 2)} tấn · {parts.reduce((s, p) => s + p.lines, 0)} dòng hàng</div>
                    </div>
                  </div>
                  {editable && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <div className="flex-1 min-w-0"><SingleSelect options={[{ value: '__new__', label: 'Tách ra xe MỚI' }, ...others]} value="" onChange={v => onMove(od, v === '__new__' ? '' : v)} placeholder="Chuyển sang xe…" disabled={busy} /></div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {!editable && <p className="text-[11px] text-slate-400">{planOpen && !EDITABLE.includes(st) ? `Xe ${sv.label.toLowerCase()} — không sửa dòng xe / ĐVVT / OD ở đây nữa.` : `Kế hoạch ${STATUS_VI[plan.status].label.toLowerCase()} — chỉ xem. Sửa tiếp (nếu đã xác nhận) ở tab Kế hoạch xuất.`}</p>}
      </div>
    </>
  )
}
