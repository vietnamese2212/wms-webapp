// SƠ ĐỒ KHO bản một (08/09/2026) — bản vẽ 2D: khung lưới theo kho + vị trí/cửa/bãi đặt lên lưới.
// Nền cho Directed Work (bảng Cần hạ / Cần đưa ra bãi / đường đi) — memory `directed-work-task-engine`.
//
// Vì sao là một module riêng thay vì nhét vào Vị trí kho: bản vẽ là dữ liệu CẤU HÌNH của kho, có
// quyền riêng (warehouse_map.view/edit), và nhiều màn khác sẽ TIÊU THỤ nó (tồn theo ô, tìm pallet,
// đường đi, Slotting, kiểm kê…). Mọi phép tính đường đi nằm ở utils/warehouseGrid.ts (BE+FE mirror).
//
// Quy mô: 1 kho ≤ vài nghìn vị trí — GET trả TRỌN vị trí của MỘT kho (phân trang qua
// fetchAllRowsParallel để né trần 1000 của PostgREST) vì bản vẽ cần đủ mọi ô; cột lấy tối thiểu
// (~90 byte/dòng → Bàu Bàng 1.517 ô ≈ 140KB). Tồn theo ô = 1 RPC trả jsonb (không dính trần dòng).
import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { ok, fail } from '../../utils/response'
import { fetchAllRowsParallel, isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { categoriesAnyAllowed } from '../../utils/categoryScope'
import { safeSearch, searchLooksLikeInjection, SEARCH_INVALID_MSG } from '../../utils/search'
import type { GridKind } from '../../utils/warehouseGrid'

const KINDS: ReadonlyArray<GridKind> = ['STORAGE', 'DOCK_IN', 'DOCK_OUT', 'DROP']
const OBJECT_KINDS: ReadonlyArray<GridKind> = ['DOCK_IN', 'DOCK_OUT', 'DROP']
// Mã ô cho cửa/bãi/điểm hạ: <tiền tố kho>_<nhóm>_<tên đã chuẩn hoá>. Nhóm = sub_code để hiện trong
// danh sách Vị trí kho như một "khu" riêng, không trộn vào khu hàng.
const KIND_GROUP: Record<GridKind, string> = { STORAGE: '', DOCK_OUT: 'CUAXUAT', DOCK_IN: 'CUANHAP', DROP: 'DAUDAY' }
const KIND_GROUP_NAME: Record<GridKind, string> = { STORAGE: '', DOCK_OUT: 'Cửa / bãi xuất', DOCK_IN: 'Cửa / bãi nhập', DROP: 'Điểm đầu dãy' }

const MAP_LOC_COLS = 'id, location_code, sub_code, sub_name, row, shelf, kind, is_rack, level_no, grid_x, grid_y, grid_w, grid_h, ' +
  'max_pallets, categories, is_pick_face, slot_no_in, slot_no_out, is_active'

type WhRow = { id: string; code: string; name: string; nmsx_code: string | null }

// Phạm vi kho cho route có :warehouseId (mirror guardWarehouseScope của warehouseController).
// Id rác → không có kho → 404 (Warehouse.id là TEXT nên không có chuyện 22P02 → 500).
async function loadWarehouse(req: Request, res: Response, whId: string): Promise<WhRow | null> {
  // Tham số trên ĐƯỜNG DẪN không đi qua middleware chặn injection của /api (chỉ soi query/body) — giá trị
  // dạng `' or 1=1 --` đi thẳng xuống PostgREST làm WAF trả HTML → supabase-js lỗi lạ → 500 (gói 54 [1d] bắt được).
  if (!whId || whId.length > 100 || searchLooksLikeInjection(whId)) { fail(res, 400, 'BAD_ID', 'Mã kho không hợp lệ'); return null }
  const { data, error } = await supabase.from('Warehouse').select('id, code, name, nmsx_code').eq('id', whId).maybeSingle()
  if (error) { fail(res, error); return null }
  if (!data) { fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kho'); return null }
  const u = req.user
  const allowed = u?.is_superadmin === true || u?.warehouse_scope === 'NATIONAL' || (u?.warehouse_ids ?? []).includes(whId)
  if (!allowed) { fail(res, 403, 'FORBIDDEN', 'Kho ngoài phạm vi được phân quyền'); return null }
  return data as WhRow
}

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) ? n : NaN
}

// GET /wms/warehouse-map/:warehouseId — khung + toàn bộ vị trí đang dùng của kho (cột tối thiểu)
export async function getWarehouseMap(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const [{ data: map, error: e1 }, locsRaw] = await Promise.all([
      supabase.from('warehouse_maps').select('width, height, cell_m, blocked, notes, updated_at, updated_by').eq('warehouse_id', wh.id).maybeSingle(),
      fetchAllRowsParallel(() => supabase.from('Location').select(MAP_LOC_COLS)
        .eq('warehouse_id', wh.id).eq('is_active', true).order('id')),
    ])
    if (e1) return fail(res, e1)
    // Scope Loại hàng: vị trí ngoài loại được gán thì không hiện (null-inclusive — cửa/bãi không có loại vẫn hiện)
    const locations = (locsRaw as { categories: string[] | null }[]).filter(l => categoriesAnyAllowed(req, l.categories))
    return ok(res, {
      warehouse: { id: wh.id, code: wh.code, name: wh.name },
      map: map ? { ...map, cell_m: Number(map.cell_m) } : null,
      locations,
    })
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    return fail(res, String(e))
  }
}

// PUT /wms/warehouse-map/:warehouseId — dựng/sửa KHUNG: kích thước lưới, mét/ô, ô tường
export async function saveWarehouseMapFrame(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const b = (req.body ?? {}) as Record<string, unknown>
    const width = toInt(b.width), height = toInt(b.height)
    if (width === null || height === null || Number.isNaN(width) || Number.isNaN(height) || width < 5 || height < 5 || width > 400 || height > 400) {
      return fail(res, 400, 'VALIDATION_ERROR', 'Kích thước lưới phải là số nguyên từ 5 tới 400 ô mỗi chiều')
    }
    const cellRaw = b.cell_m === undefined || b.cell_m === null || b.cell_m === '' ? 1.2 : Number(b.cell_m)
    if (!Number.isFinite(cellRaw) || cellRaw <= 0 || cellRaw > 10) return fail(res, 400, 'VALIDATION_ERROR', 'Kích thước một ô (mét) phải > 0 và ≤ 10')
    const cell_m = Math.round(cellRaw * 100) / 100
    const blockedIn = Array.isArray(b.blocked) ? b.blocked : []
    if (blockedIn.length > 40_000) return fail(res, 400, 'VALIDATION_ERROR', 'Quá nhiều ô chắn')
    const seen = new Set<string>()
    const blocked: [number, number][] = []
    for (const p of blockedIn) {
      if (!Array.isArray(p) || p.length !== 2) return fail(res, 400, 'VALIDATION_ERROR', 'Ô chắn phải là cặp [x, y]')
      const x = toInt(p[0]), y = toInt(p[1])
      if (x === null || y === null || Number.isNaN(x) || Number.isNaN(y) || x < 0 || y < 0 || x >= width || y >= height) {
        return fail(res, 400, 'VALIDATION_ERROR', `Ô chắn [${String(p[0])}, ${String(p[1])}] nằm ngoài lưới ${width}×${height}`)
      }
      const k = `${x},${y}`
      if (!seen.has(k)) { seen.add(k); blocked.push([x, y]) }
    }
    // Thu khung lại mà có vị trí đang nằm ngoài khung mới → 409, nêu ví dụ (đừng để ô "biến mất" khỏi bản vẽ)
    const { data: outside, error: e0 } = await supabase.from('Location').select('location_code')
      .eq('warehouse_id', wh.id).eq('is_active', true).not('grid_x', 'is', null)
      .or(`grid_x.gte.${width},grid_y.gte.${height}`).limit(5)
    if (e0) return fail(res, e0)
    if (outside && outside.length) {
      return fail(res, 409, 'LOCATIONS_OUTSIDE', `Có vị trí đang nằm ngoài khung mới (${(outside as { location_code: string }[]).map(o => o.location_code).join(', ')}…) — gỡ hoặc dời chúng trước khi thu khung`)
    }
    const notes = typeof b.notes === 'string' ? b.notes.slice(0, 500) : null
    const now = new Date().toISOString()
    const { data, error } = await supabase.from('warehouse_maps')
      .upsert({ warehouse_id: wh.id, width, height, cell_m, blocked, notes, updated_at: now, updated_by: req.user?.name ?? null }, { onConflict: 'warehouse_id' })
      .select('width, height, cell_m, blocked, notes, updated_at, updated_by').single()
    if (error) return fail(res, error)
    return ok(res, { ...data, cell_m: Number(data.cell_m) })
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /wms/warehouse-map/:warehouseId/cells — gán/gỡ ô cho NHIỀU vị trí trong một RPC (all-or-nothing)
// body { items: [{ location_id, grid_x, grid_y, grid_w?, grid_h? }] } — grid null = gỡ khỏi bản vẽ
export async function assignCells(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const items = (req.body ?? {}).items
    if (!Array.isArray(items) || items.length === 0) return fail(res, 400, 'VALIDATION_ERROR', 'Thiếu danh sách ô cần gán')
    if (items.length > 2000) return fail(res, 400, 'VALIDATION_ERROR', 'Tối đa 2.000 vị trí mỗi lần')
    const clean: { location_id: string; grid_x: number | null; grid_y: number | null; grid_w: number; grid_h: number }[] = []
    for (const it of items as Record<string, unknown>[]) {
      if (!it || typeof it.location_id !== 'string' || !it.location_id) return fail(res, 400, 'VALIDATION_ERROR', 'Mỗi dòng phải có location_id')
      const gx = toInt(it.grid_x), gy = toInt(it.grid_y)
      if (Number.isNaN(gx) || Number.isNaN(gy) || (gx === null) !== (gy === null)) return fail(res, 400, 'VALIDATION_ERROR', `Toạ độ ô không hợp lệ cho ${it.location_id}`)
      if (gx !== null && (gx < 0 || gy! < 0 || gx >= 1000 || gy! >= 1000)) return fail(res, 400, 'VALIDATION_ERROR', 'Toạ độ ô phải từ 0 tới 999')
      const gw = toInt(it.grid_w) ?? 1, gh = toInt(it.grid_h) ?? 1
      if (Number.isNaN(gw) || Number.isNaN(gh) || gw < 1 || gh < 1 || gw > 100 || gh > 100) return fail(res, 400, 'VALIDATION_ERROR', 'Kích thước khối phải từ 1 tới 100 ô')
      clean.push({ location_id: it.location_id, grid_x: gx, grid_y: gy, grid_w: gw, grid_h: gh })
    }
    const { data, error } = await supabase.rpc('warehouse_map_assign_cells', {
      p_warehouse_id: wh.id, p_items: clean, p_actor: req.user?.name ?? null,
    })
    if (error) return fail(res, error)
    const r = (data ?? {}) as { ok?: boolean; error?: string; updated?: number; count?: number; conflicts?: { location_code: string; other_code: string; x: number; y: number }[] }
    if (r.ok) return ok(res, { updated: r.updated ?? 0 })
    switch (r.error) {
      case 'NOT_IN_WAREHOUSE': return fail(res, 400, 'NOT_IN_WAREHOUSE', `Có ${r.count ?? ''} vị trí không thuộc kho này`)
      case 'OUT_OF_BOUNDS':    return fail(res, 400, 'OUT_OF_BOUNDS', 'Có vị trí nằm ngoài khung bản vẽ — nới khung hoặc chọn ô khác')
      case 'HALF_COORD':       return fail(res, 400, 'VALIDATION_ERROR', 'Toạ độ ô phải có đủ cả cột và hàng')
      case 'TOO_MANY':         return fail(res, 400, 'VALIDATION_ERROR', 'Tối đa 2.000 vị trí mỗi lần')
      case 'CELL_CONFLICT': {
        const c = r.conflicts ?? []
        const ex = c.slice(0, 3).map(x => `${x.location_code} đè ${x.other_code} tại ô (${x.x}, ${x.y})`).join('; ')
        return res.status(409).json({ success: false, error: { code: 'CELL_CONFLICT', message: `Hai chân kệ khác nhau không được chung ô: ${ex}`, conflicts: c } })
      }
      default: return fail(res, 400, 'VALIDATION_ERROR', 'Không gán được ô')
    }
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /wms/warehouse-map/:warehouseId/footprint — đổi Kệ/Sàn cho CẢ chân kệ (mọi tầng cùng chân)
// body { location_ids: string[], is_rack: boolean }
export async function setFootprintRack(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const b = (req.body ?? {}) as { location_ids?: unknown; is_rack?: unknown }
    const ids = Array.isArray(b.location_ids) ? b.location_ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 100) : []
    // Chọn nhiều chân kệ rồi đánh Kệ/Sàn một lượt: 30 chân kệ × 4 tầng = 120 id → chia lô 100 (trần URL PostgREST ~300 uuid)
    if (!ids.length || ids.length > 2000) return fail(res, 400, 'VALIDATION_ERROR', 'Cần 1 tới 2.000 vị trí')
    if (typeof b.is_rack !== 'boolean') return fail(res, 400, 'VALIDATION_ERROR', 'is_rack phải là true/false')
    const patch = { is_rack: b.is_rack, updated_at: new Date().toISOString(), updated_by: req.user?.name ?? null }
    let updated = 0
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from('Location').update(patch)
        .in('id', ids.slice(i, i + 100)).eq('warehouse_id', wh.id).eq('kind', 'STORAGE').select('id')
      if (error) return fail(res, error)
      updated += data?.length ?? 0
    }
    // Kho khác / id lạ → không dòng nào đổi = 404 (không "đã cập nhật" giả — luật 07/09)
    if (!updated) return fail(res, 404, 'NOT_FOUND', 'Không có vị trí nào của kho này khớp danh sách')
    return ok(res, { updated })
  } catch (e) { return fail(res, String(e)) }
}

// POST /wms/warehouse-map/:warehouseId/objects — tạo CỬA XUẤT / CỬA NHẬP / ĐIỂM ĐẦU DÃY (là một Location kind ≠ STORAGE)
// body { kind, name, grid_x, grid_y, grid_w?, grid_h? }
export async function createMapObject(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const b = (req.body ?? {}) as Record<string, unknown>
    const kind = String(b.kind ?? '') as GridKind
    if (!OBJECT_KINDS.includes(kind)) return fail(res, 400, 'VALIDATION_ERROR', 'Loại phải là DOCK_OUT (cửa xuất), DOCK_IN (cửa nhập) hoặc DROP (điểm đầu dãy)')
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : ''
    if (!name) return fail(res, 400, 'VALIDATION_ERROR', 'Cần đặt tên (vd "Cửa xuất 2", "Đầu dãy A")')
    const gx = toInt(b.grid_x), gy = toInt(b.grid_y)
    if (gx === null || gy === null || Number.isNaN(gx) || Number.isNaN(gy) || gx < 0 || gy < 0) return fail(res, 400, 'VALIDATION_ERROR', 'Cần toạ độ ô (grid_x, grid_y) ≥ 0')
    const gw = toInt(b.grid_w) ?? 1, gh = toInt(b.grid_h) ?? 1
    if (Number.isNaN(gw) || Number.isNaN(gh) || gw < 1 || gh < 1 || gw > 100 || gh > 100) return fail(res, 400, 'VALIDATION_ERROR', 'Kích thước khối phải từ 1 tới 100 ô')

    const prefix = (wh.nmsx_code && wh.nmsx_code.trim()) || wh.code
    const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 24) || randomUUID().slice(0, 6).toUpperCase()
    const location_code = `${prefix}_${KIND_GROUP[kind]}_${slug}`
    const now = new Date().toISOString()
    const actor = req.user?.name ?? null
    const fields = {
      sub_code: KIND_GROUP[kind], sub_name: KIND_GROUP_NAME[kind], sub_type: null, categories: null,
      row: name, shelf: '', max_pallets: 0,            // 0 = không giới hạn (quy ước max_pallets)
      is_active: true, is_rack: false, level_no: 1, kind,
      // KHÔNG gắn slot_no_in: cờ đó nghĩa là "kho tạm cần dọn" cho Slotting và làm lệch số đếm cờ giữa hai
      // nhánh danh sách (gói 26 [38b] bắt được: 16/15). Cửa/bãi đứng ngoài picker cất hàng nhờ `kind`
      // (listLocations mặc định chỉ STORAGE); đợt 1 xe hạ đặt pallet xuống DROP nên cửa ghi vào phải mở.
      slot_no_in: false, slot_no_out: false, is_pick_face: false,
      updated_at: now, updated_by: actor,
    }
    // Gỡ cửa là gỡ MỀM (is_active=false, giữ mã) → tạo lại cùng tên = HỒI SINH dòng cũ (cùng id) thay vì
    // 23505 trùng mã. Nhờ đó nút Hoàn tác trên trình vẽ trả lại đúng cửa vừa gỡ.
    const { data: dead, error: eDead } = await supabase.from('Location').select('id')
      .eq('warehouse_id', wh.id).eq('location_code', location_code).eq('is_active', false).neq('kind', 'STORAGE').maybeSingle()
    if (eDead) return fail(res, eDead)
    const row = { id: dead?.id ?? randomUUID(), location_code, warehouse_id: wh.id, ...fields, created_at: now, created_by: actor }
    if (dead) {
      const { error } = await supabase.from('Location').update(fields).eq('id', dead.id)
      if (error) return fail(res, error)
    } else {
      const { error } = await supabase.from('Location').insert(row)
      if (error) return fail(res, error)   // 23505 trùng mã → 409 "đã tồn tại" qua pgUserError
    }
    // Đặt lên lưới qua RPC (kiểm biên + trùng chân kệ). Trùng → trả dòng về trạng thái cũ, trả 409.
    const { data, error: e2 } = await supabase.rpc('warehouse_map_assign_cells', {
      p_warehouse_id: wh.id, p_items: [{ location_id: row.id, grid_x: gx, grid_y: gy, grid_w: gw, grid_h: gh }], p_actor: actor,
    })
    const r = (data ?? {}) as { ok?: boolean; error?: string; conflicts?: unknown[] }
    if (e2 || !r.ok) {
      if (dead) await supabase.from('Location').update({ is_active: false }).eq('id', dead.id)
      else await supabase.from('Location').delete().eq('id', row.id)
      if (e2) return fail(res, e2)
      if (r.error === 'CELL_CONFLICT') return fail(res, 409, 'CELL_CONFLICT', 'Ô này đang có vị trí khác — chọn ô trống')
      if (r.error === 'OUT_OF_BOUNDS') return fail(res, 400, 'OUT_OF_BOUNDS', 'Ô nằm ngoài khung bản vẽ')
      return fail(res, 400, 'VALIDATION_ERROR', 'Không đặt được lên bản vẽ')
    }
    return ok(res, { ...row, grid_x: gx, grid_y: gy, grid_w: gw, grid_h: gh }, 201)
  } catch (e) { return fail(res, String(e)) }
}

// PATCH /wms/warehouse-map/:warehouseId/objects/:id — đổi tên cửa/bãi/điểm hạ (dời ô thì dùng /cells)
export async function renameMapObject(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const name = typeof req.body?.name === 'string' ? String(req.body.name).trim().slice(0, 60) : ''
    if (!name) return fail(res, 400, 'VALIDATION_ERROR', 'Cần tên mới')
    const id = String(req.params.id ?? '')
    if (!id || id.length > 100 || searchLooksLikeInjection(id)) return fail(res, 400, 'BAD_ID', 'Id không hợp lệ')
    const { data, error } = await supabase.from('Location')
      .update({ row: name, updated_at: new Date().toISOString(), updated_by: req.user?.name ?? null })
      .eq('id', id).eq('warehouse_id', wh.id).neq('kind', 'STORAGE').select('id, row').maybeSingle()
    if (error) return fail(res, error)
    if (!data) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy cửa/bãi/điểm hạ này trong kho')
    return ok(res, { id: data.id, name: data.row })
  } catch (e) { return fail(res, String(e)) }
}

// DELETE /wms/warehouse-map/:warehouseId/objects/:id — gỡ cửa/bãi/điểm hạ (mềm: is_active=false + rời lưới)
export async function deleteMapObject(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const id = String(req.params.id ?? '')
    if (!id || id.length > 100 || searchLooksLikeInjection(id)) return fail(res, 400, 'BAD_ID', 'Id không hợp lệ')
    const { data: loc, error } = await supabase.from('Location').select('id, kind, location_code')
      .eq('id', id).eq('warehouse_id', wh.id).eq('is_active', true).maybeSingle()
    if (error) return fail(res, error)
    if (!loc) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy cửa/bãi/điểm hạ này trong kho')
    if (!OBJECT_KINDS.includes(loc.kind as GridKind)) return fail(res, 400, 'NOT_OBJECT', 'Đây là ô chứa hàng — xoá ở trang Vị trí kho')
    // Đang có pallet nằm ở đó (đợt 1: xe hạ đặt xuống đầu dãy) → không gỡ
    const { count } = await supabase.from('InventoryEntry').select('id', { count: 'exact', head: true })
      .eq('location_id', id).gt('cartons_remaining', 0)
    if ((count ?? 0) > 0) return fail(res, 409, 'IN_USE', `Đang có ${count} pallet nằm tại ${loc.location_code} — dời hàng đi trước`)
    const { error: e2 } = await supabase.from('Location')
      .update({ is_active: false, grid_x: null, grid_y: null, updated_at: new Date().toISOString(), updated_by: req.user?.name ?? null })
      .eq('id', id)
    if (e2) return fail(res, e2)
    return ok(res, { id })
  } catch (e) { return fail(res, String(e)) }
}

// GET /wms/warehouse-map/:warehouseId/occupancy — tồn theo ô (1 RPC, jsonb)
export async function getMapOccupancy(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const { data, error } = await supabase.rpc('warehouse_map_occupancy', { p_warehouse_id: wh.id })
    if (error) return fail(res, error)
    return ok(res, Array.isArray(data) ? data : [])
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    return fail(res, String(e))
  }
}

// GET /wms/warehouse-map/:warehouseId/find?q= — tìm pallet / mã hàng → tập ô chứa (để nháy trên bản vẽ)
export async function findOnMap(req: Request, res: Response) {
  try {
    const wh = await loadWarehouse(req, res, req.params.warehouseId)
    if (!wh) return
    const q = String(req.query.q ?? '').trim()
    if (q.length < 2) return ok(res, { hits: [] })
    if (q.length > 60 || searchLooksLikeInjection(q)) return fail(res, 400, 'INVALID_SEARCH', SEARCH_INVALID_MSG)
    const like = `%${safeSearch(q)}%`
    type Hit = { location_id: string; pallet_code: string; material_id: string | null }
    const sel = 'location_id, pallet_code, material_id'
    const base = () => supabase.from('InventoryEntry').select(sel).eq('warehouse_id', wh.id)
      .gt('cartons_remaining', 0).not('location_id', 'is', null).limit(300)
    // 2 truy vấn nhỏ rồi gộp (không ghép chuỗi .or() với danh sách id)
    const { data: mats } = await supabase.from('Material').select('id, material_code, short_name')
      .or(`material_code.ilike.${like},short_name.ilike.${like}`).limit(50)
    const matIds = ((mats ?? []) as { id: string }[]).map(m => m.id)
    const matName = new Map(((mats ?? []) as { id: string; material_code: string; short_name: string | null }[]).map(m => [m.id, m.material_code]))
    const [r1, r2] = await Promise.all([
      base().ilike('pallet_code', like),
      matIds.length ? base().in('material_id', matIds.slice(0, 50)) : Promise.resolve({ data: [] as Hit[], error: null }),
    ])
    if (r1.error) return fail(res, r1.error)
    if (r2.error) return fail(res, r2.error)
    const seen = new Set<string>()
    const hits: { location_id: string; pallet_code: string; material_code: string | null }[] = []
    for (const h of [...(r1.data ?? []), ...(r2.data ?? [])] as Hit[]) {
      const k = `${h.location_id}|${h.pallet_code}`
      if (seen.has(k)) continue
      seen.add(k)
      hits.push({ location_id: h.location_id, pallet_code: h.pallet_code, material_code: h.material_id ? (matName.get(h.material_id) ?? null) : null })
      if (hits.length >= 300) break
    }
    return ok(res, { hits })
  } catch (e) {
    if (isQueryTimeout(e)) return fail(res, 503, 'QUERY_TIMEOUT', QUERY_TIMEOUT_MSG)
    return fail(res, String(e))
  }
}

export const MAP_KINDS = KINDS
