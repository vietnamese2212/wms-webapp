// ĐƠN VỊ ĐO là CẤU HÌNH, không phải danh sách trong code (28/11 — user: "Cho tự cấu hình đơn vị đo đi. Bởi ko thể phụ thuộc vào
// hard code đc nhé"). Nguồn duy nhất: cờ meta.measure của danh mục Đơn vị tính (Cài đặt WMS → Đơn vị tính).
// Trước 28/11 danh sách KG, G, L… có BA bản (BE + FE utils/qtyUnits.ts, hàm DB qty_is_measure_unit). Test này giữ cho không ai
// thêm lại một bản cứng: hàm DB phải đọc danh mục, code không được có mảng mã đơn vị đo.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import * as BE from '../../src/utils/qtyUnits'

const MIG = join(__dirname, '../../migrations')
const ROOT = join(__dirname, '../../..')

function latestFunctionBody(name: string): string {
  const files = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()
  const re = new RegExp(`FUNCTION\\s+public\\.${name}\\b`, 'i')
  const defs = files.filter(f => re.test(readFileSync(join(MIG, f), 'utf8')))
  expect(defs.length, `chưa có migration định nghĩa ${name}`).toBeGreaterThan(0)
  const sql = readFileSync(join(MIG, defs[defs.length - 1]), 'utf8')
  const from = sql.search(re)
  const end = sql.indexOf('$$;', from)
  return sql.slice(from, end > 0 ? end : undefined)
}

describe('đơn vị đo: cờ trong danh mục, không có danh sách cố định', () => {
  it('hàm DB qty_is_measure_unit (bản mới nhất) đọc cờ measure của LookupValue, không có ARRAY mã đơn vị', () => {
    const body = latestFunctionBody('qty_is_measure_unit')
    expect(body).toMatch(/"LookupValue"/)
    expect(body).toMatch(/unit_of_measure/)
    expect(body).toMatch(/'measure'/)
    expect(body).not.toMatch(/ARRAY\s*\[/i)
  })

  it('utils/qtyUnits (BE + FE) không còn mảng mã đơn vị đo / isMeasureUnit theo danh sách', () => {
    expect('MEASURE_UNIT_CODES' in BE).toBe(false)
    expect('isMeasureUnit' in BE).toBe(false)
    for (const side of ['backend', 'frontend']) {
      const src = readFileSync(join(ROOT, side, 'src/utils/qtyUnits.ts'), 'utf8')
      expect(src, side).not.toMatch(/MEASURE_UNIT_CODES|new Set<string>\(\[\s*'KG'/)
      expect(src, side).not.toMatch(/\[\s*'KG'\s*,\s*'G'/)
    }
  })

  it('measureUnitCodes đọc đúng cờ: chỉ measure === true, mã viết hoa, bỏ dòng hỏng', () => {
    const rows = [
      { value: 'KG', meta: { role: 'base', measure: true } },
      { value: ' l ', meta: { measure: true } },
      { value: 'HOP', meta: { role: 'base' } },
      { value: 'M2', meta: { measure: false } },
      { value: 'X', meta: { measure: 'true' } },   // chuỗi không phải cờ
      { value: '', meta: { measure: true } },
      { value: 'G', meta: null },
    ]
    expect([...BE.measureUnitCodes(rows)].sort()).toEqual(['KG', 'L'])
    expect(BE.measureUnitCodes(null).size).toBe(0)
    expect(BE.isMeasureUnitMeta({ measure: true })).toBe(true)
    expect(BE.isMeasureUnitMeta({ measure: 1 })).toBe(false)
  })

  it('đổi cờ ở danh mục ⇒ trigger DB chuyển mã (material_units_reclassify), cửa chạy thử dùng cùng hàm', () => {
    const files = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()
    const all = files.map(f => readFileSync(join(MIG, f), 'utf8')).join('\n')
    expect(all).toMatch(/CREATE TRIGGER trg_lookup_unit_measure_sync[\s\S]*ON "LookupValue"/)
    expect(all).toMatch(/CREATE TRIGGER trg_material_unit_kind[\s\S]*ON "Material"/)
    const ctl = readFileSync(join(ROOT, 'backend/src/controllers/wms/lookupController.ts'), 'utf8')
    expect(ctl).toMatch(/rpc\('material_units_reclassify'[^)]*p_apply: false/)
  })
})
