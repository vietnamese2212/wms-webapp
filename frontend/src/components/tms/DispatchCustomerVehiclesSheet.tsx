// "Dòng xe được vào" của MỘT khách — mở ngay từ bàn ghép xe (user 27/09: "trong bàn làm việc cần mở lên được phần config này").
// Ranh giới user chốt: điều vận sửa DÒNG XE của khách ở đây; đổi KÊNH của khách vẫn chỉ ở trang Khách hàng vì kênh còn quyết
// %Date bên kho — đổi kênh từ bàn điều vận là kho soạn sai date mà không ai biết vì sao. Lưu xong server chụp lại danh sách cho
// OD của khách trên kế hoạch đang mở + tính lại xe chở chúng, nên cảnh báo trên thẻ xe đổi ngay.
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import { FormSheet } from '@/components/shared/FormSheet'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { useDispatchCustomerVehicles, useSetDispatchCustomerVehicles, useVehicleModels, useWarehouseTypes } from '@/api/hooks'
import { DispatchVehiclesEditor } from './DispatchVehiclesEditor'

const apiMsg = (e: unknown) => (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'Không lưu được'

export function DispatchCustomerVehiclesSheet({ planId, shipTo, canEdit, onClose }: { planId: string; shipTo: string | null; canEdit: boolean; onClose: () => void }) {
  const { data, isLoading, error } = useDispatchCustomerVehicles(planId, shipTo)
  const { data: vmData } = useVehicleModels({ is_active: true })
  const { data: types } = useWarehouseTypes()
  const save = useSetDispatchCustomerVehicles()
  const models = useMemo(() => vmData?.items ?? [], [vmData])
  const cats = useMemo(() => (types ?? []).map(t => ({ value: t.value, label: t.value })), [types])
  const [value, setValue] = useState<Record<string, string[]>>({})
  useEffect(() => { setValue(data?.dispatch_vehicles ?? {}) }, [data])
  const dirty = JSON.stringify(value) !== JSON.stringify(data?.dispatch_vehicles ?? {})

  const doSave = () => {
    if (!shipTo) return
    save.mutateAsync({ plan_id: planId, ship_to_code: shipTo, dispatch_vehicles: value })
      .then(r => { toast({ title: 'Đã lưu dòng xe được vào', description: `${r.customer_vehicles.ods_updated} dòng OD của khách trên kế hoạch này nhận danh sách mới · ${r.customer_vehicles.trips_repriced} xe tính lại.` }); onClose() })
      .catch(e => toast({ variant: 'destructive', title: 'Không lưu được', description: apiMsg(e) }))
  }

  return (
    <FormSheet open={!!shipTo} onClose={onClose} widthClass="sm:max-w-xl"
      title={data ? `Dòng xe được vào — ${data.name}` : 'Dòng xe được vào'}
      description={data ? `Ship-to ${data.ship_to_code} · kênh ${data.channel_label ?? 'chưa phân kênh'}` : undefined}
      footer={<>
        <Button variant="outline" className="h-9 sm:h-8" onClick={onClose} disabled={save.isPending}>{canEdit ? 'Huỷ' : 'Đóng'}</Button>
        {canEdit && <Button className="h-9 sm:h-8" onClick={doSave} disabled={!dirty || save.isPending || !data}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>}
      </>}>
      {isLoading && <p className="text-sm text-slate-500">Đang tải…</p>}
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{apiMsg(error)}</div>}
      {data && (
        <div className="space-y-3">
          <DispatchVehiclesEditor value={value} onChange={v => { if (canEdit) setValue(v) }} cats={cats} models={models}
            inherit={{ label: data.channel_label ?? '', map: data.channel_vehicles ?? {} }} />
          <p className="text-[11px] text-slate-500">
            Chỉ sửa dòng xe RIÊNG của khách này. Muốn đổi <b>kênh</b> của khách (kênh còn quyết %Date bên kho) thì sửa ở Cấu hình → Khách hàng.
            Lưu xong, các OD của khách trên kế hoạch đang mở nhận danh sách mới ngay; kế hoạch ngày khác nhận khi lập / tối ưu lại.
          </p>
          {!canEdit && <p className="text-[11px] text-amber-700">Bạn chỉ xem được — cần quyền "Điều vận → Sửa dòng xe được vào của khách" hoặc "Khách hàng → Sửa".</p>}
        </div>
      )}
    </FormSheet>
  )
}
