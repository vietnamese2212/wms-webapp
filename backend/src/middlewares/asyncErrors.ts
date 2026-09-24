import type { Router } from 'express'

// ── LỖI LẬP TRÌNH BẤT NGỜ TRONG HANDLER ASYNC PHẢI THÀNH 500 NGAY, KHÔNG PHẢI TREO 60 GIÂY ──
//
// VÌ SAO (đo 07/09, gói QA 53): Express 4 KHÔNG bắt promise bị từ chối. Một handler `async` ném
// TypeError (vd `body.qr_code` là SỐ nên `.trim()` nổ) thì không ai gọi `res` nữa — request treo
// tới khi Vercel cắt ở 60s và trả 504. Người dùng nhìn vòng xoay một phút cho một lỗi mà máy đã
// biết ở mili-giây đầu tiên; lambda bị chiếm trọn thời gian đó; và `error_logs` KHÔNG có dòng nào
// vì code chưa từng đi qua `fail()`. Hơn 300 handler đều `async`, bọc từng cái là sẽ sót cái viết
// sau — nên bọc MỘT LẦN ở lúc mount router: đi qua từng layer đã đăng ký, thay handle bằng bản
// chuyển lỗi (throw lẫn reject) sang `next(err)`, rồi error-handler cuối cùng ở app.ts trả JSON.
//
// Chạm vào `router.stack` là chạm vào ruột Express 4 (ổn định suốt vòng đời v4; v5 tự bắt async
// nên khi nâng lên v5 có thể bỏ file này). Không bọc layer 4 tham số (error handler) và không bọc
// chính hàm router lồng nhau — chỉ đi vào trong nó.

type Handle = (...args: unknown[]) => unknown
type Layer = { handle: Handle; route?: { stack: Layer[] }; name?: string }
type Stackable = { stack?: Layer[] }

function wrap(fn: Handle): Handle {
  if (fn.length >= 4) return fn   // (err, req, res, next) — giữ nguyên arity để Express nhận ra error handler
  const wrapped = function (this: unknown, req: unknown, res: unknown, next: unknown) {
    const nx = next as (e: unknown) => void
    try {
      const out = fn.call(this, req, res, next)
      if (out && typeof (out as Promise<unknown>).catch === 'function') (out as Promise<unknown>).catch(nx)
      return out
    } catch (e) { nx(e) }
  }
  return wrapped as Handle
}

export function catchAsyncErrors<R extends Router>(router: R): R {
  const seen = new Set<object>()
  const walk = (r: Stackable) => {
    if (!r.stack || seen.has(r)) return
    seen.add(r)
    for (const layer of r.stack) {
      if (layer.route) { for (const l of layer.route.stack) l.handle = wrap(l.handle) }
      else if (typeof layer.handle === 'function' && (layer.handle as unknown as Stackable).stack) walk(layer.handle as unknown as Stackable)
      else layer.handle = wrap(layer.handle)
    }
  }
  walk(router as unknown as Stackable)
  return router
}
