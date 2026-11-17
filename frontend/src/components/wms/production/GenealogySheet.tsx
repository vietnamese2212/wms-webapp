// TRUY XUẤT SẢN XUẤT (MES 14/11) — mở từ trang Truy xuất lô. Gia phả lô: tem nguyên liệu ⇄ MẺ chế biến ⇄ bồn ⇄ trang Sổ đóng gói ⇄ tem thành phẩm.
// Đi tiếp từ một tem thành phẩm tới NPP / xe = truy xuất lô sẵn có (bấm tem ⇒ điền vào bộ lọc Xuôi của trang Truy xuất lô).
// Bồn chứa nhiều mẻ ⇒ một tem thành phẩm nối nhiều mẻ (đúng thực tế trộn) — thu hồi sẽ rộng hơn, màn hình nói rõ.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { FormSheet } from '@/components/shared/FormSheet'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { QRScanDialog } from '@/components/shared/QRScanDialog'
import { ScanIcon } from '@/components/shared/ScanIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCanSeePath } from '@/hooks/useCanSeePath'
import { useGenealogy, BATCH_QA_VI, type GenealogyBatch } from '@/api/productionHooks'
import { normalizeQR } from '@/utils/qr'
import { unitCode } from '@/utils/unitCode'
import { formatDate } from '@/utils/formatters'

type Kind = 'FG_PALLET' | 'RM_PALLET' | 'BATCH'
const KIND_LABEL: Record<Kind, string> = { FG_PALLET: 'Tem thành phẩm', RM_PALLET: 'Tem nguyên liệu', BATCH: 'Mã lô bán thành phẩm' }
const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
const nf = (n: number) => Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
const TH = 'px-2 py-1 text-left whitespace-nowrap'
const TD = 'px-2 py-1 whitespace-nowrap text-[10px]'

export function GenealogySheet({ open, onClose, onTraceFg }: { open: boolean; onClose: () => void; onTraceFg?: (palletCode: string) => void }) {
  const [kind, setKind] = useState<Kind>('FG_PALLET')
  const [text, setText] = useState('')
  const [value, setValue] = useState('')
  const [camOpen, setCamOpen] = useState(false)
  const q = useGenealogy(kind, value)
  const batches = q.data?.batches ?? []
  const go = (raw: string) => setValue(normalizeQR(raw))
  return (
    <FormSheet open={open} onClose={onClose} widthClass="sm:max-w-4xl" title="Truy xuất sản xuất"
      description="Tem nguyên liệu ⇄ mẻ chế biến ⇄ bồn ⇄ trang Sổ đóng gói ⇄ tem thành phẩm. Bấm một tem thành phẩm để truy tiếp tới khách / xe."
      footer={<Button variant="outline" size="sm" className="h-8" onClick={onClose}>Đóng</Button>}>
      <div className="space-y-3 text-xs">
        <div className="flex rounded-lg border overflow-hidden">
          {(Object.keys(KIND_LABEL) as Kind[]).map(k => (
            <button key={k} type="button" onClick={() => { setKind(k); setValue('') }}
              className={['flex-1 py-1.5 text-xs font-medium transition-colors', kind === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'].join(' ')}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(text) } }}
            placeholder={`${KIND_LABEL[kind]} — gõ / dán rồi Enter`} className="h-9 sm:h-8 text-xs font-mono flex-1 min-w-0" />
          <Button type="button" variant="outline" size="sm" className="h-9 sm:h-8 shrink-0" onClick={() => setCamOpen(true)} title="Quét tem bằng camera"><ScanIcon className="h-4 w-4" /></Button>
          <Button type="button" size="sm" className="h-9 sm:h-8 shrink-0" disabled={!text.trim()} onClick={() => go(text)}>Tra</Button>
        </div>
        {q.isError && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-red-700">{apiMsg(q.error)}</div>}
        {value && q.isLoading && <p className="text-slate-500">Đang tra…</p>}
        {value && !q.isLoading && !q.isError && !batches.length && <p className="text-slate-500">Không tìm thấy mẻ chế biến nào gắn với "{value}" (trong phạm vi kho được giao).</p>}
        {batches.length > 1 && kind === 'FG_PALLET' && (
          <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800">
            Tem này đi ra từ bồn chứa <b>{batches.length} mẻ</b> — khi thu hồi phải xét cả {batches.length} mẻ và mọi tem thành phẩm cùng rút từ chúng.
          </p>
        )}
        {batches.map(b => <BatchCard key={b.id} b={b} highlight={kind === 'RM_PALLET' ? value : undefined} onTraceFg={onTraceFg} />)}
      </div>
      <QRScanDialog open={camOpen} onClose={() => setCamOpen(false)} title={`Quét ${KIND_LABEL[kind].toLowerCase()}`}
        onScan={t => { setCamOpen(false); setText(t); go(t) }} />
    </FormSheet>
  )
}

function BatchCard({ b, highlight, onTraceFg }: { b: GenealogyBatch; highlight?: string; onTraceFg?: (code: string) => void }) {
  const navigate = useNavigate()
  const canSeePath = useCanSeePath()
  const u = unitCode(b.base_unit)
  const fgCount = b.runs.reduce((s, r) => s + r.pallets.length, 0)
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-1.5 flex-wrap px-2 py-1.5 bg-slate-50 border-b border-slate-200 rounded-t-lg">
        {canSeePath('/wms/production')
          ? <button type="button" className="font-mono font-semibold text-blue-700 hover:underline" onClick={() => navigate(`/wms/production/${b.id}`)}>{b.batch_code}</button>
          : <span className="font-mono font-semibold">{b.batch_code}</span>}
        <span><span className="font-mono">{b.material_code}</span> {b.material_name ?? ''}</span>
        <span className="text-slate-500">· SX {formatDate(b.prod_date)}{b.machine_code ? ` · máy ${b.machine_code}` : ''} · {b.warehouse_name}</span>
        <StatusBadge tone={b.qa_status === 'RELEASED' ? 'green' : b.qa_status === 'REJECTED' ? 'red' : 'amber'}>{BATCH_QA_VI[b.qa_status]}</StatusBadge>
      </div>
      <div className="p-2 space-y-2">
        <div>
          <p className="font-semibold text-slate-600 mb-0.5">Nguyên liệu vào mẻ ({b.materials.length} dòng)</p>
          <div className="overflow-auto border rounded">
            <table className="w-full">
              <thead><tr className="bg-slate-50 text-[9px] text-slate-500">
                <th className={TH}>Tem</th><th className={TH}>Mã</th><th className={TH}>NSX</th><th className={TH}>Mã lô</th><th className={TH}>NCC</th><th className={`${TH} text-right`}>Lượng</th><th className={TH}>Cách ghi</th>
              </tr></thead>
              <tbody>
                {!b.materials.length && <tr><td colSpan={7} className={`${TD} text-slate-400`}>Mẻ chưa ghi nguyên liệu nào</td></tr>}
                {b.materials.map((m, i) => (
                  <tr key={i} className={`border-t border-slate-100 ${highlight && m.pallet_code === highlight ? 'bg-amber-50' : ''}`}>
                    <td className={`${TD} font-mono`}>{m.pallet_code}</td>
                    <td className={TD} title={m.material_name ?? ''}><span className="font-mono font-semibold">{m.material_code}</span> {m.material_name ?? ''}</td>
                    <td className={`${TD} tabular-nums`}>{m.production_date ? formatDate(m.production_date) : '—'}</td>
                    <td className={`${TD} font-mono`}>{m.batch_lot ?? '—'}</td>
                    <td className={TD}>{m.ncc_name ?? '—'}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{nf(m.qty)} <span className="text-slate-400 font-normal">{unitCode(m.base_unit)}</span></td>
                    <td className={TD}>{m.source === 'SCAN' ? 'Quét tem' : 'Theo lô (gộp)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p className="font-semibold text-slate-600 mb-0.5">Đã đóng gói ({b.runs.length} trang sổ · {fgCount} tem thành phẩm)</p>
          {!b.runs.length && <p className="text-slate-400">Chưa trang Sổ đóng gói nào khai rút bán thành phẩm của mẻ này.</p>}
          {b.runs.map(r => (
            <div key={r.run_id} className="border-t border-slate-100 py-1">
              <div className="text-slate-600">
                Trang sổ {formatDate(r.run_date)} · máy {r.machine_code} · {r.material_codes.join(', ')}
                {r.tank_code ? ` · bồn ${r.tank_code}` : ''} · rút <b className="tabular-nums">{nf(r.qty)}</b> {u} của mẻ
              </div>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {r.pallets.map(p => onTraceFg
                  ? <button key={p} type="button" onClick={() => onTraceFg(p)} title="Truy tiếp tem này tới khách / xe"
                      className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] text-sky-800 hover:bg-sky-100">{p}</button>
                  : <span key={p} className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px]">{p}</span>)}
                {!r.pallets.length && <span className="text-slate-400">trang chưa có tem nào</span>}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400">Ghi chú: dòng "Theo lô (gộp)" là nguyên liệu rút không quét tem — kho gộp theo NSX nên truy xuất tới mức lô NSX, không tới từng pallet nhà cung cấp.</p>
      </div>
    </div>
  )
}
