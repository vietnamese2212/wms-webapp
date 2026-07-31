import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel, fetchAllByIdChunks } from '../../utils/pagination'

// ─── Module XE NÂNG — check list an toàn hàng ngày + đồng hồ giờ vận hành ─────
// Bảng: forklift_vehicles (danh mục xe) · forklift_checklist_items (hạng mục check
// dùng chung) · forklift_daily_logs (mỗi xe mỗi ngày 1 dòng — unique, upsert).
// Giờ chạy 1 ngày = số đồng hồ lần ghi KẾ TIẾP − số hôm đó (RPC forklift_report tính).

const todayVN = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

const isValidDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime())

// Scope kho: non-NATIONAL chỉ thấy xe của kho được gán (null = full)
function scopeWhIds(req: Request): string[] | null {
  if (req.user?.warehouse_scope === 'NATIONAL') return null
  return req.user?.warehouse_ids ?? []
}

type ChecklistResult = { item_id: string; label: string; ok: boolean; note?: string | null }

// ─── Ảnh chụp xe (bucket riêng tư 'forklift-photos', chỉ service role) ───────
const PHOTO_BUCKET = 'forklift-photos'
const PHOTO_MAX_BYTES = 4 * 1024 * 1024   // FE đã nén ~200-400KB; đây là chặn cứng

function decodePhotoDataUrl(raw: unknown): { buf: Buffer; contentType: string; ext: string } | string | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return 'Ảnh không hợp lệ'
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!m) return 'Ảnh phải là JPEG/PNG/WebP (data URL base64)'
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length === 0) return 'Ảnh rỗng'
  if (buf.length > PHOTO_MAX_BYTES) return 'Ảnh quá lớn (tối đa 4MB) — chụp lại hoặc giảm chất lượng'
  const ext = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : m[1]
  return { buf, contentType: `image/${m[1] === 'jpg' ? 'jpeg' : m[1]}`, ext }
}

// ─── DỌN ẢNH CŨ: giữ 60 NGÀY GẦN NHẤT (user chốt 31/07 — chống phình storage) ─
// Bản ghi check list GIỮ NGUYÊN (số liệu/lịch sử ai check còn đủ), chỉ gỡ ẢNH.
// Không pg_cron (free tier không bật) → dọn LƯỜI như error_logs: mỗi lần có người
// lưu check list, tối đa 1 lần/6h/instance, mỗi lượt 1 lô ≤200 ảnh (chạy dần).
// Thứ tự an toàn: xóa object storage TRƯỚC, xóa lỗi thì giữ photo_path lại chờ
// lượt sau (không orphan ảnh); update KHÔNG đụng updated_at (giữ đúng "Lúc check").
const PHOTO_RETENTION_DAYS = 60
let _lastPhotoCleanupAt = 0

async function cleanupOldPhotos(): Promise<void> {
  if (Date.now() - _lastPhotoCleanupAt < 6 * 3600_000) return
  _lastPhotoCleanupAt = Date.now()
  const cutoff = new Date(Date.now() - PHOTO_RETENTION_DAYS * 86400_000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const { data } = await supabase.from('forklift_daily_logs')
    .select('id, photo_path')
    .not('photo_path', 'is', null).lt('log_date', cutoff)
    .order('log_date').limit(200)
  const rows = (data ?? []).filter((r): r is { id: string; photo_path: string } => !!r.photo_path)
  if (!rows.length) return
  const { error: rmErr } = await supabase.storage.from(PHOTO_BUCKET).remove(rows.map(r => r.photo_path))
  if (rmErr) { console.error('[forklift] dọn ảnh cũ lỗi:', rmErr.message); return }
  await supabase.from('forklift_daily_logs').update({ photo_path: null }).in('id', rows.map(r => r.id))
  console.log(`[forklift] đã dọn ${rows.length} ảnh cũ hơn ${cutoff}`)
}

// Phát signed URL 1h cho danh sách photo_path (bucket riêng tư — FE không đọc thẳng được)
async function signPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!paths.length) return out
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  return out
}

function parseChecklist(raw: unknown): ChecklistResult[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > 200) return null
  const out: ChecklistResult[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') return null
    const o = it as Record<string, unknown>
    if (typeof o.label !== 'string' || !o.label.trim() || typeof o.ok !== 'boolean') return null
    out.push({
      item_id: typeof o.item_id === 'string' ? o.item_id : '',
      label: o.label.trim().slice(0, 200),
      ok: o.ok,
      note: typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 500) : null,
    })
  }
  return out
}

// ─── Danh mục XE NÂNG ─────────────────────────────────────────────────────────

// GET /wms/forklifts — list xe (scoped theo kho); ?include_inactive=1 lấy cả xe ngừng dùng
export async function listForklifts(req: Request, res: Response) {
  const scope = scopeWhIds(req)
  if (scope !== null && scope.length === 0) return ok(res, [])
  const rows = await fetchAllRowsParallel(() => {
    let q = supabase.from('forklift_vehicles')
      .select('id, code, name, warehouse_id, is_active, created_by, updated_by, created_at, updated_at, warehouse:Warehouse(id, code, name)')
      .order('code')
    if (scope !== null) q = q.in('warehouse_id', scope)   // scope kho ≤ vài chục id — không cần chunk
    if (req.query.include_inactive !== '1') q = q.eq('is_active', true)
    return q
  }).catch((e: Error) => e)
  if (rows instanceof Error) return fail(res, rows.message, 500)
  return ok(res, rows)
}

// POST /wms/forklifts — thêm xe (forklift.manage_vehicle)
export async function createForklift(req: Request, res: Response) {
  const { code, name, warehouse_id } = req.body as Record<string, unknown>
  const codeNorm = String(code ?? '').trim().toUpperCase()
  if (!codeNorm || codeNorm.length > 30) return fail(res, 'Mã xe bắt buộc (tối đa 30 ký tự)', 400)
  if (!warehouse_id || typeof warehouse_id !== 'string') return fail(res, 'Chưa chọn kho', 400)
  const scope = scopeWhIds(req)
  if (scope !== null && !scope.includes(warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)

  const { data, error } = await supabase.from('forklift_vehicles').insert({
    id: randomUUID(),
    code: codeNorm,
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null,
    warehouse_id,
    is_active: true,
    created_by: req.user?.name ?? null,
    updated_by: req.user?.name ?? null,
    updated_at: new Date().toISOString(),
  }).select('id, code').single()
  if (error) {
    if (error.code === '23505') return fail(res, `Mã xe "${codeNorm}" đã tồn tại`, 409)
    return fail(res, error.message, 500)
  }
  return ok(res, data, 201)
}

// PATCH /wms/forklifts/:id — sửa xe (tên / kho / trạng thái)
export async function updateForklift(req: Request, res: Response) {
  const { id } = req.params
  const { code, name, warehouse_id, is_active } = req.body as Record<string, unknown>
  const { data: cur } = await supabase.from('forklift_vehicles').select('id, warehouse_id').eq('id', id).maybeSingle()
  if (!cur) return fail(res, 'Không tìm thấy xe nâng', 404)
  const scope = scopeWhIds(req)
  if (scope !== null && !scope.includes(cur.warehouse_id)) return fail(res, 'Xe ngoài phạm vi kho được gán', 403)

  const patch: Record<string, unknown> = { updated_by: req.user?.name ?? null, updated_at: new Date().toISOString() }
  if (code !== undefined) {
    const codeNorm = String(code ?? '').trim().toUpperCase()
    if (!codeNorm || codeNorm.length > 30) return fail(res, 'Mã xe bắt buộc (tối đa 30 ký tự)', 400)
    patch.code = codeNorm
  }
  if (name !== undefined) patch.name = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : null
  if (warehouse_id !== undefined) {
    if (!warehouse_id || typeof warehouse_id !== 'string') return fail(res, 'Kho không hợp lệ', 400)
    if (scope !== null && !scope.includes(warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
    patch.warehouse_id = warehouse_id
  }
  if (is_active !== undefined) patch.is_active = !!is_active

  const { error } = await supabase.from('forklift_vehicles').update(patch).eq('id', id)
  if (error) {
    if (error.code === '23505') return fail(res, 'Mã xe đã tồn tại', 409)
    return fail(res, error.message, 500)
  }
  return ok(res, { id })
}

// DELETE /wms/forklifts/:id — chỉ xóa xe CHƯA có log (có log → ngừng dùng is_active=false)
export async function deleteForklift(req: Request, res: Response) {
  const { id } = req.params
  const { data: cur } = await supabase.from('forklift_vehicles').select('id, warehouse_id').eq('id', id).maybeSingle()
  if (!cur) return fail(res, 'Không tìm thấy xe nâng', 404)
  const scope = scopeWhIds(req)
  if (scope !== null && !scope.includes(cur.warehouse_id)) return fail(res, 'Xe ngoài phạm vi kho được gán', 403)

  const { count } = await supabase.from('forklift_daily_logs').select('id', { count: 'exact', head: true }).eq('forklift_id', id)
  if ((count ?? 0) > 0) return fail(res, `Xe đã có ${count} bản ghi check list — chuyển "Ngừng dùng" thay vì xóa (giữ lịch sử)`, 409)

  const { error } = await supabase.from('forklift_vehicles').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  return ok(res, { id })
}

// ─── Danh mục HẠNG MỤC CHECK LIST (theo KHO — user chốt 31/07) ────────────────
// warehouse_id NULL = dùng chung mọi kho; có giá trị = riêng kho đó.
// Check list 1 xe = hạng mục CHUNG + hạng mục RIÊNG kho của xe (?warehouse_id=).
// Sửa/xóa hạng mục CHUNG = chỉ user full scope kho (đụng mọi kho — cùng triết lý
// khung giờ cargo ALL); hạng mục riêng kho = user có kho đó trong scope.

function guardItemScope(req: Request, warehouseId: string | null): string | null {
  const scope = scopeWhIds(req)
  if (scope === null) return null
  if (warehouseId === null) return 'Hạng mục DÙNG CHUNG mọi kho — chỉ tài khoản full phạm vi kho được sửa'
  if (!scope.includes(warehouseId)) return 'Kho ngoài phạm vi được gán'
  return null
}

// GET /wms/forklift-items — ?warehouse_id= (check sheet: chung + riêng kho đó)
// · ?include_inactive=1 (tab Cài đặt: mọi hạng mục trong scope + chung)
export async function listChecklistItems(req: Request, res: Response) {
  // id kho đi vào chuỗi .or() → chỉ nhận dạng an toàn (chống filter-injection PostgREST)
  const rawWh = typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : ''
  const qWh = /^[A-Za-z0-9_-]+$/.test(rawWh) ? rawWh : null
  const scope = scopeWhIds(req)
  const rows = await fetchAllRowsParallel(() => {
    let q = supabase.from('forklift_checklist_items')
      .select('id, label, sort_order, is_active, warehouse_id, warehouse:Warehouse(id, code, name), created_at, updated_at')
      .order('sort_order').order('created_at')
    if (qWh) q = q.or(`warehouse_id.is.null,warehouse_id.eq.${qWh}`)
    else if (scope !== null) q = scope.length > 0
      ? q.or(`warehouse_id.is.null,warehouse_id.in.(${scope.join(',')})`)   // scope kho ≤ vài chục id
      : q.is('warehouse_id', null)
    if (req.query.include_inactive !== '1') q = q.eq('is_active', true)
    return q
  }).catch((e: Error) => e)
  if (rows instanceof Error) return fail(res, rows.message, 500)
  return ok(res, rows)
}

function parseItemWarehouseId(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  return typeof raw === 'string' ? raw : undefined
}

// POST /wms/forklift-items (forklift.manage_item)
export async function createChecklistItem(req: Request, res: Response) {
  const { label, sort_order, warehouse_id } = req.body as Record<string, unknown>
  const labelNorm = typeof label === 'string' ? label.trim().slice(0, 200) : ''
  if (!labelNorm) return fail(res, 'Nội dung hạng mục bắt buộc', 400)
  const whId = parseItemWarehouseId(warehouse_id) ?? null
  const scopeErr = guardItemScope(req, whId)
  if (scopeErr) return fail(res, scopeErr, 403)
  const { data, error } = await supabase.from('forklift_checklist_items').insert({
    id: randomUUID(),
    label: labelNorm,
    sort_order: Number.isFinite(Number(sort_order)) ? Math.trunc(Number(sort_order)) : 0,
    warehouse_id: whId,
    is_active: true,
    updated_at: new Date().toISOString(),
  }).select('id').single()
  if (error) return fail(res, error.message, 500)
  return ok(res, data, 201)
}

// PATCH /wms/forklift-items/:id
export async function updateChecklistItem(req: Request, res: Response) {
  const { id } = req.params
  const { label, sort_order, is_active, warehouse_id } = req.body as Record<string, unknown>
  const { data: cur } = await supabase.from('forklift_checklist_items').select('id, warehouse_id').eq('id', id).maybeSingle()
  if (!cur) return fail(res, 'Không tìm thấy hạng mục', 404)
  const scopeErrCur = guardItemScope(req, cur.warehouse_id ?? null)
  if (scopeErrCur) return fail(res, scopeErrCur, 403)

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (label !== undefined) {
    const labelNorm = typeof label === 'string' ? label.trim().slice(0, 200) : ''
    if (!labelNorm) return fail(res, 'Nội dung hạng mục bắt buộc', 400)
    patch.label = labelNorm
  }
  if (sort_order !== undefined) {
    if (!Number.isFinite(Number(sort_order))) return fail(res, 'Thứ tự phải là số', 400)
    patch.sort_order = Math.trunc(Number(sort_order))
  }
  if (is_active !== undefined) patch.is_active = !!is_active
  const newWh = parseItemWarehouseId(warehouse_id)
  if (newWh !== undefined) {
    const scopeErrNew = guardItemScope(req, newWh)
    if (scopeErrNew) return fail(res, scopeErrNew, 403)
    patch.warehouse_id = newWh
  }
  const { error, data } = await supabase.from('forklift_checklist_items').update(patch).eq('id', id).select('id').maybeSingle()
  if (error) return fail(res, error.message, 500)
  if (!data) return fail(res, 'Không tìm thấy hạng mục', 404)
  return ok(res, { id })
}

// DELETE /wms/forklift-items/:id — xóa hẳn (lịch sử log đã snapshot label nên không vỡ)
export async function deleteChecklistItem(req: Request, res: Response) {
  const { id } = req.params
  const { data: cur } = await supabase.from('forklift_checklist_items').select('id, warehouse_id').eq('id', id).maybeSingle()
  if (!cur) return fail(res, 'Không tìm thấy hạng mục', 404)
  const scopeErr = guardItemScope(req, cur.warehouse_id ?? null)
  if (scopeErr) return fail(res, scopeErr, 403)
  const { error } = await supabase.from('forklift_checklist_items').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  return ok(res, { id })
}

// ─── BOARD check list ngày — kiểm soát xe nào CHƯA check ──────────────────────

// GET /wms/forklift-board?date=YYYY-MM-DD (mặc định hôm nay VN)
// Trả mỗi xe active (scoped) + log của ngày đó (null = CHƯA check) + số đồng hồ gần nhất
// trước ngày đó (để FE gợi ý / validate ô nhập).
export async function getBoard(req: Request, res: Response) {
  const date = isValidDate(req.query.date) ? req.query.date : todayVN()
  const scope = scopeWhIds(req)
  if (scope !== null && scope.length === 0) return ok(res, { date, vehicles: [] })

  const vehicles = await fetchAllRowsParallel(() => {
    let q = supabase.from('forklift_vehicles')
      .select('id, code, name, warehouse_id, warehouse:Warehouse(id, code, name)')
      .eq('is_active', true).order('code')
    if (scope !== null) q = q.in('warehouse_id', scope)
    return q
  }).catch((e: Error) => e)
  if (vehicles instanceof Error) return fail(res, vehicles.message, 500)
  if (vehicles.length === 0) return ok(res, { date, vehicles: [] })

  const ids = vehicles.map((v: { id: string }) => v.id)
  // Log của ngày — chunk 300 (đội xe có thể lớn; luật id-list-url-limits)
  const logs = await fetchAllByIdChunks(ids, chunk =>
    supabase.from('forklift_daily_logs')
      .select('id, forklift_id, status, hour_meter, checklist, issue_count, note, checked_by, photo_path, updated_at')
      .eq('log_date', date).in('forklift_id', chunk).order('forklift_id'),
  ).catch((e: Error) => e)
  if (logs instanceof Error) return fail(res, logs.message, 500)

  // Bucket riêng tư → phát signed URL 1h cho ảnh chụp xe (1 lời gọi batch)
  const photoUrls = await signPhotoUrls((logs as { photo_path?: string | null }[])
    .map(l => l.photo_path).filter((p): p is string => !!p))
  for (const l of logs as { photo_path?: string | null; photo_url?: string | null }[])
    l.photo_url = l.photo_path ? photoUrls.get(l.photo_path) ?? null : null

  // Số đồng hồ GẦN NHẤT trước ngày này (mỗi xe 1 dòng) — RPC-less: lấy các log có số
  // trước ngày date, mỗi xe giữ dòng mới nhất. Bounded: chỉ cần 1 dòng/xe → query
  // order desc + dedup trong JS trên window 60 ngày gần nhất (check hàng ngày nên quá đủ;
  // xe bỏ check >60 ngày thì ô gợi ý trống — nhập tay bình thường).
  const sinceIso = new Date(new Date(`${date}T00:00:00+07:00`).getTime() - 60 * 86400_000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  const prevRows = await fetchAllByIdChunks(ids, chunk =>
    supabase.from('forklift_daily_logs')
      .select('forklift_id, log_date, hour_meter')
      .lt('log_date', date).gte('log_date', sinceIso).not('hour_meter', 'is', null)
      .in('forklift_id', chunk).order('log_date', { ascending: false }),
  ).catch((e: Error) => e)
  if (prevRows instanceof Error) return fail(res, prevRows.message, 500)

  const prevByForklift = new Map<string, { log_date: string; hour_meter: number }>()
  for (const r of prevRows as { forklift_id: string; log_date: string; hour_meter: number }[]) {
    if (!prevByForklift.has(r.forklift_id)) prevByForklift.set(r.forklift_id, { log_date: r.log_date, hour_meter: r.hour_meter })
  }
  const logByForklift = new Map((logs as { forklift_id: string }[]).map(l => [l.forklift_id, l]))

  return ok(res, {
    date,
    vehicles: vehicles.map((v: { id: string }) => ({
      ...v,
      log: logByForklift.get(v.id) ?? null,
      prev: prevByForklift.get(v.id) ?? null,
    })),
  })
}

// ─── GHI check list ngày (upsert theo xe+ngày) ────────────────────────────────

// POST /wms/forklift-logs (forklift.check)
// body: { forklift_id, log_date?, status: 'ACTIVE'|'IDLE', hour_meter?, checklist?, note?, photo_data? }
// Xe HOẠT ĐỘNG bắt buộc có ẢNH CHỤP XE (user chốt 31/07): gửi photo_data (data URL, FE đã nén)
// hoặc bản ghi cũ đã có ảnh (sửa lại không bắt chụp lại). Xe NGHỈ không cần ảnh/checklist.
export async function saveLog(req: Request, res: Response) {
  const { forklift_id, log_date, status, hour_meter, checklist, note, photo_data } = req.body as Record<string, unknown>
  if (!forklift_id || typeof forklift_id !== 'string') return fail(res, 'Thiếu xe nâng', 400)
  const date = log_date === undefined ? todayVN() : (isValidDate(log_date) ? log_date : null)
  if (!date) return fail(res, 'Ngày không hợp lệ (YYYY-MM-DD)', 400)
  if (date > todayVN()) return fail(res, 'Không check list cho ngày TƯƠNG LAI', 400)
  if (status !== 'ACTIVE' && status !== 'IDLE') return fail(res, 'Trạng thái phải là ACTIVE (chạy) hoặc IDLE (nghỉ)', 400)

  const { data: fk } = await supabase.from('forklift_vehicles')
    .select('id, code, warehouse_id, is_active').eq('id', forklift_id).maybeSingle()
  if (!fk) return fail(res, 'Không tìm thấy xe nâng', 404)
  const scope = scopeWhIds(req)
  if (scope !== null && !scope.includes(fk.warehouse_id)) return fail(res, 'Xe ngoài phạm vi kho được gán', 403)

  // Số đồng hồ: bắt buộc khi ACTIVE; phải ≥ số lần ghi TRƯỚC và ≤ số lần ghi SAU (đồng hồ chỉ tăng)
  let meter: number | null = null
  if (status === 'ACTIVE') {
    meter = Number(hour_meter)
    if (!Number.isFinite(meter) || meter < 0) return fail(res, 'Số đồng hồ giờ bắt buộc khi xe chạy (số ≥ 0)', 422)
    if (meter > 9_999_999) return fail(res, 'Số đồng hồ giờ quá lớn', 422)
    meter = Math.round(meter * 10) / 10

    const [{ data: prev }, { data: next }] = await Promise.all([
      supabase.from('forklift_daily_logs').select('log_date, hour_meter')
        .eq('forklift_id', forklift_id).lt('log_date', date).not('hour_meter', 'is', null)
        .order('log_date', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('forklift_daily_logs').select('log_date, hour_meter')
        .eq('forklift_id', forklift_id).gt('log_date', date).not('hour_meter', 'is', null)
        .order('log_date', { ascending: true }).limit(1).maybeSingle(),
    ])
    if (prev && meter < Number(prev.hour_meter))
      return fail(res, `Số đồng hồ (${meter}) nhỏ hơn lần ghi trước (${prev.hour_meter} — ngày ${prev.log_date}). Đồng hồ giờ chỉ tăng, kiểm tra lại.`, 422)
    if (next && meter > Number(next.hour_meter))
      return fail(res, `Số đồng hồ (${meter}) lớn hơn lần ghi sau (${next.hour_meter} — ngày ${next.log_date}). Kiểm tra lại.`, 422)
  }

  const list = parseChecklist(checklist)
  if (list === null) return fail(res, 'Check list không hợp lệ', 400)

  // ẢNH CHỤP XE — bắt buộc khi xe hoạt động
  const photo = decodePhotoDataUrl(photo_data)
  if (typeof photo === 'string') return fail(res, photo, 422)
  let photoPath: string | null = null
  if (photo) {
    photoPath = `${forklift_id}/${date}-${Date.now()}.${photo.ext}`
    const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET)
      .upload(photoPath, photo.buf, { contentType: photo.contentType, upsert: true })
    if (upErr) return fail(res, `Không lưu được ảnh: ${upErr.message}`, 500)
  }
  const { data: existing } = await supabase.from('forklift_daily_logs')
    .select('id, photo_path').eq('forklift_id', forklift_id).eq('log_date', date).maybeSingle()
  if (status === 'ACTIVE' && !photoPath && !existing?.photo_path)
    return fail(res, 'Xe hoạt động phải CHỤP ẢNH XE mới được lưu check list', 422)

  const record = {
    forklift_id,
    log_date: date,
    status,
    hour_meter: meter,
    checklist: list,
    issue_count: list.filter(c => !c.ok).length,
    note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : null,
    photo_path: photoPath ?? existing?.photo_path ?? null,   // không ảnh mới = giữ ảnh cũ (upsert gửi null sẽ ĐÈ)
    checked_by: req.user?.name ?? null,
    checked_by_id: req.user?.sub ?? null,
    updated_at: new Date().toISOString(),
  }
  // Upsert theo khóa nghiệp vụ (xe, ngày) — unique constraint chống đua đa-user, ghi lại = đè.
  // KHÔNG đưa `id` vào payload: upsert của PostgREST SET mọi cột gửi lên, kèm id là ĐÈ LUÔN
  // khóa chính mỗi lần ghi lại (id đổi liên tục). Bảng có DEFAULT gen_random_uuid() cho insert.
  const { data, error } = await supabase.from('forklift_daily_logs')
    .upsert(record, { onConflict: 'forklift_id,log_date' })
    .select('id, forklift_id, log_date, status, hour_meter, issue_count').single()
  if (error) return fail(res, error.message, 500)
  // Chụp lại = dọn ảnh cũ (fire-and-forget — orphan không phá gì, đừng làm hỏng response)
  if (photoPath && existing?.photo_path && existing.photo_path !== photoPath)
    void supabase.storage.from(PHOTO_BUCKET).remove([existing.photo_path]).then(() => {}, () => {})
  // Job giữ ảnh 60 ngày — chạy AWAIT (Vercel giết promise treo sau response) nhưng có
  // throttle 6h nên gần như mọi lượt lưu không tốn gì; lỗi dọn không được phá lượt lưu.
  try { await cleanupOldPhotos() } catch (e) { console.error('[forklift] cleanup lỗi:', e) }
  return ok(res, data, 201)
}

// DELETE /wms/forklift-logs/:id — xóa bản ghi (ghi nhầm xe/ngày)
export async function deleteLog(req: Request, res: Response) {
  const { id } = req.params
  const { data: cur } = await supabase.from('forklift_daily_logs')
    .select('id, photo_path, forklift:forklift_vehicles(warehouse_id)').eq('id', id).maybeSingle()
  if (!cur) return fail(res, 'Không tìm thấy bản ghi', 404)
  const scope = scopeWhIds(req)
  const whId = (cur.forklift as unknown as { warehouse_id: string } | null)?.warehouse_id
  if (scope !== null && whId && !scope.includes(whId)) return fail(res, 'Bản ghi ngoài phạm vi kho được gán', 403)
  const { error } = await supabase.from('forklift_daily_logs').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  if (cur.photo_path) void supabase.storage.from(PHOTO_BUCKET).remove([cur.photo_path]).then(() => {}, () => {})
  return ok(res, { id })
}

// GET /wms/forklift-logs/:id — chi tiết 1 bản ghi (dialog xem hạng mục đạt/lỗi)
export async function getLog(req: Request, res: Response) {
  const { id } = req.params
  const { data, error } = await supabase.from('forklift_daily_logs')
    .select('id, forklift_id, log_date, status, hour_meter, checklist, issue_count, note, checked_by, photo_path, created_at, updated_at, forklift:forklift_vehicles(id, code, name, warehouse_id)')
    .eq('id', id).maybeSingle()
  if (error) return fail(res, error.message, 500)
  if (!data) return fail(res, 'Không tìm thấy bản ghi', 404)
  const scope = scopeWhIds(req)
  const whId = (data.forklift as unknown as { warehouse_id: string } | null)?.warehouse_id
  if (scope !== null && whId && !scope.includes(whId)) return fail(res, 'Bản ghi ngoài phạm vi kho được gán', 403)
  const photoUrls = await signPhotoUrls(data.photo_path ? [data.photo_path] : [])
  return ok(res, { ...data, photo_url: data.photo_path ? photoUrls.get(data.photo_path) ?? null : null })
}

// ─── LỊCH SỬ + BÁO CÁO ────────────────────────────────────────────────────────

const MAX_RANGE_DAYS = 92   // chặn + hướng dẫn thu hẹp (không cắt âm thầm) — 3 tháng/lần xem

function parseRange(req: Request): { from: string; to: string } | string {
  const from = isValidDate(req.query.from) ? req.query.from : todayVN()
  const to = isValidDate(req.query.to) ? req.query.to : from
  if (from > to) return 'Khoảng ngày ngược (Từ > Đến)'
  const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400_000
  if (days > MAX_RANGE_DAYS) return `Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày — thu hẹp bộ lọc để xem`
  return { from, to }
}

// GET /wms/forklift-report?from&to&warehouse_id — RPC 1 request trả
// { rows (đã tính hours_run), issue_items (top hạng mục lỗi) }; summary per-xe
// tính trong JS từ chính các dòng đó (không thêm round-trip).
export async function getReport(req: Request, res: Response) {
  const range = parseRange(req)
  if (typeof range === 'string') return fail(res, range, 400)
  const scope = scopeWhIds(req)
  if (scope !== null && scope.length === 0) return ok(res, { ...range, rows: [], summary: [], issue_items: [] })

  // Filter kho từ client: intersect với scope (không tin query thô)
  const qWh = typeof req.query.warehouse_id === 'string' && req.query.warehouse_id ? req.query.warehouse_id : null
  let whIds: string[] | null = scope
  if (qWh) {
    if (scope !== null && !scope.includes(qWh)) return ok(res, { ...range, rows: [], summary: [], issue_items: [] })
    whIds = [qWh]
  }

  const { data, error } = await supabase.rpc('forklift_report', {
    p_from: range.from, p_to: range.to, p_warehouse_ids: whIds,
  })
  if (error) return fail(res, error.message, 500)

  type ReportRow = {
    id: string; forklift_id: string; code: string; forklift_name: string | null; warehouse_id: string
    log_date: string; status: string; hour_meter: number | null; issue_count: number
    checked_by: string | null; note: string | null; checked_at: string
    next_meter: number | null; next_date: string | null; hours_run: number | null
  }
  const payload = (data ?? {}) as { rows?: ReportRow[]; issue_items?: { label: string; cnt: number }[] }
  const rows = payload.rows ?? []
  const issueItems = payload.issue_items ?? []

  // Summary per xe: tổng giờ chạy (chỉ dòng đã chốt), ngày chạy/nghỉ, dòng chưa chốt, lỗi
  const byId = new Map<string, {
    forklift_id: string; code: string; forklift_name: string | null; warehouse_id: string
    total_hours: number; active_days: number; idle_days: number; open_days: number; issue_count: number
    last_meter: number | null; last_date: string | null
  }>()
  for (const r of rows) {
    let s = byId.get(r.forklift_id)
    if (!s) {
      s = { forklift_id: r.forklift_id, code: r.code, forklift_name: r.forklift_name, warehouse_id: r.warehouse_id,
            total_hours: 0, active_days: 0, idle_days: 0, open_days: 0, issue_count: 0, last_meter: null, last_date: null }
      byId.set(r.forklift_id, s)
    }
    if (r.status === 'IDLE') s.idle_days++
    else {
      s.active_days++
      if (r.hours_run === null) s.open_days++
      else s.total_hours = Math.round((s.total_hours + Number(r.hours_run)) * 10) / 10
    }
    s.issue_count += r.issue_count ?? 0
    if (r.hour_meter !== null && (s.last_date === null || r.log_date > s.last_date)) {
      s.last_date = r.log_date
      s.last_meter = r.hour_meter
    }
  }
  const summary = [...byId.values()].sort((a, b) => a.code.localeCompare(b.code))
  return ok(res, { ...range, rows, summary, issue_items: issueItems })
}
