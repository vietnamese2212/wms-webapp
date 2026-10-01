/**
 * SỔ KHOẢNG CÁCH (đợt 2 điều vận trên bản đồ, 02/10/2026) — bảng `geo_distance` là km ĐÃ ĐO của mình.
 * Đọc: cặp nào đã đo (và ghim chưa dời) ⇒ số đo GOONG; chưa ⇒ ước lượng đường chim bay × 1,3 gắn nguồn HAVERSINE — không bao
 * giờ trả "không biết": máy ghép và bàn luôn có một con số, kèm cờ để màn hình nói "ước lượng". Ghi: chỉ khi có nhà cung cấp.
 */
import { randomUUID } from 'crypto'
import { db } from '../lib/supabase'
import { fetchAllByIdChunks } from '../utils/pagination'
import { distanceMatrix, estimateRoadKm, GeoNotConfigured, MATRIX_MAX_DEST, type LatLng } from './geo'

export interface GeoNode { key: string; pt: LatLng }            // key: 'WH:<Warehouse.id>' | 'CU:<ship_to_code>'
export interface Dist { km: number; minutes: number | null; source: 'GOONG' | 'HAVERSINE' }
type Row = { from_key: string; to_key: string; from_lat: number; from_lng: number; to_lat: number; to_lng: number; km: number; minutes: number | null; source: string }

export const whKey = (id: string) => `WH:${id}`
export const custKey = (shipTo: string) => `CU:${shipTo}`
const near = (a: number, b: number) => Math.abs(Number(a) - Number(b)) < 5e-5   // ~5 m — ghim dời xa hơn là số đo cũ
const pairKey = (f: string, t: string) => `${f}|${t}`

/** Nạp các dòng đã đo cho tập điểm đi (chunk 300 khoá). */
async function loadRows(fromKeys: string[]): Promise<Map<string, Row>> {
  if (!fromKeys.length) return new Map()
  const rows = (await fetchAllByIdChunks(fromKeys, c => db.from('geo_distance')
    .select('from_key, to_key, from_lat, from_lng, to_lat, to_lng, km, minutes, source').in('from_key', c).order('from_key'))) as Row[]
  return new Map(rows.map(r => [pairKey(r.from_key, r.to_key), r]))
}

/** Khoảng cách cho từng cặp — số đo nếu có (chiều nào cũng được), còn lại ước lượng. */
export async function distancesFor(pairs: { from: GeoNode; to: GeoNode }[]): Promise<Dist[]> {
  const keys = [...new Set(pairs.flatMap(p => [p.from.key, p.to.key]))]
  const rows = await loadRows(keys)
  const fresh = (r: Row | undefined, f: GeoNode, t: GeoNode) => !!r && near(r.from_lat, f.pt.lat) && near(r.from_lng, f.pt.lng) && near(r.to_lat, t.pt.lat) && near(r.to_lng, t.pt.lng)
  return pairs.map(({ from, to }) => {
    const fw = rows.get(pairKey(from.key, to.key)), bw = rows.get(pairKey(to.key, from.key))
    const r = fresh(fw, from, to) ? fw : fresh(bw, to, from) ? bw : undefined
    return r ? { km: Number(r.km), minutes: r.minutes == null ? null : Number(r.minutes), source: 'GOONG' } : { km: estimateRoadKm(from.pt, to.pt), minutes: null, source: 'HAVERSINE' }
  })
}

/** Những cặp CHƯA có số đo (hoặc ghim đã dời) trong tập cho trước. */
export async function unmeasured(pairs: { from: GeoNode; to: GeoNode }[]): Promise<{ from: GeoNode; to: GeoNode }[]> {
  const ds = await distancesFor(pairs)
  return pairs.filter((_, i) => ds[i].source !== 'GOONG')
}

/** Đo bằng nhà cung cấp và ghi sổ. Gom theo điểm đi, mỗi lượt ≤ MATRIX_MAX_DEST điểm đến, nhịp 5 lượt/giây. Ném GeoNotConfigured khi chưa có máy đo. */
export async function measurePairs(pairs: { from: GeoNode; to: GeoNode }[], opts: { maxCalls?: number } = {}): Promise<{ measured: number; failed: number; calls: number; stopped_at_limit: boolean }> {
  const byFrom = new Map<string, { from: GeoNode; tos: GeoNode[] }>()
  for (const p of pairs) { const g = byFrom.get(p.from.key) ?? { from: p.from, tos: [] }; g.tos.push(p.to); byFrom.set(p.from.key, g) }
  let measured = 0, failed = 0, calls = 0
  const maxCalls = opts.maxCalls ?? Infinity
  const t = new Date().toISOString()
  for (const g of byFrom.values()) {
    for (let i = 0; i < g.tos.length; i += MATRIX_MAX_DEST) {
      if (calls >= maxCalls) return { measured, failed, calls, stopped_at_limit: true }
      const chunk = g.tos.slice(i, i + MATRIX_MAX_DEST)
      let cells: Awaited<ReturnType<typeof distanceMatrix>>
      try { cells = await distanceMatrix(g.from.pt, chunk.map(c => c.pt)) } catch (e) { if (e instanceof GeoNotConfigured) throw e; failed += chunk.length; calls++; continue }
      calls++
      const rows = chunk.map((to, k) => cells[k] ? ({
        id: randomUUID(), from_key: g.from.key, to_key: to.key, from_lat: g.from.pt.lat, from_lng: g.from.pt.lng, to_lat: to.pt.lat, to_lng: to.pt.lng,
        km: cells[k]!.km, minutes: cells[k]!.minutes, source: 'GOONG', measured_at: t, updated_at: t,
      }) : null).filter((r): r is NonNullable<typeof r> => !!r)
      failed += chunk.length - rows.length
      if (rows.length) {
        const { error } = await db.from('geo_distance').upsert(rows, { onConflict: 'from_key,to_key' })
        if (error) { failed += rows.length } else measured += rows.length
      }
      await new Promise(r => setTimeout(r, 220))
    }
  }
  return { measured, failed, calls, stopped_at_limit: false }
}
