// TRANG MỞ ĐẦU theo chức danh (JobTitle.landing_page, 12/09/2026).
// Vì sao: lái xe nâng đăng nhập là rơi vào Dashboard KPI toàn công ty rồi phải đi menu → Việc cần làm
// → chọn Kho mới thấy việc của mình (đo: 4 bước cho một màn không liên quan tới họ).
// MỘT nguồn cho cả form Chức danh (ô chọn) lẫn DashboardRoute (chuyển hướng): chỉ chuyển hướng khi
// user có quyền vào module của trang đích — không thì PermissionRoute đá về "/" và thành vòng lặp.
import type { ModuleKey } from '@/config/permissions'

export const LANDING_PAGES: { to: string; label: string; module: ModuleKey }[] = [
  { to: '/wms/directed', label: 'Việc cần làm', module: 'directed_work' },
]

export const LANDING_DEFAULT_LABEL = 'Tổng quan (mặc định)'
