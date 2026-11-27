// Nạp định mức từ Excel (MES 19/11) — luật gom dòng / thay công thức đã có / mặc định / ĐVT / cỡ mẻ chuẩn.
// Hàm thuần `planRecipeImport` là MỘT đoạn kiểm cho cả preflight lẫn lần ghi ⇒ test ở đây khoá bảng tình huống
// của docs/modules/production.md mục "Nạp định mức từ Excel".
import { describe, it, expect } from 'vitest'
import { planRecipeImport, parseYes, unitMatches, type ImpMaterial, type ImpExisting } from '../../src/utils/recipeImport'

const mat = (id: string, code: string, base_unit: string, extra: Partial<ImpMaterial> = {}): ImpMaterial =>
  ({ id, material_code: code, base_unit, category: null, is_semi_finished: false, is_active: true, ...extra })
const BTP = mat('btp1', 'BTP-A', 'KG', { is_semi_finished: true })
const BTP2 = mat('btp2', 'BTP-B', 'L', { is_semi_finished: true })
const NVL1 = mat('n1', '210000001', 'KG')
const NVL2 = mat('n2', '210000002', 'BAG')
const NVL_OFF = mat('n3', '210000003', 'KG', { is_active: false })
const NOT_BTP = mat('x1', '210000009', 'KG')
const matByCode = new Map([BTP, BTP2, NVL1, NVL2, NVL_OFF, NOT_BTP].map(m => [m.material_code, m]))
const ctx = (existing: ImpExisting[] = [], categoryOk = () => true) => ({ matByCode, existing, categoryOk })
const row = (o: Record<string, unknown>) => ({ btp_code: 'BTP-A', recipe_name: 'Chuẩn', base_qty: 6000, nvl_code: '210000001', qty: 10, ...o })
const plan = (rows: Record<string, unknown>[], existing: ImpExisting[] = []) => planRecipeImport(rows, rows.map((_, i) => i + 2), ctx(existing))

describe('gom dòng thành công thức', () => {
  it('cùng Mã BTP + Tên công thức (không phân biệt hoa thường) = một công thức, giữ thứ tự dòng', () => {
    const p = plan([row({}), row({ recipe_name: 'CHUẨN', nvl_code: '210000002', qty: '1,5', base_qty: '' }), row({ recipe_name: 'Mùa hè', qty: 3 })])
    expect(p.errors).toEqual([])
    expect(p.recipes).toHaveLength(2)
    const chuan = p.recipes.find(r => r.name === 'Chuẩn')!
    expect(chuan.base_qty).toBe(6000)
    expect(chuan.lines).toEqual([{ material_id: 'n1', qty: 10, tol_pct: null }, { material_id: 'n2', qty: 1.5, tol_pct: null }])
    expect(p.toInsert).toBe(2); expect(p.toUpdate).toBe(0); expect(p.lineCount).toBe(3); expect(p.btpCount).toBe(1)
  })
  it('số kiểu Việt: "6.000" = sáu nghìn, "0,25" = 0,25; mã số Excel đọc thành number vẫn khớp', () => {
    const p = plan([row({ base_qty: '6.000', qty: '0,25', nvl_code: 210000001 })])
    expect(p.errors).toEqual([])
    expect(p.recipes[0].base_qty).toBe(6000)
    expect(p.recipes[0].lines[0].qty).toBe(0.25)
  })
  it('cỡ mẻ chuẩn khác nhau giữa các dòng của MỘT công thức ⇒ lỗi', () => {
    const p = plan([row({}), row({ nvl_code: '210000002', base_qty: 5000 })])
    expect(p.errors.join()).toMatch(/Dòng 3 — Cỡ mẻ chuẩn 5\.000 khác dòng 2/)
  })
  it('công thức không dòng nào ghi cỡ mẻ ⇒ lỗi', () => {
    expect(plan([row({ base_qty: '' })]).errors.join()).toMatch(/thiếu Cỡ mẻ chuẩn/)
  })
  it('một NVL khai hai lần trong cùng công thức ⇒ lỗi (không tự cộng)', () => {
    expect(plan([row({}), row({ qty: 5 })]).errors.join()).toMatch(/Dòng 3 — mã NVL 210000001 khai hai lần.*dòng 2/)
  })
})

describe('kiểm từng dòng', () => {
  it.each<[Record<string, unknown>, RegExp]>([
    [{ btp_code: 'KHONGCO' }, /không có mã BTP "KHONGCO"/],
    [{ btp_code: '210000009' }, /không phải mã bán thành phẩm/],
    [{ nvl_code: 'ZZZ' }, /không có mã NVL "ZZZ"/],
    [{ nvl_code: 'BTP-A' }, /không được chứa chính mã bán thành phẩm/],
    [{ qty: 0 }, /Số lượng "0" phải là số lớn hơn 0/],
    [{ qty: 'abc' }, /Số lượng "abc"/],
    [{ qty: 0.0001 }, /quá nhỏ/],
    [{ tol_pct: 150 }, /Mức lệch "150" phải từ 0 tới 100/],
    [{ unit: 'g' }, /ĐVT "g" khác đơn vị gốc KG/],
    [{ is_default: 'hmm' }, /cột Mặc định chỉ ghi "Có"/],
    [{ recipe_name: '' }, /thiếu Tên công thức/],
    [{ recipe_name: 'x'.repeat(81) }, /tối đa 80 ký tự/],
  ])('%o ⇒ lỗi', (o, re) => {
    const p = plan([row(o)])
    expect(p.errors.join(' | ')).toMatch(re)
  })
  it('mã BTP đơn vị không phải L / KG ⇒ lỗi như form', () => {
    const m2 = new Map(matByCode); m2.set('BTP-EA', mat('b3', 'BTP-EA', 'EA', { is_semi_finished: true }))
    const p = planRecipeImport([row({ btp_code: 'BTP-EA' })], [2], { matByCode: m2, existing: [], categoryOk: () => true })
    expect(p.errors.join()).toMatch(/đơn vị gốc L hoặc KG/)
  })
  it('loại hàng ngoài phạm vi được giao ⇒ lỗi', () => {
    const p = planRecipeImport([row({})], [2], ctx([], () => false))
    expect(p.errors.join()).toMatch(/loại hàng bạn không được giao/)
  })
  it('NVL đang ngừng dùng ⇒ chỉ cảnh báo, vẫn nạp', () => {
    const p = plan([row({ nvl_code: '210000003' })])
    expect(p.errors).toEqual([])
    expect(p.warnings.join()).toMatch(/210000003 — đang ngừng dùng/)
  })
  it('ĐVT đúng đơn vị gốc ở mọi cách viết', () => {
    expect(unitMatches('kg', 'KG')).toBe(true)
    expect(unitMatches('Kilogram', 'KG')).toBe(true)
    expect(unitMatches('Bao', 'BAG')).toBe(true)
    expect(unitMatches('Lít', 'L')).toBe(true)
    expect(unitMatches('', 'KG')).toBe(true)
    expect(unitMatches('L', 'KG')).toBe(false)
  })
  it('cột Mặc định', () => {
    expect(['Có', 'co', 'x', '1', 'Yes'].map(parseYes)).toEqual([true, true, true, true, true])
    expect(['', 'Không', '0', 'no'].map(parseYes)).toEqual([false, false, false, false])
    expect(parseYes('?')).toBeNull()
  })
})

describe('công thức đã có / mặc định', () => {
  const EX: ImpExisting[] = [
    { id: 'r1', material_id: 'btp1', name: 'Chuẩn', note: 'ghi chú cũ', is_active: true, is_default: true, line_count: 11 },
    { id: 'r2', material_id: 'btp1', name: 'Cũ ngừng', note: null, is_active: false, is_default: false, line_count: 4 },
  ]
  it('trùng mã + tên ⇒ thay trọn công thức đó (giữ id, ghi chú cũ, trạng thái, mặc định) + cảnh báo', () => {
    const p = plan([row({ recipe_name: ' chuẩn ' })], EX)
    expect(p.errors).toEqual([])
    expect(p.toUpdate).toBe(1); expect(p.toInsert).toBe(0)
    expect(p.recipes[0]).toMatchObject({ id: 'r1', note: 'ghi chú cũ', is_active: true, is_default: true })
    expect(p.warnings.join()).toMatch(/BTP-A · "chuẩn" — đã có \(11 nguyên liệu\), sẽ thay bằng 1 nguyên liệu/)
  })
  it('công thức đang Ngừng: thay dòng nhưng giữ Ngừng; ghi "Có" ở Mặc định ⇒ lỗi', () => {
    const p = plan([row({ recipe_name: 'Cũ ngừng' })], EX)
    expect(p.errors).toEqual([])
    expect(p.recipes[0]).toMatchObject({ id: 'r2', is_active: false })
    expect(plan([row({ recipe_name: 'Cũ ngừng', is_default: 'Có' })], EX).errors.join()).toMatch(/Ngừng dùng nên không làm mặc định/)
  })
  it('công thức mới ghi "Có" ⇒ thành mặc định, công thức khác của mã trong file thôi mặc định', () => {
    const p = plan([row({ recipe_name: 'Mới', is_default: 'Có' }), row({ recipe_name: 'Chuẩn' })], EX)
    expect(p.errors).toEqual([])
    expect(p.recipes.find(r => r.name === 'Mới')!.is_default).toBe(true)
    expect(p.recipes.find(r => r.name === 'Chuẩn')!.is_default).toBe(false)
    expect(p.warnings.join()).toMatch(/thành công thức MẶC ĐỊNH, thay cho "Chuẩn"/)
  })
  it('"Có" chỉ ở dòng đầu của công thức vẫn tính cho cả công thức', () => {
    const p = plan([row({ recipe_name: 'Mới', is_default: 'Có' }), row({ recipe_name: 'Mới', nvl_code: '210000002', is_default: '' })])
    expect(p.recipes[0].is_default).toBe(true)
  })
  it('hai công thức của một mã cùng ghi "Có" ⇒ lỗi', () => {
    const p = plan([row({ recipe_name: 'A', is_default: 'Có' }), row({ recipe_name: 'B', is_default: 'x' })])
    expect(p.errors.join()).toMatch(/2 công thức cùng ghi "Có"/)
  })
  it('mã khác không bị ảnh hưởng; công thức sắp theo mã (khoá cùng thứ tự ở mọi lượt nạp)', () => {
    const p = plan([row({ btp_code: 'BTP-B', nvl_code: '210000002', qty: 2 }), row({})])
    expect(p.errors).toEqual([])
    expect(p.recipes.map(r => r.material_id)).toEqual(['btp1', 'btp2'])
    expect(p.btpCount).toBe(2)
  })
})

// 27/11 — kho chạy KHÔNG định mức: công thức chỉ danh sách mã (không cỡ mẻ, không số lượng). Có số thì phải đủ — không nửa vời
// (cùng luật hàm DB mes_recipe_save; bảng tình huống docs/modules/production.md mục "Không định mức").
describe('công thức chỉ danh sách mã (không định mức)', () => {
  it('trống cỡ mẻ + trống mọi số lượng ⇒ công thức chỉ mã, không lỗi, có cảnh báo', () => {
    const p = plan([row({ base_qty: '', qty: '' }), row({ base_qty: '', qty: '', nvl_code: '210000002', unit: 'kg' })])
    expect(p.errors).toEqual([])
    expect(p.recipes[0].base_qty).toBeNull()
    expect(p.recipes[0].lines).toEqual([{ material_id: 'n1', qty: null, tol_pct: null }, { material_id: 'n2', qty: null, tol_pct: null }])
    expect(p.warnings.join()).toMatch(/chỉ danh sách mã/)
  })
  it('có cỡ mẻ mà mọi dòng trống số ⇒ lỗi nửa vời', () => {
    expect(plan([row({ qty: '' }), row({ qty: '', nvl_code: '210000002' })]).errors.join()).toMatch(/dòng 2, 3 thiếu Số lượng/)
  })
  it('một dòng có số, một dòng trống ⇒ lỗi nửa vời (nêu dòng thiếu)', () => {
    expect(plan([row({}), row({ qty: '', nvl_code: '210000002', base_qty: '' })]).errors.join()).toMatch(/dòng 3 thiếu Số lượng/)
  })
  it('không cỡ mẻ mà có số ⇒ thiếu cỡ mẻ', () => {
    expect(plan([row({ base_qty: '' })]).errors.join()).toMatch(/thiếu Cỡ mẻ chuẩn/)
  })
})
