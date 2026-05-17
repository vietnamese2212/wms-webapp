import type { ActionLevel } from '@/types'

// ─── Module registry ─────────────────────────────────────────────────────────
// Thêm module mới: chỉ cần thêm 1 key vào đây + update LEVEL_PERMISSIONS bên dưới

export const MODULES = {
  dashboard:    { label: 'Dashboard' },
  inventory:    { label: 'Tồn kho' },
  inbound:      { label: 'Nhập kho' },
  outbound:     { label: 'Xuất kho' },
  loosepicking: { label: 'Lấy lẻ' },
  stocktake:    { label: 'Kiểm kho' },
  locations:    { label: 'Vị trí kho' },
  masterdata:   { label: 'Danh mục' },
  employees:    { label: 'Nhân viên' },
} as const

export type ModuleKey = keyof typeof MODULES
export type ActionKey = 'view' | 'create' | 'edit' | 'delete'

// ─── Permission matrix ────────────────────────────────────────────────────────
// Mỗi cấp quyền → danh sách actions cho từng module
// Thứ tự actions: view → create → edit → delete (luỹ tiến — level cao hơn bao giờ cũng ≥ level thấp hơn)

type PermMatrix = Partial<Record<ModuleKey, ActionKey[]>>

export const LEVEL_PERMISSIONS: Record<ActionLevel, PermMatrix> = {
  VIEWER: {
    dashboard:    ['view'],
    inventory:    ['view'],
    inbound:      ['view'],
    outbound:     ['view'],
    loosepicking: ['view'],
    stocktake:    ['view'],
    locations:    ['view'],
  },

  STAFF: {
    dashboard:    ['view'],
    inventory:    ['view'],
    inbound:      ['view'],
    outbound:     ['view'],
    loosepicking: ['view'],
    stocktake:    ['view'],
    locations:    ['view'],
  },

  OPERATOR: {
    dashboard:    ['view'],
    inventory:    ['view'],
    inbound:      ['view', 'create', 'edit'],
    outbound:     ['view', 'create', 'edit'],
    loosepicking: ['view', 'create', 'edit'],
    stocktake:    ['view', 'create', 'edit'],
    locations:    ['view'],
  },

  SUPERVISOR: {
    dashboard:    ['view'],
    inventory:    ['view', 'edit'],
    inbound:      ['view', 'create', 'edit'],
    outbound:     ['view', 'create', 'edit'],
    loosepicking: ['view', 'create', 'edit'],
    stocktake:    ['view', 'create', 'edit', 'delete'],
    locations:    ['view', 'edit'],
    masterdata:   ['view'],
  },

  SITE_MANAGER: {
    dashboard:    ['view'],
    inventory:    ['view', 'edit'],
    inbound:      ['view', 'create', 'edit', 'delete'],
    outbound:     ['view', 'create', 'edit', 'delete'],
    loosepicking: ['view', 'create', 'edit', 'delete'],
    stocktake:    ['view', 'create', 'edit', 'delete'],
    locations:    ['view', 'create', 'edit', 'delete'],
    masterdata:   ['view', 'create', 'edit'],
    employees:    ['view', 'create', 'edit'],
  },

  NATIONAL_MANAGER: {
    dashboard:    ['view'],
    inventory:    ['view', 'edit', 'delete'],
    inbound:      ['view', 'create', 'edit', 'delete'],
    outbound:     ['view', 'create', 'edit', 'delete'],
    loosepicking: ['view', 'create', 'edit', 'delete'],
    stocktake:    ['view', 'create', 'edit', 'delete'],
    locations:    ['view', 'create', 'edit', 'delete'],
    masterdata:   ['view', 'create', 'edit', 'delete'],
    employees:    ['view', 'create', 'edit', 'delete'],
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function can(
  level: ActionLevel | null | undefined,
  module: ModuleKey,
  action: ActionKey,
): boolean {
  if (!level) return false
  return LEVEL_PERMISSIONS[level]?.[module]?.includes(action) ?? false
}

export function canAny(level: ActionLevel | null | undefined, module: ModuleKey): boolean {
  if (!level) return false
  return (LEVEL_PERMISSIONS[level]?.[module]?.length ?? 0) > 0
}
