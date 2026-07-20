// Dấu thập phân cho ô nhập số (KG/decimal) — theo cờ hệ thống decimal_separator ('dot' | 'comma').
// Cài đặt WMS → tab Hệ thống. Mặc định 'dot' (.). App CHẶN dấu còn lại khi nhập + parse theo cờ.

export type DecSep = '.' | ','

/** Đọc dấu thập phân từ danh sách SystemSetting (mặc định '.'). */
export function getDecimalSep(settings: { key: string; value: unknown }[] | undefined): DecSep {
  return settings?.find(s => s.key === 'decimal_separator')?.value === 'comma' ? ',' : '.'
}

/** Lọc chuỗi nhập: CHỈ giữ chữ số + dấu thập phân đã chọn (bỏ dấu còn lại + ký tự lạ), tối đa 1 dấu. */
export function sanitizeDecimalInput(raw: string, sep: DecSep): string {
  let seen = false
  const out: string[] = []
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') { out.push(ch); continue }
    if (ch === sep) { if (seen) continue; seen = true; out.push(ch) }
    // mọi ký tự khác (kể cả dấu thập phân còn lại) → bỏ
  }
  return out.join('')
}

/** Đổ số ra ô nhập theo dấu đã chọn (dùng khi prefill form Sửa). null → ''. */
export function formatDecimalForInput(n: number | null | undefined, sep: DecSep): string {
  if (n == null) return ''
  const s = String(n)
  return sep === ',' ? s.replace('.', ',') : s
}

/** Parse chuỗi ô số (theo sep) → number | null. '' → null. */
export function parseDecimalInput(raw: string, sep: DecSep): number | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const n = Number(sep === ',' ? s.replace(',', '.') : s)
  return Number.isFinite(n) ? n : null
}
