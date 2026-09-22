// loadCalc — TẢI của một dòng hàng (thùng · pallet · kg) tính từ số BASE + Material master, MỘT nguồn cho
// điều vận (ghép chuyến, Non tải), cước (xe pallet đếm pallet · xe xá đếm tấn) và cột tải trên chuyến.
// MIRROR: frontend/src/utils/loadCalc.ts — 2 bản PHẢI KHỚP (tests/mirror/loadCalc.mirror.test.ts).
//
// Đơn vị đã ĐO trên 9 mã (22/09): `Material.weight_kg` là kg/THÙNG với mã có entry (510000219: 4,965 ≈ SAP
// 4,97 kg/thùng), kg/EA với mã không entry (720000113: 0,25). Pallet đi qua `effCartonsPerPallet` (override kho).
// Không đủ master → rơi về số THAM CHIẾU của SAP (gross_weight_kg / sap_pallets) kèm nguồn 'SAP'; cả hai thiếu →
// null, KHÔNG đoán — dòng "không đo được tải" phải nổi lên chuyến, engine không tự ghép dòng đó.
import { hasEntry, type MatUnits } from './qtyUnits'
import { effCartonsPerPallet } from './palletCalc'

export type LoadMat = MatUnits & {
  cartons_per_pallet?: number | null
  warehouse_pallet_overrides?: { warehouse_id: string; cartons_per_pallet: number }[] | null
  weight_kg?: number | string | null
  is_pallet_carrier?: boolean | null
  is_non_stock?: boolean | null
}

export interface LoadRef { gross_weight_kg?: number | null; sap_pallets?: number | null }

export type LoadSource = 'MASTER' | 'SAP' | 'NONE'
export interface LoadResult {
  cartons: number | null        // thùng THẬP PHÂN — chỉ để tính tải, KHÔNG in cạnh nhãn "thùng"
  pallets: number | null
  kg: number | null
  pallets_source: LoadSource
  kg_source: LoadSource
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const pos = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

export function loadOf(qtyBase: number, mat: LoadMat | null | undefined, warehouseId: string | null | undefined, ref?: LoadRef | null): LoadResult {
  const q = Number(qtyBase)
  if (!Number.isFinite(q) || q <= 0) return { cartons: q === 0 ? 0 : null, pallets: q === 0 ? 0 : null, kg: q === 0 ? 0 : null, pallets_source: 'NONE', kg_source: 'NONE' }
  // Hàng phi tồn kho (chiết khấu…) không có tải; Pallet Loscam đi cùng hàng không đếm pallet HÀNG nhưng vẫn có kg.
  if (mat?.is_non_stock) return { cartons: 0, pallets: 0, kg: 0, pallets_source: 'MASTER', kg_source: 'MASTER' }

  const entry = hasEntry(mat)
  const cartons = entry ? r3(q / Number(mat!.units_per_carton)) : null

  let pallets: number | null = null, pallets_source: LoadSource = 'NONE'
  if (mat?.is_pallet_carrier) { pallets = 0; pallets_source = 'MASTER' }
  else {
    const cpp = effCartonsPerPallet(mat, warehouseId)
    if (cartons != null && cpp > 0) { pallets = r3(cartons / cpp); pallets_source = 'MASTER' }
    else if (!entry && cpp > 0) { pallets = r3(q / cpp); pallets_source = 'MASTER' }   // mã không entry: cartons_per_pallet = EA/pallet
    else { const sp = pos(ref?.sap_pallets); if (sp != null) { pallets = r3(sp); pallets_source = 'SAP' } }
  }

  let kg: number | null = null, kg_source: LoadSource = 'NONE'
  const w = pos(mat?.weight_kg)
  if (w != null) { kg = r3((entry ? cartons! : q) * w); kg_source = 'MASTER' }
  else { const gw = pos(ref?.gross_weight_kg); if (gw != null) { kg = r3(gw); kg_source = 'SAP' } }

  return { cartons, pallets, kg, pallets_source, kg_source }
}

/** Cộng tải nhiều dòng — null ở một dòng làm tổng đó "không đo được" (đừng cộng phần đo được rồi nói là tổng). */
export function sumLoads(loads: LoadResult[]): { pallets: number | null; kg: number | null; incomplete: number } {
  let pallets = 0, kg = 0, pNull = false, kNull = false, incomplete = 0
  for (const l of loads) {
    if (l.pallets == null) pNull = true; else pallets += l.pallets
    if (l.kg == null) kNull = true; else kg += l.kg
    if (l.pallets == null || l.kg == null) incomplete++
  }
  return { pallets: pNull ? null : r3(pallets), kg: kNull ? null : r3(kg), incomplete }
}
