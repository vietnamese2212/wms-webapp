// QR pallet — helper dùng chung FE, PHẢI khớp backend/src/utils/qrParser.ts
// V1 (đơn vị 1, `_`): ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX
// V2 (đơn vị 2, `;`): Mã hàng;QA(1=OK,0=X);Mã lô;NSX dd/mm/yyyy;HSD dd/mm/yyyy;Mẻ;Giờ:Phút
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
 *  đều "hợp lệ cấu trúc"); việc khớp cờ đơn vị do backend kiểm.
 *
 *  LUẬT PHẢI KHỚP backend `qrParser.parseV2` (fuzz 26/07 tìm ra 7.776 ca FE loại NHƯNG BE nhận →
 *  quét tem thùng bị loại oan, không ghi vào carton_scans = MẤT dữ liệu truy vết):
 *   · V2 cần ≥5 đoạn (Mã hàng;QA;Mã lô;NSX;HSD), KHÔNG bắt đủ 7;
 *   · mã lô cho phép 2 ký tự đầu là CHỮ HOẶC SỐ (form Mã hàng cho nhập batch_prefix kiểu "1A"),
 *     chữ thường, và đuôi `.N` của pallet tách;
 *   · mã lô lệch cấu trúc vẫn coi là hợp lệ (BE chỉ không trích được Máy/SEQ) — nhưng NSX/HSD
 *     phải là dd/mm/yyyy THẬT (BE trả 422 nếu sai, nên FE cũng bắt để không báo xanh oan). */
const V2_LOT = /^[A-Z0-9]{2}\d{6}[A-Z]\d{3}(\.\d+)?$/i
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
  if (s.includes(';')) {                       // V2: MãHàng;QA;Mã lô;NSX;HSD[;Mẻ;Giờ:Phút]
    const p = s.split(';').map(x => x.trim())
    if (p.length < 5) return false
    const [mat, , lot, nsx, hsd] = p
    if (!mat || !lot) return false
    if (!isValidDMY(nsx ?? '') || !isValidDMY(hsd ?? '')) return false
    // Mã lô lệch cấu trúc vẫn hợp lệ (khớp BE); nếu ĐÚNG cấu trúc thì kiểm luôn ngày trong mã lô
    if (V2_LOT.test(lot)) {
      const mo = +lot.slice(4, 6), day = +lot.slice(6, 8)
      return mo >= 1 && mo <= 12 && day >= 1 && day <= 31
    }
    return true
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
