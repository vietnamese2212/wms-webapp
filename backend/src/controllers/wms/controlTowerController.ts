import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { scopeCategoriesOf } from '../../utils/categoryScope'

// ─── Control Tower (Giám sát vận hành) ────────────────────────────────────────
// Toàn bộ số liệu trong-ngày gộp 1 RPC (aggregate phía DB — bảng triệu dòng, PostgREST
// tắt aggregate). Realtime + refetch phía FE; endpoint này chỉ ĐỌC.

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, message: string, status = 500, code = 'ERROR') {
  return res.status(status).json({ success: false, error: { code, message } })
}

// GET /wms/control-tower?warehouse_ids=a,b,c
export async function getControlTower(req: Request, res: Response) {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    // Scope kho: JWT ∩ filter user chọn (như listWeighTickets)
    const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : []
    const requested = req.query.warehouse_ids
      ? String(req.query.warehouse_ids).split(',').filter(Boolean) : []
    const effective = scopeWhIds.length > 0
      ? (requested.length > 0 ? requested.filter(id => scopeWhIds.includes(id)) : scopeWhIds)
      : requested
    if (requested.length > 0 && effective.length === 0)
      return fail(res, 'Kho chọn ngoài phạm vi được phân quyền', 403, 'FORBIDDEN')

    const { data, error } = await supabase.rpc('control_tower_stats', {
      p_warehouse_ids: effective.length > 0 ? effective : null,
      p_categories: scopeCategoriesOf(req),
      p_today: today,
    })
    if (error) {
      if (/control_tower_stats/i.test(error.message) || error.code === 'PGRST202')
        return fail(res, 'Chưa apply migration 20260716_control_tower_stats', 503, 'NOT_READY')
      return fail(res, error.message, 500, 'DB_ERROR')
    }
    return ok(res, { date: today, ...(data as Record<string, unknown>) })
  } catch (e) { return fail(res, String(e)) }
}
