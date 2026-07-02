import { useMemo } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useWarehouses, useWarehouseTypes } from '@/api/hooks'

/**
 * Scope người dùng: Loại hàng/Loại kho (allowed_categories) + Kho (warehouse_ids).
 * Dùng cho MỌI filter/form nghiệp vụ — option chỉ hiện trong phạm vi user được phép.
 * Chỉ UserManagement + tab Loại kho/Kho của WMSSettings (quản trị taxonomy) còn dùng hook gốc.
 */

// Chuẩn hoá giá trị cũ còn trong JWT/DB về taxonomy hiện hành
// (migration 20260702_normalize_allowed_categories dọn DB; đây là lớp phòng hộ FE)
export function expandLegacyCats(cats: string[]): string[] {
  const out = new Set<string>()
  for (const c of cats) {
    if (c === 'TP') out.add('Thành phẩm')
    else if (c === 'NVL') { out.add('Raw'); out.add('Giấy'); out.add('Thùng') }
    else if (c === 'Bao bì' || c === 'BAO_BI') { out.add('Giấy'); out.add('Thùng') }
    else out.add(c)
  }
  return [...out]
}

/** Loại kho/Loại hàng user được phép. NATIONAL hoặc chưa cấu hình → toàn bộ danh mục. */
export function useScopedWhTypes() {
  const user = useAuthStore(s => s.user)
  const query = useWarehouseTypes()
  const all = query.data ?? []
  const data = useMemo(() => {
    if (user?.warehouse_scope === 'NATIONAL') return all
    const allowed = expandLegacyCats(user?.allowed_categories ?? [])
    if (allowed.length === 0) return all
    const scoped = all.filter(t => allowed.includes(t.value))
    // allowed_categories toàn giá trị rác → đừng khoá trắng UI
    return scoped.length > 0 ? scoped : all
  }, [all, user?.warehouse_scope, user?.allowed_categories])
  return { ...query, data }
}

/** Kho user được truy cập. NATIONAL hoặc chưa gán kho → toàn bộ. */
export function useScopedWarehouses(onlyActive = false) {
  const user = useAuthStore(s => s.user)
  const query = useWarehouses(onlyActive)
  const all = (query.data ?? []) as { id: string }[]
  const data = useMemo(() => {
    if (user?.warehouse_scope === 'NATIONAL') return all
    const ids = new Set(user?.warehouse_ids?.length ? user.warehouse_ids : user?.warehouse_id ? [user.warehouse_id] : [])
    if (ids.size === 0) return all
    return all.filter(w => ids.has(w.id))
  }, [all, user?.warehouse_scope, user?.warehouse_ids, user?.warehouse_id])
  return { ...query, data }
}
