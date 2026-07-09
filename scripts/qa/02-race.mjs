// GÓI RACE — đua đồng thời trên cùng tài nguyên, bất biến số liệu phải giữ.
// Tự dọn về baseline khi xong. Kho: Bluestar (QTY, mã pool 510000306).
import { login, api, check, finish, pool, teardownGdo, restAll, FIX } from './lib.mjs'

console.log('── GÓI RACE ──')
await login()

// Đọc pool thẳng DB (PostgREST) — không phụ thuộc shape API list
async function poolRemaining() {
  const rows = await restAll('InventoryEntry',
    `select=cartons_remaining&warehouse_id=eq.${FIX.WH_QTY.id}&pallet_code=eq.${FIX.MAT_POOL}`)
  return rows.reduce((s, r) => s + Number(r.cartons_remaining ?? 0), 0)
}
const pool0 = await poolRemaining()
console.log(`  pool ${FIX.MAT_POOL}@${FIX.WH_QTY.name} baseline = ${pool0}`)

async function createPending(cartons) {
  const c = await api('/wms/outbound', 'POST', {
    delivery_date: FIX.DATE, warehouse_id: FIX.WH_QTY.id, dvvt: FIX.DVVT_TAG,
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

finish('RACE')
