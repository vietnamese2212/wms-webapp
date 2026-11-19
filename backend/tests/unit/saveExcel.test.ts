// C124 (19/11) — lưu Excel qua hộp chọn vị trí: lỗi ở BƯỚC GHI không được im lặng (kể cả AbortError Chrome trả khi chặn ghi).
// User: "chọn thư mục khác, save xong chẳng thấy kết quả, không báo gì cả".
import { describe, it, expect, vi, beforeEach } from 'vitest'

const toast = vi.fn()
const report = vi.fn()
const writeFile = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ toast: (a: unknown) => toast(a) }))
vi.mock('@/lib/clientErrorReport', () => ({ reportClientError: (m: string) => report(m) }))
vi.mock('../../../frontend/node_modules/xlsx', () => ({ writeFile: (...a: unknown[]) => writeFile(...a), write: () => new ArrayBuffer(8) }))

const abort = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
type Picker = (o: unknown) => Promise<unknown>
function setPicker(p: Picker | undefined) { (globalThis as unknown as { window: unknown }).window = { showSaveFilePicker: p } }
const wb = { SheetNames: [], Sheets: {} } as never

beforeEach(() => { toast.mockReset(); report.mockReset(); writeFile.mockReset() })

describe('saveWorkbook — chọn vị trí lưu (C124)', () => {
  it('bấm Huỷ ở HỘP CHỌN ⇒ im lặng, không tải, không báo', async () => {
    setPicker(() => Promise.reject(abort()))
    const { saveWorkbook } = await import('../../../frontend/src/utils/saveExcel')
    expect(await saveWorkbook(wb, 'mau')).toBe('cancelled')
    expect(writeFile).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled()
  })
  it('BƯỚC GHI bị huỷ (AbortError lúc close) ⇒ báo lỗi + tải về Tải xuống + ghi error_logs — không im lặng', async () => {
    setPicker(() => Promise.resolve({ name: 'mau.xlsx', createWritable: async () => ({ write: async () => {}, close: async () => { throw abort() } }) }))
    const { saveWorkbook } = await import('../../../frontend/src/utils/saveExcel')
    expect(await saveWorkbook(wb, 'mau')).toBe('downloaded')
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    expect(report.mock.calls[0][0]).toMatch(/saveExcel write AbortError/)
  })
  it('ghi được ⇒ báo "Đã lưu <tên file>"', async () => {
    setPicker(() => Promise.resolve({ name: 'mau_dinh_muc.xlsx', createWritable: async () => ({ write: async () => {}, close: async () => {} }) }))
    const { saveWorkbook } = await import('../../../frontend/src/utils/saveExcel')
    expect(await saveWorkbook(wb, 'mau_dinh_muc')).toBe('saved')
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Đã lưu mau_dinh_muc.xlsx' })
    expect(writeFile).not.toHaveBeenCalled()
  })
  it('trình duyệt không có hộp chọn ⇒ tải thẳng (hành vi cũ)', async () => {
    setPicker(undefined)
    const { saveWorkbook } = await import('../../../frontend/src/utils/saveExcel')
    expect(await saveWorkbook(wb, 'mau')).toBe('downloaded')
    expect(writeFile).toHaveBeenCalledWith(wb, 'mau.xlsx')
  })
})
