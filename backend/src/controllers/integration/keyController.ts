import { Request, Response } from 'express'
import { randomUUID, randomBytes } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { hashApiKey } from '../../middlewares/apiKey'
import { encryptSecret, decryptSecret } from '../../utils/secretBox'
import { logAdmin } from '../../services/adminAudit'

// Quản lý API key — CHỈ superadmin (khóa cấp tài khoản, không phải quyền nghiệp vụ thường).
const isSuper = (req: Request) => req.user?.is_superadmin === true

const VALID_SCOPES = ['materials:read', 'inventory:read', 'inbound:read', 'outbound:read', 'scans:read', 'weigh:write', '*']

// POST /wms/integration-keys — tạo key mới, trả key thô 1 LẦN DUY NHẤT (sau đó chỉ còn băm).
export async function createKey(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin được tạo API key', 403)
  const { name, scopes } = req.body as { name?: string; scopes?: string[] }
  if (!name?.trim()) return fail(res, 'Thiếu tên key', 400)

  const scopeList = Array.isArray(scopes) && scopes.length ? scopes : ['*']
  const bad = scopeList.filter((s) => !VALID_SCOPES.includes(s))
  if (bad.length) return fail(res, `Scope không hợp lệ: ${bad.join(', ')} (hợp lệ: ${VALID_SCOPES.join(', ')})`, 400)

  const raw = 'wms_' + randomBytes(32).toString('base64url')   // key thô entropy cao
  const id = randomUUID()
  const now = new Date().toISOString()
  const { error } = await supabase.from('ApiKey').insert({
    id, name: name.trim(), key_hash: hashApiKey(raw), key_prefix: raw.slice(0, 12),
    key_enc: encryptSecret(raw),   // lưu MÃ HÓA để superadmin xem lại (reveal); auth vẫn dùng key_hash
    scopes: scopeList, is_active: true, created_at: now, updated_at: now, created_by: req.user?.name ?? null,
  })
  if (error) return fail(res, error.message, 500)
  // Sổ quản trị: tên + scope + tiền tố — KHÔNG ghi key
  await logAdmin(req, { action: 'APIKEY_CREATE', target_type: 'ApiKey', target_id: id, target_label: name.trim(), after: { scopes: scopeList, key_prefix: raw.slice(0, 12) } })

  return ok(res, {
    id, name: name.trim(), scopes: scopeList, key: raw,
    note: 'LƯU key này NGAY — hệ thống KHÔNG hiện lại. Gửi ERP đặt vào header X-API-Key.',
  }, 201)
}

// GET /wms/integration-keys — liệt kê. Superadmin → trả kèm `key` (giải mã từ key_enc) để
// REVEAL/COPY lại. Key tạo trước khi có cột key_enc → key = null (không reveal được).
export async function listKeys(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin', 403)
  const { data, error } = await supabase.from('ApiKey')
    .select('id, name, key_prefix, key_enc, scopes, is_active, last_used_at, created_at, created_by')
    .order('created_at', { ascending: false })
  if (error) return fail(res, error.message, 500)
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { key_enc: string | null }>
  const out = rows.map(({ key_enc, ...r }) => ({ ...r, key: decryptSecret(key_enc) }))
  return ok(res, out)
}

// DELETE /wms/integration-keys/:id — XÓA HẲN. Chỉ cho xóa key ĐÃ THU HỒI (phải revoke trước).
export async function deleteKey(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin', 403)
  const { data } = await supabase.from('ApiKey').select('is_active').eq('id', req.params.id).maybeSingle()
  const row = data as { is_active: boolean } | null
  if (!row) return fail(res, 'Không tìm thấy key', 404)
  if (row.is_active) return fail(res, 'Phải thu hồi key trước khi xóa', 400)
  const { error } = await supabase.from('ApiKey').delete().eq('id', req.params.id)
  if (error) return fail(res, error.message, 500)
  await logAdmin(req, { action: 'APIKEY_DELETE', target_type: 'ApiKey', target_id: req.params.id })
  return ok(res, { id: req.params.id, deleted: true })
}

// PATCH /wms/integration-keys/:id/revoke — thu hồi (gọi API bằng key này lập tức 401).
export async function revokeKey(req: Request, res: Response) {
  if (!isSuper(req)) return fail(res, 'Chỉ Admin', 403)
  const { data: k } = await supabase.from('ApiKey').select('name, key_prefix').eq('id', req.params.id).maybeSingle()
  const { error } = await supabase.from('ApiKey')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
  if (error) return fail(res, error.message, 500)
  const kk = k as { name: string; key_prefix: string } | null
  await logAdmin(req, { action: 'APIKEY_REVOKE', target_type: 'ApiKey', target_id: req.params.id, target_label: kk?.name ?? null, after: { key_prefix: kk?.key_prefix ?? null, is_active: false } })
  return ok(res, { id: req.params.id, revoked: true })
}
