// Lớp C115 (16/11, tái phát 27/11): form của module gọi API tra cứu của module khác mà route đó không nhận quyền của module này ⇒
// vai thật bị 403, ô chọn mã trống (gói QA chạy bằng superadmin nên xanh). 27/11: QA LẬP mẻ ở kho không định mức (approve_qa) không
// tìm được mã BTP. Test khoá: mỗi quyền gác một FORM CÓ Ô CHỌN MÃ của Sản xuất phải nằm trong MATERIAL_LOOKUP_PERMS, và route
// /masterdata/materials dùng đúng danh sách đó (không chép tay danh sách thứ hai).
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { MATERIAL_LOOKUP_PERMS, ALL_PERMISSIONS } from '../../src/config/permissions'

const has = (m: string, a: string) => MATERIAL_LOOKUP_PERMS.some(([x, y]) => x === m && y === a)

describe('quyền tìm mã hàng (C115)', () => {
  it.each([
    ['open_batch', 'form Mở / Sửa mẻ'], ['approve_qa', 'QA lập mẻ ở kho không định mức (27/11)'], ['edit_requirement', 'Sửa định mức / danh sách NVL của mẻ'],
    ['manage_recipe', 'trang Định mức'], ['configure', 'hạn lưu bồn ở Cài đặt MES'],
  ])('production.%s (%s) tìm được mã', (action) => {
    expect(has('production', action)).toBe(true)
  })
  it('mọi cặp trong danh sách là quyền có thật (ALL_PERMISSIONS)', () => {
    for (const [m, a] of MATERIAL_LOOKUP_PERMS) expect(ALL_PERMISSIONS[m as keyof typeof ALL_PERMISSIONS] ?? []).toContain(a)
  })
  it('route GET /masterdata/materials dùng MATERIAL_LOOKUP_PERMS', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/routes/masterdata.ts'), 'utf8')
    expect(src).toMatch(/router\.get\('\/materials',\s*requireAnyPerm\(\.\.\.MATERIAL_LOOKUP_PERMS\)/)
  })
})
