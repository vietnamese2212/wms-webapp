// Middleware validate(): input xấu → 400 kèm TÊN TRƯỜNG tiếng Việt, không tới controller; hợp lệ → req đã ép kiểu.
import { describe, it, expect } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key'

type Captured = { status?: number; body?: unknown }
function mockRes(): Response & Captured {
  const r: Partial<Response> & Captured = {}
  r.status = (code: number) => { r.status_ = code; return r as Response }
  r.json = (b: unknown) => { r.body = b; return r as Response }
  Object.defineProperty(r, 'status', { value: (code: number) => { r.status = code as never; r.statusCode = code; return r as Response } })
  return r as Response & Captured
}
function run(mw: (req: Request, res: Response, next: NextFunction) => void, req: Partial<Request>) {
  const res = { statusCode: 200, body: undefined as unknown } as unknown as Response & { body: unknown }
  ;(res as unknown as { status: (c: number) => Response }).status = (c: number) => { res.statusCode = c; return res }
  ;(res as unknown as { json: (b: unknown) => Response }).json = (b: unknown) => { (res as { body: unknown }).body = b; return res }
  let nextCalled = false
  mw(req as Request, res, () => { nextCalled = true })
  return { res, nextCalled, req }
}

describe('validate()', async () => {
  const { validate, z, zText, zDay, zIdParam, zQtyBase } = await import('../../src/middlewares/validate')

  it('body sai kiểu → 400 VALIDATION nêu đúng trường, không gọi next', () => {
    const mw = validate({ body: z.object({ qty: zQtyBase, note: zText(0, 20).optional() }) })
    const r = run(mw, { body: { qty: 'abc' }, params: {}, query: {} })
    expect(r.nextCalled).toBe(false)
    expect(r.res.statusCode).toBe(400)
    const err = (r.res.body as { error: { code: string; message: string } }).error
    expect(err.code).toBe('VALIDATION')
    expect(err.message).toMatch(/^body\.qty: phải là số/)
  })

  it('thiếu trường bắt buộc → "bắt buộc"; ngày không có thật → bị chặn trước Postgres', () => {
    const mw = validate({ body: z.object({ day: zDay }) })
    expect((run(mw, { body: {} }).res.body as { error: { message: string } }).error.message).toBe('body.day: bắt buộc')
    expect((run(mw, { body: { day: '2026-02-31' } }).res.body as { error: { message: string } }).error.message).toMatch(/^body\.day: ngày/)
    expect(run(mw, { body: { day: '2026-02-28' } }).nextCalled).toBe(true)
  })

  it('body không phải object (mảng/null/số) → 400, không nổ TypeError', () => {
    const mw = validate({ body: z.object({ value: z.unknown() }) })
    for (const body of [null, [], 5, 'x'] as unknown[]) {
      const r = run(mw, { body })
      expect(r.nextCalled, JSON.stringify(body)).toBe(false)
      expect(r.res.statusCode, JSON.stringify(body)).toBe(400)
    }
  })

  it('hợp lệ → next() và req.body đã trim/ép kiểu theo schema', () => {
    const mw = validate({ params: zIdParam, body: z.object({ name: zText(1, 50), n: z.coerce.number().int() }) })
    const r = run(mw, { params: { id: ' jt-admin ' }, body: { name: '  Kho Ba Vì ', n: '42' } })
    expect(r.nextCalled).toBe(true)
    expect(r.req.params).toEqual({ id: 'jt-admin' })
    expect(r.req.body).toEqual({ name: 'Kho Ba Vì', n: 42 })
  })

  it('zText có trần: chuỗi quá dài → "tối đa n ký tự"', () => {
    const mw = validate({ body: z.object({ name: zText(1, 5) }) })
    expect((run(mw, { body: { name: 'quá dài rồi' } }).res.body as { error: { message: string } }).error.message).toBe('body.name: tối đa 5 ký tự')
    expect((run(mw, { body: { name: '   ' } }).res.body as { error: { message: string } }).error.message).toBe('body.name: không được để trống')
  })
})
