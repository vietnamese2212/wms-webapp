import { useState, useMemo, useEffect, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { ArrowLeft, PackageCheck, MapPin, Plus, X, Search, ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { useGDOs, useWarehouses, usePrepareBoard, useInventoryByMaterial, type ItemInventoryEntry } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { omniMatch } from '@/utils/omniSearch'
import type { GDO } from '@/types'

const TODAY = new Date().toISOString().slice(0, 10)

const PREPARE_COLS: { id: string; label: string; w: number; align?: 'right' }[] = [
  { id: 'loc',     label: 'Vị trí (FEFO)', w: 150 },
  { id: 'code',    label: 'Mã hàng',       w: 110 },
  { id: 'name',    label: 'Tên hàng',      w: 220 },
  { id: 'pallets', label: 'Pallet cần',    w: 90, align: 'right' },
  { id: 'cartons', label: 'Còn (thùng)',   w: 96, align: 'right' },
  { id: 'avail',   label: 'Khả dụng',      w: 96, align: 'right' },
]
const PREPARE_COL_DEFAULTS = PREPARE_COLS.map(c => c.w)

function pctColor(pct: number | null): string {
  if (pct === null) return 'text-slate-400'
  return pct <= 30 ? 'text-red-600' : pct <= 60 ? 'text-amber-600' : 'text-green-700'
}

// ─── Dialog tồn kho theo mã hàng (như search tồn ở xuất bình thường) ──
function InventoryDialog({ materialId, materialCode, materialName, warehouseId, onClose }: {
  materialId: string; materialCode: string; materialName: string; warehouseId: string | undefined; onClose: () => void
}) {
  const { data: inv = [], isLoading } = useInventoryByMaterial(materialId, warehouseId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  type Agg = { key: string; pct_date: number | null; location_code: string | null; is_qa: boolean; cartons: number; entries: ItemInventoryEntry[] }
  const rows: Agg[] = useMemo(() => {
    const map = new Map<string, Agg>()
    for (const e of inv) {
      const q = !!e.qa_status
      const k = `${e.pct_date ?? 'n'}|${e.location_code ?? ''}|${q}`
      const r = map.get(k)
      if (r) { r.cartons += e.available; r.entries.push(e) }
      else map.set(k, { key: k, pct_date: e.pct_date, location_code: e.location_code, is_qa: q, cartons: e.available, entries: [e] })
    }
    return [...map.values()].sort((a, b) => {
      const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
      return pa !== pb ? pa - pb : (a.is_qa ? 1 : -1)
    })
  }, [inv])
  const total = useMemo(() => inv.reduce((s, e) => s + e.available, 0), [inv])

  function toggle(k: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  }

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm sm:max-w-md p-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <DialogTitle className="text-sm font-semibold">
            <span className="font-mono">{materialCode}</span> · {materialName}
          </DialogTitle>
          <p className="text-xs text-slate-500 mt-0.5">Tồn kho theo %Date · lấy thấp trước · {inv.length} pallet · {total.toLocaleString('vi-VN')} thùng</p>
        </DialogHeader>
        <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
          {isLoading ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">Không còn tồn kho trong kho này</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-[9px] font-medium text-slate-500 px-3 py-1.5">%Date</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 px-3 py-1.5">Vị trí</TableHead>
                  <TableHead className="text-[9px] font-medium text-blue-500 px-3 py-1.5 text-right">Khả dụng</TableHead>
                  <TableHead className="w-6 px-2 py-1.5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const open = expanded.has(row.key)
                  return (
                    <Fragment key={row.key}>
                      <TableRow className={`cursor-pointer ${row.is_qa ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-slate-50'}`} onClick={() => toggle(row.key)}>
                        <TableCell className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            {row.pct_date !== null
                              ? <span className={`text-xs font-bold tabular-nums ${pctColor(row.pct_date)}`}>{row.pct_date}%</span>
                              : <span className="text-[10px] text-slate-400">Chưa có</span>}
                            {row.is_qa && <span className="text-[9px] font-medium text-purple-700 bg-purple-100 rounded px-1.5 py-0.5">QA giữ</span>}
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-1.5"><span className="text-[10px] font-mono text-slate-600">{row.location_code ?? '—'}</span></TableCell>
                        <TableCell className="px-3 py-1.5 text-right whitespace-nowrap">
                          <span className={`text-[10px] font-semibold tabular-nums ${row.is_qa ? 'text-purple-700' : ''}`}>{row.cartons.toLocaleString('vi-VN')}</span>
                          <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
                          <div className="text-[9px] text-slate-400">{row.entries.length} pl</div>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-slate-400">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</TableCell>
                      </TableRow>
                      {open && row.entries.map(e => (
                        <TableRow key={e.id} className={row.is_qa ? 'bg-purple-50/60' : 'bg-slate-50'}>
                          <TableCell className="px-3 py-1 pl-7" colSpan={2}><span className="font-mono text-[10px] font-semibold text-slate-600">{e.pallet_code}</span></TableCell>
                          <TableCell className="px-3 py-1 text-right whitespace-nowrap"><span className="text-[10px] font-semibold tabular-nums text-blue-700">{e.available}</span><span className="text-[9px] text-slate-400 ml-0.5">thùng</span></TableCell>
                          <TableCell className="px-2 py-1" />
                        </TableRow>
                      ))}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function OutboundPrepare() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const { isPinned } = useActiveVehiclesStore()

  // Filter (ngày + kho) lưu ở store → nhớ khi rời trang + riêng theo từng user (scopedPersist)
  const prep = useWmsFilterStore(s => s.outboundPrepare)
  const setOutboundPrepare = useWmsFilterStore(s => s.setOutboundPrepare)
  const date = prep.date || TODAY
  const warehouseId = prep.warehouseId
  const setDate = (d: string) => setOutboundPrepare({ date: d })
  const setWarehouseId = (w: string) => setOutboundPrepare({ warehouseId: w })
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [didInit, setDidInit]         = useState(false)
  const [addOpen, setAddOpen]         = useState(false)
  const [addSearch, setAddSearch]     = useState('')
  const [invMat, setInvMat]           = useState<{ id: string; code: string; name: string } | null>(null)

  const { data: warehouses = [] } = useWarehouses(true)
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids) : null

  // Lần đầu chưa có kho trong store → mặc định kho của user
  useEffect(() => {
    if (!warehouseId) {
      const def = user?.warehouse_ids?.[0] ?? user?.warehouse_id ?? ''
      if (def) setOutboundPrepare({ warehouseId: def })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: gdos = [], isLoading: gdosLoading } = useGDOs({
    warehouse_id: warehouseId || undefined,
    date_from: date || undefined,
    date_to:   date || undefined,
  })

  // Xe có thể chuẩn bị: chưa hoàn thành VÀ chưa quét xong (đã xuất xong thì bỏ khỏi danh sách)
  const selectableGdos = useMemo(
    () => gdos.filter(g => g.status !== 'COMPLETED' && !g.scan_completed_at),
    [gdos])

  // Khởi tạo 1 lần: ưu tiên xe đang đánh dấu (pinned)
  useEffect(() => {
    if (didInit || gdosLoading) return
    const pinned = selectableGdos.filter(g => isPinned(g.id)).map(g => g.id)
    if (pinned.length) setSelected(new Set(pinned))
    setDidInit(true)
  }, [gdosLoading, didInit, selectableGdos, isPinned])

  // Bỏ chọn xe không còn hợp lệ (đổi ngày/kho hoặc đã xuất xong)
  useEffect(() => {
    setSelected(prev => {
      const valid = new Set(selectableGdos.map(g => g.id))
      const next = new Set([...prev].filter(id => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [selectableGdos])

  const selectedGdos = useMemo(() => gdos.filter(g => selected.has(g.id)), [gdos, selected])
  const toAdd = useMemo(() => selectableGdos.filter(g => !selected.has(g.id))
    .filter(g => omniMatch([g.group_code, g.export_type, ...(g.distributor_names ?? []), ...(g.delivery_codes ?? [])], addSearch)),
    [selectableGdos, selected, addSearch])

  const selectedIds = useMemo(() => [...selected], [selected])
  const { data: board, isFetching } = usePrepareBoard(selectedIds)
  const rows = board?.rows ?? []
  const { widths: colW, startResize, totalWidth } = useColumnResize('outbound_prepare_col_widths', PREPARE_COL_DEFAULTS)

  function addGdo(id: string) { setSelected(prev => new Set(prev).add(id)) }
  function removeGdo(id: string) { setSelected(prev => { const n = new Set(prev); n.delete(id); return n }) }

  const warehouseList = (warehouses as { id: string; name: string }[])
    .filter(w => !allowedWhIds || allowedWhIds.has(w.id))

  const gdoMeta = (g: GDO) => [
    g.export_type || null,
    (g.distributor_names ?? []).join(', ') || null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col h-full sm:p-3">
     {invMat && (
       <InventoryDialog materialId={invMat.id} materialCode={invMat.code} materialName={invMat.name}
         warehouseId={warehouseId || undefined} onClose={() => setInvMat(null)} />
     )}
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
              <WarehouseSingleSelect warehouses={warehouseList} value={warehouseId} onChange={setWarehouseId} placeholder="Chọn kho…" triggerClassName="h-7" />
            </div>
          </div>
        </div>

        {/* Xe đã chọn + dropdown thêm xe */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Xe đã chọn ({selected.size})</span>
            {/* Dropdown thêm xe */}
            <div className="relative">
              <button onClick={() => setAddOpen(o => !o)}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-dashed border-blue-300 text-[11px] text-blue-600 hover:bg-blue-50">
                <Plus className="h-3.5 w-3.5" /> Thêm xe
                <ChevronDown className={`h-3 w-3 transition-transform ${addOpen ? 'rotate-180' : ''}`} />
              </button>
              {addOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAddOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-[min(300px,calc(100vw-2rem))] bg-white border border-slate-200 rounded-lg shadow-xl">
                    <div className="p-2 border-b">
                      <Input autoFocus value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Tìm số xe, loại xe, NPP…" className="h-7 text-xs" />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {gdosLoading ? (
                        <div className="p-3 text-[11px] text-slate-400">Đang tải…</div>
                      ) : toAdd.length === 0 ? (
                        <div className="p-3 text-[11px] text-slate-400 italic">{selectableGdos.length === 0 ? 'Không có chuyến cần chuẩn bị' : 'Đã chọn hết / không khớp'}</div>
                      ) : toAdd.map(g => (
                        <button key={g.id} onClick={() => { addGdo(g.id); setAddSearch('') }}
                          className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-slate-50 last:border-0">
                          <div className="text-[10px] font-mono font-semibold text-slate-700">{g.group_code}</div>
                          <div className="text-[9px] text-slate-500 truncate">{gdoMeta(g) || '—'}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {selected.size === 0 ? (
            <p className="text-[11px] text-slate-400 italic">Chưa chọn xe — bấm “Thêm xe” để chọn ({format(parseISO(date), 'dd-MM-yyyy', { locale: vi })})</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selectedGdos.map(g => (
                <div key={g.id} className="flex items-start gap-1.5 rounded-lg border border-slate-200 bg-slate-50 pl-2 pr-1 py-1 max-w-[260px]">
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono font-semibold text-slate-700">{g.group_code}</div>
                    <div className="text-[9px] text-slate-500 truncate" title={gdoMeta(g)}>{gdoMeta(g) || '—'}</div>
                  </div>
                  <button onClick={() => removeGdo(g.id)} className="shrink-0 p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" title="Bỏ xe này">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
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
          <Table className="table-fixed [&_td]:overflow-hidden [&_th]:overflow-hidden [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <TableHeader>
              <TableRow className="bg-slate-50">
                {PREPARE_COLS.map((c, i) => (
                  <TableHead key={c.id}
                    style={i === 0 ? { left: 0 } : undefined}
                    className={`text-[9px] font-medium px-2 py-1.5 whitespace-nowrap ${c.id === 'pallets' ? 'text-sky-600' : 'text-slate-500'} ${c.align === 'right' ? 'text-right' : ''} ${i === 0 ? 'sticky z-20 bg-slate-50' : ''}`}>
                    {c.label}
                    {i > 0 && (
                      <span onPointerDown={e => startResize(i, e)} onClick={e => e.stopPropagation()}
                        className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" title="Kéo để chỉnh độ rộng cột" />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const sug = r.suggestions[0]
                const avail = r.suggestions.reduce((s, x) => s + x.available, 0)
                const short = avail < r.cartons_remaining
                return (
                  <TableRow key={r.material_id ?? r.material_code} className="hover:bg-slate-50">
                    <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-white" style={{ left: 0 }}>
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-sky-500 shrink-0" />
                        <span className="text-[10px] font-mono text-slate-700">{sug?.location_code ?? '—'}</span>
                        {r.material_id && (
                          <button onClick={() => setInvMat({ id: r.material_id!, code: r.material_code, name: r.material_name ?? r.material_code })}
                            className="inline-flex items-center justify-center h-5 w-5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0" title="Xem tồn kho">
                            <Search className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {r.suggestions[1] && <div className="text-[9px] font-mono text-slate-400 pl-4">{r.suggestions[1].location_code}</div>}
                    </TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap"><span className="text-[10px] font-mono font-semibold text-slate-700">{r.material_code}</span></TableCell>
                    <TableCell className="px-2 py-1 whitespace-nowrap">
                      <span className="text-[10px] text-slate-600">{r.material_name ?? '—'}</span>
                      {r.no_qr_tracking && <span className="text-[9px] text-purple-600 ml-1">(thủ công)</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="text-[12px] font-bold tabular-nums text-sky-700">{r.pallets_remaining || '—'}</span>
                      {r.cartons_per_pallet > 0 && <span className="text-[9px] text-slate-400 ml-0.5">pl</span>}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap"><span className="text-[10px] font-semibold tabular-nums text-slate-700">{r.cartons_remaining.toLocaleString('vi-VN')}</span></TableCell>
                    <TableCell className="px-2 py-1 text-right whitespace-nowrap">
                      {sug ? (
                        <span className={`text-[10px] tabular-nums ${short ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                          {avail.toLocaleString('vi-VN')}{short && <span className="ml-0.5" title="Tồn gợi ý ít hơn số cần">⚠</span>}
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
