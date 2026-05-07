import { Link } from 'react-router-dom'
import {
  Package, PackagePlus, PackageMinus, Navigation, AlertTriangle,
  CheckCircle2, TrendingUp, Warehouse, Clock, ArrowRight, Activity,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatsCard } from '@/components/shared/StatsCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { TransactionStatusBadge, TransactionTypeBadge } from '@/components/shared/StatusBadge'
import { useTransactions } from '@/api/hooks'
import { dashboardKPIs } from '@/utils/mockData'
import { formatTimeAgo, formatDateTime } from '@/utils/formatters'

function AlertCard({ message, type }: { message: string; type: 'warning' | 'danger' | 'info' }) {
  const colors = {
    warning: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300',
    danger: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300',
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300',
  }
  return (
    <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${colors[type]}`}>
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export default function Dashboard() {
  const { data: transactions, isLoading } = useTransactions(6)
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="space-y-0">
      <PageHeader
        title="Tổng quan hệ thống"
        description={today}
        actions={
          <div className="flex items-center gap-1.5">
            <div className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">Dữ liệu thời gian thực</span>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Độ chính xác tồn kho"
            value={dashboardKPIs.inventoryAccuracy}
            unit="%"
            change={0.2}
            changeLabel="so tháng trước"
            trend="up"
            icon={CheckCircle2}
            iconColor="text-green-600"
            progress={dashboardKPIs.inventoryAccuracy}
            progressColor="bg-green-500"
            target="≥ 99.5%"
          />
          <StatsCard
            title="Tỷ lệ hoàn thành đơn"
            value={dashboardKPIs.orderFulfillmentRate}
            unit="%"
            change={-0.3}
            changeLabel="so tháng trước"
            trend="down"
            icon={TrendingUp}
            iconColor="text-blue-600"
            progress={dashboardKPIs.orderFulfillmentRate}
            progressColor="bg-blue-500"
            target="≥ 98%"
          />
          <StatsCard
            title="Giao hàng đúng giờ"
            value={dashboardKPIs.onTimeDelivery}
            unit="%"
            change={1.2}
            changeLabel="so tuần trước"
            trend="up"
            icon={Navigation}
            iconColor="text-purple-600"
            progress={dashboardKPIs.onTimeDelivery}
            progressColor="bg-purple-500"
            target="≥ 95%"
          />
          <StatsCard
            title="Sử dụng kho"
            value={dashboardKPIs.warehouseUtilization}
            unit="%"
            trend="neutral"
            icon={Warehouse}
            iconColor="text-amber-600"
            progress={dashboardKPIs.warehouseUtilization}
            progressColor="bg-amber-500"
            target="< 85%"
          />
        </div>

        {/* Activity + Alerts row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/30">
                  <PackagePlus className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{dashboardKPIs.todayInbound}</p>
                  <p className="text-xs text-muted-foreground">Phiếu nhập hôm nay</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
                  <PackageMinus className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{dashboardKPIs.todayOutbound}</p>
                  <p className="text-xs text-muted-foreground">Phiếu xuất hôm nay</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
                  <Navigation className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{dashboardKPIs.pendingDeliveries}</p>
                  <p className="text-xs text-muted-foreground">Giao hàng chờ</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{dashboardKPIs.lowStockAlerts}</p>
                  <p className="text-xs text-muted-foreground">Cảnh báo tồn kho</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Transactions */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Hoạt động gần đây
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/wms/inventory" className="flex items-center gap-1 text-xs">
                    Xem tất cả <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex gap-3 items-center">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-40" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y">
                    {transactions?.map((txn) => (
                      <div key={txn.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                          {txn.type === 'INBOUND' ? (
                            <PackagePlus className="h-4 w-4 text-green-600" />
                          ) : txn.type === 'OUTBOUND' ? (
                            <PackageMinus className="h-4 w-4 text-blue-600" />
                          ) : (
                            <Package className="h-4 w-4 text-slate-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{txn.product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {txn.referenceNo} · {txn.userName} · {formatTimeAgo(txn.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-medium tabular-nums">
                            {txn.type === 'OUTBOUND' ? '-' : '+'}{txn.pallets} pallet
                          </span>
                          <TransactionStatusBadge status={txn.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Alerts + Quick Actions */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Cảnh báo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <AlertCard message="SKU-005: Hết hàng hoàn toàn" type="danger" />
                <AlertCard message="SKU-007: Hết hàng hoàn toàn" type="danger" />
                <AlertCard message="SKU-002: Tồn kho dưới mức tối thiểu" type="warning" />
                <AlertCard message="Xe 51K-22222: Đăng kiểm sắp hết hạn (3 ngày)" type="warning" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Thao tác nhanh
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2 h-9" asChild>
                  <Link to="/wms/inbound">
                    <PackagePlus className="h-4 w-4 text-green-600" />
                    Tạo phiếu nhập kho
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-9" asChild>
                  <Link to="/wms/outbound">
                    <PackageMinus className="h-4 w-4 text-blue-600" />
                    Tạo phiếu xuất kho
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-9" asChild>
                  <Link to="/tms/deliveries">
                    <Navigation className="h-4 w-4 text-purple-600" />
                    Tạo lệnh giao hàng
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 h-9" asChild>
                  <Link to="/wms/inventory">
                    <Package className="h-4 w-4 text-slate-600" />
                    Xem tồn kho
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
