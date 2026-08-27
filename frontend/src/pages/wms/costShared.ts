// Dùng chung cho danh sách phiếu chi phí và trang chi tiết phiếu — mỗi thứ MỘT nguồn:
// cách đọc "kỳ", cách viết đường dẫn phiếu, cách hiển thị/đọc số tiền.
export const SHARED_KEY = '__shared__'   // chi phí CHUNG toàn công ty — DB lưu warehouse_id = null
/** Kho trong URL: uuid, hoặc 'chung' cho chi phí chung (đường dẫn đọc được, không có ký tự lạ). */
export const SHARED_SLUG = 'chung'

const TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
/** Kỳ 'YYYY-MM' cộng `months` tháng (âm = lùi). Dùng cho MỌI phép cộng/trừ trên kỳ. */
export function periodAdd(period: string, months: number): string {
  const [y, m] = period.slice(0, 7).split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
/** Kỳ 'YYYY-MM' lùi `back` tháng so với tháng hiện tại (0 = tháng này). Phải là HÀM, không hằng. */
export function monthAdd(back: number): string {
  return periodAdd(TODAY().slice(0, 7), -back)
}
/** Số tháng giữa 2 kỳ, tính cả 2 đầu — MIRROR `monthSpan` của backend. */
export const monthSpan = (from: string, to: string) =>
  (Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7))) -
  (Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))) + 1
/**
 * Trần khoảng kỳ của API (`MAX_MONTHS` trong `warehouseCostController`). FE tự kẹp Từ/Đến trong
 * trần này để người dùng KHÔNG bao giờ nhận banner đỏ "Khoảng kỳ tối đa 24 tháng" — chọn kỳ cũ là
 * việc bình thường, không phải lỗi. Gói QA 07 khoá cả 2 mốc (24 tháng = 200, 25 tháng = 400).
 */
export const MAX_SPAN_MONTHS = 24
/**
 * Danh sách kỳ cho ô chọn: `ahead` tháng TỚI + tháng này + `back` tháng trước (mới nhất lên đầu).
 * ⚠️ Phải có tháng TƯƠNG LAI: kế toán khai trước kỳ sau là chuyện thường (thuê kho, thuê pallet
 * ký theo hợp đồng), mà bản đầu chỉ liệt kê tháng này trở về trước ⇒ **không có đường nào tạo
 * phiếu tháng 9** — user 27/08: "tôi muốn tạo kỳ tháng 9 cũng k thấy nó đâu nhỉ?".
 * ⚠️ Và phải trải đủ XA VỀ TRƯỚC (5 năm): bản đầu chỉ 15 tháng nên kỳ cũ hơn thì **không chọn
 * được cũng không tạo được** — user 27/08: "nếu tôi muốn lấy kỳ xa hơn ngoài 15 này thì sao".
 * Danh sách là cửa sổ TRƯỢT theo tháng hiện tại nên không bao giờ hết hạn; ô chọn có ô tìm nên
 * 63 dòng vẫn gõ "2024" là ra.
 */
export const monthOpts = (back = 60, ahead = 3) =>
  Array.from({ length: back + ahead }, (_, i) => {
    const v = monthAdd(i - ahead)          // i=0 → xa nhất trong tương lai
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
