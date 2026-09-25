/**
 * POOL LŨY TIẾN của Điều vận — hàm thuần, không DB (user chốt 25/09/2026; test tests/unit/dispatchPool.test.ts).
 *
 * ZSD02 là dữ liệu THÔ của điều hàng: trong cùng một file có OD đã đi hàng, OD đã điều, OD chưa điều. Mỗi lần lập kế
 * hoạch (và mỗi lần ZSD02 nạp lại trong ngày) máy phải tự bỏ ra những OD đã được lo — không chỉ OD đã vào Kế hoạch xuất
 * của app như bản 24/09. Một OD vào đợt ghép khi và chỉ khi:
 *   (1) chưa nằm trong Kế hoạch xuất (khvc_lines) và chưa nằm trong một bản nháp ĐANG MỞ của ngày khác;
 *   (2) SAP chưa ghi "Đã điều phối" ở dòng nào của OD;
 *   (3) chưa xuất kho — không dòng nào có chứng từ xuất (mat_doc) hay số đã xuất > 0.
 * OD TỒN ĐỌNG (ngày giao TRƯỚC ngày lập, trong `backlogDays` ngày) đủ ba điều kiện thì cũng vào — user chốt gộp — kèm
 * `late_days` để màn hình đánh dấu "trễ n ngày". Nhóm bị loại chỉ BÁO với OD đúng ngày lập: OD cũ đã đi/đã điều là
 * lịch sử bình thường, liệt kê ra chỉ làm ngập màn hình.
 */
export interface PoolCandidateRow {
  od_number: string
  delivery_date: string | null
  sap_dispatch_status: string | null
  mat_doc: string | null
  qty_issued_base: number | string | null
  dvvt_raw: string | null
  license_plate: string | null
}
export type ExcludeKind = 'IN_PLAN' | 'OTHER_DRAFT' | 'SAP_ASSIGNED' | 'SHIPPED'
export interface ExcludedOd { od_number: string; kind: ExcludeKind; info: string | null }
export interface PoolSplit {
  include: Map<string, { delivery_date: string | null; late_days: number }>
  excluded: ExcludedOd[]
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000)
const shippedRow = (r: PoolCandidateRow) => !!(r.mat_doc && String(r.mat_doc).trim()) || Number(r.qty_issued_base ?? 0) > 0

export function splitPool(
  rows: PoolCandidateRow[], day: string,
  ctx: { inPlan: Map<string, string>; otherDraft: Map<string, string> },
): PoolSplit {
  const byOd = new Map<string, PoolCandidateRow[]>()
  for (const r of rows) { const l = byOd.get(r.od_number) ?? []; l.push(r); byOd.set(r.od_number, l) }
  const include: PoolSplit['include'] = new Map()
  const excluded: ExcludedOd[] = []
  for (const od of [...byOd.keys()].sort()) {
    const rs = byOd.get(od)!
    // ngày giao của OD = ngày MUỘN nhất trong các dòng (SAP có thể dời một phần) — OD còn dòng đúng ngày lập là OD của hôm nay
    const dd = rs.map(r => r.delivery_date).filter((x): x is string => !!x).sort().pop() ?? null
    const today = dd === day
    const report = (kind: ExcludeKind, info: string | null) => { if (today) excluded.push({ od_number: od, kind, info }) }
    if (ctx.inPlan.has(od)) { report('IN_PLAN', ctx.inPlan.get(od) ?? null); continue }
    if (ctx.otherDraft.has(od)) { report('OTHER_DRAFT', ctx.otherDraft.get(od) ?? null); continue }
    if (rs.some(shippedRow)) { report('SHIPPED', rs.find(r => r.mat_doc)?.mat_doc ?? null); continue }
    const asg = rs.find(r => r.sap_dispatch_status === 'ASSIGNED')
    if (asg) { report('SAP_ASSIGNED', [asg.dvvt_raw, asg.license_plate].filter(Boolean).join(' · ') || null); continue }
    include.set(od, { delivery_date: dd, late_days: dd ? Math.max(0, daysBetween(dd, day)) : 0 })
  }
  return { include, excluded }
}

/** SO sửa ⇒ SAP bỏ OD cũ, sinh OD mới cho CÙNG (SO, item). Chỉ kết luận "đã thay" khi có bằng chứng trong CHÍNH file:
 *  OD cũ vắng file · cùng (SO, item) có OD mới trong file · ngày giao OD cũ nằm trong khoảng ngày của file (file không phủ
 *  ngày đó thì vắng mặt là do cắt file, không phải do SAP bỏ) · OD cũ chưa xuất kho (đã xuất thì không "thay" được, chỉ cảnh báo). */
export interface ReplaceCandidate { od_number: string; od_item: string; so_number: string | null; so_item: string | null; delivery_date: string | null; mat_doc: string | null; qty_issued_base: number | string | null }
export function findReplacedOds(
  fileOds: { od_number: string; so_number: string | null; so_item: string | null; delivery_date: string | null }[],
  prior: ReplaceCandidate[],
): { replaced: { od_number: string; od_item: string; by: string }[]; shipped_conflicts: { od_number: string; by: string; so: string }[] } {
  const fileDos = new Set(fileOds.map(r => r.od_number))
  const newBySo = new Map<string, string>()
  for (const r of fileOds) if (r.so_number && r.so_item) { const k = `${r.so_number}__${r.so_item}`; if (!newBySo.has(k)) newBySo.set(k, r.od_number) }
  const dates = fileOds.map(r => r.delivery_date).filter((x): x is string => !!x).sort()
  const lo = dates[0], hi = dates[dates.length - 1]
  const replaced: { od_number: string; od_item: string; by: string }[] = []
  const shipped_conflicts: { od_number: string; by: string; so: string }[] = []
  for (const p of prior) {
    if (fileDos.has(p.od_number) || !p.so_number || !p.so_item) continue
    const by = newBySo.get(`${p.so_number}__${p.so_item}`)
    if (!by || by === p.od_number) continue
    if (!lo || !p.delivery_date || p.delivery_date < lo || p.delivery_date > hi) continue
    if ((p.mat_doc && String(p.mat_doc).trim()) || Number(p.qty_issued_base ?? 0) > 0) {
      if (!shipped_conflicts.some(x => x.od_number === p.od_number)) shipped_conflicts.push({ od_number: p.od_number, by, so: `${p.so_number}/${p.so_item}` })
      continue
    }
    replaced.push({ od_number: p.od_number, od_item: p.od_item, by })
  }
  return { replaced, shipped_conflicts }
}
