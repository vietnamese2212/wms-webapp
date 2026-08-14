// Ngày nghỉ lễ Việt Nam — lễ dương lịch cố định + lễ âm lịch tính tự động.
// Thuật toán âm lịch VN: Hồ Ngọc Đức (https://www.informatik.uni-leipzig.de/~duc/amlich/),
// múi giờ UTC+7. Tự quy đổi cho mọi năm — không cần cập nhật tay.

const PI = Math.PI
const TZ = 7
const INT = (d: number) => Math.floor(d)

function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = INT((14 - mm) / 12)
  const y = yy + 4800 - a
  const m = mm + 12 * a - 3
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083
  return jd
}

function jdToDate(jd: number): [number, number, number] {
  let a: number, b: number, c: number
  if (jd > 2299160) {
    a = jd + 32044
    b = INT((4 * a + 3) / 146097)
    c = a - INT((b * 146097) / 4)
  } else { b = 0; c = jd + 32082 }
  const d = INT((4 * c + 3) / 1461)
  const e = c - INT((1461 * d) / 4)
  const m = INT((5 * e + 2) / 153)
  const day = e - INT((153 * m + 2) / 5) + 1
  const month = m + 3 - 12 * INT(m / 10)
  const year = b * 100 + d - 4800 + INT(m / 10)
  return [day, month, year]
}

function newMoon(k: number): number {
  const T = k / 1236.85
  const T2 = T * T
  const T3 = T2 * T
  const dr = PI / 180
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr)
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M)
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr)
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr)
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr))
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M))
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr))
  C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M))
  const deltat = T < -11
    ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
    : -0.000278 + 0.000265 * T + 0.000262 * T2
  return Jd1 + C1 - deltat
}

function sunLongitude(jdn: number): number {
  const T = (jdn - 2451545.0) / 36525
  const T2 = T * T
  const dr = PI / 180
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M)
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M)
  let L = (L0 + DL) * dr
  L = L - PI * 2 * INT(L / (PI * 2))
  return L
}

const getSunLongitude = (dayNumber: number) => INT((sunLongitude(dayNumber - 0.5 - TZ / 24) / PI) * 6)
const getNewMoonDay = (k: number) => INT(newMoon(k) + 0.5 + TZ / 24)

function getLunarMonth11(yy: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021
  const k = INT(off / 29.530588853)
  let nm = getNewMoonDay(k)
  if (getSunLongitude(nm) >= 9) nm = getNewMoonDay(k - 1)
  return nm
}

function getLeapMonthOffset(a11: number): number {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5)
  let last = 0, i = 1
  let arc = getSunLongitude(getNewMoonDay(k + i))
  do { last = arc; i++; arc = getSunLongitude(getNewMoonDay(k + i)) } while (arc !== last && i < 14)
  return i - 1
}

// Trả về [ngày, tháng, năm] dương lịch của 1 ngày âm lịch
function lunarToSolar(lunarDay: number, lunarMonth: number, lunarYear: number): [number, number, number] {
  let a11: number, b11: number
  if (lunarMonth < 11) { a11 = getLunarMonth11(lunarYear - 1); b11 = getLunarMonth11(lunarYear) }
  else { a11 = getLunarMonth11(lunarYear); b11 = getLunarMonth11(lunarYear + 1) }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853)
  let off = lunarMonth - 11
  if (off < 0) off += 12
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11)
    if (off >= leapOff) off += 1
  }
  const monthStart = getNewMoonDay(k + off)
  return jdToDate(monthStart + lunarDay - 1)
}

const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (d: number, m: number, y: number) => `${y}-${pad(m)}-${pad(d)}`

// Lễ dương lịch cố định (khớp MM-DD, lặp mọi năm)
const FIXED: Record<string, string> = {
  '01-01': 'Tết Dương lịch',
  '04-30': 'Giải phóng miền Nam',
  '05-01': 'Quốc tế Lao động',
  '09-02': 'Quốc khánh',
}

// Cache lễ âm lịch theo từng năm dương
const lunarCache = new Map<number, Record<string, string>>()

function lunarHolidaysOf(year: number): Record<string, string> {
  const cached = lunarCache.get(year)
  if (cached) return cached
  const map: Record<string, string> = {}

  // Tết Nguyên đán: nghỉ 5 ngày — Giao thừa (30/29 Tết) + mùng 1..4
  const tet1 = lunarToSolar(1, 1, year)
  const jd1 = jdFromDate(tet1[0], tet1[1], tet1[2])
  const tetNames = ['Giao thừa (Tất niên)', 'Tết Nguyên đán (mùng 1)', 'Tết (mùng 2)', 'Tết (mùng 3)', 'Tết (mùng 4)']
  ;[-1, 0, 1, 2, 3].forEach((o, i) => {
    const [d, m, y] = jdToDate(jd1 + o)
    map[fmt(d, m, y)] = tetNames[i]
  })

  // Giỗ Tổ Hùng Vương 10/3 ÂL
  const gt = lunarToSolar(10, 3, year)
  map[fmt(gt[0], gt[1], gt[2])] = 'Giỗ Tổ Hùng Vương (10/3 ÂL)'

  lunarCache.set(year, map)
  return map
}

/**
 * Lịch nghỉ lễ KHAI TAY theo năm (SystemSetting `vn_holidays`, tab Hệ thống): năm nào có khai thì
 * dùng ĐÚNG danh sách khai — Chính phủ công bố lại hàng năm (nghỉ bù cuối tuần, Tết 5/7/9 ngày),
 * thuật toán tự tính bên dưới không đoán được. Năm KHÔNG khai → tự tính như cũ.
 */
export type HolidayOverrides = Record<string, Record<string, string>>   // '2026' → { 'YYYY-MM-DD': tên }

// Tên ngày lễ của 1 ngày dương 'YYYY-MM-DD', hoặc null
export function getHoliday(ds: string, overrides?: HolidayOverrides): string | null {
  const year = ds.slice(0, 4)
  const declared = overrides?.[year]
  if (declared) return declared[ds] ?? null      // đã khai năm này → danh sách khai là DUY NHẤT
  return lunarHolidaysOf(Number(year))[ds] ?? FIXED[ds.slice(5)] ?? null
}
