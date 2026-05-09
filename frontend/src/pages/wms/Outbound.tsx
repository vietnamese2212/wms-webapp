import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Upload, Search, Truck, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useGDOs, useUploadGDOExcel } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import type { GDO, OutboundStatus } from '@/types'

const statusCls: Record<OutboundStatus, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  COMPLETED:   'bg-green-100 text-green-800',
  CANCELLED:   'bg-red-100 text-red-600',
}
const statusLabel: Record<OutboundStatus, string> = {
  PENDING: 'Chờ xuất', IN_PROGRESS: 'Đang xuất', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy',
}
function StatusBadge({ status }: { status: string }) {
  const s = status as OutboundStatus
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusCls[s] ?? 'bg-slate-100 text-slate-600'}`}>
      {statusLabel[s] ?? status}
    </span>
  )
}

export default function Outbound() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const fileRef  = useRef<HTMLInputElement>(null)

  const [search,    setSearch]    = useState('')
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [uploadOk,  setUploadOk]  = useState<string | null>(null)

  const { data: gdos = [], isLoading } = useGDOs({
    warehouse_id: user?.warehouse_id || undefined,
    search: search || undefined,
  })
  const { mutate: uploadExcel, isPending: uploading } = useUploadGDOExcel()

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadErr(null)
    setUploadOk(null)
    uploadExcel(
      { file, warehouse_id: user?.warehouse_id || undefined },
      {
        onSuccess: (result) => {
          const n = result.created?.filter((r: any) => r.created).length ?? 0
          const s = result.created?.filter((r: any) => r.skipped).length ?? 0
          setUploadOk(`Nhập thành công ${n} chuyến xe${s ? `, bỏ qua ${s} (đã tồn tại)` : ''}`)
        },
        onError: (err) => {
          const msg = (err as AxiosError<{ error: { message: string } }>)?.response?.data?.error?.message ?? 'Lỗi upload file'
          setUploadErr(msg)
        },
      }
    )
    e.target.value = ''
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-4 py-3 shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Truck className="h-5 w-5 text-slate-500" />
            Xuất kho
          </h1>
          <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()} className="gap-1.5">
            <Upload className="h-4 w-4" />
            {uploading ? 'Đang xử lý…' : 'Upload Excel'}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>

        {uploadOk && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />{uploadOk}
          </div>
        )}
        {uploadErr && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />{uploadErr}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input className="pl-9 h-8 text-sm" placeholder="Tìm số xe…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="h-12 rounded bg-slate-100 animate-pulse" />)}
          </div>
        ) : gdos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <Truck className="h-10 w-10 opacity-30" />
            <p className="text-sm">{search ? 'Không tìm thấy chuyến xe' : 'Chưa có chuyến xe nào'}</p>
            <p className="text-xs">Upload file Excel để bắt đầu</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="text-xs font-medium text-slate-500 whitespace-nowrap">Ngày xuất</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 whitespace-nowrap">Số xe</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 whitespace-nowrap">Loại xuất</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 whitespace-nowrap">ĐVVT</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 whitespace-nowrap">Tên NPP</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 text-right whitespace-nowrap">Tổng thùng</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 text-right whitespace-nowrap">Tổng pallet</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 whitespace-nowrap">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gdos.map(gdo => <GDORow key={gdo.id} gdo={gdo} onClick={() => navigate(`/wms/outbound/${gdo.id}`)} />)}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function GDORow({ gdo, onClick }: { gdo: GDO; onClick: () => void }) {
  const isToday   = gdo.delivery_date === new Date().toISOString().slice(0, 10)
  const dateLabel = format(parseISO(gdo.delivery_date), 'dd/MM/yyyy', { locale: vi })
  const npp       = gdo.distributor_names?.join(', ') ?? '—'

  return (
    <TableRow
      className="cursor-pointer hover:bg-slate-50 transition-colors"
      onClick={onClick}
    >
      <TableCell className="py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-medium tabular-nums">{dateLabel}</span>
          {isToday && gdo.status !== 'COMPLETED' && (
            <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-medium">Hôm nay</span>
          )}
          {gdo.delivery_date !== gdo.planned_date && (
            <span className="text-xs text-amber-600">(KH {format(parseISO(gdo.planned_date), 'dd/MM')})</span>
          )}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <span className="text-lg font-mono font-semibold">{gdo.group_code}</span>
      </TableCell>
      <TableCell className="py-2 text-sm text-slate-600">{gdo.export_type ?? '—'}</TableCell>
      <TableCell className="py-2 text-sm text-slate-600">{gdo.dvvt ?? '—'}</TableCell>
      <TableCell className="py-2 text-sm text-slate-600 max-w-[180px] truncate" title={npp}>{npp}</TableCell>
      <TableCell className="py-2 text-right">
        <span className="text-lg font-semibold tabular-nums">{gdo.total_cartons ?? 0}</span>
        <span className="text-xs text-slate-400 ml-1">thùng</span>
      </TableCell>
      <TableCell className="py-2 text-right">
        <span className="text-lg font-semibold tabular-nums">{gdo.total_pallets ?? 0}</span>
        <span className="text-xs text-slate-400 ml-1">pl</span>
      </TableCell>
      <TableCell className="py-2"><StatusBadge status={gdo.status} /></TableCell>
    </TableRow>
  )
}
