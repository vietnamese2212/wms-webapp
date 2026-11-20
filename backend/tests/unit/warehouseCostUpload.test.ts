// Upload Excel Chi phí kho (20/11): (a) ô Tháng gõ "2026-12" / "08/2026" Excel tự đổi thành NGÀY (số serial) ⇒ trước đây
// "Tháng không đọc được"; (b) file rác (PNG đội lốt .xlsx) ⇒ trước đây XLSX.read ném ⇒ 500; (c) số dòng báo lỗi lệch khi
// file có dòng trống. Chạy CHÍNH controller trên DB giả, chỉ pha kiểm trước (không ghi).
import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { fakeDb, fakeReqRes } from '../helpers/fakeDb'

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import('../helpers/fakeDb').fakeDb> }))
vi.mock('../../src/lib/supabase', () => ({ get supabase() { return h.db }, get db() { return h.db } }))

const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000
function xlsx(aoa: unknown[][], dateCells: string[] = []) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  for (const a of dateCells) ws[a].z = 'mmm-yy'   // ô kiểu NGÀY như Excel tự đổi
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}
async function upload(buffer: Buffer) {
  h.db = fakeDb({
    LookupValue: [{ type: 'cost_item', value: 'THUE', sort_order: 1, meta: { label: 'Thuê kho' } }],
    Warehouse: [{ id: 'wh1', code: 'K1', name: 'Kho 1' }], warehouse_costs: [], warehouse_cost_locks: [],
  })
  const { uploadCostExcel } = await import('../../src/controllers/wms/warehouseCostController')
  const { req, res } = fakeReqRes({ file: { buffer }, query: { preflight: '1' }, body: { period: '2026-11' }, user: { is_superadmin: true, name: 'T' } })
  await uploadCostExcel(req, res)
  return res as unknown as { statusCode: number; body: { data?: { errors: string[]; to_insert: number; extra: { label: string; value: unknown }[] } } }
}

describe('upload Chi phí kho', () => {
  it('ô Tháng là NGÀY Excel (serial) ⇒ đọc ra đúng tháng, không báo lỗi', async () => {
    const res = await upload(xlsx([
      ['Tháng', 'Kho', 'Khoản mục', 'Số tiền'],
      [serial(2026, 12, 1), 'K1', 'Thuê kho', 1000],
      [serial(2026, 8, 1), 'K1', 'THUE', 2000],
    ], ['A2', 'A3']))
    expect(res.body.data?.errors).toEqual([])
    expect(res.body.data?.to_insert).toBe(2)
    expect(String(res.body.data?.extra.find(e => e.label === 'Kỳ có trong file')?.value)).toBe('2026-12 · 2026-08')
  })
  it('file rác ⇒ 400 "không đọc được như Excel", không phải 500', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 7)])
    const res = await upload(png)
    expect(res.statusCode).toBe(400)
  })
  it('lỗi báo đúng số dòng Excel khi có dòng trống giữa file', async () => {
    const res = await upload(xlsx([
      ['Tháng', 'Kho', 'Khoản mục', 'Số tiền'], ['', 'K1', 'THUE', 1], [], ['', 'KHONGCO', 'THUE', 1],
    ]))
    expect(res.body.data?.errors[0]).toMatch(/^Dòng 4 /)
  })
})
