// LUỒNG LÀM VIỆC CỦA MẺ (MES 17/11 — user chốt): trưởng ca duyệt → QA duyệt → cấp nguyên liệu (quét tem) → ghi phiếu (bấm mốc giờ)
// → QA in TEM PALLET của mẻ (1/n … n/n) → công nhân ĐỔ BỒN (khai chu kỳ · số mẻ · bồn đang đứng, quét tem khớp mới đổ) → NẠP BỒN
// → QA kết luận ở BỒN. File này: dải bước + form in tem + form đổ bồn + form QA bồn.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { Check, Printer, AlertTriangle, ShieldCheck, ShieldX, ShieldAlert, Hourglass } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { QRScanDialog } from '@/components/shared/QRScanDialog'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { QRImg, PALLET_PRINT_CSS } from '@/components/shared/palletLabel'
import { PrintArea, printWhenReady } from '@/components/shared/PrintArea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import {
  useBatchLabels, usePourScan, useTankFill, useTankQa, useProductionTanks, fetchPourStatus, BATCH_QA_VI,
  type BatchDetail, type BatchLabel, type PourView, type TankRow, type BatchQa,
} from '@/api/productionHooks'
import { unitCode } from '@/utils/unitCode'
import { formatDate } from '@/utils/formatters'
import { parseVnNumber, vnNumberInput } from '@/utils/vnNumber'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const nf = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const no4 = (n: number | null | undefined) => (n ? String(n).padStart(4, '0') : '—')

// ─── DẢI BƯỚC ──────────────────────────────────────────────────────────────────────────────────────────────────
export type FlowState = 'done' | 'now' | 'todo' | 'bad'
/** "Cấp nguyên liệu" → "cấp nguyên liệu"; giữ chữ viết tắt in hoa ("QA duyệt") */
const lowerFirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s)
export interface FlowStep { key: string; label: string; state: FlowState; detail?: string
  /** bước này là VIỆC CỦA NGƯỜI ĐANG XEM (chức danh có quyền làm) — false ⇒ bước đang tới in "chờ" (user 18/11) */
  mine?: boolean }
/** Một hàng: bước xong ✓ xanh · bước đang tới nền xanh đậm (luôn in tên) · bước sau xám. Điện thoại chỉ in tên bước đang tới.
 *  Bước đang tới KHÔNG phải việc của mình (thiếu quyền) ⇒ nền nhạt + đồng hồ cát + "chờ": người xem biết đang đợi người khác,
 *  không đi tìm nút. Dải chỉ để XEM — mọi thao tác nằm ở nút đầu trang, nút chỉ hiện cho người có quyền. */
export function FlowStrip({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="flex items-center gap-1 min-w-0 overflow-hidden" aria-label="Các bước của mẻ">
      {steps.map((s, i) => {
        const now = s.state === 'now'
        const wait = now && s.mine === false
        return (
          <li key={s.key} data-step={s.key} data-state={s.state} data-mine={s.mine === undefined ? undefined : s.mine ? '1' : '0'}
            title={`${i + 1}. ${s.label}${s.detail ? ` — ${s.detail}` : ''}${wait ? ' — đang chờ người phụ trách bước này (không phải việc của bạn)' : ''}`}
            className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap ${now ? 'min-w-0 shrink' : 'shrink-0'} ${
              s.state === 'done' ? 'border-green-200 bg-green-50 text-green-700' : s.state === 'bad' ? 'border-red-200 bg-red-50 text-red-700'
              : wait ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold'
              : now ? 'border-blue-500 bg-blue-600 text-white font-semibold' : 'border-slate-200 bg-white text-slate-400'}`}>
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center shrink-0 tabular-nums">
              {s.state === 'done' ? <Check className="h-3 w-3" /> : s.state === 'bad' ? <AlertTriangle className="h-3 w-3" /> : wait ? <Hourglass className="h-3 w-3" /> : i + 1}
            </span>
            {/* đang chờ người khác: chữ "Chờ" đứng ĐẦU ("Chờ in tem pallet") — điện thoại cắt đuôi nhãn, chữ quan trọng không được nằm cuối */}
            <span className={`truncate ${now ? '' : 'hidden lg:inline'}`}>{wait ? `Chờ ${lowerFirst(s.label)}` : s.label}{s.detail && (now || s.state === 'bad') ? ` · ${s.detail}` : ''}</span>
          </li>
        )
      })}
    </ol>
  )
}

// ─── TEM PALLET CỦA MẺ ─────────────────────────────────────────────────────────────────────────────────────────
type LabelInfo = { batchCode: string; materialCode: string; materialName: string; cycle: string; batchNo: string; tank: string; prodDate: string; total: number }
/** Một tem (1/4 A4 — cùng khổ tem pallet nhập kho): QR + mã lô · mã dịch · ngày · ô lớn Chu kỳ / Mẻ / Bồn / Pallet i/n */
function BatchPalletLabel({ l, info }: { l: BatchLabel; info: LabelInfo }) {
  return (
    <div className="pl-label flex flex-col border border-dashed border-slate-300 p-[3.5mm] overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="h-[84mm] w-[84mm] max-h-full max-w-full"><QRImg value={l.qr} px={520} /></div>
      </div>
      <div className="mt-[1mm] shrink-0 text-[9.5pt] leading-[1.3] text-black border-t border-black pt-[1mm]">
        <p className="text-[8pt] font-semibold uppercase tracking-wide">Tem pallet của mẻ — nguyên liệu đã cấp</p>
        <p className="truncate"><span className="font-semibold">Mã lô</span>: <span className="font-mono font-bold text-[12pt]">{info.batchCode}</span></p>
        <p className="truncate"><span className="font-semibold">Bán thành phẩm</span>: {info.materialCode} {info.materialName}</p>
        <p className="truncate"><span className="font-semibold">Ngày SX</span>: {info.prodDate}</p>
      </div>
      <div className="mt-[1.5mm] grid grid-cols-4 shrink-0 border-t-2 border-black text-center">
        {[['Chu kỳ', info.cycle], ['Mẻ', info.batchNo], ['Bồn', info.tank], ['Pallet', `${l.pallet_no}/${info.total}`]].map(([k, v], i) => (
          <div key={k} className={i < 3 ? 'border-r border-black' : ''}>
            <div className="text-[8pt] font-semibold leading-tight">{k}</div>
            <div className={`font-bold leading-none ${i === 3 ? 'text-[24pt]' : 'text-[15pt] pt-[2mm] pb-[1mm]'}`}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BatchLabelSheet({ open, onClose, batch }: { open: boolean; onClose: () => void; batch: BatchDetail }) {
  const [count, setCount] = useState('')
  const [err, setErr] = useState('')
  const [labels, setLabels] = useState<BatchLabel[]>([])
  const make = useBatchLabels()
  useEffect(() => { if (open) { setCount(batch.label_count ? String(batch.label_count) : ''); setErr(''); setLabels(batch.labels ?? []) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = /^\d{1,2}$/.test(count.trim()) ? Number(count) : 0
  const valid = !!batch.label_at && !!batch.label_count
  const changing = valid && n > 0 && n !== batch.label_count
  const info: LabelInfo = {
    batchCode: batch.batch_code, materialCode: batch.material?.material_code ?? '', materialName: batch.material?.short_name ?? '',
    cycle: batch.cycle ?? '—', batchNo: no4(batch.batch_no), tank: batch.tank?.code ?? '—', prodDate: formatDate(batch.prod_date), total: labels.length,
  }
  const sheets = useMemo(() => { const s: BatchLabel[][] = []; for (let i = 0; i < labels.length; i += 4) s.push(labels.slice(i, i + 4)); return s }, [labels])
  async function print() {
    setErr('')
    try {
      const r = await make.mutateAsync({ id: batch.id, count: n })
      setLabels(r.labels)
      printWhenReady(r.labels.length)   // chờ ảnh QR trong vùng in vẽ xong (không canh giờ)
    } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={open} onClose={onClose} title={`Tem pallet của mẻ ${batch.batch_code}`}
      description="Mỗi pallet nguyên liệu đã cấp cho mẻ dán một tem (1/n … n/n). Công nhân đổ bồn quét tem: đúng mẻ, đúng bồn mới đổ."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>
        <Button size="sm" className="h-8 gap-1" disabled={!n || make.isPending} onClick={() => void print()}>
          <Printer className="h-3.5 w-3.5" />{make.isPending ? 'Đang tạo…' : valid && !changing ? 'In lại tem' : 'In tem'}
        </Button>
      </>}>
      <style>{PALLET_PRINT_CSS}</style>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Mẻ để trên mấy pallet <span className="text-red-500">*</span></Label>
          <Input value={count} onChange={e => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" autoFocus aria-label="Số pallet"
            onKeyDown={e => { if (e.key === 'Enter' && n && !make.isPending) void print() }} className="h-9 sm:h-8 text-sm mt-0.5 w-28 font-mono" />
          {changing && <p className="text-[11px] text-amber-700 mt-1">Đổi số pallet ⇒ bộ tem cũ ({batch.label_count} tem) mất hiệu lực, dán lại cả bộ mới.</p>}
          {!valid && batch.label_ver > 0 && <p className="text-[11px] text-amber-700 mt-1">Mã lô đã đổi (đổi bồn / số mẻ) — tem in trước đó không còn dùng được, in lại.</p>}
        </div>
        {labels.length > 0 && (
          <div>
            <p className="text-[11px] text-slate-500 mb-1">Bộ tem đang hiệu lực · {labels.length} tem</p>
            <div className="grid grid-cols-4 gap-2">
              {labels.map(l => (
                <div key={l.pallet_no} data-qr={l.qr} className="rounded-lg border border-slate-200 p-1.5 text-center">
                  <div className="aspect-square"><QRImg value={l.qr} px={160} /></div>
                  <p className="text-[11px] font-mono font-semibold mt-0.5">{l.pallet_no}/{labels.length}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
      </div>
      {/* vùng in vẽ thẳng vào <body> (PrintArea): đặt trong khung trượt thì bản in lệch phải + cắt cột tem bên phải (user 18/11, C120) */}
      <PrintArea>
        {sheets.map((sh, si) => (
          <div key={si} className="pl-sheet grid grid-cols-2 grid-rows-2 overflow-hidden bg-white" style={{ width: '210mm', height: '297mm' }}>
            {sh.map(l => <BatchPalletLabel key={l.pallet_no} l={l} info={info} />)}
          </div>
        ))}
      </PrintArea>
    </FormSheet>
  )
}

// ─── ĐỔ BỒN ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Công nhân đổ bồn: khai BỒN ĐANG ĐỨNG · CHU KỲ · SỐ MẺ ⇒ app tìm mẻ (sai bồn báo ngay) ⇒ quét từng tem pallet ⇒ đủ thì Nạp bồn. */
export function PourSheet({ open, onClose, warehouseId, preset, canScan, canFill }: {
  open: boolean; onClose: () => void; warehouseId: string
  preset?: { tankId?: string | null; cycle?: string | null; batchNo?: number | null }
  canScan: boolean; canFill: boolean
}) {
  const [tankId, setTankId] = useState(''); const [cycle, setCycle] = useState(''); const [no, setNo] = useState('')
  const [view, setView] = useState<PourView | null>(null)
  const [err, setErr] = useState(''); const [okMsg, setOkMsg] = useState(''); const [busy, setBusy] = useState(false)
  const [cam, setCam] = useState(false); const [typed, setTyped] = useState(''); const [qty, setQty] = useState('')
  const scan = usePourScan(); const fill = useTankFill()
  const tanks = useProductionTanks(warehouseId, false, open && !!warehouseId).data ?? []
  const auto = useRef(false)
  useEffect(() => {
    if (!open) return
    setTankId(preset?.tankId ?? ''); setCycle(preset?.cycle ?? ''); setNo(preset?.batchNo ? String(preset.batchNo) : '')
    setView(null); setErr(''); setOkMsg(''); setTyped(''); setQty('')
    auto.current = !!(preset?.tankId && preset?.cycle && preset?.batchNo)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const noNum = /^\d{1,4}$/.test(no.trim()) ? Number(no) : 0
  const ready = !!tankId && !!cycle.trim() && noNum > 0
  async function check() {
    setErr(''); setOkMsg(''); setBusy(true)
    try {
      const v = await fetchPourStatus({ warehouse_id: warehouseId, tank_id: tankId, cycle: cycle.trim(), batch_no: noNum })
      setView(v)
      const rest = v.batch.planned_qty != null ? Math.round((Number(v.batch.planned_qty) - v.filled) * 1000) / 1000 : 0
      setQty(rest > 0 ? vnNumberInput(rest) : '')
    } catch (e) { setView(null); setErr(apiMsg(e)) } finally { setBusy(false) }
  }
  useEffect(() => { if (open && auto.current && ready) { auto.current = false; void check() } }, [open, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  async function onCode(code: string) {
    if (!view || !code.trim() || scan.isPending) return
    setErr(''); setOkMsg('')
    try {
      const r = await scan.mutateAsync({ batch_id: view.batch.id, tank_id: tankId, code: code.trim() })
      setView(r); setOkMsg(`Đã nhận pallet ${r.pallet_no}/${r.batch.label_count}`); setTyped('')
    } catch (e) { setErr(apiMsg(e)) }
  }
  const total = view?.batch.label_count ?? 0
  const scanned = new Set((view?.scans ?? []).map(s => s.pallet_no))
  const all = !!view && total > 0 && scanned.size >= total
  const blockers = view?.gate?.fill_blockers ?? []
  const qtyN = parseVnNumber(qty)
  const u = unitCode(view?.batch.material?.base_unit)
  useWedgeScanner(c => { void onCode(c) }, open && !!view && canScan && !all && !cam, { exclusive: true })
  async function doFill() {
    if (!view || !qtyN) return
    setErr('')
    try { await fill.mutateAsync({ tankId, batch_id: view.batch.id, qty: qtyN }); onClose() } catch (e) { setErr(apiMsg(e)) }
  }
  const tank = tanks.find(t => t.id === tankId)
  return (
    <FormSheet open={open} onClose={onClose} title="Đổ bồn" description="Khai bồn đang đứng, chu kỳ và số mẻ. Quét tem pallet của mẻ: khớp mới đổ."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>
        {!view && <Button size="sm" className="h-8" disabled={!ready || busy} onClick={() => void check()}>{busy ? 'Đang kiểm…' : 'Kiểm mẻ'}</Button>}
        {view && canFill && <Button size="sm" className="h-8" disabled={blockers.length > 0 || !qtyN || qtyN <= 0 || fill.isPending} onClick={() => void doFill()}>{fill.isPending ? 'Đang nạp…' : 'Nạp bồn'}</Button>}
      </>}>
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">Bồn đang đứng <span className="text-red-500">*</span></Label>
            <SingleSelect value={tankId} onChange={v => { setTankId(v); setView(null) }} searchable={tanks.length > 8} triggerClassName="h-9 sm:h-8 text-xs mt-0.5"
              placeholder="Chọn bồn" options={tanks.filter(t => t.warehouse_id === warehouseId).map(t => ({ value: t.id, label: t.code }))} />
          </div>
          <div>
            <Label className="text-xs">Chu kỳ <span className="text-red-500">*</span></Label>
            <Input value={cycle} onChange={e => { setCycle(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setView(null) }} maxLength={6} aria-label="Chu kỳ" className="h-9 sm:h-8 text-xs mt-0.5 font-mono" />
          </div>
          <div>
            <Label className="text-xs">Số mẻ <span className="text-red-500">*</span></Label>
            <Input value={no} onChange={e => { setNo(e.target.value.replace(/\D/g, '').slice(0, 4)); setView(null) }} inputMode="numeric" aria-label="Số mẻ"
              onKeyDown={e => { if (e.key === 'Enter' && ready && !view) void check() }} className="h-9 sm:h-8 text-xs mt-0.5 font-mono" />
          </div>
        </div>
        {err && <div role="alert" className="rounded-lg bg-red-600 text-white px-3 py-2.5 text-sm font-semibold flex items-start gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{err}</span></div>}
        {view && (
          <>
            <div className="rounded-lg border border-slate-200 px-3 py-2 space-y-0.5">
              <p className="font-mono text-base font-bold text-slate-900" data-testid="pour-batch-code">{view.batch.batch_code}</p>
              <p className="text-slate-600 truncate"><span className="font-mono font-semibold">{view.batch.material?.material_code}</span> {view.batch.material?.short_name ?? ''}</p>
              <p className="text-slate-500">Bồn <b className="font-mono text-slate-800">{view.batch.tank?.code}</b>{tank ? ` · đang chứa ${nf(tank.content)} / ${nf(tank.capacity)} ${tank.unit}` : ''}</p>
            </div>
            {!total ? <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">QA chưa in tem pallet cho mẻ này — chưa đổ bồn được.</p> : (
              <div>
                <p className="mb-1 text-slate-600">Tem pallet đã quét <b className={`tabular-nums ${all ? 'text-green-700' : 'text-slate-900'}`} data-testid="pour-count">{scanned.size}/{total}</b></p>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: total }, (_, i) => i + 1).map(i => (
                    <span key={i} className={`inline-flex h-9 min-w-[3rem] items-center justify-center gap-1 rounded-lg border px-2 font-mono text-xs font-semibold ${scanned.has(i) ? 'border-green-300 bg-green-50 text-green-700' : 'border-slate-200 text-slate-400'}`}>
                      {scanned.has(i) && <Check className="h-3.5 w-3.5" />}{i}/{total}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {okMsg && !err && <p className="text-green-700 font-semibold">{okMsg}</p>}
            {total > 0 && !all && canScan && (
              <div className="flex gap-1.5">
                <Input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void onCode(typed) }} placeholder="Bắn súng quét, hoặc gõ mã tem rồi Enter"
                  aria-label="Mã tem pallet của mẻ" className="h-9 sm:h-8 text-xs flex-1 min-w-0 font-mono" />
                <Button type="button" variant="outline" size="sm" className="h-9 sm:h-8 gap-1 shrink-0" onClick={() => setCam(true)}><ScanIcon className="h-3.5 w-3.5" />Camera</Button>
              </div>
            )}
            {all && <p className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-green-800 font-semibold">Đã quét đủ {total}/{total} pallet — đổ vào bồn {view.batch.tank?.code}.</p>}
            {canFill && (all || view.filled > 0 || !view.gate?.flow_gate) && (
              <div className="border-t border-slate-200 pt-2.5">
                {blockers.length > 0 ? (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
                    <p className="font-semibold">Chưa nạp bồn được:</p>
                    <ul className="list-disc pl-4 mt-0.5 space-y-0.5">{blockers.map(x => <li key={x}>{x}</li>)}</ul>
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs">Lượng nạp ({u}) <span className="text-red-500">*</span></Label>
                    <Input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" aria-label="Lượng nạp" className="h-9 sm:h-8 text-sm mt-0.5 w-40" />
                    <p className="text-[11px] text-slate-500 mt-0.5">Kế hoạch {nf(view.batch.planned_qty)} · đã nạp {nf(view.filled)}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <QRScanDialog open={cam} onClose={() => setCam(false)} warehouseId={warehouseId} title="Quét tem pallet của mẻ" onScan={t => { setCam(false); void onCode(t) }} />
    </FormSheet>
  )
}

// ─── QA Ở BỒN ──────────────────────────────────────────────────────────────────────────────────────────────────
/** QA đạt / không đạt bấm ở bồn — áp cho MỌI mẻ đang có trong bồn (user chốt 17/11). Không đạt bắt buộc lý do. */
export function TankQaSheet({ open, onClose, tank }: { open: boolean; onClose: () => void; tank: TankRow | null }) {
  const [note, setNote] = useState(''); const [err, setErr] = useState('')
  const qa = useTankQa()
  useEffect(() => { if (open) { setNote(''); setErr('') } }, [open])
  if (!tank) return null
  async function set(st: BatchQa) {
    setErr('')
    if (st === 'REJECTED' && !note.trim()) { setErr('Không đạt phải ghi lý do'); return }
    try { await qa.mutateAsync({ tankId: tank!.id, qa_status: st, note: note.trim() || undefined }); onClose() } catch (e) { setErr(apiMsg(e)) }
  }
  return (
    <FormSheet open={open} onClose={onClose} title={`QA bồn ${tank.code}`} description="Kết luận áp cho mọi mẻ đang có trong bồn. Nạp thêm mẻ mới thì bồn về chờ QA."
      footer={<Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>}>
      <div className="space-y-3 text-xs">
        <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
          {tank.lots.map(l => (
            <div key={l.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-mono font-semibold">{l.batch?.batch_code}</span>
              <span className="text-slate-500">{l.batch ? BATCH_QA_VI[l.batch.qa_status] : ''}</span>
              <span className="ml-auto tabular-nums font-semibold">{nf(l.qty_remaining)} <span className="font-normal text-slate-400">{tank.unit}</span></span>
            </div>
          ))}
          {!tank.lots.length && <p className="px-3 py-2 text-slate-400">Bồn đang trống — chưa có gì để kết luận.</p>}
        </div>
        <div>
          <Label className="text-xs">Ghi chú / lý do (bắt buộc khi không đạt)</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} maxLength={500} aria-label="Ghi chú QA" className="h-9 sm:h-8 text-xs mt-0.5" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" className="h-10 gap-1 bg-green-600 hover:bg-green-700" disabled={!tank.lots.length || qa.isPending} onClick={() => void set('RELEASED')}><ShieldCheck className="h-4 w-4" />Đạt</Button>
          <Button size="sm" variant="outline" className="h-10 gap-1 border-red-300 text-red-700 hover:bg-red-50" disabled={!tank.lots.length || qa.isPending} onClick={() => void set('REJECTED')}><ShieldX className="h-4 w-4" />Không đạt</Button>
          <Button size="sm" variant="outline" className="h-10 gap-1" disabled={!tank.lots.length || qa.isPending} onClick={() => void set('HOLD')}><ShieldAlert className="h-4 w-4" />Chờ QA</Button>
        </div>
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{err}</div>}
      </div>
    </FormSheet>
  )
}
