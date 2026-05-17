/**
 * Tạo tài khoản admin đầu tiên.
 * Chạy một lần: npx ts-node src/seed-admin.ts
 *
 * Yêu cầu: backend/.env phải có SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY
 */
import bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Thay đổi thông tin admin ở đây ──────────────────────────────────────────
const ADMIN_EMAIL    = 'admin@wms.vn'
const ADMIN_PASSWORD = 'Admin@123'
const ADMIN_NAME     = 'Admin'
const ADMIN_CODE     = 'ADM001'
// ────────────────────────────────────────────────────────────────────────────

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
      action_level:       'NATIONAL_MANAGER',
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
      action_level:       'NATIONAL_MANAGER',
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
