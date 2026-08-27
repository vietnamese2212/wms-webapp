// Auth
export type AppModule   = 'inbound' | 'outbound' | 'inventory' | 'reports' | 'admin'
export type Category    = 'TP' | 'NVL' | 'POSM' | 'BAO_BI'
export type ModulePermissions = Partial<Record<string, string[]>>

export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  department?: string
  warehouse_id?: string
  warehouse_name?: string
  job_title_id?: string | null
  job_title_name?: string | null
  is_driver?: boolean          // chức danh TÀI XẾ (cờ JobTitle.is_driver — KHÔNG so tên)
  is_carrier_dept?: boolean    // phòng ban là ĐƠN VỊ VẬN TẢI (cờ Department.is_carrier)
  ncc_id?: string | null
  employee_code?: string | null
  // Permission system fields
  allowed_categories?: string[]
  warehouse_scope?:    'NATIONAL' | 'ASSIGNED'
  warehouse_ids?:      string[]
  allowed_modules?:    AppModule[]
  module_permissions?: ModulePermissions
  is_superadmin?:      boolean   // từ cột Employee.is_superadmin qua /auth/login + /auth/me — isAdmin() đọc cờ này
}

// ─── Permission masterdata ────────────────────────────────────────────────────

export interface Department {
  id:              string
  name:            string
  code:            string
  allowed_modules: AppModule[]
  is_carrier?:     boolean       // phòng ban là ĐƠN VỊ VẬN TẢI (nhà xe) — cờ thay việc so tên
  is_active:       boolean
  created_at?:     string
  updated_at?:     string
  created_by?:     string | null
  updated_by?:     string | null
}

export interface JobTitle {
  id:                 string
  name:               string
  department_id:      string
  parent_id:          string | null
  in_chart?:          boolean
  is_driver?:         boolean      // chức danh TÀI XẾ — cờ thay việc so tên 'Lái xe'
  is_active:          boolean
  department?:        Pick<Department, 'id' | 'name' | 'code'>
  module_permissions?: ModulePermissions
  created_at?:        string
  updated_at?:        string
  created_by?:        string | null
  updated_by?:        string | null
}

export interface EmployeeRecord {
  id:                 string
  name:               string
  employee_code:      string
  email:              string | null
  phone:              string | null
  department_id:      string | null
  job_title_id:       string | null
  allowed_categories: string[]
  warehouse_scope:    'NATIONAL' | 'ASSIGNED'
  warehouse_id:       string | null
  is_active:          boolean
  ncc_id:             string | null
  is_driver:          boolean
  manager_id:         string | null
  created_at:         string
  updated_at?:        string
  created_by?:        string | null
  updated_by?:        string | null
  deleted_at?:        string | null
  dept?:              Pick<Department, 'id' | 'name' | 'code'> | null
  job_title?:         Pick<JobTitle, 'id' | 'name'> | null
  warehouse_access?:  { warehouse_id: string; warehouse: { id: string; code: string; name: string } }[]
  manager?:           { id: string; name: string; employee_code: string } | null
}

// WMS
export interface Product {
  id: string
  sku: string
  name: string
  unit: string
  category: string
  minStock: number
  qrCode: string
}

export interface Location {
  id: string
  zone: string
  row: string
  shelf: string
  bin: string
  qrCode: string
  capacity: number
  currentPallets: number
}

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'

export interface InventoryItem {
  id: string
  product: Product
  location: Location
  quantity: number
  pallets: number
  batchNumber?: string
  expiryDate?: string
  updatedAt: string
  status: StockStatus
}

export type TransactionType = 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'ADJUSTMENT' | 'CYCLE_COUNT'
export type TransactionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface Transaction {
  id: string
  type: TransactionType
  product: Product
  location: Location
  quantity: number
  pallets: number
  userId: string
  userName: string
  note?: string
  status: TransactionStatus
  createdAt: string
  completedAt?: string
  referenceNo: string
}

// TMS
export type VehicleStatus = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'EXPIRED'
export type VehicleType = 'TRUCK' | 'VAN' | 'MOTORCYCLE' | 'CONTAINER'

export interface Driver {
  id: string
  name: string
  licenseNumber: string
  phone: string
  status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE'
}

export interface Vehicle {
  id: string
  plateNumber: string
  type: VehicleType
  capacity: number
  driver?: Driver
  status: VehicleStatus
  nextInspectionDate: string
  brand: string
  model: string
  year: number
}


// HR
export type EmployeeStatus = 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE'
export type ShiftType = 'MORNING' | 'AFTERNOON' | 'NIGHT' | 'FULL_DAY'

export interface Employee {
  id: string
  name: string
  employeeCode: string
  department: string
  phone: string
  email: string
  qrCode: string
  status: EmployeeStatus
  avatar?: string
  joinDate: string
}

export interface Shift {
  id: string
  name: string
  type: ShiftType
  startTime: string
  endTime: string
  daysOfWeek: number[]
  color: string
}

// Masterdata – Ca nhập & Tình trạng QA
export interface ImportShift {
  id:            string
  code:          string
  name:          string
  display_order: number
  is_active:     boolean
}

export interface QAStatus {
  id:            string
  code:          string
  name:          string
  display_order: number
  is_active:     boolean
}

export interface WarehousePalletOverride {
  warehouse_id:       string
  cartons_per_pallet: number
}

export interface Material {
  id:                         string
  material_code:              string
  material_description:       string
  short_name:                 string | null
  custom_short_name:          string | null
  category:                   string | null
  product_type:               string | null
  unit:                       string | null
  weight_kg:                  number | null
  cartons_per_pallet:         number | null
  cartons_per_pallet_mn:      number | null
  units_per_carton:           number | null
  pallet_per_ea:              number | null
  shelf_life_days:            number | null
  storage_category:           string | null
  old_code:                   string | null
  batch_prefix:               string | null   // ĐV2 tem `;`: 2 ký tự tắt hàng để sinh mã lô (khớp kế toán); null với ĐV1
  carton_length_mm?:          number | null   // kích thước thùng carton (cm) — phục vụ sơ đồ xếp xe 3D
  carton_width_mm?:           number | null
  carton_height_mm?:          number | null
  max_stack_layers?:          number | null   // số lớp xếp tối đa 1 chân hàng (null = theo chiều cao xe)
  stack_on_top?:              boolean         // hàng nhẹ — được xếp TRÊN mã hàng khác (ưu tiên lên nóc)
  base_unit?:                 string | null   // ĐV GỐC (lưu trữ/tính toán sau semantic flip): HOP/BT/KG/EA… — tùy biến
  entry_unit?:                string | null   // ĐV NHẬP LIỆU (chỉ hiển thị): CAR…; hệ số 1 Entry = N Base = units_per_carton
  warehouse_pallet_overrides:     WarehousePalletOverride[] | null
  supplier_shelf_life_overrides?: SupplierShelfLifeOverride[] | null
  manufacturer_id:                string | null
  manufacturer?:              { id: string; code: string; name: string | null } | null
  notes:                      string | null
  no_qr_tracking:             boolean
  is_non_stock?:              boolean
  is_pallet_carrier?:         boolean   // mã là PALLET mang hàng (Loscam) — loại khỏi đếm Pallet chuyến xuất (tránh double)
  pallet_color?:              string | null   // màu vẽ pallet trên sơ đồ xếp xe 3D (#rrggbb) — chỉ nghĩa khi là pallet; null = mặc định
  is_active:                  boolean
  created_at?:                string
  updated_at?:                string | null
  created_by?:                string | null
  updated_by?:                string | null
}

// WMS – Inbound
export type InboundOrderStatus = 'OPEN' | 'COMPLETED'

export interface InboundOrder {
  id:              string
  import_code:     string | null
  warehouse_id:    string | null
  warehouse:       { id: string; code: string; name: string } | null
  location_id:     string | null
  location:        { id: string; location_code: string; sub_code: string; max_pallets: number } | null
  material_id:     string | null
  material:        { id: string; material_code: string; short_name: string | null; material_description: string; cartons_per_pallet: number | null; cartons_per_pallet_mn: number | null; warehouse_pallet_overrides?: WarehousePalletOverride[] | null; supplier_shelf_life_overrides?: SupplierShelfLifeOverride[] | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null } | null
  planned_pallets: number | null
  shift_id:        string | null
  shift:           { id: string; code: string; name: string } | null
  status:          InboundOrderStatus
  import_date:     string | null
  notes:           string | null
  created_by_emp:  { id: string; name: string } | null
  updated_by_emp:  { id: string; name: string } | null
  imported_by_emp: { id: string; name: string } | null
  _count:              { inventory_entries: number }
  total_cartons?:      number
  cycles?:             string[]
  machine_codes?:      string[]
  location_used_slots?: number
  entries_by_location?: { loc: string; pallets: number; cartons: number }[]
  source_type?:         'FACTORY' | 'NCC' | 'TRANSFER'
  ncc_id?:              string | null
  ncc?:                 { id: string; name: string } | null
  warehouse_type?:      string | null
  gate_registration_id?: string | null
  gate_registration?:   { id: string; registration_number: number; date: string; license_plate: string | null; company_name_raw: string | null; driver_name: string | null; status: string; direction: string } | null
  planned_cartons?:     number | null
  posm_entry_id?:       string | null
  transfer_production_date?: string | null
  created_at:      string
  updated_at:      string
  inventory_entries?: PalletEntry[]
}

export interface PalletEntry {
  id:              string
  pallet_code:     string
  location:        { id: string; location_code: string; sub_code: string }
  material:        { id: string; material_code: string; short_name: string | null }
  manufacturer:    { id: string; code: string; name: string | null } | null
  cycle:              string | null
  machine_code:       string | null
  pallet_sequence_no: number | null
  qa_status_id:       string | null
  qa_status:          { id: string; code: string; name: string } | null
  stack_layer:        number
  cartons_imported:   number
  production_date:    string | null
  status:             string
  created_by_emp:     { id: string; name: string } | null
  updated_by_emp:     { id: string; name: string } | null
  import_date:        string | null
  update_date:        string | null
  created_at:         string
  updated_at:         string
}


// KPI
export interface KPIMetric {
  label: string
  value: string | number
  unit?: string
  change?: number
  changeLabel?: string
  trend?: 'up' | 'down' | 'neutral'
  target?: number
  current?: number
}

// API
export interface ApiResponse<T> {
  success: boolean
  data: T
  meta?: {
    page: number
    total: number
    perPage: number
  }
}

export interface ApiError {
  success: false
  error: {
    code: string
    message: string
  }
}

// WMS – Inventory
export type InventoryStatus = 'IN_STOCK' | 'PARTIAL' | 'EXPORTED' | 'TRANSFERRED' | 'QUARANTINE' | 'CANCELLED' | 'LOOSE_PICKING'

export interface InventoryEntry {
  id:                 string
  pallet_code:        string
  location_id:        string
  warehouse_id:       string | null
  material_id:        string | null
  manufacturer_id:    string | null
  nmsx:               string | null
  cycle:              string | null
  machine_code:       string | null
  pallet_sequence_no: number | null
  qa_status_id:       string | null
  stack_layer:        number
  cartons_imported:   number
  cartons_remaining:  number | null
  cartons_reserved:   number | null
  production_date:    string | null
  parent_pallet_code: string | null
  origin:             string | null
  status:             InventoryStatus | string
  import_date:        string | null
  update_date:        string | null
  adjustment_qty:     number | null
  ncc_id:              string | null
  shelf_life_days:     number | null
  batch:               string | null   // tem V2 (`;` ĐV2): mã lô nguyên văn (khớp hệ thống kế toán qua import/API)
  expiry_date:         string | null   // tem V2: HSD tường minh → %Date dùng HSD thật
  stocktake_at:        string | null
  stocktake_flagged:   boolean | null
  stocktake_flag_note: string | null
  created_at:          string
  updated_at:          string
  // ⚠️ FK → Employee.id (KHÔNG phải tên). Hiển thị phải dùng created_by_emp/updated_by_emp,
  // in thẳng 2 cột này ra màn là ra uuid thô.
  created_by:          string | null
  updated_by:          string | null
  location:              { id: string; location_code: string; sub_code: string; sub_name: string | null; sub_type: string | null; warehouse?: { id: string; name: string; code: string } | null } | null
  material:              { id: string; material_code: string; short_name: string | null; shelf_life_days: number | null; supplier_shelf_life_overrides?: SupplierShelfLifeOverride[] | null; category: string | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null } | null
  manufacturer:          { id: string; code: string; name: string | null } | null
  ncc:                   { id: string; name: string } | null
  qa_status:             { id: string; code: string; name: string } | null
  created_by_emp:        { id: string; name: string } | null
  updated_by_emp:        { id: string; name: string } | null
  stocktake_by_emp:      { id: string; name: string } | null
}

// TMS – Delivery Slot & Booking
export interface DeliverySlot {
  id:              string
  template_id:     string | null
  warehouse_id:    string
  vehicle_type_id: string
  vehicle_type?:   { id: string; code: string; name: string } | null
  cargo_type:      string
  date:            string
  time_from:       string
  time_to:         string
  max_vehicles:    number
  booked_count:    number
  status:          'OPEN' | 'FULL' | 'CLOSED'
}

export type VehicleSlotStatus = 'PENDING' | 'BOOKED' | 'ARRIVED' | 'DONE' | 'CANCELLED'

export interface TmsVehicleSlot {
  id:            string
  order_id:      string
  slot_id:       string | null
  slot?:         Pick<DeliverySlot, 'id' | 'date' | 'time_from' | 'time_to' | 'cargo_type' | 'max_vehicles' | 'booked_count'> | null
  license_plate: string | null
  driver_name:   string | null
  driver_phone:  string | null
  status:        VehicleSlotStatus
  booked_by:     string | null
  consolidation_group_id:    string | null
  is_consolidation_primary:  boolean
  gate_export_status:        string | null
  gate_registered_at:        string | null
  gate_entry_at:             string | null
  gate_exit_at:              string | null
  created_at:    string
  updated_at:    string
  /** STT xe trong TOÀN phạm vi ngày+kho (server tính — không đổi khi lọc/lật trang) */
  stt?:          number | null
}

export interface TmsOrder {
  id:              string
  order_code:      string
  date:            string
  warehouse_id:    string
  warehouse?:      { id: string; code: string; name: string } | null
  ncc_id:          string | null
  ncc?:            Pick<TransportCompany, 'id' | 'code' | 'name'> | null
  npp_name:        string | null
  vehicle_type:    string | null
  direction:       'OUTBOUND' | 'INBOUND' | null
  warehouse_type:  string | null    // các loại hàng xe CHỞ (có thể ghép 'FG01+PM01') → quyền + lọc, giao ≥1
  booking_category?: string | null  // CỬA đặt lịch (giá trị ĐƠN, khai ở Kế hoạch xuất) → CHỈ dùng khớp khung giờ
  planned_boxes:   number | null
  planned_pallets: number | null
  planned_tons:    number | null
  gdo_refs:        string | null
  notes:           string | null
  priority:        boolean
  export_status:   string | null
  status:          string
  source_type?:    string | null
  // Kế hoạch VC tự sinh theo Kế hoạch xuất (03/08) — bị động: sửa ở nguồn, không sửa tay
  origin?:         string | null    // 'KHVC' = tự sinh theo Số xe của Kế hoạch xuất
  plan_dropped?:   boolean | null   // kế hoạch đã bỏ Số xe này → lệnh ngừng hiệu lực, khung giờ ĐÃ nhả
  plan_dropped_at?: string | null
  destination_warehouse_id?: string | null
  eta?:            string | null
  created_by:      string | null
  updated_by:      string | null
  created_at:      string
  updated_at:      string
  completed_at?:   string | null
  vehicle_slots:   TmsVehicleSlot[]
  /** STT dòng ảo của đơn CHƯA có xe nào (server tính cùng `TmsVehicleSlot.stt`) */
  stt_no_slot?:    number | null
}

// TMS – Foundation
export interface TmsVehicleType {
  id:         string
  code:       string
  name:       string
  is_active:  boolean
  box_length_mm?: number | null   // lòng thùng xe (mm) — cỡ TIÊU BIỂU của loại; cỡ THẬT khai ở từng biển số
  box_width_mm?:  number | null
  box_height_mm?: number | null
  // Xe chở hàng ĐÃ LÊN PALLET (26/08) — quyết định CÁCH VẼ sơ đồ xếp xe: bật = gom hàng lên pallet
  // rồi xếp pallet (sức chứa tính bằng chỗ pallet); tắt = xếp từng thùng như cũ.
  is_pallet_truck?: boolean | null
  created_at?: string
  updated_at?: string
  created_by?: string | null
  updated_by?: string | null
}

export interface SlotTemplate {
  id:              string
  warehouse_id:    string
  vehicle_type_id: string
  vehicle_type?:   Pick<TmsVehicleType, 'id' | 'code' | 'name'>
  direction:       string | null
  cargo_type:      string
  day_of_week:     number   // 1=T2 … 6=T7
  time_from:       string
  time_to:         string
  max_vehicles:    number
  is_active:       boolean
  created_at?:     string
  updated_at?:     string
  created_by?:     string | null
  updated_by?:     string | null
}

export interface TransportCompany {
  id:            string
  code:          string
  name:          string
  type:          'ĐVVT' | 'NCC'
  alias_codes?:  string[] | null
  contact_name:  string | null
  contact_phone: string | null
  is_active:     boolean
  created_at?:   string
  updated_at?:   string
  created_by?:   string | null
  updated_by?:   string | null
}

export interface SupplierShelfLifeOverride {
  transport_company_id: string
  shelf_life_days:      number
}

export interface TmsVehicle {
  id:              string
  ncc_id:          string
  ncc?:            Pick<TransportCompany, 'id' | 'code' | 'name'>
  license_plate:   string
  vehicle_type_id: string
  vehicle_type?:   Pick<TmsVehicleType, 'id' | 'code' | 'name'> & { is_pallet_truck?: boolean | null }
  // Kích thước lòng thùng THẬT của CHIẾC xe này (26/08) — sơ đồ xếp xe tự điền khi chọn biển số.
  // Khai ở đây (không phải ở Loại xe) vì hai xe cùng loại vẫn có lòng thùng khác nhau.
  box_length_mm?:  number | null
  box_width_mm?:   number | null
  box_height_mm?:  number | null
  is_active:       boolean
  created_at?:     string
  updated_at?:     string
  created_by?:     string | null
  updated_by?:     string | null
}

// TMS — Gate Registration
export type GateStatus = 'REGISTERED' | 'CALLED' | 'IN' | 'COMPLETED'

export interface GateRegistration {
  id:                  string
  date:                string
  registration_number: number

  driver_name:         string | null
  phone:               string | null

  company_id:          string | null
  company_name_raw:    string | null

  vehicle_id:          string | null
  license_plate:       string | null

  direction:           'OUTBOUND' | 'INBOUND' | null
  warehouse_id:        string
  warehouse_type:      string | null
  vehicle_type:        string | null

  visit_group_id:      string | null  // gắn 2 chân của xe "kết hợp" (Nhập+Xuất cùng lượt)

  content:             string | null
  return_pallet:       boolean
  seal_number:         string | null
  notes:               string | null

  status:              GateStatus
  priority:            boolean

  registered_at:       string | null
  registered_by:       string | null
  called_at:           string | null
  called_by:           string | null
  entry_at:            string | null
  entry_by:            string | null
  exit_at:             string | null
  exit_by:             string | null

  load_capacity:       number | null

  tms_order_id:            string | null
  tms_vehicle_slot_id:     string | null
  tms_order_ids:           string | null  // comma-sep UUIDs, multi-order
  booking_order_code:      string | null  // comma-sep order codes
  booking_slot_from:       string | null
  booking_slot_to:         string | null
  booking_npp_names:       string | null  // comma-sep
  booking_gdo_refs:        string | null  // comma-sep
  booking_planned_boxes:   string | null  // comma-sep
  booking_planned_pallets: string | null  // comma-sep

  created_by:          string | null
  updated_by:          string | null
  created_at:          string
  updated_at:          string
}

export interface BookingSuggestion {
  tms_order_id:        string
  tms_vehicle_slot_id: string | null   // null = link theo kế hoạch (NCC chưa booking)
  order_code:          string   // comma-sep khi nhiều đơn/slot
  from_plan?:          boolean  // true = gợi ý từ KH nhập PENDING, không phải booking
  booking_slot_from:   string | null
  booking_slot_to:     string | null
  planned_boxes:       string | null   // comma-sep
  planned_pallets:     string | null   // comma-sep
  gdo_refs:            string | null   // comma-sep
  npp_names:           string | null   // comma-sep
  priority:            boolean
}

// WMS – Outbound
export type OutboundStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'PAUSED'

export interface OutboundScanEntry {
  id:                   string
  item_id:              string
  inventory_entry_id:   string | null
  pallet_code:          string
  cartons_scanned:      number
  is_loose_picking:     boolean
  loose_confirmed:      boolean
  loose_confirmed_at:   string | null
  scanned_by:           string | null
  scanned_by_emp?:      { id: string; name: string } | null
  scanned_at:           string
  pct_date:             number | null
  production_date:      string | null
  // LEGACY (dòng trước 14/08): MIN(NSX) trong kho lúc quét, chỉ đếm IN_STOCK/PARTIAL. KHÔNG ghi nữa.
  best_available_date:  string | null
  // Vết luân chuyển từ 14/08 — null ở dòng cũ hoặc khi thiếu NSX/HSD để kết luận
  rotation_principle?:       string | null
  rotation_violation?:       boolean | null
  rotation_best_date?:       string | null
  rotation_override_reason?: string | null
  carton_scans?:        { code: string; match: boolean; at?: string }[] | null  // mã THÙNG đính kèm (multiscan, truy vết)
}

export interface OutboundItem {
  id:                 string
  do_id:              string
  material_id:        string | null
  material_code_raw:  string | null
  material:           { id: string; material_code: string; short_name: string | null; custom_short_name: string | null; category?: string | null; cartons_per_pallet: number | null; warehouse_pallet_overrides?: WarehousePalletOverride[] | null; weight_kg: number | null; unit?: string | null; no_qr_tracking?: boolean; carton_length_mm?: number | null; carton_width_mm?: number | null; carton_height_mm?: number | null; max_stack_layers?: number | null; stack_on_top?: boolean; is_pallet_carrier?: boolean | null; pallet_color?: string | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null } | null
  cartons_ordered:    number
  od_refs?:           { od_number: string; od_item: string; qty_base?: number }[] | null   // liên kết dòng DO SAP (đơn upload) — rỗng = đơn tay
  boxes_display:      number
  weight:             number | null
  loose_picking:      number
  pallets_estimated:  number
  material_type:      string | null   // "Thành phẩm" | "POSM" | "Pallet Loscam"
  export_type:        string | null
  header_text:        string | null
  batch_required:     string | null
  date_required:      number | null
  cs_responsible:     string | null
  cartons_scanned:    number
  status:             OutboundStatus
  scan_entries:       OutboundScanEntry[]
}

export interface OutboundDelivery {
  id:               string
  gdo_id:           string
  delivery_code:    string
  distributor_name: string | null
  status:           OutboundStatus
  items:            OutboundItem[]
}

export interface GDOItemBreakdown {
  material_code:    string
  material_name:    string | null
  distributor_name: string | null
  cartons:          number
  cartons_scanned:  number
  pallets:          number
}

export interface GDO {
  id:               string
  group_code:       string
  planned_date:     string
  delivery_date:    string
  warehouse_id:     string | null
  warehouse_type:   string | null
  warehouse?:       { id: string; code: string; name: string; inventory_mode?: string | null; require_weigh_on_start?: boolean; require_gate_on_start?: boolean } | null
  shipto_party?:     string | null
  transfer_status?:  string | null
  dvvt:             string | null
  // Nguồn chuyến (02/08): 'SAP' = sinh từ VL06O+Kế hoạch xuất → phần KẾ HOẠCH khóa trên đơn,
  // sửa ở 2 tab nguồn; 'EXCEL'/'MANUAL'/'LEGACY' = sửa như cũ (kho không làm SAP)
  origin?:          string | null
  status:           OutboundStatus
  created_at:       string
  // List aggregates
  do_count?:        number
  distributor_names?: string[]
  delivery_codes?:  string[]
  export_type?:     string | null
  total_cartons?:      number
  total_cartons_noqr?: number
  total_loose?:     number
  total_pallets?:   number
  // BASE UNIT: tổng base thô + đơn vị khai báo (chỉ khi mọi mã CÙNG đơn vị) → hiện "thùng + base"
  total_cartons_base?: number
  total_noqr_base?:    number
  total_loose_base?:   number
  qty_unit?: { base_unit: string | null; entry_unit: string | null; units_per_carton: number | null } | null
  item_breakdown?:  GDOItemBreakdown[]
  // Workflow fields
  assigned_at?:        string | null
  assigned_by?:        string | null
  started_at?:         string | null
  last_scanned_at?:    string | null
  scan_completed_at?:  string | null
  completed_at?:       string | null
  license_plate?:      string | null
  // Loại xe DỰ KIẾN theo kế hoạch vận chuyển (getGDO trả khi chuyến CHƯA gắn biển số) — sơ đồ
  // xếp xe dùng để biết vẽ XE PALLET hay xe thường lúc còn đang lên kế hoạch
  planned_vehicle_type?: string | null
  container_number?:   string | null
  exporter_name?:      string | null
  loader_name?:        string | null
  forklift_driver_id?:    string | null
  forklift_driver_names?: string | null
  forklift_driver?:       { id: string; name: string } | null
  // Liên kết chuyến xe ở Đăng ký cổng (1 chuyến = 1 lượt xe đã vào) — phục vụ báo cáo per-chuyến
  gate_registration_id?:  string | null
  gate_registration?:     { id: string; registration_number: number; date: string; license_plate: string | null; status: string; direction: string; entry_at?: string | null; exit_at?: string | null } | null
  // Audit
  updated_at?:     string | null
  created_by?:     string | null
  updated_by?:     string | null
  // Detail
  delivery_orders?: OutboundDelivery[]
  // Xuất: Kho/Loại kho có bắt multiscan tem thùng sau khi quét pallet không (getGDO tính, Kho đè Loại kho)
  carton_scan_enabled?: boolean
  // Kho chọn "Bắt buộc quét đủ thùng" → BE chặn Hoàn thành chuyến khi pallet thiếu tem (15/07)
  carton_scan_require_full?: boolean
  // Gate cân xe (01/08): duyệt bỏ qua cân + phiếu cân gắn chuyến + ước tính KL hàng (đối chiếu net cân)
  weigh_waived_at?:     string | null   // duyệt bỏ qua RULE 2 (cân)
  weigh_waived_by?:     string | null
  weigh_waive_reason?:  string | null
  gate_waived_at?:      string | null   // duyệt bỏ qua RULE 1 (đăng ký cổng) — biển số thành tùy chọn
  gate_waived_by?:      string | null
  gate_waive_reason?:   string | null
  weigh_tickets?: {
    id: string; ticket_no: string | null; weigh_date: string | null; license_plate: string | null
    tare_kg: number | null; gross_kg: number | null; net_kg: number | null
    is_complete: boolean; in_time: string | null; out_time: string | null
  }[]
  weight_estimate?: { gdo_id: string; kg_planned: number | null; kg_actual: number | null; items_total: number; items_missing: number } | null
  // CHUYẾN BẤT ĐỘNG (03/08) — hiện trên màn nhưng không thao tác được, chỉ xem + xem lịch sử:
  awaiting_sap?:  boolean | null   // còn DO chưa có dữ liệu VL06O (tự tắt khi VL06O về)
  awaiting_dos?:  string[] | null  // DO đang chờ (hiện trong cảnh báo)
  plan_dropped?:  boolean | null   // Kế hoạch xuất không còn Số xe này (tự bật lại khi kế hoạch có lại)
}

// 1 dòng lịch sử của chuyến (nút "Thông tin") — gộp nhật ký kế hoạch + thay đổi từ SAP
export interface OutboundEvent {
  id: string
  event_type: string
  source: 'PLAN' | 'SAP' | 'USER' | 'SYSTEM' | string
  actor: string | null
  do_number: string | null
  material_code: string | null
  old_value: string | null
  new_value: string | null
  detail: string
  created_at: string
}
