// TAB "CHÊNH LỆCH TỒN" của Báo cáo NVL (25/11 — user: "phần mềm này chạy riêng biệt, nhưng khi kiểm kê thực tế thì sẽ đối chiếu với SAP ⇒ khi đó
// cần show ra được phần chênh lệch là gì"; chốt: tab riêng, chỉ kho chế biến). SAP nhận Cấp / Huỷ cấp qua tab Dữ liệu thô; phần app có mà SAP
// không có là các tác động ĐỔI TỒN SỔ ngoài cấp: xoá hàng chặn (NVL hoàn về khi huỷ cấp nhưng không tái dùng được) + điều chỉnh tay / kiểm kê /
// nạp Excel. Ba khung xem:
//   • Theo mã — mỗi mã: tồn sổ hiện tại · đang chặn (chưa điều chỉnh) · trong kỳ: chặn / bỏ chặn / xoá hàng chặn / điều chỉnh khác · chênh lệch so SAP
//   • Đang chặn — từng lô chặn còn mở; người có quyền Điều chỉnh tồn xoá khỏi tồn hoặc bỏ chặn ĐÚNG lô đó
//   • Từng tác động — mỗi dòng một lần chặn / bỏ chặn / xoá / điều chỉnh (lúc · tem · lượng · lý do · người · ca / mẻ)
// Xuất Excel (quyền export): ba khung + sheet Thông tin. Số tự cập nhật qua sổ hàng chặn + sổ điều chỉnh (realtime). Hàm DB mes_stock_variance.
import { useState, type ReactNode } from 'react'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { FileDown, X } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { PagerNav } from '@/components/shared/ListPager'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import { can, type ModulePermissions } from '@/config/permissions'
import {
  useProductionWarehouses, useStockVariance, fetchVarianceEvents, defaultKitchen,
  type VarianceRow, type VarianceEvent, type VarianceKind, type BlockRow,
} from '@/api/productionHooks'
import { BlockActSheet } from '@/components/wms/production/BlockSheets'
import { qtyNum, matUnitCode, unitCode } from '@/utils/unitCode'
import { formatDate, formatDateTime } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeAoa } from '@/utils/excelSafe'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const dash = <span className="text-slate-300 font-normal">—</span>
const KIND_VI: Record<VarianceKind, string> = { BLOCK: 'Chặn (huỷ cấp)', RELEASE: 'Bỏ chặn', WRITE_OFF: 'Xoá hàng chặn', ADJUST: 'Điều chỉnh tồn' }
const KIND_TONE: Record<VarianceKind, 'amber' | 'slate' | 'red' | 'sky'> = { BLOCK: 'amber', RELEASE: 'slate', WRITE_OFF: 'red', ADJUST: 'sky' }
const SRC_VI: Record<BlockRow['source'], string> = { REVERSE: 'Huỷ cấp', BATCH_CANCEL: 'Huỷ mẻ' }
const EV_SIZE = 200

const MAT_COLS: RtColDef[] = [
  { id: 'mat', label: 'Nguyên liệu', w: 180 }, { id: 'unit', label: 'ĐVT', w: 56 },
  // số cần đọc trước (chênh lệch so SAP) đứng ngay sau tên — điện thoại không phải cuộn ngang mới thấy
  { id: 'var', label: 'Chênh lệch so SAP', w: 125, align: 'right' }, { id: 'wo', label: 'Xoá hàng chặn', w: 105, align: 'right' },
  { id: 'adj', label: 'Điều chỉnh khác', w: 110, align: 'right' }, { id: 'open', label: 'Đang chặn', w: 100, align: 'right' },
  { id: 'blk', label: 'Chặn trong kỳ', w: 100, align: 'right' }, { id: 'rel', label: 'Bỏ chặn', w: 90, align: 'right' },
  { id: 'book', label: 'Tồn sổ hiện tại', w: 110, align: 'right' },
]
const BLK_COLS: RtColDef[] = [
  { id: 'tem', label: 'Tem / lô', w: 150 }, { id: 'mat', label: 'Nguyên liệu', w: 200 }, { id: 'unit', label: 'ĐVT', w: 56 },
  { id: 'lot', label: 'NSX · Lô NCC', w: 130 }, { id: 'qty', label: 'Chặn', w: 90, align: 'right' }, { id: 'open', label: 'Còn chặn', w: 90, align: 'right' },
  { id: 'why', label: 'Lý do', w: 220 }, { id: 'src', label: 'Nguồn', w: 130 }, { id: 'at', label: 'Lúc', w: 120 }, { id: 'by', label: 'Người', w: 120 },
  { id: 'act', label: '', w: 150 },
]
const EV_COLS: RtColDef[] = [
  { id: 'at', label: 'Lúc', w: 120 }, { id: 'kind', label: 'Tác động', w: 115 }, { id: 'mat', label: 'Nguyên liệu', w: 200 }, { id: 'unit', label: 'ĐVT', w: 56 },
  { id: 'tem', label: 'Tem / lô', w: 140 }, { id: 'qty', label: 'Lượng', w: 90, align: 'right' }, { id: 'eff', label: 'Đổi tồn sổ', w: 95, align: 'right' },
  { id: 'note', label: 'Lý do / ghi chú', w: 260 }, { id: 'by', label: 'Người', w: 120 }, { id: 'ref', label: 'Ca / mẻ', w: 120 },
]

/** số có dấu: âm đỏ, dương hổ phách, 0 gạch */
function Signed({ n, m }: { n: number; m: Parameters<typeof qtyNum>[1] }) {
  if (!n) return dash
  return <span className={n < 0 ? 'text-red-600' : 'text-amber-700'}>{n > 0 ? '+' : '−'}{qtyNum(Math.abs(n), m)}</span>
}

export function StockVariance({ tabBar }: { tabBar: ReactNode }) {
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canExport = can(perms, 'production', 'export')
  const canAdjust = can(perms, 'inventory', 'adjust')
  const f = useWmsFilterStore(s => s.productionReport)
  const setF = useWmsFilterStore(s => s.setProductionReport)
  const { data: { kitchens } } = useProductionWarehouses()
  const wh = kitchens.some(k => k.id === f.warehouseId) ? f.warehouseId : defaultKitchen(kitchens, f.warehouseId || useGlobalScopeStore.getState().warehouseId)
  const whName = kitchens.find(k => k.id === wh)?.name ?? ''
  // "Hôm nay" là hàm: kỳ trống ⇒ đầu tháng → hôm nay, tính lúc mở màn
  const today = vnToday()
  const from = f.varFrom || `${today.slice(0, 8)}01`, to = f.varTo || today
  const base = { warehouse_id: wh, date_from: from, date_to: to }
  const view = f.varView ?? 'mat'
  const [evMat, setEvMat] = useState('')
  const [evPage, setEvPage] = useState(1)
  const sumQ = useStockVariance<VarianceRow>('summary', base, !!wh)
  const blkQ = useStockVariance<BlockRow>('blocks', base, !!wh)
  const evQ = useStockVariance<VarianceEvent>('events', { ...base, ...(evMat ? { material_id: evMat } : {}), page: evPage, page_size: EV_SIZE }, !!wh && view === 'events')
  const rows = sumQ.data?.rows ?? []
  const blocks = blkQ.data?.rows ?? []
  const events = evQ.data?.rows ?? []
  const evTotal = evQ.data?.total ?? 0
  const evPages = Math.max(1, Math.ceil(evTotal / EV_SIZE))
  const [act, setAct] = useState<{ block: BlockRow; kind: 'WRITE_OFF' | 'RELEASE' } | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const evMatCode = rows.find(r => r.material_id === evMat)?.material_code ?? blocks.find(b => b.material_id === evMat)?.material_code ?? ''

  const defs: FilterDef[] = [
    { key: 'date', label: 'Kỳ', type: 'daterange', from, to, onChange: (a, b) => { setF({ varFrom: a, varTo: b }); setEvPage(1) }, pinned: true },
  ]
  const openEvents = (mid: string) => { setEvMat(mid); setEvPage(1); setF({ varView: 'events' }) }

  async function exportExcel() {
    setErr(''); setBusy('Đang tải…')
    try {
      const evs = await fetchVarianceEvents(base)
      const wb = XLSX.utils.book_new()
      const add = (aoa: (string | number)[][], widths: number[], name: string) => {
        const ws = XLSX.utils.aoa_to_sheet(sanitizeAoa(aoa))
        ws['!cols'] = widths.map(wch => ({ wch }))
        if (aoa.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) }
        XLSX.utils.book_append_sheet(wb, ws, name)
      }
      add([['Mã NVL', 'Tên', 'ĐVT', 'Tồn sổ hiện tại', 'Đang chặn (chưa điều chỉnh)', 'Chặn trong kỳ', 'Bỏ chặn trong kỳ', 'Xoá hàng chặn trong kỳ', 'Điều chỉnh khác trong kỳ', 'Số lần điều chỉnh khác', 'Chênh lệch so SAP trong kỳ'],
        ...rows.map(r => [r.material_code, r.material_name ?? '', unitCode(r.base_unit), Number(r.book), Number(r.blocked_open), Number(r.blocked), Number(r.released), -Number(r.written_off), Number(r.adjusted), Number(r.adjust_count), Number(r.variance)])],
        [14, 30, 7, 14, 16, 12, 12, 16, 16, 10, 18], 'Chênh lệch theo mã')
      add([['Lúc', 'Tác động', 'Mã NVL', 'Tên', 'ĐVT', 'Tem / pallet', 'NSX', 'Lô NCC', 'Lượng', 'Đổi tồn sổ', 'Lý do / ghi chú', 'Người', 'Ca / mẻ'],
        ...evs.map(e => [formatDateTime(e.at), KIND_VI[e.kind], e.material_code, e.material_name ?? '', unitCode(e.base_unit), e.pallet_code, e.production_date ?? '', e.batch_lot ?? '',
          Number(e.qty), Number(e.effect), e.note ?? '', e.actor ?? '', e.ref ?? ''])],
        [17, 15, 14, 28, 7, 18, 11, 12, 10, 11, 50, 18, 16], 'Từng tác động')
      add([['Tem / pallet', 'Mã NVL', 'Tên', 'ĐVT', 'NSX', 'Lô NCC', 'Chặn', 'Đã xoá', 'Đã bỏ chặn', 'Còn chặn', 'Lý do', 'Nguồn', 'Mẻ', 'Lúc chặn', 'Người chặn'],
        ...blocks.map(b => [b.pallet_code, b.material_code, b.material_name ?? '', unitCode(b.base_unit), b.production_date ?? '', b.batch_lot ?? '', Number(b.qty), Number(b.written_off),
          Number(b.released), Number(b.open), b.reason, SRC_VI[b.source], b.batch_code ?? '', formatDateTime(b.created_at), b.created_by_name ?? ''])],
        [18, 14, 28, 7, 11, 12, 10, 10, 10, 10, 40, 10, 22, 17, 18], 'Hàng đang chặn')
      add([['Mục', 'Giá trị'], ['Dữ liệu', 'Chênh lệch tồn kho chế biến — đối chiếu SAP khi kiểm kê'], ['Kho chế biến', whName], ['Kỳ', `${from} → ${to} (giờ Việt Nam)`],
        ['Xuất lúc', formatDateTime(new Date().toISOString())], [],
        ['Ghi chú', 'Số lượng theo ĐƠN VỊ GỐC của mã (cột ĐVT).'],
        ['', 'Cấp / Huỷ cấp NVL cho mẻ: SAP nhận qua file Dữ liệu thô — không tính ở đây.'],
        ['', 'Chặn = NVL hoàn về đúng tem khi huỷ cấp nhưng không tái dùng được: vẫn trong tồn sổ, không cấp / xuất được. Bỏ chặn = trả về dùng được.'],
        ['', 'Chênh lệch so SAP = điều chỉnh khác (tay / kiểm kê / nạp Excel, có dấu) − xoá hàng chặn, trong kỳ.']],
        [24, 110], 'Thông tin')
      await saveWorkbook(wb, `chenh_lech_ton_${from}_${to}.xlsx`)
    } catch (e) { setErr(apiMsg(e)) } finally { setBusy('') }
  }

  const actions: ActionItem[] = []
  if (canExport && wh) actions.push({ key: 'xlsx', icon: FileDown, label: busy || 'Xuất Excel', tip: 'Chênh lệch theo mã · từng tác động · hàng đang chặn — để kiểm kê đối chiếu SAP', onClick: () => void exportExcel(), busy: !!busy, disabled: !!busy, mobileHidden: true })
  const offRows = rows.filter(r => Number(r.variance) !== 0)
  const views: { key: 'mat' | 'blocks' | 'events'; label: string }[] = [
    { key: 'mat', label: 'Theo mã' }, { key: 'blocks', label: `Đang chặn${blocks.length ? ` (${blocks.length})` : ''}` }, { key: 'events', label: 'Từng tác động' },
  ]
  const loadErr = sumQ.error ?? blkQ.error ?? evQ.error

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap">
            {tabBar}
            {kitchens.length > 1 && (
              <div className="w-40 sm:w-48 min-w-0 shrink">
                <SingleSelect value={wh} onChange={v => { setF({ warehouseId: v }); setEvMat(''); setEvPage(1) }} triggerClassName="h-9 sm:h-7" placeholder="Kho chế biến" options={kitchens.map(k => ({ value: k.id, label: k.name }))} />
              </div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <FilterSheetButton defs={defs} className="sm:hidden" />
              <ActionCluster mobileInline className="sm:ml-auto" items={actions} />
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={defs} /></div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium" role="tablist" aria-label="Khung xem chênh lệch">
              {views.map((v, i) => (
                <button key={v.key} type="button" role="tab" aria-selected={view === v.key} data-view={v.key} onClick={() => setF({ varView: v.key })}
                  className={`h-8 sm:h-7 px-3 whitespace-nowrap ${i ? 'border-l border-slate-200 ' : ''}${view === v.key ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{v.label}</button>
              ))}
            </div>
            <span className="text-[11px] text-slate-500">Kỳ {formatDate(from)} → {formatDate(to)}{kitchens.length === 1 && whName ? ` · ${whName}` : ''}</span>
          </div>
          <p className="hidden sm:block text-[11px] text-slate-500">
            SAP nhận Cấp / Huỷ cấp qua Dữ liệu thô. <b>Chênh lệch so SAP</b> = điều chỉnh khác (tay · kiểm kê · nạp Excel) − xoá hàng chặn trong kỳ. <b>Đang chặn</b> = NVL hoàn về khi huỷ cấp nhưng không tái dùng được, vẫn trong tồn sổ, chờ điều chỉnh.
          </p>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{err}</div>}
          {loadErr && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{apiMsg(loadErr)}</div>}
        </div>
        <SummaryBand mobilePairs tiles={[
          { label: 'Mã có chênh lệch', value: offRows.length.toLocaleString('vi-VN'), danger: offRows.length > 0, tip: 'Mã có tác động làm tồn app khác sổ SAP trong kỳ' },
          { label: 'Lô đang chặn', value: blocks.length.toLocaleString('vi-VN'), accent: blocks.length > 0, tip: 'Lô có phần NVL chặn chưa điều chỉnh (mọi thời điểm)' },
          { label: 'Mã đang chặn', value: new Set(blocks.map(b => b.material_id)).size.toLocaleString('vi-VN') },
          { label: 'Lần điều chỉnh khác', value: rows.reduce((s, r) => s + Number(r.adjust_count), 0).toLocaleString('vi-VN'), tip: 'Điều chỉnh tay ở Tồn kho · kiểm kê · nạp Excel trong kỳ' },
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {!kitchens.length && <p className="p-3 text-xs text-amber-700">Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.</p>}

          {!!kitchens.length && view === 'mat' && (
            <ResizableTable storageKey="production_variance_mat_v3" cols={MAT_COLS}>
              <TableBody data-testid="variance-mat">
                {sumQ.isLoading && <TableEmptyRow colSpan={MAT_COLS.length}>Đang tải…</TableEmptyRow>}
                {!sumQ.isLoading && !sumQ.isError && !rows.length && <TableEmptyRow colSpan={MAT_COLS.length}>Không có chặn / điều chỉnh nào trong kỳ — tồn app khớp sổ SAP (phần cấp / huỷ cấp).</TableEmptyRow>}
                {rows.map(r => (
                  <TableRow key={r.material_id} className="cursor-pointer hover:bg-sky-50" onClick={() => openEvents(r.material_id)} title="Xem từng tác động của mã này" data-mat={r.material_code}>
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white truncate`} title={r.material_name ?? ''}><span className="font-mono font-semibold">{r.material_code}</span> {r.material_name ?? ''}</TableCell>
                    <TableCell className={`${TD} font-mono text-slate-500`}>{matUnitCode(r)}</TableCell>
                    <TableCell className={NUM} data-variance={Number(r.variance)}><Signed n={Number(r.variance)} m={r} /></TableCell>
                    <TableCell className={NUM}><Signed n={-Number(r.written_off)} m={r} /></TableCell>
                    <TableCell className={NUM}><Signed n={Number(r.adjusted)} m={r} /></TableCell>
                    <TableCell className={NUM}>{Number(r.blocked_open) > 0 ? <span className="text-amber-700">{qtyNum(Number(r.blocked_open), r)}</span> : dash}</TableCell>
                    <TableCell className={NUM}>{Number(r.blocked) > 0 ? <span className="font-normal">{qtyNum(Number(r.blocked), r)}</span> : dash}</TableCell>
                    <TableCell className={NUM}>{Number(r.released) > 0 ? <span className="font-normal">{qtyNum(Number(r.released), r)}</span> : dash}</TableCell>
                    <TableCell className={NUM}><span className="font-normal">{qtyNum(Number(r.book), r)}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ResizableTable>
          )}

          {!!kitchens.length && view === 'blocks' && (
            <ResizableTable storageKey="production_variance_blk_v1" cols={BLK_COLS}>
              <TableBody data-testid="variance-blocks">
                {blkQ.isLoading && <TableEmptyRow colSpan={BLK_COLS.length}>Đang tải…</TableEmptyRow>}
                {!blkQ.isLoading && !blkQ.isError && !blocks.length && <TableEmptyRow colSpan={BLK_COLS.length}>Không có lô nào đang chặn.</TableEmptyRow>}
                {blocks.map(b => (
                  <TableRow key={b.id} data-block={b.pallet_code}>
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono truncate`} title={b.pallet_code}>{b.pallet_code}</TableCell>
                    <TableCell className={`${TD} truncate`} title={b.material_name ?? ''}><span className="font-mono font-semibold">{b.material_code}</span> {b.material_name ?? ''}</TableCell>
                    <TableCell className={`${TD} font-mono text-slate-500`}>{matUnitCode(b)}</TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{b.production_date ? formatDate(b.production_date) : '—'}{b.batch_lot ? ` · ${b.batch_lot}` : ''}</TableCell>
                    <TableCell className={NUM}><span className="font-normal">{qtyNum(Number(b.qty), b)}</span></TableCell>
                    <TableCell className={NUM}><span className="text-amber-700">{qtyNum(Number(b.open), b)}</span></TableCell>
                    <TableCell className={`${TD} truncate`} title={b.reason}>{b.reason}</TableCell>
                    <TableCell className={`${TD} truncate`} title={b.batch_code ?? ''}>{SRC_VI[b.source]}{b.batch_code ? <span className="font-mono"> · {b.batch_code}</span> : ''}</TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{formatDateTime(b.created_at)}</TableCell>
                    <TableCell className={`${TD} truncate`}>{b.created_by_name ?? '—'}</TableCell>
                    <TableCell className={`${TD} text-right`}>
                      {canAdjust && (
                        <span className="inline-flex gap-1">
                          <button type="button" className="touch-target rounded border border-red-200 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50" onClick={() => setAct({ block: b, kind: 'WRITE_OFF' })} aria-label={`Xoá hàng chặn ${b.pallet_code}`}>Xoá khỏi tồn</button>
                          <button type="button" className="touch-target rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50" onClick={() => setAct({ block: b, kind: 'RELEASE' })} aria-label={`Bỏ chặn ${b.pallet_code}`}>Bỏ chặn</button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ResizableTable>
          )}

          {!!kitchens.length && view === 'events' && (
            <>
              {evMat && (
                <div className="px-3 py-1.5">
                  <button type="button" onClick={() => { setEvMat(''); setEvPage(1) }} className="inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] text-sky-800" aria-label="Bỏ lọc mã">
                    Mã: <span className="font-mono font-semibold">{evMatCode || evMat}</span><X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <ResizableTable storageKey="production_variance_ev_v1" cols={EV_COLS}>
                <TableBody data-testid="variance-events">
                  {evQ.isLoading && <TableEmptyRow colSpan={EV_COLS.length}>Đang tải…</TableEmptyRow>}
                  {!evQ.isLoading && !evQ.isError && !events.length && <TableEmptyRow colSpan={EV_COLS.length}>Không có tác động nào trong kỳ.</TableEmptyRow>}
                  {events.map((e, i) => (
                    <TableRow key={`${e.at}-${e.kind}-${e.pallet_code}-${i}`} data-kind={e.kind}>
                      <TableCell className={`${TD} sticky left-0 z-10 bg-white tabular-nums`}>{formatDateTime(e.at)}</TableCell>
                      <TableCell className={TD}><StatusBadge tone={KIND_TONE[e.kind]}>{KIND_VI[e.kind]}</StatusBadge></TableCell>
                      <TableCell className={`${TD} truncate`} title={e.material_name ?? ''}><span className="font-mono font-semibold">{e.material_code}</span> {e.material_name ?? ''}</TableCell>
                      <TableCell className={`${TD} font-mono text-slate-500`}>{matUnitCode(e)}</TableCell>
                      <TableCell className={`${TD} font-mono truncate`} title={e.pallet_code}>{e.pallet_code}</TableCell>
                      <TableCell className={NUM}><span className="font-normal">{qtyNum(Math.abs(Number(e.qty)), e)}</span></TableCell>
                      <TableCell className={NUM}><Signed n={Number(e.effect)} m={e} /></TableCell>
                      <TableCell className={`${TD} truncate`} title={e.note ?? ''}>{e.note ?? '—'}</TableCell>
                      <TableCell className={`${TD} truncate`}>{e.actor ?? '—'}</TableCell>
                      <TableCell className={`${TD} truncate font-mono`}>{e.ref ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ResizableTable>
              <PagerNav page={evPage} totalPages={evPages} onPage={setEvPage} />
            </>
          )}
        </div>
      </div>
      <BlockActSheet block={act?.block ?? null} kind={act?.kind ?? 'WRITE_OFF'} onClose={() => setAct(null)} />
    </div>
  )
}
