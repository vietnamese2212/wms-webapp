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
  source_type, gate_registration_id, tms_order_id, planned_cartons, warehouse_type, from_gdo_id, posm_entry_id, posm_cartons,
  warehouse:Warehouse(id, code, name),
  location:Location(id, location_code, sub_code, max_pallets),
  material:Material(id, material_code, short_name, material_description, cartons_per_pallet, cartons_per_pallet_mn, category, no_qr_tracking),
  shift:ImportShift(id, code, name),
  gate_registration:gate_registrations!gate_registration_id(id, registration_number, date, license_plate, company_name_raw, driver_name, status, direction),
  tms_order:TmsOrder!tms_order_id(id, order_code, planned_boxes, planned_pallets),
  imported_by_emp:Employee!imported_by(id, name),
  created_by_emp:Employee!created_by(id, name),
  updated_by_emp:Employee!updated_by(id, name)
`.trim()

const ENTRY_SELECT = `
  id, pallet_code, location_id, material_id, manufacturer_id, cycle, machine_code,
  pallet_sequence_no, qa_status_id,
  import_order_id, created_by, updated_by, stack_layer, cartons_imported, production_date,
  status, notes, import_date, update_date, created_at, updated_at,
  location:Location(id, location_code, sub_code),
  material:Material(id, material_code, short_name),
  manufacturer:Manufacturer(id, code, name),
  qa_status:QAStatus(id, code, name),
  created_by_emp:Employee!created_by(id, name),
  updated_by_emp:Employee!updated_by(id, name)
`.trim()

// ─── Helpers ─────────────────────────────────────────────────

// Trả về YYYY-MM-DD theo giờ Hà Nội (UTC+7)
function vnDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
}

function generateImportCode(whCode: string, ddmmyy: string, seq: number): string {
  return `${whCode}_N_${ddmmyy}_${String(seq).padStart(2, '0')}`
}

async function computeGdoTotalCartons(gdoId: string, materialId: string | null): Promise<number | null> {
  const { data: dos } = await (supabase.from('OutboundDelivery') as any).select('id').eq('gdo_id', gdoId)
  const doIds = (dos ?? []).map((d: any) => d.id as string)
  if (!doIds.length) return null

  let itemQuery = (supabase.from('OutboundItem') as any).select('id').in('do_id', doIds)
  if (materialId) itemQuery = itemQuery.eq('material_id', materialId)
  const { data: items } = await itemQuery
  const itemIds = (items ?? []).map((i: any) => i.id as string)
  if (!itemIds.length) return null

  const { data: scans } = await (supabase.from('OutboundScanEntry') as any)
    .select('cartons_scanned').in('item_id', itemIds)
  return (scans ?? []).reduce((sum: number, s: any) => sum + (Number(s.cartons_scanned) || 0), 0)
}

async function attachCount(raw: unknown): Promise<Record<string, unknown>> {
  const order = raw as Record<string, unknown>
  const locationId = order.location_id as string | null
  const fromGdoId = order.from_gdo_id as string | null
  const isTransfer = order.source_type === 'TRANSFER'

  const [entriesRes, slotsRes, gdoCartons] = await Promise.all([
    supabase.from('InventoryEntry')
      .select('pallet_code, cartons_imported, cycle, machine_code, location:Location(location_code, sub_code)')
      .eq('import_order_id', order.id as string),
    locationId
      ? supabase.from('InventoryEntry').select('*', { count: 'exact', head: true })
          .eq('location_id', locationId).eq('stack_layer', 1).in('status', ['IN_STOCK', 'PARTIAL'])
      : Promise.resolve({ count: 0, data: null, error: null }),
    isTransfer && fromGdoId && order.planned_cartons == null
      ? computeGdoTotalCartons(fromGdoId, order.material_id as string | null)
      : Promise.resolve(null),
  ])

  const entries = (entriesRes.data ?? []) as unknown as {
    pallet_code: string | null
    cartons_imported: number
    cycle: string | null
    machine_code: string | null
    location: { location_code: string; sub_code: string } | null
  }[]
  const cycles       = [...new Set(entries.map(e => e.cycle).filter((c): c is string => !!c))]
  const machine_codes = [...new Set(entries.map(e => e.machine_code).filter((m): m is string => !!m))]

  // Aggregate theo location thực tế của từng pallet entry (không phụ thuộc vào order.location_id)
  const locMap = new Map<string, { pallets: number; cartons: number }>()
  for (const e of entries) {
    const loc = e.location ? `${e.location.location_code}-${e.location.sub_code}` : '(chưa xác định)'
    const cur = locMap.get(loc) ?? { pallets: 0, cartons: 0 }
    cur.pallets++
    cur.cartons += e.cartons_imported || 0
    locMap.set(loc, cur)
  }
  const entries_by_location = [...locMap.entries()].map(([loc, v]) => ({ loc, ...v }))

  // Tính đúng số pallet và thùng cho shared POSM/Loscam pallet
  const posmEntryId  = (order as any).posm_entry_id as string | null
  const posmCartons  = (order as any).posm_cartons  as number | null
  const materialCode = (order as any).material?.material_code as string | null
  let count        = entries.length
  let total_cartons = entries.reduce((sum, e) => sum + (e.cartons_imported || 0), 0)

  if (posmEntryId && posmCartons != null) {
    const sharedInMyEntries = materialCode ? entries.find(e => e.pallet_code === materialCode) : null
    if (sharedInMyEntries) {
      // Phiếu này TẠO shared entry → thay thế tổng cộng dồn bằng đóng góp thực của phiếu
      total_cartons = total_cartons - (sharedInMyEntries.cartons_imported || 0) + posmCartons
    } else if (posmCartons > 0) {
      // Phiếu này CỘNG VÀO shared entry có sẵn → thêm đóng góp vào tổng
      total_cartons += posmCartons
      count += 1
    }
  }

  return {
    ...order,
    planned_cartons: order.planned_cartons != null ? order.planned_cartons : (gdoCartons ?? null),
    _count: { inventory_entries: count },
    total_cartons,
    cycles,
    machine_codes,
    location_used_slots: slotsRes.count ?? 0,
    entries_by_location,
  }
}

// ─── List inbound orders ─────────────────────────────────────

export async function listOrders(req: Request, res: Response) {
  try {
    const { warehouse_id, status, material_id, material_category, search, date, date_from, date_to, shift_id, from_gdo_id } = req.query as Record<string, string>

    let query = supabase.from('ProductionImport').select(ORDER_SELECT)
      .order('import_date', { ascending: false })
      .order('created_at',  { ascending: false })

    // Enforce user's warehouse scope from JWT
    const scopeWarehouses = req.user?.warehouse_scope !== 'NATIONAL'
      ? (req.user?.warehouse_ids ?? [])
      : []
    if (scopeWarehouses.length > 0) {
      const effective = warehouse_id
        ? scopeWarehouses.filter(id => id === warehouse_id)
        : scopeWarehouses
      if (effective.length === 0) { ok(res, []); return }
      query = effective.length === 1
        ? query.eq('warehouse_id', effective[0])
        : query.in('warehouse_id', effective)
    } else if (warehouse_id) {
      query = query.eq('warehouse_id', warehouse_id)
    }

    if (status)      query = query.eq('status', status)
    else             query = query.neq('status', 'CANCELLED')
    if (material_id) query = query.eq('material_id', material_id)
    if (shift_id)    query = query.eq('shift_id', shift_id)
    if (from_gdo_id) query = query.eq('from_gdo_id', from_gdo_id)

    // Lọc theo warehouse_type lưu trực tiếp trên order
    // NATIONAL scope: không giới hạn category, chỉ lọc theo query param nếu có
    const normCat = (c: string) => c === 'TP' ? 'Thành phẩm' : c === 'BAO_BI' ? 'Bao bì' : c
    const isNational = req.user?.warehouse_scope === 'NATIONAL'
    const scopeCategories = isNational ? [] : (req.user?.allowed_categories ?? []).map(normCat)

    if (material_category) {
      // TRANSFER imports always visible regardless of warehouse_type — use or() to bypass
      query = query.or(`warehouse_type.eq."${material_category}",source_type.eq.TRANSFER`)
    }
    // scopeCategories: không lọc ở PostgREST — áp dụng sau khi có data (tránh lỗi .or() với tiếng Việt)

    // Date range – support legacy ?date= and new ?date_from= / ?date_to=
    const from = date_from || date
    const to   = date_to   || date
    if (from) query = query.gte('import_date', from)
    if (to) {
      const [y, m, d] = to.split('-').map(Number)
      const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
      query = query.lt('import_date', nextDay)
    }

    if (search) {
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

    // Post-filter: TRANSFER luôn hiển thị bất kể category scope của user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let filtered: any[] = data ?? []
    if (!material_category && scopeCategories.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filtered = filtered.filter((o: any) =>
        o.source_type === 'TRANSFER' || scopeCategories.includes(o.warehouse_type ?? '')
      )
    }

    const withCount = await Promise.all(filtered.map(attachCount))

    // Batch-fetch delivery codes for TRANSFER orders
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transferGdoIds = [...new Set(filtered.filter((o: any) => o.source_type === 'TRANSFER' && o.from_gdo_id).map((o: any) => o.from_gdo_id as string))]
    const codesByGdo = new Map<string, string[]>()
    if (transferGdoIds.length > 0) {
      const { data: dos } = await (supabase.from('OutboundDelivery') as any).select('gdo_id, delivery_code').in('gdo_id', transferGdoIds)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of (dos ?? []) as any[]) {
        if (!d.delivery_code) continue
        const arr = codesByGdo.get(d.gdo_id) ?? []
        arr.push(d.delivery_code)
        codesByGdo.set(d.gdo_id, arr)
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = withCount.map((o: any) => ({
      ...o,
      from_gdo_delivery_codes: o.from_gdo_id ? (codesByGdo.get(o.from_gdo_id) ?? []) : [],
    }))
    ok(res, result)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Create inbound order ────────────────────────────────────

export async function createOrder(req: Request, res: Response) {
  try {
    const {
      warehouse_id, material_id, location_id, planned_pallets, shift_id, import_date, notes, imported_by,
      source_type, gate_registration_id, tms_order_id, planned_cartons, warehouse_type, from_gdo_id,
    } = req.body
    if (!warehouse_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id')
    if (!material_id)  return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu material_id')
    const resolvedSourceType = source_type === 'NCC' ? 'NCC' : source_type === 'TRANSFER' ? 'TRANSFER' : 'FACTORY'

    // Check no_qr_tracking: FACTORY không được tạo phiếu cho mã hàng này; NCC/TRANSFER → force location_id = null
    const { data: matCheck } = await supabase.from('Material').select('no_qr_tracking').eq('id', material_id).maybeSingle()
    if (matCheck?.no_qr_tracking === true && resolvedSourceType === 'FACTORY') {
      return fail(res, 400, 'VALIDATION_ERROR', 'Hàng hóa không theo dõi QR không thể nhập theo luồng Nhập SX')
    }
    const resolvedLocationId = matCheck?.no_qr_tracking === true ? null : (location_id ?? null)

    const todayStr = vnDate()

    // Validate imported_by — skip if employee doesn't exist (e.g. mock/dev user IDs)
    let resolvedImportedBy: string | null = null
    if (imported_by) {
      const { data: emp } = await supabase.from('Employee').select('id').eq('id', imported_by).maybeSingle()
      resolvedImportedBy = emp?.id ?? null
    }

    // Enforce: 1 gate_registration = 1 phiếu nhập duy nhất
    // Đồng thời lấy tms_order_id từ gate registration để link báo cáo
    let resolvedTmsOrderId: string | null = tms_order_id ?? null
    if (gate_registration_id) {
      const { data: gateReg } = await supabase
        .from('gate_registrations')
        .select('tms_order_id, id')
        .eq('id', gate_registration_id)
        .maybeSingle()
      if (gateReg) {
        // Kiểm tra đã có phiếu nhập chưa
        const { data: activeImports } = await supabase
          .from('ProductionImport')
          .select('id, import_code')
          .eq('gate_registration_id', gate_registration_id)
          .neq('status', 'CANCELLED')
        if (activeImports && activeImports.length > 0) {
          // Chỉ block nếu ít nhất 1 phiếu đã có pallet quét vào
          const activeIds = (activeImports as { id: string; import_code: string }[]).map(i => i.id)
          const { count: entriesCount } = await supabase
            .from('InventoryEntry')
            .select('id', { count: 'exact', head: true })
            .in('import_order_id', activeIds)
          if (entriesCount && entriesCount > 0)
            return fail(res, 409, 'GATE_REG_TAKEN', `Lượt vào này đã có phiếu nhập ${(activeImports as { import_code: string }[])[0].import_code}`)
          // Không có pallet — xóa phiếu rỗng để cho phép tạo lại
          await supabase.from('ProductionImport')
            .delete()
            .in('id', activeIds)
        }
        // Propagate tms_order_id từ gate registration nếu chưa có
        if (!resolvedTmsOrderId && gateReg.tms_order_id) {
          resolvedTmsOrderId = gateReg.tms_order_id
        }
      }
    }

    // Lấy warehouse code để tạo import_code theo format mới
    const [y, mo, d] = todayStr.split('-')
    const ddmmyy = `${d}${mo}${y.slice(2)}`
    const { data: whRow } = await (supabase.from('Warehouse') as any).select('code').eq('id', warehouse_id).maybeSingle()
    const whCode = whRow?.code ? String(whRow.code) : 'XX'
    const importPrefix = `${whCode}_N_${ddmmyy}_`

    // Retry khi 2 request song song → cùng import_code → 23505
    let order: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existingCodes } = await (supabase.from('ProductionImport') as any)
        .select('import_code').ilike('import_code', `${importPrefix}%`)
      const maxSeq = (existingCodes ?? []).reduce((max: number, r: { import_code: string }) => {
        const n = parseInt(r.import_code.slice(importPrefix.length), 10)
        return isNaN(n) ? max : Math.max(max, n)
      }, 0)

      const import_code = generateImportCode(whCode, ddmmyy, maxSeq + 1)

      const { data, error } = await supabase
        .from('ProductionImport')
        .insert({
          id:                   randomUUID(),
          import_code,
          warehouse_id,
          material_id,
          location_id:          resolvedLocationId,
          planned_pallets:      planned_pallets ? Number(planned_pallets) : null,
          shift_id:             shift_id ?? null,
          import_date:          import_date ? import_date.slice(0, 10) : todayStr,
          notes:                notes ?? null,
          imported_by:          resolvedImportedBy,
          created_by:           resolvedImportedBy,
          status:               'OPEN',
          source_type:          resolvedSourceType,
          warehouse_type:       warehouse_type ?? null,
          gate_registration_id: gate_registration_id ?? null,
          tms_order_id:         resolvedTmsOrderId,
          from_gdo_id:          from_gdo_id ?? null,
          planned_cartons:      planned_cartons ? Number(planned_cartons) : null,
          created_at:           new Date().toISOString(),
          updated_at:           new Date().toISOString(),
        })
        .select(ORDER_SELECT)
        .single()

      if (!error) { order = data; break }
      if (error.code === '23505') continue  // race condition — đếm lại và thử seq tiếp
      if (error.code === '23503') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho hoặc hàng hóa — kiểm tra warehouse_id, material_id, location_id, shift_id')
      throw error
    }

    if (!order) return fail(res, 409, 'DUPLICATE', 'Không thể tạo mã phiếu — thử lại')

    const suggestions = await getLocationSuggestionsData(warehouse_id, material_id)
    emitInboundChanged()
    ok(res, { order: { ...(order as unknown as Record<string, unknown>), _count: { inventory_entries: 0 } }, location_suggestions: suggestions })
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

    let allEntries = entries ?? []

    // POSM/Loscam: shared pallet — hiển thị đóng góp của từng phiếu (posm_cartons), không phải tổng cộng dồn
    const posmEntryId = (order as any).posm_entry_id as string | null
    const posmCartons = (order as any).posm_cartons  as number | null
    if (posmEntryId) {
      const alreadyInList = allEntries.find((e: any) => e.id === posmEntryId)
      if (alreadyInList) {
        // Phiếu này TẠO shared entry — override cartons_imported bằng đóng góp thực (posm_cartons)
        if (posmCartons != null) {
          allEntries = allEntries.map((e: any) =>
            e.id === posmEntryId ? { ...e, cartons_imported: posmCartons, cartons_remaining: posmCartons } : e
          )
        }
        // posm_cartons = null (dữ liệu cũ trước migration) → giữ nguyên để không phá dữ liệu cũ
      } else if (posmCartons != null && posmCartons > 0) {
        // Phiếu này CỘNG VÀO shared entry có sẵn — fetch và hiển thị với đóng góp thực
        const { data: posmEntry } = await supabase
          .from('InventoryEntry').select(ENTRY_SELECT).eq('id', posmEntryId).maybeSingle()
        if (posmEntry) {
          allEntries = [{ ...posmEntry as any, cartons_imported: posmCartons, cartons_remaining: posmCartons }, ...allEntries]
        }
      }
      // posmCartons = null hoặc = 0 và entry không do phiếu này tạo → không hiển thị (đã bấm nhầm hoặc 0 thùng)
    }

    // Attach delivery codes (Số DO) for TRANSFER orders
    const fromGdoId = (order as any).from_gdo_id as string | null
    let fromGdoDeliveryCodes: string[] = []
    if (fromGdoId) {
      const { data: dos } = await (supabase.from('OutboundDelivery') as any)
        .select('delivery_code').eq('gdo_id', fromGdoId)
      fromGdoDeliveryCodes = ((dos ?? []) as any[]).map((d: any) => d.delivery_code).filter(Boolean)
    }

    ok(res, {
      ...(order as unknown as Record<string, unknown>),
      inventory_entries: allEntries,
      _count: { inventory_entries: allEntries.length },
      from_gdo_delivery_codes: fromGdoDeliveryCodes,
    })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Update order header ─────────────────────────────────────

export async function updateOrder(req: Request, res: Response) {
  try {
    const { location_id, planned_pallets, planned_cartons, shift_id, import_date, notes, updated_by } = req.body

    const { data: existing } = await supabase
      .from('ProductionImport').select('status').eq('id', req.params.id).maybeSingle()
    if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (existing.status !== 'OPEN') return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng, không thể sửa')

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (location_id     !== undefined) patch.location_id = location_id
    if (planned_pallets !== undefined) patch.planned_pallets = Number(planned_pallets)
    if (planned_cartons !== undefined) patch.planned_cartons = planned_cartons === null ? null : Number(planned_cartons)
    if (shift_id        !== undefined) patch.shift_id = shift_id
    if (import_date     !== undefined) patch.import_date = import_date
    if (notes           !== undefined) patch.notes = notes
    if (updated_by      !== undefined) patch.updated_by = updated_by

    const { data: updated, error } = await supabase
      .from('ProductionImport').update(patch).eq('id', req.params.id).select(ORDER_SELECT).maybeSingle()
    if (error) throw error
    if (!updated) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')

    const withCount = await attachCount(updated)
    emitInboundChanged()
    ok(res, withCount)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Complete order ──────────────────────────────────────────

export async function completeOrder(req: Request, res: Response) {
  try {
    const { data: existing } = await supabase
      .from('ProductionImport').select('id, status, source_type, tms_order_id').eq('id', req.params.id).maybeSingle()
    if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (existing.status === 'COMPLETED') return fail(res, 400, 'ALREADY_COMPLETED', 'Phiếu nhập đã hoàn thành')

    const nowTs = new Date().toISOString()
    const { data: updated, error } = await supabase
      .from('ProductionImport')
      .update({ status: 'COMPLETED', updated_by: req.body.updated_by ?? null, updated_at: nowTs })
      .eq('id', req.params.id)
      .select(ORDER_SELECT).maybeSingle()
    if (error) throw error

    if (existing.tms_order_id) {
      const { data: allSiblings } = await supabase
        .from('ProductionImport').select('id, status').eq('tms_order_id', existing.tms_order_id)
      const allDone = (allSiblings ?? []).length > 0 && (allSiblings ?? []).every((s: { status: string }) => s.status === 'COMPLETED')
      if (allDone) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: tmsOrder } = await (supabase.from('TmsOrder') as any)
          .select('transfer_gdo_id').eq('id', existing.tms_order_id).maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('TmsOrder') as any)
          .update({ status: 'DONE', completed_at: nowTs, updated_at: nowTs })
          .eq('id', existing.tms_order_id)
        if (existing.source_type === 'TRANSFER' && tmsOrder?.transfer_gdo_id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('GroupDeliveryOrder') as any)
            .update({ transfer_status: 'DELIVERED', updated_at: nowTs })
            .eq('id', tmsOrder.transfer_gdo_id)
        }
      }
    }

    const withCount = await attachCount(updated)
    emitInboundChanged()
    ok(res, withCount)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Uncomplete order (revert COMPLETED → OPEN) ───────────────

export async function uncompleteOrder(req: Request, res: Response) {
  try {
    const { data: existing } = await supabase
      .from('ProductionImport').select('id, status, source_type, tms_order_id').eq('id', req.params.id).maybeSingle()
    if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (existing.status !== 'COMPLETED') return fail(res, 400, 'NOT_COMPLETED', 'Phiếu nhập chưa ở trạng thái hoàn thành')

    const nowTs = new Date().toISOString()
    const { data: updated, error } = await supabase
      .from('ProductionImport')
      .update({ status: 'OPEN', updated_by: req.body.updated_by ?? null, updated_at: nowTs })
      .eq('id', req.params.id)
      .select(ORDER_SELECT).maybeSingle()
    if (error) throw error

    if (existing.tms_order_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tmsOrder } = await (supabase.from('TmsOrder') as any)
        .select('status, transfer_gdo_id').eq('id', existing.tms_order_id).maybeSingle()
      if (tmsOrder?.status === 'DONE') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('TmsOrder') as any)
          .update({ status: 'PENDING', completed_at: null, updated_at: nowTs })
          .eq('id', existing.tms_order_id)
        if (existing.source_type === 'TRANSFER' && tmsOrder.transfer_gdo_id) {
          // Còn phiếu nhập → vẫn đang nhận hàng; chỉ về IN_TRANSIT khi xóa hết phiếu
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('GroupDeliveryOrder') as any)
            .update({ transfer_status: 'RECEIVING', updated_at: nowTs })
            .eq('id', tmsOrder.transfer_gdo_id)
        }
      }
    }

    const withCount = await attachCount(updated)
    emitInboundChanged()
    ok(res, withCount)
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Cancel order ────────────────────────────────────────────

export async function cancelOrder(req: Request, res: Response) {
  try {
    const { data: existing } = await supabase
      .from('ProductionImport')
      .select('status, source_type, from_gdo_id')
      .eq('id', req.params.id).maybeSingle()
    if (!existing) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (existing.status === 'COMPLETED') return fail(res, 400, 'ALREADY_COMPLETED', 'Phiếu nhập đã hoàn thành, không thể hủy')

    const { count: entriesCount } = await supabase
      .from('InventoryEntry').select('id', { count: 'exact', head: true }).eq('import_order_id', req.params.id)
    if (entriesCount && entriesCount > 0)
      return fail(res, 400, 'HAS_ENTRIES', 'Phiếu đã có pallet nhập, xóa hết pallet trước khi hủy')

    const nowTs = new Date().toISOString()
    const { error } = await supabase.from('ProductionImport').delete().eq('id', req.params.id)
    if (error) throw error

    // Nếu là phiếu TRANSFER: kiểm tra còn phiếu nào không
    // Nếu hết → reset GDO transfer_status về IN_TRANSIT để NPP có thể bắt đầu lại
    if (existing.source_type === 'TRANSFER' && existing.from_gdo_id) {
      const { count: activeCount } = await supabase
        .from('ProductionImport')
        .select('id', { count: 'exact', head: true })
        .eq('from_gdo_id', existing.from_gdo_id)
      if (!activeCount || activeCount === 0) {
        await (supabase.from('GroupDeliveryOrder') as any)
          .update({ transfer_status: 'IN_TRANSIT', updated_at: nowTs })
          .eq('id', existing.from_gdo_id)
      }
    }

    emitInboundChanged()
    ok(res, { deleted: true })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Scan QR → create InventoryEntry ────────────────────────

// ─── Check scan validity (no save) ──────────────────────────

export async function checkScanQR(req: Request, res: Response) {
  try {
    const { id: order_id } = req.params
    const { qr_code, location_id, stack_layer = 1 } = req.body as { qr_code: string; location_id: string; stack_layer?: number }

    if (!qr_code)     return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu qr_code')
    if (!location_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu location_id')

    const { data: order } = await supabase
      .from('ProductionImport')
      .select('id, import_code, status, source_type, material_id, warehouse_id, material:Material(material_code, cartons_per_pallet), warehouse:Warehouse(id, nmsx_code)')
      .eq('id', order_id).maybeSingle()
    if (!order)                  return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN') return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập không còn ở trạng thái mở')
    if (!order.material_id)      return fail(res, 400, 'NO_MATERIAL', 'Phiếu nhập chưa có hàng hóa')

    const parsed = parseInboundQR(qr_code)
    if (!parsed.is_valid) return fail(res, 400, 'INVALID_QR', parsed.error ?? 'QR không hợp lệ')

    const orderWarehouseId = (order as any).warehouse_id as string
    const isTransfer = (order as any).source_type === 'TRANSFER'

    const [matResult, dupResult, locResult, obScanResult] = await Promise.all([
      supabase.from('Material').select('id, material_code, cartons_per_pallet').eq('material_code', parsed.material_code).maybeSingle(),
      supabase.from('InventoryEntry').select('id, status, cartons_remaining, import_order_id, location:Location!location_id(warehouse_id)').eq('pallet_code', parsed.pallet_code).in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']),
      supabase.from('Location').select('id, location_code, max_pallets, is_active').eq('id', location_id).maybeSingle(),
      isTransfer
        ? (supabase.from('OutboundScanEntry') as any).select('cartons_scanned').eq('pallet_code', parsed.pallet_code).order('created_at', { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    const material = matResult.data
    const outboundCartons: number | null = isTransfer ? ((obScanResult as any).data?.cartons_scanned ?? null) : null
    const existingPallet = ((dupResult.data ?? []) as any[]).find(
      (e: any) => e.location?.warehouse_id === orderWarehouseId
    ) as { id: string; status: string; cartons_remaining: number; import_order_id: string | null } | undefined
    const location = locResult.data

    if (!material) return fail(res, 400, 'MATERIAL_NOT_FOUND', `Mã hàng "${parsed.material_code}" từ QR không tồn tại trong hệ thống`)
    if (material.id !== order.material_id) {
      const orderMat = order.material as { material_code?: string } | null
      return fail(res, 400, 'MATERIAL_MISMATCH', `Hàng hóa không khớp: QR có "${parsed.material_code}" nhưng phiếu nhập yêu cầu "${orderMat?.material_code}"`)
    }
    if (existingPallet) {
      // TRANSFER + pallet từ phiếu KHÁC (IN_STOCK hoặc PARTIAL) → cho phép merge
      if (isTransfer && ['IN_STOCK', 'PARTIAL'].includes(existingPallet.status) && existingPallet.import_order_id !== order_id) {
        const mat = material as { cartons_per_pallet?: number | null }
        return ok(res, {
          pallet_code:       parsed.pallet_code,
          production_date:   parsed.production_date ?? null,
          suggested_cartons: outboundCartons ?? mat.cartons_per_pallet ?? 0,
          outbound_cartons:  outboundCartons,
          will_merge:        true,
          cartons_existing:  existingPallet.cartons_remaining,
          existing_entry_id: existingPallet.id,
          merge_warning:     `Pallet này còn ${existingPallet.cartons_remaining} thùng trong kho. Quét sẽ cộng thêm số thùng mới vào tồn hiện tại.`,
        })
      }
      // TRANSFER + cùng phiếu = quét nhầm 2 lần → block rõ ràng
      if (isTransfer && existingPallet.import_order_id === order_id) {
        return fail(res, 409, 'DUPLICATE_PALLET', `Pallet "${parsed.pallet_code}" đã được quét trong phiếu nhập này`)
      }
      const msg = existingPallet.status === 'PARTIAL'
        ? `Pallet "${parsed.pallet_code}" còn ${existingPallet.cartons_remaining} thùng trong kho này. Để cộng thêm thùng trả về, dùng chức năng điều chỉnh tồn kho.`
        : `Pallet "${parsed.pallet_code}" đang tồn kho tại đây, chưa được xuất`
      return fail(res, 409, 'DUPLICATE_PALLET', msg)
    }
    if (!location)      return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí kho')
    if (!location.is_active) return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí kho không hoạt động')

    const stackLayerNum = Number(stack_layer)
    if (stackLayerNum === 1) {
      const { count: usedSlots } = await supabase
        .from('InventoryEntry').select('*', { count: 'exact', head: true })
        .eq('location_id', location_id).eq('stack_layer', 1).eq('status', 'IN_STOCK')
      if ((usedSlots ?? 0) >= location.max_pallets) {
        return fail(res, 422, 'LOCATION_FULL',
          `Vị trí ${location.location_code} đã đầy (${usedSlots}/${location.max_pallets} pallet). Chọn tầng chồng hoặc vị trí khác.`)
      }
    } else {
      const { data: baseArr } = await supabase.from('InventoryEntry').select('id')
        .eq('location_id', location_id).eq('stack_layer', stackLayerNum - 1).eq('status', 'IN_STOCK').limit(1)
      if (!baseArr?.[0]) {
        return fail(res, 422, 'NO_BASE_LAYER', `Không có pallet tầng ${stackLayerNum - 1} tại vị trí này để chồng lên`)
      }
    }

    const mat = material as { cartons_per_pallet?: number | null }
    return ok(res, {
      pallet_code:       parsed.pallet_code,
      production_date:   parsed.production_date ?? null,
      suggested_cartons: outboundCartons ?? mat.cartons_per_pallet ?? 0,
      outbound_cartons:  outboundCartons,
    })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function scanQR(req: Request, res: Response) {
  try {
    const { id: order_id } = req.params
    const { qr_code, location_id, stack_layer = 1, cartons_override, qa_status_id, employee_id } = req.body

    if (!qr_code)     return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu qr_code')
    if (!location_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu location_id')

    // Load order with material + source_type
    const { data: order } = await supabase
      .from('ProductionImport')
      .select('id, import_code, status, source_type, material_id, warehouse_id, material:Material(material_code, cartons_per_pallet), warehouse:Warehouse(id, nmsx_code)')
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
      supabase.from('InventoryEntry').select('id, status, cartons_remaining, adjustment_qty, import_order_id, location:Location!location_id(warehouse_id)').eq('pallet_code', parsed.pallet_code).in('status', ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']),
      supabase.from('Location').select('*').eq('id', location_id).maybeSingle(),
    ])

    const material = matResult.data
    const orderWarehouseId = (order as any).warehouse_id as string
    const isTransfer = (order as any).source_type === 'TRANSFER'
    const existingPallet = ((dupResult.data ?? []) as any[]).find(
      (e: any) => e.location?.warehouse_id === orderWarehouseId
    ) as { id: string; status: string; cartons_remaining: number; adjustment_qty: number; import_order_id: string | null } | undefined
    const location = locResult.data

    if (!material) {
      return fail(res, 400, 'MATERIAL_NOT_FOUND',
        `Mã hàng "${parsed.material_code}" từ QR không tồn tại trong hệ thống`)
    }
    if (material.id !== order.material_id) {
      const orderMat = order.material as { material_code?: string } | null
      return fail(res, 400, 'MATERIAL_MISMATCH',
        `Hàng hóa không khớp: QR có "${parsed.material_code}" (${material.material_description}) nhưng phiếu nhập yêu cầu "${orderMat?.material_code}"`)
    }

    // TRANSFER + pallet từ phiếu KHÁC (IN_STOCK hoặc PARTIAL) → merge (cộng tồn)
    if (isTransfer && existingPallet && ['IN_STOCK', 'PARTIAL'].includes(existingPallet.status) && existingPallet.import_order_id !== order_id) {
      const addCartons = cartons_override ? Number(cartons_override) : (material.cartons_per_pallet ?? 0)
      const cartonsBeforeAdjust = Number(existingPallet.cartons_remaining)
      const newRemaining = cartonsBeforeAdjust + addCartons
      const now = new Date().toISOString()
      const importCode = (order as any).import_code as string

      await Promise.all([
        supabase.from('InventoryEntry').update({
          cartons_remaining: newRemaining,
          adjustment_qty:    Number(existingPallet.adjustment_qty ?? 0) + addCartons,
          status:            'IN_STOCK',
          updated_at:        now,
          update_date:       vnDate(),
          updated_by:        employee_id ?? null,
        }).eq('id', existingPallet.id),
        supabase.from('InventoryAdjustmentLog' as any).insert({
          id:             randomUUID(),
          entry_id:       existingPallet.id,
          delta:          addCartons,
          cartons_before: cartonsBeforeAdjust,
          cartons_after:  newRemaining,
          note:           `Nhập trả về từ phiếu transfer ${importCode}`,
          actor_name:     null,
          actor_id:       employee_id ?? null,
          adjusted_at:    now,
        }),
      ])

      emitInboundChanged()
      return ok(res, {
        merged:        true,
        entry_id:      existingPallet.id,
        added_cartons: addCartons,
        new_remaining: newRemaining,
        warnings:      [`Đã cộng ${addCartons} thùng vào tồn hiện tại (${cartonsBeforeAdjust} → ${newRemaining}). Log ghi nhận tại phiếu transfer ${importCode}.`],
      })
    }

    if (existingPallet) {
      if (isTransfer && existingPallet.import_order_id === order_id) {
        return fail(res, 409, 'DUPLICATE_PALLET', `Pallet "${parsed.pallet_code}" đã được quét trong phiếu nhập này`)
      }
      const msg = existingPallet.status === 'PARTIAL'
        ? `Pallet "${parsed.pallet_code}" còn ${existingPallet.cartons_remaining} thùng trong kho này. Để cộng thêm thùng trả về, dùng chức năng điều chỉnh tồn kho.`
        : `Pallet "${parsed.pallet_code}" đang tồn kho tại đây, chưa được xuất`
      return fail(res, 409, 'DUPLICATE_PALLET', msg)
    }
    if (!location)      return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí kho')
    if (!location.is_active) return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí kho không hoạt động')

    // Fire manufacturer lookup now so it runs in parallel with the location capacity check below
    const manufacturerP = parsed.manufacturer_code
      ? supabase.from('Manufacturer').select('id, code, name').eq('code', parsed.manufacturer_code).maybeSingle()
      : Promise.resolve({ data: null, error: null })

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

    // Lookup manufacturer by code — start in parallel with the location check above
    const manufacturer = parsed.manufacturer_code
      ? (await manufacturerP).data
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
        cartons_remaining:  cartons_imported,
        production_date:    parsed.production_date,
        qa_status_id:       qa_status_id ?? null,
        import_order_id:    order_id,
        created_by:         employee_id ?? null,
        updated_by:         employee_id ?? null,
        status:             'IN_STOCK',
        import_date:        vnDate(),
        update_date:        vnDate(),
        created_at:         new Date().toISOString(),
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

// ─── Manual scan (POSM / Loscam) — no QR format, location optional ───────────

export async function scanManual(req: Request, res: Response) {
  try {
    const { id: order_id } = req.params
    const { cartons, employee_id } = req.body

    if (!cartons && cartons !== 0) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu số thùng')

    const { data: order } = await supabase
      .from('ProductionImport')
      .select('id, status, material_id, warehouse_id, posm_entry_id, material:Material!material_id(material_code)')
      .eq('id', order_id).maybeSingle()
    if (!order)                  return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN') return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập không còn ở trạng thái mở')
    if (!order.material_id)      return fail(res, 400, 'NO_MATERIAL', 'Phiếu nhập chưa có hàng hóa')

    // 1 lần mỗi phiếu — enforce qua posm_entry_id (trừ khi entry bị xóa)
    if ((order as any).posm_entry_id) {
      const { data: existingPosmEntry } = await supabase
        .from('InventoryEntry').select('id').eq('id', (order as any).posm_entry_id).maybeSingle()
      if (existingPosmEntry) {
        return fail(res, 409, 'ALREADY_SAVED', 'Phiếu nhập này đã được lưu thủ công rồi')
      }
      // Entry đã bị xóa → cho phép scan lại, sẽ ghi đè posm_entry_id ở cuối
    }

    const now = new Date().toISOString()
    const cartonsNum = Math.max(0, Number(cartons) || 0)
    const warehouseId = (order as any).warehouse_id as string | null

    // Mã pallet = mã hàng (1 row mỗi kho mỗi vật tư)
    const sharedPalletCode = ((order as any).material as any)?.material_code
      ?? `POSM-${order.material_id.replace(/-/g, '').slice(0, 12)}`

    // Tìm pallet chung đã có chưa (filter theo warehouse để mỗi kho có 1 row)
    const { data: existingPallet } = await supabase
      .from('InventoryEntry')
      .select('id, cartons_remaining, cartons_imported')
      .eq('pallet_code', sharedPalletCode)
      .eq('warehouse_id', warehouseId)
      .maybeSingle()

    let entryId: string

    if (existingPallet) {
      // Cộng dồn vào pallet chung
      const { error: updErr } = await supabase
        .from('InventoryEntry')
        .update({
          cartons_remaining: existingPallet.cartons_remaining + cartonsNum,
          cartons_imported:  existingPallet.cartons_imported  + cartonsNum,
          update_date:       vnDate(),
          updated_at:        now,
          updated_by:        employee_id ?? null,
        })
        .eq('id', existingPallet.id)
      if (updErr) throw updErr
      entryId = existingPallet.id
    } else {
      // Tạo pallet chung lần đầu
      const { data: newEntry, error: insErr } = await supabase
        .from('InventoryEntry')
        .insert({
          id:                randomUUID(),
          pallet_code:       sharedPalletCode,
          location_id:       null,
          warehouse_id:      (order as any).warehouse_id ?? null,
          material_id:       order.material_id,
          cartons_imported:  cartonsNum,
          cartons_remaining: cartonsNum,
          stack_layer:       1,
          import_order_id:   order_id,
          created_by:        employee_id ?? null,
          updated_by:        employee_id ?? null,
          status:            'IN_STOCK',
          import_date:       vnDate(),
          update_date:       vnDate(),
          created_at:        now,
          updated_at:        now,
        })
        .select('id')
        .single()
      if (insErr) {
        if (insErr.code === '23505') return fail(res, 409, 'DUPLICATE_PALLET', 'Pallet chung đã tồn tại')
        throw insErr
      }
      entryId = newEntry.id
    }

    // Đánh dấu phiếu này đã lưu thủ công + ghi đóng góp thực của phiếu vào posm_cartons
    const { error: markErr } = await supabase
      .from('ProductionImport')
      .update({ posm_entry_id: entryId, posm_cartons: cartonsNum, updated_at: now })
      .eq('id', order_id)
    if (markErr) throw markErr

    // Trả entry đã cập nhật
    const { data: entry } = await supabase
      .from('InventoryEntry').select(ENTRY_SELECT).eq('id', entryId).single()

    emitInboundChanged()
    ok(res, { entry, warnings: [] })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Update a pallet entry ───────────────────────────────────

export async function updateEntry(req: Request, res: Response) {
  try {
    const { id: order_id, entryId } = req.params
    const { cartons_imported, stack_layer, employee_id } = req.body

    const [{ data: order }, { data: entry }] = await Promise.all([
      supabase.from('ProductionImport').select('status, warehouse_id').eq('id', order_id).maybeSingle(),
      supabase.from('InventoryEntry')
        .select('id, import_order_id, created_by, import_date, created_at, status, cartons_reserved, adjustment_qty')
        .eq('id', entryId).maybeSingle(),
    ])
    if (!order)                              return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN')             return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng')
    if (!entry)                              return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
    if (entry.import_order_id !== order_id)  return fail(res, 400, 'ENTRY_NOT_IN_ORDER', 'Pallet không thuộc phiếu nhập này')

    const hasForceEdit = req.user?.module_permissions?.['inbound']?.includes('force_edit_pallet') ?? false
    const perm = await checkDeletePermission(employee_id, [entry], order.warehouse_id as string | null, hasForceEdit)
    if (!perm.allowed) return fail(res, 403, 'FORBIDDEN', perm.reason!)

    const inv = checkInventoryUnchanged([entry])
    if (!inv.allowed) return fail(res, 400, 'INVENTORY_CHANGED', inv.reason!)

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), update_date: vnDate() }
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

// ─── Permission helper ───────────────────────────────────────

async function checkDeletePermission(
  employee_id: string | undefined,
  entries: { created_by: string | null; import_date: string | null; created_at: string }[],
  order_warehouse_id: string | null,
  forceAllowed = false
): Promise<{ allowed: boolean; reason?: string }> {
  if (!employee_id) return { allowed: true } // no auth yet → allow
  const { data: emp } = await supabase
    .from('Employee').select('id, warehouse_id').eq('id', employee_id).maybeSingle()
  if (!emp) return { allowed: true }

  if (forceAllowed) return { allowed: true } // bypass creator/2-day check

  // Must be the importer + within 2 days
  const now = Date.now()
  for (const entry of entries) {
    if (entry.created_by !== employee_id) {
      return { allowed: false, reason: 'Bạn không có quyền xóa pallet của người khác' }
    }
    const importDate = new Date(entry.import_date ?? entry.created_at).getTime()
    if ((now - importDate) / 86_400_000 > 2) {
      return { allowed: false, reason: 'Chỉ có thể xóa pallet trong vòng 2 ngày sau khi nhập' }
    }
  }
  return { allowed: true }
}

// Đảm bảo tồn kho chưa bị thay đổi (xuất/điều chỉnh/đặt trước)
function checkInventoryUnchanged(
  entries: { status: string; cartons_reserved: number | null; adjustment_qty: number | null }[]
): { allowed: boolean; reason?: string } {
  for (const e of entries) {
    if (e.status !== 'IN_STOCK') {
      return { allowed: false, reason: 'Pallet đã được xuất hoặc thay đổi trạng thái trong tồn kho, không thể xóa' }
    }
    if ((e.cartons_reserved ?? 0) > 0) {
      return { allowed: false, reason: 'Pallet đang được đặt cho đơn xuất, không thể xóa' }
    }
    if (e.adjustment_qty != null && e.adjustment_qty !== 0) {
      return { allowed: false, reason: 'Pallet đã được điều chỉnh tồn kho, không thể xóa' }
    }
  }
  return { allowed: true }
}

// ─── Remove a single pallet entry ───────────────────────────

export async function removeEntry(req: Request, res: Response) {
  try {
    const { id: order_id, entryId } = req.params
    const { employee_id } = req.body ?? {}

    const [{ data: order }, { data: entry }] = await Promise.all([
      supabase.from('ProductionImport').select('status, warehouse_id').eq('id', order_id).maybeSingle(),
      supabase.from('InventoryEntry')
        .select('id, import_order_id, created_by, import_date, created_at, status, cartons_reserved, adjustment_qty')
        .eq('id', entryId).maybeSingle(),
    ])
    if (!order)                              return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN')             return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng')
    if (!entry)                              return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
    if (entry.import_order_id !== order_id)  return fail(res, 400, 'ENTRY_NOT_IN_ORDER', 'Pallet không thuộc phiếu nhập này')

    const hasForceDelete = req.user?.module_permissions?.['inbound']?.includes('force_delete_pallet') ?? false
    const perm = await checkDeletePermission(employee_id, [entry], order.warehouse_id as string | null, hasForceDelete)
    if (!perm.allowed) return fail(res, 403, 'FORBIDDEN', perm.reason!)

    const inv = checkInventoryUnchanged([entry])
    if (!inv.allowed) return fail(res, 400, 'INVENTORY_CHANGED', inv.reason!)

    const { error } = await supabase.from('InventoryEntry').delete().eq('id', entryId)
    if (error) throw error

    // Nếu đây là POSM entry, clear posm_entry_id trên order để cho phép lưu thủ công lại
    await supabase.from('ProductionImport')
      .update({ posm_entry_id: null, updated_at: new Date().toISOString() })
      .eq('id', order_id).eq('posm_entry_id', entryId)

    emitInboundChanged()
    ok(res, { deleted: true })
  } catch (e) { console.error(e); fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Bulk remove pallet entries ──────────────────────────────

export async function removeEntries(req: Request, res: Response) {
  try {
    const { id: order_id } = req.params
    const { entry_ids, employee_id } = req.body ?? {}

    if (!Array.isArray(entry_ids) || entry_ids.length === 0) {
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu entry_ids')
    }

    const { data: order } = await supabase
      .from('ProductionImport').select('status, warehouse_id').eq('id', order_id).maybeSingle()
    if (!order)                  return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN') return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng')

    const { data: entries } = await supabase
      .from('InventoryEntry')
      .select('id, import_order_id, created_by, import_date, created_at, status, cartons_reserved, adjustment_qty')
      .in('id', entry_ids)
    if (!entries?.length) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')

    const wrongOrder = entries.find(e => e.import_order_id !== order_id)
    if (wrongOrder) return fail(res, 400, 'ENTRY_NOT_IN_ORDER', 'Một số pallet không thuộc phiếu nhập này')

    const hasForceDelete = req.user?.module_permissions?.['inbound']?.includes('force_delete_pallet') ?? false
    const perm = await checkDeletePermission(employee_id, entries, order.warehouse_id as string | null, hasForceDelete)
    if (!perm.allowed) return fail(res, 403, 'FORBIDDEN', perm.reason!)

    const inv = checkInventoryUnchanged(entries)
    if (!inv.allowed) return fail(res, 400, 'INVENTORY_CHANGED', inv.reason!)

    const { error } = await supabase
      .from('InventoryEntry').delete().in('id', entry_ids).eq('import_order_id', order_id)
    if (error) throw error

    emitInboundChanged()
    ok(res, { deleted: entries.length })
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
