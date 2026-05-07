import { Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ok, fail } from '../../utils/response'

function buildShortName(description: string, code: string, custom?: string | null) {
  const suffix = code.slice(-3)
  const base = custom ?? description
  return `${base} [${suffix}]`
}

export async function listMaterials(req: Request, res: Response) {
  try {
    const { active, search, manufacturer_id } = req.query
    const data = await prisma.material.findMany({
      where: {
        ...(active === 'true' ? { is_active: true } : {}),
        ...(manufacturer_id ? { manufacturer_id: String(manufacturer_id) } : {}),
        ...(search
          ? {
              OR: [
                { material_code: { contains: String(search), mode: 'insensitive' } },
                { material_description: { contains: String(search), mode: 'insensitive' } },
                { short_name: { contains: String(search), mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        manufacturer: { select: { id: true, code: true, name: true } },
      },
      orderBy: { material_code: 'asc' },
    })
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function getMaterial(req: Request, res: Response) {
  try {
    const data = await prisma.material.findUnique({
      where: { id: req.params.id },
      include: { manufacturer: { select: { id: true, code: true, name: true } } },
    })
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')
    ok(res, data)
  } catch { fail(res, 500, 'SERVER_ERROR', 'Lỗi server') }
}

export async function createMaterial(req: Request, res: Response) {
  try {
    const { material_code, material_description, custom_short_name, product_type, unit, manufacturer_id, notes } = req.body
    if (!material_code || !material_description)
      return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu material_code hoặc material_description')

    const short_name = buildShortName(material_description, material_code, custom_short_name)
    const data = await prisma.material.create({
      data: {
        material_code: String(material_code).trim(),
        material_description: String(material_description).trim(),
        short_name,
        custom_short_name: custom_short_name ? String(custom_short_name).trim() : undefined,
        product_type,
        unit,
        manufacturer_id: manufacturer_id ?? undefined,
        notes,
      },
      include: { manufacturer: { select: { id: true, code: true, name: true } } },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2002') return fail(res, 409, 'DUPLICATE', 'Mã hàng đã tồn tại')
    if (e.code === 'P2003') return fail(res, 404, 'NOT_FOUND', 'Nhà máy không tồn tại')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function updateMaterial(req: Request, res: Response) {
  try {
    const { material_description, custom_short_name, product_type, unit, manufacturer_id, notes, is_active } = req.body

    // Nếu thay đổi description hoặc custom_short_name → tính lại short_name
    let short_name: string | undefined
    if (material_description !== undefined || custom_short_name !== undefined) {
      const current = await prisma.material.findUnique({ where: { id: req.params.id } })
      if (!current) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')
      short_name = buildShortName(
        material_description ?? current.material_description,
        current.material_code,
        custom_short_name !== undefined ? custom_short_name : current.custom_short_name
      )
    }

    const data = await prisma.material.update({
      where: { id: req.params.id },
      data: {
        ...(material_description !== undefined && { material_description: String(material_description).trim() }),
        ...(custom_short_name !== undefined && { custom_short_name: custom_short_name ? String(custom_short_name).trim() : null }),
        ...(short_name !== undefined && { short_name }),
        ...(product_type !== undefined && { product_type }),
        ...(unit !== undefined && { unit }),
        ...(manufacturer_id !== undefined && { manufacturer_id: manufacturer_id || null }),
        ...(notes !== undefined && { notes }),
        ...(is_active !== undefined && { is_active: Boolean(is_active) }),
      },
      include: { manufacturer: { select: { id: true, code: true, name: true } } },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}

export async function deleteMaterial(req: Request, res: Response) {
  try {
    const data = await prisma.material.update({
      where: { id: req.params.id },
      data: { is_active: false },
    })
    ok(res, data)
  } catch (e: any) {
    if (e.code === 'P2025') return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy hàng hóa')
    fail(res, 500, 'SERVER_ERROR', 'Lỗi server')
  }
}
