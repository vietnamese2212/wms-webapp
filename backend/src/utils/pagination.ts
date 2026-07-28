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

/**
 * Nạp tối đa `max` dòng rồi DỪNG, kèm cờ báo đã chạm trần — dùng cho các list mà FE render
 * TOÀN BỘ ở client (bảng + SummaryBand cộng tổng client-side). Trước đây các list này kéo mọi
 * dòng khớp filter: an toàn vì filter ngày mặc định = HÔM NAY, nhưng ai kéo rộng khoảng ngày
 * (cả năm) là hàng chục nghìn dòng → chậm/timeout.
 *
 * Nguyên tắc (CLAUDE.md): **chặn + hướng dẫn thu hẹp, KHÔNG cắt âm thầm**. Gọi hàm này rồi
 * `if (truncated) return fail(res, 400, 'RANGE_TOO_WIDE', LIST_TOO_LARGE_MSG(max))`.
 * Lấy `max + 1` dòng để biết "còn nữa" mà không tốn thêm query đếm.
 */
export async function fetchUpTo(
  makeQuery: () => SupaQuery, max: number, pageSize = 1000,
): Promise<{ rows: any[]; truncated: boolean }> {
  const out: any[] = []
  for (let p = 0; out.length <= max; p++) {
    const r = await makeQuery().range(p * pageSize, p * pageSize + pageSize - 1)
    if (r.error) throw new Error(r.error.message)
    const arr = r.data ?? []
    out.push(...arr)
    if (arr.length < pageSize) break
  }
  return { rows: out.slice(0, max), truncated: out.length > max }
}

/**
 * Trần dòng cho list mà FE render TOÀN BỘ ở client — khai 1 CHỖ cho mọi controller.
 *
 * Căn cứ (đo 27/07): 1 dòng danh sách ≈ **1,5KB** (đã gồm các bảng nhúng), 1.000 dòng ≈ 1,4s.
 * ⇒ 10.000 dòng ≈ 15MB / ~14s — đã là ngưỡng KHÓ CHỊU nhưng chưa chạm giới hạn 60s của Vercel.
 * Sản lượng user: ~500 dòng/ngày ⇒ trần này ≈ 20 ngày.
 *
 * ĐÂY LÀ LƯỚI AN TOÀN, KHÔNG PHẢI GIẢI PHÁP: xem 1 tháng (15.000 dòng ≈ 22MB) vẫn không tải
 * nổi, và nâng trần cũng vô ích vì bức tường thật là payload + số ô DOM. Lối ra duy nhất là
 * PHÂN TRANG SERVER (kèm tổng SummaryBand tính bằng SQL) — xem docs/plans/CUTOVER_2026-07-27.md.
 *
 * ⚠️ ĐỪNG dùng hằng số này cho list mới — dùng `rowCapForBytes()` bên dưới.
 */
export const LIST_ROW_CAP = 10_000

/**
 * Trần dòng suy từ SỐ BYTE MỖI DÒNG — vì bức tường thật là **trần 4,5MB response của Vercel**,
 * không phải con số "10.000 dòng".
 *
 * BÀI HỌC 28/07: mọi list dùng chung trần 10.000 dòng, nhưng byte/dòng lệch nhau nhiều lần nên
 * cùng một con số cho ra payload rất khác — ĐO THẬT (payload ÷ số dòng):
 *   Nghỉ phép        650 B/dòng → 10.000 dòng ≈ 6,2MB   ❌ vượt trần TRƯỚC KHI hàng rào kịp chặn
 *   Đăng ký cổng   1.044 B/dòng → 10.000 dòng ≈ 10,0MB  ❌ vượt hơn 2 lần
 *   Báo cáo nhập     333 B/dòng → 10.000 dòng ≈ 3,3MB   ✅ vừa
 * ⇒ Hàng rào đếm SAI ĐƠN VỊ thì vô dụng: request chết ở tầng hạ tầng (413/504), user thấy trang
 * lỗi trắng chứ KHÔNG thấy thông báo "hãy thu hẹp khoảng ngày" mà ta cố tình viết ra.
 *
 * Mỗi điểm gọi khai byte/dòng ĐO THẬT của chính nó, không đoán.
 */
const SAFE_RESPONSE_BYTES = 3_500_000   // chừa biên dưới 4,5MB (header + dòng dài hơn trung bình)
export function rowCapForBytes(bytesPerRow: number, hardMax = LIST_ROW_CAP): number {
  return Math.max(500, Math.min(hardMax, Math.floor(SAFE_RESPONSE_BYTES / Math.max(1, bytesPerRow))))
}

/**
 * PostgREST chạy dưới role `authenticator` có **statement_timeout = 8s CỐ ĐỊNH** (không sửa
 * được từ app). Khi nhiều người cùng yêu cầu một khoảng lọc rất rộng, query bị huỷ giữa chừng
 * → nếu để nguyên sẽ thành 500 "Lỗi hệ thống", user không biết phải làm gì.
 * Hàm này nhận diện lỗi đó để controller đổi thành 400 KÈM HƯỚNG DẪN THU HẸP (luật CLAUDE.md:
 * chặn có hướng dẫn, không để lỗi trắng).
 */
/**
 * PostgREST trả **416 "Requested range not satisfiable" (PGRST103)** khi `.range(offset, …)` bắt
 * đầu SAU dòng cuối cùng. Nếu để nguyên, controller biến nó thành **500 "Lỗi hệ thống"** — trong
 * khi đúng nghĩa nghiệp vụ chỉ là "trang này rỗng".
 *
 * ĐÂY LÀ TÌNH HUỐNG RẤT DỄ GẶP, không phải ca biên (phát hiện qua Playwright 28/07):
 *  - Đang ở trang 25 rồi gõ tìm → kết quả co lại còn 1 trang ⇒ request trang 25 → 500.
 *  - Số trang được NHỚ THEO USER (`scopedPersist`): lần sau mở lại trang 900 mà dữ liệu đã ít đi
 *    ⇒ mở trang là thấy lỗi, không hiểu tại sao.
 * Reset trang về 1 ở FE là cần nhưng KHÔNG đủ (còn khoảng trễ debounce + trang đã persist).
 *
 * Endpoint dùng RPC không bị (offset lớn chỉ trả mảng rỗng); chỉ các chỗ `.range()` trực tiếp
 * của PostgREST mới cần chặn lỗi này rồi trả TRANG RỖNG kèm `total` đúng.
 */
export function isRangeNotSatisfiable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e ?? '')
  const code = (e as { code?: string })?.code ?? ''
  return /range not satisfiable/i.test(msg) || code === 'PGRST103'
}

export function isQueryTimeout(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /statement timeout|canceling statement|57014/i.test(msg)
}

export const QUERY_TIMEOUT_MSG =
  'Khoảng lọc quá rộng nên hệ thống chưa tính kịp (nhiều người đang cùng truy vấn). '
  + 'Vui lòng thu hẹp KHOẢNG NGÀY hoặc chọn 1 Kho rồi thử lại.'

export const LIST_TOO_LARGE_MSG = (max: number) =>
  `Kết quả quá lớn (hơn ${max.toLocaleString('vi-VN')} bản ghi) nên không tải hết được. `
  + 'Vui lòng thu hẹp KHOẢNG NGÀY, hoặc lọc thêm theo Kho / Loại kho rồi thử lại.'

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
