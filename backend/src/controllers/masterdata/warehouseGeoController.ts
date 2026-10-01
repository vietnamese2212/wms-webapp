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

const now = () => new Date().toISOString()
const GEO_COLS = 'id, code, name, address, geo_lat, geo_lng, geo_source, geo_accuracy_m, geo_at, geo_by'

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
