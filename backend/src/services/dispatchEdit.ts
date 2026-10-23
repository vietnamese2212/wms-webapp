// CÓ THAY ĐỔI CHƯA LƯU? (23/10, user: "switch qua sửa rồi — có một sự thay đổi thì nút switch không dùng được, phải Lưu hoặc Khôi phục")
// So bàn hiện tại với BẢN ĐÃ LƯU (`dispatch_plan_edit.base`): xe nào đổi trạng thái (mở khoá, xe mới có đơn) hoặc đơn nào đổi xe / rời xe /
// lên xe ⇒ có thay đổi. Khung chờ không tính (Sửa tự nạp đơn chờ mới vào đó). MIRROR với FE `components/tms/dispatchEdit.ts`
// (test `tests/mirror/dispatchEdit.mirror.test.ts`) — bàn khoá công tắc Xem | Sửa, server chặn 409 `EDIT_DIRTY` cùng một luật.
export type EditSig = { trips: { id: string; status: string | null }[]; ods: { od_number: string; trip_id: string | null }[] }

export function editDirty(base: EditSig, cur: EditSig): boolean {
  const live = (s: EditSig) => new Map(s.trips.filter(t => (t.status ?? 'DRAFT') !== 'DISCARDED').map(t => [t.id, t.status ?? 'DRAFT']))
  const pairs = (s: EditSig, l: Map<string, string>) => new Set(s.ods.filter(o => o.trip_id && l.has(o.trip_id)).map(o => `${o.trip_id}|${o.od_number}`))
  const bT = live(base), cT = live(cur)
  const bP = pairs(base, bT), cP = pairs(cur, cT)
  const used = new Set([...cP].map(k => k.slice(0, k.indexOf('|'))))
  for (const [id, st] of cT) if (used.has(id) && bT.get(id) !== st) return true
  if (bP.size !== cP.size) return true
  for (const k of bP) if (!cP.has(k)) return true
  return false
}
