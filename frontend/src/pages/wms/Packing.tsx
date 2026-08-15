// SỔ ĐÓNG GÓI ĐIỆN TỬ (11/08/2026) — số hóa sổ đóng gói viết tay tại xưởng SX.
// Workflow (user chốt): tem in sẵn → QUÉT TEM lúc bắt đầu xếp pallet (mở sổ) → pallet đầy
// → ĐÓNG (chụp thùng cuối). GIỜ SẢN XUẤT CHÍNH = chữ in phun trên thùng đầu/cuối:
// chụp ảnh → OCR Tesseract tại máy (bậc 0, miễn phí) điền sẵn → công nhân xác nhận;
// đọc trượt thì gõ tay — ẢNH luôn được lưu làm bằng chứng truy vết.
// Giờ bấm nút chỉ là giờ THAO TÁC (đối chiếu chéo, không phải giờ SX).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AxiosError } from 'axios'
import { NotebookPen, ScanLine, Camera, Check, X, Pencil, Clock, AlertTriangle, Download, Plus, StopCircle, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormSheet } from '@/components/shared/FormSheet'
import { QRScanner, type QRScannerHandle } from '@/components/shared/QRScanner'
import { SearchInput } from '@/components/shared/SearchInput'
import { FilterBar, FilterSheetButton, type FilterDef } from '@/components/shared/FilterBar'
import { SummaryBand } from '@/components/shared/SummaryBand'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { ActionCluster, type ActionItem } from '@/components/shared/ActionBtn'
import { parseCodeFields } from '@/components/shared/palletLabel'
import {
  usePackingLogs, useOpenPackingLog, useClosePackingLog,
  useUpdatePackingLog, useCancelPackingLog, type PackingLog,
  usePackingRunBoard, usePackingRun, usePackingRuns, useOpenPackingRun, useClosePackingRun,
  useUpdatePackingRun, useCancelPackingRun, type PackingRun,
  useImportShifts, useMaterials, useMaterialsByCodes, useMachines, useSettingNumber,
} from '@/api/hooks'
import { readCartonPrint, warmOcr } from '@/utils/cartonOcr'
import { apiClient } from '@/api/client'
import { SingleSelect } from '@/components/shared/SingleSelect'
import { useScopedWarehouses, useScopedWhTypes } from '@/hooks/useUserScope'
import { useWedgeScanner } from '@/hooks/useWedgeScanner'
import { normalizeQR } from '@/utils/qr'
import { unlockAudio, playBeep } from '@/utils/audio'
import { formatDate, formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { useWmsFilterStore } from '@/stores/wmsFilterStore'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
// ── Filter "Tháng sản xuất" (user 13/08 — dặn "chọn cẩn thận") ───────────────────
// KHÔNG thêm state riêng: tháng chỉ là CÁCH NHẬP NHANH của chính bộ lọc khoảng ngày
// (chọn tháng = set dateFrom/dateTo trọn tháng; giá trị chip SUY NGƯỢC từ khoảng ngày)
// → không bao giờ mâu thuẫn kiểu "chip tháng 7 nhưng khoảng ngày tháng 8".
// Tháng tính theo NGÀY VN (todayVN), ngày cuối tháng = toán lịch thuần, không qua toISOString (bẫy lệch -1).
const monthOpts = (n = 13): { value: string; label: string }[] => {
  const [y, m] = todayVN().split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) - i
    const yy = Math.floor(t / 12), mo = (t % 12) + 1
    const mm = String(mo).padStart(2, '0')
    return { value: `${yy}-${mm}`, label: `Tháng ${mm}/${yy}` }
  })
}
const monthRange = (ym: string): { from: string; to: string } => {
  const [y, m] = ym.split('-').map(Number)
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }
}
const monthOf = (from: string, to: string): string =>
  from && to && from.endsWith('-01') && monthRange(from.slice(0, 7)).to === to ? from.slice(0, 7) : ''
const dmyToIso = (dmy: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((dmy ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
const apiMsg = (e: unknown, fb: string) =>
  (e as AxiosError<{ error?: { message?: string } }>)?.response?.data?.error?.message ?? fb

// Ô giờ GÕ THẲNG dạng HH:MM (user chốt 11/08 chiều: "gõ tay vào ko đc vì phải chọn ::,
// mặc định format HH:MM để khi gõ thì gõ vào thôi") — gõ số là tự chèn dấu ":"
const maskHHMM = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`
}
const hhmmToIso = (date: string, t: string): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const hh = Math.min(23, +m[1]), mm = Math.min(59, +m[2])
  const d = new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
const nowHHMM = () => new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).slice(0, 5)
const isoToHHMM = (iso: string | null) => iso ? formatTimestampTime(iso).slice(0, 5) : ''

// Nén ảnh client-side — CÙNG chuẩn ảnh xe nâng (user chốt 11/08): 1024px, mục tiêu 180KB
// ⚠️ OCR chạy trên ẢNH GỐC (dataUrl full-res), KHÔNG chạy trên bản nén này — nén 1024px/JPEG
// nghiền nát chữ in phun nhỏ (bug 11/08 chiều: tấm rất rõ mà không đọc được giờ).
const PHOTO_TARGET_BYTES = 180 * 1024
const bytesOf = (dataUrl: string) => Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4)
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Không đọc được ảnh'))
    r.readAsDataURL(file)
  })
}
async function compressPhoto(url: string): Promise<string> {
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
  const canvas = draw(1024)
  let out = canvas.toDataURL('image/jpeg', 0.7)
  for (const q of [0.55, 0.45]) {
    if (bytesOf(out) <= PHOTO_TARGET_BYTES) break
    out = canvas.toDataURL('image/jpeg', q)
  }
  if (bytesOf(out) > PHOTO_TARGET_BYTES) out = draw(800).toDataURL('image/jpeg', 0.5)
  return out
}

// ─── AI VISION (user chốt 12/08): "AI Vision trước, API hết hạn/lỗi thì chuyển OCR" ──
// Gửi ảnh 1600px lên BE (POST /wms/packing/vision-ocr → Gemini, key cấu hình ở trang Kết nối ERP).
// MỌI lỗi (chưa cấu hình / key hỏng / hết quota / mạng) → trả null để rơi về Tesseract local.
let _visionOff = false   // 422 VISION_NOT_CONFIGURED → khỏi gọi lại cho tới lần tải app sau
async function compressForVision(url: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Ảnh hỏng'))
    i.src = url
  })
  // 1600px JPEG 0.75 — giữ NÉT (độ phân giải quyết định đọc đúng), hạ quality để upload
  // nhẹ hơn ~35% trên wifi xưởng (user 12/08 "muốn tốc độ đọc ảnh nhanh hơn nữa")
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.75)
}
async function visionRead(origUrl: string): Promise<{ time: string; nsxDate: string | null; raw: string | null } | null> {
  if (_visionOff) return null
  try {
    const photo = await compressForVision(origUrl)
    const { data } = await apiClient.post('/wms/packing/vision-ocr', { photo_data: photo })
    const d = data?.data as { time?: string | null; nsx_date?: string | null; raw?: string | null } | undefined
    return d?.time ? { time: d.time, nsxDate: d.nsx_date ?? null, raw: d.raw ?? null } : null
  } catch (e) {
    const code = (e as AxiosError<{ error?: { code?: string } }>)?.response?.data?.error?.code
    if (code === 'VISION_NOT_CONFIGURED') _visionOff = true
    return null   // rơi về OCR local — không chặn người dùng
  }
}

// SECTION-CARD "Thùng ĐẦU / Thùng CUỐI" — khung DÙNG CHUNG cho sheet Ghi sổ + Đóng + Sửa
// (user 12/08 tối: "bố cục lại cho đẹp... Form thêm mới và edit giống nhau"): header có
// thanh accent sky như section-band chuẩn app; thân = Ô ẢNH trái + Ngày/Giờ phải.
function ProdSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-1.5 bg-slate-100 border-b border-slate-200 px-2.5 py-1.5">
        <span className="h-3.5 w-1 rounded-full bg-sky-500 shrink-0" />
        <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">{title}</p>
        {hint && <p className="text-[10px] text-slate-400 ml-auto normal-case">{hint}</p>}
      </div>
      <div className="p-2.5 flex items-start gap-3">{children}</div>
    </section>
  )
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
// Nguồn kết quả giờ SX (user chốt 12/08 "bên cạnh kết quả là nguồn kết quả: AI đọc, OCR đọc hoặc người đọc")
const SRC_BADGE = (src: string | null) =>
  src === 'AI' ? <span className="text-[8px] px-1 rounded bg-violet-100 text-violet-700" title="AI Vision (Gemini) đọc từ ảnh chữ in phun">AI</span>
  : src === 'OCR' ? <span className="text-[8px] px-1 rounded bg-sky-100 text-sky-700" title="OCR (Tesseract tại máy) đọc từ ảnh chữ in phun">OCR</span>
  : src === 'MANUAL' ? <span className="text-[8px] px-1 rounded bg-amber-100 text-amber-800" title="Người nhập tay (có ảnh đối chứng nếu đã chụp)">người</span>
  : null

// ─── Ô "chụp thùng + đọc giờ in phun" (dùng chung cho MỞ và ĐÓNG) ─────────────
// Giá trị đẩy lên parent: photoData (đã nén) · iso (giờ SX từ date+time VN) · src (OCR nếu
// giữ nguyên kết quả đọc, MANUAL nếu người dùng sửa/gõ) · raw (nguyên văn OCR — lưu DB).
export interface ProdTimeValue { photoData: string | null; iso: string | null; src: 'AI' | 'OCR' | 'MANUAL' | null; raw: string | null; busy: boolean }
function PhotoOcrField({ title, hint, defaultDate, onValue }: {
  title: string
  hint?: string
  defaultDate: string
  onValue: (v: ProdTimeValue) => void
}) {
  const [photoData, setPhotoData] = useState<string | null>(null)
  const [busy, setBusy] = useState<'photo' | 'ocr' | null>(null)
  const [ocrTime, setOcrTime] = useState<string | null>(null)   // giá trị OCR gốc — so để biết user có sửa không
  const [ocrRaw, setOcrRaw] = useState<string | null>(null)
  const [ocrFail, setOcrFail] = useState(false)
  const [engine, setEngine] = useState<'AI' | 'OCR' | null>(null)   // nguồn đọc tự động (hiển thị badge)
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
    // Nguồn = engine đã đọc (AI/OCR) nếu người dùng GIỮ NGUYÊN kết quả; sửa/gõ tay = MANUAL
    const src: 'AI' | 'OCR' | 'MANUAL' | null = !iso ? null : (ocrTime && time === ocrTime ? (engine ?? 'OCR') : 'MANUAL')
    onValue({ photoData, iso, src, raw: ocrRaw, busy: busy !== null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoData, time, date, ocrTime, ocrRaw, busy, engine])

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy('photo'); setOcrFail(false)
    try {
      const origUrl = await fileToDataUrl(file)          // ảnh GỐC full-res cho OCR
      setBusy('ocr')
      // TỐC ĐỘ (user 12/08): nén ảnh bằng chứng + gọi AI Vision SONG SONG (trước đây nối tiếp)
      const visionP = visionRead(origUrl)                // AI Vision TRƯỚC — lỗi/hết quota → OCR local
      const data = await compressPhoto(origUrl)          // bản nén 1024px để lưu bằng chứng
      setPhotoData(data)
      let t: string | null = null, nsx: string | null = null, raw: string | null = null, eng: 'AI' | 'OCR' | null = null
      const v = await visionP
      if (v) { eng = 'AI'; t = v.time; nsx = v.nsxDate; raw = v.raw }
      else {
        const info = await readCartonPrint(origUrl)
        raw = info.raw || null
        if (info.ok && info.time) { eng = 'OCR'; t = info.time; nsx = info.nsxDate ?? null }
      }
      setOcrRaw(raw); setEngine(eng)
      if (t) {
        const t5 = t.slice(0, 5)                         // sổ chỉ ghi Giờ:Phút (user chốt)
        setOcrTime(t5); setTime(t5)
        if (nsx) setDate(nsx)
      } else {
        setOcrTime(null); setOcrFail(true)
      }
    } catch { setOcrFail(true) } finally { setBusy(null) }
  }

  return (
    <ProdSection title={title} hint={hint}>
      {/* Ô ẢNH bên trái: chưa chụp = nút chụp nổi bật; đã chụp = thumbnail, bấm để CHỤP LẠI */}
      <label className={`relative shrink-0 w-24 h-20 rounded-lg border border-dashed flex items-center justify-center cursor-pointer overflow-hidden transition-colors ${photoData ? 'border-slate-300' : 'border-sky-400 bg-sky-50 text-sky-700 hover:bg-sky-100'}`}>
        {photoData && <img src={photoData} alt="Ảnh date thùng" className="absolute inset-0 h-full w-full object-cover" />}
        <span className={`relative z-10 flex flex-col items-center gap-0.5 ${photoData ? 'text-white bg-black/40 rounded px-1.5 py-0.5' : ''}`}>
          <Camera className="h-4 w-4" />
          <span className="text-[9px] font-medium leading-tight text-center">
            {busy === 'photo' ? 'Đang xử lý…' : busy === 'ocr' ? 'Đang đọc…' : photoData ? 'Chụp lại' : 'Chụp chữ date'}
          </span>
        </span>
        <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!!busy}
          onChange={e => { void handleFile(e.target.files?.[0]); e.target.value = '' }} />
      </label>
      {/* Ngày + Giờ bên phải */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 w-36 text-sm" />
          <Input value={time} onChange={e => setTime(maskHHMM(e.target.value))} placeholder="HH:MM"
            inputMode="numeric" className={`h-9 w-24 text-sm tabular-nums text-center ${ocrTime && time === ocrTime ? 'border-sky-400 bg-sky-50 font-semibold' : ''}`} />
          {photoData && (
            <button type="button" title="Xem ảnh lớn" onClick={() => setFull(true)}
              className="p-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"><ZoomIn className="h-3.5 w-3.5" /></button>
          )}
        </div>
        {/* Nguồn kết quả LUÔN hiện dưới ô giờ (user chốt 12/08): AI đọc / OCR đọc / người nhập */}
        {time.trim() !== '' && (ocrTime && time === ocrTime ? (
          engine === 'AI'
            ? <span className="text-[10px] text-violet-700 font-medium inline-flex items-center gap-0.5"><Check className="h-3 w-3" /> AI đọc</span>
            : <span className="text-[10px] text-sky-700 font-medium inline-flex items-center gap-0.5"><Check className="h-3 w-3" /> OCR đọc</span>
        ) : (
          <span className="text-[10px] text-amber-700 font-medium inline-flex items-center gap-0.5"><Pencil className="h-3 w-3" /> người nhập</span>
        ))}
        {busy === 'ocr' && <p className="text-[10px] text-slate-400">Đang đọc chữ in phun (AI / OCR)…</p>}
        {ocrFail && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" /> Không đọc được chữ — nhìn thùng gõ giờ vào (ảnh vẫn được lưu làm bằng chứng)
          </p>
        )}
      </div>
      {full && photoData && <PhotoLightbox url={photoData} onClose={() => setFull(false)} />}
    </ProdSection>
  )
}

// ─── Trang chính ──────────────────────────────────────────────────────────────
export default function Packing() {
  const user = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canRecord  = can(perms, 'packing', 'record')
  const canOpenRun = can(perms, 'packing', 'open_run')
  const canEdit    = can(perms, 'packing', 'edit')
  const canCancel  = can(perms, 'packing', 'cancel')
  const canExport  = can(perms, 'packing', 'export')

  const f = useWmsFilterStore(s => s.packing)
  const setF = useWmsFilterStore(s => s.setPacking)

  // Tải trước OCR (worker + dữ liệu nhận dạng) ngay khi mở trang — lần chụp đầu không phải chờ
  useEffect(() => { warmOcr() }, [])

  const board = usePackingRunBoard(f.warehouseId)
  const openRuns = board.data ?? []
  const openPallets = openRuns.reduce((s, r) => s + (r.pallet_open ?? 0), 0)
  const { data: whs } = useScopedWarehouses(true)
  const whName = useMemo(() => new Map((whs ?? []).map(w => [(w as { id: string }).id, (w as { id: string; name?: string }).name ?? ''])), [whs])
  const whOpts = useMemo(() => (whs ?? []).map(w => ({ value: (w as { id: string }).id, label: (w as { id: string; name?: string }).name ?? '' })), [whs])

  // Quét mở pallet — overlay keep-mounted (chuẩn qr-scan-flow), camera tắt hẳn khi đóng
  const [hasOpenedScan, setHasOpenedScan] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const scannerRef = useRef<QRScannerHandle>(null)
  const [pendingQR, setPendingQR] = useState<string | null>(null)   // tem vừa quét → mở RecordSheet
  const [closeTarget, setCloseTarget] = useState<PackingLog | null>(null)
  const [editTarget, setEditTarget] = useState<PackingLog | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PackingLog | null>(null)
  const [openRunForm, setOpenRunForm] = useState(false)
  const [closeRunTarget, setCloseRunTarget] = useState<PackingRun | null>(null)
  const [editRunTarget, setEditRunTarget] = useState<PackingRun | null>(null)
  const [cancelRunTarget, setCancelRunTarget] = useState<PackingRun | null>(null)
  const [detailRunId, setDetailRunId] = useState<string | null>(null)
  const [banner, setBanner] = useState('')

  function handleScan(raw: string) {
    playBeep()
    setShowScan(false)
    setPendingQR(normalizeQR(raw))
  }

  // Deep-link từ trung tâm cảnh báo (rule PACKING_UNRECEIVED): ?tab=log&received=NO → mở Sổ pallet
  // đã lọc sẵn "SX tạo — kho chưa nhận" rồi xóa param khỏi URL (mẫu Inventory/EXPIRY 06/08).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const tab = sp.get('tab'); const received = sp.get('received')
    if (!tab && !received) return
    setF({
      ...(tab === 'log' || tab === 'board' ? { tab: tab as 'log' | 'board' } : {}),
      ...(received === 'NO' || received === 'YES' || received === 'DIFF' ? { received, page: 1 } : {}),
    })
    window.history.replaceState(null, '', window.location.pathname)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Súng PDA (keyboard-wedge, 12/08 — user so với Nhập kho: mọi màn quét khác đã nhận súng,
  // riêng Sổ đóng gói chỉ có camera): bắn tem ở BẤT KỲ đâu trong trang (kể cả chưa mở camera)
  // → vào thẳng RecordSheet như quét camera. Đang mở form khai/sửa thì nuốt (tránh đè dở dang);
  // đang xem detail trang sổ thì đóng detail rồi vào form ghi (giống nút "Quét tem — thêm pallet").
  const formSheetOpen = !!(pendingQR || closeTarget || editTarget || cancelTarget
    || openRunForm || closeRunTarget || editRunTarget || cancelRunTarget)
  useWedgeScanner(code => {
    if (formSheetOpen) return
    if (detailRunId) setDetailRunId(null)
    handleScan(code)
  }, canRecord)

  const runHandlers: RunTableHandlers = {
    canRecord, canOpenRun, canEdit, canCancel, whName,
    onScan: () => { unlockAudio(); setHasOpenedScan(true); setShowScan(true) },
    onDetail: r => setDetailRunId(r.id),
    onCloseRun: setCloseRunTarget, onEditRun: setEditRunTarget, onCancelRun: setCancelRunTarget,
    onClosePallet: setCloseTarget, onEditPallet: setEditTarget, onCancelPallet: setCancelTarget,
  }

  const tabBar = (
    <div className="flex items-center gap-1 border-b bg-white px-3 pt-2 shrink-0 sm:rounded-t-xl overflow-x-auto">
      <NotebookPen className="h-4 w-4 text-sky-600 shrink-0 mb-1.5 mr-0.5" />
      {/* 12/08 user chốt: tab "Trang sổ" GIỐNG HỆT "Đóng gói" → gộp làm 1 (filter trạng thái/ngày + export nằm luôn ở Đóng gói) */}
      {([['board', `Đóng gói${openRuns.length ? ` (${openRuns.length} đang mở)` : ''}`], ['log', 'Sổ pallet']] as const).map(([k, label]) => (
        <button key={k} type="button" onClick={() => setF({ tab: k })}
          className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border-b-2 transition-colors whitespace-nowrap ${
            (f.tab === k || (k === 'board' && f.tab !== 'log')) ? 'border-sky-500 text-sky-700' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}>
          {label}
        </button>
      ))}
      <div className="flex-1" />
      {/* 13/08 user bỏ nút "Quét tem — ghi sổ" cấp trang: quét là việc CỦA TỪNG TRANG SỔ —
          nút quét nằm ở row (cột Thao tác) + trong detail trang; súng PDA vẫn bắn ở bất kỳ đâu */}
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
        {f.tab !== 'log' ? (
          <RunsTab canExport={canExport} openCount={openRuns.length}
            canOpenRun={canOpenRun} onOpenRun={() => setOpenRunForm(true)}
            whName={whName} whOpts={whOpts} h={runHandlers} />
        ) : (
          <LogTab canEdit={canEdit} canCancel={canCancel} canExport={canExport} openCount={openPallets}
            whName={whName} whOpts={whOpts}
            onEdit={setEditTarget} onCancel={setCancelTarget} onCloseRow={setCloseTarget} />
        )}
      </div>

      {/* Camera keep-mounted (CSS hidden) — active tắt stream khi đóng */}
      {hasOpenedScan && (
        <div className={`fixed inset-0 z-50 bg-black/90 flex flex-col ${showScan ? '' : 'hidden'}`}>
          <div className="flex items-center justify-between px-4 py-2 text-white shrink-0">
            <p className="text-sm font-semibold">Quét tem pallet</p>
            <button type="button" onClick={() => setShowScan(false)} className="p-2"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 min-h-0">
            <QRScanner ref={scannerRef} fill active={showScan} stopOnScan onScan={handleScan} onClose={() => setShowScan(false)} />
          </div>
        </div>
      )}

      {pendingQR && (
        <RecordSheet code={pendingQR} whName={whName}
          onDone={() => setPendingQR(null)}
          onRescan={() => {
            // stopOnScan đã TẮT HẲN track lúc bắt được tem → bật lại phiên quét mới (resume()
            // bump epoch, không hỏi quyền camera lại). Delay 50ms cho overlay hiện trước (chuẩn qr-scan-flow).
            setPendingQR(null)
            setBanner('')
            setHasOpenedScan(true)
            setShowScan(true)
            setTimeout(() => scannerRef.current?.resume(), 50)
          }}
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
      {openRunForm && (
        <OpenRunSheet whOpts={whOpts} onDone={() => setOpenRunForm(false)} onError={setBanner} />
      )}
      {closeRunTarget && (
        <CloseRunSheet run={closeRunTarget} onDone={() => setCloseRunTarget(null)} onError={setBanner} />
      )}
      {editRunTarget && (
        <RunEditSheet run={editRunTarget} onDone={() => setEditRunTarget(null)} onError={setBanner} />
      )}
      {cancelRunTarget && (
        <RunCancelConfirm run={cancelRunTarget} onDone={() => setCancelRunTarget(null)} onError={setBanner} />
      )}
      {detailRunId && (
        <RunDetailSheet id={detailRunId} h={runHandlers} onDone={() => setDetailRunId(null)} />
      )}
    </div>
  )
}

// ─── BẢNG GỘP THEO TRANG SỔ (table-format mục 10 — nhóm dòng đóng khung) ─────
// Dòng đầu cụm = TRANG SỔ (bấm vào mở DETAIL), các dòng dưới = pallet của trang.
// Dùng chung cho tab Đóng gói (trang MỞ) + tab Trang sổ (mọi trạng thái).
// 12/08 user chốt: cột THAO TÁC đưa LÊN ĐẦU row cho dễ bấm (kéo ngang mới thấy nút = khó thao tác)
// mã của 1 trang sổ (13/08: 1 trang ghi được NHIỀU mã — material_codes; dòng cũ chỉ có material_code)
const runCodes = (r: PackingRun): string[] => (r.material_codes?.length ? r.material_codes : [r.material_code])
// Tra TÊN hàng cho các mã đang hiện trên màn (user 13/08 "table cần thể hiện tên hàng") —
// tra đúng mã trên trang qua useMaterialsByCodes (chuẩn catalogue, KHÔNG nạp cả danh mục)
function useMatNames(codes: string[]): Map<string, string> {
  const { data } = useMaterialsByCodes(codes)
  return useMemo(() => new Map((data ?? []).map(m => [m.material_code, m.short_name ?? m.material_description ?? ''])), [data])
}

const RUN_G_COLS = [
  { id: 'act',     label: 'Thao tác',     w: 116 },
  { id: 'main',    label: 'Mã · Tên hàng', w: 190 },
  { id: 'status',  label: 'Trạng thái',   w: 88 },
  { id: 'date',    label: 'Ngày SX',      w: 82 },
  { id: 'wh',      label: 'Kho',          w: 115 },
  { id: 'shift',   label: 'Ca',           w: 68 },
  { id: 'cycle',   label: 'Chu kỳ',       w: 60 },
  { id: 'machine', label: 'Máy',          w: 52 },
  { id: 'pallet',  label: 'Pallet',       w: 60 },
  { id: 'qty',     label: 'Tổng SL (thùng)', w: 100 },
  { id: 'time',    label: 'Giờ BĐ → KT',  w: 165 },
  { id: 'by',      label: 'Người mở',     w: 105 },
  // 13/08 user bỏ cột Ảnh ở bảng TRANG SỔ ngoài cùng — ảnh là dữ liệu cấp PALLET, xem trong detail/Sổ pallet
  { id: 'note',    label: 'Ghi chú',      w: 120 },
]
const RUN_G_DEFAULTS = RUN_G_COLS.map(c => c.w)
const RUN_STATUS_LABEL: Record<string, string> = { OPEN: 'Đang mở', CLOSED: 'Đã đóng', CANCELLED: 'Đã hủy' }
const elapsedOf = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  return mins < 60 ? `${mins}p` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`
}

interface RunTableHandlers {
  canRecord: boolean; canOpenRun: boolean; canEdit: boolean; canCancel: boolean
  whName: Map<string, string>
  onScan: () => void
  onDetail: (r: PackingRun) => void
  onCloseRun: (r: PackingRun) => void; onEditRun: (r: PackingRun) => void; onCancelRun: (r: PackingRun) => void
  onClosePallet: (l: PackingLog) => void; onEditPallet: (l: PackingLog) => void; onCancelPallet: (l: PackingLog) => void
}

function RunGroupedTable({ runs, loading, emptyText, h }: {
  runs: PackingRun[]; loading: boolean; emptyText: string; h: RunTableHandlers
}) {
  const { widths: colW, startResize, totalWidth } = useColumnResize('packing_group_col_widths_v4', RUN_G_DEFAULTS)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t) }, [])
  const matName = useMatNames(runs.flatMap(runCodes))
  const N = RUN_G_COLS.length

  return (
    <div className="flex-1 min-h-0 overflow-auto pb-20 lg:pb-4">
      <Table className="table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden"
        style={{ width: totalWidth, minWidth: '100%' }}>
        <colgroup>{colW.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <TableHeader>
          <TableRow>
            {RUN_G_COLS.map((c, i) => (
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
          {loading ? (
            <TableRow><TableCell colSpan={N} className="text-center py-8 text-xs text-slate-400">Đang tải…</TableCell></TableRow>
          ) : runs.length === 0 ? (
            <TableRow><TableCell colSpan={N} className="text-center py-8 text-xs text-slate-400">{emptyText}</TableCell></TableRow>
          ) : runs.map(r => {
            // list/board không còn trả pallet rows (payload 2,2MB dữ liệu lớn) — đếm bằng pallet_count server
            const palletN = Number(r.pallet_count ?? r.pallets?.length ?? 0)
            const cancelled = r.status === 'CANCELLED'
            // chu kỳ có thể chạy LIỀN VÀI NGÀY (user chốt) — giờ kết thúc khác ngày thì kèm ngày
            const endOtherDay = r.end_at && formatTimestampDate(r.end_at, true) !== formatTimestampDate(r.start_at, true)
            return (
              <TableRow key={r.id} onClick={() => h.onDetail(r)}
                className={`cursor-pointer hover:bg-sky-50 ${cancelled ? 'text-slate-400 line-through' : ''}`}>
                  {/* Thao tác Ở ĐẦU row + sticky (user chốt 12/08 — khỏi kéo ngang mới thấy nút) */}
                  <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-white">
                    <span className="inline-flex gap-1">
                      {r.status === 'OPEN' && h.canRecord && (
                        <button type="button" title="Quét tem vào trang này" onClick={e => { e.stopPropagation(); h.onScan() }}
                          className="px-1.5 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50"><ScanLine className="h-3.5 w-3.5" /></button>
                      )}
                      {r.status === 'OPEN' && h.canOpenRun && (
                        <button type="button" title="Giờ kết thúc — đóng trang + tính tổng sản lượng" onClick={e => { e.stopPropagation(); h.onCloseRun(r) }}
                          className="px-1.5 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50"><StopCircle className="h-3.5 w-3.5" /></button>
                      )}
                      {!cancelled && h.canOpenRun && (
                        <button type="button" title="Sửa trang sổ" onClick={e => { e.stopPropagation(); h.onEditRun(r) }}
                          className="px-1.5 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /></button>
                      )}
                      {!cancelled && h.canOpenRun && palletN === 0 && (
                        <button type="button" title="Hủy trang (mở nhầm)" onClick={e => { e.stopPropagation(); h.onCancelRun(r) }}
                          className="px-1.5 py-1 rounded border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200"><X className="h-3.5 w-3.5" /></button>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <div className="leading-tight">
                      {runCodes(r).map(c => (
                        <div key={c} className="truncate" title={`${c} — ${matName.get(c) ?? ''}`}>
                          <span className="font-mono text-[11px] font-semibold no-underline">{c}</span>
                          {matName.get(c) && <span className="ml-1 text-[9px] text-slate-400 no-underline">{matName.get(c)}</span>}
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1 whitespace-nowrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full no-underline ${STATUS_BADGE[r.status]}`}>{RUN_STATUS_LABEL[r.status]}</span>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">{formatDate(r.run_date)}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={h.whName.get(r.warehouse_id) ?? ''}>{h.whName.get(r.warehouse_id) ?? r.warehouse_id}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate">{r.shift ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">{r.cycle ?? <span className="text-slate-300">—</span>}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-semibold">{r.machine_code}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                    {palletN.toLocaleString('vi-VN')}
                    {(r.pallet_open ?? 0) > 0 && <span className="text-amber-600"> ({r.pallet_open} mở)</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums font-semibold">{Number(r.qty_total ?? 0).toLocaleString('vi-VN')}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums font-semibold">
                    {isoToHHMM(r.start_at)}<span className="text-slate-400 font-normal"> → </span>
                    {r.end_at ? (
                      <>{endOtherDay && <span className="text-slate-400 font-normal">{formatTimestampDate(r.end_at, true)} </span>}{isoToHHMM(r.end_at)}</>
                    ) : (r.status === 'OPEN' ? <span className="text-amber-600 font-normal" title={`Chưa bấm Giờ kết thúc — trang đã mở ${elapsedOf(r.start_at)}`}>mở {elapsedOf(r.start_at)}</span> : '…')}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.opened_by_name ?? ''}>{r.opened_by_name ?? '—'}</TableCell>
                  <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.note ?? ''}>{r.note ?? <span className="text-slate-300">—</span>}</TableCell>
                </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Sheet GHI SỔ 1 PHIÊN — quét tem → chụp thùng đầu → chụp thùng cuối → Lưu ─
// (user chốt 11/08 sau test thật: chữ in phun ở mặt BÊN thùng, pallet xếp xong vẫn
// chụp được cả thùng đáy → ghi trọn trong 1 lần đứng tại pallet)
// 11/08 chiều: pallet phải thuộc 1 TRANG SỔ đang mở khớp MÃ — Máy/Kho kế thừa từ trang
// (tem in "AP" hết mơ hồ). Nhiều trang cùng mã (khác máy/kho) → chọn trang trước khi Lưu.
// Chu kỳ so trên dạng chuẩn (tem in số thuần ⇒ "05" ≡ "5") — CHỈ để TÔ MÀU đối chiếu.
// Điểm chặn thật là BE (`RUN_CYCLE_MISMATCH`/`RUN_MACHINE_MISMATCH`) — FE không phán quyết.
const normCycleUI = (s: string) => {
  const t = String(s ?? '').trim().toUpperCase()
  return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t
}

function RecordSheet({ code, whName, onDone, onRescan, onError }: {
  code: string; whName: Map<string, string>
  onDone: () => void; onRescan: () => void; onError: (m: string) => void
}) {
  const openMut = useOpenPackingLog()
  const fields = useMemo(() => parseCodeFields(code), [code])
  const defaultDate = dmyToIso(fields.dateDisplay) ?? todayVN()
  const allRuns = usePackingRunBoard('')   // mọi trang đang MỞ trong scope (không dính filter kho của board)
  // khớp theo MẢNG mã (13/08 — trang nhiều mã): tem mã PHỤ cũng phải thấy trang, như gate BE
  const candidates = useMemo(
    () => (allRuns.data ?? []).filter(r => runCodes(r).includes(fields.materialCode || '')),
    [allRuns.data, fields.materialCode])
  const [runId, setRunId] = useState('')
  const run = candidates.find(r => r.id === runId) ?? (candidates.length === 1 ? candidates[0] : null)
  const [qty, setQty] = useState('')       // '' = theo số chuẩn của tem
  // SỐ THÙNG TỰ ĐIỀN THEO QUY CÁCH (user 13/08 "sao không thấy số thùng tự nhảy theo quy cách"):
  // override thùng/pallet theo KHO của trang sổ → fallback quy cách chung của mã
  const { data: matRows } = useMaterialsByCodes(fields.materialCode ? [fields.materialCode] : [])
  const specQty = useMemo(() => {
    const mat = (matRows ?? [])[0]
    if (!mat) return null
    const ov = (mat.warehouse_pallet_overrides ?? []).find(o => o.warehouse_id === run?.warehouse_id)
    const n = Number(ov?.cartons_per_pallet ?? mat.cartons_per_pallet ?? 0)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [matRows, run?.warehouse_id])
  const qtyTouched = useRef(false)
  useEffect(() => {
    if (!qtyTouched.current && specQty != null) setQty(String(specQty))
  }, [specQty])
  const [prodS, setProdS] = useState<ProdTimeValue>({ photoData: null, iso: null, src: null, raw: null, busy: false })
  const [prodE, setProdE] = useState<ProdTimeValue>({ photoData: null, iso: null, src: null, raw: null, busy: false })
  const busy = prodS.busy || prodE.busy
  const noRun = !allRuns.isLoading && candidates.length === 0
  // ĐỐI CHIẾU TEM ↔ TRANG SỔ (15/08) — thấy lệch NGAY, khỏi điền ảnh/giờ xong mới bị BE chặn.
  // Tem V2 (';') không mang chu kỳ ⇒ không đối chiếu chu kỳ.
  const temCycle = fields.format === 'v1' ? String(fields.cycle ?? '').trim() : ''
  const temMachine = String(fields.machine ?? '').trim().toUpperCase()
  const cycleBad = !!(temCycle && run?.cycle && normCycleUI(temCycle) !== normCycleUI(run.cycle))
  const machineBad = !!(temMachine && run && temMachine !== String(run.machine_code).trim().toUpperCase())

  function save(complete: boolean) {
    if (!run) { onError(candidates.length > 1 ? 'Chọn trang sổ trước khi lưu' : 'Chưa có trang sổ đang mở cho mã này'); return }
    const q = qty.trim() === '' ? undefined : Number(qty.replace(',', '.'))
    if (q !== undefined && (!Number.isFinite(q) || q <= 0)) { onError('Số thùng phải là số dương'); return }
    // Giờ thùng cuối không được TRƯỚC thùng đầu — sản xuất qua nửa đêm thì đổi NGÀY ở ô ngày (user chốt 12/08)
    if (prodS.iso && prodE.iso && prodE.iso < prodS.iso) {
      onError('Giờ SX thùng CUỐI đang trước thùng ĐẦU — sản xuất qua ngày mới thì chỉnh lại Ngày ở ô thùng cuối'); return
    }
    openMut.mutate({
      qr_code: code,
      run_id: run.id,
      qty_cartons: q,
      photo_data: prodS.photoData,
      prod_start_at: prodS.iso,
      prod_start_src: prodS.iso ? prodS.src : null,
      ocr_raw: prodS.raw,
      photo_end_data: prodE.photoData,
      prod_end_at: prodE.iso,
      prod_end_src: prodE.iso ? prodE.src : null,
      ocr_end_raw: prodE.raw,
      complete,
    }, {
      onSuccess: () => onDone(),
      onError: (e) => onError(apiMsg(e, 'Không ghi được sổ — thử lại')),
    })
  }

  const runLabel = (r: PackingRun) =>
    `Máy ${r.machine_code} · ${whName.get(r.warehouse_id) ?? r.warehouse_id}${r.shift ? ` · ${r.shift}` : ''}`

  return (
    <FormSheet open onClose={onDone} title="Ghi sổ đóng gói — pallet vừa quét"
      footer={
        // flex-wrap: 4 nút không tràn ngang trên màn 360px (PDA/điện thoại xưởng)
        <div className="flex gap-2 w-full flex-wrap">
          <Button variant="outline" className="shrink-0" onClick={onDone}>Hủy</Button>
          {/* Quét sai tem → quét lại ngay, không phải đóng form rồi tìm nút quét (camera đang TẮT) */}
          <Button variant="outline" className="shrink-0 gap-1" onClick={onRescan} title="Bỏ tem này, bật camera quét tem khác">
            <ScanLine className="h-3.5 w-3.5" /> Quét lại
          </Button>
          <Button variant="outline" className="flex-1 min-w-[7.5rem]" disabled={openMut.isPending || busy || !run}
            title="Pallet chưa xếp xong — lưu trước, đóng sổ sau từ board"
            onClick={() => save(false)}>
            Lưu — đóng sau
          </Button>
          <Button className="flex-1 min-w-[7.5rem] bg-blue-600 hover:bg-blue-700" disabled={openMut.isPending || busy || !run} onClick={() => save(true)}>
            {openMut.isPending ? 'Đang lưu…' : busy ? 'Đang đọc ảnh…' : 'Lưu & Đóng sổ'}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs space-y-0.5">
          <p className="font-mono font-semibold text-slate-800 break-all">{code}</p>
          <p className="text-slate-500">
            Mã hàng <b className="text-slate-700">{fields.materialCode || '?'}</b>
            {fields.seq && <> · Pallet <b className="text-slate-700">{fields.seq}</b></>}
            {fields.dateDisplay && <> · NSX tem {fields.dateDisplay}</>}
          </p>
        </div>
        {noRun ? (
          <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 flex items-start gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Chưa mở TRANG SỔ cho mã <b>{fields.materialCode || '?'}</b> — người có quyền phải "Mở trang sổ" (khai Kho · Ca · Máy) ở tab Đóng gói trước khi quét tem.</span>
          </p>
        ) : candidates.length > 1 ? (
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Trang sổ (mã này đang mở {candidates.length} trang)</p>
            <SingleSelect options={candidates.map(r => ({ value: r.id, label: runLabel(r) }))}
              value={runId} onChange={setRunId} placeholder="Chọn trang sổ…" triggerClassName="w-full h-9" />
          </div>
        ) : run ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded px-2 py-1.5">
              Ghi vào trang sổ: <b>{runLabel(run)}</b>{run.cycle ? ` · CK ${run.cycle}` : ''} · mở lúc {isoToHHMM(run.start_at)}
            </p>
            {(cycleBad || machineBad) && (
              <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 space-y-1">
                <p className="flex items-start gap-1 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Tem KHÔNG khớp trang sổ — kiểm lại trước khi lưu</span>
                </p>
                {cycleBad && <p>Chu kỳ: tem <b>{temCycle}</b> ≠ trang sổ <b>{run.cycle}</b></p>}
                {machineBad && <p>Máy: tem <b>{temMachine}</b> ≠ trang sổ <b>{run.machine_code}</b></p>}
                <p className="text-red-600">Quét nhầm trang thì bấm <b>Quét lại</b>; tem in sai thì sửa trang sổ cho khớp.</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">Đang tra trang sổ…</p>
        )}
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Số thùng</p>
          <Input value={qty} onChange={e => { qtyTouched.current = true; setQty(e.target.value) }}
            inputMode="decimal" className="h-9 w-32 text-sm tabular-nums" placeholder="Theo tem / quy cách" />
          {specQty != null && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              Tự điền theo quy cách {Number(specQty).toLocaleString('vi-VN')} thùng/pallet — sửa nếu pallet lẻ
            </p>
          )}
        </div>
        <PhotoOcrField title="Thùng ĐẦU" hint="giờ SX bắt đầu — chữ in phun" defaultDate={defaultDate} onValue={setProdS} />
        <PhotoOcrField title="Thùng CUỐI" hint="giờ SX kết thúc — chữ in phun" defaultDate={defaultDate} onValue={setProdE} />
        <p className="text-[10px] text-slate-400">
          Giờ SX lấy từ CHỮ IN PHUN trên thùng (không phải giờ bấm nút). Ảnh lưu làm bằng chứng, giữ 60 ngày.
        </p>
      </div>
    </FormSheet>
  )
}

// ─── Sheet ĐÓNG SỔ — pallet đầy ──────────────────────────────────────────────
function CloseSheet({ log, onDone, onError }: { log: PackingLog; onDone: () => void; onError: (m: string) => void }) {
  const closeMut = useClosePackingLog()
  const [zoom, setZoom] = useState<string | null>(null)
  const startDate = log.prod_start_at
    ? new Date(log.prod_start_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    : (dmyToIso(parseCodeFields(log.pallet_code).dateDisplay) ?? todayVN())
  const [qty, setQty] = useState(log.qty_cartons != null ? String(log.qty_cartons) : '')
  const [prod, setProd] = useState<ProdTimeValue>({ photoData: null, iso: null, src: null, raw: null, busy: false })

  function save() {
    const q = qty.trim() === '' ? null : Number(qty.replace(',', '.'))
    if (q !== null && (!Number.isFinite(q) || q <= 0)) { onError('Số thùng phải là số dương'); return }
    if (prod.iso && log.prod_start_at && prod.iso < log.prod_start_at) {
      onError('Giờ SX thùng CUỐI đang trước thùng ĐẦU — sản xuất qua ngày mới thì chỉnh lại Ngày ở ô ngày'); return
    }
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
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={closeMut.isPending || prod.busy} onClick={save}>
            {closeMut.isPending ? 'Đang lưu…' : prod.busy ? 'Đang đọc ảnh…' : 'Đóng sổ'}
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
        {/* Thùng ĐẦU đã ghi khi mở — cùng khung section với ô chụp thùng cuối (form đồng bộ) */}
        <ProdSection title="Thùng ĐẦU" hint="đã ghi khi mở pallet">
          {log.photo_start_url ? (
            <img src={log.photo_start_url} alt="Thùng đầu" className="shrink-0 w-24 h-20 rounded-lg border border-slate-200 object-cover cursor-zoom-in" onClick={() => setZoom(log.photo_start_url!)} />
          ) : (
            <div className="shrink-0 w-24 h-20 rounded-lg border border-dashed border-slate-200 flex flex-col items-center justify-center gap-0.5 text-slate-300">
              <Camera className="h-4 w-4" /><span className="text-[9px]">chưa có ảnh</span>
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm tabular-nums font-semibold text-slate-700">{log.prod_start_at ? fmtDT(log.prod_start_at) : <span className="text-slate-300 font-normal">chưa có giờ</span>}</p>
            {log.prod_start_src && <p className="text-[10px] text-slate-500 inline-flex items-center gap-1">Nguồn: {SRC_BADGE(log.prod_start_src)}</p>}
          </div>
        </ProdSection>
        {zoom && <PhotoLightbox url={zoom} onClose={() => setZoom(null)} />}
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Số thùng trên pallet</p>
          <Input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal"
            className="h-9 w-32 text-sm tabular-nums" placeholder="Số thùng" />
          {log.qty_cartons != null && (
            <p className="text-[10px] text-slate-400 mt-0.5">Số chuẩn theo tem: {Number(log.qty_cartons).toLocaleString('vi-VN')} — chỉ sửa khi pallet lẻ</p>
          )}
        </div>
        <PhotoOcrField title="Thùng CUỐI" hint="giờ SX kết thúc — chữ in phun" defaultDate={startDate} onValue={setProd} />
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
      t: d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).slice(0, 5),
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
    if (si && ei && ei < si) { onError('Giờ SX thùng CUỐI đang trước thùng ĐẦU — sản xuất qua ngày mới thì chỉnh lại Ngày'); return }
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

  // CÙNG BỐ CỤC với form ghi mới (user chốt 12/08 "Form thêm mới và edit giống nhau"):
  // section Thùng ĐẦU/CUỐI với ô ảnh trái (ảnh đã chụp, bấm phóng to) + Ngày/Giờ phải.
  const [zoom, setZoom] = useState<string | null>(null)
  const prodSec = (title: string, hint: string, url: string | null | undefined, src: string | null,
    d: string, setD: (v: string) => void, t: string, setT: (v: string) => void) => (
    <ProdSection title={title} hint={hint}>
      {url ? (
        <img src={url} alt={title} className="shrink-0 w-24 h-20 rounded-lg border border-slate-200 object-cover cursor-zoom-in" onClick={() => setZoom(url)} />
      ) : (
        <div className="shrink-0 w-24 h-20 rounded-lg border border-dashed border-slate-200 flex flex-col items-center justify-center gap-0.5 text-slate-300">
          <Camera className="h-4 w-4" /><span className="text-[9px]">chưa có ảnh</span>
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" value={d} onChange={e => setD(e.target.value)} className="h-9 w-36 text-sm" />
          <Input value={t} onChange={e => setT(maskHHMM(e.target.value))} placeholder="HH:MM" inputMode="numeric" className="h-9 w-24 text-sm tabular-nums text-center" />
          {url && (
            <button type="button" title="Xem ảnh lớn" onClick={() => setZoom(url)}
              className="p-1.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"><ZoomIn className="h-3.5 w-3.5" /></button>
          )}
        </div>
        {src && (
          <p className="text-[10px] text-slate-500 inline-flex items-center gap-1">
            Nguồn hiện tại: {SRC_BADGE(src)} <span className="text-slate-400">— đổi giờ sẽ chuyển thành "người"</span>
          </p>
        )}
      </div>
    </ProdSection>
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
        {/* Khối thông tin pallet — CÙNG kiểu card với sheet ghi mới */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs space-y-0.5">
          <p className="font-mono font-semibold text-slate-800 break-all">{log.pallet_code}</p>
          <p className="text-slate-500">
            Mã hàng <b className="text-slate-700">{log.material_code ?? '?'}</b>
            {log.machine_code && <> · Máy <b className="text-slate-700">{log.machine_code}</b></>}
          </p>
        </div>
        {prodSec('Thùng ĐẦU', 'giờ SX bắt đầu — chữ in phun', log.photo_start_url, log.prod_start_src, sd, setSd, st, setSt)}
        {prodSec('Thùng CUỐI', 'giờ SX kết thúc — chữ in phun', log.photo_end_url, log.prod_end_src, ed, setEd, et, setEt)}
        {zoom && <PhotoLightbox url={zoom} onClose={() => setZoom(null)} />}
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Số thùng</p>
          <Input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" className="h-9 w-32 text-sm tabular-nums" />
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Ghi chú</p>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-9 text-sm" placeholder="Lý do sửa / ghi chú" />
        </div>
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Sửa tay sẽ đánh dấu nguồn giờ/số là "người" — sổ phân biệt được dòng máy đọc (AI/OCR) và dòng người can thiệp.
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

// ─── Sheet MỞ TRANG SỔ (packing.open_run) — Kho·Ngày·Ca·Chu kỳ·Mã·Máy·Giờ BĐ ──
function OpenRunSheet({ whOpts, onDone, onError }: {
  whOpts: { value: string; label: string }[]
  onDone: () => void; onError: (m: string) => void
}) {
  const openMut = useOpenPackingRun()
  const { data: shifts } = useImportShifts()
  const shiftOpts = useMemo(() => ((shifts ?? []) as { id: string; name?: string; code?: string }[])
    .map(s => ({ value: s.name ?? s.code ?? '', label: s.name ?? s.code ?? '' })).filter(o => o.value), [shifts])
  const [whId, setWhId] = useState(whOpts.length === 1 ? whOpts[0].value : '')
  const [date, setDate] = useState(todayVN())
  const [shift, setShift] = useState('')
  const [cycle, setCycle] = useState('')
  // Loại kho để LỌC danh sách mã cho đúng (user 13/08) — hook SCOPED theo quyền loại hàng
  const whTypes = useScopedWhTypes()
  const catOpts = useMemo(() => (whTypes.data ?? []).map(t => ({ value: t.value, label: t.value })), [whTypes.data])
  const [cat, setCat] = useState('')
  const [matSearch, setMatSearch] = useState('')
  const mats = useMaterials({ search: matSearch || undefined, category: cat || undefined, limit: 50 })
  // 13/08 user chốt: 1 số loại hàng có 2-3 mã SX CHUNG 1 chu kỳ + 1 máy → 1 trang sổ ghi NHIỀU mã
  const [sel, setSel] = useState<{ code: string; id: string | null; label: string }[]>([])
  const matOpts = useMemo(() => (mats.data ?? [])
    .filter(m => !m.is_non_stock)
    .map(m => ({ value: m.material_code, label: `${m.material_code} — ${m.short_name ?? m.material_description ?? ''}` })), [mats.data])
  const [machine, setMachine] = useState('')
  const [startTime, setStartTime] = useState(nowHHMM())
  const [note, setNote] = useState('')
  // DANH MỤC MÁY THEO KHO (user 13/08): kho có khai máy → PHẢI chọn trong danh mục (BE cũng chặn 422);
  // kho chưa khai → điền tự do như cũ. Đổi kho → máy đã chọn không thuộc danh mục kho mới thì xóa.
  const { data: whMachines } = useMachines(whId || undefined)
  // Trần số mã / trang = cờ `packing_max_materials_per_run` (mặc định 10) — mirror gate BE openRun
  const maxMats = useSettingNumber('packing_max_materials_per_run', 10)
  const machineOpts = useMemo(() => (whId ? (whMachines ?? []) : [])
    .filter(m => m.is_active).map(m => ({ value: m.code, label: m.code + (m.note ? ` — ${m.note}` : '') })), [whMachines, whId])
  useEffect(() => {
    if (machineOpts.length && machine && !machineOpts.some(o => o.value === machine)) setMachine('')
  }, [machineOpts, machine])

  function addMat(v: string) {
    if (!v || sel.some(s => s.code === v)) return
    if (sel.length >= maxMats) { onError(`Tối đa ${maxMats} mã / 1 trang sổ`); return }
    const m = (mats.data ?? []).find(x => x.material_code === v)
    setSel(prev => [...prev, { code: v, id: m?.id ?? null, label: m ? `${m.material_code} — ${m.short_name ?? ''}` : v }])
  }

  function save() {
    if (!whId) { onError('Chọn Kho / Nhà máy'); return }
    if (!sel.length) { onError('Chọn Mã sản phẩm'); return }
    if (!machine.trim()) { onError('Nhập Máy'); return }
    if (!cycle.trim()) { onError('Nhập Chu kỳ'); return }
    const startIso = hhmmToIso(date, startTime)
    if (!startIso) { onError('Giờ bắt đầu dạng HH:MM (VD 07:30)'); return }
    openMut.mutate({
      warehouse_id: whId, run_date: date, shift: shift || null, cycle: cycle.trim(),
      material_codes: sel.map(s => s.code), material_id: sel[0]?.id ?? null, machine_code: machine.trim(),
      start_at: startIso, note: note.trim() || null,
    }, {
      onSuccess: () => onDone(),
      onError: (e) => onError(apiMsg(e, 'Không mở được trang sổ — thử lại')),
    })
  }

  return (
    <FormSheet open onClose={onDone} title="Mở trang sổ đóng gói"
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="outline" className="flex-1" onClick={onDone}>Hủy</Button>
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={openMut.isPending} onClick={save}>
            {openMut.isPending ? 'Đang mở…' : 'Mở trang sổ'}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
          1 trang sổ = 1 trang sản phẩm trong sổ viết tay — hàng có 2-3 mã SX chung 1 chu kỳ + 1 máy thì chọn đủ các mã vào CÙNG trang. Mở trang xong công nhân mới quét được tem pallet của các mã này; bấm "Giờ kết thúc" để đóng trang và tính tổng sản lượng.
        </p>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Kho / Nhà máy *</p>
          <SingleSelect options={whOpts} value={whId} onChange={setWhId} placeholder="Chọn kho…" triggerClassName="w-full h-9" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Ngày bắt đầu</p>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Giờ bắt đầu</p>
            <Input value={startTime} onChange={e => setStartTime(maskHHMM(e.target.value))} placeholder="HH:MM"
              inputMode="numeric" className="h-9 text-sm tabular-nums text-center" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Ca sản xuất</p>
            {shiftOpts.length ? (
              <SingleSelect options={shiftOpts} value={shift} onChange={setShift} placeholder="Chọn ca…" triggerClassName="w-full h-9" />
            ) : (
              <Input value={shift} onChange={e => setShift(e.target.value)} className="h-9 text-sm" placeholder="VD: Ca 1" />
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Chu kỳ *</p>
            <Input value={cycle} onChange={e => setCycle(e.target.value)} className="h-9 text-sm" placeholder="VD: 55" />
            <p className="text-[10px] text-slate-400 mt-0.5">Đối chiếu với chu kỳ trên tem khi quét</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Loại kho <span className="font-normal text-slate-400">(lọc danh sách mã bên dưới)</span></p>
          <SingleSelect options={catOpts} value={cat} onChange={setCat} placeholder="Tất cả loại kho…" triggerClassName="w-full h-9" />
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Mã sản phẩm * <span className="font-normal text-slate-400">(chọn được nhiều — hàng 2-3 mã SX chung 1 máy)</span></p>
          {sel.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {sel.map(s => (
                <span key={s.code} className="inline-flex items-center gap-1 max-w-full rounded-full bg-sky-50 border border-sky-200 text-sky-800 text-[11px] pl-2 pr-1 py-0.5">
                  <span className="truncate" title={s.label}>{s.label}</span>
                  <button type="button" title="Bỏ mã này" onClick={() => setSel(prev => prev.filter(x => x.code !== s.code))}
                    className="shrink-0 rounded-full p-0.5 hover:bg-sky-100"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
          <SingleSelect options={matOpts.filter(o => !sel.some(s => s.code === o.value))} value=""
            onChange={addMat}
            serverSearch onSearchChange={setMatSearch} loading={mats.isLoading} selectedLabel={undefined}
            placeholder={sel.length ? 'Thêm mã nữa…' : 'Gõ mã / tên để tìm…'} triggerClassName="w-full h-9" />
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Máy *</p>
          {machineOpts.length ? (
            <>
              <SingleSelect options={machineOpts} value={machine} onChange={setMachine} placeholder="Chọn máy…" triggerClassName="w-full h-9" />
              <p className="text-[10px] text-slate-400 mt-0.5">Kho này đã khai danh mục máy (Cài đặt WMS → Máy) — chỉ chọn được máy trong danh mục</p>
            </>
          ) : (
            <>
              <Input value={machine} onChange={e => setMachine(e.target.value.toUpperCase())} className="h-9 w-32 text-sm" placeholder="VD: A" />
              <p className="text-[10px] text-slate-400 mt-0.5">Tem in "AP" thì khai đúng máy thật (A hay P) — pallet quét vào trang sẽ theo máy này</p>
            </>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Ghi chú</p>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-9 text-sm" />
        </div>
      </div>
    </FormSheet>
  )
}

// ─── Sheet GIỜ KẾT THÚC — đóng trang sổ + TÍNH TỔNG SẢN LƯỢNG ────────────────
function CloseRunSheet({ run, onDone, onError }: { run: PackingRun; onDone: () => void; onError: (m: string) => void }) {
  const closeMut = useClosePackingRun()
  const [date, setDate] = useState(todayVN())
  const [time, setTime] = useState(nowHHMM())

  function save() {
    const endIso = hhmmToIso(date, time)
    if (!endIso) { onError('Giờ kết thúc dạng HH:MM (VD 16:45)'); return }
    // Kết thúc không được TRƯỚC bắt đầu — chạy qua nửa đêm thì Ngày kết thúc = hôm sau (mặc định đã là hôm nay)
    if (endIso < run.start_at) {
      onError(`Giờ kết thúc đang TRƯỚC giờ bắt đầu (bắt đầu ${fmtDT(run.start_at)}) — sản xuất qua ngày mới thì chỉnh Ngày kết thúc`); return
    }
    closeMut.mutate({ id: run.id, end_at: endIso }, {
      onSuccess: () => onDone(),
      onError: (e) => onError(apiMsg(e, 'Không đóng được trang sổ — thử lại')),
    })
  }

  return (
    <FormSheet open onClose={onDone} title="Giờ kết thúc — đóng trang sổ"
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="outline" className="flex-1" onClick={onDone}>Hủy</Button>
          <Button className="flex-1 bg-green-600 hover:bg-green-700" disabled={closeMut.isPending} onClick={save}>
            {closeMut.isPending ? 'Đang đóng…' : 'Đóng trang & tính tổng'}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs space-y-0.5">
          <p className="font-mono font-semibold text-slate-800">{run.material_code} · Máy {run.machine_code}</p>
          <p className="text-slate-500">
            {run.shift && <>{run.shift} · </>}{run.cycle && <>CK {run.cycle} · </>}
            Bắt đầu {isoToHHMM(run.start_at)} ({formatDate(run.run_date)})
          </p>
          <p className="text-slate-600 pt-1">
            Sẽ chốt: <b className="tabular-nums">{run.pallet_count ?? 0}</b> pallet ·
            Tổng sản lượng <b className="tabular-nums">{Number(run.qty_total ?? 0).toLocaleString('vi-VN')}</b> thùng
          </p>
        </div>
        {(run.pallet_open ?? 0) > 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Còn <b>{run.pallet_open}</b> pallet đang MỞ — vẫn tính vào tổng theo số chuẩn tem; nên đóng từng pallet trước cho chuẩn.</span>
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Ngày kết thúc</p>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 text-sm" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Giờ kết thúc</p>
            <Input value={time} onChange={e => setTime(maskHHMM(e.target.value))} placeholder="HH:MM"
              inputMode="numeric" className="h-9 text-sm tabular-nums text-center" />
          </div>
        </div>
      </div>
    </FormSheet>
  )
}

// ─── Sheet SỬA TRANG SỔ (packing.open_run) ───────────────────────────────────
function RunEditSheet({ run, onDone, onError }: { run: PackingRun; onDone: () => void; onError: (m: string) => void }) {
  const upd = useUpdatePackingRun()
  const toL = (iso: string | null) => iso
    ? { d: new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }), t: isoToHHMM(iso) }
    : { d: '', t: '' }
  const s0 = toL(run.start_at), e0 = toL(run.end_at)
  const [shift, setShift] = useState(run.shift ?? '')
  const [cycle, setCycle] = useState(run.cycle ?? '')
  const [machine, setMachine] = useState(run.machine_code)
  const [sd, setSd] = useState(s0.d); const [st, setSt] = useState(s0.t)
  const [ed, setEd] = useState(e0.d); const [et, setEt] = useState(e0.t)
  const [qtyTotal, setQtyTotal] = useState(run.qty_total != null ? String(run.qty_total) : '')
  const [note, setNote] = useState(run.note ?? '')
  // kho có danh mục máy → sửa máy cũng phải chọn trong danh mục (máy hiện tại của trang nếu lạc
  // danh mục thì vẫn ghim vào options để hiển thị — BE sẽ chặn khi đổi sang giá trị lạ)
  const { data: whMachines } = useMachines(run.warehouse_id)
  const editMachineOpts = useMemo(() => {
    const opts = (whMachines ?? []).filter(m => m.is_active).map(m => ({ value: m.code, label: m.code + (m.note ? ` — ${m.note}` : '') }))
    if (opts.length && run.machine_code && !opts.some(o => o.value === run.machine_code))
      opts.unshift({ value: run.machine_code, label: `${run.machine_code} (ngoài danh mục — chỉ xem)` })
    return opts
  }, [whMachines, run.machine_code])

  // KHÓA SỬA KHI ĐÃ CÓ DỮ LIỆU QUÉT (user chốt 15/08): còn pallet ghi vào thì chỉ sửa GHI CHÚ —
  // muốn sửa Ca/Chu kỳ/Máy/Giờ/Tổng phải hủy hết pallet trước. BE là điểm chặn thật (409
  // RUN_LOCKED_HAS_PALLETS); FE khóa ô + gửi mỗi note để người dùng không gõ xong mới bị chặn.
  const locked = (run.pallet_count ?? 0) > 0

  function save() {
    if (locked) {
      upd.mutate({ id: run.id, note: note.trim() || null }, {
        onSuccess: () => onDone(),
        onError: (e) => onError(apiMsg(e, 'Không lưu được — thử lại')),
      })
      return
    }
    if (!machine.trim()) { onError('Máy không được trống'); return }
    const si = hhmmToIso(sd, st)
    if (!si) { onError('Giờ bắt đầu dạng HH:MM'); return }
    let ei: string | null | undefined
    if (!ed && !et.trim()) ei = run.status === 'CLOSED' ? undefined : null
    else {
      ei = hhmmToIso(ed, et)
      if (!ei) { onError('Giờ kết thúc dạng HH:MM (hoặc để trống)'); return }
      if (ei < si) { onError('Giờ kết thúc đang TRƯỚC giờ bắt đầu — sản xuất qua ngày mới thì chỉnh Ngày kết thúc'); return }
    }
    const q = qtyTotal.trim() === '' ? undefined : Number(qtyTotal.replace(',', '.'))
    if (q !== undefined && (!Number.isFinite(q) || q < 0)) { onError('Tổng sản lượng phải là số không âm'); return }
    if (!cycle.trim()) { onError('Nhập Chu kỳ'); return }
    if (!machine.trim()) { onError('Nhập Máy'); return }
    upd.mutate({
      id: run.id, shift: shift.trim() || null, cycle: cycle.trim(), machine_code: machine.trim(),
      start_at: si, ...(ei !== undefined ? { end_at: ei } : {}),
      ...(q !== undefined ? { qty_total: q } : {}),
      note: note.trim() || null,
    }, {
      onSuccess: () => onDone(),
      onError: (e) => onError(apiMsg(e, 'Không lưu được — thử lại')),
    })
  }

  return (
    <FormSheet open onClose={onDone} title={`Sửa trang sổ — ${run.material_code}`}
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="outline" className="flex-1" onClick={onDone}>Hủy</Button>
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={upd.isPending} onClick={save}>
            {upd.isPending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        {locked && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Trang sổ đã có <b>{run.pallet_count}</b> pallet quét vào — <b>chỉ sửa được Ghi chú</b>.
              Pallet đã lấy Máy + Chu kỳ theo trang này, nên muốn sửa các thông tin đó phải <b>hủy hết pallet đã quét</b> trước.</span>
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Ca sản xuất</p>
            <Input value={shift} onChange={e => setShift(e.target.value)} disabled={locked} className="h-9 text-sm" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Chu kỳ *</p>
            <Input value={cycle} onChange={e => setCycle(e.target.value)} disabled={locked} className="h-9 text-sm" />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Máy *</p>
          {editMachineOpts.length ? (
            <SingleSelect options={editMachineOpts} value={machine} onChange={setMachine} disabled={locked} placeholder="Chọn máy…" triggerClassName="w-full h-9" />
          ) : (
            <Input value={machine} onChange={e => setMachine(e.target.value.toUpperCase())} disabled={locked} className="h-9 w-32 text-sm" />
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Giờ bắt đầu</p>
          <div className="flex items-center gap-2">
            <Input type="date" value={sd} onChange={e => setSd(e.target.value)} disabled={locked} className="h-9 w-36 text-sm" />
            <Input value={st} onChange={e => setSt(maskHHMM(e.target.value))} disabled={locked} placeholder="HH:MM" inputMode="numeric" className="h-9 w-24 text-sm tabular-nums text-center" />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Giờ kết thúc {run.status === 'OPEN' ? '(để trống nếu chưa xong)' : ''}</p>
          <div className="flex items-center gap-2">
            <Input type="date" value={ed} onChange={e => setEd(e.target.value)} disabled={locked} className="h-9 w-36 text-sm" />
            <Input value={et} onChange={e => setEt(maskHHMM(e.target.value))} disabled={locked} placeholder="HH:MM" inputMode="numeric" className="h-9 w-24 text-sm tabular-nums text-center" />
          </div>
        </div>
        {run.status === 'CLOSED' && (
          <div>
            <p className="text-xs font-medium text-slate-700 mb-1">Tổng sản lượng (thùng)</p>
            <Input value={qtyTotal} onChange={e => setQtyTotal(e.target.value)} disabled={locked} inputMode="decimal" className="h-9 w-36 text-sm tabular-nums" />
            <p className="text-[10px] text-slate-400 mt-0.5">Số máy tính = Σ thùng pallet trong trang — chỉ sửa khi cần chốt khác</p>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-slate-700 mb-1">Ghi chú</p>
          <Input value={note} onChange={e => setNote(e.target.value)} className="h-9 text-sm" placeholder="Lý do sửa / ghi chú" />
        </div>
      </div>
    </FormSheet>
  )
}

// ─── Xác nhận hủy trang sổ ───────────────────────────────────────────────────
function RunCancelConfirm({ run, onDone, onError }: { run: PackingRun; onDone: () => void; onError: (m: string) => void }) {
  const cancelMut = useCancelPackingRun()
  const [note, setNote] = useState('')
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onDone}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold text-slate-800">Hủy trang sổ này?</p>
        <p className="text-xs text-slate-500">{run.material_code} · Máy {run.machine_code} · {formatDate(run.run_date)}</p>
        <p className="text-[11px] text-slate-500">Chỉ hủy được trang CHƯA có pallet ghi vào. Trang hủy vẫn giữ vết (Đã hủy).</p>
        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Lý do hủy (nên ghi)" className="h-9 text-sm" />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onDone}>Không</Button>
          <Button variant="destructive" className="flex-1" disabled={cancelMut.isPending}
            onClick={() => cancelMut.mutate({ id: run.id, note: note.trim() || undefined }, {
              onSuccess: () => onDone(),
              onError: (e) => { onError(apiMsg(e, 'Không hủy được')); onDone() },
            })}>
            {cancelMut.isPending ? 'Đang hủy…' : 'Hủy trang'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab TRANG SỔ — tra cứu sổ GỘP THEO TRANG (table-format, nhóm dòng) ──────
const RUNS_PAGE_SIZE = 50   // mỗi trang kèm pallet — giữ payload gọn

// Tab ĐÓNG GÓI duy nhất (12/08 gộp "Trang sổ" vào đây — 2 tab từng giống hệt nhau):
// bảng trang sổ server-filter đầy đủ (trạng thái/ngày/kho/máy) + Mở trang sổ + export + phân trang.
function RunsTab({ canExport, openCount, canOpenRun, onOpenRun, whName, whOpts, h }: {
  canExport: boolean; openCount: number
  canOpenRun: boolean; onOpenRun: () => void
  whName: Map<string, string>; whOpts: { value: string; label: string }[]
  h: RunTableHandlers
}) {
  const f = useWmsFilterStore(s => s.packing)
  const setF = useWmsFilterStore(s => s.setPacking)
  const [exporting, setExporting] = useState(false)

  const { data, isLoading } = usePackingRuns({
    status: f.runStatus || undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
    machine: f.machine || undefined,
    cycle: f.cycle || undefined,
    warehouse_id: f.warehouseId || undefined,
    search: f.search || undefined,
    page: f.runPage, pageSize: RUNS_PAGE_SIZE,
  })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày sản xuất', type: 'daterange', pinned: true, from: f.dateFrom, to: f.dateTo,
      onChange: (from, to) => setF({ dateFrom: from, dateTo: to, runPage: 1 }) },
    // Tháng SX = cách nhập nhanh của chính khoảng ngày trên (chọn tháng → set trọn tháng;
    // chip suy ngược — chọn khoảng ngày lẻ tay thì chip tháng tự biến mất, không mâu thuẫn)
    { key: 'month', label: 'Tháng sản xuất', type: 'single', options: monthOpts(),
      value: monthOf(f.dateFrom, f.dateTo),
      onChange: (v: string) => setF(v ? { dateFrom: monthRange(v).from, dateTo: monthRange(v).to, runPage: 1 } : { dateFrom: '', dateTo: '', runPage: 1 }) },
    { key: 'wh', label: 'Kho / Nhà máy', type: 'single', options: whOpts,
      value: f.warehouseId, onChange: (v: string) => setF({ warehouseId: v, runPage: 1 }) },
    { key: 'status', label: 'Trạng thái', type: 'single',
      options: [{ value: 'OPEN', label: 'Đang mở' }, { value: 'CLOSED', label: 'Đã đóng' }, { value: 'CANCELLED', label: 'Đã hủy' }],
      value: f.runStatus, onChange: (v: string) => setF({ runStatus: v, runPage: 1 }) },
    { key: 'machine', label: 'Máy', type: 'text', value: f.machine, placeholder: 'VD: A',
      onChange: (v: string) => setF({ machine: v, runPage: 1 }) },
    { key: 'cycle', label: 'Chu kỳ', type: 'text', value: f.cycle, placeholder: 'VD: 55',
      onChange: (v: string) => setF({ cycle: v, runPage: 1 }) },
  ]

  async function exportExcel() {
    setExporting(true)
    try {
      const [{ saveWorkbook }, XLSX, { sanitizeRows }] = await Promise.all([
        import('@/utils/saveExcel'), import('xlsx'), import('@/utils/excelSafe'),
      ])
      const out = rows.map(r => ({
        'Trạng thái': RUN_STATUS_LABEL[r.status] ?? r.status,
        'Ngày': r.run_date,
        'Kho': whName.get(r.warehouse_id) ?? r.warehouse_id,
        'Ca SX': r.shift ?? '',
        'Chu kỳ': r.cycle ?? '',
        'Mã sản phẩm': r.material_code,
        'Máy': r.machine_code,
        'Giờ bắt đầu': isoToHHMM(r.start_at),
        'Giờ kết thúc': r.end_at ? isoToHHMM(r.end_at) : '',
        'Số pallet': r.pallet_count ?? '',
        'Tổng sản lượng (thùng)': r.qty_total ?? '',
        'Người mở': r.opened_by_name ?? '',
        'Người đóng': r.closed_by_name ?? '',
        'Ghi chú': r.note ?? '',
      }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sanitizeRows(out)), 'Trang so dong goi')
      await saveWorkbook(wb, `trang-so-dong-goi-${todayVN()}`)
    } finally { setExporting(false) }
  }

  return (
    <>
      <div className="border-b bg-white px-3 py-1.5 sm:py-2 shrink-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={f.search} onChange={v => setF({ search: v, runPage: 1 })}
            placeholder="Tìm mã SP / chu kỳ / người mở…" className="flex-1 min-w-[120px]" />
          <span className="sm:hidden"><FilterSheetButton defs={filterDefs} /></span>
          <ActionCluster mobileInline items={[
            ...(canOpenRun ? [{ key: 'open', icon: Plus, label: 'Mở trang sổ', tip: 'Mở trang sổ mới (Kho · Ca · Mã · Máy) — mở xong mới quét được tem', onClick: onOpenRun, primary: true, className: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' } satisfies ActionItem] : []),
            ...(canExport ? [{ key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất danh sách trang sổ theo bộ lọc', onClick: exportExcel, disabled: !rows.length, busy: exporting, mobileHidden: true } satisfies ActionItem] : []),
          ]} />
        </div>
        <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
      </div>

      <SummaryBand tiles={[
        { label: 'Đang mở', value: openCount.toLocaleString('vi-VN'), accent: openCount > 0 },
        { label: 'Trang sổ (bộ lọc)', value: total.toLocaleString('vi-VN') },
        { label: 'Pallet (trang này)', value: rows.reduce((s, r) => s + Number(r.pallet_count ?? 0), 0).toLocaleString('vi-VN') },
        { label: 'Thùng (trang này)', value: rows.reduce((s, r) => s + Number(r.qty_total ?? 0), 0).toLocaleString('vi-VN') },
      ]} />

      <RunGroupedTable runs={rows} loading={isLoading} h={h}
        emptyText={canOpenRun
          ? 'Chưa có trang sổ nào khớp bộ lọc — bấm "Mở trang sổ" (Kho · Ca · Mã · Máy) rồi mới quét được tem pallet'
          : 'Chưa có trang sổ nào khớp bộ lọc — người có quyền phải "Mở trang sổ" trước thì mới quét được tem'} />
      <div className="border-t px-3 py-1.5 text-[10px] text-slate-500 shrink-0 flex items-center gap-3">
        <span>1–{rows.length} / {total.toLocaleString('vi-VN')} trang sổ</span>
        {total > RUNS_PAGE_SIZE && (
          <span className="inline-flex items-center gap-1">
            <button type="button" disabled={f.runPage <= 1} onClick={() => setF({ runPage: f.runPage - 1 })}
              className="px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-40">‹</button>
            trang {f.runPage}/{Math.max(1, Math.ceil(total / RUNS_PAGE_SIZE))}
            <button type="button" disabled={f.runPage >= Math.ceil(total / RUNS_PAGE_SIZE)} onClick={() => setF({ runPage: f.runPage + 1 })}
              className="px-1.5 py-0.5 rounded border border-slate-200 disabled:opacity-40">›</button>
          </span>
        )}
        <span className="hidden sm:inline text-slate-400">1 trang sổ = 1 trang sản phẩm · bấm dòng trang để xem chi tiết · Tổng SL chốt khi bấm Giờ kết thúc</span>
      </div>
    </>
  )
}

// ─── Sheet DETAIL TRANG SỔ (bấm vào dòng trang) — đọc sống qua GET /:id ───────
// User chốt 11/08 tối: mở 80% MÀN HÌNH — khối thông tin ~20% trên, BẢNG pallet 80% dưới.
// Ngày hiện ĐẦY ĐỦ kèm giờ (1 chu kỳ có thể sản xuất LIỀN VÀI NGÀY).
const fmtDT = (iso: string | null) => iso ? `${formatTimestampDate(iso, true)} ${isoToHHMM(iso)}` : ''
const DETAIL_PALLET_COLS = ['Thao tác', 'Trạng thái', 'Tem pallet', 'Mã hàng', 'Số thùng', 'Kho nhận', 'Giờ SX thùng đầu', 'Giờ SX thùng cuối', 'Quét lúc', 'Người', 'Ảnh'] as const

function RunDetailSheet({ id, h, onDone }: { id: string; h: RunTableHandlers; onDone: () => void }) {
  const { canOpenRun, whName } = h
  const { data: run, isLoading } = usePackingRun(id)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const codes = run ? runCodes(run) : []
  const matName = useMatNames(codes)
  // trang nhiều mã → sản lượng TÁCH THEO MÃ (tính sống từ pallet, không đụng qty_total đã chốt)
  const perMat = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of run?.pallets ?? []) {
      if (l.status === 'CANCELLED' || !l.material_code) continue
      m.set(l.material_code, (m.get(l.material_code) ?? 0) + Number(l.qty_cartons ?? 0))
    }
    return m
  }, [run?.pallets])
  // Đối chiếu SX↔Kho ở mức TRANG SỔ (user 13/08): mở detail là thấy ngay còn bao nhiêu pallet kho
  // CHƯA quét nhập, khỏi rà từng dòng. Dòng đã hủy không tính (không còn là hàng phải nhận).
  const recv = useMemo(() => {
    const ps = (run?.pallets ?? []).filter(p => p.status !== 'CANCELLED')
    const received = ps.filter(p => p.received_at).length
    return { total: ps.length, received, pending: ps.length - received, diff: ps.filter(p => p.is_qty_diff).length }
  }, [run?.pallets])
  const Info = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xs text-slate-700 truncate">{value}</p>
    </div>
  )
  return (
    <FormSheet open onClose={onDone} widthClass="sm:max-w-[80vw]"
      title={run ? <>Trang sổ — <span className="font-mono">{runCodes(run).join(' + ')}</span> · Máy {run.machine_code}
        <span className={`ml-2 align-middle text-[10px] font-normal px-2 py-0.5 rounded-full ${STATUS_BADGE[run.status]}`}>{RUN_STATUS_LABEL[run.status]}</span></> : 'Trang sổ'}
      footer={
        <div className="flex gap-2 w-full">
          <Button variant="outline" className="flex-1" onClick={onDone}>Đóng</Button>
          {/* Quét thêm pallet NGAY TỪ DETAIL (user 12/08 tối: "cần nút bấm để quét pallet thêm cho sổ") */}
          {run && run.status === 'OPEN' && h.canRecord && (
            <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={() => { onDone(); h.onScan() }}>
              <ScanLine className="h-3.5 w-3.5 mr-1" /> Quét tem<span className="hidden sm:inline"> — thêm pallet</span>
            </Button>
          )}
          {run && run.status === 'OPEN' && canOpenRun && (
            <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => { onDone(); h.onCloseRun(run) }}>
              <StopCircle className="h-3.5 w-3.5 mr-1" /> Giờ kết thúc
            </Button>
          )}
          {run && run.status !== 'CANCELLED' && canOpenRun && (
            <Button variant="outline" className="shrink-0" onClick={() => { onDone(); h.onEditRun(run) }}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {run && run.status !== 'CANCELLED' && canOpenRun && (run.pallets ?? []).length === 0 && (
            <Button variant="outline" className="shrink-0 text-red-600 border-red-200" onClick={() => { onDone(); h.onCancelRun(run) }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      }>
      {isLoading || !run ? (
        <p className="text-center py-10 text-xs text-slate-400">Đang tải…</p>
      ) : (
        <div className="h-full flex flex-col gap-3">
          {/* ~20% — thông tin trang sổ (band ngang, gọn) */}
          <div className="shrink-0 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2" style={{ maxHeight: '20vh', overflowY: 'auto' }}>
            <Info label="Kho / Nhà máy" value={whName.get(run.warehouse_id) ?? run.warehouse_id} />
            <Info label={codes.length > 1 ? `Mã sản phẩm (${codes.length})` : 'Mã sản phẩm'} value={
              <span title={codes.map(c => `${c} — ${matName.get(c) ?? ''}`).join(' · ')}>
                {codes.map(c => matName.get(c) ? `${c} ${matName.get(c)}` : c).join(' · ')}
              </span>
            } />
            <Info label="Ngày sản xuất" value={formatDate(run.run_date)} />
            <Info label="Ca sản xuất" value={run.shift ?? '—'} />
            <Info label="Chu kỳ" value={run.cycle ?? '—'} />
            <Info label="Giờ bắt đầu" value={<span className="tabular-nums">{fmtDT(run.start_at)}</span>} />
            <Info label="Giờ kết thúc" value={<span className="tabular-nums">{run.end_at ? fmtDT(run.end_at) : (run.status === 'OPEN' ? `chưa bấm · mở ${elapsedOf(run.start_at)}` : '—')}</span>} />
            <Info label="Tổng sản lượng" value={
              <b className="tabular-nums" title={codes.length > 1 ? codes.map(c => `${c}: ${(perMat.get(c) ?? 0).toLocaleString('vi-VN')} thùng`).join(' · ') : undefined}>
                {Number(run.qty_total ?? 0).toLocaleString('vi-VN')} thùng
                {codes.length > 1 && <span className="ml-1 font-normal text-slate-500">({codes.map(c => `${c.slice(-4)}: ${(perMat.get(c) ?? 0).toLocaleString('vi-VN')}`).join(' · ')})</span>}
              </b>
            } />
            <Info label="Số pallet" value={<span className="tabular-nums">{run.pallet_count ?? 0}{(run.pallet_open ?? 0) > 0 ? ` (${run.pallet_open} đang mở)` : ''}</span>} />
            {/* Kho đã nhận / chưa nhận — xác nhận LẦN 2 (kho quét nhập khớp tem pallet của sổ) */}
            <Info label="Kho nhận" value={recv.total === 0 ? <span className="text-slate-300">—</span> : (
              <span className={`tabular-nums ${recv.diff ? 'text-red-600 font-semibold' : recv.pending ? 'text-amber-600' : 'text-green-700'}`}
                title={recv.pending
                  ? `${recv.pending} pallet đã ghi sổ nhưng kho CHƯA quét nhập${recv.diff ? ` · ${recv.diff} pallet lệch số thùng sổ↔kho` : ''}`
                  : `Kho đã quét nhập đủ ${recv.total} pallet${recv.diff ? ` · ${recv.diff} pallet lệch số thùng sổ↔kho` : ''}`}>
                {recv.diff > 0 && <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />}
                {recv.received}/{recv.total} đã nhận
                {recv.pending > 0 && <span className="font-normal"> · {recv.pending} chưa</span>}
                {recv.diff > 0 && <span className="font-normal"> · {recv.diff} lệch SL</span>}
              </span>
            )} />
            <Info label="Người mở" value={run.opened_by_name ?? '—'} />
            <Info label="Người đóng" value={run.closed_by_name ?? '—'} />
            <Info label="Ghi chú" value={run.note ?? '—'} />
          </div>
          {/* ~80% — BẢNG pallet của trang */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 mb-1 shrink-0">
              <p className="text-xs font-medium text-slate-700">Pallet trong trang ({(run.pallets ?? []).length})</p>
              {run.status === 'OPEN' && h.canRecord && (
                <button type="button" onClick={() => { onDone(); h.onScan() }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 text-[11px] font-medium">
                  <ScanLine className="h-3.5 w-3.5" /> Quét tem thêm pallet
                </button>
              )}
            </div>
            {(run.pallets ?? []).length === 0 ? (
              <p className="text-[11px] text-slate-400">Chưa có pallet nào — quét tem để ghi vào trang</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-lg">
                <Table className="min-w-full [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100">
                  <TableHeader>
                    <TableRow>
                      {DETAIL_PALLET_COLS.map((c, i) => (
                        <TableHead key={i} className="text-[9px] font-medium text-slate-500 px-2 py-1.5 whitespace-nowrap">{c}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(run.pallets ?? []).map(l => (
                      <TableRow key={l.id} className={l.status === 'CANCELLED' ? 'text-slate-400 line-through' : ''}>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <span className="inline-flex gap-1">
                            {l.status === 'OPEN' && h.canRecord && (
                              <button type="button" title="Đóng pallet (pallet đầy)" onClick={() => { onDone(); h.onClosePallet(l) }}
                                className="px-1.5 py-1 rounded border border-green-200 text-green-700 hover:bg-green-50"><Check className="h-3.5 w-3.5" /></button>
                            )}
                            {l.status !== 'CANCELLED' && h.canEdit && (
                              <button type="button" title="Sửa giờ SX / số thùng" onClick={() => { onDone(); h.onEditPallet(l) }}
                                className="px-1.5 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /></button>
                            )}
                            {l.status !== 'CANCELLED' && h.canCancel && (
                              <button type="button" title="Hủy dòng pallet" onClick={() => { onDone(); h.onCancelPallet(l) }}
                                className="px-1.5 py-1 rounded border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200"><X className="h-3.5 w-3.5" /></button>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full no-underline ${STATUS_BADGE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono truncate max-w-[260px]" title={l.pallet_code}>
                          {parseCodeFields(l.pallet_code).seq ? <b>#{parseCodeFields(l.pallet_code).seq}</b> : null} {l.pallet_code}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={l.material_code ? `${l.material_code} — ${matName.get(l.material_code) ?? ''}` : ''}>
                          <span className="font-mono font-semibold">{l.material_code ?? '—'}</span>
                          {l.material_code && matName.get(l.material_code) && <span className="ml-1 text-[9px] text-slate-400 no-underline">{matName.get(l.material_code)}</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums font-semibold">
                          {l.qty_cartons != null ? Number(l.qty_cartons).toLocaleString('vi-VN') : <span className="text-slate-300">—</span>}
                          {l.qty_source === 'MANUAL' && <span className="ml-1 text-[8px] px-1 rounded bg-amber-100 text-amber-800 no-underline">tay</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                          {l.received_at ? (
                            l.is_qty_diff ? (
                              <span className="text-red-600 font-semibold no-underline" title={`Kho nhập ${Number(l.received_qty ?? 0).toLocaleString('vi-VN')} thùng ≠ sổ ghi ${Number(l.qty_cartons ?? 0).toLocaleString('vi-VN')}`}>
                                <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />lệch: kho {Number(l.received_qty ?? 0).toLocaleString('vi-VN')}
                              </span>
                            ) : (
                              <span className="text-green-700 no-underline" title={`Kho quét nhập lúc ${formatTimestampDate(l.received_at)} ${formatTimestampTime(l.received_at)}`}>
                                <Check className="inline h-3 w-3 mr-0.5 -mt-0.5" />{formatTimestampDate(l.received_at, true)}
                              </span>
                            )
                          ) : l.status !== 'CANCELLED' ? (
                            <span className="text-amber-600 no-underline" title="SX đã ghi sổ nhưng kho CHƯA quét nhập">chưa nhận</span>
                          ) : <span className="text-slate-300">—</span>}
                        </TableCell>
                        {/* Ô giờ TRỐNG = nút "+ thêm giờ" inline (user 12/08 tối) — mở form Sửa điền luôn */}
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                          {l.prod_start_at ? <>{fmtDT(l.prod_start_at)} {SRC_BADGE(l.prod_start_src)}</>
                            : l.status !== 'CANCELLED' && h.canEdit ? (
                              <button type="button" title="Thêm giờ SX thùng đầu" onClick={() => { onDone(); h.onEditPallet(l) }}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-slate-300 text-slate-400 hover:text-sky-700 hover:border-sky-300 no-underline">
                                <Plus className="h-3 w-3" /> thêm giờ
                              </button>
                            ) : <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums">
                          {l.prod_end_at ? <>{fmtDT(l.prod_end_at)} {SRC_BADGE(l.prod_end_src)}</>
                            : l.status !== 'CANCELLED' && h.canEdit ? (
                              <button type="button" title="Thêm giờ SX thùng cuối" onClick={() => { onDone(); h.onEditPallet(l) }}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-slate-300 text-slate-400 hover:text-sky-700 hover:border-sky-300 no-underline">
                                <Plus className="h-3 w-3" /> thêm giờ
                              </button>
                            ) : <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap tabular-nums text-slate-400">
                          {fmtDT(l.open_scan_at)}{l.close_scan_at ? ` → ${isoToHHMM(l.close_scan_at)}` : ''}
                        </TableCell>
                        <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate max-w-[110px]" title={l.packed_by_name ?? ''}>{l.packed_by_name ?? '—'}</TableCell>
                        <TableCell className="px-2 py-1 whitespace-nowrap">
                          {(l.photo_start_url || l.photo_end_url) ? (
                            <span className="inline-flex gap-1">
                              {l.photo_start_url && <img src={l.photo_start_url} alt="đầu" className="h-6 w-9 object-cover rounded cursor-zoom-in border border-slate-200" onClick={() => setLightbox(l.photo_start_url!)} />}
                              {l.photo_end_url && <img src={l.photo_end_url} alt="cuối" className="h-6 w-9 object-cover rounded cursor-zoom-in border border-slate-200" onClick={() => setLightbox(l.photo_end_url!)} />}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          {lightbox && <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />}
        </div>
      )}
    </FormSheet>
  )
}

// ─── Tab SỔ — lịch sử (table-format) ─────────────────────────────────────────
const LOG_COLS = [
  { id: 'act',     label: 'Thao tác',      w: 96 },
  { id: 'status',  label: 'Trạng thái',    w: 90 },
  { id: 'pallet',  label: 'Tem pallet',    w: 220 },
  { id: 'mat',     label: 'Mã hàng',       w: 110 },
  { id: 'name',    label: 'Tên hàng',      w: 150 },
  { id: 'recv',    label: 'Kho nhận',      w: 118 },   // đối chiếu SX↔Kho: kho quét nhập = xác nhận lần 2
  { id: 'wh',      label: 'Kho',           w: 110 },
  { id: 'machine', label: 'Máy',           w: 60 },
  { id: 'qty',     label: 'Số thùng',      w: 90 },
  { id: 'prod',    label: 'Giờ SX (in phun)', w: 200 },
  { id: 'scan',    label: 'Thao tác quét', w: 170 },
  { id: 'by',      label: 'Người đóng',    w: 120 },
  { id: 'photo',   label: 'Ảnh',           w: 90 },
  { id: 'note',    label: 'Ghi chú',       w: 140 },
]
const LOG_COL_DEFAULTS = LOG_COLS.map(c => c.w)

function LogTab({ canEdit, canCancel, canExport, openCount, whName, whOpts, onEdit, onCancel, onCloseRow }: {
  canEdit: boolean; canCancel: boolean; canExport: boolean; openCount: number
  whName: Map<string, string>; whOpts: { value: string; label: string }[]
  onEdit: (l: PackingLog) => void; onCancel: (l: PackingLog) => void; onCloseRow: (l: PackingLog) => void
}) {
  const f = useWmsFilterStore(s => s.packing)
  const setF = useWmsFilterStore(s => s.setPacking)
  const { widths: colW, startResize, totalWidth } = useColumnResize('packing_col_widths_v3', LOG_COL_DEFAULTS)
  const [exporting, setExporting] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const { data, isLoading } = usePackingLogs({
    status: f.status || undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
    machine: f.machine || undefined,
    cycle: f.cycle || undefined,
    warehouse_id: f.warehouseId || undefined,
    search: f.search || undefined,
    received: f.received || undefined,
    page: f.page, pageSize: f.pageSize,
  })
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const closed = rows.filter(r => r.status === 'CLOSED')
  const manualN = closed.filter(r => r.prod_start_src === 'MANUAL' || r.prod_end_src === 'MANUAL').length
  const matName = useMatNames(rows.map(r => r.material_code ?? '').filter(Boolean))

  const filterDefs: FilterDef[] = [
    { key: 'date', label: 'Ngày mở sổ', type: 'daterange', pinned: true, from: f.dateFrom, to: f.dateTo,
      onChange: (from, to) => setF({ dateFrom: from, dateTo: to, page: 1 }) },
    // Tháng SX = chọn nhanh trọn tháng cho khoảng ngày trên (quét mở pallet = lúc SX)
    { key: 'month', label: 'Tháng sản xuất', type: 'single', options: monthOpts(),
      value: monthOf(f.dateFrom, f.dateTo),
      onChange: (v: string) => setF(v ? { dateFrom: monthRange(v).from, dateTo: monthRange(v).to, page: 1 } : { dateFrom: '', dateTo: '', page: 1 }) },
    { key: 'wh', label: 'Kho / Nhà máy', type: 'single', options: whOpts,
      value: f.warehouseId, onChange: (v: string) => setF({ warehouseId: v, page: 1 }) },
    { key: 'status', label: 'Trạng thái', type: 'single',
      options: [{ value: 'OPEN', label: 'Đang đóng' }, { value: 'CLOSED', label: 'Đã đóng' }, { value: 'CANCELLED', label: 'Đã hủy' }],
      value: f.status, onChange: (v: string) => setF({ status: v, page: 1 }) },
    { key: 'machine', label: 'Máy', type: 'text', value: f.machine, placeholder: 'VD: M1',
      onChange: (v: string) => setF({ machine: v, page: 1 }) },
    { key: 'cycle', label: 'Chu kỳ', type: 'text', value: f.cycle, placeholder: 'VD: 55',
      onChange: (v: string) => setF({ cycle: v, page: 1 }) },
    // ĐỐI CHIẾU SX↔KHO (user 13/08): quét sổ = SX xác nhận pallet đã sinh; kho quét nhập = xác nhận lần 2
    { key: 'received', label: 'Kho nhận', type: 'single',
      options: [
        { value: 'YES', label: 'Kho đã nhận' },
        { value: 'NO', label: 'SX tạo — kho CHƯA nhận' },
        { value: 'DIFF', label: 'Đã nhận nhưng LỆCH số lượng' },
      ],
      value: f.received, onChange: (v: string) => setF({ received: v, page: 1 }) },
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
        'Tên hàng': r.material_code ? (matName.get(r.material_code) ?? '') : '',
        'Kho nhận lúc': r.received_at ? `${formatTimestampDate(r.received_at)} ${formatTimestampTime(r.received_at)}` : (r.status !== 'CANCELLED' ? 'CHƯA NHẬN' : ''),
        'SL kho nhập': r.received_qty ?? '',
        'Lệch SL': r.is_qty_diff ? 'LỆCH' : '',
        'Kho': r.warehouse_id ? (whName.get(r.warehouse_id) ?? '') : '',
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
          <ActionCluster mobileInline items={canExport ? [
            { key: 'export', icon: Download, label: 'Xuất Excel', tip: 'Xuất sổ pallet theo bộ lọc', onClick: exportExcel, disabled: !rows.length, busy: exporting, mobileHidden: true } satisfies ActionItem,
          ] : []} />
        </div>
        <div className="hidden sm:flex"><FilterBar defs={filterDefs} /></div>
      </div>

      <SummaryBand tiles={[
        { label: 'Đang mở', value: openCount.toLocaleString('vi-VN'), accent: openCount > 0 },
        { label: 'Dòng sổ (bộ lọc)', value: total.toLocaleString('vi-VN') },
        { label: 'Kho đã nhận', value: (data?.received_count ?? 0).toLocaleString('vi-VN') },
        { label: 'Chưa nhận (SX đã tạo)', value: (data?.missing_count ?? 0).toLocaleString('vi-VN'), accent: (data?.missing_count ?? 0) > 0 },
        { label: 'Lệch SL sổ ↔ kho', value: (data?.diff_count ?? 0).toLocaleString('vi-VN'), accent: (data?.diff_count ?? 0) > 0 },
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
                {/* Thao tác Ở ĐẦU row + sticky (user chốt 12/08) */}
                <TableCell className="px-2 py-1 whitespace-nowrap sticky left-0 z-10 bg-white">
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
                <TableCell className="px-2 py-1 whitespace-nowrap">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full no-underline ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono truncate" title={r.pallet_code}>{r.pallet_code}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap font-mono font-semibold">{r.material_code ?? '—'}</TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.material_code ? matName.get(r.material_code) ?? '' : ''}>
                  {r.material_code ? (matName.get(r.material_code) ?? <span className="text-slate-300">—</span>) : <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap">
                  {r.received_at ? (
                    r.is_qty_diff ? (
                      <span className="text-red-600 font-semibold no-underline" title={`Kho nhập ${Number(r.received_qty ?? 0).toLocaleString('vi-VN')} thùng ≠ sổ ghi ${Number(r.qty_cartons ?? 0).toLocaleString('vi-VN')} — đối chiếu với xưởng`}>
                        <AlertTriangle className="inline h-3 w-3 mr-0.5 -mt-0.5" />lệch: kho {Number(r.received_qty ?? 0).toLocaleString('vi-VN')}
                      </span>
                    ) : (
                      <span className="text-green-700 no-underline" title={`Kho quét nhập lúc ${formatTimestampDate(r.received_at)} ${formatTimestampTime(r.received_at)}${r.received_qty != null ? ` — ${Number(r.received_qty).toLocaleString('vi-VN')} thùng` : ''}`}>
                        <Check className="inline h-3 w-3 mr-0.5 -mt-0.5" />{formatTimestampDate(r.received_at, true)} {formatTimestampTime(r.received_at).slice(0, 5)}
                      </span>
                    )
                  ) : r.status !== 'CANCELLED' ? (
                    <span className="text-amber-600 no-underline" title="SX đã ghi sổ pallet này nhưng kho CHƯA quét nhập">chưa nhận</span>
                  ) : <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell className="px-2 py-1 text-[10px] whitespace-nowrap truncate" title={r.warehouse_id ? whName.get(r.warehouse_id) ?? '' : ''}>
                  {r.warehouse_id ? (whName.get(r.warehouse_id) ?? '—') : <span className="text-slate-300">—</span>}
                </TableCell>
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
                  ) : r.status !== 'CANCELLED' && canEdit ? (
                    <button type="button" title="Thêm giờ SX thùng đầu/cuối" onClick={e => { e.stopPropagation(); onEdit(r) }}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-slate-300 text-slate-400 hover:text-sky-700 hover:border-sky-300 no-underline">
                      <Plus className="h-3 w-3" /> thêm giờ
                    </button>
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
