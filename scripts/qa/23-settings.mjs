// GÓI 23 — THAM SỐ VẬN HÀNH SystemSetting (đợt 2 chống hardcode 13/08).
// Với MỖI cờ: (a) PUT hợp lệ → 200 + GET trả đúng giá trị vừa lưu; (b) PUT bậy (sai khoảng /
// sai khóa / đảo thứ tự A≤B≤C, low≤good, warn≤crit) → 400; (c) KHÔI PHỤC giá trị ban đầu
// (có sẵn thì PUT lại nguyên văn, chưa có thì PUT mặc định — ngữ nghĩa tương đương vì consumer
// đọc mặc định khi chưa cấu hình). Kèm gác chung: key lạ → 400, thiếu token → 401,
// cờ bí mật (vision_api) không lộ qua GET hở đọc.
import { login, api, check, finish, BASE } from './lib.mjs'

// So sánh GIÁ TRỊ, không so thứ tự khóa — jsonb của Postgres tự đảo thứ tự key khi lưu
// ({photos,feed} lưu ra {feed,photos}), so JSON.stringify thô là fail oan (bắt lượt chạy đầu).
// Sắp ĐỆ QUY: cờ lồng nhau (org_profile.assumed_carton_mm {l,w,h} lưu ra {h,l,w}) cũng bị đảo ở
// TẦNG TRONG — bản sort-1-tầng báo oan lượt đầu chạy org_profile (14/08).
const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]))
  : v
const canon = (v) => JSON.stringify(sortDeep(v))

console.log(`── THAM SỐ VẬN HÀNH SystemSetting · ${BASE.replace('https://', '')} ──`)

// [0] gác chung trước khi login
{
  const r = await fetch(`${BASE}/api/wms/settings/retention_days`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: { photos: 60, feed: 3, error_logs: 30 } }),
  })
  check('PUT thiếu token → 401', r.status === 401, `http=${r.status}`)
}
await login()
{
  const r = await api('/wms/settings/khong_ton_tai', 'PUT', { value: 1 })
  check('Key ngoài sổ cờ → 400 UNKNOWN_SETTING', r.s === 400 && r.j?.error?.code === 'UNKNOWN_SETTING', `http=${r.s} code=${r.j?.error?.code}`)
}
{
  const r = await api('/wms/settings', 'GET')
  const leaked = (r.j?.data ?? []).some(s => s.key === 'vision_api')
  check('GET hở đọc KHÔNG lộ cờ bí mật vision_api', r.s === 200 && !leaked, `http=${r.s} leaked=${leaked}`)
}

// Giá trị gốc để khôi phục (null = chưa cấu hình)
const before = new Map(((await api('/wms/settings', 'GET')).j?.data ?? []).map(s => [s.key, s.value]))

// Mỗi case: [key, giá trị hợp lệ ≠ mặc định, [các giá trị PHẢI bị 400], mặc định để khôi phục khi chưa có]
const CASES = [
  ['retention_days', { photos: 90, feed: 7, error_logs: 60 },
    [{ photos: 3, feed: 7, error_logs: 60 },              // photos < 7
     { photos: 90, feed: 7, error_logs: 60, la: 1 },      // khóa lạ
     { photos: 90.5, feed: 7, error_logs: 60 },           // không nguyên
     { photos: 90, feed: 7 }],                            // thiếu khóa
    { photos: 60, feed: 3, error_logs: 30 }],
  ['cycle_count', { A: 5, B: 20, C: 60, window_days: 45 },
    [{ A: 30, B: 20, C: 60, window_days: 45 },            // A > B — đảo bản chất ABC
     { A: 5, B: 20, C: 400, window_days: 45 },            // C > 365
     { A: 5, B: 20, C: 60, window_days: 3 },              // window < 7
     { A: 5, B: 20, C: 60 }],                             // thiếu khóa
    { A: 7, B: 30, C: 90, window_days: 30 }],
  ['inbound_edit_window_days', 5, [0, 91, 2.5, 'hai', { d: 2 }], 2],
  ['packing_max_materials_per_run', 15, [0, 51, 10.5, [10]], 10],
  ['pct_date_bands', { good: 65, low: 25 },
    [{ good: 20, low: 90 },                               // low > good
     { good: 120, low: 25 },                              // good > 100
     { good: 65, low: 25, la: 1 }],                       // khóa lạ
    { good: 60, low: 30 }],
  // vn_holidays (14/08) — lịch nghỉ lễ khai tay theo năm; mặc định {} = năm nào cũng tự tính như cũ
  ['vn_holidays',
    { 2026: [{ date: '2026-01-01', name: 'Tết Dương lịch' }, { date: '2026-09-02', name: 'Quốc khánh' }] },
    [{ 2026: [{ date: '2025-01-01', name: 'Sai năm' }] },                    // ngày không thuộc năm khai
     { 2026: [{ date: '2026-02-31', name: 'Ngày không có thật' }] },         // 31/02
     { 2026: [{ date: '01-01-2026', name: 'Sai định dạng' }] },
     { 2026: [{ date: '2026-01-01', name: 'A' }, { date: '2026-01-01', name: 'B' }] },  // trùng ngày
     { 2026: [{ date: '2026-01-01' }] },                                     // thiếu tên
     { 1999: [{ date: '1999-01-01', name: 'Ngoài khoảng năm' }] },
     { 2026: 'không phải mảng' }],
    {}],
  // org_profile (14/08) — nhận diện & tham số riêng đơn vị; mặc định = đúng giá trị đơn vị 1 đang chạy
  ['org_profile',
    { contact_email: 'wms@donvi2.vn', weigh_station_code: 'CN02', nmsx_alias: { B: 'P' }, assumed_carton_mm: { l: 400, w: 300, h: 200 } },
    [{ contact_email: 'khong-phai-email', weigh_station_code: 'CN02', nmsx_alias: {}, assumed_carton_mm: { l: 400, w: 300, h: 200 } },
     { contact_email: 'a@b.vn', weigh_station_code: '', nmsx_alias: {}, assumed_carton_mm: { l: 400, w: 300, h: 200 } },   // trạm rỗng
     { contact_email: 'a@b.vn', weigh_station_code: 'X', nmsx_alias: { B: 5 }, assumed_carton_mm: { l: 400, w: 300, h: 200 } }, // alias không phải chuỗi
     { contact_email: 'a@b.vn', weigh_station_code: 'X', nmsx_alias: {}, assumed_carton_mm: { l: 0, w: 300, h: 200 } },    // cỡ thùng ≤ 0
     { contact_email: 'a@b.vn', weigh_station_code: 'X', nmsx_alias: {}, assumed_carton_mm: { l: 400, w: 300 } },          // thiếu chiều cao
     { contact_email: 'a@b.vn', weigh_station_code: 'X', nmsx_alias: {}, assumed_carton_mm: { l: 400, w: 300, h: 200 }, la: 1 }], // khóa lạ
    { contact_email: 'wms@lof.vn', weigh_station_code: 'KB01', nmsx_alias: { A: 'O' }, assumed_carton_mm: { l: 422, w: 233, h: 100 } }],
]

for (const [key, valid, invalids, def] of CASES) {
  const put = await api(`/wms/settings/${key}`, 'PUT', { value: valid })
  check(`${key}: PUT hợp lệ → 200`, put.s === 200, `http=${put.s} ${JSON.stringify(put.j?.error ?? '').slice(0, 120)}`)
  const got = ((await api('/wms/settings', 'GET')).j?.data ?? []).find(s => s.key === key)?.value
  check(`${key}: GET trả đúng giá trị vừa lưu`, canon(got) === canon(valid), JSON.stringify(got))
  for (const bad of invalids) {
    const r = await api(`/wms/settings/${key}`, 'PUT', { value: bad })
    check(`${key}: PUT bậy ${JSON.stringify(bad).slice(0, 45)} → 400`, r.s === 400, `http=${r.s}`)
  }
  // Bậy bị chặn thì giá trị ĐANG LƯU phải còn nguyên (400 không được ghi đè một phần)
  const still = ((await api('/wms/settings', 'GET')).j?.data ?? []).find(s => s.key === key)?.value
  check(`${key}: sau loạt PUT bậy giá trị lưu KHÔNG đổi`, canon(still) === canon(valid), JSON.stringify(still))
  // Khôi phục
  const restore = before.has(key) ? before.get(key) : def
  const rr = await api(`/wms/settings/${key}`, 'PUT', { value: restore })
  check(`${key}: khôi phục giá trị ban đầu → 200`, rr.s === 200, `http=${rr.s}`)
}

// alert_thresholds: bộ 10 khóa (TRIP_LATE_DAYS mở 13/08) — thiếu khóa / sai chéo phải 400
{
  const key = 'alert_thresholds'
  const valid = {
    PCT_WARN: 20, PCT_CRIT: 10, GATE_WARN_MIN: 90, GATE_CRIT_MIN: 180,
    TRIP_STUCK_HOURS: 6, TRIP_LATE_DAYS: 21, WEIGH_WARN_PCT: 5, WEIGH_CRIT_PCT: 15,
    PACKING_UNRECV_WARN_H: 12, PACKING_UNRECV_CRIT_H: 24,
  }
  const put = await api(`/wms/settings/${key}`, 'PUT', { value: valid })
  check(`${key}: PUT đủ 10 khóa (có TRIP_LATE_DAYS) → 200`, put.s === 200, `http=${put.s} ${JSON.stringify(put.j?.error ?? '').slice(0, 120)}`)
  for (const [label, bad] of [
    ['TRIP_LATE_DAYS=200 (quá 180)', { ...valid, TRIP_LATE_DAYS: 200 }],
    ['TRIP_LATE_DAYS=1.5 (không nguyên)', { ...valid, TRIP_LATE_DAYS: 1.5 }],
    ['thiếu TRIP_LATE_DAYS', (() => { const { TRIP_LATE_DAYS: _drop, ...rest } = valid; return rest })()],
  ]) {
    const r = await api(`/wms/settings/${key}`, 'PUT', { value: bad })
    check(`${key}: ${label} → 400`, r.s === 400, `http=${r.s}`)
  }
  const restore = before.has(key) ? before.get(key) : valid
  // Giá trị cũ lưu trước 13/08 chỉ có 9 khóa → validator mới từ chối; đắp TRIP_LATE_DAYS mặc định là ĐÚNG ngữ nghĩa cũ
  const restoreFull = (restore && typeof restore === 'object' && !('TRIP_LATE_DAYS' in restore))
    ? { ...restore, TRIP_LATE_DAYS: 14 } : restore
  const rr = await api(`/wms/settings/${key}`, 'PUT', { value: restoreFull })
  check(`${key}: khôi phục giá trị ban đầu → 200`, rr.s === 200, `http=${rr.s}`)
}

finish('SETTINGS')
