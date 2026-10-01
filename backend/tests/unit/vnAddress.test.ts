// Bộ tách địa chỉ VN cho máy định vị OSM (02/10) — mẫu lấy từ Customer.address thật trên staging + các ca máy trả SAI khi thử sống.
import { describe, it, expect } from 'vitest'
import { parseVnAddress, placeNameMatches, stripProvincePrefix, provinceGroup, provinceMatches, wardFromSapCode, PROVINCE_GROUPS } from '../../src/utils/vnAddress'

describe('parseVnAddress — phường/xã + tỉnh từ địa chỉ SAP tự do', () => {
  it('số nhà + Xã + Thành phố', () => {
    expect(parseVnAddress('Số 7 Ngõ 28 Thiên Đức, Xã Phù Đổng, Thành phố Hà Nội')).toEqual({ ward: 'Phù Đổng', province: 'Hà Nội', wardKind: 'xã' })
  })
  it('phường viết thường + tỉnh + quốc gia ở cuối bị bỏ', () => {
    expect(parseVnAddress('Tổ dân phố Bình Nội, phường Chũ, tỉnh Bắc Ninh, Việt Nam')).toEqual({ ward: 'Chũ', province: 'Bắc Ninh', wardKind: 'phường' })
  })
  it('địa chỉ cũ còn huyện: bỏ huyện, lấy thị trấn + tỉnh', () => {
    expect(parseVnAddress('Công ty TNHH Giầy Amara Việt Nam, Thị trấn Cổ Lễ, huyện Trực Ninh, thành phố Nam Định')).toEqual({ ward: 'Cổ Lễ', province: 'Nam Định', wardKind: 'thị trấn' })
  })
  it('tỉnh không tiền tố ở cuối · ngăn bằng " - "', () => {
    expect(parseVnAddress('Xóm Chi Khê, Xã Con Cuông, Nghệ An')).toEqual({ ward: 'Con Cuông', province: 'Nghệ An', wardKind: 'xã' })
    expect(parseVnAddress('Xã Xuân Trường - Tỉnh Ninh Bình')).toEqual({ ward: 'Xuân Trường', province: 'Ninh Bình', wardKind: 'xã' })
  })
  it('TP + VN viết tắt, dấu chấm cuối, HN/HCM', () => {
    expect(parseVnAddress('Tổ 1, khu An Trì, Phường Hồng Bàng, TP Hải Phòng, VN')).toEqual({ ward: 'Hồng Bàng', province: 'Hải Phòng', wardKind: 'phường' })
    expect(parseVnAddress('68b Đường 21, KP 5, Phường Hiệp Bình, TP.Hồ Chí Minh.')).toEqual({ ward: 'Hiệp Bình', province: 'Hồ Chí Minh', wardKind: 'phường' })
    expect(parseVnAddress('222 Trần Duy Hưng, Phường Yên Hòa , HN')).toEqual({ ward: 'Yên Hòa', province: 'Hà Nội', wardKind: 'phường' })
    expect(parseVnAddress('385 Phan Huy Ích,Phường An Hội Tây, TP.HCM')).toEqual({ ward: 'An Hội Tây', province: 'Hồ Chí Minh', wardKind: 'phường' })
  })
  it('địa chỉ ở dạng NFD (dấu rời) vẫn tách được — SAP xuất một số dòng kiểu này', () => {
    const nfd = 'Đội 17 thôn Đông Tiến, xã Xuân Mai, thành phố Hà Nội'.normalize('NFD')
    expect(parseVnAddress(nfd)).toEqual({ ward: 'Xuân Mai', province: 'Hà Nội', wardKind: 'xã' })
  })
  it('không có phường/xã → ward null, tỉnh vẫn lấy; địa chỉ rỗng → null hết', () => {
    expect(parseVnAddress('Số 1, đường 12, KCN VSIP, Đại Đồng, Bắc Ninh.')).toEqual({ ward: null, province: 'Bắc Ninh', wardKind: null })
    expect(parseVnAddress('')).toEqual({ ward: null, province: null, wardKind: null })
    expect(parseVnAddress(null)).toEqual({ ward: null, province: null, wardKind: null })
  })
  it('stripProvincePrefix bỏ "Thành phố"/"Tỉnh"/"TP."', () => {
    expect(stripProvincePrefix('Thành Phố Hồ Chí Minh')).toBe('Hồ Chí Minh')
    expect(stripProvincePrefix('TP. Hải Phòng')).toBe('Hải Phòng')
    expect(stripProvincePrefix('Khánh Hòa')).toBe('Khánh Hòa')
  })
})

describe('placeNameMatches — kết quả máy định vị phải mang ĐÚNG tên phường hỏi (chặn trả điểm trùng vài chữ)', () => {
  it('khớp: tên trần, có tiền tố, khác hoa thường', () => {
    expect(placeNameMatches('Chũ', 'Chũ')).toBe(true)
    expect(placeNameMatches('Phường Chũ', 'Chũ')).toBe(true)
    expect(placeNameMatches('TỨ MINH', 'Tứ Minh')).toBe(true)
    expect(placeNameMatches('Thanh Miếu', 'Phường Thanh Miếu')).toBe(true)
  })
  it('không khớp: tên khác dù chung chữ, chỉ khác DẤU, hay chỉ trùng một phần (thử sống 02/10: "Ấp Hưng Phú" nhận cho "Phú")', () => {
    expect(placeNameMatches('Chu', 'Chũ')).toBe(false)
    expect(placeNameMatches('Hồng Giang', 'Chũ')).toBe(false)
    expect(placeNameMatches('Dòng nữ tu Đa Minh Phú Cường', 'Phù Đổng')).toBe(false)
    expect(placeNameMatches('Phú Đông', 'Phù Đổng')).toBe(false)
    expect(placeNameMatches('Ấp Hưng Phú', 'Phú')).toBe(false)
    expect(placeNameMatches(null, 'Chũ')).toBe(false)
  })
})

describe('tỉnh theo NHÓM sáp nhập 2025 — OSM còn tên tỉnh cũ', () => {
  it('đủ 34 nhóm, mỗi tên chỉ ở một nhóm', () => {
    expect(PROVINCE_GROUPS.length).toBe(34)
    const all = PROVINCE_GROUPS.flat()
    expect(new Set(all).size).toBe(all.length)
  })
  it('provinceGroup nhận tên mới, tên cũ, có tiền tố; tỉnh lạ → null', () => {
    expect(provinceGroup('Hải Dương')).toContain('Hải Phòng')
    expect(provinceGroup('Thành phố Hải Phòng')).toContain('Hải Dương')
    expect(provinceGroup('HN')).toEqual(['Hà Nội'])
    expect(provinceGroup('tờ bản đồ số 49. đường Tô Hiệu')).toBeNull()
    expect(provinceGroup(null)).toBeNull()
  })
  it('provinceMatches: kết quả "Tỉnh Hải Dương" khớp nhóm Hải Phòng; Lâm Đồng KHÔNG khớp nhóm Tây Ninh (thử sống: "Đức Lập" trả về Lâm Đồng)', () => {
    const hp = provinceGroup('Hải Phòng')!
    expect(provinceMatches('Tỉnh Hải Dương', hp)).toBe(true)
    expect(provinceMatches('Thành phố Hải Phòng', hp)).toBe(true)
    expect(provinceMatches('Lâm Đồng', provinceGroup('Tây Ninh')!)).toBe(false)
    expect(provinceMatches('Nghệ An', provinceGroup('HN')!)).toBe(false)
    expect(provinceMatches(undefined, hp)).toBe(false)
  })
  it('wardFromSapCode: "H.Phòng-Ngô Quyền" → "Ngô Quyền"; không có gạch → null', () => {
    expect(wardFromSapCode('H.Phòng-Ngô Quyền')).toBe('Ngô Quyền')
    expect(wardFromSapCode('BB-Hồ Chí Minh-Hiệp Bình')).toBe('Hồ Chí Minh-Hiệp Bình')
    expect(wardFromSapCode('Nhà máy Hà Nội')).toBeNull()
    expect(wardFromSapCode(null)).toBeNull()
  })
})
