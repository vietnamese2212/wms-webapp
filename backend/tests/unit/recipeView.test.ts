// Số lượng trong công thức theo quyền "Xem công thức" (27/11): người không có quyền nhận tên + danh sách mã, không nhận số;
// cờ list_only (công thức chỉ danh sách mã) đúng theo DỮ LIỆU THẬT dù số đã bị ẩn.
import { describe, it, expect } from 'vitest'
import { recipeView, recipeLinesView, hideNormFigures } from '../../src/utils/recipeView'

const R = { id: 'r1', name: 'Chuẩn', base_qty: 6000 as number | null }
const L = [{ material_id: 'm1', qty: 450 as number | null, tol_pct: 1 as number | null }, { material_id: 'm2', qty: 520 as number | null, tol_pct: null as number | null }]

describe('recipeView — ẩn số lượng công thức theo quyền', () => {
  it('có quyền: giữ nguyên số, list_only=false, qty_hidden=false', () => {
    expect(recipeView(R, true)).toEqual({ ...R, list_only: false, qty_hidden: false })
    expect(recipeLinesView(L, true)).toEqual(L)
  })
  it('không quyền: bỏ cỡ mẻ + số + mức lệch, giữ tên + mã; list_only vẫn false (công thức CÓ số)', () => {
    expect(recipeView(R, false)).toEqual({ id: 'r1', name: 'Chuẩn', base_qty: null, list_only: false, qty_hidden: true })
    expect(recipeLinesView(L, false)).toEqual([{ material_id: 'm1', qty: null, tol_pct: null }, { material_id: 'm2', qty: null, tol_pct: null }])
  })
  it('công thức chỉ danh sách mã: list_only=true với cả hai phía', () => {
    expect(recipeView({ ...R, base_qty: null }, true).list_only).toBe(true)
    expect(recipeView({ ...R, base_qty: null }, false).list_only).toBe(true)
  })
})

// 27/11 — Báo cáo NVL với người không có quyền Xem công thức: bỏ mọi số định mức / lệch (suy ngược ra công thức), giữ thực cấp + số đếm
describe('hideNormFigures — Báo cáo NVL không lộ định mức', () => {
  it('dashboard: bỏ KG định mức / lệch / % ở mọi tầng, giữ thực cấp + số đếm + mục tiêu', () => {
    const d = { targets: { dev_pct: 0.5, pass_pct: 95 }, totals: { batches: 3, pass: 2, std_kg: 100, iss_kg: 101, total_kg: 1, edit_kg: 0, exec_kg: 1 },
      buckets: [{ k: '2026-11-27', std_kg: 100, total_kg: 1, pass: 2 }], pareto: [{ code: 'M1', n: 2, std: 50, iss: 51 }],
      spc: [{ id: 'b1', pct: 1.2, dev: 1 }], exc: [{ id: 'b1', pct: 1.2, mat: { code: 'M1', diff: 1, state: 'over' } }] }
    const h = hideNormFigures(d) as unknown as typeof d & { norm_hidden: boolean }
    expect(h.norm_hidden).toBe(true)
    expect(h.targets).toEqual({ dev_pct: 0.5, pass_pct: 95 })
    expect(h.totals).toEqual({ batches: 3, pass: 2, std_kg: null, iss_kg: 101, total_kg: null, edit_kg: null, exec_kg: null })
    expect(h.buckets[0]).toEqual({ k: '2026-11-27', std_kg: null, total_kg: null, pass: 2 })
    expect(h.pareto[0]).toEqual({ code: 'M1', n: 2, std: null, iss: 51 })
    expect(h.spc[0]).toEqual({ id: 'b1', pct: null, dev: 1 })
    expect(h.exc[0].mat).toEqual({ code: 'M1', diff: null, state: 'over' })
  })
  it('báo cáo chu kỳ: ô NVL × mẻ bỏ phiếu / định mức / mức lệch / lý do, giữ thực cấp, đánh dấu hid', () => {
    const r = { batches: [{ id: 'b1', planned_qty: 6000 }], rows: [{ material_code: 'M1', cells: { b1: { req: 450, std: 450, rm: false, why: 'bù', tol: 1, iss: 452, n: 2 } } }] }
    const h = hideNormFigures(r) as unknown as { batches: unknown[]; rows: { cells: Record<string, unknown> }[] }
    expect(h.batches).toEqual([{ id: 'b1', planned_qty: 6000 }])
    expect(h.rows[0].cells.b1).toEqual({ req: null, std: null, rm: false, why: null, tol: null, iss: 452, n: 2, hid: true })
  })
})
