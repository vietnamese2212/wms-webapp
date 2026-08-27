// Dùng chung cho danh sách phiếu chi phí và trang chi tiết phiếu — mỗi thứ MỘT nguồn:
// cách đọc "kỳ", cách viết đường dẫn phiếu, cách hiển thị/đọc số tiền.
export const SHARED_KEY = '__shared__'   // chi phí CHUNG toàn công ty — DB lưu warehouse_id = null
/** Kho trong URL: uuid, hoặc 'chung' cho chi phí chung (đường dẫn đọc được, không có ký tự lạ). */
export const SHARED_SLUG = 'chung'

const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
/** Kỳ 'YYYY-MM' lùi `back` tháng so với tháng hiện tại (0 = tháng này). Phải là HÀM, không hằng. */
export function monthAdd(back: number): string {
  const [y, m] = TODAY().slice(0, 7).split('-').map(Number)
  const t = y * 12 + (m - 1) - back
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
/** 15 kỳ gần nhất cho ô chọn. */
export const monthOpts = (n = 15) =>
  Array.from({ length: n }, (_, i) => {
    const v = monthAdd(i)
    return { value: v, label: `Tháng ${v.slice(5)}/${v.slice(0, 4)}` }
  })

export const money = (n: number) => Math.round(Number(n) || 0).toLocaleString('vi-VN')
/** Ô nhập tiền: chỉ giữ chữ số (đồng, không xu) — dán "45.000.000 đ" cũng ra 45000000. */
export const parseMoney = (s: string): number => {
  const t = String(s).replace(/[^\d]/g, '')
  return t ? Number(t) : 0
}

export const voucherPath = (warehouseId: string | null, period: string) =>
  `/wms/warehouse-costs/${warehouseId ?? SHARED_SLUG}/${period.slice(0, 7)}`
/** Ngược lại: slug trên URL → giá trị API ('__shared__' hoặc uuid). */
export const warehouseKeyOf = (slug: string | undefined) =>
  !slug || slug === SHARED_SLUG ? SHARED_KEY : slug
