// C124 (19/11) — lưu Excel qua hộp chọn vị trí: lỗi ở BƯỚC GHI không được im lặng (kể cả AbortError Chrome trả khi chặn ghi).
// User: "chọn thư mục khác, save xong chẳng thấy kết quả, không báo gì cả".
import { describe, it, expect, vi, beforeEach } from 'vitest'

const toast = vi.fn()
const report = vi.fn()
const writeFile = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ toast: (a: unknown) => toast(a) }))
vi.mock('@/lib/clientErrorReport', () => ({ reportClientError: (m: string) => report(m) }))
vi.mock('@/components/ui/toast', () => ({ ToastAction: 'button' }))
vi.mock('../../../frontend/node_modules/xlsx', () => ({ writeFile: (...a: unknown[]) => writeFile(...a), write: () => new ArrayBuffer(8) }))

// câu Chrome thật khi bấm Huỷ (đo bằng Chromium 20/11)
const abort = () => Object.assign(new Error("Failed to execute 'showSaveFilePicker' on 'Window': The user aborted a request."), { name: 'AbortError' })
// đã chọn chỗ + bấm Save nhưng Chrome không tạo được file ở đó (20/11: Desktop trong OneDrive) — CÙNG tên lỗi, KHÁC câu
const abortCreate = () => Object.assign(new Error('Failed to create or truncate file'), { name: 'AbortError' })
type Picker = (o: unknown) => Promise<unknown>
function setPicker(p: Picker | undefined) { (globalThis as unknown as { window: unknown }).window = { showSaveFilePicker: p } }
const wb = { SheetNames: [], Sheets: {} } as never

beforeEach(() => { toast.mockReset(); report.mockReset(); writeFile.mockReset() })

describe('saveWorkbook — chọn vị trí lưu (C124)', () => {
  it('C124 LẶP lần 2 (20/11 chiều): HỘP CHỌN trả "user aborted" ⇒ KHÔNG im lặng — báo "Chưa lưu file" + nút Tải về + ghi error_logs; không tự tải', async () => {
    // Chrome trả CÙNG câu này cả khi người dùng bấm Huỷ lẫn khi Chrome tự huỷ sau khi đã bấm Save (máy user 20/11)
    setPicker(() => Promise.reject(abort()))
    const { saveWorkbook } = await import('../../../frontend/src/utils/saveExcel')
    expect(await saveWorkbook(wb, 'mau')).toBe('cancelled')
    expect(writeFile).not.toHaveBeenCalled()
    const t = toast.mock.calls[0]?.[0] as { title: string; action: { props: { onClick: () => void; children: string } } }
    expect(t.title).toBe('Chưa lưu file')
    expect(t.action.props.children).toBe('Tải về')
    expect(report.mock.calls[0][0]).toMatch(/^saveExcel picker cancel \d+s$/)
    t.action.props.onClick()
    expect(writeFile).toHaveBeenCalledWith(wb, 'mau.xlsx')
  })
  it('C124 LẶP 20/11: HỘP CHỌN trả AbortError KHÔNG phải Huỷ (Chrome không tạo được file ở thư mục đã chọn) ⇒ báo + tải về Tải xuống + ghi error_logs', async () => {
    setPicker(() => Promise.reject(abortCreate()))
    const { saveWorkbook } = await import('../../../frontend/src/utils/saveExcel')
    expect(await saveWorkbook(wb, 'mau_dinh_muc')).toBe('downloaded')
    expect(writeFile).toHaveBeenCalledWith(wb, 'mau_dinh_muc.xlsx')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Không lưu được vào thư mục đã chọn' }))
    expect(report.mock.calls[0][0]).toMatch(/saveExcel picker AbortError: Failed to create or truncate file/)
  })
  it('isUserCancel: chỉ câu "user aborted" mới là Huỷ', async () => {
    const { isUserCancel } = await import('../../../frontend/src/utils/saveExcel')
    expect(isUserCancel(abort())).toBe(true)
    expect(isUserCancel(abortCreate())).toBe(false)
    expect(isUserCancel(Object.assign(new Error('x'), { name: 'SecurityError' }))).toBe(false)
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
