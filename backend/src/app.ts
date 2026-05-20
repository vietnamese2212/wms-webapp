import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRouter from './routes/auth'
import masterdataRouter from './routes/masterdata'
import wmsRouter from './routes/wms'
import tmsRouter from './routes/tms'
import { verifyToken } from './middlewares/auth'
import { supabase } from './lib/supabase'

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

export default app
