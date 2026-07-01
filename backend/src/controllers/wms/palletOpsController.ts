import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'

function ok(res: Response, data: unknown) { return res.json({ success: true, data }) }
function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { message } })
}

const vnDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
const ACTIVE = ['IN_STOCK', 'PARTIAL', 'QUARANTINE', 'LOOSE_PICKING']

// Kho thực của 1 entry: pallet nhập SX có cột warehouse_id=NULL → kho suy từ LOCATION;
// hàng POSM/shared có location_id=NULL → dùng cột warehouse_id. (Giống scanQR/scanItem dùng location.warehouse_id.)
// ⚠️ KHÔNG lọc trực tiếp .eq('warehouse_id') — ~99.8% pallet có cột này NULL → sẽ không khớp.
const ENTRY_WH = (e: { warehouse_id?: string | null; location?: { warehouse_id?: string | null } | null }): string | null =>
  e?.location?.warehouse_id ?? e?.warehouse_id ?? null
const matchWh = (e: Parameters<typeof ENTRY_WH>[0], wh?: string | null): boolean => !wh || ENTRY_WH(e) === wh
const WH_SELECT = 'warehouse_id, location:Location!location_id(warehouse_id)'

// Bản ghi truy vết thao tác
async function logOp(req: Request, type: string, source_codes: string[], target_codes: string[], detail: unknown, warehouse_id: string | null) {
  const now = new Date().toISOString()
  await supabase.from('PalletOperation').insert({
    id: randomUUID(), type, source_codes, target_codes, detail,
    operated_by: req.user?.sub ?? null, operated_by_name: req.user?.name ?? null,
    warehouse_id, created_at: now, updated_at: now,
  })
}

// ── DỒN: gom nhiều tem con về 1 tem đích (co-location, KHÔNG đổi số lượng) ──
// POST /wms/pallet-ops/merge  { target_pallet_code, child_pallet_codes: string[] }
export async function mergePallets(req: Request, res: Response) {
  try {
    const { target_pallet_code, child_pallet_codes, warehouse_id } = req.body as { target_pallet_code?: string; child_pallet_codes?: string[]; warehouse_id?: string }
    const target = (target_pallet_code ?? '').trim()
    const children = Array.isArray(child_pallet_codes) ? [...new Set(child_pallet_codes.map(c => (c ?? '').trim()).filter(Boolean))] : []
    if (!target) return fail(res, 'Thiếu mã pallet đích')
    if (!children.length) return fail(res, 'Chưa chọn pallet con để dồn')
    if (children.includes(target)) return fail(res, 'Pallet đích không thể vừa là pallet con')

    // Scope theo KHO qua location (warehouse_id cột thường NULL) → tránh trùng mã giữa kho tổng/NPP
    const { data: tRows, error: tErr } = await supabase.from('InventoryEntry')
      .select(`id, pallet_code, location_id, parent_pallet_code, ${WH_SELECT}`)
      .eq('pallet_code', target).in('status', ACTIVE)
    if (tErr) return fail(res, tErr.message, 500)
    const tMatch = (tRows ?? []).filter((r: any) => matchWh(r, warehouse_id))
    if (tMatch.length > 1) return fail(res, `Mã "${target}" có ở nhiều kho — chọn Kho trước khi dồn`)
    const tgt = tMatch[0]
    if (!tgt) return fail(res, `Không tìm thấy pallet đích "${target}" đang tồn ${warehouse_id ? 'trong kho đã chọn' : 'kho'}`, 404)
    if (tgt.parent_pallet_code) return fail(res, 'Pallet đích đang là pallet con của nhóm khác — chọn pallet đầu nhóm')

    const { data: kRows, error: kErr } = await supabase.from('InventoryEntry')
      .select(`id, pallet_code, parent_pallet_code, location_id, ${WH_SELECT}`).in('pallet_code', children).in('status', ACTIVE)
    if (kErr) return fail(res, kErr.message, 500)
    const kids = (kRows ?? []).filter((k: any) => matchWh(k, warehouse_id))
    const found = kids.map((k: any) => k.pallet_code)
    const missing = children.filter(c => !found.includes(c))
    if (missing.length) return fail(res, `Pallet không tồn tại/đã xuất: ${missing.join(', ')}`)

    const now = new Date().toISOString()
    // Lưu trạng thái cũ (parent + vị trí) để hoàn tác
    const prev = kids.map((k: any) => ({ code: k.pallet_code, parent: k.parent_pallet_code, location_id: k.location_id }))
    const { error: uErr } = await supabase.from('InventoryEntry')
      .update({ parent_pallet_code: target, location_id: tgt.location_id, update_date: vnDate(), updated_at: now })
      .in('id', kids.map((k: any) => k.id))
    if (uErr) return fail(res, uErr.message, 500)

    await logOp(req, 'MERGE', children, [target], { count: kids.length, prev }, ENTRY_WH(tgt as unknown as Parameters<typeof ENTRY_WH>[0]))
    return ok(res, { target, merged: kids.length })
  } catch (e) { return fail(res, (e as Error).message, 500) }
}

// ── TÁCH NHÓM (gỡ dồn): trả tem con về pallet độc lập ──
// POST /wms/pallet-ops/ungroup  { pallet_codes: string[] }
export async function ungroupPallets(req: Request, res: Response) {
  try {
    const { pallet_codes, warehouse_id } = req.body as { pallet_codes?: string[]; warehouse_id?: string }
    const codes = Array.isArray(pallet_codes) ? [...new Set(pallet_codes.map(c => (c ?? '').trim()).filter(Boolean))] : []
    if (!codes.length) return fail(res, 'Chưa chọn pallet để gỡ nhóm')
    const now = new Date().toISOString()
    // Scope theo KHO qua location (vd 810000000 ở 2 kho) → tránh gỡ nhầm pallet kho khác
    // Lưu parent cũ để hoàn tác
    const { data: bRows } = await supabase.from('InventoryEntry')
      .select(`id, pallet_code, parent_pallet_code, ${WH_SELECT}`).in('pallet_code', codes).not('parent_pallet_code', 'is', null)
    const before = (bRows ?? []).filter((b: any) => matchWh(b, warehouse_id))
    const prev = before.map((b: any) => ({ code: b.pallet_code, parent: b.parent_pallet_code }))
    let n = 0
    if (before.length) {
      const { data, error } = await supabase.from('InventoryEntry')
        .update({ parent_pallet_code: null, update_date: vnDate(), updated_at: now })
        .in('id', before.map((b: any) => b.id)).select('pallet_code')
      if (error) return fail(res, error.message, 500)
      n = (data ?? []).length
    }
    // warehouse_id để log: ưu tiên param, suy từ entry nếu thiếu — trước đây log null → Lịch sử (lọc theo kho) ẩn mất ca gỡ nhóm
    const whForLog = warehouse_id ?? (before[0] ? ENTRY_WH(before[0] as unknown as Parameters<typeof ENTRY_WH>[0]) : null)
    if (n) await logOp(req, 'UNGROUP', codes, [], { count: n, prev }, whForLog)
    return ok(res, { ungrouped: n })
  } catch (e) { return fail(res, (e as Error).message, 500) }
}

// ── TÁCH SỐ LƯỢNG: 1 pallet → giữ phần còn lại + sinh pallet con mới (in tem) ──
// POST /wms/pallet-ops/split  { source_pallet_code, children: [{ qty }] }
export async function splitPallet(req: Request, res: Response) {
  try {
    const { source_pallet_code, children, warehouse_id, location_id } = req.body as { source_pallet_code?: string; children?: { qty: number }[]; warehouse_id?: string; location_id?: string }
    const src = (source_pallet_code ?? '').trim()
    const parts = src.split('_')
    const items = Array.isArray(children) ? children.map(c => Math.floor(Number(c?.qty) || 0)).filter(q => q > 0) : []
    if (!src) return fail(res, 'Thiếu mã pallet gốc')
    if (parts.length < 6) return fail(res, 'Mã pallet gốc không đúng định dạng QR')
    if (!items.length) return fail(res, 'Chưa nhập số lượng tách')

    // Scope theo KHO qua location (cột warehouse_id thường NULL ở pallet nhập SX)
    const { data: sRows, error: sErr } = await supabase.from('InventoryEntry')
      .select(`id, pallet_code, location_id, material_id, manufacturer_id, cycle, machine_code, pallet_sequence_no, qa_status_id, stack_layer, cartons_imported, cartons_remaining, cartons_reserved, production_date, ${WH_SELECT}`)
      .eq('pallet_code', src).in('status', ACTIVE)
    if (sErr) return fail(res, sErr.message, 500)
    const sMatch = (sRows ?? []).filter((r: any) => matchWh(r, warehouse_id))
    if (sMatch.length > 1) return fail(res, `Mã "${src}" có ở nhiều kho — chọn Kho trước khi tách`)
    const source = sMatch[0]
    if (!source) return fail(res, `Không tìm thấy pallet gốc "${src}" đang tồn ${warehouse_id ? 'trong kho đã chọn' : 'kho'}`, 404)

    const remaining = Number(source.cartons_remaining ?? 0)
    const reserved = Number(source.cartons_reserved ?? 0)
    const free = remaining - reserved
    const totalSplit = items.reduce((s, q) => s + q, 0)
    if (totalSplit > free) return fail(res, `Tách ${totalSplit} thùng vượt số khả dụng (${free} thùng, đã trừ ${reserved} giữ chỗ)`)

    // Tìm số thứ tự con kế tiếp (baseSeq.N) — quét theo cùng mã hàng
    const baseSeq = parts[4]
    const { data: sameMat } = await supabase.from('InventoryEntry')
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
        location_id: location_id || source.location_id,   // vị trí chọn, mặc định = vị trí pallet nguồn
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

    const { data: created, error: cErr } = await supabase.from('InventoryEntry').insert(rows).select('*')
    if (cErr) return fail(res, cErr.message, 500)

    // Trừ tồn pallet gốc NGUYÊN TỬ (optimistic-CAS + jitter, GIỮ NGUYÊN cartons_imported để báo cáo nhập bất biến):
    // chống 2 lượt tách cùng pallet đồng thời over-split (cả 2 trừ từ cùng số đọc cũ). Đọc lại mỗi lần;
    // nếu khả dụng đã < totalSplit (người khác vừa tách) hoặc CAS trượt → ROLLBACK pallet con đã tạo.
    let newRemaining = remaining - totalSplit
    let okDec = false, decErr: 'BUSY' | 'INSUFFICIENT' = 'BUSY'
    for (let attempt = 0; attempt < 15; attempt++) {
      const { data: cur } = await supabase.from('InventoryEntry')
        .select('cartons_remaining, cartons_reserved, cartons_imported').eq('id', source.id).maybeSingle()
      if (!cur) { decErr = 'BUSY'; break }
      const curRem = Number(cur.cartons_remaining ?? 0), curRes = Number(cur.cartons_reserved ?? 0)
      if (curRem - curRes < totalSplit) { decErr = 'INSUFFICIENT'; break }
      newRemaining = curRem - totalSplit
      const st = newRemaining < Number(cur.cartons_imported ?? 0) ? 'PARTIAL' : undefined
      const { data: applied } = await supabase.from('InventoryEntry')
        .update({ cartons_remaining: newRemaining, ...(st ? { status: st } : {}), update_date: vnDate(), updated_at: now })
        .eq('id', source.id).eq('cartons_remaining', curRem).eq('cartons_reserved', curRes).select('id')
      if (applied?.length) { okDec = true; break }
      await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * (30 + attempt * 20))))
    }
    if (!okDec) {
      await supabase.from('InventoryEntry').delete().in('id', rows.map(r => r.id))
      return fail(res, decErr === 'INSUFFICIENT'
        ? `Pallet gốc "${src}" vừa bị tách bớt — không đủ ${totalSplit} thùng khả dụng, thử lại`
        : `Pallet gốc "${src}" đang bận (nhiều người thao tác) — thử lại`, 409)
    }

    const childCodes = rows.map(r => r.pallet_code)
    await logOp(req, 'SPLIT', [src], childCodes, { children: rows.map(r => ({ code: r.pallet_code, qty: r.cartons_remaining })), source_remaining: newRemaining }, ENTRY_WH(source as unknown as Parameters<typeof ENTRY_WH>[0]))

    return ok(res, { source: src, source_remaining: newRemaining, children: created ?? [] })
  } catch (e) { return fail(res, (e as Error).message, 500) }
}

// ── LỊCH SỬ dồn/tách + tìm kiếm theo mã pallet ──
// GET /wms/pallet-ops?search=&type=&date_from=&date_to=&limit=
export async function listOps(req: Request, res: Response) {
  try {
    const { search, type, warehouse_id, date_from, date_to, limit } = req.query as Record<string, string | undefined>
    // Lọc dùng chung; tạo query MỚI mỗi trang (PostgREST cap ~1000 dòng/response → phải phân trang)
    const applyFilters = () => {
      let q = supabase.from('PalletOperation')
        .select('id, type, source_codes, target_codes, detail, operated_by_name, created_at, undone_at, undone_by_name')
        .order('created_at', { ascending: false })
      if (type) q = q.eq('type', type)
      if (warehouse_id) q = q.eq('warehouse_id', warehouse_id)
      if (search) {
        const s = search.trim()
        q = q.or(`source_codes.cs.{"${s}"},target_codes.cs.{"${s}"}`)
      }
      if (date_from) q = q.gte('created_at', new Date(`${date_from}T00:00:00+07:00`).toISOString())
      if (date_to)   q = q.lte('created_at', new Date(`${date_to}T23:59:59+07:00`).toISOString())
      return q
    }

    const PAGE = 1000
    const hardCap = Math.min(parseInt(limit ?? '5000', 10) || 5000, 20000)
    const out: unknown[] = []
    for (let p = 0; p * PAGE < hardCap; p++) {
      const { data, error } = await applyFilters().range(p * PAGE, p * PAGE + PAGE - 1)
      if (error) return fail(res, error.message, 500)
      const batch = data ?? []
      out.push(...batch)
      if (batch.length < PAGE) break
    }
    return ok(res, out)
  } catch (e) { return fail(res, (e as Error).message, 500) }
}

// ── HOÀN TÁC (sửa khi làm sai) — POST /wms/pallet-ops/:id/undo ──
export async function undoOp(req: Request, res: Response) {
  try {
    const { id } = req.params
    const { data: op, error } = await supabase.from('PalletOperation').select('*').eq('id', id).maybeSingle()
    if (error) return fail(res, error.message, 500)
    if (!op) return fail(res, 'Không tìm thấy thao tác', 404)
    if (op.undone_at) return fail(res, 'Thao tác này đã được hoàn tác trước đó')

    const now = new Date().toISOString()
    // CHIẾM NGUYÊN TỬ quyền hoàn tác (chống 2 lượt undo cùng op — double-click / 2 user — chạy song song
    // → SPLIT cộng `total` về nguồn 2 lần = over-restore). Chỉ lượt set được undone_at (đang NULL) mới chạy;
    // lượt kia khớp 0 dòng → dừng. Nếu guard nghiệp vụ phía dưới fail thì RELEASE (trả undone_at về NULL).
    const { data: claimed } = await supabase.from('PalletOperation')
      .update({ undone_at: now, undone_by: req.user?.sub ?? null, undone_by_name: req.user?.name ?? null, updated_at: now })
      .eq('id', id).is('undone_at', null).select('id')
    if (!claimed?.length) return fail(res, 'Thao tác đang được hoàn tác bởi phiên khác')
    const release = async () => {
      await supabase.from('PalletOperation')
        .update({ undone_at: null, undone_by: null, undone_by_name: null, updated_at: new Date().toISOString() })
        .eq('id', id)
    }
    // Scope theo kho của thao tác (resolve qua location, cột warehouse_id thường NULL) → không hoàn tác nhầm kho khác
    const opWh: string | null = op.warehouse_id ?? null
    // Lấy entries khớp kho theo danh sách mã (kèm field tùy chọn)
    const fetchInWh = async (codes: string[], extra = ''): Promise<any[]> => {
      if (!codes.length) return []
      const { data } = await supabase.from('InventoryEntry')
        .select(`id, pallet_code${extra ? ', ' + extra : ''}, ${WH_SELECT}`).in('pallet_code', codes)
      return ((data ?? []) as any[]).filter(e => matchWh(e, opWh))
    }

    if (op.type === 'MERGE') {
      // Trả parent + vị trí cũ cho từng pallet con
      const prev: { code: string; parent: string | null; location_id: string | null }[] = op.detail?.prev ?? (op.source_codes as string[]).map((c: string) => ({ code: c, parent: null, location_id: null }))
      const entries = await fetchInWh(prev.map(p => p.code))
      const byCode = new Map<string, any>(entries.map(e => [e.pallet_code, e]))
      for (const p of prev) {
        const e = byCode.get(p.code); if (!e) continue
        const patch: Record<string, unknown> = { parent_pallet_code: p.parent ?? null, update_date: vnDate(), updated_at: now }
        if (p.location_id) patch.location_id = p.location_id
        await supabase.from('InventoryEntry').update(patch).eq('id', e.id)
      }
    } else if (op.type === 'UNGROUP') {
      const prev: { code: string; parent: string | null }[] = op.detail?.prev ?? []
      const entries = await fetchInWh(prev.map(p => p.code))
      const byCode = new Map<string, any>(entries.map(e => [e.pallet_code, e]))
      for (const p of prev) {
        const e = byCode.get(p.code); if (!e) continue
        await supabase.from('InventoryEntry')
          .update({ parent_pallet_code: p.parent ?? null, update_date: vnDate(), updated_at: now }).eq('id', e.id)
      }
    } else if (op.type === 'SPLIT') {
      const childCodes = (op.target_codes ?? []) as string[]
      const srcCode = (op.source_codes ?? [])[0] as string
      const found = await fetchInWh(childCodes, 'origin, parent_pallet_code, cartons_imported, cartons_remaining, cartons_reserved')
      // Guard: pallet con phải còn nguyên (chưa xuất/giữ chỗ/dồn/đổi số lượng) mới hoàn tác được
      const bad = found.find(k => k.origin !== 'SPLIT' || k.parent_pallet_code || Number(k.cartons_remaining) !== Number(k.cartons_imported) || Number(k.cartons_reserved || 0) > 0)
      if (found.length !== childCodes.length) { await release(); return fail(res, 'Không hoàn tác được: pallet con đã bị xuất/xóa.') }
      if (bad) { await release(); return fail(res, `Không hoàn tác được: pallet con "${bad.pallet_code}" đã thay đổi (xuất/giữ chỗ/dồn).`) }
      const total = found.reduce((s, k) => s + Number(k.cartons_remaining), 0)
      const { error: delErr } = await supabase.from('InventoryEntry').delete().in('id', found.map(k => k.id))
      if (delErr) { await release(); return fail(res, delErr.message, 500) }
      const srcRows = await fetchInWh([srcCode], 'cartons_imported, cartons_remaining')
      const src = srcRows[0]
      if (src) {
        const newRemaining = Number(src.cartons_remaining) + total
        const status = newRemaining >= Number(src.cartons_imported) ? 'IN_STOCK' : 'PARTIAL'
        await supabase.from('InventoryEntry').update({ cartons_remaining: newRemaining, status, update_date: vnDate(), updated_at: now }).eq('id', src.id)
      }
    } else {
      await release()
      return fail(res, 'Loại thao tác không hỗ trợ hoàn tác')
    }

    // undone_at đã set ở bước CHIẾM NGUYÊN TỬ đầu hàm (không cần cập nhật lại).
    return ok(res, { undone: true, type: op.type })
  } catch (e) { return fail(res, (e as Error).message, 500) }
}
