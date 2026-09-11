// Cấu hình điều hướng DÙNG CHUNG cho Sidebar (PC) + MobileNav (drawer).
// Gom theo CHỨC NĂNG: vận hành (WMS/TMS/HR) lên đầu, rồi Báo cáo / Cấu hình / Quản trị.
// `operational: true` = nhóm vận hành — mobile ưu tiên hiển thị trước.
import type { ElementType } from 'react'
import {
  LayoutDashboard, Package, PackagePlus, PackageMinus, MapPin,
  Settings2, BarChart2, ClipboardList, UserCog, Scissors,
  ClipboardCheck, ShieldCheck, Tag, QrCode, CalendarRange, CalendarCheck, Network, KeyRound, Scale, Activity, Boxes, Database, Forklift,
  ArrowDownToLine, BellRing, NotebookPen, Move, Wallet, PackageSearch, Map as MapIcon, ListChecks, CalendarClock, Store,
} from 'lucide-react'
// Icon của MỤC MENU quét (Quét loạt, Lịch sử quét) — dùng chung symbol quét toàn app.
// `QrCode` phía trên GIỮ NGUYÊN vì mục "In tem pallet" nói về TEM QR, không phải hành động quét.
import { ScanIcon } from '@/components/shared/ScanIcon'
import { MODULES, can, canAccess, canAccessAny, type ModuleKey } from './permissions'

export interface NavItem {
  to: string
  icon: ElementType
  label: string
  module?: ModuleKey
  modules?: ModuleKey[]   // hiện nếu BẤT KỲ module nào trong list có view access
  anyActions?: [ModuleKey, string][]   // HOẶC nếu có BẤT KỲ (module, action) nào trong list (cross-module, vd outbound.reconcile)
  adminOnly?: boolean
}

// CẤP 2 (user chốt 10/09): nhóm lớn → NHÓM CHỨC NĂNG → trang. Menu Kho từng là một danh sách
// phẳng 14 mục nên "Nhặt lẻ" và "Fill hàng" nằm ngang hàng với "Xuất kho" trong khi cả ba là một
// việc. Chỉ gom ở nhóm nào ĐỦ ĐÔNG để phải gom — TMS/HR/Báo cáo giữ phẳng, thêm một lớp cho ba
// mục là bắt người dùng bấm thêm một nhát để không được gì.
export interface NavSection {
  label: string
  icon: ElementType
  items: NavItem[]
}
export type NavEntry = NavItem | NavSection
export const isSection = (e: NavEntry): e is NavSection => Array.isArray((e as NavSection).items)

export interface NavGroup {
  label: string
  items: NavEntry[]
  operational?: boolean   // nhóm vận hành (ưu tiên trên mobile)
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Tổng quan',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', module: 'dashboard' },
      // Việc cần làm đứng ở Tổng quan (user chốt 10/09): đây là màn MỞ ĐẦU CA của xe nâng và thủ
      // kho — bắt họ đi vào nhóm Kho rồi mới thấy việc của mình là đặt sai chỗ.
      { to: '/wms/directed',      icon: ListChecks, label: 'Việc cần làm', module: 'directed_work' },
      { to: '/wms/control-tower', icon: Activity, label: 'Giám sát vận hành', module: 'control_tower' },
      // Kê khai chi phí kho (Kho × Tháng × Khoản mục) — nuôi ô "chi phí/tấn" ở tab Năng suất
      { to: '/wms/warehouse-costs', icon: Wallet, label: 'Chi phí kho', module: 'warehouse_cost' },
      // Không gate module: tab Cá nhân (feed việc của mình) dành cho MỌI user; tab Chung tự ẩn khi thiếu alerts.view
      { to: '/wms/alerts',        icon: BellRing, label: 'Thông báo' },
    ],
  },
  {
    label: 'Kho (WMS)',
    operational: true,
    items: [
      {
        label: 'Xuất hàng', icon: PackageMinus,
        items: [
          { to: '/wms/outbound',           icon: PackageMinus,    label: 'Xuất kho',    module: 'outbound' },
          { to: '/wms/outbound/date-rules', icon: CalendarClock,  label: 'Quy định date', anyActions: [['outbound', 'set_date']] },
          // Nhặt lẻ = một phần của XUẤT (cùng dòng đơn, cùng cửa quét) — đặt cạnh nhau cho đúng việc
          { to: '/wms/loosepicking',       icon: Scissors,        label: 'Nhặt lẻ',     module: 'loosepicking' },
          { to: '/wms/fill',               icon: ArrowDownToLine, label: 'Fill hàng',   module: 'fill' },
        ],
      },
      {
        label: 'Nhập hàng', icon: PackagePlus,
        items: [
          { to: '/wms/inbound', icon: PackagePlus, label: 'Nhập kho',    module: 'inbound' },
          { to: '/wms/packing', icon: NotebookPen, label: 'Sổ đóng gói', module: 'packing' },
        ],
      },
      {
        label: 'Hàng trong kho', icon: Boxes,
        items: [
          { to: '/wms/pallet-ops',    icon: Scissors,       label: 'Dồn / Tách pallet', module: 'pallet_ops' },
          { to: '/wms/pallet-labels', icon: QrCode,         label: 'In tem pallet',     module: 'pallet_print' },
          // Quét tem pallet → chọn ô mới; quyền = inventory.move_location (không có module riêng)
          { to: '/wms/move-location', icon: Move,           label: 'Chuyển vị trí',     anyActions: [['inventory', 'move_location']] },
          { to: '/wms/stocktake',     icon: ClipboardCheck, label: 'Kiểm kê',           module: 'stocktake' },
        ],
      },
      {
        label: 'Bố trí kho', icon: MapIcon,
        items: [
          // Bản vẽ 2D của kho (08/09) — không dùng chữ "Layout": Phân công đã có tab Layout = mẫu phân công nhân sự
          { to: '/wms/warehouse-map', icon: MapIcon, label: 'Sơ đồ kho',     module: 'warehouse_map' },
          { to: '/wms/slotting',      icon: Boxes,   label: 'Tối ưu vị trí', module: 'slotting' },
        ],
      },
      { to: '/wms/forklift',   icon: Forklift, label: 'Xe nâng',          module: 'forklift' },
      { to: '/wms/multi-scan', icon: ScanIcon, label: 'Quét loạt (test)', adminOnly: true },
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
      { to: '/wms/outbound/scan-log', icon: ScanIcon,  label: 'Lịch sử quét', module: 'scanlog' },
      { to: '/wms/trace',             icon: PackageSearch, label: 'Truy xuất lô', module: 'traceability' },
      { to: '/tms/reports',           icon: BarChart2, label: 'Báo cáo nhập', module: 'tms_plan' },
      { to: '/external/do-sap',       icon: Database,  label: 'Dữ liệu bên ngoài', modules: ['external_do_sap', 'external_khvc'], anyActions: [['outbound', 'reconcile']] },
    ],
  },
  {
    label: 'Cấu hình',
    items: [
      { to: '/masterdata/materials', icon: Tag,       label: 'Mã hàng',       module: 'materials' },
      // Khách hàng / Nơi nhận (11/09) — khoá ship-to của SAP; %Date tự động và luật Chuyển kho
      // đều đọc danh mục này, nên nó là CẤU HÌNH chứ không phải một màn vận hành.
      { to: '/masterdata/customers', icon: Store,     label: 'Khách hàng',    module: 'customers' },
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

// ─── Duyệt cây điều hướng — MỘT nguồn cho Sidebar + MobileNav ───────────────────
// Trước 10/09 hai màn chép NGUYÊN bộ điều kiện ẩn/hiện; thêm cấp 2 mà vẫn để hai bản thì chỉ cần
// sửa một bên là menu PC và menu điện thoại nói hai chuyện khác nhau.
export const navItemsOf = (entry: NavEntry): NavItem[] => (isSection(entry) ? entry.items : [entry])
/** Mọi trang trên menu, đã phẳng — dùng để dò mục đang active. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items.flatMap(navItemsOf))

export type NavPerms = Parameters<typeof canAccess>[0]
/** Điều kiện hiển thị MỘT trang (quyền / adminOnly / anyActions). */
export function canSeeNavItem(item: NavItem, perms: NavPerms, admin: boolean): boolean {
  if (item.adminOnly) return admin
  if (item.anyActions?.some(([m, a]) => can(perms, m, a))) return true
  // Item CHỈ khai anyActions (vd Chuyển vị trí = inventory.move_location): không khớp quyền thì ẨN
  // — đừng rơi xuống nhánh "!module = hiện cho mọi người" bên dưới
  if (item.anyActions && !item.modules && !item.module) return admin
  if (item.modules) return admin || canAccessAny(perms, ...item.modules)
  if (!item.module) return true
  return admin || canAccess(perms, item.module)
}
/** Lọc cả cây: nhóm con rỗng thì bỏ hẳn (không để tiêu đề trống trên menu). */
export function visibleEntries(entries: NavEntry[], perms: NavPerms, admin: boolean): NavEntry[] {
  const out: NavEntry[] = []
  for (const e of entries) {
    if (!isSection(e)) { if (canSeeNavItem(e, perms, admin)) out.push(e); continue }
    const kids = e.items.filter(i => canSeeNavItem(i, perms, admin))
    if (kids.length) out.push({ ...e, items: kids })
  }
  return out
}

// ─── Trình phân quyền: gom module theo Trang → Tab, THỨ TỰ KHỚP SIDEBAR ──────────
// Page xuất hiện theo đúng thứ tự module lần đầu gặp khi duyệt NAV_GROUPS (sidebar).
// Module trong cùng page giữ thứ tự khai báo MODULES (tab con). Module không có trên
// sidebar (vd inbound_plan, work_skill) đi kèm page-mate của nó; nếu page nào hoàn toàn
// vắng mặt trên sidebar thì append cuối (an toàn).
export const PERMISSION_PAGES: { page: string; modules: ModuleKey[] }[] = (() => {
  const orderedPages: string[] = []
  const seen = new Set<string>()
  const pushPage = (p: string) => { if (!seen.has(p)) { seen.add(p); orderedPages.push(p) } }
  for (const it of ALL_NAV_ITEMS) {
    const mods = it.modules ?? (it.module ? [it.module] : [])
    for (const m of mods) pushPage(MODULES[m].page)
  }
  // an toàn: page có trong MODULES nhưng không xuất hiện trên sidebar
  for (const k of Object.keys(MODULES) as ModuleKey[]) pushPage(MODULES[k].page)
  return orderedPages.map(page => ({
    page,
    modules: (Object.keys(MODULES) as ModuleKey[]).filter(k => MODULES[k].page === page),
  }))
})()
