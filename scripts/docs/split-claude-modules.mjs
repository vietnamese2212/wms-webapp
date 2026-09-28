// Tách bảng "Bản đồ module → trang" của CLAUDE.md ra docs/modules/<key>.md (28/09/2026, user duyệt: CLAUDE.md 264 nghìn ký tự,
// bảng module chiếm 66 % — luật cốt tử bị chìm, và cả khối được đọc lại ở MỌI phiên). Chạy MỘT LẦN; nội dung mỗi dòng bảng
// được chép NGUYÊN VĂN vào file module, CLAUDE.md giữ bảng gọn (trang · quyền · link). Mục "Giao thoa với" dựng tự động
// từ việc module này NHẮC TỚI module kia (và ngược lại) — kiểm tra hai chiều bằng scripts/docs/check-modules.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

const CLAUDE = 'CLAUDE.md'
const s = readFileSync(CLAUDE, 'utf8')
const lines = s.split('\n')
const perm = readFileSync('backend/src/config/permissions.ts', 'utf8')
const ACTIONS = Object.fromEntries([...perm.matchAll(/^\s+([a-z_]+):\s*\[([^\]]*)\]/gm)].map(m => [m[1], [...m[2].matchAll(/'([a-z_]+)'/g)].map(x => x[1])]))

// Tên trang ngắn cho bảng gọn (chi tiết nằm trong file module)
const PAGE = {
  inventory: 'Tồn kho (+ Sổ pallet)', inbound: 'Nhập kho', outbound: 'Xuất kho · Chốt %Date · Quy định date (4 rule Bắt đầu chuyến, dẫn xuất từ SAP)',
  scanlog: 'Lịch sử quét', traceability: 'Truy xuất lô (menu Báo cáo)', loosepicking: 'Nhặt lẻ (+ Tối ưu tuyến)', stocktake: 'Kiểm kho (4 tab, Luân phiên ABC)',
  locations: 'Vị trí kho (+ tab Sơ đồ kho)', materials: 'Mã hàng (+ Nhà sản xuất)', customers: 'Khách hàng (menu Cấu hình) — kênh · mức date',
  external_do_sap: 'Dữ liệu bên ngoài → DO SAP · Chưa có OD (ZSD02 / VL06O)', pallet_print: 'In tem pallet', pallet_ops: 'Dồn / Tách pallet',
  wms_settings: 'Cài đặt WMS (kho, loại kho, ĐK bảo quản, khu, ca, QA, máy, hệ thống)', employees: 'Sơ đồ tổ chức', user_admin: 'Quản lý người dùng (+ Nhật ký)',
  work_skill: 'trong Quản lý người dùng', schedule: 'Lịch làm việc', work_assignment: 'Phân công (Layout · Quy tắc ca)', attendance: 'Chấm công',
  leave: 'Chấm công → tab Nghỉ phép', tms_plan: 'TMS Bookings (Đặt lịch · Chuyển kho)', tms_vehicle_types: 'Cài đặt TMS — Loại xe + Mã dòng xe',
  freight: 'Cước vận chuyển (menu TMS)', dispatch: 'Điều vận (menu TMS)', tms_slots: 'Cài đặt TMS — Khung giờ', tms_companies: 'Cài đặt TMS — ĐVVT / NCC',
  tms_vehicles: 'Cài đặt TMS — Xe', gate_registration: 'Đăng ký cổng', weigh_station: 'Phiếu cân', dashboard: 'Tổng quan (+ tab KPI, Dịch vụ)',
  warehouse_cost: 'Chi phí kho', control_tower: 'Giám sát vận hành', alerts: 'Thông báo + nút chuông', slotting: 'Tối ưu vị trí',
  warehouse_map: 'Sơ đồ kho (tab của Vị trí kho)', directed_work: 'Việc cần làm (+ Hộp việc)', fill: 'Fill hàng', forklift: 'Xe nâng (check list)',
  packing: 'Sổ đóng gói', inbound_plan: 'trong TMS Bookings (tab Kế hoạch)',
  external_khvc: 'Dữ liệu bên ngoài → Kế hoạch xuất',
}
// Cụm chữ đặc trưng của từng module để dò "module A nhắc tới module B" (ngoài mã module trong dấu `…` / `key.action`).
// Chỉ lấy cụm KHÔNG mơ hồ — "xe nâng" là vai trò chứ không phải module check list; "tồn kho" nhắc ở gần như mọi dòng nên chỉ dò bằng mã.
const LABELS = {
  outbound: ['Xuất kho', 'Chốt %Date', 'Quy định date'], loosepicking: ['Nhặt lẻ', 'Tối ưu tuyến'], fill: ['Fill hàng', 'lệnh fill', 'FillTask'],
  directed_work: ['Việc cần làm', 'Hộp việc', 'wms_tasks'], dispatch: ['Điều vận', 'bàn ghép xe', 'Bàn ghép xe'], freight: ['Cước vận chuyển', 'bảng cước', 'freightEstimate'],
  external_do_sap: ['ZSD02', 'VL06O', 'DO SAP', 'erp_outbound_orders'], external_khvc: ['Kế hoạch xuất', 'khvc_lines'], customers: ['Khách hàng', 'date_rule_master'],
  warehouse_map: ['Sơ đồ kho'], slotting: ['Tối ưu vị trí', 'Slotting'], packing: ['Sổ đóng gói'], gate_registration: ['Đăng ký cổng'], weigh_station: ['Phiếu cân'],
  tms_vehicle_types: ['Mã dòng xe', 'vehicle_model'], tms_plan: ['TMS Bookings', 'lệnh VC', 'lệnh vận chuyển', 'TmsOrder'], tms_slots: ['Khung giờ'],
  tms_companies: ['TransportCompany'], stocktake: ['Kiểm kho', 'Kiểm kê'], pallet_ops: ['Dồn / Tách', 'Tách pallet', 'Dồn pallet'], pallet_print: ['In tem pallet'],
  traceability: ['Truy xuất lô'], warehouse_cost: ['Chi phí kho'], control_tower: ['Giám sát vận hành'], alerts: ['alertScanner', 'nút chuông'],
  locations: ['Vị trí kho'], wms_settings: ['Cài đặt WMS'], inbound: ['Nhập kho'], inventory: ['InventoryEntry', 'pallet_ledger'], dashboard: ['tab KPI', 'Tổng quan'],
}

const start = lines.findIndex(l => l.startsWith('| Module key |'))
if (start < 0) throw new Error('không thấy bảng module (đã tách rồi?)')
let end = start + 2
while (end < lines.length && lines[end].startsWith('| `')) end++
const rows = lines.slice(start + 2, end).map(l => {
  const cells = l.slice(2, -2).split(/(?<!\\) \| /)
  if (cells.length < 4) throw new Error(`dòng không đủ 4 ô: ${l.slice(0, 80)} (${cells.length})`)
  // chữ trong ô có thể chứa ' | ' (vd `PALLET | LOOSE` trong ô Trang của dispatch, `'off' | 'optional'` trong ô Actions của
  // wms_settings) ⇒ ô Actions = ô CUỐI CÙNG bắt đầu bằng "view" (mọi dòng bảng đều mở đầu danh sách quyền bằng view)
  let a = cells.length - 1
  for (let i = cells.length - 1; i >= 3; i--) if (/^view\b/.test(cells[i])) { a = i; break }
  if (cells.length > 4) console.log(`  ${cells[0]}: ${cells.length} ô — Trang = ô 2..${a - 1}, Actions = ô ${a}..${cells.length - 1}`)
  return { key: cells[0].replace(/`/g, ''), label: cells[1], page: cells.slice(2, a).join(' | '), actions: cells.slice(a).join(' | '), raw: l }
})
const all = [...rows]
if (!rows.some(r => r.key === 'external_khvc')) all.push({ key: 'external_khvc', label: 'Dữ liệu bên ngoài → Kế hoạch xuất', page: '', actions: '', raw: '' })

// A nhắc tới B
const text = r => `${r.page}\n${r.actions}`
const mentions = new Map(all.map(r => [r.key, new Set()]))
for (const a of all) {
  const t = text(a)
  for (const b of all) {
    if (a.key === b.key) continue
    const hit = new RegExp(`\`${b.key}\`|\\b${b.key}\\.[a-z_]+`).test(t) || (LABELS[b.key] ?? []).some(p => t.includes(p))
    if (hit) mentions.get(a.key).add(b.key)
  }
}
// external_khvc không có dòng riêng: luật của nó nằm ở outbound/dispatch/tms_plan — nối tay
for (const k of ['outbound', 'dispatch', 'tms_plan']) mentions.get('external_khvc').add(k)
// Cặp giao thoa THẬT mà chữ không nhắc tên nhau (dò chữ bỏ sót) — nối tay, kèm lý do
const EXTRA = [
  ['outbound', 'inventory'],        // quét xuất / nhặt lẻ / Xuất luôn trừ tồn InventoryEntry
  ['loosepicking', 'inventory'],    // xác nhận nhặt lẻ trừ tồn base
  ['inbound', 'inventory'],         // quét nhập sinh InventoryEntry
  ['stocktake', 'inventory'],       // kiểm kê đặt stocktake_at, điều chỉnh tồn
  ['pallet_ops', 'inventory'],      // dồn / tách ghi InventoryEntry
  ['slotting', 'inventory'],        // quét chuyển vị trí đổi location_id
  ['packing', 'inbound'],           // đối chiếu sổ SX ↔ kho quét nhập
  ['warehouse_map', 'locations'],   // bản vẽ là của chính các vị trí
  ['outbound', 'wms_settings'],     // 4 rule Bắt đầu chuyến + luân chuyển khai ở form Kho
  ['dispatch', 'wms_settings'],     // ĐK bảo quản theo Loại kho + tham số Điều vận ở form Kho
  ['freight', 'tms_vehicle_types'], // cước khoá theo dòng xe con
  ['freight', 'tms_companies'],     // cước theo ĐVVT
  ['employees', 'user_admin'], ['work_skill', 'user_admin'], ['schedule', 'work_assignment'], ['attendance', 'leave'],
]
for (const [a, b] of EXTRA) { mentions.get(a).add(b); mentions.get(b).add(a) }

const labelOf = k => all.find(r => r.key === k)?.label ?? k
mkdirSync('docs/modules', { recursive: true })
const unesc = x => x.replace(/\\\|/g, '|')
for (const r of all) {
  const out = mentions.get(r.key), inn = [...mentions].filter(([k, set]) => set.has(r.key)).map(([k]) => k)
  const rel = [...new Set([...out, ...inn])].sort()
  const giao = rel.map(k => `- [\`${k}\`](${k}.md) — ${labelOf(k)} (${out.has(k) && inn.includes(k) ? 'hai chiều' : out.has(k) ? 'file này nhắc tới' : 'được nhắc tới từ đó'})`).join('\n')
  const body = [
    `# ${r.label} (\`${r.key}\`)`,
    '',
    '> Tách từ CLAUDE.md (bảng "Bản đồ module → trang") ngày 28/09/2026 — nội dung bên dưới giữ NGUYÊN VĂN. Luật riêng của module này sửa Ở ĐÂY; luật dùng chung nhiều module ở CLAUDE.md (mục "Giao thoa giữa các module").',
    '> **Trước khi sửa module này: đọc file này + mọi file ở mục "Giao thoa với".**',
    '',
    `**Trang:** ${PAGE[r.key] ?? r.key}`,
    '',
    `**Quyền (BE \`ALL_PERMISSIONS\`):** ${ACTIONS[r.key]?.join(' · ') ?? '_(không có trong backend/src/config/permissions.ts — dòng bảng cũ, xem lại)_'}`,
    '',
    '## Giao thoa với',
    '<!-- giao-thoa:start -->',
    giao || '_(chưa ghi nhận)_',
    '<!-- giao-thoa:end -->',
    '',
    '## Trang / nghiệp vụ',
    '',
    r.page ? unesc(r.page) : '_Không có dòng riêng trong bảng cũ — luật của Kế hoạch xuất nằm ở [`outbound`](outbound.md) (XUẤT = KẾT QUẢ DẪN XUẤT, KẾ HOẠCH ĐI TRƯỚC SAP), [`dispatch`](dispatch.md) (Xác nhận ghi khvc_lines) và [`tms_plan`](tms_plan.md) (lệnh VC tự sinh)._',
    '',
    '## Actions',
    '',
    r.actions ? unesc(r.actions) : (ACTIONS[r.key] ?? []).join(', '),
    '',
  ].join('\n')
  writeFileSync(`docs/modules/${r.key}.md`, body)
}

// Bảng gọn thay cho bảng cũ
const compact = [
  '| Module key | Nhãn (bảng quyền) | Trang / Menu | Actions (theo `ALL_PERMISSIONS`) | Chi tiết |',
  '|---|---|---|---|---|',
  ...all.map(r => `| \`${r.key}\` | ${r.label} | ${PAGE[r.key] ?? ''} | ${ACTIONS[r.key]?.join(', ') ?? '_(không có trong config)_'} | [docs/modules/${r.key}.md](docs/modules/${r.key}.md) |`),
]
const note = '> **Chi tiết từng module (luật · lý do · số đo · gói QA) nằm ở `docs/modules/<key>.md`** — tách 28/09/2026, nguyên văn. Sửa module nào: đọc file của module đó **và mọi file trong mục "Giao thoa với"** của nó (bản đồ dựng hai chiều, `node scripts/docs/check-modules.mjs` kiểm). Thêm module mới: thêm dòng bảng này + file module + nối "Giao thoa với" hai phía.'
lines.splice(start, end - start, note, '', ...compact)
writeFileSync(CLAUDE, lines.join('\n'))
console.log(`tách ${rows.length} dòng bảng (+${all.length - rows.length} module không có dòng) → docs/modules; CLAUDE.md ${s.length} → ${lines.join('\n').length} ký tự`)
const chars = all.reduce((n, r) => n + r.page.length + r.actions.length, 0)
console.log(`nội dung bảng cũ ${chars} ký tự; mọi file module có đủ nguyên văn: ${all.every(r => { const f = readFileSync(`docs/modules/${r.key}.md`, 'utf8'); return f.includes(unesc(r.page)) && f.includes(unesc(r.actions)) })}`)
