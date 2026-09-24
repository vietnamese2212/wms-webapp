// Chuẩn hoá MÃ VỊ TRÍ quét được từ tem (QR/mã vạch) trước khi so khớp `Location.location_code`.
//
// Vì sao phải có 1 chỗ: mã vị trí thật có DẤU CÁCH và DẤU tiếng Việt (`D_RM01_NGOÀI ĐƯỜNG`,
// `D_TP1_SX CHỜ XỬ LÝ`) nên không thể "tự trim rải rác" — mỗi chỗ trim một kiểu là cùng một tem
// quét ở màn Nhập thì ra, ở màn Chuyển vị trí lại không ra. Mirror với FE `utils/locationScan.ts`
// (sửa luật phải sửa CẢ HAI, như cặp plate.ts <-> formatters.ts).
//
// Chỉ làm 3 việc, KHÔNG "đoán thêm":
//   1. bỏ ký tự điều khiển (súng PDA/DataWedge chèn CR/LF vào cuối phát bắn) + ký tự zero-width
//   2. NFC (bàn phím/OS gõ tổ hợp dấu khác nhau ra cùng chữ)
//   3. trim 2 đầu + gộp mỗi dải khoảng trắng thành MỘT dấu cách
// KHÔNG bỏ dấu, KHÔNG bỏ `_`/`-`, KHÔNG upper-case: đó là dữ liệu của mã, bóp đi là hai ô khác
// nhau trở thành một. Sai hoa/thường và sai dấu được xử ở tầng SO KHỚP (ilike + search_norm),
// không phải ở đây.
const CONTROL_RE = /[\u0000-\u001F\u007F]/g
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g

export function normalizeLocScan(input: unknown): string {
  return String(input ?? '')
    .replace(CONTROL_RE, ' ')
    .replace(ZERO_WIDTH_RE, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
}
