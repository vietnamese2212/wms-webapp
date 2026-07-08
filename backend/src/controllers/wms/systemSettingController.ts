import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

// SystemSetting: cờ hành vi per-DB (multi-tenant SILO — cờ theo KHÁC BIỆT, không theo đơn vị).
// SỔ CỜ (thêm cờ mới = thêm dòng vào KNOWN_SETTINGS + ghi chú ở đây):
// - label_format: 'underscore' | 'semicolon' — định dạng tem pallet khi IN từ app.
//     underscore (mặc định, đơn vị 1): ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX
//     semicolon  (đơn vị 2):           Mã hàng;QA;Mã lô;NSX;HSD;Giờ;Phút:Giây
//   Chiều IN: quyết định format tem sinh. Chiều QUÉT inbound: cờ GATE format (getLabelFormat) —
//   ';' chỉ nhận tem ';', '_' chỉ nhận tem '_' (mỗi đơn vị 1 format cố định; quét nhầm → chặn).

const KNOWN_SETTINGS: Record<string, { validate: (v: unknown) => boolean; hint: string }> = {
  label_format: { validate: v => v === 'underscore' || v === 'semicolon', hint: "'underscore' | 'semicolon'" },
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

// GET /wms/settings — auth-only (mọi user đăng nhập đọc được: trang in tem/quét cần biết cờ)
export async function listSettings(_req: Request, res: Response) {
  const { data, error } = await supabase.from('SystemSetting').select('key, value, updated_by, updated_at')
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, data ?? [])
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
  return ok(res, data)
}
