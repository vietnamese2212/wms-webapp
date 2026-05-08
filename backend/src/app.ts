import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import masterdataRouter from './routes/masterdata'
import wmsRouter from './routes/wms'
import { prisma } from './lib/prisma'

dotenv.config()

const app = express()

app.use(cors({
  origin: [
    process.env.FRONTEND_URL ?? 'http://localhost:5173',
    'https://wms-webapp.vercel.app',
  ],
  credentials: true,
}))
app.use(express.json())

// Warm up: pings DB so Prisma connection pool is ready for the next real query
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok' })
  } catch {
    res.json({ status: 'ok' })   // still respond ok — warmup is best-effort
  }
})

app.use('/api/masterdata', masterdataRouter)
app.use('/api/wms', wmsRouter)

// Các router sẽ thêm sau:
// app.use('/api/auth', authRouter)
// app.use('/api/tms', tmsRouter)
// app.use('/api/hr', hrRouter)

export default app
