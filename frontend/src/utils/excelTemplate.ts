// FILE MẪU NẠP EXCEL — một cửa dựng cho mọi nút "Tải mẫu" (20/11, C125 LẶP).
// Luật: sheet DỮ LIỆU (sheet đầu — mọi bộ đọc chỉ đọc sheet đầu) CHỈ có dòng tên cột. Dòng VÍ DỤ nằm ở sheet "Hướng dẫn".
// Vì sao: 19/11 mẫu Mã hàng để ví dụ mã thật ngay dòng 3 (C125) — sửa riêng mẫu đó, còn 7 mẫu khác vẫn để ví dụ trên sheet
// dữ liệu: nạp nguyên file mẫu là sửa đè vị trí thật (Vị trí kho), thêm dòng cước 250.000đ (Cước), tạo chuyến (KH điều vận),
// ghi dòng SO/OD giả (ZSD02/VL06O), cộng 45 triệu chi phí (Chi phí kho) — đều qua kiểm, không báo lỗi gì (đo trên Preview 20/11).
// Mẫu mới gọi `downloadTemplate({...})`; cổng tĩnh `template_not_via_helper` gác mẫu tự dựng.
import * as XLSX from 'xlsx'
import { saveWorkbook, type SaveResult } from '@/utils/saveExcel'

type Cell = string | number
export type TemplateSpec = {
  /** tên file tải về, vd 'mau_vi_tri_kho.xlsx' */
  file: string
  /** tên sheet dữ liệu (sheet đầu) */
  sheet: string
  /** 1–2 dòng tên cột (nhãn, rồi dòng key nếu bộ đọc dùng) — chỉ những dòng này nằm trên sheet dữ liệu */
  header: Cell[][]
  /** dòng đầu sheet Hướng dẫn, vd 'NẠP VỊ TRÍ KHO TỪ EXCEL' */
  title: string
  /** các ý giải thích riêng của mẫu (không cần ghi lại luật chung: sheet đầu, giữ dòng tên cột, bảng kiểm trước khi ghi) */
  notes?: string[]
  /** dòng ví dụ — cùng cột với header[0]; chỉ nằm ở sheet Hướng dẫn */
  examples?: Cell[][]
  /** độ rộng cột của sheet dữ liệu (ký tự); bỏ trống = theo độ dài nhãn */
  colWidths?: number[]
}

export function buildTemplateWorkbook(spec: TemplateSpec): XLSX.WorkBook {
  const labels = spec.header[0] ?? []
  const ws = XLSX.utils.aoa_to_sheet(spec.header)
  ws['!cols'] = labels.map((l, i) => ({ wch: spec.colWidths?.[i] ?? Math.max(12, Math.min(30, String(l).length + 2)) }))
  const firstDataRow = spec.header.length + 1
  const guideRows: Cell[][] = [
    [`${spec.title} — app chỉ đọc sheet ĐẦU TIÊN ("${spec.sheet}"), theo TÊN cột ở dòng 1${spec.header.length > 1 ? ' / dòng 2 (giữ nguyên 2 dòng này)' : ' (giữ nguyên dòng này)'}`],
    [],
    ...(labels.some(l => String(l).includes('*')) ? [['• Cột có dấu * là bắt buộc.']] : []),
    ...(spec.notes ?? []).map(n => [`• ${n}`]),
    ['• Điền dữ liệu từ dòng ' + firstDataRow + ' của sheet "' + spec.sheet + '". Chọn file xong app hiện bảng kiểm các vấn đề của file — chưa ghi gì cho tới khi bạn bấm Xác nhận.'],
  ]
  if (spec.examples?.length) {
    guideRows.push([], [`VÍ DỤ (chỉ để tham khảo — chép sang sheet "${spec.sheet}" từ dòng ${firstDataRow} rồi thay bằng dữ liệu thật):`], labels, ...spec.examples)
  }
  const guide = XLSX.utils.aoa_to_sheet(guideRows)
  guide['!cols'] = labels.map(() => ({ wch: 16 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, spec.sheet)
  XLSX.utils.book_append_sheet(wb, guide, 'Hướng dẫn')
  return wb
}

export function downloadTemplate(spec: TemplateSpec): Promise<SaveResult> {
  return saveWorkbook(buildTemplateWorkbook(spec), spec.file)
}
