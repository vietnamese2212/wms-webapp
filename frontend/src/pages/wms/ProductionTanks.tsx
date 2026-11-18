// TRANG "BỒN" (MES giai đoạn 1, 14/11/2026). Mỗi dòng một BỒN của kho chế biến: đang chứa / sức chứa · mã bán thành phẩm ·
// các mẻ đang nằm trong bồn (nhiều mẻ chung một bồn được) · hạn lưu gần nhất · lô chờ QA — kèm thao tác trên dòng:
// nạp từ mẻ · chuyển bồn · điều chỉnh mức (khớp đồng hồ) · xả bỏ · sổ bồn · sửa. Mỗi kho vài chục bồn ⇒ không phân trang.
// 17/11: xem mặc định là SƠ ĐỒ BỒN 2D (TankMimic — mực theo sức chứa, mỗi mẻ một lớp, phần sắp vào gạch chéo, realtime); nút đổi sang bảng.
// QA ĐẠT / KHÔNG ĐẠT bấm ở đây (áp cho mọi mẻ trong bồn) · ĐỔ BỒN (quét tem pallet của mẻ) mở từ bồn đang đứng.
// 18/11 f: sơ đồ GỌN cho 20–30 bồn (TankBoard, nay thay bằng TankMap2D — mỗi bồn một ô nhỏ, MẺ đang làm đứng trên bồn của nó kèm ký hiệu + bước như cột Tình trạng,
// dải lọc theo bước); bấm ô ⇒ khung chi tiết (thẻ bồn đầy đủ + thao tác + lối sang Báo cáo NVL của chu kỳ).
// 18/11 g: SƠ ĐỒ 2D ĐẦY ĐỦ (TankMap2D — user: "zoom in zoom out, scroll … chế độ fit bấm nút thì xem được bao quát"): bản vẽ lớn thu phóng / rê,
// Vừa màn · 100% · bản đồ thu nhỏ · toàn màn hình; ba tầng chi tiết theo tỉ lệ; dòng chảy mẻ → bồn → máy đóng gói; người có quyền Quản lý bồn
// bấm "Sắp xếp" rồi kéo bồn tới đúng chỗ ngoài xưởng (lưu cho mọi người).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { Plus, ArrowDownToLine, ArrowLeftRight, Gauge, Trash2, History, Pencil, Layers, MoreVertical, ShieldCheck, LayoutGrid, Table2, FileBarChart, ExternalLink, Move } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { ListFooter } from '@/components/shared/ListPager'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { TankFormSheet, TankOpSheet, TankMovesSheet, nfQty, type TankOp } from '@/components/wms/production/TankSheets'
import { TankMimic } from '@/components/wms/production/TankMimic'
import { TankMap2D, boardBatchesOf, type TankQuick } from '@/components/wms/production/TankMap2D'
import { StageBadge, StageSymbol } from '@/components/wms/production/BatchStage'
import { PourSheet, TankQaSheet } from '@/components/wms/production/BatchFlow'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useProductionTanks, useProductionWarehouses, BATCH_QA_VI, type TankRow } from '@/api/productionHooks'
import { formatDateTime } from '@/utils/formatters'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const COLS: RtColDef[] = [
  { id: 'code', label: 'Bồn', w: 100 }, { id: 'pct', label: '% đầy', w: 60, align: 'right' }, { id: 'fill', label: 'Đang chứa / sức chứa', w: 150, align: 'right' },
  { id: 'mat', label: 'Bán thành phẩm', w: 170 }, { id: 'lots', label: 'Mẻ trong bồn', w: 230 }, { id: 'exp', label: 'Hạn lưu gần nhất', w: 120 },
  { id: 'qa', label: 'QA', w: 90 }, { id: 'wh', label: 'Kho chế biến', w: 150 }, { id: 'act', label: '', w: 44, stickyRight: true },
]
const pctTone = (p: number) => (p >= 95 ? 'text-red-600' : p >= 80 ? 'text-amber-600' : p > 0 ? 'text-green-700' : 'text-slate-400')

export default function ProductionTanks() {
  const navigate = useNavigate()
  const canSeePath = useCanSeePath()
  const f = useWmsFilterStore(s => s.productionTanks)
  const setF = useWmsFilterStore(s => s.setProductionTanks)
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const canManage = can(perms, 'production', 'manage_tank')
  const canOps = can(perms, 'production', 'tank_ops')
  const canQa = can(perms, 'production', 'qa_release')
  const canPour = can(perms, 'production', 'pour')
  const { data: { kitchens, factories } } = useProductionWarehouses()
  const q = useProductionTanks(f.warehouseId || undefined, f.showInactive)
  const tanks = q.data ?? []
  const [form, setForm] = useState<{ open: boolean; tank: TankRow | null }>({ open: false, tank: null })
  const [op, setOp] = useState<{ tank: TankRow | null; op: TankOp } | null>(null)
  const [moves, setMoves] = useState<TankRow | null>(null)
  const [qaTank, setQaTank] = useState<TankRow | null>(null)
  const [pourTank, setPourTank] = useState<TankRow | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [arrange, setArrange] = useState(false)
  const sel = selId ? tanks.find(t => t.id === selId) ?? null : null   // lấy lại từ danh sách sống ⇒ khung chi tiết cũng realtime
  // mở một thao tác (form chồng lên) ⇒ đóng khung chi tiết, tránh hai hộp thoại cùng mở
  useEffect(() => { if (op || qaTank || pourTank || moves || form.open) setSelId(null) }, [op, qaTank, pourTank, moves, form.open])
  const mapView = f.view !== 'table'
  useEffect(() => { if (!mapView) setArrange(false) }, [mapView])
  const reportPath = '/wms/production/usage-report'
  const openReport = (wh?: string | null, cycle?: string | null) => {
    const p = new URLSearchParams()
    if (wh) p.set('wh', wh)
    if (cycle) p.set('cycle', cycle)
    const qs = p.toString()
    navigate(qs ? `${reportPath}?${qs}` : reportPath)
  }

  const whOpts = [...factories.map(w => ({ value: w.id, label: `${w.name} (nhà máy)` })), ...kitchens.map(k => ({ value: k.id, label: k.name }))]
  const defs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId, onChange: v => setF({ warehouseId: v }), pinned: true },
  ]
  const sumBy = (unit: string) => tanks.filter(t => t.unit === unit).reduce((s, t) => s + Number(t.content), 0)
  const actions: ActionItem[] = []
  if (canManage) actions.push({ key: 'new', icon: Plus, label: 'Khai bồn', tip: 'Khai bồn mới của kho chế biến', primary: true, variant: 'default', onClick: () => setForm({ open: true, tank: null }) })
  if (canManage && mapView && tanks.length > 0) actions.push({ key: 'arrange', icon: Move, label: arrange ? 'Đang sắp xếp' : 'Sắp xếp', tip: 'Sắp xếp sơ đồ: kéo bồn tới đúng chỗ ngoài xưởng rồi Lưu — mọi người thấy cùng bản vẽ', onClick: () => setArrange(a => !a), mobileHidden: true, className: arrange ? 'border-amber-300 bg-amber-50 text-amber-800' : undefined })
  actions.push({ key: 'view', icon: mapView ? Table2 : LayoutGrid, label: mapView ? 'Bảng' : 'Sơ đồ', tip: mapView ? 'Xem dạng bảng' : 'Xem sơ đồ bồn', onClick: () => setF({ view: mapView ? 'table' : 'map' }) })
  if (canSeePath('/wms/production')) actions.push({ key: 'batches', icon: Layers, label: 'Mẻ', tip: 'Về danh sách mẻ chế biến', onClick: () => navigate('/wms/production') })
  if (canSeePath(reportPath)) actions.push({ key: 'report', icon: FileBarChart, label: 'Báo cáo NVL', tip: 'Báo cáo NVL theo chu kỳ (tách ca, mẻ, nhân sự) — xem trực tiếp, xuất báo cáo cuối', onClick: () => openReport(f.warehouseId || null) })

  const menuFor = (t: TankRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="touch-target inline-flex items-center justify-center px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100" title="Thao tác bồn" aria-label={`Thao tác bồn ${t.code}`}><MoreVertical className="h-3.5 w-3.5" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs">
        {canQa && <DropdownMenuItem disabled={!t.lots.length} onSelect={() => setQaTank(t)}><ShieldCheck className="h-3.5 w-3.5 mr-2" />QA đạt / không đạt</DropdownMenuItem>}
        {(canPour || canOps) && t.is_active && <DropdownMenuItem onSelect={() => setPourTank(t)}><ScanIcon className="h-3.5 w-3.5 mr-2" />Check trước khi đổ bồn (quét tem của mẻ)</DropdownMenuItem>}
        {canOps && t.is_active && <DropdownMenuItem onSelect={() => setOp({ tank: t, op: 'FILL' })}><ArrowDownToLine className="h-3.5 w-3.5 mr-2" />Nạp từ mẻ</DropdownMenuItem>}
        {canOps && <DropdownMenuItem disabled={!Number(t.content)} onSelect={() => setOp({ tank: t, op: 'TRANSFER' })}><ArrowLeftRight className="h-3.5 w-3.5 mr-2" />Chuyển sang bồn khác</DropdownMenuItem>}
        {canOps && <DropdownMenuItem disabled={!t.lots.length} onSelect={() => setOp({ tank: t, op: 'ADJUST' })}><Gauge className="h-3.5 w-3.5 mr-2" />Điều chỉnh mức (khớp đồng hồ)</DropdownMenuItem>}
        {canOps && <DropdownMenuItem disabled={!Number(t.content)} className="text-red-600" onSelect={() => setOp({ tank: t, op: 'DISCARD' })}><Trash2 className="h-3.5 w-3.5 mr-2" />Xả bỏ</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => setMoves(t)}><History className="h-3.5 w-3.5 mr-2" />Sổ bồn</DropdownMenuItem>
        {canManage && <DropdownMenuItem onSelect={() => setForm({ open: true, tank: t })}><Pencil className="h-3.5 w-3.5 mr-2" />Sửa bồn</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  // việc chính NGAY TRÊN BỒN của sơ đồ (vận hành để ngoài): mẻ đã duyệt đang làm cho bồn ⇒ Check trước khi đổ bồn (không chờ cấp đủ
  // NVL — một số NVL đổ thẳng tại bồn); bồn còn lô chưa kết luận ⇒ QA bồn
  const quickFor = (t: TankRow): TankQuick[] => {
    const out: TankQuick[] = []
    if ((canPour || canOps) && t.is_active && t.incoming.some(x => x.stage === 'working'))
      out.push({ key: 'pour', label: 'Check trước khi đổ bồn', short: 'Check', tone: 'blue', icon: ScanIcon, onClick: () => setPourTank(t) })
    if (canQa && t.lots.length > 0 && t.qa_state !== 'RELEASED')
      out.push({ key: 'qa', label: 'QA đạt / không đạt cho mọi mẻ trong bồn', short: 'QA bồn', tone: 'green', icon: ShieldCheck, onClick: () => setQaTank(t) })
    return out
  }
  // việc chính trên thẻ bồn: bồn có mẻ sắp vào ⇒ Đổ bồn; bồn còn lô chưa kết luận ⇒ QA
  const footFor = (t: TankRow) => {
    const pour = (canPour || canOps) && t.is_active && t.incoming.length > 0
    const qa = canQa && t.lots.length > 0 && t.qa_state !== 'RELEASED'
    if (!pour && !qa) return null
    return (
      <div className="flex gap-1.5">
        {pour && <button type="button" onClick={() => setPourTank(t)} className="touch-target flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"><ScanIcon className="h-3.5 w-3.5" />Check trước khi đổ bồn</button>}
        {qa && <button type="button" onClick={() => setQaTank(t)} className="touch-target flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"><ShieldCheck className="h-3.5 w-3.5" />QA</button>}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 space-y-1 sm:py-2 sm:space-y-1.5 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center gap-1.5 flex-wrap xl:flex-nowrap">
            <span className="hidden sm:inline text-sm font-semibold text-slate-700 shrink-0">Bồn</span>
            <div className="hidden sm:flex flex-1 min-w-0"><FilterBar defs={defs} /></div>
            <FilterSheetButton defs={defs} className="sm:hidden" />
            <label htmlFor="tank-inactive" className="flex items-center gap-1.5 text-[11px] text-slate-600 shrink-0 cursor-pointer">
              <Switch id="tank-inactive" checked={f.showInactive} onCheckedChange={v => setF({ showInactive: v })} />Bồn ngừng dùng
            </label>
            <ActionCluster className="w-auto shrink-0 ml-auto" items={actions} />
          </div>
        </div>
        {/* điện thoại: dải số dạng "NHÃN số" nối nhau (gọn ~2 dòng) — chỗ cho sơ đồ bồn (user 18/11: "tiết kiệm vị trí") */}
        <SummaryBand mobilePairs tiles={[
          { label: 'Bồn', value: tanks.length.toLocaleString('vi-VN') },
          { label: 'Đang chứa (L)', value: nfQty(sumBy('L')) },
          { label: 'Đang chứa (kg)', value: nfQty(sumBy('KG')) },
          { label: 'Trống', value: tanks.filter(t => !t.lots.length).length.toLocaleString('vi-VN') },
          { label: 'Chờ QA', value: tanks.filter(t => t.qa_state === 'HOLD').length.toLocaleString('vi-VN'), accent: tanks.some(t => t.qa_state === 'HOLD'), tip: 'Bồn còn mẻ QA chưa kết luận — bấm QA trên bồn' },
          { label: 'Không đạt', value: tanks.filter(t => t.qa_state === 'REJECTED').length.toLocaleString('vi-VN'), danger: tanks.some(t => t.qa_state === 'REJECTED') },
          { label: 'Quá hạn lưu', value: tanks.filter(t => t.expired).length.toLocaleString('vi-VN'), danger: tanks.some(t => t.expired), tip: 'Bồn có lô đã quá hạn lưu (giờ khai ở mã bán thành phẩm) — chỉ cảnh báo, không chặn rút' },
        ]} />
        {mapView && (
          q.isError ? <p className="p-3 text-xs text-red-600">{apiMsg(q.error)}</p>
          : q.isLoading ? <p className="p-3 text-xs text-slate-400">Đang tải…</p>
          : !tanks.length ? <p className="p-3 text-xs text-slate-400">{kitchens.length ? 'Chưa khai bồn nào.' : 'Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.'}</p>
          : <TankMap2D tanks={tanks} selectedId={selId} onSelect={t => setSelId(t.id)} onOpenBatch={id => navigate(`/wms/production/${id}`)} quick={quickFor}
              arrange={arrange} onArrangeEnd={() => setArrange(false)} updatedAt={q.dataUpdatedAt} />
        )}
        {!mapView && <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {!mapView && <ResizableTable storageKey="production_tanks_cols_v2" cols={COLS}>
            <TableBody>
              {q.isError && <TableEmptyRow colSpan={COLS.length}><span className="text-red-600">{apiMsg(q.error)}</span></TableEmptyRow>}
              {!q.isError && q.isLoading && <TableEmptyRow colSpan={COLS.length}>Đang tải…</TableEmptyRow>}
              {!q.isError && !q.isLoading && !tanks.length && <TableEmptyRow colSpan={COLS.length}>{kitchens.length ? 'Chưa khai bồn nào.' : 'Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.'}</TableEmptyRow>}
              {tanks.map(t => {
                const pct = t.capacity ? Math.round(Number(t.content) * 100 / Number(t.capacity)) : 0
                const mat = t.lots[0]?.batch?.material
                const pendingQa = t.lots.filter(l => l.batch?.qa_status !== 'RELEASED')
                const expSoon = t.next_expiry
                return (
                  <TableRow key={t.id} className={t.is_active ? '' : 'text-slate-400'}>
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono font-semibold`} title={t.name ?? ''}>{t.code}{!t.is_active && <span className="ml-1 font-sans font-normal">(ngừng)</span>}</TableCell>
                    <TableCell className={`${NUM} ${pctTone(pct)}`}>{pct}%</TableCell>
                    <TableCell className={NUM}>{nfQty(t.content)} <span className="text-slate-400 font-normal">/ {nfQty(t.capacity)} {t.unit}</span></TableCell>
                    <TableCell className={`${TD} truncate`} title={mat?.short_name ?? ''}>{mat ? <><span className="font-mono font-semibold">{mat.material_code}</span> {mat.short_name ?? ''}</> : <span className="text-slate-300">trống</span>}</TableCell>
                    <TableCell className={`${TD} truncate`} title={t.lots.map(l => `${l.batch?.batch_code}: ${nfQty(l.qty_remaining)} ${t.unit}`).join('\n')}>
                      {t.lots.length ? t.lots.map((l, i) => (
                        <span key={l.id}>{i ? ' · ' : ''}<button type="button" className="font-mono hover:underline" onClick={() => navigate(`/wms/production/${l.batch_id}`)}>{l.batch?.batch_code}</button> <span className="text-slate-400">{nfQty(l.qty_remaining)}</span></span>
                      )) : <span className="text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className={`${TD} tabular-nums ${t.expired ? 'text-red-600 font-semibold' : ''}`}>{expSoon ? formatDateTime(expSoon) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={TD} title={pendingQa.map(l => `${l.batch?.batch_code}: ${l.batch ? BATCH_QA_VI[l.batch.qa_status] : ''}`).join('\n')}>
                      {t.qa_state === 'EMPTY' ? <span className="text-slate-300">—</span> : t.qa_state === 'REJECTED' ? <StatusBadge tone="red">Không đạt</StatusBadge> : t.qa_state === 'HOLD' ? <StatusBadge tone="amber">{pendingQa.length} mẻ chờ QA</StatusBadge> : <StatusBadge tone="green">QA đạt</StatusBadge>}
                    </TableCell>
                    <TableCell className={`${TD} truncate`}>{t.warehouse?.name ?? '—'}</TableCell>
                    <TableCell className={`${TD} sticky right-0 z-10 bg-white text-center`}>
                      {menuFor(t)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>}
        </div>}
        {!mapView && <ListFooter page={1} pageSize={Math.max(tanks.length, 1)} total={tanks.length} unit="bồn" options={[]} onPageSize={() => {}} />}
      </div>
      <TankFormSheet open={form.open} onClose={() => setForm({ open: false, tank: null })} tank={form.tank} defaultWarehouseId={f.warehouseId} />
      {/* bồn lấy lại từ danh sách đang sống (realtime) — người khác vừa rút / nạp thì form tính chỗ trống theo số mới */}
      <TankOpSheet open={!!op} onClose={() => setOp(null)} tank={op?.tank ? tanks.find(t => t.id === op.tank!.id) ?? op.tank : null} op={op?.op ?? 'FILL'} />
      <TankMovesSheet open={!!moves} onClose={() => setMoves(null)} tank={moves} />
      <TankQaSheet open={!!qaTank} onClose={() => setQaTank(null)} tank={qaTank ? tanks.find(t => t.id === qaTank.id) ?? qaTank : null} />
      {/* mở ở thẻ bồn = đang đứng ở bồn này; mẻ lấy từ tem quét đầu tiên (tem của mẻ bồn khác ⇒ báo SAI BỒN) */}
      {pourTank && <PourSheet open onClose={() => setPourTank(null)} warehouseId={pourTank.warehouse_id} tankId={pourTank.id} canScan={canPour} canFill={canOps} />}
      {/* KHUNG CHI TIẾT của bồn đang chọn trên sơ đồ: thẻ bồn đầy đủ + thao tác + các mẻ (tình trạng · bước) + lối sang Báo cáo NVL của chu kỳ */}
      <Sheet open={!!sel} onOpenChange={o => { if (!o) setSelId(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" data-testid="tank-detail">
          {sel && <>
            <SheetHeader className="px-4 py-3 border-b bg-slate-50 shrink-0 text-left">
              <SheetTitle className="text-sm">Bồn <span className="font-mono">{sel.code}</span>{sel.name ? <span className="font-normal text-slate-500"> · {sel.name}</span> : null}</SheetTitle>
              <SheetDescription className="text-xs">{sel.warehouse?.name ?? ''}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3">
              <TankMimic tank={sel} onOpenBatch={id => navigate(`/wms/production/${id}`)} menu={menuFor(sel)} footer={footFor(sel)} />
              {(() => {
                const bs = boardBatchesOf(sel)
                const cycles = [...new Set(bs.map(b => b.cycle).filter((c): c is string => !!c))]
                return <>
                  {bs.length > 0 && (
                    <div className="rounded-lg border border-slate-200">
                      <p className="px-2.5 py-1.5 border-b bg-slate-50 text-[11px] font-semibold text-slate-600">Mẻ của bồn</p>
                      <div className="divide-y divide-slate-100">
                        {bs.map(b => (
                          <button key={`${b.id}-${b.inTank ? 'in' : 'up'}`} type="button" onClick={() => navigate(`/wms/production/${b.id}`)}
                            className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-sky-50">
                            <StageSymbol stage={b.stage} step={b.step} />
                            <span className="font-mono font-semibold">{b.code}</span>
                            <span className="text-slate-400">{b.inTank ? 'trong bồn' : 'đang làm'}</span>
                            <span className="ml-auto"><StageBadge stage={b.stage} step={b.step} /></span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {canSeePath(reportPath) && (cycles.length ? cycles : [null]).map(c => (
                    <button key={c ?? 'all'} type="button" onClick={() => openReport(sel.warehouse_id, c)} data-testid="tank-report-link"
                      className="touch-target w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100">
                      <FileBarChart className="h-3.5 w-3.5" />Báo cáo NVL{c ? ` · chu kỳ ${c}` : ''}<ExternalLink className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                </>
              })()}
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </div>
  )
}
