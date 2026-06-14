import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode, Printer, Trash2, AlertTriangle, History, X, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'
import { SummaryBand } from '@/components/shared/SummaryBand'
import {
  useWarehouses, useWarehouseTypes, useMaterials, useInventoryEntries, useInventoryFacets,
  useLogPalletPrints, usePalletPrints, type PalletPrintRow,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import { formatTimestampDate, formatTimestampTime } from '@/utils/formatters'
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
      {/* QR — ~60% diện tích tem, căn giữa */}
      <div className="flex justify-center items-center shrink-0 h-[60%]">
        <div className="h-[86mm] w-[86mm] max-h-full"><QRImg value={d.qr} px={520} /></div>
      </div>

      {/* Thông tin — 2 cột (40% còn lại) */}
      <div className="mt-[1mm] flex-1 min-h-0 flex flex-col text-[9.5pt] leading-[1.25] text-black border-t border-black pt-[1mm]">
        <div className="grid grid-cols-2 gap-x-[3mm] flex-1 min-h-0">
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
  const canPrint = can(perms, 'pallet_print', 'print')
  const printRef = useRef<HTMLDivElement>(null)
  const logPrints = useLogPalletPrints()

  const [tab, setTab] = useState<'generate' | 'reprint' | 'audit'>('generate')

  const { data: warehouses = [] } = useWarehouses(true)
  const { data: whTypes = [] } = useWarehouseTypes()
  const categoryOpts = (whTypes as { value: string }[]).map(t => t.value)
  const allowedWhIds = user?.warehouse_scope !== 'NATIONAL' && user?.warehouse_ids?.length
    ? new Set(user.warehouse_ids) : null
  const whOptions = (warehouses as any[]).filter(w => !allowedWhIds || allowedWhIds.has(w.id))
  // NMSX = mã kho tổng (warehouse_type CENTRAL) theo WMS Settings
  const nmsxOptions = (warehouses as any[]).filter(w => w.warehouse_type === 'CENTRAL')

  // ── Generate form ──
  const [genCat, setGenCat]   = useState('')   // Loại hàng — lọc nhanh mã hàng
  const [mat, setMat]         = useState<Material | null>(null)
  const [prodDate, setProdDate] = useState(TODAY)
  const [cycle, setCycle]     = useState('')
  const [machine, setMachine] = useState('')
  const [nmsx, setNmsx]       = useState('')
  const [seqStart, setSeqStart] = useState('1')
  const [count, setCount]     = useState('4')
  const [qty, setQty]         = useState('')

  // Số lượng auto theo định mức thùng/pallet khi chọn mã
  useEffect(() => {
    if (mat) setQty(mat.cartons_per_pallet != null ? String(mat.cartons_per_pallet) : '')
  }, [mat])

  const genReady = !!(mat && prodDate && cycle.trim() && machine.trim() && nmsx.trim())
  const genLabels: LabelData[] = useMemo(() => {
    if (tab !== 'generate' || !genReady || !mat) return []
    const ddmmyy = toDdmmyy(prodDate)
    const start  = parseInt(seqStart, 10) || 1
    const n      = Math.min(Math.max(parseInt(count, 10) || 0, 0), 200)
    const out: LabelData[] = []
    for (let i = 0; i < n; i++) {
      const seq = String(start + i).padStart(3, '0')
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

  function entryToLabel(e: any): LabelData {
    const pd: string | null = e.production_date ?? null
    const disp = pd ? toDisplayDate(pd.slice(0, 10)) : '—'
    return {
      key: e.pallet_code,
      qr: e.pallet_code,
      dateDisplay: disp,
      materialCode: e.material?.material_code ?? '',
      materialId: e.material?.id,
      nmsx: e.manufacturer?.code ?? '',
      category: e.material?.category ?? '',
      fullName: e.material?.material_description ?? e.material?.short_name ?? '',
      shortName: e.material?.short_name ?? '',
      qty: e.cartons_imported ?? '',
      cycle: e.cycle ?? '',
      machine: e.machine_code ?? '',
      seq: (e.pallet_code?.split('_')?.[4]) ?? '',
    }
  }

  // ── In lại từ tồn kho — filter Kho/Loại hàng/Tên hàng/Chu kỳ/Máy → multi-select Mã pallet ──
  const [rpWh, setRpWh]             = useState(allowedWhIds ? [...allowedWhIds][0] : '')
  const [rpCats, setRpCats]         = useState<string[]>([])
  const [rpMatIds, setRpMatIds]     = useState<string[]>([])
  const [rpCycles, setRpCycles]     = useState<string[]>([])
  const [rpMachines, setRpMachines] = useState<string[]>([])
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

  // ── Truy cứu — filter client-side + gộp theo mã pallet ──
  const [auWh, setAuWh]             = useState<string[]>([])  // theo NMSX (mã kho tổng)
  const [auCats, setAuCats]         = useState<string[]>([])
  const [auMats, setAuMats]         = useState<string[]>([])  // material_code
  const [auCycles, setAuCycles]     = useState<string[]>([])
  const [auMachines, setAuMachines] = useState<string[]>([])
  const [auQr, setAuQr]             = useState('')   // quét/điền tay mã pallet
  const [auOpen, setAuOpen]         = useState<string | null>(null)
  const { data: auditRows = [] } = usePalletPrints({}, tab === 'audit')

  const auditOpts = useMemo(() => {
    const sets = { nmsx: new Set<string>(), cats: new Set<string>(), mats: new Set<string>(), cyc: new Set<string>(), mac: new Set<string>() }
    for (const r of auditRows) {
      if (r.nmsx) sets.nmsx.add(r.nmsx)
      if (r.category) sets.cats.add(r.category)
      if (r.material_code) sets.mats.add(r.material_code)
      if (r.cycle) sets.cyc.add(r.cycle)
      if (r.machine) sets.mac.add(r.machine)
    }
    const opt = (s: Set<string>) => [...s].sort().map(v => ({ value: v, label: v }))
    return { nmsx: opt(sets.nmsx), cats: opt(sets.cats), mats: opt(sets.mats), cyc: opt(sets.cyc), mac: opt(sets.mac) }
  }, [auditRows])

  const auditSummary = useMemo(() => {
    const qq = auQr.trim().toLowerCase()
    const filtered = auditRows.filter(r =>
      (!qq                || r.qr_code.toLowerCase().includes(qq)) &&
      (!auWh.length       || (r.nmsx && auWh.includes(r.nmsx))) &&
      (!auCats.length     || (r.category && auCats.includes(r.category))) &&
      (!auMats.length     || (r.material_code && auMats.includes(r.material_code))) &&
      (!auCycles.length   || (r.cycle && auCycles.includes(r.cycle))) &&
      (!auMachines.length || (r.machine && auMachines.includes(r.machine)))
    )
    const m = new Map<string, { qr: string; material_code: string | null; nmsx: string | null; category: string | null; cycle: string | null; machine: string | null; count: number; last: string; events: PalletPrintRow[] }>()
    for (const r of filtered) {
      const g = m.get(r.qr_code)
      if (g) { g.count++; g.events.push(r); if (r.created_at > g.last) g.last = r.created_at }
      else m.set(r.qr_code, { qr: r.qr_code, material_code: r.material_code, nmsx: r.nmsx, category: r.category, cycle: r.cycle, machine: r.machine, count: 1, last: r.created_at, events: [r] })
    }
    return [...m.values()].sort((a, b) => b.last.localeCompare(a.last))
  }, [auditRows, auQr, auWh, auCats, auMats, auCycles, auMachines])

  const labels = tab === 'generate' ? genLabels : tab === 'reprint' ? Object.values(picked) : []

  // Gom thành các trang A4 (4 tem / trang)
  const sheets: LabelData[][] = useMemo(() => {
    const s: LabelData[][] = []
    for (let i = 0; i < labels.length; i += 4) s.push(labels.slice(i, i + 4))
    return s
  }, [labels])

  function handlePrint() {
    if (!labels.length) return
    // Ghi log truy vết (in mấy lần, ai in) — không chặn việc in nếu log lỗi
    logPrints.mutate({
      mode: tab === 'reprint' ? 'REPRINT' : 'GENERATE',
      labels: labels.map(l => ({
        qr_code: l.qr, material_code: l.materialCode, material_id: l.materialId ?? null,
        category: l.category, cycle: l.cycle, machine: l.machine, seq: l.seq, nmsx: l.nmsx,
        qty: l.qty === '' ? null : l.qty,
      })),
    })
    setTimeout(() => window.print(), 150)
  }

  return (
    <div className="flex flex-col h-full sm:p-3">
      {/* CSS in: chỉ in vùng .pl-print-area, mỗi tem 1/4 A4 */}
      <style>{`
        .pl-label { width: 105mm; height: 148.5mm; box-sizing: border-box; }
        .pl-sheet { box-sizing: border-box; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; }
          body * { visibility: hidden !important; }
          .pl-print-area, .pl-print-area * { visibility: visible !important; }
          .pl-print-area { position: absolute; left: 0; top: 0; width: 210mm; margin: 0 !important; padding: 0 !important; }
          .pl-print-area > * { margin: 0 !important; }
          .pl-sheet { width: 210mm; height: 297mm; box-shadow: none !important; overflow: hidden; page-break-after: always; break-after: page; }
          .pl-sheet:last-child { page-break-after: auto; break-after: auto; }
          .pl-label { border-style: solid !important; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

     <div className="flex flex-col flex-1 min-h-0 bg-white sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm">
      {/* Toolbar */}
      <div className="border-b bg-white px-3 py-2 shrink-0 space-y-1.5 sm:rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700 shrink-0 flex items-center gap-1.5">
            <QrCode className="h-4 w-4 text-slate-500" /> In tem pallet
          </span>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
            <button onClick={() => setTab('generate')}
              className={`px-3 py-1 transition-colors ${tab === 'generate' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Sinh tem mới</button>
            <button onClick={() => setTab('reprint')}
              className={`px-3 py-1 border-l border-slate-200 transition-colors ${tab === 'reprint' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>In lại từ tồn kho</button>
            <button onClick={() => setTab('audit')}
              className={`px-3 py-1 border-l border-slate-200 transition-colors inline-flex items-center gap-1 ${tab === 'audit' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><History className="h-3 w-3" />Truy cứu</button>
          </div>
          <div className="flex-1" />
          {canPrint && tab !== 'audit' && (
            <Button size="sm" className="h-7 text-xs gap-1" disabled={!labels.length} onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5" /> In {labels.length > 0 ? `(${labels.length})` : ''}
            </Button>
          )}
        </div>
      </div>

      {/* Summary band */}
      <SummaryBand tiles={[
        { label: 'Số tem', value: labels.length, accent: labels.length > 0 },
        { label: 'Số trang A4', value: sheets.length },
        { label: 'Tem / trang', value: 4 },
        { label: 'Khổ', value: '1/4 A4' },
      ]} />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Bảng điều khiển trái */}
        <div className="w-72 shrink-0 border-r bg-white overflow-y-auto p-3 space-y-3 no-print">
          {tab === 'generate' ? (
            <>
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
                <Label className="text-xs">Mã hàng <span className="text-red-500">*</span></Label>
                <MatPicker value={mat?.material_code ?? ''} label={mat?.short_name ?? mat?.material_description ?? ''} category={genCat} onPick={setMat} />
                {mat && <p className="text-[10px] text-slate-400">Loại: {mat.category ?? '—'} · Thùng/pallet: {mat.cartons_per_pallet ?? '—'}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ngày SX <span className="text-red-500">*</span></Label>
                <Input type="date" className="h-8 text-sm" value={prodDate} onChange={e => setProdDate(e.target.value)} />
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
                <Label className="text-xs">NMSX (mã kho tổng) <span className="text-red-500">*</span></Label>
                <Select value={nmsx || '__none__'} onValueChange={v => setNmsx(v === '__none__' ? '' : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Chọn kho tổng" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Không —</SelectItem>
                    {nmsxOptions.map((w: any) => (
                      <SelectItem key={w.id} value={w.code}>{w.code}{w.name ? ` — ${w.name}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Seq bắt đầu</Label>
                  <Input type="number" min={1} className="h-8 text-sm" value={seqStart} onChange={e => setSeqStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Số pallet</Label>
                  <Input type="number" min={1} max={200} className="h-8 text-sm" value={count} onChange={e => setCount(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Số lượng / pallet (thùng)</Label>
                <Input type="number" min={0} className="h-8 text-sm" value={qty} onChange={e => setQty(e.target.value)} />
                <p className="text-[10px] text-slate-400">Mặc định theo định mức thùng/pallet, sửa được.</p>
              </div>
              {!genReady && <p className="flex items-start gap-1 text-[11px] text-amber-600"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Chọn đủ Mã hàng, Chu kỳ, Máy, NMSX để sinh tem.</p>}
            </>
          ) : tab === 'reprint' ? (
            <>
              {/* Quét / điền tay mã pallet — thêm nhanh, không phụ thuộc filter */}
              <div className="space-y-1">
                <Label className="text-xs">Quét / nhập mã pallet</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <Input className="pl-7 h-8 text-sm" placeholder="Quét QR hoặc gõ mã rồi Enter" value={palletQ} onChange={e => setPalletQ(e.target.value)} onKeyDown={onScanEnter} />
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
              {/* grid 2 cột cố định → không nhảy vị trí khi chọn */}
              <div className="grid grid-cols-2 gap-1.5">
                <MultiSelectFilter label="Loại hàng" options={categoryOpts.map(c => ({ value: c, label: c }))} selected={rpCats} onChange={v => { setRpCats(v); setRpMatIds([]) }} searchable={false} width="w-full" />
                <MultiSelectFilter label="Tên hàng" options={(rpFacets?.materials ?? []).map((m: any) => ({ value: m.id, label: m.name ? `${m.code} – ${m.name}` : m.code }))} selected={rpMatIds} onChange={setRpMatIds} width="w-full" />
                <MultiSelectFilter label="Chu kỳ" options={(rpFacets?.cycles ?? []).map((c: string) => ({ value: c, label: c }))} selected={rpCycles} onChange={setRpCycles} searchable={(rpFacets?.cycles ?? []).length > 6} width="w-full" />
                <MultiSelectFilter label="Máy" options={(rpFacets?.machines ?? []).map((m: string) => ({ value: m, label: m }))} selected={rpMachines} onChange={setRpMachines} searchable={(rpFacets?.machines ?? []).length > 6} width="w-full" />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Mã pallet (chọn nhiều) — {invEntries.length} kết quả</Label>
                <MultiSelectFilter label="Chọn mã pallet" options={palletOptions} selected={Object.keys(picked)} onChange={onPickCodes} width="w-full" />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t">
                <span className="font-medium text-slate-700">Đã chọn: {Object.keys(picked).length}</span>
                {Object.keys(picked).length > 0 && (
                  <button onClick={() => setPicked({})} className="flex items-center gap-0.5 text-red-500 hover:text-red-700"><Trash2 className="h-3 w-3" />Bỏ hết</button>
                )}
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {Object.values(picked).map(l => (
                  <div key={l.key} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
                    <span className="font-mono text-[10px] font-semibold truncate flex-1">{l.qr}</span>
                    <button onClick={() => onPickCodes(Object.keys(picked).filter(c => c !== l.key))} className="text-slate-400 hover:text-red-500 shrink-0"><X className="h-3 w-3" /></button>
                  </div>
                ))}
                {Object.keys(picked).length === 0 && <p className="text-[11px] text-slate-400">Chọn mã pallet ở trên để in lại.</p>}
              </div>
            </>
          ) : (
            /* Truy cứu — quét pallet + filter */
            <>
              <div className="space-y-1">
                <Label className="text-xs">Quét / nhập mã pallet</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <Input className="pl-7 h-8 text-sm" placeholder="Quét QR hoặc gõ mã pallet…" value={auQr} onChange={e => setAuQr(e.target.value)} />
                </div>
                <p className="text-[10px] text-slate-400">Tra riêng 1 pallet, hoặc lọc theo nhóm bên dưới.</p>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-1 border-t">
                <MultiSelectFilter label="Kho (NMSX)" options={auditOpts.nmsx} selected={auWh} onChange={setAuWh} searchable={auditOpts.nmsx.length > 6} width="w-full" />
                <MultiSelectFilter label="Loại hàng" options={auditOpts.cats} selected={auCats} onChange={setAuCats} searchable={false} width="w-full" />
                <MultiSelectFilter label="Tên hàng (mã)" options={auditOpts.mats} selected={auMats} onChange={setAuMats} width="w-full" />
                <MultiSelectFilter label="Chu kỳ" options={auditOpts.cyc} selected={auCycles} onChange={setAuCycles} searchable={auditOpts.cyc.length > 6} width="w-full" />
                <MultiSelectFilter label="Máy" options={auditOpts.mac} selected={auMachines} onChange={setAuMachines} searchable={auditOpts.mac.length > 6} width="w-full" />
              </div>
              <p className="text-[10px] text-slate-400">Bảng bên phải gộp theo mã pallet — bấm 1 dòng để xem chi tiết các lần in.</p>
            </>
          )}
        </div>

        {/* Vùng phải: preview in (generate/reprint) HOẶC bảng truy cứu */}
        {tab === 'audit' ? (
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="min-w-full text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 text-left text-[9px] font-medium text-slate-500">
                  <th className="px-2 py-1.5">Mã pallet (QR)</th>
                  <th className="px-2 py-1.5">Mã hàng</th>
                  <th className="px-2 py-1.5">Loại</th>
                  <th className="px-2 py-1.5">NMSX</th>
                  <th className="px-2 py-1.5">Chu kỳ</th>
                  <th className="px-2 py-1.5">Máy</th>
                  <th className="px-2 py-1.5 text-right">Số lần in</th>
                  <th className="px-2 py-1.5">Lần in gần nhất</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditSummary.length === 0 ? (
                  <tr><td colSpan={8} className="px-2 py-8 text-center text-slate-400">Chưa có dữ liệu in</td></tr>
                ) : auditSummary.map(g => (
                  <Fragment key={g.qr}>
                    <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setAuOpen(auOpen === g.qr ? null : g.qr)}>
                      <td className="px-2 py-1 font-mono font-semibold text-blue-600">{g.qr}</td>
                      <td className="px-2 py-1">{g.material_code ?? '—'}</td>
                      <td className="px-2 py-1">{g.category ?? '—'}</td>
                      <td className="px-2 py-1">{g.nmsx ?? '—'}</td>
                      <td className="px-2 py-1">{g.cycle ?? '—'}</td>
                      <td className="px-2 py-1">{g.machine ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold">{g.count}</td>
                      <td className="px-2 py-1 tabular-nums whitespace-nowrap">{formatTimestampDate(g.last, true)} {formatTimestampTime(g.last)}</td>
                    </tr>
                    {auOpen === g.qr && (
                      <tr>
                        <td colSpan={8} className="bg-slate-50 px-3 py-2">
                          <p className="text-[10px] font-semibold text-slate-500 mb-1">Chi tiết {g.count} lần in</p>
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
        <div className="flex-1 min-h-0 overflow-auto bg-slate-100 p-4">
          {labels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <QrCode className="h-10 w-10 opacity-30 mb-2" />
              <p className="text-sm">{tab === 'generate' ? 'Nhập thông tin để xem trước tem' : 'Chọn pallet để in lại tem'}</p>
            </div>
          ) : (
            <div ref={printRef} className="pl-print-area mx-auto space-y-4">
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
    </div>
  )
}
