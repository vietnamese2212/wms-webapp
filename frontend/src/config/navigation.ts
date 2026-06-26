// Cấu hình điều hướng DÙNG CHUNG cho Sidebar (PC) + MobileNav (drawer).
// Gom theo CHỨC NĂNG: vận hành (WMS/TMS/HR) lên đầu, rồi Báo cáo / Cấu hình / Quản trị.
// `operational: true` = nhóm vận hành — mobile ưu tiên hiển thị trước.
import type { ElementType } from 'react'
import {
  LayoutDashboard, Package, PackagePlus, PackageMinus, MapPin,
  Settings2, BarChart2, ClipboardList, UserCog, Scissors, ScanLine,
  ClipboardCheck, ShieldCheck, Tag, QrCode, CalendarRange, CalendarCheck, Network,
} from 'lucide-react'
import type { ModuleKey } from './permissions'

export interface NavItem {
  to: string
  icon: ElementType
  label: string
  module?: ModuleKey
  modules?: ModuleKey[]   // hiện nếu BẤT KỲ module nào trong list có view access
  adminOnly?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
  operational?: boolean   // nhóm vận hành (ưu tiên trên mobile)
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Tổng quan',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Kho (WMS)',
    operational: true,
    items: [
      { to: '/wms/inbound',       icon: PackagePlus,    label: 'Nhập kho',          module: 'inbound' },
      { to: '/wms/outbound',      icon: PackageMinus,   label: 'Xuất kho',          module: 'outbound' },
      { to: '/wms/loosepicking',  icon: Scissors,       label: 'Nhặt lẻ',           module: 'loosepicking' },
      { to: '/wms/pallet-ops',    icon: Scissors,       label: 'Dồn / Tách pallet', module: 'pallet_ops' },
      { to: '/wms/pallet-labels', icon: QrCode,         label: 'In tem pallet',     module: 'pallet_print' },
      { to: '/wms/stocktake',     icon: ClipboardCheck, label: 'Check vị trí',      module: 'stocktake' },
    ],
  },
  {
    label: 'Điều vận (TMS)',
    operational: true,
    items: [
      { to: '/tms/bookings', icon: ClipboardList, label: 'Kế hoạch VC',  module: 'tms_plan' },
      { to: '/tms/gate',     icon: ShieldCheck,   label: 'Đăng ký cổng', module: 'gate_registration' },
    ],
  },
  {
    label: 'Nhân sự (HR)',
    operational: true,
    items: [
      { to: '/hr/assignments', icon: CalendarRange, label: 'Phân công', module: 'work_assignment' },
      { to: '/hr/attendance',  icon: CalendarCheck, label: 'Chấm công', module: 'attendance' },
    ],
  },
  {
    label: 'Báo cáo',
    items: [
      { to: '/wms/inventory',         icon: Package,   label: 'Tồn kho',      module: 'inventory' },
      { to: '/wms/outbound/scan-log', icon: ScanLine,  label: 'Lịch sử quét', module: 'scanlog' },
      { to: '/wms/stocktake/summary', icon: BarChart2, label: 'Tổng hợp KK',  module: 'stocktake' },
      { to: '/tms/reports',           icon: BarChart2, label: 'Báo cáo nhập', module: 'tms_plan' },
    ],
  },
  {
    label: 'Cấu hình',
    items: [
      { to: '/masterdata/materials', icon: Tag,       label: 'Mã hàng',       module: 'materials' },
      { to: '/wms/locations',        icon: MapPin,    label: 'Vị trí kho',    module: 'locations' },
      { to: '/hr/org',               icon: Network,   label: 'Sơ đồ tổ chức', module: 'employees' },
      { to: '/wms/settings',         icon: Settings2, label: 'Cài đặt WMS',   module: 'wms_settings' },
      { to: '/tms/settings',         icon: Settings2, label: 'Cài đặt TMS',   modules: ['tms_vehicle_types', 'tms_slots', 'tms_companies', 'tms_vehicles'] },
    ],
  },
  {
    label: 'Quản trị',
    items: [
      { to: '/masterdata/users', icon: UserCog, label: 'Quản lý người dùng', module: 'user_admin' },
    ],
  },
]
