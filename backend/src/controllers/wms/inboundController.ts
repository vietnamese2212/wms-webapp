import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ok, fail } from '../../utils/response'
import { parseInboundQR } from '../../utils/qrParser'

// ─── Helpers ────────────────────────────────────────────────

function generateImportCode(date: Date, seq: number): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `NK-${y}${m}${d}-${String(seq).padStart(3, '0')}`
}

const INCLUDE_ORDER = {
  warehouse: { select: { id: true, code: true, name: true } },
  location:  { select: { id: true, location_code: true, sub_code: true, max_pallets: true } },
  material:  { select: { id: true, material_code: true, short_name: true, material_description: true, cartons_per_pallet: true, cartons_per_pallet_mn: true } },
  created_by_emp: { select: { id: true, name: true } },
  updated_by_emp: { select: { id: true, name: true } },
  imported_by_emp: { select: { id: true, name: true } },
  _count: { select: { inventory_entries: true } },
} as const

const INCLUDE_ENTRY = {
  location:     { select: { id: true, location_code: true, sub_code: true } },
  material:     { select: { id: true, material_code: true, short_name: true } },
  manufacturer: { select: { id: true, code: true, name: true } },
  created_by_emp: { select: { id: true, name: true } },
  updated_by_emp: { select: { id: true, name: true } },
} as const

// ─── List inbound orders ─────────────────────────────────────

export async function listOrders(req: Request, res: Response) {
  try {
    const { warehouse_id, status, material_id, search } = req.query as Record<string, string>

    const data = await prisma.productionImport.findMany({
      where: {
        ...(warehouse_id  && { warehouse_id }),
        ...(status        && { status }),
        ...(material_id   && { material_id }),
        ...(search && {
          OR: [
            { import_code: { contains: search, mode: 'insensitive' } },
            { material: { material_code: { contains: search, mode: 'insensitive' } } },
            { material: { short_name:    { contains: search, mode: 'insensitive' } } },
          ],
        }),
      },
      include: INCLUDE_ORDER,
      orderBy: { created_at: 'desc' },
    })

    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Create inbound order ────────────────────────────────────

export async function createOrder(req: Request, res: Response) {
  try {
    const { warehouse_id, material_id, location_id, planned_pallets, notes, imported_by } = req.body

    if (!warehouse_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id')
    if (!material_id)  return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu material_id')

    // Validate foreign keys
    const [wh, mat] = await Promise.all([
      prisma.warehouse.findUnique({ where: { id: warehouse_id } }),
      prisma.material.findUnique({ where: { id: material_id } }),
    ])
    if (!wh)  return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    if (!mat) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')

    // Auto-generate import_code
    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const todayEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const todayCount = await prisma.productionImport.count({
      where: { created_at: { gte: todayStart, lt: todayEnd } },
    })
    const import_code = generateImportCode(today, todayCount + 1)

    const order = await prisma.productionImport.create({
      data: {
        import_code,
        warehouse_id,
        material_id,
        location_id:     location_id ?? null,
        planned_pallets: planned_pallets ? Number(planned_pallets) : null,
        notes:           notes ?? null,
        imported_by:     imported_by ?? null,
        created_by:      imported_by ?? null,
        status:          'OPEN',
      },
      include: INCLUDE_ORDER,
    })

    // Return order + location suggestions
    const suggestions = await getLocationSuggestionsData(warehouse_id, material_id)
    ok(res, { order, location_suggestions: suggestions })
  } catch (e: any) {
    if (e.code === 'P2002') return fail(res, 409, 'DUPLICATE', 'Mã phiếu đã tồn tại')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

// ─── Get single order ────────────────────────────────────────

export async function getOrder(req: Request, res: Response) {
  try {
    const order = await prisma.productionImport.findUnique({
      where: { id: req.params.id },
      include: {
        ...INCLUDE_ORDER,
        inventory_entries: {
          include: INCLUDE_ENTRY,
          orderBy: { created_at: 'asc' },
        },
      },
    })
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    ok(res, order)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Update order header ─────────────────────────────────────

export async function updateOrder(req: Request, res: Response) {
  try {
    const { location_id, planned_pallets, notes, updated_by } = req.body

    const order = await prisma.productionImport.findUnique({ where: { id: req.params.id } })
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN') return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng, không thể sửa')

    const updated = await prisma.productionImport.update({
      where: { id: req.params.id },
      data: {
        ...(location_id     !== undefined && { location_id }),
        ...(planned_pallets !== undefined && { planned_pallets: Number(planned_pallets) }),
        ...(notes           !== undefined && { notes }),
        ...(updated_by      !== undefined && { updated_by }),
      },
      include: INCLUDE_ORDER,
    })
    ok(res, updated)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

// ─── Complete order ──────────────────────────────────────────

export async function completeOrder(req: Request, res: Response) {
  try {
    const order = await prisma.productionImport.findUnique({ where: { id: req.params.id } })
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status === 'COMPLETED') return fail(res, 400, 'ALREADY_COMPLETED', 'Phiếu nhập đã hoàn thành')
    if (order.status === 'CANCELLED') return fail(res, 400, 'ORDER_CANCELLED', 'Phiếu nhập đã bị hủy')

    const updated = await prisma.productionImport.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED', updated_by: req.body.updated_by ?? null },
      include: INCLUDE_ORDER,
    })
    ok(res, updated)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Cancel order ────────────────────────────────────────────

export async function cancelOrder(req: Request, res: Response) {
  try {
    const order = await prisma.productionImport.findUnique({ where: { id: req.params.id } })
    if (!order) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status === 'COMPLETED') return fail(res, 400, 'ALREADY_COMPLETED', 'Phiếu nhập đã hoàn thành, không thể hủy')

    const updated = await prisma.productionImport.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED', updated_by: req.body.updated_by ?? null },
      include: INCLUDE_ORDER,
    })
    ok(res, updated)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Scan QR → create InventoryEntry ────────────────────────

export async function scanQR(req: Request, res: Response) {
  try {
    const { id: order_id } = req.params
    const { qr_code, location_id, stack_layer = 1, cartons_override, employee_id } = req.body

    if (!qr_code)     return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu qr_code')
    if (!location_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu location_id')

    // Load order
    const order = await prisma.productionImport.findUnique({
      where: { id: order_id },
      include: { material: true },
    })
    if (!order)                     return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN')    return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập không còn ở trạng thái mở')
    if (!order.material_id)         return fail(res, 400, 'NO_MATERIAL', 'Phiếu nhập chưa có hàng hóa')

    // Parse QR
    const parsed = parseInboundQR(qr_code)
    if (!parsed.is_valid) return fail(res, 400, 'INVALID_QR', parsed.error ?? 'QR không hợp lệ')

    // Validate material match
    const material = await prisma.material.findUnique({ where: { material_code: parsed.material_code } })
    if (!material) {
      return fail(res, 400, 'MATERIAL_NOT_FOUND',
        `Mã hàng "${parsed.material_code}" từ QR không tồn tại trong hệ thống`)
    }
    if (material.id !== order.material_id) {
      return fail(res, 400, 'MATERIAL_MISMATCH',
        `Hàng hóa không khớp: QR có "${parsed.material_code}" (${material.material_description}) nhưng phiếu nhập yêu cầu "${order.material?.material_code}"`)
    }

    // Check duplicate pallet
    const existing = await prisma.inventoryEntry.findUnique({ where: { pallet_code: parsed.pallet_code } })
    if (existing) return fail(res, 409, 'DUPLICATE_PALLET', `Pallet "${parsed.pallet_code}" đã được nhập kho`)

    // Validate location
    const location = await prisma.location.findUnique({ where: { id: location_id } })
    if (!location) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí kho')
    if (!location.is_active) return fail(res, 400, 'LOCATION_INACTIVE', 'Vị trí kho không hoạt động')

    // Check location capacity (only layer 1 counts)
    const stackLayerNum = Number(stack_layer)
    if (stackLayerNum === 1) {
      const usedSlots = await prisma.inventoryEntry.count({
        where: { location_id, stack_layer: 1, status: 'IN_STOCK' },
      })
      if (usedSlots >= location.max_pallets) {
        return fail(res, 422, 'LOCATION_FULL',
          `Vị trí ${location.location_code} đã đầy (${usedSlots}/${location.max_pallets} pallet). Chọn tầng chồng (layer 2/3) hoặc vị trí khác.`)
      }
    } else {
      // For stacked layers, verify a layer-1 pallet exists at this location
      const baseLayer = await prisma.inventoryEntry.findFirst({
        where: { location_id, stack_layer: stackLayerNum - 1, status: 'IN_STOCK' },
      })
      if (!baseLayer) {
        return fail(res, 422, 'NO_BASE_LAYER',
          `Không có pallet tầng ${stackLayerNum - 1} tại vị trí này để chồng lên`)
      }
    }

    // Lookup manufacturer by code
    const manufacturer = parsed.manufacturer_code
      ? await prisma.manufacturer.findUnique({ where: { code: parsed.manufacturer_code } })
      : null

    // Determine cartons_imported
    const cartons_imported = cartons_override
      ? Number(cartons_override)
      : (material.cartons_per_pallet ?? 0)

    // Create InventoryEntry
    const entry = await prisma.inventoryEntry.create({
      data: {
        pallet_code:     parsed.pallet_code,
        location_id,
        material_id:     material.id,
        manufacturer_id: manufacturer?.id ?? null,
        cycle:           parsed.cycle || null,
        machine_code:    parsed.machine_code || null,
        stack_layer:     stackLayerNum,
        cartons_imported,
        production_date: parsed.production_date,
        import_order_id: order_id,
        created_by:      employee_id ?? null,
        updated_by:      employee_id ?? null,
        status:          'IN_STOCK',
      },
      include: INCLUDE_ENTRY,
    })

    // Set order to IN_PROGRESS after first scan (keep OPEN, or mark we could use IN_PROGRESS)
    // We keep status as OPEN until user explicitly completes

    const warnings: string[] = []
    if (!manufacturer && parsed.manufacturer_code) {
      warnings.push(`NMSX "${parsed.manufacturer_code}" chưa có trong hệ thống – đã bỏ qua`)
    }
    if (cartons_imported === 0) {
      warnings.push('Số thùng/pallet chưa được cấu hình cho hàng hóa này – đã nhập 0')
    }

    ok(res, { entry, warnings })
  } catch (e: any) {
    if (e.code === 'P2002') return fail(res, 409, 'DUPLICATE_PALLET', 'Pallet đã tồn tại trong hệ thống')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

// ─── Remove a pallet entry from order ───────────────────────

export async function removeEntry(req: Request, res: Response) {
  try {
    const { id: order_id, entryId } = req.params

    const order = await prisma.productionImport.findUnique({ where: { id: order_id } })
    if (!order)                  return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (order.status !== 'OPEN') return fail(res, 400, 'ORDER_CLOSED', 'Phiếu nhập đã đóng')

    const entry = await prisma.inventoryEntry.findUnique({ where: { id: entryId } })
    if (!entry)                            return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
    if (entry.import_order_id !== order_id) return fail(res, 400, 'ENTRY_NOT_IN_ORDER', 'Pallet không thuộc phiếu nhập này')

    await prisma.inventoryEntry.delete({ where: { id: entryId } })
    ok(res, { deleted: true })
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy pallet')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

// ─── Location suggestions ────────────────────────────────────

export async function getLocationSuggestions(req: Request, res: Response) {
  try {
    const { id: order_id } = req.params

    const order = await prisma.productionImport.findUnique({ where: { id: order_id } })
    if (!order)            return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy phiếu nhập')
    if (!order.warehouse_id) return fail(res, 400, 'NO_WAREHOUSE', 'Phiếu nhập chưa có kho')

    const suggestions = await getLocationSuggestionsData(order.warehouse_id, order.material_id)
    ok(res, suggestions)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

// ─── Internal helper ─────────────────────────────────────────

async function getLocationSuggestionsData(warehouse_id: string, material_id: string | null) {
  const locations = await prisma.location.findMany({
    where: { warehouse_id, is_active: true },
    include: {
      inventory_entries: {
        where: { stack_layer: 1, status: 'IN_STOCK' },
        select: { id: true, material_id: true },
      },
    },
  })

  return locations
    .map((loc) => ({
      id:               loc.id,
      location_code:    loc.location_code,
      sub_code:         loc.sub_code,
      sub_name:         loc.sub_name,
      max_pallets:      loc.max_pallets,
      used_slots:       loc.inventory_entries.length,
      available_slots:  loc.max_pallets - loc.inventory_entries.length,
      has_same_material: material_id
        ? loc.inventory_entries.some((e) => e.material_id === material_id)
        : false,
    }))
    .filter((loc) => loc.available_slots > 0)
    .sort((a, b) => {
      if (a.has_same_material !== b.has_same_material)
        return b.has_same_material ? 1 : -1
      return b.available_slots - a.available_slots
    })
    .slice(0, 10)
}
