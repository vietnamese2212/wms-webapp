import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import * as auth from '../controllers/auth/authController'
import { verifyToken } from '../middlewares/auth'

const router = Router()

// Chống brute-force: giới hạn số lần thử trên /login + /change-password theo IP.
// App chạy sau Vercel (proxy) → express-rate-limit đọc X-Forwarded-For; app.set('trust proxy')
// đã cần cho ip đúng (xem app.ts). 20 lần / 5 phút / IP — đủ rộng cho gõ nhầm thật,
// đủ chặt để chặn dò mật khẩu tự động. Vượt → 429.
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Quá nhiều lần thử. Vui lòng đợi vài phút rồi thử lại.' } },
})

router.post('/login',           loginLimiter, auth.login)
router.get('/me',  verifyToken, auth.me)
router.post('/change-password', verifyToken, loginLimiter, auth.changePassword)

export default router
