// CHI TIẾT MẺ CHẾ BIẾN (MES giai đoạn 1, 14/11/2026). Header: mã lô + trạng thái + QA + nút (Rút NVL là việc chính khi mẻ đang mở).
// Khối NGUYÊN LIỆU ĐÃ RÚT (sổ tiêu hao: tem · NSX · lượng · cách ghi · huỷ dòng hoàn tồn) · khối RA BỒN (lô của mẻ trong từng bồn +
// sổ nạp / rút). Số lượng NVL in theo đơn vị của MÃ đó (qtyLabel), số bồn in theo đơn vị bồn.
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { ArrowLeft, Plus, Pencil, Lock, Unlock, XCircle, ShieldCheck, ShieldAlert, ShieldX, Container, Undo2, Copy, AlertTriangle } from 'lucide-react'
import { TableBody, TableCell, TableRow } from '@/components/ui/table'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { TableEmptyRow } from '@/components/shared/TableEmptyRow'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { CollapseSection } from '@/components/shared/CollapseSection'
import { useConfirmDialog } from '@/components/shared/ConfirmDialog'
import { BatchFormSheet } from '@/components/wms/production/BatchFormSheet'
import { ConsumeSheet } from '@/components/wms/production/ConsumeSheet'
import { BatchFillSheet, nfQty } from '@/components/wms/production/TankSheets'
import { useAuthStore } from '@/stores/authStore'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { can, type ModulePermissions } from '@/config/permissions'
import { rowText, statusText } from '@/lib/rowStatus'
import {
  useProductionBatch, useBatchStatus, useBatchQa, useReverseConsumption, BATCH_STATUS_VI, BATCH_QA_VI, TANK_MOVE_VI, type BatchQa,
} from '@/api/productionHooks'
import { BATCH_STATUS_TONE, BATCH_QA_TONE, batchRowKey } from './ProductionBatches'
import { qtyLabel, unitLabel } from '@/utils/qtyUnits'
import { formatDate, formatDateTime } from '@/utils/formatters'

const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'
const NUM = `${TD} text-right font-semibold tabular-nums`
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const RM_COLS: RtColDef[] = [
  { id: 'mat', label: 'Nguyên liệu', w: 170 }, { id: 'qty', label: 'Lượng rút', w: 110, align: 'right' }, { id: 'pallet', label: 'Tem', w: 210 },
  { id: 'nsx', label: 'NSX', w: 78 }, { id: 'lot', label: 'Mã lô', w: 110 }, { id: 'src', label: 'Cách ghi', w: 86 },
  { id: 'at', label: 'Lúc', w: 120 }, { id: 'by', label: 'Người rút', w: 130 }, { id: 'act', label: '', w: 60, stickyRight: true },
]
const LOT_COLS: RtColDef[] = [
  { id: 'tank', label: 'Bồn', w: 90 }, { id: 'in', label: 'Đã nạp', w: 100, align: 'right' }, { id: 'rem', label: 'Còn trong bồn', w: 110, align: 'right' },
  { id: 'filled', label: 'Nạp lúc', w: 120 }, { id: 'exp', label: 'Hạn lưu bồn', w: 120 }, { id: 'st', label: 'Trạng thái', w: 90 },
]
const MOVE_COLS: RtColDef[] = [
  { id: 'at', label: 'Lúc', w: 120 }, { id: 'kind', label: 'Việc', w: 110 }, { id: 'tank', label: 'Bồn', w: 80 },
  { id: 'qty', label: 'Lượng', w: 100, align: 'right' }, { id: 'by', label: 'Người', w: 130 }, { id: 'note', label: 'Lý do / cảnh báo', w: 260 },
]

export default function ProductionBatchDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const perms = useAuthStore(s => s.user)?.module_permissions as ModulePermissions | null ?? null
  const q = useProductionBatch(id)
  const b = q.data
  const setStatus = useBatchStatus()
  const setQa = useBatchQa()
  const reverse = useReverseConsumption()
  const [ask, confirmNode] = useConfirmDialog()
  const canSeeTanks = useCanSeePath()('/wms/production/tanks')
  // Vừa mở mẻ xong (form Mở mẻ chuyển sang đây kèm cờ) ⇒ bật luôn form Rút NVL — việc kế tiếp gần như luôn là rút
  const loc = useLocation()
  const fromCreate = !!(loc.state as { consume?: boolean } | null)?.consume
  const [consumeOpen, setConsumeOpen] = useState(fromCreate && can(perms, 'production', 'consume'))
  useEffect(() => { if (fromCreate) navigate(loc.pathname, { replace: true, state: null }) }, []) // eslint-disable-line react-hooks/exhaustive-deps -- gỡ cờ một lần: tải lại trang không bật lại form
  const [fillOpen, setFillOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [err, setErr] = useState('')

  if (q.isLoading) return <div className="p-6 text-sm text-slate-500">Đang tải mẻ…</div>
  if (q.isError || !b) return (
    <div className="p-6 text-sm space-y-2">
      <p className="text-red-600">{q.isError ? apiMsg(q.error) : 'Không tìm thấy mẻ'}</p>
      <button type="button" onClick={() => navigate('/wms/production')} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" />Về danh sách mẻ
      </button>
    </div>
  )

  const u = unitLabel(b.material?.base_unit)
  const open = b.status === 'OPEN'
  const live = b.consumption.filter(c => !c.reversed_at)
  const filled = b.movements.filter(m => m.kind === 'FILL').reduce((s, m) => s + Number(m.qty), 0)
  const inTank = b.lots.filter(l => l.status === 'ACTIVE').reduce((s, l) => s + Number(l.qty_remaining), 0)
  const drawn = -b.movements.filter(m => m.kind === 'DRAW').reduce((s, m) => s + Number(m.qty), 0)
  const rmMats = new Set(live.map(c => c.material_id)).size

  async function run(fn: () => Promise<unknown>) { setErr(''); try { await fn() } catch (e) { setErr(apiMsg(e)) } }
  async function doQa(next: BatchQa) {
    const needNote = next === 'REJECTED'
    const note = await ask({
      title: next === 'RELEASED' ? `QA thả lô ${b!.batch_code}?` : next === 'REJECTED' ? `QA loại lô ${b!.batch_code}?` : `Giữ QA lô ${b!.batch_code}?`,
      body: next === 'REJECTED' ? 'Lô bị loại không nạp thêm vào bồn được, và bồn đang chứa lô này sẽ KHÔNG rút cho đóng gói được cho tới khi xả bỏ ở màn Bồn.' : undefined,
      danger: next === 'REJECTED', input: { label: needNote ? 'Lý do loại' : 'Ghi chú (tuỳ chọn)', required: needNote },
    })
    if (note === null) return
    await run(() => setQa.mutateAsync({ id: b!.id, qa_status: next, note: note || undefined }))
  }
  async function doStatus(action: 'close' | 'reopen' | 'cancel') {
    const label = action === 'close' ? 'Đóng mẻ' : action === 'reopen' ? 'Mở lại mẻ' : 'Huỷ mẻ'
    const ok = await ask({ title: `${label} ${b!.batch_code}?`, danger: action === 'cancel',
      body: action === 'close' ? 'Mẻ đã đóng không rút thêm nguyên liệu được (mở lại khi cần).' : action === 'cancel' ? 'Chỉ huỷ được mẻ chưa rút nguyên liệu và chưa nạp bồn.' : undefined })
    if (ok === null) return
    await run(() => setStatus.mutateAsync({ id: b!.id, action }))
  }
  async function doReverse(cid: string, label: string) {
    const reason = await ask({ title: `Huỷ dòng rút ${label}?`, body: 'Lượng đã rút được hoàn lại đúng tem / dòng tồn đó. Dòng huỷ vẫn giữ trong sổ để truy vết.', danger: true,
      input: { label: 'Lý do huỷ', required: true, placeholder: 'Quét nhầm tem · nhập sai số…' } })
    if (!reason) return
    await run(() => reverse.mutateAsync({ id: cid, reason }))
  }

  const busy = setStatus.isPending || setQa.isPending
  const actions: ActionItem[] = []
  if (open && can(perms, 'production', 'consume'))
    actions.push({ key: 'consume', icon: Plus, label: 'Rút NVL', tip: 'Rút nguyên liệu vào mẻ — quét tem hoặc chọn lô khi không có tem', primary: true, variant: 'default', onClick: () => setConsumeOpen(true) })
  const canConsume = open && can(perms, 'production', 'consume')
  const canFill = b.status !== 'CANCELLED' && b.qa_status !== 'REJECTED' && can(perms, 'production', 'tank_ops')
  // Nạp bồn là bước kế của Rút NVL ⇒ nút có CHỮ (không chỉ icon); người chỉ làm QA thì "QA thả" là nút có chữ
  if (canFill)
    actions.push({ key: 'fill', icon: Container, label: 'Nạp bồn', tip: 'Nạp bán thành phẩm của mẻ vào bồn', primary: true, onClick: () => setFillOpen(true) })
  if (b.status !== 'CANCELLED' && can(perms, 'production', 'qa_release')) {
    if (b.qa_status !== 'RELEASED') actions.push({ key: 'qa-ok', icon: ShieldCheck, label: 'QA thả', tip: 'QA cho phép dùng lô bán thành phẩm này', primary: !canConsume && !canFill, onClick: () => void doQa('RELEASED'), disabled: busy })
    if (b.qa_status !== 'HOLD') actions.push({ key: 'qa-hold', icon: ShieldAlert, label: 'Giữ QA', tip: 'Đưa lô về trạng thái chờ QA', onClick: () => void doQa('HOLD'), disabled: busy })
    if (b.qa_status !== 'REJECTED') actions.push({ key: 'qa-no', icon: ShieldX, label: 'QA loại', tip: 'Loại lô (bắt buộc lý do)', danger: true, onClick: () => void doQa('REJECTED'), disabled: busy })
  }
  if (can(perms, 'production', 'open_batch')) {
    if (b.status !== 'CANCELLED') actions.push({ key: 'edit', icon: Pencil, label: 'Sửa', tip: 'Sửa ngày / máy / ca / kế hoạch / ghi chú (mã lô và mã BTP chỉ đổi khi chưa rút, chưa nạp)', onClick: () => setEditOpen(true) })
    if (open) actions.push({ key: 'close', icon: Lock, label: 'Đóng mẻ', tip: 'Đóng mẻ — không rút thêm nguyên liệu', onClick: () => void doStatus('close'), disabled: busy })
    if (b.status === 'CLOSED') actions.push({ key: 'reopen', icon: Unlock, label: 'Mở lại', tip: 'Mở lại mẻ để rút thêm / huỷ dòng rút', onClick: () => void doStatus('reopen'), disabled: busy })
    actions.push({ key: 'clone', icon: Copy, label: 'Mở mẻ giống', tip: 'Mở mẻ mới cùng kho · mã bán thành phẩm · máy · ca · kế hoạch (ngày hôm nay, mã lô mới)', onClick: () => setCloneOpen(true) })
    if (b.status !== 'CANCELLED') actions.push({ key: 'cancel', icon: XCircle, label: 'Huỷ mẻ', tip: 'Huỷ mẻ mở nhầm (chưa rút, chưa nạp)', danger: true, onClick: () => void doStatus('cancel'), disabled: busy })
  }
  const canReverse = open && can(perms, 'production', 'reverse')

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 pt-2 pb-2 space-y-1 sm:px-4 sm:pt-3 sm:pb-3 sm:space-y-2 shrink-0 sm:rounded-t-xl">
          <div className="flex items-center justify-between gap-x-2 gap-y-1.5 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <button type="button" onClick={() => navigate('/wms/production')} className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0 transition-colors" title="Về danh sách mẻ">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className={`font-semibold font-mono text-xs sm:text-sm leading-tight break-all whitespace-normal sm:truncate min-w-0 ${statusText(batchRowKey(b))}`}>{b.batch_code}</span>
              <StatusBadge tone={BATCH_STATUS_TONE[b.status]}>{BATCH_STATUS_VI[b.status]}</StatusBadge>
              <StatusBadge tone={BATCH_QA_TONE[b.qa_status]} title={b.qa_note ?? undefined}>{BATCH_QA_VI[b.qa_status]}</StatusBadge>
            </div>
            <ActionCluster mobileInline items={actions} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:gap-x-4 text-xs text-slate-600">
            <span><span className="text-slate-400 text-[10px]">Bán thành phẩm:</span> <span className="font-mono font-semibold">{b.material?.material_code}</span> {b.material?.short_name ?? ''}</span>
            <span><span className="text-slate-400 text-[10px]">Ngày SX:</span> {formatDate(b.prod_date)}</span>
            <span><span className="text-slate-400 text-[10px]">Kho:</span> {b.warehouse?.name ?? '—'}</span>
            {(b.machine_code || b.shift) && <span><span className="text-slate-400 text-[10px]">Máy · Ca:</span> {[b.machine_code, b.shift].filter(Boolean).join(' · ')}</span>}
            {b.material?.tank_hold_hours && <span><span className="text-slate-400 text-[10px]">Hạn lưu bồn:</span> {b.material.tank_hold_hours} giờ</span>}
            <span className="hidden sm:inline"><span className="text-slate-400 text-[10px]">Mở:</span> {b.opened_by_name ?? '—'} · {formatDateTime(b.created_at)}</span>
            {b.qa_at && <span className="hidden sm:inline"><span className="text-slate-400 text-[10px]">QA:</span> {b.qa_by_name ?? '—'} · {formatDateTime(b.qa_at)}{b.qa_note ? ` · ${b.qa_note}` : ''}</span>}
            {b.note && <span className="hidden sm:inline text-slate-500">{b.note}</span>}
          </div>
          {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{err}</div>}
          {b.qa_status === 'REJECTED' && inTank > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700 flex items-center gap-1.5 flex-wrap">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>Lô bị QA loại còn <b className="tabular-nums">{nfQty(inTank)} {u}</b> trong bồn — bồn đó không rút cho đóng gói được cho tới khi xả bỏ.</span>
              {canSeeTanks && <button type="button" className="underline font-semibold" onClick={() => navigate('/wms/production/tanks')}>Mở màn Bồn</button>}
            </div>
          )}
        </div>
        <SummaryBand tiles={[
          { label: 'Dòng NVL', value: live.length.toLocaleString('vi-VN'), tip: `${rmMats} mã nguyên liệu đã rút vào mẻ (không tính dòng đã huỷ)` },
          { label: 'Mã NVL', value: rmMats.toLocaleString('vi-VN') },
          { label: `Kế hoạch (${u})`, value: b.planned_qty != null ? nfQty(b.planned_qty) : '—' },
          { label: `Đã nạp (${u})`, value: nfQty(filled) },
          { label: `Còn bồn (${u})`, value: nfQty(inTank) },
          { label: `Đã đóng gói (${u})`, value: nfQty(drawn), tip: 'Phần của mẻ đã rút khỏi bồn cho các trang Sổ đóng gói (bồn nhiều mẻ ⇒ chia theo tỷ lệ)' },
        ]} />
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5">
            <span className="h-3.5 w-1 rounded-full bg-sky-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Nguyên liệu đã rút</h2>
            <span className="text-[11px] text-slate-400">{live.length} dòng{b.consumption.length > live.length ? ` · ${b.consumption.length - live.length} dòng đã huỷ` : ''}</span>
          </div>
          <ResizableTable storageKey="production_batch_rm_cols_v2" cols={RM_COLS}>
            <TableBody>
              {!b.consumption.length && <TableEmptyRow colSpan={RM_COLS.length}>{open ? 'Chưa rút nguyên liệu nào — bấm "Rút NVL".' : 'Mẻ không có dòng rút nguyên liệu.'}</TableEmptyRow>}
              {b.consumption.map(c => {
                const gone = !!c.reversed_at
                return (
                  <TableRow key={c.id} className={gone ? `${rowText('completed')} opacity-70` : ''} title={gone ? `Huỷ: ${c.reversed_by_name ?? ''} · ${c.reverse_reason ?? ''}` : undefined}>
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white truncate`} title={c.material?.short_name ?? ''}><span className="font-mono font-semibold">{c.material?.material_code}</span> {c.material?.short_name ?? ''}</TableCell>
                    <TableCell className={NUM}>{qtyLabel(Number(c.qty), c.material)}</TableCell>
                    <TableCell className={`${TD} font-mono truncate`} title={c.pallet_code}>{c.pallet_code}</TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{c.production_date ? formatDate(c.production_date) : <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={`${TD} font-mono`}>{c.batch_lot ?? <span className="text-slate-300">—</span>}</TableCell>
                    <TableCell className={TD}>{gone ? <StatusBadge tone="slate">Đã huỷ</StatusBadge> : <StatusBadge tone={c.source === 'SCAN' ? 'sky' : 'purple'}>{c.source === 'SCAN' ? 'Quét tem' : 'Theo lô'}</StatusBadge>}</TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{formatDateTime(c.created_at)}</TableCell>
                    <TableCell className={`${TD} truncate`}>{c.created_by_name ?? '—'}</TableCell>
                    <TableCell className={`${TD} sticky right-0 z-10 bg-white text-right`}>
                      {canReverse && !gone && (
                        <button type="button" onClick={e => { e.stopPropagation(); void doReverse(c.id, `${c.pallet_code} (${qtyLabel(Number(c.qty), c.material)})`) }}
                          className="px-1.5 py-1 rounded text-slate-500 hover:text-red-600 hover:bg-red-50" title="Huỷ dòng rút ghi nhầm (hoàn tồn)">
                          <Undo2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>

          <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-100 border-y border-slate-200 flex items-center gap-1.5 mt-3">
            <span className="h-3.5 w-1 rounded-full bg-sky-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Ra bồn</h2>
            <span className="text-[11px] text-slate-400">{b.lots.length} lần vào bồn</span>
          </div>
          <ResizableTable storageKey="production_batch_lot_cols_v1" cols={LOT_COLS}>
            <TableBody>
              {!b.lots.length && <TableEmptyRow colSpan={LOT_COLS.length}>Chưa nạp bồn nào.</TableEmptyRow>}
              {b.lots.map(l => {
                const expired = !!l.expires_at && Date.parse(l.expires_at) < Date.now() && l.status === 'ACTIVE'
                return (
                  <TableRow key={l.id} className={l.status === 'EMPTY' ? rowText('full') : ''}>
                    <TableCell className={`${TD} sticky left-0 z-10 bg-white font-mono font-semibold`}>{l.tank?.code ?? '—'}</TableCell>
                    <TableCell className={NUM}>{nfQty(l.qty_in)} <span className="text-slate-400 font-normal">{l.tank?.unit}</span></TableCell>
                    <TableCell className={NUM}>{nfQty(l.qty_remaining)} <span className="text-slate-400 font-normal">{l.tank?.unit}</span></TableCell>
                    <TableCell className={`${TD} tabular-nums`}>{formatDateTime(l.filled_at)}</TableCell>
                    <TableCell className={`${TD} tabular-nums ${expired ? 'text-red-600 font-semibold' : ''}`}>{l.expires_at ? formatDateTime(l.expires_at) : <span className="text-slate-300">không giới hạn</span>}</TableCell>
                    <TableCell className={TD}>{l.status === 'ACTIVE' ? (expired ? <StatusBadge tone="red">Quá hạn lưu</StatusBadge> : <StatusBadge tone="green">Trong bồn</StatusBadge>) : <StatusBadge tone="slate">Đã hết</StatusBadge>}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ResizableTable>

          <div className="mt-3">
            <CollapseSection title={`Sổ nạp / rút của mẻ (${b.movements.length})`}>
              <ResizableTable storageKey="production_batch_move_cols_v1" cols={MOVE_COLS}>
                <TableBody>
                  {!b.movements.length && <TableEmptyRow colSpan={MOVE_COLS.length}>Chưa có thao tác bồn nào.</TableEmptyRow>}
                  {b.movements.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className={`${TD} sticky left-0 z-10 bg-white tabular-nums`}>{formatDateTime(m.created_at)}</TableCell>
                      <TableCell className={TD}>{TANK_MOVE_VI[m.kind]}</TableCell>
                      <TableCell className={`${TD} font-mono`}>{m.tank?.code ?? '—'}</TableCell>
                      <TableCell className={NUM}>{m.qty > 0 ? '+' : ''}{nfQty(m.qty)}</TableCell>
                      <TableCell className={`${TD} truncate`}>{m.created_by_name ?? '—'}</TableCell>
                      <TableCell className={`${TD} truncate`} title={[m.reason, m.warning].filter(Boolean).join(' · ')}>
                        {m.reason ?? ''}{m.warning && <span className="text-amber-700">{m.reason ? ' · ' : ''}{m.warning}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ResizableTable>
            </CollapseSection>
          </div>
        </div>
      </div>
      {open && <ConsumeSheet open={consumeOpen} onClose={() => setConsumeOpen(false)} batch={b} />}
      <BatchFillSheet open={fillOpen} onClose={() => setFillOpen(false)} batchId={b.id} batchCode={b.batch_code} warehouseId={b.warehouse_id} unit={b.material?.base_unit ?? null}
        materialCode={b.material?.material_code ?? null} suggestQty={b.planned_qty != null ? Math.round((Number(b.planned_qty) - filled) * 1000) / 1000 : null} />
      <BatchFormSheet open={editOpen} onClose={() => setEditOpen(false)} batch={b} />
      <BatchFormSheet open={cloneOpen} onClose={() => setCloneOpen(false)} template={b}
        onSaved={nid => navigate(`/wms/production/${nid}`, { state: { consume: true } })} />
      {confirmNode}
    </div>
  )
}
