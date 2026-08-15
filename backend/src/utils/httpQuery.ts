/**
 * Bóc tham số DANH SÁCH từ query string — CÁCH DUY NHẤT được phép trong controller
 * (đừng tự `String(x).split(',')`: từng có 18 bản viết tay với dăm kiểu xử "rỗng" khác nhau,
 * và bug thật 29/07: `?codes=` rỗng là falsy nên hàng rào không chạy → bỏ lọc → trả CẢ
 * danh mục 2.740 mã ~2,5MB; một `join(',')` trên mảng rỗng ở phía gọi là đủ để dính).
 *
 * Ngữ nghĩa theo SỰ CÓ MẶT của tham số, không theo truthy:
 *   - vắng mặt (undefined)      → null  (caller hiểu là "không lọc")
 *   - có mặt nhưng rỗng (`?x=`) → []    (caller phải trả kết quả RỖNG, đừng bỏ lọc)
 *   - 'a, b,,c'                 → ['a','b','c']  (trim từng phần, bỏ phần rỗng)
 *   - lặp key (`?x=a&x=b`)      → ['a','b']      (Express đưa mảng)
 *
 * `cap` chặn số phần tử. KHÔNG mặc định — chặn ÂM THẦM một danh sách LỌC là sai dữ liệu;
 * chỉ truyền cap khi ngữ nghĩa là "tra cứu theo lô" (codes/ids — FE đã chunk 300 theo
 * trần URL của PostgREST, xem memory id-list-url-limits).
 */
export function parseListParam(v: unknown, cap?: number): string[] | null {
  if (v === undefined) return null
  const raw = Array.isArray(v) ? v.map(x => String(x)) : String(v).split(',')
  const out = raw.map(s => s.trim()).filter(Boolean)
  return cap ? out.slice(0, cap) : out
}

// Danh sách id sắp so với CỘT KIỂU uuid (InventoryEntry.warehouse_id, ncc_id…) phải kiểm dạng
// TRƯỚC khi đưa vào query: chuỗi không phải uuid xuống Postgres là 22P02 "invalid input syntax
// for type uuid" → controller nuốt thành 500 (fuzz 29/07: ?warehouse_ids=khong-phai-uuid).
// Trả danh sách phần tử SAI để controller báo 400 chỉ đích danh; [] = sạch.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function nonUuidEntries(list: string[]): string[] {
  return list.filter(s => !UUID_RE.test(s))
}
