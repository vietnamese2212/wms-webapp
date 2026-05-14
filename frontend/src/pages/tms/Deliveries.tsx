import { useState } from 'react'
import { Plus, Navigation, MapPin, Package, User } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { PageHeader } from '@/components/shared/PageHeader'
import { DeliveryStatusBadge } from '@/components/shared/StatusBadge'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
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
    pending: deliveries?.filter((d) => d.status === 'PENDING').length ?? 0,
    assigned: deliveries?.filter((d) => d.status === 'ASSIGNED').length ?? 0,
    inTransit: deliveries?.filter((d) => d.status === 'IN_TRANSIT').length ?? 0,
    delivered: deliveries?.filter((d) => d.status === 'DELIVERED').length ?? 0,
    failed: deliveries?.filter((d) => d.status === 'FAILED').length ?? 0,
  }

  return (
    <div>
      <PageHeader
        title="Giao hàng"
        description="Theo dõi lệnh vận chuyển và trạng thái giao hàng"
        actions={
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Tạo lệnh giao hàng
          </Button>
        }
      />

      <div className="flex gap-2 p-6 pb-0 overflow-x-auto no-scrollbar">
        {Object.entries(counts).map(([key, count]) => {
          const labels: Record<string, { label: string; color: string }> = {
            pending: { label: 'Chờ giao', color: 'text-amber-600' },
            assigned: { label: 'Đã phân công', color: 'text-blue-600' },
            inTransit: { label: 'Đang giao', color: 'text-purple-600' },
            delivered: { label: 'Hoàn thành', color: 'text-green-600' },
            failed: { label: 'Thất bại', color: 'text-red-600' },
          }
          return (
            <Card key={key} className="min-w-[120px] shrink-0">
              <CardContent className="p-3 text-center">
                <p className={`text-2xl font-bold ${labels[key]?.color}`}>{count}</p>
                <p className="text-xs text-muted-foreground">{labels[key]?.label}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm mã đơn, khách hàng..." className="flex-1 max-w-sm" />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as DeliveryStatus | 'ALL')}>
            <SelectTrigger className="w-full sm:w-44">
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

        <Card>
          {isLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={Navigation} title="Không có lệnh giao hàng" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã lệnh</TableHead>
                  <TableHead>Khách hàng / Điểm đến</TableHead>
                  <TableHead className="hidden sm:table-cell">Xe / Tài xế</TableHead>
                  <TableHead className="hidden md:table-cell text-right">Hàng hoá</TableHead>
                  <TableHead className="hidden lg:table-cell">Lịch giao</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((order) => (
                  <TableRow key={order.id} className="cursor-pointer">
                    <TableCell>
                      <span className="font-mono text-xs font-semibold">{order.orderNo}</span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium truncate max-w-[200px]">{order.customer}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[200px]">
                          <MapPin className="h-3 w-3 shrink-0" />{order.destination}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="text-sm">
                        <p className="font-medium">{order.vehicle?.plateNumber ?? '—'}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="h-3 w-3" />{order.driver?.name ?? 'Chưa phân công'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right">
                      <div className="text-sm">
                        <p className="font-medium">{formatWeight(order.weight)}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                          <Package className="h-3 w-3" />{order.items} kiện
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDateTime(order.scheduledAt)}
                    </TableCell>
                    <TableCell><DeliveryStatusBadge status={order.status} /></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">Chi tiết</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  )
}
