// Duyệt HẾT trang của một list phân trang ở server — dùng cho nút XUẤT FILE.
// File xuất phải đủ mọi dòng khớp bộ lọc, không chỉ trang đang xem (20/11: Chấm công, Sổ đóng gói ×2, Lịch sử quét lúc
// đang tìm… đều từng xuất đúng trang trên màn mà tooltip ghi "theo bộ lọc"). Mọi vòng lặp "lấy hết trang để xuất" đi
// qua đây, đừng viết thêm vòng riêng.
// Vượt trần ⇒ NÉM lỗi có lời nhắn (màn hiện băng đỏ) thay vì cắt âm thầm.

export class ExportTooLargeError extends Error {
  constructor(public total: number, public max: number) {
    super(`Quá nhiều dòng để xuất (${total.toLocaleString('vi-VN')} > ${max.toLocaleString('vi-VN')}). Hãy lọc hẹp lại rồi xuất.`)
    this.name = 'ExportTooLargeError'
  }
}

/** `load(page)` gọi API trang `page` (bắt đầu từ 1) với cỡ trang `pageSize`, trả `{ rows, total }`. */
export async function fetchAllPages<T>(
  load: (page: number, pageSize: number) => Promise<{ rows: T[]; total: number }>,
  opts: { pageSize: number; maxRows?: number },
): Promise<T[]> {
  const { pageSize, maxRows = 50_000 } = opts
  const out: T[] = []
  for (let page = 1; ; page++) {
    const { rows, total } = await load(page, pageSize)
    if (page === 1 && total > maxRows) throw new ExportTooLargeError(total, maxRows)
    out.push(...rows)
    if (!rows.length || rows.length < pageSize || out.length >= total) break
    if (out.length >= maxRows) throw new ExportTooLargeError(Math.max(total, out.length + 1), maxRows)
  }
  return out
}

/** Lời nhắn lỗi cho băng đỏ / toast của nút xuất (lỗi API hoặc vượt trần). */
export function exportErrorMessage(e: unknown, fallback = 'Xuất Excel lỗi — thử lại'): string {
  if (e instanceof ExportTooLargeError) return e.message
  const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
  return msg ?? (e instanceof Error && e.message ? `${fallback} (${e.message})` : fallback)
}
