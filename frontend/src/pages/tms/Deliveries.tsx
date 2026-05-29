import { useState } from 'react'
import { Navigation, MapPin, Package, User } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDeliveries } from '@/api/hooks'
import { formatDateTime, formatWeight, deliveryStatusLabel } from '@/utils/formatters'
import type { DeliveryStatus } from '@/types'

export default function Deliveries() {
  const { data: deliveries, isLoading } = useDeliveries()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | 'ALL'>('ALL')

  const filtered = deliveries?.filter((d) => {
    const matchSearch =
      d.orderNo.toLowerCase().includes(search.toLowerCase()) ||
      d.customer.toLowerCase().includes(search.toLowerCase()) ||
      d.destination.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'ALL' || d.status === statusFilter
    return matchSearch && matchStatus
  }) ?? []

  const counts = {
    pending:   deliveries?.filter((d) => d.status === 'PENDING').length ?? 0,
    assigned:  deliveries?.filter((d) => d.status === 'ASSIGNED').length ?? 0,
    inTransit: deliveries?.filter((d) => d.status === 'IN_TRANSIT').length ?? 0,
    delivered: deliveries?.filter((d) => d.status === 'DELIVERED').length ?? 0,
    failed:    deliveries?.filter((d) => d.status === 'FAILED').length ?? 0,
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-white px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0">Giao hàng</span>
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm mã đơn, khách hàng..." className="flex-1 max-w-sm" />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DeliveryStatus | 'ALL')}>
            <SelectTrigger className="h-7 text-xs w-36">
              <SelectValue placeholder="Trạng thái" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả</SelectItem>
              {(['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED'] as DeliveryStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{deliveryStatusLabel[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3 mt-1.5">
          {Object.entries(counts).map(([key, count]) => {
            const labels: Record<string, { label: string; cls: string }> = {
              pending:   { label: 'Chờ giao',     cls: 'bg-amber-100 text-amber-700'   },
              assigned:  { label: 'Đã phân công', cls: 'bg-blue-100 text-blue-700'     },
              inTransit: { label: 'Đang giao',    cls: 'bg-purple-100 text-purple-700' },
              delivered: { label: 'Hoàn thành',   cls: 'bg-green-100 text-green-700'   },
              failed:    { label: 'Thất bại',     cls: 'bg-red-100 text-red-600'       },
            }
            return (
              <span key={key} className={`text-[10px] px-1.5 py-0.5 rounded-full ${labels[key]?.cls}`}>
                {labels[key]?.label}: {count}
              </span>
            )
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={5} cols={6} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Navigation} title="Không có lệnh giao hàng" />
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Mã lệnh</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Khách hàng / Điểm đến</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Xe / Tài xế</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right whitespace-nowrap">Hàng hoá</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Lịch giao</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">Trạng thái</TableHead>
                <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right whitespace-nowrap">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((order) => (
                <TableRow key={order.id} className="cursor-pointer hover:bg-slate-50">
                  <TableCell className="px-2 py-1 font-mono font-semibold text-[10px]">{order.orderNo}</TableCell>
                  <TableCell className="px-2 py-1">
                    <p className="text-[10px] font-medium truncate max-w-[160px]">{order.customer}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1 truncate max-w-[160px]">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />{order.destination}
                    </p>
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <p className="text-[10px] font-medium">{order.vehicle?.plateNumber ?? '—'}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1">
                      <User className="h-2.5 w-2.5" />{order.driver?.name ?? 'Chưa phân công'}
                    </p>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-right">
                    <p className="text-[10px] font-medium tabular-nums">{formatWeight(order.weight)}</p>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1 justify-end">
                      <Package className="h-2.5 w-2.5" />{order.items} kiện
                    </p>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] text-slate-500">{formatDateTime(order.scheduledAt)}</TableCell>
                  <TableCell className="px-2 py-1"><DeliveryStatusBadge status={order.status} /></TableCell>
                  <TableCell className="px-2 py-1 text-right">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2">Chi tiết</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </div>
    </div>
  )
}
