import { useState } from 'react'
import {
  useWarehouses, useMaterialCategories, useUnflagEntry,
  useStocktakeEntries, type StocktakeEntryRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { BarChart2, Flag, X } from 'lucide-react'
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
        ${active ? `${color} border-current/30 shadow-sm` : 'bg-white border-slate-200 hover:bg-slate-50'}`}
    >
      <p className={`text-[10px] font-medium ${active ? 'opacity-80' : 'text-slate-500'}`}>{label}</p>
      <p className={`text-xl font-bold tabular-nums leading-tight ${active ? '' : 'text-slate-800'}`}>{value}</p>
      {sub && <p className={`text-[9px] mt-0.5 ${active ? 'opacity-70' : 'text-slate-400'}`}>{sub}</p>}
    </button>
  )
}

// ─── Main ────────────────────────────────────────────────────────
export default function StocktakeDashboard() {
  const user = useAuthStore(s => s.user)
  const [warehouseId, setWarehouseId] = useState(user?.warehouse_id ?? '')
  const [category,    setCategory]    = useState('')
  const [view,        setView]        = useState<View>('problem')

  const unflag = useUnflagEntry()
  const { data: warehouses = [] } = useWarehouses(true)
  const { data: categories = [] } = useMaterialCategories()

  const { data, isFetching } = useStocktakeEntries({
    warehouse_id: warehouseId || undefined,
    category:     category    || undefined,
    view,
  })

  const stats   = data?.stats   ?? { total: 0, checked: 0, unchecked: 0, flagged: 0 }
  const entries = data?.entries ?? []

  const todayVN    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const todayStart = new Date(`${todayVN}T00:00:00+07:00`).toISOString()

  function rowColor(e: StocktakeEntryRow): string {
    if (e.stocktake_flagged) return 'bg-red-50 hover:bg-red-100'
    if (isCheckedToday(e, todayVN, todayStart)) return 'bg-green-50 hover:bg-green-100'
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
        </div>

        {/* Stat cards — click to filter */}
        <div className="flex gap-1.5">
          <StatCard
            label="Tổng Pallet" value={stats.total}
            active={view === 'all'} color="bg-slate-100 text-slate-700"
            onClick={() => setView('all')}
          />
          <StatCard
            label="Đã kiểm" value={stats.checked} sub="hôm nay"
            active={view === 'checked'} color="bg-green-100 text-green-700"
            onClick={() => setView('checked')}
          />
          <StatCard
            label="Chưa kiểm" value={stats.unchecked}
            active={view === 'unchecked'} color="bg-amber-100 text-amber-700"
            onClick={() => setView('unchecked')}
          />
          <StatCard
            label="Chênh lệch" value={stats.flagged}
            active={view === 'flagged'} color="bg-red-100 text-red-700"
            onClick={() => setView('flagged')}
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <div className="overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] px-2 py-1.5">Pallet</TableHead>
                <TableHead className="text-[9px] px-2 py-1.5">Vật tư</TableHead>
                <TableHead className="text-[9px] px-2 py-1.5">Vị trí</TableHead>
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
                  <TableCell colSpan={10} className="text-center text-xs text-slate-400 py-8">Đang tải…</TableCell>
                </TableRow>
              ) : entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-xs text-slate-400 py-8">Không có dữ liệu</TableCell>
                </TableRow>
              ) : entries.map(e => {
                const diff   = parseDiff(e.stocktake_flag_note)
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
                    <TableCell className="px-2 py-1">
                      <span className="font-mono text-[10px] font-semibold text-slate-700">
                        {e.location?.location_code ?? '—'}
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
      </div>
    </div>
  )
}
