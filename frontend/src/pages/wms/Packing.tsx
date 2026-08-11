// SỔ ĐÓNG GÓI ĐIỆN TỬ (11/08/2026) — số hóa sổ đóng gói viết tay tại xưởng SX.
// Workflow (user chốt): tem in sẵn → QUÉT TEM lúc bắt đầu xếp pallet (mở sổ) → pallet đầy
// → ĐÓNG (chụp thùng cuối). GIỜ SẢN XUẤT CHÍNH = chữ in phun trên thùng đầu/cuối:
// chụp ảnh → OCR Tesseract tại máy (bậc 0, miễn phí) điền sẵn → công nhân xác nhận;
// đọc trượt thì gõ tay — ẢNH luôn được lưu làm bằng chứng truy vết.
// Giờ bấm nút chỉ là giờ THAO TÁC (đối chiếu chéo, không phải giờ SX).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosError } from 'axios'
import { NotebookPen, ScanLine, Camera, Check, X, Pencil, Clock, AlertTriangle, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormSheet } from '@/components/shared/FormSheet'
import { QRScanner, type QRScannerHandle } from '@/components/shared/QRScanner'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { parseCodeFields } from '@/components/shared/palletLabel'
import {
  usePackingBoard, usePackingLogs, useOpenPackingLog, useClosePackingLog,
  useUpdatePackingLog, useCancelPackingLog, type PackingLog,
} from '@/api/hooks'
import { readCartonPrint } from '@/utils/cartonOcr'
import { normalizeQR } from '@/utils/qr'
import { unlockAudio, playBeep } from '@/utils/audio'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const dmyToIso = (dmy: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((dmy ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
const apiMsg = (e: unknown, fb: string) =>
  (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? fb

// Nén ảnh client-side (mẫu Forklift) — mục tiêu ~300KB, trần BE 4MB
const PHOTO_TARGET_BYTES = 400 * 1024
const bytesOf = (dataUrl: string) => Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4)
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
  const draw = (maxW: number) => {
    const scale = Math.min(1, maxW / img.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  }
  const canvas = draw(1280)
  let out = canvas.toDataURL('image/jpeg', 0.75)
  for (const q of [0.6, 0.5]) {
    if (bytesOf(out) <= PHOTO_TARGET_BYTES) break
    out = canvas.toDataURL('image/jpeg', q)
  }
  if (bytesOf(out) > PHOTO_TARGET_BYTES) out = draw(900).toDataURL('image/jpeg', 0.55)
  return out
}

function PhotoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <img src={url} alt="Ảnh thùng" className="max-w-full max-h-full rounded-lg" />
    </div>
  )
}

const STATUS_BADGE: Record<string, string> = {
  OPEN:      'bg-amber-100 text-amber-800',
  CLOSED:    'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-200 text-slate-500',
}
const STATUS_LABEL: Record<string, string> = { OPEN: 'Đang đóng', CLOSED: 'Đã đóng', CANCELLED: 'Đã hủy' }
const SRC_BADGE = (src: string | null) =>
  src === 'OCR' ? <span className="text-[8px] px-1 rounded bg-sky-100 text-sky-700" title="Đọc tự động từ ảnh chữ in phun">OCR</span>
  : src === 'MANUAL' ? <span className="text-[8px] px-1 rounded bg-amber-100 text-amber-800" title="Nhập tay (có ảnh đối chứng nếu đã chụp)">tay</span>
  : null

// ─── Ô "chụp thùng + đọc giờ in phun" (dùng chung cho MỞ và ĐÓNG) ─────────────
// Giá trị đẩy lên parent: photoData (đã nén) · iso (giờ SX từ date+time VN) · src (OCR nếu
// giữ nguyên kết quả đọc, MANUAL nếu người dùng sửa/gõ) · raw (nguyên văn OCR — lưu DB).
export interface ProdTimeValue { photoData: string | null; iso: string | null; src: 'OCR' | 'MANUAL' | null; raw: string | null }
function PhotoOcrField({ label, defaultDate, onValue }: {
  label: string
  defaultDate: string
  onValue: (v: ProdTimeValue) => void
}) {
  const [photoData, setPhotoData] = useState<string | null>(null)
  const [busy, setBusy] = useState<'photo' | 'ocr' | null>(null)
  const [ocrTime, setOcrTime] = useState<string | null>(null)   // giá trị OCR gốc — so để biết user có sửa không
  const [ocrRaw, setOcrRaw] = useState<string | null>(null)
  const [ocrFail, setOcrFail] = useState(false)
  const [time, setTime] = useState('')                          // HH:MM hoặc HH:MM:SS
  const [date, setDate] = useState(defaultDate)
  const [full, setFull] = useState(false)

  useEffect(() => { setDate(d => d || defaultDate) }, [defaultDate])
  useEffect(() => {
    const t = /^(\d{1,2}):(\d{2})(:(\d{2}))?$/.exec(time.trim())
    let iso: string | null = null
    if (t && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const hh = String(Math.min(23, +t[1])).padStart(2, '0')
      const d = new Date(`${date}T${hh}:${t[2]}:${t[4] ?? '00'}+07:00`)
      if (!isNaN(d.getTime())) iso = d.toISOString()
    }
    const src: 'OCR' | 'MANUAL' | null = !iso ? null : (ocrTime && time === ocrTime ? 'OCR' : 'MANUAL')
    onValue({ photoData, iso, src, raw: ocrRaw })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoData, time, date, ocrTime, ocrRaw])

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy('photo'); setOcrFail(false)
    try {
      const data = await compressPhoto(file)
      setPhotoData(data)
      setBusy('ocr')
      const info = await readCartonPrint(data)
      setOcrRaw(info.raw || null)
      if (info.ok && info.time) {
        setOcrTime(info.time); setTime(info.time)
        if (info.nsxDate) setDate(info.nsxDate)
      } else {
        setOcrTime(null); setOcrFail(true)
      }
    } catch { setOcrFail(true) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-slate-700">{label}</p>
      <label className={`flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm cursor-pointer transition-colors ${photoData ? 'border-slate-200 text-slate-500 hover:bg-slate-50' : 'border-sky-400 bg-sky-50 text-sky-700 font-medium'}`}>
        <Camera className="h-4 w-4" />
        {busy === 'photo' ? 'Đang xử lý ảnh…' : busy === 'ocr' ? 'Đang đọc chữ in phun…' : photoData ? 'Chụp lại' : 'Chụp vùng chữ date trên thùng'}
        <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!!busy}
          onChange={e => { void handleFile(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {photoData && (
        <img src={photoData} alt="Ảnh date thùng" className="h-16 rounded border border-slate-200 object-cover cursor-zoom-in" onClick={() => setFull(true)} />
      )}
      {full && photoData && <PhotoLightbox url={photoData} onClose={() => setFull(false)} />}
      {ocrFail && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" /> Không đọc được chữ — nhìn thùng gõ giờ vào (ảnh vẫn được lưu làm bằng chứng)
        </p>
      )}
      <div className="flex items-center gap-2">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 w-36 text-sm" />
        <Input value={time} onChange={e => setTime(e.target.value)} placeholder="HH:MM:SS"
          inputMode="numeric" className={`h-9 w-28 text-sm tabular-nums text-center ${ocrTime && time === ocrTime ? 'border-sky-400 bg-sky-50 font-semibold' : ''}`} />
        {ocrTime && time === ocrTime && <span className="text-[10px] text-sky-700 font-medium shrink-0">✓ đọc từ ảnh</span>}
      </div>
    </div>
  )
}

// ─── Trang chính ──────────────────────────────────────────────────────────────
export default function Packing() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canRecord = can(perms, 'packing', 'record')
  const canEdit   = can(perms, 'packing', 'edit')
  const canCancel = can(perms, 'packing', 'cancel')
  const canExport = can(perms, 'packing', 'export')

  const f = useWmsFilterStore(s => s.packing)
  const setF = useWmsFilterStore(s => s.setPacking)

  const board = usePackingBoard()
  const openRows = board.data ?? []

  // Quét mở pallet — overlay keep-mounted (chuẩn qr-scan-flow), camera tắt hẳn khi đóng
  const [hasOpenedScan, setHasOpenedScan] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const scannerRef = useRef<QRScannerHandle>(null)
  const [pendingQR, setPendingQR] = useState<string | null>(null)   // tem vừa quét → mở OpenSheet
  const [closeTarget, setCloseTarget] = useState<PackingLog | null>(null)
  const [editTarget, setEditTarget] = useState<PackingLog | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PackingLog | null>(null)
  const [banner, setBanner] = useState('')

  function handleScan(raw: string) {
    playBeep()
    setShowScan(false)
    setPendingQR(normalizeQR(raw))
  }

  const tabBar = (
    <div className="flex items-center gap-1 border-b bg-white px-3 pt-2 shrink-0 sm:rounded-t-xl">
      <NotebookPen className="h-4 w-4 text-sky-600 shrink-0 mb-1.5 mr-0.5" />
      {([['board', `Đóng gói${openRows.length ? ` (${openRows.length})` : ''}`], ['log', 'Sổ']] as const).map(([k, label]) => (
        <button key={k} type="button" onClick={() => setF({ tab: k })}
          className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors ${
            f.tab === k ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}>
          {label}
        </button>
      ))}
      <div className="flex-1" />
      {canRecord && (
        <Button size="sm" className="h-8 mb-1 text-xs bg-blue-600 hover:bg-blue-700"
          onClick={() => { unlockAudio(); setHasOpenedScan(true); setShowScan(true) }}>
          <ScanLine className="h-3.5 w-3.5 mr-1" /> Quét tem — mở pallet
        </Button>
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full sm:p-3">
      <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
        {tabBar}
        {banner && (
          <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2 flex items-start justify-between gap-2">
            <span>{banner}</span>
            <button type="button" onClick={() => setBanner('')}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        {f.tab === 'board'
          ? <BoardTab rows={openRows} loading={board.isLoading} canRecord={canRecord} canCancel={canCancel}
              onClose={setCloseTarget} onCancel={setCancelTarget} />
          : <LogTab canEdit={canEdit} canCancel={canCancel} canExport={canExport} openCount={openRows.length}
              onEdit={setEditTarget} onCancel={setCancelTarget} onCloseRow={setCloseTarget} />}
      </div>

      {/* Camera keep-mounted (CSS hidden) — active tắt stream khi đóng */}
      {hasOpenedScan && (
        <div className={`fixed inset-0 z-50 bg-black/90 flex flex-col ${showScan ? '' : 'hidden'}`}>
          <div className="flex items-center justify-between px-4 py-2 text-white shrink-0">
            <p className="text-sm font-semibold">Quét tem pallet — lúc BẮT ĐẦU xếp</p>
            <button type="button" onClick={() => setShowScan(false)} className="p-2"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 min-h-0">
            <QRScanner ref={scannerRef} fill active={showScan} stopOnScan onScan={handleScan} onClose={() => setShowScan(false)} />
          </div>
        </div>
      )}

      {pendingQR && (
        <OpenSheet code={pendingQR} openRows={openRows}
          onCloseFirst={(log) => setCloseTarget(log)}
          onDone={() => setPendingQR(null)}
          onError={setBanner} />
      )}
      {closeTarget && (
        <CloseSheet log={closeTarget} onDone={() => setCloseTarget(null)} onError={setBanner} />
      )}
      {editTarget && (
        <EditSheet log={editTarget} onDone={() => setEditTarget(null)} onError={setBanner} />
      )}
      {cancelTarget && (
        <CancelConfirm log={cancelTarget} onDone={() => setCancelTarget(null)} onError={setBanner} />
      )}
    </div>
  )
}

// ─── Tab BOARD — pallet đang mở, nhóm theo máy ───────────────────────────────
function BoardTab({ rows, loading, canRecord, canCancel, onClose, onCancel }: {
  rows: PackingLog[]; loading: boolean; canRecord: boolean; canCancel: boolean
  onClose: (l: PackingLog) => void; onCancel: (l: PackingLog) => void
}) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t) }, [])
  const byMachine = useMemo(() => {
    const m = new Map<string, PackingLog[]>()
    for (const r of rows) {
      const k = r.machine_code || '?'
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const elapsed = (iso: string) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
    return mins < 60 ? `${mins}p` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
  }
  const stale = (iso: string) => Date.now() - new Date(iso).getTime() > 4 * 3600_000

  return (
    <div className="flex-1 min-h-0 overflow-auto p-3 pb-20 lg:pb-4">
      {loading ? (
        <p className="text-center py-10 text-xs text-slate-400">Đang tải…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <NotebookPen className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Chưa có pallet nào đang đóng gói</p>
          {canRecord && <p className="text-xs mt-1">Bấm "Quét tem — mở pallet" khi đặt thùng đầu tiên</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {byMachine.map(([machine, list]) => (
            <div key={machine}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-1 h-3.5 bg-sky-500 rounded-sm" />
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">Máy {machine}</span>
                <span className="text-[10px] text-slate-400">{list.length} pallet đang mở</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {list.map(l => {
                  const old = stale(l.open_scan_at)
                  return (
                    <div key={l.id} className={`rounded-lg border p-2.5 space-y-1.5 ${old ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-semibold text-slate-800 truncate flex-1" title={l.pallet_code}>{l.material_code ?? '?'}</span>
                        <span className={`text-[10px] font-semibold tabular-nums inline-flex items-center gap-0.5 ${old ? 'text-red-600' : 'text-slate-500'}`}>
                          <Clock className="h-3 w-3" /> {elapsed(l.open_scan_at)}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 truncate" title={l.pallet_code}>{l.pallet_code}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        <span>{l.qty_cartons != null ? `${Number(l.qty_cartons).toLocaleString('vi-VN')} thùng (chuẩn tem)` : 'SL: —'}</span>
                        {l.prod_start_at && (
                          <span className="tabular-nums">SX {formatTimestampTime(l.prod_start_at)} {SRC_BADGE(l.prod_start_src)}</span>
                        )}
                      </div>
                      {old && <p className="text-[10px] text-red-600 font-medium">Mở quá 4 giờ — quên đóng?</p>}
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {canRecord && (
                          <Button size="sm" className="h-7 text-[11px] flex-1 bg-blue-600 hover:bg-blue-700" onClick={() => onClose(l)}>
                            <Check className="h-3 w-3 mr-1" /> Đóng pallet
                          </Button>
                        )}
                        {canCancel && (
                          <button type="button" title="Hủy dòng (ghi nhầm)" onClick={() => onCancel(l)}
                            className="px-1.5 py-1 rounded border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sheet MỞ SỔ — sau khi quét tem ──────────────────────────────────────────
function OpenSheet({ code, openRows, onCloseFirst, onDone, onError }: {
  code: string; openRows: PackingLog[]
  onCloseFirst: (l: PackingLog) => void
  onDone: () => void; onError: (m: string) => void
}) {
  const openMut = useOpenPackingLog()
  const fields = useMemo(() => parseCodeFields(code), [code])
  const defaultDate = dmyToIso(fields.dateDisplay) ?? todayVN()
  const [prod, setProd] = useState<ProdTimeValue>({ photoData: null, iso: null, src: null, raw: null })
  // Máy này còn pallet đang mở? (dây chuyền liên tục — thường phải đóng pallet trước đã)
  const prevOpen = useMemo(
    () => openRows.find(r => r.machine_code && fields.machine && r.machine_code === fields.machine && r.pallet_code !== code) ?? null,
    [openRows, fields.machine, code])

  function save() {
    openMut.mutate({
      qr_code: code,
      photo_data: prod.photoData,
      prod_start_at: prod.iso,
      prod_start_src: prod.iso ? prod.src : null,
      ocr_raw: prod.raw,
    }, {
      onSuccess: () => onDone(),
      onError: (e) => onError(apiMsg(e, 'Không mở được sổ — thử lại')),
    })
  }

  return (
    <FormSheet open onClose={onDone} title="Mở sổ đóng gói — pallet mới"
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="outline" className="flex-1" onClick={onDone}>Hủy</Button>
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={openMut.isPending} onClick={save}>
            {openMut.isPending ? 'Đang lưu…' : 'Mở sổ'}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs space-y-0.5">
          <p className="font-mono font-semibold text-slate-800 break-all">{code}</p>
          <p className="text-slate-500">
            Mã hàng <b className="text-slate-700">{fields.materialCode || '?'}</b>
            {fields.machine && <> · Máy <b className="text-slate-700">{fields.machine}</b></>}
            {fields.seq && <> · Pallet <b className="text-slate-700">{fields.seq}</b></>}
            {fields.dateDisplay && <> · NSX tem {fields.dateDisplay}</>}
          </p>
        </div>
        {prevOpen && (
          <div className="rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 space-y-1.5">
            <p className="flex items-start gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Máy {fields.machine} còn pallet <b className="font-mono">{prevOpen.pallet_code.slice(0, 30)}…</b> ĐANG MỞ — dây chuyền liên tục thì đóng pallet đó trước.</p>
            <Button size="sm" variant="outline" className="h-7 text-[11px] border-amber-300"
              onClick={() => onCloseFirst(prevOpen)}>
              <Check className="h-3 w-3 mr-1" /> Đóng pallet trước (tem này sẽ chờ)
            </Button>
          </div>
        )}
        <PhotoOcrField label="Chụp chữ date trên THÙNG ĐẦU TIÊN (giờ SX bắt đầu)" defaultDate={defaultDate} onValue={setProd} />
        <p className="text-[10px] text-slate-400">
          Giờ sản xuất lấy từ CHỮ IN PHUN trên thùng (không phải giờ bấm nút). Chưa chụp được thì vẫn Mở sổ — bổ sung khi đóng hoặc sửa sau.
        </p>
      </div>
    </FormSheet>
  )
}

// ─── Sheet ĐÓNG SỔ — pallet đầy ──────────────────────────────────────────────
function CloseSheet({ log, onDone, onError }: { log: PackingLog; onDone: () => void; onError: (m: string) => void }) {
  const closeMut = useClosePackingLog()
  const startDate = log.prod_start_at
    ? new Date(log.prod_start_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    : (dmyToIso(parseCodeFields(log.pallet_code).dateDisplay) ?? todayVN())
  const [qty, setQty] = useState(log.qty_cartons != null ? String(log.qty_cartons) : '')
  const [prod, setProd] = useState<ProdTimeValue>({ photoData: null, iso: null, src: null, raw: null })

  function save() {
    const q = qty.trim() === '' ? null : Number(qty.replace(',', '.'))
    if (q !== null && (!Number.isFinite(q) || q <= 0)) { onError('Số thùng phải là số dương'); return }
    closeMut.mutate({
      id: log.id,
      qty_cartons: q,
      photo_data: prod.photoData,
      prod_end_at: prod.iso,
      prod_end_src: prod.iso ? prod.src : null,
      ocr_raw: prod.raw,
    }, {
      onSuccess: () => onDone(),
      onError: (e) => onError(apiMsg(e, 'Không đóng được sổ — thử lại')),
    })
  }

  return (
    <FormSheet open onClose={onDone} title="Đóng pallet — pallet đã đầy"
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="outline" className="flex-1" onClick={onDone}>Hủy</Button>
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={closeMut.isPending} onClick={save}>
            {closeMut.isPending ? 'Đang lưu…' : 'Đóng sổ'}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs space-y-0.5">
          <p className="font-mono font-semibold text-slate-800 break-all">{log.pallet_code}</p>
          <p className="text-slate-500">
            Mã hàng <b className="text-slate-700">{log.material_code ?? '?'}</b>
            {log.machine_code && <> · Máy <b className="text-slate-700">{log.machine_code}</b></>}
            {log.prod_start_at && <> · SX từ <b className="text-slate-700 tabular-nums">{formatTimestampTime(log.prod_start_at)}</b></>}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Số thùng trên pallet</p>
          <Input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal"
            className="h-9 w-32 text-sm tabular-nums" placeholder="Số thùng" />
          {log.qty_cartons != null && (
            <p className="text-[10px] text-slate-400 mt-0.5">Số chuẩn theo tem: {Number(log.qty_cartons).toLocaleString('vi-VN')} — chỉ sửa khi pallet lẻ</p>
          )}
        </div>
        <PhotoOcrField label="Chụp chữ date trên THÙNG CUỐI CÙNG (giờ SX kết thúc)" defaultDate={startDate} onValue={setProd} />
      </div>
    </FormSheet>
  )
}

// ─── Sheet SỬA (packing.edit) — sau khi đóng: giờ SX / số thùng / ghi chú ─────
function EditSheet({ log, onDone, onError }: { log: PackingLog; onDone: () => void; onError: (m: string) => void }) {
  const upd = useUpdatePackingLog()
  const toLocal = (iso: string | null) => {
    if (!iso) return { d: '', t: '' }
    const d = new Date(iso)
    return {
      d: d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
      t: d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }),
    }
  }
  const s0 = toLocal(log.prod_start_at), e0 = toLocal(log.prod_end_at)
  const [sd, setSd] = useState(s0.d); const [st, setSt] = useState(s0.t)
  const [ed, setEd] = useState(e0.d); const [et, setEt] = useState(e0.t)
  const [qty, setQty] = useState(log.qty_cartons != null ? String(log.qty_cartons) : '')
  const [note, setNote] = useState(log.note ?? '')

  const toIso = (d: string, t: string): string | null | 'ERR' => {
    if (!d && !t) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(t.trim())) return 'ERR'
    const dt = new Date(`${d}T${t.trim().length === 5 ? t.trim() + ':00' : t.trim()}+07:00`)
    return isNaN(dt.getTime()) ? 'ERR' : dt.toISOString()
  }

  function save() {
    const si = toIso(sd, st), ei = toIso(ed, et)
    if (si === 'ERR' || ei === 'ERR') { onError('Ngày/giờ SX không hợp lệ (giờ dạng HH:MM hoặc HH:MM:SS)'); return }
    const q = qty.trim() === '' ? undefined : Number(qty.replace(',', '.'))
    if (q !== undefined && (!Number.isFinite(q) || q <= 0)) { onError('Số thùng phải là số dương'); return }
    upd.mutate({
      id: log.id,
      prod_start_at: si, prod_end_at: ei,
      ...(q !== undefined ? { qty_cartons: q } : {}),
      note: note.trim() || null,
    }, {
      onSuccess: () => onDone(),
      onError: (e) => onError(apiMsg(e, 'Không lưu được — thử lại')),
    })
  }

  const timeRow = (label: string, d: string, setD: (v: string) => void, t: string, setT: (v: string) => void) => (
    <div>
      <p className="text-xs font-medium text-slate-700 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <Input type="date" value={d} onChange={e => setD(e.target.value)} className="h-9 w-36 text-sm" />
        <Input value={t} onChange={e => setT(e.target.value)} placeholder="HH:MM:SS" inputMode="numeric" className="h-9 w-28 text-sm tabular-nums text-center" />
      </div>
    </div>
  )

  return (
    <FormSheet open onClose={onDone} title={`Sửa dòng sổ — ${log.material_code ?? ''}`}
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="outline" className="flex-1" onClick={onDone}>Hủy</Button>
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={upd.isPending} onClick={save}>
            {upd.isPending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <p className="font-mono text-[11px] text-slate-500 break-all">{log.pallet_code}</p>
        {timeRow('Giờ SX thùng đầu', sd, setSd, st, setSt)}
        {timeRow('Giờ SX thùng cuối', ed, setEd, et, setEt)}
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Số thùng</p>
          <Input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" className="h-9 w-32 text-sm tabular-nums" />
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Ghi chú</p>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-9 text-sm" placeholder="Lý do sửa / ghi chú" />
        </div>
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Sửa tay sẽ đánh dấu nguồn giờ/số là "tay" — sổ phân biệt được dòng máy ghi và dòng người can thiệp.
        </p>
      </div>
    </FormSheet>
  )
}

// ─── Xác nhận hủy ────────────────────────────────────────────────────────────
function CancelConfirm({ log, onDone, onError }: { log: PackingLog; onDone: () => void; onError: (m: string) => void }) {
  const cancelMut = useCancelPackingLog()
  const [note, setNote] = useState('')
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onDone}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-slate-800">Hủy dòng sổ này?</p>
        <p className="text-xs text-slate-500 font-mono break-all">{log.pallet_code}</p>
        <p className="text-[11px] text-slate-500">Dòng hủy vẫn nằm trong sổ (trạng thái Đã hủy) để giữ vết — không xóa mất.</p>
        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Lý do hủy (nên ghi)" className="h-9 text-sm" />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onDone}>Không</Button>
          <Button variant="destructive" className="flex-1" disabled={cancelMut.isPending}
            onClick={() => cancelMut.mutate({ id: log.id, note: note.trim() || undefined }, {
              onSuccess: () => onDone(),
              onError: (e) => { onError(apiMsg(e, 'Không hủy được')); onDone() },
            })}>
            {cancelMut.isPending ? 'Đang hủy…' : 'Hủy dòng'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab SỔ — lịch sử (table-format) ─────────────────────────────────────────
const LOG_COLS = [
  { id: 'status',  label: 'Trạng thái',    w: 90 },
  { id: 'pallet',  label: 'Tem pallet',    w: 220 },
  { id: 'mat',     label: 'Mã hàng',       w: 110 },
  { id: 'machine', label: 'Máy',           w: 60 },
  { id: 'qty',     label: 'Số thùng',      w: 90 },
  { id: 'prod',    label: 'Giờ SX (in phun)', w: 200 },
  { id: 'scan',    label: 'Thao tác quét', w: 170 },
  { id: 'by',      label: 'Người đóng',    w: 120 },
  { id: 'photo',   label: 'Ảnh',           w: 90 },
  { id: 'note',    label: 'Ghi chú',       w: 140 },
  { id: 'act',     label: '',              w: 80 },
]
const LOG_COL_DEFAULTS = LOG_COLS.map(c => c.w)

function LogTab({ canEdit, canCancel, canExport, openCount, onEdit, onCancel, onCloseRow }: {
  canEdit: boolean; canCancel: boolean; canExport: boolean; openCount: number
  onEdit: (l: PackingLog) => void; onCancel: (l: PackingLog) => void; onCloseRow: (l: PackingLog) => void
}) {
  const f = useWmsFilterStore(s => s.packing)
  const setF = useWmsFilterStore(s => s.setPacking)
  const { widths: colW, startResize, totalWidth } = useColumnResize('packing_col_widths', LOG_COL_DEFAULTS)
  const [exporting, setExporting] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const { data, isLoading } = usePackingLogs({
    status: f.status || undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
    machine: f.machine || undefined,
    search: f.search || undefined,
    page: f.page, pageSize: f.pageSize,
  })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const closed = rows.filter(r => r.status === 'CLOSED')
  const manualN = closed.filter(r => r.prod_start_src === 'MANUAL' || r.prod_end_src === 'MANUAL').length

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày mở sổ', type: 'daterange', pinned: true, from: f.dateFrom, to: f.dateTo,
      onChange: (from, to) => setF({ dateFrom: from, dateTo: to, page: 1 }) },
    { key: 'status', label: 'Trạng thái', type: 'single',
      options: [{ value: 'OPEN', label: 'Đang đóng' }, { value: 'CLOSED', label: 'Đã đóng' }, { value: 'CANCELLED', label: 'Đã hủy' }],
      value: f.status, onChange: (v: string) => setF({ status: v, page: 1 }) },
    { key: 'machine', label: 'Máy', type: 'text', value: f.machine, placeholder: 'VD: M1',
      onChange: (v: string) => setF({ machine: v, page: 1 }) },
  ]

  async function exportExcel() {
    setExporting(true)
    try {
      const [{ saveWorkbook }, XLSX, { sanitizeRows }] = await Promise.all([
        import('@/utils/saveExcel'), import('xlsx'), import('@/utils/excelSafe'),
      ])
      const out = rows.map(r => ({
        'Trạng thái': STATUS_LABEL[r.status] ?? r.status,
        'Tem pallet': r.pallet_code,
        'Mã hàng': r.material_code ?? '',
        'Máy': r.machine_code ?? '',
        'Số thùng': r.qty_cartons ?? '',
        'Nguồn SL': r.qty_source === 'MANUAL' ? 'Nhập tay' : 'Theo tem',
        'Giờ SX thùng đầu': r.prod_start_at ? `${formatTimestampDate(r.prod_start_at)} ${formatTimestampTime(r.prod_start_at)}` : '',
        'Nguồn giờ đầu': r.prod_start_src ?? '',
        'Giờ SX thùng cuối': r.prod_end_at ? `${formatTimestampDate(r.prod_end_at)} ${formatTimestampTime(r.prod_end_at)}` : '',
        'Nguồn giờ cuối': r.prod_end_src ?? '',
        'Quét mở lúc': `${formatTimestampDate(r.open_scan_at)} ${formatTimestampTime(r.open_scan_at)}`,
        'Đóng lúc': r.close_scan_at ? `${formatTimestampDate(r.close_scan_at)} ${formatTimestampTime(r.close_scan_at)}` : '',
        'Người đóng': r.packed_by_name ?? '',
        'Ghi chú': r.note ?? '',
      }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sanitizeRows(out)), 'So dong goi')
      await saveWorkbook(wb, `so-dong-goi-${todayVN()}`)
    } finally { setExporting(false) }
  }

  return (
    <>
      <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={f.search} onChange={v => setF({ search: v, page: 1 })}
            placeholder="Tìm tem / mã hàng / người đóng…" className="flex-1 min-w-[120px]" />
          <span className="sm:hidden"><FilterSheetButton defs={filterDefs} /></span>
          {canExport && (
            <Button size="sm" variant="outline" className="h-9 sm:h-7 text-[11px]" disabled={exporting || !rows.length} onClick={exportExcel}>
              <Download className="h-3.5 w-3.5 mr-1" /> {exporting ? 'Đang xuất…' : 'Xuất Excel'}
            </Button>
          )}
        </div>
        <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
      </div>

      <SummaryBand tiles={[
        { label: 'Đang mở', value: openCount.toLocaleString('vi-VN'), accent: openCount > 0 },
        { label: 'Dòng sổ (bộ lọc)', value: total.toLocaleString('vi-VN') },
        { label: 'Thùng (trang này)', value: closed.reduce((s, r) => s + Number(r.qty_cartons ?? 0), 0).toLocaleString('vi-VN') },
        { label: 'Giờ nhập tay (trang)', value: closed.length ? `${manualN}/${closed.length}` : '0' },
      ]} />

      <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
        <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
          style={{ width: totalWidth, minWidth: '100%' }}>
          <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <TableHeader>
            <TableRow>
              {LOG_COLS.map((c, i) => (
                <TableHead key={c.id}
                  className={`text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap ${i === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>
                  {c.label}
                  <span onPointerDown={e => startResize(i, e)}
                    className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={LOG_COLS.length} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={LOG_COLS.length} className="text-center py-8 text-xs text-slate-400">Chưa có dòng sổ nào khớp bộ lọc</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id} className={r.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}>
                <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-white">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full no-underline ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono truncate" title={r.pallet_code}>{r.pallet_code}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{r.material_code ?? '—'}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.machine_code ?? '—'}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums font-semibold">
                  {r.qty_cartons != null ? Number(r.qty_cartons).toLocaleString('vi-VN') : <span className="text-slate-300">—</span>}
                  {r.qty_source === 'MANUAL' && <span className="ml-1 text-[8px] px-1 rounded bg-amber-100 text-amber-800 no-underline">tay</span>}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                  {r.prod_start_at || r.prod_end_at ? (
                    <span className="font-semibold">
                      {r.prod_start_at ? formatTimestampTime(r.prod_start_at) : '—'} {SRC_BADGE(r.prod_start_src)}
                      <span className="text-slate-400 font-normal"> → </span>
                      {r.prod_end_at ? formatTimestampTime(r.prod_end_at) : '—'} {SRC_BADGE(r.prod_end_src)}
                      <span className="text-slate-400 font-normal ml-1">{r.prod_start_at ? formatTimestampDate(r.prod_start_at, true) : ''}</span>
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums text-slate-400">
                  {formatTimestampTime(r.open_scan_at)}{r.close_scan_at ? ` → ${formatTimestampTime(r.close_scan_at)}` : ''} · {formatTimestampDate(r.open_scan_at, true)}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.packed_by_name ?? ''}>{r.packed_by_name ?? '—'}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  {(r.photo_start_url || r.photo_end_url) ? (
                    <span className="inline-flex gap-1">
                      {r.photo_start_url && <img src={r.photo_start_url} alt="đầu" className="h-6 w-9 object-cover rounded cursor-zoom-in border border-slate-200" onClick={() => setLightbox(r.photo_start_url!)} />}
                      {r.photo_end_url && <img src={r.photo_end_url} alt="cuối" className="h-6 w-9 object-cover rounded cursor-zoom-in border border-slate-200" onClick={() => setLightbox(r.photo_end_url!)} />}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.note ?? ''}>{r.note ?? <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <span className="inline-flex gap-1">
                    {r.status === 'OPEN' && canEdit && (
                      <button type="button" title="Đóng pallet" onClick={e => { e.stopPropagation(); onCloseRow(r) }}
                        className="px-1.5 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"><Check className="h-3.5 w-3.5" /></button>
                    )}
                    {r.status !== 'CANCELLED' && canEdit && (
                      <button type="button" title="Sửa giờ SX / số thùng" onClick={e => { e.stopPropagation(); onEdit(r) }}
                        className="px-1.5 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /></button>
                    )}
                    {r.status !== 'CANCELLED' && canCancel && (
                      <button type="button" title="Hủy dòng" onClick={e => { e.stopPropagation(); onCancel(r) }}
                        className="px-1.5 py-1 rounded border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200"><X className="h-3.5 w-3.5" /></button>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0 flex items-center gap-3">
        <span>1–{rows.length} / {total.toLocaleString('vi-VN')} dòng sổ</span>
        {total > f.pageSize && (
          <span className="inline-flex items-center gap-1">
            <button type="button" disabled={f.page <= 1} onClick={() => setF({ page: f.page - 1 })}
              className="px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-40">‹</button>
            trang {f.page}/{Math.max(1, Math.ceil(total / f.pageSize))}
            <button type="button" disabled={f.page >= Math.ceil(total / f.pageSize)} onClick={() => setF({ page: f.page + 1 })}
              className="px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-40">›</button>
          </span>
        )}
        <span className="hidden sm:inline text-slate-400">Giờ SX = chữ in phun trên thùng (OCR/tay) · giờ quét chỉ là thao tác</span>
      </div>
      {lightbox && <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}
