/** Apply migration 20260701_inventory_active_pallet_unique: dọn 8 pallet test trùng rồi tạo unique index.
 * Chạy DDL trực tiếp qua pg (DIRECT_URL) vì supabase-js không chạy được DDL. */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
require(path.join(BASE, 'node_modules', 'dotenv')).config({ path: path.join(BASE, '.env') })
const { Client } = require(path.join(BASE, 'node_modules', 'pg'))

async function main() {
  const cs = process.env.DIRECT_URL || process.env.DATABASE_URL
  const client = new Client({ connectionString: cs })
  await client.connect()
  try {
    // 1) Dọn 8 bản test trùng (pallet 999) để index tạo được
    const del = await client.query(`DELETE FROM "InventoryEntry" WHERE pallet_code = '020726_510000114_TOB_M9_999_B'`)
    console.log('Xóa pallet test trùng:', del.rowCount)
    // 2) Chặn còn trùng active nào khác
    const dup = await client.query(`SELECT pallet_code, COUNT(*) FROM "InventoryEntry"
      WHERE status IN ('IN_STOCK','PARTIAL','QUARANTINE','LOOSE_PICKING')
      GROUP BY pallet_code HAVING COUNT(*)>1`)
    if (dup.rows.length) { console.error('CÒN trùng active, dừng:', dup.rows); process.exit(1) }
    // 3) Tạo unique index (CONCURRENTLY — ngoài transaction)
    await client.query(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_inventory_active_pallet_code
      ON "InventoryEntry" (pallet_code)
      WHERE status IN ('IN_STOCK','PARTIAL','QUARANTINE','LOOSE_PICKING')`)
    const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE indexname='uq_inventory_active_pallet_code'`)
    console.log('Index:', idx.rows.length ? '✅ ' + idx.rows[0].indexname : '❌ chưa tạo được')
  } finally { await client.end() }
}
main().catch(e => { console.error(e); process.exit(1) })
