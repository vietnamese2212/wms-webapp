// FILL HÀNG PHỤC VỤ NHẶT LẺ (user chốt 04/08; v3 gom lệnh theo DATE 05/08) — 3 tab:
//   Đề xuất  : cần (nhặt lẻ còn lại của NGÀY XUẤT) vs đang có ở VỊ TRÍ NHẶT LẺ ⇒ thiếu bao nhiêu,
//              chỉ định theo DATE (bấm cột Date để đổi) → chọn dòng → "Ra lệnh fill" = MỘT lệnh gom.
//   Lệnh fill: danh sách LỆNH (mỗi dòng = 1 lần ra lệnh) — mở ra mới thấy chi tiết từng dòng mã;
//              quét thực hiện ngay trên dòng lệnh hoặc trong trang chi tiết.
//   Kết quả  : tỷ lệ hoàn thành theo NGƯỜI.
//
// SỐ LƯỢNG: API trả BASE UNIT. Per-mã hiển thị "N thùng + M hộp" (qtyLabel). Tổng CROSS-MÃ phải
// quy đổi per-mã trước khi cộng và mang nhãn QTY_CONVERTED_LABEL — cộng base thô rồi ghi "thùng"
// là thổi tổng (luật BASE UNIT trong CLAUDE.md, cổng tĩnh 09 đang gác nhãn này).
import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, QrCode, Plus, X, Rows3, AlignJustify, UserPlus, Info, CalendarSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { FillScanOverlay } from './FillScanOverlay'
import { AssigneePicker, FILL_STATUS_LABEL, FILL_STATUS_BADGE, fillRowText } from './fillShared'
import {
  useWarehouses, useFillDemand, useFillCandidates, useFillOrders, useFillReport,
  useCreateFillOrder, useCancelFillOrder,
  type FillDemandRow, type FillOrderRow, type FillOrderSkipped,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { qtyLabel, qtyEntryDecimal, QTY_CONVERTED_LABEL, QTY_CONVERTED_TIP } from '@/utils/qtyUnits'
import { computePctDate } from '@/utils/shelfLife'
import { formatDate, formatTimestampDate } from '@/utils/formatters'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const nf = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })

const DEMAND_COLS = [
  { id: 'sel',     label: '',                 w: 36 },
  { id: 'code',    label: 'Mã hàng',          w: 110 },
  { id: 'name',    label: 'Tên hàng',         w: 200 },
  { id: 'cat',     label: 'Loại kho',         w: 80 },
  { id: 'demand',  label: 'Cần nhặt lẻ',      w: 140, align: 'right' as const },
  { id: 'onhand',  label: 'Đang có ở dưới',   w: 140, align: 'right' as const },
  { id: 'onway',   label: 'Đang có lệnh',     w: 130, align: 'right' as const },
  { id: 'short',   label: 'Thiếu',            w: 140, align: 'right' as const },
  { id: 'pallets', label: 'Pallet chẵn',      w: 90,  align: 'right' as const },
  { id: 'qtydown', label: 'SL hạ (chẵn pallet)', w: 140, align: 'right' as const },
  { id: 'pickdate', label: 'Date chỉ định (%Date)', w: 150 },
  { id: 'src',     label: 'Vị trí lấy hàng',  w: 160 },
  { id: 'dest',    label: 'Đề xuất hạ về',    w: 130 },
]

// Bản chỉ định hiệu lực của 1 dòng: mặc định = suggestions FEFO từ RPC; user đổi DATE trong
// dialog thì thay bằng chỉ định tính từ fill_candidates của date đó (pallet/vị trí đổi theo).
type EffSugg = {
  entry_id: string; from_location_code: string | null
  avail: number; production_date: string | null; expiry_date: string | null
}
const ORDER_COLS = [
  { id: 'date',    label: 'Ngày xuất',   w: 90 },
  { id: 'code',    label: 'Mã lệnh',     w: 110 },
  { id: 'status',  label: 'Trạng thái',  w: 95 },
  { id: 'mats',    label: 'Mã hàng',     w: 190 },
  { id: 'lines',   label: 'Dòng',        w: 60,  align: 'right' as const },
  { id: 'pl',      label: 'Pallet hạ/cần', w: 110, align: 'right' as const },
  { id: 'qty',     label: `Đã hạ/cần — ${QTY_CONVERTED_LABEL}`, w: 170, align: 'right' as const },
  { id: 'who',     label: 'Giao cho',    w: 150 },
  { id: 'prog',    label: 'Tiến độ',     w: 120 },
  { id: 'created', label: 'Tạo',         w: 110 },
  { id: 'actions', label: '',            w: 66 },
]
const REPORT_COLS = [
  { id: 'who',   label: 'Người thực hiện', w: 200 },
  { id: 'total', label: 'Được giao',       w: 100, align: 'right' as const },
  { id: 'done',  label: 'Đã xong',         w: 100, align: 'right' as const },
  { id: 'rate',  label: 'Tỷ lệ hoàn thành', w: 150 },
  { id: 'qty',   label: QTY_CONVERTED_LABEL, w: 130, align: 'right' as const },
  { id: 'avg',   label: 'TG trung bình',   w: 120, align: 'right' as const },
]

export default function FillPicking() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const navigate = useNavigate()
  const f = useWmsFilterStore(s => s.fill)
  const setFill = useWmsFilterStore(s => s.setFill)
  const setFillFilter = (p: Partial<typeof f>) => setFill({ ...p, page: 1 })

  const canPlan    = can(perms, 'fill', 'plan')
  const canAssign  = can(perms, 'fill', 'assign')
  const canExecute = can(perms, 'fill', 'execute')

  // Công nhân (không có quyền lập kế hoạch) mở trang = vào THẲNG tab Lệnh fill — việc của họ
  // nằm ở đó (vị trí lấy/hạ + nút quét); tab Đề xuất là màn của người lập kế hoạch.
  useEffect(() => {
    if (perms && !canPlan && f.tab === 'demand') setFill({ tab: 'tasks' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPlan])

  const [dense, setDense] = useState(() => localStorage.getItem('fill_density') !== 'comfortable')
  const toggleDensity = () =>
    setDense(d => { localStorage.setItem('fill_density', d ? 'comfortable' : 'compact'); return !d })

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes = [] } = useScopedWhTypes()   // option Loại kho theo scope (luật CLAUDE.md)
  const allowedWh = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids) : null
  const whList = warehouses.filter(w => !allowedWh || allowedWh.has(w.id))
  useEffect(() => {
    if (!f.warehouseId) {
      const def = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (def) setFill({ warehouseId: def })
    }
  }, [user?.warehouse_id])  // eslint-disable-line

  const whId = f.warehouseId
  const filterDefs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', value: whId, allLabel: 'Chọn kho', pinned: true,
      options: whList.map(w => ({ value: w.id, label: w.name })),
      onChange: v => setFillFilter({ warehouseId: v }) },
    ...(f.tab === 'demand' ? [
      // Toggle = chọn-1 Có (KHÔNG multi-1-lựa-chọn trùng tên filter — chip in trùng nhãn,
      // cùng họ bug "Vị trí nhặt lẻVị trí nhặt lẻ" 04/08)
      { key: 'short', label: 'Chỉ mã đang thiếu', type: 'single' as const,
        options: [{ value: 'y', label: 'Có' }], value: f.onlyShort ? 'y' : '',
        onChange: (v: string) => setFillFilter({ onlyShort: v === 'y' }) },
      { key: 'cat', label: 'Loại kho', type: 'multi' as const, searchable: false,
        options: whTypes.map(t => ({ value: t.value, label: t.value })), selected: f.cats,
        onChange: (v: string[]) => setFillFilter({ cats: v }) },
    ] : []),
    ...(f.tab === 'tasks' ? [
      { key: 'status', label: 'Trạng thái', type: 'multi' as const, searchable: false,
        options: [
          { value: 'PENDING', label: 'Chờ làm' },
          { value: 'DONE', label: 'Đã hạ' },
          { value: 'CANCELLED', label: 'Đã hủy' },
        ], selected: f.status,
        onChange: (v: string[]) => setFillFilter({ status: v }) },
      { key: 'mine', label: 'Việc của tôi', type: 'single' as const,
        options: [{ value: 'y', label: 'Có' }], value: f.mine ? 'y' : '',
        onChange: (v: string) => setFillFilter({ mine: v === 'y' }) },
    ] : []),
    ...(f.tab === 'report' ? [
      { key: 'range', label: 'Khoảng ngày', type: 'daterange' as const,
        from: f.reportFrom, to: f.reportTo,
        onChange: (from: string, to: string) => setFillFilter({ reportFrom: from, reportTo: to }) },
    ] : []),
  ]

  const [scanOpen, setScanOpen] = useState(false)
  const [scanMounted, setScanMounted] = useState(false)
  const [scanOrderId, setScanOrderId] = useState<string | undefined>(undefined)
  const openScan = (orderId?: string) => { setScanOrderId(orderId); setScanMounted(true); setScanOpen(true) }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 shrink-0 sm:rounded-t-xl space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 shrink-0">
              <ArrowDownToLine className="h-4 w-4 text-sky-600" /> Fill hàng
            </h1>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-medium shrink-0">
              <button className={`px-2.5 py-1 ${f.tab === 'demand' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setFill({ tab: 'demand' })}>Đề xuất</button>
              <button className={`px-2.5 py-1 border-l border-slate-200 ${f.tab === 'tasks' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setFill({ tab: 'tasks' })}>Lệnh fill</button>
              <button className={`px-2.5 py-1 border-l border-slate-200 ${f.tab === 'report' ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                onClick={() => setFill({ tab: 'report' })}>Kết quả</button>
            </div>
            {/* NGÀY XUẤT là THAM SỐ của phép tính (RPC nhận đúng 1 ngày), không phải bộ lọc phụ →
                để ngay trên toolbar cho thấy rõ đang tính cho ngày nào, thay vì giấu trong chip lọc */}
            {f.tab === 'demand' && (
              <label className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-slate-500 hidden sm:inline">Ngày xuất</span>
                <input type="date" value={f.date} onChange={e => setFillFilter({ date: e.target.value || TODAY })}
                  className="h-9 sm:h-7 rounded border border-slate-200 px-1.5 text-[11px]" />
              </label>
            )}
            {f.tab === 'tasks' && (
              <SearchInput value={f.search} onChange={v => setFillFilter({ search: v })}
                placeholder="Tìm mã lệnh, mã hàng, người…" className="flex-1 min-w-[140px]" />
            )}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <ActionCluster mobileInline items={[
                ...(canExecute && whId ? [{
                  key: 'scan', icon: QrCode, label: 'Quét thực hiện', primary: true,
                  tip: 'Quét tem pallet đúng MÃ + đúng DATE của dòng lệnh → soi vị trí đến → xác nhận hạ',
                  onClick: () => openScan(undefined),
                } satisfies ActionItem] : []),
                {
                  key: 'loose', icon: Info, label: 'Nhặt lẻ',
                  tip: 'Mở trang Nhặt lẻ (nguồn của nhu cầu fill)',
                  onClick: () => navigate('/wms/loosepicking'),
                } satisfies ActionItem,
              ]} />
              <button onClick={toggleDensity} title={dense ? 'Dòng thoáng' : 'Dòng dày'}
                className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50">
                {dense ? <Rows3 className="h-3.5 w-3.5" /> : <AlignJustify className="h-3.5 w-3.5" />}
              </button>
              <span className="sm:hidden ml-auto"><FilterSheetButton defs={filterDefs} /></span>
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
        </div>

        {!whId ? (
          <div className="p-8 text-center text-sm text-slate-400">Chọn kho để xem đề xuất fill hàng</div>
        ) : f.tab === 'demand' ? (
          <DemandTab warehouseId={whId} date={f.date} onlyShort={f.onlyShort} cats={f.cats} dense={dense} canPlan={canPlan} canAssign={canAssign} />
        ) : f.tab === 'tasks' ? (
          <OrdersTab warehouseId={whId} dense={dense} canPlan={canPlan} canExecute={canExecute} onScan={openScan} />
        ) : (
          <ReportTab warehouseId={whId} from={f.reportFrom} to={f.reportTo} dense={dense} />
        )}
      </div>

      {scanMounted && (
        <FillScanOverlay warehouseId={whId} orderId={scanOrderId} open={scanOpen} canAssign={canAssign}
          onClose={() => setScanOpen(false)} />
      )}
    </div>
  )
}

// ─── TAB 1 — ĐỀ XUẤT ─────────────────────────────────────────────────────────
function DemandTab({ warehouseId, date, onlyShort, cats, dense, canPlan, canAssign }: {
  warehouseId: string; date: string; onlyShort: boolean; cats: string[]; dense: boolean; canPlan: boolean; canAssign: boolean
}) {
  const { widths: colW, startResize, totalWidth } = useColumnResize('fill_demand_col_widths', DEMAND_COLS.map(c => c.w))
  const { data, isLoading } = useFillDemand({ warehouse_id: warehouseId, date })
  const createOrder = useCreateFillOrder()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignee, setAssignee] = useState('')
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ created: number; order_code?: string; skipped: FillOrderSkipped[] } | null>(null)
  // Dialog "Đổi date": user chỉ chọn DATE — hệ thống chỉ định lại pallet/vị trí theo date đó
  const [dateRow, setDateRow] = useState<FillDemandRow | null>(null)
  // Bản chỉ định GHI ĐÈ per mã (user đã đổi date). Không có = mặc định FEFO của RPC.
  const [overrides, setOverrides] = useState<Map<string, { date: string; sugg: EffSugg[] }>>(new Map())

  useEffect(() => { setSel(new Set()); setOverrides(new Map()) }, [warehouseId, date])

  // Chỉ định HIỆU LỰC của 1 dòng — mọi cột (pallet/SL hạ/date/vị trí lấy) + Ra lệnh đọc từ đây
  const eff = (r: FillDemandRow): EffSugg[] => overrides.get(r.material_id)?.sugg ?? r.suggestions

  const rows = useMemo(() => {
    let all = data?.rows ?? []
    if (onlyShort) all = all.filter(r => Number(r.short_base) > 0)
    if (cats.length) all = all.filter(r => r.category && cats.includes(r.category))
    return all
  }, [data, onlyShort, cats])

  // Tổng CROSS-MÃ: quy đổi per-mã rồi mới cộng (nhãn "SL (quy đổi)")
  const tot = useMemo(() => {
    let demand = 0, short = 0, shortMats = 0, pallets = 0
    for (const r of rows) {
      demand += qtyEntryDecimal(Number(r.demand_base), r)
      if (Number(r.short_base) > 0) {
        shortMats++
        short += qtyEntryDecimal(Number(r.short_base), r)
        pallets += eff(r).length
      }
    }
    return { demand, short, shortMats, pallets }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, overrides])

  const selectable = rows.filter(r => Number(r.short_base) > 0 && eff(r).length > 0)
  const allSel = selectable.length > 0 && selectable.every(r => sel.has(r.material_id))

  async function raLenh() {
    setErr(''); setResult(null)
    // Một lần Ra lệnh = MỘT lệnh gom; dòng lệnh = (mã, DATE) — gom bản chỉ định theo NSX
    const lines: {
      material_id: string; required_date: string | null; required_expiry: string | null
      qty_base: number; required_pallets: number; src_hint?: string; to_location_id?: string
    }[] = []
    for (const r of rows.filter(r => sel.has(r.material_id))) {
      const s = eff(r)
      if (!s.length) continue
      const groups = new Map<string, EffSugg[]>()
      for (const x of s) {
        const d = x.production_date ? x.production_date.slice(0, 10) : ''
        if (!groups.has(d)) groups.set(d, [])
        groups.get(d)!.push(x)
      }
      for (const [d, g] of groups) {
        const srcs = [...new Set(g.map(x => x.from_location_code).filter(Boolean))] as string[]
        lines.push({
          material_id: r.material_id,
          required_date: d || null,
          required_expiry: g[0].expiry_date ? g[0].expiry_date.slice(0, 10) : null,
          qty_base: g.reduce((t, x) => t + Number(x.avail), 0),
          required_pallets: g.length,
          src_hint: srcs.slice(0, 4).join(', ') + (srcs.length > 4 ? ` +${srcs.length - 4}` : ''),
          // đổi date = bản chỉ định KHÔNG còn là gợi ý mặc định → để BE tự chọn đích khớp loại
          to_location_id: overrides.has(r.material_id) ? undefined : r.to_location?.id,
        })
      }
    }
    if (!lines.length) { setErr('Chưa chọn mã nào có pallet để hạ'); return }
    try {
      const res = await createOrder.mutateAsync({
        warehouse_id: warehouseId, target_date: date, assignee_id: assignee || undefined, lines,
      })
      setResult(res)
      setSel(new Set())
      setOverrides(new Map())   // demand refetch — bản ghi đè đã thành lệnh, quay về FEFO mặc định
      setAssignOpen(false)
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không ra lệnh được')
    }
  }

  // Cột "Date chỉ định (%Date)": date của bản chỉ định hiệu lực + %Date (computePctDate tập trung)
  function pickDateInfo(r: FillDemandRow): { label: string; pct: number | null; multi: boolean } | null {
    const s = eff(r)
    if (!s.length) return null
    const dates = [...new Set(s.map(x => (x.production_date ?? '').slice(0, 10)).filter(Boolean))]
    const first = s[0]
    const pct = computePctDate({ expiry_date: first.expiry_date, production_date: first.production_date }, null)
    return {
      label: first.production_date ? formatTimestampDate(first.production_date, true) : '—',
      pct, multi: dates.length > 1,
    }
  }

  return (
    <>
      <SummaryBand tiles={[
        { label: 'Mã có nhặt lẻ', value: nf(rows.length) },
        { label: 'Mã đang thiếu', value: nf(tot.shortMats), danger: tot.shortMats > 0 },
        { label: `CẦN — ${QTY_CONVERTED_LABEL}`, value: nf(tot.demand), tip: QTY_CONVERTED_TIP },
        { label: `THIẾU — ${QTY_CONVERTED_LABEL}`, value: nf(tot.short), tip: QTY_CONVERTED_TIP, danger: tot.short > 0 },
        { label: 'Pallet cần hạ', value: nf(tot.pallets), accent: tot.pallets > 0 },
      ]} />

      {data && data.pick_face_locations === 0 && (
        <div className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Kho này <b>chưa khai vị trí nhặt lẻ nào</b> nên mọi mã đều hiện "thiếu". Vào <b>Vị trí kho</b> → lọc các vị trí
          tầng dưới → nút <b>"Vị trí nhặt lẻ"</b> để khai hàng loạt, rồi quay lại đây.
        </div>
      )}

      {canPlan && (
        <div className="px-3 py-1.5 border-b bg-slate-50 flex items-center gap-2 flex-wrap shrink-0">
          <span className="text-[11px] text-slate-500">
            Đã chọn <b className="text-slate-700">{sel.size}</b> mã ·
            {' '}{nf(rows.filter(r => sel.has(r.material_id)).reduce((s, r) => s + eff(r).length, 0))} pallet sẽ vào MỘT lệnh
          </span>
          <Button size="sm" className="h-7 text-[11px] ml-auto" disabled={sel.size === 0 || createOrder.isPending}
            onClick={() => { setErr(''); setAssignOpen(true) }}>
            <Plus className="h-3.5 w-3.5 mr-1" />{createOrder.isPending ? 'Đang tạo…' : 'Ra lệnh fill'}
          </Button>
        </div>
      )}
      {err && <p className="mx-3 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
      {result && (
        <div className="mx-3 mt-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-[11px] text-green-800">
          {result.created > 0
            ? <>Đã tạo lệnh <b className="font-mono">{result.order_code}</b> với <b>{result.created}</b> dòng mã — xem tab <b>Lệnh fill</b>.</>
            : <>Không tạo được dòng nào.</>}
          {result.skipped.length > 0 && (
            <div className="mt-1 text-amber-700">
              {result.skipped.length} dòng bị bỏ qua:
              <ul className="list-disc ml-4">
                {result.skipped.slice(0, 6).map((s, i) => (
                  <li key={i}>{s.material_code}{s.required_date ? ` (NSX ${formatDate(s.required_date)})` : ''} — {s.reason}</li>
                ))}
                {result.skipped.length > 6 && <li>… và {result.skipped.length - 6} dòng khác</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className={`table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden ${dense ? '' : '[&_td]:py-2.5'}`}
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {DEMAND_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`relative text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                  {c.id === 'sel' && canPlan ? (
                    <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={allSel}
                      onChange={e => setSel(e.target.checked ? new Set(selectable.map(r => r.material_id)) : new Set())} />
                  ) : c.label}
                  <span onPointerDown={e => startResize(i, e)}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={DEMAND_COLS.length} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={DEMAND_COLS.length} className="text-center py-8 text-xs text-slate-400">
                {onlyShort ? 'Không mã nào thiếu hàng ở vị trí nhặt lẻ — không cần fill' : 'Ngày này không có nhặt lẻ'}
              </TableCell></TableRow>
            ) : rows.map(r => {
              const short = Number(r.short_base)
              const picked = sel.has(r.material_id)
              return (
                <TableRow key={r.material_id} className={short > 0 ? 'text-[#D8891C]' : ''}>
                  <TableCell className={`px-2 py-1 sticky left-0 z-10 ${picked ? 'bg-sky-50' : 'bg-white'}`}>
                    {canPlan && short > 0 && eff(r).length > 0 && (
                      <input type="checkbox" className="h-3 w-3 cursor-pointer" checked={picked}
                        onChange={e => setSel(prev => {
                          const n = new Set(prev)
                          if (e.target.checked) n.add(r.material_id); else n.delete(r.material_id)
                          return n
                        })} />
                    )}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{r.material_code ?? '—'}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.material_name ?? ''}>
                    {r.material_name ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                    {r.category ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums">
                    {qtyLabel(Number(r.demand_base), r)}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                    {qtyLabel(Number(r.pick_face_base), r)}
                    <span className="text-slate-400"> · {r.pick_face_pallets} pl</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                    {Number(r.pending_base) > 0
                      ? <>{qtyLabel(Number(r.pending_base), r)}<span className="text-slate-400"> · {r.pending_n} dòng lệnh</span></>
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className={`px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums ${short > 0 ? 'text-red-600' : ''}`}>
                    {short > 0 ? qtyLabel(short, r) : <span className="text-slate-300">đủ</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right font-semibold tabular-nums">
                    {short > 0
                      ? (eff(r).length || <span className="text-red-600">hết hàng trên</span>)
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums"
                    title="Xe nâng hạ NGUYÊN pallet (chẵn pallet) — tổng hạ có thể vượt số thiếu">
                    {short > 0 && eff(r).length > 0
                      ? qtyLabel(eff(r).reduce((s, x) => s + Number(x.avail), 0), r)
                      : <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    {(() => {
                      if (short <= 0) return <span className="text-slate-300">—</span>
                      const info = pickDateInfo(r)
                      const inner = info
                        ? <>
                            <span className="text-[10px] font-semibold tabular-nums">{info.label}</span>
                            {info.multi && <span className="text-[9px] text-slate-400"> +</span>}
                            {info.pct !== null && (
                              <span className={`ml-1 text-[9px] px-1 py-0.5 rounded ${info.pct < 50 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {info.pct}%
                              </span>
                            )}
                            {overrides.has(r.material_id) && (
                              <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-sky-100 text-sky-700">đã đổi</span>
                            )}
                          </>
                        : <span className="text-[10px] text-slate-400">chọn date…</span>
                      return canPlan
                        ? <button type="button" onClick={() => setDateRow(r)}
                            title="Date hệ thống đang chỉ định — bấm để đổi theo yêu cầu (vị trí lấy hàng đổi theo)"
                            className="inline-flex items-center px-1.5 py-0.5 rounded border border-dashed border-slate-300 hover:border-sky-400 hover:bg-sky-50">
                            {inner}<CalendarSearch className="h-3 w-3 ml-1 text-slate-400" />
                          </button>
                        : <span>{inner}</span>
                    })()}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono">
                    {(() => {
                      const srcs = [...new Set(eff(r).map(s => s.from_location_code).filter(Boolean))] as string[]
                      if (!srcs.length) return <span className="text-slate-300">—</span>
                      const shown = srcs.slice(0, 2).join(', ')
                      return <span title={srcs.join(', ')}>{shown}{srcs.length > 2 ? ` +${srcs.length - 2}` : ''}</span>
                    })()}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono">
                    {r.to_location?.code ?? (short > 0
                      ? <span className="text-red-600 font-sans"
                          title="Không còn vị trí nhặt lẻ trống NHẬN LOẠI KHO của mã này — khai thêm vị trí nhặt lẻ cho loại này ở trang Vị trí kho, hoặc giải phóng chỗ">
                          hết chỗ nhận loại này</span>
                      : <span className="text-slate-300">—</span>)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">{rows.length} mã</div>

      {/* Ra lệnh: chọn người nhận (bỏ trống = để đó, ai cũng nhận được khi quét) */}
      <Dialog open={assignOpen} onOpenChange={o => !o && setAssignOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-1.5">
            <UserPlus className="h-4 w-4 text-sky-600" /> Giao lệnh fill cho ai?
          </DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              Sẽ tạo <b>MỘT lệnh</b> gom <b>{sel.size}</b> mã
              ({nf(rows.filter(r => sel.has(r.material_id)).reduce((s, r) => s + eff(r).length, 0))} pallet)
              cho ngày xuất <b>{date}</b>.
            </p>
            {canAssign ? (
              <AssigneePicker warehouseId={warehouseId} value={assignee} onChange={setAssignee} />
            ) : (
              <p className="text-[11px] text-slate-500">Bạn không có quyền gán người — lệnh sẽ để trống, ai quét thì người đó nhận.</p>
            )}
            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(false)} disabled={createOrder.isPending}>Hủy</Button>
            <Button size="sm" onClick={raLenh} disabled={createOrder.isPending}>
              {createOrder.isPending ? 'Đang tạo…' : 'Ra lệnh'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dateRow && (
        <ChooseDateDialog warehouseId={warehouseId} row={dateRow}
          currentDate={overrides.get(dateRow.material_id)?.date ?? ''}
          onApply={(d, sugg) => {
            setOverrides(prev => {
              const n = new Map(prev)
              if (d === '') n.delete(dateRow.material_id)   // quay về FEFO mặc định của RPC
              else n.set(dateRow.material_id, { date: d, sugg })
              return n
            })
            setDateRow(null)
          }}
          onClose={() => setDateRow(null)} />
      )}
    </>
  )
}

// ─── TAB 2 — LỆNH FILL (danh sách lệnh gom — mở dòng ra trang chi tiết) ──────
function OrdersTab({ warehouseId, dense, canPlan, canExecute, onScan }: {
  warehouseId: string; dense: boolean; canPlan: boolean; canExecute: boolean
  onScan: (orderId: string) => void
}) {
  const navigate = useNavigate()
  const f = useWmsFilterStore(s => s.fill)
  const setFill = useWmsFilterStore(s => s.setFill)
  const { widths: colW, startResize, totalWidth } = useColumnResize('fill_order_col_widths', ORDER_COLS.map(c => c.w))
  const { data, isLoading } = useFillOrders({
    warehouse_id: warehouseId,
    status: f.status.join(','),
    mine: f.mine ? '1' : undefined,
    search: f.search || undefined,
    page: f.page, page_size: f.pageSize,
  })
  const cancelOrder = useCancelFillOrder()
  const [err, setErr] = useState('')

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize))

  async function doCancel(o: FillOrderRow) {
    setErr('')
    try { await cancelOrder.mutateAsync({ id: o.id }) }
    catch (e: unknown) {
      setErr((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Không hủy được lệnh')
    }
  }

  return (
    <>
      <SummaryBand tiles={[
        { label: 'Lệnh chờ làm', value: nf(data?.pending_n ?? 0), accent: (data?.pending_n ?? 0) > 0 },
        { label: 'Đã xong',      value: nf(data?.done_n ?? 0) },
        { label: 'Đã hủy',       value: nf(data?.cancelled_n ?? 0) },
        { label: `ĐÃ HẠ — ${QTY_CONVERTED_LABEL}`, value: nf(data?.done_qty_entry ?? 0), tip: QTY_CONVERTED_TIP },
      ]} />
      {err && <p className="mx-3 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{err}</p>}

      {/* Mobile: chuyển nhanh "Việc của tôi" — công nhân không phải mở sheet lọc */}
      <div className="sm:hidden px-3 pt-2 flex gap-1.5 shrink-0">
        {[{ v: false, label: 'Tất cả' }, { v: true, label: 'Việc của tôi' }].map(t => (
          <button key={t.label} type="button"
            onClick={() => setFill({ mine: t.v, page: 1 })}
            className={`h-9 px-3 rounded-full text-[11px] font-medium border ${f.mine === t.v
              ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {/* MOBILE = THẺ VIỆC (user chốt 05/08: "thông tin và thao tác ở VỊ TRÍ NÀO phải hiện
            ngay view đầu tiên") — vị trí LẤY → VỀ chữ to, nút Quét ngay trên thẻ; bảng đầy đủ
            cột giữ nguyên cho desktop từ breakpoint sm. */}
        <div className="sm:hidden divide-y divide-slate-100">
          {isLoading ? (
            <p className="text-center py-8 text-xs text-slate-400">Đang tải…</p>
          ) : rows.length === 0 ? (
            <p className="text-center py-8 text-xs text-slate-400">Chưa có lệnh fill nào khớp bộ lọc</p>
          ) : rows.map(o => {
            const prog = o.pallets_req > 0 ? Math.min(100, Math.round(o.pallets_done * 100 / o.pallets_req)) : 0
            return (
              <div key={o.id} className="px-3 py-2.5 active:bg-slate-50"
                onClick={() => navigate(`/wms/fill/orders/${o.id}`)}>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-xs font-bold ${fillRowText(o.status) || 'text-slate-800'}`}>{o.order_code}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${FILL_STATUS_BADGE[o.status]}`}>{FILL_STATUS_LABEL[o.status]}</span>
                  <span className="text-[10px] text-slate-400">{formatTimestampDate(o.target_date, true)}</span>
                  <span className="ml-auto text-[11px] tabular-nums font-semibold">{nf(o.pallets_done)}/{nf(o.pallets_req)} pl</span>
                </div>
                {o.status === 'PENDING' && (
                  <div className="mt-1.5 space-y-0.5">
                    <p className="text-[13px] font-mono font-semibold text-slate-800 truncate" title={o.src_hints ?? ''}>
                      <span className="font-sans text-[10px] font-normal text-slate-400 mr-1">LẤY</span>
                      {o.src_hints ?? '—'}
                    </p>
                    <p className="text-[13px] font-mono font-semibold text-sky-700 truncate" title={o.dest_codes ?? ''}>
                      <span className="font-sans text-[10px] font-normal text-slate-400 mr-1">VỀ</span>
                      {o.dest_codes ?? '—'}
                    </p>
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-500 truncate flex-1" title={o.mat_codes ?? ''}>{o.mat_codes ?? '—'}</span>
                  <span className="text-[10px] text-slate-500 truncate max-w-[35%]" title={o.assignees ?? ''}>
                    {o.assignees ?? 'chưa giao'}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-slate-200 overflow-hidden">
                    <div className={`h-full ${prog >= 100 ? 'bg-green-500' : prog > 0 ? 'bg-amber-500' : 'bg-slate-300'}`}
                      style={{ width: `${prog}%` }} />
                  </div>
                  <span className="text-[10px] tabular-nums font-semibold">{prog}%</span>
                  {o.status === 'PENDING' && canExecute && (
                    <Button size="sm" className="h-9 text-[11px] shrink-0"
                      onClick={e => { e.stopPropagation(); onScan(o.id) }}>
                      <QrCode className="h-3.5 w-3.5 mr-1" /> Quét
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className="hidden sm:block">
        <Table className={`table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden ${dense ? '' : '[&_td]:py-2.5'}`}
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {ORDER_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`relative text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}
                  title={c.id === 'qty' ? QTY_CONVERTED_TIP : undefined}>
                  {c.label}
                  <span onPointerDown={e => startResize(i, e)}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={ORDER_COLS.length} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={ORDER_COLS.length} className="text-center py-8 text-xs text-slate-400">Chưa có lệnh fill nào khớp bộ lọc</TableCell></TableRow>
            ) : rows.map(o => {
              const prog = o.pallets_req > 0 ? Math.min(100, Math.round(o.pallets_done * 100 / o.pallets_req)) : 0
              return (
                <TableRow key={o.id} className={`cursor-pointer ${fillRowText(o.status)}`}
                  onClick={() => navigate(`/wms/fill/orders/${o.id}`)}>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap sticky left-0 z-10 bg-white">{formatTimestampDate(o.target_date, true)}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{o.order_code}</TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${FILL_STATUS_BADGE[o.status]}`}>{FILL_STATUS_LABEL[o.status]}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono truncate" title={o.mat_codes ?? ''}>
                    {o.mat_codes ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{nf(o.lines_n)}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold">
                    {nf(o.pallets_done)} / {nf(o.pallets_req)}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                    {nf(Number(o.qty_done_entry))} / {nf(Number(o.qty_req_entry))}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={o.assignees ?? ''}>
                    {o.assignees ?? <span className="text-slate-300">chưa giao</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 min-w-[40px] rounded-full bg-slate-200 overflow-hidden">
                        <div className={`h-full ${prog >= 100 ? 'bg-green-500' : prog > 0 ? 'bg-amber-500' : 'bg-slate-300'}`}
                          style={{ width: `${prog}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums font-semibold shrink-0">{prog}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                    <div className="leading-tight">
                      <div className="text-slate-600 truncate">{o.created_by ?? '—'}</div>
                      <div className="text-[9px] text-slate-400">{formatTimestampDate(o.created_at, true)}</div>
                    </div>
                  </TableCell>
                  {/* Nút trong CELL = icon nhỏ (table-format 17b) */}
                  <TableCell className="px-2 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {o.status === 'PENDING' && (
                      <div className="flex items-center gap-0.5">
                        {canExecute && (
                          <button type="button" title="Quét thực hiện trong lệnh này" onClick={() => onScan(o.id)}
                            className="px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100 hover:text-sky-600">
                            <QrCode className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canPlan && (
                          <button type="button" title="Hủy các dòng còn treo của lệnh này" onClick={() => doCancel(o)}
                            className="px-1.5 py-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </div>
      </div>
      <PagerNav page={f.page} totalPages={totalPages} onPage={p => setFill({ page: p })} />
      <ListFooter page={f.page} pageSize={f.pageSize} total={total} unit="lệnh"
        onPageSize={n => setFill({ pageSize: n, page: 1 })} />
    </>
  )
}

// ─── Dialog "Đổi date chỉ định" (tab Đề xuất) ────────────────────────────────
// User chỉ CHỌN DATE (NSX + %Date, từ tồn thật) — HỆ THỐNG chỉ định pallet + vị trí (FEFO
// trong date đó, đủ bù thiếu thì dừng; xe nâng hạ NGUYÊN pallet). "Áp dụng" KHÔNG tạo lệnh —
// chỉ đổi bản chỉ định trên bảng (cột Vị trí lấy hàng/SL hạ đổi theo); ra lệnh vẫn ở nút
// "Ra lệnh fill" (user chốt 05/08: "chỉ định theo date, bấm vào cột date để thay đổi").
function ChooseDateDialog({ warehouseId, row, currentDate, onApply, onClose }: {
  warehouseId: string; row: FillDemandRow; currentDate: string
  onApply: (date: string, sugg: EffSugg[]) => void; onClose: () => void
}) {
  const { data, isLoading } = useFillCandidates({ warehouse_id: warehouseId, material_id: row.material_id })
  const [dateSel, setDateSel] = useState(currentDate)

  const all = useMemo(() => data?.rows ?? [], [data])
  const dates = useMemo(() => {
    const m = new Map<string, { avail: number; n: number; pct: number | null }>()
    for (const c of all) {
      const d = c.production_date ? c.production_date.slice(0, 10) : ''
      const cur = m.get(d) ?? {
        avail: 0, n: 0,
        pct: computePctDate({ expiry_date: c.fefo_key, production_date: c.production_date }, null),
      }
      cur.avail += Number(c.avail); cur.n += 1; m.set(d, cur)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [all])

  // HỆ THỐNG chỉ định: FEFO trong date đã chọn (không chọn = toàn bộ, FEFO), đủ bù thiếu thì dừng
  const picked = useMemo<EffSugg[]>(() => {
    const pool = dateSel ? all.filter(c => (c.production_date ?? '').slice(0, 10) === dateSel) : all
    const short = Number(row.short_base)
    const out: EffSugg[] = []; let cum = 0
    for (const c of pool) {
      if (cum >= short) break
      out.push({ entry_id: c.entry_id, from_location_code: c.from_location_code,
                 avail: Number(c.avail), production_date: c.production_date, expiry_date: c.fefo_key })
      cum += Number(c.avail)
    }
    return out
  }, [all, dateSel, row.short_base])
  const pickedQty = picked.reduce((s, c) => s + Number(c.avail), 0)
  const pickedSrcs = [...new Set(picked.map(c => c.from_location_code).filter(Boolean))] as string[]

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-1.5">
          <CalendarSearch className="h-4 w-4 text-sky-600" /> Đổi date chỉ định — {row.material_code}
        </DialogTitle></DialogHeader>
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">
            Thiếu <b className="text-red-600">{qtyLabel(Number(row.short_base), row)}</b>.
            Chọn date — hệ thống chỉ định lại pallet & vị trí lấy hàng theo date đó.
            "Tự động" = FEFO (date xa nhất hạ trước).
          </p>
          <SingleSelect
            value={dateSel} onChange={setDateSel}
            options={[{ value: '', label: 'Tự động — FEFO (date xa nhất)' },
              ...dates.map(([d, v]) => ({
                value: d,
                label: `NSX ${d ? formatDate(d) : 'không rõ'}${v.pct !== null ? ` · ${v.pct}%Date` : ''} — ${qtyLabel(v.avail, row)} · ${v.n} pallet`,
              }))]}
            placeholder="Chọn date (NSX)…"
          />
          {/* Hệ thống chỉ định theo date đang chọn — CHỈ ĐỌC, để soát trước khi Áp dụng */}
          <div>
            <p className="text-[10px] font-medium text-slate-500 uppercase mb-1">Hệ thống chỉ định</p>
            <div className="border rounded max-h-52 overflow-auto">
              {isLoading ? (
                <p className="p-3 text-xs text-slate-400">Đang tải tồn kho…</p>
              ) : picked.length === 0 ? (
                <p className="p-3 text-xs text-slate-400">Không còn pallet khả dụng (ngoài vị trí nhặt lẻ) cho date này</p>
              ) : picked.map(c => (
                <div key={c.entry_id} className="flex items-center gap-2 px-2 py-1.5 border-b last:border-b-0">
                  <span className="font-mono text-[10px] text-sky-700 font-semibold flex-1">{c.from_location_code ?? '—'}</span>
                  <span className="text-[10px] tabular-nums font-semibold w-24 text-right">{qtyLabel(Number(c.avail), row)}</span>
                  <span className="text-[9px] text-slate-400 w-14 text-right">{c.production_date ? formatTimestampDate(c.production_date, true) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-600">
            Sẽ hạ <b>{picked.length}</b> pallet · <b>{qtyLabel(pickedQty, row)}</b>
            {pickedSrcs.length > 0 && <> · lấy tại <b className="font-mono">{pickedSrcs.join(', ')}</b></>}
            {pickedQty >= Number(row.short_base) ? <span className="text-green-600"> (đủ bù thiếu)</span>
              : <span className="text-amber-600"> (date này chưa đủ bù thiếu)</span>}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" onClick={() => onApply(dateSel, picked)}
            disabled={isLoading || (dateSel !== '' && picked.length === 0)}>
            Áp dụng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── TAB 3 — KẾT QUẢ ─────────────────────────────────────────────────────────
function ReportTab({ warehouseId, from, to, dense }: {
  warehouseId: string; from: string; to: string; dense: boolean
}) {
  const { widths: colW, startResize, totalWidth } = useColumnResize('fill_report_col_widths', REPORT_COLS.map(c => c.w))
  const { data, isLoading } = useFillReport({ warehouse_id: warehouseId, date_from: from, date_to: to })
  const rows = data?.rows ?? []
  const rate = data && data.total > 0 ? Math.round((data.done / data.total) * 1000) / 10 : 0

  return (
    <>
      <SummaryBand tiles={[
        { label: 'Tổng dòng lệnh', value: nf(data?.total ?? 0) },
        { label: 'Đã xong',   value: nf(data?.done ?? 0) },
        { label: 'Tỷ lệ hoàn thành', value: `${nf(rate)}%`, danger: rate < 80, accent: rate >= 80 },
        { label: 'Chưa giao ai', value: nf(data?.unassigned ?? 0) },
        { label: `ĐÃ HẠ — ${QTY_CONVERTED_LABEL}`, value: nf(data?.qty_entry ?? 0), tip: QTY_CONVERTED_TIP },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className={`table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden ${dense ? '' : '[&_td]:py-2.5'}`}
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {REPORT_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`relative text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}
                  title={c.id === 'qty' ? QTY_CONVERTED_TIP : undefined}>
                  {c.label}
                  <span onPointerDown={e => startResize(i, e)}
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={REPORT_COLS.length} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={REPORT_COLS.length} className="text-center py-8 text-xs text-slate-400">Khoảng ngày này chưa có lệnh fill</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.assignee_id ?? '__none__'} className={r.rate >= 100 ? 'text-[#4A90D9]' : r.done_n > 0 ? 'text-[#D8891C]' : ''}>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate sticky left-0 z-10 bg-white font-medium" title={r.assignee_name}>
                  {r.assignee_name}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{nf(r.total_n)}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums font-semibold">{nf(r.done_n)}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 flex-1 min-w-[40px] rounded-full bg-slate-200 overflow-hidden">
                      <div className={`h-full ${r.rate >= 80 ? 'bg-green-500' : r.rate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, r.rate)}%` }} />
                    </div>
                    <span className="text-[10px] tabular-nums font-semibold shrink-0">{nf(r.rate)}%</span>
                  </div>
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">{nf(Number(r.done_qty_entry))}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap text-right tabular-nums">
                  {r.avg_minutes == null ? <span className="text-slate-300">—</span> : `${nf(r.avg_minutes)} phút`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0">{rows.length} người</div>
    </>
  )
}
