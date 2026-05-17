import { Router } from 'express'
import * as auth from '../controllers/auth/authController'
import { verifyToken } from '../middlewares/auth'

const router = Router()

router.post('/login',           auth.login)
router.get('/me',  verifyToken, auth.me)
router.post('/change-password', verifyToken, auth.changePassword)

export default router
