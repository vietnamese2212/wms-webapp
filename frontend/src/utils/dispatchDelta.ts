// GHÉP "PHẦN THAY ĐỔI" của một thao tác vào kế hoạch điều vận đang giữ trong trình duyệt (06/10, user: "thao tác ở phần thay đổi").
// Trước: mỗi lần thả server trả CẢ kế hoạch (Bàu Bàng 709 xe = 3,9 MB) và bàn tải lại thêm một lần qua realtime ⇒ bận 8–21 s.
// Nay server trả các xe bị đụng (đủ dòng OD) · dòng về khung chờ · id các dòng vừa chuyển · tổng kết · dấu phiên bản; hàm này ghép.
// Thuần (không gọi mạng) — test ở backend/tests/unit/dispatchDelta.test.ts. Luật: một dòng OD chỉ được nằm ĐÚNG MỘT chỗ.
import type { DispatchPlan, DispatchTrip, DispatchTripOd, DispatchSummary } from '@/api/hooks'

export interface DispatchPlanDelta {
  trips: DispatchTrip[]              // xe bị đụng — bản mới, đủ dòng OD
  pool_add: DispatchTripOd[]         // dòng vừa về khung chờ
  removed_od_ids: string[]           // mọi dòng vừa chuyển (bỏ khỏi chỗ cũ trước khi đặt vào chỗ mới)
  removed_trip_ids?: string[]        // xe vừa bị bỏ
  summary?: DispatchSummary
  updated_at?: string
  stamp?: string | null
}

const byOd = (a: DispatchTripOd, b: DispatchTripOd) => a.od_number.localeCompare(b.od_number) || a.id.localeCompare(b.id)

export function applyDispatchDelta(old: DispatchPlan, d: DispatchPlanDelta): DispatchPlan {
  const gone = new Set(d.removed_od_ids)
  const fresh = new Map(d.trips.map(t => [t.id, t]))
  const dropped = new Set(d.removed_trip_ids ?? [])
  // dòng đã đặt vào xe mới ở bản trả về thì không được còn ở chỗ cũ — kể cả khi `removed_od_ids` thiếu nó
  for (const t of d.trips) for (const o of t.ods) gone.add(o.id)
  for (const o of d.pool_add) gone.add(o.id)
  const trips = old.trips.filter(t => !dropped.has(t.id)).map(t => fresh.get(t.id) ?? (t.ods.some(o => gone.has(o.id)) ? { ...t, ods: t.ods.filter(o => !gone.has(o.id)) } : t))
  for (const t of d.trips) if (!dropped.has(t.id) && !old.trips.some(x => x.id === t.id)) trips.push(t)
  trips.sort((a, b) => a.seq - b.seq)
  const pool = [...(old.pool ?? []).filter(o => !gone.has(o.id)), ...d.pool_add].sort(byOd)
  return {
    ...old, trips, pool,
    ...(d.summary ? { summary: d.summary } : {}),
    ...(d.updated_at ? { updated_at: d.updated_at } : {}),
    ...(d.stamp !== undefined ? { stamp: d.stamp } : {}),
  }
}

/** Lượt HỎI DẤU realtime nên làm gì với MỘT kế hoạch đang mở (07/10, lớp C63). Đang tải ⇒ CHỜ rồi hỏi lại: TanStack gộp lần làm mới vào
 *  lượt tải đang chạy khi query CHƯA có dữ liệu — lượt đó có thể đọc giữa lúc server còn ghi (đo Bàu Bàng: 1.500 / 2.457 đơn, ba lô 500
 *  đầu) và bản thiếu nằm lì vì không còn tín hiệu nào tới sau. Chưa có dấu ⇒ tải lại; có dấu ⇒ hỏi dấu server. */
export function stampCheckAction(q: { fetching: boolean; held: string | null | undefined }): 'wait' | 'reload' | 'ask' {
  if (q.fetching) return 'wait'
  return q.held ? 'ask' : 'reload'
}

/** Một XE vừa sửa (khoá · ĐVVT · dòng xe · switch ghép) — thay xe đó, giữ nguyên phần còn lại. */
export function applyDispatchTrip(old: DispatchPlan, trip: DispatchTrip, plan?: { summary?: DispatchSummary; updated_at?: string; stamp?: string | null }): DispatchPlan {
  return applyDispatchDelta(old, { trips: [trip], pool_add: [], removed_od_ids: [], ...plan })
}
