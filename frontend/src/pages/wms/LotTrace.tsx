// TRUY XUẤT LÔ — hai chiều trên cùng một màn (28/08, user chốt "truy xuất chắc chắn phải làm").
//
//  · xuôi  (tìm theo Mã pallet / Mã hàng / Mã lô): lô này đã đi tới NPP nào, xe nào, ngày nào —
//    và còn bao nhiêu nằm trong kho để thu hồi tại chỗ.
//  · ngược (tìm theo NPP / Chuyến / Biển số): khách này đã nhận những lô nào.
//
// TRUY XUẤT THEO THÙNG (01/09, user chỉnh v2 cùng ngày): tab = BẢNG HỒ SƠ đã lưu; nút "Truy xuất
// mới" mở FORM (FormSheet): bắt buộc Ngày · Giờ SX · Máy · Chu kỳ (mã hàng tùy chọn, ảnh + AI đọc
// giờ). Tem pallet có thể lệch ±1–3 ngày so chữ in phun → form GỢI Ý SỔ ĐÓNG GÓI theo Máy + Chu kỳ
// trong cửa sổ ±3 ngày, user xem từng sổ (pallet + giờ) rồi BUỘC CHỌN 1 sổ → kết quả = HÀNH TRÌNH
// toàn công ty (SX kho nào → nhập → xuất → kho nhận → xuất tiếp → còn ở đâu) → Lưu vào bảng.
import { useMemo, useRef, useState } from 'react'
import { PackageSearch, Download, ImagePlus, Sparkles, X, Plus, Eye } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FilterBar, FilterSheetButton, dedupOpts, type FilterDef } from '@/components/shared/FilterBar'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { saveWorkbook } from '@/utils/saveExcel'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { apiClient } from '@/api/client'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  useLotTrace, useMaterials, useInvestigatePreview, useCreateInvestigation, useSystemSettings,
  useTraceInvestigations, useTraceInvestigation, useTraceRuns, useTraceRunPallets, useTraceSuggest,
  type TraceSuggestKind, type TraceShipment, type TraceStock,
  type CartonMatch, type TraceInvestigation, type TraceRun, type InvestigateTrace,
} from '@/api/hooks'
import { useWmsFilterStore, LOT_TRACE_DEFAULT } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

// FILTER CHUẨN (user chốt 01/09 tối lần 3 "tại sao k làm theo filter chuẩn"): KHÔNG còn mô hình
// "Tìm theo 1 kiểu + 1 giá trị" — chọn CHIỀU truy vết rồi mỗi tiêu chí là MỘT chip filter riêng
// trên FilterBar, điền ô nào lọc ô đó (kết hợp AND), không gì bắt buộc. Thuật ngữ đồng bộ toàn
// app: Tem pallet · Mã hàng · Chu kỳ · Máy · Kho SX (ký hiệu) · Số xe. 'Mã lô' là khái niệm tem
// V2 chấm phẩy — đơn vị tem V1 cột batch luôn rỗng nên chỉ hiện khi label_format=semicolon.

const num = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString('vi-VN')
const apiErrMsg = (e: unknown) =>
  (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'thử lại'
const ts = (s: string | null | undefined) => s ? `${formatTimestampDate(s, true)} ${formatTimestampTime(s)}` : '—'

type Tab = 'trace' | 'carton'

export default function LotTrace() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canExport = can(perms, 'traceability', 'export')
  const canInvestigate = can(perms, 'traceability', 'investigate')
  const [tab, setTab] = useState<Tab>('trace')

  const TabBtn = ({ k, label }: { k: Tab; label: string }) => (
    <button
      onClick={() => setTab(k)}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        tab === k ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
    >{label}</button>
  )

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 shrink-0 sm:rounded-t-xl flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 uppercase tracking-wide shrink-0">
            <PackageSearch className="h-4 w-4 text-sky-600" /> Truy xuất lô
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1 flex-wrap">
            <TabBtn k="trace" label="Truy xuất lô" />
            <TabBtn k="carton" label="Truy xuất theo thùng" />
          </div>
        </div>
        {tab === 'trace' && <TraceTab canExport={canExport} />}
        {tab === 'carton' && <CartonTab canInvestigate={canInvestigate} />}
      </div>
    </div>
  )
}

/* ═══ TAB 1 — TRUY XUẤT LÔ (nguyên trạng 28/08) ═══════════════════════════════════════════════ */

// 1 ô lọc = 1 dropdown tìm-trên-server: term + gợi ý + loading gói lại một chỗ, gọi cố định
// 9 lần ở TraceTab (không trong vòng lặp — luật hook)
function useSug(kind: TraceSuggestKind, on: boolean) {
  const [term, setTerm] = useState('')
  const dTerm = useDebouncedValue(term, 250)
  const q = useTraceSuggest(kind, dTerm, on)
  return { term: dTerm, setTerm, opts: q.data ?? [], loading: q.isFetching }
}
type Sug = ReturnType<typeof useSug>
// Giá trị đọc từ tem/chứng từ mà nguồn gợi ý chưa có → vẫn dùng được qua dòng đầu 'Dùng "…"'
const withFree = (sug: Sug, label?: (t: string) => string) => {
  const t = sug.term.trim()
  return t ? dedupOpts([{ value: t, label: label ? label(t) : `Dùng "${t}"` }, ...sug.opts]) : sug.opts
}

function TraceTab({ canExport }: { canExport: boolean }) {
  const raw = useWmsFilterStore(s => s.lotTrace)
  const setF = useWmsFilterStore(s => s.setLotTrace)
  // state cũ đã persist (shape "Tìm theo" trước 01/09) thiếu field mới — thiếu default là .trim() nổ
  const f = useMemo(() => ({ ...LOT_TRACE_DEFAULT, ...raw }), [raw])
  const isRev = f.dir === 'rev'

  // 'Mã lô' chỉ có nghĩa với tem V2 (chấm phẩy) — đọc cờ label_format để ẩn với đơn vị tem V1
  const { data: sysSettings = [] } = useSystemSettings()
  const isV2 = (sysSettings.find(x => x.key === 'label_format')?.value as string) === 'semicolon'

  const q = useLotTrace({
    dir: f.dir,
    pallet: f.pallet, material: f.material, batch: f.batch,
    cycle: f.cycle, machine: f.machine, nmsx: f.nmsx,
    npp: f.npp, trip: f.trip, plate: f.plate,
    prodFrom: f.prodFrom, prodTo: f.prodTo, shipFrom: f.shipFrom, shipTo: f.shipTo,
  })
  const s = q.data?.summary
  const shipments = q.data?.shipments ?? []
  const stock = q.data?.stock ?? []

  const sPallet = useSug('pallet', !isRev)
  const sMaterial = useSug('material', !isRev)
  const sCycle = useSug('cycle', !isRev)
  const sMachine = useSug('machine', !isRev)
  const sNmsx = useSug('nmsx', !isRev)
  const sBatch = useSug('batch', !isRev && isV2)
  const sNpp = useSug('npp', isRev)
  const sTrip = useSug('trip', isRev)
  const sPlate = useSug('plate', isRev)

  const sel = (key: string, label: string, value: string, onChange: (v: string) => void,
               sug: Sug, opts: { value: string; label: string }[], pinned = true) => ({
    key, label, type: 'single' as const, pinned,
    options: opts, value, allLabel: undefined,
    serverSearch: true as const, onSearchChange: sug.setTerm, loading: sug.loading,
    selectedOpts: value ? [{ value, label: value }] : [],
    onChange: (v: string) => onChange(v || ''),
  })

  const filterDefs: FilterDef[] = useMemo(() => isRev ? [
    sel('npp', 'NPP / khách hàng', f.npp, v => setF({ npp: v }), sNpp, withFree(sNpp)),
    sel('trip', 'Số xe', f.trip, v => setF({ trip: v }), sTrip, withFree(sTrip)),
    sel('plate', 'Biển số xe', f.plate, v => setF({ plate: v }), sPlate, withFree(sPlate)),
    { key: 'ship', label: 'Ngày giao', type: 'daterange' as const, pinned: true,
      from: f.shipFrom, to: f.shipTo,
      onChange: (from: string, to: string) => setF({ shipFrom: from, shipTo: to }) },
  ] : [
    sel('pallet', 'Tem pallet', f.pallet, v => setF({ pallet: v }), sPallet,
      withFree(sPallet, t => t.length >= 4 ? `Tiền tố "${t}" — mọi pallet bắt đầu bằng chuỗi này` : `Dùng "${t}" (cần ≥4 ký tự)`)),
    sel('material', 'Mã hàng', f.material, v => setF({ material: v }), sMaterial, sMaterial.opts),
    sel('cycle', 'Chu kỳ', f.cycle, v => setF({ cycle: v }), sCycle, withFree(sCycle)),
    sel('machine', 'Máy', f.machine, v => setF({ machine: v }), sMachine, withFree(sMachine)),
    sel('nmsx', 'Kho SX (ký hiệu)', f.nmsx, v => setF({ nmsx: v }), sNmsx, withFree(sNmsx)),
    ...(isV2 ? [sel('batch', 'Mã lô', f.batch, v => setF({ batch: v }), sBatch, withFree(sBatch), false)] : []),
    { key: 'prod', label: 'Ngày sản xuất', type: 'daterange' as const, pinned: true,
      from: f.prodFrom, to: f.prodTo,
      onChange: (from: string, to: string) => setF({ prodFrom: from, prodTo: to }) },
    { key: 'ship', label: 'Ngày giao', type: 'daterange' as const,
      from: f.shipFrom, to: f.shipTo,
      onChange: (from: string, to: string) => setF({ shipFrom: from, shipTo: to }) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [f, isRev, isV2, setF, sPallet, sMaterial, sCycle, sMachine, sNmsx, sBatch, sNpp, sTrip, sPlate])

  async function onExport() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shipments.map(r => ({
      'Tem pallet': r.pallet_code, 'Mã hàng': r.material_code, 'Tên hàng': r.short_name,
      'Mã lô': r.batch, 'Ngày SX': r.production_date?.slice(0, 10) ?? '', 'HSD': r.expiry_date?.slice(0, 10) ?? '',
      'SL xuất': r.cartons_scanned, 'Ngày giao': r.delivery_date ?? '', 'Số xe': r.group_code,
      'Biển số': r.license_plate, 'NPP / khách': r.distributor_name, 'Số DO': r.delivery_code,
      'Kho xuất': r.warehouse_name, 'Lúc quét': r.scanned_at ?? '',
    }))), 'DaGiao')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stock.map(r => ({
      'Tem pallet': r.pallet_code, 'Mã hàng': r.material_code, 'Tên hàng': r.short_name,
      'Mã lô': r.batch, 'Ngày SX': r.production_date?.slice(0, 10) ?? '', 'HSD': r.expiry_date?.slice(0, 10) ?? '',
      'Còn lại': r.cartons_remaining, 'Trạng thái': r.status, 'Kho': r.warehouse_name, 'Vị trí': r.location_code,
    }))), 'ConTrongKho')
    const tag = [f.pallet, f.material, f.batch, f.cycle, f.machine, f.nmsx, f.npp, f.trip, f.plate]
      .map(v => v.trim()).filter(Boolean).join('-') || (isRev ? 'nguoc' : 'xuoi')
    await saveWorkbook(wb, `Truy-xuat-${tag}.xlsx`)
  }

  const actions: ActionItem[] = canExport && (shipments.length || stock.length) ? [{
    key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất hồ sơ truy xuất (2 sheet: đã giao · còn trong kho)',
    onClick: onExport, mobileHidden: true,
  }] : []

  // KHÔNG gì bắt buộc — có bất kỳ điều kiện nào của chiều đang chọn là tìm ("ra filter nào lấy cái đó")
  const searching = isRev
    ? !!(f.npp.trim() || f.trip.trim() || f.plate.trim() || f.shipFrom || f.shipTo)
    : !!(f.pallet.trim().length >= 4 || f.material.trim() || f.batch.trim()
         || f.cycle.trim() || f.machine.trim() || f.nmsx.trim() || f.prodFrom || f.prodTo)

  const DirBtn = ({ rev, label }: { rev: boolean; label: string }) => (
    <button
      onClick={() => setF({ dir: rev ? 'rev' : 'fwd' })}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        isRev === rev ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
    >{label}</button>
  )

  return (
    <>
      <div className="border-b bg-white px-3 py-1.5 sm:py-2 space-y-1 sm:space-y-1.5 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            <DirBtn rev={false} label="⬊ Xuôi: lô hàng → khách" />
            <DirBtn rev={true}  label="⬈ Ngược: khách → lô hàng" />
          </div>
          <span className="flex-1" />
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <FilterSheetButton defs={filterDefs} className="sm:hidden" />
            <ActionCluster items={actions} mobileInline />
          </div>
        </div>
        <FilterBar defs={filterDefs} />
      </div>

      <SummaryBand tiles={[
        { label: 'Pallet khớp', value: num(s?.pallets), accent: true },
        { label: 'Lượt giao', value: num(s?.shipments) },
        { label: 'Khách hàng', value: num(s?.customers) },
        { label: 'Chuyến', value: num(s?.trips) },
        { label: 'SL đã giao', value: num(s?.qty_shipped) },
        { label: 'SL còn trong kho', value: num(s?.qty_on_hand) },
      ]} />

      {q.isError && (
        <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
          Không truy xuất được — {apiErrMsg(q.error)}
        </div>
      )}
      {s?.truncated && (
        <div className="mx-3 mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Kết quả quá nhiều nên chỉ hiện phần đầu — ô tổng phía trên vẫn là số ĐẦY ĐỦ. Thu hẹp bằng
          khoảng ngày hoặc mã cụ thể hơn để xem hết danh sách.
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!searching ? (
          <TraceGuide isV2={isV2} />
        ) : q.isLoading ? (
          <div className="p-3 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : (
          <>
            <SectionBand title={`Đã giao đi đâu (${num(s?.shipments)})`} />
            <ShipTable rows={shipments} />
            <SectionBand title={`Còn trong kho (${num(s?.stock_rows)} dòng · ${num(s?.qty_on_hand)})`} />
            <StockTable rows={stock} />
          </>
        )}
      </div>
    </>
  )
}

/* ═══ Hướng dẫn dùng (hiện khi chưa nhập gì) — thuật ngữ đồng bộ toàn app ═════════════════════ */

const GUIDE_ROWS = [
  { k: 'Tem pallet',       dir: 'Xuôi',  q: 'Trọn mã hoặc TIỀN TỐ tem — gõ đến đâu khoanh đến đó', ex: '190726_510000127_9_130_95005_B — hoặc chỉ 190726' },
  { k: 'Mã hàng',          dir: 'Xuôi',  q: 'Khoanh về một mã hàng',                               ex: '510000127' },
  { k: 'Chu kỳ · Máy · Kho SX', dir: 'Xuôi', q: 'Thông số SX đọc từ tem/chữ in phun — chọn bất kỳ ô nào', ex: 'Chu kỳ 9 · Máy 130 · Kho SX B' },
  { k: 'Ngày sản xuất',    dir: 'Xuôi',  q: 'Khoanh theo khoảng ngày SX — càng hẹp càng nhanh',    ex: '19/07 – 20/07' },
  { k: 'Mã lô',            dir: 'Xuôi',  q: 'Mã lô trên tem chấm phẩy',                            ex: 'TA260705A018', v2Only: true },
  { k: 'NPP / khách hàng', dir: 'Ngược', q: 'Khách này đã NHẬN những lô nào?',                     ex: 'NPPPHUONGHOAN' },
  { k: 'Số xe',            dir: 'Ngược', q: 'Chuyến xe này chở những lô nào?',                     ex: '20000016_X_140826_532' },
  { k: 'Biển số xe',       dir: 'Ngược', q: 'Xe biển này đã chở những lô nào? (gõ kiểu nào cũng khớp)', ex: '61C29923' },
  { k: 'Ngày giao',        dir: 'Ngược', q: 'Khoanh theo khoảng ngày giao hàng',                   ex: '13/08 – 14/08' },
]
// Giải phẫu tem V1 — DÙNG ĐÚNG thuật ngữ của Sổ đóng gói / Truy xuất theo thùng
const TEM_PARTS = [
  ['190726', 'Ngày SX (19/07/26)'], ['510000127', 'Mã hàng'], ['9', 'Chu kỳ'],
  ['130', 'Máy'], ['95005', 'Số pallet'], ['B', 'Kho SX (ký hiệu)'],
]

function TraceGuide({ isV2 }: { isV2: boolean }) {
  const rows = GUIDE_ROWS.filter(r => !('v2Only' in r && r.v2Only) || isV2)
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4 text-xs">
      <p className="text-slate-600">
        Chọn <b>chiều truy vết</b> ở góc trái rồi điền <b>bất kỳ ô lọc nào</b> — điền ô nào lọc
        ô đó, kết hợp được nhiều ô, không gì bắt buộc. Chiều <b>XUÔI</b> đi từ lô hàng → đã giao
        cho ai + còn bao nhiêu trong kho để thu hồi; chiều <b>NGƯỢC</b> đi từ khách / chuyến / xe
        → đã nhận những lô nào.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
          <TableHeader>
            <TableRow>
              {['Chiều', 'Ô lọc', 'Dùng để', 'Ví dụ'].map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.k}>
                <TableCell className={TD}>{r.dir}</TableCell>
                <TableCell className={`${TD} font-semibold`}>{r.k}</TableCell>
                <TableCell className={`${TD} !whitespace-normal`}>{r.q}</TableCell>
                <TableCell className={`${TD} font-mono text-slate-500`}>{r.ex}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 space-y-1.5">
        <p className="font-semibold text-slate-700">Đọc tem pallet thế nào?</p>
        <p className="font-mono text-[11px] text-slate-700 break-all">
          {TEM_PARTS.map(([v], i) => (<span key={i}>{i > 0 && <span className="text-slate-300">_</span>}<span className="font-semibold">{v}</span></span>))}
        </p>
        <p className="text-slate-500 !whitespace-normal">
          {TEM_PARTS.map(([v, label]) => `${v} = ${label}`).join(' · ')}
        </p>
        <p className="text-slate-500">
          Tìm theo <b>tiền tố</b> nên khoanh dần được: gõ <span className="font-mono">190726</span> ra
          mọi pallet SX ngày đó, thêm <span className="font-mono">190726_510000127</span> là khoanh
          về một mã hàng. Nếu trên tay chỉ có <b>thùng</b> (không có tem pallet) → dùng tab
          <b> Truy xuất theo thùng</b>: nhập Giờ SX + Máy + Chu kỳ để tìm qua sổ đóng gói.
        </p>
      </div>
    </div>
  )
}

/* ═══ TAB 2 — TRUY XUẤT THEO THÙNG (bảng hồ sơ + form Truy xuất mới) ══════════════════════════ */

const todayVn = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

function CartonTab({ canInvestigate }: { canInvestigate: boolean }) {
  const f = useWmsFilterStore(s => s.traceInv)
  const setF = useWmsFilterStore(s => s.setTraceInv)
  const q = useTraceInvestigations({ from: f.from, to: f.to, search: f.search, page: f.page })
  const [openId, setOpenId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const rows = q.data?.rows ?? []
  const total = q.data?.total ?? 0
  const pageSize = q.data?.page_size ?? 50
  const maxPage = Math.max(1, Math.ceil(total / pageSize))

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: 'created', label: 'Ngày truy xuất', type: 'daterange', from: f.from, to: f.to,
      onChange: (from, to) => setF({ from, to, page: 1 }) },
    { key: 'search', label: 'Tìm', type: 'text', pinned: true,
      placeholder: 'Mã hàng · người thực hiện · ghi chú', value: f.search,
      onChange: v => setF({ search: v, page: 1 }) },
  ], [f, setF])

  const actions: ActionItem[] = canInvestigate ? [{
    key: 'new', icon: Plus, label: 'Truy xuất mới', tip: 'Nhập giờ in phun trên thùng + máy + chu kỳ, chọn sổ đóng gói rồi truy hành trình',
    onClick: () => setFormOpen(true), primary: true,
  }] : []

  return (
    <>
      <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            mỗi dòng = một lần truy xuất từ thùng thực tế — bấm dòng để xem lại hành trình + ảnh
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <FilterSheetButton defs={filterDefs} className="sm:hidden" />
            <ActionCluster items={actions} mobileInline />
          </div>
        </div>
        <FilterBar defs={filterDefs} />
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {q.isLoading ? (
          <div className="p-3 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Chưa có lượt truy xuất nào{canInvestigate ? ' — bấm "Truy xuất mới" để bắt đầu' : ''}.
          </div>
        ) : (
          <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
            <TableHeader>
              <TableRow>
                {['Lúc truy xuất', 'Người thực hiện', 'Giờ trên thùng', 'Máy', 'Chu kỳ', 'Mã hàng', 'Sổ đóng gói', 'Kho SX', 'Pallet', 'Khách', 'SL giao', 'Ảnh', 'Bối cảnh', 'Kết luận']
                  .map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-sky-50/40" onClick={() => setOpenId(r.id)}>
                  <TableCell className={TD}>{ts(r.created_at)}</TableCell>
                  <TableCell className={TD}>{r.performed_by_name ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={TD}>{ts(r.carton_at)}</TableCell>
                  <TableCell className={`${TD} font-mono`}>{r.machine_code ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} font-mono`}>{r.cycle ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} font-mono font-semibold`}>{r.material_code ?? r.run?.material_code ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={TD}>{r.run?.run_date ? `${formatDate(r.run.run_date)} · ${r.run.shift ?? ''}` : <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={TD}>{r.run?.warehouse_name ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} font-semibold tabular-nums`}>{r.matched?.length ?? 0}</TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{num(r.summary?.customers)}</TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{num(r.summary?.qty_shipped)}</TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{r.photos?.length ? r.photos.length : <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} max-w-[160px] truncate`}>{r.note ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} max-w-[160px] truncate`}>{r.result_note ?? <span className="text-slate-300">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="border-t bg-white px-3 py-1.5 text-[10px] text-slate-500 flex items-center gap-2 shrink-0">
        <span>{total ? `${(f.page - 1) * pageSize + 1}–${Math.min(f.page * pageSize, total)} / ${total} lượt truy xuất` : '0 lượt truy xuất'}</span>
        <span className="flex-1" />
        <button disabled={f.page <= 1} onClick={() => setF({ page: f.page - 1 })}
          className="px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-40">‹</button>
        <span>trang {f.page}/{maxPage}</span>
        <button disabled={f.page >= maxPage} onClick={() => setF({ page: f.page + 1 })}
          className="px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-40">›</button>
      </div>
      <RecordSheet id={openId} onClose={() => setOpenId(null)} />
      {formOpen && <InvestigateForm open={formOpen} onClose={() => setFormOpen(false)} />}
    </>
  )
}

/* ═══ FORM TRUY XUẤT MỚI (FormSheet — panel phải, header/thân/footer chuẩn) ═══════════════════ */

// Ảnh khách gửi: nén 1600px JPEG 0.75 — đủ NÉT cho AI đọc chữ in phun, đủ nhẹ để lưu bằng chứng
async function compressPhoto(file: File): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Không đọc được ảnh'))
    r.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Ảnh hỏng'))
    i.src = url
  })
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.75)
}

const INPUT = 'h-8 w-full rounded-md border border-slate-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-400'
const LABEL = 'text-[10px] font-medium text-slate-500'

function InvestigateForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [date, setDate] = useState(todayVn())
  const [time, setTime] = useState('')
  const [machine, setMachine] = useState('')
  const [cycle, setCycle] = useState('')
  const [nmsx, setNmsx] = useState('')
  const [matCode, setMatCode] = useState('')
  const [matTerm, setMatTerm] = useState('')
  const { data: mats = [], isFetching: matLoading } = useMaterials({ search: matTerm, limit: 50 })
  const [note, setNote] = useState('')
  const [resultNote, setResultNote] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [photoErr, setPhotoErr] = useState('')
  const [aiBusy, setAiBusy] = useState<number | null>(null)
  const [aiMsg, setAiMsg] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [viewRunId, setViewRunId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Gợi ý sổ SỐNG theo Máy + Chu kỳ + Ngày (±3 ngày, debounce khi đang gõ)
  const dMachine = useDebouncedValue(machine, 300)
  const dCycle = useDebouncedValue(cycle, 300)
  const dNmsx = useDebouncedValue(nmsx, 300)
  const runsQ = useTraceRuns({ machine: dMachine, cycle: dCycle, date, material_code: matCode || undefined, nmsx: dNmsx || undefined })
  const runs = runsQ.data ?? []
  const viewQ = useTraceRunPallets(viewRunId)

  const preview = useInvestigatePreview()
  const create = useCreateInvestigation()

  const timeOk = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)
  const baseOk = !!date && !!machine.trim() && !!cycle.trim()
  const input = {
    run_id: runId ?? '', carton_date: date, carton_time: time,
    machine_code: machine.trim(), cycle: cycle.trim(),
    ...(matCode ? { material_code: matCode } : {}),
  }
  const selectedMat = mats.find(m => m.material_code === matCode)

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return
    setPhotoErr('')
    try {
      const added: string[] = []
      for (const fl of Array.from(files).slice(0, 6 - photos.length)) added.push(await compressPhoto(fl))
      setPhotos(p => [...p, ...added].slice(0, 6))
    } catch (e) { setPhotoErr((e as Error).message) }
    if (fileRef.current) fileRef.current.value = ''
  }

  // AI đọc chữ in phun từ ảnh — điền Ngày + Giờ; lỗi thì báo nhẹ, KHÔNG chặn nhập tay
  async function onAiRead(i: number) {
    setAiBusy(i); setAiMsg('')
    try {
      const { data } = await apiClient.post('/wms/packing/vision-ocr', { photo_data: photos[i] })
      const d = data?.data as { time?: string | null; nsx_date?: string | null } | undefined
      if (d?.time) setTime(d.time)
      if (d?.nsx_date) setDate(d.nsx_date)
      setAiMsg(d?.time ? `AI đọc được: ${d.nsx_date ?? 'không rõ ngày'} · ${d.time}` : 'AI không đọc được giờ trên ảnh — nhập tay giúp')
    } catch (e) {
      setAiMsg(`AI không đọc được (${apiErrMsg(e)}) — nhập tay giúp`)
    } finally { setAiBusy(null) }
  }

  function onTrace() { if (runId && timeOk) preview.mutate(input) }
  function onSave() {
    create.mutate({ ...input, note: note.trim() || undefined, result_note: resultNote.trim() || undefined, photos },
      { onSuccess: () => onClose() })
  }

  const r = preview.data ?? null
  const canSave = !!r && !create.isPending

  return (
    <FormSheet
      open={open} onClose={onClose}
      title="Truy xuất theo thùng"
      description="Nhập thông số in phun trên thùng → chọn đúng sổ đóng gói → xem hành trình rồi lưu hồ sơ"
      widthClass="sm:max-w-4xl"
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Hủy</Button>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" disabled={!canSave} onClick={onSave}>
          {create.isPending ? 'Đang lưu…' : 'Lưu hồ sơ truy xuất'}
        </Button>
      </>}
    >
      <div className="space-y-3">
        {/* ── Thông tin trên thùng ── */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
          <div>
            <p className={LABEL}>Ngày SX (in phun) *</p>
            <input type="date" className={INPUT} value={date} onChange={e => { setDate(e.target.value); setRunId(null) }} />
          </div>
          <div>
            <p className={LABEL}>Giờ SX (in phun) *</p>
            <input type="time" step={1} className={INPUT} value={time} onChange={e => setTime(e.target.value)} />
          </div>
          <div>
            <p className={LABEL}>Máy sản xuất *</p>
            <input className={INPUT} placeholder="vd A · 103" value={machine} onChange={e => { setMachine(e.target.value); setRunId(null) }} />
          </div>
          <div>
            <p className={LABEL}>Chu kỳ (của tháng) *</p>
            <input className={INPUT} placeholder="vd 9" value={cycle} onChange={e => { setCycle(e.target.value); setRunId(null) }} />
          </div>
          <div>
            <p className={LABEL}>Kho SX (ký hiệu)</p>
            <input className={INPUT} placeholder="vd B · D" value={nmsx} onChange={e => { setNmsx(e.target.value.toUpperCase()); setRunId(null) }} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className={LABEL}>Mã hàng (tùy chọn)</p>
            <SingleSelect
              value={matCode} onChange={v => { setMatCode(v); setRunId(null) }}
              serverSearch onSearchChange={setMatTerm} loading={matLoading}
              selectedLabel={selectedMat ? `${selectedMat.material_code} ${selectedMat.short_name ?? ''}` : matCode || undefined}
              searchPlaceholder="Tìm mã / tên hàng…" placeholder="Không bắt buộc"
              triggerClassName="h-8"
              options={mats.map(m => ({
                value: m.material_code,
                label: `${m.material_code} ${m.short_name ?? m.material_description ?? ''}`,
              }))}
            />
          </div>
        </div>

        {/* ── Ảnh + AI đọc giờ ── */}
        <div className="flex items-start gap-2 flex-wrap">
          {photos.map((p, i) => (
            <div key={i} className="relative group">
              <img src={p} alt={`Ảnh ${i + 1}`} className="h-16 w-16 object-cover rounded border border-slate-200" />
              <button onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-slate-700 text-white flex items-center justify-center"
                title="Bỏ ảnh"><X className="h-2.5 w-2.5" /></button>
              <button onClick={() => onAiRead(i)} disabled={aiBusy !== null}
                className="absolute bottom-0 inset-x-0 bg-sky-600/90 text-white text-[9px] py-0.5 rounded-b flex items-center justify-center gap-0.5 disabled:opacity-60"
                title="AI đọc ngày + giờ in phun từ ảnh này">
                <Sparkles className="h-2.5 w-2.5" /> {aiBusy === i ? 'Đọc…' : 'AI đọc'}
              </button>
            </div>
          ))}
          {photos.length < 6 && (
            <button onClick={() => fileRef.current?.click()}
              className="h-16 w-16 rounded border border-dashed border-slate-300 text-slate-400 flex flex-col items-center justify-center gap-0.5 hover:border-sky-400 hover:text-sky-500">
              <ImagePlus className="h-4 w-4" /><span className="text-[9px]">Thêm ảnh</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => void onPickFiles(e.target.files)} />
        </div>
        {photoErr && <p className="text-[10px] text-red-600">{photoErr}</p>}
        {aiMsg && <p className="text-[10px] text-sky-700">{aiMsg}</p>}

        {/* ── Gợi ý sổ đóng gói (±3 ngày quanh ngày in phun — tem có thể lệch ngày) ── */}
        <section className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-1.5 bg-slate-100 border-b border-slate-200 px-2.5 py-1.5">
            <span className="h-3.5 w-1 rounded-full bg-sky-500 shrink-0" />
            <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">Chọn sổ đóng gói khớp điều kiện *</p>
            <p className="text-[10px] text-slate-400 ml-auto normal-case">tìm theo Máy + Chu kỳ trong ±3 ngày (tem có thể lệch ngày so với in phun)</p>
          </div>
          <div className="p-2">
            {!baseOk ? (
              <p className="text-[11px] text-slate-400 px-1 py-2">Nhập đủ Ngày · Máy · Chu kỳ để hiện gợi ý sổ.</p>
            ) : runsQ.isLoading ? (
              <div className="space-y-1.5 p-1">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
            ) : runsQ.isError ? (
              <p className="text-[11px] text-red-600 px-1 py-2">Không tìm được sổ — {apiErrMsg(runsQ.error)}</p>
            ) : runs.length === 0 ? (
              <p className="text-[11px] text-amber-700 px-1 py-2">
                Không có sổ đóng gói nào của máy "{machine}" · chu kỳ "{cycle}" trong ±3 ngày quanh {formatDate(date)}.
                Kiểm lại máy/chu kỳ, hoặc sổ hôm đó chưa được ghi.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
                  <TableHeader>
                    <TableRow>
                      {['Chọn', 'Ngày sổ', 'Ca', 'Chu kỳ', 'Máy', 'Mã hàng', 'Kho SX', 'Giờ BĐ → KT', 'Pallet', 'SL (quy đổi)', 'Người mở', ''].map(h =>
                        <TableHead key={h} className={TH}>{h}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map(run => (
                      <TableRow key={run.id}
                        className={`cursor-pointer ${runId === run.id ? 'bg-sky-50' : 'hover:bg-sky-50/40'}`}
                        onClick={() => { setRunId(run.id); preview.reset() }}>
                        <TableCell className={TD}>
                          <input type="radio" checked={runId === run.id} readOnly className="accent-sky-600" />
                        </TableCell>
                        <TableCell className={TD}>{run.run_date ? formatDate(run.run_date) : '—'}</TableCell>
                        <TableCell className={TD}>{run.shift ?? <span className="text-slate-300">—</span>}</TableCell>
                        <TableCell className={`${TD} font-mono`}>{run.cycle ?? '—'}</TableCell>
                        <TableCell className={`${TD} font-mono`}>{run.machine_code ?? '—'}</TableCell>
                        <TableCell className={`${TD} font-mono`}>{(run.material_codes?.length ? run.material_codes.join(' · ') : run.material_code) ?? '—'}</TableCell>
                        <TableCell className={TD}>
                          {run.warehouse_name ?? <span className="text-slate-300">—</span>}
                          {run.warehouse_nmsx && <span className="text-slate-400"> ({run.warehouse_nmsx})</span>}
                        </TableCell>
                        <TableCell className={TD}>{run.start_at ? `${ts(run.start_at)} → ${run.end_at ? formatTimestampTime(run.end_at) : '…'}` : '—'}</TableCell>
                        <TableCell className={`${TD} tabular-nums`}>{run.pallet_count != null ? num(run.pallet_count) : '—'}</TableCell>
                        <TableCell className={`${TD} tabular-nums`}>{run.qty_total != null ? num(run.qty_total) : '—'}</TableCell>
                        <TableCell className={TD}>{run.opened_by_name ?? <span className="text-slate-300">—</span>}</TableCell>
                        <TableCell className={TD}>
                          <button onClick={e => { e.stopPropagation(); setViewRunId(viewRunId === run.id ? null : run.id) }}
                            className="px-1.5 py-1 rounded text-sky-600 hover:bg-sky-50 flex items-center gap-1"
                            title="Xem danh sách pallet + giờ của sổ này">
                            <Eye className="h-3.5 w-3.5" /><span className="text-[10px]">{viewRunId === run.id ? 'Đóng' : 'Xem'}</span>
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {viewRunId && (
              <div className="mt-2 rounded border border-sky-200 bg-sky-50/40 p-2">
                <p className="text-[10px] font-semibold text-slate-600 mb-1">
                  Pallet của sổ {viewQ.data?.run?.run_date ? formatDate(viewQ.data.run.run_date) : ''} · {viewQ.data?.run?.warehouse_name ?? ''}
                </p>
                {viewQ.isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <div className="overflow-x-auto"><MatchTable rows={viewQ.data?.pallets ?? []} /></div>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="flex items-center gap-2">
          <button onClick={onTrace} disabled={!runId || !timeOk || preview.isPending}
            className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium disabled:opacity-50">
            {preview.isPending ? 'Đang truy xuất…' : 'Truy xuất hành trình'}
          </button>
          {!runId && <span className="text-[10px] text-slate-400">Chọn 1 sổ đóng gói ở trên</span>}
          {runId && !timeOk && <span className="text-[10px] text-slate-400">Nhập Giờ SX (HH:MM)</span>}
        </div>
        {preview.isError && (
          <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
            Không truy xuất được — {apiErrMsg(preview.error)}
          </div>
        )}

        {/* ── Kết quả ── */}
        {r && (
          <>
            <SummaryBand tiles={[
              { label: 'Pallet của sổ', value: num(r.trace?.summary?.pallets ?? r.matched.length), accent: true },
              { label: 'Khớp giờ ★', value: num(r.matched.filter(m => m.time_hit).length) },
              { label: 'Khách hàng', value: num(r.trace?.summary?.customers) },
              { label: 'Chuyến', value: num(r.trace?.summary?.trips) },
              { label: 'SL đã giao', value: num(r.trace?.summary?.qty_shipped) },
              { label: 'Còn trong kho', value: num(r.trace?.summary?.qty_on_hand) },
            ]} />
            <SectionBand title={`Hành trình hàng hóa (${r.matched.length} pallet · ★ = chứa giờ in phun)`} />
            <div className="overflow-x-auto"><JourneyTable matched={r.matched} trace={r.trace} /></div>
            <SectionBand title={`Đã giao đi đâu (${num(r.trace?.summary?.shipments)})`} />
            <div className="overflow-x-auto"><ShipTable rows={r.trace?.shipments ?? []} /></div>
            <SectionBand title={`Còn trong kho (${num(r.trace?.summary?.stock_rows)} dòng · ${num(r.trace?.summary?.qty_on_hand)})`} />
            <div className="overflow-x-auto"><StockTable rows={r.trace?.stock ?? []} /></div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div>
                <p className={LABEL}>Bối cảnh (khiếu nại gì, ai báo…)</p>
                <textarea className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs min-h-[52px]"
                  value={note} onChange={e => setNote(e.target.value)} />
              </div>
              <div>
                <p className={LABEL}>Kết luận của người truy xuất</p>
                <textarea className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs min-h-[52px]"
                  value={resultNote} onChange={e => setResultNote(e.target.value)} />
              </div>
            </div>
            {create.isError && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
                Không lưu được — {apiErrMsg(create.error)}
              </div>
            )}
          </>
        )}
      </div>
    </FormSheet>
  )
}

/* ═══ HÀNH TRÌNH — sinh ra ở đâu, đi qua những đâu, còn ở đâu (toàn công ty) ═══════════════════ */

type JEvent = { t: number; when: string | null; label: string; place: string; qty: number | null }

function buildJourney(matched: CartonMatch[], trace: InvestigateTrace | null | undefined): { pallet: string; hit: boolean; events: JEvent[] }[] {
  const runWh = trace?.run?.warehouse_name ?? null
  const inbound = trace?.inbound ?? []
  const ships = trace?.shipments ?? []
  const stock = trace?.stock ?? []
  return matched.map(m => {
    const events: JEvent[] = []
    if (m.prod_start_at) events.push({
      t: new Date(m.prod_start_at).getTime(), when: m.prod_start_at,
      label: `Đóng gói (máy ${m.machine_code ?? '—'})`, place: runWh ?? m.warehouse_id ?? '—', qty: m.qty_cartons,
    })
    for (const i of inbound.filter(x => x.pallet_code === m.pallet_code)) events.push({
      t: new Date(i.created_at).getTime(), when: i.created_at,
      label: `Nhập kho${i.import_date ? ` (${formatDate(i.import_date)})` : ''}`,
      place: i.warehouse_name ?? '—', qty: i.cartons_imported,
    })
    for (const sp of ships.filter(x => x.pallet_code === m.pallet_code)) events.push({
      t: sp.scanned_at ? new Date(sp.scanned_at).getTime() : Number.MAX_SAFE_INTEGER - 1, when: sp.scanned_at,
      label: `Xuất chuyến ${sp.group_code}${sp.delivery_date ? ` (${formatDate(sp.delivery_date)})` : ''}`,
      place: `${sp.warehouse_name ?? '—'} → ${sp.distributor_name ?? '—'}`, qty: sp.cartons_scanned,
    })
    for (const st of stock.filter(x => x.pallet_code === m.pallet_code && Number(x.cartons_remaining) > 0)) events.push({
      t: Number.MAX_SAFE_INTEGER, when: null,
      label: 'ĐANG TỒN', place: `${st.warehouse_name ?? '—'}${st.location_code ? ` · ${st.location_code}` : ''}`,
      qty: st.cartons_remaining,
    })
    events.sort((a, b) => a.t - b.t)
    return { pallet: m.pallet_code, hit: !!m.time_hit, events }
  })
}

function JourneyTable({ matched, trace }: { matched: CartonMatch[]; trace: InvestigateTrace | null | undefined }) {
  const rows = buildJourney(matched, trace)
  if (!rows.length) return <div className="px-3 py-4 text-[11px] text-slate-400">Sổ này chưa có pallet nào.</div>
  return (
    <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
      <TableHeader>
        <TableRow>
          {['Tem pallet', '★', 'Bước', 'Thời điểm', 'Sự kiện', 'Nơi', 'SL (quy đổi)'].map(h =>
            <TableHead key={h} className={TH}>{h}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p, pi) => (
          p.events.length === 0 ? (
            <TableRow key={p.pallet} className="bg-slate-50">
              <TableCell className={`${TD} font-mono font-semibold`}>{p.pallet}</TableCell>
              <TableCell className={TD}>{p.hit ? '★' : ''}</TableCell>
              <TableCell className={TD} colSpan={5}><span className="text-slate-400">Chưa có dữ liệu nhập/xuất</span></TableCell>
            </TableRow>
          ) : p.events.map((e, i) => (
            <TableRow key={`${p.pallet}-${i}`}
              className={`${p.hit ? 'bg-amber-50/60' : pi % 2 ? 'bg-slate-50/60' : ''} ${i === 0 ? '[&_td]:border-t [&_td]:!border-t-slate-300' : ''}`}>
              <TableCell className={`${TD} font-mono font-semibold`}>{i === 0 ? p.pallet : ''}</TableCell>
              <TableCell className={`${TD} text-amber-600 font-semibold`}>{i === 0 && p.hit ? '★' : ''}</TableCell>
              <TableCell className={`${TD} tabular-nums text-slate-400`}>{i + 1}</TableCell>
              <TableCell className={TD}>{e.when ? ts(e.when) : <span className="text-slate-300">hiện tại</span>}</TableCell>
              <TableCell className={`${TD} ${e.label === 'ĐANG TỒN' ? 'text-green-600 font-semibold' : ''}`}>{e.label}</TableCell>
              <TableCell className={`${TD} max-w-[280px] truncate`}>{e.place}</TableCell>
              <TableCell className={`${TD} font-semibold tabular-nums`}>{e.qty != null ? num(e.qty) : '—'}</TableCell>
            </TableRow>
          ))
        ))}
      </TableBody>
    </Table>
  )
}

function MatchTable({ rows }: { rows: CartonMatch[] }) {
  if (!rows.length) return <div className="px-2 py-3 text-[11px] text-slate-400">Sổ này chưa có pallet nào.</div>
  return (
    <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
      <TableHeader>
        <TableRow>
          {['Tem pallet', 'Mã hàng', 'Giờ thùng đầu → cuối', 'SL (quy đổi)', 'Người đóng gói'].map(h =>
            <TableHead key={h} className={TH}>{h}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(m => (
          <TableRow key={m.pallet_code} className="hover:bg-sky-50/40">
            <TableCell className={`${TD} font-mono font-semibold`}>{m.pallet_code}</TableCell>
            <TableCell className={`${TD} font-mono`}>{m.material_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>
              {m.prod_start_at ? `${ts(m.prod_start_at)} → ${m.prod_end_at ? formatTimestampTime(m.prod_end_at) : '…'}` : '—'}
            </TableCell>
            <TableCell className={`${TD} font-semibold tabular-nums`}>{m.qty_cartons != null ? num(m.qty_cartons) : '—'}</TableCell>
            <TableCell className={TD}>{m.packed_by_name ?? <span className="text-slate-300">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/* ═══ DETAIL HỒ SƠ (bấm dòng trong bảng) ══════════════════════════════════════════════════════ */

function RecordSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useTraceInvestigation(id)
  const r = q.data
  const trace = (r?.trace ?? null) as InvestigateTrace | null
  return (
    <Sheet open={!!id} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:w-[860px] sm:max-w-[860px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="text-sm">
            Hồ sơ truy xuất {r ? `· máy ${r.machine_code ?? '—'} · chu kỳ ${r.cycle ?? '—'} · ${ts(r.carton_at)}` : ''}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-auto">
          {q.isLoading ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : q.isError ? (
            <div className="m-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
              Không mở được hồ sơ — {apiErrMsg(q.error)}
            </div>
          ) : r ? (
            <div className="p-3 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <DRow k="Người thực hiện" v={r.performed_by_name ?? '—'} />
                <DRow k="Lúc truy xuất" v={ts(r.created_at)} />
                <DRow k="Giờ trên thùng" v={ts(r.carton_at)} />
                <DRow k="Máy · Chu kỳ" v={`${r.machine_code ?? '—'} · ${r.cycle ?? '—'}`} mono />
                <DRow k="Mã hàng" v={r.material_code ?? trace?.run?.material_code ?? '—'} mono />
                <DRow k="Sổ đóng gói" v={trace?.run ? `${trace.run.run_date ? formatDate(trace.run.run_date) : '—'} · ${trace.run.shift ?? ''} · ${trace.run.warehouse_name ?? ''}` : '—'} />
              </div>
              {r.note && <DRow k="Bối cảnh" v={r.note} />}
              {r.result_note && <DRow k="Kết luận" v={r.result_note} />}
              {(r.photo_urls?.length ?? 0) > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {r.photo_urls!.map(p => (
                    <a key={p.path} href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.url} alt={p.path} className="h-24 w-24 object-cover rounded border border-slate-200" />
                    </a>
                  ))}
                </div>
              )}
              {trace?.summary && (
                <SummaryBand tiles={[
                  { label: 'Pallet của sổ', value: num(trace.summary.pallets ?? r.matched?.length), accent: true },
                  { label: 'Khớp giờ ★', value: num((r.matched ?? []).filter(m => m.time_hit).length) },
                  { label: 'Khách hàng', value: num(trace.summary.customers) },
                  { label: 'SL đã giao', value: num(trace.summary.qty_shipped) },
                  { label: 'Còn trong kho', value: num(trace.summary.qty_on_hand) },
                ]} />
              )}
              <SectionBand title={`Hành trình hàng hóa (${r.matched?.length ?? 0} pallet)`} />
              <div className="overflow-x-auto"><JourneyTable matched={r.matched ?? []} trace={trace} /></div>
              <SectionBand title="Đã giao đi đâu" />
              <div className="overflow-x-auto"><ShipTable rows={trace?.shipments ?? []} /></div>
              <SectionBand title="Còn trong kho" />
              <div className="overflow-x-auto"><StockTable rows={trace?.stock ?? []} /></div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <p className="flex gap-2">
      <span className="w-28 shrink-0 text-slate-400">{k}</span>
      <span className={`text-slate-700 ${mono ? 'font-mono' : ''}`}>{v}</span>
    </p>
  )
}

/* ═══ Thành phần dùng chung ═══════════════════════════════════════════════════════════════════ */

function SectionBand({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 bg-slate-100 border-y border-slate-200 px-3 py-1.5 sticky top-0 z-20">
      <span className="h-3.5 w-1 rounded bg-sky-500" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{title}</span>
    </div>
  )
}

const TH = 'text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'

function ShipTable({ rows }: { rows: TraceShipment[] }) {
  if (!rows.length) return <div className="px-3 py-4 text-[11px] text-slate-400">Chưa có lượt giao nào khớp.</div>
  return (
    <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
      <TableHeader>
        <TableRow>
          {['Tem pallet', 'Mã hàng', 'Tên hàng', 'Mã lô', 'Ngày SX', 'HSD', 'SL xuất', 'Ngày giao', 'Số xe', 'Biển số', 'NPP / khách', 'Số DO', 'Kho xuất']
            .map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.pallet_code}-${r.group_code}-${i}`} className="hover:bg-sky-50/40">
            <TableCell className={`${TD} font-mono font-semibold`}>{r.pallet_code}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.material_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} max-w-[220px] truncate`}>{r.short_name ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.batch ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.production_date ? formatTimestampDate(r.production_date, true) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.expiry_date ? formatDate(r.expiry_date) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-semibold tabular-nums`}>{num(r.cartons_scanned)}</TableCell>
            <TableCell className={TD}>{r.delivery_date ? formatDate(r.delivery_date) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.group_code}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.license_plate ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} max-w-[200px] truncate`}>{r.distributor_name ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.delivery_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.warehouse_name ?? <span className="text-slate-300">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function StockTable({ rows }: { rows: TraceStock[] }) {
  if (!rows.length) return <div className="px-3 py-4 text-[11px] text-slate-400">Không còn tồn của lô này trong kho.</div>
  return (
    <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
      <TableHeader>
        <TableRow>
          {['Tem pallet', 'Mã hàng', 'Tên hàng', 'Mã lô', 'Ngày SX', 'HSD', 'Còn lại', 'Trạng thái', 'Kho', 'Vị trí', 'Ngày nhập']
            .map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={`${r.pallet_code}-${r.warehouse_name}-${r.location_code}`} className="hover:bg-sky-50/40">
            <TableCell className={`${TD} font-mono font-semibold`}>{r.pallet_code}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.material_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} max-w-[220px] truncate`}>{r.short_name ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.batch ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.production_date ? formatTimestampDate(r.production_date, true) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.expiry_date ? formatDate(r.expiry_date) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-semibold tabular-nums`}>{num(r.cartons_remaining)}</TableCell>
            <TableCell className={TD}>{r.status}</TableCell>
            <TableCell className={TD}>{r.warehouse_name ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.location_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.import_date ? formatDate(r.import_date) : <span className="text-slate-300">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
