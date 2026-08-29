// GÓI RACE — đua đồng thời trên cùng tài nguyên, bất biến số liệu phải giữ.
// Tự dọn về baseline khi xong. Kho: Bluestar (QTY, mã pool 510000306).
import { login, api, check, finish, pool, teardownGdo, restAll, restWrite, resolveFixtures, FIX } from './lib.mjs'
import { randomUUID } from 'crypto'

console.log('── GÓI RACE ──')
await login()
await resolveFixtures()

// Đọc pool thẳng DB (PostgREST) — không phụ thuộc shape API list
async function poolRemaining() {
  const rows = await restAll('InventoryEntry',
    `select=cartons_remaining&warehouse_id=eq.${FIX.WH_QTY.id}&pallet_code=eq.${FIX.MAT_POOL}`)
  return rows.reduce((s, r) => s + Number(r.cartons_remaining ?? 0), 0)
}

// TỰ DỰNG pool nếu kho QTY chưa có tồn cho mã test (sau reset dữ liệu là rỗng).
// Gói test không được phụ thuộc tồn kho "có sẵn" — nó tự tạo, tự xoá.
let seededPoolId = null
if ((await poolRemaining()) === 0) {
  const now = new Date().toISOString()
  const [row] = await restWrite('InventoryEntry', 'POST', null, {
    id: randomUUID(), material_id: FIX.MAT_POOL_ID, pallet_code: FIX.MAT_POOL,
    warehouse_id: FIX.WH_QTY.id, location_id: null,
    cartons_imported: 500, cartons_remaining: 500, cartons_reserved: 0,
    status: 'IN_STOCK', stack_layer: 1,
    import_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
    notes: FIX.DVVT_TAG, created_at: now, updated_at: now,
  })
  seededPoolId = row?.id ?? null
  console.log(`  (đã dựng pool test 500 cho ${FIX.MAT_POOL}@${FIX.WH_QTY.name} — sẽ xoá khi xong)`)
}
const pool0 = await poolRemaining()
console.log(`  pool ${FIX.MAT_POOL}@${FIX.WH_QTY.name} baseline = ${pool0}`)

async function createPending(cartons) {
  const c = await api('/wms/outbound', 'POST', {
    delivery_date: FIX.EXEC_DATE, warehouse_id: FIX.WH_QTY.id, dvvt: FIX.DVVT_TAG,   // sẽ Xuất luôn → phải ngày hôm nay (luật FUTURE_DATE 02/08)
    customer_name: 'An Sơn', shipto_party: FIX.WH_NONE.code,
    delivery_code: 'RACE-' + Math.floor(Math.random() * 1e9),
    items: [{ material_code: FIX.MAT_POOL, cartons_ordered: cartons }],
  })
  return c.j?.data
}
async function trfCount(gdoId) {
  const { j } = await api(`/tms/orders?source_type=TRANSFER`, 'GET')
  return (j?.data ?? []).filter(o => o.transfer_gdo?.id === gdoId).length
}

// ── BÀI 1: 10× "Xuất luôn" đồng thời cùng 1 GDO ──
{
  const CARTONS = 7
  const gdo = await createPending(CARTONS)
  check('R1 tạo GDO PENDING', !!gdo?.id)
  const rs = await pool(Array.from({ length: 10 }, (_, i) => () =>
    api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: `88R-${1000 + i}` })), 10)
  const codes = rs.map(r => r.s)
  const g = await api(`/wms/outbound/${gdo.id}`, 'GET')
  const item = g.j?.data?.delivery_orders?.[0]?.items?.[0]
  check('R1 GDO COMPLETED sau đua', g.j?.data?.status === 'COMPLETED', `codes=${JSON.stringify(codes)}`)
  check('R1 ghi nhận đúng 1 lần', Number(item?.cartons_scanned) === CARTONS && (item?.scan_entries?.length ?? 0) === 1,
    `scanned=${item?.cartons_scanned} entries=${item?.scan_entries?.length}`)
  check('R1 đúng 1 lệnh chuyển kho', (await trfCount(gdo.id)) === 1)
  const p1 = await poolRemaining()
  check('R1 pool trừ ĐÚNG 1 lần', p1 === pool0 - CARTONS, `${pool0} → ${p1} (kỳ vọng ${pool0 - CARTONS})`)
  check('R1 dọn sạch', await teardownGdo(gdo.id, 'COMPLETED'))
}

// ── BÀI 2: 10× Hoàn thành (patchGDO) đồng thời sau khi Bỏ HT ──
{
  const gdo = await createPending(2)
  await api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88R-2000' })
  await api(`/wms/outbound/${gdo.id}/uncomplete`, 'POST')
  const rs = await pool(Array.from({ length: 10 }, () => () =>
    api(`/wms/outbound/${gdo.id}`, 'PATCH', { status: 'COMPLETED' })), 10)
  const g = await api(`/wms/outbound/${gdo.id}`, 'GET')
  check('R2 10× Hoàn thành đồng thời → COMPLETED', g.j?.data?.status === 'COMPLETED',
    `codes=${JSON.stringify(rs.map(r => r.s))}`)
  check('R2 vẫn đúng 1 lệnh chuyển kho (sync, không nhân bản)', (await trfCount(gdo.id)) === 1)
  const p2 = await poolRemaining()
  check('R2 tồn không đổi khi HT lại (không trừ thêm)', p2 === pool0 - 2, `pool=${p2} (kỳ vọng ${pool0 - 2})`)
  check('R2 dọn sạch', await teardownGdo(gdo.id, 'COMPLETED'))
}

// ── BÀI 3: Bỏ HT ↔ Xuất luôn ↔ Hoàn thành bắn XEN KẼ đồng thời ──
{
  const gdo = await createPending(3)
  await api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88R-3000' })
  const mixed = [
    () => api(`/wms/outbound/${gdo.id}/uncomplete`, 'POST'),
    () => api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88R-3001' }),
    () => api(`/wms/outbound/${gdo.id}`, 'PATCH', { status: 'COMPLETED' }),
    () => api(`/wms/outbound/${gdo.id}/uncomplete`, 'POST'),
    () => api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88R-3002' }),
  ]
  await pool(mixed, 5)
  // Chốt lại về COMPLETED cho xác định rồi kiểm bất biến
  await api(`/wms/outbound/${gdo.id}/quick-export`, 'POST', { license_plate: '88R-3003' })
  const g = await api(`/wms/outbound/${gdo.id}`, 'GET')
  const item = g.j?.data?.delivery_orders?.[0]?.items?.[0]
  const okState = ['COMPLETED', 'IN_PROGRESS', 'PENDING'].includes(g.j?.data?.status)
  check('R3 xen kẽ không phá trạng thái', okState && Number(item?.cartons_scanned) <= 3,
    `status=${g.j?.data?.status} scanned=${item?.cartons_scanned}`)
  check('R3 tối đa 1 lệnh chuyển kho', (await trfCount(gdo.id)) <= 1)
  check('R3 dọn sạch', await teardownGdo(gdo.id, g.j?.data?.status))
  const p3 = await poolRemaining()
  check('R3 pool về baseline sau dọn', p3 === pool0, `pool=${p3} (baseline ${pool0})`)
}

// ── BÀI 4: NHIỀU NGƯỜI CÙNG QUÉT MỘT DÒNG HÀNG → KHÔNG ĐƯỢC XUẤT VƯỢT KẾ HOẠCH ──
// Bug thật 29/08 (kho QR Ba Vì): trần "còn được quét bao nhiêu" đọc từ bản chụp item ở đầu hàm,
// cộng dồn mãi cuối hàm mới làm ⇒ 3 người quét đồng thời dòng đặt 240 đều được 200 → ghi 720/240
// và trừ tồn 720 = xuất thừa 3 lần lên xe. Tuần tự thì chặn đúng, nên chỉ đông người mới lộ.
{
  const T4 = 'RACE4'
  const nowIso = () => new Date().toISOString()
  const cleanup4 = async () => {
    // Xoá vết quét TRƯỚC khi gỡ chuyến: "Bỏ bắt đầu" của app chặn khi còn QR đã quét
    // ("Cần xóa hết QR đã quét trước khi gỡ bắt đầu") — đúng luật, nên dọn phải theo thứ tự đó.
    await restWrite('OutboundScanEntry', 'DELETE', `pallet_code=like.*${T4}*`).catch(() => {})
    for (const g of await restAll('GroupDeliveryOrder', `select=id,status&license_plate=like.${T4}*`))
      await teardownGdo(g.id, g.status)
    await restWrite('InventoryEntry', 'DELETE', `pallet_code=like.*${T4}*`).catch(() => {})
    for (const l of await restAll('Location', `select=id&location_code=like.${T4}-*`))
      await restWrite('Location', 'DELETE', `id=eq.${l.id}`).catch(() => {})
  }
  await cleanup4()
  const [loc4] = await restWrite('Location', 'POST', null, {
    id: randomUUID(), location_code: `${T4}-L`, warehouse_id: FIX.WH_QR.id, max_pallets: 20,
    is_active: true, row: T4, shelf: '1', sub_code: `${T4}-L`, categories: [FIX.MAT_POOL_CAT],
    created_at: nowIso(), updated_at: nowIso(),
  })
  const Q4 = 60, N4 = 3
  const codes = []
  for (let i = 1; i <= N4; i++) {
    const code = `010126_${FIX.MAT_POOL}_${T4}_M1_${String(i).padStart(3, '0')}_B`
    await restWrite('InventoryEntry', 'POST', null, {
      id: randomUUID(), pallet_code: code, material_id: FIX.MAT_POOL_ID, warehouse_id: FIX.WH_QR.id,
      location_id: loc4.id, cartons_imported: Q4, cartons_remaining: Q4, cartons_reserved: 0,
      status: 'IN_STOCK', production_date: '2026-01-01',
      import_date: FIX.EXEC_DATE, created_at: nowIso(), updated_at: nowIso(),
    })
    codes.push(code)
  }
  const c4 = await api('/wms/outbound', 'POST', {
    delivery_date: FIX.EXEC_DATE, warehouse_id: FIX.WH_QR.id, dvvt: FIX.DVVT_TAG,
    customer_name: `${T4} NPP`, delivery_code: `${T4}-${Math.floor(Math.random() * 1e6)}`,
    items: [{ material_code: FIX.MAT_POOL, cartons_ordered: Q4 }],   // đặt ĐÚNG 1 pallet
  })
  const gid = c4.j?.data?.id
  await api(`/wms/outbound/${gid}/assign`, 'POST', {})
  await api(`/wms/outbound/${gid}/start`, 'POST', { license_plate: `${T4}XE1` })
  const det = await api(`/wms/outbound/${gid}`)
  const it4 = (det.j?.data?.delivery_orders ?? []).flatMap(x => x.items ?? [])[0]
  const rs4 = await Promise.all(codes.map(code =>
    api(`/wms/outbound/${gid}/items/${it4.id}/scan`, 'POST',
      { qr_code: code, leftover_ui: true, leftover_location_id: 'KEEP' })))
  const [after4] = await restAll('OutboundItem', `select=cartons_ordered,cartons_scanned&id=eq.${it4.id}`)
  const inv4 = await restAll('InventoryEntry', `select=cartons_remaining&pallet_code=like.*${T4}*`)
  const consumed4 = inv4.reduce((s, e) => s + (Q4 - Number(e.cartons_remaining)), 0)
  check(`R4 ${N4} người quét đồng thời 1 dòng hàng: KHÔNG quét vượt kế hoạch`,
    Number(after4?.cartons_scanned) <= Number(after4?.cartons_ordered),
    `đã quét ${after4?.cartons_scanned}/${after4?.cartons_ordered} · HTTP ${rs4.map(r => r.s).join(',')}`)
  check('R4 tồn bị trừ đúng bằng số đã quét (không xuất thừa khỏi kệ)',
    consumed4 === Number(after4?.cartons_scanned), `trừ ${consumed4} · quét ${after4?.cartons_scanned}`)
  await cleanup4()
  const left4 = (await restAll('InventoryEntry', `select=id&pallet_code=like.*${T4}*`)).length
    + (await restAll('GroupDeliveryOrder', `select=id&license_plate=like.${T4}*`)).length
  check('R4 dọn sạch', left4 === 0, `còn ${left4}`)
}

// Xoá pool tự dựng — trả staging về đúng trạng thái trước khi chạy
if (seededPoolId) {
  await restWrite('InventoryEntry', 'DELETE', `id=eq.${seededPoolId}`)
  const left = await poolRemaining()
  check('R0 dọn pool test đã dựng', left === 0, `còn ${left}`)
}

finish('RACE')
