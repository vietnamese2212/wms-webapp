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
/**
 * Nạp toàn bộ dòng theo TẬP ID LỚN: chia ids thành lô (mặc định 300) rồi `.in(col, lô)` — né URL
 * quá dài (hàng nghìn id trong `.in()` → PostgREST Bad Request / Cloudflare 414); mỗi lô vẫn
 * phân trang né cap ~1000. Các lô chạy song song.
 * @param ids       Tập id cần lọc.
 * @param makeQuery Nhận 1 LÔ id, trả query MỚI (đã .select + .in(col, chunk) + .order ổn định).
 */
export async function fetchAllByIdChunks(
  ids: string[], makeQuery: (chunk: string[]) => SupaQuery, chunkSize = 300,
): Promise<any[]> {
  if (!ids.length) return []
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize))
  const results = await Promise.all(chunks.map(c => fetchAllRowsParallel(() => makeQuery(c))))
  return results.flat()
}

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
