/**
 * DÒNG XE CON (`vehicle_model`) — user chốt 23/09/2026 (plan TMS_DISPATCH mục 5.3):
 * "Các dòng xe hiện tại trở thành CHA, dưới cha có nhiều dòng CON — ở đó mới có mã SAP, tên dòng xe.
 *  Kho chỉ quan tâm dòng cha để booking, đăng ký xe; chỉ điều vận mới quan tâm dòng con để làm shipment, ghép chuyến."
 *
 * CHA = `VehicleType` (7 mã, giữ nguyên — controller vehicleTypeController). CON mang `sap_code` 9100000xx, sức chứa, điểm giao,
 * đơn vị tính cước. Quyền dùng lại module `tms_vehicle_types` (tab "Mã dòng xe" ở Cài đặt TMS) — cha con là một danh mục.
 *
 * 02–03/10 (user): (1) tạo dòng con BẮT BUỘC có cha + điều kiện bảo quản + sức chứa theo đúng thước đo đã chọn — thiếu thì 400,
 * không còn "chưa gán cha / chưa khai ĐK = chở mọi điều kiện" cho dòng MỚI (dòng cũ thiếu vẫn hiện băng cảnh báo, sửa phần
 * nào thì phần đó phải đủ). (2) Ô "Non tải dưới %" và "m³ tối đa" BỎ (bàn điều vận có dải tải theo cha của kho; m³ không luật
 * nào đọc). (3) DÒNG XE THEO KHO: master data CHỈ ở bản Chung ("thêm dòng xe thì bắt buộc thêm ở Chung, không cho master data
 * khác nhau ở các kho"); kho chỉ cấu hình riêng dùng/không + sức chứa + điểm giao (`warehouse_vehicle_model`, services/vehicleModelScope).
 */
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { z, zText, zId, zBool } from '../../middlewares/validate'
import { applyWarehouseOverrides, loadWarehouseOverrides, multiVehicleOf } from '../../services/vehicleModelScope'
import type { Database } from '../../types/database'

type VehicleModelRow = Database['public']['Tables']['vehicle_model']['Row']
type VehicleModelInsert = Database['public']['Tables']['vehicle_model']['Insert']

export const TEMP_MODES = ['HOT', 'COLD', 'MIXED', 'DRY'] as const
export const CAPACITY_MODES = ['PALLET', 'TON'] as const
export const TARIFF_UNITS = ['PER_PALLET', 'PER_TRIP'] as const

const zPosInt = z.number().int().positive()
const zPosNum = z.number().finite().positive()
const nullable = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional()

/** Thân chung Thêm / Sửa. KHÔNG `.strict()`: client (và bộ QA) gửi kèm cờ chung `qty_semantics` — zod mặc định bỏ khoá lạ
 *  (nên `underload_pct` / `max_m3` của bundle cũ cũng chỉ bị bỏ, không 400). */
const vehicleModelBody = {
  name:               zText(1, 160),
  parent_type_id:     zId,
  temp_mode:          nullable(z.enum(TEMP_MODES)),
  // Điều kiện bảo quản xe chở được (mã trong LookupValue type='storage_condition') — 02/10: BẮT BUỘC ≥ 1 khi tạo / khi sửa ô này
  storage_conditions: z.array(zText(1, 40)).min(1, 'Phải chọn ít nhất một điều kiện bảo quản').max(20),
  capacity_mode:      z.enum(CAPACITY_MODES),
  max_pallets:        nullable(zPosInt),
  max_tons:           nullable(zPosNum),
  max_drops:          nullable(zPosInt),
  // 07/10 — ghép nhiều xe trên một thẻ: null = theo loại xe cha
  allow_multi_vehicle: zBool.nullable(),
  allow_mix_channels: zBool,
  tariff_unit:        z.enum(TARIFF_UNITS),
  is_active:          zBool,
  sort_order:         z.number().int().min(0),
  // Luật 8 điều vận (25/09) — BỎ 28/09: engine không đọc nữa; form không gửi, giữ để bundle cũ không 400
  dispatch_use:       z.enum(['ALL', 'TRANSFER']),
}
export const zVehicleModelCreate = z.object({ sap_code: zText(1, 20), ...vehicleModelBody }).partial({
  temp_mode: true, max_pallets: true, max_tons: true, max_drops: true, allow_multi_vehicle: true,
  allow_mix_channels: true, tariff_unit: true, is_active: true, sort_order: true, dispatch_use: true,
})
export const zVehicleModelUpdate = z.object(vehicleModelBody).partial()
export const zAssignParent = z.object({ ids: z.array(zId).min(1).max(200), parent_type_id: zId })   // 02/10: không còn "gỡ cha" — cha bắt buộc
export const zAssignConditions = z.object({ ids: z.array(zId).min(1).max(200), storage_conditions: z.array(zText(1, 40)).min(1).max(20) })
export const zVehicleModelListQuery = z.object({
  parent_type_id: zId.optional(), unassigned: z.string().optional(), is_active: z.enum(['true', 'false']).optional(),
  warehouse_id: zId.optional(),   // 03/10: trả giá trị ĐANG HIỆU LỰC tại kho + cờ wh_override
})
/** Cấu hình riêng của kho cho một dòng xe — RIÊNG THEO TỪNG Ô (03/10 chiều): gửi ô nào thì ghi ô đó; `null` = ô đó VỀ THEO CHUNG;
 *  không gửi = giữ nguyên. Master data không vào đây. */
export const zWarehouseModelBody = z.object({
  is_active:   zBool.nullable().optional(),
  max_pallets: nullable(zPosInt),
  max_tons:    nullable(zPosNum),
  max_drops:   nullable(zPosInt),
  allow_multi_vehicle: zBool.nullable().optional(),
})
export const zWarehouseModelParams = z.object({ id: zId, warehouse_id: zId })

/** Sức chứa theo thước đo: đo bằng gì thì ô đó phải có số (02/10, user: "đo tải bằng gì kê khai bằng đó là bắt buộc"). */
function capacityError(mode: string, maxPallets: number | null | undefined, maxTons: number | null | undefined): string | null {
  if (mode === 'PALLET' && !(Number(maxPallets) > 0)) return 'Đo tải bằng Pallet thì phải khai "Pallet tối đa"'
  if (mode === 'TON' && !(Number(maxTons) > 0)) return 'Đo tải bằng Tấn thì phải khai "Tấn tối đa"'
  return null
}
/** Mã điều kiện bảo quản phải CÓ TRONG DANH MỤC — khai mã lạ thì engine loại dòng xe đó khỏi mọi chuyến mà không ai hiểu vì sao. */
async function unknownConditions(codes: string[]): Promise<string[]> {
  const want = [...new Set(codes.filter(Boolean))]
  if (!want.length) return []
  const { data, error } = await db.from('LookupValue').select('value').eq('type', 'storage_condition')
  if (error) throw error
  const have = new Set((data ?? []).map(r => r.value))
  return want.filter(c => !have.has(c))
}
/** Cha phải là VehicleType có thật — gán vào id rác thì dòng con "có cha" mà kho không đặt được khung giờ nào. */
async function parentExists(id: string): Promise<boolean> {
  const { data } = await db.from('VehicleType').select('id').eq('id', id).maybeSingle()
  return !!data
}
/** Phạm vi kho của người gọi (như điều vận): superadmin / NATIONAL = mọi kho; còn lại chỉ kho được gán. */
function scopeWhIds(req: Request): string[] | null {
  return req.user?.is_superadmin === true || req.user?.warehouse_scope === 'NATIONAL' ? null : (req.user?.warehouse_ids ?? [])
}

// GET /tms/vehicle-models?parent_type_id=&unassigned=1&is_active=true&warehouse_id=
// Danh mục nhỏ (≤ ~60 dòng) — một lời gọi, kèm cha (code, name) để bảng in thẳng; không phân trang.
// `warehouse_id` (03/10): is_active / sức chứa / điểm giao là giá trị ĐANG HIỆU LỰC tại kho (bản chụp của kho đè Chung),
// `wh_override` = kho có cấu hình riêng, `shared` = bản Chung để màn in "Theo chung: 16" (luật C47: ô theo cha in giá trị cha).
export async function listVehicleModels(req: Request, res: Response) {
  try {
    const { parent_type_id, unassigned, is_active, warehouse_id } = req.query as z.infer<typeof zVehicleModelListQuery>
    let q = db.from('vehicle_model').select('id, sap_code, name, parent_type_id, temp_mode, storage_conditions, capacity_mode, max_pallets, max_tons, max_drops, allow_multi_vehicle, allow_mix_channels, tariff_unit, is_active, sort_order, created_at, updated_at, created_by, updated_by, note').order('sort_order').order('sap_code')
    if (parent_type_id) q = q.eq('parent_type_id', parent_type_id)
    if (unassigned === '1') q = q.is('parent_type_id', null)
    // lọc is_active trên giá trị HIỆU LỰC (sau khi đè) — không đẩy xuống SQL khi có kho
    if (is_active !== undefined && !warehouse_id) q = q.eq('is_active', is_active === 'true')
    const [{ data, error }, parents, overrides] = await Promise.all([q, db.from('VehicleType').select('id, code, name, allow_multi_vehicle'), warehouse_id ? loadWarehouseOverrides(warehouse_id) : Promise.resolve([])])
    if (error) return fail(res, error)
    // cha mang cờ "ghép nhiều xe" để ô "theo loại xe" in được giá trị đang áp (C47) — `multi_vehicle` = giá trị HIỆU LỰC (kho → con → cha)
    const pmap = new Map((parents.data ?? []).map(p => [p.id, { code: p.code, name: p.name, allow_multi_vehicle: p.allow_multi_vehicle }]))
    const base = (data ?? []).map(r => ({ ...r, max_tons: r.max_tons == null ? null : Number(r.max_tons), parent: r.parent_type_id ? pmap.get(r.parent_type_id) ?? null : null }))
    const scoped = warehouse_id
      ? applyWarehouseOverrides(base, overrides).map(r => {
          const s = base.find(b => b.id === r.id)!
          return { ...r, shared: { is_active: s.is_active, max_pallets: s.max_pallets, max_tons: s.max_tons, max_drops: s.max_drops, allow_multi_vehicle: s.allow_multi_vehicle } }
        })
      : base.map(r => ({ ...r, wh_override: false, wh_fields: [] as string[], shared: null }))
    const withMulti = scoped.map(r => ({ ...r, multi_vehicle: multiVehicleOf(r.allow_multi_vehicle, r.parent?.allow_multi_vehicle) }))
    const rows = is_active !== undefined && warehouse_id ? withMulti.filter(r => r.is_active === (is_active === 'true')) : withMulti
    return ok(res, {
      items: rows,
      warehouse_id: warehouse_id ?? null,
      unassigned: rows.filter(r => !r.parent_type_id && r.is_active).length,
      // Dòng xe CŨ chưa khai điều kiện = đang được coi là chở được MỌI điều kiện. Dòng mới bị chặn ở zod; dòng cũ phải nói ra (băng cảnh báo).
      unconditioned: rows.filter(r => r.is_active && !(r.storage_conditions ?? []).length).length,
    })
  } catch (e) { return fail(res, String(e)) }
}

export async function createVehicleModel(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zVehicleModelCreate>
    if (!(await parentExists(body.parent_type_id))) return fail(res, 'Dòng xe cha không tồn tại', 400)
    const badC = await unknownConditions(body.storage_conditions)
    if (badC.length) return fail(res, 400, 'STORAGE_CONDITION_INVALID', `Điều kiện bảo quản không có trong danh mục: ${badC.join(', ')}`)
    const capErr = capacityError(body.capacity_mode, body.max_pallets, body.max_tons)
    if (capErr) return fail(res, 400, 'CAPACITY_REQUIRED', capErr)
    const actor = req.user?.name || null
    const rec: VehicleModelInsert = {
      id: randomUUID(), sap_code: body.sap_code, name: body.name,
      parent_type_id: body.parent_type_id, temp_mode: body.temp_mode ?? null,
      storage_conditions: [...new Set(body.storage_conditions)],
      capacity_mode: body.capacity_mode, max_pallets: body.max_pallets ?? null, max_tons: body.max_tons ?? null,
      max_drops: body.max_drops ?? null, allow_multi_vehicle: body.allow_multi_vehicle ?? null, allow_mix_channels: body.allow_mix_channels ?? true,
      tariff_unit: body.tariff_unit ?? (body.capacity_mode === 'PALLET' ? 'PER_PALLET' : 'PER_TRIP'),
      is_active: body.is_active ?? true, sort_order: body.sort_order ?? 0, dispatch_use: body.dispatch_use ?? 'ALL',
      created_by: actor, updated_by: actor, updated_at: new Date().toISOString(),
    }
    const { data, error } = await db.from('vehicle_model').insert(rec).select().single()
    if (error) return fail(res, error)   // 23505 sap_code trùng → 409 qua pgUserError
    return ok(res, data, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateVehicleModel(req: Request, res: Response) {
  try {
    const { id } = req.params
    const body = req.body as z.infer<typeof zVehicleModelUpdate>
    if (body.parent_type_id && !(await parentExists(body.parent_type_id))) return fail(res, 'Dòng xe cha không tồn tại', 400)
    const badC = await unknownConditions(body.storage_conditions ?? [])
    if (badC.length) return fail(res, 400, 'STORAGE_CONDITION_INVALID', `Điều kiện bảo quản không có trong danh mục: ${badC.join(', ')}`)
    // Sức chứa theo thước đo: kiểm trên bản SAU khi ghép với dòng hiện có (đổi thước đo mà không khai ô mới ⇒ 400, không để
    // dòng xe "đo bằng tấn" mà không có tấn — engine sẽ loại nó khỏi mọi chuyến mà không ai hiểu vì sao)
    if (body.capacity_mode !== undefined || body.max_pallets !== undefined || body.max_tons !== undefined) {
      const { data: cur } = await db.from('vehicle_model').select('capacity_mode, max_pallets, max_tons').eq('id', id).maybeSingle()
      if (!cur) return fail(res, 'Không tìm thấy dòng xe', 404)
      const capErr = capacityError(body.capacity_mode ?? cur.capacity_mode, body.max_pallets === undefined ? cur.max_pallets : body.max_pallets, body.max_tons === undefined ? cur.max_tons : body.max_tons)
      if (capErr) return fail(res, 400, 'CAPACITY_REQUIRED', capErr)
    }
    const patch: Partial<VehicleModelRow> = { ...body, ...(body.storage_conditions ? { storage_conditions: [...new Set(body.storage_conditions)] } : {}), updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    const { data, error } = await db.from('vehicle_model').update(patch).eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy dòng xe', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /tms/vehicle-models/assign-parent — gán cha cho nhiều dòng con một lượt (02/10: cha bắt buộc, không còn gỡ cha).
export async function assignParent(req: Request, res: Response) {
  try {
    const { ids, parent_type_id } = req.body as z.infer<typeof zAssignParent>
    if (!(await parentExists(parent_type_id))) return fail(res, 'Dòng xe cha không tồn tại', 400)
    const { data, error } = await db.from('vehicle_model')
      .update({ parent_type_id, updated_at: new Date().toISOString(), updated_by: req.user?.name || null })
      .in('id', ids.slice(0, 200)).select('id')
    if (error) return fail(res, error)
    return ok(res, { updated: data?.length ?? 0, missing: ids.length - (data?.length ?? 0) })
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /tms/vehicle-models/assign-conditions — khai điều kiện bảo quản cho NHIỀU dòng xe một lượt (60 dòng, khai lẻ là 60 nhát bấm).
export async function assignConditions(req: Request, res: Response) {
  try {
    const { ids, storage_conditions } = req.body as z.infer<typeof zAssignConditions>
    const bad = await unknownConditions(storage_conditions)
    if (bad.length) return fail(res, 400, 'STORAGE_CONDITION_INVALID', `Điều kiện bảo quản không có trong danh mục: ${bad.join(', ')}`)
    const { data, error } = await db.from('vehicle_model')
      .update({ storage_conditions: [...new Set(storage_conditions)], updated_at: new Date().toISOString(), updated_by: req.user?.name || null })
      .in('id', ids.slice(0, 200)).select('id')
    if (error) return fail(res, error)
    return ok(res, { updated: data?.length ?? 0, missing: ids.length - (data?.length ?? 0) })
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteVehicleModel(req: Request, res: Response) {
  try {
    const { id } = req.params
    // Gác: dòng con đang được bảng cước / kế hoạch / chuyến trỏ tới thì không xoá — Tạm dừng thay vì xoá
    const [tariff, sur, khvc, gdo] = await Promise.all([
      db.from('freight_tariff').select('id', { count: 'exact', head: true }).eq('vehicle_model_id', id),
      db.from('freight_surcharge').select('id', { count: 'exact', head: true }).eq('vehicle_model_id', id),
      db.from('khvc_lines').select('id', { count: 'exact', head: true }).eq('vehicle_model_id', id),
      db.from('GroupDeliveryOrder').select('id', { count: 'exact', head: true }).eq('vehicle_model_id', id),
    ])
    const parts: string[] = []
    if (tariff.count) parts.push(`${tariff.count} dòng cước`)
    if (sur.count)    parts.push(`${sur.count} phụ phí`)
    if (khvc.count)   parts.push(`${khvc.count} dòng Kế hoạch xuất`)
    if (gdo.count)    parts.push(`${gdo.count} chuyến`)
    if (parts.length) return fail(res, `Không thể xoá: dòng xe đang được dùng bởi ${parts.join(', ')}. Hãy đặt Tạm dừng.`, 409)
    // cấu hình riêng của các kho đi theo dòng xe (FK ON DELETE CASCADE)
    const { data: gone, error } = await db.from('vehicle_model').delete().eq('id', id).select('id')
    if (error) return fail(res, error)
    if (!gone?.length) return fail(res, 'Không tìm thấy dòng xe — có thể đã bị xoá trước đó', 404)
    return ok(res, { deleted: id })
  } catch (e) { return fail(res, String(e)) }
}

// ── DÒNG XE THEO KHO (03/10) ─────────────────────────────────────────────────────────────────────────────────────────────
// PUT /tms/vehicle-models/:id/warehouses/:warehouse_id — kho chỉnh RIÊNG TỪNG Ô (dùng/không · sức chứa · điểm giao · ghép nhiều xe 07/10):
// gửi ô nào ghi ô đó, `null` = ô đó về theo Chung, không gửi = giữ. Các ô NULL vẫn đọc từ Chung (đổi Chung là kho đổi theo). Mọi ô NULL ⇒ xoá dòng
// (kho theo Chung hoàn toàn). Trả bản HIỆU LỰC tại kho + `wh_fields` (ô đang riêng).
export async function setWarehouseVehicleModel(req: Request, res: Response) {
  try {
    const { id, warehouse_id } = req.params as z.infer<typeof zWarehouseModelParams>
    const body = req.body as z.infer<typeof zWarehouseModelBody>
    const scope = scopeWhIds(req)
    if (scope && !scope.includes(warehouse_id)) return fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được gán')
    const [{ data: vm, error: e1 }, { data: wh }, { data: cur, error: e2 }] = await Promise.all([
      db.from('vehicle_model').select('id, capacity_mode, is_active, max_pallets, max_tons, max_drops, allow_multi_vehicle').eq('id', id).maybeSingle(),
      db.from('Warehouse').select('id').eq('id', warehouse_id).maybeSingle(),
      db.from('warehouse_vehicle_model').select('id, is_active, max_pallets, max_tons, max_drops, allow_multi_vehicle').eq('warehouse_id', warehouse_id).eq('vehicle_model_id', id).maybeSingle(),
    ])
    if (e1) return fail(res, e1)
    if (e2) return fail(res, e2)
    if (!vm) return fail(res, 'Không tìm thấy dòng xe', 404)
    if (!wh) return fail(res, 'Không tìm thấy kho', 404)
    const numN = (v: unknown) => (v == null ? null : Number(v))
    // dòng kho SAU khi ghép: ô gửi lên (kể cả null = về theo Chung) đè ô đang có; ô không gửi giữ nguyên; chưa có dòng = toàn NULL
    const next = {
      is_active:   body.is_active   === undefined ? (cur?.is_active ?? null) : body.is_active,
      max_pallets: body.max_pallets === undefined ? numN(cur?.max_pallets) : body.max_pallets,
      max_tons:    body.max_tons    === undefined ? numN(cur?.max_tons) : body.max_tons,
      max_drops:   body.max_drops   === undefined ? numN(cur?.max_drops) : body.max_drops,
      allow_multi_vehicle: body.allow_multi_vehicle === undefined ? (cur?.allow_multi_vehicle ?? null) : body.allow_multi_vehicle,
    }
    // sức chứa HIỆU LỰC (riêng ?? Chung) phải đủ theo thước đo của Chung
    const capErr = capacityError(vm.capacity_mode, next.max_pallets ?? vm.max_pallets, next.max_tons ?? numN(vm.max_tons))
    if (capErr) return fail(res, 400, 'CAPACITY_REQUIRED', `${capErr} (thước đo là của bản Chung, kho chỉ đổi con số)`)
    const t = new Date().toISOString(), actor = req.user?.name || null
    const allNull = next.is_active == null && next.max_pallets == null && next.max_tons == null && next.max_drops == null && next.allow_multi_vehicle == null
    if (allNull) {
      if (cur) { const { error } = await db.from('warehouse_vehicle_model').delete().eq('id', cur.id); if (error) return fail(res, error) }
    } else {
      const { error } = cur
        ? await db.from('warehouse_vehicle_model').update({ ...next, updated_at: t, updated_by: actor }).eq('id', cur.id)
        : await db.from('warehouse_vehicle_model').insert({ id: randomUUID(), warehouse_id, vehicle_model_id: id, ...next, created_at: t, updated_at: t, created_by: actor, updated_by: actor })
      if (error) return fail(res, error)
    }
    const shared = { id: vm.id, is_active: vm.is_active, max_pallets: vm.max_pallets, max_tons: numN(vm.max_tons), max_drops: vm.max_drops, allow_multi_vehicle: vm.allow_multi_vehicle }
    const [eff] = applyWarehouseOverrides([shared], allNull ? [] : [{ vehicle_model_id: id, ...next }])
    return ok(res, { ...eff, warehouse_id, shared: { is_active: shared.is_active, max_pallets: shared.max_pallets, max_tons: shared.max_tons, max_drops: shared.max_drops, allow_multi_vehicle: shared.allow_multi_vehicle } }, cur || allNull ? 200 : 201)
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /tms/vehicle-models/:id/warehouses/:warehouse_id — "Về theo chung" MỌI ô: xoá dòng riêng, kho chạy lại theo bản Chung.
export async function clearWarehouseVehicleModel(req: Request, res: Response) {
  try {
    const { id, warehouse_id } = req.params as z.infer<typeof zWarehouseModelParams>
    const scope = scopeWhIds(req)
    if (scope && !scope.includes(warehouse_id)) return fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được gán')
    const { data, error } = await db.from('warehouse_vehicle_model').delete().eq('warehouse_id', warehouse_id).eq('vehicle_model_id', id).select('id')
    if (error) return fail(res, error)
    if (!data?.length) return fail(res, 'Kho này chưa có cấu hình riêng cho dòng xe', 404)
    return ok(res, { cleared: id, warehouse_id })
  } catch (e) { return fail(res, String(e)) }
}
