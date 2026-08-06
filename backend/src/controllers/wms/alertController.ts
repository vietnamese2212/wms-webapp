// TRUNG TÂM CẢNH BÁO — API list + ack (Đợt 2 roadmap 06/08). Quét nằm ở services/alertScanner.
import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { maskServerMessage } from '../../utils/response'
import { categoryAllowed } from '../../utils/categoryScope'
import { parseListParam } from '../../utils/httpQuery'
import { safeFilterValue } from '../../utils/search'
import { runAlertScan } from '../../services/alertScanner'

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status) } })
}
const now = () => new Date().toISOString()

const RULES = ['EXPIRY', 'GATE_DWELL', 'TRIP_LATE', 'WEIGH_DIFF', 'BE_ERRORS']

// GET /wms/alerts?status=open|acked|resolved|all&rule=&severity=&warehouse_id=&fresh=1
export async function listAlerts(req: Request, res: Response) {
  try {
    // Quét lười ngay tại cửa người xem (throttle trong scanner) — mở trang là số liệu tươi
    await runAlertScan(req.query.fresh === '1')

    const status = String(req.query.status || 'open')
    const rules = (parseListParam(req.query.rule) ?? []).filter(r => RULES.includes(r))
    const sevs = (parseListParam(req.query.severity) ?? []).filter(s => ['CRITICAL', 'WARNING'].includes(s))
    const whFilter = safeFilterValue(typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : '') || null

    let q = supabase.from('alert_events')
      .select('id, rule, severity, warehouse_id, warehouse_name, category, title, detail, object_url, first_seen, last_seen, ack_by, ack_at, resolved_at', { count: 'exact' })
    if (status === 'open') q = q.is('resolved_at', null).is('ack_at', null)
    else if (status === 'acked') q = q.is('resolved_at', null).not('ack_at', 'is', null)
    else if (status === 'resolved') q = q.not('resolved_at', 'is', null)
    // 'all' — không lọc
    if (rules.length) q = q.in('rule', rules.slice(0, 10))
    if (sevs.length) q = q.in('severity', sevs.slice(0, 2))
    if (whFilter) q = q.eq('warehouse_id', whFilter)
    // resolved cũ chỉ giữ để tra 7 ngày gần (list, không phải kho lưu trữ)
    if (status === 'resolved' || status === 'all') {
      q = q.gte('last_seen', new Date(Date.now() - 7 * 86400_000).toISOString())
    }
    // Trần cứng có chủ đích: cảnh báo đang mở là danh sách VIỆC, quá 1000 dòng nghĩa là hệ thống
    // đang cháy — hiển thị 1000 nặng nhất kèm total để user biết còn nữa.
    const { data, error, count } = await q.order('severity').order('last_seen', { ascending: false }).limit(1000)
    if (error) return fail(res, 500, 'DB_ERROR', error.message)

    // Cắt scope: kho được gán (null-inclusive — cảnh báo toàn hệ thống ai cũng thấy)
    // + Loại hàng (null-inclusive theo chuẩn categoryScope)
    const whScope = req.user?.warehouse_scope === 'ASSIGNED' ? new Set(req.user?.warehouse_ids ?? []) : null
    const rows = (data ?? []).filter(r => {
      if (whScope && r.warehouse_id && !whScope.has(r.warehouse_id as string)) return false
      if (!categoryAllowed(req, (r.category as string | null) ?? null)) return false
      return true
    })
    // severity order: CRITICAL trước WARNING (alphabet may vô tình đúng: C < W)
    return ok(res, { rows, total: count ?? rows.length })
  } catch (e) { console.error(e); return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// POST /wms/alerts/:id/ack — "tôi biết rồi" (ẩn khỏi list mặc định; điều kiện hết sẽ tự đóng)
export async function ackAlert(req: Request, res: Response) {
  try {
    const { data, error } = await supabase.from('alert_events')
      .update({ ack_by: req.user?.name ?? null, ack_at: now(), updated_at: now() })
      .eq('id', req.params.id).is('resolved_at', null).select('id').maybeSingle()
    if (error) return fail(res, 500, 'DB_ERROR', error.message)
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Cảnh báo không còn mở (đã tự đóng hoặc không tồn tại)')
    return ok(res, { acked: true })
  } catch (e) { return fail(res, 500, 'SERVER_ERROR', String(e)) }
}

// DELETE /wms/alerts/:id/ack — bỏ đánh dấu (đưa lại vào list mặc định)
export async function unackAlert(req: Request, res: Response) {
  try {
    const { error } = await supabase.from('alert_events')
      .update({ ack_by: null, ack_at: null, updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, 500, 'DB_ERROR', error.message)
    return ok(res, { acked: false })
  } catch (e) { return fail(res, 500, 'SERVER_ERROR', String(e)) }
}
