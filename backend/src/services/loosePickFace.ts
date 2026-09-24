// NHẶT LẺ LẤY Ở VỊ TRÍ NHẶT LẺ — luật chung cho 3 cửa cùng trả lời một câu hỏi (user chốt 15/09).
//
// Mô hình của app: phần lẻ lấy bằng TAY ⇒ nó phải nằm ở "vị trí nhặt lẻ" (`Location.is_pick_face`),
// và hàng ở đó phải là lô ĐÚNG NGUYÊN TẮC LUÂN CHUYỂN của kho. Chưa đúng thì việc phải làm KHÔNG
// phải là leo lên kệ nhặt, mà là FILL lô đúng xuống trước (đó chính là lý do có module Fill hàng).
//
// Trước 15/09 luật này chỉ sống ở bộ sinh việc (`directedTasks`: "phần lẻ đã nằm sẵn ở vị trí nhặt
// lẻ = không có việc gì để giao") và ở Fill hàng, còn hai cửa CHỈ ĐƯỜNG — bảng "Theo vị trí" và
// cột "Vị trí lấy" — vẫn đi luân chuyển thuần nên chỉ thẳng lên kệ TẦNG 4 trong khi kho lẻ ngay
// dưới đang có đúng mã đó (đo Ba Vì 15/09: 13/13 điểm ghé đều trên kệ, 0 điểm ở ô nhặt lẻ).
// Cùng lớp lỗi C19.
//
// Hai mức, theo đúng công tắc sẵn có của kho (KHÔNG đẻ cờ mới):
//   • kho KHÔNG tích "Bắt buộc lấy đúng thứ tự" → CẢNH BÁO: bảng lộ trình vẫn chỉ ô có lô đúng
//     (trên kệ) nhưng ghi rõ "cần fill xuống vị trí nhặt lẻ".
//   • kho CÓ tích → CHẶN: dòng không có điểm ghé, và cửa quét nhặt lẻ ngoài vị trí nhặt lẻ trả
//     422 (van xả = quyền `outbound.rotation_override` + lý do, như mọi ca lấy khác thứ tự).
// Kho CHƯA khai vị trí nhặt lẻ nào thì KHÔNG có luật này — không tự bật hộ ai (cùng khuôn "kho có
// vẽ cửa xuất thì mới bắt chọn cửa").

import { db } from '../lib/supabase'

/**
 * ⚠️ HỎI THEO LOẠI KHO CỦA MÃ, KHÔNG PHẢI THEO KHO (vá 15/09, kiểm app).
 *
 * Bản đầu chỉ hỏi "kho có khai ô nhặt lẻ nào không" ⇒ một kho khai ô lẻ cho FG01 là MỌI loại hàng
 * khác cũng bị giục "fill xuống ô lẻ" — trong khi Fill hàng LỌC HẲN mã đó khỏi Đề xuất (không ô nào
 * nhận loại ấy thì không có đích để hạ). Hai cửa nói hai chuyện, và người dùng đi vào NGÕ CỤT: bảng
 * "Theo vị trí" ghi "nên fill xuống ô lẻ" kèm nút "Fill hàng ›", bấm sang thì trang Fill im lặng
 * hoàn toàn về mã đó. Đo Ba Vì 15/09: 3/3 ô nhặt lẻ khai FG01, mã 510000306 (FG02) cần nhặt lẻ 60
 * thùng ⇒ lộ trình gắn `need_fill_from = B_TP3_32_T1` còn Đề xuất chỉ hiện 8/9 mã. Ở kho có tích
 * "bắt buộc lấy đúng thứ tự" thì còn nặng hơn: cửa quét trả 422 mà KHÔNG có đường fill nào để đi ⇒
 * hàng loại đó không ai lấy được. Cùng lớp lỗi C19.
 *
 * Luật nhận loại giống hệt đích fill (`takePickFace`): ô không khai `categories` = nhận MỌI loại;
 * mã chưa khai Loại kho = null-inclusive, ô nào cũng nhận.
 */
export interface PickFaceAcceptor {
  /** Kho đã khai vị trí nhặt lẻ nào chưa (bất kể loại) */
  any: boolean
  /** Có vị trí nhặt lẻ nhận Loại kho này không — đây mới là câu hỏi các cửa cần */
  accepts(category: string | null | undefined): boolean
}

export async function pickFaceAcceptor(warehouseId: string | null | undefined): Promise<PickFaceAcceptor> {
  if (!warehouseId) return { any: false, accepts: () => false }
  const { data } = await db.from('Location').select('categories')
    .eq('warehouse_id', warehouseId).eq('is_pick_face', true).eq('is_active', true)
  const rows = (data ?? []) as { categories: string[] | null }[]
  if (!rows.length) return { any: false, accepts: () => false }
  const anyCat = rows.some(r => !(r.categories ?? []).length)   // ô để trống = nhận mọi loại
  const set = new Set(rows.flatMap(r => r.categories ?? []))
  return { any: true, accepts: cat => anyCat || !cat || set.has(cat) }
}

/**
 * Đưa VỊ TRÍ NHẶT LẺ giữ ĐÚNG LÔ lên đầu danh sách gợi ý. "Đúng lô" = cùng `rot_date` với gợi ý
 * đầu (FEFO nói HSD, FIFO/LIFO nói NSX) ⇒ lấy ô nào cũng KHÔNG phải sai thứ tự, nên chọn ô nhặt
 * lẻ: đó mới là chỗ nhặt bằng tay được. Không có ô nào như vậy ⇒ giữ nguyên thứ tự (và caller nói
 * "cần fill xuống"). MỘT hàm cho mọi cửa chỉ đường hàng lẻ — đừng chép lại phép so này.
 */
export function pickFaceFirst<T extends { is_pick_face: boolean; rot_date: string | null }>(list: T[]): T[] {
  const first = list[0]
  if (!first || first.is_pick_face) return list
  const i = list.findIndex(s => s.is_pick_face && s.rot_date === first.rot_date)
  return i < 0 ? list : [list[i], ...list.filter((_, k) => k !== i)]
}

/** Câu nói chung cho cả màn chỉ đường lẫn cửa quét — một chỗ sửa chữ. */
export function looseFillMessage(fromLocation: string | null | undefined): string {
  return fromLocation
    ? `Hàng lẻ phải nhặt ở VỊ TRÍ NHẶT LẺ — cần fill từ ô ${fromLocation} xuống trước.`
    : 'Hàng lẻ phải nhặt ở VỊ TRÍ NHẶT LẺ — cần fill hàng xuống trước.'
}
