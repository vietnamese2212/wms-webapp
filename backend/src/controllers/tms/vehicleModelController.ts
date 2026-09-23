/**
 * DÒNG XE CON (`vehicle_model`) — user chốt 23/09/2026 (plan TMS_DISPATCH mục 5.3):
 * "Các dòng xe hiện tại trở thành CHA, dưới cha có nhiều dòng CON — ở đó mới có mã SAP, tên dòng xe.
 *  Kho chỉ quan tâm dòng cha để booking, đăng ký xe; chỉ điều vận mới quan tâm dòng con để làm shipment, ghép chuyến."
 *
 * CHA = `VehicleType` (7 mã, giữ nguyên — controller vehicleTypeController). CON mang `sap_code` 9100000xx,
 * sức chứa (pallet/tấn/m3/điểm giao), đơn vị tính cước, ngưỡng Non tải. `parent_type_id` NULL = chưa gán cha:
 * điều vận KHÔNG ghép vào dòng đó (không biết kho đặt khung giờ loại nào) — UI hiện băng "n dòng chưa gán cha".
 * Quyền dùng lại module `tms_vehicle_types` (cùng tab Loại xe ở Cài đặt TMS) — cha con là một danh mục.
 */
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { db } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { z, zText, zId, zBool } from '../../middlewares/validate'
import type { Database } from '../../types/database'

type VehicleModelRow = Database['public']['Tables']['vehicle_model']['Row']
type VehicleModelInsert = Database['public']['Tables']['vehicle_model']['Insert']

export const TEMP_MODES = ['HOT', 'COLD', 'MIXED', 'DRY'] as const
export const CAPACITY_MODES = ['PALLET', 'TON'] as const
export const TARIFF_UNITS = ['PER_PALLET', 'PER_TRIP'] as const

const zPosInt = z.number().int().positive()
const zPosNum = z.number().finite().positive()
const nullable = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional()

/** Thân chung Thêm / Sửa — mọi cột sức chứa nullable (null = không giới hạn / chưa khai).
 *  KHÔNG `.strict()`: client (và bộ QA) gửi kèm cờ chung `qty_semantics` trong mọi thân ghi — zod mặc định bỏ khoá lạ. */
const vehicleModelBody = {
  name:               zText(1, 160),
  parent_type_id:     nullable(zId),
  temp_mode:          nullable(z.enum(TEMP_MODES)),
  capacity_mode:      z.enum(CAPACITY_MODES),
  max_pallets:        nullable(zPosInt),
  max_tons:           nullable(zPosNum),
  max_m3:             nullable(zPosNum),
  max_drops:          nullable(zPosInt),
  allow_mix_channels: zBool,
  tariff_unit:        z.enum(TARIFF_UNITS),
  underload_pct:      z.number().int().min(0).max(100),
  is_active:          zBool,
  sort_order:         z.number().int().min(0),
}
export const zVehicleModelCreate = z.object({ sap_code: zText(1, 20), ...vehicleModelBody }).partial({
  parent_type_id: true, temp_mode: true, max_pallets: true, max_tons: true, max_m3: true, max_drops: true,
  allow_mix_channels: true, tariff_unit: true, underload_pct: true, is_active: true, sort_order: true, capacity_mode: true,
})
export const zVehicleModelUpdate = z.object(vehicleModelBody).partial()
export const zAssignParent = z.object({ ids: z.array(zId).min(1).max(200), parent_type_id: zId.nullable() })
/** Cha phải là VehicleType có thật — gán vào id rác thì dòng con "có cha" mà kho không đặt được khung giờ nào. */
async function parentExists(id: string): Promise<boolean> {
  const { data } = await db.from('VehicleType').select('id').eq('id', id).maybeSingle()
  return !!data
}

// GET /tms/vehicle-models?parent_type_id=&unassigned=1&is_active=true
// 60 dòng danh mục — một lời gọi, kèm cha (code, name) để bảng in thẳng; không phân trang (danh mục nhỏ, cố định).
export async function listVehicleModels(req: Request, res: Response) {
  try {
    const { parent_type_id, unassigned, is_active } = req.query as Record<string, string | undefined>
    let q = db.from('vehicle_model').select('*').order('sort_order').order('sap_code')
    if (parent_type_id) q = q.eq('parent_type_id', parent_type_id)
    if (unassigned === '1') q = q.is('parent_type_id', null)
    if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
    const [{ data, error }, parents] = await Promise.all([q, db.from('VehicleType').select('id, code, name')])
    if (error) return fail(res, error)
    const pmap = new Map((parents.data ?? []).map(p => [p.id, { code: p.code, name: p.name }]))
    const rows = (data ?? []).map(r => ({ ...r, parent: r.parent_type_id ? pmap.get(r.parent_type_id) ?? null : null }))
    return ok(res, { items: rows, unassigned: rows.filter(r => !r.parent_type_id && r.is_active).length })
  } catch (e) { return fail(res, String(e)) }
}

export async function createVehicleModel(req: Request, res: Response) {
  try {
    const body = req.body as z.infer<typeof zVehicleModelCreate>
    if (body.parent_type_id && !(await parentExists(body.parent_type_id))) return fail(res, 'Dòng xe cha không tồn tại', 400)
    const capacity_mode = body.capacity_mode ?? (body.max_pallets ? 'PALLET' : 'TON')
    const actor = req.user?.name || null
    const rec: VehicleModelInsert = {
      id: randomUUID(), sap_code: body.sap_code, name: body.name,
      parent_type_id: body.parent_type_id ?? null, temp_mode: body.temp_mode ?? null,
      capacity_mode, max_pallets: body.max_pallets ?? null, max_tons: body.max_tons ?? null, max_m3: body.max_m3 ?? null,
      max_drops: body.max_drops ?? null, allow_mix_channels: body.allow_mix_channels ?? true,
      tariff_unit: body.tariff_unit ?? (capacity_mode === 'PALLET' ? 'PER_PALLET' : 'PER_TRIP'),
      underload_pct: body.underload_pct ?? 70, is_active: body.is_active ?? true, sort_order: body.sort_order ?? 0,
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
    const patch: Partial<VehicleModelRow> = { ...body, updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
    const { data, error } = await db.from('vehicle_model').update(patch).eq('id', id).select().maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 'Không tìm thấy dòng xe', 404)
    return ok(res, data)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /tms/vehicle-models/assign-parent — gán (hoặc gỡ, parent_type_id null) cha cho nhiều dòng con một lượt.
// Việc thường làm nhất sau seed 60 dòng; từng dòng một là 60 nhát bấm.
export async function assignParent(req: Request, res: Response) {
  try {
    const { ids, parent_type_id } = req.body as z.infer<typeof zAssignParent>
    if (parent_type_id && !(await parentExists(parent_type_id))) return fail(res, 'Dòng xe cha không tồn tại', 400)
    const { data, error } = await db.from('vehicle_model')
      .update({ parent_type_id, updated_at: new Date().toISOString(), updated_by: req.user?.name || null })
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
    const { data: gone, error } = await db.from('vehicle_model').delete().eq('id', id).select('id')
    if (error) return fail(res, error)
    if (!gone?.length) return fail(res, 'Không tìm thấy dòng xe — có thể đã bị xoá trước đó', 404)
    return ok(res, { deleted: id })
  } catch (e) { return fail(res, String(e)) }
}
