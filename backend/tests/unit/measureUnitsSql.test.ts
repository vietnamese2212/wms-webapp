// Danh sách ĐƠN VỊ ĐO (số theo đơn vị gốc được lẻ dù mã có đơn vị quy cách — 27/11, đường 1 bao = 20 kg) có BA bản:
// backend + frontend utils/qtyUnits.ts (mirror test giữ hai bản khớp) và hàm DB qty_whole_required (huỷ cấp NVL, xử lý hàng chặn).
// Test này đọc migration MỚI NHẤT định nghĩa qty_whole_required và đối chiếu danh sách — sửa một nơi mà quên nơi kia là đỏ.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { MEASURE_UNIT_CODES } from '../../src/utils/qtyUnits'

const MIG = join(__dirname, '../../migrations')

describe('đơn vị đo: code ⇄ hàm DB qty_whole_required', () => {
  it('migration mới nhất có cùng danh sách với MEASURE_UNIT_CODES', () => {
    const files = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()
    const defs = files.filter(f => /FUNCTION\s+public\.qty_whole_required/i.test(readFileSync(join(MIG, f), 'utf8')))
    expect(defs.length, 'chưa có migration định nghĩa qty_whole_required').toBeGreaterThan(0)
    const sql = readFileSync(join(MIG, defs[defs.length - 1]), 'utf8')
    const body = sql.slice(sql.search(/FUNCTION\s+public\.qty_whole_required/i))
    const arr = /ARRAY\[([^\]]*)\]/.exec(body)
    expect(arr, 'không thấy ARRAY[...] trong qty_whole_required').not.toBeNull()
    const codes = arr![1].split(',').map(s => s.trim().replace(/^'|'$/g, ''))
    expect([...codes].sort()).toEqual([...MEASURE_UNIT_CODES].sort())
  })
})
