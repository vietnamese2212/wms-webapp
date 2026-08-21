// Gom mã đã quét trong MỘT phiên camera — logic THUẦN (không React, không DOM) để kiểm được bằng
// chuỗi khung mô phỏng (gói QA 30).
//
// ⚠️⚠️ ĐỪNG THÊM LẠI VIỆC TỰ XOÁ MÃ (bài học đắt, 21/08 — user báo hỏng HAI lần liên tiếp):
// mã vạch 1D không có mã sửa lỗi nên khung mờ có thể ra BẢN ĐỌC SAI của chính tem đang nhìn, vẫn
// thoả checksum (`96385074` → `06384074`). Đã thử đoán bản đọc sai theo VỊ TRÍ (hai mã cùng vùng
// ảnh thì chỉ một là thật) qua 2 vòng vá, và cả 2 lần đều LÀM MẤT MÃ THẬT:
//   • vòng 1 — dọn lúc ghi nhận: bản đọc sai ở khung cuối không bị dọn (tem rời khung, mã thật hết
//     lượt) ⇒ vẫn còn rác;
//   • vòng 2 — quét dọn mỗi khung: người quét đưa TỪNG tem vào GIỮA MÀN nên tem thứ hai nằm đúng
//     vùng tem trước ⇒ mã thật thứ hai bị xoá lại mỗi khung, KHÔNG BAO GIỜ hiện (đo: 3 tem ra 2).
// Kết luận: "trùng vị trí" không phân biệt được bản-đọc-sai với tem-khác-đưa-vào-cùng-chỗ, vì hai
// việc đó nhìn y như nhau trong dữ liệu. MẤT MÃ THẬT tệ hơn hiện thêm một dòng rác (dòng rác thì
// người quét thấy và xoá được; mã thiếu thì không ai biết mà tìm).
// ⇒ Ở đây CHỈ gom + đếm. Dòng ít lần thấy được GẮN CỜ "chưa chắc" trên màn (WEAK_HITS ở
//   MultiScanTest) để người quét tự soi — báo cho người, không tự đoán rồi xoá.
//
// Lớp nhiễu DUY NHẤT xử ở đây (an toàn, không xoá gì): MỘT tem ra NHIỀU chuỗi — UPC-A trả 12 số,
// khung khác trả 13 số có '0' dẫn đầu ⇒ gom theo `scanKey` (GTIN-13) nên chỉ 1 dòng.
import { isValidTem, scanKey } from './qr'

export interface Point { x: number; y: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface ScanEntry {
  text: string      // chuỗi NGUYÊN VĂN lần đầu thấy (hiển thị)
  valid: boolean    // đúng cấu trúc tem pallet (V1 `_` / V2 `;`)
  at: number        // lần đầu thấy
  hits: number      // số khung đã thấy — dùng để gắn cờ "chưa chắc", KHÔNG dùng để xoá
  box?: Rect        // vùng ảnh lần thấy gần nhất (vẽ khung overlay)
  seenAt?: number
}

/** Vùng bao của một mã trên khung (hệ pixel video). */
export function rectOf(points: Point[]): Rect {
  return {
    x0: Math.min(...points.map(p => p.x)), y0: Math.min(...points.map(p => p.y)),
    x1: Math.max(...points.map(p => p.x)), y1: Math.max(...points.map(p => p.y)),
  }
}

/** Mã KHÔNG phải tem pallet (mã vạch 1D) phải thấy đủ số lần này mới HIỆN — chặn "bóng ma" giải rác
 *  đúng 1 khung. Giữ ở 2 (bằng thời điểm user đánh giá "trải nghiệm tốt"): nâng lên 3 làm mã thật
 *  lên chậm hẳn, mà rác thật của user có tới 3–5 lần nên nâng ngưỡng cũng không diệt được. */
export const MIN_HITS_1D = 2

/** Ghi nhận 1 lần thấy mã — chỉ TÍCH LŨY, không xoá gì. `map` bị thay đổi tại chỗ. */
export function registerHit(
  map: Map<string, ScanEntry>,
  hit: { text: string; points: Point[]; now: number },
): { key: string; entry: ScanEntry } {
  const key = scanKey(hit.text)
  let entry = map.get(key)
  if (!entry) {
    entry = { text: hit.text, valid: isValidTem(hit.text), at: hit.now, hits: 0 }
    map.set(key, entry)
  }
  entry.hits++
  entry.box = rectOf(hit.points)
  entry.seenAt = hit.now
  return { key, entry }
}
