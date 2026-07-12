import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// Mã hóa đối xứng bí mật LƯU-để-XEM-LẠI (vd API key ERP): AES-256-GCM, khóa 32 byte suy
// từ JWT_SECRET (đã bắt buộc + set trên mọi deploy) qua sha256 + context → KHÔNG cần env mới,
// và dump DB thuần KHÔNG đủ để giải mã (thiếu JWT_SECRET). Định dạng lưu: base64(iv|tag|ct).
function encKey(): Buffer | null {
  const s = process.env.JWT_SECRET
  if (!s) return null
  return createHash('sha256').update(`${s}|apikey-enc-v1`).digest()   // 32 byte
}

export function encryptSecret(plain: string): string | null {
  const key = encKey()
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptSecret(enc: string | null | undefined): string | null {
  const key = encKey()
  if (!key || !enc) return null
  try {
    const buf = Buffer.from(enc, 'base64')
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28)
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
  } catch {
    return null   // khóa đổi / dữ liệu hỏng → không reveal được (không throw)
  }
}
