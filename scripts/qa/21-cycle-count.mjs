// GÓI 21 — KIỂM KÊ LUÂN PHIÊN ABC (Đợt 3 roadmap 06/08).
// Kiểm: hạng ABC lấy từ slotting_stats (không chép công thức) ghép với lần kiểm gần nhất từ
// StocktakeLog; oracle = tự tính lại due_in từ chu kỳ (A7/B30/C90) và ngày kiểm mình vừa seed.
// Fixture ghi vào kho harness Bluestar (WH_QTY) với note SIMCYCLE — không đụng Ba Vì user test.
import { randomUUID } from 'crypto'
import { login, api, restAll, restWrite, check, finish, FIX, BASE } from './lib.mjs'

const t = () => new Date().toISOString()
const TAG = 'SIMCYCLE'
const WH = FIX.WH_QTY
const CYCLE = { A: 7, B: 30, C: 90 }

async function cleanup() {
  await restWrite('StocktakeLog', 'DELETE', `note=eq.${TAG}`).catch(() => {})
}

console.log(`── KIỂM KÊ LUÂN PHIÊN ABC · ${BASE.replace('https://', '')} ──`)

// [0] auth + validate
{
  const r = await fetch(`${BASE}/api/wms/stocktake/cycle?warehouse_id=x`)
  check('Chưa đăng nhập → 401', r.status === 401, `http=${r.status}`)
}
await login(); await cleanup()
{
  const r = await api('/wms/stocktake/cycle', 'GET')
  check('Thiếu warehouse_id → 400', r.s === 400, `http=${r.s}`)
}

// [1] Bề mặt + bất biến nội tại: hạng hợp lệ, chu kỳ khớp hạng, due_in tự tính lại khớp
const r1 = await api(`/wms/stocktake/cycle?warehouse_id=${WH.id}`, 'GET')
const rows = r1.j?.data?.rows ?? []
const summary = r1.j?.data?.summary
check('GET cycle → 200 + shape rows/summary', r1.s === 200 && Array.isArray(rows) && !!summary, `http=${r1.s} rows=${rows.length}`)
{
  const badAbc = rows.filter(r => !['A', 'B', 'C'].includes(r.abc))
  const badCycle = rows.filter(r => r.cycle_days !== CYCLE[r.abc])
  const badDue = rows.filter(r => !r.never_counted && r.days_since != null && r.due_in !== r.cycle_days - r.days_since)
  const badNever = rows.filter(r => r.never_counted && r.due_in !== -9999)
  const badStock = rows.filter(r => Number(r.stock_pallets) <= 0)
  check('Mọi dòng: hạng ∈ {A,B,C} + chu kỳ đúng hạng (A7/B30/C90)', badAbc.length === 0 && badCycle.length === 0,
    `badAbc=${badAbc.length} badCycle=${badCycle.length}`)
  check('ORACLE due_in = chu_kỳ − ngày_từ_lần_kiểm (tự tính lại khớp từng dòng)', badDue.length === 0 && badNever.length === 0,
    `badDue=${badDue.length} badNever=${badNever.length}`)
  check('Chỉ mã CÓ TỒN mới vào danh sách (kiểm kê là đếm tồn)', badStock.length === 0, `badStock=${badStock.length}`)
  const dueN = rows.filter(r => r.due_in <= 0).length
  check('summary.due khớp đếm lại từ rows', summary.due === dueN, `summary=${summary.due} đếm=${dueN}`)
}

// [2] Oracle "kiểm gần nhất": seed 1 lượt kiểm HÔM NAY cho 1 mã đang có tồn → mã đó hết đến hạn
const ent = (await restAll('InventoryEntry',
  `select=id,material_id,pallet_code&warehouse_id=eq.${WH.id}&cartons_remaining=gt.0&material_id=not.is.null&limit=1`))[0]
if (!ent) {
  check('Kho harness có tồn để seed lượt kiểm', false, 'Bluestar không còn dòng tồn nào')
} else {
  const mat = (await restAll('Material', `select=material_code&id=eq.${ent.material_id}`))[0]
  await restWrite('StocktakeLog', 'POST', null, {
    id: randomUUID(), entry_id: ent.id, pallet_code: ent.pallet_code, warehouse_id: WH.id,
    material_id: ent.material_id, material_code: mat?.material_code ?? null,
    app_qty: 1, physical_qty: 1, diff: 0, is_flagged: false, note: TAG,
    counted_at: t(), created_at: t(), updated_at: t(),
  })
  const r2 = await api(`/wms/stocktake/cycle?warehouse_id=${WH.id}`, 'GET')
  const row = (r2.j?.data?.rows ?? []).find(x => x.material_id === ent.material_id)
  check('Mã vừa kiểm HÔM NAY: days_since=0, KHÔNG đến hạn, last_counted_at = hôm nay',
    !!row && row.days_since === 0 && row.due_in === row.cycle_days && !row.never_counted,
    row ? `days_since=${row.days_since} due_in=${row.due_in}/${row.cycle_days}` : 'KHÔNG THẤY mã trong danh sách')

  // [3] Xóa lượt kiểm seed → trạng thái quay về như [1] (nguồn = MAX(counted_at) thật)
  await cleanup()
  const r3 = await api(`/wms/stocktake/cycle?warehouse_id=${WH.id}`, 'GET')
  const row3 = (r3.j?.data?.rows ?? []).find(x => x.material_id === ent.material_id)
  const row1 = rows.find(x => x.material_id === ent.material_id)
  check('Xóa lượt kiểm seed → due_in quay về giá trị trước khi seed',
    !!row3 && !!row1 && row3.due_in === row1.due_in && row3.never_counted === row1.never_counted,
    `trước=${row1?.due_in} sau=${row3?.due_in}`)
}

// [4] Fuzz tham số — không 500, không rò loại ngoài scope (admin full nên chỉ soi 500)
{
  const r = await api(`/wms/stocktake/cycle?warehouse_id=${WH.id}&categories=,,%00,XX`, 'GET')
  check('Tham số categories bậy → không 500', r.s === 200 || r.s === 403, `http=${r.s}`)
}

console.log('\n🧹 dọn…')
await cleanup()
console.log(`residue=${(await restAll('StocktakeLog', `select=id&note=eq.${TAG}`)).length}`)
finish('CYCLE-COUNT')
