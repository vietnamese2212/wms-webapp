import { useState, useEffect, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { formatDateTime, formatTimestampTime, normalizeLicensePlate } from '@/utils/formatters'
import {
  ArrowLeft, CheckCircle2,
  Truck, Package, ClipboardList, Play, Pause, ChevronRight, ChevronDown, Bookmark, X, RotateCcw, Pencil, QrCode, Search, PenSquare, Trash2,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { Label }   from '@/components/ui/label'
import { Card }    from '@/components/ui/card'
import { toast }   from '@/components/ui/use-toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FormSheet } from '@/components/shared/FormSheet'
import { usePopoverAnchor } from '@/components/shared/usePopoverAnchor'
import {
  useGDO, useAssignGDO, useStartGDO, useWarehouseEmployees, usePatchGDO,
  useUnassignGDO, useUnstartGDO, useUncompleteGDO, useUpdateTransport,
  useItemInventory, useManualItemStock, useDeleteGDO, useManualCompleteItem, type ItemInventoryEntry,
  useActiveGateRegistrations, useGDOs, useOutboundShortages,
} from '@/api/hooks'
import { ShortageBadge } from '@/components/shared/ShortageBadge'
import { EditGDOModal, gdoKey } from './Outbound'
import { statusText } from '@/lib/rowStatus'
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

type EmpOption = { id: string; name: string; employee_code?: string; job_title?: string | null }

// Lái xe nâng = nhân viên có chức danh CHỨA "lái xe nâng" (không phân biệt hoa thường)
const isForkliftDriver = (e: EmpOption) => (e.job_title ?? '').toLowerCase().includes('lái xe nâng')

// Dropdown tìm kiếm chung (portal VÀO node Dialog qua usePopoverAnchor) — có ô tìm theo tên / mã NV
function PersonSearchMenu({ options, onPick, placeholder }: {
  options: EmpOption[]
  onPick: (e: EmpOption) => void
  placeholder: string
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const anchor = usePopoverAnchor(triggerRef, open)
  const q = search.trim().toLowerCase()
  const filtered = options.filter(e =>
    e.name.toLowerCase().includes(q) || (e.employee_code ?? '').toLowerCase().includes(q))
  const close = () => { setOpen(false); setSearch('') }
  return (
    <div className="relative">
      <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between h-7 text-xs border border-dashed border-input rounded px-2 text-slate-500 hover:bg-slate-50">
        <span>{placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      </button>
      {open && anchor && createPortal(
        <>
          <div className="fixed inset-0 z-[190] pointer-events-auto" onClick={close} />
          <div className="z-[200] pointer-events-auto min-w-[220px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden" style={anchor.style}>
            <div className="p-2 border-b border-slate-100">
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} autoFocus
                placeholder="Tìm tên / mã NV…"
                className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-400" />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-[11px] text-slate-400 text-center py-3">Không tìm thấy</p>
              ) : filtered.map(e => (
                <button key={e.id} type="button" onClick={() => { onPick(e); close() }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-left">
                  <span className="text-[11px] text-slate-700 flex-1 truncate">{e.name}</span>
                  {e.employee_code && <span className="text-[10px] text-slate-400 font-mono shrink-0">{e.employee_code}</span>}
                </button>
              ))}
            </div>
          </div>
        </>,
        anchor.target,
      )}
    </div>
  )
}

// Picker theo ID (Lái xe nâng — cần forklift_driver_id) — có ô tìm
function TagPicker({
  fixedName, employees, selectedIds, onChange, placeholder = 'Thêm người…',
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
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-medium">{fixedName}</span>
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
        <PersonSearchMenu options={unselected} placeholder={placeholder} onPick={e => onChange([...selectedIds, e.id])} />
      )}
    </div>
  )
}

// Picker theo TÊN (Người xuất — backend lưu exporter_name dạng chuỗi tên) — có ô tìm, KHÔNG gõ tự do
function NamePicker({
  fixedName, employees, value, onChange, placeholder = 'Thêm người…',
}: {
  fixedName?: string
  employees: EmpOption[]
  value: string[]                       // danh sách TÊN đã chọn (ngoài fixedName)
  onChange: (names: string[]) => void
  placeholder?: string
}) {
  const chosen = new Set([...(fixedName ? [fixedName] : []), ...value])
  const options = employees.filter(e => !chosen.has(e.name))
  return (
    <div className="rounded-md border border-input bg-background px-2 py-2 space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[22px]">
        {fixedName && (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-medium">{fixedName}</span>
        )}
        {value.map(nm => (
          <span key={nm} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
            {nm}
            <button type="button" onClick={() => onChange(value.filter(x => x !== nm))}>
              <X className="h-3 w-3 text-slate-400 hover:text-red-500" />
            </button>
          </span>
        ))}
      </div>
      <PersonSearchMenu options={options} placeholder={placeholder} onPick={e => onChange([...value, e.name])} />
    </div>
  )
}

// ─── Picker chọn CHUYẾN (nút mở dialog thẻ, giống bên Nhập) — dùng chung Start + Sửa thông tin xe ───
type GateRegOpt = { id: string; registration_number: number; license_plate: string | null; company_name_raw?: string | null; warehouse_id?: string | null; vehicle_type?: string | null; status: string; entry_at: string | null; exit_at: string | null; date: string }

function ChuyenPicker({ gates, value, onPick, freePlate, onFreeText, special, onSpecialChange, takenGateIds, outDate }: {
  gates: GateRegOpt[]                          // chỉ chuyến đã vào cổng (entry_at) — CHƯA lọc theo special
  value: string; onPick: (id: string) => void
  freePlate: string; onFreeText: (plate: string) => void
  special: boolean; onSpecialChange: (v: boolean) => void
  takenGateIds: Set<string>
  outDate: string                             // ngày xuất của đơn — highlight đỏ nếu ngày xe khác ngày này
}) {
  const [open, setOpen] = useState(false)
  const [walk, setWalk] = useState('')
  const fmtT = (ts: string | null) => ts ? formatTimestampTime(ts).slice(0, 5) : '—'
  const fmtD = (d: string) => { try { return format(parseISO(d), 'dd/MM/yyyy') } catch { return d } }
  const selected = gates.find(g => g.id === value)
  // Rule (không đổi): mặc định CHỈ xe đang trong cổng (IN) + chưa bị phiếu khác gắn; đặc biệt → cả xe đã ra / đã gắn.
  const base = gates.filter(g => special ? true : (g.status === 'IN' && !takenGateIds.has(g.id)))
  // Giữ chuyến đang gắn trong danh sách dù bị lọc (để không mất link khi sửa)
  const list = selected && !base.some(g => g.id === selected.id) ? [selected, ...base] : base
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.entry_at ?? '').localeCompare(a.entry_at ?? ''))
  // Lần = lượt thứ mấy của CÙNG (kho · loại xe · ngày · biển số) — cùng một xe vào nhiều lượt thì Lần 1,2,3…
  // Tính trên TẤT CẢ chuyến đã vào (không đổi khi bật/tắt đặc biệt).
  const gateLane = (() => {
    const cnt = new Map<string, number>()
    const m = new Map<string, number>()
    const keyOf = (g: GateRegOpt) => `${g.date}|${g.warehouse_id ?? ''}|${g.vehicle_type ?? ''}|${g.license_plate ?? ''}`
    for (const g of [...gates].sort((a, b) => a.date.localeCompare(b.date) || a.registration_number - b.registration_number)) {
      const c = (cnt.get(keyOf(g)) ?? 0) + 1
      cnt.set(keyOf(g), c)
      m.set(g.id, c)
    }
    return m
  })()
  const freeVal = normalizeLicensePlate(walk)
  const commitFree = () => { if (!freeVal) return; onFreeText(freeVal); setWalk(''); setOpen(false) }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="w-full h-10 flex items-center justify-between px-2 rounded-md border border-input bg-white text-sm hover:bg-slate-50">
        {selected ? (
          <span className="truncate">
            <span className="font-mono font-semibold">{selected.license_plate ?? '—'}</span>
            {selected.company_name_raw && <span className="ml-1.5 text-slate-500 text-xs">{selected.company_name_raw}</span>}
            {gateLane.get(selected.id) && <span className="ml-1.5 text-slate-400 text-xs">· Lần {gateLane.get(selected.id)}</span>}
            {selected.date !== outDate && <span className="ml-1.5 text-red-600 font-semibold text-xs">· {fmtD(selected.date)}</span>}
          </span>
        ) : freePlate ? (
          <span className="truncate"><span className="font-mono font-semibold">{freePlate}</span><span className="ml-1.5 text-amber-600 text-xs">vãng lai</span></span>
        ) : (
          <span className="text-slate-400">Chọn chuyến xe…</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-1" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-1">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-sm">Chọn chuyến xe</DialogTitle>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400">{sorted.length} xe</span>
                <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer select-none">
                  <input type="checkbox" checked={special}
                    onChange={e => onSpecialChange(e.target.checked)}
                    className="h-3 w-3 rounded accent-amber-600" />
                  <span>Trường hợp đặc biệt (xe đã ra / vãng lai)</span>
                </label>
              </div>
            </div>
          </DialogHeader>

          {/* Nhập biển số xe vãng lai — chỉ khi đặc biệt */}
          {special && (
            <div className="space-y-1">
              <div className="flex gap-1">
                <Input className="h-8 text-xs" placeholder="Nhập biển số xe vãng lai…"
                  value={walk} onChange={e => setWalk(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitFree() } }} />
                <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" disabled={!freeVal} onClick={commitFree}>Dùng</Button>
              </div>
              {freeVal && <p className="text-[10px] text-amber-600">✎ Dùng biển số vãng lai: «{freeVal}»</p>}
            </div>
          )}

          <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-0.5">
            {(value || freePlate) && (
              <button type="button" className="w-full text-left rounded px-2 py-1 text-[11px] text-red-500 hover:bg-slate-50"
                onClick={() => { onPick(''); onFreeText(''); setOpen(false) }}>✕ Xóa chọn</button>
            )}
            {sorted.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-4">
                {special ? 'Không có chuyến trong 3 ngày' : 'Không có xe đang trong cổng — tích "Trường hợp đặc biệt" để xem xe đã ra / nhập vãng lai'}
              </div>
            ) : sorted.map(g => {
              const isTaken = takenGateIds.has(g.id) && g.id !== value
              return (
                <button key={g.id} type="button"
                  onClick={() => { onPick(g.id); setOpen(false) }}
                  className={`w-full text-left rounded border px-2 py-1 transition-colors ${
                    g.id === value ? 'border-amber-400 bg-amber-50'
                      : g.status !== 'IN' ? 'border-slate-200 bg-slate-50 hover:border-amber-200'
                        : 'border-slate-200 bg-white hover:border-amber-200 hover:bg-amber-50/40'}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-[11px] text-slate-800">{g.license_plate ?? '—'}</span>
                    {g.company_name_raw && <span className="text-[10px] text-slate-500 truncate">{g.company_name_raw}</span>}
                    {g.status !== 'IN' && <span className="text-[8px] px-1 py-0.5 rounded bg-slate-200 text-slate-500 shrink-0">đã ra</span>}
                    <span className="ml-auto text-[9px] text-slate-400 shrink-0">Lần {gateLane.get(g.id)} · <span className={g.date !== outDate ? 'text-red-600 font-semibold' : ''}>{fmtD(g.date)}</span> vào {fmtT(g.entry_at)}{g.exit_at ? ` · ra ${fmtT(g.exit_at)}` : ''}</span>
                  </div>
                  {isTaken && <div className="text-[9px] text-amber-600 mt-0.5">⚠ Đã gắn phiếu khác — chỉ dùng nếu bốc thêm đơn cùng chuyến</div>}
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
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
  const [exporterNames,    setExporterNames]    = useState<string[]>([])   // người xuất phụ (ngoài user hiện tại), lưu theo TÊN
  const [forklifterIds,    setForklifterIds]    = useState<string[]>([])
  const [gateRegId,        setGateRegId]        = useState('')
  const [special,          setSpecial]          = useState(false)   // mở khóa: xe đã ra / bốc thêm đơn / vãng lai

  // ── Chuyến xe ở Đăng ký cổng (OUTBOUND, đã vào) — gắn biển số theo đúng CHUYẾN để báo cáo per-chuyến
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const threeDaysAgo = (() => { const d = new Date(today); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10) })()
  const { data: gateRegs = [] } = useActiveGateRegistrations(
    gdo.warehouse_id ? { date_from: threeDaysAgo, date_to: today, warehouse_id: gdo.warehouse_id, direction: 'OUTBOUND' } : undefined
  )
  const { data: recentGdos = [] } = useGDOs(
    gdo.warehouse_id ? { warehouse_id: gdo.warehouse_id, date_from: threeDaysAgo, date_to: today } : undefined
  )
  const takenGateIds = new Set<string>()
  for (const g of recentGdos as GDO[]) if (g.gate_registration_id && g.id !== gdo.id) takenGateIds.add(g.gate_registration_id)

  type GateReg = { id: string; registration_number: number; license_plate: string | null; company_name_raw?: string | null; warehouse_id?: string | null; vehicle_type?: string | null; status: string; entry_at: string | null; exit_at: string | null; date: string }
  // Picker tự lọc theo "đặc biệt" — ở đây chỉ truyền các chuyến ĐÃ VÀO cổng (entry_at).
  const gatesWithEntry = (gateRegs as GateReg[]).filter(g => g.entry_at)
  const selectedGate = (gateRegs as GateReg[]).find(g => g.id === gateRegId)
  const effectivePlate = selectedGate?.license_plate ?? licPlate

  // Resolved names for submission
  const empMap = new Map((employees as EmpOption[]).map(e => [e.id, e.name]))
  const exporterName = [user?.name, ...exporterNames]
    .filter(Boolean).join(', ')
  const forklifterNames = forklifterIds.map(id => empMap.get(id) ?? id).filter(Boolean).join(', ')

  function handleSubmit() {
    if (!effectivePlate.trim()) { setErr('Vui lòng chọn chuyến xe đã vào cổng (hoặc nhập biển số ở Trường hợp đặc biệt)'); return }
    setErr(null)
    startGDO(
      {
        id:                   gdo.id,
        license_plate:        effectivePlate.trim(),
        container_number:     containerNum || undefined,
        exporter_name:        exporterName || undefined,
        loader_name:          loaderName   || undefined,
        forklift_driver_id:   forklifterIds[0] || undefined,
        forklift_driver_names: forklifterNames || undefined,
        gate_registration_id: gateRegId || undefined,
        allow_shared_gate:    special || undefined,
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
    <FormSheet
      open={open}
      onClose={() => onClose()}
      title="Bắt đầu xuất kho"
      widthClass="sm:max-w-lg"
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Hủy</Button>
        <Button size="sm" onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'Đang lưu…' : 'Bắt đầu'}
        </Button>
      </>}
    >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Chuyến xe / Biển số *</Label>
            <ChuyenPicker gates={gatesWithEntry} value={gateRegId}
              onPick={id => { setGateRegId(id); if (id) setLicPlate('') }}
              freePlate={licPlate} onFreeText={p => { setLicPlate(p); setGateRegId('') }}
              special={special} onSpecialChange={v => { setSpecial(v); if (!v) setLicPlate('') }}
              takenGateIds={takenGateIds} outDate={gdo.delivery_date} />
          </div>

          {special && !gateRegId && licPlate.trim() && (
            <p className="text-[11px] text-amber-600">⚠ Biển số chưa gắn đăng ký cổng (xe vãng lai / giao đêm).</p>
          )}

          {isContainer && (
            <div className="space-y-1">
              <Label className="text-xs">Số container</Label>
              <Input className="text-lg h-10" placeholder="VD: ABCD1234567"
                value={containerNum} onChange={e => setContainerNum(e.target.value.toUpperCase())} />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Người xuất</Label>
            <NamePicker
              fixedName={user?.name}
              employees={employees as EmpOption[]}
              value={exporterNames}
              onChange={setExporterNames}
              placeholder="Thêm người xuất…"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Lái xe nâng</Label>
            <TagPicker
              employees={(employees as EmpOption[]).filter(isForkliftDriver)}
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
    </FormSheet>
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
  const [exporterNames,   setExporterNames]   = useState<string[]>(
    (gdo.exporter_name ?? '').split(',').map(s => s.trim()).filter(Boolean)
  )
  const [loaderName,      setLoaderName]      = useState(gdo.loader_name ?? '')
  const [forklifterIds,   setForklifterIds]   = useState<string[]>(
    gdo.forklift_driver_id ? [gdo.forklift_driver_id] : []
  )
  const [gateRegId,       setGateRegId]       = useState(gdo.gate_registration_id ?? '')
  const [special,         setSpecial]         = useState(false)   // mặc định CHỈ xe đang trong cổng; muốn xe đã ra/vãng lai phải tự tích

  // ── Chuyến xe ở Đăng ký cổng (giống StartDialog) — đổi link gate theo đúng chuyến
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const threeDaysAgo = (() => { const d = new Date(today); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10) })()
  const { data: gateRegs = [] } = useActiveGateRegistrations(
    gdo.warehouse_id ? { date_from: threeDaysAgo, date_to: today, warehouse_id: gdo.warehouse_id, direction: 'OUTBOUND' } : undefined
  )
  const { data: recentGdos = [] } = useGDOs(
    gdo.warehouse_id ? { warehouse_id: gdo.warehouse_id, date_from: threeDaysAgo, date_to: today } : undefined
  )
  const takenGateIds = new Set<string>()
  for (const g of recentGdos as GDO[]) if (g.gate_registration_id && g.id !== gdo.id) takenGateIds.add(g.gate_registration_id)

  type GateReg = { id: string; registration_number: number; license_plate: string | null; company_name_raw?: string | null; warehouse_id?: string | null; vehicle_type?: string | null; status: string; entry_at: string | null; exit_at: string | null; date: string }
  // Picker tự lọc theo "đặc biệt" + tự giữ chuyến đang gắn — ở đây chỉ truyền chuyến ĐÃ VÀO cổng.
  const gatesWithEntry = (gateRegs as GateReg[]).filter(g => g.entry_at)
  const selectedGate = (gateRegs as GateReg[]).find(g => g.id === gateRegId)
  const effectivePlate = selectedGate?.license_plate ?? licPlate

  const empMap = new Map((employees as EmpOption[]).map(e => [e.id, e.name]))
  const forklifterNames = forklifterIds.map(id => empMap.get(id) ?? id).filter(Boolean).join(', ')

  function handleSubmit() {
    if (!effectivePlate.trim()) { setErr('Vui lòng chọn chuyến xe đã vào cổng (hoặc nhập biển số ở Trường hợp đặc biệt)'); return }
    setErr(null)
    updateTransport(
      {
        id:                    gdo.id,
        license_plate:         effectivePlate.trim(),
        container_number:      containerNum  || undefined,
        exporter_name:         exporterNames.join(', ') || undefined,
        loader_name:           loaderName    || undefined,
        forklift_driver_id:    forklifterIds[0] || undefined,
        forklift_driver_names: forklifterNames  || undefined,
        gate_registration_id:  gateRegId || null,
        allow_shared_gate:     special || undefined,
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
    <FormSheet
      open={open}
      onClose={() => onClose()}
      title="Sửa thông tin xe"
      widthClass="sm:max-w-lg"
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Hủy</Button>
        <Button size="sm" onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'Đang lưu…' : 'Lưu'}
        </Button>
      </>}
    >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Chuyến xe / Biển số *</Label>
            <ChuyenPicker gates={gatesWithEntry} value={gateRegId}
              onPick={id => { setGateRegId(id); if (id) setLicPlate('') }}
              freePlate={licPlate} onFreeText={p => { setLicPlate(p); setGateRegId('') }}
              special={special} onSpecialChange={v => { setSpecial(v); if (!v) setLicPlate('') }}
              takenGateIds={takenGateIds} outDate={gdo.delivery_date} />
          </div>

          {special && !gateRegId && licPlate.trim() && (
            <p className="text-[11px] text-amber-600">⚠ Biển số chưa gắn đăng ký cổng (xe vãng lai / giao đêm).</p>
          )}

          {(isContainer || containerNum) && (
            <div className="space-y-1">
              <Label className="text-xs">Số container</Label>
              <Input className="text-lg h-10" placeholder="VD: ABCD1234567"
                value={containerNum} onChange={e => setContainerNum(e.target.value.toUpperCase())} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Người xuất</Label>
            <NamePicker
              employees={employees as EmpOption[]}
              value={exporterNames}
              onChange={setExporterNames}
              placeholder="Chọn người xuất…"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lái xe nâng</Label>
            <TagPicker
              employees={(employees as EmpOption[]).filter(isForkliftDriver)}
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
    </FormSheet>
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

  const remaining  = stock?.cartons_remaining ?? 0
  const ordered    = stock?.cartons_ordered ?? 0
  const overStock  = stock != null && cartons > remaining
  const overPlan   = stock != null && cartons > ordered

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
                <div className="text-[10px] text-slate-500 mb-0.5">Kế hoạch</div>
                <div className="text-base font-bold tabular-nums text-slate-700">{ordered}</div>
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
              className={`text-lg h-10 ${overPlan ? 'border-red-400 focus-visible:ring-red-400' : overStock ? 'border-amber-400 focus-visible:ring-amber-400' : ''}`}
              value={cartons}
              onChange={e => { setCartons(parseInt(e.target.value) || 0); setErr(null) }}
            />
            {overPlan && (
              <p className="text-xs text-red-600">Vượt kế hoạch ({ordered} thùng)</p>
            )}
            {!overPlan && overStock && (
              <p className="text-xs text-amber-600">Vượt tồn khả dụng ({remaining} thùng)</p>
            )}
          </div>

          {err && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{err}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Hủy</Button>
          <Button size="sm" disabled={saving || remaining === 0 || overStock || overPlan}
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

function ItemsTable({ doRecords, gdoId, canScan, hasScanPerm, expandedItemIds, toggleExpand, warehouseId, deliveryDate }: {
  doRecords: OutboundDelivery[]
  gdoId: string
  canScan: boolean
  hasScanPerm: boolean
  expandedItemIds: Set<string>
  toggleExpand: (id: string) => void
  warehouseId?: string | null
  deliveryDate?: string | null
}) {
  const navigate = useNavigate()
  // Cảnh báo thiếu tồn theo (kho, ngày giao) — badge cuối cột Mã hàng
  const { data: shortages = [] } = useOutboundShortages(warehouseId, deliveryDate)
  const shortageByMat = new Map(shortages.map(s => [s.material_id, s]))
  const [inventoryItemId, setInventoryItemId] = useState<string | null>(null)
  const [manualDlg, setManualDlg] = useState<{ itemId: string; matName: string; cartons: number } | null>(null)
  const allItems = doRecords.flatMap(d =>
    d.items.map(i => ({ ...i, delivery_code: d.delivery_code, distributor_name: d.distributor_name }))
  )

  // Group-by NPP: 1 chuyến nhiều NPP → tách khối theo NPP (in đậm + fill màu). 1 NPP → không cần header.
  const nppGroups = doRecords.map(d => ({
    npp: (d.distributor_name ?? '').trim(),
    delivery_code: d.delivery_code,
    items: d.items.map(i => ({ ...i, delivery_code: d.delivery_code, distributor_name: d.distributor_name })),
  })).filter(g => g.items.length > 0)
  const showGroups = new Set(nppGroups.map(g => g.npp)).size > 1

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
          {nppGroups.flatMap(g => [
            ...(showGroups ? [(
              <TableRow key={`npp-${g.npp}`} className="bg-sky-100 hover:bg-sky-100 border-t-2 border-sky-300">
                <TableCell colSpan={totalCols} className="px-2 py-1.5">
                  <span className="text-[11px] font-bold text-sky-900 uppercase tracking-wide">NPP: {g.npp || '—'}</span>
                  <span className="text-[9px] font-medium text-sky-700 ml-2">
                    {g.items.length} mã hàng · {g.items.reduce((s, i) => s + i.cartons_ordered, 0)} thùng
                  </span>
                </TableCell>
              </TableRow>
            )] : []),
            ...g.items.map(item => {
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
                  <div className={`text-[10px] font-mono font-semibold ${textCls}`}>
                    {matCode}
                    <ShortageBadge s={item.material_id ? shortageByMat.get(item.material_id) : undefined} />
                  </div>
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
                      // Cả 2 nút đều là "ghi nhận xuất" → cần trạng thái cho phép (canScan) + quyền outbound.scan
                      if (!canScan) return null
                      if (!hasScanPerm) return null
                      if (isManual) {
                        // "Lưu thủ công/Sửa SL": ghi nhận xuất cho hàng không QR (= quét thủ công)
                        return (
                          <button
                            onClick={e => { e.stopPropagation(); setManualDlg({ itemId: item.id, matName: matName, cartons: item.status === 'COMPLETED' ? item.cartons_scanned : item.cartons_ordered }) }}
                            className="flex items-center gap-0.5 text-[9px] font-medium text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100 rounded px-1.5 py-0.5 transition-colors"
                            title={item.status === 'COMPLETED' ? 'Sửa số lượng' : 'Lưu thủ công'}
                          >
                            <PenSquare className="h-2.5 w-2.5" /> {item.status === 'COMPLETED' ? 'Sửa SL' : 'Lưu thủ công'}
                          </button>
                        )
                      }
                      if (item.status === 'COMPLETED') return null
                      return (
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
                  {/* DO tham khảo: chỉ hiện DO đầu + "…" nếu có nhiều, hover xem đầy đủ */}
                  {(() => {
                    const codes = (item.delivery_code ?? '').split(',').map(s => s.trim()).filter(Boolean)
                    if (codes.length === 0) return <span className="text-[10px] text-slate-300">—</span>
                    const disp = codes.length > 1 ? `${codes[0]} …` : codes[0]
                    return <span className="text-[10px] text-slate-500 font-mono" title={codes.join(', ')}>{disp}</span>
                  })()}
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
          }),
          ])}
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
  const manualCompleteMulti = useManualCompleteItem()   // "Lưu tất cả theo KH" — bulk hàng không tem
  const [bulkErr, setBulkErr] = useState<string | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const { vehicles, pin, unpin, isPinned, update } = useActiveVehiclesStore()
  const pinned = isPinned(id ?? '')

  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canManagePause = can(perms, 'outbound', 'edit')  // Tạm dừng/Tiếp tục = patchGDO → route đòi outbound.edit

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
    setPendingConfirm({
      title: 'Xóa đơn',
      message: `Xóa đơn "${gdo.group_code}"? Hành động này không thể hoàn tác.`,
      onConfirm: () => deleteGDO(gdo.id, {
        onSuccess: () => navigate('/wms/outbound'),
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi xóa đơn'
          toast({ variant: 'destructive', title: 'Không xóa được đơn', description: msg })
        },
      }),
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
  // HEADER TEXT: gom ghi chú riêng biệt của mọi dòng hàng → hiện nổi bật (đỏ) ở header chuyến.
  const headerTexts = [...new Set(allItems.map(i => i.header_text?.trim()).filter(Boolean))] as string[]
  const countable = allItems.filter(i => !i.material?.no_qr_tracking)
  const totalOrdered = countable.reduce((s, i) => s + i.cartons_ordered, 0)
  const totalScanned = countable.reduce((s, i) => s + i.cartons_scanned, 0)
  // Hiển thị Kế hoạch/Đã xuất tính CẢ hàng no_qr (khớp Tổng thùng ở list); countable chỉ dùng cho canComplete.
  const totalOrderedAll = allItems.reduce((s, i) => s + i.cartons_ordered, 0)
  const totalScannedAll = allItems.reduce((s, i) => s + i.cartons_scanned, 0)
  const manualItems  = allItems.filter(i => i.material?.no_qr_tracking === true)
  const allManualDone = manualItems.every(i => i.status === 'COMPLETED')
  const scanComplete  = countable.length === 0 || (totalOrdered > 0 && totalScanned >= totalOrdered)
  const canComplete   = allItems.length > 0 && scanComplete && allManualDone

  const npp = [...new Set(allDOs.map(d => d.distributor_name).filter(Boolean))].join(', ')

  // Workflow state
  // Kho QTY/NONE: không bắt buộc Phân công trước — BE tự gán người bấm Bắt đầu (kho QR giữ nghi thức)
  const whInvMode = gdo.warehouse?.inventory_mode ?? null
  const canStart       = (!!gdo.assigned_at || (whInvMode !== null && whInvMode !== 'QR')) && !gdo.started_at && can(perms, 'outbound', 'start')

  // "Lưu tất cả theo kế hoạch" — ghi nhận song song mọi mã không tem chưa xong (= bấm Lưu thủ công từng mã)
  const manualPendingItems = manualItems.filter(i => i.status !== 'COMPLETED')
  async function bulkManualSave() {
    const targets = manualPendingItems
    setBulkErr(null); setBulkSaving(true)
    const results = await Promise.allSettled(targets.map(i =>
      manualCompleteMulti.mutateAsync({ gdoId: id!, itemId: i.id, cartons: i.cartons_ordered })
    ))
    setBulkSaving(false)
    const fails: string[] = []
    results.forEach((r, idx) => {
      if (r.status === 'rejected') {
        const msg = (r.reason as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'lỗi'
        fails.push(`${targets[idx].material?.material_code ?? targets[idx].material_code_raw ?? '?'}: ${msg}`)
      }
    })
    if (fails.length) setBulkErr(`Không ghi nhận được ${fails.length}/${targets.length} mã — ${fails.join(' · ')}`)
  }
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

      <div className="flex flex-col h-full sm:p-3">
       <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm overflow-hidden">

        {/* ── Header: ~20% ── */}
        <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 overflow-y-auto" style={{ maxHeight: '22vh' }}>

          {/* Row 1: back + code + status + buttons */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <button onClick={() => navigate('/wms/outbound')}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className={`font-mono font-semibold text-sm ${statusText(gdoKey(gdo))}`}>{gdo.group_code}</span>
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
              {gdo.status === 'IN_PROGRESS' && !!gdo.started_at && manualPendingItems.length > 0 && can(perms, 'outbound', 'scan') && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1 px-1.5 sm:px-2 border-green-300 text-green-700 hover:bg-green-50"
                  disabled={bulkSaving}
                  title={`Ghi nhận ${manualPendingItems.length} mã hàng không tem = đúng số kế hoạch (mã lệch thì Sửa SL lẻ sau)`}
                  onClick={() => setPendingConfirm({
                    title: 'Lưu tất cả theo kế hoạch',
                    message: `Ghi nhận ${manualPendingItems.length} mã hàng không tem = đúng số kế hoạch?`,
                    onConfirm: () => { void bulkManualSave() },
                  })}>
                  <PenSquare className="h-3 w-3" />
                  <span className="hidden sm:inline">{bulkSaving ? 'Đang lưu…' : 'Lưu tất cả theo KH'}</span>
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

          {/* Row 2: GDO info compact — kế thừa màu trạng thái như dòng ở list */}
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs ${statusText(gdoKey(gdo))}`}>
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium">{format(parseISO(gdo.delivery_date), 'dd-MM-yy', { locale: vi })}</span>
              {gdo.delivery_date !== gdo.planned_date && (
                <span className="text-amber-600 ml-0.5">(KH {format(parseISO(gdo.planned_date), 'dd-MM')})</span>
              )}
            </span>
            {gdo.dvvt && <span>{gdo.dvvt}</span>}
            {npp && <span className="break-words">{npp}</span>}
            {(gdo.delivery_codes?.length ?? 0) > 0 && (
              <span className="flex items-center gap-1 min-w-0 max-w-full">
                <span className="text-slate-400 shrink-0">DO</span>
                <span className="font-mono font-semibold truncate max-w-[420px]" title={gdo.delivery_codes!.join(' · ')}>{gdo.delivery_codes!.join(' · ')}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium">{totalScannedAll}/{totalOrderedAll}</span> thùng
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
                  Giao đơn:{gdo.assigned_by ? <span className="font-normal"> {gdo.assigned_by} · </span> : ' '}
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

          <div className={`flex flex-wrap gap-x-4 gap-y-0 text-[10px] ${statusText(gdoKey(gdo))}`}>
            {gdo.created_by && (
              <span>Tạo bởi: <span className="font-medium">{gdo.created_by}</span>{gdo.created_at ? <span className="ml-1">{formatDateTime(gdo.created_at)}</span> : null}</span>
            )}
            {!gdo.created_by && gdo.created_at && (
              <span>Ngày tạo: {formatDateTime(gdo.created_at)}</span>
            )}
            {gdo.updated_by && (
              <span>Sửa bởi: <span className="font-medium">{gdo.updated_by}</span>{gdo.updated_at ? <span className="ml-1">{formatDateTime(gdo.updated_at)}</span> : null}</span>
            )}
          </div>

          {/* CHUNG 1 ghi chú cho cả chuyến → hiện ở header (đỏ). Mỗi dòng có ghi chú RIÊNG → để trong bảng. */}
          {headerTexts.length === 1 && (
            <div className="rounded bg-red-50 border border-red-300 px-2 py-1">
              <p className="text-[11px] font-semibold text-red-600 leading-snug">{headerTexts[0]}</p>
            </div>
          )}

          {undoErr && (
            <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-xs text-red-700 flex items-center gap-1">
              <span>{undoErr}</span>
              <button className="ml-auto" onClick={() => setUndoErr(null)}><X className="h-3 w-3" /></button>
            </div>
          )}
          {bulkErr && (
            <div className="rounded bg-red-50 border border-red-200 px-2 py-1 text-xs text-red-700 flex items-center gap-1">
              <span>{bulkErr}</span>
              <button className="ml-auto" onClick={() => setBulkErr(null)}><X className="h-3 w-3" /></button>
            </div>
          )}
          <ProgressBar scanned={totalScannedAll} ordered={totalOrderedAll} />
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

        {/* Dải tile tổng hợp (đồng bộ với list) */}
        <SummaryBand tiles={[
          { label: 'DO',       value: allDOs.length },
          { label: 'Mã hàng',  value: allItems.length },
          { label: 'Đã xuất',  value: `${totalScannedAll.toLocaleString('vi-VN')} thùng`, accent: totalScannedAll > 0 },
          { label: 'Kế hoạch', value: `${totalOrderedAll.toLocaleString('vi-VN')} thùng` },
        ]} />

        {/* ── Items table: ~80% ── */}
        <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
          {allDOs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
              <Package className="h-10 w-10 opacity-30" />
              <p className="text-sm">Chưa có DO nào</p>
            </div>
          ) : (
            <>
            <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5">
              <span className="h-3.5 w-1 rounded-full bg-sky-500 shrink-0" />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Hàng hóa</h2>
              <span className="text-[11px] font-normal text-slate-400">{allItems.length} mã · {allDOs.length} DO</span>
            </div>
            <ItemsTable
              doRecords={allDOs}
              gdoId={id!}
              canScan={!!gdo.started_at && gdo.status !== 'PAUSED' && gdo.status !== 'COMPLETED'}
              hasScanPerm={can(perms, 'outbound', 'scan')}
              warehouseId={gdo.warehouse_id}
              deliveryDate={gdo.delivery_date}
              expandedItemIds={expandedItemIds}
              toggleExpand={toggleExpandItem}
            />
            </>
          )}
        </div>
       </div>
      </div>
    </>
  )
}
