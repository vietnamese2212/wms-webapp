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

// Giá trị làm HẰNG so-khớp-CHÍNH-XÁC trong `.or()/.eq()/.cs.{}` (KHÔNG phải ilike pattern):
// loại ký tự cấu trúc `, ( ) { } "` để không chèn thêm predicate / phá array literal `{...}`.
// Khác safeSearch (dành cho ilike): ở đây KHÔNG escape `% _` vì là so khớp literal, không phải LIKE.
// Dùng cho: mã kho/shipto, category, đoạn QR (giá trị do user/QR đưa vào rồi ghép thẳng vào filter).
export function safeFilterValue(input: unknown): string {
  return String(input ?? '').replace(/[,(){}"\\]/g, '').trim()
}
