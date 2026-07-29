import type { Request } from 'express'

// ─── CHUẨN "KIỂM TRƯỚC KHI GHI" cho MỌI upload Excel (user chốt 29/07) ────────────────────────
// Luồng: FE giữ File → gửi lần 1 với `?preflight=1` (BE parse + validate, KHÔNG ghi gì, trả báo cáo)
// → user xem báo cáo 80% màn hình → bấm Xác nhận → FE gửi LẠI CÙNG file để ghi thật.
//
// Vì sao gửi 2 lần chứ không lưu file tạm ở server: backend chạy serverless (không có ổ đĩa/session
// giữa 2 request). Đổi lại được điều quan trọng hơn: báo cáo do CHÍNH đoạn validate lúc ghi sinh ra
// nên KHÔNG BAO GIỜ lệch với kết quả thật (nếu validate ở FE thì phải nhân đôi logic → tất lệch).
//
// LUẬT: controller chỉ được chèn `if (isPreflight(req)) return ok(res, buildPreflight(...))` vào
// GIỮA pha kiểm và pha ghi — KHÔNG viết lại logic kiểm riêng cho preflight.
export const PREFLIGHT_ERR_CAP = 500
export const PREFLIGHT_WARN_CAP = 200

/** Số liệu riêng của từng luồng (vd "DO đã lên chuyến", "VL06O đồng bộ lúc") — hiện thành ô ở đầu báo cáo. */
export interface PreflightExtra { label: string; value: string | number; warn?: boolean }

export interface UploadPreflight {
  preflight: true
  unit: string                 // đơn vị NGƯỜI DÙNG đọc: 'dòng' | 'chuyến' | 'mã'…
  total: number                // tổng đơn vị đọc được từ file
  to_insert: number
  to_update: number
  skipped: number
  will_write: number           // sẽ ghi bao nhiêu nếu bấm Xác nhận (0 = nút tắt)
  mode: 'all_or_nothing' | 'per_row'
  errors: string[]
  errors_total: number         // có thể > errors.length (đã cắt để không vượt trần payload)
  warnings: string[]
  warnings_total: number
  extra: PreflightExtra[]
}

export function isPreflight(req: Request): boolean {
  return req.query.preflight === '1'
}

export function buildPreflight(p: {
  unit?: string
  total: number
  toInsert?: number
  toUpdate?: number
  skipped?: number
  errors?: string[]
  warnings?: string[]
  mode?: 'all_or_nothing' | 'per_row'
  extra?: PreflightExtra[]
}): UploadPreflight {
  const errors = p.errors ?? []
  const warnings = p.warnings ?? []
  const mode = p.mode ?? 'all_or_nothing'
  const toInsert = p.toInsert ?? 0
  const toUpdate = p.toUpdate ?? 0
  return {
    preflight: true,
    unit: p.unit ?? 'dòng',
    total: p.total,
    to_insert: toInsert,
    to_update: toUpdate,
    skipped: p.skipped ?? 0,
    // all-or-nothing: còn 1 lỗi là KHÔNG ghi gì → will_write = 0 để FE tắt nút Xác nhận
    will_write: mode === 'all_or_nothing' && errors.length > 0 ? 0 : toInsert + toUpdate,
    mode,
    errors: errors.slice(0, PREFLIGHT_ERR_CAP),
    errors_total: errors.length,
    warnings: warnings.slice(0, PREFLIGHT_WARN_CAP),
    warnings_total: warnings.length,
    extra: p.extra ?? [],
  }
}
