// Toán địa lý THUẦN (không DB, không mạng) — máy ghép và lớp dịch vụ địa lý cùng dùng; test đơn vị chạy không cần env.
export interface LatLng { lat: number; lng: number }

/** Đường chim bay (km). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}
/** Đường bộ ≈ chim bay × 1,3 (hệ số thường dùng cho đường liên tỉnh VN) — đường lùi khi chưa có số đo. */
export const ROAD_FACTOR = 1.3
export const estimateRoadKm = (a: LatLng, b: LatLng) => Number((haversineKm(a, b) * ROAD_FACTOR).toFixed(2))

/** Khoá cặp điểm trong bảng km: 'WH' cho kho, còn lại là ship_to_code. Tra cả hai chiều. */
export const kmKey = (a: string, b: string) => `${a}|${b}`
export function kmLookup(km: Record<string, number>, a: string, b: string): number | undefined {
  return km[kmKey(a, b)] ?? km[kmKey(b, a)]
}

export interface RouteKm { total: number; farthest: number; order: string[] }
/**
 * Quãng đường kho → các điểm giao theo thứ tự GẦN TRƯỚC (láng giềng gần nhất, không quay về kho) và đường thẳng tới điểm xa nhất.
 * `dist(a, b)` = km giữa hai khoá ('WH' | ship_to). Trả null khi thiếu km của một cặp — không đoán.
 */
export function routeKm(stops: string[], dist: (a: string, b: string) => number | undefined): RouteKm | null {
  const left = [...new Set(stops)]
  if (!left.length) return null
  let at = 'WH', total = 0, farthest = 0
  const order: string[] = []
  for (const s of left) { const d = dist('WH', s); if (d == null) return null; farthest = Math.max(farthest, d) }
  while (left.length) {
    let best = -1, bestD = Infinity
    for (let i = 0; i < left.length; i++) { const d = dist(at, left[i]); if (d == null) return null; if (d < bestD) { bestD = d; best = i } }
    total += bestD; at = left[best]; order.push(at); left.splice(best, 1)
  }
  return { total: Number(total.toFixed(2)), farthest: Number(farthest.toFixed(2)), order }
}
/** Đường vòng chấp nhận được: tổng quãng đi ≤ đường thẳng tới điểm xa nhất × (1 + pct/100). Không có số ⇒ KHÔNG gộp. */
export function detourOk(r: RouteKm | null, pct: number): boolean {
  return !!r && r.farthest > 0 && r.total <= r.farthest * (1 + pct / 100) + 1e-9
}
