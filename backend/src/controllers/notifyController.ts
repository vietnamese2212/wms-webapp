// Web Push — đăng ký/hủy thiết bị + gửi thử (Đợt 1 roadmap 06/08).
// Auth-only (KHÔNG cần permission riêng): user chỉ thao tác trên thiết bị của CHÍNH MÌNH,
// không đọc/ghi dữ liệu người khác. Việc AI ĐƯỢC NHẬN thông báo gì quyết định ở phía GỬI
// (pushService: đích danh theo assign, hoặc theo quyền + scope kho).
import { Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { maskServerMessage } from '../utils/response'
import { getVapid, sendPushToEmployees, upsertSubscription, PREF_KEYS } from '../services/pushService'
import { getRetentionDays } from '../utils/settings'

function ok(res: Response, data: unknown) {
  return res.status(200).json({ success: true, data })
}
function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status, res) } })
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

// ── FEED CÁ NHÂN (tab "Cá nhân" trên nút chuông — user chốt 06/08) ───────────

// Dọn lười feed (kiểu cleanupOldPhotos — free tier không có pg_cron).
// Giữ 3 NGÀY gần nhất (user chốt 06/08 — thông báo là việc trong ngày, quá 3 ngày là hết thời sự).
// XOÁ THEO LÔ: câu `DELETE ... < cutoff` không giới hạn sẽ bắt MỘT người dùng gánh việc xoá hàng
// trăm nghìn dòng khi app chạy quy mô lớn (check-app 06/08 nêu). Mỗi lượt tối đa BATCH dòng,
// throttle 1h/instance → tồn đọng được dọn dần qua các lượt, không lượt nào treo lâu.
// Số ngày giữ = cờ `retention_days.feed` (mặc định 3) — Cài đặt WMS › Hệ thống.
const FEED_CLEAN_BATCH = 2000
let _lastFeedCleanupAt = 0
async function cleanupOldFeed(): Promise<void> {
  if (Date.now() - _lastFeedCleanupAt < 3600_000) return
  _lastFeedCleanupAt = Date.now()
  const cutoff = new Date(Date.now() - (await getRetentionDays()).feed * 86400_000).toISOString()
  const { data } = await supabase.from('user_notifications')
    .select('id').lt('created_at', cutoff).order('created_at').limit(FEED_CLEAN_BATCH)
  const ids = (data ?? []).map(r => r.id as string)
  for (let i = 0; i < ids.length; i += 300) {
    await supabase.from('user_notifications').delete().in('id', ids.slice(i, i + 300))
  }
}

// GET /api/notify/feed — thông báo đích danh của CHÍNH MÌNH (mới nhất trước, cap 50)
export async function getFeed(req: Request, res: Response) {
  const me = selfId(req)
  if (!me) return fail(res, 401, 'UNAUTHORIZED', 'Không xác định được người dùng')
  try { await cleanupOldFeed() } catch { /* dọn lỗi không chặn đọc */ }
  const [{ data, error }, unreadR] = await Promise.all([
    supabase.from('user_notifications')
      .select('id, kind, title, body, url, read_at, created_at')
      .eq('employee_id', me).order('created_at', { ascending: false }).limit(50),
    supabase.from('user_notifications')
      .select('id', { count: 'exact', head: true }).eq('employee_id', me).is('read_at', null),
  ])
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { rows: data ?? [], unread: unreadR.count ?? 0 })
}

// POST /api/notify/feed/read  body { ids?: string[] } — thiếu ids = đánh dấu ĐỌC HẾT của mình
export async function markFeedRead(req: Request, res: Response) {
  const me = selfId(req)
  if (!me) return fail(res, 401, 'UNAUTHORIZED', 'Không xác định được người dùng')
  const { ids } = req.body as { ids?: string[] }
  const t = new Date().toISOString()
  let q = supabase.from('user_notifications')
    .update({ read_at: t, updated_at: t }).eq('employee_id', me).is('read_at', null)
  if (Array.isArray(ids) && ids.length) q = q.in('id', ids.slice(0, 300))
  const { error } = await q
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { read: true })
}

// ── CÀI ĐẶT CHUÔNG per user (tab "Cài đặt" trên nút chuông) ──────────────────
// prefs key→bool, THIẾU KEY = BẬT. Tắt chỉ tắt CHUÔNG (push) — feed/danh sách vẫn đủ.

// GET /api/notify/prefs
export async function getPrefs(req: Request, res: Response) {
  const me = selfId(req)
  if (!me) return fail(res, 401, 'UNAUTHORIZED', 'Không xác định được người dùng')
  const { data, error } = await supabase.from('notification_prefs')
    .select('prefs').eq('employee_id', me).maybeSingle()
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  const stored = (data?.prefs ?? {}) as Record<string, boolean>
  const prefs: Record<string, boolean> = {}
  for (const k of PREF_KEYS) prefs[k] = stored[k] !== false
  return ok(res, { prefs })
}

// PUT /api/notify/prefs  body { prefs: { <key>: boolean } } — chỉ nhận key trong sổ PREF_KEYS
export async function updatePrefs(req: Request, res: Response) {
  const me = selfId(req)
  if (!me) return fail(res, 401, 'UNAUTHORIZED', 'Không xác định được người dùng')
  const raw = (req.body as { prefs?: Record<string, unknown> })?.prefs
  if (!raw || typeof raw !== 'object') return fail(res, 400, 'INVALID_INPUT', 'Thiếu prefs')
  const clean: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!(PREF_KEYS as readonly string[]).includes(k)) return fail(res, 400, 'UNKNOWN_PREF', `Cài đặt "${k}" không có trong sổ`)
    if (typeof v !== 'boolean') return fail(res, 400, 'INVALID_VALUE', `Giá trị của "${k}" phải là true/false`)
    clean[k] = v
  }
  const t = new Date().toISOString()
  // Merge với prefs cũ (PUT từng công tắc một không đè công tắc khác)
  const { data: ex } = await supabase.from('notification_prefs')
    .select('prefs').eq('employee_id', me).maybeSingle()
  const merged = { ...((ex?.prefs ?? {}) as Record<string, boolean>), ...clean }
  const { error } = ex
    ? await supabase.from('notification_prefs').update({ prefs: merged, updated_at: t }).eq('employee_id', me)
    : await supabase.from('notification_prefs').insert({ employee_id: me, prefs: merged, created_at: t, updated_at: t })
  if (error) return fail(res, 500, 'DB_ERROR', error.message)
  return ok(res, { prefs: merged })
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
