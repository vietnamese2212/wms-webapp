// TRUY XUẤT LÔ — trả lời "lô này đã đi tới đâu" và "khách này đã nhận lô nào" (28/08).
//
// Toàn bộ phép nối nằm trong RPC `lot_trace` (migration 20260828b): MỘT lời gọi trả cả danh sách
// giao, tồn còn lại và ô tổng — không trả id để backend nạp lại (luật round-trip trong CLAUDE.md).
// Scope kho + loại hàng đẩy XUỐNG RPC chứ không lọc lại ở Node: lọc ở Node nghĩa là đã kéo về
// những dòng người dùng không được xem.
import type { Request, Response } from 'express'
import { supabase } from '../../lib/supabase'
import { maskServerMessage } from '../../utils/response'
import { scopeCategoriesOf } from '../../utils/categoryScope'
import { isUuid } from '../../utils/ids'

const ok = (res: Response, data: unknown) => res.json({ success: true, data })
const fail = (res: Response, message: string, status = 500, code = 'TRACE_ERROR') =>
  res.status(status).json({ success: false, error: { code, message: maskServerMessage(message, status, res) } })

/** Kho user được phép xem; null = không giới hạn (superadmin / NATIONAL). */
function scopeWhIds(req: Request): string[] | null {
  if (req.user?.is_superadmin === true || req.user?.warehouse_scope === 'NATIONAL') return null
  const ids = req.user?.warehouse_ids ?? []
  return ids.length ? ids : null
}

const KINDS = ['pallet', 'material', 'batch', 'npp', 'trip', 'plate'] as const
type Kind = typeof KINDS[number]
const isKind = (v: string): v is Kind => (KINDS as readonly string[]).includes(v)

/** 'YYYY-MM-DD' hoặc rỗng → null. Ngày rác trả undefined để báo 400 thay vì để Postgres ném 22007. */
function dayOf(v: unknown): string | null | undefined {
  const s = String(v ?? '').trim()
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined
}

export async function lotTrace(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    const kind = String(q.kind ?? '').trim()
    const value = String(q.value ?? '').trim()
    if (!isKind(kind)) return fail(res, `Kiểu tìm không hợp lệ (${KINDS.join(' | ')})`, 400, 'BAD_KIND')
    if (!value) return fail(res, 'Thiếu giá trị cần truy xuất', 400, 'BAD_VALUE')
    // Tiền tố quá ngắn quét ra gần như cả kho — chặn sớm thay vì để người dùng chờ rồi nhận 2.000 dòng
    if (kind === 'pallet' && value.length < 4)
      return fail(res, 'Mã pallet cần ít nhất 4 ký tự (vd 190726 = ngày sản xuất)', 400, 'BAD_VALUE')

    const dates = {
      prod_from: dayOf(q.prod_from), prod_to: dayOf(q.prod_to),
      ship_from: dayOf(q.ship_from), ship_to: dayOf(q.ship_to),
    }
    for (const [k, v] of Object.entries(dates))
      if (v === undefined) return fail(res, `Ngày không hợp lệ ở "${k}" (cần YYYY-MM-DD)`, 400, 'BAD_DATE')

    const limit = Math.min(2000, Math.max(50, Number(q.limit) || 500))
    const { data, error } = await supabase.rpc('lot_trace', {
      p_kind: kind, p_value: value,
      p_prod_from: dates.prod_from, p_prod_to: dates.prod_to,
      p_ship_from: dates.ship_from, p_ship_to: dates.ship_to,
      p_wh_ids: scopeWhIds(req), p_categories: scopeCategoriesOf(req),
      p_limit: limit,
    })
    if (error) return fail(res, error.message)
    return ok(res, data ?? {})
  } catch (e) { return fail(res, String(e)) }
}

// ─── CHẤT LƯỢNG PHỤC VỤ: giao ĐỦ và giao ĐÚNG HẠN (28/08) ──────────────────────────────────────
// App đo rất kỹ sản lượng/năng suất/chi phí — toàn chỉ số NỘI BỘ — mà không đo cái KHÁCH HÀNG
// nhìn thấy. Toàn bộ phép tính nằm trong RPC `service_level` (migration 20260828d).
export async function serviceLevel(req: Request, res: Response) {
  try {
    const q = req.query as Record<string, string | undefined>
    const from = dayOf(q.from), to = dayOf(q.to)
    if (from === undefined || to === undefined)
      return fail(res, 'Ngày không hợp lệ (cần YYYY-MM-DD)', 400, 'BAD_DATE')
    if (!from || !to) return fail(res, 'Thiếu khoảng ngày (from, to)', 400, 'BAD_RANGE')
    if (to < from) return fail(res, 'Ngày "đến" phải sau ngày "từ"', 400, 'BAD_RANGE')

    // Ô chọn Kho của Dashboard phải ăn vào tab này như các tab khác — nhưng LỌC LÀ LỌC, không
    // được nới scope: kho ngoài phạm vi được phân quyền là 403, không âm thầm trả dữ liệu kho khác.
    const scope = scopeWhIds(req)
    const wh = String(q.warehouse_id ?? '').trim()
    if (wh && !isUuid(wh)) return fail(res, 'Mã kho không hợp lệ', 400, 'BAD_WAREHOUSE')
    if (wh && scope !== null && !scope.includes(wh))
      return fail(res, 'Kho không thuộc phạm vi được phân quyền', 403, 'WAREHOUSE_OUT_OF_SCOPE')

    const { data, error } = await supabase.rpc('service_level', {
      p_from: from, p_to: to, p_wh_ids: wh ? [wh] : scope, p_limit: 20,
    })
    if (error) return fail(res, error.message)
    return ok(res, data ?? {})
  } catch (e) { return fail(res, String(e)) }
}
