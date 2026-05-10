/**
 * Clears transactional + Material data for fresh test environment.
 * Order (FK-safe): OutboundScanEntry → OutboundItem → OutboundDelivery →
 *   GroupDeliveryOrder → InventoryEntry → ProductionImport → Material
 * Keeps: Warehouse, Location, Manufacturer, Employee, QAStatus, ImportShift
 *
 * Run: node scripts/clear_data.js
 */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
const dotenv = require(path.join(BASE, 'node_modules', 'dotenv'))
const { createClient } = require(path.join(BASE, 'node_modules', '@supabase', 'supabase-js'))

dotenv.config({ path: path.join(BASE, '.env') })
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^<|>$/g, '')
const sb  = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } })

async function clearTable(name) {
  const { error } = await sb.from(name).delete().not('id', 'is', null)
  if (error) console.error(`  ERR ${name}: ${error.message}`)
  else       console.log(`  ✓ ${name}`)
}

async function main() {
  console.log('Clearing transactional + Material data...\n')
  await clearTable('OutboundScanEntry')
  await clearTable('OutboundItem')
  await clearTable('OutboundDelivery')
  await clearTable('GroupDeliveryOrder')
  await clearTable('InventoryEntry')
  await clearTable('ProductionImport')
  await clearTable('Material')
  console.log('\nDone. Warehouse, Location, Manufacturer, Employee giữ nguyên.')
}

main().catch(e => { console.error(e); process.exit(1) })
