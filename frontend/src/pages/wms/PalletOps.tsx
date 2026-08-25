import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, Scissors, Search, X, Plus, Trash2, AlertTriangle, CheckCircle2, History, RotateCcw, Printer } from 'lucide-react'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Button } from '@/components/ui/button'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QRScanDialog } from '@/components/shared/QRScanDialog'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { LocationScanButton } from '@/components/wms/LocationScanButton'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { PagerNav, ListFooter } from '@/components/shared/ListPager'
import { PalletPrintArea, PALLET_PRINT_CSS, qrToLabel, type LabelData } from '@/components/shared/palletLabel'
import {
  useInventoryEntries, useMergePallets, useUngroupPallets, useSplitPallet, useLogPalletPrints,
  usePalletOps, usePalletOpsPaged, useUndoPalletOp, useMaterials, useMaterialsByCodes, useWarehouses, useLocationsReal, useLocationsByIds, type LocationLite, type PalletOpRow, type MaterialLite,
} from '@/api/hooks'
import { useScopedWhTypes } from '@/hooks/useUserScope'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { materialCodeOf } from '@/utils/qr'
import type { Material } from '@/types'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { qtyLabel } from '@/utils/qtyUnits'
import { QtyInput } from '@/components/shared/QtyInput'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

type Tab = 'merge' | 'split' | 'history'

export default function PalletOps() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canMerge   = can(perms, 'pallet_ops', 'merge')
  const canUngroup = can(perms, 'pallet_ops', 'ungroup')
  const canSplit   = can(perms, 'pallet_ops', 'split')
  const canMergeTab = canMerge || canUngroup   // tab Dồn gồm dồn (merge) + gỡ nhóm (ungroup)
  // In tem chạm module In tem pallet (logPrints) → gate đúng quyền pallet_print theo mode
  const canGenLabel     = can(perms, 'pallet_print', 'generate')   // in tem con vừa tách (sinh mới)
  const canReprintLabel = can(perms, 'pallet_print', 'reprint')    // in lại tem từ lịch sử

  const [params] = useSearchParams()
  const initTab = params.get('tab') as Tab
  const [tab, setTab] = useState<Tab>(() => {
    if (initTab === 'split' && canSplit) return 'split'
    if (initTab === 'history') return 'history'
    return canMergeTab ? 'merge' : canSplit ? 'split' : 'history'   // tab đầu tiên có quyền
  })
  const [scanFor, setScanFor] = useState<null | 'target' | 'child' | 'source' | 'history'>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Kho + Loại kho (chọn trước — scope thao tác vào đúng kho, mỗi kho 1 tem unique) ──
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes = [] } = useScopedWhTypes()
  const categoryOpts = (whTypes as { value: string }[]).map(t => t.value)
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length ? new Set(user.warehouse_ids) : null
  const whOptions = (warehouses as any[]).filter(w => !allowedWhIds || allowedWhIds.has(w.id))
  // Lưu/khôi phục lựa chọn Kho + Loại kho (không phải chọn lại) — bối cảnh toàn cục ở Header
  // (nếu đang chọn) ưu tiên hơn giá trị đã nhớ của trang
  const SCOPE = useMemo<{ opWh?: string; opCat?: string }>(() => { try { return JSON.parse(localStorage.getItem('palletOps_scope') || '{}') } catch { return {} } }, [])
  const gScope = useGlobalScopeStore.getState()
  const gOpWh = gScope.warehouseId && (!allowedWhIds || allowedWhIds.has(gScope.warehouseId)) ? gScope.warehouseId : ''
  const [opWh, setOpWh]   = useState<string>(gOpWh || SCOPE.opWh || (allowedWhIds ? [...allowedWhIds][0] : ''))
  const [opCat, setOpCat] = useState<string>(gScope.whType || SCOPE.opCat || '')
  useEffect(() => { try { localStorage.setItem('palletOps_scope', JSON.stringify({ opWh, opCat })) } catch { /* ignore */ } }, [opWh, opCat])
  const scopeReady = !!(opWh && opCat)   // bắt buộc đủ Kho + Loại kho mới cho quét/thao tác

  // ── Dồn ──
  const [mergeTarget, setMergeTarget] = useState(params.get('target') ?? '')
  const [childInput, setChildInput]   = useState('')
  const [mergeChildren, setMergeChildren] = useState<string[]>(() => (params.get('children') ?? '').split(',').map(c => c.trim()).filter(Boolean))
  const merge = useMergePallets()
  const ungroup = useUngroupPallets()
  function addChild(code: string) {
    const c = code.trim()
    if (!c || c === mergeTarget || mergeChildren.includes(c)) return
    setMergeChildren(p => [...p, c]); setChildInput('')
  }
  // Gồm cả mã đang gõ dở trong ô (chưa Enter) để không "quên" pallet con
  const allChildren = useMemo(() => {
    const pend = childInput.trim()
    const list = [...mergeChildren]
    if (pend && pend !== mergeTarget.trim() && !list.includes(pend)) list.push(pend)
    return list
  }, [mergeChildren, childInput, mergeTarget])
  async function doMerge() {
    setMsg(null)
    if (!scopeReady) { setMsg({ ok: false, text: 'Chọn Kho và Loại kho trước khi dồn' }); return }
    try {
      const r = await merge.mutateAsync({ target_pallet_code: mergeTarget.trim(), child_pallet_codes: allChildren, warehouse_id: opWh })
      // Luật cất mức CẢNH BÁO: cho dồn nhưng phải nói ra (BE trả putaway_warning)
      setMsg({ ok: true, text: `Đã dồn ${r.merged} pallet vào ${r.target}${(r as { putaway_warning?: string | null }).putaway_warning ? ` — ⚠ ${(r as { putaway_warning?: string | null }).putaway_warning}` : ''}` })
      setMergeChildren([]); setChildInput('')
    } catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Lỗi dồn pallet' }) }
  }

  // ── Tách ──
  const [splitSrc, setSplitSrc] = useState(params.get('source') ?? '')
  const [splitQtys, setSplitQtys] = useState<string[]>([''])
  const srcQ = splitSrc.trim()
  // Lookup pallet gốc — scope theo Kho + Loại kho đã chọn (mỗi kho 1 tem unique)
  const { data: srcData } = useInventoryEntries({
    warehouse_ids: opWh ? [opWh] : undefined,
    categories: opCat ? [opCat] : undefined,
    search: srcQ.length >= 3 ? srcQ : undefined, status: '', page: 1, limit: 5,
  })
  const srcEntry = useMemo(() => (srcData?.entries ?? []).find(e => e.pallet_code === srcQ) as any, [srcData, srcQ])
  const remaining = Number(srcEntry?.cartons_remaining ?? 0)
  const reserved  = Number(srcEntry?.cartons_reserved ?? 0)
  const free = remaining - reserved
  const totalSplit = splitQtys.reduce((s, q) => s + (Number(q) || 0), 0)
  const keepLeft = remaining - totalSplit
  const split = useSplitPallet()
  const logPrints = useLogPalletPrints()
  const [printLabels, setPrintLabels] = useState<LabelData[]>([])
  // Vị trí pallet con — danh sách theo Kho + Loại hàng; mặc định = vị trí pallet gốc
  const [splitLoc, setSplitLoc] = useState('')
  // TÌM TRÊN SERVER (luật danh mục lớn): trước nạp TOÀN BỘ vị trí của kho (Bàu Bàng 1.517 = 616KB)
  const [splitLocTerm, setSplitLocTerm] = useState('')
  const splitLocDeb = useDebouncedValue(splitLocTerm, 250)
  const { data: splitLocs = [] } = useLocationsReal({
    warehouse_id: opWh || undefined, category: opCat || undefined,
    search: splitLocDeb || undefined, limit: 50,
  })
  // nhãn cho vị trí ĐANG CHỌN (không nằm trong 50 dòng khớp từ khoá hiện tại)
  const { data: splitLocPicked = [] } = useLocationsByIds([splitLoc])
  useEffect(() => { if (srcEntry?.location_id) setSplitLoc(srcEntry.location_id) }, [srcEntry?.location_id])
  // Các pallet con ĐÃ tách trước đó từ chính pallet gốc này (để user biết lịch sử tách của nó)
  const { data: srcOps = [] } = usePalletOps({ search: srcQ, type: 'SPLIT' }, tab === 'split' && srcQ.length >= 3)
  const srcSplitChildren = useMemo(() =>
    srcOps.filter(o => !o.undone_at && (o.source_codes ?? []).includes(srcQ))
      .flatMap(o => (o.detail?.children ?? []).map((c: any) => ({ code: c.code as string, qty: c.qty as number, at: o.created_at }))),
    [srcOps, srcQ])

  // ── Lịch sử dồn/tách + tìm kiếm + hoàn tác ──
  const [hSearch, setHSearch] = useState('')
  const [hType, setHType]     = useState('')   // '' | MERGE | SPLIT | UNGROUP
  const [hFrom, setHFrom]     = useState('')
  const [hTo, setHTo]         = useState('')
  const [hPage, setHPage]         = useState(1)
  const [hPageSize, setHPageSize] = useState(200)
  // Đổi bất kỳ bộ lọc nào → về trang 1 (không thì đang ở trang 30 mà lọc còn 2 trang = bảng trống)
  const resetPage = () => setHPage(1)
  // Lịch sử PHÂN TRANG SERVER: đường cũ cắt âm thầm ở 5.000 thao tác. Loại kho gửi xuống server
  // (lọc ở client sau khi phân trang = lọc trên đúng 1 trang, ô tổng cũng sai).
  const { data: hist, isFetching: histLoading } = usePalletOpsPaged(
    {
      search: hSearch.trim() || undefined, type: hType || undefined, category: opCat || undefined,
      warehouse_id: opWh || undefined, date_from: hFrom || undefined, date_to: hTo || undefined,
      page: hPage, page_size: hPageSize,
    },
    tab === 'history' && !!opWh,
  )
  const ops = hist?.items ?? []
  const undo = useUndoPalletOp()
  const opCols = useColumnResize('palletOps_col_widths', [150, 78, 180, 180, 150, 80, 100, 100, 110])
  const opLabel = (t: string) => t === 'MERGE' ? 'Dồn' : t === 'SPLIT' ? 'Tách' : t === 'UNGROUP' ? 'Gỡ nhóm' : t
  const canUndo = canMerge || canUngroup || canSplit
  // Filter Lịch sử kiểu Manhattan (chip + sheet mobile) — Kho/Loại kho là scope riêng ở hàng trên
  const histDefs: FilterDef[] = [
    { key: 'type', label: 'Loại thao tác', type: 'single', value: hType, onChange: v => { setHType(v); resetPage() }, allLabel: 'Tất cả', options: [{ value: 'MERGE', label: 'Dồn' }, { value: 'SPLIT', label: 'Tách' }, { value: 'UNGROUP', label: 'Gỡ nhóm' }] },
    { key: 'date', label: 'Khoảng ngày', type: 'daterange', from: hFrom, to: hTo, onChange: (f, t) => { setHFrom(f); setHTo(t); resetPage() } },
  ]
  // In tem từ Lịch sử (tách rồi chưa in được ngay → vào đây in)
  // Chỉ tra ĐÚNG các mã xuất hiện trong lịch sử đang xem (trước đây nạp cả danh mục mã hàng
  // về trình duyệt chỉ để lấy tên + hệ số thùng/hộp cho vài chục dòng).
  const histCodes = useMemo(() => [...new Set(
    ops.flatMap(o => [...(o.target_codes ?? []), ...(o.source_codes ?? [])].map(c => materialCodeOf(c)))
      .filter((c): c is string => !!c)
  )], [ops])
  const { data: allMats = [] } = useMaterialsByCodes(histCodes, tab === 'history')
  const matByCode = useMemo(() => { const m = new Map<string, MaterialLite>(); for (const x of allMats) m.set(x.material_code, x); return m }, [allMats])
  function printOp(o: PalletOpRow) {
    const qtyByCode = new Map<string, number>()
    for (const c of (o.detail?.children ?? []) as { code: string; qty: number }[]) qtyByCode.set(c.code, c.qty)
    const labels = (o.target_codes ?? []).map(code => qrToLabel(code, matByCode.get(materialCodeOf(code)), qtyByCode.get(code) ?? null))
    printTems(labels, 'REPRINT')
  }
  async function doUndo(o: PalletOpRow) {
    setMsg(null)
    try { await undo.mutateAsync(o.id); setMsg({ ok: true, text: `Đã hoàn tác thao tác ${opLabel(o.type)}` }) }
    catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Không hoàn tác được' }) }
  }

  const [splitDone, setSplitDone] = useState<LabelData[] | null>(null)   // tem con vừa tách — chờ in (có thể in ngay hoặc in sau ở Lịch sử)
  function printTems(labels: LabelData[], mode: 'GENERATE' | 'REPRINT') {
    if (!labels.length) return
    logPrints.mutate({
      mode,
      labels: labels.map(l => ({ qr_code: l.qr, material_code: l.materialCode, material_id: l.materialId ?? null, category: l.category, cycle: l.cycle, machine: l.machine, seq: l.seq, nmsx: l.nmsx, qty: l.qty === '' ? null : l.qty })),
    })
    setPrintLabels(labels)
    setTimeout(() => window.print(), 150)
  }
  async function doSplit() {
    setMsg(null); setSplitDone(null)
    if (!scopeReady) { setMsg({ ok: false, text: 'Chọn Kho và Loại kho trước khi tách' }); return }
    const children = splitQtys.map(q => Number(q) || 0).filter(q => q > 0).map(qty => ({ qty }))
    try {
      const res = await split.mutateAsync({ source_pallet_code: srcQ, children, warehouse_id: opWh, location_id: splitLoc || undefined })
      const labels = res.children.map((c: any) => qrToLabel(c.pallet_code, srcEntry?.material, c.cartons_remaining))
      setSplitDone(labels)   // KHÔNG tự in — chờ người dùng bấm "In tem" (hoặc in sau ở tab Lịch sử)
      setMsg({ ok: true, text: `Đã tách ${labels.length} pallet con (gốc còn ${qtyLabel(Number(res.source_remaining), srcEntry?.material)}). Bấm "In tem" để in ngay, hoặc vào tab Lịch sử in sau.${(res as { putaway_warning?: string | null }).putaway_warning ? ` — ⚠ ${(res as { putaway_warning?: string | null }).putaway_warning}` : ''}` })
      setSplitQtys([''])
    } catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Lỗi tách pallet' }) }
  }

  function handleScanned(code: string) {
    const c = code.trim()
    if (scanFor === 'target') setMergeTarget(c)
    else if (scanFor === 'child') addChild(c)
    else if (scanFor === 'source') setSplitSrc(c)
    else if (scanFor === 'history') setHSearch(c)
    setScanFor(null)
  }

  const mergeReady = !!(scopeReady && mergeTarget.trim() && allChildren.length)
  const splitReady = !!(scopeReady && srcEntry && totalSplit > 0 && totalSplit <= free)
  const locName = (l: any) => `${l.location_code ?? ''}${l.sub_code ? '-' + l.sub_code : ''}`.trim() || l.location_code || l.id

  return (
    <div className="flex flex-col h-full sm:p-3">
      <style>{PALLET_PRINT_CSS}</style>

      <QRScanDialog open={scanFor !== null} onClose={() => setScanFor(null)} onScan={handleScanned} title="Quét QR pallet" />

      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5"><Layers className="h-4 w-4 text-slate-500" />Dồn / Tách pallet</span>
            <div className="flex rounded-lg border border-slate-200 overflow-x-auto text-xs font-medium max-w-full [&>button]:shrink-0 [&>button]:whitespace-nowrap">
              {canMergeTab && <button onClick={() => { setTab('merge'); setMsg(null) }}
                className={`px-3 py-1 inline-flex items-center gap-1 transition-colors ${tab === 'merge' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Layers className="h-3 w-3" />Dồn (gom nhóm)</button>}
              {canSplit && <button onClick={() => { setTab('split'); setMsg(null) }}
                className={`px-3 py-1 border-l border-slate-200 inline-flex items-center gap-1 transition-colors ${tab === 'split' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Scissors className="h-3 w-3" />Tách số lượng</button>}
              <button onClick={() => { setTab('history'); setMsg(null) }}
                className={`px-3 py-1 border-l border-slate-200 inline-flex items-center gap-1 transition-colors ${tab === 'history' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><History className="h-3 w-3" />Lịch sử</button>
            </div>
          </div>
        </div>

        <SummaryBand tiles={tab === 'merge'
          ? [{ label: 'Pallet đích', value: mergeTarget ? 1 : 0 }, { label: 'Pallet con', value: allChildren.length, accent: allChildren.length > 0 }, { label: 'Thao tác', value: 'Gom nhóm' }, { label: 'Số lượng', value: 'Giữ nguyên' }]
          : tab === 'split'
          ? [{ label: 'Tồn gốc', value: srcEntry ? qtyLabel(remaining, srcEntry.material) : '—' }, { label: 'Tách ra', value: srcEntry ? qtyLabel(totalSplit, srcEntry.material) : totalSplit, accent: totalSplit > 0 }, { label: 'Giữ lại', value: srcEntry ? qtyLabel(keepLeft, srcEntry.material) : '—' }, { label: 'Pallet con', value: splitQtys.filter(q => Number(q) > 0).length }]
          /* Ô tổng đếm TRÊN TOÀN BỘ bộ lọc (server) — đếm trên `ops` là chỉ đếm trang đang xem */
          : [{ label: 'Số thao tác', value: hist?.total ?? 0, accent: (hist?.total ?? 0) > 0 }, { label: 'Dồn', value: hist?.merge_n ?? 0 }, { label: 'Tách', value: hist?.split_n ?? 0 }, { label: 'Đã hoàn tác', value: hist?.undone_n ?? 0 }]} />

        {/* 1 tầng cuộn duy nhất per tab (bỏ overflow-auto ở wrapper — tab Lịch sử có scroller riêng) */}
        <div className="flex-1 min-h-0 flex flex-col">
         {tab === 'history' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {msg && (
              <div className={`mx-3 mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${msg.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
                {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}<span>{msg.text}</span>
              </div>
            )}
            {/* Bộ lọc lịch sử — chuẩn Manhattan: Kho/Loại kho (scope, bắt buộc chọn Kho) + Search + FilterBar */}
            <div className="px-3 py-1.5 border-b border-slate-200 space-y-1 sm:py-2 sm:space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-36"><WarehouseSingleSelect warehouses={whOptions} value={opWh} onChange={v => { setOpWh(v); resetPage() }} allLabel="Chọn kho *" triggerClassName="h-8" /></div>
                <Select value={opCat || '__all__'} onValueChange={v => { setOpCat(v === '__all__' ? '' : v); resetPage() }}>
                  <SelectTrigger className="h-8 text-sm w-32"><SelectValue placeholder="Loại kho" /></SelectTrigger>
                  <SelectContent><SelectItem value="__all__">Tất cả loại</SelectItem>{categoryOpts.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <div className="relative flex-1 min-w-[120px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <Input className="pl-7 h-8 text-sm w-full" placeholder="Tìm / quét mã pallet" value={hSearch} onChange={e => { setHSearch(e.target.value); resetPage() }} />
                </div>
                {/* Mobile: action + nút Lọc GOM 1 hàng (PDA); desktop sm:contents → như cũ */}
                <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
                <ActionCluster className="shrink-0" mobileInline items={[{
                  key: 'scan', icon: ScanIcon, label: 'Quét QR', tip: 'Quét QR mã pallet để tìm trong lịch sử dồn/tách', primary: true,
                  onClick: () => setScanFor('history'),
                } satisfies ActionItem]} />
                <FilterSheetButton defs={histDefs} className="sm:hidden" />
                </div>
              </div>
              <FilterBar defs={histDefs} className="hidden sm:flex" />
            </div>
            {/* Bảng lịch sử */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="text-[10px] border-collapse table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: opCols.totalWidth, minWidth: '100%' }}>
                <colgroup>{opCols.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                <thead>
                  <tr className="text-left text-[9px] font-medium text-slate-500">
                    {['Thời gian', 'Loại', 'Pallet nguồn', 'Pallet đích', 'Tên hàng', 'Số lượng', 'Người làm', 'Trạng thái', 'Thao tác'].map((h, i) => (
                      <th key={i} className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 whitespace-nowrap">{h}
                        <span onPointerDown={e => opCols.startResize(i, e)} className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!opWh ? (
                    <tr><td colSpan={9} className="px-2 py-10 text-center text-amber-600">Chọn <b>Kho</b> để xem lịch sử dồn/tách (tránh tải quá nhiều dữ liệu)</td></tr>
                  ) : ops.length === 0 ? (
                    <tr><td colSpan={9} className="px-2 py-10 text-center text-slate-400">Chưa có thao tác dồn/tách nào{(hSearch || hType || opCat || hFrom || hTo) ? ' khớp bộ lọc' : ''}</td></tr>
                  ) : ops.map(o => {
                    const aCode = (o.target_codes?.[0] || o.source_codes?.[0] || '')
                    const matName = matByCode.get(materialCodeOf(aCode))?.short_name ?? materialCodeOf(aCode) ?? '—'
                    const qtySum = (o.detail?.children ?? []).reduce((s: number, c: any) => s + (Number(c.qty) || 0), 0)
                    const qtyText = o.type === 'SPLIT' ? `SL ${qtyLabel(qtySum, matByCode.get(materialCodeOf(aCode)))}` : `${(o.source_codes?.length ?? 0)} pallet`
                    return (
                    <tr key={o.id} className={`border-b border-slate-100 ${o.undone_at ? 'opacity-50' : ''}`}>
                      <td className="px-2 py-1 tabular-nums whitespace-nowrap">{formatTimestampDate(o.created_at, true)} {formatTimestampTime(o.created_at)}</td>
                      <td className="px-2 py-1 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded-full text-[9px] ${o.type === 'SPLIT' ? 'bg-violet-100 text-violet-700' : o.type === 'MERGE' ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-600'}`}>{opLabel(o.type)}</span></td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap" title={o.source_codes?.join(', ')}>{o.source_codes?.join(', ') || '—'}</td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap" title={o.target_codes?.join(', ')}>{o.target_codes?.join(', ') || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap" title={matName}>{matName}</td>
                      <td className="px-2 py-1 whitespace-nowrap tabular-nums">{qtyText}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{o.operated_by_name ?? '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{o.undone_at ? <span className="text-amber-600">Đã hoàn tác</span> : <span className="text-green-600">Hiệu lực</span>}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {o.type === 'SPLIT' && !o.undone_at && canReprintLabel && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" title="In tem các pallet con" onClick={() => printOp(o)}><Printer className="h-3 w-3" />In tem</Button>
                          )}
                          {!o.undone_at && canUndo && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" disabled={undo.isPending} onClick={() => doUndo(o)}><RotateCcw className="h-3 w-3" />Hoàn tác</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
              <PagerNav page={hPage} totalPages={Math.max(1, Math.ceil((hist?.total ?? 0) / hPageSize))} onPage={setHPage} />
            </div>
            <ListFooter
              page={hPage} pageSize={hPageSize} total={hist?.total ?? 0} unit="thao tác"
              onPageSize={n => { setHPageSize(n); setHPage(1) }}
              right={histLoading ? 'đang tải…' : undefined} />
          </div>
         ) : (
          <div className="flex-1 min-h-0 overflow-auto p-4">
          {/* Căn trái + nới rộng (bỏ mx-auto max-w-xl bó giữa — user 19/08 "fit màn hình") */}
          <div className="max-w-3xl space-y-4">
            {!scopeReady && <p className="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Chọn <b>Kho</b> và <b>Loại kho</b> trước mới quét/thao tác được.</p>}
            {/* Chọn Kho + Loại kho (scope thao tác) */}
            <div className="rounded-lg border border-slate-200 p-3 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Kho <span className="text-red-500">*</span></Label>
                <WarehouseSingleSelect warehouses={whOptions} value={opWh} onChange={setOpWh} allLabel="Chọn kho" triggerClassName="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Loại kho</Label>
                <Select value={opCat || '__all__'} onValueChange={v => setOpCat(v === '__all__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Tất cả" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Tất cả loại</SelectItem>
                    {categoryOpts.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {msg && (
              <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${msg.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
                {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
                <span>{msg.text}</span>
              </div>
            )}

            {tab === 'merge' ? (
              <>
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Pallet đích (giữ lại làm đại diện)</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/nhập mã pallet đích" value={mergeTarget} disabled={!scopeReady} onChange={e => setMergeTarget(e.target.value)} />
                    </div>
                    <ActionCluster className="shrink-0" items={[{
                      key: 'scan-target', icon: ScanIcon, label: 'Quét QR',
                      tip: scopeReady ? 'Quét QR pallet đích (giữ lại làm đại diện)' : 'Chọn Kho và Loại kho trước mới quét được',
                      primary: true, disabled: !scopeReady,
                      onClick: () => setScanFor('target'),
                    } satisfies ActionItem]} />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Pallet con (xếp chung lên đích)</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/gõ mã rồi Enter" value={childInput} disabled={!scopeReady}
                        onChange={e => setChildInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addChild(childInput) }} onBlur={() => addChild(childInput)} />
                    </div>
                    <ActionCluster className="shrink-0" items={[{
                      key: 'scan-child', icon: ScanIcon, label: 'Quét QR',
                      tip: scopeReady ? 'Quét QR pallet con — quét liên tiếp để thêm nhiều pallet' : 'Chọn Kho và Loại kho trước mới quét được',
                      primary: true, disabled: !scopeReady,
                      onClick: () => setScanFor('child'),
                    } satisfies ActionItem]} />
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {allChildren.map(c => (
                      <div key={c} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5">
                        <span className="font-mono text-xs font-semibold truncate flex-1">{c}</span>
                        <button onClick={() => { setMergeChildren(p => p.filter(x => x !== c)); if (childInput.trim() === c) setChildInput('') }} className="text-slate-400 hover:text-red-500 shrink-0"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                    {allChildren.length === 0 && <p className="text-xs text-slate-400">Chưa có pallet con.</p>}
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">Dồn = xếp hàng nhiều tem lên 1 pallet vật lý. <b>Không đổi số lượng, không in tem mới</b> — mỗi tem giữ truy vết riêng.</p>

                {/* Cụm action chính tab Dồn — chuẩn ActionCluster (desktop inline, mobile nút chính + menu ⋮) */}
                <ActionCluster items={[
                  ...(canMerge ? [{
                    key: 'merge', icon: Layers,
                    label: allChildren.length ? `Dồn ${allChildren.length} pallet` : 'Dồn pallet',
                    tip: mergeReady
                      ? 'Dồn các pallet con đã nhập vào pallet đích (gom nhóm — không đổi số lượng, không in tem mới)'
                      : 'Chọn Kho/Loại kho, pallet đích và ít nhất 1 pallet con trước',
                    primary: true, variant: 'default', disabled: !mergeReady, busy: merge.isPending,
                    onClick: () => { void doMerge() },
                  } satisfies ActionItem] : []),
                  ...(canUngroup ? [{
                    key: 'ungroup', icon: Trash2, label: 'Gỡ nhóm',
                    tip: allChildren.length ? 'Gỡ nhóm các pallet con đã nhập khỏi pallet đích' : 'Quét/nhập pallet con cần gỡ nhóm trước',
                    danger: true, className: 'border-red-200 text-red-600 hover:bg-red-50',
                    disabled: !allChildren.length, busy: ungroup.isPending,
                    onClick: async () => { setMsg(null); try { const r = await ungroup.mutateAsync({ pallet_codes: allChildren, warehouse_id: opWh }); setMsg({ ok: true, text: `Đã gỡ nhóm ${r.ungrouped} pallet` }); setMergeChildren([]); setChildInput('') } catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Lỗi gỡ nhóm' }) } },
                  } satisfies ActionItem] : []),
                ]} />
                {!canMerge && <p className="text-xs text-amber-600">Bạn không có quyền dồn pallet.</p>}
              </>
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Pallet gốc cần tách</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/nhập mã pallet gốc" value={splitSrc} disabled={!scopeReady} onChange={e => setSplitSrc(e.target.value)} />
                    </div>
                    <ActionCluster className="shrink-0" items={[{
                      key: 'scan-source', icon: ScanIcon, label: 'Quét QR',
                      tip: scopeReady ? 'Quét QR pallet gốc cần tách' : 'Chọn Kho và Loại kho trước mới quét được',
                      primary: true, disabled: !scopeReady,
                      onClick: () => setScanFor('source'),
                    } satisfies ActionItem]} />
                  </div>
                  {srcQ.length >= 3 && !srcEntry && <p className="text-xs text-amber-600">Không tìm thấy pallet này đang tồn kho.</p>}
                  {srcEntry && (
                    <div className="rounded bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 space-y-0.5">
                      <div><span className="text-slate-400">Hàng:</span> <b>{srcEntry.material?.material_code}</b> — {srcEntry.material?.short_name ?? '—'}</div>
                      <div className="tabular-nums"><span className="text-slate-400">Tồn:</span> <b>{qtyLabel(remaining, srcEntry?.material)}</b>{reserved > 0 && <span className="text-amber-600"> · giữ chỗ {qtyLabel(reserved, srcEntry?.material)} (không tách được)</span>}</div>
                    </div>
                  )}
                  {srcEntry && srcSplitChildren.length > 0 && (
                    <div className="rounded border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs space-y-1">
                      <div className="font-semibold text-violet-800 flex items-center gap-1"><Scissors className="h-3 w-3" />Đã tách {srcSplitChildren.length} pallet con từ pallet này:</div>
                      <div className="space-y-0.5 max-h-28 overflow-y-auto">
                        {srcSplitChildren.map((c, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-[10px] text-violet-700">
                            <span className="font-mono truncate">{c.code}</span>
                            <span className="tabular-nums shrink-0">{qtyLabel(Number(c.qty) || 0, srcEntry?.material)} · {formatTimestampDate(c.at, true)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Số lượng mỗi pallet con tách ra</Label>
                  {splitQtys.map((q, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 w-12">Con {i + 1}</span>
                      <QtyInput compact className="flex-1"
                        value={Math.max(0, parseInt(q) || 0)}
                        mat={srcEntry?.material}
                        onChange={b => setSplitQtys(p => p.map((x, j) => j === i ? String(b) : x))} />
                      {splitQtys.length > 1 && <button onClick={() => setSplitQtys(p => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button>}
                    </div>
                  ))}
                  <button onClick={() => setSplitQtys(p => [...p, ''])} className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5"><Plus className="h-3 w-3" />Thêm pallet con</button>
                  {srcEntry && (
                    <div className={`text-xs tabular-nums ${keepLeft < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                      Tách <b>{qtyLabel(totalSplit, srcEntry?.material)}</b> → gốc giữ lại <b>{qtyLabel(keepLeft, srcEntry?.material)}</b> {keepLeft < 0 && '(vượt tồn!)'} {totalSplit > free && free >= 0 && <span className="text-red-600">· vượt số khả dụng {qtyLabel(free, srcEntry?.material)}</span>}
                    </div>
                  )}
                </div>

                {/* Vị trí pallet con — lọc theo Loại kho, mặc định = vị trí pallet gốc */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-semibold">Vị trí pallet con</Label>
                    <LocationScanButton
                      variant="pill"
                      className="ml-auto"
                      warehouseId={opWh || null}
                      materialId={srcEntry?.material_id ?? null}
                      onPicked={loc => setSplitLoc(loc.id)}
                    />
                  </div>
                  <SingleSelect
                    value={splitLoc || '__src__'}
                    onChange={v => setSplitLoc(v === '__src__' ? (srcEntry?.location_id ?? '') : v)}
                    placeholder="Vị trí"
                    searchPlaceholder="Tìm vị trí…"
                    triggerClassName="h-9"
                    serverSearch
                    onSearchChange={setSplitLocTerm}
                    selectedLabel={splitLoc
                      ? locName([...(splitLocs as LocationLite[]), ...splitLocPicked].find(l => l.id === splitLoc) ?? { id: splitLoc, location_code: splitLoc })
                      : `Cùng vị trí pallet gốc${srcEntry?.location ? ` (${srcEntry.location.location_code}-${srcEntry.location.sub_code})` : ''}`}
                    options={[
                      { value: '__src__', label: `Cùng vị trí pallet gốc${srcEntry?.location ? ` (${srcEntry.location.location_code}-${srcEntry.location.sub_code})` : ''}` },
                      ...(splitLocs as any[]).map(l => {
                        const max = Number(l.max_pallets ?? 0)
                        const used = Number(l.used_slots ?? 0)
                        const isFull = max > 0 && used >= max
                        const stat = max > 0 ? (isFull ? 'ĐẦY' : `còn ${max - used}/${max}`) : 'không giới hạn'
                        return { value: l.id as string, label: `${locName(l)} · ${stat}`, disabled: isFull }
                      }),
                    ]}
                  />
                  <p className="text-[10px] text-slate-400">Mặc định ở vị trí pallet gốc. Vị trí <b>ĐẦY</b> bị mờ, không chọn được. Còn slot hiện "còn N/Max".</p>
                </div>

                <p className="text-[11px] text-slate-500">Tách = chia số lượng thật. Gốc giảm tồn, sinh pallet con mới (seq <code>x.1</code>). <b>Tách và in là 2 bước riêng</b> — tách xong có thể in ngay hoặc in sau ở tab Lịch sử. Không ảnh hưởng báo cáo nhập.</p>

                {/* Cụm action chính tab Tách — chuẩn ActionCluster */}
                {canSplit ? (
                  <ActionCluster items={[{
                    key: 'split', icon: Scissors, label: 'Tách pallet',
                    tip: splitReady
                      ? 'Tách pallet gốc thành các pallet con theo số thùng đã nhập'
                      : 'Chọn Kho/Loại kho, pallet gốc đang tồn và số thùng hợp lệ trước',
                    primary: true, variant: 'default', disabled: !splitReady, busy: split.isPending,
                    onClick: () => { void doSplit() },
                  } satisfies ActionItem]} />
                ) : <p className="text-xs text-amber-600">Bạn không có quyền tách pallet.</p>}

                {/* Sau khi tách: tem con chờ in — in ngay hoặc để dành in ở Lịch sử */}
                {splitDone && splitDone.length > 0 && (
                  <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-violet-800">Đã tách {splitDone.length} pallet con — chờ in tem:</p>
                    <div className="space-y-0.5 max-h-32 overflow-y-auto">
                      {splitDone.map(l => <div key={l.key} className="font-mono text-[10px] text-violet-700">{l.qr} · SL {qtyLabel(Number(l.qty), srcEntry?.material)}</div>)}
                    </div>
                    {/* Cụm action sau khi tách — In tem (thuần PC, window.print) + Để in sau/Đóng */}
                    <ActionCluster items={[
                      ...(canGenLabel ? [{
                        key: 'print-now', icon: Printer, label: 'In tem ngay',
                        tip: 'In ngay tem các pallet con vừa tách (mở hộp thoại in trình duyệt)',
                        primary: true, variant: 'default', mobileHidden: true,
                        onClick: () => { printTems(splitDone, 'GENERATE'); setSplitDone(null) },
                      } satisfies ActionItem] : []),
                      {
                        key: 'print-later', icon: canGenLabel ? History : X,
                        label: canGenLabel ? 'Để in sau' : 'Đóng',
                        tip: canGenLabel ? 'Không in ngay — vào tab Lịch sử để in sau' : 'Đóng — in tem ở module In tem pallet',
                        primary: true,
                        onClick: () => setSplitDone(null),
                      } satisfies ActionItem,
                    ]} />
                  </div>
                )}
              </>
            )}
          </div>
          </div>
         )}
        </div>
      </div>

      <PalletPrintArea labels={printLabels} />
    </div>
  )
}
