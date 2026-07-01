/** Apply migration 20260701_adjustment_log_numeric: đổi delta/cartons_before/cartons_after sang numeric. */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
require(path.join(BASE, 'node_modules', 'dotenv')).config({ path: path.join(BASE, '.env') })
const { Client } = require(path.join(BASE, 'node_modules', 'pg'))
async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query(`ALTER TABLE "InventoryAdjustmentLog"
      ALTER COLUMN delta TYPE numeric, ALTER COLUMN cartons_before TYPE numeric, ALTER COLUMN cartons_after TYPE numeric`)
    const r = await c.query(`SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name='InventoryAdjustmentLog' AND column_name IN ('delta','cartons_before','cartons_after') ORDER BY column_name`)
    console.log('Sau ALTER:', r.rows.map(x => `${x.column_name}=${x.data_type}`).join(', '))
  } finally { await c.end() }
}
main().catch(e => { console.error(e.message); process.exit(1) })
