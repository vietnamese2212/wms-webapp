import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

// ─── TAI MẮT "CẮT ÂM THẦM Ở TRẦN 1000 DÒNG" (user chốt 03/08) ──────────────────────────────────
// PostgREST có `db-max-rows` (đo trên staging: 1000). Query KHÔNG khai range/limit mà khớp nhiều
// hơn thế thì server trả về ĐÚNG 1000 dòng, HTTP 200, không lỗi, không cảnh báo — code tính tiếp
// trên dữ liệu THIẾU. Đó là lý do lớp lỗi này tái đi tái lại: nó VÔ HÌNH. Chiến dịch 03/07 dọn ~40
// chỗ mà ngày 03/08 vẫn đẻ chỗ mới (badge "DO chưa có" báo sai: 200 DO khớp 1.047 dòng).
//
// Cách bắt: PostgREST luôn trả `Content-Range: <from>-<to>/<total>`. Số dòng trả về ĐÚNG bằng trần
// mà request không khai `limit` → nghi bị cắt; xác nhận bằng 1 câu HEAD `count=exact` (chỉ chạy
// trong tình huống hiếm này nên đường thường không tốn gì) rồi ghi `error_logs` → digest hằng ngày
// dựng cờ đỏ. KHÔNG ném lỗi: đây là đường đọc đang chạy production — làm ỒN chứ không được làm GÃY.
const PGRST_MAX_ROWS = Number(process.env.PGRST_MAX_ROWS || 1000)
const IS_PROD = process.env.VERCEL_ENV === 'production'
const SRK = key
const capSeen = new Set<string>()          // chống spam: mỗi (bảng + cột chọn) chỉ báo 1 lần/instance

function rowsFromContentRange(h: string | null): number | null {
  const m = /^(\d+)-(\d+)\//.exec(String(h ?? ''))     // '0-999/*' | '0-999/1047'
  return m ? Number(m[2]) - Number(m[1]) + 1 : null
}

async function detectSilentTruncation(reqUrl: string, headers: Headers): Promise<void> {
  try {
    if (rowsFromContentRange(headers.get('content-range')) !== PGRST_MAX_ROWS) return
    const u = new URL(reqUrl)
    if (u.searchParams.has('limit')) return              // tự giới hạn = có chủ đích
    const table = u.pathname.split('/').pop() || '?'
    if (table === 'error_logs') return                   // tránh đệ quy khi chính telemetry bị cắt
    const seenKey = `${table}|${u.searchParams.get('select') ?? ''}`
    if (capSeen.has(seenKey)) return
    capSeen.add(seenKey)

    // Xác nhận bằng count CHÍNH XÁC — tránh báo oan khi dữ liệu thật vừa đúng 1000 dòng
    const head = await fetch(reqUrl, {
      method: 'HEAD',
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, Prefer: 'count=exact' },
    })
    const total = Number(/\/(\d+)$/.exec(head.headers.get('content-range') ?? '')?.[1] ?? NaN)
    if (!Number.isFinite(total) || total <= PGRST_MAX_ROWS) return

    const msg = `CAP-${PGRST_MAX_ROWS}: bảng "${table}" khớp ${total} dòng nhưng chỉ nhận ${PGRST_MAX_ROWS} `
      + '— query THIẾU phân trang (dùng fetchAllRowsParallel / fetchAllByIdChunks, hoặc RPC trả sẵn tập cần). '
      + `Query: ${u.pathname}?${u.searchParams.toString().slice(0, 300)}`
    console.error('[CAP-1000]', msg, new Error('điểm gọi').stack?.split('\n').slice(2, 6).join(' | ') ?? '')
    const { recordServerError } = await import('../utils/response')
    recordServerError('be', msg, 200, 'CAP_TRUNCATED', u.pathname)
  } catch { /* tai mắt KHÔNG bao giờ được làm hỏng truy vấn thật */ }
}

// Service-role client: bypasses RLS, for server-side use only
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
  global: {
    fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const res = await fetch(input, init)
      // CHỈ soi lượt ĐỌC. Đọc header trên chính response (không clone/không đụng body) nên
      // không có nguy cơ tiêu mất stream của caller.
      if ((init?.method ?? 'GET').toUpperCase() === 'GET' && res.ok) {
        const reqUrl = typeof input === 'string' ? input
          : input instanceof URL ? input.href : String((input as { url?: string }).url ?? input)
        const h = res.headers
        if (IS_PROD) void detectSilentTruncation(reqUrl, h)
        else await detectSilentTruncation(reqUrl, h)      // staging/dev: chờ để log hiện ngay
      }
      return res
    },
  },
})
