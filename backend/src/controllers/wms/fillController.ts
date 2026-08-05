import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { maskServerMessage } from '../../utils/response'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { safeFilterValue } from '../../utils/search'
import { normalizeQR } from '../../utils/qrParser'
import { parseListParam } from '../../utils/httpQuery'
import { computePctDate } from '../../utils/shelfLife'

// ─── FILL HÀNG PHỤC VỤ NHẶT LẺ (v3 — user chốt 05/08) ───────────────────────
// Nhặt lẻ lấy hàng bằng TAY ⇒ hàng phải nằm ở "vị trí nhặt lẻ" (cờ Location.is_pick_face).
//
// Mô hình lệnh (đổi 05/08): LỆNH KHÔNG GHIM PALLET — chỉ định theo DATE.
//   · "FillOrder" = MỘT lần Ra lệnh fill (gom nhiều mã), mở ra mới thấy chi tiết.
//   · "FillTask"  = MỘT DÒNG của lệnh: mã hàng + NSX yêu cầu (required_date, kèm required_expiry
//     để hiện %Date) + SL cần hạ + số pallet + vị trí đích. Xe nâng lấy pallet NÀO CŨNG ĐƯỢC
//     miễn ĐÚNG MÃ + ĐÚNG DATE, từ tầng trên (ngoài vị trí nhặt lẻ), không đụng hàng block.
//   · "FillTaskScan" = vết từng pallet đã quét (ai, tem nào, từ đâu về đâu, bao nhiêu).
//
// THỰC HIỆN = QUÉT TEM 2 bước: preview (khớp dòng lệnh + soi đích, ĐƯỢC ĐỔI vị trí đến ngay
// trong màn quét) → commit chạy RPC `fill_scan_apply` MỘT transaction (khoá dòng lệnh → kiểm
// mã/date/nguồn → move_pallets_to_location khoá sức chứa → ghi vết → cộng tiến độ → chốt DONE).
// Vì sao 1 RPC: 2 câu qua PostgREST là 2 transaction — đúng lớp lỗi "ghi tồn + log không nguyên
// tử dưới 504" đã dính 23/07.

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status) } })
}

const now = () => new Date().toISOString()
const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Regex chỉ kiểm ĐỊNH DẠNG — '2026-13-99' vẫn lọt rồi nổ 22008 ở Postgres thành 500
// (check-app bắt 05/08). Ngày phải parse được thật sự mới cho qua.
const isDay = (d: string) => DATE_RE.test(d) && !isNaN(Date.parse(d))
const fmtDMY = (d: string | null | undefined) => {
  if (!d) return '?'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}/${m}/${y}`
}

/** Tồn "dùng được" (nhặt được / hạ xuống được). QUARANTINE đang giữ ⇒ KHÔNG nằm trong đây. */
const USABLE = ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING']

function scopeWhIds(req: Request): string[] | null {
  if (req.user?.warehouse_scope === 'ASSIGNED') return req.user.warehouse_ids ?? []
  return null
}
function guardWarehouse(req: Request, res: Response, warehouseId: string): boolean {
  const scope = scopeWhIds(req)
  if (scope !== null && !scope.includes(warehouseId)) {
    fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được phân quyền')
    return false
  }
  return true
}

/** Id nhân sự lấy từ JWT — chỉ nhận dạng uuid (cột FK), khớp cách slottingController làm. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const selfId = (req: Request): string | null =>
  req.user?.sub && UUID_RE.test(req.user.sub) ? req.user.sub : null
const mayFill = (req: Request, action: string): boolean => {
  const perms = req.user?.module_permissions ?? {}
  const isAdmin = req.user?.is_superadmin === true || req.user?.name === 'Admin'
  return isAdmin || (perms.fill ?? []).includes(action)
}

// ─── GET /wms/fill/demand?warehouse_id&date ─────────────────────────────────
export async function getFillDemand(req: Request, res: Response) {
  try {
    const { warehouse_id, date } = req.query as Record<string, string>
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (date && !isDay(date)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')
    if (!guardWarehouse(req, res, warehouse_id)) return

    const { data, error } = await supabase.rpc('fill_demand', {
      p_wh_scope:     scopeWhIds(req),
      p_cat_scope:    scopeCategoriesOf(req),
      p_warehouse_id: warehouse_id,
      p_date:         date || vnToday(),
    })
    if (error) {
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260804 (fill hàng)')
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/candidates?warehouse_id&material_id ─────────────────────
// Dialog "Đổi date chỉ định": toàn bộ pallet ứng viên của MỘT mã (FEFO) để người nhặt lẻ chọn
// NSX họ cần từ tồn thật; không chọn = mặc định FEFO (date xa nhất).
export async function getFillCandidates(req: Request, res: Response) {
  try {
    const { warehouse_id, material_id } = req.query as Record<string, string>
    if (!warehouse_id || !material_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho hoặc mã hàng')
    if (!UUID_RE.test(material_id)) return fail(res, 400, 'INVALID_INPUT', 'Mã hàng không hợp lệ')
    if (!guardWarehouse(req, res, warehouse_id)) return

    const { data, error } = await supabase.rpc('fill_candidates', {
      p_wh_scope:     scopeWhIds(req),
      p_warehouse_id: warehouse_id,
      p_material_id:  material_id,
    })
    if (error) {
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260805b (fill hàng)')
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/orders — danh sách LỆNH (mỗi dòng = 1 lần Ra lệnh) ────────
export async function listFillOrders(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    if (!q.warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, q.warehouse_id)) return
    for (const d of [q.date_from, q.date_to])
      if (d && !isDay(d)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')

    const page     = Math.max(1, Number(q.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(q.page_size) || 100))
    // `?status=` rỗng nghĩa là "không trạng thái nào" → trả rỗng, KHÔNG bỏ lọc (parseListParam)
    const status   = parseListParam(q.status)
    // "Việc của tôi": lấy id từ TOKEN, không tin id client gửi
    const assignee = q.mine === '1' || q.mine === 'true' ? selfId(req) : (q.assignee_id || null)
    if ((q.mine === '1' || q.mine === 'true') && !assignee) return ok(res, { rows: [], total: 0 })

    const { data, error } = await supabase.rpc('fill_orders_page', {
      p_wh_scope:     scopeWhIds(req),
      p_warehouse_id: q.warehouse_id,
      p_from:         q.date_from || null,
      p_to:           q.date_to   || null,
      p_status:       status,
      p_assignee:     assignee,
      p_search:       q.search || null,
      p_offset:       (page - 1) * pageSize,
      p_limit:        pageSize,
    })
    if (error) {
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260805d (lệnh fill gom)')
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/orders/:id — chi tiết lệnh: dòng mã + vết quét ────────────
export async function getFillOrder(req: Request, res: Response) {
  try {
    const { data: order } = await supabase.from('FillOrder')
      .select('*').eq('id', req.params.id).maybeSingle()
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    if (!guardWarehouse(req, res, order.warehouse_id as string)) return

    // Dòng lệnh kèm đơn vị của mã (FE hiện "N thùng + M hộp" qua qtyLabel)
    const { data: lines, error: e1 } = await supabase.from('FillTask')
      .select('*, material:Material!material_id(entry_unit, units_per_carton, base_unit)')
      .eq('fill_order_id', order.id)
      .order('status').order('material_code').limit(1000)
    if (e1) throw e1
    const { data: scans, error: e2 } = await supabase.from('FillTaskScan')
      .select('*').eq('fill_order_id', order.id)
      .order('created_at', { ascending: false }).limit(1000)
    if (e2) throw e2
    return ok(res, { order, lines: lines ?? [], scans: scans ?? [] })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── LOẠI KHO: vị trí đích phải NHẬN loại của mã ─────────────────────────────
// Null-inclusive hai chiều — cùng khuôn với picker vị trí toàn app (user bắt 05/08:
// hàng FG02 không được hạ về khu FG01).
function locAcceptsCat(locCats: string[] | null, matCat: string | null): boolean {
  return !locCats || !matCat || locCats.includes(matCat)
}

// ─── Chỉ mục vị trí nhặt lẻ còn chỗ (dựng MỘT LẦN cho cả lệnh) ───────────────
// Ưu tiên chỗ ĐANG chứa đúng mã đó, rồi tới chỗ trống nhiều. `free` bị TRỪ theo SỐ PALLET của
// từng dòng để 3 dòng cùng lúc không dồn hết vào một ô 2 slot.
type PickFaceIdx = {
  locs: { id: string; code: string; cats: string[] | null; free: number }[]
  hasMat: Map<string, Set<string>>
}
async function buildPickFaceIdx(warehouseId: string, materialIds: string[]): Promise<PickFaceIdx> {
  const { data: locRaw } = await supabase.from('Location')
    .select('id, location_code, max_pallets, categories')
    .eq('warehouse_id', warehouseId).eq('is_pick_face', true).eq('is_active', true)
    .order('location_code').limit(1000)
  const locs = (locRaw ?? []) as { id: string; location_code: string; max_pallets: number | null; categories: string[] | null }[]
  if (!locs.length) return { locs: [], hasMat: new Map() }
  const ids = locs.map(l => l.id)

  // Chỗ đã chiếm — ĐỊNH NGHĨA KHỚP RPC move_pallets_to_location (nơi thực sự chặn lúc quét)
  const used = new Map<string, number>()
  const hasMat = new Map<string, Set<string>>()
  const matSet = new Set(materialIds)
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('InventoryEntry')
      .select('location_id, material_id, status')
      .in('location_id', ids.slice(i, i + 300))
      .in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING'])
      .gt('cartons_remaining', 0)
    for (const e of (data ?? []) as { location_id: string; material_id: string; status: string }[]) {
      if (e.status !== 'LOOSE_PICKING') used.set(e.location_id, (used.get(e.location_id) ?? 0) + 1)
      if (matSet.has(e.material_id) && USABLE.includes(e.status)) {
        if (!hasMat.has(e.material_id)) hasMat.set(e.material_id, new Set())
        hasMat.get(e.material_id)!.add(e.location_id)
      }
    }
  }
  return {
    locs: locs.map(l => ({
      id: l.id, code: l.location_code, cats: l.categories,
      free: Number(l.max_pallets ?? 0) - (used.get(l.id) ?? 0),
    })),
    hasMat,
  }
}
function takePickFace(idx: PickFaceIdx, materialId: string, matCat: string | null, nPallets: number): { id: string; code: string } | null {
  const same = idx.hasMat.get(materialId)
  const pool = idx.locs.filter(l => l.free > 0 && locAcceptsCat(l.cats, matCat))
  if (!pool.length) return null
  pool.sort((a, b) => {
    const sa = same?.has(a.id) ? 0 : 1, sb = same?.has(b.id) ? 0 : 1
    return sa !== sb ? sa - sb : (b.free - a.free) || a.code.localeCompare(b.code)
  })
  const hit = pool[0]
  hit.free -= Math.max(1, nPallets)   // giữ chỗ trong phạm vi lệnh này
  if (!same) idx.hasMat.set(materialId, new Set([hit.id]))
  else same.add(hit.id)
  return { id: hit.id, code: hit.code }
}

// ─── POST /wms/fill/orders — RA LỆNH (một lệnh gom nhiều dòng mã, chỉ định theo DATE) ──
// body { warehouse_id, target_date, assignee_id?, lines: [{ material_id, required_date?,
//        required_expiry?, qty_base, required_pallets, src_hint?, to_location_id? }] }
export async function createFillOrder(req: Request, res: Response) {
  try {
    const { warehouse_id, target_date, assignee_id, lines } = req.body as {
      warehouse_id?: string; target_date?: string; assignee_id?: string
      lines?: {
        material_id?: string; required_date?: string | null; required_expiry?: string | null
        qty_base?: number; required_pallets?: number; src_hint?: string; to_location_id?: string
      }[]
    }
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, warehouse_id)) return
    const day = target_date || vnToday()
    if (!isDay(day)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')
    const list = (Array.isArray(lines) ? lines : []).filter(l =>
      l && typeof l.material_id === 'string' && UUID_RE.test(l.material_id)
      && Number(l.qty_base) > 0 && Number.isFinite(Number(l.qty_base)))
    if (!list.length) return fail(res, 400, 'INVALID_INPUT', 'Chưa có dòng mã nào để ra lệnh')
    if (list.length > 200) return fail(res, 400, 'TOO_MANY', 'Tối đa 200 dòng mỗi lệnh — chia nhỏ giúp')
    for (const l of list) {
      if (l.required_date && !isDay(String(l.required_date).slice(0, 10)))
        return fail(res, 400, 'INVALID_INPUT', 'Date yêu cầu không hợp lệ (YYYY-MM-DD)')
    }

    const matIds = [...new Set(list.map(l => l.material_id as string))]
    const matMap = new Map<string, { material_code: string; short_name: string | null; category: string | null }>()
    for (let i = 0; i < matIds.length; i += 300) {
      const { data } = await supabase.from('Material')
        .select('id, material_code, short_name, category').in('id', matIds.slice(i, i + 300))
      for (const m of (data ?? []) as { id: string; material_code: string; short_name: string | null; category: string | null }[])
        matMap.set(m.id, { material_code: m.material_code, short_name: m.short_name, category: m.category })
    }

    // Vị trí đích chỉ định — kiểm ở BE, không tin FE (thuộc kho + cờ nhặt lẻ + đang hoạt động)
    const destIds = [...new Set(list.map(l => l.to_location_id).filter(Boolean))] as string[]
    const destOk = new Map<string, { code: string; cats: string[] | null }>()
    if (destIds.length) {
      const { data } = await supabase.from('Location')
        .select('id, location_code, categories').in('id', destIds.slice(0, 300))
        .eq('warehouse_id', warehouse_id).eq('is_pick_face', true).eq('is_active', true)
      for (const d of (data ?? []) as { id: string; location_code: string; categories: string[] | null }[])
        destOk.set(d.id, { code: d.location_code, cats: d.categories })
    }

    // Người được gán (một người cho CẢ lệnh — dialog "Giao lệnh fill cho ai?")
    let asg: { id: string; name: string } | null = null
    if (assignee_id) {
      const { data: emp } = await supabase.from('Employee')
        .select('id, name').eq('id', assignee_id).eq('is_active', true).maybeSingle()
      if (!emp) return fail(res, 400, 'INVALID_INPUT', 'Nhân sự được gán không tồn tại hoặc đã nghỉ')
      asg = { id: emp.id as string, name: emp.name as string }
    }

    const t = now()
    const actor = req.user?.name || null
    const pfIdx = await buildPickFaceIdx(warehouse_id, matIds)
    const skipped: { material_code?: string; required_date?: string | null; reason: string }[] = []
    const rows: Record<string, unknown>[] = []

    for (const l of list) {
      const mat = matMap.get(l.material_id as string)
      if (!mat) { skipped.push({ material_code: l.material_id, reason: 'Mã hàng không tồn tại' }); continue }
      const reqDate = l.required_date ? String(l.required_date).slice(0, 10) : null
      const nPallets = Math.min(500, Math.max(1, Math.round(Number(l.required_pallets) || 1)))
      // Đích chỉ định sai LOẠI → báo rõ và bỏ dòng, KHÔNG âm thầm đổi chỗ thay user
      let destId: string | null = null, destCode: string | null = null
      if (l.to_location_id) {
        const d = destOk.get(l.to_location_id)
        if (d && !locAcceptsCat(d.cats, mat.category)) {
          skipped.push({ material_code: mat.material_code, required_date: reqDate,
            reason: `Vị trí ${d.code} không nhận Loại kho ${mat.category} của mã này` }); continue
        }
        if (d) { destId = l.to_location_id; destCode = d.code }
      }
      if (!destId) {
        const b = takePickFace(pfIdx, l.material_id as string, mat.category, nPallets)
        if (b) { destId = b.id; destCode = b.code }
      }
      if (!destId) {
        skipped.push({ material_code: mat.material_code, required_date: reqDate,
          reason: 'Không còn vị trí nhặt lẻ trống nhận Loại kho của mã này' }); continue
      }
      rows.push({
        id: randomUUID(), warehouse_id, target_date: day,
        material_id: l.material_id, material_code: mat.material_code, material_name: mat.short_name,
        required_date: reqDate,
        required_expiry: l.required_expiry ? String(l.required_expiry).slice(0, 10) : null,
        required_pallets: nPallets, qty_base: Number(l.qty_base),
        from_location_code: (l.src_hint ?? '').slice(0, 200) || null,   // gợi ý hiển thị "lấy tại đâu"
        to_location_id: destId, to_location_code: destCode,
        status: 'PENDING',
        assignee_id: asg?.id ?? null, assignee_name: asg?.name ?? null,
        assigned_by: asg ? actor : null, assigned_at: asg ? t : null,
        created_by: actor, created_at: t, updated_at: t,
      })
    }
    if (!rows.length) return res.status(201).json({ success: true, data: { created: 0, skipped } })

    // Mã lệnh: F + yymmdd + '-' + số thứ tự trong ngày. Đua sinh số = retry với jitter trên
    // unique index uq_fillorder_code (JS check không đỡ được 2 người bấm cùng mili-giây).
    const prefix = 'F' + vnToday().slice(2).replace(/-/g, '') + '-'
    let order: { id: string; order_code: string } | null = null
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      const { count } = await supabase.from('FillOrder')
        .select('id', { count: 'exact', head: true }).like('order_code', `${prefix}%`)
      const code = prefix + String((count ?? 0) + 1 + attempt).padStart(2, '0')
      const { data: ins, error } = await supabase.from('FillOrder')
        .insert({ id: randomUUID(), order_code: code, warehouse_id, target_date: day,
                  status: 'PENDING', created_by: actor, created_at: t, updated_at: t })
        .select('id, order_code').single()
      if (!error && ins) { order = ins as { id: string; order_code: string }; break }
      if ((error as { code?: string } | null)?.code !== '23505') throw error
      await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
    }
    if (!order) return fail(res, 409, 'CONFLICT', 'Không sinh được mã lệnh — thử lại giúp')
    for (const r of rows) r.fill_order_id = order.id

    // Ghi theo LÔ; đụng unique (mã+date này vừa có người khác ra lệnh) → rơi xuống từng dòng
    // để chỉ đúng dòng hỏng thay vì bỏ cả mẻ.
    let created = 0
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const { error } = await supabase.from('FillTask').insert(batch)
      if (!error) { created += batch.length; continue }
      for (const r of batch) {
        const { error: e1 } = await supabase.from('FillTask').insert(r)
        if (!e1) { created++; continue }
        skipped.push({
          material_code: r.material_code as string, required_date: r.required_date as string | null,
          reason: (e1 as { code?: string }).code === '23505'
            ? 'Mã này (date này) vừa có người khác ra lệnh — xem tab Lệnh fill' : 'Không ghi được dòng lệnh',
        })
      }
    }
    if (!created) {   // lệnh rỗng thì đừng để lại vỏ
      await supabase.from('FillOrder').delete().eq('id', order.id)
      return res.status(201).json({ success: true, data: { created: 0, skipped } })
    }
    return res.status(201).json({ success: true, data: {
      created, skipped, order_id: order.id, order_code: order.order_code,
    } })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── PATCH /wms/fill/tasks/:id — gán người / đổi vị trí đích cho MỘT dòng ────
// Đổi đích PHẢI có: đích đầy thì dòng kẹt vĩnh viễn (quét luôn trả LOCATION_FULL) — đúng loại
// "ngõ cụt" app đã dính vài lần. Gán người = quyền `assign`; đổi đích = quyền `plan`.
// Multi-select ở trang chi tiết lệnh gọi route này SONG SONG từng dòng (Promise.all).
export async function updateFillTask(req: Request, res: Response) {
  try {
    const { assignee_id, to_location_id } = req.body as { assignee_id?: string | null; to_location_id?: string }
    const hasAsg  = assignee_id !== undefined
    const hasDest = to_location_id !== undefined
    if (!hasAsg && !hasDest) return fail(res, 400, 'INVALID_INPUT', 'Không có gì để sửa')

    const { data: task } = await supabase.from('FillTask')
      .select('id, warehouse_id, status, material_id').eq('id', req.params.id).maybeSingle()
    if (!task) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy dòng lệnh fill')
    if (!guardWarehouse(req, res, task.warehouse_id as string)) return
    if (task.status !== 'PENDING') return fail(res, 409, 'NOT_PENDING', 'Dòng đã xong hoặc đã hủy — không sửa được')

    if (hasAsg  && !mayFill(req, 'assign')) return fail(res, 403, 'FORBIDDEN', 'Không có quyền gán lệnh fill')
    if (hasDest && !mayFill(req, 'plan'))   return fail(res, 403, 'FORBIDDEN', 'Không có quyền sửa lệnh fill')

    const patch: Record<string, unknown> = { updated_at: now() }
    if (hasAsg) {
      if (!assignee_id) Object.assign(patch, { assignee_id: null, assignee_name: null, assigned_by: null, assigned_at: null })
      else {
        const { data: emp } = await supabase.from('Employee')
          .select('id, name').eq('id', assignee_id).eq('is_active', true).maybeSingle()
        if (!emp) return fail(res, 400, 'INVALID_INPUT', 'Nhân sự không tồn tại hoặc đã nghỉ')
        Object.assign(patch, {
          assignee_id: emp.id, assignee_name: emp.name,
          assigned_by: req.user?.name || null, assigned_at: now(),
        })
      }
    }
    if (hasDest) {
      const { data: loc } = await supabase.from('Location')
        .select('id, location_code, categories').eq('id', to_location_id)
        .eq('warehouse_id', task.warehouse_id).eq('is_pick_face', true).eq('is_active', true).maybeSingle()
      if (!loc) return fail(res, 400, 'INVALID_INPUT', 'Vị trí đích phải là VỊ TRÍ NHẶT LẺ đang hoạt động của kho này')
      const { data: mat } = task.material_id
        ? await supabase.from('Material').select('category').eq('id', task.material_id).maybeSingle()
        : { data: null }
      if (!locAcceptsCat(loc.categories as string[] | null, (mat?.category as string | null) ?? null))
        return fail(res, 400, 'CATEGORY_MISMATCH',
          `Vị trí ${loc.location_code} không nhận Loại kho ${mat?.category} của mã trên dòng lệnh`)
      Object.assign(patch, { to_location_id: loc.id, to_location_code: loc.location_code })
    }

    const { data, error } = await supabase.from('FillTask')
      .update(patch).eq('id', task.id).eq('status', 'PENDING').select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 409, 'NOT_PENDING', 'Dòng vừa đổi trạng thái — tải lại danh sách')
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── DELETE /wms/fill/tasks/:id — HỦY một dòng (giữ để tra cứu, không xóa cứng) ──
export async function cancelFillTask(req: Request, res: Response) {
  try {
    const { data: task } = await supabase.from('FillTask')
      .select('id, warehouse_id, status, fill_order_id').eq('id', req.params.id).maybeSingle()
    if (!task) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy dòng lệnh fill')
    if (!guardWarehouse(req, res, task.warehouse_id as string)) return
    if (task.status === 'DONE') return fail(res, 409, 'ALREADY_DONE', 'Dòng đã hoàn thành — không hủy được')

    const reason = String((req.body as { reason?: string })?.reason ?? '').trim() || null
    const { data, error } = await supabase.from('FillTask')
      .update({ status: 'CANCELLED', cancel_reason: reason, updated_at: now() })
      .eq('id', task.id).neq('status', 'DONE').select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 409, 'ALREADY_DONE', 'Dòng vừa được hoàn thành — không hủy được')
    // Hủy dòng cuối cùng thì trạng thái LỆNH phải đổi theo (rollup trong DB, tránh drift khi đua)
    if (task.fill_order_id) await supabase.rpc('fill_order_rollup', { p_order_id: task.fill_order_id })
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── DELETE /wms/fill/orders/:id — HỦY cả lệnh (chỉ các dòng còn treo) ───────
export async function cancelFillOrder(req: Request, res: Response) {
  try {
    const { data: order } = await supabase.from('FillOrder')
      .select('id, warehouse_id, status').eq('id', req.params.id).maybeSingle()
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    if (!guardWarehouse(req, res, order.warehouse_id as string)) return
    if (order.status !== 'PENDING') return fail(res, 409, 'NOT_PENDING', 'Lệnh đã xong hoặc đã hủy')

    const reason = String((req.body as { reason?: string })?.reason ?? '').trim() || null
    const { data: cancelled, error } = await supabase.from('FillTask')
      .update({ status: 'CANCELLED', cancel_reason: reason ?? 'Hủy cả lệnh', updated_at: now() })
      .eq('fill_order_id', order.id).eq('status', 'PENDING').select('id')
    if (error) throw error
    await supabase.rpc('fill_order_rollup', { p_order_id: order.id })
    return ok(res, { cancelled: (cancelled ?? []).length })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── POST /wms/fill/scan — QUÉT THỰC HIỆN (2 bước: preview → commit) ─────────
// body { qr, warehouse_id, order_id?, to_location_id?, commit?, take_over? }
// · KHÔNG ghim pallet: quét tem BẤT KỲ, hệ thống khớp dòng lệnh theo MÃ + DATE (NSX) của pallet.
// · preview (mặc định): khớp + soi, KHÔNG ghi gì — màn quét hiện dòng lệnh + date yêu cầu +
//   vị trí đến (ĐƯỢC ĐỔI ngay tại đây; đổi sẽ lưu vào dòng lệnh khi commit — phạm vi hẹp đúng
//   tiền lệ `leftover_location_id` bên Xuất: người quét bắt buộc khai được chỗ đặt).
// · commit: chạy RPC fill_scan_apply MỘT transaction (khoá lệnh + khoá sức chứa + ghi vết).
export async function scanFill(req: Request, res: Response) {
  try {
    const { qr, warehouse_id, order_id, to_location_id, commit, take_over } = req.body as {
      qr?: string; warehouse_id?: string; order_id?: string
      to_location_id?: string; commit?: boolean; take_over?: boolean
    }
    if (!qr || !String(qr).trim()) return fail(res, 400, 'INVALID_INPUT', 'Thiếu mã QR')
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, warehouse_id)) return

    const code = normalizeQR(String(qr))
    // Pallet theo tem (kho QTY có thể nhiều dòng cùng pallet_code — lấy hết rồi lọc)
    type LocEmb = { warehouse_id: string | null; is_pick_face: boolean | null; location_code: string | null }
    type ScanEntry = {
      id: string; pallet_code: string; material_id: string; location_id: string | null
      status: string; cartons_remaining: number; cartons_reserved: number | null
      production_date: string | null; expiry_date: string | null; shelf_life_days: number | null
      location: LocEmb | LocEmb[] | null
    }
    const { data: entRaw } = await supabase.from('InventoryEntry')
      .select('id, pallet_code, material_id, location_id, status, cartons_remaining, cartons_reserved, production_date, expiry_date, shelf_life_days, location:Location!location_id(warehouse_id, is_pick_face, location_code)')
      .eq('pallet_code', code).limit(50)
    const ents = ((entRaw ?? []) as unknown as ScanEntry[])
      .map(r => ({ ...r, loc: Array.isArray(r.location) ? r.location[0] : r.location }))
      .filter(r => r.loc?.warehouse_id === warehouse_id)
    if (!ents.length) return fail(res, 404, 'PALLET_NOT_FOUND', 'Không tìm thấy pallet này trong kho')

    const avail = (e: Record<string, unknown>) =>
      Math.max(0, Number(e.cartons_remaining) - Number(e.cartons_reserved ?? 0))
    const usable = ents.filter(e => !e.loc?.is_pick_face && USABLE.includes(e.status as string) && avail(e) > 0)
    if (!usable.length) {
      if (ents.some(e => e.loc?.is_pick_face)) return fail(res, 409, 'ALREADY_PICK_FACE', 'Pallet đã ở vị trí nhặt lẻ rồi')
      if (ents.some(e => e.status === 'QUARANTINE')) return fail(res, 409, 'BLOCKED', 'Pallet đang bị giữ (QA/block) — không được hạ')
      return fail(res, 409, 'GONE', 'Pallet đã hết khả dụng / đã xuất')
    }

    // Khớp dòng lệnh theo MÃ + DATE: ưu tiên dòng ĐÚNG date, rồi dòng không ràng date
    const matIds = [...new Set(usable.map(e => e.material_id as string))]
    let lq = supabase.from('FillTask')
      .select('*').eq('warehouse_id', warehouse_id).eq('status', 'PENDING')
      .in('material_id', matIds.slice(0, 50)).limit(200)
    if (order_id) lq = lq.eq('fill_order_id', order_id)
    const { data: lineRaw } = await lq
    const pending = (lineRaw ?? []) as Record<string, unknown>[]
    if (!pending.length) {
      return fail(res, 404, 'NO_TASK', order_id
        ? 'Mã hàng trên pallet không có dòng nào đang chờ trong lệnh này'
        : 'Mã hàng trên pallet không có lệnh fill nào đang chờ')
    }
    const dateOf = (e: Record<string, unknown>) =>
      e.production_date ? String(e.production_date).slice(0, 10) : null
    let entry: (typeof usable)[number] | null = null
    let line: Record<string, unknown> | null = null
    outer:
    for (const exact of [true, false]) {
      for (const e of usable) {
        const cands = pending
          .filter(l => l.material_id === e.material_id)
          .filter(l => exact ? l.required_date === dateOf(e) : l.required_date == null)
          .sort((a, b) => String(a.target_date).localeCompare(String(b.target_date))
            || String(a.created_at).localeCompare(String(b.created_at)))
        if (cands.length) { entry = e; line = cands[0]; break outer }
      }
    }
    if (!entry || !line) {
      // Có lệnh cho mã này nhưng DATE không khớp → nói rõ date + %Date yêu cầu (user chốt 05/08)
      const wants = pending.map(l => {
        const pct = computePctDate({
          production_date: l.required_date as string | null,
          expiry_date: l.required_expiry as string | null,
        }, null)
        return `NSX ${fmtDMY(l.required_date as string | null)}${pct !== null ? ` (${pct}%Date)` : ''}`
      })
      return fail(res, 409, 'DATE_MISMATCH',
        `Lệnh yêu cầu ${[...new Set(wants)].join(' hoặc ')} — pallet này NSX ${fmtDMY(dateOf(usable[0]))}. Lấy pallet đúng date yêu cầu.`)
    }

    // Lệnh của người khác → không cướp việc âm thầm; người có quyền `assign` mới nhận lại được
    const me = selfId(req)
    const meName = req.user?.name || null
    const asg = line.assignee_id as string | null
    if (asg && me && asg !== me) {
      if (!take_over) return fail(res, 409, 'NOT_YOUR_TASK', `Dòng lệnh này đã giao cho ${line.assignee_name ?? 'người khác'}`)
      if (!mayFill(req, 'assign')) return fail(res, 403, 'FORBIDDEN', 'Không có quyền nhận lệnh của người khác')
    }

    // Vị trí đến: đổi ngay trong màn quét được (phạm vi hẹp: vị trí nhặt lẻ của kho + nhận loại)
    let destId = line.to_location_id as string
    let destCode = line.to_location_code as string | null
    if (to_location_id && to_location_id !== destId) {
      const { data: loc } = await supabase.from('Location')
        .select('id, location_code, categories').eq('id', to_location_id)
        .eq('warehouse_id', warehouse_id).eq('is_pick_face', true).eq('is_active', true).maybeSingle()
      if (!loc) return fail(res, 400, 'INVALID_INPUT', 'Vị trí đến phải là VỊ TRÍ NHẶT LẺ đang hoạt động của kho này')
      const { data: mat } = await supabase.from('Material')
        .select('category').eq('id', line.material_id as string).maybeSingle()
      if (!locAcceptsCat(loc.categories as string[] | null, (mat?.category as string | null) ?? null))
        return fail(res, 400, 'CATEGORY_MISMATCH', `Vị trí ${loc.location_code} không nhận Loại kho ${mat?.category} của mã này`)
      destId = loc.id as string; destCode = loc.location_code as string
    }

    // Đơn vị của mã (màn quét hiện "N thùng + M hộp")
    const { data: unit } = await supabase.from('Material')
      .select('entry_unit, units_per_carton, base_unit').eq('id', line.material_id as string).maybeSingle()
    const taskOut = { ...line, ...(unit ?? {}) }
    const entryOut = {
      entry_id: entry.id, pallet_code: entry.pallet_code, avail: avail(entry),
      production_date: entry.production_date, expiry_date: entry.expiry_date,
    }
    const willComplete = Number(line.scanned_pallets) + 1 >= Number(line.required_pallets)
      || Number(line.qty_done_base) + avail(entry) >= Number(line.qty_base)

    if (!commit) {
      return ok(res, { preview: true, task: taskOut, entry: entryOut,
        dest: { id: destId, code: destCode }, will_complete: willComplete })
    }

    // COMMIT — một transaction trong DB (khoá dòng lệnh + khoá sức chứa + ghi vết + tiến độ)
    const { data: applied, error: rpcErr } = await supabase.rpc('fill_scan_apply', {
      p_task_id: line.id as string, p_entry_id: entry.id as string, p_to_location_id: destId,
      p_actor_id: me, p_actor_name: meName, p_take_over: !!take_over,
      p_update_date: vnToday(), p_now: now(),
    })
    if (rpcErr) {
      if (rpcErr.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260805d (lệnh fill gom)')
      return fail(res, 500, 'DB_ERROR', rpcErr.message)
    }
    const r = (applied ?? {}) as { code?: string; task?: Record<string, unknown>; scanned_qty?: number; order_status?: string }
    switch (r.code) {
      case 'OK':
        return ok(res, { task: { ...(r.task ?? {}), ...(unit ?? {}) }, entry: entryOut, moved: true,
          scanned_qty: r.scanned_qty, order_status: r.order_status,
          done: (r.task?.status === 'DONE') })
      case 'FULL':
        return fail(res, 400, 'LOCATION_FULL',
          `Vị trí đến ${destCode ?? ''} đã đầy — đổi vị trí đến ngay trên màn quét rồi xác nhận lại`)
      case 'INACTIVE':  return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí đến không hoạt động')
      case 'NOT_PENDING': return fail(res, 409, 'NOT_PENDING', 'Dòng lệnh vừa được hoàn thành/hủy — quét lại để khớp dòng khác')
      case 'DUP':       return fail(res, 409, 'DUP', 'Pallet này đã được ghi nhận cho dòng lệnh này rồi')
      case 'GONE':      return fail(res, 409, 'GONE', 'Pallet vừa hết khả dụng — quét pallet khác')
      case 'ALREADY_PICK_FACE': return fail(res, 409, 'ALREADY_PICK_FACE', 'Pallet đã ở vị trí nhặt lẻ rồi')
      case 'DATE_MISMATCH': return fail(res, 409, 'DATE_MISMATCH', 'Pallet không đúng date yêu cầu của dòng lệnh')
      case 'WRONG_MATERIAL': return fail(res, 409, 'WRONG_MATERIAL', 'Pallet không đúng mã của dòng lệnh')
      default: return fail(res, 400, 'SCAN_FAILED', `Không thực hiện được (${r.code ?? 'UNKNOWN'})`)
    }
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/report?warehouse_id&date_from&date_to ────────────────────
export async function getFillReport(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    if (!q.warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, q.warehouse_id)) return
    for (const d of [q.date_from, q.date_to])
      if (d && !isDay(d)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')

    const { data, error } = await supabase.rpc('fill_report', {
      p_wh_scope: scopeWhIds(req), p_warehouse_id: q.warehouse_id,
      p_from: q.date_from || null, p_to: q.date_to || null,
    })
    if (error) {
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260804 (fill hàng)')
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/pick-face-locations?warehouse_id&material_id ─────────────
// Ô chọn "vị trí đến" — chỉ vị trí nhặt lẻ của kho (danh sách nhỏ, không phải danh mục lớn).
// Có material_id thì lọc luôn theo LOẠI KHO của mã (đừng bày ra lựa chọn mà BE sẽ 400).
export async function listPickFaceLocations(req: Request, res: Response) {
  try {
    const { warehouse_id, material_id } = req.query as Record<string, string>
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, warehouse_id)) return
    let matCat: string | null = null
    if (material_id && UUID_RE.test(material_id)) {
      const { data: mat } = await supabase.from('Material').select('category').eq('id', material_id).maybeSingle()
      matCat = (mat?.category as string | null) ?? null
    }
    let q = supabase.from('Location')
      .select('id, location_code, sub_code, max_pallets')
      .eq('warehouse_id', warehouse_id).eq('is_pick_face', true).eq('is_active', true)
    // Cùng khuôn picker vị trí toàn app: khớp loại HOẶC vị trí chưa khai loại (null-inclusive)
    if (matCat) q = q.or(`categories.cs.{"${safeFilterValue(matCat)}"},categories.is.null`)
    const { data, error } = await q.order('location_code').limit(1000)
    if (error) throw error
    return ok(res, data ?? [])
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}
