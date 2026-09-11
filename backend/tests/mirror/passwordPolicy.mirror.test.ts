// MIRROR chính sách mật khẩu: FE báo sớm trong form ⇄ BE chặn thật — lệch = form nói OK, lưu bị 400.
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/passwordPolicy'
import * as FE from '../../../frontend/src/utils/passwordPolicy'
import { rng, N, SEED } from '../helpers/rng'

const CORPUS = ['', '123456', 'password', 'Password2026!', 'matkhau123', 'aaaaaaaaa1', 'abcdefghij', '1234567890',
  'ab1ab1ab1ab1', 'Kho-BaVi-2026', 'lam.tranhoang1', 'NV00123abcXYZ', 'qwertyuiop1', 'x'.repeat(129) + '1']

describe(`passwordPolicy BE ⇄ FE (seed ${SEED})`, () => {
  it('hằng số + passwordError khớp trên corpus và chuỗi ngẫu nhiên', () => {
    expect(FE.PASSWORD_MIN).toBe(BE.PASSWORD_MIN)
    expect(FE.PASSWORD_HINT).toBe(BE.PASSWORD_HINT)
    const r = rng()
    const ctxs = [{}, { email: 'lam.tranhoang@lof.vn' }, { employee_code: 'NV00123' }, { email: 'ab@x.vn', employee_code: 'x1' }]
    const inputs: unknown[] = [...CORPUS]
    for (let i = 0; i < N; i++) inputs.push(r.bool(0.05) ? r.pick([null, 42, undefined]) : r.str('abcXYZ0123456789!@#-_ .', 0, 20))
    for (const pw of inputs) for (const ctx of ctxs)
      expect(FE.passwordError(pw, ctx), JSON.stringify({ pw, ctx })).toBe(BE.passwordError(pw, ctx))
  })
})
