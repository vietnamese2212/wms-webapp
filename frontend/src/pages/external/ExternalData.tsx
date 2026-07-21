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
  useKhvcLines, useKhvcFacets, useCreateKhvc, useUpdateKhvc, useDeleteKhvc, useBulkDeleteKhvc,
  useReconcileTasks, useReconcileOpenCount, useResolveReconcileTask,
  type DoSapRow, type KhvcRow, type ReconcileTask,
} from '@/api/hooks'
import { apiClient } from '@/api/client'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions, type ModuleKey } from '@/config/permissions'
import { formatTimestampDate, formatDate } from '@/utils/formatters'

// ─── Tabs (mỗi nguồn dữ liệu raw = 1 tab, 1 module quyền riêng) ───────────────
type TabKey = 'dosap' | 'khvc' | 'reconcile'
const TABS: { key: TabKey; label: string; module: ModuleKey; action?: string }[] = [
  { key: 'dosap',     label: 'DO SAP', module: 'external_do_sap' },
  { key: 'khvc',      label: 'Kế hoạch xuất', module: 'external_khvc' },
  { key: 'reconcile', label: 'Cần xử lý', module: 'outbound', action: 'reconcile' },
]

function TabBar({ tab, setTab, perms }: { tab: TabKey; setTab: (t: TabKey) => void; perms: ModulePermissions | null }) {
  const visible = TABS.filter(t => can(perms, t.module, t.action ?? 'view'))
  return (
    <div className="border-b bg-white px-3 pt-2 shrink-0 sm:rounded-t-xl">
      <div className="flex items-center gap-1">
        {visible.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors ${
              tab === t.key ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

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

// ─── Shell: chọn tab theo quyền, render tab tương ứng ─────────────────────────
export default function ExternalData() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const firstTab = (TABS.find(t => can(perms, t.module, t.action ?? 'view'))?.key ?? 'dosap') as TabKey
  const [tab, setTab] = useState<TabKey>(firstTab)
  const tabBar = <TabBar tab={tab} setTab={setTab} perms={perms} />
  if (tab === 'reconcile') return <ReconcileTab tabBar={tabBar} />
  if (tab === 'khvc') return <KhvcTab tabBar={tabBar} />
  return <DoSapTab tabBar={tabBar} />
}

// ─── Tab DO SAP (raw erp_outbound_orders) ─────────────────────────────────────
function DoSapTab({ tabBar }: { tabBar: ReactNode }) {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreate = can(perms, 'external_do_sap', 'create')
  const canEdit   = can(perms, 'external_do_sap', 'edit')
  const canDelete = can(perms, 'external_do_sap', 'delete')

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

      {tabBar}

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

// ─── Tab Kế hoạch xuất (raw khvc_lines) ───────────────────────────────────────
const KH_COLS: { id: string; label: string }[] = [
  { id: 'sel',       label: '' },
  { id: 'group',     label: 'Số xe' },
  { id: 'do_no',     label: 'DO' },
  { id: 'warehouse', label: 'Kho' },
  { id: 'npp',       label: 'NPP' },
  { id: 'veh_type',  label: 'Loại xe' },
  { id: 'dvvt',      label: 'ĐVVT' },
  { id: 'priority',  label: 'Ưu tiên' },
  { id: 'cs',        label: 'CS' },
  { id: 'export',    label: 'Ngày xuất' },
  { id: 'do_ready',  label: 'DO sẵn sàng' },
  { id: 'status',    label: 'Chuyến' },
  { id: 'source',    label: 'Nguồn' },
  { id: 'updated',   label: 'Cập nhật' },
  { id: 'action',    label: '' },
]
const KH_COL_DEFAULTS = [40, 150, 110, 70, 150, 100, 90, 70, 70, 95, 90, 110, 80, 110, 60]

function TripBadge({ materialized, gdoStatus }: { materialized?: boolean; gdoStatus?: string | null }) {
  if (!materialized) return <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-500">Chưa sinh</span>
  const st = (gdoStatus ?? '').toUpperCase()
  const cls = st === 'COMPLETED' ? 'bg-green-100 text-green-700'
    : st === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700'
    : st === 'PAUSED' ? 'bg-red-100 text-red-700'
    : 'bg-sky-100 text-sky-700'
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`} title={gdoStatus ?? undefined}>Đã sinh</span>
}

function KhvcTab({ tabBar }: { tabBar: ReactNode }) {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreate = can(perms, 'external_khvc', 'create')
  const canEdit   = can(perms, 'external_khvc', 'edit')
  const canDelete = can(perms, 'external_khvc', 'delete')

  const { khvc: f, setKhvc } = useWmsFilterStore()
  const { search, dateFrom, dateTo, warehouse: fWh, vehType: fVeh, source: fSource, group: fGroup, doNo: fDo, page, pageSize } = f

  const [dense, setDense]         = useState(() => localStorage.getItem('khvc_density') !== 'comfortable')
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [formRow, setFormRow]     = useState<KhvcRow | 'new' | null>(null)
  const [deleteRow, setDeleteRow] = useState<KhvcRow | null>(null)
  const [bulkOpen, setBulkOpen]   = useState(false)

  const { widths: colW, startResize, totalWidth } = useColumnResize('khvc_col_widths', KH_COL_DEFAULTS)
  const { data: facets } = useKhvcFacets()
  const hasDate = !!(dateFrom || dateTo)

  const params = useMemo(() => ({
    q:              search.trim() || undefined,
    date_from:      dateFrom || undefined,
    date_to:        dateTo || undefined,
    warehouse_code: fWh || undefined,
    veh_type:       fVeh || undefined,
    source:         fSource || undefined,
    group_code:     fGroup.trim() || undefined,
    do_no:          fDo.trim() || undefined,
    page,
    page_size:      pageSize,
  }), [search, dateFrom, dateTo, fWh, fVeh, fSource, fGroup, fDo, page, pageSize])

  const { data, isLoading, isError, error } = useKhvcLines(params, hasDate)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const filterKey = JSON.stringify({ search, dateFrom, dateTo, fWh, fVeh, fSource, fGroup, fDo, pageSize })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setKhvc({ page: 1 }) }, [filterKey])

  const bulkDelete = useBulkDeleteKhvc()
  const deleteOne  = useDeleteKhvc()

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày nạp', type: 'daterange', from: dateFrom, to: dateTo,
      onChange: (from, to) => setKhvc({ dateFrom: from, dateTo: to }) },
    { key: 'warehouse', label: 'Kho', type: 'single', allLabel: 'Tất cả kho', value: fWh,
      options: (facets?.warehouses ?? []).map(w => ({ value: w, label: w })), onChange: v => setKhvc({ warehouse: v }) },
    { key: 'vehType', label: 'Loại xe', type: 'single', allLabel: 'Tất cả loại xe', value: fVeh,
      options: (facets?.veh_types ?? []).map(v => ({ value: v, label: v })), onChange: v => setKhvc({ vehType: v }) },
    { key: 'source', label: 'Nguồn', type: 'single', allLabel: 'Tất cả nguồn', value: fSource,
      options: (facets?.sources ?? []).map(s => ({ value: s, label: s })), onChange: v => setKhvc({ source: v }) },
    { key: 'group', label: 'Số xe', type: 'text', value: fGroup, placeholder: 'Nhập Số xe…', onChange: v => setKhvc({ group: v }) },
    { key: 'doNo', label: 'DO', type: 'text', value: fDo, placeholder: 'Nhập số DO…', onChange: v => setKhvc({ doNo: v }) },
  ]

  const pageIds = items.map(i => i.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id))
  function toggleAllPage() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allPageSelected) pageIds.forEach(id => next.delete(id)); else pageIds.forEach(id => next.add(id))
      return next
    })
  }
  function toggleOne(id: string) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function doBulkDelete() { bulkDelete.mutate([...selected], { onSuccess: () => { setSelected(new Set()); setBulkOpen(false) } }) }
  function doDeleteOne() {
    if (!deleteRow) return
    const id = deleteRow.id
    deleteOne.mutate(id, { onSuccess: () => { setSelected(prev => { const n = new Set(prev); n.delete(id); return n }); setDeleteRow(null) } })
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">

      {tabBar}

      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
            <Database className="h-4 w-4 text-slate-500" /> Dữ liệu bên ngoài
          </span>
          <SearchInput value={search} onChange={v => setKhvc({ search: v })}
            placeholder="Tìm Số xe, DO, NPP…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <button type="button" onClick={() => { localStorage.setItem('khvc_density', dense ? 'comfortable' : 'compact'); setDense(d => !d) }}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {canCreate && (
            <Button size="sm" className="h-9 sm:h-7 bg-blue-600 hover:bg-blue-700 shrink-0" onClick={() => setFormRow('new')}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Thêm dòng
            </Button>
          )}
        </div>
        <FilterBar defs={filterDefs} />
      </div>

      <SummaryBand tiles={[
        { label: 'Tổng dòng', value: total.toLocaleString('vi-VN') },
        { label: 'Đang chọn', value: selected.size, accent: selected.size > 0 },
        { label: 'Trang', value: `${page}/${totalPages}` },
      ]} />

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

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!hasDate ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
            <Database className="h-10 w-10 opacity-30" />
            <p className="text-sm font-medium text-slate-500">Chọn khoảng <b>Ngày nạp</b> để xem dữ liệu</p>
            <p className="text-xs">Kế hoạch xuất chỉ hiển thị sau khi chọn ngày (tránh tải toàn bộ bảng).</p>
          </div>
        ) : isLoading ? (
          <TableSkeleton cols={12} rows={12} />
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">{apiError(error, 'Lỗi tải dữ liệu Kế hoạch xuất. Vui lòng thử lại.')}</div>
        ) : items.length === 0 ? (
          <EmptyState title="Chưa có dữ liệu Kế hoạch xuất" />
        ) : (
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {KH_COLS.map((c, i) => (
                  <TableHead key={c.id} className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
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
                      <input type="checkbox" className="h-3.5 w-3.5 accent-sky-600 cursor-pointer align-middle" checked={isSel} onChange={() => toggleOne(r.id)} />
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono font-semibold whitespace-nowrap`}>{r.group_code || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono whitespace-nowrap`}>{r.do_no || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.warehouse_code || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap truncate`} title={r.npp ?? undefined}>{r.npp || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.veh_type || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.dvvt || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.priority || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.cs || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.export_date ? formatDate(r.export_date) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>
                      {r.do_ready
                        ? <span className="text-green-500">✓</span>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700" title="DO chưa có trong VL06O (raw) — up VL06O trước">DO chưa có</span>}
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}><TripBadge materialized={r.materialized} gdoStatus={r.gdo_status} /></TableCell>
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
                            title="Sửa dòng" onClick={() => setFormRow(r)}><Pencil className="h-3.5 w-3.5" /></button>
                        )}
                        {canDelete && (
                          <button type="button" className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 !min-h-0 !min-w-0"
                            title="Xóa dòng" onClick={() => setDeleteRow(r)}><Trash2 className="h-3.5 w-3.5" /></button>
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

      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 flex items-center gap-3 text-[11px] text-slate-500 sm:rounded-b-xl">
        <span>{items.length > 0 ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + items.length} / ${total.toLocaleString('vi-VN')}` : '0 dòng'}</span>
        <label className="flex items-center gap-1 ml-2">
          <span className="hidden sm:inline">Mỗi trang</span>
          <select value={pageSize} onChange={e => setKhvc({ pageSize: Number(e.target.value) })}
            className="h-6 rounded border border-slate-200 bg-white px-1 text-[11px] outline-none focus:border-blue-400">
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 !min-h-0 !min-w-0" disabled={page <= 1} onClick={() => setKhvc({ page: page - 1 })}><ChevronLeft className="h-4 w-4" /></button>
          <span>{page}/{totalPages}</span>
          <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 !min-h-0 !min-w-0" disabled={page >= totalPages} onClick={() => setKhvc({ page: page + 1 })}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
     </div>

      {formRow && <KhvcForm row={formRow === 'new' ? null : formRow} onClose={() => setFormRow(null)} />}

      <Dialog open={!!deleteRow} onOpenChange={o => { if (!o) setDeleteRow(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Xóa dòng Kế hoạch xuất?</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">
            Xóa dòng Số xe <span className="font-mono font-semibold">{deleteRow?.group_code}</span> / DO <span className="font-mono">{deleteRow?.do_no}</span>. Thao tác không thể hoàn tác.
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

      <Dialog open={bulkOpen} onOpenChange={o => { if (!o) setBulkOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Xóa {selected.size} dòng đã chọn?</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">Xóa {selected.size} dòng Kế hoạch xuất đã chọn. Thao tác không thể hoàn tác.</p>
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

interface KhvcFormState {
  group_code: string; do_no: string; warehouse_code: string; npp: string; veh_type: string
  dvvt: string; priority: string; cs: string; note: string; export_date: string; source: string
}
function KhvcForm({ row, onClose }: { row: KhvcRow | null; onClose: () => void }) {
  const isEdit = !!row
  const create = useCreateKhvc()
  const update = useUpdateKhvc()
  const [errMsg, setErrMsg] = useState('')

  const [f, setF] = useState<KhvcFormState>(() => ({
    group_code: s(row?.group_code), do_no: s(row?.do_no), warehouse_code: s(row?.warehouse_code),
    npp: s(row?.npp), veh_type: s(row?.veh_type), dvvt: s(row?.dvvt), priority: s(row?.priority),
    cs: s(row?.cs), note: s(row?.note), export_date: s(row?.export_date), source: row ? s(row.source) : 'MANUAL',
  }))
  const set = (k: keyof KhvcFormState) => (v: string) => setF(prev => ({ ...prev, [k]: v }))
  const saving = create.isPending || update.isPending

  function save() {
    setErrMsg('')
    if (!isEdit && (f.group_code.trim() === '' || f.do_no.trim() === '')) { setErrMsg('Bắt buộc nhập Số xe và DO.'); return }
    const payload: Partial<KhvcRow> = {
      group_code: f.group_code.trim(), do_no: f.do_no.trim(),
      warehouse_code: n(f.warehouse_code), npp: n(f.npp), veh_type: n(f.veh_type), dvvt: n(f.dvvt),
      priority: n(f.priority), cs: n(f.cs), note: n(f.note), export_date: n(f.export_date), source: n(f.source),
    }
    const onError = (err: unknown) => setErrMsg(apiError(err, 'Không lưu được dòng Kế hoạch xuất.'))
    if (isEdit && row) update.mutate({ id: row.id, ...payload }, { onSuccess: onClose, onError })
    else create.mutate(payload, { onSuccess: onClose, onError })
  }

  return (
    <FormSheet
      open onClose={onClose}
      title={isEdit ? 'Sửa dòng Kế hoạch xuất' : 'Thêm dòng Kế hoạch xuất'}
      description={isEdit ? `${row?.group_code} / ${row?.do_no}` : 'Nhập tay 1 dòng kế hoạch xuất'}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Huỷ</Button>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}
    >
      <div className="space-y-5">
        {errMsg && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{errMsg}</div>}
        <Section title="Định danh">
          <Fld label="Số xe"><Input className="h-9" value={f.group_code} onChange={e => set('group_code')(e.target.value)} disabled={isEdit} /></Fld>
          <Fld label="DO"><Input className="h-9" value={f.do_no} onChange={e => set('do_no')(e.target.value)} disabled={isEdit} /></Fld>
          <Fld label="Kho"><Input className="h-9" value={f.warehouse_code} onChange={e => set('warehouse_code')(e.target.value)} /></Fld>
          <Fld label="Ngày xuất"><Input type="date" className="h-9" value={f.export_date} onChange={e => set('export_date')(e.target.value)} /></Fld>
          <Fld label="Nguồn"><Input className="h-9" value={f.source} onChange={e => set('source')(e.target.value)} placeholder="EXCEL / SAP / MANUAL" /></Fld>
        </Section>
        <Section title="Điều vận">
          <Fld label="Tên NPP"><Input className="h-9" value={f.npp} onChange={e => set('npp')(e.target.value)} /></Fld>
          <Fld label="Loại xe"><Input className="h-9" value={f.veh_type} onChange={e => set('veh_type')(e.target.value)} /></Fld>
          <Fld label="ĐVVT"><Input className="h-9" value={f.dvvt} onChange={e => set('dvvt')(e.target.value)} /></Fld>
          <Fld label="Ưu tiên"><Input className="h-9" value={f.priority} onChange={e => set('priority')(e.target.value)} /></Fld>
          <Fld label="CS phụ trách"><Input className="h-9" value={f.cs} onChange={e => set('cs')(e.target.value)} /></Fld>
          <Fld label="Ghi chú"><Input className="h-9" value={f.note} onChange={e => set('note')(e.target.value)} /></Fld>
        </Section>
      </div>
    </FormSheet>
  )
}

// ─── Tab "Cần xử lý" (reconcile_tasks — đối chiếu SAP↔WMS) ────────────────────
const RC_COLS: { id: string; label: string }[] = [
  { id: 'group',   label: 'Chuyến' },
  { id: 'mat',     label: 'Mã hàng' },
  { id: 'do',      label: 'DO / Item' },
  { id: 'change',  label: 'Kiểu đổi' },
  { id: 'zone',    label: 'Vùng' },
  { id: 'qty',     label: 'SL cũ → mới' },
  { id: 'scanned', label: 'Đã quét' },
  { id: 'detail',  label: 'Chi tiết / Vì sao' },
  { id: 'result',  label: 'Kết quả' },
  { id: 'action',  label: 'Xử lý' },
]
const RC_COL_DEFAULTS = [150, 150, 110, 110, 130, 110, 80, 320, 110, 190]

const CHANGE_LABEL: Record<string, { label: string; cls: string }> = {
  QTY_INCREASE:     { label: 'SAP tăng SL',     cls: 'bg-amber-100 text-amber-700' },
  QTY_DECREASE:     { label: 'SAP giảm SL',     cls: 'bg-amber-100 text-amber-700' },
  LINE_REMOVED:     { label: 'SAP bỏ dòng',     cls: 'bg-red-100 text-red-700' },
  MATERIAL_CHANGED: { label: 'SAP đổi mã',      cls: 'bg-red-100 text-red-700' },
  ATTR_CHANGED:     { label: 'Đổi batch/%Date', cls: 'bg-slate-100 text-slate-600' },
  SHIPTO_CHANGED:   { label: 'Đổi ship-to',     cls: 'bg-amber-100 text-amber-700' },
}
const ZONE_LABEL: Record<string, string> = { Z1: 'Chưa BĐ · chưa quét', Z2: 'Đang xuất · chưa quét', Z3: 'ĐÃ QUÉT', Z4: 'Đã đóng (GI)' }
const ACTION_BADGE: Record<string, { label: string; cls: string }> = {
  AUTO_APPLIED:    { label: 'Đã tự áp',     cls: 'bg-green-100 text-green-700' },
  NEEDS_REVIEW:    { label: 'Cần duyệt',    cls: 'bg-amber-100 text-amber-700' },
  BLOCKED:         { label: 'Chặn · trả hàng', cls: 'bg-red-100 text-red-700' },
  RECONCILE_ONLY:  { label: 'Chỉ đối soát', cls: 'bg-slate-100 text-slate-600' },
}
const RC_PAGE_SIZES = [50, 100, 200]

function ReconcileTab({ tabBar }: { tabBar: ReactNode }) {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canResolve = can(perms, 'outbound', 'reconcile')

  const { reconcile: f, setReconcile } = useWmsFilterStore()
  const { search, status, dateFrom, dateTo, page, pageSize } = f
  const [dense, setDense] = useState(() => localStorage.getItem('reconcile_density') !== 'comfortable')
  const [resolveTarget, setResolveTarget] = useState<{ task: ReconcileTask; resolution: 'apply' | 'keep' | 'manual_done' } | null>(null)

  const { widths: colW, startResize, totalWidth } = useColumnResize('reconcile_col_widths', RC_COL_DEFAULTS)
  const { data: openCount } = useReconcileOpenCount()

  const params = useMemo(() => ({
    q: search.trim() || undefined, status: status || 'OPEN',
    date_from: dateFrom || undefined, date_to: dateTo || undefined, page, page_size: pageSize,
  }), [search, status, dateFrom, dateTo, page, pageSize])

  const { data, isLoading, isError, error } = useReconcileTasks(params)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const resolve = useResolveReconcileTask()

  const filterKey = JSON.stringify({ search, status, dateFrom, dateTo, pageSize })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setReconcile({ page: 1 }) }, [filterKey])

  const filterDefs: FilterDef[] = [
    { key: 'status', label: 'Trạng thái', type: 'single', allLabel: 'Tất cả', value: status,
      options: [{ value: 'OPEN', label: 'Cần xử lý' }, { value: 'RESOLVED', label: 'Đã xử lý' }],
      onChange: v => setReconcile({ status: v === '__all__' ? '' : v }) },
    { key: 'date', label: 'Ngày phát sinh', type: 'daterange', from: dateFrom, to: dateTo,
      onChange: (from, to) => setReconcile({ dateFrom: from, dateTo: to }) },
  ]

  function doResolve() {
    if (!resolveTarget) return
    resolve.mutate({ id: resolveTarget.task.id, resolution: resolveTarget.resolution }, { onSuccess: () => setResolveTarget(null) })
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {tabBar}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
            <Database className="h-4 w-4 text-slate-500" /> Cần xử lý (đối chiếu SAP)
          </span>
          <SearchInput value={search} onChange={v => setReconcile({ search: v })}
            placeholder="Tìm chuyến, mã hàng, DO…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <button type="button" onClick={() => { localStorage.setItem('reconcile_density', dense ? 'comfortable' : 'compact'); setDense(d => !d) }}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
        </div>
        <FilterBar defs={filterDefs} />
      </div>

      <SummaryBand tiles={[
        { label: 'Cần xử lý (tất cả)', value: (openCount?.open ?? 0).toLocaleString('vi-VN'), accent: (openCount?.open ?? 0) > 0 },
        { label: 'Đang xem', value: total.toLocaleString('vi-VN') },
        { label: 'Trang', value: `${page}/${totalPages}` },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <TableSkeleton cols={10} rows={10} />
        ) : isError ? (
          <div className="p-6 text-center text-sm text-red-500">{apiError(error, 'Lỗi tải hàng chờ đối chiếu.')}</div>
        ) : items.length === 0 ? (
          <EmptyState title={status === 'RESOLVED' ? 'Chưa có việc đã xử lý' : 'Không có việc cần xử lý 🎉'} />
        ) : (
          <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow>
                {RC_COLS.map((c, i) => (
                  <TableHead key={c.id} className={`px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                      className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(r => {
                const cellPad = dense ? 'py-1' : 'py-2.5'
                const ch = CHANGE_LABEL[r.change_type] ?? { label: r.change_type, cls: 'bg-slate-100 text-slate-600' }
                const ab = ACTION_BADGE[r.action] ?? { label: r.action, cls: 'bg-slate-100 text-slate-600' }
                const isOpen = r.status === 'OPEN'
                const canApply = isOpen && r.action === 'NEEDS_REVIEW' && Number(r.new_ordered) >= Number(r.scanned)
                return (
                  <TableRow key={r.id}>
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono font-semibold whitespace-nowrap sticky left-0 z-10 bg-white`}>{r.group_code || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>
                      <div className="leading-tight"><div className="font-mono">{r.material_code || '—'}</div>
                      {r.material_name && <div className="text-[9px] text-slate-400 truncate" title={r.material_name}>{r.material_name}</div>}</div>
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono whitespace-nowrap`}>{r.od_number ? `${r.od_number}${r.od_item ? '/' + r.od_item : ''}` : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}><span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${ch.cls}`}>{ch.label}</span></TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap ${r.zone === 'Z3' ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{ZONE_LABEL[r.zone] ?? r.zone}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] tabular-nums whitespace-nowrap`}>
                      <span className="text-slate-400">{r.old_ordered ?? '—'}</span> → <span className="font-semibold">{r.new_ordered ?? '—'}</span>
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] tabular-nums font-semibold whitespace-nowrap ${Number(r.scanned) > 0 ? 'text-red-600' : 'text-slate-400'}`}>{r.scanned ?? 0}</TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap truncate`} title={r.detail ?? undefined}>{r.detail || <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}>
                      {isOpen
                        ? <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${ab.cls}`}>{ab.label}</span>
                        : <div className="leading-tight"><span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-green-100 text-green-700">Đã xử lý</span>
                          {r.resolution && <div className="text-[9px] text-slate-400 mt-0.5">{r.resolution === 'apply' ? 'Áp SAP' : r.resolution === 'keep' ? 'Giữ WMS' : 'Tay'} · {r.resolved_by ?? ''}</div>}</div>}
                    </TableCell>
                    <TableCell className={`px-1 ${cellPad} whitespace-nowrap`}>
                      {isOpen && canResolve ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {canApply && (
                            <button type="button" onClick={() => setResolveTarget({ task: r, resolution: 'apply' })}
                              className="text-[9px] px-1.5 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50 font-semibold !min-h-0">Áp SAP</button>
                          )}
                          {(r.action === 'BLOCKED' || r.action === 'MATERIAL_CHANGED') && (
                            <button type="button" onClick={() => setResolveTarget({ task: r, resolution: 'manual_done' })}
                              className="text-[9px] px-1.5 py-1 rounded border border-sky-300 text-sky-700 hover:bg-sky-50 font-semibold !min-h-0">Đã xử lý tay</button>
                          )}
                          <button type="button" onClick={() => setResolveTarget({ task: r, resolution: 'keep' })}
                            className="text-[9px] px-1.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 !min-h-0">Giữ WMS</button>
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 flex items-center gap-3 text-[11px] text-slate-500 sm:rounded-b-xl">
        <span>{items.length > 0 ? `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + items.length} / ${total.toLocaleString('vi-VN')}` : '0 việc'}</span>
        <label className="flex items-center gap-1 ml-2">
          <span className="hidden sm:inline">Mỗi trang</span>
          <select value={pageSize} onChange={e => setReconcile({ pageSize: Number(e.target.value) })}
            className="h-6 rounded border border-slate-200 bg-white px-1 text-[11px] outline-none focus:border-blue-400">
            {RC_PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 !min-h-0 !min-w-0" disabled={page <= 1} onClick={() => setReconcile({ page: page - 1 })}><ChevronLeft className="h-4 w-4" /></button>
          <span>{page}/{totalPages}</span>
          <button className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 !min-h-0 !min-w-0" disabled={page >= totalPages} onClick={() => setReconcile({ page: page + 1 })}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
     </div>

      {/* Confirm xử lý */}
      <Dialog open={!!resolveTarget} onOpenChange={o => { if (!o) setResolveTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">
            {resolveTarget?.resolution === 'apply' ? 'Áp thay đổi SAP vào đơn?'
              : resolveTarget?.resolution === 'manual_done' ? 'Đánh dấu đã xử lý tay?'
              : 'Giữ nguyên WMS (báo SAP sửa lại)?'}
          </DialogTitle></DialogHeader>
          <div className="text-xs text-slate-600 space-y-1.5">
            <p className="font-mono">{resolveTarget?.task.group_code} · {resolveTarget?.task.material_code}</p>
            <p className="text-slate-500">{resolveTarget?.task.detail}</p>
            {resolveTarget?.resolution === 'apply' && <p className="text-green-700">Sẽ đặt số lượng đơn = <b>{resolveTarget?.task.new_ordered}</b> (base) + tính lại nhặt lẻ.</p>}
            {resolveTarget?.resolution === 'manual_done' && <p className="text-sky-700">Xác nhận bạn đã xử lý ở Xuất kho (trả hàng/sửa số). Việc này chỉ đánh dấu hoàn tất.</p>}
            {resolveTarget?.resolution === 'keep' && <p>Đơn WMS GIỮ NGUYÊN; CS báo SAP điều chỉnh lại cho khớp.</p>}
          </div>
          {resolve.isError && <p className="text-xs text-red-500">{apiError(resolve.error, 'Không xử lý được.')}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setResolveTarget(null)} disabled={resolve.isPending}>Huỷ</Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={doResolve} disabled={resolve.isPending}>
              {resolve.isPending ? 'Đang xử lý…' : 'Xác nhận'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
