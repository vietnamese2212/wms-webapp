// saveExcel — MỘT cửa tải Excel của app.
// C124 (19–20/11): hộp chọn riêng của app (File System Access `showSaveFilePicker`) hỏng trên máy user ở cả Chrome lẫn Edge
// (trả "huỷ" sau 1 giây, lưu nhầm thư mục) ⇒ user chốt 20/11 "Luôn tải thường": không bao giờ gọi showSaveFilePicker nữa.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const toast = vi.fn()
const report = vi.fn()
const writeFile = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ toast: (a: unknown) => toast(a) }))
vi.mock('@/lib/clientErrorReport', () => ({ reportClientError: (m: string) => report(m) }))
vi.mock('../../../frontend/node_modules/xlsx', () => ({ writeFile: (...a: unknown[]) => writeFile(...a), write: () => new ArrayBuffer(8) }))

const wb = { SheetNames: [], Sheets: {} } as never
beforeEach(() => { toast.mockReset(); report.mockReset(); writeFile.mockReset() })

describe('saveWorkbook — tải thường (C124, user chốt 20/11)', () => {
  it('trình duyệt CÓ showSaveFilePicker ⇒ KHÔNG gọi, tải thường (writeFile)', async () => {
    const picker = vi.fn()
    ;(globalThis as unknown as { window: unknown }).window = { showSaveFilePicker: picker }
    const { saveWorkbook } = await import('../../../frontend/src/utils/saveExcel')
    expect(await saveWorkbook(wb, 'mau_dinh_muc')).toBe('downloaded')
    expect(picker).not.toHaveBeenCalled()
    expect(writeFile).toHaveBeenCalledWith(wb, 'mau_dinh_muc.xlsx')
    expect(toast).not.toHaveBeenCalled()
  })
  it('tải lỗi ⇒ băng đỏ + ghi error_logs, không im lặng', async () => {
    writeFile.mockImplementation(() => { throw new Error('quota') })
    const { saveWorkbook } = await import('../../../frontend/src/utils/saveExcel')
    expect(await saveWorkbook(wb, 'x.xlsx')).toBe('failed')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Không tải được file Excel' }))
    expect(report.mock.calls[0][0]).toMatch(/^saveExcel download Error: quota/)
  })
})
