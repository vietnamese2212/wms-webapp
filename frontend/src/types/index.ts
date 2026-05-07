// Auth
export type Role = 'ADMIN' | 'WAREHOUSE_MANAGER' | 'WAREHOUSE_STAFF' | 'DRIVER' | 'HR_MANAGER'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  avatar?: string
  department?: string
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
