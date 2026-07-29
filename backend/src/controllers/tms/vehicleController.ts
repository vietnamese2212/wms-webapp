import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel, fetchAllByIdChunks, isRangeNotSatisfiable } from '../../utils/pagination'
import { safeSearch, searchLooksLikeInjection, SEARCH_INVALID_MSG } from '../../utils/search'
import { parseListParam } from '../../utils/httpQuery'

// Helper: fetch related ncc + vehicle_type and merge into vehicle rows
// Avoids PostgREST FK-join syntax which requires schema-cache to know about FKs
async function withRelations(vehicles: Record<string, unknown>[]) {
  if (!vehicles.length) return vehicles
  const nccIds = [...new Set(vehicles.map(v => v.ncc_id as string).filter(Boolean))]
  const vtIds  = [...new Set(vehicles.map(v => v.vehicle_type_id as string).filter(Boolean))]
  // Chunk 300 + phân trang — >1000 NCC/loại xe distinct thì response cap 1000 cắt âm thầm → cột ĐVVT/loại xe hiện null
  const [nccs, vts] = await Promise.all([
    fetchAllByIdChunks(nccIds, chunk => supabase.from('TransportCompany').select('id, code, name').in('id', chunk).order('id')),
    fetchAllByIdChunks(vtIds,  chunk => supabase.from('VehicleType').select('id, code, name').in('id', chunk).order('id')),
  ])
  return vehicles.map(v => ({
    ...v,
    ncc:          (nccs ?? []).find((n: Record<string, unknown>) => n.id === v.ncc_id)          ?? null,
    vehicle_type: (vts  ?? []).find((t: Record<string, unknown>) => t.id === v.vehicle_type_id) ?? null,
  }))
}

// Danh mục XE — PHÂN TRANG SERVER (?page=). Tab "Xe" của Cài đặt TMS trước đây nạp CẢ đội xe rồi
// lọc client: đo 28/07 với 4.953 xe = **2.300KB/lần gọi**, và 10.000 xe ≈ 4,6MB là vượt trần 4,5MB
// của Vercel. Biển số xe nằm đúng danh sách "danh mục KHÔNG được nạp cả vào trình duyệt" trong
// CLAUDE.md (cùng Mã hàng, Vị trí). 4 bộ lọc của tab cũng phải xuống server — lọc client sau khi
// phân trang là lọc trên đúng 1 trang.
async function listVehiclesPaged(req: Request, res: Response) {
  const q = req.query as Record<string, string>
  const userNccId: string | null = req.user?.ncc_id ?? null
  if (q.search && searchLooksLikeInjection(q.search)) return fail(res, 400, 'INVALID_SEARCH', SEARCH_INVALID_MSG)
  const pageNum  = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
  const pageSize = Math.min(1000, Math.max(1, parseInt(String(q.page_size ?? '200'), 10) || 200))
  const nccIds = parseListParam(q.ncc_ids) ?? []
  const vtIds  = parseListParam(q.vehicle_type_ids) ?? []

  const buildQ = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let qq: any = supabase.from('Vehicle').select('*', { count: 'exact' })
    if (userNccId)          qq = qq.eq('ncc_id', userNccId)   // ĐVVT chỉ xem xe của mình
    else if (nccIds.length) qq = qq.in('ncc_id', nccIds)
    if (vtIds.length)       qq = qq.in('vehicle_type_id', vtIds)
    if (q.is_active !== undefined && q.is_active !== '') qq = qq.eq('is_active', q.is_active === 'true')
    if (q.search)           qq = qq.ilike('license_plate', `%${safeSearch(q.search)}%`)
    return qq
  }
  // MỘT RPC cho cả trang: rows (đã ghép ĐVVT + loại xe) + total + active (migration 20260729).
  // Đường cũ = 5 request (2 câu đếm + trang + TransportCompany + VehicleType) — mỗi request chiếm
  // 1 khe pool ~10 khe của PostgREST, dưới tải là 5 lượt xếp hàng. `inactive = total − active`
  // (Vehicle.is_active NOT NULL). Fallback đường cũ khi RPC chưa được apply (cửa sổ triển khai).
  const { data: rp, error: rpErr } = await supabase.rpc('tms_vehicles_page', {
    p_ncc_ids: userNccId ? [userNccId] : (nccIds.length ? nccIds : null),
    p_vt_ids:  vtIds.length ? vtIds : null,
    p_active:  (q.is_active !== undefined && q.is_active !== '') ? q.is_active === 'true' : null,
    p_search:  q.search ? safeSearch(q.search) : null,
    p_offset:  (pageNum - 1) * pageSize,
    p_limit:   pageSize,
  })
  if (!rpErr && rp) {
    const d = rp as { rows?: unknown[]; total?: number; active?: number }
    const total = d.total ?? 0
    const active = d.active ?? 0
    return ok(res, {
      items: d.rows ?? [], total, active, inactive: total - active,
      page: pageNum, page_size: pageSize,
    })
  }

  // ── Nhánh dự phòng cửa sổ triển khai (RPC chưa apply) — đường cũ nguyên vẹn ──
  const [{ count: totalN }, { count: activeN }] = await Promise.all([
    buildQ().limit(1),
    buildQ().eq('is_active', true).limit(1),
  ])
  const total = totalN ?? 0
  const active = activeN ?? 0
  const offset = (pageNum - 1) * pageSize
  const meta = { total, active, inactive: total - active, page: pageNum, page_size: pageSize }
  // Trang vượt phạm vi → TRANG RỖNG, không phải lỗi. Đếm TRƯỚC rồi mới `.range()`: PostgREST trả
  // 416 khi offset ≥ tổng số dòng, mà tình huống này rất dễ gặp (đang ở trang 25 rồi gõ tìm còn
  // 1 trang; hoặc số trang đã nhớ theo user từ lần trước). Xem `isRangeNotSatisfiable`.
  if (offset >= total) return ok(res, { items: [], ...meta })

  const { data, error } = await buildQ()
    .order('license_plate').order('id')
    .range(offset, offset + pageSize - 1)
  if (error) {
    if (isRangeNotSatisfiable(error)) return ok(res, { items: [], ...meta })
    return fail(res, 500, 'DB_ERROR', error.message)
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  return ok(res, { items: await withRelations(rows), ...meta })
}

export async function listVehicles(req: Request, res: Response) {
  try {
    if (req.query.page) return await listVehiclesPaged(req, res)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = req.user?.ncc_id ?? null
    const { ncc_id, is_active, unassigned, pool_branches, search, limit } = req.query as Record<string, string>
    if (search && searchLooksLikeInjection(search)) return fail(res, 400, 'INVALID_SEARCH', SEARCH_INVALID_MSG)
    const cap = Math.min(Math.max(Number(limit) || 0, 0), 200)

    // Gom CHI NHÁNH: 1 NCC/ĐVVT có thể có nhiều mã (cùng tên, khác mã) → lấy xe của TẤT CẢ
    // công ty cùng (type, tên chuẩn hoá) để booking/đăng ký không bị thiếu xe. (Resolve trước
    // khi build query — query phải thuần để phân trang được.)
    let branchIds: string[] | null = null
    if (!userNccId && ncc_id && pool_branches === 'true') {
      const { data: sel } = await supabase.from('TransportCompany').select('type, name').eq('id', ncc_id).single()
      const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
      branchIds = [ncc_id]
      if (sel) {
        const { data: sameType } = await supabase.from('TransportCompany').select('id, name').eq('type', (sel as { type: string }).type)
        const group = (sameType ?? []).filter((c: { name: string }) => norm(c.name) === norm((sel as { name: string }).name)).map((c: { id: string }) => c.id)
        if (group.length) branchIds = group
      }
    }

    // Phân trang (cap ~1000 dòng/response) — đội xe đã ~950, không lọc ncc thì 1 response sẽ cắt mất xe.
    const buildQ = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = supabase.from('Vehicle').select('*').order('license_plate').order('id')
      // ĐVVT user: chỉ được xem xe của mình
      if (userNccId)               q = q.eq('ncc_id', userNccId)
      else if (branchIds)          q = q.in('ncc_id', branchIds)
      else if (ncc_id)             q = q.eq('ncc_id', ncc_id)
      if (is_active !== undefined) q = q.eq('is_active', is_active === 'true')
      if (search)                  q = q.ilike('license_plate', `%${safeSearch(search)}%`)
      return q
    }
    let vehicles: Record<string, unknown>[]
    try {
      // limit=N (ô gõ biển số): 1 round-trip N dòng — đội xe nghìn chiếc không dội hết về trình duyệt
      if (cap > 0) {
        const { data, error } = await buildQ().limit(cap)
        if (error) throw error
        vehicles = (data ?? []) as unknown as Record<string, unknown>[]
      } else {
        vehicles = await fetchAllRowsParallel(buildQ) as Record<string, unknown>[]
      }
    } catch (e) {
      return fail(res, (e as Error).message)
    }

    // Lọc xe chưa có tài khoản lái xe (kể cả soft-deleted)
    if (unassigned === 'true' && vehicles.length > 0) {
      const plates = vehicles.map(v => v.license_plate as string)
      const nccIds = [...new Set(vehicles.map(v => v.ncc_id as string))]
      // Chunk plates 300/lượt (Vehicle đã ~1000 xe: URL dài + cap output cắt → xe bị chấm nhầm "chưa có tài khoản")
      const drivers: { employee_code: string; ncc_id: string }[] = []
      for (let i = 0; i < plates.length; i += 300) {
        const rows = await fetchAllRowsParallel(() => supabase.from('Employee')
          .select('employee_code, ncc_id')
          .in('employee_code', plates.slice(i, i + 300))
          .in('ncc_id', nccIds)
          .eq('is_driver', true)
          .order('id'))
        drivers.push(...(rows as { employee_code: string; ncc_id: string }[]))
      }
      if (drivers?.length) {
        const assigned = new Set(
          (drivers as { employee_code: string; ncc_id: string }[]).map(d => `${d.employee_code}|${d.ncc_id}`)
        )
        vehicles = vehicles.filter(v => !assigned.has(`${v.license_plate}|${v.ncc_id}`))
      }
    }

    return ok(res, await withRelations(vehicles))
  } catch (e) { return fail(res, String(e)) }
}

export async function createVehicle(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = req.user?.ncc_id ?? null
    const { ncc_id, license_plate, vehicle_type_id } = req.body as {
      ncc_id: string; license_plate: string; vehicle_type_id: string
    }
    // ĐVVT user: chỉ được thêm xe cho công ty của mình
    if (userNccId && ncc_id && ncc_id !== userNccId)
      return fail(res, 'Bạn chỉ được thêm xe cho ĐVVT của mình', 403)
    const effectiveNccId = userNccId ?? ncc_id
    if (!effectiveNccId || !license_plate || !vehicle_type_id)
      return fail(res, 'ncc_id, license_plate, vehicle_type_id là bắt buộc', 400)
    const now = new Date().toISOString()
    const plate = license_plate.toUpperCase().replace(/\s+/g, '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('Vehicle')
      .insert({ id: randomUUID(), ncc_id: effectiveNccId, license_plate: plate, vehicle_type_id, is_active: true, created_at: now, updated_at: now })
      .select('*').single()
    if (error) return fail(res, error.message)
    const [merged] = await withRelations([data])
    return ok(res, merged, 201)
  } catch (e) { return fail(res, String(e)) }
}

export async function updateVehicle(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = req.user?.ncc_id ?? null
    const { id } = req.params
    const { ncc_id, vehicle_type_id, is_active } = req.body as {
      ncc_id?: string; vehicle_type_id?: string; is_active?: boolean
    }

    // Lấy thông tin xe hiện tại để cascade is_active → employee
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await supabase.from('Vehicle')
      .select('license_plate, ncc_id').eq('id', id).single()
    const currentPlate = (current as { license_plate: string; ncc_id: string } | null)?.license_plate ?? null
    const currentNccId = (current as { license_plate: string; ncc_id: string } | null)?.ncc_id ?? null

    // ĐVVT user: chỉ được sửa xe của mình
    if (userNccId && currentNccId && currentNccId !== userNccId)
      return fail(res, 'Bạn không có quyền chỉnh sửa xe này', 403)

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (ncc_id          !== undefined) updates.ncc_id          = ncc_id
    if (vehicle_type_id !== undefined) updates.vehicle_type_id = vehicle_type_id
    if (is_active       !== undefined) updates.is_active       = is_active

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.from('Vehicle')
      .update(updates).eq('id', id).select('*').single()
    if (error) return fail(res, error.message)

    // Cascade xuống driver employee (khóa theo plate + ncc cũ):
    // - đổi ĐVVT (ncc_id) → di chuyển driver theo xe (giữ tài khoản đăng nhập khớp ncc mới)
    // - is_active → soft-delete / restore driver
    // (KHÔNG đụng dữ liệu lịch sử: booking/gate lưu biển số + tên NCC dạng snapshot text.)
    if (currentPlate && currentNccId) {
      const now = new Date().toISOString()
      const empUpdate: Record<string, unknown> = { updated_at: now }
      if (ncc_id !== undefined && ncc_id !== currentNccId) empUpdate.ncc_id = ncc_id
      if (is_active !== undefined) {
        empUpdate.is_active  = is_active
        empUpdate.deleted_at = is_active ? null : now
      }
      // chỉ ghi khi có thay đổi thực (ngoài updated_at)
      if (Object.keys(empUpdate).length > 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('Employee')
          .update(empUpdate)
          .eq('employee_code', currentPlate)
          .eq('ncc_id', currentNccId)
          .eq('is_driver', true)
      }
    }

    const [merged] = await withRelations([data])
    return ok(res, merged)
  } catch (e) { return fail(res, String(e)) }
}

export async function deleteVehicle(req: Request, res: Response) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userNccId: string | null = req.user?.ncc_id ?? null
    const { id } = req.params

    // Lấy thông tin xe trước khi xóa
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: vehicle } = await supabase.from('Vehicle')
      .select('license_plate, ncc_id').eq('id', id).single()
    const plate  = (vehicle as { license_plate: string; ncc_id: string } | null)?.license_plate ?? null
    const nccId  = (vehicle as { license_plate: string; ncc_id: string } | null)?.ncc_id       ?? null

    // ĐVVT user: chỉ được xóa xe của mình
    if (userNccId && nccId && nccId !== userNccId)
      return fail(res, 'Bạn không có quyền xóa xe này', 403)

    // Hard-delete driver employee gắn với xe này
    if (plate && nccId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('Employee')
        .delete()
        .eq('employee_code', plate)
        .eq('ncc_id', nccId)
        .eq('is_driver', true)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('Vehicle').delete().eq('id', id)
    if (error) return fail(res, error.message)
    return ok(res, { deleted: true })
  } catch (e) { return fail(res, String(e)) }
}
