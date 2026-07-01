/**
 * (1) Khôi phục ngày đơn TMS test 9e07d39b về 2026-06-30 (API chặn ngày quá khứ).
 * (2) Verify thuật toán adjustInventoryAtomic (CAS cartons_remaining+reserved + jitter 15 lần) chịu
 *     ĐUA: 20 lệnh +1 reserved đồng thời trên 1 InventoryEntry thật → phải +20 đúng (0 mất cập nhật),
 *     tất cả thành công (jitter chống thundering herd). Rồi -20 trả về nguyên trạng.
 * Dùng supabase service-role (giống hệt logic trong outboundController.adjustInventoryAtomic).
 */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
require(path.join(BASE, 'node_modules', 'dotenv')).config({ path: path.join(BASE, '.env') })
const { Client } = require(path.join(BASE, 'node_modules', 'pg'))
const { createClient } = require(path.join(BASE, 'node_modules', '@supabase', 'supabase-js'))
const supabase = createClient(process.env.SUPABASE_URL, (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/^<|>$/g, ''), { auth: { persistSession: false } })

// Bản sao Y HỆT adjustInventoryAtomic (outboundController) để verify hành vi đua trên DB thật.
async function adjustInventoryAtomic(invId, dRem, dRes) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { data: inv } = await supabase.from('InventoryEntry')
      .select('cartons_remaining, cartons_imported, cartons_reserved').eq('id', invId).single()
    if (!inv) return false
    const curR = Number(inv.cartons_remaining ?? 0), curRes = Number(inv.cartons_reserved ?? 0)
    const newR = Math.max(0, curR + dRem), newRes = Math.max(0, curRes + dRes)
    const { data: applied } = await supabase.from('InventoryEntry')
      .update({ cartons_remaining: newR, cartons_reserved: newRes, updated_at: new Date().toISOString() })
      .eq('id', invId).eq('cartons_remaining', curR).eq('cartons_reserved', curRes).select('id')
    if (applied?.length) return true
    await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
  }
  return false
}

async function restoreOrder(c) {
  const r = await c.query(`UPDATE "TmsOrder" SET date='2026-06-30' WHERE id='9e07d39b-951e-471e-adcc-7119ae5990ed' RETURNING date`)
  console.log('Khôi phục ngày đơn TMS:', r.rows[0]?.date ? 'OK (2026-06-30)' : 'không thấy đơn')
}

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()
  try { await restoreOrder(c) } finally { await c.end() }

  const ID = '9ef1b36b-b7df-48e1-b53e-28b3cf6c2f92' // pallet Ba Vì (267)
  const before = await supabase.from('InventoryEntry').select('cartons_remaining, cartons_reserved, status').eq('id', ID).single()
  const rem0 = Number(before.data.cartons_remaining), res0 = Number(before.data.cartons_reserved)
  console.log(`\nEntry trước: remaining=${rem0}, reserved=${res0}, status=${before.data.status}`)

  const N = 20
  const up = await Promise.all(Array.from({ length: N }, () => adjustInventoryAtomic(ID, 0, +1)))
  const okUp = up.filter(Boolean).length
  const mid = await supabase.from('InventoryEntry').select('cartons_reserved').eq('id', ID).single()
  const resMid = Number(mid.data.cartons_reserved)
  console.log(`Sau ${N} lệnh +1 reserved ĐỒNG THỜI: thành công ${okUp}/${N} | reserved=${resMid} (kỳ vọng ${res0 + N})`)

  // Trả về nguyên trạng
  const down = await Promise.all(Array.from({ length: N }, () => adjustInventoryAtomic(ID, 0, -1)))
  const okDown = down.filter(Boolean).length
  const after = await supabase.from('InventoryEntry').select('cartons_remaining, cartons_reserved, status').eq('id', ID).single()
  console.log(`Sau ${N} lệnh -1 (trả về): thành công ${okDown}/${N} | reserved=${Number(after.data.cartons_reserved)} remaining=${Number(after.data.cartons_remaining)} status=${after.data.status}`)

  const pass = okUp === N && resMid === res0 + N && Number(after.data.cartons_reserved) === res0 && Number(after.data.cartons_remaining) === rem0
  console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — ${pass ? '0 mất cập nhật, tất cả thành công (jitter OK), đã trả nguyên trạng' : 'CÓ lệch — xem số trên'}`)
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
