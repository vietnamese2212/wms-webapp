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

/** Kiểm tra dd/mm/yyyy hợp lệ theo lịch thật (chống 30/02 roll-over). */
export function isValidDMY(s: string): boolean {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (!m) return false
  const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yy = parseInt(m[3], 10)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
  const d = new Date(Date.UTC(yy, mm - 1, dd))
  return d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd
}
