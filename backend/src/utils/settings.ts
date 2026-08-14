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

// ── org_profile — NHẬN DIỆN & THAM SỐ RIÊNG CỦA ĐƠN VỊ (đợt 3 chống hardcode 14/08) ──
// Kiến trúc multi-tenant silo: khác biệt giữa các đơn vị đi qua CỜ, không qua tên đơn vị và
// KHÔNG nằm cứng trong code. 4 giá trị dưới đây trước 14/08 là hằng số của riêng LOF nằm rải rác
// (pushService · weighTicketController · inventoryController · FE loadPlan) — dựng đơn vị 2 mà quên
// một chỗ là mang danh tính/tham số của LOF sang. MẶC ĐỊNH = ĐÚNG giá trị LOF đang chạy, nên đơn vị 1
// không đổi hành vi khi chưa cấu hình gì.
export interface OrgProfile {
  contact_email: string                                   // subject VAPID của Web Push (mailto:)
  weigh_station_code: string                              // mã trạm cân mặc định khi agent không gửi station_code
  nmsx_alias: Record<string, string>                      // gộp mã nhà máy CŨ → MỚI khi đọc đoạn NMSX của tem V1
  assumed_carton_mm: { l: number; w: number; h: number }  // cỡ thùng giả định cho mã CHƯA khai kích thước (sơ đồ xếp xe)
}
export const ORG_PROFILE_DEFAULT: OrgProfile = {
  contact_email: 'wms@lof.vn',
  weigh_station_code: 'KB01',              // Cân Kinh Bắc — trạm đầu tiên tích hợp
  nmsx_alias: { A: 'O' },                  // "A" là mã cũ của nhà máy O
  assumed_carton_mm: { l: 422, w: 233, h: 100 },
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function parseOrgProfile(raw: unknown): OrgProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).some(k => !(k in ORG_PROFILE_DEFAULT))) return null
  const email = typeof o.contact_email === 'string' ? o.contact_email.trim() : ''
  if (!EMAIL_RE.test(email) || email.length > 120) return null
  const station = typeof o.weigh_station_code === 'string' ? o.weigh_station_code.trim() : ''
  if (!station || station.length > 20) return null
  // alias: mã nhà máy là 1 ký tự/đoạn ngắn, ánh xạ CŨ → MỚI; rỗng {} là hợp lệ (đơn vị không có mã cũ)
  if (!o.nmsx_alias || typeof o.nmsx_alias !== 'object' || Array.isArray(o.nmsx_alias)) return null
  const aliasIn = o.nmsx_alias as Record<string, unknown>
  const nmsx_alias: Record<string, string> = {}
  for (const [k, v] of Object.entries(aliasIn)) {
    if (!k.trim() || k.length > 10 || typeof v !== 'string' || !v.trim() || v.length > 10) return null
    nmsx_alias[k.trim()] = v.trim()
  }
  if (Object.keys(nmsx_alias).length > 50) return null
  const c = o.assumed_carton_mm as Record<string, unknown> | undefined
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  if (Object.keys(c).some(k => !'lwh'.includes(k) || k.length !== 1)) return null
  const l = int(c.l, 1, 5000), w = int(c.w, 1, 5000), h = int(c.h, 1, 5000)
  if (!l || !w || !h) return null
  return { contact_email: email, weigh_station_code: station, nmsx_alias, assumed_carton_mm: { l, w, h } }
}
export const getOrgProfile = () => readSetting('org_profile', ORG_PROFILE_DEFAULT, parseOrgProfile)

// ── vn_holidays — LỊCH NGHỈ LỄ theo NĂM (đợt 3 chống hardcode 14/08) ──────────
// FE có sẵn thuật toán âm lịch (Tết, Giỗ Tổ) + 4 lễ dương cố định, nhưng SỐ NGÀY NGHỈ THẬT do
// Chính phủ công bố lại HÀNG NĂM (nghỉ bù cuối tuần, Tết 5/7/9 ngày…) — trước 14/08 muốn đúng
// phải sửa code. Nay: năm nào KHAI ở đây thì dùng ĐÚNG danh sách khai; năm KHÔNG khai vẫn chạy
// thuật toán cũ ⇒ chưa cấu hình gì thì hành vi y như trước.
export interface HolidayItem { date: string; name: string }
export type VnHolidays = Record<string, HolidayItem[]>   // '2026' → danh sách ngày nghỉ của năm đó
export const VN_HOLIDAYS_DEFAULT: VnHolidays = {}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export function parseVnHolidays(raw: unknown): VnHolidays | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Object.keys(o).length > 20) return null
  const out: VnHolidays = {}
  for (const [year, list] of Object.entries(o)) {
    if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) return null
    if (!Array.isArray(list) || list.length > 60) return null
    const items: HolidayItem[] = []
    for (const it of list) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) return null
      const d = (it as Record<string, unknown>).date, n = (it as Record<string, unknown>).name
      if (typeof d !== 'string' || !ISO_DATE.test(d) || d.slice(0, 4) !== year) return null
      // ngày phải TỒN TẠI trên lịch (31-02 khớp regex nhưng không có thật)
      const [y, m, dd] = d.split('-').map(Number)
      const chk = new Date(Date.UTC(y, m - 1, dd))
      if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== dd) return null
      if (typeof n !== 'string' || !n.trim() || n.length > 80) return null
      if (items.some(x => x.date === d)) return null      // trùng ngày trong cùng năm
      items.push({ date: d, name: n.trim() })
    }
    out[year] = items
  }
  return out
}
export const getVnHolidays = () => readSetting('vn_holidays', VN_HOLIDAYS_DEFAULT, parseVnHolidays)
