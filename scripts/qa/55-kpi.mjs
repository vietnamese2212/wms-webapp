// GÓI 55 — TAB KPI Dashboard (08/09/2026): 24 KPI đo được + mục tiêu cấu hình + so kỳ + xu hướng tháng.
//
// Vì sao có gói này: KPI là thứ người quản lý ĐỌC RỒI QUYẾT, sai một công thức là quyết sai. Bốn thứ dễ vỡ:
//   (a) GIÁ TRỊ = đúng công thức từ {num, den} (oracle tự tính lại) và TỔNG = Σ các kho, không phải trung bình %;
//   (b) ĐÈN chỉ sáng khi có cả giá trị lẫn mục tiêu; mục tiêu có 3 tầng mặc định → công ty → riêng kho, tầng nào
//       thắng phải nói ra (t_source); validator chặn ngưỡng đảo chiều / sai độ dài / sai kho;
//   (c) so kỳ dịch đúng khoảng (kỳ liền trước = cùng số ngày; cùng kỳ năm trước = lùi 1 năm); KPI ảnh chụp tồn
//       không có kỳ so;
//   (d) phạm vi kho + quyền: tài khoản kho lẻ không xem kho khác, không sửa mục tiêu mặc định; thiếu
//       warehouse_cost.view thì KPI tiền biến mất khỏi payload.
// An toàn: chỉ đụng cờ SystemSetting `kpi_targets` (lưu bản cũ, TRẢ LẠI ở finally) + tài khoản QA55 tự tạo rồi xoá.
import { api, login, restAll, restWrite, check, finish, resolveFixtures, HAS_DB, FIX, BASE } from './lib.mjs'
import { randomUUID } from 'crypto'

if (!HAS_DB) { console.error('Thiếu backend/.env — gói 55 cần soi DB'); process.exit(1) }

const T = 'QA55'
const WH = FIX.WH_QR.id
const now = () => new Date().toISOString()
const err = r => `${r.j?.error?.code ?? ''} ${(r.j?.error?.message ?? '').slice(0, 90)}`.trim()
const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps * Math.max(1, Math.abs(Number(b)))

console.log('── GÓI 55: Tab KPI — công thức · mục tiêu 3 tầng · so kỳ · xu hướng · phạm vi & quyền ──')
await login()
await resolveFixtures()

// Kỳ thử: tháng trước (có dữ liệu chuyến/công trên staging)
const t0 = new Date(); const y = t0.getUTCFullYear(), m = t0.getUTCMonth()
const pad = n => String(n).padStart(2, '0')
const FROM = `${new Date(Date.UTC(y, m - 1, 1)).getUTCFullYear()}-${pad(new Date(Date.UTC(y, m - 1, 1)).getUTCMonth() + 1)}-01`
const TO = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
const q = (extra = '') => `/wms/kpi?date_from=${FROM}&date_to=${TO}${extra}`

async function wipe() {
  for (const e of await restAll('Employee', `select=id&employee_code=like.${T}*`)) {
    await restWrite('UserWarehouseAccess', 'DELETE', `employee_id=eq.${e.id}`).catch(() => {})
    await restWrite('Employee', 'DELETE', `id=eq.${e.id}`).catch(() => {})
  }
  await restWrite('JobTitle', 'DELETE', `name=like.${T}*`).catch(() => {})
  await restWrite('auth_login_events', 'DELETE', `email=like.${T.toLowerCase()}*`).catch(() => {})
}
await wipe()
const beforeRows = await restAll('SystemSetting', 'select=key,value,updated_by,updated_at&key=eq.kpi_targets')
const before = beforeRows[0] ?? null

/** Tạo tài khoản ASSIGNED kho Bluestar với bộ quyền cho trước; trả hàm gọi API bằng token của nó (null nếu không có bcrypt). */
async function scopedAccount(suffix, perms) {
  let bcrypt = null
  try { bcrypt = await import('../../backend/node_modules/bcrypt/bcrypt.js').then(x => x.default ?? x) } catch { /* chưa npm i backend */ }
  if (!bcrypt) return null
  const jid = randomUUID(), eid = randomUUID(), pw = 'Qa' + randomUUID().slice(0, 10) + '!'
  const email = `${T.toLowerCase()}${suffix}@test.local`
  await restWrite('JobTitle', 'POST', '', [{ id: jid, name: `${T} chuc danh ${suffix}`, updated_at: now(), module_permissions: perms }])
  await restWrite('Employee', 'POST', '', [{ id: eid, employee_code: `${T}${suffix}`, name: `${T} nv ${suffix}`, email,
    password: await bcrypt.hash(pw, 10), is_active: true, job_title_id: jid, warehouse_id: FIX.WH_QTY.id, warehouse_scope: 'ASSIGNED', updated_at: now() }])
  await restWrite('UserWarehouseAccess', 'POST', '', [{ id: randomUUID(), employee_id: eid, warehouse_id: FIX.WH_QTY.id }])
  const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })
  const tk = (await lr.json().catch(() => null))?.data?.token
  if (!tk) return null
  return async (path, method = 'GET', body) => {
    const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined })
    let j = null; try { j = JSON.parse(await r.text()) } catch { /* không JSON */ }
    return { s: r.status, j }
  }
}

try {
  // ═══ [1] GET /wms/kpi — cấu trúc + oracle công thức ═══
  let r = await api(q())
  const D = r.j?.data
  check('[1a] GET kpi → 200 + defs/kpis/unavailable/groups/by_warehouse/notes', r.s === 200 && Array.isArray(D?.defs) && Array.isArray(D?.kpis) && Array.isArray(D?.unavailable) && Array.isArray(D?.groups) && Array.isArray(D?.by_warehouse) && D?.notes,
    `http=${r.s} defs=${D?.defs?.length} kpis=${D?.kpis?.length} un=${D?.unavailable?.length}`)
  // 27 đo được + 13 chưa có nguồn = ĐÚNG 40 dòng của file Master List; số thứ tự không được trùng giữa 2 danh sách
  const nos = new Set([...(D?.defs ?? []).map(d => d.no), ...(D?.unavailable ?? []).map(u => u.no)])
  check('[1b] 27 KPI đo được + 13 chưa có nguồn = 40 dòng file, số thứ tự không trùng, mỗi dòng thiếu nêu "cần gì"',
    D?.defs?.length === 27 && D?.kpis?.length === 27 && D?.unavailable?.length === 13 && nos.size === 40 && D.unavailable.every(u => u.need && u.no),
    `defs=${D?.defs?.length} unavailable=${D?.unavailable?.length} nos=${nos.size}`)
  check('[1c] 6 nhóm, mỗi def thuộc 1 nhóm hợp lệ', D?.groups?.length === 6 && D.defs.every(d => D.groups.some(g => g.key === d.group)))
  const defById = new Map((D?.defs ?? []).map(d => [d.id, d]))
  const bad = (D?.kpis ?? []).filter(k => {
    const okRag = k.rag === null || ['G', 'Y', 'R'].includes(k.rag)
    const consistent = (k.value == null || k.t == null) ? k.rag === null : k.rag !== null
    return !(okRag && consistent)
  })
  check('[1d] Đèn chỉ sáng khi CÓ giá trị VÀ CÓ mục tiêu; ngược lại null', bad.length === 0, bad.map(b => `${b.id}:${b.value}/${b.t}/${b.rag}`).join(' ').slice(0, 120))
  // Oracle: giá trị tự tính lại từ num/den theo kind
  const days = Number(D?.days)
  const mis = (D?.kpis ?? []).filter(k => {
    const d = defById.get(k.id); if (!d || k.value == null) return false
    const n = Number(k.num), de = Number(k.den)
    const exp = d.kind === 'pct' ? 100 * n / de : d.kind === 'ratio' ? n / de : d.kind === 'doh' ? n / (de / days) : 365 / (n / (de / days))
    return !near(k.value, exp)
  })
  check('[1e] ORACLE giá trị = đúng công thức từ {num, den} (pct · ratio · doh · turnover)', mis.length === 0, mis.map(x => x.id).join(','))
  // Oracle: tổng = Σ kho (KPI đếm — otif, không có chi phí chung)
  const sumOtif = (D?.by_warehouse ?? []).reduce((a, w) => { const k = w.kpis.find(x => x.id === 'otif'); return a + Number(k?.den ?? 0) }, 0)
  const totOtif = Number(D?.kpis?.find(k => k.id === 'otif')?.den ?? 0)
  check('[1f] ORACLE tổng chuyến (mẫu số OTIF) = Σ các kho có số liệu', near(sumOtif, totOtif), `Σkho=${sumOtif} tổng=${totOtif}`)
  check('[1g] Mọi dòng theo kho mang đủ KPI cùng id với tổng', (D?.by_warehouse ?? []).every(w => w.kpis.length === D.defs.length), `kho=${D?.by_warehouse?.length}`)
  // Đèn theo kho phải khớp evalRag của chính def (oracle đèn)
  const ragOf = (d, v, t) => {
    if (v == null || !t) return null
    if (d.dir === 'up') return v >= t[0] ? 'G' : v >= t[1] ? 'Y' : 'R'
    if (d.dir === 'down') return v <= t[0] ? 'G' : v <= t[1] ? 'Y' : 'R'
    return v >= t[0] && v <= t[1] ? 'G' : v <= t[2] ? 'Y' : 'R'
  }
  const badRag = [...(D?.kpis ?? []), ...(D?.by_warehouse ?? []).flatMap(w => w.kpis)].filter(k => ragOf(defById.get(k.id), k.value, k.t) !== k.rag)
  check('[1h] ORACLE đèn G/Y/R khớp chiều tốt + ngưỡng (tổng + từng kho)', badRag.length === 0, badRag.map(x => x.id).join(',').slice(0, 100))
  check('[1i] Có ít nhất 1 KPI có dữ liệu trong kỳ (tháng trước) — không phải trang trống', (D?.kpis ?? []).some(k => k.value != null))

  // ═══ [2] So kỳ ═══
  r = await api(q('&compare=prev'))
  const P = r.j?.data
  const prevFrom = new Date(`${FROM}T00:00:00Z`); prevFrom.setUTCDate(prevFrom.getUTCDate() - days)
  const prevTo = new Date(`${FROM}T00:00:00Z`); prevTo.setUTCDate(prevTo.getUTCDate() - 1)
  check('[2a] compare=prev → kỳ liền trước CÙNG SỐ NGÀY, kết thúc ngay trước "từ ngày"', r.s === 200 && P?.compare?.mode === 'prev' && P.compare.from === prevFrom.toISOString().slice(0, 10) && P.compare.to === prevTo.toISOString().slice(0, 10),
    `${P?.compare?.from}→${P?.compare?.to}`)
  check('[2b] KPI ảnh chụp tồn (snapshot) KHÔNG có kỳ so; KPI theo kỳ có delta = value − prev', (P?.kpis ?? []).every(k => {
    const d = defById.get(k.id)
    if (d?.snapshot) return k.prev === null && k.delta === null
    return k.delta === null || near(k.delta, Number(k.value) - Number(k.prev))
  }))
  r = await api(q('&compare=yoy'))
  check('[2c] compare=yoy → lùi đúng 1 năm', r.s === 200 && r.j?.data?.compare?.from === FROM.replace(/^\d{4}/, s => String(Number(s) - 1)) && r.j.data.compare.to === TO.replace(/^\d{4}/, s => String(Number(s) - 1)),
    `${r.j?.data?.compare?.from}→${r.j?.data?.compare?.to}`)
  check('[2d] compare bậy → 400', (await api(q('&compare=abc'))).s === 400)

  // ═══ [3] Tham số bậy → 4xx sạch ═══
  check('[3a] thiếu ngày → 400', (await api('/wms/kpi')).s === 400)
  check('[3b] từ > đến → 400', (await api(`/wms/kpi?date_from=${TO}&date_to=${FROM}`)).s === 400)
  check('[3c] > 400 ngày → 400 có hướng dẫn', (await api('/wms/kpi?date_from=2024-01-01&date_to=2026-01-01')).s === 400)
  r = await api(q('&warehouse_id=khong-ton-tai'))
  check('[3d] warehouse_id rác → 400, không 500', r.s === 400, `http=${r.s} ${err(r)}`)
  r = await api(q(`&warehouse_id=${encodeURIComponent("' or 1=1 --")}`))
  check('[3e] warehouse_id trông như injection → 4xx sạch', r.s >= 400 && r.s < 500, `http=${r.s}`)
  r = await api(q(`&warehouse_id=${WH}`))
  check('[3f] Lọc 1 kho → by_warehouse chỉ kho đó + target_scope = kho', r.s === 200 && (r.j?.data?.by_warehouse ?? []).every(w => w.warehouse_id === WH) && r.j?.data?.target_scope === WH, `n=${r.j?.data?.by_warehouse?.length}`)

  check('[1j] Mọi KPI đo được có empty_hint (thiếu dữ liệu thì nói cần cài đặt gì)', (D?.defs ?? []).every(x => typeof x.empty_hint === 'string' && x.empty_hint.length > 20),
    (D?.defs ?? []).filter(x => !x.empty_hint).map(x => x.id).join(','))

  // ═══ [4] Chuỗi theo chu kỳ (biểu đồ đường thực tế ↔ mục tiêu) ═══
  r = await api(`/wms/kpi/series?grain=month&date_from=${FROM}&date_to=${TO}`)
  let S = r.j?.data
  check('[4a] series grain=month trong 1 tháng → 200, 1 kỳ key YYYY-MM, values cho KPI theo kỳ', r.s === 200 && S?.grain === 'month' && S?.buckets?.length === 1 && /^\d{4}-\d{2}$/.test(S.buckets[0].key) && S.buckets[0].values && typeof S.buckets[0].values === 'object',
    `http=${r.s} n=${S?.buckets?.length} key=${S?.buckets?.[0]?.key} ${err(r)}`)
  check('[4b] series loại KPI ảnh chụp (snapshot) khỏi biểu đồ, có targets cho từng KPI', r.s === 200 && (S?.defs ?? []).every(x => !x.snapshot) && (S?.defs ?? []).length > 0 && S.defs.every(x => x.id in (S.targets ?? {})), `defs=${S?.defs?.length}`)
  // ORACLE: giá trị 1 kỳ tháng của series = giá trị GET /kpi cùng khoảng (cùng một RPC, cùng công thức)
  {
    const kOtif = D?.kpis?.find(k => k.id === 'otif')
    const sOtif = S?.buckets?.[0]?.values?.otif
    check('[4c] ORACLE series(1 tháng).otif = GET kpi(cùng tháng).otif', (kOtif?.value == null && sOtif == null) || near(kOtif?.value, sOtif), `kpi=${kOtif?.value} series=${sOtif}`)
  }
  r = await api(`/wms/kpi/series?grain=week&date_from=${FROM}&date_to=${TO}`)
  S = r.j?.data
  check('[4d] grain=week → key YYYY-Www, kỳ thứ Hai→Chủ nhật (7 ngày), tăng dần', r.s === 200 && (S?.buckets ?? []).length >= 4 && S.buckets.every(b => /^\d{4}-W\d{2}$/.test(b.key) && b.days === 7) && S.buckets.every((b, i, a) => !i || b.key > a[i - 1].key),
    `http=${r.s} n=${S?.buckets?.length} first=${S?.buckets?.[0]?.key}/${S?.buckets?.[0]?.from} ${err(r)}`)
  r = await api(`/wms/kpi/series?grain=day&date_from=${FROM}&date_to=${TO}`)
  check('[4e] grain=day cả tháng → số kỳ = số ngày', r.s === 200 && r.j?.data?.buckets?.length === days, `http=${r.s} n=${r.j?.data?.buckets?.length} days=${days} ${err(r)}`)
  r = await api(`/wms/kpi/series?grain=year&date_from=2025-01-01&date_to=${TO}`)
  check('[4f] grain=year → 2 kỳ 2025, 2026', r.s === 200 && r.j?.data?.buckets?.map(b => b.key).join(',') === `2025,${TO.slice(0, 4)}`, `http=${r.s} keys=${r.j?.data?.buckets?.map(b => b.key)}`)
  r = await api(`/wms/kpi/series?grain=month&date_from=${FROM}&date_to=${TO}&compare=prev`)
  check('[4g] series compare=prev → compare.buckets cùng số kỳ, khoảng dịch về trước', r.s === 200 && r.j?.data?.compare?.buckets?.length === 1 && r.j.data.compare.to < FROM, `http=${r.s} cmp=${r.j?.data?.compare?.from}→${r.j?.data?.compare?.to}`)
  check('[4h] grain bậy → 400', (await api(`/wms/kpi/series?grain=quarter&date_from=${FROM}&date_to=${TO}`)).s === 400)
  r = await api('/wms/kpi/series?grain=day&date_from=2026-01-01&date_to=2026-06-30')
  check('[4i] Quá 60 kỳ (181 ngày theo ngày) → 400 TOO_MANY_BUCKETS có hướng dẫn, không chờ timeout', r.s === 400 && r.j?.error?.code === 'TOO_MANY_BUCKETS', `http=${r.s} ${err(r)}`)
  check('[4j] series thiếu ngày → 400', (await api('/wms/kpi/series?grain=month')).s === 400)

  // ═══ [5] Mục tiêu 3 tầng: mặc định → công ty → riêng kho ═══
  r = await api('/wms/kpi/targets')
  check('[5a] GET targets → 200 + default/by_warehouse/params/defs', r.s === 200 && r.j?.data?.default && r.j.data.by_warehouse && r.j.data.params && Array.isArray(r.j.data.defs), `http=${r.s}`)
  r = await api('/wms/kpi/targets', 'PUT', { warehouse_id: null, targets: { otif: [99, 97], doh: [20, 30, 40] }, params: { slow_days: 60, dead_days: 120 } })
  check('[5b] PUT mặc định công ty (otif 99/97, doh dải 20–30–40, ngưỡng chậm 60/120) → 200', r.s === 200 && r.j?.data?.default?.otif?.[0] === 99 && r.j.data.params.slow_days === 60, `http=${r.s} ${err(r)}`)
  r = await api(q())
  let k = r.j?.data?.kpis?.find(x => x.id === 'otif')
  check('[5c] GET kpi: otif dùng mục tiêu CÔNG TY [99,97], t_source=global; ngưỡng chậm 60 ngày lọt xuống RPC', k?.t?.[0] === 99 && k?.t_source === 'global' && r.j?.data?.slow_days === 60, `t=${JSON.stringify(k?.t)} src=${k?.t_source} slow=${r.j?.data?.slow_days}`)
  k = r.j?.data?.kpis?.find(x => x.id === 'fill')
  check('[5d] KPI không đặt → vẫn dùng mặc định bộ KPI (fill 98/95, t_source=default)', k?.t?.[0] === 98 && k?.t_source === 'default', `t=${JSON.stringify(k?.t)} src=${k?.t_source}`)
  r = await api('/wms/kpi/targets', 'PUT', { warehouse_id: WH, targets: { otif: null, fill: [97, 90] } })
  check('[5e] PUT riêng kho Ba Vì (otif: không đặt · fill 97/90) → 200', r.s === 200 && r.j?.data?.by_warehouse?.[WH]?.fill?.[0] === 97 && r.j.data.by_warehouse[WH].otif === null, `http=${r.s} ${err(r)}`)
  r = await api(q(`&warehouse_id=${WH}`))
  const kO = r.j?.data?.kpis?.find(x => x.id === 'otif'), kF = r.j?.data?.kpis?.find(x => x.id === 'fill')
  check('[5f] Xem kho Ba Vì: otif KHÔNG mục tiêu (đèn null, t_source=warehouse) · fill 97/90 riêng kho', kO?.t === null && kO?.rag === null && kO?.t_source === 'warehouse' && kF?.t?.[0] === 97 && kF?.t_source === 'warehouse',
    `otif=${JSON.stringify(kO?.t)}/${kO?.rag}/${kO?.t_source} fill=${JSON.stringify(kF?.t)}/${kF?.t_source}`)
  r = await api(q())
  k = r.j?.data?.kpis?.find(x => x.id === 'otif')
  const rowBV = r.j?.data?.by_warehouse?.find(w => w.warehouse_id === WH)
  check('[5g] Xem toàn công ty: tổng dùng mục tiêu công ty [99,97]; dòng kho Ba Vì trong bảng theo mục tiêu RIÊNG kho', k?.t?.[0] === 99 && k?.t_source === 'global' && (!rowBV || rowBV.kpis.find(x => x.id === 'fill')?.t_source === 'warehouse'),
    `tổng=${JSON.stringify(k?.t)} bavi=${rowBV ? rowBV.kpis.find(x => x.id === 'fill')?.t_source : 'không có dòng'}`)
  r = await api('/wms/kpi/targets', 'PUT', { warehouse_id: WH, targets: {} })
  check('[5h] PUT riêng kho = {} → gỡ ghi đè, kho về theo công ty', r.s === 200 && !(WH in (r.j?.data?.by_warehouse ?? {})), `http=${r.s}`)
  r = await api(q(`&warehouse_id=${WH}`))
  k = r.j?.data?.kpis?.find(x => x.id === 'otif')
  check('[5i] Sau khi gỡ: kho Ba Vì dùng lại mục tiêu công ty (t_source=global)', k?.t?.[0] === 99 && k?.t_source === 'global', `src=${k?.t_source}`)

  // Validator
  for (const [label, body] of [
    ['KPI lạ', { warehouse_id: null, targets: { khong_co: [1, 2] } }],
    ['otif đảo chiều (xanh < vàng dù cao hơn là tốt)', { warehouse_id: null, targets: { otif: [90, 95] } }],
    ['ot_rate đảo chiều (xanh > vàng dù thấp hơn là tốt)', { warehouse_id: null, targets: { ot_rate: [10, 5] } }],
    ['dải util_zone sai thứ tự', { warehouse_id: null, targets: { util_zone: [80, 70, 90] } }],
    ['otif 3 ngưỡng (cần 2)', { warehouse_id: null, targets: { otif: [99, 97, 90] } }],
    ['ngưỡng là chữ', { warehouse_id: null, targets: { otif: ['a', 'b'] } }],
    ['% quá 100', { warehouse_id: null, targets: { otif: [120, 97] } }],
    ['ngưỡng âm', { warehouse_id: null, targets: { loading: [-5, 90] } }],
    ['targets không phải object', { warehouse_id: null, targets: [1, 2] }],
    ['params ở phạm vi kho', { warehouse_id: WH, targets: {}, params: { slow_days: 60, dead_days: 120 } }],
    ['params chậm > không luân chuyển', { warehouse_id: null, targets: {}, params: { slow_days: 200, dead_days: 120 } }],
    ['params không nguyên', { warehouse_id: null, targets: {}, params: { slow_days: 60.5, dead_days: 120 } }],
    ['warehouse_id rác', { warehouse_id: 'khong-ton-tai', targets: { otif: [99, 97] } }],
    ['warehouse_id là số', { warehouse_id: 123, targets: {} }],
  ]) {
    r = await api('/wms/kpi/targets', 'PUT', body)
    check(`[5j] PUT bậy: ${label} → 400`, r.s === 400, `http=${r.s} ${err(r)}`)
  }
  r = await api('/wms/settings/kpi_targets', 'PUT', { value: { default: {} } })
  check('[5k] Đường chung PUT /wms/settings/kpi_targets bị chặn (UNKNOWN_SETTING) — chỉ đi route có quyền riêng', r.s === 400 && r.j?.error?.code === 'UNKNOWN_SETTING', `http=${r.s} ${err(r)}`)
  const audit = await restAll('admin_audit_events', `select=id,action,target_id,created_at&target_id=eq.kpi_targets&order=created_at.desc&limit=3`)
  check('[5l] Đổi mục tiêu có vết trong Nhật ký quản trị (SETTING_UPDATE · kpi_targets)', audit.length >= 1 && audit[0].action === 'SETTING_UPDATE', `n=${audit.length}`)
  check('[5m] Bảo toàn: mục tiêu công ty vừa lưu vẫn còn sau các PUT bậy', (await api('/wms/kpi/targets')).j?.data?.default?.otif?.[0] === 99)

  // ═══ [6] Phạm vi kho + quyền ═══
  const viewer = await scopedAccount('01', { dashboard: ['view'] })
  if (!viewer) console.log('  ⏭  không load được bcrypt của backend — bỏ qua phép kiểm PHẠM VI/QUYỀN')
  else {
    r = await viewer(q())
    check('[6a] Tài khoản kho lẻ (chỉ dashboard.view): GET kpi → 200, chỉ kho mình, KHÔNG có KPI tiền (cost_case), cost_hidden=true',
      r.s === 200 && (r.j?.data?.by_warehouse ?? []).every(w => w.warehouse_id === FIX.WH_QTY.id) && !(r.j?.data?.defs ?? []).some(d => d.id === 'cost_case') && r.j?.data?.notes?.cost_hidden === true,
      `http=${r.s} kho=${r.j?.data?.by_warehouse?.map(w => w.warehouse_name)} cost_hidden=${r.j?.data?.notes?.cost_hidden}`)
    r = await viewer(q(`&warehouse_id=${WH}`))
    check('[6b] Kho lẻ xin kho Ba Vì → 403', r.s === 403, `http=${r.s} ${err(r)}`)
    r = await viewer('/wms/kpi/targets', 'PUT', { warehouse_id: FIX.WH_QTY.id, targets: { otif: [95, 90] } })
    check('[6c] Không có dashboard.kpi_target → PUT 403', r.s === 403, `http=${r.s}`)
    const setter = await scopedAccount('02', { dashboard: ['view', 'kpi_target'] })
    if (setter) {
      r = await setter('/wms/kpi/targets', 'PUT', { warehouse_id: null, targets: { otif: [95, 90] } })
      check('[6d] Kho lẻ có kpi_target sửa mục tiêu MẶC ĐỊNH công ty → 403 SCOPE_LIMITED', r.s === 403, `http=${r.s} ${err(r)}`)
      r = await setter('/wms/kpi/targets', 'PUT', { warehouse_id: WH, targets: { otif: [95, 90] } })
      check('[6e] Kho lẻ đặt mục tiêu cho kho KHÁC → 403', r.s === 403, `http=${r.s} ${err(r)}`)
      r = await setter('/wms/kpi/targets', 'PUT', { warehouse_id: FIX.WH_QTY.id, targets: { otif: [95, 90] } })
      check('[6f] Kho lẻ đặt mục tiêu cho ĐÚNG kho mình → 200', r.s === 200 && r.j?.data?.by_warehouse?.[FIX.WH_QTY.id]?.otif?.[0] === 95, `http=${r.s} ${err(r)}`)
      r = await setter('/wms/kpi/targets')
      check('[6g] Kho lẻ GET targets chỉ thấy ghi đè của kho mình', r.s === 200 && Object.keys(r.j?.data?.by_warehouse ?? {}).every(kk => kk === FIX.WH_QTY.id), `keys=${Object.keys(r.j?.data?.by_warehouse ?? {}).length}`)
    }
  }
  // Không có token → 401
  const anon = await fetch(`${BASE}/api/wms/kpi?date_from=${FROM}&date_to=${TO}`)
  check('[7] Thiếu token → 401', anon.status === 401, `http=${anon.status}`)
} finally {
  // ═══ TRẢ LẠI cờ kpi_targets như trước + dọn tài khoản ═══
  if (before) await restWrite('SystemSetting', 'PATCH', 'key=eq.kpi_targets', { value: before.value, updated_by: before.updated_by, updated_at: before.updated_at }).catch(() => {})
  else await restWrite('SystemSetting', 'DELETE', 'key=eq.kpi_targets').catch(() => {})
  await wipe()
  const after = await restAll('SystemSetting', 'select=value&key=eq.kpi_targets')
  check('[9] Dọn: cờ kpi_targets trả về đúng trạng thái trước khi chạy', before ? JSON.stringify(after[0]?.value) === JSON.stringify(before.value) : after.length === 0)
  check('[9b] Dọn: 0 tài khoản QA55 còn lại', (await restAll('Employee', `select=id&employee_code=like.${T}*`)).length === 0)
}
finish('55-kpi')
