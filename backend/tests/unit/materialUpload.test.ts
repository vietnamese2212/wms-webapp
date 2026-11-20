// Upload Excel Mã hàng (20/11) — chạy CHÍNH controller trên DB giả:
//  (a) ô chữ "1.000" ở Thùng/Pallet = một nghìn (bản cũ parseInt ra 1 — lớp vnNumber);
//  (b) file mẫu bỏ dòng key (dòng 2): cột nhãn "Không quản QR (1/0)" / "Bán thành phẩm (1/0)"… vẫn được đọc.
import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { fakeDb, fakeReqRes } from '../helpers/fakeDb'
import { excelNumber } from '../../src/utils/excelNumber'

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import('../helpers/fakeDb').fakeDb> }))
vi.mock('../../src/lib/supabase', () => ({ get supabase() { return h.db }, get db() { return h.db } }))

const M1 = { id: 'm1', material_code: 'M1', material_description: 'Mã 1', short_name: 'Mã 1', category: 'TP', base_unit: 'HOP',
  entry_unit: null, units_per_carton: null, cartons_per_pallet: 50, pallet_per_ea: null, shelf_life_days: 180,
  stack_on_top: false, no_qr_tracking: false, is_non_stock: false, is_pallet_carrier: false, is_semi_finished: false }

async function upload(aoa: unknown[][]) {
  h.db = fakeDb({ Material: [{ ...M1 }], LookupValue: [{ type: 'warehouse_type', value: 'TP', meta: {} }], SystemSetting: [] })
  const { uploadExcel } = await import('../../src/controllers/masterdata/materialController')
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S')
  const { req, res } = fakeReqRes({ file: { buffer: Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })) },
    user: { is_superadmin: true, warehouse_scope: 'NATIONAL', name: 'T' } })
  await uploadExcel(req, res)
  return res as unknown as { body: { data?: { errors: string[] } } }
}

describe('upload Mã hàng', () => {
  it('(a)+(b) nhãn dòng 1 không có dòng key: "1.000" = 1000, cờ (1/0) được đọc', async () => {
    const res = await upload([
      ['Mã hàng *', 'Thùng/Pallet *', 'Không quản QR (1/0)', 'Mã phi hàng hóa (1/0)', 'Pallet mang hàng (1/0)'],
      ['M1', '1.000', 1, 1, 0],
    ])
    expect(res.body.data?.errors ?? []).toEqual([])
    expect(h.db.tables.Material[0]).toMatchObject({ cartons_per_pallet: 1000, no_qr_tracking: true, is_non_stock: true, is_pallet_carrier: false })
  })
})

describe('excelNumber — một cách đọc ô số của file nạp', () => {
  it('số kiểu VN + đơn vị viết kèm; rác ⇒ null', () => {
    expect(excelNumber('1.000')).toBe(1000)
    expect(excelNumber('1.234,5')).toBe(1234.5)
    expect(excelNumber('12,5')).toBe(12.5)
    expect(excelNumber(7.5)).toBe(7.5)
    expect(excelNumber('12 thùng')).toBe(12)
    expect(excelNumber('1.000 kg')).toBe(1000)
    expect(excelNumber('1e999')).toBeNull()
    expect(excelNumber('abc')).toBeNull()
    expect(excelNumber('')).toBeNull()
    expect(excelNumber(null)).toBeNull()
  })
})
