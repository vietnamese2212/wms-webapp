// Bộ đọc ZSD02 chạy trên CHÍNH FILE MẪU SAP (Du lieu mau/Du lieu sap zsd02.xlsx — untracked, bỏ qua nếu thiếu)
// + các bất biến dựng tay. Số kỳ vọng là số ĐO ĐỘC LẬP 22/09 bằng script soi file (không lấy từ chính parser).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import * as XLSX from 'xlsx'
import { parseSheetByHeader } from '../../src/utils/excelHeader'
import { parseZsd02, resolveFlow, splitCodeName, bizHash, ZSD02_FIELDS, ZSD02_BIZ, LOADABLE_FLOWS, type Flow, type Zsd02Mat } from '../../src/services/zsd02Parse'

const SAMPLE = resolve(__dirname, '../../../Du lieu mau/Du lieu sap zsd02.xlsx')
const HAS_SAMPLE = existsSync(SAMPLE)

// Map flow y như seed migration 20260922 (đây là DỮ LIỆU — test chép lại để không cần DB)
const FLOW_MAP = new Map<string, Flow>(Object.entries({
  ZTA2: 'PALLET', ZCKT: 'DISCOUNT', F: 'STO', ZNB1: 'INTERNAL', ZRE1: 'RETURN', ZRE3: 'RETURN',
  ZOR1: 'SALE', ZOR2: 'SALE', ZKG1: 'SALE', ZXKM: 'SALE', ZXBT: 'SALE', ZXSD: 'SALE', ZTD1: 'INTERNAL', UB: 'STO', ZUB: 'STO', NB: 'STO',
}) as [string, Flow][])
// 9 mã master đo thật trên staging 22/09 — đủ để kiểm đơn vị và hệ số; mã khác coi như CHƯA có trong danh mục
const MATS = new Map<string, Zsd02Mat>([
  ['510000219', { material_code: '510000219', base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 24, cartons_per_pallet: 190, weight_kg: '4.965' }],
  ['510000081', { material_code: '510000081', base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48, cartons_per_pallet: 117, weight_kg: 5.42 }],
  ['510000097', { material_code: '510000097', base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48, cartons_per_pallet: 110, weight_kg: 9.8 }],
  ['510000130', { material_code: '510000130', base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48, cartons_per_pallet: 110, weight_kg: 9.86 }],
  ['510000264', { material_code: '510000264', base_unit: 'BAG', entry_unit: 'CAR', units_per_carton: 24, cartons_per_pallet: 216, weight_kg: 3.08 }],
  ['510000262', { material_code: '510000262', base_unit: 'BAG', entry_unit: 'CAR', units_per_carton: 24, cartons_per_pallet: 216, weight_kg: 3.08 }],
  ['720000113', { material_code: '720000113', base_unit: 'EA', entry_unit: null, units_per_carton: null, cartons_per_pallet: 1920, weight_kg: 0.25 }],
  ['810000000', { material_code: '810000000', base_unit: 'EA', entry_unit: null, units_per_carton: null, cartons_per_pallet: 1, weight_kg: 30, is_pallet_carrier: true }],
  ['910000060', { material_code: '910000060', base_unit: null, entry_unit: null, units_per_carton: null, weight_kg: null, is_non_stock: true }],
])
const DVVT: Record<string, string> = { HA: 'HA', 'HAI AN': 'HA', HN: 'HN', ALCA: 'ALCA', PAQ: 'PAQ', BMT: 'BMT', 'DONG A': 'DA', DA: 'DA', KGT: 'KGT', RATRACO: 'RATRACO' }
const ctx = { mats: MATS, flowMap: FLOW_MAP, dvvtResolve: (k: string) => DVVT[k] ?? null, actor: 'test', now: '2026-09-22T00:00:00.000Z' }

describe('zsd02Parse — bất biến dựng tay', () => {
  it('flow: item_category thắng so_type; hàng phi tồn luôn DISCOUNT; mã lạ UNKNOWN và không lên xe', () => {
    expect(resolveFlow(FLOW_MAP, 'ZTA2', 'ZOR1')).toBe('PALLET')
    expect(resolveFlow(FLOW_MAP, 'ZTA1', 'ZOR1')).toBe('SALE')
    expect(resolveFlow(FLOW_MAP, 'F', 'UB')).toBe('STO')
    expect(resolveFlow(FLOW_MAP, 'ZTA1', 'ZOR1', true)).toBe('DISCOUNT')
    expect(resolveFlow(FLOW_MAP, 'ZZZ', 'YYY')).toBe('UNKNOWN')
    expect(LOADABLE_FLOWS.has('RETURN')).toBe(false); expect(LOADABLE_FLOWS.has('SALE')).toBe(true)
    expect(splitCodeName('100-Thành phố Hà Nội')).toEqual({ code: '100', name: 'Thành phố Hà Nội' })
    expect(splitCodeName('Bắc Ninh')).toEqual({ code: null, name: 'Bắc Ninh' })
  })
  it('dòng chưa OD KHÔNG vào sổ OD; base suy 3 bậc; đơn vị lạ → unitErr', () => {
    const rows: Record<string, unknown>[] = [
      // dòng có OD: cho hệ số quan sát 24 với 510000219
      { so_number: 'S1', item: '10', od_number: 'O1', material: '510000219', plant: '1102', sales_unit: 'Thùng', so_qty: 60, od_qty: 60, od_qty_base: 1440, base_unit: 'HOP', delivery_date: 46266, so_type: 'ZOR1-SO Standard', item_category: 'ZTA1-IC Sales Standard', ship_to_code: 'C1', gross_weight: 298199.52, dvvt: 'Đông Á', dispatch: 'Đã điều phối', issued_qty: 30 },
      // chưa OD, Thùng, mã có hệ số trong file → FILE
      { so_number: 'S2', item: '10', od_number: null, material: '510000219', plant: '1102', sales_unit: 'Thùng', so_qty: 10, od_qty: 0, od_qty_base: 0, base_unit: 'HOP', delivery_date: 46266, so_type: 'ZOR1-SO Standard', item_category: 'ZTA1-IC Sales Standard', ship_to_code: 'C2' },
      // chưa OD, Thùng, mã không có trong file nhưng có master → MASTER
      { so_number: 'S3', item: '10', od_number: '', material: '510000097', plant: '1102', sales_unit: 'Thùng', so_qty: 5, od_qty: 0, od_qty_base: 0, base_unit: 'HOP', delivery_date: 46266, so_type: 'ZOR1-SO Standard', item_category: 'ZTA1-IC Sales Standard', ship_to_code: 'C2' },
      // chưa OD, Cái → base = số SO
      { so_number: 'S4', item: '10', od_number: null, material: '720000113', plant: '1102', sales_unit: 'Cái', so_qty: 20, od_qty: 0, od_qty_base: 0, base_unit: 'EA', delivery_date: 46266, so_type: 'ZOR1-SO Standard', item_category: 'ZF01-Free-LT', ship_to_code: 'C2' },
      // chưa OD, Thùng, mã LẠ → unresolved
      { so_number: 'S5', item: '10', od_number: null, material: '599999999', plant: '1102', sales_unit: 'Thùng', so_qty: 7, od_qty: 0, od_qty_base: 0, base_unit: 'HOP', delivery_date: 46266, so_type: 'ZOR1-SO Standard', item_category: 'ZTA1-IC Sales Standard', ship_to_code: 'C3' },
      // đơn vị lạ
      { so_number: 'S6', item: '10', od_number: 'O6', material: '510000219', plant: '1102', sales_unit: 'Thùng lớn', so_qty: 1, od_qty: 1, od_qty_base: 24, base_unit: 'HOP', delivery_date: 46266, so_type: 'ZOR1-SO Standard', item_category: 'ZTA1-IC Sales Standard', ship_to_code: 'C1' },
      // huỷ
      { so_number: 'S7', item: '10', od_number: null, material: '510000219', plant: '1102', sales_unit: 'Thùng', so_qty: 8, od_qty: 0, od_qty_base: 0, base_unit: 'HOP', delivery_date: 46266, so_type: 'ZOR1-SO Standard', item_category: 'ZTA1-IC Sales Standard', ship_to_code: 'C1', cancel_status: 'Cty thiếu hàng' },
      // thiếu khoá → bỏ
      { so_number: '', item: '10', material: '510000219' },
    ]
    const out = parseZsd02(rows, ctx)
    expect(out.od.map(r => r.od_number)).toEqual(['O1', 'O6'])
    expect(out.so).toHaveLength(7)
    expect(out.stats.skipped).toBe(1)
    const so = new Map(out.so.map(r => [r.so_number, r]))
    expect(so.get('S1')).toMatchObject({ status: 'HAS_OD', od_number: 'O1', qty_so_base: 1440, derive_source: 'FILE' })
    expect(so.get('S2')).toMatchObject({ status: 'OPEN', od_number: null, qty_so_base: 240, qty_base_derived: true, derive_source: 'FILE', qty_unresolved: false })
    expect(so.get('S3')).toMatchObject({ qty_so_base: 240, derive_source: 'MASTER' })
    expect(so.get('S4')).toMatchObject({ qty_so_base: 20, qty_base_derived: false, derive_source: 'SAP', sales_unit: 'EA' })
    expect(so.get('S5')).toMatchObject({ qty_so_base: null, qty_unresolved: true })
    expect(so.get('S7')).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Cty thiếu hàng' })
    expect(out.stats.so_unresolved).toBe(2); expect(out.stats.cancelled).toBe(1)   // S5 (mã lạ) + S6 (đơn vị lạ → không biết bậc nào)
    expect([...out.unitErrs.values()].some(u => u.kind.includes('nhãn lạ') && u.file_value === 'Thùng lớn')).toBe(true)
    const o1 = out.od[0]
    expect(o1).toMatchObject({ qty_base: 1440, qty_sales: 60, sales_unit: 'CAR', base_unit: 'HOP', flow: 'SALE', dvvt_code: 'DA', dvvt_raw: 'Đông Á', sap_dispatch_status: 'ASSIGNED', gross_weight_kg: 298.2, qty_issued_base: 720, delivery_date: '2026-09-01' })
    // dòng y hệt → cùng hash; đổi một cột nghiệp vụ → khác
    const h1 = bizHash(o1 as Record<string, unknown>, ZSD02_BIZ)
    expect(bizHash({ ...o1, raw: null, updated_at: 'x' } as Record<string, unknown>, ZSD02_BIZ)).toBe(h1)
    expect(bizHash({ ...o1, qty_base: 1441 } as Record<string, unknown>, ZSD02_BIZ)).not.toBe(h1)
  })
})

describe.skipIf(!HAS_SAMPLE)('zsd02Parse — file mẫu SAP 01–25/09/2026 (số đo độc lập 22/09)', () => {
  const wb = HAS_SAMPLE ? XLSX.read(readFileSync(SAMPLE), { type: 'buffer' }) : null
  it('map đủ cột bắt buộc · 6.916 dòng OD · 1.135 dòng chưa OD · Σ base OD = 51.948.685', () => {
    const ws = wb!.Sheets[wb!.SheetNames[0]]
    const parsed = parseSheetByHeader(ws, ZSD02_FIELDS)
    expect(parsed.missingRequired).toEqual([])
    expect(parsed.rows).toHaveLength(8051)
    // MỌI header của file phải được khai — cột không khai là RƠI khỏi `raw` (bộ đọc chỉ dựng object từ cột đã map),
    // panel chi tiết dòng không có gì để in. Đo 24/09: 54/79 header được khai trước bản vá.
    const headers = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][])[0].filter(h => String(h).trim())
    expect(headers).toHaveLength(79)
    expect(Object.keys(parsed.rows[0])).toHaveLength(headers.length)
    const out = parseZsd02(parsed.rows, ctx)
    expect(out.stats.skipped).toBe(0)
    expect(out.od).toHaveLength(6916)
    expect(out.so).toHaveLength(8051 - 4)                     // 3 khoá (SO,Item) lặp (4 dòng thừa — SO item tách nhiều OD) → sổ SO giữ 1 dòng/khoá
    expect(out.so.filter(r => !r.od_number)).toHaveLength(1135)
    expect(out.od.every(r => r.od_number && r.qty_base != null)).toBe(true)
    expect(out.od.reduce((s, r) => s + Number(r.qty_base), 0)).toBe(51948685)
    expect(out.stats.cancelled).toBe(16)
    expect(out.so.filter(r => r.status === 'CANCELLED')).toHaveLength(16)
    expect(out.stats.od_numbers).toBe(1676)
    // đơn vị: chỉ 4 nhãn, quy nhãn hết — không có unitErr "nhãn lạ"
    expect([...out.unitErrs.values()].filter(u => u.kind.includes('nhãn lạ'))).toEqual([])
    expect(new Set(out.od.map(r => r.sales_unit))).toEqual(new Set(['CAR', 'HOP', 'EA', 'KG']))
    // base của dòng chưa OD: 874 dòng Thùng, 865 có hệ số quan sát trong file ⇒ chỉ 9 dòng rơi về master/không giải
    // (Cái/Hộp/kg = base thẳng, không cần hệ số)
    const noOd = out.so.filter(r => !r.od_number)
    expect(noOd.filter(r => r.derive_source === 'MASTER').length + noOd.filter(r => r.qty_unresolved).length).toBe(9)
    expect(noOd.filter(r => r.derive_source === 'FILE').length).toBeGreaterThanOrEqual(850)   // Thùng có hệ số trong file (đo: 865/874)
    expect(noOd.filter(r => r.derive_source === 'SAP' && r.sales_unit !== 'CAR').length).toBeGreaterThan(250)   // Cái/Hộp = base thẳng
    // phân loại: PALLET 669 · RETURN 235 · DISCOUNT 152 (mã 910000060 is_non_stock) · STO 644
    expect(out.stats.flows.PALLET).toBe(669)
    expect(out.stats.flows.RETURN).toBe(235)
    expect(out.stats.flows.DISCOUNT).toBe(152)
    expect(out.stats.flows.STO).toBe(644)
    expect(out.stats.unknown_flow_codes).toEqual([])
    // gram → kg đúng đơn vị: 510000219 60 thùng ≈ 298,2 kg; ĐVVT lạ chỉ còn "Vãng Lai" (không phải công ty)
    const l219 = out.od.find(r => r.material_code === '510000219' && Number(r.qty_sales) === 60)
    expect(l219?.gross_weight_kg).toBe(298.2)
    expect(out.stats.unknown_dvvt.every(d => /VÃNG LAI|Vãng Lai/i.test(d))).toBe(true)
    // tuyến 231 (1-1 mã ↔ tên) · 286 ship-to có phường
    expect(out.routes.size).toBe(231)
    expect([...out.customers.values()].filter(c => c.ward_code).length).toBe(286)
    // biển số giữ NGUYÊN VĂN (ngoại lệ erp_outbound_orders.license_plate)
    expect(out.od.some(r => /[- ]|[a-z]/.test(String(r.license_plate ?? '')))).toBe(true)
  })
})
