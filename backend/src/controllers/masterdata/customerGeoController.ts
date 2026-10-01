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
import { geocodeAddress, geoProviderStatus, GeoNotConfigured, MACHINE_GEO_SOURCES, searchPlaces, type MachineGeoSource } from '../../services/geo'
import { wardFromSapCode } from '../../utils/vnAddress'

export const zGeoSearchQuery = z.object({ q: z.string().trim().min(2).max(200) })
// GET /masterdata/geo/search?q= — ô tìm địa điểm trên bản đồ (user 02/10 "search được địa chỉ như Google Map"): trả ≤ 6 ứng viên,
// KHÔNG ghi gì; người bấm chọn rồi Lưu vị trí mới ghi. 422 khi máy định vị tắt.
export async function geoSearch(req: Request, res: Response) {
  try {
    const { q } = req.query as unknown as z.infer<typeof zGeoSearchQuery>
    const hits = await searchPlaces(q)
    return ok(res, hits)
  } catch (e) {
    if (e instanceof GeoNotConfigured) return fail(res, 422, 'GEO_NOT_CONFIGURED', e.message)
    return fail(res, 422, 'GEO_FAILED', e instanceof Error ? e.message : String(e))   // dịch vụ ngoài hỏng = 422, không đổ error_logs
  }
}

const now = () => new Date().toISOString()
const GEO_COLS = 'id, ship_to_code, name, address, ward_code, region_name, geo_lat, geo_lng, geo_source, geo_accuracy_m, geo_address, geo_at, geo_by'
const GEOCODE_MAX = 100          // một lượt gọi tối đa — 5 lượt/giây của Goong ⇒ ~25 s, dưới trần hàm Vercel
const GEOCODE_MAX_OSM = 40       // Photon từ Vercel 1–3 s/khách ⇒ 40 khách ≈ 1–2 phút
const GEOCODE_DEADLINE_MS = 200_000   // ngắt lượt trước trần hàm (300 s) — phần dở trả về `remaining`, bấm tiếp
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
    const [{ count: total, error: e1 }, { data: src, error: e2 }, { count: untried, error: e3 }, provider] = await Promise.all([
      db.from('Customer').select('id', { count: 'exact', head: true }).eq('is_active', true),
      db.from('Customer').select('geo_source').eq('is_active', true).not('geo_lat', 'is', null).limit(1000),
      // khách máy CHƯA THỬ (có địa chỉ, chưa ghim, chưa có lần thử nào) — nút Định vị tự động đếm số này; số còn lại là máy đã thử mà không ra ⇒ chấm tay
      db.from('Customer').select('id', { count: 'exact', head: true }).eq('is_active', true).is('geo_lat', null).not('address', 'is', null).is('geo_at', null),
      geoProviderStatus(),
    ])
    if (e1) return fail(res, e1)
    if (e2) return fail(res, e2)
    if (e3) return fail(res, e3)
    const by: Record<string, number> = {}
    for (const r of src ?? []) { const k = r.geo_source ?? '?'; by[k] = (by[k] ?? 0) + 1 }
    const located = (src ?? []).length
    return ok(res, { total_active: total ?? 0, located, remaining: Math.max(0, (total ?? 0) - located), untried: untried ?? 0, by_source: by, provider })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}

// POST /masterdata/customers/geocode — máy định vị hàng loạt: khách đang hoạt động, có địa chỉ, còn trống toạ độ (hoặc `ids`
// chỉ định — vẫn không đè MANUAL/GPS). Tuần tự theo nhịp 5 lượt/giây của Goong; lỗi từng khách ghi vào `failed`, không dừng lượt.
export async function geocodeCustomers(req: Request, res: Response) {
  try {
    const b = req.body as z.infer<typeof zGeocodeBody>
    const st = await geoProviderStatus()
    if (!st.ready) return fail(res, 422, 'GEO_NOT_CONFIGURED', st.reason ?? 'Chưa cấu hình máy định vị')
    // nguồn ghi theo máy đang hiệu lực; máy chỉ đè ghim của MÁY (GOONG/OSM), không bao giờ đè MANUAL/GPS
    const source: MachineGeoSource = st.provider === 'goong' ? 'GOONG' : 'OSM'
    // OSM (Photon) từ Vercel chậm hơn Goong nhiều (1–3 s/khách, có khi 2 lượt hỏi) — 100 khách/lượt vượt trần hàm ("An error occurred
    // with your deployment", đo 02/10 lượt 3) ⇒ lượt OSM nhỏ hơn + ngắt theo đồng hồ, trả `remaining` để bấm tiếp
    const limit = b.limit ?? (source === 'OSM' ? GEOCODE_MAX_OSM : GEOCODE_MAX)
    // khách CHƯA THỬ đi trước (geo_at null) — lần thử hỏng ghi geo_at để không đứng đầu hàng chặn mãi những khách chưa thử
    let q = db.from('Customer').select(GEO_COLS).eq('is_active', true).not('address', 'is', null)
      .order('geo_at', { ascending: true, nullsFirst: true }).order('ship_to_code').limit(limit)
    q = b.ids?.length ? q.in('id', b.ids.slice(0, GEOCODE_MAX)).or(`geo_source.is.null,geo_source.in.(${MACHINE_GEO_SOURCES.join(',')})`) : q.is('geo_lat', null)
    const { data: rows, error } = await q
    if (error) return fail(res, error)
    const done: { id: string; ship_to_code: string; lat: number; lng: number }[] = []
    const failed: { id: string; ship_to_code: string; reason: string }[] = []
    const by = req.user?.name ?? null
    const t0 = Date.now()
    let stoppedAtDeadline = false
    const markTried = async (id: string, addr: string) => { await db.from('Customer').update({ geo_at: now(), geo_address: addr, updated_at: now() }).eq('id', id).is('geo_lat', null) }
    for (const r of rows ?? []) {
      if (Date.now() - t0 > GEOCODE_DEADLINE_MS) { stoppedAtDeadline = true; break }
      const addr = String(r.address ?? '').trim()
      if (!addr) { failed.push({ id: r.id, ship_to_code: r.ship_to_code, reason: 'Không có địa chỉ' }); continue }
      try {
        // địa chỉ không ghi Phường/Xã (11/334 trên staging) ⇒ máy OSM lấy tên phường từ cột ward_code của SAP ("H.Phòng-Ngô Quyền")
        const p = await geocodeAddress(addr, { ward: wardFromSapCode(r.ward_code), province: r.region_name })
        if (!p) { await markTried(r.id, addr); failed.push({ id: r.id, ship_to_code: r.ship_to_code, reason: source === 'OSM' ? 'Không tìm thấy phường/xã trong địa chỉ trên OpenStreetMap' : 'Dịch vụ không tìm thấy địa chỉ' }); continue }
        const { error: eu } = await db.from('Customer').update({ geo_lat: p.lat, geo_lng: p.lng, geo_source: source, geo_accuracy_m: p.accuracy_m, geo_address: addr, geo_at: now(), geo_by: by, updated_at: now() }).eq('id', r.id)
        if (eu) { failed.push({ id: r.id, ship_to_code: r.ship_to_code, reason: eu.message }); continue }
        done.push({ id: r.id, ship_to_code: r.ship_to_code, lat: p.lat, lng: p.lng })
      } catch (e) {
        if (e instanceof GeoNotConfigured) return fail(res, 422, 'GEO_NOT_CONFIGURED', e.message)
        await markTried(r.id, addr)
        failed.push({ id: r.id, ship_to_code: r.ship_to_code, reason: e instanceof Error ? e.message : String(e) })
      }
      await new Promise(r2 => setTimeout(r2, GEOCODE_GAP_MS))
    }
    if (done.length) await logAdmin(req, { action: 'CUSTOMER_GEO', target_type: 'Customer', target_label: `${done.length} khách (máy định vị)`, after: { done: done.length, failed: failed.length, provider: st.provider } })
    const [{ count }, { count: untried }] = await Promise.all([
      db.from('Customer').select('id', { count: 'exact', head: true }).eq('is_active', true).is('geo_lat', null).not('address', 'is', null),
      db.from('Customer').select('id', { count: 'exact', head: true }).eq('is_active', true).is('geo_lat', null).not('address', 'is', null).is('geo_at', null),
    ])
    return ok(res, { done, failed, remaining: count ?? 0, untried: untried ?? 0, provider: st.provider, precision: st.precision, stopped_at_deadline: stoppedAtDeadline })
  } catch (e) { return fail(res, e instanceof Error ? e.message : String(e), 500) }
}
