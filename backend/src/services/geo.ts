/**
 * DỊCH VỤ ĐỊA LÝ — định vị địa chỉ → toạ độ (đợt 1, 01/10/2026; đợt 2 sẽ thêm đo km đường bộ).
 *
 * Nhà cung cấp chỉ là MÁY ĐO: kết quả ghi vào DB của mình (Customer.geo_*), máy ghép và bàn điều vận chỉ đọc DB,
 * không gọi ra ngoài. Nhà cung cấp chọn bằng cờ `geo_provider` (Cài đặt hệ thống): 'goong' | 'none'. Khoá API ở biến
 * môi trường GOONG_API_KEY (không bao giờ qua SystemSetting — cờ đọc được bởi mọi tài khoản).
 * Thêm nhà cung cấp = thêm giá trị vào GEO_PROVIDERS + một nhánh ở đây. Mọi nơi khác không đổi.
 */
import { getGeoProvider } from '../utils/settings'

export interface GeoPoint { lat: number; lng: number; formatted: string | null }
export class GeoNotConfigured extends Error { code = 'GEO_NOT_CONFIGURED' as const }

const GOONG_GEOCODE = 'https://rsapi.goong.io/geocode'
const TIMEOUT_MS = 10_000

/** Trạng thái sẵn sàng của máy định vị — để màn hình nói thẳng "chưa có khoá" thay vì bấm rồi lỗi. */
export async function geoProviderStatus(): Promise<{ provider: string; ready: boolean; reason: string | null }> {
  const provider = await getGeoProvider()
  if (provider === 'none') return { provider, ready: false, reason: 'Máy định vị đang tắt (Cài đặt hệ thống → geo_provider = none)' }
  if (!process.env.GOONG_API_KEY) return { provider, ready: false, reason: 'Chưa có khoá GOONG_API_KEY trên máy chủ (biến môi trường Vercel)' }
  return { provider, ready: true, reason: null }
}

const inRange = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/** Định vị MỘT địa chỉ. null = nhà cung cấp không tìm thấy. Ném GeoNotConfigured khi chưa có máy định vị; ném Error khi gọi hỏng. */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const st = await geoProviderStatus()
  if (!st.ready) throw new GeoNotConfigured(st.reason ?? 'Chưa cấu hình máy định vị')
  const q = address.trim()
  if (!q) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const url = `${GOONG_GEOCODE}?address=${encodeURIComponent(q)}&api_key=${encodeURIComponent(process.env.GOONG_API_KEY ?? '')}`
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`Goong trả HTTP ${r.status}`)
    const j = (await r.json()) as { status?: string; results?: { formatted_address?: string; geometry?: { location?: { lat?: unknown; lng?: unknown } } }[] }
    const hit = j.results?.[0]
    const lat = Number(hit?.geometry?.location?.lat), lng = Number(hit?.geometry?.location?.lng)
    if (!hit || !inRange(lat, lng)) return null
    return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), formatted: hit.formatted_address ?? null }
  } finally { clearTimeout(timer) }
}
