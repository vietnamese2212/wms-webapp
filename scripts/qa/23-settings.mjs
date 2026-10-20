// GÓI 23 — THAM SỐ VẬN HÀNH SystemSetting (đợt 2 chống hardcode 13/08).
// Với MỖI cờ: (a) PUT hợp lệ → 200 + GET trả đúng giá trị vừa lưu; (b) PUT bậy (sai khoảng /
// sai khóa / đảo thứ tự A≤B≤C, low≤good, warn≤crit) → 400; (c) KHÔI PHỤC giá trị ban đầu
// (có sẵn thì PUT lại nguyên văn, chưa có thì PUT mặc định — ngữ nghĩa tương đương vì consumer
// đọc mặc định khi chưa cấu hình). Kèm gác chung: key lạ → 400, thiếu token → 401,
// cờ bí mật (vision_api) không lộ qua GET hở đọc.
import { login, api, check, finish, BASE, restAll, restWrite, ENV } from './lib.mjs'

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
  const leaked = (r.j?.data ?? []).filter(s => s.key === 'vision_api' || s.key === 'geo_api').map(s => s.key)
  check('GET hở đọc KHÔNG lộ cờ bí mật vision_api / geo_api', r.s === 200 && leaked.length === 0, `http=${r.s} leaked=${leaked.join(',')}`)
}

// Khoá Goong (02/10, user chốt dán trong app): cửa ghi DUY NHẤT là /wms/geo-config; /wms/settings/geo_api bị chặn;
// GET chỉ trả đuôi che. Có khoá THẬT trên staging thì không đè — chỉ bắn giá trị bậy + kịch bản khoá giả khi đang trống.
{
  const viaSettings = await api('/wms/settings/geo_api', 'PUT', { value: { key_enc: 'x' } })
  check('geo-config: ghi geo_api qua /wms/settings bị chặn 400 UNKNOWN_SETTING',
    viaSettings.s === 400 && viaSettings.j?.error?.code === 'UNKNOWN_SETTING', `http=${viaSettings.s} code=${viaSettings.j?.error?.code}`)
  for (const [label, body] of [
    ['khoá quá ngắn', { api_key: 'abc' }],
    ['khoá có ký tự lạ', { api_key: 'abcdefghij klmnopqrstuvwxyz0123456789' }],
    ['thiếu api_key', {}],
    ['api_key là số', { api_key: 12345678901234567890 }],
  ]) {
    const r = await api('/wms/geo-config', 'PUT', body)
    check(`geo-config: ${label} → 400`, r.s === 400, `http=${r.s}`)
  }
  const pre = await api('/wms/geo-config', 'GET')
  const d0 = pre.j?.data ?? {}
  check('geo-config: GET → 200 có configured/source/key_tail/ready, KHÔNG lộ khoá',
    pre.s === 200 && typeof d0.configured === 'boolean' && 'source' in d0 && 'ready' in d0 && !('key_enc' in d0) && !('api_key' in d0)
      && (d0.key_tail == null || /^••••.{4}$/.test(d0.key_tail)),
    `http=${pre.s} d=${JSON.stringify(d0).slice(0, 160)}`)
  if (!d0.configured) {
    const fake = `qa23fakegoongkey${Date.now()}abcdef`
    const saved = await api('/wms/geo-config', 'PUT', { api_key: fake })
    const after = (await api('/wms/geo-config', 'GET')).j?.data ?? {}
    // Khoá giả: Goong trả 4xx ⇒ test phải là 422 (không 5xx), và máy định vị báo "sẵn sàng" vì chỉ kiểm có khoá
    const t = await api('/wms/geo-config/test', 'POST', {})
    const off = await api('/wms/geo-config', 'PUT', { api_key: null })
    const gone = (await api('/wms/geo-config', 'GET')).j?.data ?? {}
    check('geo-config: lưu khoá giả → 200 đuôi che đúng · GET source=app · test khoá giả → 422 không 5xx · gỡ → configured=false',
      saved.s === 200 && saved.j?.data?.key_tail === `••••${fake.slice(-4)}` && after.source === 'app' && after.key_tail === `••••${fake.slice(-4)}`
        && t.s === 422 && off.s === 200 && gone.configured === false,
      `save=${saved.s} after=${JSON.stringify(after).slice(0, 120)} test=${t.s}/${t.j?.error?.code} off=${off.s} gone=${gone.configured}`)
    const audit = await restAll('admin_audit_events', `select=action,target_id&action=eq.GEO_CONFIG&target_id=eq.geo_api&limit=5`)
    check('geo-config: dán / gỡ khoá có vết Nhật ký quản trị GEO_CONFIG', audit.length >= 1, `n=${audit.length}`)
  } else {
    console.log(`ℹ️  geo-config đã có khoá thật (${d0.source}) — bỏ qua kịch bản khoá giả (không đè khoá của đơn vị)`)
    const t = await api('/wms/geo-config/test', 'POST', {})
    check('geo-config: khoá thật → test 200 trả toạ độ (hoặc 422 nếu Goong từ chối), không 5xx', t.s === 200 || t.s === 422, `http=${t.s} ${JSON.stringify(t.j?.data ?? t.j?.error).slice(0, 120)}`)
  }
}

// Cấu hình AI Vision (nhà cung cấp Gemini/GPT — 14/08): CHỈ bắn giá trị BẬY để không đụng key thật
// đang cấu hình trên staging. Nhà cung cấp ngoài sổ phải bị chặn, không được âm thầm nhận rồi lưu.
{
  for (const [label, body] of [
    ['provider lạ "claude"', { provider: 'claude' }],
    ['provider rỗng', { provider: '' }],
    ['provider là số', { provider: 3 }],
  ]) {
    const r = await api('/wms/vision-config', 'PUT', body)
    check(`vision-config: ${label} → 400`, r.s === 400, `http=${r.s}`)
  }
  // Danh sách model: hỏi nhà cung cấp KHÔNG có key đã lưu → 422 rõ ràng, KHÔNG dùng nhầm key bên kia
  {
    const cur = (await api('/wms/vision-config', 'GET')).j?.data ?? {}
    const other = cur.provider === 'openai' ? 'gemini' : 'openai'
    const r = await api('/wms/vision-config/models', 'POST', { provider: other })
    check(`vision-models: hỏi ${other} khi chưa có key của bên đó → 422`,
      r.s === 422 && r.j?.error?.code === 'VISION_NOT_CONFIGURED', `http=${r.s} code=${r.j?.error?.code}`)
    const bad = await api('/wms/vision-config/models', 'POST', { provider: 'claude' })
    check('vision-models: provider lạ → dùng cấu hình hiện tại, KHÔNG 500', bad.s !== 500, `http=${bad.s}`)
  }
  const g = await api('/wms/vision-config', 'GET')
  const d = g.j?.data ?? {}
  check('vision-config: GET nêu đủ nhà cung cấp hỗ trợ + KHÔNG lộ key',
    g.s === 200 && Array.isArray(d.providers) && d.providers.includes('gemini') && d.providers.includes('openai')
      && !('key_enc' in d) && !('api_key' in d),
    `providers=${JSON.stringify(d.providers)}`)
}

// Giá trị gốc để khôi phục (null = chưa cấu hình)
const before = new Map(((await api('/wms/settings', 'GET')).j?.data ?? []).map(s => [s.key, s.value]))

// Mỗi case: [key, giá trị hợp lệ ≠ mặc định, [các giá trị PHẢI bị 400], mặc định để khôi phục khi chưa có]
const CASES = [
  // 20/10: ledger / logs / sap_lines / sap_raw — 0 = giữ mãi, bật thì ≥ sàn (sổ kiểm toán không cho xoá bản mới)
  ['retention_days', { photos: 90, feed: 7, error_logs: 60, ledger: 0, logs: 400, sap_lines: 800, sap_raw: 45 },
    [{ photos: 3, feed: 7, error_logs: 60 },              // photos < 7
     { photos: 90, feed: 7, error_logs: 60, la: 1 },      // khóa lạ
     { photos: 90.5, feed: 7, error_logs: 60 },           // không nguyên
     { photos: 90, feed: 7 },                             // thiếu khóa
     { photos: 90, feed: 7, error_logs: 60, logs: 100 },        // logs < 180
     { photos: 90, feed: 7, error_logs: 60, sap_lines: 200 },   // sap_lines < 365
     { photos: 90, feed: 7, error_logs: 60, sap_lines: 4000 },  // sap_lines > 3650
     { photos: 90, feed: 7, error_logs: 60, sap_raw: 3 },       // sap_raw < 7
     { photos: 90, feed: 7, error_logs: 60, sap_raw: -1 }],     // âm
    { photos: 60, feed: 3, error_logs: 30 }],
  ['cycle_count', { A: 5, B: 20, C: 60, window_days: 45 },
    [{ A: 30, B: 20, C: 60, window_days: 45 },            // A > B — đảo bản chất ABC
     { A: 5, B: 20, C: 400, window_days: 45 },            // C > 365
     { A: 5, B: 20, C: 60, window_days: 3 },              // window < 7
     { A: 5, B: 20, C: 60 }],                             // thiếu khóa
    { A: 7, B: 30, C: 90, window_days: 30 }],
  ['inbound_edit_window_days', 5, [0, 91, 2.5, 'hai', { d: 2 }], 2],
  ['packing_max_materials_per_run', 15, [0, 51, 10.5, [10]], 10],
  // dashboard_cache_seconds (21/08) — TUỔI tối đa của số liệu trang chủ. Khác các cờ số khác:
  // **0 là giá trị HỢP LỆ** (tắt cache, tính sống mỗi lần) nên KHÔNG được đưa 0 vào danh sách phải-400.
  ['dashboard_cache_seconds', 120, [-1, 3601, 60.5, '300', [300], null], 300],
  // mobile_surface (21/09) — superadmin ẩn trang/tab khỏi điện thoại + chọn 6 ô bottom-nav. BE chỉ kiểm HÌNH DẠNG
  // (sổ khoá nằm ở FE); mặc định {hidden:[], bottom_nav:null} = hành vi cũ. Ghi = superadmin (kiểm riêng bên dưới).
  ['mobile_surface',
    { hidden: ['/wms/fill#report', '/wms/forklift'], bottom_nav: ['/wms/directed', '/wms/move-location', '/wms/stocktake'] },
    [{ hidden: 'x', bottom_nav: null },                                             // hidden không phải mảng
     { hidden: ['khong-bat-dau-bang-gach'], bottom_nav: null },                      // khoá sai dạng
     { hidden: ['/wms/fill', '/wms/fill'], bottom_nav: null },                       // trùng
     { hidden: [], bottom_nav: ['/a', '/b', '/c', '/d', '/e', '/f', '/g'] },         // quá 6 ô
     { hidden: [], bottom_nav: ['/wms/fill#report'] },                               // bottom-nav không nhận khoá tab
     { hidden: [], bottom_nav: null, la: 1 }],                                       // khoá lạ
    { hidden: [], bottom_nav: null }],
  // standard_work_hours (14/08 vòng 2) — giờ công chuẩn 1 ngày công; nhận nửa giờ, chặn số lẻ vụn
  ['standard_work_hours', 7.5, [0.5, 25, 7.37, '8', [8], null], 8],
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
  // org_profile (14/08) — nhận diện & tham số riêng đơn vị; mặc định = đúng giá trị đơn vị 1 đang chạy.
  // weigh_station_code ĐÃ GỠ khỏi cờ này (nhiều trạm cân ở nhiều kho ⇒ mã trạm do agent từng trạm
  // khai) — gửi lại khóa đó phải bị từ chối, không được âm thầm nhận rồi bỏ qua.
  ['org_profile',
    { contact_email: 'wms@donvi2.vn', nmsx_alias: { B: 'P' }, assumed_carton_mm: { l: 400, w: 300, h: 200 } },
    [{ contact_email: 'khong-phai-email', nmsx_alias: {}, assumed_carton_mm: { l: 400, w: 300, h: 200 } },
     { contact_email: 'a@b.vn', nmsx_alias: { B: 5 }, assumed_carton_mm: { l: 400, w: 300, h: 200 } },  // alias không phải chuỗi
     { contact_email: 'a@b.vn', nmsx_alias: {}, assumed_carton_mm: { l: 0, w: 300, h: 200 } },          // cỡ thùng ≤ 0
     { contact_email: 'a@b.vn', nmsx_alias: {}, assumed_carton_mm: { l: 400, w: 300 } },                // thiếu chiều cao
     { contact_email: 'a@b.vn', nmsx_alias: {}, assumed_carton_mm: { l: 400, w: 300, h: 200 }, la: 1 }, // khóa lạ
     { contact_email: 'a@b.vn', nmsx_alias: {}, assumed_carton_mm: { l: 400, w: 300, h: 200 }, weigh_station_code: 'KB01' }], // khóa ĐÃ GỠ
    { contact_email: 'wms@lof.vn', nmsx_alias: { A: 'O' }, assumed_carton_mm: { l: 422, w: 233, h: 100 } }],
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

// [archive] BẢO TRÌ DỮ LIỆU LỚN THEO NĂM (20/10, user "ok làm đi" sau khi đo cả DB): gieo dòng QA tháng 05/2014 ở 4 sổ (nhật ký quản trị,
// cảnh báo đã đóng + một cảnh báo ĐANG MỞ, dòng ZSD02 OD / SO ở plant giả QA23P) + một dòng OD 60 ngày trước còn `raw`; cờ logs / sap_lines
// 3650 (10 năm — không đụng dữ liệu thật) + sap_raw 30 ⇒ POST /wms/maintenance/archive {force}: 4 tệp 2014-05 trong bucket, dòng gieo bị
// xoá, cảnh báo đang mở GIỮ, raw dòng 60 ngày còn {_v:0, created_by}, dòng 5 ngày giữ nguyên raw; GET archives liệt kê có vé tải, tệp
// gunzip ra CSV đủ cột. Ổ KHOÁ: giữ khoá bằng token riêng ⇒ lượt chạy trả 'busy' và KHÔNG xoá gì; không force ngay sau một lượt ⇒ 'recent'.
{
  const { gunzipSync } = await import('zlib')
  const { randomUUID } = await import('crypto')
  const TAG = 'QA23ARC', PLANT = 'QA23P', MONTH = '2014-05', OLD = '2014-05-10T03:00:00.000Z'
  const TABLES = ['admin_audit_events', 'alert_events', 'erp_outbound_orders', 'erp_so_lines']
  const sto = (path, method = 'DELETE') => fetch(`${ENV.SUPABASE_URL}/storage/v1/object/ledger-archive/${path}`, { method, headers: { apikey: ENV.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}` } }).catch(() => null)
  const cleanFiles = async () => { for (const t of TABLES) for (const n of [`${MONTH}.csv.gz`, `${MONTH}.p2.csv.gz`, `${MONTH}.p3.csv.gz`]) await sto(`${t}/${n}`) }
  const cleanRows = async () => {
    await restWrite('admin_audit_events', 'DELETE', `action=eq.${TAG}`).catch(() => {})
    await restWrite('alert_events', 'DELETE', `rule=eq.${TAG}`).catch(() => {})
    await restWrite('erp_outbound_orders', 'DELETE', `plant=eq.${PLANT}`).catch(() => {})
    await restWrite('erp_so_lines', 'DELETE', `plant=eq.${PLANT}`).catch(() => {})
  }
  const runArc = async (body) => {   // lượt bảo trì của người dùng thật đang giữ khoá ⇒ chờ rồi thử lại (không đỏ oan)
    for (let i = 0; ; i++) {
      const r = await api('/wms/maintenance/archive', 'POST', body)
      if (r.j?.data?.status !== 'busy' || i >= 4) return r
      await new Promise(res => setTimeout(res, 4000))
    }
  }
  await cleanRows(); await cleanFiles()
  const retBefore = before.has('retention_days') ? before.get('retention_days') : { photos: 60, feed: 3, error_logs: 30 }
  const base = { photos: 60, feed: 3, error_logs: 30, ...(retBefore && typeof retBefore === 'object' ? retBefore : {}) }
  const now = new Date().toISOString(), d60 = new Date(Date.now() - 60 * 86_400_000).toISOString(), d5 = new Date(Date.now() - 5 * 86_400_000).toISOString()
  const rawOld = { _v: 2, created_by: 'QA23USER', address: `${TAG} địa chỉ`, revenue_net: 1 }
  await restWrite('admin_audit_events', 'POST', '', [{ id: randomUUID(), actor_name: TAG, action: TAG, target_type: 'qa', target_id: TAG, target_label: `${TAG} "có, phẩy"`, created_at: OLD }])
  await restWrite('alert_events', 'POST', '', [
    { id: randomUUID(), rule: TAG, dedup_key: `${TAG}:closed`, severity: 'WARNING', title: `${TAG} đã đóng`, first_seen: OLD, last_seen: OLD, resolved_at: OLD, created_at: OLD, updated_at: OLD },
    { id: randomUUID(), rule: TAG, dedup_key: `${TAG}:open`, severity: 'WARNING', title: `${TAG} đang mở`, first_seen: OLD, last_seen: OLD, resolved_at: null, created_at: OLD, updated_at: OLD },
  ])
  await restWrite('erp_outbound_orders', 'POST', '', [
    { id: randomUUID(), od_number: `${TAG}1`, od_item: '10', plant: PLANT, source: 'ZSD02', raw: rawOld, created_at: OLD, updated_at: OLD },
    { id: randomUUID(), od_number: `${TAG}2`, od_item: '10', plant: PLANT, source: 'ZSD02', raw: rawOld, created_at: d60, updated_at: d60 },
    { id: randomUUID(), od_number: `${TAG}3`, od_item: '10', plant: PLANT, source: 'ZSD02', raw: rawOld, created_at: d5, updated_at: d5 },
  ])
  await restWrite('erp_so_lines', 'POST', '', [{ id: randomUUID(), so_number: `${TAG}1`, so_item: '10', plant: PLANT, raw: rawOld, created_at: OLD, updated_at: OLD }])

  const setOn = await api('/wms/settings/retention_days', 'PUT', { value: { ...base, logs: 3650, sap_lines: 3650, sap_raw: 30 } })
  // ổ khoá: giữ bằng token của bộ kiểm ⇒ lượt chạy phải 'busy' và chưa xoá gì
  let held = null
  for (let i = 0; i < 5 && held !== 'taken'; i++) {
    held = await restWrite('rpc/data_archive_take', 'POST', '', { p_token: TAG, p_lease_s: 60, p_min_gap_s: 0 }).catch(e => String(e))
    if (held !== 'taken') await new Promise(res => setTimeout(res, 4000))
  }
  const busy = await api('/wms/maintenance/archive', 'POST', { force: true, tasks: ['logs', 'sap_lines', 'sap_raw'] })
  const stillThere = (await restAll('admin_audit_events', `select=id&action=eq.${TAG}`)).length
  await restWrite('rpc/data_archive_release', 'POST', '', { p_token: TAG, p_result: { qa: TAG } }).catch(() => {})
  check('archive: ổ khoá đang bị giữ ⇒ lượt chạy trả busy, KHÔNG xoá gì (hai lượt chồng nhau là mất dữ liệu)',
    held === 'taken' && busy.s === 200 && busy.j?.data?.status === 'busy' && stillThere === 1,
    `held=${held} busy=${busy.s}/${busy.j?.data?.status} còn=${stillThere}`)

  const run = await runArc({ force: true, tasks: ['logs', 'sap_lines', 'sap_raw'] })
  const res = run.j?.data?.results ?? []
  const arch = t => res.find(r => r.table === t && r.status === 'archived' && r.month === MONTH)
  const left = {
    audit: (await restAll('admin_audit_events', `select=id&action=eq.${TAG}`)).length,
    alerts: (await restAll('alert_events', `select=dedup_key&rule=eq.${TAG}`)).map(a => a.dedup_key),
    od: await restAll('erp_outbound_orders', `select=od_number,raw&plant=eq.${PLANT}&order=od_number`),
    so: (await restAll('erp_so_lines', `select=id&plant=eq.${PLANT}`)).length,
  }
  const od2 = left.od.find(o => o.od_number === `${TAG}2`), od3 = left.od.find(o => o.od_number === `${TAG}3`)
  const purge = res.find(r => r.task === 'sap_raw')
  check('archive: logs + sap_lines 3650 ⇒ tháng 2014-05 của 4 sổ ghi tệp rồi xoá; cảnh báo ĐANG MỞ giữ; sap_raw 30 ⇒ dòng 60 ngày còn {_v:0, created_by}, dòng 5 ngày giữ raw',
    setOn.s === 200 && run.s === 200 && run.j?.data?.status === 'ran' && TABLES.every(t => !!arch(t))
      && left.audit === 0 && left.alerts.length === 1 && left.alerts[0] === `${TAG}:open` && left.so === 0
      && !left.od.some(o => o.od_number === `${TAG}1`)
      && JSON.stringify(od2?.raw) === JSON.stringify({ _v: 0, created_by: 'QA23USER' })
      && od3?.raw?._v === 2 && od3?.raw?.address === rawOld.address && purge?.status === 'purged' && purge.od >= 1,
    `http=${run.s} st=${run.j?.data?.status} ${run.j?.error?.message ?? ''} arch=${TABLES.map(t => `${t}:${arch(t)?.rows ?? '✗'}`).join(',')} left=${JSON.stringify({ ...left, od: left.od.map(o => `${o.od_number}:${JSON.stringify(o.raw).slice(0, 40)}`) })} purge=${JSON.stringify(purge)}`)

  const list = await api('/wms/maintenance/archives')
  const tab = t => (list.j?.data?.tables ?? []).find(x => x.table === t)
  const fAudit = tab('admin_audit_events')?.files?.find(f => f.month === MONTH)
  const dl = fAudit?.url ? await fetch(fAudit.url) : null
  const csv = dl?.ok ? gunzipSync(Buffer.from(await dl.arrayBuffer())).toString('utf8') : ''
  check('archive: GET /wms/maintenance/archives liệt kê tệp từng sổ có vé tải + lượt gần nhất; tệp nhật ký gunzip ra CSV có tiêu đề + dòng gieo (ô có dấu phẩy / ngoặc kép bọc chuẩn)',
    list.s === 200 && TABLES.every(t => tab(t)?.files?.some(f => f.month === MONTH && !!f.url)) && !!list.j?.data?.last_run_at
      && dl?.status === 200 && csv.startsWith('id,') && csv.includes('target_label') && csv.includes(`"${TAG} ""có, phẩy"""`),
    `http=${list.s} files=${TABLES.map(t => `${t}:${(tab(t)?.files ?? []).length}`).join(',')} dl=${dl?.status} csv=${csv.slice(0, 80)}`)

  const recent = await api('/wms/maintenance/archive', 'POST', {})
  // 'busy' cũng là "không chạy" (lượt của người dùng thật đang giữ khoá) — điều phải gác là KHÔNG chạy lại ngay
  check('archive: lượt tự động ngay sau một lượt ⇒ không chạy (recent — máy chủ giãn 30 phút)', recent.s === 200 && ['recent', 'busy'].includes(recent.j?.data?.status), `http=${recent.s} st=${recent.j?.data?.status}`)

  const restore = await api('/wms/settings/retention_days', 'PUT', { value: retBefore })
  check('archive: khôi phục retention_days → 200', restore.s === 200, `http=${restore.s}`)
  await cleanRows(); await cleanFiles()
}

// mobile_surface CHỈ superadmin ghi (user chốt 21/09 "config bởi superadmin") — người có wms_settings.manage_system
// vẫn sửa được cờ khác nhưng cờ này phải 403. Dựng tài khoản tạm QAMSF (chức danh chỉ có manage_system), tự dọn.
{
  const TAG = 'QAMSF'
  let bcrypt = null
  try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(m => m.default ?? m) } catch { /* */ }
  if (!bcrypt) console.log('  ⏭  không load được bcrypt của backend — bỏ qua phép kiểm 403 mobile_surface')
  else {
    const { randomUUID } = await import('crypto')
    const clean = async () => {
      for (const e of await restAll('Employee', `select=id&employee_code=like.${TAG}*`)) await restWrite('Employee', 'DELETE', `id=eq.${e.id}`)
      await restWrite('JobTitle', 'DELETE', `name=like.${TAG}*`).catch(() => {})
      await restWrite('auth_login_events', 'DELETE', `email=like.${TAG.toLowerCase()}*`).catch(() => {})
    }
    await clean()
    const dept = ((await api('/masterdata/departments', 'GET')).j?.data ?? [])[0]
    const jt = await api('/masterdata/job-titles', 'POST', { name: `${TAG} quản trị hệ thống`, department_id: dept?.id, module_permissions: { wms_settings: ['view', 'manage_system'] } })
    const jtId = jt.j?.data?.id
    check('QAMSF: tạo chức danh chỉ có manage_system → 201/200', (jt.s === 200 || jt.s === 201) && !!jtId, `http=${jt.s}`)
    const pw = 'Qa' + randomUUID().slice(0, 10) + '9x'
    const email = `${TAG.toLowerCase()}01@test.local`
    const empId = randomUUID()
    await restWrite('Employee', 'POST', '', [{ id: empId, employee_code: `${TAG}01`, name: `${TAG} nv`, email, job_title_id: jtId,
      password: bcrypt.hashSync(pw, 10), is_active: true, warehouse_scope: 'NATIONAL', updated_at: new Date().toISOString() }])
    const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })
    const tok = (await lr.json().catch(() => null))?.data?.token
    check('QAMSF: đăng nhập tài khoản tạm → có token', !!tok, `http=${lr.status}`)
    if (tok) {
      const put = async (key, value) => fetch(`${BASE}/api/wms/settings/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ value }) })
      const r1 = await put('mobile_surface', { hidden: [], bottom_nav: null })
      const j1 = await r1.json().catch(() => null)
      check('mobile_surface: manage_system KHÔNG phải superadmin → 403 SUPERADMIN_ONLY', r1.status === 403 && j1?.error?.code === 'SUPERADMIN_ONLY', `http=${r1.status} code=${j1?.error?.code}`)
      // Đối chứng: cùng tài khoản, cờ thường vẫn ghi được (403 ở trên là vì CỜ, không vì tài khoản hỏng)
      const cur = ((await api('/wms/settings', 'GET')).j?.data ?? []).find(s => s.key === 'inbound_edit_window_days')?.value ?? 2
      const r2 = await put('inbound_edit_window_days', cur)
      check('đối chứng: cùng tài khoản ghi cờ thường inbound_edit_window_days → 200', r2.status === 200, `http=${r2.status}`)
    }
    await clean()
  }
}

finish('SETTINGS')
