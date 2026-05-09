// Auth
export type Role = 'ADMIN' | 'OWN' | 'WAREHOUSE_MANAGER' | 'WAREHOUSE_STAFF' | 'DRIVER' | 'HR_MANAGER'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  avatar?: string
  department?: string
  warehouse_id?: string
  warehouse_name?: string
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
  role: Role
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

export type ScheduleStatus = 'SCHEDULED' | 'CONFIRMED' | 'ABSENT' | 'LATE'

export interface Schedule {
  id: string
  employee: Employee
  shift: Shift
  date: string
  status: ScheduleStatus
  checkIn?: string
  checkOut?: string
  overtimeHours?: number
}

export type OvertimeStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface OvertimeRequest {
  id: string
  employee: Employee
  date: string
  hours: number
  reason: string
  status: OvertimeStatus
  approvedBy?: string
  createdAt: string
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

export interface Material {
  id:                   string
  material_code:        string
  material_description: string
  short_name:           string | null
  custom_short_name:    string | null
  category:             string | null
  product_type:         string | null
  unit:                 string | null
  weight_kg:            number | null
  cartons_per_pallet:   number | null
  cartons_per_pallet_mn: number | null
  units_per_carton:     number | null
  shelf_life_days:      number | null
  storage_category:     string | null
  manufacturer_id:      string | null
  is_active:            boolean
}

// WMS – Inbound
export type InboundOrderStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED'

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
  _count:          { inventory_entries: number }
  total_cartons?:  number
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
