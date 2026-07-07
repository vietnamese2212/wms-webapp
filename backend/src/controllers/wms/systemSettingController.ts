import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

// SystemSetting: cờ hành vi per-DB (multi-tenant SILO — cờ theo KHÁC BIỆT, không theo đơn vị).
// SỔ CỜ (thêm cờ mới = thêm dòng vào KNOWN_SETTINGS + ghi chú ở đây):
// - label_format: 'underscore' | 'semicolon' — định dạng tem pallet khi IN từ app.
//     underscore (mặc định, đơn vị 1): ddmmyy_Mã_ChuKỳ_Máy_Seq_NMSX
//     semicolon  (đơn vị 2):           Mã hàng;QA;Mã lô;NSX;HSD;Giờ;Phút:Giây
//   Chiều QUÉT không đọc cờ này — parser tự nhận theo delimiter (2 format sống chung).

const KNOWN_SETTINGS: Record<string, { validate: (v: unknown) => boolean; hint: string }> = {
  label_format: { validate: v => v === 'underscore' || v === 'semicolon', hint: "'underscore' | 'semicolon'" },
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
