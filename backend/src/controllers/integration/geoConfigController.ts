/**
 * KHOÁ GOONG cho máy định vị / đo km (điều vận trên bản đồ) — user chốt 02/10: "tôi có thể tạo API key và tôi muốn
 * nó làm config, nơi đó tôi sẽ dán API Goong vào — có module chứa API mà" ⇒ dán ở trang Kết nối & API key, thẻ
 * "Bản đồ Goong", cùng khuôn với AI Vision:
 * - Khoá lưu MÃ HOÁ (secretBox) trong SystemSetting `geo_api` = { key_enc }; `listSettings` đã lọc (SECRET_SETTINGS),
 *   PUT /wms/settings/geo_api bị chặn sẵn (không trong KNOWN_SETTINGS) — cửa ghi DUY NHẤT là PUT /wms/geo-config.
 * - CHỈ superadmin. GET chỉ trả đuôi che `••••abcd`, không bao giờ trả khoá thô hay bản mã.
 * - Máy đo (services/geo.ts getGeoKey) đọc khoá này trước, biến môi trường GOONG_API_KEY là đường lùi.
 */
import { Request, Response } from 'express'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { z } from '../../middlewares/validate'
import { encryptSecret } from '../../utils/secretBox'
import { logAdmin } from '../../services/adminAudit'
import { GEO_API_SETTING, getGeoKey, invalidateGeoKeyCache, geoProviderStatus, geocodeAddress, GeoNotConfigured } from '../../services/geo'

const isSuper = (req: Request) => req.user?.is_superadmin === true

// Khoá Goong thực tế ~40 ký tự chữ-số; chặn dán nhầm chuỗi quá ngắn / cả câu lệnh
export const zGeoConfigBody = z.object({
  api_key: z.string().trim().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/, 'Khoá chỉ gồm chữ, số, gạch').nullable(),
})

// GET /wms/geo-config — trạng thái (đuôi che + nguồn khoá + máy định vị sẵn sàng chưa)
export async function getGeoConfig(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 403, 'FORBIDDEN', 'Chỉ Admin')
  invalidateGeoKeyCache()
  const { key, source } = await getGeoKey()
  const st = await geoProviderStatus()
  return ok(res, {
    configured: !!key,
    source,                                            // 'app' = dán trong app · 'env' = biến môi trường máy chủ · null
    key_tail: key ? `••••${key.slice(-4)}` : null,
    provider: st.provider, ready: st.ready, reason: st.reason,
  })
}

// PUT /wms/geo-config — { api_key: string } lưu khoá mới (đè khoá cũ) · { api_key: null } gỡ khoá
export async function saveGeoConfig(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 403, 'FORBIDDEN', 'Chỉ Admin')
  const { api_key } = req.body as z.infer<typeof zGeoConfigBody>
  const before = await getGeoKey()
  try {
    if (api_key === null) {
      const { error } = await db.from('SystemSetting').delete().eq('key', GEO_API_SETTING)
      if (error) return fail(res, error)
      invalidateGeoKeyCache()
      await logAdmin(req, { action: 'GEO_CONFIG', target_type: 'SystemSetting', target_id: GEO_API_SETTING, target_label: 'Bản đồ Goong',
        before: { configured: before.source === 'app' }, after: { configured: false } })
      const after = await getGeoKey()
      return ok(res, { configured: !!after.key, source: after.source })
    }
    const keyEnc = encryptSecret(api_key)
    if (!keyEnc) return fail(res, 500, 'NO_SECRET', 'Máy chủ thiếu JWT_SECRET — không mã hoá được khoá')
    const { error } = await db.from('SystemSetting').upsert({
      key: GEO_API_SETTING, value: { key_enc: keyEnc }, updated_by: req.user?.name ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
    if (error) return fail(res, error)
    invalidateGeoKeyCache()
    await logAdmin(req, { action: 'GEO_CONFIG', target_type: 'SystemSetting', target_id: GEO_API_SETTING, target_label: 'Bản đồ Goong',
      before: { configured: !!before.key, source: before.source }, after: { configured: true, source: 'app', key_changed: true } })
    return ok(res, { configured: true, source: 'app', key_tail: `••••${api_key.slice(-4)}` })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// POST /wms/geo-config/test — định vị thử MỘT địa chỉ cố định (1 lượt Goong) để Admin bấm "Kiểm tra"; lỗi = 422, không 5xx
const TEST_ADDRESS = 'Hồ Hoàn Kiếm, Hà Nội'
export async function testGeoConfig(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 403, 'FORBIDDEN', 'Chỉ Admin')
  invalidateGeoKeyCache()
  const t0 = Date.now()
  try {
    const p = await geocodeAddress(TEST_ADDRESS)
    if (!p) return fail(res, 422, 'GEO_FAILED', 'Goong không trả kết quả cho địa chỉ thử — khoá có thể chưa bật Geocoding')
    return ok(res, { ok: true, address: TEST_ADDRESS, lat: p.lat, lng: p.lng, formatted: p.formatted, latency_ms: Date.now() - t0 })
  } catch (e) {
    if (e instanceof GeoNotConfigured) return fail(res, 422, e.code, e.message)
    return fail(res, 422, 'GEO_FAILED', e instanceof Error ? e.message : 'Gọi Goong thất bại')
  }
}
