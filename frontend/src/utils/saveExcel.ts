// Lưu workbook Excel — CHO CHỌN VỊ TRÍ (browse) thay vì tự tải về Downloads.
// User chốt 22/07: mọi nút tải Excel phải mở hộp thoại chọn thư mục + NHỚ thư mục lần trước
// (để tải cố định 1 chỗ làm source cho Power Query).
//
// File System Access API (Chrome/Edge, secure context): showSaveFilePicker.
// - `id` cố định → trình duyệt TỰ NHỚ thư mục lần trước cho id đó (qua các phiên, không cần IndexedDB).
// - Người dùng bấm Huỷ HỘP CHỌN → không làm gì (không báo lỗi).
// Firefox/Safari / không hỗ trợ / non-secure → FALLBACK tải thẳng về Downloads (hành vi cũ).
//
// 19/11 (C124 — user: "chọn thư mục khác, save xong chẳng thấy kết quả, không báo gì cả"): bản cũ coi MỌI
// `AbortError` là "người dùng huỷ" — nhưng Chrome cũng trả AbortError khi chính BƯỚC GHI bị huỷ (Chrome / Windows
// chặn ghi vào thư mục đó) ⇒ file không được ghi mà màn hình im lặng. Nay tách hai giai đoạn: lỗi ở HỘP CHỌN
// (huỷ = im; không mở được = tải thẳng) và lỗi ở BƯỚC GHI (luôn báo + tải thẳng về Tải xuống + ghi error_logs).
// Lưu được thì báo "Đã lưu …" — lưu qua hộp chọn không hiện thanh tải xuống của trình duyệt nên trước đây không có gì xác nhận.
//
// 20/11 (C124 LẶP — user: "download Mẫu về mà không được, chọn đổi thử qua Desktop ⇒ không tải được"): Chrome còn trả
// AbortError NGAY Ở HỘP CHỌN khi người dùng đã chọn chỗ và bấm Save nhưng Chrome không tạo được file ở đó (vd Desktop
// trong OneDrive — Chrome không ghi nhận lần chọn, thư mục vẫn ghi được bằng chương trình khác). Bản 19/11 vẫn coi mọi
// AbortError ở hộp chọn là "bấm Huỷ" ⇒ im lặng. Nay chỉ coi là Huỷ khi đúng câu "The user aborted a request." (câu
// Chrome / Edge dùng khi bấm Huỷ, đo 20/11); AbortError khác = lỗi: báo + tải về Tải xuống + ghi error_logs kèm câu gốc.
import * as XLSX from 'xlsx'
import { toast } from '@/components/ui/use-toast'
import { reportClientError } from '@/lib/clientErrorReport'

const PICKER_ID = 'wmsExcelExport'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type Writable = { write: (data: Blob | BufferSource) => Promise<void>; close: () => Promise<void> }
type SaveFilePicker = (opts: {
  suggestedName?: string
  id?: string
  startIn?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<{ name?: string; createWritable: () => Promise<Writable> }>

function ensureXlsx(name: string) {
  return name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`
}
const errText = (e: unknown) => {
  const d = e as { name?: string; message?: string } | null
  return `${d?.name ?? 'Error'}: ${d?.message ?? String(e)}`
}
/** Tải thẳng về thư mục Tải xuống của trình duyệt. Trả false nếu cả cách này cũng không chạy. */
function downloadDirect(wb: XLSX.WorkBook, name: string): boolean {
  try { XLSX.writeFile(wb, name); return true } catch (e) { reportClientError(`saveExcel download ${errText(e)}`); return false }
}

/** Người dùng bấm Huỷ hộp chọn: Chrome / Edge trả AbortError với câu "… The user aborted a request.".
 *  AbortError với câu khác (vd "Failed to create or truncate file") là Chrome KHÔNG lưu được vào chỗ đã chọn. */
export function isUserCancel(e: unknown): boolean {
  const d = e as { name?: string; message?: string } | null
  return d?.name === 'AbortError' && /user aborted/i.test(d?.message ?? '')
}

/** Kết quả lưu — để test và (nếu cần) màn hình gọi tự xử lý tiếp. */
export type SaveResult = 'saved' | 'cancelled' | 'downloaded' | 'failed'

/** Lưu workbook: mở hộp thoại chọn vị trí (nhớ thư mục trước); fallback tải thẳng nếu trình duyệt không hỗ trợ. */
export async function saveWorkbook(wb: XLSX.WorkBook, filename: string): Promise<SaveResult> {
  const name = ensureXlsx(filename)
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (typeof picker !== 'function') return downloadDirect(wb, name) ? 'downloaded' : 'failed'

  // Giai đoạn 1 — HỘP CHỌN: huỷ = im lặng; không mở được (môi trường / quyền) = tải thẳng như trình duyệt không hỗ trợ.
  let handle: Awaited<ReturnType<SaveFilePicker>>
  try {
    handle = await picker({
      suggestedName: name,
      id: PICKER_ID,             // Chrome/Edge nhớ thư mục lần trước theo id này
      startIn: 'documents',      // gợi ý lần đầu (khi chưa có thư mục nhớ)
      types: [{ description: 'Excel', accept: { [XLSX_MIME]: ['.xlsx'] } }],
    })
  } catch (e) {
    if (isUserCancel(e)) return 'cancelled'   // người dùng bấm Huỷ hộp chọn
    reportClientError(`saveExcel picker ${errText(e)}`)
    const ok = downloadDirect(wb, name)
    // Hộp chọn ĐÃ hiện và người dùng đã chọn chỗ (AbortError không phải Huỷ) ⇒ phải nói rõ file không nằm ở chỗ đã chọn.
    // Lỗi khác (vd SecurityError — hộp chọn không mở được) thì người dùng chưa thấy hộp chọn: tải thẳng như trình duyệt cũ.
    if ((e as { name?: string } | null)?.name === 'AbortError') {
      toast({
        variant: 'destructive',
        title: 'Không lưu được vào thư mục đã chọn',
        description: (ok ? `Đã tải ${name} về thư mục Tải xuống thay thế. ` : '')
          + 'Muốn lưu chỗ khác: bấm tải lại và chọn thư mục khác (vd Documents).'
          + ` (${(e as { message?: string }).message?.replace(/^Failed to execute '\w+' on '\w+': /, '').slice(0, 80) ?? 'lỗi'})`,
      })
    }
    return ok ? 'downloaded' : 'failed'
  }

  // Giai đoạn 2 — GHI vào file đã chọn: lỗi ở đây KHÔNG BAO GIỜ im lặng (kể cả AbortError).
  try {
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const writable = await handle.createWritable()
    await writable.write(new Blob([buf], { type: XLSX_MIME }))
    await writable.close()
    toast({ title: `Đã lưu ${handle.name ?? name}`, description: 'Vào thư mục bạn vừa chọn.' })
    return 'saved'
  } catch (e) {
    reportClientError(`saveExcel write ${errText(e)}`)
    const ok = downloadDirect(wb, name)
    toast({
      variant: 'destructive',
      title: 'Không ghi được vào thư mục đã chọn',
      description: (ok ? `Đã tải ${name} về thư mục Tải xuống thay thế. ` : '')
        + 'File cùng tên đang mở trong Excel thì đóng lại; thư mục bị chặn ghi thì chọn thư mục khác rồi bấm tải lại.'
        + ` (${(e as { name?: string })?.name ?? 'lỗi'})`,
    })
    return ok ? 'downloaded' : 'failed'
  }
}
