/**
 * POOL LŨY TIẾN của Điều vận — hàm thuần, không DB (user chốt 25/09/2026; test tests/unit/dispatchPool.test.ts).
 *
 * ZSD02 là dữ liệu THÔ của điều hàng: trong cùng một file có OD đã đi hàng, OD đã điều, OD chưa điều. Mỗi lần lập kế
 * hoạch (và mỗi lần ZSD02 nạp lại trong ngày) máy phải tự bỏ ra những OD đã được lo — không chỉ OD đã vào Kế hoạch xuất
 * của app như bản 24/09. Một OD vào đợt ghép khi và chỉ khi:
 *   (1) chưa nằm trong Kế hoạch xuất (khvc_lines) và chưa LÊN XE ở một bản nháp ĐANG MỞ khác (khung chờ là tự do — 03/10 tối);
 *   (2)(3) — BỎ 03/10 tối: "SAP đã điều phối" và "đã xuất (Mat Doc / SL đã xuất)" không còn loại đơn — chúng là CỜ THAM CHIẾU
 *       trên tab Điều, người quyết bằng dấu tay (Ngoài app · Không điều) hoặc điều thật. Lịch sử của app mới là nguồn sự thật.
 * OD TỒN ĐỌNG (ngày giao TRƯỚC ngày lập — MỌI ngày, 05/10 bỏ cửa sổ 14 ngày) đủ ba điều kiện thì cũng vào — user chốt gộp — kèm
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
// OUTSIDE_APP (03/10 tối): dấu TAY của người — đơn đã được xử lý ngoài bàn này (điều tay · trước khi dùng app · SAP tự gắn xe).
// SHIPPED / SAP_ASSIGNED giữ trong kiểu cho dữ liệu cũ (params.excluded đã ghi) — từ 03/10 tối splitPool KHÔNG loại theo cờ SAP nữa.
export type ExcludeKind = 'IN_PLAN' | 'OTHER_DRAFT' | 'SAP_ASSIGNED' | 'SHIPPED' | 'HELD' | 'REDO_DISPATCHED' | 'NO_MATERIAL' | 'OUTSIDE_APP'
/** Thông tin OD để bảng Xem đơn in được dòng của OD không nằm trên kế hoạch (controller điền, hàm thuần này để trống). */
export interface ExcludedDetail { ship_to_code: string | null; ship_to_name: string | null; ward_code: string | null; region_code: string | null; region_name: string | null; pallets: number | null; tons: number | null; delivery_date: string | null; note: string | null }
/** Nháp khác đang XẾP đơn này trên xe — đủ để bảng Xem đơn in "nháp 30/09 · Admin · 14:03" và nút Mở nháp đó / Kéo về đây. */
export interface OtherDraftRef { plan_id: string; plan_date: string; created_by: string | null; created_at: string; seq: number | null }
export interface ExcludedOd { od_number: string; kind: ExcludeKind; info: string | null; until?: string | null; reason?: string; d?: ExcludedDetail; ref?: OtherDraftRef }
export interface PoolSplit {
  include: Map<string, { delivery_date: string | null; late_days: number }>
  excluded: ExcludedOd[]
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000)
/** Dòng SAP đã post (Mat Doc / SL đã xuất) — từ 03/10 tối chỉ là CỜ THAM CHIẾU (odFlags), không còn loại đơn khỏi đợt ghép. */
export const shippedRow = (r: PoolCandidateRow) => !!(r.mat_doc && String(r.mat_doc).trim()) || Number(r.qty_issued_base ?? 0) > 0

export type OtherDraft = string | ({ info: string } & OtherDraftRef)
export function splitPool(
  rows: PoolCandidateRow[], day: string,
  // `reportAll` (30/09): báo CẢ OD tồn đọng đã điều — cho cửa "Xem cả đơn tồn đọng đã đi" của tab Đã điều (user: "170 đơn
  // đi đâu mất, sao không nằm trong Đã điều"); lập kế hoạch vẫn để false để params không phình 2.000 dòng lịch sử
  // `outside` (03/10 tối): dấu tay "Ngoài app" của kho — đơn đã được xử lý ngoài bàn này, LUÔN báo (như Không điều) để còn bỏ dấu.
  ctx: { inPlan: Map<string, string>; otherDraft: Map<string, OtherDraft>; held?: Map<string, { until: string | null; reason: string }>; redo?: Map<string, string>; outside?: Map<string, { reason: string; by: string | null }>; reportAll?: boolean },
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
    // 03/10 tối (user: "SAP có nhiều đơn return, trả, đã đi chưa post, đã post chưa đi — dựa theo SAP sẽ rối loạn; lấy theo lịch sử
    // của app và dấu tay của người"): Mat Doc / SAP gắn xe KHÔNG loại đơn nữa — chúng thành cờ vàng trên tab Điều (odFlags), người
    // quyết bằng dấu Ngoài app. Trước đó hai cờ này tự đưa đơn sang "Đã điều" — đơn đã post mà hàng chưa đi là biến mất khỏi bàn.
    // OD cũ đã lên xe thắng cả dấu Không điều: hàng đã đi dưới số OD cũ
    if (ctx.redo?.has(od)) { excluded.push({ od_number: od, kind: 'REDO_DISPATCHED', info: ctx.redo.get(od) ?? null }); continue }
    const h = ctx.held?.get(od)
    if (h && (h.until == null || h.until > day)) { excluded.push({ od_number: od, kind: 'HELD', info: `${h.until ? `hoãn tới ${h.until}` : 'không điều'} — ${h.reason}`, until: h.until, reason: h.reason }); continue }
    const x = ctx.outside?.get(od)
    if (x) { excluded.push({ od_number: od, kind: 'OUTSIDE_APP', info: `ngoài app — ${x.reason}`, reason: x.reason }); continue }
    // Bản nháp KHÁC đang XẾP OD trên xe ⇒ LUÔN báo, kể cả OD tồn đọng (29/09): Ba Vì lập KH 29/09 thấy 191 OD tưởng đủ, trong khi
    // 223 OD ngày 25/09 nằm im trong bản nháp 28/09 ai đó quên. 03/10 tối: chỉ đơn ĐÃ LÊN XE mới bị giữ — khung chờ là tự do
    // (user: "283 đơn bị nháp 30/09 giữ dù chưa lên xe nào — chưa hợp lý"); controller chỉ đưa vào `otherDraft` các đơn trên xe.
    const od2 = ctx.otherDraft.get(od)
    if (od2 !== undefined) {
      if (typeof od2 === 'string') excluded.push({ od_number: od, kind: 'OTHER_DRAFT', info: od2 })
      else { const { info, ...ref } = od2; excluded.push({ od_number: od, kind: 'OTHER_DRAFT', info, ref }) }
      continue
    }
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
 *  OD cũ vắng file · cùng (SO, item) có OD mới trong file · OD cũ NẰM TRONG KHOẢNG PHỦ của file · OD cũ chưa xuất kho (đã xuất thì
 *  không "thay" được, chỉ cảnh báo).
 *  KHOẢNG PHỦ (03/10 tối): SAP đổ ZSD02 theo NGÀY TẠO, nên khoảng phủ = khoảng ngày tạo OD người khai khi nạp (`coverage`). OD cũ tạo
 *  NGOÀI khoảng mà vắng file thì vắng mặt không nói lên điều gì ⇒ chỉ là TÍN HIỆU `uncertain` ("cùng SO Item có DO mới — thay hay giao
 *  thêm?") cho người quyết — bản cũ kết luận "thay" ngay nên đơn GIAO THÊM (DO cũ chưa post vẫn còn ở SAP) bị đánh bỏ oan. Không có
 *  `coverage` thì rơi về luật cũ: ngày giao OD cũ trong khoảng ngày giao của file.
 *  PHẢ HỆ (`edges`): mỗi cặp (OD cũ → OD mới) kèm loại — REPLACE 1→1 · SPLIT 1→N · MERGE N→1 · AFTER_POST (OD cũ đã post) — để ghi
 *  `od_lineage`; rào DB chống một đơn đi hai ngày kiểm trên cả họ. */
export interface ReplaceCandidate { od_number: string; od_item: string; so_number: string | null; so_item: string | null; delivery_date: string | null; mat_doc: string | null; qty_issued_base: number | string | null; od_created_at?: string | null }
export type LineageKind = 'REPLACE' | 'SPLIT' | 'MERGE' | 'AFTER_POST'
export interface LineageEdge { old_od: string; new_od: string; kind: LineageKind; so_number: string; so_item: string }
export function findReplacedOds(
  fileOds: { od_number: string; so_number: string | null; so_item: string | null; delivery_date: string | null }[],
  prior: ReplaceCandidate[],
  coverage?: { from: string; to: string } | null,
): { replaced: { od_number: string; od_item: string; by: string }[]; shipped_conflicts: { od_number: string; by: string; so: string }[]; edges: LineageEdge[]; uncertain: { od_number: string; by: string; so: string }[] } {
  const fileDos = new Set(fileOds.map(r => r.od_number))
  const newBySo = new Map<string, string[]>()
  for (const r of fileOds) if (r.so_number && r.so_item) { const k = `${r.so_number}__${r.so_item}`; const l = newBySo.get(k) ?? []; if (!l.includes(r.od_number)) l.push(r.od_number); newBySo.set(k, l) }
  const dates = fileOds.map(r => r.delivery_date).filter((x): x is string => !!x).sort()
  const lo = dates[0], hi = dates[dates.length - 1]
  // OD cũ không có ngày tạo (dòng nạp trước khi có cột — staging 03/10: 14 OD Ba Vì) thì rơi về luật ngày giao, không thì nó
  // mãi mãi chỉ là `uncertain`: OD cũ giữ ACTIVE, không có cạnh phả hệ ⇒ rào DB mù với họ đó (review 03/10)
  const byDelivery = (p: ReplaceCandidate) => !!lo && !!p.delivery_date && p.delivery_date >= lo && p.delivery_date <= hi
  const covered = (p: ReplaceCandidate) => coverage
    ? (p.od_created_at ? p.od_created_at >= coverage.from && p.od_created_at <= coverage.to : byDelivery(p))
    : byDelivery(p)
  const replaced: { od_number: string; od_item: string; by: string }[] = []
  const shipped_conflicts: { od_number: string; by: string; so: string }[] = []
  const uncertain: { od_number: string; by: string; so: string }[] = []
  // gom OD cũ vắng file theo SO Item để biết thay 1→1 · tách 1→N · gộp N→1
  const oldsBySo = new Map<string, ReplaceCandidate[]>()
  for (const p of prior) {
    if (fileDos.has(p.od_number) || !p.so_number || !p.so_item) continue
    const k = `${p.so_number}__${p.so_item}`
    const news = (newBySo.get(k) ?? []).filter(n => n !== p.od_number)
    if (!news.length) continue
    const so = `${p.so_number}/${p.so_item}`
    if (!covered(p)) { if (!uncertain.some(x => x.od_number === p.od_number)) uncertain.push({ od_number: p.od_number, by: news[0], so }); continue }
    if ((p.mat_doc && String(p.mat_doc).trim()) || Number(p.qty_issued_base ?? 0) > 0) {
      if (!shipped_conflicts.some(x => x.od_number === p.od_number)) shipped_conflicts.push({ od_number: p.od_number, by: news[0], so })
      const l = oldsBySo.get(k) ?? []; if (!l.some(x => x.od_number === p.od_number)) l.push(p); oldsBySo.set(k, l)
      continue
    }
    replaced.push({ od_number: p.od_number, od_item: p.od_item, by: news[0] })
    const l = oldsBySo.get(k) ?? []; if (!l.some(x => x.od_number === p.od_number)) l.push(p); oldsBySo.set(k, l)
  }
  const edges: LineageEdge[] = []
  for (const [k, olds] of oldsBySo) {
    const news = (newBySo.get(k) ?? []).filter(n => !olds.some(o => o.od_number === n))
    const [so_number, so_item] = k.split('__')
    const kind: LineageKind = news.length > 1 && olds.length === 1 ? 'SPLIT' : olds.length > 1 && news.length === 1 ? 'MERGE' : 'REPLACE'
    for (const o of olds) {
      const posted = (o.mat_doc && String(o.mat_doc).trim()) || Number(o.qty_issued_base ?? 0) > 0
      for (const n of news) edges.push({ old_od: o.od_number, new_od: n, kind: posted ? 'AFTER_POST' : kind, so_number, so_item })
    }
  }
  return { replaced, shipped_conflicts, edges, uncertain }
}
