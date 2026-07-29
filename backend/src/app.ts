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
import { verifyToken } from './middlewares/auth'
import { supabase } from './lib/supabase'
import { recordServerError } from './utils/response'

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

app.use(cors({
  origin: [
    process.env.FRONTEND_URL ?? 'http://localhost:5173',
    'https://wms-webapp.vercel.app',
  ],
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

app.use('/api/auth',       authRouter)
app.use('/api/masterdata', verifyToken, masterdataRouter)
app.use('/api/wms',        verifyToken, wmsRouter)
app.use('/api/tms',        verifyToken, tmsRouter)
app.use('/api/hr',         verifyToken, hrRouter)
app.use('/api/external',   verifyToken, externalRouter)   // Dữ liệu bên ngoài (ERP/SAP)
// Cổng tích hợp ERP: auth RIÊNG bằng API key (requireApiKey trong router), KHÔNG dùng verifyToken.
app.use('/api/integration', integrationRouter)

export default app
