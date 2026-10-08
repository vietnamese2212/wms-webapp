// GOM CẢNH BÁO THEO LOẠI × KHO (08/10, đóng vai thủ kho: tài khoản vừa tạo thấy chuông 99+ và trang Thông báo 448 dòng "Chuyến trễ",
// mỗi chuyến một dòng — đọc không nổi, không ai biết việc nào trước). Chuông và trang Thông báo dùng CHUNG nhãn + cách gom.
import type { AlertRow } from '@/api/hooks'

export const ALERT_RULE_LABEL: Record<string, string> = {
  EXPIRY:     'Tồn cận date',
  GATE_DWELL: 'Xe trong cổng lâu',
  TRIP_LATE:  'Chuyến trễ / kẹt',
  WEIGH_DIFF: 'Lệch cân',
  BE_ERRORS:  'Lỗi hệ thống',
  PACKING_UNRECEIVED: 'Sổ đóng gói — kho chưa nhận',
  AUTH_LOCKOUT: 'Bảo mật — nhiều tài khoản bị khoá',
  ADMIN_NEW_IP: 'Bảo mật — admin đăng nhập IP mới',
}

export interface AlertGroup {
  key: string; rule: string; label: string
  warehouse_id: string | null; warehouse_name: string | null
  n: number; critical: boolean
  first: AlertRow   // nhóm một dòng thì mở thẳng dòng đó
}

/** Gom theo (loại, kho) — nghiêm trọng lên trước, rồi nhóm đông trước. Chỉ dòng ĐANG MỞ (chưa đóng, chưa "đã biết"). */
export function groupAlerts(rows: AlertRow[]): AlertGroup[] {
  const by = new Map<string, AlertGroup>()
  for (const a of rows) {
    if (a.resolved_at || a.ack_at) continue
    const key = `${a.rule}|${a.warehouse_id ?? ''}`
    const g = by.get(key)
    if (g) { g.n++; g.critical = g.critical || a.severity === 'CRITICAL'; continue }
    by.set(key, { key, rule: a.rule, label: ALERT_RULE_LABEL[a.rule] ?? a.title, warehouse_id: a.warehouse_id, warehouse_name: a.warehouse_name, n: 1, critical: a.severity === 'CRITICAL', first: a })
  }
  return [...by.values()].sort((a, b) => Number(b.critical) - Number(a.critical) || b.n - a.n || a.label.localeCompare(b.label, 'vi'))
}
