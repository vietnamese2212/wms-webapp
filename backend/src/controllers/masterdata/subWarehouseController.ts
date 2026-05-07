import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ok, fail } from '../../utils/response'

export async function listSubWarehouses(req: Request, res: Response) {
  try {
    const { warehouse_id, active } = req.query
    const data = await prisma.subWarehouse.findMany({
      where: {
        ...(warehouse_id ? { warehouse_id: String(warehouse_id) } : {}),
        ...(active === 'true' ? { is_active: true } : {}),
      },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { locations: true } },
      },
      orderBy: [{ warehouse_id: 'asc' }, { name: 'asc' }],
    })
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getSubWarehouse(req: Request, res: Response) {
  try {
    const data = await prisma.subWarehouse.findUnique({
      where: { id: req.params.id },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        locations: { orderBy: [{ row: 'asc' }, { shelf: 'asc' }] },
      },
    })
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho nhỏ')
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createSubWarehouse(req: Request, res: Response) {
  try {
    const { warehouse_id, code, name, type } = req.body
    if (!warehouse_id || !code || !name)
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu warehouse_id, code hoặc name')
    const data = await prisma.subWarehouse.create({
      data: {
        warehouse_id,
        code: String(code).toUpperCase().trim(),
        name: String(name).trim(),
        type,
      },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2002') return fail(res, 409, 'DUPLICATE', 'Mã kho nhỏ đã tồn tại trong kho này')
    if (e.code === 'P2003') return fail(res, 404, 'NOT_FOUND', 'Kho lớn không tồn tại')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function updateSubWarehouse(req: Request, res: Response) {
  try {
    const { name, type, is_active } = req.body
    const data = await prisma.subWarehouse.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(type !== undefined && { type }),
        ...(is_active !== undefined && { is_active: Boolean(is_active) }),
      },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho nhỏ')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function deleteSubWarehouse(req: Request, res: Response) {
  try {
    const data = await prisma.subWarehouse.update({
      where: { id: req.params.id },
      data: { is_active: false },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho nhỏ')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}
