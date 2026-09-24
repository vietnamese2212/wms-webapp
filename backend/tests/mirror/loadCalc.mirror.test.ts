// MIRROR tải dòng hàng (thùng · pallet · kg): BE (điều vận, cước) ⇄ FE (cột tải trên chuyến, Non tải).
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/loadCalc'
import * as FE from '../../../frontend/src/utils/loadCalc'
import { rng, N, SEED } from '../helpers/rng'

// 9 mã ĐO THẬT 22/09 (master staging ↔ ZSD02): kg/thùng và thùng/pallet phải ra đúng như SAP báo.
const M219 = { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 24, cartons_per_pallet: 190, weight_kg: '4.965' }
const M081 = { base_unit: 'HOP', entry_unit: 'CAR', units_per_carton: 48, cartons_per_pallet: 117, weight_kg: 5.42, category: 'FG02' }
const M113 = { base_unit: 'EA', entry_unit: null, units_per_carton: null, cartons_per_pallet: 1920, weight_kg: 0.25 }
const LOSCAM = { base_unit: 'EA', entry_unit: null, units_per_carton: null, cartons_per_pallet: 1, weight_kg: 30, is_pallet_carrier: true }
const DISC = { base_unit: null, entry_unit: null, units_per_carton: null, weight_kg: null, is_non_stock: true }

describe(`loadCalc BE ⇄ FE (seed ${SEED})`, () => {
  it('ca đo thật', () => {
    const a = BE.loadOf(1440, M219, null)                 // 60 thùng
    expect(a.cartons).toBe(60); expect(a.pallets).toBe(0.316); expect(a.kg).toBe(297.9); expect(a.kg_source).toBe('MASTER')
    const b = BE.loadOf(3456, M081, null)                 // 72 thùng bán theo Hộp
    expect(b.cartons).toBe(72); expect(b.pallets).toBe(0.615)
    const c = BE.loadOf(20, M113, null)                   // POSM 20 cái
    expect(c.cartons).toBeNull(); expect(c.kg).toBe(5); expect(c.pallets).toBe(0.01)
    const d = BE.loadOf(16, LOSCAM, null)                 // pallet Loscam đi cùng: có kg, KHÔNG đếm pallet hàng
    expect(d.pallets).toBe(0); expect(d.kg).toBe(480)
    expect(BE.loadOf(1, DISC, null)).toEqual({ cartons: 0, pallets: 0, kg: 0, pallets_source: 'MASTER', kg_source: 'MASTER' })
    // thiếu master → rơi về SAP, thiếu cả hai → null (không đoán)
    const e = BE.loadOf(100, { base_unit: 'EA' }, null, { gross_weight_kg: 12.5, sap_pallets: 0.4 })
    expect(e.kg).toBe(12.5); expect(e.kg_source).toBe('SAP'); expect(e.pallets).toBe(0.4); expect(e.pallets_source).toBe('SAP')
    const f = BE.loadOf(100, { base_unit: 'EA' }, null, null)
    expect(f.kg).toBeNull(); expect(f.pallets).toBeNull()
    expect(BE.sumLoads([a, f]).kg).toBeNull()             // một dòng không đo được ⇒ tổng không đo được
    expect(BE.sumLoads([a, b]).incomplete).toBe(0)
  })
  it('ngẫu nhiên — hai bản khớp từng trường', () => {
    const r = rng()
    const WH = ['w1', 'w2']
    for (let i = 0; i < N; i++) {
      const entry = r.bool(0.6)
      const mat = r.bool(0.08) ? null : {
        base_unit: r.pick(['HOP', 'EA', 'KG', null]),
        entry_unit: entry ? 'CAR' : null,
        units_per_carton: entry ? r.pick([24, 48, 12, 0, null]) : null,
        cartons_per_pallet: r.pick([190, 117, 1920, 0, null]),
        warehouse_pallet_overrides: r.bool(0.3) ? [{ warehouse_id: r.pick(WH), cartons_per_pallet: r.pick([100, 0]) }] : null,
        weight_kg: r.pick([4.965, '5.42', 0, null, -1]),
        is_pallet_carrier: r.bool(0.1), is_non_stock: r.bool(0.05),
      }
      const q = r.pick([0, -3, 1, 24, 1440, 3456.5, NaN])
      const wh = r.bool(0.3) ? null : r.pick(WH)
      const ref = r.bool(0.5) ? null : { gross_weight_kg: r.pick([null, 0, 12.5]), sap_pallets: r.pick([null, 0, 0.4]) }
      expect(FE.loadOf(q, mat, wh, ref), JSON.stringify({ q, mat, wh, ref })).toEqual(BE.loadOf(q, mat, wh, ref))
    }
  })
})
