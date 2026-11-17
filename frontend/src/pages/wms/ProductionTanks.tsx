// TRANG "BỒN" (MES giai đoạn 1, 14/11/2026). Mỗi dòng một BỒN của kho chế biến: đang chứa / sức chứa · mã bán thành phẩm ·
// các mẻ đang nằm trong bồn (nhiều mẻ chung một bồn được) · hạn lưu gần nhất · lô chờ QA — kèm thao tác trên dòng:
// nạp từ mẻ · chuyển bồn · điều chỉnh mức (khớp đồng hồ) · xả bỏ · sổ bồn · sửa. Mỗi kho vài chục bồn ⇒ không phân trang.
// 17/11: xem mặc định là SƠ ĐỒ BỒN 2D (TankMimic — mực theo sức chứa, mỗi mẻ một lớp, phần sắp vào gạch chéo, realtime); nút đổi sang bảng.
// QA ĐẠT / KHÔNG ĐẠT bấm ở đây (áp cho mọi mẻ trong bồn) · ĐỔ BỒN (quét tem pallet của mẻ) mở từ bồn đang đứng.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { Plus, ArrowDownToLine, ArrowLeftRight, Gauge, Trash2, History, Pencil, Layers, MoreVertical, ShieldCheck, LayoutGrid, Table2 } from 'lucide-react'
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
  const mapView = f.view !== 'table'

  const whOpts = [...factories.map(w => ({ value: w.id, label: `${w.name} (nhà máy)` })), ...kitchens.map(k => ({ value: k.id, label: k.name }))]
  const defs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId, onChange: v => setF({ warehouseId: v }), pinned: true },
  ]
  const sumBy = (unit: string) => tanks.filter(t => t.unit === unit).reduce((s, t) => s + Number(t.content), 0)
  const actions: ActionItem[] = []
  if (canManage) actions.push({ key: 'new', icon: Plus, label: 'Khai bồn', tip: 'Khai bồn mới của kho chế biến', primary: true, variant: 'default', onClick: () => setForm({ open: true, tank: null }) })
  actions.push({ key: 'view', icon: mapView ? Table2 : LayoutGrid, label: mapView ? 'Bảng' : 'Sơ đồ', tip: mapView ? 'Xem dạng bảng' : 'Xem sơ đồ bồn', onClick: () => setF({ view: mapView ? 'table' : 'map' }) })
  if (canSeePath('/wms/production')) actions.push({ key: 'batches', icon: Layers, label: 'Mẻ', tip: 'Về danh sách mẻ chế biến', onClick: () => navigate('/wms/production') })

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
        <SummaryBand tiles={[
          { label: 'Bồn', value: tanks.length.toLocaleString('vi-VN') },
          { label: 'Đang chứa (L)', value: nfQty(sumBy('L')) },
          { label: 'Đang chứa (kg)', value: nfQty(sumBy('KG')) },
          { label: 'Trống', value: tanks.filter(t => !t.lots.length).length.toLocaleString('vi-VN') },
          { label: 'Chờ QA', value: tanks.filter(t => t.qa_state === 'HOLD').length.toLocaleString('vi-VN'), accent: tanks.some(t => t.qa_state === 'HOLD'), tip: 'Bồn còn mẻ QA chưa kết luận — bấm QA trên bồn' },
          { label: 'Không đạt', value: tanks.filter(t => t.qa_state === 'REJECTED').length.toLocaleString('vi-VN'), danger: tanks.some(t => t.qa_state === 'REJECTED') },
          { label: 'Quá hạn lưu', value: tanks.filter(t => t.expired).length.toLocaleString('vi-VN'), danger: tanks.some(t => t.expired), tip: 'Bồn có lô đã quá hạn lưu (giờ khai ở mã bán thành phẩm) — chỉ cảnh báo, không chặn rút' },
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {mapView && (
            <div className="p-2 sm:p-3">
              {q.isError && <p className="text-xs text-red-600">{apiMsg(q.error)}</p>}
              {!q.isError && q.isLoading && <p className="text-xs text-slate-400">Đang tải…</p>}
              {!q.isError && !q.isLoading && !tanks.length && <p className="text-xs text-slate-400">{kitchens.length ? 'Chưa khai bồn nào.' : 'Chưa có kho chế biến trong phạm vi — khai kho phụ nội bộ ở Cài đặt WMS → Kho.'}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2 sm:gap-3">
                {tanks.map(t => <TankMimic key={t.id} tank={t} onOpenBatch={id => navigate(`/wms/production/${id}`)} menu={menuFor(t)} footer={footFor(t)} />)}
              </div>
              {tanks.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-sky-500" />QA đạt</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-amber-400" />Chờ QA</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-red-500" />Không đạt / quá hạn lưu</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm border border-slate-400" style={{ background: 'repeating-linear-gradient(45deg,#94a3b8 0 1.5px,#f1f5f9 1.5px 3px)' }} />Mẻ đã đặt bồn, chưa nạp</span>
                  <span>Mỗi lớp trong bồn là một mẻ.</span>
                </p>
              )}
            </div>
          )}
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
        </div>
        <ListFooter page={1} pageSize={Math.max(tanks.length, 1)} total={tanks.length} unit="bồn" options={[]} onPageSize={() => {}} />
      </div>
      <TankFormSheet open={form.open} onClose={() => setForm({ open: false, tank: null })} tank={form.tank} defaultWarehouseId={f.warehouseId} />
      {/* bồn lấy lại từ danh sách đang sống (realtime) — người khác vừa rút / nạp thì form tính chỗ trống theo số mới */}
      <TankOpSheet open={!!op} onClose={() => setOp(null)} tank={op?.tank ? tanks.find(t => t.id === op.tank!.id) ?? op.tank : null} op={op?.op ?? 'FILL'} />
      <TankMovesSheet open={!!moves} onClose={() => setMoves(null)} tank={moves} />
      <TankQaSheet open={!!qaTank} onClose={() => setQaTank(null)} tank={qaTank ? tanks.find(t => t.id === qaTank.id) ?? qaTank : null} />
      {pourTank && <PourSheet open onClose={() => setPourTank(null)} warehouseId={pourTank.warehouse_id} canScan={canPour} canFill={canOps}
        preset={{ tankId: pourTank.id, cycle: pourTank.incoming.length === 1 ? pourTank.incoming[0].cycle : null, batchNo: pourTank.incoming.length === 1 ? pourTank.incoming[0].batch_no : null }} />}
    </div>
  )
}
