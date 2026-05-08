import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, PackagePlus } from 'lucide-react'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useAuthStore }        from '@/stores/authStore'
import { PageHeader }          from '@/components/shared/PageHeader'
import { TableSkeleton }       from '@/components/shared/TableSkeleton'
import { EmptyState }          from '@/components/shared/EmptyState'
import { Button }              from '@/components/ui/button'
import { Input }               from '@/components/ui/input'
import { Card }                from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label }               from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useInboundOrders, useCreateInboundOrder,
  useWarehouses, useMaterials, useLocationsReal, useImportShifts,
} from '@/api/hooks'
import type { InboundOrder } from '@/types'

interface LocationWithCapacity {
  id: string
  location_code: string
  sub_code: string
  max_pallets: number
  used_slots: number
}

// ─── Create order dialog ─────────────────────────────────────

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate  = useNavigate()
  const user      = useAuthStore((s) => s.user)
  const isAdmin   = user?.role === 'ADMIN'

  const [warehouseId, setWarehouseId] = useState(user?.warehouse_id ?? '')
  const [materialId,  setMaterialId]  = useState('')
  const [locationId,  setLocationId]  = useState('')
  const [shiftId,     setShiftId]     = useState('')
  const [importDate,  setImportDate]  = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes,       setNotes]       = useState('')
  const [matSearch,   setMatSearch]   = useState('')

  // Reset all fields each time the dialog opens
  useEffect(() => {
    if (open) {
      setWarehouseId(user?.warehouse_id ?? '')
      setMaterialId('')
      setLocationId('')
      setShiftId('')
      setImportDate(format(new Date(), 'yyyy-MM-dd'))
      setNotes('')
      setMatSearch('')
    }
  }, [open, user?.warehouse_id])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: materials  = [] } = useMaterials({ search: matSearch || undefined })
  const { data: shifts     = [] } = useImportShifts()
  const { data: locations  = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )

  const { mutate: createOrder, isPending, error } = useCreateInboundOrder()

  function handleSubmit() {
    if (!warehouseId || !materialId || !locationId) return
    createOrder(
      {
        warehouse_id: warehouseId,
        material_id:  materialId,
        location_id:  locationId,
        shift_id:     shiftId   || undefined,
        import_date:  importDate,
        notes:        notes     || undefined,
        imported_by:  user?.id,
      },
      {
        onSuccess: (data) => {
          onClose()
          navigate(`/wms/inbound/${data.order.id}`)
        },
      }
    )
  }

  const apiError = (error as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
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

          {/* Kho – auto-fill theo user, chỉ ADMIN mới đổi được */}
          <div className="space-y-2">
            <Label>Kho <span className="text-red-500">*</span></Label>
            {isAdmin || !user?.warehouse_id ? (
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                <SelectContent>
                  {(warehouses as { id: string; name: string; code: string }[]).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm text-slate-700">
                {(warehouses as { id: string; name: string }[]).find((w) => w.id === warehouseId)?.name ?? warehouseId}
              </div>
            )}
          </div>

          {/* Material */}
          <div className="space-y-2">
            <Label>Material <span className="text-red-500">*</span></Label>
            <Input
              placeholder="Tìm mã hoặc tên hàng..."
              value={matSearch}
              onChange={(e) => setMatSearch(e.target.value)}
              className="mb-1"
            />
            <Select value={materialId} onValueChange={setMaterialId}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn material" />
              </SelectTrigger>
              <SelectContent>
                {(materials as { id: string; material_code: string; short_name: string | null; material_description: string }[]).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.material_code} – {m.short_name ?? m.material_description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vị trí – required, color-coded by capacity */}
          <div className="space-y-2">
            <Label>
              Vị trí nhập <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-slate-400">
                đầy=xanh · một phần=cam · trống=trắng
              </span>
            </Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={!warehouseId}>
              <SelectTrigger>
                <SelectValue placeholder={warehouseId ? 'Chọn vị trí' : 'Chọn kho trước'} />
              </SelectTrigger>
              <SelectContent>
                {(locations as LocationWithCapacity[]).map((l) => {
                  const isFull    = l.max_pallets > 0 && l.used_slots >= l.max_pallets
                  const isPartial = l.used_slots > 0 && !isFull
                  return (
                    <SelectItem key={l.id} value={l.id}>
                      <span className={isFull ? 'text-blue-700 font-semibold' : isPartial ? 'text-amber-600' : ''}>
                        {l.location_code}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">
                        ({l.used_slots}/{l.max_pallets})
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Ca nhập + Ngày nhập */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Ca nhập</Label>
              <Select value={shiftId} onValueChange={setShiftId}>
                <SelectTrigger><SelectValue placeholder="Chọn ca" /></SelectTrigger>
                <SelectContent>
                  {(shifts as { id: string; name: string }[]).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ngày nhập</Label>
              <Input
                type="date"
                value={importDate}
                onChange={(e) => setImportDate(e.target.value)}
              />
            </div>
          </div>

          {/* Người nhập – read-only, từ user đang login */}
          <div className="space-y-2">
            <Label>Người nhập</Label>
            <div className="flex h-10 items-center rounded-md border bg-slate-50 px-3 text-sm text-slate-700">
              {user?.name ?? '—'}
            </div>
          </div>

          {/* Ghi chú */}
          <div className="space-y-2">
            <Label>Ghi chú</Label>
            <Input placeholder="Tuỳ chọn" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button
            onClick={handleSubmit}
            disabled={!warehouseId || !materialId || !locationId || isPending}
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
  const [search,   setSearch]   = useState('')
  const [sortDesc, setSortDesc] = useState(true)
  const [showNew,  setShowNew]  = useState(false)

  const { data: orders = [], isLoading } = useInboundOrders({
    search: search || undefined,
  })

  // Backend returns desc by default; reverse for asc
  const sorted: InboundOrder[] = sortDesc ? orders : [...orders].reverse()

  return (
    <div>
      <PageHeader
        title="Nhập kho"
        description="Quản lý phiếu nhập kho"
        actions={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-2" /> Tạo phiếu nhập
          </Button>
        }
      />

      <div className="p-6 space-y-4">
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
          <Select value={sortDesc ? 'desc' : 'asc'} onValueChange={(v) => setSortDesc(v === 'desc')}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Mới nhất trước</SelectItem>
              <SelectItem value="asc">Cũ nhất trước</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card>
          {isLoading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : sorted.length === 0 ? (
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
                  <TableHead>Ngày nhập</TableHead>
                  <TableHead>Ca</TableHead>
                  <TableHead className="hidden sm:table-cell">Vị trí</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Thùng</TableHead>
                  <TableHead className="text-right">Pallet</TableHead>
                  <TableHead className="hidden md:table-cell">Ghi chú</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((order) => (
                  <TableRow
                    key={order.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/wms/inbound/${order.id}`)}
                  >
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {order.import_date
                        ? format(parseISO(order.import_date), 'dd/MM/yyyy', { locale: vi })
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {order.shift ? (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-slate-100">
                          {order.shift.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {order.location ? (
                        <span className="font-mono text-xs font-medium">
                          {order.location.location_code}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">
                          {order.material?.short_name ?? order.material?.material_description ?? '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">{order.material?.material_code}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums hidden sm:table-cell text-sm">
                      {order.total_cartons ?? '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      <span className="text-blue-600 font-semibold">
                        {order._count.inventory_entries}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[160px] truncate">
                      {order.notes ?? '—'}
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
