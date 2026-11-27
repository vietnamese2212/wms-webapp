// Số lượng trong công thức theo quyền "Xem công thức" (27/11): người không có quyền nhận tên + danh sách mã, không nhận số;
// cờ list_only (công thức chỉ danh sách mã) đúng theo DỮ LIỆU THẬT dù số đã bị ẩn.
import { describe, it, expect } from 'vitest'
import { recipeView, recipeLinesView } from '../../src/utils/recipeView'

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
