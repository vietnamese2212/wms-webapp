import { useRef, useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Upload, Search, Truck, CheckCircle2, AlertTriangle, CalendarDays, X, Bookmark, Info, Plus, Trash2, PenSquare, QrCode } from 'lucide-react'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useGDOs, useUploadGDOExcel, useWarehouses, useCreateGDO, useUpdateGDO, useDeleteGDO, useMaterials, useGDO, useAssignGDO } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useActiveVehiclesStore } from '@/stores/activeVehiclesStore'
import { formatTimestampTime } from '@/utils/formatters'
import type { GDO } from '@/types'

const TODAY = new Date().toISOString().slice(0, 10)
const EXPORT_TYPES = ['Xe Container', 'Xe Pallet', 'Xe Xá']

// ─── Row background by status ─────────────────────────────────
function gdoRowBg(gdo: GDO) {
  if (gdo.status === 'COMPLETED')  return 'bg-blue-50 hover:bg-blue-100'
  if (gdo.status === 'IN_PROGRESS') return 'bg-amber-50 hover:bg-amber-100'
  if (gdo.status === 'PAUSED')     return 'bg-red-50 hover:bg-red-100'
  if (gdo.assigned_at)             return 'bg-green-50 hover:bg-green-100'
  return 'hover:bg-slate-50'
}

function gdoStatusInfo(gdo: GDO): { label: string; cls: string } {
  if (gdo.status === 'COMPLETED')   return { label: 'Hoàn thành', cls: 'bg-blue-100 text-blue-700'   }
  if (gdo.status === 'IN_PROGRESS') return { label: 'Đang xuất',  cls: 'bg-amber-100 text-amber-700' }
  if (gdo.status === 'PAUSED')      return { label: 'Tạm dừng',   cls: 'bg-red-100 text-red-700'     }
  if (gdo.assigned_at)              return { label: 'Giao đơn',   cls: 'bg-green-100 text-green-700' }
  return                                   { label: '—',           cls: 'bg-slate-100 text-slate-400' }
}

function naturalSortCode(a: string, b: string): number {
  const numA = parseInt(a.match(/(\d+)$/)?.[1] ?? '0', 10)
  const numB = parseInt(b.match(/(\d+)$/)?.[1] ?? '0', 10)
  if (numA !== numB) return numA - numB
  return a.localeCompare(b)
}

function fTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  return formatTimestampTime(ts)
}

export default function Outbound() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const fileRef  = useRef<HTMLInputElement>(null)

  const { outbound: f, setOutbound } = useWmsFilterStore()
  const [uploadErr,       setUploadErr]       = useState<string | null>(null)
  const [uploadOk,        setUploadOk]        = useState<string | null>(null)
  const [uploadWarn,      setUploadWarn]      = useState<string | null>(null)
  const [postUploadLoading, setPostUploadLoading] = useState(false)
  const [showCreate,  setShowCreate]  = useState(false)
  const [editingGDOId, setEditingGDOId] = useState<string | null>(null)

  const { data: warehouses = [] } = useWarehouses(true)

  useEffect(() => {
    if (!f.warehouseId && user?.warehouse_id) {
      setOutbound({ warehouseId: user.warehouse_id })
    }
  }, [user?.warehouse_id]) // eslint-disable-line

  const { data: gdos = [], isLoading, isFetching } = useGDOs({
    warehouse_id: f.warehouseId || undefined,
    search: f.search || undefined,
    date:   f.date   || undefined,
  })
  const { mutate: uploadExcel, isPending: uploading } = useUploadGDOExcel()
  const { mutate: deleteGDO } = useDeleteGDO()
  const { mutate: assignGDO } = useAssignGDO()

  useEffect(() => {
    if (postUploadLoading && !isFetching) setPostUploadLoading(false)
  }, [isFetching, postUploadLoading])

  const typeOptions       = useMemo(() => [...new Set(gdos.map(g => g.export_type).filter(Boolean))] as string[], [gdos])
  const dvvtOptions       = useMemo(() => [...new Set(gdos.map(g => g.dvvt).filter(Boolean))] as string[], [gdos])
  const nppOptions        = useMemo(() => [...new Set(gdos.flatMap(g => g.distributor_names ?? []).filter(Boolean))], [gdos])
  const warehouseTypeOpts = useMemo(() => [...new Set(gdos.map(g => g.warehouse_type).filter(Boolean))] as string[], [gdos])

  const filterTypes         = f.filterTypes         ?? []
  const filterDvvts         = f.filterDvvts         ?? []
  const filterNpps          = f.filterNpps          ?? []
  const filterWarehouseTypes = f.filterWarehouseTypes ?? []

  const filtered = useMemo(() => gdos.filter(g => {
    if (filterTypes.length          > 0 && !filterTypes.includes(g.export_type ?? ''))                              return false
    if (filterDvvts.length          > 0 && !filterDvvts.includes(g.dvvt ?? ''))                                     return false
    if (filterNpps.length           > 0 && !(g.distributor_names ?? []).some(n => filterNpps.includes(n)))          return false
    if (filterWarehouseTypes.length > 0 && !filterWarehouseTypes.includes(g.warehouse_type ?? ''))                  return false
    return true
  }), [gdos, filterTypes, filterDvvts, filterNpps, filterWarehouseTypes])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (a.delivery_date !== b.delivery_date)
      return b.delivery_date.localeCompare(a.delivery_date)
    const ta = a.export_type ?? '', tb = b.export_type ?? ''
    if (ta !== tb) return ta.localeCompare(tb)
    return naturalSortCode(a.group_code, b.group_code)
  }), [filtered])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadErr(null); setUploadOk(null); setUploadWarn(null)
    setPostUploadLoading(true)
    uploadExcel(
      { file, warehouse_id: user?.warehouse_id || undefined },
      {
        onSuccess: (result) => {
          const items = (result.created ?? []) as Array<{ group_code: string; created?: boolean; merged?: boolean; skipped?: boolean; reason?: string }>
          const nCreated = items.filter(r => r.created && !r.merged).length
          const nMerged  = items.filter(r => r.merged).length
          const skipped  = items.filter(r => r.skipped)
          const okParts = [
            nCreated > 0 && `Tạo mới ${nCreated} xe`,
            nMerged  > 0 && `Cập nhật ${nMerged} xe (PAUSED)`,
          ].filter(Boolean).join(' · ')
          setUploadOk(okParts || (skipped.length ? undefined : 'Không có xe mới') as any)
          if (skipped.length) {
            type SkippedItem = { group_code: string; reason?: string }
            const CATS: { key: string; label: string; match: (r: string) => boolean; detailPrefix?: string }[] = [
              { key: 'format',    label: 'Mã xe sai format ngày ddmmyy_',          match: r => r.includes('tiền tố ngày ddmmyy_') },
              { key: 'date',      label: 'Ngày xuất không hợp lệ',                 match: r => r.includes('Ngày xuất không hợp lệ'), detailPrefix: 'Ngày xuất không hợp lệ hoặc trống: ' },
              { key: 'mat',       label: 'Mã hàng không có trong hệ thống',        match: r => r.includes('Mã hàng không tìm thấy'),  detailPrefix: 'Mã hàng không tìm thấy: ' },
              { key: 'wh',        label: 'Kho xuất không tìm thấy',                match: r => r.includes('tìm thấy kho') || r.includes('Thiếu thông tin kho') },
              { key: 'completed', label: 'Đã hoàn thành — không thể ghi đè',       match: r => r.includes('Đã hoàn thành') },
              { key: 'progress',  label: 'Đang xuất — chỉ upload được khi PAUSED', match: r => r.includes('Đang xuất') },
              { key: 'missing',   label: 'Mã hàng đã xuất bị xóa khỏi file mới',  match: r => r.includes('đã xuất không có trong file'), detailPrefix: 'Mã hàng đã xuất không có trong file mới: ' },
              { key: 'cartons',   label: 'Số thùng mới nhỏ hơn đã xuất',          match: r => r.includes('Số thùng mới nhỏ hơn'),       detailPrefix: 'Số thùng mới nhỏ hơn đã xuất: ' },
              { key: 'other',     label: 'Lỗi khác',                               match: () => true },
            ]
            const groups = new Map<string, { label: string; detailPrefix?: string; items: SkippedItem[] }>()
            for (const item of skipped) {
              const cat = CATS.find(c => c.match(item.reason ?? ''))!
              if (!groups.has(cat.key)) groups.set(cat.key, { label: cat.label, detailPrefix: cat.detailPrefix, items: [] })
              groups.get(cat.key)!.items.push(item)
            }
            const lines = [`Bỏ qua ${skipped.length} chuyến xe:`]
            for (const { label, detailPrefix, items } of groups.values()) {
              lines.push(`\n[${label}] — ${items.length} xe:`)
              for (const item of items) {
                const detail = detailPrefix ? (item.reason ?? '').replace(detailPrefix, '').trim() : ''
                lines.push(detail ? `  • ${item.group_code}: ${detail}` : `  • ${item.group_code}`)
              }
            }
            setUploadWarn(lines.join('\n'))
          }
        },
        onError: (err) => {
          setPostUploadLoading(false)
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi upload file'
          setUploadErr(msg)
        },
      }
    )
    e.target.value = ''
  }

  function handleDelete(gdo: GDO, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Xóa đơn "${gdo.group_code}"?\nHành động này không thể hoàn tác.`)) return
    deleteGDO(gdo.id, {
      onError: (err) => {
        const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi xóa đơn'
        alert(msg)
      },
    })
  }

  const dateLabel = f.date
    ? format(parseISO(f.date), 'EEEE, dd-MM-yyyy', { locale: vi })
    : 'Tất cả ngày'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Truck className="h-5 w-5 text-slate-500" />
            Xuất kho
          </h1>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowCreate(true)} className="gap-1.5">
              <PenSquare className="h-4 w-4" />
              Tạo đơn
            </Button>
            <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()} className="gap-1.5">
              <Upload className="h-4 w-4" />
              {uploading ? 'Đang xử lý…' : 'Upload Excel'}
            </Button>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>

        {uploadOk && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />{uploadOk}
          </div>
        )}
        {uploadWarn && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-sans">{uploadWarn}</pre>
          </div>
        )}
        {uploadErr && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />{uploadErr}
          </div>
        )}

        {/* Row 1: Date + Search */}
        <div className="flex gap-2">
          <div className="relative flex items-center gap-1.5">
            <CalendarDays className="absolute left-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              type="date"
              className="pl-8 h-8 text-sm w-[160px]"
              value={f.date}
              onChange={e => setOutbound({ date: e.target.value })}
            />
            {f.date && f.date !== TODAY && (
              <button className="ml-1 text-xs text-slate-400 hover:text-slate-700 underline whitespace-nowrap"
                onClick={() => setOutbound({ date: TODAY })}>
                Hôm nay
              </button>
            )}
            {f.date && (
              <button className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                title="Xem tất cả ngày" onClick={() => setOutbound({ date: '' })}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm số xe…" value={f.search}
              onChange={e => setOutbound({ search: e.target.value })} />
          </div>
        </div>

        {/* Row 2: Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={f.warehouseId || '__all__'} onValueChange={v => setOutbound({ warehouseId: v === '__all__' ? '' : v })}>
            <SelectTrigger className="h-7 text-xs w-[130px]">
              <SelectValue placeholder="Kho xuất" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả kho</SelectItem>
              {(warehouses as any[]).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <MultiSelectFilter label="Loại kho" options={warehouseTypeOpts.map(t => ({ value: t, label: t }))} selected={filterWarehouseTypes} onChange={v => setOutbound({ filterWarehouseTypes: v })} />
          <MultiSelectFilter label="Loại xuất" options={typeOptions.map(t => ({ value: t, label: t }))} selected={filterTypes} onChange={v => setOutbound({ filterTypes: v })} />
          <MultiSelectFilter label="ĐVVT" options={dvvtOptions.map(d => ({ value: d, label: d }))} selected={filterDvvts} onChange={v => setOutbound({ filterDvvts: v })} />
          <MultiSelectFilter label="NPP" options={nppOptions.map(n => ({ value: n, label: n }))} selected={filterNpps} onChange={v => setOutbound({ filterNpps: v })} width="min-w-[140px]" />
        </div>

        <p className="text-xs text-slate-500 -mt-1">
          {f.date ? (
            <>
              <span className="font-medium text-slate-700">{dateLabel}</span>
              {f.date === TODAY && <span className="ml-1.5 text-blue-600 font-medium">· Hôm nay</span>}
            </>
          ) : (
            <span className="italic">Hiển thị tất cả ngày</span>
          )}
          <span className="ml-1.5">— {sorted.length} chuyến xe</span>
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading || postUploadLoading ? (
          <div className="p-4 space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <Truck className="h-10 w-10 opacity-30" />
            <p className="text-sm">{f.search ? 'Không tìm thấy chuyến xe' : f.date ? `Không có chuyến xe ngày ${format(parseISO(f.date), 'dd-MM-yyyy')}` : 'Chưa có chuyến xe nào'}</p>
            {!f.date && <p className="text-xs">Upload file Excel để bắt đầu</p>}
          </div>
        ) : (
          <Table className="min-w-[1700px]">
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="px-1.5 py-1.5 w-7" />
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5 w-16">Thao tác</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Ngày xuất</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Số xe</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Tên NPP</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">ĐVVT</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 text-right whitespace-nowrap px-2 py-1.5">Tổng thùng</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 text-right whitespace-nowrap px-2 py-1.5">Pallet</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Kho xuất</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Loại xuất</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Loại kho</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Giờ giao đơn</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Giờ bắt đầu</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Giờ quét xong</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Giờ kết thúc</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Tình trạng</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Người xuất</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Lái xe nâng</TableHead>
                <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Bốc xếp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map(gdo => (
                <GDORow
                  key={gdo.id}
                  gdo={gdo}
                  onClick={() => navigate(`/wms/outbound/${gdo.id}`)}
                  onEdit={e => { e.stopPropagation(); setEditingGDOId(gdo.id) }}
                  onDelete={e => handleDelete(gdo, e)}
                  onAssign={e => { e.stopPropagation(); assignGDO({ id: gdo.id }) }}
                  onScan={e => { e.stopPropagation(); navigate(`/wms/outbound/${gdo.id}`) }}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <GDOModal
          defaultWarehouseId={f.warehouseId || user?.warehouse_id || ''}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editingGDOId && (
        <EditGDOModal
          gdoId={editingGDOId}
          defaultWarehouseId={f.warehouseId || user?.warehouse_id || ''}
          onClose={() => setEditingGDOId(null)}
        />
      )}
    </div>
  )
}

// ─── GDO Row ──────────────────────────────────────────────────

function GDORow({ gdo, onClick, onEdit, onDelete, onAssign, onScan }: {
  gdo: GDO
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  onAssign: (e: React.MouseEvent) => void
  onScan: (e: React.MouseEvent) => void
}) {
  const { pin, unpin, isPinned } = useActiveVehiclesStore()
  const pinned    = isPinned(gdo.id)
  const dateLabel = format(parseISO(gdo.delivery_date), 'dd-MM-yy', { locale: vi })
  const npp       = gdo.distributor_names?.join(', ') ?? '—'
  const { label: statusLabel, cls: statusCls } = gdoStatusInfo(gdo)
  const isPending = gdo.status === 'PENDING'

  return (
    <TableRow className={`cursor-pointer transition-colors ${gdoRowBg(gdo)}`} onClick={onClick}>
      {/* Bookmark */}
      <TableCell className="px-1.5 py-1" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => pinned ? unpin(gdo.id) : pin({ id: gdo.id, group_code: gdo.group_code, status: gdo.status })}
          className={`p-0.5 rounded transition-colors ${pinned ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`}
          title={pinned ? 'Bỏ đánh dấu' : 'Đánh dấu đang làm'}
        >
          <Bookmark className="h-3 w-3" fill={pinned ? 'currentColor' : 'none'} />
        </button>
      </TableCell>

      {/* Actions */}
      <TableCell className="px-1.5 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          {isPending && (
            <>
              <button onClick={onEdit} title="Sửa đơn" className="p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                <PenSquare className="h-3 w-3" />
              </button>
              <button onClick={onDelete} title="Xóa đơn" className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
          {gdo.status === 'IN_PROGRESS' && (
            <button onClick={onScan} title="Quét pallet" className="p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
              <QrCode className="h-3 w-3" />
            </button>
          )}
        </div>
      </TableCell>

      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-medium tabular-nums">{dateLabel}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold">{gdo.group_code}</span>
      </TableCell>
      <TableCell className="px-2 py-1 max-w-[150px]">
        <span className="text-[10px] text-slate-700 truncate block" title={npp}>{npp}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{gdo.dvvt ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{gdo.total_cartons ?? 0}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{gdo.total_pallets ?? 0}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">pl</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{gdo.warehouse?.name ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{gdo.export_type ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{gdo.warehouse_type ?? '—'}</span>
      </TableCell>

      {/* Giờ giao đơn — inline assign action */}
      <TableCell className="px-2 py-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
        {gdo.assigned_at ? (
          <span className="text-[10px] tabular-nums text-green-700 font-medium">{fTime(gdo.assigned_at)}</span>
        ) : isPending ? (
          <button
            onClick={onAssign}
            className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 font-medium transition-colors"
          >
            Giao đơn
          </button>
        ) : (
          <span className="text-[10px] tabular-nums text-slate-400">—</span>
        )}
      </TableCell>

      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{fTime(gdo.started_at)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{fTime(gdo.last_scanned_at)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] tabular-nums text-slate-600">{fTime(gdo.completed_at)}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${statusCls}`}>{statusLabel}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{gdo.exporter_name ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">
          {gdo.forklift_driver_names || gdo.forklift_driver?.name || '—'}
        </span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{gdo.loader_name ?? '—'}</span>
      </TableCell>
    </TableRow>
  )
}

// ─── Material picker ──────────────────────────────────────────

type MatOption = { id: string; material_code: string; short_name: string | null; category: string | null }

function MatPicker({ value, matName, onSelect }: {
  value: string
  matName: string
  onSelect: (code: string, name: string, category: string | null) => void
}) {
  const [search, setSearch] = useState(value)
  const [open, setOpen] = useState(false)
  const { data: mats = [] } = useMaterials({ search: search.length > 1 ? search : undefined })

  // Sync when value changes externally (edit mode pre-fill)
  useEffect(() => { setSearch(value) }, [value])

  return (
    <div className="relative flex-1 min-w-0">
      <Input
        className="h-7 text-[10px] font-mono px-2"
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Tìm mã / tên hàng…"
      />
      {matName && !open && (
        <p className="text-[9px] text-slate-500 mt-0.5 truncate">{matName}</p>
      )}
      {open && search.length > 1 && mats.length > 0 && (
        <div className="absolute top-full left-0 right-0 bg-white border rounded shadow-lg z-50 max-h-48 overflow-y-auto">
          {(mats as MatOption[]).slice(0, 12).map(m => (
            <button
              key={m.id}
              className="w-full text-left px-2 py-1.5 hover:bg-blue-50 border-b border-slate-50 last:border-0"
              onMouseDown={() => {
                onSelect(m.material_code, m.short_name ?? '', m.category)
                setSearch(m.material_code)
                setOpen(false)
              }}
            >
              <span className="text-[10px] font-mono font-semibold">{m.material_code}</span>
              {m.short_name && <span className="text-[9px] text-slate-500 ml-1.5">{m.short_name}</span>}
              {m.category && <span className="text-[9px] text-slate-400 ml-1">· {m.category}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Item row type ────────────────────────────────────────────

type ItemRow = {
  id: string
  material_code: string
  mat_name: string
  category: string | null
  cartons: number
  min_cartons: number  // 0 for new items, cartons_scanned for existing
}

let _uid = 0
const uid = () => String(++_uid)
const makeItem = (): ItemRow => ({ id: uid(), material_code: '', mat_name: '', category: null, cartons: 0, min_cartons: 0 })

// ─── Shared form UI ───────────────────────────────────────────

function GDOFormBody({
  gdo,
  mode,
  date, setDate,
  warehouseId, setWarehouseId,
  dvvt, setDvvt,
  customerName, setCustomerName,
  exportType, setExportType,
  items, setItems,
  error,
  isPending: submitting,
  onSubmit,
  onClose,
}: {
  gdo?: GDO | null
  mode: 'create' | 'edit'
  date: string; setDate: (v: string) => void
  warehouseId: string; setWarehouseId: (v: string) => void
  dvvt: string; setDvvt: (v: string) => void
  customerName: string; setCustomerName: (v: string) => void
  exportType: string; setExportType: (v: string) => void
  items: ItemRow[]; setItems: React.Dispatch<React.SetStateAction<ItemRow[]>>
  error: string
  isPending: boolean
  onSubmit: () => void
  onClose: () => void
}) {
  const { data: warehouses = [] } = useWarehouses(true)
  const isMultiDO = (gdo?.do_count ?? 0) > 1

  const TODAY_STR = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [yr, mo, dy] = TODAY_STR.split('-')
  const codePreview = mode === 'create' ? `${dy}${mo}${yr.slice(2)}_ĐT_XX` : gdo?.group_code ?? ''

  function updateItem(id: string, patch: Partial<ItemRow>) {
    setItems(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">
            {mode === 'create' ? 'Tạo đơn xuất thủ công' : `Sửa đơn: ${gdo?.group_code}`}
          </h2>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {mode === 'create'
              ? <>Mã xe tự động: <span className="font-mono font-semibold text-slate-600">{codePreview}</span></>
              : <>Trạng thái: <span className="font-semibold text-amber-600">PENDING</span> — có thể chỉnh sửa</>
            }
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

        {/* Header fields — 2 columns */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">Ngày xuất <span className="text-red-500">*</span></label>
            <Input type="date" className="h-8 text-xs" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">Kho xuất</label>
            <Select value={warehouseId || '__none__'} onValueChange={v => setWarehouseId(v === '__none__' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Chọn kho…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Không chọn</SelectItem>
                {(warehouses as any[]).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">Tên khách hàng <span className="text-red-500">*</span></label>
            <Input className="h-8 text-xs" placeholder="Tên NPP / khách hàng…" value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500">ĐVVT <span className="text-red-500">*</span></label>
            <Input className="h-8 text-xs" placeholder="Đơn vị vận tải…" value={dvvt} onChange={e => setDvvt(e.target.value)} />
          </div>
          <div className="space-y-1 col-span-2">
            <label className="text-[10px] font-medium text-slate-500">Loại xuất <span className="text-red-500">*</span></label>
            <div className="flex gap-2">
              {EXPORT_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setExportType(t)}
                  className={`flex-1 h-8 text-xs rounded-md border font-medium transition-colors ${
                    exportType === t
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Items */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Danh sách hàng</p>

          {isMultiDO && mode === 'edit' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700">
              Đơn này có nhiều OD — chỉ cập nhật thông tin chung. Sửa chi tiết hàng hóa qua Upload Excel.
            </div>
          )}

          {!isMultiDO && items.map((item, idx) => (
            <div key={item.id} className="border border-slate-200 rounded-lg p-2.5 space-y-2 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-medium text-slate-400">#{idx + 1}</span>
                {(items.length > 1 && item.min_cartons === 0) && (
                  <button onClick={() => setItems(rows => rows.filter(r => r.id !== item.id))} className="text-slate-300 hover:text-red-400" title="Xóa dòng">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                {item.min_cartons > 0 && (
                  <span className="text-[9px] text-amber-600">Đã xuất {item.min_cartons} thùng</span>
                )}
              </div>
              <MatPicker
                value={item.material_code}
                matName={item.mat_name}
                onSelect={(code, name, category) => updateItem(item.id, { material_code: code, mat_name: name, category })}
              />
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-500 shrink-0">Số thùng <span className="text-red-500">*</span></label>
                <Input
                  type="number"
                  min={item.min_cartons || 1}
                  className={`h-7 text-[10px] text-right flex-1 ${item.cartons > 0 && item.cartons < item.min_cartons ? 'border-red-400' : ''}`}
                  value={item.cartons || ''}
                  onChange={e => updateItem(item.id, { cartons: parseInt(e.target.value) || 0 })}
                />
                {item.category && (
                  <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">{item.category}</span>
                )}
              </div>
              {item.cartons > 0 && item.cartons < item.min_cartons && (
                <p className="text-[9px] text-red-600">Tối thiểu {item.min_cartons} thùng (đã xuất)</p>
              )}
            </div>
          ))}

          {!isMultiDO && (
            <button
              onClick={() => setItems(rows => [...rows, makeItem()])}
              className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 w-full justify-center border border-dashed border-blue-200 rounded-lg py-1.5 hover:border-blue-400"
            >
              <Plus className="h-3 w-3" /> Thêm mặt hàng
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">{error}</div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-5 py-3 shrink-0 bg-slate-50/50 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Hủy</Button>
        <Button size="sm" disabled={submitting} onClick={onSubmit} className="min-w-[100px]">
          {submitting ? 'Đang lưu…' : mode === 'create' ? 'Tạo đơn xuất' : 'Lưu thay đổi'}
        </Button>
      </div>
    </>
  )
}

// ─── Shared modal wrapper ─────────────────────────────────────

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {children}
      </div>
    </div>
  )
}

// ─── Create modal ─────────────────────────────────────────────

function GDOModal({ defaultWarehouseId, onClose }: { defaultWarehouseId: string; onClose: () => void }) {
  const TODAY_STR = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const [date, setDate]               = useState(TODAY_STR)
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId)
  const [dvvt, setDvvt]               = useState('')
  const [customerName, setCustomerName] = useState('')
  const [exportType, setExportType]   = useState('')
  const [items, setItems]             = useState<ItemRow[]>([makeItem()])
  const [error, setError]             = useState('')

  const { mutate: createGDO, isPending } = useCreateGDO()

  function handleSubmit() {
    if (!date)         return setError('Chọn ngày xuất')
    if (!customerName.trim()) return setError('Nhập tên khách hàng')
    if (!dvvt.trim())  return setError('Nhập đơn vị vận tải')
    if (!exportType)   return setError('Chọn loại xuất')
    for (const item of items) {
      if (!item.material_code.trim()) return setError('Chọn mã hàng cho tất cả dòng')
      if (!item.cartons || item.cartons <= 0) return setError('Số thùng phải > 0')
    }
    setError('')
    createGDO(
      {
        delivery_date: date,
        warehouse_id: warehouseId || undefined,
        dvvt: dvvt.trim(),
        customer_name: customerName.trim(),
        export_type: exportType,
        items: items.map(i => ({ material_code: i.material_code, cartons_ordered: i.cartons })),
      },
      {
        onSuccess: () => onClose(),
        onError: (e: unknown) => {
          const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi tạo đơn'
          setError(msg)
        },
      }
    )
  }

  return (
    <ModalOverlay onClose={onClose}>
      <GDOFormBody
        mode="create"
        date={date} setDate={setDate}
        warehouseId={warehouseId} setWarehouseId={setWarehouseId}
        dvvt={dvvt} setDvvt={setDvvt}
        customerName={customerName} setCustomerName={setCustomerName}
        exportType={exportType} setExportType={setExportType}
        items={items} setItems={setItems}
        error={error} isPending={isPending}
        onSubmit={handleSubmit} onClose={onClose}
      />
    </ModalOverlay>
  )
}

// ─── Edit modal ───────────────────────────────────────────────

function EditGDOModal({ gdoId, defaultWarehouseId, onClose }: { gdoId: string; defaultWarehouseId: string; onClose: () => void }) {
  const { data: gdo, isLoading } = useGDO(gdoId)

  const [date, setDate]               = useState('')
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId)
  const [dvvt, setDvvt]               = useState('')
  const [customerName, setCustomerName] = useState('')
  const [exportType, setExportType]   = useState('')
  const [items, setItems]             = useState<ItemRow[]>([])
  const [error, setError]             = useState('')
  const [initialized, setInitialized] = useState(false)

  const { mutate: updateGDO, isPending } = useUpdateGDO()

  // Pre-fill once GDO loads
  useEffect(() => {
    if (!gdo || initialized) return
    setInitialized(true)
    setDate(gdo.delivery_date)
    setWarehouseId(gdo.warehouse_id ?? '')
    setDvvt(gdo.dvvt ?? '')
    setCustomerName(gdo.distributor_names?.[0] ?? '')
    setExportType(gdo.export_type ?? '')

    // Build items from delivery_orders (single DO for manual)
    const allItems: ItemRow[] = (gdo.delivery_orders ?? []).flatMap(doRow =>
      (doRow.items ?? []).map((item: any) => ({
        id: uid(),
        material_code: item.material_code_raw ?? '',
        mat_name: item.material?.short_name ?? '',
        category: item.material_type ?? null,
        cartons: item.cartons_ordered ?? 0,
        min_cartons: item.cartons_scanned ?? 0,
      }))
    )
    setItems(allItems.length ? allItems : [makeItem()])
  }, [gdo, initialized])

  function handleSubmit() {
    if (!date)        return setError('Chọn ngày xuất')
    if (!customerName.trim()) return setError('Nhập tên khách hàng')
    if (!dvvt.trim()) return setError('Nhập đơn vị vận tải')
    if (!exportType)  return setError('Chọn loại xuất')
    const isMultiDO = (gdo?.do_count ?? 0) > 1
    if (!isMultiDO) {
      for (const item of items) {
        if (!item.material_code.trim()) return setError('Chọn mã hàng cho tất cả dòng')
        if (!item.cartons || item.cartons <= 0) return setError('Số thùng phải > 0')
        if (item.cartons < item.min_cartons) return setError(`Số thùng không được nhỏ hơn đã xuất (${item.min_cartons})`)
      }
    }
    setError('')
    updateGDO(
      {
        id: gdoId,
        delivery_date: date,
        warehouse_id: warehouseId || undefined,
        dvvt: dvvt.trim(),
        customer_name: customerName.trim(),
        export_type: exportType,
        items: isMultiDO ? undefined as any : items.map(i => ({ material_code: i.material_code, cartons_ordered: i.cartons })),
      },
      {
        onSuccess: () => onClose(),
        onError: (e: unknown) => {
          const msg = (e as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi cập nhật đơn'
          setError(msg)
        },
      }
    )
  }

  return (
    <ModalOverlay onClose={onClose}>
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-sm text-slate-400">Đang tải…</div>
        </div>
      ) : (
        <GDOFormBody
          mode="edit"
          gdo={gdo}
          date={date} setDate={setDate}
          warehouseId={warehouseId} setWarehouseId={setWarehouseId}
          dvvt={dvvt} setDvvt={setDvvt}
          customerName={customerName} setCustomerName={setCustomerName}
          exportType={exportType} setExportType={setExportType}
          items={items} setItems={setItems}
          error={error} isPending={isPending}
          onSubmit={handleSubmit} onClose={onClose}
        />
      )}
    </ModalOverlay>
  )
}
