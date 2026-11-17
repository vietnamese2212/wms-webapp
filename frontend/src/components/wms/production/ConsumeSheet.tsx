// CẤP NGUYÊN LIỆU CHO MẺ — form của BÀN LÀM VIỆC CỦA MẺ (MES 14/11; user: "nếu có QR code thì phải quét QR code và điền số lượng").
//   • Quét tem: súng PDA / camera / gõ mã ⇒ tra tem trong KHO CỦA MẺ ⇒ nhập lượng ⇒ trừ đúng dòng tồn đó.
//   • Không có tem: CHỈ cho hàng không có tem QR (tồn gộp theo NSX) — chọn mã ⇒ chọn lô ⇒ nhập lượng. Lô còn hàng trên tem ⇒ phải quét.
// Mở từ một dòng của bàn (`focusId`) ⇒ form biết đang cấp mã nào: tem khác mã bị từ chối, lượng điền sẵn = phần còn thiếu.
// Sheet giữ mở sau mỗi lần cấp để quét liên tục; kết quả lần vừa cấp hiện ngay trên đầu.
import { useEffect, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { FormSheet } from '@/components/shared/FormSheet'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { QtyInput } from '@/components/shared/QtyInput'
import { QRScanDialog } from '@/components/shared/QRScanDialog'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { scanCheck, useConsumeScan, useConsumeLot, useProductionStock, type BatchDetail, type ScanEntry, type StockLot } from '@/api/productionHooks'
import { hasEntry, qtyIntegerError, type MatUnits } from '@/utils/qtyUnits'
import { qtyCode, qtyNum, matUnitCode } from '@/utils/unitCode'
import { reqLineState } from '@/utils/reqTolerance'
import { Check } from 'lucide-react'
import { normalizeQR } from '@/utils/qr'
import { formatDate } from '@/utils/formatters'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const avail = (e: ScanEntry) => Number(e.cartons_remaining ?? e.cartons_imported ?? 0) - Number(e.cartons_reserved ?? 0)
const dayOf = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null)
/** cùng luật qa_is_hold (BE): có trạng thái QA mà không phải OK = đang giữ */
const qaHold = (e: ScanEntry) => !!(e.qa_status_id || e.qa_status) && e.qa_status?.code !== 'OK'
/** lượng điền sẵn = phần còn thiếu, không vượt `cap`; mã có đơn vị nhập (bao / thùng) phải số nguyên đơn vị gốc ⇒ làm tròn LÊN
 *  (định mức × kế hoạch hay ra số lẻ — điền số lẻ là form mở ra đã báo lỗi, nút Xác nhận tắt) */
const prefill = (need: number, cap: number, mat: MatUnits | null | undefined) =>
  need <= 0 ? 0 : Math.min(qtyIntegerError(need, mat ?? null) ? Math.ceil(need - 1e-9) : need, cap)

export function ConsumeSheet({ open, onClose, batch, focusId }: {
  open: boolean; onClose: () => void; batch: BatchDetail
  /** dòng của bàn làm việc đang cấp (không có = quét tự do, tem nào app tự khớp vào dòng đó) */
  focusId?: string | null
}) {
  const [mode, setMode] = useState<'SCAN' | 'LOT'>('SCAN')
  const [code, setCode] = useState('')
  const [entry, setEntry] = useState<ScanEntry | null>(null)
  const [looking, setLooking] = useState(false)
  const [camOpen, setCamOpen] = useState(false)
  const [qty, setQty] = useState(0)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null>(null)
  // đường "Không có tem"
  const [matTerm, setMatTerm] = useState('')
  const [matId, setMatId] = useState('')
  const [lotKey, setLotKey] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const consumeScan = useConsumeScan()
  const consumeLot = useConsumeLot()

  const focus = focusId ? batch.board.find(r => r.material_id === focusId) ?? null : null
  const boardMat = (materialId: string | undefined) => batch.board.find(x => x.material_id === materialId) ?? null
  /** phần còn thiếu của một mã theo yêu cầu của mẻ (0 = đủ trong mức lệch / không có yêu cầu) — CÙNG luật với bàn của mẻ (reqLineState) */
  const needOf = (materialId: string | undefined) => {
    const r = batch.board.find(x => x.material_id === materialId)
    return r ? reqLineState(r, batch.status === 'CLOSED').need : 0
  }

  useEffect(() => {
    if (!open) return
    reset(); setDone(null); setMatTerm(''); setLotKey('')
    // dòng có hàng KHÔNG tem và không còn tem nào ⇒ vào thẳng "Không có tem"; còn lại luôn bắt đầu bằng quét
    const lotFirst = !!focus && Number(focus.tem_pallets) === 0 && Number(focus.available_no_tem) > 0
    setMode(lotFirst ? 'LOT' : 'SCAN'); setMatId(lotFirst ? focus.material_id : '')
  }, [open, focusId]) // eslint-disable-line react-hooks/exhaustive-deps
  function reset() { setCode(''); setEntry(null); setQty(0); setErr('') }

  async function lookup(raw: string) {
    const c = normalizeQR(raw)
    if (!c) return
    setCode(c); setErr(''); setEntry(null); setLooking(true)
    try {
      const e = await scanCheck(batch.id, c)
      if (focus && e.material_id !== focus.material_id) {
        setErr(`Tem này là mã ${e.material?.material_code ?? ''} — đang cấp ${focus.material_code}. Quét đúng tem, hoặc đóng form rồi bấm "Quét cấp NVL" ở đầu bàn để cấp mã khác.`)
        return
      }
      setEntry(e)
      setQty(qaHold(e) ? 0 : prefill(needOf(e.material_id), avail(e), e.material ?? boardMat(e.material_id)))   // điền sẵn phần còn thiếu (không vượt lượng trên tem)
    }
    catch (e) { setErr(apiMsg(e)) }
    finally { setLooking(false) }
  }
  // Súng PDA nghe suốt lúc ở chế độ quét, KỂ CẢ khi đang hiện một tem: thấy nhắc "còn lô HSD sớm hơn" thì bắn ngay tem đúng là thay.
  // Bắn trúng lúc con trỏ ở ô lượng: máy đọc trả lại số trong ô rồi mới phát mã (useWedgeScanner) — số đang nhập không bị chuỗi tem phá.
  useWedgeScanner(c => { void lookup(c) }, open && mode === 'SCAN' && !camOpen && !consumeScan.isPending, { exclusive: true })

  // FEFO: cùng mã còn lô HSD sớm hơn tem vừa quét ⇒ nhắc (không chặn — user chốt 14/11 "nhắc thôi")
  const scanLots = useProductionStock(entry ? batch.warehouse_id : undefined, entry?.material_id).data?.lots ?? []
  const earlier = entry?.expiry_date ? scanLots.find(l => l.expiry_date && l.expiry_date < String(entry.expiry_date).slice(0, 10)) : undefined
  const offPlan = !!entry && batch.board.some(r => r.required != null) && !batch.board.some(r => r.required != null && r.material_id === entry.material_id)

  const term = useDebouncedValue(matTerm, 250)
  const mats = useProductionStock(open && mode === 'LOT' ? batch.warehouse_id : undefined, undefined, term)
  // chỉ mã còn hàng KHÔNG tem mới chọn lô bằng tay
  const matList = (mats.data?.materials ?? []).filter(m => Number(m.available_no_tem ?? 0) > 0)
  const lotsQ = useProductionStock(matId ? batch.warehouse_id : undefined, matId || undefined)
  const lots = lotsQ.data?.lots ?? []
  const keyOf = (l: StockLot) => `${dayOf(l.production_date) ?? ''}|${l.batch_lot ?? ''}`
  const free = (l: StockLot) => Number(l.available_no_tem ?? 0)
  const lot = lots.find(l => keyOf(l) === lotKey) ?? null
  const selMat = matList.find(m => m.material_id === matId)
  const [matMemo, setMatMemo] = useState<(MatUnits & { material_code: string; material_name: string | null }) | null>(null)
  useEffect(() => { if (selMat) setMatMemo(selMat) }, [selMat])
  const focusMat = focus && focus.material_id === matId ? focus : null
  const lotMat: (MatUnits & { material_code: string }) | null = selMat ?? focusMat ?? matMemo
  useEffect(() => { setLotKey(''); setQty(0) }, [matId])
  // chọn sẵn lô HSD sớm nhất còn cấp được — chạy lại cả khi lô đang chọn bị bỏ (mở lại form cùng mã: danh sách lô không đổi tham chiếu)
  useEffect(() => {
    if (!lots.length || lots.some(l => keyOf(l) === lotKey && free(l) > 0)) return
    const first = lots.find(l => free(l) > 0)
    if (first) { setLotKey(keyOf(first)); setQty(prefill(needOf(matId), free(first), boardMat(matId) ?? lotMat)) }
  }, [lots, lotKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const firstFree = lots.find(l => free(l) > 0)
  const lotNotFirst = !!lot && !!firstFree && keyOf(lot) !== keyOf(firstFree)

  const mat: MatUnits | null = mode === 'SCAN' ? (entry?.material ?? null) : lotMat
  const max = mode === 'SCAN' ? (entry ? avail(entry) : 0) : (lot ? free(lot) : 0)
  const intErr = qty > 0 ? qtyIntegerError(qty, mat) : null
  const over = qty > max + 1e-9
  const saving = consumeScan.isPending || consumeLot.isPending
  const held = mode === 'SCAN' && !!entry && qaHold(entry)
  const canSave = qty > 0 && !over && !intErr && !saving && !held && (mode === 'SCAN' ? !!entry : !!lot && free(lot) > 0)
  const unitText = (n: number) => qtyCode(n, mat)

  async function submit() {
    setErr('')
    try {
      if (mode === 'SCAN' && entry) {
        const r = await consumeScan.mutateAsync({ batchId: batch.id, entry_id: entry.id, qty })
        const row = r.rows[0]
        setDone(`Đã cấp ${unitText(qty)} từ tem ${entry.pallet_code} — tem còn ${unitText(Number(row?.remaining ?? 0))}`)
        reset()
        setTimeout(() => inputRef.current?.focus(), 50)
      } else if (lot && matId) {
        const r = await consumeLot.mutateAsync({ batchId: batch.id, material_id: matId, production_date: dayOf(lot.production_date), batch_lot: lot.batch_lot?.trim() || null, qty })
        setDone(`Đã cấp ${unitText(qty)} ${lotMat?.material_code ?? ''} theo lô ${lot.batch_lot ?? formatDate(dayOf(lot.production_date) ?? '')} — trừ ${r.rows.length} dòng tồn (HSD sớm trước)`)
        setQty(0)
      }
    } catch (e) { setErr(apiMsg(e)) }
  }
  const focusNeed = focus ? needOf(focus.material_id) : 0

  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-xl"
      title={focus ? `Cấp ${focus.material_code} cho mẻ ${batch.batch_code}` : `Cấp nguyên liệu cho mẻ ${batch.batch_code}`}
      description={`Chỉ cấp được hàng đang nằm ở kho chế biến ${batch.warehouse?.name ?? ''}, không bị QA giữ. Hàng có tem QR phải quét tem.`}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Xong</Button>
        <Button size="sm" className="h-8" disabled={!canSave} onClick={() => void submit()}>{saving ? 'Đang ghi…' : 'Xác nhận cấp'}</Button>
      </>}>
      <div className="space-y-3 text-xs">
        {focus && (
          // ba ô số có nhãn (user 17/11 "hạn chế văn viết") — ĐVT in một lần cạnh tên
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono font-semibold shrink-0">{focus.material_code}</span>
              <span className="truncate">{focus.material_name ?? ''}</span>
              {focus.required == null && <span className="shrink-0"><StatusBadge tone="slate">Ngoài phiếu</StatusBadge></span>}
              <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-400">{matUnitCode(focus)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[10px] text-slate-500">Cần</p><p className="text-sm font-semibold tabular-nums">{focus.required != null ? qtyNum(Number(focus.required), focus) : '—'}</p></div>
              <div><p className="text-[10px] text-slate-500">Đã cấp</p><p className="text-sm font-semibold tabular-nums">{Number(focus.consumed) > 0 ? qtyNum(Number(focus.consumed), focus) : '—'}</p></div>
              <div><p className="text-[10px] text-slate-500">Thiếu</p>
                <p className={`text-sm font-semibold tabular-nums ${focus.required == null ? '' : focusNeed > 0 ? 'text-amber-700' : 'text-green-600'}`}>
                  {focus.required == null ? '—' : focusNeed > 0 ? qtyNum(focusNeed, focus) : <Check className="inline h-4 w-4" aria-label="Đủ" />}
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="flex rounded-lg border overflow-hidden">
          {([['SCAN', 'Quét tem'], ['LOT', 'Không có tem']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setMode(k); reset(); if (k === 'LOT' && focus) setMatId(focus.material_id) }}
              className={['touch-target flex-1 py-1.5 text-xs font-medium transition-colors', mode === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'].join(' ')}>{label}</button>
          ))}
        </div>
        {done && <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-green-800">{done}</div>}

        {mode === 'SCAN' && (<>
          <div>
            <Label className="text-xs">Tem pallet / bao <span className="text-red-500">*</span></Label>
            <div className="flex gap-1.5 mt-0.5">
              <Input ref={inputRef} autoFocus value={code} onChange={e => { setCode(e.target.value); if (entry) setEntry(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void lookup(code) } }}
                placeholder="Bắn súng / quét camera / gõ mã rồi Enter" className="h-9 sm:h-8 text-xs font-mono flex-1 min-w-0" />
              <Button type="button" variant="outline" size="sm" className="h-9 sm:h-8 shrink-0" onClick={() => setCamOpen(true)} title="Quét bằng camera">
                <ScanIcon className="h-4 w-4" />
              </Button>
            </div>
            {looking && <p className="text-slate-500 mt-1">Đang tra tem…</p>}
          </div>
          {entry && (
            <div className="rounded-lg border border-slate-200 p-2 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono font-semibold break-all">{entry.pallet_code}</span>
                {qaHold(entry) && <StatusBadge tone="red">QA giữ</StatusBadge>}
              </div>
              <div><span className="font-mono font-semibold">{entry.material?.material_code}</span> {entry.material?.short_name ?? ''}</div>
              <div className="text-slate-600">NSX {entry.production_date ? formatDate(String(entry.production_date).slice(0, 10)) : '—'}
                {' · '}HSD {entry.expiry_date ? formatDate(String(entry.expiry_date).slice(0, 10)) : '—'}
                {entry.batch ? ` · lô ${entry.batch}` : ''}{entry.location ? ` · ô ${entry.location.location_code}` : ''}</div>
              <div>Trên tem còn: <span className="font-semibold tabular-nums">{unitText(avail(entry))}</span>
                {!focus && needOf(entry.material_id) > 0 && <> · mẻ còn thiếu <span className="font-semibold tabular-nums text-amber-700">{unitText(needOf(entry.material_id))}</span></>}</div>
              {offPlan && <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-amber-800">Mã này không có trong yêu cầu của mẻ — vẫn cấp được, sẽ hiện là "ngoài yêu cầu".</div>}
              {held && <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-red-700">Tem đang bị QA giữ ({entry.qa_status?.name ?? entry.qa_status?.code ?? 'chưa duyệt'}) — không cấp được. Quét tem khác, hoặc nhờ QA đổi trạng thái.</div>}
              {earlier && <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-amber-800">Còn lô HSD sớm hơn ({formatDate(earlier.expiry_date ?? '')}{earlier.batch_lot ? ` · lô ${earlier.batch_lot}` : ''}) trong kho — nên dùng lô đó trước. Bắn tem lô đó là thay.</div>}
            </div>
          )}
        </>)}

        {mode === 'LOT' && (<>
          {!focus && (
            <div>
              <Label className="text-xs">Nguyên liệu <span className="text-red-500">*</span></Label>
              <SingleSelect value={matId} onChange={setMatId} serverSearch onSearchChange={setMatTerm} loading={mats.isFetching}
                selectedLabel={(selMat ?? matMemo)?.material_code} placeholder="Tìm mã / tên — chỉ mã còn hàng KHÔNG có tem"
                options={matList.map(m => ({ value: m.material_id, label: m.material_code, sub: `${m.material_name ?? ''} · không tem còn ${qtyCode(Number(m.available_no_tem ?? 0), m)}` }))} />
              {!mats.isFetching && !matList.length && !term && <p className="mt-1 text-slate-500">Kho chế biến này không có hàng nào thiếu tem — mọi nguyên liệu đều phải quét tem.</p>}
            </div>
          )}
          {matId && (
            <div>
              <Label className="text-xs">Lô <span className="text-red-500">*</span></Label>
              <div className="mt-0.5 overflow-auto border rounded-lg">
                <table className="w-full">
                  <thead><tr className="bg-slate-50 text-[9px] text-slate-500">
                    <th className="px-2 py-1 text-left whitespace-nowrap" />
                    <th className="px-2 py-1 text-left whitespace-nowrap">NSX</th><th className="px-2 py-1 text-left whitespace-nowrap">Mã lô</th>
                    <th className="px-2 py-1 text-left whitespace-nowrap">HSD</th><th className="px-2 py-1 text-right whitespace-nowrap">Cấp được{lotMat ? ` (${matUnitCode(lotMat)})` : ''}</th>
                  </tr></thead>
                  <tbody>
                    {!lots.length && <tr><td colSpan={5} className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{lotsQ.isLoading ? 'Đang tải…' : 'Không còn lô nào cấp được'}</td></tr>}
                    {lots.map(l => {
                      const k = keyOf(l)
                      const f = free(l)
                      return (
                        <tr key={k} className={`border-t border-slate-100 ${f > 0 ? 'cursor-pointer' : 'text-slate-400'} ${k === lotKey ? 'bg-sky-50' : ''}`}
                          onClick={() => { if (f > 0) { setLotKey(k); setQty(prefill(needOf(matId), f, boardMat(matId) ?? lotMat)) } }}>
                          <td className="px-2 py-1.5"><input type="radio" readOnly disabled={f <= 0} checked={k === lotKey} className="h-3.5 w-3.5" /></td>
                          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{l.production_date ? formatDate(dayOf(l.production_date)!) : '—'}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap font-mono">{l.batch_lot ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{l.expiry_date ? formatDate(l.expiry_date) : '—'}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-right font-semibold tabular-nums">
                            {f > 0 ? qtyNum(f, lotMat) : <span className="font-normal">có tem — quét</span>}
                            {f > 0 && Number(l.tem_pallets ?? 0) > 0 && <span className="ml-1 font-normal text-slate-400">+ {l.tem_pallets} tem</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {lots.length > 0 && !firstFree && <p className="mt-1 text-amber-700">Mã này chỉ còn hàng trên pallet / bao có tem — bấm "Quét tem" để cấp.</p>}
              {lotNotFirst && <p className="mt-1 text-amber-700">Lô này không phải lô HSD sớm nhất — kiểm lại trước khi cấp.</p>}
            </div>
          )}
        </>)}

        {(mode === 'SCAN' ? !!entry && !held : !!lot && free(lot) > 0) && (
          // Enter ở ô lượng = Xác nhận cấp (vòng PDA: bắn tem → Enter). Enter của súng bị máy đọc chặn trước khi tới đây.
          <div onKeyDown={e => { if (e.key === 'Enter' && canSave) { e.preventDefault(); void submit() } }}>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Lượng cấp{mat && !hasEntry(mat) && mat.base_unit ? ` (${matUnitCode(mat)})` : ''} <span className="text-red-500">*</span></Label>
              {max > 0 && qty !== max && <button type="button" className="text-[11px] text-blue-600 hover:underline touch-target" onClick={() => setQty(max)}>Lấy hết ({unitText(max)})</button>}
            </div>
            <div className="mt-0.5"><QtyInput value={qty} mat={mat} onChange={setQty} autoFocus /></div>
            {over && <p className="text-red-600 mt-1">Vượt lượng cấp được ({unitText(max)})</p>}
            {intErr && <p className="text-red-600 mt-1">{intErr}</p>}
          </div>
        )}
        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{err}</div>}
      </div>
      <QRScanDialog open={camOpen} onClose={() => setCamOpen(false)} warehouseId={batch.warehouse_id}
        title="Quét tem nguyên liệu" onScan={t => { setCamOpen(false); void lookup(t) }} />
    </FormSheet>
  )
}
