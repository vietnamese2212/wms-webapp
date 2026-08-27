// Chi phí kho — SỔ KÊ KHAI: mỗi dòng = (Kho · Kỳ THÁNG · Khoản mục · Số tiền · Ghi chú).
// Vd "Thuê xe nâng — Kho Ba Vì — tháng 8 — 45.000.000". Nguồn nuôi ô "chi phí/tấn" tab Năng suất.
//
// Bản đầu (27/08 sáng) làm dạng LƯỚI 154 kho × 7 khoản mục cột cứng — user bác: mở ra là một
// bức tường ô trống, và không đặt được tên khoản mục theo cách kế toán gọi ("thuê pallet",
// "thuê xe nâng"). Nay: danh sách DÒNG + form thêm/sửa + upload Excel dòng + danh mục khoản mục
// tự thêm được. Bảng DB giữ NGUYÊN (vốn đã là 1 dòng/khoản mục), chỉ đổi cửa vào.
//
// Bốn luật của module này:
//  1. Idempotent theo KHOÁ NGHIỆP VỤ (kho, tháng, khoản mục): mỗi khoản mục 1 dòng/tháng/kho —
//     khai lại là ĐÈ, upload lại KHÔNG nhân đôi (unique `uq_warehouse_costs_key` gác ở DB).
//  2. Ghi theo LÔ (upsert chunk 500) — file kế toán vài nghìn dòng, ghi tuần tự là quá 60s Vercel.
//  3. KỲ ĐÃ CHỐT thì mọi đường ghi đều 409 — kể cả thêm dòng MỚI (nên khoá đặt ở cấp KỲ, bảng
//     riêng `warehouse_cost_locks`, không phải cột trên từng dòng).
//  4. Chi phí CHUNG (warehouse_id null) chỉ user KHÔNG bị giới hạn kho mới được ghi — cùng tiền lệ
//     "khung giờ cargo ALL": người quản 1 kho không được sửa số của toàn công ty.
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { fetchAllRowsParallel, fetchAllByIdChunks } from '../../utils/pagination'
import { maskServerMessage } from '../../utils/response'
import { parseSheetByHeader, expandMergedCells, type FieldDef } from '../../utils/excelHeader'
import { parseListParam } from '../../utils/httpQuery'
import { isPreflight, buildPreflight } from '../../utils/uploadPreflight'

const ok = (res: Response, data: unknown) => res.json({ success: true, data })
const fail = (res: Response, message: string, status = 500, code = 'COST_ERROR') =>
  res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status, res) } })

/** Kho user được phép đụng; null = không giới hạn (superadmin / NATIONAL). */
function scopeWhIds(req: Request): string[] | null {
  if (req.user?.is_superadmin === true || req.user?.warehouse_scope === 'NATIONAL') return null
  const ids = req.user?.warehouse_ids ?? []
  return ids.length ? ids : null
}
const userName = (req: Request) => req.user?.name ?? req.user?.email ?? 'unknown'

/**
 * Đọc TRỌN một bảng theo scope kho. Danh sách kho được gán có thể dài (đơn vị hàng trăm kho NPP)
 * ⇒ chunk 300 id (trần URL của PostgREST) + phân trang từng chunk (cap 1.000 dòng/response).
 * Không có scope = đọc hết, cũng phải phân trang.
 */
function readScoped<T>(scope: string[] | null, build: (chunk: string[] | null) => unknown): Promise<T[]> {
  return (scope
    ? fetchAllByIdChunks(scope, chunk => build(chunk) as never)
    : fetchAllRowsParallel(() => build(null) as never)) as Promise<T[]>
}

/** 'YYYY-MM' hoặc 'YYYY-MM-DD' → ngày đầu tháng 'YYYY-MM-01'; sai dạng → null. */
function monthOf(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(0, 7)}-01`
  return null
}
/** Excel hay trả "8/2026", "08-2026", "01/08/2026" — chấp nhận hết, quy về đầu tháng. */
function monthLoose(raw: unknown): string | null {
  const direct = monthOf(raw)
  if (direct) return direct
  const s = String(raw ?? '').trim()
  let m = /^(\d{1,2})[/\-.](\d{4})$/.exec(s)
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, '0')}-01`
  m = /^\d{1,2}[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s)
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, '0')}-01`
  return null
}
const prevMonth = (period: string): string => {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
}

type CostRow = {
  id: string; warehouse_id: string | null; period: string; cost_item: string
  amount: number; note: string | null; updated_at: string | null; updated_by: string | null
}
type ItemRow = { value: string; sort_order: number; meta: { label?: string; is_labor?: boolean; group?: string } | null }
type Item = { code: string; label: string; is_labor: boolean; group: string | null; sort_order: number }

async function costItems(): Promise<Item[]> {
  const { data } = await supabase.from('LookupValue')
    .select('value, sort_order, meta').eq('type', 'cost_item').order('sort_order')
  return ((data ?? []) as ItemRow[]).map(i => ({
    code: i.value,
    label: i.meta?.label ?? i.value,
    is_labor: i.meta?.is_labor === true,
    group: i.meta?.group ?? null,
    sort_order: i.sort_order ?? 0,
  }))
}

/** Các (kho|'*') đã CHỐT trong kỳ — ghi vào là 409. */
async function lockedKeys(period: string): Promise<Set<string>> {
  const { data } = await supabase.from('warehouse_cost_locks').select('warehouse_id').eq('period', period)
  return new Set(((data ?? []) as { warehouse_id: string | null }[]).map(r => r.warehouse_id ?? '*'))
}

/** Tên kho cho đúng các id đang có trên màn — KHÔNG nạp cả danh mục kho (154 dòng mỗi lần mở). */
async function whNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map()
  const rows = await fetchAllByIdChunks(uniq, chunk =>
    supabase.from('Warehouse').select('id, name').in('id', chunk) as never) as { id: string; name: string }[]
  return new Map(rows.map(r => [r.id, r.name]))
}

/** Kiểm quyền ghi lên 1 dòng: scope kho + kỳ đã chốt. Trả câu lỗi, null = được phép. */
function writeGuard(wid: string | null, scope: string[] | null, locked: Set<string>, period: string):
  { msg: string; status: number; code: string } | null {
  if (wid === null && scope !== null)
    return { msg: 'Bạn chỉ được kê khai chi phí của kho được gán — chi phí CHUNG cần quyền toàn bộ kho', status: 403, code: 'SHARED_FORBIDDEN' }
  if (wid !== null && scope !== null && !scope.includes(wid))
    return { msg: 'Kho nằm ngoài phạm vi được gán', status: 403, code: 'FORBIDDEN' }
  if (locked.has(wid ?? '*'))
    return { msg: `Kỳ ${period.slice(0, 7)} của kho này ĐÃ CHỐT — mở lại kỳ mới ghi được`, status: 409, code: 'PERIOD_LOCKED' }
  return null
}

// ── ĐỌC: sổ kê khai của 1 kỳ ──────────────────────────────────────────────────────────────────
export async function listCosts(req: Request, res: Response) {
  try {
    const q = req.query as { period?: string; warehouse_id?: string; items?: string; search?: string; page?: string; pageSize?: string }
    const period = monthOf(q.period)
    if (!period) return fail(res, 'Tham số period (YYYY-MM) là bắt buộc', 400, 'BAD_PERIOD')
    const scope = scopeWhIds(req)
    const page = Math.max(1, Number(q.page) || 1)
    const pageSize = Math.min(200, Math.max(10, Number(q.pageSize) || 50))

    const [items, rows, locksRes] = await Promise.all([
      costItems(),
      readScoped<CostRow>(scope, chunk => {
        const sel = supabase.from('warehouse_costs')
          .select('id, warehouse_id, period, cost_item, amount, note, updated_at, updated_by')
          .eq('period', period).order('id')
        return chunk ? sel.in('warehouse_id', chunk) : sel
      }),
      supabase.from('warehouse_cost_locks').select('warehouse_id, locked_at, locked_by').eq('period', period),
    ])

    const itemBy = new Map(items.map(i => [i.code, i]))
    const names = await whNames(rows.map(r => r.warehouse_id ?? '').filter(Boolean))
    const norm = (s: string) => s.toLowerCase()
    const wanted = parseListParam(q.items, 200) ?? []
    const kw = norm(String(q.search ?? '').trim())

    const full = rows
      .map(r => ({
        id: r.id,
        warehouse_id: r.warehouse_id,
        warehouse_name: r.warehouse_id ? names.get(r.warehouse_id) ?? '(kho đã xoá)' : 'Chi phí chung (toàn công ty)',
        period: r.period,
        cost_item: r.cost_item,
        item_label: itemBy.get(r.cost_item)?.label ?? r.cost_item,
        is_labor: itemBy.get(r.cost_item)?.is_labor === true,
        amount: Number(r.amount) || 0,
        note: r.note,
        updated_at: r.updated_at,
        updated_by: r.updated_by,
        locked: false,   // gắn sau khi có danh sách khoá
      }))
    const lockSet = new Set(((locksRes.data ?? []) as { warehouse_id: string | null }[]).map(l => l.warehouse_id ?? '*'))
    for (const r of full) r.locked = lockSet.has(r.warehouse_id ?? '*')

    const filtered = full.filter(r =>
      (!q.warehouse_id || (q.warehouse_id === '__shared__' ? r.warehouse_id === null : r.warehouse_id === q.warehouse_id))
      && (!wanted.length || wanted.includes(r.cost_item))
      && (!kw || norm(r.warehouse_name).includes(kw) || norm(r.item_label).includes(kw) || norm(r.note ?? '').includes(kw)))

    filtered.sort((a, b) =>
      a.warehouse_name.localeCompare(b.warehouse_name, 'vi')
      || (itemBy.get(a.cost_item)?.sort_order ?? 0) - (itemBy.get(b.cost_item)?.sort_order ?? 0)
      || a.item_label.localeCompare(b.item_label, 'vi'))

    return ok(res, {
      period,
      can_edit_shared: scope === null,
      items,
      rows: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page, pageSize,
      totals: {
        amount: filtered.reduce((s, r) => s + r.amount, 0),
        labor: filtered.filter(r => r.is_labor).reduce((s, r) => s + r.amount, 0),
        warehouses: new Set(filtered.map(r => r.warehouse_id ?? '*')).size,
        lines: filtered.length,
      },
      locks: locksRes.data ?? [],
    })
  } catch (e) { return fail(res, String(e)) }
}

// ── GHI: 1 dòng kê khai ───────────────────────────────────────────────────────────────────────
type Body = { period?: string; warehouse_id?: string | null; cost_item?: string; amount?: number | string; note?: string | null }

/** Số tiền: nhận cả "45.000.000" (VN) lẫn 45000000 — dùng chung cho form và upload. */
function parseAmount(raw: unknown): number | null {
  if (raw == null || String(raw).trim() === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  let s = String(raw).trim().replace(/\s/g, '').replace(/[₫đ]/gi, '')
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',')
  // Dấu đứng SAU CÙNG là dấu thập phân; dấu còn lại là phân cách nghìn → bỏ
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export async function createCost(req: Request, res: Response) {
  try {
    const b = req.body as Body
    const period = monthOf(b.period)
    if (!period) return fail(res, 'Chưa chọn kỳ (tháng)', 400, 'BAD_PERIOD')
    const item = String(b.cost_item ?? '').trim()
    const amount = parseAmount(b.amount)
    const wid = b.warehouse_id ? String(b.warehouse_id) : null
    const codes = new Set((await costItems()).map(i => i.code))
    if (!codes.has(item)) return fail(res, `Khoản mục không có trong danh mục: ${item || '(trống)'}`, 400, 'BAD_ITEM')
    if (amount == null || amount < 0) return fail(res, 'Số tiền không hợp lệ', 400, 'BAD_AMOUNT')
    const g = writeGuard(wid, scopeWhIds(req), await lockedKeys(period), period)
    if (g) return fail(res, g.msg, g.status, g.code)

    const now = new Date().toISOString(), who = userName(req)
    const { data, error } = await supabase.from('warehouse_costs').insert({
      id: randomUUID(), warehouse_id: wid, period, cost_item: item, amount,
      note: b.note ? String(b.note) : null,
      created_at: now, created_by: who, updated_at: now, updated_by: who,
    }).select('id').single()
    // 23505 = kho+kỳ+khoản mục này đã có dòng. Chỉ 1 dòng/khoản mục/tháng (để upload lại không
    // nhân đôi) ⇒ chỉ đúng dòng đó, đừng đẻ dòng thứ hai.
    if (error?.code === '23505')
      return fail(res, 'Kỳ này kho này đã có khoản mục đó — mở dòng đang có ra sửa số tiền', 409, 'DUPLICATE')
    if (error) return fail(res, error.message)
    return ok(res, { id: data?.id })
  } catch (e) { return fail(res, String(e)) }
}

export async function updateCost(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? '')
    const b = req.body as Body
    const { data: cur } = await supabase.from('warehouse_costs')
      .select('id, warehouse_id, period, cost_item').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy dòng chi phí', 404, 'NOT_FOUND')
    const row = cur as { warehouse_id: string | null; period: string; cost_item: string }

    const scope = scopeWhIds(req)
    const period = monthOf(b.period) ?? row.period
    const locked = await lockedKeys(period)
    const lockedOld = period === row.period ? locked : await lockedKeys(row.period)
    // Kiểm CẢ chỗ cũ lẫn chỗ mới: chuyển dòng RA KHỎI kỳ/kho đã chốt cũng là sửa chứng từ đã chốt
    const gOld = writeGuard(row.warehouse_id, scope, lockedOld, row.period)
    if (gOld) return fail(res, gOld.msg, gOld.status, gOld.code)
    const wid = b.warehouse_id === undefined ? row.warehouse_id : (b.warehouse_id ? String(b.warehouse_id) : null)
    const gNew = writeGuard(wid, scope, locked, period)
    if (gNew) return fail(res, gNew.msg, gNew.status, gNew.code)

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: userName(req) }
    if (b.amount !== undefined) {
      const amount = parseAmount(b.amount)
      if (amount == null || amount < 0) return fail(res, 'Số tiền không hợp lệ', 400, 'BAD_AMOUNT')
      patch.amount = amount
    }
    if (b.note !== undefined) patch.note = b.note ? String(b.note) : null
    if (b.cost_item !== undefined) {
      const item = String(b.cost_item).trim()
      const codes = new Set((await costItems()).map(i => i.code))
      if (!codes.has(item)) return fail(res, `Khoản mục không có trong danh mục: ${item || '(trống)'}`, 400, 'BAD_ITEM')
      patch.cost_item = item
    }
    if (b.warehouse_id !== undefined) patch.warehouse_id = wid
    if (b.period !== undefined) patch.period = period

    const { error } = await supabase.from('warehouse_costs').update(patch).eq('id', id)
    if (error?.code === '23505')
      return fail(res, 'Kỳ này kho này đã có khoản mục đó — sửa dòng đang có thay vì tạo trùng', 409, 'DUPLICATE')
    if (error) return fail(res, error.message)
    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteCost(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? '')
    const { data: cur } = await supabase.from('warehouse_costs')
      .select('id, warehouse_id, period').eq('id', id).maybeSingle()
    if (!cur) return fail(res, 'Không tìm thấy dòng chi phí', 404, 'NOT_FOUND')
    const row = cur as { warehouse_id: string | null; period: string }
    const g = writeGuard(row.warehouse_id, scopeWhIds(req), await lockedKeys(row.period), row.period)
    if (g) return fail(res, g.msg, g.status, g.code)
    const { error } = await supabase.from('warehouse_costs').delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}

// ── DANH MỤC KHOẢN MỤC — kế toán tự thêm "Thuê pallet", "Thuê xe nâng"… ───────────────────────
/** Nhãn → mã: bỏ dấu, chữ HOA, gạch dưới. "Thuê pallet" → THUE_PALLET. */
function codeOf(label: string): string {
  const base = label.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
  return base.slice(0, 40) || `ITEM_${Date.now()}`
}

export async function saveCostItem(req: Request, res: Response) {
  try {
    const b = req.body as { code?: string; label?: string; is_labor?: boolean; sort_order?: number }
    const label = String(b.label ?? '').trim()
    if (!label) return fail(res, 'Tên khoản mục không được để trống', 400, 'BAD_LABEL')
    const items = await costItems()
    const now = new Date().toISOString(), who = userName(req)

    if (b.code) {   // SỬA: giữ nguyên mã (dòng chi phí đang trỏ vào mã đó), chỉ đổi nhãn/cờ/thứ tự
      const cur = items.find(i => i.code === b.code)
      if (!cur) return fail(res, 'Không tìm thấy khoản mục', 404, 'NOT_FOUND')
      const { error } = await supabase.from('LookupValue')
        .update({
          meta: { label, is_labor: b.is_labor === true, group: cur.group },
          sort_order: b.sort_order ?? cur.sort_order,
          updated_at: now, updated_by: who,
        })
        .eq('type', 'cost_item').eq('value', b.code)
      if (error) return fail(res, error.message)
      return ok(res, { code: b.code, label })
    }

    if (items.some(i => i.label.toLowerCase() === label.toLowerCase()))
      return fail(res, `Đã có khoản mục tên "${label}"`, 409, 'DUPLICATE')
    let code = codeOf(label)
    if (items.some(i => i.code === code)) code = `${code}_${items.length + 1}`.slice(0, 48)
    const { error } = await supabase.from('LookupValue').insert({
      id: randomUUID(), type: 'cost_item', value: code,
      sort_order: b.sort_order ?? (Math.max(0, ...items.map(i => i.sort_order)) + 10),
      meta: { label, is_labor: b.is_labor === true },
      created_at: now, created_by: who, updated_at: now, updated_by: who,
    })
    if (error?.code === '23505') return fail(res, 'Khoản mục này đã có', 409, 'DUPLICATE')
    if (error) return fail(res, error.message)
    return ok(res, { code, label })
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteCostItem(req: Request, res: Response) {
  try {
    const code = String(req.params.code ?? '')
    // Đang có dòng chi phí dùng mã này thì KHÔNG cho xoá — xoá đi là mất tên của số đã khai.
    const { count } = await supabase.from('warehouse_costs')
      .select('id', { count: 'exact', head: true }).eq('cost_item', code)
    if ((count ?? 0) > 0)
      return fail(res, `Đang có ${count} dòng chi phí dùng khoản mục này — đổi TÊN thay vì xoá`, 409, 'IN_USE')
    const { error } = await supabase.from('LookupValue').delete().eq('type', 'cost_item').eq('value', code)
    if (error) return fail(res, error.message)
    return ok(res, { code })
  } catch (e) { return fail(res, String(e)) }
}

// ── Chép từ tháng trước — chỉ ĐẮP dòng CÒN THIẾU, không đè số đã khai ─────────────────────────
export async function copyPreviousMonth(req: Request, res: Response) {
  try {
    const period = monthOf((req.body as { period?: string }).period)
    if (!period) return fail(res, 'Tham số period (YYYY-MM) là bắt buộc', 400, 'BAD_PERIOD')
    const prev = prevMonth(period)
    const scope = scopeWhIds(req)
    const locked = await lockedKeys(period)

    const src = await readScoped<CostRow>(scope, chunk => {
      const q = supabase.from('warehouse_costs').select('id, warehouse_id, period, cost_item, amount, note, updated_at, updated_by').eq('period', prev).order('id')
      return chunk ? q.in('warehouse_id', chunk) : q
    })
    if (!src.length) return ok(res, { period, copied: 0, skipped_existing: 0, skipped_locked: 0, from: prev })

    const cur = await readScoped<{ warehouse_id: string | null; cost_item: string }>(scope, chunk => {
      const q = supabase.from('warehouse_costs').select('warehouse_id, cost_item').eq('period', period).order('id')
      return chunk ? q.in('warehouse_id', chunk) : q
    })
    const has = new Set(cur.map(r => `${r.warehouse_id ?? '*'}|${r.cost_item}`))

    const now = new Date().toISOString()
    const who = userName(req)
    let skippedExisting = 0, skippedLocked = 0
    const payload = []
    for (const r of src) {
      const wid = r.warehouse_id ?? null
      if (wid === null && scope !== null) continue           // chi phí chung: không thuộc quyền
      if (locked.has(wid ?? '*')) { skippedLocked++; continue }
      const key = `${wid ?? '*'}|${r.cost_item}`
      if (has.has(key)) { skippedExisting++; continue }
      payload.push({
        id: randomUUID(), warehouse_id: wid, period, cost_item: r.cost_item,
        amount: Number(r.amount) || 0, note: r.note,
        created_at: now, created_by: who, updated_at: now, updated_by: who,
      })
    }
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase.from('warehouse_costs').insert(payload.slice(i, i + 500))
      if (error) return fail(res, error.message)
    }
    return ok(res, { period, from: prev, copied: payload.length, skipped_existing: skippedExisting, skipped_locked: skippedLocked })
  } catch (e) { return fail(res, String(e)) }
}

// ── UPLOAD Excel (2 pha: ?preflight=1 xem trước → xác nhận mới ghi) ───────────────────────────
// File dạng DÒNG, đúng cách kế toán xuất ra: Tháng | Kho | Khoản mục | Số tiền | Ghi chú.
// · Tháng để trống = kỳ đang chọn trên màn (file 1 tháng khỏi lặp cột).
// · Kho nhận cả MÃ lẫn TÊN; để trống hoặc "CHUNG" = chi phí chung toàn công ty.
// · Khoản mục nhận cả NHÃN ("Thuê pallet") lẫn MÃ (THUE_PALLET) — lạ thì báo lỗi ĐÚNG DÒNG kèm
//   hướng dẫn thêm vào danh mục, KHÔNG tự đẻ khoản mục (file gõ sai chính tả sẽ sinh rác).
export async function uploadCostExcel(req: Request, res: Response) {
  try {
    const file = (req as Request & { file?: { buffer: Buffer } }).file
    if (!file) return fail(res, 'Chưa chọn file', 400, 'NO_FILE')
    const period = monthOf((req.body as { period?: string }).period ?? (req.query as { period?: string }).period)
    if (!period) return fail(res, 'Tham số period (YYYY-MM) là bắt buộc', 400, 'BAD_PERIOD')
    const preflight = isPreflight(req)
    const scope = scopeWhIds(req)

    const XLSX = await import('xlsx')
    const wb = XLSX.read(file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) return fail(res, 'File không có sheet nào', 400, 'NO_SHEET')

    const items = await costItems()
    if (!items.length) return fail(res, 'Danh mục khoản mục chi phí đang trống', 400, 'NO_ITEMS')

    const fields: FieldDef[] = [
      { key: 'month', label: 'Tháng', aliases: ['thang', 'ky', 'kỳ', 'period', 'thang chi phi'] },
      { key: 'warehouse', label: 'Kho', aliases: ['kho', 'ma kho', 'ten kho', 'warehouse'], required: true },
      { key: 'item', label: 'Khoản mục', aliases: ['khoan muc', 'khoan muc chi phi', 'loai chi phi', 'noi dung', 'item'], required: true },
      { key: 'amount', label: 'Số tiền', aliases: ['so tien', 'thanh tien', 'gia tri', 'amount', 'tien'], required: true },
      { key: 'note', label: 'Ghi chú', aliases: ['ghi chu', 'dien giai', 'note'] },
    ]
    expandMergedCells(ws)
    const parsed = parseSheetByHeader(ws, fields)
    if (parsed.missingRequired.length)
      return fail(res, `File thiếu cột bắt buộc: ${parsed.missingRequired.join(', ')}`, 400, 'MISSING_COLUMN')

    const whs = await readScoped<{ id: string; code: string | null; name: string }>(scope, chunk => {
      const q = supabase.from('Warehouse').select('id, code, name').order('id')
      return chunk ? q.in('id', chunk) : q
    })
    const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
    const byKey = new Map<string, { id: string; name: string }>()
    for (const w of whs) {
      byKey.set(norm(w.code), { id: w.id, name: w.name })
      byKey.set(norm(w.name), { id: w.id, name: w.name })
    }
    const itemByKey = new Map<string, Item>()
    for (const it of items) { itemByKey.set(norm(it.code), it); itemByKey.set(norm(it.label), it) }

    const lockCache = new Map<string, Set<string>>()
    const locksOf = async (p: string) => {
      if (!lockCache.has(p)) lockCache.set(p, await lockedKeys(p))
      return lockCache.get(p) as Set<string>
    }

    type Line = {
      row: number; period: string; warehouse: string; warehouse_id: string | null; warehouse_name: string
      cost_item: string; item_label: string; amount: number; note: string | null; error?: string
    }
    const lines: Line[] = []
    for (let i = 0; i < parsed.rows.length; i++) {
      const r = parsed.rows[i]
      const rowNo = i + 2
      const whRaw = String(r.warehouse ?? '').trim()
      const itemRaw = String(r.item ?? '').trim()
      const isShared = whRaw === '' || /^(chung|toan cong ty|\*)$/i.test(norm(whRaw))
      const hit = isShared ? null : byKey.get(norm(whRaw))
      const it = itemByKey.get(norm(itemRaw))
      const amount = parseAmount(r.amount)
      const p = r.month != null && String(r.month).trim() !== '' ? monthLoose(r.month) : period
      const line: Line = {
        row: rowNo, period: p ?? period,
        warehouse: whRaw || 'CHUNG',
        warehouse_id: isShared ? null : hit?.id ?? null,
        warehouse_name: isShared ? 'Chi phí chung' : hit?.name ?? whRaw,
        cost_item: it?.code ?? itemRaw, item_label: it?.label ?? itemRaw,
        amount: amount ?? 0, note: r.note ? String(r.note) : null,
      }
      if (!p) line.error = `Tháng không đọc được: "${String(r.month)}" (dùng dạng 2026-08 hoặc 08/2026)`
      else if (!isShared && !hit) line.error = 'Không tìm thấy kho này (hoặc kho ngoài phạm vi được gán)'
      else if (isShared && scope !== null) line.error = 'Chi phí CHUNG cần quyền toàn bộ kho'
      else if (!it) line.error = `Khoản mục "${itemRaw}" chưa có trong danh mục — thêm ở nút "Khoản mục" rồi upload lại`
      else if (amount == null) line.error = 'Số tiền trống hoặc không đọc được'
      else if (amount < 0) line.error = 'Số tiền âm'
      else if ((await locksOf(line.period)).has(line.warehouse_id ?? '*')) line.error = `Kỳ ${line.period.slice(0, 7)} của kho này ĐÃ CHỐT`
      lines.push(line)
    }

    const okLines = lines.filter(l => !l.error)
    // Trùng khoá NGAY TRONG FILE (2 dòng cùng kho+tháng+khoản mục) → CỘNG DỒN, vì kế toán hay
    // tách theo hoá đơn; và mỗi khoản mục chỉ giữ 1 dòng/tháng. Nói rõ ở báo cáo kiểm-trước.
    const merged = new Map<string, Line>()
    let mergedCount = 0
    for (const l of okLines) {
      const key = `${l.period}|${l.warehouse_id ?? '*'}|${l.cost_item}`
      const prev = merged.get(key)
      if (prev) { prev.amount += l.amount; prev.note = prev.note ?? l.note; mergedCount++ }
      else merged.set(key, { ...l })
    }
    const list = [...merged.values()]

    const periods = [...new Set(list.map(l => l.period))]
    // Dòng đã có của CÁC KỲ trong file — qua helper chunk (file nhiều tháng × trăm kho có thể
    // vượt cap 1.000 dòng; đọc thiếu ở đây = tưởng "thêm mới" rồi đụng 23505 lúc ghi).
    const exist = await fetchAllByIdChunks(periods, chunk =>
      supabase.from('warehouse_costs').select('id, warehouse_id, period, cost_item')
        .in('period', chunk).order('id') as never) as { id: string; warehouse_id: string | null; period: string; cost_item: string }[]
    const idByKey = new Map(exist.map(r => [`${r.period.slice(0, 10)}|${r.warehouse_id ?? '*'}|${r.cost_item}`, r.id]))

    let toInsert = 0, toUpdate = 0
    for (const l of list) idByKey.has(`${l.period}|${l.warehouse_id ?? '*'}|${l.cost_item}`) ? toUpdate++ : toInsert++
    const errors = lines.filter(l => l.error).map(l => `Dòng ${l.row} (${l.warehouse} · ${l.item_label}): ${l.error}`)

    // PHA 1 — chỉ xem trước, KHÔNG ghi gì (chuẩn dùng chung utils/uploadPreflight)
    if (preflight) return ok(res, buildPreflight({
      unit: 'dòng chi phí', total: lines.length,
      toInsert, toUpdate, skipped: errors.length, errors, mode: 'per_row',
      extra: [
        { label: 'Kỳ mặc định', value: period.slice(0, 7) },
        { label: 'Kỳ có trong file', value: periods.map(p => p.slice(0, 7)).join(' · ') || period.slice(0, 7) },
        { label: 'Dòng lỗi', value: errors.length, warn: errors.length > 0 },
        ...(mergedCount ? [{ label: 'Dòng trùng khoá đã CỘNG DỒN', value: mergedCount, warn: true }] : []),
      ],
    }))
    if (!list.length) return fail(res, 'Không có dòng nào hợp lệ để ghi', 400, 'NO_VALID_ROW')

    const now = new Date().toISOString()
    const who = userName(req)
    const payload = list.map(l => ({
      id: idByKey.get(`${l.period}|${l.warehouse_id ?? '*'}|${l.cost_item}`) ?? randomUUID(),
      warehouse_id: l.warehouse_id, period: l.period, cost_item: l.cost_item, amount: l.amount, note: l.note,
      created_at: now, created_by: who, updated_at: now, updated_by: who,
    }))
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase.from('warehouse_costs').upsert(payload.slice(i, i + 500), { onConflict: 'id' })
      if (error) return fail(res, error.message)
    }
    return ok(res, { inserted: toInsert, updated: toUpdate, skipped: errors.length, errors })
  } catch (e) { return fail(res, String(e)) }
}

// ── Chốt kỳ / mở lại ──────────────────────────────────────────────────────────────────────────
export async function setCostLock(req: Request, res: Response) {
  try {
    const body = req.body as { period?: string; warehouse_id?: string | null; locked?: boolean }
    const period = monthOf(body.period)
    if (!period) return fail(res, 'Tham số period (YYYY-MM) là bắt buộc', 400, 'BAD_PERIOD')
    const scope = scopeWhIds(req)
    const wid = body.warehouse_id ? String(body.warehouse_id) : null
    if (wid === null && scope !== null) return fail(res, 'Chốt kỳ cho chi phí CHUNG cần quyền toàn bộ kho', 403, 'SHARED_FORBIDDEN')
    if (wid !== null && scope !== null && !scope.includes(wid)) return fail(res, 'Kho ngoài phạm vi được gán', 403, 'FORBIDDEN')

    if (body.locked === false) {
      let q = supabase.from('warehouse_cost_locks').delete().eq('period', period)
      q = wid === null ? q.is('warehouse_id', null) : q.eq('warehouse_id', wid)
      const { error } = await q
      if (error) return fail(res, error.message)
      return ok(res, { period, warehouse_id: wid, locked: false })
    }
    // Khoá dùng unique index có `coalesce(warehouse_id,'*')` nên KHÔNG upsert theo cột được
    // (PostgREST đòi constraint khớp đúng cột). Chèn thẳng; đụng 23505 = người khác vừa chốt
    // xong ⇒ coi như thành công, tuyệt đối không trả 500 cho người bấm nút thứ hai.
    const now = new Date().toISOString()
    const { error } = await supabase.from('warehouse_cost_locks').insert({
      id: randomUUID(), warehouse_id: wid, period,
      locked_at: now, locked_by: userName(req), created_at: now, updated_at: now,
    })
    if (error && error.code !== '23505') return fail(res, error.message)
    return ok(res, { period, warehouse_id: wid, locked: true })
  } catch (e) { return fail(res, String(e)) }
}
