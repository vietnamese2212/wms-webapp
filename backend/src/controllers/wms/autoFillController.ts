/**
 * "CHẠY NGAY" bộ tự ra lệnh fill (15/09).
 *
 * Đường thường của tính năng là HÀNG ĐỢI theo (kho, ngày xuất): trigger DB ghi khi đơn / chuyến / tồn ở
 * ô lẻ đổi, trang Việc cần làm / Nhặt lẻ / Fill hàng lấy ra và đối chiếu (`drainFillQueue`). Cửa này là
 * đường BẤM TAY cho hai việc mà hàng đợi không phục vụ: ngày xuất ngoài chân trời hôm nay + mai (dựng
 * lại sau khi sửa đơn xa), và muốn có lệnh NGAY không đợi lượt đọc kế tiếp. Cùng quyền với nút "Ra
 * lệnh fill" bấm tay (`fill.plan`) — nó tạo đúng thứ mà nút đó tạo. Cùng Ổ KHOÁ với đường tự động
 * (`fill_reconcile_lease`): hai lượt đối chiếu cùng kho không được chồng lên nhau.
 *
 * File RIÊNG chứ không nhét vào `fillController`: service `autoFill` đã import fillController, gộp
 * vào đó là vòng import khép kín ngay tại lúc nạp module.
 */
import { NextFunction, Request, Response } from 'express'
import { ok, fail, type PgLikeError } from '../../utils/response'
import { isDay } from '../../utils/dates'
import { db } from '../../lib/supabase'
import { autoFillDay, drainFillQueue, leaseWarehouse, releaseWarehouse, vnToday } from '../../services/autoFill'

/**
 * Xả hàng đợi đối chiếu TRƯỚC khi tính nhu cầu của trang Fill hàng — nếu không, chính người quan tâm
 * nhất mở trang ra lại là người DUY NHẤT không kích hoạt nó (trang Việc cần làm và trang Nhặt lẻ
 * đều có gọi). Đặt ở tầng ROUTE chứ không gọi từ `fillController`: service `autoFill` đã import
 * fillController, gọi ngược lại là vòng import hai chiều. Ngày người xem chọn không quan trọng — hàng
 * đợi tự biết ngày nào của kho đang cần soát (hôm nay và mai).
 */
export async function beforeDemand(req: Request, _res: Response, next: NextFunction) {
  const wh = typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : null
  if (wh) await drainFillQueue(wh)
  next()
}

/** POST /wms/fill/auto — body { warehouse_id, date? } */
export async function runAutoFill(req: Request, res: Response) {
  let leasedWh: string | null = null
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

    if (!(await leaseWarehouse(warehouse_id)))
      return fail(res, 409, 'BUSY', 'Kho này đang được đối chiếu ở một lượt khác — thử lại sau vài giây')
    leasedWh = warehouse_id
    const r = await autoFillDay(warehouse_id, date || vnToday())
    // ⚠️ NHẢ KHOÁ TRƯỚC KHI TRẢ LỜI, không để `finally` lo: trên serverless, response gửi xong là
    // lambda có thể bị ĐÓNG BĂNG giữa việc (luật CLAUDE.md, cùng bẫy với `void fn()`), khoá sẽ treo
    // hết 90 giây và cú bấm "chạy ngay" kế tiếp nhận 409 oan. Đo thật 15/09: gói 18 [22d] đỏ với
    // `created=undefined` vì lượt thứ hai bị chối.
    await releaseWarehouse(warehouse_id)
    leasedWh = null
    return ok(res, r)
  } catch (e) {
    // TRUYỀN CẢ ĐỐI TƯỢNG LỖI (luật 07/09) — `fail` tự dịch: quá hạn truy vấn ⇒ 503 kèm hướng dẫn
    // (quá tải, không thổi cờ "lỗi BE"), mã Postgres ⇒ 4xx đúng nghĩa, còn lại ⇒ 500 kèm câu lỗi
    // THẬT. Bản cũ `String(e)` biến đối tượng lỗi Supabase thành chuỗi "[object Object]" — đo trên
    // staging 15/09: đúng một dòng `error_logs` như vậy, digest dựng được cờ đỏ mà không ai lần ra
    // nổi hỏng ở đâu (chính lớp lỗi "5xx không nói rõ chỗ" đã chốt 21/08).
    return fail(res, e as PgLikeError)
  } finally {
    if (leasedWh) await releaseWarehouse(leasedWh)
  }
}
