/** Apply migration 20260701 (bản composite): dọn tồn test (cycle=TOB), backfill warehouse_id,
 *  bỏ index global cũ, tạo unique (warehouse_id, pallet_code) NULLS NOT DISTINCT. pg + DIRECT_URL. */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
require(path.join(BASE, 'node_modules', 'dotenv')).config({ path: path.join(BASE, '.env') })
const { Client } = require(path.join(BASE, 'node_modules', 'pg'))

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await client.connect()
  try {
    // 1) Dọn toàn bộ tồn test (bao gồm 96 bản no-QR bịa mã QR sai + các bản inbound-scan test)
    const del = await client.query(`DELETE FROM "InventoryEntry" WHERE cycle = 'TOB'`)
    console.log('Xóa tồn test cycle=TOB:', del.rowCount)
    // 2) Backfill warehouse_id từ location cho entry active còn null (an toàn cho index)
    const bf = await client.query(`UPDATE "InventoryEntry" ie SET warehouse_id = l.warehouse_id::uuid
      FROM "Location" l WHERE ie.location_id = l.id AND ie.warehouse_id IS NULL
      AND ie.status IN ('IN_STOCK','PARTIAL','QUARANTINE','LOOSE_PICKING')`)
    console.log('Backfill warehouse_id:', bf.rowCount)
    // 3) Chặn còn trùng (warehouse_id, pallet_code) active nào không
    const dup = await client.query(`SELECT warehouse_id, pallet_code, COUNT(*) FROM "InventoryEntry"
      WHERE status IN ('IN_STOCK','PARTIAL','QUARANTINE','LOOSE_PICKING')
      GROUP BY warehouse_id, pallet_code HAVING COUNT(*)>1`)
    if (dup.rows.length) { console.error('CÒN trùng, dừng:', dup.rows.slice(0,10)); process.exit(1) }
    // 4) Bỏ index global cũ (nếu có) + tạo composite
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS uq_inventory_active_pallet_code`)
    await client.query(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_inventory_active_wh_pallet
      ON "InventoryEntry" (warehouse_id, pallet_code) NULLS NOT DISTINCT
      WHERE status IN ('IN_STOCK','PARTIAL','QUARANTINE','LOOSE_PICKING')`)
    const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('uq_inventory_active_wh_pallet','uq_inventory_active_pallet_code') ORDER BY indexname`)
    console.log('Index hiện có:', idx.rows.map(r => r.indexname).join(', ') || '(none)')
  } finally { await client.end() }
}
main().catch(e => { console.error(e); process.exit(1) })
