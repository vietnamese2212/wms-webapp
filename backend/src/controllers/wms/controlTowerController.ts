import { Request, Response } from 'express'
import { maskServerMessage } from '../../utils/response'
import { supabase } from '../../lib/supabase'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { parseListParam } from '../../utils/httpQuery'
import { isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { getMonitorCacheSeconds } from '../../utils/settings'

// ─── Control Tower (Giám sát vận hành) ────────────────────────────────────────
// Toàn bộ số liệu trong-ngày gộp 1 RPC (aggregate phía DB — bảng triệu dòng, PostgREST
// tắt aggregate). Realtime + refetch phía FE; endpoint này chỉ ĐỌC.

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, message: string, status = 500, code = 'ERROR') {
  // 5xx KHÔNG trả nguyên văn message (lộ tên bảng/cột PostgREST) — xem utils/response.ts
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status, res) } })
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
    //
    // CACHE (29/08): màn này mở THƯỜNG TRỰC trên màn TV nên nó vừa là nạn nhân vừa là NGUỒN tải —
    // đo dưới 100 người dùng, nó là 1 trong 3 endpoint duy nhất còn trả 500 (statement timeout).
    // Bản _cached chống cả giẫm đạp: N người cùng miss thì CHỈ MỘT tính, số còn lại dùng số cũ.
    // Tuổi tối đa = cờ `monitor_cache_seconds` (mặc định 30s, 0 = tắt → chạy y đường cũ).
    const ttl = await getMonitorCacheSeconds()
    const whArg = effective.length > 0 ? effective : null
    const argStats = {
      p_warehouse_ids: whArg,
      p_categories: effCats.length > 0 ? effCats : null,
      p_today: today,
      p_material_codes: matCodes.length > 0 ? matCodes : null,
    }
    const argRes = { p_warehouse_ids: whArg, p_today: today }
    let [main, resources] = await Promise.all([
      supabase.rpc('control_tower_stats_cached', { ...argStats, p_ttl_seconds: ttl }),
      supabase.rpc('control_tower_resources_cached', { ...argRes, p_ttl_seconds: ttl }),
    ])
    // Nhánh dự phòng cửa sổ triển khai (20260829 chưa apply) — đường cũ KHÔNG cache, nguyên vẹn.
    if (main.error?.code === 'PGRST202') main = await supabase.rpc('control_tower_stats', argStats)
    if (resources.error?.code === 'PGRST202') resources = await supabase.rpc('control_tower_resources', argRes)
    if (main.error) {
      if (/control_tower_stats/i.test(main.error.message) || main.error.code === 'PGRST202')
        return fail(res, 'Chưa apply migration 20260716_control_tower_stats', 503, 'NOT_READY')
      // Quá hạn tính (nhiều người cùng truy vấn) KHÔNG phải lỗi app: trả 503 kèm câu người dùng
      // LÀM ĐƯỢC gì đó, thay vì 500 "Lỗi hệ thống". 500 rác còn làm rule cảnh báo "lỗi BE 24h"
      // kêu OAN — đo 29/08: 67 dòng error_logs của riêng màn này chỉ trong 3 giờ chạy tải.
      if (isQueryTimeout(main.error)) return fail(res, QUERY_TIMEOUT_MSG, 503, 'QUERY_TIMEOUT')
      return fail(res, main.error.message, 500, 'DB_ERROR')
    }
    return ok(res, {
      date: today,
      ...(main.data as Record<string, unknown>),
      resources: resources.error ? null : resources.data,
    })
  } catch (e) { return fail(res, String(e)) }
}
