import { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase'

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

// POST /wms/pallet-prints  — ghi log 1 lần in (mỗi tem = 1 dòng)
export async function logPrints(req: Request, res: Response) {
  try {
    const { mode, labels } = req.body as { mode?: string; labels?: LabelIn[] }
    if (!Array.isArray(labels) || labels.length === 0) return fail(res, 'Không có tem để ghi log')
    const printMode = mode === 'REPRINT' ? 'REPRINT' : 'GENERATE'
    const now = new Date().toISOString()
    const rows = labels
      .filter(l => l && typeof l.qr_code === 'string' && l.qr_code.trim())
      .map(l => ({
        id:              randomUUID(),
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

    const { error } = await (supabase.from('PalletLabelPrint') as any).insert(rows)
    if (error) return fail(res, error.message, 500)
    return ok(res, { logged: rows.length })
  } catch (e) {
    return fail(res, (e as Error).message, 500)
  }
}

// GET /wms/pallet-prints?qr_code=&search=&categories=&cycles=&machines=&nmsx=&material_codes=&date_from=&date_to=&limit=
// Lọc SERVER-SIDE (dữ liệu có thể vài triệu dòng) — frontend chỉ gọi khi đã có filter/quét mã.
export async function listPrints(req: Request, res: Response) {
  try {
    const { qr_code, search, categories, cycles, machines, nmsx, material_codes, date_from, date_to, limit } = req.query as Record<string, string | undefined>
    const csv = (s?: string) => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : [])

    let q = supabase
      .from('PalletLabelPrint')
      .select('id, qr_code, material_code, category, cycle, machine, seq, nmsx, qty, mode, printed_by_name, created_at')
      .order('created_at', { ascending: false })
      .limit(Math.min(parseInt(limit ?? '2000', 10) || 2000, 5000))

    if (qr_code) q = q.eq('qr_code', qr_code)
    if (search)  q = q.ilike('qr_code', `%${search}%`)
    const cats = csv(categories), cyc = csv(cycles), mac = csv(machines), nm = csv(nmsx), mats = csv(material_codes)
    if (cats.length) q = q.in('category', cats)
    if (cyc.length)  q = q.in('cycle', cyc)
    if (mac.length)  q = q.in('machine', mac)
    if (nm.length)   q = q.in('nmsx', nm)
    if (mats.length) q = q.in('material_code', mats)
    if (date_from) q = q.gte('created_at', new Date(`${date_from}T00:00:00+07:00`).toISOString())
    if (date_to)   q = q.lte('created_at', new Date(`${date_to}T23:59:59+07:00`).toISOString())

    const { data, error } = await q
    if (error) return fail(res, error.message, 500)
    return ok(res, data ?? [])
  } catch (e) {
    return fail(res, (e as Error).message, 500)
  }
}
