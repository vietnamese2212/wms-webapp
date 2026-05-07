import { useState } from 'react'
import { Search, Filter, Download, RefreshCw, Package } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StockStatusBadge } from '@/components/shared/StatusBadge'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useInventory } from '@/api/hooks'
import { formatDateTime, getLocationCode } from '@/utils/formatters'
import type { StockStatus } from '@/types'

export default function Inventory() {
  const { data: items, isLoading, refetch, isFetching } = useInventory()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StockStatus | 'ALL'>('ALL')

  const filtered = items?.filter((item) => {
    const matchSearch =
      item.product.name.toLowerCase().includes(search.toLowerCase()) ||
      item.product.sku.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'ALL' || item.status === statusFilter
    return matchSearch && matchStatus
  }) ?? []

  const counts = {
    total: items?.length ?? 0,
    inStock: items?.filter((i) => i.status === 'IN_STOCK').length ?? 0,
    lowStock: items?.filter((i) => i.status === 'LOW_STOCK').length ?? 0,
    outOfStock: items?.filter((i) => i.status === 'OUT_OF_STOCK').length ?? 0,
  }

  return (
    <div>
      <PageHeader
        title="Tồn kho"
        description="Quản lý hàng tồn kho theo vị trí và pallet"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Làm mới
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Xuất Excel
            </Button>
          </>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-6 pb-0">
        {[
          { label: 'Tổng mặt hàng', value: counts.total, color: 'text-foreground' },
          { label: 'Đủ hàng', value: counts.inStock, color: 'text-green-600' },
          { label: 'Sắp hết', value: counts.lowStock, color: 'text-amber-600' },
          { label: 'Hết hàng', value: counts.outOfStock, color: 'text-red-600' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 p-6 pb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Tìm SKU, tên sản phẩm..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StockStatus | 'ALL')}>
          <SelectTrigger className="w-full sm:w-44">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
            <SelectItem value="IN_STOCK">Đủ hàng</SelectItem>
            <SelectItem value="LOW_STOCK">Sắp hết</SelectItem>
            <SelectItem value="OUT_OF_STOCK">Hết hàng</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="px-6">
        <Card>
          {isLoading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Không tìm thấy hàng hoá"
              description="Thử thay đổi bộ lọc hoặc từ khoá tìm kiếm."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU / Tên sản phẩm</TableHead>
                  <TableHead className="hidden sm:table-cell">Vị trí</TableHead>
                  <TableHead className="text-right">Số lượng</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Pallet</TableHead>
                  <TableHead className="hidden lg:table-cell">Lô hàng</TableHead>
                  <TableHead className="hidden lg:table-cell">Cập nhật</TableHead>
                  <TableHead>Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{item.product.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{item.product.sku}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="font-mono text-xs">
                        {getLocationCode(item.location)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {item.quantity} <span className="text-muted-foreground text-xs">{item.product.unit}</span>
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16">
                          <Progress
                            value={item.location.capacity > 0 ? (item.pallets / item.location.capacity) * 100 : 0}
                            className="h-1.5"
                            indicatorClassName={
                              item.pallets / item.location.capacity >= 0.9 ? 'bg-red-500' :
                              item.pallets / item.location.capacity >= 0.7 ? 'bg-amber-500' : 'bg-green-500'
                            }
                          />
                        </div>
                        <span className="tabular-nums text-xs">
                          {item.pallets}/{item.location.capacity}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground font-mono">
                      {item.batchNumber ?? '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDateTime(item.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <StockStatusBadge status={item.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <p className="text-xs text-muted-foreground mt-2 pb-2">
          Hiển thị {filtered.length} / {items?.length ?? 0} mặt hàng
        </p>
      </div>
    </div>
  )
}
