// Báo cáo NVL theo chu kỳ (MES 18/11 f · 21/11) — phép gom của dashboard + bảng + dải số + Excel: chia ca theo ngày, so với ĐỊNH MỨC GỐC,
// tách lệch Sửa phiếu / Cấp lệch, cộng KG chỉ dòng đã cấp xong, đếm NVL lệch. Mọi nơi vẽ đọc cùng các hàm này.
// 21/11 — user chốt: định mức = công thức (tách 2 phần) · lệch mẻ / ca = KG cộng dồn + số NVL lệch · ca = khung giờ của một ngày · ca bắt buộc.
import { describe, it, expect } from 'vitest'
import {
  shiftGroups, rowSum, lineStats, cellState, cellSettled, cellDev, devAgg, devLines, materialDevs, minutesBetween, durLabel, sumByUnit, shiftKpis,
  NO_SHIFT, rowBatchLines, rowDeviations, LINE_STATE_LABEL, isKgRow,
} from '../../../frontend/src/utils/cycleReport'

const B = (id: string, shift: string | null, at: string, extra: Partial<{ stage: string; status: string; filled_at: string | null; filled_qty: number; planned_qty: number; base_unit: string; batch_no: number; prod_date: string }> = {}) => ({
  id, shift, created_at: at, batch_no: extra.batch_no ?? null, status: extra.status ?? 'OPEN', stage: extra.stage ?? 'working',
  planned_qty: extra.planned_qty ?? null, filled_qty: extra.filled_qty ?? 0, filled_at: extra.filled_at ?? null, base_unit: extra.base_unit ?? 'KG',
  prod_date: extra.prod_date ?? null,
})
/** ô NVL × mẻ: định mức gốc · phiếu · thực cấp */
const C = (std: number | null, req: number | null, iss: number, o: Partial<{ tol: number | null; rm: boolean; why: string }> = {}) =>
  ({ std, req, iss, n: iss ? 1 : 0, tol: o.tol === undefined ? 1 : o.tol, rm: o.rm ?? false, why: o.why ?? null })

describe('shiftGroups — ca của MỘT NGÀY, theo thứ tự thời gian (21/11)', () => {
  it('chu kỳ 26 thật: Ca 1 ngày 17 và mẻ không ca ngày 18 ⇒ hai nhóm, nhãn kèm ngày', () => {
    const g = shiftGroups([
      B('m1', 'Ca 1', '2026-11-17T11:33:46Z', { prod_date: '2026-11-17', batch_no: 1 }),
      B('m2', null, '2026-11-18T01:31:05Z', { prod_date: '2026-11-18', batch_no: 2 }),
    ])
    expect(g.map(x => x.shift)).toEqual(['Ca 1 · 17/11', `${NO_SHIFT} · 18/11`])
  })
  it('Ca 1 hôm 17 và Ca 1 hôm 18 KHÔNG dồn chung (trước 21/11 dồn một cột)', () => {
    const g = shiftGroups([
      B('a', 'Ca 1', '2026-11-17T00:00:00Z', { prod_date: '2026-11-17' }), B('b', 'Ca 1', '2026-11-17T05:00:00Z', { prod_date: '2026-11-17' }),
      B('c', 'Ca 1', '2026-11-18T00:30:00Z', { prod_date: '2026-11-18' }),
    ])
    expect(g.map(x => `${x.shift}:${x.batches.map(b => b.id).join(',')}`)).toEqual(['Ca 1 · 17/11:a,b', 'Ca 1 · 18/11:c'])
  })
  it('ca đêm qua nửa đêm (23:00 và 01:00 giờ VN) vẫn là MỘT ca; Ca 3 bắt đầu trước Ca 1 sáng hôm sau ⇒ đứng trước', () => {
    const g = shiftGroups([
      B('n2', 'Ca 3', '2026-11-17T18:00:00Z', { prod_date: '2026-11-18' }),   // 01:00 ngày 18
      B('d1', 'Ca 1', '2026-11-18T01:00:00Z', { prod_date: '2026-11-18' }),
      B('n1', 'Ca 3', '2026-11-17T16:00:00Z', { prod_date: '2026-11-17' }),   // 23:00 ngày 17
    ])
    expect(g.map(x => `${x.shift}:${x.batches.map(b => b.id).join(',')}`)).toEqual(['Ca 3 · 17/11:n1,n2', 'Ca 1 · 18/11:d1'])
  })
  it('cả chu kỳ trong một ngày ⇒ nhãn không kèm ngày', () => {
    const g = shiftGroups([B('a', 'Ca 1', '2026-11-18T01:00:00Z', { prod_date: '2026-11-18' }), B('b', 'Ca 2', '2026-11-18T09:00:00Z', { prod_date: '2026-11-18' })])
    expect(g.map(x => x.shift)).toEqual(['Ca 1', 'Ca 2'])
  })
  it('không có Ngày SX ⇒ ngày theo giờ VN của lúc mở mẻ (17:30Z = 00:30 ngày hôm sau)', () => {
    const g = shiftGroups([B('a', 'Ca 1', '2026-11-17T01:00:00Z'), B('b', 'Ca 3', '2026-11-17T17:30:00Z')])
    expect(g.map(x => x.shift)).toEqual(['Ca 1 · 17/11', 'Ca 3 · 18/11'])
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

describe('so với ĐỊNH MỨC GỐC — tình huống → kết quả (21/11)', () => {
  it('trưởng ca sửa phiếu 90 → 150, cấp 150 (mẻ đang làm) ⇒ đã cấp xong, VƯỢT định mức +60 = sửa phiếu +60, cấp lệch 0', () => {
    const c = C(90, 150, 150, { why: 'bù hao' })
    expect(cellSettled(c, false)).toBe(true)
    expect(cellState(c, false)).toBe('over')
    expect(cellDev(c)).toEqual({ std: 90, sheet: 150, iss: 150, edit: 60, exec: 0, total: 60 })
  })
  it('phiếu sửa 673,5 → 600, cấp 600 ⇒ DƯỚI định mức −73,5 (do sửa phiếu)', () => {
    const c = C(673.5, 600, 600)
    expect(cellState(c, false)).toBe('under')
    expect(cellDev(c)).toMatchObject({ edit: -73.5, exec: 0, total: -73.5 })
  })
  it('phiếu đúng định mức, cấp vượt mức lệch ⇒ vượt (do cấp lệch)', () => {
    const c = C(100, 100, 103)
    expect(cellState(c, false)).toBe('over')
    expect(cellDev(c)).toMatchObject({ edit: 0, exec: 3, total: 3 })
  })
  it('cấp trong mức lệch ±1% ⇒ trong mức', () => {
    expect(cellState(C(100, 100, 100.8), false)).toBe('ok')
  })
  it('đang cấp dở ⇒ chưa xong (progress / none), chưa có số lệch; mẻ đã nạp bồn ⇒ dưới định mức', () => {
    expect(cellState(C(100, 100, 40), false)).toBe('progress')
    expect(cellState(C(100, 100, 0), false)).toBe('none')
    expect(cellState(C(100, 100, 40), true)).toBe('under')
  })
  it('phiếu nâng 90 → 150 mà mới cấp 100 ⇒ chưa xong (dù đã quá định mức) — tính khi cấp đủ phiếu', () => {
    expect(cellState(C(90, 150, 100), false)).toBe('progress')
  })
  it('dòng BỎ khỏi phiếu (định mức 20, không cấp) ⇒ đã xong, dưới định mức −20 do sửa phiếu', () => {
    const c = C(20, null, 0, { rm: true, why: 'đổi mã' })
    expect(cellState(c, false)).toBe('under')
    expect(cellDev(c)).toEqual({ std: 20, sheet: 0, iss: 0, edit: -20, exec: 0, total: -20 })
  })
  it('dòng THÊM tay vào phiếu (không có định mức) ⇒ ngoài định mức; cấp đủ phiếu ⇒ cả phần là sửa phiếu', () => {
    const c = C(null, 5, 5)
    expect(cellState(c, false)).toBe('extra')
    expect(cellDev(c)).toMatchObject({ edit: 5, exec: 0, total: 5 })
    expect(cellState(C(null, 5, 2), false)).toBe('progress')
  })
  it('mã CẤP NGOÀI PHIẾU ⇒ ngoài định mức, cả phần là cấp lệch', () => {
    const c = C(null, null, 3)
    expect(cellState(c, false)).toBe('extra')
    expect(cellDev(c)).toMatchObject({ edit: 0, exec: 3, total: 3 })
  })
  it('API cũ chưa có định mức gốc ⇒ coi như phiếu', () => {
    const old = { req: 100, tol: 1, iss: 100, n: 1 }
    expect(cellState(old, false)).toBe('ok')
    expect(cellDev(old)).toMatchObject({ std: 100, total: 0 })
  })
  it('mọi trạng thái đều có chữ cho Excel', () => {
    for (const k of ['ok', 'over', 'under', 'progress', 'extra', 'none', 'removed'] as const) expect(LINE_STATE_LABEL[k]).toBeTruthy()
  })
})

describe('devAgg — lệch của mẻ / ca = KG cộng dồn (dòng đã xong) + số NVL lệch (mọi đơn vị)', () => {
  const rows = [
    { base_unit: 'KG', cells: { m1: C(90, 150, 150), m2: C(20, 20, 0) } },         // m1 vượt +60 (sửa phiếu) · m2 chưa cấp
    { base_unit: 'KG', cells: { m1: C(673.5, 600, 600), m2: C(150, 150, 151) } },  // m1 dưới −73,5 · m2 cấp 151 trong mức ±1% (≤ 151,5), cấp lệch +1
    { base_unit: 'BAG', cells: { m1: C(1.5, 1.5, 2, { tol: null }) } },            // m1 vượt (BAG — đếm NVL lệch, không cộng KG)
  ]
  const bs = [{ id: 'm1', stage: 'working' }, { id: 'm2', stage: 'working' }]
  it('một mẻ: KG chỉ NVL tính KG; NVL lệch đếm cả BAG', () => {
    const a = devAgg(rows, [bs[0]])
    expect(a.kg).toMatchObject({ std: 763.5, sheet: 750, iss: 750, edit: -13.5, exec: 0, total: -13.5, pct: -1.8 })
    expect({ over: a.over, under: a.under, extra: a.extra, pending: a.pending, edited: a.edited }).toEqual({ over: 2, under: 1, extra: 0, pending: 0, edited: 2 })
    expect(devLines(a)).toBe(3)
  })
  it('dòng chưa cấp xong không vào KG, đếm "chưa xong"', () => {
    const a = devAgg(rows, [bs[1]])
    expect(a.kg).toMatchObject({ std: 150, iss: 151, total: 1, exec: 1, pct: 0.7 })
    expect(a.pending).toBe(1)
    expect(devLines(a)).toBe(0)
  })
  it('cả chu kỳ = cộng các mẻ', () => {
    const a = devAgg(rows, bs)
    expect(a.kg.total).toBe(-12.5)
    expect(a.lines).toBe(5)
    expect(a.settled + a.pending).toBe(5)
  })
  it('isKgRow không phân biệt hoa thường / khoảng trắng', () => {
    expect(isKgRow({ base_unit: ' kg ' })).toBe(true)
    expect(isKgRow({ base_unit: 'L' })).toBe(false)
  })
})

describe('rowSum — định mức gốc · phiếu · thực cấp (mọi ô, kể cả đang cấp dở)', () => {
  const row = { cells: { a: C(100, 100, 101), b: C(50, 50, 0, { tol: null }), c: C(null, null, 5, { tol: null }), d: C(20, null, 0, { rm: true }) } }
  it('bốn mẻ', () => {
    expect(rowSum(row, ['a', 'b', 'c', 'd'])).toEqual({ std: 170, sheet: 150, iss: 106, diff: -64, devPct: -37.6, used: true, norm: true })
  })
  it('mẻ không dùng mã ⇒ used = false, lệch % null', () => {
    expect(rowSum(row, ['zz'])).toEqual({ std: 0, sheet: 0, iss: 0, diff: 0, devPct: null, used: false, norm: false })
  })
  it('số lẻ không trôi (0,1 + 0,2)', () => {
    expect(rowSum({ cells: { a: C(0.1, 0.1, 0.1), b: C(0.2, 0.2, 0.2) } }, ['a', 'b']).diff).toBe(0)
  })
})

describe('lineStats / rowBatchLines / rowDeviations — NVL × CA', () => {
  const g = shiftGroups([
    B('m1', 'Ca 1', '2026-11-18T01:00:00Z', { stage: 'filled', batch_no: 1 }), B('m2', 'Ca 1', '2026-11-18T02:00:00Z', { stage: 'filled', batch_no: 2 }),
    B('m3', 'Ca 2', '2026-11-18T09:00:00Z', { stage: 'working', batch_no: 3 }), B('m4', 'Ca 2', '2026-11-18T10:00:00Z', { stage: 'filled', batch_no: 4 }),
  ])
  const row = { cells: { m1: C(100, 100, 100), m2: C(100, 100, 118), m3: C(100, 100, 40), m4: C(100, 100, 80) } }
  it('chỉ mẻ có dùng mã, theo thứ tự ca → mẻ, kèm ca, trạng thái so định mức và phần lệch', () => {
    const l = rowBatchLines(row, g)
    expect(l.map(x => `${x.shift}:${x.batch.id}:${x.state}`)).toEqual(['Ca 1:m1:ok', 'Ca 1:m2:over', 'Ca 2:m3:progress', 'Ca 2:m4:under'])
    expect(l[1].dev).toMatchObject({ exec: 18, total: 18 })
  })
  it('Mẻ lệch = vượt + dưới + ngoài định mức (mẻ đang cấp dở KHÔNG tính)', () => {
    expect(rowDeviations(rowBatchLines(row, g))).toBe(2)
    expect(rowDeviations(rowBatchLines({ cells: { m1: C(null, null, 3) } }, g))).toBe(1)
  })
  it('đếm dòng: đủ · thiếu (dưới + đang cấp) · vượt · ngoài định mức', () => {
    const rows = [row, { cells: { m3: C(null, null, 2) } }]
    expect(lineStats(rows, [{ id: 'm1', stage: 'filled' }, { id: 'm2', stage: 'filled' }, { id: 'm3', stage: 'working' }, { id: 'm4', stage: 'filled' }]))
      .toEqual({ lines: 5, ok: 1, short: 2, over: 1, extra: 1 })
  })
})

describe('materialDevs — NVL lệch nhiều nhất', () => {
  it('chỉ mã có lệch, xếp theo số mẻ lệch rồi |lệch %|', () => {
    const rows = [
      { cells: { a: C(100, 100, 100), b: C(100, 100, 100) } },          // không lệch ⇒ bỏ
      { cells: { a: C(10, 10, 12), b: C(10, 10, 10) } },                // 1 mẻ lệch, +20% trên mẻ a ⇒ tổng +10%
      { cells: { a: C(50, 50, 40), b: C(50, 50, 60) } },                // 2 mẻ lệch (dưới, vượt), tổng 0%
      { cells: { a: C(5, 5, 8) } },                                     // 1 mẻ lệch, +60%
    ]
    const m = materialDevs(rows, [{ id: 'a', stage: 'filled' }, { id: 'b', stage: 'filled' }])
    expect(m.map(x => `${x.row}:${x.devBatches}:${x.pct}`)).toEqual(['2:2:0', '3:1:60', '1:1:10'])
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

// 27/11 — MẺ KHÔNG ĐỊNH MỨC (ô nn = true): chỉ có thực cấp; không vào số dòng / lệch / KG lệch / NVL lệch; tổng dòng NVL vẫn cộng
// thực cấp nhưng định mức / lệch chỉ tính trên ô có định mức (norm = false ⇒ màn in "—").
describe('mẻ không định mức (27/11)', () => {
  const NN = (iss: number) => ({ std: null, req: null, iss, n: 1, tol: null, rm: false, why: null, nn: true })
  const rows = [{ base_unit: 'KG', cells: { a: C(100, 100, 100), b: NN(80) } }, { base_unit: 'KG', cells: { b: NN(5) } }]
  const batches = [B('a', 'Ca 1', '2026-11-27T01:00:00Z', { stage: 'released' }), B('b', 'Ca 1', '2026-11-27T02:00:00Z', { stage: 'released' })]
  it("ô không định mức: trạng thái 'nonorm', chỉ thực cấp, không lệch", () => {
    expect(cellState(NN(80), true)).toBe('nonorm')
    expect(cellDev(NN(80))).toEqual({ std: 0, sheet: 0, iss: 80, edit: 0, exec: 0, total: 0 })
    expect(LINE_STATE_LABEL.nonorm).toBe('Không định mức')
  })
  it('tổng dòng NVL: thực cấp cộng cả mẻ không định mức, lệch chỉ trên ô có định mức', () => {
    const s = rowSum(rows[0], ['a', 'b'])
    expect(s).toMatchObject({ std: 100, iss: 180, diff: 0, devPct: 0, norm: true, used: true })
    expect(rowSum(rows[1], ['a', 'b'])).toMatchObject({ iss: 5, norm: false, used: true })
  })
  it('đếm dòng / lệch / KG bỏ qua ô không định mức', () => {
    expect(lineStats(rows, batches)).toMatchObject({ lines: 1, ok: 1, short: 0, over: 0, extra: 0 })
    const a = devAgg(rows, batches)
    expect(a).toMatchObject({ lines: 1, settled: 1, ok: 1, over: 0, under: 0, extra: 0, nonorm: 2 })
    expect(a.kg).toMatchObject({ std: 100, iss: 100, total: 0 })
    expect(devLines(a)).toBe(0)
    expect(materialDevs(rows, batches)).toEqual([])
    expect(rowDeviations(rowBatchLines(rows[1], [{ shift: 'Ca 1', batches }]))).toBe(0)
  })
})
