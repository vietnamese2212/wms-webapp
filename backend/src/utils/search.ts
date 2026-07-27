// Chuẩn hóa input tìm kiếm của user TRƯỚC khi ghép vào chuỗi filter PostgREST `.or(...)`.
// `.or()` là mini-ngôn ngữ filter: ký tự `,` `(` `)` có thể phá cú pháp hoặc chèn thêm
// predicate tham chiếu cột bất kỳ (rò rỉ dữ liệu kiểu blind-boolean, vd dò cột `password`).
// Ngoài ra `%` `_` `\` là wildcard LIKE → escape để khớp đúng nghĩa đen.
// Dùng: `q.or(\`name.ilike.%${safeSearch(s)}%,code.ilike.%${safeSearch(s)}%\`)`
export function safeSearch(input: unknown): string {
  return String(input ?? '')
    .replace(/[\\%_]/g, m => '\\' + m)   // escape wildcard LIKE
    .replace(/[,()]/g, ' ')              // bỏ ký tự phá cú pháp .or()
}

// Chuẩn hóa TỪ KHÓA để khớp cột `search_norm` (Material/Location) — PHẢI KHỚP công thức
// của cột GENERATED trong migration 20260727_search_norm_unaccent.sql:
//   lower(unaccent(...))  ⇔  bỏ dấu tiếng Việt (kể cả Đ→D) + thường hoá.
// Nhờ vậy gõ "nha dam" tìm ra "Nha Đam". FE gửi từ khóa THÔ — chuẩn hoá làm ở BE (1 chỗ).
export function normalizeSearchTerm(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // bỏ dấu tổ hợp
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')              // đ/Đ là chữ riêng, NFD không tách
    .toLowerCase()
}

// Giá trị làm HẰNG so-khớp-CHÍNH-XÁC trong `.or()/.eq()/.cs.{}` (KHÔNG phải ilike pattern):
// loại ký tự cấu trúc `, ( ) { } "` để không chèn thêm predicate / phá array literal `{...}`.
// Khác safeSearch (dành cho ilike): ở đây KHÔNG escape `% _` vì là so khớp literal, không phải LIKE.
// Dùng cho: mã kho/shipto, category, đoạn QR (giá trị do user/QR đưa vào rồi ghép thẳng vào filter).
export function safeFilterValue(input: unknown): string {
  return String(input ?? '').replace(/[,(){}"\\]/g, '').trim()
}

// Từ khóa trông như SQL-injection bị WAF trước Supabase CHẶN Ở TẦNG HẠ TẦNG: nó trả trang HTML
// (không phải JSON), supabase-js coi là lỗi lạ → controller nuốt thành 500 "Lỗi hệ thống"
// (fuzz 26/07: search=`' OR 1=1--` → 500 ở Tồn kho + Mã hàng).
// App tự nhận diện trước → trả 400 có thông báo, không sinh lỗi 500 nhiễu log.
// CỐ Ý hẹp: chỉ mẫu tiêm rõ rệt; dấu nháy/gạch đơn lẻ trong tên hàng vẫn tìm được bình thường.
const INJECTION_RE = [
  /(\bor\b|\band\b)\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,   // ' OR 1=1
  /\bunion\s+(all\s+)?select\b/i,
  /;\s*(drop|delete|update|insert|alter|truncate)\b/i,
  /\/\*.*\*\//,                                          // comment chèn /*…*/
]
export function searchLooksLikeInjection(input: unknown): boolean {
  const s = String(input ?? '')
  return INJECTION_RE.some(re => re.test(s))
}
export const SEARCH_INVALID_MSG = 'Từ khóa tìm kiếm không hợp lệ (chứa mẫu ký tự bị hệ thống bảo mật chặn). Hãy gõ mã hàng / mã pallet / tên hàng.'
