/**
 * TOẠ ĐỘ KHO (đợt 2 điều vận trên bản đồ, 02/10/2026) — cùng một ô dữ liệu, ba nguồn như khách (MANUAL · GPS · GOONG).
 * Kho là điểm xuất phát mọi phép đo km; cửa riêng để không nới `updateWarehouse` (hàm đó nhận ~30 trường không zod).
 * Quyền: wms_settings.manage_warehouse — ghim kho là cấu hình của kho.
 */
import { Request, Response } from 'express'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import type { z } from '../../middlewares/validate'
import { zLocationBody } from './customerGeoController'
import { geocodeAddress, geoProviderStatus, GeoNotConfigured, type MachineGeoSource } from '../../services/geo'
import { wardFromSapCode } from '../../utils/vnAddress'

const now = () => new Date().toISOString()
const GEO_COLS = 'id, code, name, address, geo_lat, geo_lng, geo_source, geo_accuracy_m, geo_at, geo_by'

// POST /masterdata/warehouses/:id/geocode — máy định vị kho từ Warehouse.address (02/10, user "không muốn tự tay"): ghi GOONG/OSM,
// KHÔNG đè ghim do người (MANUAL/GPS) ⇒ 409 HUMAN_PIN; 422 khi máy tắt / không tìm thấy. Kho = cùng mã ship-to SAP nên ward_code
// không có ở bảng này — chỉ dựa địa chỉ.
export async function geocodeWarehouse(req: Request, res: Response) {
  try {
    const id = String(req.params.id)
    const { data: wh, error: e0 } = await db.from('Warehouse').select(GEO_COLS).eq('id', id).maybeSingle()
    if (e0) return fail(res, e0)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    if (wh.geo_source === 'MANUAL' || wh.geo_source === 'GPS') return fail(res, 409, 'HUMAN_PIN', 'Kho đã có ghim do người chấm — máy không đè. Muốn định vị lại thì xoá ghim trước.')
    const addr = String(wh.address ?? '').trim()
    if (!addr) return fail(res, 422, 'NO_ADDRESS', 'Kho chưa có địa chỉ — khai địa chỉ ở form Kho hoặc chấm ghim trên bản đồ.')
    const st = await geoProviderStatus()
    if (!st.ready) return fail(res, 422, 'GEO_NOT_CONFIGURED', st.reason ?? 'Chưa cấu hình máy định vị')
    const source: MachineGeoSource = st.provider === 'goong' ? 'GOONG' : 'OSM'
    const p = await geocodeAddress(addr, { ward: wardFromSapCode(null) })
    if (!p) return fail(res, 422, 'GEO_NOT_FOUND', `Máy định vị không tìm thấy "${addr}" — tìm địa chỉ trong ô tìm hoặc chấm trên bản đồ.`)
    const t = now(), by = req.user?.name ?? null
    const { data, error } = await db.from('Warehouse').update({ geo_lat: p.lat, geo_lng: p.lng, geo_source: source, geo_accuracy_m: p.accuracy_m, geo_at: t, geo_by: by, updated_by: by, updated_at: t }).eq('id', id).select(GEO_COLS)
    if (error) return fail(res, error)
    return ok(res, { ...(data?.[0] ?? {}), precision: p.precision, formatted: p.formatted })
  } catch (e) {
    if (e instanceof GeoNotConfigured) return fail(res, 422, 'GEO_NOT_CONFIGURED', e.message)
    return fail(res, 422, 'GEO_FAILED', e instanceof Error ? e.message : String(e))
  }
}

// PATCH /masterdata/warehouses/:id/location
export async function setWarehouseLocation(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zLocationBody>
    const id = String(req.params.id)
    const t = now(), by = req.user?.name ?? null
    const patch = b.lat == null
      ? { geo_lat: null, geo_lng: null, geo_source: null, geo_accuracy_m: null, geo_at: t, geo_by: by }
      : { geo_lat: b.lat, geo_lng: b.lng, geo_source: b.source, geo_accuracy_m: b.accuracy_m ?? null, geo_at: t, geo_by: by }
    const { data, error } = await db.from('Warehouse').update({ ...patch, updated_by: by, updated_at: t }).eq('id', id).select(GEO_COLS)
    if (error) return fail(res, error)
    if (!data?.length) return fail(res, 'Không tìm thấy kho', 404)
    return ok(res, data[0])
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}
