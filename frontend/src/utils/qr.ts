// QR pallet — helper dùng chung FE, PHẢI khớp backend/src/utils/qrParser.ts
// V1 (đơn vị 1, `_`): ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX
// V2 (đơn vị 2, `;`): Mã hàng;QA(1=OK,0=X);Mã lô;NSX dd/mm/yyyy;HSD dd/mm/yyyy;Giờ;Phút:Giây
//   Tem nhà máy đệm SPACE từng đoạn → pallet_code = chuỗi chuẩn hóa (trim từng đoạn, nối `;`).

/** Chuẩn hóa chuỗi QR như backend normalizeQR — CHỈ trim NGOÀI, GIỮ đệm space bên trong (tem V2)
 *  để pallet_code lưu/khớp ĐÚNG như QR quét ra. Trim từng đoạn CHỈ khi bóc tách field (materialCodeOf…). */
export function normalizeQR(raw: string): string {
  return (raw ?? '').trim()
}

/** Lấy MÃ HÀNG từ mã pallet, đúng cả 2 format: V2 (`;`) = đoạn 0; V1 (`_`) = đoạn 1. */
export function materialCodeOf(palletCode: string | null | undefined): string {
  const s = (palletCode ?? '').trim()
  if (!s) return ''
  if (s.includes(';')) return s.split(';')[0]?.trim() ?? ''
  return s.split('_')[1] ?? ''
}

/** Kiểm 1 chuỗi có phải TEM pallet hợp lệ theo CẤU TRÚC (V1 `_` hoặc V2 `;`) — dùng cho khung màu
 *  scanner (xanh=hợp lệ / đỏ=không phải tem) + trang quét loạt. KHÔNG gate theo cờ đơn vị (cả 2 format
 *  đều "hợp lệ cấu trúc"); việc khớp cờ đơn vị do backend kiểm. Phải khớp backend qrParser. */
const V2_LOT = /^[A-Z]{2}\d{6}[A-Z]\d{3}$/
function validDdmmyy(d: string): boolean {
  if (!/^\d{6}$/.test(d)) return false
  const day = +d.slice(0, 2), mo = +d.slice(2, 4)
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return false
  const dt = new Date(Date.UTC(2000 + +d.slice(4, 6), mo - 1, day))
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === day
}
export function isValidTem(raw: string): boolean {
  const s = (raw ?? '').trim()
  if (!s) return false
  if (s.includes(';')) {                       // V2: MãHàng;QA;Mã lô;NSX;HSD;Giờ;Phút:Giây
    const p = s.split(';').map(x => x.trim())
    if (p.length < 7) return false
    const lot = p[2] ?? ''
    if (!V2_LOT.test(lot)) return false        // Mã lô = 2 chữ + yymmdd + Máy + 3 số
    const mo = +lot.slice(4, 6), day = +lot.slice(6, 8)
    return mo >= 1 && mo <= 12 && day >= 1 && day <= 31
  }
  const p = s.split('_')                        // V1: ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX
  if (p.length < 6) return false
  return validDdmmyy(p[0])
}

/** Kiểm tra dd/mm/yyyy hợp lệ theo lịch thật (chống 30/02 roll-over). */
export function isValidDMY(s: string): boolean {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (!m) return false
  const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yy = parseInt(m[3], 10)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
  const d = new Date(Date.UTC(yy, mm - 1, dd))
  return d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd
}
