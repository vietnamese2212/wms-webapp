// TAB "DỮ LIỆU THÔ" của Báo cáo NVL (MES 18/11 g — user: "về tiêu hao NVL phải làm dạng raw data, có đầy đủ thông tin hết cho tôi — để còn
// làm việc với ERP SAP").
//   • Mỗi dòng MỘT phát sinh như chứng từ kho của SAP: Cấp (+SL, ngày cấp) · Huỷ cấp (−SL, ngày huỷ — để hạch toán đảo). Lọc theo NGÀY CỦA
//     PHÁT SINH (giờ VN), chu kỳ, loại phát sinh, cờ (sai thứ tự · hết hạn QA duyệt · đã huỷ), tìm theo mã NVL / mã lô BTP / tem / lô NCC.
//   • Đủ cột: Plant / SLoc SAP · NVL + mô tả · SL có dấu + ĐVT · lô NCC · NSX · HSD · mã + tên NCC · nhà SX · tem · ngày nhập kho · chu kỳ ·
//     mẻ · mã lô BTP · ca · ngày SX · BTP · bồn · máy · tình trạng / QA mẻ · người làm + mã NV · thứ tự luân chuyển · QA duyệt hết hạn ·
//     lần cấp gốc · huỷ (lúc · người · lý do) · quy cách · nhà máy · mã dòng (đối chiếu, chống nạp trùng).
//   • Xuất Excel (quyền export) = file THÔ: dòng 1 là tên cột; 3 sheet Tiêu hao NVL · Định mức – thực cấp (mẻ × NVL) · Nạp bồn (BTP) + sheet
//     Thông tin (bộ lọc, giờ xuất). Phân trang server — sổ cấp lớn lên theo năm.
// Khuôn cột ở utils/consumptionRaw.ts (cùng khuôn với sheet thô của báo cáo chu kỳ); số tự cập nhật qua sổ cấp (realtime).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { FileDown } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useProductionWarehouses, useConsumptionRaw, fetchRawAll, defaultKitchen, type RawFilter } from '@/api/productionHooks'
import { RAW_EVENT_COLS, RAW_REQ_COLS, RAW_FILL_COLS, rawAoa, rawColWidths, vnStamp, type RawEvent } from '@/utils/consumptionRaw'
import { unitCode } from '@/utils/unitCode'
import { formatDate, formatTimestampTime } from '@/utils/formatters'
import { saveWorkbook } from '@/utils/saveExcel'
import { sanitizeAoa } from '@/utils/excelSafe'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const addDays = (ymd: string, d: number) => { const t = new Date(`${ymd}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }
const COLS: RtColDef[] = RAW_EVENT_COLS.map(c => ({ id: c.key, label: c.label, w: c.w, ...(c.num ? { align: 'right' as const } : {}) }))
const EVENT_OPTS = [{ value: 'ISSUE', label: 'Cấp' }, { value: 'REVERSAL', label: 'Huỷ cấp' }]
const FLAG_OPTS = [{ value: 'rotation', label: 'Sai thứ tự' }, { value: 'expiry', label: 'Hết hạn — QA duyệt' }, { value: 'reversed', label: 'Lần cấp đã huỷ' }]

export function ConsumptionRaw({ tabBar }: { tabBar: ReactNode }) {
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canExport = can(perms, 'production', 'export')
  const seeRecipe = can(perms, 'production', 'view_recipe') || can(perms, 'production', 'manage_recipe')
  const f = useWmsFilterStore(s => s.productionReport)
  const setF = useWmsFilterStore(s => s.setProductionReport)
  const { data: { kitchens } } = useProductionWarehouses()
  const wh = kitchens.some(k => k.id === f.warehouseId) ? f.warehouseId : defaultKitchen(kitchens, f.warehouseId || useGlobalScopeStore.getState().warehouseId)
  // "Hôm nay" là hàm: khoảng ngày trống ⇒ 7 ngày gần nhất tính lúc mở màn
  const today = vnToday()
  const from = f.rawFrom || addDays(today, -6), to = f.rawTo || today
  const filter: RawFilter = {
    warehouse_id: wh, date_from: from, date_to: to, cycle: f.rawCycle.trim() || undefined, search: f.rawSearch.trim() || undefined,
    event: f.rawEvent || undefined, flag: f.rawFlag || undefined,
  }
  const q = useConsumptionRaw({ ...filter, page: f.rawPage, page_size: f.rawPageSize }, !!wh)
  const rows = q.data?.rows ?? []
  const total = q.data?.total ?? 0
  const sm = q.data?.summary
  const totalPages = Math.max(1, Math.ceil(total / f.rawPageSize))
  useEffect(() => { if (!q.isLoading && total > 0 && f.rawPage > totalPages) setF({ rawPage: totalPages }) }, [q.isLoading, total, f.rawPage, totalPages, setF])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const whName = kitchens.find(k => k.id === wh)?.name ?? ''

  const defs: FilterDef[] = [
    { key: 'date', label: 'Ngày phát sinh', type: 'daterange', from, to, onChange: (a, b) => setF({ rawFrom: a, rawTo: b, rawPage: 1 }), pinned: true },
    { key: 'cycle', label: 'Chu kỳ', type: 'text', value: f.rawCycle, onChange: v => setF({ rawCycle: v, rawPage: 1 }), placeholder: 'vd 26' },
    { key: 'event', label: 'Phát sinh', type: 'single', options: EVENT_OPTS, value: f.rawEvent, allLabel: 'Cấp + Huỷ cấp', onChange: v => setF({ rawEvent: v as '' | 'ISSUE' | 'REVERSAL', rawPage: 1 }) },
    { key: 'flag', label: 'Cờ', type: 'single', options: FLAG_OPTS, value: f.rawFlag, onChange: v => setF({ rawFlag: v as '' | 'rotation' | 'expiry' | 'reversed', rawPage: 1 }) },
  ]

  const byUnit = useMemo(() => sm?.by_unit ?? [], [sm])
  const unitsText = (k: 'issued' | 'reversed' | 'net') => byUnit.filter(u => Number(u[k])).map(u => `${nf(Number(u[k]))} ${unitCode(u.unit)}`).join(' + ') || '0'

  async function exportExcel() {
    setErr(''); setBusy('Đang tải phát sinh…')
    try {
      const events = await fetchRawAll(filter, 'events', n => setBusy(`Đang tải ${n.toLocaleString('vi-VN')} phát sinh…`))
      // 27/11: sheet Định mức – thực cấp chỉ cho người có quyền Xem công thức (server cũng bỏ số định mức với người khác)
      if (seeRecipe) setBusy('Đang tải định mức…')
      const req = seeRecipe ? await fetchRawAll(filter, 'req') : []
      setBusy('Đang tải nạp bồn…')
      const fills = await fetchRawAll(filter, 'fill')
      const wb = XLSX.utils.book_new()
      const add = (aoa: (string | number)[][], widths: { wch: number }[], name: string) => {
        const ws = XLSX.utils.aoa_to_sheet(sanitizeAoa(aoa))
        ws['!cols'] = widths
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 0), c: Math.max(aoa[0].length - 1, 0) } }) }
        XLSX.utils.book_append_sheet(wb, ws, name)
      }
      add(rawAoa(RAW_EVENT_COLS, events), rawColWidths(RAW_EVENT_COLS), 'Tiêu hao NVL')
      if (seeRecipe) add(rawAoa(RAW_REQ_COLS, req), rawColWidths(RAW_REQ_COLS), 'Định mức – thực cấp')
      add(rawAoa(RAW_FILL_COLS, fills), rawColWidths(RAW_FILL_COLS), 'Nạp bồn (BTP)')
      const info: (string | number)[][] = [
        ['Mục', 'Giá trị'],
        ['Dữ liệu', 'Tiêu hao NVL — dữ liệu thô (mỗi dòng một phát sinh)'],
        ['Kho chế biến', whName],
        ['Ngày phát sinh', `${from} → ${to} (giờ Việt Nam)`],
        ['Chu kỳ', filter.cycle ?? 'mọi chu kỳ'],
        ['Phát sinh', filter.event ? EVENT_OPTS.find(o => o.value === filter.event)?.label ?? '' : 'Cấp + Huỷ cấp'],
        ['Cờ', filter.flag ? FLAG_OPTS.find(o => o.value === filter.flag)?.label ?? '' : '—'],
        ['Tìm', filter.search ?? '—'],
        ['Số dòng phát sinh', events.length], ...(seeRecipe ? [['Số dòng định mức (mẻ × NVL)', req.length]] : []), ['Số lần nạp bồn', fills.length],
        ['Xuất lúc', vnStamp(new Date().toISOString())],
        [],
        ['Ghi chú', 'Cấp = +SL vào ngày cấp · Huỷ cấp = −SL vào ngày huỷ (hạch toán đảo). Σ SL có dấu = lượng tiêu hao thực.'],
        ['', 'Số lượng theo ĐƠN VỊ GỐC của mã (cột ĐVT). Plant / SLoc lấy ở Cài đặt WMS → Kho (kho chế biến, không khai thì nhà máy cha).'],
        ['', 'Sheet "Định mức – thực cấp": mẻ có ngày SX trong khoảng hoặc có phát sinh cấp / huỷ trong khoảng; thực cấp = các lần cấp còn hiệu lực.'],
        ['', 'Mã dòng cấp là duy nhất — dùng để đối chiếu, tránh nạp trùng sang SAP.'],
      ]
      add(info, [{ wch: 28 }, { wch: 110 }], 'Thông tin')
      await saveWorkbook(wb, `tieu_hao_nvl_tho_${from}_${to}${filter.cycle ? `_ck${filter.cycle}` : ''}.xlsx`)
    } catch (e) { setErr(apiMsg(e)) } finally { setBusy('') }
  }

  const actions: ActionItem[] = []
  if (canExport && wh) actions.push({ key: 'xlsx', icon: FileDown, label: busy || 'Xuất Excel', tip: 'File thô cho SAP: Tiêu hao NVL (mỗi dòng một phát sinh) · Định mức – thực cấp · Nạp bồn (BTP) — theo bộ lọc đang áp', onClick: () => void exportExcel(), busy: !!busy, disabled: !!busy, primary: true, variant: 'default', mobileHidden: true })

  const cell = (r: RawEvent, k: string, v: string | number): ReactNode => {
    if (v === '' || v == null) return <span className="text-slate-300">—</span>
    if (k === 'qty') return <span className={`font-semibold tabular-nums ${Number(v) < 0 ? 'text-red-600' : ''}`}>{nf(Number(v))}</span>
    if (k === 'mat' || k === 'batch' || k === 'pallet' || k === 'line_id') return <span className="font-mono">{v}</span>
    if (k === 'rot' || k === 'exp') return <span className="font-semibold text-amber-700">{v}</span>
    if (k === 'rev_at') return <span className="text-red-600">{v}</span>
    return v
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap">
            {tabBar}
            {kitchens.length > 1 && (
              <div className="w-40 sm:w-48 min-w-0 shrink">
                <SingleSelect value={wh} onChange={v => setF({ warehouseId: v, rawPage: 1 })} triggerClassName="h-9 sm:h-7" placeholder="Kho chế biến" options={kitchens.map(k => ({ value: k.id, label: k.name }))} />
              </div>
            )}
            <SearchInput value={f.rawSearch} onChange={v => setF({ rawSearch: v, rawPage: 1 })} placeholder="Tìm mã NVL, mã lô BTP, tem, lô NCC…" className="flex-1 min-w-[160px]" />
            <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
              <FilterSheetButton defs={defs} className="sm:hidden" />
              <ActionCluster mobileInline className="sm:ml-auto" items={actions} />
            </div>
          </div>
          <div className="hidden sm:flex"><FilterBar defs={defs} /></div>
          <p className="text-[11px] text-slate-500" data-testid="raw-head">
            <span className="hidden sm:inline">Mỗi dòng một phát sinh: <b>Cấp</b> (+SL, ngày cấp) · <b className="text-red-600">Huỷ cấp</b> (−SL, ngày huỷ). </span>Ngày {formatDate(from)} → {formatDate(to)}{kitchens.length === 1 && whName ? ` · ${whName}` : ''}
            {q.dataUpdatedAt ? <span className="ml-2 text-green-700">● Trực tiếp · {formatTimestampTime(new Date(q.dataUpdatedAt).toISOString())}</span> : null}
          </p>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{err}</div>}
          {q.isError && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{apiMsg(q.error)}</div>}
        </div>
        <SummaryBand mobilePairs tiles={[
          { label: 'Phát sinh', value: (sm?.events ?? 0).toLocaleString('vi-VN') },
          { label: 'Cấp', value: (sm?.issues ?? 0).toLocaleString('vi-VN') },
          { label: 'Huỷ cấp', value: (sm?.reversals ?? 0).toLocaleString('vi-VN'), danger: (sm?.reversals ?? 0) > 0 },
          // tiêu hao thực MỖI ĐVT MỘT Ô (không cộng KG với L / BAG)
          ...(byUnit.length ? byUnit.slice(0, 4) : [{ unit: '', issued: 0, reversed: 0, net: 0 }]).map(u => ({
            label: `Tiêu hao${u.unit ? ` ${unitCode(u.unit)}` : ''}`, value: nf(Number(u.net)),
            tip: `Tiêu hao thực = Σ SL có dấu: cấp ${nf(Number(u.issued))} − huỷ ${nf(Number(u.reversed))}${u.unit ? ` ${unitCode(u.unit)}` : ''}`,
          })),
          { label: 'Mẻ', value: (sm?.batches ?? 0).toLocaleString('vi-VN') },
          { label: 'Mã NVL', value: (sm?.materials ?? 0).toLocaleString('vi-VN') },
          { label: 'Sai thứ tự', value: (sm?.rotation ?? 0).toLocaleString('vi-VN'), danger: (sm?.rotation ?? 0) > 0, tip: 'Lần cấp không theo thứ tự luân chuyển của kho (FEFO / FIFO / LIFO) — có lý do vượt' },
          { label: 'NVL hết hạn', value: (sm?.expiry ?? 0).toLocaleString('vi-VN'), tip: 'Lần cấp NVL đã hết hạn — có QA duyệt cho dùng' },
          ...(totalPages > 1 ? [{ label: 'Trang', value: `${f.rawPage}/${totalPages}` }] : []),
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {!kitchens.length && <p className="p-3 text-xs text-amber-700">Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.</p>}
          {!!kitchens.length && <ResizableTable storageKey={`production_raw_cols_v1_${COLS.length}`} cols={COLS}>
            <TableBody data-testid="raw-table">
              {q.isLoading && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
              {!q.isLoading && !q.isError && !rows.length && <TableEmptyRow colSpan={COLS.length}>Không có phát sinh nào trong khoảng ngày / bộ lọc này.</TableEmptyRow>}
              {rows.map(r => (
                <TableRow key={`${r.line_id}-${r.event}`} data-event={r.event}
                  className={r.event === 'REVERSAL' ? 'text-red-700' : r.reversed_at ? 'text-slate-400' : ''}
                  title={r.event === 'ISSUE' && r.reversed_at ? `Lần cấp này đã bị huỷ lúc ${vnStamp(r.reversed_at)}` : undefined}>
                  {RAW_EVENT_COLS.map((c, i) => (
                    <TableCell key={c.key} className={`${TD} ${c.num ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-10 bg-white font-semibold' : ''} truncate`}>
                      {cell(r, c.key, c.value(r))}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </ResizableTable>}
          <PagerNav page={f.rawPage} totalPages={totalPages} onPage={p => setF({ rawPage: p })} />
        </div>
        <ListFooter page={f.rawPage} pageSize={f.rawPageSize} total={total} unit="phát sinh" onPageSize={n => setF({ rawPageSize: n, rawPage: 1 })}
          right={byUnit.length ? `Tiêu hao thực ${unitsText('net')}` : undefined} />
      </div>
    </div>
  )
}
