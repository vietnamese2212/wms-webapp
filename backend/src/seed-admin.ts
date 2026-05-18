/**
 * Tạo tài khoản admin đầu tiên.
 * Chạy một lần: npx ts-node src/seed-admin.ts
 */
import bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.seed (production creds) hoặc .env local
function loadEnv(filename: string) {
  const p = resolve(__dirname, '..', filename)
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

loadEnv('.env.seed')
loadEnv('.env')

// ── Thay đổi thông tin admin ở đây ──────────────────────────────────────────
const ADMIN_EMAIL    = 'admin'
const ADMIN_PASSWORD = 'Admin@123'
const ADMIN_NAME     = 'Admin'
const ADMIN_CODE     = 'ADM001'
// ────────────────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.seed / .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  console.log('Seeding admin account…')

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from('Employee') as any)
    .select('id, name')
    .ilike('email', ADMIN_EMAIL)
    .limit(1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = (existing as any[])?.[0]

  if (found) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('Employee') as any).update({
      password_hash:      hash,
      warehouse_scope:    'NATIONAL',
      allowed_categories: ['TP', 'NVL', 'POSM', 'BAO_BI'],
      is_active:          true,
      updated_at:         new Date().toISOString(),
    }).eq('id', found.id)

    if (error) { console.error('Lỗi update:', error.message); process.exit(1) }
    console.log(`✓ Admin updated: ${found.name} (${ADMIN_EMAIL})`)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('Employee') as any).insert({
      id:                 randomUUID(),
      name:               ADMIN_NAME,
      employee_code:      ADMIN_CODE,
      email:              ADMIN_EMAIL,
      password_hash:      hash,
      warehouse_scope:    'NATIONAL',
      allowed_categories: ['TP', 'NVL', 'POSM', 'BAO_BI'],
      is_active:          true,
      updated_at:         new Date().toISOString(),
    })

    if (error) { console.error('Lỗi insert:', error.message); process.exit(1) }
    console.log(`✓ Admin created: ${ADMIN_NAME} (${ADMIN_EMAIL})`)
  }

  console.log(`  Email   : ${ADMIN_EMAIL}`)
  console.log(`  Password: ${ADMIN_PASSWORD}`)
  console.log('\nHãy đổi mật khẩu sau khi đăng nhập lần đầu!')
}

run().catch(err => { console.error(err); process.exit(1) })
