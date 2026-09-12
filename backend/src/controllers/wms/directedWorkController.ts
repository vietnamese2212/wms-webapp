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
import { isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { planGdoTasks, confirmTasks, claimTasks, MAX_CONFIRM, type ConfirmStage } from '../../services/directedTasks'

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

    const { data, error } = await supabase.rpc('directed_board', {
      p_warehouse_id: whId, p_mode: mode, p_gdo_id: gdoId, p_driver_id: driverId,
    })
    if (error) return fail(res, error)
    return ok(res, data ?? { rows: [], totals: {}, unset_items: [] })
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}

/**
 * POST /wms/directed/tasks/confirm { task_ids, stage, undo? } — nút "✓ Xong".
 * Bảng xe nâng gom theo VỊ TRÍ nên FE gửi cả nhóm một lần (một lần bấm = một lần ghi).
 */
export async function confirm(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { task_ids?: unknown; stage?: unknown; undo?: unknown }
    const ids = Array.isArray(body.task_ids) ? body.task_ids : []
    if (!ids.length) return fail(res, 400, 'VALIDATION_ERROR', 'Chưa chọn việc nào')
    if (ids.length > 200) return fail(res, 400, 'VALIDATION_ERROR', 'Tối đa 200 việc mỗi lần bấm')
    if (ids.some(id => badId(id))) return fail(res, 400, 'BAD_ID', 'Mã việc không hợp lệ')
    const stage = String(body.stage ?? '').toUpperCase()
    if (stage !== 'LOWER' && stage !== 'MOVE' && stage !== 'BOTH')
      return fail(res, 400, 'VALIDATION_ERROR', 'Giai đoạn không hợp lệ (LOWER / MOVE / BOTH)')

    if (!(await tasksInScope(req, res, ids as string[]))) return

    const r = await confirmTasks(ids as string[], stage as ConfirmStage, body.undo === true, req.user?.name ?? null)
    if (!r.ok) return fail(res, r.status, r.code, r.message)
    return ok(res, r)
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
export async function replan(req: Request, res: Response) {
  try {
    if (badId(req.params.id)) return fail(res, 400, 'BAD_ID', 'Mã chuyến không hợp lệ')
    const { data: gdo } = await supabase.from('GroupDeliveryOrder')
      .select('id, warehouse_id').eq('id', req.params.id).maybeSingle()
    if (!gdo) return fail(res, 'Không tìm thấy chuyến', 404)
    const myWhs = scopeWhIds(req)
    const whId = (gdo as { warehouse_id: string | null }).warehouse_id
    if (myWhs && whId && !myWhs.includes(whId)) return fail(res, 'Chuyến thuộc kho ngoài phạm vi được giao', 403)
    return ok(res, await planGdoTasks(req.params.id, req.user?.name ?? null))
  } catch (e) { if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG); return fail(res, String(e)) }
}
