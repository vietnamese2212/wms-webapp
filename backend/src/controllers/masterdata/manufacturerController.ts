import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ok, fail } from '../../utils/response'

export async function listManufacturers(req: Request, res: Response) {
  try {
    const onlyActive = req.query.active === 'true'
    const data = await prisma.manufacturer.findMany({
      where: onlyActive ? { is_active: true } : undefined,
      include: { _count: { select: { materials: true } } },
      orderBy: { code: 'asc' },
    })
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getManufacturer(req: Request, res: Response) {
  try {
    const data = await prisma.manufacturer.findUnique({
      where: { id: req.params.id },
      include: { materials: { where: { is_active: true }, orderBy: { material_code: 'asc' } } },
    })
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createManufacturer(req: Request, res: Response) {
  try {
    const { code, name } = req.body
    if (!code) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu code')
    const data = await prisma.manufacturer.create({
      data: { code: String(code).trim(), name: name ? String(name).trim() : undefined },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2002') return fail(res, 409, 'DUPLICATE', 'Mã nhà máy đã tồn tại')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function updateManufacturer(req: Request, res: Response) {
  try {
    const { name, is_active } = req.body
    const data = await prisma.manufacturer.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(is_active !== undefined && { is_active: Boolean(is_active) }),
      },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function deleteManufacturer(req: Request, res: Response) {
  try {
    const data = await prisma.manufacturer.update({
      where: { id: req.params.id },
      data: { is_active: false },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy nhà máy')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}
