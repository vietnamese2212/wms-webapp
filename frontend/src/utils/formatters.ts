import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { vi } from 'date-fns/locale'
import type { TransactionType, TransactionStatus, VehicleStatus, EmployeeStatus, StockStatus } from '@/types'

// Intl-based helpers — always display in Vietnam timezone (UTC+7) regardless of browser OS
const VN_TZ = 'Asia/Ho_Chi_Minh'

// Supabase TIMESTAMP columns return strings without TZ suffix (e.g. "2026-05-11T06:36:06.123").
// Without Z, new Date() treats them as LOCAL time — must force UTC by appending Z.
function toUtcDate(isoStr: string): Date {
  if (isoStr && !isoStr.endsWith('Z') && !/[+\-]\d{2}:?\d{2}$/.test(isoStr)) {
    return new Date(isoStr + 'Z')
  }
  return new Date(isoStr)
}

function vnParts(isoStr: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  return new Intl.DateTimeFormat('en', { timeZone: VN_TZ, ...opts })
    .formatToParts(toUtcDate(isoStr))
    .reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc }, {})
}

// date-only strings (YYYY-MM-DD) — timezone-safe, use date-fns as usual
export function formatDate(dateStr: string, fmt = 'dd-MM-yyyy') {
  return format(parseISO(dateStr), fmt, { locale: vi })
}

// Full UTC timestamp → date + time in Vietnam timezone
export function formatDateTime(isoStr: string) {
  const p = vnParts(isoStr, { day: '2-digit', month: '2-digit', year: 'numeric', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`
}

// Date portion of a UTC timestamp in Vietnam timezone (twoDigitYear for compact table cells)
export function formatTimestampDate(isoStr: string, twoDigitYear = false) {
  const p = vnParts(isoStr, { day: '2-digit', month: '2-digit', year: twoDigitYear ? '2-digit' : 'numeric' })
  return `${p.day}-${p.month}-${p.year}`
}

// Time portion of a UTC timestamp in Vietnam timezone
export function formatTimestampTime(isoStr: string, showSeconds = true) {
  const p = vnParts(isoStr, { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', ...(showSeconds ? { second: '2-digit' } : {}) })
  return showSeconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`
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

export function getLocationCode(location: { zone: string; row: string; shelf: string; bin: string }) {
  return `${location.zone}-${location.row}.${location.shelf}.${location.bin}`
}

export const inboundOrderStatusLabel: Record<string, string> = {
  OPEN:      'Đang mở',
  COMPLETED: 'Hoàn thành',
}

export const palletStatusLabel: Record<string, string> = {
  IN_STOCK:    'Trong kho',
  EXPORTED:    'Đã xuất',
  TRANSFERRED: 'Đã chuyển',
  PARTIAL:     'Xuất một phần',
}

// ─── Biển số xe & SĐT (chuẩn hóa + validate dùng chung toàn app) ───────────────
// Biển số: viết hoa, CHỈ chữ+số (bỏ mọi ký tự đặc biệt/khoảng trắng). VD: 30H1234, 30H12345, CD1234.
export function normalizeLicensePlate(s: string): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
export function isValidLicensePlate(s: string): boolean {
  return /^[A-Z0-9]+$/.test((s ?? '').trim())
}
// SĐT: chỉ chữ số, tối đa 10 (chuẩn hóa khi gõ); hợp lệ = đúng 10 chữ số.
export function normalizePhone(s: string): string {
  return (s ?? '').replace(/\D/g, '').slice(0, 10)
}
export function isValidPhone(s: string): boolean {
  return /^\d{10}$/.test((s ?? '').trim())
}
