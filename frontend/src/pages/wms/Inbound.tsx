import { useState } from 'react'
import { Plus, Search, QrCode, PackagePlus, Clock, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TransactionStatusBadge } from '@/components/shared/StatusBadge'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTransactions } from '@/api/hooks'
import { formatDateTime, getLocationCode } from '@/utils/formatters'

export default function Inbound() {
  const { data: allTxns, isLoading } = useTransactions()
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)

  const transactions = allTxns?.filter((t) => t.type === 'INBOUND') ?? []
  const filtered = transactions.filter((t) =>
    t.product.name.toLowerCase().includes(search.toLowerCase()) ||
    t.referenceNo.toLowerCase().includes(search.toLowerCase())
  )

  const pending = transactions.filter((t) => t.status === 'PENDING').length
  const inProgress = transactions.filter((t) => t.status === 'IN_PROGRESS').length
  const completed = transactions.filter((t) => t.status === 'COMPLETED').length

  return (
    <div>
      <PageHeader
        title="Nhập kho"
        description="Quản lý phiếu nhập kho và theo dõi hàng đến"
        actions={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Tạo phiếu nhập
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-4 p-6 pb-0">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-xl font-bold">{pending}</p>
              <p className="text-xs text-muted-foreground">Chờ xử lý</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <PackagePlus className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-xl font-bold">{inProgress}</p>
              <p className="text-xs text-muted-foreground">Đang nhập</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-xl font-bold">{completed}</p>
              <p className="text-xs text-muted-foreground">Hoàn thành</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm mã phiếu, sản phẩm..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon">
            <QrCode className="h-4 w-4" />
          </Button>
        </div>

        <Card>
          {isLoading ? (
            <TableSkeleton rows={4} cols={6} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={PackagePlus}
              title="Không có phiếu nhập"
              description="Tạo phiếu nhập kho mới để bắt đầu."
              action={
                <Button onClick={() => setShowNew(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Tạo phiếu nhập
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã phiếu</TableHead>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead className="hidden sm:table-cell">Vị trí</TableHead>
                  <TableHead className="text-right">Số pallet</TableHead>
                  <TableHead className="hidden md:table-cell">Người nhập</TableHead>
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

      {/* New Inbound Dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo phiếu nhập kho</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Mã đơn hàng (PO)</Label>
              <Input placeholder="VD: PO-2026-0514" />
            </div>
            <div className="space-y-2">
              <Label>Sản phẩm</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Chọn sản phẩm" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="P001">SKU-001 - Thùng carton 3 lớp</SelectItem>
                  <SelectItem value="P002">SKU-002 - Băng keo OPP trong</SelectItem>
                  <SelectItem value="P003">SKU-003 - Pallet gỗ tiêu chuẩn</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Số pallet</Label>
                <Input type="number" placeholder="0" min="1" />
              </div>
              <div className="space-y-2">
                <Label>Số lượng / pallet</Label>
                <Input type="number" placeholder="0" min="1" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Vị trí nhập</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Chọn vị trí" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="L001">A-01.1.01 (còn 2 slot)</SelectItem>
                  <SelectItem value="L002">A-01.1.02 (còn 7 slot)</SelectItem>
                  <SelectItem value="L003">A-01.2.01 (còn 8 slot)</SelectItem>
                  <SelectItem value="L005">B-01.1.01 (còn 7 slot)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
              <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
                <QrCode className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-xs">Quét QR Pallet sau khi chọn vị trí để xác nhận nhập kho. Hệ thống sẽ kiểm tra tự động.</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Huỷ</Button>
            <Button onClick={() => setShowNew(false)}>Tạo phiếu nhập</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
