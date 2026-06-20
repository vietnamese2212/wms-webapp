import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, Scissors, QrCode, Search, X, Plus, Trash2, AlertTriangle, CheckCircle2, History, RotateCcw, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QRScanner } from '@/components/shared/QRScanner'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { PalletPrintArea, PALLET_PRINT_CSS, qrToLabel, type LabelData } from '@/components/shared/palletLabel'
import {
  useInventoryEntries, useMergePallets, useUngroupPallets, useSplitPallet, useLogPalletPrints,
  usePalletOps, useUndoPalletOp, useMaterials, useWarehouses, useWarehouseTypes, useLocationsReal, type PalletOpRow,
} from '@/api/hooks'
import type { Material } from '@/types'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

type Tab = 'merge' | 'split' | 'history'

export default function PalletOps() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canMerge   = can(perms, 'pallet_ops', 'merge')
  const canUngroup = can(perms, 'pallet_ops', 'ungroup')
  const canSplit   = can(perms, 'pallet_ops', 'split')
  // In tem chạm module In tem pallet (logPrints) → gate đúng quyền pallet_print theo mode
  const canGenLabel     = can(perms, 'pallet_print', 'generate')   // in tem con vừa tách (sinh mới)
  const canReprintLabel = can(perms, 'pallet_print', 'reprint')    // in lại tem từ lịch sử

  const [params] = useSearchParams()
  const initTab = params.get('tab') as Tab
  const [tab, setTab] = useState<Tab>(['split', 'history'].includes(initTab) ? initTab : 'merge')
  const [scanFor, setScanFor] = useState<null | 'target' | 'child' | 'source' | 'history'>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Kho + Loại kho (chọn trước — scope thao tác vào đúng kho, mỗi kho 1 tem unique) ──
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes = [] } = useWarehouseTypes()
  const categoryOpts = (whTypes as { value: string }[]).map(t => t.value)
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length ? new Set(user.warehouse_ids) : null
  const whOptions = (warehouses as any[]).filter(w => !allowedWhIds || allowedWhIds.has(w.id))
  // Lưu/khôi phục lựa chọn Kho + Loại kho (không phải chọn lại)
  const SCOPE = useMemo<{ opWh?: string; opCat?: string }>(() => { try { return JSON.parse(localStorage.getItem('palletOps_scope') || '{}') } catch { return {} } }, [])
  const [opWh, setOpWh]   = useState<string>(SCOPE.opWh ?? (allowedWhIds ? [...allowedWhIds][0] : ''))
  const [opCat, setOpCat] = useState<string>(SCOPE.opCat ?? '')
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
      setMsg({ ok: true, text: `Đã dồn ${r.merged} pallet vào ${r.target}` })
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
  const totalSplit = splitQtys.reduce((s, q) => s + (Math.floor(Number(q) || 0)), 0)
  const keepLeft = remaining - totalSplit
  const split = useSplitPallet()
  const logPrints = useLogPalletPrints()
  const [printLabels, setPrintLabels] = useState<LabelData[]>([])
  // Vị trí pallet con — danh sách theo Kho + Loại hàng; mặc định = vị trí pallet gốc
  const [splitLoc, setSplitLoc] = useState('')
  const { data: splitLocs = [] } = useLocationsReal({ warehouse_id: opWh || undefined, category: opCat || undefined })
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
  // Lịch sử: chỉ query khi đã chọn Kho (tránh tải quá nhiều); lọc thêm Loại kho phía client
  const { data: opsRaw = [] } = usePalletOps(
    { search: hSearch.trim() || undefined, type: hType || undefined, warehouse_id: opWh || undefined, date_from: hFrom || undefined, date_to: hTo || undefined },
    tab === 'history' && !!opWh,
  )
  const undo = useUndoPalletOp()
  const opCols = useColumnResize('palletOps_col_widths', [150, 78, 180, 180, 150, 80, 100, 100, 110])
  const opLabel = (t: string) => t === 'MERGE' ? 'Dồn' : t === 'SPLIT' ? 'Tách' : t === 'UNGROUP' ? 'Gỡ nhóm' : t
  const canUndo = canMerge || canUngroup || canSplit
  // Filter Lịch sử kiểu Manhattan (chip + sheet mobile) — Kho/Loại kho là scope riêng ở hàng trên
  const histDefs: FilterDef[] = [
    { key: 'type', label: 'Loại thao tác', type: 'single', value: hType, onChange: setHType, allLabel: 'Tất cả', options: [{ value: 'MERGE', label: 'Dồn' }, { value: 'SPLIT', label: 'Tách' }, { value: 'UNGROUP', label: 'Gỡ nhóm' }] },
    { key: 'date', label: 'Khoảng ngày', type: 'daterange', from: hFrom, to: hTo, onChange: (f, t) => { setHFrom(f); setHTo(t) } },
  ]
  // In tem từ Lịch sử (tách rồi chưa in được ngay → vào đây in)
  const { data: allMats = [] } = useMaterials(undefined, tab === 'history')
  const matByCode = useMemo(() => { const m = new Map<string, Material>(); for (const x of allMats as Material[]) m.set(x.material_code, x); return m }, [allMats])
  // Lọc thêm theo Loại kho (client-side, suy từ mã hàng của pallet)
  const ops = useMemo(() => {
    if (!opCat) return opsRaw
    return opsRaw.filter(o => {
      const code = o.target_codes?.[0] || o.source_codes?.[0] || ''
      return matByCode.get(code.split('_')[1])?.category === opCat
    })
  }, [opsRaw, opCat, matByCode])
  function printOp(o: PalletOpRow) {
    const qtyByCode = new Map<string, number>()
    for (const c of (o.detail?.children ?? []) as { code: string; qty: number }[]) qtyByCode.set(c.code, c.qty)
    const labels = (o.target_codes ?? []).map(code => qrToLabel(code, matByCode.get(code.split('_')[1]), qtyByCode.get(code) ?? null))
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
    const children = splitQtys.map(q => Math.floor(Number(q) || 0)).filter(q => q > 0).map(qty => ({ qty }))
    try {
      const res = await split.mutateAsync({ source_pallet_code: srcQ, children, warehouse_id: opWh, location_id: splitLoc || undefined })
      const labels = res.children.map((c: any) => qrToLabel(c.pallet_code, srcEntry?.material, c.cartons_remaining))
      setSplitDone(labels)   // KHÔNG tự in — chờ người dùng bấm "In tem" (hoặc in sau ở tab Lịch sử)
      setMsg({ ok: true, text: `Đã tách ${labels.length} pallet con (gốc còn ${res.source_remaining} thùng). Bấm "In tem" để in ngay, hoặc vào tab Lịch sử in sau.` })
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

      <Dialog open={scanFor !== null} onOpenChange={o => { if (!o) setScanFor(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><QrCode className="h-4 w-4" />Quét QR pallet</DialogTitle></DialogHeader>
          {scanFor !== null && <QRScanner onScan={handleScanned} onClose={() => setScanFor(null)} />}
        </DialogContent>
      </Dialog>

      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {/* Toolbar */}
        <div className="border-b bg-white px-3 py-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5"><Layers className="h-4 w-4 text-slate-500" />Dồn / Tách pallet</span>
            <div className="flex rounded-lg border border-slate-200 overflow-x-auto text-xs font-medium max-w-full [&>button]:shrink-0 [&>button]:whitespace-nowrap">
              <button onClick={() => { setTab('merge'); setMsg(null) }}
                className={`px-3 py-1 inline-flex items-center gap-1 transition-colors ${tab === 'merge' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Layers className="h-3 w-3" />Dồn (gom nhóm)</button>
              <button onClick={() => { setTab('split'); setMsg(null) }}
                className={`px-3 py-1 border-l border-slate-200 inline-flex items-center gap-1 transition-colors ${tab === 'split' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Scissors className="h-3 w-3" />Tách số lượng</button>
              <button onClick={() => { setTab('history'); setMsg(null) }}
                className={`px-3 py-1 border-l border-slate-200 inline-flex items-center gap-1 transition-colors ${tab === 'history' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><History className="h-3 w-3" />Lịch sử</button>
            </div>
          </div>
        </div>

        <SummaryBand tiles={tab === 'merge'
          ? [{ label: 'Pallet đích', value: mergeTarget ? 1 : 0 }, { label: 'Pallet con', value: allChildren.length, accent: allChildren.length > 0 }, { label: 'Thao tác', value: 'Gom nhóm' }, { label: 'Số lượng', value: 'Giữ nguyên' }]
          : tab === 'split'
          ? [{ label: 'Tồn gốc', value: srcEntry ? remaining : '—' }, { label: 'Tách ra', value: totalSplit, accent: totalSplit > 0 }, { label: 'Giữ lại', value: srcEntry ? keepLeft : '—' }, { label: 'Pallet con', value: splitQtys.filter(q => Number(q) > 0).length }]
          : [{ label: 'Số thao tác', value: ops.length, accent: ops.length > 0 }, { label: 'Dồn', value: ops.filter(o => o.type === 'MERGE').length }, { label: 'Tách', value: ops.filter(o => o.type === 'SPLIT').length }, { label: 'Đã hoàn tác', value: ops.filter(o => o.undone_at).length }]} />

        <div className="flex-1 min-h-0 overflow-auto flex flex-col">
         {tab === 'history' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {msg && (
              <div className={`mx-3 mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${msg.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-700'}`}>
                {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}<span>{msg.text}</span>
              </div>
            )}
            {/* Bộ lọc lịch sử — chuẩn Manhattan: Kho/Loại kho (scope, bắt buộc chọn Kho) + Search + FilterBar */}
            <div className="px-3 py-2 border-b border-slate-200 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-36"><WarehouseSingleSelect warehouses={whOptions} value={opWh} onChange={setOpWh} allLabel="Chọn kho *" triggerClassName="h-8" /></div>
                <Select value={opCat || '__all__'} onValueChange={v => setOpCat(v === '__all__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-sm w-32"><SelectValue placeholder="Loại kho" /></SelectTrigger>
                  <SelectContent><SelectItem value="__all__">Tất cả loại</SelectItem>{categoryOpts.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <div className="relative flex-1 min-w-[120px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <Input className="pl-7 h-8 text-sm w-full" placeholder="Tìm / quét mã pallet" value={hSearch} onChange={e => setHSearch(e.target.value)} />
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 shrink-0" title="Quét QR" onClick={() => setScanFor('history')}><QrCode className="h-4 w-4" /></Button>
                <FilterSheetButton defs={histDefs} className="sm:hidden" />
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
                      <th key={i} className="sticky top-0 z-10 bg-slate-50 px-2 py-1.5 whitespace-nowrap relative">{h}
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
                    const matName = matByCode.get(aCode.split('_')[1])?.short_name ?? aCode.split('_')[1] ?? '—'
                    const qtySum = (o.detail?.children ?? []).reduce((s: number, c: any) => s + (Number(c.qty) || 0), 0)
                    const qtyText = o.type === 'SPLIT' ? `${qtySum} thùng` : `${(o.source_codes?.length ?? 0)} pallet`
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
            </div>
          </div>
         ) : (
          <div className="p-4">
          <div className="mx-auto max-w-xl space-y-4">
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
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/nhập mã pallet đích" value={mergeTarget} disabled={!scopeReady} onChange={e => setMergeTarget(e.target.value)} />
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 px-2.5 shrink-0" disabled={!scopeReady} onClick={() => setScanFor('target')}><QrCode className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Pallet con (xếp chung lên đích)</Label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/gõ mã rồi Enter" value={childInput} disabled={!scopeReady}
                        onChange={e => setChildInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addChild(childInput) }} onBlur={() => addChild(childInput)} />
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 px-2.5 shrink-0" disabled={!scopeReady} onClick={() => setScanFor('child')}><QrCode className="h-4 w-4" /></Button>
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

                {canMerge ? (
                  <Button className="w-full gap-1.5" disabled={!mergeReady || merge.isPending} onClick={doMerge}>
                    <Layers className="h-4 w-4" />{merge.isPending ? 'Đang dồn…' : `Dồn ${allChildren.length || ''} pallet vào đích`}
                  </Button>
                ) : <p className="text-xs text-amber-600">Bạn không có quyền dồn pallet.</p>}

                {canUngroup && (
                  <Button variant="outline" className="w-full gap-1.5" disabled={!allChildren.length || ungroup.isPending}
                    onClick={async () => { setMsg(null); try { const r = await ungroup.mutateAsync({ pallet_codes: allChildren, warehouse_id: opWh }); setMsg({ ok: true, text: `Đã gỡ nhóm ${r.ungrouped} pallet` }); setMergeChildren([]); setChildInput('') } catch (e: any) { setMsg({ ok: false, text: e?.response?.data?.error?.message ?? 'Lỗi gỡ nhóm' }) } }}>
                    <Trash2 className="h-4 w-4" />Gỡ nhóm các pallet con đã nhập
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Pallet gốc cần tách</Label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input className="pl-7 h-9 text-sm font-mono" placeholder="Quét/nhập mã pallet gốc" value={splitSrc} disabled={!scopeReady} onChange={e => setSplitSrc(e.target.value)} />
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 px-2.5 shrink-0" disabled={!scopeReady} onClick={() => setScanFor('source')}><QrCode className="h-4 w-4" /></Button>
                  </div>
                  {srcQ.length >= 3 && !srcEntry && <p className="text-xs text-amber-600">Không tìm thấy pallet này đang tồn kho.</p>}
                  {srcEntry && (
                    <div className="rounded bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 space-y-0.5">
                      <div><span className="text-slate-400">Hàng:</span> <b>{srcEntry.material?.material_code}</b> — {srcEntry.material?.short_name ?? '—'}</div>
                      <div className="tabular-nums"><span className="text-slate-400">Tồn:</span> <b>{remaining}</b> thùng{reserved > 0 && <span className="text-amber-600"> · giữ chỗ {reserved} (không tách được)</span>}</div>
                    </div>
                  )}
                  {srcEntry && srcSplitChildren.length > 0 && (
                    <div className="rounded border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs space-y-1">
                      <div className="font-semibold text-violet-800 flex items-center gap-1"><Scissors className="h-3 w-3" />Đã tách {srcSplitChildren.length} pallet con từ pallet này:</div>
                      <div className="space-y-0.5 max-h-28 overflow-y-auto">
                        {srcSplitChildren.map((c, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-[10px] text-violet-700">
                            <span className="font-mono truncate">{c.code}</span>
                            <span className="tabular-nums shrink-0">{c.qty} thùng · {formatTimestampDate(c.at, true)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Số thùng mỗi pallet con tách ra</Label>
                  {splitQtys.map((q, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 w-12">Con {i + 1}</span>
                      <Input type="number" min={1} className="h-9 text-sm flex-1" placeholder="Số thùng" value={q}
                        onChange={e => setSplitQtys(p => p.map((x, j) => j === i ? e.target.value : x))} />
                      {splitQtys.length > 1 && <button onClick={() => setSplitQtys(p => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X className="h-4 w-4" /></button>}
                    </div>
                  ))}
                  <button onClick={() => setSplitQtys(p => [...p, ''])} className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5"><Plus className="h-3 w-3" />Thêm pallet con</button>
                  {srcEntry && (
                    <div className={`text-xs tabular-nums ${keepLeft < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                      Tách <b>{totalSplit}</b> thùng → gốc giữ lại <b>{keepLeft}</b> thùng {keepLeft < 0 && '(vượt tồn!)'} {totalSplit > free && free >= 0 && <span className="text-red-600">· vượt số khả dụng {free}</span>}
                    </div>
                  )}
                </div>

                {/* Vị trí pallet con — lọc theo Loại kho, mặc định = vị trí pallet gốc */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <Label className="text-xs font-semibold">Vị trí pallet con</Label>
                  <Select value={splitLoc || '__src__'} onValueChange={v => setSplitLoc(v === '__src__' ? (srcEntry?.location_id ?? '') : v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Vị trí" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__src__">Cùng vị trí pallet gốc{srcEntry?.location ? ` (${srcEntry.location.location_code}-${srcEntry.location.sub_code})` : ''}</SelectItem>
                      {(splitLocs as any[]).map(l => {
                        const max = Number(l.max_pallets ?? 0)
                        const used = Number(l.used_slots ?? 0)
                        const isFull = max > 0 && used >= max
                        const stat = max > 0 ? (isFull ? 'ĐẦY' : `còn ${max - used}/${max}`) : 'không giới hạn'
                        return <SelectItem key={l.id} value={l.id} disabled={isFull}>{locName(l)} · {stat}</SelectItem>
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-slate-400">Mặc định ở vị trí pallet gốc. Vị trí <b>ĐẦY</b> bị mờ, không chọn được. Còn slot hiện "còn N/Max".</p>
                </div>

                <p className="text-[11px] text-slate-500">Tách = chia số lượng thật. Gốc giảm tồn, sinh pallet con mới (seq <code>x.1</code>). <b>Tách và in là 2 bước riêng</b> — tách xong có thể in ngay hoặc in sau ở tab Lịch sử. Không ảnh hưởng báo cáo nhập.</p>

                {canSplit ? (
                  <Button className="w-full gap-1.5" disabled={!splitReady || split.isPending} onClick={doSplit}>
                    <Scissors className="h-4 w-4" />{split.isPending ? 'Đang tách…' : 'Tách pallet'}
                  </Button>
                ) : <p className="text-xs text-amber-600">Bạn không có quyền tách pallet.</p>}

                {/* Sau khi tách: tem con chờ in — in ngay hoặc để dành in ở Lịch sử */}
                {splitDone && splitDone.length > 0 && (
                  <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-violet-800">Đã tách {splitDone.length} pallet con — chờ in tem:</p>
                    <div className="space-y-0.5 max-h-32 overflow-y-auto">
                      {splitDone.map(l => <div key={l.key} className="font-mono text-[10px] text-violet-700">{l.qr} · {l.qty} thùng</div>)}
                    </div>
                    <div className="flex gap-2">
                      {canGenLabel && (
                        <Button size="sm" className="flex-1 gap-1.5" onClick={() => { printTems(splitDone, 'GENERATE'); setSplitDone(null) }}>
                          <Printer className="h-3.5 w-3.5" />In tem ngay
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setSplitDone(null)}>{canGenLabel ? 'Để in sau (ở Lịch sử)' : 'Đóng — in tem ở module In tem pallet'}</Button>
                    </div>
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
