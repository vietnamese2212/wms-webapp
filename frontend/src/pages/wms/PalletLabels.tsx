import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode, Printer, Plus, Trash2, Search, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WarehouseSingleSelect } from '@/components/shared/WarehouseSingleSelect'
import { SummaryBand } from '@/components/shared/SummaryBand'
import {
  useWarehouses, useWarehouseTypes, useMaterials, useInventoryEntries,
} from '@/api/hooks'
import { useAuthStore } from '@/stores/authStore'
import { can, type ModulePermissions } from '@/config/permissions'
import type { Material } from '@/types'

// ─── Label data ───────────────────────────────────────────────
type LabelData = {
  key: string
  qr: string            // chuỗi QR — PHẢI khớp parseInboundQR: ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX
  dateDisplay: string   // dd/MM/yyyy
  materialCode: string
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
      {/* QR — to, căn giữa */}
      <div className="flex justify-center shrink-0">
        <div className="h-[72mm] w-[72mm]"><QRImg value={d.qr} px={480} /></div>
      </div>

      {/* Thông tin — chữ lớn lấp khoảng trống */}
      <div className="mt-[2mm] flex-1 min-h-0 flex flex-col justify-evenly text-[11pt] leading-[1.3] text-black border-t border-black pt-[1.5mm]">
        <p className="truncate"><span className="font-semibold">Ngày</span> : {d.dateDisplay}</p>
        <p className="truncate"><span className="font-semibold">Mã</span> : {d.materialCode}</p>
        <p className="truncate"><span className="font-semibold">NMSX</span> : {d.nmsx || '—'}</p>
        <p className="truncate"><span className="font-semibold">Loại hàng</span> : {d.category || '—'}</p>
        <p className="truncate"><span className="font-semibold">Tên gói tắt</span> : {d.shortName || '—'}</p>
        <p className="truncate">Thời gian từ ……… đến ……… <span className="font-semibold">Kiểm tra</span></p>
        <p className="truncate"><span className="font-semibold">Số lượng</span> : {d.qty === '' ? '……' : d.qty}</p>
      </div>

      {/* Footer lớn — 3 cột tiêu đề + giá trị to để nhận diện từ xa */}
      <div className="mt-[1.5mm] grid grid-cols-3 shrink-0 border-t-2 border-black text-center">
        <div className="border-r border-black">
          <div className="text-[8pt] font-semibold leading-tight">Chu kỳ</div>
          <div className="text-[30pt] font-bold leading-none">{d.cycle || '—'}</div>
        </div>
        <div className="border-r border-black">
          <div className="text-[8pt] font-semibold leading-tight">Máy</div>
          <div className="text-[30pt] font-bold leading-none">{d.machine || '—'}</div>
        </div>
        <div>
          <div className="text-[8pt] font-semibold leading-tight">Số pallet</div>
          <div className="text-[30pt] font-bold leading-none">{Number(d.seq) || d.seq}</div>
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

  const [tab, setTab] = useState<'generate' | 'reprint'>('generate')

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

  const genLabels: LabelData[] = useMemo(() => {
    if (tab !== 'generate' || !mat || !prodDate) return []
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

  // ── Reprint từ tồn kho ──
  const [rpWh, setRpWh]   = useState(allowedWhIds ? [...allowedWhIds][0] : '')
  const [rpSearch, setRpSearch] = useState('')
  const [picked, setPicked] = useState<Record<string, LabelData>>({})
  const { data: invData } = useInventoryEntries({
    warehouse_ids: rpWh ? [rpWh] : undefined,
    search: rpSearch || undefined,
    status: '', page: 1, limit: 60,
  })
  const invEntries = invData?.entries ?? []

  function entryToLabel(e: any): LabelData {
    const pd: string | null = e.production_date ?? null
    const disp = pd ? toDisplayDate(pd.slice(0, 10)) : '—'
    return {
      key: e.id,
      qr: e.pallet_code,
      dateDisplay: disp,
      materialCode: e.material?.material_code ?? '',
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
  function togglePick(e: any) {
    setPicked(prev => {
      const next = { ...prev }
      if (next[e.id]) delete next[e.id]
      else next[e.id] = entryToLabel(e)
      return next
    })
  }

  const labels = tab === 'generate' ? genLabels : Object.values(picked)

  // Gom thành các trang A4 (4 tem / trang)
  const sheets: LabelData[][] = useMemo(() => {
    const s: LabelData[][] = []
    for (let i = 0; i < labels.length; i += 4) s.push(labels.slice(i, i + 4))
    return s
  }, [labels])

  function handlePrint() {
    if (!labels.length) return
    window.print()
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
          </div>
          <div className="flex-1" />
          {canPrint && (
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
                  <Label className="text-xs">Chu kỳ</Label>
                  <Input className="h-8 text-sm" placeholder="C05" value={cycle} onChange={e => setCycle(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Máy</Label>
                  <Input className="h-8 text-sm" placeholder="M1" value={machine} onChange={e => setMachine(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">NMSX (mã kho tổng)</Label>
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
              {!mat && <p className="flex items-start gap-1 text-[11px] text-amber-600"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Chọn mã hàng để sinh tem.</p>}
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Kho</Label>
                <WarehouseSingleSelect warehouses={whOptions} value={rpWh} onChange={setRpWh} allLabel="Tất cả kho" triggerClassName="h-8" />
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input className="pl-7 h-8 text-sm" placeholder="Tìm mã pallet / mã hàng…" value={rpSearch} onChange={e => setRpSearch(e.target.value)} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>{Object.keys(picked).length} đã chọn</span>
                {Object.keys(picked).length > 0 && (
                  <button onClick={() => setPicked({})} className="flex items-center gap-0.5 text-red-500 hover:text-red-700"><Trash2 className="h-3 w-3" />Bỏ chọn</button>
                )}
              </div>
              <div className="border rounded-md divide-y divide-slate-100 max-h-[calc(100vh-320px)] overflow-y-auto">
                {invEntries.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-slate-400">Không có pallet</p>
                ) : invEntries.map((e: any) => {
                  const sel = !!picked[e.id]
                  return (
                    <label key={e.id} className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer ${sel ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                      <input type="checkbox" className="h-3.5 w-3.5" checked={sel} onChange={() => togglePick(e)} />
                      <span className="font-mono text-[10px] font-semibold truncate flex-1">{e.pallet_code}</span>
                      <span className="text-[9px] text-slate-400 shrink-0">{e.material?.material_code}</span>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Preview + vùng in */}
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
      </div>
     </div>
    </div>
  )
}
