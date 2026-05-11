import { useMemo, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { TableSkeleton }  from '@/components/shared/TableSkeleton'
import { EmptyState }     from '@/components/shared/EmptyState'
import { Input }          from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLocationsReal, useWarehouses } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'

const SUB_TYPE_LABELS: Record<string, string> = {
  THANH_PHAM:    'Thành phẩm',
  NGUYEN_LIEU:   'Nguyên liệu',
  BAN_THANH_PHAM:'Bán thành phẩm',
}

interface RealLocation {
  id:           string
  location_code:string
  sub_code:     string
  sub_name:     string | null
  sub_type:     string | null
  row:          string
  shelf:        string
  max_pallets:  number
  used_slots:   number
  is_active:    boolean
  warehouse:    { id: string; code: string; name: string }
}

export default function Locations() {
  const user = useAuthStore(s => s.user)
  const [warehouseId, setWarehouseId] = useState(user?.warehouse_id ?? '')
  const [subType,     setSubType]     = useState('')
  const [search,      setSearch]      = useState('')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: raw = [], isLoading } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId } : undefined
  )
  const locations = (raw as RealLocation[]).filter(l => l.is_active)

  // Sub_type options derived from loaded locations
  const subTypeOpts = useMemo(() => {
    const all = locations.map(l => l.sub_type).filter(Boolean) as string[]
    return [...new Set(all)]
  }, [locations])

  const filtered = useMemo(() => {
    return locations.filter(l => {
      if (subType && l.sub_type !== subType) return false
      if (search && !l.location_code.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [locations, subType, search])

  const totalSlots = filtered.reduce((s, l) => s + l.max_pallets, 0)
  const usedSlots  = filtered.reduce((s, l) => s + l.used_slots,  0)
  const fullCount  = filtered.filter(l => l.max_pallets > 0 && l.used_slots >= l.max_pallets).length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MapPin className="h-5 w-5 text-slate-500" />
            Vị trí kho
          </h1>
        </div>

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={warehouseId || '__all__'} onValueChange={v => { setWarehouseId(v === '__all__' ? '' : v); setSubType('') }}>
            <SelectTrigger className="h-8 text-sm w-[130px]">
              <SelectValue placeholder="Tất cả kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {(warehouses as { id: string; name: string }[]).map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={subType || '__all__'} onValueChange={v => setSubType(v === '__all__' ? '' : v)} disabled={subTypeOpts.length === 0}>
            <SelectTrigger className="h-8 text-sm w-[140px]">
              <SelectValue placeholder="Tất cả loại" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả loại</SelectItem>
              {subTypeOpts.map(st => (
                <SelectItem key={st} value={st}>{SUB_TYPE_LABELS[st] ?? st}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[120px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm mã vị trí…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Summary */}
        <p className="text-xs text-slate-500 -mt-1">
          <span className="font-medium text-slate-700">{filtered.length}</span> vị trí
          {' '}·{' '}
          <span className="font-medium text-slate-700">{usedSlots}</span>
          <span className="text-slate-400">/{totalSlots}</span> pallet đang dùng
          {fullCount > 0 && (
            <span className="ml-2 text-blue-600 font-medium">· {fullCount} đầy</span>
          )}
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={8} cols={7} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={MapPin} title="Không tìm thấy vị trí" />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Mã vị trí</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Khu vực</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Loại kho</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Kho</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">Sức chứa</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">Đang dùng</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(loc => {
                  const isFull    = loc.max_pallets > 0 && loc.used_slots >= loc.max_pallets
                  const isPartial = loc.used_slots > 0 && !isFull
                  const rowCls = isFull
                    ? 'bg-blue-50 hover:bg-blue-100'
                    : isPartial
                    ? 'bg-amber-50 hover:bg-amber-100'
                    : 'hover:bg-slate-50'
                  return (
                    <TableRow key={loc.id} className={rowCls}>
                      <TableCell className="px-2 py-1">
                        <span className="font-mono font-semibold text-[10px]">{loc.location_code}</span>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px]">
                        <span className="font-medium">{loc.sub_code}</span>
                        {loc.sub_name && <span className="ml-1 text-slate-400">{loc.sub_name}</span>}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-600">
                        {loc.sub_type ? (SUB_TYPE_LABELS[loc.sub_type] ?? loc.sub_type) : '—'}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-600">
                        {loc.warehouse?.name ?? '—'}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums">
                        {loc.max_pallets} <span className="text-slate-400">pl</span>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-right tabular-nums">
                        <span className={isFull ? 'text-blue-600 font-semibold' : isPartial ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                          {loc.used_slots}
                        </span>
                        <span className="text-slate-400">/{loc.max_pallets}</span>
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                          isFull
                            ? 'bg-blue-100 text-blue-700'
                            : isPartial
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {isFull ? 'Đầy' : isPartial ? 'Còn chỗ' : 'Trống'}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
