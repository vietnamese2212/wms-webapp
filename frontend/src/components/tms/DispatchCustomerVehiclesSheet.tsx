// "Dòng xe được vào" của khách — NGOẠI LỆ CHỈ MỘT XE (15/10, user: "icon xe tải chỉ để thay đổi cho chuyến đó hay thay đổi luôn setting —
// tôi muốn chỉ thay đổi cho chuyến đó thôi", chọn "Ngoại lệ chỉ xe đó"). Bản 27/09 ghi CẤU HÌNH GỐC của khách từ bàn — nay cấu hình gốc chỉ
// sửa ở trang Khách hàng; ở đây chỉ sửa BẢN CHỤP trên các đơn của khách trên ĐÚNG xe của dòng được bấm (đơn ở khung chờ: chỉ đơn đó).
// Luật "dòng xe khách được vào" (kéo thả · đổi dòng xe · Xác nhận) đọc bản chụp nên xe đó qua luật; "Tối ưu lại" dựng lại xe (không khoá)
// thì về theo cấu hình khách.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { useDispatchRowVehicles, useSetDispatchRowVehicles, type DispatchRowVehicles } from '@/api/hooks'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được'

export function DispatchCustomerVehiclesSheet({ planId, rowId, canEdit, onClose }: { planId: string; rowId: string | null; canEdit: boolean; onClose: () => void }) {
  const { data, isLoading, error } = useDispatchRowVehicles(planId, rowId)
  const save = useSetDispatchRowVehicles()
  const [sel, setSel] = useState<Set<string>>(new Set())
  useEffect(() => { setSel(new Set(data?.current ?? data?.config ?? [])) }, [data])
  // nhóm theo loại xe cha, giữ thứ tự danh mục
  const groups = useMemo(() => {
    const m = new Map<string, DispatchRowVehicles['models']>()
    for (const x of data?.models ?? []) { const k = x.parent_type_name ?? 'Khác'; m.set(k, [...(m.get(k) ?? []), x]) }
    return [...m.entries()]
  }, [data])
  const known = new Set((data?.models ?? []).map(m => m.id))
  const nameOf = (id: string) => data?.models.find(m => m.id === id)?.name ?? id
  const cfg = (data?.config ?? []).filter(id => known.has(id)), cfgOther = (data?.config ?? []).length - cfg.length
  const cur = new Set(data?.current ?? [])
  const dirty = !!data && (sel.size !== cur.size || [...sel].some(id => !cur.has(id)))
  const ed = canEdit && !!data?.editable
  const where = data?.trip ? `xe #${data.trip.seq}` : 'đơn này'
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const doSave = (list: string[] | null) => {
    if (!rowId) return
    save.mutateAsync({ plan_id: planId, row_id: rowId, allowed_models: list })
      .then(r => { toast({ title: list ? `Đã áp ngoại lệ cho ${where}` : `Đã về theo cấu hình khách cho ${where}`, description: `${r.row_vehicles.ods.length} đơn của khách — cấu hình khách giữ nguyên.` }); onClose() })
      .catch(e => toast({ variant: 'destructive', title: 'Không lưu được', description: apiMsg(e) }))
  }

  return (
    <FormSheet open={!!rowId} onClose={onClose} widthClass="sm:max-w-md"
      title={data ? `Dòng xe được vào — ${data.ship_to_name ?? data.ship_to_code ?? data.od_number}` : 'Dòng xe được vào'}
      description={data ? `Ngoại lệ chỉ cho ${where} · ${data.ods.length} đơn: ${data.ods.join(', ')}` : undefined}
      footer={<>
        <Button variant="outline" className="h-9 sm:h-8" onClick={onClose} disabled={save.isPending}>{ed ? 'Huỷ' : 'Đóng'}</Button>
        {ed && data?.exception && <Button variant="outline" className="h-9 sm:h-8" onClick={() => doSave(null)} disabled={save.isPending}>Về theo cấu hình khách</Button>}
        {ed && <Button className="h-9 sm:h-8" onClick={() => doSave([...sel])} disabled={!dirty || !sel.size || save.isPending}>{save.isPending ? 'Đang lưu…' : `Lưu cho ${where}`}</Button>}
      </>}>
      {isLoading && <p className="text-sm text-slate-500">Đang tải…</p>}
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{apiMsg(error)}</div>}
      {data && (
        <div className="space-y-3 text-xs">
          <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 leading-snug">
            <span className="text-slate-500">Theo cấu hình khách{data.channel_label ? ` (kênh ${data.channel_label})` : ''}: </span>
            <span className="font-medium text-slate-800">{cfg.length ? cfg.map(nameOf).join(', ') : 'chưa khai — máy không chọn xe cho khách này'}</span>
            {cfgOther > 0 && <span className="text-slate-400"> · +{cfgOther} dòng xe không dùng ở kho này</span>}
            {data.exception && <div className="mt-1"><span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">Đang áp ngoại lệ cho {where}</span></div>}
          </div>
          <div className="space-y-2">
            {groups.map(([g, ms]) => (
              <div key={g}>
                <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{g}</div>
                {ms.map(m => (
                  <label key={m.id} className={`flex min-h-[36px] items-center gap-2 rounded px-2 py-1 ${ed ? 'cursor-pointer hover:bg-slate-50' : 'opacity-80'}`}>
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-sky-600" checked={sel.has(m.id)} disabled={!ed} onChange={() => toggle(m.id)} />
                    <span className="min-w-0 flex-1 truncate text-slate-800" title={`${m.sap_code} — ${m.name}`}>{m.name}</span>
                    {data.trip?.vehicle_model_id === m.id && <span className="shrink-0 rounded bg-sky-100 px-1 text-[10px] font-medium text-sky-800">xe đang chạy</span>}
                    {data.config.includes(m.id) && <span className="shrink-0 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-500">theo cấu hình</span>}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-slate-500">
            Chỉ đổi {data.ods.length} đơn của khách trên {where} — xe khác, ngày khác vẫn theo cấu hình khách. Muốn đổi hẳn (mọi kế hoạch sau) thì
            sửa ở <b>Cấu hình → Khách hàng → Dòng xe được vào</b>. "Tối ưu lại" dựng lại xe (xe không khoá) thì về theo cấu hình khách.
          </p>
          {!canEdit && <p className="text-[11px] text-amber-700">Bạn chỉ xem được — cần quyền "Điều vận → Ngoại lệ dòng xe được vào của khách".</p>}
          {canEdit && !data.editable && <p className="text-[11px] text-amber-700">Xe đã gửi ĐVVT / đã chốt, hoặc kế hoạch đã xác nhận — không sửa được.</p>}
        </div>
      )}
    </FormSheet>
  )
}
