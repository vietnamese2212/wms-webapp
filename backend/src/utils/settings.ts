// THAM SỐ VẬN HÀNH đọc từ bảng SystemSetting (đợt 2 chống hardcode 13/08).
//
// VÌ SAO Ở utils/ CHỨ KHÔNG Ở systemSettingController: `utils/response.ts` (ghi error_logs) cũng cần
// đọc cờ retention, mà systemSettingController lại import `ok/fail` từ response.ts ⇒ để getter trong
// controller là import VÒNG. File này chỉ phụ thuộc lib/supabase.
//
// MỘT NGUỒN cho cả 2 chiều: mặc định + validator khai ở đây, systemSettingController dùng chính
// validator này cho PUT, consumer dùng getter — không có bản chép tay nào để lệch.
import { supabase } from '../lib/supabase'

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: unknown }>()

/** Đọc 1 cờ (cache 30s như getLabelFormat). Lỗi đọc / giá trị không hợp lệ → mặc định, KHÔNG ném. */
async function readSetting<T>(key: string, fallback: T, parse: (raw: unknown) => T | null): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T
  let value = fallback
  try {
    const { data } = await supabase.from('SystemSetting').select('value').eq('key', key).maybeSingle()
    const parsed = data?.value == null ? null : parse(data.value)
    if (parsed !== null) value = parsed
  } catch { /* DB lỗi → mặc định; tham số vận hành không được làm chết luồng nghiệp vụ */ }
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Gọi khi PUT /wms/settings — cờ đổi có hiệu lực ngay, không đợi hết TTL. */
export function invalidateSettingsCache(): void { cache.clear() }

// Đòi ĐÚNG kiểu number — Number() ép kiểu quá dễ dãi (`Number([10])`=10, `Number('5')`=5) nên
// validator từng cho mảng/chuỗi lọt và giá trị THÔ được lưu nguyên (QA 23 bắt ngay lượt đầu 13/08).
const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null

// ── retention_days — thời gian GIỮ dữ liệu ────────────────────────────────────
export interface RetentionDays { photos: number; feed: number; error_logs: number }
export const RETENTION_DEFAULT: RetentionDays = {
  photos: 60,      // ảnh check list xe nâng + ảnh chữ in phun sổ đóng gói (user chốt 31/07 & 11/08)
  feed: 3,         // thông báo đích danh trên nút chuông (user chốt 06/08)
  error_logs: 30,  // log lỗi phục vụ digest hằng ngày
}
export function parseRetention(raw: unknown): RetentionDays | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).some(k => !(k in RETENTION_DEFAULT))) return null
  const photos = int(o.photos, 7, 730), feed = int(o.feed, 1, 90), error_logs = int(o.error_logs, 7, 365)
  return photos && feed && error_logs ? { photos, feed, error_logs } : null
}
export const getRetentionDays = () => readSetting('retention_days', RETENTION_DEFAULT, parseRetention)

// ── cycle_count — kiểm kê LUÂN PHIÊN theo hạng ABC ────────────────────────────
export interface CycleCountCfg { A: number; B: number; C: number; window_days: number }
export const CYCLE_COUNT_DEFAULT: CycleCountCfg = { A: 7, B: 30, C: 90, window_days: 30 }
export function parseCycleCount(raw: unknown): CycleCountCfg | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).some(k => !(k in CYCLE_COUNT_DEFAULT))) return null
  const A = int(o.A, 1, 365), B = int(o.B, 1, 365), C = int(o.C, 1, 365), window_days = int(o.window_days, 7, 365)
  if (!A || !B || !C || !window_days) return null
  // Hạng A nhặt nhiều nhất ⇒ phải kiểm DÀY hơn B, B dày hơn C. Đảo thứ tự là sai bản chất ABC.
  if (!(A <= B && B <= C)) return null
  return { A, B, C, window_days }
}
export const getCycleCountCfg = () => readSetting('cycle_count', CYCLE_COUNT_DEFAULT, parseCycleCount)

// ── inbound_edit_window_days — cửa sổ người NHẬP tự sửa/xóa pallet của mình ────
// (quá hạn phải nhờ người có quyền force_* — chứng từ đã chốt sổ.)
export const INBOUND_EDIT_WINDOW_DEFAULT = 2
export const parseInboundEditWindow = (raw: unknown) => int(raw, 1, 90)
export const getInboundEditWindowDays = () =>
  readSetting('inbound_edit_window_days', INBOUND_EDIT_WINDOW_DEFAULT, parseInboundEditWindow)

// ── packing_max_materials_per_run — số mã tối đa trên 1 trang sổ đóng gói ──────
export const PACKING_MAX_MATERIALS_DEFAULT = 10
export const parsePackingMaxMaterials = (raw: unknown) => int(raw, 1, 50)
export const getPackingMaxMaterials = () =>
  readSetting('packing_max_materials_per_run', PACKING_MAX_MATERIALS_DEFAULT, parsePackingMaxMaterials)
