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
import { scopeCategoriesOf } from '../../utils/categoryScope'
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

// 'prod' (01/09 tối, user chốt "cái tôi cần là số chu kỳ, số máy, nhà máy sản xuất"): truy theo
// thông số SX in trên tem V1 — đoạn 3 Chu kỳ · đoạn 4 Máy · đoạn 6 Kho SX ký hiệu. Bắt buộc
// khoảng Ngày SX ≤ 31 ngày (RPC dựng tiền tố ddmmyy_ từng ngày để ăn index pallet_code).
const KINDS = ['pallet', 'material', 'batch', 'prod', 'npp', 'trip', 'plate'] as const
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
    if (kind !== 'prod' && !value) return fail(res, 'Thiếu giá trị cần truy xuất', 400, 'BAD_VALUE')
    // Tiền tố quá ngắn quét ra gần như cả kho — chặn sớm thay vì để người dùng chờ rồi nhận 2.000 dòng
    if (kind === 'pallet' && value.length < 4)
      return fail(res, 'Mã pallet cần ít nhất 4 ký tự (vd 190726 = ngày sản xuất)', 400, 'BAD_VALUE')

    const dates = {
      prod_from: dayOf(q.prod_from), prod_to: dayOf(q.prod_to),
      ship_from: dayOf(q.ship_from), ship_to: dayOf(q.ship_to),
    }
    for (const [k, v] of Object.entries(dates))
      if (v === undefined) return fail(res, `Ngày không hợp lệ ở "${k}" (cần YYYY-MM-DD)`, 400, 'BAD_DATE')

    // kind='prod' — thông số SX: BẮT BUỘC khoảng Ngày SX (≤31 ngày, mỗi ngày = 1 tiền tố tem)
    // + ít nhất 1 trong Chu kỳ / Máy / Kho SX. Thiếu là 400 nói rõ, không âm thầm trả rỗng.
    const cycle = String(q.cycle ?? '').trim().slice(0, 30)
    const machine = String(q.machine ?? '').trim().slice(0, 30)
    const nmsx = String(q.nmsx ?? '').trim().slice(0, 10)
    if (kind === 'prod') {
      if (!dates.prod_from || !dates.prod_to)
        return fail(res, 'Cần chọn khoảng Ngày sản xuất (tem V1 mở đầu bằng ngày SX)', 400, 'BAD_RANGE')
      const span = (Date.parse(dates.prod_to) - Date.parse(dates.prod_from)) / 86400000
      if (span < 0) return fail(res, 'Ngày "đến" phải sau ngày "từ"', 400, 'BAD_RANGE')
      if (span > 31) return fail(res, 'Khoảng Ngày sản xuất tối đa 31 ngày — thu hẹp lại', 400, 'BAD_RANGE')
      if (!cycle && !machine && !nmsx)
        return fail(res, 'Cần ít nhất một trong: Chu kỳ · Máy · Kho SX (ký hiệu)', 400, 'BAD_VALUE')
    }

    const limit = Math.min(2000, Math.max(50, Number(q.limit) || 500))
    const { data, error } = await supabase.rpc('lot_trace', {
      p_kind: kind, p_value: value,
      p_cycle: cycle || null, p_machine: machine || null, p_nmsx: nmsx || null,
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

// GET /wms/trace/suggest?kind=&search= — GỢI Ý "giá trị cần tìm" cho ô chọn tìm-trên-server
// (user chốt 01/09 tối: gõ tự do "tìm k ra đâu"). DISTINCT + LIMIT làm trong RPC trace_suggest
// (PostgREST không DISTINCT được); các kiểu quét bảng giao dịch lớn đòi có từ khóa mới tìm.
export async function traceSuggest(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    const kind = String(q.kind ?? '').trim()
    if (!isKind(kind)) return fail(res, `Kiểu gợi ý không hợp lệ (${KINDS.join(' | ')})`, 400, 'BAD_KIND')
    if (kind === 'prod') return ok(res, [])   // prod nhập bằng 3 ô Chu kỳ/Máy/Kho SX, không có ô "giá trị"
    const search = String(q.search ?? '').trim().slice(0, 100)
    const { data, error } = await supabase.rpc('trace_suggest', { p_kind: kind, p_search: search, p_limit: 50 })
    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

// ─── TRUY XUẤT THEO THÙNG (01/09, user chốt — v2 cùng ngày) ─────────────────────────────────────
// Khiếu nại đến từ MỘT THÙNG khách đang cầm — trên thùng chỉ có chữ in phun (giờ phút, ngày SX).
// Bắt buộc nhập: Ngày · Giờ SX · MÁY · CHU KỲ (mã hàng tùy chọn). Tem pallet có thể lệch ±1–3 ngày
// so với chữ in phun (SX vắt qua đêm) nên KHÔNG bám cứng ngày: gợi ý SỔ ĐÓNG GÓI theo Máy + Chu kỳ
// trong cửa sổ ±3 ngày, user XEM từng sổ (pallet + giờ) rồi BUỘC CHỌN 1 sổ → truy tiếp bằng
// lot_trace(kind='codes') + lịch sử nhập MỌI KHO → HÀNH TRÌNH "sinh ra → đi qua đâu → còn ở đâu".
// Truy xuất là việc TOÀN CÔNG TY (thu hồi): KHÔNG cắt theo scope kho/loại của người tra — quyền
// traceability.investigate chính là cửa kiểm soát ai được nhìn toàn cảnh này.

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

/** Cộng/trừ N ngày trên chuỗi 'YYYY-MM-DD' (số học lịch thuần — không dính timezone). */
function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

type RunRow = {
  id: string; run_date: string | null; shift: string | null; cycle: string | null
  material_code: string | null; material_codes: string[] | null; machine_code: string | null
  warehouse_id: string | null; start_at: string | null; end_at: string | null
  qty_total: number | null; pallet_count: number | null; status: string
  opened_by_name: string | null
}
const RUN_COLS = 'id, run_date, shift, cycle, material_code, material_codes, machine_code,'
  + ' warehouse_id, start_at, end_at, qty_total, pallet_count, status, opened_by_name'

/** Gắn tên + ký hiệu NMSX (B, D…) của kho cho các dòng mang warehouse_id (id là text, không FK). */
async function attachWarehouseNames<T extends { warehouse_id: string | null }>(
  rows: T[],
): Promise<(T & { warehouse_name: string | null; warehouse_nmsx: string | null })[]> {
  const ids = [...new Set(rows.map(r => r.warehouse_id).filter((x): x is string => !!x))].slice(0, 300)
  const info = new Map<string, { name: string; nmsx: string | null }>()
  if (ids.length) {
    const { data } = await supabase.from('Warehouse').select('id, name, nmsx_code').in('id', ids).limit(300)
    for (const w of (data ?? []) as { id: string; name: string; nmsx_code: string | null }[])
      info.set(w.id, { name: w.name, nmsx: w.nmsx_code })
  }
  return rows.map(r => ({
    ...r,
    warehouse_name: r.warehouse_id ? info.get(r.warehouse_id)?.name ?? null : null,
    warehouse_nmsx: r.warehouse_id ? info.get(r.warehouse_id)?.nmsx ?? null : null,
  }))
}

// GET /wms/trace/runs?machine=&cycle=&date=[&material_code=] — GỢI Ý SỔ ĐÓNG GÓI khớp điều kiện.
// Cửa sổ ±3 ngày quanh ngày in phun (tem pallet lệch được 1–3 ngày); chu kỳ so dạng chuẩn
// ("07" ≡ "7"); sổ gần ngày nhập nhất xếp lên đầu để user xem rồi tự chọn.
export async function listCandidateRuns(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    const machine = String(q.machine ?? '').trim()
    const cycle = String(q.cycle ?? '').trim()
    const date = dayOf(q.date)
    if (!machine || !cycle || !date)
      return fail(res, 'Cần đủ Máy · Chu kỳ · Ngày (YYYY-MM-DD)', 400, 'BAD_INPUT')
    const material = String(q.material_code ?? '').trim().replace(/[,(){}]/g, '')
    let qb = supabase.from('packing_runs')
      .select(RUN_COLS)
      .eq('machine_code', machine)
      .gte('run_date', shiftDay(date, -3)).lte('run_date', shiftDay(date, 3))
      .limit(50)
    if (material) qb = qb.or(`material_code.eq.${material},material_codes.cs.{${material}}`)
    const { data, error } = await qb
    if (error) return fail(res, error.message)
    const want = normCycleCode(cycle)
    const anchor = new Date(`${date}T00:00:00Z`).getTime()
    const rows = ((data ?? []) as unknown as RunRow[])
      .filter(r => r.cycle != null && normCycleCode(String(r.cycle)) === want)
      .sort((a, b) =>
        Math.abs(new Date(`${a.run_date ?? date}T00:00:00Z`).getTime() - anchor)
        - Math.abs(new Date(`${b.run_date ?? date}T00:00:00Z`).getTime() - anchor))
    let named = await attachWarehouseNames(rows)
    // Kho SX theo KÝ HIỆU NMSX trên tem (B, D… — Warehouse.nmsx_code), user bổ sung 01/09
    const nmsx = String(q.nmsx ?? '').trim().toUpperCase()
    if (nmsx) named = named.filter(r => (r.warehouse_nmsx ?? '').toUpperCase() === nmsx)
    return ok(res, named)
  } catch (e) { return fail(res, String(e)) }
}

type CartonMatchRow = {
  pallet_code: string; material_code: string | null; machine_code: string | null
  warehouse_id: string | null; qty_cartons: number | null
  prod_start_at: string | null; prod_end_at: string | null
  packed_by_name: string | null; status: string
  time_hit?: boolean
}

async function runLogs(runId: string): Promise<CartonMatchRow[] | string> {
  const { data, error } = await supabase.from('packing_logs')
    .select('pallet_code, material_code, machine_code, warehouse_id, qty_cartons,'
      + ' prod_start_at, prod_end_at, packed_by_name, status')
    .eq('run_id', runId).neq('status', 'CANCELLED')
    .order('prod_start_at').limit(500)
  if (error) return error.message
  return (data ?? []) as unknown as CartonMatchRow[]
}

// GET /wms/trace/runs/:id — XEM 1 sổ ngay trong form trước khi chọn: trang sổ + pallet + giờ
export async function getRunPallets(req: Request, res: Response) {
  try {
    const id = String(req.params.id ?? '')
    if (!isUuid(id)) return fail(res, 'Mã sổ không hợp lệ', 400, 'BAD_ID')
    const { data: run, error } = await supabase.from('packing_runs')
      .select(RUN_COLS).eq('id', id).maybeSingle()
    if (error) return fail(res, error.message)
    if (!run) return fail(res, 'Không tìm thấy sổ đóng gói', 404, 'NOT_FOUND')
    const pallets = await runLogs(id)
    if (typeof pallets === 'string') return fail(res, pallets)
    const [runNamed] = await attachWarehouseNames([run as unknown as RunRow])
    return ok(res, { run: runNamed, pallets })
  } catch (e) { return fail(res, String(e)) }
}

type InvestigateInput = {
  run_id: string; carton_at: string; machine_code: string; cycle: string; material_code?: string
}

function parseInvestigateInput(req: Request): InvestigateInput | { err: string; code: string } {
  const b = req.body as Record<string, unknown>
  const run_id = String(b.run_id ?? '').trim()
  if (!isUuid(run_id)) return { err: 'Chưa chọn sổ đóng gói — xem gợi ý rồi chọn 1 sổ trước khi truy xuất', code: 'RUN_REQUIRED' }
  const carton_at = cartonAtOf(b.carton_date, b.carton_time)
  if (!carton_at) return { err: 'Cần ngày (YYYY-MM-DD) và giờ (HH:MM hoặc HH:MM:SS) in trên thùng', code: 'BAD_TIME' }
  const machine_code = String(b.machine_code ?? '').trim()
  const cycle = String(b.cycle ?? '').trim()
  if (!machine_code || !cycle) return { err: 'Máy và Chu kỳ là bắt buộc', code: 'BAD_INPUT' }
  const material_code = String(b.material_code ?? '').trim() || undefined
  return { run_id, carton_at, machine_code, cycle, material_code }
}

type InvErr = { err: string; code: string; status: number }
type InvOk = { run: RunRow & { warehouse_name: string | null }; matched: CartonMatchRow[]; trace: Record<string, unknown> }

async function runInvestigation(req: Request, input: InvestigateInput): Promise<InvErr | InvOk> {
  const { data: runRaw, error: runErr } = await supabase.from('packing_runs')
    .select(RUN_COLS).eq('id', input.run_id).maybeSingle()
  if (runErr) return { err: runErr.message, code: 'TRACE_ERROR', status: 500 }
  if (!runRaw) return { err: 'Không tìm thấy sổ đóng gói đã chọn', code: 'NOT_FOUND', status: 404 }
  const [run] = await attachWarehouseNames([runRaw as unknown as RunRow])

  let logs = await runLogs(input.run_id)
  if (typeof logs === 'string') return { err: logs, code: 'TRACE_ERROR', status: 500 }
  if (input.material_code) logs = logs.filter(l => l.material_code === input.material_code)

  // Đánh dấu pallet CHỨA giờ in phun — thử ngày ±3 (cùng biên độ cửa sổ tìm sổ: tem/sổ lệch
  // được tới 3 ngày so chữ in phun; đo thật 01/09 — ±1 làm ★ trượt khi user nhập ngày lệch +2)
  const t0 = new Date(input.carton_at).getTime()
  const matched: CartonMatchRow[] = logs.map(l => ({
    ...l,
    time_hit: [-3, -2, -1, 0, 1, 2, 3].some(k => {
      const t = t0 + k * 86400_000
      return l.prod_start_at != null && l.prod_end_at != null
        && t >= new Date(l.prod_start_at).getTime() && t <= new Date(l.prod_end_at).getTime()
    }),
  }))

  // Hành trình TOÀN CÔNG TY: lot_trace không cắt scope (pallet đi qua nhiều kho — cắt theo kho
  // người tra là đứt khúc giữa hành trình) + lịch sử NHẬP mọi kho (kể cả dòng đã xuất hết).
  const trace: Record<string, unknown> = { run }
  const codes = [...new Set(matched.map(r => r.pallet_code))].slice(0, 200)
  if (codes.length) {
    const { data, error } = await supabase.rpc('lot_trace', {
      p_kind: 'codes', p_value: '', p_codes: codes,
      p_wh_ids: null, p_categories: null, p_limit: 500,
    })
    if (error) return { err: error.message, code: 'TRACE_ERROR', status: 500 }
    Object.assign(trace, (data ?? {}) as Record<string, unknown>)
    const { data: inb, error: inbErr } = await supabase.from('InventoryEntry')
      .select('pallet_code, import_date, warehouse_id, cartons_imported, cartons_remaining, status, created_at')
      .in('pallet_code', codes).order('created_at').limit(1000)
    if (inbErr) return { err: inbErr.message, code: 'TRACE_ERROR', status: 500 }
    trace.inbound = await attachWarehouseNames(
      (inb ?? []) as { pallet_code: string; import_date: string | null; warehouse_id: string | null
        cartons_imported: number | null; cartons_remaining: number | null; status: string; created_at: string }[])
  }
  return { run, matched, trace }
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
      id, run_id: input.run_id, carton_at: input.carton_at,
      material_code: input.material_code ?? null,
      machine_code: input.machine_code, cycle: input.cycle,
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
      .select('id, run_id, carton_at, material_code, machine_code, cycle, note, result_note, photos,'
        + ' matched, summary:trace->summary, run:trace->run, performed_by_name, created_at', { count: 'exact' })
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
