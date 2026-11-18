// Dữ liệu thô tiêu hao NVL (MES 18/11 g — "để làm việc với ERP SAP"): khuôn cột dùng chung cho bảng · file xuất · sheet thô của báo cáo chu kỳ.
import { describe, it, expect } from 'vitest'
import { vnYmd, vnHms, vnStamp, rawAoa, RAW_EVENT_COLS, RAW_REQ_COLS, RAW_FILL_COLS, type RawEvent } from '../../../frontend/src/utils/consumptionRaw'

const E = (over: Partial<RawEvent>): RawEvent => ({
  line_id: 'L1', event: 'ISSUE', at: '2026-11-17T17:30:00+00:00', qty: 12.5, signed_qty: 12.5, by_name: 'Thủ kho A', by_code: 'NV01',
  wh_code: 'CBBV', wh_name: 'Chế biến Ba Vì', factory_code: '20000016', factory_name: 'Kho Ba Vì', sap_plant: '1102', sap_sloc: null, nmsx: 'B',
  batch_id: 'b1', batch_code: 'B260001BD62', cycle: '26', batch_no: 1, shift: 'Ca 1', prod_date: '2026-11-17', batch_status: 'OPEN', batch_qa: 'HOLD',
  tank_code: 'BD62', machine_code: 'A', btp_code: 'BTP-X', btp_name: 'BTP X', btp_unit: 'KG',
  mat_code: '210000169', mat_name: 'Hương HY6', mat_desc: 'Hương sữa chua HY6', mat_category: 'RM01', unit: 'kg', entry_unit: null, units_per_carton: null,
  source: 'SCAN', pallet_code: '240626_210000169_5_DK_1', batch_lot: 'LOT9', production_date: '2026-06-24', expiry_date: '2027-06-19', import_date: '2026-11-17',
  ncc_code: '10008950', ncc_name: 'DKSH', manufacturer: null, rotation_violation: false, rotation_principle: 'FEFO', rotation_best_date: '2027-06-19',
  rotation_reason: null, exp_approved: false, exp_by: null, exp_at: null, exp_note: null,
  issued_at: '2026-11-17T17:30:00+00:00', issued_by: 'Thủ kho A', reversed_at: null, reversed_by: null, reverse_reason: null, ...over,
})

describe('ngày giờ Việt Nam cho dữ liệu thô', () => {
  it('17:30 UTC ngày 17 = 00:30 ngày 18 giờ Việt Nam', () => {
    expect(vnYmd('2026-11-17T17:30:00+00:00')).toBe('2026-11-18')
    expect(vnHms('2026-11-17T17:30:00+00:00')).toBe('00:30:00')
    expect(vnStamp('2026-11-17T17:30:00Z')).toBe('2026-11-18 00:30:00')
  })
  it('mốc không múi giờ đọc là UTC (kiểu timestamp của Supabase)', () => {
    expect(vnHms('2026-11-17T01:00:00')).toBe('08:00:00')
  })
  it('trống / hỏng ⇒ chuỗi rỗng, không ném lỗi', () => {
    expect(vnYmd(null)).toBe(''); expect(vnYmd('')).toBe(''); expect(vnHms('không phải ngày')).toBe(''); expect(vnStamp(undefined)).toBe('')
  })
})

describe('khuôn cột', () => {
  it.each([['phát sinh', RAW_EVENT_COLS], ['định mức', RAW_REQ_COLS], ['nạp bồn', RAW_FILL_COLS]] as const)('sheet %s: mã cột và tên cột không trùng', (_n, cols) => {
    expect(new Set(cols.map(c => c.key)).size).toBe(cols.length)
    expect(new Set(cols.map(c => c.label)).size).toBe(cols.length)
  })
  it('dòng 1 = tên cột (dạng thô, không dòng tiêu đề); mỗi phát sinh một dòng', () => {
    const aoa = rawAoa(RAW_EVENT_COLS, [E({}), E({ line_id: 'L2' })])
    expect(aoa[0]).toEqual(RAW_EVENT_COLS.map(c => c.label))
    expect(aoa).toHaveLength(3)
    expect(aoa.every(r => r.length === RAW_EVENT_COLS.length)).toBe(true)
  })
  it('dòng Huỷ cấp mang SL âm, ghi ngày huỷ; ĐVT in mã chuẩn; Plant SAP đủ', () => {
    const rev = E({ event: 'REVERSAL', at: '2026-11-19T02:00:00Z', signed_qty: -12.5, reversed_at: '2026-11-19T02:00:00Z', reversed_by: 'TC B' })
    const row = rawAoa(RAW_EVENT_COLS, [rev])[1]
    const col = (k: string) => row[RAW_EVENT_COLS.findIndex(c => c.key === k)]
    expect(col('event')).toBe('Huỷ cấp'); expect(col('qty')).toBe(-12.5); expect(col('date')).toBe('2026-11-19')
    expect(col('unit')).toBe('KG'); expect(col('plant')).toBe('1102'); expect(col('issued_at')).toBe('2026-11-18 00:30:00')
  })
  it('Σ SL có dấu (cấp + huỷ) = Σ lần cấp còn hiệu lực', () => {
    const rows = [E({ line_id: 'a', signed_qty: 10 }), E({ line_id: 'b', signed_qty: 5 }), E({ line_id: 'b', event: 'REVERSAL', signed_qty: -5 })]
    const qi = RAW_EVENT_COLS.findIndex(c => c.key === 'qty')
    const sum = rawAoa(RAW_EVENT_COLS, rows).slice(1).reduce((s, r) => s + Number(r[qi]), 0)
    expect(sum).toBe(10)
  })
})
