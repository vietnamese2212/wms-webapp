import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import authRouter from './routes/auth'
import masterdataRouter from './routes/masterdata'
import wmsRouter from './routes/wms'
import tmsRouter from './routes/tms'
import hrRouter from './routes/hr'
import integrationRouter from './routes/integration'
import externalRouter from './routes/external'
import notifyRouter from './routes/notify'
import { verifyToken } from './middlewares/auth'
import { supabase } from './lib/supabase'
import { recordServerError } from './utils/response'
import { searchLooksLikeInjection } from './utils/search'
import { isDay } from './utils/dates'
import { catchAsyncErrors } from './middlewares/asyncErrors'

dotenv.config()

const app = express()

// Ẩn "X-Powered-By: Express" (khỏi lộ stack công nghệ)
app.disable('x-powered-by')
// Chạy sau proxy Vercel → tin X-Forwarded-For để rate-limit lấy đúng IP client
app.set('trust proxy', 1)

// Security headers: X-Frame-Options (chống clickjacking), X-Content-Type-Options,
// Referrer-Policy… CSP tắt vì API chỉ trả JSON (FE tĩnh do Vercel phục vụ riêng),
// bật CSP ở đây không có tác dụng mà dễ gây phiền.
app.use(helmet({ contentSecurityPolicy: false }))

// Origin cho phép = FRONTEND_URL + CORS_ORIGINS (danh sách, ngăn bằng dấu phẩy). Mỗi đơn vị khai
// domain của mình bằng ENV thay vì nhét domain một đơn vị vào code (kiến trúc multi-tenant silo).
// Chưa khai CORS_ORIGINS → giữ nguyên domain production đơn vị 1 để app đang chạy không đứt.
const extraOrigins = (process.env.CORS_ORIGINS ?? 'https://wms-webapp.vercel.app')
  .split(',').map(s => s.trim()).filter(Boolean)

app.use(cors({
  origin: [process.env.FRONTEND_URL ?? 'http://localhost:5173', ...extraOrigins],
  credentials: true,
}))
// Limit mặc định 100kb làm upload bulk JSON (KH xuất/nhập hàng nghìn dòng) chết 413.
// Trần thực tế là 4.5MB của Vercel serverless — 8mb để express không bao giờ chặn trước.
app.use(express.json({ limit: '8mb' }))

// CI đọc để biết Preview đã build tới commit nào (poll sau khi push rồi mới bắn QA smoke).
// Không auth: chỉ lộ SHA commit — repo public nên SHA vốn công khai.
app.get('/api/version', (_req, res) => {
  res.json({ sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null, env: process.env.VERCEL_ENV ?? 'local' })
})

// ── Tai mắt production (29/07) — 2 route PUBLIC có chủ đích ──
// FE báo lỗi JS chưa đăng nhập cũng phải ghi được; digest chỉ trả SỐ ĐẾM (không nội dung).
// Chống lạm dụng: cap 3 lỗi/phút/instance (serverless mỗi lambda 1 quầy — đủ chặn spam vô ý).
let feErrBudget = 3
setInterval(() => { feErrBudget = 3 }, 60_000).unref?.()
app.post('/api/telemetry/client-error', (req, res) => {
  const { message, url, ua } = (req.body ?? {}) as { message?: unknown; url?: unknown; ua?: unknown }
  if (typeof message === 'string' && message.trim() && feErrBudget > 0) {
    feErrBudget--
    recordServerError('fe', message, undefined, undefined,
      typeof url === 'string' ? url.slice(0, 200) : undefined,
      typeof ua === 'string' ? ua.slice(0, 120) : undefined)
  }
  res.json({ success: true })   // luôn 200 — telemetry không bao giờ làm FE bận tâm
})
app.get('/api/telemetry/digest', async (_req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    // 503 = quá tải / chưa sẵn sàng — tình huống ĐÃ LƯỜNG TRƯỚC (xem `isSoftStatus` trong
    // utils/response.ts), KHÔNG đếm vào "lỗi hệ thống": đếm vào là mỗi lúc đông người cờ đỏ lại
    // dựng lên + email, mà cờ kêu oan vài lần thì lần thật sẽ không ai còn nhìn.
    // `or(status.is.null,...)` chứ không `neq`: SQL `status <> 503` cho NULL ⇒ loại oan dòng cũ
    // chưa ghi status (staging đang có 7 dòng như vậy).
    const [be, fe, soft] = await Promise.all([
      supabase.from('error_logs').select('id', { count: 'exact', head: true })
        .eq('source', 'be').gte('created_at', since).or('status.is.null,status.neq.503'),
      supabase.from('error_logs').select('id', { count: 'exact', head: true }).eq('source', 'fe').gte('created_at', since),
      supabase.from('error_logs').select('id', { count: 'exact', head: true })
        .eq('source', 'be').gte('created_at', since).eq('status', 503),
    ])
    res.json({ be_24h: be.count ?? 0, fe_24h: fe.count ?? 0, overload_24h: soft.count ?? 0 })
  } catch {
    res.json({ be_24h: null, fe_24h: null, note: 'error_logs chưa sẵn sàng' })
  }
})

// Warm up: simple HTTP call to Supabase (no TCP pool to initialize)
// ⚠️ PHẢI NÓI THẬT KHI DB CHẾT (vá 11/09). Bản cũ trả `{status:'ok'}` ở CẢ hai nhánh, mà
// supabase-js KHÔNG ném lỗi (nó trả `{data, error}`) nên `catch` còn không bao giờ chạy tới —
// tức endpoint này về mặt toán học không có đường nào báo ốm. Đo thật ngày 11/09: staging Postgres
// cạn quỹ Disk IO, không nhận nổi một kết nối nào suốt nhiều giờ, mà /api/health vẫn 200 "ok" ⇒
// tôi đọc nhầm thành "đã hồi phục". Chuông báo luôn nói khoẻ thì không phải chuông.
// Không trả message thô của DB ra ngoài (cùng luật che 5xx) — chỉ đủ để biết ốm ở tầng nào.
app.get('/api/health', async (_req, res) => {
  try {
    const { error } = await supabase.from('Warehouse').select('id').limit(1)
    if (error) return res.status(503).json({ status: 'degraded', db: 'unreachable' })
    res.json({ status: 'ok', db: 'ok' })
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' })
  }
})

// ── Giá trị tham số trông như SQL-injection → 400 NGAY, đừng để thành 500 ──
// VÌ SAO (đo 21/08 trên dữ liệu lớn): WAF đứng trước Supabase chặn các chuỗi này Ở TẦNG HẠ TẦNG và
// trả HTML (không phải JSON) → supabase-js coi là lỗi lạ → controller nuốt thành 500 "Lỗi hệ thống".
// Bắn `?warehouse_id=' or 1=1--` sinh 500 ở 7 endpoint (Xuất kho, Nhập kho, Vị trí, Sổ đóng gói,
// Chấm công, TMS, Thông báo). KHÔNG phải lỗ bảo mật (WAF đã chặn, message đã che, PostgREST tham số
// hoá) nhưng nó (a) báo sai cho user, (b) đổ rác vào `error_logs` làm rule cảnh báo "lỗi BE 24h"
// kêu oan — tức làm HỎNG chính cái tai mắt.
// `search` đã có hàng rào riêng trong từng controller; đây là lưới CHUNG cho MỌI tham số ở MỌI
// endpoint — hiện có lẫn viết sau — thay vì rải guard từng chỗ rồi lại sót.
// ── Ngày ĐÚNG DẠNG nhưng KHÔNG CÓ THẬT → 400, đừng để thành 500 ──
// Cùng một câu chuyện với lưới injection ở trên, nên đặt cạnh nhau. Kiểm bằng regex
// `^\d{4}-\d{2}-\d{2}$` là kiểm DẠNG chứ không kiểm LỊCH: `2026-13-45` · `2026-02-31` ·
// `0000-00-00` đều lọt xuống Postgres và nổ 22008 ⇒ 500. Fuzz 30/08: **5 màn chính** cùng vỡ —
// Xuất kho · Nhập kho · Nghỉ phép · Kế hoạch xuất · Nhặt lẻ. Bài học này đã ghi 2 lần (gói fill
// 05/08, chi phí kho 27/08) mà mỗi lần chỉ vá tại chỗ, nên chỗ viết sau vẫn vấp lại — lần này để
// lưới CHUNG, phủ cả endpoint chưa viết.
// CHỈ soi tham số MANG NGHĨA NGÀY (theo tên), không soi mọi tham số: một ô tìm kiếm tự do có thể
// chứa chuỗi hình dạng ngày mà không phải ngày, chặn nó là báo oan.
const DATE_PARAM = /(^|_)(date|dates|from|to)$/i
const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/
app.use('/api', (req, res, next) => {
  for (const [key, raw] of Object.entries(req.query)) {
    for (const v of (Array.isArray(raw) ? raw : [raw])) {
      if (typeof v !== 'string') continue
      const safeKey = key.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)   // không dội lại ký tự lạ của client
      if (searchLooksLikeInjection(v)) {
        return res.status(400).json({ success: false, error: { code: 'BAD_PARAM',
          message: `Giá trị của tham số "${safeKey}" chứa mẫu ký tự bị hệ thống bảo mật chặn.` } })
      }
      // page/offset KHỔNG LỒ (bookmark cũ, bot): offset = page×limit tràn int4 của Postgres
      // → 22003 → 500 thô ở 5 màn list (đo 31/08: page=1e9). Trang thật không bao giờ tới 1e6.
      if ((key === 'page' || key === 'offset') && /^\d{7,}$/.test(v)) {
        return res.status(400).json({ success: false, error: { code: 'BAD_PAGE',
          message: `Tham số "${safeKey}" quá lớn (${v.slice(0, 12)}…) — trang không tồn tại.` } })
      }
      // Chỉ chặn thứ TRÔNG như ngày mà không phải ngày. Giá trị không có hình dạng ngày (rỗng,
      // 'undefined', 'hôm nay'…) để nguyên cho controller xử theo luật riêng của nó.
      if (DATE_PARAM.test(key) && DAY_SHAPE.test(v) && !isDay(v)) {
        return res.status(400).json({ success: false, error: { code: 'BAD_DATE',
          message: `Ngày ở tham số "${safeKey}" không có thật (${v}).` } })
      }
    }
  }
  next()
})

// Mọi router đi qua catchAsyncErrors: handler async ném lỗi → 500 JSON ngay, không treo tới 504
// (xem middlewares/asyncErrors.ts — đo 07/09: body sai kiểu ở một route làm lambda treo 60s).
app.use('/api/auth',       catchAsyncErrors(authRouter))
app.use('/api/masterdata', verifyToken, catchAsyncErrors(masterdataRouter))
app.use('/api/wms',        verifyToken, catchAsyncErrors(wmsRouter))
app.use('/api/tms',        verifyToken, catchAsyncErrors(tmsRouter))
app.use('/api/hr',         verifyToken, catchAsyncErrors(hrRouter))
app.use('/api/external',   verifyToken, catchAsyncErrors(externalRouter))   // Dữ liệu bên ngoài (ERP/SAP)
app.use('/api/notify',     verifyToken, catchAsyncErrors(notifyRouter))     // Web Push — thiết bị của chính user
// Cổng tích hợp ERP: auth RIÊNG bằng API key (requireApiKey trong router), KHÔNG dùng verifyToken.
app.use('/api/integration', catchAsyncErrors(integrationRouter))

// Lưới cuối: lỗi lọt tới đây = code chưa tự xử. Trả JSON đúng khuôn (không phải trang HTML mặc định
// của Express), ghi `error_logs` kèm route để digest dựng cờ và người sửa lần ra chỗ. Body không
// phải JSON (express.json từ chối) cũng rơi vào đây với status 400 — nói thẳng thay vì "Lỗi hệ thống".
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return
  const e = (err ?? {}) as { status?: number; statusCode?: number; type?: string; message?: string }
  const status = e.status ?? e.statusCode ?? 500
  if (status >= 500)
    recordServerError('be', `UNCAUGHT ${e.message ?? String(err)}`, status, 'UNCAUGHT', `${req.method} ${req.originalUrl}`.slice(0, 200))
  const message = e.type === 'entity.parse.failed' ? 'Nội dung gửi lên không phải JSON hợp lệ'
    : status >= 500 ? 'Lỗi hệ thống, vui lòng thử lại'
    : (e.message ?? 'Yêu cầu không hợp lệ')
  res.status(status).json({ success: false, error: { code: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST', message } })
})

export default app
