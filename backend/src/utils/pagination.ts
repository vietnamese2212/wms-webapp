/* eslint-disable @typescript-eslint/no-explicit-any */
// Lấy TẤT CẢ dòng khớp 1 query, né cap ~1000 dòng/response của PostgREST — bắn các trang SONG SONG
// theo lô (BATCH) để giảm round-trip tuần tự. Dùng cho danh sách cần ĐẦY ĐỦ (dropdown filter, facet…).

type SupaQuery = any

/**
 * @param makeQuery Trả query MỚI mỗi lần (đã .select + filter + .order ỔN ĐỊNH, CHƯA .range). Throw nếu lỗi.
 * @param pageSize  Kích thước trang (mặc định 1000 = cap 1 response PostgREST).
 * @param batch     Số trang bắn đồng thời mỗi lô (mặc định 2 — đủ cho ~2000 dòng trong 1 round-trip).
 * Trang trả < pageSize → hết dữ liệu (yêu cầu .order ổn định để phân trang không trùng/sót).
 */
export async function fetchAllRowsParallel(
  makeQuery: () => SupaQuery, pageSize = 1000, batch = 2,
): Promise<any[]> {
  const out: any[] = []
  for (let start = 0; ; start += batch) {
    const reqs: SupaQuery[] = []
    for (let i = 0; i < batch; i++) {
      const p = start + i
      reqs.push(makeQuery().range(p * pageSize, p * pageSize + pageSize - 1))
    }
    const results = await Promise.all(reqs)
    let done = false
    for (const r of results) {
      if (r.error) throw new Error(r.error.message)
      const arr = r.data ?? []
      out.push(...arr)
      if (arr.length < pageSize) done = true
    }
    if (done) break
  }
  return out
}
