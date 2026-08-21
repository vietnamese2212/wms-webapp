// Gom mã đã quét trong MỘT phiên camera — logic THUẦN (không React, không DOM) để kiểm được bằng
// chuỗi khung mô phỏng (gói QA 30 chạy đúng ca thật của user 21/08).
//
// Hai lớp nhiễu mà nó xử, đều là bản chất của mã vạch 1D (QR không có vì có mã sửa lỗi):
//   1. MỘT tem ra NHIỀU chuỗi: UPC-A trả 12 số, khung khác trả 13 số có '0' dẫn đầu → đếm theo
//      `scanKey` (GTIN-13) nên chỉ 1 dòng.
//   2. BẢN ĐỌC SAI cùng ô: vạch mờ/moiré cho ra số khác NHƯNG vẫn thoả checksum (`96385074` →
//      `06384074`), nên checksum không loại được. Nhận diện bằng VỊ TRÍ: hai mã cùng vùng ảnh thì
//      chỉ một là thật — giữ mã được thấy nhiều lần hơn hẳn, gỡ mã yếu.
//      Dọn theo SỐ LẦN THẤY chứ KHÔNG chặn lúc mới xuất hiện: nếu chặn thì bản đọc sai xuất hiện
//      TRƯỚC sẽ khoá luôn mã thật — mất mã thật nguy hiểm hơn là hiện thêm một dòng rác.
import { isValidTem, scanKey } from './qr'

export interface Point { x: number; y: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface ScanEntry {
  text: string      // chuỗi NGUYÊN VĂN lần đầu thấy (hiển thị)
  valid: boolean    // đúng cấu trúc tem pallet (V1 `_` / V2 `;`)
  at: number        // lần đầu thấy
  hits: number      // số khung đã thấy
  box?: Rect        // vùng ảnh lần thấy gần nhất
  seenAt?: number
}

/** Vùng bao của một mã trên khung (hệ pixel video). */
export function rectOf(points: Point[]): Rect {
  return {
    x0: Math.min(...points.map(p => p.x)), y0: Math.min(...points.map(p => p.y)),
    x1: Math.max(...points.map(p => p.x)), y1: Math.max(...points.map(p => p.y)),
  }
}

/** Tâm của a nằm trong b (hoặc ngược lại) = hai mã đang chỉ vào CÙNG một tem. */
export function sameSpot(a: Rect, b: Rect): boolean {
  const inside = (r: Rect, o: Rect) => {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2
    return cx >= o.x0 && cx <= o.x1 && cy >= o.y0 && cy <= o.y1
  }
  return inside(a, b) || inside(b, a)
}

/** Chỉ so vùng với mã còn "tươi" — camera lia sang chỗ khác thì vùng cũ không còn nói gì. */
export const MISREAD_WINDOW_MS = 2500
/** Mã mạnh phải hơn mã yếu ÍT NHẤT 3× số lần thấy mới được gỡ (đo thật: 46× vs 5×, 26× vs 3×). */
const MISREAD_RATIO = 3
/** Chỉ bắt đầu dọn khi mã mạnh đã được thấy đủ nhiều (khỏi dọn theo một khung may mắn). */
const MISREAD_MIN_HITS = 4

/**
 * Ghi nhận 1 lần thấy mã. Trả về entry (đã tăng hits) + danh sách khoá bị gỡ vì là bản đọc sai.
 * `map` bị thay đổi tại chỗ.
 */
export function registerHit(
  map: Map<string, ScanEntry>,
  hit: { text: string; points: Point[]; now: number },
): { key: string; entry: ScanEntry; removed: string[] } {
  const key = scanKey(hit.text)
  const box = rectOf(hit.points)
  let entry = map.get(key)
  if (!entry) {
    entry = { text: hit.text, valid: isValidTem(hit.text), at: hit.now, hits: 0 }
    map.set(key, entry)
  }
  entry.hits++
  entry.box = box
  entry.seenAt = hit.now

  const removed: string[] = []
  if (!entry.valid && entry.hits >= MISREAD_MIN_HITS) {
    for (const [k, other] of [...map]) {
      if (k === key || other.valid || !other.box) continue
      if (hit.now - (other.seenAt ?? 0) > MISREAD_WINDOW_MS) continue
      if (other.hits * MISREAD_RATIO > entry.hits) continue      // chưa vượt hẳn → giữ cả hai
      if (sameSpot(box, other.box)) { map.delete(k); removed.push(k) }
    }
  }
  return { key, entry, removed }
}
