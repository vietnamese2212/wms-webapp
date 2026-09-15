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
import {
  replanGdoTasks, drainReplanQueue, confirmTasks, claimTasks, MAX_CONFIRM,
  dateRuleOf, palletMeetsDateRule, type ConfirmStage,
} from '../../services/directedTasks'
import { reorderCrossTripPickup, orderLocationsFromDock, type RoutableRow } from '../../services/directedRoute'
// Gợi ý "Vị trí lấy" của trang chuyến / nhặt lẻ — đường đi nhặt lẻ xếp thứ tự trên CHÍNH gợi ý này,
// và lọc thêm theo mức %Date đã chốt của TỪNG DÒNG (luật khớp date vẫn nằm ở directedTasks)
import { rotationSuggestionsFor, rotationConfigOf, type SuggestionGroup } from './outboundController'
import { pickFaceAcceptor, pickFaceFirst } from '../../services/loosePickFace'
import { autoFillSafe } from '../../services/autoFill'

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
    // TỰ RA LỆNH FILL (15/09) — hàng đợi theo (kho, ngày xuất) do trigger DB nuôi; ở đây chỉ xả hàng
    // đợi (một RPC, thường trả rỗng). Trang này là màn mở đầu ca của kho Hướng dẫn.
    const autoFill = await autoFillSafe(whId)

    const { data, error } = await supabase.rpc('directed_board', {
      p_warehouse_id: whId, p_mode: mode, p_gdo_id: gdoId, p_driver_id: driverId,
    })
    if (error) return fail(res, error)
    const board = (data ?? { rows: [], totals: {}, unset_items: [] }) as {
      rows?: RoutableRow[]; settings?: { cross_trip_pick_radius?: number }; auto_replanned?: number
      auto_fill?: { created: number; recalled: number; order_code: string | null }
    }
    board.auto_replanned = drained.replanned
    // Máy vừa đặt việc dưới tay người thì phải NÓI RA (cùng luật với dải "đã sắp lại theo tồn")
    if (autoFill.created || autoFill.recalled) board.auto_fill = {
      created: autoFill.created, recalled: autoFill.recalled, order_code: autoFill.order_code,
    }
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
    if (!whId) return ok(res, { routed: false, start_code: null, cell_m: null, stops: [], unlocated: [], done: [] })

    const dos = await fetchAllRowsParallel(() => supabase.from('OutboundDelivery').select('id').eq('gdo_id', gdoId).order('id'))
    const doIds = ((dos ?? []) as { id: string }[]).map(d => d.id)
    type MatQ = { short_name: string | null; base_unit: string | null; entry_unit: string | null; units_per_carton: number | null; category?: string | null }
    const items = doIds.length ? await fetchAllByIdChunks(doIds, chunk => supabase.from('OutboundItem')
      .select('id, material_id, material_code_raw, loose_picking, cartons_ordered, cartons_scanned, date_rule, date_required, material:Material!material_id(short_name, base_unit, entry_unit, units_per_carton, category)')
      .in('do_id', chunk).gt('loose_picking', 0).order('id')) as unknown as Array<{
        id: string; material_id: string | null; material_code_raw: string | null; loose_picking: number | null
        cartons_ordered: number | null; cartons_scanned: number | null; material: MatQ | null
        date_rule: unknown; date_required: number | null
      }> : []
    // CÒN LẤY nhặt lẻ (base) — cùng công thức `itemLooseProgress` của trang Nhặt lẻ / `looseRemainingOf` của màn quét:
    // phần quét chẵn vượt kế hoạch chẵn ăn vào phần lẻ; lấy đủ phần lẻ thì khỏi ghé dù pallet chẵn còn chưa quét.
    const looseScanned = new Map<string, number>()
    // Ô đã lấy hàng của từng dòng (từ pallet đã quét lẻ) — để dòng ĐÃ XONG vẫn nằm trong bảng lộ trình kèm ô đã lấy
    const scannedLoc = new Map<string, string>()
    if (items.length) {
      const scans = await fetchAllByIdChunks(items.map(it => it.id), chunk => supabase.from('OutboundScanEntry')
        .select('item_id, cartons_scanned, entry:InventoryEntry!inventory_entry_id(location:Location!location_id(location_code))')
        .in('item_id', chunk).eq('is_loose_picking', true).order('id')) as unknown as
        Array<{ item_id: string; cartons_scanned: number | null; entry: { location: { location_code: string } | null } | null }>
      for (const s of scans) {
        looseScanned.set(s.item_id, (looseScanned.get(s.item_id) ?? 0) + Number(s.cartons_scanned ?? 0))
        const lc = s.entry?.location?.location_code
        if (lc) scannedLoc.set(s.item_id, lc)
      }
    }
    const progressOf = (it: typeof items[number]) => {
      const ls = looseScanned.get(it.id) ?? 0
      const ov = Math.max(0, (Number(it.cartons_scanned ?? 0) - ls) - (Number(it.cartons_ordered ?? 0) - Number(it.loose_picking ?? 0)))
      const effective = Math.max(0, Number(it.loose_picking ?? 0) - ov)
      const done = Math.min(ls, effective)
      return { effective, done, remaining: Math.max(0, effective - done) }
    }
    const remainingOf = (it: typeof items[number]) => progressOf(it).remaining
    const open = items.filter(it => remainingOf(it) > 0)
    // Dòng đã lấy đủ phần lẻ — GẠCH NGANG nhưng vẫn ở lại bảng (cùng luật Việc cần làm "phòng bị quên")
    const doneRows = items.filter(it => remainingOf(it) === 0).map(it => ({
      item_id: it.id, material_id: it.material_id, material_code: it.material_code_raw, material_name: it.material?.short_name ?? null,
      units: it.material ?? null, effective_base: progressOf(it).effective, scanned_base: progressOf(it).done,
      location_code: scannedLoc.get(it.id) ?? null,
    }))
    const matIds = [...new Set(open.map(it => it.material_id).filter((x): x is string => !!x))]
    if (!matIds.length) return ok(res, { routed: false, start_code: null, cell_m: null, stops: [], unlocated: [], done: doneRows })

    // GỢI Ý THEO TỪNG DÒNG, KHÔNG THEO MÃ (vá 14/09): mức %Date đã chốt thuộc về DÒNG ĐƠN, và
    // trước bản vá này lộ trình bỏ qua nó hoàn toàn — đo trên fixture: dòng chốt "≥ 80 %" mà bảng
    // "Việc cần làm" chỉ sang ô đạt mức còn bảng "Theo vị trí" chỉ sang ô 9 %. Người nhặt đi theo
    // màn nào lấy hàng theo màn đó và KHÔNG lỗi nào nổ (cửa quét chỉ soi `date_required` của VL06O).
    // Khoá phụ `#all` = cùng dòng nhưng BỎ bộ lọc mức — chỉ để phân biệt "kho hết hàng" với "hàng
    // còn nhưng không đạt mức", KHÔNG tốn thêm lượt hỏi DB (cùng một lời gọi).
    const ruleOfItem = new Map<string, ReturnType<typeof dateRuleOf>>()
    const groups: SuggestionGroup[] = []
    for (const it of open) {
      if (!it.material_id) continue
      const rule = dateRuleOf(it)
      ruleOfItem.set(it.id, rule)
      groups.push({ key: it.id, material_id: it.material_id, accept: e => palletMeetsDateRule(e, e.material, rule) })
      if (rule) groups.push({ key: `${it.id}#all`, material_id: it.material_id })
    }
    const rotCfg = await rotationConfigOf([whId])
    const sug = await rotationSuggestionsFor(groups, [whId], rotCfg)
    // HÀNG LẺ LẤY Ở VỊ TRÍ NHẶT LẺ (15/09) — luật + hai mức cảnh báo/chặn: services/loosePickFace.ts.
    // Kho chưa khai ô nhặt lẻ nào ⇒ `pickFaceMode=false` ⇒ giữ nguyên hành vi cũ, không tự bật hộ ai.
    // Hỏi theo LOẠI KHO của từng mã: kho khai ô lẻ cho FG01 KHÔNG có nghĩa hàng FG02 fill xuống được
    const pickFace = await pickFaceAcceptor(whId)
    const codeByItem = new Map<string, { code: string; pct_date: number | null; available: number; need_fill_from: string | null }>()
    // Dòng bị CHẶN vì phải fill xuống trước (chỉ ở kho tích "bắt buộc đúng thứ tự")
    const blockedFill = new Map<string, string | null>()   // item_id → ô đang giữ lô đúng thứ tự
    for (const it of open) {
      const list = (sug.get(it.id) ?? []).filter(s => !!s.location_code)
      const first = list[0]
      if (!first?.location_code) continue
      // Lô ĐÚNG THỨ TỰ đã nằm ở ô nhặt lẻ chưa? (phép so ở `loosePickFace.ts`, dùng chung với cột
      // "Vị trí lấy" của trang Nhặt lẻ — hai màn phải chỉ cùng một ô)
      const pick = pickFaceFirst(list)[0]
      // Không ô nhặt lẻ nào nhận loại này ⇒ KHÔNG giục fill (Fill hàng cũng không có đích để hạ) và
      // KHÔNG chặn: nhặt trên kệ là đường duy nhất còn lại cho loại hàng đó.
      const needFill = pickFace.accepts(it.material?.category) && !pick.is_pick_face
      if (needFill && rotCfg.of(whId, it.material?.category ?? null).required) { blockedFill.set(it.id, first.location_code); continue }
      codeByItem.set(it.id, {
        code: pick.location_code!, pct_date: pick.pct_date, available: pick.available,
        need_fill_from: needFill ? first.location_code : null,
      })
    }
    const codes = [...new Set([...codeByItem.values()].map(v => v.code))]
    const locRows = codes.length ? await fetchAllByIdChunks(codes, chunk => supabase.from('Location')
      .select('id, location_code, row, is_pick_face').eq('warehouse_id', whId).in('location_code', chunk).order('id')) as unknown as
      Array<{ id: string; location_code: string; row: string | null; is_pick_face: boolean | null }> : []
    const locByCode = new Map(locRows.map(l => [l.location_code, l]))

    const { order, routed, legs, cell_m, start_code: routeStart } = await orderLocationsFromDock(whId, g.dock_location_id, [...locByCode.values()].map(l => l.id))
    const seqOfLoc = new Map(order.map((id, i) => [id, i + 1]))
    const legOfLoc = new Map(order.map((id, i) => [id, legs[i] ?? -1]))
    type StopMat = {
      item_id: string; material_id: string; material_code: string | null; material_name: string | null
      units: MatQ | null; remaining_base: number; effective_base: number; scanned_base: number; pct_date: number | null; available: number
      // Ô đang giữ lô ĐÚNG THỨ TỰ, khi ô này không phải vị trí nhặt lẻ ⇒ "nên fill xuống rồi hãy
      // nhặt". CẢNH BÁO thôi (kho không tích bắt buộc); tích rồi thì dòng rơi sang `unlocated`.
      need_fill_from: string | null
    }
    type Stop = { seq: number; location_id: string; location_code: string; is_pick_face: boolean; dist_from_prev_cells: number | null; materials: StopMat[] }
    const stops = new Map<string, Stop>()
    // Dòng chưa có tồn để chỉ chỗ VẪN phải mang `units` + `material_id`: thiếu quy cách thì bảng in số BASE
    // dán nhãn "thùng" và ô tổng cộng base thô (đo 14/09: 60 hộp hiện "60 thùng", tổng 203,8 thay vì 146,3)
    const unlocated: Array<{
      item_id: string; material_id: string | null; material_code: string | null; material_name: string | null
      units: MatQ | null; remaining_base: number
      // VÌ SAO không chỉ được chỗ — bốn việc phải làm khác hẳn nhau, gộp một câu là bắt người đọc
      // đoán: chờ hàng về (NO_STOCK) ↔ đổi mức / gỡ QA (NO_MATCH) ↔ fill xuống kho lẻ (NEED_FILL).
      reason: 'NO_STOCK' | 'NO_MATCH' | 'NEED_FILL'
      fill_from: string | null     // NEED_FILL: ô đang giữ lô đúng thứ tự, fill từ đó xuống
    }> = []
    for (const it of open) {
      const v = codeByItem.get(it.id)
      const loc = v ? locByCode.get(v.code) : null
      if (!v || !loc) {
        const blocked = blockedFill.has(it.id)
        unlocated.push({
          item_id: it.id, material_id: it.material_id, material_code: it.material_code_raw,
          material_name: it.material?.short_name ?? null, units: it.material ?? null, remaining_base: remainingOf(it),
          reason: blocked ? 'NEED_FILL'
            : ruleOfItem.get(it.id) && (sug.get(`${it.id}#all`) ?? []).length ? 'NO_MATCH' : 'NO_STOCK',
          fill_from: blockedFill.get(it.id) ?? null,
        })
        continue
      }
      const leg = legOfLoc.get(loc.id) ?? -1
      const s = stops.get(loc.id) ?? {
        seq: seqOfLoc.get(loc.id) ?? 0, location_id: loc.id, location_code: loc.location_code, is_pick_face: loc.is_pick_face === true,
        dist_from_prev_cells: routed && leg >= 0 ? leg : null, materials: [],
      }
      const pg = progressOf(it)
      s.materials.push({
        item_id: it.id, material_id: it.material_id!, material_code: it.material_code_raw, material_name: it.material?.short_name ?? null,
        units: it.material ?? null, remaining_base: pg.remaining, effective_base: pg.effective, scanned_base: pg.done, pct_date: v.pct_date, available: v.available,
        need_fill_from: v.need_fill_from,
      })
      stops.set(loc.id, s)
    }
    // Tên điểm xuất phát lấy từ CHÍNH điểm mà vòng đường đã dùng (có thể là cửa tự chọn khi chuyến
    // chưa Bắt đầu) — nếu chỉ đọc cửa của chuyến thì màn hình nói "chưa gắn cửa" trong khi đường
    // đi đã tính từ một cửa có thật, người đọc không biết mình đang đi từ đâu.
    const startCode: string | null = routeStart
    return ok(res, { routed, start_code: startCode, cell_m, stops: [...stops.values()].sort((a, b) => a.seq - b.seq), unlocated, done: doneRows })
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
