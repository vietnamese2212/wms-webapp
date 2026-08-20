import { Request, Response } from 'express'
import { maskServerMessage } from '../../utils/response'
import { supabase } from '../../lib/supabase'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { parseListParam } from '../../utils/httpQuery'

// ─── Control Tower (Giám sát vận hành) ────────────────────────────────────────
// Toàn bộ số liệu trong-ngày gộp 1 RPC (aggregate phía DB — bảng triệu dòng, PostgREST
// tắt aggregate). Realtime + refetch phía FE; endpoint này chỉ ĐỌC.

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, message: string, status = 500, code = 'ERROR') {
  // 5xx KHÔNG trả nguyên văn message (lộ tên bảng/cột PostgREST) — xem utils/response.ts
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status) } })
}

// GET /wms/control-tower?warehouse_ids=a,b,c&categories=x,y
export async function getControlTower(req: Request, res: Response) {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    // Scope kho: JWT ∩ filter user chọn (như listWeighTickets)
    const scopeWhIds = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : []
    const requested = parseListParam(req.query.warehouse_ids) ?? []
    const effective = scopeWhIds.length > 0
      ? (requested.length > 0 ? requested.filter(id => scopeWhIds.includes(id)) : scopeWhIds)
      : requested
    if (requested.length > 0 && effective.length === 0)
      return fail(res, 'Kho chọn ngoài phạm vi được phân quyền', 403, 'FORBIDDEN')
    // Loại kho: filter user chọn ∩ scope loại JWT
    const scopeCats = scopeCategoriesOf(req)
    const reqCats = parseListParam(req.query.categories) ?? []
    const effCats = scopeCats
      ? (reqCats.length > 0 ? reqCats.filter(c => scopeCats.includes(c)) : scopeCats)
      : reqCats
    if (reqCats.length > 0 && effCats.length === 0)
      return fail(res, 'Loại kho chọn ngoài phạm vi được phân quyền', 403, 'FORBIDDEN')
    // Mã hàng: lọc đích danh (chỉ cắt 2 khối hàng-theo-mã trong RPC)
    const matCodes = parseListParam(req.query.material_codes, 100) ?? []

    // 2 RPC song song, FE vẫn 1 request: stats (khối chính) + resources (nhân sự/xe nâng/tồn sạch/
    // chu trình cổng — console kiểu Manhattan 20/08). resources lỗi/chưa apply → null, FE tự ẩn khối.
    const [main, resources] = await Promise.all([
      supabase.rpc('control_tower_stats', {
        p_warehouse_ids: effective.length > 0 ? effective : null,
        p_categories: effCats.length > 0 ? effCats : null,
        p_today: today,
        p_material_codes: matCodes.length > 0 ? matCodes : null,
      }),
      supabase.rpc('control_tower_resources', {
        p_warehouse_ids: effective.length > 0 ? effective : null,
        p_today: today,
      }),
    ])
    if (main.error) {
      if (/control_tower_stats/i.test(main.error.message) || main.error.code === 'PGRST202')
        return fail(res, 'Chưa apply migration 20260716_control_tower_stats', 503, 'NOT_READY')
      return fail(res, main.error.message, 500, 'DB_ERROR')
    }
    return ok(res, {
      date: today,
      ...(main.data as Record<string, unknown>),
      resources: resources.error ? null : resources.data,
    })
  } catch (e) { return fail(res, String(e)) }
}
