import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { ALERT_TH_CONFIG_KEYS, invalidateAlertThresholdsCache } from '../../services/alertScanner'
import {
  invalidateSettingsCache, parseRetention, parseCycleCount,
  parseInboundEditWindow, parsePackingMaxMaterials, parseOrgProfile, parseVnHolidays,
} from '../../utils/settings'

// SystemSetting: cờ hành vi per-DB (multi-tenant SILO — cờ theo KHÁC BIỆT, không theo đơn vị).
// SỔ CỜ (thêm cờ mới = thêm dòng vào KNOWN_SETTINGS + ghi chú ở đây):
// - label_format: 'underscore' | 'semicolon' — định dạng tem pallet khi IN từ app.
//     underscore (mặc định, đơn vị 1): ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX
//     semicolon  (đơn vị 2):           Mã hàng;QA;Mã lô;NSX;HSD;Mẻ;Giờ:Phút
//   Chiều IN: quyết định format tem sinh. Chiều QUÉT inbound: cờ GATE format (getLabelFormat) —
//   ';' chỉ nhận tem ';', '_' chỉ nhận tem '_' (mỗi đơn vị 1 format cố định; quét nhầm → chặn).

// - delivery_confirmation: { enabled: boolean, modes: ('QR'|'QTY'|'NONE'|'OTHER')[] } — xác nhận giao hàng.
//     enabled=false → xuất kho KHÔNG tạo booking TMS (Chuyển kho).
//     enabled=true  → chỉ tạo booking cho HÌNH THỨC KHO NHẬN có trong modes (theo inventory_mode của kho khớp
//       shipto; không khớp DB = 'OTHER'). QR/QTY = luồng nhận-quét như cũ; NONE/OTHER = tài xế TỰ HOÀN THÀNH.
//     Mặc định (khi chưa cấu hình) = { enabled:true, modes:['QR','QTY'] } → giữ nguyên hành vi đơn vị 1.

// - decimal_separator: 'dot' | 'comma' — dấu thập phân cho ô nhập số (KG/decimal) ở form (vd Mã hàng).
//     dot (mặc định): 1.5 · comma: 1,5. App CHẶN dấu còn lại khi nhập + parse theo cờ này.

// - truck_models: Array<{ name, l, w, h }> — sổ DÒNG XE ghi nhớ lòng thùng (mm) cho sơ đồ xếp xe 3D.
//     ĐỘC LẬP với Loại xe TMS (user chốt 13/07: 1 loại xe booking có nhiều dòng xe thực tế — dims không
//     treo trên Loại xe). Ghi = wms_settings.manage_system (nút Lưu/Xóa trong dialog 3D gate quyền này).

// - alert_thresholds: 7 ngưỡng của trung tâm cảnh báo (user yêu cầu tùy biến 10/08 — vd %Date 10→15):
//     { PCT_WARN, PCT_CRIT, GATE_WARN_MIN, GATE_CRIT_MIN, TRIP_STUCK_HOURS, WEIGH_WARN_PCT, WEIGH_CRIT_PCT }.
//     Chưa cấu hình = mặc định THRESHOLDS trong alertScanner. UI = tab "Cài đặt ngưỡng" trang Thông báo.
//     Ràng buộc chéo: PCT_CRIT ≤ PCT_WARN (thấp hơn = nguy hơn) · GATE/WEIGH crit ≥ warn.

// ── THAM SỐ VẬN HÀNH (đợt 2 chống hardcode 13/08) — mặc định + validator ở `utils/settings.ts`
//    (MỘT nguồn: getter của consumer và validator của PUT dùng chung, không có bản chép tay).
//    UI = tab "Hệ thống" trang Cài đặt WMS.
// - retention_days: { photos, feed, error_logs } — số NGÀY giữ ảnh / thông báo cá nhân / log lỗi.
// - cycle_count: { A, B, C, window_days } — chu kỳ kiểm kê luân phiên theo hạng + cửa sổ phân hạng ABC.
// - inbound_edit_window_days: số ngày người NHẬP còn tự sửa/xóa pallet của mình.
// - packing_max_materials_per_run: số mã tối đa trên 1 trang sổ đóng gói.
// - vn_holidays: LỊCH NGHỈ LỄ theo năm — { "2026": [{date,name}] }. Năm khai ở đây dùng ĐÚNG danh sách
//     khai (công bố của Chính phủ đổi hàng năm: nghỉ bù, Tết 5/7/9 ngày); năm không khai vẫn tự tính
//     bằng thuật toán âm lịch cũ ⇒ chưa cấu hình = hành vi không đổi.
// - org_profile: NHẬN DIỆN & THAM SỐ RIÊNG CỦA ĐƠN VỊ (14/08) — { contact_email (subject Web Push),
//     weigh_station_code (trạm cân mặc định), nmsx_alias (gộp mã nhà máy cũ→mới), assumed_carton_mm
//     (cỡ thùng giả định khi mã chưa khai) }. Trước đây là hằng số của riêng LOF nằm rải 4 chỗ code.

// - pct_date_bands: { good, low } — THANG MÀU %Date hiển thị TOÀN APP (audit hardcode 13/08: trước
//     đó 3 thang mâu thuẫn 70/40 · 60/30 · 20/10 rải 12 chỗ FE). pct > good = xanh · > low = vàng ·
//     còn lại đỏ. Chưa cấu hình = mặc định { good: 60, low: 30 } (khớp thang họ Xuất/Nhặt lẻ cũ).
//     FE đọc qua usePctBands() + pctDateCls() (utils/pctDateBands) — thêm chỗ hiển thị %Date mới
//     BẮT BUỘC dùng cặp này, KHÔNG tự viết ternary ngưỡng.

export const DC_MODES = ['QR', 'QTY', 'NONE', 'OTHER'] as const
export type DeliveryConfirmation = { enabled: boolean; modes: string[] }
export const DC_DEFAULT: DeliveryConfirmation = { enabled: true, modes: ['QR', 'QTY'] }

function isDeliveryConfirmation(v: unknown): v is DeliveryConfirmation {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (typeof o.enabled !== 'boolean' || !Array.isArray(o.modes)) return false
  return o.modes.every(m => typeof m === 'string' && (DC_MODES as readonly string[]).includes(m))
}

function isTruckModels(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > 100) return false
  return v.every(item => {
    if (!item || typeof item !== 'object') return false
    const o = item as Record<string, unknown>
    if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 80) return false
    return [o.l, o.w, o.h].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 50000)
  })
}

function isAlertThresholds(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  const keys = ALERT_TH_CONFIG_KEYS as readonly string[]
  if (Object.keys(o).some(k => !keys.includes(k))) return false   // chỉ nhận đúng bộ khóa
  if (!keys.every(k => typeof o[k] === 'number' && Number.isFinite(o[k] as number) && (o[k] as number) > 0)) return false
  const t = o as Record<string, number>
  if (!(t.PCT_CRIT <= t.PCT_WARN && t.PCT_WARN <= 90)) return false                                   // %Date: thấp = nguy
  if (!(t.GATE_WARN_MIN >= 15 && t.GATE_WARN_MIN <= t.GATE_CRIT_MIN && t.GATE_CRIT_MIN <= 2880)) return false
  if (!(t.TRIP_STUCK_HOURS >= 1 && t.TRIP_STUCK_HOURS <= 72)) return false
  if (!(Number.isInteger(t.TRIP_LATE_DAYS) && t.TRIP_LATE_DAYS >= 1 && t.TRIP_LATE_DAYS <= 180)) return false
  if (!(t.WEIGH_WARN_PCT <= t.WEIGH_CRIT_PCT && t.WEIGH_CRIT_PCT <= 100)) return false
  if (!(t.PACKING_UNRECV_WARN_H >= 1 && t.PACKING_UNRECV_WARN_H <= t.PACKING_UNRECV_CRIT_H && t.PACKING_UNRECV_CRIT_H <= 168)) return false
  return true
}

function isPctDateBands(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (Object.keys(o).some(k => k !== 'good' && k !== 'low')) return false
  const good = o.good, low = o.low
  if (typeof good !== 'number' || typeof low !== 'number' || !Number.isFinite(good) || !Number.isFinite(low)) return false
  return low > 0 && low <= good && good <= 100
}

const KNOWN_SETTINGS: Record<string, { validate: (v: unknown) => boolean; hint: string }> = {
  label_format: { validate: v => v === 'underscore' || v === 'semicolon', hint: "'underscore' | 'semicolon'" },
  pct_date_bands: { validate: isPctDateBands, hint: '{ good: number, low: number } với 0 < low ≤ good ≤ 100 — %Date > good xanh, > low vàng, còn lại đỏ' },
  decimal_separator: { validate: v => v === 'dot' || v === 'comma', hint: "'dot' | 'comma'" },
  delivery_confirmation: { validate: isDeliveryConfirmation, hint: "{ enabled: boolean, modes: ('QR'|'QTY'|'NONE'|'OTHER')[] }" },
  truck_models: { validate: isTruckModels, hint: 'mảng { name, l, w, h } (mm, tối đa 100 dòng xe)' },
  alert_thresholds: {
    validate: isAlertThresholds,
    hint: 'đủ 10 số dương: PCT_CRIT ≤ PCT_WARN ≤ 90 · 15 ≤ GATE_WARN_MIN ≤ GATE_CRIT_MIN ≤ 2880 (phút) · TRIP_STUCK_HOURS 1–72 (giờ) · TRIP_LATE_DAYS 1–180 (ngày) · WEIGH_WARN_PCT ≤ WEIGH_CRIT_PCT ≤ 100 (%) · 1 ≤ PACKING_UNRECV_WARN_H ≤ PACKING_UNRECV_CRIT_H ≤ 168 (giờ)',
  },
  retention_days: {
    validate: v => parseRetention(v) !== null,
    hint: '{ photos: 7–730, feed: 1–90, error_logs: 7–365 } — số ngày, nguyên',
  },
  cycle_count: {
    validate: v => parseCycleCount(v) !== null,
    hint: '{ A, B, C: 1–365 ngày (A ≤ B ≤ C — hạng A kiểm dày nhất), window_days: 7–365 }',
  },
  inbound_edit_window_days: {
    validate: v => parseInboundEditWindow(v) !== null,
    hint: 'số nguyên 1–90 (ngày)',
  },
  packing_max_materials_per_run: {
    validate: v => parsePackingMaxMaterials(v) !== null,
    hint: 'số nguyên 1–50 (mã / trang sổ)',
  },
  vn_holidays: {
    validate: v => parseVnHolidays(v) !== null,
    hint: '{ "2026": [{ date: "2026-01-01", name: "Tết Dương lịch" }] } — năm KHÔNG khai thì dùng lịch tự tính (âm lịch + 4 lễ dương)',
  },
  org_profile: {
    validate: v => parseOrgProfile(v) !== null,
    hint: '{ contact_email, weigh_station_code, nmsx_alias: {CŨ:MỚI}, assumed_carton_mm: {l,w,h} } — nhận diện & tham số riêng của đơn vị',
  },
}

// Cờ label_format có cache ngắn (điểm quét đọc mỗi lần → không query DB liên tục; cờ đổi rất hiếm).
let _labelFormatCache: { value: 'underscore' | 'semicolon'; at: number } | null = null
export async function getLabelFormat(): Promise<'underscore' | 'semicolon'> {
  if (_labelFormatCache && Date.now() - _labelFormatCache.at < 30_000) return _labelFormatCache.value
  const { data } = await supabase.from('SystemSetting').select('value').eq('key', 'label_format').maybeSingle()
  const value = data?.value === 'semicolon' ? 'semicolon' : 'underscore'
  _labelFormatCache = { value, at: Date.now() }
  return value
}

// Cờ xác nhận giao hàng — cache ngắn (điểm tạo booking đọc mỗi lần xuất). Mặc định = hành vi đơn vị 1.
let _dcCache: { value: DeliveryConfirmation; at: number } | null = null
export async function getDeliveryConfirmation(): Promise<DeliveryConfirmation> {
  if (_dcCache && Date.now() - _dcCache.at < 30_000) return _dcCache.value
  const { data } = await supabase.from('SystemSetting').select('value').eq('key', 'delivery_confirmation').maybeSingle()
  const v = data?.value
  const value: DeliveryConfirmation = isDeliveryConfirmation(v) ? v : DC_DEFAULT
  _dcCache = { value, at: Date.now() }
  return value
}

// Gợi ý lỗi cho các điểm quét MATCH-BASED (outbound/stocktake/pallet-ops): CHỈ gọi KHI đã không khớp
// pallet nào → nếu tem quét sai delimiter so với cờ đơn vị thì đổi thông báo mơ hồ ("chưa nhập kho")
// thành "tem sai định dạng đơn vị". KHÔNG chặn match hợp lệ (tồn format cũ vẫn xuất/kiểm được) — chỉ inbound gate cứng.
export async function wrongFormatHint(raw: string): Promise<string | null> {
  const expectV2 = (await getLabelFormat()) === 'semicolon'
  const scannedV2 = (raw ?? '').includes(';')
  if (scannedV2 === expectV2) return null
  return expectV2
    ? 'Tem không đúng định dạng đơn vị: đơn vị này dùng tem chấm phẩy ( ; ), tem vừa quét là tem gạch dưới ( _ ). Kiểm tra lại tem.'
    : 'Tem không đúng định dạng đơn vị: đơn vị này dùng tem gạch dưới ( _ ), tem vừa quét là tem chấm phẩy ( ; ). Kiểm tra lại tem.'
}

// Cờ chứa BÍ MẬT (key_enc AI Vision…) — ghi qua route riêng (visionController, superadmin),
// TUYỆT ĐỐI không trả qua GET hở đọc này. PUT /wms/settings/<key> tự chặn (không trong KNOWN_SETTINGS).
const SECRET_SETTINGS = new Set(['vision_api'])

// GET /wms/settings — auth-only (mọi user đăng nhập đọc được: trang in tem/quét cần biết cờ)
export async function listSettings(_req: Request, res: Response) {
  const { data, error } = await supabase.from('SystemSetting').select('key, value, updated_by, updated_at')
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, (data ?? []).filter(r => !SECRET_SETTINGS.has((r as { key: string }).key)))
}

// PUT /wms/settings/:key — requirePerm wms_settings.manage_system
export async function updateSetting(req: Request, res: Response) {
  const { key } = req.params
  const { value } = req.body as { value: unknown }
  const known = KNOWN_SETTINGS[key]
  if (!known) return fail(res, 400, 'UNKNOWN_SETTING', `Cờ "${key}" không có trong sổ cờ hệ thống`)
  if (!known.validate(value)) return fail(res, 400, 'INVALID_VALUE', `Giá trị không hợp lệ cho cờ "${key}" — cần ${known.hint}`)

  const { data, error } = await supabase.from('SystemSetting').upsert({
    key,
    value,
    updated_by: req.user?.name ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' }).select('key, value, updated_by, updated_at').single()
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  _labelFormatCache = null; _dcCache = null   // đổi cờ → xoá cache để có hiệu lực ngay (không đợi TTL 30s)
  invalidateAlertThresholdsCache()
  invalidateSettingsCache()
  return ok(res, data)
}
