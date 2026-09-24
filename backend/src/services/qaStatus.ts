/**
 * "QA ĐANG GIỮ" — MỘT nguồn cho toàn app.
 *
 * VÌ SAO CÓ FILE NÀY (đo thật 13/09/2026 trên staging): cột `InventoryEntry.qa_status_id` trỏ vào
 * danh mục `QAStatus`, trong đó **`OK` nghĩa là QA ĐÃ DUYỆT** — còn `X` / `XCQ` / `X7` mới là giữ.
 * Cửa QUÉT XUẤT vốn hiểu đúng (`inv.qa_status?.code !== 'OK'`), nhưng mọi cửa CHỈ ĐƯỜNG lại coi
 * "có giá trị = đang giữ", nên cùng một pallet: quét thì xuất được, mà gợi ý/kế hoạch/kiểm tồn thì
 * bảo "không còn hàng". Hậu quả đo được ở Ba Vì:
 *   • 8.760 pallet bị Giám sát vận hành đếm là "kẹt" trong khi thực tế chỉ 5
 *   • 83 mã KHÔNG chốt được BẤT KỲ mức %Date nào (kể cả 1 %) dù kho đầy hàng xuất được
 *   • 336.960 base biến mất khỏi phép đếm tồn của màn chốt
 * Và đây KHÔNG phải rác dữ liệu: quét nhập tem V2 (`;`) tự đóng dấu `OK` (`qa_ok ? 'OK' : 'X'`),
 * nên đơn vị dùng tem chấm phẩy sẽ có 100 % tồn vô hình với Việc cần làm.
 *
 * Luật gốc nằm ngay trong migration đầu tiên: "bỏ trống = mặc định OK, không cần lưu vào
 * qa_status_id" ⇒ dấu OK phải được đối xử NHƯ BỎ TRỐNG.
 *
 * Thêm điểm đọc QA mới → gọi `qaHoldIds()` rồi `isQaHold()`, ĐỪNG tự viết `qa_status_id IS NOT NULL`
 * (ratchet `qa_hold_rule_hand_rolled` gác).
 */
import { db } from '../lib/supabase'

/** Mã trạng thái nghĩa là "QA đã duyệt" — mọi mã khác là GIỮ. Khớp đúng cửa quét xuất. */
export const QA_PASS_CODE = 'OK'

const CACHE_MS = 30_000
let cache: { at: number; hold: Set<string>; pass: string[] } | null = null

/** Bộ id trạng thái QA nghĩa là ĐANG GIỮ (danh mục nhỏ, nhớ 30 giây như các getter cờ khác). */
export async function qaStatusSets(): Promise<{ hold: Set<string>; pass: string[] }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache
  const { data } = await db.from('QAStatus').select('id, code')
  const rows = (data ?? []) as Array<{ id: string; code: string | null }>
  const hold = new Set(rows.filter(r => (r.code ?? '') !== QA_PASS_CODE).map(r => r.id))
  const pass = rows.filter(r => (r.code ?? '') === QA_PASS_CODE).map(r => r.id)
  cache = { at: Date.now(), hold, pass }
  return cache
}

export async function qaHoldIds(): Promise<Set<string>> { return (await qaStatusSets()).hold }

/** Chỉ dùng trong phép kiểm — buộc đọc lại danh mục ngay sau khi sửa. */
export function clearQaStatusCache(): void { cache = null }

/**
 * Điều kiện lọc PostgREST "pallet KHÔNG bị QA giữ" = chưa gắn QA **hoặc** gắn dấu đã duyệt.
 * Đừng thay bằng `not.in` — cột NULL không lọt qua `NOT IN` của SQL.
 */
export async function qaNotHeldFilter(): Promise<string> {
  const { pass } = await qaStatusSets()
  return pass.length ? `qa_status_id.is.null,qa_status_id.in.(${pass.join(',')})` : 'qa_status_id.is.null'
}
