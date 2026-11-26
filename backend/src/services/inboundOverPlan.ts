// 26/11 — NHẬP VƯỢT SỐ KẾ HOẠCH: MỘT câu trả lời cho mọi cửa nhập (quét tem · lưu thủ công · trang phiếu · phiếu chung).
// User chốt 26/11: công tắc 2 tầng Kho + Loại kho `inbound_over_plan`; kho chế biến cho vượt, chỉ báo Thừa.
//   null  = như cũ: máy chủ không chặn; màn hình phiếu NCC dừng nút quét khi đã đủ kế hoạch
//   ALLOW = cho vượt, báo "Thừa" ở dòng mã / hộp Hoàn thành
//   BLOCK = máy chủ chặn lần nhận làm tổng vượt kế hoạch (422 OVER_PLAN)
// Trước 26/11: máy chủ không chặn ở cửa nào, chỉ màn hình phiếu NCC khoá nút — hai cửa một sổ khác luật.
// Lỗi đọc ⇒ NÉM (route trả 500 / 503), không đoán: đoán "cho vượt" ở kho đã đặt Chặn là nhận quá chứng từ.
import { db } from '../lib/supabase'
import { resolveInboundOverPlan, type InboundOverPlan, type WhTypeConfigRow } from '../utils/putaway'
import { qtyLabel, type MatUnits } from '../utils/qtyUnits'
import { fetchAllByIdChunks } from '../utils/pagination'

/** Luật nhập vượt đang hiệu lực cho (kho, loại kho). `category` = loại kho của phiếu (warehouse_type) hoặc của mã. */
export async function inboundOverPlanMode(warehouseId: string | null | undefined, category: string | null | undefined): Promise<InboundOverPlan | null> {
  if (!warehouseId) return null
  const [{ data: wh, error: wErr }, { data: typeRows, error: tErr }] = await Promise.all([
    db.from('Warehouse').select('inbound_over_plan').eq('id', warehouseId).maybeSingle(),
    db.from('warehouse_type_configs').select('type_code, inbound_over_plan').eq('warehouse_id', warehouseId),
  ])
  if (wErr) throw wErr
  if (tErr) throw tErr
  return resolveInboundOverPlan(wh as Record<string, unknown> | null, (typeRows ?? []) as WhTypeConfigRow[], category).mode
}

/** Bản cho nhiều loại kho của CÙNG một kho (phiếu chung trộn loại) — 2 lượt đọc cho cả phiếu. */
export async function inboundOverPlanModes(warehouseId: string, categories: (string | null | undefined)[]): Promise<Map<string, InboundOverPlan | null>> {
  const [{ data: wh, error: wErr }, { data: typeRows, error: tErr }] = await Promise.all([
    db.from('Warehouse').select('inbound_over_plan').eq('id', warehouseId).maybeSingle(),
    db.from('warehouse_type_configs').select('type_code, inbound_over_plan').eq('warehouse_id', warehouseId),
  ])
  if (wErr) throw wErr
  if (tErr) throw tErr
  const out = new Map<string, InboundOverPlan | null>()
  for (const c of new Set(categories.map(x => x ?? ''))) {
    out.set(c, resolveInboundOverPlan(wh as Record<string, unknown> | null, (typeRows ?? []) as WhTypeConfigRow[], c || null).mode)
  }
  return out
}

/** Tổng đã nhận (đơn vị gốc) của một phiếu: Σ pallet trỏ về phiếu. */
export async function receivedOfOrder(orderId: string): Promise<number> {
  const rows = await fetchAllByIdChunks([orderId], chunk => db.from('InventoryEntry').select('cartons_imported').in('import_order_id', chunk))
  return (rows as { cartons_imported: number | null }[]).reduce((s, r) => s + (Number(r.cartons_imported) || 0), 0)
}

/**
 * Lần nhận `qtyIn` có bị chặn vì vượt kế hoạch không. null = cho qua.
 * Chỉ áp khi phiếu CÓ kế hoạch > 0 và luật đang là BLOCK. Phiếu trả về có luật hàng THỪA riêng — cửa gọi tự bỏ qua.
 */
export async function overPlanError(p: {
  warehouseId: string | null | undefined; category: string | null | undefined
  planned: number | null | undefined; received: () => Promise<number>; qtyIn: number
  materialCode?: string | null; mat?: MatUnits | null
}): Promise<string | null> {
  const planned = Number(p.planned)
  if (!(planned > 0)) return null
  // luật trước (đa số kho không chặn ⇒ khỏi đếm đã nhận — quét là đường nóng)
  if ((await inboundOverPlanMode(p.warehouseId, p.category)) !== 'BLOCK') return null
  const received = await p.received()
  if (received + p.qtyIn <= planned + 1e-9) return null
  const m = p.mat ?? undefined
  return `${p.materialCode ? `Mã ${p.materialCode}: ` : ''}nhận thêm ${qtyLabel(p.qtyIn, m)} thì vượt kế hoạch ${qtyLabel(planned, m)}`
    + ` (đã nhận ${qtyLabel(received, m)}) — kho đang đặt "Chặn nhập vượt kế hoạch". Thực nhận nhiều hơn chứng từ thì sửa số kế hoạch của mã trước.`
}
