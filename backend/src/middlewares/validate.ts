// ── KIỂM ĐẦU VÀO TẠI BIÊN (11/09/2026) — MỘT chỗ thay cho việc vá 400 từng route ──────────────────
//
// VÌ SAO: lớp lỗi lặp nhiều nhất trong 30 ngày (hơn 60 ca cùng khuôn) là input xấu đi thẳng xuống
// Postgres rồi nổ 500 — body là SỐ nên `.trim()` ném TypeError, id rác → 22P02, ngày '2026-02-31' →
// 22008, thiếu field → 23502. Mỗi lần fix một route, route viết sau lại vấp. Khai schema NGAY TRÊN
// route thì (a) sai kiểu = 400 kèm tên trường trước khi vào controller, (b) `req.body` sau đó đã được
// ép kiểu/trim đúng như schema, (c) ratchet `write_route_without_validate` (gói 09) chặn route write
// MỚI không khai schema.
//
// CÁCH DÙNG (route write mới BẮT BUỘC; route cũ chuyển dần khi chạm):
//   router.post('/x', requirePerm('m', 'a'), validate({ body: z.object({ name: zText(1, 120) }) }), ctrl.create)
//   router.patch('/x/:id', requirePerm('m', 'a'), validate({ params: zIdParam, body: … }), ctrl.update)
// Chỉ khai phần cần (body / params / query). Schema lấy từ `zod`; các mảnh dùng chung ở dưới.
// Lỗi trả đúng khuôn app: { success:false, error:{ code:'VALIDATION', message:'body.qty: phải là số' } }.
import type { RequestHandler } from 'express'
import { z, type ZodTypeAny, type ZodIssue } from 'zod'
import { fail } from '../utils/response'
import { isDay } from '../utils/dates'

type Parts = { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny }

// Câu lỗi tiếng Việt cho các mã zod hay gặp — người dùng đọc "phải là số", không đọc "Expected number".
function viMessage(i: ZodIssue): string {
  switch (i.code) {
    case 'invalid_type':
      if (i.received === 'undefined' || i.received === 'null') return 'bắt buộc'
      return `phải là ${TYPE_VI[i.expected] ?? i.expected} (nhận ${TYPE_VI[i.received] ?? i.received})`
    case 'too_small':
      return i.type === 'string' ? (i.minimum === 1 ? 'không được để trống' : `tối thiểu ${i.minimum} ký tự`)
        : i.type === 'array' ? `cần ít nhất ${i.minimum} mục` : `tối thiểu ${i.minimum}`
    case 'too_big':
      return i.type === 'string' ? `tối đa ${i.maximum} ký tự` : i.type === 'array' ? `tối đa ${i.maximum} mục` : `tối đa ${i.maximum}`
    case 'invalid_enum_value': return `phải là một trong: ${i.options.join(', ')}`
    case 'invalid_string': return i.validation === 'uuid' ? 'không phải id hợp lệ' : 'không đúng dạng'
    case 'unrecognized_keys': return `trường không nhận: ${i.keys.join(', ')}`
    default: return i.message || 'không hợp lệ'
  }
}
const TYPE_VI: Record<string, string> = {
  string: 'chuỗi', number: 'số', boolean: 'đúng/sai', object: 'đối tượng', array: 'danh sách',
  undefined: 'trống', null: 'null', nan: 'NaN', integer: 'số nguyên', date: 'ngày',
}

export function validate(schemas: Parts): RequestHandler {
  return (req, res, next) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part]
      if (!schema) continue
      const r = schema.safeParse(req[part])
      if (!r.success) {
        const issue = r.error.issues[0]
        const where = issue?.path?.length ? `${part}.${issue.path.join('.')}` : part
        return fail(res, 400, 'VALIDATION', `${where}: ${issue ? viMessage(issue) : 'không hợp lệ'}`)
      }
      // Express 4: req.query/req.params là thuộc tính thường — gán bản đã ép kiểu để controller dùng thẳng
      ;(req as unknown as Record<string, unknown>)[part] = r.data
    }
    next()
  }
}

// ── MẢNH DÙNG CHUNG — dùng lại, đừng viết lại ────────────────────────────────────────────────────
/** Chuỗi có nội dung, đã trim, có trần độ dài (cột text nào cũng có trần thực tế). */
export const zText = (min = 1, max = 500) => z.string().trim().min(min).max(max)
/** Id trên URL/body: chuỗi 1..200 — KHÔNG ép dạng UUID (48/82 bảng có id TEXT, JobTitle id 'jt-admin'). */
export const zId = z.string().trim().min(1).max(200)
export const zIdParam = z.object({ id: zId })
/** Ngày nghiệp vụ 'YYYY-MM-DD' — kiểm LỊCH THẬT qua isDay (2026-02-31 bị chặn ở đây, không xuống Postgres 22008). */
export const zDay = z.string().trim().refine(isDay, 'ngày không đúng dạng YYYY-MM-DD hoặc không có thật')
/** Số lượng theo BASE: số hữu hạn, không âm (số nguyên hay không do luật mã hàng quyết ở controller qua qtyIntegerError). */
export const zQtyBase = z.number().finite().min(0)
/** Số nguyên không âm (STT, số trang, đếm). */
export const zInt0 = z.number().int().min(0)
/** Chuỗi số từ query string → số nguyên không âm (page/limit) — query luôn là chuỗi. */
export const zIntFromQuery = z.coerce.number().int().min(0)
/** Cờ đúng/sai (body); nhận cả 'true'/'false' chuỗi từ form cũ. */
export const zBool = z.union([z.boolean(), z.enum(['true', 'false']).transform(v => v === 'true')])
export { z }
