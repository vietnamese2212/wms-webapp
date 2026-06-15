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
      .select('id, pallet_code, parent_pallet_code, location_id').in('pallet_code', children).in('status', ACTIVE)
    if (kErr) return fail(res, kErr.message, 500)
    const found = (kids ?? []).map((k: any) => k.pallet_code)
    const missing = children.filter(c => !found.includes(c))
    if (missing.length) return fail(res, `Pallet không tồn tại/đã xuất: ${missing.join(', ')}`)

    const now = new Date().toISOString()
    // Lưu trạng thái cũ (parent + vị trí) để hoàn tác
    const prev = (kids ?? []).map((k: any) => ({ code: k.pallet_code, parent: k.parent_pallet_code, location_id: k.location_id }))
    const { error: uErr } = await (supabase.from('InventoryEntry') as any)
      .update({ parent_pallet_code: target, location_id: tgt.location_id, update_date: vnDate(), updated_at: now })
      .in('pallet_code', children)
    if (uErr) return fail(res, uErr.message, 500)

    await logOp(req, 'MERGE', children, [target], { count: children.length, prev }, tgt.warehouse_id ?? null)
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
    // Lưu parent cũ để hoàn tác
    const { data: before } = await (supabase.from('InventoryEntry') as any)
      .select('pallet_code, parent_pallet_code').in('pallet_code', codes).not('parent_pallet_code', 'is', null)
    const prev = (before ?? []).map((b: any) => ({ code: b.pallet_code, parent: b.parent_pallet_code }))
    const { data, error } = await (supabase.from('InventoryEntry') as any)
      .update({ parent_pallet_code: null, update_date: vnDate(), updated_at: now })
      .in('pallet_code', codes).not('parent_pallet_code', 'is', null).select('pallet_code')
    if (error) return fail(res, error.message, 500)
    const n = (data ?? []).length
    if (n) await logOp(req, 'UNGROUP', codes, [], { count: n, prev }, null)
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

// ── LỊCH SỬ dồn/tách + tìm kiếm theo mã pallet ──
// GET /wms/pallet-ops?search=&type=&date_from=&date_to=&limit=
export async function listOps(req: Request, res: Response) {
  try {
    const { search, type, date_from, date_to, limit } = req.query as Record<string, string | undefined>
    let q = supabase.from('PalletOperation')
      .select('id, type, source_codes, target_codes, detail, operated_by_name, created_at, undone_at, undone_by_name')
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit ?? '500', 10) || 500, 2000))
    if (type) q = q.eq('type', type)
    if (search) {
      const s = search.trim()
      q = q.or(`source_codes.cs.{"${s}"},target_codes.cs.{"${s}"}`)
    }
    if (date_from) q = q.gte('created_at', new Date(`${date_from}T00:00:00+07:00`).toISOString())
    if (date_to)   q = q.lte('created_at', new Date(`${date_to}T23:59:59+07:00`).toISOString())
    const { data, error } = await q
    if (error) return fail(res, error.message, 500)
    return ok(res, data ?? [])
  } catch (e) { return fail(res, (e as Error).message, 500) }
}

// ── HOÀN TÁC (sửa khi làm sai) — POST /wms/pallet-ops/:id/undo ──
export async function undoOp(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: op, error } = await (supabase.from('PalletOperation') as any).select('*').eq('id', id).maybeSingle()
    if (error) return fail(res, error.message, 500)
    if (!op) return fail(res, 'Không tìm thấy thao tác', 404)
    if (op.undone_at) return fail(res, 'Thao tác này đã được hoàn tác trước đó')

    const now = new Date().toISOString()

    if (op.type === 'MERGE') {
      // Trả parent + vị trí cũ cho từng pallet con
      const prev: { code: string; parent: string | null; location_id: string | null }[] = op.detail?.prev ?? (op.source_codes as string[]).map((c: string) => ({ code: c, parent: null, location_id: null }))
      for (const p of prev) {
        const patch: Record<string, unknown> = { parent_pallet_code: p.parent ?? null, update_date: vnDate(), updated_at: now }
        if (p.location_id) patch.location_id = p.location_id
        await (supabase.from('InventoryEntry') as any).update(patch).eq('pallet_code', p.code)
      }
    } else if (op.type === 'UNGROUP') {
      const prev: { code: string; parent: string | null }[] = op.detail?.prev ?? []
      for (const p of prev) {
        await (supabase.from('InventoryEntry') as any)
          .update({ parent_pallet_code: p.parent ?? null, update_date: vnDate(), updated_at: now }).eq('pallet_code', p.code)
      }
    } else if (op.type === 'SPLIT') {
      const childCodes = (op.target_codes ?? []) as string[]
      const srcCode = (op.source_codes ?? [])[0] as string
      const { data: kids } = await (supabase.from('InventoryEntry') as any)
        .select('pallet_code, origin, parent_pallet_code, cartons_imported, cartons_remaining, cartons_reserved').in('pallet_code', childCodes)
      const found = kids ?? []
      // Guard: pallet con phải còn nguyên (chưa xuất/giữ chỗ/dồn/đổi số lượng) mới hoàn tác được
      const bad = (found as any[]).find(k => k.origin !== 'SPLIT' || k.parent_pallet_code || Number(k.cartons_remaining) !== Number(k.cartons_imported) || Number(k.cartons_reserved || 0) > 0)
      if (found.length !== childCodes.length) return fail(res, 'Không hoàn tác được: pallet con đã bị xuất/xóa.')
      if (bad) return fail(res, `Không hoàn tác được: pallet con "${bad.pallet_code}" đã thay đổi (xuất/giữ chỗ/dồn).`)
      const total = (found as any[]).reduce((s, k) => s + Number(k.cartons_remaining), 0)
      const { error: delErr } = await (supabase.from('InventoryEntry') as any).delete().in('pallet_code', childCodes)
      if (delErr) return fail(res, delErr.message, 500)
      const { data: src } = await (supabase.from('InventoryEntry') as any).select('id, cartons_imported, cartons_remaining').eq('pallet_code', srcCode).maybeSingle()
      if (src) {
        const newRemaining = Number(src.cartons_remaining) + total
        const status = newRemaining >= Number(src.cartons_imported) ? 'IN_STOCK' : 'PARTIAL'
        await (supabase.from('InventoryEntry') as any).update({ cartons_remaining: newRemaining, status, update_date: vnDate(), updated_at: now }).eq('id', src.id)
      }
    } else {
      return fail(res, 'Loại thao tác không hỗ trợ hoàn tác')
    }

    await (supabase.from('PalletOperation') as any).update({ undone_at: now, undone_by: req.user?.sub ?? null, undone_by_name: req.user?.name ?? null, updated_at: now }).eq('id', id)
    return ok(res, { undone: true, type: op.type })
  } catch (e) { return fail(res, (e as Error).message, 500) }
}
