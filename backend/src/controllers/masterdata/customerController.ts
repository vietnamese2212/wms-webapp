/**
 * DANH MỤC KHÁCH HÀNG / NƠI NHẬN + KÊNH KHÁCH HÀNG (user chốt 11/09/2026).
 * Plan: docs/plans/CUSTOMER_DATE_RULE_PLAN.md · luật %Date: services/dateRulePolicy.ts
 *
 * Hai thứ danh mục này quyết định %Date lấy hàng của cả kho, nên mọi đường ghi đều có vết Nhật ký
 * quản trị. Danh mục là TOÀN CÔNG TY (khách của kho A cũng là khách của kho B) nên KHÔNG cắt theo
 * phạm vi kho — nhưng ô "Kho nhận" chỉ nhận kho CÓ THẬT, và người không đủ phạm vi vẫn không đọc
 * được dữ liệu vận hành của kho đó ở các màn khác.
 */
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { safeSearch, searchLooksLikeInjection } from '../../utils/search'
import { parseListParam } from '../../utils/httpQuery'
import { isPreflight, buildPreflight } from '../../utils/uploadPreflight'
import { logAdmin, diffFields } from '../../services/adminAudit'
import { normShipto, normCategory, parseMasterRule, type MasterScope } from '../../services/dateRulePolicy'
import type { DateRule } from '../../services/directedTasks'

const now = () => new Date().toISOString()
const MAX_BULK_IDS = 500

type CustomerRow = {
  id: string; ship_to_code: string; name: string; channel: string | null
  warehouse_id: string | null; is_active: boolean; auto_created: boolean
  note: string | null; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null
}

/** Kênh phải có trong danh mục — gõ bừa một mã kênh là %Date im lặng không áp, không ai biết vì sao. */
async function channelExists(ch: string): Promise<boolean> {
  const { data } = await supabase.from('LookupValue')
    .select('value').eq('type', 'customer_channel').eq('value', ch).maybeSingle()
  return !!data
}

async function warehouseExists(id: string): Promise<boolean> {
  const { data } = await supabase.from('Warehouse').select('id').eq('id', id).maybeSingle()
  return !!data
}

/** Đọc + kiểm phần thân chung của Thêm / Sửa. Trả patch đã chuẩn hoá hoặc thông báo lỗi. */
async function parseCustomerBody(body: Record<string, unknown>, isCreate: boolean): Promise<{ patch: Record<string, unknown> } | { err: { status: number; code: string; msg: string } }> {
  const bad = (msg: string, status = 400, code = 'VALIDATION_ERROR') => ({ err: { status, code, msg } })
  const patch: Record<string, unknown> = {}

  if (isCreate || body.ship_to_code !== undefined) {
    const code = normShipto(body.ship_to_code)
    if (!code) return bad('Mã ship-to chỉ gồm chữ IN HOA và số (không dấu cách), tối đa 50 ký tự')
    patch.ship_to_code = code
  }
  if (isCreate || body.name !== undefined) {
    const name = String(body.name ?? '').trim()
    if (!name) return bad('Thiếu tên khách hàng')
    if (name.length > 200) return bad('Tên khách hàng tối đa 200 ký tự')
    patch.name = name
  }
  if (body.channel !== undefined) {
    const ch = String(body.channel ?? '').trim()
    if (!ch) patch.channel = null
    else {
      if (ch.length > 50 || searchLooksLikeInjection(ch)) return bad('Mã kênh không hợp lệ')
      if (!await channelExists(ch)) return bad(`Kênh "${ch}" không có trong danh mục Kênh khách hàng`)
      patch.channel = ch
    }
  }
  // Mức Quy định date KHÔNG còn nằm trên bảng Customer (đợt 2): một khách mang NHIỀU mức theo loại
  // hàng ⇒ bảng `date_rule_master`, sửa qua PUT /masterdata/date-rules/CUSTOMER/:id.
  if (body.warehouse_id !== undefined) {
    const wh = String(body.warehouse_id ?? '').trim()
    if (!wh) patch.warehouse_id = null
    else {
      if (wh.length > 100 || searchLooksLikeInjection(wh)) return bad('Mã kho không hợp lệ', 400, 'BAD_ID')
      if (!await warehouseExists(wh)) return bad('Không tìm thấy kho được chọn', 404, 'NOT_FOUND')
      patch.warehouse_id = wh
    }
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (body.note !== undefined) patch.note = String(body.note ?? '').trim().slice(0, 1000) || null
  return { patch }
}

// ─── GET /masterdata/customers ────────────────────────────────────────────────────────────────
// Phân trang SERVER (danh mục sẽ vượt nghìn dòng khi mở rộng kênh bán lẻ) — range + count exact.
export async function listCustomers(req: Request, res: Response) {
  try {
    const search = req.query.search ? String(req.query.search).slice(0, 120) : ''
    if (search && searchLooksLikeInjection(search)) return fail(res, 400, 'BAD_ID', 'Từ khoá tìm kiếm không hợp lệ')
    const channels = parseListParam(req.query.channel) ?? []
    const hasChannel = req.query.has_channel === undefined ? null : String(req.query.has_channel) === '1'
    const whId = req.query.warehouse_id ? String(req.query.warehouse_id) : null
    if (whId && (whId.length > 100 || searchLooksLikeInjection(whId))) return fail(res, 400, 'BAD_ID', 'Mã kho không hợp lệ')
    const active = req.query.active === undefined ? null : String(req.query.active) === '1'
    const pageSize = Math.min(500, Math.max(1, Number(req.query.page_size ?? 200) || 200))
    const page = Math.max(1, Number(req.query.page ?? 1) || 1)

    const hasRule = req.query.has_rule === undefined ? null : String(req.query.has_rule) === '1'

    // MỘT lời gọi trả dòng + tổng + các mức đã khai của từng khách (RPC `customer_page`).
    // Bản cũ dùng 2 truy vấn PostgREST và ô band KHÔNG phân trang ⇒ dính trần 1000 dòng, cắt ÂM
    // THẦM khi danh mục vượt nghìn khách. Đính mức theo từng trang cũng là thêm round-trip.
    const { data, error } = await supabase.rpc('customer_page', {
      p_search: search || null,
      p_channels: channels.length ? channels : null,
      p_has_channel: hasChannel,
      p_warehouse_id: whId,
      p_active: active,
      p_has_rule: hasRule,
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
    })
    if (error) return fail(res, error)
    const out = (data ?? {}) as { rows?: unknown[]; total?: number; summary?: Record<string, number> }
    return ok(res, {
      rows: out.rows ?? [], total: out.total ?? 0, page, page_size: pageSize,
      summary: out.summary ?? {},
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── GET /masterdata/customers/seed-candidates ────────────────────────────────────────────────
// Ứng viên = mọi ship-to đã thấy trong VL06O hoặc trên chuyến. DISTINCT làm TRONG SQL.
export async function customerSeedCandidates(req: Request, res: Response) {
  try {
    const days = Math.min(1825, Math.max(7, Number(req.query.days ?? 730) || 730))
    const { data, error } = await supabase.rpc('customer_seed_candidates', { p_days: days })
    if (error) return fail(res, error)
    const rows = (data ?? []) as Array<{ ship_to_code: string; exists_already: boolean }>
    return ok(res, { rows, total: rows.length, new_count: rows.filter(r => !r.exists_already).length, days })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── POST /masterdata/customers/seed ──────────────────────────────────────────────────────────
// 2 pha như mọi upload: `?preflight=1` chỉ đếm, không ghi. Idempotent theo ship_to_code —
// khách đã có thì GIỮ NGUYÊN (tên/kênh do người khai luôn thắng dữ liệu nạp).
export async function seedCustomers(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { rows?: unknown }
    const list = Array.isArray(body.rows) ? body.rows : []
    if (!list.length) return fail(res, 400, 'VALIDATION_ERROR', 'Chưa chọn khách hàng nào để nạp')
    if (list.length > 2000) return fail(res, 400, 'VALIDATION_ERROR', 'Tối đa 2.000 khách mỗi lần nạp')

    const wanted = new Map<string, string>()
    const badCodes: string[] = []
    for (const r of list as Array<{ ship_to_code?: unknown; name?: unknown }>) {
      const code = normShipto(r?.ship_to_code)
      if (!code) { badCodes.push(String(r?.ship_to_code ?? '')); continue }
      if (!wanted.has(code)) wanted.set(code, String(r?.name ?? '').trim().slice(0, 200) || code)
    }
    if (!wanted.size) return fail(res, 400, 'VALIDATION_ERROR', 'Không có mã ship-to hợp lệ nào trong danh sách')

    const codes = [...wanted.keys()]
    const existing = new Set<string>()
    for (let i = 0; i < codes.length; i += 300) {
      const { data } = await supabase.from('Customer').select('ship_to_code').in('ship_to_code', codes.slice(i, i + 300))
      for (const c of ((data ?? []) as { ship_to_code: string }[])) existing.add(c.ship_to_code)
    }
    const toCreate = codes.filter(c => !existing.has(c))

    if (isPreflight(req)) return ok(res, buildPreflight({
      unit: 'khách hàng', total: wanted.size,
      toInsert: toCreate.length, toUpdate: 0, skipped: existing.size,
      warnings: badCodes.map(c => `Bỏ qua mã ship-to không hợp lệ: "${c}"`),
      mode: 'per_row',
      extra: [
        { label: 'Đã có trong danh mục (giữ nguyên)', value: existing.size },
        { label: 'Khách mới — CHƯA phân kênh nên chưa cấp %Date tự động', value: toCreate.length, warn: toCreate.length > 0 },
      ],
    }))

    if (!toCreate.length) return ok(res, { created: 0, skipped: existing.size })
    const t = now()
    const actor = req.user?.name ?? null
    let created = 0
    for (let i = 0; i < toCreate.length; i += 500) {
      const payload = toCreate.slice(i, i + 500).map(code => ({
        id: randomUUID(), ship_to_code: code, name: wanted.get(code)!,
        auto_created: false, is_active: true,
        created_by: actor, updated_by: actor, created_at: t, updated_at: t,
      }))
      const { data, error } = await supabase.from('Customer')
        .upsert(payload, { onConflict: 'ship_to_code', ignoreDuplicates: true }).select('id')
      if (error) return fail(res, error)
      created += (data ?? []).length
    }
    await logAdmin(req, {
      action: 'CUSTOMER_SEED', target_type: 'Customer',
      target_label: `Nạp ${created} khách hàng từ dữ liệu SAP`,
      after: { created, skipped: existing.size },
    })
    return ok(res, { created, skipped: existing.size }, 201)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── POST /masterdata/customers ───────────────────────────────────────────────────────────────
export async function createCustomer(req: Request, res: Response) {
  try {
    const parsed = await parseCustomerBody((req.body ?? {}) as Record<string, unknown>, true)
    if ('err' in parsed) return fail(res, parsed.err.status, parsed.err.code, parsed.err.msg)
    const actor = req.user?.name ?? null
    const t = now()
    const { data, error } = await supabase.from('Customer').insert({
      id: randomUUID(), auto_created: false, is_active: true,
      ...parsed.patch, created_by: actor, updated_by: actor, created_at: t, updated_at: t,
    }).select().single()
    if (error) return fail(res, error)   // 23505 → 409 (pgUserError), 23514 → 400
    const row = data as CustomerRow
    await logAdmin(req, {
      action: 'CUSTOMER_CREATE', target_type: 'Customer', target_id: row.id,
      target_label: `${row.ship_to_code} — ${row.name}`, after: parsed.patch,
    })
    return ok(res, row, 201)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── PUT /masterdata/customers/:id ────────────────────────────────────────────────────────────
export async function updateCustomer(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? '')
    if (!id || id.length > 100 || searchLooksLikeInjection(id)) return fail(res, 400, 'BAD_ID', 'Mã khách hàng không hợp lệ')
    const { data: before } = await supabase.from('Customer').select('*').eq('id', id).maybeSingle()
    if (!before) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy khách hàng')

    const parsed = await parseCustomerBody((req.body ?? {}) as Record<string, unknown>, false)
    if ('err' in parsed) return fail(res, parsed.err.status, parsed.err.code, parsed.err.msg)
    if (!Object.keys(parsed.patch).length) return ok(res, before)

    const { data, error } = await supabase.from('Customer')
      .update({ ...parsed.patch, updated_by: req.user?.name ?? null, updated_at: now() })
      .eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    // id kiểu TEXT: 0 dòng = "đã xoá" GIẢ nếu không kiểm (luật pg-error-is-user-error)
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy khách hàng')
    const row = data as CustomerRow
    const d = diffFields(before as Record<string, unknown>, parsed.patch)
    await logAdmin(req, {
      action: 'CUSTOMER_UPDATE', target_type: 'Customer', target_id: id,
      target_label: `${row.ship_to_code} — ${row.name}`, before: d.before, after: d.after,
    })
    return ok(res, row)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── DELETE /masterdata/customers/:id — NGỪNG (mềm) ───────────────────────────────────────────
// Không xoá cứng: ship-to đã nằm trên chuyến cũ, xoá là mất khả năng đọc lại lịch sử.
export async function deactivateCustomer(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? '')
    if (!id || id.length > 100 || searchLooksLikeInjection(id)) return fail(res, 400, 'BAD_ID', 'Mã khách hàng không hợp lệ')
    const { data, error } = await supabase.from('Customer')
      .update({ is_active: false, updated_by: req.user?.name ?? null, updated_at: now() })
      .eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy khách hàng')
    const row = data as CustomerRow
    await logAdmin(req, {
      action: 'CUSTOMER_UPDATE', target_type: 'Customer', target_id: id,
      target_label: `${row.ship_to_code} — ${row.name}`, before: { is_active: true }, after: { is_active: false },
    })
    return ok(res, row)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

/**
 * Chọn tập khách cho thao tác hàng loạt: `ids` HOẶC `filter`, KHÔNG cả hai.
 * Dùng chung cho "đổi kênh/kho/ngừng" và "đặt mức" — hai bản chép tay của cùng một phép chọn là
 * hai cách hiểu "chọn tất cả" khác nhau, đúng lúc người dùng đang áp cho nghìn dòng.
 */
async function resolveBulkTargets(
  body: { ids?: unknown; filter?: unknown },
): Promise<{ idList: string[]; byFilter: boolean } | { err: { status: number; code: string; msg: string } }> {
  const bad = (msg: string, status = 400, code = 'VALIDATION_ERROR') => ({ err: { status, code, msg } })
  const hasIds = Array.isArray(body.ids) && body.ids.length > 0
  const hasFilter = body.filter != null && typeof body.filter === 'object'
  if (hasIds && hasFilter) return bad('Chỉ gửi MỘT trong hai: danh sách dòng đã chọn (ids) hoặc bộ lọc (filter)')
  if (!hasIds && !hasFilter) return bad('Chưa chọn khách hàng nào')

  if (hasIds) {
    const ids = body.ids as unknown[]
    if (ids.length > MAX_BULK_IDS) return bad(`Tối đa ${MAX_BULK_IDS} dòng mỗi lần — dùng "chọn tất cả theo bộ lọc" cho tập lớn hơn`)
    if (ids.some(x => typeof x !== 'string' || !x || (x as string).length > 100 || searchLooksLikeInjection(x)))
      return bad('Danh sách khách hàng có mã không hợp lệ', 400, 'BAD_ID')
    return { idList: [...new Set(ids as string[])], byFilter: false }
  }

  const f = (body.filter ?? {}) as Record<string, unknown>
  const search = f.search ? String(f.search).slice(0, 120) : ''
  if (search && searchLooksLikeInjection(search)) return bad('Từ khoá tìm kiếm không hợp lệ', 400, 'BAD_ID')
  let q = supabase.from('Customer').select('id')
  if (search) { const s = safeSearch(search); q = q.or(`ship_to_code.ilike.%${s}%,name.ilike.%${s}%`) }
  const chs = parseListParam(f.channel) ?? []
  if (chs.length) q = q.filter('channel', 'in', `(${chs.map(c => `"${c.replace(/"/g, '')}"`).join(',')})`)
  if (f.has_channel !== undefined && f.has_channel !== null)
    q = q.filter('channel', String(f.has_channel) === '1' || f.has_channel === true ? 'not.is' : 'is', null)
  if (f.warehouse_id) q = q.filter('warehouse_id', 'eq', String(f.warehouse_id))
  if (f.active !== undefined && f.active !== null)
    q = q.filter('is_active', 'eq', String(f.active) === '1' || f.active === true)
  const { data, error } = await q.limit(5000)
  if (error) return bad(error.message, 500, 'INTERNAL')
  return { idList: ((data ?? []) as { id: string }[]).map(r => r.id), byFilter: true }
}

// ─── PATCH /masterdata/customers/bulk — SETUP NHANH (user chốt 11/09) ─────────────────────────
// "Khách hàng phải cho chọn multi, có action để setup nhanh phần chức năng/kênh."
// `ids` HOẶC `filter`, KHÔNG cả hai: danh sách đã phân trang nên client không còn đủ id của bộ lọc;
// nhồi nghìn id qua mạng là dính đúng 2 trần id-trên-URL đã đo 27/07 ⇒ gửi CỜ bộ lọc, BE tự resolve.
export async function bulkUpdateCustomers(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { ids?: unknown; filter?: unknown; patch?: unknown }
    const rawPatch = (body.patch ?? {}) as Record<string, unknown>
    const allowed = ['channel', 'warehouse_id', 'is_active']
    const keys = Object.keys(rawPatch)
    if (!keys.length) return fail(res, 400, 'VALIDATION_ERROR', 'Chưa chọn thao tác cần áp')
    const unknownKey = keys.find(k => !allowed.includes(k))
    if (unknownKey) return fail(res, 400, 'VALIDATION_ERROR', `Thao tác hàng loạt không đổi được trường "${unknownKey}"`)

    const parsed = await parseCustomerBody(rawPatch, false)
    if ('err' in parsed) return fail(res, parsed.err.status, parsed.err.code, parsed.err.msg)

    const picked = await resolveBulkTargets(body)
    if ('err' in picked) return fail(res, picked.err.status, picked.err.code, picked.err.msg)
    const { idList, byFilter } = picked
    const hasIds = !byFilter
    if (!idList.length) return ok(res, { updated: 0 })

    const t = now()
    const by = req.user?.name ?? null
    let updated = 0
    for (let i = 0; i < idList.length; i += 300) {
      const { data, error } = await supabase.from('Customer')
        .update({ ...parsed.patch, updated_by: by, updated_at: t })
        .in('id', idList.slice(i, i + 300)).select('id')
      if (error) return fail(res, error)
      updated += (data ?? []).length
    }
    await logAdmin(req, {
      action: 'CUSTOMER_BULK', target_type: 'Customer',
      target_label: `${updated} khách hàng`,
      after: { ...parsed.patch, count: updated, by_filter: !hasIds },
    })
    return ok(res, { updated })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── KÊNH KHÁCH HÀNG ──────────────────────────────────────────────────────────────────────────
// Danh mục MỚI (trước 11/09 app không có chỗ nào khai "Kho tổng / NPP / BHX / KA / MT").
// Dùng LookupValue.meta như Loại kho — không đẻ bảng riêng cho 7 dòng.

export async function listCustomerChannels(_req: Request, res: Response) {
  try {
    const [chRes, custRes, ruleRes] = await Promise.all([
      supabase.from('LookupValue').select('id, value, meta, sort_order').eq('type', 'customer_channel').order('sort_order'),
      supabase.from('Customer').select('channel').eq('is_active', true),
      supabase.from('date_rule_master').select('id, scope_key, category, rule').eq('scope', 'CHANNEL'),
    ])
    if (chRes.error) return fail(res, chRes.error)
    if (ruleRes.error) return fail(res, ruleRes.error)
    const counts = new Map<string, number>()
    for (const c of ((custRes.data ?? []) as { channel: string | null }[]))
      if (c.channel) counts.set(c.channel, (counts.get(c.channel) ?? 0) + 1)
    const rulesOf = new Map<string, MasterRuleRow[]>()
    for (const r of ((ruleRes.data ?? []) as Array<{ id: string; scope_key: string; category: string | null; rule: unknown }>)) {
      rulesOf.set(r.scope_key, [...(rulesOf.get(r.scope_key) ?? []), { id: r.id, category: r.category, rule: r.rule }])
    }
    const rows = ((chRes.data ?? []) as { id: string; value: string; meta: Record<string, unknown> | null; sort_order: number | null }[])
      .map(r => ({
        id: r.id, value: r.value,
        label: String(r.meta?.label ?? r.value),
        rules: (rulesOf.get(r.value) ?? []).sort(byCategory),
        sort_order: r.sort_order,
        customers: counts.get(r.value) ?? 0,
      }))
    return ok(res, rows)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

/**
 * PUT /masterdata/customer-channels/:id — sửa TÊN kênh.
 * Mức Quy định date của kênh nằm ở `date_rule_master` (PUT /masterdata/date-rules/CHANNEL/:value).
 * Route RIÊNG chứ không đi ké `PUT /wms/lookup/:id`: cửa đó gate `wms_settings.manage_type`
 * (quản trị taxonomy Loại kho) — cho nó sửa luôn danh mục khách là nới quyền không liên quan.
 */
export async function updateCustomerChannel(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? '')
    if (!id || id.length > 100 || searchLooksLikeInjection(id)) return fail(res, 400, 'BAD_ID', 'Mã kênh không hợp lệ')
    const { data: before } = await supabase.from('LookupValue')
      .select('id, type, value, meta').eq('id', id).maybeSingle()
    const b = before as { id: string; type: string; value: string; meta: Record<string, unknown> | null } | null
    if (!b) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kênh')
    if (b.type !== 'customer_channel') return fail(res, 400, 'VALIDATION_ERROR', 'Mục này không phải Kênh khách hàng')

    const body = (req.body ?? {}) as { label?: unknown }
    const meta: Record<string, unknown> = { ...(b.meta ?? {}) }
    if (body.label !== undefined) {
      const label = String(body.label ?? '').trim()
      if (!label) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu tên kênh')
      if (label.length > 100) return fail(res, 400, 'VALIDATION_ERROR', 'Tên kênh tối đa 100 ký tự')
      meta.label = label
    }

    const { data, error } = await supabase.from('LookupValue')
      .update({ meta, updated_by: req.user?.name ?? null, updated_at: now() })
      .eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kênh')
    await logAdmin(req, {
      action: 'CHANNEL_UPDATE', target_type: 'CustomerChannel', target_id: id, target_label: b.value,
      before: { meta: b.meta ?? null }, after: { meta },
    })
    return ok(res, data as Record<string, unknown>)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── MỨC QUY ĐỊNH DATE THEO (KHÁCH|KÊNH) × LOẠI HÀNG ──────────────────────────────────────────
// Một bảng, một bộ kiểm tra, một giao diện — dùng chung cho cả hai scope vì chúng mang CÙNG một
// hình dạng sự thật. Tách làm hai chỗ chứa là tự đặt sẵn hai bản luật sẽ lệch nhau.

type MasterRuleRow = { id: string; category: string | null; rule: unknown }
const byCategory = (a: MasterRuleRow, b: MasterRuleRow) =>
  (a.category ?? '').localeCompare(b.category ?? '')

const MAX_RULE_ROWS = 20   // 5 loại hàng + dòng chung; 20 là trần rộng rãi để chặn payload rác

/** Loại hàng phải có trong taxonomy Loại kho — gõ bừa một mã là mức im lặng không bao giờ khớp. */
async function categoryExists(code: string): Promise<boolean> {
  const { data } = await supabase.from('LookupValue')
    .select('value').eq('type', 'warehouse_type').eq('value', code).maybeSingle()
  return !!data
}

async function scopeKeyExists(scope: MasterScope, key: string): Promise<boolean> {
  if (scope === 'CUSTOMER') {
    const { data } = await supabase.from('Customer').select('id').eq('id', key).maybeSingle()
    return !!data
  }
  const { data } = await supabase.from('LookupValue')
    .select('value').eq('type', 'customer_channel').eq('value', key).maybeSingle()
  return !!data
}

// ─── GET /masterdata/date-rules/categories ────────────────────────────────────────────────────
// Loại hàng nào khai được mức — kèm số mã và số mã CÓ khai hạn dùng, để màn khai làm mờ đúng
// loại không đo được date (PM01: 0/888 mã) và nói rõ lý do thay vì im lặng bỏ.
export async function dateRuleCategories(_req: Request, res: Response) {
  try {
    const [catRes, lookRes] = await Promise.all([
      supabase.rpc('date_rule_categories'),
      supabase.from('LookupValue').select('value, meta, sort_order').eq('type', 'warehouse_type').order('sort_order'),
    ])
    if (catRes.error) return fail(res, catRes.error)
    if (lookRes.error) return fail(res, lookRes.error)
    type CatStat = { materials: number; with_shelf_life: number; min_shelf_life: number | null; max_shelf_life: number | null }
    const stat = new Map<string, CatStat>()
    for (const r of ((catRes.data ?? []) as Array<{ category: string } & Record<string, unknown>>))
      stat.set(r.category, {
        materials: Number(r.materials ?? 0),
        with_shelf_life: Number(r.with_shelf_life ?? 0),
        min_shelf_life: r.min_shelf_life == null ? null : Number(r.min_shelf_life),
        max_shelf_life: r.max_shelf_life == null ? null : Number(r.max_shelf_life),
      })
    const rows = ((lookRes.data ?? []) as Array<{ value: string; meta: Record<string, unknown> | null; sort_order: number | null }>)
      .map(r => {
        const s = stat.get(r.value) ?? { materials: 0, with_shelf_life: 0, min_shelf_life: null, max_shelf_life: null }
        return {
          value: r.value,
          label: String(r.meta?.label ?? r.value),
          ...s,
          // false = mọi mã của loại này đều không khai hạn dùng ⇒ quy định date không áp được
          measurable: s.with_shelf_life > 0,
        }
      })
    return ok(res, rows)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── PUT /masterdata/date-rules/:scope/:key — THAY TRỌN bộ mức của một khách / một kênh ───────
// Thay trọn (chứ không sửa từng dòng) vì màn khai là một BẢNG nhỏ: người dùng thêm/xoá/sửa dòng
// rồi bấm Lưu một lần. Sửa lẻ từng dòng thì phải đồng bộ 3 loại thao tác giữa FE và BE, và cảnh
// "xoá dòng chưa kịp gửi" sẽ để lại mức cũ đang chạy mà người khai tưởng đã bỏ.
export const replaceDateRules = (scope: MasterScope) => async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key ?? '')
    if (!key || key.length > 100 || searchLooksLikeInjection(key)) return fail(res, 400, 'BAD_ID', 'Mã khách / kênh không hợp lệ')
    if (!await scopeKeyExists(scope, key))
      return fail(res, 404, 'NOT_FOUND', scope === 'CUSTOMER' ? 'Không tìm thấy khách hàng' : 'Không tìm thấy kênh')

    const body = (req.body ?? {}) as { rules?: unknown }
    const list = Array.isArray(body.rules) ? body.rules : []
    if (list.length > MAX_RULE_ROWS) return fail(res, 400, 'VALIDATION_ERROR', `Tối đa ${MAX_RULE_ROWS} dòng mức`)

    const wanted = new Map<string, { category: string | null; rule: DateRule }>()
    for (const raw of list as Array<Record<string, unknown>>) {
      const cat = raw?.category == null || String(raw.category).trim() === '' ? null : normCategory(raw.category)
      if (raw?.category != null && String(raw.category).trim() !== '' && !cat)
        return fail(res, 400, 'VALIDATION_ERROR', `Mã loại hàng không hợp lệ: "${String(raw.category)}"`)
      if (cat && !await categoryExists(cat))
        return fail(res, 400, 'VALIDATION_ERROR', `Loại hàng "${cat}" không có trong danh mục Loại kho`)
      const parsed = parseMasterRule({ kind: raw?.kind, value: raw?.value })
      if ('err' in parsed) return fail(res, 422, 'VALIDATION_ERROR', parsed.err)
      if (!parsed.rule) continue                      // dòng trống = bỏ qua
      const k = cat ?? ''
      if (wanted.has(k))
        return fail(res, 400, 'VALIDATION_ERROR', `Loại hàng "${cat ?? 'mọi loại'}" bị khai hai lần`)
      wanted.set(k, { category: cat, rule: parsed.rule })
    }

    const { data: beforeRows } = await supabase.from('date_rule_master')
      .select('id, category, rule').eq('scope', scope).eq('scope_key', key)
    const before = (beforeRows ?? []) as MasterRuleRow[]

    const t = now()
    const actor = req.user?.name ?? null
    // XOÁ TRƯỚC rồi mới ghi: đổi một dòng từ FG02 sang FG01 trong khi FG01 cũ đang bị xoá sẽ đụng
    // unique nếu làm ngược (cùng bẫy đã gặp ở phiếu Chi phí kho).
    const keepCats = new Set([...wanted.values()].map(r => r.category ?? ''))
    const dropIds = before.filter(r => !keepCats.has(r.category ?? '')).map(r => r.id)
    for (let i = 0; i < dropIds.length; i += 300) {
      const { error } = await supabase.from('date_rule_master').delete().in('id', dropIds.slice(i, i + 300))
      if (error) return fail(res, error)
    }
    if (wanted.size) {
      const payload = [...wanted.values()].map(r => ({
        id: before.find(b => (b.category ?? '') === (r.category ?? ''))?.id ?? randomUUID(),
        scope, scope_key: key, category: r.category, rule: r.rule,
        created_by: actor, updated_by: actor, created_at: t, updated_at: t,
      }))
      const { error } = await supabase.from('date_rule_master').upsert(payload, { onConflict: 'id' })
      if (error) return fail(res, error)
    }

    await logAdmin(req, {
      action: 'DATE_RULE_MASTER', target_type: 'DateRuleMaster', target_id: `${scope}:${key}`,
      target_label: `${scope === 'CUSTOMER' ? 'Khách' : 'Kênh'} ${key}`,
      before: { rules: before.map(r => ({ category: r.category, rule: r.rule })) },
      after: { rules: [...wanted.values()] },
    })
    // Đổi mức KHÔNG lan ngược: đơn đang mở chỉ đổi khi có người bấm "Áp lại theo master".
    return ok(res, {
      rules: [...wanted.values()],
      applies_to: 'Chỉ đơn sinh sau khi lưu — đơn đang mở dùng nút "Áp lại theo master" ở trang Quy định date',
    })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── PATCH /masterdata/customers/bulk-rule — đặt MỘT mức cho NHIỀU khách ──────────────────────
// Đường khai chính cho lần đầu: 102 khách mà mở từng form thì không ai làm. Áp cho ĐÚNG MỘT loại
// hàng mỗi lượt (hoặc dòng "mọi loại") — trộn nhiều loại trong một lượt thì hộp xác nhận không nói
// nổi "bạn sắp đổi cái gì của bao nhiêu khách".
export async function bulkSetDateRule(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { ids?: unknown; filter?: unknown; category?: unknown; kind?: unknown; value?: unknown }

    const rawCat = body.category == null || String(body.category).trim() === '' ? null : normCategory(body.category)
    if (body.category != null && String(body.category).trim() !== '' && !rawCat)
      return fail(res, 400, 'VALIDATION_ERROR', 'Mã loại hàng không hợp lệ')
    if (rawCat && !await categoryExists(rawCat))
      return fail(res, 400, 'VALIDATION_ERROR', `Loại hàng "${rawCat}" không có trong danh mục Loại kho`)

    // kind rỗng = XOÁ mức của loại hàng đó (không phải "đặt mức rỗng")
    const clearing = body.kind == null || String(body.kind).trim() === ''
    let rule: DateRule | null = null
    if (!clearing) {
      const parsed = parseMasterRule({ kind: body.kind, value: body.value })
      if ('err' in parsed) return fail(res, 422, 'VALIDATION_ERROR', parsed.err)
      rule = parsed.rule
    }

    const picked = await resolveBulkTargets(body)
    if ('err' in picked) return fail(res, picked.err.status, picked.err.code, picked.err.msg)
    const { idList, byFilter } = picked
    if (!idList.length) return ok(res, { updated: 0 })

    const t = now()
    const actor = req.user?.name ?? null
    let updated = 0
    for (let i = 0; i < idList.length; i += 300) {
      const chunk = idList.slice(i, i + 300)
      // XOÁ trước rồi ghi lại: tránh phải suy đoán cách ON CONFLICT khớp chỉ mục NULLS NOT DISTINCT,
      // và cũng là đường DUY NHẤT để "xoá mức" đi qua cùng một khối mã.
      let del = supabase.from('date_rule_master').delete()
        .eq('scope', 'CUSTOMER').in('scope_key', chunk)
      del = rawCat ? del.eq('category', rawCat) : del.is('category', null)
      const { error: delErr } = await del
      if (delErr) return fail(res, delErr)

      if (rule) {
        const payload = chunk.map(id => ({
          id: randomUUID(), scope: 'CUSTOMER', scope_key: id, category: rawCat, rule,
          created_by: actor, updated_by: actor, created_at: t, updated_at: t,
        }))
        const { data, error } = await supabase.from('date_rule_master').insert(payload).select('id')
        if (error) return fail(res, error)
        updated += (data ?? []).length
      } else {
        updated += chunk.length
      }
    }

    await logAdmin(req, {
      action: 'DATE_RULE_MASTER', target_type: 'DateRuleMaster',
      target_label: `${updated} khách hàng · ${rawCat ?? 'mọi loại hàng'}`,
      after: { category: rawCat, rule, count: updated, by_filter: byFilter, cleared: clearing },
    })
    return ok(res, { updated, cleared: clearing })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}
