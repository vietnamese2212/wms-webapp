import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { maskServerMessage } from '../../utils/response'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { safeFilterValue } from '../../utils/search'
import { normalizeQR } from '../../utils/qrParser'
import { parseListParam } from '../../utils/httpQuery'

// ─── FILL HÀNG PHỤC VỤ NHẶT LẺ (user chốt 04/08) ─────────────────────────────
// Nhặt lẻ lấy hàng bằng TAY ⇒ hàng phải nằm ở vị trí với tới được ("vị trí nhặt lẻ" —
// cờ `Location.is_pick_face`, kho tự khai hàng loạt ở trang Vị trí kho).
//
// Ba việc, đúng thứ tự nghiệp vụ:
//   1. ĐỀ XUẤT  — RPC `fill_demand`: cần (nhặt lẻ còn lại của NGÀY XUẤT) vs đang có ở vị trí
//      nhặt lẻ ⇒ thiếu bao nhiêu, hạ pallet nào (FEFO), xuống chỗ nào.
//   2. RA LỆNH  — mỗi lệnh = MỘT pallet phải hạ, gán cho một người.
//   3. THỰC HIỆN— QUÉT TEM pallet (không bấm tay): pallet phải đang ở đúng vị trí nguồn, rồi
//      RPC `move_pallets_to_location` chuyển nguyên tử (khoá sức chứa) — xong mới đánh DONE.
//
// Vì sao quét chứ không bấm: bấm khống thì vị trí trong hệ thống sai ngay, mà cả nhặt lẻ lẫn
// kiểm kê sau đó đều tin vào vị trí đó. Đây cũng là khuôn của `slottingController.scanMovePlanPallet`.

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status) } })
}

const now = () => new Date().toISOString()
const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

// ─── GET /wms/fill/demand?warehouse_id&date ─────────────────────────────────
export async function getFillDemand(req: Request, res: Response) {
  try {
    const { warehouse_id, date } = req.query as Record<string, string>
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (date && !DATE_RE.test(date)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')
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

// ─── GET /wms/fill/tasks ────────────────────────────────────────────────────
export async function listFillTasks(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    if (!q.warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, q.warehouse_id)) return
    for (const d of [q.date_from, q.date_to])
      if (d && !DATE_RE.test(d)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')

    const page     = Math.max(1, Number(q.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(q.page_size) || 100))
    // `?status=` rỗng nghĩa là "không trạng thái nào" → trả rỗng, KHÔNG bỏ lọc (parseListParam)
    const status   = parseListParam(q.status)
    // "Việc của tôi": lấy id từ TOKEN, không tin id client gửi
    const assignee = q.mine === '1' || q.mine === 'true' ? selfId(req) : (q.assignee_id || null)
    if ((q.mine === '1' || q.mine === 'true') && !assignee) return ok(res, { rows: [], total: 0 })

    const { data, error } = await supabase.rpc('fill_tasks_page', {
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
      if (error.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply migration 20260804 (fill hàng)')
      return fail(res, 500, 'DB_ERROR', error.message)
    }
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── LOẠI KHO: vị trí đích phải NHẬN loại của mã hàng ────────────────────────
// Cùng khuôn với picker vị trí toàn app (Tồn kho / Vị trí kho): vị trí nhận mã ⇔ `categories`
// chứa loại của mã, HOẶC vị trí chưa khai loại (NULL), HOẶC mã chưa khai loại — null-inclusive
// hai chiều. Thiếu luật này thì hàng FG02 bị hạ về khu FG01 (user bắt 05/08).
function locAcceptsCat(locCats: string[] | null, matCat: string | null): boolean {
  return !locCats || !matCat || locCats.includes(matCat)
}

// ─── Chỉ mục vị trí nhặt lẻ còn chỗ (dựng MỘT LẦN cho cả lô ra lệnh) ─────────
// Ưu tiên chỗ ĐANG chứa đúng mã đó (nhặt một chỗ, khỏi chạy vòng kho), rồi tới chỗ trống nhiều.
// `free` bị TRỪ DẦN khi gán để 10 pallet cùng mã không dồn hết vào một ô 2 slot.
type PickFaceIdx = {
  locs: { id: string; code: string; cats: string[] | null; free: number }[]
  hasMat: Map<string, Set<string>>   // material_id → location_id đang chứa mã đó
}
async function buildPickFaceIdx(warehouseId: string, materialIds: string[]): Promise<PickFaceIdx> {
  const { data: locRaw } = await supabase.from('Location')
    .select('id, location_code, max_pallets, categories')
    .eq('warehouse_id', warehouseId).eq('is_pick_face', true).eq('is_active', true)
    .order('location_code').limit(1000)
  const locs = (locRaw ?? []) as { id: string; location_code: string; max_pallets: number | null; categories: string[] | null }[]
  if (!locs.length) return { locs: [], hasMat: new Map() }
  const ids = locs.map(l => l.id)

  // Chỗ đã chiếm — ĐỊNH NGHĨA KHỚP RPC move_pallets_to_location (nơi thực sự chặn lúc quét):
  // IN_STOCK/PARTIAL/QUARANTINE, cartons_remaining > 0. Đếm khác nơi gác thì hoặc gợi ý chỗ để
  // rồi quét báo đầy, hoặc bỏ sót chỗ còn trống.
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
function takePickFace(idx: PickFaceIdx, materialId: string, matCat: string | null): { id: string; code: string } | null {
  const same = idx.hasMat.get(materialId)
  const pool = idx.locs.filter(l => l.free > 0 && locAcceptsCat(l.cats, matCat))
  if (!pool.length) return null
  pool.sort((a, b) => {
    const sa = same?.has(a.id) ? 0 : 1, sb = same?.has(b.id) ? 0 : 1
    return sa !== sb ? sa - sb : (b.free - a.free) || a.code.localeCompare(b.code)
  })
  const hit = pool[0]
  hit.free -= 1                       // giữ chỗ trong phạm vi lô này
  if (!same) idx.hasMat.set(materialId, new Set([hit.id]))
  else same.add(hit.id)
  return { id: hit.id, code: hit.code }
}

type EntryRow = {
  id: string; pallet_code: string; material_id: string; location_id: string | null
  status: string; cartons_remaining: number; cartons_reserved: number | null
}

// ─── POST /wms/fill/tasks — RA LỆNH (một lệnh = một pallet) ──────────────────
// body { warehouse_id, target_date, items: [{ entry_id, to_location_id?, assignee_id? }] }
export async function createFillTasks(req: Request, res: Response) {
  try {
    const { warehouse_id, target_date, items } = req.body as {
      warehouse_id?: string; target_date?: string
      items?: { entry_id?: string; to_location_id?: string; assignee_id?: string }[]
    }
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, warehouse_id)) return
    const day = target_date || vnToday()
    if (!DATE_RE.test(day)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')
    const list = (Array.isArray(items) ? items : []).filter(i => i && typeof i.entry_id === 'string')
    if (!list.length) return fail(res, 400, 'INVALID_INPUT', 'Chưa chọn pallet nào')
    if (list.length > 500) return fail(res, 400, 'TOO_MANY', 'Tối đa 500 lệnh mỗi lần — chia nhỏ giúp')

    const entryIds = [...new Set(list.map(i => i.entry_id as string))]
    // Nạp pallet THẬT từ DB (không tin body): đúng kho, còn khả dụng, KHÔNG nằm sẵn ở vị trí nhặt lẻ
    const entries: EntryRow[] = []
    for (let i = 0; i < entryIds.length; i += 300) {
      const { data, error } = await supabase.from('InventoryEntry')
        .select('id, pallet_code, material_id, location_id, status, cartons_remaining, cartons_reserved, location:Location!location_id(warehouse_id, is_pick_face, location_code)')
        .in('id', entryIds.slice(i, i + 300))
      if (error) throw error
      // Embed PostgREST về dưới dạng object HOẶC mảng tuỳ chỗ (client chưa có generic Database)
      type LocEmb = { warehouse_id: string | null; is_pick_face: boolean | null; location_code: string | null }
      const rows = (data ?? []) as unknown as (EntryRow & { location: LocEmb | LocEmb[] | null })[]
      for (const raw of rows) {
        const loc = Array.isArray(raw.location) ? raw.location[0] : raw.location
        if (loc?.warehouse_id !== warehouse_id) continue          // pallet kho khác → bỏ (IDOR)
        if (loc?.is_pick_face) continue                            // đã ở vị trí nhặt lẻ rồi
        entries.push(raw)
      }
    }
    const byId = new Map(entries.map(e => [e.id, e]))

    // Vị trí đích hợp lệ (thuộc kho + đang bật cờ nhặt lẻ + còn hoạt động) — kiểm ở BE, không tin
    // FE. `categories` giữ lại để so LOẠI KHO với từng mã ở vòng dưới (đích phải nhận loại của mã).
    const destIds = [...new Set(list.map(i => i.to_location_id).filter(Boolean))] as string[]
    const destOk = new Map<string, { code: string; cats: string[] | null }>()
    if (destIds.length) {
      const { data } = await supabase.from('Location')
        .select('id, location_code, categories').in('id', destIds.slice(0, 300))
        .eq('warehouse_id', warehouse_id).eq('is_pick_face', true).eq('is_active', true)
      for (const d of (data ?? []) as { id: string; location_code: string; categories: string[] | null }[])
        destOk.set(d.id, { code: d.location_code, cats: d.categories })
    }

    // Người được gán: chỉ nhận nhân sự CÒN HOẠT ĐỘNG (tên chụp lại để báo cáo không vỡ khi đổi tên)
    const empIds = [...new Set(list.map(i => i.assignee_id).filter(Boolean))] as string[]
    const empMap = new Map<string, string>()
    if (empIds.length) {
      const { data } = await supabase.from('Employee')
        .select('id, name').in('id', empIds.slice(0, 300)).eq('is_active', true)
      for (const e of (data ?? []) as { id: string; name: string }[]) empMap.set(e.id, e.name)
    }

    const matIds = [...new Set(entries.map(e => e.material_id).filter(Boolean))]
    const matMap = new Map<string, { material_code: string; short_name: string | null; category: string | null }>()
    for (let i = 0; i < matIds.length; i += 300) {
      const { data } = await supabase.from('Material')
        .select('id, material_code, short_name, category').in('id', matIds.slice(i, i + 300))
      for (const m of (data ?? []) as { id: string; material_code: string; short_name: string | null; category: string | null }[])
        matMap.set(m.id, { material_code: m.material_code, short_name: m.short_name, category: m.category })
    }

    const t = now()
    const actor = req.user?.name || null
    const skipped: { entry_id: string; pallet_code?: string; reason: string }[] = []
    const rows: Record<string, unknown>[] = []
    const pfIdx = await buildPickFaceIdx(warehouse_id, matIds)

    for (const it of list) {
      const e = byId.get(it.entry_id as string)
      if (!e) { skipped.push({ entry_id: it.entry_id as string, reason: 'Pallet không thuộc kho này, hoặc đã ở vị trí nhặt lẻ' }); continue }
      const avail = Math.max(0, Number(e.cartons_remaining) - Number(e.cartons_reserved ?? 0))
      if (!USABLE.includes(e.status) || avail <= 0) {
        skipped.push({ entry_id: e.id, pallet_code: e.pallet_code, reason: 'Pallet đã hết khả dụng / đang giữ' }); continue
      }
      const mat = matMap.get(e.material_id)
      const matCat = mat?.category ?? null
      // Đích user chỉ định: ngoài kho/cờ/hoạt động (đã lọc ở destOk) còn phải NHẬN loại của mã —
      // chỉ định sai thì BÁO RÕ và bỏ dòng đó, KHÔNG âm thầm đổi sang chỗ khác thay user
      let destId: string | null = null
      let destCode: string | null = null
      if (it.to_location_id) {
        const d = destOk.get(it.to_location_id)
        if (d && !locAcceptsCat(d.cats, matCat)) {
          skipped.push({ entry_id: e.id, pallet_code: e.pallet_code,
            reason: `Vị trí ${d.code} không nhận Loại kho ${matCat} của mã này` }); continue
        }
        if (d) { destId = it.to_location_id; destCode = d.code }
      }
      if (!destId) {
        const b = takePickFace(pfIdx, e.material_id, matCat)
        if (b) { destId = b.id; destCode = b.code }
      }
      if (!destId) {
        skipped.push({ entry_id: e.id, pallet_code: e.pallet_code,
          reason: 'Không còn vị trí nhặt lẻ trống nhận Loại kho của mã này' }); continue
      }
      const asgId = it.assignee_id && empMap.has(it.assignee_id) ? it.assignee_id : null
      rows.push({
        id: randomUUID(), warehouse_id, target_date: day,
        material_id: e.material_id, material_code: mat?.material_code ?? null, material_name: mat?.short_name ?? null,
        entry_id: e.id, pallet_code: e.pallet_code,
        from_location_id: e.location_id, from_location_code: null,
        to_location_id: destId, to_location_code: destCode,
        qty_base: avail, status: 'PENDING',
        assignee_id: asgId, assignee_name: asgId ? empMap.get(asgId)! : null,
        assigned_by: asgId ? actor : null, assigned_at: asgId ? t : null,
        created_by: actor, created_at: t, updated_at: t,
      })
    }

    // Mã vị trí nguồn (hiển thị) — tra một lượt thay vì mỗi dòng một câu
    const fromIds = [...new Set(rows.map(r => r.from_location_id).filter(Boolean))] as string[]
    if (fromIds.length) {
      const { data } = await supabase.from('Location').select('id, location_code').in('id', fromIds.slice(0, 300))
      const m = new Map((data ?? []).map((l: { id: string; location_code: string }) => [l.id, l.location_code]))
      for (const r of rows) if (r.from_location_id) r.from_location_code = m.get(r.from_location_id as string) ?? null
    }

    // Ghi theo LÔ; đụng unique index (pallet đã có lệnh treo — người khác vừa ra lệnh) thì lô đó
    // hỏng NGUYÊN LÔ, nên rơi xuống ghi từng dòng để chỉ đúng pallet hỏng thay vì bỏ cả mẻ.
    let created = 0
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const { error } = await supabase.from('FillTask').insert(batch)
      if (!error) { created += batch.length; continue }
      for (const r of batch) {
        const { error: e1 } = await supabase.from('FillTask').insert(r)
        if (!e1) { created++; continue }
        skipped.push({
          entry_id: r.entry_id as string, pallet_code: r.pallet_code as string,
          reason: (e1 as { code?: string }).code === '23505'
            ? 'Pallet này vừa có người khác ra lệnh' : 'Không ghi được lệnh',
        })
      }
    }
    return res.status(201).json({ success: true, data: { created, skipped } })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── PATCH /wms/fill/tasks/:id — gán người / đổi vị trí đích ─────────────────
// Đổi đích PHẢI có: đích đầy thì lệnh kẹt vĩnh viễn (quét luôn trả LOCATION_FULL) — đúng loại
// "ngõ cụt" mà app đã dính vài lần. Gán người = quyền `assign`; đổi đích = quyền `plan`.
export async function updateFillTask(req: Request, res: Response) {
  try {
    const { assignee_id, to_location_id } = req.body as { assignee_id?: string | null; to_location_id?: string }
    const hasAsg  = assignee_id !== undefined
    const hasDest = to_location_id !== undefined
    if (!hasAsg && !hasDest) return fail(res, 400, 'INVALID_INPUT', 'Không có gì để sửa')

    const { data: task } = await supabase.from('FillTask')
      .select('id, warehouse_id, status, material_id').eq('id', req.params.id).maybeSingle()
    if (!task) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    if (!guardWarehouse(req, res, task.warehouse_id as string)) return
    if (task.status !== 'PENDING') return fail(res, 409, 'NOT_PENDING', 'Lệnh đã xong hoặc đã hủy — không sửa được')

    const perms = req.user?.module_permissions ?? {}
    const isAdmin = req.user?.is_superadmin === true || req.user?.name === 'Admin'
    const may = (a: string) => isAdmin || (perms.fill ?? []).includes(a)
    if (hasAsg  && !may('assign')) return fail(res, 403, 'FORBIDDEN', 'Không có quyền gán lệnh fill')
    if (hasDest && !may('plan'))   return fail(res, 403, 'FORBIDDEN', 'Không có quyền sửa lệnh fill')

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
      // LOẠI KHO: đích mới phải nhận loại của mã trên lệnh (mã FG02 không hạ về khu FG01)
      const { data: mat } = task.material_id
        ? await supabase.from('Material').select('category').eq('id', task.material_id).maybeSingle()
        : { data: null }
      if (!locAcceptsCat(loc.categories as string[] | null, (mat?.category as string | null) ?? null))
        return fail(res, 400, 'CATEGORY_MISMATCH',
          `Vị trí ${loc.location_code} không nhận Loại kho ${mat?.category} của mã trên lệnh`)
      Object.assign(patch, { to_location_id: loc.id, to_location_code: loc.location_code })
    }

    const { data, error } = await supabase.from('FillTask')
      .update(patch).eq('id', task.id).eq('status', 'PENDING').select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 409, 'NOT_PENDING', 'Lệnh vừa đổi trạng thái — tải lại danh sách')
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── DELETE /wms/fill/tasks/:id — HỦY (giữ dòng để tra cứu, không xóa cứng) ──
export async function cancelFillTask(req: Request, res: Response) {
  try {
    const { data: task } = await supabase.from('FillTask')
      .select('id, warehouse_id, status').eq('id', req.params.id).maybeSingle()
    if (!task) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy lệnh fill')
    if (!guardWarehouse(req, res, task.warehouse_id as string)) return
    if (task.status === 'DONE') return fail(res, 409, 'ALREADY_DONE', 'Lệnh đã hoàn thành — không hủy được')

    const reason = String((req.body as { reason?: string })?.reason ?? '').trim() || null
    const { data, error } = await supabase.from('FillTask')
      .update({ status: 'CANCELLED', cancel_reason: reason, updated_at: now() })
      .eq('id', task.id).neq('status', 'DONE').select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 409, 'ALREADY_DONE', 'Lệnh vừa được hoàn thành — không hủy được')
    return ok(res, data)
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── POST /wms/fill/scan — QUÉT THỰC HIỆN ───────────────────────────────────
// body { qr, warehouse_id, take_over? }
// Luật: pallet phải ĐANG Ở ĐÚNG vị trí nguồn (khớp slotting) — quét pallet đứng chỗ khác mà vẫn
// nhận thì vị trí trong hệ thống sai. Lệnh của người khác → 409 NOT_YOUR_TASK; ai có quyền `assign`
// bấm "Nhận lệnh này" (take_over) mới chuyển sang mình — KHÔNG cướp việc âm thầm.
export async function scanFill(req: Request, res: Response) {
  try {
    const { qr, warehouse_id, take_over } = req.body as { qr?: string; warehouse_id?: string; take_over?: boolean }
    if (!qr || !String(qr).trim()) return fail(res, 400, 'INVALID_INPUT', 'Thiếu mã QR')
    if (!warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, warehouse_id)) return

    const code = normalizeQR(String(qr))
    const { data: tasks } = await supabase.from('FillTask')
      .select('*').eq('warehouse_id', warehouse_id).eq('pallet_code', code).eq('status', 'PENDING')
      .order('target_date').order('created_at')
    const task = ((tasks ?? []) as Record<string, unknown>[])[0]
    if (!task) return fail(res, 404, 'NO_TASK', 'Pallet này không có lệnh fill nào đang chờ')

    const me = selfId(req)
    const asg = task.assignee_id as string | null
    if (asg && me && asg !== me) {
      const perms = req.user?.module_permissions ?? {}
      const isAdmin = req.user?.is_superadmin === true || req.user?.name === 'Admin'
      const mayAssign = isAdmin || (perms.fill ?? []).includes('assign')
      if (!take_over) return fail(res, 409, 'NOT_YOUR_TASK', `Lệnh này đã giao cho ${task.assignee_name ?? 'người khác'}`)
      if (!mayAssign) return fail(res, 403, 'FORBIDDEN', 'Không có quyền nhận lệnh của người khác')
    }

    const { data: entry } = await supabase.from('InventoryEntry')
      .select('id, location_id, status, cartons_remaining, cartons_reserved')
      .eq('id', task.entry_id as string).maybeSingle()
    if (!entry) return fail(res, 404, 'PALLET_NOT_FOUND', 'Không còn tìm thấy pallet của lệnh')
    if (!USABLE.includes(entry.status as string) || Number(entry.cartons_remaining) <= 0)
      return fail(res, 409, 'GONE', 'Pallet đã hết tồn / đã xuất — hủy lệnh này rồi ra lệnh pallet khác')

    const t = now()
    const meName = req.user?.name || null
    // Đã đứng sẵn ở đích (ai đó hạ hộ bằng chức năng Đổi vị trí) → chốt DONE, KHÔNG gọi move lần nữa
    if (entry.location_id === task.to_location_id) {
      const { data: doneRow } = await supabase.from('FillTask')
        .update({ status: 'DONE', done_at: t, done_by: me, done_by_name: meName, updated_at: t })
        .eq('id', task.id as string).eq('status', 'PENDING').select().maybeSingle()
      if (!doneRow) return fail(res, 409, 'NOT_PENDING', 'Lệnh vừa được người khác hoàn thành')
      return ok(res, { task: doneRow, moved: false, message: 'Pallet đã ở vị trí đích — ghi nhận hoàn thành' })
    }
    if (entry.location_id !== task.from_location_id) {
      const { data: cur } = entry.location_id
        ? await supabase.from('Location').select('location_code').eq('id', entry.location_id).maybeSingle()
        : { data: null }
      return fail(res, 409, 'NOT_AT_SOURCE',
        `Pallet không còn ở vị trí nguồn của lệnh (đang ở ${cur?.location_code ?? 'vị trí khác'}) — không nhận`)
    }

    // Chuyển vị trí NGUYÊN TỬ (RPC khoá dòng Location → đếm sức chứa dưới lock). Đích đầy →
    // LOCATION_FULL và lệnh VẪN TREO để đổi đích, không mất việc.
    const { data: result, error: rpcErr } = await supabase.rpc('move_pallets_to_location', {
      p_ids: [entry.id], p_location_id: task.to_location_id as string,
      p_updated_by: me, p_update_date: vnToday(), p_now: t,
    })
    if (rpcErr) {
      if (rpcErr.code === 'PGRST202') return fail(res, 503, 'NOT_READY', 'Chưa apply RPC move_pallets_to_location')
      return fail(res, 500, 'DB_ERROR', rpcErr.message)
    }
    const parts = String(result ?? '').split('|')
    if (parts[0] === 'NOT_FOUND') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí đích')
    if (parts[0] === 'INACTIVE')  return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí đích không hoạt động')
    if (parts[0] === 'FULL')
      return fail(res, 400, 'LOCATION_FULL',
        `Vị trí đích ${task.to_location_code ?? ''} đã đầy — đổi vị trí đích cho lệnh rồi quét lại`)

    // Chuyển xong mới chốt DONE (CAS trên status: hai người cùng quét thì chỉ một người ghi được)
    const patch: Record<string, unknown> = {
      status: 'DONE', done_at: t, done_by: me, done_by_name: meName, updated_at: t,
    }
    if (!asg && me) Object.assign(patch, { assignee_id: me, assignee_name: meName, assigned_by: meName, assigned_at: t })
    if (asg && me && asg !== me && take_over)
      Object.assign(patch, { assignee_id: me, assignee_name: meName, assigned_by: meName, assigned_at: t })
    const { data: doneRow } = await supabase.from('FillTask')
      .update(patch).eq('id', task.id as string).eq('status', 'PENDING').select().maybeSingle()
    return ok(res, { task: doneRow ?? { ...task, ...patch }, moved: true })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// ─── GET /wms/fill/report?warehouse_id&date_from&date_to ────────────────────
export async function getFillReport(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    if (!q.warehouse_id) return fail(res, 400, 'INVALID_INPUT', 'Thiếu kho')
    if (!guardWarehouse(req, res, q.warehouse_id)) return
    for (const d of [q.date_from, q.date_to])
      if (d && !DATE_RE.test(d)) return fail(res, 400, 'INVALID_INPUT', 'Ngày không hợp lệ (YYYY-MM-DD)')

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
// Ô chọn "đổi vị trí đích" — chỉ vị trí nhặt lẻ của kho (danh sách nhỏ, không phải danh mục lớn).
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
