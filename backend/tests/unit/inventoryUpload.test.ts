// Upload Excel Tồn kho (20/11) — chạy CHÍNH controller trên DB giả:
//  (a) file XUẤT chi tiết pallet của chính trang Tồn kho phải nạp lại được (cột "Tồn (thùng)"/"Tồn (hộp)", mã KG để số ở
//      cột Hộp, QA xuất theo MÃ, "Shelflife (ngày)") — trước đây "thiếu cột bắt buộc: Số thùng";
//  (b) pallet ĐÃ CÓ: ô NCC / HSD / QA trống GIỮ giá trị cũ; đổi vị trí theo file phải vào sổ chuyển vị trí (logPalletMoves);
//  (c) bỏ dòng key (dòng 2) của file mẫu vẫn đọc được cột "Ngày nhập (tùy, …)" / "Người nhập (tùy, …)";
//  (d) số viết kiểu VN dạng chữ "1.000" = một nghìn, không phải 1 (lớp vnNumber).
import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { fakeDb, fakeReqRes } from '../helpers/fakeDb'

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import('../helpers/fakeDb').fakeDb> }))
vi.mock('../../src/lib/supabase', () => ({ get supabase() { return h.db }, get db() { return h.db } }))

const MAT_CAR = { id: 'm1', material_code: '200001', short_name: 'Sữa hộp', category: 'TP', base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 12 }
const MAT_KG = { id: 'm2', material_code: '210000308', short_name: 'Đường', category: 'TP', base_unit: 'KG', entry_unit: null, units_per_carton: null }
const OLD = { id: 'e1', pallet_code: 'P-OLD', warehouse_id: 'wh1', material_id: 'm1', location_id: 'l1', status: 'IN_STOCK',
  cartons_imported: 24, cartons_remaining: 24, cartons_reserved: 0, ncc_id: 'n1', shelf_life_days: 180, qa_status_id: 'qX7',
  import_date: '2026-01-02', created_by: 'emp1' }

function xlsx(aoa: unknown[][]) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}
type U = { is_superadmin?: boolean; warehouse_scope: string; sub: string; name: string; module_permissions?: Record<string, string[]> }
const ADMIN: U = { is_superadmin: true, warehouse_scope: 'NATIONAL', sub: 'emp1', name: 'T' }
async function upload(aoa: unknown[][], preflight: boolean, user: U = ADMIN) {
  h.db = fakeDb({
    Material: [MAT_CAR, MAT_KG], Warehouse: [{ id: 'wh1', code: 'K1', name: 'Kho 1', nmsx_code: 'A' }],
    Location: [{ id: 'l1', location_code: 'L1', warehouse_id: 'wh1', categories: ['TP'] }, { id: 'l2', location_code: 'L2', warehouse_id: 'wh1', categories: ['TP'] }],
    TransportCompany: [{ id: 'n1', code: 'NCC1', name: 'Nhà cung cấp 1', type: 'NCC', alias_codes: null }],
    QAStatus: [{ id: 'qOK', code: 'OK', name: 'OK' }, { id: 'qX7', code: 'X7', name: 'X 7 ngày' }],
    Employee: [{ id: 'emp1', employee_code: 'NV1', name: 'Nguyễn Văn B' }],
    LookupValue: [], warehouse_type_configs: [], SystemSetting: [], StocktakeLog: [], InventoryAdjustmentLog: [],
    InventoryEntry: [{ ...OLD }],
  })
  const { uploadExcel } = await import('../../src/controllers/wms/inventoryController')
  const { req, res } = fakeReqRes({ file: { buffer: xlsx(aoa) }, query: preflight ? { preflight: '1' } : {},
    user })
  await uploadExcel(req, res)
  return res as unknown as { statusCode: number; body: { success: boolean; data?: { errors: string[]; to_insert?: number; to_update?: number }; error?: { message: string } } }
}

const EXPORT_HEAD = ['Kho', 'Loại kho', 'Mã hàng', 'Tên hàng', 'NCC', 'Shelflife (ngày)', 'Mã pallet', 'NMSX', 'Vị trí', 'ĐVT',
  'Nhập (thùng)', 'Nhập (hộp)', 'Xuất (thùng)', 'Xuất (hộp)', 'Tồn (thùng)', 'Tồn (hộp)', 'Tồn (base)',
  'Nhặt lẻ (thùng)', 'Nhặt lẻ (hộp)', 'Khả dụng (thùng)', 'Khả dụng (hộp)', 'Ngày SX', '% Date', 'QA',
  'Điều chỉnh (thùng)', 'Điều chỉnh (hộp)', 'Ngày nhập', 'Người nhập']

describe('upload Tồn kho', () => {
  it('(a) file XUẤT chi tiết pallet nạp lại được: Tồn (thùng)/(hộp), mã KG số ở cột Hộp, QA theo mã', async () => {
    const res = await upload([
      EXPORT_HEAD,
      ['Kho 1', 'TP', '200001', 'Sữa hộp', 'Nhà cung cấp 1', 180, 'P-NEW1', 'A', 'L1', 'Hộp', 3, 5, 0, 0, 3, 5, 41, '', '', 3, 5, '05-11-2026', 90, 'X7', '', '', '10-11-2026', 'Nguyễn Văn B'],
      ['Kho 1', 'TP', '210000308', 'Đường', '', '', 'P-NEW2', 'A', 'L2', 'KG', '', 7.5, '', 0, '', 7.5, 7.5, '', '', '', 7.5, '05-11-2026', 90, 'OK', '', '', '10-11-2026', ''],
    ], false)
    expect(res.body.error?.message).toBeUndefined()
    expect(res.body.data?.errors ?? []).toEqual([])
    const e = (p: string) => h.db.tables.InventoryEntry.find(x => x.pallet_code === p)
    expect(e('P-NEW1')).toMatchObject({ cartons_imported: 41, qa_status_id: 'qX7', shelf_life_days: 180, ncc_id: 'n1' })
    expect(e('P-NEW2')).toMatchObject({ cartons_imported: 7.5, qa_status_id: null })
  })
  it('(b) pallet ĐÃ CÓ: ô NCC/HSD/QA trống giữ giá trị cũ; đổi vị trí theo file ⇒ có dòng sổ chuyển vị trí', async () => {
    const res = await upload([
      ['Mã pallet', 'Mã hàng', 'Kho', 'Mã vị trí', 'Số thùng', 'Ngày SX', 'NCC', 'QA', 'HSD (ngày)'],
      ['P-OLD', '200001', 'K1', 'L2', 2, '2026-11-01', '', '', ''],
    ], false)
    expect(res.body.data?.errors ?? []).toEqual([])
    expect(h.db.tables.InventoryEntry.find(x => x.id === 'e1')).toMatchObject({ location_id: 'l2', cartons_remaining: 24, ncc_id: 'n1', qa_status_id: 'qX7', shelf_life_days: 180 })
    const mv = h.db.tables.StocktakeLog.filter(x => x.entry_id === 'e1')
    expect(mv).toHaveLength(1)
    expect(mv[0]).toMatchObject({ location_from_id: 'l1', location_changed_to: 'l2' })
  })
  it('(c) file mẫu bỏ dòng key: cột "Ngày nhập (tùy, trống = hôm nay)" vẫn được đọc', async () => {
    const res = await upload([
      ['Mã pallet *', 'Mã hàng *', 'Kho (mã) *', 'Mã vị trí *', 'Số thùng * (SỐ NGUYÊN)', 'Ngày SX * (yyyy-mm-dd)',
        'Ngày nhập (tùy, trống = hôm nay)', 'Người nhập (tùy, trống = người upload)'],
      ['P-NEW3', '200001', 'K1', 'L1', 1, '2026-11-01', '2099-01-01', 'NV1'],
    ], true)
    expect((res.body.data?.errors ?? []).join(' ')).toMatch(/TƯƠNG LAI/)
  })
  it('(d) Số thùng dạng chữ "1.000" (mã KG) = 1000', async () => {
    await upload([
      ['Mã pallet', 'Mã hàng', 'Kho', 'Mã vị trí', 'Số thùng', 'Ngày SX'],
      ['P-NEW4', '210000308', 'K1', 'L1', '1.000', '2026-11-01'],
    ], false)
    expect(h.db.tables.InventoryEntry.find(x => x.pallet_code === 'P-NEW4')).toMatchObject({ cartons_imported: 1000 })
  })
  it('(e) đổi QA pallet ĐÃ CÓ qua file cần quyền inventory.qa_update (user chốt 20/11); trống / giữ nguyên QA thì không', async () => {
    const head = ['Mã pallet', 'Mã hàng', 'Kho', 'Mã vị trí', 'Số thùng', 'Ngày SX', 'QA']
    const importOnly: U = { warehouse_scope: 'NATIONAL', sub: 'emp1', name: 'T', module_permissions: { inventory: ['view', 'import'] } }
    const withQa: U = { ...importOnly, module_permissions: { inventory: ['view', 'import', 'qa_update'] } }
    const nhả = await upload([head, ['P-OLD', '200001', 'K1', 'L1', 2, '2026-11-01', 'OK']], true, importOnly)
    expect((nhả.body.data?.errors ?? []).join(' ')).toMatch(/cần quyền "Cập nhật QA"/)
    const giữ = await upload([head, ['P-OLD', '200001', 'K1', 'L1', 2, '2026-11-01', 'X7']], true, importOnly)
    expect(giữ.body.data?.errors ?? []).toEqual([])
    const trống = await upload([head, ['P-OLD', '200001', 'K1', 'L1', 2, '2026-11-01', '']], true, importOnly)
    expect(trống.body.data?.errors ?? []).toEqual([])
    await upload([head, ['P-OLD', '200001', 'K1', 'L1', 2, '2026-11-01', 'OK']], false, withQa)
    expect(h.db.tables.InventoryEntry.find(x => x.id === 'e1')).toMatchObject({ qa_status_id: null })
  })
})
