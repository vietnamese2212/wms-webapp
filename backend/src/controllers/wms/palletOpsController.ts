import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'

function ok(res: Response, data: unknown) { return res.json({ success: true, data }) }
function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { message } })
}

const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const ACTIVE = ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']

// Bản ghi truy vết thao tác
async function logOp(req: Request, type: string, source_codes: string[], target_codes: string[], detail: unknown, warehouse_id: string | null) {
  const now = new Date().toISOString()
  await (supabase.from('PalletOperation') as any).insert({
    id: randomUUID(), type, source_codes, target_codes, detail,
    operated_by: req.user?.sub ?? null, operated_by_name: req.user?.name ?? null,
    warehouse_id, created_at: now, updated_at: now,
  })
}

// ── DỒN: gom nhiều tem con về 1 tem đích (co-location, KHÔNG đổi số lượng) ──
// POST /wms/pallet-ops/merge  { target_pallet_code, child_pallet_codes: string[] }
export async function mergePallets(req: Request, res: Response) {
  try {
    const { target_pallet_code, child_pallet_codes } = req.body as { target_pallet_code?: string; child_pallet_codes?: string[] }
    const target = (target_pallet_code ?? '').trim()
    const children = Array.isArray(child_pallet_codes) ? [...new Set(child_pallet_codes.map(c => (c ?? '').trim()).filter(Boolean))] : []
    if (!target) return fail(res, 'Thiếu mã pallet đích')
    if (!children.length) return fail(res, 'Chưa chọn pallet con để dồn')
    if (children.includes(target)) return fail(res, 'Pallet đích không thể vừa là pallet con')

    const { data: tgt, error: tErr } = await (supabase.from('InventoryEntry') as any)
      .select('id, pallet_code, location_id, warehouse_id, parent_pallet_code')
      .eq('pallet_code', target).in('status', ACTIVE).maybeSingle()
    if (tErr) return fail(res, tErr.message, 500)
    if (!tgt) return fail(res, `Không tìm thấy pallet đích "${target}" đang tồn kho`, 404)
    if (tgt.parent_pallet_code) return fail(res, 'Pallet đích đang là pallet con của nhóm khác — chọn pallet đầu nhóm')

    const { data: kids, error: kErr } = await (supabase.from('InventoryEntry') as any)
      .select('id, pallet_code, parent_pallet_code').in('pallet_code', children).in('status', ACTIVE)
    if (kErr) return fail(res, kErr.message, 500)
    const found = (kids ?? []).map((k: any) => k.pallet_code)
    const missing = children.filter(c => !found.includes(c))
    if (missing.length) return fail(res, `Pallet không tồn tại/đã xuất: ${missing.join(', ')}`)

    const now = new Date().toISOString()
    const { error: uErr } = await (supabase.from('InventoryEntry') as any)
      .update({ parent_pallet_code: target, location_id: tgt.location_id, update_date: vnDate(), updated_at: now })
      .in('pallet_code', children)
    if (uErr) return fail(res, uErr.message, 500)

    await logOp(req, 'MERGE', children, [target], { count: children.length }, tgt.warehouse_id ?? null)
    return ok(res, { target, merged: children.length })
  } catch (e) { return fail(res, (e as Error).message, 500) }
}

// ── TÁCH NHÓM (gỡ dồn): trả tem con về pallet độc lập ──
// POST /wms/pallet-ops/ungroup  { pallet_codes: string[] }
export async function ungroupPallets(req: Request, res: Response) {
  try {
    const { pallet_codes } = req.body as { pallet_codes?: string[] }
    const codes = Array.isArray(pallet_codes) ? [...new Set(pallet_codes.map(c => (c ?? '').trim()).filter(Boolean))] : []
    if (!codes.length) return fail(res, 'Chưa chọn pallet để gỡ nhóm')
    const now = new Date().toISOString()
    const { data, error } = await (supabase.from('InventoryEntry') as any)
      .update({ parent_pallet_code: null, update_date: vnDate(), updated_at: now })
      .in('pallet_code', codes).not('parent_pallet_code', 'is', null).select('pallet_code')
    if (error) return fail(res, error.message, 500)
    const n = (data ?? []).length
    if (n) await logOp(req, 'UNGROUP', codes, [], { count: n }, null)
    return ok(res, { ungrouped: n })
  } catch (e) { return fail(res, (e as Error).message, 500) }
}

// ── TÁCH SỐ LƯỢNG: 1 pallet → giữ phần còn lại + sinh pallet con mới (in tem) ──
// POST /wms/pallet-ops/split  { source_pallet_code, children: [{ qty }] }
export async function splitPallet(req: Request, res: Response) {
  try {
    const { source_pallet_code, children } = req.body as { source_pallet_code?: string; children?: { qty: number }[] }
    const src = (source_pallet_code ?? '').trim()
    const parts = src.split('_')
    const items = Array.isArray(children) ? children.map(c => Math.floor(Number(c?.qty) || 0)).filter(q => q > 0) : []
    if (!src) return fail(res, 'Thiếu mã pallet gốc')
    if (parts.length < 6) return fail(res, 'Mã pallet gốc không đúng định dạng QR')
    if (!items.length) return fail(res, 'Chưa nhập số lượng tách')

    const { data: source, error: sErr } = await (supabase.from('InventoryEntry') as any)
      .select('id, pallet_code, location_id, warehouse_id, material_id, manufacturer_id, cycle, machine_code, pallet_sequence_no, qa_status_id, stack_layer, cartons_imported, cartons_remaining, cartons_reserved, production_date')
      .eq('pallet_code', src).in('status', ACTIVE).maybeSingle()
    if (sErr) return fail(res, sErr.message, 500)
    if (!source) return fail(res, `Không tìm thấy pallet gốc "${src}" đang tồn kho`, 404)

    const remaining = Number(source.cartons_remaining ?? 0)
    const reserved = Number(source.cartons_reserved ?? 0)
    const free = remaining - reserved
    const totalSplit = items.reduce((s, q) => s + q, 0)
    if (totalSplit > free) return fail(res, `Tách ${totalSplit} thùng vượt số khả dụng (${free} thùng, đã trừ ${reserved} giữ chỗ)`)

    // Tìm số thứ tự con kế tiếp (baseSeq.N) — quét theo cùng mã hàng
    const baseSeq = parts[4]
    const { data: sameMat } = await (supabase.from('InventoryEntry') as any)
      .select('pallet_code').eq('material_id', source.material_id)
    let maxN = 0
    for (const r of (sameMat ?? []) as { pallet_code: string }[]) {
      const p = String(r.pallet_code).split('_')
      if (p.length === parts.length && p[0] === parts[0] && p[1] === parts[1] && p[2] === parts[2] && p[3] === parts[3] && p[5] === parts[5] && p[4].startsWith(`${baseSeq}.`)) {
        const n = parseInt(p[4].slice(baseSeq.length + 1), 10)
        if (!isNaN(n) && n > maxN) maxN = n
      }
    }

    const now = new Date().toISOString()
    const rows = items.map((qty, i) => {
      const childParts = [...parts]; childParts[4] = `${baseSeq}.${maxN + 1 + i}`
      return {
        id: randomUUID(),
        pallet_code: childParts.join('_'),
        location_id: source.location_id,
        warehouse_id: source.warehouse_id ?? null,
        material_id: source.material_id,
        manufacturer_id: source.manufacturer_id ?? null,
        cycle: source.cycle ?? null,
        machine_code: source.machine_code ?? null,
        pallet_sequence_no: source.pallet_sequence_no ?? null,
        qa_status_id: source.qa_status_id ?? null,
        stack_layer: source.stack_layer ?? 1,
        cartons_imported: qty,         // hiển thị trên tồn; KHÔNG vào báo cáo nhập vì import_order_id=NULL + origin=SPLIT
        cartons_remaining: qty,
        cartons_reserved: 0,
        production_date: source.production_date ?? null,
        import_order_id: null,          // ⚠️ tách KHÔNG thuộc phiếu nhập → báo cáo nhập không bị thổi phồng
        origin: 'SPLIT',
        parent_pallet_code: null,
        status: 'IN_STOCK',
        created_by: req.user?.sub ?? null,
        updated_by: req.user?.sub ?? null,
        import_date: vnDate(),
        update_date: vnDate(),
        created_at: now,
        updated_at: now,
      }
    })

    const { data: created, error: cErr } = await (supabase.from('InventoryEntry') as any).insert(rows).select('*')
    if (cErr) return fail(res, cErr.message, 500)

    // Trừ tồn pallet gốc (GIỮ NGUYÊN cartons_imported để báo cáo nhập bất biến)
    const newRemaining = remaining - totalSplit
    const newStatus = newRemaining < Number(source.cartons_imported ?? 0) ? 'PARTIAL' : undefined
    const { error: upErr } = await (supabase.from('InventoryEntry') as any)
      .update({ cartons_remaining: newRemaining, ...(newStatus ? { status: newStatus } : {}), update_date: vnDate(), updated_at: now })
      .eq('id', source.id)
    if (upErr) return fail(res, upErr.message, 500)

    const childCodes = rows.map(r => r.pallet_code)
    await logOp(req, 'SPLIT', [src], childCodes, { children: rows.map(r => ({ code: r.pallet_code, qty: r.cartons_remaining })), source_remaining: newRemaining }, source.warehouse_id ?? null)

    return ok(res, { source: src, source_remaining: newRemaining, children: created ?? [] })
  } catch (e) { return fail(res, (e as Error).message, 500) }
}
