import { Request, Response, NextFunction } from 'express'
import { createHash } from 'crypto'
import { supabase } from '../lib/supabase'

// Ngữ cảnh API key gắn vào req sau khi xác thực (không phải user đăng nhập).
export interface ApiKeyCtx { id: string; name: string; scopes: string[] }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { apiKey?: ApiKeyCtx }
  }
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// Lấy key thô từ header: ưu tiên "X-API-Key", fallback "Authorization: Bearer <key>".
function extractKey(req: Request): string | null {
  const h = req.headers['x-api-key']
  if (typeof h === 'string' && h.trim()) return h.trim()
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null
  return null
}

// Gác cổng tích hợp: mỗi endpoint khai scope cần (vd 'materials:read'). Key phải active +
// có scope đó (hoặc '*'). Sai/tắt/thiếu scope → 401/403. Cập nhật last_used_at không chặn response.
export function requireApiKey(scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const raw = extractKey(req)
    if (!raw) return res.status(401).json({ success: false, error: { code: 'NO_API_KEY', message: 'Thiếu API key (header X-API-Key)' } })

    const { data, error } = await supabase.from('ApiKey')
      .select('id, name, scopes, is_active')
      .eq('key_hash', hashApiKey(raw))
      .maybeSingle()
    if (error) return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Lỗi hệ thống, vui lòng thử lại' } })

    const k = data as { id: string; name: string; scopes: string[] | null; is_active: boolean } | null
    if (!k || !k.is_active) return res.status(401).json({ success: false, error: { code: 'INVALID_API_KEY', message: 'API key không hợp lệ hoặc đã bị thu hồi' } })

    const scopes = k.scopes ?? []
    if (!scopes.includes('*') && !scopes.includes(scope)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN_SCOPE', message: `API key không có quyền ${scope}` } })
    }

    req.apiKey = { id: k.id, name: k.name, scopes }
    void supabase.from('ApiKey').update({ last_used_at: new Date().toISOString() }).eq('id', k.id)
    next()
  }
}
