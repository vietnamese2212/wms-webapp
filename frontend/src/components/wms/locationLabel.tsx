// TEM VỊ TRÍ (dán lên kệ/ô) — điều kiện để quét vị trí dùng được thật (user chốt 21/08).
//
// QR mã hoá NGUYÊN VĂN `location_code`, KHÔNG thêm tiền tố/hậu tố: mã vị trí có dấu cách và dấu
// tiếng Việt (`D_RM01_NGOÀI ĐƯỜNG`) nên (a) mã vạch 1D không mã hoá nổi — buộc phải QR, (b) thêm
// bất kỳ ký tự nào vào chuỗi là cửa tra ở BE không khớp trọn mã nữa.
//
// 8 tem / A4 (2 cột × 4 dòng, mỗi tem 105 × 74,25mm): QR 45mm quét được từ trên xe nâng, mã in cỡ
// lớn để người đọc mắt thường vẫn thấy. Cỡ chữ tự co theo độ dài mã (mã dài nhất staging 21 ký tự).
//
// Ảnh QR được sinh XONG TRƯỚC khi render (buildLocationLabels) rồi mới window.print(): tem pallet
// đang dựa vào `setTimeout(150ms)` chờ QR vẽ xong — với 100+ tem thì canh giờ kiểu đó là in ra ô
// trống. Ở đây không có cuộc đua nào.
import QRCode from 'qrcode'

export interface LocLabelData {
  key: string
  code: string
  warehouseName: string
  zone: string          // Khu (sub_code) + tên khu nếu khác
  qrSrc: string         // dataURL — sinh sẵn, render là hiện ngay
}

export interface LocLabelSource {
  id: string
  location_code: string
  sub_code?: string | null
  sub_name?: string | null
  warehouse?: { name?: string | null } | null
}

/** Sinh sẵn ảnh QR cho từng tem (song song). Gọi TRƯỚC khi render vùng in. */
export async function buildLocationLabels(rows: LocLabelSource[]): Promise<LocLabelData[]> {
  return Promise.all(rows.map(async l => ({
    key: l.id,
    code: l.location_code,
    warehouseName: l.warehouse?.name ?? '',
    zone: l.sub_code
      ? (l.sub_name && l.sub_name !== l.sub_code ? `${l.sub_code} · ${l.sub_name}` : l.sub_code)
      : '',
    qrSrc: await QRCode.toDataURL(l.location_code, { margin: 0, width: 420, errorCorrectionLevel: 'M' }),
  })))
}

// Mã dài thì chữ nhỏ lại — vẫn 1 dòng, không xuống dòng giữa mã (đọc mã vị trí bị cắt dòng là
// nguồn đọc sai kinh điển).
function codeSize(code: string): string {
  if (code.length <= 12) return '30pt'
  if (code.length <= 16) return '24pt'
  if (code.length <= 22) return '18pt'
  return '14pt'
}

export const LOC_PRINT_CSS = `
  .lc-label { width: 105mm; height: 74.25mm; box-sizing: border-box; }
  .lc-sheet { box-sizing: border-box; }
  .lc-print-area { position: absolute; left: -99999px; top: 0; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; }
    body * { visibility: hidden !important; }
    .lc-print-area, .lc-print-area * { visibility: visible !important; }
    .lc-print-area { position: absolute !important; left: 0 !important; top: 0 !important; width: 210mm; margin: 0 !important; padding: 0 !important; }
    .lc-print-area > * { margin: 0 !important; }
    .lc-sheet { width: 210mm; height: 297mm; box-shadow: none !important; overflow: hidden; page-break-after: always; break-after: page; }
    .lc-sheet:last-child { page-break-after: auto; break-after: auto; }
    .lc-label { border-style: solid !important; }
    @page { size: A4 portrait; margin: 0; }
  }
`

function LocationLabel({ d }: { d: LocLabelData }) {
  return (
    <div className="lc-label flex items-center gap-[3mm] border border-dashed border-slate-300 p-[4mm] overflow-hidden">
      <div className="h-[45mm] w-[45mm] shrink-0">
        <img src={d.qrSrc} alt={d.code} className="h-full w-full object-contain" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center text-black">
        <p className="font-mono font-bold leading-[1.05] break-all" style={{ fontSize: codeSize(d.code) }}>
          {d.code}
        </p>
        {d.zone && <p className="mt-[2mm] text-[11pt] leading-tight truncate">Khu: {d.zone}</p>}
        {d.warehouseName && <p className="text-[10pt] leading-tight truncate">{d.warehouseName}</p>}
      </div>
    </div>
  )
}

/** Vùng in ẩn off-screen — đổ `labels` rồi window.print(). */
export function LocationPrintArea({ labels }: { labels: LocLabelData[] }) {
  const sheets: LocLabelData[][] = []
  for (let i = 0; i < labels.length; i += 8) sheets.push(labels.slice(i, i + 8))
  return (
    <div className="lc-print-area" aria-hidden>
      {sheets.map((sheet, si) => (
        <div key={si} className="lc-sheet grid grid-cols-2 grid-rows-4 overflow-hidden bg-white"
          style={{ width: '210mm', height: '297mm' }}>
          {sheet.map(d => <LocationLabel key={d.key} d={d} />)}
        </div>
      ))}
    </div>
  )
}
