import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, PackagePlus, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { PageHeader }      from '@/components/shared/PageHeader'
import { TableSkeleton }   from '@/components/shared/TableSkeleton'
import { EmptyState }      from '@/components/shared/EmptyState'
import { Button }          from '@/components/ui/button'
import { Input }           from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge }           from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label }           from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useInboundOrders, useCreateInboundOrder, useWarehouses, useMaterials, useLocationsReal } from '@/api/hooks'
import { inboundOrderStatusLabel } from '@/utils/formatters'
import { format, parseISO }        from 'date-fns'
import { vi }                      from 'date-fns/locale'
import type { InboundOrderStatus } from '@/types'

const statusVariant: Record<InboundOrderStatus, string> = {
  OPEN:      'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
}

function InboundStatusBadge({ status }: { status: string }) {
  const cls = statusVariant[status as InboundOrderStatus] ?? 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {inboundOrderStatusLabel[status] ?? status}
    </span>
  )
}

// ─── Create order dialog ─────────────────────────────────────

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [warehouseId, setWarehouseId] = useState('')
  const [materialId,  setMaterialId]  = useState('')
  const [locationId,  setLocationId]  = useState('')
  const [planned,     setPlanned]     = useState('')
  const [notes,       setNotes]       = useState('')
  const [matSearch,   setMatSearch]   = useState('')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: materials  = [] } = useMaterials({ search: matSearch || undefined })
  const { data: locations  = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )

  const { mutate: createOrder, isPending, error } = useCreateInboundOrder()

  function handleSubmit() {
    if (!warehouseId || !materialId) return
    createOrder(
      {
        warehouse_id:    warehouseId,
        material_id:     materialId,
        location_id:     locationId || undefined,
        planned_pallets: planned ? Number(planned) : undefined,
        notes:           notes || undefined,
      },
      {
        onSuccess: (data) => {
          onClose()
          navigate(`/wms/inbound/${data.order.id}`)
        },
      }
    )
  }

  function handleClose() {
    setWarehouseId(''); setMaterialId(''); setLocationId('')
    setPlanned(''); setNotes(''); setMatSearch('')
    onClose()
  }

  const apiError = (error as any)?.response?.data?.error?.message

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo phiếu nhập kho</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {apiError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {apiError}
            </div>
          )}

          <div className="space-y-2">
            <Label>Kho <span className="text-red-500">*</span></Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Chọn kho" /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Hàng hóa <span className="text-red-500">*</span></Label>
            <Input
              placeholder="Tìm mã hàng hoặc tên..."
              value={matSearch}
              onChange={(e) => setMatSearch(e.target.value)}
              className="mb-1"
            />
            <Select value={materialId} onValueChange={setMaterialId}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn hàng hóa" />
              </SelectTrigger>
              <SelectContent>
                {materials.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.material_code} – {m.short_name ?? m.material_description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Vị trí nhập <span className="text-xs text-slate-400">(không bắt buộc, có thể chọn khi quét)</span></Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={!warehouseId}>
              <SelectTrigger><SelectValue placeholder={warehouseId ? 'Chọn vị trí' : 'Chọn kho trước'} /></SelectTrigger>
              <SelectContent>
                {locations.map((l: any) => (
                  <SelectItem key={l.id} value={l.id}>{l.location_code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Số pallet dự kiến</Label>
              <Input
                type="number" min="1" placeholder="0"
                value={planned} onChange={(e) => setPlanned(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Ghi chú</Label>
              <Input placeholder="Tuỳ chọn" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Huỷ</Button>
          <Button
            onClick={handleSubmit}
            disabled={!warehouseId || !materialId || isPending}
          >
            {isPending ? 'Đang tạo...' : 'Tạo phiếu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ───────────────────────────────────────────────

export default function Inbound() {
  const navigate = useNavigate()
  const [search,    setSearch]    = useState('')
  const [statusFilter, setStatus] = useState('ALL')
  const [showNew,   setShowNew]   = useState(false)

  const { data: orders = [], isLoading } = useInboundOrders({
    search:  search || undefined,
    status:  statusFilter !== 'ALL' ? statusFilter : undefined,
  })

  const open      = orders.filter((o) => o.status === 'OPEN').length
  const completed = orders.filter((o) => o.status === 'COMPLETED').length
  const cancelled = orders.filter((o) => o.status === 'CANCELLED').length

  return (
    <div>
      <PageHeader
        title="Nhập kho"
        description="Quản lý phiếu nhập kho và theo dõi hàng đến"
        actions={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-2" /> Tạo phiếu nhập
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 p-6 pb-0">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-xl font-bold">{open}</p>
              <p className="text-xs text-muted-foreground">Đang mở</p>
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
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-5 w-5 text-slate-400" />
            <div>
              <p className="text-xl font-bold">{cancelled}</p>
              <p className="text-xs text-muted-foreground">Đã hủy</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="p-6 space-y-4">
        {/* Filters */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm mã phiếu, hàng hóa..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatus}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả</SelectItem>
              <SelectItem value="OPEN">Đang mở</SelectItem>
              <SelectItem value="COMPLETED">Hoàn thành</SelectItem>
              <SelectItem value="CANCELLED">Đã hủy</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          {isLoading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : orders.length === 0 ? (
            <EmptyState
              icon={PackagePlus}
              title="Chưa có phiếu nhập"
              description="Tạo phiếu nhập kho để bắt đầu quét hàng vào kho."
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
                  <TableHead>Hàng hóa</TableHead>
                  <TableHead className="hidden sm:table-cell">Vị trí</TableHead>
                  <TableHead className="text-right">Pallet</TableHead>
                  <TableHead className="hidden md:table-cell">Người tạo</TableHead>
                  <TableHead className="hidden lg:table-cell">Ngày tạo</TableHead>
                  <TableHead>Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow
                    key={order.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/wms/inbound/${order.id}`)}
                  >
                    <TableCell>
                      <span className="font-mono text-xs font-medium">
                        {order.import_code ?? order.id.slice(0, 8)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">
                          {order.material?.short_name ?? order.material?.material_description ?? '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">{order.material?.material_code}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {order.location ? (
                        <Badge variant="outline" className="font-mono text-xs">
                          {order.location.location_code}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Chưa chọn</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      <span className="text-blue-600 font-semibold">
                        {order._count.inventory_entries}
                      </span>
                      {order.planned_pallets ? (
                        <span className="text-xs text-muted-foreground"> / {order.planned_pallets}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {format(parseISO(order.created_at), 'dd/MM/yyyy HH:mm', { locale: vi })}
                    </TableCell>
                    <TableCell>
                      <InboundStatusBadge status={order.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <CreateOrderDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  )
}
