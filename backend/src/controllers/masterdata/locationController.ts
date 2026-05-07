import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ok, fail } from '../../utils/response'

function buildLocationCode(warehouseCode: string, subCode: string, row: string, shelf: string) {
  return `${warehouseCode}_${subCode}_${row}_${shelf}`
}

export async function listLocations(req: Request, res: Response) {
  try {
    const { warehouse_id, sub_code, active } = req.query
    const data = await prisma.location.findMany({
      where: {
        ...(warehouse_id ? { warehouse_id: String(warehouse_id) } : {}),
        ...(sub_code ? { sub_code: String(sub_code) } : {}),
        ...(active === 'true' ? { is_active: true } : {}),
      },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { inventory_entries: true } },
      },
      orderBy: [{ sub_code: 'asc' }, { row: 'asc' }, { shelf: 'asc' }],
    })

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

// Trả về danh sách sub-group (sub_code distinct) của 1 warehouse
export async function listSubGroups(req: Request, res: Response) {
  try {
    const { warehouse_id } = req.query
    if (!warehouse_id) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id')

    const groups = await prisma.location.groupBy({
      by: ['sub_code', 'sub_name', 'sub_type'],
      where: { warehouse_id: String(warehouse_id), is_active: true },
      _count: { id: true },
      orderBy: { sub_code: 'asc' },
    })
    ok(res, groups.map(g => ({
      sub_code: g.sub_code,
      sub_name: g.sub_name,
      sub_type: g.sub_type,
      location_count: g._count.id,
    })))
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getLocation(req: Request, res: Response) {
  try {
    const data = await prisma.location.findUnique({
      where: { id: req.params.id },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        inventory_entries: {
          where: { status: { in: ['IN_STOCK', 'PARTIAL'] } },
          include: { material: { select: { id: true, material_code: true, short_name: true } } },
          orderBy: { stack_layer: 'asc' },
        },
      },
    })
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy vị trí')
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createLocation(req: Request, res: Response) {
  try {
    const { warehouse_id, sub_code, sub_name, sub_type, row, shelf, max_pallets } = req.body
    if (!warehouse_id || !sub_code || !row || !shelf)
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id, sub_code, row hoặc shelf')

    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouse_id } })
    if (!warehouse) return fail(res, 404, 'NOT_FOUND', 'Kho không tồn tại')

    const location_code = buildLocationCode(
      warehouse.code,
      String(sub_code).trim().toUpperCase(),
      String(row).trim(),
      String(shelf).trim()
    )

    const data = await prisma.location.create({
      data: {
        warehouse_id,
        sub_code: String(sub_code).trim().toUpperCase(),
        sub_name: sub_name ? String(sub_name).trim() : undefined,
        sub_type: sub_type ?? undefined,
        location_code,
        row: String(row).trim(),
        shelf: String(shelf).trim(),
        max_pallets: max_pallets ? Number(max_pallets) : 1,
      },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2002') return fail(res, 409, 'DUPLICATE', 'Vị trí này đã tồn tại')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function updateLocation(req: Request, res: Response) {
  try {
    const { sub_name, sub_type, max_pallets, is_active } = req.body
    const data = await prisma.location.update({
      where: { id: req.params.id },
      data: {
        ...(sub_name !== undefined && { sub_name: sub_name ? String(sub_name).trim() : null }),
        ...(sub_type !== undefined && { sub_type }),
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
