/**
 * POOL LŨY TIẾN của Điều vận — hàm thuần, không DB (user chốt 25/09/2026; test tests/unit/dispatchPool.test.ts).
 *
 * ZSD02 là dữ liệu THÔ của điều hàng: trong cùng một file có OD đã đi hàng, OD đã điều, OD chưa điều. Mỗi lần lập kế
 * hoạch (và mỗi lần ZSD02 nạp lại trong ngày) máy phải tự bỏ ra những OD đã được lo — không chỉ OD đã vào Kế hoạch xuất
 * của app như bản 24/09. Một OD vào đợt ghép khi và chỉ khi:
 *   (1) chưa nằm trong Kế hoạch xuất (khvc_lines) và chưa LÊN XE ở một bản nháp ĐANG MỞ khác (khung chờ là tự do — 03/10 tối);
 *   (2)(3) — BỎ 03/10 tối: "SAP đã điều phối" và "đã xuất (Mat Doc / SL đã xuất)" không còn loại đơn — chúng là CỜ THAM CHIẾU
 *       trên tab Điều, người quyết bằng dấu tay (Ngoài app · Không điều) hoặc điều thật. Lịch sử của app mới là nguồn sự thật.
 * NGÀY GIAO ZSD02 KHÔNG QUYẾT GÌ (05/10 khuya, user: "dữ liệu trong zsd02 mặc kệ nó, trong đó không có ngày giao đáng tin cậy. USER
 * sẽ là người chọn"): đơn ngày giao nào cũng vào nếu đủ các điều kiện dưới — không "trễ n ngày", không "đơn của hôm nay". Đơn đã có
 * trong Kế hoạch xuất LUÔN báo (IN_PLAN): cửa nạp chỉ trả những đơn có NGÀY XUẤT = ngày lập (tab Đã điều của ngày đó), các cửa theo
 * số OD (tối ưu lại · bỏ dấu · lấy sang…) báo để đơn không biến mất không lời. Đơn đang nằm ở bản nháp mở khác LUÔN báo (29/09).
 * (4) HOÃN (27/09, user: "đơn key một ngày nhưng có thể điều ngày khác · đơn note khác — không tự động được"): OD người đã
 *     đánh dấu Hoãn tới ngày SAU ngày lập, hoặc Không điều (không ngày), KHÔNG vào đợt ghép — và LUÔN được báo vì đó là quyết
 *     định của người, phải thấy để còn bỏ hoãn. Tới ngày người hẹn thì OD quay lại đợt ghép.
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
  /** ngày giao = số SAP để HIỂN THỊ (cột Ngày giao), máy không dùng để quyết */
  include: Map<string, { delivery_date: string | null }>
  excluded: ExcludedOd[]
}

/** Dòng SAP đã post (Mat Doc / SL đã xuất) — từ 03/10 tối chỉ là CỜ THAM CHIẾU (odFlags), không còn loại đơn khỏi đợt ghép. */
export const shippedRow = (r: PoolCandidateRow) => !!(r.mat_doc && String(r.mat_doc).trim()) || Number(r.qty_issued_base ?? 0) > 0

export type OtherDraft = string | ({ info: string } & OtherDraftRef)
export function splitPool(
  // `day` = ngày lập — chỉ để so với ngày người hẹn (dấu "Không điều ngày này"), không so với ngày giao SAP
  rows: PoolCandidateRow[], day: string,
  // `outside` (03/10 tối): dấu tay "Ngoài app" của kho — đơn đã được xử lý ngoài bàn này, LUÔN báo (như Không điều) để còn bỏ dấu.
  ctx: { inPlan: Map<string, string>; otherDraft: Map<string, OtherDraft>; held?: Map<string, { until: string | null; reason: string }>; redo?: Map<string, string>; outside?: Map<string, { reason: string; by: string | null }> },
): PoolSplit {
  const byOd = new Map<string, PoolCandidateRow[]>()
  for (const r of rows) { const l = byOd.get(r.od_number) ?? []; l.push(r); byOd.set(r.od_number, l) }
  const include: PoolSplit['include'] = new Map()
  const excluded: ExcludedOd[] = []
  for (const od of [...byOd.keys()].sort()) {
    const rs = byOd.get(od)!
    // ngày giao in ra = ngày MUỘN nhất trong các dòng (SAP có thể dời một phần)
    const dd = rs.map(r => r.delivery_date).filter((x): x is string => !!x).sort().pop() ?? null
    if (ctx.inPlan.has(od)) { excluded.push({ od_number: od, kind: 'IN_PLAN', info: ctx.inPlan.get(od) ?? null }); continue }
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
    include.set(od, { delivery_date: dd })
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

/** NẠP ZSD02 THEO SO (24/10, user chốt — thay luật "khoảng phủ ngày tạo OD" 03/10): SO là MẸ, DO là CON. SO nào CÓ trong file thì file
 *  là BẢN CUỐI của SO đó ⇒ dòng DO (od, item) của SO đó mà vắng file bị XOÁ MỀM; SO không có trong file thì không đụng (nạp lẻ vài SO là
 *  bình thường). Ngoại lệ DUY NHẤT: DO ĐÃ XUẤT theo APP (chuyến Xuất kho hoàn thành — `shipped`; Mat Doc / post SAP không có nghĩa) thì
 *  không bao giờ bị xoá mềm.
 *  • DO vắng HẲN file mà cùng (SO, item) có DO mới ⇒ "SAP thay" (`by` = DO mới đầu tiên) + cạnh phả hệ: REPLACE 1→1 · SPLIT 1→N ·
 *    MERGE N→1; DO cũ đã xuất ⇒ cạnh AFTER_POST (DO mới cùng dòng SO với DO đã đi — có thể là CHÍNH phần đã đi mang số mới, có thể là
 *    giao thêm: người quyết ở Điều vận, rào DB giữ một ngày cho cả họ tới khi quyết).
 *  • DO vắng hẳn, không DO mới ⇒ SAP đã bỏ (`by` null).
 *  • DO còn trong file nhưng mất dòng ⇒ chỉ dòng đó xoá mềm, không phả hệ (DO vẫn sống).
 *  `fileSos` = mọi SO trong file, kể cả dòng SO CHƯA có DO (SAP xoá DO thì dòng SO vẫn còn, chỉ không còn số DO). */
export interface PriorLine { id: string; od_number: string; od_item: string; so_number: string | null; so_item: string | null }
export type LineageKind = 'REPLACE' | 'SPLIT' | 'MERGE' | 'AFTER_POST'
export interface LineageEdge { old_od: string; new_od: string; kind: LineageKind; so_number: string; so_item: string }
export interface SoScopedChanges {
  obsolete: { id: string; od_number: string; od_item: string; by: string | null }[]
  replaced: [string, string][]          // (DO cũ, DO mới đầu tiên) — DO cũ vắng hẳn file, chưa xuất
  gone: string[]                        // DO vắng hẳn file, chưa xuất, không DO mới
  kept_shipped: string[]                // DO vắng file nhưng ĐÃ XUẤT ⇒ giữ nguyên
  edges: LineageEdge[]
}
export function soScopedChanges(
  fileLines: { od_number: string; od_item: string; so_number: string | null; so_item: string | null }[],
  fileSos: Iterable<string>,
  prior: PriorLine[],
  shipped: ReadonlySet<string>,
): SoScopedChanges {
  const sos = new Set(fileSos)
  const fileKeys = new Set(fileLines.map(r => `${r.od_number}__${r.od_item}`))
  const fileDos = new Set(fileLines.map(r => r.od_number))
  const newBySo = new Map<string, string[]>()
  for (const r of fileLines) if (r.so_number && r.so_item) { const k = `${r.so_number}__${r.so_item}`; const l = newBySo.get(k) ?? []; if (!l.includes(r.od_number)) l.push(r.od_number); newBySo.set(k, l) }
  const out: SoScopedChanges = { obsolete: [], replaced: [], gone: [], kept_shipped: [], edges: [] }
  const oldsBySo = new Map<string, string[]>()   // (SO, item) → DO cũ vắng hẳn file (chưa xuất + đã xuất)
  const goneCand = new Set<string>(), repl = new Map<string, string>(), kept = new Set<string>()
  for (const p of prior) {
    if (!p.so_number || !sos.has(p.so_number) || fileKeys.has(`${p.od_number}__${p.od_item}`)) continue
    const k = `${p.so_number}__${p.so_item ?? ''}`
    const whole = !fileDos.has(p.od_number)
    const news = whole && p.so_item ? (newBySo.get(k) ?? []).filter(n => n !== p.od_number) : []
    if (whole && news.length) { const l = oldsBySo.get(k) ?? []; if (!l.includes(p.od_number)) l.push(p.od_number); oldsBySo.set(k, l) }
    if (shipped.has(p.od_number)) { kept.add(p.od_number); continue }
    out.obsolete.push({ id: p.id, od_number: p.od_number, od_item: p.od_item, by: news[0] ?? null })
    if (!whole) continue
    if (news.length) { if (!repl.has(p.od_number)) repl.set(p.od_number, news[0]) } else goneCand.add(p.od_number)
  }
  for (const [k, olds] of oldsBySo) {
    const news = (newBySo.get(k) ?? []).filter(n => !olds.includes(n))
    const [so_number, so_item] = k.split('__')
    const kind: LineageKind = news.length > 1 && olds.length === 1 ? 'SPLIT' : olds.length > 1 && news.length === 1 ? 'MERGE' : 'REPLACE'
    for (const o of olds) for (const n of news) out.edges.push({ old_od: o, new_od: n, kind: shipped.has(o) ? 'AFTER_POST' : kind, so_number, so_item })
  }
  out.replaced = [...repl.entries()]
  // một DO nhiều dòng: có dòng được thay thì DO là "thay", không đếm thêm vào "SAP bỏ"
  out.gone = [...goneCand].filter(od => !repl.has(od))
  out.kept_shipped = [...kept]
  return out
}

/** ĐƠN MÁY CHIA NHIỀU XE (24/10, user duyệt): cửa đưa đơn RỜI kế hoạch (hoãn · đổi ngày từng đơn · Ngoài app) gỡ MỌI phần của đơn — một đơn
 *  một ngày. Phần nằm trên xe ĐANG KHOÁ (đã chốt, không mở) sẽ bị kéo đi theo mà không ai mở xe đó ⇒ trả câu chặn, bắt mở khoá mọi xe đang
 *  chở đơn. Đơn chỉ ở một xe, hoặc mọi xe chở nó đều đang mở ⇒ null (cho đi). */
export function splitOnLocked(rows: { od_number: string; trip_id: string | null }[], ods: string[], trips: Map<string, { seq: number; group_code: string; locked: boolean }>, what: string): string | null {
  for (const od of ods) {
    const on = [...new Set(rows.filter(o => o.od_number === od && o.trip_id).map(o => o.trip_id!))].map(id => trips.get(id)).filter((x): x is { seq: number; group_code: string; locked: boolean } => !!x)
    const stuck = on.filter(t => t.locked)
    if (on.length > 1 && stuck.length)
      return `Đơn ${od} đang chia ${on.length} xe (${on.map(t => `#${t.seq} ${t.group_code}`).join(', ')}) — mở khoá cả ${on.length} xe rồi mới ${what} đơn này (xe ${stuck.map(t => `#${t.seq}`).join(', ')} đang khoá).`
  }
  return null
}

/** KHOẢNG NGÀY tính tỷ trọng ĐVVT đã chạy (22/10): đầu tháng → TRƯỚC ngày của kế hoạch (`.lt(before)`). Không đếm chính ngày đó — xoá
 *  rồi tạo lại / xác nhận mảng kia trước không được đổi kết quả ghép của cùng một ngày (dispatchController.loadShareActual). */
export function shareBaseRange(day: string): { from: string; before: string } {
  return { from: `${day.slice(0, 7)}-01`, before: day }
}
