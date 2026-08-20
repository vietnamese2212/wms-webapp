import { Request, Response } from 'express'
import { maskServerMessage } from '../../utils/response'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { invalidateWhTypeMetaCache, type WhTypeMeta } from '../../utils/warehouseTypeMeta'

function fail(res: Response, message: string, status = 400) {
  // 5xx KHÔNG trả nguyên văn message (lộ tên bảng/cột PostgREST) — xem utils/response.ts
  return res.status(status).json({ success: false, error: { message: maskServerMessage(message, status) } })
}

// meta = cờ hành vi per-giá-trị (hiện dùng cho warehouse_type — xem utils/warehouseTypeMeta).
// Chỉ nhận đúng các key đã biết, ép kiểu — không cho client nhét jsonb tùy ý.
function sanitizeMeta(raw: unknown): WhTypeMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out: WhTypeMeta = {}
  if (typeof o.is_ncc_goods === 'boolean') out.is_ncc_goods = o.is_ncc_goods
  if (typeof o.requires_shelf_life === 'boolean') out.requires_shelf_life = o.requires_shelf_life
  if (typeof o.requires_pallet_per_ea === 'boolean') out.requires_pallet_per_ea = o.requires_pallet_per_ea
  if (typeof o.requires_ncc === 'boolean') out.requires_ncc = o.requires_ncc
  if (typeof o.batch_char === 'string') out.batch_char = o.batch_char.trim().toUpperCase().slice(0, 1)
  if (typeof o.badge_color === 'string') out.badge_color = o.badge_color.trim()
  return out
}

export async function listLookup(req: Request, res: Response) {
  const { type } = req.query as { type?: string }
  if (!type) return fail(res, 'type là bắt buộc')

  // select('*') thay vì liệt kê cột: không vỡ khi DB chưa apply migration thêm cột meta (deploy trước, apply sau)
  const { data, error } = await supabase
    .from('LookupValue')
    .select('*')
    .eq('type', type)
    .order('sort_order')
    .order('created_at')

  if (error) return fail(res, error.message, 500)
  res.json({ success: true, data })
}

export async function addLookup(req: Request, res: Response) {
  const { type, value, meta } = req.body as { type?: string; value?: string; meta?: unknown }
  if (!type || !value?.trim()) return fail(res, 'type và value là bắt buộc')

  const t = new Date().toISOString()
  const { data: existing } = await supabase
    .from('LookupValue')
    .select('id, sort_order')
    .eq('type', type)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextSort = existing?.length ? Number((existing[0] as any).sort_order ?? 0) + 1 : 1

  const actor = req.user?.name || null
  const { data, error } = await supabase
    .from('LookupValue')
    .insert({ id: randomUUID(), type, value: value.trim(), sort_order: nextSort, meta: sanitizeMeta(meta) ?? {}, created_at: t, updated_at: t, created_by: actor, updated_by: actor })
    .select('id, value, sort_order, meta, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `"${value.trim()}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  if (type === 'warehouse_type') invalidateWhTypeMetaCache()
  res.json({ success: true, data })
}

export async function updateLookup(req: Request, res: Response) {
  const { id } = req.params
  const { value, meta } = req.body as { value?: string; meta?: unknown }
  if (!value?.trim()) return fail(res, 'value là bắt buộc')
  const newValue = value.trim()

  const { data: cur } = await supabase.from('LookupValue').select('type, value').eq('id', id).maybeSingle()
  if (!cur) return fail(res, 'Không tìm thấy giá trị danh mục', 404)

  // Đổi TÊN loại kho = cascade RPC: tên đang lưu dạng text ở ~11 cột dữ liệu (Material/Location/
  // WarehouseZone/Employee.allowed_categories/SlotTemplate/DeliverySlot/TmsOrder/GDO/gate/
  // inbound_plan_lines/ProductionImport) — đổi lẻ danh mục sẽ để lại "tên ma" tàng hình dữ liệu.
  let renamed: Record<string, number> | null = null
  if (cur.type === 'warehouse_type' && newValue !== cur.value) {
    const { data: counts, error: rpcErr } = await supabase.rpc('rename_warehouse_type', {
      p_old: cur.value, p_new: newValue,
    })
    if (rpcErr) {
      if (rpcErr.code === '23505') return fail(res, `"${newValue}" đã tồn tại`)
      if (rpcErr.code === '42883') return fail(res, 'Chưa apply migration 20260710_warehouse_type_options — không thể đổi tên loại kho an toàn', 500)
      return fail(res, rpcErr.message, 500)
    }
    renamed = (counts ?? {}) as Record<string, number>
  }

  const patch: Record<string, unknown> = { value: newValue, updated_at: new Date().toISOString(), updated_by: req.user?.name || null }
  const cleanMeta = sanitizeMeta(meta)
  if (cleanMeta) patch.meta = cleanMeta

  const { data, error } = await supabase
    .from('LookupValue')
    .update(patch)
    .eq('id', id)
    .select('id, value, sort_order, meta, created_at, updated_at, created_by, updated_by')
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, `"${newValue}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  if (cur.type === 'warehouse_type') invalidateWhTypeMetaCache()
  res.json({ success: true, data: renamed ? { ...data, renamed } : data })
}

// Sắp xếp lại thứ tự (kéo-thả) — set sort_order theo vị trí mảng ids
export async function reorderLookup(req: Request, res: Response) {
  const { type, ids } = req.body as { type?: string; ids?: string[] }
  if (!type || !Array.isArray(ids) || ids.length === 0) return fail(res, 'type và ids là bắt buộc')

  const now = new Date().toISOString()
  const actor = req.user?.name || null
  const results = await Promise.all(
    ids.map((id, i) =>
      supabase
        .from('LookupValue')
        .update({ sort_order: i + 1, updated_at: now, updated_by: actor })
        .eq('id', id)
        .eq('type', type),
    ),
  )
  const err = results.find(r => r.error)?.error
  if (err) return fail(res, err.message, 500)
  res.json({ success: true })
}

// ─── Đơn vị tính (unit_of_measure) — tab RIÊNG, quyền manage_unit ────────────────
// type bị KHÓA CỨNG = 'unit_of_measure' để quyền manage_unit KHÔNG sửa được loại kho.
// meta = { role: base|entry|both, label?: tên tiếng Việt }. Base selector (Mã hàng) lấy role∈{base,both};
// Entry selector lấy role∈{entry,both}. Luật: 1 mã không cho Base = Entry (chặn ở materialController + FE).
const UNIT_ROLES = ['base', 'entry', 'both'] as const
type UnitRole = typeof UNIT_ROLES[number]
function sanitizeUnitMeta(raw: unknown): { role: UnitRole; label?: string } {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const r = typeof o.role === 'string' && (UNIT_ROLES as readonly string[]).includes(o.role) ? o.role as UnitRole : 'both'
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  return label ? { role: r, label } : { role: r }
}

export async function addUnit(req: Request, res: Response) {
  const { value, meta } = req.body as { value?: string; meta?: unknown }
  if (!value?.trim()) return fail(res, 'Mã ĐVT là bắt buộc')
  const code = value.trim().toUpperCase()
  const t = new Date().toISOString()
  const { data: existing } = await supabase.from('LookupValue')
    .select('sort_order').eq('type', 'unit_of_measure').order('sort_order', { ascending: false }).limit(1)
  const nextSort = existing?.length ? Number((existing[0] as any).sort_order ?? 0) + 1 : 1
  const actor = req.user?.name || null
  const { data, error } = await supabase.from('LookupValue')
    .insert({ id: randomUUID(), type: 'unit_of_measure', value: code, sort_order: nextSort, meta: sanitizeUnitMeta(meta), created_at: t, updated_at: t, created_by: actor, updated_by: actor })
    .select('id, value, sort_order, meta, created_at, updated_at, created_by, updated_by').single()
  if (error) {
    if (error.code === '23505') return fail(res, `"${code}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function updateUnit(req: Request, res: Response) {
  const { id } = req.params
  const { value, meta } = req.body as { value?: string; meta?: unknown }
  if (!value?.trim()) return fail(res, 'Mã ĐVT là bắt buộc')
  const { data: cur } = await supabase.from('LookupValue').select('type').eq('id', id).maybeSingle()
  if (!cur || cur.type !== 'unit_of_measure') return fail(res, 'Không tìm thấy đơn vị tính', 404)
  const code = value.trim().toUpperCase()
  const { data, error } = await supabase.from('LookupValue')
    .update({ value: code, meta: sanitizeUnitMeta(meta), updated_at: new Date().toISOString(), updated_by: req.user?.name || null })
    .eq('id', id).select('id, value, sort_order, meta, created_at, updated_at, created_by, updated_by').single()
  if (error) {
    if (error.code === '23505') return fail(res, `"${code}" đã tồn tại`)
    return fail(res, error.message, 500)
  }
  res.json({ success: true, data })
}

export async function deleteUnit(req: Request, res: Response) {
  const { id } = req.params
  const { data: cur } = await supabase.from('LookupValue').select('type, value').eq('id', id).maybeSingle()
  if (!cur || cur.type !== 'unit_of_measure') return fail(res, 'Không tìm thấy đơn vị tính', 404)
  // Chặn xóa ĐVT đang được dùng làm base_unit / entry_unit của mã hàng → tránh mã mất đơn vị
  const [b, e] = await Promise.all([
    supabase.from('Material').select('id', { count: 'exact', head: true }).eq('base_unit', cur.value),
    supabase.from('Material').select('id', { count: 'exact', head: true }).eq('entry_unit', cur.value),
  ])
  const total = (b.count ?? 0) + (e.count ?? 0)
  if (total > 0) return fail(res, `ĐVT "${cur.value}" đang được ${total} mã hàng dùng — không thể xóa`, 409)
  const { error } = await supabase.from('LookupValue').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  res.json({ success: true })
}

export async function reorderUnit(req: Request, res: Response) {
  const { ids } = req.body as { ids?: string[] }
  if (!Array.isArray(ids) || ids.length === 0) return fail(res, 'ids là bắt buộc')
  const now = new Date().toISOString()
  const actor = req.user?.name || null
  const results = await Promise.all(
    ids.map((id, i) => supabase.from('LookupValue')
      .update({ sort_order: i + 1, updated_at: now, updated_by: actor })
      .eq('id', id).eq('type', 'unit_of_measure')),
  )
  const err = results.find(r => r.error)?.error
  if (err) return fail(res, err.message, 500)
  res.json({ success: true })
}

export async function deleteLookup(req: Request, res: Response) {
  const { id } = req.params

  // Chặn xóa loại kho đang được dùng — phải soi ĐỦ MỌI chỗ một Loại kho có thể nằm.
  // Trước 27/07 chỉ soi Location/Material/WarehouseZone → xóa được trong khi Nhân sự (phạm vi
  // loại hàng), Khung giờ, Slot ngày, lệnh TMS… vẫn trỏ vào loại đã mất: dữ liệu mồ côi ÂM THẦM
  // (vd "Thùng": guard báo 2, thực tế còn 39 nhân sự + 174 khung giờ + 90 slot).
  const { data: lk } = await supabase.from('LookupValue').select('value, type').eq('id', id).maybeSingle()
  if (lk?.type === 'warehouse_type' && lk.value) {
    const v = lk.value as string
    const one = (table: string, col: string) =>
      supabase.from(table).select('id', { count: 'exact', head: true }).eq(col, v)
    // Cột MẢNG: dùng contains (cs) thay vì eq
    const arr = (table: string, col: string) =>
      supabase.from(table).select('id', { count: 'exact', head: true }).contains(col, [v])
    // Cột CHUỖI GHÉP ('FG01+PM01' — chuyến chở lẫn, luật giao ≥1 chốt 30/07): `eq` KHÔNG khớp
    // phần tử bên trong ⇒ trước 21/08 xoá lọt loại vẫn đang được chuyến chở lẫn trỏ tới.
    // So theo từng ĐOẠN: đúng nó · đầu chuỗi · cuối chuỗi · giữa chuỗi.
    const joined = (table: string, col: string) =>
      supabase.from(table).select('id', { count: 'exact', head: true })
        .or(`${col}.eq.${v},${col}.like.${v}+%,${col}.like.%+${v},${col}.like.%+${v}+%`)

    const CHECKS: [string, () => PromiseLike<{ count: number | null }>][] = [
      ['mã hàng',              () => one('Material', 'category')],
      // Vị trí/Khu vực/Nhật ký kiểm kê: cột MẢNG từ 27/07 (khu multi-loại)
      ['vị trí kho',           () => arr('Location', 'categories')],
      ['khu vực kho',          () => arr('WarehouseZone', 'categories')],
      ['nhân sự (phạm vi loại hàng)', () => arr('Employee', 'allowed_categories')],
      ['kho (quét tem thùng)', () => arr('Warehouse', 'carton_scan_categories')],
      ['khung giờ mẫu',        () => one('SlotTemplate', 'cargo_type')],
      ['slot ngày',            () => one('DeliverySlot', 'cargo_type')],
      ['lệnh vận chuyển',      () => joined('TmsOrder', 'warehouse_type')],
      ['chuyến xuất',          () => joined('GroupDeliveryOrder', 'warehouse_type')],
      // Cửa đặt lịch (giá trị ĐƠN, tách khỏi luật giao ≥1) + dòng kế hoạch xuất thô
      ['cửa đặt lịch (lệnh)',  () => one('TmsOrder', 'booking_category')],
      ['dòng kế hoạch xuất',   () => one('khvc_lines', 'booking_category')],
      // Loại kho mà các kho đang VẬN HÀNH (bảng gán 21/08) — xoá loại mà bỏ qua đây thì tập gán
      // + chiến thuật riêng của từng kho mồ côi ÂM THẦM (đúng lớp lỗi mà comment trên đã kể).
      ['kho đang vận hành loại này', () => supabase.from('warehouse_type_configs')
        .select('id', { count: 'exact', head: true }).eq('type_code', v)],
      ['phiếu nhập',           () => one('ProductionImport', 'warehouse_type')],
      ['đăng ký cổng',         () => one('gate_registrations', 'warehouse_type')],
      ['dòng kế hoạch nhập',   () => one('inbound_plan_lines', 'warehouse_type')],
      ['lịch sử in tem',       () => one('PalletLabelPrint', 'category')],
      ['nhật ký kiểm kê',      () => arr('StocktakeLog', 'categories')],
    ]
    const counts = await Promise.all(CHECKS.map(([, run]) => run()))
    const used = CHECKS
      .map(([label], i) => ({ label, n: counts[i].count ?? 0 }))
      .filter(x => x.n > 0)
    if (used.length) {
      const chi_tiet = used.map(x => `${x.label}: ${x.n}`).join(' · ')
      const tong = used.reduce((s, x) => s + x.n, 0)
      return fail(res, `Loại kho "${v}" đang được dùng ở ${tong} bản ghi — không thể xóa. Chi tiết: ${chi_tiet}`, 409)
    }
  }

  const { error } = await supabase.from('LookupValue').delete().eq('id', id)
  if (error) return fail(res, error.message, 500)
  res.json({ success: true })
}
