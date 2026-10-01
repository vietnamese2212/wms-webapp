/**
 * DỊCH VỤ ĐỊA LÝ — định vị địa chỉ → toạ độ (01/10/2026) + đo km đường bộ (02/10).
 *
 * Nhà cung cấp chỉ là MÁY ĐO: kết quả ghi vào DB của mình (Customer.geo_*, Warehouse.geo_*, geo_distance), máy ghép và bàn điều
 * vận chỉ đọc DB, không gọi ra ngoài. Cờ `geo_provider` (Cài đặt hệ thống):
 *   - 'auto' (mặc định): có khoá Goong → Goong; không → OSM.
 *   - 'goong': Goong (định vị tới số nhà + ma trận km đường bộ xe tải). Khoá dán ở Kết nối & API key (cờ bí mật `geo_api`,
 *     secretBox — không lộ qua GET /wms/settings); biến môi trường GOONG_API_KEY là đường lùi.
 *   - 'osm' (02/10, user chưa có khoá Goong, không muốn chấm tay 334 khách): OpenStreetMap qua Photon (komoot) — miễn phí, không
 *     khoá, định vị tới PHƯỜNG/XÃ (tách địa chỉ bằng utils/vnAddress, hỏi "tên phường, tỉnh" + lọc địa danh, nhận khi TÊN khớp);
 *     KHÔNG đo được km đường bộ (Đo km báo cần Goong, km vẫn ước lượng chim bay × 1,3).
 *   - 'none': tắt máy — khách mới chấm tay / GPS.
 * Thêm nhà cung cấp = thêm giá trị vào GEO_PROVIDERS + một nhánh ở đây. Mọi nơi khác không đổi.
 */
import { getGeoProvider } from '../utils/settings'
import { db } from '../lib/supabase'
import { decryptSecret } from '../utils/secretBox'
import { parseVnAddress, placeNameMatches, stripProvincePrefix, provinceGroup, provinceMatches } from '../utils/vnAddress'

/** precision: 'exact' = tới địa chỉ (Goong) · 'ward' = tâm phường/xã (OSM) — màn hình nói rõ, người chấm lại khi cần. */
export interface GeoPoint { lat: number; lng: number; formatted: string | null; precision: 'exact' | 'ward'; accuracy_m: number | null }
export class GeoNotConfigured extends Error { code = 'GEO_NOT_CONFIGURED' as const }
/** Nguồn ghi vào geo_source theo máy đã định vị. */
export type MachineGeoSource = 'GOONG' | 'OSM'
export const MACHINE_GEO_SOURCES: MachineGeoSource[] = ['GOONG', 'OSM']

const GOONG_GEOCODE = 'https://rsapi.goong.io/geocode'
const GOONG_MATRIX = 'https://rsapi.goong.io/DistanceMatrix'
const PHOTON = 'https://photon.komoot.io/api/'
const PHOTON_UA = 'WMS-webapp/1.0 (dieu van; github.com/vietnamese2212/wms-webapp)'
const VN_BBOX = '102,8,110,24'
const WARD_ACCURACY_M = 1500   // bán kính ước lượng của một ghim cấp phường/xã — để màn hình in "±1.500 m"
const TIMEOUT_MS = 10_000

export const GEO_API_SETTING = 'geo_api'
export type GeoKeySource = 'app' | 'env'
let _keyCache: { key: string | null; source: GeoKeySource | null; at: number } | null = null
/** Khoá Goong đang hiệu lực: dán trong app thắng biến môi trường (đổi khoá trong app là có tác dụng ngay, không đợi deploy). Cache 30 s. */
export async function getGeoKey(): Promise<{ key: string | null; source: GeoKeySource | null }> {
  if (_keyCache && Date.now() - _keyCache.at < 30_000) return _keyCache
  let key: string | null = null, source: GeoKeySource | null = null
  try {
    const { data } = await db.from('SystemSetting').select('value').eq('key', GEO_API_SETTING).maybeSingle()
    const enc = (data?.value as { key_enc?: unknown } | null)?.key_enc
    const k = typeof enc === 'string' ? decryptSecret(enc) : null
    if (k) { key = k; source = 'app' }
  } catch { /* DB lỗi → thử biến môi trường */ }
  if (!key && process.env.GOONG_API_KEY) { key = process.env.GOONG_API_KEY; source = 'env' }
  _keyCache = { key, source, at: Date.now() }
  return _keyCache
}
export function invalidateGeoKeyCache(): void { _keyCache = null }

export interface GeoStatus {
  provider: 'goong' | 'osm' | 'none'   // máy ĐANG hiệu lực (auto đã phân giải)
  configured: string                    // cờ geo_provider như đã khai ('auto' | …)
  ready: boolean                        // định vị địa chỉ được không
  matrix: boolean                       // đo km đường bộ được không (chỉ Goong)
  precision: 'exact' | 'ward' | null
  reason: string | null                 // vì sao chưa định vị được
  matrix_reason: string | null          // vì sao chưa đo km được
}
/** Trạng thái máy định vị / máy đo — để màn hình nói thẳng "chưa có khoá" / "cần Goong" thay vì bấm rồi lỗi. */
export async function geoProviderStatus(): Promise<GeoStatus> {
  const configured = await getGeoProvider()
  const hasKey = !!(await getGeoKey()).key
  const provider: GeoStatus['provider'] = configured === 'none' ? 'none' : configured === 'auto' ? (hasKey ? 'goong' : 'osm') : configured
  const needKey = 'Chưa có khoá Goong — Admin dán ở Cấu hình → Kết nối & API key → thẻ "Bản đồ Goong"'
  if (provider === 'none') return { provider, configured, ready: false, matrix: false, precision: null, reason: 'Máy định vị đang tắt (Cài đặt hệ thống → geo_provider = none)', matrix_reason: 'Máy đo đang tắt (geo_provider = none)' }
  if (provider === 'goong') {
    if (!hasKey) return { provider, configured, ready: false, matrix: false, precision: null, reason: needKey, matrix_reason: needKey }
    return { provider, configured, ready: true, matrix: true, precision: 'exact', reason: null, matrix_reason: null }
  }
  return { provider, configured, ready: true, matrix: false, precision: 'ward', reason: null,
    matrix_reason: 'Đo km đường bộ cần khoá Goong — đang dùng ước lượng đường chim bay × 1,3. Dán khoá ở Cấu hình → Kết nối & API key.' }
}

const inRange = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

// Toán thuần (chim bay, hệ số đường bộ, đường vòng) ở utils/geoMath.ts — máy ghép và test đơn vị dùng không cần env/DB
export { haversineKm, estimateRoadKm, ROAD_FACTOR, type LatLng } from '../utils/geoMath'
import type { LatLng } from '../utils/geoMath'

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers })
    if (!r.ok) throw new Error(`Dịch vụ trả HTTP ${r.status}`)
    return (await r.json()) as T
  } finally { clearTimeout(timer) }
}

/** Một lượt gọi tối đa bao nhiêu điểm đích — Goong không công bố, giữ 25 như Google để không bị 400 giữa chừng. */
export const MATRIX_MAX_DEST = 25
export interface MatrixCell { km: number; minutes: number | null }
/** Đo km ĐƯỜNG BỘ (xe tải) từ MỘT điểm đi tới nhiều điểm đến. null ở ô nào nhà cung cấp không tìm được đường. Ném GeoNotConfigured khi chưa có máy đo. */
export async function distanceMatrix(origin: LatLng, dests: LatLng[]): Promise<(MatrixCell | null)[]> {
  const st = await geoProviderStatus()
  if (!st.matrix) throw new GeoNotConfigured(st.matrix_reason ?? 'Chưa cấu hình máy đo km')
  if (!dests.length) return []
  if (dests.length > MATRIX_MAX_DEST) throw new Error(`Tối đa ${MATRIX_MAX_DEST} điểm đến mỗi lượt`)
  const q = new URLSearchParams({ origins: `${origin.lat},${origin.lng}`, destinations: dests.map(d => `${d.lat},${d.lng}`).join('|'), vehicle: 'truck', api_key: (await getGeoKey()).key ?? '' })
  const j = await fetchJson<{ rows?: { elements?: { status?: string; distance?: { value?: unknown }; duration?: { value?: unknown } }[] }[] }>(`${GOONG_MATRIX}?${q.toString()}`)
  const els = j.rows?.[0]?.elements ?? []
  return dests.map((_, i) => {
    const e = els[i]
    const m = Number(e?.distance?.value), s = Number(e?.duration?.value)
    if (!e || (e.status && e.status !== 'OK') || !Number.isFinite(m) || m < 0) return null
    return { km: Number((m / 1000).toFixed(2)), minutes: Number.isFinite(s) ? Number((s / 60).toFixed(1)) : null }
  })
}

async function geocodeGoong(q: string): Promise<GeoPoint | null> {
  const url = `${GOONG_GEOCODE}?address=${encodeURIComponent(q)}&api_key=${encodeURIComponent((await getGeoKey()).key ?? '')}`
  const j = await fetchJson<{ results?: { formatted_address?: string; geometry?: { location?: { lat?: unknown; lng?: unknown } } }[] }>(url)
  const hit = j.results?.[0]
  const lat = Number(hit?.geometry?.location?.lat), lng = Number(hit?.geometry?.location?.lng)
  if (!hit || !inRange(lat, lng)) return null
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), formatted: hit.formatted_address ?? null, precision: 'exact', accuracy_m: null }
}

interface PhotonFeature { geometry?: { coordinates?: [unknown, unknown] }; properties?: { name?: string; type?: string; osm_value?: string; county?: string; city?: string; state?: string; district?: string } }
// cấp địa danh ưu tiên: phường/thị trấn (suburb/quarter/town) trước làng/xóm (village/hamlet) — tên làng trùng tên phường rất nhiều
const PLACE_RANK: Record<string, number> = { suburb: 0, quarter: 0, town: 0, city: 1, village: 2, hamlet: 3, neighbourhood: 3, locality: 4 }
/**
 * Hỏi Photon một câu, lọc địa danh (place), chỉ nhận kết quả mang ĐÚNG tên phường/xã và — khi nhận ra tỉnh — ĐÚNG nhóm tỉnh
 * (thử sống 02/10: không lọc tỉnh thì "Đức Lập, Tây Ninh" trả về Đức Lập ở Lâm Đồng, "Tân Hòa, Cần Thơ" trả về Tân Hòa ở TP.HCM).
 * Tỉnh không nhận ra (địa chỉ hỏng) ⇒ nhận kết quả đúng tên đầu tiên.
 */
async function photonWard(q: string, ward: string, province: string | null): Promise<GeoPoint | null> {
  const u = `${PHOTON}?q=${encodeURIComponent(q)}&limit=8&bbox=${VN_BBOX}&osm_tag=place`
  const j = await fetchJson<{ features?: PhotonFeature[] }>(u, { 'User-Agent': PHOTON_UA })
  const group = provinceGroup(province)
  const hits = (j.features ?? [])
    .filter(f => placeNameMatches(f.properties?.name, ward))
    .filter(f => !group || [f.properties?.state, f.properties?.county, f.properties?.city, f.properties?.district].some(s => provinceMatches(s, group)))
    .sort((a, b) => (PLACE_RANK[a.properties?.osm_value ?? ''] ?? 5) - (PLACE_RANK[b.properties?.osm_value ?? ''] ?? 5))
  const pick = hits[0]
  if (!pick) return null
  const lng = Number(pick.geometry?.coordinates?.[0]), lat = Number(pick.geometry?.coordinates?.[1])
  if (!inRange(lat, lng)) return null
  const p = pick.properties ?? {}
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), formatted: [p.name, p.county ?? p.city, p.state].filter(Boolean).join(', ') || null, precision: 'ward', accuracy_m: WARD_ACCURACY_M }
}
/** Gợi ý từ cột SAP khi địa chỉ thiếu: ward = tên phường từ ward_code · province = vùng bán hàng (region_name — chỉ dùng khi địa chỉ không nêu tỉnh nhận ra được). */
export interface GeocodeHint { ward?: string | null; province?: string | null }
/** OSM: tách địa chỉ → "phường, tỉnh" → nếu không ra thì "phường" trần. Địa chỉ không ghi Phường/Xã ⇒ dùng tên phường gợi ý; không có ⇒ null (không đoán theo tỉnh). */
async function geocodeOsm(address: string, hint?: GeocodeHint): Promise<GeoPoint | null> {
  const parsed = parseVnAddress(address)
  const ward = parsed.ward ?? hint?.ward ?? null
  if (!ward) return null
  const province = provinceGroup(parsed.province) ? parsed.province : provinceGroup(hint?.province) ? (hint?.province ?? null) : parsed.province
  const withProv = province ? await photonWard(`${ward}, ${stripProvincePrefix(province)}`, ward, province) : null
  if (withProv) return withProv
  return photonWard(ward, ward, province)
}

export interface PlaceHit { label: string; lat: number; lng: number }
/** TÌM ĐỊA ĐIỂM như Google Maps (user 02/10) cho ô tìm trên bản đồ: gõ tên quán / số nhà / KCN → vài ứng viên để bấm chọn rồi kéo ghim. Không ghi gì. */
export async function searchPlaces(query: string, limit = 6): Promise<PlaceHit[]> {
  const st = await geoProviderStatus()
  if (!st.ready) throw new GeoNotConfigured(st.reason ?? 'Chưa cấu hình máy định vị')
  const q = query.trim()
  if (q.length < 2) return []
  if (st.provider === 'goong') {
    const url = `${GOONG_GEOCODE}?address=${encodeURIComponent(q)}&api_key=${encodeURIComponent((await getGeoKey()).key ?? '')}`
    const j = await fetchJson<{ results?: { formatted_address?: string; geometry?: { location?: { lat?: unknown; lng?: unknown } } }[] }>(url)
    return (j.results ?? []).slice(0, limit).flatMap(r => {
      const lat = Number(r.geometry?.location?.lat), lng = Number(r.geometry?.location?.lng)
      return inRange(lat, lng) ? [{ label: r.formatted_address ?? `${lat}, ${lng}`, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }] : []
    })
  }
  const u = `${PHOTON}?q=${encodeURIComponent(q)}&limit=${limit}&bbox=${VN_BBOX}`
  const j = await fetchJson<{ features?: (PhotonFeature & { properties?: { street?: string; housenumber?: string } })[] }>(u, { 'User-Agent': PHOTON_UA })
  return (j.features ?? []).flatMap(f => {
    const lng = Number(f.geometry?.coordinates?.[0]), lat = Number(f.geometry?.coordinates?.[1])
    if (!inRange(lat, lng)) return []
    const p = f.properties ?? {}
    const street = [p.housenumber, p.street].filter(Boolean).join(' ')
    const label = [p.name, street && street !== p.name ? street : null, p.district, p.city ?? p.county, p.state].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')
    return [{ label: label || `${lat}, ${lng}`, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }]
  })
}

/** Định vị MỘT địa chỉ. null = nhà cung cấp không tìm thấy. Ném GeoNotConfigured khi chưa có máy định vị; ném Error khi gọi hỏng. */
export async function geocodeAddress(address: string, hint?: GeocodeHint): Promise<GeoPoint | null> {
  const st = await geoProviderStatus()
  if (!st.ready) throw new GeoNotConfigured(st.reason ?? 'Chưa cấu hình máy định vị')
  const q = address.trim()
  if (!q) return null
  return st.provider === 'goong' ? geocodeGoong(q) : geocodeOsm(q, hint)
}
