// Web Push — đăng ký/hủy thiết bị + gửi thử (Đợt 1 roadmap 06/08).
// Auth-only (KHÔNG cần permission riêng): user chỉ thao tác trên thiết bị của CHÍNH MÌNH,
// không đọc/ghi dữ liệu người khác. Việc AI ĐƯỢC NHẬN thông báo gì quyết định ở phía GỬI
// (pushService: đích danh theo assign, hoặc theo quyền + scope kho).
import { Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { maskServerMessage } from '../utils/response'
import { getVapid, sendPushToEmployees, upsertSubscription } from '../services/pushService'

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status) } })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const selfId = (req: Request): string | null =>
  req.user?.sub && UUID_RE.test(req.user.sub) ? req.user.sub : null

// GET /api/notify/vapid-key — public key để trình duyệt subscribe (private key KHÔNG bao giờ rời server)
export async function getVapidKey(_req: Request, res: Response) {
  const vapid = await getVapid()
  if (!vapid) return fail(res, 503, 'PUSH_UNAVAILABLE', 'Chưa khởi tạo được khóa thông báo đẩy — thử lại sau')
  return ok(res, { key: vapid.publicKey })
}

// POST /api/notify/subscriptions  body { endpoint, keys: { p256dh, auth } }
export async function subscribe(req: Request, res: Response) {
  const me = selfId(req)
  if (!me) return fail(res, 401, 'UNAUTHORIZED', 'Không xác định được người dùng')
  const { endpoint, keys } = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!endpoint || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) {
    return fail(res, 400, 'BAD_ENDPOINT', 'Endpoint không hợp lệ')
  }
  if (!keys?.p256dh || !keys?.auth) return fail(res, 400, 'BAD_KEYS', 'Thiếu khóa mã hóa của subscription')
  const ua = (req.headers['user-agent'] ?? '').toString().slice(0, 300) || null
  const { error } = await upsertSubscription(me, endpoint, keys.p256dh, keys.auth, ua)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { subscribed: true })
}

// DELETE /api/notify/subscriptions  body { endpoint } — chỉ xóa thiết bị của chính mình
export async function unsubscribe(req: Request, res: Response) {
  const me = selfId(req)
  if (!me) return fail(res, 401, 'UNAUTHORIZED', 'Không xác định được người dùng')
  const { endpoint } = req.body as { endpoint?: string }
  if (!endpoint) return fail(res, 400, 'BAD_ENDPOINT', 'Thiếu endpoint')
  const { error } = await supabase.from('push_subscriptions')
    .delete().eq('endpoint', endpoint).eq('employee_id', me)
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { unsubscribed: true })
}

// POST /api/notify/test — gửi thử tới MỌI thiết bị của chính mình (xác nhận chuông kêu)
export async function testPush(req: Request, res: Response) {
  const me = selfId(req)
  if (!me) return fail(res, 401, 'UNAUTHORIZED', 'Không xác định được người dùng')
  const r = await sendPushToEmployees([me], {
    title: 'WMS — thông báo thử',
    body: `Thiết bị này đã nhận được thông báo đẩy (${new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })})`,
    url: '/settings',
    tag: 'wms-test',
  })
  if (r.sent === 0 && r.failed === 0) {
    return fail(res, 404, 'NO_SUBSCRIPTION', 'Tài khoản chưa đăng ký thiết bị nào — bật thông báo trước')
  }
  return ok(res, r)
}
