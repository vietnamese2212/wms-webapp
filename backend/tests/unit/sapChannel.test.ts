// Kênh SAP → kênh app (user 28/09: "tự điền từ SAP; kênh là nơi khai riêng — khai thêm kênh không có trên SAP như BHX").
import { describe, it, expect } from 'vitest'
import { sapChannelCode, sapChannelMap, channelToFill } from '../../src/utils/sapChannel'

const CHANS = [
  { value: 'GT', meta: { label: 'General Trade', sap_dist_channel: '10' } },
  { value: 'MT', meta: { label: 'Modern Trade', sap_dist_channel: '20' } },
  { value: 'BHX', meta: { label: 'Bách hoá xanh' } },   // kênh app không có trên SAP — chỉ gán tay
]

describe('kênh SAP → kênh app', () => {
  it('đọc mã đầu của cột Distribution Channel', () => {
    expect(sapChannelCode('10-General Trade')).toBe('10')
    expect(sapChannelCode(' 40-Export ')).toBe('40')
    expect(sapChannelCode('20')).toBe('20')
    expect(sapChannelCode('Others')).toBeNull()
    expect(sapChannelCode(null)).toBeNull()
  })
  it('khách CHƯA có kênh ⇒ điền theo SAP; kênh SAP chưa kênh app nào khai ⇒ để trống', () => {
    const m = sapChannelMap(CHANS)
    expect(channelToFill(null, '10-General Trade', m)).toBe('GT')
    expect(channelToFill('', '20-Modern Trade', m)).toBe('MT')
    expect(channelToFill(null, '40-Export', m)).toBeNull()
  })
  it('khách ĐÃ có kênh (gán tay, vd BHX dù SAP ghi Modern Trade) ⇒ KHÔNG đè', () => {
    expect(channelToFill('BHX', '20-Modern Trade', sapChannelMap(CHANS))).toBeNull()
  })
  it('hai kênh app khai CÙNG mã SAP ⇒ không đoán, bỏ mã đó', () => {
    const m = sapChannelMap([...CHANS, { value: 'GT2', meta: { sap_dist_channel: '10' } }])
    expect(m.has('10')).toBe(false)
    expect(m.get('20')).toBe('MT')
  })
})
