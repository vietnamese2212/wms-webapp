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
// dòng xe ⇒ Gán ĐVVT · Đổi dòng xe trên thanh nổi của bàn). Dải Soát nằm trong thanh công cụ của bàn; dải chỉ số `DispatchKpiBar`
// đứng cạnh cụm Xác nhận ở đầu trang, luôn hiện (14/10).
// 07/10 (user: "Ở tab Xem đơn, nút là Xem đơn, tức là load lấy các đơn. Có nút tạo kế hoạch. Tab bàn ghép xe hiện kế hoạch để xem, sửa"):
// "Xem đơn" nạp đơn chưa đi vào CHỜ ĐIỀU (không dải tải, không ghép); tick đơn → "Tạo kế hoạch" (bảng Xem đơn) = chỉ đơn đã tick vào
// kế hoạch; bàn ghép xe chỉ vẽ phần THUỘC kế hoạch (`boardPlanOf`). "Lập lại" BỎ — nút xoá sạch xe dễ nhầm với "Tạo kế hoạch";
// làm lại từ đầu = Bỏ nháp rồi Xem đơn.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, Trash2, Download, Waypoints, ArrowRightLeft, AlertTriangle, ThumbsUp, ThumbsDown, Send, LayoutGrid, ListChecks, RotateCcw, ChevronDown, ChevronUp, Map as MapIcon, FileText, Lock, Unlock, Users, CalendarClock, History, Eye, Pencil, Loader2 } from 'lucide-react'
import { DispatchMoveDateDialog, type MoveDateTarget } from '@/components/tms/DispatchMoveDateDialog'
import { DispatchMap } from '@/components/tms/DispatchMap'
import { TripRouteMap } from '@/components/tms/TripRouteMap'
import { DispatchCarrierPicker } from '@/components/tms/DispatchCarrierPicker'
import { SapFlagIcon } from '@/components/tms/SapFlagIcon'
import { ExtraDropsBadge } from '@/components/tms/DispatchBoardTable'
import { SettingsGroup, SettingRow } from '@/components/shared/SettingRow'
import { Switch } from '@/components/ui/switch'
import { useWhTypeMetaMap } from '@/hooks/useWhTypeMeta'
import { whTypeBadgeCls } from '@/utils/cargoCategory'
import { DispatchPlansTable, groupPlanDays, type DispatchPlanDay } from '@/components/tms/DispatchPlansTable'
import { editDirty, boardEditing } from '@/components/tms/dispatchEdit'
import { DispatchHistoryTab } from '@/components/tms/DispatchHistoryTab'
import { useDispatchPresence } from '@/hooks/useDispatchPresence'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { DispatchBoard, RULE_BLOCK_CODES, apiCode, ruleDialog } from '@/components/tms/DispatchBoard'
import { DispatchKpiBar } from '@/components/tms/DispatchKpiBar'
import { DispatchReviewTable, LateSoChip, isLateSo } from '@/components/tms/DispatchReviewTable'
import { EDITABLE, tripStatus, ISSUES, issuesOf, needsWork, SOFT_FLAG_KINDS, boardPlanOf, outOfScopeCats, ruleWarnings, lockAsk, type IssueKey } from '@/components/tms/dispatchIssues'
import { useMobileTabs } from '@/hooks/useMobileSurface'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { TripFlow } from '@/components/tms/TripFlow'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { InfoTip } from '@/components/shared/InfoTip'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { toast } from '@/components/ui/use-toast'
import {
  useDispatchPlans, useDispatchPlan, useCreateDispatchPlan, useUpdateDispatchTrip, useMoveDispatchOd, useConfirmDispatchPlan, useDiscardDispatchPlan, useReopenDispatchPlan, useEditDispatchPlan,
  useSettleDispatchTrip, useRespondDispatchTrip, useDispatchPlanSync, useRefreshDispatchPool, useDeleteDispatchTrip, useHoldDispatchOds,
  useVehicleModels, useTransportCompanies, useStorageConditions, conditionLabel,
  type DispatchPlan, type DispatchPlanListItem, type DispatchTrip, type DispatchTripStatus, type StorageConditionRow, type DispatchSegment, SEGMENT_VI,
  type VehicleModel, type DispatchOdFlag,
} from '@/api/hooks'
import { useScopedWarehouses, useScopeCatSet } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'

const nf = (n: number | string | null | undefined, d = 0) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: d }))
const vnd = (n: number | string | null | undefined) => (n == null ? '—' : `${Number(n).toLocaleString('vi-VN')} ₫`)
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không thực hiện được'
/** Lưu / Xoá kế hoạch bị bên Xuất kho chặn (23/10) — câu nhiều dòng nêu từng xe ⇒ hộp thoại, không toast */
const OUTBOUND_BLOCK_CODES = new Set(['OUTBOUND_WORK_BLOCKS', 'PLAN_HAS_OUTBOUND_WORK'])
const tomorrowVN = () => new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })   // hàm, không hằng — màn mở qua đêm
type Tone = 'amber' | 'green' | 'slate' | 'blue' | 'red'
const STATUS_VI: Record<DispatchPlan['status'], { label: string; tone: Tone }> = {
  DRAFT: { label: 'Bản nháp', tone: 'amber' }, TENDERED: { label: 'Chờ ĐVVT phản hồi', tone: 'blue' }, CONFIRMED: { label: 'Đã xác nhận', tone: 'green' }, DISCARDED: { label: 'Đã xoá', tone: 'slate' },
}
/** 17/10 (user chốt): kế hoạch TENDERED mà KHÔNG xe nào chờ / bị ĐVVT từ chối = đang SỬA (vài xe mở lại giữa các xe đã chốt) — badge cũ
 *  "Chờ ĐVVT phản hồi" làm người xem tưởng kẹt ở ĐVVT trong khi cả ba ĐVVT đều không cần phản hồi. */
const planStatusView = (p: DispatchPlan): { label: string; tone: Tone } => {
  if (p.status !== 'TENDERED') return STATUS_VI[p.status]
  const live = p.trips.filter(t => tripStatus(t) !== 'DISCARDED')
  if (live.some(t => tripStatus(t) === 'TENDERED' || tripStatus(t) === 'DECLINED')) return STATUS_VI.TENDERED
  return { label: `Đang sửa · ${nf(live.filter(t => tripStatus(t) === 'DRAFT').length)}/${nf(live.length)} xe mở`, tone: 'amber' }
}
const TRIP_STATUS_VI: Record<DispatchTripStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Nháp', tone: 'amber' }, TENDERED: { label: 'Chờ ĐVVT', tone: 'blue' }, DECLINED: { label: 'ĐVVT từ chối', tone: 'red' },
  CONFIRMED: { label: 'Đã vào KH xuất', tone: 'green' }, DISCARDED: { label: 'Đã bỏ', tone: 'slate' },
}
// Luật "xe cần xử lý" nằm ở components/tms/dispatchIssues (dùng chung với bàn ghép xe — hai góc nhìn phải đếm như nhau)

// Hộp Xác nhận = BẢNG KIỂM (08/10, user: "không muốn văn viết"): mỗi mục một dòng — nhãn · số · "Xem" nhảy tới đúng xe / đơn.
type CheckRow = { k: string; label: string; value: string; tone: 'ok' | 'info' | 'warn'; go?: () => void }
function CheckRows({ rows, close }: { rows: CheckRow[]; close: () => void }) {
  return (
    <div className="divide-y divide-slate-100 whitespace-normal">
      {rows.map(r => (
        <div key={r.k} className="flex items-center gap-2 py-1.5">
          {r.tone === 'warn' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            : <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${r.tone === 'ok' ? 'text-green-600' : 'text-sky-600'}`} />}
          <span className="flex-1 min-w-0 text-slate-700">{r.label}</span>
          <span className="tabular-nums font-semibold text-slate-800 text-right">{r.value}</span>
          <span className="w-9 shrink-0 text-right">
            {r.go && <button type="button" className="py-1 font-medium text-sky-700 hover:underline" onClick={() => { close(); r.go?.() }}>Xem</button>}
          </span>
        </div>
      ))}
    </div>
  )
}

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
  // MỌI KẾ HOẠCH của kho, mọi ngày, cả hai mảng (16/10, tab "Kế hoạch" — thay tab "Nháp" 12/10 vốn chỉ liệt kê nháp mở): bảng ngày · mảng ·
  // trạng thái · xe · đơn · cước · người lập / xác nhận; bấm dòng mở, "Sửa" kế hoạch đã xác nhận, "Huỷ kế hoạch" làm nhầm. Số nháp mở trên nhãn tab.
  const allPlansQ = useDispatchPlans({ warehouse_id: f.warehouseId || undefined }, !!f.warehouseId)
  const allPlans = allPlansQ.data?.items ?? []
  const openPlans = allPlans.filter(p => p.status === 'DRAFT' || p.status === 'TENDERED')
  // kế hoạch đang mở: người chọn → bản nháp mới nhất → bản mới nhất CHƯA BỎ. 06/10 (user: "bên Trung chuyển không có multi select"):
  // nháp Trung chuyển đã Bỏ nháp mà trang vẫn lấy làm kế hoạch đang làm — nháp đã bỏ chỉ để xem nên mọi ô tick / nút Ghép xe biến mất.
  // Nay mảng chỉ còn nháp đã bỏ ⇒ "Chưa có kế hoạch" + Lập kế hoạch; muốn xem lại nháp đã bỏ thì bấm "Xem nháp đã bỏ".
  // 07/10 (C63): lúc "Xem đơn" đang chạy, server tạo dòng kế hoạch TRƯỚC rồi mới ghi đơn theo lô — realtime đưa nháp mới vào danh sách,
  // tự chọn nó là tải giữa chừng (Bàu Bàng: 1.500 / 2.457 đơn) và lần làm mới sau đó bị gộp vào lượt tải ấy. Đang nạp ⇒ giữ kế hoạch cũ;
  // nạp xong `loadOrders` đặt planId.
  const create = useCreateDispatchPlan()
  // 14/10 (user: "bấm Xem đơn là Trung chuyển và Bán hàng cùng load"): mảng kia nạp bằng mutation RIÊNG — dùng chung `create` thì
  // `create.isPending` của lượt hai làm `planId` rơi về lastPlanId (null lúc danh sách chưa kịp có nháp mới) ⇒ màn "Chưa có kế hoạch" chớp
  const createOther = useCreateDispatchPlan()
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
  // SỬA KẾ HOẠCH ĐÃ XÁC NHẬN (16/10, user chốt "mở từng xe"): nút Sửa ở tab Kế hoạch nạp đơn chờ rồi đưa về bàn ở CHẾ ĐỘ SỬA — khung chờ
  // kéo được, xe mới tạo được; xe đã chốt hiện ổ khoá xanh, bấm = "Mở lại" riêng xe đó. Kế hoạch đang mở (nháp / một phần) luôn sửa được.
  // 16/10 tối (user: "Bán hàng và Trung chuyển là một dòng, sửa cũng xem được cả hai"): chế độ sửa theo NGÀY — cả hai mảng của ngày đó.
  // Nhớ trong store bộ lọc (không phải state component): user bấm Sửa 02/10 → sang Dữ liệu bên ngoài nạp ZSD02 → quay lại thì bản state
  // cũ đã quên chế độ sửa ⇒ kế hoạch đã xác nhận về chế độ XEM, không /sync, 130 OD mới không vào Chờ điều ("upload rồi không thấy ở Xem đơn").
  // khoá theo KHO + NGÀY (16/10 tối, tự soi): chỉ ngày thì đổi kho cùng ngày là kế hoạch đã chốt của kho kia vào chế độ sửa mà không ai bấm
  const editDay = f.editDay || null
  const setEditDay = (d: string | null) => setF({ editDay: d ? `${f.warehouseId}|${d}` : '' })
  // 23/10 (user: "khi xem bàn điều lại không thấy các đơn chờ"): chế độ Sửa nhớ trong bộ lọc theo người — phiên sửa đã kết thúc ở nơi khác
  // (Lưu / Khôi phục / về Xem, hoặc hôm qua) mà bàn vẫn nhớ "đang sửa" ⇒ khung chờ chỉ hiện đơn đã nạp (bước nạp chạy lúc bấm Sửa) = 0 OD,
  // 95 đơn Chờ điều biến mất. Kế hoạch đã xác nhận chỉ ở Sửa khi CÒN bản sửa đang mở (`plan.edit`); không thì về Xem, thấy đủ đơn chờ.
  const editing = boardEditing(plan, editDay)
  // đang chuyển Xem → Sửa (chụp bản lưu + nạp đơn chờ, ~2 s): bàn giữ hình chế độ Xem tới khi nạp xong — chuyển một lần, không nháy (23/10)
  const [entering, setEntering] = useState(false)
  // bàn đã dựng lần nào chưa — dựng rồi thì giữ khi sang tab khác (23/10, "phần chuyển phải mượt")
  const [boardSeen, setBoardSeen] = useState(false)
  useEffect(() => { if (f.tab === 'board') setBoardSeen(true) }, [f.tab])
  // CÓ THAY ĐỔI CHƯA LƯU (23/10, user: "switch qua Sửa rồi — có một sự thay đổi thì nút switch không dùng được, phải Lưu hoặc Khôi phục"):
  // so bàn với chữ ký bản đã lưu (server gửi kèm `edit`) — cùng luật với cửa 409 EDIT_DIRTY (mirror `dispatchEdit`)
  const dirty = useMemo(() => !!plan?.edit?.trips && editDirty(
    { trips: plan.edit.trips, ods: plan.edit.ods ?? [] },
    { trips: plan.trips.map(t => ({ id: t.id, status: t.status ?? null })), ods: plan.trips.flatMap(t => t.ods.map(o => ({ od_number: o.od_number, trip_id: t.id }))) },
  ), [plan])
  // AI ĐANG LÀM trên kế hoạch này (16/10 tối, user "hiện tên người đang làm ok") — presence realtime, không ghi DB; chip cạnh trạng thái
  const others = useDispatchPresence(planId, user ? { id: user.id, name: user.name } : null, editing)
  // Cờ SỐNG so với ZSD02 hiện tại (lũy tiến): OD bị SAP thay / bỏ / đã xuất / đã điều sau khi lập + số OD mới về
  // 23/10 (user: "nhiều lúc tôi bấm Xem, tôi không thấy các đơn Chờ điều — vậy không được"): chạy cả ở chế độ XEM — đơn mới vào Chờ điều
  // và việc bên Xuất (đơn đã thực thi) hiện cả khi chưa bấm Sửa
  const live = !!plan && plan.status !== 'DISCARDED'
  const syncQ = useDispatchPlanSync(planId, live)
  const flags = useMemo(() => new Map((syncQ.data?.flags ?? []).map(x => [x.od_number, x])), [syncQ.data])
  // 23/10: bên Xuất đã làm gì trên chuyến của xe đã chốt — đơn đã thực thi (đã quét / giữ nhặt lẻ) tô màu + không tick / kéo để bỏ được
  const work = useMemo(() => ({ ods: new Map((syncQ.data?.work?.ods ?? []).map(w => [w.od_number, w])), trips: new Map((syncQ.data?.work?.trips ?? []).map(w => [w.group_code, w])) }), [syncQ.data])
  // OD MỚI về ZSD02 TỰ vào tab Điều, nhãn "Mới" (user chốt 28/09 — thay nút "Nạp OD mới"). Sync báo có OD mới (realtime khi
  // ZSD02 nạp) ⇒ người có quyền lập nạp ngay; mỗi tập OD thử một lần, lỗi (vd PLAN_BUSY khi người khác đang ghép) thì 15 s sau thử lại.
  const refresh = useRefreshDispatchPool()
  const tried = useRef('')
  const freshKey = syncQ.data?.new_ods ? `${planId}|${(syncQ.data.new_od_numbers ?? []).join(',')}|${syncQ.data.new_ods}` : ''
  useEffect(() => {
    if (!planId || !live || !canPlan || !freshKey || tried.current === freshKey || refresh.isPending) return
    tried.current = freshKey
    refresh.mutateAsync({ id: planId })
      .then(r => { if (r.refreshed.added) toast({ title: `${r.refreshed.added} OD mới vào Chờ điều`, description: 'Nhãn "Mới" ở tab Bán hàng / Trung chuyển của Xem đơn — tick rồi "Thêm vào kế hoạch" nếu cần đi ngày này.' }) })
      .catch(() => { setTimeout(() => { if (tried.current === freshKey) tried.current = '' }, 15_000) })
  }, [planId, live, canPlan, freshKey, refresh])
  // phạm vi Loại kho của người xem (12/10): xe chở loại ngoài phạm vi = việc "Cần xử lý" + chip đỏ, báo trước khi Xác nhận bị 403 (C78)
  const scope = useScopeCatSet()
  const mixChannels = plan?.params?.allow_mix_channels === true
  const ictx = useMemo(() => ({ flags, scope, mixChannels }), [flags, scope, mixChannels])
  const openN = openPlans.length
  const permTabs = useMemo(() => [
    // Xem đơn đứng ĐẦU (27/09 tối): bảng theo trạng thái Điều · Không điều ngày này · Không điều · Đã điều — thay tab "Dữ liệu OD"
    { key: 'review', label: 'Xem đơn', icon: ListChecks }, { key: 'board', label: 'Bàn ghép xe', icon: LayoutGrid },
    // Kế hoạch (16/10, thay Nháp 12/10): mọi kế hoạch của kho, mọi ngày — số trên nhãn là số nháp đang mở
    { key: 'plans', label: openN ? `Kế hoạch · ${nf(openN)} nháp` : 'Kế hoạch', icon: FileText },
    // Bản đồ (01/10, đợt 1 chỉ xem): ghim khách tô màu theo xe — toạ độ từ danh mục Khách hàng
    // 06/10: tab "Danh sách xe" GỘP vào Bàn ghép xe dạng bảng (user: "nếu phù hợp bạn làm") — dòng xe của bảng đã mang đủ cột của danh
    // sách; chọn nhiều xe (tick ô dòng xe) ⇒ "Gán ĐVVT · Đổi dòng xe" trên thanh nổi của bàn
    { key: 'map', label: 'Bản đồ', icon: MapIcon },
    // Lịch sử (20/10, user: "lịch sử toàn bộ, có search / filter — nơi tập kết và kiểm tra"): sổ vết điều vận của kho, kể cả xe đã bỏ / xoá
    { key: 'history', label: 'Lịch sử', icon: History },
  ], [openN])
  const tabs = useMobileTabs('/tms/dispatch', permTabs, f.tab || 'review', (t: string) => setF({ tab: t }))
  const tab = tabs.some(t => t.key === f.tab) ? f.tab : (tabs[0]?.key ?? 'review')
  // Bản đồ + Kế hoạch + Lịch sử không mang cụm thao tác / dải Soát / chỉ số của kế hoạch đang mở
  const planTab = tab !== 'map' && tab !== 'plans' && tab !== 'history'

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
  const settle = useSettleDispatchTrip(), respond = useRespondDispatchTrip(), reopen = useReopenDispatchPlan(), delTrip = useDeleteDispatchTrip(), editApi = useEditDispatchPlan()
  const holdOds = useHoldDispatchOds()
  const [moveDate, setMoveDate] = useState<MoveDateTarget | null>(null)   // 19/10: hộp "Đổi ngày" (cả xe / từng đơn)
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  // xe vừa tạo ở Xem đơn ("Tạo kế hoạch") — bàn ghép xe mở nhóm của chúng một lần rồi trả về [] (07/10)
  const [focusTrips, setFocusTrips] = useState<string[]>([])
  const openTrip = plan?.trips.find(t => t.id === openTripId) ?? null
  const [ask, confirmNode] = useConfirmDialog()
  // 13/10: "Sửa ở bàn ghép xe" từ tab Kế hoạch xuất — bộ lọc đã đặt (kho · ngày · mảng · kế hoạch), còn Số xe đi qua state điều hướng;
  // kế hoạch tải xong thì mở panel xe đó một lần rồi xoá state (tải lại trang không mở lại)
  const location = useLocation()
  const navigate = useNavigate()
  const openGroupCode = (location.state as { openGroupCode?: string } | null)?.openGroupCode ?? null
  useEffect(() => {
    if (!openGroupCode || !plan) return
    const tr = plan.trips.find(t => t.group_code === openGroupCode && tripStatus(t) !== 'DISCARDED')
    if (tr) { setOpenTripId(tr.id); setFocusTrips([tr.id]) }
    navigate(location.pathname, { replace: true, state: null })
  }, [openGroupCode, plan, navigate, location.pathname])

  // lần chuyển / đổi dòng xe / Xác nhận bị LUẬT GHÉP XE chặn ⇒ hộp thoại như trên bàn (14/10); lỗi khác vẫn toast
  // 23/10: Lưu / Xoá bị bên Xuất kho chặn (đã bắt đầu · đã quét · nhặt lẻ) ⇒ hộp thoại liệt kê từng xe + việc kho phải làm (câu dài, nhiều dòng)
  const err = (e: unknown, title: string) => RULE_BLOCK_CODES.has(apiCode(e) ?? '')
    ? void ask(ruleDialog(e))
    : OUTBOUND_BLOCK_CODES.has(apiCode(e) ?? '')
      ? void ask({ title, danger: true, cancelLabel: null, confirmLabel: 'Đã hiểu', body: apiMsg(e) })
      : toast({ variant: 'destructive', title, description: apiMsg(e) })
  // XEM ĐƠN (07/10, user: "nút là Xem đơn, tức là load lấy các đơn"): nạp đơn chưa đi của kho × ngày × mảng vào CHỜ ĐIỀU — không hỏi dải
  // tải (hộp thoại dải đứng trước "Tạo kế hoạch"), không ghép xe nào. Đã có kế hoạch đang mở thì server trả lại đúng kế hoạch đó (`reuse`)
  // — xem đơn không bao giờ thay nháp người khác đang làm.
  const loadOrders = () => {
    if (!f.warehouseId) return
    const wh = f.warehouseId
    create.mutateAsync({ warehouse_id: wh, plan_date: day, segment: seg, reuse: true }).then(p => {
      setF({ planId: p.id, tab: 'review', reviewTab: 'GO' })
      toast({
        title: p.reused ? `Kế hoạch ${SEGMENT_VI[seg]} ngày ${formatDate(day)} đang mở — đã mở lại` : `${nf(p.summary.unreviewed_ods ?? p.summary.pool_ods ?? 0)} đơn chờ điều`,
        description: 'Tick đơn cần đi ngày này rồi bấm "Tạo kế hoạch" — đơn không tick ở lại Chờ điều.',
      })
      // 14/10: nạp luôn MẢNG KIA (Trung chuyển ⇄ Bán hàng) cùng ngày — reuse: đã có nháp thì trả lại, không thay; nối tiếp (không song
      // song) vì hai lượt nạp cùng kho đua thuê kế hoạch; mảng kia hỏng chỉ báo, không làm hỏng mảng đang xem
      return createOther.mutateAsync({ warehouse_id: wh, plan_date: day, segment: otherSeg, reuse: true })
        .then(o => { if (!o.reused) toast({ title: `${SEGMENT_VI[otherSeg]}: ${nf(o.summary.unreviewed_ods ?? o.summary.pool_ods ?? 0)} đơn chờ điều`, description: `Đã nạp sẵn — tab ${SEGMENT_VI[otherSeg]} trong Xem đơn.` }) })
        .catch(e => err(e, `Không nạp được mảng ${SEGMENT_VI[otherSeg]}`))
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
    // 14/10 (user: "làm sai rule cần hiện popup và ngăn chặn"): xe vượt tải / sai luật ghép xe ⇒ cửa Xác nhận trả 409 TRIP_RULE_VIOLATION
    // (bản 25/09 chỉ là một dòng cảnh báo "Xe vượt tải" trong hộp thoại rồi vẫn cho chốt) — nói TRƯỚC, đưa tới đúng xe
    const ruled = open.filter(t => t.ods.length && (t.oversize || ruleWarnings(t, mixChannels).length > 0))
    // chỉ khung chờ CỦA kế hoạch (07/10) — đơn Chờ điều chưa từng vào kế hoạch, không phải "bị bỏ lại"
    const poolN = planView?.summary.pool_ods ?? 0
    // 03/10 tối: cờ "SAP đã post" / "SAP đã gắn xe" chỉ THAM CHIẾU — hỏi lại một lần, không chặn (người không đánh dấu Ngoài app là đã quyết điều)
    const hard = (od: string) => { const k = flags.get(od)?.kind; return !!k && !SOFT_FLAG_KINDS.has(k) }
    const flagged = open.filter(t => t.ods.some(o => hard(o.od_number)))
    // 12/10: xe chở Loại kho ngoài phạm vi người bấm ⇒ cửa Xác nhận 403 CATEGORY_OUT_OF_SCOPE (C78) — nói TRƯỚC, đưa tới đúng xe
    const outScope = open.filter(t => t.ods.length && outOfScopeCats(t.detail.categories, scope).length)
    const softOds = new Set(open.flatMap(t => t.ods.map(o => o.od_number)).filter(od => { const k = flags.get(od)?.kind; return !!k && SOFT_FLAG_KINDS.has(k) }))
    const toBoard = (issue: string) => () => setF({ tab: 'board', issue })
    // OD đã đổi ở SAP sau khi lập (thay / bỏ / sửa / đã vào KH xuất) ⇒ cửa Xác nhận trả 409 — nói TRƯỚC
    if (flagged.length) {
      await ask({
        title: `Chưa xác nhận được: ${flagged.length} xe có OD đổi ở SAP — sửa trên Bàn ghép xe`, danger: true, cancelLabel: null,
        body: close => <CheckRows close={close} rows={[
          ...flagged.slice(0, 8).map(t => ({ k: t.id, tone: 'warn' as const, label: `#${t.seq} ${t.group_code}`,
            value: t.ods.filter(o => hard(o.od_number)).map(o => `${o.od_number} · ${flags.get(o.od_number)?.info ?? ''}`).join('; ') })),
          ...(flagged.length > 8 ? [{ k: 'more', tone: 'warn' as const, label: `… và ${flagged.length - 8} xe nữa`, value: '' }] : []),
          { k: 'go', tone: 'info', label: 'Các xe có OD đổi ở SAP', value: nf(flagged.length), go: toBoard('sapflag') },
        ]} />,
      })
      return
    }
    if (outScope.length) {
      await ask({
        title: `Chưa xác nhận được: ${outScope.length} xe chở Loại kho ngoài phạm vi bạn được giao`, danger: true, cancelLabel: null,
        body: close => <CheckRows close={close} rows={[
          ...outScope.slice(0, 8).map(t => ({ k: t.id, tone: 'warn' as const, label: `#${t.seq} ${t.group_code}`, value: outOfScopeCats(t.detail.categories, scope).join(' + ') })),
          ...(outScope.length > 8 ? [{ k: 'more', tone: 'warn' as const, label: `… và ${outScope.length - 8} xe nữa`, value: '' }] : []),
          { k: 'go', tone: 'info', label: 'Kéo các OD loại đó ra khỏi xe / Trả về Chờ điều, hoặc nhờ người được giao loại này xác nhận', value: nf(outScope.length), go: toBoard('scope') },
        ]} />,
      })
      return
    }
    if (ruled.length) {
      await ask({
        title: `Chưa xác nhận được: ${ruled.length} xe sai quy định ghép xe — sửa trên Bàn ghép xe`, danger: true, cancelLabel: null,
        body: close => <CheckRows close={close} rows={[
          ...ruled.slice(0, 8).map(t => ({ k: t.id, tone: 'warn' as const, label: `#${t.seq} ${t.group_code}`,
            value: [t.oversize ? `vượt tải ${nf(t.load_pct)}%` : '', ...ruleWarnings(t, mixChannels)].filter(Boolean).join(' · ') })),
          ...(ruled.length > 8 ? [{ k: 'more', tone: 'warn' as const, label: `… và ${ruled.length - 8} xe nữa`, value: '' }] : []),
          { k: 'go', tone: 'info', label: 'Lọc các xe này trên Bàn ghép xe', value: nf(ruled.length), go: toBoard(ruled.some(t => ruleWarnings(t, mixChannels).length > 0) ? 'rule' : 'over') },
        ]} />,
      })
      return
    }
    if (split.length) {
      await ask({
        title: `Không xác nhận được: ${split.length} OD nằm ở hai xe — gom mỗi OD về một xe`, danger: true, cancelLabel: null,
        body: close => <CheckRows close={close} rows={[
          ...split.slice(0, 8).map(([od, g]) => ({ k: od, tone: 'warn' as const, label: od, value: g.join(' + ') })),
          ...(split.length > 8 ? [{ k: 'more', tone: 'warn' as const, label: `… và ${split.length - 8} OD nữa`, value: '' }] : []),
          { k: 'go', tone: 'info', label: 'Bàn ghép xe', value: '', go: toBoard('') },
        ]} />,
      })
      return
    }
    // xe trống bị bỏ lúc xác nhận — nói trước, kẻo kế hoạch thành "Chờ ĐVVT" với 0 xe chờ (11/10). Từ 15/10 kéo thả bỏ xe hết OD ngay;
    // còn đếm cho xe trống sót từ trước
    const emptyN = open.filter(t => !t.ods.length).length
    // 23/10: đang SỬA kế hoạch đã xác nhận ⇒ nút này là LƯU — xe đã chốt mở khoá ghi đè cùng Số xe, xe đã chốt bị xoá gỡ khỏi Kế hoạch xuất
    const saving = !!plan.edit
    const savedOpen = open.filter(t => t.confirmed_at && t.ods.length).length
    const rows: CheckRow[] = ([
      ...(saving ? [
        { k: 'saved', tone: 'info' as const, label: 'Xe đã chốt đang mở khoá — ghi lại cùng Số xe (không đổi gì thì chỉ khoá lại)', value: nf(savedOpen) },
        { k: 'ob', tone: 'info' as const, label: 'Chuyến bên Xuất kho đã quét / nhặt lẻ: chỉ Lưu được khi kho đã Tạm dừng chuyến và kế hoạch mới không ít hơn phần kho đã làm', value: '' },
      ] : []),
      { k: 'now', tone: 'ok', label: saving ? 'Xe mới vào Kế hoạch xuất' : 'Xe vào Kế hoạch xuất ngay', value: nf(n - tenderCount - (saving ? savedOpen : 0)) },
      { k: 'tender', tone: 'info', label: 'Xe chờ ĐVVT phản hồi', value: nf(tenderCount) },
      { k: 'empty', tone: 'info', label: 'Xe trống sẽ bị bỏ', value: nf(emptyN) },
      { k: 'nocarrier', tone: 'warn', label: 'Xe chưa có ĐVVT', value: nf(noCarrier), go: toBoard('nocarrier') },
      { k: 'nofreight', tone: 'warn', label: 'Xe chưa có cước', value: nf(noFreight), go: toBoard('nofreight') },
      { k: 'pool', tone: 'warn', label: 'Đơn còn ở khung chờ — về Chờ điều', value: nf(poolN), go: toBoard('') },
      // 13/10 (vòng 3 test): kế hoạch ngày đã qua xác nhận được không ai hỏi — cảnh báo, KHÔNG chặn (hôm qua chưa kịp chốt vẫn phải ghi)
      ...(plan.plan_date < todayVN() ? [{ k: 'past', tone: 'warn' as const, label: 'Ngày kế hoạch đã qua — chuyến Xuất kho sẽ mang ngày này', value: formatDate(plan.plan_date) }] : []),
      { k: 'soft', tone: 'warn', label: 'Đơn SAP báo đã post / đã gắn xe', value: nf(softOds.size), go: () => setF({ tab: 'review' }) },
    ] satisfies CheckRow[]).filter(r => r.value !== '0')
    const ok = await ask({
      title: saving ? `Lưu thay đổi kế hoạch ngày ${formatDate(plan.plan_date)}?` : `Xác nhận ${n} xe vào Kế hoạch xuất ngày ${formatDate(plan.plan_date)}?`,
      confirmLabel: saving ? 'Lưu' : 'Xác nhận',
      danger: rows.some(r => r.tone === 'warn'),
      body: close => <CheckRows rows={rows} close={close} />,
    })
    if (ok === null) return
    confirm.mutateAsync(plan.id).then(r => {
      if (saving && !r.derive_failed) {
        void afterSaved(plan.id)
        toast({
          title: `Đã lưu kế hoạch ngày ${formatDate(plan.plan_date)}`,
          description: [`${nf(r.trips - (r.unchanged ?? 0))} xe ghi vào Kế hoạch xuất`, r.unchanged ? `${nf(r.unchanged)} xe mở khoá không đổi — khoá lại` : '', r.removed ? `${nf(r.removed)} xe đã xoá — chuyến bên Xuất ngừng, khung giờ nhả` : '', r.tendered ? `${nf(r.tendered)} xe mới chờ ĐVVT phản hồi` : '', r.replan_error ? `chuyến chưa dội xuống: ${r.replan_error}` : ''].filter(Boolean).join(' · '),
          variant: r.replan_error ? 'destructive' : undefined,
        })
        return
      }
      toast({
        // ⚠️ KHÔNG khẳng định "chuyến đã sinh" khi chưa đo được. Đường dội xuống có thể TỪ CHỐI TRỌN GÓI
        // mà không ném lỗi (derive_failed) — trước 24/09 câu này vẫn in "đã sinh" trong khi thực tế 0/50.
        // 20/10: bị từ chối trước khi ghi ⇒ BE gỡ lại (rolled_back), xe vẫn NHÁP — sửa ngay trên bàn (dòng DISPATCH khoá ở tab Kế hoạch xuất)
        title: r.derive_failed
          ? (r.rolled_back ? 'Chưa xác nhận được — xe vẫn ở dạng nháp' : `Đã ghi ${r.lines} dòng Kế hoạch xuất — nhưng CHƯA sinh được chuyến nào`)
          : r.tendered ? `Đã ghi ${r.trips} xe vào Kế hoạch xuất · ${r.tendered} xe chờ ĐVVT phản hồi` : `Đã ghi ${r.lines} dòng Kế hoạch xuất cho ${r.trips} xe`,
        description: r.derive_failed
          ? `${r.derive_message ?? 'đường sinh chuyến từ chối kế hoạch'} — sửa xe bị nêu trên Bàn ghép xe rồi xác nhận lại.`
          : r.replan_error ? `Kế hoạch đã lưu nhưng chuyến chưa dội xuống: ${r.replan_error}` : r.tendered ? `Xe chờ: ${r.tendered_group_codes.join(', ')} — ghi "ĐVVT nhận / từ chối" trong panel từng xe.` : 'Chuyến bên Xuất kho + lệnh VC bên Kế hoạch VC đã sinh.',
        variant: r.replan_error || r.derive_failed ? 'destructive' : undefined,
      })
    }).catch(e => err(e, saving ? 'Chưa lưu được' : 'Không xác nhận được'))
  }
  // Tab Kế hoạch (16/10 tối): MỘT DÒNG = MỘT NGÀY (cả Bán hàng lẫn Trung chuyển) — Mở / Sửa / Xoá áp cho mọi kế hoạch sống của ngày.
  // Mở: giữ mảng đang xem nếu ngày đó có, không thì sang mảng kia; bàn chuyển mảng bằng công tắc Bán hàng | Trung chuyển như thường.
  const [discardingId, setDiscardingId] = useState<string | null>(null)
  const livePlans = (d: DispatchPlanDay) => d.plans.filter(p => p.status !== 'DISCARDED')
  const openDay = (d: DispatchPlanDay) => {
    const target = (d.discarded ? d.plans : livePlans(d)).find(p => (p.segment ?? 'SALES') === seg) ?? d.plans[0]
    if (!target) return
    // bấm dòng = XEM bản lúc lưu ⇒ rời chế độ sửa (nếu đang sửa ngày này thì "Sửa" đặt lại)
    setF({ planDate: d.plan_date, planId: target.id, segment: target.segment ?? 'SALES', tab: 'board', editDay: '' })
  }
  // SỬA kế hoạch đã xác nhận (16/10; 23/10 user chốt "thay đổi gì sẽ có nút Lưu, lưu xong mới tính kế hoạch mới; Khôi phục = về bản đã lưu"):
  // chụp BẢN ĐÃ LƯU, nạp đơn chờ MỚI NHẤT (ZSD02 hiện tại) rồi đưa MỌI đơn Chờ điều vào khung chờ (review_all — 16/10 tối, user: "sửa mà
  // không có đơn chờ"), về Bàn ghép xe ở chế độ sửa. Mọi thao tác sau đó là NHÁP — Kế hoạch xuất · chuyến bên Xuất · khung giờ chỉ đổi khi
  // bấm Lưu. Áp cho CẢ HAI mảng của ngày: mảng đã chốt / mở một phần nạp kiểu Sửa (review_all); mảng còn nguyên nháp chỉ nạp OD mới.
  const startEdit = (d: DispatchPlanDay) => {
    const targets = livePlans(d)
    if (!targets.length) return
    openDay(d)
    setEditDay(d.plan_date)   // sau openDay (openDay xoá editDay)
    setDiscardingId(targets[0].id)
    setEntering(true)
    Promise.all(targets.map(p => (p.status !== 'DRAFT' ? editApi.mutateAsync({ plan_id: p.id, action: 'begin' }) : Promise.resolve(null))
      .then(() => refresh.mutateAsync({ id: p.id, review_all: p.status !== 'DRAFT' })).then(r => ({ p, r })))).then(rs => {
      const reviewed = rs.reduce((a, x) => a + (x.r.refreshed.reviewed ?? 0), 0), added = rs.reduce((a, x) => a + x.r.refreshed.added, 0)
      const late = rs.reduce((a, x) => a + (x.r.refreshed.late_skipped ?? 0), 0)   // 20/10: SO tạo sau ngày đi ở lại Chờ điều — nói rõ
      toast({
        title: reviewed ? `${nf(reviewed)} đơn chờ vào khung chờ${added ? ` (${nf(added)} mới từ ZSD02)` : ''}` : added ? `${nf(added)} OD mới từ ZSD02` : 'Không có đơn chờ',
        description: `${rs.map(x => `${SEGMENT_VI[x.p.segment ?? 'SALES']}: ${nf(x.r.refreshed.reviewed ?? 0)}`).join(' · ')}.${late ? ` ${nf(late)} đơn có SO tạo SAU ngày đi ở lại Chờ điều (chữ đỏ) — tick tay ở Xem đơn nếu đó là đơn bù.` : ''} Kéo đơn chờ lên xe mới; xe đã chốt tô tím — bấm ổ khoá để mở khoá xe cần sửa. Mọi thay đổi CHƯA đụng Kế hoạch xuất / bên Xuất cho tới khi bấm Lưu; Khôi phục = về bản đã lưu.`,
      })
    }).catch(e => err(e, 'Không nạp được đơn chờ')).finally(() => { setDiscardingId(null); setEntering(false) })
  }
  // ĐỔI NGÀY TỪNG ĐƠN (19/10, ca "đơn rớt không bốc" — user: "đổi ngày dễ như bên Kế hoạch xuất"): ba bước sẵn có nối liền —
  // mở khoá xe → hoãn đơn tới ngày chọn (rời xe, dấu hoãn + lý do) → chốt lại xe với phần còn lại (cùng Số xe, khung giờ giữ). Chốt lại đi qua
  // cùng cửa Lưu (23/10): chuyến bên Xuất đã quét / đang xuất thì bị chặn kèm việc kho phải làm. Hỏng giữa chừng: xe đang ở nháp, Khôi phục được.
  const moveOdsDate = async (t: DispatchTrip, odNumbers: string[], date: string, reason?: string) => {
    if (!plan) return
    setEditDay(plan.plan_date)
    const r = await reopen.mutateAsync({ plan_id: plan.id, trip_ids: [t.id] })
    if (!r.reopened.trips) throw new Error(r.reopened.blocked[0]?.reason ?? 'Không mở khoá được xe')
    const ids = (r.trips.find(x => x.id === t.id)?.ods ?? []).filter(o => odNumbers.includes(o.od_number)).map(o => o.id)
    if (!ids.length) throw new Error('Không thấy các đơn này trên xe sau khi mở khoá — tải lại trang')
    let h: Awaited<ReturnType<typeof holdOds.mutateAsync>>
    try { h = await holdOds.mutateAsync({ plan_id: plan.id, ids, until: date, reason }) }
    catch (e) { throw new Error(`Xe #${t.seq} đã mở khoá nhưng chưa hoãn được đơn: ${apiMsg(e)} — sửa trên bàn rồi Lưu, hoặc Khôi phục.`) }
    const still = h.trips.find(x => x.id === t.id)
    if (still && still.ods.length) {
      try { await settle.mutateAsync(t.id) }
      catch (e) { throw new Error(`Đã hoãn ${odNumbers.length} đơn nhưng chưa chốt lại được xe #${t.seq}: ${apiMsg(e)} — xử lý rồi bấm Lưu, hoặc Khôi phục.`) }
    }
    toast({ title: `Đã dời ${odNumbers.length} đơn sang ${formatDate(date)}`, description: `${odNumbers.join(', ')} rời xe #${t.seq} ${t.group_code} (dấu hoãn, lập kế hoạch ngày đó thì về Chờ điều)${still && still.ods.length ? ` · xe chốt lại với ${new Set(still.ods.map(o => o.od_number)).size} đơn còn lại, khung giờ giữ` : ' · xe hết đơn — bấm Lưu để gỡ xe khỏi Kế hoạch xuất'}.` })
    if (openTrip?.id === t.id && !(still && still.ods.length)) setOpenTripId(null)
  }
  // MỞ KHOÁ MỘT XE (16/10; 23/10 — chỉ về nháp trên bàn, KHÔNG đụng Kế hoạch xuất / chuyến bên Xuất / khung giờ cho tới khi Lưu)
  const reopenTrip = async (t: DispatchTrip) => {
    if (!plan) return
    if (await ask({
      title: `Mở khoá xe #${t.seq} (${t.group_code}) để sửa?`, confirmLabel: 'Mở khoá',
      body: 'Xe về nháp trên bàn để sửa. Kế hoạch xuất, chuyến bên Xuất kho và khung giờ GIỮ NGUYÊN cho tới khi bạn bấm Lưu; Khôi phục = bỏ mọi thay đổi, về bản đã lưu.\nLưu xe mà bên Xuất đã quét / đang xuất: kho phải Tạm dừng chuyến trước, và kế hoạch mới không được ít hơn phần kho đã làm.',
    }) === null) return
    setEditDay(plan.plan_date)
    try {
      const r = await reopen.mutateAsync({ plan_id: plan.id, trip_ids: [t.id] })
      toast({
        title: r.reopened.trips ? `Đã mở khoá xe #${t.seq} — sửa rồi bấm Lưu` : `Không mở khoá được xe #${t.seq}`,
        description: r.reopened.blocked[0]?.reason ?? 'Xe hết tô tím, về nháp. Kế hoạch xuất / bên Xuất chưa đổi gì.',
        variant: r.reopened.trips ? undefined : 'destructive',
      })
    } catch (e) { err(e, 'Không mở khoá được xe') }
  }
  // KHÔI PHỤC (23/10, user: "chưa lưu bấm vào thì trở lại bản đã lưu"): xe + đơn trên xe về đúng bản đã lưu, rời chế độ sửa
  const doRestore = async () => {
    if (!plan) return
    if (await ask({
      title: `Khôi phục kế hoạch ngày ${formatDate(plan.plan_date)} về bản đã lưu?`, danger: true, confirmLabel: 'Khôi phục', cancelLabel: 'Không, tiếp tục sửa',
      body: 'Bỏ MỌI thay đổi chưa Lưu: xe mở khoá khoá lại như cũ, xe mới tạo bị bỏ, đơn kéo lên xe về khung chờ, xe đã xoá dựng lại. Kế hoạch xuất và bên Xuất không bị đụng (chúng chưa từng đổi).',
    }) === null) return
    editApi.mutateAsync({ plan_id: plan.id, action: 'restore' }).then(r => {
      void afterSaved(plan.id)
      toast({ title: `Đã khôi phục bản đã lưu — ${nf(r.restored?.trips ?? 0)} xe` })
    }).catch(e => err(e, 'Không khôi phục được'))
  }
  // CÔNG TẮC XEM | SỬA trên bàn (23/10, user: "bổ sung nút Sửa ở bàn làm việc ở trạng thái Xem; switch qua Sửa rồi — có thay đổi thì nút switch
  // không dùng được, phải Lưu hoặc Khôi phục"). Sửa = đúng nút Sửa ở tab Kế hoạch (cả hai mảng của ngày). Về Xem: bỏ bản chụp của mọi mảng
  // trong ngày — server so lại, mảng nào còn thay đổi thì 409 EDIT_DIRTY và bàn ở lại chế độ Sửa.
  const toEdit = () => {
    const d = plan ? groupPlanDays(planListAll).find(x => !x.discarded && x.plan_date === plan.plan_date) : null
    if (d) startEdit(d)
  }
  // `skipId`: mảng vừa Lưu / Khôi phục (bản chụp của nó server đã xoá) — mảng kia chưa đổi gì thì bỏ bản chụp luôn, không thì ở lại Sửa
  const endEditDay = async (skipId?: string) => {
    if (!plan) return
    // hai mảng gửi SONG SONG (bản đầu nối tiếp — mỗi mảng chờ một vòng máy chủ)
    await Promise.all(planListAll.filter(x => x.id !== skipId && x.status !== 'DISCARDED' && x.plan_date === plan.plan_date).map(p => editApi.mutateAsync({ plan_id: p.id, action: 'end' })))
    setEditDay(null)
  }
  const toView = () => endEditDay().catch(e => err(e, 'Chưa về chế độ Xem được'))
  const afterSaved = (id: string) => endEditDay(id).catch(e => toast({ title: 'Vẫn ở chế độ Sửa', description: apiMsg(e) }))
  const lockView = editing && (dirty || isOpen)
  const modeTip = !editing ? 'Đang XEM — bấm Sửa để nạp đơn chờ và sửa kế hoạch (mọi thay đổi chỉ áp khi bấm Lưu)'
    : dirty ? 'Có thay đổi chưa Lưu — bấm Lưu hoặc Khôi phục rồi mới về Xem được'
    : isOpen ? 'Kế hoạch còn xe nháp / chờ ĐVVT — Xác nhận hoặc Xoá rồi mới về Xem được'
    : 'Đang SỬA, chưa thay đổi gì — bấm Xem để về chế độ chỉ xem'
  // XOÁ KẾ HOẠCH (23/10, user: "đơn giản chỉ là 1 nút để giải quyết lỡ tay tạo nhầm kế hoạch — xoá nó đi"): thay Bỏ nháp · Bỏ xe chưa chốt ·
  // Huỷ kế hoạch. Xoá mềm — kế hoạch còn ở tab Kế hoạch (Đã xoá). Bên Xuất đã bắt đầu / quét / nhặt lẻ ở xe nào thì không xoá gì, nêu từng xe.
  type DeleteTarget = Pick<DispatchPlanListItem, 'id' | 'plan_date' | 'segment' | 'summary'>
  const deleteBody = (n: number) => `${n ? `${nf(n)} xe đã vào Kế hoạch xuất sẽ bị gỡ: chuyến bên Xuất kho NGỪNG (giữ lại để tra cứu, không ghi đè — lập lại sẽ ra Số xe mới), lệnh VC nhả khung giờ. ` : ''}Đơn về Chờ điều. Kế hoạch vẫn xem được ở tab Kế hoạch (Đã xoá).\nXe mà bên Xuất đã bắt đầu / đã quét / đang nhặt lẻ / đã hoàn thành: KHÔNG xoá được — kho phải gỡ trước.`
  const deletePlans = async (targets: DeleteTarget[], label: string) => {
    const n = targets.reduce((a, p) => a + (p.summary?.confirmed ?? 0), 0)
    if (await ask({ title: `Xoá kế hoạch ${label}?`, danger: true, confirmLabel: 'Xoá kế hoạch', cancelLabel: 'Không, giữ kế hoạch', body: deleteBody(n) }) === null) return
    setDiscardingId(targets[0].id)
    try {
      let trips = 0
      for (const p of targets) { const r = await discard.mutateAsync(p.id); trips += r.discarded_trips; if (p.id === planId) setF({ planId: '', editDay: '' }) }
      toast({ title: `Đã xoá kế hoạch ${label} — ${nf(trips)} xe` })
    } catch (e) { err(e, 'Chưa xoá được kế hoạch') } finally { setDiscardingId(null) }
  }
  const deleteDay = (d: DispatchPlanDay) => {
    const targets = livePlans(d)
    if (targets.length) void deletePlans(targets, `ngày ${formatDate(d.plan_date)} (${targets.map(p => SEGMENT_VI[p.segment ?? 'SALES']).join(' · ')})`)
  }
  const confirmedN = plan ? plan.trips.filter(t => tripStatus(t) === 'CONFIRMED').length : 0
  // xe đã từng vào Kế hoạch xuất (kể cả đang mở khoá sửa) — xoá chúng cần quyền xác nhận
  const savedN = plan ? plan.trips.filter(t => tripStatus(t) !== 'DISCARDED' && (tripStatus(t) === 'CONFIRMED' || !!t.confirmed_at)).length : 0
  const doSettle = async (t: DispatchTrip) => {
    const tender = needsTender(t)
    if (await ask(tender
      ? { title: `Chào xe ${t.group_code} cho ${t.detail.carrier?.name ?? 'ĐVVT'}?`, body: 'Xe sẽ CHỜ ĐVVT phản hồi.', confirmLabel: 'Chào xe' }
      : { title: `Chốt xe ${t.group_code} vào Kế hoạch xuất ngay?`, body: 'ĐVVT không cần phản hồi.', confirmLabel: 'Chốt xe' }) === null) return
    settle.mutateAsync(t.id).then(r => toast({
      title: r.derive_failed ? (r.rolled_back ? `Xe ${r.group_code}: chưa chốt được — xe vẫn ở dạng nháp` : `Xe ${r.group_code}: đã ghi kế hoạch nhưng CHƯA sinh được chuyến`) : r.trip_status === 'TENDERED' ? `Xe ${r.group_code} đang chờ ĐVVT phản hồi` : `Xe ${r.group_code} đã vào Kế hoạch xuất`,
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
  // 16/10: có xe NHÁP là xác nhận được — kể cả kế hoạch đã xác nhận đang ở chế độ Sửa (xe mới / xe vừa mở khoá); xe đã chốt giữ nguyên
  // 23/10: đang SỬA (có bản đã lưu) ⇒ nút chính là LƯU, luôn hiện (xoá xe đã chốt cũng là thay đổi cần Lưu) + KHÔI PHỤC
  const saving = !!plan?.edit && plan.status !== 'DISCARDED'
  const confirmIsNext = canConfirm && !!plan && plan.status !== 'DISCARDED' && (saving || isDraft || plan.trips.some(t => tripStatus(t) === 'DRAFT' && t.ods.length > 0))
  const actionItems: ActionItem[] = []
  // chưa xe nào ⇒ nút Xác nhận kế hoạch KHOÁ kèm lý do
  if (confirmIsNext) actionItems.push(saving
    ? { key: 'confirm', icon: CheckCircle2, label: 'Lưu', tip: 'Lưu thay đổi: xe đã chốt mở khoá ghi lại cùng Số xe, xe mới vào Kế hoạch xuất, xe đã chốt bị xoá gỡ khỏi Kế hoạch xuất. Bên Xuất đã quét / đang xuất thì kho phải Tạm dừng chuyến và kế hoạch mới không được ít hơn phần kho đã làm', primary: true, variant: 'default', onClick: doConfirm, disabled: confirm.isPending, busy: confirm.isPending }
    : { key: 'confirm', icon: CheckCircle2, label: 'Xác nhận', tip: noTripYet ? 'Chưa có xe nào — tab Xem đơn: tick đơn rồi bấm "Tạo kế hoạch"; soát xe ở Bàn ghép xe rồi mới xác nhận' : tenderCount ? `Ghi các xe vào Kế hoạch xuất; ${tenderCount} xe của ĐVVT "cần phản hồi" sẽ chờ ĐVVT nhận` : 'Ghi các chuyến vào Kế hoạch xuất — chuyến + lệnh VC tự sinh', primary: true, variant: 'default', onClick: doConfirm, disabled: confirm.isPending || noTripYet, busy: confirm.isPending })
  // Nút "Xem đơn" ở hàng này BỎ 16/10 (user: "có 2 mục Xem đơn — bỏ ở dưới cho gọn"): nó tạo nháp MỚI cho ngày đã có kế hoạch xác nhận; nay
  // thêm đơn vào ngày đó = "Sửa" ở tab Kế hoạch (nạp đơn chờ vào chính kế hoạch ấy). Chưa có kế hoạch nào ⇒ nút giữa màn là lối duy nhất.
  // Nút "Mở lại" cả kế hoạch BỎ 23/10 — mở khoá từng xe bằng ổ khoá trên xe (thay đổi chỉ áp khi Lưu)
  if (canPlan && saving) actionItems.push({ key: 'restore', icon: RotateCcw, label: 'Khôi phục', tip: 'Bỏ mọi thay đổi chưa Lưu, về bản đã lưu (xe mở khoá khoá lại, xe mới bị bỏ, đơn về chỗ cũ). Kế hoạch xuất / bên Xuất không đổi', onClick: () => void doRestore(), disabled: editApi.isPending, busy: editApi.isPending })
  if (canExport && plan) actionItems.push({ key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất kế hoạch theo cột file KH điều vận', onClick: doExport, mobileHidden: true })
  // 14/10 (user: "thu gọn action lên trên, icon với tooltip, ưu tiên không gian"): chỉ nút chính có chữ; Xoá = icon đỏ + tooltip
  // XOÁ KẾ HOẠCH (23/10) — một nút thay Bỏ nháp / Bỏ xe chưa chốt / Huỷ kế hoạch; xe đã vào Kế hoạch xuất cần quyền xác nhận
  if (plan && plan.status !== 'DISCARDED' && canPlan && (!savedN || canConfirm)) actionItems.push({ key: 'delete', icon: Trash2, label: 'Xoá kế hoạch', tip: 'Xoá kế hoạch làm nhầm — đơn về Chờ điều; xe đã vào Kế hoạch xuất: chuyến bên Xuất ngừng (giữ lại), khung giờ nhả. Bên Xuất đã bắt đầu / quét / nhặt lẻ thì không xoá được', danger: true, variant: 'outline', className: 'text-red-600 border-red-200 hover:bg-red-50', onClick: () => void deletePlans([plan], `${SEGMENT_VI[plan.segment ?? 'SALES']} ngày ${formatDate(plan.plan_date)}`), disabled: discard.isPending })

  const all = plan?.trips ?? []
  const todoN = useMemo(() => all.filter(t => needsWork(t, ictx)).length, [all, ictx])
  const issueN = useMemo(() => {
    const m = {} as Record<IssueKey, number>
    for (const i of ISSUES) m[i.key] = 0
    for (const t of all) for (const k of issuesOf(t, ictx)) m[k]++
    return m
  }, [all, ictx])
  const sum = plan?.summary
  const s = plan ? planStatusView(plan) : null
  // 14/10 (user: "bố cục lộn xộn, không gian đọc hẹp — thu gọn action / filter lên trên, icon + tooltip"): dải Soát không còn là một
  // hàng riêng — đưa vào thanh công cụ của bàn (DispatchBoard nhận qua `soat`), chrome trước bảng từ 5 hàng còn 2.
  // Lựa chọn + số của từng lựa chọn vẫn NHÌN THẤY không cần bấm (user chốt 17/09); câu "không còn xe chờ người quyết" vào tooltip.
  const soatNode = plan ? (
    <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Soát xe">
      {([{ k: '', label: 'Tất cả', n: all.length, tip: 'Mọi xe trong kế hoạch' },
         { k: 'todo', label: 'Cần xử lý', n: todoN, tip: todoN === 0
           ? `Không còn xe nào chờ người quyết${issueN.nofreight ? ` — còn ${issueN.nofreight} xe chưa có cước (bảng cước thiếu tuyến, không sửa ở đây được)` : ''}`
           : 'Xe người CÒN ĐÓNG ĐƯỢC (thiếu ĐVVT / dòng xe / vượt tải / sai quy định ghép xe / Non tải / bị từ chối). "Chưa có cước" không tính vào đây vì thường là bảng cước chưa có tuyến đó — xem riêng bằng chip bên cạnh.' },
         ...ISSUES.filter(i => issueN[i.key] > 0).map(i => ({ k: i.key as string, label: i.label, n: issueN[i.key], tip: i.tip })),
        ]).map(o => (
        <button key={o.k || 'all'} type="button" title={o.tip} onClick={() => setF({ issue: o.k })} aria-pressed={f.issue === o.k}
          className={`flex items-center gap-1 rounded-md px-1.5 h-9 sm:h-7 text-[11px] font-medium whitespace-nowrap ${
            f.issue === o.k ? 'bg-slate-800 text-white'
            : o.k === 'todo' && o.n > 0 ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
            : o.k === 'todo' ? 'bg-green-50 text-green-700 hover:bg-green-100'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          {o.label}
          <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${f.issue === o.k ? 'bg-white/25 text-white' : 'bg-white text-slate-500'}`}>{nf(o.n)}</span>
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* ĐẦU TRANG = HAI HÀNG CỐ ĐỊNH trên máy tính (14/10 tối, user: "màn 24 inch hiển thị khác — phải đồng bộ với các loại màn hình
            trên máy tính, đó là yêu cầu của toàn app"): bản trước là MỘT hàng flex-wrap, phần tử nào vừa thì đứng hàng 1 ⇒ màn 24" dồn cả
            cụm Xác nhận + dải chỉ số lên hàng 1 (dải còn ~300 px, cắt mất nửa), màn 1580 thì xuống hàng 2. Nay từ xl (1280) trở lên:
            hàng 1 = tiêu đề · tab · Kho · Ngày · Mảng; hàng 2 = kế hoạch · trạng thái · Khai thiếu · nút · dải chỉ số (flex-1) — KHÔNG xuống
            dòng ở bất kỳ màn nào ≥ 1280 (`xl:flex-nowrap`), màn rộng thì dải rộng ra. Dưới 1280 (máy tính bảng / điện thoại) vẫn wrap. */}
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-2 xl:gap-1.5 flex-wrap xl:flex-nowrap">
            <h1 className="text-sm font-semibold text-slate-800 hidden sm:inline-flex items-center gap-1.5 shrink-0"><Waypoints className="h-4 w-4 text-sky-600" /> Điều vận</h1>
            {/* Tab CẠNH tiêu đề (khuôn app — skill table-format 22); điện thoại chiếm trọn hàng đầu */}
            {/* 23/10 (đo 1280 + menu mở: hàng này dài hơn khung 23 px ⇒ nút "Trung chuyển" bị cắt, bấm vào cả trang trượt ngang): tab đệm px-2
                (gọn 40 px ở mọi cỡ) + từ xl dải tab được CO — chỉ khi còn chật (nhãn "Kế hoạch · n nháp" dài thêm) mới cuộn có mép mờ, Kho co trước */}
            <Tabs value={tab} onValueChange={v => setF({ tab: v })} className="w-full sm:w-auto order-first sm:order-none shrink-0 xl:shrink-[0.01] xl:min-w-0">
              <TabsList className="h-8 max-w-full overflow-x-auto">
                {tabs.map(t => <TabsTrigger key={t.key} value={t.key} className="gap-1 px-2 text-xs"><t.icon className="h-3.5 w-3.5" /> {t.label}</TabsTrigger>)}
              </TabsList>
              {tabs.map(t => <TabsContent key={t.key} value={t.key} className="hidden" />)}
            </Tabs>
            {/* Kho + Ngày CHUNG một hàng trên điện thoại (bản cũ Kho chiếm trọn một hàng riêng) */}
            {/* min-w: không có thì flex-1 co ô Kho về ~20 px khi hàng còn chỗ cho ô ngày (đo 390 px, 25/09) */}
            {/* ≥ 1280: hàng 1 không xuống dòng ⇒ ô Kho là phần DUY NHẤT được co (tới 140 px) khi màn hẹp + sidebar mở */}
            <div className="flex-1 min-w-[150px] sm:flex-none sm:w-48 xl:shrink-[4] xl:min-w-[112px]"><WarehouseSingleSelect warehouses={whs} value={f.warehouseId} onChange={v => setF({ warehouseId: v, planId: '' })} /></div>
            <Input type="date" value={day} onChange={e => setF({ planDate: e.target.value, planId: '' })} className="h-9 sm:h-7 w-[128px] text-xs shrink-0" title="Ngày giao (ngày xe chạy)" />
            {/* MẢNG (03/10 tối): hai kế hoạch riêng cùng kho × ngày — switch nhỏ, nhớ theo người; ở Xem đơn còn có tab Trung chuyển | Bán hàng */}
            <div className="inline-flex shrink-0 rounded-md border border-slate-200 p-0.5" title="Mảng điều vận — mỗi mảng một kế hoạch riêng cùng kho × ngày. Khách tick 'Trung chuyển' ở Khách hàng thì đơn vào Trung chuyển, còn lại Bán hàng; lấy đơn sang mảng mình ở tab Xem đơn.">
              {(['SALES', 'TRANSFER'] as const).map(s => (
                <button key={s} type="button" onClick={() => setF({ segment: s, planId: '' })} aria-pressed={seg === s}
                  className={`rounded px-2 xl:px-1.5 h-8 sm:h-6 text-[11px] font-medium ${seg === s ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{SEGMENT_VI[s]}</button>
              ))}
            </div>
          </div>
          {/* HÀNG 2 — kế hoạch đang xem: chọn kế hoạch · trạng thái · Khai thiếu · nút · dải chỉ số (chỉ ở Bàn ghép xe) */}
          {planTab && !!plan && (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap xl:flex-nowrap min-w-0">
              {/* ô chọn kế hoạch (cùng ngày có nhiều bản) BỎ 16/10 — chọn ở tab Kế hoạch (bảng mọi kế hoạch của kho) */}
              {/* Trạng thái + tham số lập GỌN vào ⓘ (user 25/09 tối: "bàn làm việc rộng rãi nhất có thể") — bản cũ là một
                  hàng meta riêng dưới thanh công cụ */}
              {plan && s && planTab && (
                <span className="inline-flex items-center gap-1 shrink-0">
                  <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                  {/* công tắc XEM | SỬA (23/10) — chỉ cho kế hoạch đã có bản lưu (nháp nguyên thì luôn sửa); có thay đổi chưa Lưu ⇒ khoá ở Sửa */}
                  {canPlan && plan.status !== 'DISCARDED' && (plan.status === 'CONFIRMED' || !!plan.edit) && (
                    <span className="inline-flex shrink-0 rounded-md border border-slate-200 p-0.5" role="group" aria-label="Chế độ bàn" title={modeTip} data-edit-dirty={dirty ? '1' : '0'}>
                      {([
                        { k: 'view', label: 'Xem', icon: Eye, spin: false, on: !editing && !entering, disabled: entering || (editing && (lockView || editApi.isPending)), go: () => void toView() },
                        // đang mở Sửa (~2 s nạp đơn chờ): nút Sửa sáng NGAY + vòng xoay — bấm là thấy phản hồi, bàn chuyển một lần khi nạp xong
                        { k: 'edit', label: entering ? 'Đang mở…' : 'Sửa', icon: entering ? Loader2 : Pencil, spin: entering, on: editing || entering, disabled: !editing && (editApi.isPending || !!discardingId), go: toEdit },
                      ] as const).map(o => (
                        <button key={o.k} type="button" aria-pressed={o.on} disabled={o.disabled} onClick={o.on ? undefined : o.go}
                          className={`inline-flex items-center gap-1 rounded px-2 h-8 sm:h-6 text-[11px] font-medium disabled:cursor-not-allowed ${o.on ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100 disabled:opacity-40'}`}>
                          <o.icon className={`h-3.5 w-3.5 ${o.spin ? 'animate-spin' : ''}`} />{o.label}
                        </button>
                      ))}
                    </span>
                  )}
                  <InfoTip tip={<div className="space-y-0.5 text-xs">
                    <div><b>{plan.warehouse?.name}</b> · giao {formatDate(plan.plan_date)}</div>
                    <div>Lập {formatTimestampDate(plan.created_at)}{plan.created_by ? ` bởi ${plan.created_by}` : ''}</div>
                    <div>Số khách cùng xe = nhỏ nhất trong (dòng xe · kênh / khách) — chưa khai = một khách một xe · {plan.params.allow_mix_channels ? 'cho trộn kênh khách' : 'không trộn kênh khách'}</div>
                    <div>{plan.params.allow_mix_categories === false ? 'Không ghép nhiều Loại kho trên một chuyến' : 'Cho ghép nhiều Loại kho trên một chuyến'}{plan.params.follow_categories?.length ? ` · đi kèm đơn: ${plan.params.follow_categories.join(', ')}` : ''}</div>
                    <div>Lúc nạp: {nf(plan.params.pool_ods)} đơn chờ điều · {nf(plan.params.in_plan)} đơn đã có trong Kế hoạch xuất</div>
                    <div className="text-slate-500">Tham số theo kho: Cài đặt WMS → Kho → "XUẤT — Điều vận".</div>
                  </div>} />
                  {/* người khác đang mở kế hoạch này: sửa (hổ phách) / xem (xám) — mọi cửa ghi vẫn thuê kế hoạch, người sau được 409 */}
                  {others.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 h-9 sm:h-7 text-[11px] text-amber-900 whitespace-nowrap max-w-[260px] truncate" data-presence={others.length}
                      title={`Đang mở kế hoạch này: ${others.map(o => `${o.name} (${o.mode === 'edit' ? 'đang sửa' : 'xem'})`).join(', ')}. Hai người cùng ghi thì người sau được báo "đang được người khác cập nhật"; Tối ưu lại sắp mọi xe chưa khoá — khoá xe đã ưng trước.`}>
                      <Users className="h-3.5 w-3.5 shrink-0" />
                      {others.filter(o => o.mode === 'edit').length ? <b>{others.filter(o => o.mode === 'edit').map(o => o.name).join(', ')} đang sửa</b> : null}
                      {others.some(o => o.mode === 'view') && <span className="text-slate-500">{others.filter(o => o.mode === 'edit').length ? ' · ' : ''}{others.filter(o => o.mode === 'view').map(o => o.name).join(', ')} xem</span>}
                    </span>
                  )}
                </span>
              )}
              {/* KHAI THIẾU (26/09, user: "không khai báo đúng thì FG02 có thể dùng container mất") — máy xếp sai mà không lỗi
                  nào nổ, nên phải nói ra; gọn thành MỘT chip, chi tiết trong ⓘ để bàn ghép xe vẫn rộng */}
              {plan && planTab && (() => {
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
              {planTab && <ActionCluster items={actionItems} mobileInline className="shrink-0" />}
              {/* DẢI CHỈ SỐ (14/10, user: "phần trên còn dư rất nhiều chỗ — để Dải chỉ số hiện lên, không ẩn nữa"): phần tử CUỐI của hàng 2,
                  ≥ 1280 flex-1 ⇒ lấp hết phần còn lại sau cụm nút ở MỌI màn; dưới 1280 một dòng riêng. Chỉ ở Bàn ghép xe — nơi người sửa
                  kế hoạch và cần thấy số đổi theo từng lần thả. */}
              {tab === 'board' && planView && sum && !planEmpty && <DispatchKpiBar plan={planView} className="w-full xl:w-auto xl:flex-1" />}
            </div>
          )}
        </div>

        {/* băng "nháp quá ngày" (03/10) bỏ 12/10 — nháp còn mở của kho nằm ở tab Nháp (số trên nhãn tab, quá ngày có ⚠) */}
        {/* DẢI VIỆC — trả lời "còn bao nhiêu việc" và đưa người tới đó bằng MỘT nhát bấm.
            Dùng SWITCH hiện sẵn chứ không phải chip trong menu: cả lựa chọn LẪN số của từng lựa chọn
            phải nhìn thấy mà không bấm gì (cùng lý do user chốt 17/09 cho bảng Việc cần làm). Loại
            vấn đề nào KHÔNG có xe nào thì không hiện — menu đầy lựa chọn ra bảng trắng là vô ích. */}
        {/* đang XEM nháp đã bỏ (người chủ động mở) — nói rõ là chỉ xem, đường về kế hoạch đang làm một nhát */}
        {plan?.status === 'DISCARDED' && planTab && (
          <div className="shrink-0 border-b bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
            Đang xem nháp <b>đã bỏ</b> lúc {formatTimestampDate(plan.updated_at)} — chỉ xem, không chọn / ghép / chuyển được.{' '}
            <button type="button" className="font-medium text-sky-700 hover:underline" onClick={() => setF({ planId: '' })}>Về kế hoạch đang làm</button>
          </div>
        )}
        {/* dải Soát (bản 03/10 là một hàng riêng) nay nằm TRONG thanh công cụ của bàn — `soatNode`; dải chỉ số ở hàng đầu trang (14/10) */}

        <div className={plan || tab === 'plans' || tab === 'history' ? 'flex-1 min-h-0' : 'flex-1 min-h-0 overflow-auto pb-20 lg:pb-4'}>
          {!f.warehouseId ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
              <Waypoints className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium text-slate-500">Chọn <b>kho xuất</b> và <b>ngày giao</b> để xem / lập kế hoạch ghép chuyến</p>
              <p className="text-xs">Pool = OD ZSD02 của kho (theo Plant SAP) có ngày giao đó và chưa nằm trong Kế hoạch xuất.</p>
            </div>
          ) : tab === 'history' ? (
            // tab LỊCH SỬ (20/10): sổ vết điều vận của kho — kế hoạch + mọi Số xe (kể cả xe đã bỏ / xoá), lọc + tìm, phân trang server
            <DispatchHistoryTab warehouseId={f.warehouseId} />
          ) : tab === 'plans' ? (
            // tab KẾ HOẠCH (16/10): một dòng một NGÀY (cả hai mảng) — bấm dòng mở (giữ mảng đang xem rồi sang bàn); Sửa / Bỏ nháp / Huỷ cho cả ngày
            <DispatchPlansTable plans={allPlans} loading={allPlansQ.isLoading} error={allPlansQ.isError ? apiMsg(allPlansQ.error) : null} currentPlanId={planId}
              canPlan={canPlan} canConfirm={canConfirm} busyId={discardingId} onOpen={openDay}
              onEdit={startEdit} onDelete={deleteDay}
              onHistory={d => setF({ tab: 'history', histPlanDate: d.plan_date, histFrom: '', histTo: '', histQ: '', histTypes: [], histPage: 1 })} />
          ) : plans.isLoading || planQ.isLoading ? (
            <div className="p-6 text-center text-xs text-slate-400">Đang tải…</div>
          ) : !plan ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
              <Waypoints className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium text-slate-500">Chưa có kế hoạch <b>{SEGMENT_VI[seg]}</b> cho kho này ngày {formatDate(day)}{otherPlan ? ` — mảng ${SEGMENT_VI[otherSeg]} đã có nháp` : ''}</p>
              {canPlan ? <>
                <Button size="sm" className="mt-2 h-8" onClick={loadOrders} disabled={create.isPending}><ListChecks className="h-3.5 w-3.5 mr-1" /> {create.isPending ? 'Đang nạp đơn…' : 'Xem đơn'}</Button>
                <p className="text-xs">Nạp các đơn chưa đi vào Chờ điều — tick đơn cần đi ngày này rồi bấm "Tạo kế hoạch".</p>
              </> : <p className="text-xs">Bạn chỉ có quyền xem — người có quyền “Lập kế hoạch” sẽ nạp đơn và tạo kế hoạch.</p>}
              {lastDiscarded && (
                <p className="text-xs">Nháp trước{lastDiscarded.created_by ? ` (${lastDiscarded.created_by} lập)` : ''} đã bỏ lúc {formatTimestampDate(lastDiscarded.updated_at)} — <button type="button" className="text-sky-700 underline" onClick={() => setF({ planId: lastDiscarded.id })}>Xem nháp đã bỏ</button> (chỉ xem)</p>
              )}
            </div>
          ) : (<>
            {showReview && (
              <DispatchReviewTable plan={plan} editable={editing && canPlan} flags={flags} onGrouped={ids => { setFocusTrips(ids); setF({ tab: 'board' }) }} canAct={canActKhvc}
                hidden={hidden} otherPlanId={otherPlan?.id ?? null} otherPoolCount={otherPlan?.summary ? (otherPlan.summary.unreviewed_ods ?? otherPlan.summary.pool_ods ?? null) : null} onSwitchSegment={s => setF({ segment: s, planId: '', reviewTab: 'GO' })} />
            )}
            {tab === 'board' && planEmpty && (
              <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
                <LayoutGrid className="h-10 w-10 opacity-30" />
                <p className="text-sm font-medium text-slate-500">Kế hoạch <b>{SEGMENT_VI[seg]}</b> ngày {formatDate(plan.plan_date)} chưa có đơn nào</p>
                <p className="text-xs">Vào Xem đơn, tick các đơn cần đi ngày này rồi bấm "Tạo kế hoạch" — máy ghép thành xe, bàn này hiện để soát / sửa.</p>
                <Button size="sm" variant="outline" className="mt-2 h-8" onClick={() => setF({ tab: 'review', reviewTab: 'GO' })}><ListChecks className="h-3.5 w-3.5 mr-1" /> Mở Xem đơn</Button>
              </div>
            )}
            {tab === 'map' && (
              <div className="h-full min-h-0 overflow-y-auto lg:overflow-hidden pb-20 lg:pb-0"><DispatchMap plan={planView ?? plan} warehouseId={f.warehouseId} canPlan={canPlan} onOpenTrip={setOpenTripId} /></div>
            )}
          </>)}
          {/* BÀN GHÉP XE ở MỘT chỗ cố định của cây (ngoài chuỗi điều kiện theo tab) — 23/10 (user: "phần chuyển phải mượt"): bàn đã dựng thì GIỮ
              khi sang tab khác (ẩn), quay về không dựng lại 56 xe (đo: ~2 s trình duyệt bận mỗi lần). Chế độ XEM: khung chờ hiện ĐỦ đơn Chờ điều
              (chỉ xem) — Sửa thì chỉ đơn của kế hoạch (boardPlanOf); đang mở Sửa (nạp đơn chờ ~2 s) giữ hình cũ tới khi xong, không nháy */}
          {!!f.warehouseId && !!plan && !planEmpty && (tab === 'board' || boardSeen) && (
            <div className={tab === 'board' ? 'contents' : 'hidden'}>
              <DispatchBoard plan={editing && !entering ? (planView ?? plan) : plan} editable={editing && !entering && canPlan} flags={flags} work={work} onOpenTrip={setOpenTripId} focusTripIds={focusTrips} onFocused={() => setFocusTrips([])} soat={soatNode}
                active={tab === 'board'}
                onReopenTrip={canConfirm ? t => void reopenTrip(t) : undefined}
                onMoveDateTrip={canConfirm && plan.status !== 'DISCARDED' ? t => setMoveDate({ kind: 'trips', trips: [t] }) : undefined} />
            </div>
          )}
        </div>
      </div>

      <Sheet open={!!openTrip} onOpenChange={o => !o && setOpenTripId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
          {openTrip && plan && (
            <TripPane trip={openTrip} plan={plan} editable={editing && canPlan && EDITABLE.includes(tripStatus(openTrip))} canConfirm={canConfirm} needsTender={needsTender(openTrip)} condBy={condBy}
              onReopen={canConfirm && tripStatus(openTrip) === 'CONFIRMED' && plan.status !== 'DISCARDED' ? () => void reopenTrip(openTrip) : undefined}
              onMoveDate={canConfirm && plan.status !== 'DISCARDED' && tripStatus(openTrip) !== 'DISCARDED' ? () => setMoveDate({ kind: 'trips', trips: [openTrip] }) : undefined}
              onMoveOdDate={canConfirm && plan.status !== 'DISCARDED' && tripStatus(openTrip) === 'CONFIRMED' ? od => setMoveDate({ kind: 'ods', trip: openTrip, odNumbers: [od] }) : undefined}
              // 13/10 (user: "sửa trên bàn, không sửa trên Kế hoạch xuất"): xe ĐÃ CHỐT vẫn đổi ĐVVT / dòng xe tại đây — ghi thẳng xuống Kế hoạch xuất · chuyến · lệnh VC
              // cùng luật với BE: sửa xe đã chốt = sửa Kế hoạch xuất đã xác nhận ⇒ cần Xác nhận hoặc quyền sửa Kế hoạch xuất (C66: không in ô chọn rồi 403)
              editableVehicle={canPlan && (canConfirm || can(perms, 'external_khvc', 'edit')) && tripStatus(openTrip) === 'CONFIRMED' && plan.status !== 'DISCARDED'}
              models={models.map(m => ({ value: m.id, label: `${m.sap_code} · ${m.name}`, sub: m.capacity_mode === 'TON' ? `${m.max_tons ?? '?'} t` : `${m.max_pallets ?? '?'} pl` }))}
              vehModels={models} flags={flags}
              onModel={v => patchTrip.mutateAsync({ id: openTrip.id, vehicle_model_id: v || null }).catch(e => err(e, 'Không đổi được dòng xe'))}
              onModels={ids => patchTrip.mutateAsync({ id: openTrip.id, vehicle_model_ids: ids }).catch(e => err(e, 'Không đổi được các xe của thẻ'))}
              onCarrier={v => patchTrip.mutateAsync({ id: openTrip.id, transport_company_id: v || null }).catch(e => err(e, 'Không đổi được ĐVVT'))}
              onMove={(od, to) => moveOd.mutateAsync({ trip_id: openTrip.id, od_number: od, to_trip_id: to || undefined }).then(p => { if (!p.trips.some(t => t.id === openTrip.id)) setOpenTripId(null) }).catch(e => err(e, 'Không chuyển được OD'))}
              onSettle={() => doSettle(openTrip)} onRespond={a => doRespond(openTrip, a)}
              // THAO TÁC XE (16/10): khoá hỏi trước như bàn ghép xe (`lockAsk`); vượt số khách = công tắc mới của xe
              onLock={async on => { if (on && await ask(lockAsk(openTrip)) === null) return; patchTrip.mutateAsync({ id: openTrip.id, locked: on }).catch(e => err(e, 'Không đổi được khoá')) }}
              onMix={on => patchTrip.mutateAsync({ id: openTrip.id, allow_mix_categories: on }).catch(e => err(e, 'Không đổi được "Ghép Loại kho khác"'))}
              onExtraDrops={on => patchTrip.mutateAsync({ id: openTrip.id, allow_extra_drops: on }).catch(e => err(e, 'Không đổi được "Cho vượt số khách"'))}
              onRemove={() => delTrip.mutateAsync(openTrip.id).then(() => setOpenTripId(null)).catch(e => err(e, 'Không bỏ được xe'))}
              busy={patchTrip.isPending || moveOd.isPending || settle.isPending || respond.isPending || delTrip.isPending} />
          )}
        </SheetContent>
      </Sheet>
      {plan && <DispatchMoveDateDialog plan={plan} target={moveDate} onClose={() => setMoveDate(null)} onMoveOds={moveOdsDate} />}
      {confirmNode}
    </div>
  )
}

/** Một dòng nhãn · giá trị trong khối của panel xe (khối tự kẻ vạch giữa các dòng) */
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex gap-2 py-1.5 text-xs"><span className="w-32 shrink-0 text-slate-500">{k}</span><span className="min-w-0 font-medium text-slate-800 break-words">{v}</span></div>
}

// PANEL XE (16/10, user: "cải tiến UI detail — chưa phân định được các khu vực thông tin; thêm bản đồ kẻ vạch từ kho tới điểm giao; click vào
// vận tải thì hiện giá; chưa có action cho xe — khoá xe, cho thêm điểm (vượt số khách), ghép Loại kho…"): nền xám + mỗi khu một KHỐI có băng
// tiêu đề (khuôn SettingsGroup của app) — Bản đồ tuyến · Xe · ĐVVT · Cước · Thao tác xe (công tắc khuôn AppSheet: tên đậm, diễn giải xám,
// công tắc bên phải) · Cảnh báo · Đơn trên xe. ĐVVT là ô chọn xếp theo CƯỚC cho đúng xe (cùng danh sách của bàn ghép xe).
function TripPane({ trip: t, plan, editable, editableVehicle, canConfirm, needsTender, condBy, models, vehModels, flags, onModel, onModels, onCarrier, onMove, onSettle, onRespond, onLock, onMix, onExtraDrops, onRemove, onReopen, onMoveDate, onMoveOdDate, busy }: {
  trip: DispatchTrip; plan: DispatchPlan; editable: boolean; editableVehicle: boolean; canConfirm: boolean; needsTender: boolean
  onReopen?: () => void   // 16/10: "Mở lại xe này" — xe đã vào Kế hoạch xuất về nháp để sửa (chỉ xe này)
  onMoveDate?: () => void               // 19/10: đổi ngày cả xe (giữ Số xe, nhả khung giờ)
  onMoveOdDate?: (od: string) => void   // 19/10: đổi ngày từng đơn trên xe đã chốt (đơn rớt) — mở lại → hoãn → xác nhận lại
  condBy: Map<string, StorageConditionRow>
  models: { value: string; label: string; sub?: string }[]; vehModels: VehicleModel[]
  flags: Map<string, DispatchOdFlag>
  onModel: (v: string) => void; onModels: (ids: string[]) => void; onCarrier: (v: string) => void; onMove: (od: string, toTripId: string) => void
  onSettle: () => void; onRespond: (accept: boolean) => void
  onLock: (on: boolean) => void; onMix: (on: boolean) => void; onExtraDrops: (on: boolean) => void; onRemove: () => void
  busy: boolean
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
  const vehEdit = editable || editableVehicle   // dòng xe · xe phụ · ĐVVT sửa được (nháp, hoặc xe đã chốt — 13/10)
  const whMeta = useWhTypeMetaMap()
  const follow = new Set(plan.params.follow_categories ?? [])
  const chips = (cats: string[]) => cats.map(c => (
    <span key={c} className={`rounded px-1 text-[9px] font-semibold ${whTypeBadgeCls(c, whMeta)} ${follow.has(c) ? 'border border-dashed border-current opacity-75' : ''}`}
      title={follow.has(c) ? `${c} — đi kèm đơn, không quyết Loại kho của xe` : `Loại kho ${c}`}>{c}</span>
  ))
  // số khách: trần = nhỏ nhất (dòng xe "Điểm giao tối đa" · "Số khách tối đa cùng xe" khắt khe nhất của khách / kênh trên xe) — chưa khai = 1
  const vm = t.vehicle_model_id ? vehModels.find(m => m.id === t.vehicle_model_id) ?? null : null
  const capModel = vm ? vm.max_drops ?? 1 : null
  const capOds = t.ods.length ? Math.min(...t.ods.map(o => (typeof o.max_customers === 'number' && o.max_customers >= 1 ? o.max_customers : 1))) : null
  const cap = Math.min(capModel ?? Infinity, capOds ?? Infinity)
  const planMix = plan.params.allow_mix_categories !== false
  const mixOn = (t.allow_mix_categories ?? plan.params.allow_mix_categories) !== false
  const offWhy = editable ? '' : st === 'CONFIRMED' ? ' — xe đã vào Kế hoạch xuất: "Mở lại" xe để đổi' : !planOpen ? ' — kế hoạch đã đóng' : ` — xe ${sv.label.toLowerCase()}`
  return (
    <>
      <SheetHeader className="px-4 py-3 border-b bg-white shrink-0">
        <div className="flex items-start justify-between gap-2 pr-6">
          <div className="min-w-0">
            <SheetTitle className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="rounded bg-sky-700 px-1.5 font-mono text-xs font-bold text-white">#{t.seq}</span>
              <span className="font-mono break-all">{t.group_code}</span>
              <StatusBadge tone={sv.tone} className="font-sans">{sv.label}</StatusBadge>
              {t.locked && <span className="inline-flex items-center gap-0.5 rounded bg-violet-600 px-1 text-[9px] font-bold text-white"><Lock className="h-2.5 w-2.5" />Khoá</span>}
              {t.allow_extra_drops && <ExtraDropsBadge />}
            </SheetTitle>
            <p className="text-xs text-slate-500 mt-0.5">{d.vehicle_model?.name ?? 'Chưa chọn dòng xe'} · {odNos.length} OD · {t.stops} điểm giao · {nf(t.pallets, 1)} pallet · {nf(t.tons, 2)} tấn · giao {formatDate(plan.plan_date)}</p>
          </div>
          <LoadCell t={t} />
        </div>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto bg-slate-100 px-3 py-3 space-y-3">
        {(canRespond || canSettle || st === 'DECLINED' || st === 'TENDERED' || st === 'CONFIRMED') && (
          <div className={`rounded-md border p-2.5 space-y-2 text-xs ${st === 'DECLINED' ? 'border-red-200 bg-red-50' : st === 'TENDERED' ? 'border-sky-200 bg-sky-50' : st === 'CONFIRMED' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            {st === 'TENDERED' && <p>Đã chào cho <b>{d.carrier?.name ?? 'ĐVVT'}</b>{t.tendered_at ? ` lúc ${formatTimestampDate(t.tendered_at)}` : ''} — chờ ĐVVT nhận / từ chối. Gọi hoặc Zalo cho ĐVVT rồi ghi lại câu trả lời ở đây.</p>}
            {st === 'DECLINED' && <p><b>{d.carrier?.name ?? 'ĐVVT'}</b> từ chối{t.responded_at ? ` lúc ${formatTimestampDate(t.responded_at)}` : ''}{t.response_by ? ` (ghi bởi ${t.response_by})` : ''}{t.response_note ? `: “${t.response_note}”` : '.'} Đổi ĐVVT bên dưới rồi bấm <b>Chốt xe này</b>.</p>}
            {st === 'CONFIRMED' && <p>Đã vào Kế hoạch xuất{t.confirmed_at ? ` lúc ${formatTimestampDate(t.confirmed_at)}` : ''}{t.response_note ? ` · ghi chú ĐVVT: “${t.response_note}”` : ''}.{editableVehicle ? ' Đổi ĐVVT / dòng xe ngay bên dưới — ghi thẳng xuống Kế hoạch xuất, chuyến Xuất kho và lệnh VC. Thêm bớt OD hay dời ngày: "Mở lại".' : ''}</p>}
            {st === 'DRAFT' && canSettle && <p>Xe còn nháp trong kế hoạch đã xác nhận một phần{needsTender ? ` — ĐVVT ${d.carrier?.name ?? ''} cần phản hồi, chốt sẽ chuyển sang chờ.` : ' — chốt là vào Kế hoạch xuất ngay.'}</p>}
            <div className="flex flex-wrap gap-1.5">
              {canRespond && <>
                <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700" disabled={busy} onClick={() => onRespond(true)}><ThumbsUp className="h-3.5 w-3.5 mr-1" /> ĐVVT nhận</Button>
                <Button size="sm" variant="outline" className="h-8 border-red-200 text-red-700 hover:bg-red-50" disabled={busy} onClick={() => onRespond(false)}><ThumbsDown className="h-3.5 w-3.5 mr-1" /> ĐVVT từ chối</Button>
              </>}
              {canSettle && <Button size="sm" className="h-8 bg-blue-600 hover:bg-blue-700" disabled={busy} onClick={onSettle}><Send className="h-3.5 w-3.5 mr-1" /> {needsTender ? 'Chào xe này' : 'Chốt xe này'}</Button>}
              {/* 16/10: mở lại RIÊNG xe này (thêm bớt OD, khoá, chở lẫn, vượt số khách, dời ngày) — xe khác của kế hoạch giữ nguyên */}
              {/* 19/10: một ổ khoá tím cho cả hai nghĩa (khoá tay / đã chốt) — nút mở lại dùng icon Unlock, màu tím cùng họ */}
              {st === 'CONFIRMED' && onReopen && <Button size="sm" variant="outline" className="h-8 border-violet-300 text-violet-800 hover:bg-violet-100" disabled={busy} onClick={onReopen} title="Xe về nháp để sửa — Kế hoạch xuất / bên Xuất giữ nguyên tới khi bấm Lưu"><Unlock className="h-3.5 w-3.5 mr-1" /> Mở khoá sửa xe này</Button>}
              {/* 18/10 → 19/10 (user chốt "một nút workflow nhỏ, bấm mở popup bảng"): tình trạng xe đã chốt — ai làm, lúc nào, chứng từ, Mở sổ, "Đã giao" */}
              {st === 'CONFIRMED' && <TripFlow code={t.group_code} label className="h-8" />}
            </div>
          </div>
        )}

        <SettingsGroup title={`Bản đồ tuyến · ${t.stops} điểm giao`}>
          <TripRouteMap trip={t} planId={plan.id} />
        </SettingsGroup>

        <SettingsGroup title="Xe · ĐVVT · Cước">
          <div className="py-2 space-y-1">
            <div className="text-[11px] font-semibold text-slate-700">Dòng xe con (mã SAP)</div>
            {vehEdit ? <SingleSelect options={models} value={t.vehicle_model_id ?? ''} onChange={onModel} placeholder="Chọn dòng xe con…" disabled={busy} />
              : <div className="text-xs font-medium">{d.vehicle_model ? `${d.vehicle_model.sap_code} · ${d.vehicle_model.name}` : '—'}</div>}
          </div>
          {/* THẺ NHIỀU XE (luật 11, 27/09): xe phụ cùng Số xe — máy chia tải xe lớn trước, cước = Σ từng xe cùng ĐVVT */}
          {(extras.length > 0 || (vehEdit && t.vehicle_model_id)) && (
            <div className="py-2 space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">Xe phụ trên thẻ ({extras.length})
                <InfoTip tip="Một Số xe có thể đi nhiều xe (vd 8 tấn + 2 tấn thay cho 15 tấn). Máy tự so tổ hợp khi lập; ở đây người thêm / bớt tay. Bước Xuất kho vẫn là MỘT chuyến một biển số — Kế hoạch xuất ghi đủ các xe để ĐVVT booking." /></div>
              {extras.map((id, i) => (
                <div key={`${id}-${i}`} className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">{vehEdit
                    ? <SingleSelect options={models} value={id} onChange={v => onModels([t.vehicle_model_id!, ...extras.map((x, j) => (j === i ? v : x)).filter(Boolean)])} disabled={busy} />
                    : <div className="text-xs">{models.find(m => m.value === id)?.label ?? id}</div>}</div>
                  {vehEdit && <Button size="sm" variant="outline" className="h-8 px-2" disabled={busy} title="Bỏ xe này khỏi thẻ" onClick={() => onModels([t.vehicle_model_id!, ...extras.filter((_, j) => j !== i)])}>✕</Button>}
                </div>
              ))}
              {vehEdit && extras.length < 4 && (
                <div className="w-full"><SingleSelect options={models} value="" placeholder="＋ Thêm xe vào thẻ…" disabled={busy} onChange={v => { if (v) onModels([t.vehicle_model_id!, ...extras, v]) }} /></div>
              )}
              {(d.vehicles?.length ?? 0) > 1 && d.vehicles!.map((v, i) => (
                <div key={`p-${v.id}-${i}`} className="flex gap-2 text-[11px] text-slate-600"><span className="min-w-0 flex-1 break-words">{v.name}</span><span className="tabular-nums">{nf(v.pallets, 1)} pl · {nf(v.tons, 1)} t</span><span className="tabular-nums font-medium">{v.freight == null ? '—' : vnd(v.freight)}</span></div>
              ))}
            </div>
          )}
          <div className="py-2 space-y-1">
            <div className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">ĐVVT <span className="font-normal text-slate-500">— bấm để xem cước từng ĐVVT cho xe này</span>
              {d.carrier_reasons.length > 0 && <InfoTip tip={<ul className="list-disc pl-4 space-y-0.5">{d.carrier_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>} />}</div>
            <DispatchCarrierPicker trip={t} editable={vehEdit} busy={busy} onPick={onCarrier} field />
            {d.carrier && st !== 'CONFIRMED' && <p className="text-[10px] text-slate-500">{needsTender ? <><Send className="inline h-3 w-3 mr-0.5 text-sky-600" />ĐVVT này <b>cần phản hồi</b> — sau Xác nhận xe chờ ĐVVT nhận.</> : 'ĐVVT không cần phản hồi — Xác nhận là vào Kế hoạch xuất ngay; sau đó vẫn đổi ĐVVT được ngay tại đây.'}</p>}
          </div>
          <KV k="Cước dự tính" v={t.freight_estimated != null ? <span className="tabular-nums font-semibold">{vnd(t.freight_estimated)}</span> : <span className="text-amber-700">{d.freight.reason ?? 'Chưa có cước'}</span>} />
          {d.freight.base != null && <KV k="Cước tuyến" v={<>{vnd(d.freight.base)}{d.freight.unit === 'PER_PALLET' && d.freight.billed_pallets != null ? <span className="text-slate-500 font-normal"> · {d.freight.billed_pallets} pallet (làm tròn lên)</span> : <span className="text-slate-500 font-normal"> · trọn chuyến</span>}</>} />}
          {d.freight.surcharges.map((x, i) => <KV key={i} k={`Phụ phí ${x.kind}`} v={`${vnd(x.unit_amount)} × ${x.qty} = ${vnd(x.total)}`} />)}
          {d.freight.ward && <KV k="Phường tính cước" v={d.freight.ward} />}
          {d.booking_category && <KV k="Loại kho booking" v={<span className="inline-flex flex-wrap items-center gap-1">{chips([d.booking_category])}{d.categories.length > 1 && <span className="text-slate-500 font-normal">chở lẫn</span>}{d.categories.length > 1 && chips(d.categories)}</span>} />}
          {!!d.conditions?.length && <KV k="Điều kiện bảo quản" v={<>{d.conditions.map(c => conditionLabel(condBy.get(c), c)).join(' + ')}<span className="text-slate-500 font-normal"> · dòng xe phải phục vụ đủ các mức này</span></>} />}
        </SettingsGroup>

        {/* THAO TÁC XE — công tắc khuôn AppSheet (user 16/10: "switch tiêu chuẩn của appsheet"); xe đã chốt / kế hoạch đóng thì chỉ xem */}
        <SettingsGroup title="Thao tác xe">
          <SettingRow label="Khoá xe" htmlFor={`sw-lock-${t.id}`}
            desc={(t.locked ? 'Đang khoá — "Tối ưu lại" giữ nguyên xe này (đơn, dòng xe, ĐVVT); kéo thả / đổi tay vẫn làm được.' : 'Khoá để lần "Tối ưu lại" sau máy giữ nguyên xe này. Hỏi lại trước khi khoá.') + offWhy}
            control={<Switch id={`sw-lock-${t.id}`} checked={t.locked === true} disabled={!editable || busy} onCheckedChange={onLock} aria-label="Khoá xe" />} />
          <SettingRow label="Ghép Loại kho khác" htmlFor={`sw-mix-${t.id}`}
            desc={(t.allow_mix_categories == null ? `Theo kế hoạch: ${planMix ? 'cho ghép' : 'không ghép'} — ` : '') + (mixOn ? 'Cho thả OD khác Loại kho chính vào xe này.' : 'Chặn thả OD khác Loại kho chính vào xe này.') + offWhy}
            control={<Switch id={`sw-mix-${t.id}`} checked={mixOn} disabled={!editable || busy} onCheckedChange={onMix} aria-label="Ghép Loại kho khác" />} />
          <SettingRow label="Cho vượt số khách" htmlFor={`sw-drops-${t.id}`}
            desc={`Xe đang chở ${t.stops} khách · trần ${Number.isFinite(cap) ? cap : '—'} (${capModel != null ? `dòng xe ${vm?.name ?? ''}: ${capModel}` : 'chưa có dòng xe'}${capOds != null ? ` · khách / kênh: ${capOds}` : ''}). Bật = kéo thả và Xác nhận không chặn số khách cho RIÊNG xe này; các luật khác vẫn chặn.${offWhy}`}
            control={<Switch id={`sw-drops-${t.id}`} checked={t.allow_extra_drops === true} disabled={!editable || busy} onCheckedChange={onExtraDrops} aria-label="Cho vượt số khách" />} />
          {onMoveDate && (
            <SettingRow label="Đổi ngày cả xe" desc={`Dời nguyên xe (đơn · ĐVVT · dòng xe) sang kế hoạch ngày khác — Số xe giữ nguyên; khung giờ đã đặt bị nhả; chuyến Xuất kho + lệnh VC đổi ngày theo.${st === 'CONFIRMED' ? ' Chuyến đang xuất / đã quét / đã hoàn thành thì không dời được cả xe — đổi ngày từng đơn ở khối Đơn trên xe.' : ''}`}
              control={<Button size="sm" variant="outline" className="h-7 border-sky-300 text-sky-800 hover:bg-sky-50" disabled={busy} onClick={onMoveDate}><CalendarClock className="h-3.5 w-3.5 mr-1" />Đổi ngày</Button>} />
          )}
          {editable && !t.ods.length && (
            <SettingRow label="Bỏ xe trống" desc="Xe không còn đơn nào — bỏ khỏi kế hoạch."
              control={<Button size="sm" variant="outline" className="h-7 border-red-200 text-red-700 hover:bg-red-50" disabled={busy} onClick={onRemove}><Trash2 className="h-3.5 w-3.5 mr-1" />Bỏ xe</Button>} />
          )}
        </SettingsGroup>

        {(d.warnings.length > 0 || !!d.merge_hint) && (
          <SettingsGroup title="Cảnh báo">
            <div className="py-2 space-y-1.5">
              {d.warnings.map((w, i) => <div key={i} className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1"><AlertTriangle className="inline h-3 w-3 mr-1" />{w}</div>)}
              {d.merge_hint && <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{d.merge_hint}</div>}
            </div>
          </SettingsGroup>
        )}

        <SettingsGroup title={`Đơn trên xe (${odNos.length})`}>
          {odNos.map(od => {
            const parts = t.ods.filter(o => o.od_number === od)
            const o = parts[0]
            const fl = flags.get(od)
            const stopNo = (d.route?.order.indexOf(o.ship_to_code ?? '') ?? -1) + 1
            const cats = [...new Set(parts.flatMap(p => Object.keys(p.cat_load ?? {})))].sort((a, b) => Number(follow.has(a)) - Number(follow.has(b)) || a.localeCompare(b))
            return (
              <div key={od} className="py-2 text-xs space-y-0.5">
                <div className="flex flex-wrap items-center gap-1">
                  {stopNo > 0 && <span className="rounded bg-sky-700 px-1 text-[9px] font-bold text-white" title="Điểm giao thứ mấy của xe (kho → điểm gần trước)">Đ{stopNo}</span>}
                  <span className="font-mono font-semibold">{od}</span>
                  {fl && <SapFlagIcon flag={fl} />}
                  {chips(cats)}
                  {o.part_of ? <span className="text-[9px] text-amber-700">phần {o.part_index}/{o.part_of} — OD bị tách, gom về một xe trước khi xác nhận</span> : null}
                  {isLateSo(o, plan.plan_date) && <LateSoChip date={o.so_created_date} />}
                </div>
                <div className="text-slate-600 truncate">{o.ship_to_name ?? o.ship_to_code}{o.ward_code ? <span className="text-slate-400"> · {o.ward_code}</span> : null}</div>
                <div className="text-slate-500 tabular-nums">{nf(parts.reduce((s, p) => s + Number(p.pallets ?? 0), 0), 2)} pallet · {nf(parts.reduce((s, p) => s + Number(p.tons ?? 0), 0), 2)} tấn · {parts.reduce((s, p) => s + p.lines, 0)} dòng hàng</div>
                {editable && (
                  <div className="pt-1 flex items-center gap-1.5">
                    <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0"><SingleSelect options={[{ value: '__new__', label: 'Tách ra xe MỚI' }, ...others]} value="" onChange={v => onMove(od, v === '__new__' ? '' : v)} placeholder="Chuyển sang xe…" disabled={busy} /></div>
                  </div>
                )}
                {/* 19/10: đơn rớt không bốc — đổi ngày RIÊNG đơn này (mở lại xe → hoãn → xác nhận lại, cùng Số xe) */}
                {onMoveOdDate && (
                  <button type="button" className="inline-flex items-center gap-1 pt-1 text-[11px] font-medium text-sky-700 hover:underline disabled:opacity-50" disabled={busy} onClick={() => onMoveOdDate(od)} title="Đơn này không đi ngày này (rớt, khách hẹn lại…) — dời sang ngày khác; xe giữ nguyên các đơn còn lại">
                    <CalendarClock className="h-3 w-3" />Đổi ngày đơn này
                  </button>
                )}
              </div>
            )
          })}
          {!odNos.length && <p className="py-2 text-[11px] text-slate-400">Xe trống — kéo đơn từ khung chờ vào, hoặc bỏ xe ở Thao tác xe.</p>}
        </SettingsGroup>
        {!editable && <p className="text-[11px] text-slate-500">{editableVehicle ? 'Xe đã chốt — ĐVVT / dòng xe đổi ngay tại đây; thêm bớt OD hay dời ngày thì "Mở lại" xe.' : planOpen && !EDITABLE.includes(st) ? `Xe ${sv.label.toLowerCase()} — không sửa dòng xe / ĐVVT / OD ở đây nữa.` : `Kế hoạch ${planStatusView(plan).label.toLowerCase()} — chỉ xem.`}</p>}
      </div>
    </>
  )
}
