/**
 * VIỆC CẦN LÀM — 3 bảng theo vai (Directed Work đợt 1c, user chốt 10/09/2026).
 *
 *   LOWER = lái xe nâng HẠ  (toàn kho, có thứ tự — xe đứng bãi chờ hạ lên trước)
 *   MOVE  = lái xe nâng CHUYỂN (việc của mình; thấy VỊ TRÍ HIỆN TẠI của pallet kể cả đang trên kệ)
 *   SCAN  = thủ kho (theo chuyến, từng pallet vì quét theo tem)
 *
 * Mọi ghi trạng thái việc đi qua `services/directedTasks.ts` — controller này chỉ gác quyền/phạm vi
 * rồi gọi service (ratchet `task_status_written_outside_service` gác).
 */
import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { searchLooksLikeInjection } from '../../utils/search'
import { isQueryTimeout, QUERY_TIMEOUT_MSG, fetchAllRowsParallel, fetchAllByIdChunks } from '../../utils/pagination'
import { replanGdoTasks, drainReplanQueue, confirmTasks, claimTasks, MAX_CONFIRM, type ConfirmStage } from '../../services/directedTasks'
import { reorderCrossTripPickup, orderLocationsFromDock, type RoutableRow } from '../../services/directedRoute'
// Gợi ý "Vị trí lấy" của trang chuyến / nhặt lẻ — đường đi nhặt lẻ xếp thứ tự trên CHÍNH gợi ý này
import { rotationSuggestionsByMaterial, rotationConfigOf } from './outboundController'

const MODES = ['LOWER', 'MOVE', 'SCAN'] as const
type Mode = typeof MODES[number]

function scopeWhIds(req: Request): string[] | null {
  return req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
}

const badId = (v: unknown, max = 100) =>
  typeof v !== 'string' || !v || v.length > max || searchLooksLikeInjection(v)

/** GET /wms/directed/board?warehouse_id&mode&gdo_id&driver_id */
export async function getBoard(req: Request, res: Response) {
  try {
    const whId = String(req.query.warehouse_id ?? '')
    if (badId(whId)) return fail(res, 400, 'BAD_ID', 'Thiếu hoặc sai mã kho')
    const myWhs = scopeWhIds(req)
    if (myWhs && !myWhs.includes(whId)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)

    const mode = String(req.query.mode ?? 'MOVE').toUpperCase() as Mode
    if (!MODES.includes(mode)) return fail(res, 400, 'VALIDATION_ERROR', 'Chế độ xem không hợp lệ (LOWER / MOVE / SCAN)')

    const gdoId = req.query.gdo_id ? String(req.query.gdo_id) : null
    if (gdoId && badId(gdoId)) return fail(res, 400, 'BAD_ID', 'Mã chuyến không hợp lệ')
    if (mode === 'SCAN' && !gdoId) return fail(res, 400, 'VALIDATION_ERROR', 'Bảng "Sắp quét" cần chọn chuyến')

    const driverId = req.query.driver_id ? String(req.query.driver_id) : null
    if (driverId && badId(driverId)) return fail(res, 400, 'BAD_ID', 'Mã nhân sự không hợp lệ')

    // TỒN ĐỔI TỪ LẦN TẢI TRƯỚC → sắp lại việc chưa ai đụng TRƯỚC khi đọc bảng (14/09, user: "tại thời
    // điểm hạ họ check được tồn mới nhất"). Hàng đợi thường rỗng ⇒ một câu DELETE trả 0 dòng.
    const drained = await drainReplanQueue(whId)

    const { data, error } = await supabase.rpc('directed_board', {
      p_warehouse_id: whId, p_mode: mode, p_gdo_id: gdoId, p_driver_id: driverId,
    })
    if (error) return fail(res, error)
    const board = (data ?? { rows: [], totals: {}, unset_items: [] }) as {
      rows?: RoutableRow[]; settings?: { cross_trip_pick_radius?: number }; auto_replanned?: number
    }
    board.auto_replanned = drained.replanned
    // NHẶT DỌC ĐƯỜNG (13/09) — chỉ bảng "Cần hạ", chỉ khi kho khai bán kính. Ở bảng "Cần đưa ra"
    // mỗi việc đều kết thúc tại cửa nên tổng quãng đường KHÔNG phụ thuộc thứ tự; sắp lại ở đó chỉ
    // làm người ta nhảy chuyến mà không được gì. Sắp ở BACKEND vì BFS trên lưới 200×200 thuộc về
    // `utils/warehouseGrid.ts` — nguồn DUY NHẤT của phép đo đường đi, đừng chép bản thứ hai xuống SQL.
    const radius = Number(board.settings?.cross_trip_pick_radius ?? 0)
    if (mode === 'LOWER' && radius > 0 && Array.isArray(board.rows)) {
      board.rows = await reorderCrossTripPickup(board.rows, whId, radius)
    }
    return ok(res, board)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

/**
 * POST /wms/directed/tasks/confirm { task_ids, stage, undo? } — nút "✓ Xong".
 * Bảng xe nâng gom theo VỊ TRÍ nên FE gửi cả nhóm một lần (một lần bấm = một lần ghi).
 */
export async function confirm(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { task_ids?: unknown; stage?: unknown; undo?: unknown; restore?: unknown }
    const ids = Array.isArray(body.task_ids) ? body.task_ids : []
    if (!ids.length) return fail(res, 400, 'VALIDATION_ERROR', 'Chưa chọn việc nào')
    if (ids.length > 200) return fail(res, 400, 'VALIDATION_ERROR', 'Tối đa 200 việc mỗi lần bấm')
    if (ids.some(id => badId(id))) return fail(res, 400, 'BAD_ID', 'Mã việc không hợp lệ')
    const stage = String(body.stage ?? '').toUpperCase()
    if (stage !== 'LOWER' && stage !== 'MOVE' && stage !== 'BOTH')
      return fail(res, 400, 'VALIDATION_ERROR', 'Giai đoạn không hợp lệ (LOWER / MOVE / BOTH)')

    if (!(await tasksInScope(req, res, ids as string[]))) return

    // actor = TÊN (hiện trên bảng "ai làm"); actorId = ID nhân viên (ghi vào InventoryEntry.updated_by,
    // cột có khoá ngoại — truyền tên vào là 23503 và pallet đứng im, vá 13/09).
    // restore = hoàn tác việc nhặt lẻ VÀ ghi pallet lại về ô cũ (FE hỏi người bấm "hàng đưa xuống chưa?")
    const r = await confirmTasks(ids as string[], stage as ConfirmStage, body.undo === true,
      req.user?.name ?? null, req.user?.sub ?? null, body.undo === true && body.restore === true)
    if (!r.ok) return fail(res, r.status, r.code, r.message)
    return ok(res, r)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

// ─── HỘP VIỆC THEO NGƯỜI (đợt C, 12/09) ────────────────────────────────────────────────────────
// RPC `work_inbox` trả MỌI nguồn việc kèm quyền cần có (pm/pa); controller lọc theo quyền người gọi:
// có quyền → giữ nguyên vùng; không có quyền mà dòng có bản "chờ" (wv) → rơi xuống WAITING với câu chờ;
// không có gì → bỏ. Quyền quyết định ở ĐÂY (một chỗ), RPC không biết ai đang hỏi.
type InboxRow = {
  zone: 'MINE' | 'SHARED' | 'WAITING'; source: string; key: string
  warehouse_id: string; wh_name: string | null; title: string; sub: string | null; n: number; link: string
  pm: string; pa: string; wv: boolean; sub_wait: string | null
}
const userHasPerm = (req: Request, mod: string, action: string): boolean =>
  req.user?.is_superadmin === true || (req.user?.module_permissions?.[mod] ?? []).includes(action)

/** GET /wms/directed/inbox?warehouse_id= — kho bỏ trống = mọi kho trong phạm vi (badge bottom-nav dùng dạng này) */
export async function getInbox(req: Request, res: Response) {
  try {
    const whId = req.query.warehouse_id ? String(req.query.warehouse_id) : ''
    if (whId && badId(whId)) return fail(res, 400, 'BAD_ID', 'Mã kho không hợp lệ')
    const myWhs = scopeWhIds(req)
    if (whId && myWhs && !myWhs.includes(whId)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    // Phạm vi kho rỗng ≠ không giới hạn (memory empty-scope-means-unlimited): người chưa được giao kho thấy hộp trống
    if (!whId && myWhs && myWhs.length === 0) return ok(res, { mine: [], shared: [], waiting: [], counts: { mine: 0, shared: 0, waiting: 0 } })
    const ids: string[] | null = whId ? [whId] : myWhs
    const { data, error } = await supabase.rpc('work_inbox', { p_warehouse_ids: ids, p_employee_id: req.user?.sub ?? '' })
    if (error) return fail(res, error)
    const rows = ((data as { rows?: InboxRow[] } | null)?.rows ?? [])
    const out = { mine: [] as InboxRow[], shared: [] as InboxRow[], waiting: [] as InboxRow[] }
    for (const r of rows) {
      if (userHasPerm(req, r.pm, r.pa)) {
        (r.zone === 'MINE' ? out.mine : r.zone === 'SHARED' ? out.shared : out.waiting).push(r)
      } else if (r.wv) {
        out.waiting.push({ ...r, zone: 'WAITING', sub: r.sub_wait ?? r.sub, link: '' })
      }
    }
    const sum = (a: InboxRow[]) => a.reduce((s, r) => s + Number(r.n ?? 0), 0)
    return ok(res, { ...out, counts: { mine: sum(out.mine), shared: sum(out.shared), waiting: sum(out.waiting) } })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

/** GET /wms/directed/supervision?warehouse_id=&days= — góc nhìn giám sát (quyền replan) */
export async function getSupervision(req: Request, res: Response) {
  try {
    const whId = String(req.query.warehouse_id ?? '')
    if (badId(whId)) return fail(res, 400, 'BAD_ID', 'Thiếu hoặc sai mã kho')
    const myWhs = scopeWhIds(req)
    if (myWhs && !myWhs.includes(whId)) return fail(res, 'Kho này ngoài phạm vi được giao', 403)
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7) || 7))
    const { data, error } = await supabase.rpc('directed_supervision', { p_warehouse_id: whId, p_days: days })
    if (error) return fail(res, error)
    return ok(res, data ?? {})
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

/** PHẠM VI KHO: việc thuộc kho ngoài phạm vi thì không được đánh dấu / nhận (id việc là uuid đoán được). */
async function tasksInScope(req: Request, res: Response, ids: string[]): Promise<boolean> {
  const myWhs = scopeWhIds(req)
  if (!myWhs) return true
  const { data: whs } = await supabase.from('wms_tasks').select('warehouse_id').in('id', ids).limit(MAX_CONFIRM)
  const outside = ((whs ?? []) as { warehouse_id: string }[]).filter(t => !myWhs.includes(t.warehouse_id))
  if (outside.length) { fail(res, 'Có việc thuộc kho ngoài phạm vi được giao', 403); return false }
  return true
}

/**
 * POST /wms/directed/tasks/claim { task_ids, undo? } — nút "Nhận" việc chung (12/09).
 * Cùng quyền `confirm`: nhận là bước trước của ✓ Xong, không phải năng lực riêng.
 */
export async function claim(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { task_ids?: unknown; undo?: unknown }
    const ids = Array.isArray(body.task_ids) ? body.task_ids : []
    if (!ids.length) return fail(res, 400, 'VALIDATION_ERROR', 'Chưa chọn việc nào')
    if (ids.length > MAX_CONFIRM) return fail(res, 400, 'VALIDATION_ERROR', `Tối đa ${MAX_CONFIRM} việc mỗi lần bấm`)
    if (ids.some(id => badId(id))) return fail(res, 400, 'BAD_ID', 'Mã việc không hợp lệ')
    if (!(await tasksInScope(req, res, ids as string[]))) return
    const r = await claimTasks(ids as string[], req.user?.sub ?? null, req.user?.name ?? null, body.undo === true)
    if (!r.ok) return fail(res, r.status, r.code, r.message)
    return ok(res, r)
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

/** POST /wms/directed/gdos/:id/replan — sắp lại kế hoạch (bản vẽ đổi, đơn đổi, muốn tính lại đường đi) */
/**
 * GET /wms/directed/loose-route?gdo_id= — ĐƯỜNG ĐI NHẶT LẺ của một chuyến (user 14/09 "A → B → C sao
 * cho hợp lý"). Vị trí lấy của mỗi mã = gợi ý ĐẦU của cột "Vị trí lấy" (cùng `rotationSuggestionsByMaterial`,
 * cùng luật luân chuyển + QA); thứ tự ghé = BFS từ cửa của chuyến qua các vị trí đó. Không giữ chỗ,
 * không ghi gì — chỉ xếp thứ tự cho người nhặt.
 */
export async function getLooseRoute(req: Request, res: Response) {
  try {
    const gdoId = String(req.query.gdo_id ?? '')
    if (badId(gdoId)) return fail(res, 400, 'BAD_ID', 'Thiếu hoặc sai mã chuyến')
    const { data: gdo, error: gErr } = await supabase.from('GroupDeliveryOrder')
      .select('id, warehouse_id, dock_location_id').eq('id', gdoId).maybeSingle()
    if (gErr) return fail(res, gErr)              // id rác trên cột uuid = 22P02 ⇒ 400, không phải "không tìm thấy"
    if (!gdo) return fail(res, 'Không tìm thấy chuyến', 404)
    const g = gdo as { id: string; warehouse_id: string | null; dock_location_id: string | null }
    const myWhs = scopeWhIds(req)
    if (myWhs && g.warehouse_id && !myWhs.includes(g.warehouse_id)) return fail(res, 'Chuyến thuộc kho ngoài phạm vi được giao', 403)
    const whId = g.warehouse_id
    if (!whId) return ok(res, { routed: false, start_code: null, stops: [], unlocated: [] })

    const dos = await fetchAllRowsParallel(() => supabase.from('OutboundDelivery').select('id').eq('gdo_id', gdoId).order('id'))
    const doIds = ((dos ?? []) as { id: string }[]).map(d => d.id)
    const items = doIds.length ? await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
      .select('id, material_id, material_code_raw, loose_picking, cartons_ordered, cartons_scanned')
      .in('do_id', chunk).gt('loose_picking', 0).order('id')) as unknown as Array<{
        id: string; material_id: string | null; material_code_raw: string | null; loose_picking: number | null
        cartons_ordered: number | null; cartons_scanned: number | null
      }> : []
    // Dòng đã lấy đủ thì khỏi ghé
    const open = items.filter(it => Number(it.cartons_scanned ?? 0) < Number(it.cartons_ordered ?? 0))
    const matIds = [...new Set(open.map(it => it.material_id).filter((x): x is string => !!x))]
    if (!matIds.length) return ok(res, { routed: false, start_code: null, stops: [], unlocated: [] })

    const sug = await rotationSuggestionsByMaterial(matIds, [whId], await rotationConfigOf([whId]))
    const codeByMat = new Map<string, { code: string; pct_date: number | null; available: number }>()
    for (const m of matIds) {
      const first = (sug.get(m) ?? []).find(s => !!s.location_code)
      if (first?.location_code) codeByMat.set(m, { code: first.location_code, pct_date: first.pct_date, available: first.available })
    }
    const codes = [...new Set([...codeByMat.values()].map(v => v.code))]
    const locRows = codes.length ? await fetchAllByIdChunks(codes, chunk => supabase.from('Location')
      .select('id, location_code, row, is_pick_face').eq('warehouse_id', whId).in('location_code', chunk).order('id')) as unknown as
      Array<{ id: string; location_code: string; row: string | null; is_pick_face: boolean | null }> : []
    const locByCode = new Map(locRows.map(l => [l.location_code, l]))

    const { order, routed } = await orderLocationsFromDock(whId, g.dock_location_id, [...locByCode.values()].map(l => l.id))
    const seqOfLoc = new Map(order.map((id, i) => [id, i + 1]))
    type Stop = { seq: number; location_id: string; location_code: string; is_pick_face: boolean; materials: Array<{ item_id: string; material_id: string; material_code: string | null; pct_date: number | null; available: number }> }
    const stops = new Map<string, Stop>()
    const unlocated: Array<{ item_id: string; material_code: string | null }> = []
    for (const it of open) {
      const v = it.material_id ? codeByMat.get(it.material_id) : null
      const loc = v ? locByCode.get(v.code) : null
      if (!v || !loc) { unlocated.push({ item_id: it.id, material_code: it.material_code_raw }); continue }
      const s = stops.get(loc.id) ?? { seq: seqOfLoc.get(loc.id) ?? 0, location_id: loc.id, location_code: loc.location_code, is_pick_face: loc.is_pick_face === true, materials: [] }
      s.materials.push({ item_id: it.id, material_id: it.material_id!, material_code: it.material_code_raw, pct_date: v.pct_date, available: v.available })
      stops.set(loc.id, s)
    }
    let startCode: string | null = null
    if (g.dock_location_id) {
      const { data: dk } = await supabase.from('Location').select('row, location_code').eq('id', g.dock_location_id).maybeSingle()
      startCode = (dk as { row: string | null; location_code: string } | null)?.row ?? (dk as { location_code: string } | null)?.location_code ?? null
    }
    return ok(res, { routed, start_code: startCode, stops: [...stops.values()].sort((a, b) => a.seq - b.seq), unlocated })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

export async function replan(req: Request, res: Response) {
  try {
    if (badId(req.params.id)) return fail(res, 400, 'BAD_ID', 'Mã chuyến không hợp lệ')
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('id, warehouse_id').eq('id', req.params.id).maybeSingle()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến', 404)
    const myWhs = scopeWhIds(req)
    const whId = (gdo as { warehouse_id: string | null }).warehouse_id
    if (myWhs && whId && !myWhs.includes(whId)) return fail(res, 'Chuyến thuộc kho ngoài phạm vi được giao', 403)
    // Bấm tay "Sắp lại" = bỏ việc chưa ai đụng rồi sinh lại — gọi thẳng planGdoTasks thì ra "0 việc mới" (14/09)
    return ok(res, await replanGdoTasks(req.params.id, req.user?.name ?? null))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}
