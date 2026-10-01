/**
 * TÁCH ĐỊA CHỈ VIỆT NAM thành (phường/xã, tỉnh) — helper THUẦN (02/10/2026), nuôi máy định vị OpenStreetMap.
 *
 * Vì sao: địa chỉ SAP ghi tự do ("Số 7 Ngõ 28 Thiên Đức, Xã Phù Đổng, Thành phố Hà Nội"), máy định vị miễn phí
 * (Photon/OSM) tìm nguyên câu thì ra điểm bất kỳ trùng vài chữ (đo 02/10: "Xã Phù Đổng, Hà Nội" → một tu viện ở Đồng Nai),
 * nhưng hỏi đúng "tên phường, tỉnh" + lọc địa danh (osm_tag=place) + đòi ĐÚNG tên + ĐÚNG tỉnh thì ra đúng. User chốt "định vị tới
 * phường, xã là được" nên đơn vị tra là PHƯỜNG/XÃ, không phải số nhà.
 * Sau sáp nhập 01/07/2025 không còn cấp huyện; địa chỉ cũ còn "huyện X" thì bỏ qua đoạn đó. OSM còn ghi tên TỈNH CŨ ở nhiều nơi
 * ("Tứ Minh" vẫn thuộc "Hải Dương") ⇒ so tỉnh theo NHÓM sáp nhập (tỉnh mới + các tỉnh cũ gộp vào), không so đúng một tên.
 */
export interface VnAddressParts { ward: string | null; province: string | null; wardKind: 'phường' | 'xã' | 'thị trấn' | null }

const WARD_RE = /^(?:phường|p\.|xã|x\.|thị trấn|tt\.?)\s*(.+)$/i
const PROVINCE_RE = /^(?:tỉnh|thành phố|tp\.?|t\.p\.?)\s*(.+)$/i
const COUNTRY_RE = /^(?:việt nam|viet nam|vn)\.?$/i
const DISTRICT_RE = /^(?:huyện|quận|q\.|h\.|thị xã|tx\.?)\s*/i

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/[.,;]+$/g, '').trim()

/** Thường hoá GIỮ DẤU để so tên địa danh — bỏ dấu là sai ("Phú Đông" và "Phù Đổng" cùng thành "phu dong", test đơn vị bắt 02/10). */
export function normVn(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** "Thành Phố Hồ Chí Minh" → "Hồ Chí Minh"; viết tắt quen (HN, HCM, TP.HCM, SG) → tên đầy đủ. */
export function stripProvincePrefix(s: string): string {
  const m = PROVINCE_RE.exec(clean(s))
  const name = clean(m ? m[1] : s)
  const k = normVn(name)
  if (k === 'hn') return 'Hà Nội'
  if (k === 'hcm' || k === 'tp hcm' || k === 'sg' || k === 'sài gòn') return 'Hồ Chí Minh'
  return name
}

/** Tách địa chỉ theo dấu phẩy / chấm phẩy / " - ", tìm đoạn PHƯỜNG/XÃ (có tiền tố) và đoạn TỈNH (có tiền tố, hoặc đoạn cuối không phải quốc gia). */
export function parseVnAddress(address: string | null | undefined): VnAddressParts {
  // NFC trước: địa chỉ SAP có dòng ở dạng NFD ("xã" = x + a + dấu ngã rời) ⇒ regex chữ có dấu không khớp (thử sống 02/10: "xã Xuân Mai" không ra phường)
  const segs = String(address ?? '').normalize('NFC').split(/[,;]|\s+-\s+/).map(clean).filter(Boolean)
  let ward: string | null = null, wardKind: VnAddressParts['wardKind'] = null, province: string | null = null
  for (const s of segs) {
    const w = WARD_RE.exec(s)
    if (w && !ward) {
      ward = clean(w[1])
      const k = s.toLowerCase()
      wardKind = /^(?:phường|p\.)/.test(k) ? 'phường' : /^(?:thị trấn|tt)/.test(k) ? 'thị trấn' : 'xã'
      continue
    }
    const p = PROVINCE_RE.exec(s)
    if (p) province = clean(p[1])      // lấy đoạn CUỐI có tiền tố (địa chỉ "Thành phố Bắc Ninh" cũ rồi "Tỉnh Bắc Ninh" sau)
  }
  if (!province) {
    // không tiền tố: đoạn cuối không phải quốc gia, không phải huyện, không phải chính đoạn phường
    const tail = [...segs].reverse().find(s => !COUNTRY_RE.test(s) && !WARD_RE.test(s) && !DISTRICT_RE.test(s))
    if (tail && segs.length >= 2) province = tail
  }
  if (province) province = stripProvincePrefix(province)
  return { ward, province, wardKind }
}

/**
 * 34 tỉnh/thành sau sáp nhập 01/07/2025 → các tên còn gặp trong OSM / địa chỉ cũ (tỉnh mới đứng đầu). Tỉnh không đổi khai 1 tên.
 * Dùng để so TỈNH của kết quả máy định vị với tỉnh trong địa chỉ: khớp bất kỳ tên nào trong nhóm.
 */
export const PROVINCE_GROUPS: string[][] = [
  ['Hà Nội'], ['Hồ Chí Minh', 'Bình Dương', 'Bà Rịa - Vũng Tàu', 'Bà Rịa Vũng Tàu', 'Vũng Tàu'], ['Hải Phòng', 'Hải Dương'],
  ['Bắc Ninh', 'Bắc Giang'], ['Hưng Yên', 'Thái Bình'], ['Ninh Bình', 'Nam Định', 'Hà Nam'], ['Phú Thọ', 'Vĩnh Phúc', 'Hòa Bình'],
  ['Lào Cai', 'Yên Bái'], ['Thái Nguyên', 'Bắc Kạn'], ['Tuyên Quang', 'Hà Giang'], ['Quảng Trị', 'Quảng Bình'],
  ['Đà Nẵng', 'Quảng Nam'], ['Quảng Ngãi', 'Kon Tum'], ['Gia Lai', 'Bình Định'], ['Khánh Hòa', 'Ninh Thuận'],
  ['Lâm Đồng', 'Bình Thuận', 'Đắk Nông'], ['Đắk Lắk', 'Phú Yên'], ['Đồng Nai', 'Bình Phước'], ['Tây Ninh', 'Long An'],
  ['Đồng Tháp', 'Tiền Giang'], ['Vĩnh Long', 'Bến Tre', 'Trà Vinh'], ['Cần Thơ', 'Sóc Trăng', 'Hậu Giang'], ['An Giang', 'Kiên Giang'],
  ['Cà Mau', 'Bạc Liêu'], ['Huế', 'Thừa Thiên Huế', 'Thừa Thiên - Huế'],
  ['Điện Biên'], ['Lai Châu'], ['Sơn La'], ['Cao Bằng'], ['Lạng Sơn'], ['Quảng Ninh'], ['Thanh Hóa'], ['Nghệ An'], ['Hà Tĩnh'],
]
/** Nhóm tỉnh chứa tên này (so giữ dấu, bỏ tiền tố Tỉnh/Thành phố); null = không nhận ra tỉnh. */
export function provinceGroup(name: string | null | undefined): string[] | null {
  if (!name) return null
  const k = normVn(stripProvincePrefix(name))
  return PROVINCE_GROUPS.find(g => g.some(n => normVn(n) === k)) ?? null
}
/** Một đoạn địa danh của kết quả (state/county/city) có nhắc tới tỉnh trong nhóm không — "Thành phố Bắc Ninh" / "Tỉnh Hải Dương" đều tính. */
export function provinceMatches(resultPart: string | null | undefined, group: string[]): boolean {
  if (!resultPart) return false
  const r = normVn(stripProvincePrefix(resultPart))
  return group.some(n => { const k = normVn(n); return r === k || r.endsWith(` ${k}`) })
}

/** Tên kết quả có khớp tên phường/xã hỏi không — ĐÚNG tên (có thể kèm tiền tố "Phường …"); không nhận trùng một phần ("Ấp Hưng Phú" ≠ "Phú"). */
export function placeNameMatches(resultName: string | null | undefined, ward: string): boolean {
  if (!resultName) return false
  const r = normVn(resultName).replace(/^(?:phường|xã|thị trấn|tt) /, '')
  const w = normVn(ward).replace(/^(?:phường|xã|thị trấn|tt) /, '')
  return !!w && r === w
}

/** Tên phường/xã từ cột Customer.ward_code của SAP ("H.Phòng-Ngô Quyền" → "Ngô Quyền") — đường lùi khi địa chỉ không ghi Phường/Xã. */
export function wardFromSapCode(code: string | null | undefined): string | null {
  const s = String(code ?? '').trim()
  const i = s.indexOf('-')
  if (i < 0) return null
  const w = clean(s.slice(i + 1))
  return w.length >= 2 ? w : null
}
