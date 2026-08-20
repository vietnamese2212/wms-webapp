// NGUYÊN TẮC LUÂN CHUYỂN (rotation) — NGUỒN DUY NHẤT của luật "pallet nào nên lấy trước".
//
// Trước 14/08 luật này tồn tại 3 BẢN KHÁC NHAU và không bản nào biết bản kia:
//   1. Cột "Vị trí lấy" sắp theo %Date (tức HSD)               → chỉ vào pallet A
//   2. Cảnh báo lúc quét so production_date (tức NSX)          → chỉ vào pallet B
//   3. Nền so sánh của (2) chỉ đếm IN_STOCK/PARTIAL, trong khi quét cho lấy cả
//      QUARANTINE/LOOSE_PICKING; ngược lại (1) KHÔNG lọc pallet bị QA giữ mà lúc quét lại chặn
//      → gợi ý chỉ người ta tới pallet không lấy được.
// Hàng cùng mã khác NCC có shelf-life khác nhau ⇒ (1) và (2) chỉ vào 2 pallet khác nhau là chuyện
// THƯỜNG, không phải ca hiếm. Mọi điểm tính luân chuyển từ nay đi qua file này.
//
// Mirror FE (chỉ phần NHÃN + mã lý do): frontend/src/utils/rotation.ts — sửa luật phải sửa cả hai.

import { resolveShelfLife, type MaterialShelfInfo } from './shelfLife'

export const ROTATION_PRINCIPLES = ['FEFO', 'FIFO', 'LIFO'] as const
export type RotationPrinciple = typeof ROTATION_PRINCIPLES[number]
export const ROTATION_PRINCIPLE_DEFAULT: RotationPrinciple = 'FEFO'

export function isRotationPrinciple(v: unknown): v is RotationPrinciple {
  return typeof v === 'string' && (ROTATION_PRINCIPLES as readonly string[]).includes(v)
}

export function asRotationPrinciple(v: unknown): RotationPrinciple {
  return isRotationPrinciple(v) ? v : ROTATION_PRINCIPLE_DEFAULT
}

// Trạng thái pallet CÓ THỂ lấy đi xuất. MỘT danh sách duy nhất cho cả gợi ý lẫn so sánh —
// lệch danh sách chính là lỗi (3) ở đầu file.
export const PICKABLE_STATUSES = ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING'] as const

export interface RotationEntry {
  production_date?:   string | Date | null
  expiry_date?:       string | Date | null   // HSD tường minh trên tem V2
  shelf_life_days?:   number | null
  ncc_id?:            string | null
  qa_status_id?:      string | null
  cartons_remaining?: number | null
  cartons_imported?:  number | null
  cartons_reserved?:  number | null
}

export function availableOf(e: RotationEntry): number {
  const base = Number(e.cartons_remaining ?? e.cartons_imported ?? 0)
  return Math.max(0, base - Number(e.cartons_reserved ?? 0))
}

// Pallet có được đưa vào so sánh / gợi ý không.
// PHẢI khớp đúng điều kiện mà scanItem chấp nhận: còn hàng + KHÔNG bị QA giữ.
// (qa_status_id có giá trị = đang giữ — bulkUpdateQA chỉ đặt cột này, KHÔNG đổi `status`,
//  nên đừng suy QA từ status='QUARANTINE'.)
export function isPickEligible(e: RotationEntry): boolean {
  if (e.qa_status_id) return false
  return availableOf(e) > 0
}

function msOf(v: string | Date | null | undefined): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return isNaN(t) ? null : t
}

// HSD hiệu lực (ms): ưu tiên HSD tường minh trên tem (V2) → suy từ NSX + shelf-life (V1).
// Cùng công thức nền với computePctDate: shelf-life lấy theo lô → theo NCC → mặc định của mã.
function effectiveExpiryMs(e: RotationEntry, material: MaterialShelfInfo | null | undefined): number | null {
  const exp = msOf(e.expiry_date)
  if (exp != null) return exp
  const prod = msOf(e.production_date)
  const days = resolveShelfLife(e.shelf_life_days, material, e.ncc_id)
  if (prod == null || days <= 0) return null
  return prod + days * 86_400_000
}

// Khóa sắp xếp: NHỎ HƠN = nên lấy TRƯỚC. null = không đủ dữ liệu để xếp (đứng cuối, không kết luận
// vi phạm — mã không khai NSX/HSD thì không có "thứ tự đúng" để mà sai).
export function rotationSortKey(
  e: RotationEntry,
  material: MaterialShelfInfo | null | undefined,
  principle: RotationPrinciple,
): number | null {
  if (principle === 'FEFO') return effectiveExpiryMs(e, material)
  const prod = msOf(e.production_date)
  if (prod == null) return null
  return principle === 'LIFO' ? -prod : prod   // LIFO: hàng MỚI đi trước ⇒ đảo dấu
}

// Ngày ĐẠI DIỆN để hiển thị cho người quét (FEFO nói chuyện HSD, FIFO/LIFO nói chuyện NSX).
export function rotationDateOf(
  e: RotationEntry,
  material: MaterialShelfInfo | null | undefined,
  principle: RotationPrinciple,
): string | null {
  if (principle === 'FEFO') {
    const ms = effectiveExpiryMs(e, material)
    return ms == null ? null : new Date(ms).toISOString().slice(0, 10)
  }
  const prod = msOf(e.production_date)
  return prod == null ? null : new Date(prod).toISOString().slice(0, 10)
}

export const ROTATION_DATE_LABEL: Record<RotationPrinciple, string> = {
  FEFO: 'HSD', FIFO: 'NSX', LIFO: 'NSX',
}

export const ROTATION_LABEL: Record<RotationPrinciple, string> = {
  FEFO: 'FEFO — hạn dùng ngắn nhất đi trước',
  FIFO: 'FIFO — hàng vào trước đi trước',
  LIFO: 'LIFO — hàng vào sau đi trước',
}

// Vi phạm = pallet vừa quét đứng SAU pallet tốt nhất còn trong kho.
// Bằng nhau KHÔNG phải vi phạm (2 pallet cùng ngày thì lấy cái nào cũng đúng).
// Thiếu dữ liệu ở một trong hai vế → không kết luận.
export function isRotationViolation(scannedKey: number | null, bestKey: number | null): boolean {
  if (scannedKey == null || bestKey == null) return false
  return scannedKey > bestKey
}

// Lý do vượt rào = DANH SÁCH CỐ ĐỊNH, không gõ tự do — để báo cáo gom nhóm được.
// Biết 70% lượt vượt rào là "nằm dưới chồng" thì vấn đề là CÁCH XẾP KHO, không phải người quét;
// gõ tự do thì mãi mãi không biết điều đó.
export const ROTATION_REASONS = [
  { code: 'BLOCKED',  label: 'Pallet nằm dưới chồng / bị chắn' },
  { code: 'DAMAGED',  label: 'Pallet hỏng, không lấy được' },
  { code: 'CUSTOMER', label: 'Khách yêu cầu date khác' },
  { code: 'OTHER',    label: 'Khác (ghi rõ)' },
] as const
export type RotationReasonCode = typeof ROTATION_REASONS[number]['code']

export function isRotationReason(code: unknown): code is RotationReasonCode {
  return typeof code === 'string' && ROTATION_REASONS.some(r => r.code === code)
}

// Kết quả kiểm luân chuyển của MỘT lượt quét — dùng chung cho preview (checkScanItem) và ghi (scanItem).
export interface RotationCheck {
  principle:          RotationPrinciple
  required:           boolean          // kho có bật "bắt buộc" không
  // Nguyên tắc đang áp đến từ mặc định KHO hay từ chiến thuật riêng của LOẠI KHO (21/08).
  // FE hiện thêm "(theo Loại kho)" — KHÔNG được tự suy từ cấu hình kho (bản luật chép tay thứ N).
  source:             'WAREHOUSE' | 'TYPE'
  violation:          boolean
  date_label:         string           // 'HSD' | 'NSX' — để FE khỏi tự đoán
  scanned_date:       string | null
  best_date:          string | null
  best_pallet_code:   string | null
  best_location_code: string | null
}
