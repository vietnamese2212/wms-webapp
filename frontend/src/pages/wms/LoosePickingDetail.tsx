import { useParams, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  ArrowLeft, Package, ChevronRight, QrCode, Scissors, Truck,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useGDO } from '@/api/hooks'
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

// ─── Progress bar ──────────────────────────────────────────────

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

// ─── Row color by loose picking status ────────────────────────

function itemTextCls(item: OutboundItem): string {
  const looseDone = Math.min(item.cartons_scanned, item.loose_picking)
  if (looseDone >= item.loose_picking) return 'text-blue-700'
  if (item.cartons_scanned > 0) return 'text-amber-700'
  return 'text-slate-400'
}

function itemRowBg(item: OutboundItem): string {
  const looseDone = Math.min(item.cartons_scanned, item.loose_picking)
  if (looseDone >= item.loose_picking) return 'bg-blue-50 hover:bg-blue-100'
  if (item.cartons_scanned > 0) return 'bg-amber-50 hover:bg-amber-100'
  return 'hover:bg-slate-50'
}

// ─── Items table ───────────────────────────────────────────────

function ItemsTable({ doRecords, gdoId }: {
  doRecords: OutboundDelivery[]
  gdoId: string
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
          const looseDone = Math.min(item.cartons_scanned, item.loose_picking)
          const isDone    = looseDone >= item.loose_picking
          const textCls   = itemTextCls(item)
          const rowBg     = itemRowBg(item)
          const matCode   = item.material?.material_code ?? item.material_code_raw ?? '—'
          const matName   = item.material?.short_name ?? item.material_code_raw ?? '—'

          return (
            <TableRow
              key={item.id}
              className={`cursor-pointer transition-colors ${rowBg}`}
              onClick={() => navigate(`/wms/loosepicking/${gdoId}/items/${item.id}`)}
            >
              <TableCell className="px-2 py-1 align-top whitespace-nowrap">
                <div className={`text-[10px] font-mono font-semibold ${textCls}`}>{matCode}</div>
              </TableCell>
              <TableCell className="px-2 py-1 align-top">
                <div className={`text-[10px] font-medium leading-tight ${textCls}`}>{matName}</div>
                <ProgressBar compact scanned={looseDone} target={item.loose_picking} />
              </TableCell>
              <TableCell className="px-2 py-1 align-top text-right whitespace-nowrap">
                <div className="flex flex-col items-end gap-0.5">
                  <span className={`text-[10px] tabular-nums ${textCls}`}>
                    <span className="font-semibold">{item.loose_picking}</span>
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
                <ChevronRight className="h-3 w-3 text-slate-300" />
              </TableCell>
            </TableRow>
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

  const { data: gdo, isLoading } = useGDO(id)

  if (isLoading || !gdo) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>
    )
  }

  const allDOs        = gdo.delivery_orders ?? []
  const allLooseItems = allDOs.flatMap(d => d.items.filter(i => i.loose_picking > 0))
  const totalLoose    = allLooseItems.reduce((s, i) => s + i.loose_picking, 0)
  const totalLooseDone = allLooseItems.reduce((s, i) => s + Math.min(i.cartons_scanned, i.loose_picking), 0)

  const npp = [...new Set(allDOs.map(d => d.distributor_name).filter(Boolean))].join(', ')

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Header ── */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '22vh' }}>

        {/* Row 1: back + icon + code + status */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => navigate('/wms/loosepicking')}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Scissors className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="font-mono font-semibold text-sm">{gdo.group_code}</span>
          <Badge status={gdo.status} />
        </div>

        {/* Row 2: delivery info */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
          <span className="flex items-center gap-1">
            <Truck className="h-3 w-3 text-slate-400 shrink-0" />
            <span className="font-medium">{format(parseISO(gdo.delivery_date), 'dd-MM-yy', { locale: vi })}</span>
          </span>
          {npp && <span className="text-slate-500 break-words">{npp}</span>}
          <span className="flex items-center gap-1">
            <Package className="h-3 w-3 text-slate-400 shrink-0" />
            Nhặt lẻ <span className="font-medium ml-1">{totalLooseDone}/{totalLoose}</span>
            <span className="text-slate-400 ml-0.5">thùng</span>
          </span>
        </div>

        <ProgressBar scanned={totalLooseDone} target={totalLoose} />
      </div>

      {/* ── Items table ── */}
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <ItemsTable doRecords={allDOs} gdoId={id!} />
      </div>
    </div>
  )
}
