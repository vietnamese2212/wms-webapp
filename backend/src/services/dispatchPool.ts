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
 * lịch sử bình thường, liệt kê ra chỉ làm ngập màn hình — TRỪ OD đang nằm ở bản nháp mở của ngày khác (LUÔN báo, 29/09:
 * đó là việc bị giữ ở chỗ khác, người phải thấy để bỏ nháp kia hoặc kéo về).
 * (4) HOÃN (27/09, user: "đơn key một ngày nhưng có thể điều ngày khác · đơn note khác — không tự động được"): OD người đã
 *     đánh dấu Hoãn tới ngày SAU ngày lập, hoặc Không điều (không ngày), KHÔNG vào đợt ghép — và LUÔN được báo (kể cả OD tồn
 *     đọng) vì đó là quyết định của người, phải thấy để còn bỏ hoãn. Tới ngày hoãn thì OD quay lại như OD tồn đọng.
 * (5) DO TẠO LẠI – ĐÃ ĐIỀU (28/09, user chốt): SAP sửa SO sinh OD mới thay cho một OD ĐÃ nằm trong Kế hoạch xuất (đã lên
 *     xe) ⇒ hàng đó đã được điều dưới số OD cũ; để OD mới ở tab Điều là mời điều hai lần. Vào tab Đã điều, LUÔN báo.
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
// NO_MATERIAL (03/10, user: "mã chưa có thì phải xử lý trước khi ghép đơn"): OD có dòng mang mã KHÔNG có trong Mã hàng — máy không
// đo được tải / điều kiện bảo quản (bản cũ ghi ~0 pallet, ĐK rỗng ⇒ xếp "miễn phí" lên xe nào cũng được). Controller điền, không qua splitPool.
export type ExcludeKind = 'IN_PLAN' | 'OTHER_DRAFT' | 'SAP_ASSIGNED' | 'SHIPPED' | 'HELD' | 'REDO_DISPATCHED' | 'NO_MATERIAL'
/** Thông tin OD để bảng Xem đơn in được dòng của OD không nằm trên kế hoạch (controller điền, hàm thuần này để trống). */
export interface ExcludedDetail { ship_to_code: string | null; ship_to_name: string | null; ward_code: string | null; region_code: string | null; region_name: string | null; pallets: number | null; tons: number | null; delivery_date: string | null; note: string | null }
export interface ExcludedOd { od_number: string; kind: ExcludeKind; info: string | null; until?: string | null; reason?: string; d?: ExcludedDetail }
export interface PoolSplit {
  include: Map<string, { delivery_date: string | null; late_days: number }>
  excluded: ExcludedOd[]
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000)
const shippedRow = (r: PoolCandidateRow) => !!(r.mat_doc && String(r.mat_doc).trim()) || Number(r.qty_issued_base ?? 0) > 0

export function splitPool(
  rows: PoolCandidateRow[], day: string,
  // `reportAll` (30/09): báo CẢ OD tồn đọng đã đi / đã điều — cho cửa "Xem cả đơn tồn đọng đã đi" của tab Đã điều (user: "170 đơn
  // đi đâu mất, sao không nằm trong Đã điều"); lập kế hoạch vẫn để false để params không phình 2.000 dòng lịch sử
  ctx: { inPlan: Map<string, string>; otherDraft: Map<string, string>; held?: Map<string, { until: string | null; reason: string }>; redo?: Map<string, string>; reportAll?: boolean },
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
    const report = (kind: ExcludeKind, info: string | null) => { if (today || ctx.reportAll) excluded.push({ od_number: od, kind, info }) }
    if (ctx.inPlan.has(od)) { report('IN_PLAN', ctx.inPlan.get(od) ?? null); continue }
    // SAP đã xuất / đã điều thắng dấu Không điều (27/09 khuya): đơn đã được lo ở SAP thì nằm tab Đã điều, không đứng mãi ở
    // "Không điều" chờ người chuyển tay một đơn không còn gì để điều
    if (rs.some(shippedRow)) { report('SHIPPED', rs.find(r => r.mat_doc)?.mat_doc ?? null); continue }
    const asg = rs.find(r => r.sap_dispatch_status === 'ASSIGNED')
    if (asg) { report('SAP_ASSIGNED', [asg.dvvt_raw, asg.license_plate].filter(Boolean).join(' · ') || null); continue }
    // OD cũ đã lên xe thắng cả dấu Không điều (cùng lý do SAP đã điều thắng): hàng đã đi dưới số OD cũ
    if (ctx.redo?.has(od)) { excluded.push({ od_number: od, kind: 'REDO_DISPATCHED', info: ctx.redo.get(od) ?? null }); continue }
    const h = ctx.held?.get(od)
    if (h && (h.until == null || h.until > day)) { excluded.push({ od_number: od, kind: 'HELD', info: `${h.until ? `hoãn tới ${h.until}` : 'không điều'} — ${h.reason}`, until: h.until, reason: h.reason }); continue }
    // Bản nháp KHÁC đang giữ OD ⇒ LUÔN báo, kể cả OD tồn đọng (29/09): Ba Vì lập KH 29/09 thấy 191 OD tưởng đủ, trong khi
    // 223 OD ngày 25/09 nằm im trong bản nháp 28/09 ai đó quên — không phải lịch sử, là việc đang bị giữ ở chỗ khác.
    if (ctx.otherDraft.has(od)) { excluded.push({ od_number: od, kind: 'OTHER_DRAFT', info: ctx.otherDraft.get(od) ?? null }); continue }
    include.set(od, { delivery_date: dd, late_days: dd ? Math.max(0, daysBetween(dd, day)) : 0 })
  }
  return { include, excluded }
}

/** OD mới → câu "thay OD cũ · xe G" cho mọi OD mới mà OD cũ nó thay ĐÃ nằm trong Kế hoạch xuất (luật 5 của splitPool).
 *  `olds` = dòng erp_outbound_orders có replaced_by_od; `khvc` = dòng Kế hoạch xuất (chưa OBSOLETE) của các OD cũ đó. */
export function redoDispatchedOf(olds: { od_number: string; replaced_by_od: string }[], khvc: { do_no: string; group_code: string }[]): Map<string, string> {
  const gc = new Map<string, string>()
  for (const k of khvc) if (!gc.has(k.do_no)) gc.set(k.do_no, k.group_code)
  const by = new Map<string, string[]>()
  for (const o of olds) {
    const g = gc.get(o.od_number)
    if (!g) continue
    const l = by.get(o.replaced_by_od) ?? []
    const s = `thay OD ${o.od_number} · xe ${g}`
    if (!l.includes(s)) l.push(s)
    by.set(o.replaced_by_od, l)
  }
  return new Map([...by].map(([od, l]) => [od, l.join(' · ')]))
}

/** OD đang "Không điều" / "Không điều ngày này" mà SAP THAY bằng OD mới (sửa SO) ⇒ dấu chuyển sang OD mới (user chốt 27/09
 *  khuya). Chỉ dấu CÒN HIỆU LỰC (không ngày, hoặc ngày điều lại SAU hôm nay); OD mới đã có dấu riêng ở kho đó thì giữ dấu đó;
 *  một (kho, OD mới) chỉ một dấu. Trả các dòng cần thêm (chưa có id — nơi ghi tự cấp). */
export type HoldRow = { warehouse_id: string; od_number: string; hold_until: string | null; reason: string; created_by: string | null }
export function holdsToCarry(oldHolds: HoldRow[], pairs: [string, string][], existing: { warehouse_id: string; od_number: string }[], today: string): HoldRow[] {
  const byOld = new Map(pairs)
  const seen = new Set(existing.map(h => `${h.warehouse_id}|${h.od_number}`))
  const out: HoldRow[] = []
  for (const h of oldHolds) {
    const to = byOld.get(h.od_number)
    if (!to || !(h.hold_until == null || h.hold_until > today)) continue
    const k = `${h.warehouse_id}|${to}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ warehouse_id: h.warehouse_id, od_number: to, hold_until: h.hold_until, reason: `${h.reason} (thay cho OD ${h.od_number})`.slice(0, 500), created_by: h.created_by })
  }
  return out
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
