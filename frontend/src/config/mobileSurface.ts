// BỀ MẶT ĐIỆN THOẠI — registry MỘT nguồn cho tính năng "superadmin cấu hình module/tab nào hiện trên
// điện thoại" (user chốt 21/09/2026: ẨN chứ không chặn route · toàn đơn vị · superadmin chọn cả 6 ô
// bottom-nav + thứ tự).
//
// Khoá cấu hình:
//   - TRANG = chính `to` của NavItem ("/wms/fill")
//   - TAB   = `${to}#${tabKey}` ("/wms/fill#report") — tabKey là value/state tab mà trang đang dùng,
//             để trang lọc bằng cùng một chuỗi, không phải ánh xạ lại.
// Cờ SystemSetting `mobile_surface` = { hidden: string[], bottom_nav: string[] | null } (BE chỉ kiểm
// hình dạng, khoá lạ ở đây bị bỏ qua). Lớp này là điều kiện AND thêm vào — quyền vẫn quyết trước.
import type { ElementType } from 'react'
import { NAV_GROUPS, navItemsOf, type NavItem } from './navigation'

export interface MobileTabDef { key: string; label: string }
export interface MobilePageDef {
  to: string
  label: string
  group: string
  icon: ElementType
  item: NavItem
  tabs: MobileTabDef[]
}

/** Tab TĨNH của từng trang — key = đúng giá trị tab mà trang dùng (store / useState / route con). */
export const PAGE_TABS: Record<string, MobileTabDef[]> = {
  '/': [
    { key: 'all', label: 'Tổng quan' }, { key: 'in', label: 'Nhập' }, { key: 'out', label: 'Xuất' },
    { key: 'stock', label: 'Tồn kho' }, { key: 'prod', label: 'Năng suất' }, { key: 'svc', label: 'Dịch vụ' }, { key: 'kpi', label: 'KPI' },
  ],
  '/wms/directed': [
    { key: 'INBOX', label: 'Hộp việc' }, { key: 'LOWER', label: 'Cần hạ' }, { key: 'MOVE', label: 'Cần đưa ra' }, { key: 'SCAN', label: 'Sắp quét' },
  ],
  '/wms/alerts': [{ key: 'personal', label: 'Cá nhân' }, { key: 'general', label: 'Thông báo chung' }, { key: 'thresholds', label: 'Cài đặt ngưỡng' }],
  '/wms/fill': [{ key: 'demand', label: 'Đề xuất' }, { key: 'tasks', label: 'Lệnh fill' }, { key: 'report', label: 'Kết quả' }],
  '/wms/packing': [{ key: 'board', label: 'Đóng gói' }, { key: 'log', label: 'Sổ pallet' }],
  '/wms/pallet-ops': [{ key: 'merge', label: 'Dồn (gom nhóm)' }, { key: 'split', label: 'Tách số lượng' }, { key: 'history', label: 'Lịch sử' }],
  '/wms/pallet-labels': [{ key: 'generate', label: 'Sinh tem mới' }, { key: 'history', label: 'Lịch sử in' }, { key: 'reprint', label: 'In lại từ tồn kho' }, { key: 'audit', label: 'Truy cứu' }],
  '/wms/move-location': [{ key: 'scan', label: 'Chuyển vị trí' }, { key: 'history', label: 'Lịch sử' }],
  // Kiểm kê: 4 tab là 4 ROUTE CON — key = đoạn cuối route, StocktakeTabs lọc NavLink theo key này
  '/wms/stocktake': [{ key: 'check', label: 'Check vị trí' }, { key: 'summary', label: 'Tổng hợp KK' }, { key: 'history', label: 'Lịch sử kiểm' }, { key: 'cycle', label: 'Luân phiên ABC' }],
  '/wms/slotting': [{ key: 'analysis', label: 'Phân tích ABC' }, { key: 'plans', label: 'Kế hoạch sắp xếp' }, { key: 'config', label: 'Cài đặt' }],
  '/wms/forklift': [
    { key: 'board', label: 'Check list ngày' }, { key: 'report', label: 'Báo cáo vận hành' }, { key: 'matrix', label: 'Ma trận check' },
    { key: 'summary', label: 'Tổng hợp xe' }, { key: 'detail', label: 'Chi tiết ngày' }, { key: 'settings', label: 'Cài đặt' },
  ],
  '/wms/trace': [{ key: 'trace', label: 'Truy xuất lô' }, { key: 'carton', label: 'Truy xuất theo thùng' }],
  '/wms/warehouse-costs': [{ key: 'voucher', label: 'Phiếu' }, { key: 'line', label: 'Dòng chi phí' }],
  '/external/do-sap': [{ key: 'dosap', label: 'DO SAP' }, { key: 'solines', label: 'Chưa có OD' }, { key: 'khvc', label: 'Kế hoạch xuất' }, { key: 'reconcile', label: 'Cần xử lý' }],
  '/tms/bookings': [{ key: 'main', label: 'Kế hoạch' }, { key: 'transfer', label: 'Chuyển kho' }],
  '/tms/settings': [{ key: 'vehicle-types', label: 'Loại xe' }, { key: 'vehicle-models', label: 'Mã dòng xe' }, { key: 'slot-templates', label: 'Khung giờ' }, { key: 'companies', label: 'ĐVVT / NCC' }, { key: 'vehicles', label: 'Xe' }],
  '/tms/freight': [{ key: 'tariffs', label: 'Bảng cước' }, { key: 'surcharges', label: 'Phụ phí' }, { key: 'allocation', label: 'Phân tuyến ĐVVT' }],
  '/tms/dispatch': [{ key: 'board', label: 'Bàn ghép xe' }, { key: 'list', label: 'Danh sách xe' }, { key: 'ods', label: 'Dữ liệu OD' }],
  '/hr/attendance': [{ key: 'me', label: 'Của tôi' }, { key: 'leave', label: 'Nghỉ phép' }, { key: 'team', label: 'Bảng công' }],
  '/hr/assignments': [{ key: 'daily', label: 'Phân công' }, { key: 'layout', label: 'Layout' }, { key: 'rules', label: 'Quy tắc ca' }],
  '/masterdata/customers': [{ key: 'list', label: 'Khách hàng' }, { key: 'channels', label: 'Kênh' }],
  '/wms/locations': [{ key: 'list', label: 'Danh mục vị trí' }, { key: 'map', label: 'Sơ đồ kho' }],
  '/masterdata/users': [{ key: 'employees', label: 'Nhân viên' }, { key: 'departments', label: 'Phòng ban' }, { key: 'job-titles', label: 'Chức danh' }, { key: 'audit', label: 'Nhật ký' }],
  '/wms/settings': [
    { key: 'warehouses', label: 'Kho' }, { key: 'types', label: 'Loại kho' }, { key: 'storage', label: 'ĐK bảo quản' }, { key: 'units', label: 'Đơn vị tính' }, { key: 'zones', label: 'Khu vực' },
    { key: 'shifts', label: 'Ca nhập' }, { key: 'qa', label: 'QA' }, { key: 'machines', label: 'Máy' }, { key: 'system', label: 'Hệ thống' },
  ],
}

/** Mọi trang trên menu (thứ tự = sidebar) kèm tab tĩnh — nguồn cho màn cấu hình lẫn bottom-nav. */
export const MOBILE_PAGES: MobilePageDef[] = NAV_GROUPS.flatMap(g =>
  g.items.flatMap(navItemsOf).map(item => ({
    to: item.to, label: item.label, group: g.label, icon: item.icon, item, tabs: PAGE_TABS[item.to] ?? [],
  })),
)
export const MOBILE_PAGE_BY_TO = new Map(MOBILE_PAGES.map(p => [p.to, p]))

export const tabKey = (to: string, key: string) => `${to}#${key}`

/** Nhãn NGẮN cho ô bottom-nav (ô 52 px, chữ 10 px) — thiếu thì dùng nhãn menu. */
export const BOTTOM_NAV_SHORT_LABEL: Record<string, string> = {
  '/wms/directed': 'Việc', '/wms/inbound': 'Nhập kho', '/wms/outbound': 'Xuất kho', '/wms/loosepicking': 'Nhặt lẻ',
  '/tms/bookings': 'Kế hoạch', '/tms/gate': 'Đăng ký', '/': 'Dashboard',
  '/wms/move-location': 'Chuyển VT', '/wms/stocktake': 'Kiểm kê', '/wms/fill': 'Fill', '/wms/packing': 'Sổ ĐG',
  '/wms/inventory': 'Tồn kho', '/wms/alerts': 'Thông báo', '/hr/attendance': 'Chấm công', '/wms/forklift': 'Xe nâng',
  '/wms/pallet-ops': 'Dồn/Tách', '/wms/pallet-labels': 'In tem', '/wms/weigh-tickets': 'Cân xe', '/wms/locations': 'Vị trí',
  '/wms/outbound/date-rules': 'Quy định date', '/wms/outbound/scan-log': 'LS quét', '/wms/control-tower': 'Giám sát',
}
/** Thứ tự mặc định thanh dưới (giữ nguyên bản 12/09) — dùng khi cờ `bottom_nav` = null. */
export const BOTTOM_NAV_DEFAULT: string[] = ['/wms/directed', '/wms/inbound', '/wms/outbound', '/wms/loosepicking', '/tms/bookings', '/tms/gate', '/']
export const BOTTOM_NAV_MAX = 6

export interface MobileSurface { hidden: string[]; bottom_nav: string[] | null }
export const MOBILE_SURFACE_DEFAULT: MobileSurface = { hidden: [], bottom_nav: null }

/** Đọc cờ từ SystemSetting — giá trị bậy/chưa có → mặc định (không chặn UI). */
export function parseMobileSurface(v: unknown): MobileSurface {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return MOBILE_SURFACE_DEFAULT
  const o = v as { hidden?: unknown; bottom_nav?: unknown }
  const hidden = Array.isArray(o.hidden) ? o.hidden.filter((s): s is string => typeof s === 'string') : []
  const bottom_nav = Array.isArray(o.bottom_nav)
    ? o.bottom_nav.filter((s): s is string => typeof s === 'string' && MOBILE_PAGE_BY_TO.has(s)).slice(0, BOTTOM_NAV_MAX)
    : null
  return { hidden, bottom_nav }
}
