/**
 * OPS TEST P3 — seed 100 GDO Outbound khớp 1:1 với 100 KH VC Xuất (Ba Vì, 01/07/2026).
 * Nguyên tắc (user): số GDO = số KH VC, KHÁC nhau ở XE (Outbound không mang biển số của KH VC).
 * Lượng hàng theo LOẠI XE:
 *   - XE PALLET 16-17: 16 pallet Thành phẩm + Loscam×16 + 1 POSM
 *   - XE 4 PALLET:      4 pallet Thành phẩm + Loscam×4  + 1 POSM
 *   - XE XÁ / XE SCA:   ~550 thùng Thành phẩm            + 1 POSM
 *   - XE CONTAINER*:    ~4000 thùng Thành phẩm (2 mã)     (KHÔNG POSM/Loscam)
 * Loscam + POSM chưa có tồn → thêm tồn tạm (cycle='TOB' để DỌN dễ).
 * Dọn: InventoryEntry WHERE cycle='TOB'; GDO WHERE delivery_code LIKE 'DOX0701-%'.
 * Run: cd backend && node ../scripts/_ops_seed_outbound.js
 */
const { supabase } = require('./_upload_util')
const { randomUUID } = require('crypto')

const WH = '56cf7a64-d3aa-4fd2-948d-490ec487acb9'
const DATE = '2026-07-01'
const now = new Date().toISOString()
const LOSCAM = '810000000'
const POSM_CODES = ['710000000', '710000023', '710000034']
const TP_POOL = ['510000084', '610000022', '510000408', '510000397', '510000383', '610000001',
                 '510000009', '510000093', '510000083', '510000114', '510000366', '510000378']

async function selectAll(table, cols, tune) {
  const out = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(cols).range(from, from + 999)
    if (tune) q = tune(q)
    const { data, error } = await q
    if (error) { console.error(`Lỗi nạp ${table}: ${error.message}`); process.exit(1) }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

function classify(vt) {
  const s = String(vt || '').toUpperCase()
  if (s.includes('CONTAINER') || s.includes('CONT')) return 'CONT'
  if (s.includes('16') || s.includes('17'))          return 'PAL16'
  if (s.includes('4 PALLET') || s.includes('4PALLET')) return 'PAL4'
  return 'BULK'   // XE XÁ, XE SCA
}

async function main() {
  // ── Nạp danh mục ──
  const mats = await selectAll('Material', 'id, material_code, category, cartons_per_pallet')
  const byCode = new Map(mats.map(m => [String(m.material_code), m]))
  const midOf = c => byCode.get(c)?.id ?? null
  const catOf = c => byCode.get(c)?.category ?? null
  const cppOf = c => Number(byCode.get(c)?.cartons_per_pallet) || 1
  for (const c of [LOSCAM, ...POSM_CODES, ...TP_POOL]) if (!midOf(c)) { console.error('Thiếu mã hàng:', c); process.exit(1) }

  const locs = await selectAll('Location', 'id, category', q => q.eq('warehouse_id', WH))
  const tpLoc   = locs.find(l => l.category === 'Thành phẩm')?.id
  const posmLoc = locs.find(l => l.category === 'POSM')?.id ?? tpLoc
  if (!tpLoc) { console.error('Không thấy vị trí Thành phẩm ở Ba Vì'); process.exit(1) }

  const dvvts = (await selectAll('TransportCompany', 'name', q => q.eq('type', 'ĐVVT'))).map(c => c.name).filter(Boolean)

  // ── 1) Xóa 2 GDO test (DOTEST0701A/B) ──
  const { data: testDos } = await supabase.from('OutboundDelivery').select('id, gdo_id').like('delivery_code', 'DOTEST0701%')
  const tDoIds = (testDos ?? []).map(d => d.id)
  const tGdoIds = [...new Set((testDos ?? []).map(d => d.gdo_id))]
  if (tDoIds.length) {
    await supabase.from('OutboundItem').delete().in('do_id', tDoIds)
    await supabase.from('OutboundDelivery').delete().in('id', tDoIds)
    await supabase.from('GroupDeliveryOrder').delete().in('id', tGdoIds)
    console.log(`Đã xóa ${tGdoIds.length} GDO test cũ.`)
  }

  // ── 2) Tồn tạm Loscam + POSM (cycle='TOB') — xóa cũ (nếu chạy lại) rồi thêm ──
  await supabase.from('InventoryEntry').delete().eq('cycle', 'TOB')
  const inv = []
  const mkInv = (code, locId, seq, cartons) => ({
    id: randomUUID(), pallet_code: `010726_${code}_TOB_T1_${seq}_B`,
    material_id: midOf(code), warehouse_id: WH, location_id: locId,
    cartons_imported: cartons, cartons_remaining: cartons, cartons_reserved: 0, adjustment_qty: 0,
    stack_layer: 1, status: 'IN_STOCK', origin: 'IMPORT', cycle: 'TOB', machine_code: 'T1',
    production_date: `${DATE}T00:00:00`, nmsx: 'B', import_date: now, created_at: now, updated_at: now,
  })
  for (let i = 1; i <= 60; i++) inv.push(mkInv(LOSCAM, tpLoc, i, 1))         // 60 pallet Loscam (1 đvị/pallet)
  for (const pc of POSM_CODES) for (let i = 1; i <= 12; i++) inv.push(mkInv(pc, posmLoc, i, 500))  // 12 pallet × 500 thùng
  const { error: invErr } = await supabase.from('InventoryEntry').insert(inv)
  if (invErr) { console.error('Lỗi thêm tồn tạm:', invErr.message); process.exit(1) }
  console.log(`Đã thêm ${inv.length} pallet tồn tạm (Loscam + POSM, cycle=TOB).`)

  // ── 3) Đọc 100 KH VC Xuất → tạo 100 GDO ──
  const khvc = await selectAll('TmsOrder', 'order_code, npp_name, vehicle_type',
    q => q.eq('warehouse_id', WH).eq('direction', 'OUTBOUND').eq('date', DATE))
  khvc.sort((a, b) => String(a.order_code).localeCompare(String(b.order_code)))
  console.log(`Đọc ${khvc.length} KH VC Xuất.`)

  const gdoRows = [], doRows = [], itemRows = []
  const mkItem = (doId, code, cartons) => ({
    id: randomUUID(), do_id: doId, material_id: midOf(code), material_code_raw: code,
    cartons_ordered: cartons, boxes_display: 0, weight: null, pallets_estimated: 0, loose_picking: 0,
    material_type: catOf(code), export_type: null, cartons_scanned: 0, status: 'PENDING', updated_at: now,
  })
  const cnt = { PAL16: 0, PAL4: 0, BULK: 0, CONT: 0 }

  khvc.forEach((o, i) => {
    const cls = classify(o.vehicle_type); cnt[cls]++
    const seq = i + 1
    const gid = randomUUID(), did = randomUUID()
    gdoRows.push({
      id: gid, group_code: `20000016_X_010726_${String(seq).padStart(3, '0')}`,
      planned_date: DATE, delivery_date: DATE, warehouse_id: WH,
      dvvt: dvvts[i % dvvts.length], warehouse_type: 'Thành phẩm', shipto_party: null,  // loại kho = loại hàng (KHÔNG phải CENTRAL)
      status: 'PENDING', created_by: 'seed-ops', updated_by: 'seed-ops', updated_at: now,
    })
    doRows.push({
      id: did, gdo_id: gid, delivery_code: `DOX0701-${String(seq).padStart(3, '0')}`,
      distributor_name: o.npp_name ?? null, status: 'PENDING', updated_at: now,
    })
    const tp = TP_POOL[i % TP_POOL.length]
    const posm = POSM_CODES[i % POSM_CODES.length]
    if (cls === 'PAL16') {
      itemRows.push(mkItem(did, tp, 16 * cppOf(tp)), mkItem(did, LOSCAM, 16), mkItem(did, posm, 24))
    } else if (cls === 'PAL4') {
      itemRows.push(mkItem(did, tp, 4 * cppOf(tp)), mkItem(did, LOSCAM, 4), mkItem(did, posm, 24))
    } else if (cls === 'BULK') {
      itemRows.push(mkItem(did, tp, 550), mkItem(did, posm, 24))
    } else { // CONT
      const tp2 = TP_POOL[(i + 1) % TP_POOL.length]
      itemRows.push(mkItem(did, tp, 2000), mkItem(did, tp2, 2000))
    }
  })

  for (const [t, rows] of [['GroupDeliveryOrder', gdoRows], ['OutboundDelivery', doRows], ['OutboundItem', itemRows]]) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from(t).insert(rows.slice(i, i + 500))
      if (error) { console.error(`Lỗi insert ${t}:`, error.message); process.exit(1) }
    }
  }
  console.log(`✅ Tạo ${gdoRows.length} GDO / ${doRows.length} DO / ${itemRows.length} item.`)
  console.log('   Phân loại xe:', cnt)
}
main().catch(e => { console.error(e); process.exit(1) })
