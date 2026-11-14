// RÚT NGUYÊN LIỆU VÀO MẺ (MES 14/11, user chốt: "quét tem hoặc chọn trường hợp không có tem mà chỉ có số lượng, lô").
//   • Quét tem: súng PDA / camera / gõ mã ⇒ tra tem trong KHO CỦA MẺ ⇒ nhập lượng ⇒ trừ đúng dòng tồn đó.
//   • Không có tem: chọn mã (chỉ mã đang có tồn rút được) ⇒ chọn lô (NSX / mã lô, HSD sớm lên đầu) ⇒ nhập lượng ⇒ BE trừ FEFO trong lô.
// Sheet giữ mở sau mỗi lần rút để quét liên tục; kết quả lần vừa rút hiện ngay trên đầu.
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { qtyLabel, qtyIntegerError, type MatUnits } from '@/utils/qtyUnits'
import { normalizeQR } from '@/utils/qr'
import { formatDate } from '@/utils/formatters'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const avail = (e: ScanEntry) => Number(e.cartons_remaining ?? e.cartons_imported ?? 0) - Number(e.cartons_reserved ?? 0)
const dayOf = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null)

export function ConsumeSheet({ open, onClose, batch }: { open: boolean; onClose: () => void; batch: BatchDetail }) {
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

  useEffect(() => { if (open) { setMode('SCAN'); reset(); setDone(null); setMatId(''); setLotKey(''); setMatTerm('') } }, [open])
  function reset() { setCode(''); setEntry(null); setQty(0); setErr('') }

  async function lookup(raw: string) {
    const c = normalizeQR(raw)
    if (!c) return
    setCode(c); setErr(''); setEntry(null); setLooking(true)
    try { const e = await scanCheck(batch.id, c); setEntry(e); setQty(0) }
    catch (e) { setErr(apiMsg(e)) }
    finally { setLooking(false) }
  }
  // Súng PDA: chỉ nghe khi đang CHỜ quét (chưa có tem trên màn) — có tem rồi thì cò súng không được ghi đè số đang nhập
  useWedgeScanner(c => { void lookup(c) }, open && mode === 'SCAN' && !entry && !camOpen, { exclusive: true })

  // FEFO: cùng mã còn lô HSD sớm hơn tem vừa quét ⇒ nhắc (không chặn — luật chặn theo cờ luân chuyển là việc giai đoạn sau)
  const scanLots = useProductionStock(entry ? batch.warehouse_id : undefined, entry?.material_id).data?.lots ?? []
  const earlier = entry?.expiry_date ? scanLots.find(l => l.expiry_date && l.expiry_date < String(entry.expiry_date).slice(0, 10)) : undefined

  const term = useDebouncedValue(matTerm, 250)
  const mats = useProductionStock(open && mode === 'LOT' ? batch.warehouse_id : undefined, undefined, term)
  const matList = mats.data?.materials ?? []
  const lotsQ = useProductionStock(matId ? batch.warehouse_id : undefined, matId || undefined)
  const lots = lotsQ.data?.lots ?? []
  const keyOf = (l: StockLot) => `${dayOf(l.production_date) ?? ''}|${l.batch_lot ?? ''}`
  const lot = lots.find(l => keyOf(l) === lotKey) ?? null
  const selMat = matList.find(m => m.material_id === matId)
  const [matMemo, setMatMemo] = useState<(MatUnits & { material_code: string; material_name: string | null }) | null>(null)
  useEffect(() => { if (selMat) setMatMemo(selMat) }, [selMat])
  const lotMat: MatUnits | null = selMat ?? matMemo
  useEffect(() => { setLotKey(''); setQty(0) }, [matId])
  useEffect(() => { if (lots.length && !lots.some(l => keyOf(l) === lotKey)) setLotKey(keyOf(lots[0])) }, [lots]) // eslint-disable-line react-hooks/exhaustive-deps
  const lotNotFirst = !!lot && lots.length > 1 && keyOf(lot) !== keyOf(lots[0])

  const mat: MatUnits | null = mode === 'SCAN' ? (entry?.material ?? null) : lotMat
  const max = mode === 'SCAN' ? (entry ? avail(entry) : 0) : Number(lot?.available ?? 0)
  const intErr = qty > 0 ? qtyIntegerError(qty, mat) : null
  const over = qty > max + 1e-9
  const saving = consumeScan.isPending || consumeLot.isPending
  const canSave = qty > 0 && !over && !intErr && !saving && (mode === 'SCAN' ? !!entry : !!lot)
  const unitText = (n: number) => qtyLabel(n, mat)

  async function submit() {
    setErr('')
    try {
      if (mode === 'SCAN' && entry) {
        const r = await consumeScan.mutateAsync({ batchId: batch.id, entry_id: entry.id, qty })
        const row = r.rows[0]
        setDone(`Đã rút ${unitText(qty)} từ tem ${entry.pallet_code} — tem còn ${unitText(Number(row?.remaining ?? 0))}`)
        reset()
        setTimeout(() => inputRef.current?.focus(), 50)
      } else if (lot && matId) {
        const r = await consumeLot.mutateAsync({ batchId: batch.id, material_id: matId, production_date: dayOf(lot.production_date), batch_lot: lot.batch_lot, qty })
        setDone(`Đã rút ${unitText(qty)} ${selMat?.material_code ?? ''} theo lô ${lot.batch_lot ?? formatDate(dayOf(lot.production_date) ?? '')} — trừ ${r.rows.length} dòng tồn (HSD sớm trước)`)
        setQty(0)
      }
    } catch (e) { setErr(apiMsg(e)) }
  }

  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-xl"
      title={`Rút nguyên liệu vào mẻ ${batch.batch_code}`}
      description={`Chỉ rút được hàng đang nằm ở kho chế biến ${batch.warehouse?.name ?? ''}, không bị QA giữ.`}
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Xong</Button>
        <Button size="sm" className="h-8" disabled={!canSave} onClick={() => void submit()}>{saving ? 'Đang rút…' : 'Xác nhận rút'}</Button>
      </>}>
      <div className="space-y-3 text-xs">
        <div className="flex rounded-lg border overflow-hidden">
          {([['SCAN', 'Quét tem'], ['LOT', 'Không có tem']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setMode(k); reset() }}
              className={['flex-1 py-1.5 text-xs font-medium transition-colors', mode === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'].join(' ')}>{label}</button>
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
                {entry.qa_status && entry.qa_status.code !== 'OK' && <StatusBadge tone="red">QA giữ</StatusBadge>}
              </div>
              <div><span className="font-mono font-semibold">{entry.material?.material_code}</span> {entry.material?.short_name ?? ''}</div>
              <div className="text-slate-600">NSX {entry.production_date ? formatDate(String(entry.production_date).slice(0, 10)) : '—'}
                {' · '}HSD {entry.expiry_date ? formatDate(String(entry.expiry_date).slice(0, 10)) : '—'}
                {entry.batch ? ` · lô ${entry.batch}` : ''}{entry.location ? ` · ô ${entry.location.location_code}` : ''}</div>
              <div>Rút được: <span className="font-semibold tabular-nums">{unitText(avail(entry))}</span></div>
              {earlier && <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-amber-800">Còn lô HSD sớm hơn ({formatDate(earlier.expiry_date ?? '')}{earlier.batch_lot ? ` · lô ${earlier.batch_lot}` : ''}) trong kho — nên dùng lô đó trước.</div>}
            </div>
          )}
        </>)}

        {mode === 'LOT' && (<>
          <div>
            <Label className="text-xs">Nguyên liệu <span className="text-red-500">*</span></Label>
            <SingleSelect value={matId} onChange={setMatId} serverSearch onSearchChange={setMatTerm} loading={mats.isFetching}
              selectedLabel={(selMat ?? matMemo)?.material_code} placeholder="Tìm mã / tên — chỉ mã đang có tồn ở kho chế biến"
              options={matList.map(m => ({ value: m.material_id, label: m.material_code, sub: `${m.material_name ?? ''} · còn ${qtyLabel(Number(m.available), m)}` }))} />
          </div>
          {matId && (
            <div>
              <Label className="text-xs">Lô <span className="text-red-500">*</span></Label>
              <div className="mt-0.5 overflow-auto border rounded-lg">
                <table className="w-full">
                  <thead><tr className="bg-slate-50 text-[9px] text-slate-500">
                    <th className="px-2 py-1 text-left whitespace-nowrap" />
                    <th className="px-2 py-1 text-left whitespace-nowrap">NSX</th><th className="px-2 py-1 text-left whitespace-nowrap">Mã lô</th>
                    <th className="px-2 py-1 text-left whitespace-nowrap">HSD</th><th className="px-2 py-1 text-right whitespace-nowrap">Rút được</th>
                  </tr></thead>
                  <tbody>
                    {!lots.length && <tr><td colSpan={5} className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{lotsQ.isLoading ? 'Đang tải…' : 'Không còn lô nào rút được'}</td></tr>}
                    {lots.map(l => {
                      const k = keyOf(l)
                      return (
                        <tr key={k} className={`border-t border-slate-100 cursor-pointer ${k === lotKey ? 'bg-sky-50' : ''}`} onClick={() => { setLotKey(k); setQty(0) }}>
                          <td className="px-2 py-1.5"><input type="radio" readOnly checked={k === lotKey} className="h-3.5 w-3.5" /></td>
                          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{l.production_date ? formatDate(dayOf(l.production_date)!) : '—'}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap font-mono">{l.batch_lot ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{l.expiry_date ? formatDate(l.expiry_date) : '—'}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-right font-semibold tabular-nums">{qtyLabel(Number(l.available), lotMat)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {lotNotFirst && <p className="mt-1 text-amber-700">Lô này không phải lô HSD sớm nhất — kiểm lại trước khi rút.</p>}
            </div>
          )}
        </>)}

        {(mode === 'SCAN' ? !!entry : !!lot) && (
          <div>
            <Label className="text-xs">Lượng rút <span className="text-red-500">*</span></Label>
            <div className="mt-0.5"><QtyInput value={qty} mat={mat} onChange={setQty} autoFocus /></div>
            {over && <p className="text-red-600 mt-1">Vượt lượng rút được ({unitText(max)})</p>}
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
