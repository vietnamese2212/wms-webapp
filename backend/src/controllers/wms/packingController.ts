import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { normalizeQR, parseInboundQR } from '../../utils/qrParser'
import { fetchAllByIdChunks } from '../../utils/pagination'

// ─── SỔ ĐÓNG GÓI ĐIỆN TỬ (11/08/2026) — số hóa sổ đóng gói viết tay tại xưởng ──
// 1 pallet = 1 dòng packing_logs. Quét tem lúc BẮT ĐẦU xếp → mở sổ (OPEN);
// pallet đầy → đóng (CLOSED). GIỜ SẢN XUẤT CHÍNH = giờ in phun trên thùng đầu/cuối
// (FE chụp ảnh + OCR Tesseract tại máy — bậc 0; đọc trượt thì điền tay, ảnh luôn
// lưu làm bằng chứng). Giờ quét/bấm chỉ là giờ THAO TÁC (open_scan_at/close_scan_at).
// Ảnh: bucket riêng tư 'packing-photos' (mẫu forklift-photos) — BE phát signed URL 1h.

const PHOTO_BUCKET = 'packing-photos'
const PHOTO_MAX_BYTES = 4 * 1024 * 1024
const PAGE_MAX = 500

// Dọn ảnh cũ 60 NGÀY như xe nâng (user chốt 11/08 "xóa tương tự giờ xe nâng") — dọn LƯỜI:
// chạy khi có người ghi sổ, throttle 6h/instance, lô ≤200; xóa storage TRƯỚC rồi mới NULL
// path (lỗi thì chờ lượt sau, không orphan); dòng sổ + giờ SX GIỮ NGUYÊN, chỉ gỡ ảnh.
const PHOTO_RETENTION_DAYS = 60
let _lastPhotoCleanupAt = 0
async function cleanupOldPhotos(): Promise<void> {
  if (Date.now() - _lastPhotoCleanupAt < 6 * 3600_000) return
  _lastPhotoCleanupAt = Date.now()
  const cutoff = new Date(Date.now() - PHOTO_RETENTION_DAYS * 86400_000).toISOString()
  const { data } = await supabase.from('packing_logs')
    .select('id, photo_start_path, photo_end_path')
    .or('photo_start_path.not.is.null,photo_end_path.not.is.null')
    .lt('open_scan_at', cutoff).order('open_scan_at').limit(200)
  const rows = (data ?? []) as { id: string; photo_start_path: string | null; photo_end_path: string | null }[]
  const paths = rows.flatMap(r => [r.photo_start_path, r.photo_end_path]).filter((p): p is string => !!p)
  if (!paths.length) return
  const { error: rmErr } = await supabase.storage.from(PHOTO_BUCKET).remove(paths)
  if (rmErr) { console.error('[packing] dọn ảnh cũ lỗi:', rmErr.message); return }
  await supabase.from('packing_logs').update({ photo_start_path: null, photo_end_path: null })
    .in('id', rows.slice(0, 200).map(r => r.id))   // lô đã limit 200 — bound tường minh (ratchet unpaginated_in_query)
  console.log(`[packing] đã dọn ${paths.length} ảnh cũ hơn ${cutoff.slice(0, 10)}`)
}

function scopeWhIds(req: Request): string[] | null {
  if (req.user?.warehouse_scope === 'NATIONAL') return null
  return req.user?.warehouse_ids ?? []
}

// Ghi theo id phải kiểm KHO CỦA BẢN GHI trong scope người gọi (chống IDOR cross-kho —
// cùng họ lỗ hổng guardEntriesScope đã vá 23/07). null-inclusive như chiều đọc.
function whOutOfScope(req: Request, wh: unknown): boolean {
  const scope = scopeWhIds(req)
  return scope !== null && typeof wh === 'string' && !!wh && !scope.includes(wh)
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
  if (src !== 'AI' && src !== 'OCR' && src !== 'MANUAL') return 'Nguồn giờ phải là AI, OCR hoặc MANUAL'
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

// ĐỐI CHIẾU SX ↔ KHO (13/08): quét ghi sổ = xác nhận LẦN 1 (SX đã sinh pallet), kho quét nhập =
// xác nhận LẦN 2 — pallet "kho đã nhận" = tồn tại InventoryEntry cùng pallet_code (2 chiều đều
// đã normalizeQR nên so bằng thẳng; nhập rồi xuất vẫn tính ĐÃ NHẬN).
async function attachReceived(rows: LogRow[]): Promise<void> {
  const codes = [...new Set(rows.map(r => r.pallet_code))]
  if (!codes.length) return
  const entries = await fetchAllByIdChunks(codes, chunk =>
    supabase.from('InventoryEntry').select('pallet_code, created_at').in('pallet_code', chunk))
  const m = new Map<string, string>()
  for (const e of entries as { pallet_code: string; created_at: string }[]) {
    const cur = m.get(e.pallet_code)
    if (!cur || e.created_at < cur) m.set(e.pallet_code, e.created_at)
  }
  for (const r of rows as (LogRow & { received_at?: string | null })[]) r.received_at = m.get(r.pallet_code) ?? null
}

// GET /wms/packing-logs/board — pallet ĐANG MỞ (board theo máy), scope kho null-inclusive
// ?warehouse_id= lọc theo kho (nhiều nhà máy cùng sản xuất — user chốt 11/08 "tách theo Kho")
export async function getBoard(req: Request, res: Response) {
  let q = supabase.from('packing_logs').select('*').eq('status', 'OPEN')
    .order('open_scan_at', { ascending: true }).limit(300)
  const wh = String(req.query.warehouse_id ?? '')
  if (wh) q = q.eq('warehouse_id', wh)
  const scope = scopeWhIds(req)
  if (scope !== null) q = q.or(`warehouse_id.is.null,warehouse_id.in.(${scope.map(s => `"${s}"`).join(',')})`)
  const { data, error } = await q
  if (error) return fail(res, error.message, 500)
  await attachPhotoUrls((data ?? []) as LogRow[])
  return ok(res, data ?? [])
}

// GET /wms/packing-logs — sổ (phân trang server; vài trăm dòng/ngày)
// query: status | date_from/date_to (ngày VN trên open_scan_at) | machine | search | received (YES/NO) | page/pageSize
// 13/08: đi qua RPC packing_logs_recon — rows + total + đếm ĐÃ/CHƯA kho nhận CÙNG MỘT WHERE
// (filter "chưa nhận" phải join InventoryEntry trong SQL, không lọc được sau phân trang).
export async function listLogs(req: Request, res: Response) {
  const { status, date_from, date_to, machine, search, received } = req.query as Record<string, string | undefined>
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(PAGE_MAX, Math.max(1, parseInt(String(req.query.pageSize ?? '200'), 10) || 200))
  const whF = String(req.query.warehouse_id ?? '')
  // GIỮ dấu `_` — tem pallet V1 đầy `_`; trong LIKE nó là wildcard 1 ký tự nên vẫn khớp nguyên văn
  // (strip `_` như trước = băm nát tem, search tem không bao giờ trúng). RPC nhận term qua PARAM
  // nên không cần sạch cú pháp or-string; chỉ bỏ % (match-all) + backslash (escape).
  const term = search?.trim() ? search.trim().replace(/[%\\]/g, ' ').slice(0, 60).trim() : ''
  const scope = scopeWhIds(req)

  const { data, error } = await supabase.rpc('packing_logs_recon', {
    p_status: status && ['OPEN', 'CLOSED', 'CANCELLED'].includes(status) ? status : null,
    p_wh: whF || null,
    p_scope: scope,   // null = NATIONAL; mảng = null-inclusive trong SQL
    p_from: date_from && /^\d{4}-\d{2}-\d{2}$/.test(date_from) ? new Date(`${date_from}T00:00:00+07:00`).toISOString() : null,
    p_to: date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to) ? new Date(new Date(`${date_to}T00:00:00+07:00`).getTime() + 86400_000).toISOString() : null,
    p_machine: machine || null,
    p_search: term || null,
    p_received: received === 'YES' || received === 'NO' ? received : null,
    p_page: page, p_size: pageSize,
  })
  if (error) return fail(res, error.message, 500)
  const out = (data ?? {}) as { rows?: LogRow[]; total?: number; received_count?: number; missing_count?: number }
  const rows = out.rows ?? []
  await attachPhotoUrls(rows)
  return ok(res, {
    rows, total: out.total ?? 0, page, pageSize,
    received_count: out.received_count ?? 0, missing_count: out.missing_count ?? 0,
  })
}

// POST /wms/packing-logs/open — GHI SỔ 1 PHIÊN (user chốt 11/08 sau test thật: chữ in phun
// nằm mặt BÊN thùng nên pallet xếp xong vẫn chụp được cả thùng đáy — quét tem → chụp thùng
// đầu → chụp thùng cuối → Lưu trong MỘT lần đứng tại pallet).
// body: { qr_code, machine_code?, warehouse_id?, qty_cartons?,               ← sửa được (tem "AP" = máy A hoặc P)
//         photo_data?, prod_start_at?, prod_start_src?, ocr_raw?,            ← thùng ĐẦU
//         photo_end_data?, prod_end_at?, prod_end_src?, ocr_end_raw?,        ← thùng CUỐI
//         complete? }  — true = đóng sổ luôn (CLOSED); false/thiếu = để MỞ, đóng sau từ board
export async function openLog(req: Request, res: Response) {
  const {
    qr_code, machine_code, warehouse_id, qty_cartons, photo_data, prod_start_at, prod_start_src, ocr_raw,
    photo_end_data, prod_end_at, prod_end_src, ocr_end_raw, complete,
  } = req.body as Record<string, unknown>
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

  // ── GATE TRANG SỔ (user chốt 11/08 chiều): quét tem CHỈ được khi có trang sổ đang MỞ
  // khớp MÃ. Pallet kế thừa Kho + Máy của trang (tem in "AP" hết mơ hồ — máy khai ở trang).
  const matCode = (label?.material_code as string | null) ?? parsed.material_code ?? null
  const runIdBody = typeof (req.body as Record<string, unknown>).run_id === 'string'
    ? String((req.body as Record<string, unknown>).run_id) : null
  type RunPick = { id: string; warehouse_id: string; material_code: string; material_codes: string[] | null; machine_code: string; status: string }
  // 13/08: 1 trang sổ ghi được NHIỀU mã (SX chung chu kỳ+máy) — khớp theo MẢNG material_codes
  const codesOf = (r: RunPick) => (r.material_codes?.length ? r.material_codes : [r.material_code])
  let run: RunPick | null = null
  if (runIdBody) {
    const { data: r } = await supabase.from('packing_runs')
      .select('id, warehouse_id, material_code, material_codes, machine_code, status').eq('id', runIdBody).maybeSingle()
    if (!r) return fail(res, 'Không tìm thấy trang sổ', 404)
    if (r.status !== 'OPEN') return fail(res, 409, 'RUN_NOT_OPEN', 'Trang sổ này đã đóng/hủy — chọn trang đang mở')
    if (matCode && !codesOf(r).includes(matCode))
      return fail(res, 422, 'RUN_MATERIAL_MISMATCH', `Tem mã ${matCode} không khớp trang sổ (mã ${codesOf(r).join(', ')})`)
    run = r
  } else {
    let rq = supabase.from('packing_runs')
      .select('id, warehouse_id, material_code, material_codes, machine_code, status').eq('status', 'OPEN').limit(10)
    if (matCode) rq = rq.contains('material_codes', [matCode])
    const scopePre = scopeWhIds(req)
    if (scopePre !== null) rq = rq.in('warehouse_id', scopePre.slice(0, 300))
    const { data: candidates } = await rq
    if (!candidates?.length)
      return fail(res, 422, 'RUN_REQUIRED', `Chưa mở trang sổ cho mã ${matCode ?? '?'} — người có quyền phải "Mở trang sổ" (khai Kho/Ca/Máy) trước khi quét tem`)
    if (candidates.length > 1)
      return fail(res, 409, 'RUN_AMBIGUOUS', `Mã ${matCode ?? '?'} đang mở ${candidates.length} trang sổ (khác máy/kho) — chọn trang sổ trước khi quét`)
    run = candidates[0]
  }

  const prodS = parseProdTime(prod_start_at, prod_start_at ? prod_start_src : null)
  if (typeof prodS === 'string') return fail(res, prodS, 422)
  const prodE = parseProdTime(prod_end_at, prod_end_at ? prod_end_src : null)
  if (typeof prodE === 'string') return fail(res, prodE, 422)
  if (prodS.at && prodE.at && new Date(prodE.at) < new Date(prodS.at))
    return fail(res, 422, 'TIME_ORDER', 'Giờ SX thùng cuối đang TRƯỚC giờ thùng đầu — kiểm tra lại (qua nửa đêm thì chỉnh ngày)')
  const photoS = decodePhotoDataUrl(photo_data)
  if (typeof photoS === 'string') return fail(res, photoS, 422)
  const photoE = decodePhotoDataUrl(photo_end_data)
  if (typeof photoE === 'string') return fail(res, photoE, 422)

  // Máy + Kho KẾ THỪA từ trang sổ (khai lúc mở trang — tem "AP" hết mơ hồ); vẫn nhận
  // machine_code override từ body cho ca đặc biệt. Kho của trang phải trong scope người quét.
  const machine = typeof machine_code === 'string' && machine_code.trim()
    ? machine_code.trim().toUpperCase().slice(0, 10)
    : (run?.machine_code ?? (label?.machine as string | null) ?? (parsed.machine_code || null))
  const wh = run?.warehouse_id
    ?? (typeof warehouse_id === 'string' && warehouse_id.trim() ? warehouse_id.trim() : ((label?.warehouse_id as string | null) ?? null))
  const scope = scopeWhIds(req)
  if (wh && scope !== null && !scope.includes(wh)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
  let qty: number | null = label?.qty ?? null
  let qtySource = 'LABEL'
  if (qty_cartons !== undefined && qty_cartons !== null && qty_cartons !== '') {
    const q = Number(qty_cartons)
    if (!Number.isFinite(q) || q <= 0 || q > 100_000) return fail(res, 'Số thùng phải là số dương hợp lý', 422)
    if (q !== Number(qty ?? 0)) qtySource = 'MANUAL'
    qty = q
  }

  const id = randomUUID()
  const photoPathS = photoS ? await uploadPhoto(id, 'start', photoS) : null
  const photoPathE = photoE ? await uploadPhoto(id, 'end', photoE) : null
  if ((photoS && !photoPathS) || (photoE && !photoPathE)) return fail(res, 'Không lưu được ảnh — thử lại', 500)

  const isComplete = complete === true
  const now = new Date().toISOString()
  const row = {
    id,
    pallet_code: code,
    run_id: run?.id ?? null,
    material_code: matCode,
    material_id: label?.material_id ?? null,
    machine_code: machine,
    warehouse_id: wh,
    qty_cartons: qty,
    qty_source: qtySource,
    status: isComplete ? 'CLOSED' : 'OPEN',
    open_scan_at: now,
    close_scan_at: isComplete ? now : null,
    prod_start_at: prodS.at,
    prod_start_src: prodS.src,
    ocr_start_raw: typeof ocr_raw === 'string' ? ocr_raw.slice(0, 500) : null,
    photo_start_path: photoPathS,
    prod_end_at: prodE.at,
    prod_end_src: prodE.src,
    ocr_end_raw: typeof ocr_end_raw === 'string' ? ocr_end_raw.slice(0, 500) : null,
    photo_end_path: photoPathE,
    packed_by: req.user?.sub ?? null,
    packed_by_name: req.user?.name ?? null,
    created_at: now,
    updated_at: now,
  }
  const { data, error } = await supabase.from('packing_logs').insert(row).select('*').single()
  if (error) {
    if (error.code === '23505') return fail(res, 409, 'ALREADY_LOGGED', 'Tem này vừa được người khác ghi sổ')
    return fail(res, error.message, 500)
  }
  try { await cleanupOldPhotos() } catch (e) { console.error('[packing] cleanup lỗi:', e) }
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
  if (whOutOfScope(req, log.warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
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
  if (whOutOfScope(req, log.warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
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

// ═══ TRANG SỔ ĐÓNG GÓI (packing_runs — user chốt 11/08 chiều) ═══════════════════
// 1 dòng = 1 TRANG SẢN PHẨM trong sổ viết tay: Kho + Ngày + Ca + Chu kỳ + Mã + Máy +
// Giờ bắt đầu; bấm "Giờ kết thúc" → CLOSED + tính TỔNG SẢN LƯỢNG = Σ thùng pallet đã ghi.
// Quét tem chỉ được khi trang đang MỞ (gate ở openLog). Quyền: packing.open_run.

type RunAgg = { pallet_count: number; pallet_open: number; qty_sum: number }

// Σ thùng + đếm pallet SỐNG (không tính CANCELLED) của các trang — dùng cho board/list/close
async function aggRuns(runIds: string[]): Promise<Map<string, RunAgg & { pallets: LogRow[] }>> {
  const out = new Map<string, RunAgg & { pallets: LogRow[] }>()
  if (!runIds.length) return out
  const logs = await fetchAllByIdChunks(runIds, chunk =>
    supabase.from('packing_logs').select('*').in('run_id', chunk).neq('status', 'CANCELLED').order('open_scan_at'))
  for (const l of logs as (LogRow & { run_id: string })[]) {
    const a = out.get(l.run_id) ?? { pallet_count: 0, pallet_open: 0, qty_sum: 0, pallets: [] }
    a.pallet_count++
    if (l.status === 'OPEN') a.pallet_open++
    a.qty_sum += Number(l.qty_cartons ?? 0)
    a.pallets.push(l)
    out.set(l.run_id, a)
  }
  return out
}

// GET /wms/packing-runs/board — trang đang MỞ + pallet của từng trang (packing.view)
export async function getRunBoard(req: Request, res: Response) {
  let q = supabase.from('packing_runs').select('*').eq('status', 'OPEN')
    .order('start_at', { ascending: true }).limit(200)
  const wh = String(req.query.warehouse_id ?? '')
  if (wh) q = q.eq('warehouse_id', wh)
  const scope = scopeWhIds(req)
  if (scope !== null) q = q.in('warehouse_id', scope.slice(0, 300))
  const { data, error } = await q
  if (error) return fail(res, error.message, 500)
  const runs = data ?? []
  const agg = await aggRuns(runs.map(r => r.id as string))
  const allPallets = [...agg.values()].flatMap(a => a.pallets)
  await attachPhotoUrls(allPallets)
  return ok(res, runs.map(r => {
    const a = agg.get(r.id as string)
    return { ...r, pallet_count: a?.pallet_count ?? 0, pallet_open: a?.pallet_open ?? 0, qty_total: a?.qty_sum ?? 0, pallets: a?.pallets ?? [] }
  }))
}

// GET /wms/packing-runs/:id — detail 1 trang: thông tin + toàn bộ pallet (packing.view)
export async function getRun(req: Request, res: Response) {
  const { id } = req.params
  const { data: run } = await supabase.from('packing_runs').select('*').eq('id', id).maybeSingle()
  if (!run) return fail(res, 'Không tìm thấy trang sổ', 404)
  const scope = scopeWhIds(req)
  if (scope !== null && !scope.includes(run.warehouse_id as string)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
  const agg = await aggRuns([id])
  const a = agg.get(id)
  await attachPhotoUrls(a?.pallets ?? [])
  await attachReceived(a?.pallets ?? [])   // đối chiếu: pallet nào kho ĐÃ quét nhập (xác nhận lần 2)
  const live = run.status === 'OPEN'
  return ok(res, {
    ...run,
    pallet_count: live ? (a?.pallet_count ?? 0) : (run.pallet_count ?? a?.pallet_count ?? 0),
    qty_total: live ? (a?.qty_sum ?? 0) : (run.qty_total ?? a?.qty_sum ?? 0),
    pallet_open: a?.pallet_open ?? 0,
    pallets: a?.pallets ?? [],
  })
}

// GET /wms/packing-runs — tra cứu sổ theo TRANG (phân trang server)
export async function listRuns(req: Request, res: Response) {
  const { status, date_from, date_to, machine, material_code, search } = req.query as Record<string, string | undefined>
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
  const pageSize = Math.min(PAGE_MAX, Math.max(1, parseInt(String(req.query.pageSize ?? '200'), 10) || 200))

  let q = supabase.from('packing_runs').select('*', { count: 'exact' })
  if (status && ['OPEN', 'CLOSED', 'CANCELLED'].includes(status)) q = q.eq('status', status)
  const whF = String(req.query.warehouse_id ?? '')
  if (whF) q = q.eq('warehouse_id', whF)
  if (date_from && /^\d{4}-\d{2}-\d{2}$/.test(date_from)) q = q.gte('run_date', date_from)
  if (date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to)) q = q.lte('run_date', date_to)
  if (machine) q = q.eq('machine_code', machine)
  if (material_code) q = q.eq('material_code', material_code)
  if (search && search.trim()) {
    // GIỮ `_` (tem V1) — nó chỉ là wildcard 1 ký tự trong ilike; vẫn strip ký tự phá cú pháp .or()
    const term = search.trim().replace(/[%,(){}\\]/g, ' ').slice(0, 60).trim()
    if (term) {
      const orParts = [
        `material_code.ilike.%${term}%`,
        `material_codes.cs.{${term.toUpperCase()}}`,   // mã PHỤ trong trang nhiều mã — khớp nguyên phần tử
        `cycle.ilike.%${term}%`,
        `opened_by_name.ilike.%${term}%`,
      ]
      // TEM PALLET → trang sổ chứa nó (user 13/08): tra dòng sổ theo tem trước, đưa run_id vào or
      const { data: palletHits } = await supabase.from('packing_logs').select('run_id')
        .ilike('pallet_code', `%${term}%`).not('run_id', 'is', null).limit(50)
      const runIds = [...new Set((palletHits ?? []).map(h => h.run_id as string))]
      if (runIds.length) orParts.push(`id.in.(${runIds.join(',')})`)
      q = q.or(orParts.join(','))
    }
  }
  const scope = scopeWhIds(req)
  if (scope !== null) q = q.in('warehouse_id', scope.slice(0, 300))

  const from = (page - 1) * pageSize
  const { data, count, error } = await q.order('run_date', { ascending: false })
    .order('start_at', { ascending: false }).range(from, from + pageSize - 1)
  if (error) return fail(res, error.message, 500)
  // GỘP THEO SỔ (user chốt 11/08 chiều): trả kèm pallet của từng trang trên trang hiện tại
  // (FE render bảng nhóm dòng). Trang MỞ → tổng tính SỐNG; trang ĐÓNG giữ số đã chốt.
  const rows = data ?? []
  const agg = await aggRuns(rows.map(r => r.id as string))
  const allPallets = [...agg.values()].flatMap(a => a.pallets)
  await attachPhotoUrls(allPallets)
  for (const r of rows) {
    const a = agg.get(r.id as string)
    ;(r as Record<string, unknown>).pallets = a?.pallets ?? []
    ;(r as Record<string, unknown>).pallet_open = a?.pallet_open ?? 0
    if (r.status === 'OPEN' && a) { r.qty_total = a.qty_sum; r.pallet_count = a.pallet_count }
    else if (a && r.pallet_count == null) { r.qty_total = r.qty_total ?? a.qty_sum; r.pallet_count = a.pallet_count }
  }
  return ok(res, { rows, total: count ?? 0, page, pageSize })
}

// POST /wms/packing-runs — MỞ TRANG SỔ (packing.open_run)
// body: { warehouse_id, run_date?, shift?, cycle?, material_codes[] (hoặc material_code cũ),
//         material_id?, machine_code, start_at?, note? }
// 13/08: 1 trang ghi NHIỀU mã (SX chung chu kỳ+máy) — insert qua RPC packing_open_run
// (advisory lock per kho+máy chặn 2 trang MỞ có mã GIAO NHAU; unique index cũ chỉ bắt mã đầu).
export async function openRun(req: Request, res: Response) {
  const { warehouse_id, run_date, shift, cycle, material_code, material_codes, material_id, machine_code, start_at, note } = req.body as Record<string, unknown>
  const codes = Array.isArray(material_codes)
    ? material_codes.filter((c): c is string => typeof c === 'string' && !!c.trim()).map(c => c.trim())
    : (typeof material_code === 'string' && material_code.trim() ? [material_code.trim()] : [])
  if (!warehouse_id || typeof warehouse_id !== 'string') return fail(res, 'Chọn Kho / Nhà máy', 422)
  if (!codes.length) return fail(res, 'Chọn Mã sản phẩm', 422)
  if (codes.length > 10) return fail(res, 'Tối đa 10 mã / 1 trang sổ', 422)
  if (!machine_code || typeof machine_code !== 'string' || !machine_code.trim()) return fail(res, 'Nhập Máy', 422)
  const scope = scopeWhIds(req)
  if (scope !== null && !scope.includes(warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
  const dateVN = typeof run_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(run_date)
    ? run_date : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
  let startIso = new Date().toISOString()
  if (start_at != null && start_at !== '') {
    if (typeof start_at !== 'string' || isNaN(new Date(start_at).getTime())) return fail(res, 'Giờ bắt đầu không hợp lệ', 422)
    startIso = new Date(start_at).toISOString()
  }
  const { data, error } = await supabase.rpc('packing_open_run', {
    p: {
      warehouse_id,
      run_date: dateVN,
      shift: typeof shift === 'string' ? shift : null,
      cycle: typeof cycle === 'string' ? cycle : null,
      material_codes: codes,
      material_id: typeof material_id === 'string' && material_id ? material_id : null,
      machine_code: machine_code.trim(),
      start_at: startIso,
      opened_by: req.user?.sub ?? null,
      opened_by_name: req.user?.name ?? null,
      note: typeof note === 'string' ? note : null,
    },
  })
  if (error) {
    const m = error.message ?? ''
    if (m.includes('PACKDUP:')) return fail(res, 409, 'RUN_DUP', m.split('PACKDUP:')[1])
    if (m.includes('PACKOPEN:')) return fail(res, m.split('PACKOPEN:')[1], 422)
    if (error.code === '23505')
      return fail(res, 409, 'RUN_DUP', 'Đã có trang sổ ĐANG MỞ cho Kho + Mã + Máy này — dùng trang đó hoặc đóng trước rồi mở trang mới')
    return fail(res, m, 500)
  }
  return ok(res, data)
}

// POST /wms/packing-runs/:id/close — bấm "GIỜ KẾT THÚC" → CLOSED + TÍNH TỔNG SẢN LƯỢNG
// body: { end_at? } — mặc định giờ bấm. CAS trên status: 2 người cùng bấm → 1 ăn.
export async function closeRun(req: Request, res: Response) {
  const { id } = req.params
  const { end_at } = req.body as Record<string, unknown>
  const { data: run } = await supabase.from('packing_runs').select('*').eq('id', id).maybeSingle()
  if (!run) return fail(res, 'Không tìm thấy trang sổ', 404)
  if (whOutOfScope(req, run.warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
  if (run.status !== 'OPEN') return fail(res, 409, 'RUN_NOT_OPEN', `Trang sổ đang ở trạng thái ${run.status}`)
  let endIso = new Date().toISOString()
  if (end_at != null && end_at !== '') {
    if (typeof end_at !== 'string' || isNaN(new Date(end_at).getTime())) return fail(res, 'Giờ kết thúc không hợp lệ', 422)
    endIso = new Date(end_at).toISOString()
  }
  if (new Date(endIso) < new Date(run.start_at as string))
    return fail(res, 422, 'TIME_ORDER', 'Giờ kết thúc đang TRƯỚC giờ bắt đầu — kiểm tra lại (qua nửa đêm thì chỉnh ngày)')

  const agg = await aggRuns([id])
  const a = agg.get(id)
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('packing_runs')
    .update({
      status: 'CLOSED',
      end_at: endIso,
      qty_total: a?.qty_sum ?? 0,
      pallet_count: a?.pallet_count ?? 0,
      closed_by: req.user?.sub ?? null,
      closed_by_name: req.user?.name ?? null,
      updated_at: now,
    })
    .eq('id', id).eq('status', 'OPEN').select('*')
  if (error) return fail(res, error.message, 500)
  if (!data?.length) return fail(res, 409, 'RUN_NOT_OPEN', 'Trang sổ vừa được người khác đóng')
  return ok(res, { ...data[0], pallet_open: a?.pallet_open ?? 0 })
}

// PATCH /wms/packing-runs/:id — sửa trang (ca/chu kỳ/máy/giờ/tổng/ghi chú) — packing.open_run
export async function updateRun(req: Request, res: Response) {
  const { id } = req.params
  const { shift, cycle, machine_code, start_at, end_at, qty_total, note } = req.body as Record<string, unknown>
  const { data: run } = await supabase.from('packing_runs').select('*').eq('id', id).maybeSingle()
  if (!run) return fail(res, 'Không tìm thấy trang sổ', 404)
  if (whOutOfScope(req, run.warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
  if (run.status === 'CANCELLED') return fail(res, 409, 'CANCELLED', 'Trang sổ đã hủy — không sửa được')

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (shift !== undefined) patch.shift = typeof shift === 'string' && shift.trim() ? shift.trim().slice(0, 40) : null
  if (cycle !== undefined) patch.cycle = typeof cycle === 'string' && cycle.trim() ? cycle.trim().slice(0, 40) : null
  if (machine_code !== undefined) {
    if (typeof machine_code !== 'string' || !machine_code.trim()) return fail(res, 'Máy không được trống', 422)
    patch.machine_code = machine_code.trim().toUpperCase().slice(0, 10)
  }
  for (const [k, v] of [['start_at', start_at], ['end_at', end_at]] as const) {
    if (v === undefined) continue
    if (v === null || v === '') { if (k === 'end_at') patch.end_at = null; continue }   // giờ bắt đầu không cho xóa trống
    if (typeof v !== 'string' || isNaN(new Date(v).getTime())) return fail(res, `Giờ ${k === 'start_at' ? 'bắt đầu' : 'kết thúc'} không hợp lệ`, 422)
    patch[k] = new Date(v).toISOString()
  }
  const s = (patch.start_at ?? run.start_at) as string
  const e = (patch.end_at !== undefined ? patch.end_at : run.end_at) as string | null
  if (s && e && new Date(e) < new Date(s)) return fail(res, 422, 'TIME_ORDER', 'Giờ kết thúc đang TRƯỚC giờ bắt đầu')
  if (qty_total !== undefined) {
    const q = Number(qty_total)
    if (!Number.isFinite(q) || q < 0 || q > 10_000_000) return fail(res, 'Tổng sản lượng phải là số không âm hợp lý', 422)
    patch.qty_total = q
  }
  if (note !== undefined) patch.note = typeof note === 'string' ? note.trim().slice(0, 500) : null

  const { data, error } = await supabase.from('packing_runs').update(patch).eq('id', id).select('*').single()
  if (error) return fail(res, error.message, 500)
  return ok(res, data)
}

// POST /wms/packing-runs/:id/cancel — hủy trang mở nhầm; CHẶN khi đã có pallet ghi vào
export async function cancelRun(req: Request, res: Response) {
  const { id } = req.params
  const { note } = req.body as Record<string, unknown>
  const { data: run } = await supabase.from('packing_runs').select('id, warehouse_id').eq('id', id).maybeSingle()
  if (!run) return fail(res, 'Không tìm thấy trang sổ', 404)
  if (whOutOfScope(req, run.warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
  const { count } = await supabase.from('packing_logs')
    .select('id', { count: 'exact', head: true }).eq('run_id', id).neq('status', 'CANCELLED')
  if ((count ?? 0) > 0)
    return fail(res, 409, 'RUN_HAS_PALLETS', `Trang sổ đã có ${count} pallet ghi vào — hủy từng pallet trước, hoặc bấm Giờ kết thúc để đóng trang`)
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('packing_runs')
    .update({
      status: 'CANCELLED',
      ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 500) } : {}),
      updated_at: now,
    })
    .eq('id', id).neq('status', 'CANCELLED').select('id')
  if (error) return fail(res, error.message, 500)
  if (!data?.length) return fail(res, 'Không tìm thấy trang sổ (hoặc đã hủy)', 404)
  return ok(res, { id })
}

// POST /wms/packing-logs/:id/cancel — hủy dòng ghi nhầm (packing.cancel); giữ vết, không xóa
export async function cancelLog(req: Request, res: Response) {
  const { id } = req.params
  const { note } = req.body as Record<string, unknown>
  const { data: log } = await supabase.from('packing_logs').select('id, warehouse_id').eq('id', id).maybeSingle()
  if (!log) return fail(res, 'Không tìm thấy dòng sổ', 404)
  if (whOutOfScope(req, log.warehouse_id)) return fail(res, 'Kho ngoài phạm vi được gán', 403)
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
