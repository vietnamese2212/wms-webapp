// FIFO / LIFO SO THEO NGÀY NHẬP KHO (user chốt 18/11: "FIFO theo ngày nhập", cả Xuất kho; trước đó so NSX — trùng FEFO khi
// cùng hạn dùng). Bảng tình huống → kết quả: mỗi ca dưới đây là một dòng của bảng đã hỏi user.
import { describe, it, expect } from 'vitest'
import { rotationSortKey, rotationDateOf, isRotationViolation, importDayMs, ROTATION_DATE_LABEL, type RotationEntry } from '../../src/utils/rotation'
import { slotFactsOf, type SlotFactsRaw } from '../../src/utils/putaway'

const mat = { shelf_life_days: 365 }
// NSX CŨ nhưng NHẬP SAU — đúng ca làm FIFO-theo-NSX và FIFO-theo-ngày-nhập trả lời KHÁC nhau
const oldNsxLateIn: RotationEntry = { production_date: '2026-01-01T00:00:00', import_date: '2026-03-10T00:00:00' }
const newNsxEarlyIn: RotationEntry = { production_date: '2026-02-15T00:00:00', import_date: '2026-03-01T00:00:00' }

describe('FIFO / LIFO theo ngày nhập kho', () => {
  it('FIFO: hàng NHẬP trước đi trước, dù NSX mới hơn', () => {
    const kOld = rotationSortKey(oldNsxLateIn, mat, 'FIFO')!
    const kNew = rotationSortKey(newNsxEarlyIn, mat, 'FIFO')!
    expect(kNew).toBeLessThan(kOld)
    // quét pallet nhập sau trong khi còn pallet nhập trước = sai thứ tự; ngược lại thì đúng
    expect(isRotationViolation(kOld, kNew)).toBe(true)
    expect(isRotationViolation(kNew, kOld)).toBe(false)
  })

  it('LIFO: hàng nhập SAU đi trước', () => {
    const kOld = rotationSortKey(oldNsxLateIn, mat, 'LIFO')!
    const kNew = rotationSortKey(newNsxEarlyIn, mat, 'LIFO')!
    expect(kOld).toBeLessThan(kNew)
  })

  it('cùng NGÀY nhập (khác giờ) = ngang nhau — lấy pallet nào trong ngày cũng đúng', () => {
    const a = rotationSortKey({ import_date: '2026-03-01T00:00:00' }, mat, 'FIFO')
    const b = rotationSortKey({ import_date: '2026-03-01T15:42:10' }, mat, 'FIFO')
    expect(a).toBe(b)
    expect(isRotationViolation(b, a)).toBe(false)
  })

  it('thiếu ngày nhập ⇒ không xếp hạng, không kết luận sai thứ tự', () => {
    expect(rotationSortKey({ production_date: '2026-01-01T00:00:00' }, mat, 'FIFO')).toBeNull()
    expect(rotationSortKey({ import_date: null }, mat, 'LIFO')).toBeNull()
    expect(isRotationViolation(null, rotationSortKey(newNsxEarlyIn, mat, 'FIFO'))).toBe(false)
  })

  it('đọc PHẦN NGÀY của chuỗi không múi giờ — không phụ thuộc đồng hồ máy chủ (lớp C45)', () => {
    expect(importDayMs('2026-03-01T00:00:00')).toBe(Date.UTC(2026, 2, 1))
    expect(importDayMs('2026-03-01')).toBe(Date.UTC(2026, 2, 1))
    expect(importDayMs('2026-12-31T23:59:59')).toBe(Date.UTC(2026, 11, 31))
    expect(importDayMs('rác')).toBeNull()
    expect(importDayMs(undefined)).toBeNull()
  })

  it('ngày hiển thị + nhãn cột: FIFO / LIFO = "Ngày nhập", FEFO giữ HSD', () => {
    expect(rotationDateOf(newNsxEarlyIn, mat, 'FIFO')).toBe('2026-03-01')
    expect(rotationDateOf(newNsxEarlyIn, mat, 'LIFO')).toBe('2026-03-01')
    expect(ROTATION_DATE_LABEL.FIFO).toBe('Ngày nhập')
    expect(ROTATION_DATE_LABEL.LIFO).toBe('Ngày nhập')
    expect(ROTATION_DATE_LABEL.FEFO).toBe('HSD')
  })

  it('FEFO không đổi: HSD sớm nhất trước, ngày nhập không ảnh hưởng', () => {
    const kOld = rotationSortKey(oldNsxLateIn, mat, 'FEFO')!   // NSX 01/01 + 365 ngày
    const kNew = rotationSortKey(newNsxEarlyIn, mat, 'FEFO')!  // NSX 15/02 + 365 ngày
    expect(kOld).toBeLessThan(kNew)
  })

  it('cất hàng: khoảng ngày của ô ở kho FIFO dựng từ ngày nhập (imin / imax), FEFO vẫn từ NSX / HSD', () => {
    const raw: SlotFactsRaw = {
      location_id: 'L1', pallets: 2, materials: 1, same_material: true, qa_hold: false, nccs: [], mats: [],
      lots: [{ m: 'M1', n: null, s: 365, no_exp: true, pmin: '2026-01-01T00:00:00', pmax: '2026-01-05T00:00:00', emin: null, emax: null,
        imin: '2026-03-01T00:00:00', imax: '2026-03-10T00:00:00' }],
    }
    const mats = new Map([['M1', mat]])
    const fifo = slotFactsOf(raw, 'FIFO', mats)
    expect(fifo.keyMin).toBe(Date.UTC(2026, 2, 1))
    expect(fifo.keyMax).toBe(Date.UTC(2026, 2, 10))
    const fefo = slotFactsOf(raw, 'FEFO', mats)
    expect(fefo.keyMin).toBe(Date.parse('2026-01-01T00:00:00') + 365 * 86_400_000)
  })
})
