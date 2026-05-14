import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { CalendarDays, Scissors, X } from 'lucide-react'
import { SearchInput } from '@/components/shared/SearchInput'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLoosePickingItems, useWarehouses, type LoosePickingItem } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// ─── GDO-level summary ────────────────────────────────────────

type GDOSummary = {
  gdo: LoosePickingItem['gdo']
  items: LoosePickingItem[]
  totalLoose: number
  totalLooseDone: number
  pendingCount: number
}

// effective_loose = loose_picking - phần outbound đã "ăn vào" quota nhặt lẻ
function itemLooseStats(i: LoosePickingItem) {
  const ov       = Math.max(0, (i.cartons_scanned - i.loose_scanned) - (i.cartons_ordered - i.loose_picking))
  const effective = Math.max(0, i.loose_picking - ov)
  const done      = Math.min(i.loose_scanned, effective)
  return { effective, done, remaining: Math.max(0, effective - done) }
}

function rowBg(s: GDOSummary): string {
  if (s.totalLoose > 0 && s.totalLooseDone >= s.totalLoose) return 'bg-blue-50 hover:bg-blue-100'
  if (s.totalLooseDone > 0)                                  return 'bg-amber-50 hover:bg-amber-100'
  return 'hover:bg-slate-50'
}

function gdoStatusInfo(gdo: LoosePickingItem['gdo']): { label: string; cls: string } {
  if (!gdo) return { label: '—', cls: 'bg-slate-100 text-slate-400' }
  if (gdo.status === 'COMPLETED')   return { label: 'Hoàn thành', cls: 'bg-blue-100 text-blue-700'   }
  if (gdo.status === 'IN_PROGRESS') return { label: 'Đang xuất',  cls: 'bg-amber-100 text-amber-700' }
  if (gdo.status === 'PAUSED')      return { label: 'Tạm dừng',   cls: 'bg-red-100 text-red-700'     }
  if (gdo.started_at)               return { label: 'Đang xuất',  cls: 'bg-amber-100 text-amber-700' }
  return                                   { label: 'Chờ xe',     cls: 'bg-slate-100 text-slate-500' }
}

function pickingStatusInfo(s: GDOSummary): { label: string; cls: string } {
  if (s.totalLoose === 0)                           return { label: '—',              cls: 'bg-slate-100 text-slate-400' }
  if (s.totalLooseDone >= s.totalLoose)             return { label: 'Xong',           cls: 'bg-blue-100 text-blue-700'   }
  if (s.totalLooseDone > 0)                         return { label: 'Đang chuẩn bị', cls: 'bg-amber-100 text-amber-700' }
  return                                                   { label: 'Chưa chuẩn bị', cls: 'bg-slate-100 text-slate-500' }
}

// ─── Main page ─────────────────────────────────────────────────

export default function LoosePicking() {
  const user     = useAuthStore(s => s.user)
  const navigate = useNavigate()

  const [warehouseId, setWarehouseId] = useState<string>('')
  const [date,        setDate]        = useState<string>(TODAY)
  const [search,      setSearch]      = useState('')

  const { data: warehouses = [] } = useWarehouses(true)

  useEffect(() => {
    if (!warehouseId && user?.warehouse_id) setWarehouseId(user.warehouse_id)
  }, [user?.warehouse_id]) // eslint-disable-line

  const { data: items = [], isLoading } = useLoosePickingItems({
    warehouse_id: warehouseId || undefined,
    date:         date        || undefined,
  })

  // Group by GDO, sort delivery_date asc then group_code
  const grouped = useMemo((): GDOSummary[] => {
    const map = new Map<string, { gdo: LoosePickingItem['gdo']; items: LoosePickingItem[] }>()
    for (const item of items) {
      const key = item.gdo?.id ?? '__unknown__'
      if (!map.has(key)) map.set(key, { gdo: item.gdo, items: [] })
      map.get(key)!.items.push(item)
    }
    return [...map.values()]
      .map(({ gdo, items: gdoItems }) => {
        const totalLoose    = gdoItems.reduce((s, i) => s + itemLooseStats(i).effective, 0)
        const totalLooseDone = gdoItems.reduce((s, i) => s + itemLooseStats(i).done, 0)
        const pendingCount  = gdoItems.filter(i => itemLooseStats(i).remaining > 0).length
        return { gdo, items: gdoItems, totalLoose, totalLooseDone, pendingCount }
      })
      .sort((a, b) => {
        const da = a.gdo?.delivery_date ?? '', db = b.gdo?.delivery_date ?? ''
        if (da !== db) return da.localeCompare(db)
        return (a.gdo?.group_code ?? '').localeCompare(b.gdo?.group_code ?? '')
      })
  }, [items])

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped
    const q = search.trim().toLowerCase()
    return grouped.filter(s =>
      s.gdo?.group_code?.toLowerCase().includes(q) ||
      s.items.some(i =>
        (i.material?.material_code ?? i.material_code_raw ?? '').toLowerCase().includes(q) ||
        (i.material?.short_name ?? '').toLowerCase().includes(q)
      )
    )
  }, [grouped, search])

  const totalPending = items.filter(i => itemLooseStats(i).remaining > 0).length

  const dateLabel = date
    ? format(parseISO(date), 'EEEE, dd-MM-yyyy', { locale: vi })
    : 'Tất cả ngày'

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-2">

        {/* Title */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Scissors className="h-5 w-5 text-slate-500" />
            Nhặt lẻ
          </h1>
          {totalPending > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {totalPending} chưa xong
            </span>
          )}
        </div>

        {/* Date + Search */}
        <div className="flex gap-2">
          <div className="relative flex items-center gap-1.5">
            <CalendarDays className="absolute left-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              type="date"
              className="pl-8 h-8 text-sm w-[160px]"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
            {date && date !== TODAY && (
              <button className="ml-1 text-xs text-slate-400 hover:text-slate-700 underline whitespace-nowrap"
                onClick={() => setDate(TODAY)}>
                Hôm nay
              </button>
            )}
            {date && (
              <button className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                title="Xem tất cả ngày" onClick={() => setDate('')}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm số xe, mã hàng…" className="flex-1" />
        </div>

        {/* Warehouse filter + summary */}
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={warehouseId || '__all__'} onValueChange={v => setWarehouseId(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-7 text-xs w-[130px]">
              <SelectValue placeholder="Kho xuất" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {(warehouses as any[]).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-slate-500 -mt-1">
          {date ? (
            <>
              <span className="font-medium text-slate-700">{dateLabel}</span>
              {date === TODAY && <span className="ml-1.5 text-blue-600 font-medium">· Hôm nay</span>}
            </>
          ) : (
            <span className="italic">Hiển thị tất cả ngày</span>
          )}
          <span className="ml-1.5">— {filtered.length} chuyến xe</span>
        </p>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <Scissors className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {search
                ? 'Không tìm thấy chuyến xe'
                : date
                ? `Không có nhặt lẻ ngày ${format(parseISO(date), 'dd-MM-yyyy')}`
                : 'Không có nhặt lẻ'}
            </p>
          </div>
        ) : (
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Ngày xuất</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Số xe</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Kho xuất</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 text-right whitespace-nowrap px-2 py-1.5">Mặt hàng</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 text-right whitespace-nowrap px-2 py-1.5">Nhặt lẻ</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5 min-w-[80px]">Tiến độ</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">T.T. đơn</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">T.T. nhặt lẻ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(s => {
                const { label: gLabel, cls: gCls } = gdoStatusInfo(s.gdo)
                const { label: pLabel, cls: pCls } = pickingStatusInfo(s)
                const pct      = s.totalLoose > 0 ? Math.min(100, (s.totalLooseDone / s.totalLoose) * 100) : 0
                const dateStr  = s.gdo?.delivery_date
                  ? format(parseISO(s.gdo.delivery_date), 'dd-MM-yy', { locale: vi })
                  : '—'

                return (
                  <TableRow
                    key={s.gdo?.id ?? '__unknown__'}
                    className={`cursor-pointer transition-colors ${rowBg(s)}`}
                    onClick={() => s.gdo?.id && navigate(`/wms/loosepicking/${s.gdo.id}`)}
                  >
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] font-medium tabular-nums">{dateStr}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] font-mono font-semibold">{s.gdo?.group_code ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] text-slate-700">{s.gdo?.warehouse?.name ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[10px] font-semibold tabular-nums">{s.items.length}</span>
                      <span className="text-[9px] text-slate-400 ml-0.5">mặt hàng</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[10px] font-semibold tabular-nums">{s.totalLooseDone}</span>
                      <span className="text-[9px] text-slate-400">/{s.totalLoose}</span>
                      <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[40px]">
                          <div
                            className={`h-full rounded-full transition-all ${
                              pct >= 100 ? 'bg-blue-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[9px] tabular-nums text-slate-500 shrink-0">{Math.round(pct)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${gCls}`}>{gLabel}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${pCls}`}>{pLabel}</span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
