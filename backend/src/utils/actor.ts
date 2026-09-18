// AI ĐANG LÀM — MỘT nguồn cho mọi cột vết (`*_by`, `scanned_by`, `counted_by`…).
//
// Vì sao tập trung: lớp lỗi "ai làm lấy từ THÂN REQUEST" đã nổ ba lần trong hai ngày —
//   · 17/09 `OutboundScanEntry.scanned_by`  → 288/288 dòng quét xuất KHÔNG có tên
//   · 18/09 `InventoryAdjustmentLog.actor`  → dòng điều chỉnh tồn KHÔNG có tên
//   · 18/09 `ProductionImport.updated_by`   → 0/22.986 phiếu nhập ĐÃ HOÀN THÀNH có tên
// Cả ba cùng một hình dạng: client gửi thì có, không gửi thì mất — mà FORM luôn gửi, nên thử tay
// không bao giờ thấy; chỉ bundle PWA cũ, script, tích hợp và các nút KHÔNG gửi thân request mới lộ.
// Sau hai lần vá là hai bản chép tay khác nhau; bản thứ ba sắp ra đời thì gom về đây.
//
// LUẬT: client gửi thì TIN client (nhiều màn cho chọn NGƯỜI KHÁC — thủ kho ghi hộ, xe nâng nhận
// việc hộ); KHÔNG gửi thì rơi về NGƯỜI ĐANG ĐĂNG NHẬP. Không bao giờ để trống khi token có id.
import type { Request } from 'express'

// Các cột vết có KHOÁ NGOẠI tới `Employee(id)` nên chỉ nhận UUID. Giá trị không phải UUID (tên
// người, mã nhân viên, chuỗi rác của bundle cũ) phải thành null — vết thiếu còn hơn 23503 làm
// hỏng cả lượt ghi nghiệp vụ.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (s?: unknown): s is string => typeof s === 'string' && UUID_RE.test(s)

/** NGƯỜI ĐANG ĐĂNG NHẬP dạng UUID; null khi token không mang id hợp lệ. */
export const actorUuid = (req: Request): string | null =>
  isUuid(req.user?.sub) ? (req.user?.sub as string) : null

/**
 * Người thực hiện cho một cột vết: `bodyId` client gửi (nếu là UUID) → nếu không thì người đăng nhập.
 * Dùng cho MỌI cửa ghi có cột `*_by`.
 */
export const resolveActorId = (req: Request, bodyId?: unknown): string | null =>
  isUuid(bodyId) ? bodyId : actorUuid(req)

/** Tên người thực hiện cho cột vết dạng CHỮ (`actor_name`, `counted_by_name`…). */
export const resolveActorName = (req: Request, bodyName?: unknown): string | null =>
  (typeof bodyName === 'string' && bodyName.trim()) || req.user?.name || null
