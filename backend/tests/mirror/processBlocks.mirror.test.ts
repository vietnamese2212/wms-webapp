// MIRROR luật hình dạng mẫu phiếu theo dõi (MES): BE utils/processBlocks ⇄ FE config/processForms `blocksError`.
// Rà 16/11: FE thiếu luật "mã ô trùng tiền tố bảng" ⇒ người dùng gõ xong cả phiếu, bấm lưu mới bị 422; nút "Thêm bảng" lần 3
// sinh trùng mã bang2 ⇒ kẹt. Bất biến: mọi bộ khối hợp lệ theo zod ⇒ hai bên cùng nói "được" hoặc cùng nói "không".
import { describe, it, expect } from 'vitest'
import { processBlocksError as BE } from '../../src/utils/processBlocks'
import { blocksError as FE, gridKeyFor, type FormBlock } from '../../../frontend/src/config/processForms'

const F = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: key, kind: 'num' as const, ...extra })
const G = (key: string, rows = 2, cols = ['c1'], cells = ['t']) =>
  ({ type: 'grid' as const, key, title: key, rows, cols: cols.map(k => ({ key: k, label: k })), cells: cells.map(k => ({ key: k, label: k, kind: 'num' as const })) })
const fields = (...fs: ReturnType<typeof F>[]) => ({ type: 'fields' as const, title: 'nhóm', fields: fs })

const CASES: [string, FormBlock[]][] = [
  ['hợp lệ', [fields(F('a'), F('b')), G('wash')]],
  ['trùng mã ô', [fields(F('a'), F('a'))]],
  ['trùng mã ô ở hai nhóm', [fields(F('a')), fields(F('a'))]],
  ['ngưỡng ngược', [fields(F('a', { min: 5, max: 1 }))]],
  ['ngưỡng trên ô chữ', [fields(F('a', { kind: 'text', max: 1 }))]],
  ['hai bảng cùng mã', [G('bang'), G('bang')]],
  ['bảng trùng mã cột', [G('bang', 2, ['c1', 'c1'])]],
  ['bảng trùng mã ô', [G('bang', 2, ['c1'], ['t', 't'])]],
  ['mã ô trùng tiền tố bảng', [fields(F('bang_nhiet')), G('bang')]],
  ['mã ô KHÔNG trùng tiền tố (bang2 ≠ bang_)', [fields(F('bang2x')), G('bang')]],
  ['đúng 300 ô', [G('a', 30, ['c1', 'c2', 'c3', 'c4', 'c5'], ['t', 'u'])]],
  ['301 ô', [G('a', 30, ['c1', 'c2', 'c3', 'c4', 'c5'], ['t', 'u']), fields(F('z'))]],
]

describe('processBlocks BE ⇄ FE', () => {
  for (const [name, blocks] of CASES) it(name, () => {
    expect(!!FE(blocks), `FE: ${FE(blocks)} · BE: ${BE(blocks as never)}`).toBe(!!BE(blocks as never))
  })
  it('thêm bảng nhiều lần không sinh trùng mã, không đụng tiền tố mã ô', () => {
    let blocks: FormBlock[] = [fields(F('bang_x'))]
    for (let i = 0; i < 5; i++) blocks = [...blocks, G(gridKeyFor(blocks))]
    const keys = blocks.filter(b => b.type === 'grid').map(b => (b as { key: string }).key)
    expect(new Set(keys).size).toBe(5)
    expect(keys).not.toContain('bang')
    expect(BE(blocks as never)).toBeNull()
    expect(FE(blocks)).toBe('')
  })
})
