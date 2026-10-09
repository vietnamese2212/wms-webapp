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
/** Tới cỡ này thử HẾT hoán vị (6! = 720 — một xe hiếm khi quá 6 khách); đông hơn thì láng giềng gần nhất. */
export const EXACT_ROUTE_MAX_STOPS = 6
/**
 * Quãng đường kho → các điểm giao theo thứ tự NGẮN NHẤT (không quay về kho) và đường thẳng tới điểm xa nhất.
 * 09/10 (user chốt): ≤ 6 điểm thử hết hoán vị — láng giềng gần nhất từng từ chối oan chuyến ghép tốt (Ba Vì → A gần
 * 3 km rồi mới B 4 km ngược hướng dài hơn B → A → C); > 6 điểm giữ láng giềng gần nhất.
 * `dist(a, b)` = km giữa hai khoá ('WH' | ship_to). Trả null khi thiếu km của một cặp — không đoán.
 */
export function routeKm(stops: string[], dist: (a: string, b: string) => number | undefined): RouteKm | null {
  const pts = [...new Set(stops)]
  if (!pts.length) return null
  let farthest = 0
  for (const s of pts) { const d = dist('WH', s); if (d == null) return null; farthest = Math.max(farthest, d) }
  // bảng km đủ mọi cặp — thiếu một cặp là null (cả hai thuật toán đều cần)
  const d2 = new Map<string, number>()
  const nodes = ['WH', ...pts]
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const d = dist(nodes[i], nodes[j]); if (d == null) return null
    d2.set(`${nodes[i]}|${nodes[j]}`, d); d2.set(`${nodes[j]}|${nodes[i]}`, d)
  }
  const km = (a: string, b: string) => d2.get(`${a}|${b}`)!
  let order: string[], total: number
  if (pts.length <= EXACT_ROUTE_MAX_STOPS) {
    let best: string[] = [], bestT = Infinity
    const walk = (at: string, left: string[], path: string[], t: number) => {
      if (t >= bestT) return
      if (!left.length) { best = path; bestT = t; return }
      for (let i = 0; i < left.length; i++) walk(left[i], [...left.slice(0, i), ...left.slice(i + 1)], [...path, left[i]], t + km(at, left[i]))
    }
    walk('WH', pts, [], 0)
    order = best; total = bestT
  } else {
    const left = [...pts]; let at = 'WH'; total = 0; order = []
    while (left.length) {
      let bi = 0
      for (let i = 1; i < left.length; i++) if (km(at, left[i]) < km(at, left[bi])) bi = i
      total += km(at, left[bi]); at = left[bi]; order.push(at); left.splice(bi, 1)
    }
  }
  return { total: Number(total.toFixed(2)), farthest: Number(farthest.toFixed(2)), order }
}
/** Đường vòng chấp nhận được: tổng quãng đi ≤ đường thẳng tới điểm xa nhất × (1 + pct/100). Không có số ⇒ KHÔNG gộp. */
export function detourOk(r: RouteKm | null, pct: number): boolean {
  return !!r && r.farthest > 0 && r.total <= r.farthest * (1 + pct / 100) + 1e-9
}
