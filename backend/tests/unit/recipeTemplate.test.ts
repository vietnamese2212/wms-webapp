// FILE MẪU NẠP ĐỊNH MỨC có DANH SÁCH MÃ (20/11 — user: "validate file excel tải về ở Định mức, đảm bảo mã hàng").
// Lưới: (1) khối Data Validation nằm đúng chỗ trong XML (sai chỗ Excel báo file hỏng); (2) file mẫu → điền một dòng →
// CHÍNH bộ đọc + bộ kiểm của server (parseSheetByHeader + planRecipeImport) đi qua — mẫu và luật nạp không lệch nhau;
// (3) danh sách Mã BTP do server chọn bằng cùng hàm kiểm với lần nạp (btpImportError).
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import path from 'path'
import { addListValidations, insertValidations, type ListValidation } from '../../../frontend/src/utils/xlsxValidation'
import { buildRecipeTemplate, catalogCell, IMPORT_HEAD, TEMPLATE_VALIDATION_ROWS, type RecipeImportCatalog } from '../../../frontend/src/components/wms/production/recipeTemplate'
import { parseSheetByHeader } from '../../src/utils/excelHeader'
import { RECIPE_IMPORT_FIELDS, RECIPE_IMPORT_MAX_ROWS, planRecipeImport, btpImportError, type ImpMaterial } from '../../src/utils/recipeImport'

type X = typeof import('xlsx')
const XLSX = createRequire(path.resolve(__dirname, '../../../frontend/package.json'))('xlsx') as X & { CFB: { read: (d: Uint8Array, o: object) => unknown; find: (c: unknown, p: string) => { content: Uint8Array } | null } }

const cat: RecipeImportCatalog = {
  btp: [{ code: 'BTPX', name: 'Dịch X', unit: 'L', active: true }],
  nvl: [{ code: '210000101', name: 'Sữa bột gầy', unit: 'KG', active: true }, { code: 'ABC-1', name: 'Hương', unit: 'L', active: false }],
}
const mat = (code: string, o: Partial<ImpMaterial> = {}): ImpMaterial =>
  ({ id: `id-${code}`, material_code: code, short_name: code, base_unit: 'KG', category: 'RM01', is_semi_finished: false, is_active: true, ...o })

function build() {
  const { wb, validations } = buildRecipeTemplate(cat)
  const bytes = addListValidations(new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer), validations)
  const sheet1 = new TextDecoder().decode(XLSX.CFB.find(XLSX.CFB.read(bytes, { type: 'buffer' }), '/xl/worksheets/sheet1.xml')!.content)
  return { bytes, sheet1, validations }
}

describe('xlsxValidation — chèn Data Validation đúng chỗ', () => {
  const v: ListValidation = { sheetIndex: 0, sqref: 'A2:A9', source: "'Mã'!$A$2:$A$5", title: 'T', error: 'E & <x>' }
  it('trước pageMargins / ignoredErrors, sau sheetData; escape XML', () => {
    const out = insertValidations('<worksheet><sheetData><row r="1"/></sheetData><ignoredErrors/><pageMargins/></worksheet>', [v])
    expect(out).toMatch(/<\/sheetData><dataValidations count="1">.*<\/dataValidations><ignoredErrors\/>/)
    expect(out).toContain('error="E &amp; &lt;x&gt;"')
    expect(out).toContain("<formula1>&apos;Mã&apos;!$A$2:$A$5</formula1>".replace(/&apos;/g, "'"))
  })
  it('sheet đã có dataValidations ⇒ báo lỗi (không chèn khối thứ hai)', () => {
    expect(() => insertValidations('<worksheet><sheetData/><dataValidations count="1"/></worksheet>', [v])).toThrow()
  })
})

describe('file mẫu Nạp định mức — danh sách mã (20/11)', () => {
  it('cột Mã BTP / Mã NVL có danh sách hợp lệ trỏ đúng sheet + đủ số mã, vùng = trần số dòng của server', () => {
    const { sheet1, validations } = build()
    expect(TEMPLATE_VALIDATION_ROWS).toBe(RECIPE_IMPORT_MAX_ROWS)
    expect(sheet1).toContain(`sqref="A2:A${RECIPE_IMPORT_MAX_ROWS + 1}"><formula1>'Mã BTP'!$A$2:$A$2</formula1>`)
    expect(sheet1).toContain(`sqref="E2:E${RECIPE_IMPORT_MAX_ROWS + 1}"><formula1>'Mã NVL'!$A$2:$A$3</formula1>`)
    expect(sheet1.indexOf('<dataValidations')).toBeGreaterThan(sheet1.indexOf('</sheetData>'))
    for (const x of validations) { expect(x.title.length).toBeLessThanOrEqual(32); expect(x.error.length).toBeLessThanOrEqual(255); expect((x.prompt ?? '').length).toBeLessThanOrEqual(255) }
  })
  it('cột Tên BTP / Tên nguyên liệu / ĐVT có công thức tra theo mã', () => {
    const { sheet1 } = build()
    expect(sheet1).toMatch(/<c r="B2"[^>]*><f>[^<]*VLOOKUP\(\$A2,&apos;Mã BTP&apos;/)
    expect(sheet1).toMatch(/<c r="H2"[^>]*><f>[^<]*VLOOKUP\(\$E2,&apos;Mã NVL&apos;!\$A:\$D,3/)
  })
  it('mã toàn chữ số ghi dạng SỐ (ô gõ số khớp danh sách), còn lại giữ chữ', () => {
    expect(catalogCell('210000101')).toBe(210000101)
    expect(catalogCell('0123')).toBe('0123')
    expect(catalogCell('BTP-1')).toBe('BTP-1')
    expect(catalogCell('1234567890123456')).toBe('1234567890123456')
    const wb = XLSX.read(build().bytes, { type: 'array' })
    expect(wb.SheetNames).toEqual(['Định mức', 'Hướng dẫn', 'Mã BTP', 'Mã NVL'])
    expect(wb.Sheets['Mã NVL'].A2.v).toBe(210000101)
    expect(wb.Sheets['Mã NVL'].D3.v).toBe('Ngừng dùng')
  })
  it('điền một dòng vào file mẫu (mã gõ dạng số, ĐVT do công thức tra) ⇒ bộ đọc + bộ kiểm của server đi qua', () => {
    const wb = XLSX.read(build().bytes, { type: 'array' })
    const ws = wb.Sheets['Định mức']
    // như Excel lưu: ô công thức có giá trị đã tính; 999 dòng công thức còn lại ra chuỗi rỗng
    for (let r = 2; r <= 1001; r++) for (const c of ['B', 'F', 'H']) ws[`${c}${r}`] = { t: 's', v: '', f: ws[`${c}${r}`]?.f }
    Object.assign(ws, { A2: { t: 's', v: 'BTPX' }, B2: { t: 's', v: 'Dịch X' }, C2: { t: 's', v: 'Chuẩn' }, D2: { t: 'n', v: 1000 },
      E2: { t: 'n', v: 210000101 }, F2: { t: 's', v: 'Sữa bột gầy' }, G2: { t: 'n', v: 45 }, H2: { t: 's', v: 'KG' } })
    const { rows, missingRequired, rowNums } = parseSheetByHeader(ws, RECIPE_IMPORT_FIELDS)
    expect(missingRequired).toEqual([])
    expect(rows).toHaveLength(1)
    const matByCode = new Map([['BTPX', mat('BTPX', { is_semi_finished: true, base_unit: 'L' })], ['210000101', mat('210000101')]])
    const plan = planRecipeImport(rows, rowNums, { matByCode, existing: [], categoryOk: () => true })
    expect(plan.errors).toEqual([])
    expect(plan.recipes).toHaveLength(1)
    expect(IMPORT_HEAD.filter(h => h.endsWith('*')).length).toBe(RECIPE_IMPORT_FIELDS.filter(f => f.required).length)
  })
  it('chưa có mã BTP nào trong phạm vi ⇒ không gắn danh sách rỗng cho cột Mã BTP (Excel sẽ chặn mọi giá trị)', () => {
    const { validations } = buildRecipeTemplate({ btp: [], nvl: cat.nvl })
    expect(validations.map(x => x.sqref[0])).toEqual(['E'])
  })
})

describe('btpImportError — một luật cho lần nạp và danh sách Mã BTP của file mẫu', () => {
  it('chỉ mã Bán thành phẩm, đơn vị L/KG, thuộc loại hàng được giao', () => {
    const ok = mat('BTPX', { is_semi_finished: true, base_unit: 'L' })
    expect(btpImportError(ok, () => true)).toBeNull()
    expect(btpImportError({ ...ok, is_active: false }, () => true)).toBeNull()   // như form: mã ngừng dùng vẫn sửa công thức
    expect(btpImportError(mat('NVL1'), () => true)).toMatch(/không phải mã bán thành phẩm/)
    expect(btpImportError(ok, () => false)).toMatch(/loại hàng bạn không được giao/)
  })
})
