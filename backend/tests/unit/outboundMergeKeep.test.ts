import { describe, it, expect } from 'vitest'
import { mergeKeepIssues } from '../../src/services/outboundMergeKeep'

// 23/10 (user chốt): sửa kế hoạch của chuyến kho đã làm — "đơn cũ 100 thùng, đơn sửa còn 80, mà đã quét 90 thì không được; quét 20 thì vẫn được,
// không thể nhả 20 thùng đó để đơn về trắng trơn". Một hàm cho cửa Lưu của bàn ghép xe + cửa gộp chuyến Tạm dừng bên Xuất.
describe('mergeKeepIssues — phần kho đã làm phải còn chỗ trong kế hoạch mới', () => {
  const ex = (done: number) => [{ npp: 'NPP A', material: 'M1', done }]
  it('đã quét 90, kế hoạch mới 80 ⇒ chặn, nêu số', () => {
    expect(mergeKeepIssues(ex(90), [{ npp: 'NPP A', material: 'M1', qty: 80 }])).toEqual([{ npp: 'NPP A', material: 'M1', done: 90, qty: 80 }])
  })
  it('đã quét 20, kế hoạch mới 80 ⇒ áp được (giữ 20 đã quét)', () => {
    expect(mergeKeepIssues(ex(20), [{ npp: 'NPP A', material: 'M1', qty: 80 }])).toEqual([])
  })
  it('kế hoạch mới bỏ hẳn dòng đã quét ⇒ chặn với qty 0', () => {
    expect(mergeKeepIssues(ex(5), [{ npp: 'NPP B', material: 'M1', qty: 50 }])).toEqual([{ npp: 'NPP A', material: 'M1', done: 5, qty: 0 }])
  })
  it('DO bị SAP thay bằng DO mới cùng khách cùng mã ⇒ nhiều dòng mới cộng dồn, khớp theo NPP + mã (không theo DO)', () => {
    expect(mergeKeepIssues(ex(60), [{ npp: 'NPP A', material: 'M1', qty: 30 }, { npp: ' NPP A ', material: 'M1 ', qty: 30 }])).toEqual([])
  })
  it('nhiều dòng cũ cùng khách cùng mã ⇒ cộng phần đã làm (đã quét + giữ nhặt lẻ)', () => {
    expect(mergeKeepIssues([{ npp: 'NPP A', material: 'M1', done: 40 }, { npp: 'NPP A', material: 'M1', done: 30 }], [{ npp: 'NPP A', material: 'M1', qty: 60 }]))
      .toEqual([{ npp: 'NPP A', material: 'M1', done: 70, qty: 60 }])
  })
  it('dòng cũ chưa làm gì ⇒ bỏ / giảm thoải mái', () => {
    expect(mergeKeepIssues([{ npp: 'NPP A', material: 'M1', done: 0 }, { npp: 'NPP A', material: 'M2', done: 0 }], [])).toEqual([])
  })
})
