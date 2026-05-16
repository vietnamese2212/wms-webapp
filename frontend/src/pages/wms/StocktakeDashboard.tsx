import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWarehouses, useMaterialCategories, useUnflagEntry, type StocktakeSummaryItem } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { BarChart2, X, Flag } from 'lucide-react'
import { apiClient } from '@/api/client'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { useStocktakeSummary } from '@/api/hooks'

// ─── Detail panel ─────────────────────────────────────────────

function DetailPanel({ item, onClose }: { item: StocktakeSummaryItem; onClose: () => void }) {
  const unflag = useUnflagEntry()

  const todayVN    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const todayStart = new Date(`${todayVN}T00:00:00+07:00`).toISOString()

  const { data: entries = [], isFetching } = useQuery({
    queryKey: ['stocktake-loc-entries', item.location_id],
    queryFn: async () => {
      const { data } = await apiClient.get('/wms/inventory', {
        params: { locationFilter: item.location_id, limit: 300 },
      })
      return ((data.data?.entries ?? data.data ?? []) as any[])
    },
  })

  const flagged   = entries.filter((e: any) => e.stocktake_flagged)
  const checked   = entries.filter((e: any) => !e.stocktake_flagged &&
    ((e.stocktake_at && e.stocktake_at >= todayStart) || e.import_date === todayVN))
  const unchecked = entries.filter((e: any) => !e.stocktake_flagged &&
    !(e.stocktake_at && e.stocktake_at >= todayStart) && e.import_date !== todayVN)

  return (
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <div>
          <p className="text-xs font-semibold text-slate-700">{item.location_code}</p>
          <p className="text-[10px] text-slate-400">{item.warehouse_name}</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-2 space-y-3 flex-1 overflow-y-auto">
        {isFetching && <p className="text-slate-400 text-center py-4 text-xs">Đang tải…</p>}

        {/* Flagged */}
        {flagged.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-red-600 mb-1 flex items-center gap-1">
              <Flag className="h-3 w-3" /> Đã đánh dấu ({flagged.length})
            </p>
            {flagged.map((e: any) => (
              <div key={e.id} className="border border-red-100 bg-red-50 rounded px-2 py-1.5 mb-1 space-y-0.5">
                <p className="font-mono text-[10px] font-semibold text-slate-700">{e.pallet_code}</p>
                {e.stocktake_flag_note && (
                  <p className="text-[10px] text-red-600">{e.stocktake_flag_note}</p>
                )}
                {e.stocktake_at && (
                  <p className="text-[10px] text-slate-400">
                    {formatTimestampDate(e.stocktake_at, true)} {formatTimestampTime(e.stocktake_at)}
                  </p>
                )}
                <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 mt-0.5"
                  disabled={unflag.isPending}
                  onClick={() => unflag.mutate(e.id)}>
                  Bỏ đánh dấu
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Unchecked */}
        {unchecked.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-slate-500 mb-1">Chưa kiểm hôm nay ({unchecked.length})</p>
            {unchecked.map((e: any) => (
              <div key={e.id} className="border rounded px-2 py-1 mb-0.5">
                <p className="font-mono text-[10px] font-semibold text-slate-700">{e.pallet_code}</p>
                <p className="text-[10px] text-slate-400">{e.material?.short_name ?? e.material?.material_code ?? '—'}</p>
                {e.stocktake_at && (
                  <p className="text-[10px] text-slate-300">
                    Lần cuối: {formatTimestampDate(e.stocktake_at, true)} {formatTimestampTime(e.stocktake_at)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Checked */}
        {checked.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-green-600 mb-1">Đã kiểm hôm nay ({checked.length})</p>
            {checked.map((e: any) => (
              <div key={e.id} className="border border-green-100 rounded px-2 py-1 mb-0.5">
                <p className="font-mono text-[10px] font-semibold text-slate-700">{e.pallet_code}</p>
                <p className="text-[10px] text-green-600">
                  {e.import_date === todayVN
                    ? 'Mới nhập hôm nay'
                    : `${formatTimestampDate(e.stocktake_at, true)} ${formatTimestampTime(e.stocktake_at)}`
                  }
                </p>
              </div>
            ))}
          </div>
        )}

        {!isFetching && entries.length === 0 && (
          <p className="text-slate-400 text-center py-4 text-xs">Không có pallet</p>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function StocktakeDashboard() {
  const user = useAuthStore(s => s.user)
  const [warehouseId,   setWarehouseId]   = useState(user?.warehouse_id ?? '')
  const [category,      setCategory]      = useState('')
  const [stocktakeOnly, setStocktakeOnly] = useState(true)
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null)

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: categories = [] } = useMaterialCategories()
  const { data: summary    = [] } = useStocktakeSummary({
    warehouse_id:            warehouseId || undefined,
    category:                category    || undefined,
    requires_stocktake_only: stocktakeOnly,
  })

  const items       = summary as StocktakeSummaryItem[]
  const selectedItem = items.find(i => i.location_id === selectedLocId) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        <div className="flex items-center gap-1.5">
          <BarChart2 className="h-4 w-4 text-blue-600 shrink-0" />
          <p className="text-sm font-semibold text-slate-700">Tổng hợp kiểm kê</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Select value={warehouseId || '__none__'} onValueChange={v => setWarehouseId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue placeholder="Kho…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Tất cả kho</SelectItem>
              {(warehouses as any[]).map((w: any) => (
                <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category || '__all__'} onValueChange={v => setCategory(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue placeholder="Loại…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="text-xs">Tất cả</SelectItem>
              {(categories as string[]).map(c => (
                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={stocktakeOnly} onChange={e => setStocktakeOnly(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer" />
            <span className="text-xs text-slate-600">Chỉ vị trí cần check</span>
          </label>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[9px] px-2 py-1.5">Vị trí</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5">Kho</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5 text-right">Tổng</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5 text-right">Đã kiểm</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5 text-right">Chưa kiểm</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5 text-right">Cờ ⚑</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-slate-400 py-8">
                      Không có dữ liệu
                    </TableCell>
                  </TableRow>
                ) : items.map(item => (
                  <TableRow
                    key={item.location_id}
                    className={`cursor-pointer transition-colors ${
                      item.location_id === selectedLocId
                        ? 'bg-blue-50 hover:bg-blue-100'
                        : item.flagged > 0
                          ? 'bg-red-50 hover:bg-red-100'
                          : item.unchecked === 0 && item.total > 0
                            ? 'bg-green-50 hover:bg-green-100'
                            : 'hover:bg-slate-50'
                    }`}
                    onClick={() => setSelectedLocId(prev => prev === item.location_id ? null : item.location_id)}
                  >
                    <TableCell className="px-2 py-1">
                      <span className="text-[10px] font-mono font-semibold">{item.location_code}</span>
                      {item.requires_stocktake && (
                        <span className="ml-1 text-[9px] bg-blue-100 text-blue-600 px-1 rounded">Daily</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <span className="text-[10px] text-slate-500">{item.warehouse_name}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right">
                      <span className="text-[10px] tabular-nums">{item.total}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right">
                      <span className={`text-[10px] tabular-nums font-semibold ${item.checked > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                        {item.checked}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right">
                      <span className={`text-[10px] tabular-nums font-semibold ${item.unchecked > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {item.unchecked}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right">
                      {item.flagged > 0 ? (
                        <span className="text-[10px] tabular-nums font-semibold text-red-600">{item.flagged}</span>
                      ) : (
                        <span className="text-[10px] text-slate-300">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {selectedItem && (
          <DetailPanel item={selectedItem} onClose={() => setSelectedLocId(null)} />
        )}
      </div>
    </div>
  )
}
