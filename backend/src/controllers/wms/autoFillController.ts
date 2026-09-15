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
import { NextFunction, Request, Response } from 'express'
import { ok, fail } from '../../utils/response'
import { isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { isDay } from '../../utils/dates'
import { db } from '../../lib/supabase'
import { autoFillDay, autoFillSafe, vnToday } from '../../services/autoFill'

/**
 * Chạy bộ tự ra lệnh TRƯỚC khi tính nhu cầu của trang Fill hàng — nếu không, chính người quan tâm
 * nhất mở trang ra lại là người DUY NHẤT không kích hoạt nó (trang Việc cần làm và trang Nhặt lẻ
 * đều có gọi). Đặt ở tầng ROUTE chứ không gọi từ `fillController`: service `autoFill` đã import
 * fillController, gọi ngược lại là vòng import hai chiều.
 * Chỉ chạy cho NGÀY HÔM NAY — người xem trước ngày mai không được kéo theo việc hạ hàng thật.
 */
export async function beforeDemand(req: Request, _res: Response, next: NextFunction) {
  const wh = typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : null
  const d = typeof req.query.date === 'string' ? req.query.date : ''
  if (wh && (!d || d === vnToday())) await autoFillSafe(wh)
  next()
}

/** POST /wms/fill/auto — body { warehouse_id, date? } */
export async function runAutoFill(req: Request, res: Response) {
  try {
    const { warehouse_id, date } = req.body as { warehouse_id?: string; date?: string }
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    // `isDay` của utils/dates (kiểm LỊCH, không chỉ kiểm DẠNG) — regex trần cho '2026-13-99' đi
    // thẳng xuống Postgres và nổ 22008 ⇒ 500. Đúng lỗi đã vá ở chính module này 05/08; tôi chép
    // lại regex trong file mới nên vấp lại (kiểm 15/09).
    if (date && !isDay(date)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')
    const scope = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
    if (scope && scope.length && !scope.includes(warehouse_id))
      return fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được phân quyền')

    // Kho KHÔNG TỒN TẠI phải là 404, không phải 200 "đã chạy, 0 lệnh". `Warehouse.id` là cột TEXT
    // nên id gõ sai không nổ 22P02 mà chỉ khớp 0 dòng — người vận hành đọc "created: 0" rồi kết
    // luận "kho không thiếu gì" trong khi thật ra họ gõ nhầm kho (lớp "thành công giả", CLAUDE.md).
    const { data: wh } = await db.from('Warehouse').select('id').eq('id', warehouse_id).maybeSingle()
    if (!wh) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho này')

    const r = await autoFillDay(warehouse_id, date || vnToday(), { force: true })
    return ok(res, r)
  } catch (e) {
    // Bước tính nhu cầu kéo tồn của mọi mã đang cần ⇒ lúc DB bận có thể chạm trần câu lệnh. Đó là
    // QUÁ TẢI, không phải lỗi lập trình — 503 kèm hướng dẫn, và không thổi cờ cảnh báo "lỗi BE".
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    return fail(res, 500, 'SERVER_ERROR', String(e))
  }
}
