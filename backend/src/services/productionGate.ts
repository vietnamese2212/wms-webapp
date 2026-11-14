// MES 14/11 — mức kiểm QA khi RÚT bán thành phẩm khỏi một bồn (cho trang sổ đóng gói).
// MỘT chỗ ghép tầng cho mọi cửa rút (đóng trang sổ, rút tay ở màn Bồn) — đừng đọc thẳng Warehouse.production_qa_gate.
import { db } from '../lib/supabase'
import { resolveProductionQaGate, type ProductionQaGate, type WhTypeConfigRow } from '../utils/putaway'

export async function qaGateOfTank(tankId: string): Promise<ProductionQaGate> {
  const { data: tank } = await db.from('production_tank').select('id, warehouse_id').eq('id', tankId).maybeSingle()
  if (!tank) return 'WARN'
  // bồn chỉ chứa MỘT mã BTP (hàm nạp chặn trộn) ⇒ loại kho = category của mã đó
  const { data: lot } = await db.from('tank_lot').select('batch_id').eq('tank_id', tankId).eq('status', 'ACTIVE').limit(1).maybeSingle()
  let category: string | null = null
  if (lot) {
    const { data: b } = await db.from('production_batch').select('material:Material!production_batch_material_id_fkey(category)').eq('id', lot.batch_id).maybeSingle()
    category = (b?.material as unknown as { category: string | null } | null)?.category ?? null
  }
  const [{ data: wh }, { data: typeRows }] = await Promise.all([
    db.from('Warehouse').select('production_qa_gate').eq('id', tank.warehouse_id).maybeSingle(),
    db.from('warehouse_type_configs').select('type_code, production_qa_gate').eq('warehouse_id', tank.warehouse_id),
  ])
  return resolveProductionQaGate(wh as Record<string, unknown> | null, (typeRows ?? []) as WhTypeConfigRow[], category).gate
}
