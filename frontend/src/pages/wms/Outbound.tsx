import { useState } from 'react'
import { Plus, Search, QrCode, PackageMinus, Scan } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TransactionStatusBadge } from '@/components/shared/StatusBadge'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { useTransactions } from '@/api/hooks'
import { formatDateTime, getLocationCode } from '@/utils/formatters'

export default function Outbound() {
  const { data: allTxns, isLoading } = useTransactions()
  const [search, setSearch] = useState('')
  const [showScan, setShowScan] = useState(false)

  const transactions = allTxns?.filter((t) => t.type === 'OUTBOUND') ?? []
  const filtered = transactions.filter((t) =>
    t.product.name.toLowerCase().includes(search.toLowerCase()) ||
    t.referenceNo.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <PageHeader
        title="Xuất kho"
        description="Quản lý phiếu xuất kho theo đơn hàng"
        actions={
          <>
            <Button variant="outline" onClick={() => setShowScan(true)}>
              <Scan className="h-4 w-4 mr-2" />
              Quét QR Order
            </Button>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Tạo phiếu xuất
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-4 p-6 pb-0">
        {[
          { label: 'Chờ xử lý', value: transactions.filter((t) => t.status === 'PENDING').length, color: 'text-amber-600' },
          { label: 'Đang xuất', value: transactions.filter((t) => t.status === 'IN_PROGRESS').length, color: 'text-blue-600' },
          { label: 'Hoàn thành', value: transactions.filter((t) => t.status === 'COMPLETED').length, color: 'text-green-600' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="p-6 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm mã SO, sản phẩm..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <Card>
          {isLoading ? (
            <TableSkeleton rows={4} cols={6} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={PackageMinus}
              title="Không có phiếu xuất"
              description="Tạo phiếu xuất kho hoặc quét QR order để bắt đầu."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã phiếu (SO)</TableHead>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead className="hidden sm:table-cell">Vị trí</TableHead>
                  <TableHead className="text-right">Pallet</TableHead>
                  <TableHead className="hidden md:table-cell">Người xuất</TableHead>
                  <TableHead className="hidden lg:table-cell">Thời gian</TableHead>
                  <TableHead>Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((txn) => (
                  <TableRow key={txn.id} className="cursor-pointer">
                    <TableCell>
                      <span className="font-mono text-xs font-medium">{txn.referenceNo}</span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{txn.product.name}</p>
                        <p className="text-xs text-muted-foreground">{txn.product.sku}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="font-mono text-xs">
                        {getLocationCode(txn.location)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{txn.pallets}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{txn.userName}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDateTime(txn.createdAt)}
                    </TableCell>
                    <TableCell><TransactionStatusBadge status={txn.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      {/* QR Scan Dialog */}
      <Dialog open={showScan} onOpenChange={setShowScan}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Quét QR Order</DialogTitle>
            <DialogDescription>Quét mã QR trên phiếu xuất kho hoặc đơn hàng</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex h-48 w-48 items-center justify-center rounded-xl border-2 border-dashed border-primary/30 bg-muted">
              <div className="text-center space-y-2">
                <QrCode className="h-12 w-12 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">Camera sẽ hiện ở đây</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Hướng camera vào mã QR trên phiếu xuất kho.<br />
              Hệ thống sẽ tự động nhận diện và tải đơn hàng.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScan(false)}>Huỷ</Button>
            <Button onClick={() => setShowScan(false)}>Nhập thủ công</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
