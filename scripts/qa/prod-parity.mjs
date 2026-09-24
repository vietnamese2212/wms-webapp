// ============================================================================
// prod-parity — SO SCHEMA production ↔ staging. Chạy TRƯỚC và SAU mỗi cutover.
//
// VÌ SAO CÓ FILE NÀY (lớp lỗi đã lặp HAI lần):
//   • Cutover 15/08: danh sách 65 migration lấy từ `SCHEMA_REVIEW.md` THIẾU 27 file.
//     Phát hiện khi part4 chết ở `relation "StocktakeLog" does not exist`.
//   • Cutover 24/09: production thiếu event trigger `auto_realtime_new_tables`
//     (migration `20260508_enable_realtime.sql` — tháng NĂM — chưa từng lên production),
//     nên 12 bảng nghiệp vụ mới không có `trg_wms_notify` ⇒ realtime CÂM ở
//     Điều vận · Cước · Khách hàng · Quy định date · Sơ đồ kho · Việc cần làm.
//     Không lỗi nào nổ, không ai thấy — đúng lớp "bảo mật/realtime không có triệu chứng".
//   ⇒ Sổ tay không tự thi hành. Nguồn sự thật DUY NHẤT là so hai schema bằng máy.
//
// CỐ Ý KHÔNG nằm trong --tier fast/full: cần khoá production, mà khoá production
// TUYỆT ĐỐI không đặt vào CI (luật CLAUDE.md). Thiếu khoá thì bỏ qua sạch, exit 0.
//
// Dùng:  node scripts/qa/prod-parity.mjs
//        PROD_DATABASE_URL=... node scripts/qa/prod-parity.mjs
// ============================================================================
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CI = process.env.GITHUB_ACTIONS === 'true'
const ann = (s) => { if (CI) console.log(`::error::prod-parity — ${s}`) }

// pg nằm ở backend/node_modules (không có ở root)
let pg
try { pg = createRequire(join(ROOT, 'backend', 'package.json'))('pg') }
catch { console.log('⊘ bỏ qua: không nạp được `pg` — chạy `cd backend && npm i` trước'); process.exit(0) }

// ---- khoá kết nối: env trước, .env sau (đọc trong tiến trình, KHÔNG in ra) ----
function fromEnvFile() {
  const out = {}
  try {
    for (const line of readFileSync(join(ROOT, 'backend', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      out[m[1]] = v
    }
  } catch { }
  return out
}
const F = fromEnvFile()
const PROD = process.env.PROD_DATABASE_URL || F.LOF_DATABASE_URL
const STG = process.env.QA_DATABASE_URL || F.DATABASE_URL || F.DIRECT_URL
if (!PROD || !STG) {
  console.log('⊘ bỏ qua prod-parity: thiếu khoá production (LOF_DATABASE_URL/PROD_DATABASE_URL) hoặc staging.')
  console.log('  Đây là công cụ CUTOVER chạy tại máy — khoá production không bao giờ đặt vào CI.')
  process.exit(0)
}

// ---- những gì CỐ Ý khác nhau: bảng nháp/sao lưu do migration & script tạo ----
const SCRATCH = /^(x_bak_|x_flip_bak_|x_seed_|base_unit_flip_)/i
// khoá có thể là "bảng", "bảng.cột", "bảng :: index/trigger" — xét TỪNG mảnh
const scratch = (v) => String(v).split(/\s*::\s*|\./).some(tok => SCRATCH.test(tok))

const Q = {
  'bảng': `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`,
  'cột': `select table_name||'.'||column_name from information_schema.columns where table_schema='public'`,
  'hàm': `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,
  // index/trigger đặt TÊN BẢNG lên trước để lọc-bảng-nháp bắt được (ix_seed_manifest_day
  // nằm TRÊN x_seed_manifest nhưng tên index không mang tiền tố nháp)
  'index': `select tablename||' :: '||indexname from pg_indexes where schemaname='public'`,
  'trigger': `select c.relname||' :: '||tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal`,
  'extension': `select extname||'@'||n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace`,
  'enum': `select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'`,
  'event trigger': `select evtname from pg_event_trigger where evtname not like 'issue_%' and evtname not like 'pgrst_%'`,
}
// bất biến BẢO MẬT phải đúng ở CẢ HAI (luật 20260902c/d)
const SEC = {
  'publication supabase_realtime RỖNG': `select count(*) n from pg_publication_rel r join pg_publication p on p.oid=r.prpubid where p.pubname='supabase_realtime'`,
  'anon/authenticated KHÔNG có quyền bảng': `select count(*) n from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')`,
  'KHÔNG policy nào trong public': `select count(*) n from pg_policies where schemaname='public'`,
}

async function snap(url) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('set default_transaction_read_only = on')   // khoá cứng: công cụ này KHÔNG bao giờ ghi
  const o = { sets: {}, sec: {} }
  for (const [k, sql] of Object.entries(Q)) o.sets[k] = (await c.query(sql)).rows.map(r => Object.values(r)[0]).filter(v => !scratch(v))
  for (const [k, sql] of Object.entries(SEC)) o.sec[k] = Number((await c.query(sql)).rows[0].n)
  await c.end()
  return o
}

let fail = 0, pass = 0
const chk = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); ann(`${label}${detail ? ' — ' + detail : ''}`) }
}

const P = await snap(PROD), S = await snap(STG)
console.log('=== SO SCHEMA production ↔ staging (bỏ qua bảng nháp x_bak_/x_seed_/x_flip_bak_) ===')
for (const k of Object.keys(Q)) {
  const ps = new Set(P.sets[k]), ss = new Set(S.sets[k])
  const miss = S.sets[k].filter(x => !ps.has(x))          // staging có, production THIẾU
  const extra = P.sets[k].filter(x => !ss.has(x))         // production có, staging không
  chk(miss.length === 0, `production đủ ${k} như staging`,
    miss.length ? `THIẾU ${miss.length}: ${miss.slice(0, 6).join(' · ')}${miss.length > 6 ? ` …+${miss.length - 6}` : ''}` : `${P.sets[k].length} mục`)
  if (extra.length) console.log(`     ℹ️ production có thêm ${extra.length} ${k}: ${extra.slice(0, 4).join(' · ')}`)
}

console.log('\n=== BẤT BIẾN BẢO MẬT (phải đúng ở CẢ HAI) ===')
for (const k of Object.keys(SEC)) {
  chk(P.sec[k] === 0, `production: ${k}`, P.sec[k] === 0 ? '0' : `đang là ${P.sec[k]}`)
  chk(S.sec[k] === 0, `staging   : ${k}`, S.sec[k] === 0 ? '0' : `đang là ${S.sec[k]}`)
}

console.log(`\n[prod-parity] ${pass}/${pass + fail} PASS`)
if (fail) console.log('  ⇒ Chênh lệch = còn migration CHƯA áp production. Dựng bộ SQL rồi áp, đừng sửa tay.')
process.exitCode = fail ? 1 : 0
