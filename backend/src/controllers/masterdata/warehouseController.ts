import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ok, fail } from '../../utils/response'

export async function listWarehouses(req: Request, res: Response) {
  try {
    const onlyActive = req.query.active === 'true'
    const data = await prisma.warehouse.findMany({
      where: onlyActive ? { is_active: true } : undefined,
      include: { _count: { select: { locations: true, employees: true } } },
      orderBy: { name: 'asc' },
    })
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getWarehouse(req: Request, res: Response) {
  try {
    const data = await prisma.warehouse.findUnique({
      where: { id: req.params.id },
    })
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')

    // Lấy danh sách sub-group từ location (thay thế sub_warehouses)
    const subGroups = await prisma.location.groupBy({
      by: ['sub_code', 'sub_name', 'sub_type'],
      where: { warehouse_id: req.params.id, is_active: true },
      _count: { id: true },
      orderBy: { sub_code: 'asc' },
    })

    ok(res, {
      ...data,
      sub_groups: subGroups.map(g => ({
        sub_code: g.sub_code,
        sub_name: g.sub_name,
        sub_type: g.sub_type,
        location_count: g._count.id,
      })),
    })
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createWarehouse(req: Request, res: Response) {
  try {
    const { code, name, address } = req.body
    if (!code || !name) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code hoặc name')
    const data = await prisma.warehouse.create({
      data: { code: String(code).toUpperCase().trim(), name: String(name).trim(), address },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2002') return fail(res, 409, 'DUPLICATE', 'Mã kho đã tồn tại')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function updateWarehouse(req: Request, res: Response) {
  try {
    const { name, address, is_active } = req.body
    const data = await prisma.warehouse.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(address !== undefined && { address }),
        ...(is_active !== undefined && { is_active: Boolean(is_active) }),
      },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function deleteWarehouse(req: Request, res: Response) {
  try {
    const data = await prisma.warehouse.update({
      where: { id: req.params.id },
      data: { is_active: false },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}
