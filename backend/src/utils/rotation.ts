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

import { effectiveExpiryMs, type MaterialShelfInfo } from './shelfLife'

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
  /** NGÀY NHẬP KHO (ngày hàng thật sự vào kho; chuyển kho nội bộ kế thừa) — khoá của FIFO / LIFO (user chốt 18/11).
   *  Mọi câu đọc tồn đưa vào luật luân chuyển PHẢI chọn cột này, thiếu là kho FIFO mất thứ tự (không báo gì). */
  import_date?:       string | Date | null
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
// (bulkUpdateQA chỉ đặt `qa_status_id`, KHÔNG đổi `status`, nên đừng suy QA từ status='QUARANTINE'.)
//
// ⚠️ `qaHold` là BẮT BUỘC, cố ý: trước 13/09 hàm này coi MỌI giá trị qa_status_id là "đang giữ",
// nhưng danh mục QAStatus có mã `OK` = ĐÃ DUYỆT và cửa quét vẫn cho xuất pallet đó ⇒ cùng một
// pallet, quét thì xuất được mà gợi ý/kế hoạch bảo "hết hàng" (đo Ba Vì: 8.760 pallet bị tính là
// kẹt trong khi chỉ 5 pallet bị giữ thật). Bắt truyền tham số để mọi điểm gọi phải lấy bộ id từ
// `services/qaStatus.ts` — thiếu là lỗi BIÊN DỊCH chứ không âm thầm sai.
// HÀNG HẾT HẠN VẪN LẤY ĐƯỢC (user chốt 20/09: "cứ cho phép xuất hàng hết hạn — có trường hợp xuất huỷ"): ca đêm mô
// phỏng 20/09 từng vá thành "quá hạn = loại khỏi kế hoạch + cửa quét 400 EXPIRED" rồi HOÀN LẠI cùng ngày. FEFO xếp
// pallet hạn sớm nhất (kể cả đã quá hạn) lên đầu là CHỦ ĐÍCH: dòng đòi mức (MIN_PCT/MIN_DAYS) tự loại pallet 0 % qua
// `matchesRule`; dòng "không đòi mốc" (xuất huỷ, trả hàng) phải lấy được pallet đó. ĐỪNG thêm lại cửa chặn hết hạn ở đây
// hay ở scanItem — gói 57 [25r1][25r2] khoá quyết định này.
export function isPickEligible(e: RotationEntry, qaHold: ReadonlySet<string>): boolean {
  if (e.qa_status_id && qaHold.has(e.qa_status_id)) return false
  return availableOf(e) > 0
}

// HSD hiệu lực (ms) đến từ `shelfLife.ts` — MỘT nguồn dùng chung với "số ngày còn lại" của quy
// tắc MIN_DAYS. Trước 11/09 file này giữ bản chép tay riêng: đúng khuôn lỗi mà chính đầu file
// đang cảnh báo, chỉ là ở tầng sâu hơn một bậc.

// NGÀY NHẬP (ngày, không giờ) → mốc ms của NGÀY đó. FIFO / LIFO so theo NGÀY nhập: cùng ngày = ngang nhau
// (lấy pallet nào trong ngày cũng đúng). Cột import_date là `timestamp without time zone` — PostgREST trả chuỗi
// KHÔNG múi giờ ⇒ đọc thẳng phần ngày 'YYYY-MM-DD', không đi qua đồng hồ của máy chủ (lớp lỗi C45).
export function importDayMs(v: string | Date | null | undefined): number | null {
  if (!v) return null
  const s = v instanceof Date ? (isNaN(v.getTime()) ? '' : v.toISOString()) : String(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(t) ? null : t
}

// Khóa sắp xếp: NHỎ HƠN = nên lấy TRƯỚC. null = không đủ dữ liệu để xếp (đứng cuối, không kết luận
// vi phạm — mã không khai NSX/HSD thì không có "thứ tự đúng" để mà sai).
//   • FEFO — HSD hiệu lực sớm nhất trước (HSD tường minh trên tem, hoặc NSX + hạn dùng theo lô / NCC).
//   • FIFO — NGÀY NHẬP KHO sớm nhất trước; LIFO — ngày nhập muộn nhất trước (user chốt 18/11: "FIFO theo ngày nhập", kể
//     cả Xuất kho; trước đó FIFO / LIFO so NSX — trùng FEFO khi cùng hạn dùng nên hai lựa chọn gần như một).
export function rotationSortKey(
  e: RotationEntry,
  material: MaterialShelfInfo | null | undefined,
  principle: RotationPrinciple,
): number | null {
  if (principle === 'FEFO') return effectiveExpiryMs(e, material)
  const day = importDayMs(e.import_date)
  if (day == null) return null
  return principle === 'LIFO' ? -day : day   // LIFO: hàng nhập SAU đi trước ⇒ đảo dấu
}

// Ngày ĐẠI DIỆN để hiển thị cho người quét (FEFO nói chuyện HSD, FIFO/LIFO nói chuyện NGÀY NHẬP).
export function rotationDateOf(
  e: RotationEntry,
  material: MaterialShelfInfo | null | undefined,
  principle: RotationPrinciple,
): string | null {
  if (principle === 'FEFO') {
    const ms = effectiveExpiryMs(e, material)
    return ms == null ? null : new Date(ms).toISOString().slice(0, 10)
  }
  const day = importDayMs(e.import_date)
  return day == null ? null : new Date(day).toISOString().slice(0, 10)
}

export const ROTATION_DATE_LABEL: Record<RotationPrinciple, string> = {
  FEFO: 'HSD', FIFO: 'Ngày nhập', LIFO: 'Ngày nhập',
}

export const ROTATION_LABEL: Record<RotationPrinciple, string> = {
  FEFO: 'FEFO — hạn dùng ngắn nhất đi trước',
  FIFO: 'FIFO — hàng nhập kho trước đi trước (theo ngày nhập)',
  LIFO: 'LIFO — hàng nhập kho sau đi trước (theo ngày nhập)',
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
  date_label:         string           // 'HSD' (FEFO) | 'Ngày nhập' (FIFO / LIFO) — để FE khỏi tự đoán
  scanned_date:       string | null
  best_date:          string | null
  best_pallet_code:   string | null
  best_location_code: string | null
}
