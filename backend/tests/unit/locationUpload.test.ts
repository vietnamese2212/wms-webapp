// Upload Excel Vị trí kho (20/11): dòng cho vị trí ĐÃ CÓ mà ô Sức chứa / Số mã tối đa / Kiểu TRỐNG phải GIỮ giá trị đang lưu.
// Lỗi cũ: ô Sức chứa trống ghi max_pallets = 1 (mặc định của dòng MỚI), 2 ô kia ghi NULL đè ⇒ file chỉ để thêm vài ô
// vào khu có sẵn hạ sức chứa mọi ô cũ về 1. Chạy CHÍNH controller với file Excel thật trên DB giả.
import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { fakeDb, fakeReqRes } from '../helpers/fakeDb'
import { locationUploadFields } from '../../src/utils/locationUpload'

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import('../helpers/fakeDb').fakeDb> }))
vi.mock('../../src/lib/supabase', () => ({ get supabase() { return h.db }, get db() { return h.db } }))

const WH = { id: 'wh1', code: 'K1', name: 'Kho 1', nmsx_code: null }
const OLD = { id: 'loc1', location_code: 'K1_A_1_1', warehouse_id: 'wh1', sub_code: 'A', row: '1', shelf: '1',
  max_pallets: 3, max_materials: 2, sub_type: 'RACK', categories: ['TP'], is_active: true }

function xlsx(aoa: unknown[][]) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

async function upload(aoa: unknown[][], query: Record<string, string> = {}) {
  h.db = fakeDb({
    Warehouse: [WH], WarehouseZone: [{ warehouse_id: 'wh1', code: 'A', name: 'Khu A', categories: ['TP'] }],
    Location: [{ ...OLD }],
  })
  const { uploadExcel } = await import('../../src/controllers/masterdata/locationController')
  const { req, res } = fakeReqRes({ file: { buffer: xlsx(aoa) }, query, user: { warehouse_scope: 'NATIONAL', is_superadmin: true, name: 'T' } })
  await uploadExcel(req, res)
  return { res, loc: (code: string) => h.db.tables.Location.find(l => l.location_code === code) }
}

describe('upload Vị trí kho — ô trống trên vị trí ĐÃ CÓ giữ giá trị cũ', () => {
  it('ô Sức chứa / Số mã / Kiểu trống ⇒ vị trí cũ GIỮ 3 / 2 / RACK; vị trí mới lấy mặc định 1 / không giới hạn', async () => {
    const { res, loc } = await upload([
      ['Kho', 'Khu', 'Dãy', 'Tầng', 'Sức chứa', 'Số mã tối đa', 'Kiểu'],
      ['K1', 'A', '1', '1', '', '', ''],     // đã có
      ['K1', 'A', '1', '2', '', '', ''],     // mới
    ])
    expect((res.body as { success: boolean }).success).toBe(true)
    expect(loc('K1_A_1_1')).toMatchObject({ max_pallets: 3, max_materials: 2, sub_type: 'RACK' })
    expect(loc('K1_A_1_2')).toMatchObject({ max_pallets: 1, max_materials: null, sub_type: null })
  })
  it('ô CÓ giá trị ⇒ ghi đè như cũ', async () => {
    const { loc } = await upload([
      ['Kho', 'Khu', 'Dãy', 'Tầng', 'Sức chứa', 'Số mã tối đa', 'Kiểu'],
      ['K1', 'A', '1', '1', 5, 4, 'FLOOR'],
    ])
    expect(loc('K1_A_1_1')).toMatchObject({ max_pallets: 5, max_materials: 4, sub_type: 'FLOOR' })
  })
  it('file thiếu hẳn 3 cột tuỳ chọn ⇒ vị trí cũ không đổi sức chứa', async () => {
    const { loc } = await upload([['Kho', 'Khu', 'Dãy', 'Tầng'], ['K1', 'A', '1', '1']])
    expect(loc('K1_A_1_1')).toMatchObject({ max_pallets: 3, max_materials: 2, sub_type: 'RACK' })
  })
  it('lỗi báo kèm số dòng THẬT trong Excel (dòng trống giữa file không làm lệch)', async () => {
    const { res } = await upload([
      ['Kho', 'Khu', 'Dãy', 'Tầng'], ['K1', 'A', '1', '1'], [], ['K1', 'ZZ', '1', '1'],
    ], { preflight: '1' })
    const body = JSON.stringify(res.body)
    expect(body).toContain('dòng 4 trong Excel')
    expect(h.db.writes).toEqual([])
  })
})

describe('locationUploadFields', () => {
  it('dòng mới: mặc định; dòng có sẵn: ô trống giữ, ô có giá trị đè', () => {
    expect(locationUploadFields({ max_pallets: null, max_materials: null, sub_type: null }, null)).toEqual({ max_pallets: 1, max_materials: null, sub_type: null })
    expect(locationUploadFields({ max_pallets: null, max_materials: null, sub_type: null }, OLD)).toEqual({ max_pallets: 3, max_materials: 2, sub_type: 'RACK' })
    expect(locationUploadFields({ max_pallets: 7, max_materials: null, sub_type: 'X' }, OLD)).toEqual({ max_pallets: 7, max_materials: 2, sub_type: 'X' })
  })
})
