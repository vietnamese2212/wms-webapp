// Rà Excel toàn app 20/11 — lưới cho 3 helper phía màn hình:
//  · fetchAllPages: nút XUẤT phải lấy đủ mọi trang theo bộ lọc (Chấm công, Sổ đóng gói ×2, Lịch sử quét lúc tìm… từng xuất
//    đúng trang đang xem) và vượt trần thì BÁO, không cắt âm thầm.
//  · excelTemplate: sheet dữ liệu của file mẫu CHỈ có dòng tên cột — ví dụ ở sheet "Hướng dẫn" (C125 LẶP: 7 mẫu để ví dụ trên
//    sheet dữ liệu, nạp nguyên file mẫu là ghi thật).
//  · excelSafe: số âm dạng chữ không bị gắn dấu nháy ("'-5" hiện nguyên trong ô .xlsx).
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'module'
import path from 'path'

vi.mock('@/components/ui/use-toast', () => ({ toast: () => {} }))
vi.mock('@/lib/clientErrorReport', () => ({ reportClientError: () => {} }))

import { fetchAllPages, ExportTooLargeError, exportErrorMessage } from '../../../frontend/src/api/fetchAllPages'
import { buildTemplateWorkbook } from '../../../frontend/src/utils/excelTemplate'
import { sanitizeCell, sanitizeRows } from '../../../frontend/src/utils/excelSafe'

const XLSX = createRequire(path.resolve(__dirname, '../../../frontend/package.json'))('xlsx') as typeof import('xlsx')

describe('fetchAllPages — xuất đủ mọi trang', () => {
  const pager = (total: number) => vi.fn(async (page: number, size: number) => {
    const from = (page - 1) * size
    return { rows: Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => from + i), total }
  })
  it('gom hết các trang theo total, dừng đúng lúc', async () => {
    const load = pager(1234)
    const all = await fetchAllPages(load, { pageSize: 500 })
    expect(all).toHaveLength(1234)
    expect(new Set(all).size).toBe(1234)
    expect(load).toHaveBeenCalledTimes(3)
  })
  it('vừa khít một trang ⇒ không gọi thêm trang rỗng', async () => {
    const load = pager(500)
    expect(await fetchAllPages(load, { pageSize: 500 })).toHaveLength(500)
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('vượt trần ⇒ ném lỗi có lời nhắn, không trả file cụt', async () => {
    await expect(fetchAllPages(pager(60_001), { pageSize: 1000 })).rejects.toBeInstanceOf(ExportTooLargeError)
    await expect(fetchAllPages(pager(1200), { pageSize: 500, maxRows: 1000 })).rejects.toThrow(/Quá nhiều dòng/)
  })
  it('total server nói thiếu nhưng trang vẫn đầy ⇒ vẫn dừng ở trần (không lặp vô hạn)', async () => {
    const load = vi.fn(async (_p: number, size: number) => ({ rows: Array(size).fill(0), total: 0 }))
    const all = await fetchAllPages(load, { pageSize: 10 })
    expect(all).toHaveLength(10)
  })
  it('exportErrorMessage: ưu tiên lời nhắn API, rồi lời nhắn trần', () => {
    expect(exportErrorMessage({ response: { data: { error: { message: 'Hết giờ' } } } })).toBe('Hết giờ')
    expect(exportErrorMessage(new ExportTooLargeError(9, 5))).toMatch(/lọc hẹp/)
  })
})

describe('excelTemplate — ví dụ không bao giờ nằm trên sheet dữ liệu', () => {
  const wb = buildTemplateWorkbook({
    file: 'mau_x.xlsx', sheet: 'ViTriKho', header: [['Kho *', 'Khu *', 'Sức chứa'], ['warehouse', 'sub_code', 'max_pallets']],
    title: 'NẠP THỬ', notes: ['Ghi chú riêng'], examples: [['20000016', 'TP1', 2]],
  })
  it('sheet đầu = sheet dữ liệu, chỉ 2 dòng tên cột', () => {
    expect(wb.SheetNames).toEqual(['ViTriKho', 'Hướng dẫn'])
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.ViTriKho, { header: 1, defval: '' })
    expect(aoa).toEqual([['Kho *', 'Khu *', 'Sức chứa'], ['warehouse', 'sub_code', 'max_pallets']])
  })
  it('sheet Hướng dẫn có ví dụ + luật chung + dòng bắt đầu điền', () => {
    const txt = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Hướng dẫn'], { header: 1, defval: '' }).map(r => r.join('|')).join('\n')
    expect(txt).toContain('20000016|TP1|2')
    expect(txt).toContain('Cột có dấu * là bắt buộc')
    expect(txt).toContain('Ghi chú riêng')
    expect(txt).toContain('từ dòng 3')
  })
})

describe('excelSafe — chống công thức mà không làm bẩn số âm', () => {
  it('số âm / gạch trống giữ nguyên; công thức thì gắn nháy', () => {
    expect(sanitizeCell('-5')).toBe('-5')
    expect(sanitizeCell('-1,5')).toBe('-1,5')
    expect(sanitizeCell('-')).toBe('-')
    expect(sanitizeCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(sanitizeCell('-2+cmd|x')).toBe(`'-2+cmd|x`)
    expect(sanitizeCell('+84')).toBe(`'+84`)
    expect(sanitizeCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
    expect(sanitizeRows([{ a: -5, b: 'ok' }])).toEqual([{ a: -5, b: 'ok' }])
  })
})
