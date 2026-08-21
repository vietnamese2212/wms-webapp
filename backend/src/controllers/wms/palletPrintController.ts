import { Request, Response } from 'express'
import { isQueryTimeout, QUERY_TIMEOUT_MSG } from '../../utils/pagination'
import { maskServerMessage } from '../../utils/response'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'
import { parseListParam } from '../../utils/httpQuery'

function ok(res: Response, data: unknown) {
  return res.json({ success: true, data })
}
function fail(res: Response, message: string, status = 400) {
  // 5xx KHÔNG trả nguyên văn message (lộ tên bảng/cột PostgREST) — xem utils/response.ts
  return res.status(status).json({ success: false, error: { message: maskServerMessage(message, status, res) } })
}

type LabelIn = {
  qr_code: string
  material_code?: string | null
  material_id?: string | null
  category?: string | null
  cycle?: string | null
  machine?: string | null
  seq?: string | null
  nmsx?: string | null
  qty?: number | null
  warehouse_id?: string | null
}

// POST /wms/pallet-prints  — ghi log 1 lần in (mỗi tem = 1 dòng; cùng 1 lệnh in = cùng batch_id)
export async function logPrints(req: Request, res: Response) {
  try {
    const { mode, labels } = req.body as { mode?: string; labels?: LabelIn[] }
    if (!Array.isArray(labels) || labels.length === 0) return fail(res, 'Không có tem để ghi log')
    const printMode = mode === 'REPRINT' ? 'REPRINT' : 'GENERATE'
    // Quyền theo mode: sinh tem mới cần 'generate', in lại cần 'reprint'
    const action = printMode === 'REPRINT' ? 'reprint' : 'generate'
    const isAdmin = req.user?.is_superadmin === true
    if (!isAdmin && !req.user?.module_permissions?.['pallet_print']?.includes(action)) {
      return fail(res, printMode === 'REPRINT' ? 'Bạn không có quyền in lại' : 'Bạn không có quyền sinh tem mới', 403)
    }
    // Scope kho + Loại hàng: không in tem cho kho/loại ngoài phạm vi
    const scopeWh = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
    for (const l of labels) {
      if (scopeWh && l.warehouse_id && !scopeWh.includes(l.warehouse_id)) {
        return fail(res, 'Ngoài phạm vi kho được giao — không thể in tem cho kho này', 403)
      }
      if (!categoryAllowed(req, l.category)) return fail(res, CATEGORY_FORBIDDEN_MSG, 403)
    }
    const batchId = randomUUID()
    const now = new Date().toISOString()
    const rows = labels
      .filter(l => l && typeof l.qr_code === 'string' && l.qr_code.trim())
      .map(l => ({
        id:              randomUUID(),
        batch_id:        batchId,
        qr_code:         l.qr_code.trim(),
        material_code:   l.material_code ?? null,
        material_id:     l.material_id ?? null,
        category:        l.category ?? null,
        cycle:           l.cycle ?? null,
        machine:         l.machine ?? null,
        seq:             l.seq ?? null,
        nmsx:            l.nmsx ?? null,
        qty:             l.qty ?? null,
        mode:            printMode,
        printed_by:      req.user?.sub ?? null,
        printed_by_name: req.user?.name ?? null,
        warehouse_id:    l.warehouse_id ?? null,
        created_at:      now,
        updated_at:      now,
      }))
    if (rows.length === 0) return fail(res, 'Tem không hợp lệ')

    const { error } = await supabase.from('PalletLabelPrint').insert(rows)
    if (error) return fail(res, error.message, 500)
    return ok(res, { logged: rows.length })
  } catch (e) {
    return fail(res, (e as Error).message, 500)
  }
}

// GET /wms/pallet-prints?qr_code=&qr_codes=&search=&categories=&cycles=&machines=&nmsx=&material_codes=&date_from=&date_to=&limit=
// qr_codes (csv): lấy log cho 1 TẬP mã pallet — dùng cho Truy cứu (base = tồn kho, LEFT JOIN số lần in).
// Lọc SERVER-SIDE (dữ liệu có thể vài triệu dòng) — frontend chỉ gọi khi đã có filter/quét mã.
const printCsv = (s?: string | string[]) => parseListParam(s) ?? []
const printTs = (d: string | undefined, endOfDay: boolean) =>
  d ? new Date(`${d}T${endOfDay ? '23:59:59' : '00:00:00'}+07:00`).toISOString() : null

// Bộ lọc dùng chung cho trang + facet — hai đường PHẢI cùng 1 mệnh đề WHERE, lệch nhau là ô chọn
// liệt kê giá trị không có thật (hoặc thiếu giá trị đang có).
function printScope(req: Request) {
  return {
    p_wh_scope:  req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null,
    p_cat_scope: scopeCategoriesOf(req),
  }
}

// Lịch sử in tem — phân trang theo PHIẾU IN (mỗi lần bấm In = 1 phiếu, gập/mở trên màn hình).
// Đường cũ trả mảng tối đa 20.000 dòng, cắt âm thầm; xem migration 20260728_pallet_prints_paged_rpc.sql.
export async function listPrintsPaged(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>
  const pageNum  = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1)
  // TRẦN 100 PHIẾU/trang — KHÔNG phải 500. Đơn vị trang là PHIẾU IN nhưng payload là TEM, mỗi
  // phiếu ~30 tem (332 B/tem đo thật 28/07) ⇒ 100 phiếu ≈ 3.000 tem ≈ 972KB (an toàn), còn
  // 500 phiếu ≈ 15.000 tem ≈ **4.859KB / 9,9s — VƯỢT trần 4,5MB của Vercel**.
  // Bẫy: "Dòng/trang" đếm theo đơn vị người dùng thấy, nhưng trần hạ tầng đếm theo BYTE của dòng
  // THẬT. Ô chọn ở FE cũng chỉ để 20/50/100 để cái user chọn = cái user nhận.
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.page_size ?? '50'), 10) || 50))
  const arg = (v?: string) => { const a = printCsv(v); return a.length ? a : null }

  const { data, error } = await supabase.rpc('pallet_prints_page', {
    ...printScope(req),
    p_from:      printTs(q.date_from, false),
    p_to:        printTs(q.date_to, true),
    p_search:    q.search ? String(q.search).replace(/[%_]/g, m => `\\${m}`) : null,
    p_modes:     arg(q.modes),
    p_materials: arg(q.material_codes),
    p_cycles:    arg(q.cycles),
    p_machines:  arg(q.machines),
    p_printers:  arg(q.printers),
    p_offset:    (pageNum - 1) * pageSize,
    p_limit:     pageSize,
  })
  // Timeout (statement_timeout 8s CỐ ĐỊNH của role PostgREST) → 400 CÓ HƯỚNG DẪN, không phải
  // "Lỗi hệ thống". Quan sát thật dưới tải 24 luồng ghi: câu gom 29.279 tem chỉ mất 59ms lúc rảnh
  // nhưng vượt 8s khi tranh CPU ⇒ user cần biết "hãy thu hẹp khoảng ngày", không phải lỗi trắng.
  if (error) return isQueryTimeout(error) ? fail(res, QUERY_TIMEOUT_MSG, 400) : fail(res, error.message, 500)
  const pd = (data ?? {}) as { rows?: unknown[]; ids?: string[]; total?: number; total_rows?: number; new_n?: number; reprint_n?: number }

  // RPC trả THẲNG dòng (migration 20260728h) ⇒ 1 request PostgREST cho cả trang.
  // Trước đây RPC trả id rồi ở đây nạp lại theo chunk 300 → 1 trang 100 phiếu (~3.000 tem) = **11
  // request**, mỗi request chiếm 1 khe trong pool ~10 khe của PostgREST ⇒ dưới tải là 24s + 500
  // "statement timeout". Xem đầu file migration để biết phép đo phân biệt tầng.
  let rows: unknown[] = pd.rows ?? []
  if (!pd.rows && pd.ids?.length) {
    // Nhánh dự phòng cho cửa sổ triển khai: code mới lên trước khi migration được apply (RPC cũ vẫn
    // trả `ids`). Không có nhánh này thì trang hiện RỖNG cho tới lúc apply migration.
    const parts: unknown[][] = []
    for (let i = 0; i < pd.ids.length; i += 300) {
      const { data: part, error: e2 } = await supabase.from('PalletLabelPrint')
        .select('id, batch_id, qr_code, material_code, category, cycle, machine, seq, nmsx, qty, mode, printed_by_name, created_at, warehouse_id')
        .in('id', pd.ids.slice(i, i + 300))
      if (e2) return fail(res, e2.message, 500)
      parts.push((part ?? []) as unknown[])
    }
    rows = parts.flat()
    ;(rows as { created_at: string }[]).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  }
  return ok(res, {
    rows, total: pd.total ?? 0, total_rows: pd.total_rows ?? 0,
    new_n: pd.new_n ?? 0, reprint_n: pd.reprint_n ?? 0,
    page: pageNum, page_size: pageSize,
  })
}

// Ô chọn bộ lọc lấy từ TOÀN BỘ bộ lọc ngày/tìm kiếm (không phải từ trang đang xem)
export async function listPrintFacets(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>
  const { data, error } = await supabase.rpc('pallet_prints_facets', {
    ...printScope(req),
    p_from:   printTs(q.date_from, false),
    p_to:     printTs(q.date_to, true),
    p_search: q.search ? String(q.search).replace(/[%_]/g, m => `\\${m}`) : null,
  })
  if (error) return fail(res, error.message, 500)
  return ok(res, data ?? {})
}

export async function listPrints(req: Request, res: Response) {
  if (req.query.page) return await listPrintsPaged(req, res)
  try {
    const { qr_code, qr_codes, search, categories, cycles, machines, nmsx, material_codes, date_from, date_to, limit } = req.query as Record<string, string | undefined>
    const csv = (s?: string) => parseListParam(s) ?? []

    // Scope theo user: kho được giao + Loại hàng được phép (dòng cũ chưa gắn kho/loại vẫn hiện)
    const scopeWh = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
    const scopeCats = scopeCategoriesOf(req)

    // Lọc dùng chung; tạo query MỚI mỗi trang (PostgREST cap ~1000 dòng/response → phải phân trang)
    const cats = csv(categories), cyc = csv(cycles), mac = csv(machines), nm = csv(nmsx), mats = csv(material_codes)
    // codeChunk = 1 lô mã pallet của filter Truy cứu/In lại (null = không lọc theo tập mã)
    const applyFilters = (codeChunk: string[] | null) => {
      let q = supabase
        .from('PalletLabelPrint')
        .select('id, batch_id, qr_code, material_code, category, cycle, machine, seq, nmsx, qty, mode, printed_by_name, created_at, warehouse_id')
        .order('created_at', { ascending: false })
      if (scopeWh) q = q.or(`warehouse_id.is.null,warehouse_id.in.(${scopeWh.join(',')})`)
      if (scopeCats) q = q.or(`category.is.null,category.in.(${scopeCats.map(c => `"${c}"`).join(',')})`)
      if (qr_code) q = q.eq('qr_code', qr_code)
      if (search) {
        // Search chung (ô tìm + quét QR tab Lịch sử): mã pallet / mã hàng / người in.
        // Bỏ ký tự phá cú pháp .or() của PostgREST (dấu phẩy, ngoặc)
        const s = search.replace(/[,()]/g, ' ').trim()
        if (s) q = q.or(`qr_code.ilike.%${s}%,material_code.ilike.%${s}%,printed_by_name.ilike.%${s}%`)
      }
      if (codeChunk && codeChunk.length) q = q.in('qr_code', codeChunk)
      if (cats.length) q = q.in('category', cats)
      if (cyc.length)  q = q.in('cycle', cyc)
      if (mac.length)  q = q.in('machine', mac)
      if (nm.length)   q = q.in('nmsx', nm)
      if (mats.length) q = q.in('material_code', mats)
      if (date_from) q = q.gte('created_at', new Date(`${date_from}T00:00:00+07:00`).toISOString())
      if (date_to)   q = q.lte('created_at', new Date(`${date_to}T23:59:59+07:00`).toISOString())
      return q
    }

    // Chunk tập mã Truy cứu/In lại theo lô 300 (né .in quá lớn → URL dài + cap ~1000 làm sót). Không có tập mã → 1 lượt null.
    const codesAll = csv(qr_codes)
    const codeChunks: (string[] | null)[] = codesAll.length
      ? Array.from({ length: Math.ceil(codesAll.length / 300) }, (_, i) => codesAll.slice(i * 300, i * 300 + 300))
      : [null]

    const PAGE = 1000
    const hardCap = Math.min(parseInt(limit ?? '20000', 10) || 20000, 20000)
    const out: { id: string; created_at: string }[] = []
    for (const chunk of codeChunks) {
      for (let p = 0; p * PAGE < hardCap; p++) {
        const { data, error } = await applyFilters(chunk).range(p * PAGE, p * PAGE + PAGE - 1)
        if (error) return fail(res, error.message, 500)
        const batch = (data ?? []) as { id: string; created_at: string }[]
        out.push(...batch)
        if (batch.length < PAGE) break
      }
    }
    // Nhiều lô mã → gộp mất thứ tự DB; sắp lại created_at desc cho nhất quán
    if (codeChunks.length > 1) out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    return ok(res, out)
  } catch (e) {
    return fail(res, (e as Error).message, 500)
  }
}
