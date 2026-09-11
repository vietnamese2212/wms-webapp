/**
 * QUY ĐỊNH DATE THEO KHÁCH HÀNG / KÊNH — ĐƯỜNG DUY NHẤT máy tự đặt `OutboundItem.date_rule`.
 * (user chốt 11/09/2026; plan: docs/plans/DATE_RULE_MASTER_V2_PLAN.md — đợt 2)
 *
 * Vì sao tập trung một chỗ: dòng hàng được sinh ở BỐN đường (upload Kế hoạch xuất/VL06O qua
 * `processVehicleGroups`, merge chuyến tạm dừng, tạo đơn tay, thêm dòng tay) — mỗi đường một bản
 * luật là đúng khuôn lỗi "4 bản chép tay" của luật luân chuyển hồi 14/08. Ratchet
 * `date_rule_hand_rolled` (cổng tĩnh 09) gác: dựng quy tắc ngoài file này là đỏ.
 *
 * ─── MỨC THUỘC VỀ CẶP (KHÁCH × LOẠI HÀNG) ─────────────────────────────────────────────────────
 * Đợt 1 cho mỗi khách MỘT mức. Đo lại 11/09: FG01 hạn dùng 120–720 ngày còn FG02 chỉ 45–60 ngày,
 * nên "còn ≥ 35 ngày" ra 77,8 % trên mã hạn 45 và 58,3 % trên mã hạn 60 — KHÔNG con số phần trăm
 * nào phục vụ được cả nhóm, và mức chung ≥ 60 % chỉ đòi 27 ngày trên mã hạn 45 (thiếu 8 ngày mà
 * không ai thấy gì sai). Mức lại khác nhau theo TỪNG KHÁCH (FG01: 60·70·80·85 %; FG02: 35·40 ngày)
 * ⇒ một cột trên `Customer` không chứa nổi. Nay nằm ở bảng `date_rule_master`, dùng chung cho cả
 * khách lẫn kênh vì hai thứ đó mang CÙNG một hình dạng sự thật.
 *
 * ─── THANG ƯU TIÊN (dừng ở bậc đầu tiên có kết quả) ───────────────────────────────────────────
 *   1. Dòng ĐÃ CHỐT TAY (date_rule.source = MANUAL / thiếu khoá) → GIỮ NGUYÊN, không bao giờ đè.
 *   2. Dòng có %Date yêu cầu của VL06O (date_required > 0) → đã có người quyết, không đụng.
 *   3. Mã KHÔNG ĐO ĐƯỢC DATE → tự đặt "không đòi mốc", nguồn SYSTEM, kèm lý do NO_SHELF_LIFE.
 *   4. Kho policy = OFF → để trống.
 *   5. Dòng CÓ ghi chú CS và kho policy = NO_NOTE → để trống (ghi chú là chỗ NGƯỜI đọc — luật
 *      10/09 "máy KHÔNG đọc ghi chú CS"; đo 11/09: ghi chú chỉ 1,8 % dòng ≈ 18 dòng/ngày).
 *   6. Mức của KHÁCH cho ĐÚNG loại hàng của mã   → source = CUSTOMER.
 *   7. Mức của KHÁCH cho "mọi loại hàng còn lại" → source = CUSTOMER.
 *   8. Mức của KÊNH cho ĐÚNG loại hàng           → source = CHANNEL.
 *   9. Mức của KÊNH cho "mọi loại hàng còn lại"  → source = CHANNEL.
 *  10. Còn lại → ĐỂ TRỐNG, KHÔNG ĐOÁN. Gồm: chuyến không có ship-to · ship-to CHƯA CÓ trong danh
 *      mục Khách hàng · khách có trong danh mục nhưng CHƯA KHAI mức nào và kênh cũng chưa khai.
 *      (`ensureCustomers` tạo khách lạ với kênh TRỐNG nên khách vừa tự sinh cũng rơi vào bậc này.)
 *
 * ─── VÌ SAO BẬC 3 ĐỨNG TRƯỚC CHÍNH SÁCH KHO ───────────────────────────────────────────────────
 * "Đo được date không" là tính chất của MÃ HÀNG, không phải của kho — không có chính sách nào
 * quyết định thay được. Và quan trọng hơn: dòng để TRỐNG thì `planGdoTasks` KHÔNG sinh việc nào,
 * nên hàng POSM sẽ biến mất khỏi bảng "Việc cần làm" — trong khi user chốt 11/09 là nó vẫn phải
 * được chỉ đường (không có date để so thì tối ưu QUÃNG ĐƯỜNG). Đặt "không đòi mốc" thì mọi pallet
 * đều đạt, việc vẫn sinh, và thứ tự rơi thẳng xuống khoảng cách BFS trên Sơ đồ kho.
 *
 * ─── KHÔNG LAN NGƯỢC ──────────────────────────────────────────────────────────────────────────
 * Sửa mức của kênh/khách chỉ có hiệu lực cho dòng SINH SAU ĐÓ. Đơn đang mở chỉ đổi khi có người
 * bấm "Áp lại theo master" (`applyDateRuleMaster`) — tránh cảnh sửa một ô cấu hình làm nghìn dòng
 * đổi mà không ai biết. Vì thế `resolveDateRule` mặc định GIỮ mọi quy tắc đang có; chỉ đường
 * "Áp lại" mới truyền `overwriteAuto: true` (và kể cả lúc đó, MANUAL vẫn bất khả xâm phạm).
 */
import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase'
import { fetchAllByIdChunks } from '../utils/pagination'
import { effShelfLife } from '../utils/shelfLife'
import { getLabelFormat } from '../controllers/wms/systemSettingController'
import { checkDateRuleStock, type DateRule } from './directedTasks'

const now = () => new Date().toISOString()

export type DateRuleSource = 'MANUAL' | 'CUSTOMER' | 'CHANNEL' | 'SYSTEM'
export type DateRulePolicy = 'OFF' | 'ALL' | 'NO_NOTE'
export type MasterScope = 'CUSTOMER' | 'CHANNEL'
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

/** Mã loại hàng chuẩn hoá — khớp CHECK `^[A-Z0-9_]+$` của `date_rule_master.category`. */
export const normCategory = (v: unknown): string | null => {
  const s = String(v ?? '').toUpperCase().trim()
  return s && /^[A-Z0-9_]+$/.test(s) && s.length <= 30 ? s : null
}

export const MAX_MIN_DAYS = 3650   // 10 năm — quá mốc này là gõ nhầm, không phải yêu cầu thật

/**
 * Quy tắc master (khách hoặc kênh) — chỉ FEFO | MIN_PCT | MIN_DAYS, khớp CHECK ở DB.
 * EXACT / SPLIT cố ý KHÔNG nhận: "đúng NSX/lô này" và "chia phần theo số lượng" là quyết định của
 * TỪNG DÒNG ĐƠN, đưa lên danh mục là áp một cái lô cụ thể cho mọi đơn tương lai.
 */
export function parseMasterRule(raw: unknown): { rule: DateRule | null } | { err: string } {
  if (raw == null) return { rule: null }
  if (typeof raw !== 'object') return { err: 'Quy định date không hợp lệ' }
  const r = raw as { kind?: unknown; value?: unknown }
  const kind = String(r.kind ?? '').toUpperCase().trim()
  if (kind === 'FEFO') return { rule: { kind: 'FEFO' } }
  if (kind === 'MIN_PCT') {
    const v = Number(r.value)
    if (!Number.isFinite(v) || v <= 0 || v > 100)
      return { err: 'Mức % hạn dùng phải là số trong khoảng 1–100' }
    return { rule: { kind: 'MIN_PCT', value: v } }
  }
  if (kind === 'MIN_DAYS') {
    const v = Number(r.value)
    if (!Number.isInteger(v) || v < 1 || v > MAX_MIN_DAYS)
      return { err: `Số ngày còn lại phải là số nguyên trong khoảng 1–${MAX_MIN_DAYS}` }
    return { rule: { kind: 'MIN_DAYS', value: v } }
  }
  return { err: 'Quy định date chỉ nhận: không đòi mốc · ≥ % hạn dùng · ≥ số ngày còn lại — "đúng NSX/lô" và "chia phần theo số lượng" là quyết định của TỪNG DÒNG ĐƠN' }
}

export interface CustomerRule { id: string; channel: string | null; warehouse_id: string | null }

export interface PolicyCtx {
  policyByWh:       Map<string, DateRulePolicy>
  customerByShipto: Map<string, CustomerRule>
  /** khoá `${scope}::${scope_key}::${category ?? ''}` → quy tắc */
  masterRules:      Map<string, DateRule>
  /** Tem mang HSD tường minh (V2 `;`) thì đo được date kể cả khi mã chưa khai hạn dùng. */
  explicitExpiry:   boolean
}

export const EMPTY_POLICY_CTX: PolicyCtx = {
  policyByWh: new Map(), customerByShipto: new Map(), masterRules: new Map(), explicitExpiry: false,
}

export const masterKey = (scope: MasterScope, scopeKey: string, category: string | null): string =>
  `${scope}::${scopeKey}::${category ?? ''}`

/**
 * Nạp mọi thứ cần cho thang ưu tiên trong 4 truy vấn (KHÔNG hỏi từng dòng — file 1.000 dòng mà
 * hỏi per-dòng là 1.000 lượt trên pool 10 khe của PostgREST).
 */
export async function loadPolicyCtx(
  whIds: (string | null | undefined)[],
  shiptos: (string | null | undefined)[],
): Promise<PolicyCtx> {
  const whs = [...new Set(whIds.filter((x): x is string => !!x))]
  const sts = [...new Set(shiptos.map(normShipto).filter((x): x is string => !!x))]

  const [whRows, custRows, labelFormat] = await Promise.all([
    whs.length
      ? fetchAllByIdChunks(whs, chunk => supabase.from('Warehouse')
          .select('id, date_rule_policy').in('id', chunk).order('id')) as Promise<{ id: string; date_rule_policy: string | null }[]>
      : Promise.resolve([] as { id: string; date_rule_policy: string | null }[]),
    sts.length
      ? fetchAllByIdChunks(sts, chunk => supabase.from('Customer')
          .select('id, ship_to_code, channel, warehouse_id, is_active')
          .in('ship_to_code', chunk).order('ship_to_code')) as Promise<{ id: string; ship_to_code: string; channel: string | null; warehouse_id: string | null; is_active: boolean }[]>
      : Promise.resolve([] as { id: string; ship_to_code: string; channel: string | null; warehouse_id: string | null; is_active: boolean }[]),
    getLabelFormat().catch(() => 'underscore' as const),
  ])

  const policyByWh = new Map<string, DateRulePolicy>()
  for (const w of whRows) policyByWh.set(w.id, asDateRulePolicy(w.date_rule_policy))

  const customerByShipto = new Map<string, CustomerRule>()
  for (const c of custRows) {
    // Khách NGỪNG HOẠT ĐỘNG vẫn nằm trong map (để biết "đã có trong danh mục") nhưng không mang
    // quy tắc — ngừng khách là ngừng luật của khách đó, không phải xoá khách khỏi lịch sử.
    customerByShipto.set(c.ship_to_code, {
      id: c.is_active === false ? '' : c.id,
      channel: c.is_active === false ? null : (c.channel ?? null),
      warehouse_id: c.warehouse_id ?? null,
    })
  }

  // Mức: chỉ nạp những scope_key thật sự có mặt (id khách + mã kênh của chính các khách đó).
  // `scope_key` dùng chung một cột cho hai scope nên một câu `.in()` là đủ, lọc scope ở JS.
  const keys = [...new Set([
    ...[...customerByShipto.values()].map(c => c.id).filter(Boolean),
    ...[...customerByShipto.values()].map(c => c.channel).filter((x): x is string => !!x),
  ])]
  const masterRules = new Map<string, DateRule>()
  if (keys.length) {
    const rows = await fetchAllByIdChunks(keys, chunk => supabase.from('date_rule_master')
      .select('scope, scope_key, category, rule').in('scope_key', chunk).order('id')) as unknown as
      { scope: string; scope_key: string; category: string | null; rule: unknown }[]
    for (const r of rows) {
      const parsed = parseMasterRule(r.rule)
      if ('err' in parsed || !parsed.rule) continue
      masterRules.set(masterKey(r.scope as MasterScope, r.scope_key, r.category ?? null), parsed.rule)
    }
  }

  return { policyByWh, customerByShipto, masterRules, explicitExpiry: labelFormat === 'semicolon' }
}

export interface ResolveInput {
  warehouseId:  string | null | undefined
  shipto:       string | null | undefined
  headerText:   string | null | undefined
  dateRequired: number | null | undefined
  existing:     unknown              // date_rule đang có trên dòng (jsonb thô)
  actor:        string | null
  /** Loại hàng của mã (Material.category) — trục thứ hai của mức. */
  category?:    string | null
  /** Hạn dùng khai ở danh mục mã (ngày). 0/null + tem không mang HSD ⇒ KHÔNG đo được date. */
  shelfLifeDays?: number | null
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

/**
 * Mã này có ĐO ĐƯỢC date không — đọc từ DỮ LIỆU (danh mục mã + cờ định dạng tem), KHÔNG phải
 * danh sách mã loại cứng trong code. Đo 11/09: 888/888 mã PM01 không khai hạn dùng, và 75 dòng
 * FG01 cũng vậy — kiểm theo "loại hàng là POSM" sẽ bỏ lọt đúng 75 dòng đó.
 *
 * Vế `explicitExpiry`: tem V2 (`;`) mang HSD TƯỜNG MINH nên "còn ≥ N ngày" tính được kể cả khi mã
 * chưa khai hạn dùng — chính phép kiểm mirror `shelfLife` bắt ra ca này (BE.computeDaysLeft ra số
 * trong khi BE.computePctDate trả null). Thiếu vế đó là cắt oan cả một đơn vị.
 */
export function dateMeasurable(ctx: PolicyCtx, shelfLifeDays: number | null | undefined): boolean {
  if (ctx.explicitExpiry) return true
  return effShelfLife({ shelf_life_days: shelfLifeDays ?? null }, null) > 0
}

/** THANG ƯU TIÊN — xem khối chú thích đầu file. Hàm THUẦN, không chạm DB. */
export function resolveDateRule(ctx: PolicyCtx, inp: ResolveInput): ResolveResult {
  const keep = (kept: boolean): ResolveResult =>
    ({ rule: (inp.existing as DateRule | null) ?? null, source: inp.existing ? sourceOf(inp.existing) : null, changed: false, keptManual: kept })
  const blank = (): ResolveResult =>
    ({ rule: null, source: null, changed: inp.existing != null, keptManual: false })
  const stamp = (rule: DateRule, source: DateRuleSource, extra?: Partial<DateRule>): ResolveResult => ({
    rule: { ...rule, ...extra, source, set_by: inp.actor ?? 'HỆ THỐNG', set_at: now() } as DateRule,
    source,
    changed: !sameRule(inp.existing, rule) || sourceOf(inp.existing) !== source,
    keptManual: false,
  })

  // 1. Chốt tay là bất khả xâm phạm — kể cả policy = ALL, kể cả "Áp lại theo master".
  if (inp.existing != null) {
    const src = sourceOf(inp.existing)
    if (src === 'MANUAL') return keep(true)
    if (!inp.overwriteAuto) return keep(false)   // không lan ngược: upload lại KHÔNG đổi quy tắc máy đã áp
  }
  // 2. %Date kế thừa từ VL06O = đã có người quyết mức
  if (Number(inp.dateRequired ?? 0) > 0) return keep(false)

  // 3. Mã không đo được date — đứng TRƯỚC chính sách kho (xem chú thích đầu file)
  if (!dateMeasurable(ctx, inp.shelfLifeDays)) {
    return stamp({ kind: 'FEFO' }, 'SYSTEM', { reason: 'NO_SHELF_LIFE' })
  }

  const policy = ctx.policyByWh.get(String(inp.warehouseId ?? '')) ?? 'OFF'
  // 4–5. Chính sách của kho xuất
  if (policy === 'OFF') return blank()
  if (policy === 'NO_NOTE' && String(inp.headerText ?? '').trim() !== '') return blank()

  // 6–9. Khách (đúng loại → mọi loại) → kênh (đúng loại → mọi loại)
  const code = normShipto(inp.shipto)
  const cust = code ? ctx.customerByShipto.get(code) : undefined
  const cat = normCategory(inp.category)
  const lookup = (scope: MasterScope, key: string | null | undefined): DateRule | null => {
    if (!key) return null
    return (cat ? ctx.masterRules.get(masterKey(scope, key, cat)) : undefined)
      ?? ctx.masterRules.get(masterKey(scope, key, null))
      ?? null
  }

  const byCustomer = lookup('CUSTOMER', cust?.id)
  if (byCustomer) return stamp(byCustomer, 'CUSTOMER')
  const byChannel = lookup('CHANNEL', cust?.channel)
  if (byChannel) return stamp(byChannel, 'CHANNEL')

  // 10. Không đoán
  return blank()
}

/** Nhãn nguồn để hiện cạnh badge quy định date — MỘT chỗ, dùng chung cả 3 màn qua API. */
export function dateRuleSourceLabel(rule: unknown): string | null {
  if (rule == null) return null
  const src = sourceOf(rule)
  if (src === 'CUSTOMER') return 'theo khách'
  if (src === 'CHANNEL') return 'theo kênh'
  if (src === 'SYSTEM') return 'hệ thống đặt'
  return 'chốt tay'
}

// ─── KHÁCH HÀNG TỰ SINH KHI GẶP SHIP-TO LẠ ─────────────────────────────────────────────────────
// Danh mục phải TỰ NUÔI, không ai đi nhớ khai. Khách sinh ở đây LUÔN có kênh TRỐNG và chưa có mức
// nào ⇒ rơi vào bậc 10 của thang ⇒ **KHÔNG được cấp quy định date tự động** cho tới khi có người
// khai. Trang Quy định date hiện ô "Khách chưa kênh: n" để việc đó không chìm.
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
// Luật khớp date KHÔNG chép lại: gọi chính `checkDateRuleStock` mà màn khai và bộ sinh việc dùng.
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
