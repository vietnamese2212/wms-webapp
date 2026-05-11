import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import type { TransactionType, TransactionStatus, DeliveryStatus, VehicleStatus, EmployeeStatus, StockStatus, OvertimeStatus } from '@/types'

export function formatDate(dateStr: string, fmt = 'dd/MM/yyyy') {
  return format(parseISO(dateStr), fmt, { locale: vi })
}

export function formatDateTime(dateStr: string) {
  return format(parseISO(dateStr), 'dd/MM/yyyy HH:mm:ss', { locale: vi })
}

export function formatTimeAgo(dateStr: string) {
  return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: vi })
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat('vi-VN').format(n)
}

export function formatWeight(kg: number) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}T`
  return `${kg}kg`
}

export function formatPercent(n: number, decimals = 1) {
  return `${n.toFixed(decimals)}%`
}

export const transactionTypeLabel: Record<TransactionType, string> = {
  INBOUND: 'Nhập kho',
  OUTBOUND: 'Xuất kho',
  TRANSFER: 'Chuyển vị trí',
  ADJUSTMENT: 'Điều chỉnh',
  CYCLE_COUNT: 'Kiểm kho',
}

export const transactionStatusLabel: Record<TransactionStatus, string> = {
  PENDING: 'Chờ xử lý',
  IN_PROGRESS: 'Đang thực hiện',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã huỷ',
}

export const deliveryStatusLabel: Record<DeliveryStatus, string> = {
  PENDING: 'Chờ giao',
  ASSIGNED: 'Đã phân công',
  IN_TRANSIT: 'Đang giao',
  DELIVERED: 'Hoàn thành',
  FAILED: 'Thất bại',
}

export const vehicleStatusLabel: Record<VehicleStatus, string> = {
  AVAILABLE: 'Khả dụng',
  IN_USE: 'Đang sử dụng',
  MAINTENANCE: 'Bảo dưỡng',
  EXPIRED: 'Hết hạn ĐK',
}

export const employeeStatusLabel: Record<EmployeeStatus, string> = {
  ACTIVE: 'Đang làm việc',
  INACTIVE: 'Nghỉ việc',
  ON_LEAVE: 'Đang nghỉ phép',
}

export const stockStatusLabel: Record<StockStatus, string> = {
  IN_STOCK: 'Đủ hàng',
  LOW_STOCK: 'Sắp hết',
  OUT_OF_STOCK: 'Hết hàng',
}

export const overtimeStatusLabel: Record<OvertimeStatus, string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
}

export const roleLabel: Record<string, string> = {
  ADMIN: 'Quản trị viên',
  OWN: 'Chủ doanh nghiệp',
  WAREHOUSE_MANAGER: 'Quản lý kho',
  WAREHOUSE_STAFF: 'Nhân viên kho',
  DRIVER: 'Tài xế',
  HR_MANAGER: 'Quản lý HR',
}

export function getLocationCode(location: { zone: string; row: string; shelf: string; bin: string }) {
  return `${location.zone}-${location.row}.${location.shelf}.${location.bin}`
}

export const inboundOrderStatusLabel: Record<string, string> = {
  OPEN:      'Đang mở',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
}

export const palletStatusLabel: Record<string, string> = {
  IN_STOCK:    'Trong kho',
  EXPORTED:    'Đã xuất',
  TRANSFERRED: 'Đã chuyển',
  PARTIAL:     'Xuất một phần',
}
