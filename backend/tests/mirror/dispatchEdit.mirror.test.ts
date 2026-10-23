// MIRROR "có thay đổi chưa Lưu" (23/10): FE khoá công tắc Xem | Sửa ⇄ BE chặn 409 EDIT_DIRTY — lệch nhau = nút bấm được mà server chặn,
// hoặc nút khoá mà server cho. Kèm vài ca luật cố định (mở khoá xe · xe mới · đơn đổi xe · chỉ khung chờ đổi).
import { describe, it, expect } from 'vitest'
import { editDirty as be, type EditSig } from '../../src/services/dispatchEdit'
import { editDirty as fe } from '../../../frontend/src/components/tms/dispatchEdit'
import { rng, N, SEED } from '../helpers/rng'

const ST = ['DRAFT', 'CONFIRMED', 'TENDERED', 'DECLINED', 'DISCARDED', null] as const
const base: EditSig = {
  trips: [{ id: 'T1', status: 'CONFIRMED' }, { id: 'T2', status: 'CONFIRMED' }],
  ods: [{ od_number: 'A', trip_id: 'T1' }, { od_number: 'B', trip_id: 'T2' }, { od_number: 'P', trip_id: null }],
}
const clone = (s: EditSig): EditSig => ({ trips: s.trips.map(t => ({ ...t })), ods: s.ods.map(o => ({ ...o })) })

describe(`editDirty BE ⇄ FE (seed ${SEED})`, () => {
  it('luật: không đổi / chỉ khung chờ đổi ⇒ không; mở khoá · xe mới · đơn đổi xe · xe bị bỏ ⇒ có', () => {
    expect(be(base, clone(base))).toBe(false)
    const pool = clone(base); pool.ods.push({ od_number: 'NEW', trip_id: null }); pool.ods = pool.ods.filter(o => o.od_number !== 'P')
    expect(be(base, pool)).toBe(false)
    const unlock = clone(base); unlock.trips[0].status = 'DRAFT'
    expect(be(base, unlock)).toBe(true)
    const fresh = clone(base); fresh.trips.push({ id: 'T3', status: 'DRAFT' }); fresh.ods.push({ od_number: 'P', trip_id: 'T3' })
    expect(be(base, fresh)).toBe(true)
    const emptyNew = clone(base); emptyNew.trips.push({ id: 'T3', status: 'DRAFT' })
    expect(be(base, emptyNew)).toBe(false)
    const moved = clone(base); moved.ods[0].trip_id = 'T2'
    expect(be(base, moved)).toBe(true)
    const gone = clone(base); gone.trips[1].status = 'DISCARDED'
    expect(be(base, gone)).toBe(true)
  })
  it('cùng kết luận trên bản chụp / bàn ngẫu nhiên', () => {
    const r = rng()
    for (let i = 0; i < N; i++) {
      const ids = ['T1', 'T2', 'T3', 'T4']
      const sig = (): EditSig => ({
        trips: ids.filter(() => r.bool(0.8)).map(id => ({ id, status: r.pick(ST) })),
        ods: ['A', 'B', 'C', 'D', 'E'].filter(() => r.bool(0.85)).map(od => ({ od_number: od, trip_id: r.bool(0.25) ? null : r.pick([...ids, 'TX']) })),
      })
      const b = sig()
      const c = r.bool(0.3) ? clone(b) : sig()
      expect(fe(b, c), JSON.stringify({ b, c })).toBe(be(b, c))
    }
  })
})
