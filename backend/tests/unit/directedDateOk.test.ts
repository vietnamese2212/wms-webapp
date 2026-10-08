import { describe, it, expect } from 'vitest'
import { markRowsDateOk, type DateCheckRow } from '../../src/services/directedTasks'

// 08/10 (đóng vai lái xe nâng): thẻ việc treo từ 16/09 in yêu cầu "≥ 90 %" cạnh pallet ghim 86 % mà tô XANH — cờ `date_ok`
// của bảng Việc cần làm phải nói "dưới yêu cầu" bằng CHÍNH luật của cửa quét (palletMeetsDateRule).
const DAY = 86_400_000
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
// hạn 100 ngày, sản xuất cách đây `ago` ngày ⇒ %Date còn ≈ 100 − ago
const pallet = (ago: number, extra: Record<string, unknown> = {}) => ({ production_date: ymd(Date.now() - ago * DAY), mat_shelf_days: 100, ...extra })

describe('markRowsDateOk — pallet ghim còn đạt mức date của dòng đơn', () => {
  it('pallet tụt dưới mức ⇒ false (bản cũ: tô xanh theo thang chung)', () => {
    const rows: DateCheckRow[] = [{ date_rules: [{ kind: 'MIN_PCT', value: 90 }], pallets: [pallet(14)] }]
    markRowsDateOk(rows)
    expect(rows[0].date_ok).toBe(false)
  })
  it('đạt mức ⇒ true · một pallet chưa làm tụt mức là cả dòng false', () => {
    const a: DateCheckRow[] = [{ date_rules: [{ kind: 'MIN_PCT', value: 90 }], pallets: [pallet(3), pallet(5)] }]
    const b: DateCheckRow[] = [{ date_rules: [{ kind: 'MIN_PCT', value: 90 }], pallets: [pallet(3), pallet(20)] }]
    markRowsDateOk(a); markRowsDateOk(b)
    expect(a[0].date_ok).toBe(true)
    expect(b[0].date_ok).toBe(false)
  })
  it('pallet đã làm / đã bỏ không tính · không còn pallet chưa làm ⇒ null', () => {
    const a: DateCheckRow[] = [{ date_rules: [{ kind: 'MIN_PCT', value: 90 }], pallets: [pallet(3), pallet(40, { done: true }), pallet(40, { skipped: true })] }]
    const b: DateCheckRow[] = [{ date_rules: [{ kind: 'MIN_PCT', value: 90 }], pallets: [pallet(40, { done: true })] }]
    markRowsDateOk(a); markRowsDateOk(b)
    expect(a[0].date_ok).toBe(true)
    expect(b[0].date_ok).toBeNull()
  })
  it('không mức nào (FEFO hoặc trống) ⇒ FEFO đạt, trống là null; date_required VL06O là mức dự phòng', () => {
    const fefo: DateCheckRow[] = [{ date_rules: [{ kind: 'FEFO' }], pallets: [pallet(60)] }]
    const none: DateCheckRow[] = [{ date_rules: [], pallets: [pallet(60)] }]
    const vl06o: DateCheckRow[] = [{ date_rules: [], date_required: 70, pallets: [pallet(40)] }]
    markRowsDateOk(fefo); markRowsDateOk(none); markRowsDateOk(vl06o)
    expect(fefo[0].date_ok).toBe(true)
    expect(none[0].date_ok).toBeNull()
    expect(vl06o[0].date_ok).toBe(false)
  })
  it('dòng gom nhiều mức: đạt MỘT mức bất kỳ là đạt (không biết pallet thuộc dòng hàng nào thì không kết luận sai)', () => {
    const rows: DateCheckRow[] = [{ date_rules: [{ kind: 'MIN_PCT', value: 90 }, { kind: 'MIN_DAYS', value: 50 }], pallets: [pallet(30)] }]
    markRowsDateOk(rows)
    expect(rows[0].date_ok).toBe(true)
  })
})
