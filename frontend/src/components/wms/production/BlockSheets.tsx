// HÀNG CHẶN — "NVL đã mất" (rà soát MES 25/11, user chốt: "Về nguyên lý tồn phải về làm tồn ảo trước, nhưng nếu nó đã sử dụng hoặc không tái dùng
// được phần nào thì phải được ghi nhận (block toàn bộ hoặc phần nào, có lý do)" · "Huỷ lô nào thì tồn lô đó hồi về, block đúng lô. Điều chỉnh thì
// làm đúng lô block"). Các form ở đây:
//   • ReverseLineSheet — huỷ một dòng cấp: hoàn ĐỦ về đúng tem / lô; phần không tái dùng được nhập ở ô "Chặn" (kèm lý do)
//   • CancelBatchSheet — huỷ mẻ đã cấp NVL (mẻ hỏng trước khi nạp bồn): mỗi dòng cấp một ô Chặn, một lý do, MỘT giao dịch
//   • ShiftAdjustSheet — "Điều chỉnh tồn theo số đếm" ở ca đã chốt mới nhất: xoá đúng các lô chặn của mã đếm thiếu (quyền Điều chỉnh tồn)
//   • BlockActSheet   — xoá khỏi tồn / bỏ chặn MỘT lô chặn (tab Chênh lệch tồn)
// Phần chặn vẫn nằm trong TỒN SỔ của kho (báo cáo ca: sổ = dùng được + đang chặn) nhưng không cấp / xuất được — chờ điều chỉnh.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormSheet } from '@/components/shared/FormSheet'
import { QtyInput } from '@/components/shared/QtyInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  useReverseConsumption, useCancelBatch, useShiftAdjustPlan, useShiftAdjust, useBlockAct,
  type ConsumptionRow, type BlockRow,
} from '@/api/productionHooks'
import { qtyNum, qtyCode, matUnitCode } from '@/utils/unitCode'
import { formatDate, formatDateTime } from '@/utils/formatters'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const r3 = (n: number) => Math.round(n * 1000) / 1000
const ErrBox = ({ msg }: { msg: string }) => msg ? <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{msg}</div> : null
const BLOCK_HINT = 'Phần chặn vẫn nằm trong tồn sổ của kho nhưng không cấp / xuất được. Người có quyền Điều chỉnh tồn xoá nó khỏi tồn (theo số đếm cuối ca) hoặc bỏ chặn nếu dùng lại được.'

/** dòng cấp: tem / lô + lượng đã cấp */
function LineHead({ c }: { c: ConsumptionRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate"><span className="font-mono font-semibold">{c.material?.material_code}</span> <span className="text-slate-600">{c.material?.short_name ?? ''}</span></p>
      <p className="text-[11px] text-slate-500 truncate">
        <span className="font-mono">{c.pallet_code}</span>{c.production_date ? ` · NSX ${formatDate(c.production_date)}` : ''}{c.batch_lot ? ` · lô ${c.batch_lot}` : ''}
        {' · '}đã cấp <b className="text-slate-700">{qtyCode(Number(c.qty), c.material)}</b>
      </p>
    </div>
  )
}

// ── Huỷ MỘT dòng cấp ──────────────────────────────────────────────────────────────────────────────────────────────────
export function ReverseLineSheet({ line, onClose }: { line: ConsumptionRow | null; onClose: () => void }) {
  const reverse = useReverseConsumption()
  const [block, setBlock] = useState(0)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (line) { setBlock(0); setReason(''); setErr('') } }, [line?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const qty = Number(line?.qty ?? 0)
  const bad = block < 0 || block > qty + 1e-9
  async function go() {
    if (!line) return
    setErr('')
    try { await reverse.mutateAsync({ id: line.id, reason: reason.trim(), qty_block: block > 0 ? r3(block) : undefined }); onClose() }
    catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={!!line} onClose={onClose} title="Huỷ dòng cấp"
      description="Lượng đã cấp hoàn về đúng tem / lô đó. Phần đã đổ vào mẻ hoặc hỏng, không dùng lại được, nhập ở ô Chặn."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>
        <Button size="sm" variant="destructive" className="h-8" disabled={reverse.isPending || bad || !reason.trim()} onClick={() => void go()} data-testid="reverse-confirm">
          {reverse.isPending ? 'Đang huỷ…' : 'Huỷ dòng cấp'}
        </Button>
      </>}>
      {line && (
        <div className="space-y-3 text-xs">
          <ErrBox msg={err} />
          <LineHead c={line} />
          <div>
            <Label className="text-xs">Không tái dùng được — chặn <span className="text-slate-400 font-normal">({matUnitCode(line.material)})</span></Label>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <QtyInput value={block} mat={line.material} onChange={setBlock} className={bad ? '[&_input]:border-red-400' : ''} />
              <button type="button" className="text-[11px] text-blue-600 hover:underline" onClick={() => setBlock(qty)}>Chặn hết</button>
              {block > 0 && <button type="button" className="text-[11px] text-slate-500 hover:underline" onClick={() => setBlock(0)}>Hoàn hết</button>}
            </div>
            <p className="mt-1 text-[11px] text-slate-600">
              Hoàn về dùng được: <b>{qtyCode(Math.max(0, r3(qty - block)), line.material)}</b>
              {block > 0 && <> · chặn <b className="text-amber-700">{qtyCode(block, line.material)}</b></>}
            </p>
            {block > 0 && <p className="mt-1 text-[11px] text-slate-500">{BLOCK_HINT}</p>}
          </div>
          <div>
            <Label className="text-xs">Lý do huỷ <span className="text-red-500">*</span></Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} className="h-9 sm:h-8 text-xs mt-0.5"
              placeholder={block > 0 ? 'Đã đổ vào mẻ hỏng · bao rách, ướt…' : 'Quét nhầm tem · nhập sai số…'} aria-label="Lý do huỷ" />
          </div>
        </div>
      )}
    </FormSheet>
  )
}

// ── Huỷ mẻ đã cấp NVL ─────────────────────────────────────────────────────────────────────────────────────────────────
export function CancelBatchSheet({ open, onClose, batchId, batchCode, lines, onDone }: {
  open: boolean; onClose: () => void; batchId: string; batchCode: string; lines: ConsumptionRow[]; onDone?: () => void
}) {
  const cancel = useCancelBatch()
  const [block, setBlock] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const key = lines.map(l => l.id).join(',')
  useEffect(() => { if (open) { setBlock({}); setReason(''); setErr('') } }, [open, key])
  const bOf = (c: ConsumptionRow) => block[c.id] ?? 0
  const bad = lines.some(c => bOf(c) < 0 || bOf(c) > Number(c.qty) + 1e-9)
  const nBlocked = lines.filter(c => bOf(c) > 0).length
  const setAll = (full: boolean) => setBlock(Object.fromEntries(lines.map(c => [c.id, full ? Number(c.qty) : 0])))
  async function go() {
    setErr('')
    try {
      await cancel.mutateAsync({ id: batchId, reason: reason.trim(), lines: lines.map(c => ({ consumption_id: c.id, qty_block: r3(bOf(c)) })) })
      onClose(); onDone?.()
    } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-2xl" title={`Huỷ mẻ ${batchCode}`}
      description="Mẻ đã cấp nguyên liệu. Mỗi dòng hoàn về đúng tem / lô đã cấp; phần không dùng lại được (đã đổ vào mẻ, hỏng…) nhập ở cột Chặn."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>
        <Button size="sm" variant="destructive" className="h-8" disabled={cancel.isPending || bad || !reason.trim()} onClick={() => void go()} data-testid="cancel-batch-confirm">
          {cancel.isPending ? 'Đang huỷ…' : 'Huỷ mẻ'}
        </Button>
      </>}>
      <div className="space-y-3 text-xs">
        <ErrBox msg={err} />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-600">{lines.length} dòng đã cấp{nBlocked ? ` · ${nBlocked} dòng có chặn` : ''}</span>
          <span className="ml-auto flex gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-8 sm:h-7 text-xs" onClick={() => setAll(false)}>Hoàn hết</Button>
            <Button type="button" size="sm" variant="outline" className="h-8 sm:h-7 text-xs" onClick={() => setAll(true)}>Chặn hết</Button>
          </span>
        </div>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {lines.map(c => {
            const b = bOf(c), over = b < 0 || b > Number(c.qty) + 1e-9
            return (
              <div key={c.id} className="p-2 flex flex-col gap-1.5 sm:flex-row sm:items-center" data-line={c.id}>
                <div className="flex-1 min-w-0"><LineHead c={c} /></div>
                <div className="flex items-center gap-2 sm:shrink-0">
                  <span className="text-[11px] text-slate-500 shrink-0">Chặn</span>
                  <QtyInput compact value={b} mat={c.material} onChange={v => setBlock(s => ({ ...s, [c.id]: v }))} className={over ? '[&_input]:border-red-400' : ''} />
                  <span className="text-[11px] text-slate-500 shrink-0 w-24 text-right">hoàn {qtyNum(Math.max(0, r3(Number(c.qty) - b)), c.material)}</span>
                </div>
              </div>
            )
          })}
        </div>
        {nBlocked > 0 && <p className="text-[11px] text-slate-500">{BLOCK_HINT}</p>}
        <div>
          <Label className="text-xs">Lý do huỷ mẻ <span className="text-red-500">*</span></Label>
          <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} className="h-9 sm:h-8 text-xs mt-0.5" placeholder="VD: mẻ hỏng do quá nhiệt, phải bỏ" aria-label="Lý do huỷ mẻ" />
        </div>
      </div>
    </FormSheet>
  )
}

// ── Điều chỉnh tồn theo số đếm (ca đã chốt mới nhất) ─────────────────────────────────────────────────────────────────────
export function ShiftAdjustSheet({ open, onClose, reportId, title }: { open: boolean; onClose: () => void; reportId: string; title: string }) {
  const planQ = useShiftAdjustPlan(reportId, open)
  const adjust = useShiftAdjust()
  const plan = planQ.data
  const mats = useMemo(() => plan?.materials ?? [], [plan])
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [err, setErr] = useState('')
  const stamp = mats.map(m => `${m.material_id}:${m.write_off}`).join(',')
  useEffect(() => { if (open) { setPick(new Set(mats.filter(m => m.write_off > 0).map(m => m.material_id))); setErr('') } }, [open, stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = mats.filter(m => pick.has(m.material_id) && m.write_off > 0)
  async function go() {
    setErr('')
    try { await adjust.mutateAsync({ id: reportId, material_ids: chosen.map(m => m.material_id) }); onClose() }
    catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-2xl" title="Điều chỉnh tồn theo số đếm" description={title}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>
        <Button size="sm" className="h-8" disabled={adjust.isPending || !plan?.ok || !chosen.length} onClick={() => void go()} data-testid="shift-adjust-confirm">
          {adjust.isPending ? 'Đang điều chỉnh…' : `Xoá hàng chặn của ${chosen.length} mã`}
        </Button>
      </>}>
      <div className="space-y-3 text-xs">
        <ErrBox msg={err} />
        {planQ.isError && <ErrBox msg={apiMsg(planQ.error)} />}
        {planQ.isLoading && <p className="text-slate-500">Đang tính…</p>}
        {plan && !plan.ok && <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">{plan.reason}</div>}
        {plan && (
          <p className="text-slate-600">
            Mã đếm <b>thiếu</b> so với tồn sổ: app xoá khỏi tồn các <b>lô đang chặn</b> của mã đó (lô chặn cũ trước, tối đa bằng phần thiếu) — đúng lô đã chặn khi huỷ cấp.
            Phần thiếu không có lô chặn, hoặc đếm thừa, không tự trừ / cộng: điều chỉnh từng lô ở Tồn kho.
          </p>
        )}
        {plan && !mats.length && <p className="text-slate-500">Ca này không có mã nào lệch giữa số đếm và tồn sổ.</p>}
        <div className="space-y-2">
          {mats.map(m => {
            const can = plan?.ok && m.write_off > 0
            return (
              <div key={m.material_id} className="rounded-lg border border-slate-200 p-2 space-y-1" data-mat={m.material_code}>
                <label className={`flex items-start gap-2 ${can ? 'cursor-pointer' : ''}`}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4" disabled={!can} checked={can ? pick.has(m.material_id) : false} aria-label={`Điều chỉnh ${m.material_code}`}
                    onChange={e => setPick(s => { const n = new Set(s); if (e.target.checked) n.add(m.material_id); else n.delete(m.material_id); return n })} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono font-semibold">{m.material_code}</span> <span className="text-slate-600">{m.material_name ?? ''}</span>
                    <span className="block text-[11px] text-slate-500">
                      Sổ {qtyCode(Number(m.book), m)} · đếm {qtyCode(Number(m.actual), m)} ·{' '}
                      <b className={Number(m.diff) < 0 ? 'text-red-600' : 'text-amber-700'}>{Number(m.diff) > 0 ? 'thừa +' : 'thiếu '}{qtyNum(Math.abs(Number(m.diff)), m)}</b>
                    </span>
                  </span>
                  {m.write_off > 0 && <StatusBadge tone="red">Xoá {qtyCode(Number(m.write_off), m)}</StatusBadge>}
                </label>
                {m.blocks.filter(k => k.take > 0).map(k => (
                  <p key={k.block_id} className="pl-6 text-[11px] text-slate-600 truncate" title={k.reason}>
                    Tem <span className="font-mono">{k.pallet_code}</span> · chặn {qtyNum(Number(k.open), m)} · xoá <b>{qtyNum(Number(k.take), m)}</b> · {k.reason}
                    <span className="text-slate-400"> · {k.created_by_name ?? ''} {formatDateTime(k.created_at)}</span>
                  </p>
                ))}
                {Number(m.unexplained) > 0 && (
                  <p className="pl-6 text-[11px] text-amber-700">Còn thiếu {qtyCode(Number(m.unexplained), m)} không có lô chặn — điều chỉnh từng lô ở Tồn kho.</p>
                )}
                {Number(m.diff) > 0 && <p className="pl-6 text-[11px] text-amber-700">Đếm thừa — kiểm lại số đếm hoặc điều chỉnh từng lô ở Tồn kho.</p>}
              </div>
            )
          })}
        </div>
      </div>
    </FormSheet>
  )
}

// ── Xoá khỏi tồn / bỏ chặn MỘT lô chặn ──────────────────────────────────────────────────────────────────────────────────
export function BlockActSheet({ block, kind, onClose }: { block: BlockRow | null; kind: 'WRITE_OFF' | 'RELEASE'; onClose: () => void }) {
  const act = useBlockAct()
  const [qty, setQty] = useState(0)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (block) { setQty(Number(block.open)); setNote(''); setErr('') } }, [block?.id, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = Number(block?.open ?? 0)
  const bad = qty <= 0 || qty > open + 1e-9
  const wo = kind === 'WRITE_OFF'
  async function go() {
    if (!block) return
    setErr('')
    try { await act.mutateAsync({ id: block.id, kind, qty: r3(qty), note: note.trim() || undefined }); onClose() }
    catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={!!block} onClose={onClose} title={wo ? 'Xoá hàng chặn khỏi tồn' : 'Bỏ chặn — trả về dùng được'}
      description={wo ? 'Trừ hẳn phần chặn khỏi tồn sổ của đúng lô này (điều chỉnh tồn). Ghi vào sổ chênh lệch để đối chiếu SAP.' : 'Phần chặn dùng lại được: trả về tồn dùng được của đúng lô này.'}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>
        <Button size="sm" variant={wo ? 'destructive' : 'default'} className="h-8" disabled={act.isPending || bad} onClick={() => void go()} data-testid="block-act-confirm">
          {act.isPending ? 'Đang ghi…' : wo ? 'Xoá khỏi tồn' : 'Bỏ chặn'}
        </Button>
      </>}>
      {block && (
        <div className="space-y-3 text-xs">
          <ErrBox msg={err} />
          <div>
            <p><span className="font-mono font-semibold">{block.material_code}</span> <span className="text-slate-600">{block.material_name ?? ''}</span></p>
            <p className="text-[11px] text-slate-500">Tem <span className="font-mono">{block.pallet_code}</span>{block.batch_code ? ` · mẻ ${block.batch_code}` : ''} · đang chặn <b className="text-amber-700">{qtyCode(open, block)}</b></p>
            <p className="text-[11px] text-slate-500">Lý do chặn: {block.reason}</p>
          </div>
          <div>
            <Label className="text-xs">Lượng <span className="text-slate-400 font-normal">({matUnitCode(block)})</span></Label>
            <div className="mt-1"><QtyInput value={qty} mat={block} onChange={setQty} className={bad ? '[&_input]:border-red-400' : ''} /></div>
          </div>
          <div>
            <Label className="text-xs">Ghi chú</Label>
            <Input value={note} onChange={e => setNote(e.target.value)} maxLength={500} className="h-9 sm:h-8 text-xs mt-0.5" placeholder={wo ? 'VD: kiểm kê xác nhận đã mất' : 'VD: bao còn nguyên, QA cho dùng lại'} aria-label="Ghi chú" />
          </div>
        </div>
      )}
    </FormSheet>
  )
}
