import { useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import { Upload, Search, Truck, CheckCircle2, AlertTriangle, CalendarDays, X } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useGDOs, useUploadGDOExcel } from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import type { GDO } from '@/types'

const TODAY = new Date().toISOString().slice(0, 10)

function gdoRowBg(gdo: GDO) {
  if (gdo.status === 'COMPLETED') return 'bg-blue-50 hover:bg-blue-100'
  if (gdo.status === 'IN_PROGRESS') return 'bg-amber-50 hover:bg-amber-100'
  if (gdo.assigned_at)              return 'bg-green-50 hover:bg-green-100'
  return 'hover:bg-slate-50'
}

export default function Outbound() {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const fileRef  = useRef<HTMLInputElement>(null)

  const [search,      setSearch]      = useState('')
  const [date,        setDate]        = useState(TODAY)
  const [filterType,  setFilterType]  = useState('')
  const [filterDvvt,  setFilterDvvt]  = useState('')
  const [filterNpp,   setFilterNpp]   = useState('')
  const [uploadErr,   setUploadErr]   = useState<string | null>(null)
  const [uploadOk,    setUploadOk]    = useState<string | null>(null)

  const { data: gdos = [], isLoading } = useGDOs({
    warehouse_id: user?.warehouse_id || undefined,
    search: search || undefined,
    date:   date   || undefined,
  })
  const { mutate: uploadExcel, isPending: uploading } = useUploadGDOExcel()

  // Derive unique filter options from loaded data
  const typeOptions = useMemo(() => [...new Set(gdos.map(g => g.export_type).filter(Boolean))] as string[], [gdos])
  const dvvtOptions = useMemo(() => [...new Set(gdos.map(g => g.dvvt).filter(Boolean))] as string[], [gdos])
  const nppOptions  = useMemo(() => [...new Set(gdos.flatMap(g => g.distributor_names ?? []).filter(Boolean))], [gdos])

  // Apply client-side filters
  const filtered = useMemo(() => gdos.filter(g => {
    if (filterType && g.export_type !== filterType) return false
    if (filterDvvt && g.dvvt !== filterDvvt) return false
    if (filterNpp  && !(g.distributor_names ?? []).includes(filterNpp)) return false
    return true
  }), [gdos, filterType, filterDvvt, filterNpp])

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

  const dateLabel = date
    ? format(parseISO(date), 'EEEE, dd/MM/yyyy', { locale: vi })
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

        {/* Row 1: Date + Search */}
        <div className="flex gap-2">
          <div className="relative flex items-center gap-1.5">
            <CalendarDays className="absolute left-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              type="date"
              className="pl-8 h-8 text-sm w-[160px]"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
            {date && date !== TODAY && (
              <button className="ml-1 text-xs text-slate-400 hover:text-slate-700 underline whitespace-nowrap" onClick={() => setDate(TODAY)}>
                Hôm nay
              </button>
            )}
            {date && (
              <button className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Xem tất cả ngày" onClick={() => setDate('')}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input className="pl-8 h-8 text-sm" placeholder="Tìm số xe…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Row 2: Loại xuất / ĐVVT / NPP filters */}
        <div className="flex gap-2 flex-wrap">
          <Select value={filterType || '__all__'} onValueChange={v => setFilterType(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-7 text-xs w-[130px]">
              <SelectValue placeholder="Loại xuất" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả loại</SelectItem>
              {typeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterDvvt || '__all__'} onValueChange={v => setFilterDvvt(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-7 text-xs w-[110px]">
              <SelectValue placeholder="ĐVVT" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả ĐVVT</SelectItem>
              {dvvtOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterNpp || '__all__'} onValueChange={v => setFilterNpp(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-7 text-xs w-[150px]">
              <SelectValue placeholder="Tên NPP" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tất cả NPP</SelectItem>
              {nppOptions.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Date label */}
        <p className="text-xs text-slate-500 -mt-1">
          {date ? (
            <>
              <span className="font-medium text-slate-700">{dateLabel}</span>
              {date === TODAY && <span className="ml-1.5 text-blue-600 font-medium">· Hôm nay</span>}
            </>
          ) : (
            <span className="italic">Hiển thị tất cả ngày</span>
          )}
          <span className="ml-1.5">— {filtered.length} chuyến xe</span>
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20 lg:pb-4">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="h-10 rounded bg-slate-100 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
            <Truck className="h-10 w-10 opacity-30" />
            <p className="text-sm">{search ? 'Không tìm thấy chuyến xe' : date ? `Không có chuyến xe ngày ${format(parseISO(date), 'dd/MM/yyyy')}` : 'Chưa có chuyến xe nào'}</p>
            {!date && <p className="text-xs">Upload file Excel để bắt đầu</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Ngày xuất</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Số xe</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Loại xuất</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">ĐVVT</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 whitespace-nowrap px-2 py-1.5">Tên NPP</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 text-right whitespace-nowrap px-2 py-1.5">Tổng thùng</TableHead>
                  <TableHead className="text-[9px] font-medium text-slate-500 text-right whitespace-nowrap px-2 py-1.5">Pallet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(gdo => <GDORow key={gdo.id} gdo={gdo} onClick={() => navigate(`/wms/outbound/${gdo.id}`)} />)}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

function GDORow({ gdo, onClick }: { gdo: GDO; onClick: () => void }) {
  const dateLabel = format(parseISO(gdo.delivery_date), 'dd/MM/yy', { locale: vi })
  const npp       = gdo.distributor_names?.join(', ') ?? '—'

  return (
    <TableRow className={`cursor-pointer transition-colors ${gdoRowBg(gdo)}`} onClick={onClick}>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-medium tabular-nums">{dateLabel}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] font-mono font-semibold">{gdo.group_code}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{gdo.export_type ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 whitespace-nowrap">
        <span className="text-[10px] text-slate-700">{gdo.dvvt ?? '—'}</span>
      </TableCell>
      <TableCell className="px-2 py-1 max-w-[150px]">
        <span className="text-[10px] text-slate-700 truncate block" title={npp}>{npp}</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{gdo.total_cartons ?? 0}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">thùng</span>
      </TableCell>
      <TableCell className="px-2 py-1 text-right whitespace-nowrap">
        <span className="text-[10px] font-semibold tabular-nums">{gdo.total_pallets ?? 0}</span>
        <span className="text-[9px] text-slate-400 ml-0.5">pl</span>
      </TableCell>
    </TableRow>
  )
}
