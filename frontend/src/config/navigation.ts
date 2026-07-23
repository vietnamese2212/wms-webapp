// Cấu hình điều hướng DÙNG CHUNG cho Sidebar (PC) + MobileNav (drawer).
// Gom theo CHỨC NĂNG: vận hành (WMS/TMS/HR) lên đầu, rồi Báo cáo / Cấu hình / Quản trị.
// `operational: true` = nhóm vận hành — mobile ưu tiên hiển thị trước.
import type { ElementType } from 'react'
import {
  LayoutDashboard, Package, PackagePlus, PackageMinus, MapPin,
  Settings2, BarChart2, ClipboardList, UserCog, Scissors, ScanLine,
  ClipboardCheck, ShieldCheck, Tag, QrCode, CalendarRange, CalendarCheck, Network, KeyRound, Scale, Activity, Boxes, Database,
} from 'lucide-react'
import { MODULES, type ModuleKey } from './permissions'

export interface NavItem {
  to: string
  icon: ElementType
  label: string
  module?: ModuleKey
  modules?: ModuleKey[]   // hiện nếu BẤT KỲ module nào trong list có view access
  anyActions?: [ModuleKey, string][]   // HOẶC nếu có BẤT KỲ (module, action) nào trong list (cross-module, vd outbound.reconcile)
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
      { to: '/wms/control-tower', icon: Activity, label: 'Giám sát vận hành', module: 'control_tower' },
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
      { to: '/wms/stocktake',     icon: ClipboardCheck, label: 'Kiểm kê',           module: 'stocktake' },
      { to: '/wms/slotting',      icon: Boxes,          label: 'Tối ưu vị trí',     module: 'slotting' },
      { to: '/wms/multi-scan',    icon: ScanLine,       label: 'Quét loạt (test)',  adminOnly: true },
    ],
  },
  {
    label: 'Điều vận (TMS)',
    operational: true,
    items: [
      { to: '/tms/bookings',      icon: ClipboardList, label: 'Kế hoạch VC',  module: 'tms_plan' },
      { to: '/tms/gate',          icon: ShieldCheck,   label: 'Đăng ký cổng', module: 'gate_registration' },
      { to: '/wms/weigh-tickets', icon: Scale,         label: 'Phiếu cân',    module: 'weigh_station' },
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
      { to: '/tms/reports',           icon: BarChart2, label: 'Báo cáo nhập', module: 'tms_plan' },
      { to: '/external/do-sap',       icon: Database,  label: 'Dữ liệu bên ngoài', modules: ['external_do_sap', 'external_khvc'], anyActions: [['outbound', 'reconcile']] },
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
      { to: '/masterdata/users',            icon: UserCog,  label: 'Quản lý người dùng', module: 'user_admin' },
      { to: '/masterdata/integration-keys', icon: KeyRound, label: 'Kết nối ERP',        adminOnly: true },
    ],
  },
]

// ─── Trình phân quyền: gom module theo Trang → Tab, THỨ TỰ KHỚP SIDEBAR ──────────
// Page xuất hiện theo đúng thứ tự module lần đầu gặp khi duyệt NAV_GROUPS (sidebar).
// Module trong cùng page giữ thứ tự khai báo MODULES (tab con). Module không có trên
// sidebar (vd inbound_plan, work_skill) đi kèm page-mate của nó; nếu page nào hoàn toàn
// vắng mặt trên sidebar thì append cuối (an toàn).
export const PERMISSION_PAGES: { page: string; modules: ModuleKey[] }[] = (() => {
  const orderedPages: string[] = []
  const seen = new Set<string>()
  const pushPage = (p: string) => { if (!seen.has(p)) { seen.add(p); orderedPages.push(p) } }
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      const mods = it.modules ?? (it.module ? [it.module] : [])
      for (const m of mods) pushPage(MODULES[m].page)
    }
  }
  // an toàn: page có trong MODULES nhưng không xuất hiện trên sidebar
  for (const k of Object.keys(MODULES) as ModuleKey[]) pushPage(MODULES[k].page)
  return orderedPages.map(page => ({
    page,
    modules: (Object.keys(MODULES) as ModuleKey[]).filter(k => MODULES[k].page === page),
  }))
})()
