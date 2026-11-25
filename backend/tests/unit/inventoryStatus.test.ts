// Bản TS của luật trạng thái dòng tồn chạy CÙNG bảng ca với hàm SQL inventory_entry_status (khối DO trong migration 20261125e
// đọc lại đúng các ca này) — đổi luật thì sửa bảng ca, cả hai bản cùng đỏ / xanh.
import { describe, it, expect } from 'vitest'
import cases from './inventoryStatusCases.json'
import { inventoryEntryStatus } from '../../src/utils/inventoryStatus'

describe('inventoryEntryStatus — một luật trạng thái dòng tồn', () => {
  for (const c of cases as { cur: string | null; remaining: number; imported: number; reserved: number; want: string }[]) {
    it(`${c.cur ?? 'null'} còn ${c.remaining}/${c.imported} giữ ${c.reserved} ⇒ ${c.want}`, () => {
      expect(inventoryEntryStatus(c.cur, c.remaining, c.imported, c.reserved)).toBe(c.want)
    })
  }
})
