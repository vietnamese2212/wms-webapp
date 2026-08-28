// TRUY XUẤT LÔ — hai chiều trên cùng một màn (28/08, user chốt "truy xuất chắc chắn phải làm").
//
//  · xuôi  (tìm theo Mã pallet / Mã hàng / Mã lô): lô này đã đi tới NPP nào, xe nào, ngày nào —
//    và còn bao nhiêu nằm trong kho để thu hồi tại chỗ.
//  · ngược (tìm theo NPP / Chuyến / Biển số): khách này đã nhận những lô nào.
//
// Hai khoảng ngày TÁCH BẠCH có chủ đích: "Ngày sản xuất" lọc lô, "Ngày giao" lọc chuyến. Gộp một
// khoảng ngày cho cả hai nghĩa là cách chắc chắn làm người đọc hiểu sai kết quả thu hồi.
import { useMemo } from 'react'
import { Search, PackageSearch, Download } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { saveWorkbook } from '@/utils/saveExcel'
import { formatDate, formatTimestampDate } from '@/utils/formatters'
import { useLotTrace, type TraceKind, type TraceShipment, type TraceStock } from '@/api/hooks'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const KINDS: { value: TraceKind; label: string; hint: string; reverse?: boolean }[] = [
  { value: 'pallet',   label: 'Mã pallet (tem)', hint: 'Nhập trọn mã hoặc TIỀN TỐ — vd 190726 = sản xuất 19/07/2026' },
  { value: 'material', label: 'Mã hàng',         hint: 'Mã hàng đầy đủ, nên kèm khoảng Ngày sản xuất' },
  { value: 'batch',    label: 'Mã lô',           hint: 'Chỉ có với tem định dạng chấm phẩy (mã lô in trên tem)' },
  { value: 'npp',      label: 'NPP / khách hàng', hint: 'Tên NPP, tìm gần đúng', reverse: true },
  { value: 'trip',     label: 'Chuyến (mã nhóm)', hint: 'Mã chuyến đầy đủ', reverse: true },
  { value: 'plate',    label: 'Biển số xe',       hint: 'Gõ kiểu nào cũng được — so trên dạng chuẩn', reverse: true },
]

const num = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString('vi-VN')

export default function LotTrace() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canExport = can(perms, 'traceability', 'export')

  const f = useWmsFilterStore(s => s.lotTrace)
  const setF = useWmsFilterStore(s => s.setLotTrace)
  const kindDef = KINDS.find(k => k.value === f.kind) ?? KINDS[0]

  const q = useLotTrace({
    kind: f.kind, value: f.value,
    prodFrom: f.prodFrom, prodTo: f.prodTo, shipFrom: f.shipFrom, shipTo: f.shipTo,
  })
  const s = q.data?.summary
  const shipments = q.data?.shipments ?? []
  const stock = q.data?.stock ?? []

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: 'kind', label: 'Tìm theo', type: 'single', pinned: true, options: KINDS.map(k => ({ value: k.value, label: k.label })),
      value: f.kind, allLabel: undefined, onChange: v => setF({ kind: (v || 'pallet') as TraceKind }) },
    // ⚠️ Nhãn phải KHÁC hẳn chip "Tìm theo" ở trên. Bản đầu để nhãn = tên kiểu tìm nên hai chip
    // đọc gần giống nhau ("Tìm theo Mã pallet (tem)" vs "Mã pallet (tem)") — chính tôi gõ nhầm
    // giá trị vào ô CHỌN KIỂU ngay lần thử đầu tiên.
    { key: 'value', label: 'Giá trị cần tìm', type: 'text', pinned: true,
      placeholder: kindDef.hint, value: f.value, onChange: v => setF({ value: v }) },
    // Ngày SX chỉ có nghĩa khi truy TỪ LÔ; ngày giao chỉ có nghĩa khi truy TỪ KHÁCH — ẩn cái không dùng
    ...(kindDef.reverse ? [] : [{
      key: 'prod', label: 'Ngày sản xuất', type: 'daterange' as const,
      from: f.prodFrom, to: f.prodTo,
      onChange: (from: string, to: string) => setF({ prodFrom: from, prodTo: to }),
    }]),
    { key: 'ship', label: 'Ngày giao', type: 'daterange',
      from: f.shipFrom, to: f.shipTo,
      onChange: (from: string, to: string) => setF({ shipFrom: from, shipTo: to }) },
  ], [f, kindDef, setF])

  async function onExport() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shipments.map(r => ({
      'Mã pallet': r.pallet_code, 'Mã hàng': r.material_code, 'Tên hàng': r.short_name,
      'Mã lô': r.batch, 'Ngày SX': r.production_date?.slice(0, 10) ?? '', 'HSD': r.expiry_date?.slice(0, 10) ?? '',
      'SL xuất': r.cartons_scanned, 'Ngày giao': r.delivery_date ?? '', 'Chuyến': r.group_code,
      'Biển số': r.license_plate, 'NPP / khách': r.distributor_name, 'Số DO': r.delivery_code,
      'Kho xuất': r.warehouse_name, 'Lúc quét': r.scanned_at ?? '',
    }))), 'DaGiao')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stock.map(r => ({
      'Mã pallet': r.pallet_code, 'Mã hàng': r.material_code, 'Tên hàng': r.short_name,
      'Mã lô': r.batch, 'Ngày SX': r.production_date?.slice(0, 10) ?? '', 'HSD': r.expiry_date?.slice(0, 10) ?? '',
      'Còn lại': r.cartons_remaining, 'Trạng thái': r.status, 'Kho': r.warehouse_name, 'Vị trí': r.location_code,
    }))), 'ConTrongKho')
    await saveWorkbook(wb, `Truy-xuat-${f.kind}-${f.value}.xlsx`)
  }

  const actions: ActionItem[] = canExport && (shipments.length || stock.length) ? [{
    key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất hồ sơ truy xuất (2 sheet: đã giao · còn trong kho)',
    onClick: onExport, mobileHidden: true,
  }] : []

  const searching = f.value.trim().length >= (f.kind === 'pallet' ? 4 : 2)

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 sm:py-2 space-y-1 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 uppercase tracking-wide shrink-0">
              <PackageSearch className="h-4 w-4 text-sky-600" /> Truy xuất lô
            </span>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              {kindDef.reverse ? 'khách hàng → đã nhận lô nào' : 'lô hàng → đã giao đi đâu'}
            </span>
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
            Không truy xuất được — {(q.error as { response?: { data?: { error?: { message?: string } } } })
              ?.response?.data?.error?.message ?? 'thử lại'}
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
            <div className="p-8 text-center text-xs text-slate-400">
              Chọn cách tìm rồi nhập giá trị — {kindDef.hint.toLowerCase()}.
            </div>
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
      </div>
    </div>
  )
}

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
          {['Mã pallet', 'Mã hàng', 'Tên hàng', 'Mã lô', 'Ngày SX', 'HSD', 'SL xuất', 'Ngày giao', 'Chuyến', 'Biển số', 'NPP / khách', 'Số DO', 'Kho xuất']
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
          {['Mã pallet', 'Mã hàng', 'Tên hàng', 'Mã lô', 'Ngày SX', 'HSD', 'Còn lại', 'Trạng thái', 'Kho', 'Vị trí', 'Ngày nhập']
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
