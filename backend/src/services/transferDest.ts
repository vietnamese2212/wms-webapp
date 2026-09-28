/**
 * KHO ĐÍCH của một ship-to — MỘT cửa tra, MỘT chỗ lưu (user chốt 28/09/2026, plan docs/plans/KHO_KHACH_LINK_2026-09-28.md).
 *
 * Kho trong WMS là "plant": ship-to trỏ được tới một kho (`Customer.warehouse_id`) thì chuyến tới đó chạy tiếp
 * (kế hoạch nhập, hình thức nhận theo `inventory_mode` của kho); không trỏ ⇒ luồng dừng ở Hoàn thành (OTHER).
 *
 * Vì sao chỉ còn MỘT đường: bản trước tra ba nấc — khách trỏ kho → `Warehouse.code`/`shipto_codes` → **dò TÊN khách
 * trùng tên kho**. Đo staging 28/09: 149 dòng Kho NPP seed một lần (code = ship-to cũ) chỉ 7 còn khớp danh mục Khách,
 * 1 lệch nghĩa (10000099: Kho "Mỹ Phát" ↔ Khách "Đại lý Minh Châu"), 0/154 kho khai `shipto_codes`, 0/213 khách trỏ
 * kho ⇒ đường thật sự chạy là dò tên: đổi tên kho là luật chuyển kho đổi âm thầm. Nay dò tên chỉ còn là GỢI Ý
 * (`unlinkedHint`) để màn hình nhắc / chặn theo cấu hình của kho xuất, không bao giờ tự nối.
 *
 * Tự nối duy nhất theo ĐỊNH DANH: ship-to trùng `Warehouse.code` của kho đang hoạt động (`linkCustomersByWarehouseCode`).
 */
import { db } from '../lib/supabase'
import { fetchAllByIdChunks, fetchAllRowsParallel } from '../utils/pagination'
import { normShipto } from './dateRulePolicy'

export type DestWh = { id: string; code: string; name: string; inventory_mode: string | null; parent_warehouse_id: string | null }
export type UnlinkedHint = { warehouse_id: string; warehouse_name: string }
export type DestInfo = { dest: DestWh | null; hint: UnlinkedHint | null }
export type UnlinkedPolicy = 'NONE' | 'WARN' | 'BLOCK'

type CustLite = { ship_to_code: string; name: string | null; warehouse_id: string | null; is_active: boolean | null }
type WhLite = DestWh & { is_active: boolean | null }

// ─── Phần THUẦN (test đơn vị tests/unit/transferDest.test.ts) ─────────────────────────────────────
/** Kho đích: khách đang hoạt động, có trỏ kho, kho đang hoạt động — không có nấc nào khác. */
export function pickDest(cust: CustLite | null | undefined, whById: ReadonlyMap<string, WhLite>): DestWh | null {
  if (!cust || cust.is_active === false || !cust.warehouse_id) return null
  const w = whById.get(cust.warehouse_id)
  if (!w || w.is_active === false) return null
  return { id: w.id, code: w.code, name: w.name, inventory_mode: w.inventory_mode ?? null, parent_warehouse_id: w.parent_warehouse_id ?? null }
}
/** Gợi ý "trông như kho WMS mà chưa trỏ": khách chưa trỏ kho và TÊN trùng đúng MỘT kho đang hoạt động. */
export function unlinkedHint(cust: CustLite | null | undefined, whs: readonly WhLite[]): UnlinkedHint | null {
  if (!cust || cust.is_active === false || cust.warehouse_id) return null
  const key = String(cust.name ?? '').trim().toLowerCase()
  if (!key) return null
  const hits = whs.filter(w => w.is_active !== false && String(w.name ?? '').trim().toLowerCase() === key)
  return hits.length === 1 ? { warehouse_id: hits[0].id, warehouse_name: hits[0].name } : null
}
export const asUnlinkedPolicy = (v: unknown): UnlinkedPolicy => (v === 'WARN' || v === 'BLOCK' ? v : 'NONE')

// ─── Phần DB ──────────────────────────────────────────────────────────────────────────────────────
async function activeWarehouses(): Promise<WhLite[]> {
  const rows = await fetchAllRowsParallel(() => db.from('Warehouse')
    .select('id, code, name, inventory_mode, parent_warehouse_id, is_active').order('id'))
  return (rows as unknown as WhLite[])
}

/** Kho đích + gợi ý của NHIỀU ship-to trong hai truy vấn (list chuyến, bảng Xem đơn). */
export async function destInfoForShiptos(shiptos: (string | null | undefined)[]): Promise<Map<string, DestInfo>> {
  const out = new Map<string, DestInfo>()
  const codes = [...new Set(shiptos.map(s => normShipto(s)).filter((x): x is string => !!x))]
  if (!codes.length) return out
  const [custs, whs] = await Promise.all([
    fetchAllByIdChunks(codes, c => db.from('Customer').select('ship_to_code, name, warehouse_id, is_active').in('ship_to_code', c).order('ship_to_code')) as Promise<CustLite[]>,
    activeWarehouses(),
  ])
  const whById = new Map(whs.map(w => [w.id, w]))
  const custBy = new Map(custs.map(c => [c.ship_to_code, c]))
  for (const code of codes) {
    const c = custBy.get(code)
    out.set(code, { dest: pickDest(c, whById), hint: unlinkedHint(c, whs) })
  }
  return out
}

export async function destInfoOfShipto(shipto: string | null | undefined): Promise<DestInfo> {
  const code = normShipto(shipto)
  if (!code) return { dest: null, hint: null }
  return (await destInfoForShiptos([code])).get(code) ?? { dest: null, hint: null }
}
export const destWarehouseOfShipto = async (shipto: string | null | undefined): Promise<DestWh | null> => (await destInfoOfShipto(shipto)).dest

/**
 * Tự nối theo mã: khách CHƯA trỏ kho mà `ship_to_code` = `Warehouse.code` của kho đang hoạt động ⇒ trỏ vào kho đó.
 * `onlyCodes` = chỉ xét các ship-to này (lúc ZSD02 vừa sinh khách / lúc tạo-đổi mã kho); null = quét cả danh mục.
 * Khách đã trỏ kho khác thì GIỮ (người khai thắng máy). Trả số khách vừa nối.
 */
export async function linkCustomersByWarehouseCode(onlyCodes: string[] | null, actor: string | null): Promise<number> {
  const whs = (await activeWarehouses()).filter(w => w.is_active !== false)
  const whByCode = new Map(whs.map(w => [String(w.code).trim().toUpperCase(), w.id]))
  if (!whByCode.size) return 0
  const codes = onlyCodes
    ? [...new Set(onlyCodes.map(c => normShipto(c)).filter((x): x is string => !!x && whByCode.has(x)))]
    : [...whByCode.keys()]
  if (!codes.length) return 0
  const custs = await fetchAllByIdChunks(codes, c => db.from('Customer').select('id, ship_to_code, warehouse_id').in('ship_to_code', c).is('warehouse_id', null).order('ship_to_code')) as { id: string; ship_to_code: string }[]
  const t = new Date().toISOString()
  let n = 0
  for (const c of custs) {
    const whId = whByCode.get(String(c.ship_to_code).trim().toUpperCase())
    if (!whId) continue
    const { error } = await db.from('Customer').update({ warehouse_id: whId, updated_by: actor, updated_at: t }).eq('id', c.id).is('warehouse_id', null)
    if (error) throw new Error(error.message)
    n++
  }
  return n
}
