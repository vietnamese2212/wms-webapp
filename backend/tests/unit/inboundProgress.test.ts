// Tiến độ nhập (26/11 — trang phiếu chung dùng cùng khuôn % + thanh với phiếu thường). Luật: ĐỦ = so số thật, không so % đã làm tròn;
// phiếu chung = trung bình từng mã (mỗi mã tối đa 100%), 100% khi và chỉ khi mọi mã đủ.
import { describe, it, expect } from 'vitest'
import { inboundProgressOf, receiptProgressOf } from '../../../frontend/src/utils/inboundProgress'

describe('inboundProgressOf', () => {
  it('không kế hoạch ⇒ null', () => {
    expect(inboundProgressOf(10, null)).toBeNull()
    expect(inboundProgressOf(10, undefined)).toBeNull()
    expect(inboundProgressOf(10, 0)).toBeNull()
  })
  it('thiếu 0,4 KG trên 2.000 KG KHÔNG hiện 100% đủ (lỗi làm tròn cũ)', () => {
    expect(inboundProgressOf(1999.6, 2000)).toEqual({ pct: 99, done: false })
  })
  it('đủ đúng bằng kế hoạch, kể cả sai số dấu phẩy động', () => {
    expect(inboundProgressOf(2000, 2000)).toEqual({ pct: 100, done: true })
    expect(inboundProgressOf(0.1 + 0.2, 0.3)).toEqual({ pct: 100, done: true })
  })
  it('thừa ⇒ đủ, % trên 100 như phiếu thường', () => {
    expect(inboundProgressOf(2200, 2000)).toEqual({ pct: 110, done: true })
  })
  it('chưa nhận ⇒ 0%', () => {
    expect(inboundProgressOf(0, 500)).toEqual({ pct: 0, done: false })
  })
})

describe('receiptProgressOf', () => {
  it('không mã nào có kế hoạch ⇒ null', () => {
    expect(receiptProgressOf([{ received: 5, planned: null }])).toBeNull()
    expect(receiptProgressOf([])).toBeNull()
  })
  it('trung bình từng mã; mã thừa không bù mã thiếu', () => {
    // 100% (thừa, tính 100) + 50% ⇒ 75%, chưa đủ
    expect(receiptProgressOf([{ received: 300, planned: 200 }, { received: 50, planned: 100 }])).toEqual({ pct: 75, done: false })
  })
  it('100% khi và chỉ khi mọi mã đủ — 99,6% làm tròn vẫn là 99', () => {
    expect(receiptProgressOf([{ received: 200, planned: 200 }, { received: 99.2, planned: 100 }])).toEqual({ pct: 99, done: false })
    expect(receiptProgressOf([{ received: 200, planned: 200 }, { received: 120, planned: 100 }])).toEqual({ pct: 100, done: true })
  })
  it('bỏ qua mã không kế hoạch', () => {
    expect(receiptProgressOf([{ received: 7, planned: null }, { received: 100, planned: 100 }])).toEqual({ pct: 100, done: true })
  })
})
