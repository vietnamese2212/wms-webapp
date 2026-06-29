import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const INVENTORY_MODES = ['QR', 'QTY', 'NONE'] as const

function extractCount(arr: unknown): number {
  if (Array.isArray(arr) && arr.length > 0) return (arr[0] as { count: number }).count ?? 0
  return 0
}

// Chuẩn hoá danh sách ship-to phụ: nhận mảng hoặc chuỗi "A, B" → mảng mã UPPER, bỏ trùng/rỗng.
function normShiptoCodes(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(',')
  return [...new Set(raw.map(s => String(s).toUpperCase().trim()).filter(Boolean))]
}

// Chặn 1 mã ship-to thuộc >1 kho (gây mơ hồ auto-detect chuyển kho). Trả mã đụng đầu tiên (nếu có).
async function findShiptoClash(codes: string[], code: string, excludeId?: string): Promise<string | null> {
  const all = [...new Set([code.toUpperCase().trim(), ...codes].filter(Boolean))]
  if (!all.length) return null
  const { data } = await supabase.from('Warehouse').select('id, code, shipto_codes')
  for (const w of (data ?? []) as { id: string; code: string; shipto_codes: string[] | null }[]) {
    if (excludeId && w.id === excludeId) continue
    const owned = new Set([String(w.code).toUpperCase().trim(), ...(w.shipto_codes ?? []).map(s => String(s).toUpperCase().trim())])
    const hit = all.find(c => owned.has(c))
    if (hit) return hit
  }
  return null
}

export async function listWarehouses(req: Request, res: Response) {
  try {
    const onlyActive = req.query.active === 'true'
    let query = supabase.from('Warehouse').select('*, Location(count), Employee(count)').order('name')
    if (onlyActive) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) throw error

    const result = (data ?? []).map((w) => {
      const { Location, Employee, ...rest } = w as Record<string, unknown>
      return { ...rest, _count: { locations: extractCount(Location), employees: extractCount(Employee) } }
    })
    ok(res, result)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getWarehouse(req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('Warehouse').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')

    const { data: locs, error: locErr } = await supabase
      .from('Location')
      .select('sub_code, sub_name, sub_type')
      .eq('warehouse_id', req.params.id)
      .eq('is_active', true)
      .order('sub_code')
    if (locErr) throw locErr

    const groupMap = new Map<string, { sub_code: string; sub_name: string | null; sub_type: string | null; location_count: number }>()
    for (const loc of locs ?? []) {
      const key = loc.sub_code
      if (!groupMap.has(key)) groupMap.set(key, { sub_code: loc.sub_code, sub_name: loc.sub_name, sub_type: loc.sub_type, location_count: 0 })
      groupMap.get(key)!.location_count++
    }

    ok(res, { ...data, sub_groups: Array.from(groupMap.values()) })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createWarehouse(req: Request, res: Response) {
  try {
    const { code, name, address, warehouse_type, inventory_mode, shipto_codes } = req.body
    if (!code || !name) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code hoặc name')
    if (!warehouse_type || !['CENTRAL', 'NPP'].includes(warehouse_type))
      return fail(res, 400, 'VALIDATION_ERROR', 'Chức năng kho không hợp lệ (CENTRAL hoặc NPP)')
    const mode = inventory_mode ?? 'QR'
    if (!INVENTORY_MODES.includes(mode))
      return fail(res, 400, 'VALIDATION_ERROR', 'Chế độ quản tồn không hợp lệ (QR, QTY hoặc NONE)')

    const shiptoArr = normShiptoCodes(shipto_codes)
    const clash = await findShiptoClash(shiptoArr, String(code))
    if (clash) return fail(res, 409, 'DUPLICATE', `Mã ship-to "${clash}" đã thuộc kho khác`)

    const actor = req.user?.name || null
    const { data, error } = await supabase
      .from('Warehouse')
      .insert({ id: randomUUID(), code: String(code).toUpperCase().trim(), name: String(name).trim(), address, warehouse_type, inventory_mode: mode, shipto_codes: shiptoArr, created_by: actor, updated_by: actor, updated_at: new Date().toISOString() })
      .select().single()

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã kho đã tồn tại')
      throw error
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateWarehouse(req: Request, res: Response) {
  try {
    const { name, address, is_active, warehouse_type, inventory_mode, shipto_codes } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (name !== undefined) patch.name = String(name).trim()
    if (address !== undefined) patch.address = address
    if (is_active !== undefined) patch.is_active = Boolean(is_active)
    if (shipto_codes !== undefined) {
      const shiptoArr = normShiptoCodes(shipto_codes)
      const { data: cur } = await supabase.from('Warehouse').select('code').eq('id', req.params.id).maybeSingle()
      const code = (cur as { code?: string } | null)?.code ?? ''
      const clash = await findShiptoClash(shiptoArr, code, req.params.id)
      if (clash) return fail(res, 409, 'DUPLICATE', `Mã ship-to "${clash}" đã thuộc kho khác`)
      patch.shipto_codes = shiptoArr
    }
    if (warehouse_type !== undefined) {
      if (!['CENTRAL', 'NPP'].includes(warehouse_type))
        return fail(res, 400, 'VALIDATION_ERROR', 'Chức năng kho không hợp lệ')
      patch.warehouse_type = warehouse_type
    }
    if (inventory_mode !== undefined) {
      if (!INVENTORY_MODES.includes(inventory_mode))
        return fail(res, 400, 'VALIDATION_ERROR', 'Chế độ quản tồn không hợp lệ (QR, QTY hoặc NONE)')
      // Chặn đổi chế độ khi kho CÒN TỒN sống → tránh tính lại lịch sử thực-nhận sai (posm↔import)
      // và tồn pool QTY không quét được nếu sang QR. NONE→QTY/QR vẫn OK vì kho NONE không có tồn.
      const { data: cur } = await supabase.from('Warehouse').select('inventory_mode').eq('id', req.params.id).maybeSingle()
      if (cur && (cur as { inventory_mode?: string }).inventory_mode !== inventory_mode) {
        const { count } = await supabase.from('InventoryEntry')
          .select('id', { count: 'exact', head: true })
          .eq('warehouse_id', req.params.id).gt('cartons_remaining', 0)
        if ((count ?? 0) > 0)
          return fail(res, 400, 'WAREHOUSE_HAS_STOCK', `Kho còn ${count} dòng tồn — không thể đổi chế độ quản tồn. Xử lý hết tồn (hoặc kiểm kho) trước khi đổi.`)
      }
      patch.inventory_mode = inventory_mode
    }

    const { data, error } = await supabase
      .from('Warehouse').update(patch).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteWarehouse(req: Request, res: Response) {
  try {
    const id = req.params.id

    // Kiểm tra có location nào chưa (kể cả đã soft-delete)
    const [locRes, piRes] = await Promise.all([
      supabase.from('Location').select('*', { count: 'exact', head: true }).eq('warehouse_id', id),
      supabase.from('ProductionImport').select('*', { count: 'exact', head: true }).eq('warehouse_id', id),
    ])
    if (locRes.error) throw locRes.error
    if (piRes.error)  throw piRes.error

    const hasRefs = (locRes.count ?? 0) > 0 || (piRes.count ?? 0) > 0

    if (!hasRefs) {
      // Không có dữ liệu liên quan → xóa vĩnh viễn
      const { error } = await supabase.from('Warehouse').delete().eq('id', id)
      if (error) throw error
      return ok(res, { deleted: true })
    } else {
      // Có location/phiếu nhập → vô hiệu hoá để giữ lịch sử
      const { data, error } = await supabase
        .from('Warehouse').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id).select().maybeSingle()
      if (error) throw error
      if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
      return ok(res, { deleted: false, ...data })
    }
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}
