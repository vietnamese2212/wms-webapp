import { useEffect, useState } from 'react'
import { Package, Search, X, SlidersHorizontal, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useInventoryEntries, useWarehouses, useQAStatuses, useAdjustInventory } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import type { InventoryEntry } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────

function formatLoc(loc: { location_code: string; sub_code: string } | null): string {
  if (!loc) return '—'
  const tang = loc.sub_code?.split('-')[0] ?? ''
  return tang ? `${loc.location_code}_${tang}` : loc.location_code
}

function calcDatePct(prodDate: string | null, shelfDays: number | null): number | null {
  if (!prodDate || !shelfDays || shelfDays <= 0) return null
  const prod = new Date(prodDate)
  if (isNaN(prod.getTime())) return null
  const totalMs = shelfDays * 86_400_000
  const remaining = prod.getTime() + totalMs - Date.now()
  return Math.max(0, Math.round((remaining / totalMs) * 100))
}

function datePctCls(pct: number): string {
  if (pct >= 70) return 'text-green-600 font-semibold'
  if (pct >= 40) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function entryRowBg(e: InventoryEntry, selected: boolean): string {
  if (selected) return 'bg-blue-100'
  if (e.status === 'PARTIAL')    return 'bg-amber-50 hover:bg-amber-100'
  if (e.status === 'QUARANTINE') return 'bg-red-50 hover:bg-red-100'
  if (e.status === 'EXPORTED' || e.status === 'TRANSFERRED') return 'bg-blue-50 hover:bg-blue-100'
  return 'hover:bg-slate-50'
}

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'Còn hàng', PARTIAL: 'Xuất 1 phần', EXPORTED: 'Đã xuất',
  TRANSFERRED: 'Đã chuyển', QUARANTINE: 'Cách ly', CANCELLED: 'Đã hủy',
}
const STATUS_CLS: Record<string, string> = {
  IN_STOCK: 'bg-green-100 text-green-700', PARTIAL: 'bg-amber-100 text-amber-700',
  EXPORTED: 'bg-blue-100 text-blue-700', TRANSFERRED: 'bg-slate-100 text-slate-600',
  QUARANTINE: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500',
}

const LIMIT = 50

// ─── Main component ───────────────────────────────────────────

export default function Inventory() {
  const user = useAuthStore(s => s.user)
  const { inventory: f, setInventory } = useWmsFilterStore()
  const [selected, setSelected] = useState<InventoryEntry | null>(null)

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: qaStatuses = [] }  = useQAStatuses()

  useEffect(() => {
    if (!f.warehouseId && user?.warehouse_id) {
      setInventory({ warehouseId: user.warehouse_id })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const { data, isLoading } = useInventoryEntries({
    warehouse_id:    f.warehouseId   || undefined,
    location_code:   f.locationCode  || undefined,
    material_search: f.materialSearch || undefined,
    qa_status_id:    f.qaStatusId    || undefined,
    status:          f.status        || undefined,
    search:          f.search        || undefined,
    page:            f.page,
    limit:           LIMIT,
  })

  const entries    = data?.entries ?? []
  const total      = data?.total   ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  function resetFilters() {
    setInventory({ search: '', materialSearch: '', locationCode: '', qaStatusId: '', status: '', page: 1 })
  }

  const hasFilters = f.search || f.materialSearch || f.locationCode || f.qaStatusId || f.status

  // Keep selected entry in sync when list refreshes
  useEffect(() => {
    if (!selected) return
    const refreshed = entries.find(e => e.id === selected.id)
    if (refreshed) setSelected(refreshed)
  }, [entries]) // eslint-disable-line

  return (
    <div className="flex flex-col h-full">
      {/* ── Filter header ── */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-slate-500" />
            Tồn kho
          </h1>
          {hasFilters && (
            <button onClick={resetFilters}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />Xóa bộ lọc
            </button>
          )}
        </div>

        {/* Row 1: Kho + tìm pallet */}
        <div className="flex gap-2">
          <Select
            value={f.warehouseId || '__all__'}
            onValueChange={v => setInventory({ warehouseId: v === '__all__' ? '' : v, page: 1 })}
          >
            <SelectTrigger className="h-8 text-xs w-[150px]">
              <SelectValue placeholder="Chọn kho" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {warehouses.map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm mã pallet…"
              value={f.search}
              onChange={e => setInventory({ search: e.target.value, page: 1 })} />
          </div>
        </div>

        {/* Row 2: Vị trí + Hàng + QA + Trạng thái */}
        <div className="flex gap-2 flex-wrap">
          <Input className="h-7 text-xs w-[110px]" placeholder="Vị trí…"
            value={f.locationCode}
            onChange={e => setInventory({ locationCode: e.target.value, page: 1 })} />

          <Input className="h-7 text-xs w-[140px]" placeholder="Mã / tên hàng…"
            value={f.materialSearch}
            onChange={e => setInventory({ materialSearch: e.target.value, page: 1 })} />

          <Select value={f.qaStatusId || '__all__'} onValueChange={v => setInventory({ qaStatusId: v === '__all__' ? '' : v, page: 1 })}>
            <SelectTrigger className="h-7 text-xs w-[100px]">
              <SelectValue placeholder="QA" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả QA</SelectItem>
              {qaStatuses.map((q: any) => (
                <SelectItem key={q.id} value={q.id}>{q.code} – {q.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={f.status || '__active__'} onValueChange={v => setInventory({ status: v === '__active__' ? '' : v, page: 1 })}>
            <SelectTrigger className="h-7 text-xs w-[130px]">
              <SelectValue placeholder="Trạng thái" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__active__">Đang tồn</SelectItem>
              <SelectItem value="ALL">Tất cả</SelectItem>
              <SelectItem value="IN_STOCK">Còn hàng</SelectItem>
              <SelectItem value="PARTIAL">Xuất 1 phần</SelectItem>
              <SelectItem value="QUARANTINE">Cách ly</SelectItem>
              <SelectItem value="EXPORTED">Đã xuất</SelectItem>
              <SelectItem value="TRANSFERRED">Đã chuyển</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-slate-500 -mt-1">
          {isLoading ? 'Đang tải…' : (
            <>
              <span className="font-medium text-slate-700">{total.toLocaleString()}</span> pallet
              {totalPages > 1 && <span className="ml-1.5">— trang {f.page}/{totalPages}</span>}
              {selected && <span className="ml-2 text-blue-600">· 1 đang chọn</span>}
            </>
          )}
        </p>
      </div>

      {/* ── Content: table + detail drawer ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto pb-20 lg:pb-4">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">Không tìm thấy pallet nào</p>
              {hasFilters && (
                <button onClick={resetFilters} className="text-xs text-blue-500 underline">Xóa bộ lọc</button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên hàng</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã pallet</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Vị trí</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Nhập</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Xuất</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Tồn</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Date</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">%Date</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">QA</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Đ.chỉnh</TableHead>
                      <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 w-5" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map(e => (
                      <EntryRow
                        key={e.id}
                        entry={e}
                        isSelected={selected?.id === e.id}
                        onClick={() => setSelected(prev => prev?.id === e.id ? null : e)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-3 border-t bg-white">
                  <button
                    disabled={f.page <= 1}
                    onClick={() => setInventory({ page: f.page - 1 })}
                    className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
                    ← Trước
                  </button>
                  <span className="text-xs text-slate-500">{f.page} / {totalPages}</span>
                  <button
                    disabled={f.page >= totalPages}
                    onClick={() => setInventory({ page: f.page + 1 })}
                    className="px-3 py-1 text-xs rounded border disabled:opacity-40 hover:bg-slate-50">
                    Sau →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail drawer */}
        {selected && (
          <DetailPanel
            entry={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

// ─── EntryRow ─────────────────────────────────────────────────

function EntryRow({ entry: e, isSelected, onClick }: {
  entry: InventoryEntry
  isSelected: boolean
  onClick: () => void
}) {
  const loc        = formatLoc(e.location)
  const matCode    = e.material?.material_code ?? '—'
  const matName    = e.material?.short_name ?? '—'
  const qa         = e.qa_status?.code ?? '—'
  const remaining  = e.cartons_remaining ?? e.cartons_imported
  const exported   = Math.max(0, Number(e.cartons_imported) - Number(remaining))
  const pct        = calcDatePct(e.production_date, e.material?.shelf_life_days ?? null)
  const prodDateStr = e.production_date
    ? formatTimestampDate(e.production_date, true)
    : '—'
  const adjQty = e.adjustment_qty ?? 0

  return (
    <TableRow
      className={`transition-colors cursor-pointer ${entryRowBg(e, isSelected)}`}
      onClick={onClick}
    >
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold text-slate-700">{matCode}</span>
      </TableCell>
      <TableCell className="px-2 py-1 max-w-[120px]">
        <span className="text-[10px] text-slate-700 truncate block" title={matName}>{matName}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold">{e.pallet_code}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono text-slate-700">{loc}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{e.cartons_imported}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-500">{exported > 0 ? exported : '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{remaining}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{prodDateStr}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {pct !== null ? (
          <span className={`text-[10px] tabular-nums ${datePctCls(pct)}`}>{pct}%</span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${STATUS_CLS[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {qa}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        {adjQty !== 0 ? (
          <span className={`text-[10px] tabular-nums font-semibold ${adjQty > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {adjQty > 0 ? '+' : ''}{adjQty}
          </span>
        ) : (
          <span className="text-[10px] text-slate-300">—</span>
        )}
      </TableCell>
      <TableCell className="px-1 py-1">
        <ChevronRight className={`h-3 w-3 text-slate-300 transition-transform ${isSelected ? 'rotate-90 text-blue-500' : ''}`} />
      </TableCell>
    </TableRow>
  )
}

// ─── Detail panel ─────────────────────────────────────────────

function DetailPanel({ entry: e, onClose }: { entry: InventoryEntry; onClose: () => void }) {
  const [adjInput, setAdjInput]     = useState('')
  const [showAdj, setShowAdj]       = useState(false)
  const [adjError, setAdjError]     = useState('')
  const { mutate: adjust, isPending } = useAdjustInventory()

  const loc        = formatLoc(e.location)
  const remaining  = e.cartons_remaining ?? e.cartons_imported
  const exported   = Math.max(0, Number(e.cartons_imported) - Number(remaining))
  const pct        = calcDatePct(e.production_date, e.material?.shelf_life_days ?? null)

  function handleAdjust() {
    const val = parseFloat(adjInput)
    if (isNaN(val) || val === 0) { setAdjError('Nhập số khác 0'); return }
    setAdjError('')
    adjust(
      { id: e.id, adjustment: val },
      {
        onSuccess: () => { setAdjInput(''); setShowAdj(false) },
        onError: (err: any) => {
          setAdjError(err?.response?.data?.error?.message ?? 'Lỗi không xác định')
        },
      }
    )
  }

  return (
    <div className="w-72 shrink-0 border-l bg-white overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 shrink-0">
        <p className="text-xs font-semibold text-slate-700 font-mono truncate">{e.pallet_code}</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 ml-2">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3 space-y-3 text-xs flex-1">
        {/* Status badge */}
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[e.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABEL[e.status] ?? e.status}
        </span>

        {/* Core info */}
        <Section title="Thông tin hàng">
          <Row label="Mã hàng"  value={e.material?.material_code ?? '—'} mono />
          <Row label="Tên hàng" value={e.material?.short_name ?? '—'} />
          <Row label="Vị trí"   value={loc} mono />
          <Row label="QA"       value={e.qa_status ? `${e.qa_status.code} – ${e.qa_status.name}` : '—'} />
        </Section>

        {/* Quantities */}
        <Section title="Số lượng">
          <Row label="Nhập"      value={`${e.cartons_imported} thùng`} />
          <Row label="Xuất"      value={exported > 0 ? `${exported} thùng` : '—'} />
          <Row label="Tồn"       value={`${remaining} thùng`} bold />
          <Row label="Điều chỉnh" value={e.adjustment_qty ? `${e.adjustment_qty > 0 ? '+' : ''}${e.adjustment_qty}` : '—'}
            cls={e.adjustment_qty ? (Number(e.adjustment_qty) > 0 ? 'text-green-600' : 'text-red-600') : ''} />
        </Section>

        {/* Date info */}
        <Section title="Ngày / Hạn dùng">
          <Row label="Ngày SX"
            value={e.production_date ? formatTimestampDate(e.production_date, false) : '—'} />
          <Row label="HSD (ngày)"
            value={e.material?.shelf_life_days ? `${e.material.shelf_life_days} ngày` : '—'} />
          {pct !== null && (
            <Row label="% Date còn" value={`${pct}%`}
              cls={datePctCls(pct)} bold />
          )}
        </Section>

        {/* Production */}
        <Section title="Sản xuất">
          <Row label="NMSX"    value={e.manufacturer?.name ?? e.manufacturer?.code ?? '—'} />
          <Row label="Chu kỳ" value={e.cycle ?? '—'} mono />
          <Row label="Máy"    value={e.machine_code ?? '—'} mono />
        </Section>

        {/* Import */}
        <Section title="Nhập kho">
          <Row label="Ngày nhập"  value={e.import_date ? formatTimestampDate(e.import_date) : '—'} />
          <Row label="Giờ nhập"   value={e.import_date ? formatTimestampTime(e.import_date) : '—'} />
          <Row label="Người nhập" value={e.created_by_emp?.name ?? '—'} />
        </Section>

        {/* Update */}
        <Section title="Cập nhật">
          <Row label="Ngày sửa"  value={e.update_date ? formatTimestampDate(e.update_date) : '—'} />
          <Row label="Giờ sửa"   value={e.updated_at ? formatTimestampTime(e.updated_at) : '—'} />
          <Row label="Người sửa" value={e.updated_by_emp?.name ?? '—'} />
        </Section>

        {/* Stocktaking */}
        <Section title="Kiểm kê">
          <Row label="Người KK"  value={e.stocktake_by_emp?.name ?? '—'} />
          <Row label="Ngày KK"   value={e.stocktake_at ? formatTimestampDate(e.stocktake_at) : '—'} />
          <Row label="Giờ KK"    value={e.stocktake_at ? formatTimestampTime(e.stocktake_at) : '—'} />
        </Section>

        {/* Adjust block */}
        <div className="border-t pt-3">
          {!showAdj ? (
            <Button size="sm" variant="outline" className="w-full gap-1.5"
              onClick={() => setShowAdj(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Điều chỉnh tồn kho
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-500">
                Tồn hiện tại: <strong>{remaining}</strong> thùng. Nhập số điều chỉnh (+ hoặc −).
              </p>
              <Input
                type="number"
                placeholder="Vd: -2 hoặc +5"
                value={adjInput}
                onChange={e => { setAdjInput(e.target.value); setAdjError('') }}
                className="h-8 text-sm text-center"
              />
              {adjInput && !isNaN(parseFloat(adjInput)) && (
                <p className="text-[10px] text-slate-500 text-center">
                  Tồn mới: <strong>{Number(remaining) + parseFloat(adjInput)}</strong> thùng
                </p>
              )}
              {adjError && <p className="text-[10px] text-red-500">{adjError}</p>}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={handleAdjust} disabled={isPending || !adjInput}>
                  {isPending ? '…' : 'Xác nhận'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowAdj(false); setAdjInput(''); setAdjError('') }}>
                  Hủy
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ label, value, mono, bold, cls }: {
  label: string; value: string; mono?: boolean; bold?: boolean; cls?: string
}) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`text-right truncate ${mono ? 'font-mono' : ''} ${bold ? 'font-semibold' : ''} ${cls ?? 'text-slate-700'}`}>
        {value}
      </span>
    </div>
  )
}
