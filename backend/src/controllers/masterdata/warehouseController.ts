import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { parseListParam } from '../../utils/httpQuery'
import { asRotationPrinciple } from '../../utils/rotation'
import { applyPutawayBody, applyWhTypeConfigBody, WH_TYPE_CFG_COLS } from '../../utils/putaway'
import { WH_TYPE_META_COLS } from '../../utils/warehouseTypeMeta'
import { invalidatePutawayConfig } from '../../services/putawayContext'
import { scopeCategoriesOf, categoryAllowed } from '../../utils/categoryScope'
import { warehouseTypeUsage } from '../wms/lookupController'

const INVENTORY_MODES = ['QR', 'QTY', 'QTY_DATE', 'NONE'] as const

function extractCount(arr: unknown): number {
  if (Array.isArray(arr) && arr.length > 0) return (arr[0] as { count: number }).count ?? 0
  return 0
}

// Chuẩn hoá danh sách ship-to phụ: nhận mảng hoặc chuỗi "A, B" → mảng mã UPPER, bỏ trùng/rỗng.
function normShiptoCodes(input: unknown): string[] {
  return [...new Set((parseListParam(input) ?? []).map(s => s.toUpperCase()))]
}

// Chặn 1 mã ship-to thuộc >1 kho (gây mơ hồ auto-detect chuyển kho). Trả mã đụng đầu tiên (nếu có).
async function findShiptoClash(codes: string[], code: string, excludeId?: string): Promise<string | null> {
  const all = [...new Set([code.toUpperCase().trim(), ...codes].filter(Boolean))]
  if (!all.length) return null
  // Phân trang (>1000 kho thì kiểm trùng ship-to sót → mã đụng lọt qua)
  const data = await fetchAllRowsParallel(() =>
    supabase.from('Warehouse').select('id, code, shipto_codes').order('id'))
  for (const w of (data ?? []) as { id: string; code: string; shipto_codes: string[] | null }[]) {
    if (excludeId && w.id === excludeId) continue
    const owned = new Set([String(w.code).toUpperCase().trim(), ...(w.shipto_codes ?? []).map(s => String(s).toUpperCase().trim())])
    const hit = all.find(c => owned.has(c))
    if (hit) return hit
  }
  return null
}

// Kho phụ nội bộ: validate parent_warehouse_id — parent phải tồn tại, không tự trỏ mình,
// không lồng 2 cấp (parent không được là kho phụ; kho đang làm parent không được thành kho phụ).
async function validateParent(parentId: string | null, selfId?: string): Promise<string | null> {
  if (!parentId) return null
  if (selfId && parentId === selfId) return 'Kho không thể trực thuộc chính nó'
  const { data: parent } = await supabase.from('Warehouse')
    .select('id, parent_warehouse_id').eq('id', parentId).maybeSingle()
  if (!parent) return 'Không tìm thấy kho parent'
  if ((parent as { parent_warehouse_id: string | null }).parent_warehouse_id)
    return 'Kho parent đã là kho phụ của kho khác — không lồng 2 cấp'
  if (selfId) {
    const { count } = await supabase.from('Warehouse')
      .select('id', { count: 'exact', head: true }).eq('parent_warehouse_id', selfId)
    if ((count ?? 0) > 0) return 'Kho này đang là parent của kho phụ khác — không thể trở thành kho phụ'
  }
  return null
}

// Chuẩn hoá mã NMSX (đoạn 6 QR + tiền tố location_code): UPPER trim, rỗng → null.
function normNmsx(input: unknown): string | null {
  const v = String(input ?? '').toUpperCase().trim()
  return v || null
}

// Map SAP → kho (dùng để CHẶN upload VL06O của kho ngoài phạm vi — user chốt 26/07).
// `sap_plant` = mã nhà máy SAP (cột Plant trong VL06O); `sap_storage_locations` = các Storage Location
// thuộc kho (FG01/FG02/PM01…), rỗng = mọi sloc của plant đó thuộc kho này.
function normSapPlant(input: unknown): string | null {
  const v = String(input ?? '').toUpperCase().trim()
  return v || null
}
function normSapSlocs(input: unknown): string[] {
  return [...new Set((parseListParam(input) ?? []).map(s => s.toUpperCase()))]
}

// Danh sách Loại kho phải quét thùng tại kho (multi) — null khi rỗng/không phải mảng
function normCartonCats(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null
  const arr = [...new Set(input.map(s => String(s).trim()).filter(Boolean))]
  return arr.length ? arr : null
}

// Chặn 2 kho cùng 1 mã NMSX (gây trùng location_code + mơ hồ NMSX). Trả mã đụng (nếu có).
async function findNmsxClash(nmsx: string | null, excludeId?: string): Promise<string | null> {
  if (!nmsx) return null
  // Phân trang (>1000 kho thì kiểm trùng NMSX sót)
  const data = await fetchAllRowsParallel(() =>
    supabase.from('Warehouse').select('id, nmsx_code').order('id'))
  for (const w of (data ?? []) as { id: string; nmsx_code: string | null }[]) {
    if (excludeId && w.id === excludeId) continue
    if (String(w.nmsx_code ?? '').toUpperCase().trim() === nmsx) return nmsx
  }
  return null
}

export async function listWarehouses(req: Request, res: Response) {
  try {
    const onlyActive = req.query.active === 'true'
    // Phân trang (>1000 kho thì list/dropdown mất kho)
    const data = await fetchAllRowsParallel(() => {
      let query = supabase.from('Warehouse').select('*, Location(count), Employee(count)').order('name').order('id')
      if (onlyActive) query = query.eq('is_active', true)
      return query
    })

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

    // Phân trang (kho lớn >1000 vị trí → sót khu)
    const locs = await fetchAllRowsParallel(() => supabase
      .from('Location')
      .select('sub_code, sub_name, sub_type')
      .eq('warehouse_id', req.params.id)
      .eq('is_active', true)
      .order('sub_code').order('id'))

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
    const { code, name, address, warehouse_type, inventory_mode, shipto_codes, nmsx_code, parent_warehouse_id, carton_scan_override, carton_scan_categories, carton_scan_require_full, sap_plant, sap_storage_locations, require_weigh_on_start, require_gate_on_start, rotation_principle, rotation_required } = req.body
    if (!code || !name) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code hoặc name')
    if (!warehouse_type || !['CENTRAL', 'NPP'].includes(warehouse_type))
      return fail(res, 400, 'VALIDATION_ERROR', 'Chức năng kho không hợp lệ (CENTRAL hoặc NPP)')
    const mode = inventory_mode ?? 'QR'
    if (!INVENTORY_MODES.includes(mode))
      return fail(res, 400, 'VALIDATION_ERROR', 'Chế độ quản tồn không hợp lệ (QR, QTY hoặc NONE)')

    const shiptoArr = normShiptoCodes(shipto_codes)
    const clash = await findShiptoClash(shiptoArr, String(code))
    if (clash) return fail(res, 409, 'DUPLICATE', `Mã ship-to "${clash}" đã thuộc kho khác`)
    const nmsx = normNmsx(nmsx_code)
    const nmsxClash = await findNmsxClash(nmsx)
    if (nmsxClash) return fail(res, 409, 'DUPLICATE', `Mã NMSX "${nmsxClash}" đã thuộc kho khác`)
    const parentId = parent_warehouse_id ? String(parent_warehouse_id) : null
    const parentErr = await validateParent(parentId)
    if (parentErr) return fail(res, 400, 'VALIDATION_ERROR', parentErr)

    const actor = req.user?.name || null
    const row: Record<string, unknown> = { id: randomUUID(), code: String(code).toUpperCase().trim(), name: String(name).trim(), address, warehouse_type, inventory_mode: mode, shipto_codes: shiptoArr, nmsx_code: nmsx, parent_warehouse_id: parentId, created_by: actor, updated_by: actor, updated_at: new Date().toISOString() }
    if (carton_scan_override !== undefined) row.carton_scan_override = carton_scan_override === null ? null : Boolean(carton_scan_override)
    if (carton_scan_categories !== undefined) row.carton_scan_categories = normCartonCats(carton_scan_categories)
    if (carton_scan_require_full !== undefined) row.carton_scan_require_full = Boolean(carton_scan_require_full)
    if (sap_plant !== undefined)             row.sap_plant = normSapPlant(sap_plant)
    if (sap_storage_locations !== undefined) row.sap_storage_locations = normSapSlocs(sap_storage_locations)
    if (require_weigh_on_start !== undefined) row.require_weigh_on_start = Boolean(require_weigh_on_start)   // rule 2: cân khi Bắt đầu xuất (20260801)
    if (require_gate_on_start !== undefined)  row.require_gate_on_start  = Boolean(require_gate_on_start)    // rule 1: đăng ký cổng khi Bắt đầu xuất (20260801c)
    if (rotation_principle !== undefined)     row.rotation_principle     = asRotationPrinciple(rotation_principle)   // FEFO/FIFO/LIFO (20260814c)
    if (rotation_required !== undefined)      row.rotation_required      = Boolean(rotation_required)                // true = CHẶN quét sai thứ tự
    const putErr = applyPutawayBody(req.body, row)                                                                   // quy tắc CẤT hàng (20260815d)
    if (putErr) return fail(res, 422, 'INVALID_INPUT', putErr)
    let { data, error } = await supabase.from('Warehouse').insert(row).select().single()
    // Cột carton_scan_* chưa apply migration → bỏ các cột đó rồi thử lại (không chặn tạo kho)
    if (error && /carton_scan/i.test(error.message)) {
      delete row.carton_scan_override; delete row.carton_scan_categories; delete row.carton_scan_require_full
      ;({ data, error } = await supabase.from('Warehouse').insert(row).select().single())
    }
    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã kho đã tồn tại')
      throw error
    }

    // Kho MỚI nhận ĐỦ MỌI loại kho (danh mục dùng chung — user chốt 21/08), setting để trống =
    // theo mặc định của kho. `copy_from_warehouse_id` chỉ COPY SETTING của kho mẫu, không đổi tập loại.
    const newId = (data as { id?: string } | null)?.id
    if (newId) {
      const src = req.body?.copy_from_warehouse_id ? String(req.body.copy_from_warehouse_id) : null
      const nowIso = new Date().toISOString()
      const srcCfg = new Map<string, Record<string, unknown>>()
      if (src) {
        const { data: rows } = await supabase.from('warehouse_type_configs')
          .select('*').eq('warehouse_id', src).limit(200)
        // Chỉ bê phần CẤU HÌNH — id/warehouse_id/created_at của kho mẫu bê sang là ghi đè nhầm kho
        for (const r of rows ?? []) {
          const row = r as Record<string, unknown>
          const out: Record<string, unknown> = {}
          if (row.sort_order != null) out.sort_order = row.sort_order   // copy cả thứ tự đã sắp riêng
          for (const k of [...WH_TYPE_CFG_COLS, ...WH_TYPE_META_COLS]) if (row[k] != null) out[k] = row[k]
          srcCfg.set(String(row.type_code), out)
        }
      }
      const seed = [...await listWhTypeCodes()].map(type_code => ({ type_code, ...(srcCfg.get(type_code) ?? {}) }))
      if (seed.length) {
        const { error: seedErr } = await supabase.from('warehouse_type_configs').insert(
          seed.map(r => ({ id: randomUUID(), warehouse_id: newId, ...r, updated_at: nowIso, updated_by: actor })))
        // Bảng chưa apply migration → tạo kho vẫn thành công (không chặn nghiệp vụ vì cấu hình)
        if (seedErr) console.error('seed warehouse_type_configs:', seedErr.message)
      }
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function updateWarehouse(req: Request, res: Response) {
  try {
    const { name, address, is_active, warehouse_type, inventory_mode, shipto_codes, nmsx_code, parent_warehouse_id, carton_scan_override, carton_scan_categories, carton_scan_require_full, sap_plant, sap_storage_locations, require_weigh_on_start, require_gate_on_start, rotation_principle, rotation_required } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (sap_plant !== undefined)             patch.sap_plant = normSapPlant(sap_plant)
    if (sap_storage_locations !== undefined) patch.sap_storage_locations = normSapSlocs(sap_storage_locations)
    if (require_weigh_on_start !== undefined) patch.require_weigh_on_start = Boolean(require_weigh_on_start)   // rule 2: cân khi Bắt đầu xuất (20260801)
    if (require_gate_on_start !== undefined)  patch.require_gate_on_start  = Boolean(require_gate_on_start)    // rule 1: đăng ký cổng khi Bắt đầu xuất (20260801c)
    if (rotation_principle !== undefined)     patch.rotation_principle     = asRotationPrinciple(rotation_principle)   // FEFO/FIFO/LIFO (20260814c)
    if (rotation_required !== undefined)      patch.rotation_required      = Boolean(rotation_required)                // true = CHẶN quét sai thứ tự
    const putErr = applyPutawayBody(req.body, patch)                                                                   // quy tắc CẤT hàng (20260815d)
    if (putErr) return fail(res, 422, 'INVALID_INPUT', putErr)
    if (carton_scan_override !== undefined) patch.carton_scan_override = carton_scan_override === null ? null : Boolean(carton_scan_override)
    if (carton_scan_categories !== undefined) patch.carton_scan_categories = normCartonCats(carton_scan_categories)
    if (carton_scan_require_full !== undefined) patch.carton_scan_require_full = Boolean(carton_scan_require_full)
    if (name !== undefined) patch.name = String(name).trim()
    if (address !== undefined) patch.address = address
    if (is_active !== undefined) patch.is_active = Boolean(is_active)
    if (nmsx_code !== undefined) {
      const nmsx = normNmsx(nmsx_code)
      const nmsxClash = await findNmsxClash(nmsx, req.params.id)
      if (nmsxClash) return fail(res, 409, 'DUPLICATE', `Mã NMSX "${nmsxClash}" đã thuộc kho khác`)
      patch.nmsx_code = nmsx
    }
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
    if (parent_warehouse_id !== undefined) {
      const parentId = parent_warehouse_id ? String(parent_warehouse_id) : null
      const parentErr = await validateParent(parentId, req.params.id)
      if (parentErr) return fail(res, 400, 'VALIDATION_ERROR', parentErr)
      patch.parent_warehouse_id = parentId
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

    let { data, error } = await supabase
      .from('Warehouse').update(patch).eq('id', req.params.id).select().maybeSingle()
    // Cột carton_scan_* chưa apply migration → bỏ các cột đó rồi thử lại (không chặn sửa kho)
    if (error && /carton_scan/i.test(error.message)) {
      delete patch.carton_scan_override; delete patch.carton_scan_categories; delete patch.carton_scan_require_full
      ;({ data, error } = await supabase.from('Warehouse').update(patch).eq('id', req.params.id).select().maybeSingle())
    }
    if (error) throw error
    // Quy tắc cất hàng đọc cấu hình kho qua cache 30s (đường quét là hot-path) — lưu form xong
    // phải xoá cache ngay, không thì user tick "bắt buộc" mà lượt quét kế vẫn lọt qua.
    invalidatePutawayConfig(req.params.id)
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── LOẠI KHO MỖI KHO VẬN HÀNH + chiến thuật riêng theo loại (21/08) ────────
// Sự tồn tại của dòng = "kho này vận hành loại này"; cột chiến thuật NULL = kế thừa mặc định kho.
const WTC_SELECT = `id, type_code, sort_order, is_ncc_goods, requires_ncc, batch_char, ${WH_TYPE_CFG_COLS.join(', ')}`

// Thứ tự RIÊNG của kho (kéo-thả ở tab Loại kho). NULL = chưa sắp riêng → xuống cuối, xếp theo mã.
const wtcOrdered = (whId: string) => supabase.from('warehouse_type_configs')
  .select(WTC_SELECT).eq('warehouse_id', whId)
  .order('sort_order', { ascending: true, nullsFirst: false }).order('type_code').limit(200)

async function listWhTypeCodes(): Promise<Set<string>> {
  const rows = await fetchAllRowsParallel(() =>
    supabase.from('LookupValue').select('value').eq('type', 'warehouse_type').order('value'))
  return new Set((rows ?? []).map(r => String((r as { value: string }).value)))
}

export async function getWarehouseTypeConfigs(req: Request, res: Response) {
  try {
    const { data, error } = await wtcOrdered(req.params.id)
    if (error) throw error
    ok(res, data ?? [])
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function putWarehouseTypeConfigs(req: Request, res: Response) {
  try {
    const whId = req.params.id
    const items = req.body?.items
    if (!Array.isArray(items)) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu danh sách loại kho (items)')

    const { data: wh } = await supabase.from('Warehouse').select('id').eq('id', whId).maybeSingle()
    if (!wh) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')

    const known = await listWhTypeCodes()
    const scope = scopeCategoriesOf(req)     // null = full quyền loại
    // Thứ tự riêng hiện có — client KHÔNG gửi `sort_order` thì GIỮ NGUYÊN (khác các cột chiến thuật:
    // ở đó "vắng mặt = bỏ khai riêng"). Thứ tự chỉ là cách bày, không phải luật chạy, nên đừng để
    // một lượt lưu chiến thuật của client cũ xoá trắng công sắp xếp.
    const { data: prev } = await supabase.from('warehouse_type_configs')
      .select('type_code, sort_order').eq('warehouse_id', whId).limit(500)
    const prevOrder = new Map((prev ?? []).map(r => {
      const row = r as { type_code: string; sort_order: number | null }
      return [row.type_code, row.sort_order]
    }))
    const rows: Record<string, unknown>[] = []
    const seen = new Set<string>()
    for (const raw of items as Record<string, unknown>[]) {
      const code = String(raw?.type_code ?? '').trim()
      if (!code) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu mã loại kho')
      if (!known.has(code)) return fail(res, 400, 'VALIDATION_ERROR', `Loại kho "${code.slice(0, 30)}" không có trong danh mục`)
      if (seen.has(code)) return fail(res, 400, 'VALIDATION_ERROR', `Loại kho "${code}" bị khai trùng`)
      seen.add(code)
      // User chỉ có scope một số loại thì không được ĐỘNG tới loại ngoài scope (cả thêm lẫn bớt) —
      // cùng tinh thần khung giờ cargo ALL. Dòng ngoài scope được giữ nguyên ở dưới.
      if (!categoryAllowed(req, code))
        return fail(res, 403, 'FORBIDDEN', `Bạn không có quyền với Loại kho "${code}"`)
      // Field KHÔNG gửi lên = "không khai riêng" ⇒ phải ghi NULL, không được giữ giá trị cũ.
      // ⚠️ PostgREST dựng câu INSERT/UPSERT từ HỢP các key có trong payload: cột vắng mặt sẽ không
      // nằm trong `DO UPDATE SET` nên override cũ SỐNG SÓT — gỡ trên form xong luật vẫn chạy, không
      // lỗi, không cảnh báo (gói QA 29 mục [4] bắt được đúng ca này). Nên khởi tạo NULL đủ mọi cột.
      const patch: Record<string, unknown> = Object.fromEntries(
        [...WH_TYPE_CFG_COLS, ...WH_TYPE_META_COLS].map(k => [k, null]))
      const err = applyWhTypeConfigBody(raw, patch)
      if (err) return fail(res, 422, 'INVALID_INPUT', `${code}: ${err}`)
      // 3 cờ VẬN HÀNH khai riêng theo kho (21/08) — null/'' = theo danh mục chung
      for (const k of ['is_ncc_goods', 'requires_ncc'] as const) {
        if (raw[k] === undefined || raw[k] === null || raw[k] === '') continue
        patch[k] = Boolean(raw[k])
      }
      if (raw.batch_char !== undefined && raw.batch_char !== null && raw.batch_char !== '') {
        const bc = String(raw.batch_char).trim().toUpperCase()
        if (!/^[A-Z0-9]$/.test(bc))
          return fail(res, 422, 'INVALID_INPUT', `${code}: Ký tự mã lô phải là 1 chữ cái hoặc số`)
        patch.batch_char = bc
      }
      let ord = prevOrder.get(code) ?? null
      if (raw.sort_order !== undefined) {
        if (raw.sort_order === null || raw.sort_order === '') ord = null
        else {
          const n = Number(raw.sort_order)
          if (!Number.isInteger(n) || n < 0 || n > 9999)
            return fail(res, 422, 'INVALID_INPUT', `${code}: Thứ tự phải là số nguyên 0–9999`)
          ord = n
        }
      }
      rows.push({ type_code: code, sort_order: ord, ...patch })
    }

    const { data: cur } = await supabase.from('warehouse_type_configs')
      .select('id, type_code').eq('warehouse_id', whId).limit(500)
    const curById = new Map((cur ?? []).map(r => {
      const row = r as { id: string; type_code: string }
      return [row.type_code, row.id]
    }))

    const now = new Date().toISOString()
    const actor = req.user?.name || null
    // Ghi theo LÔ (insert nhiều dòng / delete theo danh sách id) — không vòng lặp per-row.
    const toInsert = rows.filter(r => !curById.has(String(r.type_code)))
      .map(r => ({ id: randomUUID(), warehouse_id: whId, ...r, updated_at: now, updated_by: actor }))
    const toUpdate = rows.filter(r => curById.has(String(r.type_code)))
    // KHÔNG xoá dòng nào: từ 21/08 mọi kho đều có mọi loại kho, không còn thao tác "gỡ loại khỏi
    // kho". Client gửi thiếu loại (bản cũ / lưu một phần) thì giữ nguyên phần còn lại, không dọn.
    // Bỏ loại kho khỏi hệ thống = xoá ở DANH MỤC (deleteLookup dọn cascade cả bảng này).

    if (toInsert.length) {
      const { error } = await supabase.from('warehouse_type_configs').insert(toInsert)
      if (error) throw error
    }
    // Cập nhật: mỗi dòng một giá trị khác nhau → upsert theo khoá chính (lô, không update lẻ)
    if (toUpdate.length) {
      const payload = toUpdate.map(r => ({
        id: curById.get(String(r.type_code)), warehouse_id: whId, ...r, updated_at: now, updated_by: actor,
      }))
      const { error } = await supabase.from('warehouse_type_configs').upsert(payload, { onConflict: 'id' })
      if (error) throw error
    }

    // Luồng quét đọc cấu hình qua cache 30s → xoá ngay, không thì lưu form xong lượt quét kế vẫn
    // chạy chiến thuật cũ (cùng lý do với updateWarehouse).
    invalidatePutawayConfig(whId)
    const { data } = await wtcOrdered(whId)
    ok(res, data ?? [])
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
