// TRUY XUẤT LÔ — hai chiều trên cùng một màn (28/08, user chốt "truy xuất chắc chắn phải làm").
//
//  · xuôi  (tìm theo Mã pallet / Mã hàng / Mã lô): lô này đã đi tới NPP nào, xe nào, ngày nào —
//    và còn bao nhiêu nằm trong kho để thu hồi tại chỗ.
//  · ngược (tìm theo NPP / Chuyến / Biển số): khách này đã nhận những lô nào.
//
// Hai khoảng ngày TÁCH BẠCH có chủ đích: "Ngày sản xuất" lọc lô, "Ngày giao" lọc chuyến. Gộp một
// khoảng ngày cho cả hai nghĩa là cách chắc chắn làm người đọc hiểu sai kết quả thu hồi.
//
// ĐIỀU TRA THEO THÙNG (01/09, user chốt): khiếu nại đến từ MỘT THÙNG khách đang cầm — trên thùng
// chỉ có chữ in phun (giờ phút, ngày SX), không có tem pallet. Tab "Điều tra theo thùng" nhập giờ
// thùng + mã hàng (+ máy/chu kỳ nếu biết), đính kèm ảnh (AI đọc được giờ từ ảnh) → đối chiếu SỔ
// ĐÓNG GÓI ra pallet nghi vấn → truy tiếp "đã giao khách nào" → LƯU HỒ SƠ đứng tên người điều tra.
// User chốt: chỉ khớp ĐÚNG khoảng giờ thùng đầu→thùng cuối (không nới ±).
import { useMemo, useRef, useState } from 'react'
import { PackageSearch, Download, ImagePlus, Sparkles, X } from 'lucide-react'
import type { AxiosError } from 'axios'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { saveWorkbook } from '@/utils/saveExcel'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { apiClient } from '@/api/client'
import {
  useLotTrace, useMaterials, useInvestigatePreview, useCreateInvestigation,
  useTraceInvestigations, useTraceInvestigation,
  type TraceKind, type TraceShipment, type TraceStock, type TraceResult,
  type CartonMatch, type TraceInvestigation,
} from '@/api/hooks'
import { useScopedWarehouses } from '@/hooks/useUserScope'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const KINDS: { value: TraceKind; label: string; hint: string; reverse?: boolean }[] = [
  { value: 'pallet',   label: 'Mã pallet (tem)', hint: 'Nhập trọn mã hoặc TIỀN TỐ — vd 190726 = sản xuất 19/07/2026' },
  { value: 'material', label: 'Mã hàng',         hint: 'Mã hàng đầy đủ, nên kèm khoảng Ngày sản xuất' },
  { value: 'batch',    label: 'Mã lô',           hint: 'Chỉ có với tem định dạng chấm phẩy (mã lô in trên tem)' },
  { value: 'npp',      label: 'NPP / khách hàng', hint: 'Tên NPP, tìm gần đúng', reverse: true },
  { value: 'trip',     label: 'Chuyến (mã nhóm)', hint: 'Mã chuyến đầy đủ', reverse: true },
  { value: 'plate',    label: 'Biển số xe',       hint: 'Gõ kiểu nào cũng được — so trên dạng chuẩn', reverse: true },
]

const num = (n: number | null | undefined) => Math.round(Number(n) || 0).toLocaleString('vi-VN')
const apiErrMsg = (e: unknown) =>
  (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? 'thử lại'

type Tab = 'trace' | 'investigate' | 'records'

export default function LotTrace() {
  const user = useAuthStore(s => s.user)
  const perms = (user?.module_permissions as ModulePermissions | null) ?? null
  const canExport = can(perms, 'traceability', 'export')
  const canInvestigate = can(perms, 'traceability', 'investigate')
  const [tab, setTab] = useState<Tab>('trace')

  const TabBtn = ({ k, label }: { k: Tab; label: string }) => (
    <button
      onClick={() => setTab(k)}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        tab === k ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
    >{label}</button>
  )

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="border-b bg-white px-3 py-1.5 shrink-0 sm:rounded-t-xl flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 uppercase tracking-wide shrink-0">
            <PackageSearch className="h-4 w-4 text-sky-600" /> Truy xuất lô
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1 flex-wrap">
            <TabBtn k="trace" label="Truy xuất lô" />
            {canInvestigate && <TabBtn k="investigate" label="Điều tra theo thùng" />}
            <TabBtn k="records" label="Hồ sơ truy vết" />
          </div>
        </div>
        {tab === 'trace' && <TraceTab canExport={canExport} />}
        {tab === 'investigate' && canInvestigate && <InvestigateTab />}
        {tab === 'records' && <RecordsTab />}
      </div>
    </div>
  )
}

/* ═══ TAB 1 — TRUY XUẤT LÔ (nguyên trạng 28/08) ═══════════════════════════════════════════════ */

function TraceTab({ canExport }: { canExport: boolean }) {
  const f = useWmsFilterStore(s => s.lotTrace)
  const setF = useWmsFilterStore(s => s.setLotTrace)
  const kindDef = KINDS.find(k => k.value === f.kind) ?? KINDS[0]

  const q = useLotTrace({
    kind: f.kind, value: f.value,
    prodFrom: f.prodFrom, prodTo: f.prodTo, shipFrom: f.shipFrom, shipTo: f.shipTo,
  })
  const s = q.data?.summary
  const shipments = q.data?.shipments ?? []
  const stock = q.data?.stock ?? []

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: 'kind', label: 'Tìm theo', type: 'single', pinned: true, options: KINDS.map(k => ({ value: k.value, label: k.label })),
      value: f.kind, allLabel: undefined, onChange: v => setF({ kind: (v || 'pallet') as TraceKind }) },
    // ⚠️ Nhãn phải KHÁC hẳn chip "Tìm theo" ở trên. Bản đầu để nhãn = tên kiểu tìm nên hai chip
    // đọc gần giống nhau ("Tìm theo Mã pallet (tem)" vs "Mã pallet (tem)") — chính tôi gõ nhầm
    // giá trị vào ô CHỌN KIỂU ngay lần thử đầu tiên.
    { key: 'value', label: 'Giá trị cần tìm', type: 'text', pinned: true,
      placeholder: kindDef.hint, value: f.value, onChange: v => setF({ value: v }) },
    // Ngày SX chỉ có nghĩa khi truy TỪ LÔ; ngày giao chỉ có nghĩa khi truy TỪ KHÁCH — ẩn cái không dùng
    ...(kindDef.reverse ? [] : [{
      key: 'prod', label: 'Ngày sản xuất', type: 'daterange' as const,
      from: f.prodFrom, to: f.prodTo,
      onChange: (from: string, to: string) => setF({ prodFrom: from, prodTo: to }),
    }]),
    { key: 'ship', label: 'Ngày giao', type: 'daterange',
      from: f.shipFrom, to: f.shipTo,
      onChange: (from: string, to: string) => setF({ shipFrom: from, shipTo: to }) },
  ], [f, kindDef, setF])

  async function onExport() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shipments.map(r => ({
      'Mã pallet': r.pallet_code, 'Mã hàng': r.material_code, 'Tên hàng': r.short_name,
      'Mã lô': r.batch, 'Ngày SX': r.production_date?.slice(0, 10) ?? '', 'HSD': r.expiry_date?.slice(0, 10) ?? '',
      'SL xuất': r.cartons_scanned, 'Ngày giao': r.delivery_date ?? '', 'Chuyến': r.group_code,
      'Biển số': r.license_plate, 'NPP / khách': r.distributor_name, 'Số DO': r.delivery_code,
      'Kho xuất': r.warehouse_name, 'Lúc quét': r.scanned_at ?? '',
    }))), 'DaGiao')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stock.map(r => ({
      'Mã pallet': r.pallet_code, 'Mã hàng': r.material_code, 'Tên hàng': r.short_name,
      'Mã lô': r.batch, 'Ngày SX': r.production_date?.slice(0, 10) ?? '', 'HSD': r.expiry_date?.slice(0, 10) ?? '',
      'Còn lại': r.cartons_remaining, 'Trạng thái': r.status, 'Kho': r.warehouse_name, 'Vị trí': r.location_code,
    }))), 'ConTrongKho')
    await saveWorkbook(wb, `Truy-xuat-${f.kind}-${f.value}.xlsx`)
  }

  const actions: ActionItem[] = canExport && (shipments.length || stock.length) ? [{
    key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất hồ sơ truy xuất (2 sheet: đã giao · còn trong kho)',
    onClick: onExport, mobileHidden: true,
  }] : []

  const searching = f.value.trim().length >= (f.kind === 'pallet' ? 4 : 2)

  return (
    <>
      <div className="border-b bg-white px-3 py-1.5 sm:py-2 space-y-1 sm:space-y-1.5 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            {kindDef.reverse ? 'khách hàng → đã nhận lô nào' : 'lô hàng → đã giao đi đâu'}
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1.5 flex-wrap w-full min-w-0 sm:contents">
            <FilterSheetButton defs={filterDefs} className="sm:hidden" />
            <ActionCluster items={actions} mobileInline />
          </div>
        </div>
        <FilterBar defs={filterDefs} />
      </div>

      <SummaryBand tiles={[
        { label: 'Pallet khớp', value: num(s?.pallets), accent: true },
        { label: 'Lượt giao', value: num(s?.shipments) },
        { label: 'Khách hàng', value: num(s?.customers) },
        { label: 'Chuyến', value: num(s?.trips) },
        { label: 'SL đã giao', value: num(s?.qty_shipped) },
        { label: 'SL còn trong kho', value: num(s?.qty_on_hand) },
      ]} />

      {q.isError && (
        <div className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
          Không truy xuất được — {apiErrMsg(q.error)}
        </div>
      )}
      {s?.truncated && (
        <div className="mx-3 mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Kết quả quá nhiều nên chỉ hiện phần đầu — ô tổng phía trên vẫn là số ĐẦY ĐỦ. Thu hẹp bằng
          khoảng ngày hoặc mã cụ thể hơn để xem hết danh sách.
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {!searching ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Chọn cách tìm rồi nhập giá trị — {kindDef.hint.toLowerCase()}.
          </div>
        ) : q.isLoading ? (
          <div className="p-3 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : (
          <>
            <SectionBand title={`Đã giao đi đâu (${num(s?.shipments)})`} />
            <ShipTable rows={shipments} />
            <SectionBand title={`Còn trong kho (${num(s?.stock_rows)} dòng · ${num(s?.qty_on_hand)})`} />
            <StockTable rows={stock} />
          </>
        )}
      </div>
    </>
  )
}

/* ═══ TAB 2 — ĐIỀU TRA THEO THÙNG ═════════════════════════════════════════════════════════════ */

const todayVn = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// Ảnh khách gửi: nén 1600px JPEG 0.75 — đủ NÉT cho AI đọc chữ in phun, đủ nhẹ để lưu bằng chứng
async function compressPhoto(file: File): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Không đọc được ảnh'))
    r.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Ảnh hỏng'))
    i.src = url
  })
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.75)
}

const INPUT = 'h-8 w-full rounded-md border border-slate-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-400'
const LABEL = 'text-[10px] font-medium text-slate-500'

function InvestigateTab() {
  const [date, setDate] = useState(todayVn())
  const [time, setTime] = useState('')
  const [matCode, setMatCode] = useState('')
  const [matTerm, setMatTerm] = useState('')
  const { data: mats = [], isFetching: matLoading } = useMaterials({ search: matTerm, limit: 50 })
  const [machine, setMachine] = useState('')
  const [cycle, setCycle] = useState('')
  const [note, setNote] = useState('')
  const [resultNote, setResultNote] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [photoErr, setPhotoErr] = useState('')
  const [aiBusy, setAiBusy] = useState<number | null>(null)
  const [aiMsg, setAiMsg] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const preview = useInvestigatePreview()
  const create = useCreateInvestigation()
  const whs = (useScopedWarehouses().data ?? []) as { id: string; name?: string }[]
  const whName = (id: string | null) => whs.find(w => w.id === id)?.name ?? id ?? '—'

  const selectedMat = mats.find(m => m.material_code === matCode)
  const ready = !!date && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time) && !!matCode
  const input = {
    carton_date: date, carton_time: time, material_code: matCode,
    machine_code: machine.trim() || undefined, cycle: cycle.trim() || undefined,
  }

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return
    setPhotoErr('')
    try {
      const added: string[] = []
      for (const f of Array.from(files).slice(0, 6 - photos.length)) added.push(await compressPhoto(f))
      setPhotos(p => [...p, ...added].slice(0, 6))
    } catch (e) { setPhotoErr((e as Error).message) }
    if (fileRef.current) fileRef.current.value = ''
  }

  // AI đọc chữ in phun từ ảnh — điền Ngày + Giờ; lỗi thì báo nhẹ, KHÔNG chặn nhập tay
  async function onAiRead(i: number) {
    setAiBusy(i); setAiMsg('')
    try {
      const { data } = await apiClient.post('/wms/packing/vision-ocr', { photo_data: photos[i] })
      const d = data?.data as { time?: string | null; nsx_date?: string | null } | undefined
      if (d?.time) setTime(d.time)
      if (d?.nsx_date) setDate(d.nsx_date)
      setAiMsg(d?.time ? `AI đọc được: ${d.nsx_date ?? 'không rõ ngày'} · ${d.time}` : 'AI không đọc được giờ trên ảnh — nhập tay giúp')
    } catch (e) {
      setAiMsg(`AI không đọc được (${apiErrMsg(e)}) — nhập tay giúp`)
    } finally { setAiBusy(null) }
  }

  function onPreview() {
    setSavedId(null)
    preview.mutate(input)
  }
  function onSave() {
    create.mutate({ ...input, note: note.trim() || undefined, result_note: resultNote.trim() || undefined, photos },
      { onSuccess: d => setSavedId(d.id) })
  }

  const r = preview.data
  const matched = r?.matched ?? []
  const trace = r?.trace ?? null

  return (
    <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
      <div className="p-3 space-y-3">
        <section className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-1.5 bg-slate-100 border-b border-slate-200 px-2.5 py-1.5">
            <span className="h-3.5 w-1 rounded-full bg-sky-500 shrink-0" />
            <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">Thông tin trên thùng</p>
            <p className="text-[10px] text-slate-400 ml-auto">giờ phút in phun + mã hàng — máy / chu kỳ giúp khớp chính xác hơn</p>
          </div>
          <div className="p-2.5 space-y-2.5">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div>
                <p className={LABEL}>Ngày SX (trên thùng) *</p>
                <input type="date" className={INPUT} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div>
                <p className={LABEL}>Giờ in trên thùng *</p>
                <input type="time" step={1} className={INPUT} value={time} onChange={e => setTime(e.target.value)} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className={LABEL}>Mã hàng *</p>
                <SingleSelect
                  value={matCode} onChange={setMatCode}
                  serverSearch onSearchChange={setMatTerm} loading={matLoading}
                  selectedLabel={selectedMat ? `${selectedMat.material_code} ${selectedMat.short_name ?? ''}` : matCode || undefined}
                  searchPlaceholder="Tìm mã / tên hàng…" placeholder="Chọn mã hàng"
                  triggerClassName="h-8"
                  options={mats.map(m => ({
                    value: m.material_code,
                    label: `${m.material_code} ${m.short_name ?? m.material_description ?? ''}`,
                  }))}
                />
              </div>
              <div>
                <p className={LABEL}>Máy sản xuất</p>
                <input className={INPUT} placeholder="vd A · 103" value={machine} onChange={e => setMachine(e.target.value)} />
              </div>
              <div>
                <p className={LABEL}>Chu kỳ sản xuất</p>
                <input className={INPUT} placeholder="vd 9" value={cycle} onChange={e => setCycle(e.target.value)} />
              </div>
            </div>

            <div className="flex items-start gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative group">
                  <img src={p} alt={`Ảnh ${i + 1}`} className="h-20 w-20 object-cover rounded border border-slate-200" />
                  <button onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-slate-700 text-white flex items-center justify-center"
                    title="Bỏ ảnh"><X className="h-2.5 w-2.5" /></button>
                  <button onClick={() => onAiRead(i)} disabled={aiBusy !== null}
                    className="absolute bottom-0 inset-x-0 bg-sky-600/90 text-white text-[9px] py-0.5 rounded-b flex items-center justify-center gap-0.5 disabled:opacity-60"
                    title="AI đọc ngày + giờ in phun từ ảnh này">
                    <Sparkles className="h-2.5 w-2.5" /> {aiBusy === i ? 'Đang đọc…' : 'AI đọc giờ'}
                  </button>
                </div>
              ))}
              {photos.length < 6 && (
                <button onClick={() => fileRef.current?.click()}
                  className="h-20 w-20 rounded border border-dashed border-slate-300 text-slate-400 flex flex-col items-center justify-center gap-1 hover:border-sky-400 hover:text-sky-500">
                  <ImagePlus className="h-4 w-4" /><span className="text-[9px]">Thêm ảnh</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden
                onChange={e => void onPickFiles(e.target.files)} />
            </div>
            {photoErr && <p className="text-[10px] text-red-600">{photoErr}</p>}
            {aiMsg && <p className="text-[10px] text-sky-700">{aiMsg}</p>}

            <div className="flex items-center gap-2">
              <button onClick={onPreview} disabled={!ready || preview.isPending}
                className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium disabled:opacity-50">
                {preview.isPending ? 'Đang đối chiếu…' : 'Đối chiếu sổ đóng gói'}
              </button>
              {!ready && <span className="text-[10px] text-slate-400">Cần đủ Ngày · Giờ (HH:MM) · Mã hàng</span>}
            </div>
            {preview.isError && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
                Không đối chiếu được — {apiErrMsg(preview.error)}
              </div>
            )}
          </div>
        </section>

        {r && matched.length === 0 && (
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
            Không có pallet nào trong sổ đóng gói chứa đúng giờ này (khớp ĐÚNG khoảng giờ thùng đầu →
            thùng cuối). Kiểm lại giờ/ngày trên thùng, thử bỏ bớt Máy / Chu kỳ, hoặc trang sổ hôm đó
            chưa được ghi.
          </div>
        )}

        {r && matched.length > 0 && (
          <>
            <SectionBand title={`Pallet khớp sổ đóng gói (${matched.length})`} />
            <MatchTable rows={matched} whName={whName} />
            {trace && (
              <>
                <SummaryBand tiles={[
                  { label: 'Pallet khớp', value: num(trace.summary.pallets), accent: true },
                  { label: 'Lượt giao', value: num(trace.summary.shipments) },
                  { label: 'Khách hàng', value: num(trace.summary.customers) },
                  { label: 'Chuyến', value: num(trace.summary.trips) },
                  { label: 'SL đã giao', value: num(trace.summary.qty_shipped) },
                  { label: 'SL còn trong kho', value: num(trace.summary.qty_on_hand) },
                ]} />
                <SectionBand title={`Đã giao đi đâu (${num(trace.summary.shipments)})`} />
                <ShipTable rows={trace.shipments} />
                <SectionBand title={`Còn trong kho (${num(trace.summary.stock_rows)} dòng · ${num(trace.summary.qty_on_hand)})`} />
                <StockTable rows={trace.stock} />
              </>
            )}

            <section className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-1.5 bg-slate-100 border-b border-slate-200 px-2.5 py-1.5">
                <span className="h-3.5 w-1 rounded-full bg-sky-500 shrink-0" />
                <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">Lưu hồ sơ truy vết</p>
                <p className="text-[10px] text-slate-400 ml-auto">hồ sơ ghi người thực hiện + ảnh + kết quả tại thời điểm điều tra</p>
              </div>
              <div className="p-2.5 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <p className={LABEL}>Bối cảnh (khiếu nại gì, ai báo…)</p>
                    <textarea className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs min-h-[52px]"
                      value={note} onChange={e => setNote(e.target.value)} />
                  </div>
                  <div>
                    <p className={LABEL}>Kết luận của người điều tra</p>
                    <textarea className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs min-h-[52px]"
                      value={resultNote} onChange={e => setResultNote(e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={onSave} disabled={create.isPending || !!savedId}
                    className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium disabled:opacity-50">
                    {create.isPending ? 'Đang lưu…' : savedId ? 'Đã lưu hồ sơ' : 'Lưu hồ sơ truy vết'}
                  </button>
                  {savedId && <span className="text-[11px] text-green-600">Đã lưu — xem lại ở tab "Hồ sơ truy vết".</span>}
                </div>
                {create.isError && (
                  <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
                    Không lưu được — {apiErrMsg(create.error)}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function MatchTable({ rows, whName }: { rows: CartonMatch[]; whName: (id: string | null) => string }) {
  return (
    <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
      <TableHeader>
        <TableRow>
          {['Mã pallet', 'Giờ thùng đầu → cuối', 'Ngày trang sổ', 'Ca', 'Chu kỳ', 'Máy', 'SL (thùng)', 'Kho', 'Người đóng gói']
            .map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(m => (
          <TableRow key={m.pallet_code} className="hover:bg-sky-50/40">
            <TableCell className={`${TD} font-mono font-semibold`}>{m.pallet_code}</TableCell>
            <TableCell className={TD}>
              {m.prod_start_at ? `${formatTimestampDate(m.prod_start_at, true)} ${formatTimestampTime(m.prod_start_at)}` : '—'}
              {' → '}{m.prod_end_at ? formatTimestampTime(m.prod_end_at) : '—'}
            </TableCell>
            <TableCell className={TD}>{m.run?.run_date ? formatDate(m.run.run_date) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{m.run?.shift ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{m.run?.cycle ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{m.machine_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-semibold tabular-nums`}>{m.qty_cartons != null ? num(m.qty_cartons) : '—'}</TableCell>
            <TableCell className={TD}>{whName(m.warehouse_id)}</TableCell>
            <TableCell className={TD}>{m.packed_by_name ?? <span className="text-slate-300">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/* ═══ TAB 3 — HỒ SƠ TRUY VẾT ══════════════════════════════════════════════════════════════════ */

function RecordsTab() {
  const f = useWmsFilterStore(s => s.traceInv)
  const setF = useWmsFilterStore(s => s.setTraceInv)
  const q = useTraceInvestigations({ from: f.from, to: f.to, search: f.search, page: f.page })
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = q.data?.rows ?? []
  const total = q.data?.total ?? 0
  const pageSize = q.data?.page_size ?? 50
  const maxPage = Math.max(1, Math.ceil(total / pageSize))

  const filterDefs: FilterDef[] = useMemo(() => [
    { key: 'created', label: 'Ngày tạo hồ sơ', type: 'daterange', from: f.from, to: f.to,
      onChange: (from, to) => setF({ from, to, page: 1 }) },
    { key: 'search', label: 'Tìm', type: 'text', pinned: true,
      placeholder: 'Mã hàng · người thực hiện · ghi chú', value: f.search,
      onChange: v => setF({ search: v, page: 1 }) },
  ], [f, setF])

  return (
    <>
      <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">mỗi hồ sơ = một lần điều tra, ghi người thực hiện + ảnh + kết quả tại thời điểm đó</span>
          <span className="flex-1" />
          <FilterSheetButton defs={filterDefs} className="sm:hidden" />
        </div>
        <FilterBar defs={filterDefs} />
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        {q.isLoading ? (
          <div className="p-3 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Chưa có hồ sơ truy vết nào — tạo từ tab "Điều tra theo thùng".
          </div>
        ) : (
          <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
            <TableHeader>
              <TableRow>
                {['Lúc tạo', 'Người thực hiện', 'Giờ thùng', 'Mã hàng', 'Máy', 'Chu kỳ', 'Pallet khớp', 'Khách', 'SL giao', 'Ảnh', 'Bối cảnh', 'Kết luận']
                  .map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-sky-50/40" onClick={() => setOpenId(r.id)}>
                  <TableCell className={TD}>{formatTimestampDate(r.created_at, true)} {formatTimestampTime(r.created_at)}</TableCell>
                  <TableCell className={TD}>{r.performed_by_name ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={TD}>{formatTimestampDate(r.carton_at, true)} {formatTimestampTime(r.carton_at)}</TableCell>
                  <TableCell className={`${TD} font-mono font-semibold`}>{r.material_code}</TableCell>
                  <TableCell className={`${TD} font-mono`}>{r.machine_code ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} font-mono`}>{r.cycle ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} font-semibold tabular-nums`}>{r.matched?.length ?? 0}</TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{num(r.summary?.customers)}</TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{num(r.summary?.qty_shipped)}</TableCell>
                  <TableCell className={`${TD} tabular-nums`}>{r.photos?.length ? r.photos.length : <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} max-w-[180px] truncate`}>{r.note ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className={`${TD} max-w-[180px] truncate`}>{r.result_note ?? <span className="text-slate-300">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="border-t bg-white px-3 py-1.5 text-[10px] text-slate-500 flex items-center gap-2 shrink-0">
        <span>{total ? `${(f.page - 1) * pageSize + 1}–${Math.min(f.page * pageSize, total)} / ${total} hồ sơ` : '0 hồ sơ'}</span>
        <span className="flex-1" />
        <button disabled={f.page <= 1} onClick={() => setF({ page: f.page - 1 })}
          className="px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-40">‹</button>
        <span>trang {f.page}/{maxPage}</span>
        <button disabled={f.page >= maxPage} onClick={() => setF({ page: f.page + 1 })}
          className="px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-40">›</button>
      </div>
      <RecordSheet id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function RecordSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useTraceInvestigation(id)
  const whs = (useScopedWarehouses().data ?? []) as { id: string; name?: string }[]
  const whName = (wid: string | null) => whs.find(w => w.id === wid)?.name ?? wid ?? '—'
  const r = q.data
  const trace = (r?.trace ?? null) as TraceResult | null
  return (
    <Sheet open={!!id} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:w-[720px] sm:max-w-[720px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="text-sm">
            Hồ sơ truy vết {r ? `· ${r.material_code} · ${formatTimestampDate(r.carton_at, true)} ${formatTimestampTime(r.carton_at)}` : ''}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-auto">
          {q.isLoading ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : q.isError ? (
            <div className="m-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
              Không mở được hồ sơ — {apiErrMsg(q.error)}
            </div>
          ) : r ? (
            <div className="p-3 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <DRow k="Người thực hiện" v={r.performed_by_name ?? '—'} />
                <DRow k="Lúc tạo" v={`${formatTimestampDate(r.created_at, true)} ${formatTimestampTime(r.created_at)}`} />
                <DRow k="Giờ trên thùng" v={`${formatTimestampDate(r.carton_at, true)} ${formatTimestampTime(r.carton_at)}`} />
                <DRow k="Mã hàng" v={r.material_code} mono />
                <DRow k="Máy" v={r.machine_code ?? '—'} mono />
                <DRow k="Chu kỳ" v={r.cycle ?? '—'} mono />
              </div>
              {r.note && <DRow k="Bối cảnh" v={r.note} />}
              {r.result_note && <DRow k="Kết luận" v={r.result_note} />}
              {(r.photo_urls?.length ?? 0) > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {r.photo_urls!.map(p => (
                    <a key={p.path} href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.url} alt={p.path} className="h-24 w-24 object-cover rounded border border-slate-200" />
                    </a>
                  ))}
                </div>
              )}
              <SectionBand title={`Pallet khớp sổ đóng gói (${r.matched?.length ?? 0})`} />
              <div className="overflow-x-auto"><MatchTable rows={r.matched ?? []} whName={whName} /></div>
              {trace && (
                <>
                  <SectionBand title={`Đã giao đi đâu (${num(trace.summary?.shipments)})`} />
                  <div className="overflow-x-auto"><ShipTable rows={trace.shipments ?? []} /></div>
                  <SectionBand title={`Còn trong kho (${num(trace.summary?.stock_rows)} dòng)`} />
                  <div className="overflow-x-auto"><StockTable rows={trace.stock ?? []} /></div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <p className="flex gap-2">
      <span className="w-28 shrink-0 text-slate-400">{k}</span>
      <span className={`text-slate-700 ${mono ? 'font-mono' : ''}`}>{v}</span>
    </p>
  )
}

/* ═══ Thành phần dùng chung ═══════════════════════════════════════════════════════════════════ */

function SectionBand({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 bg-slate-100 border-y border-slate-200 px-3 py-1.5 sticky top-0 z-20">
      <span className="h-3.5 w-1 rounded bg-sky-500" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{title}</span>
    </div>
  )
}

const TH = 'text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap'
const TD = 'px-2 py-1 text-[10px] whitespace-nowrap'

function ShipTable({ rows }: { rows: TraceShipment[] }) {
  if (!rows.length) return <div className="px-3 py-4 text-[11px] text-slate-400">Chưa có lượt giao nào khớp.</div>
  return (
    <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
      <TableHeader>
        <TableRow>
          {['Mã pallet', 'Mã hàng', 'Tên hàng', 'Mã lô', 'Ngày SX', 'HSD', 'SL xuất', 'Ngày giao', 'Chuyến', 'Biển số', 'NPP / khách', 'Số DO', 'Kho xuất']
            .map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.pallet_code}-${r.group_code}-${i}`} className="hover:bg-sky-50/40">
            <TableCell className={`${TD} font-mono font-semibold`}>{r.pallet_code}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.material_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} max-w-[220px] truncate`}>{r.short_name ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.batch ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.production_date ? formatTimestampDate(r.production_date, true) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.expiry_date ? formatDate(r.expiry_date) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-semibold tabular-nums`}>{num(r.cartons_scanned)}</TableCell>
            <TableCell className={TD}>{r.delivery_date ? formatDate(r.delivery_date) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.group_code}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.license_plate ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} max-w-[200px] truncate`}>{r.distributor_name ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.delivery_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.warehouse_name ?? <span className="text-slate-300">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function StockTable({ rows }: { rows: TraceStock[] }) {
  if (!rows.length) return <div className="px-3 py-4 text-[11px] text-slate-400">Không còn tồn của lô này trong kho.</div>
  return (
    <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
      <TableHeader>
        <TableRow>
          {['Mã pallet', 'Mã hàng', 'Tên hàng', 'Mã lô', 'Ngày SX', 'HSD', 'Còn lại', 'Trạng thái', 'Kho', 'Vị trí', 'Ngày nhập']
            .map(h => <TableHead key={h} className={TH}>{h}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={`${r.pallet_code}-${r.warehouse_name}-${r.location_code}`} className="hover:bg-sky-50/40">
            <TableCell className={`${TD} font-mono font-semibold`}>{r.pallet_code}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.material_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} max-w-[220px] truncate`}>{r.short_name ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.batch ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.production_date ? formatTimestampDate(r.production_date, true) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.expiry_date ? formatDate(r.expiry_date) : <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-semibold tabular-nums`}>{num(r.cartons_remaining)}</TableCell>
            <TableCell className={TD}>{r.status}</TableCell>
            <TableCell className={TD}>{r.warehouse_name ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={`${TD} font-mono`}>{r.location_code ?? <span className="text-slate-300">—</span>}</TableCell>
            <TableCell className={TD}>{r.import_date ? formatDate(r.import_date) : <span className="text-slate-300">—</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
