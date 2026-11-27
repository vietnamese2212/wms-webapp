// MIRROR thùng/pallet hiệu lực theo KHO: BE (in tem, upload, quy cách) ⇄ FE (form, tem, sơ đồ 3D).
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/palletCalc'
import * as FE from '../../../frontend/src/utils/palletCalc'
import { rng, N, SEED } from '../helpers/rng'

describe(`palletCalc BE ⇄ FE (seed ${SEED})`, () => {
  it('effCartonsPerPallet khớp', () => {
    const r = rng()
    const WH = ['wh-a', 'wh-b', 'wh-c']
    for (let i = 0; i < N; i++) {
      const m = r.bool(0.1) ? null : {
        cartons_per_pallet: r.pick([null, undefined, 0, 48, 140, -1]),
        warehouse_pallet_overrides: r.bool(0.3) ? null : Array.from({ length: r.int(0, 3) }, () => ({
          warehouse_id: r.pick(WH), cartons_per_pallet: r.pick([0, 60, 100, -3]),
        })),
      }
      const wh = r.bool(0.2) ? null : r.pick(WH)
      expect(FE.effCartonsPerPallet(m, wh), JSON.stringify({ m, wh })).toBe(BE.effCartonsPerPallet(m, wh))
    }
  })

  it('palletQtyOnUnitChange khớp (27/11 — đổi số / pallet khi thêm / bỏ đơn vị quy cách)', () => {
    const r = rng()
    const U = [{}, { entry_unit: null, units_per_carton: null }, { entry_unit: 'BAO', units_per_carton: 20 }, { entry_unit: 'BAO', units_per_carton: 25 },
      { entry_unit: 'CAR', units_per_carton: 48 }, { entry_unit: 'CAR', units_per_carton: 0 }, { entry_unit: null, units_per_carton: 20 }]
    for (let i = 0; i < N; i++) {
      const q = r.pick([null, undefined, 0, -5, 1000, 990, 980, 49, 50, 7.5, r.int(1, 5000)])
      const a = r.pick(U), b = r.pick(U)
      expect(FE.palletQtyOnUnitChange(q, a, b), JSON.stringify({ q, a, b })).toEqual(BE.palletQtyOnUnitChange(q, a, b))
    }
  })
})
