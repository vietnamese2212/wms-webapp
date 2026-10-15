// MIRROR nhận diện XE CÙNG TUYẾN (FE `routeOff` — trình duyệt bỏ xe mà CẤU HÌNH không cho đơn lên, không gọi server) ⇄ luật ghép xe của
// cửa fit-check (BE `manualRuleBlocks` + `routeKind` = 'off'). Lệch nhau = khung chờ đánh dấu xe mà cấu hình không cho đơn lên (user 15/10
// tối: "xe pallet 1 khách thì đơn khách khác liên quan gì — phải đi theo config") hoặc giấu xe thật ra cấu hình cho (chỉ đầy).
import { describe, it, expect } from 'vitest'
import { manualRuleBlocks, routeKind, type RuleRow, type EngineModel } from '../../src/services/dispatchEngine'
import { routeOff } from '../../../frontend/src/components/tms/dispatchIssues'
import { rng, N, SEED } from '../helpers/rng'

const CONDS = ['NORMAL', 'COLD']
const CATS = ['FG01', 'FG02', 'POSM']   // POSM = Loại kho "đi kèm đơn"

describe(`xe cùng tuyến FE routeOff ⇄ BE routeKind 'off' (seed ${SEED})`, () => {
  it('cùng kết luận trên mọi cặp (đơn khung chờ, xe) ngẫu nhiên — kể cả khi xe vượt tải (đầy ≠ không thuộc xe)', () => {
    const r = rng()
    for (let i = 0; i < N; i++) {
      const models: EngineModel[] = Array.from({ length: 4 }, (_, k) => ({
        id: `M${k}`, sap_code: `9100${k}`, name: `Xe ${k}`, parent_type_name: 'XE', tariff_unit: 'PER_PALLET', is_active: true,
        capacity_mode: r.pick(['PALLET', 'TON', null] as const), max_pallets: r.pick([4, 6, 17, null]), max_tons: r.pick([null, 5, 15]),
        max_drops: r.pick([null, 1, 1, 2, 3, 5]), serve_conditions: r.bool(0.3) ? [] : CONDS.filter(() => r.bool(0.5)),
      }))
      const custs = Array.from({ length: 4 }, (_, k) => ({
        code: r.bool(0.1) ? null : `K${k}`, sep: r.bool(0.15), ch: r.pick(['GT', 'MT', null]), max: r.pick([null, 1, 2, 4]),
        allowed: r.pick([null, [], ['M0'], ['M0', 'M1'], ['M2', 'M3'], ['M1', 'M2', 'M3']]),
      }))
      let n = 0
      const row = (c: typeof custs[number]): RuleRow & { conditions: string[]; cat_load: Record<string, number> } => ({
        od_number: `OD${n++}`, ship_to_code: c.code, ship_to_name: c.code, separate: c.sep, channel: c.ch, max_customers: c.max,
        allowed_models: c.allowed, conditions: CONDS.filter(() => r.bool(0.3)),
        cat_load: Object.fromEntries(CATS.filter(() => r.bool(0.4)).map(k => [k, 1])),
        pallets: r.pick([0.5, 2, 6, 12]), tons: r.pick([0.4, 2, 9]),
      })
      const staying = Array.from({ length: r.int(1, 4) }, () => row(r.pick(custs)))
      const moving = row(r.bool(0.3) ? { code: 'K9', sep: r.bool(0.15), ch: r.pick(['GT', 'MT', null]), max: r.pick([null, 1, 3]), allowed: r.pick([null, ['M0']]) } : r.pick(custs))
      const trip = { vehicle_model_id: r.pick([null, 'M0', 'M1', 'M2', 'M3', 'MX']), extra_vehicle_model_ids: r.bool(0.2) ? [r.pick(['M0', 'M1', 'M2', 'M3'])] : [], allow_mix_categories: r.pick([null, true, false]) }
      const mixChannels = r.bool(0.3), mixCategories = r.pick([undefined, true, false]), follow = ['POSM']
      // như `ruleBlocksFor` (cửa fit-check): dòng xe chính + xe phụ của kho; xe chưa có / dòng xe không dùng ở kho ⇒ không dòng xe
      const main = trip.vehicle_model_id ? models.find(m => m.id === trip.vehicle_model_id) ?? null : null
      const fleet = main ? [main, ...trip.extra_vehicle_model_ids.map(id => models.find(m => m.id === id)).filter((m): m is EngineModel => !!m)] : []
      const blocks = manualRuleBlocks(fleet, staying, [moving], { allowMixCategories: trip.allow_mix_categories ?? mixCategories, allowMixChannels: mixChannels, follow, maxVehicles: 1, posmFollows: mixCategories === false })
      const be = routeKind(main, staying, [moving], blocks) === 'off'
      const fe = routeOff(moving, { ...trip, ods: staying }, { models: new Map(models.map(m => [m.id, { id: m.id, max_drops: m.max_drops, storage_conditions: m.serve_conditions ?? [] }])), mixChannels, mixCategories, follow })
      expect(fe, JSON.stringify({ blocks: blocks.map(b => b.code), trip, main: main && [main.max_drops, main.serve_conditions], staying, moving, mixChannels, mixCategories })).toBe(be)
    }
  })
})
