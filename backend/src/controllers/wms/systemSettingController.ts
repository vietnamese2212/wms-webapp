import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { ALERT_TH_CONFIG_KEYS, invalidateAlertThresholdsCache } from '../../services/alertScanner'

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
  if (!(t.WEIGH_WARN_PCT <= t.WEIGH_CRIT_PCT && t.WEIGH_CRIT_PCT <= 100)) return false
  return true
}

const KNOWN_SETTINGS: Record<string, { validate: (v: unknown) => boolean; hint: string }> = {
  label_format: { validate: v => v === 'underscore' || v === 'semicolon', hint: "'underscore' | 'semicolon'" },
  decimal_separator: { validate: v => v === 'dot' || v === 'comma', hint: "'dot' | 'comma'" },
  delivery_confirmation: { validate: isDeliveryConfirmation, hint: "{ enabled: boolean, modes: ('QR'|'QTY'|'NONE'|'OTHER')[] }" },
  truck_models: { validate: isTruckModels, hint: 'mảng { name, l, w, h } (mm, tối đa 100 dòng xe)' },
  alert_thresholds: {
    validate: isAlertThresholds,
    hint: 'đủ 7 số dương: PCT_CRIT ≤ PCT_WARN ≤ 90 · 15 ≤ GATE_WARN_MIN ≤ GATE_CRIT_MIN ≤ 2880 (phút) · TRIP_STUCK_HOURS 1–72 (giờ) · WEIGH_WARN_PCT ≤ WEIGH_CRIT_PCT ≤ 100 (%)',
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
  return ok(res, data)
}
