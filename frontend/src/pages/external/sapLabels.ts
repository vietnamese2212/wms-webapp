// Nhãn tiếng Việt MỘT chỗ cho dữ liệu SAP raw (tab DO SAP · Chưa có OD · panel chi tiết dòng).
// Tách khỏi ExternalData.tsx (24/09) vì SapLineDetailSheet cũng cần — hai màn không được nói hai nhãn.
import type { BadgeTone } from '@/components/shared/StatusBadge'

// Phân loại dòng SAP (flow) — tone theo nghĩa (trả về/chiết khấu không lên xe = đỏ/xám)
export const FLOW_VI: Record<string, { label: string; tone: BadgeTone }> = {
  SALE:     { label: 'Bán hàng',       tone: 'green' },
  STO:      { label: 'Chuyển kho',     tone: 'sky' },
  INTERNAL: { label: 'Nội bộ',         tone: 'purple' },
  PALLET:   { label: 'Pallet đi cùng', tone: 'slate' },
  RETURN:   { label: 'Trả về',         tone: 'red' },
  DISCOUNT: { label: 'Chiết khấu',     tone: 'slate' },
  UNKNOWN:  { label: 'Chưa phân loại', tone: 'amber' },
}
export const DISPATCH_VI: Record<string, { label: string; tone: BadgeTone }> = {
  ASSIGNED:   { label: 'Đã gắn xe',   tone: 'green' },
  UNASSIGNED: { label: 'Chưa gắn xe', tone: 'amber' },
}
// Mã nguồn 'EXCEL' là VL06O từ thời chỉ có một file — in tên báo cáo để đứng cạnh ZSD02 không gây hiểu nhầm
export const SOURCE_VI: Record<string, string> = { EXCEL: 'VL06O', ZSD02: 'ZSD02', MANUAL: 'Tay', SAP: 'SAP API' }
export const SO_STATUS_VI: Record<string, { label: string; tone: BadgeTone }> = {
  OPEN:      { label: 'Chưa có OD', tone: 'amber' },
  HAS_OD:    { label: 'Đã có OD',   tone: 'green' },
  CANCELLED: { label: 'SAP huỷ',    tone: 'red' },
}
