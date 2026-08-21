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

/**
 * Hai vùng TRÙNG KHÍT (IoU ≥ 0.5) = hai chuỗi đang chỉ vào CÙNG một tem trong cùng khoảnh khắc.
 *
 * ⚠️ Đừng nới thành "tâm nằm trong vùng kia": người quét đưa từng tem vào GIỮA MÀN, nên tem thứ hai
 * có tâm nằm đúng trong vùng của tem thứ nhất ⇒ mã thật thứ hai bị coi là bản đọc sai của mã thứ
 * nhất và bị xoá (bug 21/08 do chính chỗ này: quét lần lượt 3 mã thì mã 2 KHÔNG BAO GIỜ hiện).
 * Tem khác thì bề rộng/tỉ lệ khác nên IoU tụt nhanh, còn bản đọc sai của cùng tem thì gần như khít.
 */
export function sameSpot(a: Rect, b: Rect): boolean {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
  const inter = ix * iy
  if (inter <= 0) return false
  const area = (r: Rect) => Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0))
  return inter / (area(a) + area(b) - inter) >= 0.5
}

/** ĐỒNG THỜI = hai chuỗi được thấy cách nhau ≤ 2 khung. Cùng tem đang trong khung thì bản đọc sai
 *  và mã thật nằm ở các khung liền kề; còn đưa tem KHÁC vào cùng chỗ thì mất ít nhất vài trăm ms. */
const SIMULTANEOUS_MS = 250
/** Mã mạnh phải hơn mã yếu ÍT NHẤT 3× số lần thấy mới được gỡ (đo thật: 46× vs 5×, 26× vs 3×). */
const MISREAD_RATIO = 3
/** Chỉ bắt đầu dọn khi mã mạnh đã được thấy đủ nhiều (khỏi dọn theo một khung may mắn). */
const MISREAD_MIN_HITS = 4
/** Gỡ mã ĐANG CÒN THẤY là việc nguy hiểm (có thể là mã thật vừa vào khung) → đòi bằng chứng nặng hơn. */
const MISREAD_LIVE_RATIO = 6
/** Dọn muộn: mã yếu phải NGỪNG xuất hiện ít nhất khoảng này mới coi là đã tắt. */
const STALE_MS = 600
/** Mã KHÔNG phải tem pallet (mã vạch 1D) chỉ được HIỆN khi thấy đủ số lần này — 1D không có mã
 *  sửa lỗi nên một khung nhiễu cũng ra được số thoả checksum. Đo trên bộ khung mờ: mã thật đạt
 *  3–24 lần, còn bản đọc sai của user chỉ 2–5 lần ⇒ 3 là mốc cắt được rác 1 khung mà không mất
 *  mã thật (nâng lên 4 là bắt đầu mất mã thật). */
export const MIN_HITS_1D = 3

/**
 * Ghi nhận 1 lần thấy mã (chỉ TÍCH LŨY, không dọn — dọn nằm ở `sweepMisreads`).
 * `map` bị thay đổi tại chỗ.
 */
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

/**
 * Dọn bản đọc sai: xét MỌI cặp mã 1D còn trong map — cùng vùng ảnh + thấy gần nhau về thời gian
 * ⇒ chỉ một là thật, giữ mã thấy nhiều hơn hẳn. Trả danh sách khoá đã gỡ.
 *
 * Vì sao phải QUÉT LẠI chứ không dọn ngay lúc ghi nhận (bug user báo 21/08 — "quét 14 ra 17"):
 * bản đọc sai sinh ra đúng lúc tem SẮP RA KHỎI KHUNG (mờ dần / lệch góc). Dọn-lúc-ghi cần mã thật
 * được thấy THÊM một lần nữa để kích hoạt, nhưng tem đã rời khung nên lượt đó không bao giờ tới
 * ⇒ dòng rác sống tới cuối phiên. Quét lại sau mỗi khung + trước khi lưu thì không phụ thuộc
 * thứ tự xuất hiện nữa.
 */
export function sweepMisreads(map: Map<string, ScanEntry>, now = 0): string[] {
  const cands = [...map].filter(([, e]) => !e.valid && e.box)
  const removed: string[] = []
  for (const [ks, strong] of cands) {
    if (strong.hits < MISREAD_MIN_HITS) continue
    for (const [kw, weak] of cands) {
      if (kw === ks || !map.has(kw) || !map.has(ks)) continue
      if (!sameSpot(strong.box!, weak.box!)) continue
      const gap = Math.abs((strong.seenAt ?? 0) - (weak.seenAt ?? 0))
      // (A) ĐỒNG THỜI — hai chuỗi cùng một tem đang trong khung: gỡ chuỗi yếu, kể cả nó đang còn
      //     thấy (đây là ca bản đọc sai sinh ra lúc tem sắp rời khung — mã thật sẽ KHÔNG có lượt
      //     nào nữa nên không dọn ở đây thì dòng rác sống tới hết phiên).
      if (gap <= SIMULTANEOUS_MS && weak.hits * MISREAD_LIVE_RATIO <= strong.hits) {
        map.delete(kw); removed.push(kw); continue
      }
      // (B) DỌN MUỘN — mã yếu đã NGỪNG xuất hiện, mã mạnh thì vẫn đang thấy: bản đọc sai tắt còn
      //     mã thật thì tiếp tục. Bắt buộc mã yếu đã tắt, nếu không thì mã THẬT thứ hai (người quét
      //     đưa tem tiếp theo vào GIỮA MÀN, đúng vùng của tem trước) sẽ bị xoá lại mỗi khung.
      const weakStale = weak.seenAt !== now && now - (weak.seenAt ?? 0) >= STALE_MS
      if (weakStale && strong.seenAt === now && weak.hits * MISREAD_RATIO <= strong.hits) {
        map.delete(kw); removed.push(kw)
      }
    }
  }
  return removed
}
