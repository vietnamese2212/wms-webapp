import { useState, useEffect, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  ArrowLeft, Package, ChevronRight, ChevronDown, QrCode, Scissors, Truck, Search, Bookmark, Info,
} from 'lucide-react'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { ResizableTable, type RtColDef } from '@/components/shared/ResizableTable'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useGDO, useItemInventory, useOutboundShortages, useGdoPickSuggestions, type ItemInventoryEntry } from '@/api/hooks'
import { ShortageBadge } from '@/components/shared/ShortageBadge'
import { GdoScanSheet } from '@/components/wms/GdoScanSheet'
import { useActiveLoosePickingStore } from '@/stores/activeLoosePickingStore'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { unlockAudio } from '@/utils/audio'
import { qtyLabel, qtyEntryText, qtyUnitLabel, qtyEntryDecimal, qtySplit, hasEntry, type MatUnits } from '@/utils/qtyUnits'
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
        {scanned.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}/{target.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}
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

// ─── Inventory modal per item ──────────────────────────────────

function InventoryModal({ gdoId, itemId, matCode, matName, mat, onClose }: {
  gdoId: string; itemId: string; matCode: string; matName: string; mat?: MatUnits | null; onClose: () => void
}) {
  const { data: inventoryData = [], isLoading } = useItemInventory(gdoId, itemId)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)

  const sorted = [...inventoryData].sort((a: ItemInventoryEntry, b: ItemInventoryEntry) => {
    if (a.pct_date === null && b.pct_date === null) return 0
    if (a.pct_date === null) return 1
    if (b.pct_date === null) return -1
    return a.pct_date - b.pct_date
  })

  type AggRow = { key: string; pct_date: number | null; location_code: string | null; is_qa: boolean; cartons: number; entries: ItemInventoryEntry[] }
  const aggRows: AggRow[] = (() => {
    const map = new Map<string, AggRow>()
    for (const e of sorted) {
      const q = !!e.qa_status
      const k = `${e.pct_date ?? 'n'}|${e.location_code ?? ''}|${q}`
      const r = map.get(k)
      if (r) { r.cartons += e.cartons_remaining ?? e.cartons_imported ?? 0; r.entries.push(e) }
      else map.set(k, { key: k, pct_date: e.pct_date, location_code: e.location_code, is_qa: q, cartons: e.cartons_remaining ?? e.cartons_imported ?? 0, entries: [e] })
    }
    // Hòa %Date → hàng thường trước QA giữ → vị trí ÍT hàng nhất trước (dọn hàng lẻ) → tên vị trí
    return [...map.values()].sort((a, b) => {
      const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
      if (pa !== pb) return pa - pb
      if (a.is_qa !== b.is_qa) return a.is_qa ? 1 : -1
      if (a.cartons !== b.cartons) return a.cartons - b.cartons
      return (a.location_code ?? '').localeCompare(b.location_code ?? '')
    })
  })()

  function toggle(key: string) {
    setExpandedKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  return (
    <>
      {detailId && <PalletDetailDialog entryId={detailId} onClose={() => setDetailId(null)} />}
      <Dialog open onOpenChange={v => { if (!v) onClose() }}>
        <DialogContent className="max-w-sm sm:max-w-md p-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b">
            <DialogTitle className="text-sm font-semibold">
              <span className="font-mono">{matCode}</span> · {matName}
            </DialogTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Tồn kho theo %Date · lấy thấp trước · {sorted.length} pallet
            </p>
          </DialogHeader>
          <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}
              </div>
            ) : sorted.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-sm">Không còn tồn kho trong kho này</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-[9px] font-medium text-slate-500 px-3 py-1.5">%Date</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-3 py-1.5">Vị trí</TableHead>
                    <TableHead className="text-[9px] font-medium text-slate-500 px-3 py-1.5 text-right">Thùng</TableHead>
                    <TableHead className="w-6 px-2 py-1.5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggRows.map(row => {
                    const expanded = expandedKeys.has(row.key)
                    return (
                      <Fragment key={row.key}>
                        <TableRow
                          className={`cursor-pointer ${row.is_qa ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-slate-50'}`}
                          onClick={() => toggle(row.key)}
                        >
                          <TableCell className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5">
                              {row.pct_date !== null ? (
                                <span className={`text-xs font-bold tabular-nums ${
                                  row.pct_date <= 30 ? 'text-red-600' : row.pct_date <= 60 ? 'text-amber-600' : 'text-green-700'
                                }`}>{row.pct_date}%</span>
                              ) : <span className="text-[10px] text-slate-400">Chưa có</span>}
                              {row.is_qa && (
                                <span className="text-[9px] font-medium text-purple-700 bg-purple-100 rounded px-1.5 py-0.5">QA giữ</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-1.5">
                            <span className="text-[10px] font-mono text-slate-600">{row.location_code ?? '—'}</span>
                          </TableCell>
                          <TableCell className="px-3 py-1.5 text-right whitespace-nowrap">
                            <span className={`text-[10px] font-semibold tabular-nums ${row.is_qa ? 'text-purple-700' : ''}`}>{qtyEntryText(row.cartons, mat)}</span>
                            <span className="text-[9px] text-slate-400 ml-0.5">{qtyUnitLabel(mat)}</span>
                            <div className="text-[9px] text-slate-400">{row.entries.length} pl</div>
                          </TableCell>
                          <TableCell className="px-2 py-1.5 text-slate-400">
                            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          </TableCell>
                        </TableRow>
                        {expanded && row.entries.map(e => (
                          <TableRow key={e.id} className={row.is_qa ? 'bg-purple-50/60' : 'bg-slate-50'}>
                            <TableCell className="px-3 py-1 pl-7" colSpan={2}>
                              <button
                                className="font-mono text-[10px] font-semibold text-blue-600 hover:underline text-left"
                                onClick={ev => { ev.stopPropagation(); setDetailId(e.id) }}
                              >
                                {e.pallet_code}
                              </button>
                            </TableCell>
                            <TableCell className="px-3 py-1 text-right whitespace-nowrap">
                              <span className="text-[10px] font-semibold tabular-nums">{qtyEntryText(e.cartons_remaining ?? e.cartons_imported ?? 0, mat)}</span>
                              <span className="text-[9px] text-slate-400 ml-0.5">{qtyUnitLabel(mat)}</span>
                            </TableCell>
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
    </>
  )
}

// ─── Items table ───────────────────────────────────────────────

function ItemsTable({ doRecords, gdoId, expandedItemIds, toggleExpand, warehouseId, deliveryDate }: {
  doRecords: OutboundDelivery[]
  gdoId: string
  expandedItemIds: Set<string>
  toggleExpand: (id: string) => void
  warehouseId?: string | null
  deliveryDate?: string | null
}) {
  const navigate = useNavigate()
  // Cảnh báo thiếu tồn theo (kho, ngày giao) — badge cuối cột Mã hàng (đồng bộ Xuất)
  const { data: shortages = [] } = useOutboundShortages(warehouseId, deliveryDate)
  const shortageByMat = new Map(shortages.map(s => [s.material_id, s]))
  // Cột "Vị trí lấy" — top 2 vị trí FEFO trên màn (đồng bộ trang Xuất)
  const { data: pickSug } = useGdoPickSuggestions(gdoId)
  const [inventoryItemId, setInventoryItemId] = useState<string | null>(null)

  const allItems = doRecords.flatMap(d =>
    d.items
      .filter(i => i.loose_picking > 0)
      .map(i => ({ ...i, delivery_code: d.delivery_code, distributor_name: d.distributor_name }))
  )
  // 3 cột CUỐI riêng biệt (user 19/07, đồng bộ Xuất): Batch yêu cầu · %Date yêu cầu · Header text — style đỏ như detail mã
  const hasBatchRequired = allItems.some(i => i.batch_required)
  const hasDateRequired  = allItems.some(i => i.date_required != null && i.date_required > 0)
  const hasHeaderText    = allItems.some(i => i.header_text)
  const hasPickSug       = !!pickSug && Object.values(pickSug).some(v => v.length > 0)

  // Cột text dài NỚI RỘNG vừa đủ để chuỗi dài nhất gói trong ≤3 dòng — KHÔNG cắt dữ liệu (đồng bộ Xuất)
  const maxNameLen   = Math.max(0, ...allItems.map(i => (i.material?.short_name ?? i.material_code_raw ?? '').length))
  const nameMinW     = Math.min(400, Math.max(150, Math.ceil((maxNameLen / 3) * 5.4)))
  const maxHeaderLen = Math.max(0, ...allItems.map(i => (i.header_text ?? '').length))
  const headerMinW   = Math.min(420, Math.max(180, Math.ceil((maxHeaderLen / 3) * 5)))
  // Cột Số DO ra CUỐI + hiện ĐỦ mọi DO trên 1 DÒNG (user 21/07, đồng bộ Xuất) — rộng theo chuỗi DO dài nhất, nowrap giữ chiều cao dòng, kéo giãn được
  const maxDoLen     = Math.max(0, ...allItems.map(i => (i.delivery_code ?? '').split(',').map(s => s.trim()).filter(Boolean).join(', ').length))
  const doMinW       = Math.min(640, Math.max(110, Math.ceil(maxDoLen * 6.6) + 16))   // +16 padding cell; cap 640 (~9-10 DO), dài hơn thì kéo giãn/hover

  // Bộ cột ĐỘNG — chuẩn table-format (table-fixed + kéo giãn + sticky), đồng bộ Xuất
  const cols: RtColDef[] = [
    { id: 'mat',  label: 'Mã hàng', w: 92 },
    { id: 'name', label: 'Tên hàng', w: nameMinW },
    { id: 'tong_c', label: 'Tổng thùng', w: 74, align: 'right' },
    { id: 'tong_b', label: 'Tổng hộp', w: 62, align: 'right' },
    { id: 'le_c',   label: 'Lẻ thùng', w: 78, align: 'right' },
    { id: 'le_b',   label: 'Lẻ hộp', w: 54, align: 'right' },
    { id: 'kho',  label: 'Kho', w: 46, align: 'center' },
    ...(hasPickSug ? [{ id: 'pick', label: 'Vị trí lấy', w: 175 }] : []),
    ...(hasBatchRequired ? [{ id: 'batch', label: 'Batch yêu cầu', w: 100 }] : []),
    ...(hasDateRequired ? [{ id: 'datereq', label: '%Date yêu cầu', w: 100 }] : []),
    ...(hasHeaderText ? [{ id: 'header', label: 'Header text', w: headerMinW }] : []),
    { id: 'do',   label: 'Số DO', w: doMinW },
    { id: 'exp',  label: '', w: 30 },
  ]
  const colSig = cols.map(c => c.id).join('.')

  const inventoryItem = inventoryItemId ? allItems.find(i => i.id === inventoryItemId) : null

  if (allItems.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
        <Scissors className="h-10 w-10 opacity-30" />
        <p className="text-sm">Không có mặt hàng nhặt lẻ</p>
      </div>
    )
  }

  return (
    <>
      {inventoryItem && (
        <InventoryModal
          gdoId={gdoId}
          itemId={inventoryItem.id}
          matCode={inventoryItem.material?.material_code ?? inventoryItem.material_code_raw ?? '—'}
          matName={inventoryItem.material?.short_name ?? inventoryItem.material_code_raw ?? '—'}
          mat={inventoryItem.material}
          onClose={() => setInventoryItemId(null)}
        />
      )}
      <ResizableTable key={colSig} storageKey={`loosepicking_items_w:${colSig}`} cols={cols}>
        <TableBody>
          {allItems.map(item => {
            const { effective, done: looseDone, looseScanned } = itemLooseProgress(item)
            // BASE UNIT (4 số): tách Tổng + Nhặt lẻ thành Thùng/Hộp (mã KG không entry → giữ base ở cột thùng)
            const hasEnt     = hasEntry(item.material)
            const ordSplit   = qtySplit(item.cartons_ordered, item.material)
            const effSplit   = qtySplit(effective, item.material)
            const doneSplit  = qtySplit(looseDone, item.material)
            const tHop       = ordSplit.base > 0 ? String(ordSplit.base) : null
            const leThung    = effSplit.entry > 0 || doneSplit.entry > 0 ? `${doneSplit.entry}/${effSplit.entry}` : null
            const leHop      = effSplit.base > 0 || doneSplit.base > 0 ? `${doneSplit.base}/${effSplit.base}` : null
            const isDone   = looseDone >= effective
            const textCls  = isDone ? 'text-blue-700' : looseScanned > 0 ? 'text-amber-700' : 'text-slate-700'
            const bgCls    = isDone ? 'bg-blue-50 hover:bg-blue-100' : looseScanned > 0 ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50'
            const matCode  = item.material?.material_code ?? item.material_code_raw ?? '—'
            const matName  = item.material?.short_name ?? item.material_code_raw ?? '—'
            const looseScanEntries = (item.scan_entries ?? []).filter(s => s.is_loose_picking)
            const expanded = expandedItemIds.has(item.id)

            // Cột đầu sticky-left cần NỀN ĐẶC theo trạng thái (đồng bộ Xuất)
            const stickyBg = isDone ? 'bg-blue-50' : looseScanned > 0 ? 'bg-amber-50' : 'bg-white'
            return (
              <Fragment key={item.id}>
                <TableRow
                  className={`cursor-pointer transition-colors ${bgCls}`}
                  onClick={() => navigate(`/wms/loosepicking/${gdoId}/items/${item.id}`)}
                >
                  <TableCell className={`px-2 py-1 align-top whitespace-nowrap sticky left-0 z-10 ${stickyBg}`}>
                    <div className={`text-[10px] font-mono font-semibold ${textCls}`}>
                      {matCode}
                      <ShortageBadge s={item.material_id ? shortageByMat.get(item.material_id) : undefined} mat={item.material} />
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1 align-top">
                    {/* Mobile: tên 1 DÒNG (cắt …) — bấm dòng mở chi tiết. Desktop: xuống dòng bình thường. */}
                    <div className={`text-[10px] font-medium leading-tight truncate sm:whitespace-normal ${textCls}`}>{matName}</div>
                    {looseScanEntries.length > 0 && (
                      <div className="hidden sm:block text-[9px] text-slate-400 mt-0.5">{looseScanEntries.length} pallet đã quét</div>
                    )}
                  </TableCell>
                  {/* BASE UNIT: Tổng thùng (kế hoạch) — mã KG giữ số base */}
                  <TableCell className="px-2 py-1 align-top text-right whitespace-nowrap">
                    <span className={`text-[10px] tabular-nums ${textCls}`}>{hasEnt ? ordSplit.entry : qtyEntryText(item.cartons_ordered, item.material)}</span>
                  </TableCell>
                  {/* Tổng hộp lẻ — 0 → "—" */}
                  <TableCell className="px-2 py-1 align-top text-right whitespace-nowrap">
                    {hasEnt && tHop
                      ? <span className={`text-[10px] tabular-nums ${textCls}`}>{tHop}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                  {/* Nhặt lẻ THÙNG (đã/cần) + nút Quét */}
                  <TableCell className="px-2 py-1 align-top text-right whitespace-nowrap">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={`text-[10px] font-semibold tabular-nums ${textCls}`}>
                        {leThung ?? (!hasEnt && effective > 0 ? `${qtyEntryText(looseDone, item.material)}/${qtyEntryText(effective, item.material)}` : '—')}
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
                  {/* Nhặt lẻ HỘP (đã/cần) — 0 → "—" */}
                  <TableCell className="px-2 py-1 align-top text-right whitespace-nowrap">
                    {leHop
                      ? <span className={`text-[10px] font-semibold tabular-nums ${textCls}`}>{leHop}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="px-1 py-1 align-middle text-center">
                    <button
                      onClick={e => { e.stopPropagation(); setInventoryItemId(item.id) }}
                      className="flex items-center justify-center h-7 w-7 mx-auto rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      title="Xem tồn kho"
                    >
                      <Search className="h-5 w-5" />
                    </button>
                  </TableCell>
                  {hasPickSug && (
                    <TableCell
                      className="px-2 py-1 align-top whitespace-nowrap cursor-pointer"
                      title="Vị trí nên lấy (FEFO — %Date thấp trước) · bấm xem đầy đủ tồn kho"
                      onClick={e => { e.stopPropagation(); setInventoryItemId(item.id) }}
                    >
                      {(() => {
                        if (isDone) return <span className="text-[10px] text-slate-300">—</span>
                        const sugs = item.material_id ? pickSug?.[item.material_id] ?? [] : []
                        if (sugs.length === 0) return <span className="text-[10px] text-slate-300">—</span>
                        return (
                          <div className="leading-tight">
                            {sugs.map((s, si) => (
                              <div key={si} className="text-[10px]">
                                <span className={`font-mono font-semibold ${si === 0 ? 'text-sky-700' : 'text-slate-500'}`}>{s.location_code ?? '—'}</span>
                                {s.pct_date != null && (
                                  <span className={`ml-1 font-bold tabular-nums ${
                                    s.pct_date <= 30 ? 'text-red-600' : s.pct_date <= 60 ? 'text-amber-600' : 'text-green-700'
                                  }`}>{s.pct_date}%</span>
                                )}
                                <span className="ml-1 text-slate-400 tabular-nums">{qtyEntryText(s.available, item.material)}th</span>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </TableCell>
                  )}
                  {hasBatchRequired && (
                    <TableCell className="px-2 py-1 align-top whitespace-nowrap">
                      {item.batch_required
                        ? <span className="text-[9px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5">{item.batch_required}</span>
                        : <span className="text-[10px] text-slate-300">—</span>}
                    </TableCell>
                  )}
                  {hasDateRequired && (
                    <TableCell className="px-2 py-1 align-top whitespace-nowrap">
                      {item.date_required != null && item.date_required > 0
                        ? <span className="text-[9px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5">≥ {item.date_required}%</span>
                        : <span className="text-[10px] text-slate-300">—</span>}
                    </TableCell>
                  )}
                  {hasHeaderText && (
                    <TableCell className="px-2 py-1 align-top whitespace-normal">
                      {item.header_text
                        ? <p className="text-[9px] font-medium text-red-600 leading-snug break-words">{item.header_text}</p>
                        : <span className="text-[10px] text-slate-300">—</span>}
                    </TableCell>
                  )}
                  <TableCell className="px-2 py-1 align-top whitespace-nowrap">
                    {/* Số DO — cột CUỐI, hiện ĐẦY ĐỦ mọi DO trên 1 dòng (nowrap giữ chiều cao dòng; kéo giãn được) */}
                    {(() => {
                      const codes = (item.delivery_code ?? '').split(',').map(s => s.trim()).filter(Boolean)
                      if (codes.length === 0) return <span className="text-[10px] text-slate-300">—</span>
                      return <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap" title={codes.join(', ')}>{codes.join(', ')}</span>
                    })()}
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
                    <TableCell colSpan={cols.length} className="px-0 py-0 border-b border-slate-100">
                      <div className="ml-3 pl-3 pr-3 py-1.5 border-l-2 border-slate-200">
                        <table className="w-full border-collapse whitespace-nowrap">
                          <thead>
                            <tr>
                              <th className="text-left text-[9px] text-slate-400 font-medium pb-0.5 pr-3">Mã pallet</th>
                              <th className="text-right text-[9px] text-slate-400 font-medium pb-0.5 pr-3">Thùng</th>
                              <th className="text-left text-[9px] text-slate-400 font-medium pb-0.5 pr-3">%Date</th>
                              <th className="text-left text-[9px] text-slate-400 font-medium pb-0.5 pr-3">Date</th>
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
                                    <span className="text-[10px] tabular-nums text-slate-400">{qtyLabel(se.cartons_scanned, item.material)}</span>
                                  </td>
                                  <td className="pr-3 py-0.5">
                                    {se.pct_date !== null && se.pct_date !== undefined ? (
                                      <span className={`text-[10px] font-bold tabular-nums ${
                                        se.pct_date <= 30 ? 'text-red-600' : se.pct_date <= 60 ? 'text-amber-600' : 'text-green-700'
                                      }`}>{se.pct_date}%</span>
                                    ) : <span className="text-[10px] text-slate-300">—</span>}
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
      </ResizableTable>
    </>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function LoosePickingDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { vehicles, pin, unpin, isPinned, update } = useActiveLoosePickingStore()
  const pinned = isPinned(id ?? '')
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null

  const { data: gdo, isLoading } = useGDO(id)
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set())
  const [showOrderScan,   setShowOrderScan]   = useState(false)   // quét QR cấp ĐƠN — tự nhận mã hàng từ tem
  const [hdrOpen,         setHdrOpen]         = useState(false)   // mobile: popup thông tin đơn (thanh mảnh + nút Info)
  const [pdaScan,         setPdaScan]         = useState<string | null>(null)   // tem bắn bằng cò súng tại trang → mở màn quét chế độ súng

  function toggleExpand(itemId: string) {
    setExpandedItemIds(prev => { const n = new Set(prev); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n })
  }

  // PDA: bóp cò ngay tại trang → tự mở màn quét chế độ SÚNG (không camera) — điều kiện = nút Quét QR
  useWedgeScanner(code => {
    if (!gdo || showOrderScan) return
    if (gdo.status === 'COMPLETED' || gdo.status === 'CANCELLED') return
    if (!can(perms, 'loosepicking', 'scan')) return
    const anyLoose = (gdo.delivery_orders ?? []).some(d => d.items.some(i =>
      i.loose_picking > 0 && i.material?.no_qr_tracking !== true && itemLooseProgress(i).remaining > 0))
    if (!anyLoose) return
    unlockAudio()
    setPdaScan(code)
    setShowOrderScan(true)
  }, true)

  useEffect(() => {
    if (gdo) update(gdo.id, gdo.status)
  }, [gdo?.status, gdo?.id])

  if (isLoading || !gdo) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>
    )
  }

  const allDOs        = gdo.delivery_orders ?? []
  const allLooseItems = allDOs.flatMap(d => d.items.filter(i => i.loose_picking > 0))
  // BASE UNIT: quy đổi THÙNG per-mã trước khi cộng cross-mã (loose_picking lưu base)
  const totalLoose    = allLooseItems.reduce((s, i) => s + qtyEntryDecimal(itemLooseProgress(i).effective, i.material), 0)
  const totalLooseDone = allLooseItems.reduce((s, i) => s + qtyEntryDecimal(itemLooseProgress(i).done, i.material), 0)

  const npp = [...new Set(allDOs.map(d => d.distributor_name).filter(Boolean))].join(', ')

  const hasScanEntries = allLooseItems.some(i => (i.scan_entries ?? []).some(s => s.is_loose_picking))
  const hasAnyExpanded = expandedItemIds.size > 0
  function toggleExpandAll() {
    if (hasAnyExpanded) {
      setExpandedItemIds(new Set())
    } else {
      setExpandedItemIds(new Set(
        allLooseItems
          .filter(i => (i.scan_entries ?? []).some(s => s.is_loose_picking))
          .map(i => i.id)
      ))
    }
  }

  // ── Cụm action header (ActionCluster) — đồng bộ nút "Xem pallet" với OutboundDetail ──
  const actionItems: ActionItem[] = []
  // Quét QR cấp ĐƠN (user 19/07): quét tem pallet bất kỳ, tự nhận mã hàng — khỏi vào từng mã.
  // Rule chặn giữ nguyên (BE kiểm theo item): sai mã, không vượt số nhặt lẻ, tạm dừng…
  const hasLooseRemaining = allLooseItems.some(i =>
    i.material?.no_qr_tracking !== true && itemLooseProgress(i).remaining > 0)
  if (hasLooseRemaining && gdo.status !== 'COMPLETED' && gdo.status !== 'CANCELLED' && can(perms, 'loosepicking', 'scan'))
    actionItems.push({
      key: 'scan-order', icon: QrCode, label: 'Quét QR',
      tip: 'Quét tem pallet bất kỳ của đơn — tự nhận mã hàng, hiện ghi chú/điều kiện của mã đó',
      primary: true, variant: 'default',
      onClick: () => { unlockAudio(); setShowOrderScan(true) },
    })
  if (hasScanEntries)
    actionItems.push({
      key: 'expand', icon: ChevronDown, label: hasAnyExpanded ? 'Thu gọn' : 'Xem pallet',
      tip: hasAnyExpanded ? 'Thu gọn danh sách pallet đã quét' : 'Mở danh sách pallet đã quét của mọi mã hàng',
      className: `text-slate-500 ${hasAnyExpanded ? '[&_svg]:rotate-180' : ''}`,
      onClick: toggleExpandAll,
    })

  // Dải tile tổng hợp (đồng bộ Xuất) — LUÔN hiện ngay trên bảng.
  const bandTiles = [
    { label: 'DO',       value: allDOs.length },
    { label: 'Mã hàng',  value: allLooseItems.length },
    { label: 'Đã nhặt',  value: `${totalLooseDone.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} thùng`, accent: totalLooseDone > 0 },
    { label: 'Cần nhặt', value: `${totalLoose.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} thùng` },
  ]
  // Khối thông tin đơn — desktop hiện inline; mobile mở POPUP (nút Info trên thanh mảnh).
  const orderInfoJSX = (
    <div className="space-y-1">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
      <span className="flex items-center gap-1">
        <Truck className="h-3 w-3 text-slate-400 shrink-0" />
        <span className="font-medium">{format(parseISO(gdo.delivery_date), 'dd-MM-yy', { locale: vi })}</span>
      </span>
      {gdo.dvvt && <span className="text-slate-500">{gdo.dvvt}</span>}
      {npp && <span className="text-slate-500 break-words">{npp}</span>}
      <span className="flex items-center gap-1">
        <Package className="h-3 w-3 text-slate-400 shrink-0" />
        Nhặt lẻ <span className="font-medium ml-1">{totalLooseDone.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}/{totalLoose.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}</span>
        <span className="text-slate-400 ml-0.5">thùng</span>
      </span>
    </div>
    <ProgressBar scanned={totalLooseDone} target={totalLoose} />
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {showOrderScan && (
        <GdoScanSheet gdo={gdo} mode="loose" pdaMode={!!pdaScan} initialScan={pdaScan ?? undefined}
          onClose={() => { setShowOrderScan(false); setPdaScan(null) }} />
      )}

      {/* Mobile: popup thông tin đơn (desktop hiện inline) */}
      <Dialog open={hdrOpen} onOpenChange={setHdrOpen}>
        <DialogContent className="max-w-[94vw] sm:max-w-md p-3 gap-2">
          <DialogHeader><DialogTitle className="text-sm font-semibold">Thông tin đơn · {gdo.group_code}</DialogTitle></DialogHeader>
          {orderInfoJSX}
        </DialogContent>
      </Dialog>

      {/* ── Header: KHÔNG scroll nội bộ (user 19/07) — nội dung gọn, cao theo thực tế ── */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5">

        {/* Row 1: back + code + status + cụm action — flex-wrap để cụm xuống dòng thay vì bị cắt trên màn hẹp */}
        <div className="flex items-center justify-between gap-x-2 gap-y-1.5 flex-wrap">
          <div className="flex items-center gap-1.5 min-w-0">
            <button onClick={() => navigate('/wms/loosepicking')}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Scissors className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="font-mono font-semibold text-sm">{gdo.group_code}</span>
            <Badge status={gdo.status} />
            <button
              onClick={() => pinned
                ? unpin(gdo.id)
                : pin({ id: gdo.id, group_code: gdo.group_code, status: gdo.status })
              }
              className={`p-1 rounded transition-colors shrink-0 ${pinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
              title={pinned ? 'Bỏ đánh dấu đang làm' : 'Đánh dấu đang làm xe này'}
            >
              <Bookmark className="h-3.5 w-3.5" fill={pinned ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={() => setHdrOpen(true)}
              className="sm:hidden p-1 rounded hover:bg-slate-100 text-slate-400 shrink-0"
              title="Xem thông tin đơn"
            >
              <Info className="h-4 w-4" />
            </button>
          </div>
          {actionItems.length > 0 && <ActionCluster items={actionItems} />}
        </div>

        {/* Row 2: GDO info — desktop inline; mobile xem qua popup Info */}
        <div className="hidden sm:block">{orderInfoJSX}</div>
      </div>

      {/* Dải tile tổng hợp (đồng bộ Xuất) — LUÔN hiện ngay trên bảng */}
      <div className="shrink-0"><SummaryBand tiles={bandTiles} /></div>

      {/* ── Quick-switch bar ── */}
      {vehicles.length > 0 && (
        <div className="border-b bg-white px-3 py-1.5 shrink-0 flex flex-wrap items-center gap-1">
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
        {/* Băng HÀNG HÓA (đồng bộ Xuất) */}
        <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5">
          <span className="h-3.5 w-1 rounded-full bg-sky-500 shrink-0" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Hàng hóa</h2>
          <span className="text-[11px] font-normal text-slate-400">{allLooseItems.length} mã · {allDOs.length} DO</span>
        </div>
        <ItemsTable doRecords={allDOs} gdoId={id!} expandedItemIds={expandedItemIds} toggleExpand={toggleExpand}
          warehouseId={gdo.warehouse_id} deliveryDate={gdo.delivery_date} />
      </div>
    </div>
  )
}
