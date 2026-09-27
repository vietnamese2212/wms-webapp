/**
 * TÀI KHOẢN CHẠY BỘ KIỂM TRONG CI — CẤP LÚC CHẠY, XOÁ NGAY SAU ĐÓ.
 *
 * VÌ SAO (user chốt 07/09): trước đây CI đăng nhập bằng một cặp email/mật khẩu chép tay vào GitHub
 * Secrets. Bản chép tay thì lỗi thời vào đúng lúc không ai để ý — đổi mật khẩu trong app là CI đỏ
 * hàng loạt, và mỗi lần chạy lại đốt thêm một lần ĐOÁN SAI lên tài khoản thật (auth_throttle khoá
 * sau 10 lần sai/15 phút). Đo thật 06–07/09: 9 job đỏ liên tiếp cùng một gốc, cộng 2 lần BAD_PASSWORD
 * từ IP máy chủ GitHub sau khi khai lại secret.
 *
 * Nay không còn mật khẩu nào phải giữ đồng bộ: CI đã có KHOÁ DỊCH VỤ (trong secret QA_DATABASE_URL,
 * dùng để soi DB staging), nên nó tự tạo một tài khoản sống vài phút rồi xoá. Đổi mật khẩu ai tuỳ ý,
 * CI không quan tâm.
 *
 * CHỈ DÙNG CHO STAGING. Khoá dịch vụ production không bao giờ được đặt vào CI (luật CLAUDE.md).
 *
 * usage:
 *   node scripts/qa/ci-account.mjs provision   → in ra 2 dòng `email=…` / `password=…` (stdout)
 *   node scripts/qa/ci-account.mjs cleanup     → xoá tài khoản của lượt này + mọi tài khoản CI cũ
 */
import { readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID, randomInt } from 'crypto'
import bcrypt from 'bcryptjs'
// Mốc DB → UTC. Tài khoản CI bị đọc SAI TUỔI chính là thứ làm CI đỏ 25–26/09 — xem utcms.mjs.
// Cố ý KHÔNG import lib.mjs: file đó gắn bộ bắt lỗi toàn cục + có process.exit ở cuối, mà bước
// cấp tài khoản phải để workflow bắt lỗi bằng `||`.
import { utcMs } from './utcms.mjs'

const PREFIX = 'QACI'            // employee_code bắt đầu bằng đây = tài khoản do CI cấp
const MAX_AGE_MS = 2 * 60 * 60 * 1000   // tài khoản CI sống quá 2 giờ = rác của lượt bị huỷ giữa chừng

// ── Kết nối PostgREST bằng khoá dịch vụ (bước trước trong workflow đã ghi backend/.env) ──
function env() {
  const raw = readFileSync(new URL('../../backend/.env', import.meta.url), 'utf8')
  const get = (k) => (raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim()
  const url = get('SUPABASE_URL'), key = get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong backend/.env')
  return { url, key }
}

async function rest(path, init = {}) {
  const { url, key } = env()
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`PostgREST ${r.status} ${path} — ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/** Mật khẩu ngẫu nhiên hợp lệ theo passwordPolicy: ≥10 ký tự, có chữ + số, không chuỗi lặp/liên tiếp. */
function newPassword() {
  const LOW = 'abcdefghijkmnpqrstuvwxyz', UP = 'ABCDEFGHJKLMNPQRSTUVWXYZ', NUM = '23456789', SYM = '@#$%&*'
  const pool = LOW + UP + NUM + SYM
  let s = ''
  while (s.length < 20) {
    const c = pool[randomInt(pool.length)]
    if (c === s[s.length - 1]) continue        // không 2 ký tự giống nhau liền kề
    s += c
  }
  // chắc chắn đủ mặt chữ hoa/thường/số
  return `${UP[randomInt(UP.length)]}${LOW[randomInt(LOW.length)]}${NUM[randomInt(NUM.length)]}${s}`
}

// `GITHUB_RUN_ID` đứng yên suốt một lượt chạy CI nên provision và cleanup gọi ra CÙNG số hiệu.
// Chạy TẠI MÁY thì không có nó, mà `Date.now()` được tính lại ở MỖI tiến trình ⇒ bước thu hồi đi xoá
// một số hiệu khác số vừa cấp (đo 27/09: cấp `QACI0479539060`, thu hồi đòi xoá `QACI0479644254`)
// ⇒ tài khoản vừa dùng nằm lại tới khi quá hạn. Khai `QA_CI_TAG` để hai bước gọi ra cùng một số.
// Chạy TẠI MÁY: provision và cleanup là HAI tiến trình, `Date.now()` tính lại ở mỗi tiến trình nên
// nếu không ghi lại số hiệu thì cleanup đi xoá một tài khoản không tồn tại và tài khoản SUPERADMIN
// vừa dùng nằm lại tới khi quá hạn 2 giờ (đo 27/09: 8 tài khoản như vậy còn sống cùng lúc — trước
// đây chúng bị chính lỗi múi giờ xoá hộ nên không ai thấy). Ghi số hiệu ra file tạm của HỆ ĐIỀU
// HÀNH (không đụng repo) để mọi người gọi đều được thu hồi đúng, không cần nhớ khai gì.
const TAG_FILE = join(tmpdir(), 'wms-qa-ci-account-tag')
const readSavedTag = () => { try { return readFileSync(TAG_FILE, 'utf8').trim() } catch { return '' } }
const runTag = (process.env.GITHUB_RUN_ID || process.env.QA_CI_TAG
  || (process.argv[2] === 'cleanup' ? readSavedTag() : '') || String(Date.now())).slice(-10)
const codeOf = (tag) => `${PREFIX}${tag}`

async function provision() {
  await purgeOld()
  const code = codeOf(runTag)
  const password = newPassword()
  const now = new Date().toISOString()
  const email = `${code.toLowerCase()}@ci.local`

  // Tài khoản của lượt chạy trước cùng số hiệu (job chạy lại) — dọn trước cho sạch
  await rest(`Employee?employee_code=eq.${code}`, { method: 'DELETE' })

  await rest('Employee', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: randomUUID(),
      employee_code: code,
      name: `CI runner ${runTag} (tự xoá sau khi chạy)`,
      email,
      password: bcrypt.hashSync(password, 10),
      is_active: true,
      is_superadmin: true,        // bộ kiểm cần đọc/ghi rộng; tài khoản chỉ sống vài phút
      warehouse_scope: 'NATIONAL',
      is_driver: false,
      created_at: now,
      updated_at: now,
    }),
  })
  // stdout để workflow đọc — mật khẩu được mask ngay ở bước gọi, không lọt vào log
  console.log(`email=${email}`)
  console.log(`password=${password}`)
  try { writeFileSync(TAG_FILE, runTag) } catch { /* không ghi được thì vẫn còn QA_CI_TAG + lưới dọn quá hạn */ }
  console.log(`tag=${runTag}`)     // gọi tay thì đặt QA_CI_TAG=<tag> cho bước cleanup xoá đúng tài khoản này
}

/** Xoá tài khoản CI quá hạn — lượt bị huỷ giữa chừng không kịp chạy bước cleanup. */
async function purgeOld() {
  const rows = await rest(`Employee?employee_code=like.${PREFIX}*&select=id,employee_code,created_at`)
  const mine = codeOf(runTag)
  const stale = (rows ?? []).filter(r => {
    if (r.employee_code === mine) return false        // tài khoản của CHÍNH lượt này — không bao giờ tự xoá
    const age = Date.now() - utcMs(r.created_at)
    return Number.isFinite(age) && age > MAX_AGE_MS   // đọc không ra mốc ⇒ KHÔNG xoá (thà để lại còn hơn xoá nhầm)
  })
  for (const r of stale) await rest(`Employee?id=eq.${r.id}`, { method: 'DELETE' })
  if (stale.length) console.error(`[ci-account] đã dọn ${stale.length} tài khoản CI quá hạn`)
}

async function cleanup() {
  const code = codeOf(runTag)
  await rest(`Employee?employee_code=eq.${code}`, { method: 'DELETE' })
  // Vết đăng nhập của tài khoản vừa xoá: giữ lại KHÔNG có ích (tài khoản không còn tồn tại) mà lại
  // làm nhiễu rule cảnh báo bảo mật đếm theo email.
  await rest(`auth_login_events?email=eq.${code.toLowerCase()}@ci.local`, { method: 'DELETE' })
  await purgeOld()
  console.error(`[ci-account] đã xoá tài khoản ${code}`)
}

const mode = process.argv[2]
if (mode === 'provision') await provision()
else if (mode === 'cleanup') await cleanup()
else { console.error('usage: ci-account.mjs provision|cleanup'); process.exit(2) }
