import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'

const now = () => new Date().toISOString()

// ─── Helpers ──────────────────────────────────────────────────

function parsePlannedDate(group_code: string): string | null {
  const prefix = group_code.split('_')[0]
  if (!prefix || prefix.length !== 6) return null
  const dd = prefix.slice(0, 2)
  const mm = prefix.slice(2, 4)
  const yy = prefix.slice(4, 6)
  const d = new Date(Date.UTC(2000 + parseInt(yy), parseInt(mm) - 1, parseInt(dd)))
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function parseDecimal(val: any): number {
  if (!val && val !== 0) return 0
  const n = parseFloat(String(val).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function parseExcelDate(val: any): string | null {
  if (!val) return null
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val)
    if (!d) return null
    const date = new Date(Date.UTC(d.y, d.m - 1, d.d))
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const s = String(val).trim()
  if (!s) return null
  // dd/mm/yyyy (Vietnamese default — JS Date() would misread as mm/dd)
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const date = new Date(Date.UTC(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1])))
    return isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// Exclude POSM and Pallet Loscam from carton/pallet totals
function isExcludedFromCount(item: any): boolean {
  return item.material_type === 'POSM' ||
    item.material_type === 'Pallet Loscam' ||
    (item.material_code_raw ?? '').includes('810000')
}

// ─── Fetch full GDO ───────────────────────────────────────────

async function fetchGDOFull(id: string) {
  const { data: gdo, error } = await (supabase.from('GroupDeliveryOrder') as any)
    .select('*, warehouse:Warehouse(id,code,name)').eq('id', id).single()
  if (error || !gdo) return null

  const { data: dos } = await (supabase.from('OutboundDelivery') as any)
    .select('*').eq('gdo_id', id).order('delivery_code')

  const doIds = (dos ?? []).map((d: any) => d.id)

  const { data: items } = doIds.length
    ? await (supabase.from('OutboundItem') as any)
        .select('*, material:Material(id,material_code,short_name,custom_short_name,cartons_per_pallet,weight_kg)')
        .in('do_id', doIds)
        .order('id')
    : { data: [] }

  const itemIds = (items ?? []).map((i: any) => i.id)
  const { data: scans } = itemIds.length
    ? await (supabase.from('OutboundScanEntry') as any)
        .select('*').in('item_id', itemIds)
    : { data: [] }

  const scansByItem = new Map<string, any[]>()
  for (const s of (scans ?? [])) {
    const list = scansByItem.get(s.item_id) ?? []
    list.push(s)
    scansByItem.set(s.item_id, list)
  }

  const itemsByDO = new Map<string, any[]>()
  for (const item of (items ?? [])) {
    const list = itemsByDO.get(item.do_id) ?? []
    list.push({ ...item, scan_entries: scansByItem.get(item.id) ?? [] })
    itemsByDO.set(item.do_id, list)
  }

  return {
    ...gdo,
    delivery_orders: (dos ?? []).map((d: any) => ({
      ...d,
      items: itemsByDO.get(d.id) ?? [],
    })),
  }
}

// ─── List GDOs ────────────────────────────────────────────────

export async function listGDOs(req: Request, res: Response) {
  try {
    const { warehouse_id, status, date, search } = req.query as Record<string, string>
    let q = (supabase.from('GroupDeliveryOrder') as any)
      .select('*, warehouse:Warehouse(id,code,name), forklift_driver:Employee!forklift_driver_id(id,name)')
      .order('delivery_date', { ascending: false })
    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
    if (status)       q = q.eq('status', status)
    if (date)         q = q.eq('delivery_date', date)
    if (search)       q = q.ilike('group_code', `%${search}%`)
    const { data, error } = await q
    if (error) return fail(res, error.message)

    const gdoIds = (data ?? []).map((g: any) => g.id)
    if (!gdoIds.length) return ok(res, [])

    // Bulk fetch DOs and items for aggregation
    const { data: dos } = await (supabase.from('OutboundDelivery') as any)
      .select('id, gdo_id, distributor_name')
      .in('gdo_id', gdoIds)

    const doIds = (dos ?? []).map((d: any) => d.id)

    const { data: items } = doIds.length
      ? await (supabase.from('OutboundItem') as any)
          .select('do_id, cartons_ordered, pallets_estimated, material_type, export_type, material_code_raw')
          .in('do_id', doIds)
      : { data: [] }

    // Build lookup maps
    const dosByGdo = new Map<string, any[]>()
    for (const d of (dos ?? [])) {
      const list = dosByGdo.get(d.gdo_id) ?? []
      list.push(d)
      dosByGdo.set(d.gdo_id, list)
    }

    const itemsByDo = new Map<string, any[]>()
    for (const i of (items ?? [])) {
      const list = itemsByDo.get(i.do_id) ?? []
      list.push(i)
      itemsByDo.set(i.do_id, list)
    }

    return ok(res, (data ?? []).map((g: any) => {
      const gdoDOs   = dosByGdo.get(g.id) ?? []
      const gdoItems = gdoDOs.flatMap((d: any) => itemsByDo.get(d.id) ?? [])
      const countable = gdoItems.filter((i: any) => !isExcludedFromCount(i))

      const distributorNames = [...new Set(
        gdoDOs.map((d: any) => d.distributor_name).filter(Boolean)
      )]
      const firstExportType = gdoItems.find((i: any) => i.export_type)?.export_type ?? null

      return {
        ...g,
        do_count:          gdoDOs.length,
        distributor_names: distributorNames as string[],
        export_type:       firstExportType,
        total_cartons:     countable.reduce((s: number, i: any) => s + Number(i.cartons_ordered),    0),
        total_pallets:     countable.reduce((s: number, i: any) => s + Number(i.pallets_estimated),  0),
      }
    }))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Get GDO detail ───────────────────────────────────────────

export async function getGDO(req: Request, res: Response) {
  try {
    const result = await fetchGDOFull(req.params.id)
    if (!result) return fail(res, 'Không tìm thấy chuyến xe', 404)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Create GDO manually ──────────────────────────────────────

type ManualItem = {
  material_code: string
  cartons_ordered: number
  boxes_display?: number
  weight?: number
  pallets_estimated?: number
  loose_picking?: number
  material_type?: string
  export_type?: string
}
type ManualDO = {
  delivery_code: string
  distributor_name?: string
  items: ManualItem[]
}

export async function createGDO(req: Request, res: Response) {
  try {
    const { group_code, delivery_date, warehouse_id, dvvt, warehouse_type, delivery_orders } = req.body as {
      group_code: string; delivery_date: string; warehouse_id?: string; dvvt?: string; warehouse_type?: string
      delivery_orders?: ManualDO[]
    }
    if (!group_code || !delivery_date) return fail(res, 'group_code và delivery_date là bắt buộc', 400)

    const planned_date = parsePlannedDate(group_code) ?? delivery_date
    const gdoId = randomUUID()
    const { error } = await (supabase.from('GroupDeliveryOrder') as any).insert({
      id: gdoId, group_code, planned_date, delivery_date,
      warehouse_id: warehouse_id ?? null, dvvt: dvvt ?? null,
      warehouse_type: warehouse_type ?? null,
      status: 'PENDING', updated_at: now(),
    })
    if (error) return fail(res, error.message)

    if (delivery_orders?.length) {
      // Pre-load material_ids
      const allCodes = [...new Set(delivery_orders.flatMap(d => d.items.map(i => i.material_code)))]
      const { data: mats } = await (supabase.from('Material') as any)
        .select('id, material_code').in('material_code', allCodes)
      const matMap = new Map<string, string>((mats ?? []).map((m: any) => [m.material_code, m.id]))

      for (const doRow of delivery_orders) {
        if (!doRow.delivery_code) return fail(res, 'delivery_code là bắt buộc', 400)
        const doId = randomUUID()
        const { error: doErr } = await (supabase.from('OutboundDelivery') as any).insert({
          id: doId, gdo_id: gdoId,
          delivery_code: doRow.delivery_code,
          distributor_name: doRow.distributor_name ?? null,
          status: 'PENDING', updated_at: now(),
        })
        if (doErr) return fail(res, doErr.message)

        const itemsToInsert = doRow.items.map((item: ManualItem) => {
          const isSpecial = item.material_type === 'POSM' || item.material_type === 'Pallet Loscam'
          return {
            id: randomUUID(),
            do_id: doId,
            material_id: matMap.get(item.material_code) ?? null,
            material_code_raw: item.material_code,
            cartons_ordered: item.cartons_ordered,
            boxes_display: item.boxes_display ?? 0,
            weight: item.weight ?? null,
            pallets_estimated: item.pallets_estimated ?? 0,
            loose_picking: item.loose_picking ?? 0,
            material_type: item.material_type ?? null,
            export_type: item.export_type ?? null,
            cartons_scanned: 0,
            status: isSpecial ? 'COMPLETED' : 'PENDING',
            updated_at: now(),
          }
        })
        const { error: itemErr } = await (supabase.from('OutboundItem') as any).insert(itemsToInsert)
        if (itemErr) return fail(res, itemErr.message)
      }
    }

    const result = await fetchGDOFull(gdoId)
    return ok(res, result, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Patch GDO (delivery_date / status / misc fields) ────────

export async function patchGDO(req: Request, res: Response) {
  try {
    const { delivery_date, status } = req.body as { delivery_date?: string; status?: string }

    // PAUSED: chỉ cho đổi status (ví dụ resume → IN_PROGRESS), không sửa dữ liệu khác
    if (delivery_date) {
      const { data: current } = await (supabase.from('GroupDeliveryOrder') as any)
        .select('status').eq('id', req.params.id).single()
      if (current?.status === 'PAUSED')
        return fail(res, 'Chuyến đang tạm dừng — chỉ được đổi trạng thái, không sửa dữ liệu', 400)
    }

    const { error } = await (supabase.from('GroupDeliveryOrder') as any)
      .update({ delivery_date, status, updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Assign GDO (Giao đơn) ────────────────────────────────────

export async function assignGDO(req: Request, res: Response) {
  try {
    const { assigned_by } = req.body as { assigned_by?: string }
    const { error } = await (supabase.from('GroupDeliveryOrder') as any)
      .update({ assigned_at: now(), assigned_by: assigned_by ?? null, updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Unassign GDO (Gỡ giao đơn) ──────────────────────────────

export async function unassignGDO(req: Request, res: Response) {
  try {
    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('assigned_at, started_at').eq('id', req.params.id).single()
    if (!gdo?.assigned_at) return fail(res, 'Đơn chưa được giao đơn', 400)
    if (gdo?.started_at)   return fail(res, 'Cần gỡ bắt đầu trước khi gỡ giao đơn', 400)
    const { error } = await (supabase.from('GroupDeliveryOrder') as any)
      .update({ assigned_at: null, assigned_by: null, status: 'PENDING', updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Start GDO (Bắt đầu xuất kho) ────────────────────────────

export async function startGDO(req: Request, res: Response) {
  try {
    const {
      license_plate, container_number, exporter_name,
      loader_name, forklift_driver_id, forklift_driver_names,
    } = req.body as {
      license_plate?: string; container_number?: string; exporter_name?: string
      loader_name?: string; forklift_driver_id?: string; forklift_driver_names?: string
    }
    if (!license_plate) return fail(res, 'Biển số xe là bắt buộc', 400)

    const { error } = await (supabase.from('GroupDeliveryOrder') as any)
      .update({
        started_at: now(),
        license_plate,
        container_number:       container_number       ?? null,
        exporter_name:          exporter_name          ?? null,
        loader_name:            loader_name            ?? null,
        forklift_driver_id:     forklift_driver_id     ?? null,
        forklift_driver_names:  forklift_driver_names  ?? null,
        status:     'IN_PROGRESS',
        updated_at: now(),
      })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    const result = await fetchGDOFull(req.params.id)
    return ok(res, result)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Unstart GDO (Gỡ bắt đầu) ────────────────────────────────

export async function unstartGDO(req: Request, res: Response) {
  try {
    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('started_at').eq('id', req.params.id).single()
    if (!gdo?.started_at) return fail(res, 'Đơn chưa được bắt đầu', 400)

    // Kiểm tra chưa có QR nào được quét
    const { data: doList } = await (supabase.from('OutboundDelivery') as any)
      .select('id').eq('gdo_id', req.params.id)
    const doIds = (doList ?? []).map((d: any) => d.id)
    if (doIds.length) {
      const { data: items } = await (supabase.from('OutboundItem') as any)
        .select('id').in('do_id', doIds)
      const itemIds = (items ?? []).map((i: any) => i.id)
      if (itemIds.length) {
        const { count } = await (supabase.from('OutboundScanEntry') as any)
          .select('id', { count: 'exact', head: true }).in('item_id', itemIds)
        if ((count ?? 0) > 0)
          return fail(res, 'Cần xóa hết QR đã quét trước khi gỡ bắt đầu', 400)
      }
    }

    const t = now()
    const { error } = await (supabase.from('GroupDeliveryOrder') as any)
      .update({
        started_at: null, license_plate: null, container_number: null,
        exporter_name: null, loader_name: null,
        forklift_driver_id: null, forklift_driver_names: null,
        status: 'PENDING', updated_at: t,
      })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Uncomplete GDO (Bỏ hoàn thành) ──────────────────────────

export async function uncompleteGDO(req: Request, res: Response) {
  try {
    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('status').eq('id', req.params.id).single()
    if (gdo?.status !== 'COMPLETED') return fail(res, 'Đơn chưa hoàn thành', 400)
    const { error } = await (supabase.from('GroupDeliveryOrder') as any)
      .update({ status: 'IN_PROGRESS', completed_at: null, updated_at: now() })
      .eq('id', req.params.id)
    if (error) return fail(res, error.message)
    return ok(res, await fetchGDOFull(req.params.id))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Get warehouse employees (for forklift driver dropdown) ──

export async function getWarehouseEmployees(req: Request, res: Response) {
  try {
    const { warehouse_id } = req.query as Record<string, string>
    let q = (supabase.from('Employee') as any)
      .select('id, name, employee_code')
      .eq('is_active', true)
      .order('name')
    if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
    const { data, error } = await q
    if (error) return fail(res, error.message)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, String(e)) }
}

// ─── Merge upload for PAUSED GDO ─────────────────────────────

async function mergePausedGDO(
  gdoId: string,
  group_code: string,
  delivery_date: string,
  planned_date: string,
  warehouse_id: string | null,
  dvvt: string | null,
  warehouse_type: string | null,
  byDelivery: Map<string, Record<string, any>[]>,
  matMap: Map<string, string>
): Promise<{ group_code: string; id?: string; merged?: boolean; skipped?: boolean; reason?: string }> {
  const t = now()

  const { data: existingDOs } = await (supabase.from('OutboundDelivery') as any)
    .select('id, delivery_code').eq('gdo_id', gdoId)

  const existingDoIds = (existingDOs ?? []).map((d: any) => d.id as string)
  const { data: existingItems } = existingDoIds.length
    ? await (supabase.from('OutboundItem') as any)
        .select('id, do_id, material_code_raw, cartons_scanned').in('do_id', existingDoIds)
    : { data: [] }

  const existingDOByCode = new Map<string, any>()
  for (const d of (existingDOs ?? [])) existingDOByCode.set(d.delivery_code as string, d)

  const itemKey = (doId: string, matCode: string) => `${doId}::${matCode}`
  const existingItemByKey = new Map<string, any>()
  for (const i of (existingItems ?? [])) {
    existingItemByKey.set(itemKey(i.do_id, i.material_code_raw ?? ''), i)
  }

  // Build set of delivery_code::material_code present in new file
  const newFileItemKeys = new Set<string>()
  for (const [delivery_code, rows] of byDelivery) {
    for (const row of rows) {
      newFileItemKeys.add(`${delivery_code}::${String(row['Material'] ?? '').trim()}`)
    }
  }
  const newDeliveryCodes = new Set([...byDelivery.keys()])

  // Validation 1: every scanned item must exist in new file (cannot remove exported items)
  const scannedItems = (existingItems ?? []).filter((i: any) => Number(i.cartons_scanned) > 0)
  const missingScanned: string[] = []
  for (const item of scannedItems) {
    const existingDO = (existingDOs ?? []).find((d: any) => d.id === item.do_id)
    if (!existingDO) continue
    if (!newFileItemKeys.has(`${existingDO.delivery_code}::${item.material_code_raw ?? ''}`)) {
      missingScanned.push(`${item.material_code_raw} (DO ${existingDO.delivery_code}, đã xuất ${item.cartons_scanned} thùng)`)
    }
  }
  if (missingScanned.length) {
    return {
      group_code, skipped: true,
      reason: `Mã hàng đã xuất không có trong file mới: ${missingScanned.join('; ')}`,
    }
  }

  // Validation 2: new cartons_ordered >= cartons_scanned — collect ALL failures before blocking
  const cartonErrors: string[] = []
  for (const [delivery_code, doRows] of byDelivery) {
    const existingDO = existingDOByCode.get(delivery_code)
    if (!existingDO) continue
    for (const row of doRows) {
      const mat_code   = String(row['Material'] ?? '').trim()
      const newCartons = parseDecimal(row['Thùng'])
      const existing   = existingItemByKey.get(itemKey(existingDO.id, mat_code))
      if (existing && newCartons < Number(existing.cartons_scanned)) {
        cartonErrors.push(`${mat_code} (mới ${newCartons} < đã xuất ${existing.cartons_scanned})`)
      }
    }
  }
  if (cartonErrors.length) {
    return {
      group_code, skipped: true,
      reason: `Số thùng mới nhỏ hơn đã xuất: ${cartonErrors.join(', ')}`,
    }
  }

  // Cleanup: delete stale items not in new file (all have cartons_scanned=0, blocked otherwise)
  const staleItemIds = (existingItems ?? [])
    .filter((i: any) => {
      const d = (existingDOs ?? []).find((d: any) => d.id === i.do_id)
      if (!d) return true
      return !newFileItemKeys.has(`${d.delivery_code}::${i.material_code_raw ?? ''}`)
    })
    .map((i: any) => i.id as string)
  if (staleItemIds.length) {
    await (supabase.from('OutboundItem') as any).delete().in('id', staleItemIds)
  }

  // Cleanup: delete stale DOs not in new file (items already deleted above)
  const staleDOIds = (existingDOs ?? [])
    .filter((d: any) => !newDeliveryCodes.has(d.delivery_code as string))
    .map((d: any) => d.id as string)
  if (staleDOIds.length) {
    await (supabase.from('OutboundDelivery') as any).delete().in('id', staleDOIds)
  }

  // Update GDO header — preserve workflow fields (started_at, assigned_at, status, license_plate, etc.)
  await (supabase.from('GroupDeliveryOrder') as any)
    .update({ delivery_date, planned_date, warehouse_id, dvvt, warehouse_type, updated_at: t })
    .eq('id', gdoId)

  // Upsert DOs + items from new file
  for (const [delivery_code, doRows] of byDelivery) {
    const distributor_name = String(doRows[0]['Tên NPP'] ?? '').trim() || null
    const existingDO = existingDOByCode.get(delivery_code)
    let doId: string

    if (existingDO) {
      doId = existingDO.id as string
      await (supabase.from('OutboundDelivery') as any).update({ distributor_name, updated_at: t }).eq('id', doId)
    } else {
      doId = randomUUID()
      await (supabase.from('OutboundDelivery') as any).insert({
        id: doId, gdo_id: gdoId, delivery_code, distributor_name, status: 'PENDING', updated_at: t,
      })
    }

    for (const row of doRows) {
      const mat_code      = String(row['Material'] ?? '').trim()
      const material_type = String(row['Material_type'] ?? '').trim() || null
      const newCartons    = parseDecimal(row['Thùng'])
      const fields = {
        material_id:       matMap.get(mat_code) ?? null,
        material_code_raw: mat_code,
        cartons_ordered:   newCartons,
        boxes_display:     parseDecimal(row['Hộp']),
        weight:            parseDecimal(row['Tải']),
        loose_picking:     parseDecimal(row['Nhặt lẻ']),
        pallets_estimated: parseDecimal(String(row['Pallet'] ?? '').replace(',', '.')),
        material_type,
        export_type:    String(row['Loại xuất']     ?? '').trim() || null,
        header_text:    String(row['HEADER TEXT']   ?? '').trim() || null,
        batch_required: String(row['Batch_Yêu cầu'] ?? '').trim() || null,
        date_required:  parseDecimal(row['%Date_Yêu cầu']) || null,
        cs_responsible: String(row['CS phụ trách']  ?? '').trim() || null,
        updated_at: t,
      }

      const existing = existingDO ? existingItemByKey.get(itemKey(existingDO.id, mat_code)) : null
      if (existing) {
        const scanned   = Number(existing.cartons_scanned)
        const newStatus = material_type === 'POSM' ? 'COMPLETED'
          : scanned >= newCartons ? 'COMPLETED'
          : scanned > 0 ? 'IN_PROGRESS'
          : 'PENDING'
        await (supabase.from('OutboundItem') as any).update({ ...fields, status: newStatus }).eq('id', existing.id)
      } else {
        await (supabase.from('OutboundItem') as any).insert({
          id: randomUUID(), do_id: doId, ...fields,
          cartons_scanned: 0,
          status: material_type === 'POSM' ? 'COMPLETED' : 'PENDING',
        })
      }
    }
  }

  return { group_code, id: gdoId, merged: true }
}

// ─── Upload Excel ─────────────────────────────────────────────

export async function uploadExcel(req: Request, res: Response) {
  try {
    if (!req.file) return fail(res, 'Không có file upload', 400)
    const { warehouse_id } = req.body as { warehouse_id?: string }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })

    if (!rows.length) return fail(res, 'File Excel trống hoặc không đúng định dạng', 400)

    // Group rows by Số xe
    const byVehicle = new Map<string, Record<string, any>[]>()
    for (const row of rows) {
      const code = String(row['Số xe'] ?? row['So xe'] ?? '').trim()
      if (!code) continue
      const list = byVehicle.get(code) ?? []
      list.push(row)
      byVehicle.set(code, list)
    }
    if (!byVehicle.size) return fail(res, 'Không tìm thấy cột "Số xe" hoặc dữ liệu trống', 400)

    // Pre-load warehouses, materials, and existing GDOs in parallel
    const allGroupCodes = [...byVehicle.keys()]
    const [warehousesRes, materialsRes, existingRes] = await Promise.all([
      (supabase.from('Warehouse') as any).select('id, code, name').eq('is_active', true),
      (supabase.from('Material') as any).select('id, material_code'),
      (supabase.from('GroupDeliveryOrder') as any)
        .select('id, group_code, status, assigned_at, assigned_by')
        .in('group_code', allGroupCodes),
    ])

    const warehouseByKey = new Map<string, string>()
    for (const w of (warehousesRes.data ?? [])) {
      warehouseByKey.set(w.code.trim().toLowerCase(), w.id)
      warehouseByKey.set(w.name.trim().toLowerCase(), w.id)
    }
    const matMap = new Map<string, string>(
      (materialsRes.data ?? []).map((m: any) => [m.material_code.trim(), m.id])
    )

    // Classify existing GDOs
    // pendingSimpleMap   : PENDING, no assignment → delete+recreate GDO
    // pendingPreserveMap : PENDING, has assignment → keep GDO row, replace DOs/Items
    // pausedGDOMap       : PAUSED → merge (strict validation)
    // blockedMap         : IN_PROGRESS / COMPLETED → skip
    const pendingSimpleMap   = new Map<string, string>()
    const pendingPreserveMap = new Map<string, string>() // group_code → id
    const pausedGDOMap       = new Map<string, string>()
    const blockedMap         = new Map<string, string>() // group_code → status

    for (const g of (existingRes.data ?? [])) {
      if (g.status === 'PENDING') {
        if (g.assigned_at) pendingPreserveMap.set(g.group_code as string, g.id)
        else               pendingSimpleMap.set(g.group_code as string, g.id)
      } else if (g.status === 'PAUSED') {
        pausedGDOMap.set(g.group_code as string, g.id)
      } else {
        blockedMap.set(g.group_code as string, g.status)
      }
    }

    // ── First pass: validate all vehicles, build insert lists ──
    // Deletions happen AFTER this loop so a failed vehicle never loses its old data.

    const created:  any[] = []
    const gdoInserts:  any[] = []   // new GDO rows (pendingSimple + new)
    const doInserts:   any[] = []   // all new DO rows
    const itemInserts: any[] = []   // all new Item rows
    const toReplaceIds:   string[] = [] // pendingSimple IDs → cascade delete
    const toPreserveIds:  string[] = [] // pendingPreserve IDs → delete DOs only, update GDO
    const preserveGDOUpdates: { id: string; fields: Record<string, unknown> }[] = []

    for (const [group_code, groupRows] of byVehicle) {
      // Blocked: IN_PROGRESS or COMPLETED
      if (blockedMap.has(group_code)) {
        const status = blockedMap.get(group_code)!
        const reason = status === 'COMPLETED'
          ? 'Đã hoàn thành — không thể ghi đè'
          : 'Đang xuất — chỉ upload được khi chuyến tạm dừng (PAUSED)'
        created.push({ group_code, skipped: true, reason, existing_status: status })
        continue
      }

      const delivery_date = parseExcelDate(groupRows[0]['Ngày xuất'])
      if (!delivery_date) {
        created.push({ group_code, skipped: true, reason: `Ngày xuất không hợp lệ hoặc trống: "${groupRows[0]['Ngày xuất'] ?? ''}"` })
        continue
      }

      // planned_date phải parse được từ tiền tố ddmmyy_ của group_code — sai format → chặn
      const planned_date = parsePlannedDate(group_code)
      if (!planned_date) {
        created.push({ group_code, skipped: true, reason: 'Mã xe không có tiền tố ngày ddmmyy_ hợp lệ — không thể xác định ngày kế hoạch' })
        continue
      }

      const dvvt     = String(groupRows[0]['DVVT']     ?? groupRows[0]['Đơn vị']  ?? '').trim() || null
      const kho_xuat = String(groupRows[0]['Kho xuất'] ?? groupRows[0]['Kho xuat'] ?? '').trim()
      const loaiKhoSet = [...new Set(groupRows.map(r => String(r['Loại kho'] ?? r['Loai kho'] ?? '').trim()).filter(Boolean))]
      const loai_kho = loaiKhoSet.length > 1 ? 'Hỗn hợp' : (loaiKhoSet[0] ?? null)

      let resolved_warehouse_id = warehouse_id ?? null
      if (kho_xuat) {
        const found = warehouseByKey.get(kho_xuat.toLowerCase())
        if (!found) {
          created.push({ group_code, skipped: true, reason: `Không tìm thấy kho "${kho_xuat}"` })
          continue
        }
        resolved_warehouse_id = found
      } else if (!resolved_warehouse_id) {
        created.push({ group_code, skipped: true, reason: 'Thiếu thông tin kho xuất' })
        continue
      }

      const unknownMats = [...new Set(
        groupRows.filter(r => String(r['Material'] ?? '').trim()).map(r => String(r['Material']).trim())
      )].filter(c => !matMap.has(c))
      if (unknownMats.length) {
        created.push({ group_code, skipped: true, reason: `Mã hàng không tìm thấy: ${unknownMats.join(', ')}` })
        continue
      }

      const byDelivery = new Map<string, Record<string, any>[]>()
      for (const row of groupRows) {
        const code = String(row['Delivery'] ?? '').trim()
        if (!code) continue
        const list = byDelivery.get(code) ?? []
        list.push(row)
        byDelivery.set(code, list)
      }

      // PAUSED → merge (strict: scanned items must all exist in new file)
      if (pausedGDOMap.has(group_code)) {
        const mergeResult = await mergePausedGDO(
          pausedGDOMap.get(group_code)!,
          group_code, delivery_date, planned_date,
          resolved_warehouse_id, dvvt, loai_kho,
          byDelivery, matMap
        )
        created.push(mergeResult)
        continue
      }

      // Helper: build DO + Item rows for a given gdoId
      const collectDOsAndItems = (gdoId: string) => {
        for (const [delivery_code, doRows] of byDelivery) {
          const doId = randomUUID()
          const distributor_name = String(doRows[0]['Tên NPP'] ?? '').trim() || null
          doInserts.push({ id: doId, gdo_id: gdoId, delivery_code, distributor_name, status: 'PENDING', updated_at: now() })
          for (const row of doRows) {
            const mat_code      = String(row['Material'] ?? '').trim()
            const material_type = String(row['Material_type'] ?? '').trim() || null
            itemInserts.push({
              id: randomUUID(), do_id: doId,
              material_id:       matMap.get(mat_code) ?? null,
              material_code_raw: mat_code,
              cartons_ordered:   parseDecimal(row['Thùng']),
              boxes_display:     parseDecimal(row['Hộp']),
              weight:            parseDecimal(row['Tải']),
              loose_picking:     parseDecimal(row['Nhặt lẻ']),
              pallets_estimated: parseDecimal(String(row['Pallet'] ?? '').replace(',', '.')),
              material_type,
              export_type:    String(row['Loại xuất']     ?? '').trim() || null,
              header_text:    String(row['HEADER TEXT']   ?? '').trim() || null,
              batch_required: String(row['Batch_Yêu cầu'] ?? '').trim() || null,
              date_required:  parseDecimal(row['%Date_Yêu cầu']) || null,
              cs_responsible: String(row['CS phụ trách']  ?? '').trim() || null,
              cartons_scanned: 0,
              status: material_type === 'POSM' ? 'COMPLETED' : 'PENDING',
              updated_at: now(),
            })
          }
        }
      }

      // PENDING with assignment → keep GDO row + assigned_at, replace DOs/Items
      if (pendingPreserveMap.has(group_code)) {
        const gdoId = pendingPreserveMap.get(group_code)!
        toPreserveIds.push(gdoId)
        preserveGDOUpdates.push({
          id: gdoId,
          fields: { delivery_date, planned_date, warehouse_id: resolved_warehouse_id, dvvt, warehouse_type: loai_kho, updated_at: now() },
        })
        collectDOsAndItems(gdoId)
        created.push({ group_code, id: gdoId, created: true, preserved_assignment: true })
        continue
      }

      // PENDING (no assignment) or new → create fresh GDO
      if (pendingSimpleMap.has(group_code)) {
        toReplaceIds.push(pendingSimpleMap.get(group_code)!)
      }
      const gdoId = randomUUID()
      gdoInserts.push({
        id: gdoId, group_code, planned_date, delivery_date,
        warehouse_id: resolved_warehouse_id, dvvt, warehouse_type: loai_kho,
        status: 'PENDING', updated_at: now(),
      })
      collectDOsAndItems(gdoId)
      created.push({ group_code, id: gdoId, created: true })
    }

    // ── Delete validated PENDING GDOs ──

    // Simple PENDING → cascade delete entire GDO
    if (toReplaceIds.length) {
      const { data: dosToDelete } = await (supabase.from('OutboundDelivery') as any)
        .select('id').in('gdo_id', toReplaceIds)
      const doIdsToDelete = (dosToDelete ?? []).map((d: any) => d.id as string)
      if (doIdsToDelete.length) {
        await (supabase.from('OutboundItem') as any).delete().in('do_id', doIdsToDelete)
        await (supabase.from('OutboundDelivery') as any).delete().in('id', doIdsToDelete)
      }
      await (supabase.from('GroupDeliveryOrder') as any).delete().in('id', toReplaceIds)
    }

    // Preserve PENDING → delete DOs/Items only, update GDO header
    if (toPreserveIds.length) {
      const { data: dosToDelete } = await (supabase.from('OutboundDelivery') as any)
        .select('id').in('gdo_id', toPreserveIds)
      const doIdsToDelete = (dosToDelete ?? []).map((d: any) => d.id as string)
      if (doIdsToDelete.length) {
        await (supabase.from('OutboundItem') as any).delete().in('do_id', doIdsToDelete)
        await (supabase.from('OutboundDelivery') as any).delete().in('id', doIdsToDelete)
      }
      for (const { id, fields } of preserveGDOUpdates) {
        await (supabase.from('GroupDeliveryOrder') as any).update(fields).eq('id', id)
      }
    }

    // ── Batch inserts ──
    const CHUNK = 100
    async function batchInsert(table: string, rows: any[]) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await (supabase.from(table) as any).insert(rows.slice(i, i + CHUNK))
        if (error) throw new Error(`${table}: ${error.message}`)
      }
    }

    if (gdoInserts.length)  await batchInsert('GroupDeliveryOrder', gdoInserts)
    if (doInserts.length)   await batchInsert('OutboundDelivery',   doInserts)
    if (itemInserts.length) await batchInsert('OutboundItem',       itemInserts)

    return ok(res, { created }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// ─── Get available inventory for an item ─────────────────────

export async function getItemInventory(req: Request, res: Response) {
  try {
    const { itemId } = req.params
    const { data: item } = await (supabase.from('OutboundItem') as any)
      .select('material_id').eq('id', itemId).single()
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    const { data, error } = await (supabase.from('InventoryEntry') as any)
      .select('id, pallet_code, cartons_imported, cartons_remaining, status, qa_status_id, location:Location(location_code), qa_status:QAStatus(code,name)')
      .eq('material_id', item.material_id)
      .gt('cartons_remaining', 0)
      .order('created_at')
    if (error) return fail(res, error.message)

    return ok(res, (data ?? []).map((e: any) => ({
      ...e,
      available: e.cartons_remaining ?? e.cartons_imported,
    })))
  } catch (e) { return fail(res, String(e)) }
}

// ─── Scan QR for an item ──────────────────────────────────────

export async function scanItem(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params
    const { qr_code, employee_id, cartons_override } = req.body as { qr_code: string; employee_id?: string; cartons_override?: number }
    const qr = (qr_code ?? '').trim()
    if (!qr) return fail(res, 'qr_code là bắt buộc', 400)

    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('status').eq('id', gdoId).single()
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể quét', 400)

    const { data: item, error: itemErr } = await (supabase.from('OutboundItem') as any)
      .select('*').eq('id', itemId).single()
    if (itemErr || !item) return fail(res, 'Không tìm thấy mặt hàng', 404)
    if (item.status === 'COMPLETED') return fail(res, 'Mặt hàng này đã xuất đủ số lượng', 400)

    const { data: inv } = await (supabase.from('InventoryEntry') as any)
      .select('*, qa_status:QAStatus(code,name)')
      .eq('pallet_code', qr)
      .maybeSingle()
    if (!inv) return fail(res, `Pallet "${qr}" chưa được nhập kho — kiểm tra lại phiếu nhập inbound`, 404)

    if (inv.qa_status_id && inv.qa_status?.code !== 'OK') {
      return fail(res, `Pallet bị giữ QA: ${inv.qa_status?.name ?? inv.qa_status_id} — không được xuất`, 400)
    }

    // Kiểm tra % shelf life còn lại nếu item có yêu cầu
    const dateReqPct = Number(item.date_required ?? 0)
    if (dateReqPct > 0) {
      const matId = item.material_id ?? inv.material_id
      const { data: mat } = matId
        ? await (supabase.from('Material') as any).select('shelf_life_days').eq('id', matId).single()
        : { data: null }
      const shelfLifeDays = mat?.shelf_life_days ? Number(mat.shelf_life_days) : 0
      if (!shelfLifeDays) {
        return fail(res, `Mặt hàng chưa có Shelf Life — không thể kiểm tra %Date`, 400)
      }
      const prodDate = inv.production_date ? new Date(inv.production_date) : null
      if (!prodDate || isNaN(prodDate.getTime())) {
        return fail(res, `Pallet "${qr}" không có NSX — không thể kiểm tra %Date`, 400)
      }
      const today      = new Date()
      const expiryMs   = prodDate.getTime() + shelfLifeDays * 86_400_000
      const remainDays = (expiryMs - today.getTime()) / 86_400_000
      const remainPct  = (remainDays / shelfLifeDays) * 100
      if (remainPct < dateReqPct) {
        return fail(res,
          `%Date còn lại: ${Math.floor(remainPct)}% < yêu cầu ${dateReqPct}% (NSX ${inv.production_date}, HSD ${shelfLifeDays} ngày)`,
          400
        )
      }
    }

    if (item.material_id && inv.material_id !== item.material_id) {
      return fail(res, `Sai mã hàng — pallet "${inv.material_id}" không khớp với phiếu "${item.material_id}"`, 400)
    }

    const { data: dupCheck } = await (supabase.from('OutboundScanEntry') as any)
      .select('id').eq('item_id', itemId).eq('pallet_code', qr).maybeSingle()
    if (dupCheck) return fail(res, `Pallet "${qr}" đã được quét trong phiếu này`, 400)

    const available        = Number(inv.cartons_remaining ?? inv.cartons_imported)
    if (available <= 0) return fail(res, `Pallet "${qr}" đã xuất hết số thùng`, 400)
    const remaining_on_item = Number(item.cartons_ordered) - Number(item.cartons_scanned)
    if (remaining_on_item <= 0) return fail(res, 'Mặt hàng đã đủ số lượng', 400)
    const cap     = Math.min(available, remaining_on_item)
    const to_take = cartons_override ? Math.min(Math.max(1, Number(cartons_override)), cap) : cap

    const t = now()

    if (to_take >= available) {
      await (supabase.from('InventoryEntry') as any)
        .update({ status: 'EXPORTED', cartons_remaining: 0, updated_at: t }).eq('id', inv.id)
    } else {
      await (supabase.from('InventoryEntry') as any)
        .update({ status: 'PARTIAL', cartons_remaining: available - to_take, updated_at: t }).eq('id', inv.id)
    }

    const scanId = randomUUID()
    await (supabase.from('OutboundScanEntry') as any).insert({
      id: scanId, item_id: itemId, inventory_entry_id: inv.id,
      pallet_code: qr, cartons_scanned: to_take,
      scanned_by: employee_id ?? null, scanned_at: t,
      created_at: t, updated_at: t,
    })

    const new_scanned    = Number(item.cartons_scanned) + to_take
    const new_item_status = new_scanned >= Number(item.cartons_ordered) ? 'COMPLETED' : 'IN_PROGRESS'
    await (supabase.from('OutboundItem') as any)
      .update({ cartons_scanned: new_scanned, status: new_item_status, updated_at: t }).eq('id', itemId)

    const { data: siblingItems } = await (supabase.from('OutboundItem') as any)
      .select('status').eq('do_id', item.do_id)
    const doCompleted = (siblingItems ?? []).every((i: any) =>
      i.id === itemId ? new_item_status === 'COMPLETED' : i.status === 'COMPLETED'
    )
    const { data: doRow } = await (supabase.from('OutboundDelivery') as any)
      .update({ status: doCompleted ? 'COMPLETED' : 'IN_PROGRESS', updated_at: t })
      .eq('id', item.do_id).select('gdo_id').single()

    if (doRow?.gdo_id) {
      const { data: siblingDOs } = await (supabase.from('OutboundDelivery') as any)
        .select('status').eq('gdo_id', doRow.gdo_id)
      const gdoCompleted = (siblingDOs ?? []).every((d: any) =>
        d.id === item.do_id ? doCompleted : d.status === 'COMPLETED'
      )
      await (supabase.from('GroupDeliveryOrder') as any)
        .update({
          status:           gdoCompleted ? 'COMPLETED' : 'IN_PROGRESS',
          last_scanned_at:  t,
          ...(gdoCompleted ? { completed_at: t } : {}),
          updated_at:       t,
        })
        .eq('id', doRow.gdo_id)
    }

    return ok(res, {
      scan_entry: { id: scanId, pallet_code: qr, cartons_scanned: to_take },
      item: { ...item, cartons_scanned: new_scanned, status: new_item_status },
    })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Delete scan entry (hủy QR đã quét) ─────────────────────

export async function deleteScanEntry(req: Request, res: Response) {
  try {
    const { gdoId, itemId, scanId } = req.params

    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('status').eq('id', gdoId).single()
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể xóa QR', 400)

    const { data: scan } = await (supabase.from('OutboundScanEntry') as any)
      .select('*').eq('id', scanId).eq('item_id', itemId).single()
    if (!scan) return fail(res, 'Không tìm thấy bản ghi quét', 404)

    const t = now()

    // Restore inventory
    if (scan.inventory_entry_id) {
      const { data: inv } = await (supabase.from('InventoryEntry') as any)
        .select('cartons_remaining, cartons_imported').eq('id', scan.inventory_entry_id).single()
      if (inv) {
        const restored  = Number(inv.cartons_remaining ?? 0) + Number(scan.cartons_scanned)
        const maxImport = Number(inv.cartons_imported)
        const invStatus = restored >= maxImport ? 'IN_STOCK' : 'PARTIAL'
        await (supabase.from('InventoryEntry') as any)
          .update({ cartons_remaining: restored, status: invStatus, updated_at: t })
          .eq('id', scan.inventory_entry_id)
      }
    }

    await (supabase.from('OutboundScanEntry') as any).delete().eq('id', scanId)

    // Recalculate item
    const { data: item } = await (supabase.from('OutboundItem') as any)
      .select('*').eq('id', itemId).single()
    if (item) {
      const { data: remainingScans } = await (supabase.from('OutboundScanEntry') as any)
        .select('cartons_scanned').eq('item_id', itemId)
      const newCartons  = (remainingScans ?? []).reduce((s: number, e: any) => s + Number(e.cartons_scanned), 0)
      const newItemStatus = newCartons === 0 ? 'PENDING'
        : newCartons >= Number(item.cartons_ordered) ? 'COMPLETED'
        : 'IN_PROGRESS'
      await (supabase.from('OutboundItem') as any)
        .update({ cartons_scanned: newCartons, status: newItemStatus, updated_at: t }).eq('id', itemId)

      // Recalculate DO
      const { data: siblingItems } = await (supabase.from('OutboundItem') as any)
        .select('id, status').eq('do_id', item.do_id)
      const allStatuses = (siblingItems ?? []).map((i: any) =>
        i.id === itemId ? newItemStatus : i.status
      )
      const doCompleted   = allStatuses.every((s: string) => s === 'COMPLETED')
      const doAnyProgress = allStatuses.some((s: string) => s !== 'PENDING')
      const doStatus      = doCompleted ? 'COMPLETED' : doAnyProgress ? 'IN_PROGRESS' : 'PENDING'
      const { data: doRow } = await (supabase.from('OutboundDelivery') as any)
        .update({ status: doStatus, updated_at: t })
        .eq('id', item.do_id).select('gdo_id').single()

      // Recalculate GDO (respect started_at — once started, minimum IN_PROGRESS)
      if (doRow?.gdo_id) {
        const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
          .select('started_at').eq('id', gdoId).single()
        const { data: siblingDOs } = await (supabase.from('OutboundDelivery') as any)
          .select('id, status').eq('gdo_id', doRow.gdo_id)
        const doStatuses = (siblingDOs ?? []).map((d: any) =>
          d.id === item.do_id ? doStatus : d.status
        )
        const gdoCompleted   = doStatuses.every((s: string) => s === 'COMPLETED')
        const gdoAnyProgress = doStatuses.some((s: string) => s !== 'PENDING')
        let gdoStatus = gdoCompleted ? 'COMPLETED' : gdoAnyProgress ? 'IN_PROGRESS' : 'PENDING'
        if (gdo?.started_at && gdoStatus === 'PENDING') gdoStatus = 'IN_PROGRESS'
        await (supabase.from('GroupDeliveryOrder') as any)
          .update({ status: gdoStatus, updated_at: t }).eq('id', doRow.gdo_id)
      }
    }

    return ok(res, { success: true })
  } catch (e) { return fail(res, String(e)) }
}

// ─── Manual complete item (Pallet Loscam) ────────────────────

export async function manualCompleteItem(req: Request, res: Response) {
  try {
    const { gdoId, itemId } = req.params

    const { data: gdo } = await (supabase.from('GroupDeliveryOrder') as any)
      .select('status').eq('id', gdoId).single()
    if (gdo?.status === 'PAUSED') return fail(res, 'Chuyến xe đang tạm dừng — không thể cập nhật', 400)

    const { data: item } = await (supabase.from('OutboundItem') as any)
      .select('*').eq('id', itemId).single()
    if (!item) return fail(res, 'Không tìm thấy mặt hàng', 404)

    const t = now()
    await (supabase.from('OutboundItem') as any)
      .update({ status: 'COMPLETED', cartons_scanned: item.cartons_ordered, updated_at: t }).eq('id', itemId)

    const { data: siblingItems } = await (supabase.from('OutboundItem') as any)
      .select('status').eq('do_id', item.do_id)
    const doCompleted = (siblingItems ?? []).every((i: any) =>
      i.id === itemId ? true : i.status === 'COMPLETED'
    )
    const { data: doRow } = await (supabase.from('OutboundDelivery') as any)
      .update({ status: doCompleted ? 'COMPLETED' : 'IN_PROGRESS', updated_at: t })
      .eq('id', item.do_id).select('gdo_id').single()

    if (doRow?.gdo_id) {
      const { data: siblingDOs } = await (supabase.from('OutboundDelivery') as any)
        .select('status').eq('gdo_id', doRow.gdo_id)
      const gdoCompleted = (siblingDOs ?? []).every((d: any) =>
        d.id === item.do_id ? doCompleted : d.status === 'COMPLETED'
      )
      await (supabase.from('GroupDeliveryOrder') as any)
        .update({
          status:     gdoCompleted ? 'COMPLETED' : 'IN_PROGRESS',
          ...(gdoCompleted ? { completed_at: t } : {}),
          updated_at: t,
        })
        .eq('id', doRow.gdo_id)
    }

    return ok(res, { success: true })
  } catch (e) { return fail(res, String(e)) }
}
