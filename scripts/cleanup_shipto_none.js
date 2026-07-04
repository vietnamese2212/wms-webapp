/**
 * Dọn shipto_party sai: các đơn PENDING/PAUSED/IN_PROGRESS đang trỏ shipto vào kho KHÔNG theo dõi tồn
 * (NPP / khách hàng inventory_mode=NONE) — SAP điền mã ship-to khách hàng, bị khớp nhầm thành shipto → null.
 * KHÔNG đụng đơn đã tạo chuyển kho (transfer_status IS NOT NULL) hay COMPLETED.
 * Run: cd backend && node ../scripts/cleanup_shipto_none.js
 */
const { supabase } = require('./_upload_util')

;(async () => {
  // Kho theo dõi tồn (QR/QTY) — shipto trỏ vào đây mới hợp lệ
  const { data: whs, error: whErr } = await supabase
    .from('Warehouse').select('code, shipto_codes, inventory_mode')
  if (whErr) { console.error('ERR load warehouses:', whErr.message); process.exit(1) }
  const validShipto = new Set()
  for (const w of whs) {
    if (w.inventory_mode === 'NONE') continue
    validShipto.add(String(w.code).trim())
    for (const sc of (w.shipto_codes ?? [])) { const s = String(sc).trim(); if (s) validShipto.add(s) }
  }

  // Đơn có shipto, chưa hoàn thành, chưa tạo chuyển kho
  const { data: gdos, error: gErr } = await supabase
    .from('GroupDeliveryOrder')
    .select('id, group_code, shipto_party, status, transfer_status')
    .not('shipto_party', 'is', null)
    .is('transfer_status', null)
    .neq('status', 'COMPLETED')
  if (gErr) { console.error('ERR load gdos:', gErr.message); process.exit(1) }

  const bad = gdos.filter(g => !validShipto.has(String(g.shipto_party).trim()))
  console.log(`Tổng đơn có shipto (chưa hoàn thành, chưa chuyển kho): ${gdos.length}`)
  console.log(`→ shipto trỏ kho NONE/khách hàng (sẽ null): ${bad.length}`)
  for (const g of bad) console.log(`  • ${g.group_code} [${g.status}] shipto=${g.shipto_party}`)

  if (!bad.length) { console.log('Không có gì để dọn.'); return }

  const ids = bad.map(g => g.id)
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300)
    const { error } = await supabase.from('GroupDeliveryOrder')
      .update({ shipto_party: null, updated_at: new Date().toISOString() })
      .in('id', chunk)
    if (error) { console.error('ERR update:', error.message); process.exit(1) }
  }
  console.log(`✓ Đã null shipto_party cho ${ids.length} đơn.`)
})()
