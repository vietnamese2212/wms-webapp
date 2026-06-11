import { useState, useEffect, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { formatDateTime, formatTimestampTime } from '@/utils/formatters'
import {
  ArrowLeft, CheckCircle2,
  Truck, Package, ClipboardList, Play, Pause, ChevronRight, ChevronDown, Bookmark, X, RotateCcw, Pencil, QrCode, Search, PenSquare, Trash2,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { Card }    from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useGDO, useAssignGDO, useStartGDO, useWarehouseEmployees, usePatchGDO,
  useUnassignGDO, useUnstartGDO, useUncompleteGDO, useUpdateTransport,
  useItemInventory, useManualItemStock, useDeleteGDO, useManualCompleteItem, type ItemInventoryEntry,
} from '@/api/hooks'
import { EditGDOModal } from './Outbound'
import { PalletDetailDialog } from '@/components/shared/PalletDetailDialog'
import { useAuthStore } from '@/stores/authStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { OutboundItem, OutboundDelivery, OutboundStatus, GDO } from '@/types'

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

function ProgressBar({ scanned, ordered, compact = false, looseUnconfirmed = 0 }: { scanned: number; ordered: number; compact?: boolean; looseUnconfirmed?: number }) {
  const confirmed    = scanned - looseUnconfirmed
  const confirmedPct = ordered > 0 ? Math.min(100, (confirmed / ordered) * 100) : 0
  const loosePct     = ordered > 0 ? Math.min(100 - confirmedPct, (looseUnconfirmed / ordered) * 100) : 0
  const totalPct     = confirmedPct + loosePct
  const confirmedCls = totalPct >= 100 && looseUnconfirmed === 0 ? 'bg-green-500'
    : confirmedPct > 0 ? 'bg-amber-500' : ''
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
        {confirmedPct > 0 && (
          <div className={`h-full transition-all ${confirmedCls}`} style={{ width: `${confirmedPct}%` }} />
        )}
        {loosePct > 0 && (
          <div className="h-full bg-purple-500 transition-all" style={{ width: `${loosePct}%` }} />
        )}
      </div>
      <span className={`${compact ? 'text-xs' : 'text-lg'} tabular-nums font-medium ${totalPct >= 100 && looseUnconfirmed === 0 ? 'text-green-700 font-semibold' : 'text-slate-600'}`}>
        {scanned}/{ordered}
      </span>
    </div>
  )
}

// ─── Bắt đầu dialog ───────────────────────────────────────────

// ─── Tag multi-picker (employee dropdown + removable tags) ───

type EmpOption = { id: string; name: string; employee_code?: string }

function TagPicker({
  fixedName,
  employees,
  selectedIds,
  onChange,
  placeholder = 'Thêm người…',
}: {
  fixedName?: string
  employees: EmpOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
}) {
  const unselected = employees.filter(e => !selectedIds.includes(e.id))
  return (
    <div className="rounded-md border border-input bg-background px-2 py-2 space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[22px]">
        {fixedName && (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-medium">
            {fixedName}
          </span>
        )}
        {selectedIds.map(id => {
          const emp = employees.find(e => e.id === id)
          return (
            <span key={id} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {emp?.name ?? id}
              <button type="button" onClick={() => onChange(selectedIds.filter(s => s !== id))}>
                <X className="h-3 w-3 text-slate-400 hover:text-red-500" />
              </button>
            </span>
          )
        })}
      </div>
      {unselected.length > 0 && (
        <Select value="" onValueChange={v => { if (v) onChange([...selectedIds, v]) }}>
          <SelectTrigger className="h-7 text-xs border-dashed">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {unselected.map(e => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}{e.employee_code ? ` (${e.employee_code})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

// ─── Start dialog ─────────────────────────────────────────────

function StartDialog({ open, gdo, onClose }: { open: boolean; gdo: GDO; onClose: () => void }) {
  const user = useAuthStore(s => s.user)
  const { data: employees = [] } = useWarehouseEmployees(gdo.warehouse_id)
  const { mutate: startGDO, isPending } = useStartGDO()
  const [err, setErr] = useState<string | null>(null)

  const allItems    = (gdo.delivery_orders ?? []).flatMap(d => d.items)
  const isContainer = allItems.some(i => i.export_type?.toLowerCase().includes('cont'))

  const [licPlate,         setLicPlate]         = useState('')
  const [containerNum,     setContainerNum]     = useState('')
  const [loaderName,       setLoaderName]       = useState('')
  const [extraExporterIds, setExtraExporterIds] = useState<string[]>([])
  const [forklifterIds,    setForklifterIds]    = useState<string[]>([])

  // Resolved names for submission
  const empMap = new Map((employees as EmpOption[]).map(e => [e.id, e.name]))
  const exporterName = [user?.name, ...extraExporterIds.map(id => empMap.get(id) ?? id)]
    .filter(Boolean).join(', ')
  const forklifterNames = forklifterIds.map(id => empMap.get(id) ?? id).filter(Boolean).join(', ')

  function handleSubmit() {
    if (!licPlate.trim()) { setErr('Vui lòng nhập biển số xe'); return }
    setErr(null)
    startGDO(
      {
        id:                   gdo.id,
        license_plate:        licPlate,
        container_number:     containerNum || undefined,
        exporter_name:        exporterName || undefined,
        loader_name:          loaderName   || undefined,
        forklift_driver_id:   forklifterIds[0] || undefined,
        forklift_driver_names: forklifterNames || undefined,
      },
      {
        onSuccess: onClose,
        onError: (e) => {
          const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setErr(msg)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">Bắt đầu xuất kho</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Biển số xe *</Label>
            <Input className="text-lg h-10" placeholder="VD: 30A-12345"
              value={licPlate} onChange={e => setLicPlate(e.target.value.toUpperCase())} />
          </div>
          {isContainer && (
            <div className="space-y-1">
              <Label className="text-xs">Số container</Label>
              <Input className="text-lg h-10" placeholder="VD: ABCD1234567"
                value={containerNum} onChange={e => setContainerNum(e.target.value.toUpperCase())} />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Người xuất</Label>
            <TagPicker
              fixedName={user?.name}
              employees={employees as EmpOption[]}
              selectedIds={extraExporterIds}
              onChange={setExtraExporterIds}
              placeholder="Thêm người xuất…"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Lái xe nâng</Label>
            <TagPicker
              employees={employees as EmpOption[]}
              selectedIds={forklifterIds}
              onChange={setForklifterIds}
              placeholder="Chọn lái xe nâng…"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Bốc xếp</Label>
            <Input className="text-sm h-9" placeholder="Tên bốc xếp"
              value={loaderName} onChange={e => setLoaderName(e.target.value)} />
          </div>

          {err && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Hủy</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu…' : 'Bắt đầu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit transport dialog ────────────────────────────────────

function EditTransportDialog({ open, gdo, onClose }: { open: boolean; gdo: GDO; onClose: () => void }) {
  const { data: employees = [] } = useWarehouseEmployees(gdo.warehouse_id)
  const { mutate: updateTransport, isPending } = useUpdateTransport()
  const [err, setErr] = useState<string | null>(null)

  const allItems    = (gdo.delivery_orders ?? []).flatMap(d => d.items)
  const isContainer = allItems.some(i => i.export_type?.toLowerCase().includes('cont'))

  const [licPlate,        setLicPlate]        = useState(gdo.license_plate ?? '')
  const [containerNum,    setContainerNum]    = useState(gdo.container_number ?? '')
  const [exporterName,    setExporterName]    = useState(gdo.exporter_name ?? '')
  const [loaderName,      setLoaderName]      = useState(gdo.loader_name ?? '')
  const [forklifterIds,   setForklifterIds]   = useState<string[]>(
    gdo.forklift_driver_id ? [gdo.forklift_driver_id] : []
  )

  const empMap = new Map((employees as EmpOption[]).map(e => [e.id, e.name]))
  const forklifterNames = forklifterIds.map(id => empMap.get(id) ?? id).filter(Boolean).join(', ')

  function handleSubmit() {
    if (!licPlate.trim()) { setErr('Vui lòng nhập biển số xe'); return }
    setErr(null)
    updateTransport(
      {
        id:                    gdo.id,
        license_plate:         licPlate,
        container_number:      containerNum  || undefined,
        exporter_name:         exporterName  || undefined,
        loader_name:           loaderName    || undefined,
        forklift_driver_id:    forklifterIds[0] || undefined,
        forklift_driver_names: forklifterNames  || undefined,
      },
      {
        onSuccess: onClose,
        onError: (e) => {
          const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
          setErr(msg)
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">Sửa thông tin xe</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Biển số xe *</Label>
            <Input className="text-lg h-10" placeholder="VD: 30A-12345"
              value={licPlate} onChange={e => setLicPlate(e.target.value.toUpperCase())} />
          </div>
          {(isContainer || containerNum) && (
            <div className="space-y-1">
              <Label className="text-xs">Số container</Label>
              <Input className="text-lg h-10" placeholder="VD: ABCD1234567"
                value={containerNum} onChange={e => setContainerNum(e.target.value.toUpperCase())} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Người xuất</Label>
            <Input className="text-sm h-9" placeholder="Tên người xuất"
              value={exporterName} onChange={e => setExporterName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lái xe nâng</Label>
            <TagPicker
              employees={employees as EmpOption[]}
              selectedIds={forklifterIds}
              onChange={setForklifterIds}
              placeholder="Chọn lái xe nâng…"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bốc xếp</Label>
            <Input className="text-sm h-9" placeholder="Tên bốc xếp"
              value={loaderName} onChange={e => setLoaderName(e.target.value)} />
          </div>
          {err && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{err}</div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Hủy</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Row color by item status ──────────────────────────────────

function itemTextCls(item: OutboundItem): string {
  if (item.cartons_ordered === 0) return ''
  if (item.cartons_scanned >= item.cartons_ordered) return 'text-blue-700'
  if (item.cartons_scanned > 0) return 'text-amber-700'
  return 'text-slate-700'
}

function itemRowBg(item: OutboundItem): string {
  if (item.status === 'COMPLETED')   return 'bg-blue-50 hover:bg-blue-100'
  if (item.status === 'IN_PROGRESS') return 'bg-amber-50 hover:bg-amber-100'
  return 'hover:bg-slate-50'
}

// ─── Inventory modal per item ──────────────────────────────────

function InventoryModal({ gdoId, itemId, matCode, matName, onClose }: {
  gdoId: string; itemId: string; matCode: string; matName: string; onClose: () => void
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
      if (r) { r.cartons += e.available; r.entries.push(e) }
      else map.set(k, { key: k, pct_date: e.pct_date, location_code: e.location_code, is_qa: q, cartons: e.available, entries: [e] })
    }
    return [...map.values()].sort((a, b) => {
      const pa = a.pct_date ?? Infinity, pb = b.pct_date ?? Infinity
      return pa !== pb ? pa - pb : (a.is_qa ? 1 : -1)
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
                    <TableHead className="text-[9px] font-medium text-blue-500 px-3 py-1.5 text-right">Khả dụng</TableHead>
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
                            <span className={`text-[10px] font-semibold tabular-nums ${row.is_qa ? 'text-purple-700' : ''}`}>{row.cartons}</span>
                            <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
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
                              <span className="text-[10px] font-semibold tabular-nums text-blue-700">{e.available}</span>
                              <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
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

// ─── Manual complete dialog ────────────────────────────────────

function ManualCompleteDialog({ gdoId, itemId, matName, initialCartons, onClose }: {
  gdoId: string; itemId: string; matName: string; initialCartons: number; onClose: () => void
}) {
  const [cartons, setCartons] = useState(initialCartons)
  const [err, setErr] = useState<string | null>(null)
  const { data: stock, isLoading: loadingStock } = useManualItemStock(gdoId, itemId)
  const { mutate: manualComplete, isPending: saving } = useManualCompleteItem()

  const remaining = stock?.cartons_remaining ?? 0
  const overStock  = cartons > remaining

  return (
    <Dialog open onOpenChange={v => { if (!v && !saving) onClose() }}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle className="text-base">Lưu số lượng</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-slate-600 font-medium">{matName}</p>

          {/* Stock info */}
          {loadingStock ? (
            <p className="text-xs text-slate-400">Đang tải tồn kho…</p>
          ) : (
            <div className="flex gap-3 bg-slate-50 rounded-lg px-3 py-2">
              <div className="flex-1 text-center">
                <div className="text-[10px] text-slate-500 mb-0.5">Tồn thực tế</div>
                <div className="text-base font-bold tabular-nums text-slate-700">{stock?.cartons_imported ?? 0}</div>
                <div className="text-[9px] text-slate-400">thùng</div>
              </div>
              <div className="w-px bg-slate-200" />
              <div className="flex-1 text-center">
                <div className="text-[10px] text-slate-500 mb-0.5">Tồn khả dụng</div>
                <div className={`text-base font-bold tabular-nums ${remaining === 0 ? 'text-red-600' : 'text-green-600'}`}>{remaining}</div>
                <div className="text-[9px] text-slate-400">thùng</div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Số thùng xuất</Label>
            <Input
              type="number" min="0"
              className={`text-lg h-10 ${overStock ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
              value={cartons}
              onChange={e => { setCartons(parseInt(e.target.value) || 0); setErr(null) }}
            />
            {overStock && (
              <p className="text-xs text-amber-600">Vượt tồn khả dụng ({remaining} thùng)</p>
            )}
          </div>

          {err && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{err}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Hủy</Button>
          <Button size="sm" disabled={saving || remaining === 0}
            onClick={() => manualComplete(
              { gdoId, itemId, cartons },
              {
                onSuccess: onClose,
                onError: (e: any) => setErr(e?.response?.data?.error?.message ?? 'Lỗi khi lưu'),
              }
            )}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Items table ───────────────────────────────────────────────

function ItemsTable({ doRecords, gdoId, canScan, expandedItemIds, toggleExpand }: {
  doRecords: OutboundDelivery[]
  gdoId: string
  canScan: boolean
  expandedItemIds: Set<string>
  toggleExpand: (id: string) => void
}) {
  const navigate = useNavigate()
  const [inventoryItemId, setInventoryItemId] = useState<string | null>(null)
  const [manualDlg, setManualDlg] = useState<{ itemId: string; matName: string; cartons: number } | null>(null)
  const allItems = doRecords.flatMap(d =>
    d.items.map(i => ({ ...i, delivery_code: d.delivery_code, distributor_name: d.distributor_name }))
  )

  // Determine which optional columns have data
  const hasBatchRequired = allItems.some(i => i.batch_required)
  const hasDateRequired  = allItems.some(i => i.date_required != null && i.date_required > 0)
  const hasBoxes         = allItems.some(i => i.boxes_display > 0)
  const hasLoosePicking  = allItems.some(i => i.loose_picking > 0)
  const hasCsResp        = allItems.some(i => i.cs_responsible)
  const totalCols = 6 + [hasBoxes, hasLoosePicking, hasBatchRequired, hasDateRequired, hasCsResp].filter(Boolean).length

  const inventoryItem = inventoryItemId ? allItems.find(i => i.id === inventoryItemId) : null

  return (
    <>
    {inventoryItem && (
      <InventoryModal
        gdoId={gdoId}
        itemId={inventoryItem.id}
        matCode={inventoryItem.material?.material_code ?? inventoryItem.material_code_raw ?? '—'}
        matName={inventoryItem.material?.short_name ?? inventoryItem.material_code_raw ?? '—'}
        onClose={() => setInventoryItemId(null)}
      />
    )}
    {manualDlg && (
      <ManualCompleteDialog
        gdoId={gdoId}
        itemId={manualDlg.itemId}
        matName={manualDlg.matName}
        initialCartons={manualDlg.cartons}
        onClose={() => setManualDlg(null)}
      />
    )}
    <Table className="min-w-[540px]">
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Mã hàng</TableHead>
            <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5">Tên hàng</TableHead>
            <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Thùng</TableHead>
            <TableHead className="text-[9px] font-medium text-slate-500 px-1 py-1.5 text-center w-8">Kho</TableHead>
            {hasBoxes         && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Hộp</TableHead>}
            {hasLoosePicking  && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">Nhặt lẻ</TableHead>}
            {hasBatchRequired && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Batch</TableHead>}
            {hasDateRequired  && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 text-right whitespace-nowrap">%Date</TableHead>}
            {hasCsResp        && <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">CS</TableHead>}
            <TableHead className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">Số DO</TableHead>
            <TableHead className="w-5 px-1 py-1.5" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {allItems.map(item => {
            const textCls = itemTextCls(item)
            const rowBg   = itemRowBg(item)
            const matCode = item.material?.material_code ?? item.material_code_raw ?? '—'
            const matName = item.material?.short_name ?? item.material_code_raw ?? '—'
            const expanded = expandedItemIds.has(item.id)
            const scans = item.scan_entries ?? []
            const looseUnconfirmed = scans
              .filter(s => s.is_loose_picking && !s.loose_confirmed)
              .reduce((sum, s) => sum + s.cartons_scanned, 0)

            return (
              <Fragment key={item.id}>
              <TableRow
                className={`cursor-pointer transition-colors ${rowBg}`}
                onClick={() => navigate(`/wms/outbound/${gdoId}/items/${item.id}`)}
              >
                <TableCell className={`px-2 py-1 align-top whitespace-nowrap`}>
                  <div className={`text-[10px] font-mono font-semibold ${textCls}`}>{matCode}</div>
                </TableCell>
                <TableCell className={`px-2 py-1 align-top`}>
                  <div className={`text-[10px] font-medium leading-tight ${textCls}`}>{matName}</div>
                  <ProgressBar compact scanned={item.cartons_scanned} ordered={item.cartons_ordered} looseUnconfirmed={looseUnconfirmed} />
                  {(item.scan_entries?.length ?? 0) > 0 && (
                    <div className="text-[9px] text-slate-400 mt-0.5">{item.scan_entries.length} pallet</div>
                  )}
                </TableCell>
                <TableCell className={`px-2 py-1 align-top text-right whitespace-nowrap`}>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={`text-[10px] font-semibold tabular-nums ${textCls}`}>{item.cartons_ordered}</span>
                    {(() => {
                      const isManual = item.material?.no_qr_tracking === true
                      if (!canScan || item.status === 'COMPLETED') return null
                      return isManual ? (
                        <button
                          onClick={e => { e.stopPropagation(); setManualDlg({ itemId: item.id, matName: matName, cartons: item.cartons_ordered }) }}
                          className="flex items-center gap-0.5 text-[9px] font-medium text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 rounded px-1.5 py-0.5 transition-colors"
                          title="Lưu số lượng"
                        >
                          <PenSquare className="h-2.5 w-2.5" /> Lưu SL
                        </button>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/wms/outbound/${gdoId}/items/${item.id}?scan=1`) }}
                          className="flex items-center gap-0.5 text-[9px] font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded px-1.5 py-0.5 transition-colors"
                          title="Quét pallet"
                        >
                          <QrCode className="h-2.5 w-2.5" /> Quét
                        </button>
                      )
                    })()}
                  </div>
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
                {hasBoxes && (
                  <TableCell className="px-2 py-1 align-top text-right">
                    {item.boxes_display > 0
                      ? <span className={`text-[10px] tabular-nums ${textCls}`}>{item.boxes_display}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                {hasLoosePicking && (
                  <TableCell className="px-2 py-1 align-top text-right">
                    {item.loose_picking > 0
                      ? <span className={`text-[10px] tabular-nums ${textCls}`}>{item.loose_picking}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                {hasBatchRequired && (
                  <TableCell className="px-2 py-1 align-top">
                    {item.batch_required
                      ? <span className="text-[10px] text-slate-600">{item.batch_required}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                {hasDateRequired && (
                  <TableCell className="px-2 py-1 align-top text-right">
                    {item.date_required != null && item.date_required > 0
                      ? <span className="text-[10px] font-semibold tabular-nums text-amber-700">{item.date_required}%</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                {hasCsResp && (
                  <TableCell className="px-2 py-1 align-top">
                    {item.cs_responsible
                      ? <span className="text-[10px] text-slate-600">{item.cs_responsible}</span>
                      : <span className="text-[10px] text-slate-300">—</span>}
                  </TableCell>
                )}
                <TableCell className="px-2 py-1 align-top whitespace-nowrap">
                  <span className="text-[10px] text-slate-500 font-mono">{item.delivery_code}</span>
                </TableCell>
                <TableCell className="px-1 py-1 align-top">
                  {scans.length > 0 && (
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
                  <TableCell className="px-2 py-1.5 align-top border-b border-slate-100">
                    {item.header_text && (
                      <p className="text-[9px] text-red-600 leading-snug">{item.header_text}</p>
                    )}
                  </TableCell>
                  <TableCell colSpan={totalCols - 1} className="px-0 py-0 border-b border-slate-100">
                    <div className="pl-3 pr-3 py-1.5 border-l-2 border-slate-200">
                      {scans.length === 0 ? (
                        <p className="text-[10px] italic text-slate-400">Chưa có pallet nào được quét</p>
                      ) : (
                        <table className="w-full border-collapse">
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
                            {scans.map(se => {
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
                                    {se.pct_date !== null ? (
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
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
            )
          })}
        </TableBody>
    </Table>
    </>
  )
}

// ─── Pinned vehicle btn — tự validate GDO tồn tại, ẩn và unpin nếu đã bị xóa ──

function PinnedVehicleBtn({ v, isCurrent, onUnpin, onNavigate }: {
  v: { id: string; group_code: string; status: string }
  isCurrent: boolean
  onUnpin: (id: string) => void
  onNavigate: (id: string) => void
}) {
  const { isError, isLoading } = useGDO(isCurrent ? undefined : v.id)
  const isGone = !isCurrent && !isLoading && isError

  useEffect(() => {
    if (isGone) onUnpin(v.id)
  }, [isGone, v.id, onUnpin])

  if (isGone) return null

  return (
    <button
      onClick={() => onNavigate(v.id)}
      className={[
        'flex items-center gap-1 px-3 py-1.5 text-[10px] border-b-2 transition-colors shrink-0',
        isCurrent
          ? 'border-amber-500 bg-amber-100 text-amber-800 font-semibold cursor-default'
          : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-amber-50 cursor-pointer',
      ].join(' ')}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 mr-0.5 ${
        v.status === 'IN_PROGRESS' ? 'bg-amber-500'
        : v.status === 'COMPLETED'  ? 'bg-green-500'
        : v.status === 'PAUSED'     ? 'bg-red-500'
        : 'bg-slate-300'
      }`} />
      {v.group_code}
    </button>
  )
}

// ─── Main page ─────────────────────────────────────────────────

export default function OutboundDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)

  const { data: gdo, isLoading, isError } = useGDO(id)
  const { mutate: assignGDO,    isPending: assigning   } = useAssignGDO()
  const { mutate: patchGDO,     isPending: patching    } = usePatchGDO()
  const { mutate: deleteGDO } = useDeleteGDO()
  const { mutate: unassignGDO,  isPending: unassigning } = useUnassignGDO()
  const { mutate: unstartGDO,   isPending: unstarting  } = useUnstartGDO()
  const { mutate: uncompleteGDO, isPending: uncompleting } = useUncompleteGDO()
  const { vehicles, pin, unpin, isPinned, update } = useActiveVehiclesStore()
  const pinned = isPinned(id ?? '')

  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canManagePause = can(perms, 'outbound', 'start')

  const [showStart,         setShowStart]         = useState(false)
  const [showEditTransport, setShowEditTransport] = useState(false)
  const [showEditGDO,       setShowEditGDO]       = useState(false)
  const [undoErr,           setUndoErr]           = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string; message: string; onConfirm: () => void
  } | null>(null)
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set())

  function toggleExpandItem(itemId: string) {
    setExpandedItemIds(prev => { const n = new Set(prev); n.has(itemId) ? n.delete(itemId) : n.add(itemId); return n })
  }

  function doUndo(mutateFn: (id: string, opts: { onError: (e: unknown) => void }) => void) {
    setUndoErr(null)
    mutateFn(id!, {
      onError: (e) => {
        const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi không xác định'
        setUndoErr(msg)
      },
    })
  }

  function handleDelete() {
    if (!gdo) return
    if (!confirm(`Xóa đơn "${gdo.group_code}"?\nHành động này không thể hoàn tác.`)) return
    deleteGDO(gdo.id, {
      onSuccess: () => navigate('/wms/outbound'),
      onError: (err) => {
        const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi xóa đơn'
        alert(msg)
      },
    })
  }

  useEffect(() => {
    if (gdo) update(gdo.id, gdo.status)
  }, [gdo?.status, gdo?.id])

  // Auto-redirect khi đơn không còn tồn tại (bị xóa, API trả 404)
  useEffect(() => {
    if (!isLoading && (isError || !gdo)) {
      if (id) unpin(id)
      navigate('/wms/outbound', { replace: true })
    }
  }, [isLoading, isError, gdo, navigate, id, unpin])

  if (isLoading || !gdo) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
      </div>
    )
  }

  const allDOs    = gdo.delivery_orders ?? []
  const allItems  = allDOs.flatMap(d => d.items)
  const countable = allItems.filter(i => !i.material?.no_qr_tracking)
  const totalOrdered = countable.reduce((s, i) => s + i.cartons_ordered, 0)
  const totalScanned = countable.reduce((s, i) => s + i.cartons_scanned, 0)
  const manualItems  = allItems.filter(i => i.material?.no_qr_tracking === true)
  const allManualDone = manualItems.every(i => i.status === 'COMPLETED')
  const scanComplete  = countable.length === 0 || (totalOrdered > 0 && totalScanned >= totalOrdered)
  const canComplete   = allItems.length > 0 && scanComplete && allManualDone

  const npp = [...new Set(allDOs.map(d => d.distributor_name).filter(Boolean))].join(', ')

  // Workflow state
  const canStart       = !!gdo.assigned_at && !gdo.started_at && can(perms, 'outbound', 'start')
  const hasScanEntries = allItems.some(i => i.cartons_scanned > 0)
  // Nhặt lẻ chưa confirm không tính là scan cản trở gỡ bắt đầu
  const hasBlockingScans = allItems.some(i =>
    (i.scan_entries ?? []).some(s => !s.is_loose_picking || s.loose_confirmed)
  )

  const hasAnyExpanded = expandedItemIds.size > 0
  function toggleExpandAll() {
    if (hasAnyExpanded) {
      setExpandedItemIds(new Set())
    } else {
      setExpandedItemIds(new Set(allItems.filter(i => (i.scan_entries?.length ?? 0) > 0).map(i => i.id)))
    }
  }

  return (
    <>
      {showStart && (
        <StartDialog open={showStart} gdo={gdo} onClose={() => setShowStart(false)} />
      )}
      {showEditTransport && (
        <EditTransportDialog open={showEditTransport} gdo={gdo} onClose={() => setShowEditTransport(false)} />
      )}
      {showEditGDO && (
        <EditGDOModal
          gdoId={gdo.id}
          defaultWarehouseId={gdo.warehouse_id ?? ''}
          onClose={() => setShowEditGDO(false)}
        />
      )}
      {pendingConfirm && (
        <Dialog open onOpenChange={v => { if (!v) setPendingConfirm(null) }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader><DialogTitle className="text-base">{pendingConfirm.title}</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-600 py-1">{pendingConfirm.message}</p>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingConfirm(null)}>Không</Button>
              <Button size="sm" onClick={() => { pendingConfirm.onConfirm(); setPendingConfirm(null) }}>Xác nhận</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <div className="flex flex-col h-full min-h-0">

        {/* ── Header: ~20% ── */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '22vh' }}>

          {/* Row 1: back + code + status + buttons */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <button onClick={() => navigate('/wms/outbound')}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </button>
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
            </div>
            <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
              {/* ── Edit / Delete ── */}
              {(gdo.status === 'PENDING' || gdo.status === 'PAUSED') && can(perms, 'outbound', 'edit') && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1 px-1.5 sm:px-2"
                  title="Sửa"
                  onClick={() => setShowEditGDO(true)}>
                  <PenSquare className="h-3 w-3" /><span className="hidden sm:inline">Sửa</span>
                </Button>
              )}
              {gdo.status === 'PENDING' && can(perms, 'outbound', 'cancel') && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1 px-1.5 sm:px-2 border-red-200 text-red-600 hover:bg-red-50"
                  title="Xóa đơn"
                  onClick={handleDelete}>
                  <Trash2 className="h-3 w-3" /><span className="hidden sm:inline">Xóa</span>
                </Button>
              )}
              {/* ── Forward actions ── */}
              {!gdo.assigned_at && can(perms, 'outbound', 'assign') && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 px-1.5 sm:px-2" disabled={assigning}
                  title="Giao đơn"
                  onClick={() => setPendingConfirm({
                    title: 'Giao đơn',
                    message: `Xác nhận giao đơn ${gdo.group_code}?`,
                    onConfirm: () => assignGDO({ id: gdo.id, assigned_by: user?.name ?? undefined }),
                  })}>
                  <ClipboardList className="h-3 w-3" />
                  <span className="hidden sm:inline">{assigning ? '…' : 'Giao đơn'}</span>
                </Button>
              )}
              {canStart && (
                <Button size="sm" className="h-7 text-xs gap-1 px-1.5 sm:px-2" title="Bắt đầu" onClick={() => setShowStart(true)}>
                  <Play className="h-3 w-3" /><span className="hidden sm:inline">Bắt đầu</span>
                </Button>
              )}
              {gdo.status === 'IN_PROGRESS' && canComplete && can(perms, 'outbound', 'complete') && (
                <Button size="sm"
                  className="h-7 text-xs gap-1 px-1.5 sm:px-2 bg-green-600 hover:bg-green-700"
                  disabled={patching}
                  title="Hoàn thành"
                  onClick={() => setPendingConfirm({
                    title: 'Hoàn thành',
                    message: `Xác nhận hoàn thành chuyến ${gdo.group_code}?`,
                    onConfirm: () => patchGDO({ id: gdo.id, status: 'COMPLETED' }),
                  })}>
                  <CheckCircle2 className="h-3 w-3" />
                  <span className="hidden sm:inline">{patching ? '…' : 'Hoàn thành'}</span>
                </Button>
              )}
              {canManagePause && gdo.status === 'IN_PROGRESS' && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1 px-1.5 sm:px-2 border-red-200 text-red-600 hover:bg-red-50"
                  disabled={patching}
                  title="Tạm dừng"
                  onClick={() => patchGDO({ id: gdo.id, status: 'PAUSED' })}>
                  <Pause className="h-3 w-3" />
                  <span className="hidden sm:inline">{patching ? '…' : 'Tạm dừng'}</span>
                </Button>
              )}
              {canManagePause && gdo.status === 'PAUSED' && (
                <Button size="sm" className="h-7 text-xs gap-1 px-1.5 sm:px-2 bg-green-600 hover:bg-green-700"
                  disabled={patching}
                  title="Tiếp tục"
                  onClick={() => patchGDO({ id: gdo.id, status: 'IN_PROGRESS' })}>
                  <Play className="h-3 w-3" />
                  <span className="hidden sm:inline">{patching ? '…' : 'Tiếp tục'}</span>
                </Button>
              )}
              {hasScanEntries && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1 px-1.5 sm:px-2 border-slate-200 text-slate-500 hover:bg-slate-50"
                  onClick={toggleExpandAll}
                  title={hasAnyExpanded ? 'Thu gọn tất cả' : 'Xem pallet đã quét'}
                >
                  <ChevronDown className={`h-3 w-3 transition-transform ${hasAnyExpanded ? 'rotate-180' : ''}`} />
                  <span className="hidden sm:inline">{hasAnyExpanded ? 'Thu gọn' : 'Pallet'}</span>
                </Button>
              )}

              {/* ── Undo actions ── */}
              {can(perms, 'outbound', 'uncomplete') && gdo.status === 'COMPLETED' && (() => {
                const ts = gdo.transfer_status as string | null
                const tsLabel: Record<string, string> = { IN_TRANSIT: 'Đang vận chuyển', RECEIVING: 'Đang nhận', DELIVERED: 'Đã giao' }
                const blockedByTransfer = ts === 'RECEIVING' || ts === 'DELIVERED'
                const tooltip = blockedByTransfer
                  ? `Tình trạng bên Booking chuyển kho là "${tsLabel[ts!]}" — hủy phiếu nhập ở kho NPP để có thể bỏ HT`
                  : ts === 'IN_TRANSIT' ? 'Bỏ hoàn thành sẽ xóa lệnh TMS chuyển kho' : undefined
                const btn = (
                  <Button size="sm" variant="outline"
                    className="h-7 text-xs gap-1 px-1.5 sm:px-2 border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                    disabled={uncompleting || blockedByTransfer}
                    onClick={() => doUndo((id, opts) => uncompleteGDO(id, opts))}>
                    <RotateCcw className="h-3 w-3" />
                    <span className="hidden sm:inline">{uncompleting ? '…' : 'Bỏ HT'}</span>
                  </Button>
                )
                if (!tooltip) return btn
                return (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">{btn}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[260px] text-xs text-center">
                        {tooltip}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )
              })()}
              {can(perms, 'outbound', 'unstart') && !!gdo.started_at && gdo.status !== 'COMPLETED' && gdo.status !== 'PAUSED' && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1 px-1.5 sm:px-2 border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  disabled={unstarting || hasBlockingScans}
                  title={hasBlockingScans ? 'Xóa hết QR đã quét trước' : 'Gỡ bắt đầu'}
                  onClick={() => doUndo((id, opts) => unstartGDO(id, opts))}>
                  <RotateCcw className="h-3 w-3" />
                  <span className="hidden sm:inline">{unstarting ? '…' : 'Gỡ BĐ'}</span>
                </Button>
              )}
              {can(perms, 'outbound', 'unassign') && !!gdo.assigned_at && !gdo.started_at && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1 px-1.5 sm:px-2 border-slate-300 text-slate-500 hover:bg-slate-50"
                  disabled={unassigning}
                  title="Gỡ giao đơn"
                  onClick={() => doUndo((id, opts) => unassignGDO(id, opts))}>
                  <RotateCcw className="h-3 w-3" />
                  <span className="hidden sm:inline">{unassigning ? '…' : 'Gỡ GĐ'}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Row 2: GDO info compact */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium">{format(parseISO(gdo.delivery_date), 'dd-MM-yy', { locale: vi })}</span>
              {gdo.delivery_date !== gdo.planned_date && (
                <span className="text-amber-600 ml-0.5">(KH {format(parseISO(gdo.planned_date), 'dd-MM')})</span>
              )}
            </span>
            {gdo.dvvt && <span>{gdo.dvvt}</span>}
            {npp && <span className="text-slate-500 break-words">{npp}</span>}
            {(gdo.delivery_codes?.length ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <span className="text-slate-400">DO</span>
                <span className="font-mono text-slate-700 font-semibold">{gdo.delivery_codes!.join(' · ')}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium">{totalScanned}/{totalOrdered}</span> thùng
            </span>
          </div>

          {/* Start info */}
          {gdo.started_at && (
            <Card className="px-2 py-1 bg-blue-50 border-blue-200">
              <div className="flex items-start justify-between gap-1">
                <div className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-slate-700">
                  <span><strong>Biển số:</strong> {gdo.license_plate}</span>
                  {gdo.container_number && <span><strong>Cont:</strong> {gdo.container_number}</span>}
                  {gdo.exporter_name    && <span><strong>Xuất:</strong> {gdo.exporter_name}</span>}
                  {gdo.loader_name      && <span><strong>Bốc:</strong> {gdo.loader_name}</span>}
                  <span className="text-slate-400">{formatDateTime(gdo.started_at)}</span>
                </div>
                {can(perms, 'outbound', 'edit') && gdo.status !== 'COMPLETED' && (
                  <button
                    onClick={() => setShowEditTransport(true)}
                    className="shrink-0 p-1 rounded hover:bg-blue-200 text-blue-600 transition-colors"
                    title="Sửa thông tin xe"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
            </Card>
          )}

          {(gdo.assigned_at || gdo.scan_completed_at || gdo.completed_at) && (
            <div className="flex flex-wrap gap-x-4 gap-y-0 text-[10px] font-medium">
              {gdo.assigned_at && (
                <span className="text-green-600">
                  Giao đơn:{gdo.assigned_by ? <span className="font-normal text-slate-500"> {gdo.assigned_by} · </span> : ' '}
                  {formatDateTime(gdo.assigned_at)}
                </span>
              )}
              {gdo.scan_completed_at && (
                <span className="text-pink-600">Quét xong: {formatDateTime(gdo.scan_completed_at)}</span>
              )}
              {gdo.completed_at && (
                <span className="text-blue-600">Kết thúc: {formatDateTime(gdo.completed_at)}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-0 text-[10px] text-slate-400">
            {gdo.created_by && (
              <span>Tạo bởi: <span className="text-slate-600 font-medium">{gdo.created_by}</span>{gdo.created_at ? <span className="ml-1">{formatDateTime(gdo.created_at)}</span> : null}</span>
            )}
            {!gdo.created_by && gdo.created_at && (
              <span>Ngày tạo: <span className="text-slate-600">{formatDateTime(gdo.created_at)}</span></span>
            )}
            {gdo.updated_by && (
              <span>Sửa bởi: <span className="text-slate-600 font-medium">{gdo.updated_by}</span>{gdo.updated_at ? <span className="ml-1">{formatDateTime(gdo.updated_at)}</span> : null}</span>
            )}
          </div>

          {undoErr && (
            <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-xs text-red-700 flex items-center gap-1">
              <span>{undoErr}</span>
              <button className="ml-auto" onClick={() => setUndoErr(null)}><X className="h-3 w-3" /></button>
            </div>
          )}
          <ProgressBar scanned={totalScanned} ordered={totalOrdered} />
        </div>

        {/* Quick-switch bar — nằm ngoài header để không gây scroll */}
        {vehicles.length > 0 && (
          <div className="flex overflow-x-auto shrink-0 border-b bg-amber-50/60 gap-0 scrollbar-none">
            <span className="text-[9px] text-amber-600 font-medium px-2 py-1.5 shrink-0 border-r border-amber-200">Đang làm:</span>
            {vehicles.map(v => (
              <PinnedVehicleBtn
                key={v.id}
                v={v}
                isCurrent={v.id === id}
                onUnpin={unpin}
                onNavigate={id => navigate(`/wms/outbound/${id}`)}
              />
            ))}
          </div>
        )}

        {/* ── Items table: ~80% ── */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {allDOs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">Chưa có DO nào</p>
            </div>
          ) : (
            <ItemsTable
              doRecords={allDOs}
              gdoId={id!}
              canScan={!!gdo.started_at && gdo.status !== 'PAUSED' && gdo.status !== 'COMPLETED'}
              expandedItemIds={expandedItemIds}
              toggleExpand={toggleExpandItem}
            />
          )}
        </div>
      </div>
    </>
  )
}
