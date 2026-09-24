// Loại kho của 1 chuyến/lệnh có thể là chuỗi GHÉP nhiều loại ('FG01+PM01' = xe chở lẫn).
// MIRROR của `backend/src/utils/categoryScope.ts → splitCategories` (và `wt_cats()` bên SQL) —
// sửa quy tắc tách phải sửa CẢ HAI; phép kiểm mirror `backend/tests/mirror/categoryScope.mirror.test.ts`
// gác. Đừng tự `split('+')` rải rác trong trang.
export function splitCategories(raw: string | null | undefined): string[] {
  return String(raw ?? '').split('+').map(s => s.trim()).filter(Boolean)
}
