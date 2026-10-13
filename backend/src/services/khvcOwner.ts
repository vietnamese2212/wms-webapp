// CHỦ của một Số xe trong Kế hoạch xuất (13/10, user chốt "bàn ghép xe là cửa ghi duy nhất"): dòng `source='DISPATCH'` do bàn ghi ⇒
// mọi cửa dẫn xuất từ chối sửa (chuyến Xuất kho · lệnh VC) phải CHỈ ĐÚNG ĐƯỜNG về nguồn — bảo "sửa ở tab Kế hoạch xuất" khi tab đó
// cũng đang khoá dòng (409 KHVC_LINE_FROM_DISPATCH) là bắt người dùng đi hai vòng. Chỉ gọi trên đường lỗi (một câu đếm, không tốn
// cho lượt sửa hợp lệ).
import { db } from '../lib/supabase'

export const KHVC_HINT_TAB = 'tab "Kế hoạch xuất" (Dữ liệu bên ngoài)'
export const KHVC_HINT_BOARD = 'Bàn ghép xe (Điều vận — xe này do bàn ghi, tab Kế hoạch xuất cũng khoá)'

/** NƠI sửa nguồn của Số xe (cụm danh từ, caller thêm "sửa ở …"): bàn ghép xe nếu có dòng DISPATCH còn hiệu lực, không thì tab Kế hoạch xuất. */
export async function khvcSourceHint(groupCode: string | null | undefined): Promise<string> {
  const gc = String(groupCode ?? '').trim()
  if (!gc) return KHVC_HINT_TAB
  const { count } = await db.from('khvc_lines').select('id', { count: 'exact', head: true })
    .eq('group_code', gc).eq('source', 'DISPATCH').neq('sync_status', 'OBSOLETE')
  return (count ?? 0) > 0 ? KHVC_HINT_BOARD : KHVC_HINT_TAB
}
