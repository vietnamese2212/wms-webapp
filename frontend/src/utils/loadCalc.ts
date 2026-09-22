// loadCalc — TẢI của một dòng hàng (thùng · pallet · kg) từ số BASE + Material master.
// MIRROR của backend/src/utils/loadCalc.ts — 2 bản PHẢI KHỚP (backend/tests/mirror/loadCalc.mirror.test.ts).
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
  cartons: number | null
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
  if (mat?.is_non_stock) return { cartons: 0, pallets: 0, kg: 0, pallets_source: 'MASTER', kg_source: 'MASTER' }

  const entry = hasEntry(mat)
  const cartons = entry ? r3(q / Number(mat!.units_per_carton)) : null

  let pallets: number | null = null, pallets_source: LoadSource = 'NONE'
  if (mat?.is_pallet_carrier) { pallets = 0; pallets_source = 'MASTER' }
  else {
    const cpp = effCartonsPerPallet(mat, warehouseId)
    if (cartons != null && cpp > 0) { pallets = r3(cartons / cpp); pallets_source = 'MASTER' }
    else if (!entry && cpp > 0) { pallets = r3(q / cpp); pallets_source = 'MASTER' }
    else { const sp = pos(ref?.sap_pallets); if (sp != null) { pallets = r3(sp); pallets_source = 'SAP' } }
  }

  let kg: number | null = null, kg_source: LoadSource = 'NONE'
  const w = pos(mat?.weight_kg)
  if (w != null) { kg = r3((entry ? cartons! : q) * w); kg_source = 'MASTER' }
  else { const gw = pos(ref?.gross_weight_kg); if (gw != null) { kg = r3(gw); kg_source = 'SAP' } }

  return { cartons, pallets, kg, pallets_source, kg_source }
}

export function sumLoads(loads: LoadResult[]): { pallets: number | null; kg: number | null; incomplete: number } {
  let pallets = 0, kg = 0, pNull = false, kNull = false, incomplete = 0
  for (const l of loads) {
    if (l.pallets == null) pNull = true; else pallets += l.pallets
    if (l.kg == null) kNull = true; else kg += l.kg
    if (l.pallets == null || l.kg == null) incomplete++
  }
  return { pallets: pNull ? null : r3(pallets), kg: kNull ? null : r3(kg), incomplete }
}
