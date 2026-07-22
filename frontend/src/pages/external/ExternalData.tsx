// Dữ liệu bên ngoài — dữ liệu raw ERP/SAP đổ vào WMS.
// Tab "DO SAP" = bảng erp_outbound_orders (CRUD tay + multi-select + filter + search + phân trang server-side).
// Thiết kế mảng tabs để sau này thêm nguồn dữ liệu khác (hiện chỉ 1 tab active).
import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Database, Plus, Pencil, Trash2, X, ChevronLeft, ChevronRight, AlignJustify, Rows3, Download } from 'lucide-react'
import type { AxiosError } from 'axios'
import * as XLSX from 'xlsx'
import { saveWorkbook } from '@/utils/saveExcel'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FormSheet } from '@/components/shared/FormSheet'
import { EmptyState } from '@/components/shared/EmptyState'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  useDoSapOrders, useDoSapFacets, useCreateDoSap, useUpdateDoSap, useBulkDeleteDoSap,
  useKhvcLines, useKhvcFacets, useCreateKhvc, useUpdateKhvc, useBulkDeleteKhvc,
  useReconcileTasks, useReconcileOpenCount, useResolveReconcileTask,
  type DoSapRow, type KhvcRow, type ReconcileTask,
} from '@/api/hooks'
import { apiClient } from '@/api/client'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions, type ModuleKey } from '@/config/permissions'
import { formatTimestampDate, formatDate } from '@/utils/formatters'
import { QtyInput } from '@/components/shared/QtyInput'
import { qtyLabel, hasEntry, qtyFromEntryBase } from '@/utils/qtyUnits'

// ─── Tabs (mỗi nguồn dữ liệu raw = 1 tab, 1 module quyền riêng) ───────────────
type TabKey = 'dosap' | 'khvc' | 'reconcile'
const TABS: { key: TabKey; label: string; module: ModuleKey; action?: string }[] = [
  { key: 'dosap',     label: 'DO SAP', module: 'external_do_sap' },
  { key: 'khvc',      label: 'Kế hoạch xuất', module: 'external_khvc' },
  { key: 'reconcile', label: 'Cần xử lý', module: 'outbound', action: 'reconcile' },
]

// Header trang: tiêu đề "Dữ liệu bên ngoài" NẰM TRÊN, BAO các tab (DO SAP / Kế hoạch xuất / Cần xử lý).
function TabBar({ tab, setTab, perms }: { tab: TabKey; setTab: (t: TabKey) => void; perms: ModulePermissions | null }) {
  const visible = TABS.filter(t => can(perms, t.module, t.action ?? 'view'))
  return (
    <div className="border-b bg-white px-3 pt-2 shrink-0 sm:rounded-t-xl">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Database className="h-4 w-4 text-slate-500 shrink-0" />
        <span className="text-sm font-semibold text-slate-700">Dữ liệu bên ngoài</span>
        <span className="hidden sm:inline text-[11px] text-slate-400">— dữ liệu raw ERP/SAP đổ vào WMS</span>
      </div>
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

// Ngày hôm nay theo giờ VN (YYYY-MM-DD) — cho nút "Xem hôm nay" ở màn trống (data vừa nạp có Ngày nạp = hôm nay)
const TODAY_VN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

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
  { id: 'plan_veh',   label: 'Số xe (KH)' },
  { id: 'plan_date',  label: 'Ngày xuất (KH)' },
  { id: 'source',     label: 'Nguồn' },
  { id: 'updated',    label: 'Cập nhật' },
]
const COL_DEFAULTS = [40, 110, 55, 110, 160, 90, 90, 135, 70, 90, 100, 70, 90, 65, 150, 95, 80, 110]

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
  const { search, dateFrom, dateTo, source: fSource, plant: fPlant, shipto: fShipto, material: fMaterial, od: fOd, inPlan: fInPlan, used: fUsed, page, pageSize } = f

  const [dense, setDense]           = useState(() => localStorage.getItem('dosap_density') !== 'comfortable')
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [doEditor, setDoEditor]     = useState<string[] | null>(null)   // sửa cả DO — danh sách od_number (bảng gom mọi mã cùng DO)
  const [exporting, setExporting]   = useState(false)
  const [exportErr, setExportErr]   = useState('')

  const { widths: colW, startResize, totalWidth } = useColumnResize('dosap_col_widths_v4', COL_DEFAULTS)
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
    in_plan:       fInPlan || undefined,
    used:          fUsed || undefined,
    page,
    page_size:     pageSize,
  }), [search, dateFrom, dateTo, fSource, fPlant, fShipto, fMaterial, fOd, fInPlan, fUsed, page, pageSize])

  const { data, isLoading, isError, error } = useDoSapOrders(params, hasDate)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const planWarn = data?.plan_filter_warning

  // Đổi filter/search/pageSize → về trang 1 (filterKey KHÔNG gồm page để tránh vòng lặp)
  const filterKey = JSON.stringify({ search, dateFrom, dateTo, fSource, fPlant, fShipto, fMaterial, fOd, fInPlan, fUsed, pageSize })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDoSap({ page: 1 }) }, [filterKey])

  // Map id → od_number của mọi dòng ĐÃ render (selection chỉ tick được dòng đã thấy) — cho nút Sửa multi
  const idToDo = useRef<Record<string, string>>({})
  useEffect(() => { for (const r of items) idToDo.current[r.id] = r.od_number }, [items])

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
    { key: 'inPlan', label: 'Trong kế hoạch', type: 'single', allLabel: 'Tất cả', value: fInPlan,
      options: [{ value: '1', label: 'Có trong kế hoạch' }, { value: '0', label: 'Ngoài kế hoạch' }],
      onChange: v => setDoSap({ inPlan: v === '__all__' ? '' : v }) },
    { key: 'used', label: 'Chuyến Xuất', type: 'single', allLabel: 'Tất cả', value: fUsed,
      options: [{ value: '1', label: 'Còn trong chuyến' }, { value: '0', label: 'Không có chuyến' }],
      onChange: v => setDoSap({ used: v === '__all__' ? '' : v }) },
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

  // Sửa các dòng đã tick → mở bảng gom theo DO (mọi mã cùng DO của các dòng đã chọn)
  const selectedDos = useMemo(
    () => [...new Set([...selected].map(id => idToDo.current[id]).filter(Boolean))],
    [selected, items],   // items để map ref kịp cập nhật trước khi tính
  )

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
      saveWorkbook(wb, 'do-sap.xlsx')
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
          <SearchInput value={search} onChange={v => setDoSap({ search: v })}
            placeholder="Tìm DO, số xe (KH), mã hàng, ship-to…" className="flex-1 min-w-[140px]" />
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
          {/* Action theo selection đặt NGAY TRÊN HEADER (user 22/07) — không chèn bar giữa
              SummaryBand và bảng nữa (bar hiện/ẩn làm bảng nhảy layout). Nút h-7 = không đổi chiều cao hàng. */}
          {selected.size > 0 && (canEdit || canCreate) && selectedDos.length > 0 && (
            // canCreate-không-edit vẫn mở được editor (chỉ để THÊM dòng — ô sửa bị khóa bên trong)
            <button type="button" onClick={() => setDoEditor(selectedDos)}
              className="inline-flex items-center gap-1 h-9 sm:h-7 px-2 rounded border border-sky-300 bg-sky-50 text-xs text-sky-700 hover:bg-sky-100 transition-colors shrink-0">
              <Pencil className="h-3.5 w-3.5" /> Sửa {selectedDos.length > 1 ? `${selectedDos.length} DO` : `DO ${selectedDos[0]}`}
            </button>
          )}
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1 h-9 sm:h-7 px-2 rounded border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 transition-colors shrink-0">
              <X className="h-3.5 w-3.5" /> Bỏ chọn ({selected.size})
            </button>
          )}
          {/* Thêm mới hoàn toàn = UPLOAD (VL06O), không thêm tay ngoài header — user chốt 21/07.
              Thêm dòng vào DO đã có: tick dòng → Sửa → nút "+ Thêm dòng" trong editor.
              Xóa dòng: CHỈ trong editor (user 22/07 bỏ Xóa bulk ngoài list). */}
        </div>
        <FilterBar defs={filterDefs} />
        {exportErr && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600">{exportErr}</div>}
        {planWarn && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{planWarn}</div>}
      </div>

      <SummaryBand tiles={[
        { label: 'Tổng dòng', value: total.toLocaleString('vi-VN') },
        { label: 'Đang chọn', value: selected.size, accent: selected.size > 0 },
        { label: 'Trang', value: `${page}/${totalPages}` },
      ]} />

      {/* Bảng */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!hasDate ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
            <Database className="h-10 w-10 opacity-30" />
            <p className="text-sm font-medium text-slate-500">Chọn khoảng <b>Ngày nạp</b> để xem dữ liệu</p>
            <p className="text-xs">Dữ liệu vừa upload nằm ở <b>Ngày nạp = hôm nay</b> (tránh tải toàn bộ bảng nên phải chọn ngày).</p>
            <Button size="sm" className="mt-2 h-8 bg-blue-600 hover:bg-blue-700" onClick={() => setDoSap({ dateFrom: TODAY_VN(), dateTo: TODAY_VN() })}>
              Xem hôm nay
            </Button>
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
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono font-semibold whitespace-nowrap`}>
                      {r.od_number || <span className="text-slate-300">—</span>}
                      {r.manual_edited_at && (
                        <span className="ml-1 text-amber-600 font-sans" title={`Đã sửa tay ${formatTimestampDate(r.manual_edited_at, true)} — upload lại VL06O sẽ đè theo SAP`}>✎</span>
                      )}
                    </TableCell>
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
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono whitespace-nowrap truncate`} title={r.plan_group_code ?? undefined}>
                      {r.in_plan
                        ? <>{r.plan_group_code}{(r.plan_group_count ?? 0) > 1 && <span className="text-slate-400"> +{(r.plan_group_count ?? 1) - 1}</span>}</>
                        : <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700" title="DO chưa có trong Kế hoạch điều vận">Ngoài KH</span>}
                    </TableCell>
                    <TableCell className={`px-2 ${cellPad} text-[10px] whitespace-nowrap`}>{r.plan_export_date ? formatDate(r.plan_export_date) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}><SourceBadge source={r.source} /></TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}>
                      <div className="leading-tight">
                        <div className="text-[10px] text-slate-600">{r.uploaded_by ?? <span className="text-slate-300">—</span>}</div>
                        <div className="text-[9px] text-slate-400">{r.updated_at ? formatTimestampDate(r.updated_at, true) : ''}</div>
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

      {/* FormSheet Sửa cả DO — bảng gom mọi mã cùng od_number (mô hình base gốc).
          Xóa dòng: CHỈ trong editor này (bỏ Xóa bulk ngoài list — user 22/07). */}
      {doEditor && (
        <DoSapDoEditor
          odNumbers={doEditor}
          canEdit={canEdit}
          canCreate={canCreate}
          canDelete={canDelete}
          onClose={() => { setDoEditor(null); setSelected(new Set()) }}
        />
      )}
    </div>
  )
}

// ─── Helper chuỗi dùng chung cho editor (KHVC draft + payload) ─────────────────
function s(v: string | number | null | undefined): string {
  return v == null ? '' : String(v)
}
function n(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

// ─── Sửa cả DO (bảng gom mọi mã cùng od_number) — mô hình BASE GỐC ────────────
// Mở như 1 chứng từ DO trong SAP: mỗi dòng = 1 mã; sửa 2 ô Thùng+Hộp (QtyInput)
// → cột "Số gốc (base)" read-only tự tính lại; SL bán SAP = tham khảo. Lưu = update
// song song các dòng ĐỔI (mỗi dòng qua PUT /external/do-sap/:id → engine reconcile tự áp).
// Nhận NHIỀU DO (tick multi → Sửa): mỗi DO fetch riêng (song song), bảng gom có cột DO + kẻ nhóm.
const DO_EDITOR_CAP = 20
type DoSapNewLine = {
  key: string; od_number: string; od_item: string
  material_code: string; material_name: string | null; base_unit: string | null
  qty_base: number; mat: DoSapRow['mat_units']
  lookup: 'idle' | 'looking' | 'ok' | 'notfound' | 'error'
}
function DoSapDoEditor({ odNumbers, canEdit, canCreate, canDelete, onClose }: {
  odNumbers: string[]
  canEdit: boolean
  canCreate: boolean
  canDelete: boolean
  onClose: () => void
}) {
  const dos = useMemo(() => [...new Set(odNumbers)].slice(0, DO_EDITOR_CAP), [odNumbers])
  const truncated = new Set(odNumbers).size - dos.length
  const multi = dos.length > 1
  // Kéo mọi dòng của từng DO (không date-gate) — khớp CHÍNH XÁC (od_number_eq, không ilike).
  // Nếu 1 DO > 200 dòng (trần page_size BE) → đánh dấu INCOMPLETE và CHẶN lưu — tuyệt đối
  // không để "Xóa cả DO" chỉ xóa 200 dòng nhìn thấy. Query key prefix 'do-sap' → invalidate chung list.
  const { data: fetched, isLoading } = useQuery({
    queryKey: ['do-sap', 'do-editor', dos],
    queryFn: async () => {
      const results = await Promise.all(dos.map(od =>
        apiClient.get(`/external/do-sap?od_number_eq=${encodeURIComponent(od)}&page_size=200`)
          .then(r => {
            const d = r.data.data as { items: DoSapRow[]; total: number }
            return { items: d.items.filter(x => x.od_number === od), total: d.total }
          })
      ))
      return { rows: results.flatMap(r => r.items), incomplete: results.some(r => r.total > r.items.length) }
    },
  })
  const incomplete = fetched?.incomplete ?? false
  const rows = useMemo(() => {
    return [...(fetched?.rows ?? [])].sort((a, b) =>
      a.od_number.localeCompare(b.od_number)
      || (Number(a.od_item) || 0) - (Number(b.od_item) || 0)
      || String(a.od_item).localeCompare(String(b.od_item)))
  }, [fetched])

  const update = useUpdateDoSap()
  const create = useCreateDoSap()
  const bulkDel = useBulkDeleteDoSap()
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [added, setAdded] = useState<DoSapNewLine[]>([])
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  // Nạp giá trị gốc cho dòng CHƯA có trong draft (refetch không đè chỗ user đang sửa)
  useEffect(() => {
    setDraft(prev => {
      const next = { ...prev }
      for (const r of rows) if (!(r.id in next)) next[r.id] = Number(r.qty_base) || 0
      return next
    })
  }, [rows])

  const remaining = rows.filter(r => !removed.has(r.id))
  const changed = remaining.filter(r => (draft[r.id] ?? 0) !== (Number(r.qty_base) || 0))
  const validAdded = added.filter(l => l.material_code.trim() !== '' && l.od_item.trim() !== '')
  // Xóa hết dòng + không thêm gì và lưu = XÓA CẢ DO (user chốt 21/07)
  const wipesAll = rows.length > 0 && remaining.length === 0 && validAdded.length === 0
  const hasOps = changed.length > 0 || validAdded.length > 0 || removed.size > 0
  const head = rows[0]

  // Item mặc định cho dòng thêm mới = max item của DO + 10
  function nextItem(od: string): string {
    const nums = [...rows.filter(r => r.od_number === od), ...added.filter(l => l.od_number === od)]
      .map(r => Number(r.od_item)).filter(v => Number.isFinite(v))
    return String((nums.length ? Math.max(...nums) : 0) + 10)
  }
  function addLine() {
    setAdded(prev => [...prev, {
      key: crypto.randomUUID(), od_number: dos[0], od_item: nextItem(dos[0]),
      material_code: '', material_name: null, base_unit: null, qty_base: 0, mat: null, lookup: 'idle',
    }])
  }
  const patchLine = (key: string, p: Partial<DoSapNewLine>) =>
    setAdded(prev => prev.map(l => l.key === key ? { ...l, ...p } : l))
  // Tra Material master theo mã CHÍNH XÁC → tên + quy cách (null = không có; 'error' = 403/mạng)
  async function fetchMat(code: string): Promise<{ short_name: string | null; mat: DoSapRow['mat_units'] } | null | 'error'> {
    try {
      const { data } = await apiClient.get('/masterdata/materials', { params: { search: code } })
      const list = (data.data ?? []) as { material_code: string; short_name?: string | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null }[]
      const m = list.find(x => x.material_code === code)
      if (!m) return null
      return { short_name: m.short_name ?? null, mat: { base_unit: m.base_unit ?? null, entry_unit: m.entry_unit ?? null, units_per_carton: m.units_per_carton ?? null } }
    } catch { return 'error' }
  }
  // Blur ô Mã hàng → tra tên + quy cách để tách 2 ô Thùng+Hộp
  async function lookupMat(key: string, code: string) {
    const c = code.trim()
    if (c.length < 4) return   // gõ dở 1-2 ký tự → đừng bắn search cả bảng Material
    patchLine(key, { lookup: 'looking' })
    const r = await fetchMat(c)
    if (r === 'error') patchLine(key, { lookup: 'error' })   // 403/mất mạng → báo rõ, đừng câm (số lượng sẽ hiểu là BASE)
    else if (r) patchLine(key, { material_name: r.short_name, base_unit: r.mat?.base_unit ?? null, mat: r.mat, lookup: 'ok' })
    else patchLine(key, { material_name: null, base_unit: null, mat: null, lookup: 'notfound' })
  }

  // ── Paste từ Excel (chuẩn app — mẫu form Xuất kho) ──
  // Ô SỐ LƯỢNG dòng có sẵn: dán nhiều dòng, mỗi dòng 1–2 cột [Thùng] / [Thùng ⇥ Hộp]
  // (mã KHÔNG entry: cột đầu = SỐ BASE thập phân) → điền lần lượt xuống theo thứ tự bảng.
  function pasteQtyOf(cols: string[], mat: DoSapRow['mat_units']): number {
    if (hasEntry(mat)) {
      const thung = parseInt((cols[0] ?? '').replace(/[^0-9]/g, '')) || 0
      const hop   = parseInt((cols[1] ?? '').replace(/[^0-9]/g, '')) || 0
      return qtyFromEntryBase(thung, hop, mat)
    }
    return parseFloat((cols[0] ?? '').trim().replace(/\s/g, '').replace(',', '.')) || 0
  }
  function handlePasteQtyAt(startIdx: number, e: React.ClipboardEvent<HTMLElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\t')) return   // dán 1 số đơn lẻ → để input tự xử
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
    setDraft(prev => {
      const next = { ...prev }
      lines.forEach((line, off) => {
        const r = rows[startIdx + off]
        if (!r || removed.has(r.id)) return
        next[r.id] = pasteQtyOf(line.split('\t'), r.mat_units)
      })
      return next
    })
  }
  // Ô MÃ HÀNG dòng thêm mới: dán block [Mã hàng ⇥ Thùng ⇥ Hộp] nhiều dòng → điền dòng này
  // + TỰ SINH thêm dòng cho phần dư, rồi tra Material từng mã (tên + quy cách + qty đúng).
  async function handlePasteAddedAt(startKey: string, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\t')) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
    if (!lines.length) return
    const startPos = added.findIndex(l => l.key === startKey)
    if (startPos < 0) return
    const od = added[startPos].od_number
    // Item tự đánh tiếp từ max hiện có của DO (rows + added), +10 mỗi dòng
    let itemBase = Math.max(0, ...[...rows.filter(r => r.od_number === od), ...added.filter(l => l.od_number === od)]
      .map(r => Number(r.od_item)).filter(v => Number.isFinite(v)))
    const work = [...added]
    const affected: { key: string; code: string }[] = []
    lines.forEach((line, off) => {
      const cols = line.split('\t')
      const code = (cols[0] ?? '').trim()
      const thung = parseInt((cols[1] ?? '').replace(/[^0-9]/g, '')) || 0
      const hop   = parseInt((cols[2] ?? '').replace(/[^0-9]/g, '')) || 0
      let pos = startPos + off
      if (pos >= work.length) {
        itemBase += 10
        work.push({ key: crypto.randomUUID(), od_number: od, od_item: String(itemBase),
          material_code: '', material_name: null, base_unit: null, qty_base: 0, mat: null, lookup: 'idle' })
        pos = work.length - 1
      }
      // qty tạm = thùng+hộp cộng thô — sẽ TÍNH LẠI bằng quy cách thật sau khi tra mã (dưới)
      work[pos] = { ...work[pos], material_code: code, qty_base: thung + hop, mat: null, material_name: null, lookup: code ? 'looking' : 'idle' }
      ;(work[pos] as DoSapNewLine & { _thung?: number; _hop?: number })._thung = thung
      ;(work[pos] as DoSapNewLine & { _thung?: number; _hop?: number })._hop = hop
      if (code) affected.push({ key: work[pos].key, code })
    })
    setAdded(work)
    for (const a of affected) {
      const r = await fetchMat(a.code)
      const w = work.find(x => x.key === a.key) as (DoSapNewLine & { _thung?: number; _hop?: number }) | undefined
      const thung = w?._thung ?? 0, hop = w?._hop ?? 0
      if (r === 'error') patchLine(a.key, { lookup: 'error', qty_base: thung + hop })
      else if (r) patchLine(a.key, { material_name: r.short_name, base_unit: r.mat?.base_unit ?? null, mat: r.mat, lookup: 'ok', qty_base: hasEntry(r.mat) ? qtyFromEntryBase(thung, hop, r.mat) : (thung + hop) })
      else patchLine(a.key, { material_name: null, base_unit: null, mat: null, lookup: 'notfound', qty_base: thung + hop })
    }
  }
  // Ô SỐ LƯỢNG dòng thêm mới: dán [Thùng ⇥ Hộp] nhiều dòng → điền xuống các dòng thêm
  function handlePasteQtyAddedAt(startPos: number, e: React.ClipboardEvent<HTMLElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\t')) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
    setAdded(prev => prev.map((l, i) => {
      const off = i - startPos
      if (off < 0 || off >= lines.length) return l
      return { ...l, qty_base: pasteQtyOf(lines[off].split('\t'), l.mat) }
    }))
  }

  async function save() {
    if (!hasOps) return onClose()
    // Chặn trùng Item trong cùng DO — so với TOÀN BỘ dòng đang có (kể cả dòng đánh dấu xóa:
    // xóa có thể BỊ CHẶN ở BE nếu đã dùng+đã quét → create sẽ 409 giữa chừng). Muốn thay dòng
    // cùng Item: xóa + Lưu trước, rồi mở lại thêm.
    const seen = new Set(rows.map(r => `${r.od_number}__${r.od_item}`))
    for (const l of validAdded) {
      const k = `${l.od_number}__${l.od_item.trim()}`
      if (seen.has(k)) { setErrMsg(`Trùng Item ${l.od_item} trong DO ${l.od_number} — đổi số Item (muốn thay dòng cũ: xóa dòng + Lưu trước, rồi thêm lại).`); return }
      seen.add(k)
    }
    setSaving(true); setErrMsg('')
    let blockedNote = ''
    try {
      if (removed.size) {
        const res = await bulkDel.mutateAsync([...removed]) as { deleted: number; blocked_count: number; blocked: { od_number: string; od_item: string; reason: string }[] }
        if (res.blocked_count > 0)
          blockedNote = `${res.blocked_count} dòng KHÔNG xóa được (đã dùng + đã quét): ${res.blocked.slice(0, 3).map(b => `${b.od_number}/${b.od_item}`).join(', ')}${res.blocked.length > 3 ? '…' : ''}`
      }
      // PUT tuần tự (KHÔNG Promise.all): mỗi PUT chạy reconcile đọc-tính-ghi trên OutboundItem;
      // 2 dòng OD cùng đổ vào 1 item (od_refs) mà PUT song song → race mất cập nhật / task trùng.
      for (const r of changed) await update.mutateAsync({ id: r.id, qty_base: draft[r.id] })
      await Promise.all(validAdded.map(l => create.mutateAsync({
        od_number: l.od_number, od_item: l.od_item.trim(),
        material_code: l.material_code.trim(), material_name: l.material_name,
        qty_base: l.qty_base, base_unit: l.base_unit, source: 'MANUAL',
      })))
      if (blockedNote) { setRemoved(new Set()); setAdded([]); setErrMsg(blockedNote) }   // giữ sheet mở để user thấy dòng bị chặn
      else onClose()
    } catch (err) {
      // GIỮ blockedNote khi lỗi giữa chừng — đừng để 409 che mất lý do gốc
      setErrMsg([blockedNote, apiError(err, 'Không lưu được — một phần thay đổi CÓ THỂ đã áp, kiểm tra lại danh sách.')].filter(Boolean).join(' · '))
    } finally { setSaving(false) }
  }

  return (
    <FormSheet
      open onClose={onClose}
      widthClass="sm:w-[96vw] sm:max-w-[1280px]"
      title={multi ? <>Sửa {dos.length} DO</> : <>Sửa DO: <span className="font-mono">{dos[0]}</span></>}
      description={isLoading
        ? 'Đang tải các mã của DO…'
        : <>{multi ? `${dos.length} DO` : (head?.ship_to_name ?? head?.ship_to_code ?? '—')} · {multi ? '' : `Plant ${head?.plant ?? '—'} · `}{rows.length} dòng — sửa Thùng/Hộp, Số gốc tự tính lại (số đi Xuất &amp; mọi module){truncated > 0 ? ` · ⚠ bỏ qua ${truncated} DO vượt giới hạn ${DO_EDITOR_CAP}` : ''}</>}
      footer={<>
        <span className={`text-[11px] sm:mr-auto self-center ${wipesAll ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
          {incomplete ? '⚠ DO quá lớn — chỉ xem, không sửa được ở đây' :
            wipesAll ? `⚠ Lưu sẽ XÓA CẢ ${multi ? `${dos.length} DO` : 'DO'} (đã xóa hết dòng)` :
            hasOps ? `${changed.length} sửa · ${validAdded.length} thêm · ${removed.size} xóa` : 'Chưa có thay đổi'}
        </span>
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Huỷ</Button>
        <Button size="sm" className={`min-w-[90px] ${wipesAll ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`} onClick={save} disabled={saving || !hasOps || incomplete}>
          {saving ? 'Đang lưu…' : wipesAll ? 'Xóa cả DO' : 'Lưu'}
        </Button>
      </>}
    >
      {errMsg && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{errMsg}</div>}
      {incomplete && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠ Có DO vượt {200} dòng — bảng dưới KHÔNG đủ dòng nên đã KHÓA lưu (tránh &quot;xóa cả DO&quot; mà chỉ xóa phần nhìn thấy). Sửa DO này bằng upload lại VL06O.
        </div>
      )}
      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : rows.length === 0 && added.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Không tìm thấy dòng nào của DO này.</p>
      ) : (
        // overflow-auto (cả 2 chiều) + max-h → sticky thead bám đúng scroll container này
        <div className="rounded-lg border border-slate-200 overflow-auto max-h-[62vh]">
          <table className="min-w-max w-full">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-7">#</th>
                {/* Cột DO LUÔN hiện (user 22/07: single/multi hiển thị giống nhau) */}
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-24">DO</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-10">Item</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-24">Mã hàng</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-44">Tên hàng</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-center w-20">Thùng (sửa)</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-center w-20">Hộp (sửa)</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-36">Số gốc (base) · chỉ đọc</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-24">SAP báo</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-24">Batch</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-1 py-1.5 w-14" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const mat = r.mat_units
                const orig = Number(r.qty_base) || 0
                const cur = draft[r.id] ?? orig
                const isRemoved = removed.has(r.id)
                const isChanged = !isRemoved && cur !== orig
                const upc = Number(mat?.units_per_carton)
                const sapMismatch = hasEntry(mat) && r.qty_sales != null && Number(r.qty_sales) * upc !== cur
                const groupStart = multi && idx > 0 && rows[idx - 1].od_number !== r.od_number
                return (
                  <tr key={r.id} className={`border-t ${groupStart ? 'border-slate-300' : 'border-slate-100'} ${isRemoved ? 'bg-red-50/70' : isChanged ? 'bg-amber-50/60' : ''}`}>
                    <td className="px-2 py-1 text-[9px] text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className={`px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap ${isRemoved ? 'line-through text-red-400' : ''}`}>{r.od_number}</td>
                    <td className={`px-2 py-1 text-[10px] font-mono text-slate-500 whitespace-nowrap ${isRemoved ? 'line-through text-red-400' : ''}`}>{r.od_item}</td>
                    <td className={`px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap ${isRemoved ? 'line-through text-red-400' : ''}`}>{r.material_code ?? '—'}</td>
                    {/* 1 dòng KHÔNG wrap, KHÔNG cắt chữ (sheet đã nới rộng để khỏi scroll ngang) */}
                    <td className={`px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap ${isRemoved ? 'line-through text-red-400' : ''}`}>{r.material_name ?? <span className="text-slate-300">—</span>}</td>
                    {/* Số lượng tách 2 cột Thùng | Hộp (nguyên lý y cũ — value/onChange = BASE) */}
                    <td className="px-2 py-1 align-top" onPaste={e => handlePasteQtyAt(idx, e)}>
                      <QtyInput compact part="entry" disabled={isRemoved || !canEdit || incomplete} value={cur} mat={mat} onChange={b => setDraft(prev => ({ ...prev, [r.id]: b }))} />
                    </td>
                    <td className="px-2 py-1 align-top">
                      <QtyInput compact part="base" disabled={isRemoved || !canEdit || incomplete} value={cur} mat={mat} onChange={b => setDraft(prev => ({ ...prev, [r.id]: b }))} />
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {isRemoved ? <span className="text-[10px] text-red-500 font-semibold">Sẽ xóa</span> : <>
                        <div className={`text-[10px] font-semibold tabular-nums ${isChanged ? 'text-amber-700' : 'text-slate-700'}`}>{qtyLabel(cur, mat)}</div>
                        {hasEntry(mat) && <div className="text-[9px] text-slate-400 tabular-nums">= {new Intl.NumberFormat('vi-VN').format(cur)} {r.base_unit || 'base'}{isChanged && <span className="text-amber-600"> (gốc {new Intl.NumberFormat('vi-VN').format(orig)})</span>}</div>}
                        {!hasEntry(mat) && isChanged && <div className="text-[9px] text-amber-600 tabular-nums">gốc {new Intl.NumberFormat('vi-VN').format(orig)}</div>}
                      </>}
                    </td>
                    <td className="px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap tabular-nums">
                      {r.qty_sales != null ? <>{r.qty_sales} {r.sales_unit}{sapMismatch && !isRemoved && <span title={`SAP báo ${r.qty_sales} ${r.sales_unit} ≠ Số gốc — app luôn dùng Số gốc`} className="text-amber-600"> ⚠</span>}</> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-2 py-1 text-[10px] font-mono text-slate-500 whitespace-nowrap">{r.batch ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-1 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {/* Nút sửa chi tiết dòng ĐÃ BỎ (user 22/07) — sửa trực tiếp trên bảng; field raw khác đi theo upload */}
                      {isRemoved ? (
                        <button type="button" className="text-[10px] text-sky-600 hover:underline !min-h-0 !min-w-0"
                          onClick={() => setRemoved(prev => { const n = new Set(prev); n.delete(r.id); return n })}>
                          Hoàn tác
                        </button>
                      ) : canDelete && !incomplete && (
                        <button type="button" className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 !min-h-0 !min-w-0"
                          title="Xóa dòng này (áp khi Lưu)" onClick={() => setRemoved(prev => new Set(prev).add(r.id))}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {/* Dòng THÊM MỚI (chỉ trong editor — thêm DO mới hoàn toàn phải qua UPLOAD) */}
              {added.map((l, ai) => (
                <tr key={l.key} className="border-t border-slate-100 bg-sky-50/60">
                  <td className="px-2 py-1 text-[9px] text-sky-500 font-semibold">+{ai + 1}</td>
                  <td className="px-1 py-1">
                    <select className="h-6 w-full rounded border border-slate-200 px-1 text-[10px] font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      value={l.od_number} onChange={e => patchLine(l.key, { od_number: e.target.value, od_item: '' })}
                      onBlur={() => { if (!l.od_item.trim()) patchLine(l.key, { od_item: nextItem(l.od_number) }) }}>
                      {dos.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <input className="h-6 w-12 rounded border border-slate-200 px-1 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                      value={l.od_item} onChange={e => patchLine(l.key, { od_item: e.target.value })} />
                  </td>
                  <td className="px-1 py-1">
                    {/* Dán block Excel [Mã hàng ⇥ Thùng ⇥ Hộp] nhiều dòng → tự sinh dòng + tra quy cách */}
                    <input className="h-6 w-24 rounded border border-slate-200 px-1.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"
                      placeholder="Mã hàng…" value={l.material_code}
                      onChange={e => patchLine(l.key, { material_code: e.target.value, lookup: 'idle' })}
                      onPaste={e => handlePasteAddedAt(l.key, e)}
                      onBlur={e => lookupMat(l.key, e.target.value)} />
                  </td>
                  <td className="px-2 py-1 text-[10px] text-slate-600 whitespace-nowrap">
                    {l.lookup === 'looking' ? <span className="text-slate-400 italic">Đang tra…</span>
                      : l.lookup === 'notfound' ? <span className="text-amber-600">Không có trong Mã hàng — vẫn lưu được (raw)</span>
                      : l.lookup === 'error' ? <span className="text-red-600">Không tra được Mã hàng (mạng/quyền) — ô số lượng đang hiểu là SỐ BASE</span>
                      : l.material_name ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1 align-top" onPaste={e => handlePasteQtyAddedAt(ai, e)}>
                    <QtyInput compact part="entry" value={l.qty_base} mat={l.mat} onChange={b => patchLine(l.key, { qty_base: b })} />
                  </td>
                  <td className="px-2 py-1 align-top">
                    <QtyInput compact part="base" value={l.qty_base} mat={l.mat} onChange={b => patchLine(l.key, { qty_base: b })} />
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <div className="text-[10px] font-semibold tabular-nums text-sky-700">{qtyLabel(l.qty_base, l.mat)}</div>
                    {hasEntry(l.mat) && <div className="text-[9px] text-slate-400 tabular-nums">= {new Intl.NumberFormat('vi-VN').format(l.qty_base)} {l.base_unit || 'base'}</div>}
                  </td>
                  <td className="px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap">—</td>
                  <td className="px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap">—</td>
                  <td className="px-1 py-1" onClick={e => e.stopPropagation()}>
                    <button type="button" className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 !min-h-0 !min-w-0"
                      title="Bỏ dòng thêm mới" onClick={() => setAdded(prev => prev.filter(x => x.key !== l.key))}>
                      <X className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canCreate && !isLoading && !incomplete && (
        <>
          <button type="button" onClick={addLine}
            className="mt-2 flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 w-full justify-center border border-dashed border-blue-200 rounded-lg py-1.5 hover:border-blue-400">
            <Plus className="h-3 w-3" /> Thêm dòng vào DO {multi ? '(chọn DO trong dòng)' : dos[0]}
          </button>
          {rows.some(r => r.used) && added.length > 0 && (
            <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              ⚠ DO này ĐÃ SINH CHUYẾN — dòng thêm mới chỉ vào tầng raw, CHƯA tự vào chuyến (muốn vào chuyến: up lại KH điều vận).
            </p>
          )}
        </>
      )}
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
  { id: 'do_ready',  label: 'Trong DO SAP' },
  { id: 'status',    label: 'Chuyến' },
  { id: 'source',    label: 'Nguồn' },
  { id: 'updated',   label: 'Cập nhật' },
]
const KH_COL_DEFAULTS = [40, 150, 110, 70, 150, 100, 90, 70, 70, 95, 90, 110, 80, 110]

function TripBadge({ materialized, gdoStatus, gdoDate, exportDate }: { materialized?: boolean; gdoStatus?: string | null; gdoDate?: string | null; exportDate?: string | null }) {
  if (!materialized) {
    return <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700"
      title="KH chưa sinh chuyến, hoặc chuyến đã bị xóa bên Xuất kho — lọc nhanh: Lệch với Xuất → Không còn chuyến">Không có chuyến</span>
  }
  const st = (gdoStatus ?? '').toUpperCase()
  const cls = st === 'COMPLETED' ? 'bg-green-100 text-green-700'
    : st === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700'
    : st === 'PAUSED' ? 'bg-red-100 text-red-700'
    : 'bg-sky-100 text-sky-700'
  const mismatch = !!(gdoDate && exportDate && gdoDate !== exportDate)
  return (
    <div className="leading-tight">
      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`} title={gdoStatus ?? undefined}>Đã sinh</span>
      {mismatch && (
        <div className="text-[9px] text-red-600 font-semibold"
          title="Ngày chuyến bên Xuất khác Ngày xuất KH (chuyến đã được chuyển ngày) — upload KH mới sẽ đè lại theo KH">
          Xuất: {formatDate(gdoDate!)}
        </div>
      )}
    </div>
  )
}

function KhvcTab({ tabBar }: { tabBar: ReactNode }) {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canCreate = can(perms, 'external_khvc', 'create')
  const canEdit   = can(perms, 'external_khvc', 'edit')
  const canDelete = can(perms, 'external_khvc', 'delete')

  const { khvc: f, setKhvc } = useWmsFilterStore()
  const { search, dateFrom, dateTo, warehouse: fWh, vehType: fVeh, source: fSource, group: fGroup, doNo: fDo, inDoSap: fInDoSap, gdoIssue: fGdoIssue, page, pageSize } = f

  const [dense, setDense]         = useState(() => localStorage.getItem('khvc_density') !== 'comfortable')
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [groupEditor, setGroupEditor] = useState<string[] | null>(null)   // sửa cả Số xe — danh sách group_code (bảng gom mọi DO cùng xe)

  const { widths: colW, startResize, totalWidth } = useColumnResize('khvc_col_widths_v2', KH_COL_DEFAULTS)
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
    in_do_sap:      fInDoSap || undefined,
    gdo_issue:      fGdoIssue || undefined,
    page,
    page_size:      pageSize,
  }), [search, dateFrom, dateTo, fWh, fVeh, fSource, fGroup, fDo, fInDoSap, fGdoIssue, page, pageSize])

  const { data, isLoading, isError, error } = useKhvcLines(params, hasDate)
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const doSapWarn = data?.do_sap_filter_warning
  const gdoIssueWarn = data?.gdo_issue_warning

  const filterKey = JSON.stringify({ search, dateFrom, dateTo, fWh, fVeh, fSource, fGroup, fDo, fInDoSap, fGdoIssue, pageSize })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setKhvc({ page: 1 }) }, [filterKey])

  // Map id → group_code của mọi dòng ĐÃ render — cho nút Sửa multi (tick → Sửa cả Số xe)
  const idToGroup = useRef<Record<string, string>>({})
  useEffect(() => { for (const r of items) idToGroup.current[r.id] = r.group_code }, [items])

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
    { key: 'inDoSap', label: 'Trong DO SAP', type: 'single', allLabel: 'Tất cả', value: fInDoSap,
      options: [{ value: '1', label: 'Có trong DO SAP' }, { value: '0', label: 'Chưa có trong DO SAP' }],
      onChange: v => setKhvc({ inDoSap: v === '__all__' ? '' : v }) },
    { key: 'gdoIssue', label: 'Lệch với Xuất', type: 'single', allLabel: 'Tất cả', value: fGdoIssue,
      options: [{ value: 'missing', label: 'Không còn chuyến' }, { value: 'date_mismatch', label: 'Lệch ngày xuất' }],
      onChange: v => setKhvc({ gdoIssue: v === '__all__' ? '' : v }) },
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
  // Sửa các dòng đã tick → mở bảng gom theo Số xe
  const selectedGroups = useMemo(
    () => [...new Set([...selected].map(id => idToGroup.current[id]).filter(Boolean))],
    [selected, items],
  )

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">

      {tabBar}

      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={search} onChange={v => setKhvc({ search: v })}
            placeholder="Tìm Số xe, DO, NPP…" className="flex-1 min-w-[140px]" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
          <button type="button" onClick={() => { localStorage.setItem('khvc_density', dense ? 'comfortable' : 'compact'); setDense(d => !d) }}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors shrink-0"
            title={dense ? 'Đang: dày · bấm để thoáng' : 'Đang: thoáng · bấm để dày'}>
            {dense ? <AlignJustify className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
          </button>
          {/* Action theo selection đặt NGAY TRÊN HEADER (user 22/07) — không chèn bar hiện/ẩn làm bảng nhảy layout */}
          {selected.size > 0 && (canEdit || canCreate) && selectedGroups.length > 0 && (
            <button type="button" onClick={() => setGroupEditor(selectedGroups)}
              className="inline-flex items-center gap-1 h-9 sm:h-7 px-2 rounded border border-sky-300 bg-sky-50 text-xs text-sky-700 hover:bg-sky-100 transition-colors shrink-0">
              <Pencil className="h-3.5 w-3.5" /> Sửa {selectedGroups.length > 1 ? `${selectedGroups.length} Số xe` : `xe ${selectedGroups[0]}`}
            </button>
          )}
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1 h-9 sm:h-7 px-2 rounded border border-slate-200 text-xs text-slate-500 hover:bg-slate-50 transition-colors shrink-0">
              <X className="h-3.5 w-3.5" /> Bỏ chọn ({selected.size})
            </button>
          )}
          {/* Thêm mới hoàn toàn = UPLOAD (KH điều vận), không thêm tay ngoài header — user chốt 21/07.
              Thêm DO vào Số xe đã có: tick dòng → Sửa → nút "+ Thêm dòng" trong editor.
              Xóa dòng: CHỈ trong editor (user 22/07 bỏ Xóa bulk ngoài list). */}
        </div>
        <FilterBar defs={filterDefs} />
        {doSapWarn && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{doSapWarn}</div>}
        {gdoIssueWarn && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{gdoIssueWarn}</div>}
      </div>

      <SummaryBand tiles={[
        { label: 'Tổng dòng', value: total.toLocaleString('vi-VN') },
        { label: 'Đang chọn', value: selected.size, accent: selected.size > 0 },
        { label: 'Trang', value: `${page}/${totalPages}` },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!hasDate ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-slate-400">
            <Database className="h-10 w-10 opacity-30" />
            <p className="text-sm font-medium text-slate-500">Chọn khoảng <b>Ngày nạp</b> để xem dữ liệu</p>
            <p className="text-xs">Kế hoạch vừa upload nằm ở <b>Ngày nạp = hôm nay</b> (tránh tải toàn bộ bảng nên phải chọn ngày).</p>
            <Button size="sm" className="mt-2 h-8 bg-blue-600 hover:bg-blue-700" onClick={() => setKhvc({ dateFrom: TODAY_VN(), dateTo: TODAY_VN() })}>
              Xem hôm nay
            </Button>
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
                    <TableCell className={`px-2 ${cellPad} text-[10px] font-mono whitespace-nowrap`}>
                      {r.do_no || <span className="text-slate-300">—</span>}
                      {r.manual_edited_at && (
                        <span className="ml-1 text-amber-600 font-sans" title={`Đã sửa tay ${formatTimestampDate(r.manual_edited_at, true)} — upload lại KH điều vận sẽ đè theo file`}>✎</span>
                      )}
                    </TableCell>
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
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}><TripBadge materialized={r.materialized} gdoStatus={r.gdo_status} gdoDate={r.gdo_date} exportDate={r.export_date} /></TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}><SourceBadge source={r.source} /></TableCell>
                    <TableCell className={`px-2 ${cellPad} whitespace-nowrap`}>
                      <div className="leading-tight">
                        <div className="text-[10px] text-slate-600">{r.uploaded_by ?? <span className="text-slate-300">—</span>}</div>
                        <div className="text-[9px] text-slate-400">{r.updated_at ? formatTimestampDate(r.updated_at, true) : ''}</div>
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

      {/* FormSheet Sửa cả Số xe — bảng gom mọi DO cùng group_code.
          Xóa dòng: CHỈ trong editor này (bỏ Xóa bulk ngoài list — user 22/07). */}
      {groupEditor && (
        <KhvcGroupEditor
          groupCodes={groupEditor}
          canEdit={canEdit}
          canCreate={canCreate}
          canDelete={canDelete}
          onClose={() => { setGroupEditor(null); setSelected(new Set()) }}
        />
      )}
    </div>
  )
}

// ─── Sửa cả Số xe (bảng gom mọi DO cùng group_code) — mirror DoSapDoEditor ────
// Mở như 1 chứng từ điều vận: mỗi dòng = 1 DO trên xe; sửa inline mọi field điều vận;
// thêm DO vào xe / xóa DO khỏi xe ngay trong bảng; xóa hết dòng + Lưu = XÓA CẢ SỐ XE.
const KHVC_FIELDS = ['warehouse_code', 'npp', 'veh_type', 'dvvt', 'priority', 'cs', 'export_date', 'note'] as const
type KhvcDraft = Record<(typeof KHVC_FIELDS)[number], string>
type KhvcNewLine = KhvcDraft & { key: string; group_code: string; do_no: string }
const khvcDraftOf = (r: KhvcRow): KhvcDraft => ({
  warehouse_code: s(r.warehouse_code), npp: s(r.npp), veh_type: s(r.veh_type), dvvt: s(r.dvvt),
  priority: s(r.priority), cs: s(r.cs), export_date: s(r.export_date), note: s(r.note),
})
function KhvcGroupEditor({ groupCodes, canEdit, canCreate, canDelete, onClose }: {
  groupCodes: string[]
  canEdit: boolean
  canCreate: boolean
  canDelete: boolean
  onClose: () => void
}) {
  const groups = useMemo(() => [...new Set(groupCodes)].slice(0, DO_EDITOR_CAP), [groupCodes])
  const truncated = new Set(groupCodes).size - groups.length
  const multi = groups.length > 1
  // Khớp CHÍNH XÁC group_code + phát hiện nhóm >200 dòng (trần page_size) → KHÓA lưu (không xóa thiếu)
  const { data: fetched, isLoading } = useQuery({
    queryKey: ['khvc', 'group-editor', groups],
    queryFn: async () => {
      const results = await Promise.all(groups.map(g =>
        apiClient.get(`/external/khvc?group_code_eq=${encodeURIComponent(g)}&page_size=200`)
          .then(r => {
            const d = r.data.data as { items: KhvcRow[]; total: number }
            return { items: d.items.filter(x => x.group_code === g), total: d.total }
          })
      ))
      return { rows: results.flatMap(r => r.items), incomplete: results.some(r => r.total > r.items.length) }
    },
  })
  const incomplete = fetched?.incomplete ?? false
  const rows = useMemo(() =>
    [...(fetched?.rows ?? [])].sort((a, b) => a.group_code.localeCompare(b.group_code) || a.do_no.localeCompare(b.do_no)),
  [fetched])

  const update = useUpdateKhvc()
  const create = useCreateKhvc()
  const bulkDel = useBulkDeleteKhvc()
  const [draft, setDraft] = useState<Record<string, KhvcDraft>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [added, setAdded] = useState<KhvcNewLine[]>([])
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  useEffect(() => {
    setDraft(prev => {
      const next = { ...prev }
      for (const r of rows) if (!(r.id in next)) next[r.id] = khvcDraftOf(r)
      return next
    })
  }, [rows])

  const remaining = rows.filter(r => !removed.has(r.id))
  const isRowChanged = (r: KhvcRow) => {
    const d = draft[r.id]
    if (!d) return false
    const o = khvcDraftOf(r)
    return KHVC_FIELDS.some(k => d[k] !== o[k])
  }
  const changed = remaining.filter(isRowChanged)
  const validAdded = added.filter(l => l.do_no.trim() !== '')
  const wipesAll = rows.length > 0 && remaining.length === 0 && validAdded.length === 0
  const hasOps = changed.length > 0 || validAdded.length > 0 || removed.size > 0

  function addLine() {
    const g = groups[0]
    const base = rows.find(r => r.group_code === g)
    setAdded(prev => [...prev, {
      key: crypto.randomUUID(), group_code: g, do_no: '',
      warehouse_code: s(base?.warehouse_code), npp: '', veh_type: s(base?.veh_type), dvvt: s(base?.dvvt),
      priority: '', cs: s(base?.cs), export_date: s(base?.export_date), note: '',
    }])
  }
  const patchLine = (key: string, p: Partial<KhvcNewLine>) =>
    setAdded(prev => prev.map(l => l.key === key ? { ...l, ...p } : l))
  const setCell = (id: string, k: (typeof KHVC_FIELDS)[number], v: string) =>
    setDraft(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }))

  // ── Paste từ Excel (chuẩn app — mẫu form Xuất kho): dán block nhiều dòng × nhiều cột
  // vào Ô BẤT KỲ → điền sang phải theo thứ tự cột bảng + xuống dưới theo thứ tự dòng ──
  function pasteDate(v: string): string {
    const t = v.trim()
    const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)   // Excel VN: dd/mm/yyyy
    if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''
  }
  const pasteVal = (f: (typeof KHVC_FIELDS)[number], v: string) => f === 'export_date' ? pasteDate(v) : v.trim()
  function handlePasteAt(startIdx: number, fieldIdx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\t')) return   // dán 1 ô đơn lẻ → để input tự xử
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
    setDraft(prev => {
      const next = { ...prev }
      lines.forEach((line, off) => {
        const r = rows[startIdx + off]
        if (!r || removed.has(r.id)) return
        const cur = { ...(next[r.id] ?? khvcDraftOf(r)) }
        line.split('\t').forEach((v, c) => {
          const f = KHVC_FIELDS[fieldIdx + c]
          if (f) cur[f] = pasteVal(f, v)
        })
        next[r.id] = cur
      })
      return next
    })
  }
  // Dòng thêm mới: dán vào ô DO = block [DO ⇥ Kho ⇥ NPP ⇥ Loại xe ⇥ ĐVVT ⇥ Ưu tiên ⇥ CS ⇥ Ngày xuất ⇥ Ghi chú]
  // → điền dòng này + TỰ SINH thêm dòng cho phần dư (prefill theo xe đang chọn)
  function handlePasteAddedDoAt(startKey: string, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\t')) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
    setAdded(prev => {
      const work = [...prev]
      const startPos = work.findIndex(l => l.key === startKey)
      if (startPos < 0) return prev
      const g = work[startPos].group_code
      const base = rows.find(r => r.group_code === g)
      lines.forEach((line, off) => {
        let pos = startPos + off
        if (pos >= work.length) {
          work.push({ key: crypto.randomUUID(), group_code: g, do_no: '',
            warehouse_code: s(base?.warehouse_code), npp: '', veh_type: s(base?.veh_type), dvvt: s(base?.dvvt),
            priority: '', cs: s(base?.cs), export_date: s(base?.export_date), note: '' })
          pos = work.length - 1
        }
        const cols = line.split('\t')
        const p: Partial<KhvcNewLine> = { do_no: (cols[0] ?? '').trim() }
        cols.slice(1).forEach((v, c) => {
          const f = KHVC_FIELDS[c]
          if (f && v.trim() !== '') p[f] = pasteVal(f, v)
        })
        work[pos] = { ...work[pos], ...p }
      })
      return work
    })
  }
  // Dòng thêm mới: dán vào ô field bất kỳ → điền sang phải + xuống các dòng thêm bên dưới
  function handlePasteAddedFieldAt(startPos: number, fieldIdx: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\t')) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
    setAdded(prev => prev.map((l, i) => {
      const off = i - startPos
      if (off < 0 || off >= lines.length) return l
      const p: Partial<KhvcNewLine> = {}
      lines[off].split('\t').forEach((v, c) => {
        const f = KHVC_FIELDS[fieldIdx + c]
        if (f) p[f] = pasteVal(f, v)
      })
      return { ...l, ...p }
    }))
  }

  async function save() {
    if (!hasOps) return onClose()
    // So trùng với TOÀN BỘ dòng (kể cả dòng đánh dấu xóa — xóa có thể bị BE chặn khi chuyến đã quét)
    const seen = new Set(rows.map(r => `${r.group_code}__${r.do_no}`))
    for (const l of validAdded) {
      const k = `${l.group_code}__${l.do_no.trim()}`
      if (seen.has(k)) { setErrMsg(`Trùng DO ${l.do_no} trong Số xe ${l.group_code} (muốn thay dòng cũ: xóa + Lưu trước, rồi thêm lại).`); return }
      seen.add(k)
    }
    setSaving(true); setErrMsg('')
    let blockedNote = ''
    try {
      if (removed.size) {
        const res = await bulkDel.mutateAsync([...removed]) as { deleted: number; blocked_count: number; blocked: { group_code: string; reason: string }[] }
        if (res.blocked_count > 0)
          blockedNote = `${res.blocked_count} dòng KHÔNG xóa được (chuyến đã quét): ${res.blocked.slice(0, 3).map(b => b.group_code).join(', ')}${res.blocked.length > 3 ? '…' : ''}`
      }
      await Promise.all([
        ...changed.map(r => {
          const d = draft[r.id]
          return update.mutateAsync({
            id: r.id,
            group_code: r.group_code, do_no: r.do_no,
            warehouse_code: n(d.warehouse_code), npp: n(d.npp), veh_type: n(d.veh_type), dvvt: n(d.dvvt),
            priority: n(d.priority), cs: n(d.cs), export_date: n(d.export_date), note: n(d.note),
          })
        }),
        ...validAdded.map(l => create.mutateAsync({
          group_code: l.group_code, do_no: l.do_no.trim(),
          warehouse_code: n(l.warehouse_code), npp: n(l.npp), veh_type: n(l.veh_type), dvvt: n(l.dvvt),
          priority: n(l.priority), cs: n(l.cs), export_date: n(l.export_date), note: n(l.note), source: 'MANUAL',
        })),
      ])
      if (blockedNote) { setRemoved(new Set()); setAdded([]); setErrMsg(blockedNote) }
      else onClose()
    } catch (err) {
      setErrMsg([blockedNote, apiError(err, 'Không lưu được — một phần thay đổi CÓ THỂ đã áp, kiểm tra lại danh sách.')].filter(Boolean).join(' · '))
    } finally { setSaving(false) }
  }

  // Ô nhập inline trong bảng editor
  const inputCls = 'h-6 w-full rounded border border-slate-200 px-1.5 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-400'
  return (
    <FormSheet
      open onClose={onClose}
      widthClass="sm:w-[96vw] sm:max-w-[1280px]"
      title={multi ? <>Sửa {groups.length} Số xe</> : <>Sửa Số xe: <span className="font-mono">{groups[0]}</span></>}
      description={isLoading
        ? 'Đang tải các DO của xe…'
        : <>{rows.length} DO — sửa trực tiếp trong bảng; thêm/xóa DO của xe tại đây{truncated > 0 ? ` · ⚠ bỏ qua ${truncated} Số xe vượt giới hạn ${DO_EDITOR_CAP}` : ''}</>}
      footer={<>
        <span className={`text-[11px] sm:mr-auto self-center ${wipesAll ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
          {incomplete ? '⚠ Số xe quá lớn — chỉ xem, không sửa được ở đây' :
            wipesAll ? `⚠ Lưu sẽ XÓA CẢ ${multi ? `${groups.length} Số xe` : 'Số xe'} (đã xóa hết dòng)` :
            hasOps ? `${changed.length} sửa · ${validAdded.length} thêm · ${removed.size} xóa` : 'Chưa có thay đổi'}
        </span>
        <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Huỷ</Button>
        <Button size="sm" className={`min-w-[90px] ${wipesAll ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`} onClick={save} disabled={saving || !hasOps || incomplete}>
          {saving ? 'Đang lưu…' : wipesAll ? 'Xóa cả Số xe' : 'Lưu'}
        </Button>
      </>}
    >
      {errMsg && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{errMsg}</div>}
      {incomplete && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠ Có Số xe vượt 200 dòng — bảng dưới KHÔNG đủ dòng nên đã KHÓA lưu (tránh &quot;xóa cả Số xe&quot; mà chỉ xóa phần nhìn thấy). Sửa bằng upload lại KH điều vận.
        </div>
      )}
      {wipesAll && rows.some(r => r.materialized) && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠ Số xe này ĐÃ SINH CHUYẾN ở Xuất kho — xóa kế hoạch KHÔNG xóa chuyến; muốn hủy chuyến hãy xóa ở trang Xuất kho.
        </div>
      )}
      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : rows.length === 0 && added.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Không tìm thấy dòng nào của Số xe này.</p>
      ) : (
        <div className="rounded-lg border border-slate-200 overflow-auto max-h-[62vh]">
          <table className="min-w-max w-full">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-7">#</th>
                {/* Cột Số xe LUÔN hiện (user 22/07: single/multi hiển thị giống nhau) */}
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-32">Số xe</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-24">DO</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-20">Kho</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-32">NPP</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-24">Loại xe</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-24">ĐVVT</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-16">Ưu tiên</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-16">CS</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-28">Ngày xuất</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-[9px] font-medium text-slate-500 text-left w-28">Ghi chú</th>
                <th className="sticky top-0 z-10 bg-slate-50 px-1 py-1.5 w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const d = draft[r.id] ?? khvcDraftOf(r)
                const isRemoved = removed.has(r.id)
                const isChanged = !isRemoved && isRowChanged(r)
                const groupStart = multi && idx > 0 && rows[idx - 1].group_code !== r.group_code
                return (
                  <tr key={r.id} className={`border-t ${groupStart ? 'border-slate-300' : 'border-slate-100'} ${isRemoved ? 'bg-red-50/70' : isChanged ? 'bg-amber-50/60' : ''}`}>
                    <td className="px-2 py-1 text-[9px] text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className={`px-2 py-1 text-[10px] font-mono font-semibold whitespace-nowrap ${isRemoved ? 'line-through text-red-400' : ''}`}>{r.group_code}</td>
                    <td className={`px-2 py-1 text-[10px] font-mono whitespace-nowrap ${isRemoved ? 'line-through text-red-400' : 'font-semibold'}`}>{r.do_no}</td>
                    {/* 8 field theo đúng thứ tự cột — dán block Excel vào ô bất kỳ điền sang phải + xuống dưới */}
                    {KHVC_FIELDS.map((fld, fi) => (
                      <td key={fld} className="px-1 py-1">
                        <input type={fld === 'export_date' ? 'date' : 'text'} className={inputCls}
                          disabled={isRemoved || !canEdit || incomplete}
                          value={d[fld]} onChange={e => setCell(r.id, fld, e.target.value)}
                          onPaste={e => handlePasteAt(idx, fi, e)} />
                      </td>
                    ))}
                    <td className="px-1 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {isRemoved ? (
                        <button type="button" className="text-[10px] text-sky-600 hover:underline !min-h-0 !min-w-0"
                          onClick={() => setRemoved(prev => { const nn = new Set(prev); nn.delete(r.id); return nn })}>
                          Hoàn tác
                        </button>
                      ) : canDelete && !incomplete && (
                        <button type="button" className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 !min-h-0 !min-w-0"
                          title="Xóa DO khỏi xe (áp khi Lưu)" onClick={() => setRemoved(prev => new Set(prev).add(r.id))}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {added.map((l, ai) => (
                <tr key={l.key} className="border-t border-slate-100 bg-sky-50/60">
                  <td className="px-2 py-1 text-[9px] text-sky-500 font-semibold">+{ai + 1}</td>
                  <td className="px-1 py-1">
                    <select className={`${inputCls} font-mono`} value={l.group_code}
                      onChange={e => {
                        // Đổi Số xe → NẠP LẠI prefill (kho/loại xe/ĐVVT/CS/ngày xuất) theo xe MỚI —
                        // không thì dòng mới mang kho/ngày của xe cũ (sai lệch chéo xe)
                        const g = e.target.value
                        const base = rows.find(r => r.group_code === g)
                        patchLine(l.key, {
                          group_code: g,
                          warehouse_code: s(base?.warehouse_code), veh_type: s(base?.veh_type),
                          dvvt: s(base?.dvvt), cs: s(base?.cs), export_date: s(base?.export_date),
                        })
                      }}>
                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    {/* Dán block Excel [DO ⇥ Kho ⇥ NPP ⇥ Loại xe ⇥ ĐVVT ⇥ Ưu tiên ⇥ CS ⇥ Ngày xuất ⇥ Ghi chú] → tự sinh dòng */}
                    <input className={`${inputCls} font-mono`} placeholder="Số DO…" value={l.do_no}
                      onChange={e => patchLine(l.key, { do_no: e.target.value })}
                      onPaste={e => handlePasteAddedDoAt(l.key, e)} />
                  </td>
                  {KHVC_FIELDS.map((fld, fi) => (
                    <td key={fld} className="px-1 py-1">
                      <input type={fld === 'export_date' ? 'date' : 'text'} className={inputCls}
                        value={l[fld]} onChange={e => patchLine(l.key, { [fld]: e.target.value })}
                        onPaste={e => handlePasteAddedFieldAt(ai, fi, e)} />
                    </td>
                  ))}
                  <td className="px-1 py-1" onClick={e => e.stopPropagation()}>
                    <button type="button" className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 !min-h-0 !min-w-0"
                      title="Bỏ dòng thêm mới" onClick={() => setAdded(prev => prev.filter(x => x.key !== l.key))}>
                      <X className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canCreate && !isLoading && !incomplete && (
        <button type="button" onClick={addLine}
          className="mt-2 flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 w-full justify-center border border-dashed border-blue-200 rounded-lg py-1.5 hover:border-blue-400">
          <Plus className="h-3 w-3" /> Thêm DO vào xe {multi ? '(chọn Số xe trong dòng)' : groups[0]}
        </button>
      )}
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
