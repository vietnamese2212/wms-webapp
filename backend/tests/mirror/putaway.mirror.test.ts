// MIRROR cất hàng: FE chỉ giữ NHÃN + MÃ (luật ở BE). Mã lý do chặn / vượt rào / giá trị dropdown cấu hình
// FE gửi lên phải nằm đúng trong danh sách BE nhận — lệch một mã là form Kho lưu bị 400 hoặc PDA hiện mã thô.
import { describe, it, expect } from 'vitest'
import * as BE from '../../src/utils/putaway'
import * as FE from '../../../frontend/src/utils/putaway'

describe('putaway BE ⇄ FE', () => {
  it('mã + nhãn lý do CHẶN khớp', () => {
    expect(Object.keys(FE.PUTAWAY_BLOCK_LABEL).sort()).toEqual(BE.PUTAWAY_BLOCKS.map(b => b.code).sort())
    for (const b of BE.PUTAWAY_BLOCKS) expect(FE.PUTAWAY_BLOCK_LABEL[b.code], b.code).toBe(b.label)
    expect(Object.keys(FE.PUTAWAY_BLOCK_SHORT).sort()).toEqual(BE.PUTAWAY_BLOCKS.map(b => b.code).sort())
  })
  it('mã lý do VƯỢT RÀO khớp (nhãn FE được rút gọn có chủ đích, mã thì không)', () => {
    expect(FE.PUTAWAY_OVERRIDE_REASONS.map(r => r.code)).toEqual(BE.PUTAWAY_OVERRIDE_REASONS.map(r => r.code))
    for (const r of FE.PUTAWAY_OVERRIDE_REASONS) expect(BE.isPutawayOverrideReason(r.code), r.code).toBe(true)
  })
  it('giá trị dropdown cấu hình kho khớp danh sách BE chấp nhận (so TẬP — thứ tự hiển thị FE được tự chọn)', () => {
    const sorted = (a: readonly string[]) => [...a].sort()
    expect(sorted(FE.PUTAWAY_PRIORITY_OPTS.map(o => o.value))).toEqual(sorted(BE.PUTAWAY_PRIORITIES))
    expect(sorted(FE.putawayDateMixOpts('HSD').map(o => o.value))).toEqual(sorted(BE.PUTAWAY_DATE_MIXES))
    expect(sorted(FE.putawayDatePrefOpts('HSD').map(o => o.value))).toEqual(sorted(BE.PUTAWAY_DATE_PREFS))
    expect(sorted(FE.PUTAWAY_FALLBACK_OPTS.map(o => o.value))).toEqual(sorted(BE.PUTAWAY_FALLBACKS))
  })
})
