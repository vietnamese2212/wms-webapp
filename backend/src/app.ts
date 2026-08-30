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
    const [be, fe] = await Promise.all([
      supabase.from('error_logs').select('id', { count: 'exact', head: true }).eq('source', 'be').gte('created_at', since),
      supabase.from('error_logs').select('id', { count: 'exact', head: true }).eq('source', 'fe').gte('created_at', since),
    ])
    res.json({ be_24h: be.count ?? 0, fe_24h: fe.count ?? 0 })
  } catch {
    res.json({ be_24h: null, fe_24h: null, note: 'error_logs chưa sẵn sàng' })
  }
})

// Warm up: simple HTTP call to Supabase (no TCP pool to initialize)
app.get('/api/health', async (_req, res) => {
  try {
    await supabase.from('Warehouse').select('id').limit(1)
    res.json({ status: 'ok' })
  } catch {
    res.json({ status: 'ok' })
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

app.use('/api/auth',       authRouter)
app.use('/api/masterdata', verifyToken, masterdataRouter)
app.use('/api/wms',        verifyToken, wmsRouter)
app.use('/api/tms',        verifyToken, tmsRouter)
app.use('/api/hr',         verifyToken, hrRouter)
app.use('/api/external',   verifyToken, externalRouter)   // Dữ liệu bên ngoài (ERP/SAP)
app.use('/api/notify',     verifyToken, notifyRouter)     // Web Push — thiết bị của chính user
// Cổng tích hợp ERP: auth RIÊNG bằng API key (requireApiKey trong router), KHÔNG dùng verifyToken.
app.use('/api/integration', integrationRouter)

export default app
