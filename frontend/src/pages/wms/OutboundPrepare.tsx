import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { ArrowLeft, PackageCheck, MapPin } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useGDOs, useWarehouses, usePrepareBoard } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'

const TODAY = new Date().toISOString().slice(0, 10)

function pctColor(pct: number | null): string {
  if (pct === null) return 'text-slate-400'
  return pct <= 30 ? 'text-red-600' : pct <= 60 ? 'text-amber-600' : 'text-green-700'
}

export default function OutboundPrepare() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const { isPinned } = useActiveVehiclesStore()

  const [date, setDate]               = useState(TODAY)
  const [warehouseId, setWarehouseId] = useState(user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? '')
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [didInit, setDidInit]         = useState(false)

  const { data: warehouses = [] } = useWarehouses(true)
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids) : null

  const { data: gdos = [], isLoading: gdosLoading } = useGDOs({
    warehouse_id: warehouseId || undefined,
    date_from: date || undefined,
    date_to:   date || undefined,
  })

  // Chỉ chọn xe chưa hoàn thành (còn phải chuẩn bị)
  const selectableGdos = useMemo(
    () => gdos.filter(g => g.status !== 'COMPLETED'),
    [gdos])

  // Khởi tạo 1 lần: ưu tiên xe đang đánh dấu (pinned) có trong danh sách
  useEffect(() => {
    if (didInit || gdosLoading) return
    const pinned = selectableGdos.filter(g => isPinned(g.id)).map(g => g.id)
    if (pinned.length) setSelected(new Set(pinned))
    setDidInit(true)
  }, [gdosLoading, didInit, selectableGdos, isPinned])

  // Bỏ chọn xe không còn trong danh sách (đổi ngày/kho)
  useEffect(() => {
    setSelected(prev => {
      const valid = new Set(selectableGdos.map(g => g.id))
      const next = new Set([...prev].filter(id => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [selectableGdos])

  const selectedIds = useMemo(() => [...selected], [selected])
  const { data: board, isFetching } = usePrepareBoard(selectedIds)
  const rows = board?.rows ?? []

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const allSelected = selectableGdos.length > 0 && selected.size === selectableGdos.length
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableGdos.map(g => g.id)))
  }

  const warehouseList = (warehouses as { id: string; name: string }[])
    .filter(w => !allowedWhIds || allowedWhIds.has(w.id))

  return (
    <div className="flex flex-col h-full sm:p-3">
     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Header */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-2 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => navigate('/wms/outbound')}
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 text-xs">
            <ArrowLeft className="h-3.5 w-3.5" /> Xuất kho
          </button>
          <span className="text-sm font-semibold text-slate-700 shrink-0">· Chuẩn bị hàng</span>
          <div className="flex items-center gap-2 ml-auto">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-7 text-xs w-[150px]" />
            <div className="w-[180px]">
              <WarehouseSingleSelect
                warehouses={warehouseList}
                value={warehouseId}
                onChange={setWarehouseId}
                placeholder="Chọn kho…"
                triggerClassName="h-7"
              />
            </div>
          </div>
        </div>

        {/* Chọn số xe cần chuẩn bị */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
              Chọn số xe ({selected.size}/{selectableGdos.length})
            </span>
            {selectableGdos.length > 0 && (
              <button onClick={toggleAll} className="text-[10px] text-blue-600 hover:underline">
                {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
              </button>
            )}
          </div>
          {gdosLoading ? (
            <div className="h-7 rounded bg-slate-100 animate-pulse" />
          ) : selectableGdos.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic">Không có chuyến cần chuẩn bị ({format(parseISO(date), 'dd-MM-yyyy', { locale: vi })})</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selectableGdos.map(g => {
                const on = selected.has(g.id)
                return (
                  <button key={g.id} onClick={() => toggle(g.id)}
                    className={`px-2 py-1 rounded border text-[10px] font-mono font-semibold transition-colors ${
                      on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-blue-300'
                    }`}
                    title={(g.distributor_names ?? []).join(', ')}>
                    {g.group_code}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      <SummaryBand tiles={[
        { label: 'Xe đã chọn', value: selected.size },
        { label: 'Mã hàng cần', value: rows.length },
        { label: 'Pallet cần', value: (board?.total_pallets ?? 0).toLocaleString('vi-VN'), accent: (board?.total_pallets ?? 0) > 0 },
        { label: 'Thùng cần', value: (board?.total_cartons ?? 0).toLocaleString('vi-VN') },
      ]} />

      {/* Bảng chuẩn bị */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {selected.size === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <PackageCheck className="h-10 w-10 opacity-30" />
            <p className="text-sm">Chọn số xe ở trên để xem hàng cần chuẩn bị</p>
          </div>
        ) : isFetching && rows.length === 0 ? (
          <div className="p-4 space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <PackageCheck className="h-10 w-10 opacity-30" />
            <p className="text-sm">Đã chuẩn bị xong — không còn pallet phải lấy</p>
          </div>
        ) : (
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap sticky left-0 z-20 bg-slate-50">Vị trí (FEFO)</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">%Date</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên hàng</TableHead>
                <TableHead className="text-[9px] font-medium text-sky-600 px-2 py-1.5 text-right whitespace-nowrap">Pallet cần</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Còn (thùng)</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Khả dụng</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const sug = r.suggestions[0]
                const short = sug && sug.available < r.cartons_remaining
                return (
                  <TableRow key={r.material_id ?? r.material_code} className="hover:bg-slate-50">
                    <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-white">
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-sky-500 shrink-0" />
                        <span className="text-[10px] font-mono text-slate-700">{sug?.location_code ?? '—'}</span>
                      </div>
                      {r.suggestions[1] && (
                        <div className="text-[9px] font-mono text-slate-400 pl-4">{r.suggestions[1].location_code}</div>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      {sug ? <span className={`text-[10px] font-bold tabular-nums ${pctColor(sug.pct_date)}`}>{sug.pct_date !== null ? `${sug.pct_date}%` : '—'}</span>
                           : <span className="text-[10px] text-slate-300">—</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] font-mono font-semibold text-slate-700">{r.material_code}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1">
                      <span className="text-[10px] text-slate-600">{r.material_name ?? '—'}</span>
                      {r.no_qr_tracking && <span className="text-[9px] text-purple-600 ml-1">(thủ công)</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[12px] font-bold tabular-nums text-sky-700">{r.pallets_remaining || '—'}</span>
                      {r.cartons_per_pallet > 0 && <span className="text-[9px] text-slate-400 ml-0.5">pl</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[10px] font-semibold tabular-nums text-slate-700">{r.cartons_remaining.toLocaleString('vi-VN')}</span>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      {sug ? (
                        <span className={`text-[10px] tabular-nums ${short ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                          {(r.suggestions.reduce((s, x) => s + x.available, 0)).toLocaleString('vi-VN')}
                          {short && <span className="ml-0.5" title="Tồn gợi ý ít hơn số cần">⚠</span>}
                        </span>
                      ) : <span className="text-[10px] text-red-500">hết tồn</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 sm:rounded-b-xl">
        {rows.length > 0 ? `${rows.length} mã hàng · ${(board?.total_pallets ?? 0).toLocaleString('vi-VN')} pallet · ${(board?.total_cartons ?? 0).toLocaleString('vi-VN')} thùng cần chuẩn bị` : '—'}
      </div>
     </div>
    </div>
  )
}
