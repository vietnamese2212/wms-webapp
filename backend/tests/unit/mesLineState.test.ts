// Luật trạng thái một dòng NVL so với ĐỊNH MỨC GỐC có HAI bản: TypeScript cellState (màn Theo chu kỳ, Excel) và SQL mes_line_state
// (dashboard Tổng quan, sổ tổng hợp production_batch_fact — migration 20261122). Cả hai chạy CÙNG bảng ca mesLineStateCases.json:
// file này kiểm bản TS, khối DO cuối migration 20261122 kiểm bản SQL. Đổi luật ⇒ sửa cả hai + bảng ca + khối DO.
import { describe, it, expect } from 'vitest'
import { cellState } from '../../../frontend/src/utils/cycleReport'
import data from './mesLineStateCases.json'

describe('mes_line_state ⇄ cellState — bảng ca dùng chung', () => {
  for (const c of data.cases) {
    it(`${c.why} ⇒ ${c.state}`, () => {
      expect(cellState({ std: c.std, req: c.req, rm: c.rm, tol: c.tol, iss: c.iss, n: c.iss ? 1 : 0 }, c.closed)).toBe(c.state)
    })
  }
})
