import { useState } from 'react'
import { MapPin, Search, Plus, QrCode } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { TableSkeleton } from '@/components/shared/TableSkeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLocations } from '@/api/hooks'
import { cn } from '@/lib/utils'

export default function Locations() {
  const { data: locations, isLoading } = useLocations()
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('grid')

  const filtered = locations?.filter((loc) => {
    const code = `${loc.zone}-${loc.row}.${loc.shelf}.${loc.bin}`
    return code.toLowerCase().includes(search.toLowerCase())
  }) ?? []

  const zones = [...new Set(locations?.map((l) => l.zone) ?? [])]
  const totalCapacity = locations?.reduce((sum, l) => sum + l.capacity, 0) ?? 0
  const totalUsed = locations?.reduce((sum, l) => sum + l.currentPallets, 0) ?? 0
  const fullLocations = locations?.filter((l) => l.currentPallets >= l.capacity).length ?? 0
  const emptyLocations = locations?.filter((l) => l.currentPallets === 0).length ?? 0

  return (
    <div>
      <PageHeader
        title="Vị trí kho"
        description="Quản lý sơ đồ kho và tình trạng sức chứa Pallet"
        actions={
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Thêm vị trí
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-6 pb-0">
        {[
          { label: 'Tổng vị trí', value: locations?.length ?? 0 },
          { label: 'Tổng sức chứa', value: `${totalCapacity} pallet` },
          { label: 'Đang sử dụng', value: `${totalUsed} / ${totalCapacity}` },
          { label: 'Vị trí đầy', value: fullLocations },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Zone overview */}
      <div className="p-6 pb-0">
        <h2 className="text-sm font-semibold mb-3">Tổng quan theo khu vực</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {zones.map((zone) => {
            const zoneLocs = locations?.filter((l) => l.zone === zone) ?? []
            const zoneCapacity = zoneLocs.reduce((s, l) => s + l.capacity, 0)
            const zoneUsed = zoneLocs.reduce((s, l) => s + l.currentPallets, 0)
            const pct = zoneCapacity > 0 ? (zoneUsed / zoneCapacity) * 100 : 0
            return (
              <Card key={zone}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary text-xs font-bold">
                        {zone}
                      </div>
                      Khu {zone}
                    </span>
                    <Badge variant={pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'success'} className="text-[10px]">
                      {pct.toFixed(0)}%
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  <Progress
                    value={pct}
                    className="h-2"
                    indicatorClassName={pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500'}
                  />
                  <p className="text-xs text-muted-foreground">
                    {zoneUsed} / {zoneCapacity} pallet · {zoneLocs.length} vị trí
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Table */}
      <div className="p-6 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm vị trí (VD: A-01.1.01)..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <Card>
          {isLoading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={MapPin} title="Không tìm thấy vị trí" />
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Mã vị trí</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Khu / Hàng / Kệ</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Sức chứa</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Đang chứa</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500">Trạng thái</TableHead>
                  <TableHead className="px-2 py-1.5 text-[9px] font-medium text-slate-500 text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((loc) => {
                  const pct = loc.capacity > 0 ? (loc.currentPallets / loc.capacity) * 100 : 0
                  const isFull = loc.currentPallets >= loc.capacity
                  const isEmpty = loc.currentPallets === 0
                  return (
                    <TableRow key={loc.id} className="hover:bg-slate-50">
                      <TableCell className="px-2 py-1">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {loc.zone}-{loc.row}.{loc.shelf}.{loc.bin}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px] text-slate-500">
                        Khu {loc.zone} / Hàng {loc.row} / Kệ {loc.shelf}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-[10px]">{loc.capacity} pallet</TableCell>
                      <TableCell className="px-2 py-1">
                        <div className="flex items-center gap-2">
                          <div className="w-20">
                            <Progress
                              value={pct}
                              className="h-1.5"
                              indicatorClassName={isFull ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500'}
                            />
                          </div>
                          <span className="text-[10px] tabular-nums text-slate-500">
                            {loc.currentPallets}/{loc.capacity}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        <Badge variant={isFull ? 'danger' : isEmpty ? 'slate' : 'success'}>
                          {isFull ? 'Đầy' : isEmpty ? 'Trống' : 'Còn chỗ'}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        <Button variant="ghost" size="icon-sm">
                          <QrCode className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
