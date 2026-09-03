// NHẬT KÝ QUẢN TRỊ (03/09) — ai đổi quyền / phạm vi kho / mật khẩu / API key / cờ hệ thống, lúc nào, từ gì sang gì.
// Gọi logAdmin() tại CHÍNH chỗ biết được thay đổi (như outboundEvents). Ghi sổ là AUGMENT: bọc try/catch,
// hỏng sổ KHÔNG làm hỏng nghiệp vụ. KHÔNG bao giờ đưa mật khẩu / API key thô vào before/after.
import type { Request } from 'express'
import { supabase } from '../lib/supabase'

export const ADMIN_AUDIT_ACTIONS = [
  'EMPLOYEE_CREATE', 'EMPLOYEE_UPDATE', 'PASSWORD_SET', 'ACCOUNT_UNLOCK', 'EMPLOYEE_DELETE', 'EMPLOYEE_RESTORE',
  'WAREHOUSE_ACCESS', 'MANAGER_SET', 'JOBTITLE_CREATE', 'JOBTITLE_UPDATE', 'JOBTITLE_PARENT',
  'DEPARTMENT_CREATE', 'DEPARTMENT_UPDATE', 'SETTING_UPDATE', 'VISION_CONFIG', 'APIKEY_CREATE', 'APIKEY_REVOKE', 'APIKEY_DELETE',
] as const
export type AdminAuditAction = typeof ADMIN_AUDIT_ACTIONS[number]
export type AdminAuditTarget = 'Employee' | 'JobTitle' | 'Department' | 'SystemSetting' | 'ApiKey'

type Json = Record<string, unknown>

/** Chỉ giữ các khoá mà giá trị ĐỔI (so JSON) — sổ đọc được "đổi gì", không phải chụp cả bản ghi. */
export function diffFields(before: Json | null | undefined, after: Json | null | undefined, keys?: string[]): { before: Json; after: Json } {
  const b = before ?? {}, a = after ?? {}
  const ks = keys ?? [...new Set([...Object.keys(b), ...Object.keys(a)])]
  const ob: Json = {}, oa: Json = {}
  for (const k of ks) {
    if (a[k] === undefined) continue                       // field không gửi lên = không đổi
    if (JSON.stringify(b[k] ?? null) === JSON.stringify(a[k] ?? null)) continue
    ob[k] = b[k] ?? null; oa[k] = a[k] ?? null
  }
  return { before: ob, after: oa }
}

export async function logAdmin(req: Request, e: {
  action: AdminAuditAction
  target_type: AdminAuditTarget
  target_id?: string | null
  target_label?: string | null
  before?: Json | null
  after?: Json | null
}): Promise<void> {
  try {
    const { error } = await supabase.from('admin_audit_events').insert({
      actor_id: req.user?.sub ?? null,
      actor_name: req.user?.name ?? null,
      ip: String(req.ip ?? ''),
      action: e.action, target_type: e.target_type,
      target_id: e.target_id ?? null, target_label: e.target_label ?? null,
      before: e.before ?? null, after: e.after ?? null,
    })
    if (error) console.error('[admin_audit]', error.message)
  } catch (err) { console.error('[admin_audit]', err) }
}
