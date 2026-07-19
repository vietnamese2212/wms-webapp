import { Request, Response } from 'express'
import { fail } from './response'

// BASE UNIT (đợt 2, 20/07/2026): mọi trường số lượng trong payload write = SỐ THEO BASE UNIT.
// FE bản mới gắn `qty_semantics: 'base'` vào MỌI body (interceptor axios). Payload thiếu cờ
// = bundle cũ (tab chưa reload / hàng đợi quét offline enqueue trước flip) đang gửi số THÙNG
// thập phân → ghi vào sẽ SAI đơn vị → chặn 409 bắt cập nhật app.
export function requireBaseQty(req: Request, res: Response): boolean {
  if (((req.body ?? {}) as { qty_semantics?: string }).qty_semantics === 'base') return true
  fail(res, 409, 'APP_OUTDATED', 'Ứng dụng phiên bản cũ (số lượng chưa theo đơn vị gốc) — tải lại trang (Ctrl+R) rồi thao tác lại')
  return false
}
