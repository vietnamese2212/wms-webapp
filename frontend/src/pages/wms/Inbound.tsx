import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, PackagePlus, CalendarDays, X } from 'lucide-react'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useAuthStore }        from '@/stores/authStore'
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

const TODAY = new Date().toISOString().slice(0, 10)

interface LocationWithCapacity {
  id: string
  location_code: string
  sub_code: string
  max_pallets: number
  used_slots: number
}

// ─── Create order dialog ─────────────────────────────────────

type MatItem = { id: string; material_code: string; short_name: string | null; material_description: string }

function CreateOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate  = useNavigate()
  const user      = useAuthStore((s) => s.user)
  const isOWN     = user?.role === 'OWN'

  const [warehouseId, setWarehouseId] = useState('')
  const [materialId,  setMaterialId]  = useState('')
  const [locationId,  setLocationId]  = useState('')
  const [shiftId,     setShiftId]     = useState('')
  const [importDate,  setImportDate]  = useState(format(new Date(), 'yyyy-MM-dd'))
  const [notes,       setNotes]       = useState('')

  // Material combobox state
  const [matSearch,  setMatSearch]  = useState('')
  const [matOpen,    setMatOpen]    = useState(false)
  const matRef = useRef<HTMLDivElement>(null)

  // Reset all fields each time the dialog opens
  useEffect(() => {
    if (open) {
      setWarehouseId(user?.warehouse_id ?? '')
      setMaterialId('')
      setMatSearch('')
      setMatOpen(false)
      setLocationId('')
      setShiftId('')
      setImportDate(format(new Date(), 'yyyy-MM-dd'))
      setNotes('')
    }
  }, [open, user?.warehouse_id])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: materials  = [] } = useMaterials({ search: matSearch || undefined })
  const { data: shifts     = [] } = useImportShifts()
  const { data: locations  = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )

  // Auto-select warehouse by name when warehouse_id not set (mock auth scenario)
  useEffect(() => {
    if (!open || warehouseId || !user?.warehouse_name || !warehouses.length) return
    const match = (warehouses as { id: string; name: string }[]).find(w => w.name === user.warehouse_name)
    if (match) setWarehouseId(match.id)
  }, [open, warehouses, user?.warehouse_name, warehouseId])

  // Close combobox on click outside
  useEffect(() => {
    if (!matOpen) return
    const handler = (e: MouseEvent) => {
      if (matRef.current && !matRef.current.contains(e.target as Node)) setMatOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [matOpen])

  const { mutate: createOrder, isPending, error } = useCreateInboundOrder()

  const selectedMat = (materials as MatItem[]).find(m => m.id === materialId)
  const matInputValue = matOpen
    ? matSearch
    : (selectedMat ? `${selectedMat.material_code} – ${selectedMat.short_name ?? selectedMat.material_description}` : matSearch)

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
        // imported_by omitted — auth not fully implemented, mock user.id doesn't exist in Employee table
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

          {/* Kho – auto-fill theo user, chỉ OWN mới đổi được */}
          <div className="space-y-2">
            <Label>Kho <span className="text-red-500">*</span></Label>
            {isOWN ? (
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
                {(warehouses as { id: string; name: string }[]).find((w) => w.id === warehouseId)?.name ?? (warehouseId || '—')}
              </div>
            )}
          </div>

          {/* Material – combobox tìm kiếm nội tuyến */}
          <div className="space-y-2">
            <Label>Material <span className="text-red-500">*</span></Label>
            <div ref={matRef} className="relative">
              <Input
                placeholder="Tìm mã hoặc tên hàng..."
                value={matInputValue}
                onChange={(e) => { setMatSearch(e.target.value); setMaterialId(''); setMatOpen(true) }}
                onFocus={() => setMatOpen(true)}
              />
              {matOpen && (
                <div className="absolute z-[100] w-full mt-1 max-h-52 overflow-y-auto rounded-md border bg-white shadow-lg">
                  {(materials as MatItem[]).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 flex items-baseline gap-2 ${m.id === materialId ? 'bg-slate-50 font-medium' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onClick={() => { setMaterialId(m.id); setMatSearch(''); setMatOpen(false) }}
                    >
                      <span className="font-mono text-xs text-slate-500 shrink-0">{m.material_code}</span>
                      <span className="text-slate-800 truncate">{m.short_name ?? m.material_description}</span>
                    </button>
                  ))}
                  {(materials as MatItem[]).length === 0 && (
                    <div className="px-3 py-3 text-sm text-slate-400 text-center">Không tìm thấy hàng hóa</div>
                  )}
                </div>
              )}
            </div>
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
  const [search,  setSearch]  = useState('')
  const [date,    setDate]    = useState(TODAY)
  const [showNew, setShowNew] = useState(false)

  const { data: orders = [], isLoading } = useInboundOrders({
    search: search || undefined,
    date:   date   || undefined,
  })

  const dateLabel = date
    ? format(parseISO(date), 'EEEE, dd/MM/yyyy', { locale: vi })
    : 'Tất cả ngày'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-slate-500" />
            Nhập kho
          </h1>
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> Tạo phiếu nhập
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {/* Date filter */}
          <div className="relative flex items-center gap-1.5">
            <CalendarDays className="absolute left-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              type="date"
              className="pl-8 h-8 text-sm w-[160px]"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
            {date && date !== TODAY && (
              <button
                className="ml-1 text-xs text-slate-400 hover:text-slate-700 underline whitespace-nowrap"
                onClick={() => setDate(TODAY)}
              >
                Hôm nay
              </button>
            )}
            {date && (
              <button
                className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                title="Xem tất cả ngày"
                onClick={() => setDate('')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm mã phiếu, hàng hóa…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Date label */}
        <p className="text-xs text-slate-500 -mt-1">
          {date ? (
            <>
              <span className="font-medium text-slate-700">{dateLabel}</span>
              {date === TODAY && <span className="ml-1.5 text-blue-600 font-medium">· Hôm nay</span>}
            </>
          ) : (
            <span className="italic">Hiển thị tất cả ngày</span>
          )}
          <span className="ml-1.5">— {orders.length} phiếu nhập</span>
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={5} cols={6} /></div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={PackagePlus}
            title="Chưa có phiếu nhập"
            description={date ? `Không có phiếu nhập ngày ${format(parseISO(date), 'dd/MM/yyyy')}` : 'Tạo phiếu nhập kho để bắt đầu quét hàng vào kho.'}
            action={
              <Button onClick={() => setShowNew(true)}>
                <Plus className="h-4 w-4 mr-2" /> Tạo phiếu nhập
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs font-medium text-slate-500 px-3 py-2 whitespace-nowrap">Ngày nhập</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 px-3 py-2 whitespace-nowrap">Ca</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 px-3 py-2">Material</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 px-3 py-2 text-right whitespace-nowrap">Pallet</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">Tổng đã nhập</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 px-3 py-2 hidden md:table-cell">Người nhập</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map(order => <InboundRow key={order.id} order={order} onClick={() => navigate(`/wms/inbound/${order.id}`)} />)}
            </TableBody>
          </Table>
        )}
      </div>

      <CreateOrderDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  )
}

function InboundRow({ order, onClick }: { order: InboundOrder; onClick: () => void }) {
  const dateStr  = order.import_date ? format(parseISO(order.import_date), 'dd/MM/yyyy', { locale: vi }) : '—'
  const isToday  = order.import_date === TODAY
  const importer = order.imported_by_emp?.name ?? order.created_by_emp?.name ?? '—'
  const matName  = order.material?.short_name ?? order.material?.material_description ?? '—'
  const matCode  = order.material?.material_code ?? ''

  return (
    <TableRow className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={onClick}>
      <TableCell className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium tabular-nums">{dateStr}</span>
          {isToday && (
            <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-medium">Hôm nay</span>
          )}
        </div>
      </TableCell>
      <TableCell className="px-2 py-1.5">
        {order.shift
          ? <span className="text-xs font-medium">{order.shift.name}</span>
          : <span className="text-slate-300 text-xs">—</span>}
      </TableCell>
      <TableCell className="px-2 py-1.5">
        <div className="text-xs font-medium leading-tight">{matName}</div>
        <div className="text-[10px] text-slate-400 font-mono">{matCode}</div>
      </TableCell>
      <TableCell className="px-2 py-1.5 text-right">
        <span className="text-xs font-semibold tabular-nums text-blue-700">
          {order._count.inventory_entries}
        </span>
        <span className="text-[10px] text-slate-400 ml-0.5">pl</span>
      </TableCell>
      <TableCell className="px-2 py-1.5 text-right hidden sm:table-cell">
        <span className="text-xs font-semibold tabular-nums">{order.total_cartons ?? 0}</span>
        <span className="text-[10px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1.5 hidden md:table-cell">
        <span className="text-xs text-slate-700">{importer}</span>
      </TableCell>
    </TableRow>
  )
}
