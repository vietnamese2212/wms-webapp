import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { parseInboundQR } from '../../utils/qrParser'
import { emitInboundChanged } from '../../lib/events'

// ─── Select strings ──────────────────────────────────────────

const ORDER_SELECT = `
  id, import_code, warehouse_id, location_id, material_id, planned_pallets, shift_id, status,
  imported_by, created_by, updated_by, import_date, notes, created_at, updated_at,
  warehouse:Warehouse(id, code, name),
  location:Location(id, location_code, sub_code, max_pallets),
  material:Material(id, material_code, short_name, material_description, cartons_per_pallet, cartons_per_pallet_mn),
  shift:ImportShift(id, code, name),
  imported_by_emp:Employee!imported_by(id, name),
  created_by_emp:Employee!created_by(id, name),
  updated_by_emp:Employee!updated_by(id, name)
`.trim()

const ENTRY_SELECT = `
  id, pallet_code, location_id, material_id, manufacturer_id, cycle, machine_code,
  pallet_sequence_no, qa_status_id,
  import_order_id, created_by, updated_by, stack_layer, cartons_imported, production_date,
  status, notes, created_at, updated_at,
  location:Location(id, location_code, sub_code),
  material:Material(id, material_code, short_name),
  manufacturer:Manufacturer(id, code, name),
  qa_status:QAStatus(id, code, name),
  created_by_emp:Employee!created_by(id, name),
  updated_by_emp:Employee!updated_by(id, name)
`.trim()

// ─── Helpers ─────────────────────────────────────────────────

function generateImportCode(date: Date, seq: number): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `NK-${y}${m}${d}-${String(seq).padStart(3, '0')}`
}

async function attachCount(order: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { count } = await supabase
    .from('InventoryEntry')
    .select('*', { count: 'exact', head: true })
    .eq('import_order_id', order.id as string)
  return { ...order, _count: { inventory_entries: count ?? 0 } }
}

// ─── List inbound orders ─────────────────────────────────────

export async function listOrders(req: Request, res: Response) {
  try {
    const { warehouse_id, status, material_id, search } = req.query as Record<string, string>

    let query = supabase.from('ProductionImport').select(ORDER_SELECT).order('created_at', { ascending: false })

    if (warehouse_id) query = query.eq('warehouse_id', warehouse_id)
    if (status)       query = query.eq('status', status)
    if (material_id)  query = query.eq('material_id', material_id)

    if (search) {
      // Step 1: find material IDs matching the search term
      const { data: mats } = await supabase
        .from('Material').select('id')
        .or(`material_code.ilike.%${search}%,short_name.ilike.%${search}%`)
      const matIds = (mats ?? []).map((m: { id: string }) => m.id)

      const filters = [`import_code.ilike.%${search}%`]
      if (matIds.length > 0) filters.push(`material_id.in.(${matIds.join(',')})`)
      query = query.or(filters.join(','))
    }

    const { data, error } = await query
    if (error) throw error

    // Add _count.inventory_entries for each order in parallel
    const result = await Promise.all((data ?? []).map(attachCount))
    ok(res, result)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Create inbound order ────────────────────────────────────

export async function createOrder(req: Request, res: Response) {
  try {
    const { warehouse_id, material_id, location_id, planned_pallets, shift_id, notes, imported_by } = req.body
    if (!warehouse_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id')
    if (!material_id)  return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu material_id')

    // Count today's orders for import_code sequence
    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const todayEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()

    const { count: todayCount } = await supabase
      .from('ProductionImport')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart)
      .lt('created_at', todayEnd)

    const import_code = generateImportCode(today, (todayCount ?? 0) + 1)

    const { data: order, error } = await supabase
      .from('ProductionImport')
      .insert({
        id:              randomUUID(),
        import_code,
        warehouse_id,
        material_id,
        location_id:     location_id ?? null,
        planned_pallets: planned_pallets ? Number(planned_pallets) : null,
        shift_id:        shift_id ?? null,
        notes:           notes ?? null,
        imported_by:     imported_by ?? null,
        created_by:      imported_by ?? null,
        status:          'OPEN',
        updated_at:      new Date().toISOString(),
      })
      .select(ORDER_SELECT)
      .single()

    if (error) {
      if (error.code === '23505') return fail(res, 409, 'DUPLICATE', 'Mã phiếu đã tồn tại')
      if (error.code === '23503') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho hoặc hàng hóa')
      throw error
    }

    const suggestions = await getLocationSuggestionsData(warehouse_id, material_id)
    emitInboundChanged()
    ok(res, { order: { ...order, _count: { inventory_entries: 0 } }, location_suggestions: suggestions })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Get single order ────────────────────────────────────────

export async function getOrder(req: Request, res: Response) {
  try {
    const [{ data: order, error: oErr }, { data: entries, error: eErr }] = await Promise.all([
      supabase.from('ProductionImport').select(ORDER_SELECT).eq('id', req.params.id).maybeSingle(),
      supabase.from('InventoryEntry').select(ENTRY_SELECT).eq('import_order_id', req.params.id).order('created_at'),
    ])
    if (oErr) throw oErr
    if (eErr) throw eErr
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')

    ok(res, {
      ...order,
      inventory_entries: entries ?? [],
      _count: { inventory_entries: entries?.length ?? 0 },
    })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Update order header ─────────────────────────────────────

export async function updateOrder(req: Request, res: Response) {
  try {
    const { location_id, planned_pallets, shift_id, notes, updated_by } = req.body

    const { data: existing } = await supabase
      .from('ProductionImport').select('status').eq('id', req.params.id).maybeSingle()
    if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (existing.status !== 'OPEN') return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng, không thể sửa')

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (location_id     !== undefined) patch.location_id = location_id
    if (planned_pallets !== undefined) patch.planned_pallets = Number(planned_pallets)
    if (shift_id        !== undefined) patch.shift_id = shift_id
    if (notes           !== undefined) patch.notes = notes
    if (updated_by      !== undefined) patch.updated_by = updated_by

    const { data: updated, error } = await supabase
      .from('ProductionImport').update(patch).eq('id', req.params.id).select(ORDER_SELECT).maybeSingle()
    if (error) throw error
    if (!updated) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')

    const withCount = await attachCount(updated as Record<string, unknown>)
    emitInboundChanged()
    ok(res, withCount)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Complete order ──────────────────────────────────────────

export async function completeOrder(req: Request, res: Response) {
  try {
    const { data: existing } = await supabase
      .from('ProductionImport').select('status').eq('id', req.params.id).maybeSingle()
    if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (existing.status === 'COMPLETED') return fail(res, 400, 'ALREADY_COMPLETED', 'Phiếu nhập đã hoàn thành')
    if (existing.status === 'CANCELLED') return fail(res, 400, 'ORDER_CANCELLED', 'Phiếu nhập đã bị hủy')

    const { data: updated, error } = await supabase
      .from('ProductionImport')
      .update({ status: 'COMPLETED', updated_by: req.body.updated_by ?? null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select(ORDER_SELECT).maybeSingle()
    if (error) throw error

    const withCount = await attachCount(updated as Record<string, unknown>)
    emitInboundChanged()
    ok(res, withCount)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Cancel order ────────────────────────────────────────────

export async function cancelOrder(req: Request, res: Response) {
  try {
    const { data: existing } = await supabase
      .from('ProductionImport').select('status').eq('id', req.params.id).maybeSingle()
    if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (existing.status === 'COMPLETED') return fail(res, 400, 'ALREADY_COMPLETED', 'Phiếu nhập đã hoàn thành, không thể hủy')

    const { data: updated, error } = await supabase
      .from('ProductionImport')
      .update({ status: 'CANCELLED', updated_by: req.body.updated_by ?? null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select(ORDER_SELECT).maybeSingle()
    if (error) throw error

    const withCount = await attachCount(updated as Record<string, unknown>)
    emitInboundChanged()
    ok(res, withCount)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Scan QR → create InventoryEntry ────────────────────────

export async function scanQR(req: Request, res: Response) {
  try {
    const { id: order_id } = req.params
    const { qr_code, location_id, stack_layer = 1, cartons_override, qa_status_id, employee_id } = req.body

    if (!qr_code)     return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu qr_code')
    if (!location_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu location_id')

    // Load order with material
    const { data: order } = await supabase
      .from('ProductionImport')
      .select('id, status, material_id, material:Material(material_code, cartons_per_pallet)')
      .eq('id', order_id).maybeSingle()
    if (!order)                     return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN')    return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập không còn ở trạng thái mở')
    if (!order.material_id)         return fail(res, 400, 'NO_MATERIAL', 'Phiếu nhập chưa có hàng hóa')

    // Parse QR
    const parsed = parseInboundQR(qr_code)
    if (!parsed.is_valid) return fail(res, 400, 'INVALID_QR', parsed.error ?? 'QR không hợp lệ')

    // Parallel: material lookup + duplicate check + location lookup
    const [matResult, dupResult, locResult] = await Promise.all([
      supabase.from('Material').select('*').eq('material_code', parsed.material_code).maybeSingle(),
      supabase.from('InventoryEntry').select('id').eq('pallet_code', parsed.pallet_code).maybeSingle(),
      supabase.from('Location').select('*').eq('id', location_id).maybeSingle(),
    ])

    const material     = matResult.data
    const existingPallet = dupResult.data
    const location     = locResult.data

    if (!material) {
      return fail(res, 400, 'MATERIAL_NOT_FOUND',
        `Mã hàng "${parsed.material_code}" từ QR không tồn tại trong hệ thống`)
    }
    if (material.id !== order.material_id) {
      const orderMat = order.material as { material_code?: string } | null
      return fail(res, 400, 'MATERIAL_MISMATCH',
        `Hàng hóa không khớp: QR có "${parsed.material_code}" (${material.material_description}) nhưng phiếu nhập yêu cầu "${orderMat?.material_code}"`)
    }
    if (existingPallet) return fail(res, 409, 'DUPLICATE_PALLET', `Pallet "${parsed.pallet_code}" đã được nhập kho`)
    if (!location)      return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí kho')
    if (!location.is_active) return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí kho không hoạt động')

    const stackLayerNum = Number(stack_layer)
    if (stackLayerNum === 1) {
      const { count: usedSlots } = await supabase
        .from('InventoryEntry')
        .select('*', { count: 'exact', head: true })
        .eq('location_id', location_id)
        .eq('stack_layer', 1)
        .eq('status', 'IN_STOCK')
      if ((usedSlots ?? 0) >= location.max_pallets) {
        return fail(res, 422, 'LOCATION_FULL',
          `Vị trí ${location.location_code} đã đầy (${usedSlots}/${location.max_pallets} pallet). Chọn tầng chồng (layer 2/3) hoặc vị trí khác.`)
      }
    } else {
      const { data: baseArr } = await supabase
        .from('InventoryEntry').select('id')
        .eq('location_id', location_id)
        .eq('stack_layer', stackLayerNum - 1)
        .eq('status', 'IN_STOCK')
        .limit(1)
      if (!baseArr?.[0]) {
        return fail(res, 422, 'NO_BASE_LAYER',
          `Không có pallet tầng ${stackLayerNum - 1} tại vị trí này để chồng lên`)
      }
    }

    // Lookup manufacturer by code
    const manufacturer = parsed.manufacturer_code
      ? (await supabase.from('Manufacturer').select('id, code, name').eq('code', parsed.manufacturer_code).maybeSingle()).data
      : null

    const cartons_imported = cartons_override
      ? Number(cartons_override)
      : (material.cartons_per_pallet ?? 0)

    const { data: entry, error: entErr } = await supabase
      .from('InventoryEntry')
      .insert({
        id:              randomUUID(),
        pallet_code:     parsed.pallet_code,
        location_id,
        material_id:     material.id,
        manufacturer_id: manufacturer?.id ?? null,
        cycle:              parsed.cycle || null,
        machine_code:       parsed.machine_code || null,
        pallet_sequence_no: parsed.pallet_sequence_no,
        stack_layer:        stackLayerNum,
        cartons_imported,
        production_date:    parsed.production_date,
        qa_status_id:       qa_status_id ?? null,
        import_order_id:    order_id,
        created_by:         employee_id ?? null,
        updated_by:         employee_id ?? null,
        status:             'IN_STOCK',
        updated_at:         new Date().toISOString(),
      })
      .select(ENTRY_SELECT)
      .single()

    if (entErr) {
      if (entErr.code === '23505') return fail(res, 409, 'DUPLICATE_PALLET', 'Pallet đã tồn tại trong hệ thống')
      throw entErr
    }

    const warnings: string[] = []
    if (!manufacturer && parsed.manufacturer_code) {
      warnings.push(`NMSX "${parsed.manufacturer_code}" chưa có trong hệ thống – đã bỏ qua`)
    }
    if (cartons_imported === 0) {
      warnings.push('Số thùng/pallet chưa được cấu hình cho hàng hóa này – đã nhập 0')
    }

    emitInboundChanged()
    ok(res, { entry, warnings })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Update a pallet entry ───────────────────────────────────

export async function updateEntry(req: Request, res: Response) {
  try {
    const { id: order_id, entryId } = req.params
    const { cartons_imported, stack_layer } = req.body

    const [{ data: order }, { data: entry }] = await Promise.all([
      supabase.from('ProductionImport').select('status').eq('id', order_id).maybeSingle(),
      supabase.from('InventoryEntry').select('id, import_order_id').eq('id', entryId).maybeSingle(),
    ])
    if (!order)                              return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN')             return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng')
    if (!entry)                              return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
    if (entry.import_order_id !== order_id)  return fail(res, 400, 'ENTRY_NOT_IN_ORDER', 'Pallet không thuộc phiếu nhập này')

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (cartons_imported !== undefined) patch.cartons_imported = Number(cartons_imported)
    if (stack_layer      !== undefined) patch.stack_layer = Number(stack_layer)

    const { data: updated, error } = await supabase
      .from('InventoryEntry').update(patch).eq('id', entryId).select(ENTRY_SELECT).maybeSingle()
    if (error) throw error
    if (!updated) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')

    emitInboundChanged()
    ok(res, updated)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Remove a pallet entry from order ───────────────────────

export async function removeEntry(req: Request, res: Response) {
  try {
    const { id: order_id, entryId } = req.params

    const [{ data: order }, { data: entry }] = await Promise.all([
      supabase.from('ProductionImport').select('status').eq('id', order_id).maybeSingle(),
      supabase.from('InventoryEntry').select('id, import_order_id').eq('id', entryId).maybeSingle(),
    ])
    if (!order)                              return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN')             return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng')
    if (!entry)                              return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
    if (entry.import_order_id !== order_id)  return fail(res, 400, 'ENTRY_NOT_IN_ORDER', 'Pallet không thuộc phiếu nhập này')

    const { error } = await supabase.from('InventoryEntry').delete().eq('id', entryId)
    if (error) throw error

    emitInboundChanged()
    ok(res, { deleted: true })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Location suggestions ────────────────────────────────────

export async function getLocationSuggestions(req: Request, res: Response) {
  try {
    const { data: order } = await supabase
      .from('ProductionImport').select('warehouse_id, material_id').eq('id', req.params.id).maybeSingle()
    if (!order)               return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (!order.warehouse_id)  return fail(res, 400, 'NO_WAREHOUSE', 'Phiếu nhập chưa có kho')

    ok(res, await getLocationSuggestionsData(order.warehouse_id, order.material_id))
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Internal helper ─────────────────────────────────────────

async function getLocationSuggestionsData(warehouse_id: string, material_id: string | null) {
  const { data: locations } = await supabase
    .from('Location')
    .select('id, location_code, sub_code, sub_name, max_pallets')
    .eq('warehouse_id', warehouse_id)
    .eq('is_active', true)

  if (!locations?.length) return []

  // For each location, get layer-1 IN_STOCK entry count and check for same-material entries
  const withSlots = await Promise.all(
    locations.map(async (loc) => {
      const { data: entries } = await supabase
        .from('InventoryEntry')
        .select('id, material_id')
        .eq('location_id', loc.id)
        .eq('stack_layer', 1)
        .eq('status', 'IN_STOCK')

      const used_slots = entries?.length ?? 0
      const available_slots = loc.max_pallets - used_slots
      const has_same_material = material_id
        ? (entries ?? []).some((e: { material_id: string }) => e.material_id === material_id)
        : false

      return { id: loc.id, location_code: loc.location_code, sub_code: loc.sub_code, sub_name: loc.sub_name, max_pallets: loc.max_pallets, used_slots, available_slots, has_same_material }
    })
  )

  return withSlots
    .filter((loc) => loc.available_slots > 0)
    .sort((a, b) => {
      if (a.has_same_material !== b.has_same_material) return b.has_same_material ? 1 : -1
      return b.available_slots - a.available_slots
    })
    .slice(0, 10)
}
