import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ok, fail } from '../../utils/response'

function buildLocationCode(warehouseCode: string, subCode: string, row: string, shelf: string) {
  return `${warehouseCode}_${subCode}_${row}_${shelf}`
}

export async function listLocations(req: Request, res: Response) {
  try {
    const { sub_warehouse_id, warehouse_id, active } = req.query
    const data = await prisma.location.findMany({
      where: {
        ...(sub_warehouse_id ? { sub_warehouse_id: String(sub_warehouse_id) } : {}),
        ...(warehouse_id ? { sub_warehouse: { warehouse_id: String(warehouse_id) } } : {}),
        ...(active === 'true' ? { is_active: true } : {}),
      },
      include: {
        sub_warehouse: {
          select: { id: true, code: true, name: true, warehouse: { select: { id: true, code: true, name: true } } },
        },
        _count: { select: { inventory_entries: true } },
      },
      orderBy: [{ sub_warehouse_id: 'asc' }, { row: 'asc' }, { shelf: 'asc' }],
    })

    // Tính số slot đang dùng (chỉ đếm stack_layer = 1)
    const withUsage = await Promise.all(
      data.map(async (loc) => {
        const used_slots = await prisma.inventoryEntry.count({
          where: { location_id: loc.id, stack_layer: 1, status: { in: ['IN_STOCK', 'PARTIAL'] } },
        })
        return { ...loc, used_slots }
      })
    )
    ok(res, withUsage)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getLocation(req: Request, res: Response) {
  try {
    const data = await prisma.location.findUnique({
      where: { id: req.params.id },
      include: {
        sub_warehouse: {
          include: { warehouse: { select: { id: true, code: true, name: true } } },
        },
        inventory_entries: {
          where: { status: { in: ['IN_STOCK', 'PARTIAL'] } },
          include: { material: { select: { id: true, material_code: true, short_name: true } } },
          orderBy: [{ stack_layer: 'asc' }],
        },
      },
    })
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createLocation(req: Request, res: Response) {
  try {
    const { sub_warehouse_id, row, shelf, max_pallets } = req.body
    if (!sub_warehouse_id || !row || !shelf)
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu sub_warehouse_id, row hoặc shelf')

    const subWarehouse = await prisma.subWarehouse.findUnique({
      where: { id: sub_warehouse_id },
      include: { warehouse: true },
    })
    if (!subWarehouse) return fail(res, 404, 'NOT_FOUND', 'Kho nhỏ không tồn tại')

    const location_code = buildLocationCode(
      subWarehouse.warehouse.code,
      subWarehouse.code,
      String(row).trim(),
      String(shelf).trim()
    )

    const data = await prisma.location.create({
      data: {
        sub_warehouse_id,
        location_code,
        row: String(row).trim(),
        shelf: String(shelf).trim(),
        max_pallets: max_pallets ? Number(max_pallets) : 1,
      },
      include: {
        sub_warehouse: {
          select: { id: true, code: true, name: true, warehouse: { select: { id: true, code: true, name: true } } },
        },
      },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2002') return fail(res, 409, 'DUPLICATE', 'Vị trí này đã tồn tại')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function updateLocation(req: Request, res: Response) {
  try {
    const { max_pallets, is_active } = req.body
    const data = await prisma.location.update({
      where: { id: req.params.id },
      data: {
        ...(max_pallets !== undefined && { max_pallets: Number(max_pallets) }),
        ...(is_active !== undefined && { is_active: Boolean(is_active) }),
      },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function deleteLocation(req: Request, res: Response) {
  try {
    const data = await prisma.location.update({
      where: { id: req.params.id },
      data: { is_active: false },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}
