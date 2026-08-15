// GÓI 24 — NẠP PHIẾU CÂN NHIỀU TRẠM (14/08). Luật "bug chết hai lần" cho lỗ hổng user chỉ ra:
// đơn vị lấy dữ liệu từ NHIỀU trạm cân ở NHIỀU kho, mà trước 14/08 backend có "mã trạm MẶC ĐỊNH"
// dùng chung cả hệ thống. `source_id` của phần mềm cân là autonumber đếm từ 1 ở MỖI trạm, nên
// hai trạm mang cùng mã sẽ ĐÈ phiếu của nhau qua khóa upsert (station_code, source_id) —
// mất phiếu ÂM THẦM. Nay: mã trạm BẮT BUỘC do agent khai + chặn 1 mã trạm dùng cho 2 kho.
// Tự tạo API key + 2 kho tag QAWEIGH, tự dọn.
import { login, api, check, finish, restWrite, restAll, BASE } from './lib.mjs'
import { randomUUID } from 'crypto'

console.log('── GÓI WEIGH-STATION (nạp phiếu cân nhiều trạm) ──')
await login()
const now = () => new Date().toISOString()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const ST1 = 'QAWEIGH1', ST2 = 'QAWEIGH2'

let keyId = null
async function cleanup() {
  await restWrite('WeighTicket', 'DELETE', `station_code=in.(${ST1},${ST2})`)
  const whs = await restAll('Warehouse', `select=id&code=like.QAWEIGH*`)
  if (whs.length) await restWrite('Warehouse', 'DELETE', `code=like.QAWEIGH*`)
  const keys = await restAll('ApiKey', `select=id&name=like.QAWEIGH*`)
  for (const k of keys) {
    await api(`/wms/integration-keys/${k.id}/revoke`, 'PATCH')
    await api(`/wms/integration-keys/${k.id}`, 'DELETE')
  }
}
await cleanup()

const mkWh = async (code) => (await restWrite('Warehouse', 'POST', null, {
  id: randomUUID(), code, name: `QA weigh ${code}`, warehouse_type: 'CENTRAL', inventory_mode: 'QTY',
  is_active: true, updated_at: now(),
}))[0].id
const whA = await mkWh('QAWEIGH_A'), whB = await mkWh('QAWEIGH_B')

const created = await api('/wms/integration-keys', 'POST', { name: 'QAWEIGH agent test', scopes: ['weigh:write'] })
const apiKey = created.j?.data?.key
keyId = created.j?.data?.id
check('Tạo API key scope weigh:write', created.s === 201 && !!apiKey, `http=${created.s}`)

// Gọi cổng tích hợp bằng X-API-Key (KHÔNG dùng JWT — đây là đường agent trạm cân đi)
async function ingest(body) {
  const r = await fetch(`${BASE}/api/integration/v1/weigh/tickets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey ?? '' },
    body: JSON.stringify(body),
  })
  let j = null
  try { j = JSON.parse(await r.text()) } catch { /* không phải JSON */ }
  return { s: r.status, j }
}
const ticket = (id, plate) => ({
  id, OrderNum: `QAW-${id}`, GDate: today.split('-').reverse().join('/'),
  TruckNum: plate, GoodsName: 'QA test', GrossWeight: 30000, TareWeight: 12000, NetWeight: 18000,
  ImExType: 'Cân Xuất',
})

// [1] Mã trạm BẮT BUỘC — thiếu/rỗng phải 400, KHÔNG được rơi về một mã mặc định nào
{
  const r1 = await ingest({ warehouse_id: whA, tickets: [ticket(1, 'QAW-0001')] })
  check('Thiếu station_code → 400 (không có mã trạm mặc định)', r1.s === 400, `http=${r1.s} code=${r1.j?.error?.code}`)
  const r2 = await ingest({ station_code: '   ', warehouse_id: whA, tickets: [ticket(1, 'QAW-0001')] })
  check('station_code toàn khoảng trắng → 400', r2.s === 400, `http=${r2.s}`)
  const r3 = await ingest({ station_code: 'X'.repeat(21), warehouse_id: whA, tickets: [ticket(1, 'QAW-0001')] })
  check('station_code quá 20 ký tự → 400', r3.s === 400, `http=${r3.s}`)
}

// [2] Trạm 1 nạp bình thường
{
  const r = await ingest({ station_code: ST1, warehouse_id: whA, tickets: [ticket(1, 'QAW-0001'), ticket(2, 'QAW-0002')] })
  check('Trạm 1 nạp 2 phiếu → 200', r.s === 200, `http=${r.s} ${JSON.stringify(r.j?.error ?? '').slice(0, 120)}`)
  const rows = await restAll('WeighTicket', `select=source_id&station_code=eq.${ST1}`)
  check('Trạm 1 lưu đủ 2 phiếu', rows.length === 2, `có ${rows.length}`)
}

// [3] LƯỚI BẮT "cài agent trạm mới mà quên đổi mã": cùng mã trạm nhưng KHÁC KHO → 409, không ghi
{
  const r = await ingest({ station_code: ST1, warehouse_id: whB, tickets: [ticket(1, 'QAW-9999')] })
  check('Cùng mã trạm nhưng kho khác → 409 STATION_CODE_CONFLICT',
    r.s === 409 && r.j?.error?.code === 'STATION_CODE_CONFLICT', `http=${r.s} code=${r.j?.error?.code}`)
  const t1 = await restAll('WeighTicket', `select=license_plate&station_code=eq.${ST1}&source_id=eq.1`)
  check('Phiếu của trạm 1 KHÔNG bị đè bởi lần gọi bị chặn',
    t1[0]?.license_plate === 'QAW-0001', `biển=${t1[0]?.license_plate}`)
}

// [4] Trạm 2 (mã riêng) dùng source_id TRÙNG 1,2 — phải là phiếu RIÊNG, không đè trạm 1
{
  const r = await ingest({ station_code: ST2, warehouse_id: whB, tickets: [ticket(1, 'QAW-2001'), ticket(2, 'QAW-2002')] })
  check('Trạm 2 nạp source_id trùng số → 200', r.s === 200, `http=${r.s}`)
  const all = await restAll('WeighTicket', `select=station_code,source_id,license_plate&station_code=in.(${ST1},${ST2})`)
  check('2 trạm giữ 4 phiếu ĐỘC LẬP (không đè nhau)', all.length === 4, `có ${all.length}`)
  const keep = all.find(t => t.station_code === ST1 && t.source_id === 1)
  check('Phiếu trạm 1 vẫn nguyên biển số của nó', keep?.license_plate === 'QAW-0001', `biển=${keep?.license_plate}`)
}

// [5] Nạp lại chính lô của trạm mình = upsert vô hại (agent gửi lại sau mất mạng)
{
  const r = await ingest({ station_code: ST1, warehouse_id: whA, tickets: [ticket(1, 'QAW-0001')] })
  const rows = await restAll('WeighTicket', `select=source_id&station_code=eq.${ST1}`)
  check('Agent gửi lại lô cũ → 200 và KHÔNG nhân bản', r.s === 200 && rows.length === 2, `http=${r.s} rows=${rows.length}`)
}

await cleanup()
{
  const left = await restAll('WeighTicket', `select=id&station_code=in.(${ST1},${ST2})`)
  const whs = await restAll('Warehouse', `select=id&code=like.QAWEIGH*`)
  const keys = await restAll('ApiKey', `select=id&name=like.QAWEIGH*`)
  check('Dọn sạch fixture (phiếu + kho + API key)',
    left.length === 0 && whs.length === 0 && keys.length === 0,
    `phiếu=${left.length} kho=${whs.length} key=${keys.length}`)
}

finish('WEIGH-STATION')
