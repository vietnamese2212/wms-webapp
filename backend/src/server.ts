import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT ?? 4000

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes sẽ thêm dần vào đây:
// app.use('/api/auth', authRouter)
// app.use('/api/wms', wmsRouter)
// app.use('/api/tms', tmsRouter)
// app.use('/api/hr', hrRouter)
// app.use('/api/masterdata', masterdataRouter)

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})

export default app
