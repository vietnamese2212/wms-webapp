import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ok, fail } from '../../utils/response'

export async function listWarehouses(req: Request, res: Response) {
  try {
    const onlyActive = req.query.active === 'true'
    const data = await prisma.warehouse.findMany({
      where: onlyActive ? { is_active: true } : undefined,
      include: { _count: { select: { sub_warehouses: true, employees: true } } },
      orderBy: { name: 'asc' },
    })
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getWarehouse(req: Request, res: Response) {
  try {
    const data = await prisma.warehouse.findUnique({
      where: { id: req.params.id },
      include: {
        sub_warehouses: {
          orderBy: { name: 'asc' },
          include: { _count: { select: { locations: true } } },
        },
      },
    })
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho')
    ok(res, data)
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
