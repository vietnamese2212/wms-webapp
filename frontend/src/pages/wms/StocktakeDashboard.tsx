import { useState } from 'react'
import {
  useWarehouses, useMaterialCategories, useLocationsReal,
  useUnflagEntry, useStocktakeEntries, type StocktakeEntryRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { BarChart2, Flag, MapPin, X } from 'lucide-react'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'

type View = 'problem' | 'flagged' | 'unchecked' | 'checked' | 'all'

function parseDiff(note: string | null): { actual: number; app: number; diff: number } | null {
  if (!note) return null
  const m = note.match(/Thực tế:\s*(\d+)\s*\/\s*App:\s*(\d+)/)
  if (!m) return null
  const actual = parseInt(m[1]), app = parseInt(m[2])
  return { actual, app, diff: actual - app }
}

function isCheckedToday(e: StocktakeEntryRow, todayVN: string, todayStart: string): boolean {
  return !!(e.stocktake_at && e.stocktake_at >= todayStart) || e.import_date === todayVN
}

// ─── Stat Card ───────────────────────────────────────────────────
function StatCard({
  label, value, sub, active, color, onClick,
}: {
  label: string; value: number; sub?: string
  active: boolean; color: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-0 rounded-xl border px-3 py-2.5 text-left transition-all
        ${active ? `${color} shadow-sm` : 'bg-white border-slate-200 hover:bg-slate-50'}`}
    >
      <p className={`text-[10px] font-medium truncate ${active ? 'opacity-80' : 'text-slate-500'}`}>{label}</p>
      <p className={`text-xl font-bold tabular-nums leading-tight ${active ? '' : 'text-slate-800'}`}>{value}</p>
      {sub && <p className={`text-[9px] mt-0.5 ${active ? 'opacity-70' : 'text-slate-400'}`}>{sub}</p>}
    </button>
  )
}

// ─── Main ────────────────────────────────────────────────────────
export default function StocktakeDashboard() {
  const user = useAuthStore(s => s.user)

  const [warehouseId,  setWarehouseId]  = useState(user?.warehouse_id ?? '')
  const [category,     setCategory]     = useState('')
  const [locationId,   setLocationId]   = useState('')
  const [requiresOnly, setRequiresOnly] = useState(false)
  const [view,         setView]         = useState<View>('problem')

  const unflag = useUnflagEntry()
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: categories = [] } = useMaterialCategories()
  const { data: locations  = [] } = useLocationsReal(
    warehouseId ? { warehouse_id: warehouseId, category: category || undefined } : undefined
  )

  const filteredLocations = requiresOnly
    ? (locations as any[]).filter((l: any) => l.requires_stocktake)
    : (locations as any[])

  const { data, isFetching } = useStocktakeEntries(
    { location_id: locationId, view },
    !!locationId,
  )

  const stats   = data?.stats   ?? { total: 0, checked: 0, unchecked: 0, flagged: 0 }
  const entries = data?.entries ?? []

  const todayVN    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const todayStart = new Date(`${todayVN}T00:00:00+07:00`).toISOString()

  function rowColor(e: StocktakeEntryRow): string {
    if (e.stocktake_flagged)                        return 'bg-red-50 hover:bg-red-100'
    if (isCheckedToday(e, todayVN, todayStart))     return 'bg-green-50 hover:bg-green-100'
    return 'hover:bg-slate-50'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2">
        <div className="flex items-center gap-1.5">
          <BarChart2 className="h-4 w-4 text-blue-600 shrink-0" />
          <p className="text-sm font-semibold text-slate-700">Tổng hợp kiểm kê</p>
        </div>

        <div className="flex gap-1.5 flex-wrap items-center">
          {/* Kho */}
          <Select value={warehouseId || '__none__'} onValueChange={v => {
            setWarehouseId(v === '__none__' ? '' : v)
            setLocationId('')
          }}>
            <SelectTrigger className="h-7 text-xs w-[110px]"><SelectValue placeholder="Kho…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Tất cả kho</SelectItem>
              {(warehouses as any[]).map((w: any) => (
                <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Loại */}
          <Select value={category || '__all__'} onValueChange={v => {
            setCategory(v === '__all__' ? '' : v)
            setLocationId('')
          }}>
            <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue placeholder="Loại…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__" className="text-xs">Tất cả</SelectItem>
              {(categories as string[]).map(c => (
                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Vị trí */}
          <Select value={locationId || '__none__'} onValueChange={v => {
            setLocationId(v === '__none__' ? '' : v)
            setView('problem')
          }} disabled={!warehouseId}>
            <SelectTrigger className="h-7 text-xs w-[130px]"><SelectValue placeholder="Vị trí…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Chọn vị trí…</SelectItem>
              {filteredLocations.map((l: any) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  {l.location_code}{l.requires_stocktake ? ' 🚩' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Cần check hàng ngày */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={requiresOnly} onChange={e => {
              setRequiresOnly(e.target.checked)
              setLocationId('')
            }} className="h-3.5 w-3.5 cursor-pointer" />
            <span className="text-xs text-slate-600 flex items-center gap-1">
              <Flag className="h-3 w-3 text-red-500" /> Chỉ vị trí cần check
            </span>
          </label>
        </div>

        {/* Stat cards — chỉ hiện khi đã chọn vị trí */}
        {locationId && (
          <div className="flex gap-1.5">
            <StatCard
              label="Tổng Pallet" value={stats.total}
              active={view === 'all'} color="bg-slate-100 text-slate-700 border-slate-300"
              onClick={() => setView('all')}
            />
            <StatCard
              label="Đã kiểm" value={stats.checked} sub="hôm nay"
              active={view === 'checked'} color="bg-green-100 text-green-700 border-green-300"
              onClick={() => setView('checked')}
            />
            <StatCard
              label="Chưa kiểm" value={stats.unchecked}
              active={view === 'unchecked'} color="bg-amber-100 text-amber-700 border-amber-300"
              onClick={() => setView('unchecked')}
            />
            <StatCard
              label="Chênh lệch" value={stats.flagged}
              active={view === 'flagged'} color="bg-red-100 text-red-700 border-red-300"
              onClick={() => setView('flagged')}
            />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!locationId ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400">
            <MapPin className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">Chọn vị trí để xem tổng hợp</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[9px] px-2 py-1.5">Pallet</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5">Vật tư</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5 text-right">Tồn</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5">Trạng thái</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5 text-right">TT / App</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5 text-right">Chênh</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5">Kiểm lúc</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5">Người kiểm</TableHead>
                  <TableHead className="text-[9px] px-2 py-1.5"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isFetching && entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-xs text-slate-400 py-8">Đang tải…</TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-xs text-slate-400 py-8">
                      {view === 'problem' ? 'Không có pallet cần xử lý 🎉' : 'Không có dữ liệu'}
                    </TableCell>
                  </TableRow>
                ) : entries.map(e => {
                  const diff    = parseDiff(e.stocktake_flag_note)
                  const checked = isCheckedToday(e, todayVN, todayStart)
                  return (
                    <TableRow key={e.id} className={`transition-colors ${rowColor(e)}`}>
                      <TableCell className="px-2 py-1">
                        <span className="font-mono text-[10px] font-semibold">{e.pallet_code}</span>
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        <span className="text-[10px] text-slate-600">
                          {e.material?.short_name ?? e.material?.material_code ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        <span className="text-[10px] font-semibold tabular-nums">{e.cartons_remaining}</span>
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        {e.stocktake_flagged ? (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5">
                            <Flag className="h-2.5 w-2.5" /> Chênh lệch
                          </span>
                        ) : checked ? (
                          <span className="text-[9px] font-semibold text-green-600 bg-green-100 rounded-full px-1.5 py-0.5">
                            Đã kiểm
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5">
                            Chưa kiểm
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        {diff ? (
                          <span className="text-[10px] tabular-nums text-slate-600">
                            {diff.actual} / {diff.app}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1 text-right">
                        {diff ? (
                          <span className={`text-[10px] font-semibold tabular-nums ${diff.diff < 0 ? 'text-red-600' : diff.diff > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                            {diff.diff > 0 ? '+' : ''}{diff.diff}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1 whitespace-nowrap">
                        {e.stocktake_at ? (
                          <span className="text-[10px] text-slate-500">
                            {formatTimestampDate(e.stocktake_at, true)} {formatTimestampTime(e.stocktake_at)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        <span className="text-[10px] text-slate-500">
                          {e.stocktake_by_emp?.name ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-1">
                        {e.stocktake_flagged && (
                          <Button
                            size="sm" variant="outline"
                            className="h-5 text-[9px] px-1.5 border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-0.5"
                            disabled={unflag.isPending}
                            onClick={() => unflag.mutate(e.id)}
                          >
                            <X className="h-2.5 w-2.5" /> Bỏ cờ
                          </Button>
                        )}
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
