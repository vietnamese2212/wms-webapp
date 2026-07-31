/**
 * BIỂN SỐ XE — dạng chuẩn DUY NHẤT của app: **chỉ chữ và số, viết HOA, không ngăn cách**
 * (user chốt 30/07: "các ký tự nối tiếp, in hoa · không có ký tự gì cả, chỉ là số và text").
 *   "29e-09404" · "66H 07144" · "29K.12948"  →  "29E09404" · "66H07144" · "29K12948"
 *
 * MIRROR của `frontend/src/utils/formatters.ts → normalizeLicensePlate` — sửa luật phải sửa CẢ HAI.
 *
 * Vì sao phải chuẩn hoá Ở BACKEND chứ không chỉ ở ô nhập: form FE đã chuẩn hoá từ lâu mà dữ liệu
 * vẫn bẩn (đo staging 30/07: danh mục Xe 11 dòng, Đăng ký cổng 2 dòng) — vì còn các đường ghi
 * KHÔNG qua form: API tích hợp, upload Excel, script import. Chốt chặn phải nằm ở nơi mọi đường
 * đều đi qua. DB còn có CHECK `^[A-Z0-9]+$` (migration 20260731_plate_format) làm lưới cuối.
 *
 * ⚠️ KHÔNG áp cho 2 cột LƯU NGUYÊN VĂN nguồn ngoài: `WeighTicket.license_plate` (bản sao phiếu
 * cân giấy — dạng chuẩn nằm ở `license_plate_norm`) và `erp_outbound_orders.license_plate` (raw
 * SAP). Sửa 2 cột đó là mất khả năng đối chiếu với chứng từ gốc.
 */
export function normalizePlate(s: string | null | undefined): string | null {
  const n = String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return n || null
}

/** Đúng dạng chuẩn chưa (khớp CHECK dưới DB). Rỗng/null = coi như hợp lệ (cột cho phép null). */
export function isPlateNormalized(s: string | null | undefined): boolean {
  if (s == null || s === '') return true
  return /^[A-Z0-9]+$/.test(s)
}
