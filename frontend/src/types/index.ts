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
  ncc_id?: string | null
  employee_code?: string | null
  // Permission system fields
  allowed_categories?: string[]
  warehouse_scope?:    'NATIONAL' | 'ASSIGNED'
  warehouse_ids?:      string[]
  allowed_modules?:    AppModule[]
  module_permissions?: ModulePermissions
}

// ─── Permission masterdata ────────────────────────────────────────────────────

export interface Department {
  id:              string
  name:            string
  code:            string
  allowed_modules: AppModule[]
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

export type DeliveryStatus = 'PENDING' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED'

export interface DeliveryOrder {
  id: string
  orderNo: string
  vehicle?: Vehicle
  driver?: Driver
  origin: string
  destination: string
  customer: string
  status: DeliveryStatus
  scheduledAt: string
  completedAt?: string
  weight: number
  items: number
  distance?: number
  notes?: string
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
  ea_per_pallet:              number | null
  shelf_life_days:            number | null
  storage_category:           string | null
  old_code:                   string | null
  warehouse_pallet_overrides:     WarehousePalletOverride[] | null
  supplier_shelf_life_overrides?: SupplierShelfLifeOverride[] | null
  manufacturer_id:                string | null
  manufacturer?:              { id: string; code: string; name: string | null } | null
  notes:                      string | null
  no_qr_tracking:             boolean
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
  material:        { id: string; material_code: string; short_name: string | null; material_description: string; cartons_per_pallet: number | null; cartons_per_pallet_mn: number | null } | null
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
  warehouse_type?:      string | null
  gate_registration_id?: string | null
  gate_registration?:   { id: string; registration_number: number; date: string; license_plate: string | null; company_name_raw: string | null; driver_name: string | null; status: string; direction: string } | null
  planned_cartons?:     number | null
  posm_entry_id?:       string | null
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

export interface LocationSuggestion {
  id:               string
  location_code:    string
  sub_code:         string
  sub_name:         string | null
  max_pallets:      number
  used_slots:       number
  available_slots:  number
  has_same_material: boolean
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
  stocktake_at:        string | null
  stocktake_flagged:   boolean | null
  stocktake_flag_note: string | null
  created_at:          string
  updated_at:          string
  location:              { id: string; location_code: string; sub_code: string; sub_name: string | null; sub_type: string | null; warehouse?: { id: string; name: string; code: string } | null } | null
  material:              { id: string; material_code: string; short_name: string | null; shelf_life_days: number | null; category: string | null } | null
  manufacturer:          { id: string; code: string; name: string | null } | null
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
  warehouse_type:  string | null
  planned_boxes:   number | null
  planned_pallets: number | null
  planned_tons:    number | null
  gdo_refs:        string | null
  notes:           string | null
  priority:        boolean
  export_status:   string | null
  status:          string
  source_type?:    string | null
  destination_warehouse_id?: string | null
  eta?:            string | null
  created_by:      string | null
  updated_by:      string | null
  created_at:      string
  updated_at:      string
  completed_at?:   string | null
  vehicle_slots:   TmsVehicleSlot[]
}

// TMS – Foundation
export interface TmsVehicleType {
  id:         string
  code:       string
  name:       string
  is_active:  boolean
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
  vehicle_type?:   Pick<TmsVehicleType, 'id' | 'code' | 'name'>
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
  tms_vehicle_slot_id: string
  order_code:          string   // comma-sep khi nhiều đơn/slot
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
  best_available_date:  string | null  // production_date tốt nhất trong kho lúc quét (cũ nhất, không QA)
}

export interface OutboundItem {
  id:                 string
  do_id:              string
  material_id:        string | null
  material_code_raw:  string | null
  material:           { id: string; material_code: string; short_name: string | null; custom_short_name: string | null; cartons_per_pallet: number | null; weight_kg: number | null; no_qr_tracking?: boolean } | null
  cartons_ordered:    number
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
  warehouse?:       { id: string; code: string; name: string } | null
  shipto_party?:     string | null
  transfer_status?:  string | null
  dvvt:             string | null
  status:           OutboundStatus
  created_at:       string
  // List aggregates
  do_count?:        number
  distributor_names?: string[]
  delivery_codes?:  string[]
  export_type?:     string | null
  total_cartons?:      number
  total_cartons_noqr?: number
  total_pallets?:   number
  item_breakdown?:  GDOItemBreakdown[]
  // Workflow fields
  assigned_at?:        string | null
  assigned_by?:        string | null
  started_at?:         string | null
  last_scanned_at?:    string | null
  scan_completed_at?:  string | null
  completed_at?:       string | null
  license_plate?:      string | null
  container_number?:   string | null
  exporter_name?:      string | null
  loader_name?:        string | null
  forklift_driver_id?:    string | null
  forklift_driver_names?: string | null
  forklift_driver?:       { id: string; name: string } | null
  // Audit
  updated_at?:     string | null
  created_by?:     string | null
  updated_by?:     string | null
  // Detail
  delivery_orders?: OutboundDelivery[]
}
