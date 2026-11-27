// FILE MẪU "NẠP ĐỊNH MỨC TỪ EXCEL" (19/11; 20/11 thêm DANH SÁCH MÃ — user: "validate file excel tải về ở Định mức, đảm bảo mã hàng").
// Server đọc SHEET ĐẦU theo TÊN cột (backend utils/recipeImport.ts RECIPE_IMPORT_FIELDS); sheet đầu chỉ có tiêu đề + công thức tra tên,
// ví dụ nằm ở sheet "Hướng dẫn" ⇒ quên xoá ví dụ cũng không nạp nhầm.
// Danh mục lấy từ GET /wms/production/recipes/import-catalog — server chọn mã BTP bằng CHÍNH hàm kiểm của lần nạp (btpImportError).
//   • Mã BTP / Mã NVL: Data Validation kiểu list trỏ sang sheet "Mã BTP" / "Mã NVL" ⇒ gõ mã ngoài danh mục là Excel chặn.
//   • Tên BTP / Tên nguyên liệu / ĐVT: công thức tra theo mã (cột Tên server bỏ qua; ĐVT tra đúng đơn vị gốc nên luôn khớp luật kiểm).
//     Dán (Ctrl+V) thì Excel KHÔNG chặn ⇒ cột Tên hiện "⚠ Không có mã này" là lưới thứ hai; server vẫn là lưới cuối.
//   • Mã toàn chữ số (không số 0 đầu) ghi vào danh mục dạng SỐ: ô gõ 210000101 thành số ⇒ khớp danh sách; tra tên thử cả dạng số lẫn chữ.
// Test: backend/tests/unit/recipeTemplate.test.ts (file mẫu → điền → server parse + planRecipeImport đi qua).
import * as XLSX from 'xlsx'
import type { ListValidation } from '@/utils/xlsxValidation'

export type RecipeCatalogRow = { code: string; name: string | null; unit: string | null; active: boolean }
export type RecipeImportCatalog = { btp: RecipeCatalogRow[]; nvl: RecipeCatalogRow[] }

// 27/11: Cỡ mẻ chuẩn + Số lượng thôi bắt buộc — để trống HẾT ở một công thức = công thức chỉ danh sách mã (kho không định mức)
export const IMPORT_HEAD = ['Mã BTP *', 'Tên BTP', 'Tên công thức *', 'Cỡ mẻ chuẩn', 'Mã NVL *', 'Tên nguyên liệu', 'Số lượng', 'ĐVT', 'Mức lệch ± %', 'Mặc định', 'Ghi chú']
/** Dòng có sẵn công thức tra tên / ĐVT (dòng 2 → 1+FORMULA_ROWS); vượt thì kéo công thức xuống. */
export const TEMPLATE_FORMULA_ROWS = 1000
/** Vùng có danh sách mã = trần số dòng một lần nạp của server (RECIPE_IMPORT_MAX_ROWS). */
export const TEMPLATE_VALIDATION_ROWS = 20_000
export const SHEET_BTP = 'Mã BTP'
export const SHEET_NVL = 'Mã NVL'
const MISSING = '⚠ Không có mã này'

/** Mã toàn chữ số, không số 0 đầu, ≤ 15 chữ số ⇒ ghi dạng số (khớp ô người dùng gõ số); còn lại giữ chữ. */
export const catalogCell = (code: string): string | number => (/^[1-9]\d{0,14}$/.test(code) ? Number(code) : code)

/** Tra cột `col` của sheet danh mục theo ô mã `key` — thử nguyên dạng, dạng số, dạng chữ. */
function lookup(key: string, sheet: string, col: number, miss: string) {
  const r = `'${sheet}'!$A:$D`
  return `IF(${key}="","",IFERROR(VLOOKUP(${key},${r},${col},0),IFERROR(VLOOKUP(--${key},${r},${col},0),IFERROR(VLOOKUP(${key}&"",${r},${col},0),"${miss}"))))`
}

export function buildRecipeTemplate(cat: RecipeImportCatalog): { wb: XLSX.WorkBook; validations: ListValidation[] } {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([IMPORT_HEAD])
  for (let r = 2; r <= TEMPLATE_FORMULA_ROWS + 1; r++) {
    ws[`B${r}`] = { t: 's', f: lookup(`$A${r}`, SHEET_BTP, 2, MISSING) }
    ws[`F${r}`] = { t: 's', f: lookup(`$E${r}`, SHEET_NVL, 2, MISSING) }
    ws[`H${r}`] = { t: 's', f: lookup(`$E${r}`, SHEET_NVL, 3, '') }
  }
  ws['!ref'] = `A1:K${TEMPLATE_FORMULA_ROWS + 1}`
  ws['!cols'] = [14, 26, 20, 12, 14, 30, 10, 7, 11, 9, 24].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'Định mức')

  const guide = XLSX.utils.aoa_to_sheet([
    ['NẠP ĐỊNH MỨC TỪ EXCEL — app chỉ đọc sheet ĐẦU TIÊN ("Định mức"), theo TÊN cột (đổi thứ tự cột được)'],
    [],
    ['Cột', 'Bắt buộc', 'Ghi chú'],
    ['Mã BTP', 'Có', `Chọn trong danh sách (sheet "${SHEET_BTP}": mã đã đánh dấu "Bán thành phẩm" ở Mã hàng, đơn vị gốc L hoặc KG). Gõ mã ngoài danh sách thì Excel chặn`],
    ['Tên công thức', 'Có', 'Một mã có thể có nhiều công thức. Cùng mã + cùng tên (không phân biệt hoa thường) = một công thức'],
    ['Cỡ mẻ chuẩn', 'Có số lượng', 'Theo đơn vị gốc của mã BTP. Ghi ở dòng đầu của công thức là đủ; các dòng có ghi phải bằng nhau. Công thức chỉ danh sách mã (kho không định mức): để trống'],
    ['Mã NVL', 'Có', `Chọn hoặc gõ mã có trong sheet "${SHEET_NVL}" (danh mục Mã hàng). Gõ mã sai thì Excel chặn. Một mã chỉ xuất hiện một lần trong một công thức`],
    ['Tên BTP · Tên nguyên liệu · ĐVT', 'Tự hiện', `Tự tra theo mã (${TEMPLATE_FORMULA_ROWS.toLocaleString('vi-VN')} dòng đầu có sẵn công thức). Dán mã bằng Ctrl+V thì Excel KHÔNG chặn: cột Tên hiện "${MISSING}" là mã sai, sửa trước khi nạp`],
    ['Số lượng', 'Có số lượng', 'Lượng cho MỘT mẻ cỡ chuẩn, theo đơn vị gốc của mã NVL (cột ĐVT) — viết 1.234,5 hoặc 1234.5 đều được. Công thức chỉ danh sách mã: để trống MỌI dòng của công thức (có số ở một dòng thì mọi dòng phải có)'],
    ['Mức lệch ± %', '', 'Từ 0 tới 100. Cấp ngoài mức này thì dòng tô đỏ trên phiếu của mẻ. Để trống = không kiểm'],
    ['Mặc định', '', 'Ghi "Có" để đặt làm công thức mặc định của mã (mỗi mã tối đa một). Để trống = giữ như cũ'],
    ['Ghi chú', '', 'Ghi chú của công thức. Để trống = giữ ghi chú cũ'],
    [],
    ['Công thức đã có (cùng Mã BTP + Tên công thức) ⇒ thay TRỌN danh sách nguyên liệu bằng các dòng trong file. Chưa có ⇒ thêm mới.'],
    ['File còn một lỗi thì KHÔNG ghi gì. Trước khi ghi, app hiện báo cáo kiểm để bạn xem và bấm Xác nhận.'],
    ...(cat.btp.length ? [] : [[], ['CHƯA CÓ MÃ BÁN THÀNH PHẨM nào trong phạm vi của bạn — đánh dấu "Bán thành phẩm" ở trang Mã hàng trước rồi tải lại file mẫu.']]),
    [],
    ['VÍ DỤ (chép sang sheet "Định mức" và thay bằng mã thật):'],
    IMPORT_HEAD,
    ['BTP-SUACHUA', 'Dịch sữa chua', 'Chuẩn', 6000, '210000101', 'Sữa bột gầy', 450, 'KG', 1, 'Có', ''],
    ['BTP-SUACHUA', 'Dịch sữa chua', 'Chuẩn', '', '210000102', 'Đường tinh luyện', 520, 'KG', 1, '', ''],
    ['BTP-SUACHUA', 'Dịch sữa chua', 'Mùa hè', 6000, '210000101', 'Sữa bột gầy', 430, 'KG', '', '', 'Giảm sữa bột'],
    ['BTP-SUACHUA', 'Dịch sữa chua', 'Chỉ mã', '', '210000101', 'Sữa bột gầy', '', 'KG', '', '', 'Kho không định mức'],
    ['BTP-SUACHUA', 'Dịch sữa chua', 'Chỉ mã', '', '210000102', 'Đường tinh luyện', '', 'KG', '', '', ''],
  ])
  guide['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 100 }]
  XLSX.utils.book_append_sheet(wb, guide, 'Hướng dẫn')

  const list = (rows: RecipeCatalogRow[], head: string) => {
    const s = XLSX.utils.aoa_to_sheet([[head, 'Tên', 'ĐVT', 'Tình trạng'],
      ...rows.map(m => [catalogCell(m.code), m.name ?? '', m.unit ?? '', m.active ? '' : 'Ngừng dùng'])])
    s['!cols'] = [{ wch: 16 }, { wch: 46 }, { wch: 8 }, { wch: 12 }]
    return s
  }
  XLSX.utils.book_append_sheet(wb, list(cat.btp, 'Mã BTP'), SHEET_BTP)
  XLSX.utils.book_append_sheet(wb, list(cat.nvl, 'Mã NVL'), SHEET_NVL)

  const last = TEMPLATE_VALIDATION_ROWS + 1
  const validations: ListValidation[] = []
  if (cat.btp.length) validations.push({ sheetIndex: 0, sqref: `A2:A${last}`, source: `'${SHEET_BTP}'!$A$2:$A$${cat.btp.length + 1}`,
    title: 'Mã BTP không có', error: `Chỉ nhập mã có trong sheet "${SHEET_BTP}" (mã đã đánh dấu Bán thành phẩm ở Mã hàng).`,
    prompt: `Chọn mã trong danh sách (sheet "${SHEET_BTP}").` })
  if (cat.nvl.length) validations.push({ sheetIndex: 0, sqref: `E2:E${last}`, source: `'${SHEET_NVL}'!$A$2:$A$${cat.nvl.length + 1}`,
    title: 'Mã NVL không có', error: `Mã này không có trong danh mục Mã hàng (sheet "${SHEET_NVL}"). Kiểm lại mã.`,
    prompt: `Gõ hoặc chọn mã có trong sheet "${SHEET_NVL}".` })
  return { wb, validations }
}
