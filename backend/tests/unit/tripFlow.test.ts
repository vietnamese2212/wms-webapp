// "ĐÃ GIAO" — chuyển kho (kho nhận xác nhận) hay bán hàng (tài xế xác nhận, luật 19/10)? 20/10 (chạy thử một ngày Ba Vì): cờ
// delivery_confirmation có OTHER ⇒ chuyến bán hàng tới khách thường cũng sinh lệnh TRF_ (SELF, KHÔNG kho đích) + transfer_status ⇒ chuỗi
// tình trạng xe chờ "kho nhận" mãi, "Đã giao" tài xế bấm không bao giờ hiện. Chuyển kho = lệnh TRF có KHO ĐÍCH thật.
import { describe, it, expect } from 'vitest'
import { isTransferDelivery } from '../../src/services/tripFlow'

describe('isTransferDelivery', () => {
  it('lệnh TRF có kho đích ⇒ chuyển kho', () => {
    expect(isTransferDelivery({ destination_warehouse_id: 'bau-bang' }, 'IN_TRANSIT')).toBe(true)
  })
  it('lệnh TRF KHÔNG kho đích (OTHER — khách thường) ⇒ bán hàng, dù transfer_status đã đặt', () => {
    expect(isTransferDelivery({ destination_warehouse_id: null }, 'IN_TRANSIT')).toBe(false)
  })
  it('không có lệnh TRF: dựa vào transfer_status (dữ liệu cũ)', () => {
    expect(isTransferDelivery(undefined, 'DELIVERED')).toBe(true)
    expect(isTransferDelivery(undefined, null)).toBe(false)
  })
})
