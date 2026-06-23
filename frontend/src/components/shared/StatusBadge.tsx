import { Badge } from '@/components/ui/badge'
import type {
  TransactionStatus, TransactionType,
  VehicleStatus, EmployeeStatus, StockStatus,
} from '@/types'
import {
  transactionStatusLabel, transactionTypeLabel,
  vehicleStatusLabel, employeeStatusLabel, stockStatusLabel,
} from '@/utils/formatters'
import type { BadgeProps } from '@/components/ui/badge'

type BadgeVariant = BadgeProps['variant']

const transactionStatusVariant: Record<TransactionStatus, BadgeVariant> = {
  PENDING: 'warning',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'slate',
}

const transactionTypeVariant: Record<TransactionType, BadgeVariant> = {
  INBOUND: 'success',
  OUTBOUND: 'info',
  TRANSFER: 'purple',
  ADJUSTMENT: 'warning',
  CYCLE_COUNT: 'slate',
}

const vehicleStatusVariant: Record<VehicleStatus, BadgeVariant> = {
  AVAILABLE: 'success',
  IN_USE: 'info',
  MAINTENANCE: 'warning',
  EXPIRED: 'danger',
}

const employeeStatusVariant: Record<EmployeeStatus, BadgeVariant> = {
  ACTIVE: 'success',
  INACTIVE: 'slate',
  ON_LEAVE: 'warning',
}

const stockStatusVariant: Record<StockStatus, BadgeVariant> = {
  IN_STOCK: 'success',
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'danger',
}

export function TransactionStatusBadge({ status }: { status: TransactionStatus }) {
  return <Badge variant={transactionStatusVariant[status]}>{transactionStatusLabel[status]}</Badge>
}

export function TransactionTypeBadge({ type }: { type: TransactionType }) {
  return <Badge variant={transactionTypeVariant[type]}>{transactionTypeLabel[type]}</Badge>
}

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  return <Badge variant={vehicleStatusVariant[status]}>{vehicleStatusLabel[status]}</Badge>
}

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge variant={employeeStatusVariant[status]}>{employeeStatusLabel[status]}</Badge>
}

export function StockStatusBadge({ status }: { status: StockStatus }) {
  return <Badge variant={stockStatusVariant[status]}>{stockStatusLabel[status]}</Badge>
}
