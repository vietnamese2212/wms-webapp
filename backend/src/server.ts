import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import masterdataRouter from './routes/masterdata'

dotenv.config()

const app = express()
const PORT = process.env.PORT ?? 4000

app.use(cors({
  origin: [
    process.env.FRONTEND_URL ?? 'http://localhost:5173',
    'https://wms-webapp.vercel.app',
  ],
  credentials: true,
}))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/masterdata', masterdataRouter)

// Placeholder routes (sẽ thêm sau)
// app.use('/api/auth', authRouter)
// app.use('/api/wms', wmsRouter)
// app.use('/api/tms', tmsRouter)
// app.use('/api/hr', hrRouter)

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})

export default app
