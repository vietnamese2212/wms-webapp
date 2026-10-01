/**
 * DỊCH VỤ ĐỊA LÝ — định vị địa chỉ → toạ độ (đợt 1, 01/10/2026; đợt 2 sẽ thêm đo km đường bộ).
 *
 * Nhà cung cấp chỉ là MÁY ĐO: kết quả ghi vào DB của mình (Customer.geo_*), máy ghép và bàn điều vận chỉ đọc DB,
 * không gọi ra ngoài. Nhà cung cấp chọn bằng cờ `geo_provider` (Cài đặt hệ thống): 'goong' | 'none'.
 * KHOÁ API (user chốt 02/10 "tôi muốn dán trong app, có module chứa API mà"): dán ở trang Kết nối & API key (thẻ
 * "Bản đồ Goong", chỉ superadmin) → lưu MÃ HOÁ (secretBox, cùng cơ chế AI Vision) trong SystemSetting `geo_api`
 * (SECRET_SETTINGS — không lộ qua GET /wms/settings). Biến môi trường GOONG_API_KEY vẫn được nhận làm đường lùi.
 * Thêm nhà cung cấp = thêm giá trị vào GEO_PROVIDERS + một nhánh ở đây. Mọi nơi khác không đổi.
 */
import { getGeoProvider } from '../utils/settings'
import { db } from '../lib/supabase'
import { decryptSecret } from '../utils/secretBox'

export interface GeoPoint { lat: number; lng: number; formatted: string | null }
export class GeoNotConfigured extends Error { code = 'GEO_NOT_CONFIGURED' as const }

const GOONG_GEOCODE = 'https://rsapi.goong.io/geocode'
const TIMEOUT_MS = 10_000

export const GEO_API_SETTING = 'geo_api'
export type GeoKeySource = 'app' | 'env'
let _keyCache: { key: string | null; source: GeoKeySource | null; at: number } | null = null
/** Khoá đang hiệu lực: dán trong app thắng biến môi trường (đổi khoá trong app là có tác dụng ngay, không đợi deploy). Cache 30 s. */
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

/** Trạng thái sẵn sàng của máy định vị — để màn hình nói thẳng "chưa có khoá" thay vì bấm rồi lỗi. */
export async function geoProviderStatus(): Promise<{ provider: string; ready: boolean; reason: string | null }> {
  const provider = await getGeoProvider()
  if (provider === 'none') return { provider, ready: false, reason: 'Máy định vị đang tắt (Cài đặt hệ thống → geo_provider = none)' }
  if (!(await getGeoKey()).key) return { provider, ready: false, reason: 'Chưa có khoá Goong — Admin dán ở Cấu hình → Kết nối & API key → thẻ "Bản đồ Goong"' }
  return { provider, ready: true, reason: null }
}

const inRange = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

// Toán thuần (chim bay, hệ số đường bộ, đường vòng) ở utils/geoMath.ts — máy ghép và test đơn vị dùng không cần env/DB
export { haversineKm, estimateRoadKm, ROAD_FACTOR, type LatLng } from '../utils/geoMath'
import type { LatLng } from '../utils/geoMath'

const GOONG_MATRIX = 'https://rsapi.goong.io/DistanceMatrix'
/** Một lượt gọi tối đa bao nhiêu điểm đích — Goong không công bố, giữ 25 như Google để không bị 400 giữa chừng. */
export const MATRIX_MAX_DEST = 25
export interface MatrixCell { km: number; minutes: number | null }
/** Đo km ĐƯỜNG BỘ (xe tải) từ MỘT điểm đi tới nhiều điểm đến. null ở ô nào nhà cung cấp không tìm được đường. Ném GeoNotConfigured khi chưa có máy đo. */
export async function distanceMatrix(origin: LatLng, dests: LatLng[]): Promise<(MatrixCell | null)[]> {
  const st = await geoProviderStatus()
  if (!st.ready) throw new GeoNotConfigured(st.reason ?? 'Chưa cấu hình máy định vị')
  if (!dests.length) return []
  if (dests.length > MATRIX_MAX_DEST) throw new Error(`Tối đa ${MATRIX_MAX_DEST} điểm đến mỗi lượt`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const q = new URLSearchParams({ origins: `${origin.lat},${origin.lng}`, destinations: dests.map(d => `${d.lat},${d.lng}`).join('|'), vehicle: 'truck', api_key: (await getGeoKey()).key ?? '' })
    const r = await fetch(`${GOONG_MATRIX}?${q.toString()}`, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`Goong trả HTTP ${r.status}`)
    const j = (await r.json()) as { rows?: { elements?: { status?: string; distance?: { value?: unknown }; duration?: { value?: unknown } }[] }[] }
    const els = j.rows?.[0]?.elements ?? []
    return dests.map((_, i) => {
      const e = els[i]
      const m = Number(e?.distance?.value), s = Number(e?.duration?.value)
      if (!e || (e.status && e.status !== 'OK') || !Number.isFinite(m) || m < 0) return null
      return { km: Number((m / 1000).toFixed(2)), minutes: Number.isFinite(s) ? Number((s / 60).toFixed(1)) : null }
    })
  } finally { clearTimeout(timer) }
}

/** Định vị MỘT địa chỉ. null = nhà cung cấp không tìm thấy. Ném GeoNotConfigured khi chưa có máy định vị; ném Error khi gọi hỏng. */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const st = await geoProviderStatus()
  if (!st.ready) throw new GeoNotConfigured(st.reason ?? 'Chưa cấu hình máy định vị')
  const q = address.trim()
  if (!q) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const url = `${GOONG_GEOCODE}?address=${encodeURIComponent(q)}&api_key=${encodeURIComponent((await getGeoKey()).key ?? '')}`
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`Goong trả HTTP ${r.status}`)
    const j = (await r.json()) as { status?: string; results?: { formatted_address?: string; geometry?: { location?: { lat?: unknown; lng?: unknown } } }[] }
    const hit = j.results?.[0]
    const lat = Number(hit?.geometry?.location?.lat), lng = Number(hit?.geometry?.location?.lng)
    if (!hit || !inRange(lat, lng)) return null
    return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), formatted: hit.formatted_address ?? null }
  } finally { clearTimeout(timer) }
}
