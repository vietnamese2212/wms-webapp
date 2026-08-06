// Thông báo đẩy (Web Push) — auth-only, thao tác trên thiết bị của CHÍNH user (xem notifyController).
import { Router } from 'express'
import * as notify from '../controllers/notifyController'

const router = Router()

router.get('/vapid-key', notify.getVapidKey)
router.post('/subscriptions', notify.subscribe)
router.delete('/subscriptions', notify.unsubscribe)
router.post('/test', notify.testPush)

export default router
