// Web Push (Đợt 1 roadmap 06/08) — gửi thông báo đẩy tới thiết bị đã đăng ký.
// Nguyên tắc: (1) VAPID key TỰ SINH lần đầu + lưu bảng push_config (per-silo, RLS đóng —
// KHÔNG để SystemSetting vì GET /wms/settings hở đọc); (2) mọi hàm gửi KHÔNG BAO GIỜ throw —
// push là phụ trợ, không được làm fail nghiệp vụ chính; (3) endpoint chết (404/410) tự dọn.
import webpush from 'web-push'
import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase'

export interface PushPayload {
  title: string
  body: string
  url?: string   // đường dẫn trong app khi bấm vào thông báo (vd /wms/fill/orders/<id>)
  tag?: string   // gộp thông báo cùng tag (thay vì xếp chồng)
}

interface VapidKeys { publicKey: string; privateKey: string; subject: string }

let _vapidCache: VapidKeys | null = null

/** Lấy (hoặc tự sinh lần đầu) cặp khóa VAPID của silo này. */
export async function getVapid(): Promise<VapidKeys | null> {
  if (_vapidCache) return _vapidCache
  try {
    const { data } = await supabase.from('push_config')
      .select('vapid_public, vapid_private, subject').eq('id', 1).maybeSingle()
    if (data) {
      _vapidCache = { publicKey: data.vapid_public, privateKey: data.vapid_private, subject: data.subject }
      return _vapidCache
    }
    // Chưa có → sinh mới. Đua 2 instance cùng sinh: PK id=1 → người thua 23505 → đọc lại của người thắng.
    const keys = webpush.generateVAPIDKeys()
    const { error } = await supabase.from('push_config').insert({
      id: 1, vapid_public: keys.publicKey, vapid_private: keys.privateKey,
      subject: 'mailto:wms@lof.vn', updated_at: new Date().toISOString(),
    })
    if (error) {
      const { data: again } = await supabase.from('push_config')
        .select('vapid_public, vapid_private, subject').eq('id', 1).maybeSingle()
      if (!again) return null
      _vapidCache = { publicKey: again.vapid_public, privateKey: again.vapid_private, subject: again.subject }
      return _vapidCache
    }
    _vapidCache = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:wms@lof.vn' }
    return _vapidCache
  } catch { return null }
}

interface SubRow { id: string; employee_id: string; endpoint: string; p256dh: string; auth: string; failed_n: number }

/** Gửi payload tới MỌI thiết bị của danh sách nhân viên. Không throw; trả về số gửi được. */
export async function sendPushToEmployees(employeeIds: string[], payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 }
  try {
    const ids = [...new Set(employeeIds.filter(Boolean))]
    if (!ids.length) return out
    const vapid = await getVapid()
    if (!vapid) return out
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

    // Nạp subscription theo lô .in ≤300 (luật id-list-url-limits)
    const subs: SubRow[] = []
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from('push_subscriptions')
        .select('id, employee_id, endpoint, p256dh, auth, failed_n')
        .in('employee_id', ids.slice(i, i + 300)).limit(1000)
      subs.push(...((data ?? []) as SubRow[]))
    }
    if (!subs.length) return out

    const body = JSON.stringify(payload)
    const results = await Promise.allSettled(subs.map(s =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 24 * 3600 },
      )))

    const deadIds: string[] = []
    const failIds: string[] = []
    const okIds: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { out.sent++; if (subs[i].failed_n > 0) okIds.push(subs[i].id); return }
      out.failed++
      const st = (r.reason as { statusCode?: number })?.statusCode
      // 404/410 = subscription đã chết (user gỡ quyền/đổi trình duyệt) → dọn ngay.
      // Lỗi khác (mạng, 5xx push service) → đếm; quá 10 lần liên tiếp coi như chết.
      if (st === 404 || st === 410 || subs[i].failed_n + 1 >= 10) deadIds.push(subs[i].id)
      else failIds.push(subs[i].id)
    })
    if (deadIds.length) await supabase.from('push_subscriptions').delete().in('id', deadIds.slice(0, 300))
    if (failIds.length) {
      for (const sid of failIds.slice(0, 50)) {
        const row = subs.find(s => s.id === sid)
        await supabase.from('push_subscriptions')
          .update({ failed_n: (row?.failed_n ?? 0) + 1, updated_at: new Date().toISOString() })
          .eq('id', sid)
      }
    }
    if (okIds.length) {
      await supabase.from('push_subscriptions')
        .update({ failed_n: 0, updated_at: new Date().toISOString() })
        .in('id', okIds.slice(0, 300))
    }
  } catch (e) { console.error('[push] sendPushToEmployees:', e) }
  return out
}

/**
 * Gửi tới mọi nhân viên CÓ QUYỀN (module, action) và thấy được kho warehouseId
 * (null = mọi kho). Superadmin (name='Admin'/employee_code='ADMIN') luôn nhận.
 * Dùng cho thông báo "có việc cần xử" không gắn đích danh (vd task Cần xử lý SAP).
 */
export async function sendPushToPerm(
  module: string, action: string, warehouseId: string | null, payload: PushPayload,
  prefKey?: PrefKey,   // lọc theo cài đặt chuông per user (thiếu = gửi hết)
): Promise<{ sent: number; failed: number }> {
  try {
    // 1) Chức danh có quyền — JobTitle ít (vài chục dòng), nạp hết rồi lọc trong JS
    const { data: jts } = await supabase.from('JobTitle').select('id, module_permissions').limit(1000)
    const jtIds = ((jts ?? []) as { id: string; module_permissions: Record<string, string[]> | null }[])
      .filter(j => Array.isArray(j.module_permissions?.[module]) && (j.module_permissions?.[module] ?? []).includes(action))
      .map(j => j.id)

    // 2) Nhân viên active thuộc các chức danh đó + superadmin
    const emps: { id: string; warehouse_scope: string | null; name: string; employee_code: string | null }[] = []
    for (let i = 0; i < jtIds.length; i += 300) {
      const { data } = await supabase.from('Employee')
        .select('id, warehouse_scope, name, employee_code')
        .in('job_title_id', jtIds.slice(i, i + 300)).eq('is_active', true).limit(1000)
      emps.push(...((data ?? []) as typeof emps))
    }
    const { data: admins } = await supabase.from('Employee')
      .select('id, warehouse_scope, name, employee_code')
      .or('name.eq.Admin,employee_code.eq.ADMIN').eq('is_active', true).limit(10)
    for (const a of (admins ?? []) as typeof emps) if (!emps.some(e => e.id === a.id)) emps.push(a)
    if (!emps.length) return { sent: 0, failed: 0 }

    // 3) Cắt theo scope kho: ASSIGNED → phải có dòng UserWarehouseAccess với kho này
    let targets = emps
    if (warehouseId) {
      const assigned = emps.filter(e => e.warehouse_scope === 'ASSIGNED')
      const allowed = new Set<string>()
      for (let i = 0; i < assigned.length; i += 300) {
        const { data } = await supabase.from('UserWarehouseAccess')
          .select('employee_id')
          .in('employee_id', assigned.slice(i, i + 300).map(e => e.id))
          .eq('warehouse_id', warehouseId).limit(1000)
        for (const r of (data ?? []) as { employee_id: string }[]) allowed.add(r.employee_id)
      }
      targets = emps.filter(e => e.warehouse_scope !== 'ASSIGNED' || allowed.has(e.id))
    }
    const targetIds = prefKey ? await filterByPref(targets.map(e => e.id), prefKey) : targets.map(e => e.id)
    return await sendPushToEmployees(targetIds, payload)
  } catch (e) { console.error('[push] sendPushToPerm:', e); return { sent: 0, failed: 0 } }
}

// ── Cài đặt thông báo per user (nút chuông > tab Cài đặt — user chốt 06/08) ──
// prefs jsonb key→bool, THIẾU KEY = BẬT. Cài đặt chỉ tắt CHUÔNG (push); feed/list vẫn đủ.
export const PREF_KEYS = ['assign', 'reconcile', 'EXPIRY', 'GATE_DWELL', 'TRIP_LATE', 'WEIGH_DIFF', 'BE_ERRORS'] as const
export type PrefKey = typeof PREF_KEYS[number]

/** Lọc danh sách nhân viên còn BẬT chuông cho trường hợp prefKey (thiếu dòng prefs = bật). */
export async function filterByPref(employeeIds: string[], prefKey: PrefKey): Promise<string[]> {
  try {
    const ids = [...new Set(employeeIds.filter(Boolean))]
    if (!ids.length) return []
    const off = new Set<string>()
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from('notification_prefs')
        .select('employee_id, prefs').in('employee_id', ids.slice(i, i + 300)).limit(1000)
      for (const r of (data ?? []) as { employee_id: string; prefs: Record<string, boolean> | null }[]) {
        if (r.prefs?.[prefKey] === false) off.add(r.employee_id)
      }
    }
    return ids.filter(id => !off.has(id))
  } catch { return employeeIds }
}

/**
 * Thông báo ĐÍCH DANH (giao việc…): LUÔN ghi feed cá nhân (tab "Cá nhân" trên chuông — lịch sử),
 * và đổ chuông (Web Push) cho những người còn bật trường hợp `prefKey`. Không bao giờ throw.
 */
export async function notifyEmployees(
  employeeIds: string[], kind: string, prefKey: PrefKey, payload: PushPayload,
  opts?: { dedupeWindowMs?: number },   // giao N dòng song song (Promise.all) → chỉ 1 dòng feed/URL
): Promise<void> {
  try {
    let ids = [...new Set(employeeIds.filter(Boolean))]
    if (!ids.length) return
    const t = new Date().toISOString()
    if (opts?.dedupeWindowMs && payload.url) {
      const since = new Date(Date.now() - opts.dedupeWindowMs).toISOString()
      const { data: dups } = await supabase.from('user_notifications')
        .select('employee_id').eq('kind', kind).eq('url', payload.url)
        .in('employee_id', ids.slice(0, 300)).gte('created_at', since).limit(1000)
      const seen = new Set((dups ?? []).map(d => d.employee_id as string))
      ids = ids.filter(id => !seen.has(id))
      if (!ids.length) return   // feed đã có dòng cho URL này — push cũng khỏi (tag gộp rồi)
    }
    const rows = ids.map(id => ({
      id: randomUUID(), employee_id: id, kind,
      title: payload.title, body: payload.body, url: payload.url ?? null,
      created_at: t, updated_at: t,
    }))
    const { error } = await supabase.from('user_notifications').insert(rows)
    if (error) console.error('[push] ghi feed lỗi:', error.message)
    const pushIds = await filterByPref(ids, prefKey)
    if (pushIds.length) await sendPushToEmployees(pushIds, payload)
  } catch (e) { console.error('[push] notifyEmployees:', e) }
}

/** Đăng ký/ghi đè 1 thiết bị cho nhân viên (endpoint là khóa — đổi user trên cùng máy = chuyển chủ). */
export async function upsertSubscription(employeeId: string, endpoint: string, p256dh: string, auth: string, userAgent: string | null) {
  const now = new Date().toISOString()
  const { data: ex } = await supabase.from('push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle()
  if (ex) {
    const { error } = await supabase.from('push_subscriptions')
      .update({ employee_id: employeeId, p256dh, auth, user_agent: userAgent, failed_n: 0, updated_at: now })
      .eq('id', ex.id)
    return { error }
  }
  const { error } = await supabase.from('push_subscriptions').insert({
    id: randomUUID(), employee_id: employeeId, endpoint, p256dh, auth, user_agent: userAgent, updated_at: now,
  })
  // Đua 2 request cùng endpoint: người thua 23505 → update dòng người thắng
  if (error && error.code === '23505') {
    const { error: e2 } = await supabase.from('push_subscriptions')
      .update({ employee_id: employeeId, p256dh, auth, user_agent: userAgent, failed_n: 0, updated_at: now })
      .eq('endpoint', endpoint)
    return { error: e2 }
  }
  return { error }
}
