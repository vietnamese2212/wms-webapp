// Chi phí kho — kê khai theo (Kho × Tháng × Khoản mục). Nguồn nhập MỚI của app (27/08), không
// dẫn xuất từ đâu cả, nên mọi ràng buộc phải nằm ở đây và ở DB chứ không trông vào dữ liệu gốc.
//
// Bốn luật của module này:
//  1. Idempotent theo KHOÁ NGHIỆP VỤ (kho, tháng, khoản mục): khai lại là ĐÈ, upload lại KHÔNG
//     nhân đôi (unique index `uq_warehouse_costs_key` gác ở DB, không tin vào kiểm tra phía JS).
//  2. Ghi theo LÔ (upsert chunk 500) — lưới 153 kho × 7 khoản mục = 1.071 ô, ghi tuần tự là quá
//     `maxDuration=60s` của Vercel.
//  3. KỲ ĐÃ CHỐT thì mọi đường ghi đều 409 — kể cả thêm ô MỚI (nên khoá đặt ở cấp KỲ, bảng riêng
//     `warehouse_cost_locks`, chứ không phải cột trên từng dòng).
//  4. Chi phí CHUNG (warehouse_id null) chỉ user KHÔNG bị giới hạn kho mới được ghi — cùng tiền lệ
//     "khung giờ cargo ALL": người chỉ quản 1 kho không được sửa số của toàn công ty.
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { fetchAllRowsParallel, fetchAllByIdChunks } from '../../utils/pagination'
import { maskServerMessage } from '../../utils/response'
import { parseSheetByHeader, expandMergedCells, type FieldDef } from '../../utils/excelHeader'
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
const prevMonth = (period: string): string => {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
}

type CostRow = { warehouse_id: string | null; period: string; cost_item: string; amount: number; note: string | null }
type Cell = { warehouse_id?: string | null; cost_item?: string; amount?: number | string; note?: string | null }

async function costItemCodes(): Promise<Set<string>> {
  const { data } = await supabase.from('LookupValue').select('value').eq('type', 'cost_item')
  return new Set(((data ?? []) as { value: string }[]).map(r => r.value))
}

/** Các (kho|'*') đã CHỐT trong kỳ — ghi vào là 409. */
async function lockedKeys(period: string): Promise<Set<string>> {
  const { data } = await supabase.from('warehouse_cost_locks').select('warehouse_id').eq('period', period)
  return new Set(((data ?? []) as { warehouse_id: string | null }[]).map(r => r.warehouse_id ?? '*'))
}

// ── ĐỌC: lưới của 1 tháng ─────────────────────────────────────────────────────────────────────
export async function getCostGrid(req: Request, res: Response) {
  try {
    const period = monthOf((req.query as { period?: string }).period)
    if (!period) return fail(res, 'Tham số period (YYYY-MM) là bắt buộc', 400, 'BAD_PERIOD')
    const scope = scopeWhIds(req)

    const [itemsRes, whs] = await Promise.all([
      supabase.from('LookupValue').select('value, sort_order, meta').eq('type', 'cost_item').order('sort_order'),
      readScoped<{ id: string; name: string }>(scope, chunk => {
        const q = supabase.from('Warehouse').select('id, name').order('id')
        return chunk ? q.in('id', chunk) : q
      }),
    ])
    // Chi phí CHUNG (warehouse_id null) chỉ hiện cho user không bị giới hạn kho
    const cells = await readScoped<CostRow>(scope, chunk => {
      const q = supabase.from('warehouse_costs')
        .select('warehouse_id, cost_item, amount, note').eq('period', period).order('id')
      return chunk ? q.in('warehouse_id', chunk) : q
    })
    const { data: locks } = await supabase.from('warehouse_cost_locks')
      .select('warehouse_id, locked_at, locked_by').eq('period', period)

    type Item = { value: string; sort_order: number; meta: { label?: string; is_labor?: boolean; group?: string } | null }
    return ok(res, {
      period,
      can_edit_shared: scope === null,
      items: ((itemsRes.data ?? []) as Item[]).map(i => ({
        code: i.value,
        label: i.meta?.label ?? i.value,
        is_labor: i.meta?.is_labor === true,
        group: i.meta?.group ?? null,
      })),
      warehouses: [...whs].sort((a, b) => a.name.localeCompare(b.name, 'vi')),
      cells,
      locks: locks ?? [],
    })
  } catch (e) { return fail(res, String(e)) }
}

// ── GHI: lưu cả lưới (upsert lô) ──────────────────────────────────────────────────────────────
export async function saveCostGrid(req: Request, res: Response) {
  try {
    const body = req.body as { period?: string; cells?: Cell[] }
    const period = monthOf(body.period)
    if (!period) return fail(res, 'Tham số period (YYYY-MM) là bắt buộc', 400, 'BAD_PERIOD')
    const cells = Array.isArray(body.cells) ? body.cells : []
    if (!cells.length) return fail(res, 'Không có ô nào để lưu', 400, 'EMPTY')

    const scope = scopeWhIds(req)
    const codes = await costItemCodes()
    const locked = await lockedKeys(period)

    const rows: CostRow[] = []
    for (const c of cells) {
      const wid = c.warehouse_id ? String(c.warehouse_id) : null
      const item = String(c.cost_item ?? '').trim()
      const amount = Number(c.amount ?? 0)
      if (!item || !codes.has(item)) return fail(res, `Khoản mục không có trong danh mục: ${item || '(trống)'}`, 400, 'BAD_ITEM')
      if (!Number.isFinite(amount) || amount < 0) return fail(res, `Số tiền không hợp lệ ở khoản mục ${item}`, 400, 'BAD_AMOUNT')
      if (wid === null && scope !== null) return fail(res, 'Bạn chỉ được kê khai chi phí của kho được gán — chi phí CHUNG cần quyền toàn bộ kho', 403, 'SHARED_FORBIDDEN')
      if (wid !== null && scope !== null && !scope.includes(wid)) return fail(res, 'Có kho nằm ngoài phạm vi được gán', 403, 'FORBIDDEN')
      if (locked.has(wid ?? '*')) return fail(res, `Kỳ ${period.slice(0, 7)} của kho này ĐÃ CHỐT — mở lại kỳ mới sửa được`, 409, 'PERIOD_LOCKED')
      rows.push({ warehouse_id: wid, period, cost_item: item, amount, note: c.note ? String(c.note) : null })
    }

    // Trùng ô ngay trong payload → giữ ô CUỐI (đúng ngữ nghĩa "ô nhập sau đè ô trước"), tránh
    // upsert lô tự đá nhau vì 2 dòng cùng khoá.
    const dedup = new Map<string, CostRow>()
    for (const r of rows) dedup.set(`${r.warehouse_id ?? '*'}|${r.cost_item}`, r)
    const list = [...dedup.values()]

    // Đã có dòng nào rồi thì giữ id cũ (upsert theo khoá nghiệp vụ, không đẻ id mới mỗi lần lưu)
    const { data: exist } = await supabase.from('warehouse_costs')
      .select('id, warehouse_id, cost_item').eq('period', period)
    const idByKey = new Map(((exist ?? []) as { id: string; warehouse_id: string | null; cost_item: string }[])
      .map(r => [`${r.warehouse_id ?? '*'}|${r.cost_item}`, r.id]))

    const now = new Date().toISOString()
    const who = userName(req)
    const payload = list.map(r => {
      const key = `${r.warehouse_id ?? '*'}|${r.cost_item}`
      return {
        id: idByKey.get(key) ?? randomUUID(),
        warehouse_id: r.warehouse_id, period: r.period, cost_item: r.cost_item,
        amount: r.amount, note: r.note,
        created_at: now, created_by: who, updated_at: now, updated_by: who,
      }
    })
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500)
      const { error } = await supabase.from('warehouse_costs').upsert(chunk, { onConflict: 'id' })
      if (!error) continue
      // 23505 = người khác vừa tạo đúng ô đó giữa lúc mình đọc id cũ (2 người cùng mở lưới 1 tháng).
      // Đọc lại id của người thắng rồi ghi đè bằng số của mình — last-write-wins, không trả 500.
      if (error.code !== '23505') return fail(res, error.message)
      const { data: again } = await supabase.from('warehouse_costs')
        .select('id, warehouse_id, cost_item').eq('period', period)
      const idNow = new Map(((again ?? []) as { id: string; warehouse_id: string | null; cost_item: string }[])
        .map(r => [`${r.warehouse_id ?? '*'}|${r.cost_item}`, r.id]))
      const retry = chunk.map(r => ({ ...r, id: idNow.get(`${r.warehouse_id ?? '*'}|${r.cost_item}`) ?? r.id }))
      const { error: e2 } = await supabase.from('warehouse_costs').upsert(retry, { onConflict: 'id' })
      if (e2) return fail(res, e2.message)
    }
    return ok(res, { period, saved: payload.length })
  } catch (e) { return fail(res, String(e)) }
}

// ── Chép từ tháng trước — chỉ ĐẮP Ô CÒN TRỐNG, không đè số đã khai ────────────────────────────
export async function copyPreviousMonth(req: Request, res: Response) {
  try {
    const period = monthOf((req.body as { period?: string }).period)
    if (!period) return fail(res, 'Tham số period (YYYY-MM) là bắt buộc', 400, 'BAD_PERIOD')
    const prev = prevMonth(period)
    const scope = scopeWhIds(req)
    const locked = await lockedKeys(period)

    const src = await readScoped<CostRow>(scope, chunk => {
      const q = supabase.from('warehouse_costs').select('warehouse_id, cost_item, amount, note').eq('period', prev).order('id')
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
// File dạng RỘNG như kế toán vẫn làm: cột "Kho" + mỗi khoản mục 1 cột (nhận cả NHÃN lẫn MÃ).
// Kho nhận cả MÃ lẫn TÊN; để trống hoặc ghi "CHUNG" = chi phí chung toàn công ty.
// Số tiền nhận cả kiểu VN ("1.234.567,5") lẫn kiểu máy ("1234567.5") — file kế toán trộn cả hai.
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

    const { data: itemRows } = await supabase.from('LookupValue')
      .select('value, sort_order, meta').eq('type', 'cost_item').order('sort_order')
    const items = ((itemRows ?? []) as { value: string; meta: { label?: string } | null }[])
      .map(i => ({ code: i.value, label: i.meta?.label ?? i.value }))
    if (!items.length) return fail(res, 'Danh mục khoản mục chi phí đang trống', 400, 'NO_ITEMS')

    // Cột động theo DANH MỤC: nhãn tiếng Việt hoặc mã đều nhận
    const fields: FieldDef[] = [
      { key: 'warehouse', label: 'Kho', aliases: ['kho', 'ma kho', 'ten kho', 'warehouse'], required: true },
      ...items.map(i => ({ key: `it_${i.code}`, label: i.label, aliases: [i.code, i.label] })),
      { key: 'note', label: 'Ghi chú', aliases: ['ghi chu', 'note'] },
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
    const locked = await lockedKeys(period)

    type Line = { row: number; warehouse: string; warehouse_id: string | null; warehouse_name: string
      cells: { cost_item: string; amount: number }[]; note: string | null; error?: string }
    const lines: Line[] = []
    parsed.rows.forEach((r, i) => {
      const rowNo = i + 2
      const whRaw = String(r.warehouse ?? '').trim()
      const isShared = whRaw === '' || /^(chung|toan cong ty|\*)$/i.test(norm(whRaw))
      const hit = isShared ? null : byKey.get(norm(whRaw))
      const cells = items
        .map(it => ({ cost_item: it.code, amount: parseAmount(r[`it_${it.code}`]) }))
        .filter(c => c.amount != null) as { cost_item: string; amount: number }[]
      const line: Line = {
        row: rowNo, warehouse: whRaw || 'CHUNG',
        warehouse_id: isShared ? null : hit?.id ?? null,
        warehouse_name: isShared ? 'Chi phí chung' : hit?.name ?? whRaw,
        cells, note: r.note ? String(r.note) : null,
      }
      if (!isShared && !hit) line.error = 'Không tìm thấy kho này (hoặc kho ngoài phạm vi được gán)'
      else if (isShared && scope !== null) line.error = 'Chi phí CHUNG cần quyền toàn bộ kho'
      else if (locked.has(line.warehouse_id ?? '*')) line.error = `Kỳ ${period.slice(0, 7)} của kho này ĐÃ CHỐT`
      else if (cells.some(c => c.amount < 0)) line.error = 'Có số tiền âm'
      else if (!cells.length) line.error = 'Dòng không có số tiền nào'
      lines.push(line)
    })

    const okLines = lines.filter(l => !l.error)
    const { data: exist } = await supabase.from('warehouse_costs')
      .select('id, warehouse_id, cost_item').eq('period', period)
    const idByKey = new Map(((exist ?? []) as { id: string; warehouse_id: string | null; cost_item: string }[])
      .map(r => [`${r.warehouse_id ?? '*'}|${r.cost_item}`, r.id]))

    // Đếm thêm/sửa để báo cáo kiểm-trước nói ĐÚNG việc sắp xảy ra (ô đã có số = SỬA, không phải thêm)
    let toInsert = 0, toUpdate = 0
    for (const l of okLines) for (const c of l.cells)
      idByKey.has(`${l.warehouse_id ?? '*'}|${c.cost_item}`) ? toUpdate++ : toInsert++
    const errors = lines.filter(l => l.error).map(l => `Dòng ${l.row} (${l.warehouse}): ${l.error}`)

    // PHA 1 — chỉ xem trước, KHÔNG ghi gì (chuẩn dùng chung utils/uploadPreflight)
    if (preflight) return ok(res, buildPreflight({
      unit: 'ô số tiền', total: toInsert + toUpdate + errors.length,
      toInsert, toUpdate, skipped: errors.length, errors, mode: 'per_row',
      extra: [
        { label: 'Kỳ', value: period.slice(0, 7) },
        { label: 'Dòng đọc được', value: lines.length },
        { label: 'Dòng lỗi', value: errors.length, warn: errors.length > 0 },
        { label: 'Cột nhận', value: items.map(i => i.label).join(' · ') },
      ],
    }))
    if (!okLines.length) return fail(res, 'Không có dòng nào hợp lệ để ghi', 400, 'NO_VALID_ROW')
    const now = new Date().toISOString()
    const who = userName(req)
    const dedup = new Map<string, Record<string, unknown>>()
    for (const l of okLines) for (const c of l.cells) {
      const key = `${l.warehouse_id ?? '*'}|${c.cost_item}`
      dedup.set(key, {
        id: idByKey.get(key) ?? randomUUID(),
        warehouse_id: l.warehouse_id, period, cost_item: c.cost_item, amount: c.amount, note: l.note,
        created_at: now, created_by: who, updated_at: now, updated_by: who,
      })
    }
    const payload = [...dedup.values()]
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
