// DANH SÁCH HỢP LỆ cho cột của file Excel tải về (Data Validation kiểu list) — 20/11 (user: "validate file excel tải về ở
// Định mức, đảm bảo mã hàng"). SheetJS bản cộng đồng KHÔNG ghi được Data Validation ⇒ ghi workbook ra zip như thường rồi
// chèn khối <dataValidations> vào XML của sheet (zip đọc / ghi bằng CFB đi kèm SheetJS — không thêm thư viện).
// Gọi qua saveWorkbook(wb, tên, { validations }) — không gọi riêng. Test: backend/tests/unit/xlsxValidation.test.ts.
import * as XLSX from 'xlsx'

export type ListValidation = {
  /** 0 = sheet đầu tiên (thứ tự sheet trong workbook) */
  sheetIndex: number
  /** vùng áp, vd "A2:A20001" */
  sqref: string
  /** nguồn danh sách, vd "'Mã NVL'!$A$2:$A$2759" */
  source: string
  /** tiêu đề hộp báo (Excel giới hạn 32 ký tự) */
  title: string
  /** câu báo khi nhập giá trị ngoài danh sách (≤ 255 ký tự) */
  error: string
  /** câu gợi ý khi chọn ô (≤ 255 ký tự) */
  prompt?: string
}

type CfbEntry = { content: Uint8Array; size: number }
type CfbApi = {
  read: (d: Uint8Array, o: { type: 'buffer' }) => unknown
  find: (c: unknown, path: string) => CfbEntry | null
  write: (c: unknown, o: { fileType: 'zip'; type: 'array' | 'buffer'; compression?: boolean }) => ArrayLike<number>
}
const cfbApi = () => (XLSX as unknown as { CFB: CfbApi }).CFB   // đọc lúc dùng (không lúc nạp module)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Thứ tự con của <worksheet> (ECMA-376): dataValidations đứng SAU sheetData / mergeCells / conditionalFormatting và TRƯỚC
// các phần dưới — Excel báo "file hỏng, sửa chữa?" nếu đặt sai chỗ.
const AFTER_VALIDATIONS = ['<hyperlinks', '<printOptions', '<pageMargins', '<pageSetup', '<headerFooter', '<rowBreaks', '<colBreaks',
  '<customProperties', '<cellWatches', '<ignoredErrors', '<smartTags', '<drawing', '<legacyDrawing', '<picture', '<oleObjects',
  '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>']

export function validationsXml(list: ListValidation[]): string {
  return `<dataValidations count="${list.length}">` + list.map(v =>
    `<dataValidation type="list" allowBlank="1" showInputMessage="${v.prompt ? 1 : 0}" showErrorMessage="1" errorStyle="stop"`
    + ` errorTitle="${esc(v.title.slice(0, 32))}" error="${esc(v.error.slice(0, 255))}"`
    + (v.prompt ? ` promptTitle="${esc(v.title.slice(0, 32))}" prompt="${esc(v.prompt.slice(0, 255))}"` : '')
    + ` sqref="${esc(v.sqref)}"><formula1>${esc(v.source)}</formula1></dataValidation>`).join('') + '</dataValidations>'
}

/** Chèn khối dataValidations vào XML một sheet, đúng vị trí theo chuẩn. */
export function insertValidations(sheetXml: string, list: ListValidation[]): string {
  if (sheetXml.includes('<dataValidations')) throw new Error('sheet đã có dataValidations')
  const dataEnd = Math.max(sheetXml.indexOf('</sheetData>'), sheetXml.indexOf('<sheetData/>'))
  if (dataEnd < 0) throw new Error('sheet không có sheetData')
  let at = -1
  for (const tag of AFTER_VALIDATIONS) {
    const i = sheetXml.indexOf(tag, dataEnd)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  return sheetXml.slice(0, at) + validationsXml(list) + sheetXml.slice(at)
}

/** Nhận file .xlsx (bytes do SheetJS ghi), trả file đã gắn danh sách hợp lệ. Sheet thứ i nằm ở xl/worksheets/sheet{i+1}.xml. */
export function addListValidations(xlsx: Uint8Array, list: ListValidation[]): Uint8Array<ArrayBuffer> {
  const CFB = cfbApi()
  const zip = CFB.read(xlsx, { type: 'buffer' })
  const bySheet = new Map<number, ListValidation[]>()
  for (const v of list) bySheet.set(v.sheetIndex, [...(bySheet.get(v.sheetIndex) ?? []), v])
  for (const [idx, vs] of bySheet) {
    const entry = CFB.find(zip, `/xl/worksheets/sheet${idx + 1}.xml`)
    if (!entry) throw new Error(`không thấy sheet thứ ${idx + 1} trong file`)
    const xml = insertValidations(new TextDecoder().decode(entry.content), vs)
    entry.content = new TextEncoder().encode(xml)
    entry.size = entry.content.length
  }
  return Uint8Array.from(CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }))
}
