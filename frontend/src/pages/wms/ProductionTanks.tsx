// TRANG "BỒN" (MES giai đoạn 1, 14/11/2026). Mỗi dòng một BỒN của kho chế biến: đang chứa / sức chứa · mã bán thành phẩm ·
// các mẻ đang nằm trong bồn (nhiều mẻ chung một bồn được) · hạn lưu gần nhất · lô chờ QA — kèm thao tác trên dòng:
// nạp từ mẻ · chuyển bồn · điều chỉnh mức (khớp đồng hồ) · xả bỏ · sổ bồn · sửa. Mỗi kho vài chục bồn ⇒ không phân trang.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { Plus, ArrowDownToLine, ArrowLeftRight, Gauge, Trash2, History, Pencil, Layers, MoreVertical } from 'lucide-react'
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
  const { data: { kitchens, factories } } = useProductionWarehouses()
  const q = useProductionTanks(f.warehouseId || undefined, f.showInactive)
  const tanks = q.data ?? []
  const [form, setForm] = useState<{ open: boolean; tank: TankRow | null }>({ open: false, tank: null })
  const [op, setOp] = useState<{ tank: TankRow | null; op: TankOp } | null>(null)
  const [moves, setMoves] = useState<TankRow | null>(null)

  const whOpts = [...factories.map(w => ({ value: w.id, label: `${w.name} (nhà máy)` })), ...kitchens.map(k => ({ value: k.id, label: k.name }))]
  const defs: FilterDef[] = [
    { key: 'wh', label: 'Kho', type: 'single', options: whOpts, value: f.warehouseId, onChange: v => setF({ warehouseId: v }), pinned: true },
  ]
  const sumBy = (unit: string) => tanks.filter(t => t.unit === unit).reduce((s, t) => s + Number(t.content), 0)
  const actions: ActionItem[] = []
  if (canManage) actions.push({ key: 'new', icon: Plus, label: 'Khai bồn', tip: 'Khai bồn mới của kho chế biến', primary: true, variant: 'default', onClick: () => setForm({ open: true, tank: null }) })
  if (canSeePath('/wms/production')) actions.push({ key: 'batches', icon: Layers, label: 'Mẻ', tip: 'Về danh sách mẻ chế biến', onClick: () => navigate('/wms/production') })

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
          { label: 'Có lô chờ QA', value: tanks.filter(t => t.qa_pending).length.toLocaleString('vi-VN'), accent: tanks.some(t => t.qa_pending) },
          { label: 'Quá hạn lưu', value: tanks.filter(t => t.expired).length.toLocaleString('vi-VN'), danger: tanks.some(t => t.expired), tip: 'Bồn có lô đã quá hạn lưu (giờ khai ở mã bán thành phẩm) — chỉ cảnh báo, không chặn rút' },
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <ResizableTable storageKey="production_tanks_cols_v2" cols={COLS}>
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
                      {!t.lots.length ? <span className="text-slate-300">—</span> : pendingQa.length ? <StatusBadge tone="amber">{pendingQa.length} lô chờ QA</StatusBadge> : <StatusBadge tone="green">QA thả</StatusBadge>}
                    </TableCell>
                    <TableCell className={`${TD} truncate`}>{t.warehouse?.name ?? '—'}</TableCell>
                    <TableCell className={`${TD} sticky right-0 z-10 bg-white text-center`}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="inline-flex items-center justify-center px-1.5 py-1 rounded text-slate-500 hover:bg-slate-100" title="Thao tác bồn"><MoreVertical className="h-3.5 w-3.5" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs">
                          {canOps && t.is_active && <DropdownMenuItem onSelect={() => setOp({ tank: t, op: 'FILL' })}><ArrowDownToLine className="h-3.5 w-3.5 mr-2" />Nạp từ mẻ</DropdownMenuItem>}
                          {canOps && <DropdownMenuItem disabled={!Number(t.content)} onSelect={() => setOp({ tank: t, op: 'TRANSFER' })}><ArrowLeftRight className="h-3.5 w-3.5 mr-2" />Chuyển sang bồn khác</DropdownMenuItem>}
                          {canOps && <DropdownMenuItem disabled={!t.lots.length} onSelect={() => setOp({ tank: t, op: 'ADJUST' })}><Gauge className="h-3.5 w-3.5 mr-2" />Điều chỉnh mức (khớp đồng hồ)</DropdownMenuItem>}
                          {canOps && <DropdownMenuItem disabled={!Number(t.content)} className="text-red-600" onSelect={() => setOp({ tank: t, op: 'DISCARD' })}><Trash2 className="h-3.5 w-3.5 mr-2" />Xả bỏ</DropdownMenuItem>}
                          <DropdownMenuItem onSelect={() => setMoves(t)}><History className="h-3.5 w-3.5 mr-2" />Sổ bồn</DropdownMenuItem>
                          {canManage && <DropdownMenuItem onSelect={() => setForm({ open: true, tank: t })}><Pencil className="h-3.5 w-3.5 mr-2" />Sửa bồn</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>
        </div>
        <ListFooter page={1} pageSize={Math.max(tanks.length, 1)} total={tanks.length} unit="bồn" options={[]} onPageSize={() => {}} />
      </div>
      <TankFormSheet open={form.open} onClose={() => setForm({ open: false, tank: null })} tank={form.tank} defaultWarehouseId={f.warehouseId} />
      <TankOpSheet open={!!op} onClose={() => setOp(null)} tank={op?.tank ?? null} op={op?.op ?? 'FILL'} />
      <TankMovesSheet open={!!moves} onClose={() => setMoves(null)} tank={moves} />
    </div>
  )
}
