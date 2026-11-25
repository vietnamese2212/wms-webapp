// MES 14/11 — mức kiểm QA khi RÚT bán thành phẩm khỏi một bồn (cho trang sổ đóng gói).
// MỘT chỗ ghép tầng cho mọi cửa rút (đóng trang sổ, rút tay ở màn Bồn) — đừng đọc thẳng Warehouse.production_qa_gate.
// 25/11 (G1 rà soát MES): lỗi đọc ⇒ NÉM lỗi (route trả 503), không còn rơi về 'WARN' — trước đây quá tải đúng lúc đóng trang
// làm kho đặt CHẶN mà vẫn rút được bồn còn lô chưa QA thả.
import { db } from '../lib/supabase'
import { resolveProductionQaGate, type ProductionQaGate, type WhTypeConfigRow } from '../utils/putaway'

export async function qaGateOfTank(tankId: string): Promise<ProductionQaGate> {
  const { data: tank, error: tErr } = await db.from('production_tank').select('id, warehouse_id').eq('id', tankId).maybeSingle()
  if (tErr) throw tErr
  if (!tank) return 'WARN'   // bồn không còn ⇒ hàm rút tự báo NOT_FOUND
  // bồn chỉ chứa MỘT mã BTP (hàm nạp chặn trộn) ⇒ loại kho = category của mã đó
  const { data: lot, error: lErr } = await db.from('tank_lot').select('batch_id').eq('tank_id', tankId).eq('status', 'ACTIVE').limit(1).maybeSingle()
  if (lErr) throw lErr
  let category: string | null = null
  if (lot) {
    const { data: b, error: bErr } = await db.from('production_batch').select('material:Material!production_batch_material_id_fkey(category)').eq('id', lot.batch_id).maybeSingle()
    if (bErr) throw bErr
    category = (b?.material as unknown as { category: string | null } | null)?.category ?? null
  }
  const [{ data: wh, error: wErr }, { data: typeRows, error: tyErr }] = await Promise.all([
    db.from('Warehouse').select('production_qa_gate').eq('id', tank.warehouse_id).maybeSingle(),
    db.from('warehouse_type_configs').select('type_code, production_qa_gate').eq('warehouse_id', tank.warehouse_id),
  ])
  if (wErr) throw wErr
  if (tyErr) throw tyErr
  return resolveProductionQaGate(wh as Record<string, unknown> | null, (typeRows ?? []) as WhTypeConfigRow[], category).gate
}
