import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { normalizeQR, parseInboundQR } from '../../utils/qrParser'

// ─── SỔ ĐÓNG GÓI ĐIỆN TỬ (11/08/2026) — số hóa sổ đóng gói viết tay tại xưởng ──
// 1 pallet = 1 dòng packing_logs. Quét tem lúc BẮT ĐẦU xếp → mở sổ (OPEN);
// pallet đầy → đóng (CLOSED). GIỜ SẢN XUẤT CHÍNH = giờ in phun trên thùng đầu/cuối
// (FE chụp ảnh + OCR Tesseract tại máy — bậc 0; đọc trượt thì điền tay, ảnh luôn
// lưu làm bằng chứng). Giờ quét/bấm chỉ là giờ THAO TÁC (open_scan_at/close_scan_at).
// Ảnh: bucket riêng tư 'packing-photos' (mẫu forklift-photos) — BE phát signed URL 1h.

const PHOTO_BUCKET = 'packing-photos'
const PHOTO_MAX_BYTES = 4 * 1024 * 1024
const PAGE_MAX = 500

function scopeWhIds(req: Request): string[] | null {
  if (req.user?.warehouse_scope === 'NATIONAL') return null
  return req.user?.warehouse_ids ?? []
}

function decodePhotoDataUrl(raw: unknown): { buf: Buffer; contentType: string; ext: string } | string | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return 'Ảnh không hợp lệ'
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!m) return 'Ảnh phải là JPEG/PNG/WebP (data URL base64)'
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length === 0) return 'Ảnh rỗng'
  if (buf.length > PHOTO_MAX_BYTES) return 'Ảnh quá lớn (tối đa 4MB) — chụp lại'
  const ext = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : m[1]
  return { buf, contentType: `image/${m[1] === 'jpg' ? 'jpeg' : m[1]}`, ext }
}

async function uploadPhoto(logId: string, side: 'start' | 'end', photo: { buf: Buffer; contentType: string; ext: string }): Promise<string | null> {
  const path = `${logId}/${side}-${Date.now()}.${photo.ext}`
  const { error } = await supabase.storage.from(PHOTO_BUCKET)
    .upload(path, photo.buf, { contentType: photo.contentType, upsert: true })
  return error ? null : path
}

async function signPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const uniq = [...new Set(paths.filter(Boolean))]
  if (!uniq.length) return out
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(uniq, 3600)
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  return out
}

// Giờ SX từ client: ISO timestamptz + nguồn (OCR/MANUAL). null = chưa có (điền sau).
function parseProdTime(at: unknown, src: unknown): { at: string | null; src: string | null } | string {
  if (at == null || at === '') return { at: null, src: null }
  if (typeof at !== 'string' || isNaN(new Date(at).getTime())) return 'Giờ sản xuất không hợp lệ (ISO)'
  if (src !== 'OCR' && src !== 'MANUAL') return 'Nguồn giờ phải là OCR hoặc MANUAL'
  return { at: new Date(at).toISOString(), src }
}

type LogRow = {
  id: string; pallet_code: string; material_code: string | null; machine_code: string | null
  warehouse_id: string | null; qty_cartons: number | null; status: string
  photo_start_path: string | null; photo_end_path: string | null
  prod_start_at: string | null; prod_end_at: string | null
  open_scan_at: string; packed_by_name: string | null
}

async function attachPhotoUrls(rows: LogRow[]): Promise<void> {
  const urls = await signPhotoUrls(rows.flatMap(r => [r.photo_start_path, r.photo_end_path]).filter((p): p is string => !!p))
  for (const r of rows as (LogRow & { photo_start_url?: string | null; photo_end_url?: string | null })[]) {
    r.photo_start_url = r.photo_start_path ? urls.get(r.photo_start_path) ?? null : null
    r.photo_end_url = r.photo_end_path ? urls.get(r.photo_end_path) ?? null : null
  }
}

// GET /wms/packing-logs/board — pallet ĐANG MỞ (board theo máy), scope kho null-inclusive
export async function getBoard(req: Request, res: Response) {
  let q = supabase.from('packing_logs').select('*').eq('status', 'OPEN')
    .order('open_scan_at', { ascending: true }).limit(300)
  const scope = scopeWhIds(req)
  if (scope !== null) q = q.or(`warehouse_id.is.null,warehouse_id.in.(${scope.map(s => `"${s}"`).join(',')})`)
  const { data, error } = await q
  if (error) return fail(res, error.message, 500)
  await attachPhotoUrls((data ?? []) as LogRow[])
  return ok(res, data ?? [])
}

// GET /wms/packing-logs — sổ (phân trang server; vài trăm dòng/ngày)
// query: status | date_from/date_to (ngày VN trên open_scan_at) | machine | search | page/pageSize
export async function listLogs(req: Request, res: Response) {
  const { status, date_from, date_to, machine, search } = req.query as Record<string, string | undefined>
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(PAGE_MAX, Math.max(1, parseInt(String(req.query.pageSize ?? '200'), 10) || 200))

  let q = supabase.from('packing_logs').select('*', { count: 'exact' })
  if (status && ['OPEN', 'CLOSED', 'CANCELLED'].includes(status)) q = q.eq('status', status)
  if (date_from && /^\d{4}-\d{2}-\d{2}$/.test(date_from)) q = q.gte('open_scan_at', new Date(`${date_from}T00:00:00+07:00`).toISOString())
  if (date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to)) q = q.lt('open_scan_at', new Date(new Date(`${date_to}T00:00:00+07:00`).getTime() + 86400_000).toISOString())
  if (machine) q = q.eq('machine_code', machine)
  if (search && search.trim()) {
    const term = search.trim().replace(/[%_,()]/g, ' ').slice(0, 60)
    if (term.trim()) q = q.or(`pallet_code.ilike.%${term.trim()}%,material_code.ilike.%${term.trim()}%,packed_by_name.ilike.%${term.trim()}%`)
  }
  const scope = scopeWhIds(req)
  if (scope !== null) q = q.or(`warehouse_id.is.null,warehouse_id.in.(${scope.map(s => `"${s}"`).join(',')})`)

  const from = (page - 1) * pageSize
  const { data, count, error } = await q.order('open_scan_at', { ascending: false }).range(from, from + pageSize - 1)
  if (error) return fail(res, error.message, 500)
  await attachPhotoUrls((data ?? []) as LogRow[])
  return ok(res, { rows: data ?? [], total: count ?? 0, page, pageSize })
}

// POST /wms/packing-logs/open — quét tem lúc BẮT ĐẦU xếp pallet (packing.record)
// body: { qr_code, photo_data?, prod_start_at?, prod_start_src?, ocr_raw? }
export async function openLog(req: Request, res: Response) {
  const { qr_code, photo_data, prod_start_at, prod_start_src, ocr_raw } = req.body as Record<string, unknown>
  if (!qr_code || typeof qr_code !== 'string') return fail(res, 'Thiếu mã QR tem pallet', 400)
  const code = normalizeQR(qr_code)
  const parsed = parseInboundQR(code)
  if (!parsed.is_valid) return fail(res, `Tem không hợp lệ: ${parsed.error ?? 'sai định dạng'}`, 422)

  // Tem đã có dòng sổ SỐNG? → báo rõ thay vì tạo trùng (unique index là hàng rào cuối)
  const { data: existing } = await supabase.from('packing_logs')
    .select('id, status, open_scan_at, packed_by_name').eq('pallet_code', code)
    .neq('status', 'CANCELLED').maybeSingle()
  if (existing) {
    return fail(res, 409, 'ALREADY_LOGGED',
      `Tem này đã ${existing.status === 'OPEN' ? 'MỞ sổ (đang đóng gói)' : 'ĐÓNG sổ'} lúc ${new Date(existing.open_scan_at as string).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}${existing.packed_by_name ? ` bởi ${existing.packed_by_name}` : ''}`)
  }

  // Tra tem in sẵn để tự điền (không có trong lịch sử in vẫn cho mở — tem in đợt cũ)
  const { data: label } = await supabase.from('PalletLabelPrint')
    .select('material_code, material_id, machine, qty, warehouse_id')
    .eq('qr_code', code).order('created_at', { ascending: false }).limit(1).maybeSingle()

  const prod = parseProdTime(prod_start_at, prod_start_at ? prod_start_src : null)
  if (typeof prod === 'string') return fail(res, prod, 422)
  const photo = decodePhotoDataUrl(photo_data)
  if (typeof photo === 'string') return fail(res, photo, 422)

  const id = randomUUID()
  const photoPath = photo ? await uploadPhoto(id, 'start', photo) : null
  if (photo && !photoPath) return fail(res, 'Không lưu được ảnh — thử lại', 500)

  const now = new Date().toISOString()
  const row = {
    id,
    pallet_code: code,
    material_code: label?.material_code ?? parsed.material_code ?? null,
    material_id: label?.material_id ?? null,
    machine_code: (label?.machine as string | null) ?? (parsed.machine_code || null),
    warehouse_id: (label?.warehouse_id as string | null) ?? null,
    qty_cartons: label?.qty ?? null,
    qty_source: 'LABEL',
    status: 'OPEN',
    open_scan_at: now,
    prod_start_at: prod.at,
    prod_start_src: prod.src,
    ocr_start_raw: typeof ocr_raw === 'string' ? ocr_raw.slice(0, 500) : null,
    photo_start_path: photoPath,
    packed_by: req.user?.sub ?? null,
    packed_by_name: req.user?.name ?? null,
    created_at: now,
    updated_at: now,
  }
  const { data, error } = await supabase.from('packing_logs').insert(row).select('*').single()
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'ALREADY_LOGGED', 'Tem này vừa được người khác mở sổ')
    return fail(res, error.message, 500)
  }
  await attachPhotoUrls([data as LogRow])
  return ok(res, data)
}

// POST /wms/packing-logs/:id/close — pallet đầy (packing.record)
// body: { qty_cartons?, photo_data?, prod_end_at?, prod_end_src?, ocr_raw?, note? }
export async function closeLog(req: Request, res: Response) {
  const { id } = req.params
  const { qty_cartons, photo_data, prod_end_at, prod_end_src, ocr_raw, note } = req.body as Record<string, unknown>

  const { data: log } = await supabase.from('packing_logs').select('*').eq('id', id).maybeSingle()
  if (!log) return fail(res, 'Không tìm thấy dòng sổ', 404)
  if (log.status !== 'OPEN') return fail(res, 409, 'NOT_OPEN', `Dòng sổ đang ở trạng thái ${log.status} — chỉ đóng được pallet ĐANG MỞ`)

  let qty: number | null = null
  let qtySource: string | null = null
  if (qty_cartons !== undefined && qty_cartons !== null && qty_cartons !== '') {
    qty = Number(qty_cartons)
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100_000) return fail(res, 'Số thùng phải là số dương hợp lý', 422)
    qtySource = qty === Number(log.qty_cartons) ? (log.qty_source as string) : 'MANUAL'
  }
  const prod = parseProdTime(prod_end_at, prod_end_at ? prod_end_src : null)
  if (typeof prod === 'string') return fail(res, prod, 422)
  if (prod.at && log.prod_start_at && new Date(prod.at) < new Date(log.prod_start_at as string))
    return fail(res, 422, 'TIME_ORDER', 'Giờ SX thùng cuối đang TRƯỚC giờ thùng đầu — kiểm tra lại (qua nửa đêm thì chỉnh ngày)')
  const photo = decodePhotoDataUrl(photo_data)
  if (typeof photo === 'string') return fail(res, photo, 422)
  const photoPath = photo ? await uploadPhoto(id, 'end', photo) : null
  if (photo && !photoPath) return fail(res, 'Không lưu được ảnh — thử lại', 500)

  const now = new Date().toISOString()
  // CAS trên status: 2 người cùng bấm Đóng → chỉ 1 ăn (người sau nhận NOT_OPEN)
  const { data, error } = await supabase.from('packing_logs')
    .update({
      status: 'CLOSED',
      close_scan_at: now,
      ...(qty !== null ? { qty_cartons: qty, qty_source: qtySource } : {}),
      ...(prod.at ? { prod_end_at: prod.at, prod_end_src: prod.src } : {}),
      ...(typeof ocr_raw === 'string' ? { ocr_end_raw: ocr_raw.slice(0, 500) } : {}),
      ...(photoPath ? { photo_end_path: photoPath } : {}),
      ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 500) } : {}),
      updated_at: now,
    })
    .eq('id', id).eq('status', 'OPEN').select('*')
  if (error) return fail(res, error.message, 500)
  if (!data?.length) return fail(res, 409, 'NOT_OPEN', 'Dòng sổ vừa được người khác đóng')
  await attachPhotoUrls(data as LogRow[])
  return ok(res, data[0])
}

// PATCH /wms/packing-logs/:id — sửa sau khi đóng (packing.edit): giờ SX / số thùng / ghi chú.
// Sửa tay ⇒ nguồn chuyển MANUAL (sổ phân biệt được dòng nào máy ghi, dòng nào người can thiệp).
export async function updateLog(req: Request, res: Response) {
  const { id } = req.params
  const { prod_start_at, prod_end_at, qty_cartons, note } = req.body as Record<string, unknown>
  const { data: log } = await supabase.from('packing_logs').select('*').eq('id', id).maybeSingle()
  if (!log) return fail(res, 'Không tìm thấy dòng sổ', 404)
  if (log.status === 'CANCELLED') return fail(res, 409, 'CANCELLED', 'Dòng sổ đã hủy — không sửa được')

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (prod_start_at !== undefined) {
    const p = parseProdTime(prod_start_at, 'MANUAL')
    if (typeof p === 'string') return fail(res, p, 422)
    patch.prod_start_at = p.at; patch.prod_start_src = p.at ? 'MANUAL' : null
  }
  if (prod_end_at !== undefined) {
    const p = parseProdTime(prod_end_at, 'MANUAL')
    if (typeof p === 'string') return fail(res, p, 422)
    patch.prod_end_at = p.at; patch.prod_end_src = p.at ? 'MANUAL' : null
  }
  const s = (patch.prod_start_at ?? log.prod_start_at) as string | null
  const e = (patch.prod_end_at ?? log.prod_end_at) as string | null
  if (s && e && new Date(e) < new Date(s))
    return fail(res, 422, 'TIME_ORDER', 'Giờ SX thùng cuối đang TRƯỚC giờ thùng đầu')
  if (qty_cartons !== undefined) {
    const q = Number(qty_cartons)
    if (!Number.isFinite(q) || q <= 0 || q > 100_000) return fail(res, 'Số thùng phải là số dương hợp lý', 422)
    patch.qty_cartons = q; patch.qty_source = 'MANUAL'
  }
  if (note !== undefined) patch.note = typeof note === 'string' ? note.trim().slice(0, 500) : null

  const { data, error } = await supabase.from('packing_logs').update(patch).eq('id', id).select('*').single()
  if (error) return fail(res, error.message, 500)
  await attachPhotoUrls([data as LogRow])
  return ok(res, data)
}

// POST /wms/packing-logs/:id/cancel — hủy dòng ghi nhầm (packing.cancel); giữ vết, không xóa
export async function cancelLog(req: Request, res: Response) {
  const { id } = req.params
  const { note } = req.body as Record<string, unknown>
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('packing_logs')
    .update({
      status: 'CANCELLED',
      ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 500) } : {}),
      updated_at: now,
    })
    .eq('id', id).neq('status', 'CANCELLED').select('id')
  if (error) return fail(res, error.message, 500)
  if (!data?.length) return fail(res, 'Không tìm thấy dòng sổ (hoặc đã hủy)', 404)
  return ok(res, { id })
}
