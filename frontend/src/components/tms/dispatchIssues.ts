// VIỆC CỦA NGƯỜI trên kế hoạch điều vận — MỘT nguồn cho cả bảng "Danh sách xe" lẫn "Bàn ghép xe" (25/09): hai góc nhìn
// của cùng một kế hoạch mà đếm "cần xử lý" hai kiểu thì người soát không biết tin bên nào.
//
// Vì sao có (user chốt 24/09 "máy ghép trước sau đó tới người manual và xác nhận"): đo trên kế hoạch thật của Ba Vì 07/09
// **12/61 xe cần người quyết**, nằm rải trong 61 dòng. Trang phải trả lời ngay "còn bao nhiêu việc" và đưa người tới đó.
// ⚠ CHỈ tính trên xe NGƯỜI CÒN SỬA ĐƯỢC (DRAFT/DECLINED) — xe đã vào Kế hoạch xuất mà thiếu cước thì không chữa ở đây.
// ⚠ `todo` = NGƯỜI ĐÓNG ĐƯỢC. "Chưa có cước" / "Có cảnh báo" thì không: bảng cước thiếu (phường × dòng xe) thì gán ĐVVT xong
// vẫn thiếu — đếm vào là bộ đếm KHÔNG BAO GIỜ về 0 (đo 24/09), và bộ đếm không về 0 dạy người ta bỏ qua nó.
// 25/09 thêm "OD đổi ở SAP": OD trên xe bị SAP thay (sửa SO) / bỏ / đã xuất / đã điều cho ĐVVT khác sau khi lập nháp —
// việc NGƯỜI ĐÓNG ĐƯỢC (thay OD / kéo OD ra), và cửa Xác nhận chặn 409 nếu còn.
import type { DispatchTrip, DispatchTripStatus, DispatchOdFlag, DispatchTripOd, DispatchPlan, DispatchUnderMin, DispatchTooBig, DispatchFitResult } from '@/api/hooks'

/** RANH GIỚI KẾ HOẠCH (07/10, user: "đơn không tick ở lại Chờ điều"): dòng trên xe, hoặc dòng khung chờ ĐÃ có mốc `reviewed_at`, thuộc
 *  kế hoạch; dòng khung chờ chưa mốc = CHỜ ĐIỀU — nằm ở tab Bán hàng / Trung chuyển của Xem đơn, bàn ghép xe không vẽ, "Tối ưu lại" không
 *  đụng. Server cùng luật (reoptimize · move) — sửa luật thì sửa cả hai phía. */
export const inPlanRow = (o: Pick<DispatchTripOd, 'trip_id' | 'reviewed_at'>) => !!o.trip_id || !!o.reviewed_at
/** Kế hoạch như BÀN GHÉP XE thấy: khung chờ chỉ còn dòng thuộc kế hoạch (bỏ Chờ điều), số khung chờ tính lại theo đúng tập đó — cảnh
 *  báo Xác nhận "N OD còn ở khung chờ (sẽ KHÔNG đi)" và dải chỉ số đọc từ đây. "Không liên quan" (dấu riêng người xem) chỉ áp cho Chờ
 *  điều — đơn đã vào kế hoạch thì mọi người phải thấy, kẻo cảnh báo Xác nhận đếm thiếu. */
export function boardPlanOf(plan: DispatchPlan): DispatchPlan {
  const pool = (plan.pool ?? []).filter(inPlanRow)
  return { ...plan, pool, summary: { ...plan.summary, pool_ods: new Set(pool.map(o => o.od_number)).size, pool_pallets: Math.round(pool.reduce((s, o) => s + Number(o.pallets ?? 0), 0) * 10) / 10 } }
}
/** Kế hoạch có đang GIỮ đơn nào không (xe có đơn · khung chờ của kế hoạch) — từ tổng kết server. Băng "nháp quá ngày" chỉ nhắc nháp này:
 *  bấm Xem đơn là có nháp chứa toàn Chờ điều, nháp đó không giữ đơn nào nên không phải việc bị bỏ quên (07/10). */
export const planHoldsOrders = (s: { trips?: number; pool_ods?: number; unreviewed_ods?: number } | null | undefined) =>
  (s?.trips ?? 0) > 0 || (s?.pool_ods ?? 0) - (s?.unreviewed_ods ?? 0) > 0

export const EDITABLE: DispatchTripStatus[] = ['DRAFT', 'DECLINED']
export const tripStatus = (t: DispatchTrip): DispatchTripStatus => t.status ?? 'DRAFT'
export type IssueKey = 'declined' | 'sapflag' | 'whhold' | 'scope' | 'nomodel' | 'nocarrier' | 'nofreight' | 'over' | 'rule' | 'under' | 'warn'
/** Câu cảnh báo server ghi khi xe SAI LUẬT GHÉP XE (`computeTripPatch`, BE): vượt số khách · dòng xe không chở được điều kiện bảo quản ·
 *  khách không được vào dòng xe · chở lẫn Loại kho khi switch tắt. 14/10 (user: "làm sai rule cần popup và ngăn chặn") mọi cửa làm tay đã
 *  CHẶN — xe còn mang câu này là xe vượt từ trước (lập trước luật / cấu hình đổi sau) ⇒ việc ĐỎ, và cửa Xác nhận cũng chặn (409
 *  TRIP_RULE_VIOLATION). Vượt tải có cờ riêng (`oversize`). Sửa câu ở BE thì sửa các mẫu này. "chưa khai Dòng xe được vào" KHÔNG là sai luật. */
export const RULE_WARNING = /^(Vượt số khách cùng xe|Dòng xe .+ không phục vụ điều kiện bảo quản|Khách .+ không được vào dòng xe|Xe chở lẫn )/
/** Hai luật đọc thẳng DÒNG OD (bản chụp lúc lập — đi xe riêng · kênh), không cần dòng xe ⇒ tính ngay trên trình duyệt (15/10, user: chip phải
 *  bắt đủ mọi luật). Xe sai TỪ TRƯỚC (kéo trước 14/10) cũng lên chip ngay, không đợi ai sửa xe để server ghi câu cảnh báo. MIRROR của
 *  `manualRuleBlocks` ở cửa Xác nhận (`whole`) — `backend/tests/mirror/dispatchRuleChip.mirror.test.ts` gác. `mixChannels` = kế hoạch cho
 *  trộn kênh (`params.allow_mix_channels`; không khai = không cho, như server). */
export function rowRuleWarnings(ods: Pick<DispatchTripOd, 'od_number' | 'ship_to_code' | 'ship_to_name' | 'separate' | 'channel'>[], mixChannels = false): string[] {
  const out: string[] = []
  const stops = new Set(ods.map(o => o.ship_to_code ?? o.od_number)).size
  const sep = [...new Set(ods.filter(o => o.separate === true).map(o => o.ship_to_name || o.ship_to_code || o.od_number))]
  if (stops > 1 && sep.length) out.push(`Khách ${sep.slice(0, 2).join(', ')}${sep.length > 2 ? '…' : ''} đi xe riêng — xe đang chở ${stops} khách`)
  const chs = mixChannels ? [] : [...new Set(ods.map(o => o.channel).filter((c): c is string => !!c))].sort()
  if (chs.length > 1) out.push(`Xe trộn kênh khách ${chs.join(' + ')} — kho không cho trộn kênh`)
  return out
}
export const ruleWarnings = (t: Pick<DispatchTrip, 'detail' | 'ods'>, mixChannels = false) =>
  [...t.detail.warnings.filter(w => RULE_WARNING.test(w)), ...rowRuleWarnings(t.ods, mixChannels)]
/** `scope` (12/10): Loại kho người xem được giao — null = không giới hạn (superadmin / NATIONAL / chưa cấu hình), MIRROR `scopeCategoriesOf`
 *  của BE. Xe chở loại ngoài phạm vi thì Xác nhận bị 403 `CATEGORY_OUT_OF_SCOPE` (C78) — báo SỚM trên bàn, đừng để bấm rồi mới biết.
 *  `mixChannels` (15/10): kế hoạch cho trộn kênh khách — luật kênh của chip "Sai quy định". */
export type IssueCtx = { flags: Map<string, DispatchOdFlag>; scope?: Set<string> | null; mixChannels?: boolean }
/** Loại kho NGOÀI phạm vi được giao trong `cats` — cùng luật với cửa Xác nhận (từng loại phải được giao; null = mọi loại). */
export const outOfScopeCats = (cats: string[] | null | undefined, scope: Set<string> | null | undefined): string[] =>
  scope ? (cats ?? []).filter(c => !scope.has(c)) : []
/** Cờ SAP chỉ THAM CHIẾU (user chốt 03/10 tối): "SAP đã post" / "SAP đã gắn xe" không loại đơn, không chặn Xác nhận — nên cũng
 *  KHÔNG là việc "OD đổi ở SAP" (06/10: Bàu Bàng 695/709 xe "cần xử lý" chỉ vì cờ này; cửa Xác nhận + bảng Xem đơn đã đọc đúng). */
export const SOFT_FLAG_KINDS = new Set<DispatchOdFlag['kind']>(['SHIPPED', 'SAP_ASSIGNED'])
const hardFlag = (c: IssueCtx, od: string) => { const k = c.flags.get(od)?.kind; return !!k && !SOFT_FLAG_KINDS.has(k) && k !== 'WH_SCANNED' }
/** 17/10: đơn có hàng ĐÃ QUÉT bên Xuất trên chuyến của xe đã rút — xe mang đơn tô đỏ, Xác nhận chặn nếu đơn không về đúng xe cũ */
const whHeld = (c: IssueCtx, od: string) => c.flags.get(od)?.kind === 'WH_SCANNED'
export const ISSUES: { key: IssueKey; label: string; tip: string; todo: boolean; test: (t: DispatchTrip, c: IssueCtx) => boolean }[] = [
  { key: 'declined',  label: 'ĐVVT từ chối',   todo: true,  tip: 'Đổi ĐVVT trong panel xe rồi "Chốt xe này"',                     test: t => tripStatus(t) === 'DECLINED' },
  { key: 'sapflag',   label: 'OD đổi ở SAP',   todo: true,  tip: 'OD trên xe bị SAP thay (sửa SO) / bỏ / sửa / đã vào Kế hoạch xuất sau khi lập nháp — thay OD, cập nhật theo SAP hoặc kéo OD ra khỏi xe. Cờ "SAP đã post / đã gắn xe" chỉ là tham chiếu, không tính ở đây', test: (t, c) => t.ods.some(o => hardFlag(c, o.od_number)) },
  { key: 'whhold',    label: 'Kho đã quét',    todo: true,  tip: 'Đơn trên xe có hàng ĐÃ QUÉT bên Xuất kho trên chuyến của xe đã rút (mở lại / huỷ). Về lại đúng xe cũ rồi Xác nhận thì chuyến sống lại với hàng đã quét; đưa sang xe khác thì thủ kho phải trả hàng (xoá QR / gỡ nhặt lẻ) trước — Xác nhận chặn', test: (t, c) => t.ods.some(o => whHeld(c, o.od_number)) },
  { key: 'scope',     label: 'Ngoài phạm vi',  todo: true,  tip: 'Xe chở Loại kho NGOÀI phạm vi bạn được giao — Xác nhận sẽ bị chặn. Kéo các OD loại đó ra khỏi xe / Trả về Chờ điều, hoặc nhờ người được giao loại đó xác nhận', test: (t, c) => outOfScopeCats(t.detail.categories, c.scope).length > 0 },
  { key: 'nomodel',   label: 'Chưa có dòng xe', todo: true, tip: 'Máy không tìm được dòng xe vừa tải / đủ điều kiện bảo quản',    test: t => t.ods.length > 0 && !t.vehicle_model_id },
  { key: 'nocarrier', label: 'Chưa có ĐVVT',   todo: true,  tip: 'Không ĐVVT nào có cước cho tuyến + dòng xe này — chọn tay',      test: t => t.ods.length > 0 && !t.transport_company_id },
  { key: 'over',      label: 'Vượt tải',       todo: true,  tip: 'Xe vượt trần tải của dòng xe — kéo bớt OD sang xe khác hoặc đổi xe lớn hơn. Xe vượt tải KHÔNG xác nhận được (14/10)', test: t => t.oversize },
  { key: 'rule',      label: 'Sai quy định',   todo: true,  tip: 'Xe sai luật ghép xe (vượt số khách · đi xe riêng · trộn kênh khách · dòng xe không chở được điều kiện bảo quản · khách không được vào dòng xe · chở lẫn Loại kho) — kéo bớt OD hoặc đổi dòng xe. Kéo thả mới đã bị chặn; xe này sai từ trước và KHÔNG xác nhận được', test: (t, c) => ruleWarnings(t, c.mixChannels).length > 0 },
  { key: 'under',     label: 'Non tải',        todo: true,  tip: 'Dưới ngưỡng Non tải — máy đã thử gộp cùng vùng, còn lại cần người quyết', test: t => t.underload },
  { key: 'nofreight', label: 'Chưa có cước',   todo: false, tip: 'Thường vì bảng cước chưa có tuyến + dòng xe này — xác nhận vẫn được, chuyến sẽ không có cước dự tính', test: t => t.ods.length > 0 && t.freight_estimated == null },
  { key: 'warn',      label: 'Có cảnh báo',    todo: false, tip: 'Máy ghi lại chỗ nó không tự xử được — đọc Ghi chú máy',          test: t => t.detail.warnings.length > 0 },
]
export const TODO_KEYS = new Set(ISSUES.filter(i => i.todo).map(i => i.key))
export const issuesOf = (t: DispatchTrip, c: IssueCtx): IssueKey[] =>
  EDITABLE.includes(tripStatus(t)) ? ISSUES.filter(i => i.test(t, c)).map(i => i.key) : []
export const needsWork = (t: DispatchTrip, c: IssueCtx) => issuesOf(t, c).some(k => TODO_KEYS.has(k))
// Nhãn NGẮN, xếp theo mức KHẨN — in ngay dưới Số xe (bảng) / trên thẻ xe (bàn ghép)
export const ISSUE_SHORT: Record<IssueKey, string> = {
  declined: 'ĐVVT từ chối', sapflag: 'OD đổi ở SAP', whhold: 'kho đã quét', scope: 'ngoài phạm vi của bạn', over: 'vượt tải', rule: 'sai quy định', nomodel: 'chưa có dòng xe', nocarrier: 'chưa có ĐVVT',
  nofreight: 'chưa có cước', under: 'Non tải', warn: 'có cảnh báo',
}
export const ISSUE_ORDER: IssueKey[] = ['declined', 'sapflag', 'whhold', 'scope', 'over', 'rule', 'nomodel', 'nocarrier', 'nofreight', 'under', 'warn']
/** Vấn đề tô ĐỎ (chặn Xác nhận / xe không đi được) — còn lại hổ phách (việc) hoặc xám (tin) */
export const RED_ISSUES = new Set<IssueKey>(['declined', 'over', 'rule', 'sapflag', 'whhold', 'scope'])
/** Lựa chọn trên bàn ghép xe SAU một lần chuyển: chỉ bỏ các đơn VỪA chuyển — kế hoạch lớn trả lời chậm (709 xe ~8 s), ô người tick
 *  trong lúc chờ phải còn (06/10: Hoàn tác xong xoá sạch lựa chọn ⇒ lần kéo sau chỉ mang một đơn). Không đổi gì thì trả CHÍNH tập cũ. */
export const selectionAfterMove = (sel: Set<string>, moved: string[]): Set<string> => {
  if (!moved.some(id => sel.has(id))) return sel
  const n = new Set(sel)
  for (const id of moved) n.delete(id)
  return n
}
/** Id hiện hành của một xe trong ngăn Hoàn tác — xe bị bỏ (hết OD) rồi Hoàn tác dựng lại mang id MỚI, có thể nhiều lần (id cũ → id mới, nối chuỗi). */
export const liveTripId = (rebuilt: Map<string, string>, id: string): string => {
  let x = id
  for (let n = 0; n < 50 && rebuilt.has(x); n++) x = rebuilt.get(x)!
  return x
}
export interface UndoStep<R> { tid: string | null; ids: string[]; to: 'trip' | 'new' | 'pool'; to_trip_id?: string; restore?: R }
/** HOÀN TÁC một lần chuyển (15/10): trả các dòng còn trên bàn về chỗ cũ, mỗi chỗ cũ một bước. Xe cũ còn ⇒ thả vào xe đó; xe cũ đã bị bỏ
 *  vì hết OD (server bỏ ngay — user: "gỡ đơn ra khỏi xe thì xoá cả xe") ⇒ dựng lại ĐÚNG xe đó từ bản chụp lúc chuyển (`to:'new'` +
 *  `restore`), không để máy chọn như Xe mới; xe đã dựng lại ở lần Hoàn tác trước ⇒ thả vào id mới (`rebuilt`). */
export function undoSteps<R>(prev: Map<string, string | null>, ids: string[], onBoard: { has: (id: string) => boolean }, tripIds: Set<string>,
  snaps: Map<string, R> | undefined, rebuilt: Map<string, string>): UndoStep<R>[] {
  const by = new Map<string | null, string[]>()
  for (const id of ids) { if (!onBoard.has(id)) continue; const k = prev.get(id) ?? null; by.set(k, [...(by.get(k) ?? []), id]) }
  return [...by].map(([tid, part]): UndoStep<R> => {
    if (!tid) return { tid, ids: part, to: 'pool' }
    const cur = liveTripId(rebuilt, tid)
    return tripIds.has(cur) ? { tid, ids: part, to: 'trip', to_trip_id: cur } : { tid, ids: part, to: 'new', restore: snaps?.get(tid) }
  })
}
/** KHUNG CHỜ GOM THEO LÔ (15/10, user: "khối vàng và bảng đang diễn giải gần giống nhau — gom lại dạng table, vừa đủ thông tin vừa dễ thao
 *  tác"; thay khối vàng "n đơn dưới tối thiểu" chỉ in 6 lô): mỗi LÔ máy định xếp mà KHÔNG tạo xe là một nhóm của bảng khung chờ — lô dưới
 *  Tối thiểu % (`under_min`, hổ phách) và đơn lớn hơn xe (`too_big`, đỏ, mỗi đơn một lô); đơn còn lại ở nhóm "Ngoài lô" cuối bảng. Lô nhận
 *  theo MÃ LÔ máy ghi (`lot`) — khoá đoán cũ (phường · xe · % · số OD) tách lô hai phường làm đôi và gộp hai lô cùng phường cùng % làm một,
 *  "Xe mới" trên dòng lô thành hai xe / một xe quá tải; kế hoạch ghép trước 15/10 không có mã thì vẫn đoán. Lô sắp pallet giảm (gần đủ tải
 *  lên đầu). Test: `backend/tests/unit/dispatchIssues.test.ts`. */
export type PoolLot = { kind: 'under' | 'big'; vehicle: string; pct: number; bound: number }
export const POOL_OUT_OF_LOT = 'Ngoài lô'
const lotOf = (o: DispatchTripOd, um: DispatchUnderMin | undefined, tb: DispatchTooBig | undefined): { k: string; lot: PoolLot | null } =>
  um ? { k: `U|${um.lot ?? o.ward_code ?? ''}|${um.vehicle}|${um.pct}|${um.ods}`, lot: { kind: 'under', vehicle: um.vehicle, pct: um.pct, bound: um.min } }
    : tb ? { k: `B|${o.od_number}`, lot: { kind: 'big', vehicle: tb.vehicle, pct: tb.pct, bound: tb.max } }
    : { k: POOL_OUT_OF_LOT, lot: null }
const lotRank = (l: PoolLot | null) => (!l ? 2 : l.kind === 'big' ? 1 : 0)
export function poolLotGroups(pool: DispatchTripOd[], under: Record<string, DispatchUnderMin>, big: Record<string, DispatchTooBig>) {
  const by = new Map<string, { rows: DispatchTripOd[]; lot: PoolLot | null }>()
  for (const o of pool) {
    const { k, lot } = lotOf(o, under[o.od_number], big[o.od_number])
    const g = by.get(k) ?? { rows: [], lot }
    g.rows.push(o); by.set(k, g)
  }
  return [...by.entries()].map(([k, g]) => {
    const custs = [...new Set(g.rows.map(o => o.ship_to_name || o.ship_to_code || '—'))]
    const n = new Set(g.rows.map(o => o.od_number)).size
    const who = !g.lot ? POOL_OUT_OF_LOT : custs.length > 1 ? `${custs[0]} +${custs.length - 1} khách` : custs[0]
    return { k, label: n > 1 || !g.lot ? `${who} · ${n} OD` : who, rows: g.rows, lot: g.lot, pallets: g.rows.reduce((s, o) => s + Number(o.pallets ?? 0), 0) }
  }).sort((a, b) => lotRank(a.lot) - lotRank(b.lot) || b.pallets - a.pallets || a.k.localeCompare(b.k))
}
const pct1 = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
/** Lời của một lô (rê chuột ô Tải / % của dòng lô) — cùng câu ở hai dạng bàn */
export const lotTip = (l: PoolLot) => l.kind === 'under'
  ? `${l.vehicle}: ${pct1(l.pct)} % < tối thiểu ${l.bound} % — máy không tạo xe. "Xe mới" = cả lô vào MỘT xe (máy chọn dòng xe + ĐVVT, xe báo Non tải); hoặc kéo lô lên xe còn chỗ, tick rồi "Trả về Chờ điều", hay Tối ưu lại với "Bỏ qua dải %"`
  : `${l.vehicle}: ${pct1(l.pct)} % > trần ${l.bound} % và loại xe này không ghép nhiều xe trên một thẻ — nới trần dải, đổi dòng xe được vào, bật "Ghép nhiều xe" cho loại xe, hoặc tách DO bên SAP`
/** Tấm "Dòng xe được vào — ngoại lệ chỉ xe đó" (15/10): ô tick ban đầu = bản chụp của dòng (chưa chụp thì cấu hình khách) GIAO dòng xe
 *  CỦA KHO. Bản chụp / cấu hình có thể kể cả dòng xe kho khác (khai theo kênh) — tấm không hiện chúng; giữ trong danh sách gửi lên là server
 *  400 "không dùng ở kho này" dù người không đụng tới (bắt ở kiểm giao diện 15/10 trên nháp Ba Vì: 5 ô tick, bản chụp 6 dòng). */
export const rowVehiclesTicked = (current: string[] | null, config: string[], models: { id: string }[]): string[] => {
  const k = new Set(models.map(m => m.id))
  return (current ?? config).filter(id => k.has(id))
}

// ══ XE CÙNG TUYẾN (15/10, user: "khung chờ đánh dấu + lọc được đơn đang có route của nó đi mà chưa lên được xe — vd đơn dư của xe 17
// pallet, đơn tuyến Bắc Ninh mà xe đã quá tải; bên bàn có ký hiệu tiếp nhận"). Chốt: cùng tuyến = CÙNG VÙNG (tỉnh) · "nhận được" = ĐỦ luật
// ghép xe (server `fit-check`, cùng hàm cửa kéo thả) · bảng xe giữ mọi xe, gắn nhãn. 15/10 tối (user: "nhận diện cũng phải theo rule — xe
// pallet 1 khách thì đơn khách khác liên quan gì; phải đi theo config"): xe chỉ là "của đơn" khi CẤU HÌNH cho đơn lên xe (`routeOff`). ══
export type RouteLevel = 'customer' | 'ward' | 'region'
export const ROUTE_LEVEL_VI: Record<RouteLevel, string> = { customer: 'cùng khách', ward: 'cùng phường', region: 'cùng vùng' }
export interface RouteMatch { trip_id: string; seq: number; level: RouteLevel }
type RouteRow = Pick<DispatchTripOd, 'id' | 'ship_to_code' | 'ward_code' | 'region_code'>
type RouteTrip = Pick<DispatchTrip, 'id' | 'seq' | 'load_pct'> & { ods: Pick<DispatchTripOd, 'ship_to_code' | 'ward_code' | 'region_code'>[] }
/** Cấu hình luật ghép xe đọc khi nhận diện (15/10 tối): dòng xe ĐANG DÙNG của kho (điểm giao tối đa + điều kiện bảo quản chở được — giá trị
 *  hiệu lực tại kho, `useVehicleModels` theo kho) + tham số kế hoạch (trộn kênh · trộn Loại kho · Loại kho đi kèm đơn). */
export interface RouteRuleCtx {
  models: Map<string, { id: string; max_drops: number | null; storage_conditions: string[] }>
  mixChannels: boolean; mixCategories: boolean | null | undefined; follow: string[]
}
type RuleOd = Pick<DispatchTripOd, 'od_number' | 'ship_to_code' | 'separate' | 'channel' | 'allowed_models' | 'conditions' | 'cat_load' | 'max_customers'>
type RuleTrip = Pick<DispatchTrip, 'vehicle_model_id' | 'extra_vehicle_model_ids' | 'allow_mix_categories' | 'allow_extra_drops'> & { ods: RuleOd[] }
const mainCatKey = (load: RuleOd['cat_load'], follow: string[]) => [...new Set(Object.keys(load ?? {}).filter(c => !!c && !follow.includes(c)))].sort().join('+')
/** Đơn khung chờ `r` KHÔNG thuộc xe `t` THEO CẤU HÌNH, bỏ qua sức chứa — MIRROR các luật "cấu hình" của `manualRuleBlocks` qua `routeKind`
 *  (BE, 'off'; `backend/tests/mirror/dispatchRouteOff.mirror.test.ts`): xe / khách chỉ MỘT khách (dòng xe "Điểm giao tối đa" 1 — xe pallet,
 *  container — hoặc "Số khách tối đa cùng xe" 1 của khách / kênh) mà đơn là khách khác · đi xe riêng · trộn kênh khi kho không cho · trộn
 *  Loại kho khi switch xe tắt · dòng xe không chở được điều kiện bảo quản · khách không được vào dòng xe · đơn CHỈ hàng "đi kèm đơn" (PM01)
 *  lên xe không chở chính khách đó. Tải quá trần, hay đã đủ số khách
 *  khi cấu hình cho từ 2 khách, KHÔNG ở đây — đó là xe ĐẦY (server `fit-check` trả 'full'). */
export function routeOff(r: RuleOd, t: RuleTrip, c: RouteRuleCtx): boolean {
  const all = [...t.ods, r]
  const key = (o: RuleOd) => o.ship_to_code ?? o.od_number
  // đơn CHỈ hàng "đi kèm đơn" (PM01 / POSM, kế hoạch không trộn Loại kho): đi cùng xe với hàng chính CỦA CHÍNH KHÁCH (Cài đặt WMS → Loại kho
  // → "Đi kèm đơn khi điều vận") ⇒ chỉ xe đang chở khách đó (15/10 tối, user: "đơn PM01 rule là đi theo chính khách hàng mà sao lại thể hiện
  // là đơn ghép?")
  const posmOnly = c.mixCategories === false && Object.keys(r.cat_load ?? {}).length > 0 && !mainCatKey(r.cat_load, c.follow)
  if (posmOnly && !t.ods.some(o => key(o) === key(r))) return true
  const before = new Set(t.ods.map(key)).size, after = new Set(all.map(key)).size
  const main = t.vehicle_model_id ? c.models.get(t.vehicle_model_id) ?? null : null
  const fleet = main ? [...new Map([main, ...(t.extra_vehicle_model_ids ?? []).map(id => c.models.get(id))].filter((m): m is NonNullable<typeof m> => !!m).map(m => [m.id, m])).values()] : []
  if ((t.allow_mix_categories ?? c.mixCategories) === false && new Set(all.map(o => mainCatKey(o.cat_load, c.follow)).filter(Boolean)).size > 1) return true
  if (after > before) {
    const cap = Math.min(...all.map(o => (typeof o.max_customers === 'number' && o.max_customers >= 1 ? o.max_customers : 1)), main ? main.max_drops ?? 1 : Infinity)
    // xe bật "Cho vượt số khách" (16/10) ⇒ luật số khách không chặn xe này
    if (after > cap && cap < 2 && t.allow_extra_drops !== true) return true
    if (after > 1 && all.some(o => o.separate === true)) return true
  }
  if (!c.mixChannels) {
    const chs = (os: RuleOd[]) => new Set(os.map(o => o.channel).filter((x): x is string => !!x))
    const ca = chs(all)
    if (ca.size > 1 && ca.size > chs(t.ods).size) return true
  }
  const conds = [...new Set((r.conditions ?? []).filter(Boolean))]
  for (const m of fleet) {
    const sv = (m.storage_conditions ?? []).filter(Boolean)
    if (conds.length && sv.length && !conds.every(x => sv.includes(x))) return true
    if (Array.isArray(r.allowed_models) && r.allowed_models.length > 0 && !r.allowed_models.includes(m.id) && !posmOnly) return true
  }
  return false
}
/** Xe cùng tuyến của từng đơn khung chờ: xe có đơn cùng KHÁCH › cùng PHƯỜNG › cùng VÙNG (vùng của xe = vùng của MỌI đơn trên xe ⇒ xe tuyến
 *  liên tỉnh đi qua tỉnh đó cũng tính). Xe trống không tính (không có đơn để biết tuyến); `keep` = cặp (đơn, xe) được tính — bàn truyền
 *  "cấu hình cho đơn lên xe" (`routeOff`). Mỗi đơn: mức gần trước, rồi xe tải thấp (còn chỗ) trước, rồi số xe. Đơn không có xe nào cùng tuyến
 *  thì không có trong map. */
export function routeMatches<R extends RouteRow, T extends RouteTrip>(pool: R[], trips: T[], keep: (r: R, t: T) => boolean = () => true): Map<string, RouteMatch[]> {
  const byKey = (pick: (o: RouteTrip['ods'][number]) => string | null | undefined) => {
    const m = new Map<string, T[]>()
    for (const t of trips) for (const o of t.ods) {
      const v = pick(o)
      if (!v) continue
      const l = m.get(v) ?? []
      if (!l.includes(t)) l.push(t)
      m.set(v, l)
    }
    return m
  }
  const cust = byKey(o => o.ship_to_code), ward = byKey(o => o.ward_code), reg = byKey(o => o.region_code)
  const rank: Record<RouteLevel, number> = { customer: 0, ward: 1, region: 2 }
  const out = new Map<string, RouteMatch[]>()
  for (const r of pool) {
    const seen = new Map<string, RouteMatch & { load: number }>(), no = new Set<string>()
    const add = (l: T[] | undefined, level: RouteLevel) => {
      for (const t of l ?? []) {
        if (seen.has(t.id) || no.has(t.id)) continue
        if (keep(r, t)) seen.set(t.id, { trip_id: t.id, seq: t.seq, level, load: t.load_pct == null ? 1e9 : Number(t.load_pct) })
        else no.add(t.id)
      }
    }
    if (r.ship_to_code) add(cust.get(r.ship_to_code), 'customer')
    if (r.ward_code) add(ward.get(r.ward_code), 'ward')
    if (r.region_code) add(reg.get(r.region_code), 'region')
    if (seen.size) out.set(r.id, [...seen.values()].sort((a, b) => rank[a.level] - rank[b.level] || a.load - b.load || a.seq - b.seq)
      .map(m => ({ trip_id: m.trip_id, seq: m.seq, level: m.level })))
  }
  return out
}
/** Cặp (đơn, xe) gửi server hỏi luật ghép xe — tối đa `perRow` xe mỗi đơn (mức gần + còn chỗ trước), cả lượt ≤ `max` (trần của cửa). */
export function fitPairs(matches: Map<string, RouteMatch[]>, rowIds: string[], perRow = 40, max = 5000): { row_id: string; trip_id: string }[] {
  const out: { row_id: string; trip_id: string }[] = []
  for (const id of rowIds) for (const m of (matches.get(id) ?? []).slice(0, perRow)) { if (out.length >= max) return out; out.push({ row_id: id, trip_id: m.trip_id }) }
  return out
}
export type FitResult = DispatchFitResult
/** Đơn khung chờ: xe cùng tuyến + kết quả hỏi luật. `fit` = có xe NHẬN được (true) · mọi xe đã hỏi đều ĐẦY (false) · chưa hỏi (null). */
export interface PoolRoute { matches: RouteMatch[]; fit: boolean | null; results: Map<string, FitResult> }
/** Xe trên bàn khi đang lọc: các đơn (đang lọc) xe NHẬN được; không nhận đơn nào thì `full` = lý do đầu tiên. */
export interface TripRouteTag { fit: string[]; full: string | null }
/** Kết quả server `kind` 'off' (cấu hình không cho — trình duyệt đã lọc bằng `routeOff`, đây là lưới khi hai bên lệch / xe vừa đổi trạng
 *  thái) ⇒ bỏ xe đó khỏi ký hiệu; đơn không còn xe nào thì không còn là "có xe cùng tuyến". */
export function routeTags(matches: Map<string, RouteMatch[]>, results: FitResult[] | undefined, shownRowIds: string[]): { rows: Map<string, PoolRoute>; trips: Map<string, TripRouteTag> } {
  const byRow = new Map<string, Map<string, FitResult>>()
  for (const r of results ?? []) { if (r.kind === 'off') continue; const m = byRow.get(r.row_id) ?? new Map<string, FitResult>(); m.set(r.trip_id, r); byRow.set(r.row_id, m) }
  const off = new Set((results ?? []).filter(r => r.kind === 'off').map(r => `${r.row_id}|${r.trip_id}`))
  const rows = new Map<string, PoolRoute>()
  for (const [id, all] of matches) {
    const ms = off.size ? all.filter(m => !off.has(`${id}|${m.trip_id}`)) : all
    if (!ms.length) continue
    const res = byRow.get(id) ?? new Map<string, FitResult>()
    const asked = [...res.values()]
    rows.set(id, { matches: ms, results: res, fit: !results || !asked.length ? null : asked.some(x => x.fits) })
  }
  const trips = new Map<string, TripRouteTag>()
  for (const id of shownRowIds) for (const r of byRow.get(id)?.values() ?? []) {
    const t = trips.get(r.trip_id) ?? { fit: [], full: null }
    if (r.fits) t.fit.push(id)
    else t.full = t.full ?? r.reason
    trips.set(r.trip_id, t)
  }
  for (const t of trips.values()) if (t.fit.length) t.full = null
  return { rows, trips }
}
/** Hộp hỏi trước khi KHOÁ xe (15/10 tối, user: "khoá xe để lần sau tối ưu — phải confirm trước khi khoá") — bàn ghép xe và panel xe cùng câu */
export const lockAsk = (t: Pick<DispatchTrip, 'seq' | 'pallets' | 'ods' | 'detail'>) => ({
  title: `Khoá xe #${t.seq}?`, confirmLabel: 'Khoá xe',
  body: `${t.detail.vehicle_model?.name ?? 'Chưa chọn dòng xe'} · ${new Set(t.ods.map(o => o.od_number)).size} OD · ${Number(t.pallets ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} pallet.\nLần "Tối ưu lại" sau, máy GIỮ NGUYÊN xe này — đơn trên xe, dòng xe, ĐVVT. Kéo thả, đổi dòng xe / ĐVVT bằng tay vẫn làm được.\nXe khoá tô màu tím trên bàn; mở khoá: bấm lại ổ khoá.`,
})
export const FLAG_VI: Record<DispatchOdFlag['kind'], string> = {
  // 03/10 tối: SHIPPED / SAP_ASSIGNED là cờ THAM CHIẾU (không loại đơn, không chặn Xác nhận) — chữ phải nói "SAP nói vậy", không khẳng định hàng đã đi
  // 25/10 (user): SHIPPED ghi "Posted", tooltip giải thích là post trong SAP (info từ BE)
  REPLACED: 'SAP đã thay', GONE: 'SAP đã bỏ', SHIPPED: 'Posted', SAP_ASSIGNED: 'SAP đã gắn xe', IN_PLAN: 'Đã vào KH xuất', CHANGED: 'SAP đã sửa',
  KIN_SHIPPED: 'Họ hàng đã đi',   // 03/10: OD cùng dòng SO với OD đã đi — cờ CỨNG, người bấm "Xác nhận đơn bổ sung" ở tab Xem đơn mới đi được
  WH_SCANNED: 'Kho đã quét',      // 17/10: hàng đã quét bên Xuất trên chuyến của xe đã rút — về đúng xe cũ hoặc kho trả hàng
}
