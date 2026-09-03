import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import * as auth from '../controllers/auth/authController'
import { verifyToken } from '../middlewares/auth'

const router = Router()

// Chống brute-force: CHỈ đếm lần THẤT BẠI (skipSuccessfulRequests) → nhiều nhân sự cùng
// một IP (kho chung đường mạng) đăng nhập ĐÚNG lúc đầu ca KHÔNG bị chặn; chỉ khóa khi có
// nhiều lần SAI mật khẩu (đặc trưng dò mật khẩu tự động). App sau proxy Vercel → app.set('trust proxy').
// 03/09: lớp CHÍNH chuyển xuống DB (RPC auth_throttle — acct 10 sai/15' + ip 30 sai/15', xuyên instance, admin mở
// khoá được trong app). MemoryStore này chỉ còn là VAN XẢ CUỐI khi RPC hỏng / bão request: nới 30 → 200 vì
// (a) nó đếm theo instance, KHÔNG có đường mở khoá (đo thật 03/09: bộ QA 42+43+45 = 55 lần sai cố ý trong 15'
// từ 1 IP → mọi đăng nhập sau đó 429 suốt 15' dù DB đã được dọn), (b) cả kho đi chung 1 NAT IP, 30 lần gõ sai
// của hàng trăm người đầu ca là chuyện thường — chặn cả kho mà admin bó tay là tệ hơn không chặn.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  skipSuccessfulRequests: true,   // login/đổi MK THÀNH CÔNG (2xx) không tính vào hạn mức
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Quá nhiều lần thử sai. Vui lòng đợi vài phút rồi thử lại.' } },
})

router.post('/login',           loginLimiter, auth.login)
router.get('/me',  verifyToken, auth.me)
router.post('/change-password', verifyToken, loginLimiter, auth.changePassword)

export default router
