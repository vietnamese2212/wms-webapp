// CHẠY BỘ KIỂM — 3 BẬC (11/09/2026):
//   --tier fast  (~5')   mỗi push dev: cổng tĩnh + audit + TEST ĐƠN VỊ/MIRROR + độ phủ + invariant + smoke + fuzz + perm
//   --tier full  (mặc định, ~1h) đêm theo lịch (.github/workflows/qa-nightly.yml) hoặc tay trước khi merge main:
//                toàn bộ 57 gói nghiệp vụ; XANH toàn bộ mới được merge.
//   --scale [N]  thêm gói scale (seed N đơn + dọn) — chạy tay, không ghi vào lịch.
//   --offline    chỉ các bước KHÔNG cần server/DB (cổng tĩnh + audit + npm test + độ phủ) — máy dev không có
//                tài khoản QA vẫn chạy được; KHÔNG đoán mật khẩu (auth_throttle khoá 10 lần sai/15').
// Exit 0 = XANH. Exit 1 = có FAIL. Gói tải 05-rush · 06-readload nằm NGOÀI cả 3 bậc (chạy tay ngoài giờ).
// usage: node scripts/qa/run-all.mjs [--tier fast|full] [--offline] [--scale [N]]
import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(DIR, '..', '..')
const argv = process.argv
const tierIdx = argv.indexOf('--tier')
const TIER = tierIdx > 0 ? argv[tierIdx + 1] : 'full'
if (!['fast', 'full'].includes(TIER)) { console.error(`--tier phải là fast|full (nhận "${TIER}")`); process.exit(2) }
const withScale = argv.includes('--scale')
const scaleN = argv[argv.indexOf('--scale') + 1]

// Bước = file gói QA (chạy bằng node) hoặc lệnh riêng { label, cmd, args, cwd }
const qa = (file, ...args) => ({ label: `${file} ${args.join(' ')}`.trim(), cmd: process.execPath, args: [join(DIR, file), ...args], cwd: ROOT })
const offline = (step) => ({ ...step, offline: true })
const UNIT = offline({ label: 'backend: npm test (unit + mirror BE⇄FE, không cần DB)', cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test', '--silent'], cwd: join(ROOT, 'backend'), shell: true })
const COVERAGE = offline(qa('coverage-surface.mjs', '--ratchet'))
const STATIC = offline(qa('09-static-gate.mjs'))
const AUDIT = offline(qa('44-npm-audit.mjs'))

const FAST = [
  STATIC,                           // cổng tĩnh ratchet (không cần server) — rẻ nhất, fail nhanh nhất
  AUDIT,                            // lỗ hổng thư viện high/critical không được TĂNG so audit-baseline.json (03/09)
  UNIT,                             // 11/09: helper thuần + mirror BE⇄FE — vài giây, bắt lớp "luật chép tay lệch"
  COVERAGE,                         // 11/09: route/quyền mới chưa gói QA nào chạm → đỏ
  qa('00-invariant.mjs'),
  qa('01-smoke.mjs'),
  qa('07-params-fuzz.mjs'),         // fuzz tham số rỗng/lạ mọi API list (read-only) — bắt 500/dump danh mục/quá 4MB
  qa('08-perm-coverage.mjs'),       // FE⇄BE config khớp + action không ai được cấp (WARN; --strict mới FAIL)
]

const FULL = [
  STATIC,
  AUDIT,
  UNIT,
  COVERAGE,
  qa('00-invariant.mjs'),
  qa('01-smoke.mjs'),
  qa('02-race.mjs'),
  qa('04-qrformat.mjs'),            // test theo cờ HIỆN TẠI (không lật cờ — --flip chạy tay ngoài giờ)
  qa('07-params-fuzz.mjs'),
  qa('10-leftover-location.mjs'),   // pallet xuất không hết PHẢI khai vị trí phần dư (+ rollback khi vị trí đầy)
  qa('11-gate-rules.mjs'),          // 2 rule cổng/cân khi Bắt đầu + các đường lách đã vá
  qa('12-derived-lock.mjs'),        // Xuất = dẫn xuất VL06O+KH xuất: khóa sửa kế hoạch chuyến SAP + CRUD KH tự dội xuống chuyến (02/08)
  qa('13-awaiting-sap.mjs'),        // KH xuất đi TRƯỚC dữ liệu SAP: chuyến CHỜ/bất động, tự kích hoạt, ngừng-hoạt-động thay vì xóa (03/08)
  qa('14-tms-plan-derived.mjs'),    // Kế hoạch VC tự sinh theo Số xe + tự NHẢ khung giờ khi xe bị bỏ khỏi kế hoạch (03/08)
  qa('15-booking-category.mjs'),    // CỬA đặt lịch: bắt buộc khai, 1 Số xe 1 cửa (trigger DB), đặt sai cửa → 422 (03/08)
  qa('16-upload-shape.mjs'),        // biên dạng file THẬT (ô gộp, dòng trùng) + gác upload + thứ tự gác/RPC (04/08)
  qa('17-slot-count-integrity.mjs'),// xoá dòng xe đang giữ chỗ PHẢI đếm lại — không thì khung kẹt "Đầy" (04/08)
  qa('18-fill-replenish.mjs'),      // fill hàng nhặt lẻ: oracle cần/có/thiếu, đua 1 pallet 2 lệnh, quét lệch nguồn/đích đầy (04/08)
  qa('19-push-notify.mjs'),         // Web Push /api/notify: vapid ổn định + RLS kín + subscribe idempotent + endpoint chết được đếm/dọn (06/08)
  qa('20-alerts.mjs'),              // Trung tâm cảnh báo: xuất hiện → dedup → ack/unack → tự đóng → tái mở đợt mới (06/08)
  qa('21-cycle-count.mjs'),         // Kiểm kê luân phiên ABC: hạng từ slotting_stats + oracle due_in tự tính lại (06/08)
  qa('22-packing.mjs'),             // Sổ đóng gói điện tử: mở→đóng→sửa→hủy + đua quét/đóng + luật giờ in phun (11/08)
  qa('23-settings.mjs'),            // Tham số vận hành SystemSetting: round-trip PUT/GET + validator chặn bậy + khôi phục (13/08)
  qa('24-weigh-station.mjs'),       // Nạp phiếu cân NHIỀU trạm: mã trạm bắt buộc + 1 mã ≠ 2 kho + source_id trùng không đè (14/08)
  qa('25-rotation.mjs'),            // Luân chuyển FEFO/FIFO/LIFO: gợi ý ⇄ cảnh báo ⇄ chặn nói CÙNG một luật + van xả có vết (14/08)
  qa('26-putaway.mjs'),             // Quy tắc CẤT hàng: cờ slot_no_in có tác dụng ở luồng nhập + chặn THẬT ở cửa ghi + vết vượt rào (15/08)
  qa('27-pallet-ops.mjs'),          // Dồn/Tách/Gỡ nhóm: bảo toàn tổng tồn + hoàn tác + reserved chặn tách + đua đặt tên .N → 409 sạch (19/08)
  qa('28-transfer-receive.mjs'),    // Chuyển kho 2 chiều: cờ delivery_confirmation + 4 mảnh tự sinh + booking gate + cascade DONE/DELIVERED + oracle 4 tầng (19/08)
  qa('29-wh-type-strategy.mjs'),    // Loại kho theo TỪNG kho + chiến thuật 2 tầng (21/08)
  qa('30-scan-formats.mjs'),        // camera đọc CẢ QR lẫn mã vạch 1D: khai đủ + TÊN format đúng (đọc thật, không cần server) (21/08)
  qa('31-location-scan.mjs'),       // quét TEM VỊ TRÍ: khớp TRỌN mã, mơ hồ thì 409, mọi màn có nút quét (21/08)
  qa('32-booking-sequence.mjs'),    // STT chuẩn bị theo booking: oracle tự tính + số dồn khi hủy + dãy riêng chiều + validate ngày (24/08)
  qa('33-loose-settings.mjs'),      // nhặt lẻ theo KHO+LOẠI: mặc định=hành vi cũ · OFF ép 0 · PM01=ALL · trần thùng biên · validator (24/08)
  qa('34-service-level.mjs'),       // fill rate/OTIF: mức đã hạ KHÔNG cộng lặp khi 1 mã nằm ở 2 NPP + % làm tròn ở nguồn (30/08)
  qa('35-scope-empty.mjs'),         // cấm tài khoản "ASSIGNED mà 0 kho / 0 loại hàng" (30/08)
  qa('36-update-partial.mjs'),      // PUT sửa đơn: body thiếu field không xoá trắng Kho/ĐVVT + PUT bị từ chối không ghi nửa header (31/08)
  qa('37-bodyfuzz.mjs'),            // MỌI route write × body ác ({}, null, [], sai kiểu) + id không tồn tại → không bao giờ 5xx (31/08)
  qa('38-upload-fuzz.mjs'),         // MỌI cửa upload × file ác → 400 sạch, 0 rác DB (31/08)
  qa('39-trace-investigate.mjs'),   // Điều tra theo THÙNG (01/09)
  qa('40-exposure-live.mjs'),       // ĐO SỐNG bằng anon key + vé realtime + token giả: REST/RPC/GraphQL/OpenAPI/Storage/Auth/Realtime phải KÍN (02/09)
  qa('41-idor-scope.mjs'),          // cặp (chuyến, dòng hàng) lệch → 404; tài khoản kho lẻ sửa kho khác → 403 (02/09)
  qa('42-auth-throttle.mjs'),       // dò mật khẩu: khoá theo TÀI KHOẢN ở DB sau 10 lần sai (03/09)
  qa('43-password-policy.mjs'),     // chính sách mật khẩu MỘT nguồn + mở khoá đăng nhập có vết (03/09)
  qa('45-admin-audit-security-alerts.mjs'), // nhật ký quản trị + rule AUTH_LOCKOUT/ADMIN_NEW_IP (03/09)
  qa('46-scan-rowlock.mjs'),        // quét xuất dưới KHOÁ DÒNG (06/09)
  qa('47-inventory-edits.mjs'),     // sửa trên tồn kho (06/09)
  qa('48-location-inbound-edits.mjs'), // vị trí kho + phiếu nhập (06/09)
  qa('49-masterdata-catalog.mjs'),  // danh mục nền (07/09) — 4 gói 49–52 dựng từ BỀ MẶT ĐỌC TỪ CODE
  qa('50-tms-catalog-booking.mjs'), // vận tải (07/09)
  qa('51-hr.mjs'),                  // nhân sự (07/09)
  qa('52-wms-ops.mjs'),             // vận hành kho (07/09)
  qa('53-untouched-routes.mjs'),    // 19 route cuối: cổng ERP (tự cấp khoá), sổ Dồn/Tách theo phạm vi kho, xe nâng, lưới lỗi async (07/09)
  qa('54-warehouse-map.mjs'),       // Sơ đồ kho (08/09)
  qa('55-kpi.mjs'),                 // Tab KPI (08/09)
  qa('56-dock-capacity.mjs'),       // Cửa xuất có sức chứa xe (09/09)
  qa('57-directed-work.mjs'),       // Việc cần làm (10/09)
  qa('58-customer-date-rule.mjs'),  // %Date theo Khách hàng / Kênh: master không lan ngược, khách chưa kênh ⇒ không cấp (11/09)
  qa('08-perm-coverage.mjs'),       // FE⇄BE config khớp + action không ai được cấp (WARN; --strict mới FAIL)
  qa('00-invariant.mjs'),           // sau race + qrformat phải vẫn sạch
  ...(withScale ? [qa('03-scale.mjs', ...(scaleN && !scaleN.startsWith('-') ? [scaleN] : [])), qa('00-invariant.mjs')] : []),
]

const OFFLINE = argv.includes('--offline')
const steps = (TIER === 'fast' ? FAST : FULL).filter(s => !OFFLINE || s.offline)
console.log(`BẬC: ${TIER}${OFFLINE ? ' (offline)' : ''} — ${steps.length} bước`)
const summary = []
for (const s of steps) {
  console.log(`\n════════ ${s.label} ════════`)
  const r = spawnSync(s.cmd, s.args, { stdio: 'inherit', cwd: s.cwd, shell: s.shell === true })
  summary.push({ label: s.label, ok: r.status === 0 })
  if (r.status !== 0 && s.label.startsWith('00-invariant') && summary.filter(x => x.label.startsWith('00-invariant')).length === 1) {
    console.error('\n⛔ Invariant ĐỎ ngay từ đầu — DB staging đang bẩn, xử lý trước rồi hãy test tiếp.')
    process.exit(1)
  }
}

console.log('\n══════════ TỔNG KẾT ══════════')
for (const s of summary) console.log(`  ${s.ok ? '✅' : '❌'} ${s.label}`)
const fails = summary.filter(s => !s.ok).length
// ⚠️ Chế độ --offline CHỈ chạy vài bước không cần DB (cổng tĩnh · audit · npm test · độ phủ).
// Trước 11/09 nó vẫn in "đủ điều kiện merge main" y như bậc full chạy đủ 60 bước — cùng lớp lỗi
// với /api/health luôn trả "ok": đèn xanh nói nhiều hơn những gì nó thật sự đo được.
const verdict = fails
  ? `\n⛔ ${fails} bước FAIL — KHÔNG merge main.`
  : OFFLINE
    ? `\n🟢 XANH ${steps.length} bước KHÔNG CẦN DB — CHƯA kết luận được gì về nghiệp vụ (các gói cần DB chưa chạy).`
    : `\n🟢 XANH toàn bộ (bậc ${TIER})${TIER === 'full' ? ' — đủ điều kiện merge main.' : ' — bậc full vẫn phải xanh trước khi merge.'}`
console.log(verdict)
process.exit(fails ? 1 : 0)
