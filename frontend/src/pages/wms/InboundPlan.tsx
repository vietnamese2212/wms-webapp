import { useState } from 'react'
import { format } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useAuthStore } from '@/stores/authStore'
import { useWarehouses, useTmsOrders, useInboundOrders } from '@/api/hooks'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// ─── Kế hoạch nhập ngoài (WMS view — planned vs actual) ──────────────────────
// Hiển thị TmsOrder INBOUND + số thùng thực nhận từ ProductionImport NCC

export default function InboundPlan() {
  const user = useAuthStore(s => s.user)

  const [date,        setDate]        = useState(TODAY)
  const [warehouseId, setWarehouseId] = useState(user?.warehouse_id ?? user?.warehouse_ids?.[0] ?? '')

  const { data: warehouses = [] } = useWarehouses(true)

  // TmsOrders direction=INBOUND (kế hoạch SAP)
  const { data: tmsOrders = [], isLoading: loadingOrders } = useTmsOrders(
    date && warehouseId ? { date, warehouse_id: warehouseId } : undefined
  )
  const inboundOrders = (tmsOrders as any[]).filter(o => o.direction === 'INBOUND')

  // ProductionImport NCC của ngày này — để tính actual
  const { data: imports = [] } = useInboundOrders(
    date && warehouseId ? { warehouse_id: warehouseId, date, status: 'ALL' } : undefined
  )
  const nccImports = (imports as any[]).filter(i => i.source_type === 'NCC')

  // Group NCC imports by tms_order_id
  const actualByTmsOrder = new Map<string, number>()
  for (const imp of nccImports) {
    const key = imp.tms_order_id ?? '__unplanned__'
    actualByTmsOrder.set(key, (actualByTmsOrder.get(key) ?? 0) + (imp.total_cartons ?? 0))
  }

  const totalPlanned = inboundOrders.reduce((s, o) => s + (o.planned_boxes ?? 0), 0)
  const totalActual  = [...actualByTmsOrder.values()].reduce((s, v) => s + v, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-base font-semibold text-slate-800">Kế hoạch nhập ngoài</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {format(new Date(date + 'T00:00:00'), 'EEEE, dd-MM-yyyy', { locale: vi })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="h-8 text-sm w-36"
            />
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="h-8 text-sm w-32">
                <SelectValue placeholder="Chọn kho" />
              </SelectTrigger>
              <SelectContent>
                {(warehouses as { id: string; name: string; code: string }[]).map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.code} – {w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary bar */}
        <div className="flex gap-4 mt-3 text-xs">
          <span className="text-slate-500">Kế hoạch: <strong className="text-slate-700">{totalPlanned.toLocaleString()} thùng</strong></span>
          <span className="text-slate-500">Thực nhận: <strong className={totalActual >= totalPlanned ? 'text-green-600' : 'text-amber-600'}>{totalActual.toLocaleString()} thùng</strong></span>
          <span className="text-slate-500">
            Còn: <strong className={totalPlanned - totalActual > 0 ? 'text-red-500' : 'text-slate-400'}>
              {Math.max(0, totalPlanned - totalActual).toLocaleString()} thùng
            </strong>
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        <table className="min-w-full text-[10px]">
          <thead className="sticky top-0 z-10 bg-slate-50 border-b">
            <tr>
              {['ĐVVT', 'Loại xe', 'Loại kho', 'Số PO', 'Mã hàng', 'KH thùng', 'KH pallet', 'Thực nhận', 'Còn lại', 'Trạng thái', 'Xe'].map(h => (
                <th key={h} className="px-2 py-1.5 text-left text-[9px] font-medium text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loadingOrders && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Đang tải...</td></tr>
            )}
            {!loadingOrders && inboundOrders.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Không có kế hoạch nhập ngoài cho ngày này</td></tr>
            )}
            {inboundOrders.map((order: any) => {
              const actual  = actualByTmsOrder.get(order.id) ?? 0
              const planned = order.planned_boxes ?? 0
              const remaining = Math.max(0, planned - actual)
              const isDone    = actual >= planned && planned > 0
              const isPartial = actual > 0 && !isDone
              const rowCls    = isDone
                ? 'bg-green-50 hover:bg-green-100'
                : isPartial
                ? 'bg-amber-50 hover:bg-amber-100'
                : 'hover:bg-slate-50'

              const slots = (order.vehicle_slots ?? []) as any[]
              const plates = slots.filter((s: any) => s.license_plate).map((s: any) => s.license_plate).join(', ')

              return (
                <tr key={order.id} className={rowCls}>
                  <td className="px-2 py-1">{order.ncc?.name ?? order.ncc?.code ?? '—'}</td>
                  <td className="px-2 py-1 text-slate-500">{order.vehicle_type ?? '—'}</td>
                  <td className="px-2 py-1 text-slate-500">{order.warehouse_type ?? '—'}</td>
                  <td className="px-2 py-1 font-mono text-blue-600">{(order as any).po_number ?? '—'}</td>
                  <td className="px-2 py-1">
                    {(order as any).material?.material_code
                      ? <><span className="font-mono">{(order as any).material.material_code}</span><span className="text-slate-400 ml-1">{(order as any).material.short_name}</span></>
                      : <span className="text-slate-400">—</span>
                    }
                  </td>
                  <td className="px-2 py-1 tabular-nums font-semibold text-right">{planned > 0 ? planned.toLocaleString() : '—'}</td>
                  <td className="px-2 py-1 tabular-nums text-right text-slate-500">{order.planned_pallets ?? '—'}</td>
                  <td className="px-2 py-1 tabular-nums font-semibold text-right text-green-700">{actual > 0 ? actual.toLocaleString() : '—'}</td>
                  <td className="px-2 py-1 tabular-nums text-right text-red-500">{remaining > 0 ? remaining.toLocaleString() : '—'}</td>
                  <td className="px-2 py-1">
                    {isDone
                      ? <span className="text-green-600 font-medium">Đủ</span>
                      : isPartial
                      ? <span className="text-amber-600">Đang nhận</span>
                      : <span className="text-slate-400">Chưa nhận</span>
                    }
                  </td>
                  <td className="px-2 py-1 font-mono text-slate-600">{plates || '—'}</td>
                </tr>
              )
            })}

            {/* Phát sinh — NCC imports không link TmsOrder */}
            {(actualByTmsOrder.get('__unplanned__') ?? 0) > 0 && (
              <tr className="bg-amber-50 hover:bg-amber-100">
                <td colSpan={3} className="px-2 py-1 text-amber-700 font-medium italic">Phát sinh (không có kế hoạch)</td>
                <td className="px-2 py-1">—</td>
                <td className="px-2 py-1">—</td>
                <td className="px-2 py-1">—</td>
                <td className="px-2 py-1">—</td>
                <td className="px-2 py-1 tabular-nums font-semibold text-right text-green-700">
                  {(actualByTmsOrder.get('__unplanned__') ?? 0).toLocaleString()}
                </td>
                <td className="px-2 py-1">—</td>
                <td className="px-2 py-1"><span className="text-amber-600">Phát sinh</span></td>
                <td className="px-2 py-1">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
