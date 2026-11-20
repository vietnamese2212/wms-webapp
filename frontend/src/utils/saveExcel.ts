// Lưu workbook Excel — MỘT cửa cho mọi nút "Xuất Excel" / "Tải mẫu" của app.
//
// 20/11/2026 user chốt "Luôn tải thường": tải bằng cách tải xuống bình thường của trình duyệt (như mọi trang web).
// Chọn chỗ lưu + nhớ thư mục là việc của trình duyệt: Chrome / Edge bật "Hỏi vị trí lưu từng tệp trước khi tải
// xuống" thì hiện hộp Save As và nhớ thư mục lần trước; không bật thì file vào thư mục Tải xuống.
// Thay cho luật 22/07 (hộp chọn riêng của app qua File System Access API — `showSaveFilePicker`): hộp đó hỏng
// trên máy user ở cả Chrome lẫn Edge (trả "huỷ" sau 1 giây dù chưa bấm gì, lưu nhầm thư mục) — C124 lặp 3 lần
// 19–20/11, còn cách tải thường chạy đúng ở cùng máy. Đừng đưa hộp chọn riêng trở lại.
//
// File mẫu có cột mã danh mục (vd Mã BTP / Mã NVL của Định mức) truyền `validations` ⇒ Excel chỉ cho nhập mã
// có trong danh sách (Data Validation kiểu list) — SheetJS bản cộng đồng không ghi được phần này nên vá thẳng XML.
import * as XLSX from 'xlsx'
import { toast } from '@/components/ui/use-toast'
import { reportClientError } from '@/lib/clientErrorReport'
import { addListValidations, type ListValidation } from '@/utils/xlsxValidation'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function ensureXlsx(name: string) {
  return name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`
}
const errText = (e: unknown) => {
  const d = e as { name?: string; message?: string } | null
  return `${d?.name ?? 'Error'}: ${d?.message ?? String(e)}`
}

function downloadBytes(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export type SaveResult = 'downloaded' | 'failed'

/** Tải workbook về máy (cách tải thường của trình duyệt). `validations` = danh sách mã hợp lệ cho cột mã của file mẫu. */
export async function saveWorkbook(wb: XLSX.WorkBook, filename: string, opts?: { validations?: ListValidation[] }): Promise<SaveResult> {
  const name = ensureXlsx(filename)
  try {
    if (opts?.validations?.length) {
      const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      downloadBytes(addListValidations(new Uint8Array(raw), opts.validations), name)
    } else {
      XLSX.writeFile(wb, name)
    }
    return 'downloaded'
  } catch (e) {
    reportClientError(`saveExcel download ${errText(e)}`)
    toast({ variant: 'destructive', title: 'Không tải được file Excel', description: `${name} — thử lại; vẫn lỗi thì báo quản trị (${(e as { name?: string })?.name ?? 'lỗi'})` })
    return 'failed'
  }
}
