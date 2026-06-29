import { Fragment, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode, Printer, Trash2, AlertTriangle, History, X, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { QRScanner } from '@/components/shared/QRScanner'
import { useColumnResize } from '@/components/shared/useColumnResize'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SummaryBand } from '@/components/shared/SummaryBand'
import {
  useWarehouses, useWarehouseTypes, useMaterials, useInventoryEntries, useInventoryFacets,
  useLogPalletPrints, usePalletPrints, type PalletPrintRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
import { effCartonsPerPallet } from '@/utils/palletCalc'
import type { Material } from '@/types'

// ─── Label data ───────────────────────────────────────────────
type LabelData = {
  key: string
  qr: string            // chuỗi QR — PHẢI khớp parseInboundQR: ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX
  dateDisplay: string   // dd/MM/yyyy
  materialCode: string
  materialId?: string
  nmsx: string
  category: string      // Loại hàng (Thành phẩm / POSM / Thùng / Giấy…)
  fullName: string
  shortName: string
  qty: number | ''
  cycle: string
  machine: string
  seq: string           // "001"
}

type WarehouseLite = { id: string; code: string; name: string; warehouse_type?: string | null; nmsx_code?: string | null }

// ddmmyy từ yyyy-mm-dd
function toDdmmyy(iso: string): string {
  if (!iso || iso.length < 10) return ''
  const [y, m, d] = iso.split('-')
  return `${d}${m}${y.slice(2)}`
}
function toDisplayDate(iso: string): string {
  if (!iso || iso.length < 10) return iso
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
// Loại bỏ ký tự phá format QR (dấu _ và khoảng trắng)
const clean = (s: string) => (s ?? '').trim().replace(/[_\s]+/g, '')

// Chuỗi QR khớp 100% backend parseInboundQR (6 phần ngăn bởi _)
function buildQR(p: { ddmmyy: string; code: string; cycle: string; machine: string; seq: string; nmsx: string }): string {
  return [p.ddmmyy, clean(p.code), clean(p.cycle), clean(p.machine), p.seq, clean(p.nmsx)].join('_')
}

// ─── QR ảnh (dataURL — in ổn định) ────────────────────────────
function QRImg({ value, px = 320 }: { value: string; px?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { margin: 0, width: px, errorCorrectionLevel: 'M' })
      .then(d => { if (alive) setSrc(d) })
      .catch(() => { if (alive) setSrc('') })
    return () => { alive = false }
  }, [value, px])
  return src ? <img src={src} alt={value} className="h-full w-full object-contain" /> : <div className="h-full w-full bg-slate-100" />
}

// ─── 1 tem (1/4 A4 = 105mm × 148.5mm) ─────────────────────────
function PalletLabel({ d }: { d: LabelData }) {
  return (
    <div className="pl-label flex flex-col border border-dashed border-slate-300 p-[3.5mm] overflow-hidden">
      {/* QR — chiếm phần lớn (hút khoảng trống thừa), căn giữa */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="h-[88mm] w-[88mm] max-h-full max-w-full"><QRImg value={d.qr} px={520} /></div>
      </div>

      {/* Thông tin — 2 cột, gọn sát (không stretch) */}
      <div className="mt-[1mm] shrink-0 flex flex-col text-[9.5pt] leading-[1.25] text-black border-t border-black pt-[1mm]">
        <div className="grid grid-cols-2 gap-x-[3mm]">
          <div className="space-y-[0.8mm] min-w-0">
            <p className="truncate"><span className="font-semibold">Ngày</span>: {d.dateDisplay}</p>
            <p className="truncate"><span className="font-semibold">Mã</span>: {d.materialCode}</p>
            <p className="truncate"><span className="font-semibold">NMSX</span>: {d.nmsx || '—'}</p>
            <p className="truncate"><span className="font-semibold">Số lượng</span>: {d.qty === '' ? '……' : d.qty}</p>
          </div>
          <div className="space-y-[0.8mm] min-w-0">
            <p className="truncate"><span className="font-semibold">Loại hàng</span>: {d.category || '—'}</p>
            <p className="line-clamp-3"><span className="font-semibold">Tên gói tắt</span>: {d.shortName || '—'}</p>
          </div>
        </div>
        {/* Thời gian — chừa chỗ viết tay */}
        <div className="mt-[1mm] border-t border-dashed border-slate-400 pt-[1.2mm] text-[10pt]">
          <p className="flex items-end gap-1">Thời gian từ
            <span className="inline-block flex-1 border-b border-black" />đến
            <span className="inline-block flex-1 border-b border-black" />
          </p>
          <p className="mt-[2mm] flex items-end gap-1"><span className="font-semibold">Kiểm tra</span>:
            <span className="inline-block flex-1 border-b border-black" />
          </p>
        </div>
      </div>

      {/* Footer lớn — 3 cột tiêu đề + giá trị to để nhận diện từ xa */}
      <div className="mt-[1.5mm] grid grid-cols-3 shrink-0 border-t-2 border-black text-center">
        <div className="border-r border-black">
          <div className="text-[8pt] font-semibold leading-tight">Chu kỳ</div>
          <div className="text-[24pt] font-bold leading-none">{d.cycle || '—'}</div>
        </div>
        <div className="border-r border-black">
          <div className="text-[8pt] font-semibold leading-tight">Máy</div>
          <div className="text-[24pt] font-bold leading-none">{d.machine || '—'}</div>
        </div>
        <div>
          <div className="text-[8pt] font-semibold leading-tight">Số pallet</div>
          <div className="text-[24pt] font-bold leading-none">{Number(d.seq) || d.seq}</div>
        </div>
      </div>
    </div>
  )
}

const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

// ─── Material combobox (lọc theo Loại hàng nếu có) ─────────────
function MatPicker({ value, label, category, onPick }: {
  value: string; label: string; category?: string; onPick: (m: Material | null) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const enabled = q.length > 1 || !!category
  const { data: mats = [] } = useMaterials({ search: q.length > 1 ? q : undefined, category: category || undefined }, enabled)
  const showList = open && enabled && mats.length > 0
  return (
    <div className="relative">
      <Input
        className="h-8 text-sm"
        placeholder={category ? `Mã / tên hàng (${category})…` : 'Tìm mã / tên hàng…'}
        value={open ? q : (value ? `${value} — ${label}` : q)}
        onChange={e => { setQ(e.target.value); setOpen(true); onPick(null) }}
        onFocus={() => { setQ(''); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {showList && (
        <div className="absolute z-50 mt-0.5 w-full max-h-56 overflow-y-auto rounded-md border bg-white shadow-lg">
          {(mats as Material[]).slice(0, 50).map(m => (
            <button key={m.id} type="button"
              onMouseDown={() => { onPick(m); setOpen(false) }}
              className="flex w-full items-center gap-2 border-b border-slate-50 px-2.5 py-1.5 text-left last:border-0 hover:bg-blue-50">
              <span className="font-mono text-xs font-semibold shrink-0">{m.material_code}</span>
              <span className="text-[11px] text-slate-500 truncate">{m.short_name ?? m.material_description}</span>
              {m.category && <span className="ml-auto shrink-0 text-[9px] text-slate-400">{m.category}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PalletLabels() {
  const user  = useAuthStore(s => s.user)
  const perms = user?.module_permissions as ModulePermissions | null ?? null
  const canGenerate = can(perms, 'pallet_print', 'generate')   // sinh tem mới
  const canReprint  = can(perms, 'pallet_print', 'reprint')    // in lại (tồn kho / lịch sử)
  const logPrints = useLogPalletPrints()

  const [tab, setTab] = useState<'generate' | 'reprint' | 'audit' | 'history'>('generate')
  const [scanFor, setScanFor] = useState<null | 'reprint' | 'audit'>(null)
  function handleScanned(code: string) {
    const c = code.trim()
    if (scanFor === 'audit') setAuQr(c)
    else setPalletQ(c)
    setScanFor(null)
  }
  // Giữ filter cũ qua localStorage (module nhiều field → dùng snapshot như TMSBookings)
  const SAVED = useMemo<Record<string, any>>(() => {
    try { return JSON.parse(localStorage.getItem('palletLabels_filters') || '{}') } catch { return {} }
  }, [])

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes = [] } = useWarehouseTypes()
  const categoryOpts = (whTypes as { value: string }[]).map(t => t.value)
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids) : null
  const whOptions = (warehouses as WarehouseLite[]).filter(w => !allowedWhIds || allowedWhIds.has(w.id))
  // NMSX = mã nmsx_code của kho tổng (B/D…) theo Cài đặt WMS → Kho. Chỉ kho có nmsx_code mới chọn được;
  // thêm "O — Gia công ngoài" (không thuộc kho nào) cho hàng gia công từ ngoài về.
  const nmsxOptions = (warehouses as WarehouseLite[]).filter(w => w.warehouse_type !== 'NPP' && !!(w.nmsx_code ?? '').trim())

  // ── Generate form ──
  const [genCat, setGenCat]   = useState<string>(SAVED.genCat ?? '')   // Loại hàng — lọc nhanh mã hàng
  const [mat, setMat]         = useState<Material | null>(null)
  const [prodDate, setProdDate] = useState(TODAY)
  const [cycle, setCycle]     = useState<string>(SAVED.cycle ?? '')
  const [machine, setMachine] = useState<string>(SAVED.machine ?? '')
  const [nmsx, setNmsx]       = useState<string>(SAVED.nmsx ?? '')
  const [seqStart, setSeqStart] = useState('1')
  const [count, setCount]     = useState('4')
  const [qty, setQty]         = useState('')

  // NMSX (nmsx_code kho tổng) → id kho để áp ngoại lệ Thùng/Pallet theo kho ('O' không có kho → null)
  const nmsxWarehouseId = nmsxOptions.find(w => (w.nmsx_code ?? '').trim() === nmsx)?.id ?? null
  // Số lượng auto theo định mức thùng/pallet (ngoại lệ theo kho NMSX nếu có) khi chọn mã / đổi kho
  useEffect(() => {
    if (!mat) return
    const eff = effCartonsPerPallet(mat, nmsxWarehouseId)
    setQty(eff > 0 ? String(eff) : '')
  }, [mat, nmsxWarehouseId])

  const genReady = !!(mat && prodDate && cycle.trim() && machine.trim() && nmsx.trim())
  const genLabels: LabelData[] = useMemo(() => {
    if (tab !== 'generate' || !genReady || !mat) return []
    const ddmmyy = toDdmmyy(prodDate)
    const start  = parseInt(seqStart, 10) || 1
    const n      = Math.min(Math.max(parseInt(count, 10) || 0, 0), 200)
    const out: LabelData[] = []
    for (let i = 0; i < n; i++) {
      const seq = String(start + i)   // số thứ tự thuần (3 chứ không 003) — tránh 003≠3 khi tạo lại
      out.push({
        key: `gen-${seq}`,
        qr: buildQR({ ddmmyy, code: mat.material_code, cycle, machine, seq, nmsx }),
        dateDisplay: toDisplayDate(prodDate),
        materialCode: mat.material_code,
        materialId: mat.id,
        nmsx: clean(nmsx),
        category: mat.category ?? '',
        fullName: mat.material_description ?? '',
        shortName: mat.short_name ?? '',
        qty: qty === '' ? '' : Number(qty),
        cycle: clean(cycle),
        machine: clean(machine),
        seq,
      })
    }
    return out
  }, [tab, mat, prodDate, cycle, machine, nmsx, seqStart, count, qty])

  // F1 — cảnh báo trùng: QR sắp sinh đã có pallet trong tồn kho? (tránh in QR trùng pallet đang tồn)
  const genPrefix = genReady && mat ? `${toDdmmyy(prodDate)}_${clean(mat.material_code)}_${clean(cycle)}_${clean(machine)}_` : ''
  const { data: genDupData } = useInventoryEntries(
    { search: genPrefix, status: '', page: 1, limit: 500 },
    tab === 'generate' && genPrefix.length >= 3,
  )
  const genExistingCodes = useMemo(() => new Set((genDupData?.entries ?? []).map(e => e.pallet_code)), [genDupData])
  const genDupes = useMemo(() => genLabels.filter(l => genExistingCodes.has(l.qr)), [genLabels, genExistingCodes])

  function entryToLabel(e: any): LabelData {
    const pd: string | null = e.production_date ?? null
    const disp = pd ? toDisplayDate(pd.slice(0, 10)) : '—'
    // QR pallet: ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX → lấy đúng các phần từ chính mã QR
    const parts = String(e.pallet_code ?? '').split('_')
    return {
      key: e.pallet_code,
      qr: e.pallet_code,
      dateDisplay: disp,
      materialCode: e.material?.material_code ?? parts[1] ?? '',
      materialId: e.material?.id,
      nmsx: parts[5] ?? e.manufacturer?.code ?? '',
      category: e.material?.category ?? '',
      fullName: e.material?.material_description ?? e.material?.short_name ?? '',
      shortName: e.material?.short_name ?? '',
      qty: e.cartons_imported ?? '',
      cycle: e.cycle ?? parts[2] ?? '',
      machine: e.machine_code ?? parts[3] ?? '',
      seq: parts[4] ?? '',
    }
  }

  // ── In lại từ tồn kho — filter Kho/Loại hàng/Tên hàng/Chu kỳ/Máy → multi-select Mã pallet ──
  const [rpWh, setRpWh]             = useState<string>(SAVED.rpWh ?? (allowedWhIds ? [...allowedWhIds][0] : ''))
  const [rpCats, setRpCats]         = useState<string[]>(SAVED.rpCats ?? [])
  const [rpMatIds, setRpMatIds]     = useState<string[]>(SAVED.rpMatIds ?? [])
  const [rpCycles, setRpCycles]     = useState<string[]>(SAVED.rpCycles ?? [])
  const [rpMachines, setRpMachines] = useState<string[]>(SAVED.rpMachines ?? [])
  const [picked, setPicked]         = useState<Record<string, LabelData>>({})

  const rpFacets = useInventoryFacets({
    warehouse_ids: rpWh ? [rpWh] : undefined,
    categories: rpCats.length ? rpCats : undefined,
  }).data
  const { data: invData } = useInventoryEntries({
    warehouse_ids: rpWh ? [rpWh] : undefined,
    categories: rpCats.length ? rpCats : undefined,
    filter_material_ids: rpMatIds.length ? rpMatIds : undefined,
    filter_cycles: rpCycles.length ? rpCycles : undefined,
    filter_machines: rpMachines.length ? rpMachines : undefined,
    status: '', page: 1, limit: 500,
  })
  const invEntries = invData?.entries ?? []
  const invTotal = invData?.total ?? 0   // cảnh báo cụt nếu > số dòng tải (limit 500)
  const entryByCode = useMemo(() => {
    const m: Record<string, any> = {}
    for (const e of invEntries as any[]) m[e.pallet_code] = e
    return m
  }, [invEntries])
  const palletOptions = useMemo(() => (invEntries as any[]).map(e => ({ value: e.pallet_code, label: e.pallet_code })), [invEntries])

  function onPickCodes(codes: string[]) {
    setPicked(prev => {
      const next: Record<string, LabelData> = {}
      for (const c of codes) {
        const lbl = prev[c] ?? (entryByCode[c] ? entryToLabel(entryByCode[c]) : undefined)
        if (lbl) next[c] = lbl
      }
      return next
    })
  }
  function addByEntry(e: any) {
    setPicked(prev => ({ ...prev, [e.pallet_code]: entryToLabel(e) }))
  }
  // Quét / điền tay mã pallet (không phụ thuộc filter) — Enter để thêm
  const [palletQ, setPalletQ] = useState('')
  const { data: scanData } = useInventoryEntries({ search: palletQ.trim().length >= 3 ? palletQ.trim() : undefined, status: '', page: 1, limit: 10 })
  const scanEntries = (palletQ.trim().length >= 3 ? scanData?.entries ?? [] : []) as any[]
  function onScanEnter(ev: React.KeyboardEvent) {
    if (ev.key !== 'Enter') return
    const code = palletQ.trim()
    const hit = scanEntries.find(e => e.pallet_code === code) ?? (scanEntries.length === 1 ? scanEntries[0] : null)
    if (hit) { addByEntry(hit); setPalletQ('') }
  }
  // Cảnh báo IN LẠI: pallet đã chọn nào từng được in trước đó (tránh in trùng tem)
  const pickedCodes = Object.keys(picked)
  const { data: rpPrintLog = [] } = usePalletPrints({ qr_codes: pickedCodes.join(',') }, tab === 'reprint' && pickedCodes.length > 0)
  const rpPrintCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rpPrintLog) m.set(r.qr_code, (m.get(r.qr_code) ?? 0) + 1)
    return m
  }, [rpPrintLog])
  const rpAlreadyPrinted = pickedCodes.filter(c => (rpPrintCount.get(c) ?? 0) > 0)

  // ── Truy cứu — BASE = TỒN KHO (LEFT JOIN số lần in); pallet chưa in vẫn hiện count 0 ──
  const [auWh, setAuWh]             = useState<string>(SAVED.auWh ?? (allowedWhIds ? [...allowedWhIds][0] : ''))
  const [auCats, setAuCats]         = useState<string[]>(SAVED.auCats ?? [])
  const [auMatIds, setAuMatIds]     = useState<string[]>(SAVED.auMatIds ?? [])
  const [auCycles, setAuCycles]     = useState<string[]>(SAVED.auCycles ?? [])
  const [auMachines, setAuMachines] = useState<string[]>(SAVED.auMachines ?? [])
  const [auQr, setAuQr]             = useState('')   // quét/điền tay mã pallet
  const [auOpen, setAuOpen]         = useState<string | null>(null)

  // Cần đủ Kho + Loại hàng + Tên hàng + Chu kỳ HOẶC quét/nhập mã pallet mới truy vấn (data lớn)
  const auReady = !!(auQr.trim() || (auWh && auCats.length && auMatIds.length && auCycles.length))
  const auFacets = useInventoryFacets({
    warehouse_ids: auWh ? [auWh] : undefined,
    categories: auCats.length ? auCats : undefined,
  }).data

  // (1) Lấy pallet THẬT từ tồn kho theo filter
  const { data: auInvData } = useInventoryEntries({
    warehouse_ids: auWh ? [auWh] : undefined,
    categories: auCats.length ? auCats : undefined,
    filter_material_ids: auMatIds.length ? auMatIds : undefined,
    filter_cycles: auCycles.length ? auCycles : undefined,
    filter_machines: auMachines.length ? auMachines : undefined,
    search: auQr.trim().length >= 3 ? auQr.trim() : undefined,
    status: '', page: 1, limit: 500,
  }, tab === 'audit' && auReady)
  // Gate theo auReady: query này dùng CHUNG cache key với tab In lại khi filter rỗng
  // (cùng params {status:'',page:1,limit:500}) → enabled:false vẫn đọc ké cache → phải chặn ở đây
  const auPallets = (auReady ? (auInvData?.entries ?? []) : []) as any[]
  const auTotal = auReady ? (auInvData?.total ?? 0) : 0   // cảnh báo cụt nếu > số dòng tải

  // (2) Lấy log in cho đúng tập mã pallet đó → ghép số lần in (0 nếu chưa in)
  const auCodes = useMemo(() => auPallets.map(e => e.pallet_code), [auPallets])
  const { data: auEvents = [] } = usePalletPrints(
    { qr_codes: auCodes.join(',') },
    tab === 'audit' && auReady && auCodes.length > 0,
  )
  const auEventMap = useMemo(() => {
    const m = new Map<string, PalletPrintRow[]>()
    for (const r of auEvents) { const a = m.get(r.qr_code) ?? []; a.push(r); m.set(r.qr_code, a) }
    return m
  }, [auEvents])

  const auditSummary = useMemo(() => auPallets.map(e => {
    const parts = String(e.pallet_code).split('_')
    const events = (auEventMap.get(e.pallet_code) ?? []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
    return {
      qr: e.pallet_code as string,
      material_code: e.material?.material_code ?? parts[1] ?? null,
      short_name: (e.material?.short_name ?? null) as string | null,
      category: (e.material?.category ?? null) as string | null,
      nmsx: (parts[5] ?? e.manufacturer?.code ?? null) as string | null,
      cycle: (e.cycle ?? parts[2] ?? null) as string | null,
      machine: (e.machine_code ?? parts[3] ?? null) as string | null,
      production_date: (e.production_date ?? null) as string | null,
      import_date: (e.import_date ?? null) as string | null,
      imported_by: (e.created_by_emp?.name ?? null) as string | null,
      location: (e.location ? `${e.location.location_code}-${e.location.sub_code}` : null) as string | null,
      cartons_imported: (e.cartons_imported ?? null) as number | null,
      cartons_remaining: (e.cartons_remaining ?? null) as number | null,
      count: events.length,
      last: events[0]?.created_at ?? '',
      events,
    }
  }), [auPallets, auEventMap])

  // Lưu snapshot filter để giữ qua lần sau
  useEffect(() => {
    try {
      localStorage.setItem('palletLabels_filters', JSON.stringify({
        genCat, cycle, machine, nmsx,
        rpWh, rpCats, rpMatIds, rpCycles, rpMachines,
        auWh, auCats, auMatIds, auCycles, auMachines,
      }))
    } catch { /* ignore */ }
  }, [genCat, cycle, machine, nmsx, rpWh, rpCats, rpMatIds, rpCycles, rpMachines, auWh, auCats, auMatIds, auCycles, auMachines])

  const labels = tab === 'generate' ? genLabels : tab === 'reprint' ? Object.values(picked) : []

  // ── In: tách vùng IN (printLabels) khỏi preview → in lại từ Lịch sử không cần preview ──
  const [printLabels, setPrintLabels] = useState<LabelData[]>([])
  const chunk4 = (arr: LabelData[]) => { const s: LabelData[][] = []; for (let i = 0; i < arr.length; i += 4) s.push(arr.slice(i, i + 4)); return s }
  const sheets = useMemo(() => chunk4(labels), [labels])                 // preview generate/reprint
  const printSheets = useMemo(() => chunk4(printLabels), [printLabels])  // vùng in thật (ẩn off-screen)

  function doPrint(mode: 'GENERATE' | 'REPRINT', items: LabelData[]) {
    if (!items.length) return
    // Ghi log truy vết (in mấy lần, ai in) — không chặn việc in nếu log lỗi
    logPrints.mutate({
      mode,
      labels: items.map(l => ({
        qr_code: l.qr, material_code: l.materialCode, material_id: l.materialId ?? null,
        category: l.category, cycle: l.cycle, machine: l.machine, seq: l.seq, nmsx: l.nmsx,
        qty: l.qty === '' ? null : l.qty,
      })),
    })
    setPrintLabels(items)
    setTimeout(() => window.print(), 150)
  }
  function handlePrint() { doPrint(tab === 'reprint' ? 'REPRINT' : 'GENERATE', labels) }

  // ── Lịch sử in — gom các tem theo batch_id (1 lệnh in) ──
  const [histOpen, setHistOpen] = useState<Set<string>>(new Set())   // nhiều phiếu mở cùng lúc → tích tem chéo phiếu
  const toggleHistOpen = (key: string) => setHistOpen(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const [histFrom, setHistFrom] = useState('')
  const [histTo, setHistTo]     = useState('')
  const [histMode, setHistMode] = useState<string[]>([])
  const [histMats, setHistMats] = useState<string[]>([])
  const [histCycles, setHistCycles]   = useState<string[]>([])
  const [histMachines, setHistMachines] = useState<string[]>([])
  const [histBy, setHistBy]     = useState<string[]>([])
  const { data: allMats = [] } = useMaterials(undefined, tab === 'history')
  const matByCode = useMemo(() => {
    const m = new Map<string, Material>()
    for (const x of allMats as Material[]) m.set(x.material_code, x)
    return m
  }, [allMats])
  const { data: histRows = [] } = usePalletPrints({ date_from: histFrom || undefined, date_to: histTo || undefined }, tab === 'history')
  const histMatOpts = useMemo(() => [...new Set(histRows.map(r => r.material_code).filter((x): x is string => !!x))]
    .map(c => ({ value: c, label: matByCode.get(c)?.short_name ? `${c} – ${matByCode.get(c)!.short_name}` : c })), [histRows, matByCode])
  const histByOpts = useMemo(() => [...new Set(histRows.map(r => r.printed_by_name).filter((x): x is string => !!x))].map(n => ({ value: n, label: n })), [histRows])
  const histCycleOpts = useMemo(() => [...new Set(histRows.map(r => r.cycle).filter((x): x is string => !!x))].map(c => ({ value: c, label: c })), [histRows])
  const histMachineOpts = useMemo(() => [...new Set(histRows.map(r => r.machine).filter((x): x is string => !!x))].map(m => ({ value: m, label: m })), [histRows])
  const histFiltered = useMemo(() => histRows.filter(r =>
    (!histMode.length || histMode.includes(r.mode)) &&
    (!histMats.length || (r.material_code != null && histMats.includes(r.material_code))) &&
    (!histCycles.length || (r.cycle != null && histCycles.includes(r.cycle))) &&
    (!histMachines.length || (r.machine != null && histMachines.includes(r.machine))) &&
    (!histBy.length || (r.printed_by_name != null && histBy.includes(r.printed_by_name)))
  ), [histRows, histMode, histMats, histCycles, histMachines, histBy])
  const histBatches = useMemo(() => {
    const m = new Map<string, { key: string; at: string; mode: string; by: string | null; rows: PalletPrintRow[] }>()
    for (const r of histFiltered) {
      // Có batch_id thì gom theo batch; chưa có (log cũ) → gom theo created_at+mode+người in
      // (mọi tem trong 1 lần bấm In chia sẻ cùng created_at vì backend set 1 lần)
      const key = r.batch_id ?? `${r.created_at}|${r.mode}|${r.printed_by_name ?? ''}`
      const g = m.get(key)
      if (g) { g.rows.push(r); if (r.created_at > g.at) g.at = r.created_at }
      else m.set(key, { key, at: r.created_at, mode: r.mode, by: r.printed_by_name, rows: [r] })
    }
    return [...m.values()].sort((a, b) => b.at.localeCompare(a.at))
  }, [histFiltered])

  function logRowToLabel(r: PalletPrintRow): LabelData {
    const parts = String(r.qr_code).split('_')
    const ddmmyy = parts[0] ?? ''
    const iso = ddmmyy.length === 6 ? `20${ddmmyy.slice(4, 6)}-${ddmmyy.slice(2, 4)}-${ddmmyy.slice(0, 2)}` : ''
    const mat = r.material_code ? matByCode.get(r.material_code) : undefined
    return {
      key: r.qr_code, qr: r.qr_code,
      dateDisplay: iso ? toDisplayDate(iso) : '—',
      materialCode: r.material_code ?? parts[1] ?? '',
      materialId: mat?.id,
      nmsx: r.nmsx ?? parts[5] ?? '',
      category: r.category ?? mat?.category ?? '',
      fullName: mat?.material_description ?? '',
      shortName: mat?.short_name ?? '',
      qty: r.qty ?? '',
      cycle: r.cycle ?? parts[2] ?? '',
      machine: r.machine ?? parts[3] ?? '',
      seq: r.seq ?? parts[4] ?? '',
    }
  }
  // Chọn in lại: 1 LỆNH GOM (single) HOẶC nhiều TEM — loại trừ lẫn nhau
  const [histSelBatch, setHistSelBatch] = useState<string | null>(null)
  const [histSelTems, setHistSelTems]   = useState<Set<string>>(new Set())
  const selectHistBatch = (key: string) => { setHistSelBatch(p => (p === key ? null : key)); setHistSelTems(new Set()) }
  const toggleHistTem   = (id: string)  => { setHistSelTems(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }); setHistSelBatch(null) }
  const clearHistSel = () => { setHistSelBatch(null); setHistSelTems(new Set()) }
  const histSelBatchRows = histBatches.find(b => b.key === histSelBatch)?.rows ?? []
  const histSelTemRows   = histBatches.flatMap(b => b.rows).filter(r => histSelTems.has(r.id))
  function reprintRows(rows: PalletPrintRow[]) {
    if (!rows.length) return
    doPrint('REPRINT', rows.map(logRowToLabel))
    clearHistSel()
  }
  // Kéo giãn cột (chuẩn Manhattan table-format)
  const histCols = useColumnResize('palletHistory_col_widths', [150, 78, 58, 104, 150, 60, 56, 100])
  const auCols   = useColumnResize('palletAudit_col_widths',   [190, 100, 88, 56, 56, 56, 92, 110, 72, 132])

  return (
    <div className="flex flex-col h-full sm:p-3">
      {/* CSS in: chỉ in vùng .pl-print-area, mỗi tem 1/4 A4 */}
      <style>{`
        .pl-label { width: 105mm; height: 148.5mm; box-sizing: border-box; }
        .pl-sheet { box-sizing: border-box; }
        /* Vùng in ẩn off-screen khi xem màn hình; @media print kéo về (0,0) */
        .pl-print-area { position: absolute; left: -99999px; top: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; }
          body * { visibility: hidden !important; }
          .pl-print-area, .pl-print-area * { visibility: visible !important; }
          .pl-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 210mm; margin: 0 !important; padding: 0 !important; }
          .pl-print-area > * { margin: 0 !important; }
          .pl-sheet { width: 210mm; height: 297mm; box-shadow: none !important; overflow: hidden; page-break-after: always; break-after: page; }
          .pl-sheet:last-child { page-break-after: auto; break-after: auto; }
          .pl-label { border-style: solid !important; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      {/* Quét QR mã pallet */}
      <Dialog open={scanFor !== null} onOpenChange={o => { if (!o) setScanFor(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm flex items-center gap-2"><QrCode className="h-4 w-4" />Quét QR mã pallet</DialogTitle></DialogHeader>
          {scanFor !== null && <QRScanner onScan={handleScanned} onClose={() => setScanFor(null)} />}
        </DialogContent>
      </Dialog>

     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
            <QrCode className="h-4 w-4 text-slate-500" /> In tem pallet
          </span>
          <div className="flex rounded-lg border border-slate-200 overflow-x-auto text-xs font-medium max-w-full [&>button]:shrink-0 [&>button]:whitespace-nowrap">
            <button onClick={() => setTab('generate')}
              className={`px-3 py-1 transition-colors ${tab === 'generate' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Sinh tem mới</button>
            <button onClick={() => setTab('history')}
              className={`px-3 py-1 border-l border-slate-200 transition-colors inline-flex items-center gap-1 ${tab === 'history' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Printer className="h-3 w-3" />Lịch sử in</button>
            <button onClick={() => setTab('reprint')}
              className={`px-3 py-1 border-l border-slate-200 transition-colors ${tab === 'reprint' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>In lại từ tồn kho</button>
            <button onClick={() => setTab('audit')}
              className={`px-3 py-1 border-l border-slate-200 transition-colors inline-flex items-center gap-1 ${tab === 'audit' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><History className="h-3 w-3" />Truy cứu</button>
          </div>
          <div className="flex-1" />
          {tab === 'generate' && canGenerate && (
            <Button size="sm" className="h-7 text-xs gap-1" disabled={!labels.length} onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5" /> In {labels.length > 0 ? `(${labels.length})` : ''}
            </Button>
          )}
          {tab === 'reprint' && canReprint && (
            <Button size="sm" className="h-7 text-xs gap-1" disabled={!labels.length} onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5" /> In lại {labels.length > 0 ? `(${labels.length})` : ''}
            </Button>
          )}
        </div>
      </div>

      {/* Summary band — theo tab */}
      <SummaryBand tiles={tab === 'audit'
        ? [
            { label: 'Số pallet', value: auditSummary.length, accent: auditSummary.length > 0 },
            { label: 'Chưa in', value: auditSummary.filter(g => g.count === 0).length },
            { label: 'Tổng lần in', value: auEvents.length },
            { label: 'In lại', value: auEvents.filter(r => r.mode === 'REPRINT').length },
          ]
        : tab === 'history'
        ? [
            { label: 'Số lệnh in', value: histBatches.length, accent: histBatches.length > 0 },
            { label: 'Tổng tem', value: histRows.length },
            { label: 'Sinh mới', value: histBatches.filter(b => b.mode !== 'REPRINT').length },
            { label: 'In lại', value: histBatches.filter(b => b.mode === 'REPRINT').length },
          ]
        : [
            { label: 'Số tem', value: labels.length, accent: labels.length > 0 },
            { label: 'Số trang A4', value: sheets.length },
            { label: 'Tem / trang', value: 4 },
            { label: 'Khổ', value: '1/4 A4' },
          ]} />

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* Bảng điều khiển trái — full-width trên mobile, cột 288px trên desktop */}
        <div className="w-full lg:w-72 lg:shrink-0 border-b lg:border-b-0 lg:border-r bg-white lg:overflow-y-auto p-3 space-y-3 no-print">
          {tab === 'generate' ? (
            /* Form gọn: gom 2–3 cột để vừa 1 màn, không phải kéo dọc */
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Loại hàng</Label>
                  <Select value={genCat || '__all__'} onValueChange={v => { setGenCat(v === '__all__' ? '' : v); setMat(null) }}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Tất cả loại" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Tất cả loại</SelectItem>
                      {categoryOpts.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ngày SX <span className="text-red-500">*</span></Label>
                  <Input type="date" className="h-8 text-sm" value={prodDate} onChange={e => setProdDate(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mã hàng <span className="text-red-500">*</span></Label>
                <MatPicker value={mat?.material_code ?? ''} label={mat?.short_name ?? mat?.material_description ?? ''} category={genCat} onPick={setMat} />
                {mat && <p className="text-[10px] text-slate-400">Loại: {mat.category ?? '—'} · Thùng/pallet: {mat.cartons_per_pallet ?? '—'}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Chu kỳ <span className="text-red-500">*</span></Label>
                  <Input className="h-8 text-sm" placeholder="C05" value={cycle} onChange={e => setCycle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Máy <span className="text-red-500">*</span></Label>
                  <Input className="h-8 text-sm" placeholder="M1" value={machine} onChange={e => setMachine(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">NMSX <span className="text-red-500">*</span></Label>
                <Select value={nmsx || '__none__'} onValueChange={v => setNmsx(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Chọn NMSX" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Không —</SelectItem>
                    {nmsxOptions.map(w => {
                      const code = (w.nmsx_code ?? '').trim()
                      return <SelectItem key={w.id} value={code}>{code}{w.name ? ` — ${w.name}` : ''}</SelectItem>
                    })}
                    <SelectItem value="O">O — Gia công ngoài</SelectItem>
                  </SelectContent>
                </Select>
                {nmsxOptions.length === 0 && (
                  <p className="text-[10px] text-amber-600">Chưa có kho tổng nào có mã NMSX — đặt ở Cài đặt WMS → Kho (ô "Mã NMSX").</p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Seq đầu</Label>
                  <Input type="number" min={1} className="h-8 text-sm" value={seqStart} onChange={e => setSeqStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Số pallet</Label>
                  <Input type="number" min={1} max={200} className="h-8 text-sm" value={count} onChange={e => setCount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">SL/pallet</Label>
                  <Input type="number" min={0} className="h-8 text-sm" value={qty} onChange={e => setQty(e.target.value)} />
                </div>
              </div>
              {!genReady && <p className="flex items-start gap-1 text-[11px] text-amber-600"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Chọn đủ Mã hàng, Chu kỳ, Máy, NMSX để sinh tem.</p>}
              {genReady && genDupes.length > 0 && (
                <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span><b>{genDupes.length}</b> tem trùng pallet đã có trong tồn kho (seq: {genDupes.map(d => d.seq).join(', ')}). In sẽ tạo QR trùng — đổi Seq bắt đầu để tránh.</span>
                </div>
              )}
            </div>
          ) : tab === 'reprint' ? (
            <>
              {/* Quét / điền tay mã pallet — thêm nhanh, không phụ thuộc filter */}
              <div className="space-y-1">
                <Label className="text-xs">Quét / nhập mã pallet</Label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                    <Input className="pl-7 h-8 text-sm" placeholder="Gõ mã rồi Enter, hoặc bấm quét →" value={palletQ} onChange={e => setPalletQ(e.target.value)} onKeyDown={onScanEnter} />
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 shrink-0" title="Quét QR" onClick={() => setScanFor('reprint')}>
                    <QrCode className="h-4 w-4" />
                  </Button>
                </div>
                {scanEntries.length > 0 && (
                  <div className="border rounded-md divide-y divide-slate-100 max-h-40 overflow-y-auto">
                    {scanEntries.slice(0, 10).map(e => (
                      <button key={e.id} type="button" onClick={() => { addByEntry(e); setPalletQ('') }}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${picked[e.pallet_code] ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                        <span className="font-mono text-[10px] font-semibold truncate flex-1">{e.pallet_code}</span>
                        <span className="text-[9px] text-slate-400 shrink-0">{e.material?.material_code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1 pt-1 border-t">
                <Label className="text-xs">Hoặc lọc rồi chọn nhiều</Label>
                <WarehouseSingleSelect warehouses={whOptions} value={rpWh} onChange={v => { setRpWh(v); setRpMatIds([]); setRpCycles([]); setRpMachines([]) }} allLabel="Tất cả kho" triggerClassName="h-8" />
              </div>
              {/* stack dọc, mỗi filter full-width → KHÔNG xê dịch khi chọn */}
              <div className="flex flex-col gap-2">
                <MultiSelectFilter label="Loại hàng" options={categoryOpts.map(c => ({ value: c, label: c }))} selected={rpCats} onChange={v => { setRpCats(v); setRpMatIds([]) }} searchable={false} width="w-full" />
                <MultiSelectFilter label="Tên hàng" options={(rpFacets?.materials ?? []).map((m: any) => ({ value: m.id, label: m.name ? `${m.code} – ${m.name}` : m.code }))} selected={rpMatIds} onChange={setRpMatIds} width="w-full" />
                <MultiSelectFilter label="Chu kỳ" options={(rpFacets?.cycles ?? []).map((c: string) => ({ value: c, label: c }))} selected={rpCycles} onChange={setRpCycles} searchable={(rpFacets?.cycles ?? []).length > 6} width="w-full" />
                <MultiSelectFilter label="Máy" options={(rpFacets?.machines ?? []).map((m: string) => ({ value: m, label: m }))} selected={rpMachines} onChange={setRpMachines} searchable={(rpFacets?.machines ?? []).length > 6} width="w-full" />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Mã pallet (chọn nhiều) — {invEntries.length}{invTotal > invEntries.length ? `/${invTotal}` : ''} kết quả</Label>
                {invTotal > invEntries.length && (
                  <p className="text-[10px] text-amber-600">Chỉ tải {invEntries.length}/{invTotal} pallet — lọc hẹp hơn (Chu kỳ/Máy/Tên hàng) để chọn đủ.</p>
                )}
                <MultiSelectFilter label="Chọn mã pallet" options={palletOptions} selected={Object.keys(picked)} onChange={onPickCodes} width="w-full" />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t">
                <span className="font-medium text-slate-700">Đã chọn: {Object.keys(picked).length}</span>
                {Object.keys(picked).length > 0 && (
                  <button onClick={() => setPicked({})} className="flex items-center gap-0.5 text-red-500 hover:text-red-700"><Trash2 className="h-3 w-3" />Bỏ hết</button>
                )}
              </div>
              {rpAlreadyPrinted.length > 0 && (
                <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span><b>{rpAlreadyPrinted.length}</b> pallet đã được in trước đó — in lại sẽ tạo tem trùng. Kiểm tra kỹ trước khi in.</span>
                </div>
              )}
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {Object.values(picked).map(l => {
                  const n = rpPrintCount.get(l.qr) ?? 0
                  return (
                  <div key={l.key} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
                    <span className="font-mono text-[10px] font-semibold truncate flex-1">{l.qr}</span>
                    {n > 0 && <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-700" title={`Đã in ${n} lần`}><AlertTriangle className="h-2.5 w-2.5" />đã in {n}</span>}
                    <button onClick={() => onPickCodes(Object.keys(picked).filter(c => c !== l.key))} className="text-slate-400 hover:text-red-500 shrink-0"><X className="h-3 w-3" /></button>
                  </div>
                  )
                })}
                {Object.keys(picked).length === 0 && <p className="text-[11px] text-slate-400">Chọn mã pallet ở trên để in lại.</p>}
              </div>
            </>
          ) : tab === 'audit' ? (
            /* Truy cứu — quét pallet + filter */
            <>
              <div className="space-y-1">
                <Label className="text-xs">Quét / nhập mã pallet</Label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                    <Input className="pl-7 h-8 text-sm" placeholder="Gõ mã pallet, hoặc bấm quét →" value={auQr} onChange={e => setAuQr(e.target.value)} />
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-8 px-2 shrink-0" title="Quét QR" onClick={() => setScanFor('audit')}>
                    <QrCode className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-slate-400">Tra riêng 1 pallet, hoặc lọc theo nhóm bên dưới.</p>
              </div>
              <div className="space-y-1 pt-1 border-t">
                <Label className="text-xs">Hoặc lọc theo nhóm</Label>
                <WarehouseSingleSelect warehouses={whOptions} value={auWh} onChange={v => { setAuWh(v); setAuMatIds([]); setAuCycles([]); setAuMachines([]) }} allLabel="Chọn kho" triggerClassName="h-8" />
              </div>
              <div className="flex flex-col gap-2">
                <MultiSelectFilter label="Loại hàng" options={categoryOpts.map(c => ({ value: c, label: c }))} selected={auCats} onChange={v => { setAuCats(v); setAuMatIds([]) }} searchable={false} width="w-full" />
                <MultiSelectFilter label="Tên hàng" options={(auFacets?.materials ?? []).map((m: any) => ({ value: m.id, label: m.name ? `${m.code} – ${m.name}` : m.code }))} selected={auMatIds} onChange={setAuMatIds} width="w-full" />
                <MultiSelectFilter label="Chu kỳ" options={(auFacets?.cycles ?? []).map((c: string) => ({ value: c, label: c }))} selected={auCycles} onChange={setAuCycles} searchable={(auFacets?.cycles ?? []).length > 6} width="w-full" />
                <MultiSelectFilter label="Máy" options={(auFacets?.machines ?? []).map((m: string) => ({ value: m, label: m }))} selected={auMachines} onChange={setAuMachines} searchable={(auFacets?.machines ?? []).length > 6} width="w-full" />
              </div>
              <p className={`text-[10px] ${auReady ? 'text-slate-400' : 'text-amber-600'}`}>
                {auReady
                  ? 'Pallet chưa in vẫn hiện với số lần = 0. Bấm 1 dòng để xem ai in, lúc nào.'
                  : 'Chọn đủ Kho + Loại hàng + Tên hàng + Chu kỳ (hoặc quét/nhập mã pallet) mới truy vấn — dữ liệu rất lớn.'}
              </p>
              {auReady && auTotal > auPallets.length && (
                <p className="text-[10px] text-amber-600">Chỉ tải {auPallets.length}/{auTotal} pallet — lọc hẹp hơn để tra đủ.</p>
              )}
            </>
          ) : (
            /* Lịch sử in — bộ lọc */
            <>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1"><Printer className="h-3.5 w-3.5 text-slate-400" />Lịch sử in</Label>
                <p className="text-[11px] text-slate-500">Mỗi dòng = 1 lệnh in. Bấm 1 dòng để xem các tem & chọn in lại.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Từ ngày</Label>
                <Input type="date" className="h-8 text-sm w-full" value={histFrom} max={histTo || undefined} onChange={e => setHistFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Đến ngày</Label>
                <Input type="date" className="h-8 text-sm w-full" value={histTo} min={histFrom || undefined} onChange={e => setHistTo(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <MultiSelectFilter label="Chế độ" options={[{ value: 'GENERATE', label: 'Sinh mới' }, { value: 'REPRINT', label: 'In lại' }]} selected={histMode} onChange={setHistMode} searchable={false} width="w-full" />
                <MultiSelectFilter label="Tên hàng" options={histMatOpts} selected={histMats} onChange={setHistMats} width="w-full" />
                <MultiSelectFilter label="Chu kỳ" options={histCycleOpts} selected={histCycles} onChange={setHistCycles} searchable={histCycleOpts.length > 6} width="w-full" />
                <MultiSelectFilter label="Máy" options={histMachineOpts} selected={histMachines} onChange={setHistMachines} searchable={histMachineOpts.length > 6} width="w-full" />
                <MultiSelectFilter label="Người in" options={histByOpts} selected={histBy} onChange={setHistBy} searchable={histByOpts.length > 6} width="w-full" />
              </div>
              {(!!histFrom || !!histTo || histMode.length > 0 || histMats.length > 0 || histCycles.length > 0 || histMachines.length > 0 || histBy.length > 0) && (
                <button onClick={() => { setHistFrom(''); setHistTo(''); setHistMode([]); setHistMats([]); setHistCycles([]); setHistMachines([]); setHistBy([]) }} className="text-[11px] text-red-500 hover:text-red-700">Xóa lọc</button>
              )}
              {!canReprint && <p className="text-[10px] text-amber-600">Bạn không có quyền in lại — chỉ xem được lịch sử.</p>}
            </>
          )}
        </div>

        {/* Vùng phải: preview in (generate/reprint) HOẶC bảng truy cứu */}
        {tab === 'audit' ? (
          <div className="lg:flex-1 min-h-[55vh] lg:min-h-0 overflow-auto">
            <table className="text-[10px] border-collapse table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: auCols.totalWidth, minWidth: '100%' }}>
              <colgroup>{auCols.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
              <thead>
                <tr className="text-left text-[9px] font-medium text-slate-500">
                  {['Mã pallet (QR)', 'Mã hàng', 'Loại', 'NMSX', 'Chu kỳ', 'Máy', 'Ngày nhập', 'Người nhập', 'Số lần in', 'Lần in gần nhất'].map((h, i) => (
                    <th key={i} className={`sticky top-0 bg-slate-50 px-2 py-1.5 whitespace-nowrap ${i === 0 ? 'left-0 z-20' : 'z-10'} ${i === 8 ? 'text-right' : ''}`}>
                      {h}
                      <span onPointerDown={e => auCols.startResize(i, e)} className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!auReady ? (
                  <tr><td colSpan={10} className="px-2 py-10 text-center text-slate-400">Chọn đủ <b>Kho + Loại hàng + Tên hàng + Chu kỳ</b> hoặc quét/nhập mã pallet để tra cứu</td></tr>
                ) : auditSummary.length === 0 ? (
                  <tr><td colSpan={10} className="px-2 py-10 text-center text-slate-400">Không có pallet nào khớp trong tồn kho</td></tr>
                ) : auditSummary.map(g => (
                  <Fragment key={g.qr}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setAuOpen(auOpen === g.qr ? null : g.qr)}>
                      <td className="px-2 py-1 font-mono font-semibold text-blue-600 whitespace-nowrap sticky left-0 z-10 bg-white">{g.qr}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{g.material_code ?? '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{g.category ?? '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{g.nmsx ?? '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{g.cycle ?? '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{g.machine ?? '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{g.import_date ? formatTimestampDate(g.import_date, true) : '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{g.imported_by ?? '—'}</td>
                      <td className={`px-2 py-1 text-right tabular-nums font-bold whitespace-nowrap ${g.count === 0 ? 'text-slate-300' : g.count > 1 ? 'text-amber-600' : 'text-slate-700'}`}>{g.count}</td>
                      <td className="px-2 py-1 tabular-nums whitespace-nowrap">
                        {g.count === 0 ? <span className="text-slate-400">Chưa in</span> : <>{formatTimestampDate(g.last, true)} {formatTimestampTime(g.last)}</>}
                      </td>
                    </tr>
                    {auOpen === g.qr && (
                      <tr>
                        <td colSpan={10} className="bg-white px-0 py-0">
                          {/* Detail kiểu Manhattan — section-band */}
                          <div className="border-y border-slate-200">
                            <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5">
                              <span className="h-3.5 w-1 rounded-full bg-sky-500" />
                              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Thông tin pallet (tồn kho)</h3>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 px-3 py-2 text-[10px]">
                              <div><span className="text-slate-400">Tên gói tắt:</span> <span className="font-medium">{g.short_name ?? '—'}</span></div>
                              <div><span className="text-slate-400">Ngày SX:</span> <span className="font-medium">{g.production_date ? formatTimestampDate(g.production_date, true) : '—'}</span></div>
                              <div><span className="text-slate-400">Ngày nhập:</span> <span className="font-medium">{g.import_date ? formatTimestampDate(g.import_date, true) : '—'}</span></div>
                              <div><span className="text-slate-400">Người nhập:</span> <span className="font-medium">{g.imported_by ?? '—'}</span></div>
                              <div><span className="text-slate-400">Vị trí:</span> <span className="font-mono font-medium">{g.location ?? '—'}</span></div>
                              <div><span className="text-slate-400">Nhập / Tồn:</span> <span className="font-medium tabular-nums">{g.cartons_imported ?? '—'} / {g.cartons_remaining ?? '—'} thùng</span></div>
                            </div>
                            <div className="px-3 py-1.5 bg-slate-100 border-y border-slate-200 flex items-center gap-1.5">
                              <span className="h-3.5 w-1 rounded-full bg-sky-500" />
                              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Lịch sử in — ai in, lúc nào</h3>
                              {g.count > 1 && <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-700"><AlertTriangle className="h-2.5 w-2.5" />Đã in lại {g.count - 1} lần</span>}
                            </div>
                            <div className="px-3 py-2">
                              {g.count === 0 ? (
                                <p className="text-[10px] text-slate-500">Pallet này <b>chưa được in lần nào</b>.</p>
                              ) : (
                                <div className="space-y-0.5">
                                  {g.events.map(ev => (
                                    <div key={ev.id} className="flex items-center gap-3 text-[10px]">
                                      <span className={`px-1.5 py-0.5 rounded-full ${ev.mode === 'REPRINT' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                                        {ev.mode === 'REPRINT' ? 'In lại' : 'Sinh mới'}
                                      </span>
                                      <span className="tabular-nums">{formatTimestampDate(ev.created_at, true)} {formatTimestampTime(ev.created_at)}</span>
                                      <span className="text-slate-500">· {ev.printed_by_name ?? '—'}</span>
                                      {ev.qty != null && <span className="text-slate-400">· {ev.qty} thùng</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : tab === 'history' ? (
          <div className="lg:flex-1 min-h-[55vh] lg:min-h-0 flex flex-col">
            {/* Action bar — LUÔN render (cao cố định) → click chọn KHÔNG làm resize bảng */}
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 min-h-[40px] py-1.5 flex-wrap">
              {!canReprint ? (
                <span className="text-[11px] text-slate-400">Bạn không có quyền in lại — chỉ xem lịch sử.</span>
              ) : histSelBatch ? (
                <>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={() => reprintRows(histSelBatchRows)}>
                    <Printer className="h-3.5 w-3.5" />In lại cả lệnh ({histSelBatchRows.length} tem)
                  </Button>
                  <button onClick={clearHistSel} className="text-[11px] text-slate-500 hover:text-slate-700">Bỏ chọn</button>
                </>
              ) : histSelTems.size > 0 ? (
                <>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={() => reprintRows(histSelTemRows)}>
                    <Printer className="h-3.5 w-3.5" />In lại {histSelTems.size} tem đã chọn
                  </Button>
                  <button onClick={clearHistSel} className="text-[11px] text-slate-500 hover:text-slate-700">Bỏ chọn</button>
                </>
              ) : (
                <span className="text-[11px] text-slate-400">Chọn <b>1 lệnh</b> (in cả lệnh) hoặc tích <b>nhiều tem</b> trong chi tiết (in từng tem) để in lại.</span>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
            <table className="text-[10px] border-collapse table-fixed [&_th]:border-r [&_th]:border-slate-200 [&_td]:border-r [&_td]:border-slate-100 [&_td]:overflow-hidden [&_th]:overflow-hidden" style={{ width: histCols.totalWidth + (canReprint ? 36 : 0), minWidth: '100%' }}>
              <colgroup>
                {canReprint && <col style={{ width: 36 }} />}
                {histCols.widths.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr className="text-left text-[9px] font-medium text-slate-500">
                  {canReprint && <th className="sticky top-0 left-0 z-20 bg-slate-50 px-2 py-1.5" />}
                  {['Thời gian in', 'Chế độ', 'Số tem', 'Mã hàng', 'Tên hàng', 'Chu kỳ', 'Máy', 'Người in'].map((h, i) => (
                    <th key={i} className={`sticky top-0 bg-slate-50 px-2 py-1.5 whitespace-nowrap ${i === 0 ? (canReprint ? 'z-20 left-[36px]' : 'z-20 left-0') : 'z-10'} ${i === 2 ? 'text-right' : ''}`}>
                      {h}
                      <span onPointerDown={e => histCols.startResize(i, e)} className="absolute top-0 right-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-400/70" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {histBatches.length === 0 ? (
                  <tr><td colSpan={canReprint ? 9 : 8} className="px-2 py-10 text-center text-slate-400">Chưa có lệnh in nào</td></tr>
                ) : histBatches.map(b => {
                  const mats  = [...new Set(b.rows.map(r => r.material_code).filter(Boolean))]
                  const names = [...new Set(b.rows.map(r => matByCode.get(r.material_code ?? '')?.short_name).filter(Boolean))]
                  const cycs  = [...new Set(b.rows.map(r => r.cycle).filter(Boolean))]
                  const macs  = [...new Set(b.rows.map(r => r.machine).filter(Boolean))]
                  const open  = histOpen.has(b.key)
                  const pinBg = histSelBatch === b.key ? 'bg-sky-50' : 'bg-white'
                  return (
                  <Fragment key={b.key}>
                    <tr className={`border-b border-slate-100 cursor-pointer ${histSelBatch === b.key ? 'bg-sky-50' : 'hover:bg-slate-50'}`} onClick={() => toggleHistOpen(b.key)}>
                      {canReprint && (
                        <td className={`px-2 py-1 text-center sticky left-0 z-10 ${pinBg}`} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" title="In lại cả lệnh này" checked={histSelBatch === b.key} onChange={() => selectHistBatch(b.key)} />
                        </td>
                      )}
                      <td className={`px-2 py-1 tabular-nums whitespace-nowrap sticky z-10 ${pinBg} ${canReprint ? 'left-[36px]' : 'left-0'}`}>{formatTimestampDate(b.at, true)} {formatTimestampTime(b.at)}</td>
                      <td className="px-2 py-1 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded-full text-[9px] ${b.mode === 'REPRINT' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>{b.mode === 'REPRINT' ? 'In lại' : 'Sinh mới'}</span></td>
                      <td className="px-2 py-1 text-right tabular-nums font-semibold whitespace-nowrap">{b.rows.length}</td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{mats.join(', ') || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap" title={names.join(', ')}>{names.join(', ') || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{cycs.join('/') || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{macs.join('/') || '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{b.by ?? '—'}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={canReprint ? 9 : 8} className="bg-white p-0">
                          <div className="border-y border-slate-200">
                            <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5">
                              <span className="h-3.5 w-1 rounded-full bg-sky-500" />
                              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Chi tiết {b.rows.length} tem — {b.mode === 'REPRINT' ? 'In lại' : 'Sinh mới'}</h3>
                              {canReprint && <span className="ml-auto text-[10px] font-normal normal-case text-slate-400">Tích nhiều tem (kể cả khác phiếu) để in lại riêng</span>}
                            </div>
                            <div className="px-3 py-2 space-y-0.5 max-h-60 overflow-auto">
                              {b.rows.map(r => (
                                <label key={r.id} className="flex items-center gap-2 text-[10px] cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5">
                                  {canReprint && <input type="checkbox" checked={histSelTems.has(r.id)} onChange={() => toggleHistTem(r.id)} />}
                                  <span className="font-mono font-semibold text-blue-600">{r.qr_code}</span>
                                  {r.qty != null && <span className="text-slate-400">· {r.qty} thùng</span>}
                                </label>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )})}
              </tbody>
            </table>
            </div>
          </div>
        ) : (
        <div className="lg:flex-1 min-h-[40vh] lg:min-h-0 overflow-auto bg-slate-100 p-2 sm:p-4">
          {labels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[30vh] text-slate-400">
              <QrCode className="h-10 w-10 opacity-30 mb-2" />
              <p className="text-sm text-center px-4">{tab === 'generate' ? 'Nhập thông tin để xem trước tem' : 'Chọn pallet để in lại tem'}</p>
            </div>
          ) : (
            <div className="mx-auto space-y-4">
              {sheets.map((sheet, si) => (
                <div key={si} className="pl-sheet mx-auto grid grid-cols-2 grid-rows-2 overflow-hidden bg-white shadow-sm" style={{ width: '210mm', height: '297mm' }}>
                  {sheet.map(d => <PalletLabel key={d.key} d={d} />)}
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
     </div>

      {/* Vùng IN thật — ẩn off-screen, chỉ hiện khi @media print (mọi tab, kể cả In lại từ Lịch sử) */}
      <div className="pl-print-area" aria-hidden>
        {printSheets.map((sheet, si) => (
          <div key={si} className="pl-sheet grid grid-cols-2 grid-rows-2 overflow-hidden bg-white" style={{ width: '210mm', height: '297mm' }}>
            {sheet.map(d => <PalletLabel key={d.key} d={d} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
