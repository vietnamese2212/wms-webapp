// BASE UNIT FLIP runner — Đợt 2 (chạy staging trước, production sau khi nghiệm thu).
// Cách chạy:  node scripts/base-unit-flip/run-flip.mjs            → flip + verify
//             node scripts/base-unit-flip/run-flip.mjs --verify   → chỉ verify lại
//             node scripts/base-unit-flip/run-flip.mjs --rollback → restore từ x_flip_bak_*
// Connection string đọc từ .mcp.json (DATABASE_URL của MCP postgres) — KHÔNG hardcode.
import { readFileSync } from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const mcp = JSON.parse(readFileSync(new URL('../../.mcp.json', import.meta.url), 'utf8'))
const rawArg = (mcp.mcpServers?.postgres?.args ?? []).find(a => a.startsWith('postgresql'))
if (!rawArg) { console.error('Không tìm thấy DATABASE_URL trong .mcp.json'); process.exit(1) }

let pg
try { pg = require('pg') } catch { pg = require(process.env.TEMP_PG_PATH ?? 'C:/Users/LAM~1.TRA/AppData/Local/Temp/claude/c--Users-lam-tranhoang-OneDrive---LOF-JSC-WAREHOUSE-CLAUDECODE-WMS-webapp/c192787c-51f8-4eb2-b255-61e3c1d4fbd2/scratchpad/node_modules/pg') }
const { Client } = pg

const MODE = process.argv.includes('--rollback') ? 'rollback' : process.argv.includes('--verify') ? 'verify' : 'flip'

// (bảng, backup, khóa, các cột) — khớp 20260719_base_unit_flip.sql
const TABLES = [
  { t: '"InventoryEntry"',        bak: 'x_flip_bak_inventory_entry',    cols: ['cartons_imported', 'cartons_remaining', 'cartons_reserved', 'adjustment_qty'], matJoin: 'm.id = t.material_id' },
  { t: '"OutboundItem"',          bak: 'x_flip_bak_outbound_item',      cols: ['cartons_ordered', 'cartons_scanned', 'loose_picking'], matJoin: 'm.id = t.material_id' },
  { t: '"OutboundScanEntry"',     bak: 'x_flip_bak_outbound_scan_entry', cols: ['cartons_scanned'], matJoin: 'm.id = (SELECT i.material_id FROM "OutboundItem" i WHERE i.id = t.item_id)' },
  { t: '"InventoryAdjustmentLog"', bak: 'x_flip_bak_adjustment_log',    cols: ['delta', 'cartons_before', 'cartons_after'], matJoin: 'm.id = (SELECT e.material_id FROM "InventoryEntry" e WHERE e.id = t.entry_id)' },
  { t: '"ProductionImport"',      bak: 'x_flip_bak_production_import',  cols: ['planned_cartons', 'posm_cartons'], matJoin: 'm.id = t.material_id' },
  { t: 'inbound_plan_lines',      bak: 'x_flip_bak_inbound_plan_lines', cols: ['planned_boxes'], matJoin: 'm.id = t.material_id' },
]

const ENTRY = `m.entry_unit IS NOT NULL AND coalesce(m.units_per_carton, 0) > 0`

async function main() {
  const client = new Client({ connectionString: rawArg })
  await client.connect()
  try {
    if (MODE === 'rollback') return await rollback(client)
    if (MODE === 'verify')   return await verifyAll(client)

    // Chống chạy 2 lần: nếu backup đã tồn tại VÀ dữ liệu đã lệch backup → coi như đã flip
    const { rows: [probe] } = await client.query(`SELECT to_regclass('x_flip_bak_inventory_entry') IS NOT NULL AS has_bak`)
    if (probe.has_bak) {
      const { rows: [d] } = await client.query(`
        SELECT count(*)::int AS diff FROM "InventoryEntry" t JOIN x_flip_bak_inventory_entry b ON b.id = t.id
        WHERE t.cartons_remaining IS DISTINCT FROM b.cartons_remaining LIMIT 1`)
      if (d.diff > 0) { console.error('⚠ Backup đã tồn tại và dữ liệu ĐÃ lệch backup — có vẻ đã flip rồi. Dừng (dùng --verify).'); process.exit(2) }
      console.log('Backup đã tồn tại, dữ liệu chưa lệch → chạy tiếp phần UPDATE.')
    }

    const sql = readFileSync(new URL('../../backend/migrations/20260719_base_unit_flip.sql', import.meta.url), 'utf8')
    console.log('=== FLIP: chạy migration trong 1 transaction ===')
    await client.query('BEGIN')
    await client.query(sql)
    // verify TRONG transaction — lệch là ROLLBACK ngay
    const bad = await verifyAll(client, true)
    if (bad > 0) { await client.query('ROLLBACK'); console.error(`❌ ${bad} dòng lệch — ĐÃ ROLLBACK.`); process.exit(1) }
    await client.query('COMMIT')
    console.log('✅ COMMIT — flip xong.')

    const { rows: rep } = await client.query(`SELECT tbl, col, count(*)::int AS n, sum(abs(diff_base)) AS tong_lech FROM base_unit_flip_round_report GROUP BY 1,2 ORDER BY 1,2`)
    console.log('— BÁO CÁO ROUND (chi tiết trong bảng base_unit_flip_round_report):')
    console.table(rep)
  } finally { await client.end() }
}

// Verify per-row: new = round(old×factor) với mã entry, new = old với mã không entry
async function verifyAll(client, inTx = false) {
  let total = 0
  for (const { t, bak, cols, matJoin } of TABLES) {
    for (const col of cols) {
      const { rows: [r] } = await client.query(`
        SELECT count(*)::int AS bad FROM ${t} t
        JOIN ${bak} b ON b.id = t.id
        LEFT JOIN "Material" m ON ${matJoin}
        WHERE CASE WHEN m.id IS NOT NULL AND ${ENTRY}
                   THEN t.${col} IS DISTINCT FROM round(b.${col} * m.units_per_carton)
                   ELSE t.${col} IS DISTINCT FROM b.${col} END`)
      total += r.bad
      const tag = r.bad === 0 ? 'OK ' : '❌ '
      console.log(`${tag}${t}.${col}: ${r.bad} dòng lệch`)
    }
  }
  if (!inTx) console.log(total === 0 ? '✅ VERIFY PASS' : `❌ VERIFY FAIL: ${total} dòng`)
  return total
}

async function rollback(client) {
  console.log('=== ROLLBACK: restore từ x_flip_bak_* ===')
  await client.query('BEGIN')
  for (const { t, bak, cols } of TABLES) {
    const sets = cols.map(c => `${c} = b.${c}`).join(', ')
    const { rowCount } = await client.query(`UPDATE ${t} t SET ${sets} FROM ${bak} b WHERE b.id = t.id`)
    console.log(`${t}: restore ${rowCount} dòng`)
  }
  await client.query(`TRUNCATE base_unit_flip_round_report`)
  await client.query('COMMIT')
  console.log('✅ Rollback dữ liệu xong. LƯU Ý: RPC vẫn là bản mới — revert code deploy nếu rollback thật.')
}

main().catch(e => { console.error('LỖI:', e.message); process.exit(1) })
