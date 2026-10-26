// FORM "NHẬP HÀNG TRẢ VỀ" (26/10, user chốt — memory return-receipt-design-2026-10-26). Thủ kho:
//   • THEO CHUYẾN XUẤT GỐC: tìm chuyến đã hoàn thành (Số xe · DO · khách · biển số) ⇒ app điền DO · mã · số đã xuất; nhập số trả
//     (không vượt đã xuất − đã khai trả). "Cả xe quay về" = điền hết phần còn trả được.
//   • LẬP TAY khi không tìm được chuyến: khách + mã + số + lý do.
//   • LÝ DO chọn từ danh mục (Cài đặt WMS); lý do khai "bắt chọn đợt" (Thu hồi) ⇒ phải chọn MÃ ĐỢT thu hồi đang mở.
//   • Công tắc QA THEO PHIẾU, mặc định KHÔNG giữ; bật ⇒ hàng quét nhận gắn QA "X" (giữ, không xuất được tới khi QA duyệt).
// Lập xong: mỗi mã thành một phiếu nhập (nguồn "RT") — quét / lưu thủ công / hoàn thành ở màn chi tiết phiếu nhập như thường.
// Giao lại hàng trả = ĐƠN RIÊNG (SAP tạo DO mới), form không hỏi.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { Undo2, Search, Trash2 } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { QtyInput } from '@/components/shared/QtyInput'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useGlobalScopeStore } from '@/stores/globalScopeStore'
import { useReturnTrips, useReturnTrip, useCreateReturn, useMaterials, useReturnReasons, useRecalls, type ReturnTripLine, type MaterialLite } from '@/api/hooks'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'
import { formatDate } from '@/utils/formatters'

type ManualRow = { key: string; material: MaterialLite; od: string; qty: number }
const TH = 'px-2 py-1 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap bg-slate-50'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'

export function InboundReturnSheet({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (r: { return_code: string; imports: { id: string; import_code: string }[] }) => void
}) {
  const { data: warehouses = [] } = useScopedWarehouses(true)
  const gWh = useGlobalScopeStore(s => s.warehouseId)
  const [warehouseId, setWarehouseId] = useState('')
  const [mode, setMode] = useState<'TRIP' | 'MANUAL'>('TRIP')
  const [term, setTerm] = useState('')
  const debTerm = useDebouncedValue(term, 300)
  const [gdoId, setGdoId] = useState<string | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})   // khoá `${od}||${material_id}` → base
  const [shipToName, setShipToName] = useState('')
  const [manualRows, setManualRows] = useState<ManualRow[]>([])
  const [matTerm, setMatTerm] = useState('')   // SingleSelect serverSearch tự giãn nhịp 250 ms
  const debMat = matTerm
  const [reasonCode, setReasonCode] = useState('')
  const [reason, setReason] = useState('')     // ghi chú thêm
  const [recallId, setRecallId] = useState('')
  const [qaHold, setQaHold] = useState(false)
  const [err, setErr] = useState('')
  const { data: reasons = [] } = useReturnReasons()
  const { data: recalls = [] } = useRecalls('OPEN')
  const needRecall = reasons.find(r => r.value === reasonCode)?.meta?.requires_recall === true

  useEffect(() => {
    if (!open) return
    const ids = new Set((warehouses as { id: string }[]).map(w => w.id))
    setWarehouseId(gWh && ids.has(gWh) ? gWh : (warehouses.length === 1 ? (warehouses[0] as { id: string }).id : ''))
    setMode('TRIP'); setTerm(''); setGdoId(null); setQty({}); setShipToName(''); setManualRows([]); setMatTerm('')
    setReasonCode(''); setReason(''); setRecallId(''); setQaHold(false); setErr('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const tripsQ = useReturnTrips(open && mode === 'TRIP' && !gdoId ? warehouseId : '', debTerm.trim())
  const tripQ = useReturnTrip(open && mode === 'TRIP' ? gdoId : null)
  const lines = tripQ.data?.lines ?? []
  const keyOf = (l: ReturnTripLine) => `${l.od_number}||${l.material_id}`
  const roomOf = (l: ReturnTripLine) => Math.max(0, l.shipped_base - l.returned_base)
  const { data: matHits = [] } = useMaterials({ search: debMat || undefined, limit: 50 }, open && mode === 'MANUAL' && debMat.trim().length > 0)
  const create = useCreateReturn()

  const payloadLines = useMemo(() => mode === 'TRIP'
    ? lines.filter(l => (qty[keyOf(l)] ?? 0) > 0).map(l => ({ od_number: l.od_number, material_id: l.material_id, qty_base: qty[keyOf(l)] }))
    : manualRows.filter(r => r.qty > 0).map(r => ({ od_number: r.od.trim() || null, material_id: r.material.id, qty_base: r.qty })),
  [mode, lines, qty, manualRows])
  const over = mode === 'TRIP' && lines.some(l => (qty[keyOf(l)] ?? 0) > roomOf(l) + 1e-9)
  const canSave = !!warehouseId && payloadLines.length > 0 && !!reasonCode && (!needRecall || !!recallId) && !over
    && (mode === 'TRIP' ? !!gdoId : shipToName.trim().length > 0)

  async function save() {
    setErr('')
    try {
      const r = await create.mutateAsync({
        warehouse_id: warehouseId, reason_code: reasonCode, reason: reason.trim() || undefined, recall_id: recallId || undefined,
        qa_hold: qaHold, lines: payloadLines,
        ...(mode === 'TRIP' ? { gdo_id: gdoId! } : { ship_to_name: shipToName.trim() }),
      })
      onCreated(r)
    } catch (e) {
      const ax = e as AxiosError<{ error?: { message?: string } }>
      setErr(ax.response?.data?.error?.message ?? 'Không lập được phiếu nhập trả')
    }
  }

  const fillAll = () => setQty(Object.fromEntries(lines.map(l => [keyOf(l), roomOf(l)])))
  const totalRows = payloadLines.length

  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-3xl"
      title={<span className="inline-flex items-center gap-1.5"><Undo2 className="h-4 w-4 text-sky-600" />Nhập hàng trả về</span>}
      description="Chọn chuyến xuất gốc để app điền sẵn hàng đã xuất; không tìm được chuyến thì lập tay. Giao lại hàng trả = đơn riêng (SAP tạo DO mới)."
      footer={<>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose} disabled={create.isPending}>Huỷ</Button>
        <Button size="sm" className="h-8" onClick={() => void save()} disabled={!canSave || create.isPending}>
          {create.isPending ? 'Đang lập…' : `Lập phiếu nhập trả${totalRows ? ` (${totalRows} dòng)` : ''}`}
        </Button>
      </>}>
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Kho nhận hàng trả <span className="text-red-500">*</span></Label>
            <WarehouseSingleSelect warehouses={warehouses as { id: string; code?: string; name: string }[]} value={warehouseId}
              onChange={v => { setWarehouseId(v); setGdoId(null); setQty({}) }} triggerClassName="h-8 mt-0.5" />
          </div>
          <div>
            <Label className="text-xs">Cách lập</Label>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {([['TRIP', 'Theo chuyến xuất gốc'], ['MANUAL', 'Lập tay (không tìm được chuyến)']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => { setMode(k); setErr('') }}
                  className={`h-8 rounded-full border px-3 ${mode === k ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {mode === 'TRIP' && !gdoId && (
          <div className="space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-4 w-4 text-slate-400" />
              <Input value={term} onChange={e => setTerm(e.target.value)} placeholder="Tìm chuyến đã xuất: Số xe · DO · khách · biển số (90 ngày gần nhất)" className="h-8 pl-8 text-xs" disabled={!warehouseId} />
            </div>
            {!warehouseId && <div className="text-slate-500">Chọn kho trước.</div>}
            {warehouseId && (
              <div className="overflow-auto border rounded-lg max-h-[45vh]">
                <table className="w-full">
                  <thead className="sticky top-0"><tr>
                    <th className={TH}>Số xe</th><th className={TH}>Ngày xuất</th><th className={TH}>Biển số</th><th className={TH}>Khách</th><th className={TH}>DO</th><th className={TH}>Đã nhập trả</th>
                  </tr></thead>
                  <tbody>
                    {!(tripsQ.data ?? []).length && <tr><td colSpan={6} className={`${TD} text-slate-400`}>{tripsQ.isLoading ? 'Đang tìm…' : 'Không có chuyến đã hoàn thành khớp — thử từ khoá khác, hoặc chọn "Lập tay".'}</td></tr>}
                    {(tripsQ.data ?? []).map(t => (
                      <tr key={t.gdo_id} className="border-t border-slate-100 cursor-pointer hover:bg-sky-50" onClick={() => { setGdoId(t.gdo_id); setQty({}) }}>
                        <td className={`${TD} font-mono font-semibold`}>{t.group_code ?? '—'}</td>
                        <td className={`${TD} tabular-nums`}>{t.delivery_date ? formatDate(t.delivery_date) : '—'}</td>
                        <td className={`${TD} font-mono`}>{t.license_plate ?? '—'}</td>
                        <td className={`${TD} max-w-[220px] truncate`} title={t.customers.join(', ')}>{t.customers.join(', ') || '—'}</td>
                        <td className={`${TD} tabular-nums`} title={t.dos.join(', ')}>{t.dos.length}</td>
                        <td className={TD}>{t.returns.length ? <span className="text-amber-700">{t.returns.join(', ')}</span> : <span className="text-slate-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {mode === 'TRIP' && gdoId && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-700">Chuyến <span className="font-mono">{tripQ.data?.trip.group_code ?? '…'}</span></span>
              {tripQ.data?.trip.delivery_date && <span className="text-slate-500">· xuất {formatDate(tripQ.data.trip.delivery_date)}</span>}
              {tripQ.data?.trip.license_plate && <span className="text-slate-500 font-mono">· {tripQ.data.trip.license_plate}</span>}
              <button type="button" className="text-sky-700 hover:underline" onClick={() => { setGdoId(null); setQty({}) }}>Đổi chuyến</button>
              <span className="flex-1" />
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={fillAll} disabled={!lines.length} title="Điền số trả = toàn bộ phần còn trả được của chuyến">Cả xe quay về</Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setQty({})} disabled={!Object.keys(qty).length}>Xoá số</Button>
            </div>
            <div className="overflow-auto border rounded-lg max-h-[50vh]">
              <table className="w-full">
                <thead className="sticky top-0 z-10"><tr>
                  <th className={TH}>DO</th><th className={TH}>Khách</th><th className={TH}>Mã</th><th className={TH}>Tên hàng</th>
                  <th className={TH}>Đã xuất</th><th className={TH}>Đã khai trả</th><th className={TH}>Trả lần này</th>
                </tr></thead>
                <tbody>
                  {!lines.length && <tr><td colSpan={7} className={`${TD} text-slate-400`}>{tripQ.isLoading ? 'Đang tải hàng của chuyến…' : tripQ.isError ? 'Không tải được chuyến' : 'Chuyến không có hàng đã xuất'}</td></tr>}
                  {lines.map(l => {
                    const k = keyOf(l), m = l.material as MatUnits | null, room = roomOf(l), v = qty[k] ?? 0
                    return (
                      <tr key={k} className="border-t border-slate-100">
                        <td className={`${TD} font-mono`}>{l.od_number || '—'}</td>
                        <td className={`${TD} max-w-[160px] truncate`} title={l.customer ?? ''}>{l.customer ?? '—'}</td>
                        <td className={`${TD} font-mono font-semibold`}>{l.material?.material_code ?? '—'}</td>
                        <td className={`${TD} max-w-[180px] truncate`} title={l.material?.short_name ?? ''}>{l.material?.short_name ?? '—'}</td>
                        <td className={`${TD} tabular-nums`}>{qtyLabel(l.shipped_base, m)}</td>
                        <td className={`${TD} tabular-nums`}>{l.returned_base ? <span className="text-amber-700">{qtyLabel(l.returned_base, m)}</span> : <span className="text-slate-300">—</span>}</td>
                        <td className={`${TD} min-w-[150px]`}>
                          {room > 0
                            ? <QtyInput compact value={v} mat={m} onChange={b => setQty(q => ({ ...q, [k]: b }))} className={v > room + 1e-9 ? '[&_input]:border-red-400' : ''} />
                            : <span className="text-slate-400">Đã khai trả hết</span>}
                          {v > room + 1e-9 && <div className="text-[9px] text-red-600 mt-0.5">Vượt phần còn trả được ({qtyLabel(room, m)})</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {mode === 'MANUAL' && (
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Khách trả hàng <span className="text-red-500">*</span></Label>
              <Input value={shipToName} onChange={e => setShipToName(e.target.value)} maxLength={200} placeholder="Tên / mã khách" className="h-8 mt-0.5 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Thêm mã hàng</Label>
              <SingleSelect value="" serverSearch onSearchChange={setMatTerm} selectedLabel={undefined} searchPlaceholder="Gõ mã / tên hàng…" placeholder="Chọn mã hàng trả về"
                triggerClassName="h-8 mt-0.5"
                onChange={v => {
                  const m = (matHits as MaterialLite[]).find(x => x.id === v)
                  if (m && !manualRows.some(r => r.material.id === m.id)) setManualRows(rs => [...rs, { key: `${m.id}-${Date.now()}`, material: m, od: '', qty: 0 }])
                }}
                options={(matHits as MaterialLite[]).filter(m => !m.is_non_stock).map(m => ({ value: m.id, label: `${m.material_code} ${m.short_name ?? m.material_description ?? ''}` }))} />
            </div>
            {manualRows.length > 0 && (
              <div className="overflow-auto border rounded-lg">
                <table className="w-full">
                  <thead><tr><th className={TH}>Mã</th><th className={TH}>Tên hàng</th><th className={TH}>DO (nếu biết)</th><th className={TH}>Số trả</th><th className={TH}></th></tr></thead>
                  <tbody>
                    {manualRows.map(r => (
                      <tr key={r.key} className="border-t border-slate-100">
                        <td className={`${TD} font-mono font-semibold`}>{r.material.material_code}</td>
                        <td className={`${TD} max-w-[180px] truncate`}>{r.material.short_name ?? r.material.material_description}</td>
                        <td className={TD}><Input value={r.od} onChange={e => setManualRows(rs => rs.map(x => x.key === r.key ? { ...x, od: e.target.value } : x))} className="h-7 w-32 text-[11px]" maxLength={200} /></td>
                        <td className={`${TD} min-w-[150px]`}><QtyInput compact value={r.qty} mat={r.material as MatUnits} onChange={b => setManualRows(rs => rs.map(x => x.key === r.key ? { ...x, qty: b } : x))} /></td>
                        <td className={TD}><button type="button" className="p-1 text-slate-400 hover:text-red-600" title="Bỏ dòng" onClick={() => setManualRows(rs => rs.filter(x => x.key !== r.key))}><Trash2 className="h-3.5 w-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Lý do trả <span className="text-red-500">*</span></Label>
            <SingleSelect value={reasonCode} onChange={setReasonCode} placeholder="Chọn lý do" triggerClassName="h-8 mt-0.5"
              options={reasons.map(r => ({ value: r.value, label: r.meta?.label?.trim() || r.value }))} />
          </div>
          <div>
            <Label className="text-xs">Mã đợt thu hồi {needRecall ? <span className="text-red-500">*</span> : <span className="text-slate-400">(nếu có)</span>}</Label>
            <SingleSelect value={recallId} onChange={setRecallId} placeholder={recalls.length ? 'Chọn mã đợt' : 'Chưa có đợt nào đang mở'} triggerClassName="h-8 mt-0.5"
              options={[...(needRecall ? [] : [{ value: '', label: '— Không thuộc đợt nào —' }]), ...recalls.map(r => ({ value: r.id, label: `${r.code}${r.name ? ` · ${r.name}` : ''}` }))]} />
            {needRecall && !recalls.length && <div className="text-[10px] text-amber-700 mt-0.5">Lý do này bắt chọn đợt — nhờ người có quyền tạo mã đợt ở trang Hàng trả về.</div>}
          </div>
        </div>
        <div>
          <Label className="text-xs">Ghi chú</Label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500}
            placeholder="vd hàng móp góc · khách hẹn giao lại tuần sau"
            className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs" />
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 cursor-pointer">
          <Switch checked={qaHold} onCheckedChange={setQaHold} className="mt-0.5" />
          <span>
            <span className="font-medium text-slate-700">Giữ hàng chờ QA (Hold)</span>
            <span className="block text-[11px] text-slate-500">Bật: mọi pallet quét nhận của phiếu này gắn QA "X" — không xuất được tới khi QA duyệt. Tắt (mặc định): hàng dùng được ngay. Mã không theo QR nhận vào tồn chung nên không gắn giữ được.</span>
          </span>
        </label>

        {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">{err}</div>}
      </div>
    </FormSheet>
  )
}
