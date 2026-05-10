import { useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import { Package, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useInventoryEntries, useWarehouses, useQAStatuses } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import type { InventoryEntry } from '@/types'

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK:    'Còn hàng',
  PARTIAL:     'Xuất 1 phần',
  EXPORTED:    'Đã xuất',
  TRANSFERRED: 'Đã chuyển',
  QUARANTINE:  'Cách ly',
  CANCELLED:   'Đã hủy',
}
const STATUS_CLS: Record<string, string> = {
  IN_STOCK:    'bg-green-100 text-green-700',
  PARTIAL:     'bg-amber-100 text-amber-700',
  EXPORTED:    'bg-blue-100 text-blue-700',
  TRANSFERRED: 'bg-slate-100 text-slate-600',
  QUARANTINE:  'bg-red-100 text-red-700',
  CANCELLED:   'bg-gray-100 text-gray-500',
}

function entryRowBg(e: InventoryEntry) {
  if (e.status === 'PARTIAL')     return 'bg-amber-50 hover:bg-amber-100'
  if (e.status === 'QUARANTINE')  return 'bg-red-50 hover:bg-red-100'
  if (e.status === 'EXPORTED' || e.status === 'TRANSFERRED') return 'bg-blue-50 hover:bg-blue-100'
  return 'hover:bg-slate-50'
}

const LIMIT = 50

export default function Inventory() {
  const user = useAuthStore(s => s.user)
  const { inventory: f, setInventory } = useWmsFilterStore()

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: qaStatuses = [] }  = useQAStatuses()

  // Init warehouseId from user on first load
  useEffect(() => {
    if (!f.warehouseId && user?.warehouse_id) {
      setInventory({ warehouseId: user.warehouse_id })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const { data, isLoading } = useInventoryEntries({
    warehouse_id:    f.warehouseId   || undefined,
    location_code:   f.locationCode  || undefined,
    material_search: f.materialSearch || undefined,
    qa_status_id:    f.qaStatusId    || undefined,
    status:          f.status        || undefined,
    search:          f.search        || undefined,
    page:            f.page,
    limit:           LIMIT,
  })

  const entries   = data?.entries ?? []
  const total     = data?.total   ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  function resetFilters() {
    setInventory({ search: '', materialSearch: '', locationCode: '', qaStatusId: '', status: '', page: 1 })
  }

  const hasFilters = f.search || f.materialSearch || f.locationCode || f.qaStatusId || f.status

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-slate-500" />
            Tồn kho
          </h1>
          {hasFilters && (
            <button onClick={resetFilters}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />Xóa bộ lọc
            </button>
          )}
        </div>

        {/* Row 1: Kho + tìm pallet */}
        <div className="flex gap-2">
          <Select
            value={f.warehouseId || '__all__'}
            onValueChange={v => setInventory({ warehouseId: v === '__all__' ? '' : v, page: 1 })}
          >
            <SelectTrigger className="h-8 text-xs w-[150px]">
              <SelectValue placeholder="Chọn kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {warehouses.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm mã pallet…"
              value={f.search}
              onChange={e => setInventory({ search: e.target.value, page: 1 })} />
          </div>
        </div>

        {/* Row 2: Vị trí + Hàng + QA + Trạng thái */}
        <div className="flex gap-2 flex-wrap">
          <Input className="h-7 text-xs w-[110px]" placeholder="Vị trí…"
            value={f.locationCode}
            onChange={e => setInventory({ locationCode: e.target.value, page: 1 })} />

          <Input className="h-7 text-xs w-[140px]" placeholder="Tìm mã hàng…"
            value={f.materialSearch}
            onChange={e => setInventory({ materialSearch: e.target.value, page: 1 })} />

          <Select value={f.qaStatusId || '__all__'} onValueChange={v => setInventory({ qaStatusId: v === '__all__' ? '' : v, page: 1 })}>
            <SelectTrigger className="h-7 text-xs w-[100px]">
              <SelectValue placeholder="QA" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả QA</SelectItem>
              {qaStatuses.map((q: any) => (
                <SelectItem key={q.id} value={q.id}>{q.code} – {q.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={f.status || '__active__'} onValueChange={v => setInventory({ status: v === '__active__' ? '' : v, page: 1 })}>
            <SelectTrigger className="h-7 text-xs w-[130px]">
              <SelectValue placeholder="Trạng thái" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__active__">Đang tồn</SelectItem>
              <SelectItem value="ALL">Tất cả</SelectItem>
              <SelectItem value="IN_STOCK">Còn hàng</SelectItem>
              <SelectItem value="PARTIAL">Xuất 1 phần</SelectItem>
              <SelectItem value="QUARANTINE">Cách ly</SelectItem>
              <SelectItem value="EXPORTED">Đã xuất</SelectItem>
              <SelectItem value="TRANSFERRED">Đã chuyển</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary */}
        <p className="text-xs text-slate-500 -mt-1">
          {isLoading ? 'Đang tải…' : (
            <>
              <span className="font-medium text-slate-700">{total.toLocaleString()}</span> pallet
              {totalPages > 1 && (
                <span className="ml-1.5">— trang {f.page}/{totalPages}</span>
              )}
            </>
          )}
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1,2,3,4,5].map(i => <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />)}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <Package className="h-10 w-10 opacity-30" />
            <p className="text-sm">Không tìm thấy pallet nào</p>
            {hasFilters && (
              <button onClick={resetFilters} className="text-xs text-blue-500 underline">Xóa bộ lọc</button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-full">
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã pallet</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Vị trí</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên hàng</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">QA</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-center whitespace-nowrap">Tầng</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Còn lại</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Nhập</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Ngày nhập</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">T.thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(e => <EntryRow key={e.id} entry={e} />)}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 py-3 border-t bg-white">
                <button
                  disabled={f.page <= 1}
                  onClick={() => setInventory({ page: f.page - 1 })}
                  className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
                  ← Trước
                </button>
                <span className="text-xs text-slate-500">{f.page} / {totalPages}</span>
                <button
                  disabled={f.page >= totalPages}
                  onClick={() => setInventory({ page: f.page + 1 })}
                  className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
                  Sau →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function EntryRow({ entry: e }: { entry: InventoryEntry }) {
  const loc      = e.location ? `${e.location.location_code}-${e.location.sub_code}` : '—'
  const matCode  = e.material?.material_code ?? '—'
  const matName  = e.material?.short_name ?? '—'
  const qa       = e.qa_status?.code ?? '—'
  const dateStr  = e.import_date
    ? format(parseISO(e.import_date), 'dd/MM/yy')
    : '—'
  const remaining = e.cartons_remaining ?? e.cartons_imported

  return (
    <TableRow className={`transition-colors ${entryRowBg(e)}`}>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold">{e.pallet_code}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono text-slate-700">{loc}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono text-slate-700">{matCode}</span>
      </TableCell>
      <TableCell className="px-2 py-1 max-w-[140px]">
        <span className="text-[10px] text-slate-700 truncate block" title={matName}>{matName}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{qa}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-center whitespace-nowrap">
        <span className="text-[10px] tabular-nums">{e.stack_layer}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{remaining}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{e.cartons_imported}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{dateStr}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_CLS[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABEL[e.status] ?? e.status}
        </span>
      </TableCell>
    </TableRow>
  )
}
