import { Router, type Request } from 'express'
import rateLimit from 'express-rate-limit'
import { requireApiKey } from '../middlewares/apiKey'
import * as ex from '../controllers/integration/exportController'

// Cổng tích hợp ERP — READ-ONLY, xác thực bằng API key (KHÔNG qua verifyToken/anon).
// Mount ở /api/integration (app.ts), tách hẳn khỏi các router người-dùng.
const router = Router()

// Rate-limit theo API key (ERP sync theo lô → 600 req / 5 phút / key là rộng rãi).
// keyGenerator dùng chính API key; fallback IP khi chưa có header.
const limiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,   // tắt kiểm nội bộ (ta tự keyGenerator theo API key, không theo IP)
  keyGenerator: (req: Request) => {
    const h = req.headers['x-api-key']
    if (typeof h === 'string' && h) return h
    return req.headers.authorization || req.ip || 'anon'
  },
})
router.use(limiter)

// v1 — mỗi endpoint 1 scope riêng (thu hồi/giới hạn từng ERP được).
router.get('/v1/materials',        requireApiKey('materials:read'), ex.exportMaterials)
router.get('/v1/inventory',        requireApiKey('inventory:read'), ex.exportInventory)
router.get('/v1/inbound-receipts', requireApiKey('inbound:read'),   ex.exportInboundReceipts)
router.get('/v1/outbound-orders',  requireApiKey('outbound:read'),  ex.exportOutboundOrders)
router.get('/v1/scan-entries',     requireApiKey('scans:read'),     ex.exportScanEntries)

export default router
