/**
 * "CHẠY NGAY" bộ tự ra lệnh fill (15/09).
 *
 * Đường thường của tính năng là quét LƯỜI theo traffic (trang Việc cần làm / trang Nhặt lẻ gọi kèm,
 * throttle 10'). Cửa này là đường BẤM TAY cho hai việc mà đường lười không phục vụ được:
 *   · ngày xuất KHÁC hôm nay (xem trước ca đêm, hoặc dựng lại sau khi sửa đơn),
 *   · muốn có lệnh NGAY, không đợi hết nhịp throttle.
 * Cùng quyền với nút "Ra lệnh fill" bấm tay (`fill.plan`) — nó tạo đúng thứ mà nút đó tạo.
 *
 * File RIÊNG chứ không nhét vào `fillController`: service `autoFill` đã import fillController, gộp
 * vào đó là vòng import khép kín ngay tại lúc nạp module.
 */
import { Request, Response } from 'express'
import { ok, fail } from '../../utils/response'
import { isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { autoFillDay, vnToday } from '../../services/autoFill'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** POST /wms/fill/auto — body { warehouse_id, date? } */
export async function runAutoFill(req: Request, res: Response) {
  try {
    const { warehouse_id, date } = req.body as { warehouse_id?: string; date?: string }
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (date && !DAY_RE.test(date)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')
    const scope = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
    if (scope && scope.length && !scope.includes(warehouse_id))
      return fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được phân quyền')

    const r = await autoFillDay(warehouse_id, date || vnToday(), { force: true })
    return ok(res, r)
  } catch (e) {
    // Bước tính nhu cầu kéo tồn của mọi mã đang cần ⇒ lúc DB bận có thể chạm trần câu lệnh. Đó là
    // QUÁ TẢI, không phải lỗi lập trình — 503 kèm hướng dẫn, và không thổi cờ cảnh báo "lỗi BE".
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    return fail(res, 500, 'SERVER_ERROR', String(e))
  }
}
