// Omni-search kiểu AppSheet: 1 ô tìm kiếm, gõ gì khớp nấy trên TẤT CẢ cột hiển thị,
// không phân biệt hoa/thường + bỏ dấu tiếng Việt ("can" khớp "căn", "vi tri" khớp "Vị trí").

// Thường hóa + bỏ dấu tiếng Việt (đ→d).
export function normalizeVi(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // bỏ dải dấu kết hợp (combining diacritics)
    .replace(/đ/g, 'd').replace(/Đ/g, 'd')   // đ/Đ → d
}

// Ghép mọi giá trị của 1 dòng thành chuỗi, kiểm MỌI từ khóa (tách theo khoảng trắng) đều
// xuất hiện (AND) → gõ "bv canh" khớp dòng có cả "BV" lẫn "cạnh". Bỏ qua giá trị rỗng/null.
export function omniMatch(values: Array<unknown>, query: string): boolean {
  const q = normalizeVi(query.trim())
  if (!q) return true
  const hay = normalizeVi(
    values.filter(v => v != null && v !== '').map(v => String(v)).join(' ')
  )
  return q.split(/\s+/).every(tok => hay.includes(tok))
}
