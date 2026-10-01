/**
 * TOẠ ĐỘ ĐIỂM GIAO CỦA KHÁCH (đợt 1 "điều vận trên bản đồ", 01/10/2026 — user chốt Goong + chấm tay + GPS điện thoại).
 *
 * Một ô dữ liệu, ba nguồn: MANUAL (chấm trên bản đồ) · GPS (điện thoại tại chỗ) · GOONG (máy định vị từ địa chỉ).
 * Luật: nguồn do NGƯỜI thắng máy — máy chỉ điền ô trống hoặc đè lên chính kết quả máy trước đó, không bao giờ đè MANUAL/GPS.
 * Quyền riêng: customers.locate (chấm tay / GPS) · customers.geocode (máy định vị hàng loạt) — không đi ké customers.edit
 * vì người điều vận / tài xế cần dời ghim mà không được sửa hồ sơ khách.
 */
import { Request, Response } from 'express'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { z, zId } from '../../middlewares/validate'
import { logAdmin } from '../../services/adminAudit'
import { geocodeAddress, geoProviderStatus, GeoNotConfigured } from '../../services/geo'

const now = () => new Date().toISOString()
const GEO_COLS = 'id, ship_to_code, name, address, geo_lat, geo_lng, geo_source, geo_accuracy_m, geo_address, geo_at, geo_by'
const GEOCODE_MAX = 100          // một lượt gọi tối đa — 5 lượt/giây của Goong ⇒ ~25 s, dưới trần hàm Vercel
const GEOCODE_GAP_MS = 220

export const zLocationBody = z.union([
  z.object({
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    source: z.enum(['MANUAL', 'GPS']),
    accuracy_m: z.number().min(0).max(100_000).nullable().optional(),
  }),
  z.object({ lat: z.null(), lng: z.null() }),   // xoá ghim
])
export const zGeocodeBody = z.object({
  ids: z.array(zId).max(GEOCODE_MAX).optional(),     // không gửi = mọi khách đang hoạt động còn trống toạ độ
  limit: z.number().int().min(1).max(GEOCODE_MAX).optional(),
})

// PATCH /masterdata/customers/:id/location — chấm tay / GPS / xoá ghim
export async function setCustomerLocation(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zLocationBody>
    const id = String(req.params.id)
    const { data: before, error: e0 } = await db.from('Customer').select(GEO_COLS).eq('id', id).maybeSingle()
    if (e0) return fail(res, e0)
    if (!before) return fail(res, 'Không tìm thấy khách hàng', 404)
    const t = now(), by = req.user?.name ?? null
    const patch = b.lat == null
      ? { geo_lat: null, geo_lng: null, geo_source: null, geo_accuracy_m: null, geo_address: null, geo_at: t, geo_by: by }
      : { geo_lat: b.lat, geo_lng: b.lng, geo_source: b.source, geo_accuracy_m: b.accuracy_m ?? null, geo_address: null, geo_at: t, geo_by: by }
    const { data, error } = await db.from('Customer').update({ ...patch, updated_by: by, updated_at: t }).eq('id', id).select(GEO_COLS)
    if (error) return fail(res, error)
    if (!data?.length) return fail(res, 'Không tìm thấy khách hàng', 404)
    await logAdmin(req, { action: 'CUSTOMER_GEO', target_type: 'Customer', target_id: id, target_label: `${before.ship_to_code} — ${before.name}`,
      before: { geo_lat: before.geo_lat, geo_lng: before.geo_lng, geo_source: before.geo_source }, after: { geo_lat: patch.geo_lat, geo_lng: patch.geo_lng, geo_source: patch.geo_source } })
    return ok(res, data[0])
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// GET /masterdata/customers/geo-status — đếm đã/chưa định vị + máy định vị có sẵn sàng không (để nút nói thẳng)
export async function customerGeoStatus(_req: Request, res: Response) {
  try {
    const [{ count: total, error: e1 }, { data: src, error: e2 }, provider] = await Promise.all([
      db.from('Customer').select('id', { count: 'exact', head: true }).eq('is_active', true),
      db.from('Customer').select('geo_source').eq('is_active', true).not('geo_lat', 'is', null).limit(1000),
      geoProviderStatus(),
    ])
    if (e1) return fail(res, e1)
    if (e2) return fail(res, e2)
    const by: Record<string, number> = {}
    for (const r of src ?? []) { const k = r.geo_source ?? '?'; by[k] = (by[k] ?? 0) + 1 }
    const located = (src ?? []).length
    return ok(res, { total_active: total ?? 0, located, remaining: Math.max(0, (total ?? 0) - located), by_source: by, provider })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// POST /masterdata/customers/geocode — máy định vị hàng loạt: khách đang hoạt động, có địa chỉ, còn trống toạ độ (hoặc `ids`
// chỉ định — vẫn không đè MANUAL/GPS). Tuần tự theo nhịp 5 lượt/giây của Goong; lỗi từng khách ghi vào `failed`, không dừng lượt.
export async function geocodeCustomers(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zGeocodeBody>
    const st = await geoProviderStatus()
    if (!st.ready) return fail(res, 422, 'GEO_NOT_CONFIGURED', st.reason ?? 'Chưa cấu hình máy định vị')
    const limit = b.limit ?? GEOCODE_MAX
    let q = db.from('Customer').select(GEO_COLS).eq('is_active', true).not('address', 'is', null).order('ship_to_code').limit(limit)
    q = b.ids?.length ? q.in('id', b.ids.slice(0, GEOCODE_MAX)).or('geo_source.is.null,geo_source.eq.GOONG') : q.is('geo_lat', null)
    const { data: rows, error } = await q
    if (error) return fail(res, error)
    const done: { id: string; ship_to_code: string; lat: number; lng: number }[] = []
    const failed: { id: string; ship_to_code: string; reason: string }[] = []
    const by = req.user?.name ?? null
    for (const r of rows ?? []) {
      const addr = String(r.address ?? '').trim()
      if (!addr) { failed.push({ id: r.id, ship_to_code: r.ship_to_code, reason: 'Không có địa chỉ' }); continue }
      try {
        const p = await geocodeAddress(addr)
        if (!p) { failed.push({ id: r.id, ship_to_code: r.ship_to_code, reason: 'Dịch vụ không tìm thấy địa chỉ' }); continue }
        const { error: eu } = await db.from('Customer').update({ geo_lat: p.lat, geo_lng: p.lng, geo_source: 'GOONG', geo_accuracy_m: null, geo_address: addr, geo_at: now(), geo_by: by, updated_at: now() }).eq('id', r.id)
        if (eu) { failed.push({ id: r.id, ship_to_code: r.ship_to_code, reason: eu.message }); continue }
        done.push({ id: r.id, ship_to_code: r.ship_to_code, lat: p.lat, lng: p.lng })
      } catch (e) {
        if (e instanceof GeoNotConfigured) return fail(res, 422, 'GEO_NOT_CONFIGURED', e.message)
        failed.push({ id: r.id, ship_to_code: r.ship_to_code, reason: e instanceof Error ? e.message : String(e) })
      }
      await new Promise(r2 => setTimeout(r2, GEOCODE_GAP_MS))
    }
    if (done.length) await logAdmin(req, { action: 'CUSTOMER_GEO', target_type: 'Customer', target_label: `${done.length} khách (máy định vị)`, after: { done: done.length, failed: failed.length, provider: st.provider } })
    const { count } = await db.from('Customer').select('id', { count: 'exact', head: true }).eq('is_active', true).is('geo_lat', null).not('address', 'is', null)
    return ok(res, { done, failed, remaining: count ?? 0 })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}
