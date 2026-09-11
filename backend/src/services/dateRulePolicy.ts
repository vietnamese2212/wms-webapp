/**
 * %DATE THEO KHÁCH HÀNG / KÊNH — ĐƯỜNG DUY NHẤT máy tự đặt `OutboundItem.date_rule`.
 * (user chốt 11/09/2026; plan: docs/plans/CUSTOMER_DATE_RULE_PLAN.md)
 *
 * Vì sao tập trung một chỗ: dòng hàng được sinh ở BỐN đường (upload Kế hoạch xuất/VL06O qua
 * `processVehicleGroups`, merge chuyến tạm dừng, tạo đơn tay, thêm dòng tay) — mỗi đường một bản
 * luật là đúng khuôn lỗi "4 bản chép tay" của luật luân chuyển hồi 14/08. Ratchet
 * `date_rule_written_outside_policy` (cổng tĩnh 09) gác: ghi `date_rule` ngoài file này và
 * `setItemsDateRule` là đỏ.
 *
 * ─── THANG ƯU TIÊN (dừng ở bậc đầu tiên có kết quả) ───────────────────────────────────────────
 *   1. Dòng ĐÃ CHỐT TAY (date_rule.source = MANUAL / thiếu khoá) → GIỮ NGUYÊN, không bao giờ đè.
 *   2. Dòng có %Date yêu cầu của VL06O (date_required > 0) → đã có người quyết, không đụng.
 *   3. Kho policy = OFF → để trống.
 *   4. Dòng CÓ ghi chú CS và kho policy = NO_NOTE → để trống (ghi chú là chỗ NGƯỜI đọc — luật
 *      10/09 "máy KHÔNG đọc ghi chú CS"; đo 11/09: ghi chú chỉ 1,8 % dòng ≈ 18 dòng/ngày).
 *   5. %Date riêng của KHÁCH → áp, source = CUSTOMER.
 *   6. %Date mặc định của KÊNH khách → áp, source = CHANNEL.
 *   7. Còn lại → ĐỂ TRỐNG, KHÔNG ĐOÁN. Gồm: chuyến không có ship-to · **ship-to CHƯA CÓ trong danh
 *      mục Khách hàng** · khách có trong danh mục nhưng CHƯA PHÂN KÊNH và không có %Date riêng.
 *      (user hỏi thẳng 11/09: "khách hàng nào trong Xuất chưa có trong danh sách khách hàng thì
 *       không cấp %date tự động" — đúng, và `ensureCustomers` tạo khách lạ với kênh TRỐNG nên
 *       khách vừa tự sinh cũng rơi vào bậc này.)
 *
 * ─── KHÔNG LAN NGƯỢC ──────────────────────────────────────────────────────────────────────────
 * Sửa %Date của kênh/khách chỉ có hiệu lực cho dòng SINH SAU ĐÓ. Đơn đang mở chỉ đổi khi có người
 * bấm "Áp lại theo master" (`applyDateRuleMaster`) — tránh cảnh sửa một ô cấu hình làm nghìn dòng
 * đổi mà không ai biết. Vì thế `resolveDateRule` mặc định GIỮ mọi quy tắc đang có; chỉ đường
 * "Áp lại" mới truyền `overwriteAuto: true` (và kể cả lúc đó, MANUAL vẫn bất khả xâm phạm).
 */
import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase'
import { fetchAllByIdChunks } from '../utils/pagination'
import { checkDateRuleStock, type DateRule } from './directedTasks'

const now = () => new Date().toISOString()

export type DateRuleSource = 'MANUAL' | 'CUSTOMER' | 'CHANNEL'
export type DateRulePolicy = 'OFF' | 'ALL' | 'NO_NOTE'
const POLICIES: readonly DateRulePolicy[] = ['OFF', 'ALL', 'NO_NOTE']

export const asDateRulePolicy = (v: unknown): DateRulePolicy => {
  const s = String(v ?? '').toUpperCase().trim()
  return (POLICIES as readonly string[]).includes(s) ? (s as DateRulePolicy) : 'OFF'
}

/** Mã ship-to chuẩn hoá — cùng dạng với CHECK `^[A-Z0-9]+$` của bảng Customer. */
export const normShipto = (v: unknown): string | null => {
  const s = String(v ?? '').toUpperCase().trim()
  return s && /^[A-Z0-9]+$/.test(s) && s.length <= 50 ? s : null
}

/** Quy tắc master (khách hoặc kênh) — chỉ FEFO | MIN_PCT, khớp CHECK ở DB. */
export function parseMasterRule(raw: unknown): { rule: DateRule | null } | { err: string } {
  if (raw == null) return { rule: null }
  if (typeof raw !== 'object') return { err: 'Quy tắc %Date không hợp lệ' }
  const r = raw as { kind?: unknown; value?: unknown }
  const kind = String(r.kind ?? '').toUpperCase().trim()
  if (kind === 'FEFO') return { rule: { kind: 'FEFO' } }
  if (kind === 'MIN_PCT') {
    const v = Number(r.value)
    if (!Number.isFinite(v) || v <= 0 || v > 100)
      return { err: 'Mức %Date phải là số trong khoảng 1–100' }
    return { rule: { kind: 'MIN_PCT', value: v } }
  }
  return { err: 'Quy tắc master chỉ nhận FEFO hoặc ≥ n % — "đúng NSX/lô" và "chia phần theo số lượng" là quyết định của TỪNG DÒNG ĐƠN' }
}

export interface CustomerRule { channel: string | null; date_rule: DateRule | null; warehouse_id: string | null }

export interface PolicyCtx {
  policyByWh:   Map<string, DateRulePolicy>
  customerByShipto: Map<string, CustomerRule>
  channelRule:  Map<string, DateRule | null>
}

export const EMPTY_POLICY_CTX: PolicyCtx = {
  policyByWh: new Map(), customerByShipto: new Map(), channelRule: new Map(),
}

/**
 * Nạp mọi thứ cần cho thang ưu tiên trong 3 truy vấn (KHÔNG hỏi từng dòng — file 1.000 dòng mà
 * hỏi per-dòng là 1.000 lượt trên pool 10 khe của PostgREST).
 */
export async function loadPolicyCtx(whIds: (string | null | undefined)[], shiptos: (string | null | undefined)[]): Promise<PolicyCtx> {
  const whs = [...new Set(whIds.filter((x): x is string => !!x))]
  const sts = [...new Set(shiptos.map(normShipto).filter((x): x is string => !!x))]

  const [whRows, custRows, chRows] = await Promise.all([
    whs.length
      ? fetchAllByIdChunks(whs, chunk => supabase.from('Warehouse')
          .select('id, date_rule_policy').in('id', chunk).order('id')) as Promise<{ id: string; date_rule_policy: string | null }[]>
      : Promise.resolve([] as { id: string; date_rule_policy: string | null }[]),
    sts.length
      ? fetchAllByIdChunks(sts, chunk => supabase.from('Customer')
          .select('ship_to_code, channel, date_rule, warehouse_id, is_active')
          .in('ship_to_code', chunk).order('ship_to_code')) as Promise<{ ship_to_code: string; channel: string | null; date_rule: unknown; warehouse_id: string | null; is_active: boolean }[]>
      : Promise.resolve([] as { ship_to_code: string; channel: string | null; date_rule: unknown; warehouse_id: string | null; is_active: boolean }[]),
    supabase.from('LookupValue').select('value, meta').eq('type', 'customer_channel'),
  ])

  const policyByWh = new Map<string, DateRulePolicy>()
  for (const w of whRows) policyByWh.set(w.id, asDateRulePolicy(w.date_rule_policy))

  const customerByShipto = new Map<string, CustomerRule>()
  for (const c of custRows) {
    // Khách NGỪNG HOẠT ĐỘNG vẫn nằm trong map (để biết "đã có trong danh mục") nhưng không mang
    // quy tắc — ngừng khách là ngừng luật của khách đó, không phải xoá khách khỏi lịch sử.
    const parsed = c.is_active === false ? { rule: null } : parseMasterRule(c.date_rule)
    customerByShipto.set(c.ship_to_code, {
      channel: c.is_active === false ? null : (c.channel ?? null),
      date_rule: 'rule' in parsed ? parsed.rule : null,
      warehouse_id: c.warehouse_id ?? null,
    })
  }

  const channelRule = new Map<string, DateRule | null>()
  for (const ch of ((chRows.data ?? []) as { value: string; meta: { date_rule?: unknown } | null }[])) {
    const parsed = parseMasterRule(ch.meta?.date_rule ?? null)
    channelRule.set(String(ch.value), 'rule' in parsed ? parsed.rule : null)
  }

  return { policyByWh, customerByShipto, channelRule }
}

export interface ResolveInput {
  warehouseId:  string | null | undefined
  shipto:       string | null | undefined
  headerText:   string | null | undefined
  dateRequired: number | null | undefined
  existing:     unknown              // date_rule đang có trên dòng (jsonb thô)
  actor:        string | null
  overwriteAuto?: boolean            // true = đường "Áp lại theo master" (đè quy tắc máy đã áp)
}
export interface ResolveResult {
  rule: DateRule | null              // quy tắc SẼ ghi (null = để trống)
  source: DateRuleSource | null
  changed: boolean                   // có khác quy tắc đang có không
  keptManual: boolean                // giữ nguyên vì là chốt tay
}

const sourceOf = (existing: unknown): DateRuleSource =>
  (((existing as { source?: string } | null)?.source ?? 'MANUAL').toUpperCase() as DateRuleSource)

const sameRule = (a: unknown, b: unknown): boolean => {
  const pick = (x: unknown) => {
    if (x == null) return null
    const r = x as { kind?: unknown; value?: unknown }
    return { kind: String(r.kind ?? ''), value: r.value ?? null }
  }
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b))
}

/** THANG ƯU TIÊN — xem khối chú thích đầu file. Hàm THUẦN, không chạm DB. */
export function resolveDateRule(ctx: PolicyCtx, inp: ResolveInput): ResolveResult {
  const keep = (kept: boolean): ResolveResult =>
    ({ rule: (inp.existing as DateRule | null) ?? null, source: inp.existing ? sourceOf(inp.existing) : null, changed: false, keptManual: kept })

  // 1. Chốt tay là bất khả xâm phạm — kể cả policy = ALL, kể cả "Áp lại theo master".
  if (inp.existing != null) {
    const src = sourceOf(inp.existing)
    if (src === 'MANUAL') return keep(true)
    if (!inp.overwriteAuto) return keep(false)   // không lan ngược: upload lại KHÔNG đổi quy tắc máy đã áp
  }
  // 2. %Date kế thừa từ VL06O = đã có người quyết mức
  if (Number(inp.dateRequired ?? 0) > 0) return keep(false)

  const policy = ctx.policyByWh.get(String(inp.warehouseId ?? '')) ?? 'OFF'
  // 3–4. Chính sách của kho xuất
  if (policy === 'OFF') return { rule: null, source: null, changed: inp.existing != null, keptManual: false }
  if (policy === 'NO_NOTE' && String(inp.headerText ?? '').trim() !== '')
    return { rule: null, source: null, changed: inp.existing != null, keptManual: false }

  // 5–7. Khách → kênh → không đoán
  const code = normShipto(inp.shipto)
  const cust = code ? ctx.customerByShipto.get(code) : undefined
  let rule: DateRule | null = null
  let source: DateRuleSource | null = null
  if (cust?.date_rule) { rule = cust.date_rule; source = 'CUSTOMER' }
  else if (cust?.channel) {
    const chr = ctx.channelRule.get(cust.channel) ?? null
    if (chr) { rule = chr; source = 'CHANNEL' }
  }
  if (!rule) return { rule: null, source: null, changed: inp.existing != null, keptManual: false }

  return {
    rule: { ...rule, source, set_by: inp.actor ?? 'HỆ THỐNG', set_at: now() } as DateRule,
    source,
    changed: !sameRule(inp.existing, rule) || sourceOf(inp.existing) !== source,
    keptManual: false,
  }
}

/** Nhãn nguồn để hiện cạnh badge %Date — MỘT chỗ, dùng chung cả 3 màn qua API. */
export function dateRuleSourceLabel(rule: unknown): string | null {
  if (rule == null) return null
  const src = sourceOf(rule)
  return src === 'CUSTOMER' ? 'theo khách' : src === 'CHANNEL' ? 'theo kênh' : 'chốt tay'
}

// ─── KHÁCH HÀNG TỰ SINH KHI GẶP SHIP-TO LẠ ─────────────────────────────────────────────────────
// Danh mục phải TỰ NUÔI, không ai đi nhớ khai. Khách sinh ở đây LUÔN có kênh TRỐNG ⇒ rơi vào bậc 7
// của thang ⇒ **KHÔNG được cấp %Date tự động** cho tới khi có người phân kênh. Trang Chốt %Date
// hiện ô "Khách chưa kênh: n" để việc đó không chìm.
export async function ensureCustomers(rows: { ship_to_code: string; name?: string | null }[], actor: string | null): Promise<number> {
  const seen = new Map<string, string>()
  for (const r of rows) {
    const code = normShipto(r.ship_to_code)
    if (!code || seen.has(code)) continue
    seen.set(code, String(r.name ?? '').trim().slice(0, 200) || code)
  }
  if (!seen.size) return 0
  const t = now()
  const payload = [...seen].map(([ship_to_code, name]) => ({
    id: randomUUID(), ship_to_code, name,
    auto_created: true, is_active: true,
    created_by: actor, updated_by: actor, created_at: t, updated_at: t,
  }))
  let n = 0
  for (let i = 0; i < payload.length; i += 500) {
    // ignoreDuplicates: khách đã có thì GIỮ NGUYÊN (tên/kênh/quy tắc do người khai luôn thắng dữ liệu file)
    const { data, error } = await supabase.from('Customer')
      .upsert(payload.slice(i, i + 500), { onConflict: 'ship_to_code', ignoreDuplicates: true })
      .select('id')
    if (error) { console.error('[dateRulePolicy] ensureCustomers:', error.message); break }
    n += (data ?? []).length
  }
  return n
}

// ─── CỜ "CẦN XEM": máy áp mức mà kho KHÔNG còn pallet nào đạt ───────────────────────────────────
// KHÔNG chặn upload (đó là chuyện tồn kho, không phải lỗi file) nhưng phải NÓI RA, nếu không chuyến
// vào ca sẽ sinh 0 việc mà không ai biết vì sao — đúng lỗi đã bắt trong diễn tập 10/09.
// Luật khớp date KHÔNG chép lại: gọi chính `checkDateRuleStock` mà màn chốt và bộ sinh việc dùng.
export interface AutoApplied { id: string; warehouse_id: string | null; material_id: string | null; rule: DateRule }
const MAX_FLAG_LINES = 5_000

export async function flagNoStock(items: AutoApplied[]): Promise<number> {
  try {
    // "Còn pallet nào đạt không" chỉ phụ thuộc (kho, mã, quy tắc) — KHÔNG phụ thuộc số lượng dòng.
    // Gom về ĐẠI DIỆN rồi hỏi một lần cho cả nhóm: 800 dòng của một ngày thường chỉ còn vài chục nhóm.
    const groups = new Map<string, AutoApplied[]>()
    for (const it of items.slice(0, MAX_FLAG_LINES)) {
      if (!it.material_id || it.rule.kind === 'FEFO') continue   // FEFO không đòi mốc date nào
      const k = `${it.warehouse_id ?? ''}::${it.material_id}::${JSON.stringify({ kind: it.rule.kind, value: it.rule.value ?? null })}`
      groups.set(k, [...(groups.get(k) ?? []), it])
    }
    if (!groups.size) return 0

    const reps = [...groups.values()].map(g => ({ item_id: g[0].id, rule: g[0].rule }))
    const badIds: string[] = []
    for (let i = 0; i < reps.length; i += 500) {
      const stock = await checkDateRuleStock(reps.slice(i, i + 500))
      const badReps = new Set(stock.filter(s => !s.ok).map(s => s.item_id))
      for (const g of groups.values()) if (badReps.has(g[0].id)) badIds.push(...g.map(x => x.id))
    }
    if (!badIds.length) return 0

    const t = now()
    for (let i = 0; i < badIds.length; i += 300) {
      const chunk = badIds.slice(i, i + 300)
      // Đọc rồi ghi lại cả object: PostgREST không có toán tử `||` cho jsonb trong UPDATE.
      const { data } = await supabase.from('OutboundItem').select('id, date_rule').in('id', chunk)
      for (const r of ((data ?? []) as { id: string; date_rule: Record<string, unknown> | null }[])) {
        if (!r.date_rule) continue
        await supabase.from('OutboundItem')
          .update({ date_rule: { ...r.date_rule, review: 'NO_STOCK' }, updated_at: t })
          .eq('id', r.id)
      }
    }
    return badIds.length
  } catch (e) {
    // Gắn cờ hỏng KHÔNG được làm hỏng upload — đây là lớp NHẮC, không phải lớp chặn.
    console.error('[dateRulePolicy] flagNoStock:', String(e))
    return 0
  }
}
