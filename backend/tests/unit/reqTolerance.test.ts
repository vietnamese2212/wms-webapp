// Phiếu của mẻ — trạng thái dòng theo mức lệch cho phép (MES 17/11, user chốt "vượt mức lệch: chỉ tô đỏ"). Hàm FE dùng chung
// cho bảng máy tính / danh sách điện thoại / ô "NVL đã đủ" — test ở đây để luật không trôi giữa các chỗ vẽ.
import { describe, it, expect } from 'vitest'
import { reqLineState, devLabel } from '../../../frontend/src/utils/reqTolerance'

describe('reqLineState — có mức lệch ±1%', () => {
  const base = { required: 585, tol_pct: 1 }
  it.each<[number, string, boolean]>([
    [0, 'none', false],
    [300, 'progress', false],
    [580, 'ok', false],     // −0,85% — trong mức lệch ⇒ đủ
    [585, 'ok', false],
    [590.8, 'ok', false],   // +0,99%
    [600, 'over', true],    // +2,6% ⇒ đỏ, vẫn cho cấp
  ])('cấp %d ⇒ %s (đỏ=%s)', (consumed, state, red) => {
    const r = reqLineState({ ...base, consumed })
    expect(r.state).toBe(state)
    expect(r.outOfTol).toBe(red)
  })
  it('trong mức lệch thì "còn thiếu" = 0; chưa tới cận dưới thì còn thiếu = yêu cầu − đã cấp', () => {
    expect(reqLineState({ ...base, consumed: 580 }).need).toBe(0)
    expect(reqLineState({ ...base, consumed: 300 }).need).toBe(285)
  })
  it('mẻ đã đóng mà dưới cận dưới ⇒ under (đỏ); trong mức lệch vẫn ok', () => {
    expect(reqLineState({ ...base, consumed: 500 }, true)).toMatchObject({ state: 'under', outOfTol: true })
    expect(reqLineState({ ...base, consumed: 0 }, true)).toMatchObject({ state: 'under', outOfTol: true })
    expect(reqLineState({ ...base, consumed: 580 }, true).state).toBe('ok')
  })
  it('lệch % một số lẻ', () => {
    expect(reqLineState({ ...base, consumed: 600 }).devPct).toBe(2.6)
    expect(devLabel(2.6)).toBe('+2,6%')
    expect(devLabel(-0.9)).toBe('−0,9%')
  })
})

describe('reqLineState — không khai mức lệch (giữ luật cũ)', () => {
  it('đủ khi cấp ≥ yêu cầu; vượt ⇒ over (đỏ); thiếu một chút vẫn đang cấp', () => {
    expect(reqLineState({ required: 60, consumed: 60 }).state).toBe('ok')
    expect(reqLineState({ required: 60, consumed: 60.4 })).toMatchObject({ state: 'over', outOfTol: true })
    expect(reqLineState({ required: 60, consumed: 59.9 })).toMatchObject({ state: 'progress', need: 0.1 })
  })
  it('mức lệch 0% = khớp đúng', () => {
    expect(reqLineState({ required: 1, consumed: 1.001, tol_pct: 0 }).state).toBe('over')
    expect(reqLineState({ required: 1, consumed: 1, tol_pct: 0 }).state).toBe('ok')
  })
})

describe('reqLineState — dòng không thuộc phiếu', () => {
  it('dòng đã bỏ / ngoài yêu cầu không tô đỏ, không còn thiếu', () => {
    expect(reqLineState({ required: null, consumed: 5, removed: true })).toMatchObject({ state: 'removed', need: 0, outOfTol: false })
    expect(reqLineState({ required: null, consumed: 5 })).toMatchObject({ state: 'extra', need: 0, outOfTol: false })
  })
})
