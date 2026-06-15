import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'

// ─── Dữ liệu 1 tem ────────────────────────────────────────────
export type LabelData = {
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
  seq: string
}

export function toDdmmyy(iso: string): string {
  if (!iso || iso.length < 10) return ''
  const [y, m, d] = iso.split('-')
  return `${d}${m}${y.slice(2)}`
}
export function toDisplayDate(iso: string): string {
  if (!iso || iso.length < 10) return iso
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
// Loại bỏ ký tự phá format QR (dấu _ và khoảng trắng)
export const clean = (s: string) => (s ?? '').trim().replace(/[_\s]+/g, '')

// Chuỗi QR khớp 100% backend parseInboundQR (6 phần ngăn bởi _)
export function buildQR(p: { ddmmyy: string; code: string; cycle: string; machine: string; seq: string; nmsx: string }): string {
  return [p.ddmmyy, clean(p.code), clean(p.cycle), clean(p.machine), p.seq, clean(p.nmsx)].join('_')
}

// Dựng LabelData từ 1 mã pallet (QR) + tra cứu tên/loại nếu có
export function qrToLabel(qr: string, mat?: { id?: string; material_description?: string | null; short_name?: string | null; category?: string | null } | null, qty?: number | null): LabelData {
  const parts = String(qr).split('_')
  const ddmmyy = parts[0] ?? ''
  const iso = ddmmyy.length === 6 ? `20${ddmmyy.slice(4, 6)}-${ddmmyy.slice(2, 4)}-${ddmmyy.slice(0, 2)}` : ''
  return {
    key: qr, qr,
    dateDisplay: iso ? toDisplayDate(iso) : '—',
    materialCode: parts[1] ?? '',
    materialId: mat?.id,
    nmsx: parts[5] ?? '',
    category: mat?.category ?? '',
    fullName: mat?.material_description ?? '',
    shortName: mat?.short_name ?? '',
    qty: qty ?? '',
    cycle: parts[2] ?? '',
    machine: parts[3] ?? '',
    seq: parts[4] ?? '',
  }
}

// ─── QR ảnh (dataURL — in ổn định) ────────────────────────────
export function QRImg({ value, px = 320 }: { value: string; px?: number }) {
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
export function PalletLabel({ d }: { d: LabelData }) {
  return (
    <div className="pl-label flex flex-col border border-dashed border-slate-300 p-[3.5mm] overflow-hidden">
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="h-[88mm] w-[88mm] max-h-full max-w-full"><QRImg value={d.qr} px={520} /></div>
      </div>
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

// CSS in — chỉ in vùng .pl-print-area, mỗi tem 1/4 A4, 4 tem/A4
export const PALLET_PRINT_CSS = `
  .pl-label { width: 105mm; height: 148.5mm; box-sizing: border-box; }
  .pl-sheet { box-sizing: border-box; }
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
`

// Vùng IN ẩn off-screen — đặt 1 lần trong trang, đổ `labels` rồi window.print()
export function PalletPrintArea({ labels }: { labels: LabelData[] }) {
  const sheets = useMemo(() => {
    const s: LabelData[][] = []
    for (let i = 0; i < labels.length; i += 4) s.push(labels.slice(i, i + 4))
    return s
  }, [labels])
  return (
    <div className="pl-print-area" aria-hidden>
      {sheets.map((sheet, si) => (
        <div key={si} className="pl-sheet grid grid-cols-2 grid-rows-2 overflow-hidden bg-white" style={{ width: '210mm', height: '297mm' }}>
          {sheet.map(d => <PalletLabel key={d.key} d={d} />)}
        </div>
      ))}
    </div>
  )
}
