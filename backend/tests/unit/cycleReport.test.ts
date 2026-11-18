// Báo cáo NVL theo chu kỳ (MES 18/11 f) — phép gom của màn hình + Excel: chia ca theo thời gian, cộng dòng NVL trên nhóm mẻ, đếm trạng thái
// dòng bằng cùng luật phiếu của mẻ (reqLineState). Ba nơi vẽ (bảng · dải số · Excel) đọc cùng các hàm này.
import { describe, it, expect } from 'vitest'
import { shiftGroups, rowSum, lineStats, cellState, minutesBetween, durLabel, sumByUnit, shiftKpis, NO_SHIFT } from '../../../frontend/src/utils/cycleReport'

const B = (id: string, shift: string | null, at: string, extra: Partial<{ stage: string; status: string; filled_at: string | null; filled_qty: number; planned_qty: number; base_unit: string; batch_no: number }> = {}) => ({
  id, shift, created_at: at, batch_no: extra.batch_no ?? null, status: extra.status ?? 'OPEN', stage: extra.stage ?? 'working',
  planned_qty: extra.planned_qty ?? null, filled_qty: extra.filled_qty ?? 0, filled_at: extra.filled_at ?? null, base_unit: extra.base_unit ?? 'KG',
})

describe('shiftGroups — ca theo thứ tự thời gian, không theo tên', () => {
  it('ca đêm (Ca 3) bắt đầu trước ca sáng hôm sau (Ca 1) ⇒ Ca 3 đứng trước', () => {
    const g = shiftGroups([
      B('b2', 'Ca 1', '2026-11-18T01:00:00Z'), B('b1', 'Ca 3', '2026-11-17T16:00:00Z'), B('b3', 'Ca 1', '2026-11-18T02:00:00Z'),
    ])
    expect(g.map(x => x.shift)).toEqual(['Ca 3', 'Ca 1'])
    expect(g[1].batches.map(b => b.id)).toEqual(['b2', 'b3'])
  })
  it('mẻ chưa khai ca ⇒ nhóm "Chưa ghi ca"; khoảng trắng coi như trống', () => {
    const g = shiftGroups([B('a', null, '2026-11-18T01:00:00Z'), B('b', '  ', '2026-11-18T02:00:00Z')])
    expect(g).toHaveLength(1)
    expect(g[0].shift).toBe(NO_SHIFT)
  })
  it('cùng giờ mở ⇒ theo số mẻ', () => {
    const g = shiftGroups([B('x', 'Ca 1', '2026-11-18T01:00:00Z', { batch_no: 7 }), B('y', 'Ca 1', '2026-11-18T01:00:00Z', { batch_no: 2 })])
    expect(g[0].batches.map(b => b.id)).toEqual(['y', 'x'])
  })
})

describe('rowSum — định mức chỉ cộng ô có định mức; lệch = thực cấp − định mức', () => {
  const row = { cells: { a: { req: 100, tol: 1, iss: 101, n: 2 }, b: { req: 50, tol: null, iss: 0, n: 0 }, c: { req: null, tol: null, iss: 5, n: 1 } } }
  it('cả ba mẻ', () => {
    expect(rowSum(row, ['a', 'b', 'c'])).toEqual({ req: 150, iss: 106, diff: -44, devPct: -29.3, used: true })
  })
  it('mẻ không dùng mã ⇒ used = false, lệch % null', () => {
    expect(rowSum(row, ['zz'])).toEqual({ req: 0, iss: 0, diff: 0, devPct: null, used: false })
  })
  it('số lẻ không trôi (0,1 + 0,2)', () => {
    expect(rowSum({ cells: { a: { req: 0.1, tol: null, iss: 0.1, n: 1 }, b: { req: 0.2, tol: null, iss: 0.2, n: 1 } } }, ['a', 'b']).diff).toBe(0)
  })
})

describe('cellState / lineStats — cùng luật phiếu của mẻ', () => {
  const rows = [
    { cells: { m1: { req: 100, tol: 1, iss: 100.5, n: 1 }, m2: { req: 100, tol: 1, iss: 50, n: 1 } } },   // m1 đủ · m2 thiếu
    { cells: { m1: { req: 10, tol: null, iss: 12, n: 1 } } },                                             // m1 vượt (không khai mức lệch)
    { cells: { m2: { req: null, tol: null, iss: 3, n: 1 } } },                                           // m2 ngoài phiếu
  ]
  it('mẻ đang làm: chưa đủ = thiếu (progress); mẻ đã nạp: dưới mức = under (vẫn đếm thiếu)', () => {
    expect(cellState(rows[0].cells.m2, false)).toBe('progress')
    expect(cellState(rows[0].cells.m2, true)).toBe('under')
    expect(cellState(undefined, true)).toBeNull()
  })
  it('đếm: đủ 1 · thiếu 1 · vượt 1 · ngoài phiếu 1', () => {
    expect(lineStats(rows, [{ id: 'm1', stage: 'filled' }, { id: 'm2', stage: 'working' }])).toEqual({ lines: 4, ok: 1, short: 1, over: 1, extra: 1 })
  })
})

describe('thời gian', () => {
  it('phút giữa hai mốc; thiếu / ngược ⇒ null', () => {
    expect(minutesBetween('2026-11-18T01:00:00Z', '2026-11-18T03:05:00Z')).toBe(125)
    expect(minutesBetween(null, '2026-11-18T03:05:00Z')).toBeNull()
    expect(minutesBetween('2026-11-18T03:00:00Z', '2026-11-18T01:00:00Z')).toBeNull()
  })
  it('nhãn', () => {
    expect(durLabel(45)).toBe('45 phút')
    expect(durLabel(125)).toBe('2 giờ 05')
    expect(durLabel(120)).toBe('2 giờ')
    expect(durLabel(null)).toBe('')
  })
})

describe('sumByUnit — không cộng KG với L', () => {
  it('tách theo đơn vị, bỏ số 0', () => {
    const r = sumByUnit([{ q: 100, u: 'KG' }, { q: 50, u: 'l' }, { q: 0.5, u: 'kg' }, { q: 0, u: 'L' }], x => x.q, x => x.u)
    expect(r).toEqual([{ unit: 'KG', qty: 100.5 }, { unit: 'L', qty: 50 }])
  })
})

describe('shiftKpis — mỗi ca + dòng cả chu kỳ; mẻ huỷ không tính', () => {
  it('đếm mẻ, mẻ đã nạp, thời gian trung bình chỉ trên mẻ đã nạp', () => {
    const bs = [
      B('a', 'Ca 1', '2026-11-18T01:00:00Z', { stage: 'filled', filled_at: '2026-11-18T02:00:00Z', filled_qty: 6000, planned_qty: 6000 }),
      B('b', 'Ca 1', '2026-11-18T01:30:00Z', { stage: 'released', filled_at: '2026-11-18T03:30:00Z', filled_qty: 5900, planned_qty: 6000 }),
      B('c', 'Ca 2', '2026-11-18T09:00:00Z', { stage: 'working', planned_qty: 6000 }),
      B('d', 'Ca 2', '2026-11-18T09:10:00Z', { status: 'CANCELLED', stage: 'cancelled', planned_qty: 6000 }),
    ]
    const k = shiftKpis([], bs)
    expect(k.map(x => x.shift)).toEqual(['Ca 1', 'Ca 2', 'Cả chu kỳ'])
    expect(k[0]).toMatchObject({ batches: 2, filled: 2, avgMin: 90, filledQty: [{ unit: 'KG', qty: 11900 }] })
    expect(k[1]).toMatchObject({ batches: 1, filled: 0, avgMin: null, planned: [{ unit: 'KG', qty: 6000 }] })
    expect(k[2]).toMatchObject({ batches: 3, filled: 2 })
  })
})
