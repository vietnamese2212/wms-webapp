// ĐIỀU VẬN — kế hoạch ghép chuyến NHÁP (đợt 2 TMS điều vận; user chốt 24/09/2026 "làm tiếp module 2"; plan mục 7).
//
// Một kho × một ngày giao: bấm "Lập kế hoạch" → máy ghép OD ZSD02 chưa xếp xe thành chuyến nháp (dòng xe con · ĐVVT theo
// phân tuyến/tỷ trọng · cước · % tải). Người sửa nháp ngay trên trang: đổi dòng xe / ĐVVT (cước tính lại sống), chuyển OD
// sang xe khác hoặc tách ra xe mới. "Xác nhận" = ghi vào Kế hoạch xuất y như upload tay → chuyến + lệnh VC tự sinh.
// MÁY ĐỀ XUẤT, NGƯỜI XÁC NHẬN. Bảng chuyến theo skill table-format; chi tiết một chuyến mở panel trượt phải (PC + điện thoại).
// VÒNG ĐỜI XE (24/09 chiều, user chốt "config: vận tải cần phản hồi hoặc không"): ĐVVT có cờ "Cần phản hồi khi chào chuyến"
// (form ĐVVT, Cài đặt TMS) ⇒ sau Xác nhận xe đứng CHỜ ĐVVT; điều vận ghi "ĐVVT nhận" / "ĐVVT từ chối" ngay trong panel xe;
// từ chối ⇒ đổi ĐVVT rồi "Chốt xe này". ĐVVT không cần phản hồi ⇒ vào Kế hoạch xuất ngay, đổi tay ở tab Kế hoạch xuất.
import { useEffect, useMemo, useState } from 'react'
import { Play, CheckCircle2, Trash2, Download, Waypoints, ArrowRightLeft, AlertTriangle, ThumbsUp, ThumbsDown, Send } from 'lucide-react'
import type { AxiosError } from 'axios'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { InfoTip } from '@/components/shared/InfoTip'
import { toast } from '@/components/ui/use-toast'
import {
  useDispatchPlans, useDispatchPlan, useCreateDispatchPlan, useUpdateDispatchTrip, useMoveDispatchOd, useConfirmDispatchPlan, useDiscardDispatchPlan,
  useSettleDispatchTrip, useRespondDispatchTrip,
  useVehicleModels, useTransportCompanies, useStorageConditions, conditionLabel,
  type DispatchPlan, type DispatchTrip, type DispatchTripStatus, type StorageConditionRow,
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
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const tomorrowVN = () => new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
type Tone = 'amber' | 'green' | 'slate' | 'blue' | 'red'
const STATUS_VI: Record<DispatchPlan['status'], { label: string; tone: Tone }> = {
  DRAFT: { label: 'Bản nháp', tone: 'amber' }, TENDERED: { label: 'Chờ ĐVVT phản hồi', tone: 'blue' }, CONFIRMED: { label: 'Đã xác nhận', tone: 'green' }, DISCARDED: { label: 'Đã bỏ', tone: 'slate' },
}
const TRIP_STATUS_VI: Record<DispatchTripStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Nháp', tone: 'amber' }, TENDERED: { label: 'Chờ ĐVVT', tone: 'blue' }, DECLINED: { label: 'ĐVVT từ chối', tone: 'red' },
  CONFIRMED: { label: 'Đã vào KH xuất', tone: 'green' }, DISCARDED: { label: 'Đã bỏ', tone: 'slate' },
}
const EDITABLE: DispatchTripStatus[] = ['DRAFT', 'DECLINED']
const tripStatus = (t: DispatchTrip): DispatchTripStatus => t.status ?? 'DRAFT'

const COLS: RtColDef[] = [
  { id: 'gc', label: 'Số xe dự kiến', w: 150 },
  { id: 'status', label: 'Trạng thái', w: 105 },
  { id: 'model', label: 'Dòng xe con', w: 150 },
  { id: 'carrier', label: 'ĐVVT', w: 110 },
  { id: 'stops', label: 'Điểm giao', w: 70, align: 'right' },
  { id: 'ward', label: 'Phường (xa nhất)', w: 150 },
  { id: 'ods', label: 'OD', w: 60, align: 'right' },
  { id: 'pal', label: 'Pallet', w: 70, align: 'right' },
  { id: 'ton', label: 'Tấn', w: 70, align: 'right' },
  { id: 'load', label: 'Tải', w: 90, align: 'right' },
  { id: 'freight', label: 'Cước dự tính', w: 110, align: 'right' },
  { id: 'note', label: 'Ghi chú máy', w: 260 },
]

function LoadCell({ t }: { t: DispatchTrip }) {
  const l = t.detail.load
  if (l.pct == null) return <span className="text-slate-300" title={t.detail.freight.reason ?? 'Không đo được tải'}>—</span>
  const cls = t.oversize || l.pct > 100 ? 'text-red-600 font-semibold' : t.underload ? 'text-red-600' : 'text-slate-700'
  return <span className={`tabular-nums ${cls}`} title={`${nf(l.used, 1)} / ${nf(l.cap, 1)} ${l.basis === 'TON' ? 'tấn' : 'pallet'} · ngưỡng Non tải ${l.underload_pct}%`}>{nf(l.pct, 1)}%{t.underload && <span className="ml-1 text-[9px]">Non tải</span>}</span>
}

export default function Dispatch() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canPlan = can(perms, 'dispatch', 'plan'), canConfirm = can(perms, 'dispatch', 'confirm'), canExport = can(perms, 'dispatch', 'export')
  const f = useWmsFilterStore(s => s.dispatch)
  const setF = useWmsFilterStore(s => s.setDispatch)
  const day = f.planDate || tomorrowVN()

  const { data: warehouses = [] } = useScopedWarehouses(true)
  const whs = warehouses as { id: string; code?: string; name: string }[]
  // 1 kho trong phạm vi → tự chọn
  useEffect(() => { if (!f.warehouseId && whs.length === 1) setF({ warehouseId: whs[0].id }) }, [whs, f.warehouseId, setF])

  const plans = useDispatchPlans({ warehouse_id: f.warehouseId || undefined, date_from: day, date_to: day }, !!f.warehouseId)
  const planList = plans.data?.items ?? []
  // kế hoạch đang mở: người chọn → bản nháp mới nhất → bản mới nhất bất kỳ
  const planId = useMemo(() => {
    if (f.planId && planList.some(p => p.id === f.planId)) return f.planId
    return (planList.find(p => p.status === 'DRAFT') ?? planList[0])?.id ?? null
  }, [f.planId, planList])
  const planQ = useDispatchPlan(planId)
  const plan = planQ.data ?? null
  const isDraft = plan?.status === 'DRAFT'
  const isOpen = plan?.status === 'DRAFT' || plan?.status === 'TENDERED'

  const { data: modelsRes } = useVehicleModels({ is_active: true })
  const models = (modelsRes?.items ?? []).filter(m => m.parent)
  const { data: companiesRaw = [] } = useTransportCompanies(true, 'ĐVVT')
  const { data: conditions = [] } = useStorageConditions()
  const condBy = useMemo(() => new Map(conditions.map(c => [c.value, c])), [conditions])
  // cờ "cần phản hồi" đọc từ danh mục HIỆN TẠI (bản chụp trong detail lúc lập có thể cũ)
  const tenderBy = useMemo(() => new Map(companiesRaw.map(c => [c.id, c.tender_required === true])), [companiesRaw])
  const needsTender = (t: DispatchTrip) => t.transport_company_id ? (tenderBy.get(t.transport_company_id) ?? t.detail.carrier?.tender_required === true) : false

  const create = useCreateDispatchPlan(), patchTrip = useUpdateDispatchTrip(), moveOd = useMoveDispatchOd(), confirm = useConfirmDispatchPlan(), discard = useDiscardDispatchPlan()
  const settle = useSettleDispatchTrip(), respond = useRespondDispatchTrip()
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  const openTrip = plan?.trips.find(t => t.id === openTripId) ?? null

  const err = (e: unknown, title: string) => toast({ variant: 'destructive', title, description: apiMsg(e) })
  const runPlan = () => {
    if (!f.warehouseId) return
    create.mutateAsync({ warehouse_id: f.warehouseId, plan_date: day }).then(p => {
      setF({ planId: p.id })
      toast({ title: `Đã lập ${p.summary.trips} chuyến cho ${p.summary.ods} OD`, description: p.summary.underload ? `${p.summary.underload} chuyến Non tải · ${p.summary.unpriced} chuyến chưa có cước` : `Σ cước dự tính ${vnd(p.summary.freight_total)}` })
    }).catch(e => err(e, 'Không lập được kế hoạch'))
  }
  const tenderCount = plan ? plan.trips.filter(t => tripStatus(t) === 'DRAFT' && needsTender(t)).length : 0
  const doConfirm = () => {
    if (!plan) return
    const n = plan.trips.filter(t => tripStatus(t) === 'DRAFT' && t.ods.length).length
    const q = tenderCount
      ? `Xác nhận ${n} xe ngày ${formatDate(plan.plan_date)}: ${n - tenderCount} xe vào Kế hoạch xuất ngay, ${tenderCount} xe CHỜ ĐVVT phản hồi (ĐVVT có cờ "cần phản hồi"). Tiếp tục?`
      : `Xác nhận ${n} xe vào Kế hoạch xuất ngày ${formatDate(plan.plan_date)}? Sau bước này chuyến + lệnh VC tự sinh, sửa tiếp ở tab Kế hoạch xuất.`
    if (!window.confirm(q)) return
    confirm.mutateAsync(plan.id).then(r => {
      toast({
        title: r.tendered ? `Đã ghi ${r.trips} xe vào Kế hoạch xuất · ${r.tendered} xe chờ ĐVVT phản hồi` : `Đã ghi ${r.lines} dòng Kế hoạch xuất cho ${r.trips} xe`,
        description: r.replan_error ? `Kế hoạch đã lưu nhưng chuyến chưa dội xuống: ${r.replan_error}` : r.tendered ? `Xe chờ: ${r.tendered_group_codes.join(', ')} — ghi "ĐVVT nhận / từ chối" trong panel từng xe.` : 'Chuyến bên Xuất kho + lệnh VC bên Kế hoạch VC đã sinh.',
        variant: r.replan_error ? 'destructive' : undefined,
      })
    }).catch(e => err(e, 'Không xác nhận được'))
  }
  const doDiscard = () => {
    if (!plan) return
    const msg = plan.status === 'TENDERED' ? 'Bỏ các xe CHƯA vào Kế hoạch xuất (đang chờ / bị từ chối / nháp)? Xe đã vào Kế hoạch xuất giữ nguyên; OD của xe bị bỏ về lại pool.' : 'Bỏ bản nháp này? OD sẽ về lại pool để lập lại.'
    if (!window.confirm(msg)) return
    discard.mutateAsync(plan.id).then(r => { if (r.status === 'DISCARDED') setF({ planId: '' }); toast({ title: `Đã bỏ ${r.discarded_trips} xe` }) }).catch(e => err(e, 'Không bỏ được nháp'))
  }
  const doSettle = (t: DispatchTrip) => {
    const tender = needsTender(t)
    if (!window.confirm(tender ? `Chào xe ${t.group_code} cho ${t.detail.carrier?.name ?? 'ĐVVT'} — xe sẽ CHỜ ĐVVT phản hồi.` : `Chốt xe ${t.group_code} vào Kế hoạch xuất ngay (ĐVVT không cần phản hồi)?`)) return
    settle.mutateAsync(t.id).then(r => toast({ title: r.trip_status === 'TENDERED' ? `Xe ${r.group_code} đang chờ ĐVVT phản hồi` : `Xe ${r.group_code} đã vào Kế hoạch xuất`, description: r.replan_error ?? undefined, variant: r.replan_error ? 'destructive' : undefined })).catch(e => err(e, 'Không chốt được xe'))
  }
  const doRespond = (t: DispatchTrip, accept: boolean) => {
    let note: string | undefined
    if (!accept) { const v = window.prompt(`ĐVVT ${t.detail.carrier?.name ?? ''} từ chối xe ${t.group_code} — lý do (ghi lại để đối chiếu):`, ''); if (v === null) return; note = v.trim() || undefined }
    else if (!window.confirm(`Ghi nhận ĐVVT ${t.detail.carrier?.name ?? ''} ĐÃ NHẬN xe ${t.group_code} — xe vào Kế hoạch xuất ngay?`)) return
    respond.mutateAsync({ tripId: t.id, accept, note }).then(r => toast({ title: accept ? `Xe ${r.group_code} đã vào Kế hoạch xuất` : `Đã ghi ĐVVT từ chối xe ${r.group_code}`, description: accept ? (r.replan_error ?? undefined) : 'Đổi ĐVVT trong panel xe rồi bấm "Chốt xe này".', variant: r.replan_error ? 'destructive' : undefined })).catch(e => err(e, 'Không ghi được phản hồi'))
  }
  const doExport = async () => {
    if (!plan) return
    const XLSX = await import('xlsx')
    const rows = plan.trips.flatMap(t => t.ods.map(o => ({
      'Số xe': t.group_code, 'DO': o.od_number, 'NPP': o.ship_to_name ?? '', 'Ship-to': o.ship_to_code ?? '', 'Phường': o.ward_code ?? '',
      'Loại xe': t.detail.vehicle_model?.parent_type_name ?? '', 'Mã xe SAP': t.detail.vehicle_model?.sap_code ?? '', 'Dòng xe': t.detail.vehicle_model?.name ?? '',
      'ĐVVT': t.detail.carrier?.name ?? '', 'Trạng thái xe': TRIP_STATUS_VI[tripStatus(t)].label, 'Ngày xuất': plan.plan_date, 'Loại kho booking': t.detail.booking_category ?? '',
      'Pallet OD': o.pallets == null ? '' : Number(o.pallets), 'Tấn OD': o.tons == null ? '' : Number(o.tons),
      'Pallet xe': t.pallets == null ? '' : Number(t.pallets), 'Tải %': t.load_pct == null ? '' : Number(t.load_pct), 'Cước dự tính': t.freight_estimated == null ? '' : Number(t.freight_estimated),
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'KH dieu van')
    saveWorkbook(wb, `dieu-van-${plan.warehouse?.code ?? ''}-${plan.plan_date}.xlsx`)
  }

  const actionItems: ActionItem[] = []
  if (canPlan) actionItems.push({ key: 'plan', icon: Play, label: plan ? 'Lập lại' : 'Lập kế hoạch', tip: plan ? 'Chạy lại máy ghép — bản nháp hiện tại (kể cả phần đã sửa tay) bị thay' : 'Máy ghép OD chưa xếp xe của kho × ngày này thành chuyến nháp', primary: true, variant: 'default', onClick: runPlan, disabled: !f.warehouseId || create.isPending, busy: create.isPending })
  if (canConfirm && isDraft) actionItems.push({ key: 'confirm', icon: CheckCircle2, label: 'Xác nhận', tip: tenderCount ? `Ghi các xe vào Kế hoạch xuất; ${tenderCount} xe của ĐVVT "cần phản hồi" sẽ chờ ĐVVT nhận` : 'Ghi các chuyến vào Kế hoạch xuất — chuyến + lệnh VC tự sinh', primary: true, variant: 'default', className: 'bg-green-600 hover:bg-green-700 border-green-600 text-white', onClick: doConfirm, disabled: confirm.isPending, busy: confirm.isPending })
  if (canExport && plan) actionItems.push({ key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất kế hoạch theo cột file KH điều vận', onClick: doExport, mobileHidden: true })
  if (canPlan && isOpen) actionItems.push({ key: 'discard', icon: Trash2, label: isDraft ? 'Bỏ nháp' : 'Bỏ xe chưa chốt', tip: isDraft ? 'Bỏ bản nháp — OD về lại pool' : 'Bỏ các xe chưa vào Kế hoạch xuất (chờ / từ chối / nháp) — xe đã vào giữ nguyên', danger: true, onClick: doDiscard, disabled: discard.isPending })

  const trips = useMemo(() => (plan?.trips ?? []).filter(t => !f.onlyUnderload || t.underload), [plan, f.onlyUnderload])
  const sum = plan?.summary
  const s = plan ? STATUS_VI[plan.status] : null

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 hidden sm:inline-flex items-center gap-1.5"><Waypoints className="h-4 w-4 text-sky-600" /> Điều vận</h1>
            <div className="w-full sm:w-56"><WarehouseSingleSelect warehouses={whs} value={f.warehouseId} onChange={v => setF({ warehouseId: v, planId: '' })} /></div>
            <Input type="date" value={day} onChange={e => setF({ planDate: e.target.value, planId: '' })} className="h-9 sm:h-7 w-[150px] text-xs" title="Ngày giao (ngày xe chạy)" />
            {planList.length > 1 && (
              <div className="w-48"><SingleSelect searchable={false} value={planId ?? ''} onChange={v => setF({ planId: v })}
                options={planList.map(p => ({ value: p.id, label: `${STATUS_VI[p.status].label} · ${formatTimestampDate(p.created_at)}`, sub: p.created_by ?? undefined }))} placeholder="Kế hoạch" /></div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <ActionCluster items={actionItems} mobileInline />
            </div>
          </div>
          {plan && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-600">
              {s && <StatusBadge tone={s.tone}>{s.label}</StatusBadge>}
              <span>{plan.warehouse?.name} · giao {formatDate(plan.plan_date)} · lập {formatTimestampDate(plan.created_at)}{plan.created_by ? ` bởi ${plan.created_by}` : ''}</span>
              <span className="text-slate-400">· ≤ {plan.params.max_drops ?? 3} điểm giao · {plan.params.allow_mix_channels ? 'trộn kênh' : 'không trộn kênh'} · pool {nf(plan.params.pool_ods)} OD ({nf(plan.params.in_plan)} đã có trong Kế hoạch xuất)</span>
              <label className="inline-flex items-center gap-1 cursor-pointer select-none ml-auto"><input type="checkbox" className="h-3.5 w-3.5 accent-sky-600" checked={f.onlyUnderload} onChange={e => setF({ onlyUnderload: e.target.checked })} /> chỉ chuyến Non tải</label>
            </div>
          )}
        </div>

        {plan && sum && (
          <SummaryBand tiles={[
            { label: 'Chuyến', value: nf(sum.trips) },
            { label: 'OD đã xếp', value: nf(sum.ods), tip: `${nf(plan.unplanned.length)} OD không xếp được (xem cuối bảng)` },
            { label: 'Pallet', value: nf(sum.pallets, 1) },
            { label: 'Tấn', value: nf(sum.tons, 1) },
            { label: 'Σ cước dự tính', value: vnd(sum.freight_total), tip: sum.unpriced ? `${sum.unpriced} chuyến chưa có cước (thiếu bảng cước / dòng xe)` : 'Theo bảng cước hiệu lực tại ngày giao' },
            { label: 'Non tải', value: nf(sum.underload), accent: sum.underload > 0, tip: 'Chuyến dưới ngưỡng Non tải — máy đã thử gộp cùng vùng, còn lại cần người quyết' },
            { label: 'Chưa có cước', value: nf(sum.unpriced), accent: sum.unpriced > 0 },
            ...(plan.status !== 'DRAFT' ? [
              { label: 'Chờ ĐVVT', value: nf(sum.tendered ?? 0), accent: (sum.tendered ?? 0) > 0, tip: 'Xe đã chào, ĐVVT chưa trả lời — ghi "ĐVVT nhận / từ chối" trong panel xe' },
              { label: 'ĐVVT từ chối', value: nf(sum.declined ?? 0), accent: (sum.declined ?? 0) > 0, tip: 'Đổi ĐVVT trong panel xe rồi "Chốt xe này"' },
              { label: 'Đã vào KH xuất', value: nf(sum.confirmed ?? 0) },
            ] : []),
            ...sum.shares.map(sh => ({ label: `ĐVVT ${sh.code}`, value: sh.pct == null ? `${sh.trips} ch.` : `${nf(sh.pct, 1)}%`, tip: `${sh.name}: ${sh.trips} chuyến · ${nf(sh.pallets, 1)} pallet · ${nf(sh.tons, 1)} tấn trong kỳ (kể cả chuyến đã xác nhận)${sh.target_pct != null ? ` · mục tiêu ${sh.target_pct}% theo ${sh.basis === 'TRIPS' ? 'số chuyến' : sh.basis === 'PALLETS' ? 'pallet' : 'tấn'}` : ''}`, accent: sh.target_pct != null && sh.pct != null && sh.pct < sh.target_pct })),
          ]} />
        )}

        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
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
              <p className="text-sm font-medium text-slate-500">Chưa có kế hoạch cho kho này ngày {formatDate(day)}</p>
              {canPlan ? <Button size="sm" className="mt-2 h-8 bg-blue-600 hover:bg-blue-700" onClick={runPlan} disabled={create.isPending}><Play className="h-3.5 w-3.5 mr-1" /> {create.isPending ? 'Đang ghép…' : 'Lập kế hoạch'}</Button>
                : <p className="text-xs">Bạn chỉ có quyền xem — người có quyền “Lập kế hoạch” sẽ chạy máy ghép.</p>}
            </div>
          ) : (
            <>
              <ResizableTable storageKey="dispatch_cols_v1" cols={COLS}>
                <TableBody>
                  {!trips.length && <TableEmptyRow colSpan={COLS.length}>{f.onlyUnderload ? 'Không có chuyến Non tải — bỏ tick "chỉ chuyến Non tải" để xem tất cả.' : 'Kế hoạch không có chuyến nào (pool trống hoặc mọi OD không đo được tải — xem danh sách dưới).'}</TableEmptyRow>}
                  {trips.map(t => {
                    const d = t.detail
                    const st = tripStatus(t)
                    return (
                      <TableRow key={t.id} className={`cursor-pointer ${openTripId === t.id ? 'bg-sky-50' : ''} ${t.oversize ? 'text-red-700' : ''} ${st === 'DISCARDED' ? 'line-through text-slate-400' : st === 'CONFIRMED' ? 'text-green-700' : ''}`} onClick={() => setOpenTripId(t.id)}>
                        <TableCell className={`${TD} font-mono font-semibold sticky left-0 z-10 ${openTripId === t.id ? 'bg-sky-50' : 'bg-white'}`}>{t.group_code}{t.manual_edited && <span className="ml-1 text-amber-600 font-sans" title="Người đã sửa chuyến này">✎</span>}</TableCell>
                        <TableCell className={TD} title={st === 'DECLINED' && t.response_note ? `Lý do: ${t.response_note}` : undefined}><StatusBadge tone={TRIP_STATUS_VI[st].tone}>{TRIP_STATUS_VI[st].label}</StatusBadge></TableCell>
                        <TableCell className={TD}>{d.vehicle_model ? <><span className="font-mono">{d.vehicle_model.sap_code}</span> <span className="text-slate-600">{d.vehicle_model.name}</span></> : <span className="text-red-600">Chưa chọn</span>}</TableCell>
                        <TableCell className={TD} title={[...d.carrier_reasons, needsTender(t) ? 'ĐVVT cần phản hồi khi chào chuyến' : ''].filter(Boolean).join(' · ') || undefined}>{d.carrier ? <><span className="font-mono font-semibold">{d.carrier.code}</span> <span className="text-slate-500">{d.carrier.name}</span>{needsTender(t) && <Send className="inline h-3 w-3 ml-1 text-sky-600" />}</> : <span className="text-red-600">Chưa chọn</span>}</TableCell>
                        <TableCell className={`${TD} text-right tabular-nums`}>{t.stops}</TableCell>
                        <TableCell className={`${TD} truncate`} title={t.wards.join(', ')}>{d.freight.ward ?? t.wards[0] ?? <span className="text-slate-300">—</span>}{t.wards.length > 1 && <span className="text-slate-400"> +{t.wards.length - 1}</span>}</TableCell>
                        <TableCell className={`${TD} text-right tabular-nums`}>{new Set(t.ods.map(o => o.od_number)).size}</TableCell>
                        <TableCell className={`${TD} text-right tabular-nums`}>{nf(t.pallets, 1)}</TableCell>
                        <TableCell className={`${TD} text-right tabular-nums`}>{nf(t.tons, 2)}</TableCell>
                        <TableCell className={`${TD} text-right`}><LoadCell t={t} /></TableCell>
                        <TableCell className={`${TD} text-right tabular-nums font-semibold`} title={d.freight.reason ?? (d.freight.surcharges.length ? `Cước tuyến ${vnd(d.freight.base)} + phụ phí ${d.freight.surcharges.map(x => `${x.kind} ${vnd(x.total)}`).join(', ')}` : undefined)}>
                          {t.freight_estimated != null ? vnd(t.freight_estimated) : <span className="text-amber-600 font-normal">chưa có cước</span>}
                        </TableCell>
                        <TableCell className={`${TD} truncate text-slate-500`} title={[...d.warnings, d.merge_hint ?? ''].filter(Boolean).join('\n') || d.carrier_reasons.join(' · ')}>
                          {d.warnings.length ? <span className="text-red-600"><AlertTriangle className="inline h-3 w-3 mr-0.5" />{d.warnings[0]}</span> : d.merge_hint ? <span className="text-amber-700">{d.merge_hint}</span> : d.carrier_reasons[0] ?? ''}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </ResizableTable>
              {plan.unplanned.length > 0 && (
                <div className="mx-3 my-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                  <div className="font-semibold mb-1"><AlertTriangle className="inline h-3.5 w-3.5 mr-1" />{plan.unplanned.length} OD không xếp được</div>
                  <ul className="space-y-0.5 max-h-40 overflow-auto">
                    {plan.unplanned.map(u => <li key={u.od_number}><span className="font-mono">{u.od_number}</span>{u.ship_to_code && <span className="text-amber-700"> · {u.ship_to_code}</span>} — {u.reason}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        {plan && <div className="border-t px-3 py-1.5 text-[11px] text-slate-500 shrink-0">{trips.length}/{plan.trips.length} chuyến · bấm một chuyến để đổi dòng xe / ĐVVT hoặc chuyển OD{plan.status === 'TENDERED' ? ' · xe chờ ĐVVT: ghi "ĐVVT nhận / từ chối" trong panel xe' : ''} · máy đề xuất, người xác nhận</div>}
      </div>

      <Sheet open={!!openTrip} onOpenChange={o => !o && setOpenTripId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
          {openTrip && plan && (
            <TripPane trip={openTrip} plan={plan} editable={!!isOpen && canPlan && EDITABLE.includes(tripStatus(openTrip))} canConfirm={canConfirm} needsTender={needsTender(openTrip)} condBy={condBy}
              models={models.map(m => ({ value: m.id, label: `${m.sap_code} · ${m.name}`, sub: m.capacity_mode === 'TON' ? `${m.max_tons ?? '?'} t` : `${m.max_pallets ?? '?'} pl` }))}
              companies={companiesRaw.map(c => ({ value: c.id, label: `${c.code} · ${c.name}`, sub: c.tender_required ? 'cần phản hồi' : undefined }))}
              onModel={v => patchTrip.mutateAsync({ id: openTrip.id, vehicle_model_id: v || null }).catch(e => err(e, 'Không đổi được dòng xe'))}
              onCarrier={v => patchTrip.mutateAsync({ id: openTrip.id, transport_company_id: v || null }).catch(e => err(e, 'Không đổi được ĐVVT'))}
              onMove={(od, to) => moveOd.mutateAsync({ trip_id: openTrip.id, od_number: od, to_trip_id: to || undefined }).then(p => { if (!p.trips.some(t => t.id === openTrip.id)) setOpenTripId(null) }).catch(e => err(e, 'Không chuyển được OD'))}
              onSettle={() => doSettle(openTrip)} onRespond={a => doRespond(openTrip, a)}
              busy={patchTrip.isPending || moveOd.isPending || settle.isPending || respond.isPending} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex gap-2 text-xs py-1 border-b border-slate-100 last:border-0"><span className="w-32 shrink-0 text-slate-400">{k}</span><span className="min-w-0 font-medium text-slate-700 break-words">{v}</span></div>
}

function TripPane({ trip: t, plan, editable, canConfirm, needsTender, condBy, models, companies, onModel, onCarrier, onMove, onSettle, onRespond, busy }: {
  trip: DispatchTrip; plan: DispatchPlan; editable: boolean; canConfirm: boolean; needsTender: boolean
  condBy: Map<string, StorageConditionRow>
  models: { value: string; label: string; sub?: string }[]; companies: { value: string; label: string; sub?: string }[]
  onModel: (v: string) => void; onCarrier: (v: string) => void; onMove: (od: string, toTripId: string) => void
  onSettle: () => void; onRespond: (accept: boolean) => void; busy: boolean
}) {
  const d = t.detail
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
