/**
 * Seed ~6000 InventoryEntry (pallet tồn kho) — QR format thực tế
 * QR: {DDMMYY}_{material_code}_{cycle}_{machine}_{seq}_{mfr}
 * Ví dụ: 010526_510000127_25_M1_0001_B
 *
 * Phân bổ: exponential decay (top SP chạy nhiều, còn lại ít hơn)
 * 95% pallet chẵn (= cpp), 5% nhặt lẻ (partial cartons)
 * Manufacturer: B (Ba Vì) dominant, D (Bàu Bàng), O (Gia công)
 *
 * Run: node scripts/seed_inventory_v2.js
 */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
const dotenv = require(path.join(BASE, 'node_modules', 'dotenv'))
const { createClient } = require(path.join(BASE, 'node_modules', '@supabase', 'supabase-js'))
const { randomUUID } = require('crypto')

dotenv.config({ path: path.join(BASE, '.env') })
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^<|>$/g, '')
const sb  = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } })

const MACHINES = ['M1', 'M2', 'M3', 'M4', 'M5', 'K']
// Ba Vì xuất hiện nhiều hơn
const MFR_DIST = ['B','B','B','B','D','D','O']

// Production dates: Jan–May 10, 2026
const PROD_DATES = []
for (let m = 0; m < 5; m++) {
  const maxDay = m < 4 ? 28 : 10
  for (let d = 1; d <= maxDay; d++)
    PROD_DATES.push(new Date(Date.UTC(2026, m, d)))
}

function fmtDate(dt) {
  return String(dt.getUTCDate()).padStart(2, '0')
    + String(dt.getUTCMonth() + 1).padStart(2, '0')
    + String(dt.getUTCFullYear()).slice(-2)
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

async function main() {
  // Load Thành phẩm materials (must have cpp defined)
  const { data: mats, error: me } = await sb
    .from('Material')
    .select('id, material_code, cartons_per_pallet')
    .eq('category', 'Thành phẩm')
    .eq('is_active', true)
    .not('cartons_per_pallet', 'is', null)
    .order('material_code')
  if (me || !mats?.length) {
    console.error('Material error:', me?.message || 'Không có SP Thành phẩm nào có cartons_per_pallet')
    process.exit(1)
  }
  console.log(`\nLoaded ${mats.length} Thành phẩm materials`)

  // Load manufacturers
  const { data: mfrs } = await sb.from('Manufacturer').select('id, code')
  const mfrMap = new Map((mfrs ?? []).map(m => [m.code, m.id]))
  console.log(`Manufacturers: ${[...mfrMap.keys()].join(', ')}`)

  // QA OK status
  const { data: qaRows } = await sb.from('QAStatus').select('id, code')
  const qaOkId = (qaRows ?? []).find(q => q.code === 'OK')?.id
  if (!qaOkId) { console.error('QAStatus "OK" không tìm thấy'); process.exit(1) }

  // BV locations
  const { data: locs } = await sb.from('Location').select('id, location_code')
  const bvLocs = (locs ?? []).filter(l => l.location_code.startsWith('BV'))
  if (!bvLocs.length) { console.error('Không có location BV nào'); process.exit(1) }
  console.log(`BV locations: ${bvLocs.length}`)

  // Distribute 6000 pallets: exponential decay (0.60^i), floor at 30
  const TOTAL = 6000
  const rawW  = mats.map((_, i) => Math.pow(0.60, i))
  const wSum  = rawW.reduce((a, b) => a + b, 0)
  const counts = rawW.map(w => Math.max(30, Math.round(TOTAL * w / wSum)))
  const cur = counts.reduce((a, b) => a + b, 0)
  counts[0] += (TOTAL - cur)   // adjust first bucket to hit exact target

  console.log('\nPhân bổ pallet:')
  mats.forEach((m, i) => console.log(`  ${m.material_code} (cpp=${m.cartons_per_pallet}): ${counts[i]} pallets`))

  const now = new Date().toISOString()
  const records = []

  for (let mi = 0; mi < mats.length; mi++) {
    const mat   = mats[mi]
    const cpp   = mat.cartons_per_pallet
    const count = counts[mi]

    for (let i = 0; i < count; i++) {
      const isPartial = Math.random() < 0.05
      const cartons   = isPartial
        ? Math.max(1, Math.floor(cpp * (0.2 + Math.random() * 0.75)))
        : cpp

      const date    = PROD_DATES[Math.floor(Math.random() * PROD_DATES.length)]
      const mfrCode = pick(MFR_DIST)
      const machine = pick(MACHINES)
      const cycle   = String(rnd(1, 30))
      const seq     = String(i + 1).padStart(4, '0')
      const palletCode = `${fmtDate(date)}_${mat.material_code}_${cycle}_${machine}_${seq}_${mfrCode}`

      records.push({
        id:                 randomUUID(),
        pallet_code:        palletCode,
        location_id:        bvLocs[(i * 3 + mi * 97) % bvLocs.length].id,
        material_id:        mat.id,
        manufacturer_id:    mfrMap.get(mfrCode) ?? null,
        cycle,
        machine_code:       machine,
        pallet_sequence_no: i + 1,
        stack_layer:        1,
        cartons_imported:   cartons,
        cartons_remaining:  cartons,
        production_date:    date.toISOString(),
        qa_status_id:       qaOkId,
        status:             'IN_STOCK',
        import_order_id:    null,
        created_by:         null,
        updated_by:         null,
        created_at:         now,
        updated_at:         now,
      })
    }
  }

  console.log(`\nInserting ${records.length} pallets (batches of 200)...`)
  let done = 0, errs = 0

  for (let i = 0; i < records.length; i += 200) {
    const batch = records.slice(i, i + 200)
    const { error } = await sb.from('InventoryEntry').insert(batch)
    if (error) { console.error(`  Batch ${i} ERR:`, error.message); errs += batch.length }
    else {
      done += batch.length
      if (done % 1000 === 0) console.log(`  ${done}/${records.length}...`)
    }
  }

  const partialCount = records.filter(r => r.cartons_imported < records.find(x => x.material_id === r.material_id && x.cartons_imported === mats.find(m => m.id === r.material_id)?.cartons_per_pallet)?.cartons_imported ?? 0).length
  console.log(`\nHoàn thành: ${done} inserted · ${errs} errors`)
  console.log(`Pallet mẫu: ${records[0]?.pallet_code}`)
}

main().catch(e => { console.error(e); process.exit(1) })
