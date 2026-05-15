import { useState, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  ArrowLeft, Package, ChevronRight, ChevronDown, QrCode, Scissors, Truck,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useGDO } from '@/api/hooks'
import { useActiveLoosePickingStore } from '@/stores/activeLoosePickingStore'
import type { OutboundItem, OutboundDelivery, OutboundStatus } from '@/types'

// ─── Status badge ──────────────────────────────────────────────

const statusCls: Record<OutboundStatus, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED:   'bg-green-100 text-green-800',
  CANCELLED:   'bg-red-100 text-red-600',
  PAUSED:      'bg-red-100 text-red-700',
}
const statusLabel: Record<OutboundStatus, string> = {
  PENDING: 'Chờ xuất', IN_PROGRESS: 'Đang xuất', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy', PAUSED: 'Tạm dừng',
}
function Badge({ status }: { status: string }) {
  const s = status as OutboundStatus
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {statusLabel[s] ?? status}
    </span>
  )
}

function ProgressBar({ scanned, target, compact = false }: { scanned: number; target: number; compact?: boolean }) {
  const pct = target > 0 ? Math.min(100, (scanned / target) * 100) : 0
  const cls = pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-200'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`${compact ? 'text-xs' : 'text-lg'} tabular-nums font-medium ${pct >= 100 ? 'text-green-700 font-semibold' : 'text-slate-600'}`}>
        {scanned}/{target}
      </span>
    </div>
  )
}

function itemLooseProgress(item: OutboundItem) {
  const looseScanned = (item.scan_entries ?? [])
    .filter(s => s.is_loose_picking)
    .reduce((sum, s) => sum + Number(s.cartons_scanned), 0)
  const ov       = Math.max(0, (item.cartons_scanned - looseScanned) - (item.cartons_ordered - item.loose_picking))
  const effective = Math.max(0, item.loose_picking - ov)
  const done      = Math.min(looseScanned, effective)
  return { effective, done, remaining: Math.max(0, effective - done), looseScanned }
}

// ─── Items table ───────────────────────────────────────────────

function ItemsTable({ doRecords, gdoId, expandedItemIds, toggleExpand }: {
  doRecords: OutboundDelivery[]
  gdoId: string
  expandedItemIds: Set<string>
  toggleExpand: (id: string) => void
}) {
  const navigate = useNavigate()
  const allItems = doRecords.flatMap(d =>
    d.items
      .filter(i => i.loose_picking > 0)
      .map(i => ({ ...i, delivery_code: d.delivery_code, distributor_name: d.distributor_name }))
  )

  if (allItems.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
        <Scissors className="h-10 w-10 opacity-30" />
        <p className="text-sm">Không có mặt hàng nhặt lẻ</p>
      </div>
    )
  }

  return (
    <Table className="min-w-full">
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
          <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên hàng</TableHead>
          <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Lẻ / Tổng</TableHead>
          <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Số DO</TableHead>
          <TableHead className="w-5 px-1 py-1.5" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {allItems.map(item => {
          const { effective, done: looseDone, looseScanned } = itemLooseProgress(item)
          const isDone   = looseDone >= effective
          const textCls  = isDone ? 'text-blue-700' : looseScanned > 0 ? 'text-amber-700' : 'text-slate-400'
          const bgCls    = isDone ? 'bg-blue-50 hover:bg-blue-100' : looseScanned > 0 ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50'
          const matCode  = item.material?.material_code ?? item.material_code_raw ?? '—'
          const matName  = item.material?.short_name ?? item.material_code_raw ?? '—'
          const looseScanEntries = (item.scan_entries ?? []).filter(s => s.is_loose_picking)
          const expanded = expandedItemIds.has(item.id)

          return (
            <Fragment key={item.id}>
              <TableRow
                className={`cursor-pointer transition-colors ${bgCls}`}
                onClick={() => navigate(`/wms/loosepicking/${gdoId}/items/${item.id}`)}
              >
                <TableCell className="px-2 py-1 align-top whitespace-nowrap">
                  <div className={`text-[10px] font-mono font-semibold ${textCls}`}>{matCode}</div>
                </TableCell>
                <TableCell className="px-2 py-1 align-top">
                  <div className={`text-[10px] font-medium leading-tight ${textCls}`}>{matName}</div>
                  <ProgressBar compact scanned={looseDone} target={effective} />
                  {looseScanEntries.length > 0 && (
                    <div className="text-[9px] text-slate-400 mt-0.5">{looseScanEntries.length} pallet đã quét</div>
                  )}
                </TableCell>
                <TableCell className="px-2 py-1 align-top text-right whitespace-nowrap">
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={`text-[10px] tabular-nums ${textCls}`}>
                      <span className="font-semibold">{effective}</span>
                      <span className="text-slate-400"> / {item.cartons_ordered}</span>
                    </span>
                    {!isDone && (
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/wms/loosepicking/${gdoId}/items/${item.id}?scan=1`) }}
                        className="flex items-center gap-0.5 text-[9px] font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded px-1.5 py-0.5 transition-colors"
                      >
                        <QrCode className="h-2.5 w-2.5" /> Quét
                      </button>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-2 py-1 align-top whitespace-nowrap">
                  <span className="text-[10px] text-slate-500 font-mono">{item.delivery_code}</span>
                </TableCell>
                <TableCell className="px-1 py-1 align-top">
                  {looseScanEntries.length > 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); toggleExpand(item.id) }}
                      className="p-0.5 rounded text-slate-300 hover:text-slate-600 transition-colors"
                      title={expanded ? 'Thu gọn' : 'Xem pallet đã quét'}
                    >
                      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                  )}
                </TableCell>
              </TableRow>

              {expanded && (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="px-0 py-0 border-b border-slate-100" />
                  <TableCell colSpan={4} className="px-0 py-0 border-b border-slate-100">
                    <div className="pl-3 pr-3 py-1.5 border-l-2 border-slate-200">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th className="text-left text-[9px] text-slate-400 font-medium pb-0.5 pr-3">Mã pallet</th>
                            <th className="text-right text-[9px] text-slate-400 font-medium pb-0.5 pr-3">Thùng</th>
                            <th className="text-left text-[9px] text-slate-400 font-medium pb-0.5 pr-3">NSX</th>
                            <th className="text-left text-[9px] text-slate-400 font-medium pb-0.5">Date cũ nhất</th>
                          </tr>
                        </thead>
                        <tbody>
                          {looseScanEntries.map(se => {
                            const isSubOptimal = !!(se.best_available_date && se.production_date && se.production_date > se.best_available_date)
                            const fmtDate = (d: string) => { try { return format(parseISO(d), 'dd-MM-yyyy') } catch { return d } }
                            return (
                              <tr key={se.id}>
                                <td className="pr-3 py-0.5">
                                  <span className={`font-mono text-[10px] font-semibold ${isSubOptimal ? 'text-red-600' : 'text-slate-400'}`}>
                                    {se.pallet_code}
                                  </span>
                                </td>
                                <td className="pr-3 py-0.5 text-right">
                                  <span className="text-[10px] tabular-nums text-slate-400">{se.cartons_scanned}<span className="text-slate-300 ml-0.5">th</span></span>
                                </td>
                                <td className="pr-3 py-0.5">
                                  <span className="text-[10px] font-mono text-slate-400">{se.production_date ? fmtDate(se.production_date) : '—'}</span>
                                </td>
                                <td className="py-0.5">
                                  {se.best_available_date ? (
                                    <span className={`text-[10px] font-mono ${isSubOptimal ? 'text-orange-600 font-semibold' : 'text-slate-300'}`}>
                                      {isSubOptimal ? '⚠ ' : ''}{fmtDate(se.best_available_date)}
                                    </span>
                                  ) : <span className="text-[10px] text-slate-300">—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function LoosePickingDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { vehicles } = useActiveLoosePickingStore()

  const { data: gdo, isLoading } = useGDO(id)
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set())

  function toggleExpand(itemId: string) {
    setExpandedItemIds(prev => { const n = new Set(prev); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n })
  }

  if (isLoading || !gdo) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>
    )
  }

  const allDOs        = gdo.delivery_orders ?? []
  const allLooseItems = allDOs.flatMap(d => d.items.filter(i => i.loose_picking > 0))
  const totalLoose    = allLooseItems.reduce((s, i) => s + itemLooseProgress(i).effective, 0)
  const totalLooseDone = allLooseItems.reduce((s, i) => s + itemLooseProgress(i).done, 0)

  const npp  = [...new Set(allDOs.map(d => d.distributor_name).filter(Boolean))].join(', ')

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Header ── */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '22vh' }}>

        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate('/wms/loosepicking')}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Scissors className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="font-mono font-semibold text-sm">{gdo.group_code}</span>
          <Badge status={gdo.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
          <span className="flex items-center gap-1">
            <Truck className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="font-medium">{format(parseISO(gdo.delivery_date), 'dd-MM-yy', { locale: vi })}</span>
          </span>
          {gdo.dvvt && (
            <span className="text-slate-500">{gdo.dvvt}</span>
          )}
          {npp && <span className="text-slate-500 break-words">{npp}</span>}
          <span className="flex items-center gap-1">
            <Package className="h-3 w-3 text-slate-400 shrink-0" />
            Nhặt lẻ <span className="font-medium ml-1">{totalLooseDone}/{totalLoose}</span>
            <span className="text-slate-400 ml-0.5">thùng</span>
          </span>
        </div>

        <ProgressBar scanned={totalLooseDone} target={totalLoose} />
      </div>

      {/* ── Quick-switch bar ── */}
      {vehicles.length > 0 && (
        <div className="border-b bg-white px-4 py-1.5 shrink-0 flex flex-wrap items-center gap-1">
          <span className="text-[9px] text-slate-400 shrink-0">Đang làm:</span>
          {vehicles.map(v => (
            <button
              key={v.id}
              onClick={() => navigate(`/wms/loosepicking/${v.id}`)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap border transition-colors ${
                v.id === id
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                v.status === 'IN_PROGRESS' ? 'bg-amber-500'
                : v.status === 'COMPLETED'  ? 'bg-green-500'
                : v.status === 'PAUSED'     ? 'bg-red-500'
                : 'bg-slate-300'
              }`} />
              {v.group_code}
            </button>
          ))}
        </div>
      )}

      {/* ── Items table ── */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <ItemsTable doRecords={allDOs} gdoId={id!} expandedItemIds={expandedItemIds} toggleExpand={toggleExpand} />
      </div>
    </div>
  )
}
