// VIỆC CỦA NGƯỜI trên kế hoạch điều vận — MỘT nguồn cho cả bảng "Danh sách xe" lẫn "Bàn ghép xe" (25/09): hai góc nhìn
// của cùng một kế hoạch mà đếm "cần xử lý" hai kiểu thì người soát không biết tin bên nào.
//
// Vì sao có (user chốt 24/09 "máy ghép trước sau đó tới người manual và xác nhận"): đo trên kế hoạch thật của Ba Vì 07/09
// **12/61 xe cần người quyết**, nằm rải trong 61 dòng. Trang phải trả lời ngay "còn bao nhiêu việc" và đưa người tới đó.
// ⚠ CHỈ tính trên xe NGƯỜI CÒN SỬA ĐƯỢC (DRAFT/DECLINED) — xe đã vào Kế hoạch xuất mà thiếu cước thì không chữa ở đây.
// ⚠ `todo` = NGƯỜI ĐÓNG ĐƯỢC. "Chưa có cước" / "Có cảnh báo" thì không: bảng cước thiếu (phường × dòng xe) thì gán ĐVVT xong
// vẫn thiếu — đếm vào là bộ đếm KHÔNG BAO GIỜ về 0 (đo 24/09), và bộ đếm không về 0 dạy người ta bỏ qua nó.
// 25/09 thêm "OD đổi ở SAP": OD trên xe bị SAP thay (sửa SO) / bỏ / đã xuất / đã điều cho ĐVVT khác sau khi lập nháp —
// việc NGƯỜI ĐÓNG ĐƯỢC (thay OD / kéo OD ra), và cửa Xác nhận chặn 409 nếu còn.
import type { DispatchTrip, DispatchTripStatus, DispatchOdFlag } from '@/api/hooks'

export const EDITABLE: DispatchTripStatus[] = ['DRAFT', 'DECLINED']
export const tripStatus = (t: DispatchTrip): DispatchTripStatus => t.status ?? 'DRAFT'
export type IssueKey = 'declined' | 'sapflag' | 'nomodel' | 'nocarrier' | 'nofreight' | 'over' | 'under' | 'warn'
export type IssueCtx = { flags: Map<string, DispatchOdFlag> }
/** Cờ SAP chỉ THAM CHIẾU (user chốt 03/10 tối): "SAP đã post" / "SAP đã gắn xe" không loại đơn, không chặn Xác nhận — nên cũng
 *  KHÔNG là việc "OD đổi ở SAP" (06/10: Bàu Bàng 695/709 xe "cần xử lý" chỉ vì cờ này; cửa Xác nhận + bảng Xem đơn đã đọc đúng). */
export const SOFT_FLAG_KINDS = new Set<DispatchOdFlag['kind']>(['SHIPPED', 'SAP_ASSIGNED'])
const hardFlag = (c: IssueCtx, od: string) => { const k = c.flags.get(od)?.kind; return !!k && !SOFT_FLAG_KINDS.has(k) }
export const ISSUES: { key: IssueKey; label: string; tip: string; todo: boolean; test: (t: DispatchTrip, c: IssueCtx) => boolean }[] = [
  { key: 'declined',  label: 'ĐVVT từ chối',   todo: true,  tip: 'Đổi ĐVVT trong panel xe rồi "Chốt xe này"',                     test: t => tripStatus(t) === 'DECLINED' },
  { key: 'sapflag',   label: 'OD đổi ở SAP',   todo: true,  tip: 'OD trên xe bị SAP thay (sửa SO) / bỏ / sửa / đã vào Kế hoạch xuất sau khi lập nháp — thay OD, cập nhật theo SAP hoặc kéo OD ra khỏi xe. Cờ "SAP đã post / đã gắn xe" chỉ là tham chiếu, không tính ở đây', test: (t, c) => t.ods.some(o => hardFlag(c, o.od_number)) },
  { key: 'nomodel',   label: 'Chưa có dòng xe', todo: true, tip: 'Máy không tìm được dòng xe vừa tải / đủ điều kiện bảo quản',    test: t => t.ods.length > 0 && !t.vehicle_model_id },
  { key: 'nocarrier', label: 'Chưa có ĐVVT',   todo: true,  tip: 'Không ĐVVT nào có cước cho tuyến + dòng xe này — chọn tay',      test: t => t.ods.length > 0 && !t.transport_company_id },
  { key: 'over',      label: 'Vượt tải',       todo: true,  tip: 'Xe vượt sức chứa dòng xe — kéo bớt OD sang xe khác, đổi xe lớn hơn, hoặc giữ nếu chắc xe chở nổi', test: t => t.oversize },
  { key: 'under',     label: 'Non tải',        todo: true,  tip: 'Dưới ngưỡng Non tải — máy đã thử gộp cùng vùng, còn lại cần người quyết', test: t => t.underload },
  { key: 'nofreight', label: 'Chưa có cước',   todo: false, tip: 'Thường vì bảng cước chưa có tuyến + dòng xe này — xác nhận vẫn được, chuyến sẽ không có cước dự tính', test: t => t.ods.length > 0 && t.freight_estimated == null },
  { key: 'warn',      label: 'Có cảnh báo',    todo: false, tip: 'Máy ghi lại chỗ nó không tự xử được — đọc Ghi chú máy',          test: t => t.detail.warnings.length > 0 },
]
export const TODO_KEYS = new Set(ISSUES.filter(i => i.todo).map(i => i.key))
export const issuesOf = (t: DispatchTrip, c: IssueCtx): IssueKey[] =>
  EDITABLE.includes(tripStatus(t)) ? ISSUES.filter(i => i.test(t, c)).map(i => i.key) : []
export const needsWork = (t: DispatchTrip, c: IssueCtx) => issuesOf(t, c).some(k => TODO_KEYS.has(k))
// Nhãn NGẮN, xếp theo mức KHẨN — in ngay dưới Số xe (bảng) / trên thẻ xe (bàn ghép)
export const ISSUE_SHORT: Record<IssueKey, string> = {
  declined: 'ĐVVT từ chối', sapflag: 'OD đổi ở SAP', over: 'vượt tải', nomodel: 'chưa có dòng xe', nocarrier: 'chưa có ĐVVT',
  nofreight: 'chưa có cước', under: 'Non tải', warn: 'có cảnh báo',
}
export const ISSUE_ORDER: IssueKey[] = ['declined', 'sapflag', 'over', 'nomodel', 'nocarrier', 'nofreight', 'under', 'warn']
/** Lựa chọn trên bàn ghép xe SAU một lần chuyển: chỉ bỏ các đơn VỪA chuyển — kế hoạch lớn trả lời chậm (709 xe ~8 s), ô người tick
 *  trong lúc chờ phải còn (06/10: Hoàn tác xong xoá sạch lựa chọn ⇒ lần kéo sau chỉ mang một đơn). Không đổi gì thì trả CHÍNH tập cũ. */
export const selectionAfterMove = (sel: Set<string>, moved: string[]): Set<string> => {
  if (!moved.some(id => sel.has(id))) return sel
  const n = new Set(sel)
  for (const id of moved) n.delete(id)
  return n
}
export const FLAG_VI: Record<DispatchOdFlag['kind'], string> = {
  // 03/10 tối: SHIPPED / SAP_ASSIGNED là cờ THAM CHIẾU (không loại đơn, không chặn Xác nhận) — chữ phải nói "SAP nói vậy", không khẳng định hàng đã đi
  REPLACED: 'SAP đã thay', GONE: 'SAP đã bỏ', SHIPPED: 'SAP đã post', SAP_ASSIGNED: 'SAP đã gắn xe', IN_PLAN: 'Đã vào KH xuất', CHANGED: 'SAP đã sửa',
  KIN_SHIPPED: 'Họ hàng đã đi',   // 03/10: OD cùng dòng SO với OD đã đi — cờ CỨNG, người bấm "Xác nhận đơn bổ sung" ở tab Xem đơn mới đi được
}
