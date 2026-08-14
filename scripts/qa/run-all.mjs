// CHẠY CẢ BỘ: invariant → smoke → race → invariant (đối chiếu) → [scale nếu --scale] → invariant.
// Exit 0 = XANH (được phép merge main). Exit 1 = có FAIL.
// usage: node scripts/qa/run-all.mjs [--scale [N]]
import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const DIR = dirname(fileURLToPath(import.meta.url))
const withScale = process.argv.includes('--scale')
const scaleN = process.argv[process.argv.indexOf('--scale') + 1]
const steps = [
  ['09-static-gate.mjs'],         // cổng tĩnh ratchet (không cần server) — rẻ nhất, fail nhanh nhất
  ['00-invariant.mjs'],
  ['01-smoke.mjs'],
  ['02-race.mjs'],
  ['04-qrformat.mjs'],            // test theo cờ HIỆN TẠI (không lật cờ — --flip chạy tay ngoài giờ)
  ['07-params-fuzz.mjs'],         // fuzz tham số rỗng/lạ mọi API list (read-only) — bắt 500/dump danh mục/quá 4MB
  ['10-leftover-location.mjs'],   // pallet xuất không hết PHẢI khai vị trí phần dư (+ rollback khi vị trí đầy)
  ['11-gate-rules.mjs'],          // 2 rule cổng/cân khi Bắt đầu + các đường lách đã vá (unstart/PATCH status/sửa xe/quét trước start)
  ['12-derived-lock.mjs'],        // Xuất = dẫn xuất VL06O+KH xuất: khóa sửa kế hoạch chuyến SAP + CRUD KH tự dội xuống chuyến (02/08)
  ['13-awaiting-sap.mjs'],        // KH xuất đi TRƯỚC dữ liệu SAP: chuyến CHỜ/bất động, tự kích hoạt, ngừng-hoạt-động thay vì xóa (03/08)
  ['14-tms-plan-derived.mjs'],    // Kế hoạch VC tự sinh theo Số xe + tự NHẢ khung giờ khi xe bị bỏ khỏi kế hoạch (03/08)
  ['15-booking-category.mjs'],    // CỬA đặt lịch: bắt buộc khai, 1 Số xe 1 cửa (trigger DB), đặt sai cửa → 422 (03/08)
  ['16-upload-shape.mjs'],        // biên dạng file THẬT (ô gộp, dòng trùng) + gác upload + thứ tự gác/RPC (04/08)
  ['17-slot-count-integrity.mjs'],// xoá dòng xe đang giữ chỗ PHẢI đếm lại — không thì khung kẹt "Đầy" (04/08)
  ['18-fill-replenish.mjs'],      // fill hàng nhặt lẻ: oracle cần/có/thiếu, đua 1 pallet 2 lệnh, quét lệch nguồn/đích đầy (04/08)
  ['19-push-notify.mjs'],         // Web Push /api/notify: vapid ổn định + RLS kín + subscribe idempotent + endpoint chết được đếm/dọn (06/08)
  ['20-alerts.mjs'],              // Trung tâm cảnh báo: xuất hiện → dedup → ack/unack → tự đóng → tái mở đợt mới (06/08)
  ['21-cycle-count.mjs'],         // Kiểm kê luân phiên ABC: hạng từ slotting_stats + oracle due_in tự tính lại (06/08)
  ['22-packing.mjs'],             // Sổ đóng gói điện tử: mở→đóng→sửa→hủy + đua quét/đóng + luật giờ in phun (11/08)
  ['23-settings.mjs'],            // Tham số vận hành SystemSetting: round-trip PUT/GET + validator chặn bậy + khôi phục (13/08)
  ['24-weigh-station.mjs'],       // Nạp phiếu cân NHIỀU trạm: mã trạm bắt buộc + 1 mã ≠ 2 kho + source_id trùng không đè (14/08)
  ['08-perm-coverage.mjs'],       // FE⇄BE config khớp + action không ai được cấp (WARN; --strict mới FAIL)
  ['00-invariant.mjs'],           // sau race + qrformat phải vẫn sạch
  ...(withScale ? [['03-scale.mjs', ...(scaleN && !scaleN.startsWith('-') ? [scaleN] : [])], ['00-invariant.mjs']] : []),
]

const summary = []
for (const [file, ...args] of steps) {
  console.log(`\n════════ ${file} ${args.join(' ')} ════════`)
  const r = spawnSync(process.execPath, [join(DIR, file), ...args], { stdio: 'inherit' })
  summary.push({ file, ok: r.status === 0 })
  if (r.status !== 0 && file === '00-invariant.mjs' && summary.length === 1) {
    console.error('\n⛔ Invariant ĐỎ ngay từ đầu — DB staging đang bẩn, xử lý trước rồi hãy test tiếp.')
    process.exit(1)
  }
}

console.log('\n══════════ TỔNG KẾT ══════════')
for (const s of summary) console.log(`  ${s.ok ? '✅' : '❌'} ${s.file}`)
const fails = summary.filter(s => !s.ok).length
console.log(fails ? `\n⛔ ${fails} gói FAIL — KHÔNG merge main.` : '\n🟢 XANH toàn bộ — đủ điều kiện merge main.')
process.exit(fails ? 1 : 0)
