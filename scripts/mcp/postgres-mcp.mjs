#!/usr/bin/env node
// MCP "postgres" (đọc DB STAGING) — KHÔNG ghi mật khẩu vào .mcp.json / ~/.claude.json / dòng lệnh.
// Script đọc chuỗi kết nối từ backend/.env (gitignored), tách mật khẩu ra khỏi URL và đưa cho server qua biến môi trường
// PGPASSWORD (thư viện pg tự đọc khi URL không có mật khẩu) ⇒ dòng lệnh của tiến trình con chỉ còn URL không mật khẩu.
// Khai trong .mcp.json:  "postgres": { "command": "node", "args": ["<đường dẫn repo>/scripts/mcp/postgres-mcp.mjs"] }
// Tham số tuỳ chọn: tên biến trong backend/.env (mặc định DATABASE_URL). Trỏ nhầm DB production ⇒ dừng.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const KEY = process.argv[2] || 'DATABASE_URL'
const PROD_REF = 'svicyfquresxaigfxsdb'

let raw = process.env[KEY]
if (!raw) {
  try {
    const env = readFileSync(path.join(ROOT, 'backend/.env'), 'utf8')
    raw = (env.match(new RegExp(`^\\s*${KEY}\\s*=\\s*(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '')
  } catch { /* không có file */ }
}
if (!raw) { console.error(`[postgres-mcp] thiếu ${KEY} trong backend/.env`); process.exit(1) }

let u
try { u = new URL(raw) } catch { console.error(`[postgres-mcp] ${KEY} không phải chuỗi kết nối hợp lệ`); process.exit(1) }
if (u.username.includes(PROD_REF) || u.hostname.includes(PROD_REF)) { console.error('[postgres-mcp] chuỗi kết nối trỏ DB PRODUCTION — MCP chỉ dùng staging, dừng'); process.exit(1) }
const password = decodeURIComponent(u.password)
u.password = ''

// npx trên Windows là file .cmd ⇒ chạy qua shell, MỘT chuỗi lệnh (URL có dấu & nên bọc ngoặc kép; URL không còn mật khẩu)
const child = spawn(`npx -y @modelcontextprotocol/server-postgres "${u.toString()}"`, {
  stdio: 'inherit', shell: true, env: { ...process.env, PGPASSWORD: password },
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code) => process.exit(code ?? 0))
