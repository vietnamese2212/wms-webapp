import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'

/**
 * Bản đồ TRẠNG THÁI NGHIỆP VỤ → nhãn tiếng Việt + tone StatusBadge — NGUỒN DUY NHẤT.
 * Trước 25/08: `statusCls`/`statusLabel` + `function Badge({status})` bị chép 4 bản
 * (Outbound/OutboundItem/LoosePicking/LoosePickingItem detail) và map tồn kho chép 3 bản
 * (Inventory, StocktakeDashboard, PalletDetailDialog) → sửa nhãn/màu 1 chỗ là lệch chỗ khác.
 * Thêm trạng thái mới thì thêm vào ĐÂY, đừng khai lại ở trang.
 */
export type StatusInfo = { label: string; tone: BadgeTone }

// ─── Trạng thái chuyến xuất / dòng hàng xuất (Xuất kho + Nhặt lẻ) ──────────────
const OUTBOUND_STATUS: Record<string, StatusInfo> = {
  PENDING:     { label: 'Chờ xuất',   tone: 'slate' },
  IN_PROGRESS: { label: 'Đang xuất',  tone: 'amber' },
  COMPLETED:   { label: 'Hoàn thành', tone: 'green' },
  CANCELLED:   { label: 'Đã hủy',     tone: 'red'   },
  PAUSED:      { label: 'Tạm dừng',   tone: 'red'   },
}

export function outboundStatusInfo(status: string): StatusInfo {
  return OUTBOUND_STATUS[status] ?? { label: status, tone: 'slate' }
}

export function OutboundStatusBadge({ status }: { status: string }) {
  const { label, tone } = outboundStatusInfo(status)
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

// ─── Trạng thái pallet TỒN KHO ────────────────────────────────────────────────
const INVENTORY_STATUS: Record<string, StatusInfo> = {
  IN_STOCK:      { label: 'Còn hàng',     tone: 'green'  },
  PARTIAL:       { label: 'Xuất 1 phần',  tone: 'amber'  },
  EXPORTED:      { label: 'Đã xuất',      tone: 'blue'   },
  TRANSFERRED:   { label: 'Đã chuyển',    tone: 'slate'  },
  QUARANTINE:    { label: 'Cách ly',      tone: 'red'    },
  CANCELLED:     { label: 'Đã hủy',       tone: 'slate'  },
  LOOSE_PICKING: { label: 'Đang nhặt lẻ', tone: 'purple' },
}

export function inventoryStatusInfo(status: string): StatusInfo {
  return INVENTORY_STATUS[status] ?? { label: status, tone: 'slate' }
}

export function InventoryStatusBadge({ status }: { status: string }) {
  const { label, tone } = inventoryStatusInfo(status)
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}
