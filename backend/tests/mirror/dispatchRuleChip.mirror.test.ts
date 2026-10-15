// MIRROR chip "Sai quy định" (FE `rowRuleWarnings` — tính trên dòng OD ngay trong trình duyệt) ⇄ cửa Xác nhận (BE `manualRuleBlocks`, `whole`)
// cho hai luật đọc thẳng dòng OD: ĐI XE RIÊNG và TRỘN KÊNH (kênh chụp lúc lập, 15/10). Lệch nhau = chip nói "ổn" mà Xác nhận chặn (đúng ca
// user hỏi 15/10: "lấy ví dụ rõ ràng hơn") hoặc chip đỏ mà server cho qua.
import { describe, it, expect } from 'vitest'
import { manualRuleBlocks, type RuleRow } from '../../src/services/dispatchEngine'
import { rowRuleWarnings } from '../../../frontend/src/components/tms/dispatchIssues'
import { rng, N, SEED } from '../helpers/rng'

describe(`chip "Sai quy định" FE ⇄ cửa Xác nhận BE — đi xe riêng · trộn kênh (seed ${SEED})`, () => {
  it('cùng kết luận trên mọi xe ngẫu nhiên', () => {
    const r = rng()
    for (let i = 0; i < N; i++) {
      const custs = Array.from({ length: r.int(1, 4) }, (_, k) => ({ code: r.bool(0.1) ? null : `K${k}`, sep: r.bool(0.2), ch: r.pick(['GT', 'MT', 'KA', null, null]) }))
      const rows: RuleRow[] = Array.from({ length: r.int(1, 5) }, (_, j) => {
        const c = r.pick(custs)
        return { od_number: `OD${j}`, ship_to_code: c.code, ship_to_name: c.code ? `KH ${c.code}` : null, separate: c.sep, channel: c.ch, max_customers: 50, pallets: null, tons: null, cat_load: {} }
      })
      const mix = r.bool(0.3)
      // không dòng xe ⇒ BE chỉ hỏi các luật không phụ thuộc xe; số khách (max_customers 50) và Loại kho (cat_load rỗng) không bao giờ phạm
      const be = manualRuleBlocks([], [], rows, { allowMixCategories: true, allowMixChannels: mix, follow: [], whole: true }).map(b => b.code)
      const fe = rowRuleWarnings(rows.map(x => ({ od_number: x.od_number, ship_to_code: x.ship_to_code, ship_to_name: x.ship_to_name ?? null, separate: x.separate, channel: x.channel })), mix)
      const ctx = JSON.stringify({ rows: rows.map(x => [x.ship_to_code, x.separate, x.channel]), mix })
      expect(fe.some(w => / đi xe riêng — /.test(w)), ctx).toBe(be.includes('SEPARATE_CUSTOMER'))
      expect(fe.some(w => /^Xe trộn kênh khách /.test(w)), ctx).toBe(be.includes('CHANNEL_MIX_BLOCKED'))
    }
  })
})
