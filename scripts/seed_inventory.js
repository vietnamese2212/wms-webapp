/**
 * Seed 5000 InventoryEntry (pallet tồn kho) cho môi trường test.
 * Run: node scripts/seed_inventory.js   (từ thư mục gốc project)
 *
 * Pallet code: {DDMMYY}{MFR}{MAT3}{MACH}{SEQ4}
 *   Ví dụ: 010126B127M10001  = 01/01/2026 · NM Ba Vì · mã 127 · máy 1 · pallet 1
 */

const path = require('path')
const BASE  = path.join(__dirname, '..', 'backend')
const dotenv        = require(path.join(BASE, 'node_modules', 'dotenv'))
const { createClient } = require(path.join(BASE, 'node_modules', '@supabase', 'supabase-js'))
const { randomUUID }   = require('crypto')

dotenv.config({ path: path.join(BASE, '.env') })

const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^<|>$/g, '')
const sb  = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } })

// ─── Hardcoded from DB query ──────────────────────────────────────
const PRODUCTS = [
  { id: '6e79f5ff-2e82-4ffc-9b01-a5357ab5cec4', cpp: 110, count: 2800, short: '127', mfr: 'B' },
  { id: 'c6bf6062-8a5a-43eb-91fe-1e5e51ed5ae0', cpp: 140, count: 2200, short: '126', mfr: 'B' },
]
const QA_OK_ID = '3c8b6ef2-7c17-46ce-ac01-95d0f0382ad3'
const MACHINES = ['1','2','3','4','5']

// Production dates Jan–Apr 2026
const PROD_DATES = []
for (let m = 0; m < 4; m++)
  for (let d = 1; d <= 28; d++)
    PROD_DATES.push(new Date(Date.UTC(2026, m, d)))

function fmtDate(d) {
  return String(d.getUTCDate()).padStart(2,'0')
    + String(d.getUTCMonth()+1).padStart(2,'0')
    + String(d.getUTCFullYear()).slice(-2)
}

async function main() {
  const { data: locs, error: le } = await sb.from('Location').select('id,location_code')
  if (le || !locs?.length) { console.error('Location error:', le?.message); process.exit(1) }
  console.log(`Loaded ${locs.length} locations`)

  const bvLocs = locs.filter(l => l.location_code.startsWith('BV'))
  const allLocs = locs

  const now = new Date().toISOString()
  const records = []

  for (const prod of PRODUCTS) {
    const pool = prod.mfr === 'B' ? bvLocs : allLocs
    let locIdx = 0, seq = 1

    for (let i = 0; i < prod.count; i++) {
      const loc  = pool[locIdx % pool.length]
      const date = PROD_DATES[Math.floor(Math.random() * PROD_DATES.length)]
      const mach = MACHINES[i % MACHINES.length]
      const code = `${fmtDate(date)}${prod.mfr}${prod.short}M${mach}${String(seq).padStart(4,'0')}`

      records.push({
        id:                randomUUID(),
        pallet_code:       code,
        location_id:       loc.id,
        material_id:       prod.id,
        manufacturer_id:   null,
        cycle:             `C${String(Math.floor(i/50)+1).padStart(2,'0')}`,
        machine_code:      `M${mach}`,
        pallet_sequence_no: seq,
        stack_layer:       1,
        cartons_imported:  prod.cpp,
        cartons_remaining: prod.cpp,
        production_date:   date.toISOString(),
        qa_status_id:      QA_OK_ID,
        status:            'IN_STOCK',
        import_order_id:   null,
        created_by:        null,
        updated_by:        null,
        created_at:        now,
        updated_at:        now,
      })
      seq++
      locIdx++
    }
  }

  console.log(`Inserting ${records.length} pallets in batches of 100...`)
  let done = 0, errs = 0

  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100)
    const { error } = await sb.from('InventoryEntry').insert(batch)
    if (error) { console.error(`  Batch ${i} ERR:`, error.message); errs += batch.length }
    else {
      done += batch.length
      if (done % 500 === 0) console.log(`  ${done}/${records.length}...`)
    }
  }
  console.log(`\nHoàn thành: ${done} inserted · ${errs} errors`)
}

main().catch(e => { console.error(e); process.exit(1) })
