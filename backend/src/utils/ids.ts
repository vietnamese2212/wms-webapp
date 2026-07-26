// Lọc id do CLIENT truyền trước khi ném vào query trên cột kiểu `uuid`.
// Vì sao cần: Postgres cast 'not-a-uuid' → lỗi 22P02, controller nuốt thành 500 "Lỗi hệ thống"
// (fuzz API 26/07: material-summary + inbound-plan?tms_order_id đều 500 với id rác).
// Lưu ý: CHỈ dùng cho cột uuid thật (TmsOrder.id, inbound_plan_lines.*_id). Nhiều bảng khác dùng
// id TEXT (Employee 'emp-…', Material, JobTitle 'jt-…') — lọc uuid ở đó sẽ loại oan id hợp lệ.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/** Lọc mảng id client → chỉ uuid hợp lệ, bỏ trùng. */
export const uuidList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter(isUuid))] : []
