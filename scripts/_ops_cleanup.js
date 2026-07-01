/** DỌN SẠCH test vận hành Ba Vì 01/07: revert tồn thật đã đụng + xóa scaffolding (GDO/gate/slot/booking/inbound test).
 *  pg + DIRECT_URL, chạy trong 1 transaction. */
const path = require('path')
const BASE = path.join(__dirname, '..', 'backend')
require(path.join(BASE, 'node_modules', 'dotenv')).config({ path: path.join(BASE, '.env') })
const { Client } = require(path.join(BASE, 'node_modules', 'pg'))
const WH = '56cf7a64-d3aa-4fd2-948d-490ec487acb9'
const MIX = ['b4a06648-e3a1-4da5-af90-a3c711abe96a','72ee88a7-8d63-40d9-acc1-27d5f454fde7','b74d67d6-d504-4f47-8f9b-160be69a032f','cd437fe2-3a3d-46da-8ebf-66770bb4b9fc','9ef1b36b-b7df-48e1-b53e-28b3cf6c2f92','6b36407c-7668-4ecf-b077-04c65a6b9d58']

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  await c.connect()
  const log = {}
  try {
    await c.query('BEGIN')
    // 1) Nhả booking test (2 vehicle-slot của KH VC 01/07 đã gắn slot) — trước khi xóa DeliverySlot (FK)
    log.release = (await c.query(`UPDATE "TmsVehicleSlot" vs SET slot_id=NULL, license_plate=NULL, status='PENDING', driver_name=NULL, driver_phone=NULL
      FROM "TmsOrder" o WHERE o.id=vs.order_id AND o.warehouse_id=$1 AND o.direction='OUTBOUND' AND o.date='2026-07-01' AND vs.slot_id IS NOT NULL`, [WH])).rowCount
    // 2) Xóa scaffolding Outbound test (DOX0701-*)
    const dos = await c.query(`SELECT od.id, od.gdo_id FROM "OutboundDelivery" od WHERE od.delivery_code LIKE 'DOX0701-%'`)
    const doIds = dos.rows.map(r => r.id), gdoIds = [...new Set(dos.rows.map(r => r.gdo_id))]
    if (doIds.length) {
      log.scanEntry = (await c.query(`DELETE FROM "OutboundScanEntry" WHERE item_id IN (SELECT id FROM "OutboundItem" WHERE do_id = ANY($1))`, [doIds])).rowCount
      log.item = (await c.query(`DELETE FROM "OutboundItem" WHERE do_id = ANY($1)`, [doIds])).rowCount
      log.do = (await c.query(`DELETE FROM "OutboundDelivery" WHERE id = ANY($1)`, [doIds])).rowCount
      log.gdo = (await c.query(`DELETE FROM "GroupDeliveryOrder" WHERE id = ANY($1)`, [gdoIds])).rowCount
    }
    // 3) Gate test (Ba Vì 01/07 — baseline 0)
    log.gate = (await c.query(`DELETE FROM gate_registrations WHERE warehouse_id=$1 AND date='2026-07-01'`, [WH])).rowCount
    // 4) DeliverySlot test (Ba Vì 01/07 + 02/07 — baseline 0)
    log.slot = (await c.query(`DELETE FROM "DeliverySlot" WHERE warehouse_id=$1 AND date IN ('2026-07-01','2026-07-02')`, [WH])).rowCount
    // 5) Inbound test: entry cycle=TOB + phiếu nhập test
    log.invTOB = (await c.query(`DELETE FROM "InventoryEntry" WHERE cycle='TOB'`)).rowCount
    log.prodImp = (await c.query(`DELETE FROM "ProductionImport" WHERE id='57456588-801b-41fb-858d-2498ec291d50'`)).rowCount
    // 6) Revert tồn THẬT đã đụng
    log.rev_adj1 = (await c.query(`UPDATE "InventoryEntry" SET cartons_remaining=7004.875, adjustment_qty=0, status='IN_STOCK' WHERE id='39f771ef-26f8-45c5-84d7-715515394298'`)).rowCount
    log.rev_mix = (await c.query(`UPDATE "InventoryEntry" SET cartons_remaining=cartons_remaining-5, adjustment_qty=0, status='IN_STOCK' WHERE id = ANY($1)`, [MIX])).rowCount
    log.rev_exp = (await c.query(`UPDATE "InventoryEntry" SET cartons_remaining=1, status='IN_STOCK' WHERE id='0dd3830c-0a30-49a6-9fb6-c9e2b896dd68'`)).rowCount
    await c.query('COMMIT')
    console.log('DỌN XONG:', JSON.stringify(log, null, 2))
  } catch (e) { await c.query('ROLLBACK'); console.error('ROLLBACK:', e.message); process.exit(1) }
  finally { await c.end() }
}
main().catch(e => { console.error(e); process.exit(1) })
