/**
 * Bật lại PostgREST aggregate functions (db-aggregates-enabled) + test SUM khớp Node reduce.
 * Lý do: listInventory/listFacets đang KÉO ~4000 dòng về Node để cộng (5.2s/4.9s). Bật aggregate
 * → dùng .select('cartons_remaining.sum()') tái dùng NGUYÊN applyInventoryFilters (tổng khớp list).
 * An toàn: anon đã có policy anon_select qual=true (đọc được hết) → aggregate không mở thêm dữ liệu.
 * Apply qua pg + DIRECT_URL (MCP read-only). Test qua service-role supabase client.
 */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
require(path.join(BASE, 'node_modules', 'dotenv')).config({ path: path.join(BASE, '.env') })
const { Client } = require(path.join(BASE, 'node_modules', 'pg'))
const { createClient } = require(path.join(BASE, 'node_modules', '@supabase', 'supabase-js'))

const supabase = createClient(
  process.env.SUPABASE_URL,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^<|>$/g, ''),
  { auth: { persistSession: false } },
)

async function enable() {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query(`ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true'`)
    await c.query(`NOTIFY pgrst, 'reload config'`)
    const r = await c.query(`SELECT rolname, rolconfig FROM pg_roles WHERE rolname='authenticator'`)
    console.log('authenticator config:', JSON.stringify(r.rows[0].rolconfig))
  } finally { await c.end() }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function testAgg() {
  const ACTIVE = ['IN_STOCK', 'PARTIAL', 'LOOSE_PICKING']
  // Ca 1: KHÔNG lọc loại kho — SUM cartons_remaining toàn tồn active.
  const agg1 = await supabase.from('InventoryEntry').select('cartons_remaining.sum()').in('status', ACTIVE)
  console.log('\n[Ca 1 no-cat] error:', agg1.error?.message ?? 'none', '| data:', JSON.stringify(agg1.data))

  // Ca 2: CÓ lọc loại kho (embedded !inner) — SUM theo category cụ thể.
  const { data: cats } = await supabase.from('Material').select('category').not('category', 'is', null).limit(1)
  const cat = cats?.[0]?.category
  console.log('\n[Ca 2] test category =', cat)
  const agg2 = await supabase.from('InventoryEntry')
    .select('cartons_remaining.sum(), material:Material!inner(category)')
    .in('status', ACTIVE).eq('material.category', cat)
  console.log('[Ca 2 cat embed] error:', agg2.error?.message ?? 'none', '| data:', JSON.stringify(agg2.data))

  // Đối chiếu Node reduce cho ca 2 (kéo dòng như code hiện tại) để xác minh SUM khớp.
  let sum = 0, from = 0
  for (;;) {
    const { data, error } = await supabase.from('InventoryEntry')
      .select('cartons_remaining, material:Material!inner(category)')
      .in('status', ACTIVE).eq('material.category', cat)
      .order('id').range(from, from + 999)
    if (error) { console.log('reduce err:', error.message); break }
    sum += (data ?? []).reduce((s, r) => s + Number(r.cartons_remaining ?? 0), 0)
    if ((data ?? []).length < 1000) break
    from += 1000
  }
  console.log('[Ca 2 node reduce] sum =', sum)
}

async function main() {
  await enable()
  await sleep(2000) // chờ PostgREST reload config
  await testAgg()
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
