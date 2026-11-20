// Upload Xuất kho / VL06O (20/11):
//  · ô số lượng (lớp vnNumber): ô CHỮ "1.234" thùng = một nghìn hai trăm ba tư — bản chép tay cũ thiếu nhánh "một chấm +
//    đúng 3 chữ số = nghìn" nên đọc 1,234. Cột Pallet "1,5" vẫn là 1,5 (phẩy = thập phân).
//  · VL06O xoá mềm dòng SAP đã bỏ theo LÔ 300 id/lệnh (trước đây một request mỗi dòng, song song không giới hạn).
import { describe, it, expect, vi } from 'vitest'
import { fakeDb } from '../helpers/fakeDb'

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import('../helpers/fakeDb').fakeDb> }))
vi.mock('../../src/lib/supabase', () => ({ get supabase() { return h.db }, get db() { return h.db } }))

describe('parseDecimal (upload Xuất kho)', () => {
  it('số kiểu VN; âm / vô hạn / rác ⇒ 0', async () => {
    const { parseDecimal } = await import('../../src/controllers/wms/outboundController')
    expect(parseDecimal('1.234')).toBe(1234)
    expect(parseDecimal('1.234,5')).toBe(1234.5)
    expect(parseDecimal('45.000.000')).toBe(45000000)
    expect(parseDecimal('1,5')).toBe(1.5)
    expect(parseDecimal(12)).toBe(12)
    expect(parseDecimal('')).toBe(0)
    expect(parseDecimal('-50')).toBe(0)
    expect(parseDecimal('1e999')).toBe(0)
    expect(parseDecimal('abc')).toBe(0)
  })
})

describe('markOdLinesObsolete (VL06O)', () => {
  it('701 dòng ⇒ 3 lệnh update (300/300/101), mọi dòng thành OBSOLETE, dòng khác không đụng', async () => {
    const rows = Array.from({ length: 702 }, (_, i) => ({ id: `o${i}`, od_number: 'D', od_item: String(i), sync_status: 'ACTIVE' }))
    h.db = fakeDb({ erp_outbound_orders: rows })
    const { markOdLinesObsolete } = await import('../../src/controllers/wms/outboundController')
    await markOdLinesObsolete(rows.slice(0, 701).map(r => r.id), '2026-11-20T00:00:00Z')
    expect(h.db.writes.map(w => w.rows.length)).toEqual([300, 300, 101])
    expect(h.db.tables.erp_outbound_orders.filter(r => r.sync_status === 'OBSOLETE')).toHaveLength(701)
    expect(h.db.tables.erp_outbound_orders.find(r => r.id === 'o701')?.sync_status).toBe('ACTIVE')
    await markOdLinesObsolete([], 'x')
    expect(h.db.writes).toHaveLength(3)
  })
})
