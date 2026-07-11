import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import * as auth from '../controllers/auth/authController'
import { verifyToken } from '../middlewares/auth'

const router = Router()

// Chống brute-force: CHỈ đếm lần THẤT BẠI (skipSuccessfulRequests) → nhiều nhân sự cùng
// một IP (kho chung đường mạng) đăng nhập ĐÚNG lúc đầu ca KHÔNG bị chặn; chỉ khóa khi có
// nhiều lần SAI mật khẩu (đặc trưng dò mật khẩu tự động). App sau proxy Vercel → app.set('trust proxy').
// 30 lần sai / 15 phút / IP → vượt trả 429.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,   // login/đổi MK THÀNH CÔNG (2xx) không tính vào hạn mức
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Quá nhiều lần thử sai. Vui lòng đợi vài phút rồi thử lại.' } },
})

router.post('/login',           loginLimiter, auth.login)
router.get('/me',  verifyToken, auth.me)
router.post('/change-password', verifyToken, loginLimiter, auth.changePassword)

export default router
