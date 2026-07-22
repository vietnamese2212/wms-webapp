// Lưu workbook Excel — CHO CHỌN VỊ TRÍ (browse) thay vì tự tải về Downloads.
// User chốt 22/07: mọi nút tải Excel phải mở hộp thoại chọn thư mục + NHỚ thư mục lần trước
// (để tải cố định 1 chỗ làm source cho Power Query).
//
// File System Access API (Chrome/Edge, secure context): showSaveFilePicker.
// - `id` cố định → trình duyệt TỰ NHỚ thư mục lần trước cho id đó (qua các phiên, không cần IndexedDB).
// - Người dùng bấm Huỷ hộp thoại → không làm gì (không báo lỗi).
// Firefox/Safari / không hỗ trợ / non-secure → FALLBACK tải thẳng về Downloads (hành vi cũ).
import * as XLSX from 'xlsx'

const PICKER_ID = 'wmsExcelExport'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type SaveFilePicker = (opts: {
  suggestedName?: string
  id?: string
  startIn?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable: () => Promise<{ write: (data: Blob | BufferSource) => Promise<void>; close: () => Promise<void> }> }>

function ensureXlsx(name: string) {
  return name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`
}

/** Lưu workbook: mở hộp thoại chọn vị trí (nhớ thư mục trước); fallback tải thẳng nếu trình duyệt không hỗ trợ. */
export async function saveWorkbook(wb: XLSX.WorkBook, filename: string): Promise<void> {
  const name = ensureXlsx(filename)
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: name,
        id: PICKER_ID,             // Chrome/Edge nhớ thư mục lần trước theo id này
        startIn: 'documents',      // gợi ý lần đầu (khi chưa có thư mục nhớ)
        types: [{ description: 'Excel', accept: { [XLSX_MIME]: ['.xlsx'] } }],
      })
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      const writable = await handle.createWritable()
      await writable.write(new Blob([buf], { type: XLSX_MIME }))
      await writable.close()
      return
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return   // người dùng huỷ hộp thoại
      // Lỗi khác (quyền/môi trường) → rơi xuống fallback tải thẳng
    }
  }
  try { XLSX.writeFile(wb, name) } catch { /* fallback: Firefox/Safari/non-secure → tải về Downloads */ }
}
