import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'
import { categoryAllowed, scopeCategoriesOf, CATEGORY_FORBIDDEN_MSG } from '../../utils/categoryScope'

function ok(res: Response, data: unknown) {
  return res.json({ success: true, data })
}
function fail(res: Response, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { message } })
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
    const isAdmin = req.user?.name === 'Admin'
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
export async function listPrints(req: Request, res: Response) {
  try {
    const { qr_code, qr_codes, search, categories, cycles, machines, nmsx, material_codes, date_from, date_to, limit } = req.query as Record<string, string | undefined>
    const csv = (s?: string) => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : [])

    // Scope theo user: kho được giao + Loại hàng được phép (dòng cũ chưa gắn kho/loại vẫn hiện)
    const scopeWh = req.user?.warehouse_scope !== 'NATIONAL' ? (req.user?.warehouse_ids ?? []) : null
    const scopeCats = scopeCategoriesOf(req)

    // Lọc dùng chung; tạo query MỚI mỗi trang (PostgREST cap ~1000 dòng/response → phải phân trang)
    const cats = csv(categories), cyc = csv(cycles), mac = csv(machines), nm = csv(nmsx), mats = csv(material_codes)
    // codeChunk = 1 lô mã pallet của filter Truy cứu/In lại (null = không lọc theo tập mã)
    const applyFilters = (codeChunk: string[] | null) => {
      let q = supabase
        .from('PalletLabelPrint')
        .select('id, batch_id, qr_code, material_code, category, cycle, machine, seq, nmsx, qty, mode, printed_by_name, created_at')
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
