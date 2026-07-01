/** Dọn data test đua scanManual (B2.2): 2 entry POSM + 4 phiếu RACE-* ở Ba Vì. */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
require(path.join(BASE, 'node_modules', 'dotenv')).config({ path: path.join(BASE, '.env') })
const { Client } = require(path.join(BASE, 'node_modules', 'pg'))
const WH = '56cf7a64-d3aa-4fd2-948d-490ec487acb9'
async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()
  try {
    const e = await c.query(
      `DELETE FROM "InventoryEntry" WHERE pallet_code IN ('820000031','820000091')
         AND warehouse_id = $1 AND status IN ('IN_STOCK','PARTIAL','LOOSE_PICKING') RETURNING id, pallet_code`, [WH])
    const o = await c.query(`DELETE FROM "ProductionImport" WHERE notes LIKE 'RACE-%' RETURNING id, import_code, notes`)
    console.log('Deleted entries:', e.rows.map(r => `${r.pallet_code}`).join(', ') || 'none')
    console.log('Deleted orders:', o.rows.map(r => r.import_code).join(', ') || 'none')
    // Xác nhận sạch
    const chk = await c.query(
      `SELECT count(*) n FROM "InventoryEntry" WHERE pallet_code IN ('820000031','820000091') AND warehouse_id=$1 AND status IN ('IN_STOCK','PARTIAL','LOOSE_PICKING')`, [WH])
    const chkO = await c.query(`SELECT count(*) n FROM "ProductionImport" WHERE notes LIKE 'RACE-%'`)
    console.log('Còn lại — entries:', chk.rows[0].n, '| orders:', chkO.rows[0].n)
  } finally { await c.end() }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
