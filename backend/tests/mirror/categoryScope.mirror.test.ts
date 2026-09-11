// MIRROR tách chuỗi Loại kho ghép 'FG01+PM01': BE (scope, guard) ⇄ FE (bộ lọc TMS). Bản SQL wt_cats()
// không chạy được ở đây — gói QA 08 tầng 3 gác bản đó.
import { describe, it, expect } from 'vitest'
import { splitCategories as BE } from '../../src/utils/categoryScope'
import { splitCategories as FE } from '../../../frontend/src/utils/categoryScope'
import { rng, N, SEED } from '../helpers/rng'

describe(`categoryScope BE ⇄ FE (seed ${SEED})`, () => {
  it('splitCategories khớp', () => {
    for (const v of ['FG01+PM01', ' FG01 + PM01 ', '+', '', null, undefined, 'FG01', 'FG01++PM01+'])
      expect(FE(v), JSON.stringify(v)).toEqual(BE(v))
    const r = rng()
    for (let i = 0; i < N; i++) {
      const s = r.str('FGPM01+ +', 0, 12)
      expect(FE(s), JSON.stringify(s)).toEqual(BE(s))
    }
  })
})
