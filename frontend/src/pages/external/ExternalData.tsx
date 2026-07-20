// Dữ liệu bên ngoài — dữ liệu raw ERP/SAP đổ vào WMS.
// Tab "DO SAP" = bảng erp_outbound_orders (CRUD tay + multi-select + filter + search + phân trang server-side).
// Thiết kế mảng tabs để sau này thêm nguồn dữ liệu khác (hiện chỉ 1 tab active).
import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { Database, Plus, Pencil, Trash2, X, ChevronLeft, ChevronRight, AlignJustify, Rows3, Download } from 'lucide-react'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FormSheet } from '@/components/shared/FormSheet'
import { EmptyState } from '@/components/shared/EmptyState'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  useDoSapOrders, useDoSapFacets, useCreateDoSap, useUpdateDoSap, useDeleteDoSap, useBulkDeleteDoSap,
  type DoSapRow,
} from '@/api/hooks'
import { apiClient } from '@/api/client'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate } from '@/utils/formatters'

// ─── Tabs (chỉ 1 tab hiện tại, cấu trúc mở rộng về sau) ───────────────────────
type TabKey = 'dosap'
const TABS: { key: TabKey; label: string }[] = [{ key: 'dosap', label: 'DO SAP' }]

// ─── Cột bảng ─────────────────────────────────────────────────────────────────
const COLS: { id: string; label: string; align?: 'right' }[] = [
  { id: 'sel',        label: '' },
  { id: 'od_number',  label: 'DO' },
  { id: 'od_item',    label: 'Item' },
  { id: 'material',   label: 'Mã hàng' },
  { id: 'mat_name',   label: 'Tên hàng' },
  { id: 'qty_sales',  label: 'SL bán', align: 'right' },
  { id: 'qty_base',   label: 'SL gốc', align: 'right' },
  { id: 'shipto',     label: 'Ship-to' },
  { id: 'plant',      label: 'Plant' },
  { id: 'storage',    label: 'Kho' },
  { id: 'batch',      label: 'Batch' },
  { id: 'pct',        label: '%Date', align: 'right' },
  { id: 'status',     label: 'Tình trạng' },
  { id: 'unit',       label: 'Lệch ĐV' },
  { id: 'source',     label: 'Nguồn' },
  { id: 'updated',    label: 'Cập nhật' },
  { id: 'action',     label: '' },
]
const COL_DEFAULTS = [40, 110, 55, 110, 160, 90, 90, 135, 70, 90, 100, 70, 90, 65, 80, 110, 70]

const nf = new Intl.NumberFormat('vi-VN')
function num(v: number | null | undefined) {
  return v == null ? null : nf.format(v)
}

function SourceBadge({ source }: { source: string | null }) {
  const v = (source ?? '').toUpperCase()
  const cls = v === 'SAP' ? 'bg-sky-100 text-sky-700'
    : v === 'MANUAL' ? 'bg-amber-100 text-amber-700'
    : 'bg-slate-100 text-slate-600'
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`}>{source ?? '—'}</span>
}

function StatusBadge({ used, syncStatus }: { used: boolean | undefined; syncStatus: string | null | undefined }) {
  if (syncStatus === 'OBSOLETE')
    return <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">SAP đã bỏ</span>
  if (used)
    return <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-green-100 text-green-700">Đã dùng</span>
  return <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-500">Chưa dùng</span>
}

function apiError(err: unknown, fallback: string) {
  return (err as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? fallback
}

const PAGE_SIZES = [50, 100, 200]

export default function ExternalData() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreate = can(perms, 'external_do_sap', 'create')
  const canEdit   = can(perms, 'external_do_sap', 'edit')
  const canDelete = can(perms, 'external_do_sap', 'delete')

  const [tab] = useState<TabKey>('dosap')

  // Filter/search/page state — nhớ theo user qua wmsFilterStore (scopedPersist)
  const { doSap: f, setDoSap } = useWmsFilterStore()
  const { search, dateFrom, dateTo, source: fSource, plant: fPlant, shipto: fShipto, material: fMaterial, od: fOd, page, pageSize } = f

  const [dense, setDense]           = useState(() => localStorage.getItem('dosap_density') !== 'comfortable')
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [formRow, setFormRow]       = useState<DoSapRow | 'new' | null>(null)
  const [deleteRow, setDeleteRow]   = useState<DoSapRow | null>(null)
  const [bulkOpen, setBulkOpen]     = useState(false)
  const [exporting, setExporting]   = useState(false)
  const [exportErr, setExportErr]   = useState('')

  const { widths: colW, startResize, totalWidth } = useColumnResize('dosap_col_widths_v2', COL_DEFAULTS)
  const { data: facets } = useDoSapFacets()

  const hasDate = !!(dateFrom || dateTo)   // BẮT BUỘC chọn ngày mới hiện dữ liệu (không tự kéo cả bảng)

  const params = useMemo(() => ({
    q:             search.trim() || undefined,
    date_from:     dateFrom || undefined,
    date_to:       dateTo || undefined,
    source:        fSource || undefined,
    plant:         fPlant || undefined,
    ship_to_code:  fShipto || undefined,
    material_code: fMaterial.trim() || undefined,
    od_number:     fOd.trim() || undefined,
    page,
    page_size:     pageSize,
  }), [search, dateFrom, dateTo, fSource, fPlant, fShipto, fMaterial, fOd, page, pageSize])

  const { data, isLoading, isError, error } = useDoSapOrders(params, hasDate)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Đổi filter/search/pageSize → về trang 1 (filterKey KHÔNG gồm page để tránh vòng lặp)
  const filterKey = JSON.stringify({ search, dateFrom, dateTo, fSource, fPlant, fShipto, fMaterial, fOd, pageSize })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDoSap({ page: 1 }) }, [filterKey])

  const bulkDelete   = useBulkDeleteDoSap()
  const deleteOne    = useDeleteDoSap()

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày nạp', type: 'daterange', from: dateFrom, to: dateTo,
      onChange: (from, to) => setDoSap({ dateFrom: from, dateTo: to }) },
    { key: 'source', label: 'Nguồn', type: 'single', allLabel: 'Tất cả nguồn', value: fSource,
      options: (facets?.sources ?? []).map(s => ({ value: s, label: s })), onChange: v => setDoSap({ source: v }) },
    { key: 'plant', label: 'Plant', type: 'single', allLabel: 'Tất cả plant', value: fPlant,
      options: (facets?.plants ?? []).map(p => ({ value: p, label: p })), onChange: v => setDoSap({ plant: v }) },
    { key: 'shipto', label: 'Ship-to', type: 'single', allLabel: 'Tất cả ship-to', value: fShipto,
      options: (facets?.shiptos ?? []).map(s => ({ value: s.code, label: s.name ? `${s.code} — ${s.name}` : s.code })), onChange: v => setDoSap({ shipto: v }) },
    { key: 'material', label: 'Mã hàng', type: 'text', value: fMaterial, placeholder: 'Nhập mã hàng…', onChange: v => setDoSap({ material: v }) },
    { key: 'od', label: 'DO', type: 'text', value: fOd, placeholder: 'Nhập số DO…', onChange: v => setDoSap({ od: v }) },
  ]

  // Selection theo trang hiện tại
  const pageIds = items.map(i => i.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id))
  function toggleAllPage() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allPageSelected) pageIds.forEach(id => next.delete(id))
      else pageIds.forEach(id => next.add(id))
      return next
    })
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function doBulkDelete() {
    bulkDelete.mutate([...selected], {
      onSuccess: () => { setSelected(new Set()); setBulkOpen(false) },
    })
  }
  function doDeleteOne() {
    if (!deleteRow) return
    const id = deleteRow.id
    deleteOne.mutate(id, {
      onSuccess: () => {
        setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
        setDeleteRow(null)
      },
    })
  }

  async function doExport() {
    setExportErr('')
    setExporting(true)
    try {
      const EXPORT_PAGE = 200
      const CAP = 20000
      const all: DoSapRow[] = []
      let p = 1
      let hitCap = false
      for (;;) {
        const qs = new URLSearchParams()
        const q = { ...params, page: p, page_size: EXPORT_PAGE }
        for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== '__all__') qs.set(k, String(v))
        const r = await apiClient.get(`/external/do-sap?${qs.toString()}`)
        const batch = (r.data?.data?.items ?? []) as DoSapRow[]
        all.push(...batch)
        if (batch.length < EXPORT_PAGE) break
        if (all.length >= CAP) { hitCap = true; break }
        p += 1
      }
      const rows = all.slice(0, CAP).map(x => ({
        'DO': x.od_number,
        'Item': x.od_item,
        'Mã hàng': x.material_code ?? '',
        'Tên hàng': x.material_name ?? '',
        'SL bán': x.qty_sales ?? '',
        'ĐV bán': x.sales_unit ?? '',
        'SL gốc': x.qty_base ?? '',
        'ĐV gốc': x.base_unit ?? '',
        'Ship-to': x.ship_to_code ?? '',
        'Tên ship-to': x.ship_to_name ?? '',
        'Plant': x.plant ?? '',
        'Kho': x.storage_location ?? '',
        'Batch': x.batch ?? '',
        '%Date': x.pct_date_req ?? '',
        'Nguồn': x.source ?? '',
        'Tình trạng': x.sync_status === 'OBSOLETE' ? 'SAP đã bỏ' : x.used ? 'Đã dùng' : 'Chưa dùng',
        'Cập nhật': x.updated_at ? formatTimestampDate(x.updated_at, true) : '',
      }))
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'DO SAP')
      XLSX.writeFile(wb, 'do-sap.xlsx')
      if (hitCap) setExportErr(`Đã đạt giới hạn ${CAP.toLocaleString('vi-VN')} dòng — file chỉ chứa phần đầu. Thu hẹp khoảng ngày/bộ lọc để xuất đủ.`)
    } catch (err) {
      setExportErr(apiError(err, 'Không xuất được Excel. Vui lòng thử lại.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">

      {/* Tab bar */}
      <div className="border-b bg-white px-3 pt-2 shrink-0 sm:rounded-t-xl">
        <div className="flex items-center gap-1">
          {TABS.map(t => (
            <button key={t.key} type="button"
              className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors ${
                tab === t.key ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar (hàng 1) */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
            <Database className="h-4 w-4 text-slate-500" /> Dữ liệu bên ngoài
          </span>
          <SearchInput value={search} onChange={v => setDoSap({ search: v })}
            placeholder="Tìm DO, mã hàng, ship-to…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <button type="button" onClick={() => { localStorage.setItem('dosap_density', dense ? 'comfortable' : 'compact'); setDense(d => !d) }}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {hasDate && (
            <Button variant="outline" size="sm" className="h-9 sm:h-7 shrink-0" onClick={doExport} disabled={exporting}>
              <Download className="h-3.5 w-3.5 mr-1" /> {exporting ? 'Đang xuất…' : 'Xuất Excel'}
            </Button>
          )}
          {canCreate && (
            <Button size="sm" className="h-9 sm:h-7 bg-blue-600 hover:bg-blue-700 shrink-0" onClick={() => setFormRow('new')}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Thêm dòng
            </Button>
          )}
        </div>
        <FilterBar defs={filterDefs} />
        {exportErr && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600">{exportErr}</div>}
      </div>

      <SummaryBand tiles={[
        { label: 'Tổng dòng', value: total.toLocaleString('vi-VN') },
        { label: 'Đang chọn', value: selected.size, accent: selected.size > 0 },
        { label: 'Trang', value: `${page}/${totalPages}` },
      ]} />

      {/* Thanh multi-select */}
      {selected.size > 0 && (
        <div className="shrink-0 flex items-center gap-2 bg-sky-50 border-b border-sky-200 px-3 py-1.5 text-xs">
          <span className="font-semibold text-sky-800">Đã chọn {selected.size}</span>
          {canDelete && (
            <button type="button" onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Xóa {selected.size} dòng
            </button>
          )}
          <button type="button" onClick={() => setSelected(new Set())}
            className="ml-auto inline-flex items-center gap-1 text-slate-500 hover:text-slate-700">
            <X className="h-3.5 w-3.5" /> Bỏ chọn
          </button>
        </div>
      )}

      {/* Bảng */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!hasDate ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
            <Database className="h-10 w-10 opacity-30" />
            <p className="text-sm font-medium text-slate-500">Chọn khoảng <b>Ngày nạp</b> để xem dữ liệu</p>
            <p className="text-xs">Dữ liệu DO SAP chỉ hiển thị sau khi chọn ngày (tránh tải toàn bộ bảng).</p>
          </div>
        ) : isLoading ? (
          <TableSkeleton cols={12} rows={12} />
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">{apiError(error, 'Lỗi tải dữ liệu DO SAP. Vui lòng thử lại.')}</div>
        ) : items.length === 0 ? (
          <EmptyState title="Chưa có dữ liệu DO SAP" />
        ) : (
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {COLS.map((c, i) => (
                  <TableHead key={c.id} className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.id === 'sel' ? (
                      <input type="checkbox" className="h-3.5 w-3.5 accent-sky-600 cursor-pointer align-middle"
                        checked={allPageSelected} onChange={toggleAllPage} title="Chọn tất cả trang này" />
                    ) : c.label}
                    <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                      className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(r => {
                const isSel = selected.has(r.id)
                const cellPad = dense ? 'py-1' : 'py-2.5'
                return (
                  <TableRow key={r.id} className={isSel ? 'bg-sky-50' : ''}>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap sticky left-0 z-10 ${isSel ? 'bg-sky-50' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="h-3.5 w-3.5 accent-sky-600 cursor-pointer align-middle"
                        checked={isSel} onChange={() => toggleOne(r.id)} />
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono font-semibold whitespace-nowrap`}>{r.od_number || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.od_item || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono whitespace-nowrap`}>{r.material_code || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap truncate`} title={r.material_name ?? undefined}>{r.material_name || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] tabular-nums text-right whitespace-nowrap`}>
                      {r.qty_sales != null ? <>{num(r.qty_sales)}{r.sales_unit && <span className="text-slate-400"> {r.sales_unit}</span>}</> : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-semibold tabular-nums text-right whitespace-nowrap`}>
                      {r.qty_base != null ? <>{num(r.qty_base)}{r.base_unit && <span className="text-slate-400 font-normal"> {r.base_unit}</span>}</> : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>
                      {r.ship_to_code ? (
                        <div className="leading-tight">
                          <div className="font-mono">{r.ship_to_code}</div>
                          {r.ship_to_name && <div className="text-[9px] text-slate-400 truncate" title={r.ship_to_name}>{r.ship_to_name}</div>}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.plant || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.storage_location || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono whitespace-nowrap`}>{r.batch || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] tabular-nums text-right whitespace-nowrap`}>{r.pct_date_req != null ? `${r.pct_date_req}%` : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}><StatusBadge used={r.used} syncStatus={r.sync_status} /></TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>
                      {r.unit_mismatch
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-red-100 text-red-700" title="Đơn vị base/sales lệch Material master">Lệch</span>
                        : <span className="text-green-500">✓</span>}
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}><SourceBadge source={r.source} /></TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}>
                      <div className="leading-tight">
                        <div className="text-[10px] text-slate-600">{r.uploaded_by ?? <span className="text-slate-300">—</span>}</div>
                        <div className="text-[9px] text-slate-400">{r.updated_at ? formatTimestampDate(r.updated_at, true) : ''}</div>
                      </div>
                    </TableCell>
                    <TableCell className={`px-1 ${cellPad} whitespace-nowrap`} onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5">
                        {canEdit && (
                          <button type="button" className="p-1 rounded text-sky-500 hover:text-sky-700 hover:bg-sky-50 !min-h-0 !min-w-0"
                            title="Sửa dòng" onClick={() => setFormRow(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 !min-h-0 !min-w-0"
                            title="Xóa dòng" onClick={() => setDeleteRow(r)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer phân trang */}
      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 flex items-center gap-3 text-[11px] text-slate-500 sm:rounded-b-xl">
        <span>{items.length > 0 ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + items.length} / ${total.toLocaleString('vi-VN')}` : '0 dòng'}</span>
        <label className="flex items-center gap-1 ml-2">
          <span className="hidden sm:inline">Mỗi trang</span>
          <select value={pageSize} onChange={e => setDoSap({ pageSize: Number(e.target.value) })}
            className="h-6 rounded border border-slate-200 bg-white px-1 text-[11px] outline-none focus:border-blue-400">
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 !min-h-0 !min-w-0" disabled={page <= 1} onClick={() => setDoSap({ page: page - 1 })}><ChevronLeft className="h-4 w-4" /></button>
          <span>{page}/{totalPages}</span>
          <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 !min-h-0 !min-w-0" disabled={page >= totalPages} onClick={() => setDoSap({ page: page + 1 })}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
     </div>

      {/* FormSheet Thêm/Sửa */}
      {formRow && <DoSapForm row={formRow === 'new' ? null : formRow} onClose={() => setFormRow(null)} />}

      {/* Xóa 1 dòng */}
      <Dialog open={!!deleteRow} onOpenChange={o => { if (!o) setDeleteRow(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Xóa dòng DO SAP?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">
            Xóa dòng DO <span className="font-mono font-semibold">{deleteRow?.od_number}</span> / item <span className="font-mono">{deleteRow?.od_item}</span>. Thao tác không thể hoàn tác.
          </p>
          {deleteOne.isError && <p className="text-xs text-red-500">{apiError(deleteOne.error, 'Không xóa được dòng.')}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteRow(null)} disabled={deleteOne.isPending}>Huỷ</Button>
            <Button size="sm" className="bg-red-500 hover:bg-red-600" onClick={doDeleteOne} disabled={deleteOne.isPending}>
              {deleteOne.isPending ? 'Đang xóa…' : 'Xóa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Xóa hàng loạt */}
      <Dialog open={bulkOpen} onOpenChange={o => { if (!o) setBulkOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Xóa {selected.size} dòng đã chọn?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">Xóa {selected.size} dòng DO SAP đã chọn. Thao tác không thể hoàn tác.</p>
          {bulkDelete.isError && <p className="text-xs text-red-500">{apiError(bulkDelete.error, 'Không xóa được các dòng đã chọn.')}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(false)} disabled={bulkDelete.isPending}>Huỷ</Button>
            <Button size="sm" className="bg-red-500 hover:bg-red-600" onClick={doBulkDelete} disabled={bulkDelete.isPending}>
              {bulkDelete.isPending ? 'Đang xóa…' : `Xóa ${selected.size} dòng`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Form Thêm / Sửa (FormSheet) ───────────────────────────────────────────────
interface FormState {
  od_number: string; od_item: string; material_code: string; material_name: string; source: string
  qty_sales: string; sales_unit: string; qty_base: string; base_unit: string
  ship_to_code: string; ship_to_name: string; plant: string; storage_location: string; batch: string; batch_so: string
  note_delivery: string; note_invoice: string; shipping_point: string; license_plate: string
}

function s(v: string | number | null | undefined): string {
  return v == null ? '' : String(v)
}
function n(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}
function numOrNull(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const parsed = Number(t)
  return Number.isFinite(parsed) ? parsed : null
}

function DoSapForm({ row, onClose }: { row: DoSapRow | null; onClose: () => void }) {
  const isEdit = !!row
  const create = useCreateDoSap()
  const update = useUpdateDoSap()
  const [errMsg, setErrMsg] = useState('')

  const [f, setF] = useState<FormState>(() => ({
    od_number: s(row?.od_number), od_item: s(row?.od_item),
    material_code: s(row?.material_code), material_name: s(row?.material_name), source: row ? s(row.source) : 'MANUAL',
    qty_sales: s(row?.qty_sales), sales_unit: s(row?.sales_unit), qty_base: s(row?.qty_base), base_unit: s(row?.base_unit),
    ship_to_code: s(row?.ship_to_code), ship_to_name: s(row?.ship_to_name),
    plant: s(row?.plant), storage_location: s(row?.storage_location), batch: s(row?.batch), batch_so: s(row?.batch_so),
    note_delivery: s(row?.note_delivery), note_invoice: s(row?.note_invoice),
    shipping_point: s(row?.shipping_point), license_plate: s(row?.license_plate),
  }))
  const set = (k: keyof FormState) => (v: string) => setF(prev => ({ ...prev, [k]: v }))

  const saving = create.isPending || update.isPending

  function save() {
    setErrMsg('')
    if (!isEdit && (f.od_number.trim() === '' || f.od_item.trim() === '')) {
      setErrMsg('Bắt buộc nhập số DO và Item.')
      return
    }
    const payload: Partial<DoSapRow> = {
      od_number: f.od_number.trim(), od_item: f.od_item.trim(),
      material_code: n(f.material_code), material_name: n(f.material_name), source: n(f.source),
      qty_sales: numOrNull(f.qty_sales), sales_unit: n(f.sales_unit),
      qty_base: numOrNull(f.qty_base), base_unit: n(f.base_unit),
      ship_to_code: n(f.ship_to_code), ship_to_name: n(f.ship_to_name),
      plant: n(f.plant), storage_location: n(f.storage_location), batch: n(f.batch), batch_so: n(f.batch_so),
      note_delivery: n(f.note_delivery), note_invoice: n(f.note_invoice),
      shipping_point: n(f.shipping_point), license_plate: n(f.license_plate),
    }
    const onError = (err: unknown) => setErrMsg(apiError(err, 'Không lưu được dòng DO SAP.'))
    if (isEdit && row) update.mutate({ id: row.id, ...payload }, { onSuccess: onClose, onError })
    else create.mutate(payload, { onSuccess: onClose, onError })
  }

  return (
    <FormSheet
      open onClose={onClose}
      title={isEdit ? 'Sửa dòng DO SAP' : 'Thêm dòng DO SAP'}
      description={isEdit ? `${row?.od_number} / ${row?.od_item}` : 'Nhập tay 1 dòng dữ liệu DO SAP'}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Huỷ</Button>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={save} disabled={saving}>
          {saving ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </>}
    >
      <div className="space-y-5">
        {errMsg && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{errMsg}</div>}

        <Section title="Định danh">
          <Fld label="Số DO"><Input className="h-9" value={f.od_number} onChange={e => set('od_number')(e.target.value)} disabled={isEdit} /></Fld>
          <Fld label="Item"><Input className="h-9" value={f.od_item} onChange={e => set('od_item')(e.target.value)} disabled={isEdit} /></Fld>
          <Fld label="Mã hàng"><Input className="h-9" value={f.material_code} onChange={e => set('material_code')(e.target.value)} /></Fld>
          <Fld label="Tên hàng"><Input className="h-9" value={f.material_name} onChange={e => set('material_name')(e.target.value)} /></Fld>
          <Fld label="Nguồn"><Input className="h-9" value={f.source} onChange={e => set('source')(e.target.value)} placeholder="EXCEL / SAP / MANUAL" /></Fld>
        </Section>

        <Section title="Số lượng">
          <Fld label="SL bán"><Input type="number" className="h-9" value={f.qty_sales} onChange={e => set('qty_sales')(e.target.value)} /></Fld>
          <Fld label="ĐV bán"><Input className="h-9" value={f.sales_unit} onChange={e => set('sales_unit')(e.target.value)} /></Fld>
          <Fld label="SL gốc"><Input type="number" className="h-9" value={f.qty_base} onChange={e => set('qty_base')(e.target.value)} /></Fld>
          <Fld label="ĐV gốc"><Input className="h-9" value={f.base_unit} onChange={e => set('base_unit')(e.target.value)} /></Fld>
        </Section>

        <Section title="Khách & kho">
          <Fld label="Ship-to (mã)"><Input className="h-9" value={f.ship_to_code} onChange={e => set('ship_to_code')(e.target.value)} /></Fld>
          <Fld label="Ship-to (tên)"><Input className="h-9" value={f.ship_to_name} onChange={e => set('ship_to_name')(e.target.value)} /></Fld>
          <Fld label="Plant"><Input className="h-9" value={f.plant} onChange={e => set('plant')(e.target.value)} /></Fld>
          <Fld label="Kho (storage)"><Input className="h-9" value={f.storage_location} onChange={e => set('storage_location')(e.target.value)} /></Fld>
          <Fld label="Batch"><Input className="h-9" value={f.batch} onChange={e => set('batch')(e.target.value)} /></Fld>
          <Fld label="Batch SO"><Input className="h-9" value={f.batch_so} onChange={e => set('batch_so')(e.target.value)} /></Fld>
        </Section>

        <Section title="Khác">
          <Fld label="Ghi chú giao"><Input className="h-9" value={f.note_delivery} onChange={e => set('note_delivery')(e.target.value)} /></Fld>
          <Fld label="Ghi chú hóa đơn"><Input className="h-9" value={f.note_invoice} onChange={e => set('note_invoice')(e.target.value)} /></Fld>
          <Fld label="Shipping point"><Input className="h-9" value={f.shipping_point} onChange={e => set('shipping_point')(e.target.value)} /></Fld>
          <Fld label="Biển số"><Input className="h-9" value={f.license_plate} onChange={e => set('license_plate')(e.target.value)} /></Fld>
        </Section>
      </div>
    </FormSheet>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100 pb-1 mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  )
}

function Fld({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-slate-500">{label}</label>
      {children}
    </div>
  )
}
