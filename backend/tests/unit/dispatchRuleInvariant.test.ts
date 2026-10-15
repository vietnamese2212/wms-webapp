// BẤT BIẾN "XE MÁY GHÉP LUÔN QUA CỬA XÁC NHẬN" (14/10 — user: "làm sai rule cần popup và ngăn chặn"): cửa làm tay + cửa Xác nhận
// hỏi `manualRuleBlocks`, máy ghép tự kiểm luật bằng code riêng (binFits · assignVehicle · fleetFor…). Hai bản lệch nhau thì kế hoạch máy
// vừa lập bị khoá ở Xác nhận (409 TRIP_RULE_VIOLATION) mà người không sửa gì — lớp C80 "hai cửa một sổ khác luật" theo chiều ngược.
// Sinh ngẫu nhiên (hạt giống cố định, in ra khi đỏ) đội xe · khách · đơn · tham số kho; mọi xe máy tạo KHÔNG mang cảnh báo "không tìm
// được xe đúng luật" phải qua `manualRuleBlocks(fleet, [], ods)` đúng như `tripGuards` gọi.
import { describe, it, expect } from 'vitest'
import {
  runDispatch, manualRuleBlocks, withLoadBands, suggestVehicle, sumLines, condsOf, catLoadOf,
  type EngineInput, type EngineModel, type EngineOd, type EngineCarrier, type EngineTariff, type EngineLine, type RuleRow,
} from '../../src/services/dispatchEngine'

function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function scenario(seed: number) {
  const R = rng(seed)
  const int = (a: number, b: number) => a + Math.floor(R() * (b - a + 1))
  const pick = <T,>(xs: T[]): T => xs[Math.floor(R() * xs.length)]
  const CONDS: (string[] | null)[] = [null, ['AMB'], ['COLD'], ['AMB', 'COLD']]
  const parents = ['P1', 'P2']
  const models: EngineModel[] = Array.from({ length: int(2, 5) }, (_, i) => {
    const ton = R() < 0.25
    return {
      id: `M${i}`, sap_code: `M${i}`, name: `Xe ${i}`, parent_type_name: 'XE', parent_type_id: pick(parents),
      capacity_mode: ton ? 'TON' : 'PALLET', max_pallets: ton ? null : int(4, 20), max_tons: ton ? int(2, 15) : null,
      tariff_unit: 'PER_PALLET', serve_conditions: pick(CONDS), max_drops: pick([null, 1, 2, 3, 5]), is_active: true,
      multi_vehicle: pick([undefined, true, false]),
    }
  })
  const cats = ['FG01', 'FG02', 'PM01']
  const condOf: Record<string, string | null> = { FG01: 'AMB', FG02: 'COLD', PM01: null }
  const customers = Array.from({ length: int(3, 8) }, (_, i) => ({
    code: `K${i}`, channel: pick(['GT', 'MT', null]), separate: R() < 0.15,
    max_customers: pick([null, 1, 2, 3, 4]),
    allowed: pick<string[] | null>([null, null, [], models.filter(() => R() < 0.6).map(m => m.id)]),
    ward: `W${int(1, 3)}`, region: pick(['R1', 'R2']),
  }))
  const ods: EngineOd[] = Array.from({ length: int(4, 22) }, (_, i) => {
    const c = pick(customers)
    const lines: EngineLine[] = Array.from({ length: int(1, 3) }, (_, j) => {
      const cat = R() < 0.7 ? pick(['FG01', 'FG02']) : pick(cats)
      const pallets = Math.round(R() * 1200) / 100 + 0.1
      return { material_code: `MAT${j}`, qty_base: 1, pallets, kg: Math.round(pallets * int(200, 900)), category: cat, condition: condOf[cat] }
    })
    return { od_number: `OD${String(i).padStart(3, '0')}`, ship_to_code: c.code, ship_to_name: `KH ${c.code}`, ward_code: c.ward, region_code: c.region,
      channel: c.channel, separate: c.separate, max_customers: c.max_customers, flow: 'SALE', lines, allowed_models: c.allowed }
  })
  const A: EngineCarrier = { id: 'A', code: 'A', name: 'ĐVVT A' }
  const tariffs: EngineTariff[] = models.flatMap(m => ['W1', 'W2', 'W3'].map(w => ({
    id: `A|${m.id}|${w}`, transport_company_id: 'A', vehicle_model_id: m.id, ward_code: w, price: 50_000 + int(0, 100) * 1000, distance_km: 10,
    effective_from: '2026-01-01', effective_to: null, is_active: true })))
  const bands = R() < 0.6 ? Object.fromEntries(parents.map(p => [p, { min: pick([0, 30, 50]), max: pick([100, 105, 110]) }])) : undefined
  const params = {
    day: '2026-10-14', allow_mix_channels: R() < 0.4, underload_pct: null, code_prefix: 'K_', start_seq: 1,
    allow_mix_categories: pick([true, false, undefined]), follow_categories: ['PM01'], max_vehicles: pick([1, 1, 2, 3]),
    load_bands: bands, load_bypass: R() < 0.1,
  }
  const input: EngineInput = { ods, models, carriers: [A], tariffs, surcharges: [], allocations: [], share_targets: [], share_actual: {}, params }
  return { input }
}

// Câu cảnh báo của máy khi KHÔNG tìm được xe đúng luật (xe vẫn tạo để người thấy, Xác nhận chặn là đúng) — xem assignSingle / oversize
const ENGINE_ADMITS = /không có dòng xe CHUNG|Dòng xe khách được vào lớn nhất|Chưa có dòng xe nào khai sức chứa|Không dòng xe nào vừa tải|Không dòng xe nào phục vụ|không dòng nào đi được|phải tách chuyến|lớn hơn xe lớn nhất|OD chứa nhiều Loại kho/

describe('bất biến — xe máy ghép (không tự nhận sai luật) luôn qua manualRuleBlocks như cửa Xác nhận', () => {
  it('3.000 kịch bản ngẫu nhiên', () => {
    const fails: string[] = []
    let checked = 0
    for (let seed = 1; seed <= Number(process.env.INV_SEEDS ?? 3000) && fails.length < 5; seed++) {
      const { input } = scenario(seed)
      const out = runDispatch(input)
      const banded = withLoadBands(input.models, input.params)
      for (const t of out.trips) {
        if (!t.vehicle_model || t.warnings.some(w => ENGINE_ADMITS.test(w))) continue
        // OD bị tách nhiều phần không qua được Xác nhận vì luật riêng (OD_SPLIT_ACROSS_TRIPS) — vẫn kiểm luật ghép như mọi xe
        const fleet = t.vehicles.map(v => banded.find(m => m.id === v.model.id)!)
        const rows: RuleRow[] = t.ods.map(o => ({ ...o }))
        const blocks = manualRuleBlocks(fleet, [], rows, {
          allowMixCategories: input.params.allow_mix_categories, allowMixChannels: input.params.allow_mix_channels, follow: input.params.follow_categories ?? [],
          maxVehicles: input.params.max_vehicles, posmFollows: input.params.allow_mix_categories === false, whole: true,
        })
        checked++
        if (blocks.length) fails.push(`seed ${seed} xe ${t.group_code} [${fleet.map(m => m.id).join('+')}] ${t.ods.length} OD: ${blocks.map(b => `${b.code}: ${b.message}`).join(' | ')}`)
      }
    }
    expect(checked).toBeGreaterThan(5000)
    expect(fails).toEqual([])
  })
  it('ô "Xe mới": dòng xe máy gợi ý (suggestVehicle) cho MỘT khách không bị chính các luật phụ thuộc xe chặn', () => {
    // kéo đơn của một khách ra Xe mới mà máy chọn xe rồi cửa lại chặn = người không có cách nào tạo xe cho đơn hợp lệ
    const XE = new Set(['CONDITION_MISMATCH', 'VEHICLE_NOT_ALLOWED', 'LOAD_EXCEEDED'])
    const fails: string[] = []
    let checked = 0
    for (let seed = 1; seed <= Number(process.env.INV_SEEDS ?? 3000) && fails.length < 5; seed++) {
      const { input } = scenario(seed)
      const banded = withLoadBands(input.models, input.params)
      const byShip = new Map<string, EngineOd[]>()
      for (const o of input.ods) byShip.set(o.ship_to_code!, [...(byShip.get(o.ship_to_code!) ?? []), o])
      for (const ods of byShip.values()) {
        const sug = suggestVehicle(input, ods.map(od => ({ od, ...sumLines(od.lines), conditions: condsOf(od.lines) })), {})
        if (!sug.model || sug.warnings.some(w => ENGINE_ADMITS.test(w))) continue
        const fleet = [sug.model, ...sug.vehicles.slice(1).map(v => v.model)].map(m => banded.find(x => x.id === m.id)!)
        const rows: RuleRow[] = ods.map(od => ({ od_number: od.od_number, ship_to_code: od.ship_to_code, ship_to_name: od.ship_to_name, max_customers: od.max_customers,
          separate: od.separate, allowed_models: od.allowed_models, ...sumLines(od.lines), conditions: condsOf(od.lines), cat_load: catLoadOf(od.lines) }))
        const blocks = manualRuleBlocks(fleet, [], rows, { allowMixCategories: true, allowMixChannels: true, follow: input.params.follow_categories ?? [], posmFollows: input.params.allow_mix_categories === false }).filter(b => XE.has(b.code))
        checked++
        if (blocks.length) fails.push(`seed ${seed} khách ${ods[0].ship_to_code} [${fleet.map(m => m.id).join('+')}]: ${blocks.map(b => `${b.code}: ${b.message}`).join(' | ')}`)
      }
    }
    expect(checked).toBeGreaterThan(3000)
    expect(fails).toEqual([])
  })
})
