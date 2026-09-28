// Kho đích của ship-to (services/transferDest, 28/09) — MỘT nấc: khách trỏ kho. Không bao giờ tra theo mã kho hay TÊN.
// Vì sao có test: bản trước tra 3 nấc, và đo staging 28/09 nấc "dò TÊN" là nấc thật sự chạy (0/213 khách trỏ kho) ⇒
// đổi tên kho là luật chuyển kho đổi âm thầm. Test này khoá lại: cùng tên KHÔNG bao giờ thành kho đích, chỉ thành GỢI Ý.
import { describe, it, expect } from 'vitest'
import { pickDest, unlinkedHint, asUnlinkedPolicy } from '../../src/services/transferDest'

const wh = (id: string, name: string, over: Partial<{ code: string; inventory_mode: string | null; parent_warehouse_id: string | null; is_active: boolean | null }> = {}) =>
  ({ id, code: over.code ?? id.toUpperCase(), name, inventory_mode: over.inventory_mode ?? 'QR', parent_warehouse_id: over.parent_warehouse_id ?? null, is_active: over.is_active ?? true })
const WHS = [wh('w1', 'Kho Bluestar', { code: '10010499', inventory_mode: 'NONE' }), wh('w2', 'Kho An Sơn', { code: '10000274' }), wh('w3', 'Kho ngừng', { is_active: false })]
const byId = new Map(WHS.map(w => [w.id, w]))
const cust = (over: Partial<{ ship_to_code: string; name: string | null; warehouse_id: string | null; is_active: boolean | null }> = {}) =>
  ({ ship_to_code: over.ship_to_code ?? '10010499', name: over.name ?? 'Bluestar', warehouse_id: over.warehouse_id ?? null, is_active: over.is_active ?? true })

describe('pickDest — chỉ khách trỏ kho', () => {
  it('khách trỏ kho đang hoạt động ⇒ kho đó (mang chế độ tồn để quyết hình thức nhận)', () => {
    expect(pickDest(cust({ warehouse_id: 'w1' }), byId)).toMatchObject({ id: 'w1', code: '10010499', inventory_mode: 'NONE' })
  })
  it('không trỏ ⇒ null — kể cả khi ship-to TRÙNG MÃ kho hay tên khách TRÙNG TÊN kho (không còn nấc dò)', () => {
    expect(pickDest(cust({ ship_to_code: '10010499', name: 'Kho Bluestar' }), byId)).toBeNull()
  })
  it('khách ngừng hoặc kho ngừng hoặc kho không còn ⇒ null', () => {
    expect(pickDest(cust({ warehouse_id: 'w1', is_active: false }), byId)).toBeNull()
    expect(pickDest(cust({ warehouse_id: 'w3' }), byId)).toBeNull()
    expect(pickDest(cust({ warehouse_id: 'wX' }), byId)).toBeNull()
    expect(pickDest(null, byId)).toBeNull()
  })
})

describe('unlinkedHint — gợi ý "trông như kho WMS mà chưa trỏ" (chỉ nhắc, không nối)', () => {
  it('khách chưa trỏ, tên trùng đúng MỘT kho đang hoạt động (không phân hoa/thường, bỏ khoảng trắng hai đầu) ⇒ gợi ý kho đó', () => {
    expect(unlinkedHint(cust({ name: '  kho bluestar ' }), WHS)).toEqual({ warehouse_id: 'w1', warehouse_name: 'Kho Bluestar' })
  })
  it('khách đã trỏ kho, khách ngừng, tên không trùng, tên trùng kho NGỪNG, hay tên rỗng ⇒ không gợi ý', () => {
    expect(unlinkedHint(cust({ name: 'Kho Bluestar', warehouse_id: 'w1' }), WHS)).toBeNull()
    expect(unlinkedHint(cust({ name: 'Kho Bluestar', is_active: false }), WHS)).toBeNull()
    expect(unlinkedHint(cust({ name: 'Đại lý Minh Châu' }), WHS)).toBeNull()
    expect(unlinkedHint(cust({ name: 'Kho ngừng' }), WHS)).toBeNull()
    expect(unlinkedHint(cust({ name: '' }), WHS)).toBeNull()
  })
  it('trùng tên NHIỀU kho ⇒ không gợi ý (không đoán)', () => {
    const dup = [...WHS, wh('w4', 'Kho Bluestar')]
    expect(unlinkedHint(cust({ name: 'Kho Bluestar' }), dup)).toBeNull()
  })
})

describe('asUnlinkedPolicy — giá trị lạ về NONE (hành vi cũ)', () => {
  it('NONE/WARN/BLOCK giữ nguyên, còn lại NONE', () => {
    expect(asUnlinkedPolicy('WARN')).toBe('WARN'); expect(asUnlinkedPolicy('BLOCK')).toBe('BLOCK')
    expect(asUnlinkedPolicy('NONE')).toBe('NONE'); expect(asUnlinkedPolicy('warn')).toBe('NONE'); expect(asUnlinkedPolicy(null)).toBe('NONE')
  })
})
