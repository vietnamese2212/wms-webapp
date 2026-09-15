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

import { supabase } from '../lib/supabase'

/** Kho đã khai vị trí nhặt lẻ chưa. */
export async function hasPickFace(warehouseId: string | null | undefined): Promise<boolean> {
  if (!warehouseId) return false
  const { data } = await supabase.from('Location').select('id')
    .eq('warehouse_id', warehouseId).eq('is_pick_face', true).eq('is_active', true).limit(1)
  return (data ?? []).length > 0
}

/** Câu nói chung cho cả màn chỉ đường lẫn cửa quét — một chỗ sửa chữ. */
export function looseFillMessage(fromLocation: string | null | undefined): string {
  return fromLocation
    ? `Hàng lẻ phải nhặt ở VỊ TRÍ NHẶT LẺ — cần fill từ ô ${fromLocation} xuống trước.`
    : 'Hàng lẻ phải nhặt ở VỊ TRÍ NHẶT LẺ — cần fill hàng xuống trước.'
}
