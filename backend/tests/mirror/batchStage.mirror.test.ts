// Tình trạng mẻ MES: BE (bộ kiểm lọc) ⇄ FE (BATCH_STAGES) ⇄ DB (mes_batch_stage ở migration mới nhất định nghĩa nó) — cùng một tập.
// Lỗi gốc C142 (26/11): thêm 'closing' ở DB + FE, bộ kiểm `?stage=` của BE còn danh sách cũ ⇒ lọc "Chờ đóng phiếu" 400.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { MES_BATCH_STAGES } from '../../src/utils/mesStage'

const ROOT = path.resolve(__dirname, '../../..')
const strings = (src: string) => [...src.matchAll(/'([a-z_]+)'/g)].map(m => m[1])

describe('tình trạng mẻ — BE ⇄ FE ⇄ DB', () => {
  it('FE BATCH_STAGES = BE MES_BATCH_STAGES (cùng thứ tự — thứ tự công việc)', () => {
    const fe = fs.readFileSync(path.join(ROOT, 'frontend/src/components/wms/production/BatchStage.tsx'), 'utf8')
    const m = /export const BATCH_STAGES: BatchStage\[\] = \[([^\]]*)\]/.exec(fe)
    expect(m).not.toBeNull()
    expect(strings(m![1])).toEqual([...MES_BATCH_STAGES])
  })
  it('hàm DB mes_batch_stage (migration mới nhất) trả đúng tập khoá này', () => {
    const dir = path.join(ROOT, 'backend/migrations')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    const re = /CREATE (?:OR REPLACE )?FUNCTION public\.mes_batch_stage\([\s\S]*?\$function\$([\s\S]*?)\$function\$/
    const last = [...files].reverse().map(f => re.exec(fs.readFileSync(path.join(dir, f), 'utf8'))).find(Boolean)
    expect(last).toBeTruthy()
    const out = new Set([...last![1].matchAll(/(?:THEN|ELSE)\s+'([a-z_]+)'/g)].map(x => x[1]))
    expect([...out].sort()).toEqual([...MES_BATCH_STAGES].sort())
  })
})
