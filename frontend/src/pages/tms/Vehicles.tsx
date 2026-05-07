import { useState } from 'react'
import { Truck, Plus, Search, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { VehicleStatusBadge } from '@/components/shared/StatusBadge'
import { CardsSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useVehicles } from '@/api/hooks'
import { formatDate } from '@/utils/formatters'
import { differenceInDays, parseISO } from 'date-fns'

const vehicleTypeLabel: Record<string, string> = {
  TRUCK: 'Xe tải',
  VAN: 'Xe van',
  MOTORCYCLE: 'Xe máy',
  CONTAINER: 'Container',
}

export default function Vehicles() {
  const { data: vehicles, isLoading } = useVehicles()
  const [search, setSearch] = useState('')

  const filtered = vehicles?.filter((v) =>
    v.plateNumber.toLowerCase().includes(search.toLowerCase()) ||
    v.brand.toLowerCase().includes(search.toLowerCase()) ||
    v.driver?.name.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  const counts = {
    total: vehicles?.length ?? 0,
    available: vehicles?.filter((v) => v.status === 'AVAILABLE').length ?? 0,
    inUse: vehicles?.filter((v) => v.status === 'IN_USE').length ?? 0,
    maintenance: vehicles?.filter((v) => v.status === 'MAINTENANCE').length ?? 0,
    expired: vehicles?.filter((v) => v.status === 'EXPIRED').length ?? 0,
  }

  return (
    <div>
      <PageHeader
        title="Xe & Tài xế"
        description="Quản lý phương tiện vận chuyển và tài xế"
        actions={
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Thêm xe
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-6 pb-0">
        {[
          { label: 'Tổng xe', value: counts.total },
          { label: 'Khả dụng', value: counts.available, color: 'text-green-600' },
          { label: 'Đang sử dụng', value: counts.inUse, color: 'text-blue-600' },
          { label: 'Bảo dưỡng/Hết hạn', value: counts.maintenance + counts.expired, color: 'text-amber-600' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color ?? ''}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="p-6 space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Tìm biển số, hãng xe, tài xế..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <CardsSkeleton count={5} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Truck} title="Không tìm thấy xe" description="Thêm xe mới vào hệ thống." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((vehicle) => {
              const daysToInspection = differenceInDays(parseISO(vehicle.nextInspectionDate), new Date())
              const inspectionWarning = daysToInspection <= 7

              return (
                <Card key={vehicle.id} className="overflow-hidden">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                          <Truck className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-bold text-base font-mono">{vehicle.plateNumber}</p>
                          <p className="text-xs text-muted-foreground">{vehicle.brand} {vehicle.model} {vehicle.year}</p>
                        </div>
                      </div>
                      <VehicleStatusBadge status={vehicle.status} />
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Loại xe</span>
                        <span className="font-medium">{vehicleTypeLabel[vehicle.type]}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tải trọng</span>
                        <span className="font-medium">{(vehicle.capacity / 1000).toFixed(1)} tấn</span>
                      </div>
                      {vehicle.driver && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Tài xế</span>
                          <span className="font-medium">{vehicle.driver.name}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Đăng kiểm</span>
                        <div className="flex items-center gap-1">
                          {inspectionWarning && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                          <span className={`font-medium text-xs ${inspectionWarning ? 'text-amber-600' : ''}`}>
                            {formatDate(vehicle.nextInspectionDate)}
                            {daysToInspection >= 0 ? ` (${daysToInspection}ngày)` : ' (ĐÃ HẾT HẠN)'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1">Chi tiết</Button>
                      <Button size="sm" className="flex-1" disabled={vehicle.status !== 'AVAILABLE'}>
                        Giao việc
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
