// KHỐI "PHIẾU TRẢ VỀ" trên màn chi tiết phiếu nhập (26/10): phiếu trả · chuyến gốc · khách · lý do · QA giữ hay không, TEM GỐC đã
// xuất của mã này (đã nhận về bao nhiêu), và nút NHẬN HÀNG LẺ THEO TEM GỐC — hàng lẻ quay về không có tem riêng ⇒ app sinh tem
// con ".N" mang lô / NSX / HSD gốc (user chốt "hàng lẻ in tem mới mang lô gốc"; in lại tem ở In tem pallet → In lại). Pallet
// còn nguyên thì quét tem như nhập thường (nút "Thêm pallet").
import { useState } from 'react'
import type { AxiosError } from 'axios'
import { Undo2, PackagePlus } from 'lucide-react'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QtyInput } from '@/components/shared/QtyInput'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { useReturnByOrder, useReturnLoose, useNppReturn, useTagNppReturn, useReturnReasons, useRecalls } from '@/api/hooks'
import { qtyLabel, type MatUnits } from '@/utils/qtyUnits'
import { formatDate } from '@/utils/formatters'
import type { InboundOrder } from '@/types'

const TH = 'px-2 py-1 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap bg-slate-50'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'

// HÀNG NPP CHUYỂN VỀ (26/10 tối): NPP dùng app tạo đơn xuất về kho chính ⇒ phiếu nhận chuyển kho (TF) ở kho chính chính là
// hàng trả về. Khối này hiện CHỈ khi chuyến nguồn thuộc kho loại NPP: kho gắn lý do / ghi chú / mã đợt cho cả chuyến đó
// (mọi phiếu nhập của chuyến) để vào thống kê Hàng trả về. Lý do khai "bắt chọn đợt" ⇒ phải chọn mã đợt.
export function NppReturnTag({ gdoId, canEdit }: { gdoId: string; canEdit: boolean }) {
  const q = useNppReturn(gdoId)
  const { data: reasons = [] } = useReturnReasons()
  const { data: recalls = [] } = useRecalls()
  const save = useTagNppReturn()
  const [form, setForm] = useState<{ reason: string; recall: string; note: string } | null>(null)   // null = form đóng
  const [err, setErr] = useState('')
  const d = q.data
  if (!d?.is_npp) return null
  const reasonLabel = d.reason_code ? (reasons.find(r => r.value === d.reason_code)?.meta?.label ?? d.reason_code) : null
  const needRecall = !!form && reasons.find(r => r.value === form.reason)?.meta?.requires_recall === true
  const recallOf = recalls.find(r => r.id === (d.recall_id ?? ''))
  async function submit() {
    if (!form) return
    setErr('')
    try {
      await save.mutateAsync({ gdoId, reason_code: form.reason, note: form.note.trim() || undefined, recall_id: form.recall || null })
      setForm(null)
    } catch (e) { setErr((e as AxiosError<{ error?: { message?: string } }>).response?.data?.error?.message ?? 'Không lưu được') }
  }
  return (
    <div className="w-full mt-0.5 px-2 py-1.5 rounded bg-rose-50 border border-rose-100 text-[10px] flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-semibold text-rose-700 inline-flex items-center gap-1"><Undo2 className="h-3 w-3" />Hàng NPP chuyển về</span>
      <span className="text-slate-500">Từ: <span className="text-slate-700">{d.npp_name ?? '—'}</span></span>
      {reasonLabel && <span className="text-slate-500">Lý do: <span className="text-slate-700 font-medium">{reasonLabel}</span>
        {recallOf && <> · Đợt <span className="font-mono font-semibold">{recallOf.code}</span></>}{d.note && <> · {d.note}</>}</span>}
      {!d.reason_code ? <span className="text-red-600 font-medium">Chưa gắn lý do — bắt buộc trước khi hoàn thành phiếu</span>
        : d.missing > 0 && <span className="text-red-600 font-medium">{d.missing}/{d.imports} phiếu chưa mang lý do — bấm Gắn lý do để lưu cho cả chuyến</span>}
      {canEdit && (
        <Button size="sm" variant="outline" className="h-7 text-[11px] ml-auto"
          onClick={() => { setErr(''); setForm({ reason: d.reason_code ?? '', recall: d.recall_id ?? '', note: d.note ?? '' }) }}>
          {d.reason_code ? 'Sửa lý do' : 'Gắn lý do'}
        </Button>
      )}
      {form && (
        <FormSheet open onClose={() => setForm(null)} title="Lý do trả — hàng NPP chuyển về"
          description={`Áp cho cả ${d.imports} phiếu nhận của chuyến ${d.group_code ?? ''} từ ${d.npp_name ?? 'NPP'}.`}
          footer={<>
            <Button variant="outline" onClick={() => setForm(null)}>Huỷ</Button>
            <Button onClick={() => void submit()} disabled={!form.reason || (needRecall && !form.recall) || save.isPending}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
          </>}>
          <div className="space-y-3">
            {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>}
            <div>
              <Label className="text-xs">Lý do trả <span className="text-red-500">*</span></Label>
              <SingleSelect value={form.reason} onChange={v => setForm({ ...form, reason: v })} placeholder="Chọn lý do" triggerClassName="h-8 mt-0.5"
                options={reasons.map(r => ({ value: r.value, label: r.meta?.label?.trim() || r.value }))} />
            </div>
            <div>
              <Label className="text-xs">Mã đợt thu hồi {needRecall ? <span className="text-red-500">*</span> : <span className="text-slate-400">(nếu có)</span>}</Label>
              <SingleSelect value={form.recall} onChange={v => setForm({ ...form, recall: v })} placeholder="Chọn mã đợt" triggerClassName="h-8 mt-0.5"
                options={[{ value: '', label: '— Không thuộc đợt nào —' }, ...recalls.filter(r => r.status === 'OPEN' || r.id === d.recall_id).map(r => ({ value: r.id, label: `${r.code}${r.name ? ` · ${r.name}` : ''}` }))]} />
            </div>
            <div>
              <Label className="text-xs">Ghi chú</Label>
              <Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Tuỳ chọn" maxLength={500} className="h-8 text-xs mt-0.5" />
            </div>
          </div>
        </FormSheet>
      )}
    </div>
  )
}

export function InboundReturnPanel({ order, canScan, noQr }: { order: InboundOrder; canScan: boolean; noQr: boolean }) {
  const q = useReturnByOrder(order.id, order.source_type === 'RETURN')
  const r = q.data
  const mat = order.material as MatUnits | null
  const isOpen = order.status === 'OPEN'
  const [loose, setLoose] = useState<{ code: string; qty: number; nsx: string } | null>(null)   // nsx '' = theo tem gốc
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const recv = useReturnLoose()
  const head = order.inbound_return
  if (order.source_type !== 'RETURN') return null

  async function saveLoose() {
    if (!loose) return
    setErr('')
    try {
      const d = await recv.mutateAsync({ orderId: order.id, source_pallet_code: loose.code.trim(), qty_base: loose.qty, location_id: order.location_id!, production_date: loose.nsx || undefined })
      setOk(`Đã nhận ${qtyLabel(loose.qty, mat)} vào tem con ${d.pallet_code}${d.warnings.length ? ` — ${d.warnings.join(' · ')}` : ''}. In tem: In tem pallet → In lại.`)
      setLoose(null)
    } catch (e) {
      setErr((e as AxiosError<{ error?: { message?: string } }>).response?.data?.error?.message ?? 'Không nhận được hàng lẻ')
    }
  }

  return (
    <div className="w-full mt-0.5 space-y-1">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 py-1 rounded bg-rose-50 border border-rose-100 text-[10px]">
        <span className="font-semibold text-rose-700 inline-flex items-center gap-1"><Undo2 className="h-3 w-3" />Hàng trả về</span>
        <span className="text-slate-500">Phiếu: <span className="font-mono font-semibold text-rose-700">{head?.return_code ?? r?.return_code ?? '…'}</span></span>
        <span className="text-slate-500">Chuyến gốc: {head?.group_code ? <span className="font-mono font-semibold">{head.group_code}</span> : <span className="italic">lập tay</span>}</span>
        {r?.license_plate && <span className="text-slate-500">Xe: <span className="font-mono">{r.license_plate}</span></span>}
        {(head?.ship_to_name ?? r?.ship_to_name) && <span className="text-slate-500">Khách: <span className="text-slate-700">{head?.ship_to_name ?? r?.ship_to_name}</span></span>}
        {r?.lines?.some(l => l.od_number) && <span className="text-slate-500">DO: <span className="font-mono">{r.lines.map(l => l.od_number).filter(Boolean).join(' · ')}</span></span>}
        <span className="text-slate-500">Lý do: <span className="text-slate-700">{r?.reason_label ?? '…'}</span>{(r?.reason ?? head?.reason) && <span className="text-slate-500"> · {r?.reason ?? head?.reason}</span>}</span>
        {r?.recall && <span className="text-slate-500">Đợt: <span className="font-mono font-semibold text-slate-700" title={r.recall.name ?? ''}>{r.recall.code}</span></span>}
        {(head?.qa_hold ?? r?.qa_hold) ? <StatusBadge tone="red" title="Pallet quét nhận gắn QA X — chỉ xuất được sau khi QA duyệt">Giữ QA</StatusBadge> : <StatusBadge tone="green">Không giữ QA</StatusBadge>}
      </span>

      {!noQr && (r?.pallets?.length ?? 0) > 0 && (
        <div className="overflow-auto border rounded-lg max-h-[28vh]">
          <table className="w-full">
            <thead className="sticky top-0"><tr>
              <th className={TH}>Tem gốc đã xuất (mã này)</th><th className={TH}>NSX</th><th className={TH}>Đã xuất</th><th className={TH}>Đã nhận về</th><th className={TH}>Còn trả được</th><th className={TH}>Thừa</th><th className={TH}></th>
            </tr></thead>
            <tbody>
              {r!.pallets.map(p => (
                <tr key={p.pallet_code} className="border-t border-slate-100">
                  <td className={`${TD} font-mono`}>{p.pallet_code}</td>
                  <td className={`${TD} tabular-nums`}>{p.production_date ? formatDate(p.production_date) : '—'}</td>
                  <td className={`${TD} tabular-nums`}>{qtyLabel(p.qty_base, mat)}</td>
                  <td className={`${TD} tabular-nums`}>{p.returned_base ? <span className="text-rose-700">{qtyLabel(p.returned_base, mat)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className={`${TD} tabular-nums`}>{qtyLabel(Math.max(0, p.qty_base - p.returned_base), mat)}</td>
                  <td className={`${TD} tabular-nums`} title="Nhận vượt số tem này đã xuất trên chuyến — tách tem con, chuyến chỉ tính trả về tới số đã xuất">
                    {p.surplus_base ? <span className="text-amber-700 font-semibold">{qtyLabel(p.surplus_base, mat)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className={TD}>
                    {isOpen && canScan && (
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!order.location_id}
                        title={order.location_id ? 'Hàng lẻ không còn tem — nhận vào tem con mang lô / NSX của tem này' : 'Chọn vị trí của phiếu trước'}
                        onClick={() => { setErr(''); setOk(''); setLoose({ code: p.pallet_code, qty: 0, nsx: '' }) }}>
                        <PackagePlus className="h-3.5 w-3.5 mr-1" />Nhận hàng lẻ
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!noQr && isOpen && canScan && !head?.gdo_id && (
        <button type="button" className="text-[11px] text-sky-700 hover:underline disabled:text-slate-400" disabled={!order.location_id}
          onClick={() => { setErr(''); setOk(''); setLoose({ code: '', qty: 0, nsx: '' }) }}>
          + Nhận hàng lẻ theo tem gốc (gõ / quét mã tem)
        </button>
      )}
      {ok && <div className="rounded bg-green-50 border border-green-200 px-2 py-1 text-[11px] text-green-800">{ok}</div>}

      <FormSheet open={!!loose} onClose={() => setLoose(null)} title="Nhận hàng lẻ theo tem gốc"
        description="Hàng lẻ trả về không có tem riêng — app tạo tem con (.N) mang đúng lô / NSX / HSD của tem gốc, đặt tại vị trí của phiếu."
        footer={<>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setLoose(null)} disabled={recv.isPending}>Huỷ</Button>
          <Button size="sm" className="h-8" disabled={!loose || !loose.code.trim() || !(loose.qty > 0) || recv.isPending} onClick={() => void saveLoose()}>
            {recv.isPending ? 'Đang nhận…' : 'Nhận vào kho'}
          </Button>
        </>}>
        {loose && (
          <div className="space-y-3 text-xs">
            <div>
              <Label className="text-xs">Tem gốc</Label>
              <Input value={loose.code} onChange={e => setLoose({ ...loose, code: e.target.value })} placeholder="Mã tem pallet gốc" className="h-8 mt-0.5 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs">Số lượng nhận về</Label>
              <QtyInput value={loose.qty} mat={mat} onChange={b => setLoose({ ...loose, qty: b })} />
              {head?.gdo_id && <div className="text-[10px] text-slate-500 mt-0.5">Phần vượt số tem này đã xuất trên chuyến được ghi là <b>hàng thừa</b> (vẫn nhận vào tem con).</div>}
            </div>
            <div>
              <Label className="text-xs">NSX</Label>
              <Input type="date" value={loose.nsx} onChange={e => setLoose({ ...loose, nsx: e.target.value })} className="h-8 mt-0.5 text-xs w-44" />
              <div className="text-[10px] text-slate-500 mt-0.5">Để trống = theo tem gốc. Gõ NSX khi hàng thực tế khác lô tem gốc (HSD tính lại theo NSX).</div>
            </div>
            <div className="text-slate-500">Vị trí: <span className="font-mono font-semibold text-slate-700">{order.location?.location_code ?? '—'}</span>{(head?.qa_hold ?? r?.qa_hold) ? ' · gắn QA giữ (X)' : ''}</div>
            {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700 whitespace-pre-wrap">{err}</div>}
          </div>
        )}
      </FormSheet>
    </div>
  )
}
