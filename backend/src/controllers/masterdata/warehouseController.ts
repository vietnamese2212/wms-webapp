import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel } from '../../utils/pagination'
import { parseListParam } from '../../utils/httpQuery'
import { asRotationPrinciple } from '../../utils/rotation'
import { applyPutawayBody, applyWhTypeConfigBody, WH_TYPE_CFG_COLS } from '../../utils/putaway'
import { WH_TYPE_META_COLS, invalidateWhTypeMetaCache } from '../../utils/warehouseTypeMeta'
import { invalidatePutawayConfig } from '../../services/putawayContext'
import { scopeCategoriesOf, categoryAllowed } from '../../utils/categoryScope'
import { warehouseTypeUsage } from '../wms/lookupController'
import { asDateRulePolicy } from '../../services/dateRulePolicy'

const INVENTORY_MODES = ['QR', 'QTY', 'QTY_DATE', 'NONE'] as const

// Loại mã camera được phép giải ở kho (20260821e). Kho chỉ dùng tem QR đặt 'QR' thì camera KHÔNG
// giải mã vạch 1D nữa — chặn tận gốc lớp "đọc sai ra số không có thật" của 1D (không có mã sửa lỗi).
// DB có CHECK cùng danh sách; giá trị lạ → về 'BOTH' (mặc định = hành vi đang chạy, không đổi ngầm).
const SCAN_CODE_TYPES = ['QR', 'BARCODE', 'BOTH'] as const
function asScanCodeTypes(v: unknown): string {
  const s = String(v ?? '').toUpperCase().trim()
  return (SCAN_CODE_TYPES as readonly string[]).includes(s) ? s : 'BOTH'
}

function extractCount(arr: unknown): number {
  if (Array.isArray(arr) && arr.length > 0) return (arr[0] as { count: number }).count ?? 0
  return 0
}

// Chuẩn hoá danh sách ship-to phụ: nhận mảng hoặc chuỗi "A, B" → mảng mã UPPER, bỏ trùng/rỗng.
function normShiptoCodes(input: unknown): string[] {
  return [...new Set((parseListParam(input) ?? []).map(s => s.toUpperCase()))]
}

// Ship-to phụ nay ĐẺ RA dòng trong danh mục Khách hàng, mà bảng đó có CHECK `^[A-Z0-9]+$` (≤ 50).
// Hai cửa phải cùng một luật: không siết ở đây thì gõ "ABC-1" lưu được vào Kho rồi chết 23514 lúc
// đồng bộ. Siết bây giờ không mất gì — đo 11/09: 0/153 kho đang khai cột này.
function invalidShipto(codes: string[]): string | null {
  return codes.find(c => !/^[A-Z0-9]+$/.test(c) || c.length > 50) ?? null
}

/**
 * SHIP-TO PHỤ CỦA KHO ⇄ DANH MỤC KHÁCH HÀNG — hai cửa của MỘT sổ (đợt 2, §8 plan).
 *
 * `warehouseByShipto` tra danh mục Khách hàng TRƯỚC rồi mới tới `Warehouse.code`/`shipto_codes`.
 * Khai ship-to phụ ở form Kho mà danh mục không biết ⇒ cùng một sự thật nằm hai nơi, và trang
 * Khách hàng nói "khách ngoài" trong khi luật chuyển kho coi đó là kho nhà. Nay khai ở form Kho là
 * danh mục tự có dòng trỏ về kho đó.
 */
async function shiptoCustomerClash(codes: string[], whId: string | null): Promise<string | null> {
  if (!codes.length) return null
  for (let i = 0; i < codes.length; i += 300) {   // `.in()` nằm trên URL — chunk 300
    let q = supabase.from('Customer')
      .select('ship_to_code, warehouse:Warehouse!warehouse_id(name)')
      .in('ship_to_code', codes.slice(i, i + 300))
      .not('warehouse_id', 'is', null)
    if (whId) q = q.neq('warehouse_id', whId)
    const { data } = await q
    // PostgREST trả embed dạng MẢNG (kiểu sinh từ schema cũng vậy) — lấy phần tử đầu
    const hit = ((data ?? []) as { ship_to_code: string; warehouse: { name: string }[] | null }[])[0]
    if (hit)
      return `Mã ship-to "${hit.ship_to_code}" đang trỏ về kho "${hit.warehouse?.[0]?.name ?? '?'}" trong danh mục Khách hàng — gỡ ở đó trước rồi khai lại.`
  }
  return null
}

/**
 * Đồng bộ danh mục Khách hàng theo ship-to phụ vừa lưu.
 * Thêm mã → khách đã có thì CHỈ trỏ kho (tên/kênh/mức của người khai luôn thắng), chưa có thì tạo.
 * Bớt mã → **gỡ liên kết, KHÔNG xoá khách**: khách có thể đang mang kênh, mức date, ghi chú do
 * người khai — xoá là mất thứ không dựng lại được, trong khi thứ cần bỏ chỉ là "kho nhận là ai".
 *
 * Chạy SAU khi ghi Kho thành công (PostgREST không có giao dịch bắc cầu 2 bảng). Hỏng ở đây thì
 * lỗi nổi lên 500 chứ không nuốt — và luật chuyển kho vẫn chạy đúng nhờ bậc 2 đọc thẳng
 * `Warehouse.shipto_codes`, nên trạng thái dở dang không làm sai nghiệp vụ, chỉ cần lưu lại.
 */
async function syncShiptoCustomers(
  whId: string, whName: string, before: string[], after: string[], actor: string | null,
): Promise<void> {
  const add = after.filter(c => !before.includes(c))
  const drop = before.filter(c => !after.includes(c))
  if (!add.length && !drop.length) return
  const t = new Date().toISOString()

  if (add.length) {
    const have = new Set<string>()
    for (let i = 0; i < add.length; i += 300) {
      const { data } = await supabase.from('Customer')
        .select('ship_to_code').in('ship_to_code', add.slice(i, i + 300))
      for (const c of ((data ?? []) as { ship_to_code: string }[])) have.add(c.ship_to_code)
    }
    const upd = add.filter(c => have.has(c))
    for (let i = 0; i < upd.length; i += 300) {
      const { error } = await supabase.from('Customer')
        .update({ warehouse_id: whId, updated_by: actor, updated_at: t })
        .in('ship_to_code', upd.slice(i, i + 300))
      if (error) throw new Error(error.message)
    }
    const fresh = add.filter(c => !have.has(c))
    for (let i = 0; i < fresh.length; i += 300) {   // 300: câu UPDATE bù dưới đây lọc trên URL
      // Đua với `ensureCustomers` của upload Kế hoạch xuất (cũng tự tạo khách theo ship-to lạ):
      // người thua nhường (ignoreDuplicates), rồi câu UPDATE bù trỏ kho cho dòng vừa có.
      const { error } = await supabase.from('Customer').upsert(
        fresh.slice(i, i + 300).map(code => ({
          id: randomUUID(), ship_to_code: code, name: whName, warehouse_id: whId,
          auto_created: true, is_active: true,
          created_by: actor, updated_by: actor, created_at: t, updated_at: t,
        })), { onConflict: 'ship_to_code', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
      const { error: e2 } = await supabase.from('Customer')
        .update({ warehouse_id: whId, updated_by: actor, updated_at: t })
        .is('warehouse_id', null).in('ship_to_code', fresh.slice(i, i + 300))
      if (e2) throw new Error(e2.message)
    }
  }

  for (let i = 0; i < drop.length; i += 300) {
    const { error } = await supabase.from('Customer')
      .update({ warehouse_id: null, updated_by: actor, updated_at: t })
      .eq('warehouse_id', whId).in('ship_to_code', drop.slice(i, i + 300))
    if (error) throw new Error(error.message)
  }
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
    const { code, name, address, warehouse_type, inventory_mode, shipto_codes, nmsx_code, parent_warehouse_id, carton_scan_override, carton_scan_categories, carton_scan_require_full, sap_plant, sap_storage_locations, require_weigh_on_start, require_gate_on_start, rotation_principle, rotation_required, scan_code_types, separate_lowering_forklift } = req.body
    if (!code || !name) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code hoặc name')
    if (!warehouse_type || !['CENTRAL', 'NPP'].includes(warehouse_type))
      return fail(res, 400, 'VALIDATION_ERROR', 'Chức năng kho không hợp lệ (CENTRAL hoặc NPP)')
    const mode = inventory_mode ?? 'QR'
    if (!INVENTORY_MODES.includes(mode))
      return fail(res, 400, 'VALIDATION_ERROR', 'Chế độ quản tồn không hợp lệ (QR, QTY hoặc NONE)')

    const shiptoArr = normShiptoCodes(shipto_codes)
    const badShipto = invalidShipto(shiptoArr)
    if (badShipto) return fail(res, 400, 'VALIDATION_ERROR', `Mã ship-to "${badShipto}" không hợp lệ — chỉ chữ IN HOA và số, tối đa 50 ký tự`)
    const clash = await findShiptoClash(shiptoArr, String(code))
    if (clash) return fail(res, 409, 'DUPLICATE', `Mã ship-to "${clash}" đã thuộc kho khác`)
    const custClash = await shiptoCustomerClash(shiptoArr, null)
    if (custClash) return fail(res, 409, 'DUPLICATE', custClash)
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
    if (separate_lowering_forklift !== undefined) row.separate_lowering_forklift = Boolean(separate_lowering_forklift)   // kho có xe hạ riêng? (20260912f)
    if (rotation_principle !== undefined)     row.rotation_principle     = asRotationPrinciple(rotation_principle)   // FEFO/FIFO/LIFO (20260814c)
    if (rotation_required !== undefined)      row.rotation_required      = Boolean(rotation_required)                // true = CHẶN quét sai thứ tự
    if (scan_code_types !== undefined)        row.scan_code_types        = asScanCodeTypes(scan_code_types)          // QR | BARCODE | BOTH (20260821e)
    if (req.body.date_rule_policy !== undefined) row.date_rule_policy = asDateRulePolicy(req.body.date_rule_policy)   // %Date theo Khách hàng/Kênh (20260911)
    const putErr = applyPutawayBody(req.body, row)                                                                   // quy tắc CẤT hàng (20260815d)
    if (putErr) return fail(res, 422, 'INVALID_INPUT', putErr)
    // Kho MỚI chưa thể có bản vẽ ⇒ chưa bật Hướng dẫn được (tính đường đi cần lưới Sơ đồ kho)
    if (row.work_mode === 'GUIDED')
      return fail(res, 422, 'GUIDED_PREREQ', 'Chưa bật "Hướng dẫn" cho kho vừa tạo được: cần vẽ Sơ đồ kho trước (Kho WMS → Sơ đồ kho), rồi bật trong form Kho.')
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
      // Ship-to phụ khai lúc TẠO kho cũng phải vào danh mục Khách hàng (cùng luật với lúc sửa)
      if (shiptoArr.length) await syncShiptoCustomers(newId, String(name).trim(), [], shiptoArr, actor)
    }
    ok(res, data)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// Chống IDOR (kiểm định 02/09): route GHI theo :id kho phải kiểm kho ∈ phạm vi người gọi — không thì tài khoản
// ASSIGNED có manage_warehouse tắt được rule cổng/cân, is_active, chiến thuật loại kho… của kho KHÁC. Đọc kho
// vẫn hở chủ đích (Header + nhiều trang cross-module). Không có ngoại lệ "chưa gán kho thì cho qua" (cùng luật
// guardEntryWh của Dồn/Tách + emptyScopeError của hồ sơ nhân sự).
function guardWarehouseScope(req: Request, res: Response, warehouseId: string): boolean {
  if (req.user?.is_superadmin === true || req.user?.warehouse_scope === 'NATIONAL') return true
  if ((req.user?.warehouse_ids ?? []).includes(warehouseId)) return true
  fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được phân quyền')
  return false
}

export async function updateWarehouse(req: Request, res: Response) {
  try {
    if (!guardWarehouseScope(req, res, req.params.id)) return
    const { name, address, is_active, warehouse_type, inventory_mode, shipto_codes, nmsx_code, parent_warehouse_id, carton_scan_override, carton_scan_categories, carton_scan_require_full, sap_plant, sap_storage_locations, require_weigh_on_start, require_gate_on_start, rotation_principle, rotation_required, scan_code_types, separate_lowering_forklift } = req.body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    if (sap_plant !== undefined)             patch.sap_plant = normSapPlant(sap_plant)
    if (sap_storage_locations !== undefined) patch.sap_storage_locations = normSapSlocs(sap_storage_locations)
    if (require_weigh_on_start !== undefined) patch.require_weigh_on_start = Boolean(require_weigh_on_start)   // rule 2: cân khi Bắt đầu xuất (20260801)
    if (require_gate_on_start !== undefined)  patch.require_gate_on_start  = Boolean(require_gate_on_start)    // rule 1: đăng ký cổng khi Bắt đầu xuất (20260801c)
    if (separate_lowering_forklift !== undefined) patch.separate_lowering_forklift = Boolean(separate_lowering_forklift)   // kho có xe hạ riêng? (20260912f)
    if (rotation_principle !== undefined)     patch.rotation_principle     = asRotationPrinciple(rotation_principle)   // FEFO/FIFO/LIFO (20260814c)
    if (rotation_required !== undefined)      patch.rotation_required      = Boolean(rotation_required)                // true = CHẶN quét sai thứ tự
    if (scan_code_types !== undefined)        patch.scan_code_types        = asScanCodeTypes(scan_code_types)          // QR | BARCODE | BOTH (20260821e)
    const putErr = applyPutawayBody(req.body, patch)                                                                   // quy tắc CẤT hàng (20260815d)
    if (putErr) return fail(res, 422, 'INVALID_INPUT', putErr)
    // ĐIỀU KIỆN bật "Hướng dẫn" (Directed Work 1c): kế hoạch lấy hàng ghim TEM PALLET và tính đường
    // đi trên lưới ⇒ kho phải quản theo tem QR và đã vẽ Sơ đồ kho. Bật mà thiếu nền thì mỗi lần Bắt
    // đầu chuyến chỉ sinh ra cảnh báo — thà nói thẳng ở đây, đúng chỗ người bật cờ đang đứng.
    if (patch.work_mode === 'GUIDED') {
      const [{ data: whNow }, { data: mapNow }] = await Promise.all([
        supabase.from('Warehouse').select('inventory_mode').eq('id', req.params.id).maybeSingle(),
        supabase.from('warehouse_maps').select('warehouse_id').eq('warehouse_id', req.params.id).maybeSingle(),
      ])
      const modeNow = (inventory_mode as string | undefined) ?? (whNow as { inventory_mode?: string | null } | null)?.inventory_mode
      if (modeNow !== 'QR')
        return fail(res, 422, 'GUIDED_PREREQ', 'Chỉ bật "Hướng dẫn" cho kho quản theo TEM QR — kho tính theo số lượng chưa biết pallet nằm ô nào.')
      if (!mapNow)
        return fail(res, 422, 'GUIDED_PREREQ', 'Kho này chưa có Sơ đồ kho — vẽ khung + đặt vị trí ở Kho WMS → Sơ đồ kho rồi mới bật "Hướng dẫn".')
    }
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
    // Ship-to phụ: đổi ở đây là đổi cả danh mục Khách hàng (xem `syncShiptoCustomers`). Tính sẵn
    // "trước → sau" ở đây, còn ghi Customer thì để SAU khi câu UPDATE Kho thành công.
    let shiptoPlan: { before: string[]; after: string[]; name: string } | null = null
    if (shipto_codes !== undefined) {
      const shiptoArr = normShiptoCodes(shipto_codes)
      const badShipto = invalidShipto(shiptoArr)
      if (badShipto) return fail(res, 400, 'VALIDATION_ERROR', `Mã ship-to "${badShipto}" không hợp lệ — chỉ chữ IN HOA và số, tối đa 50 ký tự`)
      const { data: cur } = await supabase.from('Warehouse')
        .select('code, name, shipto_codes').eq('id', req.params.id).maybeSingle()
      const w = (cur as { code?: string; name?: string; shipto_codes?: string[] | null } | null)
      const clash = await findShiptoClash(shiptoArr, w?.code ?? '', req.params.id)
      if (clash) return fail(res, 409, 'DUPLICATE', `Mã ship-to "${clash}" đã thuộc kho khác`)
      const custClash = await shiptoCustomerClash(shiptoArr, req.params.id)
      if (custClash) return fail(res, 409, 'DUPLICATE', custClash)
      patch.shipto_codes = shiptoArr
      shiptoPlan = {
        before: normShiptoCodes(w?.shipto_codes ?? []),
        after: shiptoArr,
        name: String(patch.name ?? w?.name ?? '').trim() || (w?.code ?? ''),
      }
    }
    if (warehouse_type !== undefined) {
      if (!['CENTRAL', 'NPP'].includes(warehouse_type))
        return fail(res, 400, 'VALIDATION_ERROR', 'Chức năng kho không hợp lệ')
      patch.warehouse_type = warehouse_type
    }
    // %Date theo Khách hàng / Kênh (20260911) — bật ở đây KHÔNG áp ngược cho đơn đang mở; muốn áp
    // thì bấm "Áp lại theo master" ở trang Chốt %Date (xem services/dateRulePolicy.ts).
    if (req.body.date_rule_policy !== undefined) patch.date_rule_policy = asDateRulePolicy(req.body.date_rule_policy)
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
    if (shiptoPlan)
      await syncShiptoCustomers(req.params.id, shiptoPlan.name, shiptoPlan.before, shiptoPlan.after, req.user?.name || null)
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

// Các dòng CÓ khai riêng 3 cờ vận hành — của MỌI kho, một lời gọi.
// Vì sao cần đường này khi đã có `/warehouses/:id/type-configs`: màn In tem in theo LỆNH IN, một
// lệnh gồm tem của NHIỀU kho (Lịch sử in không có filter kho) ⇒ không hỏi được "cờ của kho đang
// chọn". Quy mô bị chặn bởi SỐ KHAI RIÊNG (cấu hình — hôm nay 0), không tăng theo dữ liệu nghiệp vụ.
export async function listWhTypeFlagOverrides(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase.from('warehouse_type_configs')
      .select('warehouse_id, type_code, is_ncc_goods, requires_ncc, batch_char')
      .or('is_ncc_goods.not.is.null,requires_ncc.not.is.null,batch_char.not.is.null')
      .order('warehouse_id').order('type_code').limit(5000)
    if (error) throw error
    ok(res, data ?? [])
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function putWarehouseTypeConfigs(req: Request, res: Response) {
  try {
    const whId = req.params.id
    if (!guardWarehouseScope(req, res, whId)) return
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
    // 3 cờ VẬN HÀNH đi qua cache RIÊNG (`warehouseTypeMeta._whCache`) — thiếu dòng này thì bật
    // "bắt buộc NCC" cho kho xong lượt quét kế vẫn cho qua, không lỗi không cảnh báo (QA 29 [12b]
    // bắt được đúng ca này).
    invalidateWhTypeMetaCache()
    const { data } = await wtcOrdered(whId)
    ok(res, data ?? [])
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function deleteWarehouse(req: Request, res: Response) {
  try {
    const id = req.params.id
    if (!guardWarehouseScope(req, res, id)) return

    // Kiểm tra có location nào chưa (kể cả đã soft-delete)
    const [locRes, piRes] = await Promise.all([
      supabase.from('Location').select('*', { count: 'exact', head: true }).eq('warehouse_id', id),
      supabase.from('ProductionImport').select('*', { count: 'exact', head: true }).eq('warehouse_id', id),
    ])
    if (locRes.error) throw locRes.error
    if (piRes.error)  throw piRes.error

    const hasRefs = (locRes.count ?? 0) > 0 || (piRes.count ?? 0) > 0

    if (!hasRefs) {
      // Không có dữ liệu liên quan → xóa vĩnh viễn. `.select()` để phân biệt "đã xoá" với "chẳng
      // có gì để xoá": nhánh vô hiệu hoá bên dưới đã kiểm 404, nhánh này thì chưa nên kho KHÔNG CÓ
      // THẬT vẫn nhận được thông báo xoá thành công.
      const { data: gone, error } = await supabase.from('Warehouse').delete().eq('id', id).select('id')
      if (error) throw error
      if (!gone?.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho — có thể đã bị xoá trước đó')
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
