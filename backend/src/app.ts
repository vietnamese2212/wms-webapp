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
import { verifyToken } from './middlewares/auth'
import { supabase } from './lib/supabase'

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
// Cổng tích hợp ERP: auth RIÊNG bằng API key (requireApiKey trong router), KHÔNG dùng verifyToken.
app.use('/api/integration', integrationRouter)

export default app
