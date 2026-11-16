// BỒN (MES 14/11): form khai bồn + form thao tác (nạp từ mẻ · chuyển bồn · điều chỉnh mức · xả bỏ) + sổ bồn.
// Mọi số lượng theo đơn vị của bồn (L hoặc KG = base của mã bán thành phẩm). Lấy ra khỏi bồn chứa nhiều mẻ ⇒ BE chia theo tỷ lệ.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  useProductionWarehouses, useProductionBatches, useProductionTanks, useTankMovements, useCreateTank, useUpdateTank,
  useTankFill, useTankTransfer, useTankAdjust, useTankDiscard, TANK_MOVE_VI, type TankRow,
} from '@/api/productionHooks'
import { formatDateTime } from '@/utils/formatters'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
export const nfQty = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const parseNum = (s: string) => parseVnNumber(s)   // số kiểu VN: chấm = nghìn, phẩy = thập phân (helper tập trung)
const ErrBox = ({ msg }: { msg: string }) => (msg ? <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{msg}</div> : null)

// ── Khai / sửa bồn ─────────────────────────────────────────────────────────────────────────────
export function TankFormSheet({ open, onClose, tank, defaultWarehouseId }: { open: boolean; onClose: () => void; tank?: TankRow | null; defaultWarehouseId?: string }) {
  const { data: { kitchens } } = useProductionWarehouses()
  const [wh, setWh] = useState(''); const [code, setCode] = useState(''); const [name, setName] = useState('')
  const [cap, setCap] = useState(''); const [unit, setUnit] = useState<'L' | 'KG'>('L'); const [note, setNote] = useState('')
  const [active, setActive] = useState(true); const [err, setErr] = useState('')
  const create = useCreateTank(); const update = useUpdateTank()
  useEffect(() => {
    if (!open) return
    setErr('')
    if (tank) { setWh(tank.warehouse_id); setCode(tank.code); setName(tank.name ?? ''); setCap(vnNumberInput(tank.capacity)); setUnit(tank.unit); setNote(tank.note ?? ''); setActive(tank.is_active) }
    else {
      const k = kitchens.find(x => x.id === defaultWarehouseId) ?? kitchens.filter(x => x.parent_warehouse_id === defaultWarehouseId)[0] ?? (kitchens.length === 1 ? kitchens[0] : undefined)
      setWh(k?.id ?? ''); setCode(''); setName(''); setCap(''); setUnit('L'); setNote(''); setActive(true)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const capN = parseNum(cap)
  const saving = create.isPending || update.isPending
  async function save() {
    setErr('')
    try {
      if (tank) await update.mutateAsync({ id: tank.id, name: name || null, capacity: capN ?? undefined, unit, is_active: active, note: note || null })
      else await create.mutateAsync({ warehouse_id: wh, code, name: name || undefined, capacity: capN ?? 0, unit, note: note || undefined })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={open} onClose={onClose} title={tank ? `Sửa bồn ${tank.code}` : 'Khai bồn'}
      description="Đơn vị của bồn phải trùng đơn vị gốc của mã bán thành phẩm nạp vào (L hoặc KG)."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Huỷ</Button>
        <Button size="sm" className="h-8" disabled={saving || !wh || !code.trim() || !capN || capN <= 0} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Lưu'}</Button>
      </>}>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Kho chế biến <span className="text-red-500">*</span></Label>
          <SingleSelect value={wh} onChange={setWh} disabled={!!tank} placeholder="Chọn kho chế biến"
            options={kitchens.map(k => ({ value: k.id, label: k.name, sub: k.parent_name ? `thuộc ${k.parent_name}` : k.code }))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Mã bồn <span className="text-red-500">*</span></Label>
            <Input value={code} disabled={!!tank} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={20} placeholder="BON-01" className="h-8 text-xs mt-0.5 font-mono" /></div>
          <div><Label className="text-xs">Tên</Label>
            <Input value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="Tuỳ chọn" className="h-8 text-xs mt-0.5" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Sức chứa <span className="text-red-500">*</span></Label>
            <Input value={cap} onChange={e => setCap(e.target.value)} inputMode="decimal" placeholder="10.000" className="h-8 text-xs mt-0.5" /></div>
          <div><Label className="text-xs">Đơn vị <span className="text-red-500">*</span></Label>
            <div className="flex rounded-lg border overflow-hidden mt-0.5">
              {(['L', 'KG'] as const).map(u => (
                <button key={u} type="button" onClick={() => setUnit(u)}
                  className={['flex-1 h-8 text-xs font-medium transition-colors', unit === u ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'].join(' ')}>{u === 'L' ? 'Lít' : 'Kg'}</button>
              ))}
            </div></div>
        </div>
        <div><Label className="text-xs">Ghi chú</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Tuỳ chọn" className="h-8 text-xs mt-0.5" /></div>
        {tank && (
          <label htmlFor="tank-active" className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span className="text-xs"><span className="font-semibold">Đang dùng</span><br /><span className="text-slate-500">Tắt khi bồn ngừng dùng — bồn phải trống.</span></span>
            <Switch id="tank-active" checked={active} onCheckedChange={setActive} />
          </label>
        )}
        <ErrBox msg={err} />
      </div>
    </FormSheet>
  )
}

// ── Thao tác bồn ────────────────────────────────────────────────────────────────────────────────
export type TankOp = 'FILL' | 'TRANSFER' | 'ADJUST' | 'DISCARD'
const OP_TITLE: Record<TankOp, string> = { FILL: 'Nạp từ mẻ', TRANSFER: 'Chuyển sang bồn khác', ADJUST: 'Điều chỉnh mức bồn', DISCARD: 'Xả bỏ' }

export function TankOpSheet({ open, onClose, tank, op, presetBatchId }: {
  open: boolean; onClose: () => void; tank: TankRow | null; op: TankOp; presetBatchId?: string
}) {
  const [batchId, setBatchId] = useState(''); const [toTank, setToTank] = useState('')
  const [qty, setQty] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState('')
  const fill = useTankFill(); const transfer = useTankTransfer(); const adjust = useTankAdjust(); const discard = useTankDiscard()
  useEffect(() => { if (open) { setBatchId(presetBatchId ?? ''); setToTank(''); setQty(op === 'ADJUST' && tank ? vnNumberInput(tank.content) : ''); setReason(''); setErr('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // mẻ nạp được: mẻ chưa huỷ, chưa bị QA loại, CÙNG kho, cùng đơn vị, cùng mã với hàng đang trong bồn (đúng luật BE — khỏi chọn rồi mới bị từ chối)
  const tankMat = tank?.lots[0]?.batch?.material?.material_code ?? null
  const batches = useProductionBatches({ warehouse_id: tank?.warehouse_id, page: 1, pageSize: 200 }, open && op === 'FILL' && !!tank?.warehouse_id)
  const batchOpts = useMemo(() => (open && op === 'FILL' ? (batches.data?.rows ?? []) : [])
    .filter(b => b.status !== 'CANCELLED' && b.qa_status !== 'REJECTED' && b.warehouse_id === tank?.warehouse_id
      && (!tankMat || b.material_code === tankMat) && String(b.base_unit ?? '').toUpperCase() === tank?.unit)
    .map(b => ({ value: b.id, label: b.batch_code, sub: `${b.material_code} · ${b.prod_date}` })), [batches.data, open, op, tank?.warehouse_id, tank?.unit, tankMat])
  const tanks = useProductionTanks(tank?.warehouse_id, false, open && op === 'TRANSFER' && !!tank?.warehouse_id).data ?? []
  const targets = tanks.filter(t => t.id !== tank?.id && t.warehouse_id === tank?.warehouse_id && t.unit === tank?.unit)
  const qtyN = parseNum(qty)
  const needReason = op === 'ADJUST' || op === 'DISCARD'
  const room = tank ? tank.capacity - tank.content : 0
  const saving = fill.isPending || transfer.isPending || adjust.isPending || discard.isPending
  const target = targets.find(t => t.id === toTank)
  // báo ngay tại ô nhập, không đợi bấm Xác nhận rồi mới bị từ chối
  const qtyErr = !tank || qtyN == null ? '' : op === 'FILL' && qtyN > room + 1e-9 ? `Vượt chỗ còn trống của bồn (${nfQty(room)} ${tank.unit})`
    : (op === 'TRANSFER' || op === 'DISCARD') && qtyN > tank.content + 1e-9 ? `Bồn chỉ đang chứa ${nfQty(tank.content)} ${tank.unit}`
    : op === 'TRANSFER' && target && qtyN > target.capacity - target.content + 1e-9 ? `Bồn ${target.code} chỉ còn chỗ ${nfQty(target.capacity - target.content)} ${target.unit}`
    : op === 'ADJUST' && qtyN > tank.capacity + 1e-9 ? `Vượt sức chứa bồn (${nfQty(tank.capacity)} ${tank.unit})` : ''
  const ok = !!tank && qtyN != null && !qtyErr && (op === 'ADJUST' ? qtyN >= 0 : qtyN > 0) && (!needReason || !!reason.trim())
    && (op !== 'FILL' || !!batchId) && (op !== 'TRANSFER' || !!toTank)
  async function save() {
    if (!tank || qtyN == null) return
    setErr('')
    try {
      if (op === 'FILL') await fill.mutateAsync({ tankId: tank.id, batch_id: batchId, qty: qtyN })
      if (op === 'TRANSFER') await transfer.mutateAsync({ tankId: tank.id, to_tank_id: toTank, qty: qtyN, reason: reason || undefined })
      if (op === 'ADJUST') await adjust.mutateAsync({ tankId: tank.id, level: qtyN, reason })
      if (op === 'DISCARD') await discard.mutateAsync({ tankId: tank.id, qty: qtyN, reason })
      onClose()
    } catch (e) { setErr(apiMsg(e)) }
  }
  const u = tank?.unit ?? ''
  return (
    <FormSheet open={open} onClose={onClose} title={`${OP_TITLE[op]} — bồn ${tank?.code ?? ''}`}
      description={tank ? `Đang chứa ${nfQty(tank.content)} / ${nfQty(tank.capacity)} ${u}${op !== 'FILL' && tank.lots.length > 1 ? ' · bồn có nhiều mẻ: lượng lấy ra chia theo tỷ lệ còn lại của từng mẻ' : ''}` : undefined}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Huỷ</Button>
        <Button size="sm" className="h-8" disabled={!ok || saving} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Xác nhận'}</Button>
      </>}>
      <div className="space-y-3">
        {op === 'FILL' && (
          <div><Label className="text-xs">Mẻ <span className="text-red-500">*</span></Label>
            <SingleSelect value={batchId} onChange={setBatchId} placeholder="Chọn mẻ của kho này" options={batchOpts} /></div>
        )}
        {op === 'TRANSFER' && (
          <div><Label className="text-xs">Sang bồn <span className="text-red-500">*</span></Label>
            <SingleSelect value={toTank} onChange={setToTank} placeholder={targets.length ? 'Chọn bồn cùng kho, cùng đơn vị' : 'Không có bồn nào nhận được'}
              options={targets.map(t => ({ value: t.id, label: t.code, sub: `còn chỗ ${nfQty(t.capacity - t.content)} ${t.unit}` }))} /></div>
        )}
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">{op === 'ADJUST' ? `Mức đồng hồ hiện tại (${u})` : `Lượng (${u})`} <span className="text-red-500">*</span></Label>
            {(op === 'TRANSFER' || op === 'DISCARD') && tank && tank.content > 0 &&
              <button type="button" className="text-[11px] text-blue-600 hover:underline touch-target" onClick={() => setQty(vnNumberInput(tank.content))}>Hết bồn ({nfQty(tank.content)} {u})</button>}
          </div>
          <Input value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ok && !saving) void save() }}
            inputMode="decimal" autoFocus className={`h-9 sm:h-8 text-sm mt-0.5 ${qtyErr ? 'border-red-400' : ''}`} />
          {qtyErr && <p className="text-[11px] text-red-600 mt-0.5">{qtyErr}</p>}
          {op === 'FILL' && tank && <p className="text-[11px] text-slate-500 mt-0.5">Còn chỗ {nfQty(room)} {u}</p>}
          {op === 'ADJUST' && tank && qtyN != null && <p className="text-[11px] text-slate-500 mt-0.5">Chênh {qtyN - tank.content > 0 ? '+' : ''}{nfQty(qtyN - tank.content)} {u} so với sổ</p>}
        </div>
        {(needReason || op === 'TRANSFER') && (
          <div><Label className="text-xs">Lý do {needReason && <span className="text-red-500">*</span>}</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder={needReason ? (op === 'DISCARD' ? 'QA loại · quá hạn lưu · nhiễm…' : 'Đọc đồng hồ mức cuối ca…') : 'Tuỳ chọn'} className="h-8 text-xs mt-0.5" /></div>
        )}
        <ErrBox msg={err} />
      </div>
    </FormSheet>
  )
}

// ── Sổ bồn ─────────────────────────────────────────────────────────────────────────────────────
export function TankMovesSheet({ open, onClose, tank }: { open: boolean; onClose: () => void; tank: TankRow | null }) {
  const q = useTankMovements(open ? tank?.id ?? null : null)
  const rows = q.data?.rows ?? []
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-3xl" title={`Sổ bồn ${tank?.code ?? ''}`}
      description={`Mọi lần nạp · rút cho đóng gói · chuyển · điều chỉnh · xả — mới nhất trước${q.data && q.data.total > rows.length ? ` (hiện ${rows.length}/${q.data.total})` : ''}`}
      footer={<Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>}>
      <div className="overflow-auto border rounded-lg text-xs">
        <table className="w-full">
          <thead><tr className="bg-slate-50 text-[9px] text-slate-500">
            {['Lúc', 'Việc', 'Mẻ', 'Lượng', 'Người', 'Lý do / cảnh báo'].map(h => <th key={h} className="px-2 py-1 text-left whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={6} className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{q.isLoading ? 'Đang tải…' : 'Chưa có thao tác nào'}</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-2 py-1 whitespace-nowrap tabular-nums text-[10px]">{formatDateTime(r.created_at)}</td>
                <td className="px-2 py-1 whitespace-nowrap"><StatusBadge tone={r.qty > 0 ? 'green' : r.kind === 'DISCARD' ? 'red' : r.kind === 'DRAW' ? 'blue' : 'slate'}>{TANK_MOVE_VI[r.kind]}</StatusBadge></td>
                <td className="px-2 py-1 whitespace-nowrap font-mono text-[10px]">{r.batch?.batch_code ?? '—'}</td>
                <td className={`px-2 py-1 whitespace-nowrap text-right font-semibold tabular-nums text-[10px] ${r.qty < 0 ? 'text-slate-700' : 'text-green-700'}`}>{r.qty > 0 ? '+' : ''}{nfQty(r.qty)}</td>
                <td className="px-2 py-1 whitespace-nowrap text-[10px]">{r.created_by_name ?? '—'}</td>
                <td className="px-2 py-1 text-[10px] max-w-[260px] truncate" title={[r.reason, r.warning].filter(Boolean).join(' · ')}>
                  {r.reason ?? ''}{r.warning && <span className="text-amber-700">{r.reason ? ' · ' : ''}{r.warning}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FormSheet>
  )
}

// ── Nạp mẻ vào bồn (mở từ trang chi tiết mẻ: chọn BỒN, mẻ đã biết) ─────────────────────────────────
export function BatchFillSheet({ open, onClose, batchId, batchCode, warehouseId, unit, materialCode, suggestQty }: {
  open: boolean; onClose: () => void; batchId: string; batchCode: string; warehouseId: string; unit: string | null
  /** mã BTP của mẻ — bồn đang chứa mã khác không hiện ra để chọn */
  materialCode?: string | null
  /** lượng gợi ý điền sẵn (kế hoạch − đã nạp) */
  suggestQty?: number | null
}) {
  const [tankId, setTankId] = useState(''); const [qty, setQty] = useState(''); const [err, setErr] = useState('')
  const fill = useTankFill()
  const tanks = useProductionTanks(warehouseId, false, open && !!warehouseId).data ?? []
  useEffect(() => { if (open) { setTankId(''); setQty(suggestQty && suggestQty > 0 ? vnNumberInput(suggestQty) : ''); setErr('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const u = String(unit ?? '').toUpperCase()
  const usable = tanks.filter(t => t.warehouse_id === warehouseId && t.unit === u
    && (!t.lots.length || !materialCode || t.lots[0].batch?.material?.material_code === materialCode))
  // chọn sẵn bồn: bồn đang chứa chính mẻ này (nạp tiếp), không thì bồn duy nhất dùng được
  const usableKey = usable.map(t => t.id).join(',')
  useEffect(() => {
    if (!open || tankId || !usable.length) return
    const pick = usable.find(t => t.lots.some(l => l.batch_id === batchId)) ?? (usable.length === 1 ? usable[0] : undefined)
    if (pick) setTankId(pick.id)
  }, [open, usableKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const tank = usable.find(t => t.id === tankId)
  const qtyN = parseNum(qty)
  const room = tank ? tank.capacity - tank.content : 0
  const over = !!tank && qtyN != null && qtyN > room + 1e-9
  async function save() {
    if (!tank || !qtyN) return
    setErr('')
    try { await fill.mutateAsync({ tankId: tank.id, batch_id: batchId, qty: qtyN }); onClose() } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={open} onClose={onClose} title={`Nạp mẻ ${batchCode} vào bồn`}
      description="Một bồn chỉ chứa một mã bán thành phẩm; nhiều mẻ cùng mã được nạp chung một bồn."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Huỷ</Button>
        <Button size="sm" className="h-8" disabled={!tank || !qtyN || qtyN <= 0 || over || fill.isPending} onClick={() => void save()}>{fill.isPending ? 'Đang nạp…' : 'Nạp'}</Button>
      </>}>
      <div className="space-y-3">
        <div><Label className="text-xs">Bồn <span className="text-red-500">*</span></Label>
          <SingleSelect value={tankId} onChange={setTankId} placeholder={usable.length ? 'Chọn bồn' : `Chưa có bồn nào nhận được mẻ này (bồn ${u || '—'}, trống hoặc cùng mã)`}
            options={usable.map(t => ({ value: t.id, label: t.code, sub: `còn chỗ ${nfQty(t.capacity - t.content)} ${t.unit}${t.lots.length ? ` · đang chứa ${t.lots.map(l => l.batch?.batch_code).join(', ')}` : ' · trống'}` }))} /></div>
        <div><Label className="text-xs">Lượng nạp ({u}) <span className="text-red-500">*</span></Label>
          <Input value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && tank && qtyN && qtyN > 0 && !over && !fill.isPending) void save() }}
            inputMode="decimal" autoFocus className={`h-9 sm:h-8 text-sm mt-0.5 ${over ? 'border-red-400' : ''}`} />
          {tank && <p className={`text-[11px] mt-0.5 ${over ? 'text-red-600' : 'text-slate-500'}`}>{over ? 'Vượt chỗ còn trống — bồn' : 'Bồn'} còn chỗ {nfQty(room)} {tank.unit}</p>}</div>
        <ErrBox msg={err} />
      </div>
    </FormSheet>
  )
}
