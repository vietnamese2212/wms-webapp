import { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'

// ─── Cổng EXPORT read-only cho ERP (pull) ──────────────────────────────────────
// Mẫu chung mọi endpoint: đồng bộ DELTA + phân trang KEYSET (không offset — né cap-1000
// + ổn định khi dữ liệu triệu dòng). ERP gọi lần đầu kèm ?updated_since=<ISO>; sau đó chỉ
// cần lặp lại theo ?cursor=<next_cursor> tới khi next_cursor = null. cursor mã hóa cả mốc
// updated_since + id cuối → giữ bộ lọc delta xuyên suốt các trang mà ERP không phải nhớ.
const MAX_LIMIT = 1000, DEFAULT_LIMIT = 500

type Row = Record<string, unknown>

function parseLimit(v: unknown): number {
  const n = parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

function encodeCursor(since: string | null, id: string): string {
  return Buffer.from(JSON.stringify({ s: since, i: id })).toString('base64url')
}
function decodeCursor(c: string): { s: string | null; i: string } | null {
  try {
    const o = JSON.parse(Buffer.from(c, 'base64url').toString()) as { s?: unknown; i?: unknown }
    if (typeof o.i === 'string') return { s: typeof o.s === 'string' ? o.s : null, i: o.i }
  } catch { /* cursor hỏng → coi như không có */ }
  return null
}

// Bóc `material:Material(material_code)` (embed) thành field phẳng `material_code`.
function flattenMaterialCode(r: Row): Row {
  const m = r.material as { material_code?: string | null } | null | undefined
  const { material: _drop, ...rest } = r
  return { ...rest, material_code: m?.material_code ?? null }
}

// BASE UNIT (đợt 2, 20/07/2026): các cột cartons_* trong DB đã LÀ SỐ BASE (HOP/KG…).
// ERP cần CẢ HAI: số base (tính) + thùng quy đổi (đối chiếu người đọc) → bóc units, trả
// qty_base_* + base_unit + giữ trường cartons_* = THÙNG QUY ĐỔI (base ÷ units_per_carton).
type EmbUnits = { material_code?: string | null; base_unit?: string | null; entry_unit?: string | null; units_per_carton?: number | null }
function toEntryQty(v: unknown, m: EmbUnits | null | undefined): number | null {
  if (v == null) return null
  const q = Number(v)
  if (!isFinite(q)) return null
  const f = Number(m?.units_per_carton)
  if (!m?.entry_unit || !(f > 0)) return q
  return Math.round((q / f) * 1000) / 1000
}
function flattenWithBaseQty(qtyCols: string[]): (r: Row) => Row {
  return (r: Row): Row => {
    const m = r.material as EmbUnits | null | undefined
    const { material: _drop, ...rest } = r
    const out: Row = { ...rest, material_code: m?.material_code ?? null, base_unit: m?.base_unit ?? null, units_per_carton: m?.units_per_carton ?? null }
    for (const c of qtyCols) {
      out[`qty_base_${c}`] = r[c] ?? null            // số GỐC base — nguồn tính toán
      out[c] = toEntryQty(r[c], m)                    // giữ tên cũ = thùng quy đổi (tương thích)
    }
    return out
  }
}

async function exportTable(
  req: Request, res: Response, table: string, cols: string, mapRow?: (r: Row) => Row,
): Promise<void> {
  const limit = parseLimit(req.query.limit)
  const cur = typeof req.query.cursor === 'string' ? decodeCursor(req.query.cursor) : null
  const since = cur ? cur.s : (typeof req.query.updated_since === 'string' ? req.query.updated_since : null)
  const idGt = cur?.i ?? null

  if (since && Number.isNaN(Date.parse(since))) {
    res.status(400).json({ success: false, error: { code: 'BAD_PARAM', message: 'updated_since phải là thời gian ISO 8601' } })
    return
  }

  // Keyset theo id (text/uuid ổn định) — lấy limit+1 để biết còn trang sau. Bộ lọc delta
  // updated_at>=since AND id>cursor đều là AND trong PostgREST.
  let q = supabase.from(table).select(cols).order('id', { ascending: true }).limit(limit + 1)
  if (since) q = q.gte('updated_at', since)
  if (idGt)  q = q.gt('id', idGt)

  const { data, error } = await q
  if (error) {
    res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Lỗi hệ thống, vui lòng thử lại' } })
    return
  }
  const rows = (data ?? []) as unknown as Row[]
  const hasMore = rows.length > limit
  const page = (hasMore ? rows.slice(0, limit) : rows).map(mapRow ?? ((r) => r))
  const nextCursor = hasMore ? encodeCursor(since, String(rows[limit - 1].id)) : null
  res.json({ success: true, data: page, paging: { count: page.length, has_more: hasMore, next_cursor: nextCursor } })
}

// 1) Mã hàng
export function exportMaterials(req: Request, res: Response): Promise<void> {
  return exportTable(req, res, 'Material',
    'id, material_code, material_description, short_name, category, product_type, unit, base_unit, entry_unit, cartons_per_pallet, units_per_carton, pallet_per_ea, weight_kg, shelf_life_days, batch_prefix, is_active, created_at, updated_at')
}
// 2) Tồn kho (kèm mã lô batch + HSD — khóa đối chiếu kế toán)
export function exportInventory(req: Request, res: Response): Promise<void> {
  return exportTable(req, res, 'InventoryEntry',
    'id, pallet_code, batch, expiry_date, production_date, material_id, material:Material(material_code, base_unit, entry_unit, units_per_carton), warehouse_id, location_id, cartons_imported, cartons_remaining, cartons_reserved, status, qa_status_id, nmsx, ncc_id, origin, import_date, created_at, updated_at',
    flattenWithBaseQty(['cartons_imported', 'cartons_remaining', 'cartons_reserved']))
}
// 3) Phiếu nhập
export function exportInboundReceipts(req: Request, res: Response): Promise<void> {
  return exportTable(req, res, 'ProductionImport',
    'id, import_code, material_id, material:Material(material_code, base_unit, entry_unit, units_per_carton), warehouse_id, warehouse_type, planned_cartons, planned_pallets, status, source_type, ncc_id, import_date, created_at, updated_at',
    flattenWithBaseQty(['planned_cartons']))
}
// 4) Phiếu xuất (chuyến giao hàng)
export function exportOutboundOrders(req: Request, res: Response): Promise<void> {
  return exportTable(req, res, 'GroupDeliveryOrder',
    'id, group_code, planned_date, delivery_date, warehouse_id, warehouse_type, dvvt, shipto_party, license_plate, status, transfer_status, completed_at, scan_completed_at, created_at, updated_at')
}
// 5) Lịch sử quét (từng lần quét pallet khi xuất; join tồn/phiếu qua inventory_entry_id / item_id)
export function exportScanEntries(req: Request, res: Response): Promise<void> {
  return exportTable(req, res, 'OutboundScanEntry',
    'id, item_id, inventory_entry_id, pallet_code, cartons_scanned, production_date, nmsx, pct_date, is_loose_picking, scanned_at, scanned_by, created_at, updated_at, item:OutboundItem!item_id(material:Material!material_id(material_code, base_unit, entry_unit, units_per_carton))',
    (r: Row): Row => {
      const m = ((r.item as { material?: EmbUnits | null } | null)?.material ?? null) as EmbUnits | null
      const { item: _drop, ...rest } = r
      return {
        ...rest,
        material_code: m?.material_code ?? null,
        base_unit: m?.base_unit ?? null,
        units_per_carton: m?.units_per_carton ?? null,
        qty_base_cartons_scanned: r.cartons_scanned ?? null,
        cartons_scanned: toEntryQty(r.cartons_scanned, m),
      }
    })
}
