// Bán thành phẩm (rà MES 16/11, lớp C117): Sản xuất chỉ nhận mã ĐÃ ĐÁNH DẤU "Bán thành phẩm", không còn "mọi mã tính L / KG".
// Lỗi gốc: ô "Mã bán thành phẩm" liệt kê nguyên liệu (210000000 Màu caramel · kg) vì luật chỉ xét đơn vị.
import { describe, it, expect } from 'vitest'
import { btpUseError, semiFinishedFlagError } from '../../src/utils/semiFinished'

describe('btpUseError — cửa MES nhận một mã làm BTP', () => {
  it('nguyên liệu tính KG CHƯA đánh dấu ⇒ bị từ chối (đây là lỗi gốc C117)', () => {
    expect(btpUseError({ material_code: '210000000', base_unit: 'KG', is_semi_finished: false })?.code).toBe('NOT_SEMI_FINISHED')
    expect(btpUseError({ material_code: '210000000', base_unit: 'KG' })?.code).toBe('NOT_SEMI_FINISHED')   // cột vắng = chưa đánh dấu
  })
  it('mã đã đánh dấu, tính L hoặc KG ⇒ dùng được (không phân biệt hoa thường, khoảng trắng)', () => {
    expect(btpUseError({ material_code: 'DSCU-DAU', base_unit: 'L', is_semi_finished: true })).toBeNull()
    expect(btpUseError({ material_code: 'DTHACH', base_unit: ' kg ', is_semi_finished: true })).toBeNull()
  })
  it('mã đánh dấu nhưng tính EA (dữ liệu cũ lọt CHECK) ⇒ BTP_UNIT', () => {
    expect(btpUseError({ material_code: 'X', base_unit: 'EA', is_semi_finished: true })?.code).toBe('BTP_UNIT')
    expect(btpUseError({ material_code: 'X', base_unit: null, is_semi_finished: true })?.code).toBe('BTP_UNIT')
  })
  it('mã ngừng dùng ⇒ MATERIAL_INACTIVE; không truyền is_active ⇒ không xét', () => {
    expect(btpUseError({ material_code: 'X', base_unit: 'L', is_semi_finished: true, is_active: false })?.code).toBe('MATERIAL_INACTIVE')
    expect(btpUseError({ material_code: 'X', base_unit: 'L', is_semi_finished: true })).toBeNull()
  })
  it('chưa đánh dấu được báo TRƯỚC sai đơn vị (người dùng sửa đúng chỗ trước)', () => {
    expect(btpUseError({ material_code: 'X', base_unit: 'EA', is_semi_finished: false })?.code).toBe('NOT_SEMI_FINISHED')
  })
})

describe('semiFinishedFlagError — mã hàng có được mang cờ BTP không', () => {
  it('không đánh dấu ⇒ luôn hợp lệ, kể cả mã tính EA / phi hàng hoá / pallet', () => {
    expect(semiFinishedFlagError({ base_unit: 'EA', is_semi_finished: false, is_non_stock: true, is_pallet_carrier: true })).toBeNull()
  })
  it('đánh dấu + L / KG ⇒ hợp lệ', () => {
    expect(semiFinishedFlagError({ base_unit: 'L', is_semi_finished: true })).toBeNull()
    expect(semiFinishedFlagError({ base_unit: 'kg', is_semi_finished: true })).toBeNull()
  })
  it('đánh dấu + đơn vị khác L / KG ⇒ lỗi (khớp CHECK material_semi_finished_chk)', () => {
    for (const u of ['EA', 'HOP', 'BAG', '', null]) expect(semiFinishedFlagError({ base_unit: u, is_semi_finished: true })).toMatch(/L hoặc KG/)
  })
  it('đánh dấu + phi hàng hoá hoặc pallet mang hàng ⇒ lỗi', () => {
    expect(semiFinishedFlagError({ base_unit: 'L', is_semi_finished: true, is_non_stock: true })).toMatch(/phi hàng hoá/)
    expect(semiFinishedFlagError({ base_unit: 'L', is_semi_finished: true, is_pallet_carrier: true })).toMatch(/pallet/)
  })
})
