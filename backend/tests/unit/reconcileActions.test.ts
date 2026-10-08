// Nút xử lý việc "Cần xử lý" (FE `utils/reconcileActions`) phải khớp luật BE `resolveReconcileTask`: đổi mã / đổi khách giao
// KHÔNG có "Áp SAP" (BE 422) mà PHẢI có "Đã xử lý tay"; SAP ít hơn đã quét thì không "Áp SAP". Lỗi 08/10: điều kiện so
// `action === 'MATERIAL_CHANGED'` (giá trị của change_type) ⇒ việc đổi mã không bao giờ có lối "Đã xử lý tay".
import { describe, it, expect } from 'vitest'
import { reconcileButtons } from '../../../frontend/src/utils/reconcileActions'

const t = (o: Partial<Parameters<typeof reconcileButtons>[0]>) =>
  reconcileButtons({ status: 'OPEN', action: 'NEEDS_REVIEW', change_type: 'QTY_INCREASE', new_ordered: 10, scanned: 0, ...o })

describe('reconcileButtons', () => {
  it('đổi MÃ hàng: không Áp SAP, có Đã xử lý tay, có Giữ WMS', () => {
    expect(t({ change_type: 'MATERIAL_CHANGED' })).toEqual({ apply: false, manual: true, keep: true })
  })
  it('đổi KHÁCH GIAO (08/10): không Áp SAP (dù new_ordered rỗng ⇒ Number = 0 ≥ 0), có Đã xử lý tay', () => {
    expect(t({ change_type: 'SHIPTO_CHANGED', new_ordered: null, scanned: 0 })).toEqual({ apply: false, manual: true, keep: true })
  })
  it('đổi SL chưa quét: Áp SAP được, không cần Đã xử lý tay', () => {
    expect(t({ change_type: 'QTY_DECREASE', new_ordered: 8, scanned: 0 })).toEqual({ apply: true, manual: false, keep: true })
  })
  it('SAP ít hơn đã quét (BLOCKED): không Áp SAP, có Đã xử lý tay', () => {
    expect(t({ action: 'BLOCKED', change_type: 'QTY_DECREASE', new_ordered: 3, scanned: 5 })).toEqual({ apply: false, manual: true, keep: true })
  })
  it('việc đã xử lý: không nút nào', () => {
    expect(t({ status: 'RESOLVED', change_type: 'SHIPTO_CHANGED' })).toEqual({ apply: false, manual: false, keep: false })
  })
})
