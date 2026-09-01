// TRUY XUẤT LÔ — trả lời "lô này đã đi tới đâu" và "khách này đã nhận lô nào" (28/08).
//
// Toàn bộ phép nối nằm trong RPC `lot_trace` (migration 20260828b): MỘT lời gọi trả cả danh sách
// giao, tồn còn lại và ô tổng — không trả id để backend nạp lại (luật round-trip trong CLAUDE.md).
// Scope kho + loại hàng đẩy XUỐNG RPC chứ không lọc lại ở Node: lọc ở Node nghĩa là đã kéo về
// những dòng người dùng không được xem.
import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { maskServerMessage } from '../../utils/response'
import { scopeCategoriesOf, categoryAllowed } from '../../utils/categoryScope'
import { isUuid } from '../../utils/ids'
import { normCycleCode } from './packingController'

const ok = (res: Response, data: unknown) => res.json({ success: true, data })
const fail = (res: Response, message: string, status = 500, code = 'TRACE_ERROR') =>
  res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status, res) } })

/** Kho user được phép xem; null = không giới hạn (superadmin / NATIONAL). */
function scopeWhIds(req: Request): string[] | null {
  if (req.user?.is_superadmin === true || req.user?.warehouse_scope === 'NATIONAL') return null
  const ids = req.user?.warehouse_ids ?? []
  return ids.length ? ids : null
}

const KINDS = ['pallet', 'material', 'batch', 'npp', 'trip', 'plate'] as const
type Kind = typeof KINDS[number]
const isKind = (v: string): v is Kind => (KINDS as readonly string[]).includes(v)

/**
 * 'YYYY-MM-DD' hoặc rỗng → null. Ngày rác trả undefined để báo 400 thay vì để Postgres ném 22007.
 *
 * ⚠️ Kiểm DẠNG thôi là chưa đủ — `2026-13-45` khớp regex nhưng xuống Postgres là **22008
 * "date/time field value out of range" ⇒ 500** (đo thật 30/08 bằng fuzz tham số). Đúng cái bẫy
 * CLAUDE.md đã ghi và `warehouseCostController.monthOf` đã học, nhưng file này viết sau lại vấp
 * lại. 500 rác vừa báo sai cho người dùng, vừa làm rule cảnh báo "lỗi BE 24h" kêu oan.
 * Nên kiểm LỊCH thật: dựng Date theo UTC rồi soi có bị cuộn sang ngày khác không (31/02 → 03/03).
 */
function dayOf(v: unknown): string | null | undefined {
  const s = String(v ?? '').trim()
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined
  return s
}

export async function lotTrace(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    const kind = String(q.kind ?? '').trim()
    const value = String(q.value ?? '').trim()
    if (!isKind(kind)) return fail(res, `Kiểu tìm không hợp lệ (${KINDS.join(' | ')})`, 400, 'BAD_KIND')
    if (!value) return fail(res, 'Thiếu giá trị cần truy xuất', 400, 'BAD_VALUE')
    // Tiền tố quá ngắn quét ra gần như cả kho — chặn sớm thay vì để người dùng chờ rồi nhận 2.000 dòng
    if (kind === 'pallet' && value.length < 4)
      return fail(res, 'Mã pallet cần ít nhất 4 ký tự (vd 190726 = ngày sản xuất)', 400, 'BAD_VALUE')

    const dates = {
      prod_from: dayOf(q.prod_from), prod_to: dayOf(q.prod_to),
      ship_from: dayOf(q.ship_from), ship_to: dayOf(q.ship_to),
    }
    for (const [k, v] of Object.entries(dates))
      if (v === undefined) return fail(res, `Ngày không hợp lệ ở "${k}" (cần YYYY-MM-DD)`, 400, 'BAD_DATE')

    const limit = Math.min(2000, Math.max(50, Number(q.limit) || 500))
    const { data, error } = await supabase.rpc('lot_trace', {
      p_kind: kind, p_value: value,
      p_prod_from: dates.prod_from, p_prod_to: dates.prod_to,
      p_ship_from: dates.ship_from, p_ship_to: dates.ship_to,
      p_wh_ids: scopeWhIds(req), p_categories: scopeCategoriesOf(req),
      p_limit: limit,
    })
    if (error) return fail(res, error.message)
    return ok(res, data ?? {})
  } catch (e) { return fail(res, String(e)) }
}

// ─── CHẤT LƯỢNG PHỤC VỤ: giao ĐỦ và giao ĐÚNG HẠN (28/08) ──────────────────────────────────────
// App đo rất kỹ sản lượng/năng suất/chi phí — toàn chỉ số NỘI BỘ — mà không đo cái KHÁCH HÀNG
// nhìn thấy. Toàn bộ phép tính nằm trong RPC `service_level` (migration 20260828d).
export async function serviceLevel(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    const from = dayOf(q.from), to = dayOf(q.to)
    if (from === undefined || to === undefined)
      return fail(res, 'Ngày không hợp lệ (cần YYYY-MM-DD)', 400, 'BAD_DATE')
    if (!from || !to) return fail(res, 'Thiếu khoảng ngày (from, to)', 400, 'BAD_RANGE')
    if (to < from) return fail(res, 'Ngày "đến" phải sau ngày "từ"', 400, 'BAD_RANGE')

    // Ô chọn Kho của Dashboard phải ăn vào tab này như các tab khác — nhưng LỌC LÀ LỌC, không
    // được nới scope: kho ngoài phạm vi được phân quyền là 403, không âm thầm trả dữ liệu kho khác.
    const scope = scopeWhIds(req)
    const wh = String(q.warehouse_id ?? '').trim()
    if (wh && !isUuid(wh)) return fail(res, 'Mã kho không hợp lệ', 400, 'BAD_WAREHOUSE')
    if (wh && scope !== null && !scope.includes(wh))
      return fail(res, 'Kho không thuộc phạm vi được phân quyền', 403, 'WAREHOUSE_OUT_OF_SCOPE')

    const { data, error } = await supabase.rpc('service_level', {
      p_from: from, p_to: to, p_wh_ids: wh ? [wh] : scope, p_limit: 20,
    })
    if (error) return fail(res, error.message)
    return ok(res, data ?? {})
  } catch (e) { return fail(res, String(e)) }
}

// ─── ĐIỀU TRA TRUY VẾT THEO THÙNG (01/09, user chốt) ────────────────────────────────────────────
// Khiếu nại đến từ MỘT THÙNG khách đang cầm — trên thùng chỉ có chữ in phun (giờ phút, ngày SX).
// Nhập giờ thùng + mã hàng (+ máy, chu kỳ nếu biết) → đối chiếu SỔ ĐÓNG GÓI (packing_logs lưu
// khoảng giờ SX thùng đầu→thùng cuối của TỪNG pallet) → pallet nghi vấn → truy "đã giao khách nào"
// bằng chính RPC lot_trace (kind='codes'). Kết quả + ảnh + người thực hiện lưu thành HỒ SƠ.
// User chốt: chỉ khớp ĐÚNG khoảng giờ (không nới ±) — không có pallet chứa giờ đó là trả rỗng.

const TRACE_PHOTO_BUCKET = 'trace-photos'
const TRACE_PHOTO_MAX_BYTES = 4 * 1024 * 1024
const TRACE_PHOTO_MAX_COUNT = 6

function decodePhotoDataUrl(raw: unknown): { buf: Buffer; contentType: string; ext: string } | string {
  if (typeof raw !== 'string' || raw === '') return 'Ảnh không hợp lệ'
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!m) return 'Ảnh phải là JPEG/PNG/WebP (data URL base64)'
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length === 0) return 'Ảnh rỗng'
  if (buf.length > TRACE_PHOTO_MAX_BYTES) return 'Ảnh quá lớn (tối đa 4MB) — nén lại trước khi gửi'
  const ext = m[1] === 'jpeg' || m[1] === 'jpg' ? 'jpg' : m[1]
  return { buf, contentType: `image/${m[1] === 'jpg' ? 'jpeg' : m[1]}`, ext }
}

/** 'YYYY-MM-DD' + 'HH:MM(:SS)' giờ VN → ISO UTC; undefined nếu không hợp lệ. */
function cartonAtOf(dateRaw: unknown, timeRaw: unknown): string | undefined {
  const d = dayOf(dateRaw)
  if (!d) return undefined
  const t = String(timeRaw ?? '').trim()
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(t)
  if (!m) return undefined
  return new Date(`${d}T${m[1]}:${m[2]}:${m[3] ?? '00'}+07:00`).toISOString()
}

type CartonMatchRow = {
  pallet_code: string; material_code: string; machine_code: string | null
  warehouse_id: string | null; qty_cartons: number | null
  prod_start_at: string | null; prod_end_at: string | null
  packed_by_name: string | null; status: string
  run: { id: string; run_date: string | null; shift: string | null; cycle: string | null; status: string } | null
}

/** Khớp sổ đóng gói: pallet có [giờ thùng đầu, giờ thùng cuối] CHỨA đúng thời điểm nhập. */
async function matchCarton(req: Request, p: {
  carton_at: string; material_code: string; machine_code?: string; cycle?: string
}): Promise<CartonMatchRow[] | string> {
  let qb = supabase.from('packing_logs')
    .select('pallet_code, material_code, machine_code, warehouse_id, qty_cartons, prod_start_at,'
      + ' prod_end_at, packed_by_name, status, run:packing_runs(id, run_date, shift, cycle, status)')
    .eq('material_code', p.material_code)
    .neq('status', 'CANCELLED')
    .lte('prod_start_at', p.carton_at)
    .gte('prod_end_at', p.carton_at)
    .order('prod_start_at')
    .limit(200)
  if (p.machine_code) qb = qb.eq('machine_code', p.machine_code)
  const { data, error } = await qb
  if (error) return error.message
  let rows = (data ?? []) as unknown as CartonMatchRow[]
  // Chu kỳ so DẠNG CHUẨN ("055" ≡ "55") — không đẩy xuống filter PostgREST được nên lọc ở đây
  if (p.cycle) {
    const want = normCycleCode(p.cycle)
    rows = rows.filter(r => r.run?.cycle != null && normCycleCode(String(r.run.cycle)) === want)
  }
  // Scope kho (null-inclusive) — tập khớp đã nhỏ nên lọc tại chỗ, không nhồi id vào URL
  const whIds = scopeWhIds(req)
  if (whIds !== null) rows = rows.filter(r => r.warehouse_id == null || whIds.includes(r.warehouse_id))
  return rows
}

/** Guard scope loại hàng cho mã đang điều tra (null-inclusive như toàn app). */
async function materialCategoryAllowed(req: Request, materialCode: string): Promise<boolean> {
  const { data } = await supabase.from('Material')
    .select('category').eq('material_code', materialCode).limit(1).maybeSingle()
  return categoryAllowed(req, (data as { category?: string | null } | null)?.category ?? null)
}

type InvestigateInput = {
  carton_at: string; material_code: string; machine_code?: string; cycle?: string
}

function parseInvestigateInput(req: Request): InvestigateInput | { err: string; code: string } {
  const b = req.body as Record<string, unknown>
  const carton_at = cartonAtOf(b.carton_date, b.carton_time)
  if (!carton_at) return { err: 'Cần ngày (YYYY-MM-DD) và giờ (HH:MM hoặc HH:MM:SS) in trên thùng', code: 'BAD_TIME' }
  const material_code = String(b.material_code ?? '').trim()
  if (!material_code) return { err: 'Thiếu mã hàng', code: 'BAD_MATERIAL' }
  const machine_code = String(b.machine_code ?? '').trim() || undefined
  const cycle = String(b.cycle ?? '').trim() || undefined
  return { carton_at, material_code, machine_code, cycle }
}

type InvErr = { err: string; code: string; status: number }
type InvOk = { matched: CartonMatchRow[]; trace: unknown }

async function runInvestigation(req: Request, input: InvestigateInput): Promise<InvErr | InvOk> {
  if (!(await materialCategoryAllowed(req, input.material_code)))
    return { err: 'Mã hàng ngoài phạm vi loại hàng được phân quyền', code: 'CATEGORY_OUT_OF_SCOPE', status: 403 }
  const matched = await matchCarton(req, input)
  if (typeof matched === 'string') return { err: matched, code: 'TRACE_ERROR', status: 500 }
  let trace: unknown = null
  if (matched.length) {
    const codes = [...new Set(matched.map(r => r.pallet_code))]
    const { data, error } = await supabase.rpc('lot_trace', {
      p_kind: 'codes', p_value: '', p_codes: codes,
      p_wh_ids: scopeWhIds(req), p_categories: scopeCategoriesOf(req), p_limit: 500,
    })
    if (error) return { err: error.message, code: 'TRACE_ERROR', status: 500 }
    trace = data
  }
  return { matched, trace }
}

// POST /wms/trace/investigations/preview — chạy khớp + truy, KHÔNG ghi gì
export async function investigatePreview(req: Request, res: Response) {
  try {
    const input = parseInvestigateInput(req)
    if ('err' in input) return fail(res, input.err, 400, input.code)
    const r = await runInvestigation(req, input)
    if ('err' in r) return fail(res, r.err, r.status, r.code)
    return ok(res, r)
  } catch (e) { return fail(res, String(e)) }
}

// POST /wms/trace/investigations — chạy lại khớp + truy Ở SERVER (không tin snapshot client),
// upload ảnh vào bucket riêng tư rồi lưu HỒ SƠ (người thực hiện lấy từ token).
export async function createInvestigation(req: Request, res: Response) {
  try {
    const input = parseInvestigateInput(req)
    if ('err' in input) return fail(res, input.err, 400, input.code)
    const b = req.body as Record<string, unknown>
    const photosRaw = Array.isArray(b.photos) ? b.photos : []
    if (photosRaw.length > TRACE_PHOTO_MAX_COUNT)
      return fail(res, `Tối đa ${TRACE_PHOTO_MAX_COUNT} ảnh mỗi hồ sơ`, 422, 'TOO_MANY_PHOTOS')

    const r = await runInvestigation(req, input)
    if ('err' in r) return fail(res, r.err, r.status, r.code)

    const id = randomUUID()
    const paths: string[] = []
    for (let i = 0; i < photosRaw.length; i++) {
      const photo = decodePhotoDataUrl(photosRaw[i])
      if (typeof photo === 'string') return fail(res, `Ảnh ${i + 1}: ${photo}`, 422, 'BAD_PHOTO')
      const path = `${id}/${i + 1}.${photo.ext}`
      const { error: upErr } = await supabase.storage.from(TRACE_PHOTO_BUCKET)
        .upload(path, photo.buf, { contentType: photo.contentType, upsert: true })
      if (upErr) return fail(res, `Không lưu được ảnh ${i + 1}: ${upErr.message}`)
      paths.push(path)
    }

    const now = new Date().toISOString()
    const row = {
      id, carton_at: input.carton_at, material_code: input.material_code,
      machine_code: input.machine_code ?? null, cycle: input.cycle ?? null,
      note: String(b.note ?? '').trim() || null,
      result_note: String(b.result_note ?? '').trim() || null,
      photos: paths, matched: r.matched, trace: r.trace,
      performed_by: req.user?.sub ?? null, performed_by_name: req.user?.name ?? null,
      created_at: now, updated_at: now,
    }
    const { data, error } = await supabase.from('trace_investigations').insert(row).select().single()
    if (error) return fail(res, error.message)
    return res.status(201).json({ success: true, data })
  } catch (e) { return fail(res, String(e)) }
}

// GET /wms/trace/investigations — danh sách hồ sơ (phân trang server)
export async function listInvestigations(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    const from = dayOf(q.from), to = dayOf(q.to)
    if (from === undefined || to === undefined) return fail(res, 'Ngày không hợp lệ (cần YYYY-MM-DD)', 400, 'BAD_DATE')
    const page = Math.max(1, Number(q.page) || 1)
    const pageSize = Math.min(100, Math.max(10, Number(q.page_size) || 50))
    let qb = supabase.from('trace_investigations')
      .select('id, carton_at, material_code, machine_code, cycle, note, result_note, photos,'
        + ' matched, summary:trace->summary, performed_by_name, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (from) qb = qb.gte('created_at', new Date(`${from}T00:00:00+07:00`).toISOString())
    if (to)   qb = qb.lte('created_at', new Date(`${to}T23:59:59.999+07:00`).toISOString())
    // ,() là ký tự cú pháp của .or() PostgREST — thay bằng khoảng trắng để từ khóa không bẻ được filter
    const search = String(q.search ?? '').trim().replace(/[,()]/g, ' ').trim()
    if (search) qb = qb.or(`material_code.ilike.%${search}%,performed_by_name.ilike.%${search}%,note.ilike.%${search}%`)
    const { data, count, error } = await qb
    if (error) return fail(res, error.message)
    return ok(res, { rows: data ?? [], total: count ?? 0, page, page_size: pageSize })
  } catch (e) { return fail(res, String(e)) }
}

// GET /wms/trace/investigations/:id — chi tiết + signed URL ảnh (bucket riêng tư, 1h)
export async function getInvestigation(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? '')
    if (!isUuid(id)) return fail(res, 'Mã hồ sơ không hợp lệ', 400, 'BAD_ID')
    const { data, error } = await supabase.from('trace_investigations')
      .select('*').eq('id', id).maybeSingle()
    if (error) return fail(res, error.message)
    if (!data) return fail(res, 'Không tìm thấy hồ sơ', 404, 'NOT_FOUND')
    const paths = (data.photos ?? []) as string[]
    let photo_urls: { path: string; url: string }[] = []
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(TRACE_PHOTO_BUCKET).createSignedUrls(paths, 3600)
      photo_urls = (signed ?? [])
        .filter((s): s is typeof s & { path: string; signedUrl: string } => !!s.path && !!s.signedUrl)
        .map(s => ({ path: s.path, url: s.signedUrl }))
    }
    return ok(res, { ...data, photo_urls })
  } catch (e) { return fail(res, String(e)) }
}
