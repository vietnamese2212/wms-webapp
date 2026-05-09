import { supabase } from './supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionLevel = 'NATIONAL_MANAGER' | 'SITE_MANAGER' | 'SUPERVISOR' | 'OPERATOR' | 'STAFF' | 'VIEWER'
export type AppModule   = 'inbound' | 'outbound' | 'inventory' | 'reports' | 'admin'
export type AppAction   = 'view' | 'create' | 'edit' | 'delete' | 'approve'
export type Category    = 'TP' | 'NVL' | 'POSM' | 'BAO_BI'

export interface PermActor {
  action_level:       ActionLevel
  allowed_categories: string[]     // ['TP','NVL'] — rỗng = không có quyền gì
  warehouse_scope:    'NATIONAL' | 'ASSIGNED'
  warehouse_ids:      string[]
  allowed_modules:    string[]
}

export interface PermResource {
  warehouse_id?: string | null
  category?:     string | null     // 'TP' | 'NVL' | 'POSM' | 'BAO_BI' hoặc legacy
}

// ─── Config ───────────────────────────────────────────────────────────────────

const LEVEL_ACTIONS: Record<ActionLevel, AppAction[]> = {
  NATIONAL_MANAGER: ['view', 'create', 'edit', 'delete', 'approve'],
  SITE_MANAGER:     ['view', 'create', 'edit', 'delete', 'approve'],
  SUPERVISOR:       ['view', 'create', 'edit', 'delete'],
  OPERATOR:         ['view', 'create', 'edit'],
  STAFF:            ['view', 'create'],
  VIEWER:           ['view'],
}

// Normalize giá trị category cũ (legacy text) → code chuẩn
const CATEGORY_ALIASES: Record<string, Category> = {
  'Thành phẩm': 'TP',
  'thanh pham': 'TP',
  'Bao bì':     'BAO_BI',
  'Bao bi':     'BAO_BI',
  'bao bi':     'BAO_BI',
}

export function normalizeCategory(cat: string): Category {
  return (CATEGORY_ALIASES[cat] ?? cat) as Category
}

// ─── Core permission check ────────────────────────────────────────────────────

export function can(
  actor: PermActor,
  action: AppAction,
  module: AppModule,
  resource: PermResource = {}
): boolean {
  // 1. Module (từ Department của user)
  if (!actor.allowed_modules.includes(module)) return false

  // 2. Category scope (từ JobTitle/override)
  if (resource.category) {
    const normalized = normalizeCategory(resource.category)
    if (!actor.allowed_categories.includes(normalized)) return false
  }

  // 3. Warehouse scope
  if (actor.warehouse_scope !== 'NATIONAL' && resource.warehouse_id) {
    if (!actor.warehouse_ids.includes(resource.warehouse_id)) return false
  }

  // 4. Action level
  return (LEVEL_ACTIONS[actor.action_level] ?? []).includes(action)
}

// ─── Load actor từ DB ─────────────────────────────────────────────────────────

export async function loadActor(employee_id: string): Promise<PermActor | null> {
  const { data: emp } = await supabase
    .from('Employee')
    .select(`
      action_level,
      allowed_categories,
      warehouse_scope,
      department:Department(allowed_modules),
      warehouse_access:UserWarehouseAccess(warehouse_id)
    `)
    .eq('id', employee_id)
    .maybeSingle()

  if (!emp || !emp.action_level) return null

  const dept = emp.department as { allowed_modules: string[] } | null

  return {
    action_level:       emp.action_level as ActionLevel,
    allowed_categories: (emp.allowed_categories as string[]) ?? [],
    warehouse_scope:    (emp.warehouse_scope as 'NATIONAL' | 'ASSIGNED') ?? 'ASSIGNED',
    warehouse_ids:      ((emp.warehouse_access as { warehouse_id: string }[]) ?? []).map(w => w.warehouse_id),
    allowed_modules:    dept?.allowed_modules ?? [],
  }
}

// ─── Convenience: load + check trong một bước ─────────────────────────────────

export async function checkPerm(
  employee_id: string | undefined,
  action: AppAction,
  module: AppModule,
  resource: PermResource = {}
): Promise<{ allowed: boolean; reason?: string }> {
  if (!employee_id) return { allowed: false, reason: 'Chưa xác thực' }

  const actor = await loadActor(employee_id)
  if (!actor) return { allowed: false, reason: 'Không tìm thấy nhân viên' }

  if (!can(actor, action, module, resource)) {
    return { allowed: false, reason: 'Không có quyền thực hiện thao tác này' }
  }

  return { allowed: true }
}
